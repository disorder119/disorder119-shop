// Incremental ZIP writer: only one compressed entry plus the central directory
// is retained. Backpressure/cancellation propagate to the database iterator.
const encoder=new TextEncoder();
const CRC=Uint32Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=(n>>>1)^((n&1)?0xedb88320:0);return n>>>0;});
export function crc32(bytes){let c=0xffffffff;for(const b of bytes)c=(c>>>8)^CRC[(c^b)&255];return(c^0xffffffff)>>>0;}
export async function digestBytes(bytes){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');}
export async function* zipEntries(entries){
 let offset=0;const central=[],names=new Set();
 for await(const entry of entries){
  if(names.has(entry.path)||names.size>=60000)throw new Error('EXPORT_INVALID_ENTRY_COUNT');names.add(entry.path);
  const name=encoder.encode(entry.path),raw=typeof entry.content==='string'?encoder.encode(entry.content):entry.content;
  if(raw.length>32*1024*1024)throw new Error('EXPORT_ENTRY_TOO_LARGE');
  const compressed=new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
  const checksum=crc32(raw),local=new Uint8Array(30+name.length),v=new DataView(local.buffer);
  v.setUint32(0,0x04034b50,true);v.setUint16(4,20,true);v.setUint16(6,0x800,true);v.setUint16(8,8,true);v.setUint16(12,33,true);v.setUint32(14,checksum,true);v.setUint32(18,compressed.length,true);v.setUint32(22,raw.length,true);v.setUint16(26,name.length,true);local.set(name,30);
  const dir=new Uint8Array(46+name.length),d=new DataView(dir.buffer);
  d.setUint32(0,0x02014b50,true);d.setUint16(4,20,true);d.setUint16(6,20,true);d.setUint16(8,0x800,true);d.setUint16(10,8,true);d.setUint16(14,33,true);d.setUint32(16,checksum,true);d.setUint32(20,compressed.length,true);d.setUint32(24,raw.length,true);d.setUint16(28,name.length,true);d.setUint32(42,offset,true);dir.set(name,46);
  offset+=local.length+compressed.length;if(offset>512*1024*1024)throw new Error('EXPORT_COMPRESSED_LIMIT');central.push(dir);
  yield local;yield compressed;
 }
 const size=central.reduce((s,p)=>s+p.length,0),end=new Uint8Array(22),e=new DataView(end.buffer);
 e.setUint32(0,0x06054b50,true);e.setUint16(8,central.length,true);e.setUint16(10,central.length,true);e.setUint32(12,size,true);e.setUint32(16,offset,true);
 for(const entry of central)yield entry;yield end;
}
export function zipStream(entries){
 const iterator=zipEntries(entries);
 return new ReadableStream({async pull(controller){try{const next=await iterator.next();if(next.done)controller.close();else controller.enqueue(next.value);}catch(error){controller.error(error);await iterator.return();}},async cancel(){await iterator.return();}});
}

// v2: one transactional metadata snapshot; immutable originals loaded in bounded
// batches. Shared logo references are reversible, original hashes remain intact.
import {QUERIES,buildLedger,DATASET_FORMAT} from './tax-dataset.js';
import {DOCUMENT_LOGO} from './document-branding.js';
import {sha256} from './tax-evidence.js';
import {digestBytes,zipStream} from './tax-zip-stream.js';
const encoder=new TextEncoder();
export const LOGO_PATH='assets/disorder119-logo.png';
export const LOGO_REFERENCE='../'+LOGO_PATH;
export const PAGE_SIZE=80;
const queries={...QUERIES,
 invoices:'SELECT id,order_id,rechnungsnummer,ausgestellt_am,waehrung,warenwert_cents,versand_cents,gesamt_cents,pruefsumme,erstellt_am,document_type,html_sha256,tax_profile_json,length(CAST(html AS BLOB)) AS html_bytes,length(CAST(text AS BLOB)) AS text_bytes FROM rechnungen ORDER BY id',
 confirmations:'SELECT order_id,subject,html_sha256,text_sha256,created_at,length(CAST(html AS BLOB)) AS html_bytes,length(CAST(text AS BLOB)) AS text_bytes,length(CAST(invoice_json AS BLOB)) AS invoice_json_bytes FROM order_confirmation_archive ORDER BY order_id'};

export async function prepareDataset(env,year){
 const names=Object.keys(queries),generated_at=new Date().toISOString();
 const result=await env.DB.batch(names.map(name=>env.DB.prepare(queries[name]+' LIMIT 10001')));
 const tables={};let metadataBytes=0;
 for(let i=0;i<names.length;i++){
  if(result[i]?.success===false||!Array.isArray(result[i]?.results))throw new Error('EXPORT_SNAPSHOT_FAILED');
  tables[names[i]]=result[i].results;if(result[i].results.length>10000)throw new Error('EXPORT_METADATA_ROW_LIMIT');
  metadataBytes+=encoder.encode(JSON.stringify(result[i].results)).length;
  if(metadataBytes>32*1024*1024)throw new Error('EXPORT_METADATA_SIZE_LIMIT');
 }
 const {ledger,issues}=buildLedger(tables);
 if(env.TAX_MODE!=='small_business'||env.TAX_CONFIRMED!=='true'||!String(env.TAX_NUMBER||'').trim())issues.push({code:'TAX_PROFILE_INCOMPLETE',message:'Steuerstatus oder betriebliche Steuerkennung noch bestätigen.'});
 for(const e of tables.cash_events)if(await sha256(e.evidence_json)!==e.evidence_hash)throw new Error('PAYMENT_ARCHIVE_HASH_MISMATCH');
 const manifest={format:DATASET_FORMAT,schema_version:2,source_id:'disorder119.com',scope:'full_history',requested_year:year,generated_at,timezone:'Europe/Berlin',document_encoding:{name:'shared-logo-v1',asset:LOGO_PATH,reference:LOGO_REFERENCE},counts:Object.fromEntries(names.map(name=>[name,tables[name].length])),files:[]};
 const files={};for(const name of names)files['data/'+name+'.json']=JSON.stringify(tables[name]);
 files['ledger.json']=JSON.stringify(ledger);files['issues.json']=JSON.stringify(issues);
 files['README.txt']='Vollständiger privater Shop-Datensatz v2. Mit Disorder Manager ab 1.27.0 öffnen. Alle Dateien gemeinsam entpacken: Rechnungen und Bestätigungen verwenden das gemeinsame Original-Logo. Der Manager stellt die ursprünglich eingebetteten Bilddaten bytegenau wieder her und prüft Original- und Transport-Prüfsummen. Datenbank-Originale bleiben unverändert. Keine ELSTER-Übermittlung oder automatische Steuerfreigabe.';
 const summary={orders:tables.orders.length,invoices:tables.invoices.length,cash_events:ledger.length,issues:issues.length,review_required:true};
 async function* entries(){
  const add=async(path,content,extra={})=>{const bytes=typeof content==='string'?encoder.encode(content):content;manifest.files.push({path,sha256:await digestBytes(bytes),bytes:bytes.length,...extra});return{path,content};};
  const logo=Uint8Array.from(atob(DOCUMENT_LOGO.split(',')[1]),c=>c.charCodeAt(0));
  yield await add(LOGO_PATH,logo);
  for(const [path,content]of Object.entries(files))yield await add(path,content);
  // Membership comes from the transaction above, never a moving OFFSET query.
  // Both source tables reject updates/deletes, so later inserts cannot change
  // snapshot originals. SQL replaces only the known logo before D1 serializes it.
  for(const [name,table,key,fields]of [['invoices','rechnungen','id',['html','text']],['confirmations','order_confirmation_archive','order_id',['html','text','invoice_json']]]){
   const rows=tables[name];
   for(let start=0;start<rows.length;start+=PAGE_SIZE){
    const page=rows.slice(start,start+PAGE_SIZE),ids=page.map(r=>r[key]);
    const columns=fields.map(f=>`CASE WHEN instr(${f},codec.marker)=0 THEN replace(${f},codec.logo,codec.marker) ELSE ${f} END AS ${f},instr(${f},codec.marker)=0 AS ${f}_encoded`).join(',');
    const sql=`WITH codec AS (SELECT ? AS logo,? AS marker) SELECT ${key} AS source_id,${columns} FROM ${table},codec WHERE ${key} IN (${ids.map(()=>'?').join(',')})`;
    const found=await env.DB.prepare(sql).bind(DOCUMENT_LOGO,LOGO_REFERENCE,...ids).all();
    if(found?.success===false||!Array.isArray(found?.results)||found.results.length!==page.length)throw new Error('EXPORT_ORIGINAL_MISSING');
    const index=new Map(found.results.map(r=>[r.source_id,r]));
    for(const metadata of page){
     const row=index.get(metadata[key]);if(!row)throw new Error('EXPORT_ORIGINAL_MISSING');
     const slug=await sha256(metadata[key]);
     for(const field of fields){
      const content=row[field];if(typeof content!=='string')throw new Error('EXPORT_ORIGINAL_MISSING');
      const encoded=Boolean(row[field+'_encoded']);
      const original=encoded?content.split(LOGO_REFERENCE).join(DOCUMENT_LOGO):content;
      const originalBytes=encoder.encode(original),originalHash=await digestBytes(originalBytes);
      const storedHash=field==='text'?(metadata.pruefsumme||metadata.text_sha256):metadata[field+'_sha256'];
      if(originalBytes.length!==metadata[field+'_bytes']||(storedHash&&storedHash!==originalHash)||(field==='html'&&metadata.document_type==='invoice'&&!storedHash))throw new Error('EXPORT_ORIGINAL_HASH_MISMATCH');
      const extension=field==='text'?'txt':field==='invoice_json'?'invoice.json':'html';
      yield await add(name+'/'+slug+'.'+extension,content,{encoding:encoded?'shared-logo-v1':'identity',original_sha256:originalHash,original_bytes:originalBytes.length});
     }
    }
   }
  }
  // A cancelled/failed export never receives its manifest or ZIP end record.
  yield {path:'manifest.json',content:JSON.stringify(manifest)};
 }
 return {manifest,files,summary,ledger,issues,stream:()=>zipStream(entries()),entries};
}

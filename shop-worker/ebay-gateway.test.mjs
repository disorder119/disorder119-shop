import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign,privateDecrypt,constants,createDecipheriv,createHash,randomUUID} from 'node:crypto';
import worker from './worker-entry.js';
import {EBAY_ENDPOINT,EBAY_RETURN,handleEbayGateway} from './ebay-gateway.js';
import {sqliteD1,allMigrations} from './test-d1.mjs';
const ec=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
const rsa=generateKeyPairSync('rsa',{modulusLength:2048});
const publicPem=rsa.publicKey.export({type:'spki',format:'pem'});
const now=Date.parse('2026-10-13T15:30:00Z');
const fixture=()=>({metadata:{topic:'MARKETPLACE_ACCOUNT_DELETION',schemaVersion:'1.0',deprecated:false},notification:{
 notificationId:'12345678-1234-4567-89ab-123456789abc',eventDate:'2026-10-12T12:00:00Z',publishDate:'2026-10-13T15:29:00Z',publishAttemptCount:1,
 data:{username:'fixture-customer',userId:'fixture-immutable',eiasToken:'fixture-opaque-token'}}});
function env(){return {DB:sqliteD1(allMigrations()),RATE_LIMITER:{limit:async()=>({success:true})},
 EBAY_CLIENT_ID:'synthetic-'+randomUUID(),EBAY_CLIENT_SECRET:'fixture-only-secret',EBAY_VERIFICATION_TOKEN:'T'.repeat(48),EBAY_PRIVACY_PUBLIC_KEY:publicPem};}
function header(message,key=ec.privateKey,kid='fixture-key'){
 return Buffer.from(JSON.stringify({kid,signature:sign('SHA1',Buffer.from(JSON.stringify(message)),key).toString('base64')})).toString('base64');
}
function provider(calls=[]){return async(url,options)=>{
 calls.push({url,options});
 if(url==='https://api.ebay.com/identity/v1/oauth2/token')return Response.json({access_token:'synthetic-app-token',expires_in:7200});
 if(url==='https://api.ebay.com/commerce/notification/v1/public_key/fixture-key')return Response.json({key:ec.publicKey.export({type:'spki',format:'pem'}),digest:'SHA1',algorithm:'ECDSA'});
 throw Error('Unexpected upstream request');
};}
async function call(e,{message=fixture(),raw,signature,headers={},url=EBAY_ENDPOINT,method='POST',fetcher=provider()}={}){
 const request=new Request(url,{method,headers:method==='POST'?{'Content-Type':'application/json','X-EBAY-SIGNATURE':signature??header(message),...headers}:headers,
 body:method==='POST'?(raw??JSON.stringify(message)):undefined});
 return handleEbayGateway(request,e,new URL(url),{now,fetcher});
}
test('challenge uses exact eBay concatenation order and canonical HTTPS endpoint',async()=>{
 const e=env(),r=await call(e,{method:'GET',url:EBAY_ENDPOINT+'?challenge_code=abc_123'});
 assert.equal(r.status,200);assert.deepEqual(await r.json(),{challengeResponse:createHash('sha256').update('abc_123'+e.EBAY_VERIFICATION_TOKEN+EBAY_ENDPOINT).digest('hex')});
 assert.match(r.headers.get('Content-Type'),/application\/json/);assert.equal(r.headers.get('Cache-Control'),'no-store');
});
for(const query of ['','?challenge_code=','?challenge_code=a&challenge_code=b','?challenge_code=%3Csvg','?challenge_code='+ 'x'.repeat(513)])test('invalid challenge rejected '+query.slice(0,50),async()=>{
 assert.equal((await call(env(),{method:'GET',url:EBAY_ENDPOINT+query})).status,400);
});
for(const field of ['DB','RATE_LIMITER','EBAY_CLIENT_ID','EBAY_CLIENT_SECRET','EBAY_VERIFICATION_TOKEN','EBAY_PRIVACY_PUBLIC_KEY'])test('challenge cannot activate incomplete receiver: '+field,async()=>{
 const e=env();delete e[field];assert.equal((await call(e,{method:'GET',url:EBAY_ENDPOINT+'?challenge_code=abc'})).status,503);
});
test('missing schema is not acknowledged',async()=>{
 const e=env();e.DB=sqliteD1();assert.equal((await call(e,{method:'GET',url:EBAY_ENDPOINT+'?challenge_code=abc'})).status,503);
 assert.equal((await call(e)).status,503);
});
test('valid signature creates durable encrypted single receipt, preserving eBay identities only inside ciphertext',async()=>{
 const e=env(),message=fixture();assert.equal((await call(e,{message})).status,204);assert.equal((await call(e,{message})).status,204);
 const rows=e.DB.raw.prepare('SELECT * FROM ebay_privacy_notifications').all();assert.equal(rows.length,1);
 assert.equal(rows[0].status,'PENDING');assert.equal(rows[0].deadline,'2026-11-12T12:00:00.000Z');
 for(const identity of Object.values(message.notification.data))assert.equal(JSON.stringify(rows).includes(identity),false);
 const box=JSON.parse(rows[0].envelope),key=privateDecrypt({key:rsa.privateKey,padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},Buffer.from(box.key,'base64'));
 const cipher=Buffer.from(box.ciphertext,'base64'),decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(box.iv,'base64'));
 decipher.setAAD(Buffer.from('disorder119-ebay-privacy-v1:'+rows[0].id));decipher.setAuthTag(cipher.subarray(-16));
 const plain=Buffer.concat([decipher.update(cipher.subarray(0,-16)),decipher.final()]);
 assert.deepEqual(JSON.parse(plain).data,message.notification.data);
 assert.equal(e.DB.raw.prepare('SELECT count(*) AS n FROM orders').get().n,0);
 const task=e.DB.raw.prepare('SELECT * FROM operations_tasks').get();assert.equal(task.status,'OPEN');assert.equal(task.entity_type,'SYSTEM');
 assert.throws(()=>e.DB.raw.prepare("UPDATE operations_tasks SET status='DONE' WHERE id=?").run(task.id),/ebay_privacy_resolution_required/);
});
test('SDK canonicalization handles formatted JSON while preserving semantic signature',async()=>{
 assert.equal((await call(env(),{raw:JSON.stringify(fixture(),null,2)})).status,204);
});
test('official manual/raw-byte signature supports whitespace and escaped JSON',async()=>{
 const raw=JSON.stringify(fixture(),null,2),signature=Buffer.from(JSON.stringify({alg:'ECDSA',digest:'SHA1',kid:'fixture-key',signature:sign('SHA1',Buffer.from(raw),ec.privateKey).toString('base64')})).toString('base64');
 assert.equal((await call(env(),{raw,signature})).status,204);
});
test('request cannot choose a weaker/wrong signature algorithm',async()=>{
 for(const change of [{alg:'none'},{digest:'MD5'}]){
 const signature=JSON.parse(Buffer.from(header(fixture()),'base64'));Object.assign(signature,change);const calls=[];
 assert.equal((await call(env(),{signature:Buffer.from(JSON.stringify(signature)).toString('base64'),fetcher:provider(calls)})).status,412);assert.equal(calls.length,0);
 }
});
for(const signature of ['', 'invalid', Buffer.from('{}').toString('base64'), Buffer.from(JSON.stringify({kid:'../../steal',signature:'YWJj'})).toString('base64'), 'x'.repeat(2049)])test('reject signature before lookup '+signature.slice(0,40),async()=>{
 const e=env(),calls=[];assert.equal((await call(e,{signature,fetcher:provider(calls)})).status,412);assert.equal(calls.length,0);
 assert.equal(e.DB.raw.prepare('SELECT count(*) AS n FROM ebay_privacy_notifications').get().n,0);
});
test('modified signed payload never creates a receipt',async()=>{
 const e=env(),message=fixture(),signature=header(message);message.notification.data.username='forged-customer';
 assert.equal((await call(e,{message,signature})).status,412);assert.equal(e.DB.raw.prepare('SELECT count(*) AS n FROM ebay_privacy_notifications').get().n,0);
});
test('signature by another key fails',async()=>{
 const e=env(),other=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
 assert.equal((await call(e,{signature:header(fixture(),other.privateKey)})).status,412);
});
test('token and public key are cached, requests are confined to fixed eBay application-token/key endpoints',async()=>{
 const e=env(),calls=[];await call(e,{fetcher:provider(calls)});await call(e,{fetcher:provider(calls)});
 assert.equal(calls.length,2);assert.match(calls[0].options.body,/grant_type=client_credentials/);assert.equal(calls[0].options.redirect,'manual');
 assert.equal(calls[1].options.headers.Authorization,'Bearer synthetic-app-token');
 assert.equal(calls.some(c=>/sell\//.test(c.url)),false);
});
test('default fetch preserves the Workers receiver and supports runtimes without AbortSignal.timeout',async()=>{
 const originalFetch=globalThis.fetch,originalTimeout=AbortSignal.timeout;
 try{
  AbortSignal.timeout=undefined;
  globalThis.fetch=function(...args){assert.equal(this,globalThis);return provider()(...args);};
  const message=fixture(),request=new Request(EBAY_ENDPOINT,{method:'POST',headers:{'Content-Type':'application/json','X-EBAY-SIGNATURE':header(message)},body:JSON.stringify(message)});
  assert.equal((await handleEbayGateway(request,env(),new URL(EBAY_ENDPOINT),{now})).status,204);
 }finally{globalThis.fetch=originalFetch;AbortSignal.timeout=originalTimeout;}
});
test('upstream redirect is rejected without forwarding authorization',async()=>{
 const e=env(),calls=[];
 const r=await call(e,{fetcher:async(url,options)=>{calls.push({url,options});return new Response(null,{status:302,headers:{Location:'https://attacker.example/'}});}});
 assert.equal(r.status,503);assert.equal(calls.length,1);assert.equal(calls[0].options.redirect,'manual');
});
test('upstream outage or redirect not acknowledged; raw errors and credentials not leaked',async()=>{
 const e=env(),r=await call(e,{fetcher:async()=>{throw Error(e.EBAY_CLIENT_SECRET);}});
 assert.equal(r.status,503);assert.equal((await r.text()).includes(e.EBAY_CLIENT_SECRET),false);
});
for(const mutate of [m=>m.metadata.topic='OTHER',m=>m.metadata.schemaVersion='9.0',m=>m.metadata.deprecated=true,m=>m.notification.notificationId='',m=>m.notification.eventDate='invalid',m=>m.notification.publishDate='2099-01-01',m=>m.notification.publishAttemptCount=-1,m=>m.notification.data={},m=>m.notification.data.userId='x'.repeat(2049)])test('signed invalid schema is rejected '+mutate.toString().slice(0,80),async()=>{
 const message=fixture();mutate(message);assert.equal((await call(env(),{message})).status,400);
});
test('initial signed publication may have attempt count zero',async()=>{
 const message=fixture();message.notification.publishAttemptCount=0;
 assert.equal((await call(env(),{message})).status,204);
});
test('signed eBay notification IDs are opaque strings and need not be UUIDs',async()=>{
 const message=fixture();message.notification.notificationId='account-deletion-test-event';
 assert.equal((await call(env(),{message})).status,204);
});
test('wrong content type, too large streamed body and browser-origin POST fail closed',async()=>{
 assert.equal((await call(env(),{headers:{'Content-Type':'text/plain'}})).status,415);
 assert.equal((await call(env(),{raw:' '.repeat(32769)})).status,413);
 assert.equal((await call(env(),{headers:{Origin:'https://attacker.example'}})).status,403);
});
test('rate limit cannot trigger key lookups, receipt or success challenge',async()=>{
 const e=env();e.RATE_LIMITER.limit=async()=>({success:false});const calls=[];
 assert.equal((await call(e,{fetcher:provider(calls)})).status,429);assert.equal(calls.length,0);
 assert.equal((await call(e,{method:'GET',url:EBAY_ENDPOINT+'?challenge_code=a'})).status,429);
});
test('unconfigured/weak encryption key prevents successful receipt',async()=>{
 for(const pem of [undefined,'not a PEM',generateKeyPairSync('rsa',{modulusLength:1024}).publicKey.export({type:'spki',format:'pem'})]){
 const e=env();e.EBAY_PRIVACY_PUBLIC_KEY=pem;assert.equal((await call(e)).status,503);
 assert.equal(e.DB.raw.prepare('SELECT count(*) AS n FROM ebay_privacy_notifications').get().n,0);
 }
});
test('callback is static and isolated, no reflected input/provider tokens/third-party scripts',async()=>{
 const marker='PRIVATE_AUTH_CODE_<script>alert(1)</script>',e=env();
 const r=await call(e,{url:EBAY_RETURN+'?code='+encodeURIComponent(marker)+'&state=test',method:'GET'}),html=await r.text();
 assert.equal(r.status,200);assert.equal(html.includes(marker),false);assert.equal(html.includes(e.EBAY_CLIENT_SECRET),false);
 assert.match(html,/history.replaceState/);assert.match(html,/field.value=link/);assert.doesNotMatch(html,/innerHTML|<script src=|fetch\(/);
 assert.match(r.headers.get('Content-Security-Policy'),/script-src 'sha256-/);assert.match(r.headers.get('Content-Security-Policy'),/connect-src 'none'/);
 assert.equal(r.headers.get('Referrer-Policy'),'no-referrer');assert.equal(r.headers.has('Set-Cookie'),false);
});
test('worker routes return page without checkout/admin auth and rejects unsupported methods',async()=>{
 const r=await worker.fetch(new Request(EBAY_RETURN),env(),{});assert.equal(r.status,200);assert.equal(r.headers.get('Cache-Control'),'no-store');
 assert.equal((await call(env(),{method:'PUT'})).status,405);
 assert.equal((await call(env(),{method:'GET',url:'https://attacker.example/ebay/account-deletion?challenge_code=a'})).status,400);
});
test('privacy queue cannot be read unauthenticated',async()=>{
 const e=env(),r=await worker.fetch(new Request('https://api.disorder119.com/admin/ebay/privacy-requests'),e,{});
 assert.ok([401,403,503].includes(r.status));assert.doesNotMatch(await r.text(),/fixture-customer|envelope/);
});
test('owner resolves only after explicit documented review; read token/origin cannot resolve or expose notices',async()=>{
 const e=env();e.ADMIN_READ_TOKEN='r'.repeat(40);e.ADMIN_WRITE_TOKEN='w'.repeat(40);
 await call(e);
 const url='https://api.disorder119.com/admin/ebay/privacy-requests',body={id:fixture().notification.notificationId,action:'NO_DATA',confirm:true,note:'Synthetic review checked all isolated test archives; no customer data exists.'};
 const invoke=async(token,method='GET',value=body,origin='https://admin.disorder119.com')=>worker.fetch(new Request(url,{method,headers:{Authorization:'Bearer '+token,Origin:origin,'Content-Type':'application/json'},body:method==='POST'?JSON.stringify(value):undefined}),e,{});
 assert.equal((await invoke(e.ADMIN_READ_TOKEN)).status,403);
 assert.equal((await invoke(e.ADMIN_WRITE_TOKEN,'GET',body,'https://attacker.example')).status,403);
 const read=await invoke(e.ADMIN_WRITE_TOKEN);assert.equal(read.status,200);assert.equal(read.headers.get('Access-Control-Allow-Origin'),'https://admin.disorder119.com');
 assert.equal((await read.json()).requests.length,1);
 assert.equal((await invoke(e.ADMIN_WRITE_TOKEN,'POST',{...body,confirm:false})).status,400);
 assert.equal((await invoke(e.ADMIN_WRITE_TOKEN,'POST',{...body,note:'done'})).status,400);
 assert.equal((await invoke(e.ADMIN_READ_TOKEN,'POST')).status,403);
 assert.equal((await invoke(e.ADMIN_WRITE_TOKEN,'POST')).status,200);
 const row=e.DB.raw.prepare('SELECT * FROM ebay_privacy_notifications').get();assert.equal(row.status,'NO_DATA');assert.equal(row.envelope,'');
 assert.equal(e.DB.raw.prepare('SELECT * FROM operations_tasks').get().status,'DONE');
 assert.equal((await invoke(e.ADMIN_WRITE_TOKEN,'POST')).status,409);
});
for(const curve of ['secp384r1','secp521r1'])test('standard ECC curve and DER long-length support: '+curve,async()=>{
 const other=generateKeyPairSync('ec',{namedCurve:curve});const e=env();
 const fetcher=async(url,options)=>url.endsWith('/fixture-key')?Response.json({key:other.publicKey.export({type:'spki',format:'pem'})}):provider()(url,options);
 assert.equal((await call(e,{signature:header(fixture(),other.privateKey),fetcher})).status,204);
});

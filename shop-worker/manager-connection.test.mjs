import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {sqliteD1,allMigrations} from './test-d1.mjs';
import {handleManagerConnection,validRedirect} from './manager-connection.js';
import worker from './worker-entry.js';
const ORIGIN='https://admin.disorder119.com';
const hash=v=>createHash('sha256').update(v).digest('base64url');
const cookie='S'.repeat(43),verifier='V'.repeat(43),state='T'.repeat(43),redirect='http://127.0.0.1:54321/callback';
function env(){
 const DB=sqliteD1(allMigrations()),now=new Date().toISOString();
 DB.raw.prepare(`INSERT INTO admin_passkeys(id,name,rp_id,public_key_jwk,algorithm,created_at) VALUES('TEST-OWNER','Synthetic owner','admin.disorder119.com','{}',-7,?)`).run(now);
 DB.raw.prepare(`INSERT INTO admin_sessions(id,passkey_id,created_at,expires_at,last_seen_at) VALUES(?,'TEST-OWNER',?,'2099-01-01T00:00:00.000Z',?)`).run(createHash('sha256').update(cookie).digest('hex'),now,now);
 return {DB,RATE_LIMITER:{limit:async()=>({success:true})},PAYPAL_ENVIRONMENT:'live',TAX_MODE:'small_business',TAX_CONFIRMED:'true',TAX_NUMBER:'TEST'};
}
async function call(e,path,body,{owner=false,token,origin,method}={}){
 const headers={};if(body!==undefined)headers['Content-Type']='application/json';
 if(owner){headers.Origin=ORIGIN;headers.Cookie='d119_admin='+cookie;}
 if(token)headers.Authorization='Bearer '+token;if(origin)headers.Origin=origin;
 const r=new Request('https://api.disorder119.com'+path,{method:method||(body===undefined?'GET':'POST'),headers,body:body===undefined?undefined:JSON.stringify(body)});
 const response=await handleManagerConnection(r,e,new URL(r.url));
 return {response,data:response.headers.get('Content-Type')?.includes('json')?await response.json():null};
}
async function start(e,changes={}){
 const result=await call(e,'/manager/authorize',{redirect_uri:redirect,state,code_challenge:hash(verifier),code_challenge_method:'S256',device_name:'MUSTER PC',...changes});
 return result;
}
async function approved(e){
 const started=await start(e);assert.equal(started.response.status,201);
 const a=await call(e,'/admin/manager/approve',{id:started.data.request_id,confirm:true},{owner:true});assert.equal(a.response.status,200);
 const cb=new URL(a.data.callback_uri);assert.equal(cb.searchParams.get('state'),state);
 return {code:cb.searchParams.get('code'),id:started.data.request_id};
}
async function paired(e){const a=await approved(e);const r=await call(e,'/manager/token',{code:a.code,code_verifier:verifier,redirect_uri:redirect});assert.equal(r.response.status,200);return r.data;}

test('loopback redirect rejects external hosts, userinfo, fragments and path tricks',()=>{
 assert.equal(validRedirect(redirect),true);
 for(const value of ['https://127.0.0.1:54321/callback','http://localhost:54321/callback','http://127.0.0.1.evil:54321/callback','http://evil@127.0.0.1:54321/callback',redirect+'#fragment',redirect+'?q=x','http://127.0.0.1:80/callback','http://127.0.0.1:65536/callback','http://127.0.0.1:54321/%63allback'])assert.equal(validRedirect(value),false,value);
});
test('approval needs existing owner session, exact origin and explicit confirmation',async()=>{
 const e=env(),s=await start(e),body={id:s.data.request_id,confirm:true};
 assert.equal((await call(e,'/admin/manager/approve',body)).response.status,403);
 assert.equal((await call(e,'/admin/manager/approve',body,{origin:ORIGIN})).response.status,401);
 assert.equal((await call(e,'/admin/manager/approve',body,{owner:true,origin:'https://disorder119.com'})).response.status,403);
 assert.equal((await call(e,'/admin/manager/approve',{...body,confirm:false},{owner:true})).response.status,400);
 assert.equal(e.DB.raw.prepare('SELECT COUNT(*) AS n FROM manager_dataset_grants').get().n,0);
});
test('PKCE code is bound to verifier and callback, short-lived and single-use',async()=>{
 const e=env(),a=await approved(e),body={code:a.code,code_verifier:verifier,redirect_uri:redirect};
 for(const bad of [{...body,code_verifier:'X'.repeat(43)},{...body,redirect_uri:'http://127.0.0.1:54322/callback'}])assert.equal((await call(e,'/manager/token',bad)).response.status,401);
 const first=await call(e,'/manager/token',body);assert.equal(first.response.status,200);assert.equal(first.data.scope,'shop_dataset_read');
 assert.equal((await call(e,'/manager/token',body)).response.status,401);
 const stored=e.DB.raw.prepare('SELECT * FROM manager_dataset_grants').get();assert.notEqual(stored.token_hash,first.data.access_token);assert.equal(stored.token_hash,hash(first.data.access_token));
 assert.equal(JSON.stringify(e.DB.raw.prepare('SELECT * FROM manager_auth_requests').all()).includes(a.code),false);
});
test('simultaneous code exchange yields only one token',async()=>{
 const e=env(),a=await approved(e),body={code:a.code,code_verifier:verifier,redirect_uri:redirect};
 const result=await Promise.all([call(e,'/manager/token',body),call(e,'/manager/token',body)]);
 assert.equal(result.filter(r=>r.response.status===200).length,1);
 assert.equal(e.DB.raw.prepare('SELECT COUNT(*) AS n FROM manager_dataset_grants').get().n,1);
});
test('expired code, request denial and revoked approving passkey fail closed',async()=>{
 for(const mode of ['expire','deny','passkey']){
  const e=env(),a=await approved(e);
  if(mode==='expire')e.DB.raw.prepare("UPDATE manager_auth_requests SET code_expires_at='2000-01-01' WHERE id=?").run(a.id);
  if(mode==='deny')e.DB.raw.prepare("UPDATE manager_auth_requests SET denied_at='2000-01-01' WHERE id=?").run(a.id);
  if(mode==='passkey')e.DB.raw.prepare("UPDATE admin_passkeys SET revoked_at='2000-01-01' WHERE id='TEST-OWNER'").run();
  assert.notEqual((await call(e,'/manager/token',{code:a.code,code_verifier:verifier,redirect_uri:redirect})).response.status,200);
 }
});
test('owner revocation and device disconnect take effect immediately',async()=>{
 for(const mode of ['owner','device','passkey','expired']){
  const e=env(),g=await paired(e);
  assert.equal((await call(e,'/manager/status',undefined,{token:g.access_token})).response.status,200);
  if(mode==='owner')assert.equal((await call(e,'/admin/manager/revoke',{id:g.grant_id},{owner:true})).response.status,200);
  if(mode==='device')assert.equal((await call(e,'/manager/disconnect',{}, {token:g.access_token})).response.status,200);
  if(mode==='passkey')e.DB.raw.prepare("UPDATE admin_passkeys SET revoked_at='2000-01-01' WHERE id='TEST-OWNER'").run();
  if(mode==='expired')e.DB.raw.prepare("UPDATE manager_dataset_grants SET expires_at='2000-01-01'").run();
  assert.equal((await call(e,'/manager/status',undefined,{token:g.access_token})).response.status,401);
 }
});
test('dataset grant cannot write business data, use browser-origin or bypass admin authorization',async()=>{
 const e=env(),g=await paired(e);
 assert.equal((await call(e,'/manager/status',undefined,{token:g.access_token,origin:ORIGIN})).response.status,403);
 assert.equal((await call(e,'/manager/dataset.zip?jahr=2025',{}, {token:g.access_token})).response.status,405);
 for(const path of ['/admin/orders','/admin/orders/MUSTER/refund','/admin/manager/grants']){
  const r=await worker.fetch(new Request('https://api.disorder119.com'+path,{headers:{Authorization:'Bearer '+g.access_token}}),e,{});
  assert.equal(r.ok,false,path);
 }
 assert.equal(e.DB.raw.prepare('SELECT COUNT(*) AS n FROM commerce_orders').get().n,0);
});
test('verified ZIP export is GET-only and never generates business records',async()=>{
 const e=env(),g=await paired(e);
 const before=e.DB.raw.prepare('SELECT COUNT(*) AS n FROM audit_events').get().n;
 const r=await call(e,'/manager/dataset.zip?jahr=2025',undefined,{token:g.access_token});assert.equal(r.response.status,200);
 assert.equal(r.response.headers.get('Content-Type'),'application/zip');
 const bytes=new Uint8Array(await r.response.arrayBuffer());assert.deepEqual([...bytes.slice(0,4)],[80,75,3,4]);
 assert.equal(e.DB.raw.prepare('SELECT COUNT(*) AS n FROM audit_events').get().n,before);
 assert.equal((await call(e,'/manager/dataset.zip?jahr=2099',undefined,{token:g.access_token})).response.status,400);
});
test('native starts and exports require functioning rate limiter',async()=>{
 const e=env();e.RATE_LIMITER=null;assert.equal((await start(e)).response.status,503);
 e.RATE_LIMITER={limit:async()=>({success:false})};assert.equal((await start(e)).response.status,429);
 assert.equal(e.DB.raw.prepare('SELECT COUNT(*) AS n FROM manager_auth_requests').get().n,0);
});
test('owner list exposes metadata only, no tokens/codes/challenges',async()=>{
 const e=env(),g=await paired(e),r=await call(e,'/admin/manager/grants',undefined,{owner:true});
 assert.equal(r.response.status,200);assert.equal(r.data.grants.length,1);
 assert.equal(JSON.stringify(r.data).includes(g.access_token),false);
 assert.equal(Object.keys(r.data.grants[0]).some(k=>/hash|code|token|state|challenge/.test(k)),false);
});

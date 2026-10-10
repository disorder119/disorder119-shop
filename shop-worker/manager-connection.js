// Native Manager: external browser approval + PKCE, fixed read-only scope.
// Only hashes of bearer tokens/codes persist. No checkout/provider side effects.
import {resolveAdminSession} from './admin-passkeys.js';
import {prepareDataset} from './tax-dataset-stream.js';
import {prepareTaxDatasetV3} from './tax-ready-dataset-v3.js';

const ORIGINS=new Set(['https://admin.disorder119.com','http://localhost:8765','http://127.0.0.1:8765']);
const SCOPE='shop_dataset_read';
const B64=/^[A-Za-z0-9_-]{43}$/;
const encoder=new TextEncoder();
const random=()=>btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const digest=async value=>{const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(value)));return btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');};
const date=(now,seconds)=>new Date(now.getTime()+seconds*1000).toISOString();
const fail=(code,status=400)=>{const e=new Error(code);e.status=status;throw e;};
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
export function isManagerRoute(url){return url.pathname.startsWith('/manager/')||url.pathname.startsWith('/admin/manager/');}

export function validRedirect(value){
 if(typeof value!=='string'||!/^http:\/\/127\.0\.0\.1:[1-9]\d{3,4}\/callback$/.test(value))return false;
 const port=Number(value.split(':')[2].split('/')[0]);return port>=1024&&port<=65535;
}
async function body(request){
 if(!/^application\/json(?:;|$)/i.test(request.headers.get('Content-Type')||''))fail('MANAGER_JSON_REQUIRED',415);
 const reader=request.body?.getReader();if(!reader)fail('MANAGER_BODY_REQUIRED');
 let size=0;const parts=[];
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>4096){await reader.cancel();fail('MANAGER_BODY_TOO_LARGE',413);}parts.push(value);}}finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const p of parts){bytes.set(p,offset);offset+=p.length;}
 try{const v=JSON.parse(new TextDecoder().decode(bytes));if(!v||typeof v!=='object'||Array.isArray(v))fail('MANAGER_BODY_INVALID');return v;}catch{fail('MANAGER_BODY_INVALID');}
}
async function rate(request,env,key){
 if(!env.RATE_LIMITER?.limit)fail('MANAGER_RATE_LIMIT_UNAVAILABLE',503);
 const ip=request.headers.get('CF-Connecting-IP')||'local';
 for(const bucket of ['manager:'+key+':'+ip,'manager:'+key+':global'])if(!(await env.RATE_LIMITER.limit({key:bucket}))?.success)fail('MANAGER_RATE_LIMITED',429);
}
async function owner(request,env){
 if(!ORIGINS.has(request.headers.get('Origin')))fail('MANAGER_ADMIN_ORIGIN_FORBIDDEN',403);
 const session=await resolveAdminSession(request,env);if(!session?.passkeyId)fail('MANAGER_PASSKEY_REQUIRED',401);
 return session;
}
async function grant(request,env,now){
 const value=request.headers.get('Authorization')||'';
 if(!/^Bearer [A-Za-z0-9_-]{43}$/.test(value))fail('MANAGER_CONNECTION_REQUIRED',401);
 const row=await env.DB.prepare(`SELECT g.id,g.device_name,g.scope,g.expires_at FROM manager_dataset_grants g JOIN admin_passkeys p ON p.id=g.passkey_id WHERE g.token_hash=? AND g.revoked_at IS NULL AND p.revoked_at IS NULL AND g.expires_at>?`).bind(await digest(value.slice(7)),now.toISOString()).first();
 if(!row||row.scope!==SCOPE)fail('MANAGER_CONNECTION_EXPIRED',401);return row;
}

export async function handleManagerConnection(request,env,url){
 try{
  if(!env.DB)fail('MANAGER_UNAVAILABLE',503);
  const path=url.pathname,now=new Date(),stamp=now.toISOString();
  if(path.startsWith('/admin/manager/')){
   // Independent auth, before central admin routing replaces the bearer.
   if(!ORIGINS.has(request.headers.get('Origin')))fail('MANAGER_ADMIN_ORIGIN_FORBIDDEN',403);
   if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{'Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type'}});
   const session=await owner(request,env);
   if(path==='/admin/manager/grants'&&request.method==='GET'){
    const grants=(await env.DB.prepare(`SELECT g.id,g.device_name,g.scope,g.created_at,g.expires_at,g.revoked_at,p.revoked_at AS owner_revoked_at FROM manager_dataset_grants g JOIN admin_passkeys p ON p.id=g.passkey_id ORDER BY g.created_at DESC LIMIT 100`).all()).results;
    return json({grants});
   }
   if(path==='/admin/manager/revoke'&&request.method==='POST'){
    const v=await body(request);if(!B64.test(v.id||''))fail('MANAGER_ID_INVALID');
    await env.DB.prepare('UPDATE manager_dataset_grants SET revoked_at=? WHERE id=? AND revoked_at IS NULL').bind(stamp,v.id).run();return json({revoked:true});
   }
   if(path==='/admin/manager/request'&&request.method==='GET'){
    const id=url.searchParams.get('id');if(!B64.test(id||''))fail('MANAGER_ID_INVALID');
    const row=await env.DB.prepare('SELECT id,device_name,expires_at,code_hash,denied_at,used_at FROM manager_auth_requests WHERE id=? AND expires_at>?').bind(id,stamp).first();
    if(!row||row.code_hash||row.denied_at||row.used_at)fail('MANAGER_REQUEST_EXPIRED',410);
    return json({id:row.id,device_name:row.device_name,expires_at:row.expires_at,scope:SCOPE});
   }
   if(path==='/admin/manager/approve'&&request.method==='POST'){
    await rate(request,env,'approve');const v=await body(request);
    if(!B64.test(v.id||'')||v.confirm!==true)fail('MANAGER_CONFIRM_REQUIRED');
    const row=await env.DB.prepare('SELECT * FROM manager_auth_requests WHERE id=? AND expires_at>? AND denied_at IS NULL AND used_at IS NULL AND code_hash IS NULL').bind(v.id,stamp).first();
    if(!row||!validRedirect(row.redirect_uri))fail('MANAGER_REQUEST_EXPIRED',410);
    const code=random();const result=await env.DB.prepare('UPDATE manager_auth_requests SET approved_by=?,code_hash=?,code_expires_at=? WHERE id=? AND expires_at>? AND code_hash IS NULL AND denied_at IS NULL AND used_at IS NULL').bind(session.passkeyId,await digest(code),date(now,60),v.id,stamp).run();
    if(result.meta.changes!==1)fail('MANAGER_REQUEST_USED',409);
    const callback=new URL(row.redirect_uri);callback.searchParams.set('code',code);callback.searchParams.set('state',row.state);
    return json({callback_uri:callback.href});
   }
   if(path==='/admin/manager/deny'&&request.method==='POST'){
    const v=await body(request);if(!B64.test(v.id||''))fail('MANAGER_ID_INVALID');
    await env.DB.prepare('UPDATE manager_auth_requests SET denied_at=? WHERE id=? AND code_hash IS NULL AND used_at IS NULL AND denied_at IS NULL').bind(stamp,v.id).run();return json({denied:true});
   }
   fail('MANAGER_ROUTE_NOT_ALLOWED',405);
  }
  // Native client endpoints never accept browser cookies or admin bearers.
  if(request.headers.has('Origin'))fail('MANAGER_NATIVE_CLIENT_REQUIRED',403);
  if(path==='/manager/authorize'&&request.method==='POST'){
   await rate(request,env,'authorize');const v=await body(request);
   if(!validRedirect(v.redirect_uri)||!B64.test(v.state||'')||!B64.test(v.code_challenge||'')||v.code_challenge_method!=='S256')fail('MANAGER_AUTH_INVALID');
   if(typeof v.device_name!=='string'||!v.device_name.trim()||v.device_name.length>60||/[\x00-\x1f\x7f]/.test(v.device_name))fail('MANAGER_NAME_INVALID');
   const id=random(),expires=date(now,600);
   // Bound retained unauthenticated requests. This only removes expired auth rows.
   await env.DB.prepare('DELETE FROM manager_auth_requests WHERE expires_at<? AND NOT EXISTS(SELECT 1 FROM manager_dataset_grants g WHERE g.request_id=manager_auth_requests.id)').bind(date(now,-86400)).run();
   const count=await env.DB.prepare('SELECT COUNT(*) AS n FROM manager_auth_requests WHERE expires_at>?').bind(stamp).first();if(count.n>=1000)fail('MANAGER_REQUEST_LIMIT',429);
   await env.DB.prepare('INSERT INTO manager_auth_requests(id,device_name,redirect_uri,state,challenge,created_at,expires_at) VALUES(?,?,?,?,?,?,?)').bind(id,v.device_name.trim(),v.redirect_uri,v.state,v.code_challenge,stamp,expires).run();
   return json({request_id:id,authorization_uri:'https://admin.disorder119.com/#manager='+id,expires_at:expires,scope:SCOPE},201);
  }
  if(path==='/manager/token'&&request.method==='POST'){
   await rate(request,env,'token');const v=await body(request);
   if(!B64.test(v.code||'')||!B64.test(v.code_verifier||'')||!validRedirect(v.redirect_uri))fail('MANAGER_CODE_INVALID',401);
   const row=await env.DB.prepare('SELECT * FROM manager_auth_requests WHERE code_hash=? AND code_expires_at>? AND expires_at>? AND used_at IS NULL AND denied_at IS NULL').bind(await digest(v.code),stamp,stamp).first();
   if(!row||row.redirect_uri!==v.redirect_uri||row.challenge!==await digest(v.code_verifier))fail('MANAGER_CODE_INVALID',401);
   const token=random(),id=random(),expires=date(now,90*86400);
   // D1 batch is transactional. The conditional insert claims the single-use
   // request; concurrent exchanges cannot create or return a second grant.
   const result=await env.DB.batch([
    env.DB.prepare(`INSERT INTO manager_dataset_grants(id,request_id,token_hash,passkey_id,device_name,scope,created_at,expires_at) SELECT ?,r.id,?,r.approved_by,r.device_name,?,?,? FROM manager_auth_requests r JOIN admin_passkeys p ON p.id=r.approved_by WHERE r.id=? AND r.used_at IS NULL AND r.denied_at IS NULL AND r.code_expires_at>? AND r.expires_at>? AND p.revoked_at IS NULL AND (SELECT COUNT(*) FROM manager_dataset_grants WHERE revoked_at IS NULL AND expires_at>?)<20`).bind(id,await digest(token),SCOPE,stamp,expires,row.id,stamp,stamp,stamp),
    env.DB.prepare('UPDATE manager_auth_requests SET used_at=? WHERE id=? AND used_at IS NULL AND EXISTS(SELECT 1 FROM manager_dataset_grants WHERE id=? AND request_id=?)').bind(stamp,row.id,id,row.id)
   ]);
   if(result[0].meta.changes!==1||result[1].meta.changes!==1)fail('MANAGER_CODE_USED_OR_LIMIT',409);
   return json({access_token:token,token_type:'Bearer',scope:SCOPE,expires_at:expires,grant_id:id});
  }
  const access=await grant(request,env,now);
  if(path==='/manager/status'&&request.method==='GET')return json({connected:true,scope:access.scope,expires_at:access.expires_at,grant_id:access.id});
  if(path==='/manager/disconnect'&&request.method==='POST'){
   await env.DB.prepare('UPDATE manager_dataset_grants SET revoked_at=? WHERE id=? AND revoked_at IS NULL').bind(stamp,access.id).run();return json({revoked:true});
  }
  if(path==='/manager/dataset.zip'&&request.method==='GET'){
   await rate(request,env,'dataset');const value=url.searchParams.get('jahr');
   if(!/^20\d{2}$/.test(value||'')||Number(value)<2020||Number(value)>now.getUTCFullYear()+1)fail('MANAGER_YEAR_INVALID');
   const format=url.searchParams.get('format')||'v2';
   if(!['v2','v3'].includes(format))fail('MANAGER_FORMAT_INVALID');
   const dataset=await (format==='v3'?prepareTaxDatasetV3:prepareDataset)(env,Number(value));
   return new Response(dataset.stream(),{headers:{'Content-Type':'application/zip','Content-Disposition':`attachment; filename="disorder119-shop-${value}.zip"`,'Cache-Control':'no-store'}});
  }
  fail('MANAGER_ROUTE_NOT_ALLOWED',405);
 }catch(e){return json({error:e.status?e.message:'MANAGER_SERVICE_UNAVAILABLE'},e.status||503);}
}

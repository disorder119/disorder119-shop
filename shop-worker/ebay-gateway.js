// eBay developer onboarding: isolated HTTPS return and authenticated privacy inbox.
// Protocol: https://developer.ebay.com/develop/guides/sell/marketplace-user-account-deletion
// Signature serialization/digest follows eBay/event-notification-nodejs-sdk.
// Seller tokens stay on the PC. This service only requests an application token
// to obtain eBay's notification verification keys. No order/listing API calls.
import { privacyDeadline } from './admin-privacy.js';
import { authorizeAdminRequest } from './backend-runtime.js';

export const EBAY_ENDPOINT = 'https://api.disorder119.com/ebay/account-deletion';
export const EBAY_RETURN = 'https://api.disorder119.com/ebay/return';
const enc = new TextEncoder();
// eBay documents notificationId as an opaque string, not a UUID constraint.
const validNoticeId=value=>typeof value==='string'&&value.length>0&&value.length<=256&&value.trim()===value&&!/[\x00-\x1f\x7f]/.test(value);
const cache = new Map();
const secureHeaders = {
  'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
};
const fail = (code, status = 400) => { const e = new Error(code); e.status = status; throw e; };
const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { ...secureHeaders, 'Content-Type': 'application/json; charset=utf-8' },
});
const b64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const unb64 = text => {
  if (typeof text !== 'string' || !text || text.length > 16384 || !/^[A-Za-z0-9+/]*={0,2}$/.test(text)) fail('EBAY_SIGNATURE_INVALID', 412);
  try { return Uint8Array.from(atob(text), c => c.charCodeAt(0)); }
  catch { fail('EBAY_SIGNATURE_INVALID', 412); }
};
const hex = bytes => Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
export const sha256 = async text => hex(await crypto.subtle.digest('SHA-256', enc.encode(text)));

const returnScript = `(()=>{
const link=location.href,q=new URL(link).searchParams;
history.replaceState(null,'',location.pathname);
const good=q.getAll('code').length===1&&q.getAll('state').length===1&&!q.has('error')&&q.get('code')&&q.get('state');
document.getElementById('status').textContent=good?'Freigabe erhalten – im Manager abschließen':'Keine erfolgreiche Freigabe erhalten';
document.getElementById('hint').textContent=good?'Diesen Link im Disorder Manager bei eBay → Freigabe-Link einfügen. Erst dort wird er geprüft und gegen Tokens getauscht.':'Starte die Verkäuferanmeldung im Manager erneut.';
const field=document.getElementById('link'),button=document.getElementById('copy');
if(good){field.value=link;field.hidden=false;button.hidden=false;button.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(link);button.textContent='Link kopiert';}catch{field.select();button.textContent='Link markieren und kopieren';}});}
})();`;
const returnStyle = 'body{margin:0;background:#090909;color:#f5f5f5;font:16px system-ui;line-height:1.6}main{max-width:660px;margin:12vh auto;padding:32px;border:1px solid #333;border-radius:18px}small{letter-spacing:.15em}h1{font-size:28px}textarea{box-sizing:border-box;width:100%;background:#151515;color:white;border:1px solid #555;padding:14px;margin:16px 0}button{padding:14px 24px;border:0;border-radius:8px;font:inherit;font-weight:700;cursor:pointer}a{color:#ccc}p{color:#bbb}[hidden]{display:none}';

async function returnPage(request) {
  if (request.method !== 'GET') fail('METHOD_NOT_ALLOWED', 405);
  // No reflected input, third-party assets, analytics, cookies or token exchange.
  // Hash-authorized inline script clears the code from visible/history URL.
  const hash = async text => b64(await crypto.subtle.digest('SHA-256', enc.encode(text)));
  return new Response(`<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>eBay-Freigabe · Disorder119</title><style>${returnStyle}</style><main><small>DISORDER119 MANAGER · EBAY</small><h1 id="status">Freigabe prüfen</h1><p id="hint">Zum Abschluss brauchst du den Disorder Manager. Ohne JavaScript kannst du den vollständigen Link aus der Adresszeile übernehmen.</p><textarea id="link" rows="4" readonly hidden aria-label="Freigabe-Link"></textarea><button id="copy" hidden>Freigabe-Link kopieren</button><p>Dein Verkäuferzugang wird lokal auf deinem PC gespeichert.</p><a href="https://disorder119.com/datenschutz/" rel="noreferrer">Datenschutz</a></main><script>${returnScript}</script></html>`, {
    headers: { ...secureHeaders, 'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': `default-src 'none'; script-src 'sha256-${await hash(returnScript)}'; style-src 'sha256-${await hash(returnStyle)}'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'; connect-src 'none'`,
    },
  });
}

async function rate(request, env, scope) {
  if (!env.RATE_LIMITER?.limit) fail('EBAY_RATE_LIMIT_UNAVAILABLE', 503);
  if (!(await env.RATE_LIMITER.limit({ key: 'ebay:' + scope + ':' + (request.headers.get('CF-Connecting-IP') || 'unknown') }))?.success) fail('RATE_LIMITED', 429);
}
async function boundedBytes(response, limit, timeout = 4000) {
  if (Number(response.headers.get('Content-Length') || 0) > limit) fail('EBAY_BODY_TOO_LARGE', 413);
  const reader = response.body?.getReader(); if (!reader) return new Uint8Array();
  let size = 0, timer; const parts = [];
  const expired = new Promise((_, reject) => { timer = setTimeout(() => { reject(Object.assign(new Error('EBAY_BODY_TIMEOUT'), {status:408})); reader.cancel().catch(() => {}); }, timeout); });
  try {
    while (true) {
      const {done, value} = await Promise.race([reader.read(), expired]); if (done) break;
      size += value.length; if (size > limit) { await reader.cancel(); fail('EBAY_BODY_TOO_LARGE', 413); } parts.push(value);
    }
  } finally { clearTimeout(timer); reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; } return bytes;
}
async function providerJson(url, options, fetcher, stage) {
  let response;const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),4000);
  try { response = await fetcher(url, {...options, headers:{'User-Agent':'Disorder119-Notification-Gateway/1.0',...options.headers}, redirect:'manual', signal:controller.signal}); }
  catch(e) { fail('EBAY_'+stage+'_TRANSPORT_'+(['TypeError','TimeoutError','AbortError'].includes(e.name)?e.name.toUpperCase():'ERROR'), 503); }
  finally {clearTimeout(timer);}
  if (!response.ok) fail('EBAY_'+stage+'_HTTP_'+response.status, 503);
  try { return JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(await boundedBytes(response, 16384))); }
  catch { fail('EBAY_'+stage+'_RESPONSE_INVALID', 503); }
}
async function publicKey(kid, env, fetcher, now) {
  if (!env.EBAY_CLIENT_ID || !env.EBAY_CLIENT_SECRET) fail('EBAY_NOTIFICATION_KEYS_NOT_CONFIGURED', 503);
  const identity = env.EBAY_CLIENT_ID;
  let state = cache.get(identity);
  if (!state) { if (cache.size >= 4) cache.delete(cache.keys().next().value); state={keys:new Map()}; cache.set(identity,state); }
  const cached = state.keys.get(kid);
  if (cached?.until > now) return cached.value;
  if (!(await env.RATE_LIMITER.limit({key:'ebay:public-key:global'}))?.success) fail('RATE_LIMITED',429);
  if (!state.token || state.until <= now + 120000) {
    const token = await providerJson('https://api.ebay.com/identity/v1/oauth2/token', {
      method:'POST', headers:{'Authorization':'Basic '+btoa(identity+':'+env.EBAY_CLIENT_SECRET),'Content-Type':'application/x-www-form-urlencoded'},
      body:new URLSearchParams({grant_type:'client_credentials',scope:'https://api.ebay.com/oauth/api_scope'}).toString(),
    }, fetcher, 'TOKEN');
    if (typeof token.access_token !== 'string' || !token.access_token || /[\r\n]/.test(token.access_token) || !Number.isFinite(token.expires_in) || token.expires_in <= 120) fail('EBAY_TOKEN_RESPONSE_INVALID',503);
    state.token=token.access_token; state.until=now+token.expires_in*1000;
  }
  const key = await providerJson('https://api.ebay.com/commerce/notification/v1/public_key/'+encodeURIComponent(kid), {
    headers:{Authorization:'Bearer '+state.token,Accept:'application/json'},
  },fetcher, 'PUBLIC_KEY');
  if (typeof key.key !== 'string' || key.key.length>4096) fail('EBAY_PUBLIC_KEY_INVALID',503);
  if (state.keys.size >= 100) state.keys.delete(state.keys.keys().next().value);
  state.keys.set(kid,{value:key.key,until:now+3600000}); return key.key;
}

// ASN.1 ECDSA DER signature -> WebCrypto IEEE P1363, strict length/integer bounds.
export function derSignature(bytes, width) {
  let i=0;
  const length=()=>{let n=bytes[i++];if(n===undefined)fail('EBAY_SIGNATURE_INVALID',412);if(n<128)return n;
    const count=n&127;if(count<1||count>2||i+count>bytes.length)fail('EBAY_SIGNATURE_INVALID',412);
    n=0;for(let j=0;j<count;j++)n=n*256+bytes[i++];return n;};
  if(bytes[i++]!==0x30)fail('EBAY_SIGNATURE_INVALID',412);const total=length();if(total!==bytes.length-i)fail('EBAY_SIGNATURE_INVALID',412);
  const result=new Uint8Array(width*2);
  for(let part=0;part<2;part++){
    if(bytes[i++]!==0x02)fail('EBAY_SIGNATURE_INVALID',412);const count=length();if(!count||i+count>bytes.length||bytes[i]&128)fail('EBAY_SIGNATURE_INVALID',412);
    let start=i,end=i+count;i=end;
    if(bytes[start]===0&&count>1){if(!(bytes[start+1]&128))fail('EBAY_SIGNATURE_INVALID',412);start++;}
    if(end-start>width)fail('EBAY_SIGNATURE_INVALID',412);result.set(bytes.slice(start,end),part*width+width-(end-start));
  }
  if(i!==bytes.length)fail('EBAY_SIGNATURE_INVALID',412);return result;
}
async function verify(message, raw, header, env, fetcher, now) {
  if (!header || header.length > 2048) fail('EBAY_SIGNATURE_INVALID',412);
  let signature;
  try {signature=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(unb64(header)));} catch {fail('EBAY_SIGNATURE_INVALID',412);}
  if (!signature || !/^[A-Za-z0-9_-]{1,128}$/.test(signature.kid || '') || typeof signature.signature !== 'string') fail('EBAY_SIGNATURE_INVALID',412);
  if ((signature.alg && !/^ECDSA$/i.test(signature.alg)) || (signature.digest && !/^SHA-?1$/i.test(signature.digest))) fail('EBAY_SIGNATURE_INVALID',412);
  const sig=unb64(signature.signature);
  const pem=await publicKey(signature.kid,env,fetcher,now);
  const keyBytes=unb64(pem.replace(/-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----|\s/g,''));
  let key,width;
  for (const [curve,size] of [['P-256',32],['P-384',48],['P-521',66]]) {
    try {key=await crypto.subtle.importKey('spki',keyBytes,{name:'ECDSA',namedCurve:curve},false,['verify']);width=size;break;} catch {}
  }
  if(!key)fail('EBAY_PUBLIC_KEY_INVALID',503);
  // eBay's official SDK specifies ssl3-sha1 (SHA-1 with ECDSA), not SHA-256.
  const normalized=derSignature(sig,width),options={name:'ECDSA',hash:'SHA-1'};
  // Manual/Java guidance signs original bytes; the official Node SDK signs
  // JSON.stringify(message). Accept either authenticated representation, never
  // unauthenticated content or an algorithm selected by the request.
  const canonical=JSON.stringify(message);
  if(!await crypto.subtle.verify(options,key,normalized,enc.encode(raw)) &&
      (raw===canonical||!await crypto.subtle.verify(options,key,normalized,enc.encode(canonical))))fail('EBAY_SIGNATURE_INVALID',412);
}
function notification(message, now) {
  const n=message?.notification;
  if(message?.metadata?.topic!=='MARKETPLACE_ACCOUNT_DELETION')fail('EBAY_NOTIFICATION_TOPIC_INVALID');
  if(message.metadata.schemaVersion!=='1.0'||message.metadata.deprecated===true)fail('EBAY_NOTIFICATION_SCHEMA_INVALID');
  if(!validNoticeId(n?.notificationId))fail('EBAY_NOTIFICATION_ID_INVALID');
  for(const field of ['eventDate','publishDate'])if(typeof n[field]!=='string'||!Number.isFinite(Date.parse(n[field]))||Date.parse(n[field])>now+300000)fail('EBAY_NOTIFICATION_DATE_INVALID');
  // Delivery counters can start at zero on the initial/test publication.
  if(!Number.isInteger(n.publishAttemptCount)||n.publishAttemptCount<0)fail('EBAY_NOTIFICATION_ATTEMPT_INVALID');
  if(!n.data||typeof n.data!=='object'||Array.isArray(n.data))fail('EBAY_NOTIFICATION_DATA_INVALID');
  const data={};for(const field of ['username','userId','eiasToken']) {
    if(n.data[field]!==undefined){if(typeof n.data[field]!=='string'||!n.data[field]||n.data[field].length>2048||/[\x00-\x1f\x7f]/.test(n.data[field]))fail('EBAY_NOTIFICATION_IDENTITY_INVALID');data[field]=n.data[field];}
  }
  if(!Object.keys(data).length)fail('EBAY_NOTIFICATION_IDENTITY_MISSING');
  return {id:n.notificationId,eventDate:new Date(n.eventDate).toISOString(),data};
}
async function encryptNotice(value, publicPem) {
  if(typeof publicPem!=='string'||!publicPem.includes('BEGIN PUBLIC KEY'))fail('EBAY_PRIVACY_VAULT_NOT_CONFIGURED',503);
  let rsa;
  try {rsa=await crypto.subtle.importKey('spki',unb64(publicPem.replace(/-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----|\s/g,'')),{name:'RSA-OAEP',hash:'SHA-256'},false,['encrypt']);}
  catch {fail('EBAY_PRIVACY_VAULT_NOT_CONFIGURED',503);}
  if(rsa.algorithm.modulusLength<2048)fail('EBAY_PRIVACY_VAULT_NOT_CONFIGURED',503);
  const key=await crypto.subtle.generateKey({name:'AES-GCM',length:256},true,['encrypt']);
  const iv=crypto.getRandomValues(new Uint8Array(12)),aad='disorder119-ebay-privacy-v1:'+value.id;
  const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:enc.encode(aad)},key,enc.encode(JSON.stringify(value)));
  return JSON.stringify({version:1,key:b64(await crypto.subtle.encrypt('RSA-OAEP',rsa,await crypto.subtle.exportKey('raw',key))),iv:b64(iv),ciphertext:b64(ciphertext)});
}

export function isEbayRoute(url) {return ['/ebay/return','/ebay/account-deletion','/admin/ebay/privacy-requests'].includes(url.pathname);}
export async function handleEbayGateway(request,env,url=new URL(request.url),{fetcher=globalThis.fetch.bind(globalThis),now=Date.now()}={}) {
  try {
    if(url.pathname==='/ebay/return')return await returnPage(request);
    if(url.pathname==='/admin/ebay/privacy-requests'){
      const origin=request.headers.get('Origin');
      if(origin&&!['https://admin.disorder119.com','http://localhost:8765','http://127.0.0.1:8765'].includes(origin))fail('ORIGIN_NOT_ALLOWED',403);
      const reply=value=>{const response=json(value);if(origin)response.headers.set('Access-Control-Allow-Origin',origin);response.headers.set('Vary','Origin');return response;};
      if(!['GET','POST'].includes(request.method))fail('METHOD_NOT_ALLOWED',405);
      await authorizeAdminRequest(request,env,'OWNER');
      if(!env.DB)fail('EBAY_PRIVACY_VAULT_NOT_CONFIGURED',503);
      if(request.method==='POST'){
        if(!/^application\/json(?:;|$)/i.test(request.headers.get('Content-Type')||''))fail('CONTENT_TYPE_REQUIRED',415);
        let body;
        try{body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await boundedBytes(request,4096)));}
        catch(e){if(e.status)throw e;fail('INVALID_JSON');}
        if(!body||body.confirm!==true||!validNoticeId(body.id)||!['DELETED','NO_DATA','LEGAL_RETENTION'].includes(body.action)||typeof body.note!=='string'||body.note.trim().length<30||body.note.length>2000||/[\x00-\x1f]/.test(body.note))fail('EBAY_PRIVACY_REVIEW_REQUIRED');
        // Explicit owner attestation after local review; this does not pretend
        // to erase data on an offline PC. Keep no identities after resolution.
        const result=await env.DB.prepare("UPDATE ebay_privacy_notifications SET status=?,resolved_at=?,resolution_note=?,envelope='' WHERE id=? AND status='PENDING'")
          .bind(body.action,new Date(now).toISOString(),body.note.trim(),body.id).run();
        if(result.meta.changes!==1)fail('EBAY_PRIVACY_REQUEST_CLOSED_OR_UNKNOWN',409);
        return reply({resolved:true,status:body.action});
      }
      const result=await env.DB.prepare('SELECT id,event_at,received_at,deadline,status,envelope FROM ebay_privacy_notifications WHERE status=\'PENDING\' ORDER BY received_at LIMIT 200').all();
      return reply({schema:'disorder119.ebay.privacy.v1',requests:result.results||[],next:'Import into local Manager; identify matching eBay data and document deletion or specific legal retention. Receipt is not completion.'});
    }
    if(url.pathname!=='/ebay/account-deletion')fail('NOT_FOUND',404);
    if(url.origin+url.pathname!==EBAY_ENDPOINT)fail('EBAY_ENDPOINT_INVALID',400);
    if(!['GET','POST'].includes(request.method))fail('METHOD_NOT_ALLOWED',405);
    await rate(request,env,'notification');
    if(!/^[A-Za-z0-9_-]{32,80}$/.test(env.EBAY_VERIFICATION_TOKEN||''))fail('EBAY_NOTIFICATION_NOT_CONFIGURED',503);
    if(request.method==='GET'){
      const codes=url.searchParams.getAll('challenge_code');
      if(codes.length!==1||!/^[A-Za-z0-9_-]{1,512}$/.test(codes[0]))fail('EBAY_CHALLENGE_INVALID');
      // Fail closed until *both* receipt verification and durable encrypted
      // storage are configured. A successful GET alone is not compliance.
      if(!env.EBAY_CLIENT_ID||!env.EBAY_CLIENT_SECRET||!env.EBAY_PRIVACY_PUBLIC_KEY||!env.DB)fail('EBAY_NOTIFICATION_NOT_CONFIGURED',503);
      await env.DB.prepare('SELECT id FROM ebay_privacy_notifications LIMIT 1').first();
      return json({challengeResponse:await sha256(codes[0]+env.EBAY_VERIFICATION_TOKEN+EBAY_ENDPOINT)});
    }
    if(request.headers.has('Origin'))fail('EBAY_SERVER_NOTIFICATION_REQUIRED',403);
    if(!/^application\/json(?:;|$)/i.test(request.headers.get('Content-Type')||''))fail('CONTENT_TYPE_REQUIRED',415);
    let message,raw;
    try {raw=new TextDecoder('utf-8',{fatal:true}).decode(await boundedBytes(request,32768));message=JSON.parse(raw);}
    catch(e){if(e.status)throw e;fail('EBAY_NOTIFICATION_INVALID');}
    await verify(message,raw,request.headers.get('X-EBAY-SIGNATURE'),env,fetcher,now);
    const notice=notification(message,now);
    if(!env.DB)fail('EBAY_PRIVACY_VAULT_NOT_CONFIGURED',503);
    const envelope=await encryptNotice(notice,env.EBAY_PRIVACY_PUBLIC_KEY);
    // Unique notification ID gives idempotent receipt. Never acknowledge before
    // the database commit; outage/missing migration causes retry, not lost mail.
    await env.DB.prepare(`INSERT INTO ebay_privacy_notifications(id,event_at,received_at,deadline,status,envelope)
      VALUES(?,?,?,?, 'PENDING',?) ON CONFLICT(id) DO NOTHING`).bind(notice.id,notice.eventDate,new Date(now).toISOString(),privacyDeadline(notice.eventDate),envelope).run();
    // eBay permits 200/201/202/204. A JSON 200 also works with portal clients
    // that mishandle a successful empty 204 body. Receipt is not resolution.
    return json({received:true});
  } catch(e) {
    const code=e.status?(e.code||e.message):'EBAY_GATEWAY_UNAVAILABLE';
    // Diagnose the live protocol without logging identity, headers or query/code.
    console.warn(JSON.stringify({event:'ebay_gateway_failure',status:e.status||503,
      code:/^[A-Z][A-Z_0-9]{1,80}$/.test(code)?code:'EBAY_GATEWAY_UNAVAILABLE',
      exception:e.name==='NotSupportedError'?'NotSupportedError':undefined}));
    return json({error:code},e.status||503);
  }
}

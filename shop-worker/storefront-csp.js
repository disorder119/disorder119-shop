// Authorize reviewed bootstrap code and pure JSON configuration, never arbitrary
// inline JavaScript received from the static origin. New articles need no redeploy.
const DATA_NAMES = new Set(['SHOP_CONFIG','ARTICLE_ITEM','ARTICLE_LANG','ARTICLE_SHOP_CONFIG','KASSE_LANG','WIDERRUF_TEXT']);
const FIXED_HASHES = new Set([
  'sha256-bCuO5JFhkyLtkKoL9Ps6dHom6f9P1EWw2y75rmDKHoo=',
  'sha256-hmyGpgHLPqCvglJ5auzrKVgtLQE0Plc0C7xWioeGDts=',
  'sha256-adB3ntKA48b1299SdcHAjgBM7WhtN/c2X23gzk/Tagw=',
  'sha256-MURkrZQ80ZiFRpks5SsuCmLixZM48+sYmB+gmGxiaNo=',
  'sha256-wDhdVYQT+G+8RpdwzF2cann5fSlD07dD8GFtl8iA6uU=',
  // Canonical German rental terms; English and French are covered above.
  'sha256-COC97sYN8yQat/31P5cwDA3oKJ/A28TYJzRHLOhjmNg=',
]);
const BOOT_FILES = new Set(['app.js','catalog-filter-simplify.js','archiv-navigation.js','rental-v2.js','rental-v2-ui.js','rental-v2-picker.js']);
const BOOT_PREFIX = '/* FOCUS3_MOBILE_RUNTIME_AFTER_LCP */(function(){var s=';
const BOOT_SUFFIX = ',i=0,started=false;function next(){if(i>=s.length)return;var e=document.createElement("script");e.src=s[i++];e.onload=next;e.onerror=next;document.body.appendChild(e);}function boot(){if(started)return;started=true;next();}function later(){setTimeout(boot,180);}if(document.readyState==="complete")later();else window.addEventListener("load",later,{once:true});})();';
export const MAX_HTML_BYTES = 2 * 1024 * 1024;
const MAX_INLINE = 65536;

export async function scriptHash(text) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text.replace(/\r\n?/g,'\n'))));
  return 'sha256-'+btoa(String.fromCharCode(...bytes));
}

function safeJson(value, depth=0) {
  if(depth>40)return false;
  if(!value || typeof value!=='object')return true;
  return Object.entries(value).every(([key,child])=>!['__proto__','constructor','prototype'].includes(key) && safeJson(child,depth+1));
}

// Find a JSON boundary without executing code or accepting a JavaScript object
// expression (functions, calls, interpolation and property getters are rejected).
function jsonEnd(text,start) {
  let depth=0,quoted=false,escape=false;
  for(let i=start;i<text.length;i++) {
    const c=text[i];
    if(quoted) { if(escape)escape=false;else if(c==='\\')escape=true;else if(c==='"')quoted=false;continue; }
    if(c==='"'){quoted=true;continue;}
    if(c==='{'||c==='[')depth++;
    else if(c==='}'||c===']')depth--;
    else if(c===';'&&depth===0)return i;
    if(depth<0)return -1;
  }
  return quoted||depth!==0 ? -1 : text.length;
}

export function isDataScript(text) {
  if(!text || text.length>MAX_INLINE)return false;
  let rest=text.trim(),count=0;
  while(rest) {
    const assignment=/^window\.([A-Z_]+)\s*=\s*/.exec(rest);
    if(!assignment || !DATA_NAMES.has(assignment[1]))return false;
    const end=jsonEnd(rest,assignment[0].length);
    if(end<0)return false;
    try { if(!safeJson(JSON.parse(rest.slice(assignment[0].length,end).trim())))return false; } catch { return false; }
    count++;
    rest=rest.slice(end+(rest[end]===';'?1:0)).trim();
    if(count>8)return false;
  }
  return count>0;
}

export function isBootstrapScript(text) {
  if(!text.startsWith(BOOT_PREFIX)||!text.endsWith(BOOT_SUFFIX)||text.length>4096)return false;
  try {
    const files=JSON.parse(text.slice(BOOT_PREFIX.length,-BOOT_SUFFIX.length));
    return Array.isArray(files)&&files.length>0&&files.length<=BOOT_FILES.size&&files.every(path=>{
      const match=/^\/assets\/([a-z0-9-]+\.js)(?:\?v=[a-f0-9]{1,40})?$/.exec(path);
      return match&&BOOT_FILES.has(match[1]);
    });
  } catch { return false; }
}

export async function inlineScriptHashes(html) {
  const hashes=new Set();
  // Advance monotonically: malformed repeated start tags must not trigger
  // regular-expression backtracking over the complete HTML body.
  const lower=html.toLowerCase();let position=0;
  while(position<html.length) {
    const start=lower.indexOf('<script',position);
    if(start<0)break;
    position=start+7;
    if(!/[\s/>]/.test(lower[position]||''))continue;
    const tagEnd=lower.indexOf('>',position);
    if(tagEnd<0)break;
    const end=lower.indexOf('</script',tagEnd+1);
    if(end<0)break;
    const closeEnd=lower.indexOf('>',end+8);
    if(closeEnd<0)break;
    const attrs=html.slice(position,tagEnd);
    const source=html.slice(tagEnd+1,end);
    position=closeEnd+1;
    if(/\bsrc\s*=/i.test(attrs)||/\btype\s*=\s*["']application\/(?:ld\+)?json["']/i.test(attrs))continue;
    if(source.length>MAX_INLINE)continue;
    const hash=await scriptHash(source);
    if(FIXED_HASHES.has(hash)||isDataScript(source)||isBootstrapScript(source))hashes.add(hash);
    if(hashes.size>16)throw new Error('INLINE_SCRIPT_LIMIT');
  }
  return [...hashes];
}

export function paymentSdkUrl(src) {
  try {
    const url=new URL(src);
    return url.protocol==='https:'&&!url.username&&!url.password&&!url.port&&
      (['www.paypal.com','www.sandbox.paypal.com'].includes(url.hostname)&&url.pathname==='/sdk/js');
  } catch { return false; }
}

export function paypalNonceHandler(nonce) {
  return {element(element) {
    if(!paymentSdkUrl(element.getAttribute('src')))return;
    element.setAttribute('nonce',nonce);
    element.setAttribute('data-csp-nonce',nonce);
  }};
}

export function contentSecurityPolicy(hashes=[],nonce='',apiOrigin='https://api.disorder119.com') {
  if(!['https://api.disorder119.com','https://api-test.disorder119.com'].includes(apiOrigin))throw new Error('CSP_API_ORIGIN_INVALID');
  const scripts=["'self'",...hashes.map(hash=>`'${hash}'`),...(nonce?[`'nonce-${nonce}'`]:[]),
    'https://*.paypal.com','https://*.paypalobjects.com','https://applepay.cdn-apple.com','https://challenges.cloudflare.com'];
  return "default-src 'self'; script-src "+scripts.join(' ')+
    "; script-src-attr 'unsafe-hashes' '"+STYLE_HASH+"'; style-src 'self' 'unsafe-inline'; "+
    "img-src 'self' data: https://*.paypal.com https://*.paypalobjects.com https://tile.openstreetmap.org "+apiOrigin+"; "+
    "font-src 'self' data:; connect-src 'self' "+apiOrigin+" https://*.paypal.com https://*.paypalobjects.com https://challenges.cloudflare.com https://apple-pay-gateway.apple.com; "+
    "frame-src https://*.paypal.com https://*.paypalobjects.com https://challenges.cloudflare.com; "+
    "worker-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; upgrade-insecure-requests";
}

// Only the existing, fixed CSS-preload handler remains authorized. There is no
// blanket unsafe-inline permission for scripts or inline event handlers.
const STYLE_HASH = 'sha256-1jAmyYXcRq6zFldLe/GCgIDJBiOONdXjTLgEFMDnDSM=';

export async function boundedHtml(response) {
  const reader=response.body?.getReader();
  if(!reader)return '';
  const chunks=[];let size=0;
  const deadline=Date.now()+10000;
  try {
    while(true) {
      let timer;
      const remaining=deadline-Date.now();
      if(remaining<=0)throw new Error('HTML_TIMEOUT');
      let result;
      try { result=await Promise.race([reader.read(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('HTML_TIMEOUT')),remaining);})]); }
      finally { clearTimeout(timer); }
      if(result.done)break;
      size+=result.value.byteLength;
      if(size>MAX_HTML_BYTES)throw new Error('HTML_TOO_LARGE');
      chunks.push(result.value);
    }
    const bytes=new Uint8Array(size);let offset=0;
    for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
    return new TextDecoder().decode(bytes);
  } catch(error) { reader.cancel().catch(()=>{});throw error; }
  finally { reader.releaseLock(); }
}

export async function secureHtml(response,headers,apiOrigin='https://api.disorder119.com') {
  const html=await boundedHtml(response);
  const hashes=await inlineScriptHashes(html);
  const nonce=btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(18))));
  headers.set('Content-Security-Policy',contentSecurityPolicy(hashes,nonce,apiOrigin));
  headers.delete('Content-Security-Policy-Report-Only');
  for(const name of ['ETag','Last-Modified','Content-Length','Content-Encoding'])headers.delete(name);
  headers.set('Cache-Control','no-store');
  const out=new Response(html,{status:response.status,statusText:response.statusText,headers});
  // Cloudflare's parsed HTML attribute API avoids blessing spoofed src text in
  // another attribute. PayPal propagates this nonce to its generated scripts.
  return typeof HTMLRewriter==='function'
    ? new HTMLRewriter().on('script[src]',paypalNonceHandler(nonce)).transform(out)
    : out;
}

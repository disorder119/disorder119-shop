// Edge route in front of the existing static origin. No database or secrets.
// Catalog source files stay intact in Git; only the public response is filtered.
const PAGES = new Set(['agb','baukasten','cart','chaos','datenschutz','faq','impressum','kasse','konto','match','mieten','newsletter','ueber-uns','universe','widerruf']);
const ROOT_FILES = new Set(['index.html','404.html','offline.html','robots.txt','sitemap.xml','manifest.webmanifest','sw.js','favicon.ico']);
const FIELDS = new Set(['id','article','title','brand','price','price_estimated','public_status','status','category','size','color','condition','brightness','gallery','look','department','product_type','taxonomy_category','size_normalized','rental_price','grid_image','hover_image','foto_hell']);

export function publicPath(pathname) {
  let decoded;
  try { decoded=decodeURIComponent(pathname); } catch { return false; }
  if (/[\\\0]/.test(decoded) || decoded.includes('..') || /%[0-9a-f]{2}/i.test(decoded)) return false;
  const parts=decoded.split('/').filter(Boolean);
  if (parts.some(part=>part.startsWith('.')) && !decoded.startsWith('/.well-known/')) return false;
  if (decoded === '/.well-known/apple-developer-merchantid-domain-association') return true;
  if (decoded.startsWith('/assets/')) return !/\.(?:test|spec)\./i.test(decoded) && /\.(?:js|css|json|png|jpg|jpeg|webp|gif|svg|ico|woff2?|ttf|otf|mp4|webm|avif)$/i.test(decoded);
  if (decoded === '/data/catalog.json' || decoded === '/data/items.json') return true;
  if (parts[0] === 'en' || parts[0] === 'fr') parts.shift();
  if (!parts.length || (parts.length===1 && ROOT_FILES.has(parts[0]))) return true;
  if (parts[0]==='artikel') return /^\d+(?:\.html)?$/.test(parts[1]||'') && (parts.length===2 || (parts.length===3 && parts[2]==='index.html'));
  return PAGES.has(parts[0]) && (parts.length===1 || (parts.length===2 && parts[1]==='index.html'));
}

export function publicCatalog(value) {
  if (!Array.isArray(value)) throw new Error('INVALID_PUBLIC_CATALOG');
  return value.filter(item=>item && ['AVAILABLE','SOLD'].includes(item.public_status))
    .map(item=>Object.fromEntries(Object.entries(item).filter(([key,val])=>FIELDS.has(key) &&
      (val===null || ['string','number','boolean'].includes(typeof val) || (['gallery','size_normalized'].includes(key) && Array.isArray(val) && val.every(x=>typeof x==='string'))))));
}

export function storefrontHeaders(response) {
  const headers=new Headers(response.headers);
  headers.set('Strict-Transport-Security','max-age=31536000; includeSubDomains');
  headers.set('X-Content-Type-Options','nosniff');
  headers.set('X-Frame-Options','DENY');
  headers.set('Referrer-Policy','strict-origin-when-cross-origin');
  headers.set('Permissions-Policy','camera=(), microphone=(), geolocation=(), payment=(self "https://www.paypal.com" "https://www.sandbox.paypal.com")');
  headers.set('Content-Security-Policy',"object-src 'none'; base-uri 'self'; frame-ancestors 'none'; upgrade-insecure-requests");
  // Observe a stricter policy first: payment and Apple Pay must be accepted
  // in real supported browsers before script restrictions become blocking.
  headers.set('Content-Security-Policy-Report-Only',"default-src 'self'; script-src 'self' https://*.paypal.com https://*.paypalobjects.com https://applepay.cdn-apple.com https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://*.paypal.com https://*.paypalobjects.com; font-src 'self' data:; connect-src 'self' https://api.disorder119.com https://*.paypal.com https://*.paypalobjects.com https://challenges.cloudflare.com https://apple-pay-gateway.apple.com; frame-src https://*.paypal.com https://*.paypalobjects.com https://challenges.cloudflare.com; worker-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
  return headers;
}

export default {
  async fetch(request,env={},ctx={},originFetch=fetch) {
    const url=new URL(request.url);
    const fail=(status,message)=>new Response(request.method==='HEAD'?null:message,{status,headers:storefrontHeaders(new Response(null,{headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'}}))});
    if (!['disorder119.com','www.disorder119.com'].includes(url.hostname)) return fail(404,'Nicht gefunden.');
    if (!['GET','HEAD'].includes(request.method)) return fail(405,'Methode nicht erlaubt.');
    if (!publicPath(url.pathname)) return fail(404,'Nicht gefunden.');
    const filtered=['/data/catalog.json','/data/items.json'].includes(url.pathname);
    const originRequest=new Request(request,{method:filtered?'GET':request.method});
    if(filtered) {
      originRequest.headers.delete('If-None-Match');
      originRequest.headers.delete('If-Modified-Since');
      originRequest.headers.delete('Range');
    }
    let response;
    try { response=await originFetch(originRequest); } catch { return fail(502,'Website vorübergehend nicht erreichbar.'); }
    const headers=storefrontHeaders(response);
    if (filtered && response.ok) {
      let body;
      try { body=JSON.stringify(publicCatalog(await response.json())); } catch { return fail(502,'Katalog vorübergehend nicht verfügbar.'); }
      headers.delete('Content-Length'); headers.delete('Content-Encoding');headers.delete('ETag');headers.delete('Last-Modified');
      headers.set('Content-Type','application/json; charset=utf-8');headers.set('Cache-Control','no-store');
      return new Response(request.method==='HEAD'?null:body,{status:200,headers});
    }
    return new Response(request.method==='HEAD'?null:response.body,{status:response.status,statusText:response.statusText,headers});
  }
};

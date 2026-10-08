// Edge route in front of the existing static origin. No database or secrets.
// Catalog source files stay intact in Git; only the public response is filtered.
// Page views are handed to the shop Worker through the BESUCH service binding
// (no public address); this Worker stores nothing itself.
const PAGES = new Set(['agb','baukasten','cart','chaos','datenschutz','faq','impressum','kasse','konto','match','mieten','newsletter','ueber-uns','universe','widerruf']);
// google7945c4dc594a9a9c.html: Inhaberschaft fuer die Google Search Console (Konto disorder119shop), muss dauerhaft erreichbar bleiben.
const ROOT_FILES = new Set(['index.html','404.html','offline.html','robots.txt','sitemap.xml','manifest.webmanifest','sw.js','favicon.ico','google7945c4dc594a9a9c.html']);
const FIELDS = new Set(['id','article','title','brand','price','price_estimated','public_status','status','category','size','color','condition','brightness','gallery','look','department','product_type','taxonomy_category','size_normalized','rental_price','grid_image','hover_image','foto_hell']);
// Gestaltete Fehlerseite fuer Adressen, die es im Shop nicht gibt. Steht hier
// fertig im Worker: der Ursprung wird fuer solche Pfade nie gefragt.
const SEITE_404='<!DOCTYPE html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,follow"><title>Seite nicht gefunden – Disorder119</title>'
+'<style>html{background:#000;color:#f2efe7;font-family:"Helvetica Neue",Helvetica,Arial,sans-serif;-webkit-text-size-adjust:100%}body{margin:0;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:32px 20px;box-sizing:border-box}'
+'.marke{position:absolute;top:20px;left:50%;transform:translateX(-50%);font-weight:800;letter-spacing:.035em;color:#f2efe7;text-decoration:none;font-size:.92rem}.code{font-size:clamp(4rem,16vw,8rem);font-weight:800;letter-spacing:-.02em;line-height:1;margin:0 0 8px}'
+'h1{font-size:clamp(1.1rem,3vw,1.4rem);font-weight:700;margin:0 0 12px}p{max-width:440px;color:rgba(242,239,231,.62);font-size:.9rem;line-height:1.6;margin:0 0 28px}.knoepfe{display:flex;gap:10px;flex-wrap:wrap;justify-content:center}'
+'.knoepfe a{display:inline-block;padding:12px 22px;font-size:.76rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;text-decoration:none;border:1px solid #f2efe7;color:#f2efe7}.knoepfe a.leise{border-color:rgba(242,239,231,.28);color:rgba(242,239,231,.62)}</style></head>'
+'<body><a class="marke" href="/">DISORDER119</a><div class="code" aria-hidden="true">404</div><h1>Seite nicht gefunden</h1><p>Diese Adresse gibt es nicht – vielleicht ist der Link unvollständig oder das Stück ist nicht mehr im Archiv.</p>'
+'<div class="knoepfe"><a href="/">Zum Archiv</a><a class="leise" href="/en/">English</a><a class="leise" href="/fr/">Français</a></div></body></html>';

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
  // Produkt-Feed fuer Google Merchant Center (build_site.py: feed/google-merchant.xml)
  if (parts[0]==='feed') return parts.length===2 && /^[a-z0-9-]+\.xml$/.test(parts[1]);
  return PAGES.has(parts[0]) && (parts.length===1 || (parts.length===2 && parts[1]==='index.html'));
}

export function publicCatalog(value) {
  if (!Array.isArray(value)) throw new Error('INVALID_PUBLIC_CATALOG');
  return value.filter(item=>item && ['AVAILABLE','SOLD'].includes(item.public_status))
    .map(item=>Object.fromEntries(Object.entries(item).filter(([key,val])=>FIELDS.has(key) &&
      (val===null || ['string','number','boolean'].includes(typeof val) || (['gallery','size_normalized'].includes(key) && Array.isArray(val) && val.every(x=>typeof x==='string'))))));
}

// Anonyme Besuchszaehlung ohne Skript, auch bei gesperrtem Shop: nur echte
// Seitenaufrufe eines Browsers (Navigation zu einer Seite). Bilder, Daten,
// Vorab-Ladungen, Fehlerseiten, Do Not Track, Global Privacy Control und der
// Widerspruch ueber #nicht-zaehlen (Cookie d119_nicht_zaehlen) zaehlen nicht.
// Tages-Schluessel, Speicherung und Telegram macht der Shop-Worker.
const BESUCH_ZIEL='https://storefront.intern/intern/seitenaufruf';
export function seitenaufruf(request,url,status) {
  const h=request.headers;
  if (request.method!=='GET' || ![200,304].includes(status)) return null;
  if (h.get('Sec-Fetch-Mode')!=='navigate' || h.get('Sec-Fetch-Dest')!=='document') return null;
  if (/prefetch|prerender/i.test(`${h.get('Sec-Purpose')||''} ${h.get('Purpose')||''}`)) return null;
  if (h.get('Sec-GPC')==='1' || h.get('DNT')==='1') return null;
  if (/(?:^|;\s*)d119_nicht_zaehlen=1(?:;|$)/.test(h.get('Cookie')||'')) return null;
  if (/^\/(?:assets|data|\.well-known)\//.test(url.pathname) || /\.(?!html$)[a-z0-9]+$/i.test(url.pathname)) return null;
  return {p:url.pathname.slice(0,200),r:(h.get('Referer')||'').slice(0,300),ua:(h.get('User-Agent')||'').slice(0,400),
    ip:(h.get('CF-Connecting-IP')||'').slice(0,64),land:String(request.cf?.country||'').slice(0,2)};
}

function besuchMelden(request,url,status,env,ctx) {
  try {
    if (!env?.BESUCH || typeof env.BESUCH.fetch!=='function' || typeof ctx?.waitUntil!=='function') return;
    const daten=seitenaufruf(request,url,status);
    if (!daten) return;
    // Laeuft nach der Antwort weiter; ein Fehler dort erreicht die Seite nie.
    ctx.waitUntil(env.BESUCH.fetch(BESUCH_ZIEL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(daten)})
      .then(res=>res.body?.cancel()).catch(()=>{}));
  } catch {}
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
  headers.set('Content-Security-Policy-Report-Only',"default-src 'self'; script-src 'self' https://*.paypal.com https://*.paypalobjects.com https://applepay.cdn-apple.com https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://*.paypal.com https://*.paypalobjects.com https://tile.openstreetmap.org https://api.disorder119.com; font-src 'self' data:; connect-src 'self' https://api.disorder119.com https://*.paypal.com https://*.paypalobjects.com https://challenges.cloudflare.com https://apple-pay-gateway.apple.com; frame-src https://*.paypal.com https://*.paypalobjects.com https://challenges.cloudflare.com; worker-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
  return headers;
}

export default {
  async fetch(request,env={},ctx={},originFetch=fetch) {
    const url=new URL(request.url);
    const fail=(status,message)=>new Response(request.method==='HEAD'?null:message,{status,headers:storefrontHeaders(new Response(null,{headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'}}))});
    if (!['disorder119.com','www.disorder119.com'].includes(url.hostname)) return fail(404,'Nicht gefunden.');
    // Unverschluesselt aufgerufen (Cloudflare leitet nicht selbst um): sofort auf HTTPS.
    if (url.protocol==='http:') { url.protocol='https:'; return new Response(null,{status:301,headers:storefrontHeaders(new Response(null,{headers:{Location:url.toString(),'Cache-Control':'no-store'}}))}); }
    if (!['GET','HEAD'].includes(request.method)) return fail(405,'Methode nicht erlaubt.');
    if (!publicPath(url.pathname)) return new Response(request.method==='HEAD'?null:SEITE_404,{status:404,headers:storefrontHeaders(new Response(null,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}}))});
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
    besuchMelden(request,url,response.status,env,ctx);
    return new Response(request.method==='HEAD'?null:response.body,{status:response.status,statusText:response.statusText,headers});
  }
};

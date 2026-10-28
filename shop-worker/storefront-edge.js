import { ARTICLE_NUMBER_ROUTES } from './catalog-number-routes.js';
import { contentSecurityPolicy, secureHtml } from './storefront-csp.js';
import { geoGesperrt, geoSperrAntwort } from './geo-sperre.js';
import { bekannterBot, fremdAusgeloest, kurzPfad, netzVon, verifizierterBot, waechterPruefen } from './waechter-regeln.js';
import { ENTSPERREN_PFAD, VORSCHAU_PFAD, erwischtAntwort, sichererRuecksprung, sperrAntwort, sperrSprache, vorfallNummer, vorschauDaten } from './waechter-seiten.js';
import { anschlussVonIp } from './privacy-security.js';
// Edge route in front of the existing static origin. No database or secrets.
// Catalog source files stay intact in Git; only the public response is filtered.
// Page views and Waechter incidents are handed to the shop Worker through the
// BESUCH service binding (no public address); this Worker stores nothing itself.
// Order: host -> Geo-Sperre -> HTTPS -> Waechter -> paths -> origin.
const PAGES = new Set(['agb','baukasten','cart','chaos','datenschutz','faq','impressum','kasse','konto','match','mieten','newsletter','ueber-uns','universe','widerruf']);
// google7945c4dc594a9a9c.html: Inhaberschaft fuer die Google Search Console (Konto disorder119shop), muss dauerhaft erreichbar bleiben.
const ROOT_FILES = new Set(['index.html','404.html','offline.html','robots.txt','sitemap.xml','manifest.webmanifest','sw.js','favicon.ico','google7945c4dc594a9a9c.html']);
const FIELDS = new Set(['id','article','url_slug','title','title_en','color_en','brand','price','price_estimated','public_status','status','category','size','color','condition','brightness','gallery','look','department','product_type','taxonomy_category','size_normalized','rental_price','grid_image','hover_image','foto_hell']);
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
// Von Cloudflare verifizierte Bots zaehlen ebenfalls nicht. Mitgegeben werden
// ausserdem die erste Browsersprache (Accept-Language, nur der Sprachcode) und
// die Kampagnen-Kennung aus dem Link (utm_source/utm_campaign, die der Shop
// selbst in Instagram-/TikTok-Links setzt) - beides schickt jeder Browser mit
// dem Seitenabruf ohnehin. Klick-Kennungen wie fbclid/gclid bleiben weg.
const BESUCH_ZIEL='https://storefront.intern/intern/seitenaufruf';
function kampagnenWert(value) {
  const text=String(value||'').trim().toLowerCase().slice(0,40);
  return /^[a-z0-9][a-z0-9._-]*$/.test(text)?text:'';
}
export function browserSprache(value) {
  const treffer=/^\s*([a-z]{2,3})(?:[-_][a-z0-9]{1,8})*\s*(?:[;,]|$)/i.exec(String(value||''));
  return treffer?treffer[1].toLowerCase():'';
}
export function seitenaufruf(request,url,status) {
  const h=request.headers;
  if (request.method!=='GET' || ![200,304].includes(status)) return null;
  if (h.get('Sec-Fetch-Mode')!=='navigate' || h.get('Sec-Fetch-Dest')!=='document') return null;
  if (/prefetch|prerender/i.test(`${h.get('Sec-Purpose')||''} ${h.get('Purpose')||''}`)) return null;
  if (h.get('Sec-GPC')==='1' || h.get('DNT')==='1') return null;
  if (/(?:^|;\s*)d119_nicht_zaehlen=1(?:;|$)/.test(h.get('Cookie')||'')) return null;
  if (request.cf?.botManagement?.verifiedBot===true || request.cf?.verifiedBotCategory) return null;
  if (/^\/(?:assets|data|\.well-known)\//.test(url.pathname) || /\.(?!html$)[a-z0-9]+$/i.test(url.pathname)) return null;
  return {p:url.pathname.slice(0,200),r:(h.get('Referer')||'').slice(0,300),ua:(h.get('User-Agent')||'').slice(0,400),
    ip:(h.get('CF-Connecting-IP')||'').slice(0,64),land:String(request.cf?.country||'').slice(0,2),
    sl:browserSprache(h.get('Accept-Language')),us:kampagnenWert(url.searchParams.get('utm_source')),uc:kampagnenWert(url.searchParams.get('utm_campaign'))};
}

// Seitenaufrufe ohne Abruf der Seite beim Server (assets/zurueck.js):
// Zurueck/Vor aus dem Seitenspeicher des Browsers (bfcache), vorab geladene
// Seiten (Speculation Rules - der Vorab-Abruf selbst zaehlt oben bewusst
// nicht) und Zurueck aus dem Browser-Cache. Gleicher Zaehler, gleiche Daten
// und gleiche Ausnahmen wie seitenaufruf(); Adresse und verweisende Seite
// kommen aus dem kleinen Body statt aus der Anfrage. Nur von der eigenen
// Seite, hoechstens 1 KB, dieselbe Seite je Anschluss hoechstens alle 3 s;
// die Flut-Grenze des Waechters gilt wie fuer jede Seite.
export const SEITENAUFRUF_PING='/_seitenaufruf';
const pingMerker=new Map();
export function pingSeitenaufruf(request,body) {
  const h=request.headers;
  if (request.method!=='POST' || h.get('Sec-Fetch-Site')!=='same-origin') return null;
  const origin=h.get('Origin');
  if (origin && !['https://disorder119.com','https://www.disorder119.com'].includes(origin)) return null;
  if (h.get('Sec-GPC')==='1' || h.get('DNT')==='1') return null;
  if (/(?:^|;\s*)d119_nicht_zaehlen=1(?:;|$)/.test(h.get('Cookie')||'')) return null;
  if (request.cf?.botManagement?.verifiedBot===true || request.cf?.verifiedBotCategory) return null;
  let ziel;
  try { ziel=new URL(String(body?.u||''),'https://disorder119.com'); } catch { return null; }
  if (ziel.origin!=='https://disorder119.com' || !publicPath(ziel.pathname)) return null;
  if (/^\/(?:assets|data|feed|\.well-known)\//.test(ziel.pathname) || /\.(?!html$)[a-z0-9]+$/i.test(ziel.pathname)) return null;
  // Zurueck/Vor hat keine neue verweisende Seite: Aufruf innerhalb des Shops.
  const r=String(body?.r||'').slice(0,300)||'https://disorder119.com/';
  return {p:ziel.pathname.slice(0,200),r,ua:(h.get('User-Agent')||'').slice(0,400),
    ip:(h.get('CF-Connecting-IP')||'').slice(0,64),land:String(request.cf?.country||'').slice(0,2),
    sl:browserSprache(h.get('Accept-Language')),us:kampagnenWert(ziel.searchParams.get('utm_source')),uc:kampagnenWert(ziel.searchParams.get('utm_campaign'))};
}
async function kurzerBody(request,max=1024) {
  if (Number(request.headers.get('Content-Length')||0)>max) return null;
  const reader=request.body?.getReader();
  if (!reader) return '';
  const teile=[];let groesse=0;
  try {
    while(true) {
      const {done,value}=await reader.read();
      if (done) break;
      groesse+=value.byteLength;
      if (groesse>max) { reader.cancel().catch(()=>{}); return null; }
      teile.push(value);
    }
  } finally { reader.releaseLock?.(); }
  const bytes=new Uint8Array(groesse);let pos=0;
  for(const t of teile){bytes.set(t,pos);pos+=t.byteLength;}
  return new TextDecoder().decode(bytes);
}
async function seitenaufrufPing(request,env,ctx,bot) {
  const leer=new Response(null,{status:204,headers:storefrontHeaders(new Response(null,{headers:{'Cache-Control':'no-store'}}))});
  try {
    if (bot) return leer;
    const text=await kurzerBody(request);
    if (text===null) return leer;
    let body;
    try { body=JSON.parse(text||'{}'); } catch { return leer; }
    const daten=pingSeitenaufruf(request,body);
    if (!daten || !daten.ip || !env?.BESUCH || typeof env.BESUCH.fetch!=='function' || typeof ctx?.waitUntil!=='function') return leer;
    const jetzt=Date.now(),schluessel=`${daten.ip}|${daten.p}`;
    if ((pingMerker.get(schluessel)||0)>jetzt-3000) return leer;
    if (pingMerker.size>MERKER_MAX) pingMerker.clear();
    pingMerker.set(schluessel,jetzt);
    ctx.waitUntil(env.BESUCH.fetch(BESUCH_ZIEL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(daten)})
      .then(res=>res.body?.cancel()).catch(()=>{}));
  } catch {}
  return leer;
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

// Waechter (waechter-regeln.js, Speicherung in waechter.js beim Shop-Worker,
// Seiten in waechter-seiten.js):
// - Eindeutige Angriffsprobe (SQL-Injection, XSS, ...) -> "Erwischt"-Seite
//   (403) in der Landessprache, Meldung ueber die Dienstbindung.
// - Scanner-Pfad -> 404; sperrt der Shop-Worker deshalb (Schwelle erreicht,
//   Hoster, Kampagne), zeigt schon diese Anfrage die "Erwischt"-Seite.
// - Angriffsmuster von einer fremden Seite (Sec-Fetch-Site: cross-site) und
//   von Bots: nur abweisen, nie sperren, keine "Erwischt"-Seite.
// - Gesperrter Anschluss -> neutrale, dreisprachige Sperrseite (Impressum,
//   bei milden Sperren Selbst-Entsperrung per Turnstile). Rechtsseiten und
//   /assets/ bleiben immer erreichbar.
// Die Sperrliste fragt dieser Worker nur fuer Seiten und Daten beim
// Shop-Worker ab und merkt sich die Antwort eine Minute im Speicher - keine
// Datenbank, kein Speichern hier. Faellt die Abfrage aus, bleibt die Seite offen.
const WAECHTER_VORFALL='https://storefront.intern/intern/waechter/vorfall';
const WAECHTER_PRUEFEN='https://storefront.intern/intern/waechter/pruefen';
const WAECHTER_ENTSPERREN='https://storefront.intern/intern/waechter/entsperren';
const sperrMerker=new Map();
const meldeMerker=new Map();
const MERKER_MAX=5000;
export function waechterMerkerLeeren(){sperrMerker.clear();meldeMerker.clear();}
function istAsset(pathname){return /^\/assets\//.test(pathname)||pathname==='/favicon.ico';}
// Impressum, Datenschutz, AGB und Widerruf: auch fuer gesperrte Anschluesse.
export function istRechtsseite(pathname){return /^\/(?:(?:en|fr)\/)?(?:impressum|datenschutz|agb|widerruf)(?:\/(?:index\.html)?)?$/.test(pathname);}

function mitFrist(promise,ms){
  let uhr;
  return Promise.race([promise,new Promise(resolve=>{uhr=setTimeout(()=>resolve(null),ms);})]).finally(()=>clearTimeout(uhr));
}

function merken(ip,eintrag){
  if (sperrMerker.size>MERKER_MAX) sperrMerker.clear();
  sperrMerker.set(ip,{...eintrag,ablauf:Date.now()+60_000});
}

// Meldet einen Vorfall; Ergebnis-Promise ({gesperrt, selbst, bis} oder null)
// oder null, wenn nichts gemeldet wurde.
function vorfallMelden(env,ctx,request,url,vorfall){
  try {
    if (!env?.BESUCH || typeof env.BESUCH.fetch!=='function' || typeof ctx?.waitUntil!=='function') return null;
    const ip=(request.headers.get('CF-Connecting-IP')||'').slice(0,64);
    if (!ip) return null;
    const jetzt=Date.now(),gemerkt=sperrMerker.get(ip);
    // Schon als gesperrt bekannt: nichts mehr melden (keine Schreibflut).
    if (gemerkt && gemerkt.gesperrt && gemerkt.ablauf>jetzt) return null;
    // Drosseln: je Art hoechstens alle 2 s je Anschluss (Angriffe sperren sofort).
    if (vorfall.art!=='angriff') {
      const key=`${vorfall.art}|${ip}`;
      if ((meldeMerker.get(key)||0)>jetzt-2000) return null;
      if (meldeMerker.size>MERKER_MAX) meldeMerker.clear();
      meldeMerker.set(key,jetzt);
    }
    const netz=netzVon(request);
    const body={ip,ua:(request.headers.get('User-Agent')||'').slice(0,400),land:String(request.cf?.country||'').slice(0,2),
      pfad:(vorfall.pfad||kurzPfad(url)).slice(0,200),art:vorfall.art,grund:vorfall.grund||'',bot:Boolean(vorfall.bot),
      asn:netz.asn,netz:netz.name,nr:vorfall.nr||''};
    const laeuft=env.BESUCH.fetch(WAECHTER_VORFALL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
      .then(async res=>{
        let daten=null;
        try { daten=await res.json(); } catch {}
        if (daten?.gesperrt===true) merken(ip,{gesperrt:true,selbst:daten.selbst===true,bis:daten.bis||null}); else sperrMerker.delete(ip);
        return daten;
      }).catch(()=>null);
    ctx.waitUntil(laeuft);
    return laeuft;
  } catch { return null; }
}

// null oder { selbst, bis } fuer einen gesperrten Anschluss.
async function anschlussSperre(env,ip) {
  if (!ip || !env?.BESUCH || typeof env.BESUCH.fetch!=='function') return null;
  const gemerkt=sperrMerker.get(ip);
  if (gemerkt && gemerkt.ablauf>Date.now()) return gemerkt.gesperrt?gemerkt:null;
  let daten=null;
  try {
    const antwort=await mitFrist(env.BESUCH.fetch(WAECHTER_PRUEFEN,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ip})}),1500);
    if (antwort && antwort.ok) daten=await antwort.json();
    else antwort?.body?.cancel?.();
  } catch {}
  const eintrag={gesperrt:daten?.gesperrt===true,selbst:daten?.selbst===true,bis:daten?.bis||null};
  merken(ip,eintrag);
  return eintrag.gesperrt?eintrag:null;
}

// Gecachte Liste verfuegbarer Teile fuer den "Erwischt"-Bildschirm: nur echte
// AVAILABLE-Artikel, je Marke eins, mit Vorschaubild. Wird bei jedem echten
// Katalog-Abruf warm gehalten; nur wenn der Cache kalt ist, holt der Worker
// catalog.json selbst (kurze Frist). Faellt alles aus, bleibt die Liste leer
// und die Seite rendert ohne Teile. Keine D1-Abfrage, kein Telegram.
const ERWISCHT_TTL=600_000;
let erwischtCache={zeit:0,liste:[]};
export function erwischtCacheLeeren(){erwischtCache={zeit:0,liste:[]};}
export function erwischtProdukteAus(catalogArray){
  if(!Array.isArray(catalogArray))return [];
  const marken=new Set(),out=[];
  for(const i of catalogArray){
    if(!i||i.public_status!=='AVAILABLE'||!i.grid_image||!i.brand||!i.title)continue;
    if(marken.has(i.brand))continue; marken.add(i.brand);
    out.push({marke:i.brand,titel:i.title,titelEn:i.title_en||i.title,preis:i.price,nr:i.article,bild:i.grid_image,kat:i.product_type||''});
    if(out.length>=60)break;
  }
  return out;
}
function erwischtCacheSetzen(catalogArray){
  try{ const liste=erwischtProdukteAus(catalogArray); if(liste.length) erwischtCache={zeit:Date.now(),liste}; }catch{}
}
// Fuer Angriffs-/Scanner-Antworten: nur die warme Liste, nie den Ursprung
// fragen (eine Angriffsanfrage erreicht den Ursprung nie).
function erwischtProdukteCache(){ return erwischtCache.liste; }
// Nur fuer die Admin-Vorschau: bei kaltem Cache einmal catalog.json holen.
async function erwischtProdukteHolen(originFetch){
  const jetzt=Date.now();
  if(erwischtCache.liste.length && jetzt-erwischtCache.zeit<ERWISCHT_TTL) return erwischtCache.liste;
  if(typeof originFetch!=='function') return erwischtCache.liste;
  try{
    const res=await mitFrist(originFetch(new Request('https://disorder119.com/data/catalog.json',{method:'GET'})),1200);
    if(res && res.ok){ erwischtCacheSetzen(await res.json()); } else res?.body?.cancel?.();
  }catch{}
  return erwischtCache.liste;
}

function erwischt(request,url,grund,nr,bis,produkte) {
  const cf=request.cf||{},netz=netzVon(request);
  // IP nur anzeigen (sie steht ohnehin in der Anfrage), nie speichern. bis gibt
  // die echte Sperrdauer; produkte ist die gecachte Liste verfuegbarer Teile.
  return erwischtAntwort(request,{ip:request.headers.get('CF-Connecting-IP')||'',land:cf.country,stadt:cf.city,region:cf.region,
    netz:netz.name,asn:netz.asn,ua:request.headers.get('User-Agent')||'',zeit:Date.now(),grund,nutzlast:`${url.pathname}${url.search}`,nr,bis:bis||null,produkte:produkte||[]});
}

function sperrSeiteAntwort(request,url,sperre,fehler=false,zurueck=`${url.pathname}${url.search}`) {
  return sperrAntwort(request,{sprache:sperrSprache(url.pathname,request.cf?.country),selbst:sperre?.selbst===true,bis:sperre?.bis||null,zurueck,fehler});
}

// "Ich bin ein Mensch": Turnstile-Antwort an den Shop-Worker, der prueft und
// die Sperre aufhebt (nur bei milden Sperren). Danach zurueck zur Seite.
async function entsperren(request,env,url,ip) {
  const weiter=ziel=>new Response(null,{status:303,headers:storefrontHeaders(new Response(null,{headers:{Location:ziel,'Cache-Control':'no-store'}}))});
  if (request.method!=='POST') return weiter('/');
  if (Number(request.headers.get('Content-Length')||0)>8192) return new Response('Zu groß.',{status:413,headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'}});
  let form=null;
  try { form=await request.formData(); } catch {}
  const token=String(form?.get('cf-turnstile-response')||'').slice(0,2048);
  const zurueck=sichererRuecksprung(form?.get('zurueck'));
  let ergebnis=null;
  if (ip && token && env?.BESUCH && typeof env.BESUCH.fetch==='function') {
    try {
      const antwort=await mitFrist(env.BESUCH.fetch(WAECHTER_ENTSPERREN,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ip,token})}),8000);
      if (antwort && antwort.ok) ergebnis=await antwort.json(); else antwort?.body?.cancel?.();
    } catch {}
  }
  if (ergebnis?.ok===true) { sperrMerker.delete(ip); return weiter(zurueck); }
  sperrMerker.delete(ip);
  const sperre=await anschlussSperre(env,ip);
  if (!sperre) return weiter(zurueck);
  return sperrSeiteAntwort(request,new URL(zurueck,url),sperre,true,zurueck);
}

// Vorschau fuer die Admin-App (Sicherheit): nur Beispieldaten, nichts wird
// gemeldet, gespeichert oder gesperrt.
async function waechterVorschau(request,url,env,ctx,originFetch) {
  const land=String(url.searchParams.get('land')||'FR').toUpperCase().slice(0,2);
  if (url.searchParams.get('seite')==='sperre') {
    // Sprache: ?sprache=de|en|fr, sonst nach ?land=, ohne beides Deutsch.
    const gewaehlt=['de','en','fr'].includes(url.searchParams.get('sprache'))?url.searchParams.get('sprache')
      :sperrSprache('/',url.searchParams.get('land')?land:'DE');
    return sperrAntwort(request,{sprache:gewaehlt,
      selbst:url.searchParams.get('selbst')!=='0',bis:new Date(Date.now()+24*3600_000).toISOString(),zurueck:'/'},200);
  }
  const sprache=String(url.searchParams.get('sprache')||'').slice(0,8);
  const variante=['a','b','c'].includes(String(url.searchParams.get('variante')||'').toLowerCase())?String(url.searchParams.get('variante')).toLowerCase():'';
  const produkte=await erwischtProdukteHolen(originFetch);
  return erwischtAntwort(request,{...vorschauDaten(land),...(sprache?{sprache}:{}),...(variante?{variante}:{}),produkte},200);
}

// Liefergebiet (AGB § 4, FAQ "Wohin versendet ihr?"): Europa - EU, EWR,
// Schweiz, Grossbritannien, Balkan und Osteuropa ohne Russland/Belarus - und
// die USA. Ueber die Kasse gehen Deutschland und die EU (seit 28.10.2026,
// versand.zonen), die anderen Laender auf Anfrage. EU-Besucher sehen den
// Hinweis deshalb nie.
// Besucher aus allen anderen Laendern sehen oben auf jeder Seite einen
// dezenten Hinweis. Das Land kommt von Cloudflare (request.cf.country, aus
// der IP); gespeichert oder gezaehlt wird dafuer nichts. Gesperrt wird nichts.
export const LIEFERLAENDER=Object.freeze([
  // EU
  'AT','BE','BG','CY','CZ','DE','DK','EE','ES','FI','FR','GR','HR','HU','IE','IT','LT','LU','LV','MT','NL','PL','PT','RO','SE','SI','SK',
  // EWR, Schweiz, Grossbritannien, Kleinstaaten und Kronbesitzungen
  'IS','LI','NO','CH','GB','AD','MC','SM','VA','GI','JE','GG','IM','FO','AX',
  // Balkan und Osteuropa
  'AL','BA','ME','MK','RS','XK','MD','UA',
  // USA
  'US',
]);
const LIEFER_HINWEIS_STIL='margin:0;padding:8px 16px;background:#161616;color:#f2efe7;border-bottom:1px solid rgba(242,239,231,.16);'
  +'font:500 12px/1.45 Helvetica Neue,Helvetica,Arial,sans-serif;letter-spacing:.02em;text-align:center';
export function lieferHinweis(request,url,bot=false) {
  if (bot) return '';
  const land=String(request?.cf?.country||'').toUpperCase();
  // Unbekannt (XX), Tor (T1) oder interne Abrufe ohne Land: kein Hinweis.
  if (!/^[A-Z]{2}$/.test(land) || land==='XX' || LIEFERLAENDER.includes(land)) return '';
  const pfad=url?.pathname||'/';
  const text=/^\/fr(?:\/|$)/.test(pfad)
    ? '<span lang="fr">Nous livrons uniquement en Europe et aux États-Unis.</span>'
    : /^\/en(?:\/|$)/.test(pfad)
      ? '<span lang="en">We currently ship to Europe and the USA only.</span>'
      : '<span lang="en" style="display:inline-block">We currently ship to Europe and the USA only.</span> <span lang="de" style="display:inline-block;margin-left:.6em;opacity:.72">Wir versenden nur nach Europa und in die USA.</span>';
  return '<div class="d119-liefergebiet" role="note" style="'+LIEFER_HINWEIS_STIL+'">'+text+'</div>';
}

export function storefrontHeaders(response) {
  const headers=new Headers(response.headers);
  headers.set('Strict-Transport-Security','max-age=31536000; includeSubDomains');
  headers.set('X-Content-Type-Options','nosniff');
  headers.set('X-Frame-Options','DENY');
  headers.set('Referrer-Policy','strict-origin-when-cross-origin');
  headers.set('Permissions-Policy','camera=(), microphone=(), geolocation=(), payment=(self "https://www.paypal.com" "https://www.sandbox.paypal.com")');
  headers.set('Content-Security-Policy',contentSecurityPolicy());
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
    // Geo-Sperre (geo-sperre.js): vor allem anderen, ohne Ursprung und ohne Zaehlung.
    if (geoGesperrt(request,env)) return geoSperrAntwort(request,Object.fromEntries(storefrontHeaders(new Response(null,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}})).entries()));
    // Unverschluesselt aufgerufen (Cloudflare leitet nicht selbst um): sofort auf HTTPS.
    if (url.protocol==='http:') { url.protocol='https:'; return new Response(null,{status:301,headers:storefrontHeaders(new Response(null,{headers:{Location:url.toString(),'Cache-Control':'no-store'}}))}); }
    // Waechter: Angriffsproben sofort abweisen, gesperrte Anschluesse und Fluten stoppen.
    const ip=request.headers.get('CF-Connecting-IP')||'';
    const ua=request.headers.get('User-Agent')||'';
    // Abrufe anderer Cloudflare-Worker ohne Browserkennung (z. B. der Testshop
    // test.disorder119.com, sandbox-edge.js) teilen sich Cloudflare-Adressen:
    // nie sperren, sonst traefe eine Sperre alle.
    const bot=bekannterBot(request,ua) || (!ua && Number(request.cf?.asn)===13335);
    const html=(status,body)=>new Response(request.method==='HEAD'?null:body,{status,headers:storefrontHeaders(new Response(null,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}}))});
    // Vorschau der Waechter-Seiten (Admin-App -> Sicherheit), nur Beispieldaten.
    if (url.pathname===VORSCHAU_PFAD && ['GET','HEAD'].includes(request.method)) return waechterVorschau(request,url,env,ctx,originFetch);
    const probe=waechterPruefen(url,ua);
    if (probe) {
      // Fremde Seite (Bild/Link mit Angriffsmuster) oder Bot: nur abweisen.
      const fremd=probe.art==='angriff' && fremdAusgeloest(request);
      if (bot || fremd) {
        if (!fremd) vorfallMelden(env,ctx,request,url,{art:probe.art,grund:probe.grund,pfad:probe.detail,bot:true});
        return probe.art==='angriff'?fail(403,'Nicht erlaubt.'):html(404,SEITE_404);
      }
      const nr=vorfallNummer();
      if (probe.art==='angriff') {
        // Auf die Sperrantwort kurz warten, um die echte Dauer (bis) zu zeigen;
        // ohne Angabe bleibt die Dauer neutral ("gesperrt"). Kein extra Schreib-
        // zugriff: die Meldung schreibt der Shop-Worker ohnehin.
        const laeuft=vorfallMelden(env,ctx,request,url,{art:'angriff',grund:probe.grund,pfad:probe.detail,nr});
        const bis=laeuft?(await mitFrist(laeuft,1200))?.bis||null:null;
        return erwischt(request,url,probe.grund,nr,bis,erwischtProdukteCache());
      }
      // Scanner-Pfad: sperrt der Shop-Worker deshalb (Schwelle, Hoster,
      // Kampagne), zeigt schon diese Anfrage die "Erwischt"-Seite. Auf das
      // Ergebnis wird hoechstens 1,5 s gewartet - nur Scanner warten.
      const gemerkt=sperrMerker.get(ip);
      let gesperrt=Boolean(gemerkt?.gesperrt && gemerkt.ablauf>Date.now());
      let bis=gemerkt?.bis||null;
      if (!gesperrt) {
        const laeuft=vorfallMelden(env,ctx,request,url,{art:'probe',grund:probe.grund,pfad:probe.detail,nr});
        const res=laeuft?await mitFrist(laeuft,1500):null;
        gesperrt=Boolean(res?.gesperrt===true);
        bis=res?.bis||bis;
      }
      return gesperrt?erwischt(request,url,probe.grund,nr,bis,erwischtProdukteCache()):html(404,SEITE_404);
    }
    if (url.pathname===ENTSPERREN_PFAD) {
      if (ip && typeof env?.WAECHTER_FLUT?.limit==='function') {
        let frei=null;
        try { frei=await env.WAECHTER_FLUT.limit({key:anschlussVonIp(ip)}); } catch {}
        if (frei && frei.success===false) return fail(429,'Zu viele Anfragen. Bitte kurz warten.');
      }
      return entsperren(request,env,url,ip);
    }
    if (!istAsset(url.pathname)) {
      if (!bot && !istRechtsseite(url.pathname)) {
        const sperre=await anschlussSperre(env,ip);
        if (sperre) return sperrSeiteAntwort(request,url,sperre);
      }
      // Flut-Grenze fuer alle ausser von Cloudflare verifizierten Bots; Bots
      // nach Kennung + Netz und andere Cloudflare-Worker bekommen nur 429.
      if (ip && !verifizierterBot(request) && typeof env?.WAECHTER_FLUT?.limit==='function') {
        let frei=null;
        // Je Anschluss (IPv6 je /64): neue Adressen im selben Netz helfen nicht.
        try { frei=await env.WAECHTER_FLUT.limit({key:anschlussVonIp(ip)}); } catch {}
        if (frei && frei.success===false) {
          if (!bot) vorfallMelden(env,ctx,request,url,{art:'flut',grund:'zu-viele-anfragen'});
          return fail(429,'Zu viele Anfragen. Bitte kurz warten.');
        }
      }
    }
    if (url.pathname===SEITENAUFRUF_PING) return request.method==='POST'?seitenaufrufPing(request,env,ctx,bot):fail(405,'Methode nicht erlaubt.');
    if (!['GET','HEAD'].includes(request.method)) return fail(405,'Methode nicht erlaubt.');
    const legacy=url.pathname.match(/^(\/(?:en\/|fr\/)?artikel\/)(\d+)(?:\/index\.html|\/|\.html)?$/);
    if(legacy && ARTICLE_NUMBER_ROUTES[legacy[2]]) {
      url.pathname=legacy[1]+ARTICLE_NUMBER_ROUTES[legacy[2]]+'/';
      return new Response(null,{status:301,headers:storefrontHeaders(new Response(null,{headers:{Location:url.toString(),'Cache-Control':'public, max-age=300'}}))});
    }
    if (!publicPath(url.pathname)) {
      if (!bot) vorfallMelden(env,ctx,request,url,{art:'404',grund:'zu-viele-404'});
      return html(404,SEITE_404);
    }
    const filtered=['/data/catalog.json','/data/items.json'].includes(url.pathname);
    const originRequest=new Request(request,{method:filtered?'GET':request.method});
    // Fresh HTML carries fresh payment nonces; a 304 must not combine an old
    // cached body with a new CSP. Static images/scripts retain their caching.
    if (!/\.[a-z0-9]+$/i.test(url.pathname) || /\.html$/i.test(url.pathname)) {
      for(const name of ['If-None-Match','If-Modified-Since','Range'])originRequest.headers.delete(name);
    }
    if(filtered) {
      originRequest.headers.delete('If-None-Match');
      originRequest.headers.delete('If-Modified-Since');
      originRequest.headers.delete('Range');
    }
    let response;
    try { response=await originFetch(originRequest); } catch { return fail(502,'Website vorübergehend nicht erreichbar.'); }
    const headers=storefrontHeaders(response);
    if (filtered && response.ok) {
      let parsed;
      try { parsed=await response.json(); } catch { return fail(502,'Katalog vorübergehend nicht verfügbar.'); }
      // Produktliste des "Erwischt"-Bildschirms aus echtem Traffic warm halten.
      erwischtCacheSetzen(parsed);
      let body;
      try { body=JSON.stringify(publicCatalog(parsed)); } catch { return fail(502,'Katalog vorübergehend nicht verfügbar.'); }
      headers.delete('Content-Length'); headers.delete('Content-Encoding');headers.delete('ETag');headers.delete('Last-Modified');
      headers.set('Content-Type','application/json; charset=utf-8');headers.set('Cache-Control','no-store');
      return new Response(request.method==='HEAD'?null:body,{status:200,headers});
    }
    if (response.status===404 && !bot) vorfallMelden(env,ctx,request,url,{art:'404',grund:'zu-viele-404'});
    besuchMelden(request,url,response.status,env,ctx);
    if(request.method==='GET' && /text\/html/i.test(headers.get('Content-Type')||'') && response.status!==304) {
      try { return await secureHtml(response,headers,undefined,response.ok?lieferHinweis(request,url,bot):''); }
      catch { return fail(502,'Website vorübergehend nicht erreichbar.'); }
    }
    return new Response(request.method==='HEAD'?null:response.body,{status:response.status,statusText:response.statusText,headers});
  }
};

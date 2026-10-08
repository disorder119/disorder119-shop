// Versand im Checkout: Versandoptionen mit echten Packlink-Preisen und die
// serverseitige Pruefung der gewaehlten Option.
//
// Ablauf:
//   1. Produktseite und Warenkorb fragen GET /versand/optionen?artikel=<IDs>.
//      Die Paketgroesse bestimmt der Server selbst aus Produktart und
//      Kategorie (versand-config.js) - der Browser rechnet nichts.
//   2. Gezeigt wird je erlaubtem Paketdienst (DPD, DHL ...) der guenstigste
//      "Standard" mit Zustellung an die Haustuer, der billigste zuerst, dazu
//      "Express" (guenstigster Express-Dienst, falls Packlink einen anbietet
//      und er teurer ist als der billigste Standard).
//   3. Beim Bestellen rechnet der Server die Optionen neu. Er nimmt den Preis
//      aus seiner eigenen Liste und vergleicht ihn mit dem, den die Kundschaft
//      gesehen hat: Weicht er ab (neuer Packlink-Preis, andere Paketgroesse,
//      manipulierte Anfrage), gibt es 409 samt frischer Liste statt eines
//      stillschweigend anderen Betrags bei PayPal.
//   4. Ab einem Warenwert (config/shop-config.json versand.versandkostenfrei,
//      99 Euro) uebernimmt der Shop den guenstigsten Standard: Die Kundschaft
//      zahlt dafuer 0 Cent, fuer andere Dienste nur den Aufpreis. Jede Option
//      traegt ausserdem das voraussichtliche Lieferfenster (lieferzeit.js).
//
// Liefert Packlink gerade keine Preise, gilt der Ersatzpreis der Paketgroesse
// aus config/shop-config.json - als eigene Option "ersatz-<Groesse>".
// Das Etikett wird nie automatisch gekauft: das macht die Admin-App.
import { parsePriceToCents, safeText } from "./commerce-core.js";
import { lieferfenster } from "./lieferzeit.js";
import { angeboteLaden } from "./packlink.js";
import { PAKETE, VERSAND, dienstErlaubt, paketFuer, paketFuerArtikel } from "./versand-config.js";

const CACHE_MS = 10 * 60 * 1000;
const KATALOG_CACHE_MS = 5 * 60 * 1000;
const KATALOG_URL = "https://disorder119.com/data/catalog.json";
const MAX_ARTIKEL = 10;
const OEFFENTLICHE_ORIGINS = Object.freeze([
  "https://disorder119.com",
  "https://www.disorder119.com",
  "https://admin.disorder119.com",
  "http://localhost:8765",
]);

let angeboteCache = new Map();
let katalogCache = null;

export class VersandError extends Error {
  constructor(code, status = 400, versand = null) {
    super(code);
    this.code = code;
    this.status = status;
    // Bei 409: die aktuelle Liste, damit der Browser sie sofort zeigen kann.
    this.versand = versand;
  }
}

// Nur fuer Tests: Zwischenspeicher leeren, damit jeder Test frisch rechnet.
export function versandCacheLeeren() {
  angeboteCache = new Map();
  katalogCache = null;
}

// ----------------------------------------------------------------- Optionen

// Die Paketgroesse steckt in der Kennung: dieselbe Packlink-Leistung kostet
// als "Mittel" etwas anderes als als "Groß".
export function optionsId(paket, serviceId) {
  return `pl-${paket}-${serviceId}`;
}

function option(art, angebot, paket) {
  return {
    id: optionsId(paket, angebot.id),
    art,
    titel: art === "express" ? "Express" : "Standard",
    preisCents: angebot.preisCents,
    laufzeit: angebot.laufzeit || "",
    quelle: "packlink",
    packlinkServiceId: angebot.id,
    carrier: angebot.carrier || "",
    serviceName: angebot.name || "",
    paket,
  };
}

export function ersatzOption(paket) {
  const p = paketFuer(paket);
  return {
    id: `ersatz-${p.key}`,
    art: "standard",
    titel: "Standard",
    preisCents: p.ersatzCents,
    laufzeit: "",
    quelle: "ersatz",
    packlinkServiceId: null,
    carrier: "",
    serviceName: "",
    paket: p.key,
  };
}

// Aus der Packlink-Liste (schon auf Haustuer-Zustellung gefiltert) die
// Optionen, die eine Kundin wirklich unterscheiden kann: je Paketdienst aus
// config/shop-config.json (versand.dienste) der guenstigste Standard.
// Express nur, wenn ein erlaubter Dienst ihn bis zur Preisgrenze anbietet.
export function optionenAus(angebote, paket, konfig = VERSAND) {
  const nachPreis = (a, b) => a.preisCents - b.preisCents || a.id - b.id;
  const maxExpress = konfig.dienste && konfig.dienste.expressMaxCents;
  const liste = (Array.isArray(angebote) ? angebote : [])
    .filter(a => a && Number.isInteger(a.id) && a.id > 0 && Number.isSafeInteger(a.preisCents) && a.preisCents > 0)
    .filter(a => dienstErlaubt(a.carrier, konfig));
  const standards = [];
  const dienste = new Set();
  for (const a of liste.filter(a => !a.express).sort(nachPreis)) {
    const dienst = String(a.carrier || "").trim().toUpperCase();
    if (dienste.has(dienst)) continue;
    dienste.add(dienst);
    standards.push(a);
  }
  const express = liste.filter(a => a.express && (!maxExpress || a.preisCents <= maxExpress)).sort(nachPreis)[0];
  const out = standards.map(a => option("standard", a, paket));
  const guenstigster = standards[0];
  if (express && (!guenstigster || express.preisCents > guenstigster.preisCents)) out.push(option("express", express, paket));
  return out;
}

async function angeboteFuer(env, paket) {
  const key = `${paket}|${VERSAND.zielLand}|${VERSAND.referenzPlz}`;
  const treffer = angeboteCache.get(key);
  if (treffer && treffer.bis > Date.now()) return treffer.angebote;
  const { angebote } = await angeboteLaden(env, { country_code: VERSAND.zielLand, postal_code: VERSAND.referenzPlz }, paket);
  angeboteCache.set(key, { bis: Date.now() + CACHE_MS, angebote });
  return angebote;
}

// Feste Tarife (config/shop-config.json versand.quelle "fest"): DHL und DPD
// zu Privatpreisen, das Etikett entsteht von Hand bzw. halbautomatisch.
export function festeOptionen(paket, konfig = VERSAND) {
  const p = paketFuer(paket);
  return konfig.tarife.map(t => ({
    id: `fest-${t.id}-${p.key}`,
    art: t.art,
    titel: t.titel,
    preisCents: t.preise[p.key],
    laufzeit: t.laufzeitTage ? (t.laufzeitTage === 1 ? "1 Tag" : `${t.laufzeitTage} Tage`) : "",
    quelle: "fest",
    packlinkServiceId: null,
    carrier: t.carrier,
    serviceName: t.titel,
    paket: p.key,
    abholstation: t.abholstation,
    versichertBisCents: t.versichertBisCents,
  })).sort((a, b) => a.preisCents - b.preisCents || a.id.localeCompare(b.id));
}

// Woher die Preise kommen: config/shop-config.json (versand.quelle). Der
// Schalter VERSAND_QUELLE ("fest" | "packlink") am Worker ueberstimmt das,
// etwa um ohne neuen Katalog-Build auf Packlink zurueckzugehen.
export function versandQuelle(env, konfig = VERSAND) {
  const q = String(env?.VERSAND_QUELLE || "").trim().toLowerCase();
  return q === "fest" || q === "packlink" ? q : konfig.quelle;
}

// Optionen fuer eine Paketgroesse. Ohne Verbindung zu Packlink: Ersatzpreis.
export async function versandOptionen(env, paket) {
  const p = paketFuer(paket);
  if (versandQuelle(env) === "fest") {
    const optionen = festeOptionen(p.key);
    if (optionen.length) return { paket: p.key, quelle: "fest", optionen };
    return { paket: p.key, quelle: "ersatz", optionen: [ersatzOption(p.key)] };
  }
  try {
    const optionen = optionenAus(await angeboteFuer(env, p.key), p.key);
    if (optionen.length) return { paket: p.key, quelle: "packlink", optionen };
  } catch (err) {
    console.warn(JSON.stringify({ level: "warn", event: "versand_optionen_ersatz", code: safeText(err?.code || err?.message || "unbekannt", 60) }));
  }
  return { paket: p.key, quelle: "ersatz", optionen: [ersatzOption(p.key)] };
}

// Versandkostenfrei ab einem Warenwert: Den guenstigsten Standard uebernimmt
// der Shop. Fuer einen anderen Paketdienst oder Express zahlt die Kundschaft
// nur den Aufpreis - so kostet den Shop jede Bestellung hoechstens den
// guenstigsten Standard. Massgeblich ist der Warenwert vor einem Gutschein:
// Der Gutschein wird erst nach dem Anlegen der Bestellung verrechnet und
// aendert den Versand nicht (coupon-checkout.js).
export function versandkostenfreiAnwenden(ergebnis, warenwertCents, konfig = VERSAND) {
  const grenze = konfig.versandkostenfrei;
  if (!grenze) return ergebnis;
  const wert = Number.isSafeInteger(warenwertCents) && warenwertCents > 0 ? warenwertCents : 0;
  const erreicht = wert >= grenze.abCents;
  const standards = ergebnis.optionen.filter(o => o.art === "standard").map(o => o.preisCents);
  const basis = standards.length ? Math.min(...standards) : 0;
  return {
    ...ergebnis,
    frei: { abCents: grenze.abCents, warenwertCents: wert, erreicht },
    optionen: !erreicht || !(basis > 0) ? ergebnis.optionen : ergebnis.optionen.map(o => ({
      ...o,
      preisCents: Math.max(0, o.preisCents - basis),
      listenpreisCents: o.preisCents,
    })),
  };
}

export function oeffentlicheOptionen(ergebnis, jetzt = new Date()) {
  const p = paketFuer(ergebnis.paket);
  const frei = ergebnis.frei;
  return {
    paket: p.key,
    paketName: p.name,
    quelle: ergebnis.quelle,
    optionen: ergebnis.optionen.map(o => {
      // Werktage als Zahl, damit Produktseite und Warenkorb sie in ihrer
      // Sprache anzeigen koennen ("2 Tage", "2 days", "2 jours").
      const tage = Number(/(\d+)/.exec(o.laufzeit || "")?.[1]) || null;
      return {
        id: o.id,
        art: o.art,
        titel: o.titel,
        preisCents: o.preisCents,
        preis: (o.preisCents / 100).toFixed(2),
        laufzeit: o.laufzeit,
        tage,
        carrier: o.carrier,
        // Nur DHL liefert an Packstation und Filiale.
        abholstation: o.abholstation === true,
        // Feste Tarife: bis zu welchem Warenwert der Paketdienst haftet.
        ...(Number.isSafeInteger(o.versichertBisCents) && o.versichertBisCents > 0 ? { versichertBisCents: o.versichertBisCents } : {}),
        // Voraussichtlich bei der Kundschaft: { von, bis } als Datum.
        lieferung: lieferfenster(tage, jetzt),
      };
    }),
    // "Ab 99 € versandkostenfrei" - fuer "Noch 9,00 € bis zum kostenlosen Versand".
    ...(frei ? { frei: { ...frei, fehltCents: Math.max(0, frei.abCents - frei.warenwertCents) } } : {}),
  };
}

// ---------------------------------------------------------------- Bestellung

// Pruefung beim Bestellen: Paketgroesse aus den echten Artikeln (nie aus dem
// Browser), Preis aus der eigenen, frisch gerechneten Liste. `gesehenCents`
// ist der Preis, den die Kundschaft vor dem Kaufknopf gesehen hat,
// `warenwertCents` die Summe der echten Artikelpreise (versandkostenfrei ab).
export async function versandFuerBestellung(env, items, gewaehlteId, gesehenCents, warenwertCents = 0) {
  const paket = paketFuerArtikel(items);
  const ergebnis = versandkostenfreiAnwenden(await versandOptionen(env, paket), warenwertCents);
  const id = safeText(gewaehlteId, 40);
  const gewaehlt = id ? ergebnis.optionen.find(o => o.id === id) : ergebnis.optionen[0];
  if (!gewaehlt) throw new VersandError("VERSAND_OPTION_UNGUELTIG", 409, oeffentlicheOptionen(ergebnis));
  // 0 Cent nur, wenn der Shop den Versand uebernimmt - nie aus Versehen.
  const uebernommen = gewaehlt.preisCents === 0 && Number.isSafeInteger(gewaehlt.listenpreisCents) && gewaehlt.listenpreisCents > 0;
  if (!Number.isSafeInteger(gewaehlt.preisCents) || (gewaehlt.preisCents <= 0 && !uebernommen)) {
    throw new VersandError("VERSAND_NICHT_VERFUEGBAR", 503);
  }
  if (gesehenCents !== undefined && gesehenCents !== null && gesehenCents !== "") {
    if (Number(gesehenCents) !== gewaehlt.preisCents) {
      throw new VersandError("VERSAND_PREIS_GEAENDERT", 409, oeffentlicheOptionen(ergebnis));
    }
  }
  return gewaehlt;
}

// Die gewaehlte Versandart gehoert zur Bestellung - Admin-App und Etikett
// greifen darauf zurueck. Ein zweiter Aufruf (Idempotenz) aendert nichts.
export function versandWahlStatement(db, orderId, gewaehlt, now = new Date().toISOString()) {
  const z = gewaehlt.zustellung && gewaehlt.zustellung.art !== "haustuer" ? gewaehlt.zustellung : null;
  return db.prepare(`INSERT OR IGNORE INTO order_versand
      (order_id,option_id,art,quelle,packlink_service_id,carrier,service_name,paket,preis_cents,laufzeit,created_at,zustellart,abholort_json)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(String(orderId), gewaehlt.id, gewaehlt.art, gewaehlt.quelle, gewaehlt.packlinkServiceId,
      gewaehlt.carrier || null, gewaehlt.serviceName || null, gewaehlt.paket, gewaehlt.preisCents,
      gewaehlt.laufzeit || null, now, z ? z.art : "haustuer", z ? JSON.stringify(z.abholort) : null);
}

export async function versandWahlLaden(env, orderId) {
  if (!env?.DB) return null;
  const row = await env.DB.prepare("SELECT * FROM order_versand WHERE order_id=?").bind(String(orderId)).first();
  if (!row) return null;
  const p = PAKETE[row.paket];
  return {
    optionId: row.option_id,
    art: row.art,
    quelle: row.quelle,
    packlinkServiceId: row.packlink_service_id == null ? null : Number(row.packlink_service_id),
    carrier: row.carrier || null,
    serviceName: row.service_name || null,
    paket: row.paket,
    paketName: p ? p.name : row.paket,
    preisCents: Number(row.preis_cents),
    laufzeit: row.laufzeit || null,
    gewaehltAm: row.created_at,
    zustellart: row.zustellart || "haustuer",
    abholort: (() => { try { return row.abholort_json ? JSON.parse(row.abholort_json) : null; } catch { return null; } })(),
  };
}

// ------------------------------------------------------------ oeffentliche Route

export function artikelIdsAus(wert) {
  const ids = String(wert || "").split(",").map(s => s.trim()).filter(Boolean);
  if (!ids.length || ids.length > MAX_ARTIKEL || ids.some(id => !/^\d{1,9}$/.test(id))) {
    throw new VersandError("ARTIKEL_UNGUELTIG", 400);
  }
  return [...new Set(ids)];
}

// Oeffentlicher Katalog (dieselben Produktart- und Kategoriefelder wie
// data/items.json). Fuer die Anzeige reicht er; beim Bestellen zaehlt der
// echte Artikel aus data/items.json.
async function katalogArtikel(env, ids) {
  if (!katalogCache || katalogCache.bis <= Date.now()) {
    const laden = env.KATALOG_LADEN || (async () => {
      const res = await fetch(KATALOG_URL, { headers: { Accept: "application/json", "User-Agent": "disorder119-shop-worker" } });
      if (!res.ok) throw new Error(`katalog_${res.status}`);
      return res.json();
    });
    const liste = await laden();
    const map = new Map();
    for (const it of Array.isArray(liste) ? liste : []) map.set(String(it.id), it);
    katalogCache = { bis: Date.now() + KATALOG_CACHE_MS, map };
  }
  return ids.map(id => katalogCache.map.get(id)).filter(Boolean);
}

export function isVersandOptionenRoute(url) {
  return url.pathname.replace(/\/+$/, "") === "/versand/optionen";
}

function headers(origin) {
  const out = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
  if (origin && OEFFENTLICHE_ORIGINS.includes(origin)) out["Access-Control-Allow-Origin"] = origin;
  return out;
}

function antwort(daten, status, origin) {
  return new Response(JSON.stringify(daten), { status, headers: headers(origin) });
}

export async function handleVersandOptionen(request, env, url, reqId = crypto.randomUUID(), origin = null) {
  try {
    if (request.method === "OPTIONS") {
      if (origin && !OEFFENTLICHE_ORIGINS.includes(origin)) return new Response(null, { status: 403, headers: headers(null) });
      return new Response(null, { status: 204, headers: headers(origin) });
    }
    if (request.method !== "GET") throw new VersandError("METHOD_NOT_ALLOWED", 405);
    if (origin && !OEFFENTLICHE_ORIGINS.includes(origin)) throw new VersandError("ORIGIN_NOT_ALLOWED", 403);
    if (env.RATE_LIMITER && typeof env.RATE_LIMITER.limit === "function") {
      const ip = request.headers.get("CF-Connecting-IP") || "unknown";
      const ergebnis = await env.RATE_LIMITER.limit({ key: `versand-optionen:${ip}` });
      if (ergebnis && ergebnis.success === false) throw new VersandError("RATE_LIMITED", 429);
    }
    const ids = artikelIdsAus(url.searchParams.get("artikel"));
    let paket = VERSAND.standardGroesse;
    let warenwertCents = 0;
    try {
      const artikel = await katalogArtikel(env, ids);
      // Unbekannte Nummern zaehlen trotzdem mit: zwei Teile bleiben zwei Teile.
      paket = paketFuerArtikel([...artikel, ...Array(Math.max(0, ids.length - artikel.length)).fill({})]);
      // Warenwert wie beim Bestellen: nur verfuegbare Stuecke mit Preis.
      warenwertCents = artikel.filter(it => it.public_status === "AVAILABLE")
        .reduce((summe, it) => summe + (parsePriceToCents(it.price) || 0), 0);
    } catch (err) {
      console.warn(JSON.stringify({ level: "warn", event: "versand_katalog_fehlt", requestId: reqId, code: safeText(err?.message || "unbekannt", 60) }));
    }
    const ergebnis = versandkostenfreiAnwenden(await versandOptionen(env, paket), warenwertCents);
    return antwort({ ok: true, ...oeffentlicheOptionen(ergebnis) }, 200, origin);
  } catch (err) {
    if (err instanceof VersandError) return antwort({ error: err.code, requestId: reqId }, err.status, origin);
    console.error(JSON.stringify({ level: "error", event: "versand_optionen_fehler", requestId: reqId, message: safeText(err?.message || "unknown", 160) }));
    return antwort({ error: "VERSAND_NICHT_VERFUEGBAR", requestId: reqId }, 503, origin);
  }
}

// DHL-Abholorte fuer die Kasse: Packstationen, Postfilialen und Paketshops
// in der Naehe der eingegebenen Adresse (DHL Unified Location Finder).
//
//   GET /versand/abholorte?plz=63739&strasse=Nelseestrasse%2025
//
// Der Schluessel (DHL_PRIVAT_API_KEY, App "Disorder119 Shop") bleibt auf dem
// Server. DHL erlaubt der App 500 Abfragen am Tag - deshalb wird jede
// Antwort je PLZ und Strasse einen Tag zwischengespeichert. An DHL gehen nur
// PLZ und Strasse, nie Name oder E-Mail der Kundin.
//
// Dazu die Pruefung beim Bestellen: Wer an eine Packstation oder Filiale
// bestellt, schickt Nummer, PLZ und Ort des Abholorts und (bei der
// Packstation Pflicht) die DHL-Postnummer. Daraus wird die Lieferadresse,
// wie DHL sie verlangt: "Packstation 123" bzw. "Postfiliale 456", die
// Postnummer im Adresszusatz.
import { safeText } from "./commerce-core.js";
import { bundeslandZurPlz } from "./adresse.js";
import { landAusSchluessel, luftbildFuer } from "./karte.js";

const FINDER = "https://api.dhl.com/location-finder/v1/find-by-address";
const CACHE_SEKUNDEN = 24 * 60 * 60;
const MAX_ORTE = 15;
const OEFFENTLICHE_ORIGINS = Object.freeze([
  "https://disorder119.com",
  "https://www.disorder119.com",
  "http://localhost:8765",
]);

export const ZUSTELLARTEN = Object.freeze(["haustuer", "packstation", "filiale"]);

export class AbholortError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

export function isAbholorteRoute(url) {
  return url.pathname.replace(/\/+$/, "") === "/versand/abholorte";
}

// ------------------------------------------------------------------ DHL-Antwort

// Ein Eintrag des Location Finders -> was die Kasse braucht. Nur Orte, an
// denen man Pakete abholen kann; Packstation (locker) oder Filiale
// (postoffice, servicepoint = DHL Paketshop - beide werden als "Postfiliale"
// adressiert).
export function abholortAus(eintrag) {
  const loc = eintrag?.location || {};
  const typRoh = String(loc.type || "");
  const typ = typRoh === "locker" ? "packstation" : ["postoffice", "servicepoint"].includes(typRoh) ? "filiale" : null;
  if (!typ) return null;
  const dienste = Array.isArray(eintrag.serviceTypes) ? eintrag.serviceTypes.map(String) : [];
  if (dienste.length && !dienste.some(d => /^parcel:pick-up/.test(d))) return null;
  const nummer = String(loc.keywordId || "").trim();
  if (!/^\d{1,4}$/.test(nummer)) return null;
  const adresse = eintrag.place?.address || {};
  const geo = eintrag.place?.geo || {};
  const plz = String(adresse.postalCode || "").trim();
  if (!/^\d{5}$/.test(plz)) return null;
  const lat = Number(geo.latitude);
  const lng = Number(geo.longitude);
  // So steht der Ort auf dem Etikett: "Packstation 162" bzw. "Postfiliale 503"
  // (auch DHL-Paketshops). Bei Paketshops liefert DHL als Namen den Laden
  // ("Kiosk Rana") - der kommt als Zusatz dazu.
  const name = `${typ === "packstation" ? "Packstation" : "Postfiliale"} ${nummer}`;
  const geschaeft = safeText(eintrag.name || "", 100).replace(/\s+/g, " ").trim();
  return {
    id: safeText(loc.ids?.[0]?.locationId || `${typ}-${nummer}-${plz}`, 60),
    typ,
    nummer,
    name,
    ...(geschaeft && geschaeft.toLowerCase() !== name.toLowerCase() ? { geschaeft } : {}),
    strasse: safeText(adresse.streetAddress || "", 100),
    plz,
    ort: safeText(adresse.addressLocality || "", 80),
    lat: Number.isFinite(lat) ? Math.round(lat * 1e6) / 1e6 : null,
    lng: Number.isFinite(lng) ? Math.round(lng * 1e6) / 1e6 : null,
    entfernungM: Number.isFinite(Number(eintrag.distance)) ? Math.round(Number(eintrag.distance)) : null,
  };
}

export function abholorteAus(antwort) {
  const liste = Array.isArray(antwort?.locations) ? antwort.locations : [];
  const gesehen = new Set();
  const out = [];
  for (const eintrag of liste) {
    const ort = abholortAus(eintrag);
    if (!ort) continue;
    const schluessel = `${ort.typ}-${ort.nummer}-${ort.plz}`;
    if (gesehen.has(schluessel)) continue;
    gesehen.add(schluessel);
    out.push(ort);
    if (out.length >= MAX_ORTE) break;
  }
  return out.sort((a, b) => (a.entfernungM ?? 1e9) - (b.entfernungM ?? 1e9));
}

// ------------------------------------------------------------------ Abfrage

function anfrageAus(url) {
  const plz = String(url.searchParams.get("plz") || "").trim();
  if (!/^\d{5}$/.test(plz)) throw new AbholortError("PLZ_UNGUELTIG", 400);
  const strasse = safeText(url.searchParams.get("strasse") || "", 100).replace(/\s+/g, " ").trim();
  return { plz, strasse };
}

async function cacheLesen(schluessel) {
  try {
    if (typeof caches === "undefined" || !caches.default) return null;
    const treffer = await caches.default.match(schluessel);
    return treffer ? await treffer.json() : null;
  } catch {
    return null;
  }
}

async function cacheSchreiben(schluessel, daten) {
  try {
    if (typeof caches === "undefined" || !caches.default) return;
    await caches.default.put(schluessel, new Response(JSON.stringify(daten), {
      headers: { "Content-Type": "application/json", "Cache-Control": `max-age=${CACHE_SEKUNDEN}` },
    }));
  } catch {
    // Ohne Zwischenspeicher geht es auch - nur mit mehr Abfragen bei DHL.
  }
}

export async function abholorteSuchen(env, { plz, strasse }) {
  if (!env?.DHL_PRIVAT_API_KEY) throw new AbholortError("ABHOLORTE_NICHT_EINGERICHTET", 503);
  const schluessel = `https://abholorte.disorder119.intern/v1/${plz}/${encodeURIComponent(strasse.toLowerCase())}`;
  const vorhanden = await cacheLesen(schluessel);
  if (vorhanden) return vorhanden;
  const query = new URLSearchParams({ countryCode: "DE", postalCode: plz, limit: "50", radius: "5000" });
  if (strasse) query.set("streetAddress", strasse);
  let res;
  try {
    res = await fetch(`${FINDER}?${query}`, { headers: { "DHL-API-Key": String(env.DHL_PRIVAT_API_KEY), Accept: "application/json" } });
  } catch {
    throw new AbholortError("DHL_NICHT_ERREICHBAR", 502);
  }
  if (res.status === 401 || res.status === 403) throw new AbholortError("DHL_ZUGANG_ABGELEHNT", 502);
  if (res.status === 429) throw new AbholortError("DHL_LIMIT", 503);
  if (res.status === 404) {
    // DHL meldet "keine Treffer" als 404.
    const leer = { orte: [] };
    await cacheSchreiben(schluessel, leer);
    return leer;
  }
  if (!res.ok) throw new AbholortError("DHL_FEHLER", 502);
  const daten = { orte: abholorteAus(await res.json().catch(() => ({}))) };
  await cacheSchreiben(schluessel, daten);
  return daten;
}

// ------------------------------------------------------------------ Bestellung

// Aus der Kasse: { art, abholort: { typ, nummer, plz, ort, name, strasse }, postnummer }.
// Ohne Angabe: Haustuer.
export function zustellungAus(roh) {
  if (roh === undefined || roh === null) return { art: "haustuer" };
  if (typeof roh !== "object" || Array.isArray(roh)) throw new AbholortError("ZUSTELLUNG_UNGUELTIG", 422);
  const art = String(roh.art || "haustuer");
  if (!ZUSTELLARTEN.includes(art)) throw new AbholortError("ZUSTELLUNG_UNGUELTIG", 422);
  if (art === "haustuer") return { art };
  const o = roh.abholort && typeof roh.abholort === "object" ? roh.abholort : {};
  const zeile = (wert, max) => safeText(wert, max).replace(/\s+/g, " ").trim();
  const abholort = {
    typ: art,
    nummer: zeile(o.nummer, 4),
    name: zeile(o.name, 100),
    strasse: zeile(o.strasse, 100),
    plz: zeile(o.plz, 5),
    ort: zeile(o.ort, 80),
  };
  if (!/^\d{1,4}$/.test(abholort.nummer) || !/^\d{5}$/.test(abholort.plz) || abholort.ort.length < 2) {
    throw new AbholortError("ABHOLORT_UNVOLLSTAENDIG", 422);
  }
  const postnummer = String(roh.postnummer ?? "").replace(/\s+/g, "");
  if (postnummer && !/^\d{6,10}$/.test(postnummer)) throw new AbholortError("POSTNUMMER_UNGUELTIG", 422);
  if (art === "packstation" && !postnummer) throw new AbholortError("POSTNUMMER_FEHLT", 422);
  return { art, abholort, postnummer: postnummer || null };
}

// Lieferadresse fuer PayPal, Bestellung und Etikett, wie DHL sie verlangt.
export function abholadresse(name, zustellung) {
  const n = safeText(name, 120).replace(/\s+/g, " ").trim();
  if (!(n.length >= 3 && /\s/.test(n))) throw new AbholortError("ADRESSE_UNVOLLSTAENDIG", 422);
  const { abholort, postnummer } = zustellung;
  return {
    name: n,
    strasse: zustellung.art === "packstation" ? "Packstation" : "Postfiliale",
    hausnummer: abholort.nummer,
    zusatz: postnummer ? `Postnummer ${postnummer}` : "",
    plz: abholort.plz,
    ort: abholort.ort,
    land: "DE",
  };
}

// ------------------------------------------------------------------ Route

function kopf(origin) {
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

export async function handleAbholorte(request, env, url, reqId = crypto.randomUUID(), origin = null) {
  try {
    if (request.method === "OPTIONS") {
      if (origin && !OEFFENTLICHE_ORIGINS.includes(origin)) return new Response(null, { status: 403, headers: kopf(null) });
      return new Response(null, { status: 204, headers: kopf(origin) });
    }
    if (request.method !== "GET") throw new AbholortError("METHOD_NOT_ALLOWED", 405);
    if (origin && !OEFFENTLICHE_ORIGINS.includes(origin)) throw new AbholortError("ORIGIN_NOT_ALLOWED", 403);
    if (env.RATE_LIMITER && typeof env.RATE_LIMITER.limit === "function") {
      const ip = request.headers.get("CF-Connecting-IP") || "unknown";
      const r = await env.RATE_LIMITER.limit({ key: `abholorte:${ip}` });
      if (r && r.success === false) throw new AbholortError("RATE_LIMITED", 429);
    }
    const anfrage = anfrageAus(url);
    const daten = await abholorteSuchen(env, anfrage);
    // luftbild: { land, quelle } fuer die amtlichen Luftbilder des Bundeslands
    // der gesuchten PLZ (karte.js) - oder false, dann nur die Strassenkarte.
    const luftbild = daten.orte.length ? luftbildFuer(landAusSchluessel(await bundeslandZurPlz(env, anfrage.plz))) : false;
    return new Response(JSON.stringify({ ok: true, ...daten, luftbild }), { status: 200, headers: kopf(origin) });
  } catch (err) {
    const bekannt = err instanceof AbholortError;
    if (!bekannt) {
      console.error(JSON.stringify({ level: "error", event: "abholorte_fehler", requestId: reqId, message: safeText(err?.message || "unknown", 160) }));
    }
    return new Response(JSON.stringify({ error: bekannt ? err.code : "ABHOLORTE_FEHLER", requestId: reqId }), {
      status: bekannt ? err.status : 502,
      headers: kopf(origin),
    });
  }
}

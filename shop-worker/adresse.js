// Adressvorschlaege fuer die Kasse: zur PLZ der Ort, zum Strassenanfang die
// passenden Strassen - damit sich niemand bei der Lieferadresse vertippt.
//
// Quelle ist die OpenPLZ API (openplzapi.org, offene Daten aus amtlichen
// Verzeichnissen, kostenlos, ohne Schluessel). Der Browser fragt nur unseren
// Server; der gibt an OpenPLZ allein Postleitzahl und Strassenanfang weiter -
// keine Namen, keine Hausnummern, keine IP-Adressen der Kundschaft.
//
//   GET /adresse/vorschlag?plz=63739               -> { orte: ["Aschaffenburg"] }
//   GET /adresse/vorschlag?plz=63739&strasse=Nel   -> { strassen: ["Nelseestraße"] }
import { safeText } from "./commerce-core.js";

const API = "https://openplzapi.org/de";
const CACHE_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX = 800;
const MAX_STRASSEN = 8;
const OEFFENTLICHE_ORIGINS = Object.freeze([
  "https://disorder119.com",
  "https://www.disorder119.com",
  "http://localhost:8765",
]);

let cache = new Map();

export class AdresseError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

// Nur fuer Tests.
export function adresseCacheLeeren() {
  cache = new Map();
}

// Das amtliche Verzeichnis kuerzt "Straße" ab ("Nelseestr."). Auf dem Etikett
// und in der Kasse soll es ausgeschrieben stehen.
export function strassennameAus(name) {
  return String(name || "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/(^|[\s-])Str\.$/, "$1Straße")
    .replace(/str\.$/, "straße");
}

export function plzAus(wert) {
  const plz = String(wert || "").trim();
  if (!/^\d{5}$/.test(plz)) throw new AdresseError("PLZ_UNGUELTIG", 400);
  return plz;
}

export function strassenanfangAus(wert) {
  const text = safeText(wert, 40).replace(/\s+/g, " ").trim();
  if (!text) return "";
  if (text.length < 2 || !/^[\p{L}\d .'-]+$/u.test(text)) throw new AdresseError("STRASSE_UNGUELTIG", 400);
  return text;
}

async function openplz(env, pfad) {
  const treffer = cache.get(pfad);
  if (treffer && treffer.bis > Date.now()) return treffer.daten;
  const laden = env.OPENPLZ_LADEN || (async url => {
    const res = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "disorder119-shop-worker" } });
    if (!res.ok) throw new AdresseError("ADRESSDIENST_NICHT_ERREICHBAR", 502);
    return res.json();
  });
  const daten = await laden(`${API}${pfad}`);
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(pfad, { bis: Date.now() + CACHE_MS, daten });
  return daten;
}

export async function orteZurPlz(env, plz) {
  const liste = await openplz(env, `/Localities?postalCode=${encodeURIComponent(plz)}`);
  return [...new Set((Array.isArray(liste) ? liste : []).map(o => safeText(o?.name, 80)).filter(Boolean))];
}

export async function strassenZurPlz(env, plz, anfang) {
  const pfad = `/Streets?name=${encodeURIComponent(anfang)}&postalCode=${encodeURIComponent(plz)}&page=1&pageSize=20`;
  const liste = await openplz(env, pfad);
  const namen = (Array.isArray(liste) ? liste : [])
    .map(s => strassennameAus(safeText(s?.name, 100)))
    .filter(Boolean);
  return [...new Set(namen)].sort((a, b) => a.localeCompare(b, "de")).slice(0, MAX_STRASSEN);
}

export function isAdresseRoute(url) {
  return url.pathname.replace(/\/+$/, "") === "/adresse/vorschlag";
}

function headers(origin) {
  const out = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
  if (origin && OEFFENTLICHE_ORIGINS.includes(origin)) out["Access-Control-Allow-Origin"] = origin;
  return out;
}

function antwort(daten, status, origin) {
  return new Response(JSON.stringify(daten), { status, headers: headers(origin) });
}

export async function handleAdresse(request, env, url, reqId = crypto.randomUUID(), origin = null) {
  try {
    if (request.method === "OPTIONS") {
      if (origin && !OEFFENTLICHE_ORIGINS.includes(origin)) return new Response(null, { status: 403, headers: headers(null) });
      return new Response(null, { status: 204, headers: headers(origin) });
    }
    if (request.method !== "GET") throw new AdresseError("METHOD_NOT_ALLOWED", 405);
    if (origin && !OEFFENTLICHE_ORIGINS.includes(origin)) throw new AdresseError("ORIGIN_NOT_ALLOWED", 403);
    if (env.RATE_LIMITER && typeof env.RATE_LIMITER.limit === "function") {
      const ip = request.headers.get("CF-Connecting-IP") || "unknown";
      const ergebnis = await env.RATE_LIMITER.limit({ key: `adresse:${ip}` });
      if (ergebnis && ergebnis.success === false) throw new AdresseError("RATE_LIMITED", 429);
    }
    const plz = plzAus(url.searchParams.get("plz"));
    const anfang = strassenanfangAus(url.searchParams.get("strasse"));
    if (anfang) return antwort({ ok: true, plz, strassen: await strassenZurPlz(env, plz, anfang) }, 200, origin);
    return antwort({ ok: true, plz, orte: await orteZurPlz(env, plz) }, 200, origin);
  } catch (err) {
    if (err instanceof AdresseError) return antwort({ error: err.code, requestId: reqId }, err.status, origin);
    console.warn(JSON.stringify({ level: "warn", event: "adresse_vorschlag_fehler", requestId: reqId, message: safeText(err?.message || "unknown", 120) }));
    return antwort({ error: "ADRESSDIENST_NICHT_ERREICHBAR", requestId: reqId }, 502, origin);
  }
}

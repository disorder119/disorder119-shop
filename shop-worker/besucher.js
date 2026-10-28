import { sichtzeitBody, sichtzeitSpeichern, zeitIntervalle, zeitGruppen, sichtzeitIndex, sichtzeitZwischen, verbundeneZeiten, vereinigteZeit } from "./besucher-sichtzeit.js";
// Live-Besucher: der Shop meldet Seitenaufrufe, angesehene Artikel,
// Warenkorb-Aenderungen und geoeffnete Anfragen an POST /besuch. Der Worker
// legt sie in D1 ab und zeigt sie der Admin-App unter /admin/besucher/*.
// Telegram bekommt je Besuch genau EINE Zusammenfassung, erst wenn der
// Besucher gegangen ist (besucher-sitzung.js, besucher-zusammenfassung.js).
//
// Zwei Quellen: Ohne Einwilligung meldet nur der Storefront-Worker jeden
// echten Seitenaufruf (seitenaufrufAnnehmen, ohne Skript und ohne Stadt).
// Erst mit Einwilligung kommt assets/besucher.js dazu: Artikel im Overlay,
// Seitenwechsel ohne Neuladen, Warenkorb, Anfragen, Verweildauer, Stadt,
// Abschied beim Schliessen und die Besuchszahl aus dem Browser-Speicher.
//
// Datenschutz: keine Cookies, keine IP in der Datenbank oder in Telegram.
// Der Besucher-Schluessel ist ein Hash aus IP, Browserkennung und einem
// Tagessalz, das der Cron nach Tagesende loescht. Ort (Stadt/Region/Land)
// kommt grob aus request.cf. Browser mit "Do Not Track" oder Global Privacy
// Control senden gar nichts (siehe assets/besucher.js und storefront-edge.js).
// Lesbare Namen ("iPhone · Hamburg (Fuchs)") entstehen nur zur Anzeige aus
// Geraet, Ort und dem Tages-Schluessel; das Tier wechselt mit dem Tagessalz.
import { safeText } from "./commerce-core.js";
import { SITZUNG_GRENZE, sitzungBeruehren, wiederkehrAusBody } from "./besucher-sitzung.js";
import { kontingentBelegen } from "./kontingent.js";
import { anschlussVonIp, ipPepper } from "./privacy-security.js";
import { geoSperrListe } from "./geo-sperre.js";

const SHOP_ORIGINS = Object.freeze([
  "https://disorder119.com",
  "https://www.disorder119.com",
  "http://localhost:8765",
  "http://127.0.0.1:8765",
]);
const ADMIN_ORIGINS = Object.freeze([
  "https://admin.disorder119.com",
  "http://localhost:8765",
  "http://127.0.0.1:8765",
]);

export const BESUCHER_TYPEN = Object.freeze(["seite", "artikel", "warenkorb_rein", "warenkorb_raus", "anfrage"]);
const KANAELE = Object.freeze(["whatsapp", "email", "gmail", "paypal"]);
const SPRACHEN = Object.freeze(["de", "en", "fr"]);
const MAX_BODY = 2048;
const SITZUNG_MS = 30 * 60 * 1000;
const STANDARD_AUFBEWAHRUNG_TAGE = 30;
const KATALOG_CACHE_MS = 10 * 60 * 1000;

const BOT_UA = /bot\b|bot\/|crawl|spider|slurp|headless|lighthouse|pagespeed|preview|facebookexternalhit|whatsapp|telegram|discord|curl|wget|python|node-fetch|undici|go-http|java\/|okhttp|axios|postman|monitor|uptime/i;

class BesucherError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

// ---------------------------------------------------------------- Einstellungen

function schalter(env, name) {
  return String(env?.[name] ?? "").trim().toLowerCase();
}

export function besucherAktiv(env) {
  return !["aus", "false", "0", "off", "nein"].includes(schalter(env, "BESUCHER_TRACKING"));
}

// "zusammenfassung" (Standard): je Besuch eine Nachricht, wenn er vorbei ist.
// "aus": nichts. Fruehere Werte ("wichtig", "alles") gelten als Zusammenfassung.
export function telegramModus(env) {
  const wert = schalter(env, "BESUCHER_TELEGRAM");
  if (["aus", "false", "0", "off", "nein"].includes(wert)) return "aus";
  return "zusammenfassung";
}

function ganzzahl(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n) || String(value ?? "").trim() === "") return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

// ---------------------------------------------------------------- Hilfen

function sicherheitsHeader() {
  return {
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  };
}

function corsHeader(origin, erlaubt, methoden) {
  const headers = {
    "Access-Control-Allow-Methods": methoden,
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
  if (origin && erlaubt.includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    if (erlaubt === ADMIN_ORIGINS) headers["Access-Control-Allow-Credentials"] = "true";
  }
  return headers;
}

function json(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...sicherheitsHeader(), ...corsHeader(origin, ADMIN_ORIGINS, "GET, OPTIONS") },
  });
}

function leer(origin) {
  return new Response(null, { status: 204, headers: { ...sicherheitsHeader(), ...corsHeader(origin, SHOP_ORIGINS, "POST, OPTIONS") } });
}

function kurz(value, max) {
  const text = safeText(value, max);
  return text || null;
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value)));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
}

function zufall(bytes = 24) {
  const data = new Uint8Array(bytes);
  crypto.getRandomValues(data);
  return Array.from(data, b => b.toString(16).padStart(2, "0")).join("");
}

function tagUtc(now) {
  return new Date(now).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------- Einordnung

export function geraetUndBrowser(userAgent) {
  const ua = String(userAgent || "");
  let geraet = "Computer";
  if (/iPad/i.test(ua) || (/Macintosh/i.test(ua) && /Mobile/i.test(ua))) geraet = "iPad";
  else if (/iPhone|iPod/i.test(ua)) geraet = "iPhone";
  else if (/Android/i.test(ua)) geraet = /Mobile/i.test(ua) ? "Android-Handy" : "Android-Tablet";
  else if (/Windows/i.test(ua)) geraet = "Windows-PC";
  else if (/Macintosh|Mac OS X/i.test(ua)) geraet = "Mac";
  else if (/Linux|CrOS/i.test(ua)) geraet = "Linux-PC";

  let browser = "Browser";
  if (/Instagram/i.test(ua)) browser = "Instagram-App";
  else if (/FBAN|FBAV|FB_IAB/i.test(ua)) browser = "Facebook-App";
  else if (/TikTok|musical_ly|BytedanceWebview/i.test(ua)) browser = "TikTok-App";
  else if (/SamsungBrowser/i.test(ua)) browser = "Samsung Internet";
  else if (/Edg\//i.test(ua)) browser = "Edge";
  else if (/OPR\/|Opera/i.test(ua)) browser = "Opera";
  else if (/Firefox\/|FxiOS/i.test(ua)) browser = "Firefox";
  else if (/Chrome\/|CriOS/i.test(ua)) browser = "Chrome";
  else if (/Safari\//i.test(ua)) browser = "Safari";
  return { geraet, browser, system: systemAus(ua, geraet) };
}

// Betriebssystem mit Hauptversion, so grob wie die Browserkennung es hergibt
// (macOS und Windows 10/11 melden ihre Version ohnehin nicht genauer).
export function systemAus(userAgent, geraet = null) {
  const ua = String(userAgent || "");
  const g = geraet || geraetUndBrowser(ua).geraet;
  if (g === "iPhone" || g === "iPad") {
    const v = /(?:iPhone OS|CPU OS|iOS) (\d{1,2})[_.]/i.exec(ua)?.[1];
    const name = g === "iPad" ? "iPadOS" : "iOS";
    return v ? `${name} ${v}` : name;
  }
  if (/Android/i.test(ua)) {
    const v = /Android (\d{1,2})/i.exec(ua)?.[1];
    return v ? `Android ${v}` : "Android";
  }
  if (/Windows NT 10\.0/i.test(ua)) return "Windows 10/11";
  if (/Windows NT 6\.3/i.test(ua)) return "Windows 8.1";
  if (/Windows NT 6\.[12]/i.test(ua)) return "Windows 7/8";
  if (/Windows/i.test(ua)) return "Windows";
  if (/CrOS/i.test(ua)) return "ChromeOS";
  if (/Macintosh|Mac OS X/i.test(ua)) return "macOS";
  if (/Linux/i.test(ua)) return "Linux";
  return null;
}

// Nur der erste Sprachcode aus Accept-Language ("de-DE,de;q=0.9" -> "de").
export function browserSpracheAus(value) {
  const treffer = /^\s*([a-z]{2,3})(?:[-_][a-z0-9]{1,8})*\s*(?:[;,]|$)/i.exec(String(value || ""));
  return treffer ? treffer[1].toLowerCase() : null;
}

export function spracheName(code) {
  const c = String(code || "").toLowerCase();
  if (!/^[a-z]{2,3}$/.test(c)) return null;
  try {
    return new Intl.DisplayNames(["de"], { type: "language" }).of(c) || c;
  } catch {
    return c;
  }
}

// Kampagne aus utm_source/utm_campaign des Einstiegslinks ("instagram/herbst").
function kampagnenTeil(value) {
  const text = String(value || "").trim().toLowerCase().slice(0, 40);
  return /^[a-z0-9][a-z0-9._-]*$/.test(text) ? text : "";
}
export function kampagneAus(quelle, kampagne) {
  const teile = [kampagnenTeil(quelle), kampagnenTeil(kampagne)].filter(Boolean);
  return teile.length ? teile.join("/") : null;
}

// ---------------------------------------------------------------- Lesbare Namen

const TIERE = Object.freeze([
  "Fuchs", "Luchs", "Otter", "Dachs", "Falke", "Reh", "Igel", "Biber", "Eule", "Wolf", "Hase", "Kranich",
  "Specht", "Möwe", "Robbe", "Elch", "Bär", "Marder", "Wiesel", "Hirsch", "Kauz", "Adler", "Rabe", "Schwan",
  "Storch", "Panda", "Koala", "Lama", "Zebra", "Tiger", "Puma", "Gecko", "Delfin", "Wal", "Pinguin", "Kolibri",
  "Flamingo", "Gepard", "Jaguar", "Steinbock", "Gämse", "Murmeltier", "Seehund", "Papagei", "Libelle", "Hummel",
  "Eisvogel", "Waschbär",
]);

// Tages-Spitzname aus dem Schluessel: unterscheidet zwei "iPhone · Deutschland"
// am selben Tag. Wechselt mit dem Tagessalz, wie der Schluessel selbst.
export function besucherTier(schluessel) {
  const hex = String(schluessel || "").replace(/[^0-9a-f]/gi, "").slice(0, 8);
  if (!hex) return TIERE[0];
  return TIERE[parseInt(hex, 16) % TIERE.length];
}

export function besucherName({ geraet, stadt, land } = {}) {
  const ort = stadt || landName(land) || "Ort unbekannt";
  return `${geraet || "Gerät unbekannt"} · ${ort}`;
}

export function besucherLabel(schluessel, info = {}) {
  return `${besucherName(info)} (${besucherTier(schluessel)})`;
}

export function istBot(userAgent) {
  const ua = String(userAgent || "");
  return !ua || BOT_UA.test(ua);
}

// Nur der Hostname der Herkunftsseite, eigene Seiten zaehlen nicht.
export function quelleAus(referrer) {
  try {
    const host = new URL(String(referrer || "")).hostname.toLowerCase().replace(/^www\./, "");
    if (!host || host === "disorder119.com" || host.endsWith(".disorder119.com")) return null;
    if (host === "l.instagram.com") return "instagram.com";
    if (/^(l|lm|m)\.facebook\.com$/.test(host)) return "facebook.com";
    return host.slice(0, 80);
  } catch {
    return null;
  }
}

// Nur vorhandene Verweis-Domains auswerten; keine neuen Besuchermerkmale.
// Fehlende Herkunft ist kein Beweis fuer einen direkten Aufruf.
export function herkunftAus(quelle) {
  const unbekannt = { kanal: "unbekannt", name: "Direkt oder unbekannt", domain: null, beleg: "nicht_uebermittelt" };
  const host = String(quelle || "").trim().toLowerCase().replace(/^www\./, "");
  if (!host || host === "direkt" || host === "unbekannt" || host.length > 80 ||
      !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(host) || !host.includes(".") ||
      host === "disorder119.com" || host.endsWith(".disorder119.com")) return unbekannt;
  const ist = domain => host === domain || host.endsWith("." + domain);
  let kanal = "andere", name = "Andere Websites";
  if (ist("instagram.com")) { kanal = "instagram"; name = "Instagram"; }
  else if (/^(?:[a-z0-9-]+\.)?google\.(?:com|de|fr|at|ch|it|es|nl|be|co\.uk|com\.au|co\.jp)$/.test(host)) { kanal = "google"; name = "Google"; }
  else if (ist("tiktok.com")) { kanal = "tiktok"; name = "TikTok"; }
  else if (ist("facebook.com") || ist("fb.com")) { kanal = "facebook"; name = "Facebook"; }
  else if (ist("bing.com")) { kanal = "bing"; name = "Bing"; }
  else if (ist("duckduckgo.com")) { kanal = "duckduckgo"; name = "DuckDuckGo"; }
  else if (ist("pinterest.com") || ist("pinterest.de") || ist("pin.it")) { kanal = "pinterest"; name = "Pinterest"; }
  else if (ist("youtube.com") || ist("youtu.be")) { kanal = "youtube"; name = "YouTube"; }
  else if (ist("ebay.de") || ist("ebay.com")) { kanal = "ebay"; name = "eBay"; }
  else if (ist("linktr.ee")) { kanal = "linktree"; name = "Linktree"; }
  else if (ist("chatgpt.com") || ist("chat.openai.com")) { kanal = "chatgpt"; name = "ChatGPT"; }
  return { kanal, name, domain: host, beleg: "verweis_domain" };
}

function pfadAus(value) {
  const text = String(value || "").trim();
  if (!text.startsWith("/") || text.startsWith("//")) return "/";
  return text.split(/[?#]/)[0].slice(0, 200) || "/";
}

function artikelIdAus(value) {
  const text = String(value ?? "").trim();
  return /^\d{1,9}$/.test(text) ? text : null;
}

export function landName(code) {
  const c = String(code || "").toUpperCase();
  if (!/^[A-Z]{2}$/.test(c)) return null;
  try {
    return new Intl.DisplayNames(["de"], { type: "region" }).of(c) || c;
  } catch {
    return c;
  }
}

// ---------------------------------------------------------------- Katalog

let katalogCache = { bis: 0, map: null };

export function katalogCacheLeeren() {
  katalogCache = { bis: 0, map: null };
}

async function katalog(env) {
  const jetzt = Date.now();
  if (katalogCache.map && katalogCache.bis > jetzt) return katalogCache.map;
  const basis = String(env?.SHOP_PUBLIC_URL || "https://disorder119.com").replace(/\/+$/, "");
  try {
    const res = await fetch(`${basis}/data/catalog.json`, { cf: { cacheTtl: 600, cacheEverything: true } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const liste = await res.json();
    const map = new Map();
    // Overlay-Ereignisse tragen die Katalog-ID, Produktseiten-Adressen die
    // Artikelnummer (url_slug): beide fuehren zum selben Eintrag.
    for (const it of Array.isArray(liste) ? liste : []) {
      if (it && it.id !== undefined) map.set(String(it.id), it);
    }
    for (const it of Array.isArray(liste) ? liste : []) {
      for (const key of [it?.url_slug, it?.article]) {
        if (key !== undefined && key !== null && /^\d{1,9}$/.test(String(key)) && !map.has(String(key))) map.set(String(key), it);
      }
    }
    katalogCache = { bis: jetzt + KATALOG_CACHE_MS, map };
    return map;
  } catch {
    // Ohne Katalog laufen die Meldungen mit Artikelnummer statt Titel weiter.
    katalogCache = { bis: jetzt + 60_000, map: katalogCache.map || new Map() };
    return katalogCache.map;
  }
}
export const katalogLaden = katalog;

// Dem Inhaber zeigen wir die Artikelnummer (#238), nicht die Katalog-ID.
export function artikelNummer(artikelId, it) {
  const nr = it?.article ?? it?.url_slug;
  return nr !== undefined && nr !== null && String(nr).trim() ? String(nr).trim() : String(artikelId || "");
}

export function euro(preis) {
  const n = Number(preis);
  return Number.isFinite(n) && n > 0 ? `${n.toLocaleString("de-DE")} €` : "";
}

// Seit dem festen Namensschema beginnt der Titel meist schon mit der Marke;
// dann nicht noch einmal davorsetzen.
export function artikelName(it) {
  const titel = String(it?.title || "").trim();
  const marke = String(it?.brand || "").trim();
  const name = marke && !titel.toLowerCase().startsWith(marke.toLowerCase())
    ? [marke, titel].filter(Boolean).join(" – ")
    : titel || marke;
  return safeText(name, 160);
}

export function artikelText(artikelId, it) {
  if (!artikelId) return "";
  if (!it) return `Artikel ${artikelId}`;
  const name = artikelName(it);
  const preis = euro(it.price);
  return `#${artikelNummer(artikelId, it)} ${safeText(name, 120)}${preis ? ` (${preis})` : ""}`;
}

// ---------------------------------------------------------------- Besucher-Schluessel

async function tagesSalz(env, now) {
  const tag = tagUtc(now);
  const vorhanden = await env.DB.prepare("SELECT salz FROM besucher_salz WHERE tag=?").bind(tag).first();
  if (vorhanden?.salz) return vorhanden.salz;
  const angelegt = await env.DB.prepare("INSERT OR IGNORE INTO besucher_salz (tag, salz) VALUES (?, ?)").bind(tag, zufall()).run();
  // Erster Besuch des Tages raeumt auf: altes Salz und Ereignisse ueber der
  // Aufbewahrungsfrist verschwinden, auch wenn kein Cron-Trigger laeuft.
  if (Number(angelegt?.meta?.changes || 0) > 0) {
    await besucherAufraeumen(env, now).catch(err => console.error(JSON.stringify({
      level: "error", event: "besucher_cleanup_failed", message: String(err?.message || err).slice(0, 160),
    })));
  }
  const neu = await env.DB.prepare("SELECT salz FROM besucher_salz WHERE tag=?").bind(tag).first();
  return neu.salz;
}

// Derselbe Schluessel fuer Skript- und Server-Meldungen: so landen beide in
// derselben Sitzung.
async function schluesselAus(env, ip, ua, now) {
  const salz = await tagesSalz(env, now);
  return (await sha256Hex(`${salz}|${ip}|${ua}`)).slice(0, 20);
}

async function besucherSchluessel(env, request, now) {
  return schluesselAus(env, request.headers.get("CF-Connecting-IP") || "", request.headers.get("User-Agent") || "", now);
}

export function besucherKuerzel(schluessel) {
  return `#${String(schluessel || "").slice(0, 4).toUpperCase()}`;
}

// ---------------------------------------------------------------- Annahme

export function ereignisAusBody(raw) {
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new BesucherError("INVALID_JSON", 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new BesucherError("INVALID_JSON", 400);
  const typ = String(body.t || "");
  // w=1: Seitenwechsel innerhalb des Shops (Link geklickt) - nur fuer die
  // Verweildauer, kein Abschied.
  if (typ === "verlassen") return { typ, pfad: pfadAus(body.p), weiter: body.w === 1 };
  if (!BESUCHER_TYPEN.includes(typ)) throw new BesucherError("INVALID_TYPE", 400);
  const artikelId = artikelIdAus(body.a);
  if (["artikel", "warenkorb_rein", "warenkorb_raus"].includes(typ) && !artikelId) {
    throw new BesucherError("ARTICLE_REQUIRED", 400);
  }
  const kanal = KANAELE.includes(String(body.k || "")) ? String(body.k) : null;
  const sprache = SPRACHEN.includes(String(body.l || "")) ? String(body.l) : null;
  return {
    typ,
    pfad: pfadAus(body.p),
    artikelId,
    warenkorb: ganzzahl(body.n, 0, 0, 999),
    kanal: typ === "anfrage" ? kanal : null,
    quelle: quelleAus(body.r),
    sprache,
  };
}

// Ein Ereignis speichern. Fehlen die Spalten aus Migration 0040 noch, wird
// ohne Betriebssystem/Browsersprache/Kampagne gespeichert statt gar nicht.
async function ereignisSpeichern(env, e, server) {
  const basis = [e.besucher, e.zeit, e.typ, e.pfad, e.artikelId, e.titel, e.warenkorb, e.kanal, e.quelle, e.sprache,
    e.land, server ? null : e.region, server ? null : e.stadt, e.geraet, e.browser];
  try {
    return await env.DB.prepare(`INSERT INTO besucher_ereignisse
      (besucher, zeit, typ, pfad, artikel_id, titel, warenkorb, kanal, quelle, sprache, land, region, stadt, geraet, browser, gemeldet, server, system, browser_sprache, kampagne)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?,?,?)`)
      .bind(...basis, server ? 1 : 0, e.system || null, e.browserSprache || null, e.kampagne || null).run();
  } catch (err) {
    if (!/no such column/i.test(String(err?.message || err))) throw err;
    return env.DB.prepare(`INSERT INTO besucher_ereignisse
      (besucher, zeit, typ, pfad, artikel_id, titel, warenkorb, kanal, quelle, sprache, land, region, stadt, geraet, browser, gemeldet${server ? ", server" : ""})
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0${server ? ",1" : ""})`).bind(...basis).run();
  }
}

// Obergrenze fuer NEUE Besuche je Anschluss (IPv6 je /64) und Tag sowie
// insgesamt: ein Skript mit wechselnder Browserkennung oder IPv6-Adresse legt
// sonst beliebig viele Besuche an (D1-Schreiblast, Telegram-Zusammenfassungen).
// Gezaehlt mit einem Hash des Anschlusses (kontingent.js, nach einem Tag weg).
// Faellt die Zaehlung aus, wird gezaehlt wie bisher (nur Statistik).
function neuerBesuch(env, ip, now) {
  return async () => {
    try {
      const netz = anschlussVonIp(ip);
      if (!netz || !env?.DB) return true;
      const schluessel = await sha256Hex(`besuch-neu:${netz}:${ipPepper(env)}`);
      const belegt = await kontingentBelegen(env.DB, {
        art: "besuch-neu",
        schluessel,
        jeSchluessel: zahlAus(env?.BESUCHER_NEU_JE_ANSCHLUSS, 60, 5, 1000),
        gesamt: zahlAus(env?.BESUCHER_NEU_GESAMT, 5000, 100, 100000),
        jetzt: new Date(now),
      });
      return belegt.ok;
    } catch {
      return true;
    }
  };
}

function zahlAus(wert, standard, min, max) {
  const n = Number(wert);
  if (!Number.isFinite(n) || String(wert ?? "").trim() === "") return standard;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

export async function besuchAnnehmen(request, env, ctx, now = Date.now()) {
  const origin = request.headers.get("Origin");
  if (request.method === "OPTIONS") {
    if (origin && !SHOP_ORIGINS.includes(origin)) return new Response(null, { status: 403, headers: sicherheitsHeader() });
    return leer(origin);
  }
  if (request.method !== "POST") throw new BesucherError("METHOD_NOT_ALLOWED", 405);
  // Echte Browser senden bei POST immer einen Origin-Header mit.
  if (!origin || !SHOP_ORIGINS.includes(origin)) throw new BesucherError("ORIGIN_NOT_ALLOWED", 403);

  const ua = request.headers.get("User-Agent") || "";
  if (!besucherAktiv(env) || !env.DB || istBot(ua)) return leer(origin);

  if (env.RATE_LIMITER && typeof env.RATE_LIMITER.limit === "function") {
    // Je Anschluss (IPv6 je /64): neue Adressen im selben Netz helfen nicht.
    const ip = anschlussVonIp(request.headers.get("CF-Connecting-IP")) || "unknown";
    const result = await env.RATE_LIMITER.limit({ key: `besuch:${ip}` });
    if (result && result.success === false) throw new BesucherError("RATE_LIMITED", 429);
  }

  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY) throw new BesucherError("REQUEST_TOO_LARGE", 413);
  // No statistics, day identifier, cart events or Telegram before opt-in.
  // Version 1: aeltere, noch zwischengespeicherte Skripte (ohne Besuchszahl).
  let consentBody;
  try { consentBody = JSON.parse(raw); } catch { throw new BesucherError("INVALID_JSON",400); }
  if (![1, 2].includes(consentBody?.consentVersion)) return leer(origin);
  if (consentBody.t === "sichtzeit") {
    if (!sichtzeitBody(consentBody)) throw new BesucherError("INVALID_VISIBLE_TIME",400);
    const besucher = await besucherSchluessel(env, request, now);
    // Sichtbare Zeit ist ein Lebenszeichen: der Besuch laeuft noch.
    const sitzung = await sitzungBeruehren(env, ctx, { besucher, einwilligung: true,
      neuErlaubt: neuerBesuch(env, request.headers.get("CF-Connecting-IP"), now) }, now);
    if (sitzung === SITZUNG_GRENZE) return leer(origin);
    if (!await sichtzeitSpeichern(env,besucher,consentBody,now)) throw new BesucherError("INVALID_VISIBLE_TIME",400);
    return leer(origin);
  }
  const daten = ereignisAusBody(raw);
  if (daten.typ === "verlassen") {
    // Zeitpunkt fuer die Verweildauer; ausser beim Wechsel auf eine andere
    // Shop-Seite zugleich der Abschied (Zusammenfassung nach wenigen Minuten).
    const besucher = await besucherSchluessel(env, request, now);
    try {
      await env.DB.prepare("INSERT INTO besucher_verlassen (besucher, zeit, pfad) VALUES (?,?,?)")
        .bind(besucher, new Date(now).toISOString(), daten.pfad).run();
    } catch {
      // Migration 0020 noch nicht eingespielt: ohne Verweildauer weiter.
    }
    if (!daten.weiter) await sitzungBeruehren(env, ctx, { besucher, einwilligung: true, abschied: true }, now);
    return leer(origin);
  }
  const cf = request.cf || {};
  const { geraet, browser, system } = geraetUndBrowser(ua);
  const besucher = await besucherSchluessel(env, request, now);
  const sitzung = await sitzungBeruehren(env, ctx, { besucher, einwilligung: true, wiederkehr: wiederkehrAusBody(consentBody),
    neuErlaubt: neuerBesuch(env, request.headers.get("CF-Connecting-IP"), now) }, now);
  if (sitzung === SITZUNG_GRENZE) return leer(origin);
  if (consentBody.s === 1 && ["seite", "artikel"].includes(daten.typ)
    && await vomServerGezaehlt(env, besucher, daten, now)) return leer(origin);
  const map = daten.artikelId ? await katalog(env) : new Map();
  const eintrag = daten.artikelId ? map.get(daten.artikelId) : null;

  await ereignisSpeichern(env, {
    ...daten,
    besucher,
    zeit: new Date(now).toISOString(),
    titel: eintrag ? artikelName(eintrag) || null : null,
    land: kurz(cf.country, 2),
    region: kurz(cf.region, 80),
    stadt: kurz(cf.city, 80),
    geraet,
    browser,
    system,
    browserSprache: browserSpracheAus(request.headers.get("Accept-Language")),
  }, false);
  return leer(origin);
}

// Das Startereignis von assets/besucher.js (s=1) meldet denselben
// Seitenaufruf, den der Storefront-Worker schon gezaehlt hat. Produktseiten
// speichert der Server unter der Katalog-ID, das Skript schickt sie auch so.
async function vomServerGezaehlt(env, besucher, daten, now) {
  try {
    const row = await env.DB.prepare(`SELECT 1 AS da FROM besucher_ereignisse
      WHERE besucher=? AND server=1 AND typ=? AND pfad=? AND zeit>=? LIMIT 1`)
      .bind(besucher, daten.typ, daten.pfad, new Date(now - SITZUNG_MS).toISOString()).first();
    return Boolean(row);
  } catch {
    // Migration 0034 noch nicht eingespielt: lieber doppelt zaehlen.
    return false;
  }
}

// ---------------------------------------------------------------- Seitenaufrufe vom Server
//
// Der Storefront-Worker (storefront-edge.js) liefert disorder119.com aus und
// meldet jeden echten Seitenaufruf eines Browsers ueber die Dienstbindung
// BESUCH hierher - auch solange der Shop gesperrt ist. Das braucht kein
// Skript, keinen Speicher im Browser und keine Einwilligung: verarbeitet wird
// nur, was jeder Webserver beim Abruf einer Seite ohnehin erhaelt (Adresse der
// Seite samt Kampagnen-Kennung, verweisende Website, Browserkennung und
// -sprache, IP fuer den Tages-Schluessel, Land). Bewusst ohne Stadt und
// Region; die IP landet weder in D1 noch in Telegram.
export const INTERN_HOST = "storefront.intern";
export const SEITENAUFRUF_PFAD = "/intern/seitenaufruf";

export function artikelAusPfad(pfad) {
  const treffer = /^\/(?:(?:en|fr)\/)?artikel\/(\d{1,9})(?:\.html|\/(?:index\.html)?)?$/.exec(String(pfad || ""));
  return treffer ? treffer[1] : null;
}

function spracheAusPfad(pfad) {
  const treffer = /^\/(en|fr)(?:\/|$)/.exec(String(pfad || ""));
  return treffer ? treffer[1] : "de";
}

export async function seitenaufrufAnnehmen(request, env, ctx, now = Date.now()) {
  // Nur ueber die Dienstbindung: oeffentlich kommt jede Anfrage ueber
  // api.disorder119.com.
  if (new URL(request.url).hostname !== INTERN_HOST) throw new BesucherError("NOT_FOUND", 404);
  if (request.method !== "POST") throw new BesucherError("METHOD_NOT_ALLOWED", 405);
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY) throw new BesucherError("REQUEST_TOO_LARGE", 413);
  let body;
  try { body = JSON.parse(raw); } catch { throw new BesucherError("INVALID_JSON", 400); }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new BesucherError("INVALID_JSON", 400);

  const ua = String(body.ua || "").slice(0, 400);
  const ip = String(body.ip || "").slice(0, 64);
  const fertig = new Response(null, { status: 204, headers: sicherheitsHeader() });
  if (!besucherAktiv(env) || !env.DB || !ip || istBot(ua)) return fertig;
  if (env.RATE_LIMITER && typeof env.RATE_LIMITER.limit === "function") {
    const result = await env.RATE_LIMITER.limit({ key: `seitenaufruf:${anschlussVonIp(ip) || ip}` });
    if (result && result.success === false) return fertig;
  }

  const pfad = pfadAus(body.p);
  const nummer = artikelAusPfad(pfad);
  const { geraet, browser, system } = geraetUndBrowser(ua);
  const besucher = await schluesselAus(env, ip, ua, now);
  if (await sitzungBeruehren(env, ctx, { besucher, neuErlaubt: neuerBesuch(env, ip, now) }, now) === SITZUNG_GRENZE) return fertig;
  const eintrag = nummer ? (await katalog(env)).get(nummer) : null;

  await ereignisSpeichern(env, {
    typ: nummer ? "artikel" : "seite",
    pfad,
    // Adresse traegt die Artikelnummer; gespeichert wird wie im Overlay die
    // Katalog-ID, damit beide Wege beim selben Artikel landen.
    artikelId: eintrag && /^\d{1,9}$/.test(String(eintrag.id ?? "")) ? String(eintrag.id) : nummer,
    warenkorb: 0,
    kanal: null,
    quelle: quelleAus(body.r),
    sprache: spracheAusPfad(pfad),
    besucher,
    zeit: new Date(now).toISOString(),
    titel: eintrag ? artikelName(eintrag) || null : null,
    land: kurz(body.land, 2),
    geraet,
    browser,
    system,
    browserSprache: browserSpracheAus(body.sl),
    kampagne: kampagneAus(body.us, body.uc),
  }, true);
  return fertig;
}

// Bei gesperrtem Shop: jemand hat das richtige Passwort eingegeben. Keine
// eigene Nachricht mehr - die Zusammenfassung des Besuchs nennt es.
export async function entsperrtMelden(request, env, now = Date.now(), ctx = null) {
  const ua = request.headers.get("User-Agent") || "";
  if (!besucherAktiv(env) || !env.DB || istBot(ua)) return;
  const besucher = await besucherSchluessel(env, request, now);
  await sitzungBeruehren(env, ctx, { besucher, entsperrt: true }, now);
}

// ---------------------------------------------------------------- Aufraeumen (Cron)

export async function besucherAufraeumen(env, now = Date.now()) {
  if (!env?.DB) return { geloescht: 0 };
  const tage = ganzzahl(env.BESUCHER_AUFBEWAHRUNG_TAGE, STANDARD_AUFBEWAHRUNG_TAGE, 1, 365);
  const grenze = new Date(now - tage * 24 * 60 * 60 * 1000).toISOString();
  const alt = await env.DB.prepare("DELETE FROM besucher_ereignisse WHERE zeit<?").bind(grenze).run();
  await env.DB.prepare("DELETE FROM besucher_verlassen WHERE zeit<?").bind(grenze).run().catch(() => {});
  await env.DB.prepare("DELETE FROM besucher_sichtzeit WHERE zuletzt<?").bind(grenze).run().catch(() => {});
  await env.DB.prepare("DELETE FROM besucher_sitzungen WHERE zuletzt<? AND gemeldet<>3").bind(grenze).run().catch(() => {});
  // Salz von gestern und frueher weg: alte Schluessel sind danach nicht mehr
  // einer IP zuzuordnen.
  await env.DB.prepare("DELETE FROM besucher_salz WHERE tag<>?").bind(tagUtc(now)).run();
  return { geloescht: Number(alt?.meta?.changes || 0) };
}

// ---------------------------------------------------------------- Admin-API

function ereignisAusgabe(row) {
  return {
    zeit: row.zeit,
    typ: row.typ,
    pfad: row.pfad,
    artikelId: row.artikel_id,
    titel: row.titel,
    warenkorb: row.warenkorb,
    kanal: row.kanal,
  };
}

async function live(env, url, now) {
  const minuten = ganzzahl(url.searchParams.get("minuten"), 30, 1, 24 * 60);
  const seit = new Date(now - minuten * 60 * 1000).toISOString();
  const { results } = await env.DB.prepare(`SELECT * FROM besucher_ereignisse
    WHERE besucher IN (SELECT besucher FROM besucher_ereignisse WHERE zeit>=? GROUP BY besucher ORDER BY MAX(zeit) DESC LIMIT 50)
      AND zeit>=?
    ORDER BY zeit ASC, id ASC`).bind(seit, new Date(now - 24 * 60 * 60 * 1000).toISOString()).all();
  const nachBesucher = new Map();
  for (const row of results || []) {
    let b = nachBesucher.get(row.besucher);
    if (!b) {
      b = {
        schluessel: row.besucher,
        seit: row.zeit,
        zuletzt: row.zeit,
        ort: { stadt: row.stadt, region: row.region, land: row.land, landName: landName(row.land) },
        geraet: row.geraet,
        browser: row.browser,
        system: row.system || null,
        quelle: row.quelle,
        sprache: row.sprache,
        warenkorb: 0,
        ereignisse: [],
      };
      nachBesucher.set(row.besucher, b);
    }
    b.zuletzt = row.zeit;
    if (!b.quelle && row.quelle) b.quelle = row.quelle;
    if (!b.system && row.system) b.system = row.system;
    // Server-Meldungen kennen nur das Land; die Stadt kommt erst mit Einwilligung.
    if (!b.ort.stadt && row.stadt) b.ort = { stadt: row.stadt, region: row.region, land: row.land, landName: landName(row.land) };
    if (["warenkorb_rein", "warenkorb_raus", "anfrage"].includes(row.typ)) b.warenkorb = row.warenkorb;
    b.ereignisse.push(ereignisAusgabe(row));
  }
  // Lesbarer Name statt Kennung; der Schluessel selbst verlaesst den Server nicht.
  const besucher = [...nachBesucher.values()]
    .map(({ schluessel, ...b }) => ({
      ...b,
      besucher: besucherLabel(schluessel, { geraet: b.geraet, stadt: b.ort.stadt, land: b.ort.land }),
      name: besucherName({ geraet: b.geraet, stadt: b.ort.stadt, land: b.ort.land }),
      tier: besucherTier(schluessel),
      aktiv: Date.parse(b.zuletzt) >= now - 5 * 60 * 1000,
      ereignisse: b.ereignisse.slice(-40),
    }))
    .sort((a, b) => b.zuletzt.localeCompare(a.zuletzt));
  return { ok: true, minuten, jetztAktiv: besucher.filter(b => b.aktiv).length, besucher };
}

async function statistik(env, url, now) {
  const tage = ganzzahl(url.searchParams.get("tage"), 7, 1, 365);
  const seit = new Date(now - tage * 24 * 60 * 60 * 1000).toISOString();
  const alle = sql => env.DB.prepare(sql).bind(seit).all().then(r => r.results || []);
  const summen = await env.DB.prepare(`SELECT
      COUNT(DISTINCT besucher) AS besuche,
      SUM(typ='seite') AS seitenaufrufe,
      SUM(typ='artikel') AS artikelaufrufe,
      SUM(typ='warenkorb_rein') AS warenkorb,
      SUM(typ='anfrage') AS anfragen
    FROM besucher_ereignisse WHERE zeit>=?`).bind(seit).first();
  const [topArtikel, laender, quellen, geraete] = await Promise.all([
    alle(`SELECT artikel_id AS artikelId, MAX(titel) AS titel,
        SUM(typ='artikel') AS aufrufe, SUM(typ='warenkorb_rein') AS warenkorb
      FROM besucher_ereignisse WHERE zeit>=? AND artikel_id IS NOT NULL
      GROUP BY artikel_id ORDER BY warenkorb DESC, aufrufe DESC LIMIT 20`),
    alle(`SELECT COALESCE(land,'??') AS land, COUNT(DISTINCT besucher) AS besuche
      FROM besucher_ereignisse WHERE zeit>=? GROUP BY land ORDER BY besuche DESC LIMIT 15`),
    alle(`SELECT COALESCE(quelle,'direkt') AS quelle, COUNT(DISTINCT besucher) AS besuche
      FROM besucher_ereignisse WHERE zeit>=? GROUP BY quelle ORDER BY besuche DESC LIMIT 15`),
    alle(`SELECT geraet, COUNT(DISTINCT besucher) AS besuche
      FROM besucher_ereignisse WHERE zeit>=? GROUP BY geraet ORDER BY besuche DESC LIMIT 10`),
  ]);
  const zahl = v => Number(v || 0);
  return {
    ok: true,
    tage,
    besuche: zahl(summen?.besuche),
    seitenaufrufe: zahl(summen?.seitenaufrufe),
    artikelaufrufe: zahl(summen?.artikelaufrufe),
    warenkorb: zahl(summen?.warenkorb),
    anfragen: zahl(summen?.anfragen),
    topArtikel: topArtikel.map(r => ({ ...r, aufrufe: zahl(r.aufrufe), warenkorb: zahl(r.warenkorb) })),
    laender: laender.map(r => ({ ...r, landName: landName(r.land) })),
    quellen,
    geraete,
    einstellungen: { tracking: besucherAktiv(env), telegram: telegramModus(env), aufbewahrungTage: ganzzahl(env.BESUCHER_AUFBEWAHRUNG_TAGE,STANDARD_AUFBEWAHRUNG_TAGE,1,365) },
  };
}

// ---------------------------------------------------------------- Auswertung
//
// Ein Besuch (Sitzung) sind alle Ereignisse eines Besucher-Schluessels ohne
// Pause ueber 30 Minuten. Die Verweildauer eines Schritts ist die Zeit bis
// zum naechsten Schritt; beim letzten Schritt bis zum Verlassen der Seite,
// falls der Browser das gemeldet hat.

const MAX_SCHRITT_MS = SITZUNG_MS;
const MAX_ZEILEN = 20_000;

function berlin(iso) {
  const teile = Object.fromEntries(new Intl.DateTimeFormat("de-DE", {
    timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(iso)).map(t => [t.type, t.value]));
  return { tag: `${teile.year}-${teile.month}-${teile.day}`, stunde: Number(teile.hour) };
}

export function sitzungenBilden(zeilen, verlassen = [], sichtzeit = [], lebenslauf = []) {
  // Ablauf aus besucher_sitzungen (Einwilligung, Besuchszahl, Meldung) je
  // Schluessel, zeitlich passend zugeordnet.
  const laufJe = new Map();
  for (const l of lebenslauf || []) {
    if (!laufJe.has(l.besucher)) laufJe.set(l.besucher, []);
    laufJe.get(l.besucher).push(l);
  }
  const zeitenJe = new Map();
  for(const z of sichtzeit){if(!zeitenJe.has(z.besucher))zeitenJe.set(z.besucher,[]);zeitenJe.get(z.besucher).push(z);}
  for(const [key,liste] of zeitenJe)zeitenJe.set(key,zeitGruppen(zeitIntervalle(liste)));
  const verlassenJe = new Map();
  for (const v of verlassen) {
    if (!verlassenJe.has(v.besucher)) verlassenJe.set(v.besucher, []);
    verlassenJe.get(v.besucher).push({t:Date.parse(v.zeit),pfad:v.pfad});
  }
  for (const liste of verlassenJe.values()) liste.sort((a, b) => a.t - b.t);

  const sitzungen = [];
  let aktuell = null;
  const abschliessen = () => {
    if (!aktuell) return;
    const schritte = aktuell.schritte;
    const letzter = schritte[schritte.length - 1];
    const ende = (verlassenJe.get(aktuell.schluessel) || [])
      .find(v => v.t >= letzter.t && v.t - letzter.t <= MAX_SCHRITT_MS && (!v.pfad || v.pfad===letzter.pfad))?.t;
    if (ende !== undefined) letzter.dauerMs = ende - letzter.t;
    const gemessen = verbundeneZeiten(zeitenJe.get(aktuell.schluessel), schritte[0].t);
    const bis = Math.max(ende !== undefined ? ende : letzter.t,gemessen.bis);
    const zeitIndex = sichtzeitIndex(gemessen.intervalle);
    const vordergrundMs = gemessen.intervalle.length ? sichtzeitZwischen(zeitIndex,schritte[0].t,bis) : null;
    const artikel = new Set(schritte.filter(x => x.artikelId && x.typ === "artikel").map(x => x.artikelId));
    const erste = schritte[0];
    sitzungen.push({
      id: `${aktuell.schluessel.slice(0, 12)}-${erste.t}`,
      // Lesbar statt "#A1B2": Geraet · Stadt/Land (Tagesname).
      besucher: besucherLabel(aktuell.schluessel, { geraet: aktuell.geraet, stadt: aktuell.ort.stadt, land: aktuell.ort.land }),
      name: besucherName({ geraet: aktuell.geraet, stadt: aktuell.ort.stadt, land: aktuell.ort.land }),
      tier: besucherTier(aktuell.schluessel),
      ...laufInfo(laufJe.get(aktuell.schluessel), erste.t, bis),
      start: new Date(erste.t).toISOString(),
      ende: new Date(bis).toISOString(),
      dauerMs: bis - erste.t,
      dauerBekannt: schritte.length > 1 || ende !== undefined || gemessen.intervalle.length > 0,
      vordergrundMs,
      messungBis: gemessen.intervalle.length ? new Date(gemessen.bis).toISOString() : null,
      messungBegrenzt: gemessen.intervalle.some(r=>r.begrenzt),
      datenUmfang: gemessen.intervalle.length || schritte.some(x=>x.quelleArt === "browser") ? "browser_detail" : "server_seiten",
      ort: aktuell.ort,
      geraet: aktuell.geraet,
      browser: aktuell.browser,
      system: aktuell.system || null,
      sprache: aktuell.sprache,
      browserSprache: aktuell.browserSprache || null,
      kampagne: aktuell.kampagne || null,
      quelle: aktuell.quelle,
      herkunft: herkunftAus(aktuell.quelle),
      einstieg: erste.artikelId ? `Artikel ${erste.artikelId}` : erste.pfad,
      seiten: schritte.filter(x => x.typ === "seite" || x.typ === "artikel").length,
      artikel: artikel.size,
      warenkorb: schritte.filter(x => x.typ === "warenkorb_rein").length,
      warenkorbEnde: schritte.reduce((n, x) => (["warenkorb_rein", "warenkorb_raus", "anfrage"].includes(x.typ) ? x.warenkorb : n), 0),
      anfrage: schritte.some(x => x.typ === "anfrage"),
      schritte: schritte.map((x,i) => ({
        zeit: new Date(x.t).toISOString(),
        typ: x.typ,
        pfad: x.pfad,
        artikelId: x.artikelId,
        titel: x.titel,
        warenkorb: x.warenkorb,
        kanal: x.kanal,
        dauerMs: x.dauerMs,
        quelleArt: x.quelleArt,
        vordergrundMs: sichtzeitZwischen(zeitIndex,x.t,schritte[i+1]?.t || bis,x),
      })),
    });
    aktuell = null;
  };

  for (const z of zeilen) {
    const t = Date.parse(z.zeit);
    if (!Number.isFinite(t)) continue;
    const vorher = aktuell && aktuell.schritte[aktuell.schritte.length - 1];
    if (!aktuell || aktuell.schluessel !== z.besucher || t - verbundeneZeiten(zeitenJe.get(z.besucher),vorher.t).bis > SITZUNG_MS) {
      abschliessen();
      aktuell = {
        schluessel: z.besucher,
        ort: { stadt: z.stadt, region: z.region, land: z.land, landName: landName(z.land) },
        geraet: z.geraet,
        browser: z.browser,
        system: z.system || null,
        sprache: z.sprache,
        browserSprache: z.browser_sprache || null,
        kampagne: z.kampagne || null,
        quelle: z.quelle,
        schritte: [],
      };
    } else {
      vorher.dauerMs = Math.min(t - vorher.t, MAX_SCHRITT_MS);
      if (!aktuell.quelle && z.quelle) aktuell.quelle = z.quelle;
      if (!aktuell.system && z.system) aktuell.system = z.system;
      if (!aktuell.browserSprache && z.browser_sprache) aktuell.browserSprache = z.browser_sprache;
      if (!aktuell.kampagne && z.kampagne) aktuell.kampagne = z.kampagne;
      if (!aktuell.ort.stadt && z.stadt) aktuell.ort = { stadt: z.stadt, region: z.region, land: z.land, landName: landName(z.land) };
    }
    aktuell.schritte.push({
      t, typ: z.typ, pfad: z.pfad, artikelId: z.artikel_id, titel: z.titel,
      warenkorb: Number(z.warenkorb || 0), kanal: z.kanal, dauerMs: null, quelleArt: z.server === 1 ? "server" : "browser",
    });
  }
  abschliessen();
  sitzungen.sort((a, b) => b.start.localeCompare(a.start));
  return sitzungen;
}

// Einwilligung, Besuchszahl und Telegram-Status aus besucher_sitzungen.
function laufInfo(liste, von, bis) {
  const passend = (liste || []).filter(l => Date.parse(l.beginn) <= bis + 60_000 && Date.parse(l.zuletzt) >= von - 60_000);
  if (!passend.length) return { einwilligung: null, wiederkehr: null, meldung: null, entsperrt: false };
  const mit = passend.find(l => l.besuch_nr) || passend[0];
  const meldung = passend.map(l => l.gemeldet).includes(1) ? "gesendet"
    : passend.some(l => l.gemeldet === 0 || l.gemeldet === 3) ? "ausstehend"
    : passend[0].meldung_grund || "nicht gesendet";
  return {
    einwilligung: passend.some(l => l.einwilligung === 1),
    wiederkehr: mit.besuch_nr ? { nr: mit.besuch_nr, erster: mit.erster_besuch || null, vorher: mit.vorher_besuch || null } : null,
    meldung,
    entsperrt: passend.some(l => l.entsperrt === 1),
  };
}

function rangliste(map, n = 10) {
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([name, besuche]) => ({ name, besuche }));
}

function median(werte) {
  if (!werte.length) return 0;
  const s = [...werte].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

export function auswertungBerechnen(sitzungen, tage, now) {
  const proTag = new Map();
  for (let i = tage - 1; i >= 0; i--) proTag.set(berlin(now - i * 86_400_000).tag, { besuche: 0, warenkorb: 0 });
  const proStunde = Array.from({ length: 24 }, () => 0);
  const quellen = new Map();
  const herkunft = new Map();
  const orte = new Map();
  const geraete = new Map();
  const browser = new Map();
  const systeme = new Map();
  const sprachen = new Map();
  const kampagnen = new Map();
  const laender = new Map();
  const einstieg = new Map();
  const artikel = new Map();
  const dauern = [];
  const sichtDauern = sitzungen.filter(s=>s.vordergrundMs !== null && s.vordergrundMs !== undefined).map(s=>s.vordergrundMs);

  for (const s of sitzungen) {
    const b = berlin(s.start);
    if (proTag.has(b.tag)) {
      proTag.get(b.tag).besuche++;
      if (s.warenkorb) proTag.get(b.tag).warenkorb++;
    }
    proStunde[b.stunde]++;
    const plus = (map, key) => map.set(key, (map.get(key) || 0) + 1);
    plus(quellen, s.quelle || "direkt");
    const quelle = herkunftAus(s.quelle);
    if (!herkunft.has(quelle.kanal)) herkunft.set(quelle.kanal, { kanal: quelle.kanal, name: quelle.name, besuche: 0, mitWarenkorb: 0, mitAnfrage: 0 });
    const gruppe = herkunft.get(quelle.kanal);
    gruppe.besuche++;
    if (s.warenkorb > 0) gruppe.mitWarenkorb++;
    if (s.anfrage) gruppe.mitAnfrage++;
    plus(orte, [s.ort.stadt, s.ort.landName].filter(Boolean).join(", ") || "unbekannt");
    plus(geraete, s.geraet || "unbekannt");
    plus(browser, s.browser || "unbekannt");
    if (s.system) plus(systeme, s.system);
    if (s.browserSprache) plus(sprachen, spracheName(s.browserSprache) || s.browserSprache);
    if (s.kampagne) plus(kampagnen, s.kampagne);
    const landKey = s.ort?.land || "??";
    if (!laender.has(landKey)) laender.set(landKey, { land: s.ort?.land || null, landName: landName(s.ort?.land) || "unbekannt", besuche: 0, mitWarenkorb: 0, mitAnfrage: 0 });
    const l = laender.get(landKey);
    l.besuche++;
    if (s.warenkorb > 0) l.mitWarenkorb++;
    if (s.anfrage) l.mitAnfrage++;
    plus(einstieg, s.einstieg || "/");
    if (s.dauerBekannt) dauern.push(s.dauerMs);
    const gesehen = new Set();
    for (const x of s.schritte) {
      if (!x.artikelId) continue;
      let a = artikel.get(x.artikelId);
      if (!a) {
        a = { artikelId: x.artikelId, titel: x.titel, aufrufe: 0, besucher: 0, warenkorb: 0, anfragen: 0, dauerSumme: 0, dauerAnzahl: 0 };
        artikel.set(x.artikelId, a);
      }
      if (!a.titel && x.titel) a.titel = x.titel;
      if (x.typ === "artikel") {
        a.aufrufe++;
        if (!gesehen.has(x.artikelId)) { a.besucher++; gesehen.add(x.artikelId); }
        if (x.dauerMs != null) { a.dauerSumme += x.dauerMs; a.dauerAnzahl++; }
      }
      if (x.typ === "warenkorb_rein") a.warenkorb++;
    }
  }

  const n = sitzungen.length;
  const mitWarenkorb = sitzungen.filter(s => s.warenkorb > 0).length;
  const mitAnfrage = sitzungen.filter(s => s.anfrage).length;
  const absprung = sitzungen.filter(s => s.seiten <= 1 && !s.warenkorb && !s.anfrage).length;
  const prozent = x => (n ? Math.round((x / n) * 1000) / 10 : 0);
  return {
    kennzahlen: {
      besuche: n,
      besucherHeute: sitzungen.filter(s => berlin(s.start).tag === berlin(now).tag).length,
      dauerMedianMs: median(dauern),
      dauerSchnittMs: dauern.length ? Math.round(dauern.reduce((a, b) => a + b, 0) / dauern.length) : 0,
      seitenProBesuch: n ? Math.round((sitzungen.reduce((a, s) => a + s.seiten, 0) / n) * 10) / 10 : 0,
      warenkorbQuote: prozent(mitWarenkorb),
      anfrageQuote: prozent(mitAnfrage),
      absprungQuote: prozent(absprung),
      mitWarenkorb,
      mitAnfrage,
      gemesseneBesuche: sichtDauern.length,
      vordergrundMedianMs: median(sichtDauern),
    },
    proTag: [...proTag.entries()].map(([tag, w]) => ({ tag, ...w })),
    proStunde,
    topArtikel: [...artikel.values()]
      .map(a => ({
        artikelId: a.artikelId, titel: a.titel, aufrufe: a.aufrufe, besucher: a.besucher, warenkorb: a.warenkorb,
        dauerSchnittMs: a.dauerAnzahl ? Math.round(a.dauerSumme / a.dauerAnzahl) : null,
      }))
      .sort((x, y) => y.warenkorb - x.warenkorb || y.aufrufe - x.aufrufe)
      .slice(0, 25),
    herkunft: {
      gesamt: n,
      unbekannt: herkunft.get("unbekannt")?.besuche || 0,
      quellen: [...herkunft.values()].sort((a, b) => b.besuche - a.besuche || a.name.localeCompare(b.name, "de"))
        .map(q => ({ ...q, anteil: n ? Math.round(q.besuche / n * 1000) / 10 : 0 })),
    },
    quellen: rangliste(quellen),
    orte: rangliste(orte, 15),
    geraete: rangliste(geraete),
    browser: rangliste(browser),
    systeme: rangliste(systeme),
    sprachen: rangliste(sprachen),
    kampagnen: rangliste(kampagnen),
    // Fuer die Weltkarte der Admin-App: Besuche je Land (ISO-Code).
    laender: [...laender.values()].sort((a, b) => b.besuche - a.besuche),
    einstieg: rangliste(einstieg),
  };
}

async function auswertung(env, url, now) {
  const tage = ganzzahl(url.searchParams.get("tage"), 7, 1, 90);
  const limit = ganzzahl(url.searchParams.get("limit"), 150, 1, 500);
  const seit = new Date(now - tage * 24 * 60 * 60 * 1000).toISOString();
  let zeilen;
  try {
    zeilen = (await env.DB.prepare(`SELECT besucher, zeit, typ, pfad, artikel_id, titel, warenkorb, kanal,
        quelle, sprache, land, region, stadt, geraet, browser, server, system, browser_sprache, kampagne
      FROM besucher_ereignisse WHERE zeit>=? ORDER BY besucher, zeit, id LIMIT ${MAX_ZEILEN}`).bind(seit).all()).results;
  } catch {
    // Migration 0040 fehlt noch: ohne System, Browsersprache und Kampagne.
    zeilen = (await env.DB.prepare(`SELECT besucher, zeit, typ, pfad, artikel_id, titel, warenkorb, kanal,
        quelle, sprache, land, region, stadt, geraet, browser, server
      FROM besucher_ereignisse WHERE zeit>=? ORDER BY besucher, zeit, id LIMIT ${MAX_ZEILEN}`).bind(seit).all()).results;
  }
  let verlassen = [];
  try {
    verlassen = (await env.DB.prepare("SELECT besucher, zeit, pfad FROM besucher_verlassen WHERE zeit>=? ORDER BY zeit LIMIT ?")
      .bind(seit, MAX_ZEILEN).all()).results || [];
  } catch {
    // Migration 0020 fehlt noch: Dauer nur aus den Schritten.
  }
  let sichtzeit = [], sichtzeitVerfuegbar = true;
  try { sichtzeit = (await env.DB.prepare("SELECT besucher,beginn,zuletzt,pfad,artikel_id,sicht_ms,begrenzt FROM besucher_sichtzeit WHERE zuletzt>=? ORDER BY besucher,beginn LIMIT ?").bind(seit,MAX_ZEILEN).all()).results || []; }
  catch { sichtzeitVerfuegbar = false; }
  let lebenslauf = [];
  try {
    lebenslauf = (await env.DB.prepare(`SELECT besucher, beginn, zuletzt, einwilligung, besuch_nr, erster_besuch, vorher_besuch,
        entsperrt, gemeldet, meldung_grund FROM besucher_sitzungen WHERE zuletzt>=? ORDER BY besucher, beginn LIMIT ?`)
      .bind(seit, MAX_ZEILEN).all()).results || [];
  } catch {
    // Migration 0040 fehlt noch.
  }
  const sitzungen = sitzungenBilden(zeilen || [], verlassen, sichtzeit, lebenslauf);
  return {
    ok: true,
    tage,
    erstellt: new Date(now).toISOString(),
    gekuerzt: (zeilen || []).length >= MAX_ZEILEN,
    verweildauerAktiv: verlassen.length > 0,
    sichtzeitVerfuegbar,
    sichtzeitGekuerzt: sichtzeit.length >= MAX_ZEILEN,
    ...auswertungBerechnen(sitzungen, tage, now),
    jetztAktiv: sitzungen.filter(s => Date.parse(s.ende) >= now - 5 * 60 * 1000).length,
    sitzungen: sitzungen.slice(0, limit),
    einstellungen: {
      tracking: besucherAktiv(env), telegram: telegramModus(env),
      aufbewahrungTage: ganzzahl(env.BESUCHER_AUFBEWAHRUNG_TAGE,STANDARD_AUFBEWAHRUNG_TAGE,1,365),
      geoSperre: geoSperrListe(env),
    },
  };
}

export function istBesucherRoute(url) {
  return url.pathname === "/besuch" || url.pathname === SEITENAUFRUF_PFAD
    || url.pathname === "/admin/besucher" || url.pathname.startsWith("/admin/besucher/");
}

export async function handleBesucher(request, env, url, reqId = crypto.randomUUID(), ctx = null, now = Date.now()) {
  const origin = request.headers.get("Origin");
  try {
    if (url.pathname === "/besuch") return await besuchAnnehmen(request, env, ctx, now);
    if (url.pathname === SEITENAUFRUF_PFAD) return await seitenaufrufAnnehmen(request, env, ctx, now);

    if (request.method === "OPTIONS") {
      if (origin && !ADMIN_ORIGINS.includes(origin)) return new Response(null, { status: 403, headers: sicherheitsHeader() });
      return new Response(null, { status: 204, headers: { ...sicherheitsHeader(), ...corsHeader(origin, ADMIN_ORIGINS, "GET, OPTIONS") } });
    }
    if (origin && !ADMIN_ORIGINS.includes(origin)) throw new BesucherError("ORIGIN_NOT_ALLOWED", 403);
    // Zweite Schutzschicht hinter dem zentralen Gateway in worker-entry.js.
    if (!env?.ADMIN_AUTH_CONTEXT?.role) throw new BesucherError("UNAUTHORIZED", 401);
    if (request.method !== "GET") throw new BesucherError("METHOD_NOT_ALLOWED", 405);
    if (!env.DB) throw new BesucherError("COMMERCE_DATABASE_NOT_CONFIGURED", 503);

    const pfad = url.pathname.replace(/\/+$/, "");
    if (pfad === "/admin/besucher/live" || pfad === "/admin/besucher") return json(await live(env, url, now), 200, origin);
    if (pfad === "/admin/besucher/statistik") return json(await statistik(env, url, now), 200, origin);
    if (pfad === "/admin/besucher/auswertung") return json(await auswertung(env, url, now), 200, origin);
    throw new BesucherError("NOT_FOUND", 404);
  } catch (err) {
    const oeffentlich = url.pathname === "/besuch";
    const status = err instanceof BesucherError ? err.status : 500;
    const code = err instanceof BesucherError ? err.code : "BESUCHER_ERROR";
    if (!(err instanceof BesucherError)) {
      console.error(JSON.stringify({ level: "error", event: "besucher_error", requestId: reqId, message: String(err?.message || err).slice(0, 160) }));
    }
    return new Response(JSON.stringify({ error: code, requestId: reqId }), {
      status,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        ...sicherheitsHeader(),
        ...(oeffentlich ? corsHeader(origin, SHOP_ORIGINS, "POST, OPTIONS") : corsHeader(origin, ADMIN_ORIGINS, "GET, OPTIONS")),
      },
    });
  }
}

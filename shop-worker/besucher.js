// Live-Besucher: der Shop meldet Seitenaufrufe, angesehene Artikel,
// Warenkorb-Aenderungen und geoeffnete Anfragen an POST /besuch. Der Worker
// legt sie in D1 ab, schickt die wichtigen Momente an den Telegram-Bot und
// zeigt sie der Admin-App unter /admin/besucher/*.
//
// Datenschutz: keine Cookies, keine IP in der Datenbank oder in Telegram.
// Der Besucher-Schluessel ist ein Hash aus IP, Browserkennung und einem
// Tagessalz, das der Cron nach Tagesende loescht. Ort (Stadt/Region/Land)
// kommt grob aus request.cf. Browser mit "Do Not Track" oder Global Privacy
// Control senden gar nichts (siehe assets/besucher.js).
import { safeText } from "./commerce-core.js";
import { sendTelegramMessage, telegramTransportReady } from "./notifications.js";

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
const KANAELE = Object.freeze(["whatsapp", "email", "paypal"]);
const SPRACHEN = Object.freeze(["de", "en", "fr"]);
const MAX_BODY = 2048;
const SITZUNG_MS = 30 * 60 * 1000;
const STANDARD_AUFBEWAHRUNG_TAGE = 30;
const STANDARD_TELEGRAM_PRO_STUNDE = 40;
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

// "wichtig" (Standard): neuer Besucher, Warenkorb, Anfrage.
// "alles": zusaetzlich jeder angesehene Artikel. "aus": nichts.
export function telegramModus(env) {
  const wert = schalter(env, "BESUCHER_TELEGRAM");
  if (["aus", "false", "0", "off", "nein"].includes(wert)) return "aus";
  if (wert === "alles") return "alles";
  return "wichtig";
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
  return { geraet, browser };
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
    for (const it of Array.isArray(liste) ? liste : []) {
      if (it && it.id !== undefined) map.set(String(it.id), it);
    }
    katalogCache = { bis: jetzt + KATALOG_CACHE_MS, map };
    return map;
  } catch {
    // Ohne Katalog laufen die Meldungen mit Artikelnummer statt Titel weiter.
    katalogCache = { bis: jetzt + 60_000, map: katalogCache.map || new Map() };
    return katalogCache.map;
  }
}

function euro(preis) {
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
  return `Artikel ${artikelId} – ${safeText(name, 120)}${preis ? ` (${preis})` : ""}`;
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

async function besucherSchluessel(env, request, now) {
  const ip = request.headers.get("CF-Connecting-IP") || "";
  const ua = request.headers.get("User-Agent") || "";
  const salz = await tagesSalz(env, now);
  return (await sha256Hex(`${salz}|${ip}|${ua}`)).slice(0, 20);
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
  if (typ === "verlassen") return { typ, pfad: pfadAus(body.p) };
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

async function zuletztGesehen(env, besucher) {
  const row = await env.DB.prepare("SELECT MAX(zeit) AS zuletzt FROM besucher_ereignisse WHERE besucher=?")
    .bind(besucher).first();
  return row?.zuletzt || null;
}

async function telegramBudget(env, now) {
  const max = ganzzahl(env?.BESUCHER_TELEGRAM_PRO_STUNDE, STANDARD_TELEGRAM_PRO_STUNDE, 0, 1000);
  if (max === 0) return false;
  const seit = new Date(now - 60 * 60 * 1000).toISOString();
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM besucher_ereignisse WHERE gemeldet=1 AND zeit>=?")
    .bind(seit).first();
  return Number(row?.n || 0) < max;
}

function ortText(e) {
  const land = landName(e.land);
  const teile = [e.stadt, e.region && e.region !== e.stadt ? e.region : null, land].filter(Boolean);
  return teile.length ? teile.join(", ") : "unbekanntem Ort";
}

export function telegramText(e, neu, katalogEintrag, warenkorbTitel = []) {
  const wer = `${besucherKuerzel(e.besucher)} · ${ortText(e)} · ${e.geraet} · ${e.browser}`;
  const artikel = artikelText(e.artikelId, katalogEintrag);
  const zeilen = [];
  if (e.typ === "warenkorb_rein") {
    zeilen.push("🛒 IN DEN WARENKORB", artikel, wer, `Warenkorb jetzt: ${e.warenkorb} ${e.warenkorb === 1 ? "Teil" : "Teile"}`);
  } else if (e.typ === "anfrage") {
    const kanal = e.kanal === "whatsapp" ? "WhatsApp" : e.kanal === "email" ? "E-Mail" : e.kanal === "paypal" ? "PayPal" : "Anfrage";
    zeilen.push(`💬 ANFRAGE WIRD GESENDET (${kanal})`, wer, `${e.warenkorb} ${e.warenkorb === 1 ? "Teil" : "Teile"} im Warenkorb`);
    for (const titel of warenkorbTitel.slice(0, 8)) zeilen.push(`• ${titel}`);
  } else if (neu) {
    zeilen.push("👀 BESUCHER GERADE IM SHOP", `📍 ${ortText(e)}`, `📱 ${e.geraet} · ${e.browser}`);
    if (e.quelle) zeilen.push(`↪️ kommt von ${e.quelle}`);
    zeilen.push(artikel ? `👉 ${artikel}` : `👉 Seite ${e.pfad}`, `Besucher ${besucherKuerzel(e.besucher)}`);
  } else {
    zeilen.push(`👁 ${besucherKuerzel(e.besucher)} schaut: ${artikel || e.pfad}`);
  }
  return zeilen.join("\n");
}

function sollMelden(modus, e, neu) {
  if (modus === "aus") return false;
  if (e.typ === "warenkorb_rein" || e.typ === "anfrage") return true;
  if (neu && e.typ !== "warenkorb_raus") return true;
  return modus === "alles" && e.typ === "artikel";
}

async function warenkorbTitelFuer(env, besucher, map) {
  // Letzter Stand je Artikel dieses Besuchers heute: drin, wenn zuletzt "rein".
  const { results } = await env.DB.prepare(`SELECT artikel_id, typ FROM besucher_ereignisse
    WHERE besucher=? AND typ IN ('warenkorb_rein','warenkorb_raus') ORDER BY id`).bind(besucher).all();
  const drin = new Map();
  for (const row of results || []) {
    if (row.typ === "warenkorb_rein") drin.set(row.artikel_id, true);
    else drin.delete(row.artikel_id);
  }
  return [...drin.keys()].map(id => artikelText(id, map.get(String(id))));
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
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const result = await env.RATE_LIMITER.limit({ key: `besuch:${ip}` });
    if (result && result.success === false) throw new BesucherError("RATE_LIMITED", 429);
  }

  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY) throw new BesucherError("REQUEST_TOO_LARGE", 413);
  const daten = ereignisAusBody(raw);
  if (daten.typ === "verlassen") {
    // Nur der Zeitpunkt fuer die Verweildauer: keine Meldung, kein Ort.
    const besucher = await besucherSchluessel(env, request, now);
    try {
      await env.DB.prepare("INSERT INTO besucher_verlassen (besucher, zeit, pfad) VALUES (?,?,?)")
        .bind(besucher, new Date(now).toISOString(), daten.pfad).run();
    } catch {
      // Migration 0020 noch nicht eingespielt: ohne Verweildauer weiter.
    }
    return leer(origin);
  }
  const cf = request.cf || {};
  const { geraet, browser } = geraetUndBrowser(ua);
  const besucher = await besucherSchluessel(env, request, now);
  const zuletzt = await zuletztGesehen(env, besucher);
  const neu = !zuletzt || Date.parse(zuletzt) < now - SITZUNG_MS;
  const map = daten.artikelId || daten.typ === "anfrage" ? await katalog(env) : new Map();
  const eintrag = daten.artikelId ? map.get(daten.artikelId) : null;

  const e = {
    ...daten,
    besucher,
    zeit: new Date(now).toISOString(),
    titel: eintrag ? artikelName(eintrag) || null : null,
    land: kurz(cf.country, 2),
    region: kurz(cf.region, 80),
    stadt: kurz(cf.city, 80),
    geraet,
    browser,
  };

  const modus = telegramModus(env);
  const melden = sollMelden(modus, e, neu) && telegramTransportReady(env) && await telegramBudget(env, now);

  const insert = await env.DB.prepare(`INSERT INTO besucher_ereignisse
    (besucher, zeit, typ, pfad, artikel_id, titel, warenkorb, kanal, quelle, sprache, land, region, stadt, geraet, browser, gemeldet)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(e.besucher, e.zeit, e.typ, e.pfad, e.artikelId, e.titel, e.warenkorb, e.kanal, e.quelle, e.sprache,
      e.land, e.region, e.stadt, e.geraet, e.browser, melden ? 1 : 0)
    .run();

  if (melden) {
    const warenkorbTitel = e.typ === "anfrage" ? await warenkorbTitelFuer(env, besucher, map) : [];
    const senden = sendTelegramMessage(env, telegramText(e, neu, eintrag, warenkorbTitel))
      .catch(err => {
        console.error(JSON.stringify({
          level: "error",
          event: "besucher_telegram_failed",
          message: String(err?.message || err).slice(0, 160),
        }));
        const id = insert?.meta?.last_row_id;
        if (id) return env.DB.prepare("UPDATE besucher_ereignisse SET gemeldet=0 WHERE id=?").bind(id).run().catch(() => {});
      });
    if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(senden);
    else await senden;
  }
  return leer(origin);
}

// ---------------------------------------------------------------- Aufraeumen (Cron)

export async function besucherAufraeumen(env, now = Date.now()) {
  if (!env?.DB) return { geloescht: 0 };
  const tage = ganzzahl(env.BESUCHER_AUFBEWAHRUNG_TAGE, STANDARD_AUFBEWAHRUNG_TAGE, 1, 365);
  const grenze = new Date(now - tage * 24 * 60 * 60 * 1000).toISOString();
  const alt = await env.DB.prepare("DELETE FROM besucher_ereignisse WHERE zeit<?").bind(grenze).run();
  await env.DB.prepare("DELETE FROM besucher_verlassen WHERE zeit<?").bind(grenze).run().catch(() => {});
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
        besucher: besucherKuerzel(row.besucher),
        seit: row.zeit,
        zuletzt: row.zeit,
        ort: { stadt: row.stadt, region: row.region, land: row.land, landName: landName(row.land) },
        geraet: row.geraet,
        browser: row.browser,
        quelle: row.quelle,
        sprache: row.sprache,
        warenkorb: 0,
        ereignisse: [],
      };
      nachBesucher.set(row.besucher, b);
    }
    b.zuletzt = row.zeit;
    if (!b.quelle && row.quelle) b.quelle = row.quelle;
    if (["warenkorb_rein", "warenkorb_raus", "anfrage"].includes(row.typ)) b.warenkorb = row.warenkorb;
    b.ereignisse.push(ereignisAusgabe(row));
  }
  const besucher = [...nachBesucher.values()]
    .map(b => ({ ...b, aktiv: Date.parse(b.zuletzt) >= now - 5 * 60 * 1000, ereignisse: b.ereignisse.slice(-40) }))
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
    einstellungen: { tracking: besucherAktiv(env), telegram: telegramModus(env) },
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

export function sitzungenBilden(zeilen, verlassen = []) {
  const verlassenJe = new Map();
  for (const v of verlassen) {
    if (!verlassenJe.has(v.besucher)) verlassenJe.set(v.besucher, []);
    verlassenJe.get(v.besucher).push(Date.parse(v.zeit));
  }
  for (const liste of verlassenJe.values()) liste.sort((a, b) => a - b);

  const sitzungen = [];
  let aktuell = null;
  const abschliessen = () => {
    if (!aktuell) return;
    const schritte = aktuell.schritte;
    const letzter = schritte[schritte.length - 1];
    const ende = (verlassenJe.get(aktuell.schluessel) || [])
      .find(t => t >= letzter.t && t - letzter.t <= MAX_SCHRITT_MS);
    if (ende !== undefined) letzter.dauerMs = ende - letzter.t;
    const bis = ende !== undefined ? ende : letzter.t;
    const artikel = new Set(schritte.filter(x => x.artikelId && x.typ === "artikel").map(x => x.artikelId));
    const erste = schritte[0];
    sitzungen.push({
      id: `${aktuell.schluessel.slice(0, 12)}-${erste.t}`,
      besucher: besucherKuerzel(aktuell.schluessel),
      start: new Date(erste.t).toISOString(),
      ende: new Date(bis).toISOString(),
      dauerMs: bis - erste.t,
      dauerBekannt: schritte.length > 1 || ende !== undefined,
      ort: aktuell.ort,
      geraet: aktuell.geraet,
      browser: aktuell.browser,
      sprache: aktuell.sprache,
      quelle: aktuell.quelle,
      einstieg: erste.artikelId ? `Artikel ${erste.artikelId}` : erste.pfad,
      seiten: schritte.filter(x => x.typ === "seite" || x.typ === "artikel").length,
      artikel: artikel.size,
      warenkorb: schritte.filter(x => x.typ === "warenkorb_rein").length,
      warenkorbEnde: schritte.reduce((n, x) => (["warenkorb_rein", "warenkorb_raus", "anfrage"].includes(x.typ) ? x.warenkorb : n), 0),
      anfrage: schritte.some(x => x.typ === "anfrage"),
      schritte: schritte.map(x => ({
        zeit: new Date(x.t).toISOString(),
        typ: x.typ,
        pfad: x.pfad,
        artikelId: x.artikelId,
        titel: x.titel,
        warenkorb: x.warenkorb,
        kanal: x.kanal,
        dauerMs: x.dauerMs,
      })),
    });
    aktuell = null;
  };

  for (const z of zeilen) {
    const t = Date.parse(z.zeit);
    if (!Number.isFinite(t)) continue;
    const vorher = aktuell && aktuell.schritte[aktuell.schritte.length - 1];
    if (!aktuell || aktuell.schluessel !== z.besucher || t - vorher.t > SITZUNG_MS) {
      abschliessen();
      aktuell = {
        schluessel: z.besucher,
        ort: { stadt: z.stadt, region: z.region, land: z.land, landName: landName(z.land) },
        geraet: z.geraet,
        browser: z.browser,
        sprache: z.sprache,
        quelle: z.quelle,
        schritte: [],
      };
    } else {
      vorher.dauerMs = Math.min(t - vorher.t, MAX_SCHRITT_MS);
      if (!aktuell.quelle && z.quelle) aktuell.quelle = z.quelle;
    }
    aktuell.schritte.push({
      t, typ: z.typ, pfad: z.pfad, artikelId: z.artikel_id, titel: z.titel,
      warenkorb: Number(z.warenkorb || 0), kanal: z.kanal, dauerMs: null,
    });
  }
  abschliessen();
  sitzungen.sort((a, b) => b.start.localeCompare(a.start));
  return sitzungen;
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
  const orte = new Map();
  const geraete = new Map();
  const browser = new Map();
  const einstieg = new Map();
  const artikel = new Map();
  const dauern = [];

  for (const s of sitzungen) {
    const b = berlin(s.start);
    if (proTag.has(b.tag)) {
      proTag.get(b.tag).besuche++;
      if (s.warenkorb) proTag.get(b.tag).warenkorb++;
    }
    proStunde[b.stunde]++;
    const plus = (map, key) => map.set(key, (map.get(key) || 0) + 1);
    plus(quellen, s.quelle || "direkt");
    plus(orte, [s.ort.stadt, s.ort.landName].filter(Boolean).join(", ") || "unbekannt");
    plus(geraete, s.geraet || "unbekannt");
    plus(browser, s.browser || "unbekannt");
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
    quellen: rangliste(quellen),
    orte: rangliste(orte, 15),
    geraete: rangliste(geraete),
    browser: rangliste(browser),
    einstieg: rangliste(einstieg),
  };
}

async function auswertung(env, url, now) {
  const tage = ganzzahl(url.searchParams.get("tage"), 7, 1, 90);
  const limit = ganzzahl(url.searchParams.get("limit"), 150, 1, 500);
  const seit = new Date(now - tage * 24 * 60 * 60 * 1000).toISOString();
  const { results: zeilen } = await env.DB.prepare(`SELECT besucher, zeit, typ, pfad, artikel_id, titel, warenkorb, kanal,
      quelle, sprache, land, region, stadt, geraet, browser
    FROM besucher_ereignisse WHERE zeit>=? ORDER BY besucher, zeit, id LIMIT ${MAX_ZEILEN}`).bind(seit).all();
  let verlassen = [];
  try {
    verlassen = (await env.DB.prepare("SELECT besucher, zeit FROM besucher_verlassen WHERE zeit>=? ORDER BY zeit LIMIT ?")
      .bind(seit, MAX_ZEILEN).all()).results || [];
  } catch {
    // Migration 0020 fehlt noch: Dauer nur aus den Schritten.
  }
  const sitzungen = sitzungenBilden(zeilen || [], verlassen);
  return {
    ok: true,
    tage,
    erstellt: new Date(now).toISOString(),
    gekuerzt: (zeilen || []).length >= MAX_ZEILEN,
    verweildauerAktiv: verlassen.length > 0,
    ...auswertungBerechnen(sitzungen, tage, now),
    jetztAktiv: sitzungen.filter(s => Date.parse(s.ende) >= now - 5 * 60 * 1000).length,
    sitzungen: sitzungen.slice(0, limit),
    einstellungen: { tracking: besucherAktiv(env), telegram: telegramModus(env) },
  };
}

export function istBesucherRoute(url) {
  return url.pathname === "/besuch" || url.pathname === "/admin/besucher" || url.pathname.startsWith("/admin/besucher/");
}

export async function handleBesucher(request, env, url, reqId = crypto.randomUUID(), ctx = null, now = Date.now()) {
  const origin = request.headers.get("Origin");
  try {
    if (url.pathname === "/besuch") return await besuchAnnehmen(request, env, ctx, now);

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

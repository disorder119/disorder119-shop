// Waechter: sperrt "komische Besucher" (Scanner, Angriffsproben,
// Angriffs-Programme, Flut von 404 oder Anfragen) fuer 24 Stunden und warnt
// per Telegram. Regeln in waechter-regeln.js, Tabellen aus Migration 0041.
//
// - Gespeichert wird nie die IP, nur ein Hash des Anschlusses (IPv6 je /64)
//   mit dem geheimen Pfeffer LOGIN_IP_PEPPER (privacy-security.js), dazu Land,
//   Geraet/Kurzform der Browserkennung, Grund, gekuerzter Pfad, Anzahl.
// - Vorfaelle (fuer die Schwellen) verschwinden nach 24 h, Sperren 7 Tage nach
//   ihrem Ablauf (Liste "Sicherheit" in der Admin-App).
// - Telegram: hoechstens eine Nachricht je Anschluss und Stunde; kommen in
//   15 Minuten mehr als WAECHTER_TELEGRAM_EINZELN (Standard 5) Sperren, sammelt
//   der Cron sie zu einer Wellen-Meldung.
// - Nie gesperrt: verifizierte und bekannte Such-/Plattform-Bots, PayPal-,
//   Packlink- und eBay-Meldungen, die Manager-Verbindung, die interne
//   Dienstbindung und die Admin-Routen (Passkey-geschuetzt - der Inhaber kommt immer an "Sperre
//   aufheben").
// - Ohne Migration oder Pfeffer arbeitet der Shop normal weiter (fail-open),
//   die einzelne Probe-Anfrage bekommt trotzdem 404/403.
import { anschlussVonIp, ipPepper } from "./privacy-security.js";
import { GRUND_TEXT, bekannterBot, kurzPfad, waechterPruefen } from "./waechter-regeln.js";
import { geraetUndBrowser, landName } from "./besucher.js";
import { sendTelegramMessage, telegramTransportReady, telegramZeile } from "./notifications.js";
import { isPacklinkWebhookRoute } from "./packlink.js";

const MINUTE = 60_000;
const STUNDE = 60 * MINUTE;
const SPERRE_MS = 24 * STUNDE;
const PROBE_SCHWELLE = 3, PROBE_FENSTER = 10 * MINUTE;
const FEHLER_SCHWELLE = 20, FEHLER_FENSTER = 5 * MINUTE;
const FLUT_SCHWELLE = 3, FLUT_FENSTER = 10 * MINUTE;
const WELLE_FENSTER = 15 * MINUTE;
const ARTEN = Object.freeze(["angriff", "probe", "404", "flut"]);

const ADMIN_ORIGINS = Object.freeze(["https://admin.disorder119.com", "http://localhost:8765", "http://127.0.0.1:8765"]);

export function waechterAktiv(env) {
  return !["aus", "false", "0", "off", "nein"].includes(String(env?.WAECHTER ?? "").trim().toLowerCase());
}

function ganzzahl(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n) || String(value ?? "").trim() === "") return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

const iso = ms => new Date(ms).toISOString();
const fehlendeTabelle = err => /no such (table|column)/i.test(String(err?.message || err));

export async function anschlussHash(env, ip) {
  const netz = anschlussVonIp(ip);
  if (!netz) return null;
  const bytes = new TextEncoder().encode(`waechter:netz:${netz}:${ipPepper(env)}`);
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), b => b.toString(16).padStart(2, "0")).join("");
}

// Kurzform der Browserkennung: Werkzeugname, sonst Geraet · Browser, sonst
// das erste Produktkuerzel ("python-requests/2.31").
export function uaKurz(ua) {
  const text = String(ua || "").trim();
  if (!text) return "ohne Browserkennung";
  const werkzeug = /\b(sqlmap|nikto|nuclei|masscan|zgrab|gobuster|dirbuster|wpscan|acunetix|nessus|openvas|netsparker|w3af|havij|feroxbuster|ffuf|joomscan|whatweb|commix|xsstrike|jaeles)(?:\/[\w.]+)?/i.exec(text);
  if (werkzeug) return werkzeug[0].slice(0, 40);
  if (/^Mozilla\//.test(text)) {
    const { geraet, browser } = geraetUndBrowser(text);
    return `${geraet} · ${browser}`;
  }
  return telegramZeile(text.split(/\s+/)[0], 40);
}

// ---------------------------------------------------------------- Pruefen

// Gegen Schreib-Fluten: ein gesperrter Angreifer darf mit jeder Anfrage nur
// lesen, geschrieben wird hoechstens einmal je Minute und Anschluss (Anzahl
// im Speicher gesammelt). Meldungen aus dem Anfrageweg (404, Flut) hoechstens
// alle 2 Sekunden je Anschluss.
const drossel = new Map();
const offeneVersuche = new Map();
export function waechterSpeicherLeeren() { drossel.clear(); offeneVersuche.clear(); }
function gedrosselt(schluessel, ms, now) {
  if ((drossel.get(schluessel) || -Infinity) > now - ms) return true;
  if (drossel.size > 5000) drossel.clear();
  drossel.set(schluessel, now);
  return false;
}
async function versuchZaehlen(env, id, hash, now, verlaengern) {
  const z = offeneVersuche.get(hash) || { n: 0, seit: -Infinity };
  z.n++;
  if (z.seit > now - MINUTE) { offeneVersuche.set(hash, z); return false; }
  if (offeneVersuche.size > 5000) offeneVersuche.clear();
  offeneVersuche.set(hash, { n: 0, seit: now });
  await env.DB.prepare(`UPDATE waechter_sperren SET versuche=versuche+?, zuletzt=?${verlaengern ? ", bis=MAX(bis, ?)" : ""} WHERE id=?`)
    .bind(...(verlaengern ? [z.n, iso(now), iso(now + SPERRE_MS), id] : [z.n, iso(now), id])).run().catch(() => {});
  return true;
}

async function aktiveSperre(env, hash, now) {
  return env.DB.prepare(`SELECT id, grund FROM waechter_sperren
    WHERE anschluss=? AND aufgehoben IS NULL AND bis>? LIMIT 1`).bind(hash, iso(now)).first();
}

// true = Anschluss ist gesperrt. Zaehlt den Versuch mit (fuer Admin/Telegram).
export async function waechterGesperrt(env, ip, now = Date.now()) {
  if (!waechterAktiv(env) || !env?.DB || !ip) return false;
  try {
    const hash = await anschlussHash(env, ip);
    if (!hash) return false;
    const row = await aktiveSperre(env, hash, now);
    if (!row) return false;
    await versuchZaehlen(env, row.id, hash, now, false);
    return true;
  } catch (err) {
    if (!fehlendeTabelle(err) && err?.code !== "IP_PRIVACY_NOT_CONFIGURED") logFehler("waechter_check_failed", err);
    return false;
  }
}

function logFehler(event, err) {
  console.error(JSON.stringify({ level: "error", event, message: String(err?.message || err).slice(0, 160) }));
}

// ---------------------------------------------------------------- Vorfall

// vorfall: { ip, ua, land, pfad, art, grund, bot }. Ergebnis { gesperrt }.
export async function waechterVorfall(env, ctx, vorfall, now = Date.now()) {
  const art = ARTEN.includes(vorfall?.art) ? vorfall.art : null;
  if (!art || !waechterAktiv(env) || !env?.DB || !vorfall.ip || vorfall.bot) return { gesperrt: false };
  try {
    const hash = await anschlussHash(env, vorfall.ip);
    if (!hash) return { gesperrt: false };
    const zeit = iso(now);
    const land = /^[A-Z]{2}$/.test(String(vorfall.land || "")) ? String(vorfall.land) : null;
    const pfad = telegramZeile(vorfall.pfad || "", 90) || null;
    const grund = GRUND_TEXT[vorfall.grund] ? vorfall.grund
      : art === "404" ? "zu-viele-404" : art === "flut" ? "zu-viele-anfragen" : "scanner-pfad";
    // Schon gesperrt: nur mitzaehlen (hoechstens eine Schreibung je Minute),
    // die Sperre laeuft ab dem letzten Versuch weiter; Telegram hoechstens stuendlich.
    const laufend = await aktiveSperre(env, hash, now);
    if (laufend) {
      if (await versuchZaehlen(env, laufend.id, hash, now, true)) {
        const melden = waechterMelden(env, hash, now).catch(err => logFehler("waechter_telegram_failed", err));
        if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(melden); else await melden;
      }
      return { gesperrt: true, grund: laufend.grund };
    }
    await env.DB.prepare("INSERT INTO waechter_vorfaelle (anschluss, zeit, art, grund, pfad, land) VALUES (?,?,?,?,?,?)")
      .bind(hash, zeit, art, grund, pfad, land).run();

    let sperrGrund = null;
    if (art === "angriff") sperrGrund = grund;
    else {
      const [schwelle, fenster, arten] = art === "probe" ? [PROBE_SCHWELLE, PROBE_FENSTER, ["probe"]]
        : art === "404" ? [FEHLER_SCHWELLE, FEHLER_FENSTER, ["404", "probe"]]
        : [FLUT_SCHWELLE, FLUT_FENSTER, ["flut"]];
      const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM waechter_vorfaelle
        WHERE anschluss=? AND zeit>=? AND art IN (${arten.map(() => "?").join(",")})`)
        .bind(hash, iso(now - fenster), ...arten).first();
      if (Number(row?.n || 0) >= schwelle) sperrGrund = art === "404" ? "zu-viele-404" : grund;
    }
    if (!sperrGrund) return { gesperrt: false };

    const versuche = Number((await env.DB.prepare(`SELECT COUNT(*) AS n FROM waechter_vorfaelle WHERE anschluss=? AND zeit>=?`)
      .bind(hash, iso(now - SPERRE_MS)).first())?.n || 1);
    const ua = uaKurz(vorfall.ua);
    await env.DB.prepare(`INSERT INTO waechter_sperren (anschluss, seit, bis, zuletzt, land, ua_kurz, grund, beispiel, versuche)
      VALUES (?,?,?,?,?,?,?,?,?)
      ON CONFLICT(anschluss) DO UPDATE SET
        seit=CASE WHEN waechter_sperren.aufgehoben IS NOT NULL OR waechter_sperren.bis<=excluded.seit THEN excluded.seit ELSE waechter_sperren.seit END,
        bis=excluded.bis, zuletzt=excluded.zuletzt,
        land=COALESCE(excluded.land, waechter_sperren.land), ua_kurz=excluded.ua_kurz,
        grund=excluded.grund, beispiel=COALESCE(excluded.beispiel, waechter_sperren.beispiel),
        versuche=MAX(waechter_sperren.versuche + 1, excluded.versuche), aufgehoben=NULL`)
      .bind(hash, zeit, iso(now + SPERRE_MS), zeit, land, ua, sperrGrund, pfad, versuche).run();
    const melden = waechterMelden(env, hash, now).catch(err => logFehler("waechter_telegram_failed", err));
    if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(melden); else await melden;
    return { gesperrt: true, grund: sperrGrund };
  } catch (err) {
    if (!fehlendeTabelle(err) && err?.code !== "IP_PRIVACY_NOT_CONFIGURED") logFehler("waechter_incident_failed", err);
    return { gesperrt: false };
  }
}

// ---------------------------------------------------------------- Telegram

function berlinKurz(isoText) {
  return new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
    .format(new Date(isoText));
}

export function waechterText(sperre) {
  return [
    "🛡 SICHERHEIT: verdächtiger Besucher gesperrt (24 h)",
    `📍 ${landName(sperre.land) || "Land unbekannt"}`,
    `📱 ${telegramZeile(sperre.ua_kurz || "unbekannt", 60)}`,
    `🔎 ${GRUND_TEXT[sperre.grund] || sperre.grund}${sperre.beispiel ? `: ${telegramZeile(sperre.beispiel, 90)}` : ""}`,
    `🔁 ${Number(sperre.versuche || 1)} ${Number(sperre.versuche || 1) === 1 ? "Versuch" : "Versuche"}`,
    `⏳ gesperrt bis ${berlinKurz(sperre.bis)}`,
    "Aufheben: Admin-App → Besucher → Sicherheit",
  ].join("\n");
}

async function waechterMelden(env, hash, now) {
  if (!telegramTransportReady(env) || ["aus", "false", "0", "off", "nein"].includes(String(env?.WAECHTER_TELEGRAM ?? "").trim().toLowerCase())) return;
  const sperre = await env.DB.prepare("SELECT * FROM waechter_sperren WHERE anschluss=?").bind(hash).first();
  if (!sperre || sperre.aufgehoben) return;
  // Hoechstens eine Nachricht je Anschluss und Stunde.
  if (sperre.gemeldet_zeit && Date.parse(sperre.gemeldet_zeit) > now - STUNDE) return;
  const einzeln = ganzzahl(env?.WAECHTER_TELEGRAM_EINZELN, 5, 0, 100);
  const welle = await env.DB.prepare("SELECT COUNT(*) AS n FROM waechter_sperren WHERE gemeldet_zeit>=?").bind(iso(now - WELLE_FENSTER)).first();
  if (Number(welle?.n || 0) >= einzeln) {
    // Welle: der Cron schickt eine Sammelmeldung.
    await env.DB.prepare("UPDATE waechter_sperren SET sammeln=1 WHERE id=?").bind(sperre.id).run();
    return;
  }
  const beansprucht = await env.DB.prepare(`UPDATE waechter_sperren SET gemeldet_zeit=?, sammeln=0
    WHERE id=? AND (gemeldet_zeit IS NULL OR gemeldet_zeit<=?)`).bind(iso(now), sperre.id, iso(now - STUNDE)).run();
  if (Number(beansprucht?.meta?.changes || 0) !== 1) return;
  const ergebnis = await sendTelegramMessage(env, waechterText(sperre));
  if (!ergebnis?.sent) throw new Error(`waechter_telegram_${ergebnis?.reason || "failed"}`);
}

// Cron (alle 15 Minuten): Sammelmeldung fuer Wellen und Aufraeumen.
export async function waechterPflegen(env, now = Date.now()) {
  if (!env?.DB) return { gesammelt: 0 };
  try {
    await env.DB.prepare("DELETE FROM waechter_vorfaelle WHERE zeit<?").bind(iso(now - SPERRE_MS)).run();
    await env.DB.prepare("DELETE FROM waechter_sperren WHERE bis<?").bind(iso(now - 7 * SPERRE_MS)).run();
    if (!telegramTransportReady(env)) return { gesammelt: 0 };
    const { results } = await env.DB.prepare(`SELECT * FROM waechter_sperren
      WHERE sammeln=1 AND aufgehoben IS NULL AND (gemeldet_zeit IS NULL OR gemeldet_zeit<=?) ORDER BY seit LIMIT 500`)
      .bind(iso(now - STUNDE)).all();
    const liste = results || [];
    if (!liste.length) return { gesammelt: 0 };
    const laender = new Map(), gruende = new Map();
    let versuche = 0;
    for (const s of liste) {
      const land = landName(s.land) || "unbekannt";
      laender.set(land, (laender.get(land) || 0) + 1);
      gruende.set(GRUND_TEXT[s.grund] || s.grund, (gruende.get(GRUND_TEXT[s.grund] || s.grund) || 0) + 1);
      versuche += Number(s.versuche || 0);
    }
    const top = map => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, n]) => `${k} ${n}`).join(", ");
    const text = [
      `🛡 SICHERHEIT: Angriffswelle – ${liste.length} Anschlüsse für 24 h gesperrt`,
      `📍 ${top(laender)}`,
      `🔎 ${top(gruende)}`,
      `🔁 ${versuche} Versuche insgesamt`,
      "Einzelheiten: Admin-App → Besucher → Sicherheit",
    ].join("\n");
    const ergebnis = await sendTelegramMessage(env, text);
    if (!ergebnis?.sent) return { gesammelt: 0 };
    const ids = liste.map(s => s.id);
    for (let i = 0; i < ids.length; i += 50) {
      const teil = ids.slice(i, i + 50);
      await env.DB.prepare(`UPDATE waechter_sperren SET sammeln=0, gemeldet_zeit=? WHERE id IN (${teil.map(() => "?").join(",")})`)
        .bind(iso(now), ...teil).run();
    }
    return { gesammelt: liste.length };
  } catch (err) {
    if (!fehlendeTabelle(err)) logFehler("waechter_maintenance_failed", err);
    return { gesammelt: 0 };
  }
}

// ---------------------------------------------------------------- API-Schutz (worker-entry.js)

// Diese Wege werden nie geprueft oder gesperrt.
export function waechterAusnahme(url) {
  const p = url.pathname;
  return p === "/paypal-webhook" || isPacklinkWebhookRoute(url) || p.startsWith("/ebay/") || p.startsWith("/manager/")
    || p === "/admin" || p.startsWith("/admin/") || p.startsWith("/intern/");
}

function sperrAntwort(status, code) {
  return new Response(JSON.stringify({ error: code }), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

// Vor dem Routing der Shop-API: Probe -> 404/403 und Vorfall, gesperrter
// Anschluss -> 403, Flut ueber WAECHTER_LIMITER -> 429 und Vorfall.
export async function waechterVorab(request, env, ctx, url, now = Date.now()) {
  if (!waechterAktiv(env) || waechterAusnahme(url)) return null;
  const ip = request.headers.get("CF-Connecting-IP") || "";
  if (!ip) return null;
  const ua = request.headers.get("User-Agent") || "";
  // Abrufe anderer Cloudflare-Worker ohne Browserkennung (Testshop) nie sperren.
  const bot = bekannterBot(request, ua) || (!ua && Number(request.cf?.asn) === 13335);
  const land = String(request.cf?.country || "").toUpperCase();
  const treffer = waechterPruefen(url, ua);
  if (treffer) {
    if (treffer.art === "angriff" || !gedrosselt(`probe|${ip}`, 2000, now)) {
      const laeuft = waechterVorfall(env, ctx, { ip, ua, land, pfad: treffer.detail, art: treffer.art, grund: treffer.grund, bot }, now);
      if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(laeuft); else await laeuft;
    }
    return treffer.art === "angriff" ? sperrAntwort(403, "FORBIDDEN") : sperrAntwort(404, "NOT_FOUND");
  }
  if (!bot && await waechterGesperrt(env, ip, now)) return sperrAntwort(403, "BLOCKED");
  if (!bot && env.WAECHTER_LIMITER && typeof env.WAECHTER_LIMITER.limit === "function") {
    const ergebnis = await env.WAECHTER_LIMITER.limit({ key: `waechter:${anschlussVonIp(ip)}` }).catch(() => null);
    if (ergebnis && ergebnis.success === false) {
      if (gedrosselt(`flut|${ip}`, 2000, now)) return sperrAntwort(429, "RATE_LIMITED");
      const laeuft = waechterVorfall(env, ctx, { ip, ua, land, pfad: kurzPfad(url), art: "flut", grund: "zu-viele-anfragen" }, now);
      if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(laeuft); else await laeuft;
      return sperrAntwort(429, "RATE_LIMITED");
    }
  }
  return null;
}

// Nach der Antwort: 404 der API zaehlen (Scanner raten Adressen).
export function waechterNachher(request, env, ctx, url, status, now = Date.now()) {
  if (status !== 404 || !waechterAktiv(env) || waechterAusnahme(url)) return;
  const ip = request.headers.get("CF-Connecting-IP") || "";
  const ua = request.headers.get("User-Agent") || "";
  if (!ip || bekannterBot(request, ua) || (!ua && Number(request.cf?.asn) === 13335) || gedrosselt(`404|${ip}`, 2000, now)) return;
  const laeuft = waechterVorfall(env, ctx, { ip, ua, land: String(request.cf?.country || "").toUpperCase(), pfad: kurzPfad(url), art: "404", grund: "zu-viele-404" }, now);
  if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(laeuft);
}

// ---------------------------------------------------------------- Storefront (Dienstbindung)

export const WAECHTER_PFAD_VORFALL = "/intern/waechter/vorfall";
export const WAECHTER_PFAD_PRUEFEN = "/intern/waechter/pruefen";

export function istWaechterIntern(url) {
  return url.hostname === "storefront.intern" && (url.pathname === WAECHTER_PFAD_VORFALL || url.pathname === WAECHTER_PFAD_PRUEFEN);
}

export async function waechterIntern(request, env, ctx, url, now = Date.now()) {
  const leer = (status, daten) => new Response(daten ? JSON.stringify(daten) : null, {
    status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
  if (request.method !== "POST") return leer(405);
  const raw = await request.text();
  if (raw.length > 2048) return leer(413);
  let body;
  try { body = JSON.parse(raw); } catch { return leer(400); }
  const ip = String(body?.ip || "").slice(0, 64);
  if (url.pathname === WAECHTER_PFAD_PRUEFEN) {
    return leer(200, { gesperrt: await waechterGesperrt(env, ip, now) });
  }
  const ergebnis = await waechterVorfall(env, ctx, {
    ip,
    ua: String(body?.ua || "").slice(0, 400),
    land: String(body?.land || "").toUpperCase().slice(0, 2),
    pfad: String(body?.pfad || "").slice(0, 200),
    art: String(body?.art || ""),
    grund: String(body?.grund || ""),
    bot: body?.bot === true,
  }, now);
  return leer(200, { gesperrt: Boolean(ergebnis.gesperrt) });
}

// ---------------------------------------------------------------- Admin

export function istWaechterAdmin(url) {
  return url.pathname === "/admin/besucher/sicherheit" || url.pathname.startsWith("/admin/besucher/sicherheit/");
}

function adminAntwort(daten, status, origin) {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
    "X-Content-Type-Options": "nosniff",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
  if (origin && ADMIN_ORIGINS.includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Credentials"] = "true";
  }
  return new Response(daten === null ? null : JSON.stringify(daten), { status, headers });
}

export async function handleWaechterAdmin(request, env, url, now = Date.now()) {
  const origin = request.headers.get("Origin");
  if (request.method === "OPTIONS") return adminAntwort(null, origin && !ADMIN_ORIGINS.includes(origin) ? 403 : 204, origin);
  if (origin && !ADMIN_ORIGINS.includes(origin)) return adminAntwort({ error: "ORIGIN_NOT_ALLOWED" }, 403, origin);
  if (!env?.ADMIN_AUTH_CONTEXT?.role) return adminAntwort({ error: "UNAUTHORIZED" }, 401, origin);
  if (!env.DB) return adminAntwort({ error: "COMMERCE_DATABASE_NOT_CONFIGURED" }, 503, origin);
  const pfad = url.pathname.replace(/\/+$/, "");
  try {
    if (pfad === "/admin/besucher/sicherheit" && request.method === "GET") {
      const tage = ganzzahl(url.searchParams.get("tage"), 7, 1, 30);
      const { results } = await env.DB.prepare(`SELECT id, seit, bis, zuletzt, land, ua_kurz, grund, beispiel, versuche, aufgehoben, gemeldet_zeit
        FROM waechter_sperren WHERE zuletzt>=? OR bis>? ORDER BY zuletzt DESC LIMIT 200`).bind(iso(now - tage * 24 * STUNDE), iso(now)).all();
      const sperren = (results || []).map(s => ({
        id: s.id, seit: s.seit, bis: s.bis, zuletzt: s.zuletzt, land: s.land, landName: landName(s.land),
        geraet: s.ua_kurz, grund: s.grund, grundText: GRUND_TEXT[s.grund] || s.grund, beispiel: s.beispiel,
        versuche: Number(s.versuche || 0), aufgehoben: s.aufgehoben, gemeldet: Boolean(s.gemeldet_zeit),
        aktiv: !s.aufgehoben && Date.parse(s.bis) > now,
      }));
      const laender = new Map();
      for (const s of sperren) {
        const key = s.land || "??";
        const e = laender.get(key) || { land: s.land, landName: s.landName, sperren: 0, versuche: 0 };
        e.sperren++; e.versuche += s.versuche; laender.set(key, e);
      }
      const heute = await env.DB.prepare("SELECT COUNT(*) AS n FROM waechter_vorfaelle WHERE zeit>=?").bind(iso(now - 24 * STUNDE)).first();
      return adminAntwort({
        ok: true, tage, erstellt: iso(now), aktiv: waechterAktiv(env),
        aktiveSperren: sperren.filter(s => s.aktiv).length,
        vorfaelle24h: Number(heute?.n || 0),
        sperren,
        laender: [...laender.values()].sort((a, b) => b.versuche - a.versuche),
      }, 200, origin);
    }
    if (pfad === "/admin/besucher/sicherheit/aufheben" && request.method === "POST") {
      if (env.ADMIN_AUTH_CONTEXT.role !== "OWNER") return adminAntwort({ error: "FORBIDDEN" }, 403, origin);
      let body;
      try { body = JSON.parse(await request.text()); } catch { return adminAntwort({ error: "INVALID_JSON" }, 400, origin); }
      const id = ganzzahl(body?.id, 0, 0, Number.MAX_SAFE_INTEGER);
      if (!id) return adminAntwort({ error: "ID_REQUIRED" }, 400, origin);
      const sperre = await env.DB.prepare("SELECT anschluss FROM waechter_sperren WHERE id=?").bind(id).first();
      if (!sperre) return adminAntwort({ error: "NOT_FOUND" }, 404, origin);
      await env.DB.prepare("UPDATE waechter_sperren SET aufgehoben=?, sammeln=0 WHERE id=?").bind(iso(now), id).run();
      // Alte Vorfaelle weg, sonst sperrt der naechste Tippfehler sofort wieder.
      await env.DB.prepare("DELETE FROM waechter_vorfaelle WHERE anschluss=?").bind(sperre.anschluss).run();
      return adminAntwort({ ok: true, id, aufgehoben: iso(now) }, 200, origin);
    }
    return adminAntwort({ error: request.method === "GET" || request.method === "POST" ? "NOT_FOUND" : "METHOD_NOT_ALLOWED" }, 404, origin);
  } catch (err) {
    if (fehlendeTabelle(err)) return adminAntwort({ ok: true, fehlt: "MIGRATION_0041", sperren: [], laender: [], aktiveSperren: 0, vorfaelle24h: 0 }, 200, origin);
    logFehler("waechter_admin_failed", err);
    return adminAntwort({ error: "WAECHTER_ERROR" }, 500, origin);
  }
}

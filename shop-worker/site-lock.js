// Shop vorübergehend sperren - gesteuert aus der Admin-App.
//
// Gesperrt zeigt der Shop eine Passwort-Seite. Wer das Passwort kennt, bekommt
// einen signierten Pass (7 Tage), den der Browser bei jedem Seitenaufruf
// mitschickt. Jede neue Sperre erzeugt ein neues Signatur-Geheimnis - alte
// Pässe verfallen damit sofort.
//
// Das Passwort liegt nur als gesalzener SHA-256-Hash in D1. PBKDF2 wäre
// schöner, sprengt aber das CPU-Limit des kostenlosen Workers; gegen Raten
// schützt der RATE_LIMITER (20 Versuche pro Minute und IP).
//
// Die Sperre ist eine Sichtsperre im Browser (wie die frühere Passwort-Sperre):
// Die statischen Seiten liegen weiter bei GitHub Pages.

const SHOP_ORIGINS = Object.freeze(["https://disorder119.com", "https://www.disorder119.com"]);
const ADMIN_ORIGINS = Object.freeze(["https://admin.disorder119.com"]);
const PASS_GUELTIG_MS = 7 * 24 * 60 * 60 * 1000;
const SCHLUESSEL = "site_lock";
const MIN_PASSWORT = 4;
const MAX_PASSWORT = 64;
const MAX_NACHRICHT = 160;

export class SiteLockError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

export function isSiteLockRoute(url) {
  const path = url.pathname.replace(/\/+$/, "");
  return path === "/site-status" || path === "/site-unlock" || path === "/admin/site-lock";
}

// ------------------------------------------------------------ Hilfen
const encoder = new TextEncoder();

function hex(bytes) {
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, "0")).join("");
}

function zufall(bytes = 16) {
  return hex(crypto.getRandomValues(new Uint8Array(bytes)));
}

async function sha256Hex(text) {
  return hex(await crypto.subtle.digest("SHA-256", encoder.encode(text)));
}

export async function passwortHash(salt, passwort) {
  return sha256Hex(`${salt}:${String(passwort).normalize("NFC")}`);
}

async function hmacHex(geheim, text) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(geheim), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, encoder.encode(text)));
}

function gleich(a, b) {
  const x = String(a || ""), y = String(b || "");
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0);
  return diff === 0;
}

async function tokenEquals(left, right) {
  if (!left || !right) return false;
  const [a, b] = await Promise.all([sha256Hex(String(left)), sha256Hex(String(right))]);
  return gleich(a, b);
}

function saubererText(wert, max) {
  return String(wert || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

// ----------------------------------------------------------- Speicher
export async function sperreLesen(env) {
  if (!env.DB) return { locked: false };
  try {
    const row = await env.DB.prepare("SELECT value FROM site_settings WHERE key=?").bind(SCHLUESSEL).first();
    if (!row) return { locked: false };
    const daten = JSON.parse(row.value);
    return daten && typeof daten === "object" ? daten : { locked: false };
  } catch {
    // Tabelle fehlt (Migration noch nicht angewendet): Shop bleibt offen.
    return { locked: false };
  }
}

async function sperreSchreiben(env, daten) {
  await env.DB.prepare(`INSERT INTO site_settings (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`)
    .bind(SCHLUESSEL, JSON.stringify(daten), new Date().toISOString()).run();
}

export async function passAusstellen(sperre, jetzt = Date.now()) {
  const bis = jetzt + PASS_GUELTIG_MS;
  const inhalt = `${sperre.version}.${bis}`;
  return `${inhalt}.${await hmacHex(sperre.secret, inhalt)}`;
}

export async function passGueltig(sperre, pass, jetzt = Date.now()) {
  const teile = String(pass || "").split(".");
  if (teile.length !== 3) return false;
  const [version, bis, sig] = teile;
  if (String(sperre.version) !== version || !/^\d{10,16}$/.test(bis) || Number(bis) < jetzt) return false;
  return gleich(sig, await hmacHex(sperre.secret, `${version}.${bis}`));
}

// ------------------------------------------------------------ Antworten
function kopf(origin, erlaubt) {
  const out = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
  if (origin && erlaubt.includes(origin)) out["Access-Control-Allow-Origin"] = origin;
  return out;
}

function antwort(daten, status, origin, erlaubt) {
  return new Response(JSON.stringify(daten), { status, headers: kopf(origin, erlaubt) });
}

async function jsonLesen(request) {
  try { return (await request.json()) || {}; } catch { throw new SiteLockError("INVALID_JSON", 400); }
}

async function bremse(request, env, zweck) {
  if (!env.RATE_LIMITER || typeof env.RATE_LIMITER.limit !== "function") return;
  const ip = request.headers.get("CF-Connecting-IP") || "unbekannt";
  const { success } = await env.RATE_LIMITER.limit({ key: `${zweck}:${ip}` });
  if (!success) throw new SiteLockError("ZU_VIELE_VERSUCHE", 429);
}

// ------------------------------------------------------------- Routen
export async function handleSiteLock(request, env, url, reqId = crypto.randomUUID(), origin = null) {
  const path = url.pathname.replace(/\/+$/, "");
  const admin = path === "/admin/site-lock";
  const erlaubt = admin ? ADMIN_ORIGINS : SHOP_ORIGINS;
  try {
    if (request.method === "OPTIONS") {
      if (origin && !erlaubt.includes(origin)) return new Response(null, { status: 403 });
      return new Response(null, { status: 204, headers: kopf(origin, erlaubt) });
    }

    if (path === "/site-status" && request.method === "GET") {
      const sperre = await sperreLesen(env);
      if (!sperre.locked) return antwort({ locked: false }, 200, origin, erlaubt);
      const zugang = await passGueltig(sperre, url.searchParams.get("pass"));
      return antwort({ locked: true, access: zugang, message: sperre.message || "" }, 200, origin, erlaubt);
    }

    if (path === "/site-unlock" && request.method === "POST") {
      if (origin && !SHOP_ORIGINS.includes(origin)) throw new SiteLockError("ORIGIN_NOT_ALLOWED", 403);
      await bremse(request, env, "site-unlock");
      const body = await jsonLesen(request);
      const sperre = await sperreLesen(env);
      if (!sperre.locked) return antwort({ ok: true, locked: false }, 200, origin, erlaubt);
      const passwort = String(body.password || "").slice(0, MAX_PASSWORT);
      if (!passwort || !gleich(await passwortHash(sperre.salt, passwort), sperre.hash)) {
        throw new SiteLockError("FALSCHES_PASSWORT", 403);
      }
      return antwort({ ok: true, pass: await passAusstellen(sperre) }, 200, origin, erlaubt);
    }

    if (admin) {
      if (origin && !ADMIN_ORIGINS.includes(origin)) throw new SiteLockError("ORIGIN_NOT_ALLOWED", 403);
      const supplied = String(request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
      if (!env.ADMIN_TOKEN || !(await tokenEquals(supplied, env.ADMIN_TOKEN))) throw new SiteLockError("UNAUTHORIZED", 401);
      if (!env.DB) throw new SiteLockError("DB_FEHLT", 503);

      if (request.method === "GET") {
        const sperre = await sperreLesen(env);
        return antwort({
          locked: Boolean(sperre.locked), message: sperre.message || "",
          lockedAt: sperre.lockedAt || null, unlockedAt: sperre.unlockedAt || null,
        }, 200, origin, erlaubt);
      }
      if (request.method === "POST") {
        const body = await jsonLesen(request);
        const bisher = await sperreLesen(env);
        if (body.locked) {
          const passwort = String(body.password || "");
          if (passwort.length < MIN_PASSWORT || passwort.length > MAX_PASSWORT) throw new SiteLockError("PASSWORT_LAENGE", 400);
          const salt = zufall(16);
          const neu = {
            locked: true, salt, hash: await passwortHash(salt, passwort), secret: zufall(32),
            version: Number(bisher.version || 0) + 1, message: saubererText(body.message, MAX_NACHRICHT),
            lockedAt: new Date().toISOString(),
          };
          await sperreSchreiben(env, neu);
          console.log(JSON.stringify({ level: "info", event: "site_locked", requestId: reqId }));
          return antwort({ ok: true, locked: true, lockedAt: neu.lockedAt, message: neu.message }, 200, origin, erlaubt);
        }
        await sperreSchreiben(env, { locked: false, version: Number(bisher.version || 0) + 1, unlockedAt: new Date().toISOString() });
        console.log(JSON.stringify({ level: "info", event: "site_unlocked", requestId: reqId }));
        return antwort({ ok: true, locked: false }, 200, origin, erlaubt);
      }
    }
    throw new SiteLockError("NOT_FOUND", 404);
  } catch (err) {
    if (err instanceof SiteLockError) return antwort({ error: err.code, requestId: reqId }, err.status, origin, erlaubt);
    console.error(JSON.stringify({ level: "error", event: "site_lock_failed", requestId: reqId, message: String(err?.message || err).slice(0, 160) }));
    return antwort({ error: "INTERNAL_SITE_LOCK_ERROR", requestId: reqId }, 500, origin, erlaubt);
  }
}

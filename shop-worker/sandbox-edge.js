// Testshop test.disorder119.com: spiegelt die echte Seite (disorder119.com)
// und biegt sie beim Ausliefern auf den Test-Server um.
//
//   * api.disorder119.com      -> api-test.disorder119.com (eigene D1, SANDBOX="1")
//   * PayPal-Client-ID (live)  -> PAYPAL_SANDBOX_CLIENT_ID (sonst "sb")
//   * "environment": "live"    -> "sandbox"
//   * Turnstile                -> Testschluessel von Cloudflare (laesst alles durch)
//   * /data/catalog.json       -> Verkauftes aus dem Testshop darueber
//
// Nur mit Passwort (HTTP Basic, Secret TESTSHOP_PASSWORT), nie fuer Suchmaschinen.
// Gespeichert wird hier nichts. Die echte Seite bleibt unveraendert.

const LIVE = "https://disorder119.com";
const API_LIVE = "https://api.disorder119.com";
const API_TEST = "https://api-test.disorder119.com";
const PAYPAL_LIVE_CLIENT_ID = "BAAcvD8X1aHIk42UUDAMZkYZ2i5gKLPCXZDBzbWjsh-axJ_6551l-FXgDdboqGtmZSidZbGWon2cQ_SuaI";
const TURNSTILE_TEST = "1x00000000000000000000AA";
const APPLE_PAY_PFAD = "/.well-known/apple-developer-merchantid-domain-association";
const BENUTZER = "test";

const BANNER = '<div id="d119Testshop" style="position:fixed;left:0;right:0;bottom:0;z-index:2147483647;'
  + 'background:#ffd400;color:#000;font:600 12px/1.4 system-ui,sans-serif;text-align:center;padding:6px 10px;'
  + 'letter-spacing:.04em;pointer-events:none">TESTSHOP · PayPal-Sandbox · keine echten Bestellungen</div>';

function textAntwort(text, status, extra = {}) {
  return new Response(text, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow", ...extra },
  });
}

function gleich(a, b) {
  const x = String(a || ""), y = String(b || "");
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0);
  return diff === 0;
}

export function angemeldet(request, passwort) {
  const kopf = request.headers.get("Authorization") || "";
  if (!passwort || !/^Basic\s+/i.test(kopf)) return false;
  let klar = "";
  try { klar = atob(kopf.replace(/^Basic\s+/i, "").trim()); } catch { return false; }
  const trenner = klar.indexOf(":");
  if (trenner < 0) return false;
  return gleich(klar.slice(0, trenner), BENUTZER) && gleich(klar.slice(trenner + 1), passwort);
}

// Seiten- und Skripttexte auf den Testshop umbiegen.
export function umbiegen(text, env = {}, html = false) {
  const clientId = String(env.PAYPAL_SANDBOX_CLIENT_ID || "sb");
  let out = String(text)
    .split(API_LIVE).join(API_TEST)
    .split(PAYPAL_LIVE_CLIENT_ID).join(clientId)
    .replace(/"environment":\s*"live"/g, '"environment": "sandbox"')
    .replace(/"turnstileSiteKey":\s*"0x[0-9A-Za-z_-]+"/g, `"turnstileSiteKey": "${TURNSTILE_TEST}"`);
  if (html) {
    out = out.replace(/<head([^>]*)>/i, '<head$1><meta name="robots" content="noindex, nofollow">');
    out = /<\/body>/i.test(out) ? out.replace(/<\/body>/i, `${BANNER}</body>`) : out + BANNER;
  }
  return out;
}

async function verkauftImTestshop(env) {
  try {
    const res = env.API && typeof env.API.fetch === "function"
      ? await env.API.fetch(`${API_TEST}/sandbox/verkauft`)
      : await fetch(`${API_TEST}/sandbox/verkauft`);
    if (!res.ok) return new Set();
    const daten = await res.json();
    return new Set((daten.verkauft || []).map(String));
  } catch {
    return new Set();
  }
}

export default {
  async fetch(request, env = {}, ctx = {}, originFetch = fetch) {
    const url = new URL(request.url);
    if (!["GET", "HEAD"].includes(request.method)) return textAntwort("Methode nicht erlaubt.", 405);
    if (url.pathname === "/robots.txt") return textAntwort("User-agent: *\nDisallow: /\n", 200);

    // Apple prueft die Domain ohne Passwort.
    if (url.pathname !== APPLE_PAY_PFAD) {
      if (!env.TESTSHOP_PASSWORT) return textAntwort("Testshop ist noch nicht eingerichtet.", 503);
      if (!angemeldet(request, env.TESTSHOP_PASSWORT)) {
        return textAntwort("Testshop: bitte anmelden (Benutzer \"test\").", 401, { "WWW-Authenticate": 'Basic realm="Disorder119 Testshop", charset="UTF-8"' });
      }
    } else if (env.APPLE_PAY_SANDBOX_DATEI) {
      return textAntwort(String(env.APPLE_PAY_SANDBOX_DATEI), 200);
    }

    let antwort;
    try {
      antwort = await originFetch(new Request(`${LIVE}${url.pathname}${url.search}`, { method: "GET", headers: { Accept: request.headers.get("Accept") || "*/*" } }));
    } catch {
      return textAntwort("Echte Seite gerade nicht erreichbar.", 502);
    }

    const typ = antwort.headers.get("Content-Type") || "";
    const kopf = new Headers(antwort.headers);
    kopf.set("X-Robots-Tag", "noindex, nofollow");
    kopf.delete("Content-Security-Policy");
    kopf.delete("Content-Security-Policy-Report-Only");

    if (url.pathname === "/data/catalog.json" && antwort.ok) {
      const katalog = await antwort.json();
      const verkauft = await verkauftImTestshop(env);
      for (const item of Array.isArray(katalog) ? katalog : []) {
        if (verkauft.has(String(item.id))) { item.public_status = "SOLD"; item.status = "Verkauft"; }
      }
      kopf.delete("Content-Length"); kopf.delete("Content-Encoding"); kopf.delete("ETag");
      kopf.set("Content-Type", "application/json; charset=utf-8");
      kopf.set("Cache-Control", "no-store");
      return new Response(request.method === "HEAD" ? null : JSON.stringify(katalog), { status: 200, headers: kopf });
    }

    const html = /text\/html/i.test(typ);
    if (antwort.ok && (html || /javascript/i.test(typ))) {
      const text = umbiegen(await antwort.text(), env, html);
      kopf.delete("Content-Length"); kopf.delete("Content-Encoding"); kopf.delete("ETag");
      if (html) kopf.set("Cache-Control", "no-store");
      return new Response(request.method === "HEAD" ? null : text, { status: antwort.status, headers: kopf });
    }
    return new Response(request.method === "HEAD" ? null : antwort.body, { status: antwort.status, statusText: antwort.statusText, headers: kopf });
  },
};

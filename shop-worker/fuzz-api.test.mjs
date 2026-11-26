// Fuzzing der Shop-API (22./26.11.2026): tausende zufaellige, kaputte und
// boesartige Anfragen gegen den echten Worker-Code mit echter SQLite-D1 aller
// Migrationen. Laeuft NUR lokal/CI - nie gegen den Live-Shop (der Waechter
// wuerde den eigenen Anschluss sperren).
//
// Geprueft je Antwort:
//  - kein Absturz (fetch wirft nicht), kein 500 ohne Abhaengigkeits-Grund
//  - keine Interna in der Antwort (Stacktrace, SQL-Fehler, Dateipfade, Tokens)
//  - eingeschleuste Nutzlast taucht in HTML nie ungeschuetzt auf
//  - Admin-/Manager-/Intern-Pfade ohne Anmeldung nie 2xx
//  - Prototype-Pollution kommt nicht durch
// Danach Datenbank-Invarianten: keine bezahlten Bestellungen, keine
// Admin-Sitzungen, keine eingeloesten Gutscheine, keine negativen Betraege.
//
// Umfang: D119_FUZZ_RUNDEN (Standard 1500), Seed D119_FUZZ_SEED.
import test from "node:test";
import assert from "node:assert/strict";

import worker from "./worker-entry.js";
import edge from "./storefront-edge.js";
import { allMigrations, sqliteD1 } from "./test-d1.mjs";
import { versandCacheLeeren } from "./versand.js";

const RUNDEN = Number(process.env.D119_FUZZ_RUNDEN || 1500);
let seed = Number(process.env.D119_FUZZ_SEED || 119);
function zufall() { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; }
const wahl = liste => liste[Math.floor(zufall() * liste.length)];
const ganz = (a, b) => a + Math.floor(zufall() * (b - a + 1));

const MARKE = "FUZZ7x9";
const NUTZLAST = [
  `<script>${MARKE}</script>`, `"><img src=x onerror=${MARKE}>`, `' OR '1'='1' -- ${MARKE}`, `1; DROP TABLE commerce_orders; --`,
  `../../../../etc/passwd`, `..%2f..%2f..%2fetc%2fpasswd`, `\${jndi:ldap://x/${MARKE}}`, `{{7*7}}${MARKE}`, `%00${MARKE}`,
  "\u0000\u0001\u0002", "😀".repeat(50), "A".repeat(70_000), "-1", "0", "1e309", "NaN", "-99999999999", "9".repeat(40),
  "null", "true", "[]", "{}", "__proto__", "constructor", " ", "\r\n\r\nX-Injected: 1", "javascript:alert(1)",
  "%E0%A4%A", "\uD800", "ä<ö>&ü\"'", "admin", "OWNER", "D119-10-AAAAAAAAAA", "CLOSERWITHNYLON",
];
const PFADE = [
  "/", "/health", "/besuch", "/coupons/validate", "/create-order", "/capture-order", "/orders", "/rental", "/widerruf",
  "/widerruf/", "/newsletter/subscribe", "/newsletter/confirm", "/newsletter/unsubscribe", "/account", "/account/login",
  "/account/session", "/account/orders", "/account/profile", "/account/address", "/account/export", "/account/loeschen",
  "/account/logout", "/karte/", "/abholorte", "/versand", "/admin", "/admin/ping", "/admin/system", "/admin/orders",
  "/admin/commerce", "/admin/besucher/sicherheit", "/admin/besucher/sicherheit/aufheben", "/admin/tasks", "/admin/auth/login",
  "/admin/notifications/telegram/test", "/manager/status", "/manager/token", "/manager/authorize", "/manager/dataset.zip",
  "/manager/katalog/entwurf", "/manager/katalog/bilder", "/intern/seitenaufruf", "/intern/waechter/pruefen",
  "/intern/waechter/vorfall", "/intern/waechter/entsperren", "/ebay/return", "/paypal-webhook", "/packlink-webhook",
];
const GESCHUETZT = /^\/(admin|manager|intern)(\/|$)/;
const OFFEN_OHNE_LOGIN = new Set(["/admin/auth/login", "/manager/status", "/admin", "/admin/"]);
const METHODEN = ["GET", "POST", "POST", "POST", "PUT", "DELETE", "PATCH", "OPTIONS", "HEAD"];
const ORIGINS = ["https://disorder119.com", "https://admin.disorder119.com", "https://evil.example", "null", undefined];
const INTERNA = [/\bat [\w.$<>]+ \(?[\w:/\\.-]+\.(m?js):\d+/, /SQLITE_|D1_ERROR|no such (table|column)/i, /TypeError|ReferenceError|SyntaxError: /,
  /[A-Z]:\\Users\\/, /\/home\/runner\//, /gh-test|paypal-secret|fuzz-pepper|tg-token/];

function wert(tiefe = 0) {
  const r = zufall();
  if (tiefe > 3 || r < 0.45) return wahl(NUTZLAST);
  if (r < 0.6) return ganz(-1e6, 1e6) * wahl([1, 0.01, 1e9]);
  if (r < 0.7) return wahl([null, true, false, [], {}]);
  if (r < 0.85) return Array.from({ length: ganz(0, 4) }, () => wert(tiefe + 1));
  return objekt(tiefe + 1);
}
const FELDER = ["itemId", "itemIds", "orderId", "id", "email", "couponCode", "code", "adresse", "versand", "versandPreisCents", "token",
  "password", "role", "status", "amount", "price", "total", "plz", "ort", "land", "name", "createAccount", "admin", "__proto__",
  "constructor", "prototype", "pfad", "grund", "sprache", "artikel", "start", "ende", "days", "qty"];
function objekt(tiefe = 0) {
  const o = {};
  for (let i = 0, n = ganz(0, 7); i < n; i++) o[wahl(FELDER)] = wert(tiefe);
  if (zufall() < 0.1) return JSON.parse(`{"__proto__": {"istAdmin": true, "polluted": "${MARKE}"}, "itemIds": [9427]}`);
  return o;
}
function koerper() {
  const r = zufall();
  if (r < 0.55) return { ct: "application/json", body: JSON.stringify(objekt()) };
  if (r < 0.65) return { ct: "application/json", body: wahl(["{", "[1,2", "\"x", "{\"a\":" + "[".repeat(5000), "", "null"]) };
  if (r < 0.75) return { ct: "application/x-www-form-urlencoded", body: `email=${enc(wahl(NUTZLAST))}&code=${enc(wahl(NUTZLAST))}` };
  if (r < 0.85) return { ct: wahl(["text/plain", "text/html", "multipart/form-data; boundary=x", "application/xml"]), body: wahl(NUTZLAST) };
  return { ct: undefined, body: undefined };
}
const enc = s => { try { return encodeURIComponent(s); } catch { return "%ED%A0%80"; } };
function adresse() {
  let p = wahl(PFADE);
  if (zufall() < 0.25) p += (p.endsWith("/") ? "" : "/") + enc(wahl(NUTZLAST)).slice(0, 300);
  if (zufall() < 0.4) p += `?${wahl(["q", "id", "code", "token", "next", "redirect", "lang"])}=${enc(wahl(NUTZLAST)).slice(0, 2000)}`;
  return p;
}

function netzStub() {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url?.url || url));
    const method = init.method || "GET";
    if (u.host === "api.github.com") {
      if (u.pathname.endsWith("/contents/data")) return Response.json([{ name: "items.json", type: "file", sha: "a".repeat(40) }]);
      if (u.pathname.includes("/git/blobs/")) return new Response(JSON.stringify([{ id: 9427, article: "9427", brand: "Test", title: "Test Jeans", price: 90, public_status: "AVAILABLE" }]));
      return Response.json({}, { status: 404 });
    }
    if (u.host.endsWith("paypal.com")) {
      if (u.pathname === "/v1/oauth2/token") return Response.json({ access_token: "pp" });
      if (u.pathname === "/v2/checkout/orders" && method === "POST") return Response.json({ id: "PP-FUZZ", status: "CREATED" }, { status: 201 });
      return Response.json({ name: "RESOURCE_NOT_FOUND" }, { status: 404 });
    }
    if (u.host === "api.telegram.org") return Response.json({ ok: true, result: { message_id: 1 } });
    return Response.json({}, { status: 404 });
  };
  return () => { globalThis.fetch = original; };
}

async function lauf({ runden, extraEnv = {}, origins = ORIGINS, agents }) {
  versandCacheLeeren();
  const zurueck = netzStub();
  const DB = sqliteD1(allMigrations());
  const env = { DB, GITHUB_TOKEN: "gh-test", PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: "paypal-secret",
    LOGIN_IP_PEPPER: "fuzz-pepper", TELEGRAM_BOT_TOKEN: "tg-token", TELEGRAM_CHAT_ID: "1", ...extraEnv };
  const ctx = { waitUntil(p) { Promise.resolve(p).catch(() => {}); }, passThroughOnException() {} };
  const fehler = [], statistik = new Map(), jePfad = new Map();
  try {
    for (let i = 0; i < runden; i++) {
      const pfad = adresse(), methode = wahl(METHODEN), k = ["GET", "HEAD"].includes(methode) ? {} : koerper();
      const kopf = new Headers();
      if (k.ct) kopf.set("Content-Type", k.ct);
      const origin = wahl(origins);
      if (origin) kopf.set("Origin", origin);
      kopf.set("CF-Connecting-IP", `203.0.113.${ganz(1, 250)}`);
      kopf.set("User-Agent", wahl(agents));
      const sauber = s => s.slice(0, 200).replace(/[^\x21-\x7e]/g, "");
      if (zufall() < 0.3) kopf.set("Cookie", `d119_admin=${sauber(wahl(NUTZLAST))}; d119_konto=${sauber(wahl(NUTZLAST))}`);
      if (zufall() < 0.2) kopf.set("Authorization", `Bearer ${sauber(wahl(NUTZLAST))}`);
      if (zufall() < 0.3) kopf.set("Idempotency-Key", sauber(wahl(NUTZLAST)) || "k");
      const anfrage = `${methode} ${pfad.slice(0, 120)}`;
      let antwort;
      try {
        antwort = await worker.fetch(new Request(`https://api.disorder119.com${pfad}`, { method: methode, headers: kopf, body: k.body }), env, ctx);
      } catch (err) {
        if (err instanceof TypeError && /Invalid URL|header|Request/i.test(err.message) && !String(err.stack).includes("shop-worker")) continue;
        fehler.push(`${anfrage}: Absturz ${err?.message}`); continue;
      }
      const text = methode === "HEAD" ? "" : await antwort.text();
      const s = antwort.status;
      statistik.set(s, (statistik.get(s) || 0) + 1);
      const basis = pfad.split("?")[0].replace(/\/[^/]*(FUZZ|%|\.\.).*$/, "") || "/";
      const jp = jePfad.get(basis) || {}; jp[s] = (jp[s] || 0) + 1; jePfad.set(basis, jp);
      if (s >= 500 && s !== 502 && s !== 503) fehler.push(`${anfrage}: Status ${s} ${text.slice(0, 160)}`);
      for (const muster of INTERNA) if (muster.test(text)) fehler.push(`${anfrage}: Interna in Antwort (${muster}) ${text.slice(0, 160)}`);
      const ct = antwort.headers.get("content-type") || "";
      if (/html/i.test(ct) && /<script>FUZZ7x9|<img src=x onerror=FUZZ7x9/.test(text)) fehler.push(`${anfrage}: ungeschuetzte Nutzlast in HTML`);
      if (GESCHUETZT.test(pfad) && !OFFEN_OHNE_LOGIN.has(basis) && s >= 200 && s < 300 && methode !== "OPTIONS" && methode !== "HEAD")
        fehler.push(`${anfrage}: geschuetzter Pfad ohne Anmeldung ${s} ${text.slice(0, 160)}`);
      if (({}).polluted !== undefined || ({}).istAdmin !== undefined) { fehler.push(`${anfrage}: Prototype-Pollution`); delete Object.prototype.polluted; delete Object.prototype.istAdmin; }
    }
  } finally { zurueck(); }
  const zahl = sql => DB.raw.prepare(sql).get().n;
  const db = {
    bezahlt: zahl("SELECT COUNT(*) AS n FROM commerce_orders WHERE status NOT IN ('PENDING','CREATED','PENDING_PAYMENT','CANCELLED','ABGEBROCHEN','EXPIRED')"),
    negativ: zahl("SELECT COUNT(*) AS n FROM commerce_orders WHERE total_cents < 0 OR subtotal_cents < 0 OR shipping_cents < 0"),
    adminSitzungen: zahl("SELECT COUNT(*) AS n FROM admin_sessions"),
    kundenSitzungen: zahl("SELECT COUNT(*) AS n FROM customer_sessions"),
    eingeloest: zahl("SELECT COUNT(*) AS n FROM reward_coupons WHERE status='REDEEMED'"),
    bestellungen: zahl("SELECT COUNT(*) AS n FROM commerce_orders"),
    status: DB.raw.prepare("SELECT status, COUNT(*) AS n FROM commerce_orders GROUP BY status").all().map(r => `${r.status}:${r.n}`).join(","),
  };
  return { fehler: [...new Set(fehler)], statistik: Object.fromEntries([...statistik].sort()), jePfad, db };
}

function pruefen(name, e) {
  console.log(`[${name}] Status:`, JSON.stringify(e.statistik), "DB:", JSON.stringify(e.db));
  if (process.env.D119_FUZZ_PFADE) for (const [p, s] of [...e.jePfad].sort()) console.log(`   ${p} ${JSON.stringify(s)}`);
  assert.equal(e.db.bezahlt, 0, `keine bezahlte Bestellung ohne echte PayPal-Zahlung (${e.db.status})`);
  assert.equal(e.db.negativ, 0, "keine negativen Betraege");
  assert.equal(e.db.adminSitzungen, 0, "keine Admin-Sitzung ohne Passkey");
  assert.equal(e.db.kundenSitzungen, 0, "keine Kunden-Sitzung ohne Login-Link");
  assert.equal(e.db.eingeloest, 0, "kein Gutschein ohne Zahlung eingeloest");
  assert.deepEqual(e.fehler.slice(0, 40), [], `${e.fehler.length} Befunde`);
}

test(`Fuzzing mit Waechter: ${RUNDEN} Anfragen`, { timeout: 600_000 }, async () => {
  pruefen("mit Waechter", await lauf({ runden: RUNDEN, agents: ["Mozilla/5.0 Chrome/130.0", "curl/8", "sqlmap/1.7", "", `Mozilla/5.0 ${MARKE}<script>`] }));
});

// Ohne Waechter kommen die Nutzlasten bis in Kasse, Konto, Newsletter, Widerruf usw.
test(`Fuzzing der Geschaeftslogik (Waechter aus): ${RUNDEN} Anfragen`, { timeout: 600_000 }, async () => {
  pruefen("Logik", await lauf({ runden: RUNDEN, extraEnv: { WAECHTER: "aus" }, origins: ["https://disorder119.com", "https://disorder119.com", "https://admin.disorder119.com", undefined],
    agents: ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"] }));
});

// Kassen-Mutationen: eine gueltige Bestellung, je Lauf ein Feld boesartig
// veraendert. Kommt eine Bestellung zustande, muss der Betrag bei PayPal und in
// der DB exakt der Serverpreis sein (90 EUR + serverseitig berechneter Versand).
test("Kasse: Preis-, Versand-, Mengen- und Gutschein-Manipulation greift nie", { timeout: 600_000 }, async () => {
  versandCacheLeeren();
  const paypalBetraege = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url?.url || url));
    const method = init.method || "GET";
    if (u.host === "api.github.com") {
      if (u.pathname.endsWith("/contents/data")) return Response.json([{ name: "items.json", type: "file", sha: "a".repeat(40) }]);
      if (u.pathname.includes("/git/blobs/")) return new Response(JSON.stringify([
        { id: 9427, article: "9427", brand: "Test", title: "Test Jeans", price: 90, public_status: "AVAILABLE", taxonomy_category: "Pants", product_type: "Trousers" },
        { id: 9428, article: "9428", brand: "Test", title: "Verkauft", price: 1, public_status: "SOLD" }]));
    }
    if (u.host.endsWith("paypal.com")) {
      if (u.pathname === "/v1/oauth2/token") return Response.json({ access_token: "pp" });
      if (u.pathname === "/v2/checkout/orders" && method === "POST") {
        const b = JSON.parse(init.body); paypalBetraege.push(b.purchase_units?.[0]?.amount?.value);
        return Response.json({ id: `PP-${paypalBetraege.length}`, status: "CREATED" }, { status: 201 });
      }
      return Response.json({}, { status: 404 });
    }
    return Response.json({}, { status: 404 });
  };
  const basis = { itemIds: [9427], adresse: { name: "Maria Muster", strasse: "Teststrasse", hausnummer: "1", plz: "63739", ort: "Aschaffenburg", land: "DE" },
    email: "kundin@example.com", versand: "fest-dhl-S", versandPreisCents: 619 };
  const MUTATIONEN = [
    ["itemIds", [[9427, 9427], [9427, 9427, 9427], [9428], [9427, 9428], [-9427], ["9427' OR 1=1"], [9427.5], [], [1e30], "9427", { 0: 9427 }]],
    ["versandPreisCents", [0, -619, 1, -1e9, 1e12, "0", null, NaN, 0.5, "619abc"]],
    ["versand", ["", "gratis", "fest-dhl-XL", "__proto__", "fest-dhl-S'; --", null, 0, ["fest-dhl-S"]]],
    ["price", [0, 0.01, -90]], ["total", [0.01]], ["itemPrice", [1]], ["amount", ["0.01"]], ["cents", [1]],
    ["couponCode", ["D119-99-AAAAAAAAAA", "100PROZENT", "' OR 1=1--", "x".repeat(5000), ["a"], { code: "x" }]],
    ["adresse", [null, "string", { ...basis.adresse, land: "XX" }, { ...basis.adresse, land: "US" }, { ...basis.adresse, plz: "<script>" }]],
    ["email", ["", "a", "<script>@x.de", "x@y", "a@b.c\r\nBcc: z@evil.example"]],
  ];
  let n = 0, angenommen = 0;
  const fehler = [];
  try {
    for (const [feld, werte] of MUTATIONEN) for (const w of werte) {
      n++;
      const DB = sqliteD1(allMigrations()); // frische DB je Versuch: keine Reservierungs-/Grenzwert-Reste
      const env = { DB, GITHUB_TOKEN: "gh-test", PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: "paypal-secret", WAECHTER: "aus" };
      const body = { ...basis, [feld]: w };
      const req = new Request("https://api.disorder119.com/create-order", { method: "POST",
        headers: { Origin: "https://disorder119.com", "Content-Type": "application/json", "Idempotency-Key": `fuzz-kasse-${String(n).padStart(6, "0")}`, "CF-Connecting-IP": `198.51.100.${n % 250}` },
        body: JSON.stringify(body) });
      let res; try { res = await worker.fetch(req, env, { waitUntil() {} }); } catch (e) { fehler.push(`${feld}=${JSON.stringify(w)}: Absturz ${e.message}`); continue; }
      const data = await res.json().catch(() => ({}));
      if (res.status >= 500) fehler.push(`${feld}=${JSON.stringify(w)?.slice(0, 40)}: ${res.status} ${JSON.stringify(data).slice(0, 120)}`);
      if (res.status !== 200) continue;
      angenommen++; if (process.env.D119_FUZZ_PFADE) console.log("   angenommen:", feld, JSON.stringify(w)?.slice(0, 60));
      const order = DB.raw.prepare("SELECT subtotal_cents, shipping_cents, total_cents FROM commerce_orders WHERE id = ?").get(data.orderId);
      const ids = data.itemIds || [];
      if (ids.length !== new Set(ids).size) fehler.push(`${feld}: Artikel doppelt verkauft ${ids}`);
      if (ids.includes(9428)) fehler.push(`${feld}: verkaufter Artikel bestellt`);
      if (order.subtotal_cents !== 9000 * ids.length) fehler.push(`${feld}=${JSON.stringify(w)}: Warenwert ${order.subtotal_cents} statt Serverpreis`);
      if (order.shipping_cents < 0 || order.total_cents !== order.subtotal_cents + order.shipping_cents) fehler.push(`${feld}: Summe inkonsistent ${JSON.stringify(order)}`);
      if (paypalBetraege.at(-1) !== (order.total_cents / 100).toFixed(2)) fehler.push(`${feld}: PayPal-Betrag ${paypalBetraege.at(-1)} != DB ${order.total_cents}`);
    }
  } finally { globalThis.fetch = original; }
  console.log(`[Kasse] ${n} Mutationen, ${angenommen} als normale Bestellung angenommen, PayPal-Betraege: ${[...new Set(paypalBetraege)].join(", ")}`);
  assert.deepEqual(fehler, []);
});

// Storefront (Shop-Seiten): kaputte Pfade, Query-Strings und Kopfzeilen.
// Keine Abstuerze, keine 5xx, Nutzlast nie ungeschuetzt im HTML, keine
// Weiterleitung auf fremde Hosts, Sicherheits-Kopfzeilen an jeder HTML-Seite.
test(`Fuzzing der Shop-Seiten: ${RUNDEN} Anfragen`, { timeout: 600_000 }, async () => {
  const SEITEN = ["/", "/artikel/199/", "/en/", "/fr/artikel/199/", "/kasse/", "/cart/", "/marken/", "/universe/", "/baukasten/", "/match/",
    "/neu/", "/widerruf/", "/data/items.json", "/assets/app.js", "/sw.js", "/robots.txt", "/sitemap.xml", "//evil.example/", "/\evil.example",
    "/artikel/", "/en/artikel/999999/", "/%2e%2e/", "/.env", "/wp-login.php", "/index.html"];
  const fehler = [], statistik = new Map();
  const herkunft = async req => {
    const p = new URL(req.url).pathname;
    if (p.endsWith(".json")) return new Response("[]", { headers: { "content-type": "application/json" } });
    return new Response(`<!doctype html><html><head><title>t</title></head><body>Seite</body></html>`, { headers: { "content-type": "text/html; charset=utf-8" } });
  };
  for (let i = 0; i < RUNDEN; i++) {
    let p = wahl(SEITEN);
    if (zufall() < 0.4) p += enc(wahl(NUTZLAST)).slice(0, 400);
    if (zufall() < 0.5) p += `?${wahl(["q", "lang", "next", "redirect", "utm_source", "ref"])}=${enc(wahl(NUTZLAST)).slice(0, 1500)}`;
    const kopf = new Headers({ "User-Agent": wahl(["Mozilla/5.0 Chrome/130.0", `Mozilla/5.0 ${MARKE}<script>`, ""]), "CF-Connecting-IP": `192.0.2.${ganz(1, 250)}` });
    if (zufall() < 0.3) kopf.set("Accept-Language", wahl(NUTZLAST).slice(0, 100).replace(/[^\x20-\x7e]/g, ""));
    if (zufall() < 0.2) kopf.set("Cookie", `d119_lang=${wahl(NUTZLAST).slice(0, 100).replace(/[^\x21-\x7e]/g, "")}`);
    const methode = wahl(["GET", "GET", "GET", "HEAD", "POST", "OPTIONS"]);
    let res;
    try { res = await edge.fetch(new Request(`https://disorder119.com${p}`, { method: methode, headers: kopf }), {}, { waitUntil() {} }, herkunft); }
    catch (err) {
      if (err instanceof TypeError && /Invalid URL|header/i.test(err.message) && !String(err.stack).includes("storefront-edge")) continue;
      fehler.push(`${methode} ${p.slice(0, 100)}: Absturz ${err.message}`); continue;
    }
    const s = res.status; statistik.set(s, (statistik.get(s) || 0) + 1);
    const text = methode === "HEAD" ? "" : await res.text();
    if (s >= 500) fehler.push(`${methode} ${p.slice(0, 100)}: Status ${s}`);
    const ort = res.headers.get("location");
    if (ort) { const ziel = new URL(ort, "https://disorder119.com"); if (!/(^|\.)disorder119\.com$/.test(ziel.hostname)) fehler.push(`${p.slice(0, 100)}: offene Weiterleitung nach ${ort}`); }
    const ct = res.headers.get("content-type") || "";
    if (/html/i.test(ct) && /<script>FUZZ7x9|<img src=x onerror=FUZZ7x9/.test(text)) fehler.push(`${p.slice(0, 100)}: Nutzlast ungeschuetzt im HTML`);
    for (const muster of INTERNA) if (muster.test(text)) fehler.push(`${p.slice(0, 100)}: Interna (${muster})`);
  }
  console.log("[Shop-Seiten] Status:", JSON.stringify(Object.fromEntries([...statistik].sort())));
  assert.deepEqual([...new Set(fehler)].slice(0, 40), []);
});

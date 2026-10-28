import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { angriffsSignatur, bekannterBot, fremdAusgeloest, istHosting, waechterPruefen } from "./waechter-regeln.js";
import {
  anschlussHash, handleWaechterAdmin, uaKurz, waechterBuendeln, waechterFaelligkeit, waechterFehlversuch, waechterGesperrt, waechterIntern,
  waechterPflegen, waechterSelbstEntsperren, waechterSpeicherLeeren, waechterText, waechterVorfall,
} from "./waechter.js";
import edge, { waechterMerkerLeeren } from "./storefront-edge.js";
import workerEntry from "./worker-entry.js";
import { handleNewsletter } from "./newsletter.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const T0 = Date.parse("2026-10-28T10:00:00Z");
const MIN = 60_000, STD = 3_600_000, TAG = 24 * STD;
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
const sperre = (db, ip_hash) => db.raw.prepare("SELECT * FROM waechter_sperren WHERE anschluss=?").get(ip_hash);

test("Regeln erkennen Scanner, Angriffsproben und Werkzeuge", () => {
  const u = p => new URL(`https://disorder119.com${p}`);
  for (const p of ["/wp-admin/", "/wp-login.php", "/xmlrpc.php", "/.env", "/.git/config", "/phpmyadmin/", "/admin.php", "/cgi-bin/test", "/index.php", "/vendor/phpunit/x", "/server-status", "/actuator/health", "/.aws/credentials", "/assets/%2e%2e/%2e%2e/etc/passwd", "/blog/wp-includes/x"]) {
    assert.equal(waechterPruefen(u(p))?.art, "probe", p);
  }
  for (const [p, grund] of [
    ["/?id=1%27%20OR%20%271%27=%271", "sql-injection"], ["/artikel/1/?q=1 UNION SELECT password FROM users", "sql-injection"],
    ["/fr/mieten/?item=1%27%20AND%201=1%20UNION%20SELECT%20NULL--%20-", "sql-injection"],
    ["/?q=<script>alert(1)</script>", "xss"], ["/?r=javascript:alert(1)", "xss"],
    ["/assets/%252e%252e/%252e%252e/etc/passwd", "path-traversal"], ["/?f=../../etc/passwd", "path-traversal"],
    ["/?x=${jndi:ldap://evil/a}", "log4shell"], ["/?x=%24%7Bjndi%3Aldap%3A%2F%2Fe%7D", "log4shell"],
  ]) assert.deepEqual([waechterPruefen(u(p))?.art, waechterPruefen(u(p))?.grund], ["angriff", grund], p);
  for (const ua of ["sqlmap/1.7.2#stable", "Mozilla/5.0 (compatible; Nuclei)", "Nikto/2.5", "gobuster/3.6", "WPScan v3.8", "masscan/1.3", "zgrab/0.x", "DirBuster-1.0"]) {
    assert.equal(waechterPruefen(u("/"), ua)?.grund, "angriffs-programm", ua);
  }
  assert.equal(waechterPruefen(u("/"), "${jndi:ldap://x/a}")?.grund, "log4shell");
  for (const p of ["/", "/en/", "/artikel/238/", "/kasse/?artikel=238", "/?utm_source=instagram&utm_campaign=herbst&fbclid=abc", "/assets/app.js?v=c038488e1f",
    "/.well-known/apple-developer-merchantid-domain-association", "/datenschutz/", "/universe/", "/data/catalog.json", "/feed/google-merchant.xml",
    "/adresse/vorschlag?plz=63739&strasse=Hauptstra%C3%9Fe", "/artikel/12/?from=archive", "/fr/agb/", "/kasse/?products=12:1&coupon=D119-10-ABC"]) {
    assert.equal(waechterPruefen(u(p), CHROME), null, p);
  }
});

test("Signatur: gleiche Luecke mit wechselnder Nutzlast und Sprache bleibt dieselbe Kampagne", () => {
  const u = p => new URL(`https://disorder119.com${p}`);
  const a = angriffsSignatur(u("/fr/mieten/?item=1' AND 1=1 UNION SELECT NULL-- -"), "sql-injection");
  assert.equal(a, "sql-injection|/mieten/?item");
  assert.equal(angriffsSignatur(u("/mieten/?item=2 UNION SELECT 1,2"), "sql-injection"), a);
  assert.equal(angriffsSignatur(u("/en/artikel/123/?q=x"), "xss"), "xss|/artikel/0/?q");
  assert.notEqual(angriffsSignatur(u("/kasse/?item=1"), "sql-injection"), a);
});

test("Bots: Kennung zaehlt nur aus dem Netz des Betreibers", () => {
  const mitNetz = asn => ({ cf: { asn, country: "US" } });
  const google = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
  assert.equal(bekannterBot(mitNetz(15169), google), true, "echter Googlebot");
  assert.equal(bekannterBot(mitNetz(16276), google), false, "Googlebot-Kennung aus einem OVH-Server");
  assert.equal(bekannterBot(mitNetz(8075), "Mozilla/5.0 (compatible; bingbot/2.0)"), false, "Microsoft-Netz = auch jede Azure-VM");
  assert.equal(bekannterBot(mitNetz(32934), "facebookexternalhit/1.1"), true);
  assert.equal(bekannterBot(mitNetz(14061), "PayPal/AUHD-214.0"), false);
  assert.equal(bekannterBot({ cf: { verifiedBotCategory: "Search Engine Crawler" } }, "x"), true);
  assert.equal(bekannterBot({ cf: { botManagement: { verifiedBot: true } } }, "x"), true);
  // Ohne cf-Objekt (interne Aufrufe, alte Tests) wie bisher nach Kennung.
  assert.equal(bekannterBot({}, google), true);
  assert.equal(bekannterBot({}, CHROME), false);
});

test("Hoster und Privat-Relay werden unterschieden", () => {
  for (const [asn, name] of [[16276, "OVH SAS"], [24940, "Hetzner Online GmbH"], [14061, "DIGITALOCEAN-ASN"], [16509, "AMAZON-02"], [9009, "M247 Europe SRL"], [63949, "Akamai Connected Cloud"], [0, "Contabo GmbH"], [0, "Datacamp Limited"]]) {
    assert.equal(istHosting(asn, name), true, name);
  }
  for (const [asn, name] of [[36183, "Akamai Technologies, Inc."], [13335, "Cloudflare, Inc."], [54113, "Fastly, Inc."], [3320, "Deutsche Telekom AG"], [3209, "Vodafone GmbH"], [6805, "Telefonica Germany"], [12322, "Free SAS"]]) {
    assert.equal(istHosting(asn, name), false, name);
  }
  const fremd = new Request("https://disorder119.com/?q=<svg>", { headers: { "Sec-Fetch-Site": "cross-site" } });
  assert.equal(fremdAusgeloest(fremd), true);
  assert.equal(fremdAusgeloest(new Request("https://disorder119.com/", { headers: { "Sec-Fetch-Site": "none" } })), false);
});

test("Angriff sperrt sofort fuer 24 h ohne Turnstile - nur Hash, eine gebuendelte Telegram-Nachricht", async () => {
  const db = d1(), tg = telegramFangen();
  try {
    const env = envMit(db);
    const r = await waechterVorfall(env, null, { ip: IP, ua: "sqlmap/1.7.2#stable (https://sqlmap.org)", land: "CN", pfad: "/?id=1' OR '1'='1", art: "angriff", grund: "sql-injection", asn: 4134, netz: "Chinanet", nr: "W-ABCD2345" }, T0);
    assert.equal(r.gesperrt, true);
    assert.equal(r.selbst, false, "eindeutiger Angriff: keine Selbst-Entsperrung");
    assert.equal(await waechterGesperrt(env, IP, T0 + MIN), true);
    assert.equal(await waechterGesperrt(env, "203.0.113.1", T0 + MIN), false);
    assert.equal(await waechterGesperrt(env, IP, T0 + TAG + 1000), false, "nach 24 h frei");
    const alles = JSON.stringify([...db.raw.prepare("SELECT * FROM waechter_sperren").all(), ...db.raw.prepare("SELECT * FROM waechter_vorfaelle").all()]);
    assert.ok(!alles.includes(IP), "keine IP in der Datenbank");
    const s = sperre(db, await anschlussHash(env, IP));
    assert.equal(s.nr, "W-ABCD2345");
    assert.equal(s.netz, "Chinanet");
    assert.equal(s.sammeln, 1);
    // Sofort nichts, erst nach der Sammelminute genau eine Nachricht.
    assert.equal(tg.nachrichten.length, 0);
    assert.equal((await waechterBuendeln(env, T0 + 30_000)).gesendet, 0);
    assert.equal((await waechterBuendeln(env, T0 + MIN + 1000)).gesendet, 1);
    assert.equal(tg.nachrichten.length, 1);
    assert.match(tg.nachrichten[0], /SICHERHEIT: verdächtiger Besucher gesperrt \(24 h\)/);
    assert.match(tg.nachrichten[0], /China · Chinanet \(AS4134\)/);
    assert.match(tg.nachrichten[0], /sqlmap\/1․7․2/, "Fremdtext entschaerft: nicht klickbar");
    assert.match(tg.nachrichten[0], /SQL-Injection: \/\?id=1' OR '1'='1/);
    assert.ok(!tg.nachrichten[0].includes(IP), "keine IP in Telegram");
    // Weitere Versuche: keine zweite Nachricht, Anzahl steigt.
    await waechterVorfall(env, null, { ip: IP, ua: "sqlmap", land: "CN", pfad: "/?q=<script>", art: "angriff", grund: "xss" }, T0 + 10 * MIN);
    assert.equal((await waechterBuendeln(env, T0 + 30 * MIN)).gesendet, 0);
    assert.equal(tg.nachrichten.length, 1);
    assert.ok(sperre(db, await anschlussHash(env, IP)).versuche >= 2);
  } finally { tg.zurueck(); }
});

test("Schwellen: Scanner-Pfade 3, 404 20, Flut 3 - mit Turnstile-Option; Hoster schon beim ersten Scanner-Pfad", async () => {
  const db = d1(), tg = telegramFangen();
  try {
    const env = envMit(db);
    const vorfall = (art, i, ip = IP, extra = {}) => waechterVorfall(env, null, { ip, ua: CHROME, land: "NL", pfad: `/x${i}.php`, art, grund: art === "probe" ? "scanner-pfad" : "", ...extra }, T0 + i * 1000);
    assert.equal((await vorfall("probe", 1)).gesperrt, false);
    assert.equal((await vorfall("probe", 2)).gesperrt, false, "zwei Scanner-Pfade (z. B. eigener Sicherheitstest) sperren nicht");
    const r = await vorfall("probe", 3);
    assert.equal(r.gesperrt, true);
    assert.equal(r.selbst, true, "Scanner-Sperre: Mensch darf sich selbst entsperren");
    for (let i = 1; i < 20; i++) assert.equal((await vorfall("404", i, "192.0.2.10")).gesperrt, false);
    assert.equal((await vorfall("404", 20, "192.0.2.10")).gesperrt, true);
    assert.equal(db.raw.prepare("SELECT grund FROM waechter_sperren ORDER BY id DESC").get().grund, "zu-viele-404");
    assert.equal((await vorfall("flut", 1, "192.0.2.20")).gesperrt, false);
    assert.equal((await vorfall("flut", 2, "192.0.2.20")).gesperrt, false);
    assert.equal((await vorfall("flut", 3, "192.0.2.20")).gesperrt, true);
    // Rechenzentrum: der erste Scanner-Pfad sperrt, 404-Flut schon ab 10.
    assert.equal((await vorfall("probe", 1, "192.0.2.40", { asn: 14061, netz: "DigitalOcean, LLC" })).gesperrt, true);
    for (let i = 1; i < 10; i++) assert.equal((await vorfall("404", i, "192.0.2.41", { asn: 24940, netz: "Hetzner Online GmbH" })).gesperrt, false);
    assert.equal((await vorfall("404", 10, "192.0.2.41", { asn: 24940, netz: "Hetzner Online GmbH" })).gesperrt, true);
    // Privat-Relay und Mobilfunk bleiben bei den normalen Schwellen.
    assert.equal((await waechterVorfall(env, null, { ip: "192.0.2.42", ua: CHROME, pfad: "/relay.php", art: "probe", grund: "scanner-pfad", asn: 36183, netz: "Akamai Technologies, Inc." }, T0)).gesperrt, false);
    assert.equal((await waechterVorfall(env, null, { ip: "192.0.2.43", ua: CHROME, pfad: "/mobil.php", art: "probe", grund: "scanner-pfad", asn: 3320, netz: "Deutsche Telekom AG" }, T0)).gesperrt, false);
    // Bots und Unsinn zaehlen nicht.
    assert.equal((await waechterVorfall(env, null, { ip: "192.0.2.30", art: "angriff", grund: "xss", bot: true }, T0)).gesperrt, false);
    assert.equal((await waechterVorfall(env, null, { ip: "192.0.2.30", art: "quatsch" }, T0)).gesperrt, false);
    assert.equal((await waechterVorfall(envMit(db, { WAECHTER: "aus" }), null, { ip: "192.0.2.31", art: "angriff", grund: "xss" }, T0)).gesperrt, false);
  } finally { tg.zurueck(); }
});

test("Kampagne: dieselbe SQL-Injection von 4 Anschluessen -> eine Meldung, danach strenger fuer dieselben Netze", async () => {
  const db = d1(), tg = telegramFangen();
  try {
    const env = envMit(db);
    const angreifer = [["192.0.2.101", 16276, "OVH SAS"], ["192.0.2.102", 16276, "OVH SAS"], ["192.0.2.103", 12322, "Free SAS"], ["192.0.2.104", 12322, "Free SAS"]];
    for (const [i, [ip, asn, netz]] of angreifer.entries()) {
      const r = await waechterVorfall(env, null, { ip, ua: CHROME, land: "FR", pfad: `/fr/mieten/?item=1' AND ${i}=${i} UNION SELECT NULL-- -`, art: "angriff", grund: "sql-injection", asn, netz }, T0 + i * 4000);
      assert.equal(r.gesperrt, true);
    }
    const k = db.raw.prepare("SELECT * FROM waechter_kampagnen").get();
    assert.equal(k.signatur, "sql-injection|/mieten/?item");
    assert.equal(k.anschluesse, 4);
    assert.equal(Date.parse(k.streng_bis), T0 + 3 * 4000 + 2 * STD, "Standard: 2 Stunden strenger");
    assert.equal(db.raw.prepare("SELECT COUNT(*) n FROM waechter_sperren WHERE kampagne=?").get(k.id).n, 4, "alle vier gehoeren zur Kampagne");
    // Eine einzige Telegram-Nachricht fuer alle vier.
    assert.equal(await waechterFaelligkeit(env, T0 + 20_000), T0 + MIN);
    assert.equal((await waechterBuendeln(env, T0 + MIN)).gesendet, 1);
    assert.equal(tg.nachrichten.length, 1);
    assert.match(tg.nachrichten[0], /verteilter Angriff erkannt/);
    assert.match(tg.nachrichten[0], /SQL-Injection auf \/mieten\/\?item/);
    assert.match(tg.nachrichten[0], /4 Anschlüsse · Frankreich 4/);
    assert.match(tg.nachrichten[0], /OVH SAS \(AS16276\) 2/);
    assert.match(tg.nachrichten[0], /4 Anschlüsse gesperrt \(davon 4 aus Kampagnen\)/);
    assert.equal((await waechterBuendeln(env, T0 + 2 * MIN)).gesendet, 0, "nicht doppelt");
    // Strenger Modus: neuer Anschluss aus OVH -> erster Scanner-Pfad sperrt;
    // aus einem unbeteiligten Netz erst ab der normalen Schwelle.
    const probe = (ip, asn, netz, t) => waechterVorfall(env, null, { ip, ua: CHROME, land: "FR", pfad: "/.env", art: "probe", grund: "scanner-pfad", asn, netz }, t);
    assert.equal((await probe("192.0.2.150", 16276, "OVH SAS", T0 + 30 * MIN)).gesperrt, true);
    assert.equal((await probe("192.0.2.151", 3320, "Deutsche Telekom AG", T0 + 30 * MIN)).gesperrt, false);
    assert.equal((await probe("192.0.2.152", 12322, "Free SAS", T0 + 3 * STD)).gesperrt, false, "nach dem strengen Fenster wieder normal");
    // Neue Sperren in derselben Kampagne kommen gesammelt, fruehestens 10 Minuten nach der letzten Meldung.
    assert.equal((await waechterBuendeln(env, T0 + 31 * MIN + 1000)).gesendet, 1);
    assert.equal(tg.nachrichten.length, 2);
  } finally { tg.zurueck(); }
});

test("Wiederholungstaeter: neue Sperre innerhalb von 7 Tagen dauert 7 Tage; vom Inhaber aufgehoben zaehlt nicht", async () => {
  const db = d1(), tg = telegramFangen();
  try {
    const env = envMit(db);
    const angriff = (t, ip = IP) => waechterVorfall(env, null, { ip, ua: "nikto", land: "US", pfad: "/?q=<script>", art: "angriff", grund: "xss" }, t);
    await angriff(T0);
    const zweite = await angriff(T0 + 2 * TAG);
    assert.equal(zweite.gesperrt, true);
    assert.equal(zweite.wiederholt, true);
    assert.equal(Date.parse(zweite.bis), T0 + 2 * TAG + 7 * TAG);
    const s = sperre(db, await anschlussHash(env, IP));
    assert.equal(s.anzahl, 2);
    assert.equal(await waechterGesperrt(env, IP, T0 + 8 * TAG), true);
    assert.match(waechterText(s), /7 Tage, Wiederholungstäter/);
    // Nach mehr als 7 Tagen ohne Sperre: wieder 24 h.
    const spaeter = await angriff(T0 + 2 * TAG + 7 * TAG + 8 * TAG);
    assert.equal(spaeter.wiederholt, false);
    // Vom Inhaber aufgehoben (Irrtum): naechste Sperre ist wieder die erste.
    const leser = { ...env, ADMIN_AUTH_CONTEXT: { role: "OWNER" } };
    const id = db.raw.prepare("SELECT id FROM waechter_sperren").get().id;
    const jetzt = T0 + 18 * TAG;
    await handleWaechterAdmin(new Request("https://api.disorder119.com/admin/besucher/sicherheit/aufheben", { method: "POST", headers: { Origin: ADMIN }, body: JSON.stringify({ id }) }), leser, new URL("https://api.disorder119.com/admin/besucher/sicherheit/aufheben"), jetzt);
    const danach = await angriff(jetzt + STD);
    assert.equal(danach.wiederholt, false);
    assert.equal(Date.parse(danach.bis), jetzt + STD + TAG);
  } finally { tg.zurueck(); }
});

test("Selbst-Entsperrung per Turnstile: nur milde Sperren, Rueckfall danach ohne Turnstile und 7 Tage", async () => {
  const db = d1(), tg = telegramFangen();
  try {
    const env = envMit(db, { TURNSTILE_SECRET: "geheim" });
    const pruefungen = [];
    const turnstile = (antwort) => async (url, init) => { pruefungen.push({ url, body: Object.fromEntries(init.body.entries()) }); return new Response(JSON.stringify(antwort)); };
    const probe = (i, t) => waechterVorfall(env, null, { ip: IP, ua: CHROME, land: "DE", pfad: `/wp-login${i}.php`, art: "probe", grund: "scanner-pfad" }, t);
    await probe(1, T0); await probe(2, T0 + 1000);
    assert.equal((await probe(3, T0 + 2000)).selbst, true);
    // Falsches Token: bleibt gesperrt.
    assert.deepEqual(await waechterSelbstEntsperren(env, { ip: IP, token: "x" }, T0 + MIN, turnstile({ success: false })), { ok: false, fehler: "TURNSTILE" });
    // Token von fremder Website: abgelehnt.
    assert.equal((await waechterSelbstEntsperren(env, { ip: IP, token: "x" }, T0 + MIN, turnstile({ success: true, hostname: "evil.example" }))).ok, false);
    assert.equal(await waechterGesperrt(env, IP, T0 + MIN), true);
    // Richtig: frei, Schwellen beginnen von vorn.
    const ok = await waechterSelbstEntsperren(env, { ip: IP, token: "gut" }, T0 + 2 * MIN, turnstile({ success: true, hostname: "disorder119.com" }));
    assert.deepEqual(ok, { ok: true, entsperrt: true });
    assert.equal(pruefungen.at(-1).body.remoteip, IP);
    assert.equal(pruefungen.at(-1).body.secret, "geheim");
    assert.equal(await waechterGesperrt(env, IP, T0 + 2 * MIN), false);
    assert.equal(db.raw.prepare("SELECT COUNT(*) n FROM waechter_vorfaelle").get().n, 0);
    // Wieder auffaellig: gesperrt ohne Turnstile-Option, 7 Tage.
    await probe(4, T0 + 3 * MIN); await probe(5, T0 + 3 * MIN + 1000);
    const rueckfall = await probe(6, T0 + 3 * MIN + 2000);
    assert.equal(rueckfall.gesperrt, true);
    assert.equal(rueckfall.selbst, false);
    assert.equal(Date.parse(rueckfall.bis), T0 + 3 * MIN + 2000 + 7 * TAG);
    assert.deepEqual(await waechterSelbstEntsperren(env, { ip: IP, token: "gut" }, T0 + 4 * MIN, turnstile({ success: true })), { ok: false, fehler: "NICHT_ERLAUBT" });
    // Eindeutiger Angriff: nie selbst entsperrbar; ohne Secret auch nicht.
    await waechterVorfall(env, null, { ip: "192.0.2.9", ua: "x", art: "angriff", grund: "sql-injection", pfad: "/?id=1 union select 1" }, T0);
    assert.equal((await waechterSelbstEntsperren(env, { ip: "192.0.2.9", token: "gut" }, T0 + MIN, turnstile({ success: true }))).fehler, "NICHT_ERLAUBT");
    await waechterVorfall(env, null, { ip: "192.0.2.8", ua: "x", art: "probe", grund: "scanner-pfad", pfad: "/.env", asn: 14061, netz: "DigitalOcean" }, T0);
    assert.equal((await waechterSelbstEntsperren({ ...env, TURNSTILE_SECRET: "" }, { ip: "192.0.2.8", token: "gut" }, T0 + MIN, turnstile({ success: true }))).fehler, "NICHT_EINGERICHTET");
    // Nicht gesperrt: einfach ok.
    assert.deepEqual(await waechterSelbstEntsperren(env, { ip: "203.0.113.77", token: "gut" }, T0, turnstile({ success: true })), { ok: true });
  } finally { tg.zurueck(); }
});

test("Waehrend einer milden Sperre echt angegriffen: ab dann ohne Turnstile", async () => {
  const db = d1(), tg = telegramFangen();
  try {
    const env = envMit(db);
    for (let i = 1; i <= 3; i++) await waechterVorfall(env, null, { ip: IP, ua: CHROME, pfad: `/x${i}.php`, art: "probe", grund: "scanner-pfad" }, T0 + i * 1000);
    assert.equal(sperre(db, await anschlussHash(env, IP)).selbst, 1);
    const r = await waechterVorfall(env, null, { ip: IP, ua: CHROME, pfad: "/?id=1 UNION SELECT 1", art: "angriff", grund: "sql-injection" }, T0 + 10_000);
    assert.equal(r.selbst, false);
    assert.equal(sperre(db, await anschlussHash(env, IP)).selbst, 0);
    assert.equal(sperre(db, await anschlussHash(env, IP)).grund, "sql-injection");
  } finally { tg.zurueck(); }
});

test("API: durchprobierte Gutschein-Codes, fehlgeschlagene Zahlungen und Formular-Falle sperren ab der Schwelle", async () => {
  const db = d1(), tg = telegramFangen();
  try {
    const env = envMit(db);
    const anfrage = (ip, p = "/coupons/validate") => new Request(`https://api.disorder119.com${p}`, { method: "POST", headers: { "CF-Connecting-IP": ip, "User-Agent": CHROME } });
    const url = new URL("https://api.disorder119.com/coupons/validate");
    for (let i = 1; i < 12; i++) await waechterFehlversuch(anfrage(IP), env, null, url, "enum", T0 + i * 1000);
    assert.equal(await waechterGesperrt(env, IP, T0 + 20_000), false, "11 falsche Codes: noch kein Verdacht");
    await waechterFehlversuch(anfrage(IP), env, null, url, "enum", T0 + 13_000);
    const s = sperre(db, await anschlussHash(env, IP));
    assert.equal(s.grund, "codes-durchprobiert");
    assert.equal(s.selbst, 1);
    const kasse = new URL("https://api.disorder119.com/capture-order");
    for (let i = 1; i <= 8; i++) await waechterFehlversuch(anfrage("192.0.2.60", "/capture-order"), env, null, kasse, "kasse", T0 + i * 1000);
    assert.equal(sperre(db, await anschlussHash(env, "192.0.2.60")).grund, "kasse-fehlschlaege");
    const nl = new URL("https://api.disorder119.com/newsletter/subscribe");
    await waechterFehlversuch(anfrage("192.0.2.61", "/newsletter/subscribe"), env, null, nl, "falle", T0);
    assert.equal(await waechterGesperrt(env, "192.0.2.61", T0 + 1000), false);
    await waechterFehlversuch(anfrage("192.0.2.61", "/newsletter/subscribe"), env, null, nl, "falle", T0 + 5 * MIN);
    assert.equal(sperre(db, await anschlussHash(env, "192.0.2.61")).grund, "formular-falle");
    // Nur bekannte Arten.
    await waechterFehlversuch(anfrage("192.0.2.62"), env, null, url, "angriff", T0);
    assert.equal(await waechterGesperrt(env, "192.0.2.62", T0 + 1000), false);
  } finally { tg.zurueck(); }
});

test("Newsletter-Falle: ausgefuelltes verstecktes Feld -> gleiche Antwort, nichts gespeichert, Waechter zaehlt", async () => {
  const db = d1();
  let gezaehlt = 0;
  const env = { DB: db, MAIL_API_KEY: "k", MAIL_FROM: "kontakt@disorder119.com" };
  const req = body => new Request("https://api.disorder119.com/newsletter/subscribe", { method: "POST", headers: { Origin: "https://disorder119.com", "Content-Type": "application/json", "CF-Connecting-IP": IP }, body: JSON.stringify(body) });
  const res = await handleNewsletter(req({ email: "bot@example.com", consent: true, website: "http://spam.example" }), env, new URL("https://api.disorder119.com/newsletter/subscribe"), "r", "https://disorder119.com", { falle: () => { gezaehlt++; } });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  assert.equal(gezaehlt, 1);
  assert.equal(db.raw.prepare("SELECT COUNT(*) n FROM newsletter_subscribers").get().n, 0);
});

test("Admin: Sperren mit Stufe und Netz, Kampagnen; Liste nur angemeldet, Aufheben nur als Inhaber", async () => {
  const db = d1(), tg = telegramFangen();
  try {
    const env = envMit(db);
    await waechterVorfall(env, null, { ip: IP, ua: CHROME, land: "RU", pfad: "/?x=${jndi:ldap://e/a}", art: "angriff", grund: "log4shell", asn: 16276, netz: "OVH SAS", nr: "W-TEST2345" }, T0);
    for (let i = 0; i < 3; i++) await waechterVorfall(env, null, { ip: `192.0.2.${70 + i}`, ua: CHROME, land: "NL", pfad: "/.git/config", art: "probe", grund: "scanner-pfad", asn: 24940, netz: "Hetzner" }, T0 + i * 1000);
    const req = (pfad, init = {}) => new Request(`https://api.disorder119.com${pfad}`, { ...init, headers: { Origin: ADMIN, ...(init.headers || {}) } });
    assert.equal((await handleWaechterAdmin(req("/admin/besucher/sicherheit"), env, new URL("https://api.disorder119.com/admin/besucher/sicherheit"), T0)).status, 401);
    const leser = { ...env, ADMIN_AUTH_CONTEXT: { role: "READER" } };
    const res = await handleWaechterAdmin(req("/admin/besucher/sicherheit"), leser, new URL("https://api.disorder119.com/admin/besucher/sicherheit"), T0 + 10_000);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("Access-Control-Allow-Origin"), ADMIN);
    const daten = await res.json();
    assert.equal(daten.aktiveSperren, 4);
    const ru = daten.sperren.find(s => s.land === "RU");
    assert.equal(ru.landName, "Russland");
    assert.equal(ru.grundText, "Log4Shell-Versuch");
    assert.equal(ru.selbstEntsperrbar, false);
    assert.equal(ru.netz, "OVH SAS");
    assert.equal(ru.nr, "W-TEST2345");
    assert.equal(ru.dauerTage, 1);
    assert.equal(daten.kampagnen.length, 1);
    assert.equal(daten.kampagnen[0].ziel, "/.git/config");
    assert.equal(daten.kampagnen[0].anschluesse, 3);
    assert.equal(daten.kampagnen[0].aktiv, true);
    assert.deepEqual(daten.kampagnen[0].netze.map(n => n.name), ["Hetzner"]);
    assert.equal(daten.kampagnenAktiv, 1);
    assert.ok(!JSON.stringify(daten).includes(IP) && !JSON.stringify(daten).includes(await anschlussHash(env, IP)), "weder IP noch Hash im Admin");
    const aufheben = rolle => handleWaechterAdmin(req("/admin/besucher/sicherheit/aufheben", { method: "POST", body: JSON.stringify({ id: ru.id }) }),
      { ...env, ADMIN_AUTH_CONTEXT: { role: rolle } }, new URL("https://api.disorder119.com/admin/besucher/sicherheit/aufheben"), T0 + 20_000);
    assert.equal((await aufheben("READER")).status, 403);
    assert.equal(await waechterGesperrt(env, IP, T0 + 30_000), true);
    assert.equal((await aufheben("OWNER")).status, 200);
    assert.equal(await waechterGesperrt(env, IP, T0 + 30_000), false);
    assert.ok(sperre(db, await anschlussHash(env, IP)).admin_frei);
    // Nach dem Aufheben sperrt nicht schon der naechste einzelne Scanner-Pfad.
    assert.equal((await waechterVorfall(env, null, { ip: IP, ua: CHROME, art: "probe", grund: "scanner-pfad", pfad: "/a.php" }, T0 + 40_000)).gesperrt, false);
  } finally { tg.zurueck(); }
});

function edgeUmgebung({ gesperrt = false, selbst = false, bis = null, vorfallAntwort = null } = {}) {
  const gesendet = [], laeuft = [];
  const zustand = { gesperrt, selbst, bis };
  const env = { BESUCH: { fetch: async (url, init) => {
    const body = JSON.parse(init.body);
    gesendet.push({ url, body });
    if (url.endsWith("/pruefen")) return new Response(JSON.stringify(zustand.gesperrt ? { gesperrt: true, selbst: zustand.selbst, bis: zustand.bis } : { gesperrt: false }), { status: 200 });
    if (url.endsWith("/entsperren")) return new Response(JSON.stringify(body.token === "gut" ? { ok: true, entsperrt: true } : { ok: false, fehler: "TURNSTILE" }), { status: 200 });
    return new Response(JSON.stringify(vorfallAntwort ? vorfallAntwort(body) : { gesperrt: false }), { status: 200 });
  } } };
  return { env, gesendet, laeuft, ctx: { waitUntil: p => laeuft.push(p) }, zustand };
}
const seite = async () => new Response("<p>ok</p>", { headers: { "Content-Type": "text/html" } });
const anfrage = (p, { ua = CHROME, ip = IP, headers = {}, cf = { country: "FR", asn: 12322, asOrganization: "Free SAS", city: "Lyon" }, method = "GET", body } = {}) => {
  const r = new Request(`https://disorder119.com${p}`, { method, body, headers: { "User-Agent": ua, "CF-Connecting-IP": ip, ...headers } });
  Object.defineProperty(r, "cf", { value: cf });
  return r;
};

test("Storefront: Angriffsprobe -> Erwischt-Seite (Landessprache, maskiert, CSP-Hash), Scanner-Pfad 404, fremd ausgeloest nur 403", async () => {
  const u = edgeUmgebung();
  let ursprung = 0;
  const origin = async () => { ursprung++; return seite(); };
  let res = await edge.fetch(anfrage("/fr/mieten/?item=1%27%20AND%201=1%20UNION%20SELECT%20NULL--%20-"), u.env, u.ctx, origin);
  assert.equal(res.status, 403);
  assert.equal(res.headers.get("Cache-Control"), "no-store");
  assert.match(res.headers.get("X-Robots-Tag"), /noindex/);
  assert.match(res.headers.get("Content-Security-Policy"), /^default-src 'none'; style-src 'sha256-[A-Za-z0-9+/=]+'; img-src 'none'/);
  const html = await res.text();
  assert.match(html, /<html lang="fr" dir="ltr">/);
  assert.match(html, /ATTAQUE DÉTECTÉE/);
  assert.match(html, /I know you&#39;re trying to hack me\./, "Englisch immer dazu");
  assert.match(html, /198\.51\.100\.66/);
  assert.match(html, /Free SAS \(AS12322\)/);
  assert.match(html, /Lyon, France/);
  assert.match(html, /item=1&#39; AND 1=1 UNION SELECT NULL-- -/);
  assert.ok(!/<script/i.test(html), "kein Skript");
  await Promise.all(u.laeuft);
  const vorfall = u.gesendet.find(g => g.url.endsWith("/vorfall")).body;
  assert.deepEqual([vorfall.art, vorfall.grund, vorfall.asn, vorfall.netz], ["angriff", "sql-injection", 12322, "Free SAS"]);
  assert.match(vorfall.nr, /^W-[A-Z0-9]{7}$/);
  assert.ok(html.includes(vorfall.nr), "dieselbe Vorfall-Nummer auf der Seite");
  assert.equal(ursprung, 0);

  // Von fremder Seite ausgeloest (Bild/Link): nur 403, keine Meldung, keine Erwischt-Seite.
  const vorher = u.gesendet.length;
  res = await edge.fetch(anfrage("/?ref=%3Csvg%20onload=alert(1)%3E", { headers: { "Sec-Fetch-Site": "cross-site", "Sec-Fetch-Dest": "image" } }), u.env, u.ctx, origin);
  assert.equal(res.status, 403);
  assert.doesNotMatch(await res.text(), /ATTAQUE|ATTACK/);
  await Promise.all(u.laeuft);
  assert.equal(u.gesendet.length, vorher, "nichts gemeldet");

  // Scanner-Pfad unter der Schwelle: 404-Seite.
  res = await edge.fetch(anfrage("/wp-login.php", { ip: "192.0.2.5" }), u.env, u.ctx, origin);
  assert.equal(res.status, 404);
  assert.match(await res.text(), /Seite nicht gefunden/);
});

test("Storefront: Scanner-Pfad, der sperrt, zeigt schon die Erwischt-Seite; Bots nie", async () => {
  const u = edgeUmgebung({ vorfallAntwort: () => ({ gesperrt: true, selbst: true }) });
  let res = await edge.fetch(anfrage("/.env", { cf: { country: "KH", asn: 14061, asOrganization: "DigitalOcean, LLC" } }), u.env, u.ctx, seite);
  assert.equal(res.status, 403);
  const html = await res.text();
  assert.match(html, /<html lang="km"/);
  assert.match(html, /Vulnerability scan/);
  // Googlebot aus Googles Netz folgt einem Spam-Link: 404, als Bot gemeldet.
  waechterMerkerLeeren();
  res = await edge.fetch(anfrage("/wp-login.php", { ua: "Mozilla/5.0 (compatible; Googlebot/2.1)", ip: "66.249.66.1", cf: { country: "US", asn: 15169 } }), u.env, u.ctx, seite);
  assert.equal(res.status, 404);
  await Promise.all(u.laeuft);
  assert.equal(u.gesendet.filter(g => g.url.endsWith("/vorfall")).at(-1).body.bot, true);
});

test("Storefront: gesperrt -> neutrale Sperrseite (de/en/fr, Impressum), Turnstile nur bei milden Sperren; Rechtsseiten und Bilder frei", async () => {
  const bis = new Date(T0 + TAG).toISOString();
  const mild = edgeUmgebung({ gesperrt: true, selbst: true, bis });
  let res = await edge.fetch(anfrage("/fr/mieten/?x=1"), mild.env, mild.ctx, seite);
  assert.equal(res.status, 403);
  assert.match(res.headers.get("Content-Security-Policy"), /script-src https:\/\/challenges\.cloudflare\.com/);
  let html = await res.text();
  assert.match(html, /<html lang="fr">/);
  assert.match(html, /Un petit instant/);
  assert.match(html, /Kurz anhalten/);
  assert.match(html, /Please hold on/);
  assert.match(html, /class="cf-turnstile" data-sitekey="0x4AAAAAAFHqI2j_AitAYIKF"/);
  assert.match(html, /name="zurueck" value="\/fr\/mieten\/\?x=1"/);
  assert.match(html, /href="\/fr\/impressum\/"/);
  assert.doesNotMatch(html, /ATTAQUE|hack/i, "Unbeteiligte sehen nie den Erwischt-Bildschirm");
  // Rechtsseiten, Bilder und Skripte bleiben erreichbar.
  for (const p of ["/impressum/", "/en/datenschutz/", "/fr/agb/", "/widerruf/", "/assets/app.js"]) {
    assert.equal((await edge.fetch(anfrage(p), mild.env, mild.ctx, seite)).status, 200, p);
  }
  // Harte Sperre: keine Turnstile-Option, dafuer das Ende.
  waechterMerkerLeeren();
  const hart = edgeUmgebung({ gesperrt: true, selbst: false, bis });
  res = await edge.fetch(anfrage("/", { cf: { country: "DE" } }), hart.env, hart.ctx, seite);
  html = await res.text();
  assert.match(html, /<html lang="de">/);
  assert.doesNotMatch(html, /class="cf-turnstile"|turnstile\/v0\/api\.js/);
  assert.match(html, /Die Sperre endet am 29\. Oktober um 11:00/);
  // Antwort wird eine Minute gemerkt.
  const vorher = hart.gesendet.filter(g => g.url.endsWith("/pruefen")).length;
  await edge.fetch(anfrage("/kasse/", { cf: { country: "DE" } }), hart.env, hart.ctx, seite);
  assert.equal(hart.gesendet.filter(g => g.url.endsWith("/pruefen")).length, vorher);
});

test("Storefront: Selbst-Entsperrung -> 303 zur alten Seite, nie auf fremde Adressen", async () => {
  const u = edgeUmgebung({ gesperrt: true, selbst: true, bis: new Date(T0 + TAG).toISOString() });
  const post = (token, zurueck) => anfrage("/_waechter/entsperren", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ "cf-turnstile-response": token, zurueck }).toString() });
  let res = await edge.fetch(post("gut", "/fr/mieten/?x=1"), u.env, u.ctx, seite);
  assert.equal(res.status, 303);
  assert.equal(res.headers.get("Location"), "/fr/mieten/?x=1");
  const entsperren = u.gesendet.find(g => g.url.endsWith("/entsperren")).body;
  assert.deepEqual(entsperren, { ip: IP, token: "gut" });
  for (const boese of ["//evil.example/x", "https://evil.example/", "/\\evil.example", "javascript:alert(1)", "/_waechter/entsperren"]) {
    waechterMerkerLeeren();
    res = await edge.fetch(post("gut", boese), u.env, u.ctx, seite);
    assert.equal(res.headers.get("Location"), "/", boese);
  }
  // Falsches Token: Sperrseite mit Hinweis.
  waechterMerkerLeeren();
  res = await edge.fetch(post("falsch", "/"), u.env, u.ctx, seite);
  assert.equal(res.status, 403);
  assert.match(await res.text(), /class="fehler" role="alert">La vérification n&#39;a pas fonctionné/);
  // GET auf den Weg: einfach zurueck zum Shop.
  assert.equal((await edge.fetch(anfrage("/_waechter/entsperren"), u.env, u.ctx, seite)).status, 303);
});

test("Storefront: Vorschau fuer die Admin-App zeigt Beispieldaten und meldet nichts", async () => {
  const u = edgeUmgebung();
  const res = await edge.fetch(anfrage("/_waechter/vorschau?land=IN"), u.env, u.ctx, seite);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /<html lang="hi"/);
  assert.match(html, /हमला पकड़ा गया/);
  assert.match(html, /I know you&#39;re trying to hack me/);
  assert.match(html, /PREVIEW/);
  assert.match(html, /203\.0\.113\.42/);
  assert.ok(!html.includes(IP), "keine echte IP in der Vorschau");
  const sperr = await edge.fetch(anfrage("/_waechter/vorschau?seite=sperre&sprache=en"), u.env, u.ctx, seite);
  assert.equal(sperr.status, 200);
  assert.match(await sperr.text(), /<html lang="en">/);
  for (const [query, sprache] of [["seite=sperre", "de"], ["seite=sperre&selbst=0", "de"], ["seite=sperre&land=FR", "fr"], ["seite=sperre&sprache=quatsch", "de"]]) {
    assert.match(await (await edge.fetch(anfrage(`/_waechter/vorschau?${query}`), u.env, u.ctx, seite)).text(), new RegExp(`<html lang="${sprache}">`), query);
  }
  await Promise.all(u.laeuft);
  assert.equal(u.gesendet.length, 0);
});

test("Storefront: Flut 429 je Anschluss (IPv6 /64), Ausfall der Pruefung laesst die Seite offen", async () => {
  const u = edgeUmgebung();
  const schluessel = [];
  const flut = { ...u.env, WAECHTER_FLUT: { limit: async ({ key }) => { schluessel.push(key); return { success: false }; } } };
  const res = await edge.fetch(anfrage("/", { ip: "2001:db8:abcd:12:1:2:3:4" }), flut, u.ctx, seite);
  assert.equal(res.status, 429);
  assert.equal(schluessel[0], "2001:db8:abcd:12::/64");
  await Promise.all(u.laeuft);
  assert.equal(u.gesendet.filter(g => g.url.endsWith("/vorfall")).at(-1).body.art, "flut");
  waechterMerkerLeeren();
  const kaputt = { BESUCH: { fetch: async () => { throw new Error("weg"); } } };
  assert.equal((await edge.fetch(anfrage("/", { ip: "192.0.2.78" }), kaputt, u.ctx, seite)).status, 200);
});

test("Shop-API: Probe, Sperre, Ausnahmen fuer Webhooks, Admin und Widerruf; fremd ausgeloest sperrt nicht", async () => {
  const db = d1(), tg = telegramFangen();
  try {
    const env = envMit(db);
    const ctx = { waitUntil() {} };
    const anfrageApi = (p, init = {}, ip = IP) => new Request(`https://api.disorder119.com${p}`, { ...init, headers: { "User-Agent": CHROME, "CF-Connecting-IP": ip, ...(init.headers || {}) } });
    // Fremde Seite loest ein Angriffsmuster aus: 403, aber keine Sperre.
    let res = await workerEntry.fetch(anfrageApi("/versand/optionen?x=<script>", { headers: { "Sec-Fetch-Site": "cross-site" } }, "192.0.2.90"), env, ctx);
    assert.equal(res.status, 403);
    await new Promise(r => setTimeout(r, 20));
    assert.equal(await waechterGesperrt(env, "192.0.2.90"), false);
    res = await workerEntry.fetch(anfrageApi("/.env"), env, ctx);
    assert.equal(res.status, 404);
    res = await workerEntry.fetch(anfrageApi("/versand/optionen?x=${jndi:ldap://e/a}"), env, ctx);
    assert.equal(res.status, 403);
    await new Promise(r => setTimeout(r, 20));
    assert.equal(await waechterGesperrt(env, IP), true);
    res = await workerEntry.fetch(anfrageApi("/versand/optionen"), env, ctx);
    assert.equal(res.status, 403);
    assert.equal((await res.json()).error, "BLOCKED");
    // PayPal-Webhook, Admin-Routen und die Widerrufsfunktion sind ausgenommen.
    res = await workerEntry.fetch(anfrageApi("/paypal-webhook", { method: "POST", body: "{}" }), env, ctx);
    assert.notEqual((await res.json().catch(() => ({}))).error, "BLOCKED");
    res = await workerEntry.fetch(anfrageApi("/admin/besucher/sicherheit"), env, ctx);
    assert.notEqual((await res.json().catch(() => ({}))).error, "BLOCKED");
    res = await workerEntry.fetch(anfrageApi("/widerruf", { method: "POST", headers: { Origin: "https://disorder119.com", "Content-Type": "application/json" }, body: "{}" }), env, ctx);
    assert.notEqual((await res.json().catch(() => ({}))).error, "BLOCKED");
    // Interne Dienstbindung: Vorfall, Pruefung, Entsperren.
    const intern = (p, body) => waechterIntern(new Request(`https://storefront.intern${p}`, { method: "POST", body: JSON.stringify(body) }), env, ctx, new URL(`https://storefront.intern${p}`));
    const info = await (await intern("/intern/waechter/pruefen", { ip: IP })).json();
    assert.equal(info.gesperrt, true);
    assert.equal(info.selbst, false);
    assert.deepEqual(await (await intern("/intern/waechter/pruefen", { ip: "203.0.113.200" })).json(), { gesperrt: false });
    assert.equal((await (await intern("/intern/waechter/vorfall", { ip: "203.0.113.201", ua: "nikto", art: "angriff", grund: "angriffs-programm", land: "DE" })).json()).gesperrt, true);
    assert.deepEqual(await (await intern("/intern/waechter/entsperren", { ip: "203.0.113.201", token: "" })).json(), { ok: false, fehler: "TOKEN_FEHLT" });
    // Von aussen (api.disorder119.com) gibt es die internen Wege nicht.
    res = await workerEntry.fetch(anfrageApi("/intern/waechter/pruefen", { method: "POST", body: JSON.stringify({ ip: IP }) }, "192.0.2.91"), env, ctx);
    assert.notEqual(res.status, 200);
  } finally { tg.zurueck(); }
});

test("Kurzform der Browserkennung und Nachrichtentext ohne IP", () => {
  assert.equal(uaKurz("sqlmap/1.7.2#stable (https://sqlmap.org)"), "sqlmap/1.7.2");
  assert.equal(uaKurz(CHROME), "Windows-PC · Chrome");
  assert.equal(uaKurz("python-requests/2.31.0"), "python-requests/2.31.0");
  assert.equal(uaKurz(""), "ohne Browserkennung");
  const text = waechterText({ land: "IN", ua_kurz: "nuclei", grund: "scanner-pfad", beispiel: "/wp-login.php", versuche: 7, seit: new Date(T0).toISOString(), bis: new Date(T0 + TAG).toISOString(), selbst: 1 });
  assert.match(text, /Indien/);
  assert.match(text, /7 Versuche/);
  assert.match(text, /Scanner-Pfade/);
  assert.match(text, /selbst entsperren/);
});

test("Ohne Migration, ohne Pfeffer oder bei D1-Ausfall arbeitet der Shop weiter", async () => {
  const leer = { prepare: () => ({ bind: () => ({ first: async () => { throw new Error("no such table: waechter_sperren"); }, run: async () => { throw new Error("no such table: waechter_vorfaelle"); }, all: async () => ({ results: [] }) }) }) };
  assert.equal(await waechterGesperrt({ DB: leer }, IP), false);
  assert.deepEqual(await waechterVorfall({ DB: leer }, null, { ip: IP, art: "angriff", grund: "xss" }), { gesperrt: false });
  const kaputt = { prepare: () => ({ bind: () => ({ first: async () => { throw new Error("D1_ERROR: network"); }, run: async () => { throw new Error("D1_ERROR"); }, all: async () => { throw new Error("D1_ERROR"); } }) }) };
  assert.equal(await waechterGesperrt({ DB: kaputt }, IP), false, "D1 weg: niemand gesperrt");
  assert.deepEqual(await waechterVorfall({ DB: kaputt }, null, { ip: IP, art: "angriff", grund: "xss" }), { gesperrt: false });
  assert.equal((await waechterBuendeln({ DB: kaputt, TELEGRAM_BOT_TOKEN: "t", TELEGRAM_CHAT_ID: "1" })).gesendet, 0);
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
    await waechterVorfall(env, null, { ip: IP, ua: "nikto", art: "angriff", grund: "xss" }, T0 + 23 * STD);
    assert.equal(await waechterGesperrt(env, IP, T0 + 30 * STD), true);
  } finally { tg.zurueck(); }
});

test("Cron raeumt auf und schickt liegengebliebene Meldungen; Telegram hoechstens alle 10 Minuten", async () => {
  const db = d1(), tg = telegramFangen();
  try {
    const env = envMit(db);
    for (let i = 0; i < 6; i++) await waechterVorfall(env, null, { ip: `192.0.2.${100 + i}`, ua: "nuclei", land: i % 2 ? "CN" : "VN", pfad: `/x${i}`, art: "angriff", grund: "angriffs-programm" }, T0 + i * 1000);
    assert.equal((await waechterPflegen(env, T0 + 5 * MIN)).gesendet, 1);
    assert.equal(tg.nachrichten.length, 1);
    assert.match(tg.nachrichten[0], /6 Anschlüsse gesperrt/);
    assert.match(tg.nachrichten[0], /Vietnam 3, China 3|China 3, Vietnam 3/);
    await waechterVorfall(env, null, { ip: "192.0.2.120", ua: "nuclei", land: "CN", pfad: "/y", art: "angriff", grund: "angriffs-programm" }, T0 + 6 * MIN);
    assert.equal((await waechterPflegen(env, T0 + 8 * MIN)).gesendet, 0, "Abstand 10 Minuten");
    assert.equal((await waechterPflegen(env, T0 + 15 * MIN + 1000)).gesendet, 1);
    await waechterPflegen(env, T0 + 9 * TAG);
    assert.equal(db.raw.prepare("SELECT COUNT(*) n FROM waechter_vorfaelle").get().n, 0);
    assert.equal(db.raw.prepare("SELECT COUNT(*) n FROM waechter_sperren").get().n, 0);
  } finally { tg.zurueck(); }
});

test("Abrufe anderer Cloudflare-Worker ohne Browserkennung (Testshop) werden nie gesperrt", async () => {
  const gesendet = [], laeuft = [];
  const env = { BESUCH: { fetch: async (url, init) => { gesendet.push({ url, body: JSON.parse(init.body) }); return new Response(JSON.stringify({ gesperrt: true }), { status: 200 }); } } };
  const ctx = { waitUntil: p => laeuft.push(p) };
  const anfrageW = p => { const r = new Request(`https://disorder119.com${p}`, { headers: { "CF-Connecting-IP": "2a06:98c0:3600::103" } }); Object.defineProperty(r, "cf", { value: { asn: 13335, country: "DE" } }); return r; };
  assert.equal((await edge.fetch(anfrageW("/"), env, ctx, seite)).status, 200, "keine Sperrabfrage, keine Sperre");
  assert.equal((await edge.fetch(anfrageW("/wp-login.php"), env, ctx, seite)).status, 404);
  assert.equal((await edge.fetch(anfrageW("/gibtsnicht/"), env, ctx, seite)).status, 404);
  await Promise.all(laeuft);
  assert.equal(gesendet.filter(g => g.url.endsWith("/pruefen")).length, 0);
  const vorfaelle = gesendet.filter(g => g.url.endsWith("/vorfall"));
  assert.deepEqual(vorfaelle.map(v => [v.body.art, v.body.bot]), [["probe", true]], "Probe nur als Bot gemeldet, 404 gar nicht");
});

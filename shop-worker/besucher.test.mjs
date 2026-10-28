import { sichtzeitBody, vereinigteZeit, zeitGruppen, verbundeneZeiten, sichtzeitIndex, sichtzeitZwischen } from "./besucher-sichtzeit.js";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";
import workerEntry from "./worker-entry.js";
import { sitzungenMelden, zusammenfassungText } from "./besucher-zusammenfassung.js";
import { sitzungBeruehren, weckerStellen } from "./besucher-sitzung.js";
import { BesucherWecker } from "./besucher-wecker.js";
import {
  artikelAusPfad,
  artikelName,
  besucherAufraeumen,
  entsperrtMelden,
  geraetUndBrowser,
  handleBesucher,
  istBot,
  katalogCacheLeeren,
  quelleAus,
  herkunftAus,
  auswertungBerechnen,
  sitzungenBilden,
  besucherName,
  besucherTier,
  browserSpracheAus,
  kampagneAus,
  systemAus,
} from "./besucher.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHOP = "https://disorder119.com";
const ADMIN = "https://admin.disorder119.com";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const T0 = Date.parse("2026-09-27T10:00:00Z");

function d1() {
  const raw = new DatabaseSync(":memory:");
  const files = [
    path.join(HERE, "schema.sql"),
    ...fs.readdirSync(path.join(HERE, "migrations")).filter(f => /^\d{4}_.*\.sql$/.test(f)).sort()
      .map(f => path.join(HERE, "migrations", f)),
  ];
  for (const file of files) raw.exec(fs.readFileSync(file, "utf8"));
  const arg = v => (v === undefined ? null : typeof v === "boolean" ? Number(v) : v);
  const statement = (sql, args = []) => ({
    bind: (...next) => statement(sql, next.map(arg)),
    first: async () => { const row = raw.prepare(sql).get(...args); return row ? { ...row } : null; },
    all: async () => ({ results: raw.prepare(sql).all(...args).map(row => ({ ...row })) }),
    run: async () => {
      const r = raw.prepare(sql).run(...args);
      return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
    },
  });
  return { raw, prepare: sql => statement(sql) };
}

// Fangt Telegram und den oeffentlichen Katalog ab.
function netz() {
  const telegram = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input?.url || input);
    if (url.startsWith("https://api.telegram.org/")) {
      telegram.push(JSON.parse(init.body).text);
      return new Response(JSON.stringify({ ok: true, result: { message_id: telegram.length } }), { status: 200 });
    }
    if (url === `${SHOP}/data/catalog.json`) {
      return new Response(JSON.stringify([
        { id: 6042, article: "42", url_slug: "42", brand: "Prada", title: "Nylonjacke", price: 120 },
        { id: 6184, article: "84", url_slug: "84", brand: "Stone Island", title: "Overshirt", price: 90 },
      ]), { status: 200 });
    }
    throw new Error(`unerwarteter fetch: ${url}`);
  };
  katalogCacheLeeren();
  return { telegram, zurueck: () => { globalThis.fetch = original; } };
}

function envMit(db, extra = {}) {
  return { DB: db, TELEGRAM_BOT_TOKEN: "test-token", TELEGRAM_CHAT_ID: "42", ...extra };
}

function besuch(body, { origin = SHOP, ua = IPHONE, ip = "203.0.113.7", cf = { city: "Aschaffenburg", region: "Bavaria", country: "DE" } } = {}) {
  const headers = { "Content-Type": "text/plain;charset=UTF-8", "User-Agent": ua, "CF-Connecting-IP": ip };
  if (origin) headers.Origin = origin;
  const req = new Request("https://api.disorder119.com/besuch", { method: "POST", headers, body: JSON.stringify({consentVersion:1, ...body}) });
  Object.defineProperty(req, "cf", { value: cf });
  return req;
}

const senden = (env, body, opts, now = T0) =>
  handleBesucher(besuch(body, opts), env, new URL("https://api.disorder119.com/besuch"), "req", null, now);

test("Artikelname ohne doppelte Marke", () => {
  assert.equal(artikelName({ brand: "Prada", title: "Nylonjacke" }), "Prada – Nylonjacke");
  assert.equal(artikelName({ brand: "Prada", title: "Prada Walking-Sneaker Herren" }), "Prada Walking-Sneaker Herren");
  assert.equal(artikelName({ brand: "", title: "Vintage Hemd" }), "Vintage Hemd");
  assert.equal(artikelName({ brand: "Dior" }), "Dior");
});

test("Einordnung von Geraet, Browser, Bots und Herkunft", () => {
  assert.deepEqual(geraetUndBrowser(IPHONE), { geraet: "iPhone", browser: "Safari", system: "iOS 18" });
  assert.equal(geraetUndBrowser("Mozilla/5.0 (Linux; Android 14) Mobile Instagram 300").browser, "Instagram-App");
  assert.equal(geraetUndBrowser("Mozilla/5.0 (Windows NT 10.0) Chrome/130.0 Safari/537.36 Edg/130.0").browser, "Edge");
  assert.equal(istBot("Googlebot/2.1"), true);
  assert.equal(istBot("WhatsApp/2.23"), true);
  assert.equal(istBot(""), true);
  assert.equal(istBot(IPHONE), false);
  assert.equal(quelleAus("https://l.instagram.com/?u=x"), "instagram.com");
  assert.equal(quelleAus("https://www.disorder119.com/artikel/1/"), null);
  assert.equal(quelleAus("javascript:alert(1)"), null);
});

test("Besuch wird ohne IP gespeichert und Telegram meldet neuen Besucher, Warenkorb und Anfrage", async () => {
  const db = d1();
  const n = netz();
  try {
    const env = envMit(db);
    let res = await senden(env, { t: "seite", p: "/", r: "https://l.instagram.com/", l: "de" });
    assert.equal(res.status, 204);
    assert.equal(res.headers.get("Access-Control-Allow-Origin"), SHOP);
    res = await senden(env, { t: "artikel", p: "/artikel/6042/", a: 6042 }, undefined, T0 + 60_000);
    assert.equal(res.status, 204);
    res = await senden(env, { t: "warenkorb_rein", a: "6042", n: 1 }, undefined, T0 + 120_000);
    await senden(env, { t: "warenkorb_rein", a: "6184", n: 2 }, undefined, T0 + 130_000);
    await senden(env, { t: "anfrage", k: "whatsapp", n: 2 }, undefined, T0 + 180_000);

    const rows = db.raw.prepare("SELECT * FROM besucher_ereignisse ORDER BY id").all();
    assert.equal(rows.length, 5);
    assert.equal(new Set(rows.map(r => r.besucher)).size, 1, "ein Besucher ueber die ganze Sitzung");
    const alles = JSON.stringify(rows);
    assert.ok(!alles.includes("203.0.113.7"), "keine IP in der Datenbank");
    assert.equal(rows[0].quelle, "instagram.com");
    assert.equal(rows[0].stadt, "Aschaffenburg");
    assert.equal(rows[1].titel, "Prada – Nylonjacke");
    assert.deepEqual(rows.map(r => r.gemeldet), [0, 0, 0, 0, 0]);
    assert.equal(rows[0].system, "iOS 18");

    // Waehrend des Besuchs: nichts an Telegram.
    assert.equal(n.telegram.length, 0);
    assert.equal((await sitzungenMelden(env, T0 + 180_000 + 9 * 60_000)).gesendet, 0, "noch nicht vorbei");
    // Zehn Minuten nach der letzten Aktivitaet: genau eine Zusammenfassung.
    assert.equal((await sitzungenMelden(env, T0 + 180_000 + 10 * 60_000)).gesendet, 1);
    assert.equal((await sitzungenMelden(env, T0 + 180_000 + 20 * 60_000)).gesendet, 0, "nie doppelt");
    assert.equal(n.telegram.length, 1);
    const text = n.telegram[0];
    assert.match(text, /^👋 BESUCH VORBEI · iPhone · Aschaffenburg \(\S+\)/);
    assert.match(text, /📍 Aschaffenburg, Bavaria, Deutschland/);
    assert.match(text, /📱 iPhone · iOS 18 · Safari/);
    assert.match(text, /↪️ Instagram/);
    assert.match(text, /1\. Startseite/);
    assert.match(text, /2\. #42 Prada – Nylonjacke \(120 €\)/);
    assert.match(text, /🛒 \+ #42 Prada – Nylonjacke/);
    assert.match(text, /💬 Anfrage per WhatsApp geöffnet \(2 im Warenkorb\)/);
    assert.match(text, /🧾 Am Ende im Warenkorb \(2\):\n• #42 Prada – Nylonjacke \(120 €\)\n• #84 Stone Island – Overshirt \(90 €\)/);
    assert.match(text, /Statistik erlaubt/);
    assert.match(text, /Keine Aktivität mehr/);
    assert.ok(!text.includes("203.0.113.7"), "keine IP in Telegram");
    assert.ok(!/604[2]|618[4]/.test(text), "Artikelnummer statt Katalog-ID");

    // Anderer Besucher = anderer Schluessel, eigene Zusammenfassung.
    await senden(env, { t: "seite", p: "/" }, { ip: "198.51.100.9" }, T0 + 200_000);
    assert.equal(db.raw.prepare("SELECT COUNT(DISTINCT besucher) AS n FROM besucher_ereignisse").get().n, 2);
    await sitzungenMelden(env, T0 + 200_000 + 11 * 60_000);
    assert.equal(n.telegram.length, 2);
    // Derselbe Besucher kommt am selben Tag wieder: neuer Besuch, als zweiter erkannt.
    await senden(env, { t: "seite", p: "/" }, undefined, T0 + 180_000 + 31 * 60_000);
    await sitzungenMelden(env, T0 + 180_000 + 45 * 60_000);
    assert.equal(n.telegram.length, 3);
    assert.match(n.telegram[2], /Heute schon der 2\. Besuch/);
  } finally {
    n.zurueck();
  }
});

test("Fremde Herkunft, Bots, Unsinn und abgeschaltetes Tracking", async () => {
  const db = d1();
  const n = netz();
  try {
    const env = envMit(db);
    assert.equal((await senden(env, { t: "seite" }, { origin: null })).status, 403);
    assert.equal((await senden(env, { t: "seite" }, { origin: "https://evil.example" })).status, 403);
    assert.equal((await senden(env, { t: "seite" }, { ua: "Googlebot/2.1" })).status, 204);
    assert.equal((await senden(env, { t: "hack" })).status, 400);
    assert.equal((await senden(env, { t: "artikel", a: "1 OR 1=1" })).status, 400);
    assert.equal((await senden(envMit(db, { BESUCHER_TRACKING: "aus" }), { t: "seite" })).status, 204);
    assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM besucher_ereignisse").get().n, 0);
    assert.equal(n.telegram.length, 0);

    const gross = await senden(env, { t: "seite", p: "/" + "x".repeat(3000) });
    assert.equal(gross.status, 413);

    const gebremst = envMit(db, { RATE_LIMITER: { limit: async () => ({ success: false }) } });
    assert.equal((await senden(gebremst, { t: "seite" })).status, 429);
  } finally {
    n.zurueck();
  }
});

test("Telegram-Deckel und Modus", async () => {
  const db = d1();
  const n = netz();
  try {
    const env = envMit(db, { BESUCHER_TELEGRAM_PRO_STUNDE: "1" });
    await senden(env, { t: "seite" }, { ip: "192.0.2.1" });
    await senden(env, { t: "seite" }, { ip: "192.0.2.2" }, T0 + 1000);
    assert.deepEqual(await sitzungenMelden(env, T0 + 20 * 60_000), { gesendet: 1, uebersprungen: 1 });
    assert.equal(n.telegram.length, 1);
    assert.deepEqual(db.raw.prepare("SELECT gemeldet, meldung_grund FROM besucher_sitzungen ORDER BY id").all().map(r => [r.gemeldet, r.meldung_grund]), [[1, null], [2, "deckel"]]);

    const ausDb = d1();
    const aus = envMit(ausDb, { BESUCHER_TELEGRAM: "aus" });
    await senden(aus, { t: "warenkorb_rein", a: 6042, n: 1 });
    await sitzungenMelden(aus, T0 + 20 * 60_000);
    assert.equal(n.telegram.length, 1);
    assert.equal(ausDb.raw.prepare("SELECT meldung_grund FROM besucher_sitzungen").get().meldung_grund, "aus");

    // Fruehere Einstellung "alles" gilt jetzt als Zusammenfassung: eine Nachricht je Besuch.
    const alles = envMit(d1(), { BESUCHER_TELEGRAM: "alles" });
    await senden(alles, { t: "seite" });
    await senden(alles, { t: "artikel", a: 6184 }, undefined, T0 + 5000);
    assert.equal(n.telegram.length, 1);
    await sitzungenMelden(alles, T0 + 20 * 60_000);
    assert.equal(n.telegram.length, 2);
    assert.match(n.telegram.at(-1), /#84 Stone Island – Overshirt/);
  } finally {
    n.zurueck();
  }
});

test("Admin sieht Live-Besucher und Statistik, ohne Anmeldung nicht", async () => {
  const db = d1();
  const n = netz();
  try {
    const env = envMit(db);
    await senden(env, { t: "seite", p: "/" });
    await senden(env, { t: "artikel", a: 6042 }, undefined, T0 + 10_000);
    await senden(env, { t: "warenkorb_rein", a: 6042, n: 1 }, undefined, T0 + 20_000);

    const adminReq = pfad => new Request(`https://api.disorder119.com${pfad}`, { headers: { Origin: ADMIN } });
    const ohne = await handleBesucher(adminReq("/admin/besucher/live"), env, new URL("https://api.disorder119.com/admin/besucher/live"), "r", null, T0 + 30_000);
    assert.equal(ohne.status, 401);

    const angemeldet = { ...env, ADMIN_AUTH_CONTEXT: { role: "READER" } };
    const liveRes = await handleBesucher(adminReq("/admin/besucher/live"), angemeldet, new URL("https://api.disorder119.com/admin/besucher/live?minuten=30"), "r", null, T0 + 30_000);
    assert.equal(liveRes.status, 200);
    assert.equal(liveRes.headers.get("Access-Control-Allow-Origin"), ADMIN);
    const live = await liveRes.json();
    assert.equal(live.jetztAktiv, 1);
    assert.equal(live.besucher[0].ort.stadt, "Aschaffenburg");
    assert.equal(live.besucher[0].warenkorb, 1);
    assert.deepEqual(live.besucher[0].ereignisse.map(e => e.typ), ["seite", "artikel", "warenkorb_rein"]);
    assert.match(live.besucher[0].besucher, /^iPhone · Aschaffenburg \(\S+\)$/);
    assert.equal(live.besucher[0].name, "iPhone · Aschaffenburg");
    assert.equal(live.besucher[0].system, "iOS 18");

    const statRes = await handleBesucher(adminReq("/admin/besucher/statistik"), angemeldet, new URL("https://api.disorder119.com/admin/besucher/statistik?tage=7"), "r", null, T0 + 30_000);
    const stat = await statRes.json();
    assert.equal(stat.besuche, 1);
    assert.equal(stat.warenkorb, 1);
    assert.equal(stat.topArtikel[0].artikelId, "6042");
    assert.equal(stat.topArtikel[0].aufrufe, 1);

    // Ueber das echte Gateway ohne Admin-Anmeldung: abgelehnt.
    const gateway = await workerEntry.fetch(adminReq("/admin/besucher/live"), { DB: db }, { waitUntil() {} });
    assert.ok([401, 403, 503].includes(gateway.status), `Gateway-Status ${gateway.status}`);
  } finally {
    n.zurueck();
  }
});

test("Erster Besuch eines neuen Tages raeumt ohne Cron auf", async () => {
  const db = d1();
  const n = netz();
  try {
    const env = envMit(db, { BESUCHER_TELEGRAM: "aus" });
    await senden(env, { t: "seite" }, undefined, T0 - 40 * 24 * 60 * 60 * 1000);
    await senden(env, { t: "seite" }, undefined, T0 - 24 * 60 * 60 * 1000);
    await senden(env, { t: "seite" }, undefined, T0);
    assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM besucher_ereignisse").get().n, 2, "40 Tage alter Besuch geloescht");
    assert.deepEqual(db.raw.prepare("SELECT tag FROM besucher_salz").all().map(r => r.tag), ["2026-09-27"]);
  } finally {
    n.zurueck();
  }
});

test("Cron loescht alte Besuche und altes Salz", async () => {
  const db = d1();
  const n = netz();
  try {
    const env = envMit(db, { BESUCHER_TELEGRAM: "aus" });
    await senden(env, { t: "seite" }, undefined, T0);
    db.raw.prepare("INSERT INTO besucher_ereignisse (besucher, zeit, typ) VALUES ('alt', '2026-08-01T00:00:00.000Z', 'seite')").run();
    db.raw.prepare("INSERT INTO besucher_salz (tag, salz) VALUES ('2026-09-26', 'x')").run();
    const ergebnis = await besucherAufraeumen(env, T0);
    assert.equal(ergebnis.geloescht, 1);
    assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM besucher_ereignisse").get().n, 1);
    assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM besucher_salz").get().n, 1);
  } finally {
    n.zurueck();
  }
});

test("Auswertung: Sitzungen, Verweildauer, Absprung und Top-Artikel", async () => {
  const db = d1();
  const n = netz();
  try {
    const env = envMit(db);
    const min = 60_000;
    // Besucher A: Startseite -> Artikel -> Warenkorb -> verlaesst die Seite
    await senden(env, { t: "seite", p: "/", r: "https://l.instagram.com/" }, undefined, T0);
    await senden(env, { t: "artikel", p: "/artikel/6042/", a: 6042 }, undefined, T0 + 1 * min);
    await senden(env, { t: "warenkorb_rein", p: "/artikel/6042/", a: 6042, n: 1 }, undefined, T0 + 3 * min);
    await senden(env, { t: "verlassen", p: "/artikel/6042/" }, undefined, T0 + 5 * min);
    // Besucher B: nur Startseite (Absprung)
    await senden(env, { t: "seite", p: "/" }, { ip: "198.51.100.20" }, T0 + 10 * min);
    // Besucher A kommt nach ueber 30 Minuten wieder: neuer Besuch
    await senden(env, { t: "artikel", p: "/artikel/6184/", a: 6184 }, undefined, T0 + 60 * min);
    await senden(env, { t: "anfrage", p: "/cart/", k: "whatsapp", n: 1 }, undefined, T0 + 62 * min);

    assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM besucher_verlassen").get().n, 1);
    assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM besucher_ereignisse").get().n, 6, "verlassen landet nicht bei den Ereignissen");
    const telegramVorher = n.telegram.length;

    const req = new Request("https://api.disorder119.com/admin/besucher/auswertung", { headers: { Origin: ADMIN } });
    const res = await handleBesucher(req, { ...env, ADMIN_AUTH_CONTEXT: { role: "READER" } },
      new URL("https://api.disorder119.com/admin/besucher/auswertung?tage=7"), "r", null, T0 + 63 * min);
    assert.equal(res.status, 200);
    const a = await res.json();
    assert.equal(n.telegram.length, telegramVorher, "Auswertung schickt nichts an Telegram");
    assert.equal(a.verweildauerAktiv, true);
    assert.equal(a.sitzungen.length, 3);
    const [zweiterBesuch, besucherB, ersterBesuch] = a.sitzungen;
    assert.equal(ersterBesuch.dauerMs, 5 * min);
    assert.equal(ersterBesuch.quelle, "instagram.com");
    assert.equal(ersterBesuch.einstieg, "/");
    assert.equal(ersterBesuch.seiten, 2);
    assert.equal(ersterBesuch.artikel, 1);
    assert.equal(ersterBesuch.warenkorb, 1);
    assert.deepEqual(ersterBesuch.schritte.map(x => x.dauerMs), [1 * min, 2 * min, 2 * min]);
    assert.equal(ersterBesuch.schritte[1].titel, "Prada – Nylonjacke");
    assert.equal(ersterBesuch.besucher, zweiterBesuch.besucher, "gleicher Besucher, zwei Besuche");
    assert.equal(zweiterBesuch.anfrage, true);
    assert.equal(zweiterBesuch.einstieg, "Artikel 6184");
    assert.equal(besucherB.dauerBekannt, false);

    const k = a.kennzahlen;
    assert.equal(k.besuche, 3);
    assert.equal(k.absprungQuote, 33.3);
    assert.equal(k.warenkorbQuote, 33.3);
    assert.equal(k.anfrageQuote, 33.3);
    assert.equal(k.seitenProBesuch, 1.3);
    assert.equal(k.dauerMedianMs, 3.5 * min, "Median aus 5 und 2 Minuten; Besuch ohne Dauer zaehlt nicht");
    assert.equal(a.topArtikel[0].artikelId, "6042");
    assert.equal(a.topArtikel[0].dauerSchnittMs, 2 * min);
    assert.equal(a.proTag.length, 7);
    assert.equal(a.proTag.at(-1).besuche, 3);
    assert.equal(a.proStunde.reduce((x, y) => x + y, 0), 3);
    assert.equal(a.proStunde[12], 2, "10:00 UTC = 12 Uhr in Berlin");
    assert.equal(a.quellen[0].name, "direkt");
    assert.ok(!JSON.stringify(a).includes("203.0.113.7"), "keine IP in der Auswertung");
  } finally {
    n.zurueck();
  }
});

test("Verlassen-Meldung: nur von der Shop-Seite, ohne Telegram", async () => {
  const db = d1();
  const n = netz();
  try {
    const env = envMit(db);
    assert.equal((await senden(env, { t: "verlassen", p: "/" }, { origin: "https://evil.example" })).status, 403);
    assert.equal((await senden(env, { t: "verlassen", p: "/" })).status, 204);
    assert.equal(n.telegram.length, 0);
    // Ohne Migration 0020 bleibt der Shop still statt Fehler zu werfen.
    db.raw.exec("DROP TABLE besucher_verlassen");
    assert.equal((await senden(env, { t: "verlassen", p: "/" }, undefined, T0 + 1000)).status, 204);
  } finally {
    n.zurueck();
  }
});

test("old clients without consent create no visitor identifier, events or notifications",async()=>{
  const db=d1(),n=netz();
  try {
    const response=await senden(envMit(db),{t:'seite',p:'/',consentVersion:undefined});
    assert.equal(response.status,204);
    assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM besucher_salz').get().n,0);
    assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM besucher_ereignisse').get().n,0);
    assert.equal(n.telegram.length,0);
  } finally {n.zurueck();}
});

// ---------------------------------------------------------------- Seitenaufrufe vom Storefront-Worker

function seitenaufruf(body, host = "storefront.intern", method = "POST") {
  const init = { method, headers: { "Content-Type": "application/json" } };
  if (method === "POST") init.body = typeof body === "string" ? body : JSON.stringify(body);
  return new Request(`https://${host}/intern/seitenaufruf`, init);
}
const zaehlen = (env, body, now = T0, host = "storefront.intern", method = "POST") =>
  handleBesucher(seitenaufruf(body, host, method), env, new URL(`https://${host}/intern/seitenaufruf`), "req", null, now);
const aufrufVon = (p, extra = {}) => ({ p, r: "", ua: IPHONE, ip: "203.0.113.7", land: "DE", ...extra });

test("Seitenaufruf vom Server: ohne Einwilligung, ohne Stadt und IP, Telegram mit Sperrhinweis", async () => {
  const db = d1();
  const n = netz();
  try {
    const env = envMit(db);
    db.raw.prepare("INSERT INTO site_settings (key, value, updated_at) VALUES ('site_lock', ?, ?)")
      .run(JSON.stringify({ locked: true, version: 3 }), new Date(T0).toISOString());
    let res = await zaehlen(env, aufrufVon("/", { r: "https://l.instagram.com/" }));
    assert.equal(res.status, 204);
    res = await zaehlen(env, aufrufVon("/en/artikel/6042/"), T0 + 60_000);
    assert.equal(res.status, 204);

    const rows = db.raw.prepare("SELECT * FROM besucher_ereignisse ORDER BY id").all();
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map(r => [r.typ, r.pfad, r.artikel_id, r.sprache, r.server]),
      [["seite", "/", null, "de", 1], ["artikel", "/en/artikel/6042/", "6042", "en", 1]]);
    assert.equal(rows[0].quelle, "instagram.com");
    assert.equal(rows[0].land, "DE");
    assert.equal(rows[0].stadt, null);
    assert.equal(rows[0].region, null);
    assert.equal(rows[1].titel, "Prada – Nylonjacke");
    assert.ok(!JSON.stringify(rows).includes("203.0.113.7"), "keine IP in der Datenbank");

    assert.equal(n.telegram.length, 0, "waehrend des Besuchs keine Nachricht");
    await sitzungenMelden(env, T0 + 60_000 + 10 * 60_000);
    assert.equal(n.telegram.length, 1, "eine Zusammenfassung nach dem Besuch");
    assert.match(n.telegram[0], /BESUCH VORBEI · iPhone · Deutschland \(\S+\)/);
    assert.match(n.telegram[0], /📍 Deutschland\n/);
    assert.match(n.telegram[0], /iPhone · iOS 18 · Safari/);
    assert.match(n.telegram[0], /↪️ Instagram/);
    assert.match(n.telegram[0], /1\. Startseite \(Archiv\) · ≈ 1:00 Min\./);
    assert.match(n.telegram[0], /2\. #42 Prada – Nylonjacke \(120 €\)/);
    assert.match(n.telegram[0], /ohne Einwilligung keine Wiedererkennung an anderen Tagen/);
    assert.match(n.telegram[0], /Ohne Einwilligung: nur Seitenaufrufe/);
    assert.match(n.telegram[0], /Shop ist gesperrt/);
    assert.ok(!n.telegram[0].includes("203.0.113.7"), "keine IP in Telegram");
    assert.ok(!n.telegram[0].includes("Aschaffenburg"), "ohne Einwilligung keine Stadt");

    // Offener Shop: kein Sperrhinweis.
    db.raw.prepare("UPDATE site_settings SET value=? WHERE key='site_lock'").run(JSON.stringify({ locked: false, version: 4 }));
    await zaehlen(env, aufrufVon("/", { ip: "198.51.100.9" }), T0 + 120_000);
    await sitzungenMelden(env, T0 + 120_000 + 10 * 60_000);
    assert.equal(n.telegram.length, 2);
    assert.doesNotMatch(n.telegram[1], /gesperrt/);
  } finally {
    n.zurueck();
  }
});

test("Seitenaufruf: nur ueber die Dienstbindung, ohne Bots, Ratenlimit und abgeschaltetes Tracking", async () => {
  const db = d1();
  const n = netz();
  try {
    const env = envMit(db);
    assert.equal((await zaehlen(env, aufrufVon("/"), T0, "api.disorder119.com")).status, 404);
    assert.equal((await zaehlen(env, null, T0, "storefront.intern", "GET")).status, 405);
    assert.equal((await zaehlen(env, "{kaputt")).status, 400);
    assert.equal((await zaehlen(env, aufrufVon("/", { ua: "Googlebot/2.1" }))).status, 204);
    assert.equal((await zaehlen(env, aufrufVon("/", { ip: "" }))).status, 204);
    assert.equal((await zaehlen(envMit(db, { BESUCHER_TRACKING: "aus" }), aufrufVon("/"))).status, 204);
    const gebremst = envMit(db, { RATE_LIMITER: { limit: async () => ({ success: false }) } });
    assert.equal((await zaehlen(gebremst, aufrufVon("/"))).status, 204);
    assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM besucher_ereignisse").get().n, 0);
    assert.equal(n.telegram.length, 0);
  } finally {
    n.zurueck();
  }
});

test("Mit Einwilligung: Startereignis zaehlt nicht doppelt, Stadt und Warenkorb kommen dazu", async () => {
  const db = d1();
  const n = netz();
  try {
    const env = envMit(db);
    await zaehlen(env, aufrufVon("/"));
    // Gleicher Browser (IP und Kennung wie in besuch()): Startereignis s=1.
    await senden(env, { t: "seite", p: "/", s: 1 }, undefined, T0 + 2_000);
    assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM besucher_ereignisse").get().n, 1, "Startereignis nicht doppelt");
    await senden(env, { t: "warenkorb_rein", a: "6042", n: 1 }, undefined, T0 + 60_000);
    await senden(env, { t: "seite", p: "/cart/" }, undefined, T0 + 70_000);
    const rows = db.raw.prepare("SELECT typ, server, stadt FROM besucher_ereignisse ORDER BY id").all();
    assert.deepEqual(rows.map(r => [r.typ, r.server]), [["seite", 1], ["warenkorb_rein", 0], ["seite", 0]]);
    assert.equal(n.telegram.length, 0, "keine Sofortmeldungen mehr");
    assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM besucher_sitzungen").get().n, 1, "Server- und Browser-Meldungen sind ein Besuch");

    const angemeldet = { ...env, ADMIN_AUTH_CONTEXT: { role: "READER" } };
    const adminReq = pfad => new Request(`https://api.disorder119.com${pfad}`, { headers: { Origin: ADMIN } });
    const live = await (await handleBesucher(adminReq("/admin/besucher/live"), angemeldet,
      new URL("https://api.disorder119.com/admin/besucher/live?minuten=30"), "r", null, T0 + 80_000)).json();
    assert.equal(live.besucher.length, 1);
    assert.equal(live.besucher[0].ort.stadt, "Aschaffenburg", "Stadt aus der Einwilligung ergaenzt");
    const auswertung = await (await handleBesucher(adminReq("/admin/besucher/auswertung"), angemeldet,
      new URL("https://api.disorder119.com/admin/besucher/auswertung?tage=7"), "r", null, T0 + 80_000)).json();
    assert.equal(auswertung.sitzungen.length, 1);
    assert.equal(auswertung.sitzungen[0].ort.stadt, "Aschaffenburg");

    // Spaeteres Startereignis auf einer Seite, die der Server nicht gezaehlt hat: zaehlt.
    await senden(env, { t: "artikel", p: "/artikel/6184/", a: 6184, s: 1 }, undefined, T0 + 90_000);
    assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM besucher_ereignisse").get().n, 4);
    await sitzungenMelden(env, T0 + 90_000 + 10 * 60_000);
    assert.equal(n.telegram.length, 1);
    assert.match(n.telegram[0], /BESUCH VORBEI · iPhone · Aschaffenburg/);
    assert.match(n.telegram[0], /Statistik erlaubt/);
  } finally {
    n.zurueck();
  }
});

test("Artikelnummer aus der Adresse und Meldung bei Passwort-Eingabe", async () => {
  assert.equal(artikelAusPfad("/artikel/6042/"), "6042");
  assert.equal(artikelAusPfad("/fr/artikel/6042/index.html"), "6042");
  assert.equal(artikelAusPfad("/artikel/6042.html"), "6042");
  assert.equal(artikelAusPfad("/artikel/"), null);
  assert.equal(artikelAusPfad("/kasse/"), null);

  const db = d1();
  const n = netz();
  try {
    const req = new Request("https://api.disorder119.com/site-unlock", { method: "POST", headers: { "User-Agent": IPHONE, "CF-Connecting-IP": "203.0.113.7" } });
    Object.defineProperty(req, "cf", { value: { country: "DE", city: "Aschaffenburg" } });
    // Seitenaufruf der Sperrseite, dann das Passwort: keine eigene Nachricht,
    // die Zusammenfassung des Besuchs nennt es.
    const env = envMit(db);
    await zaehlen(env, aufrufVon("/"), T0);
    await entsperrtMelden(req, env, T0 + 5_000);
    assert.equal(n.telegram.length, 0);
    assert.equal(db.raw.prepare("SELECT entsperrt FROM besucher_sitzungen").get().entsperrt, 1);
    await sitzungenMelden(env, T0 + 16 * 60_000);
    assert.equal(n.telegram.length, 1);
    assert.match(n.telegram[0], /🔓 Hat das Passwort für den gesperrten Shop eingegeben/);
    assert.match(n.telegram[0], /📍 Deutschland/);
    assert.ok(!n.telegram[0].includes("Aschaffenburg") && !n.telegram[0].includes("203.0.113.7"));
  } finally {
    n.zurueck();
  }
});


test("Herkunft gruppiert nur echte Verweis-Domains und erfindet keine Quelle", () => {
  for (const [domain, kanal] of [["l.instagram.com","instagram"],["www.google.de","google"],["google.co.uk","google"],["m.facebook.com","facebook"],["vm.tiktok.com","tiktok"],["www.ebay.de","ebay"],["example.org","andere"]]) {
    assert.equal(herkunftAus(domain).kanal, kanal);
    assert.equal(herkunftAus(domain).beleg, "verweis_domain");
  }
  for (const value of [null,"","direkt","disorder119.com","admin.disorder119.com","<script>","https://example.org/?email=private","example.org/private","a@b.example"]) {
    assert.equal(herkunftAus(value).kanal,"unbekannt");
    assert.equal(herkunftAus(value).domain,null);
  }
  for (const domain of ["instagram.com.evil.example","notinstagram.com","google.de.evil.example"]) assert.equal(herkunftAus(domain).kanal,"andere");
});

test("Quellenzahlen verwenden alle Sitzungen, nicht die gekuerzte Besuchsliste", () => {
  const sitzungen = Array.from({length:251}, (_,i) => ({start:new Date(T0).toISOString(), quelle:i<200?"instagram.com":null, ort:{}, geraet:"Computer", browser:"Chrome", einstieg:"/", seiten:1, warenkorb:i===0?2:0, anfrage:i===0, schritte:[], dauerBekannt:false}));
  const result = auswertungBerechnen(sitzungen,7,T0);
  assert.equal(result.herkunft.gesamt,251);
  assert.equal(result.herkunft.unbekannt,51);
  const instagram = result.herkunft.quellen.find(q=>q.kanal==="instagram");
  assert.deepEqual(instagram,{kanal:"instagram",name:"Instagram",besuche:200,mitWarenkorb:1,mitAnfrage:1,anteil:79.7});
  assert.equal(result.herkunft.quellen.reduce((n,q)=>n+q.besuche,0),result.kennzahlen.besuche);
  assert.deepEqual(auswertungBerechnen([],7,T0).herkunft,{gesamt:0,unbekannt:0,quellen:[]});
});

test("Ein Besuch behaelt den vorhandenen Verweis fuer spätere interne Schritte", () => {
  const result=sitzungenBilden([{besucher:"a".repeat(64),zeit:new Date(T0).toISOString(),typ:"seite",pfad:"/",quelle:"instagram.com",land:"DE"},{besucher:"a".repeat(64),zeit:new Date(T0+1000).toISOString(),typ:"seite",pfad:"/cart/",quelle:null,land:"DE"}]);
  assert.equal(result.length,1);assert.equal(result[0].herkunft.kanal,"instagram");
  assert.equal(result[0].herkunft.domain,"instagram.com");
  assert.equal(Object.hasOwn(result[0],"ip"),false);
});


test("Sichtzeit braucht Einwilligung, sendet keine Telegram-Alarme und bleibt kumulativ/idempotent",async()=>{
 const db=d1(),n=netz();try{
  const env=envMit(db);const v="a".repeat(24);
  const req=besuch({t:"sichtzeit",v,ms:1000,p:"/",consentVersion:0});
  assert.equal((await handleBesucher(req,env,new URL(req.url),"r",null,T0)).status,204);
  assert.equal(db.raw.prepare("SELECT COUNT(*) n FROM besucher_sichtzeit").get().n,0);
  assert.equal(db.raw.prepare("SELECT COUNT(*) n FROM besucher_salz").get().n,0);
  for(const [ms,offset] of [[0,0],[30000,30000],[30000,35000],[60000,60000],[45000,65000]])assert.equal((await senden(env,{t:"sichtzeit",v,ms,p:"/"},undefined,T0+offset)).status,204);
  const row=db.raw.prepare("SELECT * FROM besucher_sichtzeit").get();assert.equal(row.sicht_ms,60000);assert.equal(row.zaehler_ms,60000);assert.equal(row.zuletzt,new Date(T0+60000).toISOString());
  assert.equal(db.raw.prepare("SELECT COUNT(*) n FROM besucher_sichtzeit").get().n,1);
  assert.equal(n.telegram.length,0);assert.equal(Object.hasOwn(row,"ip"),false);
  assert.equal((await senden(env,{t:"sichtzeit",v,ms:70000,p:"/cart/"},undefined,T0+70000)).status,400);
 }finally{n.zurueck();}
});

test("Sichtzeit validiert IDs, Zeit und Pfade und begrenzt manipulierte Zeitangaben",async()=>{
 for(const body of [{v:"bad",ms:1},{v:"a".repeat(24),ms:-1},{v:"a".repeat(24),ms:86400001},{v:"a".repeat(24),ms:1.5},{v:"a".repeat(24),ms:1,p:"//evil.example"},{v:"a".repeat(24),ms:1,a:"<script>"}])assert.equal(sichtzeitBody(body),null);
 assert.deepEqual(sichtzeitBody({v:"a".repeat(24),ms:100,p:"/artikel/1/?private=x#secret",a:1}),{abschnitt:"a".repeat(24),ms:100,pfad:"/artikel/1/",artikelId:"1"});
 const db=d1(),n=netz();try{
  await senden(envMit(db),{t:"sichtzeit",v:"b".repeat(24),ms:86400000,p:"/"},undefined,T0);
  const row=db.raw.prepare("SELECT * FROM besucher_sichtzeit").get();assert.equal(row.sicht_ms,30000);assert.equal(row.begrenzt,1);
 }finally{n.zurueck();}
});

test("Vordergrundzeit trennt sichtbare Abschnitte von Hintergrund und alten Zeit-Schaetzungen",async()=>{
 const db=d1(),n=netz();try{
  const env=envMit(db);await senden(env,{t:"seite",p:"/"});
  for(const [v,ms,offset] of [["a",0,0],["a",30000,30000],["b",0,120000],["b",15000,135000]])await senden(env,{t:"sichtzeit",v:v.repeat(24),ms,p:"/"},undefined,T0+offset);
  const req=new Request("https://api.disorder119.com/admin/besucher/auswertung?tage=7&limit=1",{headers:{Origin:ADMIN}});
  const res=await handleBesucher(req,{...env,ADMIN_AUTH_CONTEXT:{role:"READER"}},new URL(req.url),"r",null,T0+140000);assert.equal(res.status,200);
  const d=await res.json();assert.equal(d.sichtzeitVerfuegbar,true);assert.equal(d.sitzungen[0].vordergrundMs,45000);assert.equal(d.sitzungen[0].dauerMs,135000);assert.equal(d.kennzahlen.vordergrundMedianMs,45000);
  assert.equal(d.sitzungen[0].datenUmfang,"browser_detail");assert.equal(d.sitzungen[0].schritte[0].vordergrundMs,45000);
  const old=sitzungenBilden([{besucher:"old",zeit:new Date(T0).toISOString(),typ:"seite",pfad:"/",server:1}]);assert.equal(old[0].vordergrundMs,null);assert.equal(old[0].datenUmfang,"server_seiten");
 }finally{n.zurueck();}
});

test("Sichtbare Tabs werden zeitlich vereinigt und lange sichtbare Lesebesuche nicht falsch getrennt",()=>{
 assert.equal(vereinigteZeit([{von:0,bis:30000,ms:30000},{von:15000,bis:45000,ms:30000}],0,45000),45000);
 const events=[{besucher:"x",zeit:new Date(T0).toISOString(),typ:"seite",pfad:"/",server:1},{besucher:"x",zeit:new Date(T0+75*60000).toISOString(),typ:"warenkorb_rein",pfad:"/",artikel_id:"1"}];
 const zeit=[{besucher:"x",beginn:new Date(T0).toISOString(),zuletzt:new Date(T0+75*60000).toISOString(),pfad:"/",sicht_ms:75*60000}];
 const sessions=sitzungenBilden(events,[],zeit);assert.equal(sessions.length,1);assert.equal(sessions[0].vordergrundMs,75*60000);
 assert.equal(sitzungenBilden(events).length,2);
});

test("Zeitabschnitte werden nach der vorhandenen Aufbewahrungsfrist entfernt",async()=>{
 const db=d1(),n=netz();try{
  const env=envMit(db);await senden(env,{t:"sichtzeit",v:"a".repeat(24),ms:0,p:"/"});
  await besucherAufraeumen(env,T0+31*86400000);assert.equal(db.raw.prepare("SELECT COUNT(*) n FROM besucher_sichtzeit").get().n,0);
 }finally{n.zurueck();}
});


test("Indizierte Zeitabfragen entsprechen der direkten Vereinigung auch bei Luecken, Kontexten und Nullzeit",()=>{
 const rows=[{von:0,bis:30000,ms:30000,pfad:"/",artikelId:null},{von:15000,bis:45000,ms:30000,pfad:"/",artikelId:null},{von:60000,bis:70000,ms:10000,pfad:"/",artikelId:"1"},{von:71000,bis:71000,ms:0,pfad:"/",artikelId:"2"}];const index=sichtzeitIndex(rows);
 for(let a=0;a<80000;a+=3711)for(let b=a;b<90000;b+=5417)for(const k of [undefined,{pfad:"/",artikelId:null},{pfad:"/",artikelId:"1"}])assert.equal(sichtzeitZwischen(index,a,b,k),vereinigteZeit(rows,a,b,k));
 assert.equal(sichtzeitZwischen(index,0,90000,{pfad:"/",artikelId:"2"}),0);assert.equal(sichtzeitZwischen(index,0,90000,{pfad:"/missing"}),null);
 const groups=zeitGruppen([...rows,{von:3600000,bis:3601000,ms:1000,pfad:"/"}]);assert.equal(groups.length,2);assert.equal(verbundeneZeiten(groups,1800000).bis,3601000);assert.equal(verbundeneZeiten(groups,71001).intervalle.length,0);
});

// ---------------------------------------------------------------- Zusammenfassung nach dem Besuch (0040)

const MIN = 60_000;
const v2 = body => ({ ...body, consentVersion: 2 });

test("Abschied per Beacon: Zusammenfassung schon nach drei Minuten, Seitenwechsel im Shop zaehlt nicht als Abschied", async () => {
  const db = d1();
  const n = netz();
  try {
    const env = envMit(db);
    await senden(env, v2({ t: "seite", p: "/", s: 1, wn: 1, we: "2026-09-27" }), undefined, T0);
    // Klick auf eine Produktseite: verlassen mit w=1 -> kein Abschied.
    await senden(env, v2({ t: "verlassen", p: "/", w: 1 }), undefined, T0 + 20_000);
    let lauf = db.raw.prepare("SELECT * FROM besucher_sitzungen").get();
    assert.equal(lauf.abschied, null);
    assert.equal(lauf.faellig, new Date(T0 + 10 * MIN).toISOString());
    await senden(env, v2({ t: "artikel", p: "/artikel/42/", a: 6042 }), undefined, T0 + 21_000);
    // Tab geschlossen / App gewechselt.
    await senden(env, v2({ t: "verlassen", p: "/artikel/42/" }), undefined, T0 + 80_000);
    lauf = db.raw.prepare("SELECT * FROM besucher_sitzungen").get();
    assert.equal(lauf.abschied, new Date(T0 + 80_000).toISOString());
    assert.equal(lauf.faellig, new Date(T0 + 80_000 + 3 * MIN).toISOString());
    assert.equal((await sitzungenMelden(env, T0 + 80_000 + 2 * MIN)).gesendet, 0);
    assert.equal((await sitzungenMelden(env, T0 + 80_000 + 3 * MIN)).gesendet, 1);
    assert.match(n.telegram[0], /🚪 Seite geschlossen bzw\. App gewechselt/);
    assert.match(n.telegram[0], /🆕 Erster Besuch \(laut Browser-Speicher\)/);
  } finally {
    n.zurueck();
  }
});

test("Kurz in eine andere App und zurueck: derselbe Besuch, eine Nachricht", async () => {
  const db = d1();
  const n = netz();
  try {
    const env = envMit(db);
    await senden(env, v2({ t: "seite", p: "/" }), undefined, T0);
    await senden(env, v2({ t: "verlassen", p: "/" }), undefined, T0 + MIN);
    // Nach zwei Minuten wieder sichtbar: Sichtzeit-Meldung haelt den Besuch offen.
    await senden(env, v2({ t: "sichtzeit", v: "c".repeat(24), ms: 0, p: "/" }), undefined, T0 + 3 * MIN);
    assert.equal((await sitzungenMelden(env, T0 + 4 * MIN + 1000)).gesendet, 0, "Abschied durch Rueckkehr aufgehoben");
    await senden(env, v2({ t: "warenkorb_rein", a: "6184", n: 1 }), undefined, T0 + 5 * MIN);
    await sitzungenMelden(env, T0 + 16 * MIN);
    assert.equal(n.telegram.length, 1);
    assert.equal(db.raw.prepare("SELECT COUNT(*) n FROM besucher_sitzungen").get().n, 1);
    assert.match(n.telegram[0], /⏱ Keine Aktivität mehr/);
  } finally {
    n.zurueck();
  }
});

test("Wiederkehr mit Einwilligung: Besuchszahl und Daten aus dem Browser, ohne Kennung", async () => {
  const db = d1();
  const n = netz();
  try {
    const env = envMit(db);
    await senden(env, v2({ t: "seite", p: "/", s: 1, wn: 3, we: "2026-09-01", wv: "2026-09-20" }), undefined, T0);
    // Version 1 (altes Skript) und Unsinn werden fuer die Besuchszahl ignoriert.
    await senden(env, { t: "seite", p: "/cart/", wn: 99, consentVersion: 1 }, { ip: "192.0.2.80" }, T0);
    await senden(env, v2({ t: "seite", p: "/", wn: "x<script>", we: "gestern" }), { ip: "192.0.2.81" }, T0);
    const zeilen = db.raw.prepare("SELECT besuch_nr, erster_besuch, vorher_besuch, einwilligung FROM besucher_sitzungen ORDER BY id").all();
    assert.deepEqual(zeilen.map(z => [z.besuch_nr, z.erster_besuch, z.vorher_besuch, z.einwilligung]),
      [[3, "2026-09-01", "2026-09-20", 1], [null, null, null, 1], [null, null, null, 1]]);
    await sitzungenMelden(env, T0 + 11 * MIN);
    const text = n.telegram.find(t => /3\. Besuch/.test(t));
    assert.match(text, /🔁 3\. Besuch · zuerst am 01\.09\.2026 · davor zuletzt am 20\.09\.2026/);
  } finally {
    n.zurueck();
  }
});

test("Jeder faellige Besuch wird genau einmal gemeldet, auch bei gleichzeitigen Laeufen; Fehler werden wiederholt", async () => {
  const db = d1();
  let versuche = 0, kaputt = 2;
  const telegram = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input?.url || input);
    if (url.startsWith("https://api.telegram.org/")) {
      versuche++;
      if (kaputt-- > 0) return new Response(JSON.stringify({ ok: false, description: "Bad Gateway" }), { status: 502 });
      telegram.push(JSON.parse(init.body).text);
      return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200 });
    }
    if (url === `${SHOP}/data/catalog.json`) return new Response("[]", { status: 200 });
    throw new Error(url);
  };
  katalogCacheLeeren();
  try {
    const env = envMit(db);
    await senden(env, { t: "seite", p: "/" }, undefined, T0);
    // Zwei Fehlversuche, jeweils 5 Minuten spaeter erneut.
    await sitzungenMelden(env, T0 + 11 * MIN);
    assert.equal(db.raw.prepare("SELECT gemeldet, versuche FROM besucher_sitzungen").get().versuche, 1);
    await sitzungenMelden(env, T0 + 16 * MIN);
    // Dritter Versuch klappt - drei Laeufe gleichzeitig senden trotzdem nur einmal.
    await Promise.all([sitzungenMelden(env, T0 + 21 * MIN), sitzungenMelden(env, T0 + 21 * MIN), sitzungenMelden(env, T0 + 21 * MIN)]);
    assert.equal(telegram.length, 1);
    assert.equal(versuche, 3);
    assert.equal(db.raw.prepare("SELECT gemeldet FROM besucher_sitzungen").get().gemeldet, 1);
  } finally {
    globalThis.fetch = original;
  }
});

test("Wecker: neuer Besuch und Abschied stellen den Durable-Object-Alarm, der Alarm meldet und stellt sich neu", async () => {
  const db = d1();
  const n = netz();
  try {
    const gestellt = [];
    const ns = { idFromName: name => name, get: () => ({ fetch: async url => { gestellt.push(Number(new URL(url).searchParams.get("t"))); return new Response(null, { status: 204 }); } }) };
    const env = envMit(db, { BESUCHER_WECKER: ns });
    await senden(env, v2({ t: "seite", p: "/" }), undefined, T0);
    assert.deepEqual(gestellt, [T0 + 10 * MIN]);
    await senden(env, v2({ t: "artikel", a: 6042 }), undefined, T0 + MIN);
    assert.equal(gestellt.length, 1, "Verlaengern braucht keinen neuen Alarm");
    await senden(env, v2({ t: "verlassen", p: "/" }), undefined, T0 + 2 * MIN);
    assert.deepEqual(gestellt, [T0 + 10 * MIN, T0 + 5 * MIN]);

    // Der Durable Object selbst: Alarm frueher stellen, nie spaeter.
    let alarm = null;
    const state = { storage: { getAlarm: async () => alarm, setAlarm: async t => { alarm = t; } } };
    const wecker = new BesucherWecker(state, env);
    const stellen = t => wecker.fetch(new Request(`https://wecker.intern/stellen?t=${t}`, { method: "POST" }));
    const jetzt = Date.now();
    assert.equal((await stellen(jetzt + 600_000)).status, 204);
    await stellen(jetzt + 900_000);
    assert.equal(alarm, jetzt + 600_000);
    await stellen(jetzt + 300_000);
    assert.equal(alarm, jetzt + 300_000);
    assert.equal((await wecker.fetch(new Request("https://wecker.intern/x", { method: "POST" }))).status, 400);
    // Alarm: meldet alles Faellige (hier: der Besuch von T0 liegt in der Vergangenheit).
    alarm = null;
    await wecker.alarm();
    assert.equal(n.telegram.length, 1);
    assert.equal(alarm, null, "nichts mehr offen, kein neuer Alarm");
    // Ohne Bindung: kein Fehler.
    assert.equal(await weckerStellen({}, null, Date.now()), false);
  } finally {
    n.zurueck();
  }
});

test("Ohne Migration 0040 zaehlt der Shop weiter, nur ohne Zusammenfassung", async () => {
  const db = d1();
  const n = netz();
  try {
    db.raw.exec("DROP TABLE besucher_sitzungen");
    const env = envMit(db);
    assert.equal((await senden(env, { t: "seite", p: "/" })).status, 204);
    assert.equal((await zaehlen(env, aufrufVon("/artikel/42/"), T0 + 1000)).status, 204);
    assert.equal(db.raw.prepare("SELECT COUNT(*) n FROM besucher_ereignisse").get().n, 2);
    assert.deepEqual(await sitzungenMelden(env, T0 + 60 * MIN), { gesendet: 0, uebersprungen: 0 });
    assert.equal(await sitzungBeruehren(env, null, { besucher: "x" }, T0), null);
  } finally {
    n.zurueck();
  }
});

test("Produktseiten nach Artikelnummer landen beim selben Artikel wie das Overlay", async () => {
  const db = d1();
  const n = netz();
  try {
    const env = envMit(db);
    await zaehlen(env, aufrufVon("/artikel/42/", { sl: "en-GB", us: "Instagram", uc: "herbst-drop" }));
    const row = db.raw.prepare("SELECT artikel_id, titel, browser_sprache, kampagne, system FROM besucher_ereignisse").get();
    assert.deepEqual({ ...row }, { artikel_id: "6042", titel: "Prada – Nylonjacke", browser_sprache: "en", kampagne: "instagram/herbst-drop", system: "iOS 18" });
    await sitzungenMelden(env, T0 + 11 * MIN);
    assert.match(n.telegram[0], /🗣 Seite Deutsch · Browser Englisch/);
    assert.match(n.telegram[0], /Kampagne instagram\/herbst-drop/);
  } finally {
    n.zurueck();
  }
});

test("Auswertung fuer die Admin-App: lesbare Namen, Laender fuer die Weltkarte, Meldestatus und Geo-Sperre", async () => {
  const db = d1();
  const n = netz();
  try {
    const env = envMit(db);
    await senden(env, v2({ t: "seite", p: "/", s: 1, wn: 2, we: "2026-09-01", wv: "2026-09-10" }), undefined, T0);
    await zaehlen(env, aufrufVon("/", { ip: "192.0.2.90", land: "AT" }), T0 + 1000);
    await zaehlen(env, aufrufVon("/", { ip: "192.0.2.91", land: "AT" }), T0 + 2000);
    await sitzungenMelden(env, T0 + 11 * MIN);
    const req = new Request("https://api.disorder119.com/admin/besucher/auswertung", { headers: { Origin: ADMIN } });
    const a = await (await handleBesucher(req, { ...env, ADMIN_AUTH_CONTEXT: { role: "READER" } },
      new URL("https://api.disorder119.com/admin/besucher/auswertung?tage=7"), "r", null, T0 + 12 * MIN)).json();
    assert.deepEqual(a.laender.map(l => [l.land, l.besuche]), [["AT", 2], ["DE", 1]]);
    assert.equal(a.laender[0].landName, "Österreich");
    const mit = a.sitzungen.find(s => s.einwilligung);
    assert.match(mit.besucher, /^iPhone · Aschaffenburg \(\S+\)$/);
    assert.equal(mit.name, "iPhone · Aschaffenburg");
    assert.deepEqual(mit.wiederkehr, { nr: 2, erster: "2026-09-01", vorher: "2026-09-10" });
    assert.equal(mit.meldung, "gesendet");
    assert.equal(mit.system, "iOS 18");
    const ohne = a.sitzungen.find(s => !s.einwilligung);
    assert.match(ohne.besucher, /^iPhone · Österreich \(\S+\)$/);
    assert.deepEqual(a.einstellungen.geoSperre, { laender: ["RU", "BY", "IN", "KP", "IR"], kontinente: [] });
    assert.equal(a.einstellungen.telegram, "zusammenfassung");
    assert.deepEqual(a.systeme, [{ name: "iOS 18", besuche: 3 }]);
    const schluessel = db.raw.prepare("SELECT besucher FROM besucher_ereignisse").get().besucher;
    assert.ok(!JSON.stringify(a).includes("203.0.113.7") && !JSON.stringify(a).includes(schluessel), "weder IP noch Schluessel");
  } finally {
    n.zurueck();
  }
});

test("Lesbare Namen, Betriebssystem, Browsersprache und Kampagne", () => {
  assert.equal(besucherName({ geraet: "iPhone", stadt: "Hamburg", land: "DE" }), "iPhone · Hamburg");
  assert.equal(besucherName({ geraet: "Windows-PC", land: "AT" }), "Windows-PC · Österreich");
  assert.equal(besucherName({}), "Gerät unbekannt · Ort unbekannt");
  assert.equal(besucherTier("a1b2c3"), besucherTier("a1b2c3"), "stabil fuer denselben Tages-Schluessel");
  assert.notEqual(new Set(["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "a", "b"].map(x => besucherTier(x.repeat(8)))).size, 1);
  assert.equal(systemAus("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36"), "Android 14");
  assert.equal(systemAus("Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X)"), "iPadOS 17");
  assert.equal(systemAus("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130"), "Windows 10/11");
  assert.equal(systemAus("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605"), "macOS");
  assert.equal(browserSpracheAus("de-DE,de;q=0.9,en;q=0.8"), "de");
  assert.equal(browserSpracheAus("*"), null);
  assert.equal(browserSpracheAus(""), null);
  assert.equal(kampagneAus("Instagram", "Herbst_Drop"), "instagram/herbst_drop");
  assert.equal(kampagneAus("<script>", "a b"), null);
  // Die Zusammenfassung kommt ohne Netz aus und bleibt unter dem Telegram-Limit.
  const s = sitzungenBilden(Array.from({ length: 60 }, (_, i) => ({ besucher: "f".repeat(20), zeit: new Date(T0 + i * 1000).toISOString(), typ: "seite", pfad: `/seite-${i}/`, land: "DE", geraet: "Mac", browser: "Safari", server: 1 })))[0];
  const text = zusammenfassungText(s, { einwilligung: 0, zuletzt: s.ende }, new Map(), { schluessel: "f".repeat(20) });
  assert.ok(text.length < 4096);
  assert.match(text, /… und 46 weitere Schritte/);
});

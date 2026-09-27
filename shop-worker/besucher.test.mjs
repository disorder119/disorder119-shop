import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";
import workerEntry from "./worker-entry.js";
import {
  besucherAufraeumen,
  geraetUndBrowser,
  handleBesucher,
  istBot,
  katalogCacheLeeren,
  quelleAus,
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
        { id: 6042, brand: "Prada", title: "Nylonjacke", price: 120 },
        { id: 6184, brand: "Stone Island", title: "Overshirt", price: 90 },
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
  const req = new Request("https://api.disorder119.com/besuch", { method: "POST", headers, body: JSON.stringify(body) });
  Object.defineProperty(req, "cf", { value: cf });
  return req;
}

const senden = (env, body, opts, now = T0) =>
  handleBesucher(besuch(body, opts), env, new URL("https://api.disorder119.com/besuch"), "req", null, now);

test("Einordnung von Geraet, Browser, Bots und Herkunft", () => {
  assert.deepEqual(geraetUndBrowser(IPHONE), { geraet: "iPhone", browser: "Safari" });
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
    assert.deepEqual(rows.map(r => r.gemeldet), [1, 0, 1, 1, 1]);

    assert.equal(n.telegram.length, 4);
    assert.match(n.telegram[0], /BESUCHER GERADE IM SHOP/);
    assert.match(n.telegram[0], /Aschaffenburg, Bavaria, Deutschland/);
    assert.match(n.telegram[0], /iPhone · Safari/);
    assert.match(n.telegram[0], /kommt von instagram\.com/);
    assert.match(n.telegram[1], /IN DEN WARENKORB\nArtikel 6042 – Prada – Nylonjacke \(120 €\)/);
    assert.match(n.telegram[3], /ANFRAGE WIRD GESENDET \(WhatsApp\)/);
    assert.match(n.telegram[3], /• Artikel 6184 – Stone Island – Overshirt/);
    for (const text of n.telegram) assert.ok(!text.includes("203.0.113.7"), "keine IP in Telegram");

    // Anderer Besucher = anderer Schluessel; nach 30 Minuten Pause gilt er wieder als neu.
    await senden(env, { t: "seite", p: "/" }, { ip: "198.51.100.9" }, T0 + 200_000);
    assert.equal(db.raw.prepare("SELECT COUNT(DISTINCT besucher) AS n FROM besucher_ereignisse").get().n, 2);
    await senden(env, { t: "seite", p: "/" }, undefined, T0 + 180_000 + 31 * 60_000);
    assert.equal(n.telegram.length, 6);
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
    assert.equal(n.telegram.length, 1);

    const aus = envMit(d1(), { BESUCHER_TELEGRAM: "aus" });
    await senden(aus, { t: "warenkorb_rein", a: 6042, n: 1 });
    assert.equal(n.telegram.length, 1);

    const alles = envMit(d1(), { BESUCHER_TELEGRAM: "alles" });
    await senden(alles, { t: "seite" });
    await senden(alles, { t: "artikel", a: 6184 }, undefined, T0 + 5000);
    assert.match(n.telegram.at(-1), /schaut: Artikel 6184/);
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
    assert.match(live.besucher[0].besucher, /^#[0-9A-F]{4}$/);

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

test("Cron loescht alte Besuche und altes Salz", async () => {
  const db = d1();
  const n = netz();
  try {
    const env = envMit(db, { BESUCHER_TELEGRAM: "aus" });
    await senden(env, { t: "seite" }, undefined, T0 - 40 * 24 * 60 * 60 * 1000);
    await senden(env, { t: "seite" }, undefined, T0);
    assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM besucher_salz").get().n, 2);
    const ergebnis = await besucherAufraeumen(env, T0);
    assert.equal(ergebnis.geloescht, 1);
    assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM besucher_ereignisse").get().n, 1);
    assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM besucher_salz").get().n, 1);
  } finally {
    n.zurueck();
  }
});

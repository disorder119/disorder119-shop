import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { katalogCacheLeeren } from "./besucher.js";
import { berlin, kalenderwoche, wochenDaten, wochenberichtFaellig, wochenberichtSenden, wochenberichtText } from "./wochenbericht.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
// Montag, 9. November 2026, 08:05 Berlin (= 07:05 UTC).
const MONTAG = Date.parse("2026-11-09T07:05:00Z");
const TAG = 24 * 60 * 60 * 1000;

function d1() {
  const raw = new DatabaseSync(":memory:");
  const files = [
    path.join(HERE, "schema.sql"),
    ...fs.readdirSync(path.join(HERE, "migrations")).filter(f => /^\d{4}_.*\.sql$/.test(f)).sort().map(f => path.join(HERE, "migrations", f)),
  ];
  for (const file of files) raw.exec(fs.readFileSync(file, "utf8"));
  const arg = v => (v === undefined ? null : typeof v === "boolean" ? Number(v) : v);
  const statement = (sql, args = []) => ({
    bind: (...next) => statement(sql, next.map(arg)),
    first: async () => { const row = raw.prepare(sql).get(...args); return row ? { ...row } : null; },
    all: async () => ({ results: raw.prepare(sql).all(...args).map(row => ({ ...row })) }),
    run: async () => { const r = raw.prepare(sql).run(...args); return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; },
  });
  return { raw, prepare: sql => statement(sql) };
}

function netz() {
  const telegram = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input?.url || input);
    if (url.startsWith("https://api.telegram.org/")) {
      telegram.push(JSON.parse(init.body).text);
      return new Response(JSON.stringify({ ok: true, result: { message_id: telegram.length } }), { status: 200 });
    }
    if (url === "https://disorder119.com/data/catalog.json") {
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

const iso = ms => new Date(ms).toISOString();

function sitzung(db, besucher, zeit, extra = {}) {
  db.raw.prepare(`INSERT INTO besucher_sitzungen (besucher, beginn, zuletzt, faellig, offen, einwilligung, besuch_nr, gemeldet, verdacht)
    VALUES (?,?,?,?,0,?,?,1,?)`).run(besucher, iso(zeit), iso(zeit + 60_000), iso(zeit + 600_000), extra.einwilligung ? 1 : 0, extra.besuchNr ?? null, extra.verdacht ?? 0);
}

function ereignis(db, besucher, zeit, typ, extra = {}) {
  db.raw.prepare(`INSERT INTO besucher_ereignisse (besucher, zeit, typ, pfad, artikel_id, titel, warenkorb, quelle, land, server)
    VALUES (?,?,?,?,?,?,?,?,?,1)`).run(besucher, iso(zeit), typ, extra.pfad || "/", extra.artikelId ?? null, extra.titel ?? null, extra.warenkorb ?? 0, extra.quelle ?? null, extra.land ?? "DE");
}

function bestellung(db, id, zeit, status, cents, titel, nr, itemId) {
  db.raw.prepare("INSERT INTO inventory (id, item_id, article_no, status, sale_price_cents, updated_at) VALUES (?,?,?,'AVAILABLE',?,?)").run(`inv-${id}`, itemId, nr, cents, iso(zeit));
  db.raw.prepare(`INSERT INTO commerce_orders (id, order_number, status, subtotal_cents, shipping_cents, total_cents, idempotency_key, created_at)
    VALUES (?,?,?,?,0,?,?,?)`).run(id, `D119-${id}`, status, cents, cents, `idem-${id}`, iso(zeit));
  db.raw.prepare(`INSERT INTO order_items (id, order_id, inventory_id, item_id, article_no, title_snapshot, unit_price_cents)
    VALUES (?,?,?,?,?,?,?)`).run(`${id}-1`, id, `inv-${id}`, itemId, nr, titel, cents);
}

test("Berliner Zeit, Kalenderwoche und Montagsfenster", () => {
  assert.deepEqual(berlin(MONTAG), { wochentag: "Mon", stunde: 8, datum: "2026-11-09" });
  assert.equal(kalenderwoche("2026-11-09"), "2026-W46");
  assert.equal(kalenderwoche("2026-01-01"), "2026-W01");
  assert.equal(kalenderwoche("2027-01-03"), "2026-W53");
  assert.equal(wochenberichtFaellig(MONTAG), "2026-W46");
  assert.equal(wochenberichtFaellig(MONTAG + 60 * 60_000), null, "09 Uhr: Fenster vorbei");
  assert.equal(wochenberichtFaellig(MONTAG + TAG), null, "Dienstag");
});

test("Wochenbericht: Zahlen der Woche, Vorwoche, Bots ausgefiltert, Bestellungen; genau einmal je Woche", async () => {
  const db = d1();
  const n = netz();
  try {
    const env = { DB: db, TELEGRAM_BOT_TOKEN: "t", TELEGRAM_CHAT_ID: "1" };
    const woche = MONTAG - 3 * TAG, vorwoche = MONTAG - 10 * TAG;
    // Diese Woche: 3 Menschen (einer wiederkehrend mit Einwilligung), 2 Bots.
    sitzung(db, "a", woche); sitzung(db, "b", woche + 3_600_000, { einwilligung: true, besuchNr: 3 }); sitzung(db, "c", woche + 7_200_000);
    sitzung(db, "bot1", woche, { verdacht: 2 }); sitzung(db, "bot2", woche, { verdacht: 3 });
    ereignis(db, "a", woche, "seite", { quelle: "instagram.com", land: "DE" });
    ereignis(db, "a", woche + 1000, "artikel", { artikelId: "6042", titel: "Prada – Nylonjacke", quelle: "instagram.com" });
    ereignis(db, "b", woche + 3_600_000, "artikel", { artikelId: "6042", titel: "Prada – Nylonjacke", land: "AT" });
    ereignis(db, "b", woche + 3_601_000, "warenkorb_rein", { artikelId: "6042", warenkorb: 1, land: "AT" });
    ereignis(db, "c", woche + 7_200_000, "artikel", { artikelId: "6184", titel: "Stone Island – Overshirt", quelle: "tiktok.com", land: "FR" });
    ereignis(db, "c", woche + 7_201_000, "anfrage", { warenkorb: 0, land: "FR" });
    ereignis(db, "bot1", woche, "artikel", { artikelId: "6184", land: "US" });
    // Vorwoche: 1 Besuch, 1 Bestellung.
    sitzung(db, "v", vorwoche);
    bestellung(db, "alt", vorwoche, "SHIPPED", 9000, "Stone Island – Overshirt", "84", 6184);
    // Diese Woche: 1 bezahlte Bestellung, 1 nur reserviert (zaehlt nicht), 1 storniert.
    bestellung(db, "neu", woche + 2 * TAG, "PAID", 12000, "Prada – Nylonjacke", "42", 6042);
    bestellung(db, "res", woche + 2 * TAG, "RESERVED", 5000, "Egal", "1", 6001);
    bestellung(db, "weg", woche + 1 * TAG, "CANCELLED", 7000, "Egal 2", "2", 6002);
    db.raw.prepare("INSERT INTO waechter_sperren (anschluss, seit, bis, zuletzt, grund, versuche) VALUES ('h1', ?, ?, ?, 'scanner-pfad', 3)")
      .run(iso(woche), iso(woche + TAG), iso(woche));

    const d = await wochenDaten(env, MONTAG);
    assert.equal(d.besuche, 3);
    assert.equal(d.besucheVorwoche, 1);
    assert.equal(d.einwilligung, 1);
    assert.equal(d.wiederkehrer, 1);
    assert.equal(d.automatisiert, 2);
    assert.deepEqual(d.laender.map(l => [l.land, l.n]), [["AT", 1], ["DE", 1], ["FR", 1]]);
    assert.deepEqual(d.quellen.map(q => [q.quelle, q.n]), [["instagram.com", 1], ["tiktok.com", 1]]);
    assert.deepEqual(d.artikel.map(a => [a.artikel_id, a.n]), [["6042", 2], ["6184", 1]], "Bot-Aufruf von 6184 zaehlt nicht");
    assert.equal(d.warenkorb, 1);
    assert.equal(d.anfragen, 1);
    assert.equal(d.bestellungen, 1);
    assert.equal(d.umsatzCents, 12000);
    assert.equal(d.bestellungenVorwoche, 1);
    assert.equal(d.storniert, 1);
    assert.equal(d.sperren, 1);

    // Dienstag: nichts. Montag 08:05: genau eine Nachricht, danach nicht noch einmal.
    assert.deepEqual(await wochenberichtSenden(env, MONTAG + TAG), { gesendet: 0, grund: "nicht faellig" });
    assert.deepEqual(await wochenberichtSenden(env, MONTAG), { gesendet: 1, woche: "2026-W46" });
    assert.deepEqual(await wochenberichtSenden(env, MONTAG + 10 * 60_000), { gesendet: 0, grund: "schon gemeldet" });
    assert.equal(n.telegram.length, 1);
    const text = n.telegram[0];
    assert.match(text, /^📊 WOCHENBERICHT 02\.11\.–08\.11\./);
    assert.match(text, /👥 3 Besuche \(Vorwoche 1, \+200 %\) · 1 mit Statistik-Einwilligung · 1 Wiederkehrer/);
    assert.match(text, /🤖 2 automatisierte Aufrufe ausgefiltert/);
    assert.match(text, /📍 Österreich 1, Deutschland 1, Frankreich 1/);
    assert.match(text, /↪️ Instagram 1, TikTok 1/);
    assert.match(text, /• #42 Prada – Nylonjacke \(120 €\) · 2×/);
    assert.match(text, /🛒 1× in den Warenkorb · 💬 1 Anfragen/);
    assert.match(text, /💶 1 Bestellung · 120,00 € \(Vorwoche 1 · 90,00 €\) · 1 storniert\/erstattet/);
    assert.match(text, /• #42 Prada – Nylonjacke · 120 €/);
    assert.match(text, /🛡 1 Sperren · 0 abgewehrte Versuche/);
    assert.ok(!text.includes("Egal"), "reservierte/stornierte Bestellungen nicht als Verkauf");
    // Naechste Woche wieder.
    assert.equal((await wochenberichtSenden(env, MONTAG + 7 * TAG)).gesendet, 1);
    // Abgeschaltet.
    assert.deepEqual(await wochenberichtSenden({ ...env, WOCHENBERICHT: "aus" }, MONTAG + 14 * TAG), { gesendet: 0, grund: "aus" });
    assert.equal(n.telegram.length, 2);
  } finally {
    n.zurueck();
  }
});

test("Wochenbericht-Text ohne Daten bleibt lesbar", () => {
  const text = wochenberichtText({ von: MONTAG - 7 * TAG, bis: MONTAG, besuche: 0, besucheVorwoche: 0, einwilligung: 0, wiederkehrer: 0, automatisiert: 0,
    laender: [], quellen: [], artikel: [], warenkorb: 0, anfragen: 0, bestellungen: 0, umsatzCents: 0, bestellungenVorwoche: 0, umsatzVorwocheCents: 0, verkauft: [], storniert: 0, sperren: 0, vorfaelle: 0, kampagnen: 0 });
  assert.match(text, /👥 0 Besuche\n/);
  assert.match(text, /Keine Herkunft übermittelt/);
  assert.ok(!text.includes("💡"), "kein Tipp ohne Besuche");
});

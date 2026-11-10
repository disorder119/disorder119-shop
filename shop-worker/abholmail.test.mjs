// Zwischenschritt "abholbereit" (DHL meldet: Paket liegt in Packstation/Filiale)
// und die Abholmail, die nur aus der Admin-App heraus verschickt wird
// (Inhaber 07.11.2026: "nur wenn ich es dir sage").
import assert from "node:assert/strict";
import test from "node:test";
import { ABFRAGE_ABSTAND_MS, abholortAusText, sendungenVerfolgen, zustandAusAntwort } from "./dhl-tracking.js";
import { abholortFuerMail, formatPickupReady, sendPickupReady, sendPickupPreview } from "./customer-mail.js";
import { formatPickupReadyMessage } from "./notifications.js";
import { orderStatusAutomatisch } from "./admin-api.js";
import { allMigrations, sqliteD1 } from "./test-d1.mjs";

const TRACKING = "00340434161094042557";
const PACKSTATION_TEXT = "Die Sendung liegt in der PACKSTATION 119 in 63739 Aschaffenburg zur Abholung bereit.";

function antwort(statusCode, text = "", events = []) {
  return { shipments: [{ id: TRACKING, service: "parcel-de", status: { statusCode, status: text, description: text }, events }] };
}

function seed({ orderStatus = "SHIPPED", adresse = "Packstation 119" } = {}) {
  const DB = sqliteD1(allMigrations());
  const now = new Date().toISOString();
  const run = (sql, ...args) => DB.raw.prepare(sql).run(...args);
  run(`INSERT INTO inventory (id,item_id,article_no,status,sale_price_cents,currency,catalog_status,version,updated_at)
    VALUES ('inv_1',6232,'229',?,24000,'EUR','SOLD',1,?)`, orderStatus, now);
  run(`INSERT INTO commerce_orders (id,order_number,status,currency,subtotal_cents,shipping_cents,total_cents,idempotency_key,created_at)
    VALUES ('o1','D119-20261107-4821',?,'EUR',24000,0,24000,'k1',?)`, orderStatus, now);
  run(`INSERT INTO order_items (id,order_id,inventory_id,item_id,article_no,title_snapshot,unit_price_cents,bild)
    VALUES ('oi1','o1','inv_1',6232,'229','Prada America''s Cup Sneaker Damen Dunkelblau',24000,'assets/img/6232/0.webp')`);
  run(`INSERT INTO payments (id,order_id,provider,provider_order_id,provider_payment_id,status,amount_cents,currency,idempotency_key,created_at)
    VALUES ('pay1','o1','PAYPAL','PPORDER1','CAPTURE1','COMPLETED',24000,'EUR','paypal-create:k1',?)`, now);
  run(`INSERT INTO order_contact_snapshots (order_id,source_provider,email,recipient_name,address_line1,postal_code,city,country_code,captured_at)
    VALUES ('o1','PAYPAL','kundin@example.com','Mara Test',?,'63739','Aschaffenburg','DE',?)`, adresse, now);
  run(`INSERT INTO shipments (id,order_id,carrier,service,tracking_number,status,created_at,updated_at)
    VALUES ('s1','o1','DHL','Paket',?,'SHIPPED',?,?)`, TRACKING, now, now);
  return DB;
}

function fakeTracking(antworten) {
  const calls = [];
  return { calls, fetchImpl: async url => {
    calls.push(String(url));
    const s = antworten.shift().shipments[0].status;
    const escape = v => String(v || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;");
    return new Response(`<data name="piece-status-public-list" code="0"><data name="piece-status-public" status="${escape(s.status)}" standard-event-code="${escape(s.statusCode)}" delivery-event-flag="0"/></data>`);
  } };
}

function mailFetch() {
  const mails = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (/brevo/.test(String(url))) { mails.push(JSON.parse(init.body)); return Response.json({ messageId: `m${mails.length}` }); }
    if (/telegram/.test(String(url))) return Response.json({ ok: true, result: { message_id: 1 } });
    // Katalog (Marke/Groesse fuer die Mail): nicht erreichbar - die Mail kommt ohne aus.
    return new Response("offline", { status: 503 });
  };
  return { mails, zurueck: () => { globalThis.fetch = original; } };
}

const MAIL_ENV = { MAIL_API_KEY: "k", MAIL_FROM: "shop@disorder119.com", MAIL_FROM_NAME: "D119" };

test("DHL: abholbereit in Packstation/Filiale ist ein eigener Zwischenschritt, abgeholt heisst zugestellt", () => {
  const z = zustandAusAntwort(antwort("transit", PACKSTATION_TEXT));
  assert.equal(z.zustand, "ABHOLBEREIT");
  assert.deepEqual(z.abholort, { typ: "packstation", nummer: "119", plz: "63739", ort: "Aschaffenburg" });
  assert.equal(zustandAusAntwort(antwort("transit", "The shipment is ready for pick-up at the PACKSTATION.")).zustand, "ABHOLBEREIT");
  assert.equal(zustandAusAntwort(antwort("transit", "Die Sendung liegt in der Filiale zur Abholung bereit.")).abholort.typ, "filiale");
  // Fruehere "abholbereit"-Station, jetzt abgeholt: zugestellt.
  assert.equal(zustandAusAntwort(antwort("", "Die Sendung wurde aus der PACKSTATION abgeholt.", [{ description: PACKSTATION_TEXT }])).zustand, "ZUGESTELLT");
  assert.equal(zustandAusAntwort(antwort("delivered", "Delivered")).zustand, "ZUGESTELLT");
  // "Von DHL abgeholt" (beim Absender) bleibt unterwegs.
  assert.equal(zustandAusAntwort(antwort("", "Die Sendung wurde abgeholt.")).zustand, "UNTERWEGS");
  assert.deepEqual(abholortAusText("irgendwas"), { typ: "", nummer: "", plz: "", ort: "" });
});

test("Cron: abholbereit -> Telegram-Meldung genau einmal, aber KEINE Mail an die Kundschaft", async () => {
  const DB = seed();
  const env = { DB, DHL_PAKET_TRACKING_API_KEY: "tracking-key", DHL_PAKET_TRACKING_API_SECRET: "secret", DHL_PAKET_TRACKING_USER: "user", DHL_PAKET_TRACKING_PASSWORD: "pass", ...MAIL_ENV };
  const f = mailFetch();
  const meldungen = [];
  try {
    const t0 = Date.parse("2026-11-07T08:00:00Z");
    const deps = () => ({ statusSetzen: (id, s) => orderStatusAutomatisch(env, id, s, "req"), abholbereitMelden: (s, stand) => meldungen.push({ s, stand }), warten: async () => {} });
    const r = await sendungenVerfolgen(env, "req-1", t0, { ...deps(), fetchImpl: fakeTracking([antwort("transit", PACKSTATION_TEXT)]).fetchImpl });
    assert.deepEqual(r.abholbereit, ["o1"]);
    assert.equal(meldungen.length, 1);
    assert.equal(meldungen[0].stand.abholort.nummer, "119");
    assert.equal(DB.raw.prepare("SELECT zustand FROM sendungs_abfragen WHERE shipment_id='s1'").get().zustand, "ABHOLBEREIT");
    assert.equal(DB.raw.prepare("SELECT status FROM commerce_orders WHERE id='o1'").get().status, "SHIPPED");
    assert.equal(f.mails.length, 0, "keine Kundenmail ohne Auftrag des Inhabers");
    // Naechste Abfrage, immer noch abholbereit: keine zweite Meldung.
    const r2 = await sendungenVerfolgen(env, "req-2", t0 + ABFRAGE_ABSTAND_MS + 1000, { ...deps(), fetchImpl: fakeTracking([antwort("transit", PACKSTATION_TEXT)]).fetchImpl });
    assert.deepEqual(r2.abholbereit, []);
    assert.equal(meldungen.length, 1);
    // Abgeholt: zugestellt.
    await sendungenVerfolgen(env, "req-3", t0 + 2 * ABFRAGE_ABSTAND_MS + 2000, { ...deps(), fetchImpl: fakeTracking([antwort("", "Die Sendung wurde aus der PACKSTATION abgeholt.")]).fetchImpl });
    assert.equal(DB.raw.prepare("SELECT status FROM commerce_orders WHERE id='o1'").get().status, "DELIVERED");
    assert.equal(f.mails.length, 0);
  } finally {
    f.zurueck();
  }
});

test("Abholmail: DE/EN/FR mit Teil, Packstation aus der Lieferanschrift, ehrlichem Hinweis und DHL-Vermerk", () => {
  const order = { order_number: "D119-20261107-4821", carrier: "DHL", tracking_number: TRACKING,
    contact: { address_line1: "Packstation 119", postal_code: "63739", city: "Aschaffenburg" },
    items: [{ item_id: 6232, article_no: "229", title_snapshot: "Prada America's Cup Sneaker", bild: "assets/img/6232/0.webp" }] };
  const de = formatPickupReady(order, { sprache: "de" });
  assert.match(de.subject, /abholbereit/);
  assert.match(de.text, /Prada America's Cup Sneaker sitzt gerade in der Packstation 119 in Aschaffenburg/);
  assert.match(de.text, /Abholcode bekommst du direkt von DHL/);
  assert.match(de.text, /Delivered by Deutsche Post DHL Group/);
  assert.match(de.html, /https:\/\/disorder119\.com\/assets\/img\/6232\/0\.webp/);
  assert.match(de.html, /PACKSTATION 119|Packstation 119/);
  assert.doesNotMatch(de.html + de.text, /versichert|7 Tage|garantiert/i, "keine eigenen Versprechen zu Frist oder Versicherung");
  const en = formatPickupReady(order, { sprache: "en" });
  assert.match(en.subject, /ready for pickup/);
  assert.match(en.text, /Packstation 119 in Aschaffenburg/);
  const fr = formatPickupReady(order, { sprache: "fr" });
  assert.match(fr.subject, /prête à être retirée/);
  assert.match(fr.text, /la Packstation 119 à Aschaffenburg/);
  // Gleicher Witz in Vorschau und echter Mail (aus der Bestellnummer gewaehlt).
  assert.equal(formatPickupReady(order, { sprache: "de" }).text, de.text);
  // Ohne Packstation in der Anschrift: was DHL meldet, sonst neutral.
  assert.deepEqual(abholortFuerMail({ address_line1: "Hauptstr. 1", city: "Bremen" }, { typ: "filiale", ort: "Bremen" }), { typ: "filiale", nummer: "", plz: "", ort: "Bremen" });
  assert.match(formatPickupReady({ ...order, contact: {} }, { sprache: "de", abholort: { typ: "packstation" } }).text, /in einer Packstation/);
});

test("Abholmail: Vorschau sendet nichts, Senden genau einmal, nochmal nur auf ausdruecklichen Wunsch", async () => {
  const DB = seed();
  const env = { DB, ...MAIL_ENV };
  const f = mailFetch();
  try {
    const v = await sendPickupReady(env, "o1", { vorschau: true });
    assert.equal(v.vorschau, true);
    assert.equal(v.an, "kundin@example.com");
    assert.match(v.html, /Packstation 119/);
    assert.equal(f.mails.length, 0, "Vorschau verschickt nichts");

    const r = await sendPickupReady(env, "o1", { reqId: "req-a" });
    assert.equal(r.sent, true);
    assert.equal(f.mails.length, 1);
    assert.equal(f.mails[0].to[0].email, "kundin@example.com");
    assert.deepEqual(f.mails[0].tags, ["pickup-ready"]);
    const ereignis = DB.raw.prepare("SELECT event_type FROM audit_events WHERE id LIKE 'notify:email:pickup:o1:%'").get();
    assert.equal(ereignis.event_type, "PICKUP_NOTICE_SENT");

    const doppelt = await sendPickupReady(env, "o1", { reqId: "req-b" });
    assert.equal(doppelt.duplicate, true);
    assert.equal(f.mails.length, 1, "zweiter Klick schickt nicht nochmal");

    const nochmal = await sendPickupReady(env, "o1", { reqId: "req-c", erneut: true });
    assert.equal(nochmal.sent, true);
    assert.equal(f.mails.length, 2);
  } finally {
    f.zurueck();
  }
});

test("Abholmail: nur fuer versendete Bestellungen", async () => {
  const DB = seed({ orderStatus: "PAID" });
  const f = mailFetch();
  try {
    const r = await sendPickupReady({ DB, ...MAIL_ENV }, "o1", {});
    assert.equal(r.reason, "ORDER_NOT_SHIPPED");
    assert.equal(f.mails.length, 0);
  } finally {
    f.zurueck();
  }
});

test("Abholmail-Test: echte Referenz bleibt sichtbar als unbestätigte Simulation markiert", async () => {
  const catalogFetch = async () => Response.json([{ id: 6216, article: "213", title: "Y-3 Grafik-Beanie", gallery: ["assets/img/b2-216/0.webp"], public_status: "SOLD" }]);
  const env = { KATALOG_FETCH: catalogFetch };
  const result = await sendPickupPreview(env, "joelb119@gmail.com", {
    itemId: 6216, orderNumber: "D119-20261104-E1BBBE11", trackingNumber: "358088742443", nurBauen: true,
  });
  assert.equal(result.sent, false);
  assert.match(result.html, /TESTVORSCHAU: Die Ankunft an einer Packstation ist nicht bestätigt/);
  assert.match(result.html, /Y-3 Grafik-Beanie/);
  assert.match(result.text, /358088742443/);
  assert.doesNotMatch(result.html + result.text, /Packstation 119|in Aschaffenburg und wartet/);
  assert.match(result.subject, /D119-20261104-E1BBBE11/);
  const invalid = await sendPickupPreview(env, "joelb119@gmail.com", { itemId: 6216, trackingNumber: "abc", nurBauen: true });
  assert.equal(invalid.reason, "INVALID_PREVIEW_REFERENCE");
});

test("Telegram-Meldung: Bestellung, Teil, Packstation und der Hinweis, dass die Mail erst auf Knopfdruck geht", () => {
  const text = formatPickupReadyMessage({ order_number: "D119-20261107-4821", titel: "Prada America's Cup Sneaker" }, { typ: "packstation", nummer: "119", ort: "Aschaffenburg" });
  assert.match(text, /ABHOLBEREIT · D119-20261107-4821/);
  assert.match(text, /Packstation 119 · Aschaffenburg/);
  assert.match(text, /erst, wenn du sie in der Admin-App abschickst/);
});

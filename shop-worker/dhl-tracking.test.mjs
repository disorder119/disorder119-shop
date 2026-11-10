import assert from "node:assert/strict";
import test from "node:test";
import { ABFRAGE_ABSTAND_MS, abfrageAbstandMs, sendungenVerfolgen, verlaufAufraeumen, zustandAusAntwort, trackingReady } from "./dhl-tracking.js";
import { listOrders } from "./customer-account.js";
import { orderStatusAutomatisch } from "./admin-api.js";
import { allMigrations, sqliteD1 } from "./test-d1.mjs";

const TRACKING = "358088742443";

test("Frankierungs-Schluessel wird nicht als Tracking-Freigabe behandelt", () => {
  assert.equal(trackingReady({ DHL_PRIVAT_API_KEY: "shipping-only" }), false);
  assert.equal(trackingReady({ DHL_TRACKING_API_KEY: "tracking" }), true);
});

function seed({ orderStatus = "PREPARING", shipmentStatus = "LABEL_CREATED" } = {}) {
  const DB = sqliteD1(allMigrations());
  const now = new Date().toISOString();
  const run = (sql, ...args) => DB.raw.prepare(sql).run(...args);
  run(`INSERT INTO inventory (id,item_id,article_no,status,sale_price_cents,currency,catalog_status,version,updated_at)
    VALUES ('inv_1',6216,'213',?,7000,'EUR','SOLD',1,?)`, orderStatus, now);
  run(`INSERT INTO commerce_orders (id,order_number,status,currency,subtotal_cents,shipping_cents,total_cents,idempotency_key,created_at)
    VALUES ('o1','D119-20261104-E1BBBE11',?,'EUR',7000,0,7000,'k1',?)`, orderStatus, now);
  run(`INSERT INTO order_items (id,order_id,inventory_id,item_id,article_no,title_snapshot,unit_price_cents)
    VALUES ('oi1','o1','inv_1',6216,'213','Y-3 Grafik-Beanie',7000)`);
  run(`INSERT INTO payments (id,order_id,provider,provider_order_id,provider_payment_id,status,amount_cents,currency,idempotency_key,created_at)
    VALUES ('pay1','o1','PAYPAL','PPORDER1','CAPTURE1','COMPLETED',7000,'EUR','paypal-create:k1',?)`, now);
  run(`INSERT INTO order_contact_snapshots (order_id,source_provider,email,recipient_name,address_line1,postal_code,city,country_code,captured_at)
    VALUES ('o1','PAYPAL','kundin@example.com','Julian Kolk','Schleiermacher Straße 21','28201','Bremen','DE',?)`, now);
  run(`INSERT INTO shipments (id,order_id,carrier,service,tracking_number,status,created_at,updated_at)
    VALUES ('s1','o1','DHL','Online-Frankierung',?,?,?,?)`, TRACKING, shipmentStatus, now, now);
  return DB;
}

function antwort(statusCode, text = "", events = []) {
  return { shipments: [{ id: TRACKING, service: "parcel-de", status: { statusCode, status: text, description: text }, events }] };
}

function fakeTracking(antworten) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const u = new URL(url);
    calls.push({ nummer: u.searchParams.get("trackingNumber"), plz: u.searchParams.get("recipientPostalCode"), key: init.headers["DHL-API-Key"] });
    const a = antworten.shift();
    if (a instanceof Response) return a;
    return Response.json(a);
  };
  return { calls, fetchImpl };
}

test("DHL-Antworten werden auf unterwegs / zugestellt / offen abgebildet", () => {
  assert.equal(zustandAusAntwort(antwort("pre-transit", "Die Sendung wurde elektronisch angekündigt")).zustand, "OFFEN");
  assert.equal(zustandAusAntwort(antwort("transit", "Die Sendung wurde im Paketzentrum bearbeitet")).zustand, "UNTERWEGS");
  assert.equal(zustandAusAntwort(antwort("delivered", "Die Sendung wurde erfolgreich zugestellt")).zustand, "ZUGESTELLT");
  // parcel-de meldet seit 2026 Kuerzel statt vereinheitlichter Codes.
  assert.equal(zustandAusAntwort(antwort("ZU", "", [{ statusCode: "ZU", description: "Die Sendung wurde erfolgreich zugestellt." }])).zustand, "ZUGESTELLT");
  assert.equal(zustandAusAntwort(antwort("", "", [{ description: "Die Sendung wurde in der Filiale eingeliefert (Einlieferung)." }])).zustand, "UNTERWEGS");
  assert.equal(zustandAusAntwort(antwort("failure", "Zustellung nicht möglich")).zustand, "PROBLEM");
  assert.equal(zustandAusAntwort({ shipments: [] }).zustand, "UNBEKANNT");
});

test("unterwegs -> Versendet mit Versandmail, zugestellt -> Zugestellt ohne Mail", async () => {
  const DB = seed();
  const mails = [];
  const env = { DB, DHL_TRACKING_API_KEY: "tracking-key", MAIL_API_KEY: "k", MAIL_FROM: "shop@disorder119.com", MAIL_FROM_NAME: "D119" };
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => { mails.push({ url: String(url), body: JSON.parse(init.body) }); return Response.json({ messageId: "m1" }); };
  try {
    const dhl = fakeTracking([antwort("transit", "Die Sendung wurde im Paketzentrum bearbeitet")]);
    const t0 = Date.parse("2026-11-05T08:00:00Z");
    const r = await sendungenVerfolgen(env, "req-1", t0, { statusSetzen: (id, s) => orderStatusAutomatisch(env, id, s, "req-1"), fetchImpl: dhl.fetchImpl, warten: async () => {} });
    assert.deepEqual(r.versendet, ["o1"]);
    assert.equal(dhl.calls[0].plz, "28201");
    assert.equal(dhl.calls[0].key, "tracking-key");
    assert.equal(DB.raw.prepare("SELECT status FROM commerce_orders WHERE id='o1'").get().status, "SHIPPED");
    assert.equal(DB.raw.prepare("SELECT status FROM shipments WHERE id='s1'").get().status, "SHIPPED");
    const versandMails = mails.filter(m => /unterwegs|geht jetzt zu dir/i.test(m.body.subject || ""));
    assert.equal(versandMails.length, 1, JSON.stringify(mails.map(m => m.body.subject)));
    assert.match(versandMails[0].body.htmlContent, new RegExp(TRACKING));

    // Noch innerhalb des Abstands: keine neue Abfrage.
    const dhl2 = fakeTracking([antwort("delivered")]);
    const r2 = await sendungenVerfolgen(env, "req-2", t0 + 60_000, { statusSetzen: (id, s) => orderStatusAutomatisch(env, id, s, "req-2"), fetchImpl: dhl2.fetchImpl, warten: async () => {} });
    assert.equal(r2.abgefragt, 0);
    assert.equal(dhl2.calls.length, 0);

    // Spaeter: zugestellt - Status wechselt, es geht keine weitere Mail raus.
    const vorher = mails.length;
    const r3 = await sendungenVerfolgen(env, "req-3", t0 + ABFRAGE_ABSTAND_MS + 1000, { statusSetzen: (id, s) => orderStatusAutomatisch(env, id, s, "req-3"), fetchImpl: dhl2.fetchImpl, warten: async () => {} });
    assert.deepEqual(r3.zugestellt, ["o1"]);
    assert.equal(DB.raw.prepare("SELECT status FROM commerce_orders WHERE id='o1'").get().status, "DELIVERED");
    assert.equal(DB.raw.prepare("SELECT status,delivered_at FROM shipments WHERE id='s1'").get().status, "DELIVERED");
    assert.equal(mails.length, vorher);
    const stand = DB.raw.prepare("SELECT zustand,abfragen FROM sendungs_abfragen WHERE shipment_id='s1'").get();
    assert.equal(stand.zustand, "ZUGESTELLT");
    assert.equal(stand.abfragen, 2);
    // Zugestellte Sendungen werden nicht mehr abgefragt.
    const dhl3 = fakeTracking([antwort("delivered")]);
    await sendungenVerfolgen(env, "req-4", t0 + 2 * ABFRAGE_ABSTAND_MS + 2000, { statusSetzen: () => assert.fail("kein Status mehr"), fetchImpl: dhl3.fetchImpl, warten: async () => {} });
    assert.equal(dhl3.calls.length, 0);
  } finally {
    globalThis.fetch = original;
  }
});

test("Zugestellt direkt aus 'Bezahlt': erst Versendet (Mail), dann Zugestellt", async () => {
  const DB = seed({ orderStatus: "PAID" });
  const mails = [];
  const env = { DB, DHL_TRACKING_API_KEY: "tracking-key", MAIL_API_KEY: "k", MAIL_FROM: "shop@disorder119.com", MAIL_FROM_NAME: "D119" };
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => { mails.push(JSON.parse(init.body).subject); return Response.json({ messageId: "m1" }); };
  try {
    const dhl = fakeTracking([antwort("delivered", "Die Sendung wurde erfolgreich zugestellt")]);
    const r = await sendungenVerfolgen(env, "req", Date.now(), { statusSetzen: (id, s) => orderStatusAutomatisch(env, id, s, "req"), fetchImpl: dhl.fetchImpl });
    assert.equal(dhl.calls[0].key, "tracking-key");
    assert.deepEqual(r.versendet, ["o1"]);
    assert.deepEqual(r.zugestellt, ["o1"]);
    assert.equal(DB.raw.prepare("SELECT status FROM commerce_orders WHERE id='o1'").get().status, "DELIVERED");
    assert.equal(mails.filter(s => /unterwegs|zu dir/i.test(s)).length, 1);
  } finally {
    globalThis.fetch = original;
  }
});

test("Unbekannte Sendung (404), Limit (429) und fehlender Schluessel", async () => {
  const DB = seed();
  const env = { DB, DHL_TRACKING_API_KEY: "k" };
  const dhl = fakeTracking([new Response("", { status: 404 })]);
  const r = await sendungenVerfolgen(env, "req", Date.now(), { statusSetzen: () => assert.fail("kein Status"), fetchImpl: dhl.fetchImpl });
  assert.equal(r.abgefragt, 1);
  assert.equal(DB.raw.prepare("SELECT zustand,status_code FROM sendungs_abfragen WHERE shipment_id='s1'").get().zustand, "OFFEN");
  assert.equal(DB.raw.prepare("SELECT status FROM commerce_orders WHERE id='o1'").get().status, "PREPARING");

  const limit = fakeTracking([new Response("", { status: 429 })]);
  const r2 = await sendungenVerfolgen(env, "req", Date.now() + ABFRAGE_ABSTAND_MS + 1, { statusSetzen: () => assert.fail("kein Status"), fetchImpl: limit.fetchImpl });
  assert.equal(r2.fehler[0].code, "LIMIT");

  const ohne = await sendungenVerfolgen({ DB }, "req", Date.now(), { statusSetzen: () => assert.fail("kein Status") });
  assert.equal(ohne.uebersprungen, true);
});

test("Sendungsverlauf: Stationen gespeichert, im Kundenkonto sichtbar, 30 Tage nach Zustellung geloescht", async () => {
  const DB = seed();
  const env = { DB, DHL_TRACKING_API_KEY: "k" };
  const t0 = Date.parse("2026-11-05T08:00:00Z");
  const stationen = [
    { timestamp: "2026-11-04T18:02:00+01:00", statusCode: "transit", description: "Die Sendung wurde im Start-Paketzentrum bearbeitet.", location: { address: { addressLocality: "Aschaffenburg" } } },
    { timestamp: "2026-11-04T09:15:00+01:00", statusCode: "pre-transit", description: "Die Sendung wurde elektronisch angekündigt." },
    { timestamp: "kaputt", description: "ohne Zeit" },
  ];
  const dhl = fakeTracking([antwort("transit", "Die Sendung wurde im Start-Paketzentrum bearbeitet.", stationen)]);
  await sendungenVerfolgen(env, "req", t0, { statusSetzen: async () => {}, fetchImpl: dhl.fetchImpl, warten: async () => {} });
  const zeile = DB.raw.prepare("SELECT ereignisse_json,zugestellt_am FROM sendungs_abfragen WHERE shipment_id='s1'").get();
  const verlauf = JSON.parse(zeile.ereignisse_json);
  assert.equal(verlauf.length, 2, "ohne gueltige Zeit kein Eintrag");
  assert.deepEqual(verlauf[0], { zeit: "2026-11-04T17:02:00.000Z", text: "Die Sendung wurde im Start-Paketzentrum bearbeitet.", ort: "Aschaffenburg" });
  assert.equal(zeile.zugestellt_am, null);

  // Kundenkonto der Bestellung: Verlauf neben dem DHL-Link.
  DB.raw.prepare("INSERT INTO customers (id,email_normalized,status,created_at) VALUES ('c1','kundin@example.com','ACTIVE',?)").run(new Date(t0).toISOString());
  DB.raw.prepare("UPDATE commerce_orders SET customer_id='c1' WHERE id='o1'").run();
  const [bestellung] = await listOrders(env, "c1");
  assert.equal(bestellung.shipment.verlauf.length, 2);
  assert.equal(bestellung.shipment.verlauf[0].ort, "Aschaffenburg");
  assert.equal(bestellung.shipment.verlaufStand, new Date(t0).toISOString());
  assert.equal((await listOrders(env, "andere-kundin")).length, 0, "nur fuer die eigene Kundin");

  // Zugestellt: Zeitpunkt aus dem juengsten Ereignis.
  const t1 = t0 + ABFRAGE_ABSTAND_MS + 1000;
  const zu = fakeTracking([antwort("delivered", "Die Sendung wurde erfolgreich zugestellt.", [{ timestamp: "2026-11-05T12:30:00Z", statusCode: "delivered", description: "Die Sendung wurde erfolgreich zugestellt." }, ...stationen])]);
  await sendungenVerfolgen(env, "req", t1, { statusSetzen: async () => {}, fetchImpl: zu.fetchImpl, warten: async () => {} });
  assert.equal(DB.raw.prepare("SELECT zugestellt_am FROM sendungs_abfragen WHERE shipment_id='s1'").get().zugestellt_am, "2026-11-05T12:30:00.000Z");

  // 29 Tage spaeter bleibt alles, nach 30 Tagen ist der DHL-Verlauf weg - der eigene Stand bleibt.
  assert.equal(await verlaufAufraeumen(DB, Date.parse("2026-12-04T12:00:00Z")), 0);
  assert.equal(await verlaufAufraeumen(DB, Date.parse("2026-12-05T12:31:00Z")), 1);
  const danach = DB.raw.prepare("SELECT zustand,ereignisse_json,status_text,status_code,zugestellt_am FROM sendungs_abfragen WHERE shipment_id='s1'").get();
  assert.equal(danach.zustand, "ZUGESTELLT");
  assert.equal(danach.ereignisse_json, null);
  assert.equal(danach.status_text, null);
  assert.equal(danach.status_code, null);
  assert.equal((await listOrders(env, "c1"))[0].shipment.verlauf, undefined, "im Konto nur noch der Link");
});

test("Abfrageabstand: Standard 3 Stunden, per DHL_TRACKING_ABSTAND_MIN 15 Minuten bis 1 Tag", () => {
  assert.equal(abfrageAbstandMs({}), ABFRAGE_ABSTAND_MS);
  assert.equal(abfrageAbstandMs({ DHL_TRACKING_ABSTAND_MIN: "60" }), 3_600_000);
  assert.equal(abfrageAbstandMs({ DHL_TRACKING_ABSTAND_MIN: "1" }), 15 * 60_000);
  assert.equal(abfrageAbstandMs({ DHL_TRACKING_ABSTAND_MIN: "99999" }), 1440 * 60_000);
  assert.equal(abfrageAbstandMs({ DHL_TRACKING_ABSTAND_MIN: "viel" }), ABFRAGE_ABSTAND_MS);
});

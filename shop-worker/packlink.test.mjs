import assert from "node:assert/strict";
import test from "node:test";
import {
  angebotAus,
  bestellZiel,
  handlePacklink,
  handlePacklinkWebhook,
  isPacklinkRoute,
  isPacklinkWebhookRoute,
  laufzeit,
  nameTeile,
  phase,
  sendungsStatusFolgt,
  sendungsStatusIntern,
  sichereUrl,
  versandStatus,
} from "./packlink.js";
import { formatShippingConfirmation } from "./customer-mail.js";
import { allMigrations, sqliteD1 } from "./test-d1.mjs";

const ADMIN = "https://admin.disorder119.com";
const TOKEN = "admin-schluessel-dieser-anfrage";
const REFERENZ = "DE2026PRO0012345678";
const SENDUNGSNUMMER = "1Z999AA10123456784";

function seed(contact = {}) {
  const DB = sqliteD1(allMigrations());
  const now = new Date().toISOString();
  const run = (sql, ...args) => DB.raw.prepare(sql).run(...args);
  run(`INSERT INTO inventory (id,item_id,article_no,status,sale_price_cents,currency,catalog_status,version,updated_at)
    VALUES ('inv_1',1,'2241','PAID',9000,'EUR','SOLD',1,?)`, now);
  run(`INSERT INTO commerce_orders (id,order_number,status,currency,subtotal_cents,shipping_cents,total_cents,idempotency_key,created_at)
    VALUES ('o1','D119-2026-0001','PAID','EUR',9000,590,9590,'k1',?)`, now);
  run(`INSERT INTO order_items (id,order_id,inventory_id,item_id,article_no,title_snapshot,unit_price_cents)
    VALUES ('oi1','o1','inv_1',1,'2241','Jean Paul Gaultier Jeans Damen Blau',9000)`);
  // Sofort eingezogene Zahlung (wie vor der Umstellung): vor dem Etikett ist
  // nichts mehr einzuziehen.
  run(`INSERT INTO payments (id,order_id,provider,provider_order_id,provider_payment_id,status,amount_cents,currency,idempotency_key,created_at)
    VALUES ('pay1','o1','PAYPAL','PPORDER1','CAPTURE1','COMPLETED',9590,'EUR','paypal-create:k1',?)`, now);
  const c = {
    recipient_name: "Maria Müller", address_line1: "Musterstraße 12a", address_line2: "Hinterhaus",
    postal_code: "10115", city: "Berlin", country_code: "DE", ...contact,
  };
  run(`INSERT INTO order_contact_snapshots (order_id,source_provider,email,recipient_name,address_line1,address_line2,postal_code,city,country_code,captured_at)
    VALUES ('o1','PAYPAL','kundin@example.com',?,?,?,?,?,?,?)`,
  c.recipient_name, c.address_line1, c.address_line2, c.postal_code, c.city, c.country_code, now);
  return DB;
}

const SERVICES = [
  { id: 20955, name: "Classic", carrier_name: "DPD", base_price: "6.60", price: { total_price: 7.85, base_price: 6.6 }, dropoff: false, delivery_to_parcelshop: false, transit_time: "2 DAYS", category: "standard" },
  { id: 23655, name: "Standard Access Point™", carrier_name: "UPS", base_price: "4.80", price: { total_price: 5.71, base_price: 4.8 }, dropoff: true, delivery_to_parcelshop: false, transit_time: "2 DAYS", category: "standard" },
  { id: 11111, name: "Zustellung an Paketshop", carrier_name: "GLS", base_price: "3.10", price: { total_price: 3.69, base_price: 3.1 }, dropoff: true, delivery_to_parcelshop: true, transit_time: "1 DAYS" },
  { id: 22222, name: "Paketshop - Nicht rechteckige Pakete", carrier_name: "GLS", base_price: "12.00", price: { total_price: 14.28, base_price: 12 }, dropoff: true, delivery_to_parcelshop: false },
  { id: 33333, name: "Express®", carrier_name: "UPS", base_price: "12.00", price: { total_price: 14.28, base_price: 12 }, dropoff: false, delivery_to_parcelshop: false, transit_time: "1 DAYS", category: "express" },
  { id: 55555, name: "Express 12", carrier_name: "DPD", base_price: "16.72", price: { total_price: 19.9, base_price: 16.72 }, dropoff: false, delivery_to_parcelshop: false, transit_time: "1 DAYS", category: "express" },
];

const KAUF_REFERENZ = "DE2026PRO0099999999";
const KAUF_ANTWORT = {
  order_reference: "DE00019732CF",
  total_amount: 7.85,
  shipments: [{
    shipment_custom_reference: "D119-2026-0001", shipment_reference: KAUF_REFERENZ,
    insurance_coverage_amount: 0, total_price: 7.85, receipt: "https://pro.packlink.de/receipt/DE00019732CF",
  }],
};

// Nachbau der Packlink-Schnittstelle: merkt sich jede Anfrage.
function fakePacklink({ state = "AWAITING_COMPLETION", trackings = [], trackingUrl = "", labels = [] } = {}) {
  const calls = [];
  const mails = [];
  const original = globalThis.fetch;
  // kauf: "ok" | "abgelehnt" (400) | "netz" (keine Antwort) | "leer" (Antwort ohne Sendung)
  const zustand = { state, trackings, trackingUrl, labels, kaputt: false, kauf: "ok", kaufPause: null };
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    if (u.origin === "https://api.brevo.com") {
      mails.push(JSON.parse(init.body));
      return Response.json({ messageId: `<m${mails.length}@brevo>` }, { status: 201 });
    }
    calls.push({ path: u.pathname, query: u.searchParams, method: init.method || "GET", headers: init.headers || {}, body: init.body ? JSON.parse(init.body) : null });
    assert.equal(u.origin, "https://api.packlink.com");
    if (zustand.kaputt) throw new Error("packlink down");
    const path = u.pathname.replace(/^\/v1/, "");
    if (path === "/services") return Response.json(SERVICES);
    if (path === "/shipments" && init.method === "POST") return Response.json({ reference: REFERENZ }, { status: 201 });
    if (path === "/orders" && init.method === "POST") {
      if (zustand.kaufPause) await zustand.kaufPause;
      if (zustand.kauf === "netz") throw new Error("socket hang up");
      if (zustand.kauf === "abgelehnt") {
        return Response.json({ messages: [{ message: "Bitte hinterlege eine Zahlungsmethode." }] }, { status: 400 });
      }
      if (zustand.kauf === "leer") return Response.json({ order_reference: "DE000X", shipments: [] }, { status: 201 });
      return Response.json(KAUF_ANTWORT, { status: 201 });
    }
    const sendungPfad = /^\/shipments\/([A-Za-z0-9-]+)(\/labels)?$/.exec(path);
    if (sendungPfad && sendungPfad[2]) return Response.json(zustand.labels);
    if (sendungPfad && init.method !== "POST") {
      return Response.json({
        packlink_reference: sendungPfad[1], state: zustand.state, carrier: "UPS", service: "Standard Access Point™",
        trackings: zustand.trackings, tracking_url: zustand.trackingUrl, price: { base_price: 4.8 },
      });
    }
    return new Response("{}", { status: 404 });
  };
  return { calls, mails, zustand, restore() { globalThis.fetch = original; } };
}

function envWith(DB, extra = {}) {
  return { DB, ADMIN_TOKEN: TOKEN, PACKLINK_API_KEY: "packlink-test-key", ...extra };
}

async function call(env, pathname, { method = "GET", body, bearer = TOKEN } = {}) {
  const req = new Request(`https://api.disorder119.com${pathname}`, {
    method,
    headers: { Origin: ADMIN, Authorization: `Bearer ${bearer}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const res = await handlePacklink(req, env, new URL(req.url), "req-test", ADMIN);
  return { status: res.status, data: await res.json() };
}

test("routes, phases and small helpers", () => {
  assert.equal(isPacklinkRoute(new URL("https://api.disorder119.com/admin/versand/o1/packlink")), true);
  assert.equal(isPacklinkRoute(new URL("https://api.disorder119.com/admin/versand/o1/packlink/angebote")), true);
  assert.equal(isPacklinkRoute(new URL("https://api.disorder119.com/admin/versand/o1/packlink/kaufen")), true);
  assert.equal(isPacklinkRoute(new URL("https://api.disorder119.com/admin/versand/o1/packlink/loeschen")), false);
  assert.equal(isPacklinkRoute(new URL("https://api.disorder119.com/admin/versand/o1/qr")), false);
  assert.equal(phase("READY_TO_PURCHASE"), "offen");
  assert.equal(phase("PURCHASE_SUCCESS"), "bezahlt");
  assert.equal(phase("READY_TO_PRINT"), "bereit");
  assert.equal(phase("OUT_FOR_DELIVERY"), "unterwegs");
  assert.equal(phase("DELIVERED"), "zugestellt");
  assert.equal(phase("CANCELED"), "storniert");
  assert.equal(phase("KAUF_LAEUFT"), "kauf");
  assert.equal(phase("KAUF_ABGELEHNT"), "abgelehnt");
  assert.equal(laufzeit("1 DAYS"), "1 Tag");
  assert.equal(laufzeit("2 DAYS"), "2 Tage");
  assert.deepEqual(nameTeile({ recipient_name: "Anna Maria Schmidt" }), { name: "Anna Maria", surname: "Schmidt" });
  assert.deepEqual(nameTeile({ given_name: "Joel", surname: "Bittner" }), { name: "Joel", surname: "Bittner" });
  assert.equal(sichereUrl("javascript:alert(1)"), "");
  assert.equal(sichereUrl("http://example.com/x.pdf"), "");
  assert.equal(sichereUrl("https://labels.packlink.com/x.pdf"), "https://labels.packlink.com/x.pdf");
  assert.equal(angebotAus(SERVICES[1]).preisCents, 571);
  assert.equal(angebotAus(SERVICES[1]).abgabe, "PAKETSHOP");
});

test("offers work without an API key: home delivery only, the checkout's carriers, cheapest first", async () => {
  const fake = fakePacklink();
  try {
    const result = await call(envWith(seed(), { PACKLINK_API_KEY: "" }), "/admin/versand/o1/packlink/angebote?paket=S");
    assert.equal(result.status, 200, JSON.stringify(result.data));
    assert.equal(result.data.eingerichtet, false);
    // Wie in der Kasse nur DPD und DHL - UPS und GLS stehen nicht zur Wahl.
    assert.deepEqual(result.data.angebote.map(a => [a.carrier, a.preisCents]), [["DPD", 785], ["DPD", 1990]]);
    assert.equal(result.data.angebote[1].express, true);
    const anfrage = fake.calls[0];
    assert.equal(anfrage.headers.Authorization, undefined);
    assert.equal(anfrage.query.get("from[zip]"), "63739");
    assert.equal(anfrage.query.get("to[zip]"), "10115");
    assert.equal(anfrage.query.get("to[country]"), "DE");
    assert.equal(anfrage.query.get("packages[0][weight]"), "1");
    assert.equal(anfrage.query.get("packages[0][length]"), "35");
  } finally {
    fake.restore();
  }
});

test("a draft needs the API key", async () => {
  const fake = fakePacklink();
  try {
    const result = await call(envWith(seed(), { PACKLINK_API_KEY: "" }), "/admin/versand/o1/packlink", { method: "POST", body: { serviceId: 23655 } });
    assert.equal(result.status, 503);
    assert.equal(result.data.error, "PACKLINK_NICHT_EINGERICHTET");
    assert.equal(fake.calls.length, 0);
  } finally {
    fake.restore();
  }
});

test("draft -> payment in Packlink -> tracking number and label on the order", async () => {
  const DB = seed();
  const env = envWith(DB);
  const fake = fakePacklink();
  try {
    const created = await call(env, "/admin/versand/o1/packlink", {
      method: "POST", body: { serviceId: 23655, paket: "M", carrier: "UPS", name: "Standard Access Point™", preisCents: 571 },
    });
    assert.equal(created.status, 200, JSON.stringify(created.data));
    const sendung = created.data.sendung;
    assert.equal(sendung.reference, REFERENZ);
    assert.equal(sendung.phase, "offen");
    assert.equal(sendung.preisCents, 571);
    assert.equal(sendung.bezahlLink, `https://pro.packlink.de/private/shipments/${REFERENZ}/create/address`);

    const post = fake.calls.find(c => c.method === "POST");
    assert.equal(post.headers.Authorization, "packlink-test-key");
    assert.equal(post.body.service_id, 23655);
    assert.deepEqual(post.body.packages, [{ width: 30, height: 15, length: 40, weight: 2 }]);
    assert.equal(post.body.content_second_hand, true);
    assert.equal(post.body.contentvalue, 90);
    assert.equal(post.body.shipment_custom_reference, "D119-2026-0001");
    assert.equal(post.body.from.zip_code, "63739");
    assert.equal(post.body.from.company, "Disorder119");
    assert.deepEqual(post.body.to, {
      name: "Maria", surname: "Müller", company: "", street1: "Musterstraße 12a", street2: "Hinterhaus",
      zip_code: "10115", city: "Berlin", country: "DE",
    });
    // Datenschutz: keine E-Mail-Adresse und keine Telefonnummer der Kundin.
    assert.equal("email" in post.body.to, false);
    assert.equal("phone" in post.body.to, false);

    // Zweiter Klick legt keinen zweiten Entwurf an.
    const again = await call(env, "/admin/versand/o1/packlink", { method: "POST", body: { serviceId: 20955 } });
    assert.equal(again.data.sendung.reference, REFERENZ);
    assert.equal(fake.calls.filter(c => c.method === "POST").length, 1);

    // Noch nicht bezahlt: Status bleibt offen, Auftrag unveraendert.
    const waiting = await call(env, "/admin/versand/o1/packlink");
    assert.equal(waiting.data.sendung.phase, "offen");
    assert.equal(DB.raw.prepare("SELECT status FROM commerce_orders WHERE id='o1'").get().status, "PAID");

    // In Packlink bezahlt, Etikett bereit.
    fake.zustand.state = "READY_TO_PRINT";
    fake.zustand.trackings = [SENDUNGSNUMMER];
    fake.zustand.trackingUrl = `https://www.ups.com/track?tracknum=${SENDUNGSNUMMER}`;
    fake.zustand.labels = ["javascript:alert(1)", "https://labels.packlink.com/DE2026PRO0012345678.pdf"];
    const ready = await call(env, "/admin/versand/o1/packlink");
    assert.equal(ready.status, 200, JSON.stringify(ready.data));
    assert.equal(ready.data.sendung.phase, "bereit");
    assert.equal(ready.data.sendung.sendungsnummer, SENDUNGSNUMMER);
    assert.equal(ready.data.sendung.etikettUrl, "https://labels.packlink.com/DE2026PRO0012345678.pdf");
    assert.equal(ready.data.sendung.bezahlLink, null);

    const shipment = DB.raw.prepare("SELECT carrier,tracking_number,status FROM shipments WHERE order_id='o1'").get();
    assert.deepEqual({ ...shipment }, { carrier: "UPS", tracking_number: SENDUNGSNUMMER, status: "LABEL_CREATED" });
    assert.equal(DB.raw.prepare("SELECT status FROM commerce_orders WHERE id='o1'").get().status, "PREPARING");
    assert.equal(DB.raw.prepare("SELECT status FROM inventory WHERE id='inv_1'").get().status, "PREPARING");
    const events = DB.raw.prepare("SELECT event_type FROM audit_events WHERE entity_id='o1' ORDER BY created_at").all().map(r => r.event_type);
    assert.deepEqual(events.filter(e => e.startsWith("PACKLINK")), ["PACKLINK_ENTWURF_ANGELEGT", "PACKLINK_SENDUNGSNUMMER"]);

    // Die Versandmail verlinkt die UPS-Sendungsverfolgung.
    const mail = formatShippingConfirmation({ order_number: "D119-2026-0001", carrier: "UPS", tracking_number: SENDUNGSNUMMER });
    assert.match(mail.text, /ups\.com\/track\?loc=de_DE&tracknum=1Z999AA10123456784/);
  } finally {
    fake.restore();
  }
});

test("incomplete addresses, other orders and wrong keys are refused", async () => {
  const fake = fakePacklink();
  try {
    const ohnePlz = await call(envWith(seed({ postal_code: "" })), "/admin/versand/o1/packlink", { method: "POST", body: { serviceId: 23655 } });
    assert.equal(ohnePlz.status, 409);
    assert.equal(ohnePlz.data.error, "ADRESSE_UNVOLLSTAENDIG");
    assert.match(ohnePlz.data.detail, /PLZ/);

    const unbekannt = await call(envWith(seed()), "/admin/versand/gibtsnicht/packlink/angebote");
    assert.equal(unbekannt.status, 404);

    const fremd = await call(envWith(seed()), "/admin/versand/o1/packlink", { bearer: "falsch" });
    assert.equal(fremd.status, 401);
    assert.equal(fake.calls.filter(c => c.method === "POST").length, 0);
  } finally {
    fake.restore();
  }
});

test("a replaced draft is kept apart and a paid one cannot be replaced", async () => {
  const DB = seed();
  const env = envWith(DB);
  const fake = fakePacklink();
  try {
    await call(env, "/admin/versand/o1/packlink", { method: "POST", body: { serviceId: 23655 } });
    fake.zustand.state = "PURCHASE_SUCCESS";
    await call(env, "/admin/versand/o1/packlink");
    const nochmal = await call(env, "/admin/versand/o1/packlink", { method: "POST", body: { serviceId: 20955, neu: true } });
    assert.equal(nochmal.status, 409);
    assert.equal(nochmal.data.error, "SENDUNG_SCHON_BEZAHLT");
  } finally {
    fake.restore();
  }
});

test("a service the customer already paid for stays bookable even if its carrier is no longer offered", async () => {
  const DB = seed();
  DB.raw.prepare(`INSERT INTO order_versand
      (order_id,option_id,art,quelle,packlink_service_id,carrier,service_name,paket,preis_cents,created_at)
      VALUES ('o1','pl-S-23655','standard','packlink',23655,'UPS','Standard Access Point™','S',571,?)`)
    .run(new Date().toISOString());
  const fake = fakePacklink();
  try {
    const result = await call(envWith(DB), "/admin/versand/o1/packlink/angebote");
    assert.equal(result.status, 200, JSON.stringify(result.data));
    assert.equal(result.data.wahl.serviceId, 23655);
    assert.deepEqual(result.data.angebote.map(a => a.id), [23655, 20955, 55555]);
  } finally {
    fake.restore();
  }
});

// ------------------------------------------------------------ Direktkauf

const KAUF = { serviceId: 20955, paket: "M", carrier: "DPD", name: "Classic", preisCents: 785 };

test("buying a label: one /v1/orders call, no customer email or phone, label straight on the order", async () => {
  const DB = seed();
  const env = envWith(DB);
  const fake = fakePacklink({ state: "READY_TO_PRINT", trackings: [SENDUNGSNUMMER], labels: ["https://labels.packlink.com/x.pdf"] });
  try {
    const ohneSchluessel = await call(envWith(seed(), { PACKLINK_API_KEY: "" }), "/admin/versand/o1/packlink/kaufen", { method: "POST", body: KAUF });
    assert.equal(ohneSchluessel.status, 503);
    assert.equal(ohneSchluessel.data.error, "PACKLINK_NICHT_EINGERICHTET");
    assert.equal(fake.calls.length, 0);

    const vorher = await call(env, "/admin/versand/o1/packlink/angebote?paket=M");
    assert.deepEqual(vorher.data.direktkauf, { bewaehrt: false, zuletztAbgelehntAm: null });

    const gekauft = await call(env, "/admin/versand/o1/packlink/kaufen", { method: "POST", body: KAUF });
    assert.equal(gekauft.status, 200, JSON.stringify(gekauft.data));
    assert.equal(gekauft.data.sendung.reference, KAUF_REFERENZ);
    assert.equal(gekauft.data.sendung.phase, "bereit");
    const danach = await call(env, "/admin/versand/o1/packlink");
    assert.equal(danach.data.direktkauf.bewaehrt, true);
    assert.equal(gekauft.data.sendung.etikettUrl, "https://labels.packlink.com/x.pdf");
    assert.equal(gekauft.data.sendung.preisCents, 785);

    const kauf = fake.calls.find(c => c.path === "/v1/orders");
    assert.equal(kauf.method, "POST");
    assert.equal(kauf.headers.Authorization, "packlink-test-key");
    assert.equal(kauf.body.order_custom_reference, "D119-2026-0001");
    assert.equal(kauf.body.shipments.length, 1);
    const sendung = kauf.body.shipments[0];
    assert.equal(sendung.service_id, 20955);
    assert.deepEqual(sendung.packages, [{ width: 30, height: 15, length: 40, weight: 2 }]);
    assert.equal(sendung.from.zip_code, "63739");
    assert.equal(sendung.to.surname, "Müller");
    assert.equal("email" in sendung.to, false);
    assert.equal("phone" in sendung.to, false);

    const row = DB.raw.prepare("SELECT reference,state,price_cents FROM packlink_sendungen WHERE order_id='o1'").get();
    assert.deepEqual({ ...row }, { reference: KAUF_REFERENZ, state: "READY_TO_PRINT", price_cents: 785 });
    assert.equal(DB.raw.prepare("SELECT status FROM commerce_orders WHERE id='o1'").get().status, "PREPARING");
    const events = DB.raw.prepare("SELECT event_type FROM audit_events WHERE entity_id='o1'").all().map(r => r.event_type);
    assert.ok(events.includes("PACKLINK_ETIKETT_GEKAUFT"));

    // Kein zweites Etikett - weder per Kauf noch per Entwurf.
    const nochmal = await call(env, "/admin/versand/o1/packlink/kaufen", { method: "POST", body: KAUF });
    assert.equal(nochmal.status, 409);
    assert.equal(nochmal.data.error, "SENDUNG_SCHON_BEZAHLT");
    const entwurf = await call(env, "/admin/versand/o1/packlink", { method: "POST", body: { ...KAUF, neu: true } });
    assert.equal(entwurf.status, 409);
    assert.equal(fake.calls.filter(c => c.path === "/v1/orders").length, 1);
    assert.equal(fake.calls.filter(c => c.path === "/v1/shipments" && c.method === "POST").length, 0);
  } finally {
    fake.restore();
  }
});

test("two clicks at once buy only one label", async () => {
  const DB = seed();
  const env = envWith(DB);
  const fake = fakePacklink({ state: "PURCHASE_SUCCESS" });
  let weiter;
  fake.zustand.kaufPause = new Promise(resolve => { weiter = resolve; });
  try {
    const erster = call(env, "/admin/versand/o1/packlink/kaufen", { method: "POST", body: KAUF });
    const zweiter = call(env, "/admin/versand/o1/packlink/kaufen", { method: "POST", body: KAUF });
    setTimeout(weiter, 20);
    const ergebnisse = await Promise.all([erster, zweiter]);
    assert.deepEqual(ergebnisse.map(r => r.status).sort(), [200, 409]);
    assert.equal(ergebnisse.find(r => r.status === 409).data.error, "KAUF_LAEUFT_SCHON");
    assert.equal(fake.calls.filter(c => c.path === "/v1/orders").length, 1);
    assert.equal(DB.raw.prepare("SELECT COUNT(*) AS n FROM packlink_sendungen").get().n, 1);
  } finally {
    fake.restore();
  }
});

test("a purchase Packlink refuses leaves nothing behind; the offers come back", async () => {
  const DB = seed();
  const env = envWith(DB);
  const fake = fakePacklink({ state: "PURCHASE_SUCCESS" });
  fake.zustand.kauf = "abgelehnt";
  try {
    const abgelehnt = await call(env, "/admin/versand/o1/packlink/kaufen", { method: "POST", body: KAUF });
    assert.equal(abgelehnt.status, 409);
    assert.equal(abgelehnt.data.error, "KAUF_ABGELEHNT");
    assert.match(abgelehnt.data.detail, /Zahlungsmethode/);
    assert.equal(DB.raw.prepare("SELECT state FROM packlink_sendungen").get().state, "KAUF_ABGELEHNT");
    const stand = await call(env, "/admin/versand/o1/packlink");
    assert.equal(stand.data.sendung, null);
    // Die Admin-App schlaegt danach den Entwurf vor.
    assert.equal(stand.data.direktkauf.bewaehrt, false);
    assert.ok(stand.data.direktkauf.zuletztAbgelehntAm);

    // Zahlungsart in Packlink hinterlegt: der naechste Versuch klappt.
    fake.zustand.kauf = "ok";
    const gekauft = await call(env, "/admin/versand/o1/packlink/kaufen", { method: "POST", body: KAUF });
    assert.equal(gekauft.status, 200, JSON.stringify(gekauft.data));
    assert.equal(gekauft.data.sendung.phase, "bezahlt");
    const events = DB.raw.prepare("SELECT event_type FROM audit_events WHERE entity_id='o1'").all().map(r => r.event_type);
    assert.ok(events.includes("PACKLINK_KAUF_ABGELEHNT"));
  } finally {
    fake.restore();
  }
});

test("an unclear purchase blocks everything until it was checked in Packlink", async () => {
  const DB = seed();
  const env = envWith(DB);
  const fake = fakePacklink({ state: "PURCHASE_SUCCESS" });
  fake.zustand.kauf = "netz";
  try {
    const unklar = await call(env, "/admin/versand/o1/packlink/kaufen", { method: "POST", body: KAUF });
    assert.equal(unklar.status, 502);
    assert.equal(unklar.data.error, "KAUF_UNKLAR");

    const stand = await call(env, "/admin/versand/o1/packlink");
    assert.equal(stand.status, 200, JSON.stringify(stand.data));
    assert.equal(stand.data.sendung.phase, "kauf");
    assert.equal(stand.data.sendung.reference, null);
    assert.equal(stand.data.sendung.packlinkLink, "https://pro.packlink.de/private/shipments/all");
    // Kein Nachfragen bei Packlink mit dem Platzhalter.
    assert.equal(fake.calls.filter(c => c.path.startsWith("/v1/shipments/")).length, 0);

    fake.zustand.kauf = "ok";
    const blind = await call(env, "/admin/versand/o1/packlink/kaufen", { method: "POST", body: KAUF });
    assert.equal(blind.status, 409);
    assert.equal(blind.data.error, "KAUF_UNKLAR");
    const entwurf = await call(env, "/admin/versand/o1/packlink", { method: "POST", body: { ...KAUF, neu: true } });
    assert.equal(entwurf.status, 409);
    assert.equal(entwurf.data.error, "KAUF_UNKLAR");
    assert.equal(fake.calls.filter(c => c.path === "/v1/orders").length, 1);

    // In Packlink nachgesehen, nichts gekauft: ausdruecklich neu kaufen.
    const geprueft = await call(env, "/admin/versand/o1/packlink/kaufen", { method: "POST", body: { ...KAUF, trotzdem: true } });
    assert.equal(geprueft.status, 200, JSON.stringify(geprueft.data));
    assert.equal(geprueft.data.sendung.reference, KAUF_REFERENZ);
    const zeilen = DB.raw.prepare("SELECT state FROM packlink_sendungen ORDER BY created_at").all().map(r => r.state);
    assert.deepEqual(zeilen, ["ERSETZT", "PURCHASE_SUCCESS"]);
  } finally {
    fake.restore();
  }
});

test("an answer without a shipment counts as unclear, never as nothing bought", async () => {
  const DB = seed();
  const fake = fakePacklink();
  fake.zustand.kauf = "leer";
  try {
    const leer = await call(envWith(DB), "/admin/versand/o1/packlink/kaufen", { method: "POST", body: KAUF });
    assert.equal(leer.status, 502);
    assert.equal(leer.data.error, "KAUF_UNKLAR");
    assert.equal(DB.raw.prepare("SELECT state FROM packlink_sendungen").get().state, "KAUF_UNKLAR");
  } finally {
    fake.restore();
  }
});

test("buying replaces an unpaid draft only on purpose", async () => {
  const DB = seed();
  const env = envWith(DB);
  const fake = fakePacklink();
  try {
    await call(env, "/admin/versand/o1/packlink", { method: "POST", body: KAUF });
    const ohne = await call(env, "/admin/versand/o1/packlink/kaufen", { method: "POST", body: KAUF });
    assert.equal(ohne.status, 409);
    assert.equal(ohne.data.error, "ENTWURF_VORHANDEN");
    fake.zustand.state = "PURCHASE_SUCCESS";
    const mit = await call(env, "/admin/versand/o1/packlink/kaufen", { method: "POST", body: { ...KAUF, neu: true } });
    assert.equal(mit.status, 200, JSON.stringify(mit.data));
    const zeilen = DB.raw.prepare("SELECT state FROM packlink_sendungen ORDER BY created_at").all().map(r => r.state);
    assert.deepEqual(zeilen, ["ERSETZT", "PURCHASE_SUCCESS"]);
  } finally {
    fake.restore();
  }
});

// --------------------------------------------------------------- Webhook

const WEBHOOK = "webhook-schluessel-0123456789abcdef";

async function melden(env, payload, { schluessel = WEBHOOK, method = "POST" } = {}) {
  const req = new Request(`https://api.disorder119.com/packlink/webhook/${schluessel}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: method === "POST" ? JSON.stringify(payload) : undefined,
  });
  const res = await handlePacklinkWebhook(req, env, new URL(req.url), "req-hook");
  return { status: res.status, data: await res.json() };
}

test("status mapping: Packlink state -> shipment and order", () => {
  assert.equal(isPacklinkWebhookRoute(new URL(`https://api.disorder119.com/packlink/webhook/${WEBHOOK}`)), true);
  assert.equal(isPacklinkWebhookRoute(new URL("https://api.disorder119.com/packlink/webhook/")), false);
  assert.equal(sendungsStatusIntern("AWAITING_COMPLETION"), null);
  assert.equal(sendungsStatusIntern("PURCHASE_SUCCESS"), "PENDING");
  assert.equal(sendungsStatusIntern("READY_TO_PRINT"), "LABEL_CREATED");
  assert.equal(sendungsStatusIntern("IN_TRANSIT"), "IN_TRANSIT");
  assert.equal(sendungsStatusIntern("OUT_FOR_DELIVERY"), "IN_TRANSIT");
  assert.equal(sendungsStatusIntern("DELIVERED"), "DELIVERED");
  assert.equal(sendungsStatusIntern("RETURNED_TO_SENDER"), "RETURNED");
  assert.equal(sendungsStatusIntern("INCIDENT"), "EXCEPTION");
  assert.equal(sendungsStatusIntern("CARRIER_KO"), "EXCEPTION");
  assert.equal(sendungsStatusIntern("CANCELED"), null);
  assert.equal(bestellZiel("READY_TO_PRINT"), null);
  assert.equal(bestellZiel("IN_TRANSIT"), "SHIPPED");
  assert.equal(bestellZiel("DELIVERED"), "DELIVERED");
  assert.equal(bestellZiel("RETURNED_TO_SENDER"), null);
  // Nie rueckwaerts.
  assert.equal(sendungsStatusFolgt("DELIVERED", "IN_TRANSIT"), false);
  assert.equal(sendungsStatusFolgt("SHIPPED", "IN_TRANSIT"), true);
  assert.equal(sendungsStatusFolgt("IN_TRANSIT", "EXCEPTION"), true);
  assert.equal(sendungsStatusFolgt("EXCEPTION", "IN_TRANSIT"), true);
  assert.equal(sendungsStatusFolgt("DELIVERED", "EXCEPTION"), false);
  assert.equal(sendungsStatusFolgt("LABEL_CREATED", "LABEL_CREATED"), false);
});

test("webhook: wrong key, missing key and GET look like an unknown address", async () => {
  const DB = seed();
  const fake = fakePacklink();
  try {
    assert.equal((await melden(envWith(DB), { event: "shipment.delivered" })).status, 404);
    assert.equal((await melden(envWith(DB, { PACKLINK_WEBHOOK_TOKEN: WEBHOOK }), { event: "x" }, { schluessel: "falsch" })).status, 404);
    assert.equal((await melden(envWith(DB, { PACKLINK_WEBHOOK_TOKEN: WEBHOOK }), null, { method: "GET" })).status, 405);
    const ohne = await melden(envWith(DB, { PACKLINK_WEBHOOK_TOKEN: WEBHOOK }), { event: "shipment.delivered", data: {} });
    assert.equal(ohne.data.ignoriert, "OHNE_SENDUNG");
    const fremd = await melden(envWith(DB, { PACKLINK_WEBHOOK_TOKEN: WEBHOOK }), { event: "shipment.delivered", data: { shipment_reference: "DE0000FREMD000" } });
    assert.equal(fremd.data.ignoriert, "UNBEKANNTE_SENDUNG");
    assert.equal(fake.calls.length, 0);
  } finally {
    fake.restore();
  }
});

test("webhook drives the order: label -> shipped (mail once) -> delivered, never backwards", async () => {
  const DB = seed();
  const env = envWith(DB, { PACKLINK_WEBHOOK_TOKEN: WEBHOOK, MAIL_API_KEY: "brevo-test", MAIL_FROM: "shop@disorder119.com" });
  const fake = fakePacklink();
  const status = () => DB.raw.prepare("SELECT status FROM commerce_orders WHERE id='o1'").get().status;
  const sendung = () => DB.raw.prepare("SELECT status,tracking_number FROM shipments WHERE order_id='o1'").get();
  try {
    DB.raw.prepare(`INSERT INTO order_versand (order_id,option_id,art,quelle,packlink_service_id,carrier,service_name,paket,preis_cents,laufzeit,created_at)
      VALUES ('o1','pl-M-23655','standard','packlink',23655,'UPS','Standard Access Point™','M',571,'2 Tage','2026-09-27T10:00:00Z')`).run();
    // Die Admin-App bekommt die Wahl aus dem Checkout mit.
    const offen = await call(env, "/admin/versand/o1/packlink");
    assert.equal(offen.data.wahl.serviceId, 23655);
    assert.equal(offen.data.wahl.paketName, "Mittel");
    assert.equal(offen.data.wahl.art, "standard");
    assert.equal(offen.data.wahl.auslandsadresse, false);
    const angebote = await call(env, "/admin/versand/o1/packlink/angebote");
    assert.equal(angebote.data.paket.key, "M");

    await call(env, "/admin/versand/o1/packlink", { method: "POST", body: { serviceId: 23655, paket: "M", preisCents: 571 } });

    fake.zustand.state = "READY_TO_PRINT";
    fake.zustand.trackings = [SENDUNGSNUMMER];
    fake.zustand.labels = ["https://labels.packlink.com/x.pdf"];
    const label = await melden(env, { event: "shipment.label.ready", datetime: "2026-09-28 09:00:00", data: { shipment_reference: REFERENZ } });
    assert.equal(label.status, 200, JSON.stringify(label.data));
    assert.equal(label.data.phase, "bereit");
    assert.equal(status(), "PREPARING");
    assert.deepEqual({ ...sendung() }, { status: "LABEL_CREATED", tracking_number: SENDUNGSNUMMER });

    // Dieselbe Meldung noch einmal: nichts passiert, keine Abfrage bei Packlink.
    const vorher = fake.calls.length;
    const doppelt = await melden(env, { event: "shipment.label.ready", datetime: "2026-09-28 09:00:00", data: { shipment_reference: REFERENZ } });
    assert.equal(doppelt.data.duplicate, true);
    assert.equal(fake.calls.length, vorher);

    fake.zustand.state = "IN_TRANSIT";
    await melden(env, { event: "shipment.tracking.update", datetime: "2026-09-28 17:00:00", data: { shipment_reference: REFERENZ } });
    assert.equal(status(), "SHIPPED");
    assert.equal(sendung().status, "IN_TRANSIT");
    assert.equal(fake.mails.length, 1);
    assert.match(fake.mails[0].textContent, /1Z999AA10123456784/);
    assert.equal(fake.mails[0].to[0].email, "kundin@example.com");

    // Noch eine Bewegung unterwegs: keine zweite Versandmail.
    fake.zustand.state = "OUT_FOR_DELIVERY";
    await melden(env, { event: "shipment.tracking.update", datetime: "2026-09-29 08:00:00", data: { shipment_reference: REFERENZ } });
    assert.equal(fake.mails.length, 1);

    fake.zustand.state = "DELIVERED";
    await melden(env, { event: "shipment.delivered", datetime: "2026-09-29 12:00:00", data: { shipment_reference: REFERENZ } });
    assert.equal(status(), "DELIVERED");
    assert.equal(sendung().status, "DELIVERED");
    assert.equal(DB.raw.prepare("SELECT status FROM inventory WHERE id='inv_1'").get().status, "DELIVERED");
    const automatisch = DB.raw.prepare("SELECT actor_type,event_type FROM audit_events WHERE event_type IN ('ORDER_SHIPPED','ORDER_DELIVERED') ORDER BY created_at").all();
    assert.deepEqual(automatisch.map(r => [r.actor_type, r.event_type]), [["SYSTEM", "ORDER_SHIPPED"], ["SYSTEM", "ORDER_DELIVERED"]]);

    const uebersicht = await versandStatus(env);
    assert.equal(uebersicht.packlinkSchluessel, true);
    assert.equal(uebersicht.webhookSchluessel, true);
    assert.equal(uebersicht.meldungen, 4);
    assert.equal(uebersicht.offeneSendungen, 0);
    assert.equal(uebersicht.bestellungenMitVersandwahl, 1);
    assert.equal(fake.mails.length, 1);
  } finally {
    fake.restore();
  }
});

test("webhook: a failed Packlink lookup is not remembered, so the retry works", async () => {
  const DB = seed();
  const env = envWith(DB, { PACKLINK_WEBHOOK_TOKEN: WEBHOOK });
  const fake = fakePacklink();
  try {
    await call(env, "/admin/versand/o1/packlink", { method: "POST", body: { serviceId: 23655, paket: "M" } });
    fake.zustand.kaputt = true;
    const meldung = { event: "shipment.carrier.success", datetime: "2026-09-28 10:00:00", data: { shipment_reference: REFERENZ } };
    const fehler = await melden(env, meldung);
    assert.equal(fehler.status, 502);
    assert.equal(DB.raw.prepare("SELECT COUNT(*) AS n FROM packlink_webhook_events").get().n, 0);
    fake.zustand.kaputt = false;
    fake.zustand.state = "READY_TO_PRINT";
    const erneut = await melden(env, meldung);
    assert.equal(erneut.status, 200, JSON.stringify(erneut.data));
    assert.equal(erneut.data.phase, "bereit");
    const row = DB.raw.prepare("SELECT processed_at,result FROM packlink_webhook_events").get();
    assert.ok(row.processed_at);
    assert.equal(row.result, "READY_TO_PRINT");
  } finally {
    fake.restore();
  }
});

test("cancelled or refunded orders are never moved by Packlink", async () => {
  const DB = seed();
  const env = envWith(DB, { PACKLINK_WEBHOOK_TOKEN: WEBHOOK });
  const fake = fakePacklink();
  try {
    await call(env, "/admin/versand/o1/packlink", { method: "POST", body: { serviceId: 23655, paket: "M" } });
    DB.raw.prepare("UPDATE commerce_orders SET status='REFUNDED' WHERE id='o1'").run();
    fake.zustand.state = "DELIVERED";
    const res = await melden(env, { event: "shipment.delivered", datetime: "2026-09-30 10:00:00", data: { shipment_reference: REFERENZ } });
    assert.equal(res.status, 200);
    assert.equal(DB.raw.prepare("SELECT status FROM commerce_orders WHERE id='o1'").get().status, "REFUNDED");
  } finally {
    fake.restore();
  }
});

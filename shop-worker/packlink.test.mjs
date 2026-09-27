import assert from "node:assert/strict";
import test from "node:test";
import { angebotAus, handlePacklink, isPacklinkRoute, laufzeit, nameTeile, phase, sichereUrl } from "./packlink.js";
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
];

// Nachbau der Packlink-Schnittstelle: merkt sich jede Anfrage.
function fakePacklink({ state = "AWAITING_COMPLETION", trackings = [], trackingUrl = "", labels = [] } = {}) {
  const calls = [];
  const original = globalThis.fetch;
  const zustand = { state, trackings, trackingUrl, labels };
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    calls.push({ path: u.pathname, query: u.searchParams, method: init.method || "GET", headers: init.headers || {}, body: init.body ? JSON.parse(init.body) : null });
    assert.equal(u.origin, "https://api.packlink.com");
    const path = u.pathname.replace(/^\/v1/, "");
    if (path === "/services") return Response.json(SERVICES);
    if (path === "/shipments" && init.method === "POST") return Response.json({ reference: REFERENZ }, { status: 201 });
    if (path === `/shipments/${REFERENZ}`) {
      return Response.json({
        packlink_reference: REFERENZ, state: zustand.state, carrier: "UPS", service: "Standard Access Point™",
        trackings: zustand.trackings, tracking_url: zustand.trackingUrl, price: { base_price: 4.8 },
      });
    }
    if (path === `/shipments/${REFERENZ}/labels`) return Response.json(zustand.labels);
    return new Response("{}", { status: 404 });
  };
  return { calls, zustand, restore() { globalThis.fetch = original; } };
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
  assert.equal(isPacklinkRoute(new URL("https://api.disorder119.com/admin/versand/o1/qr")), false);
  assert.equal(phase("READY_TO_PURCHASE"), "offen");
  assert.equal(phase("PURCHASE_SUCCESS"), "bezahlt");
  assert.equal(phase("READY_TO_PRINT"), "bereit");
  assert.equal(phase("OUT_FOR_DELIVERY"), "unterwegs");
  assert.equal(phase("DELIVERED"), "zugestellt");
  assert.equal(phase("CANCELED"), "storniert");
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

test("offers work without an API key: home delivery only, cheapest first", async () => {
  const fake = fakePacklink();
  try {
    const result = await call(envWith(seed(), { PACKLINK_API_KEY: "" }), "/admin/versand/o1/packlink/angebote?paket=S");
    assert.equal(result.status, 200, JSON.stringify(result.data));
    assert.equal(result.data.eingerichtet, false);
    assert.deepEqual(result.data.angebote.map(a => [a.carrier, a.preisCents]), [["UPS", 571], ["DPD", 785], ["UPS", 1428]]);
    assert.equal(result.data.angebote[2].express, true);
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

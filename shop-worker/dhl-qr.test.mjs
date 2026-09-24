import assert from "node:assert/strict";
import test from "node:test";
import { dhlText, handleDhlQr, receiverAddress, splitStreet } from "./dhl-qr.js";
import { handleAdminRequest } from "./admin-api.js";
import { allMigrations, sqliteD1 } from "./test-d1.mjs";

const ADMIN = "https://admin.disorder119.com";
const TOKEN = "admin-schluessel-dieser-anfrage";
const CART_ID = "ABCDEF123456";
const TRACKING = "00340434161094042557";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(600).fill(7)]);

function seed(contact = {}) {
  const DB = sqliteD1(allMigrations());
  const now = new Date().toISOString();
  const run = (sql, ...args) => DB.raw.prepare(sql).run(...args);
  run(`INSERT INTO inventory (id,item_id,article_no,status,sale_price_cents,currency,catalog_status,version,updated_at)
    VALUES ('inv_1',1,'2241','PAID',9000,'EUR','SOLD',1,?)`, now);
  run(`INSERT INTO commerce_orders (id,order_number,status,currency,subtotal_cents,shipping_cents,total_cents,idempotency_key,created_at)
    VALUES ('o1','D119-2026-0001','PAID','EUR',9000,590,9590,'k1',?)`, now);
  run(`INSERT INTO order_items (id,order_id,inventory_id,item_id,article_no,title_snapshot,unit_price_cents)
    VALUES ('oi1','o1','inv_1',1,'2241','Jean Paul Gaultier Jeans',9000)`);
  const c = {
    recipient_name: "Maria Müller", address_line1: "Musterstraße 12a", address_line2: "",
    postal_code: "63739", city: "Aschaffenburg", country_code: "DE", ...contact,
  };
  run(`INSERT INTO order_contact_snapshots (order_id,source_provider,email,recipient_name,address_line1,address_line2,postal_code,city,country_code,captured_at)
    VALUES ('o1','PAYPAL','kundin@example.com',?,?,?,?,?,?,?)`,
  c.recipient_name, c.address_line1, c.address_line2, c.postal_code, c.city, c.country_code, now);
  return DB;
}

// Nachbau der DHL-Schnittstelle: merkt sich jede Anfrage.
function fakeDhl({ payAfter = 1 } = {}) {
  const calls = [];
  let cartReads = 0;
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    calls.push({ path: u.pathname, method: init.method || "GET", headers: init.headers || {}, body: init.body ? JSON.parse(init.body) : null });
    const path = u.pathname.replace("/parcel/de/shipping/of/v1/public", "");
    if (path === "/catalog/current/products") {
      return Response.json({
        defaultProduct: "PAK02",
        products: {
          PAK05: { attributes: { displayName: { text: "Paket bis 5 kg" }, maxWeight: 5000, tracking: true }, regions: [{ countries: ["DEU"], price: { amount: 7.69 } }] },
          PAK02: { attributes: { displayName: { text: "Paket bis 2 kg" }, maxWeight: 2000, tracking: true }, regions: [{ countries: ["DEU"], price: { amount: 6.19 } }] },
          PAECK: { attributes: { displayName: { text: "Päckchen" }, tracking: false }, regions: [{ countries: ["DEU"], price: { amount: 4.19 } }] },
          PAKEU: { attributes: { displayName: { text: "Paket EU" }, tracking: true }, regions: [{ countries: ["AUT"], price: { amount: 17.49 } }] },
        },
      });
    }
    if (path === "/shopping-carts/pre-paid" && init.method === "POST") {
      return Response.json({
        shoppingcart: {
          shoppingCartId: CART_ID, state: "PREPAID",
          download: { entryUrl: "https://www.dhl.de/send-parcel/gw/rest/init?token=XYZ" },
          items: [{ prices: [{ amount: "6.19" }] }],
        },
      }, { status: 201 });
    }
    if (path === `/shopping-carts/${CART_ID}`) {
      cartReads += 1;
      const paid = cartReads > payAfter;
      return Response.json({
        shoppingcart: {
          shoppingCartId: CART_ID, state: paid ? "PAYED" : "INPAYMENT",
          items: paid ? [{ shipmentNumber: TRACKING, pakId: "123456789" }] : [{}],
        },
      });
    }
    if (path === `/labels/${TRACKING}/qr-code`) {
      assert.equal(init.headers.Accept, "image/png");
      return new Response(PNG, { status: 200, headers: { "Content-Type": "image/png" } });
    }
    return new Response("unbekannt", { status: 404 });
  };
  return { calls, restore() { globalThis.fetch = original; } };
}

function envWith(DB, extra = {}) {
  return { DB, ADMIN_TOKEN: TOKEN, DHL_PRIVAT_API_KEY: "dhl-test-key", ...extra };
}

async function call(env, pathname, { method = "GET", body, bearer = TOKEN } = {}) {
  const req = new Request(`https://api.disorder119.com${pathname}`, {
    method,
    headers: { Origin: ADMIN, Authorization: `Bearer ${bearer}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const res = await handleDhlQr(req, env, new URL(req.url), "req-test", ADMIN);
  return { status: res.status, data: await res.json() };
}

test("names and streets are made safe for DHL's Latin-1 franking", () => {
  assert.equal(dhlText("Maria Müller-Groß", 50), "Maria Müller-Groß");
  assert.equal(dhlText("Café #3 [Hinterhof]: 2!", 50), "Café 3 Hinterhof 2");
  assert.equal(dhlText("Łukasz 🙂 Świątek", 50), "ukasz Swiatek");
  assert.deepEqual(splitStreet("Musterstraße 12a"), { street: "Musterstraße", streetNumber: "12a" });
  assert.deepEqual(splitStreet("Am Markt 3-5"), { street: "Am Markt", streetNumber: "3-5" });
  assert.deepEqual(splitStreet("Straße des 17. Juni 110"), { street: "Straße des 17. Juni", streetNumber: "110" });
  assert.deepEqual(splitStreet("Packstation 150"), { street: "Packstation", streetNumber: "150" });
  assert.deepEqual(splitStreet("Musterweg"), { street: "Musterweg", streetNumber: "" });
  assert.equal(receiverAddress({ given_name: "Maria", surname: "Müller", address_line1: "Weg 1" }).name2, "Maria Müller");
});

test("only domestic, trackable DHL products are offered, cheapest first", async () => {
  const dhl = fakeDhl();
  try {
    const result = await call(envWith(seed()), "/admin/versand/dhl-produkte");
    assert.equal(result.status, 200);
    assert.deepEqual(result.data.produkte.map(p => [p.id, p.priceCents]), [["PAK02", 619], ["PAK05", 769]]);
    assert.equal(dhl.calls[0].headers["dhl-api-key"], "dhl-test-key");
  } finally {
    dhl.restore();
  }
});

test("a QR label goes from cart to payment to tracking number and QR code", async () => {
  const DB = seed();
  const env = envWith(DB);
  const dhl = fakeDhl({ payAfter: 1 });
  try {
    const created = await call(env, "/admin/versand/o1/qr", { method: "POST", body: { produkt: "PAK02" } });
    assert.equal(created.status, 200, JSON.stringify(created.data));
    assert.equal(created.data.marke.state, "PREPAID");
    assert.equal(created.data.marke.bezahlLink, "https://www.dhl.de/send-parcel/gw/rest/init?token=XYZ");
    assert.equal(created.data.marke.preisCents, 619);
    const cart = dhl.calls.find(c => c.path.endsWith("/shopping-carts/pre-paid")).body.shoppingcart;
    assert.deepEqual(cart.items[0].address.receiver, {
      name2: "Maria Müller", street: "Musterstraße", streetNumber: "12a", plz: "63739", city: "Aschaffenburg", country: "DEU",
    });
    assert.equal(cart.items[0].address.sender.street, "Nelseestraße");
    assert.equal(cart.items[0].address.sender.streetNumber, "25");
    assert.equal(cart.items[0].product.id, "PAK02");

    const waiting = await call(env, "/admin/versand/o1/qr");
    assert.equal(waiting.data.marke.state, "INPAYMENT");
    assert.equal(waiting.data.marke.qrPng, null);
    assert.equal(DB.raw.prepare("SELECT status FROM commerce_orders WHERE id='o1'").get().status, "PAID");

    const paid = await call(env, "/admin/versand/o1/qr");
    assert.equal(paid.data.marke.state, "PAYED");
    assert.equal(paid.data.marke.sendungsnummer, TRACKING);
    assert.ok(paid.data.marke.qrPng.startsWith("data:image/png;base64,iVBORw0KGgo"));
    assert.equal(paid.data.marke.bezahlLink, null);

    // Sendungsnummer am Auftrag, Auftrag und Lagerstueck gemeinsam auf "Wird gepackt".
    const shipment = DB.raw.prepare("SELECT carrier,tracking_number,status FROM shipments WHERE order_id='o1'").get();
    assert.deepEqual({ ...shipment }, { carrier: "DHL", tracking_number: TRACKING, status: "LABEL_CREATED" });
    assert.equal(DB.raw.prepare("SELECT status FROM commerce_orders WHERE id='o1'").get().status, "PREPARING");
    assert.equal(DB.raw.prepare("SELECT status FROM inventory WHERE id='inv_1'").get().status, "PREPARING");
    assert.equal(DB.raw.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE event_type='DHL_QR_MARKE_BEZAHLT'").get().n, 1);

    // Der QR wird einmal geholt und aufgehoben.
    const before = dhl.calls.length;
    const again = await call(env, "/admin/versand/o1/qr");
    assert.equal(again.data.marke.qrPng, paid.data.marke.qrPng);
    assert.equal(dhl.calls.length, before);

    const second = await call(env, "/admin/versand/o1/qr", { method: "POST", body: { produkt: "PAK02" } });
    assert.equal(second.status, 409);
    assert.equal(second.data.error, "MARKE_SCHON_BEZAHLT");
  } finally {
    dhl.restore();
  }
});

test("after handing the parcel over, the order can be marked shipped", async () => {
  const DB = seed();
  const dhl = fakeDhl({ payAfter: 0 });
  try {
    const env = envWith(DB);
    await call(env, "/admin/versand/o1/qr", { method: "POST", body: { produkt: "PAK02" } });
    await call(env, "/admin/versand/o1/qr");
  } finally {
    dhl.restore();
  }
  // Derselbe Weg wie der Knopf "Versendet" in der Admin-App: die echte
  // Statuspruefung der Datenbank muss PREPARING -> SHIPPED zulassen.
  const url = "https://api.disorder119.com/admin/orders/o1";
  const direct = await handleAdminRequest(new Request(url, {
    method: "PATCH",
    headers: { Origin: ADMIN, Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ status: "SHIPPED", trackingNumber: TRACKING, carrier: "DHL" }),
  }), { DB, ADMIN_TOKEN: TOKEN }, new URL(url), "req-ship", ADMIN);
  assert.equal(direct.status, 200, await direct.clone().text());
  assert.equal(DB.raw.prepare("SELECT status FROM commerce_orders WHERE id='o1'").get().status, "SHIPPED");
  assert.equal(DB.raw.prepare("SELECT status FROM shipments WHERE order_id='o1'").get().status, "SHIPPED");
});

test("incomplete or foreign addresses are stopped before anything is bought", async () => {
  const dhl = fakeDhl();
  try {
    const noNumber = await call(envWith(seed({ address_line1: "Musterweg" })), "/admin/versand/o1/qr", { method: "POST", body: { produkt: "PAK02" } });
    assert.equal(noNumber.status, 409);
    assert.equal(noNumber.data.error, "ADRESSE_UNVOLLSTAENDIG");
    assert.equal(noNumber.data.detail, "Hausnummer");
    assert.equal(dhl.calls.length, 0);

    const fixed = await call(envWith(seed({ address_line1: "Musterweg" })), "/admin/versand/o1/qr", {
      method: "POST", body: { produkt: "PAK02", empfaenger: { streetNumber: "7" } },
    });
    assert.equal(fixed.status, 200);

    const abroad = await call(envWith(seed({ country_code: "AT", postal_code: "1010", city: "Wien" })), "/admin/versand/o1/qr", {
      method: "POST", body: { produkt: "PAK02" },
    });
    assert.equal(abroad.data.error, "NUR_INLANDSVERSAND");
  } finally {
    dhl.restore();
  }
});

test("without a DHL key or the admin's request key nothing happens", async () => {
  const notSet = await call(envWith(seed(), { DHL_PRIVAT_API_KEY: "" }), "/admin/versand/o1/qr", { method: "POST", body: { produkt: "PAK02" } });
  assert.equal(notSet.status, 503);
  assert.equal(notSet.data.error, "DHL_QR_NICHT_EINGERICHTET");
  const stranger = await call(envWith(seed()), "/admin/versand/o1/qr", { bearer: "falsch" });
  assert.equal(stranger.status, 401);
});

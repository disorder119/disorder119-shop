import assert from "node:assert/strict";
import test from "node:test";
import shopWorker, { lieferadresseAus } from "./worker.js";
import { rabattVerteilen } from "./coupon-checkout.js";
import { formatSaleMessage } from "./notifications.js";
import { adresseCacheLeeren, handleAdresse, strassennameAus } from "./adresse.js";
import { versandCacheLeeren } from "./versand.js";
import { allMigrations, sqliteD1 } from "./test-d1.mjs";

const SHOP = "https://disorder119.com";
const SERVICES = [
  { id: 20425, name: "Paketshop S Paket", carrier_name: "DPD", price: { total_price: 5.59 }, dropoff: true, delivery_to_parcelshop: false, transit_time: "2 DAYS", category: "standard" },
  { id: 20955, name: "Classic", carrier_name: "DPD", price: { total_price: 7.85 }, dropoff: false, delivery_to_parcelshop: false, transit_time: "2 DAYS", category: "standard" },
];
const ITEMS = [
  { id: 9428, article: "9428", brand: "Jean Paul Gaultier", title: "Jean Paul Gaultier T-Shirt mit Print Damen Blau", price: 150, public_status: "AVAILABLE", taxonomy_category: "Tops", product_type: "T-Shirt" },
  { id: 9427, article: "9427", brand: "Jean Paul Gaultier", title: "Jean Paul Gaultier Jeans Damen Marineblau", price: 90, public_status: "AVAILABLE", taxonomy_category: "Pants", product_type: "Trousers" },
  { id: 6210, article: "6210", brand: "Prada", title: "Prada Sport Fleecejacke Herren Schwarz", price: 229, public_status: "SOLD", taxonomy_category: "Jackets", product_type: "Jacket" },
];
const ADRESSE = { name: "Maria Müller", strasse: "Nelseestraße", hausnummer: "25a", zusatz: "Hinterhaus", plz: "63739", ort: "Aschaffenburg", land: "DE" };

// Nachbau von GitHub (data/items.json), PayPal und Packlink.
function fakeNetz() {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    const body = typeof init.body === "string" && init.body.startsWith("{") ? JSON.parse(init.body) : null;
    calls.push({ host: u.host, path: u.pathname, method: init.method || "GET", body });
    if (u.host === "api.packlink.com" && u.pathname === "/v1/services") return Response.json(SERVICES);
    if (u.host === "api.github.com") {
      if (u.pathname.endsWith("/contents/data")) return Response.json([{ name: "items.json", type: "file", sha: "a".repeat(40) }]);
      if (u.pathname.endsWith(`/git/blobs/${"a".repeat(40)}`)) return new Response(JSON.stringify(ITEMS));
    }
    if (u.host === "api-m.sandbox.paypal.com") {
      if (u.pathname === "/v1/oauth2/token") return Response.json({ access_token: "paypal-test-token" });
      if (u.pathname === "/v2/checkout/orders") return Response.json({ id: "PAYPAL-MULTI-1", status: "CREATED" }, { status: 201 });
      if (u.pathname === "/v2/checkout/orders/PAYPAL-MULTI-1/capture") {
        return Response.json({
          id: "PAYPAL-MULTI-1", status: "COMPLETED",
          purchase_units: [{ custom_id: "9428,9427", payments: { captures: [{ id: "CAP-1", status: "COMPLETED", amount: { currency_code: "EUR", value: "245.59" } }] } }],
        });
      }
    }
    return new Response("{}", { status: 404 });
  };
  return { calls, restore() { globalThis.fetch = original; } };
}

async function post(env, path, body, key) {
  const req = new Request(`https://api.disorder119.com${path}`, {
    method: "POST",
    headers: { Origin: SHOP, "Content-Type": "application/json", "Idempotency-Key": key },
    body: JSON.stringify(body),
  });
  const res = await shopWorker.fetch(req, env);
  return { status: res.status, data: await res.json() };
}

test("delivery address: complete German addresses only, no Packstation yet", () => {
  assert.deepEqual(lieferadresseAus(ADRESSE), { ...ADRESSE });
  assert.equal(lieferadresseAus(undefined), null);
  assert.equal(lieferadresseAus({ ...ADRESSE, hausnummer: " 12 - 14 " }).hausnummer, "12-14");
  const fehler = roh => { try { lieferadresseAus(roh); return null; } catch (err) { return err.code; } };
  assert.equal(fehler({ ...ADRESSE, strasse: "Packstation 123" }), "PACKSTATION_NICHT_MOEGLICH");
  assert.equal(fehler({ ...ADRESSE, zusatz: "Postfiliale 512" }), "PACKSTATION_NICHT_MOEGLICH");
  assert.equal(fehler({ ...ADRESSE, land: "AT" }), "NUR_DEUTSCHLAND");
  assert.equal(fehler({ ...ADRESSE, plz: "6373" }), "ADRESSE_UNVOLLSTAENDIG");
  assert.equal(fehler({ ...ADRESSE, name: "Maria" }), "ADRESSE_UNVOLLSTAENDIG");
  assert.equal(fehler({ ...ADRESSE, hausnummer: "" }), "ADRESSE_UNVOLLSTAENDIG");
  assert.equal(fehler("Nelseestraße 25"), "ADRESSE_UNVOLLSTAENDIG");
});

test("checkout with two pieces: one PayPal order with the checkout address, both reserved, both sold after payment", async () => {
  versandCacheLeeren();
  const netz = fakeNetz();
  const DB = sqliteD1(allMigrations());
  const env = { DB, GITHUB_TOKEN: "gh-test", PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: "secret" };
  try {
    // Zwei Teile brauchen mindestens das mittlere Paket (Nachbau: DPD 5,59 EUR).
    const angelegt = await post(env, "/create-order",
      { itemIds: [9428, 9427], adresse: ADRESSE, versand: "pl-M-20425", versandPreisCents: 559 }, "k-kasse-00000000001");
    assert.equal(angelegt.status, 200, JSON.stringify(angelegt.data));
    assert.deepEqual(angelegt.data.itemIds, [9428, 9427]);
    assert.equal(angelegt.data.itemPrice, "240.00");
    assert.equal(angelegt.data.shipping, "5.59");
    assert.equal(angelegt.data.total, "245.59");

    const paypal = netz.calls.find(c => c.host === "api-m.sandbox.paypal.com" && c.path === "/v2/checkout/orders");
    const unit = paypal.body.purchase_units[0];
    assert.equal(unit.custom_id, "9428,9427");
    assert.match(unit.description, /^2 Teile: /);
    assert.equal(unit.amount.value, "245.59");
    assert.deepEqual(unit.shipping, {
      type: "SHIPPING",
      name: { full_name: "Maria Müller" },
      address: { address_line_1: "Nelseestraße 25a", address_line_2: "Hinterhaus", admin_area_2: "Aschaffenburg", postal_code: "63739", country_code: "DE" },
    });
    assert.equal(paypal.body.application_context.shipping_preference, "SET_PROVIDED_ADDRESS");

    const order = DB.raw.prepare("SELECT id,subtotal_cents,shipping_cents,total_cents FROM commerce_orders").get();
    assert.deepEqual({ ...order, id: undefined }, { id: undefined, subtotal_cents: 24000, shipping_cents: 559, total_cents: 24559 });
    const zeilen = DB.raw.prepare("SELECT item_id,unit_price_cents FROM order_items WHERE order_id=? ORDER BY rowid").all(order.id);
    assert.deepEqual(zeilen.map(z => [z.item_id, z.unit_price_cents]), [[9428, 15000], [9427, 9000]]);
    const reservierungen = DB.raw.prepare("SELECT idempotency_key,status FROM reservations ORDER BY idempotency_key").all();
    assert.deepEqual(reservierungen.map(r => [r.idempotency_key, r.status]), [["k-kasse-00000000001#9427", "RESERVED"], ["k-kasse-00000000001#9428", "RESERVED"]]);
    const kontakt = DB.raw.prepare("SELECT source_provider,recipient_name,address_line1,postal_code,city FROM order_contact_snapshots").get();
    assert.deepEqual({ ...kontakt }, { source_provider: "CHECKOUT", recipient_name: "Maria Müller", address_line1: "Nelseestraße 25a", postal_code: "63739", city: "Aschaffenburg" });
    assert.equal(DB.raw.prepare("SELECT paket FROM order_versand").get().paket, "M");

    // Bezahlt: beide Stuecke PAID, beide Reservierungen verbraucht. Ohne
    // GitHub-Schluessel scheitert nur der Katalog-Abgleich - je Stueck vermerkt.
    const bezahlt = await post({ ...env, GITHUB_TOKEN: "" }, "/capture-order", { orderId: "PAYPAL-MULTI-1" }, "k-zahlung-000000001");
    assert.equal(bezahlt.status, 200, JSON.stringify(bezahlt.data));
    assert.equal(DB.raw.prepare("SELECT status FROM commerce_orders").get().status, "PAID");
    assert.deepEqual(DB.raw.prepare("SELECT status FROM inventory ORDER BY item_id").all().map(r => r.status), ["PAID", "PAID"]);
    assert.deepEqual(DB.raw.prepare("SELECT status FROM reservations").all().map(r => r.status), ["CONSUMED", "CONSUMED"]);
    const sync = DB.raw.prepare("SELECT metadata_json FROM audit_events WHERE event_type='CATALOG_SYNC_FAILED'").all();
    assert.deepEqual(sync.map(r => JSON.parse(r.metadata_json).itemId).sort(), [9427, 9428]);
  } finally {
    netz.restore();
  }
});

test("checkout: a sold piece stops the whole order, nothing stays reserved", async () => {
  versandCacheLeeren();
  const netz = fakeNetz();
  const DB = sqliteD1(allMigrations());
  const env = { DB, GITHUB_TOKEN: "gh-test", PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: "secret" };
  try {
    const weg = await post(env, "/create-order", { itemIds: [9428, 6210], adresse: ADRESSE }, "k-kasse-00000000002");
    assert.equal(weg.status, 409);
    assert.equal(weg.data.error, "ITEM_UNAVAILABLE");
    assert.equal(DB.raw.prepare("SELECT COUNT(*) AS n FROM reservations WHERE status='RESERVED'").get().n, 0);

    // Schon reserviertes Stueck in einer zweiten Bestellung: die erste Reservierung wird zurueckgenommen.
    const erste = await post(env, "/create-order", { itemIds: [9427], adresse: ADRESSE, versand: "pl-M-20425", versandPreisCents: 559 }, "k-kasse-00000000003");
    assert.equal(erste.status, 200, JSON.stringify(erste.data));
    const zweite = await post(env, "/create-order", { itemIds: [9428, 9427], adresse: ADRESSE, versand: "pl-M-20425", versandPreisCents: 559 }, "k-kasse-00000000004");
    assert.equal(zweite.status, 409);
    assert.equal(zweite.data.error, "ITEM_UNAVAILABLE");
    const aktiv = DB.raw.prepare("SELECT idempotency_key FROM reservations WHERE status='RESERVED'").all();
    assert.deepEqual(aktiv.map(r => r.idempotency_key), ["k-kasse-00000000003#9427"]);

    const packstation = await post(env, "/create-order", { itemIds: [9428], adresse: { ...ADRESSE, strasse: "Packstation 101" } }, "k-kasse-00000000005");
    assert.equal(packstation.status, 422);
    assert.equal(packstation.data.error, "PACKSTATION_NICHT_MOEGLICH");
    const zuViele = await post(env, "/create-order", { itemIds: Array.from({ length: 11 }, (_, i) => 9000 + i) }, "k-kasse-00000000006");
    assert.equal(zuViele.status, 400);
  } finally {
    netz.restore();
  }
});

test("coupon discount is split across the pieces, to the cent", () => {
  assert.deepEqual(rabattVerteilen([15000, 9000], 21600), [13500, 8100]);
  const geteilt = rabattVerteilen([3333, 3333, 3334], 9001);
  assert.equal(geteilt.reduce((a, b) => a + b, 0), 9001);
  assert.deepEqual(rabattVerteilen([9000], 8100), [8100]);
});

test("sale notification lists every piece of a multi-piece order", () => {
  const text = formatSaleMessage({ order_number: "D119-1", total_cents: 24785, items: [
    { article_no: "9428", title_snapshot: "Jean Paul Gaultier T-Shirt" },
    { article_no: "9427", title_snapshot: "Jean Paul Gaultier Jeans" },
  ] });
  assert.match(text, /Teile: 2/);
  assert.match(text, /• 9428 Jean Paul Gaultier T-Shirt/);
  assert.match(text, /• 9427 Jean Paul Gaultier Jeans/);
  assert.match(formatSaleMessage({ order_number: "D119-2", article_no: "9428", title_snapshot: "Shirt", total_cents: 100 }), /Piece: Shirt/);
});

test("address suggestions: town for a postcode, streets for a prefix, strict input", async () => {
  adresseCacheLeeren();
  const anfragen = [];
  const env = {
    OPENPLZ_LADEN: async url => {
      anfragen.push(url);
      if (url.includes("/Localities?postalCode=63739")) return [{ postalCode: "63739", name: "Aschaffenburg" }];
      if (url.includes("/Streets?name=Nel")) return [{ name: "City-Tunnel" }, { name: "Nelseestr." }, { name: "Nelkenweg" }, { name: "Nelseestr." }];
      return [];
    },
  };
  const frage = async (query, origin = SHOP) => {
    const req = new Request(`https://api.disorder119.com/adresse/vorschlag${query}`, { headers: { Origin: origin } });
    const res = await handleAdresse(req, env, new URL(req.url), "req-adresse", origin);
    return { status: res.status, cors: res.headers.get("Access-Control-Allow-Origin"), data: await res.json() };
  };
  const ort = await frage("?plz=63739");
  assert.equal(ort.status, 200);
  assert.equal(ort.cors, SHOP);
  assert.deepEqual(ort.data.orte, ["Aschaffenburg"]);
  const strassen = await frage("?plz=63739&strasse=Nel");
  assert.deepEqual(strassen.data.strassen, ["Nelkenweg", "Nelseestraße", "City-Tunnel"]);
  await frage("?plz=63739");
  assert.equal(anfragen.length, 2); // zweite Ortsabfrage aus dem Zwischenspeicher
  assert.equal((await frage("?plz=6373")).status, 400);
  assert.equal((await frage("?plz=63739&strasse=%3Cscript%3E")).status, 400);
  assert.equal((await frage("?plz=63739", "https://evil.example")).status, 403);
  assert.equal(strassennameAus("Hauptstr."), "Hauptstraße");
  assert.equal(strassennameAus("Am Markt"), "Am Markt");
  assert.equal(strassennameAus("Neue Str."), "Neue Straße");
});

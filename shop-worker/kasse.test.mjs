import assert from "node:assert/strict";
import test from "node:test";
import shopWorker, { checkoutKontaktAus, lieferadresseAus } from "./worker.js";
import { rabattVerteilen } from "./coupon-checkout.js";
import { formatSaleMessage } from "./notifications.js";
import { adresseCacheLeeren, handleAdresse, strassennameAus } from "./adresse.js";
import { versandCacheLeeren } from "./versand.js";
import { snapshotPaypalOrder } from "./admin-api.js";
import { sendRequestedAccountLink } from "./customer-account.js";
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
// intent: "AUTHORIZE" (heute: nur reservieren) oder "CAPTURE" (eine
// PayPal-Bestellung aus der Zeit vor der Umstellung).
function fakeNetz({ intent = "AUTHORIZE" } = {}) {
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
      if (u.pathname === "/v2/checkout/orders/PAYPAL-MULTI-1" && !u.pathname.endsWith("/capture")) {
        return Response.json({ payer: {}, purchase_units: [{ shipping: {} }] });
      }
      if (u.pathname === "/v2/checkout/orders/PAYPAL-MULTI-1/authorize") {
        if (intent !== "AUTHORIZE") {
          return Response.json({ name: "UNPROCESSABLE_ENTITY", details: [{ issue: "ACTION_DOES_NOT_MATCH_INTENT" }] }, { status: 422 });
        }
        return Response.json({
          id: "PAYPAL-MULTI-1", status: "COMPLETED",
          purchase_units: [{ custom_id: "9428,9427", payments: { authorizations: [{
            id: "AUTH-1", status: "CREATED", amount: { currency_code: "EUR", value: "240.00" },
            create_time: "2026-09-30T10:00:00Z", expiration_time: "2026-10-29T10:00:00Z",
          }] } }],
        }, { status: 201 });
      }
      if (u.pathname === "/v2/checkout/orders/PAYPAL-MULTI-1/capture") {
        return Response.json({
          id: "PAYPAL-MULTI-1", status: "COMPLETED",
          purchase_units: [{ custom_id: "9428,9427", payments: { captures: [{ id: "CAP-1", status: "COMPLETED", amount: { currency_code: "EUR", value: "240.00" } }] } }],
        });
      }
    }
    return new Response("{}", { status: 404 });
  };
  return { calls, restore() { globalThis.fetch = original; } };
}

async function post(env, path, body, key) {
  if (path === "/create-order" && !Object.hasOwn(body, "email")) body = { ...body, email: "kundin@example.com" };
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

test("opted-in paid order keeps checkout email and sends one verified-account link", async () => {
  versandCacheLeeren();
  const netz = fakeNetz();
  const original = globalThis.fetch;
  let loginMails = 0;
  globalThis.fetch = (url, init) => {
    if (new URL(String(url)).host === "api.brevo.com") {
      loginMails++;
      return Promise.resolve(Response.json({ messageId: "test-mail" }, { status: 201 }));
    }
    return original(url, init);
  };
  const DB = sqliteD1(allMigrations());
  const env = { VERSAND_QUELLE: "packlink", DB, GITHUB_TOKEN: "gh-test", PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: "secret",
    MAIL_API_KEY: "test-key", MAIL_FROM: "shop@example.com" };
  try {
    const created = await post(env, "/create-order", { itemIds: [9428, 9427], adresse: ADRESSE,
      email: "Kundin@Example.com", createAccount: true, versand: "pl-M-20425", versandPreisCents: 0 }, "k-konto-0000000001");
    assert.equal(created.status, 200, JSON.stringify(created.data));
    const paid = await post({ ...env, GITHUB_TOKEN: "" }, "/capture-order", { orderId: created.data.id }, "k-konto-zahlung-001");
    assert.equal(paid.status, 200, JSON.stringify(paid.data));
    assert.equal(await snapshotPaypalOrder(env, created.data.id), true);
    const contact = DB.raw.prepare("SELECT email,account_requested,address_line1 FROM order_contact_snapshots WHERE order_id=?")
      .get(paid.data.orderId);
    assert.equal(contact.email, "kundin@example.com");
    assert.equal(contact.account_requested, 1);
    assert.equal(contact.address_line1, "Nelseestraße 25a");
    assert.equal(await sendRequestedAccountLink(env, paid.data.orderId), true);
    assert.equal(await sendRequestedAccountLink(env, paid.data.orderId), false);
    assert.equal(loginMails, 1);
    assert.equal(DB.raw.prepare("SELECT COUNT(*) AS n FROM customer_login_tokens").get().n, 1);
  } finally {
    netz.restore();
  }
});

test("checkout contact requires a valid email and explicit account choice", () => {
  assert.deepEqual(checkoutKontaktAus({ email: " Kundin@Example.com ", createAccount: true }),
    { email: "kundin@example.com", createAccount: true });
  assert.deepEqual(checkoutKontaktAus({ email: "kundin@example.com" }),
    { email: "kundin@example.com", createAccount: false });
  for (const email of [undefined, "", "kein-postfach", "a@b", "x@y.de\nBcc:z@y.de", "a".repeat(200) + "@b.de"]) {
    assert.throws(() => checkoutKontaktAus({ email }), { code: "EMAIL_REQUIRED" });
  }
  assert.throws(() => checkoutKontaktAus({ email: "a@b.de", createAccount: "true" }),
    { code: "ACCOUNT_CHOICE_INVALID" });
});

test("checkout with two pieces: one PayPal order with the checkout address, both reserved, both sold after payment", async () => {
  versandCacheLeeren();
  const netz = fakeNetz();
  const DB = sqliteD1(allMigrations());
  const env = { VERSAND_QUELLE: "packlink", DB, GITHUB_TOKEN: "gh-test", PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: "secret" };
  try {
    const ohneEmail = await post(env, "/create-order", { itemIds: [9428], adresse: ADRESSE, email: null }, "k-email-fehlt-000001");
    assert.equal(ohneEmail.status, 422);
    assert.equal(ohneEmail.data.error, "EMAIL_REQUIRED");
    assert.equal(DB.raw.prepare("SELECT COUNT(*) AS n FROM reservations").get().n, 0);
    const ohneAdresse = await post(env, "/create-order", { itemIds: [9428], adresse: null }, "k-adresse-fehlt-0001");
    assert.equal(ohneAdresse.status, 422);
    assert.equal(ohneAdresse.data.error, "ADRESSE_UNVOLLSTAENDIG");
    assert.equal(DB.raw.prepare("SELECT COUNT(*) AS n FROM reservations").get().n, 0);
    // Zwei Teile brauchen mindestens das mittlere Paket (Nachbau: DPD 5,59
    // EUR). Ab 99 EUR Warenwert uebernimmt der Shop den guenstigsten Standard.
    const angelegt = await post(env, "/create-order",
      { itemIds: [9428, 9427], adresse: ADRESSE, versand: "pl-M-20425", versandPreisCents: 0 }, "k-kasse-00000000001");
    assert.equal(angelegt.status, 200, JSON.stringify(angelegt.data));
    assert.deepEqual(angelegt.data.itemIds, [9428, 9427]);
    assert.equal(angelegt.data.itemPrice, "240.00");
    assert.equal(angelegt.data.shipping, "0.00");
    assert.equal(angelegt.data.total, "240.00");

    const paypal = netz.calls.find(c => c.host === "api-m.sandbox.paypal.com" && c.path === "/v2/checkout/orders");
    const unit = paypal.body.purchase_units[0];
    assert.equal(unit.custom_id, "9428,9427");
    assert.match(unit.description, /^2 Teile: /);
    assert.equal(unit.amount.value, "240.00");
    assert.deepEqual(unit.shipping, {
      type: "SHIPPING",
      name: { full_name: "Maria Müller" },
      address: { address_line_1: "Nelseestraße 25a", address_line_2: "Hinterhaus", admin_area_2: "Aschaffenburg", postal_code: "63739", country_code: "DE" },
    });
    assert.equal(paypal.body.application_context.shipping_preference, "SET_PROVIDED_ADDRESS");
    // Nur reservieren - eingezogen wird erst beim Versand.
    assert.equal(paypal.body.intent, "AUTHORIZE");

    const order = DB.raw.prepare("SELECT id,subtotal_cents,shipping_cents,total_cents FROM commerce_orders").get();
    assert.deepEqual({ ...order, id: undefined }, { id: undefined, subtotal_cents: 24000, shipping_cents: 0, total_cents: 24000 });
    const zeilen = DB.raw.prepare("SELECT item_id,unit_price_cents FROM order_items WHERE order_id=? ORDER BY rowid").all(order.id);
    assert.deepEqual(zeilen.map(z => [z.item_id, z.unit_price_cents]), [[9428, 15000], [9427, 9000]]);
    const reservierungen = DB.raw.prepare("SELECT idempotency_key,status FROM reservations ORDER BY idempotency_key").all();
    assert.deepEqual(reservierungen.map(r => [r.idempotency_key, r.status]), [["k-kasse-00000000001#9427", "RESERVED"], ["k-kasse-00000000001#9428", "RESERVED"]]);
    const kontakt = DB.raw.prepare("SELECT source_provider,email,account_requested,recipient_name,address_line1,postal_code,city FROM order_contact_snapshots").get();
    assert.deepEqual({ ...kontakt }, { source_provider: "CHECKOUT", email: "kundin@example.com", account_requested: 0,
      recipient_name: "Maria Müller", address_line1: "Nelseestraße 25a", postal_code: "63739", city: "Aschaffenburg" });
    assert.equal(DB.raw.prepare("SELECT paket FROM order_versand").get().paket, "M");

    // Bezahlt: beide Stuecke PAID, beide Reservierungen verbraucht. Ohne
    // GitHub-Schluessel scheitert nur der Katalog-Abgleich - je Stueck vermerkt.
    const bezahlt = await post({ ...env, GITHUB_TOKEN: "" }, "/capture-order", { orderId: "PAYPAL-MULTI-1" }, "k-zahlung-000000001");
    assert.equal(bezahlt.status, 200, JSON.stringify(bezahlt.data));
    assert.equal(bezahlt.data.zahlung, "RESERVIERT");
    assert.equal(DB.raw.prepare("SELECT status FROM commerce_orders").get().status, "PAID");
    // PayPal hat reserviert, nichts eingezogen: keine Capture, kein Steuerbeleg,
    // spaetestens 66 Stunden nach der Reservierung zieht der Shop ein.
    const zahlung = DB.raw.prepare("SELECT status,authorization_id,provider_payment_id,capture_due_at,authorization_expires_at FROM payments").get();
    assert.deepEqual({ ...zahlung }, {
      status: "AUTHORIZED", authorization_id: "AUTH-1", provider_payment_id: null,
      capture_due_at: "2026-10-03T04:00:00.000Z", authorization_expires_at: "2026-10-29T10:00:00.000Z",
    });
    assert.equal(DB.raw.prepare("SELECT COUNT(*) AS n FROM tax_cash_events").get().n, 0);
    assert.ok(netz.calls.some(c => c.path === "/v2/checkout/orders/PAYPAL-MULTI-1/authorize"));
    assert.ok(!netz.calls.some(c => c.path === "/v2/checkout/orders/PAYPAL-MULTI-1/capture"));
    assert.deepEqual(DB.raw.prepare("SELECT status FROM inventory ORDER BY item_id").all().map(r => r.status), ["PAID", "PAID"]);
    assert.deepEqual(DB.raw.prepare("SELECT status FROM reservations").all().map(r => r.status), ["CONSUMED", "CONSUMED"]);
    const sync = DB.raw.prepare("SELECT metadata_json FROM audit_events WHERE event_type='CATALOG_SYNC_FAILED'").all();
    assert.deepEqual(sync.map(r => JSON.parse(r.metadata_json).itemId).sort(), [9427, 9428]);
  } finally {
    netz.restore();
  }
});

test("a PayPal order created before the switch (intent CAPTURE) is still captured at once", async () => {
  versandCacheLeeren();
  const netz = fakeNetz({ intent: "CAPTURE" });
  const DB = sqliteD1(allMigrations());
  const env = { VERSAND_QUELLE: "packlink", DB, GITHUB_TOKEN: "gh-test", PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: "secret" };
  try {
    const angelegt = await post(env, "/create-order",
      { itemIds: [9428, 9427], adresse: ADRESSE, versand: "pl-M-20425", versandPreisCents: 0 }, "k-kasse-alt-0000001");
    assert.equal(angelegt.status, 200, JSON.stringify(angelegt.data));
    const bezahlt = await post({ ...env, GITHUB_TOKEN: "" }, "/capture-order", { orderId: "PAYPAL-MULTI-1" }, "k-zahlung-alt-00001");
    assert.equal(bezahlt.status, 200, JSON.stringify(bezahlt.data));
    assert.equal(bezahlt.data.zahlung, "EINGEZOGEN");
    const zahlung = DB.raw.prepare("SELECT status,provider_payment_id,authorization_id FROM payments").get();
    assert.deepEqual({ ...zahlung }, { status: "COMPLETED", provider_payment_id: "CAP-1", authorization_id: null });
    assert.equal(DB.raw.prepare("SELECT status FROM commerce_orders").get().status, "PAID");
    const capture = netz.calls.find(c => c.path === "/v2/checkout/orders/PAYPAL-MULTI-1/capture");
    assert.ok(capture, "Fallback auf das sofortige Einziehen");
  } finally {
    netz.restore();
  }
});

test("checkout: a sold piece stops the whole order, nothing stays reserved", async () => {
  versandCacheLeeren();
  const netz = fakeNetz();
  const DB = sqliteD1(allMigrations());
  const env = { VERSAND_QUELLE: "packlink", DB, GITHUB_TOKEN: "gh-test", PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: "secret" };
  try {
    const weg = await post(env, "/create-order", { itemIds: [9428, 6210], adresse: ADRESSE }, "k-kasse-00000000002");
    assert.equal(weg.status, 409);
    assert.equal(weg.data.error, "ITEM_UNAVAILABLE");
    assert.equal(DB.raw.prepare("SELECT COUNT(*) AS n FROM reservations WHERE status='RESERVED'").get().n, 0);

    // Schon reserviertes Stueck in einer zweiten Bestellung: die erste Reservierung wird zurueckgenommen.
    const erste = await post(env, "/create-order", { itemIds: [9427], adresse: ADRESSE, versand: "pl-M-20425", versandPreisCents: 559 }, "k-kasse-00000000003");
    assert.equal(erste.status, 200, JSON.stringify(erste.data));
    const zweite = await post(env, "/create-order", { itemIds: [9428, 9427], adresse: ADRESSE, versand: "pl-M-20425", versandPreisCents: 0 }, "k-kasse-00000000004");
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

test("create-order: DHL an Packstation zu festen Preisen, DPD nur an die Haustuer", async () => {
  versandCacheLeeren();
  const netz = fakeNetz();
  const DB = sqliteD1(allMigrations());
  const env = { DB, GITHUB_TOKEN: "gh-test", PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: "secret" };
  const packstation = { art: "packstation", postnummer: "12345678",
    abholort: { nummer: "162", name: "Packstation 162", strasse: "Hanauer Str. 2", plz: "63739", ort: "Aschaffenburg" } };
  try {
    // DPD stellt nicht an Packstationen zu.
    const dpd = await post(env, "/create-order",
      { itemIds: [9427], adresse: { name: "Maria Müller" }, zustellung: packstation, versand: "fest-dpd-M", versandPreisCents: 578 }, "k-privat-00000000001");
    assert.equal(dpd.status, 422);
    assert.equal(dpd.data.error, "ABHOLSTATION_NUR_DHL");
    const ohnePostnummer = await post(env, "/create-order",
      { itemIds: [9427], adresse: { name: "Maria Müller" }, zustellung: { ...packstation, postnummer: "" }, versand: "fest-dhl-M", versandPreisCents: 619 }, "k-privat-00000000002");
    assert.equal(ohnePostnummer.data.error, "POSTNUMMER_FEHLT");
    assert.equal(DB.raw.prepare("SELECT COUNT(*) AS n FROM reservations").get().n, 0);

    const angelegt = await post(env, "/create-order",
      { itemIds: [9427], adresse: { name: "Maria Müller" }, zustellung: packstation, versand: "fest-dhl-M", versandPreisCents: 619 }, "k-privat-00000000003");
    assert.equal(angelegt.status, 200, JSON.stringify(angelegt.data));
    assert.equal(angelegt.data.shipping, "6.19");
    assert.equal(angelegt.data.total, "96.19");
    assert.equal(angelegt.data.versand.carrier, "DHL");
    const paypal = netz.calls.find(c => c.host === "api-m.sandbox.paypal.com" && c.path === "/v2/checkout/orders");
    assert.deepEqual(paypal.body.purchase_units[0].shipping.address, {
      address_line_1: "Packstation 162", address_line_2: "Postnummer 12345678", admin_area_2: "Aschaffenburg", postal_code: "63739", country_code: "DE",
    });
    assert.equal(netz.calls.filter(c => c.host === "api.packlink.com").length, 0, "feste Preise ohne Packlink");
    const wahl = DB.raw.prepare("SELECT quelle,carrier,paket,preis_cents,zustellart,abholort_json FROM order_versand").get();
    assert.deepEqual({ ...wahl, abholort_json: JSON.parse(wahl.abholort_json) }, {
      quelle: "fest", carrier: "DHL", paket: "M", preis_cents: 619, zustellart: "packstation",
      abholort_json: { typ: "packstation", nummer: "162", name: "Packstation 162", strasse: "Hanauer Str. 2", plz: "63739", ort: "Aschaffenburg" },
    });
    const kontakt = DB.raw.prepare("SELECT recipient_name,address_line1,address_line2,postal_code,city FROM order_contact_snapshots").get();
    assert.deepEqual({ ...kontakt }, { recipient_name: "Maria Müller", address_line1: "Packstation 162", address_line2: "Postnummer 12345678", postal_code: "63739", city: "Aschaffenburg" });

    // Haustuer mit DPD wie bisher (eigene Datenbank: der PayPal-Nachbau
    // vergibt immer dieselbe Bestellnummer).
    const haustuer = await post({ ...env, DB: sqliteD1(allMigrations()) }, "/create-order",
      { itemIds: [9428], adresse: ADRESSE, versand: "fest-dpd-S", versandPreisCents: 0 }, "k-privat-00000000004");
    assert.equal(haustuer.status, 200, JSON.stringify(haustuer.data));
    assert.equal(haustuer.data.shipping, "0.00", "ab 99 EUR uebernimmt der Shop den guenstigsten Versand");
  } finally {
    netz.restore();
  }
});

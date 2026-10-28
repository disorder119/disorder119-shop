import assert from "node:assert/strict";
import test from "node:test";
import shopWorker, { checkoutKontaktAus, lieferadresseAus } from "./worker.js";
import { rabattVerteilen } from "./coupon-checkout.js";
import { formatSaleMessage } from "./notifications.js";
import { adresseCacheLeeren, handleAdresse, strassennameAus } from "./adresse.js";
import { versandCacheLeeren } from "./versand.js";
import { snapshotPaypalOrder } from "./admin-api.js";
import { sendRequestedAccountLink } from "./customer-account.js";
import { handleRentalBundle } from "./rental-bundle.js";
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
  // Nie freigegebener Entwurf mit Preis (wie 9427 in data/items.json) und ein
  // Stueck ohne Status: beide nicht kaufbar und nicht mietbar.
  { id: 9426, article: "72", brand: "Jean Paul Gaultier", title: "Jean Paul Gaultier Jeans Damen Marineblau", price: 75, public_status: "DRAFT", taxonomy_category: "Pants", product_type: "Trousers" },
  { id: 9425, article: "71", brand: "Jean Paul Gaultier", title: "Jean Paul Gaultier Rock Damen Schwarz", price: 60, taxonomy_category: "Skirts", product_type: "Skirt" },
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

test("delivery address: complete addresses in Germany and the EU, no Packstation in the street", () => {
  assert.deepEqual(lieferadresseAus(ADRESSE), { ...ADRESSE });
  assert.equal(lieferadresseAus(undefined), null);
  assert.equal(lieferadresseAus({ ...ADRESSE, hausnummer: " 12 - 14 " }).hausnummer, "12-14");
  const fehler = roh => { try { lieferadresseAus(roh); return null; } catch (err) { return err.code; } };
  assert.equal(fehler({ ...ADRESSE, strasse: "Packstation 123" }), "PACKSTATION_NICHT_MOEGLICH");
  assert.equal(fehler({ ...ADRESSE, zusatz: "Postfiliale 512" }), "PACKSTATION_NICHT_MOEGLICH");
  // Seit 28.10.2026: EU-Laender ueber die Kasse, alles andere auf Anfrage.
  assert.equal(fehler({ ...ADRESSE, land: "CH", plz: "8001" }), "LAND_NICHT_BELIEFERT");
  assert.equal(fehler({ ...ADRESSE, land: "US", plz: "10001" }), "LAND_NICHT_BELIEFERT");
  assert.equal(fehler({ ...ADRESSE, land: "AT" }), "ADRESSE_UNVOLLSTAENDIG", "AT hat vierstellige PLZ");
  assert.equal(lieferadresseAus({ ...ADRESSE, land: "AT", plz: "1010", ort: "Wien" }).plz, "1010");
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
      email: "Kundin@Example.com", createAccount: true, versand: "pl-S-20425", versandPreisCents: 0 }, "k-konto-0000000001");
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
      { itemIds: [9428, 9427], adresse: ADRESSE, versand: "pl-S-20425", versandPreisCents: 0 }, "k-kasse-00000000001");
    assert.equal(angelegt.status, 200, JSON.stringify(angelegt.data));
    assert.deepEqual(angelegt.data.itemIds, [9428, 9427]);
    assert.equal(angelegt.data.itemPrice, "240.00");
    assert.equal(angelegt.data.shipping, "0.00");
    assert.equal(angelegt.data.total, "240.00");

    const paypal = netz.calls.find(c => c.host === "api-m.sandbox.paypal.com" && c.path === "/v2/checkout/orders");
    const unit = paypal.body.purchase_units[0];
    assert.equal(unit.custom_id, "9428,9427");
    // Die Marke steht schon im Titel - kein "Jean Paul Gaultier Jean Paul Gaultier ...".
    assert.equal(unit.description, "2 Teile: Jean Paul Gaultier T-Shirt mit Print Damen Blau, Jean Paul Gaultier Jeans Damen Marineblau");
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
    const zeilen = DB.raw.prepare("SELECT item_id,unit_price_cents,title_snapshot FROM order_items WHERE order_id=? ORDER BY rowid").all(order.id);
    assert.deepEqual(zeilen.map(z => [z.item_id, z.unit_price_cents]), [[9428, 15000], [9427, 9000]]);
    // Der Name landet unveraenderlich in Rechnung, Mails und Steuerexport.
    assert.deepEqual(zeilen.map(z => z.title_snapshot), ["Jean Paul Gaultier T-Shirt mit Print Damen Blau", "Jean Paul Gaultier Jeans Damen Marineblau"]);
    const reservierungen = DB.raw.prepare("SELECT idempotency_key,status FROM reservations ORDER BY idempotency_key").all();
    assert.deepEqual(reservierungen.map(r => [r.idempotency_key, r.status]), [["k-kasse-00000000001#9427", "RESERVED"], ["k-kasse-00000000001#9428", "RESERVED"]]);
    const kontakt = DB.raw.prepare("SELECT source_provider,email,account_requested,recipient_name,address_line1,postal_code,city FROM order_contact_snapshots").get();
    assert.deepEqual({ ...kontakt }, { source_provider: "CHECKOUT", email: "kundin@example.com", account_requested: 0,
      recipient_name: "Maria Müller", address_line1: "Nelseestraße 25a", postal_code: "63739", city: "Aschaffenburg" });
    assert.equal(DB.raw.prepare("SELECT paket FROM order_versand").get().paket, "S"); // T-Shirt und Jeans: 1,45 kg

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
      { itemIds: [9428, 9427], adresse: ADRESSE, versand: "pl-S-20425", versandPreisCents: 0 }, "k-kasse-alt-0000001");
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
    const erste = await post(env, "/create-order", { itemIds: [9427], adresse: ADRESSE, versand: "pl-S-20425", versandPreisCents: 559 }, "k-kasse-00000000003");
    assert.equal(erste.status, 200, JSON.stringify(erste.data));
    const zweite = await post(env, "/create-order", { itemIds: [9428, 9427], adresse: ADRESSE, versand: "pl-S-20425", versandPreisCents: 0 }, "k-kasse-00000000004");
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

test("create-order: nur DHL zu festen Preisen, auch an Packstation; Hoeherversicherung erst ueber 500 EUR", async () => {
  versandCacheLeeren();
  const netz = fakeNetz();
  const DB = sqliteD1(allMigrations());
  const env = { DB, GITHUB_TOKEN: "gh-test", PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: "secret" };
  const packstation = { art: "packstation", postnummer: "12345678",
    abholort: { nummer: "162", name: "Packstation 162", strasse: "Hanauer Str. 2", plz: "63739", ort: "Aschaffenburg" } };
  try {
    // DPD gibt es nicht mehr; die Hoeherversicherung erst ueber 500 EUR (Jeans: 90 EUR).
    const dpd = await post(env, "/create-order",
      { itemIds: [9427], adresse: { name: "Maria Müller" }, zustellung: packstation, versand: "fest-dpd-S", versandPreisCents: 409 }, "k-privat-00000000001");
    assert.equal(dpd.status, 409);
    assert.equal(dpd.data.error, "VERSAND_OPTION_UNGUELTIG");
    assert.deepEqual(dpd.data.versand.optionen.map(o => [o.id, o.preisCents]), [["fest-dhl-S", 619]]);
    const versichert = await post(env, "/create-order",
      { itemIds: [9427], adresse: ADRESSE, versand: "fest-dhl-versichert-S", versandPreisCents: 1318 }, "k-privat-00000000005");
    assert.equal(versichert.data.error, "VERSAND_OPTION_UNGUELTIG");
    const ohnePostnummer = await post(env, "/create-order",
      { itemIds: [9427], adresse: { name: "Maria Müller" }, zustellung: { ...packstation, postnummer: "" }, versand: "fest-dhl-S", versandPreisCents: 619 }, "k-privat-00000000002");
    assert.equal(ohnePostnummer.data.error, "POSTNUMMER_FEHLT");
    assert.equal(DB.raw.prepare("SELECT COUNT(*) AS n FROM reservations").get().n, 0);

    const angelegt = await post(env, "/create-order",
      { itemIds: [9427], adresse: { name: "Maria Müller" }, zustellung: packstation, versand: "fest-dhl-S", versandPreisCents: 619 }, "k-privat-00000000003");
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
      quelle: "fest", carrier: "DHL", paket: "S", preis_cents: 619, zustellart: "packstation",
      abholort_json: { typ: "packstation", nummer: "162", name: "Packstation 162", strasse: "Hanauer Str. 2", plz: "63739", ort: "Aschaffenburg" },
    });
    const kontakt = DB.raw.prepare("SELECT recipient_name,address_line1,address_line2,postal_code,city FROM order_contact_snapshots").get();
    assert.deepEqual({ ...kontakt }, { recipient_name: "Maria Müller", address_line1: "Packstation 162", address_line2: "Postnummer 12345678", postal_code: "63739", city: "Aschaffenburg" });

    // Haustuer (eigene Datenbank: der PayPal-Nachbau vergibt immer dieselbe Bestellnummer).
    const haustuer = await post({ ...env, DB: sqliteD1(allMigrations()) }, "/create-order",
      { itemIds: [9428], adresse: ADRESSE, versand: "fest-dhl-S", versandPreisCents: 0 }, "k-privat-00000000004");
    assert.equal(haustuer.status, 200, JSON.stringify(haustuer.data));
    assert.equal(haustuer.data.shipping, "0.00", "ab 99 EUR uebernimmt der Shop den guenstigsten Versand");
  } finally {
    netz.restore();
  }
});

test("checkout sells only AVAILABLE pieces: a priced DRAFT or a piece without status is refused, nothing reserved", async () => {
  versandCacheLeeren();
  const netz = fakeNetz();
  const DB = sqliteD1(allMigrations());
  const env = { VERSAND_QUELLE: "packlink", DB, GITHUB_TOKEN: "gh-test", PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: "secret" };
  try {
    const entwurf = await post(env, "/create-order", { itemIds: [9426], adresse: ADRESSE, versand: "pl-S-20425", versandPreisCents: 559 }, "k-entwurf-00000000001");
    assert.equal(entwurf.status, 409, JSON.stringify(entwurf.data));
    assert.equal(entwurf.data.error, "ITEM_UNAVAILABLE");
    const ohneStatus = await post(env, "/create-order", { itemIds: [9425], adresse: ADRESSE, versand: "pl-S-20425", versandPreisCents: 559 }, "k-entwurf-00000000002");
    assert.equal(ohneStatus.status, 409, JSON.stringify(ohneStatus.data));
    assert.equal(ohneStatus.data.error, "ITEM_UNAVAILABLE");
    const gemischt = await post(env, "/create-order", { itemIds: [9428, 9426], adresse: ADRESSE, versand: "pl-S-20425", versandPreisCents: 0 }, "k-entwurf-00000000003");
    assert.equal(gemischt.status, 409, JSON.stringify(gemischt.data));
    assert.equal(gemischt.data.error, "ITEM_UNAVAILABLE");
    assert.equal(DB.raw.prepare("SELECT COUNT(*) AS n FROM reservations").get().n, 0);
    assert.equal(DB.raw.prepare("SELECT COUNT(*) AS n FROM commerce_orders").get().n, 0);
    assert.equal(netz.calls.filter(c => c.host === "api-m.sandbox.paypal.com").length, 0, "keine PayPal-Bestellung");
  } finally {
    netz.restore();
  }
});

test("rental: a DRAFT can be neither quoted, requested nor booked in a bundle", async () => {
  const netz = fakeNetz();
  const DB = sqliteD1(allMigrations());
  const env = { DB, GITHUB_TOKEN: "gh-test" };
  const tag = n => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
  const start = tag(10);
  const end = tag(12);
  try {
    const verfuegbar = await post(env, "/rental-quote", { itemId: 9428, start, end }, "k-miete-angebot-0001");
    assert.equal(verfuegbar.status, 200, JSON.stringify(verfuegbar.data));
    const angebot = await post(env, "/rental-quote", { itemId: 9426, start, end }, "k-miete-angebot-0002");
    assert.equal(angebot.status, 409, JSON.stringify(angebot.data));
    assert.equal(angebot.data.error, "ITEM_UNAVAILABLE");
    const anfrage = await post(env, "/rental-request", { itemId: 9426, start, end }, "k-miete-anfrage-00001");
    assert.equal(anfrage.status, 409, JSON.stringify(anfrage.data));
    assert.equal(anfrage.data.error, "ITEM_UNAVAILABLE");
    const res = await handleRentalBundle(new Request("https://api.disorder119.com/rental-bundle", {
      method: "POST",
      headers: { Origin: SHOP, "Content-Type": "application/json", "Idempotency-Key": "k-miete-paket-000001" },
      body: JSON.stringify({ itemIds: [9426], start, end, termsVersion: "2026-09", termsAcceptedAt: new Date().toISOString() }),
    }), env, new URL("https://api.disorder119.com/rental-bundle"), "req-miete-paket", SHOP);
    const paket = await res.json();
    assert.equal(res.status, 409, JSON.stringify(paket));
    assert.equal(paket.error, "ITEM_UNAVAILABLE");
    assert.equal(DB.raw.prepare("SELECT COUNT(*) AS n FROM rental_reservations").get().n, 0);
    assert.equal(DB.raw.prepare("SELECT COUNT(*) AS n FROM rental_groups").get().n, 0);
  } finally {
    netz.restore();
  }
});

// ------------------------------------------------- Grenzen gegen Missbrauch

import { angebotKatalogLeeren, OFFENE_BESTELLUNGEN_JE_ANSCHLUSS, OFFENE_BESTELLUNGEN_JE_MAIL } from "./worker.js";
import { HALT_FENSTER_MS, MIETE_JE_ANSCHLUSS, MIN_WARTEN_SEKUNDEN } from "./offene-halte.js";

// Katalog mit zwoelf freien Stuecken und eine PayPal-Attrappe, die je
// Bestellung eine eigene Nummer vergibt.
const VIELE = Array.from({ length: 12 }, (_, i) => 9501 + i);
function fakeNetzViele() {
  const stuecke = VIELE.map(id => ({ id, article: String(id), brand: "Test", title: `Test Shirt ${id}`,
    price: 40, public_status: "AVAILABLE", taxonomy_category: "Tops", product_type: "T-Shirt" }));
  const calls = [];
  let nummer = 0;
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    calls.push({ host: u.host, path: u.pathname, method: init.method || "GET" });
    if (u.host === "api.github.com") {
      if (u.pathname.endsWith("/contents/data")) return Response.json([{ name: "items.json", type: "file", sha: "c".repeat(40) }]);
      if (u.pathname.endsWith(`/git/blobs/${"c".repeat(40)}`)) return new Response(JSON.stringify(stuecke));
    }
    if (u.host === "api-m.sandbox.paypal.com" || u.host === "api-m.paypal.com") {
      if (u.pathname === "/v1/oauth2/token") return Response.json({ access_token: "paypal-test-token" });
      if (u.pathname === "/v2/checkout/orders") return Response.json({ id: `PAYPAL-OFFEN-${++nummer}`, status: "CREATED" }, { status: 201 });
    }
    return new Response("{}", { status: 404 });
  };
  return { calls, restore() { globalThis.fetch = original; } };
}

async function bestellen(env, itemId, { email = "kundin@example.com", ip = null, key }) {
  const headers = { Origin: SHOP, "Content-Type": "application/json", "Idempotency-Key": key };
  if (ip) headers["CF-Connecting-IP"] = ip;
  const req = new Request("https://api.disorder119.com/create-order", {
    method: "POST",
    headers,
    body: JSON.stringify({ itemIds: [itemId], adresse: ADRESSE, email, versand: "fest-dhl-S", versandPreisCents: 619 }),
  });
  const res = await shopWorker.fetch(req, env);
  return { status: res.status, data: await res.json(), retryAfter: res.headers.get("Retry-After") };
}

// Retry-After: bis der erste offene Halt frei wird (Reservierung 15 Minuten),
// mindestens eine Minute, hoechstens das Zaehlfenster.
function pruefeWarten(antwort) {
  const sekunden = Number(antwort.retryAfter);
  assert.ok(Number.isInteger(sekunden), `Retry-After fehlt: ${antwort.retryAfter}`);
  assert.ok(sekunden >= MIN_WARTEN_SEKUNDEN && sekunden <= HALT_FENSTER_MS / 1000, String(sekunden));
  assert.equal(antwort.data.retryAfter, sekunden);
  return sekunden;
}

test("checkout: at most two open unpaid orders per e-mail address; expired reservations do not count", async () => {
  versandCacheLeeren();
  const netz = fakeNetzViele();
  const DB = sqliteD1(allMigrations());
  const env = { DB, GITHUB_TOKEN: "gh-test", PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: "secret" };
  try {
    for (let i = 0; i < OFFENE_BESTELLUNGEN_JE_MAIL; i++) {
      const ok = await bestellen(env, 9501 + i, { email: "Viel@Example.com", key: `k-offen-mail-000${i}` });
      assert.equal(ok.status, 200, JSON.stringify(ok.data));
    }
    const dritte = await bestellen(env, 9503, { email: "viel@example.com", key: "k-offen-mail-0009" });
    assert.equal(dritte.status, 429);
    assert.equal(dritte.data.error, "TOO_MANY_OPEN_ORDERS");
    assert.equal(dritte.data.reason, "EMAIL", "die eigene Adresse, nicht der Anschluss");
    const warten = pruefeWarten(dritte);
    assert.ok(warten > 14 * 60, `erste Reservierung haelt noch knapp 15 Minuten: ${warten}`);
    assert.equal(DB.raw.prepare("SELECT COUNT(*) AS n FROM commerce_orders").get().n, OFFENE_BESTELLUNGEN_JE_MAIL);
    assert.equal(DB.raw.prepare("SELECT COUNT(*) AS n FROM reservations WHERE status='RESERVED'").get().n, OFFENE_BESTELLUNGEN_JE_MAIL, "nichts zusaetzlich reserviert");
    // Eine andere Adresse bestellt ganz normal.
    assert.equal((await bestellen(env, 9503, { email: "andere@example.com", key: "k-offen-mail-0010" })).status, 200);
    // Abgelaufene Reservierungen zaehlen nicht mehr.
    DB.raw.prepare("UPDATE reservations SET expires_at=? WHERE idempotency_key LIKE 'k-offen-mail-000%'").run(new Date(Date.now() - 1000).toISOString());
    const spaeter = await bestellen(env, 9504, { email: "viel@example.com", key: "k-offen-mail-0011" });
    assert.equal(spaeter.status, 200, JSON.stringify(spaeter.data));
  } finally {
    netz.restore();
  }
});

test("checkout: at most five open unpaid orders per connection (IPv6 per /64), whatever the e-mail", async () => {
  versandCacheLeeren();
  const netz = fakeNetzViele();
  const DB = sqliteD1(allMigrations());
  const env = { DB, GITHUB_TOKEN: "gh-test", PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: "secret" };
  try {
    assert.equal(OFFENE_BESTELLUNGEN_JE_ANSCHLUSS, 5);
    for (let i = 0; i < OFFENE_BESTELLUNGEN_JE_ANSCHLUSS; i++) {
      const ok = await bestellen(env, 9501 + i, { email: `person${i}@example.com`, ip: `2001:db8:aa:bb::${i + 1}`, key: `k-offen-netz-000${i}` });
      assert.equal(ok.status, 200, JSON.stringify(ok.data));
    }
    const sechste = await bestellen(env, 9507, { email: "person9@example.com", ip: "2001:db8:aa:bb:1:2:3:4", key: "k-offen-netz-0009" });
    assert.equal(sechste.status, 429);
    assert.equal(sechste.data.error, "TOO_MANY_OPEN_ORDERS");
    assert.equal(sechste.data.reason, "NETWORK", "Fremde im selben Netz - nicht die eigene Adresse");
    pruefeWarten(sechste);
    // Gespeichert ist nur der Hash des Anschlusses, nie die Adresse selbst.
    const marker = DB.raw.prepare("SELECT entity_id,actor_ref FROM audit_events WHERE entity_type='kontingent:halt-kasse'").all();
    assert.equal(marker.length, OFFENE_BESTELLUNGEN_JE_ANSCHLUSS);
    assert.ok(marker.every(m => /^[0-9a-f]{64}$/.test(m.entity_id) && m.actor_ref));
    const protokoll = JSON.stringify(DB.raw.prepare("SELECT * FROM audit_events").all());
    assert.ok(!protokoll.includes("2001:db8"));
    assert.ok(!protokoll.includes("person0@example.com"), "auch die E-Mail-Adresse nur als Hash");
    // Ein anderer Anschluss bestellt ganz normal.
    assert.equal((await bestellen(env, 9507, { email: "person9@example.com", ip: "198.51.100.44", key: "k-offen-netz-0010" })).status, 200);
    // Bezahlt oder abgebrochen ist nicht mehr offen.
    DB.raw.prepare("UPDATE commerce_orders SET status='CANCELLED' WHERE idempotency_key='k-offen-netz-0000'").run();
    const wieder = await bestellen(env, 9508, { email: "person9@example.com", ip: "2001:db8:aa:bb::99", key: "k-offen-netz-0011" });
    assert.equal(wieder.status, 200, JSON.stringify(wieder.data));
  } finally {
    netz.restore();
  }
});

test("checkout: after a 429 the same idempotency key may try again (claim released)", async () => {
  versandCacheLeeren();
  const netz = fakeNetzViele();
  const DB = sqliteD1(allMigrations());
  const env = { DB, GITHUB_TOKEN: "gh-test", PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: "secret" };
  try {
    for (let i = 0; i < OFFENE_BESTELLUNGEN_JE_MAIL; i++) {
      assert.equal((await bestellen(env, 9501 + i, { email: "wieder@example.com", key: `k-claim-0000000${i}` })).status, 200);
    }
    const voll = await bestellen(env, 9505, { email: "wieder@example.com", key: "k-claim-wiederholt" });
    assert.equal(voll.status, 429);
    assert.equal(DB.raw.prepare("SELECT COUNT(*) AS n FROM idempotency_keys WHERE scope='create-order' AND idempotency_key='k-claim-wiederholt'").get().n, 0, "Claim frei");
    // Noch voll: wieder 429 - nicht IDEMPOTENT_REQUEST_IN_PROGRESS.
    const nochmal = await bestellen(env, 9505, { email: "wieder@example.com", key: "k-claim-wiederholt" });
    assert.equal(nochmal.status, 429);
    assert.equal(nochmal.data.error, "TOO_MANY_OPEN_ORDERS");
    // Eine Bestellung abgebrochen: derselbe Schluessel geht jetzt durch.
    DB.raw.prepare("UPDATE commerce_orders SET status='CANCELLED' WHERE idempotency_key='k-claim-00000000'").run();
    const durch = await bestellen(env, 9505, { email: "wieder@example.com", key: "k-claim-wiederholt" });
    assert.equal(durch.status, 200, JSON.stringify(durch.data));
  } finally {
    netz.restore();
  }
});

test("checkout and rental: without IP pepper in live mode the open-hold limit fails closed (503, nothing reserved)", async () => {
  versandCacheLeeren();
  angebotKatalogLeeren();
  const netz = fakeNetzViele();
  const DB = sqliteD1(allMigrations());
  const env = { DB, GITHUB_TOKEN: "gh-test", PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: "secret", PAYPAL_ENVIRONMENT: "live" };
  const tag = n => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
  try {
    const kauf = await bestellen(env, 9501, { ip: "203.0.113.5", key: "k-ohne-pepper-0001" });
    assert.equal(kauf.status, 503, JSON.stringify(kauf.data));
    assert.equal(kauf.data.error, "IP_PRIVACY_NOT_CONFIGURED");
    const miete = await shopWorker.fetch(new Request("https://api.disorder119.com/rental-request", {
      method: "POST",
      headers: { Origin: SHOP, "Content-Type": "application/json", "Idempotency-Key": "k-ohne-pepper-0002", "CF-Connecting-IP": "203.0.113.5" },
      body: JSON.stringify({ itemId: 9502, start: tag(10), end: tag(12) }),
    }), env);
    assert.equal(miete.status, 503);
    assert.equal((await miete.json()).error, "IP_PRIVACY_NOT_CONFIGURED");
    const paket = await handleRentalBundle(new Request("https://api.disorder119.com/rental-bundle", {
      method: "POST",
      headers: { Origin: SHOP, "Content-Type": "application/json", "Idempotency-Key": "k-ohne-pepper-0003", "CF-Connecting-IP": "203.0.113.5" },
      body: JSON.stringify({ itemIds: [9503], start: tag(10), end: tag(12), termsVersion: "2026-09", termsAcceptedAt: new Date().toISOString() }),
    }), env, new URL("https://api.disorder119.com/rental-bundle"), "req-ohne-pepper", SHOP);
    assert.equal(paket.status, 503);
    assert.equal((await paket.json()).error, "IP_PRIVACY_NOT_CONFIGURED");
    for (const tabelle of ["reservations", "commerce_orders", "rental_reservations", "rental_groups", "idempotency_keys"]) {
      assert.equal(DB.raw.prepare(`SELECT COUNT(*) AS n FROM ${tabelle}`).get().n, 0, tabelle);
    }
    assert.equal(DB.raw.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE entity_type LIKE 'kontingent:halt%'").get().n, 0);
    assert.ok(!netz.calls.some(c => c.path === "/v2/checkout/orders"), "keine PayPal-Bestellung");
  } finally {
    netz.restore();
    angebotKatalogLeeren();
  }
});

test("rental quote: cached catalogue (no GitHub call per request), own limiter keyed per /64", async () => {
  angebotKatalogLeeren();
  const netz = fakeNetz();
  const DB = sqliteD1(allMigrations());
  const schluessel = [];
  const QUOTE_LIMITER = { limit: async ({ key }) => { schluessel.push(key); return { success: schluessel.length <= 3 }; } };
  const env = { DB, GITHUB_TOKEN: "gh-test", QUOTE_LIMITER };
  const tag = n => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
  const angebot = ip => shopWorker.fetch(new Request("https://api.disorder119.com/rental-quote", {
    method: "POST",
    headers: { Origin: SHOP, "Content-Type": "application/json", "CF-Connecting-IP": ip },
    body: JSON.stringify({ itemId: 9428, start: tag(10), end: tag(12) }),
  }), env);
  try {
    const github = () => netz.calls.filter(c => c.host === "api.github.com").length;
    assert.equal((await angebot("2001:db8:7:8::1")).status, 200);
    const nachErstem = github();
    assert.equal(nachErstem, 2, "einmal Verzeichnis + Blob");
    assert.equal((await angebot("2001:db8:7:8::2")).status, 200);
    assert.equal((await angebot("198.51.100.5")).status, 200);
    assert.equal(github(), nachErstem, "weitere Angebote aus dem Zwischenspeicher");
    assert.deepEqual(schluessel, ["rental-quote-netz:2001:db8:7:8::/64", "rental-quote-netz:2001:db8:7:8::/64", "rental-quote-netz:198.51.100.5"]);
    const gebremst = await angebot("2001:db8:7:8::3");
    assert.equal(gebremst.status, 429);
    assert.equal((await gebremst.json()).error, "RATE_LIMITED");
    // Mietanfrage und Kasse lesen weiter frisch.
    const anfrage = await post({ DB, GITHUB_TOKEN: "gh-test" }, "/rental-request", { itemId: 9428, start: tag(10), end: tag(12) }, "k-miete-frisch-00001");
    assert.equal(anfrage.status, 201, JSON.stringify(anfrage.data));
    assert.equal(github(), nachErstem + 2, "Mietanfrage laedt den Katalog neu");
  } finally {
    netz.restore();
    angebotKatalogLeeren();
  }
});


// ------------------------------------- Offene Halte: parallel und getrennt

test("checkout: the open-order limits also hold for parallel requests", async () => {
  versandCacheLeeren();
  const netz = fakeNetzViele();
  const fuenf = VIELE.slice(0, 5);
  const sieben = VIELE.slice(0, 7);
  try {
    // Gleiche E-Mail-Adresse, gleicher Anschluss, alles gleichzeitig.
    let DB = sqliteD1(allMigrations());
    let env = { DB, GITHUB_TOKEN: "gh-test", PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: "secret" };
    let ergebnisse = await Promise.all(fuenf.map((id, i) =>
      bestellen(env, id, { email: "parallel@example.com", ip: "203.0.113.7", key: `k-parallel-a-000${i}` })));
    assert.deepEqual(ergebnisse.map(r => r.status).sort(), [200, 200, 429, 429, 429], JSON.stringify(ergebnisse.map(r => r.data)));
    assert.ok(ergebnisse.filter(r => r.status === 429).every(r => r.data.error === "TOO_MANY_OPEN_ORDERS" && r.data.reason === "EMAIL"));
    assert.equal(DB.raw.prepare("SELECT COUNT(*) AS n FROM commerce_orders WHERE status='PAYMENT_PENDING'").get().n, OFFENE_BESTELLUNGEN_JE_MAIL);
    assert.equal(DB.raw.prepare("SELECT COUNT(*) AS n FROM reservations WHERE status='RESERVED'").get().n, OFFENE_BESTELLUNGEN_JE_MAIL);
    assert.equal(DB.raw.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE entity_type='kontingent:halt-kasse' AND actor_ref IS NOT NULL").get().n, OFFENE_BESTELLUNGEN_JE_MAIL);

    // Nur die E-Mail-Adresse gleich, jede Anfrage von einem anderen Anschluss.
    DB = sqliteD1(allMigrations());
    env = { DB, GITHUB_TOKEN: "gh-test", PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: "secret" };
    ergebnisse = await Promise.all(fuenf.map((id, i) =>
      bestellen(env, id, { email: "Parallel@Example.com", ip: `198.51.100.${10 + i}`, key: `k-parallel-b-000${i}` })));
    assert.deepEqual(ergebnisse.map(r => r.status).sort(), [200, 200, 429, 429, 429]);

    // Nur der Anschluss gleich (IPv6 je /64), jede Anfrage mit anderer Adresse.
    DB = sqliteD1(allMigrations());
    env = { DB, GITHUB_TOKEN: "gh-test", PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: "secret" };
    ergebnisse = await Promise.all(sieben.map((id, i) =>
      bestellen(env, id, { email: `p${i}@example.com`, ip: `2001:db8:5:6::${i + 1}`, key: `k-parallel-c-000${i}` })));
    assert.deepEqual(ergebnisse.map(r => r.status).sort(), [200, 200, 200, 200, 200, 429, 429]);
    assert.ok(ergebnisse.filter(r => r.status === 429).every(r => r.data.reason === "NETWORK"));
  } finally {
    netz.restore();
  }
});

test("checkout: a failed order gives its open-order slot back", async () => {
  versandCacheLeeren();
  const netz = fakeNetzViele();
  const DB = sqliteD1(allMigrations());
  const env = { DB, GITHUB_TOKEN: "gh-test", PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: "secret" };
  const ip = "203.0.113.70";
  try {
    assert.equal((await bestellen(env, 9501, { email: "a@example.com", ip, key: "k-frei-0000000001" })).status, 200);
    // Schon reserviert: 409, der Platz bleibt nicht belegt.
    const weg = await bestellen(env, 9501, { email: "b@example.com", ip, key: "k-frei-0000000002" });
    assert.equal(weg.status, 409);
    assert.equal(weg.data.error, "ITEM_UNAVAILABLE");
    assert.equal(DB.raw.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE entity_type='kontingent:halt-kasse'").get().n, 1);
    for (let i = 1; i < OFFENE_BESTELLUNGEN_JE_ANSCHLUSS; i++) {
      assert.equal((await bestellen(env, 9501 + i, { email: `x${i}@example.com`, ip, key: `k-frei-00000001${i}` })).status, 200);
    }
    assert.equal((await bestellen(env, 9510, { email: "c@example.com", ip, key: "k-frei-0000000099" })).status, 429);
  } finally {
    netz.restore();
  }
});

test("rental: requests and bundles have their own open-hold limit and never block the checkout", async () => {
  versandCacheLeeren();
  const netz = fakeNetzViele();
  const DB = sqliteD1(allMigrations());
  const env = { DB, GITHUB_TOKEN: "gh-test", PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: "secret" };
  const tag = n => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
  const antwort = async res => ({ status: res.status, data: await res.json(), retryAfter: res.headers.get("Retry-After") });
  const paket = (itemIds, ip, key) => handleRentalBundle(new Request("https://api.disorder119.com/rental-bundle", {
    method: "POST",
    headers: { Origin: SHOP, "Content-Type": "application/json", "Idempotency-Key": key, "CF-Connecting-IP": ip },
    body: JSON.stringify({ itemIds, start: tag(10), end: tag(12), termsVersion: "2026-09", termsAcceptedAt: new Date().toISOString() }),
  }), env, new URL("https://api.disorder119.com/rental-bundle"), `req-${key}`, SHOP).then(antwort);
  const anfrage = (itemId, ip, key, von = 10) => shopWorker.fetch(new Request("https://api.disorder119.com/rental-request", {
    method: "POST",
    headers: { Origin: SHOP, "Content-Type": "application/json", "Idempotency-Key": key, "CF-Connecting-IP": ip },
    body: JSON.stringify({ itemId, start: tag(von), end: tag(von + 2) }),
  }), env).then(antwort);
  try {
    assert.equal(MIETE_JE_ANSCHLUSS, 3);
    // Vier Mietpakete gleichzeitig vom selben Anschluss: drei gehen durch.
    const pakete = await Promise.all([
      paket([9501, 9502], "2001:db8:42:1::5", "k-halt-paket-000001"),
      paket([9503], "2001:db8:42:1::6", "k-halt-paket-000002"),
      paket([9504], "2001:db8:42:1::7", "k-halt-paket-000003"),
      paket([9505], "2001:db8:42:1::8", "k-halt-paket-000004"),
    ]);
    assert.deepEqual(pakete.map(r => r.status).sort(), [201, 201, 201, 429], JSON.stringify(pakete.map(r => r.data)));
    const abgelehnt = pakete.find(r => r.status === 429);
    assert.equal(abgelehnt.data.error, "TOO_MANY_OPEN_HOLDS");
    assert.equal(abgelehnt.data.reason, "NETWORK");
    pruefeWarten(abgelehnt);
    assert.equal(DB.raw.prepare("SELECT COUNT(*) AS n FROM rental_groups WHERE status='RESERVED'").get().n, MIETE_JE_ANSCHLUSS);
    // Danach keine Mietanfrage mehr vom selben Anschluss ...
    const vierteAnfrage = await anfrage(9506, "2001:db8:42:1::9", "k-halt-anfrage-0001");
    assert.equal(vierteAnfrage.status, 429);
    assert.equal(vierteAnfrage.data.error, "TOO_MANY_OPEN_HOLDS");
    pruefeWarten(vierteAnfrage);
    assert.equal(DB.raw.prepare("SELECT COUNT(*) AS n FROM idempotency_keys WHERE idempotency_key='k-halt-anfrage-0001'").get().n, 0, "Claim frei");
    // ... aber die Kasse bleibt offen: Mietanfragen zaehlen dort nicht.
    for (let i = 0; i < OFFENE_BESTELLUNGEN_JE_ANSCHLUSS; i++) {
      const kauf = await bestellen(env, 9507 + i, { email: `kauf${i}@example.com`, ip: `2001:db8:42:1::${20 + i}`, key: `k-halt-kauf-000000${i}` });
      assert.equal(kauf.status, 200, JSON.stringify(kauf.data));
    }
    // Volle Kasse sperrt umgekehrt auch keine Miete eines anderen Anschlusses.
    assert.equal((await anfrage(9512, "198.51.100.9", "k-halt-anfrage-0002")).status, 201);
    // Abgelaufene Pakete halten nichts mehr fest - dann geht es wieder,
    // mit demselben Schluessel wie vorhin.
    DB.raw.prepare("UPDATE rental_groups SET expires_at=?").run(new Date(Date.now() - 1000).toISOString());
    const spaeter = await anfrage(9506, "2001:db8:42:1::9", "k-halt-anfrage-0001");
    assert.equal(spaeter.status, 201, JSON.stringify(spaeter.data));
    const miete = DB.raw.prepare("SELECT entity_id,actor_ref FROM audit_events WHERE entity_type='kontingent:halt-miete'").all();
    assert.equal(miete.length, MIETE_JE_ANSCHLUSS + 2, "drei Pakete, zwei Mietanfragen");
    assert.ok(miete.every(h => /^[0-9a-f]{64}$/.test(h.entity_id) && h.actor_ref));
    assert.equal(DB.raw.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE entity_type='kontingent:halt-kasse'").get().n, OFFENE_BESTELLUNGEN_JE_ANSCHLUSS);
  } finally {
    netz.restore();
  }
});

// ------------------------------- Zaehlung nach Fehlern beim Speichern (B3)

// D1-Attrappe, die ausgewaehlte Schritte scheitern laesst.
function stoerDb(DB, { auditEreignis = null, bestellungBatch = null, bestellungPruefen = false } = {}) {
  return {
    ...DB,
    prepare(sql) {
      const st = DB.prepare(sql);
      if (bestellungPruefen && /SELECT 1 AS ja FROM commerce_orders WHERE id=\?/.test(sql)) {
        return { ...st, bind: () => ({ first: async () => { throw new Error("d1_nicht_erreichbar"); } }) };
      }
      if (bestellungBatch === "scheitert" && /INSERT INTO commerce_orders/.test(sql)) {
        return { ...st, bind: (...args) => ({ ...st.bind(...args), execute() { throw new Error("d1_batch_kaputt"); } }) };
      }
      if (bestellungBatch === "antwort-weg" && /INSERT INTO commerce_orders/.test(sql)) {
        return { ...st, bind: (...args) => ({ ...st.bind(...args), bestellung: true }) };
      }
      if (!auditEreignis || !/INSERT INTO audit_events/.test(sql)) return st;
      return { ...st, bind: (...args) => {
        const gebunden = st.bind(...args);
        if (!args.includes(auditEreignis)) return gebunden;
        return { ...gebunden, run: async () => { throw new Error("audit_kaputt"); } };
      } };
    },
    async batch(list) {
      const ergebnis = await DB.batch(list);
      // Antwort verloren: gespeichert ist es trotzdem.
      if (bestellungBatch === "antwort-weg" && list.some(s => s.bestellung)) throw new Error("d1_antwort_verloren");
      return ergebnis;
    },
  };
}

async function stumm(fn) {
  const original = console.error;
  const meldungen = [];
  console.error = (...args) => meldungen.push(args.join(" "));
  try {
    return { ergebnis: await fn(), meldungen };
  } finally {
    console.error = original;
  }
}

test("checkout: a failing audit after the saved order neither fails the order nor frees its pieces", async () => {
  versandCacheLeeren();
  const netz = fakeNetzViele();
  const DB = sqliteD1(allMigrations());
  const env = { DB: stoerDb(DB, { auditEreignis: "PAYMENT_STARTED" }), GITHUB_TOKEN: "gh-test", PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: "secret" };
  try {
    const { ergebnis: kauf, meldungen } = await stumm(() => bestellen(env, 9501, { email: "audit@example.com", ip: "203.0.113.80", key: "k-audit-kaputt-001" }));
    assert.equal(kauf.status, 200, JSON.stringify(kauf.data));
    assert.equal(DB.raw.prepare("SELECT status FROM commerce_orders WHERE id=?").get(kauf.data.orderId).status, "PAYMENT_PENDING");
    assert.equal(DB.raw.prepare("SELECT COUNT(*) AS n FROM reservations WHERE status='RESERVED'").get().n, 1);
    assert.equal(DB.raw.prepare("SELECT actor_ref FROM audit_events WHERE entity_type='kontingent:halt-kasse'").get().actor_ref, kauf.data.orderId);
    assert.ok(meldungen.some(m => m.includes("audit_after_commit_failed")), meldungen.join("\n"));
    assert.ok(!meldungen.join("\n").includes("audit@example.com"), "keine Kundendaten im Log");
    // Das Stueck ist weiter vergeben.
    const nochmal = await bestellen({ ...env, DB }, 9501, { email: "zweite@example.com", key: "k-audit-kaputt-002" });
    assert.equal(nochmal.status, 409);
  } finally {
    netz.restore();
  }
});

test("checkout: if saving the order fails, pieces and open-order slot are released", async () => {
  versandCacheLeeren();
  const netz = fakeNetzViele();
  const DB = sqliteD1(allMigrations());
  const env = { DB: stoerDb(DB, { bestellungBatch: "scheitert" }), GITHUB_TOKEN: "gh-test", PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: "secret" };
  try {
    const { ergebnis: kauf } = await stumm(() => bestellen(env, 9501, { email: "batch@example.com", ip: "203.0.113.81", key: "k-batch-kaputt-01" }));
    assert.equal(kauf.status, 500);
    assert.equal(DB.raw.prepare("SELECT COUNT(*) AS n FROM commerce_orders").get().n, 0);
    assert.equal(DB.raw.prepare("SELECT COUNT(*) AS n FROM reservations WHERE status='RESERVED'").get().n, 0, "Reservierung zurueck");
    assert.equal(DB.raw.prepare("SELECT status FROM inventory WHERE item_id=9501").get().status, "AVAILABLE");
    assert.equal(DB.raw.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE entity_type='kontingent:halt-kasse'").get().n, 0, "Platz zurueck");
    // Danach laesst sich das Stueck ganz normal kaufen.
    const danach = await bestellen({ ...env, DB }, 9501, { email: "batch@example.com", ip: "203.0.113.81", key: "k-batch-kaputt-02" });
    assert.equal(danach.status, 200, JSON.stringify(danach.data));
  } finally {
    netz.restore();
  }
});

test("checkout: an order saved despite a lost D1 answer is kept and completed", async () => {
  versandCacheLeeren();
  const netz = fakeNetzViele();
  const DB = sqliteD1(allMigrations());
  const env = { DB: stoerDb(DB, { bestellungBatch: "antwort-weg" }), GITHUB_TOKEN: "gh-test", PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: "secret" };
  try {
    const { ergebnis: kauf, meldungen } = await stumm(() => bestellen(env, 9501, { email: "weg@example.com", ip: "203.0.113.82", key: "k-antwort-weg-001" }));
    assert.equal(kauf.status, 200, JSON.stringify(kauf.data));
    assert.ok(meldungen.some(m => m.includes("order_records_committed_despite_error")));
    assert.equal(DB.raw.prepare("SELECT COUNT(*) AS n FROM reservations WHERE status='RESERVED'").get().n, 1, "nicht freigegeben");
    assert.equal(DB.raw.prepare("SELECT actor_ref FROM audit_events WHERE entity_type='kontingent:halt-kasse'").get().actor_ref, kauf.data.orderId);
  } finally {
    netz.restore();
  }
});

test("checkout: if it is unclear whether the order was saved, nothing is released (no double sale)", async () => {
  versandCacheLeeren();
  const netz = fakeNetzViele();
  const DB = sqliteD1(allMigrations());
  const env = { DB: stoerDb(DB, { bestellungBatch: "scheitert", bestellungPruefen: true }), GITHUB_TOKEN: "gh-test", PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: "secret" };
  try {
    const { ergebnis: kauf } = await stumm(() => bestellen(env, 9501, { email: "unklar@example.com", ip: "203.0.113.83", key: "k-unklar-00000001" }));
    assert.equal(kauf.status, 500);
    assert.equal(DB.raw.prepare("SELECT COUNT(*) AS n FROM reservations WHERE status='RESERVED'").get().n, 1, "bleibt bis zum Ablauf reserviert");
    assert.equal(DB.raw.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE entity_type='kontingent:halt-kasse'").get().n, 1, "Platz zaehlt bis zum Ablauf");
  } finally {
    netz.restore();
  }
});

test("rental request: a failing audit after the saved reservation keeps the request and its open-hold slot", async () => {
  angebotKatalogLeeren();
  const netz = fakeNetzViele();
  const DB = sqliteD1(allMigrations());
  const env = { DB: stoerDb(DB, { auditEreignis: "RENTAL_RESERVED" }), GITHUB_TOKEN: "gh-test" };
  const tag = n => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
  try {
    const { ergebnis: res, meldungen } = await stumm(() => shopWorker.fetch(new Request("https://api.disorder119.com/rental-request", {
      method: "POST",
      headers: { Origin: SHOP, "Content-Type": "application/json", "Idempotency-Key": "k-miete-audit-0001", "CF-Connecting-IP": "203.0.113.84" },
      body: JSON.stringify({ itemId: 9501, start: tag(10), end: tag(12) }),
    }), env));
    const data = await res.json();
    assert.equal(res.status, 201, JSON.stringify(data));
    assert.ok(meldungen.some(m => m.includes("audit_after_commit_failed")));
    assert.equal(DB.raw.prepare("SELECT status FROM rental_reservations WHERE id=?").get(data.rentalReservationId).status, "RESERVED");
    assert.equal(DB.raw.prepare("SELECT actor_ref FROM audit_events WHERE entity_type='kontingent:halt-miete'").get().actor_ref, data.rentalReservationId);
  } finally {
    netz.restore();
    angebotKatalogLeeren();
  }
});

test("rental quote: with QUOTE_LIMITER bound, the general RATE_LIMITER does not count quotes a second time", async () => {
  angebotKatalogLeeren();
  const netz = fakeNetz();
  const DB = sqliteD1(allMigrations());
  const allgemein = [];
  const RATE_LIMITER = { limit: async ({ key }) => { allgemein.push(key); return { success: false }; } };
  const QUOTE_LIMITER = { limit: async () => ({ success: true }) };
  const tag = n => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
  try {
    // Ein volles Mietpaket (20 Stuecke) fragt je Stueck einmal.
    for (let i = 0; i < 20; i++) {
      const res = await shopWorker.fetch(new Request("https://api.disorder119.com/rental-quote", {
        method: "POST",
        headers: { Origin: SHOP, "Content-Type": "application/json", "CF-Connecting-IP": "198.51.100.77" },
        body: JSON.stringify({ itemId: 9428, start: tag(10), end: tag(12) }),
      }), { DB, GITHUB_TOKEN: "gh-test", RATE_LIMITER, QUOTE_LIMITER });
      assert.equal(res.status, 200);
    }
    assert.deepEqual(allgemein, []);
  } finally {
    netz.restore();
    angebotKatalogLeeren();
  }
});

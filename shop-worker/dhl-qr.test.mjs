import assert from "node:assert/strict";
import test from "node:test";
import { assertReceiver, dhlText, handleDhlQr, receiverAddress, splitStreet, safeDhlCheckoutUrl } from "./dhl-qr.js";
import { handleAdminRequest } from "./admin-api.js";
import { allMigrations, sqliteD1 } from "./test-d1.mjs";

const ADMIN = "https://admin.disorder119.com";
const TOKEN = "admin-schluessel-dieser-anfrage";
const CART_ID = "ABCDEF123456";
const TRACKING = "00340434161094042557";
// EU-Laender (ISO-3) der Kasse, wie sie der DHL-Katalog in einer Region fuehrt.
const EU3 = ["AUT", "BEL", "BGR", "HRV", "CYP", "CZE", "DNK", "EST", "FIN", "FRA", "GRC", "HUN", "IRL", "ITA", "LVA", "LTU", "LUX", "MLT", "NLD", "POL", "PRT", "ROU", "SWE", "SVK", "SVN", "ESP"];
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(600).fill(7)]);

test('DHL checkout rejects lookalike hosts, credentials and insecure URLs', () => {
  for (const url of ['https://www.dhl.de/send-parcel/init','https://dhl.com/pay']) assert.equal(safeDhlCheckoutUrl(url),true);
  for (const url of ['https://evildhl.com/pay','https://dhl.de.evil.example/pay','https://dhl.de@evil.example/pay',
    'http://dhl.de/pay','https://x@y.dhl.de/pay','https://www.dhl.de:8443/pay','invalid']) assert.equal(safeDhlCheckoutUrl(url),false,url);
});

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
  // Sofort eingezogene Zahlung (wie vor der Umstellung): vor dem Etikett ist
  // nichts mehr einzuziehen.
  run(`INSERT INTO payments (id,order_id,provider,provider_order_id,provider_payment_id,status,amount_cents,currency,idempotency_key,created_at)
    VALUES ('pay1','o1','PAYPAL','PPORDER1','CAPTURE1','COMPLETED',9590,'EUR','paypal-create:k1',?)`, now);
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
    // Cloudflare Workers werfen bei redirect "error" (nur "follow"/"manual" erlaubt).
    assert.ok(init.redirect === undefined || ["follow", "manual"].includes(init.redirect), `redirect ${init.redirect}`);
    calls.push({ path: u.pathname, method: init.method || "GET", headers: init.headers || {}, body: init.body ? JSON.parse(init.body) : null });
    const path = u.pathname.replace("/parcel/de/shipping/of/v1/public", "");
    if (path === "/catalog/current/products") {
      return Response.json({
        defaultProduct: "PAK02",
        products: {
          // Dasselbe Produkt hat je Region einen eigenen Preis: Inland, EU (Zone 1), Schweiz (Zone 2).
          PAK05: { attributes: { displayName: { text: "Paket bis 5 kg" }, maxWeight: 5000, tracking: true }, regions: [
            { countries: ["DEU"], price: { amount: 7.69 } }, { countries: EU3, price: { amount: 17.49 } }, { countries: ["CHE"], price: { amount: 26.99 } }] },
          PAK02: { attributes: { displayName: { text: "Paket bis 2 kg" }, maxWeight: 2000, tracking: true }, regions: [
            { countries: ["DEU"], price: { amount: 6.19 } }, { countries: EU3, price: { amount: 14.49 } }] },
          PAECK: { attributes: { displayName: { text: "Päckchen" }, tracking: false }, regions: [{ countries: ["DEU"], price: { amount: 4.19 } }] },
          "PAK05.HVERSI1000.EU": { attributes: { displayName: { text: "Paket bis 5 kg mit Höherversicherung bis 1.000 €" }, maxWeight: 5000, tracking: true },
            regions: [{ countries: EU3, price: { amount: 31.49 } }] },
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
  // Buchstaben ohne Zerlegung werden umgeschrieben statt verschluckt.
  assert.equal(dhlText("Łukasz 🙂 Świątek", 50), "Lukasz Swiatek");
  assert.equal(dhlText("Đurđevac Ħal Għargħur Ștefan", 50), "Durdevac Hal Gharghur Stefan");
  assert.deepEqual(splitStreet("Musterstraße 12a"), { street: "Musterstraße", streetNumber: "12a" });
  assert.deepEqual(splitStreet("Am Markt 3-5"), { street: "Am Markt", streetNumber: "3-5" });
  assert.deepEqual(splitStreet("Straße des 17. Juni 110"), { street: "Straße des 17. Juni", streetNumber: "110" });
  assert.deepEqual(splitStreet("Packstation 150"), { street: "Packstation", streetNumber: "150" });
  assert.deepEqual(splitStreet("Musterweg"), { street: "Musterweg", streetNumber: "" });
  // EU-Schreibweisen: Zusatz nach der Nummer, "ohne Nummer", Nummer vorn.
  assert.deepEqual(splitStreet("Rue de la Paix 12bis"), { street: "Rue de la Paix", streetNumber: "12bis" });
  assert.deepEqual(splitStreet("Calle Mayor s/n"), { street: "Calle Mayor", streetNumber: "s/n" });
  assert.deepEqual(splitStreet("12 rue de la Paix"), { street: "rue de la Paix", streetNumber: "12" });
  assert.deepEqual(splitStreet("Via Roma 5/7"), { street: "Via Roma", streetNumber: "5/7" });
  assert.equal(receiverAddress({ given_name: "Maria", surname: "Müller", address_line1: "Weg 1" }).name2, "Maria Müller");
});

test("Packstation and Postfiliale use DHL's pickup format: name1 name, name2 Postnummer", () => {
  const packstation = { recipient_name: "Maria Müller", address_line1: "Packstation 162", address_line2: "Postnummer 12345678", postal_code: "63739", city: "Aschaffenburg" };
  assert.deepEqual(receiverAddress(packstation), {
    name1: "Maria Müller", name2: "12345678", street: "Packstation", streetNumber: "162", plz: "63739", city: "Aschaffenburg", country: "DEU",
  });
  assert.doesNotThrow(() => assertReceiver(receiverAddress(packstation)));
  const filiale = { ...packstation, address_line1: "Postfiliale 503", address_line2: "Postnummer 1234 5678 90" };
  assert.deepEqual(receiverAddress(filiale), {
    name1: "Maria Müller", name2: "1234567890", street: "Postfiliale", streetNumber: "503", plz: "63739", city: "Aschaffenburg", country: "DEU",
  });
  // Alte Filial-Bestellung ohne Postnummer: die Admin-App fragt sie nach.
  const ohne = receiverAddress({ ...filiale, address_line2: "" });
  assert.equal(ohne.name2, "");
  assert.throws(() => assertReceiver(ohne), err => err.code === "ADRESSE_UNVOLLSTAENDIG" && err.detail === "Postnummer");
  assert.equal(receiverAddress({ ...filiale, address_line2: "" }, { postnummer: "87654321" }).name2, "87654321");
  // Haustuer bleibt beim bisherigen Format mit dem Namen in name2.
  assert.equal(receiverAddress({ ...packstation, address_line1: "Nelseestraße 25", address_line2: "" }).name1, undefined);
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

    // Ausserhalb der EU (Zoll) gibt es keine Marke ueber diese Anbindung.
    const schweiz = await call(envWith(seed({ country_code: "CH", postal_code: "8001", city: "Zürich" })), "/admin/versand/o1/qr", {
      method: "POST", body: { produkt: "PAK05" },
    });
    assert.equal(schweiz.status, 409);
    assert.equal(schweiz.data.error, "LAND_NICHT_ANGEBUNDEN");
    // Kanaren: Spanien, aber ausserhalb des EU-Zollgebiets.
    const kanaren = await call(envWith(seed({ country_code: "ES", postal_code: "35001", city: "Las Palmas" })), "/admin/versand/o1/qr", {
      method: "POST", body: { produkt: "PAK05" },
    });
    assert.equal(kanaren.data.error, "SONDERGEBIET_MIT_ZOLL");
    // Ein Produkt, das DHL fuer dieses Land nicht fuehrt, wird nicht angelegt.
    const falsch = await call(envWith(seed({ country_code: "CH", postal_code: "8001", city: "Zürich" })), "/admin/versand/dhl-produkte?land=CH");
    assert.equal(falsch.data.error, "LAND_NICHT_ANGEBUNDEN");
    const ohneEu = await call(envWith(seed({ country_code: "AT", postal_code: "1010", city: "Wien" })), "/admin/versand/o1/qr", {
      method: "POST", body: { produkt: "PAECK" },
    });
    assert.equal(ohneEu.data.error, "PRODUKT_NICHT_FUER_LAND");
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

test('invalid DHL setup does not attempt to capture an authorized payment', async () => {
  const cases = [
    {body:{},error:'PRODUKT_FEHLT'},
    {contact:{address_line1:'Musterweg'},body:{produkt:'PAK02'},error:'ADRESSE_UNVOLLSTAENDIG'},
    {contact:{country_code:'CH',postal_code:'8001',city:'Zürich'},body:{produkt:'PAK02'},error:'LAND_NICHT_ANGEBUNDEN'},
    {contact:{country_code:'FR',postal_code:'97110',city:'Pointe-à-Pitre'},body:{produkt:'PAK02'},error:'SONDERGEBIET_MIT_ZOLL'},
    {env:{DHL_PRIVAT_API_KEY:''},body:{produkt:'PAK02'},error:'DHL_QR_NICHT_EINGERICHTET'},
  ];
  for (const c of cases) {
    const DB=seed(c.contact);
    DB.raw.exec("UPDATE payments SET status='AUTHORIZED',provider_payment_id=NULL,authorization_id='AUTH1'");
    const original=globalThis.fetch;let externalCalls=0;
    globalThis.fetch=async()=>{externalCalls++;throw new Error('Provider call must not occur for invalid input');};
    try {
      const result=await call(envWith(DB,c.env),'/admin/versand/o1/qr',{method:'POST',body:c.body});
      assert.equal(DB.raw.prepare("SELECT capture_attempts FROM payments WHERE id='pay1'").get().capture_attempts,0,c.error);
      assert.equal(externalCalls,0,c.error);
      assert.equal(result.data.error,c.error);
      assert.equal(DB.raw.prepare("SELECT status FROM payments WHERE id='pay1'").get().status,'AUTHORIZED');
      assert.equal(DB.raw.prepare('SELECT COUNT(*) AS n FROM dhl_qr_marken').get().n,0);
    } finally {globalThis.fetch=original;DB.raw.close();}
  }
});

test("EU: products and prices for the delivery country, nothing outside the EU", async () => {
  const dhl = fakeDhl();
  try {
    const at = await call(envWith(seed()), "/admin/versand/dhl-produkte?land=AT");
    assert.equal(at.status, 200);
    assert.equal(at.data.land, "AT");
    assert.deepEqual(at.data.produkte.map(p => [p.id, p.priceCents]), [["PAK02", 1449], ["PAK05", 1749], ["PAK05.HVERSI1000.EU", 3149]]);
    const de = await call(envWith(seed()), "/admin/versand/dhl-produkte");
    assert.deepEqual(de.data.produkte.map(p => p.id), ["PAK02", "PAK05"]);
    const us = await call(envWith(seed()), "/admin/versand/dhl-produkte?land=US");
    assert.equal(us.status, 409);
    assert.equal(us.data.error, "LAND_NICHT_ANGEBUNDEN");
  } finally {
    dhl.restore();
  }
});

test("EU: a label for France uses DHL's international address format with the ISO-3 country", async () => {
  const DB = seed({ recipient_name: "Élodie Lefèvre", address_line1: "Rue de la Paix 12bis", address_line2: "Bâtiment B",
    postal_code: "75002", city: "Paris", country_code: "FR" });
  const dhl = fakeDhl({ payAfter: 1 });
  try {
    const created = await call(envWith(DB), "/admin/versand/o1/qr", { method: "POST", body: { produkt: "PAK05" } });
    assert.equal(created.status, 200, JSON.stringify(created.data));
    const cart = dhl.calls.find(c => c.path.endsWith("/shopping-carts/pre-paid")).body.shoppingcart;
    assert.deepEqual(cart.items[0].address.receiver, {
      name2: "Élodie Lefèvre", street: "Rue de la Paix", streetNumber: "12bis", plz: "75002", city: "Paris", country: "FRA", name3: "Bâtiment B",
    });
    assert.equal(cart.items[0].address.sender.country, "DEU");
    assert.equal(cart.items[0].product.id, "PAK05");
  } finally {
    dhl.restore();
  }
  // Niederlande: PLZ in der Schreibweise der Post, Packstation gibt es dort nicht.
  const nl = receiverAddress({ recipient_name: "Anna de Vries", address_line1: "Keizersgracht 123", postal_code: "1015cj", city: "Amsterdam", country_code: "NL" });
  assert.equal(nl.plz, "1015 CJ");
  assert.equal(nl.country, "NLD");
  assert.doesNotThrow(() => assertReceiver(nl, "NL"));
  assert.throws(() => assertReceiver({ ...nl, plz: "1015" }, "NL"), err => err.code === "ADRESSE_UNVOLLSTAENDIG" && /PLZ/.test(err.detail));
  const abholort = receiverAddress({ recipient_name: "Anna de Vries", address_line1: "Packstation 162", postal_code: "1015 CJ", city: "Amsterdam", country_code: "NL" });
  assert.throws(() => assertReceiver(abholort, "NL"), err => err.code === "ABHOLORT_NUR_DE");
});

test("catalog check: shop prices against DHL per zone and country, once a day", async () => {
  const { katalogAbgleich, katalogAbgleichen } = await import("./dhl-qr.js");
  const katalog = { products: {
    PAK02: { regions: [{ countries: ["DEU"], price: { amount: 6.19 } }, { countries: EU3, price: { amount: 14.49 } }] },
    PAK05: { regions: [{ countries: ["DEU"], price: { amount: 7.69 } }, { countries: EU3.filter(l => l !== "MLT"), price: { amount: 17.49 } }, { countries: ["MLT"], price: { amount: 19.99 } }] },
    PAK10: { regions: [{ countries: ["DEU"], price: { amount: 10.49 } }, { countries: EU3, price: { amount: 22.49 } }] },
    PAK20: { regions: [{ countries: ["DEU"], price: { amount: 18.99 } }, { countries: EU3, price: { amount: 28.49 } }] },
    PAK315: { regions: [{ countries: ["DEU"], price: { amount: 23.99 } }, { countries: EU3, price: { amount: 45.49 } }] },
    "PAK05.HVERSI1000.EU": { regions: [{ countries: EU3, price: { amount: 31.49 } }] },
  } };
  const ergebnis = katalogAbgleichen(katalog);
  // Deutschland und die EU stimmen - bis auf Malta im Beispiel.
  assert.deepEqual(ergebnis.abweichungen, [{ zone: "EU", land: "MT", paket: "M", kasseCents: 1749, dhlCents: 1999, produkt: "PAK05" }]);
  assert.deepEqual(ergebnis.zonen.DE.dhl, [{ preise: { S: 619, M: 769, L: 1049, XL: 1899, XXL: 2399 },
    ids: { S: "PAK02", M: "PAK05", L: "PAK10", XL: "PAK20", XXL: "PAK315" }, laender: ["DE"] }]);
  assert.deepEqual(ergebnis.klassenFehlend, {});
  assert.equal(ergebnis.version, 2);
  assert.deepEqual(ergebnis.muster.AT.map(p => p.id), ["PAK02", "PAK05", "PAK10", "PAK20", "PAK05.HVERSI1000.EU", "PAK315"]);
  assert.equal(ergebnis.zonen.EU.dhl[0].laender.length, 25);
  assert.deepEqual(ergebnis.versicherung, ["PAK05.HVERSI1000.EU"]);
  assert.deepEqual(ergebnis.fehlend, []);

  const DB = seed();
  const original = globalThis.fetch;
  let abrufe = 0;
  globalThis.fetch = async () => { abrufe += 1; return Response.json(katalog); };
  try {
    const env = envWith(DB, { DHL_PRIVAT_ENVIRONMENT: "live" });
    const jetzt = Date.parse("2030-01-01T10:00:00Z");
    const erster = await katalogAbgleich(env, jetzt);
    assert.equal(erster.ereignis, "DHL_KATALOG_ABWEICHUNG");
    assert.equal((await katalogAbgleich(env, jetzt + 3_600_000)).uebersprungen, "HEUTE_SCHON");
    const row = DB.raw.prepare("SELECT event_type,metadata_json FROM audit_events WHERE entity_id='dhl-katalog'").get();
    assert.equal(row.event_type, "DHL_KATALOG_ABWEICHUNG");
    assert.equal(JSON.parse(row.metadata_json).environment, "live");
    assert.ok(abrufe <= 1, "der Katalog wird gemerkt");
    // Die Admin-App bekommt den letzten Abgleich mit der Produktliste.
    const liste = await call(env, "/admin/versand/dhl-produkte?land=MT");
    assert.equal(liste.data.abgleich.ereignis, "DHL_KATALOG_ABWEICHUNG");
    assert.equal(liste.data.abgleich.abweichungen[0].land, "MT");
    assert.equal((await katalogAbgleich({ DB }, jetzt + 2 * 86_400_000)).uebersprungen, "NICHT_EINGERICHTET");
    // Nach einem Fehler: nach einer Stunde erneut, nicht erst morgen.
    const DB2 = seed();
    const fehlerAm = jetzt + 3 * 86_400_000;
    DB2.raw.prepare(`INSERT INTO audit_events (id,actor_type,entity_type,entity_id,event_type,metadata_json,created_at)
      VALUES ('f1','SYSTEM','versand','dhl-katalog','DHL_KATALOG_FEHLER','{}',?)`).run(new Date(fehlerAm).toISOString());
    const env2 = envWith(DB2, { DHL_PRIVAT_ENVIRONMENT: "live" });
    assert.equal((await katalogAbgleich(env2, fehlerAm + 30 * 60_000)).uebersprungen, "HEUTE_SCHON");
    assert.equal((await katalogAbgleich(env2, fehlerAm + 61 * 60_000)).ereignis, "DHL_KATALOG_ABWEICHUNG");
  } finally {
    globalThis.fetch = original;
  }
});

test("no fetch in the worker uses redirect 'error' (Cloudflare Workers reject it at runtime)", async () => {
  const fs = await import("node:fs");
  const dir = new URL("./", import.meta.url);
  for (const name of fs.readdirSync(dir).filter(n => n.endsWith(".js"))) {
    const text = fs.readFileSync(new URL(name, dir), "utf8");
    assert.doesNotMatch(text, /redirect\s*:\s*["']error["']/, name);
  }
});

test("a redirect from DHL is not followed but reported", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    assert.equal(init.redirect, "manual");
    return new Response(null, { status: 302, headers: { Location: "https://example.com/" } });
  };
  try {
    const res = await call(envWith(seed(), { DHL_PRIVAT_ENVIRONMENT: "redirect-test" }), "/admin/versand/dhl-produkte?land=AT");
    assert.equal(res.status, 502);
    assert.equal(res.data.error, "DHL_FEHLER");
    assert.match(res.data.detail, /HTTP 302/);
  } finally {
    globalThis.fetch = original;
  }
});

test("catalog check: foreign parcels under other ids are found by weight, gaps are reported", async () => {
  const { katalogAbgleichen, katalogPreise } = await import("./dhl-qr.js");
  const katalog = { products: {
    PAK02: { attributes: { maxWeight: 2000 }, regions: [{ countries: ["DEU"], price: { amount: 6.19 } }] },
    PAKINT02: { attributes: { displayName: { text: "Paket International bis 2 kg" }, maxWeight: 2000 }, regions: [{ countries: ["AUT", "FRA"], price: { amount: 14.49 } }] },
    PAKINT05: { attributes: { maxWeight: 5000 }, regions: [{ countries: ["AUT", "FRA"], price: { amount: 17.49 } }] },
    PAECKINT: { attributes: { displayName: { text: "Päckchen International" }, maxWeight: 2000 }, regions: [{ countries: ["AUT"], price: { amount: 10.49 } }] },
    "PAKINT05.HVERSI1000": { attributes: { maxWeight: 5000 }, regions: [{ countries: ["AUT"], price: { amount: 31.49 } }] },
    // Wie live fuer Italien: Express-Produkte zaehlen nicht als Standardpaket.
    EXPRESSPAK10: { attributes: { displayName: { text: "DHL Express" }, maxWeight: 10000 }, regions: [{ countries: ["AUT"], price: { amount: 105.70 } }] },
  } };
  const at = katalogPreise(katalog, "AUT");
  assert.deepEqual({ ...at }, { S: 1449, M: 1749 });
  assert.deepEqual(at.ids, { S: "PAKINT02", M: "PAKINT05" });
  const ergebnis = katalogAbgleichen(katalog);
  assert.deepEqual(ergebnis.klassenFehlend.AT, ["L", "XL", "XXL"]);
  assert.ok(ergebnis.fehlend.includes("SE"));
  assert.deepEqual(ergebnis.muster.SE, []);
});

test("catalog check reruns at once after a new version of the check is deployed", async () => {
  const { katalogAbgleich } = await import("./dhl-qr.js");
  const DB = seed();
  const jetzt = Date.parse("2031-01-01T10:00:00Z");
  DB.raw.prepare(`INSERT INTO audit_events (id,actor_type,entity_type,entity_id,event_type,metadata_json,created_at)
    VALUES ('a1','SYSTEM','versand','dhl-katalog','DHL_KATALOG_ABWEICHUNG','{"zonen":{}}',?)`).run(new Date(jetzt).toISOString());
  const env = envWith(DB, { DHL_PRIVAT_ENVIRONMENT: "live" });
  const neu = await katalogAbgleich(env, jetzt + 15 * 60_000);
  assert.equal(neu.version, 2);
  assert.equal((await katalogAbgleich(env, jetzt + 30 * 60_000)).uebersprungen, "HEUTE_SCHON");
});

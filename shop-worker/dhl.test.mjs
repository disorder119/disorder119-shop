import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_WEIGHT_G,
  MAX_WEIGHT_G,
  MIN_WEIGHT_G,
  NATIONAL_PRODUCT,
  abrechnungsnummer,
  buildShipmentRequest,
  cancelLabelForOrder,
  createLabelForOrder,
  dhlAutoMarken,
  dhlBase,
  dhlReady,
  empfaengerAus,
  ersteSendungAus,
  handleVersand,
  laendercode,
  markeAnsehen,
  produktFuer,
  requestLabel,
  statusView,
  weightGrams,
} from "./dhl.js";

const ENV = {
  DHL_API_KEY: "test-key",
  DHL_USER: "sandbox-user",
  DHL_PASSWORD: "sandbox-pass",
  DHL_EKP: "3333333333",
};

const KONTAKT = {
  recipient_name: "A. Beispiel",
  address_line1: "Musterweg 3",
  postal_code: "63739",
  city: "Aschaffenburg",
  country_code: "DE",
};

// bestellungLesen liefert Bestellung und Anschrift in einer Zeile.
const BESTELLUNG = { id: "order-1", order_number: "D119-20260923-ABC12345", status: "PAID", versand_paket: "S", ...KONTAKT };
// Sofort eingezogen (wie vor der Umstellung auf Reservieren): vor der Marke
// ist nichts mehr einzuziehen.
const ZAHLUNG = { id: "pay-1", order_id: "order-1", provider: "PAYPAL", status: "COMPLETED", provider_payment_id: "CAPTURE1", amount_cents: 9590 };
const PDF_B64 = Buffer.from("%PDF-1.4 test").toString("base64");

function stubFetch(handler) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return handler(url, init);
  };
  return { calls, restore() { globalThis.fetch = original; } };
}

function db({ shipment = null, order = BESTELLUNG, zahlung = ZAHLUNG, marke = null, offene = [], fehlversuch = null } = {}) {
  const writes = [];
  const statement = (text, args) => ({
    text, args,
    async first() {
      if (text.includes("FROM commerce_orders")) return order;
      if (text.includes("FROM payments")) return zahlung;
      if (text.includes("FROM shipments")) return shipment;
      if (text.includes("FROM dhl_vertragsmarken")) return marke;
      if (text.includes("FROM audit_events")) return fehlversuch;
      return null;
    },
    async all() {
      if (text.includes("FROM commerce_orders o")) return { results: offene };
      return { results: [] };
    },
    async run() { writes.push({ text, args }); return { meta: { changes: 1 } }; },
  });
  return {
    writes,
    prepare(sql) {
      const text = String(sql);
      return { bind(...args) { return statement(text, args); } };
    },
    async batch(statements) {
      const out = [];
      for (const s of statements) out.push(await s.run());
      return out;
    },
  };
}

function antwortMitMarke(nummer = "00340434161234567890") {
  return new Response(JSON.stringify({ items: [{ shipmentNo: nummer, label: { b64: PDF_B64, url: "https://dhl.example/l.pdf" } }] }), { status: 200 });
}

test("DHL stays off until every credential is present", () => {
  assert.equal(dhlReady({}), false);
  assert.equal(dhlReady({ ...ENV, DHL_EKP: "" }), false);
  assert.equal(dhlReady({ ...ENV, DHL_EKP: "", DHL_BILLING_NUMBER: "33333333330102" }), true);
  assert.equal(dhlReady(ENV), true);
});

test("the sandbox is the default, live has to be chosen", () => {
  assert.match(dhlBase({}), /api-sandbox\.dhl\.com/);
  assert.match(dhlBase({ DHL_ENVIRONMENT: "sandbox" }), /api-sandbox\.dhl\.com/);
  assert.match(dhlBase({ DHL_ENVIRONMENT: "live" }), /api-eu\.dhl\.com/);
  assert.match(dhlBase({ DHL_ENVIRONMENT: "LIVE" }), /api-eu\.dhl\.com/);
});

test("weight stays inside what DHL accepts", () => {
  assert.equal(weightGrams(undefined), DEFAULT_WEIGHT_G);
  assert.equal(weightGrams(0), DEFAULT_WEIGHT_G);
  assert.equal(weightGrams("abc"), DEFAULT_WEIGHT_G);
  assert.equal(weightGrams(1), MIN_WEIGHT_G);
  assert.equal(weightGrams(999_999), MAX_WEIGHT_G);
  assert.equal(weightGrams(1500), 1500);
  assert.equal(weightGrams(undefined, 800), 800);
});

test("only countries of the checkout get a code (Germany and the EU)", () => {
  assert.equal(laendercode("DE"), "DEU");
  assert.equal(laendercode("de"), "DEU");
  assert.equal(laendercode("AT"), "AUT");
  assert.equal(laendercode("FR"), "FRA");
  assert.equal(laendercode("CH"), "");
  assert.equal(laendercode("XX"), "");
});

test("billing number = EKP + procedure + participation, or the fixed number when it fits", () => {
  assert.equal(abrechnungsnummer(ENV, "V01PAK"), "33333333330101");
  assert.equal(abrechnungsnummer({ ...ENV, DHL_TEILNAHME: "02" }, "V62KP"), "33333333336202");
  assert.equal(abrechnungsnummer(ENV, "V53WPAK"), "33333333335301");
  assert.equal(abrechnungsnummer({ ...ENV, DHL_EKP: "", DHL_BILLING_NUMBER: "33333333330102" }, "V01PAK"), "33333333330102");
  assert.throws(() => abrechnungsnummer({ ...ENV, DHL_EKP: "", DHL_BILLING_NUMBER: "33333333330102" }, "V62KP"), err => err.code === "ABRECHNUNGSNUMMER_FEHLT");
  assert.throws(() => abrechnungsnummer(ENV, "V99XX"), err => err.code === "PRODUKT_UNBEKANNT");
});

test("product follows the country: Paket at home, Kleinpaket only on request and under 1 kg, International in the EU", () => {
  assert.equal(produktFuer("DE"), "V01PAK");
  assert.equal(produktFuer("DE", { produkt: "V62KP", gewichtG: 800 }), "V62KP");
  assert.throws(() => produktFuer("DE", { produkt: "V62KP", gewichtG: 1200 }), err => err.code === "KLEINPAKET_ZU_SCHWER");
  assert.equal(produktFuer("AT"), "V53WPAK");
  assert.equal(produktFuer("AT", { produkt: "V62KP" }), "V53WPAK");
  assert.throws(() => produktFuer("CH"), err => err.code === "VERSANDLAND_NICHT_UNTERSTUETZT");
  assert.throws(() => produktFuer("XX"), err => err.code === "VERSANDLAND_NICHT_UNTERSTUETZT");
});

test("the request carries product, billing number and both addresses", () => {
  const anfrage = buildShipmentRequest(ENV, BESTELLUNG, KONTAKT);
  const sendung = anfrage.shipments[0];
  assert.equal(sendung.product, NATIONAL_PRODUCT);
  assert.equal(sendung.billingNumber, "33333333330101");
  assert.equal(sendung.refNo, "D119-20260923-ABC12345");
  assert.equal(sendung.consignee.name1, "A. Beispiel");
  assert.equal(sendung.consignee.addressStreet, "Musterweg");
  assert.equal(sendung.consignee.addressHouse, "3");
  assert.equal(sendung.consignee.country, "DEU");
  assert.equal(sendung.shipper.country, "DEU");
  assert.equal(sendung.shipper.addressStreet, "Nelseestraße");
  assert.equal(sendung.shipper.addressHouse, "25");
  assert.deepEqual(sendung.details.weight, { uom: "g", value: DEFAULT_WEIGHT_G });
});

test("Packstation and Postfiliale use lockerID / retailID with the customer's Postnummer", () => {
  const packstation = empfaengerAus({ ...KONTAKT, address_line1: "Packstation 162", address_line2: "Postnummer 12345678" });
  assert.deepEqual(packstation, { name1: "A. Beispiel", postNumber: "12345678", lockerID: "162", postalCode: "63739", city: "Aschaffenburg", country: "DEU" });
  const filiale = empfaengerAus({ ...KONTAKT, address_line1: "Postfiliale 521" });
  assert.deepEqual(filiale, { name1: "A. Beispiel", retailID: "521", postalCode: "63739", city: "Aschaffenburg", country: "DEU" });
  assert.throws(() => empfaengerAus({ ...KONTAKT, address_line1: "Packstation 162" }), err => err.code === "POSTNUMMER_FEHLT");
});

test("EU: ISO-3 country and the country's postal code format", () => {
  const wien = empfaengerAus({ ...KONTAKT, address_line1: "Stephansplatz 1", postal_code: "1010", city: "Wien", country_code: "AT" });
  assert.equal(wien.country, "AUT");
  assert.equal(wien.postalCode, "1010");
  const anfrage = buildShipmentRequest(ENV, BESTELLUNG, { ...KONTAKT, country_code: "AT", postal_code: "1010", city: "Wien" });
  assert.equal(anfrage.shipments[0].product, "V53WPAK");
  assert.equal(anfrage.shipments[0].billingNumber, "33333333335301");
});

test("an incomplete address is named instead of shipped blindly", () => {
  assert.throws(
    () => buildShipmentRequest(ENV, BESTELLUNG, { ...KONTAKT, postal_code: "", city: "" }),
    err => {
      assert.equal(err.code, "VERSANDADRESSE_UNVOLLSTAENDIG");
      assert.match(err.detail, /PLZ/);
      assert.match(err.detail, /Ort/);
      return true;
    },
  );
});

test("shipping outside the checkout countries is refused rather than guessed", () => {
  assert.throws(
    () => buildShipmentRequest(ENV, BESTELLUNG, { ...KONTAKT, country_code: "CH" }),
    err => err.code === "VERSANDLAND_NICHT_UNTERSTUETZT" && err.detail === "CH",
  );
  assert.throws(
    () => buildShipmentRequest(ENV, BESTELLUNG, { ...KONTAKT, country_code: "XX" }),
    err => err.code === "VERSANDLAND_NICHT_UNTERSTUETZT",
  );
});

test("a response without a tracking number is an error, not an empty label", () => {
  assert.throws(
    () => ersteSendungAus({ items: [{ sstatus: { title: "Weak validation error" }, validationMessages: [{ validationMessage: "consignee.postalCode invalid" }] }] }),
    err => err.code === "DHL_ANTWORT_OHNE_SENDUNGSNUMMER" && /Weak validation/.test(err.detail) && /postalCode/.test(err.detail),
  );
  assert.deepEqual(
    ersteSendungAus({ items: [{ shipmentNo: "00340434161234567890", label: { url: "https://dhl.example/l.pdf" } }] }),
    { trackingNumber: "00340434161234567890", labelUrl: "https://dhl.example/l.pdf", labelB64: null },
  );
  // Nur ein echtes PDF wird aufgehoben.
  assert.equal(ersteSendungAus({ items: [{ shipmentNo: "1", label: { b64: "AAAA" } }] }).labelB64, null);
  assert.equal(ersteSendungAus({ items: [{ shipmentNo: "1", label: { b64: PDF_B64 } }] }).labelB64, PDF_B64);
});

test("key and basic auth are both sent, the PDF is requested in the response", async () => {
  const stub = stubFetch(async () => antwortMitMarke("003404341612345"));
  try {
    const ergebnis = await requestLabel(ENV, buildShipmentRequest(ENV, BESTELLUNG, KONTAKT));
    assert.equal(ergebnis.trackingNumber, "003404341612345");
    assert.equal(ergebnis.labelB64, PDF_B64);
    assert.equal(stub.calls[0].init.headers["dhl-api-key"], "test-key");
    assert.equal(stub.calls[0].init.headers.Authorization, "Basic " + Buffer.from("sandbox-user:sandbox-pass").toString("base64"));
    assert.match(stub.calls[0].url, /api-sandbox\.dhl\.com/);
    assert.match(stub.calls[0].url, /includeDocs=include/);
    assert.match(stub.calls[0].url, /printFormat=A4/);
  } finally {
    stub.restore();
  }
});

test("a rejection never leaks the customer address into the message", async () => {
  const stub = stubFetch(async () => new Response(
    JSON.stringify({ status: { title: "Bad request", detail: "consignee Musterweg 3 invalid" } }),
    { status: 400 },
  ));
  try {
    await assert.rejects(
      () => requestLabel(ENV, buildShipmentRequest(ENV, BESTELLUNG, KONTAKT)),
      err => err.code === "DHL_ABGELEHNT",
    );
  } finally {
    stub.restore();
  }
});

test("a second click never buys a second label", async () => {
  const bestand = db({ shipment: { id: "ship-1", tracking_number: "00340434161234567890", carrier: "DHL", status: "LABEL_CREATED" } });
  const stub = stubFetch(async () => { throw new Error("darf nicht erneut bestellt werden"); });
  try {
    const ergebnis = await createLabelForOrder({ ...ENV, DB: bestand }, "order-1");
    assert.equal(ergebnis.created, false);
    assert.equal(ergebnis.trackingNumber, "00340434161234567890");
    assert.equal(stub.calls.length, 0);
    // Auch mit vorhandener Vertragsmarke: nichts Neues.
    const mitMarke = db({ marke: { id: "m1", state: "ERSTELLT", shipment_number: "0034", product: "V01PAK", billing_number: "33333333330101", label_pdf_b64: PDF_B64, automatisch: 0, created_at: "2026-11-04T10:00:00Z", updated_at: "2026-11-04T10:00:00Z" } });
    const zweite = await createLabelForOrder({ ...ENV, DB: mitMarke }, "order-1");
    assert.equal(zweite.created, false);
    assert.equal(zweite.marke.pdf, `data:application/pdf;base64,${PDF_B64}`);
    assert.equal(stub.calls.length, 0);
  } finally {
    stub.restore();
  }
});

test("a fresh label is stored with PDF, tracking number, order status and audit entry", async () => {
  const frisch = db();
  const stub = stubFetch(async () => antwortMitMarke("00340434169999999999"));
  try {
    const ergebnis = await createLabelForOrder({ ...ENV, DB: frisch }, "order-1", { requestId: "r1" });
    assert.equal(ergebnis.created, true);
    assert.equal(ergebnis.trackingNumber, "00340434169999999999");
    assert.equal(ergebnis.carrier, "DHL");
    assert.equal(ergebnis.marke.produktName, "DHL Paket");
    assert.equal(ergebnis.marke.gewichtG, 1500, "Paketklasse S der Kasse -> 1,5 kg");
    assert.ok(ergebnis.marke.pdf.startsWith("data:application/pdf;base64,"));
    assert.ok(frisch.writes.some(w => w.text.includes("INSERT INTO shipments") && w.args.includes("00340434169999999999")));
    assert.ok(frisch.writes.some(w => w.text.includes("INSERT INTO dhl_vertragsmarken") && w.args.includes(PDF_B64)));
    assert.ok(frisch.writes.some(w => w.text.includes("status='PREPARING'") && w.text.includes("commerce_orders")));
    assert.ok(frisch.writes.some(w => w.text.includes("DHL_LABEL_CREATED")));
    const body = JSON.parse(stub.calls[0].init.body);
    assert.equal(body.shipments[0].details.weight.value, 1500);
  } finally {
    stub.restore();
  }
});

test("an unpaid order gets no label", async () => {
  const offen = db({ order: { ...BESTELLUNG, status: "PAYMENT_PENDING" } });
  await assert.rejects(
    () => createLabelForOrder({ ...ENV, DB: offen }, "order-1"),
    err => err.code === "BESTELLUNG_NICHT_VERSANDFERTIG" && err.status === 409,
  );
});

test("without credentials nothing is attempted", async () => {
  await assert.rejects(
    () => createLabelForOrder({ DB: db() }, "order-1"),
    err => err.code === "DHL_NOT_CONFIGURED" && err.status === 503,
  );
});

test("viewing: no label, a foreign tracking number, or the stored contract label", async () => {
  assert.deepEqual(await markeAnsehen({ ...ENV, DB: db() }, "order-1"), { state: "KEINE" });
  const fremd = await markeAnsehen({ ...ENV, DB: db({ shipment: { id: "s", tracking_number: "JD0001", carrier: "DPD", status: "LABEL_CREATED" } }) }, "order-1");
  assert.equal(fremd.state, "FREMD");
  assert.equal(fremd.carrier, "DPD");
  const eigene = await markeAnsehen({ ...ENV, DB: db({ marke: { id: "m1", state: "ERSTELLT", shipment_number: "0034", product: "V62KP", billing_number: "33333333336201", weight_g: 800, label_pdf_b64: PDF_B64, automatisch: 1, created_at: "t", updated_at: "t" } }) }, "order-1");
  assert.equal(eigene.state, "ERSTELLT");
  assert.equal(eigene.produktName, "DHL Kleinpaket");
  assert.equal(eigene.automatisch, true);
});

test("cancelling deletes at DHL before the mark is written off, and not after shipping", async () => {
  const marke = { id: "m1", shipment_id: "ship-1", state: "ERSTELLT", shipment_number: "00340434161234567890", product: "V01PAK", billing_number: "33333333330101", label_pdf_b64: PDF_B64, automatisch: 0, created_at: "t", updated_at: "t" };
  const bestand = db({ marke, shipment: { id: "ship-1", status: "LABEL_CREATED", tracking_number: marke.shipment_number } });
  const stub = stubFetch(async (url, init) => {
    assert.equal(init.method, "DELETE");
    assert.match(String(url), /shipment=00340434161234567890/);
    return new Response(JSON.stringify({ items: [{ sstatus: { statusCode: 200, title: "ok" } }] }), { status: 200 });
  });
  try {
    const ergebnis = await cancelLabelForOrder({ ...ENV, DB: bestand }, "order-1", { requestId: "r2" });
    assert.equal(ergebnis.storniert, marke.shipment_number);
    assert.ok(bestand.writes.some(w => w.text.includes("state='STORNIERT'")));
    assert.ok(bestand.writes.some(w => w.text.includes("tracking_number=NULL")));
    assert.ok(bestand.writes.some(w => w.text.includes("DHL_LABEL_STORNIERT")));
  } finally {
    stub.restore();
  }
  const versendet = db({ marke, shipment: { id: "ship-1", status: "SHIPPED", tracking_number: marke.shipment_number } });
  await assert.rejects(() => cancelLabelForOrder({ ...ENV, DB: versendet }, "order-1"), err => err.code === "SCHON_VERSENDET");
  const abgelehnt = db({ marke, shipment: { id: "ship-1", status: "LABEL_CREATED", tracking_number: marke.shipment_number } });
  const stub2 = stubFetch(async () => new Response(JSON.stringify({ status: { title: "already manifested" } }), { status: 400 }));
  try {
    await assert.rejects(() => cancelLabelForOrder({ ...ENV, DB: abgelehnt }, "order-1"), err => err.code === "DHL_STORNO_ABGELEHNT");
    assert.ok(!abgelehnt.writes.some(w => w.text.includes("STORNIERT")));
  } finally {
    stub2.restore();
  }
});

test("automatic labels: off by default, then one label per paid order without a shipment, failures are logged and retried later", async () => {
  assert.deepEqual(await dhlAutoMarken({ ...ENV, DB: db() }), { uebersprungen: true });
  const offene = [{ id: "order-1", order_number: BESTELLUNG.order_number, created_at: "2026-11-04T10:00:00Z" }];
  const bestand = db({ offene });
  const stub = stubFetch(async () => antwortMitMarke("00340434160000000001"));
  try {
    const ergebnis = await dhlAutoMarken({ ...ENV, DHL_AUTO_MARKE: "an", DB: bestand }, "r3");
    assert.equal(ergebnis.erzeugt.length, 1);
    assert.equal(ergebnis.fehler.length, 0);
    const marke = bestand.writes.find(w => w.text.includes("INSERT INTO dhl_vertragsmarken"));
    assert.equal(marke.args[9], 1, "automatisch = 1");
    assert.ok(bestand.writes.some(w => w.text.includes("DHL_LABEL_CREATED") && w.args.includes("SYSTEM")));
  } finally {
    stub.restore();
  }
  // DHL lehnt ab: Fehler im Protokoll, kein Abbruch.
  const kaputt = db({ offene });
  const stub2 = stubFetch(async () => new Response(JSON.stringify({ status: { title: "Unauthorized" } }), { status: 401 }));
  try {
    const ergebnis = await dhlAutoMarken({ ...ENV, DHL_AUTO_MARKE: "an", DB: kaputt }, "r4");
    assert.equal(ergebnis.erzeugt.length, 0);
    assert.equal(ergebnis.fehler.length, 1);
    assert.equal(ergebnis.fehler[0].code, "DHL_ABGELEHNT");
    assert.ok(kaputt.writes.some(w => w.text.includes("DHL_AUTO_MARKE_FEHLER")));
  } finally {
    stub2.restore();
  }
  // Frischer Fehlversuch: erst nach der Wartezeit wieder.
  const wartend = db({ offene, fehlversuch: { created_at: new Date(Date.now() - 60_000).toISOString() } });
  const stub3 = stubFetch(async () => { throw new Error("darf nicht aufgerufen werden"); });
  try {
    const ergebnis = await dhlAutoMarken({ ...ENV, DHL_AUTO_MARKE: "an", DB: wartend }, "r5");
    assert.equal(ergebnis.gewartet, 1);
    assert.equal(stub3.calls.length, 0);
  } finally {
    stub3.restore();
  }
});

test("admin routes: status without secrets, label view, creation and cancellation behind the write token", async () => {
  const env = { ...ENV, DHL_AUTO_MARKE: "an", ADMIN_TOKEN: "schreib-token", DB: db() };
  const anfrage = (pfad, method = "GET", body) => handleVersand(new Request(`https://api.disorder119.com${pfad}`, {
    method, headers: { Authorization: "Bearer schreib-token", "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined,
  }), env, new URL(`https://api.disorder119.com${pfad}`), "req", "https://admin.disorder119.com");

  const status = await (await anfrage("/admin/versand/dhl-status")).json();
  assert.equal(status.bereit, true);
  assert.equal(status.automatisch, true);
  assert.equal(status.kundennummer, "333…33");
  assert.ok(!JSON.stringify(status).includes("sandbox-pass"));
  assert.equal(status.produkte.length, 3);

  const ansicht = await (await anfrage("/admin/versand/order-1/label")).json();
  assert.deepEqual(ansicht.marke, { state: "KEINE" });

  const stub = stubFetch(async () => antwortMitMarke("00340434160000000002"));
  try {
    const erzeugt = await anfrage("/admin/versand/order-1/label", "POST", { produkt: "V62KP", gewichtGramm: 700 });
    assert.equal(erzeugt.status, 200);
    const daten = await erzeugt.json();
    assert.equal(daten.created, true);
    assert.equal(daten.marke.produkt, "V62KP");
    assert.equal(daten.marke.gewichtG, 700);
  } finally {
    stub.restore();
  }

  const ohneToken = await handleVersand(new Request("https://api.disorder119.com/admin/versand/order-1/label", { method: "POST" }), env,
    new URL("https://api.disorder119.com/admin/versand/order-1/label"), "req", "https://admin.disorder119.com");
  assert.equal(ohneToken.status, 401);
  const fremdeHerkunft = await handleVersand(new Request("https://api.disorder119.com/admin/versand/dhl-status"), env,
    new URL("https://api.disorder119.com/admin/versand/dhl-status"), "req", "https://boese.example");
  assert.equal(fremdeHerkunft.status, 403);
  assert.equal(statusView({}).bereit, false);
});

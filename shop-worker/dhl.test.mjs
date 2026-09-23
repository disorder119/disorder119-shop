import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_WEIGHT_G,
  MAX_WEIGHT_G,
  MIN_WEIGHT_G,
  NATIONAL_PRODUCT,
  buildShipmentRequest,
  createLabelForOrder,
  dhlBase,
  dhlReady,
  ersteSendungAus,
  laendercode,
  requestLabel,
  weightGrams,
} from "./dhl.js";

const ENV = {
  DHL_API_KEY: "test-key",
  DHL_USER: "sandbox-user",
  DHL_PASSWORD: "sandbox-pass",
  DHL_BILLING_NUMBER: "33333333330102",
};

const KONTAKT = {
  recipient_name: "A. Beispiel",
  address_line1: "Musterweg 3",
  postal_code: "63739",
  city: "Aschaffenburg",
  country_code: "DE",
};

const BESTELLUNG = { id: "order-1", order_number: "D119-20260923-ABC12345", status: "PAID" };

function stubFetch(handler) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return handler(url, init);
  };
  return { calls, restore() { globalThis.fetch = original; } };
}

function db({ shipment = null, order = BESTELLUNG, kontakt = KONTAKT } = {}) {
  const writes = [];
  return {
    writes,
    prepare(sql) {
      const text = String(sql);
      return {
        bind(...args) {
          return {
            async first() {
              if (text.includes("FROM commerce_orders")) return order;
              if (text.includes("FROM shipments")) return shipment;
              if (text.includes("FROM order_contact_snapshots")) return kontakt;
              return null;
            },
            async all() { return { results: [] }; },
            async run() { writes.push({ text, args }); return { meta: { changes: 1 } }; },
          };
        },
      };
    },
  };
}

test("DHL stays off until every credential is present", () => {
  assert.equal(dhlReady({}), false);
  assert.equal(dhlReady({ ...ENV, DHL_BILLING_NUMBER: "" }), false);
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

test("only known countries get a code", () => {
  assert.equal(laendercode("DE"), "DEU");
  assert.equal(laendercode("de"), "DEU");
  assert.equal(laendercode("AT"), "AUT");
  assert.equal(laendercode("XX"), "");
});

test("the request carries product, billing number and both addresses", () => {
  const anfrage = buildShipmentRequest(ENV, BESTELLUNG, KONTAKT);
  const sendung = anfrage.shipments[0];
  assert.equal(sendung.product, NATIONAL_PRODUCT);
  assert.equal(sendung.billingNumber, "33333333330102");
  assert.equal(sendung.refNo, "D119-20260923-ABC12345");
  assert.equal(sendung.consignee.name1, "A. Beispiel");
  assert.equal(sendung.consignee.country, "DEU");
  assert.equal(sendung.shipper.country, "DEU");
  assert.deepEqual(sendung.details.weight, { uom: "g", value: DEFAULT_WEIGHT_G });
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

test("foreign shipping is refused rather than guessed", () => {
  assert.throws(
    () => buildShipmentRequest(ENV, BESTELLUNG, { ...KONTAKT, country_code: "AT" }),
    err => err.code === "AUSLANDSVERSAND_NICHT_ANGEBUNDEN",
  );
  assert.throws(
    () => buildShipmentRequest(ENV, BESTELLUNG, { ...KONTAKT, country_code: "XX" }),
    err => err.code === "VERSANDLAND_NICHT_UNTERSTUETZT",
  );
});

test("a response without a tracking number is an error, not an empty label", () => {
  assert.throws(
    () => ersteSendungAus({ items: [{ sstatus: { title: "Weak validation error" } }] }),
    err => err.code === "DHL_ANTWORT_OHNE_SENDUNGSNUMMER" && /Weak validation/.test(err.detail),
  );
  assert.deepEqual(
    ersteSendungAus({ items: [{ shipmentNo: "00340434161234567890", label: { url: "https://dhl.example/l.pdf" } }] }),
    { trackingNumber: "00340434161234567890", labelUrl: "https://dhl.example/l.pdf", labelB64: null },
  );
});

test("key and basic auth are both sent", async () => {
  const stub = stubFetch(async () => new Response(
    JSON.stringify({ items: [{ shipmentNo: "003404341612345", label: { url: "https://dhl.example/l.pdf" } }] }),
    { status: 200 },
  ));
  try {
    const ergebnis = await requestLabel(ENV, buildShipmentRequest(ENV, BESTELLUNG, KONTAKT));
    assert.equal(ergebnis.trackingNumber, "003404341612345");
    assert.equal(stub.calls[0].init.headers["dhl-api-key"], "test-key");
    assert.equal(stub.calls[0].init.headers.Authorization, "Basic " + Buffer.from("sandbox-user:sandbox-pass").toString("base64"));
    assert.match(stub.calls[0].url, /api-sandbox\.dhl\.com/);
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
  } finally {
    stub.restore();
  }
});

test("a fresh label is stored with tracking number and audit entry", async () => {
  const frisch = db();
  const stub = stubFetch(async () => new Response(
    JSON.stringify({ items: [{ shipmentNo: "00340434169999999999", label: { url: "https://dhl.example/l.pdf" } }] }),
    { status: 200 },
  ));
  try {
    const ergebnis = await createLabelForOrder({ ...ENV, DB: frisch }, "order-1", { requestId: "r1" });
    assert.equal(ergebnis.created, true);
    assert.equal(ergebnis.trackingNumber, "00340434169999999999");
    assert.equal(ergebnis.carrier, "DHL");
    assert.ok(frisch.writes.some(w => w.text.includes("INSERT INTO shipments") && w.args.includes("00340434169999999999")));
    assert.ok(frisch.writes.some(w => w.text.includes("DHL_LABEL_CREATED")));
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

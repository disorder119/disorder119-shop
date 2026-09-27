import assert from "node:assert/strict";
import test from "node:test";
import shopConfig from "../config/shop-config.json" with { type: "json" };
import {
  PAKETE,
  VERSAND,
  groesseFuerArtikel,
  paketFuer,
  paketFuerArtikel,
  versandKonfigurationPruefen,
} from "./versand-config.js";
import {
  VersandError,
  artikelIdsAus,
  handleVersandOptionen,
  optionenAus,
  versandCacheLeeren,
  versandFuerBestellung,
  versandOptionen,
} from "./versand.js";
import shopWorker from "./worker.js";
import { allMigrations, sqliteD1 } from "./test-d1.mjs";

const SHOP = "https://disorder119.com";

// Packlink-Antwort fuer /v1/services (wie in packlink.test.mjs).
const SERVICES = [
  { id: 20955, name: "Classic", carrier_name: "DPD", price: { total_price: 7.85, base_price: 6.6 }, dropoff: false, delivery_to_parcelshop: false, transit_time: "2 DAYS", category: "standard" },
  { id: 23655, name: "Standard Access Point™", carrier_name: "UPS", price: { total_price: 5.71, base_price: 4.8 }, dropoff: true, delivery_to_parcelshop: false, transit_time: "2 DAYS", category: "standard" },
  { id: 11111, name: "Zustellung an Paketshop", carrier_name: "GLS", price: { total_price: 3.69, base_price: 3.1 }, dropoff: true, delivery_to_parcelshop: true, transit_time: "1 DAYS" },
  { id: 33333, name: "Express®", carrier_name: "UPS", price: { total_price: 14.28, base_price: 12 }, dropoff: false, delivery_to_parcelshop: false, transit_time: "1 DAYS", category: "express" },
];

const ITEMS = [
  { id: 9428, article: "9428", brand: "Jean Paul Gaultier", title: "Jean Paul Gaultier T-Shirt mit Print Damen Blau", price: 150, public_status: "AVAILABLE", category: "Tops", taxonomy_category: "Tops", product_type: "T-Shirt" },
  { id: 9401, article: "9401", brand: "Prada", title: "Prada Boots Damen Schwarz", price: 390, public_status: "AVAILABLE", category: "Shoes", taxonomy_category: "Shoes", product_type: "Boots" },
  { id: 9402, article: "9402", brand: "Dior", title: "Dior Jacke Herren Schwarz", price: 480, public_status: "AVAILABLE", category: "Jackets", taxonomy_category: "Jackets", product_type: "Jacket" },
];

// Nachbau von Packlink, GitHub (data/items.json) und PayPal. Merkt sich jede Anfrage.
function fakeNetz({ packlinkDown = false } = {}) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    const body = init.body && typeof init.body === "string" && init.body.startsWith("{") ? JSON.parse(init.body) : null;
    calls.push({ host: u.host, path: u.pathname, method: init.method || "GET", body });
    if (u.host === "api.packlink.com") {
      if (packlinkDown) throw new Error("packlink down");
      if (u.pathname === "/v1/services") return Response.json(SERVICES);
    }
    if (u.host === "api.github.com") {
      if (u.pathname.endsWith("/contents/data")) return Response.json([{ name: "items.json", type: "file", sha: "a".repeat(40) }]);
      if (u.pathname.endsWith(`/git/blobs/${"a".repeat(40)}`)) return new Response(JSON.stringify(ITEMS));
    }
    if (u.host === "api-m.sandbox.paypal.com") {
      if (u.pathname === "/v1/oauth2/token") return Response.json({ access_token: "paypal-test-token" });
      if (u.pathname === "/v2/checkout/orders") return Response.json({ id: "PAYPAL-ORDER-1", status: "CREATED" }, { status: 201 });
    }
    return new Response("{}", { status: 404 });
  };
  return { calls, restore() { globalThis.fetch = original; } };
}

test("the shop config is the single source for package sizes and fallback prices", () => {
  assert.deepEqual(Object.keys(PAKETE), ["S", "M", "L"]);
  for (const key of ["S", "M", "L"]) {
    const roh = shopConfig.versand.pakete[key];
    assert.equal(PAKETE[key].laenge, roh.laenge);
    assert.equal(PAKETE[key].gewichtKg, roh.gewichtKg);
    assert.equal(PAKETE[key].ersatzCents, roh.ersatzCents);
  }
  assert.equal(VERSAND.zielLand, "DE");
  assert.throws(() => versandKonfigurationPruefen({}), /VERSAND_KONFIGURATION_FEHLT/);
  const kaputt = structuredClone(shopConfig);
  kaputt.versand.pakete.M.ersatzCents = 0;
  assert.throws(() => versandKonfigurationPruefen(kaputt), /VERSAND_PAKET_UNGUELTIG_M/);
  assert.equal(paketFuer("x").key, VERSAND.standardGroesse);
});

test("package size comes from product type first, then category", () => {
  assert.equal(groesseFuerArtikel(ITEMS[0]), "S");
  assert.equal(groesseFuerArtikel(ITEMS[1]), "L"); // Boots, obwohl Kategorie Shoes = M
  assert.equal(groesseFuerArtikel(ITEMS[2]), "M");
  assert.equal(groesseFuerArtikel({}), VERSAND.standardGroesse);
  assert.equal(paketFuerArtikel([ITEMS[0]]), "S");
  assert.equal(paketFuerArtikel([ITEMS[0], ITEMS[0]]), "M"); // zwei Teile passen nicht ins kleine Paket
  assert.equal(paketFuerArtikel([ITEMS[0], ITEMS[0], ITEMS[0]]), "L");
  assert.equal(paketFuerArtikel([ITEMS[0], ITEMS[1]]), "L");
  assert.equal(paketFuerArtikel([]), VERSAND.standardGroesse);
});

test("options: cheapest home delivery as Standard, Express only when it costs more", () => {
  const angebote = [
    { id: 1, preisCents: 700, express: false },
    { id: 2, preisCents: 571, express: false },
    { id: 3, preisCents: 1428, express: true },
    { id: 4, preisCents: 1900, express: true },
    { id: 5, preisCents: 0, express: false },
  ];
  const optionen = optionenAus(angebote, "M");
  assert.deepEqual(optionen.map(o => [o.id, o.art, o.preisCents]), [["pl-M-2", "standard", 571], ["pl-M-3", "express", 1428]]);
  // Express billiger als Standard: dann gibt es nur eine Wahl.
  assert.deepEqual(optionenAus([{ id: 7, preisCents: 500, express: true }, { id: 8, preisCents: 600, express: false }], "S").map(o => o.id), ["pl-S-8"]);
  assert.deepEqual(optionenAus(null, "S"), []);
});

test("live Packlink prices are cached; without Packlink the fallback price applies", async () => {
  versandCacheLeeren();
  const netz = fakeNetz();
  try {
    const erste = await versandOptionen({}, "S");
    assert.equal(erste.quelle, "packlink");
    assert.deepEqual(erste.optionen.map(o => [o.id, o.preisCents, o.carrier]), [["pl-S-23655", 571, "UPS"], ["pl-S-33333", 1428, "UPS"]]);
    await versandOptionen({}, "S");
    assert.equal(netz.calls.filter(c => c.host === "api.packlink.com").length, 1);
    const anfrage = netz.calls[0];
    assert.equal(anfrage.path, "/v1/services");
  } finally {
    netz.restore();
  }
  versandCacheLeeren();
  const aus = fakeNetz({ packlinkDown: true });
  try {
    const ersatz = await versandOptionen({}, "L");
    assert.equal(ersatz.quelle, "ersatz");
    assert.deepEqual(ersatz.optionen.map(o => [o.id, o.preisCents]), [["ersatz-L", PAKETE.L.ersatzCents]]);
  } finally {
    aus.restore();
  }
});

test("the server checks option and price at checkout", async () => {
  versandCacheLeeren();
  const netz = fakeNetz();
  try {
    const standard = await versandFuerBestellung({}, [ITEMS[0]]);
    assert.equal(standard.id, "pl-S-23655");
    const express = await versandFuerBestellung({}, [ITEMS[0]], "pl-S-33333", 1428);
    assert.equal(express.art, "express");
    assert.equal(express.preisCents, 1428);

    // Andere Paketgroesse als beim Artikel (Stiefel = Groß): Kennung passt nicht.
    await assert.rejects(versandFuerBestellung({}, [ITEMS[1]], "pl-S-23655", 571), err => {
      assert.ok(err instanceof VersandError);
      assert.equal(err.code, "VERSAND_OPTION_UNGUELTIG");
      assert.equal(err.status, 409);
      assert.equal(err.versand.paket, "L");
      assert.ok(err.versand.optionen.length >= 1);
      return true;
    });
    // Preis im Browser manipuliert oder bei Packlink geaendert.
    await assert.rejects(versandFuerBestellung({}, [ITEMS[0]], "pl-S-23655", 1), err => err.code === "VERSAND_PREIS_GEAENDERT");
  } finally {
    netz.restore();
  }
});

test("GET /versand/optionen: size from the catalog, CORS only for the shop, strict ids", async () => {
  versandCacheLeeren();
  const netz = fakeNetz();
  const env = { KATALOG_LADEN: async () => ITEMS };
  const abfrage = async (query, { origin = SHOP, extra = {} } = {}) => {
    const req = new Request(`https://api.disorder119.com/versand/optionen${query}`, { headers: origin ? { Origin: origin } : {} });
    const res = await handleVersandOptionen(req, { ...env, ...extra }, new URL(req.url), "req-test", origin);
    return { status: res.status, cors: res.headers.get("Access-Control-Allow-Origin"), data: await res.json() };
  };
  try {
    const eins = await abfrage("?artikel=9428");
    assert.equal(eins.status, 200, JSON.stringify(eins.data));
    assert.equal(eins.cors, SHOP);
    assert.equal(eins.data.paket, "S");
    assert.equal(eins.data.paketName, "Klein");
    assert.deepEqual(eins.data.optionen.map(o => [o.id, o.titel, o.preis]), [["pl-S-23655", "Standard", "5.71"], ["pl-S-33333", "Express", "14.28"]]);
    // Keine internen Felder nach draussen.
    assert.equal("packlinkServiceId" in eins.data.optionen[0], false);

    const zwei = await abfrage("?artikel=9428,9402");
    assert.equal(zwei.data.paket, "M");
    const unbekannt = await abfrage("?artikel=9428,1");
    assert.equal(unbekannt.data.paket, "M");

    assert.equal((await abfrage("?artikel=abc")).status, 400);
    assert.equal((await abfrage("?artikel=")).status, 400);
    assert.equal((await abfrage("?artikel=" + Array.from({ length: 11 }, (_, i) => i + 1).join(","))).status, 400);
    assert.equal((await abfrage("?artikel=9428", { origin: "https://evil.example" })).status, 403);
    const gebremst = await abfrage("?artikel=9428", { extra: { RATE_LIMITER: { limit: async () => ({ success: false }) } } });
    assert.equal(gebremst.status, 429);
  } finally {
    netz.restore();
  }
});

test("create-order: chosen shipping goes into PayPal and the order, tampering is refused", async () => {
  versandCacheLeeren();
  const netz = fakeNetz();
  const DB = sqliteD1(allMigrations());
  const env = { DB, GITHUB_TOKEN: "gh-test", PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: "secret" };
  const bestellen = async (body, key) => {
    const req = new Request("https://api.disorder119.com/create-order", {
      method: "POST",
      headers: { Origin: SHOP, "Content-Type": "application/json", "Idempotency-Key": key },
      body: JSON.stringify(body),
    });
    const res = await shopWorker.fetch(req, env);
    return { status: res.status, data: await res.json() };
  };
  try {
    // Preis stimmt nicht: 409 mit aktueller Liste, nichts reserviert.
    const falsch = await bestellen({ itemId: 9428, versand: "pl-S-33333", versandPreisCents: 999 }, "k-falsch-0000000001");
    assert.equal(falsch.status, 409);
    assert.equal(falsch.data.error, "VERSAND_PREIS_GEAENDERT");
    assert.equal(falsch.data.versand.optionen[1].preisCents, 1428);
    assert.equal(DB.raw.prepare("SELECT COUNT(*) AS n FROM reservations").get().n, 0);
    assert.equal(netz.calls.filter(c => c.host === "api-m.sandbox.paypal.com").length, 0);

    const ok = await bestellen({ itemId: 9428, versand: "pl-S-33333", versandPreisCents: 1428 }, "k-richtig-000000001");
    assert.equal(ok.status, 200, JSON.stringify(ok.data));
    assert.equal(ok.data.itemPrice, "150.00");
    assert.equal(ok.data.shipping, "14.28");
    assert.equal(ok.data.total, "164.28");
    assert.equal(ok.data.versand.art, "express");

    const paypal = netz.calls.find(c => c.host === "api-m.sandbox.paypal.com" && c.path === "/v2/checkout/orders");
    assert.deepEqual(paypal.body.purchase_units[0].amount, {
      currency_code: "EUR",
      value: "164.28",
      breakdown: {
        item_total: { currency_code: "EUR", value: "150.00" },
        shipping: { currency_code: "EUR", value: "14.28" },
      },
    });
    const order = DB.raw.prepare("SELECT id,shipping_cents,total_cents FROM commerce_orders").get();
    assert.equal(order.shipping_cents, 1428);
    assert.equal(order.total_cents, 16428);
    const wahl = DB.raw.prepare("SELECT * FROM order_versand WHERE order_id=?").get(order.id);
    assert.equal(wahl.option_id, "pl-S-33333");
    assert.equal(wahl.art, "express");
    assert.equal(wahl.quelle, "packlink");
    assert.equal(wahl.packlink_service_id, 33333);
    assert.equal(wahl.paket, "S");
    assert.equal(wahl.preis_cents, 1428);

    // Derselbe Schluessel noch einmal: dieselbe Antwort, keine zweite Bestellung.
    const nochmal = await bestellen({ itemId: 9428, versand: "pl-S-33333", versandPreisCents: 1428 }, "k-richtig-000000001");
    assert.equal(nochmal.data.id, ok.data.id);
    assert.equal(DB.raw.prepare("SELECT COUNT(*) AS n FROM commerce_orders").get().n, 1);
  } finally {
    netz.restore();
  }
});

test("create-order falls back to the configured price when Packlink is down", async () => {
  versandCacheLeeren();
  const netz = fakeNetz({ packlinkDown: true });
  const DB = sqliteD1(allMigrations());
  const env = { DB, GITHUB_TOKEN: "gh-test", PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: "secret" };
  try {
    const req = new Request("https://api.disorder119.com/create-order", {
      method: "POST",
      headers: { Origin: SHOP, "Content-Type": "application/json", "Idempotency-Key": "k-ersatz-0000000001" },
      body: JSON.stringify({ itemId: 9401, versand: "ersatz-L", versandPreisCents: PAKETE.L.ersatzCents }),
    });
    const res = await shopWorker.fetch(req, env);
    const data = await res.json();
    assert.equal(res.status, 200, JSON.stringify(data));
    assert.equal(data.shipping, (PAKETE.L.ersatzCents / 100).toFixed(2));
    const wahl = DB.raw.prepare("SELECT quelle,paket,packlink_service_id FROM order_versand").get();
    assert.deepEqual({ ...wahl }, { quelle: "ersatz", paket: "L", packlink_service_id: null });
  } finally {
    netz.restore();
  }
});

test("article ids are parsed strictly", () => {
  assert.deepEqual(artikelIdsAus("1, 2,2"), ["1", "2"]);
  assert.throws(() => artikelIdsAus("1;2"), err => err.code === "ARTIKEL_UNGUELTIG");
});

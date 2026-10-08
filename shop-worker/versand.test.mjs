import assert from "node:assert/strict";
import test from "node:test";
import shopConfig from "../config/shop-config.json" with { type: "json" };
import {
  PAKETE,
  VERSAND,
  dienstErlaubt,
  groesseFuerArtikel,
  paketFuer,
  paketFuerArtikel,
  versandKonfigurationPruefen,
} from "./versand-config.js";
import {
  VersandError,
  artikelIdsAus,
  handleVersandOptionen,
  oeffentlicheOptionen,
  optionenAus,
  versandCacheLeeren,
  versandFuerBestellung,
  versandkostenfreiAnwenden,
  versandOptionen,
} from "./versand.js";
import shopWorker from "./worker.js";
import { allMigrations, sqliteD1 } from "./test-d1.mjs";

const SHOP = "https://disorder119.com";
const TEST_ADRESSE = { name: "Mara Beispiel", strasse: "Musterweg", hausnummer: "12", plz: "63739", ort: "Aschaffenburg", land: "DE" };

// Packlink-Antwort fuer /v1/services (wie in packlink.test.mjs).
const SERVICES = [
  { id: 20425, name: "Paketshop S Paket", carrier_name: "DPD", price: { total_price: 5.59, base_price: 4.7 }, dropoff: true, delivery_to_parcelshop: false, transit_time: "2 DAYS", category: "standard" },
  { id: 20955, name: "Classic", carrier_name: "DPD", price: { total_price: 7.85, base_price: 6.6 }, dropoff: false, delivery_to_parcelshop: false, transit_time: "2 DAYS", category: "standard" },
  { id: 23655, name: "Standard Access Point™", carrier_name: "UPS", price: { total_price: 5.49, base_price: 4.6 }, dropoff: true, delivery_to_parcelshop: false, transit_time: "2 DAYS", category: "standard" },
  { id: 11111, name: "Zustellung an Paketshop", carrier_name: "GLS", price: { total_price: 3.69, base_price: 3.1 }, dropoff: true, delivery_to_parcelshop: true, transit_time: "1 DAYS" },
  { id: 66666, name: "BusinessParcel", carrier_name: "GLS", price: { total_price: 6.99, base_price: 5.87 }, dropoff: true, delivery_to_parcelshop: false, transit_time: "2 DAYS", category: "standard" },
  { id: 33333, name: "Express®", carrier_name: "UPS", price: { total_price: 14.28, base_price: 12 }, dropoff: false, delivery_to_parcelshop: false, transit_time: "1 DAYS", category: "express" },
  { id: 44444, name: "Domestic Express", carrier_name: "DHL Express", price: { total_price: 32.65, base_price: 27.44 }, dropoff: false, delivery_to_parcelshop: false, transit_time: "1 DAYS", category: "express" },
  { id: 55555, name: "Express 12", carrier_name: "DPD", price: { total_price: 19.9, base_price: 16.72 }, dropoff: false, delivery_to_parcelshop: false, transit_time: "1 DAYS", category: "express" },
];

const ITEMS = [
  { id: 9428, article: "9428", brand: "Jean Paul Gaultier", title: "Jean Paul Gaultier T-Shirt mit Print Damen Blau", price: 150, public_status: "AVAILABLE", category: "Tops", taxonomy_category: "Tops", product_type: "T-Shirt" },
  { id: 9401, article: "9401", brand: "Prada", title: "Prada Boots Damen Schwarz", price: 390, public_status: "AVAILABLE", category: "Shoes", taxonomy_category: "Shoes", product_type: "Boots" },
  { id: 9402, article: "9402", brand: "Dior", title: "Dior Jacke Herren Schwarz", price: 480, public_status: "AVAILABLE", category: "Jackets", taxonomy_category: "Jackets", product_type: "Jacket" },
  // Unter der Grenze fuer versandkostenfrei (99 EUR).
  { id: 9403, article: "9403", brand: "Y-3", title: "Y-3 Logo-Shirt Schwarz", price: 60, public_status: "AVAILABLE", category: "Tops", taxonomy_category: "Tops", product_type: "T-Shirt" },
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
  const alle = { dienste: { erlaubt: null, expressMaxCents: null } };
  const optionen = optionenAus(angebote, "M", alle);
  assert.deepEqual(optionen.map(o => [o.id, o.art, o.preisCents]), [["pl-M-2", "standard", 571], ["pl-M-3", "express", 1428]]);
  // Express billiger als Standard: dann gibt es nur eine Wahl.
  assert.deepEqual(optionenAus([{ id: 7, preisCents: 500, express: true }, { id: 8, preisCents: 600, express: false }], "S", alle).map(o => o.id), ["pl-S-8"]);
  assert.deepEqual(optionenAus(null, "S", alle), []);
});

test("jeder erlaubte Paketdienst bekommt seinen guenstigsten Standard, billigster zuerst", () => {
  const angebote = [
    { id: 1, carrier: "DHL", preisCents: 699, express: false },
    { id: 2, carrier: "DPD", preisCents: 785, express: false },
    { id: 3, carrier: "DPD", preisCents: 620, express: false },
    { id: 4, carrier: "DHL", preisCents: 899, express: false },
    { id: 5, carrier: "UPS", preisCents: 400, express: false },
    { id: 6, carrier: "DPD", preisCents: 1990, express: true },
  ];
  const konfig = { dienste: { erlaubt: ["DPD", "DHL"], expressMaxCents: 2500 } };
  assert.deepEqual(optionenAus(angebote, "S", konfig).map(o => [o.id, o.art, o.carrier, o.preisCents]), [
    ["pl-S-3", "standard", "DPD", 620],
    ["pl-S-1", "standard", "DHL", 699],
    ["pl-S-6", "express", "DPD", 1990],
  ]);
});

test("only the owner's carriers reach the checkout; express only up to the price cap", () => {
  const angebote = [
    { id: 1, carrier: "UPS", preisCents: 549, express: false },
    { id: 2, carrier: "DPD", preisCents: 785, express: false },
    { id: 3, carrier: "DHL Express", preisCents: 3265, express: true },
    { id: 4, carrier: "DPD", preisCents: 1990, express: true },
    { id: 5, carrier: "UPS", preisCents: 1428, express: true },
  ];
  const konfig = { dienste: { erlaubt: ["DPD", "DHL", "HERMES"], expressMaxCents: 2500 } };
  // Guenstigster Express eines erlaubten Dienstes bis zur Grenze: DPD.
  assert.deepEqual(optionenAus(angebote, "M", konfig).map(o => [o.id, o.carrier]), [["pl-M-2", "DPD"], ["pl-M-4", "DPD"]]);
  // Ueber der Grenze gibt es kein Express, auch nicht von DHL Express.
  const teuer = { dienste: { erlaubt: ["DPD", "DHL", "HERMES"], expressMaxCents: 1500 } };
  assert.deepEqual(optionenAus(angebote, "M", teuer).map(o => o.id), ["pl-M-2"]);
  // Die echte Konfiguration (Inhaber 08.10.2026): nur Hermes, DPD, GLS und DHL.
  for (const name of ["DPD", "DHL", "GLS", "Hermes", "HERMES Germany", "DHL Paket", "DHL Express", "dpd"]) assert.equal(dienstErlaubt(name), true, name);
  for (const name of ["UPS", "UPS® Standard Service", "ups", "TNT", "TNT Express", "FedEx", "FEDEX International Economy", "Groups Logistics", "", "GLSX"]) {
    assert.equal(dienstErlaubt(name), false, name);
  }
});

test("an allow list also admits carrier variants, the block list still wins", () => {
  const angebote = [
    { id: 1, carrier: "Hermes Germany", preisCents: 499, express: false },
    { id: 2, carrier: "DHL Paket", preisCents: 619, express: false },
    { id: 3, carrier: "TNT", preisCents: 2291, express: true },
    { id: 4, carrier: "FedEx", preisCents: 1890, express: true },
    { id: 5, carrier: "GLS", preisCents: 1050, express: false },
    { id: 6, carrier: "DPD", preisCents: 785, express: false },
    { id: 7, carrier: "DHL Express", preisCents: 2390, express: true },
  ];
  const konfig = { dienste: { erlaubt: ["HERMES", "DPD", "GLS", "DHL"], ausgeschlossen: ["UPS", "TNT", "FEDEX"], expressMaxCents: 2500 } };
  assert.deepEqual(optionenAus(angebote, "M", konfig).map(o => [o.id, o.art, o.carrier]), [
    ["pl-M-1", "standard", "Hermes Germany"],
    ["pl-M-2", "standard", "DHL Paket"],
    ["pl-M-6", "standard", "DPD"],
    ["pl-M-5", "standard", "GLS"],
    ["pl-M-7", "express", "DHL Express"],
  ]);
  const gesperrt = { dienste: { erlaubt: ["DHL"], ausgeschlossen: ["DHL EXPRESS"], expressMaxCents: 2500 } };
  assert.deepEqual(optionenAus(angebote, "M", gesperrt).map(o => o.id), ["pl-M-2"]);
});

test("a block list removes UPS and Hermes, everything else reaches the checkout", () => {
  const angebote = [
    { id: 1, carrier: "UPS", preisCents: 400, express: false },
    { id: 2, carrier: "GLS", preisCents: 1050, express: false },
    { id: 3, carrier: "DPD", preisCents: 785, express: false },
    { id: 4, carrier: "Hermes", preisCents: 500, express: false },
    { id: 5, carrier: "UPS® Express Saver", preisCents: 1200, express: true },
    { id: 6, carrier: "DHL Express", preisCents: 2100, express: true },
  ];
  const konfig = { dienste: { erlaubt: null, ausgeschlossen: ["UPS", "HERMES"], expressMaxCents: 2500 } };
  assert.deepEqual(optionenAus(angebote, "M", konfig).map(o => [o.id, o.carrier]),
    [["pl-M-3", "DPD"], ["pl-M-2", "GLS"], ["pl-M-6", "DHL Express"]]);
});

test("live Packlink prices are cached; without Packlink the fallback price applies", async () => {
  versandCacheLeeren();
  const netz = fakeNetz();
  try {
    const erste = await versandOptionen({}, "S");
    assert.equal(erste.quelle, "packlink");
    assert.deepEqual(erste.optionen.map(o => [o.id, o.preisCents, o.carrier]), [["pl-S-20425", 559, "DPD"], ["pl-S-66666", 699, "GLS"], ["pl-S-55555", 1990, "DPD"]]);
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
    assert.equal(standard.id, "pl-S-20425");
    const express = await versandFuerBestellung({}, [ITEMS[0]], "pl-S-55555", 1990);
    assert.equal(express.art, "express");
    assert.equal(express.preisCents, 1990);
    // UPS steht nicht zur Wahl, auch nicht per manipulierter Anfrage.
    await assert.rejects(versandFuerBestellung({}, [ITEMS[0]], "pl-S-23655", 549), err => err.code === "VERSAND_OPTION_UNGUELTIG");

    // Andere Paketgroesse als beim Artikel (Stiefel = Groß): Kennung passt nicht.
    await assert.rejects(versandFuerBestellung({}, [ITEMS[1]], "pl-S-20425", 559), err => {
      assert.ok(err instanceof VersandError);
      assert.equal(err.code, "VERSAND_OPTION_UNGUELTIG");
      assert.equal(err.status, 409);
      assert.equal(err.versand.paket, "L");
      assert.ok(err.versand.optionen.length >= 1);
      return true;
    });
    // Preis im Browser manipuliert oder bei Packlink geaendert.
    await assert.rejects(versandFuerBestellung({}, [ITEMS[0]], "pl-S-20425", 1), err => err.code === "VERSAND_PREIS_GEAENDERT");

    // Ab 99 EUR Warenwert: der guenstigste Standard kostet nichts, die
    // anderen Dienste nur den Aufpreis.
    const frei = await versandFuerBestellung({}, [ITEMS[0]], "pl-S-20425", 0, 15000);
    assert.equal(frei.preisCents, 0);
    assert.equal(frei.listenpreisCents, 559);
    assert.equal((await versandFuerBestellung({}, [ITEMS[0]], "pl-S-66666", 140, 15000)).preisCents, 140);
    assert.equal((await versandFuerBestellung({}, [ITEMS[0]], "pl-S-55555", 1431, 15000)).preisCents, 1431);
    // Wer den alten Preis gesehen hat, bekommt die neue Liste.
    await assert.rejects(versandFuerBestellung({}, [ITEMS[0]], "pl-S-20425", 559, 15000), err => {
      assert.equal(err.code, "VERSAND_PREIS_GEAENDERT");
      assert.deepEqual(err.versand.frei, { abCents: 9900, warenwertCents: 15000, erreicht: true, fehltCents: 0 });
      return true;
    });
    // Knapp darunter: voller Preis, 0 Cent wird abgelehnt.
    assert.equal((await versandFuerBestellung({}, [ITEMS[3]], "pl-S-20425", 559, 9899)).preisCents, 559);
    await assert.rejects(versandFuerBestellung({}, [ITEMS[3]], "pl-S-20425", 0, 9899), err => err.code === "VERSAND_PREIS_GEAENDERT");
  } finally {
    netz.restore();
  }
});

test("versandkostenfrei: only the cheapest standard is free, the rest costs the difference", () => {
  const ergebnis = { paket: "M", quelle: "packlink", optionen: [
    { id: "pl-M-1", art: "standard", preisCents: 785 },
    { id: "pl-M-2", art: "standard", preisCents: 1050 },
    { id: "pl-M-3", art: "express", preisCents: 2291 },
  ] };
  const konfig = { versandkostenfrei: { abCents: 9900 } };
  const frei = versandkostenfreiAnwenden(ergebnis, 9900, konfig);
  assert.deepEqual(frei.optionen.map(o => [o.id, o.preisCents, o.listenpreisCents]), [["pl-M-1", 0, 785], ["pl-M-2", 265, 1050], ["pl-M-3", 1506, 2291]]);
  assert.deepEqual(frei.frei, { abCents: 9900, warenwertCents: 9900, erreicht: true });
  const darunter = versandkostenfreiAnwenden(ergebnis, 9000, konfig);
  assert.equal(darunter.optionen, ergebnis.optionen);
  assert.equal(oeffentlicheOptionen(darunter).frei.fehltCents, 900);
  // Ohne Grenze in der Konfiguration bleibt alles, wie es ist - auch ohne frei-Block.
  assert.equal(versandkostenfreiAnwenden(ergebnis, 50000, {}), ergebnis);
  assert.equal("frei" in oeffentlicheOptionen(ergebnis), false);
  // Ersatzpreis (Packlink fehlt): auch der wird uebernommen.
  const ersatz = versandkostenfreiAnwenden({ paket: "S", quelle: "ersatz", optionen: [{ id: "ersatz-S", art: "standard", preisCents: 590 }] }, 12000, konfig);
  assert.equal(ersatz.optionen[0].preisCents, 0);
  // Die echte Konfiguration: ab 99 Euro.
  assert.deepEqual(VERSAND.versandkostenfrei, { abCents: 9900 });
  const kaputt = structuredClone(shopConfig);
  kaputt.versand.versandkostenfrei = { abCents: "99" };
  assert.throws(() => versandKonfigurationPruefen(kaputt), /VERSAND_VERSANDKOSTENFREI_UNGUELTIG/);
  delete kaputt.versand.versandkostenfrei;
  assert.equal(versandKonfigurationPruefen(kaputt).versandkostenfrei, null);
});

test("public options carry the expected delivery window", () => {
  const ergebnis = { paket: "M", quelle: "packlink", optionen: [
    { id: "pl-M-1", art: "standard", titel: "Standard", preisCents: 785, laufzeit: "2 Tage", carrier: "DPD" },
    { id: "ersatz-M", art: "standard", titel: "Standard", preisCents: 850, laufzeit: "", carrier: "" },
  ] };
  // Mittwoch, 7. Oktober 2026: Versand bis Montag, dazu 2 Tage Laufzeit.
  const daten = oeffentlicheOptionen(ergebnis, new Date("2026-10-07T10:00:00Z"));
  assert.deepEqual(daten.optionen[0].lieferung, { von: "2026-10-12", bis: "2026-10-14" });
  assert.equal(daten.optionen[1].lieferung, null);
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
    // 150 EUR: der guenstigste Standard ist kostenlos, der Rest kostet den Aufpreis.
    assert.deepEqual(eins.data.optionen.map(o => [o.id, o.titel, o.preis, o.carrier]), [["pl-S-20425", "Standard", "0.00", "DPD"], ["pl-S-66666", "Standard", "1.40", "GLS"], ["pl-S-55555", "Express", "14.31", "DPD"]]);
    assert.deepEqual(eins.data.frei, { abCents: 9900, warenwertCents: 15000, erreicht: true, fehltCents: 0 });
    assert.match(eins.data.optionen[0].lieferung.von, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(eins.data.optionen[0].lieferung.von < eins.data.optionen[0].lieferung.bis);
    // Keine internen Felder nach draussen.
    assert.equal("packlinkServiceId" in eins.data.optionen[0], false);
    assert.equal("listenpreisCents" in eins.data.optionen[0], false);

    // 60 EUR: volle Preise und wie viel bis zur Grenze fehlt.
    const guenstig = await abfrage("?artikel=9403");
    assert.deepEqual(guenstig.data.optionen.map(o => o.preis), ["5.59", "6.99", "19.90"]);
    assert.deepEqual(guenstig.data.frei, { abCents: 9900, warenwertCents: 6000, erreicht: false, fehltCents: 3900 });
    // Zwei Stuecke zusammen ueber der Grenze.
    assert.equal((await abfrage("?artikel=9403,9428")).data.frei.erreicht, true);

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
      body: JSON.stringify({ email: "kundin@example.com", adresse: TEST_ADRESSE, ...body }),
    });
    const res = await shopWorker.fetch(req, env);
    return { status: res.status, data: await res.json() };
  };
  try {
    // Preis stimmt nicht: 409 mit aktueller Liste, nichts reserviert. Ab
    // 99 EUR kostet Express nur den Aufpreis zum Standard (19,90 - 5,59).
    const falsch = await bestellen({ itemId: 9428, versand: "pl-S-55555", versandPreisCents: 1990 }, "k-falsch-0000000001");
    assert.equal(falsch.status, 409);
    assert.equal(falsch.data.error, "VERSAND_PREIS_GEAENDERT");
    assert.equal(falsch.data.versand.optionen.find(o => o.id === "pl-S-55555").preisCents, 1431);
    assert.equal(DB.raw.prepare("SELECT COUNT(*) AS n FROM reservations").get().n, 0);
    assert.equal(netz.calls.filter(c => c.host === "api-m.sandbox.paypal.com").length, 0);

    const ok = await bestellen({ itemId: 9428, versand: "pl-S-55555", versandPreisCents: 1431 }, "k-richtig-000000001");
    assert.equal(ok.status, 200, JSON.stringify(ok.data));
    assert.equal(ok.data.itemPrice, "150.00");
    assert.equal(ok.data.shipping, "14.31");
    assert.equal(ok.data.total, "164.31");
    assert.equal(ok.data.versand.art, "express");

    const paypal = netz.calls.find(c => c.host === "api-m.sandbox.paypal.com" && c.path === "/v2/checkout/orders");
    assert.deepEqual(paypal.body.purchase_units[0].amount, {
      currency_code: "EUR",
      value: "164.31",
      breakdown: {
        item_total: { currency_code: "EUR", value: "150.00" },
        shipping: { currency_code: "EUR", value: "14.31" },
      },
    });
    const order = DB.raw.prepare("SELECT id,shipping_cents,total_cents FROM commerce_orders").get();
    assert.equal(order.shipping_cents, 1431);
    assert.equal(order.total_cents, 16431);
    const wahl = DB.raw.prepare("SELECT * FROM order_versand WHERE order_id=?").get(order.id);
    assert.equal(wahl.option_id, "pl-S-55555");
    assert.equal(wahl.art, "express");
    assert.equal(wahl.quelle, "packlink");
    assert.equal(wahl.packlink_service_id, 55555);
    assert.equal(wahl.carrier, "DPD");
    assert.equal(wahl.paket, "S");
    assert.equal(wahl.preis_cents, 1431);

    // Derselbe Schluessel noch einmal: dieselbe Antwort, keine zweite Bestellung.
    const nochmal = await bestellen({ itemId: 9428, versand: "pl-S-55555", versandPreisCents: 1431 }, "k-richtig-000000001");
    assert.equal(nochmal.data.id, ok.data.id);
    assert.equal(DB.raw.prepare("SELECT COUNT(*) AS n FROM commerce_orders").get().n, 1);
  } finally {
    netz.restore();
  }
});

test("create-order: from 99 EUR the cheapest standard costs nothing, below it the full price", async () => {
  versandCacheLeeren();
  const netz = fakeNetz();
  const DB = sqliteD1(allMigrations());
  const env = { DB, GITHUB_TOKEN: "gh-test", PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: "secret" };
  const bestellen = async (body, key) => {
    const req = new Request("https://api.disorder119.com/create-order", {
      method: "POST",
      headers: { Origin: SHOP, "Content-Type": "application/json", "Idempotency-Key": key },
      body: JSON.stringify({ email: "kundin@example.com", adresse: TEST_ADRESSE, ...body }),
    });
    const res = await shopWorker.fetch(req, env);
    return { status: res.status, data: await res.json() };
  };
  try {
    // 60 EUR: 0 Cent Versand gibt es nicht.
    const darunter = await bestellen({ itemId: 9403, versand: "pl-S-20425", versandPreisCents: 0 }, "k-frei-unter-000001");
    assert.equal(darunter.status, 409);
    assert.equal(darunter.data.error, "VERSAND_PREIS_GEAENDERT");
    assert.equal(darunter.data.versand.frei.fehltCents, 3900);

    const frei = await bestellen({ itemId: 9428, versand: "pl-S-20425", versandPreisCents: 0 }, "k-frei-ueber-000001");
    assert.equal(frei.status, 200, JSON.stringify(frei.data));
    assert.equal(frei.data.shipping, "0.00");
    assert.equal(frei.data.total, "150.00");
    const paypal = netz.calls.find(c => c.host === "api-m.sandbox.paypal.com" && c.path === "/v2/checkout/orders");
    assert.deepEqual(paypal.body.purchase_units[0].amount, {
      currency_code: "EUR",
      value: "150.00",
      breakdown: {
        item_total: { currency_code: "EUR", value: "150.00" },
        shipping: { currency_code: "EUR", value: "0.00" },
      },
    });
    const order = DB.raw.prepare("SELECT id,shipping_cents,total_cents FROM commerce_orders").get();
    assert.deepEqual({ ...order, id: undefined }, { id: undefined, shipping_cents: 0, total_cents: 15000 });
    const wahl = DB.raw.prepare("SELECT option_id,art,preis_cents FROM order_versand WHERE order_id=?").get(order.id);
    assert.deepEqual({ ...wahl }, { option_id: "pl-S-20425", art: "standard", preis_cents: 0 });
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
      // 60 EUR: unter der Grenze fuer versandkostenfrei, also Ersatzpreis.
      body: JSON.stringify({ itemId: 9403, email: "kundin@example.com", adresse: TEST_ADRESSE,
        versand: "ersatz-S", versandPreisCents: PAKETE.S.ersatzCents }),
    });
    const res = await shopWorker.fetch(req, env);
    const data = await res.json();
    assert.equal(res.status, 200, JSON.stringify(data));
    assert.equal(data.shipping, (PAKETE.S.ersatzCents / 100).toFixed(2));
    const wahl = DB.raw.prepare("SELECT quelle,paket,packlink_service_id FROM order_versand").get();
    assert.deepEqual({ ...wahl }, { quelle: "ersatz", paket: "S", packlink_service_id: null });
  } finally {
    netz.restore();
  }
});

test("article ids are parsed strictly", () => {
  assert.deepEqual(artikelIdsAus("1, 2,2"), ["1", "2"]);
  assert.throws(() => artikelIdsAus("1;2"), err => err.code === "ARTIKEL_UNGUELTIG");
});

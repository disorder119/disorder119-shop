// EU-Kasse (Inhaber 28.10.2026): Lieferung in alle EU-Laender ohne Zoll,
// Preise nach DHL "Paket EU", versandkostenfrei nur in Deutschland,
// Packstation und Filiale nur in Deutschland.
import assert from "node:assert/strict";
import test from "node:test";
import shopWorker, { lieferadresseAus } from "./worker.js";
import { festeOptionen, handleVersandOptionen, lieferlandAus, oeffentlicheOptionen, versandCacheLeeren, versandFuerBestellung,
  versandkostenfreiAnwenden, versandOptionen } from "./versand.js";
import { VERSAND, lieferlaender, versandKonfigurationPruefen, zoneFuerLand } from "./versand-config.js";
import { iso3, landName, lateinTauglich, plzNormalisieren, plzSondergebiet } from "./laender.js";
import { lieferfenster } from "./lieferzeit.js";
import { allMigrations, sqliteD1 } from "./test-d1.mjs";
import shopConfig from "../config/shop-config.json" with { type: "json" };

const SHOP = "https://disorder119.com";
const EU = ["AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SE", "SK", "SI", "ES"];
const ITEMS = [
  { id: 9428, article: "9428", brand: "Jean Paul Gaultier", title: "Jean Paul Gaultier T-Shirt Damen Blau", price: 150, public_status: "AVAILABLE", taxonomy_category: "Tops", product_type: "T-Shirt" },
  { id: 9427, article: "9427", brand: "Jean Paul Gaultier", title: "Jean Paul Gaultier Jeans Damen Marineblau", price: 90, public_status: "AVAILABLE", taxonomy_category: "Pants", product_type: "Trousers" },
  { id: 9420, article: "9420", brand: "Hermès", title: "Hermès Mantel Damen Schwarz", price: 1500, public_status: "AVAILABLE", taxonomy_category: "Coats", product_type: "Coat" },
];

test("Liefergebiet: Deutschland und die 26 anderen EU-Laender, sonst nichts", () => {
  assert.deepEqual(lieferlaender(), ["DE", ...[...EU].sort()]);
  assert.equal(zoneFuerLand("DE").key, "DE");
  for (const land of EU) assert.equal(zoneFuerLand(land)?.key, "EU", land);
  for (const land of ["CH", "GB", "NO", "US", "RS", "UA", "MC", "JP", "LY", ""]) assert.equal(zoneFuerLand(land), null, land);
  assert.equal(lieferlandAus("fr"), "FR");
  assert.throws(() => lieferlandAus("CH"), err => err.code === "LAND_NICHT_BELIEFERT" && err.status === 422);
  assert.throws(() => lieferlandAus("FRA"), err => err.code === "LAND_UNGUELTIG");
  for (const land of ["DE", ...EU]) assert.match(iso3(land), /^[A-Z]{3}$/, land);
  assert.equal(iso3("FR"), "FRA");
  assert.equal(landName("IT"), "Italien");
  assert.equal(landName("IT", "fr"), "Italie");
});

test("PLZ je Land in der Schreibweise der Post; Sondergebiete mit Zoll erkannt", () => {
  const faelle = [["DE", "63739", "63739"], ["AT", "1010", "1010"], ["FR", "75002", "75002"], ["NL", "1015cj", "1015 CJ"],
    ["PL", "00950", "00-950"], ["PT", "1100-148", "1100-148"], ["CZ", "11000", "110 00"], ["SE", "114 55", "114 55"],
    ["GR", "10557", "105 57"], ["LV", "LV-1050", "LV-1050"], ["LT", "01100", "LT-01100"], ["LU", "L-1450", "1450"],
    ["MT", "vlt1117", "VLT 1117"], ["IE", "d02x285", "D02 X285"], ["RO", "010011", "010011"], ["IT", "00184", "00184"]];
  for (const [land, eingabe, erwartet] of faelle) assert.equal(plzNormalisieren(land, eingabe), erwartet, `${land} ${eingabe}`);
  for (const [land, falsch] of [["DE", "6373"], ["AT", "10100"], ["NL", "1015"], ["IE", "12345"], ["FR", "7500A"], ["CH", "8001"]]) {
    assert.equal(plzNormalisieren(land, falsch), null, `${land} ${falsch}`);
  }
  for (const [land, plz] of [["ES", "35001"], ["ES", "38001"], ["ES", "51001"], ["FR", "97110"], ["FR", "98000"], ["FI", "22100"], ["IT", "23041"], ["GR", "630 86"]]) {
    assert.equal(plzSondergebiet(land, plz), true, `${land} ${plz}`);
  }
  for (const [land, plz] of [["ES", "28001"], ["FR", "75002"], ["FI", "00100"], ["IT", "20121"]]) assert.equal(plzSondergebiet(land, plz), false);
  assert.equal(lateinTauglich("Łukasz Świątek, Ulica Długa 5"), true);
  assert.equal(lateinTauglich("Γιώργος Παπαδόπουλος"), false);
  assert.equal(lateinTauglich("Иван Петров"), false);
});

test("EU-Preise: DHL Paket EU je Klasse, Hoeherversicherung in 1.000-EUR-Stufen, kein Gratisversand", () => {
  const kurz = (paket, land) => festeOptionen(paket, VERSAND, land).map(o => [o.id, o.preisCents, o.versichertBisCents]);
  assert.deepEqual(festeOptionen("S", VERSAND, "FR").map(o => o.preisCents).slice(0, 1), [1449]);
  assert.deepEqual(["S", "M", "L", "XL", "XXL"].map(k => festeOptionen(k, VERSAND, "IT")[0].preisCents), [1449, 1749, 2249, 2849, 4549]);
  assert.deepEqual(kurz("S", "DE"), [["fest-dhl-S", 619, 50000], ["fest-dhl-versichert-S", 1318, 250000]], "Deutschland unveraendert");
  assert.ok(festeOptionen("M", VERSAND, "AT").every(o => o.zone === "EU" && o.abholstation === false && o.carrier === "DHL"));
  // Laufzeit je Land als Spanne.
  const italien = festeOptionen("S", VERSAND, "IT")[0];
  assert.deepEqual([italien.laufzeit, italien.laufzeitVon, italien.laufzeitBis], ["2–4 Tage", 2, 4]);
  assert.equal(festeOptionen("S", VERSAND, "AT")[0].laufzeit, "2 Tage");
  assert.deepEqual(festeOptionen("S", VERSAND, "CH"), []);

  const roh = { paket: "S", quelle: "fest", optionen: festeOptionen("S", VERSAND, "FR"), land: "FR", zone: "EU" };
  const stufe = wert => versandkostenfreiAnwenden(roh, wert).optionen.map(o => [o.id, o.preisCents, o.versichertBisCents]);
  // 150 EUR: kein Gratisversand in der EU, keine Hoeherversicherung.
  assert.deepEqual(stufe(15000), [["fest-dhl-eu-S", 1449, 50000]]);
  assert.equal(versandkostenfreiAnwenden(roh, 15000).frei, undefined, "kein 'noch X bis kostenlos' in der EU");
  assert.deepEqual(stufe(50000), [["fest-dhl-eu-S", 1449, 50000]]);
  assert.deepEqual(stufe(80000), [["fest-dhl-eu-S", 1449, 50000], ["fest-dhl-eu-hv1000-S", 2849, 100000]]);
  assert.deepEqual(stufe(100001), [["fest-dhl-eu-S", 1449, 50000], ["fest-dhl-eu-hv2000-S", 4249, 200000]]);
  assert.deepEqual(stufe(450000), [["fest-dhl-eu-S", 1449, 50000], ["fest-dhl-eu-hv5000-S", 8449, 500000]]);
  assert.deepEqual(stufe(900000).map(o => o[0]), ["fest-dhl-eu-S", "fest-dhl-eu-hv5000-S"], "ueber 5.000 EUR: hoechste Stufe");

  const oeffentlich = oeffentlicheOptionen(versandkostenfreiAnwenden(roh, 15000), new Date("2026-10-28T10:00:00Z"));
  assert.equal(oeffentlich.land, "FR");
  assert.equal(oeffentlich.zone, "EU");
  assert.equal(oeffentlich.laender.length, 27);
  assert.deepEqual(oeffentlich.optionen.map(o => [o.tage, o.tageBis, o.abholstation]), [[2, 3, false]]);
  assert.deepEqual(oeffentlich.optionen[0].lieferung, lieferfenster(2, new Date("2026-10-28T10:00:00Z"), 3));
});

test("Konfiguration: Zonen werden streng geprueft", () => {
  const kaputt = (aendern, muster) => {
    const roh = structuredClone(shopConfig);
    aendern(roh.versand);
    assert.throws(() => versandKonfigurationPruefen(roh), muster);
  };
  kaputt(v => { v.zonen.EU.laender.push("DE"); }, /VERSAND_ZONE_LAND_UNGUELTIG_DE/);
  kaputt(v => { v.zonen.EU.laender.push("CH"); }, /VERSAND_ZONE_LAND_UNGUELTIG_CH/);
  kaputt(v => { v.zonen.EU.laufzeitTage.FR = [4, 2]; }, /VERSAND_ZONE_LAUFZEIT_UNGUELTIG_FR/);
  kaputt(v => { v.tarife.liste = v.tarife.liste.filter(t => t.id !== "dhl-eu"); }, /VERSAND_ZONE_OHNE_TARIF_EU/);
  kaputt(v => { v.tarife.liste[0].zone = "XX"; }, /VERSAND_TARIF_ZONE_dhl/);
  kaputt(v => { v.versandkostenfrei.zonen = ["XX"]; }, /VERSAND_VERSANDKOSTENFREI_ZONE_UNGUELTIG/);
  // Ohne Zonen-Block: nur Deutschland, wie vor der EU-Kasse.
  const alt = structuredClone(shopConfig);
  delete alt.versand.zonen;
  alt.versand.tarife.liste = alt.versand.tarife.liste.filter(t => !t.zone);
  delete alt.versand.versandkostenfrei.zonen;
  const k = versandKonfigurationPruefen(alt);
  assert.deepEqual(Object.keys(k.zonen), ["DE"]);
  assert.deepEqual(k.versandkostenfrei.zonen, ["DE"]);
  // Packstation nur in Deutschland, auch wenn ein EU-Tarif sie versehentlich verspricht.
  const abhol = structuredClone(shopConfig);
  abhol.versand.tarife.liste.find(t => t.id === "dhl-eu").abholstation = true;
  assert.equal(versandKonfigurationPruefen(abhol).tarife.find(t => t.id === "dhl-eu").abholstation, false);
});

test("GET /versand/optionen?land=: Preise fuer das Lieferland, unbelieferte Laender mit Liste abgelehnt", async () => {
  versandCacheLeeren();
  const env = { KATALOG_LADEN: async () => ITEMS };
  const abfrage = async query => {
    const url = new URL(`https://api.disorder119.com/versand/optionen?${query}`);
    const res = await handleVersandOptionen(new Request(url, { headers: { Origin: SHOP } }), env, url, "r", SHOP);
    return { status: res.status, data: await res.json() };
  };
  const de = await abfrage("artikel=9428");
  assert.deepEqual(de.data.optionen.map(o => [o.id, o.preisCents]), [["fest-dhl-S", 0]], "ab 99 EUR in DE kostenlos");
  assert.equal(de.data.land, "DE");
  const fr = await abfrage("artikel=9428&land=FR");
  assert.deepEqual(fr.data.optionen.map(o => [o.id, o.preisCents, o.abholstation]), [["fest-dhl-eu-S", 1449, false]]);
  assert.equal(fr.data.frei, undefined);
  const mantel = await abfrage("artikel=9420&land=AT");
  assert.deepEqual(mantel.data.optionen.map(o => [o.id, o.preisCents]), [["fest-dhl-eu-M", 1749], ["fest-dhl-eu-hv2000-M", 4549]]);
  const ch = await abfrage("artikel=9428&land=CH");
  assert.equal(ch.status, 422);
  assert.equal(ch.data.error, "LAND_NICHT_BELIEFERT");
  assert.equal(ch.data.laender[0], "DE");
  assert.equal((await abfrage("artikel=9428&land=xx1")).status, 400);
});

test("Bestellung: Preis gilt nur fuer das Land, fuer das er gezeigt wurde", async () => {
  versandCacheLeeren();
  const env = {};
  const jeans = [ITEMS[1]];
  assert.equal((await versandFuerBestellung(env, jeans, "fest-dhl-eu-S", 1449, 9000, "IT")).preisCents, 1449);
  // Deutscher Preis, aber Lieferung nach Italien: 409 mit der italienischen Liste.
  await assert.rejects(versandFuerBestellung(env, jeans, "fest-dhl-S", 619, 9000, "IT"), err => {
    assert.equal(err.code, "VERSAND_OPTION_UNGUELTIG");
    assert.deepEqual(err.versand.optionen.map(o => o.id), ["fest-dhl-eu-S"]);
    assert.equal(err.versand.land, "IT");
    return true;
  });
  await assert.rejects(versandFuerBestellung(env, jeans, "fest-dhl-eu-S", 619, 9000, "IT"), err => err.code === "VERSAND_PREIS_GEAENDERT");
  await assert.rejects(versandFuerBestellung(env, jeans, "fest-dhl-eu-S", 1449, 9000, "CH"), err => err.code === "LAND_NICHT_BELIEFERT");
  // Packlink-Rueckfall: nur Deutschland.
  await assert.rejects(versandOptionen({ VERSAND_QUELLE: "packlink" }, "S", "FR"), err => err.code === "LAND_NICHT_BELIEFERT");
});

test("Lieferadresse: EU-Formate, Sondergebiete und nicht-lateinische Schrift", () => {
  const basis = { name: "Giulia Rossi", strasse: "Via Roma", hausnummer: "12", zusatz: "", plz: "00184", ort: "Roma", land: "IT" };
  assert.deepEqual(lieferadresseAus(basis), basis);
  assert.equal(lieferadresseAus({ ...basis, land: "NL", plz: "1015cj", ort: "Amsterdam" }).plz, "1015 CJ");
  assert.equal(lieferadresseAus({ ...basis, land: "FR", hausnummer: "12 bis", plz: "75002", ort: "Paris" }).hausnummer, "12bis");
  assert.equal(lieferadresseAus({ ...basis, land: "ES", hausnummer: "s/n", plz: "28013", ort: "Madrid" }).hausnummer, "s/n");
  assert.equal(lieferadresseAus({ ...basis, land: "IE", hausnummer: "", plz: "D02 X285", ort: "Dublin" }).hausnummer, "", "Irland ohne Hausnummer");
  const fehler = roh => { try { lieferadresseAus(roh); return null; } catch (err) { return err.code; } };
  assert.equal(fehler({ ...basis, hausnummer: "" }), "ADRESSE_UNVOLLSTAENDIG");
  assert.equal(fehler({ ...basis, plz: "0018" }), "ADRESSE_UNVOLLSTAENDIG");
  assert.equal(fehler({ ...basis, land: "ES", plz: "35001", ort: "Las Palmas" }), "SONDERGEBIET_NICHT_BELIEFERT");
  assert.equal(fehler({ ...basis, land: "FR", plz: "97110", ort: "Pointe-à-Pitre" }), "SONDERGEBIET_NICHT_BELIEFERT");
  assert.equal(fehler({ ...basis, land: "GR", name: "Γιώργος Παπαδόπουλος", plz: "10557", ort: "Athina" }), "ADRESSE_NUR_LATEIN");
  assert.equal(fehler({ ...basis, land: "GB", plz: "SW1A 1AA" }), "LAND_NICHT_BELIEFERT");
  assert.equal(fehler({ ...basis, land: "D" }), "LAND_NICHT_BELIEFERT");
});

// Nachbau von GitHub (data/items.json) und PayPal - wie in kasse.test.mjs.
function fakeNetz() {
  const calls = [];
  const original = globalThis.fetch;
  let n = 0;
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    const body = typeof init.body === "string" && init.body.startsWith("{") ? JSON.parse(init.body) : null;
    calls.push({ host: u.host, path: u.pathname, method: init.method || "GET", body });
    if (u.host === "api.github.com") {
      if (u.pathname.endsWith("/contents/data")) return Response.json([{ name: "items.json", type: "file", sha: "b".repeat(40) }]);
      if (u.pathname.endsWith(`/git/blobs/${"b".repeat(40)}`)) return new Response(JSON.stringify(ITEMS));
    }
    if (u.host === "api-m.sandbox.paypal.com") {
      if (u.pathname === "/v1/oauth2/token") return Response.json({ access_token: "tok" });
      if (u.pathname === "/v2/checkout/orders") return Response.json({ id: `PAYPAL-EU-${++n}`, status: "CREATED" }, { status: 201 });
    }
    return new Response("{}", { status: 404 });
  };
  return { calls, restore() { globalThis.fetch = original; } };
}

async function bestellen(env, body, key) {
  const res = await shopWorker.fetch(new Request("https://api.disorder119.com/create-order", {
    method: "POST",
    headers: { Origin: SHOP, "Content-Type": "application/json", "Idempotency-Key": key },
    body: JSON.stringify({ email: "kundin@example.com", ...body }),
  }), env);
  return { status: res.status, data: await res.json() };
}

test("create-order nach Frankreich: EU-Preis, Land in PayPal und in der Bestellung, kein Gratisversand", async () => {
  versandCacheLeeren();
  const netz = fakeNetz();
  const DB = sqliteD1(allMigrations());
  const env = { DB, GITHUB_TOKEN: "gh-test", PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: "secret" };
  const adresse = { name: "Élodie Lefèvre", strasse: "Rue de la Paix", hausnummer: "12bis", zusatz: "Bâtiment B", plz: "75002", ort: "Paris", land: "FR" };
  try {
    // Deutscher Gratis-Preis fuer eine franzoesische Adresse: abgelehnt, mit EU-Liste.
    const falsch = await bestellen(env, { itemIds: [9428], adresse, versand: "fest-dhl-S", versandPreisCents: 0 }, "k-eu-0000000000001");
    assert.equal(falsch.status, 409);
    assert.equal(falsch.data.error, "VERSAND_OPTION_UNGUELTIG");
    assert.deepEqual(falsch.data.versand.optionen.map(o => [o.id, o.preisCents]), [["fest-dhl-eu-S", 1449]]);
    assert.equal(DB.raw.prepare("SELECT COUNT(*) AS n FROM reservations").get().n, 0);

    const ok = await bestellen(env, { itemIds: [9428], adresse, versand: "fest-dhl-eu-S", versandPreisCents: 1449 }, "k-eu-0000000000002");
    assert.equal(ok.status, 200, JSON.stringify(ok.data));
    assert.equal(ok.data.shipping, "14.49");
    assert.equal(ok.data.total, "164.49");
    assert.equal(ok.data.versand.land, "FR");
    const paypal = netz.calls.find(c => c.host === "api-m.sandbox.paypal.com" && c.path === "/v2/checkout/orders");
    assert.deepEqual(paypal.body.purchase_units[0].shipping.address, {
      address_line_1: "Rue de la Paix 12bis", address_line_2: "Bâtiment B", admin_area_2: "Paris", postal_code: "75002", country_code: "FR",
    });
    assert.equal(paypal.body.purchase_units[0].amount.breakdown.shipping.value, "14.49");
    const kontakt = DB.raw.prepare("SELECT address_line1,postal_code,city,country_code FROM order_contact_snapshots").get();
    assert.deepEqual({ ...kontakt }, { address_line1: "Rue de la Paix 12bis", postal_code: "75002", city: "Paris", country_code: "FR" });
    const wahl = DB.raw.prepare("SELECT option_id,preis_cents,zustellart FROM order_versand").get();
    assert.deepEqual({ ...wahl }, { option_id: "fest-dhl-eu-S", preis_cents: 1449, zustellart: "haustuer" });
  } finally {
    netz.restore();
  }
});

test("create-order: Packstation nur in Deutschland, Schweiz nur auf Anfrage", async () => {
  versandCacheLeeren();
  const netz = fakeNetz();
  const env = { DB: sqliteD1(allMigrations()), GITHUB_TOKEN: "gh-test", PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: "secret" };
  const packstation = { art: "packstation", postnummer: "12345678",
    abholort: { nummer: "162", name: "Packstation 162", strasse: "Hanauer Str. 2", plz: "63739", ort: "Aschaffenburg" } };
  try {
    const abhol = await bestellen(env, { itemIds: [9427], adresse: { name: "Anna Gruber", land: "AT" }, zustellung: packstation,
      versand: "fest-dhl-eu-S", versandPreisCents: 1449 }, "k-eu-0000000000003");
    assert.equal(abhol.status, 422);
    assert.equal(abhol.data.error, "ABHOLSTATION_NUR_DE");
    const schweiz = await bestellen(env, { itemIds: [9427], adresse: { name: "Anna Gruber", strasse: "Bahnhofstrasse", hausnummer: "1", plz: "8001", ort: "Zürich", land: "CH" },
      versand: "fest-dhl-eu-S", versandPreisCents: 1449 }, "k-eu-0000000000004");
    assert.equal(schweiz.status, 422);
    assert.equal(schweiz.data.error, "LAND_NICHT_BELIEFERT");
    assert.equal(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM reservations").get().n, 0);
    assert.equal(netz.calls.filter(c => c.host === "api-m.sandbox.paypal.com").length, 0);
  } finally {
    netz.restore();
  }
});

test("PayPal lehnt eine EU-Anschrift ab: klare Meldung, Stuecke sofort wieder frei", async () => {
  versandCacheLeeren();
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    if (u.host === "api.github.com") {
      if (u.pathname.endsWith("/contents/data")) return Response.json([{ name: "items.json", type: "file", sha: "b".repeat(40) }]);
      if (u.pathname.endsWith(`/git/blobs/${"b".repeat(40)}`)) return new Response(JSON.stringify(ITEMS));
    }
    if (u.host === "api-m.sandbox.paypal.com") {
      if (u.pathname === "/v1/oauth2/token") return Response.json({ access_token: "tok" });
      if (u.pathname === "/v2/checkout/orders") {
        return Response.json({ name: "UNPROCESSABLE_ENTITY", details: [{ issue: "SHIPPING_ADDRESS_INVALID" }] }, { status: 422 });
      }
    }
    return new Response("{}", { status: 404 });
  };
  const DB = sqliteD1(allMigrations());
  try {
    const env = { DB, GITHUB_TOKEN: "gh-test", PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: "secret" };
    const r = await bestellen(env, { itemIds: [9427], adresse: { name: "Giulia Rossi", strasse: "Via Roma", hausnummer: "12", plz: "00184", ort: "Roma", land: "IT" },
      versand: "fest-dhl-eu-S", versandPreisCents: 1449 }, "k-eu-0000000000005");
    assert.equal(r.status, 422);
    assert.equal(r.data.error, "PAYPAL_ADRESSE_ABGELEHNT");
    assert.equal(DB.raw.prepare("SELECT COUNT(*) AS n FROM reservations WHERE status='RESERVED'").get().n, 0);
    assert.equal(DB.raw.prepare("SELECT status FROM inventory WHERE item_id=9427").get()?.status ?? "AVAILABLE", "AVAILABLE");
  } finally {
    globalThis.fetch = original;
  }
});

test("Anzeige-Katalog kommt von GitHub (main), disorder119.com nur als Rueckfall", async () => {
  const original = globalThis.fetch;
  const abrufe = [];
  let rawKaputt = false;
  globalThis.fetch = async url => {
    const u = new URL(String(url));
    abrufe.push(u.host);
    if (u.host === "raw.githubusercontent.com") {
      assert.equal(u.pathname, "/disorder119/disorder119-shop/main/data/catalog.json");
      if (rawKaputt) throw new Error("netz weg");
      return Response.json(ITEMS);
    }
    if (u.host === "disorder119.com") return Response.json(ITEMS);
    return new Response("{}", { status: 404 });
  };
  const abfrage = async () => {
    const url = new URL("https://api.disorder119.com/versand/optionen?artikel=9420&land=DE");
    const res = await handleVersandOptionen(new Request(url, { headers: { Origin: SHOP } }), {}, url, "r", SHOP);
    return res.json();
  };
  try {
    versandCacheLeeren();
    const daten = await abfrage();
    // Mantel ueber 99 EUR: Klasse M, Gratisversand - nur mit echtem Katalog richtig.
    assert.deepEqual([daten.paket, daten.optionen[0].preisCents, daten.frei?.erreicht], ["M", 0, true]);
    assert.deepEqual(abrufe, ["raw.githubusercontent.com"]);
    versandCacheLeeren();
    abrufe.length = 0;
    rawKaputt = true;
    assert.equal((await abfrage()).paket, "M");
    assert.deepEqual(abrufe, ["raw.githubusercontent.com", "disorder119.com"]);
  } finally {
    globalThis.fetch = original;
  }
});

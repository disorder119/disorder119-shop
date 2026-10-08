import assert from "node:assert/strict";
import test from "node:test";

import { abholadresse, abholorteAus, handleAbholorte, zustellungAus } from "./abholorte.js";
import { adresseCacheLeeren } from "./adresse.js";
import { festeOptionen, oeffentlicheOptionen, versandCacheLeeren, versandkostenfreiAnwenden, versandOptionen, versandQuelle } from "./versand.js";

const SHOP = "https://disorder119.com";

// Auszug einer echten Antwort des DHL Unified Location Finders (gekuerzt).
const DHL_ANTWORT = {
  locations: [
    { name: "Packstation 162", distance: 412, location: { ids: [{ locationId: "8003-4155690", provider: "parcel" }], keyword: "Packstation", keywordId: "162", type: "locker" },
      place: { address: { countryCode: "DE", postalCode: "63739", addressLocality: "Aschaffenburg", streetAddress: "Hanauer Str. 2" }, geo: { latitude: 49.9761, longitude: 9.1449 } },
      serviceTypes: ["parcel:pick-up-registered", "parcel:drop-off"] },
    { name: "Postfiliale 503", distance: 150, location: { ids: [{ locationId: "8003-4000503" }], keyword: "Postfiliale", keywordId: "503", type: "postoffice" },
      place: { address: { postalCode: "63739", addressLocality: "Aschaffenburg", streetAddress: "Goldbacher Str. 19" }, geo: { latitude: 49.97, longitude: 9.15 } },
      serviceTypes: ["parcel:pick-up", "letter-service"] },
    { name: "Briefkasten", distance: 20, location: { keywordId: "1", type: "letterbox" }, place: { address: { postalCode: "63739" } } },
    { name: "Paketshop ohne Abholung", distance: 30, location: { keywordId: "777", type: "servicepoint" }, place: { address: { postalCode: "63739" } }, serviceTypes: ["parcel:drop-off"] },
    { name: "Kiosk/Telekommunikation Rana", distance: 554, location: { keywordId: "793", type: "servicepoint" },
      place: { address: { postalCode: "63739", addressLocality: "Aschaffenburg", streetAddress: "Wermbachstr. 22" } }, serviceTypes: ["parcel:pick-up-unregistered"] },
    { name: "Packstation 162 doppelt", distance: 999, location: { keywordId: "162", type: "locker" }, place: { address: { postalCode: "63739", addressLocality: "Aschaffenburg" } } },
  ],
};

test("feste Tarife: DHL und DPD zu Privatpreisen je Paketgroesse, nur DHL an Abholstationen", () => {
  const kurz = paket => festeOptionen(paket).map(o => [o.id, o.carrier, o.preisCents, o.abholstation]);
  assert.deepEqual(kurz("S"), [["fest-dpd-S", "DPD", 409, false], ["fest-dhl-S", "DHL", 619, true]]);
  assert.deepEqual(kurz("M"), [["fest-dpd-M", "DPD", 578, false], ["fest-dhl-M", "DHL", 619, true]]);
  assert.deepEqual(kurz("L"), [["fest-dpd-L", "DPD", 578, false], ["fest-dhl-L", "DHL", 769, true]]);
  assert.ok(festeOptionen("M").every(o => o.quelle === "fest" && o.laufzeit === "2 Tage" && o.versichertBisCents >= 50000));
  assert.equal(versandQuelle({}), "fest");
  assert.equal(versandQuelle({ VERSAND_QUELLE: "packlink" }), "packlink");
});

test("feste Tarife brauchen kein Packlink; ab 99 EUR kostet der guenstigste Versand nichts", async () => {
  versandCacheLeeren();
  const original = globalThis.fetch;
  globalThis.fetch = async url => { throw new Error(`kein Netz erwartet: ${url}`); };
  try {
    const ergebnis = await versandOptionen({}, "M");
    assert.equal(ergebnis.quelle, "fest");
    const frei = versandkostenfreiAnwenden(ergebnis, 15000);
    assert.deepEqual(frei.optionen.map(o => [o.carrier, o.preisCents]), [["DPD", 0], ["DHL", 41]]);
    const unter = versandkostenfreiAnwenden(ergebnis, 9899);
    assert.deepEqual(unter.optionen.map(o => o.preisCents), [578, 619]);
    // Die Kasse zeigt "versichert bis 500 €" und bietet Packstation nur bei DHL an.
    const kasse = oeffentlicheOptionen(unter, new Date("2026-10-08T10:00:00Z"));
    assert.deepEqual(kasse.optionen.map(o => [o.carrier, o.abholstation, o.versichertBisCents, o.tage]),
      [["DPD", false, 52000, 2], ["DHL", true, 50000, 2]]);
    assert.ok(kasse.optionen.every(o => o.lieferung && o.lieferung.von && o.lieferung.bis));
  } finally {
    globalThis.fetch = original;
  }
});

test("Abholorte aus der DHL-Antwort: Packstation und Filiale, sortiert, ohne Doppelte", () => {
  const orte = abholorteAus(DHL_ANTWORT);
  assert.deepEqual(orte.map(o => [o.typ, o.nummer, o.name, o.geschaeft, o.entfernungM]), [
    ["filiale", "503", "Postfiliale 503", undefined, 150],
    ["packstation", "162", "Packstation 162", undefined, 412],
    // DHL-Paketshop: auf dem Etikett "Postfiliale 793", der Laden als Zusatz.
    ["filiale", "793", "Postfiliale 793", "Kiosk/Telekommunikation Rana", 554],
  ]);
  assert.deepEqual({ ...orte[1] }, { id: "8003-4155690", typ: "packstation", nummer: "162", name: "Packstation 162", strasse: "Hanauer Str. 2", plz: "63739", ort: "Aschaffenburg", lat: 49.9761, lng: 9.1449, entfernungM: 412 });
  assert.deepEqual(abholorteAus(null), []);
});

test("GET /versand/abholorte: Schluessel bleibt am Server, nur PLZ und Strasse gehen an DHL", async () => {
  adresseCacheLeeren();
  const original = globalThis.fetch;
  const aufrufe = [];
  globalThis.fetch = async (url, init = {}) => {
    aufrufe.push({ url: String(url), key: init.headers?.["DHL-API-Key"] });
    if (String(url).includes("postalCode=99999")) return new Response("{}", { status: 404 });
    return Response.json(DHL_ANTWORT);
  };
  // OpenPLZ nachgebaut: 63739 liegt in Bayern (Landesschluessel 09).
  const OPENPLZ_LADEN = async url => (String(url).includes("postalCode=63739") ? [{ postalCode: "63739", federalState: { key: "09", name: "Bayern" } }] : []);
  const abfrage = async (query, env = { DHL_PRIVAT_API_KEY: "dhl-test", OPENPLZ_LADEN }, origin = SHOP) => {
    const req = new Request(`https://api.disorder119.com/versand/abholorte${query}`, { headers: origin ? { Origin: origin } : {} });
    const res = await handleAbholorte(req, env, new URL(req.url), "req", origin);
    return { status: res.status, cors: res.headers.get("Access-Control-Allow-Origin"), daten: await res.json() };
  };
  try {
    const ok = await abfrage("?plz=63739&strasse=Nelseestra%C3%9Fe%2025");
    assert.equal(ok.status, 200);
    assert.equal(ok.cors, SHOP);
    assert.equal(ok.daten.orte.length, 3);
    // Amtliche Luftbilder des Bundeslands der PLZ, mit Quellenvermerk.
    assert.deepEqual(ok.daten.luftbild, { land: "BY", quelle: "© Bayerische Vermessungsverwaltung, CC BY 4.0" });
    adresseCacheLeeren();
    const ohneLand = await abfrage("?plz=63739", { DHL_PRIVAT_API_KEY: "dhl-test", OPENPLZ_LADEN: async () => { throw new Error("weg"); } });
    assert.equal(ohneLand.daten.luftbild, false, "OpenPLZ weg: nur Strassenkarte, Abholorte trotzdem");
    assert.equal(ohneLand.daten.orte.length, 3);
    assert.equal(aufrufe[0].key, "dhl-test");
    const gesendet = new URL(aufrufe[0].url);
    assert.equal(gesendet.searchParams.get("postalCode"), "63739");
    assert.equal(gesendet.searchParams.get("streetAddress"), "Nelseestraße 25");
    assert.equal(gesendet.searchParams.get("countryCode"), "DE");
    assert.ok(!JSON.stringify(ok.daten).includes("dhl-test"), "Schluessel nie in der Antwort");

    assert.deepEqual((await abfrage("?plz=99999")).daten, { ok: true, orte: [], luftbild: false });
    assert.equal((await abfrage("?plz=123")).status, 400);
    assert.equal((await abfrage("?plz=63739", {})).daten.error, "ABHOLORTE_NICHT_EINGERICHTET");
    assert.equal((await abfrage("?plz=63739", undefined, "https://evil.example")).status, 403);
  } finally {
    globalThis.fetch = original;
  }
});

test("Zustellung an Packstation oder Filiale: Pruefung und Lieferadresse wie DHL sie verlangt", () => {
  const ort = { nummer: "162", name: "Packstation 162", strasse: "Hanauer Str. 2", plz: "63739", ort: "Aschaffenburg" };
  const fehler = roh => { try { zustellungAus(roh); return null; } catch (err) { return err.code; } };
  assert.deepEqual(zustellungAus(undefined), { art: "haustuer" });
  assert.deepEqual(zustellungAus({ art: "haustuer" }), { art: "haustuer" });
  assert.equal(fehler({ art: "packstation", abholort: ort }), "POSTNUMMER_FEHLT");
  assert.equal(fehler({ art: "packstation", abholort: ort, postnummer: "12a" }), "POSTNUMMER_UNGUELTIG");
  assert.equal(fehler({ art: "packstation", abholort: { ...ort, nummer: "x" }, postnummer: "12345678" }), "ABHOLORT_UNVOLLSTAENDIG");
  assert.equal(fehler({ art: "briefkasten" }), "ZUSTELLUNG_UNGUELTIG");
  assert.equal(fehler("Packstation"), "ZUSTELLUNG_UNGUELTIG");

  const packstation = zustellungAus({ art: "packstation", abholort: ort, postnummer: " 1234 5678 " });
  assert.deepEqual(abholadresse("Maria Müller", packstation), {
    name: "Maria Müller", strasse: "Packstation", hausnummer: "162", zusatz: "Postnummer 12345678", plz: "63739", ort: "Aschaffenburg", land: "DE",
  });
  const filiale = zustellungAus({ art: "filiale", abholort: { ...ort, nummer: "503", name: "Postfiliale 503" } });
  assert.deepEqual(abholadresse("Maria Müller", filiale), {
    name: "Maria Müller", strasse: "Postfiliale", hausnummer: "503", zusatz: "", plz: "63739", ort: "Aschaffenburg", land: "DE",
  });
  assert.throws(() => abholadresse("Maria", filiale), err => err.code === "ADRESSE_UNVOLLSTAENDIG");
});

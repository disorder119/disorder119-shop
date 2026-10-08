import assert from "node:assert/strict";
import test from "node:test";

import { LAENDER, handleKarte, kachelAus, landAusSchluessel, luftbildFuer, wmsAdresse } from "./karte.js";
import workerEntry from "./worker-entry.js";

const SHOP = "https://disorder119.com/kasse/";
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
// Aschaffenburg, Zoom 17 (Packstation 215)
const PFAD = "/karte/luftbild/BY/17/44440/68869";

function anfrage(pfad, referer = SHOP, method = "GET") {
  return new Request(`https://api.disorder119.com${pfad}`, { method, headers: referer ? { Referer: referer } : {} });
}

async function mitFetch(ersatz, lauf) {
  const original = globalThis.fetch;
  const aufrufe = [];
  globalThis.fetch = async (url, init) => { aufrufe.push({ url: String(url), init }); return ersatz(String(url), init); };
  try { return await lauf(aufrufe); } finally { globalThis.fetch = original; }
}

test("Alle 16 Laender mit amtlichem Luftbild und Quellenvermerk", () => {
  assert.equal(Object.keys(LAENDER).length, 16);
  for (let i = 1; i <= 16; i++) {
    const land = landAusSchluessel(String(i).padStart(2, "0"));
    assert.ok(LAENDER[land], `Schluessel ${i}`);
    const lb = luftbildFuer(land, 2026);
    assert.equal(lb.land, land);
    assert.ok(lb.quelle.length > 4, `Quellenvermerk ${land}`);
    assert.match(LAENDER[land].url, /^https:\/\//);
  }
  assert.equal(landAusSchluessel("9"), "BY");
  assert.equal(landAusSchluessel("17"), null);
  assert.equal(luftbildFuer("XX"), false);
  assert.equal(luftbildFuer("RP", 2026).quelle, "©GeoBasis-DE / LVermGeoRP (2026), dl-de/by-2-0, www.lvermgeo.rlp.de");
});

test("Kacheln: nur bekannte Laender, Zoom 13 bis 19, Koordinaten in der Welt", () => {
  assert.deepEqual(kachelAus(PFAD), { land: "BY", z: 17, y: 44440, x: 68869 });
  assert.equal(kachelAus("/karte/luftbild/XX/17/1/1"), null, "unbekanntes Land");
  assert.equal(kachelAus("/karte/luftbild/by/17/1/1"), null, "nur Grossbuchstaben");
  assert.equal(kachelAus("/karte/luftbild/BY/12/1/1"), null, "zu weit herausgezoomt");
  assert.equal(kachelAus("/karte/luftbild/BY/20/1/1"), null, "zu weit hineingezoomt");
  assert.equal(kachelAus("/karte/luftbild/BY/13/8192/1"), null, "Zeile ausserhalb der Welt");
  assert.equal(kachelAus("/karte/luftbild/16/1/1"), null, "altes Format ohne Land");
});

test("WMS-Adresse: GetMap in EPSG:3857 genau fuer die Kachel", () => {
  const url = new URL(wmsAdresse(kachelAus(PFAD)));
  assert.equal(url.origin + url.pathname, "https://geoservices.bayern.de/od/wms/dop/v1/dop20");
  const q = url.searchParams;
  assert.equal(q.get("REQUEST"), "GetMap");
  assert.equal(q.get("LAYERS"), "by_dop20c");
  assert.equal(q.get("SRS"), "EPSG:3857");
  assert.equal(q.get("WIDTH"), "256");
  assert.equal(q.get("FORMAT"), "image/jpeg");
  const [links, unten, rechts, oben] = q.get("BBOX").split(",").map(Number);
  assert.ok(Math.abs(rechts - links - 305.75) < 0.1, "Zoom 17: 305,75 m breit");
  assert.ok(Math.abs(oben - unten - 305.75) < 0.1);
  // Die Kachel liegt um Aschaffenburg (9,14 Grad Ost, 49,97 Grad Nord).
  const lng = (links / 20037508.342789244) * 180;
  assert.ok(lng > 9.1 && lng < 9.2, `Laenge ${lng}`);
});

test("Luftbild: kommt vom Landesdienst, darf in den Cache, nie fuer fremde Seiten", async () => {
  await mitFetch(async url => (url.includes("FEHLER") ? new Response("<ServiceExceptionReport/>", { headers: { "Content-Type": "application/vnd.ogc.se_xml" } })
    : new Response(JPEG, { headers: { "Content-Type": "image/jpeg" } })), async aufrufe => {
    const ok = await handleKarte(anfrage(PFAD), {}, new URL(`https://api.disorder119.com${PFAD}`));
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get("Content-Type"), "image/jpeg");
    assert.match(ok.headers.get("Cache-Control"), /^public, max-age=\d+$/);
    assert.deepEqual(new Uint8Array(await ok.arrayBuffer()), JPEG);
    assert.equal(aufrufe.length, 1);
    assert.match(aufrufe[0].url, /^https:\/\/geoservices\.bayern\.de\/od\/wms\/dop\/v1\/dop20\?/);
    assert.equal(aufrufe[0].init.cf.cacheEverything, true, "Cloudflare haelt die Kachel vor");
    assert.ok(!aufrufe[0].init.headers.Referer, "keine Kunden-Herkunft an das Amt");

    const status = async (pfad, referer) => (await handleKarte(anfrage(pfad, referer), {}, new URL(`https://api.disorder119.com${pfad}`))).status;
    assert.equal(await status(PFAD, "https://fremde-seite.example/"), 403);
    assert.equal(await status(PFAD, "https://test.disorder119.com/kasse/"), 200, "Testshop darf");
    assert.equal(await status(PFAD, null), 200, "ohne Referer (Datenschutz-Einstellung) trotzdem");
    assert.equal(await status("/karte/luftbild/XX/17/1/1", SHOP), 404);
    assert.equal(aufrufe.length, 3, "fremde und unbekannte Anfragen gehen nicht zum Amt");
    const post = await handleKarte(anfrage(PFAD, SHOP, "POST"), {}, new URL(`https://api.disorder119.com${PFAD}`));
    assert.equal(post.status, 405);
  });
  // WMS meldet Fehler mit Status 200 und XML: kein Bild, 502.
  await mitFetch(async () => new Response("<ServiceExceptionReport/>", { headers: { "Content-Type": "application/vnd.ogc.se_xml" } }), async () => {
    const res = await handleKarte(anfrage(PFAD), {}, new URL(`https://api.disorder119.com${PFAD}`));
    assert.equal(res.status, 502);
  });
});

test("Worker: /karte/ ueber den echten Einstieg, Cache nur fuer gelieferte Kacheln", async () => {
  await mitFetch(async () => new Response(JPEG, { headers: { "Content-Type": "image/jpeg" } }), async () => {
    const ok = await workerEntry.fetch(anfrage(PFAD), {}, { waitUntil() {} });
    assert.equal(ok.status, 200);
    assert.match(ok.headers.get("Cache-Control"), /^public, max-age=/);
    const falsch = await workerEntry.fetch(anfrage("/karte/luftbild/XX/17/1/1"), {}, { waitUntil() {} });
    assert.equal(falsch.status, 404);
    assert.equal(falsch.headers.get("Cache-Control"), "no-store");
  });
});

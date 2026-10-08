import assert from "node:assert/strict";
import test from "node:test";

import { handleKarte, kachelAus, luftbildBereit } from "./karte.js";
import workerEntry from "./worker-entry.js";

const SHOP = "https://disorder119.com/kasse/";
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

function anfrage(pfad, referer = SHOP, method = "GET") {
  return new Request(`https://api.disorder119.com${pfad}`, { method, headers: referer ? { Referer: referer } : {} });
}

async function mitFetch(ersatz, lauf) {
  const original = globalThis.fetch;
  const aufrufe = [];
  globalThis.fetch = async (url, init) => { aufrufe.push(String(url)); return ersatz(String(url), init); };
  try { return await lauf(aufrufe); } finally { globalThis.fetch = original; }
}

test("Kacheln: nur gueltige Zoomstufen und Koordinaten", () => {
  assert.deepEqual(kachelAus("/karte/luftbild/16/22178/34508"), { z: 16, y: 22178, x: 34508 });
  assert.equal(kachelAus("/karte/luftbild/2/1/1"), null, "zu weit herausgezoomt");
  assert.equal(kachelAus("/karte/luftbild/20/1/1"), null, "zu weit hineingezoomt");
  assert.equal(kachelAus("/karte/luftbild/5/32/1"), null, "Zeile ausserhalb der Welt");
  assert.equal(kachelAus("/karte/luftbild/16/1/x"), null);
  assert.equal(kachelAus("/karte/luftbild/16/1/1/extra"), null);
  assert.equal(luftbildBereit({}), false);
  assert.equal(luftbildBereit({ ESRI_API_KEY: "k" }), true);
});

test("Luftbild: Schluessel bleibt am Server, Bild kommt durch und darf in den Browser-Cache", async () => {
  await mitFetch(async () => new Response(JPEG, { headers: { "Content-Type": "image/jpeg" } }), async aufrufe => {
    const env = { ESRI_API_KEY: "esri-geheim" };
    const res = await handleKarte(anfrage("/karte/luftbild/16/22178/34508"), env, new URL("https://api.disorder119.com/karte/luftbild/16/22178/34508"));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("Content-Type"), "image/jpeg");
    assert.match(res.headers.get("Cache-Control"), /^public, max-age=\d+$/);
    assert.deepEqual(new Uint8Array(await res.arrayBuffer()), JPEG);
    assert.equal(aufrufe.length, 1);
    assert.equal(aufrufe[0], "https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/16/22178/34508?token=esri-geheim");
    for (const [, wert] of res.headers) assert.ok(!wert.includes("esri-geheim"), "Schluessel nie in der Antwort");
  });
});

test("Luftbild: ohne Schluessel, fremde Seite, falsche Kachel oder Esri-Fehler gibt es kein Bild", async () => {
  await mitFetch(async url => {
    if (url.includes("/19/")) return new Response('{"error":{"code":498,"message":"Invalid token."}}', { headers: { "Content-Type": "application/json" } });
    return new Response(JPEG, { headers: { "Content-Type": "image/jpeg" } });
  }, async aufrufe => {
    const env = { ESRI_API_KEY: "esri-geheim" };
    const status = async (pfad, referer, e = env) => (await handleKarte(anfrage(pfad, referer), e, new URL(`https://api.disorder119.com${pfad}`))).status;
    assert.equal(await status("/karte/luftbild/16/1/1", SHOP, {}), 503);
    assert.equal(await status("/karte/luftbild/16/1/1", "https://fremde-seite.example/karte"), 403);
    assert.equal(await status("/karte/luftbild/16/1/1", "https://test.disorder119.com/kasse/"), 200, "Testshop darf");
    assert.equal(await status("/karte/luftbild/16/1/1", null), 200, "ohne Referer (Datenschutz-Einstellung) trotzdem");
    assert.equal(await status("/karte/luftbild/1/0/0", SHOP), 404);
    assert.equal(await status("/karte/luftbild/19/1/1", SHOP), 502, "Esri meldet falschen Schluessel als JSON");
    assert.equal(aufrufe.length, 3, "nur gueltige Anfragen gehen zu Esri");
    const post = await handleKarte(anfrage("/karte/luftbild/16/1/1", SHOP, "POST"), env, new URL("https://api.disorder119.com/karte/luftbild/16/1/1"));
    assert.equal(post.status, 405);
  });
});

test("Worker: /karte/ ueber den echten Einstieg, Cache nur fuer gelieferte Kacheln", async () => {
  await mitFetch(async () => new Response(JPEG, { headers: { "Content-Type": "image/jpeg" } }), async () => {
    const ok = await workerEntry.fetch(anfrage("/karte/luftbild/16/22178/34508"), { ESRI_API_KEY: "esri-geheim" }, { waitUntil() {} });
    assert.equal(ok.status, 200);
    assert.match(ok.headers.get("Cache-Control"), /^public, max-age=/);
    const ohne = await workerEntry.fetch(anfrage("/karte/luftbild/16/22178/34508"), {}, { waitUntil() {} });
    assert.equal(ohne.status, 503);
    assert.equal(ohne.headers.get("Cache-Control"), "no-store");
  });
});

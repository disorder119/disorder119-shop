import test from "node:test";
import assert from "node:assert/strict";
import { NIE_GESPERRT, STANDARD_LAENDER, geoGesperrt, geoSperrAntwort, geoSperrListe } from "./geo-sperre.js";
import edge, { waechterMerkerLeeren } from "./storefront-edge.js";
import workerEntry from "./worker-entry.js";

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

function mitLand(url, cf, init = {}) {
  const req = new Request(url, { ...init, headers: { "User-Agent": IPHONE, "CF-Connecting-IP": "203.0.113.50", "Sec-Fetch-Mode": "navigate", "Sec-Fetch-Dest": "document", ...(init.headers || {}) } });
  Object.defineProperty(req, "cf", { value: cf });
  return req;
}

test("Standard sperrt Russland, Belarus, Indien, Nordkorea und Iran - sonst niemanden", () => {
  assert.deepEqual(STANDARD_LAENDER, ["RU", "BY", "IN", "KP", "IR"]);
  for (const land of ["RU", "BY", "IN", "KP", "IR"]) assert.deepEqual(geoGesperrt({ cf: { country: land } }, {}), { land, kontinent: null }, land);
  for (const land of ["DE", "AT", "CH", "FR", "US", "GB", "IE", "CN", "JP", "XX", ""]) assert.equal(geoGesperrt({ cf: { country: land } }, {}), null, land);
  // Ohne cf (interne Dienstbindung, Tests) wird nie gesperrt.
  assert.equal(geoGesperrt({}, {}), null);
  assert.equal(geoGesperrt(new Request("https://storefront.intern/x"), {}), null);
});

test("Laenderliste und Kontinente sind ueber Umgebungsvariablen einstellbar", () => {
  assert.deepEqual(geoSperrListe({ GEO_SPERRE_LAENDER: "cn, ru;ir  ru" }).laender, ["CN", "RU", "IR"]);
  assert.equal(geoGesperrt({ cf: { country: "CN" } }, { GEO_SPERRE_LAENDER: "CN" })?.land, "CN");
  assert.equal(geoGesperrt({ cf: { country: "RU" } }, { GEO_SPERRE_LAENDER: "CN" }), null, "eigene Liste ersetzt den Standard");
  for (const aus of ["aus", "AUS", "off", "-"]) assert.equal(geoGesperrt({ cf: { country: "RU" } }, { GEO_SPERRE_LAENDER: aus }), null);
  // Ganz Asien auf Wunsch, Deutschland/USA nie - auch nicht ueber den Kontinent.
  const asien = { GEO_SPERRE_KONTINENTE: "AS" };
  assert.deepEqual(geoGesperrt({ cf: { country: "JP", continent: "AS" } }, asien), { land: "JP", kontinent: "AS" });
  assert.equal(geoGesperrt({ cf: { country: "FR", continent: "EU" } }, asien), null);
  assert.equal(geoGesperrt({ cf: { country: "DE", continent: "EU" } }, { GEO_SPERRE_KONTINENTE: "EU" }), null);
  assert.equal(geoGesperrt({ cf: { country: "US", continent: "NA" } }, { GEO_SPERRE_KONTINENTE: "NA", GEO_SPERRE_LAENDER: "US" }), null);
  assert.deepEqual(NIE_GESPERRT, ["DE", "US"]);
  assert.deepEqual(geoSperrListe({ GEO_SPERRE_LAENDER: "DE,US,<script>,RU" }).laender, ["RU"]);
  assert.deepEqual(geoSperrListe({ GEO_SPERRE_KONTINENTE: "AS,XY" }).kontinente, ["AS"]);
});

test("Von Cloudflare verifizierte Bots kommen immer durch", () => {
  assert.equal(geoGesperrt({ cf: { country: "RU", botManagement: { verifiedBot: true } } }, {}), null);
  assert.equal(geoGesperrt({ cf: { country: "IN", verifiedBotCategory: "Search Engine Crawler" } }, {}), null);
});

test("Sperrseite ist neutral, ohne Skript, 403 und nicht zwischengespeichert", async () => {
  const res = geoSperrAntwort(new Request("https://disorder119.com/"));
  assert.equal(res.status, 403);
  assert.equal(res.headers.get("Cache-Control"), "no-store");
  const html = await res.text();
  assert.match(html, /not available in your region/);
  assert.doesNotMatch(html, /<script/i);
  assert.equal(await geoSperrAntwort(new Request("https://disorder119.com/", { method: "HEAD" })).text(), "");
});

test("Storefront: gesperrte Laender sehen nur die Sperrseite, ohne Ursprung, ohne Zaehlung", async () => {
  waechterMerkerLeeren();
  let ursprung = 0;
  const gesendet = [];
  const env = { BESUCH: { fetch: async (url, init) => { gesendet.push(url); return new Response(null, { status: 204 }); } } };
  const ctx = { waitUntil() {} };
  const res = await edge.fetch(mitLand("https://disorder119.com/", { country: "RU" }), env, ctx, async () => { ursprung++; return new Response("x"); });
  assert.equal(res.status, 403);
  assert.match(res.headers.get("Strict-Transport-Security"), /max-age/);
  assert.match(await res.text(), /403/);
  assert.equal(ursprung, 0);
  assert.equal(gesendet.length, 0, "keine Zaehlung, keine Waechter-Meldung");
  const env2 = { ...env, GEO_SPERRE_LAENDER: "CN" };
  const ok = await edge.fetch(mitLand("https://disorder119.com/", { country: "RU" }), env2, ctx, async () => new Response("<p>x</p>", { headers: { "Content-Type": "text/html" } }));
  assert.equal(ok.status, 200);
  const de = await edge.fetch(mitLand("https://disorder119.com/", { country: "DE" }), {}, ctx, async () => new Response("<p>x</p>", { headers: { "Content-Type": "text/html" } }));
  assert.equal(de.status, 200);
});

test("Shop-API: gesperrte Laender bekommen 403, Webhooks aus den USA laufen weiter", async () => {
  const res = await workerEntry.fetch(mitLand("https://api.disorder119.com/versand/optionen", { country: "IR" }), {}, { waitUntil() {} });
  assert.equal(res.status, 403);
  // US ist nie gesperrt: der Webhook erreicht das Routing (dort ohne Konfiguration abgelehnt, aber nicht 403 Geo).
  const paypal = await workerEntry.fetch(mitLand("https://api.disorder119.com/paypal-webhook", { country: "US" }, { method: "POST", body: "{}" }), { GEO_SPERRE_LAENDER: "US,RU" }, { waitUntil() {} });
  assert.notEqual(await paypal.text(), await geoSperrAntwort(new Request("https://x/")).text());
});

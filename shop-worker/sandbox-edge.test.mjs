import assert from "node:assert/strict";
import test from "node:test";

import edge, { angemeldet, umbiegen } from "./sandbox-edge.js";

const PASSWORT = "geheim-test-119";
const LIVE_ID = "BAAcvD8X1aHIk42UUDAMZkYZ2i5gKLPCXZDBzbWjsh-axJ_6551l-FXgDdboqGtmZSidZbGWon2cQ_SuaI";
const auth = (pw = PASSWORT) => ({ Authorization: `Basic ${btoa(`test:${pw}`)}` });
const env = { TESTSHOP_PASSWORT: PASSWORT, PAYPAL_SANDBOX_CLIENT_ID: "SANDBOX-ID" };
const seite = `<html><head><title>x</title></head><body><script>window.SHOP_CONFIG = {"paypalClientId": "${LIVE_ID}", "shopWorkerUrl": "https://api.disorder119.com", "turnstileSiteKey": "0x4AAAAAAFHqI2j_AitAYIKF", "environment": "live"};</script>`
  + `<script src="https://www.paypal.com/sdk/js?client-id=${LIVE_ID}&currency=EUR"></script></body></html>`;

test("ohne Passwort kein Testshop, Suchmaschinen bleiben draussen", async () => {
  const ursprung = async () => new Response(seite, { headers: { "Content-Type": "text/html" } });
  assert.equal((await edge.fetch(new Request("https://test.disorder119.com/"), env, {}, ursprung)).status, 401);
  assert.equal((await edge.fetch(new Request("https://test.disorder119.com/", { headers: auth("falsch") }), env, {}, ursprung)).status, 401);
  assert.equal((await edge.fetch(new Request("https://test.disorder119.com/"), {}, {}, ursprung)).status, 503, "ohne eingerichtetes Passwort zu");
  const robots = await edge.fetch(new Request("https://test.disorder119.com/robots.txt"), env, {}, ursprung);
  assert.match(await robots.text(), /Disallow: \//);
  assert.equal((await edge.fetch(new Request("https://test.disorder119.com/", { method: "POST", headers: auth() }), env, {}, ursprung)).status, 405);
  assert.equal(angemeldet(new Request("https://x/", { headers: auth() }), PASSWORT), true);
  assert.equal(angemeldet(new Request("https://x/", { headers: { Authorization: "Basic !!!" } }), PASSWORT), false);
});

test("Seiten zeigen auf Test-Server, PayPal-Sandbox und Turnstile-Testschluessel", async () => {
  let angefragt;
  const ursprung = async req => { angefragt = req.url; return new Response(seite, { headers: { "Content-Type": "text/html; charset=utf-8" } }); };
  const res = await edge.fetch(new Request("https://test.disorder119.com/kasse/?x=1", { headers: auth() }), env, {}, ursprung);
  assert.equal(angefragt, "https://disorder119.com/kasse/?x=1");
  const html = await res.text();
  assert.ok(!html.includes(LIVE_ID), "keine Live-Client-ID mehr");
  assert.ok(!html.includes("https://api.disorder119.com"), "kein echter Server mehr");
  assert.match(html, /"shopWorkerUrl": "https:\/\/api-test\.disorder119\.com"/);
  assert.match(html, /client-id=SANDBOX-ID&/);
  assert.match(html, /"environment": "sandbox"/);
  assert.match(html, /"turnstileSiteKey": "1x00000000000000000000AA"/);
  assert.match(html, /<meta name="robots" content="noindex, nofollow">/);
  assert.match(html, /TESTSHOP · PayPal-Sandbox/);
  assert.equal(res.headers.get("X-Robots-Tag"), "noindex, nofollow");
  assert.equal(res.headers.get("Cache-Control"), "no-store");
  // Ohne eigene Sandbox-ID: PayPals allgemeine Sandbox-Kennung, nie die Live-ID.
  assert.ok(umbiegen(seite, {}, true).includes("client-id=sb&"));
});

test("Katalog zeigt im Testshop Verkauftes, Bilder laufen unveraendert durch", async () => {
  const katalog = [{ id: 1, public_status: "AVAILABLE" }, { id: 2, public_status: "AVAILABLE" }];
  const ursprung = async req => req.url.endsWith("/data/catalog.json")
    ? new Response(JSON.stringify(katalog), { headers: { "Content-Type": "application/json" } })
    : new Response("BILD", { headers: { "Content-Type": "image/webp" } });
  const api = { fetch: async url => { assert.match(String(url), /\/sandbox\/verkauft$/); return new Response(JSON.stringify({ ok: true, verkauft: [2] })); } };
  const res = await edge.fetch(new Request("https://test.disorder119.com/data/catalog.json", { headers: auth() }), { ...env, API: api }, {}, ursprung);
  assert.deepEqual((await res.json()).map(i => [i.id, i.public_status]), [[1, "AVAILABLE"], [2, "SOLD"]]);
  const bild = await edge.fetch(new Request("https://test.disorder119.com/assets/img/a/0.webp", { headers: auth() }), env, {}, ursprung);
  assert.equal(await bild.text(), "BILD");
  // Test-Server nicht erreichbar: Katalog trotzdem da.
  const kaputt = { fetch: async () => { throw new Error("weg"); } };
  const ohne = await edge.fetch(new Request("https://test.disorder119.com/data/catalog.json", { headers: auth() }), { ...env, API: kaputt }, {}, ursprung);
  assert.equal((await ohne.json()).length, 2);
});

test("Apple-Pay-Pruefdatei ohne Passwort", async () => {
  const ursprung = async () => new Response("live-datei");
  const res = await edge.fetch(new Request("https://test.disorder119.com/.well-known/apple-developer-merchantid-domain-association"), { ...env, APPLE_PAY_SANDBOX_DATEI: "sandbox-datei" }, {}, ursprung);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), "sandbox-datei");
});

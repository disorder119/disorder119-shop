import assert from "node:assert/strict";
import test from "node:test";

import { HSTS, httpsErzwingen, lokal, mitHsts, unverschluesselt } from "./https-pflicht.js";
import workerEntry from "./worker-entry.js";
import testshopEdge from "./sandbox-edge.js";
import { allMigrations, sqliteD1 } from "./test-d1.mjs";

const ctx = { waitUntil() {} };
// Darf vor der Umleitung nie angefasst werden.
const KEINE_DB = { prepare() { throw new Error("DB vor der HTTPS-Pruefung benutzt"); } };
const LIVE_ENV = { PAYPAL_ENVIRONMENT: "live", PAYPAL_CLIENT_ID: "synthetic-public-id",
  PAYPAL_CLIENT_SECRET: "synthetic-secret", PAYPAL_WEBHOOK_ID: "synthetic-webhook",
  ADMIN_READ_TOKEN: "synthetic-reader", ADMIN_WRITE_TOKEN: "synthetic-owner" };

test("http: GET/HEAD 301 auf dieselbe Adresse mit https, alles andere 403 HTTPS_REQUIRED", async () => {
  for (const method of ["GET", "HEAD"]) {
    const res = httpsErzwingen(new Request("http://api.disorder119.com/katalog/x?a=1&b=2", { method }));
    assert.equal(res.status, 301, method);
    assert.equal(res.headers.get("Location"), "https://api.disorder119.com/katalog/x?a=1&b=2");
    assert.equal(res.headers.get("Cache-Control"), "no-store");
  }
  for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
    const res = httpsErzwingen(new Request("http://api.disorder119.com/create-order", { method, body: method === "POST" ? "{}" : undefined }));
    assert.equal(res.status, 403, method);
    assert.equal(res.headers.get("Location"), null, "keine Umleitung - der Body ginge verloren");
    assert.deepEqual(await res.json(), { error: "HTTPS_REQUIRED" });
    assert.match(res.headers.get("Content-Type"), /application\/json/);
  }
  // Cloudflare meldet das Schema auch ueber CF-Visitor.
  const visitor = httpsErzwingen(new Request("https://api.disorder119.com/health", { headers: { "CF-Visitor": '{"scheme":"http"}' } }));
  assert.equal(visitor.status, 301);
  assert.equal(visitor.headers.get("Location"), "https://api.disorder119.com/health");
  assert.equal(httpsErzwingen(new Request("https://api.disorder119.com/health", { headers: { "CF-Visitor": '{"scheme":"https"}' } })), null);
  assert.equal(httpsErzwingen(new Request("https://api.disorder119.com/health", { headers: { "CF-Visitor": "kaputt" } })), null);
});

test("lokal (wrangler dev, localhost, 127.0.0.1) bleibt http - keine Schleife", () => {
  for (const adresse of ["http://localhost:8787/health", "http://127.0.0.1:8787/health", "http://[::1]:8787/health", "http://shop.localhost/health"]) {
    const req = new Request(adresse, { method: "POST", body: "{}" });
    assert.equal(lokal(req), true, adresse);
    assert.equal(unverschluesselt(req), false, adresse);
    assert.equal(httpsErzwingen(req), null, adresse);
  }
  // wrangler dev biegt localhost:8787 auf die erste Route um.
  const dev = new Request("http://api.disorder119.com/health", { headers: { "MF-Original-Hostname": "127.0.0.1:8787" } });
  assert.equal(httpsErzwingen(dev), null);
  const devHost = new Request("http://api.disorder119.com/health", { headers: { Host: "localhost:8787" } });
  assert.equal(httpsErzwingen(devHost), null);
  // Aehnliche Namen sind nicht lokal.
  for (const fremd of ["http://localhost.disorder119.com/", "http://127.0.0.1.evil.example/"]) {
    assert.equal(httpsErzwingen(new Request(fremd)).status, 301, fremd);
  }
});

test("hinter Cloudflare (CF-Ray) helfen selbst gesetzte Host-Koepfe nicht, Sonderport faellt weg", () => {
  for (const kopf of [{ "MF-Original-Hostname": "localhost" }, { Host: "localhost:8787" }]) {
    const req = new Request("http://api.disorder119.com/health", { headers: { ...kopf, "CF-Ray": "8f1e2d3c4b5a6978-FRA" } });
    assert.equal(lokal(req), false, JSON.stringify(kopf));
    assert.equal(httpsErzwingen(req).status, 301, JSON.stringify(kopf));
  }
  const port = httpsErzwingen(new Request("http://api.disorder119.com:8080/x?y=1"));
  assert.equal(port.headers.get("Location"), "https://api.disorder119.com/x?y=1");
});

test("HSTS auf HTTPS-Antworten, vorhandener Wert bleibt, http bekommt keins", async () => {
  const https = mitHsts(new Response("x", { status: 418, statusText: "Tee", headers: { "X-Eigen": "1" } }), new Request("https://api.disorder119.com/"));
  assert.equal(https.headers.get("Strict-Transport-Security"), HSTS);
  assert.equal(https.status, 418);
  assert.equal(https.headers.get("X-Eigen"), "1");
  assert.equal(await https.text(), "x");
  const eigen = mitHsts(new Response("x", { headers: { "Strict-Transport-Security": "max-age=63072000" } }), new Request("https://api.disorder119.com/"));
  assert.equal(eigen.headers.get("Strict-Transport-Security"), "max-age=63072000");
  const lokalHttp = mitHsts(new Response("x"), new Request("http://localhost:8787/"));
  assert.equal(lokalHttp.headers.get("Strict-Transport-Security"), null);
});

test("api.disorder119.com: http vor Routing umgeleitet bzw. abgelehnt, https mit HSTS", async () => {
  const umgeleitet = await workerEntry.fetch(new Request("http://api.disorder119.com/health?x=1"), { ...LIVE_ENV, DB: KEINE_DB }, ctx);
  assert.equal(umgeleitet.status, 301);
  assert.equal(umgeleitet.headers.get("Location"), "https://api.disorder119.com/health?x=1");

  const post = new Request("http://api.disorder119.com/create-order", { method: "POST", body: "{}", headers: { "Content-Type": "application/json" } });
  post.clone = () => { throw new Error("Body vor der HTTPS-Pruefung gelesen"); };
  const abgelehnt = await workerEntry.fetch(post, { ...LIVE_ENV, DB: KEINE_DB }, ctx);
  assert.equal(abgelehnt.status, 403);
  assert.deepEqual(await abgelehnt.json(), { error: "HTTPS_REQUIRED" });

  // Auch die Admin-Anmeldung: erst HTTPS, dann Berechtigung.
  const admin = await workerEntry.fetch(new Request("http://api.disorder119.com/admin/orders", { headers: { Authorization: "Bearer synthetic-owner" } }), { ...LIVE_ENV, DB: KEINE_DB }, ctx);
  assert.equal(admin.status, 301);

  const sicher = await workerEntry.fetch(new Request("https://api.disorder119.com/health"), { ...LIVE_ENV, DB: KEINE_DB }, ctx);
  assert.equal(sicher.status, 200);
  assert.equal(sicher.headers.get("Strict-Transport-Security"), HSTS);

  // wrangler dev: kein Umweg ueber den Live-Server.
  const lokalDev = await workerEntry.fetch(new Request("http://localhost:8787/health"), { ...LIVE_ENV, DB: KEINE_DB }, ctx);
  assert.equal(lokalDev.status, 200);
  assert.equal(lokalDev.headers.get("Strict-Transport-Security"), null);
  const umgebogen = await workerEntry.fetch(new Request("http://api.disorder119.com/health", { headers: { "MF-Original-Hostname": "localhost:8787" } }), { ...LIVE_ENV, DB: KEINE_DB }, ctx);
  assert.equal(umgebogen.status, 200);
});

test("api-test.disorder119.com: http umgeleitet, alle HTTPS-Antworten mit HSTS (auch /sandbox/verkauft)", async () => {
  const db = sqliteD1(allMigrations());
  const env = { DB: db, SANDBOX: "1" };
  const umgeleitet = await workerEntry.fetch(new Request("http://api-test.disorder119.com/health"), env, ctx);
  assert.equal(umgeleitet.status, 301);
  assert.equal(umgeleitet.headers.get("Location"), "https://api-test.disorder119.com/health");
  const post = await workerEntry.fetch(new Request("http://api-test.disorder119.com/capture-order", { method: "POST", body: "{}" }), env, ctx);
  assert.equal(post.status, 403);
  assert.deepEqual(await post.json(), { error: "HTTPS_REQUIRED" });

  const health = await workerEntry.fetch(new Request("https://api-test.disorder119.com/health"), env, ctx);
  assert.equal(health.status, 200);
  assert.equal(health.headers.get("Strict-Transport-Security"), HSTS);
  const liste = await workerEntry.fetch(new Request("https://api-test.disorder119.com/sandbox/verkauft"), env, ctx);
  assert.deepEqual(await liste.json(), { ok: true, verkauft: [] });
  assert.equal(liste.headers.get("Strict-Transport-Security"), HSTS);
});

test("test.disorder119.com: http umgeleitet noch vor der Passwortabfrage, HTTPS mit HSTS", async () => {
  const PASSWORT = "geheim-test-119";
  const env = { TESTSHOP_PASSWORT: PASSWORT };
  const auth = { Authorization: `Basic ${btoa(`test:${PASSWORT}`)}` };
  let aufrufe = 0;
  const ursprung = async () => { aufrufe++; return new Response("<html><head></head><body>x</body></html>", { headers: { "Content-Type": "text/html; charset=utf-8" } }); };

  const umgeleitet = await testshopEdge.fetch(new Request("http://test.disorder119.com/kasse/?x=1"), env, {}, ursprung);
  assert.equal(umgeleitet.status, 301, "nicht 401: das Passwort soll nie per http gefragt werden");
  assert.equal(umgeleitet.headers.get("Location"), "https://test.disorder119.com/kasse/?x=1");
  assert.equal(umgeleitet.headers.get("WWW-Authenticate"), null);
  // Auch wer das Passwort schon mitschickt, wird nur umgeleitet.
  assert.equal((await testshopEdge.fetch(new Request("http://test.disorder119.com/", { headers: auth }), env, {}, ursprung)).status, 301);
  const post = await testshopEdge.fetch(new Request("http://test.disorder119.com/", { method: "POST", body: "x" }), env, {}, ursprung);
  assert.equal(post.status, 403);
  assert.deepEqual(await post.json(), { error: "HTTPS_REQUIRED" });
  assert.equal(aufrufe, 0, "per http nichts von der echten Seite geholt");

  const anmelden = await testshopEdge.fetch(new Request("https://test.disorder119.com/"), env, {}, ursprung);
  assert.equal(anmelden.status, 401);
  assert.equal(anmelden.headers.get("Strict-Transport-Security"), HSTS);
  const robots = await testshopEdge.fetch(new Request("https://test.disorder119.com/robots.txt"), env, {}, ursprung);
  assert.equal(robots.headers.get("Strict-Transport-Security"), HSTS);
  const seite = await testshopEdge.fetch(new Request("https://test.disorder119.com/", { headers: auth }), env, {}, ursprung);
  assert.equal(seite.status, 200);
  assert.equal(seite.headers.get("Strict-Transport-Security"), HSTS);
  assert.match(await seite.text(), /TESTSHOP/);

  // wrangler dev -c wrangler.sandbox-edge.toml: lokal keine Umleitung.
  const lokalDev = await testshopEdge.fetch(new Request("http://test.disorder119.com/", { headers: { "MF-Original-Hostname": "127.0.0.1:8787" } }), env, {}, ursprung);
  assert.equal(lokalDev.status, 401);
  assert.equal(lokalDev.headers.get("Strict-Transport-Security"), null);
});

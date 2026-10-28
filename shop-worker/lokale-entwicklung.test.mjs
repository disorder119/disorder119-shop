import test from "node:test";
import assert from "node:assert/strict";
import { handleAdminAuth, passkeyRpId } from "./admin-passkeys.js";
import { handleGameRewards } from "./game-rewards.js";
import { finalizeRuntimeResponse, runtimeErrorResponse } from "./backend-runtime.js";
import workerEntry from "./worker-entry.js";
import { lokalErlaubt } from "./lokale-entwicklung.js";

const LOKAL = "http://localhost:8765";
const DEV = { LOKALE_ENTWICKLUNG: "1" };

test("localhost:8765 ist im Livebetrieb keine erlaubte Herkunft", async () => {
  assert.equal(passkeyRpId(LOKAL, {}), null);
  assert.equal(passkeyRpId(LOKAL, DEV), "localhost");
  assert.equal(passkeyRpId("http://127.0.0.1:8765", DEV), null, "Passkeys nie fuer IP-Adressen");
  assert.equal(passkeyRpId("https://admin.disorder119.com", {}), "admin.disorder119.com");
  assert.equal(lokalErlaubt(LOKAL, { LOKALE_ENTWICKLUNG: "true" }), false, "nur genau \"1\"");

  const vorab = env => handleAdminAuth(new Request("https://api.disorder119.com/admin/auth/status", { method: "OPTIONS", headers: { Origin: LOKAL } }), env, new URL("https://api.disorder119.com/admin/auth/status"));
  assert.equal((await vorab({})).status, 403);
  const dev = await vorab(DEV);
  assert.equal(dev.status, 204);
  assert.equal(dev.headers.get("Access-Control-Allow-Origin"), LOKAL);

  const spiel = env => handleGameRewards(new Request("https://api.disorder119.com/coupons/validate", { method: "OPTIONS", headers: { Origin: LOKAL } }), env);
  assert.equal((await spiel({})).status, 403);
  assert.notEqual((await spiel(DEV)).status, 403);
  assert.equal((await spiel({})).status, 403, "Schalter gilt je Anfrage");

  assert.equal(runtimeErrorResponse(new Error("x"), "r", LOKAL).headers.get("Access-Control-Allow-Origin"), null);
  assert.equal(runtimeErrorResponse(new Error("x"), "r", "https://disorder119.com").headers.get("Access-Control-Allow-Origin"), "https://disorder119.com");

  // Admin-Routen der Shop-API: localhost wird ohne Schalter abgewiesen.
  const admin = await workerEntry.fetch(new Request("https://api.disorder119.com/admin/system", { headers: { Origin: LOKAL, "CF-Connecting-IP": "198.51.100.1" } }), {}, { waitUntil() {} });
  assert.equal(admin.status, 403);
  assert.equal((await admin.json()).error, "ADMIN_ORIGIN_FORBIDDEN");
});

test("HTML-Antworten der API (Rechnung) bekommen eine strikte CSP ohne Skript", async () => {
  const req = new Request("https://api.disorder119.com/admin/buchhaltung/rechnung/o1");
  const html = await finalizeRuntimeResponse(new Response("<html><img src=\"data:image/png;base64,AA\"></html>", { headers: { "Content-Type": "text/html; charset=utf-8" } }), req, {}, "r", "/admin/buchhaltung/rechnung/o1");
  const csp = html.headers.get("Content-Security-Policy");
  assert.match(csp, /^default-src 'none'; style-src 'unsafe-inline'; img-src data:;/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.doesNotMatch(csp, /script-src/);
  // Eine eigene CSP (z. B. eBay-Rueckkehrseite) bleibt unberuehrt.
  const eigen = await finalizeRuntimeResponse(new Response("<p>", { headers: { "Content-Type": "text/html", "Content-Security-Policy": "default-src 'self'" } }), req, {}, "r", "/ebay/x");
  assert.equal(eigen.headers.get("Content-Security-Policy"), "default-src 'self'");
  const daten = await finalizeRuntimeResponse(new Response("{}", { headers: { "Content-Type": "application/json" } }), req, {}, "r", "/health");
  assert.equal(daten.headers.get("Content-Security-Policy"), "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
});

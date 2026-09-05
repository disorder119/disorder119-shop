import test from "node:test";
import assert from "node:assert/strict";
import { handleAdminInsights } from "./admin-insights.js";

function request(method = "GET", token = null, origin = "https://admin.disorder119.com") {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (origin) headers.Origin = origin;
  return new Request("https://worker.example/admin/insights?days=30", { method, headers });
}

async function body(response) {
  return response.json();
}

test("insights rejects untrusted admin origin", async () => {
  const req = request("GET", "secret", "https://evil.example");
  const res = await handleAdminInsights(req, { ADMIN_TOKEN: "secret", DB: {} }, new URL(req.url), "req-1", "https://evil.example");
  assert.equal(res.status, 403);
  assert.equal((await body(res)).error, "ORIGIN_NOT_ALLOWED");
});

test("insights requires admin token", async () => {
  const req = request("GET", null);
  const res = await handleAdminInsights(req, { ADMIN_TOKEN: "secret", DB: {} }, new URL(req.url), "req-2", "https://admin.disorder119.com");
  assert.equal(res.status, 401);
  assert.equal((await body(res)).error, "UNAUTHORIZED");
});

test("insights refuses write methods", async () => {
  const req = request("POST", "secret");
  const res = await handleAdminInsights(req, { ADMIN_TOKEN: "secret", DB: {} }, new URL(req.url), "req-3", "https://admin.disorder119.com");
  assert.equal(res.status, 405);
  assert.equal((await body(res)).error, "METHOD_NOT_ALLOWED");
});

test("insights reports missing database after valid auth", async () => {
  const req = request("GET", "secret");
  const res = await handleAdminInsights(req, { ADMIN_TOKEN: "secret" }, new URL(req.url), "req-4", "https://admin.disorder119.com");
  assert.equal(res.status, 503);
  assert.equal((await body(res)).error, "COMMERCE_DATABASE_NOT_CONFIGURED");
});

test("insights OPTIONS exposes no wildcard origin", async () => {
  const req = request("OPTIONS", null);
  const res = await handleAdminInsights(req, {}, new URL(req.url), "req-5", "https://admin.disorder119.com");
  assert.equal(res.status, 204);
  assert.equal(res.headers.get("access-control-allow-origin"), "https://admin.disorder119.com");
  assert.equal(res.headers.get("cache-control"), "no-store");
});

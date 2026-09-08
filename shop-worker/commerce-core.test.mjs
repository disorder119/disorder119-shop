import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  CURRENCY,
  INVENTORY_STATUSES,
  MAX_RENTAL_DAYS,
  MAX_REQUEST_BYTES,
  canTransitionInventory,
  canTransitionOrder,
  canTransitionRental,
  isValidIdempotencyKey,
  money,
  parsePriceToCents,
  rentalDailyPriceCents,
  rentalDayCount,
  rentalQuoteFromItem,
} from "./commerce-core.js";
import {
  ADMIN_ROLE_OWNER,
  ADMIN_ROLE_READER,
  BACKEND_HARDENING_VERSION,
  RuntimeGuardError,
  adminAuthReadiness,
  adminRequiredRoleForMethod,
  authorizeAdminRequest,
  finalizeRuntimeResponse,
  guardRuntimeRequest,
  productionReadiness,
  requireLegacyAdmin,
  runtimeErrorResponse,
  scopeAdminEnv,
  timingSafeEqualText,
} from "./backend-runtime.js";

const here = path.dirname(fileURLToPath(import.meta.url));

test("daily rent is exactly 10% of authoritative sale price rounded to cents", () => {
  assert.equal(rentalDailyPriceCents(parsePriceToCents(125)), 1250);
  assert.equal(rentalDailyPriceCents(parsePriceToCents(250)), 2500);
  assert.equal(rentalDailyPriceCents(parsePriceToCents(490)), 4900);
  assert.equal(money(rentalDailyPriceCents(parsePriceToCents(99.99))), "10.00");
});

test("rental total uses inclusive rental days and integer cents", () => {
  const quote = rentalQuoteFromItem({ id: 1, price: 125, public_status: "AVAILABLE" }, "2026-09-05", "2026-09-07", "2026-09-01");
  assert.equal(quote.currency, CURRENCY);
  assert.equal(quote.days, 3);
  assert.equal(quote.dailyPriceCents, 1250);
  assert.equal(quote.totalPriceCents, 3750);
});

test("price-on-request remains price-on-request", () => {
  const quote = rentalQuoteFromItem({ id: 1, price: null, public_status: "AVAILABLE" }, "2026-09-05", "2026-09-05", "2026-09-01");
  assert.equal(quote.priceOnRequest, true);
  assert.equal(quote.dailyPriceCents, null);
  assert.equal(quote.totalPriceCents, null);
});

test("sold products cannot be newly rented", () => {
  assert.throws(
    () => rentalQuoteFromItem({ id: 1, price: 125, public_status: "SOLD" }, "2026-09-05", "2026-09-06"),
    /ITEM_SOLD/
  );
});

test("date parser rejects impossible and reversed dates", () => {
  assert.equal(rentalDayCount("2026-02-30", "2026-03-01"), null);
  assert.equal(rentalDayCount("2026-09-07", "2026-09-05"), null);
  assert.equal(rentalDayCount("2026-09-05", "2026-09-05"), 1);
});

test("rental quote rejects dates before the booking day", () => {
  assert.throws(
    () => rentalQuoteFromItem({ id: 1, price: 125, public_status: "AVAILABLE" }, "2026-09-05", "2026-09-06", "2026-09-06"),
    /RENTAL_DATE_IN_PAST/
  );
}); // RUNTIME_AUDIT_SERVER_NO_PAST_TEST

test("all rental paths enforce the immutable seven-day maximum centrally", () => {
  assert.equal(MAX_RENTAL_DAYS, 7);
  assert.equal(rentalDayCount("2026-09-05", "2026-09-11"), 7);
  assert.equal(rentalDayCount("2026-09-05", "2026-09-12"), null);
  assert.throws(
    () => rentalQuoteFromItem({ id: 1, price: 125, public_status: "AVAILABLE" }, "2026-09-05", "2026-09-12", "2026-09-01"),
    /INVALID_RENTAL_DATES/
  );
});

test("idempotency keys are bounded and explicit", () => {
  assert.equal(isValidIdempotencyKey("order:550e8400-e29b-41d4-a716-446655440000"), true);
  assert.equal(isValidIdempotencyKey("short"), false);
  assert.equal(isValidIdempotencyKey("x".repeat(129)), false);
});

test("inventory state machine blocks arbitrary jumps", () => {
  assert.ok(INVENTORY_STATUSES.includes("PAYMENT_PENDING"));
  assert.equal(canTransitionInventory("AVAILABLE", "RESERVED"), true);
  assert.equal(canTransitionInventory("AVAILABLE", "PAID"), false);
  assert.equal(canTransitionInventory("PAID", "SHIPPED"), false);
  assert.equal(canTransitionInventory("PREPARING", "SHIPPED"), true);
});

test("order state machine blocks skipped fulfilment and payment states", () => {
  assert.equal(canTransitionOrder("PAYMENT_PENDING", "PAID"), true);
  assert.equal(canTransitionOrder("PAYMENT_PENDING", "SHIPPED"), false);
  assert.equal(canTransitionOrder("PAID", "PREPARING"), true);
  assert.equal(canTransitionOrder("PAID", "DELIVERED"), false);
  assert.equal(canTransitionOrder("REFUNDED", "PAID"), false);
});

test("rental state machine blocks arbitrary admin jumps", () => {
  assert.equal(canTransitionRental("RESERVED", "CONFIRMED"), true);
  assert.equal(canTransitionRental("RESERVED", "RETURNED"), false);
  assert.equal(canTransitionRental("CONFIRMED", "ACTIVE"), true);
  assert.equal(canTransitionRental("ACTIVE", "RETURNED"), true);
  assert.equal(canTransitionRental("RETURNED", "ACTIVE"), false);
});

test("worker no longer contains public GitHub JSON rental storage", () => {
  const worker = fs.readFileSync(path.join(here, "worker.js"), "utf8");
  assert.equal(worker.includes("rental-requests.json"), false);
  assert.equal(worker.includes("appendRentalRequest(env"), false);
  assert.equal(worker.includes("loadRentalRequests(env"), false);
});

test("worker binds idempotency to request payload and keeps provider IDs private", () => {
  const worker = fs.readFileSync(path.join(here, "worker.js"), "utf8");
  assert.match(worker, /request_hash/);
  assert.match(worker, /IDEMPOTENCY_KEY_REUSED/);
  assert.match(worker, /requestHash\("create-order", body\)/);
  assert.match(worker, /requestHash\("rental-request", body\)/);
  assert.match(worker, /requestHash\("capture-order", body\)/);
  assert.equal(worker.includes("item.paypal_order_id = providerOrderId"), false);
  assert.match(worker, /delete item\.paypal_order_id/);
  assert.match(worker, /canTransitionRental\(row\.status, status\)/);
  assert.match(worker, /payload_hash/);
});

test("commerce migrations have required tables, overlap lock and state guards", () => {
  const foundation = fs.readFileSync(path.join(here, "migrations", "0002_commerce_foundation.sql"), "utf8");
  for (const table of [
    "customers", "customer_addresses", "inventory", "reservations", "commerce_orders", "order_items",
    "payments", "payment_events", "shipments", "rental_reservations", "rentals", "returns", "refunds", "audit_events",
  ]) {
    assert.match(foundation, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`));
  }
  assert.match(foundation, /PRIMARY KEY\(inventory_id, rental_date\)/);

  const integrity = fs.readFileSync(path.join(here, "migrations", "0003_state_integrity.sql"), "utf8");
  assert.match(integrity, /trg_inventory_status_transition/);
  assert.match(integrity, /trg_order_status_transition/);
  assert.match(integrity, /trg_rental_status_transition/);
  assert.match(integrity, /trg_rental_price_integrity_insert/);
  assert.match(integrity, /invalid_rental_price/);
});

test("backend hardening migration executes on the complete D1 chain", () => {
  const script = path.join(here, "..", "scripts", "test_backend_hardening_migration.py");
  const output = execFileSync("python3", [script], { encoding: "utf8" });
  assert.match(output, /D1 erzwingt maximal 7 Miettage/);
});

test("legacy admin token comparison is timing-safe and bearer-only", async () => {
  assert.equal(await timingSafeEqualText("same-secret", "same-secret"), true);
  assert.equal(await timingSafeEqualText("same-secret", "wrong-secret"), false);
  const ok = new Request("https://worker.example/rental-requests", { headers: { Authorization: "Bearer owner-secret" } });
  await assert.doesNotReject(() => requireLegacyAdmin(ok, { ADMIN_TOKEN: "owner-secret" }));
  const wrong = new Request("https://worker.example/rental-requests", { headers: { Authorization: "Basic owner-secret" } });
  await assert.rejects(() => requireLegacyAdmin(wrong, { ADMIN_TOKEN: "owner-secret" }), err => err instanceof RuntimeGuardError && err.code === "UNAUTHORIZED" && err.status === 401);
});

test("admin RBAC maps safe methods to reader and mutations to owner", () => {
  assert.equal(adminRequiredRoleForMethod("GET"), ADMIN_ROLE_READER);
  assert.equal(adminRequiredRoleForMethod("HEAD"), ADMIN_ROLE_READER);
  assert.equal(adminRequiredRoleForMethod("POST"), ADMIN_ROLE_OWNER);
  assert.equal(adminRequiredRoleForMethod("PATCH"), ADMIN_ROLE_OWNER);
  assert.equal(adminRequiredRoleForMethod("DELETE"), ADMIN_ROLE_OWNER);
  assert.equal(adminRequiredRoleForMethod("OPTIONS"), null);
  assert.throws(
    () => adminRequiredRoleForMethod("TRACE"),
    err => err instanceof RuntimeGuardError && err.code === "METHOD_NOT_ALLOWED" && err.status === 405
  );
});

test("split admin tokens enforce read/write least privilege", async () => {
  const env = {
    PAYPAL_ENVIRONMENT: "live",
    ADMIN_READ_TOKEN: "reader-secret",
    ADMIN_WRITE_TOKEN: "writer-secret",
    DB: { marker: true },
  };
  const readiness = adminAuthReadiness(env);
  assert.equal(readiness.productionRbacReady, true);
  assert.equal(readiness.readReady, true);
  assert.equal(readiness.writeReady, true);

  const readerGet = new Request("https://worker.example/admin/system", {
    headers: { Authorization: "Bearer reader-secret" },
  });
  const readerAuth = await authorizeAdminRequest(readerGet, env, ADMIN_ROLE_READER);
  assert.equal(readerAuth.role, ADMIN_ROLE_READER);
  assert.equal(readerAuth.mode, "SPLIT_READ");

  const writerGet = new Request("https://worker.example/admin/system", {
    headers: { Authorization: "Bearer writer-secret" },
  });
  const writerAuth = await authorizeAdminRequest(writerGet, env, ADMIN_ROLE_READER);
  assert.equal(writerAuth.role, ADMIN_ROLE_OWNER);
  assert.equal(writerAuth.mode, "SPLIT_WRITE");

  const readerWrite = new Request("https://worker.example/admin/tasks/1", {
    method: "PATCH",
    headers: { Authorization: "Bearer reader-secret" },
  });
  await assert.rejects(
    () => authorizeAdminRequest(readerWrite, env, ADMIN_ROLE_OWNER),
    err => err instanceof RuntimeGuardError && err.code === "FORBIDDEN" && err.status === 403
  );

  const writerWrite = new Request("https://worker.example/admin/tasks/1", {
    method: "PATCH",
    headers: { Authorization: "Bearer writer-secret" },
  });
  const writeAuth = await authorizeAdminRequest(writerWrite, env, ADMIN_ROLE_OWNER);
  assert.equal(writeAuth.role, ADMIN_ROLE_OWNER);

  const scoped = scopeAdminEnv(env, readerAuth);
  assert.equal(scoped.ADMIN_TOKEN, "reader-secret");
  assert.equal(scoped.ADMIN_AUTH_CONTEXT.role, ADMIN_ROLE_READER);
  assert.equal(scoped.ADMIN_AUTH_CONTEXT.readConfigured, true);
  assert.equal(scoped.ADMIN_AUTH_CONTEXT.writeConfigured, true);
  assert.equal(scoped.DB, env.DB);
});

test("live admin mutations fail closed on legacy or partial RBAC configuration", async () => {
  const legacyWrite = new Request("https://worker.example/admin/tasks/1", {
    method: "PATCH",
    headers: { Authorization: "Bearer legacy-secret" },
  });
  await assert.rejects(
    () => authorizeAdminRequest(legacyWrite, { PAYPAL_ENVIRONMENT: "live", ADMIN_TOKEN: "legacy-secret" }, ADMIN_ROLE_OWNER),
    err => err instanceof RuntimeGuardError && err.code === "ADMIN_RBAC_NOT_READY" && err.status === 503
  );

  const legacyRead = new Request("https://worker.example/admin/system", {
    headers: { Authorization: "Bearer legacy-secret" },
  });
  await assert.doesNotReject(
    () => authorizeAdminRequest(legacyRead, { PAYPAL_ENVIRONMENT: "live", ADMIN_TOKEN: "legacy-secret" }, ADMIN_ROLE_READER)
  );

  const partialWrite = new Request("https://worker.example/admin/tasks/1", {
    method: "PATCH",
    headers: { Authorization: "Bearer reader-secret" },
  });
  await assert.rejects(
    () => authorizeAdminRequest(partialWrite, { PAYPAL_ENVIRONMENT: "live", ADMIN_READ_TOKEN: "reader-secret" }, ADMIN_ROLE_OWNER),
    err => err instanceof RuntimeGuardError && err.code === "ADMIN_RBAC_NOT_READY" && err.status === 503
  );
});

test("legacy rental admin endpoints inherit the split RBAC boundary", async () => {
  const env = {
    PAYPAL_ENVIRONMENT: "live",
    ADMIN_READ_TOKEN: "reader-secret",
    ADMIN_WRITE_TOKEN: "writer-secret",
  };
  const read = new Request("https://worker.example/rental-requests", {
    headers: { Authorization: "Bearer reader-secret" },
  });
  await assert.doesNotReject(() => guardRuntimeRequest(read, env));

  const deniedPatch = new Request("https://worker.example/rental-request/123", {
    method: "PATCH",
    headers: { Authorization: "Bearer reader-secret", "Content-Type": "application/json" },
    body: "{}",
  });
  await assert.rejects(
    () => guardRuntimeRequest(deniedPatch, env),
    err => err instanceof RuntimeGuardError && err.code === "FORBIDDEN" && err.status === 403
  );

  const allowedPatch = new Request("https://worker.example/rental-request/123", {
    method: "PATCH",
    headers: { Authorization: "Bearer writer-secret", "Content-Type": "application/json" },
    body: "{}",
  });
  await assert.doesNotReject(() => guardRuntimeRequest(allowedPatch, env));
});

test("live human writes fail closed without abuse controls", async () => {
  const request = new Request("https://worker.example/rental-request", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  await assert.rejects(
    () => guardRuntimeRequest(request, { PAYPAL_ENVIRONMENT: "live", DB: {} }),
    err => err instanceof RuntimeGuardError && err.code === "LIVE_BACKEND_NOT_READY" && err.status === 503
  );
  await assert.doesNotReject(() => guardRuntimeRequest(request, {
    PAYPAL_ENVIRONMENT: "live",
    DB: {},
    RATE_LIMITER: { limit() {} },
    TURNSTILE_SECRET: "configured",
  }));
});

test("live checkout refuses partial provider or catalog configuration", async () => {
  const request = new Request("https://worker.example/create-order", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  const base = {
    PAYPAL_ENVIRONMENT: "live",
    DB: {},
    RATE_LIMITER: { limit() {} },
    TURNSTILE_SECRET: "configured",
  };
  await assert.rejects(() => guardRuntimeRequest(request, base), /LIVE_BACKEND_NOT_READY/);
  await assert.doesNotReject(() => guardRuntimeRequest(request, {
    ...base,
    PAYPAL_CLIENT_ID: "configured",
    PAYPAL_CLIENT_SECRET: "configured",
    GITHUB_TOKEN: "configured",
  }));
});

test("runtime guard enforces route methods and declared request size", async () => {
  const wrongMethod = new Request("https://worker.example/create-order", { method: "GET" });
  await assert.rejects(
    () => guardRuntimeRequest(wrongMethod, {}),
    err => err instanceof RuntimeGuardError && err.code === "METHOD_NOT_ALLOWED" && err.status === 405
  );
  const oversized = new Request("https://worker.example/rental-request", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Content-Length": String(MAX_REQUEST_BYTES + 1) },
    body: "{}",
  });
  await assert.rejects(
    () => guardRuntimeRequest(oversized, {}),
    err => err instanceof RuntimeGuardError && err.code === "REQUEST_TOO_LARGE" && err.status === 413
  );
});

test("public readiness exposes booleans, not secrets", () => {
  const notReady = productionReadiness({ PAYPAL_ENVIRONMENT: "live" });
  assert.equal(notReady.productionGuardsReady, false);
  assert.equal(notReady.checkoutReady, false);
  const ready = productionReadiness({
    PAYPAL_ENVIRONMENT: "live",
    DB: {},
    RATE_LIMITER: { limit() {} },
    TURNSTILE_SECRET: "turnstile-secret",
    PAYPAL_CLIENT_ID: "paypal-id",
    PAYPAL_CLIENT_SECRET: "paypal-secret",
    PAYPAL_WEBHOOK_ID: "webhook-id",
    GITHUB_TOKEN: "github-secret",
  });
  assert.equal(ready.productionGuardsReady, true);
  assert.equal(ready.checkoutReady, true);
  assert.equal(ready.webhookReady, true);
  assert.equal(JSON.stringify(ready).includes("paypal-secret"), false);
  assert.equal(JSON.stringify(ready).includes("github-secret"), false);
});

test("runtime responses carry request correlation and hardened health metadata", async () => {
  const req = new Request("https://worker.example/health");
  const source = new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
  const out = await finalizeRuntimeResponse(source, req, {}, "req-test-1", "/health");
  assert.equal(out.headers.get("X-Request-Id"), "req-test-1");
  assert.match(out.headers.get("Strict-Transport-Security") || "", /max-age=31536000/);
  const data = await out.json();
  assert.equal(data.backendHardening.version, BACKEND_HARDENING_VERSION);
  assert.equal(data.backendHardening.maxRentalDays, 7);
  assert.equal(data.backendHardening.maxRequestBytes, MAX_REQUEST_BYTES);
});

test("runtime errors never expose configuration values", async () => {
  const response = runtimeErrorResponse(new RuntimeGuardError("LIVE_BACKEND_NOT_READY", 503), "req-safe", "https://disorder119.com");
  const body = await response.json();
  assert.deepEqual(body, { error: "LIVE_BACKEND_NOT_READY", requestId: "req-safe" });
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "https://disorder119.com");
});

test("worker entrypoint cannot bypass runtime or admin RBAC guards", () => {
  const entry = fs.readFileSync(path.join(here, "worker-entry.js"), "utf8");
  assert.match(entry, /authorizeRouteEnv\(request, env, url, reqId\)/);
  assert.match(entry, /authorizeAdminRequest\(request, env, requiredRole\)/);
  assert.match(entry, /scopeAdminEnv\(env, auth\)/);
  assert.match(entry, /guardRuntimeRequest\(request, runtimeEnv, url\)/);
  assert.match(entry, /finalizeRuntimeResponse/);
  assert.match(entry, /runtimeErrorResponse/);
});

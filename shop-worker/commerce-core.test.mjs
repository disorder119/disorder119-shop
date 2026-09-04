import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CURRENCY,
  INVENTORY_STATUSES,
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

const here = path.dirname(fileURLToPath(import.meta.url));

test("daily rent is exactly 10% of authoritative sale price rounded to cents", () => {
  assert.equal(rentalDailyPriceCents(parsePriceToCents(125)), 1250);
  assert.equal(rentalDailyPriceCents(parsePriceToCents(250)), 2500);
  assert.equal(rentalDailyPriceCents(parsePriceToCents(490)), 4900);
  assert.equal(money(rentalDailyPriceCents(parsePriceToCents(99.99))), "10.00");
});

test("rental total uses inclusive rental days and integer cents", () => {
  const quote = rentalQuoteFromItem({ id: 1, price: 125, public_status: "AVAILABLE" }, "2026-09-05", "2026-09-07");
  assert.equal(quote.currency, CURRENCY);
  assert.equal(quote.days, 3);
  assert.equal(quote.dailyPriceCents, 1250);
  assert.equal(quote.totalPriceCents, 3750);
});

test("price-on-request remains price-on-request", () => {
  const quote = rentalQuoteFromItem({ id: 1, price: null, public_status: "AVAILABLE" }, "2026-09-05", "2026-09-05");
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

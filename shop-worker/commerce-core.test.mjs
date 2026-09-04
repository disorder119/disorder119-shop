import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CURRENCY,
  INVENTORY_STATUSES,
  canTransitionInventory,
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

test("worker no longer contains public GitHub JSON rental storage", () => {
  const worker = fs.readFileSync(path.join(here, "worker.js"), "utf8");
  assert.equal(worker.includes("rental-requests.json"), false);
  assert.equal(worker.includes("appendRentalRequest(env"), false);
  assert.equal(worker.includes("loadRentalRequests(env"), false);
});

test("migration has required commerce tables and overlap lock", () => {
  const migration = fs.readFileSync(path.join(here, "migrations", "0002_commerce_foundation.sql"), "utf8");
  for (const table of [
    "customers", "customer_addresses", "inventory", "reservations", "commerce_orders", "order_items",
    "payments", "payment_events", "shipments", "rental_reservations", "rentals", "returns", "refunds", "audit_events",
  ]) {
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`));
  }
  assert.match(migration, /PRIMARY KEY\(inventory_id, rental_date\)/);
});

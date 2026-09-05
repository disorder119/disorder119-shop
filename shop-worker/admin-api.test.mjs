import test from "node:test";
import assert from "node:assert/strict";

import {
  clampAdminLimit,
  clampAdminOffset,
  clampAnalyticsDays,
  orderNextStatuses,
  rentalNextStatuses,
} from "./admin-api.js";

test("admin pagination bounds are defensive", () => {
  assert.equal(clampAdminLimit(undefined), 50);
  assert.equal(clampAdminLimit("0"), 50);
  assert.equal(clampAdminLimit("25"), 25);
  assert.equal(clampAdminLimit("9999"), 250);
  assert.equal(clampAdminOffset("-1"), 0);
  assert.equal(clampAdminOffset("42"), 42);
  assert.equal(clampAdminOffset("9999999"), 100000);
});

test("analytics period stays within dashboard limits", () => {
  assert.equal(clampAnalyticsDays(undefined), 30);
  assert.equal(clampAnalyticsDays("1"), 7);
  assert.equal(clampAnalyticsDays("30"), 30);
  assert.equal(clampAnalyticsDays("999"), 365);
});

test("order next statuses use the same commerce state machine", () => {
  assert.deepEqual(orderNextStatuses("PAYMENT_PENDING").sort(), ["CANCELLED", "PAID"].sort());
  assert.deepEqual(orderNextStatuses("PAID").sort(), ["PREPARING", "REFUNDED"].sort());
  assert.deepEqual(orderNextStatuses("SHIPPED").sort(), ["DELIVERED", "RETURN_REQUESTED"].sort());
  assert.deepEqual(orderNextStatuses("CANCELLED"), []);
});

test("rental next statuses use the same commerce state machine", () => {
  assert.deepEqual(rentalNextStatuses("RESERVED").sort(), ["PAYMENT_PENDING", "CONFIRMED", "CANCELLED"].sort());
  assert.deepEqual(rentalNextStatuses("CONFIRMED").sort(), ["ACTIVE", "CANCELLED", "REFUNDED"].sort());
  assert.deepEqual(rentalNextStatuses("RETURN_DUE"), ["RETURNED"]);
  assert.deepEqual(rentalNextStatuses("CANCELLED"), []);
});

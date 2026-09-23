import test from "node:test";
import assert from "node:assert/strict";

import {
  CouponCheckoutError,
  couponCodeFromCreateRequest,
  formatEuros,
  paypalAmountPatch,
} from "./coupon-checkout.js";
import { SHIPPING_FLAT_CENTS, shippingCentsFor } from "./commerce-core.js";

test("PayPal coupon amount is serialized in exact EUR cents", () => {
  assert.equal(formatEuros(9000), "90.00");
  assert.equal(formatEuros(8999), "89.99");
  assert.deepEqual(paypalAmountPatch(8999), [{
    op: "replace",
    path: "/purchase_units/@reference_id=='default'/amount",
    value: { currency_code: "EUR", value: "89.99" },
  }]);
});

test("Coupon patch keeps the flat shipping fee next to the discounted goods", () => {
  assert.deepEqual(paypalAmountPatch(8999, SHIPPING_FLAT_CENTS), [{
    op: "replace",
    path: "/purchase_units/@reference_id=='default'/amount",
    value: {
      currency_code: "EUR",
      value: "95.89",
      breakdown: {
        item_total: { currency_code: "EUR", value: "89.99" },
        shipping: { currency_code: "EUR", value: "5.90" },
      },
    },
  }]);
});

test("Flat shipping is charged once per order, never on an empty basket", () => {
  assert.equal(SHIPPING_FLAT_CENTS, 590);
  assert.equal(shippingCentsFor(8999), 590);
  assert.equal(shippingCentsFor(1), 590);
  assert.equal(shippingCentsFor(0), 0);
});

test("create-order accepts only server reward code format", async () => {
  const valid = new Request("https://example.test/create-order", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ itemId: 119, couponCode: "d119-10-abc234def5" }),
  });
  assert.equal(await couponCodeFromCreateRequest(valid), "D119-10-ABC234DEF5");

  const missing = new Request("https://example.test/create-order", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ itemId: 119 }),
  });
  assert.equal(await couponCodeFromCreateRequest(missing), "");

  const invalid = new Request("https://example.test/create-order", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ itemId: 119, couponCode: "SAVE10" }),
  });
  await assert.rejects(
    () => couponCodeFromCreateRequest(invalid),
    error => error instanceof CouponCheckoutError && error.code === "COUPON_INVALID_OR_USED" && error.status === 409,
  );
});

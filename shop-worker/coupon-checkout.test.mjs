import test from "node:test";
import assert from "node:assert/strict";

import {
  CouponCheckoutError,
  couponCodeFromCreateRequest,
  formatEuros,
  paypalAmountPatch,
} from "./coupon-checkout.js";

test("PayPal coupon amount is serialized in exact EUR cents", () => {
  assert.equal(formatEuros(9000), "90.00");
  assert.equal(formatEuros(8999), "89.99");
  assert.deepEqual(paypalAmountPatch(8999), [{
    op: "replace",
    path: "/purchase_units/@reference_id=='default'/amount",
    value: { currency_code: "EUR", value: "89.99" },
  }]);
});

test("Coupon patch keeps the chosen shipping price next to the discounted goods", () => {
  // Versand kommt aus der Bestellung (order_versand/shipping_cents), z. B.
  // 5,90 EUR fuer ein mittleres Paket.
  assert.deepEqual(paypalAmountPatch(8999, 590), [{
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

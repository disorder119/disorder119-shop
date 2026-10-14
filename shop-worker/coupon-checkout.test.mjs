import test from "node:test";
import assert from "node:assert/strict";

import {
  CouponCheckoutError,
  couponCodeFromCreateRequest,
  formatEuros,
  paypalAmountPatch,
} from "./coupon-checkout.js";
import worker from "./worker-entry.js";
import { issueRewardCoupon } from "./game-rewards.js";
import { versandCacheLeeren } from "./versand.js";
import { allMigrations, sqliteD1 } from "./test-d1.mjs";

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

// Kasse mit Gutschein ueber worker-entry.js - nachgebaut: GitHub
// (data/items.json) und PayPal (anlegen, Betrag korrigieren, reservieren).
const SHOP = "https://disorder119.com";
const JEANS = { id: 9427, article: "9427", brand: "Jean Paul Gaultier", title: "Jean Paul Gaultier Jeans Damen Marineblau", price: 90, public_status: "AVAILABLE", taxonomy_category: "Pants", product_type: "Trousers" };
const ADRESSE = { name: "Maria Müller", strasse: "Nelseestraße", hausnummer: "25a", plz: "63739", ort: "Aschaffenburg", land: "DE" };

function gutscheinNetz() {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    const method = init.method || "GET";
    calls.push({ host: u.host, path: u.pathname, method });
    if (u.host === "api.github.com") {
      if (u.pathname.endsWith("/contents/data")) return Response.json([{ name: "items.json", type: "file", sha: "a".repeat(40) }]);
      if (u.pathname.endsWith(`/git/blobs/${"a".repeat(40)}`)) return new Response(JSON.stringify([JEANS]));
    }
    if (u.host === "api-m.sandbox.paypal.com") {
      if (u.pathname === "/v1/oauth2/token") return Response.json({ access_token: "paypal-test-token" });
      if (u.pathname === "/v2/checkout/orders" && method === "POST") return Response.json({ id: "PAYPAL-COUPON-1", status: "CREATED" }, { status: 201 });
      if (u.pathname === "/v2/checkout/orders/PAYPAL-COUPON-1" && method === "PATCH") return new Response(null, { status: 204 });
      if (u.pathname === "/v2/checkout/orders/PAYPAL-COUPON-1" && method === "GET") return Response.json({ payer: {}, purchase_units: [{ shipping: {} }] });
      if (u.pathname === "/v2/checkout/orders/PAYPAL-COUPON-1/authorize") {
        return Response.json({
          id: "PAYPAL-COUPON-1", status: "COMPLETED",
          purchase_units: [{ custom_id: "9427", payments: { authorizations: [{
            id: "AUTH-COUPON-1", status: "CREATED", amount: { currency_code: "EUR", value: "87.19" },
            create_time: new Date().toISOString(), expiration_time: new Date(Date.now() + 29 * 86_400_000).toISOString(),
          }] } }],
        }, { status: 201 });
      }
    }
    return new Response("{}", { status: 404 });
  };
  return { calls, restore() { globalThis.fetch = original; } };
}

async function kasse(env, path, body, key) {
  const request = new Request(`https://api.disorder119.com${path}`, {
    method: "POST",
    headers: { Origin: SHOP, "Content-Type": "application/json", "Idempotency-Key": key },
    body: JSON.stringify(body),
  });
  const response = await worker.fetch(request, env);
  return { status: response.status, data: await response.json() };
}

test("create-order replay with a coupon returns the original order; another order still cannot take the code", async () => {
  versandCacheLeeren();
  const netz = gutscheinNetz();
  const DB = sqliteD1(allMigrations());
  const env = { DB, GITHUB_TOKEN: "gh-test", PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: "secret" };
  const { code } = await issueRewardCoupon(DB, {});
  const bestellung = { itemIds: [9427], adresse: ADRESSE, email: "kundin@example.com",
    versand: "fest-dhl-S", versandPreisCents: 619, couponCode: code };
  try {
    const erst = await kasse(env, "/create-order", bestellung, "k-gutschein-0000000001");
    assert.equal(erst.status, 200, JSON.stringify(erst.data));
    assert.equal(erst.data.coupon.status, "RESERVED");
    assert.equal(erst.data.coupon.discountedTotalCents, 8719); // 90 EUR - 10 % + 6,19 EUR Versand

    // PayPal-Fenster geschlossen, erneut geklickt: dieselbe Kasse schickt
    // denselben Schluessel mit demselben Inhalt.
    const wieder = await kasse(env, "/create-order", bestellung, "k-gutschein-0000000001");
    assert.equal(wieder.status, 200, JSON.stringify(wieder.data));
    assert.equal(wieder.data.id, erst.data.id);
    assert.equal(wieder.data.orderId, erst.data.orderId);
    assert.equal(wieder.data.coupon.applied, true);
    assert.equal(wieder.data.coupon.discountedTotalCents, 8719);
    assert.equal(netz.calls.filter(c => c.path === "/v2/checkout/orders" && c.method === "POST").length, 1);
    assert.equal(netz.calls.filter(c => c.method === "PATCH").length, 1, "Betrag nur einmal korrigiert");

    // Eine andere Bestellung (neuer Schluessel) bekommt den reservierten Code nicht.
    const fremd = await kasse(env, "/create-order", bestellung, "k-gutschein-0000000002");
    assert.equal(fremd.status, 409, JSON.stringify(fremd.data));
    // Eine offene Bestellung haelt ihn: voruebergehend belegt, die Kasse behaelt den Code.
    assert.equal(fremd.data.error, "COUPON_RESERVED");
    // Gleicher Schluessel mit anderem Inhalt bleibt eine abgelehnte Wiederverwendung.
    const anders = await kasse(env, "/create-order", { ...bestellung, createAccount: true }, "k-gutschein-0000000001");
    assert.equal(anders.status, 409, JSON.stringify(anders.data));
    assert.equal(anders.data.error, "IDEMPOTENCY_KEY_REUSED");
    assert.equal(DB.raw.prepare("SELECT COUNT(*) AS n FROM commerce_orders").get().n, 1);

    // Bezahlen: PayPal reserviert den rabattierten Betrag, der Code ist eingeloest.
    const bezahlt = await kasse({ ...env, GITHUB_TOKEN: "" }, "/capture-order", { orderId: erst.data.id }, "k-gutschein-zahlung-001");
    assert.equal(bezahlt.status, 200, JSON.stringify(bezahlt.data));
    assert.equal(bezahlt.data.zahlung, "RESERVIERT");
    assert.equal(DB.raw.prepare("SELECT status FROM commerce_orders").get().status, "PAID");
    assert.equal(DB.raw.prepare("SELECT status FROM reward_coupons").get().status, "REDEEMED");

    // Auch danach liefert derselbe Schluessel genau diese eine Bestellung.
    const spaeter = await kasse(env, "/create-order", bestellung, "k-gutschein-0000000001");
    assert.equal(spaeter.status, 200, JSON.stringify(spaeter.data));
    assert.equal(spaeter.data.orderId, erst.data.orderId);
    assert.equal(spaeter.data.coupon.status, "REDEEMED");
  } finally {
    netz.restore();
  }
});

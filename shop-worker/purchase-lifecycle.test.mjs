import assert from "node:assert/strict";
import test from "node:test";
import shopWorker, { completePayment, expirePurchaseReservations, reconcilePurchasePayments } from "./worker.js";
import { handleAdminRequest } from "./admin-api.js";
import { handleAdminInsights } from "./admin-insights.js";
import { handleAdminCommerceMetrics } from "./admin-commerce-metrics.js";
import { allMigrations, sqliteD1 } from "./test-d1.mjs";

const adminOrigin = "https://admin.disorder119.com";
const shopOrigin = "https://disorder119.com";

function fixture({ expired = false, items = [90001, 90002] } = {}) {
  const DB = sqliteD1(allMigrations());
  const now = new Date();
  const expires = new Date(now.getTime() + (expired ? -60_000 : 15 * 60_000)).toISOString();
  const created = new Date(now.getTime() - 60_000).toISOString();
  const key = "synthetic-checkout-key";
  const run = (sql, ...args) => DB.raw.prepare(sql).run(...args);
  for (const item of items) {
    run(`INSERT INTO inventory (id,item_id,article_no,status,catalog_status,updated_at)
      VALUES (?,?,?,'PAYMENT_PENDING','AVAILABLE',?)`, `inv-${item}`, item, String(item), created);
    run(`INSERT INTO reservations (id,inventory_id,kind,status,idempotency_key,expires_at,created_at)
      VALUES (?,?,'PURCHASE','RESERVED',?,?,?)`, `res-${item}`, `inv-${item}`, `${key}#${item}`, expires, created);
  }
  run(`INSERT INTO commerce_orders (id,order_number,reservation_id,status,subtotal_cents,shipping_cents,total_cents,idempotency_key,created_at)
    VALUES ('order-1','D119-SYNTHETIC-1',?,'PAYMENT_PENDING',10000,500,10500,?,?)`, `res-${items[0]}`, key, created);
  items.forEach((item, index) => run(`INSERT INTO order_items
    (id,order_id,inventory_id,item_id,article_no,title_snapshot,unit_price_cents)
    VALUES (?,'order-1',?,?,?,'Synthetic item',?)`, `line-${item}`, `inv-${item}`, item, String(item), index ? 4000 : 6000));
  run(`INSERT INTO payments (id,order_id,provider,provider_order_id,status,amount_cents,idempotency_key,created_at)
    VALUES ('payment-1','order-1','PAYPAL','PAYPAL-SYNTHETIC-1','CREATED',10500,'synthetic-payment-key',?)`, created);
  return { DB, env: { DB, ADMIN_TOKEN: "test-only", PAYPAL_CLIENT_ID: "test", PAYPAL_CLIENT_SECRET: "test" } };
}

function capture(itemIds = [90001, 90002]) {
  return { status: "COMPLETED", purchase_units: [{ custom_id: itemIds.join(","), payments: {
    captures: [{ id: "CAP-SYNTHETIC-1", status: "COMPLETED", amount: { currency_code: "EUR", value: "105.00" } }],
  } }] };
}

// PayPal-Bestellung nach /authorize: reserviert, nichts eingezogen.
function authorization(itemIds = [90001, 90002], status = "CREATED") {
  return { status: "COMPLETED", purchase_units: [{ custom_id: itemIds.join(","), payments: {
    authorizations: [{ id: "AUTH-SYNTHETIC-1", status, amount: { currency_code: "EUR", value: "105.00" },
      create_time: new Date().toISOString(), expiration_time: new Date(Date.now() + 29 * 86_400_000).toISOString() }],
  } }] };
}

async function admin(env, path, method = "GET", data) {
  const request = new Request(`https://api.disorder119.com${path}`, {
    method, headers: { Origin: adminOrigin, Authorization: "Bearer test-only", ...(data ? { "Content-Type": "application/json" } : {}) },
    ...(data ? { body: JSON.stringify(data) } : {}),
  });
  const response = await handleAdminRequest(request, env, new URL(request.url), "synthetic-admin", adminOrigin);
  return { status: response.status, body: await response.json() };
}

test("unpaid multi-item checkout expires together and a later reservation survives another sweep", async () => {
  const { DB, env } = fixture({ expired: true });
  await expirePurchaseReservations(env);
  assert.equal(DB.raw.prepare("SELECT status FROM commerce_orders WHERE id='order-1'").get().status, "CANCELLED");
  assert.equal(DB.raw.prepare("SELECT status FROM payments WHERE id='payment-1'").get().status, "CANCELLED");
  assert.deepEqual(DB.raw.prepare("SELECT status FROM reservations ORDER BY id").all().map(x => x.status), ["EXPIRED", "EXPIRED"]);
  assert.deepEqual(DB.raw.prepare("SELECT status FROM inventory ORDER BY id").all().map(x => x.status), ["AVAILABLE", "AVAILABLE"]);
  DB.raw.prepare(`INSERT INTO reservations (id,inventory_id,kind,status,idempotency_key,expires_at,created_at)
    VALUES ('new-res','inv-90001','PURCHASE','RESERVED','new-key',?,?)`).run(new Date(Date.now() + 900_000).toISOString(), new Date().toISOString());
  DB.raw.prepare("UPDATE inventory SET status='RESERVED' WHERE id='inv-90001'").run();
  await expirePurchaseReservations(env);
  assert.equal(DB.raw.prepare("SELECT status FROM reservations WHERE id='new-res'").get().status, "RESERVED");
  assert.equal(DB.raw.prepare("SELECT status FROM inventory WHERE id='inv-90001'").get().status, "RESERVED");
});

test("admin cancellation ends the unpaid reservation without refund or sale", async () => {
  const { DB, env } = fixture();
  const result = await admin(env, "/admin/orders/order-1", "PATCH", { status: "CANCELLED" });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(DB.raw.prepare("SELECT status FROM commerce_orders").get().status, "CANCELLED");
  assert.equal(DB.raw.prepare("SELECT status FROM payments").get().status, "CANCELLED");
  assert.deepEqual(DB.raw.prepare("SELECT status FROM reservations ORDER BY id").all().map(x => x.status), ["CANCELLED", "CANCELLED"]);
  assert.deepEqual(DB.raw.prepare("SELECT status FROM inventory ORDER BY id").all().map(x => x.status), ["AVAILABLE", "AVAILABLE"]);
  assert.equal(DB.raw.prepare("SELECT COUNT(*) AS n FROM refunds").get().n, 0);
  assert.equal((await admin(env, "/admin/orders/order-1", "PATCH", { status: "PAID" })).status, 409);
});

test("a cancelled checkout never calls PayPal capture", async () => {
  const { DB, env } = fixture({ expired: true });
  await expirePurchaseReservations(env);
  const request = new Request("https://api.disorder119.com/capture-order", {
    method: "POST", headers: { Origin: shopOrigin, "Content-Type": "application/json", "Idempotency-Key": "synthetic-capture-001" },
    body: JSON.stringify({ orderId: "PAYPAL-SYNTHETIC-1" }),
  });
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error("PayPal must not be called"); };
  try {
    const response = await shopWorker.fetch(request, env);
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error, "RESERVATION_EXPIRED");
    assert.equal(calls, 0);
    assert.equal(DB.raw.prepare("SELECT COUNT(*) AS n FROM tax_cash_events").get().n, 0);
  } finally { globalThis.fetch = original; }
});

test("a provider capture after cancellation records evidence but never sells another buyer's inventory", async () => {
  const { DB, env } = fixture({ expired: true });
  await expirePurchaseReservations(env);
  await assert.rejects(completePayment(env, "PAYPAL-SYNTHETIC-1", capture(), "late-provider"), e => e.code === "PAYMENT_RECONCILIATION_REQUIRED");
  assert.equal(DB.raw.prepare("SELECT status FROM commerce_orders").get().status, "CANCELLED");
  assert.equal(DB.raw.prepare("SELECT status FROM inventory LIMIT 1").get().status, "AVAILABLE");
  assert.equal(DB.raw.prepare("SELECT COUNT(*) AS n FROM tax_cash_events WHERE kind='capture'").get().n, 1);
});

test("capture in progress blocks expiry and admin cancellation", async () => {
  const { DB, env } = fixture({ expired: true });
  DB.raw.prepare("UPDATE payments SET status='PENDING',updated_at=? WHERE id='payment-1'").run(new Date().toISOString());
  await expirePurchaseReservations(env);
  assert.equal(DB.raw.prepare("SELECT status FROM commerce_orders").get().status, "PAYMENT_PENDING");
  assert.equal(DB.raw.prepare("SELECT status FROM inventory LIMIT 1").get().status, "PAYMENT_PENDING");
  assert.equal((await admin(env, "/admin/orders/order-1", "PATCH", { status: "CANCELLED" })).status, 409);
  assert.equal(DB.raw.prepare("SELECT status FROM reservations LIMIT 1").get().status, "RESERVED");
});

test("overview never counts an open order as a paid order or top product", async () => {
  const { env } = fixture();
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json([]);
  try {
    const result = await admin(env, "/admin/overview");
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(result.body.orders.paymentPending, 1);
    assert.equal(result.body.payments.capturedCents, 0);
    assert.deepEqual(result.body.topPurchased, []);
    assert.equal(result.body.daily.reduce((sum, row) => sum + row.orderValueCents, 0), 0);
  } finally { globalThis.fetch = original; }
});

test("admin overview cleans an expired unpaid checkout even without a cron trigger", async () => {
  const { DB, env } = fixture({ expired: true });
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json([]);
  try {
    const result = await admin(env, "/admin/overview");
    assert.equal(result.status, 200);
    assert.equal(DB.raw.prepare("SELECT status FROM commerce_orders").get().status, "CANCELLED");
    assert.equal(DB.raw.prepare("SELECT status FROM inventory LIMIT 1").get().status, "AVAILABLE");
  } finally { globalThis.fetch = original; }
});

test("capture claim prevents an admin cancellation while PayPal responds", async () => {
  const { DB, env } = fixture();
  const original = globalThis.fetch;
  let cancelStatus;
  let captureCalls = 0;
  globalThis.fetch = async (url) => {
    const path = new URL(String(url)).pathname;
    if (path === "/v1/oauth2/token") return Response.json({ access_token: "synthetic-token" });
    if (path.endsWith("/authorize")) {
      captureCalls++;
      cancelStatus = (await admin(env, "/admin/orders/order-1", "PATCH", { status: "CANCELLED" })).status;
      return Response.json(authorization(), { status: 201 });
    }
    throw new Error(`unexpected request ${path}`);
  };
  try {
    const request = new Request("https://api.disorder119.com/capture-order", {
      method: "POST", headers: { Origin: shopOrigin, "Content-Type": "application/json", "Idempotency-Key": "synthetic-capture-race-001" },
      body: JSON.stringify({ orderId: "PAYPAL-SYNTHETIC-1" }),
    });
    const response = await shopWorker.fetch(request, env);
    assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
    assert.equal(cancelStatus, 409);
    assert.equal(captureCalls, 1);
    assert.equal(DB.raw.prepare("SELECT status FROM commerce_orders").get().status, "PAID");
    assert.deepEqual(DB.raw.prepare("SELECT status FROM reservations ORDER BY id").all().map(x => x.status), ["CONSUMED", "CONSUMED"]);
    // Nur reserviert: noch kein Zufluss, also auch kein Steuerbeleg.
    assert.equal(DB.raw.prepare("SELECT status FROM payments").get().status, "AUTHORIZED");
    assert.equal(DB.raw.prepare("SELECT COUNT(*) AS n FROM tax_cash_events WHERE kind='capture'").get().n, 0);
    // Direkt "Storniert" geht bei einer reservierten Zahlung nie - nur ueber
    // "Stornieren", das die Reservierung bei PayPal freigibt.
    assert.equal((await admin(env, "/admin/orders/order-1", "PATCH", { status: "CANCELLED" })).status, 409);
  } finally { globalThis.fetch = original; }
});

test("reconciliation confirms an interrupted authorization from PayPal", async () => {
  const { DB, env } = fixture({ expired: true });
  DB.raw.prepare("UPDATE payments SET status='PENDING',updated_at=? WHERE id='payment-1'")
    .run(new Date(Date.now() - 10 * 60_000).toISOString());
  const original = globalThis.fetch;
  globalThis.fetch = async url => {
    const path = new URL(String(url)).pathname;
    if (path === "/v1/oauth2/token") return Response.json({ access_token: "synthetic-token" });
    if (path.endsWith("PAYPAL-SYNTHETIC-1")) return Response.json(authorization());
    throw new Error(`unexpected request ${path}`);
  };
  try {
    await reconcilePurchasePayments(env);
    const zahlung = DB.raw.prepare("SELECT status,authorization_id FROM payments").get();
    assert.deepEqual({ ...zahlung }, { status: "AUTHORIZED", authorization_id: "AUTH-SYNTHETIC-1" });
    assert.equal(DB.raw.prepare("SELECT status FROM commerce_orders").get().status, "PAID");
    assert.equal(DB.raw.prepare("SELECT COUNT(*) AS n FROM tax_cash_events").get().n, 0);
  } finally { globalThis.fetch = original; }
});

test("a declined reservation is released like an abandoned payment after four hours", async () => {
  const { DB, env } = fixture({ expired: true });
  DB.raw.prepare("UPDATE payments SET status='PENDING',updated_at=? WHERE id='payment-1'")
    .run(new Date(Date.now() - 5 * 60 * 60_000).toISOString());
  const original = globalThis.fetch;
  globalThis.fetch = async url => {
    const path = new URL(String(url)).pathname;
    if (path === "/v1/oauth2/token") return Response.json({ access_token: "synthetic-token" });
    if (path.endsWith("PAYPAL-SYNTHETIC-1")) return Response.json(authorization(undefined, "DENIED"));
    throw new Error(`unexpected request ${path}`);
  };
  try {
    await reconcilePurchasePayments(env);
    assert.equal(DB.raw.prepare("SELECT status FROM payments").get().status, "FAILED");
    assert.equal(DB.raw.prepare("SELECT status FROM commerce_orders").get().status, "CANCELLED");
    assert.deepEqual(DB.raw.prepare("SELECT status FROM inventory ORDER BY id").all().map(x => x.status), ["AVAILABLE", "AVAILABLE"]);
  } finally { globalThis.fetch = original; }
});

test("reconciliation confirms an interrupted capture from PayPal", async () => {
  const { DB, env } = fixture({ expired: true });
  DB.raw.prepare("UPDATE payments SET status='PENDING',updated_at=? WHERE id='payment-1'")
    .run(new Date(Date.now() - 10 * 60_000).toISOString());
  const original = globalThis.fetch;
  globalThis.fetch = async url => {
    const path = new URL(String(url)).pathname;
    if (path === "/v1/oauth2/token") return Response.json({ access_token: "synthetic-token" });
    if (path.endsWith("PAYPAL-SYNTHETIC-1")) return Response.json(capture());
    throw new Error(`unexpected request ${path}`);
  };
  try {
    await reconcilePurchasePayments(env);
    assert.equal(DB.raw.prepare("SELECT status FROM payments").get().status, "COMPLETED");
    assert.equal(DB.raw.prepare("SELECT status FROM commerce_orders").get().status, "PAID");
    assert.equal(DB.raw.prepare("SELECT COUNT(*) AS n FROM tax_cash_events WHERE kind='capture'").get().n, 1);
  } finally { globalThis.fetch = original; }
});

test("a four-hour unpaid provider confirmation is released after provider lookup", async () => {
  const { DB, env } = fixture({ expired: true });
  DB.raw.prepare("UPDATE payments SET status='PENDING',updated_at=? WHERE id='payment-1'")
    .run(new Date(Date.now() - 5 * 60 * 60_000).toISOString());
  const original = globalThis.fetch;
  globalThis.fetch = async url => {
    const path = new URL(String(url)).pathname;
    if (path === "/v1/oauth2/token") return Response.json({ access_token: "synthetic-token" });
    if (path.endsWith("PAYPAL-SYNTHETIC-1")) return Response.json({ status: "APPROVED" });
    throw new Error(`unexpected request ${path}`);
  };
  try {
    await reconcilePurchasePayments(env);
    assert.equal(DB.raw.prepare("SELECT status FROM payments").get().status, "FAILED");
    assert.equal(DB.raw.prepare("SELECT status FROM commerce_orders").get().status, "CANCELLED");
    assert.equal(DB.raw.prepare("SELECT status FROM inventory LIMIT 1").get().status, "AVAILABLE");
  } finally { globalThis.fetch = original; }
});

test("insights and commerce metrics exclude payment-pending orders", async () => {
  const { env } = fixture();
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json([]);
  try {
    for (const [path, handler, key] of [
      ["/admin/insights", handleAdminInsights, "money"],
      ["/admin/commerce-metrics", handleAdminCommerceMetrics, "salesQuality"],
    ]) {
      const request = new Request(`https://api.disorder119.com${path}?days=30`, {
        headers: { Origin: adminOrigin, Authorization: "Bearer test-only" },
      });
      const response = await handler(request, env, new URL(request.url), "synthetic-analytics", adminOrigin);
      assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
      const data = await response.json();
      assert.equal(data[key].capturedSalesCents, 0);
      assert.equal(data[key].paidOrders, 0);
    }
  } finally { globalThis.fetch = original; }
});

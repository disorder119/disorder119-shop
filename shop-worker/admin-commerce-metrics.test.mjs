import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  enrichTopProducts,
  handleAdminCommerceMetrics,
  mergeCustomerValue,
} from "./admin-commerce-metrics.js";

const HERE = dirname(fileURLToPath(import.meta.url));

class Statement {
  constructor(db, sql, params = []) { this.db = db; this.sql = sql; this.params = params; }
  bind(...params) { return new Statement(this.db, this.sql, params); }
  async all() { return { results: this.db.prepare(this.sql).all(...this.params) }; }
  async first() { return this.db.prepare(this.sql).get(...this.params) || null; }
  async run() {
    const result = this.db.prepare(this.sql).run(...this.params);
    return { success: true, meta: { changes: Number(result.changes || 0) } };
  }
  async batchResult() { return /^\s*(SELECT|WITH|PRAGMA)\b/i.test(this.sql) ? this.all() : this.run(); }
}

class D1Adapter {
  constructor(db) { this.db = db; }
  prepare(sql) { return new Statement(this.db, sql); }
  async batch(statements) {
    const results = [];
    this.db.exec("BEGIN");
    try {
      for (const statement of statements) results.push(await statement.batchResult());
      this.db.exec("COMMIT");
      return results;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
}

function database() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  for (const relative of [
    "schema.sql",
    "migrations/0002_commerce_foundation.sql",
    "migrations/0003_state_integrity.sql",
    "migrations/0004_admin_operations.sql",
    "migrations/0005_rental_groups.sql",
    "migrations/0006_operations_cases.sql",
    "migrations/0007_operations_automation.sql",
  ]) db.exec(readFileSync(join(HERE, relative), "utf8"));
  return db;
}

function recentIso(minutesAgo = 0) {
  return new Date(Date.now() - minutesAgo * 60000).toISOString();
}

function seed(db) {
  const now = recentIso();
  db.prepare(`INSERT INTO inventory
    (id,item_id,article_no,status,sale_price_cents,currency,catalog_status,version,updated_at)
    VALUES ('inv-sale',920001,'SALE-1','AVAILABLE',10000,'EUR','AVAILABLE',1,?)`).run(now);
  db.prepare(`INSERT INTO inventory
    (id,item_id,article_no,status,sale_price_cents,currency,catalog_status,version,updated_at)
    VALUES ('inv-rental',920002,'RENT-1','AVAILABLE',20000,'EUR','AVAILABLE',1,?)`).run(now);

  db.prepare(`INSERT INTO commerce_orders
    (id,order_number,guest_email,status,currency,subtotal_cents,shipping_cents,total_cents,idempotency_key,created_at,updated_at)
    VALUES ('order-1','D119-METRIC-1','buyer@example.com','PAID','EUR',10000,500,10500,'metric-order-key',?,?)`).run(now, now);
  db.prepare(`INSERT INTO order_items
    (id,order_id,inventory_id,item_id,article_no,title_snapshot,unit_price_cents,quantity,currency)
    VALUES ('oi-1','order-1','inv-sale',920001,'SALE-1','Sale Test Piece',10000,1,'EUR')`).run();
  db.prepare(`INSERT INTO order_contact_snapshots
    (order_id,source_provider,email,captured_at)
    VALUES ('order-1','PAYPAL','buyer@example.com',?)`).run(now);
  db.prepare(`INSERT INTO payments
    (id,order_id,provider,provider_order_id,status,amount_cents,currency,idempotency_key,created_at,updated_at)
    VALUES ('pay-1','order-1','PAYPAL','PO-1','COMPLETED',10500,'EUR','metric-pay-key',?,?)`).run(now, now);
  db.prepare(`INSERT INTO refunds
    (id,order_id,payment_id,provider_refund_id,amount_cents,currency,status,idempotency_key,created_at,updated_at)
    VALUES ('refund-sale','order-1','pay-1','RF-1',1000,'EUR','COMPLETED','metric-refund-sale',?,?)`).run(now, now);
  db.prepare(`INSERT INTO returns
    (id,order_id,status,reason_code,created_at,updated_at)
    VALUES ('return-order','order-1','REQUESTED','SIZE',?,?)`).run(now, now);

  db.prepare(`INSERT INTO rental_reservations
    (id,inventory_id,guest_email,start_date,end_date,days,daily_price_cents,total_price_cents,currency,price_on_request,status,
     idempotency_key,deposit_cents,created_at,updated_at)
    VALUES ('rr-1','inv-rental','buyer@example.com','2026-09-10','2026-09-11',2,2000,4000,'EUR',0,'RESERVED',
            'metric-rental-key',10000,?,?)`).run(now, now);
  db.prepare("UPDATE rental_reservations SET status='CONFIRMED',updated_at=? WHERE id='rr-1'").run(now);
  const rentalId = db.prepare("SELECT id FROM rentals WHERE rental_reservation_id='rr-1'").get().id;
  db.prepare(`INSERT INTO refunds
    (id,rental_id,amount_cents,currency,status,idempotency_key,created_at,updated_at)
    VALUES ('refund-rental',?,5000,'EUR','COMPLETED','metric-refund-rental',?,?)`).run(rentalId, now, now);
  db.prepare(`INSERT INTO damage_cases
    (id,rental_id,severity,status,description,estimated_amount_cents,withheld_amount_cents,created_at,updated_at)
    VALUES ('damage-1',?,'MAJOR','OPEN','Damage',3000,1500,?,?)`).run(rentalId, now, now);
}

function request(method = "GET", token = "secret", origin = "https://admin.disorder119.com") {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (origin) headers.Origin = origin;
  return new Request("https://worker.example/admin/commerce-metrics?days=30", { method, headers });
}

test("customer value merges captured sales, sales refunds and rental contract value", () => {
  const rows = mergeCustomerValue(
    [{ email: "Buyer@Example.com", paidOrders: 2, capturedSalesCents: 20000, salesRefundsCents: 3000, firstCommerceAt: "2026-01-01", lastCommerceAt: "2026-02-01" }],
    [{ email: "buyer@example.com", rentals: 1, rentalContractValueCents: 4000, firstCommerceAt: "2026-01-15", lastCommerceAt: "2026-03-01" }],
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].netCapturedSalesCents, 17000);
  assert.equal(rows[0].recordedCommerceValueCents, 21000);
  assert.equal(rows[0].firstCommerceAt, "2026-01-01");
  assert.equal(rows[0].lastCommerceAt, "2026-03-01");
});

test("top products use catalog enrichment without changing authoritative values", () => {
  const catalog = new Map([[42, { id: 42, article: "A-42", title: "Catalog title", brand: "Brand", image: "/x.jpg" }]]);
  const rows = enrichTopProducts([{ itemId: 42, articleNo: "SNAP-42", title: "Snapshot title", count: 2, valueCents: 12345 }], catalog);
  assert.deepEqual(rows[0], {
    itemId: 42,
    articleNo: "SNAP-42",
    title: "Snapshot title",
    brand: "Brand",
    image: "/x.jpg",
    count: 2,
    valueCents: 12345,
  });
});

test("commerce metrics keep sales refunds separate from rental refunds", async () => {
  const db = database();
  seed(db);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async function (input, init) {
    if (String(input) === "https://disorder119.com/data/catalog.json") {
      return new Response(JSON.stringify([
        { id: 920001, article: "SALE-1", title: "Sale Test Piece", brand: "Test Brand", gallery: ["img/sale.jpg"] },
        { id: 920002, article: "RENT-1", title: "Rental Test Piece", brand: "Rental Brand", gallery: ["img/rent.jpg"] },
      ]), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return originalFetch(input, init);
  };
  try {
    const req = request();
    const res = await handleAdminCommerceMetrics(req, { ADMIN_TOKEN: "secret", DB: new D1Adapter(db) }, new URL(req.url), "req-metrics", "https://admin.disorder119.com");
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.salesQuality.capturedSalesCents, 10500);
    assert.equal(data.salesQuality.salesRefundsCents, 1000);
    assert.equal(data.salesQuality.netCapturedSalesCents, 9500);
    assert.equal(data.rentalQuality.completedRentalRefundsCents, 5000);
    assert.equal(data.salesQuality.ordersWithReturn, 1);
    assert.equal(data.salesQuality.paidOrderReturnCaseRate, 1);
    assert.equal(data.rentalQuality.estimatedOpenDamageCents, 3000);
    assert.equal(data.rentalQuality.withheldOpenDamageCents, 1500);
    assert.equal(data.customerValue.top[0].email, "buyer@example.com");
    assert.equal(data.customerValue.top[0].recordedCommerceValueCents, 13500);
    assert.equal(data.topProducts.sales[0].brand, "Test Brand");
    assert.equal(data.topProducts.rentals[0].title, "Rental Test Piece");
    assert.equal(data.conversion.available, false);
    assert.equal(data.conversion.reason, "NO_FUNNEL_EVENTS");
  } finally {
    globalThis.fetch = originalFetch;
    db.close();
  }
});

test("commerce metrics enforce origin, token and read-only method", async () => {
  let req = request("GET", "secret", "https://evil.example");
  let res = await handleAdminCommerceMetrics(req, { ADMIN_TOKEN: "secret", DB: {} }, new URL(req.url), "req-1", "https://evil.example");
  assert.equal(res.status, 403);

  req = request("GET", null);
  res = await handleAdminCommerceMetrics(req, { ADMIN_TOKEN: "secret", DB: {} }, new URL(req.url), "req-2", "https://admin.disorder119.com");
  assert.equal(res.status, 401);

  req = request("POST", "secret");
  res = await handleAdminCommerceMetrics(req, { ADMIN_TOKEN: "secret", DB: {} }, new URL(req.url), "req-3", "https://admin.disorder119.com");
  assert.equal(res.status, 405);
});

import assert from "node:assert/strict";
import test from "node:test";

import { handleAdminRequest } from "./admin-api.js";
import { allMigrations, sqliteD1 } from "./test-d1.mjs";

const ADMIN = "https://admin.disorder119.com";

function database() {
  return sqliteD1(allMigrations());
}

function seedOrder(DB, { id = "o1", number = "D119-TEST-1", status = "CANCELLED" } = {}) {
  const now = new Date().toISOString();
  const run = (sql, ...args) => DB.raw.prepare(sql).run(...args);
  run("INSERT INTO inventory (id,item_id,status,sale_price_cents,updated_at) VALUES (?,?,?,?,?)", `i-${id}`, 1234, "AVAILABLE", 2500, now);
  run(`INSERT INTO commerce_orders
    (id,order_number,guest_email,status,subtotal_cents,shipping_cents,total_cents,idempotency_key,created_at,updated_at)
    VALUES (?,?,?,?,2500,559,3059,?,?,?)`, id, number, "old@example.test", status, `key-${id}`, now, now);
  run(`INSERT INTO order_items (id,order_id,inventory_id,item_id,article_no,title_snapshot,unit_price_cents)
    VALUES (?,?,?,?,?,?,2500)`, `oi-${id}`, id, `i-${id}`, 1234, "#1234", "Testartikel");
  run(`INSERT INTO order_contact_snapshots
    (order_id,source_provider,email,recipient_name,address_line1,postal_code,city,country_code,captured_at)
    VALUES (?,'PAYPAL','old@example.test','Alt Name','Alte Str. 1','10115','Berlin','DE',?)`, id, now);
  return { id, number, now };
}

async function call(DB, path, method = "GET", body) {
  const url = `https://api.disorder119.com${path}`;
  const headers = { Authorization: "Bearer t", Origin: ADMIN };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const request = new Request(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const response = await handleAdminRequest(request, { DB, ADMIN_TOKEN: "t" }, new URL(url), "req-management", ADMIN);
  return { status: response.status, data: await response.json() };
}

test("only a cancelled order without durable evidence can be deleted", async () => {
  const DB = database();
  const order = seedOrder(DB);
  DB.raw.prepare(`INSERT INTO payments
    (id,order_id,provider,provider_order_id,status,amount_cents,idempotency_key,created_at)
    VALUES ('p1',?,'PAYPAL','PAYPAL-DRAFT','CANCELLED',3059,'pay-key',?)`).run(order.id, order.now);
  DB.raw.prepare(`INSERT INTO order_versand
    (order_id,option_id,art,quelle,carrier,service_name,paket,preis_cents,created_at)
    VALUES (?,'pl-1','standard','ersatz','DPD','Classic','S',559,?)`).run(order.id, order.now);

  const detail = await call(DB, `/admin/orders/${order.id}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.data.deletion.allowed, true);

  const typo = await call(DB, `/admin/orders/${order.id}`, "DELETE", { orderNumber: "wrong" });
  assert.equal(typo.status, 400);
  assert.equal(DB.raw.prepare("SELECT COUNT(*) AS n FROM commerce_orders").get().n, 1);

  const deleted = await call(DB, `/admin/orders/${order.id}`, "DELETE", { orderNumber: order.number });
  assert.equal(deleted.status, 200);
  assert.equal(deleted.data.deleted, true);
  assert.equal(DB.raw.prepare("SELECT COUNT(*) AS n FROM commerce_orders").get().n, 0);
  assert.equal(DB.raw.prepare("SELECT COUNT(*) AS n FROM payments").get().n, 0);
  assert.equal(DB.raw.prepare("SELECT COUNT(*) AS n FROM order_versand").get().n, 0);
  assert.equal(DB.raw.prepare("SELECT status FROM inventory WHERE id=?").get(`i-${order.id}`).status, "AVAILABLE");
  assert.equal(DB.raw.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE event_type='UNPAID_TEST_ORDER_DELETED'").get().n, 1);
});

test("payment evidence permanently blocks order deletion", async () => {
  const DB = database();
  const order = seedOrder(DB);
  DB.raw.prepare(`INSERT INTO payments
    (id,order_id,provider,provider_order_id,provider_payment_id,status,amount_cents,idempotency_key,created_at)
    VALUES ('p1',?,'PAYPAL','PAYPAL-ORDER','PAYPAL-CAPTURE','COMPLETED',3059,'pay-key',?)`).run(order.id, order.now);

  const detail = await call(DB, `/admin/orders/${order.id}`);
  assert.equal(detail.data.deletion.allowed, false);
  assert.ok(detail.data.deletion.blockers.includes("PAYMENT_EVIDENCE"));
  const denied = await call(DB, `/admin/orders/${order.id}`, "DELETE", { orderNumber: order.number });
  assert.equal(denied.status, 409);
  assert.equal(denied.data.error, "ORDER_DELETE_BLOCKED");
  assert.equal(DB.raw.prepare("SELECT COUNT(*) AS n FROM commerce_orders").get().n, 1);
});

test("shipping contact can be corrected before dispatch and changes are audited without values", async () => {
  const DB = database();
  const order = seedOrder(DB, { status: "PREPARING" });
  const updated = await call(DB, `/admin/orders/${order.id}/contact`, "PATCH", {
    email: "neu@example.test",
    recipientName: "Neu Name",
    addressLine1: "Neue Str. 2",
    addressLine2: "Hinterhaus",
    postalCode: "60311",
    city: "Frankfurt",
    region: "Hessen",
    countryCode: "de",
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.data.contact.email, "neu@example.test");
  assert.equal(updated.data.contact.country_code, "DE");
  assert.equal(updated.data.order.guest_email, "neu@example.test");
  const audit = DB.raw.prepare("SELECT metadata_json FROM audit_events WHERE event_type='ORDER_CONTACT_UPDATED'").get();
  assert.ok(audit.metadata_json.includes("recipientName"));
  assert.ok(!audit.metadata_json.includes("Neu Name"));

  DB.raw.prepare("UPDATE commerce_orders SET status='SHIPPED' WHERE id=?").run(order.id);
  const locked = await call(DB, `/admin/orders/${order.id}/contact`, "PATCH", {
    email: "x@example.test", recipientName: "X", addressLine1: "X 1", postalCode: "1", city: "X", countryCode: "DE",
  });
  assert.equal(locked.status, 409);
  assert.equal(locked.data.error, "ORDER_ADDRESS_LOCKED");
});

test("admin preflight advertises DELETE for owner operations", async () => {
  const DB = database();
  const url = "https://api.disorder119.com/admin/orders/o1";
  const request = new Request(url, { method: "OPTIONS", headers: { Origin: ADMIN } });
  const response = await handleAdminRequest(request, { DB, ADMIN_TOKEN: "t" }, new URL(url), "req-options", ADMIN);
  assert.equal(response.status, 204);
  assert.match(response.headers.get("Access-Control-Allow-Methods") || "", /DELETE/);
});

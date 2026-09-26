import assert from "node:assert/strict";
import test from "node:test";
import { handleAdminRequest } from "./admin-api.js";
import { allMigrations, sqliteD1 } from "./test-d1.mjs";

const ADMIN = "https://admin.disorder119.com";

function seed() {
  const DB = sqliteD1(allMigrations());
  const now = new Date().toISOString();
  const run = (sql, ...args) => DB.raw.prepare(sql).run(...args);
  const orders = [["o1", "D119-1", "PAID", 6241], ["o2", "D119-2", "PREPARING", 6242], ["o3", "D119-3", "SHIPPED", 6243]];
  for (const [id, number, status, itemId] of orders) {
    run(`INSERT INTO inventory (id,item_id,status,sale_price_cents,updated_at) VALUES (?,?,?,9000,?)`, `i-${id}`, itemId, status, now);
    run(`INSERT INTO commerce_orders (id,order_number,status,subtotal_cents,shipping_cents,total_cents,idempotency_key,created_at)
      VALUES (?,?,?,9000,590,9590,?,?)`, id, number, status, `k-${id}`, now);
    run(`INSERT INTO order_items (id,order_id,inventory_id,item_id,title_snapshot,unit_price_cents) VALUES (?,?,?,?,?,9000)`,
      `oi-${id}`, id, `i-${id}`, itemId, `Stück ${itemId}`);
  }
  run(`INSERT INTO order_contact_snapshots (order_id,source_provider,given_name,surname,city,captured_at)
    VALUES ('o1','PAYPAL','Maria','Muster','Aschaffenburg',?)`, now);
  run(`INSERT INTO order_contact_snapshots (order_id,source_provider,recipient_name,city,captured_at)
    VALUES ('o2','PAYPAL','Lena Beispiel','Berlin',?)`, now);
  return DB;
}

async function list(DB, status) {
  const url = `https://api.disorder119.com/admin/orders${status ? `?status=${status}` : ""}`;
  const req = new Request(url, { headers: { Authorization: "Bearer t", Origin: ADMIN } });
  const res = await handleAdminRequest(req, { DB, ADMIN_TOKEN: "t" }, new URL(url), "req", ADMIN);
  return { status: res.status, data: await res.json() };
}

test("the order list carries item ids and the customer's name for the admin app", async () => {
  const DB = seed();
  const offen = await list(DB, "PAID,PREPARING");
  assert.equal(offen.status, 200);
  assert.deepEqual(
    offen.data.orders.map(o => [o.order_number, o.itemIds, o.customerName, o.customerCity]).sort(),
    [["D119-1", "6241", "Maria Muster", "Aschaffenburg"], ["D119-2", "6242", "Lena Beispiel", "Berlin"]],
  );
  assert.equal(offen.data.total, 2);
  assert.equal((await list(DB, "SHIPPED")).data.total, 1);
  assert.equal((await list(DB)).data.total, 3);
  const bad = await list(DB, "PAID,HACKED");
  assert.equal(bad.status, 400);
});

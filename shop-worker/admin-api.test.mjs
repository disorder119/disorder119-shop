import test from "node:test";
import assert from "node:assert/strict";

import {
  clampAdminLimit,
  clampAdminOffset,
  clampAnalyticsDays,
  orderNextStatuses,
  ORDER_COMPLETED_SQL,
  rentalNextStatuses,
} from "./admin-api.js";
import { allMigrations, sqliteD1 } from "./test-d1.mjs";

test("Abgeschlossen erst nach Zustellung und ohne offene Rückgabe", () => {
  const DB = sqliteD1(allMigrations());
  const run = (sql, ...args) => DB.raw.prepare(sql).run(...args);
  const old = new Date(Date.now() - 16 * 86_400_000).toISOString();
  const recent = new Date(Date.now() - 14 * 86_400_000).toISOString();
  run(`INSERT INTO commerce_orders (id,order_number,status,currency,subtotal_cents,shipping_cents,total_cents,idempotency_key,created_at)
    VALUES ('o1','D119-TEST-1','DELIVERED','EUR',1000,0,1000,'completion-test',?)`, old);
  run(`INSERT INTO shipments (id,order_id,status,delivered_at,created_at,updated_at)
    VALUES ('s1','o1','DELIVERED',?,?,?)`, recent, old, old);
  const complete = () => DB.raw.prepare(`SELECT CASE WHEN ${ORDER_COMPLETED_SQL} THEN 1 ELSE 0 END AS yes FROM commerce_orders o WHERE o.id='o1'`).get().yes;
  assert.equal(complete(), 0);
  run("UPDATE shipments SET delivered_at=? WHERE id='s1'", old);
  assert.equal(complete(), 1);
  run("INSERT INTO returns (id,order_id,status,created_at) VALUES ('r1','o1','REQUESTED',?)", old);
  assert.equal(complete(), 0);
  run("UPDATE returns SET status='CLOSED' WHERE id='r1'");
  assert.equal(complete(), 1);
  run(`INSERT INTO widerrufe (id,order_id,name,email,umfang,sprache,quelle,eingegangen_at,status,created_at)
    VALUES ('w1','o1','Test','test@example.com','GANZ','de','ADMIN',?,'EINGEGANGEN',?)`, old, old);
  assert.equal(complete(), 0);
  run("UPDATE widerrufe SET status='ERLEDIGT' WHERE id='w1'");
  assert.equal(complete(), 1);
});

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
  assert.deepEqual(orderNextStatuses("PAYMENT_PENDING"), ["CANCELLED"]);
  assert.deepEqual(orderNextStatuses("PAID").sort(), ["PREPARING", "REFUNDED"].sort());
  // Bezahlt -> Storniert direkt nur ohne gebundenes Geld (Einziehen gescheitert,
  // Reservierung aufgehoben); sonst ueber "Stornieren".
  assert.deepEqual(orderNextStatuses("PAID", { ohneZahlung: true }).sort(), ["CANCELLED", "PREPARING", "REFUNDED"].sort());
  assert.deepEqual(orderNextStatuses("PREPARING").sort(), ["REFUNDED", "SHIPPED"].sort());
  assert.deepEqual(orderNextStatuses("SHIPPED").sort(), ["DELIVERED", "RETURN_REQUESTED"].sort());
  assert.deepEqual(orderNextStatuses("CANCELLED"), []);
});

test("rental next statuses use the same commerce state machine", () => {
  assert.deepEqual(rentalNextStatuses("RESERVED").sort(), ["PAYMENT_PENDING", "CONFIRMED", "CANCELLED"].sort());
  assert.deepEqual(rentalNextStatuses("CONFIRMED").sort(), ["ACTIVE", "CANCELLED", "REFUNDED"].sort());
  assert.deepEqual(rentalNextStatuses("RETURN_DUE"), ["RETURNED"]);
  assert.deepEqual(rentalNextStatuses("CANCELLED"), []);
});

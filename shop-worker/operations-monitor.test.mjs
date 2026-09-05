import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  OPERATIONS_AUTOMATION_VERSION,
  buildAutomationKey,
  normalizeAutomationCandidate,
  rankAutomationCandidates,
  syncOperationsAlerts,
} from "./operations-monitor.js";

const HERE = dirname(fileURLToPath(import.meta.url));

class D1StatementAdapter {
  constructor(database, sql, params = []) {
    this.database = database;
    this.sql = sql;
    this.params = params;
  }

  bind(...params) {
    return new D1StatementAdapter(this.database, this.sql, params);
  }

  async all() {
    return { results: this.database.prepare(this.sql).all(...this.params) };
  }

  async first() {
    return this.database.prepare(this.sql).get(...this.params) || null;
  }

  async run() {
    const result = this.database.prepare(this.sql).run(...this.params);
    return { success: true, meta: { changes: Number(result.changes || 0) } };
  }

  async batchResult() {
    return /^\s*(SELECT|PRAGMA|WITH)\b/i.test(this.sql) ? this.all() : this.run();
  }
}

class D1Adapter {
  constructor(database) {
    this.database = database;
  }

  prepare(sql) {
    return new D1StatementAdapter(this.database, sql);
  }

  async batch(statements) {
    const results = [];
    this.database.exec("BEGIN");
    try {
      for (const statement of statements) results.push(await statement.batchResult());
      this.database.exec("COMMIT");
      return results;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}

function migratedDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  const files = [
    "schema.sql",
    "migrations/0002_commerce_foundation.sql",
    "migrations/0003_state_integrity.sql",
    "migrations/0004_admin_operations.sql",
    "migrations/0005_rental_groups.sql",
    "migrations/0006_operations_cases.sql",
    "migrations/0007_operations_automation.sql",
  ];
  for (const relative of files) database.exec(readFileSync(join(HERE, relative), "utf8"));
  return database;
}

function seedOperationalAlerts(database) {
  database.exec(`
    INSERT INTO inventory
      (id,item_id,article_no,status,sale_price_cents,currency,catalog_status,version,updated_at)
    VALUES
      ('inv-rental',910001,'AUTO-R','AVAILABLE',20000,'EUR','AVAILABLE',1,'2026-08-30T08:00:00Z'),
      ('inv-order',910002,'AUTO-O','AVAILABLE',15000,'EUR','AVAILABLE',1,'2026-08-30T08:00:00Z');

    INSERT INTO rental_reservations
      (id,inventory_id,start_date,end_date,days,daily_price_cents,total_price_cents,currency,price_on_request,status,
       idempotency_key,deposit_cents,created_at,updated_at)
    VALUES
      ('rr-auto','inv-rental','2026-08-31','2026-09-01',2,2000,4000,'EUR',0,'RESERVED',
       'auto-rental-key',10000,'2026-08-30T08:00:00Z','2026-08-30T08:00:00Z');

    UPDATE rental_reservations SET status='CONFIRMED',updated_at='2026-08-30T09:00:00Z' WHERE id='rr-auto';
    UPDATE rental_reservations SET status='ACTIVE',updated_at='2026-08-31T08:00:00Z' WHERE id='rr-auto';

    INSERT INTO commerce_orders
      (id,order_number,status,currency,subtotal_cents,shipping_cents,total_cents,idempotency_key,created_at,updated_at)
    VALUES
      ('order-auto','D119-AUTO-1','PAYMENT_PENDING','EUR',15000,0,15000,'auto-order-key','2026-09-01T08:00:00Z','2026-09-01T08:00:00Z');

    INSERT INTO payments
      (id,order_id,provider,status,amount_cents,currency,idempotency_key,created_at,updated_at)
    VALUES
      ('payment-auto','order-auto','PAYPAL','FAILED',15000,'EUR','auto-payment-key','2026-09-01T08:00:00Z','2026-09-01T08:30:00Z');

    INSERT INTO shipments
      (id,order_id,carrier,status,created_at,updated_at)
    VALUES
      ('shipment-auto','order-auto','DHL','EXCEPTION','2026-09-02T08:00:00Z','2026-09-03T08:00:00Z');

    INSERT INTO payment_events
      (id,provider,provider_event_id,event_type,payment_id,verified,received_at,processed_at,payload_hash)
    VALUES
      ('event-auto','PAYPAL','provider-event-auto','PAYMENT.CAPTURE.COMPLETED','payment-auto',1,
       '2026-09-05T10:00:00Z',NULL,'hash');
  `);

  const rentalId = database.prepare("SELECT id FROM rentals WHERE rental_reservation_id='rr-auto'").get().id;
  database.prepare(`INSERT INTO returns
      (id,rental_id,status,reason_code,created_at,updated_at)
    VALUES ('return-auto',?,'REQUESTED','FIT','2026-09-04T08:00:00Z','2026-09-04T08:00:00Z')`).run(rentalId);
  database.prepare(`INSERT INTO damage_cases
      (id,rental_id,severity,status,description,estimated_amount_cents,created_at,updated_at)
    VALUES ('damage-auto',?,'MAJOR','OPEN','Testschaden',5000,'2026-09-04T09:00:00Z','2026-09-04T09:00:00Z')`).run(rentalId);
  database.prepare(`INSERT INTO refunds
      (id,rental_id,amount_cents,currency,status,idempotency_key,created_at,updated_at)
    VALUES ('refund-auto',?,2500,'EUR','FAILED','auto-refund-key','2026-09-04T10:00:00Z','2026-09-04T10:00:00Z')`).run(rentalId);
}

test("automation keys are deterministic and source scoped", () => {
  assert.equal(
    buildAutomationKey("refund_failed", "refund-123"),
    `${OPERATIONS_AUTOMATION_VERSION}:REFUND_FAILED:refund-123`,
  );
  assert.equal(buildAutomationKey("", "refund-123"), "");
  assert.equal(buildAutomationKey("refund_failed", ""), "");
});

test("automation candidates reject invalid task metadata", () => {
  assert.equal(normalizeAutomationCandidate(null), null);
  assert.equal(normalizeAutomationCandidate({ kind: "X", entityType: "UNKNOWN", entityId: "1", title: "x", priority: "HIGH" }), null);
  assert.equal(normalizeAutomationCandidate({ kind: "X", entityType: "SYSTEM", entityId: "1", title: "", priority: "HIGH" }), null);
  assert.equal(normalizeAutomationCandidate({ kind: "X", entityType: "SYSTEM", entityId: "1", title: "x", priority: "INVALID" }), null);
});

test("automation candidates are normalized and ranked by urgency then due date", () => {
  const normal = normalizeAutomationCandidate({
    kind: "return_action_required",
    entityType: "return",
    entityId: "return-1",
    title: "Rückgabe prüfen",
    priority: "normal",
  });
  const urgentLater = normalizeAutomationCandidate({
    kind: "shipment_exception",
    entityType: "shipment",
    entityId: "shipment-2",
    title: "Versandproblem",
    priority: "urgent",
    dueAt: "2026-09-10T12:00:00.000Z",
  });
  const urgentEarlier = normalizeAutomationCandidate({
    kind: "payment_event_unprocessed",
    entityType: "system",
    entityId: "event-3",
    sourceId: "provider-event-3",
    title: "Payment-Event prüfen",
    priority: "urgent",
    dueAt: "2026-09-09T12:00:00.000Z",
  });

  assert.ok(normal);
  assert.ok(urgentLater);
  assert.ok(urgentEarlier);
  const ranked = rankAutomationCandidates([normal, urgentLater, urgentEarlier]);
  assert.deepEqual(ranked.map(row => row.entityId), ["event-3", "shipment-2", "return-1"]);
  assert.match(urgentEarlier.automationKey, /provider-event-3$/);
});

test("operations monitor materializes, deduplicates, clears and reopens alerts", async () => {
  const database = migratedDatabase();
  seedOperationalAlerts(database);
  const env = { DB: new D1Adapter(database) };
  const now = "2026-09-05T12:00:00.000Z";

  const first = await syncOperationsAlerts(env, { now, requestId: "test-1", source: "TEST" });
  assert.equal(first.ready, true);
  assert.equal(first.truncated, false);
  assert.equal(first.activeAlerts, 7);
  assert.equal(first.counts.openAutoTasks, 7);
  assert.equal(database.prepare("SELECT COUNT(*) AS value FROM operations_tasks WHERE auto_managed=1").get().value, 7);

  const second = await syncOperationsAlerts(env, { now: "2026-09-05T12:05:00.000Z", requestId: "test-2", source: "TEST" });
  assert.equal(second.activeAlerts, 7);
  assert.equal(database.prepare("SELECT COUNT(*) AS value FROM operations_tasks WHERE auto_managed=1").get().value, 7);
  assert.equal(database.prepare("SELECT MAX(occurrence_count) AS value FROM operations_tasks WHERE auto_managed=1").get().value, 1);

  const refundKey = `${OPERATIONS_AUTOMATION_VERSION}:REFUND_FAILED:refund-auto`;
  database.prepare("UPDATE operations_tasks SET status='DISMISSED' WHERE automation_key=?").run(refundKey);
  await syncOperationsAlerts(env, { now: "2026-09-05T12:10:00.000Z", requestId: "test-3", source: "TEST" });
  let refundTask = database.prepare("SELECT status,automation_active,occurrence_count FROM operations_tasks WHERE automation_key=?").get(refundKey);
  assert.deepEqual({ ...refundTask }, { status: "DISMISSED", automation_active: 1, occurrence_count: 1 });

  database.prepare("UPDATE refunds SET status='COMPLETED',updated_at='2026-09-05T12:11:00Z' WHERE id='refund-auto'").run();
  await syncOperationsAlerts(env, { now: "2026-09-05T12:15:00.000Z", requestId: "test-4", source: "TEST" });
  refundTask = database.prepare("SELECT status,automation_active,occurrence_count FROM operations_tasks WHERE automation_key=?").get(refundKey);
  assert.deepEqual({ ...refundTask }, { status: "DISMISSED", automation_active: 0, occurrence_count: 1 });

  database.prepare("UPDATE refunds SET status='FAILED',updated_at='2026-09-05T12:16:00Z' WHERE id='refund-auto'").run();
  await syncOperationsAlerts(env, { now: "2026-09-05T12:20:00.000Z", requestId: "test-5", source: "TEST" });
  refundTask = database.prepare("SELECT status,automation_active,occurrence_count FROM operations_tasks WHERE automation_key=?").get(refundKey);
  assert.deepEqual({ ...refundTask }, { status: "OPEN", automation_active: 1, occurrence_count: 2 });

  assert.equal(
    database.prepare("SELECT COUNT(*) AS value FROM audit_events WHERE event_type='OPERATIONS_AUTOMATION_SYNC'").get().value,
    5,
  );
  database.close();
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  OPERATIONS_AUTOMATION_VERSION,
  buildAutomationKey,
  normalizeAutomationCandidate,
  rankAutomationCandidates,
} from "./operations-monitor.js";

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

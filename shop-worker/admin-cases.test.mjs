import assert from "node:assert/strict";
import {
  normalizeNonNegativeCents,
  returnNextStatuses,
  damageNextStatuses,
} from "./admin-cases.js";

assert.deepEqual(returnNextStatuses("REQUESTED"), ["AUTHORIZED", "REJECTED"]);
assert.deepEqual(returnNextStatuses("IN_TRANSIT"), ["RECEIVED"]);
assert.deepEqual(returnNextStatuses("CLOSED"), []);
assert.deepEqual(returnNextStatuses("unknown"), []);

assert.deepEqual(damageNextStatuses("OPEN"), ["REVIEW", "RESOLVED", "WAIVED"]);
assert.deepEqual(damageNextStatuses("REVIEW"), ["OPEN", "RESOLVED", "WAIVED"]);
assert.deepEqual(damageNextStatuses("RESOLVED"), []);

assert.equal(normalizeNonNegativeCents(0), 0);
assert.equal(normalizeNonNegativeCents("5000"), 5000);
assert.equal(normalizeNonNegativeCents(null), null);
assert.equal(normalizeNonNegativeCents(""), null);
assert.equal(normalizeNonNegativeCents(-1), undefined);
assert.equal(normalizeNonNegativeCents(12.5), undefined);
assert.equal(normalizeNonNegativeCents("abc"), undefined);

console.log("Admin cases helpers: OK");

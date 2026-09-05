import assert from "node:assert/strict";
import { SYSTEM_SCHEMA_TARGET, detectSchemaVersion } from "./admin-system.js";

assert.equal(SYSTEM_SCHEMA_TARGET, "0006_operations_cases");
assert.equal(detectSchemaVersion([]), "schema_base_or_unknown");
assert.equal(
  detectSchemaVersion(["commerce_orders", "rental_reservations"]),
  "0002_commerce_foundation"
);
assert.equal(
  detectSchemaVersion(["commerce_orders", "rental_reservations", "payment_events", "audit_events"]),
  "0003_state_integrity"
);
assert.equal(
  detectSchemaVersion(["admin_notes", "order_contact_snapshots"]),
  "0004_admin_operations"
);
assert.equal(
  detectSchemaVersion(["admin_notes", "order_contact_snapshots", "rental_groups"]),
  "0005_rental_groups"
);
assert.equal(
  detectSchemaVersion(["rental_groups", "damage_cases", "operations_tasks"]),
  "0006_operations_cases"
);

console.log("Admin system schema detection: OK");

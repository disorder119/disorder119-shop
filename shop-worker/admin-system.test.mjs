import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SYSTEM_SCHEMA_TARGET, detectSchemaVersion } from "./admin-system.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const workerEntry = fs.readFileSync(path.join(here, "worker-entry.js"), "utf8");

const automationColumns = [
  "automation_key",
  "automation_kind",
  "auto_managed",
  "automation_active",
  "first_seen_at",
  "last_seen_at",
  "occurrence_count",
];

const backendHardeningTriggers = [
  "trg_rental_duration_insert",
  "trg_rental_duration_update",
  "trg_rental_group_duration_insert",
  "trg_rental_group_duration_update",
];

assert.equal(SYSTEM_SCHEMA_TARGET, "0008_backend_hardening");
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
assert.equal(
  detectSchemaVersion(
    ["rental_groups", "damage_cases", "operations_tasks"],
    automationColumns,
  ),
  "0007_operations_automation"
);
assert.equal(
  detectSchemaVersion(
    ["rental_groups", "damage_cases", "operations_tasks"],
    automationColumns,
    backendHardeningTriggers,
  ),
  "0008_backend_hardening"
);
assert.equal(
  detectSchemaVersion(
    ["rental_groups", "damage_cases", "operations_tasks"],
    automationColumns,
    backendHardeningTriggers.slice(0, 3),
  ),
  "0007_operations_automation"
);
assert.equal(
  detectSchemaVersion(
    ["rental_groups", "damage_cases", "operations_tasks"],
    ["automation_key", "auto_managed", "automation_active"],
  ),
  "0006_operations_cases"
);

assert.match(workerEntry, /const ADMIN_REQUEST_ORIGINS = new Set/);
assert.match(workerEntry, /https:\/\/admin\.disorder119\.com/);
assert.match(workerEntry, /function assertAdminOrigin\(request\)/);
assert.match(workerEntry, /ADMIN_ORIGIN_FORBIDDEN/);
assert.match(workerEntry, /assertAdminOrigin\(request\);/);

console.log("Admin system schema/origin boundary: OK");

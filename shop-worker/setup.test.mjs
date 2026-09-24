import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  MIGRATION_MARKERS,
  currentD1Binding,
  migrationsToBaseline,
  setTomlWorkerName,
  tomlWorkerName,
  updateShopConfig,
  upsertD1Block,
} from "./setup.mjs";

const BASE_TOML = `name = "disorder119-shop-worker"
main = "worker-entry.js"

[triggers]
crons = ["*/30 * * * *"]
`;

test("setup writes the D1 binding once and replaces it on a second run", () => {
  const first = upsertD1Block(BASE_TOML, "11111111-2222-3333-4444-555555555555");
  assert.match(first, /\[\[d1_databases\]\]\nbinding = "DB"\ndatabase_name = "disorder119-shop"\ndatabase_id = "11111111-2222-3333-4444-555555555555"\nmigrations_dir = "migrations"\n$/);
  assert.match(first, /\[triggers\]\ncrons = \["\*\/30 \* \* \* \*"\]/, "existing sections stay intact");

  const second = upsertD1Block(first, "99999999-8888-7777-6666-555555555555");
  assert.equal((second.match(/\[\[d1_databases\]\]/g) || []).length, 1);
  assert.match(second, /database_id = "99999999-8888-7777-6666-555555555555"/);
  assert.equal(second.includes("11111111-2222"), false);
});

test("setup replaces a D1 block that sits before another section", () => {
  const middle = `name = "x"\n\n[[d1_databases]]\nbinding = "DB"\ndatabase_id = "old"\n\n[observability]\nenabled = true\n`;
  const out = upsertD1Block(middle, "new-id");
  assert.match(out, /database_id = "new-id"/);
  assert.match(out, /\[observability\]\nenabled = true/);
  assert.equal(out.includes('"old"'), false);
});

test("setup only fills public values into shop-config and keeps checkout off", () => {
  const config = JSON.stringify({
    email: "bestellung@disorder119.com",
    shippingFlatCents: 590,
    paypalClientId: "",
    shopWorkerUrl: "",
    environment: "sandbox",
    features: { paypalCheckout: false, customerAccounts: false },
  }, null, 2);
  const out = JSON.parse(updateShopConfig(config, {
    shopWorkerUrl: "https://disorder119-shop-worker.example.workers.dev",
    paypalClientId: "AbcDefGhiJklMnoPqrStuVwxYz0123456789",
    turnstileSiteKey: "0x4AAAAAAAtest",
  }));
  assert.equal(out.shopWorkerUrl, "https://disorder119-shop-worker.example.workers.dev");
  assert.equal(out.paypalClientId, "AbcDefGhiJklMnoPqrStuVwxYz0123456789");
  assert.equal(out.turnstileSiteKey, "0x4AAAAAAAtest");
  assert.equal(out.features.paypalCheckout, false);
  assert.deepEqual(Object.keys(out).slice(0, 5), ["email", "shippingFlatCents", "paypalClientId", "shopWorkerUrl", "turnstileSiteKey"]);
});

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_FILES = fs.readdirSync(path.join(HERE, "migrations")).filter(f => /^\d{4}_.*\.sql$/.test(f)).sort();

test("every migration has a marker object that the file really creates", () => {
  for (const file of MIGRATION_FILES) {
    const marker = MIGRATION_MARKERS[file];
    assert.ok(marker, `${file} braucht einen Eintrag in MIGRATION_MARKERS`);
    const sql = fs.readFileSync(path.join(HERE, "migrations", file), "utf8");
    assert.match(sql, new RegExp(`CREATE (TABLE|TRIGGER|UNIQUE INDEX|INDEX) IF NOT EXISTS ${marker}\\b`), `${file} legt ${marker} nicht an`);
  }
});

test("setup records manually applied migrations and leaves managed or new databases alone", () => {
  // Fresh database: nothing to record, wrangler applies everything.
  assert.deepEqual(migrationsToBaseline([], MIGRATION_FILES), []);
  // Already managed by wrangler: never touch its bookkeeping.
  assert.deepEqual(migrationsToBaseline(["d1_migrations", "commerce_orders"], MIGRATION_FILES), []);
  // Hand-made database with 0002-0005 applied: exactly those are recorded.
  const handMade = ["commerce_orders", "trg_order_status_transition", "order_contact_snapshots", "rental_groups", "inventory"];
  assert.deepEqual(migrationsToBaseline(handMade, MIGRATION_FILES), [
    "0002_commerce_foundation.sql", "0003_state_integrity.sql", "0004_admin_operations.sql", "0005_rental_groups.sql",
  ]);
  // Unsafe file names are never inlined into SQL.
  assert.deepEqual(migrationsToBaseline(["commerce_orders"], ["0002_commerce_foundation.sql", "0099_x'; DROP TABLE a;--.sql"]), [
    "0002_commerce_foundation.sql",
  ]);
});

test("setup reads the bound database and can point wrangler.toml at the running worker", () => {
  const toml = `name = "disorder119-shop-worker"\nmain = "worker-entry.js"\n\n[[d1_databases]]\nbinding = "DB"\ndatabase_name = "shop-db"\ndatabase_id = "abc-123"\n`;
  assert.deepEqual(currentD1Binding(toml), { name: "shop-db", id: "abc-123" });
  assert.equal(currentD1Binding('name = "x"\n'), null);
  assert.equal(tomlWorkerName(toml), "disorder119-shop-worker");
  const renamed = setTomlWorkerName(toml, "disorder119-api");
  assert.equal(tomlWorkerName(renamed), "disorder119-api");
  assert.match(renamed, /main = "worker-entry.js"/);
  assert.match(renamed, /database_name = "shop-db"/, "only the top-level worker name changes");
});

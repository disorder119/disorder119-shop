import assert from "node:assert/strict";
import test from "node:test";
import { updateShopConfig, upsertD1Block } from "./setup.mjs";

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

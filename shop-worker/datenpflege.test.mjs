import test from "node:test";
import assert from "node:assert/strict";
import { allMigrations, sqliteD1 } from "./test-d1.mjs";
import { datenPflegen } from "./datenpflege.js";

const JETZT = Date.parse("2026-10-28T12:00:00Z");
const TAG = 86_400_000;
const iso = ms => new Date(ms).toISOString();

function db() {
  const d = sqliteD1(allMigrations());
  const r = d.raw;
  r.prepare("INSERT INTO customers (id, email_normalized, created_at) VALUES ('k1','a@example.com',?)").run(iso(JETZT - 100 * TAG));
  r.prepare(`INSERT INTO admin_passkeys (id, name, rp_id, public_key_jwk, algorithm, created_at) VALUES ('p1','Laptop','admin.disorder119.com','{}',-7,?)`).run(iso(JETZT - 100 * TAG));
  const nl = (id, status, requested, extra = {}) => r.prepare(`INSERT INTO newsletter_subscribers
      (id, email_normalized, email_canonical, status, consent_text, consent_version, requested_at, confirm_expires_at, confirmed_at, coupon_id, updated_at)
      VALUES (?,?,?,?, 'Text', 'v1', ?, ?, ?, ?, ?)`)
    .run(id, `${id}@example.com`, `${id}@example.com`, status, iso(requested), iso(requested + 2 * TAG), extra.confirmed ?? null, extra.coupon ?? null, iso(requested));
  nl("alt-offen", "PENDING", JETZT - 31 * TAG);
  nl("neu-offen", "PENDING", JETZT - 5 * TAG);
  nl("alt-bestaetigt", "CONFIRMED", JETZT - 90 * TAG, { confirmed: iso(JETZT - 89 * TAG) });
  nl("alt-abgemeldet", "UNSUBSCRIBED", JETZT - 90 * TAG);
  r.prepare("INSERT INTO customer_login_tokens (id, email_normalized, created_at, expires_at) VALUES ('t-alt','a@example.com',?,?)").run(iso(JETZT - 3 * TAG), iso(JETZT - 3 * TAG + 1800_000));
  r.prepare("INSERT INTO customer_login_tokens (id, email_normalized, created_at, expires_at) VALUES ('t-gestern','a@example.com',?,?)").run(iso(JETZT - TAG), iso(JETZT - TAG + 1800_000));
  r.prepare("INSERT INTO customer_login_tokens (id, email_normalized, created_at, expires_at) VALUES ('t-neu','a@example.com',?,?)").run(iso(JETZT - 60_000), iso(JETZT + 1800_000));
  const idem = (key, ablauf) => r.prepare("INSERT INTO idempotency_keys (scope, idempotency_key, created_at, expires_at) VALUES ('create-order',?,?,?)").run(key, iso(ablauf - TAG), iso(ablauf));
  idem("i-alt", JETZT - 2 * TAG);
  idem("i-knapp", JETZT - 3_600_000);
  idem("i-gueltig", JETZT + TAG);
  const sitzung = (tabelle, fremd, id, ablauf, revoked = null) => r.prepare(`INSERT INTO ${tabelle} (id, ${fremd}, created_at, expires_at, revoked_at) VALUES (?,?,?,?,?)`)
    .run(id, tabelle === "admin_sessions" ? "p1" : "k1", iso(ablauf - TAG), iso(ablauf), revoked);
  sitzung("admin_sessions", "passkey_id", "a-alt", JETZT - 2 * TAG);
  sitzung("admin_sessions", "passkey_id", "a-gueltig", JETZT + TAG);
  sitzung("admin_sessions", "passkey_id", "a-abgemeldet", JETZT + TAG, iso(JETZT - 2 * TAG));
  sitzung("customer_sessions", "customer_id", "c-alt", JETZT - 2 * TAG);
  sitzung("customer_sessions", "customer_id", "c-gueltig", JETZT + 10 * TAG);
  return d;
}

const ids = (d, tabelle, spalte = "id") => d.raw.prepare(`SELECT ${spalte} AS id FROM ${tabelle} ORDER BY ${spalte}`).all().map(z => z.id);

test("Cron loescht nur, was abgelaufen ist", async () => {
  const d = db();
  const ergebnis = await datenPflegen({ DB: d }, JETZT);
  assert.deepEqual(ergebnis, { newsletter_pending: 1, customer_login_tokens: 1, idempotency_keys: 1, admin_sessions: 2, customer_sessions: 1 });
  assert.deepEqual(ids(d, "newsletter_subscribers"), ["alt-abgemeldet", "alt-bestaetigt", "neu-offen"]);
  assert.deepEqual(ids(d, "customer_login_tokens"), ["t-gestern", "t-neu"], "Links der letzten zwei Tage zaehlen noch fuer die Grenzen");
  assert.deepEqual(ids(d, "idempotency_keys", "idempotency_key"), ["i-gueltig", "i-knapp"], "erst einen Tag nach Ablauf");
  assert.deepEqual(ids(d, "admin_sessions"), ["a-gueltig"]);
  assert.deepEqual(ids(d, "customer_sessions"), ["c-gueltig"]);
  // Zweiter Lauf: nichts mehr zu tun.
  assert.deepEqual(Object.values(await datenPflegen({ DB: d }, JETZT)), [0, 0, 0, 0, 0]);
});

test("Anmeldung mit Rabattcode bleibt, fehlende Tabellen stoeren nicht", async () => {
  const d = db();
  d.raw.prepare(`INSERT INTO reward_coupons (id, code_hash, status, discount_bps, created_at) VALUES ('rc1','h','ACTIVE',1000,?)`).run(iso(JETZT));
  d.raw.prepare("UPDATE newsletter_subscribers SET coupon_id='rc1' WHERE id='alt-offen'").run();
  await datenPflegen({ DB: d }, JETZT);
  assert.ok(ids(d, "newsletter_subscribers").includes("alt-offen"));
  const kaputt = { prepare: () => ({ bind: () => ({ run: async () => { throw new Error("no such table: newsletter_subscribers"); } }) }) };
  const ergebnis = await datenPflegen({ DB: kaputt }, JETZT);
  assert.equal(ergebnis.newsletter_pending, null);
  assert.deepEqual(await datenPflegen({}, JETZT), {});
});

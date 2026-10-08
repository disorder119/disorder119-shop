import assert from "node:assert/strict";
import test from "node:test";
import { APPLE_PAY_DOMAIN, applePayDomainSicherstellen } from "./paypal-einrichtung.js";
import { paypalErstattungenAbgleichen } from "./admin-api.js";
import { allMigrations, sqliteD1 } from "./test-d1.mjs";

// Nachbau der PayPal-API: Token, Wallet-Domains und Webhook. Keine echten Aufrufe.
function fakePaypal({ domains = [], registrieren = { status: 201, body: { provider_type: "APPLE_PAY", domain: { name: APPLE_PAY_DOMAIN } } }, eventTypes = [{ name: "PAYMENT.CAPTURE.COMPLETED" }] } = {}) {
  const aufrufe = [];
  const original = globalThis.fetch;
  const zustand = { domains: [...domains], eventTypes: [...eventTypes] };
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input?.url || input));
    const method = init.method || "GET";
    let body = null;
    try { body = init.body ? JSON.parse(init.body) : null; } catch { body = String(init.body); }
    aufrufe.push({ method, path: url.pathname, search: url.searchParams, body });
    if (url.pathname === "/v1/oauth2/token") return Response.json({ access_token: "tok" });
    if (url.pathname === "/v1/customer/wallet-domains" && method === "GET") {
      return Response.json({ wallet_domains: zustand.domains.map(name => ({ provider_type: "APPLE_PAY", domain: { name } })) });
    }
    if (url.pathname === "/v1/customer/wallet-domains" && method === "POST") {
      if (registrieren.status < 300) zustand.domains.push(APPLE_PAY_DOMAIN);
      return Response.json(registrieren.body, { status: registrieren.status });
    }
    if (url.pathname === "/v1/notifications/webhooks/WH-1") {
      if (method === "PATCH") zustand.eventTypes = JSON.parse(init.body)[0].value;
      return Response.json({ id: "WH-1", event_types: zustand.eventTypes });
    }
    if (url.pathname === "/v1/notifications/webhooks-events") return Response.json({ events: [], links: [] });
    throw new Error(`unerwartet: ${method} ${url}`);
  };
  return { aufrufe, zustand, restore() { globalThis.fetch = original; } };
}

const LIVE = DB => ({ DB, PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: "sec", PAYPAL_ENVIRONMENT: "live", PAYPAL_WEBHOOK_ID: "WH-1" });
const protokoll = DB => DB.raw.prepare("SELECT event_type,metadata_json FROM audit_events WHERE entity_type='paypal' ORDER BY created_at").all()
  .map(r => [r.event_type, JSON.parse(r.metadata_json)]);

test("the Apple Pay domain is registered once, only live and only with PayPal access", async () => {
  const DB = sqliteD1(allMigrations());
  const pp = fakePaypal();
  try {
    assert.deepEqual(await applePayDomainSicherstellen({ ...LIVE(DB), PAYPAL_ENVIRONMENT: "sandbox" }), { uebersprungen: "NOT_LIVE" });
    assert.deepEqual(await applePayDomainSicherstellen({ DB, PAYPAL_ENVIRONMENT: "live" }), { uebersprungen: "PAYPAL_NOT_CONFIGURED" });
    assert.equal(pp.aufrufe.length, 0);

    const erst = await applePayDomainSicherstellen(LIVE(DB));
    assert.deepEqual(erst, { ok: true, bereits: false });
    const post = pp.aufrufe.find(a => a.method === "POST" && a.path === "/v1/customer/wallet-domains");
    assert.deepEqual(post.body, { provider_type: "APPLE_PAY", domain: { name: "disorder119.com" } });
    assert.deepEqual(protokoll(DB).map(([typ]) => typ), ["PAYPAL_APPLE_PAY_DOMAIN_REGISTERED"]);

    const zahl = pp.aufrufe.length;
    assert.deepEqual(await applePayDomainSicherstellen(LIVE(DB)), { ok: true, bereits: true });
    assert.equal(pp.aufrufe.length, zahl, "nach dem Erfolg fragt der Server PayPal nie wieder");
  } finally {
    pp.restore();
  }
});

test("a domain already registered in the dashboard is simply recorded", async () => {
  const DB = sqliteD1(allMigrations());
  const pp = fakePaypal({ domains: ["disorder119.com"] });
  try {
    assert.deepEqual(await applePayDomainSicherstellen(LIVE(DB)), { ok: true, bereits: true });
    assert.equal(pp.aufrufe.filter(a => a.method === "POST" && a.path === "/v1/customer/wallet-domains").length, 0);
  } finally {
    pp.restore();
  }
});

test("a refusal is logged and retried at most once a day; 'already registered' counts as success", async () => {
  const DB = sqliteD1(allMigrations());
  const pp = fakePaypal({ registrieren: { status: 403, body: { name: "NOT_AUTHORIZED", details: [{ issue: "PERMISSION_DENIED" }], debug_id: "dbg-1" } } });
  const jetzt = Date.now();
  try {
    const fehler = await applePayDomainSicherstellen(LIVE(DB), jetzt);
    assert.equal(fehler.ok, false);
    assert.equal(fehler.grund, "PERMISSION_DENIED");
    const [[typ, meta]] = protokoll(DB);
    assert.equal(typ, "PAYPAL_APPLE_PAY_DOMAIN_FAILED");
    assert.equal(meta.debugId, "dbg-1");
    assert.equal("PAYPAL_CLIENT_SECRET" in meta, false);

    const zahl = pp.aufrufe.length;
    assert.deepEqual(await applePayDomainSicherstellen(LIVE(DB), jetzt + 60 * 60 * 1000), { uebersprungen: "SPAETER_ERNEUT" });
    assert.equal(pp.aufrufe.length, zahl);
  } finally {
    pp.restore();
  }
  const pp2 = fakePaypal({ registrieren: { status: 422, body: { name: "UNPROCESSABLE_ENTITY", details: [{ issue: "DOMAIN_ALREADY_REGISTERED" }] } } });
  try {
    assert.deepEqual(await applePayDomainSicherstellen(LIVE(DB), jetzt + 25 * 60 * 60 * 1000), { ok: true, bereits: true });
    assert.equal(protokoll(DB).at(-1)[0], "PAYPAL_APPLE_PAY_DOMAIN_REGISTERED");
  } finally {
    pp2.restore();
  }
});

test("the refund sync adds the missing refund event to the PayPal webhook by itself", async () => {
  const DB = sqliteD1(allMigrations());
  const pp = fakePaypal();
  try {
    const sync = await paypalErstattungenAbgleichen(LIVE(DB), "cron-1", true);
    assert.equal(sync.ok, true);
    assert.equal(sync.webhookSubscribed, true);
    const patch = pp.aufrufe.find(a => a.method === "PATCH");
    assert.deepEqual(patch.body, [{ op: "replace", path: "/event_types",
      value: [{ name: "PAYMENT.CAPTURE.COMPLETED" }, { name: "PAYMENT.CAPTURE.REFUNDED" }] }]);
    const eintrag = DB.raw.prepare("SELECT event_type,actor_type,metadata_json FROM audit_events WHERE entity_type='paypal_webhook'").get();
    assert.equal(eintrag.event_type, "PAYPAL_WEBHOOK_REFUNDS_SUBSCRIBED");
    assert.equal(eintrag.actor_type, "SYSTEM");
    assert.equal(JSON.parse(eintrag.metadata_json).automatisch, true);

    // Beim naechsten Abgleich ist das Ereignis da - kein zweiter PATCH.
    await paypalErstattungenAbgleichen(LIVE(DB), "cron-2", true);
    assert.equal(pp.aufrufe.filter(a => a.method === "PATCH").length, 1);
  } finally {
    pp.restore();
  }
});

test("the refund event list asks PayPal for at most 29 days, in PayPal's time format", async () => {
  const DB = sqliteD1(allMigrations());
  const pp = fakePaypal({ eventTypes: [{ name: "PAYMENT.CAPTURE.COMPLETED" }, { name: "PAYMENT.CAPTURE.REFUNDED" }] });
  try {
    await paypalErstattungenAbgleichen(LIVE(DB), "cron-zeit", true);
    const liste = pp.aufrufe.find(a => a.path === "/v1/notifications/webhooks-events");
    const start = liste.search.get("start_time"), ende = liste.search.get("end_time");
    assert.match(start, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    assert.match(ende, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    const tage = (Date.parse(ende) - Date.parse(start)) / 86400000;
    assert.ok(tage <= 29.001 && tage >= 28.999, String(tage));
    assert.equal(liste.search.get("event_type"), "PAYMENT.CAPTURE.REFUNDED");
  } finally {
    pp.restore();
  }
});

test("after three refusals the server asks PayPal only once a week", async () => {
  const DB = sqliteD1(allMigrations());
  const pp = fakePaypal({ registrieren: { status: 403, body: { name: "NOT_AUTHORIZED", details: [{ issue: "INVALID_MERCHANT_INFO" }] } } });
  const jetzt = Date.now();
  const STUNDE = 60 * 60 * 1000;
  try {
    for (let tag = 0; tag < 3; tag++) assert.equal((await applePayDomainSicherstellen(LIVE(DB), jetzt + tag * 25 * STUNDE)).ok, false);
    assert.deepEqual(await applePayDomainSicherstellen(LIVE(DB), jetzt + 4 * 25 * STUNDE), { uebersprungen: "SPAETER_ERNEUT" });
    assert.equal((await applePayDomainSicherstellen(LIVE(DB), jetzt + 50 * STUNDE + 8 * 24 * STUNDE)).ok, false);
    const fehler = protokoll(DB).filter(([typ]) => typ === "PAYPAL_APPLE_PAY_DOMAIN_FAILED");
    assert.equal(fehler.length, 4);
    assert.equal(fehler[0][1].listeStatus, 200);
  } finally {
    pp.restore();
  }
});

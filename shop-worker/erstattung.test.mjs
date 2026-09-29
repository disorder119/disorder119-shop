import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { erstattungAusPaypal, handleAdminRequest } from "./admin-api.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ADMIN = "https://admin.disorder119.com";

function d1() {
  const raw = new DatabaseSync(":memory:");
  const files = [
    path.join(HERE, "schema.sql"),
    ...fs.readdirSync(path.join(HERE, "migrations")).filter(f => /^\d{4}_.*\.sql$/.test(f)).sort()
      .map(f => path.join(HERE, "migrations", f)),
  ];
  for (const file of files) raw.exec(fs.readFileSync(file, "utf8"));
  const arg = v => (v === undefined ? null : typeof v === "boolean" ? Number(v) : v);
  const statement = (sql, args = []) => ({
    sql,
    bind: (...next) => statement(sql, next.map(arg)),
    first: async () => { const row = raw.prepare(sql).get(...args); return row ? { ...row } : null; },
    all: async () => ({ results: raw.prepare(sql).all(...args).map(row => ({ ...row })) }),
    run: async () => ({ meta: { changes: Number(raw.prepare(sql).run(...args).changes) } }),
    runSync: () => ({ meta: { changes: Number(raw.prepare(sql).run(...args).changes) } }),
  });
  return {
    raw,
    prepare: sql => statement(sql),
    batch: async statements => {
      raw.exec("BEGIN");
      try { const out = []; for (const s of statements) out.push(/^\s*(SELECT|WITH|PRAGMA)\b/i.test(s.sql) ? await s.all() : await s.run()); raw.exec("COMMIT"); return out; }
      catch (err) { raw.exec("ROLLBACK"); throw err; }
    },
  };
}

function bestellungAnlegen(db, { status = "PAID", total = 786 } = {}) {
  const now = "2026-09-28T20:00:00.000Z";
  db.raw.prepare(`INSERT INTO inventory (id,item_id,article_no,status,sale_price_cents,currency,catalog_status,version,updated_at)
    VALUES ('inv_9999',9999,'TEST',?, 1,'EUR','AVAILABLE',1,?)`).run(status, now);
  db.raw.prepare(`INSERT INTO commerce_orders (id,order_number,status,currency,subtotal_cents,shipping_cents,total_cents,idempotency_key,created_at)
    VALUES ('o1','D119-20260928-AAAA',?,'EUR',1,785,?,'k1',?)`).run(status, total, now);
  db.raw.prepare(`INSERT INTO order_items (id,order_id,inventory_id,item_id,article_no,title_snapshot,unit_price_cents,quantity,currency)
    VALUES ('oi1','o1','inv_9999',9999,'TEST','Testartikel',1,1,'EUR')`).run();
  db.raw.prepare(`INSERT INTO payments (id,order_id,provider,provider_order_id,provider_payment_id,status,amount_cents,currency,idempotency_key,created_at)
    VALUES ('p1','o1','PAYPAL','PPORDER1','CAPTURE1','COMPLETED',?,'EUR','pk1',?)`).run(total, now);
}

function paypal({ antwort = { id: "REFUND1", status: "COMPLETED" }, fehler = null } = {}) {
  const aufrufe = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input?.url || input);
    if (url.endsWith("/v1/oauth2/token")) return new Response(JSON.stringify({ access_token: "tok" }), { status: 200 });
    if (/\/v2\/payments\/captures\/[^/]+\/refund$/.test(url)) {
      aufrufe.push({ url, headers: init.headers, body: JSON.parse(init.body) });
      if (fehler) return new Response(JSON.stringify(fehler.body), { status: fehler.status });
      return new Response(JSON.stringify(antwort), { status: 201 });
    }
    if (url.includes("catalog.json") || url.includes("api.github.com")) return new Response("[]", { status: 200 });
    throw new Error(`unerwarteter fetch: ${url}`);
  };
  return { aufrufe, zurueck: () => { globalThis.fetch = original; } };
}

function env(db) {
  return { DB: db, ADMIN_TOKEN: "geheim", PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: "sec", PAYPAL_ENVIRONMENT: "live" };
}

function erstatten(e, id = "o1") {
  const req = new Request(`https://api.disorder119.com/admin/orders/${id}/erstatten`, {
    method: "POST",
    headers: { Origin: ADMIN, Authorization: "Bearer geheim", "Content-Type": "application/json" },
    body: "{}",
  });
  return handleAdminRequest(req, e, new URL(req.url), "req-1", ADMIN);
}

test("Erstatten zahlt den ganzen Betrag ueber PayPal zurueck und setzt Erstattet", async () => {
  const db = d1();
  bestellungAnlegen(db);
  const pp = paypal();
  try {
    const res = await erstatten(env(db));
    const data = await res.json();
    assert.equal(res.status, 200, JSON.stringify(data));
    assert.equal(pp.aufrufe.length, 1);
    assert.match(pp.aufrufe[0].url, /^https:\/\/api-m\.paypal\.com\/v2\/payments\/captures\/CAPTURE1\/refund$/);
    assert.deepEqual(pp.aufrufe[0].body, {});
    assert.equal(pp.aufrufe[0].headers["PayPal-Request-Id"], "erstattung:o1:0");
    assert.equal(data.order.status, "REFUNDED");
    assert.equal(data.erstattung.betragCents, 786);
    assert.equal(db.raw.prepare("SELECT status FROM payments WHERE id='p1'").get().status, "REFUNDED");
    const r = db.raw.prepare("SELECT * FROM refunds").all();
    assert.equal(r.length, 1);
    assert.equal(r[0].status, "COMPLETED");
    assert.equal(r[0].provider_refund_id, "REFUND1");

    // Zweiter Klick: nichts mehr zu tun, kein zweiter PayPal-Aufruf.
    const nochmal = await erstatten(env(db));
    assert.equal(nochmal.status, 200);
    assert.equal(pp.aufrufe.length, 1);

    // Der Webhook von PayPal zur selben Erstattung legt nichts doppelt an.
    await erstattungAusPaypal(env(db), { event_type: "PAYMENT.CAPTURE.REFUNDED", resource: {
      id: "REFUND1", status: "COMPLETED", amount: { value: "7.86", currency_code: "EUR" },
      links: [{ href: "https://api-m.paypal.com/v2/payments/captures/CAPTURE1" }] } });
    assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM refunds").get().n, 1);
  } finally {
    pp.zurueck();
  }
});

test("Admin zeigt die belegte PayPal-Gebuehr getrennt vom Bruttobetrag", async () => {
  const db = d1();
  bestellungAnlegen(db, { total: 560 });
  db.raw.prepare(`INSERT INTO tax_cash_events
    (id,payment_id,order_id,kind,provider,provider_reference,amount_cents,currency,occurred_at,observed_at,evidence_hash,evidence_json)
    VALUES ('paypal:fee:CAPTURE1','p1','o1','fee','PAYPAL','CAPTURE1',56,'EUR',NULL,'2026-09-28T20:00:00Z','hash','{}')`).run();
  const pp = paypal();
  try {
    const req = new Request("https://api.disorder119.com/admin/orders/o1", {
      headers: { Origin: ADMIN, Authorization: "Bearer geheim" },
    });
    const res = await handleAdminRequest(req, env(db), new URL(req.url), "req-fee", ADMIN);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.payments[0].amount_cents, 560);
    assert.equal(data.payments[0].paypal_fee_cents, 56);
  } finally { pp.zurueck(); }
});

test("PayPal lehnt ab: Fehler sichtbar, erneuter Versuch mit derselben Request-Id", async () => {
  const db = d1();
  bestellungAnlegen(db);
  let pp = paypal({ fehler: { status: 422, body: { name: "UNPROCESSABLE_ENTITY", debug_id: "debug-123", details: [{ issue: "REFUND_TIME_LIMIT_EXCEEDED" }] } } });
  try {
    const res = await erstatten(env(db));
    const data = await res.json();
    assert.equal(res.status, 502);
    assert.equal(data.error, "PAYPAL_ERSTATTUNG_FEHLGESCHLAGEN");
    assert.equal(data.detail.grund, "REFUND_TIME_LIMIT_EXCEEDED");
    assert.equal(data.detail.debugId, "debug-123");
    assert.equal(data.detail.paypalStatus, 422);
    assert.equal(db.raw.prepare("SELECT status FROM commerce_orders").get().status, "PAID");
  } finally {
    pp.zurueck();
  }
  pp = paypal();
  try {
    const res = await erstatten(env(db));
    assert.equal(res.status, 200);
    assert.equal(pp.aufrufe[0].headers["PayPal-Request-Id"], "erstattung:o1:0");
    assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM refunds").get().n, 1);
    assert.equal(db.raw.prepare("SELECT status FROM commerce_orders").get().status, "REFUNDED");
  } finally {
    pp.zurueck();
  }
});

test("Zu wenig PayPal-Deckung liefert auch an alte Admin-Versionen einen klaren Fehlercode", async () => {
  const db = d1();
  bestellungAnlegen(db, { total: 560 });
  let pp = paypal({ fehler: { status: 422, body: { name: "UNPROCESSABLE_ENTITY",
    debug_id: "funding-debug", details: [{ issue: "REFUND_FAILED_INSUFFICIENT_FUNDS" }] } } });
  let ersterSchluessel;
  try {
    const res = await erstatten(env(db));
    const data = await res.json();
    assert.equal(res.status, 502);
    assert.equal(data.error, "PAYPAL_GUTHABEN_NICHT_AUSREICHEND");
    assert.equal(data.detail.grund, "REFUND_FAILED_INSUFFICIENT_FUNDS");
    assert.equal(data.detail.debugId, "funding-debug");
    assert.equal(db.raw.prepare("SELECT status FROM commerce_orders").get().status, "PAID");
    assert.equal(db.raw.prepare("SELECT status FROM refunds").get().status, "FAILED");
    ersterSchluessel = pp.aufrufe[0].headers["PayPal-Request-Id"];
  } finally { pp.zurueck(); }
  pp = paypal();
  try {
    const tooSoon = await erstatten(env(db));
    assert.equal(tooSoon.status, 409);
    assert.equal(pp.aufrufe.length, 0);
  } finally { pp.zurueck(); }
  // Erst nach einem neuen, explizit bestaetigten Admin-Aufruf und behobener
  // Deckung wird eine frische Id genutzt; die alte 422-Ablehnung wird nicht
  // als bereits erfolgreicher Versuch wiederholt.
  db.raw.prepare("UPDATE audit_events SET created_at='2026-09-01T00:00:00.000Z' WHERE event_type='ORDER_REFUND_FAILED'").run();
  pp = paypal();
  try {
    const res = await erstatten(env(db));
    assert.equal(res.status, 200);
    assert.notEqual(pp.aufrufe[0].headers["PayPal-Request-Id"], ersterSchluessel);
    assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM refunds").get().n, 1);
    assert.equal(db.raw.prepare("SELECT status FROM commerce_orders").get().status, "REFUNDED");
  } finally { pp.zurueck(); }
});

test("Zwei gleichzeitige Admin-Retries benutzen nach Deckungsfehler dieselbe neue PayPal-ID", async () => {
  const db = d1();
  bestellungAnlegen(db, { total: 560 });
  let pp = paypal({ fehler: { status: 422, body: { details: [{ issue: "REFUND_FAILED_INSUFFICIENT_FUNDS" }] } } });
  try { await erstatten(env(db)); } finally { pp.zurueck(); }
  db.raw.prepare("UPDATE audit_events SET created_at='2026-09-01T00:00:00.000Z' WHERE event_type='ORDER_REFUND_FAILED'").run();
  pp = paypal({ fehler: { status: 422, body: { details: [{ issue: "REFUND_FAILED_INSUFFICIENT_FUNDS" }] } } });
  try {
    await Promise.all([erstatten(env(db)), erstatten(env(db))]);
    assert.ok(pp.aufrufe.length >= 1 && pp.aufrufe.length <= 2);
    assert.equal(new Set(pp.aufrufe.map(x => x.headers["PayPal-Request-Id"])).size, 1);
    assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM refunds").get().n, 1);
  } finally { pp.zurueck(); }
});

test("Abweichender Capture-Betrag blockiert Erstattung vor dem PayPal-Aufruf", async () => {
  const db = d1();
  bestellungAnlegen(db);
  db.raw.prepare("UPDATE payments SET amount_cents=560 WHERE id='p1'").run();
  const pp = paypal();
  try {
    const res = await erstatten(env(db));
    const data = await res.json();
    assert.equal(res.status, 409);
    assert.equal(data.error, "ERSTATTUNG_BETRAG_ABWEICHUNG");
    assert.equal(pp.aufrufe.length, 0);
    assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM refunds").get().n, 0);
  } finally { pp.zurueck(); }
});

test("Gastkaeufer erscheinen im Kundenbereich und oeffnen ihre Bestellungen", async () => {
  const db = d1();
  bestellungAnlegen(db);
  db.raw.prepare("UPDATE commerce_orders SET guest_email='gast@example.test' WHERE id='o1'").run();
  db.raw.prepare(`INSERT INTO commerce_orders (id,order_number,status,currency,subtotal_cents,shipping_cents,total_cents,
    guest_email,idempotency_key,created_at) VALUES ('a2','D119-20260929-BBBB','PAID','EUR',100,0,100,
    'GAST@EXAMPLE.TEST','k2','2026-09-29T10:00:00.000Z')`).run();
  const e = env(db);
  const headers = { Origin: ADMIN, Authorization: "Bearer geheim" };
  const listRequest = new Request("https://api.disorder119.com/admin/customers", { headers });
  const listResponse = await handleAdminRequest(listRequest, e, new URL(listRequest.url), "req-1", ADMIN);
  assert.equal(listResponse.status, 200);
  const list = await listResponse.json();
  assert.equal(list.total, 1);
  assert.equal(list.customers[0].status, "GUEST");
  assert.equal(list.customers[0].id, "guest-order:o1");
  assert.equal(list.customers[0].orderCount, 2);
  const detailRequest = new Request("https://api.disorder119.com/admin/customers/guest-order%3Ao1", { headers });
  const detailResponse = await handleAdminRequest(detailRequest, e, new URL(detailRequest.url), "req-2", ADMIN);
  assert.equal(detailResponse.status, 200);
  const detail = await detailResponse.json();
  assert.equal(detail.orders.length, 2);
  assert.equal(detail.orders[0].order_number, "D119-20260929-BBBB");
});

test("Verschickte Bestellung: erst Ruecksendung, keine Auszahlung", async () => {
  const db = d1();
  bestellungAnlegen(db, { status: "SHIPPED" });
  const pp = paypal();
  try {
    const res = await erstatten(env(db));
    const data = await res.json();
    assert.equal(res.status, 409);
    assert.equal(data.error, "ERSTATTUNG_STATUS");
    assert.equal(pp.aufrufe.length, 0);
  } finally {
    pp.zurueck();
  }
});

test("Ohne Anmeldung keine Erstattung", async () => {
  const db = d1();
  bestellungAnlegen(db);
  const pp = paypal();
  try {
    const req = new Request("https://api.disorder119.com/admin/orders/o1/erstatten", { method: "POST", headers: { Origin: ADMIN }, body: "{}" });
    const res = await handleAdminRequest(req, env(db), new URL(req.url), "r", ADMIN);
    assert.equal(res.status, 401);
    assert.equal(pp.aufrufe.length, 0);
  } finally {
    pp.zurueck();
  }
});

test("Erstattung direkt in PayPal: Webhook traegt sie ein und setzt Erstattet", async () => {
  const db = d1();
  bestellungAnlegen(db);
  const pp = paypal();
  try {
    await erstattungAusPaypal(env(db), { event_type: "PAYMENT.CAPTURE.REFUNDED", resource: {
      id: "REFUND9", status: "COMPLETED", amount: { value: "7.86", currency_code: "EUR" },
      supplementary_data: { related_ids: { capture_id: "CAPTURE1" } } } }, "wh");
    assert.equal(db.raw.prepare("SELECT status FROM commerce_orders").get().status, "REFUNDED");
    assert.equal(db.raw.prepare("SELECT status FROM payments").get().status, "REFUNDED");
    assert.equal(db.raw.prepare("SELECT provider_refund_id FROM refunds").get().provider_refund_id, "REFUND9");
    // Teil-Erstattung: Bestellung bleibt, Zahlung "teilweise erstattet".
    const db2 = d1();
    bestellungAnlegen(db2);
    await erstattungAusPaypal(env(db2), { event_type: "PAYMENT.CAPTURE.REFUNDED", resource: {
      id: "REFUND10", status: "COMPLETED", amount: { value: "1.00", currency_code: "EUR" },
      supplementary_data: { related_ids: { capture_id: "CAPTURE1" } } } }, "wh");
    assert.equal(db2.raw.prepare("SELECT status FROM commerce_orders").get().status, "PAID");
    assert.equal(db2.raw.prepare("SELECT status FROM payments").get().status, "PARTIALLY_REFUNDED");
    await erstatten(env(db2));
    assert.deepEqual(pp.aufrufe.at(-1).body.amount, { value: "6.86", currency_code: "EUR" });
  } finally {
    pp.zurueck();
  }
});

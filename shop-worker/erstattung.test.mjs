import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { erstattungAusPaypal, handleAdminRequest, paypalErstattungenAbgleichen } from "./admin-api.js";

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
    // Die Request-Id gehoert zum Erstattungsauftrag.
    assert.equal(pp.aufrufe[0].headers["PayPal-Request-Id"], `auftrag:${data.auftrag.id}`);
    assert.equal(data.auftrag.status, "ERLEDIGT");
    assert.equal(data.auftrag.anlass, "STORNO");
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

test("PayPal lehnt endgueltig ab: Auftrag braucht Hilfe, neuer Klick versucht es mit neuer Request-Id", async () => {
  const db = d1();
  bestellungAnlegen(db);
  let pp = paypal({ fehler: { status: 422, body: { name: "UNPROCESSABLE_ENTITY", debug_id: "debug-123", details: [{ issue: "REFUND_TIME_LIMIT_EXCEEDED" }] } } });
  let ersterSchluessel;
  try {
    const res = await erstatten(env(db));
    const data = await res.json();
    assert.equal(res.status, 200, JSON.stringify(data));
    assert.equal(data.auftrag.status, "FEHLER");
    assert.equal(data.auftrag.fehler, "REFUND_TIME_LIMIT_EXCEEDED");
    assert.equal(data.auftrag.fehlerEndgueltig, true);
    assert.match(data.auftrag.hinweis, /180 Tage/);
    assert.equal(data.order.status, "PAID");
    const protokoll = JSON.parse(db.raw.prepare("SELECT metadata_json FROM audit_events WHERE event_type='ORDER_REFUND_FAILED'").get().metadata_json);
    assert.equal(protokoll.debugId, "debug-123");
    assert.equal(protokoll.paypalStatus, 422);
    ersterSchluessel = pp.aufrufe[0].headers["PayPal-Request-Id"];
  } finally {
    pp.zurueck();
  }
  // Der Cron fasst einen endgueltig gescheiterten Auftrag nicht an ...
  pp = paypal();
  try {
    const { ruecklaufPflegen } = await import("./admin-api.js");
    await ruecklaufPflegen(env(db), "cron-1", new Date(Date.now() + 3 * 60 * 60 * 1000));
    assert.equal(pp.aufrufe.length, 0);
    // ... ein erneuter Klick schon: neue Request-Id (PayPal hat sicher nichts gezahlt).
    const res = await erstatten(env(db));
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.notEqual(pp.aufrufe[0].headers["PayPal-Request-Id"], ersterSchluessel);
    assert.equal(data.auftrag.status, "ERLEDIGT");
    assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM refunds").get().n, 1);
    assert.equal(db.raw.prepare("SELECT status FROM commerce_orders").get().status, "REFUNDED");
  } finally {
    pp.zurueck();
  }
});

test("PayPal-Stoerung: derselbe Schluessel beim naechsten Versuch, nie doppelt ausgezahlt", async () => {
  const db = d1();
  bestellungAnlegen(db);
  let pp = paypal({ fehler: { status: 503, body: { name: "SERVICE_UNAVAILABLE" } } });
  let ersterSchluessel;
  try {
    const data = await (await erstatten(env(db))).json();
    assert.equal(data.auftrag.status, "FEHLER");
    assert.equal(data.auftrag.fehlerEndgueltig, false);
    assert.ok(data.auftrag.naechsterVersuchAt);
    ersterSchluessel = pp.aufrufe[0].headers["PayPal-Request-Id"];
    // Unklarer Ausgang: die Zeile bleibt offen.
    assert.equal(db.raw.prepare("SELECT status FROM refunds").get().status, "PENDING");
  } finally { pp.zurueck(); }
  pp = paypal();
  try {
    const { ruecklaufPflegen } = await import("./admin-api.js");
    const lauf = await ruecklaufPflegen(env(db), "cron-2", new Date(Date.now() + 20 * 60 * 1000));
    assert.equal(lauf.erstattungen.ausgefuehrt, 1);
    assert.equal(pp.aufrufe[0].headers["PayPal-Request-Id"], ersterSchluessel);
    assert.equal(db.raw.prepare("SELECT status FROM commerce_orders").get().status, "REFUNDED");
    assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM refunds").get().n, 1);
  } finally { pp.zurueck(); }
});

test("Zu wenig PayPal-Deckung: Auftrag wartet, Cron versucht es erneut und schliesst ab", async () => {
  const db = d1();
  bestellungAnlegen(db, { total: 560 });
  let pp = paypal({ fehler: { status: 422, body: { name: "UNPROCESSABLE_ENTITY",
    debug_id: "funding-debug", details: [{ issue: "REFUND_FAILED_INSUFFICIENT_FUNDS" }] } } });
  let ersterSchluessel;
  try {
    const res = await erstatten(env(db));
    const data = await res.json();
    assert.equal(res.status, 200, JSON.stringify(data));
    assert.equal(data.auftrag.status, "WARTET_AUF_DECKUNG");
    assert.equal(data.auftrag.fehler, "REFUND_FAILED_INSUFFICIENT_FUNDS");
    assert.match(data.auftrag.hinweis, /5,60/);
    assert.equal(data.erstattung.ausstehend, true);
    assert.equal(data.storno.moeglich, false);
    assert.equal(data.order.status, "PAID");
    assert.equal(db.raw.prepare("SELECT status FROM refunds").get().status, "FAILED");
    ersterSchluessel = pp.aufrufe[0].headers["PayPal-Request-Id"];
  } finally { pp.zurueck(); }
  // Vor dem naechsten geplanten Versuch passiert nichts.
  pp = paypal({ fehler: { status: 422, body: { details: [{ issue: "REFUND_FAILED_INSUFFICIENT_FUNDS" }] } } });
  const { ruecklaufPflegen } = await import("./admin-api.js");
  try {
    await ruecklaufPflegen(env(db), "cron-a", new Date(Date.now() + 5 * 60 * 1000));
    assert.equal(pp.aufrufe.length, 0);
    // Nach 15 Minuten: erneuter Versuch mit neuer Request-Id, wieder zu wenig.
    await ruecklaufPflegen(env(db), "cron-b", new Date(Date.now() + 16 * 60 * 1000));
    assert.equal(pp.aufrufe.length, 1);
    assert.notEqual(pp.aufrufe[0].headers["PayPal-Request-Id"], ersterSchluessel);
    assert.equal(db.raw.prepare("SELECT status FROM erstattungsauftraege").get().status, "WARTET_AUF_DECKUNG");
  } finally { pp.zurueck(); }
  // Guthaben aufgeladen: der naechste Lauf zahlt aus und schliesst ab.
  pp = paypal();
  try {
    await ruecklaufPflegen(env(db), "cron-c", new Date(Date.now() + 40 * 60 * 1000));
    assert.equal(pp.aufrufe.length, 1);
    const auftrag = db.raw.prepare("SELECT * FROM erstattungsauftraege").get();
    assert.equal(auftrag.status, "ERLEDIGT");
    assert.equal(auftrag.versuche, 3);
    assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM refunds").get().n, 1);
    assert.equal(db.raw.prepare("SELECT status FROM refunds").get().status, "COMPLETED");
    assert.equal(db.raw.prepare("SELECT status FROM commerce_orders").get().status, "REFUNDED");
  } finally { pp.zurueck(); }
});

test("Zwei gleichzeitige Klicks nach Deckungsfehler: ein Lauf, eine Request-Id, eine Zeile", async () => {
  const db = d1();
  bestellungAnlegen(db, { total: 560 });
  let pp = paypal({ fehler: { status: 422, body: { details: [{ issue: "REFUND_FAILED_INSUFFICIENT_FUNDS" }] } } });
  try { await erstatten(env(db)); } finally { pp.zurueck(); }
  pp = paypal({ fehler: { status: 422, body: { details: [{ issue: "REFUND_FAILED_INSUFFICIENT_FUNDS" }] } } });
  try {
    await Promise.all([erstatten(env(db)), erstatten(env(db))]);
    assert.ok(pp.aufrufe.length >= 1 && pp.aufrufe.length <= 2);
    assert.equal(new Set(pp.aufrufe.map(x => x.headers["PayPal-Request-Id"])).size, pp.aufrufe.length);
    assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM refunds").get().n, 1);
    assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM erstattungsauftraege").get().n, 1);
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

test("PayPal-Abgleich holt eine im PayPal-Konto gestartete Erstattung paginiert und idempotent nach", async () => {
  const db = d1();
  bestellungAnlegen(db);
  const original = globalThis.fetch;
  const aufrufe = [];
  const testEnv = { ...env(db), PAYPAL_WEBHOOK_ID: "WH-TEST" };
  const event = {
    id: "WH-REFUND-1",
    event_type: "PAYMENT.CAPTURE.REFUNDED",
    resource: {
      id: "REFUND-DIREKT-1",
      status: "COMPLETED",
      amount: { value: "7.86", currency_code: "EUR" },
      create_time: "2026-09-29T18:00:00.000Z",
      supplementary_data: { related_ids: { capture_id: "CAPTURE1" } },
    },
  };
  globalThis.fetch = async input => {
    const url = String(input?.url || input);
    if (url.endsWith("/v1/oauth2/token")) return new Response(JSON.stringify({ access_token: "tok" }), { status: 200 });
    if (url.endsWith("/v1/notifications/webhooks/WH-TEST")) {
      return new Response(JSON.stringify({ event_types: [{ name: "PAYMENT.CAPTURE.REFUNDED" }] }), { status: 200 });
    }
    aufrufe.push(url);
    if (url.includes("page=2")) return new Response(JSON.stringify({ events: [], links: [] }), { status: 200 });
    return new Response(JSON.stringify({
      events: [event],
      links: [{ rel: "next", href: "https://api-m.paypal.com/v1/notifications/webhooks-events?page=2" }],
    }), { status: 200 });
  };
  try {
    const result = await paypalErstattungenAbgleichen(testEnv, "sync-1", true);
    assert.equal(result.ok, true);
    assert.equal(result.pages, 2);
    assert.equal(result.seen, 1);
    assert.equal(result.matched, 1);
    assert.equal(result.updated, 1);
    assert.equal(result.webhookSubscribed, true);
    assert.equal(db.raw.prepare("SELECT status FROM commerce_orders").get().status, "REFUNDED");
    assert.equal(db.raw.prepare("SELECT status FROM payments").get().status, "REFUNDED");
    assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM refunds").get().n, 1);
    assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM tax_cash_events WHERE kind='refund'").get().n, 1);
    assert.equal(aufrufe.length, 2);

    const nochmal = await paypalErstattungenAbgleichen(testEnv, "sync-2", true);
    assert.equal(nochmal.ok, true);
    assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM refunds").get().n, 1);
    assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM tax_cash_events WHERE kind='refund'").get().n, 1);
  } finally {
    globalThis.fetch = original;
  }
});

test("PayPal-Abgleichfehler blockiert die Bestellliste nicht und wird sichtbar gemeldet", async () => {
  const db = d1();
  bestellungAnlegen(db);
  const original = globalThis.fetch;
  globalThis.fetch = async input => {
    const url = String(input?.url || input);
    if (url.endsWith("/v1/oauth2/token")) return new Response(JSON.stringify({ access_token: "tok" }), { status: 200 });
    if (url.includes("/v1/notifications/webhooks-events")) {
      return new Response(JSON.stringify({ name: "SERVICE_UNAVAILABLE", debug_id: "paypal-debug" }), { status: 503 });
    }
    if (url.includes("catalog.json") || url.includes("api.github.com")) return new Response("[]", { status: 200 });
    throw new Error(`unerwarteter fetch: ${url}`);
  };
  try {
    const req = new Request("https://api.disorder119.com/admin/orders", {
      headers: { Origin: ADMIN, Authorization: "Bearer geheim" },
    });
    const res = await handleAdminRequest(req, env(db), new URL(req.url), "sync-fail", ADMIN);
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.orders.length, 1);
    assert.equal(data.paypalRefundSync.ok, false);
    assert.equal(data.paypalRefundSync.code, "PAYPAL_REFUND_EVENT_LIST_FAILED");
  } finally {
    globalThis.fetch = original;
  }
});

test("Knopf in der Admin-App abonniert Rueckzahlungen am PayPal-Webhook, ohne andere Ereignisse zu verlieren", async () => {
  const db = d1();
  bestellungAnlegen(db);
  const original = globalThis.fetch;
  let typen = [{ name: "PAYMENT.CAPTURE.COMPLETED" }];
  const patches = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input?.url || input);
    if (url.endsWith("/v1/oauth2/token")) return new Response(JSON.stringify({ access_token: "tok" }), { status: 200 });
    if (url.endsWith("/v1/notifications/webhooks/WH-TEST")) {
      if (init.method === "PATCH") {
        const body = JSON.parse(init.body);
        patches.push(body);
        typen = body[0].value;
        return new Response(JSON.stringify({ id: "WH-TEST", event_types: typen }), { status: 200 });
      }
      return new Response(JSON.stringify({ id: "WH-TEST", event_types: typen }), { status: 200 });
    }
    if (url.includes("/v1/notifications/webhooks-events")) return new Response(JSON.stringify({ events: [], links: [] }), { status: 200 });
    throw new Error(`unerwarteter fetch: ${url}`);
  };
  const abonnieren = async () => {
    const req = new Request("https://api.disorder119.com/admin/paypal/webhook/erstattungen", {
      method: "POST", headers: { Origin: ADMIN, Authorization: "Bearer geheim", "Content-Type": "application/json" }, body: "{}",
    });
    const res = await handleAdminRequest(req, { ...env(db), PAYPAL_WEBHOOK_ID: "WH-TEST" }, new URL(req.url), "req-wh", ADMIN);
    return { status: res.status, data: await res.json() };
  };
  try {
    const erst = await abonnieren();
    assert.equal(erst.status, 200, JSON.stringify(erst.data));
    assert.equal(erst.data.bereits, false);
    assert.deepEqual(patches, [[{ op: "replace", path: "/event_types",
      value: [{ name: "PAYMENT.CAPTURE.COMPLETED" }, { name: "PAYMENT.CAPTURE.REFUNDED" }] }]]);
    assert.equal(erst.data.paypalRefundSync.webhookSubscribed, true);
    assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE event_type='PAYPAL_WEBHOOK_REFUNDS_SUBSCRIBED'").get().n, 1);

    const zweit = await abonnieren();
    assert.equal(zweit.data.bereits, true);
    assert.equal(patches.length, 1);
  } finally {
    globalThis.fetch = original;
  }
});

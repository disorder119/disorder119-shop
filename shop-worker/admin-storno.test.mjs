import assert from "node:assert/strict";
import test from "node:test";

import { handleAdminRequest } from "./admin-api.js";
import { allMigrations, sqliteD1 } from "./test-d1.mjs";

// Stornieren aus der Admin-App: unbezahlt -> "Storniert"; bezahlt und noch
// nicht versendet -> Geld ueber PayPal zurueck, "Erstattet", Stueck wieder im
// Shop (Katalog ueber einen Pull Request, Lager verfuegbar).

const ADMIN = "https://admin.disorder119.com";
const MAIN = "a".repeat(40);
const TREE = "b".repeat(40);
const ITEMS = [
  { id: 9999, title: "Testartikel", brand: "Test", price: 1, public_status: "SOLD", status: "Verkauft" },
  { id: 1234, title: "Anderes Stück", brand: "Test", price: 20, public_status: "AVAILABLE", status: "Verfügbar" },
];

function seed(DB, { status = "PAID", total = 786, capture = true } = {}) {
  const now = "2026-09-30T08:00:00.000Z";
  const run = (sql, ...args) => DB.raw.prepare(sql).run(...args);
  run(`INSERT INTO inventory (id,item_id,article_no,status,sale_price_cents,currency,catalog_status,version,updated_at)
    VALUES ('inv_9999',9999,'TEST',?,1,'EUR','SOLD',1,?)`, status === "PAYMENT_PENDING" ? "PAYMENT_PENDING" : status, now);
  run(`INSERT INTO commerce_orders (id,order_number,status,currency,subtotal_cents,shipping_cents,total_cents,idempotency_key,created_at)
    VALUES ('o1','D119-20260930-TEST',?,'EUR',1,785,?,'k1',?)`, status, total, now);
  run(`INSERT INTO order_items (id,order_id,inventory_id,item_id,article_no,title_snapshot,unit_price_cents,quantity,currency)
    VALUES ('oi1','o1','inv_9999',9999,'TEST','Testartikel',1,1,'EUR')`);
  if (capture) {
    run(`INSERT INTO payments (id,order_id,provider,provider_order_id,provider_payment_id,status,amount_cents,currency,idempotency_key,created_at)
      VALUES ('p1','o1','PAYPAL','PPORDER1','CAPTURE1','COMPLETED',?,'EUR','pk1',?)`, total, now);
  } else {
    run(`INSERT INTO payments (id,order_id,provider,provider_order_id,status,amount_cents,currency,idempotency_key,created_at)
      VALUES ('p1','o1','PAYPAL','PPORDER1','CREATED',?,'EUR','pk1',?)`, total, now);
  }
}

// PayPal (Token + Erstattung) und GitHub (Katalog-Commit ueber Pull Request).
function fakeNetz({ erstattung = { status: 201, body: { id: "REFUND1", status: "COMPLETED" } } } = {}) {
  const paypal = [];
  const github = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input?.url || input));
    const method = init.method || "GET";
    let body = null;
    try { body = init.body ? JSON.parse(init.body) : null; } catch { body = String(init.body); }
    if (url.hostname.endsWith("paypal.com")) {
      if (url.pathname === "/v1/oauth2/token") return Response.json({ access_token: "tok" });
      if (/^\/v2\/payments\/captures\/[^/]+\/refund$/.test(url.pathname)) {
        paypal.push({ path: url.pathname, headers: init.headers, body });
        return Response.json(erstattung.body, { status: erstattung.status });
      }
      throw new Error(`unerwartet: ${url}`);
    }
    if (url.hostname === "api.github.com") {
      const path = url.pathname.replace("/repos/disorder119/disorder119-shop", "");
      github.push({ method, path, body });
      if (method === "GET" && path === "/git/ref/heads/main") return Response.json({ object: { sha: MAIN } });
      if (method === "GET" && path === `/git/commits/${MAIN}`) return Response.json({ tree: { sha: TREE } });
      if (method === "GET" && path === "/contents/data") return Response.json([{ name: "items.json", type: "file", sha: "items-sha" }]);
      if (method === "GET" && path === "/git/blobs/items-sha") return new Response(JSON.stringify(ITEMS, null, 2) + "\n");
      if (method === "POST" && path === "/git/blobs") return Response.json({ sha: "blob-1" });
      if (method === "POST" && path === "/git/trees") return Response.json({ sha: "d".repeat(40) });
      if (method === "POST" && path === "/git/commits") return Response.json({ sha: "e".repeat(40) });
      if (method === "POST" && path === "/git/refs") return Response.json({ ref: body.ref }, { status: 201 });
      if (method === "POST" && path === "/pulls") return Response.json({ number: 321, html_url: "https://github.com/disorder119/disorder119-shop/pull/321" }, { status: 201 });
      if (method === "PUT" && path === "/pulls/321/merge") return Response.json({ sha: "f".repeat(40), merged: true });
      if (method === "DELETE") return new Response(null, { status: 204 });
      return new Response(`unerwartet: ${method} ${path}`, { status: 404 });
    }
    throw new Error(`unerwarteter fetch: ${url}`);
  };
  return { paypal, github, restore() { globalThis.fetch = original; } };
}

const ENV = DB => ({
  DB, ADMIN_TOKEN: "t", GITHUB_TOKEN: "gh",
  PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: "sec", PAYPAL_ENVIRONMENT: "live",
});

async function call(DB, path, method = "GET", body, env = ENV(DB)) {
  const url = `https://api.disorder119.com${path}`;
  const headers = { Authorization: "Bearer t", Origin: ADMIN };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const request = new Request(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const response = await handleAdminRequest(request, env, new URL(url), "req-storno", ADMIN);
  return { status: response.status, data: await response.json() };
}

const lager = DB => DB.raw.prepare("SELECT status FROM inventory WHERE id='inv_9999'").get().status;
const bestellung = DB => DB.raw.prepare("SELECT status FROM commerce_orders WHERE id='o1'").get().status;

test("an unpaid order is simply cancelled - no money moves", async () => {
  const DB = sqliteD1(allMigrations());
  seed(DB, { status: "PAYMENT_PENDING", capture: false });
  const netz = fakeNetz();
  try {
    const detail = await call(DB, "/admin/orders/o1");
    assert.deepEqual(detail.data.storno, { moeglich: true, art: "STORNIEREN" });
    const res = await call(DB, "/admin/orders/o1/stornieren", "POST", {});
    assert.equal(res.status, 200, JSON.stringify(res.data));
    assert.equal(res.data.storniert.art, "STORNIERT");
    assert.equal(bestellung(DB), "CANCELLED");
    assert.equal(netz.paypal.length, 0);
    assert.equal(netz.github.length, 0);
    // Danach laesst sich die unbezahlte Testbestellung loeschen.
    assert.equal(res.data.deletion.allowed, true);
  } finally {
    netz.restore();
  }
});

test("a paid order is refunded in full, marked refunded and its piece goes back on sale", async () => {
  const DB = sqliteD1(allMigrations());
  seed(DB);
  const netz = fakeNetz();
  try {
    const detail = await call(DB, "/admin/orders/o1");
    assert.deepEqual(detail.data.storno, { moeglich: true, art: "ERSTATTEN" });
    assert.equal(detail.data.items[0].inventory_status, "PAID");

    const res = await call(DB, "/admin/orders/o1/stornieren", "POST", { wiederVerfuegbar: true });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    assert.equal(netz.paypal.length, 1);
    assert.equal(netz.paypal[0].path, "/v2/payments/captures/CAPTURE1/refund");
    // Ganze Capture: leerer Koerper, keine neue Geldsendung.
    assert.deepEqual(netz.paypal[0].body, {});
    assert.equal(bestellung(DB), "REFUNDED");
    assert.equal(lager(DB), "AVAILABLE");

    // Katalog: genau dieses Stueck zurueck auf verfuegbar, ueber einen Pull Request.
    const blob = netz.github.find(c => c.method === "POST" && c.path === "/git/blobs");
    const items = JSON.parse(blob.body.content);
    assert.equal(items.find(it => it.id === 9999).public_status, "AVAILABLE");
    assert.equal(items.find(it => it.id === 9999).status, "Verfügbar");
    assert.deepEqual(items.find(it => it.id === 1234), ITEMS[1]);
    const pr = netz.github.find(c => c.method === "POST" && c.path === "/pulls");
    assert.match(pr.body.title, /^Admin: Storno D119-20260930-TEST – Artikel 9999 wieder verfügbar$/);
    assert.ok(netz.github.some(c => c.method === "PUT" && c.path === "/pulls/321/merge"));

    assert.equal(res.data.storniert.art, "ERSTATTET");
    assert.equal(res.data.storniert.wiederVerfuegbar.ok, true);
    assert.equal(res.data.storniert.wiederVerfuegbar.pullRequest, 321);
    assert.equal(res.data.wiederVerfuegbar.moeglich, false);
    assert.ok(res.data.wiederVerfuegbar.erledigtAm);
    assert.equal(res.data.storno.moeglich, false);
    const events = DB.raw.prepare("SELECT event_type FROM audit_events WHERE entity_id='o1'").all().map(r => r.event_type);
    assert.ok(events.includes("ORDER_REFUND_SENT"));
    assert.ok(events.includes("ORDER_ITEMS_RELISTED"));
    // Bezahlt bleibt Beleg: nicht loeschbar.
    assert.equal(res.data.deletion.allowed, false);
  } finally {
    netz.restore();
  }
});

test("refund without relisting keeps the piece off the shop until asked", async () => {
  const DB = sqliteD1(allMigrations());
  seed(DB);
  const netz = fakeNetz();
  try {
    const res = await call(DB, "/admin/orders/o1/stornieren", "POST", { wiederVerfuegbar: false });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    assert.equal(bestellung(DB), "REFUNDED");
    assert.equal(lager(DB), "REFUNDED");
    assert.equal(netz.github.length, 0);
    assert.equal(res.data.wiederVerfuegbar.moeglich, true);

    const spaeter = await call(DB, "/admin/orders/o1/wieder-verfuegbar", "POST", {});
    assert.equal(spaeter.status, 200, JSON.stringify(spaeter.data));
    assert.equal(spaeter.data.wiederVerfuegbarErgebnis.ok, true);
    assert.deepEqual(spaeter.data.wiederVerfuegbarErgebnis.geaendert, [9999]);
    assert.equal(lager(DB), "AVAILABLE");
    assert.equal(spaeter.data.wiederVerfuegbar.moeglich, false);
  } finally {
    netz.restore();
  }
});

test("a piece another customer has meanwhile reserved or bought is never relisted", async () => {
  const DB = sqliteD1(allMigrations());
  seed(DB);
  const netz = fakeNetz();
  try {
    const res = await call(DB, "/admin/orders/o1/stornieren", "POST", { wiederVerfuegbar: false });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    // Von Hand im Katalog freigegeben und gleich wieder verkauft.
    for (const status of ["AVAILABLE", "RESERVED", "PAYMENT_PENDING", "PAID"]) {
      DB.raw.prepare("UPDATE inventory SET status=? WHERE id='inv_9999'").run(status);
    }
    const detail = await call(DB, "/admin/orders/o1");
    assert.equal(detail.data.wiederVerfuegbar.moeglich, false);
    const wieder = await call(DB, "/admin/orders/o1/wieder-verfuegbar", "POST", {});
    assert.equal(wieder.status, 200, JSON.stringify(wieder.data));
    assert.deepEqual(wieder.data.wiederVerfuegbarErgebnis.geaendert, []);
    assert.equal(lager(DB), "PAID");
    assert.equal(netz.github.length, 0);
  } finally {
    netz.restore();
  }
});

test("too little PayPal balance: the storno waits, blocks shipping and nothing else changes yet", async () => {
  const DB = sqliteD1(allMigrations());
  seed(DB);
  const netz = fakeNetz({
    erstattung: { status: 422, body: { name: "UNPROCESSABLE_ENTITY", details: [{ issue: "REFUND_FAILED_INSUFFICIENT_FUNDS" }], debug_id: "dbg1" } },
  });
  try {
    const res = await call(DB, "/admin/orders/o1/stornieren", "POST", { wiederVerfuegbar: true });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    assert.equal(res.data.storniert.art, "ERSTATTUNG_LAEUFT");
    assert.equal(res.data.auftrag.status, "WARTET_AUF_DECKUNG");
    assert.equal(res.data.laufenderAuftrag.id, res.data.auftrag.id);
    assert.equal(res.data.versandSperre.code, "STORNO_LAEUFT");
    assert.equal(bestellung(DB), "PAID");
    assert.equal(lager(DB), "PAID");
    assert.equal(netz.github.length, 0);

    // Nicht versenden, solange die Stornierung laeuft.
    const versand = await call(DB, "/admin/orders/o1", "PATCH", { status: "PREPARING" });
    assert.equal(versand.status, 200);
    const raus = await call(DB, "/admin/orders/o1", "PATCH", { status: "SHIPPED" });
    assert.equal(raus.status, 409);
    assert.equal(raus.data.error, "STORNO_LAEUFT");

    // Abbrechen gibt den Versand wieder frei.
    const ab = await call(DB, `/admin/erstattungen/${res.data.auftrag.id}/abbrechen`, "POST", { grund: "Kundin will doch" });
    assert.equal(ab.status, 200, JSON.stringify(ab.data));
    assert.equal(ab.data.auftrag.status, "ABGEBROCHEN");
    assert.equal(ab.data.versandSperre, null);
    assert.equal(DB.raw.prepare("SELECT status FROM refunds").get().status, "CANCELLED");
  } finally {
    netz.restore();
  }
});

test("after the balance is topped up, a second click refunds, relists and finishes", async () => {
  const DB = sqliteD1(allMigrations());
  seed(DB);
  let netz = fakeNetz({
    erstattung: { status: 422, body: { details: [{ issue: "REFUND_FAILED_INSUFFICIENT_FUNDS" }] } },
  });
  try {
    await call(DB, "/admin/orders/o1/stornieren", "POST", { wiederVerfuegbar: true });
  } finally {
    netz.restore();
  }
  netz = fakeNetz();
  try {
    const res = await call(DB, "/admin/orders/o1/stornieren", "POST", { wiederVerfuegbar: true });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    assert.equal(res.data.auftrag.status, "ERLEDIGT");
    assert.equal(res.data.storniert.art, "ERSTATTET");
    assert.equal(bestellung(DB), "REFUNDED");
    assert.equal(lager(DB), "AVAILABLE");
    assert.equal(netz.paypal.length, 1);
    assert.ok(netz.github.some(c => c.method === "POST" && c.path === "/pulls"));
    assert.equal(DB.raw.prepare("SELECT COUNT(*) AS n FROM erstattungsauftraege").get().n, 1);
  } finally {
    netz.restore();
  }
});

test("shipped orders are not cancelled here, and relisting needs a finished order", async () => {
  const DB = sqliteD1(allMigrations());
  seed(DB, { status: "SHIPPED" });
  const netz = fakeNetz();
  try {
    const storno = await call(DB, "/admin/orders/o1/stornieren", "POST", {});
    assert.equal(storno.status, 409);
    assert.equal(storno.data.error, "STORNO_NICHT_MOEGLICH");
    const wieder = await call(DB, "/admin/orders/o1/wieder-verfuegbar", "POST", {});
    assert.equal(wieder.status, 409);
    assert.equal(wieder.data.error, "WIEDER_VERFUEGBAR_NICHT_MOEGLICH");
    assert.equal(netz.paypal.length + netz.github.length, 0);
  } finally {
    netz.restore();
  }
});

test("a relisted piece in a new checkout is never pulled along by an old order", async () => {
  const DB = sqliteD1(allMigrations());
  seed(DB);
  // Das Stueck steckt schon in einer neuen Zahlung einer anderen Kundin
  // (Schritt fuer Schritt - die Datenbank prueft jeden Statuswechsel).
  for (const status of ["REFUNDED", "AVAILABLE", "RESERVED", "PAYMENT_PENDING"]) {
    DB.raw.prepare("UPDATE inventory SET status=? WHERE id='inv_9999'").run(status);
  }
  const res = await call(DB, "/admin/orders/o1", "PATCH", { status: "PREPARING" });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.equal(bestellung(DB), "PREPARING");
  assert.equal(lager(DB), "PAYMENT_PENDING");
});

test("a bought Packlink label is reported so its postage can be reclaimed", async () => {
  const DB = sqliteD1(allMigrations());
  seed(DB, { status: "PREPARING" });
  DB.raw.prepare(`INSERT INTO packlink_sendungen (id,order_id,reference,service_id,carrier,service_name,paket,price_cents,state,created_at,updated_at)
    VALUES ('s1','o1','DE2026PRO0012345678',20955,'DPD','Classic','M',785,'READY_TO_PRINT',?,?)`)
    .run("2026-09-30T09:00:00.000Z", "2026-09-30T09:00:00.000Z");
  const netz = fakeNetz();
  try {
    const res = await call(DB, "/admin/orders/o1/stornieren", "POST", { wiederVerfuegbar: false });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    assert.deepEqual(res.data.storniert.etikett, { reference: "DE2026PRO0012345678", state: "READY_TO_PRINT" });
  } finally {
    netz.restore();
  }
});

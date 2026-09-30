import assert from "node:assert/strict";
import test from "node:test";

import { handleAdminRequest, zahlungenPflegen, widerrufVonWebsite } from "./admin-api.js";
import { completePayment } from "./worker.js";
import { formatOrderConfirmation, sendOrderConfirmation } from "./customer-mail.js";
import { reservierungFelder, zahlungView } from "./zahlung.js";
import { allMigrations, sqliteD1 } from "./test-d1.mjs";

// Reservieren beim Kauf, Einziehen beim Versand (zahlung.js) - gegen die
// echten Migrationen, mit nachgebautem PayPal, Brevo, Telegram und GitHub.

const ADMIN = "https://admin.disorder119.com";
const SHOP = "https://disorder119.com";
const MAIN = "a".repeat(40);
const TREE = "b".repeat(40);
const NUMMER = "D119-20260930-RESV1234";
const STUNDE = 60 * 60 * 1000;

function seed(DB, { status = "PAID", faelligIn = 60 * STUNDE, preis = 1000, versand = 590 } = {}) {
  const run = (sql, ...args) => DB.raw.prepare(sql).run(...args);
  const jetzt = new Date().toISOString();
  const total = preis + versand;
  run(`INSERT INTO commerce_orders (id,order_number,status,currency,subtotal_cents,shipping_cents,total_cents,idempotency_key,created_at)
    VALUES ('o1',?,?,'EUR',?,?,?,'k1',?)`, NUMMER, status, preis, versand, total, jetzt);
  run(`INSERT INTO inventory (id,item_id,article_no,status,sale_price_cents,currency,catalog_status,version,updated_at)
    VALUES ('inv_9999',9999,'A9999',?,?,'EUR','SOLD',1,?)`, status, preis, jetzt);
  run(`INSERT INTO order_items (id,order_id,inventory_id,item_id,article_no,title_snapshot,unit_price_cents,quantity,currency)
    VALUES ('oi0','o1','inv_9999',9999,'A9999','Testjacke',?,1,'EUR')`, preis);
  run(`INSERT INTO payments (id,order_id,provider,provider_order_id,status,amount_cents,currency,idempotency_key,created_at,
      authorization_id,authorized_at,capture_due_at,authorization_expires_at)
    VALUES ('p1','o1','PAYPAL','PPORDER1','AUTHORIZED',?,'EUR','pk1',?,'AUTH1',?,?,?)`,
  total, jetzt, jetzt, new Date(Date.now() + faelligIn).toISOString(), new Date(Date.now() + 29 * 24 * STUNDE).toISOString());
  run(`INSERT INTO order_contact_snapshots (order_id,source_provider,email,recipient_name,address_line1,postal_code,city,country_code,captured_at)
    VALUES ('o1','PAYPAL','kundin@example.test','Kim Beispiel','Musterweg 1','63739','Aschaffenburg','DE',?)`, jetzt);
  return total;
}

function captureAntwort(status = "COMPLETED", extra = {}) {
  return {
    id: "CAPTURE1", status, amount: { currency_code: "EUR", value: "15.90" },
    create_time: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    seller_receivable_breakdown: { paypal_fee: { currency_code: "EUR", value: "0.64" } },
    ...extra,
  };
}

// PayPal (Einziehen, Freigeben, Erstatten), Brevo, Telegram, GitHub.
function fakeNetz(opts = {}) {
  const log = { einzug: [], freigabe: [], erstattung: [], lesen: [], mails: [], telegram: [], github: [] };
  const stand = { capture: opts.capture || { status: 201, body: captureAntwort() }, captureAbfrage: opts.captureAbfrage || null };
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input?.url || input));
    const method = init.method || "GET";
    let body = null;
    try { body = init.body ? JSON.parse(init.body) : null; } catch { body = String(init.body); }
    if (url.hostname.endsWith("paypal.com")) {
      if (url.pathname === "/v1/oauth2/token") return Response.json({ access_token: "tok" });
      if (url.pathname === "/v2/payments/authorizations/AUTH1/capture") {
        log.einzug.push({ headers: init.headers, body });
        return Response.json(stand.capture.body, { status: stand.capture.status });
      }
      if (url.pathname === "/v2/payments/authorizations/AUTH1/void") {
        log.freigabe.push({ headers: init.headers });
        const antwort = opts.freigabe || { status: 200, body: { id: "AUTH1", status: "VOIDED" } };
        return Response.json(antwort.body, { status: antwort.status });
      }
      if (url.pathname === "/v2/payments/captures/CAPTURE1" && method === "GET") {
        log.lesen.push(url.pathname);
        return Response.json(stand.captureAbfrage || captureAntwort());
      }
      if (url.pathname === "/v2/checkout/orders/PPORDER1" && method === "GET") {
        log.lesen.push(url.pathname);
        return Response.json({ id: "PPORDER1", status: "COMPLETED", purchase_units: [{ custom_id: "9999", payments: {
          authorizations: [{ id: "AUTH1", status: "CAPTURED", amount: { currency_code: "EUR", value: "15.90" } }],
          captures: [captureAntwort()],
        } }] });
      }
      if (url.pathname === "/v2/payments/captures/CAPTURE1/refund") {
        log.erstattung.push({ headers: init.headers, body });
        return Response.json({ id: "REFUND1", status: "COMPLETED" }, { status: 201 });
      }
      if (url.pathname === "/v1/reporting/balances") return Response.json({ name: "NOT_AUTHORIZED" }, { status: 403 });
      throw new Error(`unerwartet: ${method} ${url}`);
    }
    if (url.hostname === "api.brevo.com") {
      log.mails.push(body);
      return Response.json({ messageId: `m${log.mails.length}` }, { status: 201 });
    }
    if (url.hostname === "api.telegram.org") {
      log.telegram.push(body);
      return Response.json({ ok: true, result: { message_id: log.telegram.length } });
    }
    if (url.hostname === "api.github.com") {
      const path = url.pathname.replace("/repos/disorder119/disorder119-shop", "");
      log.github.push({ method, path, body });
      if (method === "GET" && path === "/git/ref/heads/main") return Response.json({ object: { sha: MAIN } });
      if (method === "GET" && path === `/git/commits/${MAIN}`) return Response.json({ tree: { sha: TREE } });
      if (method === "GET" && path === "/contents/data") return Response.json([{ name: "items.json", type: "file", sha: "items-sha" }]);
      if (method === "GET" && path === "/git/blobs/items-sha") {
        return new Response(JSON.stringify([{ id: 9999, title: "Testjacke", brand: "Test", price: 10, public_status: "SOLD", status: "Verkauft" }], null, 2) + "\n");
      }
      if (method === "POST" && path === "/git/blobs") return Response.json({ sha: "blob-1" });
      if (method === "POST" && path === "/git/trees") return Response.json({ sha: "d".repeat(40) });
      if (method === "POST" && path === "/git/commits") return Response.json({ sha: "e".repeat(40) });
      if (method === "POST" && path === "/git/refs") return Response.json({ ref: body.ref }, { status: 201 });
      if (method === "POST" && path === "/pulls") return Response.json({ number: 321, html_url: "https://github.com/x/y/pull/321" }, { status: 201 });
      if (method === "PUT" && path === "/pulls/321/merge") return Response.json({ sha: "f".repeat(40), merged: true });
      if (method === "DELETE") return new Response(null, { status: 204 });
      return new Response(`unerwartet: ${method} ${path}`, { status: 404 });
    }
    throw new Error(`unerwarteter fetch: ${url}`);
  };
  return { ...log, stand, restore() { globalThis.fetch = original; } };
}

const ENV = DB => ({
  DB, ADMIN_TOKEN: "t", GITHUB_TOKEN: "gh",
  PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: "sec", PAYPAL_ENVIRONMENT: "live",
  MAIL_API_KEY: "brevo", MAIL_FROM: "kontakt@disorder119.com", MAIL_BCC: "kopie@disorder119.com",
  TELEGRAM_BOT_TOKEN: "bot", TELEGRAM_CHAT_ID: "42",
  // Steuerprofil vollstaendig: die Rechnung nach dem Einziehen ist kein Entwurf.
  TAX_MODE: "small_business", TAX_CONFIRMED: "true", TAX_NUMBER: "204/123/45678",
});

async function call(DB, path, method = "GET", body, env = ENV(DB)) {
  const url = `https://api.disorder119.com${path}`;
  const headers = { Authorization: "Bearer t", Origin: ADMIN };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const request = new Request(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const response = await handleAdminRequest(request, env, new URL(url), "req-zahlung", ADMIN);
  return { status: response.status, data: await response.json() };
}

const wert = (DB, sql) => DB.raw.prepare(sql).get();
const kundenmails = netz => netz.mails.filter(m => m.to?.[0]?.email === "kundin@example.test");

test("the reservation window: capture due after 66 hours, released after 29 days", () => {
  const felder = reservierungFelder({ id: "AUTH1", create_time: "2026-09-30T10:00:00Z", expiration_time: "2026-10-29T10:00:00Z" },
    new Date("2026-09-30T10:00:05Z"));
  assert.deepEqual(felder, {
    authorizationId: "AUTH1",
    authorizedAt: "2026-09-30T10:00:05.000Z",
    captureDueAt: "2026-10-03T04:00:00.000Z",
    expiresAt: "2026-10-29T10:00:00.000Z",
  });
  const view = zahlungView({ status: "AUTHORIZED", authorization_id: "AUTH1", amount_cents: 1590,
    capture_due_at: "2026-10-03T04:00:00.000Z" }, new Date("2026-10-03T05:00:00Z"));
  assert.equal(view.reserviert, true);
  assert.equal(view.ueberfaellig, true);
  assert.equal(view.einziehenMoeglich, true);
});

test("storno before shipping releases the reservation: no refund, no fee, customer told nothing was charged", async () => {
  const DB = sqliteD1(allMigrations());
  seed(DB);
  const netz = fakeNetz();
  try {
    const detail = await call(DB, "/admin/orders/o1");
    assert.equal(detail.data.zahlung.reserviert, true);
    assert.equal(detail.data.storno.art, "FREIGEBEN");
    assert.ok(!detail.data.nextStatuses.includes("CANCELLED"), "direkt Storniert nur ueber Stornieren");

    const res = await call(DB, "/admin/orders/o1/stornieren", "POST", {});
    assert.equal(res.status, 200, JSON.stringify(res.data));
    assert.equal(res.data.storniert.art, "FREIGEGEBEN");
    assert.equal(res.data.auftrag.status, "ERLEDIGT");
    assert.equal(res.data.auftrag.ergebnis, "FREIGEGEBEN");
    assert.equal(netz.freigabe.length, 1);
    assert.equal(netz.freigabe[0].headers["PayPal-Request-Id"], "freigabe:p1");
    assert.equal(netz.erstattung.length, 0, "keine Erstattung");
    assert.equal(netz.einzug.length, 0, "nichts eingezogen");

    const zahlung = wert(DB, "SELECT status,voided_at FROM payments");
    assert.equal(zahlung.status, "CANCELLED");
    assert.ok(zahlung.voided_at);
    assert.equal(wert(DB, "SELECT status FROM commerce_orders").status, "CANCELLED");
    assert.equal(wert(DB, "SELECT status FROM inventory").status, "AVAILABLE");
    assert.equal(wert(DB, "SELECT COUNT(*) AS n FROM refunds").n, 0);
    assert.equal(wert(DB, "SELECT COUNT(*) AS n FROM tax_cash_events").n, 0);
    assert.equal(wert(DB, "SELECT COUNT(*) AS n FROM rechnungen").n, 0, "ohne Einziehen keine Rechnung");
    assert.ok(netz.github.some(g => g.method === "POST" && g.path === "/pulls"), "Stueck zurueck in den Shop");

    const mails = kundenmails(netz);
    assert.equal(mails.length, 1);
    assert.match(mails[0].subject, /storniert – nichts abgebucht/);
    assert.match(mails[0].textContent, /Abgebucht wurde nichts/);
    assert.doesNotMatch(mails[0].textContent, /erstattet/);
    assert.match(netz.telegram.at(-1).text, /NICHTS ABGEBUCHT/);

    // Ein zweiter Klick aendert nichts mehr.
    const nochmal = await call(DB, "/admin/orders/o1/stornieren", "POST", {});
    assert.equal(nochmal.status, 409);
    assert.equal(netz.freigabe.length, 1);
  } finally {
    netz.restore();
  }
});

test("shipping captures first: evidence with fee, invoice mailed exactly once, then the parcel may go", async () => {
  const DB = sqliteD1(allMigrations());
  seed(DB);
  const netz = fakeNetz();
  try {
    assert.equal((await call(DB, "/admin/orders/o1", "PATCH", { status: "PREPARING" })).status, 200);
    assert.equal(netz.einzug.length, 0, "Packen zieht noch nichts ein");
    const raus = await call(DB, "/admin/orders/o1", "PATCH", { status: "SHIPPED", trackingNumber: "0123456789", carrier: "DPD" });
    assert.equal(raus.status, 200, JSON.stringify(raus.data));
    assert.equal(netz.einzug.length, 1);
    assert.equal(netz.einzug[0].headers["PayPal-Request-Id"], "einzug:p1");
    assert.equal(netz.einzug[0].body.final_capture, true);
    assert.equal(raus.data.order.status, "SHIPPED");
    assert.equal(raus.data.zahlung.eingezogen, true);

    const zahlung = wert(DB, "SELECT status,provider_payment_id,capture_error FROM payments");
    assert.deepEqual({ ...zahlung }, { status: "COMPLETED", provider_payment_id: "CAPTURE1", capture_error: null });
    const belege = DB.raw.prepare("SELECT kind,amount_cents FROM tax_cash_events ORDER BY kind").all().map(r => [r.kind, r.amount_cents]);
    assert.deepEqual(belege, [["capture", 1590], ["fee", 64]]);
    assert.equal(wert(DB, "SELECT COUNT(*) AS n FROM rechnungen").n, 1);

    const rechnung = kundenmails(netz).find(m => /Deine Rechnung/.test(m.subject));
    assert.ok(rechnung, "Rechnungsmail nach dem Einziehen");
    assert.match(rechnung.textContent, /eingezogen/);
    assert.match(rechnung.textContent, /Rechnung/);
    assert.deepEqual(rechnung.bcc, [{ email: "kopie@disorder119.com" }]);
    assert.ok(kundenmails(netz).some(m => /unterwegs|versendet|Sendung/i.test(m.subject)), "Versandmail");

    // Cron-Nachholen schickt die Rechnung nicht noch einmal, zieht nicht noch einmal ein.
    await zahlungenPflegen(ENV(DB), "cron", new Date(Date.now() + 80 * STUNDE));
    assert.equal(kundenmails(netz).filter(m => /Deine Rechnung/.test(m.subject)).length, 1);
    assert.equal(netz.einzug.length, 1);
  } finally {
    netz.restore();
  }
});

test("capture refused (reservation expired): nothing ships, owner warned, storno without money", async () => {
  const DB = sqliteD1(allMigrations());
  seed(DB);
  const netz = fakeNetz({
    capture: { status: 422, body: { name: "UNPROCESSABLE_ENTITY", details: [{ issue: "AUTHORIZATION_EXPIRED" }] } },
    freigabe: { status: 422, body: { name: "UNPROCESSABLE_ENTITY", details: [{ issue: "AUTHORIZATION_EXPIRED" }] } },
  });
  try {
    await call(DB, "/admin/orders/o1", "PATCH", { status: "PREPARING" });
    const raus = await call(DB, "/admin/orders/o1", "PATCH", { status: "SHIPPED", trackingNumber: "0123456789" });
    assert.equal(raus.status, 409);
    assert.equal(raus.data.error, "ZAHLUNG_GESCHEITERT");
    assert.match(raus.data.detail.text, /Nicht versenden/);
    assert.match(raus.data.detail.text, /abgelaufen/);
    assert.equal(wert(DB, "SELECT status FROM commerce_orders").status, "PREPARING");
    assert.equal(wert(DB, "SELECT COUNT(*) AS n FROM shipments").n, 0);
    assert.equal(wert(DB, "SELECT status FROM payments").status, "FAILED");
    assert.match(netz.telegram.at(-1).text, /NICHT VERSENDEN/);

    const detail = await call(DB, "/admin/orders/o1");
    assert.equal(detail.data.zahlung.gescheitert, true);
    assert.equal(detail.data.versandSperre.code, "ZAHLUNG_GESCHEITERT");
    assert.equal(detail.data.storno.art, "STORNIEREN");
    assert.ok(detail.data.nextStatuses.includes("CANCELLED"));

    const storno = await call(DB, "/admin/orders/o1/stornieren", "POST", {});
    assert.equal(storno.status, 200, JSON.stringify(storno.data));
    assert.equal(storno.data.storniert.art, "STORNIERT");
    assert.equal(wert(DB, "SELECT status FROM commerce_orders").status, "CANCELLED");
    assert.equal(wert(DB, "SELECT status FROM payments").status, "CANCELLED");
    assert.equal(wert(DB, "SELECT status FROM inventory").status, "AVAILABLE");
    assert.equal(netz.erstattung.length, 0);
    assert.equal(wert(DB, "SELECT COUNT(*) AS n FROM tax_cash_events").n, 0);
  } finally {
    netz.restore();
  }
});

test("the cron captures at the end of PayPal's honor period - not earlier, never during a storno", async () => {
  const DB = sqliteD1(allMigrations());
  seed(DB, { faelligIn: 10 * STUNDE });
  const netz = fakeNetz();
  try {
    await zahlungenPflegen(ENV(DB), "cron-1", new Date());
    assert.equal(netz.einzug.length, 0, "noch nicht faellig");
    await zahlungenPflegen(ENV(DB), "cron-2", new Date(Date.now() + 11 * STUNDE));
    assert.equal(netz.einzug.length, 1);
    assert.equal(wert(DB, "SELECT status FROM payments").status, "COMPLETED");
    assert.equal(wert(DB, "SELECT status FROM commerce_orders").status, "PAID", "Einziehen ist kein Versand");
    assert.ok(kundenmails(netz).some(m => /Deine Rechnung/.test(m.subject)));
  } finally {
    netz.restore();
  }

  const DB2 = sqliteD1(allMigrations());
  seed(DB2, { faelligIn: -STUNDE });
  const jetzt = new Date().toISOString();
  DB2.raw.prepare(`INSERT INTO erstattungsauftraege (id,order_id,anlass,betrag_cents,vor_versand,status,letzter_fehler,created_at,updated_at)
    VALUES ('a1','o1','STORNO',1590,1,'FEHLER','NETZFEHLER',?,?)`).run(jetzt, jetzt);
  const netz2 = fakeNetz();
  try {
    const lauf = await zahlungenPflegen(ENV(DB2), "cron-3", new Date());
    assert.equal(lauf.gesperrt, 1);
    assert.equal(netz2.einzug.length, 0, "waehrend eines Stornos wird nicht eingezogen");
    assert.equal(wert(DB2, "SELECT status FROM payments").status, "AUTHORIZED");
  } finally {
    netz2.restore();
  }
});

test("race: the money was captured just before the storno - the job refunds instead", async () => {
  const DB = sqliteD1(allMigrations());
  seed(DB);
  const netz = fakeNetz({ freigabe: { status: 422, body: { name: "UNPROCESSABLE_ENTITY", details: [{ issue: "PREVIOUSLY_CAPTURED" }] } } });
  try {
    const res = await call(DB, "/admin/orders/o1/stornieren", "POST", {});
    assert.equal(res.status, 200, JSON.stringify(res.data));
    assert.equal(res.data.auftrag.status, "ERLEDIGT");
    assert.equal(res.data.auftrag.ergebnis, "ERSTATTET");
    assert.equal(res.data.storniert.art, "ERSTATTET");
    assert.equal(netz.erstattung.length, 1);
    assert.equal(wert(DB, "SELECT status FROM payments").status, "REFUNDED");
    assert.equal(wert(DB, "SELECT status FROM commerce_orders").status, "REFUNDED");
    assert.equal(wert(DB, "SELECT COUNT(*) AS n FROM tax_cash_events WHERE kind='capture'").n, 1);
    assert.ok(kundenmails(netz).some(m => /erstattet/.test(m.subject)));
  } finally {
    netz.restore();
  }
});

test("PayPal still reviewing the capture: shipping stays blocked until the cron sees it completed", async () => {
  const DB = sqliteD1(allMigrations());
  seed(DB);
  const netz = fakeNetz({
    capture: { status: 201, body: captureAntwort("PENDING", { status_details: { reason: "PENDING_REVIEW" } }) },
    captureAbfrage: captureAntwort("PENDING", { status_details: { reason: "PENDING_REVIEW" } }),
  });
  try {
    const einzug = await call(DB, "/admin/orders/o1/zahlung/einziehen", "POST", {});
    assert.equal(einzug.status, 200, JSON.stringify(einzug.data));
    assert.equal(einzug.data.einzug.ok, false);
    assert.equal(einzug.data.einzug.code, "ZAHLUNG_WIRD_GEPRUEFT");
    assert.equal(einzug.data.zahlung.wirdGeprueft, true);
    assert.equal(einzug.data.versandSperre.code, "ZAHLUNG_WIRD_GEPRUEFT");
    assert.match(netz.telegram.at(-1).text, /WIRD GEPRÜFT/);

    await call(DB, "/admin/orders/o1", "PATCH", { status: "PREPARING" });
    const raus = await call(DB, "/admin/orders/o1", "PATCH", { status: "SHIPPED", trackingNumber: "0123456789" });
    assert.equal(raus.status, 409);
    assert.equal(raus.data.error, "ZAHLUNG_WIRD_GEPRUEFT");
    assert.equal(netz.einzug.length, 1, "nie ein zweites Einziehen");

    netz.stand.captureAbfrage = captureAntwort("COMPLETED");
    await zahlungenPflegen(ENV(DB), "cron", new Date(Date.now() + 31 * 60 * 1000));
    assert.equal(wert(DB, "SELECT status FROM payments").status, "COMPLETED");
    assert.equal(wert(DB, "SELECT COUNT(*) AS n FROM tax_cash_events WHERE kind='capture'").n, 1);
    const jetzt = await call(DB, "/admin/orders/o1", "PATCH", { status: "SHIPPED", trackingNumber: "0123456789" });
    assert.equal(jetzt.status, 200, JSON.stringify(jetzt.data));
    assert.equal(netz.einzug.length, 1);
  } finally {
    netz.restore();
  }
});

test("goodwill on a merely reserved payment is refused - a reservation is released as a whole only", async () => {
  const DB = sqliteD1(allMigrations());
  seed(DB);
  const netz = fakeNetz();
  try {
    const res = await call(DB, "/admin/orders/o1/erstatten", "POST", { anlass: "KULANZ", betragCents: 500, kundenGrund: "Kleiner Fleck" });
    assert.equal(res.status, 409);
    assert.equal(res.data.error, "ZAHLUNG_NOCH_RESERVIERT");
    assert.equal(netz.freigabe.length + netz.einzug.length + netz.erstattung.length, 0);
  } finally {
    netz.restore();
  }
});

test("order confirmation for a reservation: no invoice yet, charge on shipping explained", async () => {
  const text = formatOrderConfirmation({
    order_number: NUMMER, currency: "EUR", subtotal_cents: 1000, shipping_cents: 590, total_cents: 1590, created_at: "2026-09-30T10:00:00Z",
    items: [{ title_snapshot: "Testjacke", article_no: "A9999", unit_price_cents: 1000 }],
    contact: { recipient_name: "Kim Beispiel", address_line1: "Musterweg 1", postal_code: "63739", city: "Aschaffenburg", country_code: "DE" },
  }, { zahlung: "RESERVIERT", taxProfile: { mode: "small_business", confirmed: true, tax_number: "1", seller: {} } });
  assert.equal(text.invoice.ready, false);
  assert.equal(text.invoice.deferred, true);
  assert.match(text.text, /bei PayPal reserviert/);
  assert.match(text.text, /Abgebucht wird erst, wenn wir dein Paket versenden/);
  assert.match(text.text, /Die Rechnung schicken wir dir, sobald der Betrag eingezogen ist/);
  assert.doesNotMatch(text.text, /Rechnungsnummer/);

  const DB = sqliteD1(allMigrations());
  seed(DB);
  const netz = fakeNetz();
  try {
    const env = ENV(DB);
    const gesendet = await sendOrderConfirmation(env, "o1", "req-mail");
    assert.equal(gesendet.sent, true);
    assert.equal(wert(DB, "SELECT COUNT(*) AS n FROM rechnungen").n, 0);
    assert.match(kundenmails(netz)[0].textContent, /bei PayPal reserviert/);
    const archiv = JSON.parse(wert(DB, "SELECT invoice_json FROM order_confirmation_archive").invoice_json);
    assert.equal(archiv.deferred, true);

    // Nach dem Einziehen kommt die Rechnung in einer eigenen Mail.
    const einzug = await call(DB, "/admin/orders/o1/zahlung/einziehen", "POST", {});
    assert.equal(einzug.data.einzug.ok, true);
    assert.equal(wert(DB, "SELECT COUNT(*) AS n FROM rechnungen").n, 1);
    assert.equal(kundenmails(netz).filter(m => /Deine Rechnung/.test(m.subject)).length, 1);
  } finally {
    netz.restore();
  }
});

test("a capture PayPal reports later (webhook, unclear answer) is booked once", async () => {
  const DB = sqliteD1(allMigrations());
  seed(DB);
  const netz = fakeNetz();
  try {
    const providerOrder = { id: "PPORDER1", status: "COMPLETED", purchase_units: [{ custom_id: "9999", payments: {
      authorizations: [{ id: "AUTH1", status: "CAPTURED", amount: { currency_code: "EUR", value: "15.90" } }],
      captures: [captureAntwort()],
    } }] };
    const erst = await completePayment(ENV(DB), "PPORDER1", providerOrder, "wh-1");
    assert.equal(erst.eingezogen, true);
    const dann = await completePayment(ENV(DB), "PPORDER1", providerOrder, "wh-2");
    assert.equal(dann.eingezogen, undefined);
    assert.equal(wert(DB, "SELECT status FROM payments").status, "COMPLETED");
    assert.equal(wert(DB, "SELECT COUNT(*) AS n FROM tax_cash_events WHERE kind='capture'").n, 1);
  } finally {
    netz.restore();
  }
});

test("withdrawal before shipping on a reservation: receipt says nothing was charged, storno releases it", async () => {
  const DB = sqliteD1(allMigrations());
  seed(DB);
  const netz = fakeNetz();
  try {
    const url = "https://api.disorder119.com/widerruf";
    const request = new Request(url, { method: "POST", headers: { Origin: SHOP, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Kim", email: "kundin@example.test", bestellnummer: NUMMER, umfang: "GANZ", bestaetigt: true }) });
    const res = await widerrufVonWebsite(request, ENV(DB), new URL(url), "req-widerruf", SHOP);
    assert.equal(res.status, 200);
    assert.match(kundenmails(netz)[0].textContent, /abgebucht ist noch nichts/);
    assert.match(netz.telegram[0].text, /nur reserviert/);

    const storno = await call(DB, "/admin/orders/o1/stornieren", "POST", {});
    assert.equal(storno.data.auftrag.ergebnis, "FREIGEGEBEN");
    assert.equal(wert(DB, "SELECT status FROM widerrufe").status, "ERLEDIGT");
    assert.equal(wert(DB, "SELECT status FROM commerce_orders").status, "CANCELLED");
    assert.match(kundenmails(netz).at(-1).subject, /nichts abgebucht/);
  } finally {
    netz.restore();
  }
});

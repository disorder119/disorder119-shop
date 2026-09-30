import assert from "node:assert/strict";
import test from "node:test";

import {
  erstattungAusPaypal,
  handleAdminRequest,
  orderStatusAutomatisch,
  ruecklaufPflegen,
  widerrufAusKonto,
  widerrufVonWebsite,
} from "./admin-api.js";
import { widerrufsbelehrungText } from "./customer-mail.js";
import { allMigrations, sqliteD1 } from "./test-d1.mjs";

// Storno, Ruecksendung, Widerruf und Kulanz "wasserfest": Erstattungen als
// Auftrag (erstattung-auftrag.js) und die Widerrufsfunktion nach § 356a BGB
// (widerruf.js) - gegen die echten Migrationen und mit nachgebautem PayPal,
// Brevo, Telegram und GitHub.

const ADMIN = "https://admin.disorder119.com";
const SHOP = "https://disorder119.com";
const MAIN = "a".repeat(40);
const TREE = "b".repeat(40);
const NOW = "2026-09-30T08:00:00.000Z";
const NUMMER = "D119-20260930-ABCD1234";

function katalog(ids) {
  return ids.map(id => ({ id, title: `Stück ${id}`, brand: "Test", price: 10, public_status: "SOLD", status: "Verkauft" }));
}

function seed(DB, { status = "PAID", stuecke = [{ item: 9999, preis: 1000, titel: "Testjacke" }], versand = 590 } = {}) {
  const run = (sql, ...args) => DB.raw.prepare(sql).run(...args);
  const subtotal = stuecke.reduce((summe, s) => summe + s.preis, 0);
  const total = subtotal + versand;
  run(`INSERT INTO commerce_orders (id,order_number,status,currency,subtotal_cents,shipping_cents,total_cents,idempotency_key,created_at)
    VALUES ('o1',?,?,'EUR',?,?,?,'k1',?)`, NUMMER, status, subtotal, versand, total, NOW);
  stuecke.forEach((s, i) => {
    run(`INSERT INTO inventory (id,item_id,article_no,status,sale_price_cents,currency,catalog_status,version,updated_at)
      VALUES (?,?,?,?,?,'EUR','SOLD',1,?)`, `inv_${s.item}`, s.item, `A${s.item}`, status, s.preis, NOW);
    run(`INSERT INTO order_items (id,order_id,inventory_id,item_id,article_no,title_snapshot,unit_price_cents,quantity,currency)
      VALUES (?,'o1',?,?,?,?,?,1,'EUR')`, `oi${i}`, `inv_${s.item}`, s.item, `A${s.item}`, s.titel || `Stück ${s.item}`, s.preis);
  });
  run(`INSERT INTO payments (id,order_id,provider,provider_order_id,provider_payment_id,status,amount_cents,currency,idempotency_key,created_at)
    VALUES ('p1','o1','PAYPAL','PPORDER1','CAPTURE1','COMPLETED',?,'EUR','pk1',?)`, total, NOW);
  run(`INSERT INTO order_contact_snapshots (order_id,source_provider,email,recipient_name,address_line1,postal_code,city,country_code,captured_at)
    VALUES ('o1','PAYPAL','kundin@example.test','Kim Beispiel','Musterweg 1','63739','Aschaffenburg','DE',?)`, NOW);
  if (["SHIPPED", "DELIVERED", "RETURN_REQUESTED"].includes(status)) {
    run(`INSERT INTO shipments (id,order_id,carrier,tracking_number,status,shipped_at,delivered_at,created_at)
      VALUES ('s1','o1','DPD','0123456789',?,?,?,?)`, status === "SHIPPED" ? "SHIPPED" : "DELIVERED", NOW,
    status === "SHIPPED" ? null : NOW, NOW);
  }
  return total;
}

// PayPal, Brevo (Mails), Telegram und GitHub (Katalog-Pull-Request).
function fakeNetz(opts = {}) {
  const log = { paypal: [], abfragen: [], mails: [], telegram: [], github: [] };
  const antworten = [...(opts.refunds || [{ status: 201, body: { id: "REFUND1", status: "COMPLETED" } }])];
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input?.url || input));
    const method = init.method || "GET";
    let body = null;
    try { body = init.body ? JSON.parse(init.body) : null; } catch { body = String(init.body); }
    if (url.hostname.endsWith("paypal.com")) {
      if (url.pathname === "/v1/oauth2/token") return Response.json({ access_token: "tok" });
      if (/^\/v2\/payments\/captures\/[^/]+\/refund$/.test(url.pathname)) {
        log.paypal.push({ headers: init.headers, body });
        if (opts.beimRefund) await opts.beimRefund(log.paypal.length);
        const antwort = antworten.length > 1 ? antworten.shift() : antworten[0];
        return Response.json(antwort.body, { status: antwort.status });
      }
      if (url.pathname.startsWith("/v2/payments/refunds/")) {
        log.abfragen.push(url.pathname);
        return Response.json(opts.refundStand || { id: "REFUND1", status: "COMPLETED" });
      }
      if (url.pathname === "/v1/reporting/balances") {
        return opts.guthaben ? Response.json(opts.guthaben) : Response.json({ name: "NOT_AUTHORIZED" }, { status: 403 });
      }
      throw new Error(`unerwartet: ${url}`);
    }
    if (url.hostname === "api.brevo.com") {
      log.mails.push(body);
      if (opts.mailFehler && log.mails.length <= opts.mailFehler) return Response.json({ message: "down" }, { status: 500 });
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
      if (method === "GET" && path === "/git/blobs/items-sha") return new Response(JSON.stringify(katalog(opts.katalog || [9999]), null, 2) + "\n");
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
  return { ...log, restore() { globalThis.fetch = original; } };
}

const ENV = DB => ({
  DB, ADMIN_TOKEN: "t", GITHUB_TOKEN: "gh",
  PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: "sec", PAYPAL_ENVIRONMENT: "live",
  MAIL_API_KEY: "brevo", MAIL_FROM: "kontakt@disorder119.com", MAIL_BCC: "kopie@disorder119.com",
  TELEGRAM_BOT_TOKEN: "bot", TELEGRAM_CHAT_ID: "42",
});

async function call(DB, path, method = "GET", body, env = ENV(DB)) {
  const url = `https://api.disorder119.com${path}`;
  const headers = { Authorization: "Bearer t", Origin: ADMIN };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const request = new Request(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const response = await handleAdminRequest(request, env, new URL(url), "req-ruecklauf", ADMIN);
  return { status: response.status, data: await response.json() };
}

async function widerrufen(DB, body, { origin = SHOP, env = ENV(DB) } = {}) {
  const url = "https://api.disorder119.com/widerruf";
  const request = new Request(url, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const response = await widerrufVonWebsite(request, env, new URL(url), "req-widerruf", origin);
  return { status: response.status, data: await response.json() };
}

const wert = (DB, sql) => DB.raw.prepare(sql).get();
const spaeter = minuten => new Date(Date.now() + minuten * 60 * 1000);
const kundenmails = netz => netz.mails.filter(m => m.to?.[0]?.email === "kundin@example.test");

// ------------------------------------------------------------- Auftraege

test("PayPal's webhook arriving before its own answer: one refund, one mail, job done", async () => {
  const DB = sqliteD1(allMigrations());
  seed(DB);
  const env = ENV(DB);
  const netz = fakeNetz({
    beimRefund: () => erstattungAusPaypal(env, { event_type: "PAYMENT.CAPTURE.REFUNDED", resource: {
      id: "REFUND1", status: "COMPLETED", amount: { value: "15.90", currency_code: "EUR" },
      supplementary_data: { related_ids: { capture_id: "CAPTURE1" } } } }, "wh-schnell"),
  });
  try {
    const res = await call(DB, "/admin/orders/o1/stornieren", "POST", {});
    assert.equal(res.status, 200, JSON.stringify(res.data));
    assert.equal(res.data.auftrag.status, "ERLEDIGT");
    assert.equal(wert(DB, "SELECT COUNT(*) AS n FROM refunds").n, 1);
    const refund = wert(DB, "SELECT * FROM refunds");
    assert.equal(refund.status, "COMPLETED");
    assert.equal(refund.provider_refund_id, "REFUND1");
    assert.equal(wert(DB, "SELECT status FROM commerce_orders").status, "REFUNDED");
    const mails = kundenmails(netz);
    assert.equal(mails.length, 1);
    assert.match(mails[0].subject, /storniert – 15,90\s€ erstattet/);
    assert.deepEqual(mails[0].bcc, [{ email: "kopie@disorder119.com" }]);
    assert.match(mails[0].textContent, /über PayPal/);
  } finally {
    netz.restore();
  }
});

test("waiting for PayPal balance: no customer mail yet, owner told what is missing", async () => {
  const DB = sqliteD1(allMigrations());
  seed(DB);
  const netz = fakeNetz({
    refunds: [{ status: 422, body: { details: [{ issue: "REFUND_FAILED_INSUFFICIENT_FUNDS" }] } }],
    guthaben: { balances: [{ currency: "EUR", primary: true, available_balance: { currency_code: "EUR", value: "3.20" } }] },
  });
  try {
    const res = await call(DB, "/admin/orders/o1/stornieren", "POST", {});
    assert.equal(res.data.auftrag.status, "WARTET_AUF_DECKUNG");
    assert.equal(kundenmails(netz).length, 0);
    assert.equal(netz.telegram.length, 1);
    assert.match(netz.telegram[0].text, /ERSTATTUNG WARTET/);
    assert.match(netz.telegram[0].text, /es fehlen 12,70\s€/);
    // Direkt zur Original-Transaktion in PayPal - dort "Rueckzahlung".
    assert.match(netz.telegram[0].text, /https:\/\/www\.paypal\.com\/activity\/payment\/CAPTURE1/);
    assert.equal(res.data.auftrag.paypalLink, "https://www.paypal.com/activity/payment/CAPTURE1");
    assert.match(res.data.auftrag.hinweis, /keine neue Zahlung/);
    // Die Uebersicht zeigt Guthaben und Fehlbetrag.
    const uebersicht = await call(DB, "/admin/erstattungen");
    assert.equal(uebersicht.status, 200, JSON.stringify(uebersicht.data));
    assert.equal(uebersicht.data.offeneAuftraege, 1);
    assert.equal(uebersicht.data.offeneWiderrufe, 0);
    assert.equal(uebersicht.data.paypal.verfuegbarCents, 320);
    assert.equal(uebersicht.data.paypal.fehltCents, 1270);
    assert.equal(uebersicht.data.auftraege[0].paypalLink, "https://www.paypal.com/activity/payment/CAPTURE1");
    // Kein zweites Telegram vor der naechsten Erinnerung.
    await ruecklaufPflegen(ENV(DB), "cron-1", spaeter(16));
    assert.equal(netz.telegram.length, 1);
  } finally {
    netz.restore();
  }
});

test("refunded directly in PayPal while waiting: job finishes without paying twice", async () => {
  const DB = sqliteD1(allMigrations());
  seed(DB);
  let netz = fakeNetz({ refunds: [{ status: 422, body: { details: [{ issue: "REFUND_FAILED_INSUFFICIENT_FUNDS" }] } }] });
  try {
    await call(DB, "/admin/orders/o1/stornieren", "POST", {});
  } finally {
    netz.restore();
  }
  netz = fakeNetz();
  try {
    await erstattungAusPaypal(ENV(DB), { event_type: "PAYMENT.CAPTURE.REFUNDED", resource: {
      id: "DIREKT1", status: "COMPLETED", amount: { value: "15.90", currency_code: "EUR" },
      supplementary_data: { related_ids: { capture_id: "CAPTURE1" } } } }, "wh-direkt");
    assert.equal(netz.paypal.length, 0);
    assert.equal(wert(DB, "SELECT status FROM erstattungsauftraege").status, "ERLEDIGT");
    assert.equal(wert(DB, "SELECT status FROM commerce_orders").status, "REFUNDED");
    assert.equal(kundenmails(netz).length, 1);
    // Die eigene, abgelehnte Zeile gilt als storniert - nicht als offener Fehler.
    assert.deepEqual(DB.raw.prepare("SELECT status FROM refunds ORDER BY status").all().map(r => r.status), ["CANCELLED", "COMPLETED"]);
    assert.equal(wert(DB, "SELECT inventory.status FROM inventory").status, "AVAILABLE");
  } finally {
    netz.restore();
  }
});

test("PayPal books later (PENDING): the cron asks PayPal and then finishes", async () => {
  const DB = sqliteD1(allMigrations());
  seed(DB);
  const netz = fakeNetz({
    refunds: [{ status: 201, body: { id: "R-P", status: "PENDING", status_details: { reason: "ECHECK" } } }],
    refundStand: { id: "R-P", status: "COMPLETED" },
  });
  try {
    const res = await call(DB, "/admin/orders/o1/stornieren", "POST", {});
    assert.equal(res.data.auftrag.status, "BEI_PAYPAL");
    assert.equal(kundenmails(netz).length, 0);
    assert.equal(wert(DB, "SELECT status FROM commerce_orders").status, "PAID");
    await ruecklaufPflegen(ENV(DB), "cron-p", spaeter(31));
    assert.deepEqual(netz.abfragen, ["/v2/payments/refunds/R-P"]);
    assert.equal(wert(DB, "SELECT status FROM erstattungsauftraege").status, "ERLEDIGT");
    assert.equal(wert(DB, "SELECT status FROM commerce_orders").status, "REFUNDED");
    assert.equal(kundenmails(netz).length, 1);
  } finally {
    netz.restore();
  }
});

test("shipped in the meantime: the storno stops instead of paying out", async () => {
  const DB = sqliteD1(allMigrations());
  seed(DB, { status: "PREPARING" });
  let netz = fakeNetz({ refunds: [{ status: 422, body: { details: [{ issue: "REFUND_FAILED_INSUFFICIENT_FUNDS" }] } }] });
  try {
    await call(DB, "/admin/orders/o1/stornieren", "POST", {});
    // Die Sendungsverfolgung meldet das Paket unterwegs - das gilt.
    await orderStatusAutomatisch(ENV(DB), "o1", "SHIPPED", "packlink");
  } finally {
    netz.restore();
  }
  netz = fakeNetz();
  try {
    await ruecklaufPflegen(ENV(DB), "cron-v", spaeter(16));
    assert.equal(netz.paypal.length, 0);
    const auftrag = wert(DB, "SELECT * FROM erstattungsauftraege");
    assert.equal(auftrag.status, "FEHLER");
    assert.equal(auftrag.letzter_fehler, "SCHON_VERSENDET");
    assert.equal(auftrag.fehler_endgueltig, 1);
    assert.match(netz.telegram.at(-1).text, /versendet/);
  } finally {
    netz.restore();
  }
});

test("customer mail failing once is sent later by the cron - exactly once", async () => {
  const DB = sqliteD1(allMigrations());
  seed(DB);
  const netz = fakeNetz({ mailFehler: 1 });
  try {
    const res = await call(DB, "/admin/orders/o1/stornieren", "POST", {});
    assert.equal(res.data.auftrag.status, "ERLEDIGT");
    assert.equal(res.data.auftrag.kundeMailStatus, "FEHLER");
    await ruecklaufPflegen(ENV(DB), "cron-m1", spaeter(15));
    assert.equal(wert(DB, "SELECT kunde_mail_status FROM erstattungsauftraege").kunde_mail_status, "GESENDET");
    await ruecklaufPflegen(ENV(DB), "cron-m2", spaeter(30));
    assert.equal(kundenmails(netz).length, 2);
    assert.equal(netz.mails.filter(m => /storniert/.test(m.subject)).length, 2);
  } finally {
    netz.restore();
  }
});

test("partial return with a deduction: only that piece, no shipping, reason in the mail", async () => {
  const DB = sqliteD1(allMigrations());
  seed(DB, { status: "DELIVERED", stuecke: [{ item: 9001, preis: 4000, titel: "Jacke" }, { item: 9002, preis: 2500, titel: "Hose" }] });
  const netz = fakeNetz({ katalog: [9001, 9002] });
  try {
    const anlegen = await call(DB, "/admin/orders/o1/ruecksendung", "POST", { umfang: "TEIL", teile: "Jacke" });
    assert.equal(anlegen.status, 200, JSON.stringify(anlegen.data));
    assert.equal(anlegen.data.order.status, "RETURN_REQUESTED");
    assert.equal(anlegen.data.widerrufe[0].quelle, "ADMIN");
    assert.equal(anlegen.data.widerrufe[0].umfang, "TEIL");
    const anleitung = kundenmails(netz).at(-1);
    assert.match(anleitung.subject, /So schickst du deine Bestellung D119-20260930-ABCD1234 zurück/);
    assert.match(anleitung.textContent, /Nelseestraße 25/);
    // Beim Teilwiderruf bleiben die Lagerstuecke, bis klar ist, was zurueckkommt.
    assert.equal(wert(DB, "SELECT status FROM inventory WHERE id='inv_9001'").status, "DELIVERED");

    const eingang = await call(DB, "/admin/orders/o1/ruecksendung/eingegangen", "POST", {
      artikelIds: [9001], abzugCents: 500, abzugGrund: "Fleck am Ärmel", wiederVerfuegbar: true,
    });
    assert.equal(eingang.status, 200, JSON.stringify(eingang.data));
    assert.equal(eingang.data.auftrag.status, "ERLEDIGT");
    assert.equal(eingang.data.auftrag.anlass, "WIDERRUF");
    assert.equal(eingang.data.auftrag.betragCents, 3500);
    assert.deepEqual(netz.paypal[0].body.amount, { value: "35.00", currency_code: "EUR" });
    // Teilweise erstattet: die Bestellung bleibt "Zurueckgeschickt".
    assert.equal(eingang.data.order.status, "RETURNED");
    assert.equal(wert(DB, "SELECT status FROM inventory WHERE id='inv_9001'").status, "AVAILABLE");
    assert.equal(wert(DB, "SELECT status FROM inventory WHERE id='inv_9002'").status, "DELIVERED");
    assert.equal(wert(DB, "SELECT status FROM returns").status, "CLOSED");
    assert.equal(wert(DB, "SELECT status FROM widerrufe").status, "ERLEDIGT");
    const mail = kundenmails(netz).at(-1);
    assert.match(mail.subject, /Rücksendung ist angekommen – 35,00\s€ erstattet/);
    assert.match(mail.textContent, /Fleck am Ärmel/);
    assert.match(mail.textContent, /Abzug: −5,00\s€/);
    assert.doesNotMatch(mail.textContent, /Hose/);
    const pr = netz.github.find(c => c.method === "POST" && c.path === "/git/blobs");
    const items = JSON.parse(pr.body.content);
    assert.equal(items.find(it => it.id === 9001).public_status, "AVAILABLE");
    assert.equal(items.find(it => it.id === 9002).public_status, "SOLD");
  } finally {
    netz.restore();
  }
});

test("goodwill refund: part of the price, reason required, order stays as it is", async () => {
  const DB = sqliteD1(allMigrations());
  seed(DB, { status: "DELIVERED" });
  const netz = fakeNetz();
  try {
    const ohne = await call(DB, "/admin/orders/o1/erstatten", "POST", { anlass: "KULANZ", betragCents: 300 });
    assert.equal(ohne.status, 400);
    assert.equal(ohne.data.error, "GRUND_FEHLT");
    const res = await call(DB, "/admin/orders/o1/erstatten", "POST", { anlass: "KULANZ", betragCents: 300, kundenGrund: "Kleiner Fleck, nicht beschrieben" });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    assert.equal(res.data.auftrag.status, "ERLEDIGT");
    assert.deepEqual(netz.paypal[0].body.amount, { value: "3.00", currency_code: "EUR" });
    assert.equal(res.data.order.status, "DELIVERED");
    assert.equal(netz.github.length, 0);
    const mail = kundenmails(netz).at(-1);
    assert.match(mail.subject, /Wir haben dir 3,00\s€ erstattet/);
    assert.match(mail.textContent, /Kleiner Fleck, nicht beschrieben/);
    const zuViel = await call(DB, "/admin/orders/o1/erstatten", "POST", { anlass: "KULANZ", betragCents: 5000, kundenGrund: "x" });
    assert.equal(zuViel.status, 409);
    assert.equal(zuViel.data.error, "BETRAG_ZU_HOCH");
  } finally {
    netz.restore();
  }
});

// -------------------------------------------------------------- Widerruf

test("online withdrawal of a delivered order: receipt with content, date and time; return prepared", async () => {
  const DB = sqliteD1(allMigrations());
  seed(DB, { status: "DELIVERED" });
  const netz = fakeNetz();
  try {
    const res = await widerrufen(DB, {
      name: "Kim Beispiel", email: "Kundin@Example.test", bestellnummer: " d119-20260930-abcd1234 ",
      umfang: "GANZ", nachricht: "Passt leider nicht.", bestaetigt: true,
    });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    assert.match(res.data.vorgang, /^[0-9A-F]{8}$/);
    assert.match(res.data.eingegangen, /^\d\d\.\d\d\.2026, \d\d:\d\d:\d\d MES?Z$/);
    assert.equal(res.data.bestaetigungGesendet, true);

    const w = wert(DB, "SELECT * FROM widerrufe");
    assert.equal(w.order_id, "o1");
    assert.equal(w.email, "kundin@example.test");
    assert.equal(w.bestellnummer_eingabe, NUMMER);
    assert.equal(w.quelle, "WEBSITE");
    assert.equal(w.bestaetigung_status, "GESENDET");
    assert.equal(wert(DB, "SELECT status FROM commerce_orders").status, "RETURN_REQUESTED");
    assert.equal(wert(DB, "SELECT status FROM inventory").status, "RETURN_REQUESTED");
    assert.equal(wert(DB, "SELECT status FROM returns").status, "AUTHORIZED");

    const mail = kundenmails(netz)[0];
    assert.match(mail.subject, /^Eingangsbestätigung: dein Widerruf vom \d\d\.\d\d\.2026$/);
    for (const teil of ["Name: Kim Beispiel", "E-Mail: kundin@example.test", `Bestellung: ${NUMMER}`,
      "Erklärung: Widerruf des ganzen Vertrags", "Nachricht: Passt leider nicht.", `Eingegangen: ${res.data.eingegangen}`,
      "Nelseestraße 25", "63739 Aschaffenburg", "Testjacke"]) {
      assert.ok(mail.textContent.includes(teil), `fehlt in der Bestaetigung: ${teil}`);
    }
    assert.doesNotMatch(mail.textContent, /hiermit bestätigt/i);
    assert.deepEqual(mail.bcc, [{ email: "kopie@disorder119.com" }]);
    assert.match(netz.telegram[0].text, /WIDERRUF EINGEGANGEN/);
    assert.match(netz.telegram[0].text, /Rücksendung angefragt/);

    // Doppelt abgeschickt: eine Erklaerung, eine Mail.
    const nochmal = await widerrufen(DB, {
      name: "Kim Beispiel", email: "kundin@example.test", bestellnummer: NUMMER, umfang: "GANZ", bestaetigt: true,
    });
    assert.equal(nochmal.status, 200);
    assert.equal(nochmal.data.vorgang, res.data.vorgang);
    assert.equal(wert(DB, "SELECT COUNT(*) AS n FROM widerrufe").n, 1);
    assert.equal(kundenmails(netz).length, 1);

    // Ware eingegangen: alles zurueck inklusive Versand, Stueck wieder im Shop.
    const eingang = await call(DB, "/admin/orders/o1/ruecksendung/eingegangen", "POST", {});
    assert.equal(eingang.status, 200, JSON.stringify(eingang.data));
    assert.equal(eingang.data.auftrag.betragCents, 1590);
    assert.deepEqual(netz.paypal[0].body, {});
    assert.equal(eingang.data.order.status, "REFUNDED");
    assert.equal(wert(DB, "SELECT status FROM widerrufe").status, "ERLEDIGT");
    assert.equal(wert(DB, "SELECT status FROM inventory").status, "AVAILABLE");
    assert.match(kundenmails(netz).at(-1).subject, /Rücksendung ist angekommen – 15,90\s€ erstattet/);
  } finally {
    netz.restore();
  }
});

test("withdrawal before shipping: shipping is blocked, the storno refunds and closes it", async () => {
  const DB = sqliteD1(allMigrations());
  seed(DB, { status: "PAID" });
  const netz = fakeNetz();
  try {
    const res = await widerrufen(DB, { name: "Kim", email: "kundin@example.test", bestellnummer: NUMMER, umfang: "GANZ", bestaetigt: true });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    assert.equal(wert(DB, "SELECT status FROM commerce_orders").status, "PAID");
    assert.match(kundenmails(netz)[0].textContent, /noch nicht verschickt/);
    assert.match(netz.telegram[0].text, /NOCH NICHT VERSENDET/);
    const detail = await call(DB, "/admin/orders/o1");
    assert.equal(detail.data.versandSperre.code, "WIDERRUF_VOR_VERSAND");
    await call(DB, "/admin/orders/o1", "PATCH", { status: "PREPARING" });
    const raus = await call(DB, "/admin/orders/o1", "PATCH", { status: "SHIPPED" });
    assert.equal(raus.status, 409);
    assert.equal(raus.data.error, "WIDERRUF_VOR_VERSAND");

    const storno = await call(DB, "/admin/orders/o1/stornieren", "POST", {});
    assert.equal(storno.data.auftrag.status, "ERLEDIGT");
    assert.ok(storno.data.auftrag.widerrufId);
    assert.equal(wert(DB, "SELECT status FROM widerrufe").status, "ERLEDIGT");
    assert.equal(storno.data.versandSperre, null);
    assert.match(kundenmails(netz).at(-1).subject, /storniert/);
  } finally {
    netz.restore();
  }
});

test("a declaration that matches no order is kept and confirmed without revealing anything", async () => {
  const DB = sqliteD1(allMigrations());
  seed(DB, { status: "DELIVERED" });
  const netz = fakeNetz();
  try {
    const res = await widerrufen(DB, { name: "Fremd", email: "fremd@example.test", bestellnummer: NUMMER, umfang: "GANZ", bestaetigt: true });
    assert.equal(res.status, 200);
    assert.equal(wert(DB, "SELECT order_id FROM widerrufe").order_id, null);
    assert.equal(wert(DB, "SELECT status FROM commerce_orders").status, "DELIVERED");
    const mail = netz.mails.find(m => m.to[0].email === "fremd@example.test");
    assert.match(mail.textContent, /ordnen deine Erklärung jetzt deiner Bestellung zu/);
    assert.doesNotMatch(mail.textContent, /Testjacke/);
    // In der Admin-App: zuordnen mit Vorschlag ueber die Bestellnummer.
    const liste = await call(DB, "/admin/erstattungen");
    assert.equal(liste.data.widerrufe[0].vorschlaege[0].orderId, "o1");
    const zuordnen = await call(DB, `/admin/widerrufe/${liste.data.widerrufe[0].id}`, "PATCH", { orderId: "o1" });
    assert.equal(zuordnen.status, 200, JSON.stringify(zuordnen.data));
    assert.equal(wert(DB, "SELECT status FROM commerce_orders").status, "RETURN_REQUESTED");
  } finally {
    netz.restore();
  }
});

test("the withdrawal function needs the confirmation step and the shop's own origin", async () => {
  const DB = sqliteD1(allMigrations());
  seed(DB, { status: "DELIVERED" });
  const netz = fakeNetz();
  try {
    const ohne = await widerrufen(DB, { name: "Kim", email: "kundin@example.test", bestellnummer: NUMMER });
    assert.equal(ohne.status, 400);
    assert.equal(ohne.data.error, "BESTAETIGUNG_FEHLT");
    const fremd = await widerrufen(DB, { name: "Kim", email: "kundin@example.test", bestellnummer: NUMMER, bestaetigt: true }, { origin: "https://evil.example" });
    assert.equal(fremd.status, 403);
    const teil = await widerrufen(DB, { name: "Kim", email: "kundin@example.test", bestellnummer: NUMMER, umfang: "TEIL", bestaetigt: true });
    assert.equal(teil.status, 400);
    assert.equal(teil.data.error, "TEILE_FEHLEN");
    assert.equal(wert(DB, "SELECT COUNT(*) AS n FROM widerrufe").n, 0);
    assert.equal(netz.mails.length, 0);
  } finally {
    netz.restore();
  }
});

test("declarations can neither be changed nor deleted", async () => {
  const DB = sqliteD1(allMigrations());
  seed(DB, { status: "DELIVERED" });
  const netz = fakeNetz();
  try {
    await widerrufAusKonto(ENV(DB), "o1", "konto");
    const w = wert(DB, "SELECT * FROM widerrufe");
    assert.equal(w.quelle, "KONTO");
    assert.equal(w.name, "Kim Beispiel");
    assert.throws(() => DB.raw.prepare("UPDATE widerrufe SET name='Anders'").run(), /widerruf_inhalt_unveraenderlich/);
    assert.throws(() => DB.raw.prepare("UPDATE widerrufe SET eingegangen_at='2026-01-01T00:00:00.000Z'").run(), /widerruf_inhalt_unveraenderlich/);
    assert.throws(() => DB.raw.prepare("DELETE FROM widerrufe").run(), /widerruf_muss_erhalten_bleiben/);
    assert.throws(() => DB.raw.prepare("UPDATE widerrufe SET order_id=NULL").run(), /widerruf_zuordnung_unveraenderlich/);
    DB.raw.prepare("UPDATE widerrufe SET status='IN_BEARBEITUNG',notiz='ok'").run();
    // Bestellung mit Widerruf ist ein Beleg und nie loeschbar.
    const detail = await call(DB, "/admin/orders/o1");
    assert.ok(detail.data.deletion.blockers.includes("WITHDRAWAL"));
  } finally {
    netz.restore();
  }
});

test("receipts that failed are sent later; open declarations are reminded daily", async () => {
  const DB = sqliteD1(allMigrations());
  seed(DB, { status: "DELIVERED" });
  const netz = fakeNetz({ mailFehler: 1 });
  try {
    const res = await widerrufen(DB, { name: "Fremd", email: "fremd@example.test", bestellnummer: "irgendwas", umfang: "GANZ", bestaetigt: true });
    assert.equal(res.status, 200);
    assert.equal(res.data.bestaetigungGesendet, false);
    assert.equal(wert(DB, "SELECT bestaetigung_status FROM widerrufe").bestaetigung_status, "FEHLER");
    await ruecklaufPflegen(ENV(DB), "cron-w1", spaeter(15));
    assert.equal(wert(DB, "SELECT bestaetigung_status FROM widerrufe").bestaetigung_status, "GESENDET");
    const vorher = netz.telegram.length;
    await ruecklaufPflegen(ENV(DB), "cron-w2", spaeter(25 * 60));
    assert.equal(netz.telegram.length, vorher + 1);
    assert.match(netz.telegram.at(-1).text, /WIDERRUF OFFEN/);
    await ruecklaufPflegen(ENV(DB), "cron-w3", spaeter(26 * 60));
    assert.equal(netz.telegram.length, vorher + 1);
  } finally {
    netz.restore();
  }
});

test("the cancellation policy names the online withdrawal function", () => {
  const text = widerrufsbelehrungText("kontakt@disorder119.com");
  assert.match(text, /online unter https:\/\/disorder119\.com\/widerruf\/ ausüben/);
  assert.match(text, /Eingangsbestätigung mit Informationen zum Inhalt der Widerrufserklärung sowie dem Datum und der Uhrzeit ihres Eingangs/);
});

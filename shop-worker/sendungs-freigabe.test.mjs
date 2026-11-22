// Telegram-Freigaben fuer "unterwegs", "abholbereit" und "zugestellt"
// (Inhaber 14.11.2026): je Sendung und Anlass genau eine Nachricht, keine
// Kundenmail ohne Klick, ein Klick sendet genau einmal, "Nicht senden" und der
// Ablauf nach 48 Stunden senden nichts, fremde Chats werden abgelehnt.
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { allMigrations, sqliteD1 } from "./test-d1.mjs";
import { sendungenVerfolgen, ABFRAGE_ABSTAND_MS } from "./dhl-tracking.js";
import { sendungsVerdrahtung } from "./sendungs-freigabe.js";
import { orderStatusAutomatisch } from "./admin-api.js";
import { formatStatusFreigabeMessage, notifyStatusFreigabe } from "./notifications.js";
import { handleTelegramPickupPreview, handleTelegramPickupWebhook } from "./telegram-pickup.js";
import { formatDeliveryNotice, formatShippingConfirmation } from "./customer-mail.js";

const BOT = "test-bot-token";
const CHAT = "123456";
const secret = createHash("sha256").update(`disorder119-pickup-webhook:${BOT}`).digest("hex");
const TRACKING = "00340434161094042557";
const NUMMER = "D119-20261114-FREIGABE";

function seed({ orderStatus = "PREPARING", sprache = "de", email = "kundin@example.com" } = {}) {
  const DB = sqliteD1(allMigrations());
  const now = new Date().toISOString();
  const run = (sql, ...args) => DB.raw.prepare(sql).run(...args);
  run(`INSERT INTO inventory (id,item_id,article_no,status,sale_price_cents,currency,catalog_status,version,updated_at)
    VALUES ('inv_1',6216,'213',?,7000,'EUR','SOLD',1,?)`, orderStatus, now);
  run(`INSERT INTO commerce_orders (id,order_number,status,currency,subtotal_cents,shipping_cents,total_cents,idempotency_key,created_at,sprache)
    VALUES ('o1',?,?,'EUR',7000,0,7000,'k1',?,?)`, NUMMER, orderStatus, now, sprache);
  run(`INSERT INTO order_items (id,order_id,inventory_id,item_id,article_no,title_snapshot,unit_price_cents,bild)
    VALUES ('oi1','o1','inv_1',6216,'213','Y-3 Grafik-Beanie',7000,'assets/img/6216/0.webp')`);
  run(`INSERT INTO payments (id,order_id,provider,provider_order_id,provider_payment_id,status,amount_cents,currency,idempotency_key,created_at)
    VALUES ('pay1','o1','PAYPAL','PPORDER1','CAPTURE1','COMPLETED',7000,'EUR','paypal-create:k1',?)`, now);
  run(`INSERT INTO order_contact_snapshots (order_id,source_provider,email,recipient_name,address_line1,postal_code,city,country_code,captured_at)
    VALUES ('o1','PAYPAL',?,'Julian Kolk','Schleiermacher Straße 21','28201','Bremen','DE',?)`, email, now);
  run(`INSERT INTO shipments (id,order_id,carrier,service,tracking_number,status,created_at,updated_at)
    VALUES ('s1','o1','DHL','Online-Frankierung',?,'LABEL_CREATED',?,?)`, TRACKING, now, now);
  run(`INSERT INTO audit_events (id,actor_type,entity_type,entity_id,event_type,request_id,metadata_json,created_at)
    VALUES ('notify:telegram:chat:joelb119','SYSTEM','telegram','joelb119','TELEGRAM_CHAT_CONNECTED','r',?,?)`, JSON.stringify({ chatId: CHAT }), now);
  return DB;
}

function umgebung(DB, extra = {}) {
  return { DB, TELEGRAM_BOT_TOKEN: BOT, MAIL_API_KEY: "k", MAIL_FROM: "shop@disorder119.com", MAIL_FROM_NAME: "D119",
    DHL_PAKET_TRACKING_API_KEY: "tracking-key", DHL_PAKET_TRACKING_API_SECRET: "secret", ...extra };
}

// Telegram und der Mailanbieter laufen ueber globalThis.fetch; alles andere ist offline.
function transport() {
  const calls = [], original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url), body = init.body ? JSON.parse(init.body) : {};
    calls.push({ url: u, body });
    if (u.includes("api.telegram.org")) return Response.json({ ok: true, result: { message_id: 7 } });
    if (u.includes("brevo")) return Response.json({ messageId: "mail1" });
    return new Response("offline", { status: 503 });
  };
  return {
    calls,
    mails: () => calls.filter(c => c.url.includes("brevo")),
    fotos: () => calls.filter(c => c.url.endsWith("sendPhoto")),
    antwort: () => calls.filter(c => c.url.endsWith("answerCallbackQuery")).at(-1)?.body.text,
    restore: () => { globalThis.fetch = original; },
  };
}

function dhl(statusCode, text) {
  return async () => {
    const escape = v => String(v || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;");
    const delivered = /delivered/i.test(statusCode) ? "1" : "0";
    return new Response(`<data name="piece-status-public-list" code="0"><data name="piece-status-public" status="${escape(text)}" standard-event-code="${escape(statusCode)}" delivery-event-flag="${delivered}" last-event-timestamp="14.11.2026 08:00"/></data>`);
  };
}

const UNTERWEGS = ["transit", "Die Sendung wurde im Paketzentrum bearbeitet."];
const ABHOLBEREIT = ["transit", "Die Sendung liegt in der PACKSTATION 234 in 63739 Aschaffenburg zur Abholung bereit."];
const ZUGESTELLT = ["delivered", "Die Sendung wurde erfolgreich zugestellt."];

let lauf = 0;
async function cron(env, [code, text], versatz = 0) {
  lauf += 1;
  return sendungenVerfolgen(env, `cron-${lauf}`, Date.now() + versatz, { ...sendungsVerdrahtung(env, `cron-${lauf}`), fetchImpl: dhl(code, text), warten: async () => {} });
}

function knopf(foto, art) {
  const reihen = foto.body.reply_markup.inline_keyboard.map(r => r[0]);
  if (art === "vorschau") return reihen.find(k => k.url)?.url;
  return reihen.find(k => String(k.callback_data || "").startsWith(`${art}:`))?.callback_data;
}

function klick(data, { chat = CHAT, from = CHAT, header = secret } = {}) {
  return new Request("https://api.disorder119.com/telegram/pickup-webhook", {
    method: "POST", headers: { "X-Telegram-Bot-Api-Secret-Token": header },
    body: JSON.stringify({ callback_query: { id: "cb1", data, from: { id: Number(from) }, message: { message_id: 7, chat: { id: Number(chat), type: "private" } } } }),
  });
}

const status = DB => DB.raw.prepare("SELECT status FROM commerce_orders WHERE id='o1'").get().status;
const ereignis = (DB, like) => DB.raw.prepare("SELECT event_type FROM audit_events WHERE id LIKE ? ORDER BY created_at").all(like).map(r => r.event_type);

test("unterwegs: Status springt, aber die Versandmail wartet auf den Klick", async () => {
  const io = transport();
  try {
    const DB = seed();
    const env = umgebung(DB);
    const r = await cron(env, UNTERWEGS);
    assert.deepEqual(r.versendet, ["o1"]);
    assert.equal(status(DB), "SHIPPED");
    assert.equal(DB.raw.prepare("SELECT status FROM shipments WHERE id='s1'").get().status, "SHIPPED");
    assert.equal(io.mails().length, 0, "keine Versandmail von selbst");
    assert.equal(io.fotos().length, 1, "genau eine Telegram-Nachricht");
    const foto = io.fotos()[0];
    assert.equal(foto.body.chat_id, CHAT);
    assert.equal(foto.body.photo, "https://disorder119.com/assets/og/6216.jpg");
    assert.match(foto.body.caption, /UNTERWEGS · D119-20261114-FREIGABE/);
    assert.match(foto.body.caption, /Für Julian Kolk/);
    assert.match(foto.body.caption, /Y-3 Grafik-Beanie/);
    assert.match(foto.body.caption, /Das Paket ist bei DHL unterwegs/);
    assert.match(foto.body.caption, new RegExp(TRACKING));
    assert.match(foto.body.caption, /48 Stunden/);
    assert.deepEqual(foto.body.reply_markup.inline_keyboard.map(z => z[0].text), ["✉️ E-Mail-Vorschau ansehen", "✅ Kundenmail senden", "✖️ Nicht senden"]);
    const senden = knopf(foto, "pickup");
    const vorschauUrl = knopf(foto, "vorschau");
    assert.match(senden, /^pickup:[a-f0-9]{32}$/);
    assert.equal(vorschauUrl, `https://api.disorder119.com/telegram/pickup-preview/${senden.slice(7)}`);
    assert.doesNotMatch(vorschauUrl + senden, /Kolk|kundin|D119-2026/, "nur der Zufallstoken in Link und Knopf");

    // Spaetere Cron-Laeufe, DHL meldet weiter "unterwegs": keine zweite Nachricht.
    await cron(env, UNTERWEGS, ABFRAGE_ABSTAND_MS + 1000);
    await cron(env, UNTERWEGS, 2 * ABFRAGE_ABSTAND_MS + 2000);
    assert.equal(io.fotos().length, 1);
    assert.equal(io.mails().length, 0);

    // Vorschau: die exakte Mail, strenge Kopfzeilen, kein Versand.
    const vorschau = await handleTelegramPickupPreview(new URL(vorschauUrl), env);
    assert.equal(vorschau.status, 200);
    assert.equal(vorschau.headers.get("Cache-Control"), "no-store, private");
    assert.equal(vorschau.headers.get("X-Frame-Options"), "DENY");
    assert.match(vorschau.headers.get("Content-Security-Policy"), /default-src 'none'/);
    const vorschauHtml = await vorschau.text();
    assert.match(vorschauHtml, /Deine Bestellung geht jetzt zu dir/);
    assert.match(vorschauHtml, new RegExp(TRACKING));
    assert.equal(io.mails().length, 0, "Vorschau sendet nie");
    assert.deepEqual(ereignis(DB, "notify:email:shipped:%"), [], "Vorschau belegt keinen Versand-Anspruch");

    // Falsches Geheimnis, fremder Chat, fremder Absender: abgelehnt, nichts gesendet.
    assert.equal((await handleTelegramPickupWebhook(klick(senden, { header: "falsch" }), env)).status, 403);
    assert.equal((await handleTelegramPickupWebhook(klick(senden, { chat: "999", from: "999" }), env)).status, 403);
    assert.equal((await handleTelegramPickupWebhook(klick(senden, { from: "999" }), env)).status, 403);
    assert.equal(io.mails().length, 0);

    // Klick des Inhabers: genau eine Mail - dieselbe wie in der Vorschau.
    assert.equal((await handleTelegramPickupWebhook(klick(senden), env)).status, 200);
    assert.equal(io.mails().length, 1);
    assert.equal(io.mails()[0].body.subject, `Deine Bestellung ${NUMMER} geht jetzt zu dir`);
    assert.equal(io.mails()[0].body.to[0].email, "kundin@example.com");
    assert.equal(io.mails()[0].body.htmlContent, vorschauHtml);
    assert.equal(io.antwort(), "Kundenmail gesendet.");
    assert.deepEqual(ereignis(DB, "notify:email:shipped:%"), ["SHIPPING_NOTICE_SENT"]);
    assert.deepEqual(ereignis(DB, "notify:telegram:pickup:%"), ["SHIPPED_APPROVAL_SENT"]);
    assert.equal(DB.raw.prepare("SELECT COUNT(*) AS n FROM postausgang WHERE tag='shipping-confirmation'").get().n, 1, "im Postausgang protokolliert");
    assert.ok(io.calls.some(c => c.url.endsWith("editMessageReplyMarkup")), "Knoepfe verschwinden");
    assert.ok(io.calls.some(c => c.url.endsWith("sendMessage") && /Versandmail für Bestellung D119-20261114-FREIGABE gesendet/.test(c.body.text)));

    // Doppelklick und spaeteres "Nicht senden": nichts weiter.
    await handleTelegramPickupWebhook(klick(senden), env);
    assert.equal(io.antwort(), "Mail wurde bereits gesendet.");
    await handleTelegramPickupWebhook(klick(knopf(foto, "pickup-no")), env);
    assert.equal(io.mails().length, 1);
    assert.equal((await handleTelegramPickupPreview(new URL(vorschauUrl), env)).status, 404, "erledigte Freigabe zeigt keine Vorschau mehr");
  } finally { io.restore(); }
});

test("'Nicht senden' schliesst die Freigabe sofort - danach geht nichts mehr raus", async () => {
  const io = transport();
  try {
    const DB = seed();
    const env = umgebung(DB);
    await cron(env, UNTERWEGS);
    const foto = io.fotos()[0];
    const nein = knopf(foto, "pickup-no");
    assert.match(nein, /^pickup-no:[a-f0-9]{32}$/);
    assert.equal((await handleTelegramPickupWebhook(klick(nein, { from: "999" }), env)).status, 403);
    assert.deepEqual(ereignis(DB, "notify:telegram:pickup:%"), ["SHIPPED_APPROVAL_PENDING"]);
    assert.equal((await handleTelegramPickupWebhook(klick(nein), env)).status, 200);
    assert.equal(io.antwort(), "Nicht gesendet.");
    assert.deepEqual(ereignis(DB, "notify:telegram:pickup:%"), ["SHIPPED_APPROVAL_DECLINED"]);
    await handleTelegramPickupWebhook(klick(knopf(foto, "pickup")), env);
    assert.match(io.antwort(), /geschlossen/);
    assert.equal(io.mails().length, 0);
    assert.equal((await handleTelegramPickupPreview(new URL(knopf(foto, "vorschau")), env)).status, 404);
    // Auch der naechste Cron-Lauf fragt nicht noch einmal.
    await cron(env, UNTERWEGS, ABFRAGE_ABSTAND_MS + 1000);
    assert.equal(io.fotos().length, 1);
    assert.equal(io.mails().length, 0);
  } finally { io.restore(); }
});

test("ohne Klick laeuft die Freigabe nach 48 Stunden ab - nichts wird gesendet", async () => {
  const io = transport();
  try {
    const DB = seed();
    const env = umgebung(DB);
    await cron(env, UNTERWEGS);
    const foto = io.fotos()[0];
    DB.raw.prepare("UPDATE audit_events SET created_at=? WHERE id LIKE 'notify:telegram:pickup:%'").run(new Date(Date.now() - 49 * 3_600_000).toISOString());
    await handleTelegramPickupWebhook(klick(knopf(foto, "pickup")), env);
    assert.match(io.antwort(), /abgelaufen/);
    assert.equal(io.mails().length, 0);
    assert.equal((await handleTelegramPickupPreview(new URL(knopf(foto, "vorschau")), env)).status, 404);
    await cron(env, UNTERWEGS, ABFRAGE_ABSTAND_MS + 1000);
    assert.equal(io.fotos().length, 1, "abgelaufen heisst nicht: noch einmal fragen");
    assert.equal(io.mails().length, 0);
  } finally { io.restore(); }
});

test("zugestellt: eigene Freigabe, Mail nur nach Klick und nur solange 'Zugestellt' gilt", async () => {
  const io = transport();
  try {
    const DB = seed();
    const env = umgebung(DB);
    await cron(env, UNTERWEGS);
    const r = await cron(env, ZUGESTELLT, ABFRAGE_ABSTAND_MS + 1000);
    assert.deepEqual(r.zugestellt, ["o1"]);
    assert.equal(status(DB), "DELIVERED");
    assert.equal(io.mails().length, 0);
    assert.equal(io.fotos().length, 2, "je Anlass eine Nachricht");
    const [unterwegs, zugestellt] = io.fotos();
    assert.match(zugestellt.body.caption, /ZUGESTELLT · D119-20261114-FREIGABE/);
    assert.match(zugestellt.body.caption, /Das Paket wurde zugestellt/);
    assert.match(zugestellt.body.caption, /Zustellmail/);

    // Die alte "unterwegs"-Freigabe sendet nach der Zustellung nichts mehr.
    await handleTelegramPickupWebhook(klick(knopf(unterwegs, "pickup")), env);
    assert.match(io.antwort(), /nicht mehr unterwegs/);
    assert.equal(io.mails().length, 0);

    const vorschau = await handleTelegramPickupPreview(new URL(knopf(zugestellt, "vorschau")), env);
    assert.equal(vorschau.status, 200);
    const html = await vorschau.text();
    assert.match(html, /Dein Paket ist angekommen/);
    assert.match(html, /mail-zustellung/);
    assert.equal(io.mails().length, 0);

    await handleTelegramPickupWebhook(klick(knopf(zugestellt, "pickup")), env);
    assert.equal(io.mails().length, 1);
    assert.equal(io.mails()[0].body.subject, `Dein Paket ist angekommen – Bestellung ${NUMMER}`);
    assert.equal(io.mails()[0].body.htmlContent, html);
    assert.deepEqual(io.mails()[0].body.tags, ["delivery-notice"]);
    assert.deepEqual(ereignis(DB, "notify:email:delivered:%"), ["DELIVERY_NOTICE_SENT"]);
    assert.equal(DB.raw.prepare("SELECT COUNT(*) AS n FROM postausgang WHERE tag='delivery-notice'").get().n, 1);
    await handleTelegramPickupWebhook(klick(knopf(zugestellt, "pickup")), env);
    assert.equal(io.mails().length, 1, "Doppelklick sendet nie zweimal");
    // Zugestellte Sendungen fragt der Cron nicht mehr ab: keine weitere Nachricht.
    await cron(env, ZUGESTELLT, 3 * ABFRAGE_ABSTAND_MS);
    assert.equal(io.fotos().length, 2);
  } finally { io.restore(); }

  // Rueckgabe zwischen Meldung und Klick: keine "Viel Freude"-Mail mehr.
  const io2 = transport();
  try {
    const DB = seed({ orderStatus: "PAID" });
    const env = umgebung(DB);
    const r = await cron(env, ZUGESTELLT);
    assert.deepEqual(r.versendet, ["o1"]);
    assert.equal(status(DB), "DELIVERED");
    assert.equal(io2.fotos().length, 1, "direkt zugestellt: nur die Zustell-Freigabe, keine Versandmail mehr anbieten");
    assert.match(io2.fotos()[0].body.caption, /ZUGESTELLT/);
    DB.raw.prepare("UPDATE commerce_orders SET status='RETURN_REQUESTED' WHERE id='o1'").run();
    await handleTelegramPickupWebhook(klick(knopf(io2.fotos()[0], "pickup")), env);
    assert.match(io2.antwort(), /nicht mehr als zugestellt/);
    assert.equal(io2.mails().length, 0);
    assert.equal((await handleTelegramPickupPreview(new URL(knopf(io2.fotos()[0], "vorschau")), env)).status, 404);
  } finally { io2.restore(); }
});

test("abholbereit: eine Nachricht mit Station, Mail nur nach Klick; keine zusaetzliche Versand-Freigabe", async () => {
  const io = transport();
  try {
    const DB = seed();
    const env = umgebung(DB);
    const r = await cron(env, ABHOLBEREIT);
    assert.deepEqual(r.abholbereit, ["o1"]);
    assert.equal(status(DB), "SHIPPED");
    assert.equal(io.mails().length, 0);
    assert.equal(io.fotos().length, 1);
    const foto = io.fotos()[0];
    assert.match(foto.body.caption, /ABHOLBEREIT · D119-20261114-FREIGABE/);
    assert.match(foto.body.caption, /Packstation 234 · Aschaffenburg/);
    assert.equal(foto.body.reply_markup.inline_keyboard.length, 3);
    // Ein zweiter Aufruf fuer dieselbe Sendung (z. B. Status flackert) fragt nicht noch einmal.
    const doppelt = await notifyStatusFreigabe(env, "ABHOLBEREIT", { order_id: "o1", shipment_id: "s1", tracking_number: TRACKING }, { abholort: { typ: "packstation", nummer: "234" } });
    assert.equal(doppelt.duplicate, true);
    await cron(env, ABHOLBEREIT, ABFRAGE_ABSTAND_MS + 1000);
    assert.equal(io.fotos().length, 1);
    DB.raw.prepare("UPDATE sendungs_abfragen SET zuletzt_am=? WHERE shipment_id='s1'").run(new Date().toISOString());
    await handleTelegramPickupWebhook(klick(knopf(foto, "pickup")), env);
    assert.equal(io.mails().length, 1);
    assert.match(io.mails()[0].body.subject, /abholbereit/);
    assert.match(io.mails()[0].body.htmlContent, /Packstation 234/);
    assert.deepEqual(ereignis(DB, "notify:telegram:pickup:%"), ["PICKUP_APPROVAL_SENT"]);
  } finally { io.restore(); }
});

test("aeltere Abhol-Freigaben (ohne Anlass in den Metadaten) funktionieren weiter", async () => {
  const io = transport();
  try {
    const DB = seed({ orderStatus: "SHIPPED" });
    const env = umgebung(DB);
    const now = new Date().toISOString();
    DB.raw.prepare("INSERT INTO sendungs_abfragen (shipment_id,tracking_number,zustand,status_text,abfragen,zuletzt_am,geaendert_am) VALUES ('s1',?,'ABHOLBEREIT',?,1,?,?)").run(TRACKING, ABHOLBEREIT[1], now, now);
    const token = "ab".repeat(16);
    DB.raw.prepare(`INSERT INTO audit_events (id,actor_type,entity_type,entity_id,event_type,request_id,metadata_json,created_at)
      VALUES (?,'SYSTEM','order','o1','PICKUP_APPROVAL_PENDING','alt',?,?)`).run(`notify:telegram:pickup:${token}`, JSON.stringify({ shipmentId: "s1", chatId: CHAT }), now);
    const vorschau = await handleTelegramPickupPreview(new URL(`https://api.disorder119.com/telegram/pickup-preview/${token}`), env);
    assert.equal(vorschau.status, 200);
    assert.match(await vorschau.text(), /mail-station/);
    await handleTelegramPickupWebhook(klick(`pickup:${token}`), env);
    assert.equal(io.mails().length, 1);
    assert.match(io.mails()[0].body.subject, /abholbereit/);
    // Ein Zustand, der nicht zum Anlass passt, ist ungueltig (kein Umbiegen per Metadaten).
    const fremd = "cd".repeat(16);
    DB.raw.prepare(`INSERT INTO audit_events (id,actor_type,entity_type,entity_id,event_type,request_id,metadata_json,created_at)
      VALUES (?,'SYSTEM','order','o1','PICKUP_APPROVAL_PENDING','alt',?,?)`).run(`notify:telegram:pickup:${fremd}`, JSON.stringify({ anlass: "VERSENDET", shipmentId: "s1", chatId: CHAT }), now);
    await handleTelegramPickupWebhook(klick(`pickup:${fremd}`), env);
    assert.equal(io.antwort(), "Freigabe nicht mehr gültig.");
    assert.equal(io.mails().length, 1);
  } finally { io.restore(); }
});

test("Klick in der Admin-App mailt weiter sofort; die Sendungsverfolgung fragt dann nicht mehr", async () => {
  const io = transport();
  try {
    const DB = seed();
    const env = umgebung(DB);
    // Standardweg (Admin-Knopf, Packlink): Versandmail sofort.
    await orderStatusAutomatisch(env, "o1", "SHIPPED", "manuell");
    assert.equal(io.mails().length, 1);
    assert.match(io.mails()[0].body.subject, /geht jetzt zu dir/);
    await cron(env, UNTERWEGS);
    assert.equal(io.fotos().length, 0, "Mail ist schon raus: keine Freigabe anbieten");
    assert.equal(io.mails().length, 1);
  } finally { io.restore(); }
});

test("Telegram faellt aus: nichts geht an die Kundschaft, der naechste Lauf fragt erneut", async () => {
  const io = transport();
  const haupt = globalThis.fetch;
  try {
    const DB = seed();
    const env = umgebung(DB);
    globalThis.fetch = async (url, init) => String(url).includes("api.telegram.org") ? new Response("down", { status: 502 }) : haupt(url, init);
    const r = await cron(env, UNTERWEGS);
    assert.deepEqual(r.versendet, ["o1"], "der Statuswechsel haengt nicht an Telegram");
    assert.equal(status(DB), "SHIPPED");
    assert.equal(io.mails().length, 0);
    assert.deepEqual(ereignis(DB, "notify:telegram:%"), ["TELEGRAM_CHAT_CONNECTED"], "kein Merker, keine offene Freigabe");
    globalThis.fetch = haupt;
    await cron(env, UNTERWEGS, ABFRAGE_ABSTAND_MS + 1000);
    assert.equal(io.fotos().length, 1);
    assert.equal(io.mails().length, 0);
  } finally { io.restore(); }
});

test("ohne Kundenadresse gibt es nichts freizugeben", async () => {
  const io = transport();
  try {
    const DB = seed({ email: "" });
    const env = umgebung(DB);
    await cron(env, UNTERWEGS);
    assert.equal(status(DB), "SHIPPED");
    assert.equal(io.fotos().length, 0);
    assert.equal(io.mails().length, 0);
  } finally { io.restore(); }
});

test("Verdrahtung: echter Server ohne automatische Versandmail, Testshop wie bisher", async () => {
  const echt = sendungsVerdrahtung({}, "r");
  assert.deepEqual(Object.keys(echt).sort(), ["abholbereitMelden", "statusSetzen", "versendetMelden", "zugestelltMelden"]);
  const testshop = sendungsVerdrahtung({ SANDBOX: "1" }, "r");
  assert.deepEqual(Object.keys(testshop).sort(), ["abholbereitMelden", "statusSetzen"]);
  const io = transport();
  try {
    const DB = seed();
    const env = umgebung(DB, { SANDBOX: "1", SANDBOX_MAIL_AN: "test@disorder119.com" });
    await cron(env, UNTERWEGS);
    assert.equal(status(DB), "SHIPPED");
    assert.equal(io.fotos().length, 0, "Testshop: keine Freigabe, die niemand bestaetigen koennte");
    assert.equal(io.mails().length, 1, "Testshop: Versandmail wie bisher sofort");
    assert.equal(io.mails()[0].body.to[0].email, "test@disorder119.com");
    assert.ok(io.mails()[0].body.subject.startsWith("[TEST] "));
  } finally { io.restore(); }
  const quelle = fs.readFileSync(new URL("./worker-entry.js", import.meta.url), "utf8");
  assert.match(quelle, /sendungenVerfolgen\(env, reqId, scheduledTime, sendungsVerdrahtung\(env, reqId\)\)/);
  assert.doesNotMatch(quelle, /orderStatusAutomatisch/, "der Cron setzt den Status nur noch ueber die Verdrahtung");
});

test("Telegram-Texte der drei Anlaesse", () => {
  const order = { order_number: NUMMER, kunde: "Julian Kolk", titel: "Y-3 Grafik-Beanie", tracking: TRACKING };
  assert.equal(formatStatusFreigabeMessage("VERSENDET", order, { text: UNTERWEGS[1] }), [
    "🚚 UNTERWEGS · D119-20261114-FREIGABE",
    "Für Julian Kolk",
    "Y-3 Grafik-Beanie",
    "Status: Das Paket ist bei DHL unterwegs.",
    "DHL meldet: Die Sendung wurde im Paketzentrum bearbeitet.",
    "Sendungsnummer 00340434161094042557",
    "",
    "Die Versandmail geht erst nach deiner Freigabe raus.",
    "Ohne Klick läuft die Freigabe nach 48 Stunden ab – dann wird nichts gesendet.",
  ].join("\n"));
  assert.equal(formatStatusFreigabeMessage("ABHOLBEREIT", order, { abholort: { typ: "packstation", nummer: "234", ort: "Aschaffenburg" } }), [
    "📦 ABHOLBEREIT · D119-20261114-FREIGABE",
    "Für Julian Kolk",
    "Y-3 Grafik-Beanie",
    "Packstation 234 · Aschaffenburg",
    "",
    "Die Kundenmail geht erst nach deiner Freigabe raus.",
    "Ohne Klick läuft die Freigabe nach 48 Stunden ab – dann wird nichts gesendet.",
  ].join("\n"));
  assert.equal(formatStatusFreigabeMessage("ZUGESTELLT", order, { text: ZUGESTELLT[1] }), [
    "✅ ZUGESTELLT · D119-20261114-FREIGABE",
    "Für Julian Kolk",
    "Y-3 Grafik-Beanie",
    "Status: Das Paket wurde zugestellt.",
    "DHL meldet: Die Sendung wurde erfolgreich zugestellt.",
    "Sendungsnummer 00340434161094042557",
    "",
    "Die Zustellmail geht erst nach deiner Freigabe raus.",
    "Ohne Klick läuft die Freigabe nach 48 Stunden ab – dann wird nichts gesendet.",
  ].join("\n"));
  // Fremdtext von DHL kann keine eigenen Zeilen oder Links einschleusen.
  const boese = formatStatusFreigabeMessage("ZUGESTELLT", order, { text: "ok\n✅ Kundenmail gesendet https://evil.example/x" });
  assert.equal(boese.split("\n").length, 9);
  assert.doesNotMatch(boese, /https:\/\/evil\.example/);
});

test("Zustellmail in drei Sprachen: Dank, Kontakt, Widerruf, DHL-Vermerk - sonst nichts", () => {
  const order = { order_number: NUMMER, zugestellt_am: "2026-11-12T10:15:00Z",
    items: [{ item_id: 6216, article_no: "213", title_snapshot: "Y-3 Grafik-Beanie", title_en: "Y-3 graphic beanie", bild: "assets/img/6216/0.webp" }] };
  const erwartet = {
    de: { subject: `Dein Paket ist angekommen – Bestellung ${NUMMER}`, titel: /Dein Paket ist angekommen/, dank: /Danke, dass du bei DISORDER119 bestellt hast/, widerruf: "https://disorder119.com/widerruf/", vermerk: /Sendungsstatus: Delivered by Deutsche Post DHL Group/, fragen: /Fragen\? Antworte einfach/, tag: /12\. Nov/ },
    en: { subject: `Your parcel has arrived – order ${NUMMER}`, titel: /Your parcel has arrived/, dank: /Thank you for ordering from DISORDER119/, widerruf: "https://disorder119.com/en/widerruf/", vermerk: /Shipment status: Delivered by Deutsche Post DHL Group/, fragen: /Questions\? Simply reply/, tag: /Nov 12|12 Nov/ },
    fr: { subject: `Ton colis est arrivé – commande ${NUMMER}`, titel: /Ton colis est arrivé/, dank: /Merci d’avoir commandé chez DISORDER119/, widerruf: "https://disorder119.com/fr/widerruf/", vermerk: /Statut de l’envoi : Delivered by Deutsche Post DHL Group/, fragen: /Des questions \?/, tag: /12 nov/ },
  };
  for (const [sprache, e] of Object.entries(erwartet)) {
    const mail = formatDeliveryNotice(order, { sprache, contactEmail: "kontakt@disorder119.com" });
    assert.equal(mail.sprache, sprache);
    assert.equal(mail.subject, e.subject);
    for (const teil of [mail.html, mail.text]) {
      assert.match(teil, e.dank);
      assert.match(teil, e.vermerk);
      assert.match(teil, e.fragen);
      assert.ok(teil.includes(`${e.widerruf}?bestellung=${NUMMER}`), `${sprache}: Widerrufslink mit Bestellnummer`);
      assert.match(teil, /kontakt@disorder119\.com/);
      assert.doesNotMatch(teil, /bewert|reviews?|avis|rabatt|discount|gutschein|coupon|code promo|trustpilot/i, `${sprache}: keine Bewertungsbitte, keine Rabatte`);
    }
    assert.match(mail.html, e.titel);
    assert.match(mail.html, new RegExp(`<html lang="${sprache}">`));
    assert.match(mail.html, /https:\/\/disorder119\.com\/assets\/img\/6216\/0\.webp/, "mit Produktfoto");
    assert.match(mail.html, /Archive No\. 213/);
    assert.match(mail.html, e.tag, "Tag der Zustellung");
    assert.match(mail.html, sprache === "en" ? /Y-3 graphic beanie/ : /Y-3 Grafik-Beanie/);
  }
  // Mehrere Teile: Liste statt nur Motiv; Fremdtext wird escaped.
  const zwei = formatDeliveryNotice({ order_number: NUMMER, items: [
    { item_id: 1, article_no: "1", title_snapshot: "<script>alert(1)</script>", bild: "assets/img/1/0.webp" },
    { item_id: 2, article_no: "2", title_snapshot: "Zweites Teil", bild: "assets/img/2/0.webp" }] }, { sprache: "de" });
  assert.doesNotMatch(zwei.html, /<script>alert/);
  assert.match(zwei.html, /&lt;script&gt;/);
  assert.match(zwei.html, /Zweites Teil/);
  assert.match(zwei.text, /deinen Teilen/);
  // Gleiches Muster wie die Versandmail: derselbe Widerrufssatz.
  const versand = formatShippingConfirmation({ order_number: NUMMER, items: order.items }, { sprache: "de" });
  assert.match(versand.text, /Innerhalb von 14 Tagen nach Erhalt/);
  assert.match(formatDeliveryNotice(order, { sprache: "de" }).text, /Innerhalb von 14 Tagen nach Erhalt/);
});

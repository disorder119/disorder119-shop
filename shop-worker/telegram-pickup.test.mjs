import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { allMigrations, sqliteD1 } from "./test-d1.mjs";
import { notifyPickupReady, formatPickupReadyMessage } from "./notifications.js";
import { handleTelegramPickupWebhook, ensureTelegramPickupWebhook } from "./telegram-pickup.js";
import { abholortFuerMail } from "./customer-mail.js";

const BOT = "test-bot-token";
const CHAT = "123456";
const secret = createHash("sha256").update(`disorder119-pickup-webhook:${BOT}`).digest("hex");
const TRACKING = "00340434161094042557";

function seed({ status = "SHIPPED", trackingState = "ABHOLBEREIT", text = "Die Sendung liegt in der PACKSTATION 234 in 63739 Aschaffenburg zur Abholung bereit." } = {}) {
  const DB = sqliteD1(allMigrations());
  const now = new Date().toISOString();
  const run = (sql, ...args) => DB.raw.prepare(sql).run(...args);
  run("INSERT INTO inventory (id,item_id,article_no,status,sale_price_cents,currency,catalog_status,version,updated_at) VALUES ('inv_1',6232,'229',?,24000,'EUR','SOLD',1,?)", status, now);
  run("INSERT INTO commerce_orders (id,order_number,status,currency,subtotal_cents,shipping_cents,total_cents,idempotency_key,created_at) VALUES ('o1','D119-20261110-TEST1',?,'EUR',24000,0,24000,'k1',?)", status, now);
  run("INSERT INTO order_items (id,order_id,inventory_id,item_id,article_no,title_snapshot,unit_price_cents,bild) VALUES ('oi1','o1','inv_1',6232,'229','Prada Sneaker',24000,'assets/img/6232/0.webp')");
  run("INSERT INTO order_contact_snapshots (order_id,source_provider,email,recipient_name,address_line1,postal_code,city,country_code,captured_at) VALUES ('o1','PAYPAL','test@example.com','Mara Test','Packstation 119','63739','Aschaffenburg','DE',?)", now);
  run("INSERT INTO shipments (id,order_id,carrier,service,tracking_number,status,created_at,updated_at) VALUES ('s1','o1','DHL','Paket',?,?,?,?)", TRACKING, status, now, now);
  run("INSERT INTO sendungs_abfragen (shipment_id,tracking_number,zustand,status_text,abfragen,zuletzt_am,geaendert_am) VALUES ('s1',?,?,?,1,?,?)", TRACKING, trackingState, text, now, now);
  run("INSERT INTO audit_events (id,actor_type,entity_type,entity_id,event_type,request_id,metadata_json,created_at) VALUES ('notify:telegram:chat:joelb119','SYSTEM','telegram','joelb119','TELEGRAM_CHAT_CONNECTED','r',?,?)", JSON.stringify({ chatId: CHAT }), now);
  return DB;
}

function transport() {
  const calls = [], original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url), body = init.body ? JSON.parse(init.body) : {};
    calls.push({ url: u, body });
    if (u.includes("api.telegram.org")) return Response.json({ ok: true, result: u.endsWith("getWebhookInfo") ? { url: "" } : { message_id: 3 } });
    if (u.includes("brevo")) return Response.json({ messageId: "mail1" });
    return new Response("offline", { status: 503 });
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

function request(token, { chat = CHAT, from = CHAT, header = secret } = {}) {
  return new Request("https://api.disorder119.com/telegram/pickup-webhook", {
    method: "POST", headers: { "X-Telegram-Bot-Api-Secret-Token": header },
    body: JSON.stringify({ callback_query: { id: "cb1", data: `pickup:${token}`, from: { id: Number(from) }, message: { chat: { id: Number(chat), type: "private" } } } }),
  });
}

test("five simulated pickup cases and Telegram approval", async t => {
  const io = transport();
  try {
    await t.test("1 DHL Packstation 234 wins over delivery address 119; one mail after approval", async () => {
      const DB = seed();
      const env = { DB, TELEGRAM_BOT_TOKEN: BOT, MAIL_API_KEY: "k", MAIL_FROM: "shop@disorder119.com", MAIL_FROM_NAME: "D119" };
      const notice = await notifyPickupReady(env, { order_id: "o1", shipment_id: "s1" }, { abholort: { typ: "packstation", nummer: "234", ort: "Aschaffenburg" } }, "r1");
      assert.equal(notice.sent, true);
      const photo = io.calls.find(c => c.url.endsWith("sendPhoto"));
      assert.match(photo.body.caption, /Mara Test/);
      assert.match(photo.body.caption, /Packstation 234/);
      const token = photo.body.reply_markup.inline_keyboard[1][0].callback_data.slice(7);
      assert.match(token, /^[a-f0-9]{32}$/);
      assert.equal((await handleTelegramPickupWebhook(request(token, { header: "wrong" }), env)).status, 403);
      assert.equal((await handleTelegramPickupWebhook(request(token, { from: "9" }), env)).status, 403);
      assert.equal(io.calls.filter(c => c.url.includes("brevo")).length, 0);
      assert.equal((await handleTelegramPickupWebhook(request(token), env)).status, 200);
      const mails = io.calls.filter(c => c.url.includes("brevo"));
      assert.equal(mails.length, 1);
      assert.match(mails[0].body.htmlContent, /Packstation 234/i);
      assert.doesNotMatch(mails[0].body.htmlContent, /Packstation 119/i);
      await handleTelegramPickupWebhook(request(token), env);
      assert.equal(io.calls.filter(c => c.url.includes("brevo")).length, 1, "double click never resends");
    });
    await t.test("2 post office includes known number", () => {
      assert.match(formatPickupReadyMessage({ order_number: "TEST", titel: "Y-3 Mütze" }, { typ: "filiale", nummer: "45", ort: "Berlin" }), /Postfiliale 45 · Berlin/);
    });
    await t.test("3 missing station number is not invented", () => {
      const msg = formatPickupReadyMessage({ order_number: "TEST" }, { typ: "packstation", ort: "Hamburg" });
      assert.match(msg, /Packstation \/ Filiale/);
      assert.doesNotMatch(msg, /119|234/);
      assert.equal(abholortFuerMail({ address_line1: "Packstation 119", city: "Hamburg" }, { typ: "packstation" }).nummer, "");
    });
    await t.test("4 delivered before button press never mails", async () => {
      const DB = seed();
      const env = { DB, TELEGRAM_BOT_TOKEN: BOT, MAIL_API_KEY: "k", MAIL_FROM: "shop@disorder119.com", MAIL_FROM_NAME: "D119" };
      await notifyPickupReady(env, { order_id: "o1", shipment_id: "s1" }, { abholort: { typ: "packstation", nummer: "234" } });
      const token = io.calls.filter(c => c.url.endsWith("sendPhoto")).at(-1).body.reply_markup.inline_keyboard[1][0].callback_data.slice(7);
      DB.raw.prepare("UPDATE commerce_orders SET status='DELIVERED' WHERE id='o1'").run();
      const count = io.calls.filter(c => c.url.includes("brevo")).length;
      await handleTelegramPickupWebhook(request(token), env);
      assert.equal(io.calls.filter(c => c.url.includes("brevo")).length, count);
    });
    await t.test("5 setup registers webhook only for linked owner", async () => {
      const DB = seed();
      const env = { DB, TELEGRAM_BOT_TOKEN: BOT };
      assert.equal((await ensureTelegramPickupWebhook(env)).installed, true);
      assert.equal(io.calls.filter(c => c.url.endsWith("setWebhook")).at(-1).body.secret_token, secret);
      assert.equal((await ensureTelegramPickupWebhook(env)).ready, true);
    });
  } finally { io.restore(); }
});

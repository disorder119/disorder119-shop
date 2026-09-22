import assert from "node:assert/strict";
import test from "node:test";
import {
  formatSaleMessage,
  formatTelegramTestMessage,
  sendTelegramTest,
  telegramNotificationReady,
  telegramTransportReady,
} from "./notifications.js";

function telegramLinkDb() {
  let storedMetadata = null;
  return {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async first() {
              if (String(sql).includes("SELECT metadata_json FROM audit_events")) {
                return storedMetadata ? { metadata_json: storedMetadata } : null;
              }
              return null;
            },
            async run() {
              if (String(sql).includes("INSERT OR REPLACE INTO audit_events")) {
                storedMetadata = String(args[3] || "");
              }
              return { meta: { changes: 1 } };
            },
          };
        },
      };
    },
  };
}

test("telegram readiness separates transport from paid-order DB readiness", () => {
  assert.equal(telegramTransportReady({}), false);
  assert.equal(telegramTransportReady({ TELEGRAM_BOT_TOKEN: "x", TELEGRAM_CHAT_ID: "1" }), true);
  assert.equal(telegramTransportReady({ TELEGRAM_BOT_TOKEN: "x", DB: {} }), true);
  assert.equal(telegramNotificationReady({ TELEGRAM_BOT_TOKEN: "x", TELEGRAM_CHAT_ID: "1" }), false);
  assert.equal(telegramNotificationReady({ DB: {}, TELEGRAM_BOT_TOKEN: "x" }), true);
});

test("sale message contains operational data but no customer PII", () => {
  const message = formatSaleMessage({
    id: "order-1",
    order_number: "D119-260922-ABC123",
    article_no: "119-42",
    title_snapshot: "Prada Reversible Jacket",
    total_cents: 38000,
    currency: "EUR",
    guest_email: "customer@example.com",
    recipient_name: "Private Customer",
    address_line1: "Secret Street 1",
  });
  assert.match(message, /D119-260922-ABC123/);
  assert.match(message, /Prada Reversible Jacket/);
  assert.match(message, /380/);
  assert.doesNotMatch(message, /customer@example\.com/);
  assert.doesNotMatch(message, /Private Customer/);
  assert.doesNotMatch(message, /Secret Street/);
});

test("test message is explicit and contains no customer data", () => {
  const message = formatTelegramTestMessage(new Date("2026-09-22T19:30:00.000Z"));
  assert.match(message, /DISORDER119 — TELEGRAM TEST/);
  assert.match(message, /Verbindung funktioniert/);
  assert.match(message, /2026-09-22T19:30:00\.000Z/);
});

test("sendTelegramTest calls Telegram Bot API with configured private chat id", async () => {
  const originalFetch = globalThis.fetch;
  let seenUrl = "";
  let seenBody = null;
  globalThis.fetch = async (url, options) => {
    seenUrl = String(url);
    seenBody = JSON.parse(String(options?.body || "{}"));
    return new Response(JSON.stringify({ ok: true, result: { message_id: 119 } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  try {
    const result = await sendTelegramTest({
      TELEGRAM_BOT_TOKEN: "fake-bot-token",
      TELEGRAM_CHAT_ID: "99887766",
    }, "req-test-1");
    assert.equal(result.sent, true);
    assert.equal(result.messageId, 119);
    assert.equal(result.requestId, "req-test-1");
    assert.equal(seenUrl, "https://api.telegram.org/botfake-bot-token/sendMessage");
    assert.equal(seenBody.chat_id, "99887766");
    assert.match(seenBody.text, /DISORDER119 — TELEGRAM TEST/);
    assert.equal(seenBody.disable_web_page_preview, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("sendTelegramTest auto-links private @joelb119 chat from /start update and caches it in D1", async () => {
  const originalFetch = globalThis.fetch;
  const db = telegramLinkDb();
  let getUpdatesCalls = 0;
  const sentBodies = [];
  globalThis.fetch = async (url, options) => {
    const target = String(url);
    if (target.endsWith("/getUpdates")) {
      getUpdatesCalls += 1;
      return new Response(JSON.stringify({
        ok: true,
        result: [{
          update_id: 1,
          message: {
            message_id: 10,
            text: "/start",
            from: { id: 77119, username: "joelb119" },
            chat: { id: 77119, username: "joelb119", type: "private" },
          },
        }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (target.endsWith("/sendMessage")) {
      sentBodies.push(JSON.parse(String(options?.body || "{}")));
      return new Response(JSON.stringify({ ok: true, result: { message_id: 120 + sentBodies.length } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    throw new Error("unexpected Telegram API method");
  };

  try {
    const env = { TELEGRAM_BOT_TOKEN: "fake-bot-token", DB: db };
    const first = await sendTelegramTest(env, "req-auto-link-1");
    const second = await sendTelegramTest(env, "req-auto-link-2");
    assert.equal(first.sent, true);
    assert.equal(second.sent, true);
    assert.equal(getUpdatesCalls, 1);
    assert.equal(sentBodies.length, 2);
    assert.equal(String(sentBodies[0].chat_id), "77119");
    assert.equal(String(sentBodies[1].chat_id), "77119");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("sendTelegramTest returns TARGET_NOT_CONNECTED before @joelb119 starts the bot", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    if (String(url).endsWith("/getUpdates")) {
      return new Response(JSON.stringify({ ok: true, result: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    throw new Error("sendMessage should not run without a linked target");
  };
  try {
    const result = await sendTelegramTest({ TELEGRAM_BOT_TOKEN: "fake-bot-token", DB: telegramLinkDb() }, "req-no-start");
    assert.deepEqual(result, { sent: false, reason: "TARGET_NOT_CONNECTED" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("sendTelegramTest fails closed when Telegram is not configured", async () => {
  const result = await sendTelegramTest({}, "req-test-2");
  assert.deepEqual(result, { sent: false, reason: "NOT_CONFIGURED" });
});

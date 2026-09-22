import assert from "node:assert/strict";
import test from "node:test";
import {
  formatSaleMessage,
  formatTelegramTestMessage,
  sendTelegramTest,
  telegramNotificationReady,
  telegramTransportReady,
} from "./notifications.js";

test("telegram readiness separates transport from paid-order DB readiness", () => {
  assert.equal(telegramTransportReady({}), false);
  assert.equal(telegramTransportReady({ TELEGRAM_BOT_TOKEN: "x", TELEGRAM_CHAT_ID: "1" }), true);
  assert.equal(telegramNotificationReady({ TELEGRAM_BOT_TOKEN: "x", TELEGRAM_CHAT_ID: "1" }), false);
  assert.equal(telegramNotificationReady({ DB: {}, TELEGRAM_BOT_TOKEN: "x", TELEGRAM_CHAT_ID: "1" }), true);
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
      TELEGRAM_BOT_TOKEN: "123456:TEST_ONLY_TOKEN_VALUE",
      TELEGRAM_CHAT_ID: "99887766",
    }, "req-test-1");
    assert.equal(result.sent, true);
    assert.equal(result.messageId, 119);
    assert.equal(result.requestId, "req-test-1");
    assert.match(seenUrl, /^https:\/\/api\.telegram\.org\/bot123456:TEST_ONLY_TOKEN_VALUE\/sendMessage$/);
    assert.equal(seenBody.chat_id, "99887766");
    assert.match(seenBody.text, /DISORDER119 — TELEGRAM TEST/);
    assert.equal(seenBody.disable_web_page_preview, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("sendTelegramTest fails closed when Telegram is not configured", async () => {
  const result = await sendTelegramTest({}, "req-test-2");
  assert.deepEqual(result, { sent: false, reason: "NOT_CONFIGURED" });
});

import assert from "node:assert/strict";
import test from "node:test";
import { formatSaleMessage, telegramNotificationReady } from "./notifications.js";

test("telegram readiness requires DB and both Telegram secrets", () => {
  assert.equal(telegramNotificationReady({}), false);
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

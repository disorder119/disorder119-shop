import assert from "node:assert/strict";
import test from "node:test";
import { handleAdminNotifications } from "./admin-notifications.js";

const ORIGIN = "https://admin.disorder119.com";
const URL = new URL("https://worker.example/admin/notifications/telegram/test");

function request(method = "POST", token = "owner-test-token") {
  return new Request(URL, {
    method,
    headers: {
      Origin: ORIGIN,
      Authorization: `Bearer ${token}`,
    },
  });
}

test("Telegram admin test endpoint sends through configured transport", async () => {
  const originalFetch = globalThis.fetch;
  let body = null;
  globalThis.fetch = async (_url, options) => {
    body = JSON.parse(String(options?.body || "{}"));
    return new Response(JSON.stringify({ ok: true, result: { message_id: 42 } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  try {
    const response = await handleAdminNotifications(request(), {
      ADMIN_TOKEN: "owner-test-token",
      TELEGRAM_BOT_TOKEN: "fake-bot-token",
      TELEGRAM_CHAT_ID: "99887766",
    }, URL, "req-admin-test", ORIGIN);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.sent, true);
    assert.equal(payload.messageId, 42);
    assert.equal(body.chat_id, "99887766");
    assert.match(body.text, /DISORDER119 — TELEGRAM TEST/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Telegram admin test endpoint rejects wrong admin token", async () => {
  const response = await handleAdminNotifications(request("POST", "wrong"), {
    ADMIN_TOKEN: "owner-test-token",
    TELEGRAM_BOT_TOKEN: "fake-bot-token",
    TELEGRAM_CHAT_ID: "99887766",
  }, URL, "req-admin-unauthorized", ORIGIN);
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error, "UNAUTHORIZED");
});

test("Telegram admin test endpoint reports missing Telegram configuration", async () => {
  const response = await handleAdminNotifications(request(), {
    ADMIN_TOKEN: "owner-test-token",
  }, URL, "req-admin-not-configured", ORIGIN);
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, "TELEGRAM_NOT_CONFIGURED");
});

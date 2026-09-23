import assert from "node:assert/strict";
import test from "node:test";
import { handleAdminNotifications } from "./admin-notifications.js";

const ORIGIN = "https://admin.disorder119.com";
const TEST_URL = new URL("https://worker.example/admin/notifications/telegram/test");

function request(method = "POST", token = "owner-test-token") {
  return new Request(TEST_URL, {
    method,
    headers: {
      Origin: ORIGIN,
      Authorization: `Bearer ${token}`,
    },
  });
}

function emptyLinkDb() {
  return {
    prepare() {
      return {
        bind() {
          return {
            async first() { return null; },
            async run() { return { meta: { changes: 1 } }; },
          };
        },
      };
    },
  };
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
    }, TEST_URL, "req-admin-test", ORIGIN);
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
  }, TEST_URL, "req-admin-unauthorized", ORIGIN);
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error, "UNAUTHORIZED");
});

test("Telegram admin test endpoint reports missing Telegram configuration", async () => {
  const response = await handleAdminNotifications(request(), {
    ADMIN_TOKEN: "owner-test-token",
  }, TEST_URL, "req-admin-not-configured", ORIGIN);
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, "TELEGRAM_NOT_CONFIGURED");
});

test("Telegram admin test endpoint tells owner to start @joelb119 bot before auto-link", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    if (String(url).endsWith("/getUpdates")) {
      return new Response(JSON.stringify({ ok: true, result: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    throw new Error("unexpected Telegram method");
  };
  try {
    const response = await handleAdminNotifications(request(), {
      ADMIN_TOKEN: "owner-test-token",
      TELEGRAM_BOT_TOKEN: "fake-bot-token",
      DB: emptyLinkDb(),
    }, TEST_URL, "req-admin-unlinked", ORIGIN);
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error, "TELEGRAM_TARGET_NOT_CONNECTED");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

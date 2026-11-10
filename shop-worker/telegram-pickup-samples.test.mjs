import assert from "node:assert/strict";
import test from "node:test";
import { pickupSamples, sendQueuedPickupSamples } from "./telegram-pickup-samples.js";

test("five clearly labelled Telegram samples send once and never call customer mail", async () => {
  const samples = pickupSamples();
  assert.equal(samples.length, 5);
  assert(samples.every(s => /TESTMUSTER \d\/5/.test(s.caption) && /keine Kundenmail/.test(s.caption)));
  const calls = [];
  const original = globalThis.fetch;
  let state = "PICKUP_SAMPLES_QUEUED", meta = null;
  const DB = { prepare(sql) { return { bind(...args) { return { async run() {
    if (sql.includes("SET event_type='PICKUP_SAMPLES_SENDING'")) {
      if (state !== "PICKUP_SAMPLES_QUEUED") return { meta: { changes: 0 } };
      state = "PICKUP_SAMPLES_SENDING";
    } else if (sql.includes("SET event_type='PICKUP_SAMPLES_SENT'")) {
      state = "PICKUP_SAMPLES_SENT"; meta = args[0];
    } else if (sql.includes("SET metadata_json")) meta = args[0];
    return { meta: { changes: 1 } };
  } }; } }; } };
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) });
    return Response.json({ ok: true, result: { message_id: calls.length } });
  };
  try {
    const env = { DB, TELEGRAM_BOT_TOKEN: "bot", TELEGRAM_CHAT_ID: "123" };
    assert.deepEqual(await sendQueuedPickupSamples(env, "test"), { sent: 5 });
    assert.equal(calls.length, 5);
    assert(calls.every(c => c.url.endsWith("/sendPhoto") && c.body.chat_id === "123"));
    assert.equal(JSON.parse(meta).sent, 5);
    assert.deepEqual(await sendQueuedPickupSamples(env, "test"), { skipped: true });
    assert.equal(calls.length, 5);
  } finally { globalThis.fetch = original; }
});

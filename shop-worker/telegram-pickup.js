import { safeText } from "./commerce-core.js";
import { resolveTelegramChatId, telegramApi, sendTelegramMessage } from "./notifications.js";
import { sendPickupReady } from "./customer-mail.js";

const WEBHOOK_URL = "https://api.disorder119.com/telegram/pickup-webhook";
const WEBHOOK_MARKER = "telegram:pickup:webhook:installed";

export function isTelegramPickupWebhook(url) {
  return url.pathname === "/telegram/pickup-webhook";
}

async function webhookSecret(token) {
  const bytes = new TextEncoder().encode(`disorder119-pickup-webhook:${token}`);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), x => x.toString(16).padStart(2, "0")).join("");
}

function equalSecret(a, b) {
  const x = String(a || ""), y = String(b || "");
  if (x.length !== y.length || x.length !== 64) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

// Einmalig durch den Cron registrieren; einen fremden Webhook nie ersetzen.
export async function ensureTelegramPickupWebhook(env, reqId = crypto.randomUUID()) {
  if (!env?.DB || !env?.TELEGRAM_BOT_TOKEN) return { skipped: true };
  const existing = await env.DB.prepare("SELECT id FROM audit_events WHERE id=? LIMIT 1").bind(WEBHOOK_MARKER).first();
  if (existing) return { ready: true };
  const chatId = await resolveTelegramChatId(env, reqId);
  if (!chatId) return { skipped: true, reason: "TARGET_NOT_CONNECTED" };
  const info = await telegramApi(env, "getWebhookInfo");
  const current = String(info?.result?.url || "");
  if (current && current !== WEBHOOK_URL) return { skipped: true, reason: "OTHER_WEBHOOK" };
  const response = await telegramApi(env, "setWebhook", {
    url: WEBHOOK_URL,
    secret_token: await webhookSecret(env.TELEGRAM_BOT_TOKEN),
    allowed_updates: ["callback_query"],
    drop_pending_updates: false,
  });
  if (!response?.ok) throw new Error("TELEGRAM_WEBHOOK_SETUP");
  await env.DB.prepare(`INSERT OR IGNORE INTO audit_events
    (id,actor_type,entity_type,entity_id,event_type,request_id,metadata_json,created_at)
    VALUES (?,'SYSTEM','telegram',?,'TELEGRAM_WEBHOOK_CONNECTED',?,?,?)`)
    .bind(WEBHOOK_MARKER, "pickup", safeText(reqId, 120), JSON.stringify({ url: WEBHOOK_URL }), new Date().toISOString()).run();
  return { ready: true, installed: true };
}

export async function handleTelegramPickupWebhook(request, env, reqId = crypto.randomUUID()) {
  if (request.method !== "POST") return new Response("Not found", { status: 404 });
  if (!env?.DB || !env?.TELEGRAM_BOT_TOKEN || !equalSecret(request.headers.get("X-Telegram-Bot-Api-Secret-Token"), await webhookSecret(env.TELEGRAM_BOT_TOKEN))) {
    return new Response("Forbidden", { status: 403 });
  }
  if (Number(request.headers.get("Content-Length") || 0) > 32_768) return new Response("Too large", { status: 413 });
  const raw = await request.text();
  if (raw.length > 32_768) return new Response("Too large", { status: 413 });
  let update;
  try { update = JSON.parse(raw); } catch { return new Response("Bad request", { status: 400 }); }
  const callback = update?.callback_query;
  const token = /^pickup:([a-f0-9]{32})$/.exec(String(callback?.data || ""))?.[1];
  if (!token) return new Response("OK");
  const chatId = String(callback?.message?.chat?.id || "");
  const ownerChatId = await resolveTelegramChatId(env, reqId);
  if (!ownerChatId || chatId !== String(ownerChatId) || String(callback?.from?.id || "") !== String(ownerChatId) || callback?.message?.chat?.type !== "private") {
    return new Response("Forbidden", { status: 403 });
  }
  const rowId = `notify:telegram:pickup:${token}`;
  const row = await env.DB.prepare("SELECT entity_id,event_type,metadata_json,created_at FROM audit_events WHERE id=? LIMIT 1").bind(rowId).first();
  let answer = "Freigabe nicht mehr gültig.";
  if (row?.event_type === "PICKUP_APPROVAL_SENT") answer = "Mail wurde bereits gesendet.";
  else if (row?.event_type === "PICKUP_APPROVAL_PENDING" && Date.now() - Date.parse(row.created_at) <= 48 * 3_600_000) {
    let meta = {};
    try { meta = JSON.parse(row.metadata_json || "{}"); } catch { /* ungueltiger Datensatz */ }
    if (String(meta.chatId || "") === chatId && meta.shipmentId) {
      const claimed = await env.DB.prepare("UPDATE audit_events SET event_type='PICKUP_APPROVAL_CLAIMED' WHERE id=? AND event_type='PICKUP_APPROVAL_PENDING'").bind(rowId).run();
      if (claimed?.meta?.changes) {
        try {
          const result = await sendPickupReady(env, row.entity_id, { reqId, requireReady: true, expectedShipmentId: meta.shipmentId });
          if (result.sent || result.duplicate) {
            await env.DB.prepare("UPDATE audit_events SET event_type='PICKUP_APPROVAL_SENT' WHERE id=? AND event_type='PICKUP_APPROVAL_CLAIMED'").bind(rowId).run();
            answer = result.sent ? "Kundenmail gesendet." : "Mail war bereits gesendet.";
            if (result.sent) await sendTelegramMessage(env, `✅ Abholmail für Bestellung gesendet.`, reqId).catch(() => {});
          } else {
            answer = result.reason === "PICKUP_NOT_CURRENT" ? "DHL meldet diese Sendung nicht mehr als abholbereit." : "Kundenmail nicht gesendet. Bitte in der Admin-App prüfen.";
            await env.DB.prepare("UPDATE audit_events SET event_type='PICKUP_APPROVAL_PENDING' WHERE id=? AND event_type='PICKUP_APPROVAL_CLAIMED'").bind(rowId).run();
          }
        } catch (err) {
          await env.DB.prepare("UPDATE audit_events SET event_type='PICKUP_APPROVAL_PENDING' WHERE id=? AND event_type='PICKUP_APPROVAL_CLAIMED'").bind(rowId).run().catch(() => {});
          console.error(JSON.stringify({ event: "pickup_approval_failed", requestId: reqId, code: safeText(err?.message || "", 80) }));
          answer = "Versand fehlgeschlagen. Bitte in der Admin-App prüfen.";
        }
      } else answer = "Freigabe wird bereits verarbeitet.";
    }
  }
  await telegramApi(env, "answerCallbackQuery", { callback_query_id: String(callback.id), text: answer, show_alert: false }).catch(() => {});
  return new Response("OK");
}

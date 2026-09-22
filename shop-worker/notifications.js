import { safeText } from "./commerce-core.js";

const TELEGRAM_API = "https://api.telegram.org";

export function telegramTransportReady(env = {}) {
  return Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID);
}

export function telegramNotificationReady(env = {}) {
  return Boolean(telegramTransportReady(env) && env.DB);
}

function euroAmount(cents, currency = "EUR") {
  const amount = Number(cents || 0) / 100;
  try {
    return new Intl.NumberFormat("de-DE", { style: "currency", currency: currency || "EUR" }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency || "EUR"}`;
  }
}

export function formatSaleMessage(order = {}) {
  const number = safeText(order.order_number || order.orderNumber || order.id || "", 80) || "—";
  const article = safeText(order.article_no || order.articleNo || "", 80);
  const title = safeText(order.title_snapshot || order.title || "Verkauf", 180) || "Verkauf";
  const amount = euroAmount(order.total_cents ?? order.totalCents, order.currency || "EUR");
  return [
    "DISORDER119 — SALE",
    `Order: ${number}`,
    article ? `Artikel: ${article}` : null,
    `Piece: ${title}`,
    `Betrag: ${amount}`,
    "Zahlung: PayPal bestätigt",
  ].filter(Boolean).join("\n");
}

export function formatTelegramTestMessage(now = new Date()) {
  const timestamp = now instanceof Date && !Number.isNaN(now.getTime())
    ? now.toISOString()
    : new Date().toISOString();
  return [
    "DISORDER119 — TELEGRAM TEST",
    "Status: Verbindung funktioniert",
    `Zeit: ${timestamp}`,
    "Künftige bestätigte Verkäufe können hier automatisch gemeldet werden.",
  ].join("\n");
}

export async function sendTelegramMessage(env, text) {
  if (!telegramTransportReady(env)) return { sent: false, reason: "NOT_CONFIGURED" };
  const cleanText = safeText(text, 4096);
  if (!cleanText) return { sent: false, reason: "EMPTY_MESSAGE" };

  let response;
  try {
    response = await fetch(`${TELEGRAM_API}/bot${String(env.TELEGRAM_BOT_TOKEN)}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: String(env.TELEGRAM_CHAT_ID),
        text: cleanText,
        disable_web_page_preview: true,
      }),
    });
  } catch (err) {
    throw new Error(`telegram_network_error:${safeText(err?.message || "unknown", 80)}`);
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.ok === false) {
    const description = safeText(payload?.description || `HTTP ${response.status}`, 120);
    throw new Error(`telegram_api_error:${description}`);
  }

  return {
    sent: true,
    messageId: Number(payload?.result?.message_id || 0) || null,
  };
}

export async function sendTelegramTest(env, reqId = crypto.randomUUID()) {
  const result = await sendTelegramMessage(env, formatTelegramTestMessage(new Date()));
  if (!result.sent) return result;
  return { ...result, requestId: safeText(reqId, 120) };
}

async function claimDelivery(env, orderId, reqId) {
  const claimId = `notify:telegram:sale:${orderId}`;
  const result = await env.DB.prepare(`INSERT OR IGNORE INTO audit_events
    (id,actor_type,entity_type,entity_id,event_type,request_id,metadata_json,created_at)
    VALUES (?,'SYSTEM','order',?,'SALE_NOTIFICATION_CLAIMED',?,?,?)`)
    .bind(claimId, String(orderId), reqId, JSON.stringify({ channel: "telegram" }), new Date().toISOString())
    .run();
  return { claimId, claimed: Boolean(result?.meta?.changes) };
}

async function releaseFailedClaim(env, claimId) {
  try {
    await env.DB.prepare("DELETE FROM audit_events WHERE id=? AND event_type='SALE_NOTIFICATION_CLAIMED'")
      .bind(claimId).run();
  } catch {
    // A failed notification must never break a paid checkout.
  }
}

async function markDelivered(env, claimId) {
  await env.DB.prepare("UPDATE audit_events SET event_type='SALE_NOTIFICATION_SENT',metadata_json=? WHERE id=?")
    .bind(JSON.stringify({ channel: "telegram", sentAt: new Date().toISOString() }), claimId).run();
}

async function loadPaidOrder(env, orderId) {
  return env.DB.prepare(`SELECT o.id,o.order_number,o.status,o.total_cents,o.currency,
      oi.article_no,oi.title_snapshot
    FROM commerce_orders o
    LEFT JOIN order_items oi ON oi.order_id=o.id
    WHERE o.id=?
    ORDER BY oi.id
    LIMIT 1`).bind(String(orderId)).first();
}

export async function notifyPaidOrder(env, orderId, reqId = crypto.randomUUID()) {
  if (!telegramNotificationReady(env)) return { sent: false, reason: "NOT_CONFIGURED" };
  const row = await loadPaidOrder(env, orderId);
  if (!row) return { sent: false, reason: "ORDER_NOT_FOUND" };
  if (!["PAID", "PREPARING", "SHIPPED", "DELIVERED", "RETURN_REQUESTED", "RETURNED"].includes(String(row.status || "").toUpperCase())) {
    return { sent: false, reason: "ORDER_NOT_PAID" };
  }

  const claim = await claimDelivery(env, row.id, reqId);
  if (!claim.claimed) return { sent: false, duplicate: true };

  try {
    const delivery = await sendTelegramMessage(env, formatSaleMessage(row));
    if (!delivery.sent) throw new Error(delivery.reason || "telegram_not_sent");
  } catch (err) {
    await releaseFailedClaim(env, claim.claimId);
    throw new Error(`telegram_sale_notification_failed:${safeText(err?.message || "unknown", 120)}`);
  }

  // Once Telegram has accepted the message, keep the claim even if this bookkeeping
  // write fails. That favors at-most-once customer-independent alerts over duplicates.
  try {
    await markDelivered(env, claim.claimId);
    return { sent: true, recorded: true };
  } catch {
    return { sent: true, recorded: false };
  }
}

export async function notifyPaidOrderByProviderOrder(env, providerOrderId, reqId = crypto.randomUUID()) {
  if (!telegramNotificationReady(env)) return { sent: false, reason: "NOT_CONFIGURED" };
  const payment = await env.DB.prepare(`SELECT order_id FROM payments
    WHERE provider='PAYPAL' AND provider_order_id=? LIMIT 1`)
    .bind(safeText(providerOrderId, 128)).first();
  if (!payment?.order_id) return { sent: false, reason: "ORDER_NOT_FOUND" };
  return notifyPaidOrder(env, payment.order_id, reqId);
}

import { safeText } from "./commerce-core.js";
import { resolveTelegramChatId, telegramApi, sendTelegramMessage, sendTelegramPhoto, verkaufsBild, formatPickupReadyMessage } from "./notifications.js";
import { formatPickupReady, sendPickupReady } from "./customer-mail.js";
import { katalogNachId } from "./oeffentlicher-katalog.js";

const WEBHOOK_URL = "https://api.disorder119.com/telegram/pickup-webhook";
const WEBHOOK_MARKER = "telegram:pickup:webhook:installed";

export function isTelegramPickupWebhook(url) {
  return url.pathname === "/telegram/pickup-webhook";
}

export function isTelegramPickupPreview(url) {
  return /^\/telegram\/pickup-preview\/[a-f0-9]{32}$/.test(url.pathname);
}

function previewToken(url) {
  return /^\/telegram\/pickup-preview\/([a-f0-9]{32})$/.exec(url.pathname)?.[1] || "";
}

function previewHeaders() {
  return {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store, private",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Content-Security-Policy": "default-src 'none'; img-src https://disorder119.com data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  };
}

function randomToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), x => x.toString(16).padStart(2, "0")).join("");
}

function pickupTestNotice(html) {
  const note = "TESTVORSCHAU: Dies ist nur die Vorschau. Es wird keine Abholmail an einen Kunden gesendet.";
  return String(html || "").replace(/(<body[^>]*>)/i, `$1<div style="background:#f6e8a5;color:#111;padding:12px;text-align:center;font:700 13px Arial,sans-serif">${note}</div>`);
}

function testItemData(item) {
  const bild = safeText(Array.isArray(item?.gallery) ? item.gallery[0] : item?.bild || "", 240);
  return {
    item_id: Number(item?.id),
    article_no: safeText(item?.article || item?.article_no || item?.url_slug || "", 40),
    title_snapshot: safeText(item?.title || "DISORDER119 Testartikel", 180),
    title_en: safeText(item?.title_en || "", 180),
    brand: safeText(item?.brand || "", 60),
    size: safeText(item?.size || "", 40),
    bild,
  };
}

function pickupTestOrder(meta = {}) {
  return {
    order_number: safeText(meta.orderNumber || "D119-TEST-ABHOLUNG", 80),
    carrier: "DHL",
    tracking_number: safeText(meta.trackingNumber || "00340434161094042557", 60),
    items: [meta.item || {}],
  };
}

function pickupTestMail(env, meta) {
  const order = pickupTestOrder(meta);
  const message = formatPickupReady(order, {
    contactEmail: safeText(env?.MAIL_REPLY_TO || env?.MAIL_FROM || "kontakt@disorder119.com", 200),
    sprache: "de",
    abholort: meta.abholort || { typ: "packstation", nummer: "119", ort: "Aschaffenburg" },
  });
  return { ...message, html: pickupTestNotice(message.html) };
}

// Der Test aus der Admin-App ist absichtlich derselbe Telegram-Weg wie eine
// echte Abholmeldung: Foto, Stationsinfo und zwei Knöpfe. Nur die Freigabe
// endet bei einem Test immer ohne Mailversand.
export async function sendTelegramPickupTest(env, reqId = crypto.randomUUID()) {
  if (!env?.DB || !env?.TELEGRAM_BOT_TOKEN) return { sent: false, reason: "NOT_CONFIGURED" };
  const chatId = await resolveTelegramChatId(env, reqId);
  if (!chatId) return { sent: false, reason: "TARGET_NOT_CONNECTED" };
  let katalog;
  try { katalog = await katalogNachId({ env, fetcher: env.KATALOG_FETCH || null }); } catch { katalog = new Map(); }
  const source = katalog.get(6232) || [...katalog.values()].find(item => item && Array.isArray(item.gallery) && item.gallery.length);
  if (!source) return { sent: false, reason: "NO_ITEM" };
  const item = testItemData(source);
  if (!Number.isInteger(item.item_id) || item.item_id <= 0 || !item.bild) return { sent: false, reason: "NO_ITEM" };
  const token = randomToken();
  const id = `notify:telegram:pickup:${token}`;
  const meta = {
    chatId: String(chatId), item,
    orderNumber: "D119-TEST-ABHOLUNG",
    trackingNumber: "00340434161094042557",
    abholort: { typ: "packstation", nummer: "119", ort: "Aschaffenburg" },
  };
  await env.DB.prepare(`INSERT INTO audit_events (id,actor_type,entity_type,entity_id,event_type,request_id,metadata_json,created_at)
    VALUES (?,'SYSTEM','telegram','pickup-test','PICKUP_TEST_PENDING',?,?,?)`)
    .bind(id, safeText(reqId, 120), JSON.stringify(meta), new Date().toISOString()).run();
  const previewUrl = `https://api.disorder119.com/telegram/pickup-preview/${token}`;
  const caption = `🧪 TEST · so erscheint eine echte Abholmeldung\n\n${formatPickupReadyMessage({ order_number: meta.orderNumber, titel: item.title_snapshot }, meta.abholort)}\n\nDer Vorschau-Knopf öffnet die vollständige Kundenmail. Der Senden-Knopf bleibt im Test ohne Kundenmail.`;
  const result = await sendTelegramPhoto(env, verkaufsBild({ items: [item] }), caption, reqId, [
    { text: "✉️ E-Mail-Vorschau ansehen", url: previewUrl },
    { text: "✅ Kundenmail senden", callback_data: `pickup-test:${token}` },
  ]);
  if (!result.sent) await env.DB.prepare("DELETE FROM audit_events WHERE id=? AND event_type='PICKUP_TEST_PENDING'").bind(id).run().catch(() => {});
  return result;
}

// Der Link in Telegram ist eine zufaellige, einmalige Kennung. Er zeigt die
// fertige Kundenmail nur, solange DHL die zugehoerige Sendung noch aktuell als
// abholbereit meldet. Die Vorschau fuehrt keinen Versand aus.
export async function handleTelegramPickupPreview(url, env, reqId = crypto.randomUUID()) {
  const token = previewToken(url);
  if (!token || !env?.DB) return new Response("Not found", { status: 404 });
  const id = `notify:telegram:pickup:${token}`;
  const row = await env.DB.prepare("SELECT entity_id,event_type,metadata_json,created_at FROM audit_events WHERE id=? LIMIT 1").bind(id).first();
  if (!row || !["PICKUP_APPROVAL_PENDING", "PICKUP_TEST_PENDING"].includes(row.event_type) || !Number.isFinite(Date.parse(row.created_at)) || Date.now() - Date.parse(row.created_at) > 48 * 3_600_000) {
    return new Response("Not found", { status: 404 });
  }
  let meta = {};
  try { meta = JSON.parse(row.metadata_json || "{}"); } catch { return new Response("Not found", { status: 404 }); }
  if (row.event_type === "PICKUP_TEST_PENDING") {
    if (String(meta.chatId || "") !== String(await resolveTelegramChatId(env, reqId)) || !meta.item) return new Response("Not found", { status: 404 });
    return new Response(pickupTestMail(env, meta).html, { status: 200, headers: previewHeaders() });
  }
  if (!meta.shipmentId) return new Response("Not found", { status: 404 });
  const draft = await sendPickupReady(env, row.entity_id, { reqId, vorschau: true, requireReady: true, expectedShipmentId: meta.shipmentId });
  if (!draft.vorschau) return new Response("Not found", { status: 404 });
  return new Response(draft.html, { status: 200, headers: previewHeaders() });
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
  const parsed = /^(pickup(?:-test)?):([a-f0-9]{32})$/.exec(String(callback?.data || ""));
  if (!parsed) return new Response("OK");
  const kind = parsed[1];
  const token = parsed[2];
  const chatId = String(callback?.message?.chat?.id || "");
  const ownerChatId = await resolveTelegramChatId(env, reqId);
  if (!ownerChatId || chatId !== String(ownerChatId) || String(callback?.from?.id || "") !== String(ownerChatId) || callback?.message?.chat?.type !== "private") {
    return new Response("Forbidden", { status: 403 });
  }
  const rowId = `notify:telegram:pickup:${token}`;
  const row = await env.DB.prepare("SELECT entity_id,event_type,metadata_json,created_at FROM audit_events WHERE id=? LIMIT 1").bind(rowId).first();
  let answer = "Freigabe nicht mehr gültig.";
  if (kind === "pickup-test") {
    if (row?.event_type === "PICKUP_TEST_PENDING" && Date.now() - Date.parse(row.created_at) <= 48 * 3_600_000) {
      let meta = {};
      try { meta = JSON.parse(row.metadata_json || "{}"); } catch { /* ungueltiger Datensatz */ }
      if (String(meta.chatId || "") === chatId) answer = "Test bestätigt: Keine Kundenmail wurde gesendet.";
    }
  } else if (row?.event_type === "PICKUP_APPROVAL_SENT") answer = "Mail wurde bereits gesendet.";
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

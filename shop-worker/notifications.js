import { istSandbox, sandboxTelegramText } from "./sandbox.js";
import { safeText } from "./commerce-core.js";

const TELEGRAM_API = "https://api.telegram.org";
const DEFAULT_TARGET_USERNAME = "joelb119";

function normalizedUsername(value) {
  return safeText(value || DEFAULT_TARGET_USERNAME, 64).replace(/^@+/, "").trim().toLowerCase();
}

export function telegramTransportReady(env = {}) {
  return Boolean(env.TELEGRAM_BOT_TOKEN && (env.TELEGRAM_CHAT_ID || env.DB));
}

export function telegramNotificationReady(env = {}) {
  return Boolean(env.TELEGRAM_BOT_TOKEN && env.DB);
}

function euroAmount(cents, currency = "EUR") {
  const amount = Number(cents || 0) / 100;
  try {
    return new Intl.NumberFormat("de-DE", { style: "currency", currency: currency || "EUR" }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency || "EUR"}`;
  }
}

// Admin-App direkt auf dieser Bestellung (?bestellung=<id>) - am iPhone aus
// Telegram heraus, dort dann "Warenkorb bei DHL anlegen".
export const ADMIN_APP_URL = "https://admin.disorder119.com/";
export function adminBestellungLink(order = {}, { dhl = false } = {}) {
  const id = safeText(order.id || "", 80);
  if (!id) return ADMIN_APP_URL;
  return `${ADMIN_APP_URL}?bestellung=${encodeURIComponent(id)}${dhl ? "&dhl=1" : ""}`;
}

// Vorschaubild des verkauften Teils: das Link-Vorschaubild (assets/og/<id>.jpg,
// JPEG - WebP nimmt Telegram als Foto nicht zuverlaessig).
export function verkaufsBild(order = {}) {
  const erstes = Array.isArray(order.items) && order.items.length ? order.items[0] : order;
  const id = Number(erstes?.item_id ?? order.item_id);
  return Number.isInteger(id) && id > 0 ? `https://disorder119.com/assets/og/${id}.jpg` : null;
}

export function formatSaleMessage(order = {}) {
  const number = safeText(order.order_number || order.orderNumber || order.id || "", 80) || "—";
  const article = safeText(order.article_no || order.articleNo || "", 80);
  const title = safeText(order.title_snapshot || order.title || "Verkauf", 180) || "Verkauf";
  const amount = euroAmount(order.total_cents ?? order.totalCents, order.currency || "EUR");
  // Kasse mit mehreren Stuecken: jedes Teil eine Zeile.
  const teile = Array.isArray(order.items) && order.items.length > 1
    ? order.items.map(it => `• #${safeText(it.article_no || "", 20)} ${safeText(it.title_snapshot || "", 120)}`.trim())
    : null;
  const stadt = safeText(order.customer_city || "", 60);
  return [
    "🎉 VERKAUFT! 🎉",
    ...(teile ? [`${teile.length} Teile:`, ...teile] : [`${article ? `#${article} · ` : ""}${title}`]),
    `💶 ${amount}${stadt ? ` · nach ${stadt}` : ""}`,
    // Nur reserviert: eingezogen wird beim Etikett/Versand, spaetestens zum
    // angegebenen Zeitpunkt (zahlung.js). Bis dahin kostet ein Storno nichts.
    order.zahlung_status === "AUTHORIZED"
      ? `PayPal reserviert – Einzug beim Versand${order.capture_due_at ? ` (spätestens ${berlinZeitpunkt(order.capture_due_at)})` : ""}`
      : "PayPal bestätigt",
    `Bestellung ${number}`,
    "📦 Jetzt DHL-Marke anlegen:",
    adminBestellungLink(order),
  ].filter(Boolean).join("\n");
}

function berlinZeitpunkt(value) {
  const date = new Date(String(value || ""));
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("de-DE", {
    timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  }).format(date);
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

function telegramChatRecordId(username) {
  return `notify:telegram:chat:${username}`;
}

async function loadSavedTelegramChatId(env, username) {
  if (!env.DB) return null;
  const row = await env.DB.prepare(`SELECT metadata_json FROM audit_events
    WHERE id=? AND event_type='TELEGRAM_CHAT_CONNECTED' LIMIT 1`)
    .bind(telegramChatRecordId(username)).first();
  if (!row?.metadata_json) return null;
  try {
    const metadata = JSON.parse(row.metadata_json);
    const chatId = String(metadata?.chatId || "").trim();
    return chatId || null;
  } catch {
    return null;
  }
}

async function saveTelegramChatId(env, username, chatId, reqId) {
  if (!env.DB) return;
  const now = new Date().toISOString();
  await env.DB.prepare(`INSERT OR REPLACE INTO audit_events
    (id,actor_type,entity_type,entity_id,event_type,request_id,metadata_json,created_at)
    VALUES (?,'SYSTEM','telegram',?,'TELEGRAM_CHAT_CONNECTED',?,?,?)`)
    .bind(
      telegramChatRecordId(username),
      username,
      safeText(reqId || crypto.randomUUID(), 120),
      JSON.stringify({ channel: "telegram", username, chatId: String(chatId), linkedAt: now }),
      now,
    ).run();
}

export async function telegramApi(env, method, body = {}) {
  let response;
  try {
    response = await fetch(`${TELEGRAM_API}/bot${String(env.TELEGRAM_BOT_TOKEN)}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new Error(`telegram_network_error:${safeText(err?.message || "unknown", 80)}`);
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.ok === false) {
    const description = safeText(payload?.description || `HTTP ${response.status}`, 120);
    throw new Error(`telegram_api_error:${description}`);
  }
  return payload;
}

async function discoverTelegramChatId(env, username, reqId) {
  if (!env.DB || !env.TELEGRAM_BOT_TOKEN) return null;
  const payload = await telegramApi(env, "getUpdates", {
    timeout: 0,
    limit: 100,
    allowed_updates: ["message"],
  });
  const updates = Array.isArray(payload?.result) ? payload.result.slice().reverse() : [];
  const match = updates.find(update => {
    const message = update?.message;
    const fromUsername = normalizedUsername(message?.from?.username || "");
    const privateChat = String(message?.chat?.type || "").toLowerCase() === "private";
    return privateChat && fromUsername === username && message?.chat?.id !== undefined && message?.chat?.id !== null;
  });
  if (!match) return null;
  const chatId = String(match.message.chat.id);
  await saveTelegramChatId(env, username, chatId, reqId);
  return chatId;
}

export async function resolveTelegramChatId(env, reqId = crypto.randomUUID()) {
  const explicit = String(env?.TELEGRAM_CHAT_ID || "").trim();
  if (explicit) return explicit;
  if (!env?.TELEGRAM_BOT_TOKEN || !env?.DB) return null;
  const username = normalizedUsername(env.TELEGRAM_TARGET_USERNAME || DEFAULT_TARGET_USERNAME);
  if (!username) return null;
  const saved = await loadSavedTelegramChatId(env, username);
  if (saved) return saved;
  return discoverTelegramChatId(env, username, reqId);
}

// Fremdtext (Mail-Betreff, Absender ...) fuer genau eine Zeile einer
// Telegram-Meldung: ohne Zeilenumbrueche, Steuer- und Richtungszeichen und
// gekuerzt. Sonst schreibt ein Betreff wie "Rechnung=0ADISORDER119 — NEUES
// ADMIN-GERÄT" eigene Zeilen, die wie ein echter Alarm aussehen.
export function telegramZeile(value, max = 120) {
  const text = String(value ?? "")
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return wohlgeformt(text.length > max ? `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…` : text);
}

// String.prototype.toWellFormed (Workers, Node 20+), sonst von Hand: einzelne
// Ersatzzeichen-Haelften werden zu U+FFFD.
export function wohlgeformt(text) {
  const wert = String(text ?? "");
  if (typeof wert.toWellFormed === "function") return wert.toWellFormed();
  return wert.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "�");
}

// Fremdtext (Pfade, Verweis-Domains, Kampagnen, Browserkennungen ...) fuer
// Telegram: eine Zeile wie telegramZeile und Links entschaerft - Telegram
// macht sonst aus "evil.example/x", "https://..." und "@name" klickbare Links.
// Lesbar bleibt es: U+2024 statt Punkt, U+2044 statt Schraegstrich nach dem
// Schema, Vollbreiten-@.
export function telegramFremd(value, max = 120) {
  const entschaerft = String(value ?? "")
    .replace(/:\/\//g, ":⁄⁄")
    .replace(/([\p{L}\p{N}])\.(?=[\p{L}\p{N}])/gu, "$1․")
    .replace(/@/g, "＠");
  return telegramZeile(entschaerft, max);
}

// Foto mit Bildunterschrift und Knopf "Bestellung öffnen". Klappt das Foto
// nicht (Bild fehlt, Telegram lehnt ab), kommt dieselbe Meldung als Text.
function telegramButtons(knopf) {
  return (Array.isArray(knopf) ? knopf : knopf ? [knopf] : []).slice(0, 4).flatMap(k => {
    if (!k) return [];
    const text = safeText(k.text || "Öffnen", 40);
    if (/^https:\/\/admin\.disorder119\.com\//.test(String(k.url || "")) || /^https:\/\/api\.disorder119\.com\/telegram\/pickup-preview\/[a-f0-9]{32}$/.test(String(k.url || ""))) return [[{ text, url: String(k.url) }]];
    if (/^pickup:[a-f0-9]{32}$/.test(String(k.callback_data || ""))) return [[{ text, callback_data: String(k.callback_data) }]];
    return [];
  });
}

export async function sendTelegramPhoto(env, photoUrl, caption, reqId = crypto.randomUUID(), knopf = null) {
  if (!telegramTransportReady(env)) return { sent: false, reason: "NOT_CONFIGURED" };
  const text = istSandbox(env) ? sandboxTelegramText(String(caption ?? "")) : String(caption ?? "");
  const cleanCaption = wohlgeformt(text.replace(/\r\n?/g, "\n").trim().slice(0, 1024));
  const url = safeText(photoUrl || "", 400);
  if (!/^https:\/\/disorder119\.com\/assets\/og\/\d+\.jpg$/.test(url) || !cleanCaption) return sendTelegramMessage(env, caption, reqId, knopf);
  const chatId = await resolveTelegramChatId(env, reqId);
  if (!chatId) return { sent: false, reason: "TARGET_NOT_CONNECTED" };
  const body = { chat_id: chatId, photo: url, caption: cleanCaption };
  // Ein Knopf oder eine Liste (je Knopf eine Zeile); nur Links in die Admin-App.
  const knoepfe = telegramButtons(knopf);
  if (knoepfe.length) body.reply_markup = { inline_keyboard: knoepfe };
  try {
    const payload = await telegramApi(env, "sendPhoto", body);
    return { sent: true, messageId: payload?.result?.message_id ?? null, foto: true };
  } catch (err) {
    console.warn(JSON.stringify({ level: "warn", event: "telegram_photo_fallback", requestId: reqId, message: safeText(err?.message || "unknown", 120) }));
    return sendTelegramMessage(env, caption, reqId, knopf);
  }
}

export async function sendTelegramMessage(env, text, reqId = crypto.randomUUID(), knopf = null) {
  if (!telegramTransportReady(env)) return { sent: false, reason: "NOT_CONFIGURED" };
  if (istSandbox(env)) text = sandboxTelegramText(text);
  // Zeilenumbrueche bleiben erhalten, sonst klebt jede Meldung in einer Zeile.
  // Nur "\n" trennt Zeilen; NEL und die Unicode-Zeilentrenner werden wie die
  // uebrigen Steuerzeichen zu Leerzeichen.
  // Richtungszeichen (RTL-Override u. a.) koennen Fremdtext umdrehen und
  // eigene Zeilen vortaeuschen - zentral weg. Abgeschnittene Emojis (halbe
  // Ersatzzeichen-Paare nach slice) lehnt Telegram ab - daher wohlgeformt.
  const cleanText = wohlgeformt(String(text ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u2028\u2029]/g, " ")
    .replace(/[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "")
    .trim()
    .slice(0, 4096));
  if (!cleanText) return { sent: false, reason: "EMPTY_MESSAGE" };
  const chatId = await resolveTelegramChatId(env, reqId);
  if (!chatId) return { sent: false, reason: "TARGET_NOT_CONNECTED" };

  const body = {
    chat_id: chatId,
    text: cleanText,
    disable_web_page_preview: true,
  };
  const knoepfe = telegramButtons(knopf);
  if (knoepfe.length) body.reply_markup = { inline_keyboard: knoepfe };
  const payload = await telegramApi(env, "sendMessage", body);

  return {
    sent: true,
    messageId: Number(payload?.result?.message_id || 0) || null,
  };
}

export async function sendTelegramTest(env, reqId = crypto.randomUUID()) {
  const result = await sendTelegramMessage(env, formatTelegramTestMessage(new Date()), reqId);
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
      oi.article_no,oi.title_snapshot,oi.item_id,oi.bild
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
  row.items = (await env.DB.prepare("SELECT article_no,title_snapshot,item_id,bild FROM order_items WHERE order_id=? ORDER BY rowid")
    .bind(String(orderId)).all()).results || [];
  try {
    const kontakt = await env.DB.prepare("SELECT city FROM order_contact_snapshots WHERE order_id=? LIMIT 1").bind(String(orderId)).first();
    row.customer_city = kontakt?.city || "";
  } catch { row.customer_city = ""; }
  try {
    const zahlung = await env.DB.prepare(`SELECT status,capture_due_at FROM payments WHERE order_id=? AND provider='PAYPAL'
      ORDER BY created_at DESC LIMIT 1`).bind(String(orderId)).first();
    row.zahlung_status = zahlung?.status || null;
    row.capture_due_at = zahlung?.capture_due_at || null;
  } catch {
    // Ohne Zahlungsdetails bleibt es bei "PayPal bestaetigt".
  }
  if (!["PAID", "PREPARING", "SHIPPED", "DELIVERED", "RETURN_REQUESTED", "RETURNED"].includes(String(row.status || "").toUpperCase())) {
    return { sent: false, reason: "ORDER_NOT_PAID" };
  }

  const claim = await claimDelivery(env, row.id, reqId);
  if (!claim.claimed) return { sent: false, duplicate: true };

  try {
    // Inhaber 05.11.2026: "DHL-Marke kaufen" fuehrt ueber die Admin-App (Passkey) direkt
    // zur DHL-Bezahlseite - Warenkorb mit der Paketgroesse der Bestellung.
    const knoepfe = [{ text: "🟡 DHL-Marke kaufen", url: adminBestellungLink(row, { dhl: true }) },
      { text: "📦 Bestellung öffnen", url: adminBestellungLink(row) }];
    const delivery = await sendTelegramPhoto(env, verkaufsBild(row), formatSaleMessage(row), reqId, knoepfe);
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

// DHL meldet "abholbereit" (Packstation/Filiale, dhl-tracking.js): Nachricht
// an den Inhaber mit Foto und Knopf zur Abholmail in der Admin-App. Die Mail an
// die Kundschaft geht nur, wenn der Inhaber sie dort abschickt (07.11.2026).
// Einmal je Sendung - dhl-tracking ruft das nur beim Wechsel auf ABHOLBEREIT.
export function formatPickupReadyMessage(order = {}, abholort = {}) {
  const o = abholort && typeof abholort === "object" ? abholort : {};
  const ort = o.typ === "filiale" ? `Postfiliale${o.nummer ? ` ${o.nummer}` : ""}${o.ort ? ` · ${o.ort}` : ""}`
    : o.nummer ? `Packstation ${o.nummer}${o.ort ? ` · ${o.ort}` : ""}` : "Packstation / Filiale";
  return [
    `📦 ABHOLBEREIT · ${telegramZeile(order.order_number || "", 60)}`,
    ...(order.kunde ? [`Für ${telegramZeile(order.kunde, 80)}`] : []),
    ...(order.titel ? [telegramZeile(order.titel, 120)] : []),
    telegramZeile(ort, 120),
    "",
    "Die Kundenmail geht erst nach deiner Freigabe raus.",
  ].join("\n");
}

export async function notifyPickupReady(env, sendung = {}, stand = {}, reqId = crypto.randomUUID()) {
  if (!telegramNotificationReady(env) || !env?.DB) return { sent: false, reason: "NOT_CONFIGURED" };
  const orderId = safeText(sendung.order_id || "", 80);
  if (!orderId) return { sent: false, reason: "ORDER_NOT_FOUND" };
  const order = await env.DB.prepare(`SELECT o.id,o.order_number,c.recipient_name
    FROM commerce_orders o LEFT JOIN order_contact_snapshots c ON c.order_id=o.id WHERE o.id=?`).bind(orderId).first();
  if (!order) return { sent: false, reason: "ORDER_NOT_FOUND" };
  const teil = await env.DB.prepare("SELECT item_id,title_snapshot FROM order_items WHERE order_id=? ORDER BY rowid LIMIT 1").bind(orderId).first();
  const text = formatPickupReadyMessage({ order_number: order.order_number, kunde: order.recipient_name, titel: teil?.title_snapshot || "" }, stand?.abholort || {});
  const chatId = await resolveTelegramChatId(env, reqId);
  if (!chatId) return { sent: false, reason: "TARGET_NOT_CONNECTED" };
  const token = Array.from(crypto.getRandomValues(new Uint8Array(16)), x => x.toString(16).padStart(2, "0")).join("");
  const claimId = `notify:telegram:pickup:${token}`;
  const now = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO audit_events (id,actor_type,entity_type,entity_id,event_type,request_id,metadata_json,created_at)
    VALUES (?,'SYSTEM','order',?,'PICKUP_APPROVAL_PENDING',?,?,?)`)
    .bind(claimId, orderId, safeText(reqId, 120), JSON.stringify({ shipmentId: String(sendung.shipment_id), chatId: String(chatId) }), now).run();
  const knoepfe = [
    { text: "✉️ E-Mail-Vorschau ansehen", url: `https://api.disorder119.com/telegram/pickup-preview/${token}` },
    { text: "✅ Kundenmail senden", callback_data: `pickup:${token}` },
  ];
  const result = await sendTelegramPhoto(env, verkaufsBild({ items: teil ? [teil] : [] }), text, reqId, knoepfe);
  if (!result.sent) await env.DB.prepare("DELETE FROM audit_events WHERE id=? AND event_type='PICKUP_APPROVAL_PENDING'").bind(claimId).run().catch(() => {});
  return result;
}

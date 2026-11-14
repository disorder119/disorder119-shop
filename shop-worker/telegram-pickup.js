import { safeText } from "./commerce-core.js";
import { resolveTelegramChatId, telegramApi, sendTelegramMessage, sendTelegramPhoto, verkaufsBild, formatPickupReadyMessage, formatStatusFreigabeMessage, telegramZeile, freigabeKnoepfe, FREIGABE_ANLAESSE, FREIGABE_GUELTIG_MS } from "./notifications.js";
import { formatPickupReady, formatShippingConfirmation, formatDeliveryNotice, sendPickupReady, sendShippingConfirmation, sendDeliveryNotice } from "./customer-mail.js";
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
  const note = "TESTVORSCHAU: Dies ist nur die Vorschau. Es wird keine Mail an einen Kunden gesendet.";
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
  const contactEmail = safeText(env?.MAIL_REPLY_TO || env?.MAIL_FROM || "kontakt@disorder119.com", 200);
  // Statustest (Inhaber 14.11.2026): je Anlass die echte Kundenmail zeigen.
  let message;
  if (meta.anlass === "VERSENDET") {
    message = formatShippingConfirmation({ ...order, city: "Aschaffenburg", shipped_at: meta.zeit || new Date().toISOString() }, { contactEmail, sprache: "de" });
  } else if (meta.anlass === "ZUGESTELLT") {
    message = formatDeliveryNotice(order, { contactEmail, sprache: "de" });
  } else {
    message = formatPickupReady(order, {
      contactEmail, sprache: "de",
      abholort: meta.abholort || { typ: "packstation", nummer: "119", ort: "Aschaffenburg" },
    });
  }
  return { ...message, html: pickupTestNotice(message.html) };
}

// Statustest auf Zuruf: Ein von Hand in D1 angelegter Marker
// (STATUS_TESTS_QUEUED) schickt je Anlass eine Testmeldung mit einem anderen
// Artikel - so wie echte Meldungen aussehen. Vorschau und Knoepfe arbeiten,
// eine Kundenmail geht dabei nie raus (PICKUP_TEST_PENDING).
export const STATUS_TEST_ID = "telegram:status:tests";
const STATUS_TESTS = Object.freeze([
  { anlass: "VERSENDET", kunde: "Mara Beispiel", dhl: "Die Sendung wurde im Paketzentrum bearbeitet." },
  { anlass: "ABHOLBEREIT", kunde: "Lena Beispiel", abholort: { typ: "packstation", nummer: "234", ort: "Aschaffenburg" } },
  { anlass: "ABHOLBEREIT", kunde: "Noah Beispiel", abholort: { typ: "filiale", nummer: "45", ort: "Berlin" } },
  { anlass: "ZUGESTELLT", kunde: "Tom Beispiel", dhl: "Die Sendung wurde zugestellt." },
]);

export async function sendQueuedStatusTests(env, reqId = crypto.randomUUID()) {
  if (!env?.DB || !env?.TELEGRAM_BOT_TOKEN) return { skipped: true };
  const claimed = await env.DB.prepare("UPDATE audit_events SET event_type='STATUS_TESTS_SENDING' WHERE id=? AND event_type='STATUS_TESTS_QUEUED'").bind(STATUS_TEST_ID).run();
  if (!claimed?.meta?.changes) return { skipped: true };
  let sent = 0;
  try {
    const chatId = await resolveTelegramChatId(env, reqId);
    if (!chatId) throw new Error("TARGET_NOT_CONNECTED");
    let katalog;
    try { katalog = await katalogNachId({ env, fetcher: env.KATALOG_FETCH || null }); } catch { katalog = new Map(); }
    const teile = [...katalog.values()].filter(k => k && Array.isArray(k.gallery) && k.gallery.length && String(k.public_status || k.status || "AVAILABLE").toUpperCase() === "AVAILABLE");
    if (!teile.length) throw new Error("NO_ITEM");
    const schritt = Math.max(1, Math.floor(teile.length / STATUS_TESTS.length));
    for (let i = 0; i < STATUS_TESTS.length; i++) {
      const muster = STATUS_TESTS[i];
      const item = testItemData(teile[(i * schritt + 3) % teile.length]);
      const token = randomToken();
      const id = `notify:telegram:pickup:${token}`;
      const jetzt = new Date().toISOString();
      const meta = {
        chatId: String(chatId), item, anlass: muster.anlass, zeit: jetzt,
        orderNumber: `D119-TEST-${i + 1}`, trackingNumber: "00340434161094042557",
        ...(muster.abholort ? { abholort: muster.abholort } : {}),
      };
      await env.DB.prepare(`INSERT INTO audit_events (id,actor_type,entity_type,entity_id,event_type,request_id,metadata_json,created_at)
        VALUES (?,'SYSTEM','telegram','pickup-test','PICKUP_TEST_PENDING',?,?,?)`)
        .bind(id, safeText(reqId, 120), JSON.stringify(meta), jetzt).run();
      const text = formatStatusFreigabeMessage(muster.anlass,
        { order_number: meta.orderNumber, kunde: muster.kunde, titel: item.title_snapshot, tracking: meta.trackingNumber },
        { text: muster.dhl || "", abholort: muster.abholort });
      const caption = `🧪 TEST ${i + 1}/${STATUS_TESTS.length} · keine echte Bestellung

${text}

Im Test geht bei keinem Knopf eine Kundenmail raus.`;
      const result = await sendTelegramPhoto(env, verkaufsBild({ items: [item] }), caption, reqId, freigabeKnoepfe(token, { test: true }));
      if (!result.sent) {
        await env.DB.prepare("DELETE FROM audit_events WHERE id=? AND event_type='PICKUP_TEST_PENDING'").bind(id).run().catch(() => {});
        throw new Error(result.reason || "TELEGRAM_STATUS_TEST_FAILED");
      }
      sent++;
    }
    await env.DB.prepare("UPDATE audit_events SET event_type='STATUS_TESTS_SENT',metadata_json=? WHERE id=? AND event_type='STATUS_TESTS_SENDING'")
      .bind(JSON.stringify({ sent }), STATUS_TEST_ID).run();
    return { sent };
  } catch (err) {
    // Nicht blind wiederholen (Telegram kann schon angenommen haben).
    await env.DB.prepare("UPDATE audit_events SET event_type='STATUS_TESTS_FAILED',metadata_json=? WHERE id=? AND event_type='STATUS_TESTS_SENDING'")
      .bind(JSON.stringify({ sent, code: String(err?.message || "error").slice(0, 80) }), STATUS_TEST_ID).run().catch(() => {});
    console.error(JSON.stringify({ event: "telegram_status_tests_failed", requestId: reqId, sent, code: String(err?.message || "error").slice(0, 80) }));
    return { sent, error: true };
  }
}

// Der Test aus der Admin-App ist absichtlich derselbe Telegram-Weg wie eine
// echte Abholmeldung: Foto, Stationsinfo und dieselben Knöpfe. Nur die Freigabe
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
  const caption = `🧪 TEST · so erscheint eine echte Abholmeldung\n\n${formatPickupReadyMessage({ order_number: meta.orderNumber, titel: item.title_snapshot }, meta.abholort)}\n\nDer Vorschau-Knopf öffnet die vollständige Kundenmail. Der Senden-Knopf bleibt im Test ohne Kundenmail.`;
  const result = await sendTelegramPhoto(env, verkaufsBild({ items: [item] }), caption, reqId, freigabeKnoepfe(token, { test: true }));
  if (!result.sent) await env.DB.prepare("DELETE FROM audit_events WHERE id=? AND event_type='PICKUP_TEST_PENDING'").bind(id).run().catch(() => {});
  return result;
}

// Eine Freigabe-Zeile aus audit_events lesen: Test oder einer der drei
// Anlaesse (VERSENDET, ABHOLBEREIT, ZUGESTELLT). Aeltere Abhol-Freigaben
// haben keinen Anlass in den Metadaten - sie sind ABHOLBEREIT. Passt der
// Zustand nicht zum Anlass, gilt die Zeile als ungueltig.
function freigabeLesen(row) {
  if (!row) return null;
  let meta = {};
  try { meta = JSON.parse(row.metadata_json || "{}"); } catch { return null; }
  const erstellt = Date.parse(row.created_at);
  const frisch = Number.isFinite(erstellt) && Date.now() - erstellt <= FREIGABE_GUELTIG_MS;
  const test = /^PICKUP_TEST_(PENDING|CLOSED)$/.exec(String(row.event_type || ""));
  if (test) return { test: true, zustand: test[1], meta, frisch };
  const m = /^(SHIPPED_APPROVAL|PICKUP_APPROVAL|DELIVERED_APPROVAL)_(PENDING|CLAIMED|SENT|DECLINED)$/.exec(String(row.event_type || ""));
  if (!m) return null;
  const anlass = meta.anlass === undefined ? "ABHOLBEREIT" : String(meta.anlass);
  if (FREIGABE_ANLAESSE[anlass]?.ereignis !== m[1]) return null;
  return { test: false, anlass, ereignis: m[1], zustand: m[2], meta, frisch };
}

// Die Kundenmail des Anlasses bauen (vorschau=true) oder senden. Jede der drei
// Funktionen prueft selbst, ob der Anlass noch gilt (Bestellstatus, Stand der
// Sendungsverfolgung, dieselbe Sendung) und sperrt Doppelversand.
async function freigabeMail(env, anlass, orderId, shipmentId, reqId, vorschau) {
  if (anlass === "VERSENDET") return sendShippingConfirmation(env, orderId, reqId, { vorschau, expectedShipmentId: shipmentId, nurUnterwegs: true });
  if (anlass === "ZUGESTELLT") return sendDeliveryNotice(env, orderId, { reqId, vorschau, expectedShipmentId: shipmentId });
  return sendPickupReady(env, orderId, { reqId, vorschau, requireReady: true, expectedShipmentId: shipmentId });
}

const NICHT_AKTUELL = Object.freeze({
  VERSENDET: "Die Sendung ist nicht mehr unterwegs – Versandmail nicht gesendet.",
  ABHOLBEREIT: "DHL meldet diese Sendung nicht mehr als abholbereit.",
  ZUGESTELLT: "Die Bestellung gilt nicht mehr als zugestellt – Mail nicht gesendet.",
});

// Der Link in Telegram ist eine zufaellige, einmalige Kennung. Er zeigt die
// fertige Kundenmail nur, solange die Freigabe offen ist und der Anlass noch
// gilt (z. B. DHL die Sendung noch als abholbereit meldet). Die Vorschau fuehrt
// keinen Versand aus.
export async function handleTelegramPickupPreview(url, env, reqId = crypto.randomUUID()) {
  const token = previewToken(url);
  if (!token || !env?.DB) return new Response("Not found", { status: 404 });
  const id = `notify:telegram:pickup:${token}`;
  const row = await env.DB.prepare("SELECT entity_id,event_type,metadata_json,created_at FROM audit_events WHERE id=? LIMIT 1").bind(id).first();
  const freigabe = freigabeLesen(row);
  if (!freigabe || freigabe.zustand !== "PENDING" || !freigabe.frisch) return new Response("Not found", { status: 404 });
  const meta = freigabe.meta;
  if (freigabe.test) {
    if (String(meta.chatId || "") !== String(await resolveTelegramChatId(env, reqId)) || !meta.item) return new Response("Not found", { status: 404 });
    return new Response(pickupTestMail(env, meta).html, { status: 200, headers: previewHeaders() });
  }
  if (!meta.shipmentId) return new Response("Not found", { status: 404 });
  const draft = await freigabeMail(env, freigabe.anlass, row.entity_id, meta.shipmentId, reqId, true);
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

// Nach "gesendet" oder "nicht senden" verschwinden die Knoepfe unter der
// Nachricht - so bleibt sichtbar, was noch offen ist. Klappt das nicht, aendert
// es nichts: der Zustand in der Datenbank entscheidet.
async function knoepfeEntfernen(env, callback) {
  const chatId = callback?.message?.chat?.id;
  const messageId = callback?.message?.message_id;
  if (chatId === undefined || chatId === null || !messageId) return;
  await telegramApi(env, "editMessageReplyMarkup", { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [] } }).catch(() => {});
}

// Knopfdruck des Inhabers. "pickup:<token>" sendet die Kundenmail des Anlasses
// genau einmal (PENDING -> CLAIMED -> SENT), "pickup-no:<token>" schliesst die
// Freigabe ohne Versand (PENDING -> DECLINED), "pickup-test:<token>" ist der
// Test aus der Admin-App und sendet nie etwas. Nur der private Chat des
// Inhabers zaehlt; nach 48 Stunden ist eine Freigabe abgelaufen.
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
  const parsed = /^(pickup(?:-test|-no)?):([a-f0-9]{32})$/.exec(String(callback?.data || ""));
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
  const freigabe = freigabeLesen(row);
  const eigene = freigabe && String(freigabe.meta.chatId || "") === chatId;
  let answer = "Freigabe nicht mehr gültig.";
  let fertig = false;
  if (!eigene) {
    // Unbekannt, beschaedigt oder fuer einen anderen Chat ausgestellt.
  } else if (freigabe.test) {
    // Test aus der Admin-App: beide Knoepfe enden ohne Kundenmail.
    if (kind !== "pickup" && freigabe.zustand === "PENDING" && freigabe.frisch) {
      answer = kind === "pickup-no" ? "Test geschlossen: Keine Kundenmail wurde gesendet." : "Test bestätigt: Keine Kundenmail wurde gesendet.";
      if (kind === "pickup-no") {
        await env.DB.prepare("UPDATE audit_events SET event_type='PICKUP_TEST_CLOSED' WHERE id=? AND event_type='PICKUP_TEST_PENDING'").bind(rowId).run().catch(() => {});
        fertig = true;
      }
    }
  } else if (kind === "pickup-test") {
    // Der Test-Knopf kann nie eine echte Freigabe ausloesen.
  } else if (freigabe.zustand === "SENT") {
    answer = "Mail wurde bereits gesendet.";
    fertig = true;
  } else if (freigabe.zustand === "DECLINED") {
    answer = "Freigabe wurde geschlossen – nicht gesendet.";
    fertig = true;
  } else if (kind === "pickup-no") {
    // Schliessen geht auch nach Ablauf der 48 Stunden: gesendet wird ohnehin nichts.
    const ev = freigabe.ereignis;
    const geschlossen = await env.DB.prepare(`UPDATE audit_events SET event_type='${ev}_DECLINED' WHERE id=? AND event_type='${ev}_PENDING'`).bind(rowId).run();
    if (geschlossen?.meta?.changes) { answer = "Nicht gesendet."; fertig = true; }
    else answer = "Freigabe wird bereits verarbeitet.";
  } else if (freigabe.zustand === "PENDING" && freigabe.frisch && freigabe.meta.shipmentId) {
    const ev = freigabe.ereignis;
    const zurueck = () => env.DB.prepare(`UPDATE audit_events SET event_type='${ev}_PENDING' WHERE id=? AND event_type='${ev}_CLAIMED'`).bind(rowId).run();
    const claimed = await env.DB.prepare(`UPDATE audit_events SET event_type='${ev}_CLAIMED' WHERE id=? AND event_type='${ev}_PENDING'`).bind(rowId).run();
    if (claimed?.meta?.changes) {
      try {
        const result = await freigabeMail(env, freigabe.anlass, row.entity_id, freigabe.meta.shipmentId, reqId, false);
        if (result.sent || result.duplicate) {
          await env.DB.prepare(`UPDATE audit_events SET event_type='${ev}_SENT' WHERE id=? AND event_type='${ev}_CLAIMED'`).bind(rowId).run();
          answer = result.sent ? "Kundenmail gesendet." : "Mail war bereits gesendet.";
          fertig = true;
          if (result.sent) {
            const bestellung = await env.DB.prepare("SELECT order_number FROM commerce_orders WHERE id=? LIMIT 1").bind(row.entity_id).first().catch(() => null);
            await sendTelegramMessage(env, `✅ ${FREIGABE_ANLAESSE[freigabe.anlass].mail} für Bestellung ${telegramZeile(bestellung?.order_number || "", 60)} gesendet.`.replace("  ", " "), reqId).catch(() => {});
          }
        } else {
          answer = ["PICKUP_NOT_CURRENT", "SHIPPING_NOT_CURRENT", "DELIVERY_NOT_CURRENT", "ORDER_NOT_SHIPPED", "SHIPMENT_CHANGED"].includes(result.reason)
            ? NICHT_AKTUELL[freigabe.anlass] : "Kundenmail nicht gesendet. Bitte in der Admin-App prüfen.";
          await zurueck();
        }
      } catch (err) {
        await zurueck().catch(() => {});
        console.error(JSON.stringify({ event: "pickup_approval_failed", requestId: reqId, anlass: freigabe.anlass, code: safeText(err?.message || "", 80) }));
        answer = "Versand fehlgeschlagen. Bitte in der Admin-App prüfen.";
      }
    } else answer = "Freigabe wird bereits verarbeitet.";
  } else if (freigabe.zustand === "CLAIMED") answer = "Freigabe wird bereits verarbeitet.";
  else if (freigabe.zustand === "PENDING" && !freigabe.frisch) answer = "Freigabe abgelaufen (48 Stunden) – nichts gesendet.";
  await telegramApi(env, "answerCallbackQuery", { callback_query_id: String(callback.id), text: answer, show_alert: false }).catch(() => {});
  if (fertig) await knoepfeEntfernen(env, callback);
  return new Response("OK");
}

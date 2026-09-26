// Kundenkonto: Bestellungen ansehen, Adresse pflegen, Widerruf erklaeren,
// Daten exportieren oder loeschen lassen.
//
// Die Anmeldung laeuft ueber einen Link per E-Mail, bewusst ohne Passwort. Ein
// Konto ohne gespeichertes Passwort kann weder durch ein Datenleck noch durch
// anderswo wiederverwendete Passwoerter uebernommen werden - und die Kundin
// weist sich ohnehin ueber dieselbe Adresse aus, mit der sie bezahlt hat.
//
// Von jedem Token liegt nur der SHA-256-Abdruck in der Datenbank. Wer die
// Datenbank liest, kann sich damit nicht anmelden.
import { safeText } from "./commerce-core.js";
import {
  SHOP_URL,
  escapeHtml,
  mailTransportReady,
  normalizeEmail,
  sendMail,
} from "./customer-mail.js";

export const LOGIN_TOKEN_TTL_MINUTES = 20;
export const SESSION_TTL_DAYS = 30;
// Fuenf Anmeldelinks je Adresse und Stunde. Genug fuer eine Kundin, die den
// ersten Link im Spam sucht - zu wenig, um ein fremdes Postfach zuzumuellen.
export const LOGIN_RATE_LIMIT_PER_HOUR = 5;
// Die Grenze je Adresse allein haelt niemanden auf, der viele verschiedene
// Adressen durchprobiert. Deshalb zusaetzlich je Anschluss ...
export const LOGIN_RATE_LIMIT_PER_IP_HOUR = 10;
// ... und eine Obergrenze fuer den ganzen Shop. Jeder Anmeldelink ist eine
// Mail aus demselben Tageskontingent wie Bestellbestaetigung und
// Versandmail (Brevo kostenlos: 300 am Tag). Ist es leer, bekommt auch die
// Kundin, die gerade bezahlt hat, keine Rechnung mehr. 100 Links lassen
// genug Luft fuer den Bestellbetrieb; LOGIN_DAILY_CAP stellt das um.
export const LOGIN_DAILY_CAP = 100;

const SHOP_ORIGINS = Object.freeze([
  "https://disorder119.com",
  "https://www.disorder119.com",
]);

export class AccountError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

function securityHeaders() {
  return {
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  };
}

function corsHeaders(origin) {
  const allowed = origin && SHOP_ORIGINS.includes(origin) ? origin : SHOP_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    // Ohne Credentials wuerde der Browser das Sitzungs-Cookie nicht mitschicken.
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}

function json(data, status = 200, origin = null, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...securityHeaders(),
      ...corsHeaders(origin),
      ...extraHeaders,
    },
  });
}

// ---------------------------------------------------------------- Token-Helfer

export function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function tokenFingerprint(token) {
  const bytes = new TextEncoder().encode(String(token || ""));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
}

function plusMinutes(minutes, from = new Date()) {
  return new Date(from.getTime() + minutes * 60_000).toISOString();
}

function plusDays(days, from = new Date()) {
  return new Date(from.getTime() + days * 86_400_000).toISOString();
}

// ------------------------------------------------------------------- Anmeldung

function loginMail(link) {
  const safeLink = escapeHtml(link);
  return {
    subject: "Dein Anmeldelink für DISORDER119",
    text: [
      "DISORDER119",
      "",
      "Hier ist dein Anmeldelink:",
      link,
      "",
      `Der Link gilt ${LOGIN_TOKEN_TTL_MINUTES} Minuten und funktioniert genau einmal.`,
      "Wenn du dich nicht anmelden wolltest, ignorier diese Mail einfach — ohne Klick passiert nichts.",
    ].join("\n"),
    html: `<!DOCTYPE html>
<html lang="de"><head><meta charset="utf-8"><title>Anmeldelink</title></head>
<body style="margin:0;padding:0;background:#f2efe7;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2efe7;padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;color:#141310;font-size:15px;line-height:1.55;">
  <tr><td style="background:#0b0b0b;color:#f2efe7;padding:22px 28px;letter-spacing:0.22em;font-size:13px;font-weight:700;">DISORDER119</td></tr>
  <tr><td style="padding:28px;">
    <h1 style="margin:0 0 12px;font-size:20px;">Dein Anmeldelink</h1>
    <p style="margin:0 0 20px;">Ein Klick genügt — kein Passwort nötig.</p>
    <p style="margin:0 0 20px;"><a href="${safeLink}" style="display:inline-block;background:#0b0b0b;color:#f2efe7;text-decoration:none;padding:13px 22px;font-weight:700;letter-spacing:0.06em;">Konto öffnen</a></p>
    <p style="margin:0;color:#6f6a60;font-size:13px;">Der Link gilt ${LOGIN_TOKEN_TTL_MINUTES} Minuten und funktioniert genau einmal. Wenn du dich nicht anmelden wolltest, ignorier diese Mail einfach — ohne Klick passiert nichts.</p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`,
  };
}

async function recentLoginCount(env, email) {
  const since = new Date(Date.now() - 3_600_000).toISOString();
  const row = await env.DB.prepare(`SELECT COUNT(*) AS anzahl FROM customer_login_tokens
    WHERE email_normalized=? AND created_at>=?`).bind(email, since).first();
  return Number(row?.anzahl || 0);
}

async function recentLoginCountForIp(env, ipHash) {
  const since = new Date(Date.now() - 3_600_000).toISOString();
  const row = await env.DB.prepare(`SELECT COUNT(*) AS anzahl FROM customer_login_tokens
    WHERE request_ip_hash=? AND created_at>=?`).bind(ipHash, since).first();
  return Number(row?.anzahl || 0);
}

async function loginCountLastDay(env) {
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const row = await env.DB.prepare(`SELECT COUNT(*) AS anzahl FROM customer_login_tokens
    WHERE created_at>=?`).bind(since).first();
  return Number(row?.anzahl || 0);
}

export function loginDailyCap(env) {
  const configured = Number(env?.LOGIN_DAILY_CAP);
  return Number.isInteger(configured) && configured > 0 ? configured : LOGIN_DAILY_CAP;
}

export async function requestLoginLink(env, rawEmail, reqId = crypto.randomUUID(), ipHash = "") {
  if (!env?.DB) throw new AccountError("ACCOUNT_DATABASE_NOT_CONFIGURED", 503);
  if (!mailTransportReady(env)) throw new AccountError("ACCOUNT_MAIL_NOT_CONFIGURED", 503);
  const email = normalizeEmail(rawEmail);
  // Nach aussen bleibt die Antwort immer gleich. Eine Fehlermeldung "kein Konto"
  // wuerde verraten, wer hier schon einmal bestellt hat.
  if (!email) return { queued: false, reason: "INVALID_EMAIL" };

  // Aeltere Links bleiben nach 0013 als entwertete Zeilen stehen, damit die
  // Grenzen sie zaehlen. Nach zwei Tagen zaehlen sie fuer keine Grenze mehr.
  await env.DB.prepare("DELETE FROM customer_login_tokens WHERE created_at<?")
    .bind(new Date(Date.now() - 2 * 86_400_000).toISOString()).run();

  if (await recentLoginCount(env, email) >= LOGIN_RATE_LIMIT_PER_HOUR) {
    return { queued: false, reason: "RATE_LIMITED" };
  }
  const ip = safeText(ipHash, 64);
  if (ip && await recentLoginCountForIp(env, ip) >= LOGIN_RATE_LIMIT_PER_IP_HOUR) {
    return { queued: false, reason: "IP_RATE_LIMITED" };
  }
  if (await loginCountLastDay(env) >= loginDailyCap(env)) {
    // Gehoert ins Log: Wird die Grenze erreicht, probiert entweder jemand
    // Adressen durch - oder der Shop ist gewachsen und die Grenze zu knapp.
    console.warn(JSON.stringify({ level: "warn", event: "login_daily_cap_reached", requestId: safeText(reqId, 120) }));
    return { queued: false, reason: "DAILY_CAP" };
  }

  const token = randomToken();
  const now = new Date();
  await env.DB.prepare(`INSERT INTO customer_login_tokens
    (id,email_normalized,created_at,expires_at,request_ip_hash) VALUES (?,?,?,?,?)`)
    .bind(
      await tokenFingerprint(token),
      email,
      now.toISOString(),
      plusMinutes(LOGIN_TOKEN_TTL_MINUTES, now),
      safeText(ipHash, 64) || null,
    ).run();

  const base = safeText(env.ACCOUNT_URL || `${SHOP_URL}/konto/`, 200);
  const link = `${base}${base.includes("?") ? "&" : "?"}anmeldung=${encodeURIComponent(token)}`;
  const message = loginMail(link);
  await sendMail(env, {
    to: email,
    subject: message.subject,
    text: message.text,
    html: message.html,
    tag: "login-link",
  });
  return { queued: true, requestId: safeText(reqId, 120) };
}

// ------------------------------------------------------------------- Sitzungen

async function upsertCustomer(env, email) {
  const existing = await env.DB.prepare(`SELECT id,status FROM customers
    WHERE email_normalized=? AND auth_provider='EMAIL_LINK' LIMIT 1`).bind(email).first();
  const now = new Date().toISOString();
  if (existing?.id) {
    if (String(existing.status) === "DELETED") throw new AccountError("ACCOUNT_DELETED", 410);
    await env.DB.prepare("UPDATE customers SET email_verified=1,updated_at=? WHERE id=?")
      .bind(now, existing.id).run();
    return existing.id;
  }
  const id = crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO customers
    (id,auth_provider,auth_subject,email_normalized,email_verified,status,created_at,updated_at)
    VALUES (?,'EMAIL_LINK',?,?,1,'ACTIVE',?,?)`)
    .bind(id, email, email, now, now).run();
  return id;
}

// Gastbestellungen mit derselben Adresse gehoeren ab jetzt sichtbar zum Konto.
// Der Anmeldelink beweist, dass die Kundin dieses Postfach kontrolliert - genau
// dieselbe Adresse, an die die Bestellbestaetigung gegangen ist.
async function attachGuestOrders(env, customerId, email) {
  const result = await env.DB.prepare(`UPDATE commerce_orders SET customer_id=?,updated_at=?
     WHERE customer_id IS NULL
       AND id IN (SELECT order_id FROM order_contact_snapshots WHERE lower(email)=?)`)
    .bind(customerId, new Date().toISOString(), email).run();
  return Number(result?.meta?.changes || 0);
}

export async function redeemLoginToken(env, rawToken, reqId = crypto.randomUUID()) {
  if (!env?.DB) throw new AccountError("ACCOUNT_DATABASE_NOT_CONFIGURED", 503);
  const token = safeText(rawToken, 200).trim();
  if (!token) throw new AccountError("LOGIN_TOKEN_INVALID", 401);
  const fingerprint = await tokenFingerprint(token);
  const row = await env.DB.prepare(`SELECT id,email_normalized,expires_at,used_at
    FROM customer_login_tokens WHERE id=? LIMIT 1`).bind(fingerprint).first();
  if (!row) throw new AccountError("LOGIN_TOKEN_INVALID", 401);
  if (row.used_at) throw new AccountError("LOGIN_TOKEN_ALREADY_USED", 401);
  if (new Date(String(row.expires_at)).getTime() <= Date.now()) {
    throw new AccountError("LOGIN_TOKEN_EXPIRED", 401);
  }

  // Erst entwerten, dann anmelden. Wird der Link doppelt geoeffnet (etwa durch
  // einen Linkpruefer im Postfach), kann nur der erste Aufruf eine Sitzung
  // erzeugen.
  const claimed = await env.DB.prepare(`UPDATE customer_login_tokens SET used_at=?
     WHERE id=? AND used_at IS NULL`).bind(new Date().toISOString(), fingerprint).run();
  if (!claimed?.meta?.changes) throw new AccountError("LOGIN_TOKEN_ALREADY_USED", 401);

  const email = String(row.email_normalized);
  const customerId = await upsertCustomer(env, email);
  await attachGuestOrders(env, customerId, email);

  const session = randomToken();
  const now = new Date();
  await env.DB.prepare(`INSERT INTO customer_sessions
    (id,customer_id,created_at,expires_at,last_seen_at) VALUES (?,?,?,?,?)`)
    .bind(await tokenFingerprint(session), customerId, now.toISOString(), plusDays(SESSION_TTL_DAYS, now), now.toISOString())
    .run();

  return {
    session,
    expiresAt: plusDays(SESSION_TTL_DAYS, now),
    email,
    customerId,
    requestId: safeText(reqId, 120),
  };
}

function sessionTokenFromRequest(request) {
  const header = String(request.headers.get("Authorization") || "");
  if (/^Bearer\s+/i.test(header)) return header.replace(/^Bearer\s+/i, "").trim();
  const cookie = String(request.headers.get("Cookie") || "");
  const match = /(?:^|;\s*)d119_session=([^;]+)/.exec(cookie);
  return match ? decodeURIComponent(match[1]) : "";
}

export async function resolveSession(env, request) {
  if (!env?.DB) throw new AccountError("ACCOUNT_DATABASE_NOT_CONFIGURED", 503);
  const token = sessionTokenFromRequest(request);
  if (!token) throw new AccountError("NOT_AUTHENTICATED", 401);
  const fingerprint = await tokenFingerprint(token);
  const row = await env.DB.prepare(`SELECT s.id,s.customer_id,s.expires_at,s.revoked_at,
      c.email_normalized,c.status
    FROM customer_sessions s JOIN customers c ON c.id=s.customer_id
    WHERE s.id=? LIMIT 1`).bind(fingerprint).first();
  if (!row || row.revoked_at) throw new AccountError("NOT_AUTHENTICATED", 401);
  if (new Date(String(row.expires_at)).getTime() <= Date.now()) {
    throw new AccountError("SESSION_EXPIRED", 401);
  }
  if (String(row.status) !== "ACTIVE") throw new AccountError("ACCOUNT_DISABLED", 403);
  try {
    await env.DB.prepare("UPDATE customer_sessions SET last_seen_at=? WHERE id=?")
      .bind(new Date().toISOString(), fingerprint).run();
  } catch {
    // Der Zeitstempel ist reine Statistik. Er darf keine Anmeldung verhindern.
  }
  return { sessionId: fingerprint, customerId: String(row.customer_id), email: String(row.email_normalized) };
}

export async function revokeSession(env, sessionId) {
  await env.DB.prepare("UPDATE customer_sessions SET revoked_at=? WHERE id=? AND revoked_at IS NULL")
    .bind(new Date().toISOString(), sessionId).run();
}

export async function revokeAllSessions(env, customerId) {
  await env.DB.prepare("UPDATE customer_sessions SET revoked_at=? WHERE customer_id=? AND revoked_at IS NULL")
    .bind(new Date().toISOString(), customerId).run();
}

// ----------------------------------------------------------------- Bestellungen

const TRACKING_BASE = "https://www.dhl.de/de/privatkunden/pakete-empfangen/verfolgen.html?piececode=";

function shipmentView(row) {
  if (!row?.tracking_number && !row?.status) return null;
  const tracking = safeText(row.tracking_number || "", 60);
  return {
    carrier: safeText(row.carrier || "", 40) || null,
    status: safeText(row.status || "", 30) || null,
    trackingNumber: tracking || null,
    trackingUrl: tracking ? TRACKING_BASE + encodeURIComponent(tracking) : null,
    shippedAt: row.shipped_at || null,
    deliveredAt: row.delivered_at || null,
  };
}

export async function listOrders(env, customerId) {
  const orders = await env.DB.prepare(`SELECT id,order_number,status,currency,
      subtotal_cents,shipping_cents,total_cents,created_at
    FROM commerce_orders WHERE customer_id=? ORDER BY created_at DESC LIMIT 200`)
    .bind(customerId).all();
  const rows = orders?.results || [];
  if (!rows.length) return [];

  // Ein Zug fuer alle Positionen statt einer Abfrage je Bestellung.
  const ids = rows.map(row => String(row.id));
  const platzhalter = ids.map(() => "?").join(",");
  const [items, shipments] = await Promise.all([
    env.DB.prepare(`SELECT order_id,item_id,article_no,title_snapshot,unit_price_cents
      FROM order_items WHERE order_id IN (${platzhalter}) ORDER BY id`).bind(...ids).all(),
    env.DB.prepare(`SELECT order_id,carrier,status,tracking_number,shipped_at,delivered_at
      FROM shipments WHERE order_id IN (${platzhalter}) ORDER BY created_at DESC`).bind(...ids).all(),
  ]);

  const itemsByOrder = new Map();
  for (const item of items?.results || []) {
    const list = itemsByOrder.get(String(item.order_id)) || [];
    list.push({
      // itemId ist der Schluessel in catalog.json - damit holt die Seite das
      // Produktbild direkt aus dem oeffentlichen Katalog, statt Bilddaten
      // durch den Worker zu schleifen.
      itemId: Number(item.item_id),
      articleNo: safeText(item.article_no || "", 40) || null,
      title: safeText(item.title_snapshot || "", 180),
      priceCents: Number(item.unit_price_cents || 0),
    });
    itemsByOrder.set(String(item.order_id), list);
  }
  const shipmentByOrder = new Map();
  for (const row of shipments?.results || []) {
    if (!shipmentByOrder.has(String(row.order_id))) {
      shipmentByOrder.set(String(row.order_id), shipmentView(row));
    }
  }

  return rows.map(row => ({
    id: String(row.id),
    orderNumber: safeText(row.order_number || "", 80),
    status: safeText(row.status || "", 30),
    currency: row.currency || "EUR",
    subtotalCents: Number(row.subtotal_cents || 0),
    shippingCents: Number(row.shipping_cents || 0),
    totalCents: Number(row.total_cents || 0),
    createdAt: row.created_at,
    items: itemsByOrder.get(String(row.id)) || [],
    shipment: shipmentByOrder.get(String(row.id)) || null,
  }));
}

async function loadOwnOrder(env, customerId, orderId) {
  const row = await env.DB.prepare(`SELECT id,status,created_at FROM commerce_orders
    WHERE id=? AND customer_id=? LIMIT 1`).bind(safeText(orderId, 80), customerId).first();
  if (!row) throw new AccountError("ORDER_NOT_FOUND", 404);
  return row;
}

// Widerruf nach § 355 BGB. Der Shop entscheidet danach im Admin weiter; hier
// wird nur die Erklaerung der Kundin festgehalten - mit Zeitpunkt, denn auf den
// kommt es bei der Frist an.
export async function requestReturn(env, customerId, orderId, reasonCode = "") {
  const order = await loadOwnOrder(env, customerId, orderId);

  // Erst nachsehen, ob schon ein Widerruf laeuft, dann erst den Status pruefen.
  // Andersherum bekaeme die Kundin beim zweiten Klick oder nach einem Neuladen
  // eine Fehlermeldung: die Bestellung steht dann naemlich bereits auf
  // RETURN_REQUESTED und faellt durch die Statuspruefung, obwohl ihre
  // Erklaerung laengst angekommen ist.
  const existing = await env.DB.prepare(`SELECT id,status FROM returns
    WHERE order_id=? AND status NOT IN ('CLOSED','REJECTED') LIMIT 1`).bind(String(order.id)).first();
  if (existing?.id) return { created: false, returnId: String(existing.id), status: String(existing.status) };

  const status = String(order.status || "").toUpperCase();
  if (!["PAID", "PREPARING", "SHIPPED", "DELIVERED"].includes(status)) {
    throw new AccountError("ORDER_NOT_RETURNABLE", 409);
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO returns (id,order_id,status,reason_code,created_at,updated_at)
    VALUES (?,?,'REQUESTED',?,?,?)`)
    .bind(id, String(order.id), safeText(reasonCode, 40) || "WITHDRAWAL", now, now).run();
  await env.DB.prepare(`UPDATE commerce_orders SET status='RETURN_REQUESTED',updated_at=?
     WHERE id=? AND status IN ('PAID','PREPARING','SHIPPED','DELIVERED')`)
    .bind(now, String(order.id)).run();
  return { created: true, returnId: id, status: "REQUESTED", declaredAt: now };
}

// --------------------------------------------------------------------- Adresse

export async function listAddresses(env, customerId) {
  const rows = await env.DB.prepare(`SELECT id,label,recipient_name,address_line1,address_line2,
      postal_code,city,region,country_code,is_default
    FROM customer_addresses WHERE customer_id=? ORDER BY is_default DESC,id`)
    .bind(customerId).all();
  return (rows?.results || []).map(row => ({
    id: String(row.id),
    label: safeText(row.label || "", 40) || null,
    recipientName: safeText(row.recipient_name || "", 120),
    addressLine1: safeText(row.address_line1 || "", 160),
    addressLine2: safeText(row.address_line2 || "", 160) || null,
    postalCode: safeText(row.postal_code || "", 20),
    city: safeText(row.city || "", 80),
    region: safeText(row.region || "", 80) || null,
    countryCode: safeText(row.country_code || "", 4),
    isDefault: Number(row.is_default || 0) === 1,
  }));
}

export async function saveDefaultAddress(env, customerId, input = {}) {
  const recipient = safeText(input.recipientName || "", 120).trim();
  const line1 = safeText(input.addressLine1 || "", 160).trim();
  const postal = safeText(input.postalCode || "", 20).trim();
  const city = safeText(input.city || "", 80).trim();
  const country = safeText(input.countryCode || "DE", 4).trim().toUpperCase() || "DE";
  if (!recipient || !line1 || !postal || !city) throw new AccountError("ADDRESS_INCOMPLETE", 400);

  const now = new Date().toISOString();
  const existing = await env.DB.prepare(`SELECT id FROM customer_addresses
    WHERE customer_id=? AND is_default=1 LIMIT 1`).bind(customerId).first();
  if (existing?.id) {
    await env.DB.prepare(`UPDATE customer_addresses SET recipient_name=?,address_line1=?,
        address_line2=?,postal_code=?,city=?,region=?,country_code=?,updated_at=?
      WHERE id=? AND customer_id=?`)
      .bind(recipient, line1, safeText(input.addressLine2 || "", 160).trim() || null,
        postal, city, safeText(input.region || "", 80).trim() || null, country, now,
        String(existing.id), customerId).run();
    return { id: String(existing.id), created: false };
  }
  const id = crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO customer_addresses
    (id,customer_id,label,recipient_name,address_line1,address_line2,postal_code,city,region,country_code,is_default,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,1,?,?)`)
    .bind(id, customerId, "Standard", recipient, line1,
      safeText(input.addressLine2 || "", 160).trim() || null, postal, city,
      safeText(input.region || "", 80).trim() || null, country, now, now).run();
  return { id, created: true };
}

// ------------------------------------------------------------------ Datenschutz

export async function exportAccountData(env, customerId, email) {
  const [orders, addresses] = await Promise.all([
    listOrders(env, customerId),
    listAddresses(env, customerId),
  ]);
  return {
    exportedAt: new Date().toISOString(),
    account: { email, customerId },
    orders,
    addresses,
    hinweis: "Auskunft nach Art. 15 DSGVO. Enthält alle zu diesem Konto gespeicherten Bestell- und Adressdaten.",
  };
}

// Sofort loeschen geht nicht: handelsrechtliche Aufbewahrungspflichten
// (§ 147 AO, § 257 HGB) verlangen, dass Bestell- und Rechnungsdaten bleiben.
// Deshalb wird der Wunsch erfasst, das Konto gesperrt und alle Sitzungen
// beendet - die eigentliche Loeschung entscheidet der Shop im Admin.
export async function requestAccountDeletion(env, customerId) {
  const existing = await env.DB.prepare(`SELECT id FROM account_privacy_requests
    WHERE customer_id=? AND request_type='DELETE' AND status IN ('REQUESTED','PROCESSING') LIMIT 1`)
    .bind(customerId).first();
  const now = new Date().toISOString();
  if (!existing?.id) {
    await env.DB.prepare(`INSERT INTO account_privacy_requests
      (id,customer_id,request_type,status,requested_at) VALUES (?,?,'DELETE','REQUESTED',?)`)
      .bind(crypto.randomUUID(), customerId, now).run();
  }
  await env.DB.prepare("UPDATE customers SET status='DELETION_PENDING',updated_at=? WHERE id=?")
    .bind(now, customerId).run();
  await revokeAllSessions(env, customerId);
  return { requested: true, requestedAt: now };
}

// ------------------------------------------------------------------- Routing

function sessionCookie(token, maxAgeSeconds) {
  const value = token ? encodeURIComponent(token) : "";
  return [
    `d119_session=${value}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    `Max-Age=${Math.max(0, Math.trunc(maxAgeSeconds))}`,
  ].join("; ");
}

export function isAccountRoute(url) {
  return url.pathname === "/account" || url.pathname.startsWith("/account/");
}

async function readJson(request) {
  try {
    const body = await request.json();
    return body && typeof body === "object" && !Array.isArray(body) ? body : {};
  } catch {
    return {};
  }
}

// Schnelle Bremse vor jeder Datenbankarbeit: der Cloudflare-Ratenbegrenzer
// zaehlt je Anschluss und Minute. Die Stundengrenzen in requestLoginLink
// greifen danach, weil sie auf gespeicherten Anmeldelinks beruhen.
async function limitLoginRequests(request, env) {
  if (!env.RATE_LIMITER || typeof env.RATE_LIMITER.limit !== "function") return;
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const result = await env.RATE_LIMITER.limit({ key: `account-login:${ip}` });
  if (result && result.success === false) throw new AccountError("RATE_LIMITED", 429);
}

// Wie bei Bestellung und Mietanfrage: ohne Secret (Testbetrieb) keine
// Pruefung, im Livebetrieb laesst backend-runtime.js die Route ohne Secret
// gar nicht erst zu.
async function verifyTurnstile(env, request, body) {
  if (!env.TURNSTILE_SECRET) return;
  const token = request.headers.get("X-Turnstile-Token") || body?.turnstileToken;
  if (!token) throw new AccountError("TURNSTILE_REQUIRED", 403);
  const form = new FormData();
  form.append("secret", env.TURNSTILE_SECRET);
  form.append("response", safeText(token, 2048));
  const ip = request.headers.get("CF-Connecting-IP");
  if (ip) form.append("remoteip", ip);
  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
  const result = await res.json();
  if (!result.success) throw new AccountError("TURNSTILE_FAILED", 403);
}

export async function handleAccountRequest(request, env, url, reqId = crypto.randomUUID(), origin = null) {
  try {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: { ...securityHeaders(), ...corsHeaders(origin) } });
    }
    if (origin && !SHOP_ORIGINS.includes(origin)) {
      throw new AccountError("ORIGIN_NOT_ALLOWED", 403);
    }
    const path = url.pathname.replace(/\/+$/, "") || "/account";

    if (path === "/account/login" && request.method === "POST") {
      await limitLoginRequests(request, env);
      const body = await readJson(request);
      await verifyTurnstile(env, request, body);
      const ipHash = await tokenFingerprint(
        `${safeText(request.headers.get("CF-Connecting-IP") || "", 60)}:${safeText(env.LOGIN_IP_PEPPER || "d119", 60)}`,
      );
      // Immer dieselbe Antwort, egal ob verschickt, ungueltig oder zu oft
      // angefordert: ob es zu dieser Adresse ein Konto gibt, geht niemanden
      // etwas an, der die Adresse nur erraten hat.
      await requestLoginLink(env, body.email, reqId, ipHash);
      return json({
        ok: true,
        hinweis: "Falls zu dieser Adresse ein Konto passt, ist der Anmeldelink unterwegs.",
      }, 200, origin);
    }

    if (path === "/account/session" && request.method === "POST") {
      const body = await readJson(request);
      const result = await redeemLoginToken(env, body.token, reqId);
      return json({
        ok: true,
        email: result.email,
        session: result.session,
        expiresAt: result.expiresAt,
      }, 200, origin, {
        "Set-Cookie": sessionCookie(result.session, SESSION_TTL_DAYS * 86_400),
      });
    }

    if (path === "/account/logout" && request.method === "POST") {
      const session = await resolveSession(env, request);
      const body = await readJson(request);
      if (body.alleGeraete) await revokeAllSessions(env, session.customerId);
      else await revokeSession(env, session.sessionId);
      return json({ ok: true }, 200, origin, { "Set-Cookie": sessionCookie("", 0) });
    }

    // Ab hier ist eine gueltige Sitzung Pflicht.
    const session = await resolveSession(env, request);

    if (path === "/account/profile" && request.method === "GET") {
      return json({
        ok: true,
        email: session.email,
        addresses: await listAddresses(env, session.customerId),
      }, 200, origin);
    }

    if (path === "/account/orders" && request.method === "GET") {
      return json({ ok: true, orders: await listOrders(env, session.customerId) }, 200, origin);
    }

    if (path === "/account/address" && (request.method === "PUT" || request.method === "POST")) {
      const body = await readJson(request);
      const saved = await saveDefaultAddress(env, session.customerId, body);
      return json({ ok: true, ...saved, addresses: await listAddresses(env, session.customerId) }, 200, origin);
    }

    const returnMatch = /^\/account\/orders\/([^/]+)\/widerruf$/.exec(path);
    if (returnMatch && request.method === "POST") {
      const body = await readJson(request);
      const result = await requestReturn(env, session.customerId, decodeURIComponent(returnMatch[1]), body.grund);
      return json({ ok: true, ...result }, 200, origin);
    }

    if (path === "/account/export" && request.method === "GET") {
      return json({ ok: true, daten: await exportAccountData(env, session.customerId, session.email) }, 200, origin);
    }

    if (path === "/account/loeschen" && request.method === "POST") {
      const result = await requestAccountDeletion(env, session.customerId);
      return json({ ok: true, ...result }, 200, origin, { "Set-Cookie": sessionCookie("", 0) });
    }

    throw new AccountError("NOT_FOUND", 404);
  } catch (err) {
    if (err instanceof AccountError) {
      return json({ error: err.code, requestId: reqId }, err.status, origin);
    }
    console.error(JSON.stringify({
      level: "error",
      event: "account_request_failed",
      requestId: reqId,
      message: safeText(err?.message || "unknown", 180),
    }));
    return json({ error: "INTERNAL_ACCOUNT_ERROR", requestId: reqId }, 500, origin);
  }
}

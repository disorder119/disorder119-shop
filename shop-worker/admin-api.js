import {
  ORDER_STATUSES,
  RENTAL_STATUSES,
  canTransitionOrder,
  canTransitionRental,
  safeText,
} from "./commerce-core.js";
import { sendShippingConfirmation } from "./customer-mail.js";
import {
  ErstattungsFehler,
  erstattungAusWebhook,
  paypalErstattungenAbgleichen as paypalErstattungenAbgleichenMitStatus,
  paypalWebhookErstattungenAbonnieren,
} from "./erstattung.js";
import { reconcilePurchasePayments } from "./worker.js";
import {
  AuftragFehler,
  auftraegeDerBestellungPruefen,
  auftraegeFuerBestellung,
  auftragAbbrechen,
  auftragAusfuehren,
  erstattungBeauftragen,
  erstattungenUebersicht,
  erstattungsauftraegePflegen,
  stueckeZurueckInDenShop,
  versandSperre,
} from "./erstattung-auftrag.js";
import {
  WiderrufFehler,
  handleWiderruf,
  ruecksendungAnlegen,
  wareEingegangen,
  widerrufBearbeiten,
  widerrufErfassen,
  widerrufeFuerBestellung,
  widerrufePflegen,
  widerrufeUebersicht,
} from "./widerruf.js";
import {
  ZahlungFehler,
  faelligeZahlungenEinziehen,
  reservierungFreigeben,
  zahlungDerBestellung,
  zahlungEinziehen,
  zahlungFehlerText,
  zahlungSicherstellen,
  zahlungView,
} from "./zahlung.js";

const ADMIN_ORIGINS = Object.freeze([
  "https://admin.disorder119.com",
  "http://localhost:8765",
  "http://127.0.0.1:8765",
]);

const CAPTURE_TIME_SQL = `COALESCE((SELECT COALESCE(e.occurred_at,e.observed_at)
  FROM tax_cash_events e WHERE e.payment_id=payments.id AND e.kind='capture'
  ORDER BY e.rowid LIMIT 1),payments.updated_at,payments.created_at)`;

class AdminError extends Error {
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
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  };
}

function corsHeaders(origin) {
  const headers = {
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "600",
    "Vary": "Origin",
  };
  if (origin && ADMIN_ORIGINS.includes(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

function adminJson(data, status = 200, origin = null) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...securityHeaders(),
      ...corsHeaders(origin),
    },
  });
}

export function adminOptions(origin) {
  if (origin && !ADMIN_ORIGINS.includes(origin)) {
    return new Response(null, { status: 403, headers: securityHeaders() });
  }
  return new Response(null, { status: 204, headers: { ...securityHeaders(), ...corsHeaders(origin) } });
}

async function digestText(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value || "")));
  return new Uint8Array(digest);
}

async function tokenEquals(a, b) {
  if (!a || !b) return false;
  const [left, right] = await Promise.all([digestText(a), digestText(b)]);
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left[i] ^ right[i];
  return diff === 0;
}

async function requireAdmin(request, env) {
  if (!env.ADMIN_TOKEN) throw new AdminError("ADMIN_NOT_CONFIGURED", 503);
  const auth = request.headers.get("Authorization") || "";
  const supplied = auth.replace(/^Bearer\s+/i, "").trim();
  if (!(await tokenEquals(supplied, env.ADMIN_TOKEN))) throw new AdminError("UNAUTHORIZED", 401);
}

function requireDb(env) {
  if (!env.DB) throw new AdminError("COMMERCE_DATABASE_NOT_CONFIGURED", 503);
  return env.DB;
}

async function readJson(request) {
  const type = (request.headers.get("Content-Type") || "").toLowerCase();
  if (!type.includes("application/json")) throw new AdminError("CONTENT_TYPE_REQUIRED", 415);
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > 32 * 1024) throw new AdminError("REQUEST_TOO_LARGE", 413);
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    throw new AdminError("INVALID_JSON", 400);
  }
}

export function clampAdminLimit(value, fallback = 50, max = 250) {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

export function clampAdminOffset(value) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 100000) : 0;
}

export function clampAnalyticsDays(value) {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 30;
  return Math.min(Math.max(parsed, 7), 365);
}

// ohneZahlung: an der Bestellung haengt kein Geld (mehr) - Einziehen
// gescheitert oder Reservierung aufgehoben. Nur dann darf eine bezahlte
// Bestellung direkt auf "Storniert"; sonst laeuft das ueber "Stornieren"
// (Reservierung freigeben oder erstatten).
export function orderNextStatuses(status, { ohneZahlung = false } = {}) {
  const current = String(status || "").toUpperCase();
  // PAID darf ausschliesslich ein verifizierter Zahlungsabschluss setzen.
  if (current === "PAYMENT_PENDING" || current === "RESERVED") return ["CANCELLED"];
  return ORDER_STATUSES.filter(next => next !== current && canTransitionOrder(current, next)
    && (next !== "CANCELLED" || ohneZahlung));
}

// Haengt an der Bestellung noch Geld (reserviert, eingezogen, erstattet)?
const ZAHLUNG_GEBUNDEN = Object.freeze(["PENDING", "AUTHORIZED", "COMPLETED", "REFUNDED", "PARTIALLY_REFUNDED"]);

export function rentalNextStatuses(status) {
  const current = String(status || "").toUpperCase();
  return RENTAL_STATUSES.filter(next => next !== current && canTransitionRental(current, next));
}

function parseMetadata(value) {
  if (!value) return null;
  try { return JSON.parse(value); } catch { return null; }
}

async function auditAdmin(env, entityType, entityId, eventType, reqId, metadata = null, actorType = "ADMIN") {
  if (!env.DB) return;
  await env.DB.prepare(`INSERT INTO audit_events
    (id,actor_type,entity_type,entity_id,event_type,request_id,metadata_json,created_at)
    VALUES (?,?,?,?,?,?,?,?)`).bind(
      crypto.randomUUID(), actorType, entityType, String(entityId), eventType, reqId,
      metadata ? JSON.stringify(metadata) : null, new Date().toISOString()
    ).run();
}

async function loadCatalogMap() {
  try {
    const res = await fetch("https://disorder119.com/data/catalog.json", {
      headers: { Accept: "application/json", "User-Agent": "disorder119-admin-worker" },
    });
    if (!res.ok) return new Map();
    const items = await res.json();
    const map = new Map();
    if (Array.isArray(items)) {
      for (const item of items) map.set(Number(item.id), item);
    }
    return map;
  } catch {
    return new Map();
  }
}

function catalogView(item) {
  if (!item) return null;
  return {
    id: Number(item.id),
    article: item.article || null,
    brand: item.brand || "",
    title: item.title || "",
    category: item.category || "",
    size: item.size || "",
    publicStatus: item.public_status || null,
    price: item.price ?? null,
    image: Array.isArray(item.gallery) && item.gallery[0] ? `/${String(item.gallery[0]).replace(/^\//, "")}` : null,
  };
}

async function getOverview(env, url) {
  const db = requireDb(env);
  const days = clampAnalyticsDays(url.searchParams.get("days"));
  const cutoff = new Date(Date.now() - (days - 1) * 86400000);
  cutoff.setUTCHours(0, 0, 0, 0);
  const cutoffIso = cutoff.toISOString();

  const summary = await db.batch([
    db.prepare(`SELECT COUNT(*) AS total,
      SUM(CASE WHEN status='PAYMENT_PENDING' THEN 1 ELSE 0 END) AS paymentPending,
      SUM(CASE WHEN status='PAID' THEN 1 ELSE 0 END) AS paid,
      SUM(CASE WHEN status='PREPARING' THEN 1 ELSE 0 END) AS preparing,
      SUM(CASE WHEN status='SHIPPED' THEN 1 ELSE 0 END) AS shipped,
      SUM(CASE WHEN status='DELIVERED' THEN 1 ELSE 0 END) AS delivered,
      SUM(CASE WHEN status='RETURN_REQUESTED' THEN 1 ELSE 0 END) AS returnRequested,
      SUM(CASE WHEN status='RETURNED' THEN 1 ELSE 0 END) AS returned,
      SUM(CASE WHEN status='REFUNDED' THEN 1 ELSE 0 END) AS refunded,
      SUM(CASE WHEN status='CANCELLED' THEN 1 ELSE 0 END) AS cancelled
      FROM commerce_orders`),
    db.prepare(`SELECT COUNT(*) AS total,
      SUM(CASE WHEN status='COMPLETED' THEN 1 ELSE 0 END) AS completed,
      SUM(CASE WHEN status IN ('CREATED','PENDING','AUTHORIZED') THEN 1 ELSE 0 END) AS open,
      SUM(CASE WHEN status='FAILED' THEN 1 ELSE 0 END) AS failed,
      SUM(CASE WHEN status IN ('REFUNDED','PARTIALLY_REFUNDED') THEN 1 ELSE 0 END) AS refunded,
      COALESCE(SUM(CASE WHEN status IN ('COMPLETED','REFUNDED','PARTIALLY_REFUNDED') AND provider_payment_id IS NOT NULL THEN amount_cents ELSE 0 END),0) AS capturedCents
      FROM payments`),
    db.prepare(`SELECT COUNT(*) AS total,
      SUM(CASE WHEN status='RESERVED' THEN 1 ELSE 0 END) AS reserved,
      SUM(CASE WHEN status='PAYMENT_PENDING' THEN 1 ELSE 0 END) AS paymentPending,
      SUM(CASE WHEN status='CONFIRMED' THEN 1 ELSE 0 END) AS confirmed,
      SUM(CASE WHEN status='ACTIVE' THEN 1 ELSE 0 END) AS active,
      SUM(CASE WHEN status='RETURN_DUE' THEN 1 ELSE 0 END) AS returnDue,
      SUM(CASE WHEN status='RETURNED' THEN 1 ELSE 0 END) AS returned,
      SUM(CASE WHEN status='CANCELLED' THEN 1 ELSE 0 END) AS cancelled,
      SUM(CASE WHEN status='REFUNDED' THEN 1 ELSE 0 END) AS refunded,
      COALESCE(SUM(CASE WHEN status NOT IN ('CANCELLED','REFUNDED') THEN total_price_cents ELSE 0 END),0) AS quotedRentalCents,
      COALESCE(SUM(CASE WHEN status NOT IN ('CANCELLED','REFUNDED') THEN deposit_cents ELSE 0 END),0) AS quotedDepositCents
      FROM rental_reservations`),
    db.prepare(`SELECT COUNT(*) AS total,
      SUM(CASE WHEN status='AVAILABLE' THEN 1 ELSE 0 END) AS available,
      SUM(CASE WHEN status='RESERVED' THEN 1 ELSE 0 END) AS reserved,
      SUM(CASE WHEN status='PAYMENT_PENDING' THEN 1 ELSE 0 END) AS paymentPending,
      SUM(CASE WHEN status='PAID' THEN 1 ELSE 0 END) AS paid,
      SUM(CASE WHEN status='PREPARING' THEN 1 ELSE 0 END) AS preparing,
      SUM(CASE WHEN status='SHIPPED' THEN 1 ELSE 0 END) AS shipped,
      SUM(CASE WHEN status='DELIVERED' THEN 1 ELSE 0 END) AS delivered,
      SUM(CASE WHEN status='RETURN_REQUESTED' THEN 1 ELSE 0 END) AS returnRequested
      FROM inventory`),
    db.prepare(`SELECT COUNT(*) AS total,
      SUM(CASE WHEN status='ACTIVE' THEN 1 ELSE 0 END) AS active,
      SUM(CASE WHEN status='DISABLED' THEN 1 ELSE 0 END) AS disabled
      FROM customers`),
    db.prepare(`SELECT
      (SELECT COUNT(*) FROM returns WHERE status NOT IN ('CLOSED','REJECTED')) AS openReturns,
      (SELECT COUNT(*) FROM payment_events WHERE processed_at IS NULL) AS unprocessedPaymentEvents,
      (SELECT COUNT(*) FROM shipments WHERE status='EXCEPTION') AS shipmentExceptions,
      (SELECT COUNT(*) FROM reservations WHERE status='RESERVED' AND expires_at <= datetime('now')) AS stalePurchaseReservations,
      (SELECT COUNT(*) FROM idempotency_keys WHERE expires_at <= datetime('now')) AS expiredIdempotencyKeys`),
  ]);

  const ordersDaily = await db.prepare(`SELECT substr(o.created_at,1,10) AS day, COUNT(*) AS orders,
    COALESCE(SUM(o.total_cents),0) AS orderValueCents
    FROM commerce_orders o WHERE o.created_at>=? AND EXISTS (SELECT 1 FROM payments p
      WHERE p.order_id=o.id AND p.status IN ('COMPLETED','REFUNDED','PARTIALLY_REFUNDED')
        AND p.provider_payment_id IS NOT NULL)
    GROUP BY substr(o.created_at,1,10) ORDER BY day`).bind(cutoffIso).all();
  const paymentsDaily = await db.prepare(`SELECT substr(${CAPTURE_TIME_SQL},1,10) AS day,
    COUNT(*) AS payments, COALESCE(SUM(amount_cents),0) AS capturedCents
    FROM payments WHERE status IN ('COMPLETED','REFUNDED','PARTIALLY_REFUNDED') AND provider_payment_id IS NOT NULL AND ${CAPTURE_TIME_SQL}>=?
    GROUP BY substr(${CAPTURE_TIME_SQL},1,10) ORDER BY day`).bind(cutoffIso).all();
  const rentalsDaily = await db.prepare(`SELECT substr(created_at,1,10) AS day, COUNT(*) AS rentals,
    COALESCE(SUM(total_price_cents),0) AS quotedRentalCents
    FROM rental_reservations WHERE created_at>=? GROUP BY substr(created_at,1,10) ORDER BY day`).bind(cutoffIso).all();

  const byDay = new Map();
  const touch = day => {
    if (!byDay.has(day)) byDay.set(day, { day, orders: 0, orderValueCents: 0, capturedCents: 0, rentals: 0, quotedRentalCents: 0 });
    return byDay.get(day);
  };
  for (const row of ordersDaily.results || []) Object.assign(touch(row.day), { orders: row.orders || 0, orderValueCents: row.orderValueCents || 0 });
  for (const row of paymentsDaily.results || []) Object.assign(touch(row.day), { capturedCents: row.capturedCents || 0 });
  for (const row of rentalsDaily.results || []) Object.assign(touch(row.day), { rentals: row.rentals || 0, quotedRentalCents: row.quotedRentalCents || 0 });

  const topPurchased = await db.prepare(`SELECT oi.item_id AS itemId, oi.article_no AS articleNo,
    MAX(oi.title_snapshot) AS title, COUNT(*) AS orders, COALESCE(SUM(oi.unit_price_cents),0) AS valueCents
    FROM order_items oi JOIN commerce_orders o ON o.id=oi.order_id
    WHERE EXISTS (SELECT 1 FROM payments p WHERE p.order_id=o.id
      AND p.status IN ('COMPLETED','REFUNDED','PARTIALLY_REFUNDED') AND p.provider_payment_id IS NOT NULL)
    GROUP BY oi.item_id,oi.article_no ORDER BY valueCents DESC LIMIT 8`).all();
  const topRentedRows = await db.prepare(`SELECT i.item_id AS itemId, i.article_no AS articleNo,
    COUNT(*) AS requests, COALESCE(SUM(rr.total_price_cents),0) AS quotedRentalCents
    FROM rental_reservations rr JOIN inventory i ON i.id=rr.inventory_id
    WHERE rr.status NOT IN ('CANCELLED') GROUP BY i.item_id,i.article_no ORDER BY requests DESC, quotedRentalCents DESC LIMIT 8`).all();
  const catalog = await loadCatalogMap();
  const topRented = (topRentedRows.results || []).map(row => ({ ...row, catalog: catalogView(catalog.get(Number(row.itemId))) }));

  const first = result => (result?.results && result.results[0]) || {};
  return {
    generatedAt: new Date().toISOString(),
    period: { days, from: cutoffIso, to: new Date().toISOString() },
    orders: first(summary[0]),
    payments: first(summary[1]),
    rentals: first(summary[2]),
    inventory: first(summary[3]),
    customers: first(summary[4]),
    operations: first(summary[5]),
    daily: Array.from(byDay.values()).sort((a, b) => a.day.localeCompare(b.day)),
    topPurchased: topPurchased.results || [],
    topRented,
  };
}

async function getOrders(env, url) {
  const db = requireDb(env);
  const limit = clampAdminLimit(url.searchParams.get("limit"));
  const offset = clampAdminOffset(url.searchParams.get("offset"));
  // Ein Status oder mehrere mit Komma - "Offen" in der Admin-App ist
  // PAID,PREPARING, "Retouren" RETURN_REQUESTED,RETURNED.
  const statuses = safeText(url.searchParams.get("status"), 200).toUpperCase().split(",").map(s => s.trim()).filter(Boolean);
  const q = safeText(url.searchParams.get("q"), 120);
  if (statuses.length > 6 || statuses.some(s => !ORDER_STATUSES.includes(s))) throw new AdminError("INVALID_ORDER_STATUS", 400);

  const where = [];
  const binds = [];
  if (statuses.length) { where.push(`o.status IN (${statuses.map(() => "?").join(",")})`); binds.push(...statuses); }
  if (q) {
    where.push(`(o.order_number LIKE ? OR o.guest_email LIKE ? OR EXISTS (
      SELECT 1 FROM order_items qi WHERE qi.order_id=o.id AND (qi.article_no LIKE ? OR qi.title_snapshot LIKE ?)
    ))`);
    const like = `%${q}%`;
    binds.push(like, like, like, like);
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const count = await db.prepare(`SELECT COUNT(*) AS total FROM commerce_orders o ${clause}`).bind(...binds).first();
  const rows = await db.prepare(`SELECT o.*,
      (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id=o.id) AS itemCount,
      (SELECT GROUP_CONCAT(oi.title_snapshot,' · ') FROM order_items oi WHERE oi.order_id=o.id) AS itemTitles,
      (SELECT GROUP_CONCAT(oi.item_id) FROM order_items oi WHERE oi.order_id=o.id) AS itemIds,
      (SELECT COALESCE(NULLIF(c.recipient_name,''),TRIM(COALESCE(c.given_name,'')||' '||COALESCE(c.surname,''))) FROM order_contact_snapshots c WHERE c.order_id=o.id) AS customerName,
      (SELECT c.city FROM order_contact_snapshots c WHERE c.order_id=o.id) AS customerCity,
      (SELECT p.status FROM payments p WHERE p.order_id=o.id ORDER BY p.created_at DESC LIMIT 1) AS paymentStatus,
      (SELECT p.provider FROM payments p WHERE p.order_id=o.id ORDER BY p.created_at DESC LIMIT 1) AS paymentProvider,
      (SELECT s.status FROM shipments s WHERE s.order_id=o.id ORDER BY s.created_at DESC LIMIT 1) AS shipmentStatus,
      (SELECT s.tracking_number FROM shipments s WHERE s.order_id=o.id ORDER BY s.created_at DESC LIMIT 1) AS trackingNumber,
      (SELECT n.body FROM admin_notes n WHERE n.entity_type='ORDER' AND n.entity_id=o.id ORDER BY n.created_at DESC LIMIT 1) AS latestNote
    FROM commerce_orders o ${clause} ORDER BY o.created_at DESC LIMIT ? OFFSET ?`)
    .bind(...binds, limit, offset).all();
  return {
    total: Number(count?.total || 0), limit, offset,
    orders: (rows.results || []).map(row => ({ ...row, nextStatuses: orderNextStatuses(row.status) })),
  };
}

async function getOrderDetail(env, id) {
  const db = requireDb(env);
  const order = await db.prepare("SELECT * FROM commerce_orders WHERE id=? OR order_number=?").bind(id, id).first();
  if (!order) throw new AdminError("ORDER_NOT_FOUND", 404);
  const [items, payments, shipments, returns, refunds, events, notes, contact, versand] = await db.batch([
    db.prepare(`SELECT oi.*,i.status AS inventory_status FROM order_items oi
      LEFT JOIN inventory i ON i.id=oi.inventory_id WHERE oi.order_id=? ORDER BY oi.rowid`).bind(order.id),
    db.prepare(`SELECT p.*,
      (SELECT e.amount_cents FROM tax_cash_events e WHERE e.payment_id=p.id AND e.kind='fee' LIMIT 1) AS paypal_fee_cents
      FROM payments p WHERE p.order_id=? ORDER BY p.created_at DESC`).bind(order.id),
    db.prepare("SELECT * FROM shipments WHERE order_id=? ORDER BY created_at DESC").bind(order.id),
    db.prepare("SELECT * FROM returns WHERE order_id=? ORDER BY created_at DESC").bind(order.id),
    db.prepare("SELECT * FROM refunds WHERE order_id=? ORDER BY created_at DESC").bind(order.id),
    db.prepare("SELECT * FROM audit_events WHERE entity_id=? OR (entity_type='order' AND entity_id=?) ORDER BY created_at DESC LIMIT 200").bind(order.id, order.id),
    db.prepare("SELECT * FROM admin_notes WHERE entity_type='ORDER' AND entity_id=? ORDER BY created_at DESC").bind(order.id),
    db.prepare("SELECT * FROM order_contact_snapshots WHERE order_id=?").bind(order.id),
    db.prepare("SELECT * FROM order_versand WHERE order_id=?").bind(order.id),
  ]);
  let customer = null;
  let addresses = [];
  if (order.customer_id) {
    customer = await db.prepare("SELECT id,email_normalized,email_verified,status,created_at,updated_at FROM customers WHERE id=?").bind(order.customer_id).first();
    const addr = await db.prepare("SELECT * FROM customer_addresses WHERE customer_id=? ORDER BY is_default DESC,created_at DESC").bind(order.customer_id).all();
    addresses = addr.results || [];
  }
  const activity = (events.results || []).map(row => ({ ...row, metadata: parseMetadata(row.metadata_json) }));
  const itemRows = items.results || [];
  const [erstattungsauftraege, widerrufe, sperre] = await Promise.all([
    auftraegeFuerBestellung(db, order.id),
    widerrufeFuerBestellung(db, order.id),
    versandSperre(db, order.id),
  ]);
  const laufend = erstattungsauftraege.find(a => a.laufend) || null;
  const shipmentRows = shipments.results || [];
  const paymentRows = payments.results || [];
  // Juengste PayPal-Zahlung: reserviert, eingezogen, freigegeben, gescheitert.
  const zahlung = zahlungView(paymentRows.find(p => p.provider === "PAYPAL") || null);
  const gebunden = paymentRows.some(p => ZAHLUNG_GEBUNDEN.includes(String(p.status)));
  const warVerkauft = paymentRows.some(p => p.authorization_id || p.provider_payment_id);
  return {
    order,
    nextStatuses: orderNextStatuses(order.status, { ohneZahlung: !gebunden }),
    // Was die Admin-App zum Stornieren anbietet (siehe orderStornieren).
    storno: laufend ? { moeglich: false, art: null, laeuft: true } : stornoAngebot(order, zahlung),
    // Reserviert (Einziehen beim Versand), eingezogen, freigegeben (zahlung.js).
    zahlung,
    // Storno, Ruecksendung, Widerruf, Kulanz (erstattung-auftrag.js, widerruf.js).
    erstattungsauftraege,
    laufenderAuftrag: laufend,
    widerrufe,
    versandSperre: sperre,
    ruecklauf: ruecklaufAngebot(order, itemRows, shipmentRows, refunds.results || [], widerrufe, laufend, zahlung),
    wiederVerfuegbar: wiederVerfuegbarStand(order, itemRows, activity, { warVerkauft }),
    items: itemRows,
    payments: paymentRows,
    shipments: shipmentRows,
    returns: returns.results || [],
    refunds: refunds.results || [],
    contact: (contact.results || [])[0] || null,
    // Im Checkout gewaehlte Versandart (Standard/Express, Paketgroesse, Preis).
    versand: (versand.results || [])[0] || null,
    customer,
    addresses,
    notes: notes.results || [],
    activity,
    deletion: await orderDeletionState(db, order),
  };
}

const DELETION_BLOCKER_TEXT = Object.freeze({
  ORDER_NOT_CANCELLED: "Bestellung zuerst stornieren.",
  PAYMENT_EVIDENCE: "Bezahlt – als Buchungsbeleg bleibt die Bestellung 10 Jahre im Archiv (§ 147 AO). Stornieren & erstatten genügt.",
  PAYMENT_EVENT: "PayPal-Ereignis vorhanden.",
  SHIPMENT: "Versandvorgang vorhanden.",
  RETURN_OR_REFUND: "Rückgabe oder Erstattung vorhanden.",
  TAX_EVIDENCE: "Steuerlicher Zahlungsnachweis vorhanden.",
  FISCAL_DOCUMENT: "Rechnung oder Bestellbestätigung archiviert.",
  SHIPPING_LABEL: "Versandlabel oder Packlink-Entwurf vorhanden.",
  WITHDRAWAL: "Widerrufserklärung vorhanden – sie bleibt als Beleg erhalten.",
  REFUND_JOB: "Erstattungsauftrag vorhanden.",
});

async function orderDeletionState(db, order) {
  const checks = await db.batch([
    db.prepare(`SELECT COUNT(*) AS n FROM payments WHERE order_id=?
      AND (status NOT IN ('CREATED','FAILED','CANCELLED') OR provider_payment_id IS NOT NULL)`).bind(order.id),
    db.prepare(`SELECT COUNT(*) AS n FROM payment_events e JOIN payments p ON p.id=e.payment_id
      WHERE p.order_id=?`).bind(order.id),
    db.prepare("SELECT COUNT(*) AS n FROM shipments WHERE order_id=?").bind(order.id),
    db.prepare(`SELECT (SELECT COUNT(*) FROM returns WHERE order_id=?) +
      (SELECT COUNT(*) FROM refunds WHERE order_id=?) AS n`).bind(order.id, order.id),
    db.prepare("SELECT COUNT(*) AS n FROM tax_cash_events WHERE order_id=?").bind(order.id),
    db.prepare(`SELECT (SELECT COUNT(*) FROM rechnungen WHERE order_id=?) +
      (SELECT COUNT(*) FROM order_confirmation_archive WHERE order_id=?) AS n`).bind(order.id, order.id),
    db.prepare(`SELECT (SELECT COUNT(*) FROM dhl_qr_marken WHERE order_id=?) +
      (SELECT COUNT(*) FROM packlink_sendungen WHERE order_id=?) AS n`).bind(order.id, order.id),
    db.prepare("SELECT COUNT(*) AS n FROM widerrufe WHERE order_id=?").bind(order.id),
    db.prepare("SELECT COUNT(*) AS n FROM erstattungsauftraege WHERE order_id=?").bind(order.id),
  ]);
  const count = index => Number(checks[index]?.results?.[0]?.n || 0);
  const blockers = [];
  if (order.status !== "CANCELLED") blockers.push("ORDER_NOT_CANCELLED");
  if (count(0)) blockers.push("PAYMENT_EVIDENCE");
  if (count(1)) blockers.push("PAYMENT_EVENT");
  if (count(2)) blockers.push("SHIPMENT");
  if (count(3)) blockers.push("RETURN_OR_REFUND");
  if (count(4)) blockers.push("TAX_EVIDENCE");
  if (count(5)) blockers.push("FISCAL_DOCUMENT");
  if (count(6)) blockers.push("SHIPPING_LABEL");
  if (count(7)) blockers.push("WITHDRAWAL");
  if (count(8)) blockers.push("REFUND_JOB");
  return {
    allowed: blockers.length === 0,
    blockers,
    messages: blockers.map(code => DELETION_BLOCKER_TEXT[code]),
  };
}

async function updateOrderContact(env, id, body, reqId) {
  const db = requireDb(env);
  const order = await db.prepare("SELECT * FROM commerce_orders WHERE id=? OR order_number=?").bind(id, id).first();
  if (!order) throw new AdminError("ORDER_NOT_FOUND", 404);
  if (["SHIPPED", "DELIVERED", "RETURN_REQUESTED", "RETURNED", "REFUNDED"].includes(order.status)) {
    throw new AdminError("ORDER_ADDRESS_LOCKED", 409);
  }
  const existing = await db.prepare("SELECT * FROM order_contact_snapshots WHERE order_id=?").bind(order.id).first();
  if (!existing) throw new AdminError("ORDER_CONTACT_NOT_FOUND", 404);
  const contact = {
    email: safeText(body.email, 254).toLowerCase(),
    recipientName: safeText(body.recipientName, 160),
    addressLine1: safeText(body.addressLine1, 180),
    addressLine2: safeText(body.addressLine2, 180),
    postalCode: safeText(body.postalCode, 24).toUpperCase(),
    city: safeText(body.city, 120),
    region: safeText(body.region, 120),
    countryCode: safeText(body.countryCode, 2).toUpperCase(),
  };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email)) throw new AdminError("INVALID_EMAIL", 400);
  if (!contact.recipientName || !contact.addressLine1 || !contact.postalCode || !contact.city || !/^[A-Z]{2}$/.test(contact.countryCode)) {
    throw new AdminError("ORDER_ADDRESS_INCOMPLETE", 400);
  }
  const now = new Date().toISOString();
  await db.batch([
    db.prepare(`UPDATE order_contact_snapshots SET email=?,recipient_name=?,address_line1=?,address_line2=?,
      postal_code=?,city=?,region=?,country_code=?,updated_at=? WHERE order_id=?`)
      .bind(contact.email, contact.recipientName, contact.addressLine1, contact.addressLine2 || null,
        contact.postalCode, contact.city, contact.region || null, contact.countryCode, now, order.id),
    db.prepare("UPDATE commerce_orders SET guest_email=?,updated_at=? WHERE id=?")
      .bind(contact.email, now, order.id),
  ]);
  await auditAdmin(env, "order", order.id, "ORDER_CONTACT_UPDATED", reqId, {
    fields: ["email", "recipientName", "addressLine1", "addressLine2", "postalCode", "city", "region", "countryCode"],
  });
  return getOrderDetail(env, order.id);
}

async function deleteTestOrder(env, id, body, reqId) {
  const db = requireDb(env);
  const order = await db.prepare("SELECT * FROM commerce_orders WHERE id=? OR order_number=?").bind(id, id).first();
  if (!order) throw new AdminError("ORDER_NOT_FOUND", 404);
  if (safeText(body.orderNumber, 80) !== order.order_number) throw new AdminError("ORDER_NUMBER_CONFIRMATION_REQUIRED", 400);
  const deletion = await orderDeletionState(db, order);
  if (!deletion.allowed) throw new AdminError("ORDER_DELETE_BLOCKED", 409);

  const now = new Date().toISOString();
  // D1 fuehrt batch atomar aus. Erst abhaengige, nicht aufbewahrungspflichtige
  // Testdaten entfernen; der abschliessende DELETE prueft die Schutzregeln
  // erneut und verhindert einen Wettlauf mit Zahlungs-/Versandereignissen.
  const result = await db.batch([
    db.prepare("DELETE FROM admin_notes WHERE entity_type='ORDER' AND entity_id=?").bind(order.id),
    db.prepare("DELETE FROM order_versand WHERE order_id=?").bind(order.id),
    db.prepare("DELETE FROM payments WHERE order_id=? AND status IN ('CREATED','FAILED','CANCELLED') AND provider_payment_id IS NULL").bind(order.id),
    db.prepare("DELETE FROM idempotency_keys WHERE resource_id=?").bind(order.id),
    db.prepare(`DELETE FROM commerce_orders WHERE id=? AND status='CANCELLED'
      AND NOT EXISTS (SELECT 1 FROM payments WHERE order_id=commerce_orders.id)
      AND NOT EXISTS (SELECT 1 FROM shipments WHERE order_id=commerce_orders.id)
      AND NOT EXISTS (SELECT 1 FROM returns WHERE order_id=commerce_orders.id)
      AND NOT EXISTS (SELECT 1 FROM refunds WHERE order_id=commerce_orders.id)
      AND NOT EXISTS (SELECT 1 FROM tax_cash_events WHERE order_id=commerce_orders.id)
      AND NOT EXISTS (SELECT 1 FROM rechnungen WHERE order_id=commerce_orders.id)
      AND NOT EXISTS (SELECT 1 FROM order_confirmation_archive WHERE order_id=commerce_orders.id)
      AND NOT EXISTS (SELECT 1 FROM dhl_qr_marken WHERE order_id=commerce_orders.id)
      AND NOT EXISTS (SELECT 1 FROM packlink_sendungen WHERE order_id=commerce_orders.id)
      AND NOT EXISTS (SELECT 1 FROM widerrufe WHERE order_id=commerce_orders.id)
      AND NOT EXISTS (SELECT 1 FROM erstattungsauftraege WHERE order_id=commerce_orders.id)`).bind(order.id),
  ]);
  if (!result[result.length - 1]?.meta?.changes) throw new AdminError("ORDER_DELETE_STATE_CHANGED", 409);
  await auditAdmin(env, "order", order.id, "UNPAID_TEST_ORDER_DELETED", reqId, {
    orderNumber: order.order_number,
    deletedAt: now,
  });
  return { ok: true, deleted: true, orderNumber: order.order_number };
}

// optionen.nurInventar: nur diese Lagerstuecke wechseln mit (Teilruecksendung:
// behaltene Stuecke bleiben "Zugestellt"); null = alle wie bisher.
async function updateOrder(env, id, body, reqId, actorType = "ADMIN", optionen = {}) {
  const db = requireDb(env);
  const order = await db.prepare("SELECT * FROM commerce_orders WHERE id=? OR order_number=?").bind(id, id).first();
  if (!order) throw new AdminError("ORDER_NOT_FOUND", 404);
  const newStatus = safeText(body.status, 40).toUpperCase();
  const trackingNumber = safeText(body.trackingNumber, 160);
  const carrier = safeText(body.carrier, 80);
  const service = safeText(body.service, 100);
  const now = new Date().toISOString();
  const nurInventar = Array.isArray(optionen?.nurInventar) ? optionen.nurInventar.map(String) : null;

  if (newStatus) {
    if (!ORDER_STATUSES.includes(newStatus) || !canTransitionOrder(order.status, newStatus)) throw new AdminError("INVALID_ORDER_STATUS_TRANSITION", 409);
    if (newStatus === "PAID") throw new AdminError("PAYMENT_PROVIDER_REQUIRED", 409);
    // Laeuft eine Stornierung oder liegt ein Widerruf vor dem Versand vor,
    // darf der Versandknopf das Paket nicht mehr auf den Weg bringen. Die
    // Sendungsverfolgung (SYSTEM) bleibt frei: Ist ein Paket wirklich
    // unterwegs, gilt das - der Auftrag haelt dann selbst an.
    if (newStatus === "SHIPPED" && order.status !== "SHIPPED" && actorType === "ADMIN") {
      const sperre = await versandSperre(db, order.id);
      if (sperre) throw /^ZAHLUNG_/.test(sperre.code) ? new ZahlungFehler(sperre.code, 409, sperre.text) : new AdminError(sperre.code, 409);
      // Erst das Geld, dann das Paket: eine nur reservierte Zahlung wird
      // jetzt eingezogen. Klappt das nicht, bleibt die Bestellung, wie sie ist.
      await zahlungSicherstellen(env, order.id, reqId, { anlass: "VERSENDET" });
    }
    // Die Sendungsverfolgung meldet "unterwegs": das gilt, Geld hin oder her.
    // Einziehen trotzdem sofort versuchen - scheitert es, meldet zahlung.js
    // sich beim Inhaber, und der Cron versucht es weiter.
    if (newStatus === "SHIPPED" && order.status !== "SHIPPED" && actorType !== "ADMIN") {
      try {
        await zahlungEinziehen(env, order.id, reqId, { anlass: "VERSENDET" });
      } catch (err) {
        console.error(JSON.stringify({ level: "error", event: "capture_on_tracking_failed", requestId: reqId,
          orderId: String(order.id), message: safeText(err?.message || "unknown", 160) }));
      }
    }
    if (newStatus === "REFUNDED") {
      const refunded = await db.prepare("SELECT COALESCE(SUM(amount_cents),0) AS cents FROM refunds WHERE order_id=? AND status='COMPLETED'").bind(order.id).first();
      if (Number(refunded?.cents || 0) < Number(order.total_cents || 0)) throw new AdminError("REFUND_NOT_COMPLETED", 409);
    }
    const statements = [
      db.prepare(`UPDATE commerce_orders SET status=?,updated_at=? WHERE id=? AND status=?
        AND (? != 'CANCELLED' OR NOT EXISTS (SELECT 1 FROM payments p WHERE p.order_id=commerce_orders.id
          AND p.status IN ('PENDING','AUTHORIZED','COMPLETED','REFUNDED','PARTIALLY_REFUNDED')))`)
        .bind(newStatus, now, order.id, order.status, newStatus),
    ];
    if (newStatus === "CANCELLED") {
      statements.push(db.prepare(`UPDATE reservations SET status='CANCELLED',updated_at=?
        WHERE status='RESERVED' AND id IN (SELECT r.id FROM reservations r
          JOIN order_items oi ON oi.inventory_id=r.inventory_id
          JOIN commerce_orders o ON o.id=oi.order_id
          WHERE o.id=? AND o.status='CANCELLED'
            AND (r.id=o.reservation_id OR r.idempotency_key=o.idempotency_key || '#' || oi.item_id))`)
        .bind(now, order.id));
      statements.push(db.prepare(`UPDATE payments SET status='CANCELLED',updated_at=?
        WHERE order_id=? AND status='CREATED'
        AND EXISTS (SELECT 1 FROM commerce_orders o WHERE o.id=payments.order_id AND o.status='CANCELLED')`)
        .bind(now, order.id));
      // Auch "Bezahlt"/"Wird gepackt": das ist der Storno einer nur
      // reservierten (inzwischen freigegebenen) oder gescheiterten Zahlung.
      statements.push(db.prepare(`UPDATE inventory SET status='CANCELLED',updated_at=?,version=version+1
        WHERE id IN (SELECT inventory_id FROM order_items WHERE order_id=?) AND status IN ('RESERVED','PAYMENT_PENDING','PAID','PREPARING')
        AND EXISTS (SELECT 1 FROM commerce_orders WHERE id=? AND status='CANCELLED')`).bind(now, order.id, order.id));
      statements.push(db.prepare(`UPDATE inventory SET status='AVAILABLE',updated_at=?,version=version+1
        WHERE id IN (SELECT inventory_id FROM order_items WHERE order_id=?) AND status='CANCELLED'
        AND catalog_status!='SOLD' AND EXISTS (SELECT 1 FROM commerce_orders WHERE id=? AND status='CANCELLED')`).bind(now, order.id, order.id));
    } else if (nurInventar) {
      if (nurInventar.length) {
        statements.push(db.prepare(`UPDATE inventory SET status=?,updated_at=?,version=version+1
          WHERE id IN (SELECT inventory_id FROM order_items WHERE order_id=?)
            AND id IN (${nurInventar.map(() => "?").join(",")})
            AND status NOT IN ('AVAILABLE','RESERVED','PAYMENT_PENDING')`).bind(newStatus, now, order.id, ...nurInventar));
      }
    } else {
      // Ein Stueck, das nach einem Storno wieder im Shop steht (verfuegbar,
      // reserviert, in einer neuen Zahlung), gehoert nicht mehr zu dieser
      // Bestellung - ihr Statuswechsel darf es nicht mitziehen.
      statements.push(db.prepare(`UPDATE inventory SET status=?,updated_at=?,version=version+1
        WHERE id IN (SELECT inventory_id FROM order_items WHERE order_id=?)
          AND status NOT IN ('AVAILABLE','RESERVED','PAYMENT_PENDING')`).bind(newStatus, now, order.id));
    }
    const changed = await db.batch(statements);
    if (!changed[0]?.meta?.changes) throw new AdminError("ORDER_STATE_CHANGED", 409);
    await auditAdmin(env, "order", order.id, `ORDER_${newStatus}`, reqId, { from: order.status, to: newStatus }, actorType);
  }

  const effectiveStatus = newStatus || order.status;
  if (trackingNumber || carrier || service || effectiveStatus === "SHIPPED") {
    let shipment = await db.prepare("SELECT * FROM shipments WHERE order_id=? ORDER BY created_at DESC LIMIT 1").bind(order.id).first();
    if (!shipment) {
      shipment = { id: crypto.randomUUID() };
      await db.prepare(`INSERT INTO shipments
        (id,order_id,carrier,service,tracking_number,status,shipped_at,created_at,updated_at)
        VALUES (?,?,?,?,?,'PENDING',NULL,?,?)`).bind(shipment.id, order.id, carrier || null, service || null, trackingNumber || null, now, now).run();
    }
    const shipmentStatus = effectiveStatus === "SHIPPED" ? "SHIPPED" : effectiveStatus === "DELIVERED" ? "DELIVERED" : null;
    await db.prepare(`UPDATE shipments SET
      carrier=COALESCE(NULLIF(?,''),carrier), service=COALESCE(NULLIF(?,''),service), tracking_number=COALESCE(NULLIF(?,''),tracking_number),
      status=COALESCE(?,status), shipped_at=CASE WHEN ?='SHIPPED' THEN COALESCE(shipped_at,?) ELSE shipped_at END,
      delivered_at=CASE WHEN ?='DELIVERED' THEN COALESCE(delivered_at,?) ELSE delivered_at END, updated_at=? WHERE id=?`)
      .bind(carrier, service, trackingNumber, shipmentStatus, shipmentStatus, now, shipmentStatus, now, now, shipment.id).run();
    await auditAdmin(env, "shipment", shipment.id, "SHIPMENT_UPDATED", reqId, { orderId: order.id, status: shipmentStatus || undefined, carrier: carrier || undefined, tracking: Boolean(trackingNumber) }, actorType);
  } else if (effectiveStatus === "DELIVERED") {
    await db.prepare("UPDATE shipments SET status='DELIVERED',delivered_at=COALESCE(delivered_at,?),updated_at=? WHERE order_id=?")
      .bind(now, now, order.id).run();
  }

  // Sobald die Bestellung auf SHIPPED steht, bekommt die Kundin die
  // Sendungsnummer. Ohne diese Mail muesste sie im Konto nachsehen, um
  // ueberhaupt zu erfahren, dass das Paket unterwegs ist.
  //
  // Bewusst nach dem Speichern und bewusst nicht blockierend: ein Aussetzer
  // beim Mailanbieter darf den Versandeintrag nicht verhindern. Die
  // Verdopplungssperre haengt an der Sendungsnummer, ein erneuter Aufruf
  // schickt also nichts zweimal.
  if (effectiveStatus === "SHIPPED") {
    try {
      await sendShippingConfirmation(env, order.id, reqId);
    } catch (err) {
      console.error(JSON.stringify({
        level: "error",
        event: "shipping_confirmation_failed",
        requestId: reqId,
        orderId: String(order.id),
        message: String(err?.message || "unknown").slice(0, 180),
      }));
    }
  }

  return getOrderDetail(env, order.id);
}

// ----------------------------------------------------------------- Stornieren
//
// Ein Knopf fuer jede Lage (Admin-App, Bestellung -> "Stornieren"):
//   * unbezahlt (Zahlung offen, reserviert): Status "Storniert", die Stuecke
//     sind sofort wieder frei.
//   * bezahlt und noch nicht beim Paketdienst (Bezahlt, Wird gepackt): das
//     Geld geht ueber die urspruengliche PayPal-Zahlung zurueck
//     (erstattung.js, keine neue Geldsendung), die Bestellung wird
//     "Erstattet" und - wenn gewuenscht - stehen die Stuecke wieder im Shop.
//   * schon versendet: nicht hier - erst Ruecksendung, dann erstatten.
// Bezahlte Bestellungen verschwinden nie: Sie sind Buchungsbelege.
const STORNO_UNBEZAHLT = Object.freeze(["PAYMENT_PENDING", "RESERVED"]);
const STORNO_BEZAHLT = Object.freeze(["PAID", "PREPARING"]);

// zahlung: zahlungView (zahlung.js). Nur reserviert -> FREIGEBEN (keine
// PayPal-Gebuehr), Einziehen gescheitert oder schon freigegeben -> einfach
// STORNIEREN (es ist kein Geld da), eingezogen -> ERSTATTEN.
function stornoAngebot(order, zahlung = null) {
  const status = String(order?.status || "").toUpperCase();
  if (STORNO_UNBEZAHLT.includes(status)) return { moeglich: true, art: "STORNIEREN" };
  if (STORNO_BEZAHLT.includes(status)) {
    if (zahlung?.reserviert) return { moeglich: true, art: "FREIGEBEN", wirdGeprueft: Boolean(zahlung.wirdGeprueft) };
    if (zahlung && (zahlung.gescheitert || zahlung.freigegeben)) return { moeglich: true, art: "STORNIEREN", ohneZahlung: true };
    return { moeglich: true, art: "ERSTATTEN" };
  }
  return { moeglich: false, art: null };
}

// "Wieder in den Shop": nur aus den Endzustaenden Storniert und Erstattet -
// danach aendert sich an der Bestellung nichts mehr, das das Stueck zurueck
// an sie binden koennte.
function wiederVerfuegbarStand(order, items, activity, { warVerkauft = false } = {}) {
  const status = String(order?.status || "").toUpperCase();
  const letzte = activity.find(e => e.event_type === "ORDER_ITEMS_RELISTED");
  const erledigt = Boolean(letzte?.metadata?.katalog);
  const lager = it => String(it.inventory_status || "");
  // Offen: das Lagerstueck haengt noch an dieser Bestellung - oder es ist frei,
  // aber der Katalog-Schritt hat noch nie geklappt. Gehoert es inzwischen einer
  // anderen Bestellung (reserviert, bezahlt ...), gibt es nichts zu tun.
  // Storniert nach einer aufgehobenen Reservierung: im Katalog steht das Stueck
  // als verkauft, bis der Pull Request "Wieder verfuegbar" gemergt ist.
  const verkauftGewesen = status === "REFUNDED" || (status === "CANCELLED" && warVerkauft);
  const offen = items.some(it => ["REFUNDED", "CANCELLED"].includes(lager(it)))
    || (verkauftGewesen && !erledigt && items.some(it => lager(it) === "AVAILABLE"));
  return {
    moeglich: ["REFUNDED", "CANCELLED"].includes(status) && offen,
    erledigtAm: erledigt ? letzte.created_at : null,
    pullRequest: letzte?.metadata?.pullRequest ?? null,
  };
}

async function packlinkEtikettOffen(db, orderId) {
  const row = await db.prepare(`SELECT reference,state FROM packlink_sendungen WHERE order_id=?
    AND state NOT IN ('ERSETZT','KAUF_ABGELEHNT','AWAITING_COMPLETION','READY_TO_PURCHASE','CANCELED','CANCELLED')
    ORDER BY created_at DESC LIMIT 1`).bind(orderId).first();
  if (!row || String(row.reference).startsWith("kauf-")) return row ? { reference: null, state: row.state } : null;
  return { reference: row.reference, state: row.state };
}

export async function stueckeWiederVerfuegbar(env, id, reqId) {
  const db = requireDb(env);
  const order = await db.prepare("SELECT * FROM commerce_orders WHERE id=? OR order_number=?").bind(id, id).first();
  if (!order) throw new AdminError("ORDER_NOT_FOUND", 404);
  if (!["REFUNDED", "CANCELLED"].includes(order.status)) throw new AdminError("WIEDER_VERFUEGBAR_NICHT_MOEGLICH", 409);
  // Lager zuerst, dann der Katalog ueber einen Pull Request - dieselbe
  // Funktion nutzt der Erstattungsauftrag nach der Rueckzahlung.
  return stueckeZurueckInDenShop(env, order, null, reqId, "Storno");
}

// Abhaengigkeiten fuer Erstattungsauftraege und Widerrufe: der Statuswechsel
// laeuft ueber updateOrder (Statuspruefung, Lagerstueck, Protokoll).
function auftragDeps(env, reqId) {
  return {
    statusSetzen: (orderId, status, opt = {}) =>
      updateOrder(env, orderId, { status }, reqId, opt.actor || "SYSTEM", { nurInventar: opt.nurInventar ?? null }),
    abgleichen: () => paypalErstattungenAbgleichen(env, reqId, true),
  };
}

const TAG_MS = 24 * 60 * 60 * 1000;

// Was die Admin-App fuer Ruecksendung, Widerruf und Kulanz anbietet.
// zahlung: zahlungView - Kulanz (Teilbetrag) geht nur aus eingezogenem Geld.
function ruecklaufAngebot(order, items, shipments, refunds, widerrufe, laufend, zahlung = null) {
  const status = String(order?.status || "");
  const erstattet = refunds.filter(r => r.status === "COMPLETED").reduce((summe, r) => summe + Number(r.amount_cents || 0), 0);
  const offenCents = Math.max(0, Number(order?.total_cents || 0) - erstattet);
  const zugestellt = shipments.map(s => s.delivered_at).filter(Boolean).sort()[0] || null;
  const widerruf = widerrufe.find(w => w.offen) || null;
  const bezahlt = ["PAID", "PREPARING", "SHIPPED", "DELIVERED", "RETURN_REQUESTED", "RETURNED"].includes(status);
  return {
    offenCents,
    erstattetCents: erstattet,
    versandCents: Number(order?.shipping_cents || 0),
    zugestelltAm: zugestellt,
    // Die Kundin kann 14 Tage ab Erhalt der Ware widerrufen.
    widerrufsfristBis: zugestellt ? new Date(Date.parse(zugestellt) + 14 * TAG_MS).toISOString() : null,
    offenerWiderruf: widerruf,
    ruecksendungAnlegen: !laufend && ["SHIPPED", "DELIVERED", "RETURN_REQUESTED"].includes(status),
    wareEingegangen: !laufend && offenCents > 0 && ["SHIPPED", "DELIVERED", "RETURN_REQUESTED", "RETURNED"].includes(status),
    kulanz: !laufend && bezahlt && offenCents > 0 && Boolean(zahlung?.eingezogen),
    stuecke: items.map(it => ({
      itemId: Number(it.item_id),
      titel: it.title_snapshot,
      artikelNr: it.article_no || null,
      preisCents: Number(it.unit_price_cents || 0),
      lager: it.inventory_status || null,
    })),
  };
}

function auftragAntwort(ergebnis, detail, extra = {}) {
  const auftrag = ergebnis?.auftrag || null;
  return {
    ...detail,
    auftrag,
    // Fuer aeltere Admin-App-Staende: dieselben Felder wie vor den Auftraegen.
    erstattung: auftrag ? {
      betragCents: auftrag.betragCents,
      ausstehend: auftrag.status !== "ERLEDIGT",
      status: auftrag.status,
      bereits: Boolean(ergebnis.bereits),
    } : null,
    ...extra,
  };
}

async function orderStornieren(env, id, body, reqId) {
  const db = requireDb(env);
  const order = await db.prepare("SELECT * FROM commerce_orders WHERE id=? OR order_number=?").bind(id, id).first();
  if (!order) throw new AdminError("ORDER_NOT_FOUND", 404);
  // Laeuft schon ein Auftrag, versucht ein erneuter Klick ihn sofort wieder
  // (erstattungBeauftragen) - es entsteht kein zweiter.
  const zahlung = zahlungView(await zahlungDerBestellung(db, order.id));
  const angebot = stornoAngebot(order, zahlung);
  if (!angebot.moeglich) throw new AdminError("STORNO_NICHT_MOEGLICH", 409);
  if (angebot.art === "STORNIEREN") {
    // Einziehen gescheitert: eine etwa noch bestehende Vormerkung bei der
    // Kundin trotzdem aufheben (ohne Geld, ohne Gebuehr).
    if (angebot.ohneZahlung && zahlung?.gescheitert) await reservierungFreigeben(env, order.id, reqId);
    await updateOrder(env, order.id, { status: "CANCELLED" }, reqId);
    // War die Bestellung schon verkauft (Katalog "Verkauft"), kommen die
    // Stuecke auf Wunsch zurueck in den Shop.
    let wieder = null;
    if (angebot.ohneZahlung && body?.wiederVerfuegbar !== false) {
      wieder = await stueckeZurueckInDenShop(env, { ...order, status: "CANCELLED" }, null, reqId, "Storno");
    }
    return {
      ...(await getOrderDetail(env, order.id)),
      storniert: { art: "STORNIERT", wiederVerfuegbar: wieder ? { ok: wieder.ok, pullRequest: wieder.pullRequest ?? null } : null },
    };
  }
  // Ein schon gekauftes Etikett bleibt gueltig - Packlink erstattet das Porto
  // nur, wenn man es dort storniert. Darauf weist die Admin-App hin.
  const etikett = await packlinkEtikettOffen(db, order.id);
  // Bezahlt: ein Erstattungsauftrag. Klappt PayPal sofort, ist alles erledigt
  // (Status, Stueck zurueck im Shop, Mail an die Kundin). Fehlt Guthaben,
  // wartet der Auftrag und versucht es selbst erneut.
  const ergebnis = await erstattungBeauftragen(env, order.id, {
    anlass: "STORNO",
    wiederVerfuegbar: body?.wiederVerfuegbar !== false,
  }, reqId, auftragDeps(env, reqId));
  const detail = await getOrderDetail(env, order.id);
  const erledigt = ergebnis.auftrag?.status === "ERLEDIGT";
  const freigegeben = ergebnis.auftrag?.ergebnis === "FREIGEGEBEN";
  return auftragAntwort(ergebnis, detail, {
    storniert: {
      // FREIGEGEBEN: nur reserviert, nichts abgebucht, keine Gebuehr.
      art: erledigt ? (freigegeben ? "FREIGEGEBEN" : "ERSTATTET") : angebot.art === "FREIGEBEN" ? "FREIGABE_LAEUFT" : "ERSTATTUNG_LAEUFT",
      wiederVerfuegbar: detail.wiederVerfuegbar?.erledigtAm
        ? { ok: true, pullRequest: detail.wiederVerfuegbar.pullRequest ?? null }
        : null,
      etikett,
    },
  });
}

// "Erstatten" fuer jede Lage: vor dem Versand wie Stornieren, nach einer
// Ruecksendung die zurueckgekommenen Stuecke, sonst Kulanz mit Betrag und Grund.
async function orderErstatten(env, id, body = {}, reqId) {
  const db = requireDb(env);
  const order = await db.prepare("SELECT * FROM commerce_orders WHERE id=? OR order_number=?").bind(id, id).first();
  if (!order) throw new AdminError("ORDER_NOT_FOUND", 404);
  // Schon alles zurueck: nichts zu tun (auch nicht bei einem zweiten Klick).
  if (order.status === "REFUNDED") {
    return { ...(await getOrderDetail(env, order.id)), auftrag: null, erstattung: { bereits: true, betragCents: 0 } };
  }
  let anlass = safeText(body.anlass || "", 20).toUpperCase();
  if (!anlass) {
    if (["PAID", "PREPARING"].includes(order.status)) anlass = "STORNO";
    else if (["RETURN_REQUESTED", "RETURNED"].includes(order.status)) {
      const widerruf = (await widerrufeFuerBestellung(db, order.id)).find(w => w.offen);
      anlass = widerruf ? "WIDERRUF" : "RUECKSENDUNG";
    } else throw new AdminError("ERSTATTUNG_STATUS", 409);
  }
  const ergebnis = await erstattungBeauftragen(env, order.id, { ...body, anlass }, reqId, auftragDeps(env, reqId));
  return auftragAntwort(ergebnis, await getOrderDetail(env, order.id));
}

// Fuer automatische Schritte aus der Sendungsverfolgung (packlink.js): derselbe
// Weg wie der Statusknopf in der Admin-App - Statuspruefung, Lagerstueck,
// Versandmail -, nur im Protokoll als SYSTEM statt ADMIN vermerkt.
export async function orderStatusAutomatisch(env, orderId, status, reqId = crypto.randomUUID()) {
  return updateOrder(env, orderId, { status }, reqId, "SYSTEM");
}

// PayPal meldet eine Erstattung (auch direkt in PayPal ausgeloest).
export async function erstattungAusPaypal(env, event, reqId = crypto.randomUUID()) {
  if (!env.DB) return null;
  const ergebnis = await erstattungAusWebhook(env, event, reqId, (orderId, status) => updateOrder(env, orderId, { status }, reqId, "PAYMENT_PROVIDER"));
  // Ist damit das Geld eines laufenden Auftrags zurueck (auch: direkt in
  // PayPal erstattet), geht die Kundenmail jetzt raus und nicht erst beim
  // naechsten Cron-Lauf.
  if (ergebnis?.orderId) {
    try {
      await auftraegeDerBestellungPruefen(env, ergebnis.orderId, reqId, auftragDeps(env, reqId));
    } catch (err) {
      console.error(JSON.stringify({ level: "error", event: "refund_job_webhook_followup_failed", requestId: reqId, code: safeText(err?.code || err?.message || "unknown", 120) }));
    }
  }
  return ergebnis;
}

// Cron: Erstattungsauftraege (faellige Versuche, PayPal-Stand, Nacharbeit,
// Erinnerungen) und Widerrufe (Bestaetigungen nachholen, Erinnerungen).
export async function ruecklaufPflegen(env, reqId = crypto.randomUUID(), now = new Date()) {
  if (!env?.DB) return { ok: false };
  const erstattungen = await erstattungsauftraegePflegen(env, reqId, auftragDeps(env, reqId), now);
  const widerrufe = await widerrufePflegen(env, reqId, now);
  return { ok: erstattungen.ok && widerrufe.ok, erstattungen, widerrufe };
}

// Cron: reservierte Zahlungen spaetestens am Ende der PayPal-Garantiezeit
// einziehen (nicht, solange ein Storno vor dem Versand laeuft), gepruefte
// Abbuchungen nachfragen, Rechnungsmails nachholen.
export async function zahlungenPflegen(env, reqId = crypto.randomUUID(), now = new Date()) {
  if (!env?.DB) return { ok: false };
  return faelligeZahlungenEinziehen(env, reqId, now, { sperre: orderId => versandSperre(env.DB, orderId, { mitZahlung: false }) });
}

// Oeffentliche Widerrufsfunktion (POST /widerruf von der Website).
export function widerrufVonWebsite(request, env, url, reqId, origin) {
  return handleWiderruf(request, env, url, reqId, origin, auftragDeps(env, reqId));
}

// Widerruf aus dem Kundenkonto: derselbe Weg wie die Website, nur mit der
// schon feststehenden Bestellung.
export function widerrufAusKonto(env, orderId, reqId = crypto.randomUUID()) {
  return widerrufErfassen(env, { orderId }, { quelle: "KONTO", reqId, deps: auftragDeps(env, reqId) });
}

export async function paypalErstattungenAbgleichen(env, reqId = crypto.randomUUID(), force = false) {
  return paypalErstattungenAbgleichenMitStatus(
    env,
    reqId,
    (orderId, status) => updateOrder(env, orderId, { status }, reqId, "PAYMENT_PROVIDER"),
    { force },
  );
}

async function paypalErstattungenSicherAbgleichen(env, reqId, force = false) {
  try {
    return await paypalErstattungenAbgleichen(env, reqId, force);
  } catch (err) {
    console.error(JSON.stringify({
      level: "error",
      event: "paypal_refund_reconciliation_failed",
      requestId: reqId,
      code: safeText(err?.code || "PAYPAL_REFUND_SYNC_FAILED", 80),
    }));
    return {
      ok: false,
      configured: Boolean(env.PAYPAL_CLIENT_ID && env.PAYPAL_CLIENT_SECRET),
      code: safeText(err?.code || "PAYPAL_REFUND_SYNC_FAILED", 80),
      checkedAt: new Date().toISOString(),
    };
  }
}

async function getRentals(env, url) {
  const db = requireDb(env);
  const limit = clampAdminLimit(url.searchParams.get("limit"));
  const offset = clampAdminOffset(url.searchParams.get("offset"));
  const status = safeText(url.searchParams.get("status"), 40).toUpperCase();
  const q = safeText(url.searchParams.get("q"), 120);
  if (status && !RENTAL_STATUSES.includes(status)) throw new AdminError("INVALID_RENTAL_STATUS", 400);
  const where = [];
  const binds = [];
  if (status) { where.push("rr.status=?"); binds.push(status); }
  if (q) {
    const like = `%${q}%`;
    where.push("(CAST(i.item_id AS TEXT) LIKE ? OR i.article_no LIKE ? OR rr.group_id LIKE ? OR rr.purpose LIKE ? OR rr.message LIKE ?)");
    binds.push(like, like, like, like, like);
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const count = await db.prepare(`SELECT COUNT(*) AS total FROM rental_reservations rr JOIN inventory i ON i.id=rr.inventory_id ${clause}`).bind(...binds).first();
  const rows = await db.prepare(`SELECT rr.*,i.item_id AS itemId,i.article_no AS articleNo,i.status AS inventoryStatus,i.sale_price_cents AS salePriceCents,
      (SELECT n.body FROM admin_notes n WHERE n.entity_type='RENTAL' AND n.entity_id=rr.id ORDER BY n.created_at DESC LIMIT 1) AS latestNote
    FROM rental_reservations rr JOIN inventory i ON i.id=rr.inventory_id ${clause}
    ORDER BY rr.created_at DESC LIMIT ? OFFSET ?`).bind(...binds, limit, offset).all();
  const catalog = await loadCatalogMap();
  return {
    total: Number(count?.total || 0), limit, offset,
    rentals: (rows.results || []).map(row => ({
      ...row,
      catalog: catalogView(catalog.get(Number(row.itemId))),
      nextStatuses: rentalNextStatuses(row.status),
    })),
  };
}

async function getRentalDetail(env, id) {
  const db = requireDb(env);
  const rental = await db.prepare(`SELECT rr.*,i.item_id AS itemId,i.article_no AS articleNo,i.status AS inventoryStatus,i.sale_price_cents AS salePriceCents
    FROM rental_reservations rr JOIN inventory i ON i.id=rr.inventory_id WHERE rr.id=?`).bind(id).first();
  if (!rental) throw new AdminError("RENTAL_NOT_FOUND", 404);
  const [days, records, returns, refunds, events, notes] = await db.batch([
    db.prepare("SELECT rental_date AS rentalDate FROM rental_days WHERE rental_reservation_id=? ORDER BY rental_date").bind(id),
    db.prepare("SELECT * FROM rentals WHERE rental_reservation_id=?").bind(id),
    db.prepare("SELECT * FROM returns WHERE rental_id IN (SELECT id FROM rentals WHERE rental_reservation_id=?) ORDER BY created_at DESC").bind(id),
    db.prepare("SELECT * FROM refunds WHERE rental_id IN (SELECT id FROM rentals WHERE rental_reservation_id=?) ORDER BY created_at DESC").bind(id),
    db.prepare("SELECT * FROM audit_events WHERE entity_id=? ORDER BY created_at DESC LIMIT 200").bind(id),
    db.prepare("SELECT * FROM admin_notes WHERE entity_type='RENTAL' AND entity_id=? ORDER BY created_at DESC").bind(id),
  ]);
  const catalog = await loadCatalogMap();
  return {
    rental: { ...rental, catalog: catalogView(catalog.get(Number(rental.itemId))) },
    nextStatuses: rentalNextStatuses(rental.status),
    reservedDays: days.results || [],
    rentalRecords: records.results || [],
    returns: returns.results || [],
    refunds: refunds.results || [],
    notes: notes.results || [],
    activity: (events.results || []).map(row => ({ ...row, metadata: parseMetadata(row.metadata_json) })),
  };
}

async function updateRental(env, id, body, reqId) {
  const db = requireDb(env);
  const row = await db.prepare("SELECT id,inventory_id,status FROM rental_reservations WHERE id=?").bind(id).first();
  if (!row) throw new AdminError("RENTAL_NOT_FOUND", 404);
  const status = safeText(body.status, 40).toUpperCase();
  if (!status || !RENTAL_STATUSES.includes(status) || !canTransitionRental(row.status, status)) throw new AdminError("INVALID_RENTAL_STATUS_TRANSITION", 409);
  const now = new Date().toISOString();
  await db.prepare("UPDATE rental_reservations SET status=?,updated_at=? WHERE id=? AND status=?").bind(status, now, id, row.status).run();
  if (["RETURNED","CANCELLED","REFUNDED"].includes(status)) {
    await db.batch([
      db.prepare("DELETE FROM rental_days WHERE rental_reservation_id=?").bind(id),
      db.prepare(`UPDATE inventory SET status='AVAILABLE',updated_at=?,version=version+1 WHERE id=?
        AND NOT EXISTS (SELECT 1 FROM reservations WHERE inventory_id=? AND status='RESERVED')
        AND NOT EXISTS (SELECT 1 FROM rental_reservations WHERE inventory_id=? AND id<>? AND status IN ('RESERVED','PAYMENT_PENDING','CONFIRMED','ACTIVE','RETURN_DUE'))`)
        .bind(now, row.inventory_id, row.inventory_id, row.inventory_id, id),
    ]);
  }
  await db.prepare(`UPDATE rentals SET status=?,updated_at=? WHERE rental_reservation_id=? AND status!=?`)
    .bind(status, now, id, status).run().catch(() => {});
  await auditAdmin(env, "rental_reservation", id, `RENTAL_${status}`, reqId, { from: row.status, to: status });
  return getRentalDetail(env, id);
}

async function getInventory(env, url) {
  const db = requireDb(env);
  const limit = clampAdminLimit(url.searchParams.get("limit"), 100, 1000);
  const status = safeText(url.searchParams.get("status"), 40).toUpperCase();
  const q = safeText(url.searchParams.get("q"), 120).toLowerCase();
  const query = status
    ? db.prepare("SELECT * FROM inventory WHERE status=? ORDER BY updated_at DESC LIMIT ?").bind(status, limit)
    : db.prepare("SELECT * FROM inventory ORDER BY updated_at DESC LIMIT ?").bind(limit);
  const rows = await query.all();
  const catalog = await loadCatalogMap();
  let items = (rows.results || []).map(row => ({ ...row, catalog: catalogView(catalog.get(Number(row.item_id))) }));
  if (q) {
    items = items.filter(row => {
      const c = row.catalog || {};
      return [row.item_id,row.article_no,row.status,c.brand,c.title,c.category,c.size].some(value => String(value || "").toLowerCase().includes(q));
    });
  }
  return { total: items.length, inventory: items };
}

async function getCustomers(env, url) {
  const db = requireDb(env);
  const limit = clampAdminLimit(url.searchParams.get("limit"));
  const offset = clampAdminOffset(url.searchParams.get("offset"));
  const q = safeText(url.searchParams.get("q"), 120).toLowerCase();
  const sql = `WITH raw_guests AS (
      SELECT o.*, LOWER(TRIM(COALESCE(NULLIF(o.guest_email,''),
        (SELECT s.email FROM order_contact_snapshots s WHERE s.order_id=o.id LIMIT 1)))) AS buyer_email
      FROM commerce_orders o WHERE o.customer_id IS NULL
    ), guest_orders AS (
      SELECT raw_guests.*,ROW_NUMBER() OVER (PARTITION BY buyer_email ORDER BY created_at,id) AS first_rank
      FROM raw_guests
    ), buyers AS (
      SELECT c.id,c.email_normalized,c.email_verified,c.status,c.created_at,c.updated_at,
      (SELECT COUNT(*) FROM commerce_orders o WHERE o.customer_id=c.id) AS orderCount,
      (SELECT COALESCE(SUM(total_cents),0) FROM commerce_orders o WHERE o.customer_id=c.id
        AND EXISTS (SELECT 1 FROM payments p WHERE p.order_id=o.id
          AND p.status IN ('COMPLETED','REFUNDED','PARTIALLY_REFUNDED') AND p.provider_payment_id IS NOT NULL)) AS orderValueCents,
      (SELECT COUNT(*) FROM rental_reservations rr WHERE rr.customer_id=c.id) AS rentalCount
      FROM customers c
      UNION ALL
      SELECT 'guest-order:' || MAX(CASE WHEN g.first_rank=1 THEN g.id END),g.buyer_email,0,'GUEST',MIN(g.created_at),MAX(g.created_at),
        COUNT(*),COALESCE(SUM(CASE WHEN EXISTS (SELECT 1 FROM payments p WHERE p.order_id=g.id
          AND p.status IN ('COMPLETED','REFUNDED','PARTIALLY_REFUNDED') AND p.provider_payment_id IS NOT NULL)
          THEN g.total_cents ELSE 0 END),0),0
      FROM guest_orders g WHERE g.buyer_email IS NOT NULL AND g.buyer_email != '' GROUP BY g.buyer_email
    )`;
  const where = q ? "WHERE email_normalized LIKE ? OR id LIKE ?" : "";
  const binds = q ? [`%${q}%`, `%${q}%`] : [];
  const count = await db.prepare(`${sql} SELECT COUNT(*) AS total FROM buyers ${where}`).bind(...binds).first();
  const rows = await db.prepare(`${sql} SELECT * FROM buyers ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).bind(...binds, limit, offset).all();
  return { total: Number(count?.total || 0), limit, offset, customers: rows.results || [] };
}

async function getCustomerDetail(env, id) {
  const db = requireDb(env);
  if (id.startsWith("guest-order:")) {
    const orderId = id.slice("guest-order:".length);
    const first = await db.prepare(`SELECT LOWER(TRIM(COALESCE(NULLIF(o.guest_email,''),
      (SELECT s.email FROM order_contact_snapshots s WHERE s.order_id=o.id LIMIT 1)))) AS email
      FROM commerce_orders o WHERE o.id=? AND o.customer_id IS NULL`).bind(orderId).first();
    if (!first?.email) throw new AdminError("CUSTOMER_NOT_FOUND", 404);
    const orders = await db.prepare(`SELECT o.id,o.order_number,o.status,o.total_cents,o.currency,o.created_at,o.updated_at
      FROM commerce_orders o WHERE o.customer_id IS NULL AND LOWER(TRIM(COALESCE(NULLIF(o.guest_email,''),
      (SELECT s.email FROM order_contact_snapshots s WHERE s.order_id=o.id LIMIT 1))))=?
      ORDER BY o.created_at DESC LIMIT 100`).bind(first.email).all();
    const notes = await db.prepare("SELECT * FROM admin_notes WHERE entity_type='CUSTOMER' AND entity_id=? ORDER BY created_at DESC")
      .bind(id).all();
    return { customer: { id, email_normalized: first.email, email_verified: 0, status: "GUEST",
      created_at: orders.results?.at(-1)?.created_at }, addresses: [], orders: orders.results || [], rentals: [], notes: notes.results || [] };
  }
  const customer = await db.prepare("SELECT id,email_normalized,email_verified,status,created_at,updated_at,deleted_at FROM customers WHERE id=?").bind(id).first();
  if (!customer) throw new AdminError("CUSTOMER_NOT_FOUND", 404);
  const [addresses, orders, rentals, notes] = await db.batch([
    db.prepare("SELECT * FROM customer_addresses WHERE customer_id=? ORDER BY is_default DESC,created_at DESC").bind(id),
    db.prepare("SELECT id,order_number,status,total_cents,currency,created_at,updated_at FROM commerce_orders WHERE customer_id=? ORDER BY created_at DESC LIMIT 100").bind(id),
    db.prepare("SELECT id,start_date,end_date,status,total_price_cents,deposit_cents,currency,created_at FROM rental_reservations WHERE customer_id=? ORDER BY created_at DESC LIMIT 100").bind(id),
    db.prepare("SELECT * FROM admin_notes WHERE entity_type='CUSTOMER' AND entity_id=? ORDER BY created_at DESC").bind(id),
  ]);
  return { customer, addresses: addresses.results || [], orders: orders.results || [], rentals: rentals.results || [], notes: notes.results || [] };
}

async function getActivity(env, url) {
  const db = requireDb(env);
  const limit = clampAdminLimit(url.searchParams.get("limit"), 100, 500);
  const offset = clampAdminOffset(url.searchParams.get("offset"));
  const entityType = safeText(url.searchParams.get("entityType"), 80);
  const q = safeText(url.searchParams.get("q"), 120);
  const where = [];
  const binds = [];
  if (entityType) { where.push("entity_type=?"); binds.push(entityType); }
  if (q) { where.push("(event_type LIKE ? OR entity_id LIKE ? OR request_id LIKE ?)"); const like = `%${q}%`; binds.push(like, like, like); }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const count = await db.prepare(`SELECT COUNT(*) AS total FROM audit_events ${clause}`).bind(...binds).first();
  const rows = await db.prepare(`SELECT * FROM audit_events ${clause} ORDER BY created_at DESC LIMIT ? OFFSET ?`).bind(...binds, limit, offset).all();
  return {
    total: Number(count?.total || 0), limit, offset,
    events: (rows.results || []).map(row => ({ ...row, metadata: parseMetadata(row.metadata_json) })),
  };
}

async function getSystem(env) {
  const db = requireDb(env);
  const tables = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
  const counts = await db.batch([
    db.prepare("SELECT COUNT(*) AS value FROM commerce_orders"),
    db.prepare("SELECT COUNT(*) AS value FROM rental_reservations"),
    db.prepare("SELECT COUNT(*) AS value FROM inventory"),
    db.prepare("SELECT COUNT(*) AS value FROM audit_events"),
    db.prepare("SELECT COUNT(*) AS value FROM payment_events WHERE processed_at IS NULL"),
    db.prepare("SELECT COUNT(*) AS value FROM idempotency_keys WHERE expires_at<=datetime('now')"),
  ]);
  const value = result => Number(result?.results?.[0]?.value || 0);
  return {
    generatedAt: new Date().toISOString(),
    schemaTarget: "0004_admin_operations",
    configured: {
      database: Boolean(env.DB),
      adminToken: Boolean(env.ADMIN_TOKEN),
      githubCatalogWrite: Boolean(env.GITHUB_TOKEN),
      paypal: Boolean(env.PAYPAL_CLIENT_ID && env.PAYPAL_CLIENT_SECRET),
      paypalWebhook: Boolean(env.PAYPAL_WEBHOOK_ID),
      turnstile: Boolean(env.TURNSTILE_SECRET),
      rateLimiter: Boolean(env.RATE_LIMITER),
    },
    tables: (tables.results || []).map(row => row.name),
    counts: {
      orders: value(counts[0]), rentals: value(counts[1]), inventory: value(counts[2]),
      auditEvents: value(counts[3]), unprocessedPaymentEvents: value(counts[4]), expiredIdempotencyKeys: value(counts[5]),
    },
  };
}

async function createNote(env, body, reqId) {
  const db = requireDb(env);
  const entityType = safeText(body.entityType, 40).toUpperCase();
  const entityId = safeText(body.entityId, 160);
  const note = safeText(body.body, 4000);
  const allowed = ["ORDER","RENTAL","CUSTOMER","INVENTORY","PAYMENT","SHIPMENT","RETURN"];
  if (!allowed.includes(entityType) || !entityId || !note) throw new AdminError("INVALID_NOTE", 400);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.prepare("INSERT INTO admin_notes (id,entity_type,entity_id,body,created_at) VALUES (?,?,?,?,?)")
    .bind(id, entityType, entityId, note, now).run();
  await auditAdmin(env, entityType.toLowerCase(), entityId, "ADMIN_NOTE_ADDED", reqId, { noteId: id });
  return { id, entityType, entityId, body: note, createdAt: now };
}

function paypalApiBase(env) {
  return String(env.PAYPAL_ENVIRONMENT || "sandbox").toLowerCase() === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";
}

async function paypalAccessToken(env) {
  if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET) return null;
  const creds = btoa(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`);
  const res = await fetch(`${paypalApiBase(env)}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${creds}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.access_token || null;
}

export async function snapshotPaypalOrder(env, providerOrderId, reqId = crypto.randomUUID()) {
  if (!env.DB || !providerOrderId) return false;
  const payment = await env.DB.prepare("SELECT order_id FROM payments WHERE provider='PAYPAL' AND provider_order_id=?").bind(providerOrderId).first();
  if (!payment?.order_id) return false;
  const token = await paypalAccessToken(env);
  if (!token) return false;
  const res = await fetch(`${paypalApiBase(env)}/v2/checkout/orders/${encodeURIComponent(providerOrderId)}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!res.ok) return false;
  const order = await res.json();
  const payer = order.payer || {};
  const name = payer.name || {};
  const shipping = order.purchase_units?.[0]?.shipping || {};
  const address = shipping.address || {};
  const now = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO order_contact_snapshots
    (order_id,source_provider,payer_ref,email,given_name,surname,recipient_name,address_line1,address_line2,postal_code,city,region,country_code,captured_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(order_id) DO UPDATE SET
      payer_ref=excluded.payer_ref,
      email=COALESCE(NULLIF(order_contact_snapshots.email,''),excluded.email),
      given_name=COALESCE(excluded.given_name,order_contact_snapshots.given_name),
      surname=COALESCE(excluded.surname,order_contact_snapshots.surname),
      recipient_name=COALESCE(NULLIF(order_contact_snapshots.recipient_name,''),excluded.recipient_name),
      address_line1=COALESCE(NULLIF(order_contact_snapshots.address_line1,''),excluded.address_line1),
      address_line2=COALESCE(order_contact_snapshots.address_line2,excluded.address_line2),
      postal_code=COALESCE(NULLIF(order_contact_snapshots.postal_code,''),excluded.postal_code),
      city=COALESCE(NULLIF(order_contact_snapshots.city,''),excluded.city),
      region=COALESCE(excluded.region,order_contact_snapshots.region),
      country_code=COALESCE(NULLIF(order_contact_snapshots.country_code,''),excluded.country_code),updated_at=excluded.updated_at`)
    .bind(
      payment.order_id, "PAYPAL", safeText(payer.payer_id, 160) || null, safeText(payer.email_address, 320) || null,
      safeText(name.given_name, 160) || null, safeText(name.surname, 160) || null, safeText(shipping.name?.full_name, 240) || null,
      safeText(address.address_line_1, 240) || null, safeText(address.address_line_2, 240) || null,
      safeText(address.postal_code, 40) || null, safeText(address.admin_area_2, 120) || null,
      safeText(address.admin_area_1, 120) || null, safeText(address.country_code, 8) || null, now, now
    ).run();
  await auditAdmin(env, "order", payment.order_id, "CHECKOUT_SNAPSHOT_UPDATED", reqId, {
    provider: "PAYPAL", hasEmail: Boolean(payer.email_address), hasShippingAddress: Boolean(address.address_line_1),
  });
  return true;
}

function rentalGroupFromPayload(payload) {
  const explicit = safeText(payload?.rentalGroupId, 120);
  if (explicit) return explicit;
  const match = /\[MULTI_ITEM\s+\d+\s+\|[^\]]*\|\s*bundle\s+([A-Za-z0-9_-]+)\]/.exec(String(payload?.message || ""));
  return match ? `rental-v2:${match[1]}` : null;
}

function termsVersionFromPayload(payload) {
  const explicit = safeText(payload?.termsVersion, 120);
  if (explicit) return explicit;
  const match = /\[MULTI_ITEM\s+\d+\s+\|\s*([^|\]]+)/.exec(String(payload?.message || ""));
  return match ? safeText(match[1], 120) : null;
}

export async function enrichRentalReservation(env, rentalId, payload, reqId = crypto.randomUUID()) {
  if (!env.DB || !rentalId) return false;
  const row = await env.DB.prepare(`SELECT rr.id,rr.inventory_id,i.sale_price_cents FROM rental_reservations rr
    JOIN inventory i ON i.id=rr.inventory_id WHERE rr.id=?`).bind(rentalId).first();
  if (!row) return false;
  const sale = Number(row.sale_price_cents);
  const deposit = Number.isSafeInteger(sale) && sale > 0 ? Math.max(5000, Math.round(sale * 0.5)) : null;
  const groupId = rentalGroupFromPayload(payload);
  const termsVersion = termsVersionFromPayload(payload);
  const language = safeText(payload?.termsLanguage || payload?.language, 12) || null;
  const acceptedAt = safeText(payload?.termsAcceptedAt, 40) || null;
  const delivery = ["shipping","pickup"].includes(String(payload?.delivery || "")) ? String(payload.delivery) : null;
  const postal = safeText(payload?.postal, 160) || null;
  const risk = safeText(payload?.risk, 1000) || null;
  await env.DB.prepare(`UPDATE rental_reservations SET
    group_id=?,deposit_cents=?,delivery_method=?,postal_text=?,risk_notes=?,terms_version=?,terms_language=?,terms_accepted_at=?,updated_at=?
    WHERE id=?`).bind(groupId, deposit, delivery, postal, risk, termsVersion, language, acceptedAt, new Date().toISOString(), rentalId).run();
  await auditAdmin(env, "rental_reservation", rentalId, "RENTAL_METADATA_SNAPSHOTTED", reqId, {
    groupId, depositCents: deposit, termsVersion, termsLanguage: language, termsAccepted: Boolean(acceptedAt),
  });
  return true;
}

export async function handleAdminRequest(request, env, url, reqId, origin = null) {
  try {
    if (request.method === "OPTIONS") return adminOptions(origin);
    if (origin && !ADMIN_ORIGINS.includes(origin)) throw new AdminError("ORIGIN_NOT_ALLOWED", 403);
    await requireAdmin(request, env);

    const path = url.pathname;
    if (path === "/admin/ping" && request.method === "GET") {
      return adminJson({ ok: true, role: "OWNER", database: Boolean(env.DB), now: new Date().toISOString() }, 200, origin);
    }
    if (path === "/admin/overview" && request.method === "GET") {
      const [, paypalRefundSync] = await Promise.all([
        reconcilePurchasePayments(env, reqId),
        paypalErstattungenSicherAbgleichen(env, reqId),
      ]);
      return adminJson({ ...(await getOverview(env, url)), paypalRefundSync }, 200, origin);
    }
    if (path === "/admin/orders" && request.method === "GET") {
      const [, paypalRefundSync] = await Promise.all([
        reconcilePurchasePayments(env, reqId),
        paypalErstattungenSicherAbgleichen(env, reqId),
      ]);
      return adminJson({ ...(await getOrders(env, url)), paypalRefundSync }, 200, origin);
    }
    if (path === "/admin/paypal/refunds/sync" && request.method === "POST") {
      return adminJson(await paypalErstattungenSicherAbgleichen(env, reqId, true), 200, origin);
    }
    if (path === "/admin/paypal/webhook/erstattungen" && request.method === "POST") {
      try {
        const ergebnis = await paypalWebhookErstattungenAbonnieren(env);
        await auditAdmin(env, "paypal_webhook", env.PAYPAL_WEBHOOK_ID || "-", "PAYPAL_WEBHOOK_REFUNDS_SUBSCRIBED", reqId,
          { bereits: ergebnis.bereits, eventTypes: ergebnis.eventTypes });
        return adminJson({ ...ergebnis, paypalRefundSync: await paypalErstattungenSicherAbgleichen(env, reqId, true) }, 200, origin);
      } catch (err) {
        if (err instanceof ErstattungsFehler) {
          return adminJson({ error: err.code, detail: err.detail, requestId: reqId }, err.status, origin);
        }
        throw err;
      }
    }
    if (path === "/admin/rentals" && request.method === "GET") return adminJson(await getRentals(env, url), 200, origin);
    if (path === "/admin/inventory" && request.method === "GET") return adminJson(await getInventory(env, url), 200, origin);
    if (path === "/admin/customers" && request.method === "GET") return adminJson(await getCustomers(env, url), 200, origin);
    if (path === "/admin/activity" && request.method === "GET") return adminJson(await getActivity(env, url), 200, origin);
    if (path === "/admin/system" && request.method === "GET") return adminJson(await getSystem(env), 200, origin);
    if (path === "/admin/notes" && request.method === "POST") return adminJson(await createNote(env, await readJson(request), reqId), 201, origin);

    // Erstattungen laufen als Auftrag (erstattung-auftrag.js): sofort
    // versucht, bei fehlendem Guthaben automatisch wiederholt.
    const erstattenMatch = /^\/admin\/orders\/([^/]+)\/erstatten$/.exec(path);
    if (erstattenMatch && request.method === "POST") {
      return adminJson(await orderErstatten(env, decodeURIComponent(erstattenMatch[1]), await readJson(request), reqId), 200, origin);
    }

    // "Jetzt einziehen": eine nur reservierte Zahlung sofort einziehen.
    const einzugMatch = /^\/admin\/orders\/([^/]+)\/zahlung\/einziehen$/.exec(path);
    if (einzugMatch && request.method === "POST") {
      const db = requireDb(env);
      const id = decodeURIComponent(einzugMatch[1]);
      const order = await db.prepare("SELECT id,status FROM commerce_orders WHERE id=? OR order_number=?").bind(id, id).first();
      if (!order) throw new AdminError("ORDER_NOT_FOUND", 404);
      // Laeuft ein Storno oder Widerruf vor dem Versand, wird nicht mehr eingezogen.
      const sperre = ["PAID", "PREPARING"].includes(String(order.status)) ? await versandSperre(db, order.id, { mitZahlung: false }) : null;
      if (sperre) throw new AdminError(sperre.code, 409);
      const einzug = await zahlungEinziehen(env, order.id, reqId, { anlass: "ADMIN" });
      return adminJson({
        ...(await getOrderDetail(env, order.id)),
        einzug: { ...einzug, text: einzug.ok ? null : zahlungFehlerText(einzug.code) },
      }, 200, origin);
    }

    const stornoMatch = /^\/admin\/orders\/([^/]+)\/stornieren$/.exec(path);
    if (stornoMatch && request.method === "POST") {
      return adminJson(await orderStornieren(env, decodeURIComponent(stornoMatch[1]), await readJson(request), reqId), 200, origin);
    }

    // Ruecksendung: anlegen (Kundin hat per Mail/Brief widerrufen) und
    // "Ware eingegangen" (Stuecke waehlen, pruefen, erstatten).
    const ruecksendungMatch = /^\/admin\/orders\/([^/]+)\/ruecksendung(\/eingegangen)?$/.exec(path);
    if (ruecksendungMatch && request.method === "POST") {
      const id = decodeURIComponent(ruecksendungMatch[1]);
      const body = await readJson(request);
      const ergebnis = ruecksendungMatch[2]
        ? await wareEingegangen(env, id, body, reqId, auftragDeps(env, reqId))
        : await ruecksendungAnlegen(env, id, body, reqId, auftragDeps(env, reqId));
      return adminJson({ ...(await getOrderDetail(env, id)), ruecksendung: ergebnis, auftrag: ergebnis.auftrag || null }, 200, origin);
    }

    if (path === "/admin/erstattungen" && request.method === "GET") {
      const [erstattungen, widerrufe] = await Promise.all([erstattungenUebersicht(env), widerrufeUebersicht(env)]);
      return adminJson({ ...erstattungen, ...widerrufe }, 200, origin);
    }
    const auftragMatch = /^\/admin\/erstattungen\/([^/]+)\/(erneut|abbrechen)$/.exec(path);
    if (auftragMatch && request.method === "POST") {
      const auftragId = decodeURIComponent(auftragMatch[1]);
      const auftrag = auftragMatch[2] === "erneut"
        ? (await auftragAusfuehren(env, auftragId, reqId, auftragDeps(env, reqId), { erzwingen: true })).auftrag
        : await auftragAbbrechen(env, auftragId, (await readJson(request)).grund, reqId);
      return adminJson({ ...(await getOrderDetail(env, auftrag.orderId)), auftrag }, 200, origin);
    }

    const widerrufMatch = /^\/admin\/widerrufe\/([^/]+)$/.exec(path);
    if (widerrufMatch && request.method === "PATCH") {
      const widerruf = await widerrufBearbeiten(env, decodeURIComponent(widerrufMatch[1]), await readJson(request), reqId, auftragDeps(env, reqId));
      return adminJson({ ok: true, widerruf }, 200, origin);
    }

    const wiederMatch = /^\/admin\/orders\/([^/]+)\/wieder-verfuegbar$/.exec(path);
    if (wiederMatch && request.method === "POST") {
      const id = decodeURIComponent(wiederMatch[1]);
      const ergebnis = await stueckeWiederVerfuegbar(env, id, reqId);
      return adminJson({ ...(await getOrderDetail(env, id)), wiederVerfuegbarErgebnis: ergebnis }, 200, origin);
    }

    const contactMatch = /^\/admin\/orders\/([^/]+)\/contact$/.exec(path);
    if (contactMatch && request.method === "PATCH") {
      return adminJson(await updateOrderContact(env, decodeURIComponent(contactMatch[1]), await readJson(request), reqId), 200, origin);
    }

    const orderMatch = /^\/admin\/orders\/([^/]+)$/.exec(path);
    if (orderMatch) {
      const id = decodeURIComponent(orderMatch[1]);
      if (request.method === "GET") return adminJson(await getOrderDetail(env, id), 200, origin);
      if (request.method === "PATCH") return adminJson(await updateOrder(env, id, await readJson(request), reqId), 200, origin);
      if (request.method === "DELETE") return adminJson(await deleteTestOrder(env, id, await readJson(request), reqId), 200, origin);
    }
    const rentalMatch = /^\/admin\/rentals\/([^/]+)$/.exec(path);
    if (rentalMatch) {
      const id = decodeURIComponent(rentalMatch[1]);
      if (request.method === "GET") return adminJson(await getRentalDetail(env, id), 200, origin);
      if (request.method === "PATCH") return adminJson(await updateRental(env, id, await readJson(request), reqId), 200, origin);
    }
    const customerMatch = /^\/admin\/customers\/([^/]+)$/.exec(path);
    if (customerMatch && request.method === "GET") {
      return adminJson(await getCustomerDetail(env, decodeURIComponent(customerMatch[1])), 200, origin);
    }
    throw new AdminError("NOT_FOUND", 404);
  } catch (err) {
    if (err instanceof AdminError) return adminJson({ error: err.code, requestId: reqId }, err.status, origin);
    if (err instanceof ZahlungFehler) return adminJson({ error: err.code, detail: { text: err.text }, requestId: reqId }, err.status, origin);
    if (err instanceof ErstattungsFehler || err instanceof AuftragFehler || err instanceof WiderrufFehler) {
      return adminJson({ error: err.code, detail: err.detail ?? null, requestId: reqId }, err.status, origin);
    }
    console.error(JSON.stringify({ level: "error", event: "admin_api_error", requestId: reqId, message: safeText(err?.message || "unknown", 180) }));
    return adminJson({ error: "INTERNAL_ADMIN_ERROR", requestId: reqId }, 500, origin);
  }
}

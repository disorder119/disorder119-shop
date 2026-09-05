import {
  ORDER_STATUSES,
  RENTAL_STATUSES,
  canTransitionOrder,
  canTransitionRental,
  safeText,
} from "./commerce-core.js";

const ADMIN_ORIGINS = Object.freeze([
  "https://admin.disorder119.com",
  "http://localhost:8765",
  "http://127.0.0.1:8765",
]);

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
    "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
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

export function orderNextStatuses(status) {
  const current = String(status || "").toUpperCase();
  return ORDER_STATUSES.filter(next => next !== current && canTransitionOrder(current, next));
}

export function rentalNextStatuses(status) {
  const current = String(status || "").toUpperCase();
  return RENTAL_STATUSES.filter(next => next !== current && canTransitionRental(current, next));
}

function parseMetadata(value) {
  if (!value) return null;
  try { return JSON.parse(value); } catch { return null; }
}

async function auditAdmin(env, entityType, entityId, eventType, reqId, metadata = null) {
  if (!env.DB) return;
  await env.DB.prepare(`INSERT INTO audit_events
    (id,actor_type,entity_type,entity_id,event_type,request_id,metadata_json,created_at)
    VALUES (?,?,?,?,?,?,?,?)`).bind(
      crypto.randomUUID(), "ADMIN", entityType, String(entityId), eventType, reqId,
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
      COALESCE(SUM(CASE WHEN status='COMPLETED' THEN amount_cents ELSE 0 END),0) AS capturedCents
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

  const ordersDaily = await db.prepare(`SELECT substr(created_at,1,10) AS day, COUNT(*) AS orders,
    COALESCE(SUM(total_cents),0) AS orderValueCents
    FROM commerce_orders WHERE created_at>=? GROUP BY substr(created_at,1,10) ORDER BY day`).bind(cutoffIso).all();
  const paymentsDaily = await db.prepare(`SELECT substr(COALESCE(updated_at,created_at),1,10) AS day,
    COUNT(*) AS payments, COALESCE(SUM(amount_cents),0) AS capturedCents
    FROM payments WHERE status='COMPLETED' AND COALESCE(updated_at,created_at)>=?
    GROUP BY substr(COALESCE(updated_at,created_at),1,10) ORDER BY day`).bind(cutoffIso).all();
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
    WHERE o.status NOT IN ('CANCELLED') GROUP BY oi.item_id,oi.article_no ORDER BY valueCents DESC LIMIT 8`).all();
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
  const status = safeText(url.searchParams.get("status"), 40).toUpperCase();
  const q = safeText(url.searchParams.get("q"), 120);
  if (status && !ORDER_STATUSES.includes(status)) throw new AdminError("INVALID_ORDER_STATUS", 400);

  const where = [];
  const binds = [];
  if (status) { where.push("o.status=?"); binds.push(status); }
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
  const [items, payments, shipments, returns, refunds, events, notes, contact] = await db.batch([
    db.prepare("SELECT * FROM order_items WHERE order_id=? ORDER BY rowid").bind(order.id),
    db.prepare("SELECT * FROM payments WHERE order_id=? ORDER BY created_at DESC").bind(order.id),
    db.prepare("SELECT * FROM shipments WHERE order_id=? ORDER BY created_at DESC").bind(order.id),
    db.prepare("SELECT * FROM returns WHERE order_id=? ORDER BY created_at DESC").bind(order.id),
    db.prepare("SELECT * FROM refunds WHERE order_id=? ORDER BY created_at DESC").bind(order.id),
    db.prepare("SELECT * FROM audit_events WHERE entity_id=? OR (entity_type='order' AND entity_id=?) ORDER BY created_at DESC LIMIT 200").bind(order.id, order.id),
    db.prepare("SELECT * FROM admin_notes WHERE entity_type='ORDER' AND entity_id=? ORDER BY created_at DESC").bind(order.id),
    db.prepare("SELECT * FROM order_contact_snapshots WHERE order_id=?").bind(order.id),
  ]);
  let customer = null;
  let addresses = [];
  if (order.customer_id) {
    customer = await db.prepare("SELECT id,email_normalized,email_verified,status,created_at,updated_at FROM customers WHERE id=?").bind(order.customer_id).first();
    const addr = await db.prepare("SELECT * FROM customer_addresses WHERE customer_id=? ORDER BY is_default DESC,created_at DESC").bind(order.customer_id).all();
    addresses = addr.results || [];
  }
  return {
    order,
    nextStatuses: orderNextStatuses(order.status),
    items: items.results || [],
    payments: payments.results || [],
    shipments: shipments.results || [],
    returns: returns.results || [],
    refunds: refunds.results || [],
    contact: (contact.results || [])[0] || null,
    customer,
    addresses,
    notes: notes.results || [],
    activity: (events.results || []).map(row => ({ ...row, metadata: parseMetadata(row.metadata_json) })),
  };
}

async function updateOrder(env, id, body, reqId) {
  const db = requireDb(env);
  const order = await db.prepare("SELECT * FROM commerce_orders WHERE id=? OR order_number=?").bind(id, id).first();
  if (!order) throw new AdminError("ORDER_NOT_FOUND", 404);
  const newStatus = safeText(body.status, 40).toUpperCase();
  const trackingNumber = safeText(body.trackingNumber, 160);
  const carrier = safeText(body.carrier, 80);
  const service = safeText(body.service, 100);
  const now = new Date().toISOString();

  if (newStatus) {
    if (!ORDER_STATUSES.includes(newStatus) || !canTransitionOrder(order.status, newStatus)) throw new AdminError("INVALID_ORDER_STATUS_TRANSITION", 409);
    if (newStatus === "REFUNDED") {
      const refunded = await db.prepare("SELECT COALESCE(SUM(amount_cents),0) AS cents FROM refunds WHERE order_id=? AND status='COMPLETED'").bind(order.id).first();
      if (Number(refunded?.cents || 0) < Number(order.total_cents || 0)) throw new AdminError("REFUND_NOT_COMPLETED", 409);
    }
    const statements = [
      db.prepare("UPDATE commerce_orders SET status=?,updated_at=? WHERE id=? AND status=?").bind(newStatus, now, order.id, order.status),
    ];
    if (newStatus === "CANCELLED") {
      statements.push(db.prepare(`UPDATE inventory SET status='CANCELLED',updated_at=?,version=version+1
        WHERE id IN (SELECT inventory_id FROM order_items WHERE order_id=?) AND status IN ('RESERVED','PAYMENT_PENDING')`).bind(now, order.id));
      statements.push(db.prepare(`UPDATE inventory SET status='AVAILABLE',updated_at=?,version=version+1
        WHERE id IN (SELECT inventory_id FROM order_items WHERE order_id=?) AND status='CANCELLED'`).bind(now, order.id));
    } else {
      statements.push(db.prepare(`UPDATE inventory SET status=?,updated_at=?,version=version+1
        WHERE id IN (SELECT inventory_id FROM order_items WHERE order_id=?)`).bind(newStatus, now, order.id));
    }
    await db.batch(statements);
    await auditAdmin(env, "order", order.id, `ORDER_${newStatus}`, reqId, { from: order.status, to: newStatus });
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
    await auditAdmin(env, "shipment", shipment.id, "SHIPMENT_UPDATED", reqId, { orderId: order.id, status: shipmentStatus || undefined, carrier: carrier || undefined, tracking: Boolean(trackingNumber) });
  } else if (effectiveStatus === "DELIVERED") {
    await db.prepare("UPDATE shipments SET status='DELIVERED',delivered_at=COALESCE(delivered_at,?),updated_at=? WHERE order_id=?")
      .bind(now, now, order.id).run();
  }

  return getOrderDetail(env, order.id);
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
  const q = safeText(url.searchParams.get("q"), 120);
  const where = q ? "WHERE c.email_normalized LIKE ? OR c.id LIKE ?" : "";
  const binds = q ? [`%${q}%`, `%${q}%`] : [];
  const count = await db.prepare(`SELECT COUNT(*) AS total FROM customers c ${where}`).bind(...binds).first();
  const rows = await db.prepare(`SELECT c.id,c.email_normalized,c.email_verified,c.status,c.created_at,c.updated_at,
      (SELECT COUNT(*) FROM commerce_orders o WHERE o.customer_id=c.id) AS orderCount,
      (SELECT COALESCE(SUM(total_cents),0) FROM commerce_orders o WHERE o.customer_id=c.id AND o.status NOT IN ('CANCELLED')) AS orderValueCents,
      (SELECT COUNT(*) FROM rental_reservations rr WHERE rr.customer_id=c.id) AS rentalCount
    FROM customers c ${where} ORDER BY c.created_at DESC LIMIT ? OFFSET ?`).bind(...binds, limit, offset).all();
  return { total: Number(count?.total || 0), limit, offset, customers: rows.results || [] };
}

async function getCustomerDetail(env, id) {
  const db = requireDb(env);
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
      payer_ref=excluded.payer_ref,email=excluded.email,given_name=excluded.given_name,surname=excluded.surname,
      recipient_name=excluded.recipient_name,address_line1=excluded.address_line1,address_line2=excluded.address_line2,
      postal_code=excluded.postal_code,city=excluded.city,region=excluded.region,country_code=excluded.country_code,updated_at=excluded.updated_at`)
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
    if (path === "/admin/overview" && request.method === "GET") return adminJson(await getOverview(env, url), 200, origin);
    if (path === "/admin/orders" && request.method === "GET") return adminJson(await getOrders(env, url), 200, origin);
    if (path === "/admin/rentals" && request.method === "GET") return adminJson(await getRentals(env, url), 200, origin);
    if (path === "/admin/inventory" && request.method === "GET") return adminJson(await getInventory(env, url), 200, origin);
    if (path === "/admin/customers" && request.method === "GET") return adminJson(await getCustomers(env, url), 200, origin);
    if (path === "/admin/activity" && request.method === "GET") return adminJson(await getActivity(env, url), 200, origin);
    if (path === "/admin/system" && request.method === "GET") return adminJson(await getSystem(env), 200, origin);
    if (path === "/admin/notes" && request.method === "POST") return adminJson(await createNote(env, await readJson(request), reqId), 201, origin);

    const orderMatch = /^\/admin\/orders\/([^/]+)$/.exec(path);
    if (orderMatch) {
      const id = decodeURIComponent(orderMatch[1]);
      if (request.method === "GET") return adminJson(await getOrderDetail(env, id), 200, origin);
      if (request.method === "PATCH") return adminJson(await updateOrder(env, id, await readJson(request), reqId), 200, origin);
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
    console.error(JSON.stringify({ level: "error", event: "admin_api_error", requestId: reqId, message: safeText(err?.message || "unknown", 180) }));
    return adminJson({ error: "INTERNAL_ADMIN_ERROR", requestId: reqId }, 500, origin);
  }
}

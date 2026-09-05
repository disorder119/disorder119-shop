// Disorder119 private business insights for the owner dashboard.
// Read-only analytics over the authoritative D1 commerce data.
// No secrets or raw payment-provider payloads are returned.

const ADMIN_ORIGINS = Object.freeze([
  "https://admin.disorder119.com",
  "http://localhost:8765",
  "http://127.0.0.1:8765",
]);

class InsightsError extends Error {
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
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization",
    "Access-Control-Max-Age": "600",
    "Vary": "Origin",
  };
  if (origin && ADMIN_ORIGINS.includes(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

function json(data, status = 200, origin = null) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...securityHeaders(), ...corsHeaders(origin) },
  });
}

async function digest(value) {
  const raw = new TextEncoder().encode(String(value || ""));
  return new Uint8Array(await crypto.subtle.digest("SHA-256", raw));
}

async function constantTimeTokenEquals(left, right) {
  if (!left || !right) return false;
  const [a, b] = await Promise.all([digest(left), digest(right)]);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function requireAdmin(request, env) {
  if (!env.ADMIN_TOKEN) throw new InsightsError("ADMIN_NOT_CONFIGURED", 503);
  const supplied = String(request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!(await constantTimeTokenEquals(supplied, env.ADMIN_TOKEN))) throw new InsightsError("UNAUTHORIZED", 401);
  if (!env.DB) throw new InsightsError("COMMERCE_DATABASE_NOT_CONFIGURED", 503);
}

function clampDays(value) {
  const n = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(n)) return 90;
  return Math.min(365, Math.max(7, n));
}

function first(batchResult) {
  return batchResult?.results?.[0] || {};
}

function number(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function safeCatalogItem(item) {
  if (!item || typeof item !== "object") return null;
  return {
    id: Number(item.id),
    brand: String(item.brand || ""),
    title: String(item.title || ""),
    category: String(item.category || ""),
    size: String(item.size || ""),
    article: String(item.article || item.id || ""),
    price: item.price ?? null,
    image: Array.isArray(item.gallery) && item.gallery[0] ? `/${String(item.gallery[0]).replace(/^\//, "")}` : null,
  };
}

async function loadCatalog() {
  try {
    const res = await fetch("https://disorder119.com/data/catalog.json", {
      headers: { Accept: "application/json", "User-Agent": "disorder119-insights-worker" },
    });
    if (!res.ok) return new Map();
    const rows = await res.json();
    const map = new Map();
    if (Array.isArray(rows)) {
      for (const item of rows) map.set(Number(item.id), safeCatalogItem(item));
    }
    return map;
  } catch {
    return new Map();
  }
}

function aggregateDimension(rows, catalog, dimension, valueField) {
  const map = new Map();
  for (const row of rows || []) {
    const item = catalog.get(Number(row.itemId));
    const key = String(item?.[dimension] || "Unbekannt").trim() || "Unbekannt";
    const prev = map.get(key) || { name: key, count: 0, valueCents: 0 };
    prev.count += number(row.count);
    prev.valueCents += number(row[valueField]);
    map.set(key, prev);
  }
  return Array.from(map.values()).sort((a, b) => b.valueCents - a.valueCents || b.count - a.count).slice(0, 12);
}

async function buildInsights(env, url) {
  const db = env.DB;
  const days = clampDays(url.searchParams.get("days"));
  const cutoff = new Date(Date.now() - (days - 1) * 86400000);
  cutoff.setUTCHours(0, 0, 0, 0);
  const cutoffIso = cutoff.toISOString();
  const today = new Date().toISOString().slice(0, 10);
  const inSeven = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);

  const batch = await db.batch([
    db.prepare(`SELECT
      COUNT(DISTINCT order_id) AS paidOrders,
      COALESCE(SUM(amount_cents),0) AS capturedCents
      FROM payments
      WHERE status='COMPLETED' AND COALESCE(updated_at,created_at)>=?`).bind(cutoffIso),
    db.prepare(`SELECT COALESCE(SUM(amount_cents),0) AS refundedCents, COUNT(*) AS refunds
      FROM refunds WHERE status='COMPLETED' AND COALESCE(updated_at,created_at)>=?`).bind(cutoffIso),
    db.prepare(`SELECT
      COUNT(*) AS confirmedRentals,
      COALESCE(SUM(total_price_cents),0) AS confirmedRentalValueCents,
      COALESCE(SUM(days),0) AS bookedRentalDays
      FROM rental_reservations
      WHERE status IN ('CONFIRMED','ACTIVE','RETURN_DUE','RETURNED') AND created_at>=?`).bind(cutoffIso),
    db.prepare(`SELECT COALESCE(SUM(deposit_cents),0) AS outstandingDepositCents, COUNT(*) AS depositCases
      FROM rental_reservations WHERE status IN ('CONFIRMED','ACTIVE','RETURN_DUE')`),
    db.prepare(`SELECT
      SUM(CASE WHEN status='PAID' THEN 1 ELSE 0 END) AS paidWaiting,
      SUM(CASE WHEN status='PREPARING' THEN 1 ELSE 0 END) AS preparing,
      SUM(CASE WHEN status='PAYMENT_PENDING' AND created_at < datetime('now','-30 minutes') THEN 1 ELSE 0 END) AS stalePaymentPending
      FROM commerce_orders`),
    db.prepare(`SELECT COUNT(*) AS shippedWithoutTracking
      FROM commerce_orders o
      WHERE o.status='SHIPPED' AND NOT EXISTS (
        SELECT 1 FROM shipments s WHERE s.order_id=o.id AND COALESCE(s.tracking_number,'')<>''
      )`),
    db.prepare(`SELECT COUNT(*) AS overdueRentals
      FROM rental_reservations
      WHERE status IN ('CONFIRMED','ACTIVE','RETURN_DUE') AND end_date < ?`).bind(today),
    db.prepare(`SELECT COUNT(*) AS startingSoon
      FROM rental_reservations
      WHERE status='CONFIRMED' AND start_date BETWEEN ? AND ?`).bind(today, inSeven),
    db.prepare(`SELECT
      COUNT(*) AS totalInventory,
      SUM(CASE WHEN status='AVAILABLE' THEN 1 ELSE 0 END) AS available,
      SUM(CASE WHEN status IN ('RESERVED','PAYMENT_PENDING') THEN 1 ELSE 0 END) AS held,
      SUM(CASE WHEN status IN ('PAID','PREPARING','SHIPPED','DELIVERED') THEN 1 ELSE 0 END) AS soldPipeline
      FROM inventory`),
    db.prepare(`SELECT COUNT(*) AS openReturns FROM returns WHERE status NOT IN ('CLOSED','REJECTED')`),
    db.prepare(`SELECT COUNT(*) AS shipmentExceptions FROM shipments WHERE status='EXCEPTION'`),
    db.prepare(`SELECT COUNT(*) AS unprocessedPaymentEvents FROM payment_events WHERE processed_at IS NULL`),
  ]);

  const customerRows = await db.prepare(`SELECT
      LOWER(COALESCE(NULLIF(cs.email,''),NULLIF(o.guest_email,''))) AS email,
      COUNT(*) AS orders,
      COALESCE(SUM(o.total_cents),0) AS orderValueCents,
      MIN(o.created_at) AS firstOrderAt,
      MAX(o.created_at) AS lastOrderAt
    FROM commerce_orders o
    LEFT JOIN order_contact_snapshots cs ON cs.order_id=o.id
    WHERE o.status NOT IN ('CANCELLED') AND COALESCE(NULLIF(cs.email,''),NULLIF(o.guest_email,'')) IS NOT NULL
    GROUP BY LOWER(COALESCE(NULLIF(cs.email,''),NULLIF(o.guest_email,'')))
    ORDER BY orderValueCents DESC`).all();
  const customerList = customerRows.results || [];

  const countryRows = await db.prepare(`SELECT COALESCE(NULLIF(country_code,''),'UNBEKANNT') AS countryCode,
      COUNT(*) AS orders, COALESCE(SUM(o.total_cents),0) AS orderValueCents
    FROM commerce_orders o JOIN order_contact_snapshots cs ON cs.order_id=o.id
    WHERE o.status NOT IN ('CANCELLED')
    GROUP BY COALESCE(NULLIF(country_code,''),'UNBEKANNT')
    ORDER BY orderValueCents DESC, orders DESC LIMIT 20`).all();

  const monthlySales = await db.prepare(`SELECT substr(COALESCE(updated_at,created_at),1,7) AS month,
      COUNT(DISTINCT order_id) AS orders, COALESCE(SUM(amount_cents),0) AS capturedCents
    FROM payments WHERE status='COMPLETED' AND COALESCE(updated_at,created_at)>=datetime('now','-12 months')
    GROUP BY substr(COALESCE(updated_at,created_at),1,7) ORDER BY month`).all();
  const monthlyRentals = await db.prepare(`SELECT substr(created_at,1,7) AS month,
      COUNT(*) AS rentals, COALESCE(SUM(total_price_cents),0) AS rentalValueCents, COALESCE(SUM(days),0) AS rentalDays
    FROM rental_reservations
    WHERE status IN ('CONFIRMED','ACTIVE','RETURN_DUE','RETURNED') AND created_at>=datetime('now','-12 months')
    GROUP BY substr(created_at,1,7) ORDER BY month`).all();

  const soldItems = await db.prepare(`SELECT oi.item_id AS itemId, COUNT(*) AS count,
      COALESCE(SUM(oi.unit_price_cents),0) AS valueCents
    FROM order_items oi JOIN commerce_orders o ON o.id=oi.order_id
    WHERE o.status NOT IN ('CANCELLED')
    GROUP BY oi.item_id ORDER BY valueCents DESC LIMIT 100`).all();
  const rentedItems = await db.prepare(`SELECT i.item_id AS itemId, COUNT(*) AS count,
      COALESCE(SUM(rr.total_price_cents),0) AS valueCents
    FROM rental_reservations rr JOIN inventory i ON i.id=rr.inventory_id
    WHERE rr.status IN ('CONFIRMED','ACTIVE','RETURN_DUE','RETURNED')
    GROUP BY i.item_id ORDER BY valueCents DESC LIMIT 100`).all();
  const catalog = await loadCatalog();

  const payment = first(batch[0]);
  const refund = first(batch[1]);
  const rentals = first(batch[2]);
  const deposits = first(batch[3]);
  const fulfillment = first(batch[4]);
  const paidOrders = number(payment.paidOrders);
  const captured = number(payment.capturedCents);
  const refunded = number(refund.refundedCents);

  return {
    generatedAt: new Date().toISOString(),
    period: { days, from: cutoffIso, to: new Date().toISOString() },
    money: {
      capturedSalesCents: captured,
      completedRefundsCents: refunded,
      netCapturedSalesCents: Math.max(0, captured - refunded),
      averageCapturedOrderCents: paidOrders ? Math.round(captured / paidOrders) : 0,
      paidOrders,
      confirmedRentalValueCents: number(rentals.confirmedRentalValueCents),
      confirmedRentals: number(rentals.confirmedRentals),
      bookedRentalDays: number(rentals.bookedRentalDays),
      outstandingDepositCents: number(deposits.outstandingDepositCents),
      outstandingDepositCases: number(deposits.depositCases),
    },
    operations: {
      paidWaiting: number(fulfillment.paidWaiting),
      preparing: number(fulfillment.preparing),
      stalePaymentPending: number(fulfillment.stalePaymentPending),
      shippedWithoutTracking: number(first(batch[5]).shippedWithoutTracking),
      overdueRentals: number(first(batch[6]).overdueRentals),
      rentalsStartingNext7Days: number(first(batch[7]).startingSoon),
      openReturns: number(first(batch[9]).openReturns),
      shipmentExceptions: number(first(batch[10]).shipmentExceptions),
      unprocessedPaymentEvents: number(first(batch[11]).unprocessedPaymentEvents),
    },
    inventory: {
      total: number(first(batch[8]).totalInventory),
      available: number(first(batch[8]).available),
      held: number(first(batch[8]).held),
      soldPipeline: number(first(batch[8]).soldPipeline),
    },
    customers: {
      identifiableBuyers: customerList.length,
      repeatBuyers: customerList.filter(row => number(row.orders) >= 2).length,
      repeatBuyerRate: customerList.length ? customerList.filter(row => number(row.orders) >= 2).length / customerList.length : 0,
      top: customerList.slice(0, 20).map(row => ({
        email: row.email,
        orders: number(row.orders),
        orderValueCents: number(row.orderValueCents),
        firstOrderAt: row.firstOrderAt,
        lastOrderAt: row.lastOrderAt,
      })),
      countries: countryRows.results || [],
    },
    trends: {
      monthlySales: monthlySales.results || [],
      monthlyRentals: monthlyRentals.results || [],
    },
    performance: {
      salesByBrand: aggregateDimension(soldItems.results || [], catalog, "brand", "valueCents"),
      salesByCategory: aggregateDimension(soldItems.results || [], catalog, "category", "valueCents"),
      rentalsByBrand: aggregateDimension(rentedItems.results || [], catalog, "brand", "valueCents"),
      rentalsByCategory: aggregateDimension(rentedItems.results || [], catalog, "category", "valueCents"),
    },
  };
}

export async function handleAdminInsights(request, env, url, reqId, origin = null) {
  try {
    if (request.method === "OPTIONS") {
      if (origin && !ADMIN_ORIGINS.includes(origin)) return new Response(null, { status: 403, headers: securityHeaders() });
      return new Response(null, { status: 204, headers: { ...securityHeaders(), ...corsHeaders(origin) } });
    }
    if (origin && !ADMIN_ORIGINS.includes(origin)) throw new InsightsError("ORIGIN_NOT_ALLOWED", 403);
    if (request.method !== "GET") throw new InsightsError("METHOD_NOT_ALLOWED", 405);
    await requireAdmin(request, env);
    return json(await buildInsights(env, url), 200, origin);
  } catch (err) {
    if (err instanceof InsightsError) return json({ error: err.code, requestId: reqId }, err.status, origin);
    console.error(JSON.stringify({ level: "error", event: "admin_insights_error", requestId: reqId, message: String(err?.message || "unknown").slice(0, 180) }));
    return json({ error: "INTERNAL_ADMIN_INSIGHTS_ERROR", requestId: reqId }, 500, origin);
  }
}

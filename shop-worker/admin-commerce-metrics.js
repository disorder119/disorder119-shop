// Disorder119 extended private commerce metrics.
// Read-only calculations over D1. No provider actions or public customer data.

const ADMIN_ORIGINS = Object.freeze([
  "https://admin.disorder119.com",
  "http://localhost:8765",
  "http://127.0.0.1:8765",
]);

class CommerceMetricsError extends Error {
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
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value || ""))));
}

async function tokenEquals(left, right) {
  if (!left || !right) return false;
  const [a, b] = await Promise.all([digest(left), digest(right)]);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function requireAdmin(request, env) {
  if (!env.ADMIN_TOKEN) throw new CommerceMetricsError("ADMIN_NOT_CONFIGURED", 503);
  const supplied = String(request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!(await tokenEquals(supplied, env.ADMIN_TOKEN))) throw new CommerceMetricsError("UNAUTHORIZED", 401);
  if (!env.DB) throw new CommerceMetricsError("COMMERCE_DATABASE_NOT_CONFIGURED", 503);
}

function clampDays(value) {
  const n = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(n)) return 90;
  return Math.min(365, Math.max(7, n));
}

function number(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function ratio(part, whole) {
  const denominator = number(whole);
  return denominator > 0 ? number(part) / denominator : 0;
}

function safeCatalogItem(item) {
  if (!item || typeof item !== "object") return null;
  return {
    id: Number(item.id),
    brand: String(item.brand || ""),
    title: String(item.title || ""),
    article: String(item.article || item.id || ""),
    image: Array.isArray(item.gallery) && item.gallery[0] ? `/${String(item.gallery[0]).replace(/^\//, "")}` : null,
  };
}

async function loadCatalog() {
  try {
    const response = await fetch("https://disorder119.com/data/catalog.json", {
      headers: { Accept: "application/json", "User-Agent": "disorder119-commerce-metrics" },
    });
    if (!response.ok) return new Map();
    const rows = await response.json();
    const map = new Map();
    for (const item of Array.isArray(rows) ? rows : []) {
      const safe = safeCatalogItem(item);
      if (safe && Number.isFinite(safe.id)) map.set(safe.id, safe);
    }
    return map;
  } catch {
    return new Map();
  }
}

export function mergeCustomerValue(salesRows = [], rentalRows = []) {
  const customers = new Map();
  function get(email) {
    const key = String(email || "").trim().toLowerCase();
    if (!key) return null;
    if (!customers.has(key)) {
      customers.set(key, {
        email: key,
        paidOrders: 0,
        capturedSalesCents: 0,
        salesRefundsCents: 0,
        netCapturedSalesCents: 0,
        rentals: 0,
        rentalContractValueCents: 0,
        firstCommerceAt: null,
        lastCommerceAt: null,
      });
    }
    return customers.get(key);
  }
  function includeDate(row, value) {
    const first = row.firstCommerceAt;
    const last = row.lastCommerceAt;
    if (value && (!first || value < first)) row.firstCommerceAt = value;
    if (value && (!last || value > last)) row.lastCommerceAt = value;
  }

  for (const source of salesRows || []) {
    const row = get(source.email);
    if (!row) continue;
    row.paidOrders += number(source.paidOrders);
    row.capturedSalesCents += number(source.capturedSalesCents);
    row.salesRefundsCents += number(source.salesRefundsCents);
    includeDate(row, source.firstCommerceAt);
    includeDate(row, source.lastCommerceAt);
  }
  for (const source of rentalRows || []) {
    const row = get(source.email);
    if (!row) continue;
    row.rentals += number(source.rentals);
    row.rentalContractValueCents += number(source.rentalContractValueCents);
    includeDate(row, source.firstCommerceAt);
    includeDate(row, source.lastCommerceAt);
  }
  for (const row of customers.values()) {
    row.netCapturedSalesCents = Math.max(0, row.capturedSalesCents - row.salesRefundsCents);
    row.recordedCommerceValueCents = row.netCapturedSalesCents + row.rentalContractValueCents;
  }
  return Array.from(customers.values()).sort((a, b) =>
    b.recordedCommerceValueCents - a.recordedCommerceValueCents ||
    (b.paidOrders + b.rentals) - (a.paidOrders + a.rentals)
  );
}

export function enrichTopProducts(rows = [], catalog = new Map()) {
  return Array.from(rows || []).map(row => {
    const itemId = number(row.itemId);
    const item = catalog.get(itemId) || null;
    return {
      itemId,
      articleNo: String(row.articleNo || item?.article || itemId || ""),
      title: String(row.title || item?.title || `Artikel ${itemId}`),
      brand: String(item?.brand || ""),
      image: item?.image || null,
      count: number(row.count),
      valueCents: number(row.valueCents),
    };
  });
}

async function buildCommerceMetrics(env, url) {
  const db = env.DB;
  const days = clampDays(url.searchParams.get("days"));
  const cutoff = new Date(Date.now() - (days - 1) * 86400000);
  cutoff.setUTCHours(0, 0, 0, 0);
  const cutoffIso = cutoff.toISOString();

  const [salesPeriod, rentalRefunds, returnRate, damageExposure, paymentMix, orderMix, rentalMix] = await db.batch([
    db.prepare(`WITH period_paid AS (
        SELECT order_id, SUM(amount_cents) AS captured_cents
        FROM payments
        WHERE status='COMPLETED' AND COALESCE(updated_at,created_at)>=?
        GROUP BY order_id
      ), period_refunds AS (
        SELECT order_id, SUM(amount_cents) AS refunded_cents
        FROM refunds
        WHERE status='COMPLETED' AND order_id IS NOT NULL AND COALESCE(updated_at,created_at)>=?
        GROUP BY order_id
      )
      SELECT
        COUNT(*) AS paidOrders,
        COALESCE(SUM(captured_cents),0) AS capturedSalesCents,
        COALESCE((SELECT SUM(refunded_cents) FROM period_refunds),0) AS salesRefundsCents
      FROM period_paid`).bind(cutoffIso, cutoffIso),
    db.prepare(`SELECT COUNT(*) AS rentalRefunds, COALESCE(SUM(amount_cents),0) AS rentalRefundsCents
      FROM refunds
      WHERE status='COMPLETED' AND rental_id IS NOT NULL AND COALESCE(updated_at,created_at)>=?`).bind(cutoffIso),
    db.prepare(`WITH paid_orders AS (
        SELECT DISTINCT order_id FROM payments
        WHERE status='COMPLETED' AND COALESCE(updated_at,created_at)>=?
      )
      SELECT COUNT(*) AS paidOrders,
        SUM(CASE WHEN EXISTS (SELECT 1 FROM returns r WHERE r.order_id=paid_orders.order_id) THEN 1 ELSE 0 END) AS ordersWithReturn
      FROM paid_orders`).bind(cutoffIso),
    db.prepare(`SELECT
        COUNT(*) AS openDamageCases,
        COALESCE(SUM(estimated_amount_cents),0) AS estimatedDamageCents,
        COALESCE(SUM(withheld_amount_cents),0) AS withheldDamageCents
      FROM damage_cases WHERE status IN ('OPEN','REVIEW')`),
    db.prepare(`SELECT status,COUNT(*) AS count,COALESCE(SUM(amount_cents),0) AS amountCents
      FROM payments WHERE created_at>=? GROUP BY status ORDER BY count DESC`).bind(cutoffIso),
    db.prepare(`SELECT status,COUNT(*) AS count,COALESCE(SUM(total_cents),0) AS orderValueCents
      FROM commerce_orders WHERE created_at>=? GROUP BY status ORDER BY count DESC`).bind(cutoffIso),
    db.prepare(`SELECT status,COUNT(*) AS count,COALESCE(SUM(total_price_cents),0) AS rentalValueCents
      FROM rental_reservations WHERE created_at>=? GROUP BY status ORDER BY count DESC`).bind(cutoffIso),
  ]);

  const salesTopRows = await db.prepare(`WITH paid_orders AS (
      SELECT DISTINCT order_id FROM payments
      WHERE status='COMPLETED' AND COALESCE(updated_at,created_at)>=?
    )
    SELECT oi.item_id AS itemId,MAX(oi.article_no) AS articleNo,MAX(oi.title_snapshot) AS title,
      COUNT(*) AS count,COALESCE(SUM(oi.unit_price_cents),0) AS valueCents
    FROM order_items oi JOIN paid_orders p ON p.order_id=oi.order_id
    GROUP BY oi.item_id ORDER BY valueCents DESC,count DESC LIMIT 20`).bind(cutoffIso).all();

  const rentalTopRows = await db.prepare(`SELECT i.item_id AS itemId,MAX(i.article_no) AS articleNo,
      COUNT(*) AS count,COALESCE(SUM(rr.total_price_cents),0) AS valueCents
    FROM rental_reservations rr JOIN inventory i ON i.id=rr.inventory_id
    WHERE rr.status IN ('CONFIRMED','ACTIVE','RETURN_DUE','RETURNED') AND rr.created_at>=?
    GROUP BY i.item_id ORDER BY valueCents DESC,count DESC LIMIT 20`).bind(cutoffIso).all();

  const salesCustomerRows = await db.prepare(`WITH paid AS (
      SELECT order_id,SUM(amount_cents) AS captured_cents
      FROM payments WHERE status='COMPLETED' GROUP BY order_id
    ), refunded AS (
      SELECT order_id,SUM(amount_cents) AS refunded_cents
      FROM refunds WHERE status='COMPLETED' AND order_id IS NOT NULL GROUP BY order_id
    )
    SELECT LOWER(COALESCE(NULLIF(cs.email,''),NULLIF(o.guest_email,''))) AS email,
      COUNT(*) AS paidOrders,
      COALESCE(SUM(p.captured_cents),0) AS capturedSalesCents,
      COALESCE(SUM(r.refunded_cents),0) AS salesRefundsCents,
      MIN(o.created_at) AS firstCommerceAt,MAX(o.created_at) AS lastCommerceAt
    FROM commerce_orders o
    JOIN paid p ON p.order_id=o.id
    LEFT JOIN refunded r ON r.order_id=o.id
    LEFT JOIN order_contact_snapshots cs ON cs.order_id=o.id
    WHERE COALESCE(NULLIF(cs.email,''),NULLIF(o.guest_email,'')) IS NOT NULL
    GROUP BY LOWER(COALESCE(NULLIF(cs.email,''),NULLIF(o.guest_email,'')))`).all();

  const rentalCustomerRows = await db.prepare(`SELECT
      LOWER(COALESCE(NULLIF(c.email_normalized,''),NULLIF(rr.guest_email,''))) AS email,
      COUNT(*) AS rentals,COALESCE(SUM(rr.total_price_cents),0) AS rentalContractValueCents,
      MIN(rr.created_at) AS firstCommerceAt,MAX(rr.created_at) AS lastCommerceAt
    FROM rental_reservations rr
    LEFT JOIN customers c ON c.id=rr.customer_id
    WHERE rr.status IN ('CONFIRMED','ACTIVE','RETURN_DUE','RETURNED')
      AND COALESCE(NULLIF(c.email_normalized,''),NULLIF(rr.guest_email,'')) IS NOT NULL
    GROUP BY LOWER(COALESCE(NULLIF(c.email_normalized,''),NULLIF(rr.guest_email,'')))`).all();

  const catalog = await loadCatalog();
  const customers = mergeCustomerValue(salesCustomerRows.results || [], rentalCustomerRows.results || []);
  const period = salesPeriod.results?.[0] || {};
  const rentalsRefund = rentalRefunds.results?.[0] || {};
  const returns = returnRate.results?.[0] || {};
  const damage = damageExposure.results?.[0] || {};
  const capturedSalesCents = number(period.capturedSalesCents);
  const salesRefundsCents = number(period.salesRefundsCents);

  return {
    generatedAt: new Date().toISOString(),
    period: { days, from: cutoffIso, to: new Date().toISOString() },
    salesQuality: {
      paidOrders: number(period.paidOrders),
      capturedSalesCents,
      salesRefundsCents,
      netCapturedSalesCents: Math.max(0, capturedSalesCents - salesRefundsCents),
      refundToCapturedRatio: ratio(salesRefundsCents, capturedSalesCents),
      ordersWithReturn: number(returns.ordersWithReturn),
      paidOrderReturnCaseRate: ratio(returns.ordersWithReturn, returns.paidOrders),
    },
    rentalQuality: {
      completedRentalRefunds: number(rentalsRefund.rentalRefunds),
      completedRentalRefundsCents: number(rentalsRefund.rentalRefundsCents),
      openDamageCases: number(damage.openDamageCases),
      estimatedOpenDamageCents: number(damage.estimatedDamageCents),
      withheldOpenDamageCents: number(damage.withheldDamageCents),
    },
    customerValue: {
      scope: "lifetime",
      basis: "net captured sales plus confirmed rental contract value; rental payment capture is not yet modeled separately",
      identifiableCustomers: customers.length,
      top: customers.slice(0, 20),
    },
    topProducts: {
      sales: enrichTopProducts(salesTopRows.results || [], catalog),
      rentals: enrichTopProducts(rentalTopRows.results || [], catalog),
    },
    statusMix: {
      payments: paymentMix.results || [],
      orders: orderMix.results || [],
      rentals: rentalMix.results || [],
    },
    conversion: {
      available: false,
      reason: "NO_FUNNEL_EVENTS",
      measurable: ["completed_payments", "orders", "rental_reservations"],
      missing: ["sessions", "product_views", "cart_adds", "checkout_starts"],
    },
  };
}

export async function handleAdminCommerceMetrics(request, env, url, reqId, origin = null) {
  try {
    if (request.method === "OPTIONS") {
      if (origin && !ADMIN_ORIGINS.includes(origin)) return new Response(null, { status: 403, headers: securityHeaders() });
      return new Response(null, { status: 204, headers: { ...securityHeaders(), ...corsHeaders(origin) } });
    }
    if (origin && !ADMIN_ORIGINS.includes(origin)) throw new CommerceMetricsError("ORIGIN_NOT_ALLOWED", 403);
    if (request.method !== "GET") throw new CommerceMetricsError("METHOD_NOT_ALLOWED", 405);
    await requireAdmin(request, env);
    return json(await buildCommerceMetrics(env, url), 200, origin);
  } catch (err) {
    if (err instanceof CommerceMetricsError) return json({ error: err.code, requestId: reqId }, err.status, origin);
    console.error(JSON.stringify({
      level: "error",
      event: "admin_commerce_metrics_error",
      requestId: reqId,
      message: String(err?.message || "unknown").slice(0, 180),
    }));
    return json({ error: "INTERNAL_ADMIN_COMMERCE_METRICS_ERROR", requestId: reqId }, 500, origin);
  }
}

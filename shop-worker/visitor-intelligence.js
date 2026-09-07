import { safeText } from "./commerce-core.js";

const SHOP_ORIGINS = Object.freeze([
  "https://disorder119.com",
  "https://www.disorder119.com",
  "http://localhost:8765",
  "http://127.0.0.1:8765",
]);
const ADMIN_ORIGINS = Object.freeze([
  "https://admin.disorder119.com",
  "http://localhost:8765",
  "http://127.0.0.1:8765",
]);
const EVENT_TYPES = Object.freeze([
  "PAGE_VIEW",
  "PRODUCT_VIEW",
  "CART_ADD",
  "CART_REMOVE",
  "CART_VIEW",
  "CHECKOUT_STARTED",
  "ORDER_CREATED",
  "ORDER_COMPLETED",
]);
const SESSION_RE = /^[a-f0-9-]{20,64}$/i;

class VisitorError extends Error {
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

function corsHeaders(origin, admin = false) {
  const allowed = admin ? ADMIN_ORIGINS : SHOP_ORIGINS;
  const headers = {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "600",
    "Vary": "Origin",
  };
  if (origin && allowed.includes(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

function json(data, status = 200, origin = null, admin = false) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...securityHeaders(),
      ...corsHeaders(origin, admin),
    },
  });
}

function requireDb(env) {
  if (!env.DB) throw new VisitorError("COMMERCE_DATABASE_NOT_CONFIGURED", 503);
  return env.DB;
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
  if (!env.ADMIN_TOKEN) throw new VisitorError("ADMIN_NOT_CONFIGURED", 503);
  const supplied = String(request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!(await tokenEquals(supplied, env.ADMIN_TOKEN))) throw new VisitorError("UNAUTHORIZED", 401);
}

function assertOrigin(origin, admin = false) {
  if (!origin) return;
  const allowed = admin ? ADMIN_ORIGINS : SHOP_ORIGINS;
  if (!allowed.includes(origin)) throw new VisitorError("ORIGIN_NOT_ALLOWED", 403);
}

async function readSmallJson(request) {
  const type = String(request.headers.get("Content-Type") || "").toLowerCase();
  if (!type.includes("application/json")) throw new VisitorError("CONTENT_TYPE_REQUIRED", 415);
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > 8 * 1024) throw new VisitorError("REQUEST_TOO_LARGE", 413);
  try { return raw ? JSON.parse(raw) : {}; }
  catch { throw new VisitorError("INVALID_JSON", 400); }
}

function safePath(value) {
  let path = safeText(value, 260) || "/";
  try {
    const parsed = new URL(path, "https://disorder119.com");
    path = parsed.pathname || "/";
  } catch {
    path = "/";
  }
  if (!path.startsWith("/")) path = "/" + path;
  return path.slice(0, 240);
}

function safeHost(value) {
  const raw = safeText(value, 160).toLowerCase();
  if (!raw) return null;
  try {
    const parsed = new URL(raw.includes("://") ? raw : `https://${raw}`);
    return safeText(parsed.hostname, 120).toLowerCase() || null;
  } catch {
    return null;
  }
}

function safeDevice(value) {
  const device = safeText(value, 20).toUpperCase();
  return ["DESKTOP", "TABLET", "MOBILE", "UNKNOWN"].includes(device) ? device : "UNKNOWN";
}

function safeSessionId(value) {
  const id = safeText(value, 64);
  if (!SESSION_RE.test(id)) throw new VisitorError("INVALID_SESSION_ID", 400);
  return id;
}

function safeItemId(value) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function safeMetadata(value) {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const output = {};
  const textFields = {
    brand: 100,
    title: 180,
    orderId: 140,
    orderNumber: 80,
    source: 60,
  };
  for (const [key, max] of Object.entries(textFields)) {
    const cleaned = safeText(input[key], max);
    if (cleaned) output[key] = cleaned;
  }
  const itemId = safeItemId(input.itemId);
  if (itemId) output.itemId = itemId;
  return output;
}

async function rateLimit(request, env) {
  if (!env.RATE_LIMITER || typeof env.RATE_LIMITER.limit !== "function") return;
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const result = await env.RATE_LIMITER.limit({ key: `visitor-event:${ip}` });
  if (result && result.success === false) throw new VisitorError("RATE_LIMITED", 429);
}

function counterValues(eventType) {
  return {
    pageViews: eventType === "PAGE_VIEW" ? 1 : 0,
    productViews: eventType === "PRODUCT_VIEW" ? 1 : 0,
    cartEvents: eventType === "CART_ADD" || eventType === "CART_REMOVE" || eventType === "CART_VIEW" ? 1 : 0,
    checkoutEvents: eventType === "CHECKOUT_STARTED" ? 1 : 0,
    orderEvents: eventType === "ORDER_CREATED" || eventType === "ORDER_COMPLETED" ? 1 : 0,
  };
}

async function recordEvent(request, env, origin) {
  assertOrigin(origin, false);
  await rateLimit(request, env);
  const db = requireDb(env);
  const body = await readSmallJson(request);
  const sessionId = safeSessionId(body.sessionId);
  const eventType = safeText(body.eventType, 40).toUpperCase();
  if (!EVENT_TYPES.includes(eventType)) throw new VisitorError("INVALID_EVENT_TYPE", 400);
  const path = safePath(body.path);
  const referrerHost = safeHost(body.referrerHost);
  const deviceClass = safeDevice(body.deviceClass);
  const metadata = safeMetadata(body.metadata);
  const itemId = safeItemId(body.itemId ?? metadata.itemId);
  const orderRef = safeText(metadata.orderNumber || metadata.orderId, 140) || null;
  const countryCode = safeText(request.cf?.country, 2).toUpperCase() || null;
  const now = new Date().toISOString();
  const counters = counterValues(eventType);
  const convertedAt = eventType === "ORDER_COMPLETED" ? now : null;

  await db.batch([
    db.prepare(`INSERT INTO visitor_sessions
      (id,started_at,last_seen_at,landing_path,current_path,referrer_host,country_code,device_class,
       page_views,product_views,cart_events,checkout_events,order_events,linked_order_ref,converted_at,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET
        last_seen_at=excluded.last_seen_at,
        current_path=excluded.current_path,
        referrer_host=COALESCE(visitor_sessions.referrer_host,excluded.referrer_host),
        country_code=COALESCE(visitor_sessions.country_code,excluded.country_code),
        device_class=CASE WHEN excluded.device_class='UNKNOWN' THEN visitor_sessions.device_class ELSE excluded.device_class END,
        page_views=visitor_sessions.page_views+excluded.page_views,
        product_views=visitor_sessions.product_views+excluded.product_views,
        cart_events=visitor_sessions.cart_events+excluded.cart_events,
        checkout_events=visitor_sessions.checkout_events+excluded.checkout_events,
        order_events=visitor_sessions.order_events+excluded.order_events,
        linked_order_ref=COALESCE(excluded.linked_order_ref,visitor_sessions.linked_order_ref),
        converted_at=COALESCE(excluded.converted_at,visitor_sessions.converted_at),
        updated_at=excluded.updated_at`).bind(
          sessionId, now, now, path, path, referrerHost, countryCode, deviceClass,
          counters.pageViews, counters.productViews, counters.cartEvents, counters.checkoutEvents, counters.orderEvents,
          orderRef, convertedAt, now, now,
        ),
    db.prepare(`INSERT INTO visitor_events
      (id,session_id,event_type,path,item_id,metadata_json,created_at)
      VALUES (?,?,?,?,?,?,?)`).bind(
        crypto.randomUUID(), sessionId, eventType, path, itemId,
        Object.keys(metadata).length ? JSON.stringify(metadata) : null, now,
      ),
  ]);

  return { ok: true };
}

function clampLimit(value, fallback = 80, max = 250) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
}

function clampOffset(value) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 100000) : 0;
}

async function visitorSummary(db) {
  const rows = await db.batch([
    db.prepare(`SELECT
      COUNT(*) AS totalSessions,
      SUM(CASE WHEN julianday(last_seen_at)>=julianday('now','-5 minutes') THEN 1 ELSE 0 END) AS onlineNow,
      SUM(CASE WHEN date(started_at)=date('now') THEN 1 ELSE 0 END) AS sessionsToday,
      SUM(CASE WHEN date(started_at)=date('now') AND converted_at IS NOT NULL THEN 1 ELSE 0 END) AS convertedToday,
      SUM(CASE WHEN date(started_at)=date('now') AND checkout_events>0 AND converted_at IS NULL THEN 1 ELSE 0 END) AS checkoutWithoutOrderToday
      FROM visitor_sessions`),
    db.prepare(`SELECT
      SUM(CASE WHEN date(created_at)=date('now') AND event_type='PAGE_VIEW' THEN 1 ELSE 0 END) AS pageViewsToday,
      SUM(CASE WHEN date(created_at)=date('now') AND event_type='PRODUCT_VIEW' THEN 1 ELSE 0 END) AS productViewsToday,
      SUM(CASE WHEN date(created_at)=date('now') AND event_type='CART_ADD' THEN 1 ELSE 0 END) AS cartAddsToday,
      SUM(CASE WHEN date(created_at)=date('now') AND event_type='CHECKOUT_STARTED' THEN 1 ELSE 0 END) AS checkoutsToday
      FROM visitor_events`),
  ]);
  return {
    ...((rows[0]?.results || [])[0] || {}),
    ...((rows[1]?.results || [])[0] || {}),
  };
}

function listClause(status) {
  if (status === "online") return "julianday(last_seen_at)>=julianday('now','-5 minutes')";
  if (status === "today") return "date(started_at)=date('now')";
  if (status === "converted") return "converted_at IS NOT NULL";
  if (status === "checkout") return "checkout_events>0 AND converted_at IS NULL";
  return "1=1";
}

async function listVisitors(env, url) {
  const db = requireDb(env);
  const limit = clampLimit(url.searchParams.get("limit"));
  const offset = clampOffset(url.searchParams.get("offset"));
  const status = safeText(url.searchParams.get("status"), 20).toLowerCase() || "today";
  if (!["online", "today", "all", "converted", "checkout"].includes(status)) throw new VisitorError("INVALID_VISITOR_STATUS", 400);
  const q = safeText(url.searchParams.get("q"), 120);
  const where = [listClause(status)];
  const binds = [];
  if (q) {
    where.push("(id LIKE ? OR current_path LIKE ? OR landing_path LIKE ? OR referrer_host LIKE ? OR linked_order_ref LIKE ?)");
    const like = `%${q}%`;
    binds.push(like, like, like, like, like);
  }
  const clause = where.join(" AND ");
  const count = await db.prepare(`SELECT COUNT(*) AS total FROM visitor_sessions WHERE ${clause}`).bind(...binds).first();
  const rows = await db.prepare(`SELECT id,started_at,last_seen_at,landing_path,current_path,referrer_host,country_code,device_class,
    page_views AS pageViews,product_views AS productViews,cart_events AS cartEvents,checkout_events AS checkoutEvents,
    order_events AS orderEvents,linked_order_ref AS linkedOrderRef,converted_at AS convertedAt,
    CAST(MAX(0,(julianday(last_seen_at)-julianday(started_at))*86400) AS INTEGER) AS durationSeconds,
    CASE WHEN julianday(last_seen_at)>=julianday('now','-5 minutes') THEN 1 ELSE 0 END AS isOnline
    FROM visitor_sessions WHERE ${clause} ORDER BY last_seen_at DESC LIMIT ? OFFSET ?`).bind(...binds, limit, offset).all();
  return {
    generatedAt: new Date().toISOString(),
    summary: await visitorSummary(db),
    status,
    total: Number(count?.total || 0),
    limit,
    offset,
    sessions: rows.results || [],
  };
}

async function resolveLinkedOrder(db, orderRef) {
  if (!orderRef) return null;
  const row = await db.prepare(`SELECT DISTINCT o.id,o.order_number AS orderNumber,o.status,o.total_cents AS totalCents,o.currency,o.created_at AS createdAt
    FROM commerce_orders o LEFT JOIN payments p ON p.order_id=o.id
    WHERE o.id=? OR o.order_number=? OR p.provider_order_id=? OR p.provider_payment_id=?
    ORDER BY o.created_at DESC LIMIT 1`).bind(orderRef, orderRef, orderRef, orderRef).first();
  return row || null;
}

async function getVisitor(env, sessionId) {
  const db = requireDb(env);
  const id = safeSessionId(sessionId);
  const session = await db.prepare(`SELECT id,started_at,last_seen_at,landing_path,current_path,referrer_host,country_code,device_class,
    page_views AS pageViews,product_views AS productViews,cart_events AS cartEvents,checkout_events AS checkoutEvents,
    order_events AS orderEvents,linked_order_ref AS linkedOrderRef,converted_at AS convertedAt,
    CAST(MAX(0,(julianday(last_seen_at)-julianday(started_at))*86400) AS INTEGER) AS durationSeconds,
    CASE WHEN julianday(last_seen_at)>=julianday('now','-5 minutes') THEN 1 ELSE 0 END AS isOnline
    FROM visitor_sessions WHERE id=?`).bind(id).first();
  if (!session) throw new VisitorError("VISITOR_NOT_FOUND", 404);
  const events = await db.prepare(`SELECT id,event_type AS eventType,path,item_id AS itemId,metadata_json AS metadataJson,created_at AS createdAt
    FROM visitor_events WHERE session_id=? ORDER BY created_at ASC LIMIT 1000`).bind(id).all();
  const normalizedEvents = (events.results || []).map(row => {
    let metadata = null;
    try { metadata = row.metadataJson ? JSON.parse(row.metadataJson) : null; } catch { metadata = null; }
    const { metadataJson, ...rest } = row;
    return { ...rest, metadata };
  });
  return {
    session,
    events: normalizedEvents,
    linkedOrder: await resolveLinkedOrder(db, session.linkedOrderRef),
  };
}

export async function handleVisitorIntelligence(request, env, url, reqId, origin = null) {
  const isAdmin = url.pathname === "/admin/visitors" || url.pathname.startsWith("/admin/visitors/");
  try {
    if (request.method === "OPTIONS") {
      assertOrigin(origin, isAdmin);
      return new Response(null, { status: 204, headers: { ...securityHeaders(), ...corsHeaders(origin, isAdmin) } });
    }
    if (url.pathname === "/analytics/event") {
      if (request.method !== "POST") throw new VisitorError("METHOD_NOT_ALLOWED", 405);
      return json(await recordEvent(request, env, origin), 202, origin, false);
    }
    if (isAdmin) {
      assertOrigin(origin, true);
      await requireAdmin(request, env);
      if (request.method !== "GET") throw new VisitorError("METHOD_NOT_ALLOWED", 405);
      if (url.pathname === "/admin/visitors") return json(await listVisitors(env, url), 200, origin, true);
      const sessionId = decodeURIComponent(url.pathname.slice("/admin/visitors/".length));
      return json(await getVisitor(env, sessionId), 200, origin, true);
    }
    throw new VisitorError("NOT_FOUND", 404);
  } catch (err) {
    if (err instanceof VisitorError) return json({ error: err.code, requestId: reqId }, err.status, origin, isAdmin);
    console.error(JSON.stringify({
      level: "error",
      event: "visitor_intelligence_error",
      requestId: reqId,
      message: safeText(err?.message || "unknown", 180),
    }));
    return json({ error: "INTERNAL_VISITOR_ERROR", requestId: reqId }, 500, origin, isAdmin);
  }
}

import { safeText } from "./commerce-core.js";

const PUBLIC_ORIGINS = Object.freeze([
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
  const allowed = admin ? ADMIN_ORIGINS : PUBLIC_ORIGINS;
  const headers = {
    "Access-Control-Allow-Methods": admin ? "GET, OPTIONS" : "POST, OPTIONS",
    "Access-Control-Allow-Headers": admin ? "Content-Type, Authorization" : "Content-Type",
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
  const bytes = new TextEncoder().encode(String(value || ""));
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
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
  const supplied = String(request.headers.get("Authorization") || "")
    .replace(/^Bearer\s+/i, "")
    .trim();
  if (!(await tokenEquals(supplied, env.ADMIN_TOKEN))) throw new VisitorError("UNAUTHORIZED", 401);
  requireDb(env);
}

function sessionId(value) {
  const id = safeText(value, 96);
  if (!/^[A-Za-z0-9_-]{16,96}$/.test(id)) throw new VisitorError("INVALID_SESSION_ID", 400);
  return id;
}

function intOrNull(value, min = 0, max = 100000) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return null;
  return Math.min(Math.max(parsed, min), max);
}

function allowedOrigin(origin, admin = false) {
  if (!origin) return true;
  return (admin ? ADMIN_ORIGINS : PUBLIC_ORIGINS).includes(origin);
}

function clientContext(request, payload) {
  const cf = request.cf || {};
  return {
    language: safeText(payload.language, 40) || null,
    deviceType: safeText(payload.deviceType, 24) || null,
    browser: safeText(payload.browser, 48) || null,
    platform: safeText(payload.platform, 64) || null,
    viewportWidth: intOrNull(payload.viewportWidth, 0, 10000),
    viewportHeight: intOrNull(payload.viewportHeight, 0, 10000),
    country: safeText(cf.country, 8) || null,
    region: safeText(cf.region, 100) || null,
    city: safeText(cf.city, 100) || null,
    colo: safeText(cf.colo, 16) || null,
  };
}

async function readJson(request) {
  const type = String(request.headers.get("content-type") || "").toLowerCase();
  if (!type.includes("application/json")) throw new VisitorError("CONTENT_TYPE_REQUIRED", 415);
  try {
    return await request.json();
  } catch {
    throw new VisitorError("INVALID_JSON", 400);
  }
}

export function clampVisitorLimit(value, fallback = 100, max = 250) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

export function clampVisitorOffset(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.min(parsed, 100000);
}

export async function handleVisitRequest(request, env, url, reqId, origin = null) {
  try {
    if (request.method === "OPTIONS") {
      if (!allowedOrigin(origin, false)) return new Response(null, { status: 403, headers: securityHeaders() });
      return new Response(null, { status: 204, headers: { ...securityHeaders(), ...corsHeaders(origin, false) } });
    }
    if (!allowedOrigin(origin, false)) throw new VisitorError("ORIGIN_NOT_ALLOWED", 403);
    if (request.method !== "POST" || url.pathname !== "/visit") throw new VisitorError("NOT_FOUND", 404);

    const db = requireDb(env);
    const body = await readJson(request);
    const id = sessionId(body.sessionId);
    const path = safeText(body.path, 320) || "/";
    const title = safeText(body.title, 180) || null;
    const referrer = safeText(body.referrer, 500) || null;
    const utmSource = safeText(body.utmSource, 120) || null;
    const utmMedium = safeText(body.utmMedium, 120) || null;
    const utmCampaign = safeText(body.utmCampaign, 160) || null;
    const now = new Date().toISOString();
    const context = clientContext(request, body);
    const pageviewId = crypto.randomUUID();

    await db.batch([
      db.prepare(`INSERT INTO visitor_sessions (
          id,first_seen_at,last_seen_at,page_views,landing_path,last_path,landing_title,last_title,
          initial_referrer,last_referrer,utm_source,utm_medium,utm_campaign,language,device_type,browser,
          platform,viewport_width,viewport_height,country,region,city,colo,created_at,updated_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET
          last_seen_at=excluded.last_seen_at,
          page_views=visitor_sessions.page_views+1,
          last_path=excluded.last_path,
          last_title=excluded.last_title,
          last_referrer=excluded.last_referrer,
          language=COALESCE(excluded.language,visitor_sessions.language),
          device_type=COALESCE(excluded.device_type,visitor_sessions.device_type),
          browser=COALESCE(excluded.browser,visitor_sessions.browser),
          platform=COALESCE(excluded.platform,visitor_sessions.platform),
          viewport_width=COALESCE(excluded.viewport_width,visitor_sessions.viewport_width),
          viewport_height=COALESCE(excluded.viewport_height,visitor_sessions.viewport_height),
          country=COALESCE(excluded.country,visitor_sessions.country),
          region=COALESCE(excluded.region,visitor_sessions.region),
          city=COALESCE(excluded.city,visitor_sessions.city),
          colo=COALESCE(excluded.colo,visitor_sessions.colo),
          updated_at=excluded.updated_at`)
        .bind(
          id, now, now, 1, path, path, title, title, referrer, referrer,
          utmSource, utmMedium, utmCampaign, context.language, context.deviceType, context.browser,
          context.platform, context.viewportWidth, context.viewportHeight, context.country, context.region,
          context.city, context.colo, now, now,
        ),
      db.prepare(`INSERT INTO visitor_pageviews (id,session_id,path,title,referrer,occurred_at)
        VALUES (?,?,?,?,?,?)`).bind(pageviewId, id, path, title, referrer, now),
    ]);

    return json({ ok: true, sessionId: id, pageviewId, at: now }, 202, origin, false);
  } catch (err) {
    if (err instanceof VisitorError) return json({ error: err.code, requestId: reqId }, err.status, origin, false);
    console.error(JSON.stringify({
      level: "error",
      event: "visitor_observability_write_error",
      requestId: reqId,
      message: safeText(err?.message || "unknown", 180),
    }));
    return json({ error: "INTERNAL_VISITOR_OBSERVABILITY_ERROR", requestId: reqId }, 500, origin, false);
  }
}

async function visitorSummary(db) {
  const results = await db.batch([
    db.prepare("SELECT COUNT(*) AS value FROM visitor_sessions WHERE julianday(last_seen_at)>=julianday('now','-15 minutes')"),
    db.prepare("SELECT COUNT(*) AS value FROM visitor_sessions WHERE julianday(first_seen_at)>=julianday('now','start of day')"),
    db.prepare("SELECT COUNT(*) AS value FROM visitor_pageviews WHERE julianday(occurred_at)>=julianday('now','start of day')"),
    db.prepare("SELECT COUNT(*) AS value FROM visitor_sessions WHERE julianday(first_seen_at)>=julianday('now','-7 days')"),
    db.prepare("SELECT COUNT(*) AS value FROM visitor_sessions"),
  ]);
  const value = index => Number(results[index]?.results?.[0]?.value || 0);
  return {
    active15m: value(0),
    visitorsToday: value(1),
    pageViewsToday: value(2),
    visitors7d: value(3),
    visitorsTotal: value(4),
  };
}

async function listVisitors(env, url) {
  const db = requireDb(env);
  const limit = clampVisitorLimit(url.searchParams.get("limit"));
  const offset = clampVisitorOffset(url.searchParams.get("offset"));
  const q = safeText(url.searchParams.get("q"), 120);
  const activeOnly = url.searchParams.get("active") === "1";
  const where = [];
  const binds = [];
  if (activeOnly) where.push("julianday(last_seen_at)>=julianday('now','-15 minutes')");
  if (q) {
    const like = `%${q}%`;
    where.push("(id LIKE ? OR last_path LIKE ? OR landing_path LIKE ? OR city LIKE ? OR country LIKE ? OR utm_source LIKE ? OR utm_campaign LIKE ?)");
    binds.push(like, like, like, like, like, like, like);
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const count = await db.prepare(`SELECT COUNT(*) AS total FROM visitor_sessions ${clause}`).bind(...binds).first();
  const rows = await db.prepare(`SELECT * FROM visitor_sessions ${clause}
    ORDER BY last_seen_at DESC LIMIT ? OFFSET ?`).bind(...binds, limit, offset).all();
  return {
    generatedAt: new Date().toISOString(),
    summary: await visitorSummary(db),
    total: Number(count?.total || 0),
    limit,
    offset,
    visitors: rows.results || [],
  };
}

async function visitorDetail(env, id) {
  const db = requireDb(env);
  const visitor = await db.prepare("SELECT * FROM visitor_sessions WHERE id=?").bind(id).first();
  if (!visitor) throw new VisitorError("VISITOR_NOT_FOUND", 404);
  const pageviews = await db.prepare(`SELECT id,path,title,referrer,occurred_at FROM visitor_pageviews
    WHERE session_id=? ORDER BY occurred_at DESC LIMIT 500`).bind(id).all();
  return { visitor, pageviews: pageviews.results || [] };
}

export async function handleAdminVisitors(request, env, url, reqId, origin = null) {
  try {
    if (request.method === "OPTIONS") {
      if (!allowedOrigin(origin, true)) return new Response(null, { status: 403, headers: securityHeaders() });
      return new Response(null, { status: 204, headers: { ...securityHeaders(), ...corsHeaders(origin, true) } });
    }
    if (!allowedOrigin(origin, true)) throw new VisitorError("ORIGIN_NOT_ALLOWED", 403);
    await requireAdmin(request, env);
    if (request.method !== "GET") throw new VisitorError("METHOD_NOT_ALLOWED", 405);

    if (url.pathname === "/admin/visitors") return json(await listVisitors(env, url), 200, origin, true);
    const match = /^\/admin\/visitors\/([^/]+)$/.exec(url.pathname);
    if (match) return json(await visitorDetail(env, sessionId(decodeURIComponent(match[1]))), 200, origin, true);
    throw new VisitorError("NOT_FOUND", 404);
  } catch (err) {
    if (err instanceof VisitorError) return json({ error: err.code, requestId: reqId }, err.status, origin, true);
    console.error(JSON.stringify({
      level: "error",
      event: "admin_visitors_error",
      requestId: reqId,
      message: safeText(err?.message || "unknown", 180),
    }));
    return json({ error: "INTERNAL_ADMIN_VISITORS_ERROR", requestId: reqId }, 500, origin, true);
  }
}

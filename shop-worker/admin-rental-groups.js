import { RENTAL_STATUSES, canTransitionRental, safeText } from "./commerce-core.js";

const ADMIN_ORIGINS = Object.freeze([
  "https://admin.disorder119.com",
  "http://localhost:8765",
  "http://127.0.0.1:8765",
]);

class GroupAdminError extends Error {
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
    "Access-Control-Allow-Methods": "GET, PATCH, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
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
  if (!env.ADMIN_TOKEN) throw new GroupAdminError("ADMIN_NOT_CONFIGURED", 503);
  const token = String(request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!(await tokenEquals(token, env.ADMIN_TOKEN))) throw new GroupAdminError("UNAUTHORIZED", 401);
  if (!env.DB) throw new GroupAdminError("COMMERCE_DATABASE_NOT_CONFIGURED", 503);
}

async function readJson(request) {
  if (!(request.headers.get("Content-Type") || "").toLowerCase().includes("application/json")) {
    throw new GroupAdminError("CONTENT_TYPE_REQUIRED", 415);
  }
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > 16 * 1024) throw new GroupAdminError("REQUEST_TOO_LARGE", 413);
  try { return raw ? JSON.parse(raw) : {}; }
  catch { throw new GroupAdminError("INVALID_JSON", 400); }
}

function clamp(value, fallback = 50, max = 250) {
  const n = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, max) : fallback;
}

function groupTransitions(status) {
  const current = String(status || "").toUpperCase();
  if (current === "BUILDING") return [];
  return RENTAL_STATUSES.filter(next => next !== current && canTransitionRental(current, next));
}

async function loadCatalogMap() {
  try {
    const res = await fetch("https://disorder119.com/data/catalog.json", {
      headers: { Accept: "application/json", "User-Agent": "disorder119-rental-group-admin" },
    });
    if (!res.ok) return new Map();
    const items = await res.json();
    return new Map((Array.isArray(items) ? items : []).map(item => [Number(item.id), {
      id: Number(item.id), brand: String(item.brand || ""), title: String(item.title || ""),
      article: String(item.article || item.id || ""), size: String(item.size || ""), category: String(item.category || ""),
      image: Array.isArray(item.gallery) && item.gallery[0] ? `/${String(item.gallery[0]).replace(/^\//, "")}` : null,
    }]));
  } catch { return new Map(); }
}

function parseMetadata(value) {
  try { return value ? JSON.parse(value) : null; } catch { return null; }
}

async function audit(env, groupId, eventType, reqId, metadata = null) {
  await env.DB.prepare(`INSERT INTO audit_events
    (id,actor_type,entity_type,entity_id,event_type,request_id,metadata_json,created_at)
    VALUES (?,'ADMIN','rental_group',?,?,?,?,?)`).bind(
      crypto.randomUUID(), groupId, eventType, reqId, metadata ? JSON.stringify(metadata) : null, new Date().toISOString()
    ).run();
}

async function listGroups(env, url) {
  const db = env.DB;
  const limit = clamp(url.searchParams.get("limit"));
  const offset = Math.max(0, Number.parseInt(String(url.searchParams.get("offset") || "0"), 10) || 0);
  const status = safeText(url.searchParams.get("status"), 40).toUpperCase();
  const q = safeText(url.searchParams.get("q"), 120);
  const allowed = ["BUILDING", ...RENTAL_STATUSES];
  if (status && !allowed.includes(status)) throw new GroupAdminError("INVALID_RENTAL_GROUP_STATUS", 400);
  const where = [];
  const binds = [];
  if (status) { where.push("g.status=?"); binds.push(status); }
  if (q) {
    const like = `%${q}%`;
    where.push(`(g.id LIKE ? OR g.purpose LIKE ? OR g.message LIKE ? OR EXISTS (
      SELECT 1 FROM rental_reservations rr JOIN inventory i ON i.id=rr.inventory_id
      WHERE rr.group_id=g.id AND (CAST(i.item_id AS TEXT) LIKE ? OR i.article_no LIKE ?)
    ))`);
    binds.push(like, like, like, like, like);
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const total = await db.prepare(`SELECT COUNT(*) AS total FROM rental_groups g ${clause}`).bind(...binds).first();
  const rows = await db.prepare(`SELECT g.*,
      (SELECT COUNT(*) FROM rental_reservations rr WHERE rr.group_id=g.id) AS childCount,
      (SELECT GROUP_CONCAT(i.article_no,' · ') FROM rental_reservations rr JOIN inventory i ON i.id=rr.inventory_id WHERE rr.group_id=g.id) AS articleNos,
      (SELECT MIN(rr.created_at) FROM rental_reservations rr WHERE rr.group_id=g.id) AS firstChildAt
    FROM rental_groups g ${clause} ORDER BY g.created_at DESC LIMIT ? OFFSET ?`).bind(...binds, limit, offset).all();
  return {
    total: Number(total?.total || 0), limit, offset,
    groups: (rows.results || []).map(row => ({ ...row, nextStatuses: groupTransitions(row.status) })),
  };
}

async function groupDetail(env, id) {
  const db = env.DB;
  const group = await db.prepare("SELECT * FROM rental_groups WHERE id=?").bind(id).first();
  if (!group) throw new GroupAdminError("RENTAL_GROUP_NOT_FOUND", 404);
  const [children, events] = await db.batch([
    db.prepare(`SELECT rr.*,i.item_id AS itemId,i.article_no AS articleNo,i.status AS inventoryStatus,i.sale_price_cents AS salePriceCents
      FROM rental_reservations rr JOIN inventory i ON i.id=rr.inventory_id
      WHERE rr.group_id=? ORDER BY rr.created_at, i.item_id`).bind(id),
    db.prepare(`SELECT * FROM audit_events
      WHERE (entity_type='rental_group' AND entity_id=?)
         OR entity_id IN (SELECT id FROM rental_reservations WHERE group_id=?)
      ORDER BY created_at DESC LIMIT 300`).bind(id, id),
  ]);
  const catalog = await loadCatalogMap();
  const items = (children.results || []).map(row => ({ ...row, catalog: catalog.get(Number(row.itemId)) || null }));
  return {
    group,
    nextStatuses: groupTransitions(group.status),
    items,
    activity: (events.results || []).map(row => ({ ...row, metadata: parseMetadata(row.metadata_json) })),
  };
}

async function updateGroup(env, id, body, reqId) {
  const db = env.DB;
  const group = await db.prepare("SELECT * FROM rental_groups WHERE id=?").bind(id).first();
  if (!group) throw new GroupAdminError("RENTAL_GROUP_NOT_FOUND", 404);
  const next = safeText(body.status, 40).toUpperCase();
  if (!next || !groupTransitions(group.status).includes(next)) throw new GroupAdminError("INVALID_RENTAL_GROUP_STATUS_TRANSITION", 409);

  const children = await db.prepare("SELECT id,inventory_id,status FROM rental_reservations WHERE group_id=? ORDER BY id").bind(id).all();
  const rows = children.results || [];
  if (rows.length !== Number(group.item_count || 0)) throw new GroupAdminError("RENTAL_GROUP_INCOMPLETE", 409);
  if (rows.some(row => !canTransitionRental(String(row.status), next))) throw new GroupAdminError("RENTAL_GROUP_CHILD_STATE_MISMATCH", 409);
  const now = new Date().toISOString();
  const statements = [
    db.prepare("UPDATE rental_groups SET status=?,updated_at=? WHERE id=? AND status=?").bind(next, now, id, group.status),
  ];
  for (const child of rows) {
    statements.push(db.prepare("UPDATE rental_reservations SET status=?,updated_at=? WHERE id=? AND status=?")
      .bind(next, now, child.id, child.status));
    statements.push(db.prepare("UPDATE rentals SET status=?,updated_at=? WHERE rental_reservation_id=? AND status!=?")
      .bind(next, now, child.id, next));
  }

  if (["RETURNED", "CANCELLED", "REFUNDED"].includes(next)) {
    statements.push(db.prepare("DELETE FROM rental_days WHERE rental_reservation_id IN (SELECT id FROM rental_reservations WHERE group_id=?)").bind(id));
    statements.push(db.prepare(`UPDATE inventory SET status='AVAILABLE',updated_at=?,version=version+1
      WHERE id IN (SELECT inventory_id FROM rental_reservations WHERE group_id=?)
      AND NOT EXISTS (SELECT 1 FROM reservations r WHERE r.inventory_id=inventory.id AND r.status='RESERVED' AND r.expires_at>?)
      AND NOT EXISTS (SELECT 1 FROM rental_reservations rr WHERE rr.inventory_id=inventory.id AND rr.group_id<>? AND rr.status IN ('RESERVED','PAYMENT_PENDING','CONFIRMED','ACTIVE','RETURN_DUE'))`)
      .bind(now, id, now, id));
  }

  await db.batch(statements);
  await audit(env, id, `RENTAL_GROUP_${next}`, reqId, { from: group.status, to: next, itemCount: rows.length });
  return groupDetail(env, id);
}

export async function handleAdminRentalGroups(request, env, url, reqId, origin = null) {
  try {
    if (request.method === "OPTIONS") {
      if (origin && !ADMIN_ORIGINS.includes(origin)) return new Response(null, { status: 403, headers: securityHeaders() });
      return new Response(null, { status: 204, headers: { ...securityHeaders(), ...corsHeaders(origin) } });
    }
    if (origin && !ADMIN_ORIGINS.includes(origin)) throw new GroupAdminError("ORIGIN_NOT_ALLOWED", 403);
    await requireAdmin(request, env);
    const path = url.pathname;
    if (path === "/admin/rental-groups" && request.method === "GET") return json(await listGroups(env, url), 200, origin);
    const match = /^\/admin\/rental-groups\/([^/]+)$/.exec(path);
    if (match) {
      const id = decodeURIComponent(match[1]);
      if (request.method === "GET") return json(await groupDetail(env, id), 200, origin);
      if (request.method === "PATCH") return json(await updateGroup(env, id, await readJson(request), reqId), 200, origin);
    }
    throw new GroupAdminError("NOT_FOUND", 404);
  } catch (err) {
    if (err instanceof GroupAdminError) return json({ error: err.code, requestId: reqId }, err.status, origin);
    console.error(JSON.stringify({ level: "error", event: "admin_rental_group_error", requestId: reqId, message: safeText(err?.message || "unknown", 180) }));
    return json({ error: "INTERNAL_RENTAL_GROUP_ADMIN_ERROR", requestId: reqId }, 500, origin);
  }
}

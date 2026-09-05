import { safeText } from "./commerce-core.js";

const ADMIN_ORIGINS = Object.freeze([
  "https://admin.disorder119.com",
  "http://localhost:8765",
  "http://127.0.0.1:8765",
]);

const RETURN_TRANSITIONS = Object.freeze({
  REQUESTED: ["AUTHORIZED", "REJECTED"],
  AUTHORIZED: ["IN_TRANSIT", "RECEIVED", "REJECTED"],
  IN_TRANSIT: ["RECEIVED"],
  RECEIVED: ["INSPECTED"],
  INSPECTED: ["CLOSED"],
  CLOSED: [],
  REJECTED: [],
});

const DAMAGE_TRANSITIONS = Object.freeze({
  OPEN: ["REVIEW", "RESOLVED", "WAIVED"],
  REVIEW: ["OPEN", "RESOLVED", "WAIVED"],
  RESOLVED: [],
  WAIVED: [],
});

const DAMAGE_SEVERITIES = Object.freeze(["MINOR", "MAJOR", "LOST", "OTHER"]);
const DAMAGE_STATUSES = Object.freeze(Object.keys(DAMAGE_TRANSITIONS));
const TASK_STATUSES = Object.freeze(["OPEN", "DONE", "DISMISSED"]);
const TASK_PRIORITIES = Object.freeze(["LOW", "NORMAL", "HIGH", "URGENT"]);
const TASK_ENTITY_TYPES = Object.freeze([
  "ORDER", "RENTAL", "RENTAL_GROUP", "RETURN", "REFUND", "PAYMENT",
  "SHIPMENT", "CUSTOMER", "INVENTORY", "SYSTEM",
]);

class CasesAdminError extends Error {
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

function json(data, status = 200, origin = null) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...securityHeaders(), ...corsHeaders(origin) },
  });
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
  if (!env.ADMIN_TOKEN) throw new CasesAdminError("ADMIN_NOT_CONFIGURED", 503);
  const supplied = String(request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!(await tokenEquals(supplied, env.ADMIN_TOKEN))) throw new CasesAdminError("UNAUTHORIZED", 401);
  if (!env.DB) throw new CasesAdminError("COMMERCE_DATABASE_NOT_CONFIGURED", 503);
}

async function readJson(request) {
  if (!(request.headers.get("Content-Type") || "").toLowerCase().includes("application/json")) {
    throw new CasesAdminError("CONTENT_TYPE_REQUIRED", 415);
  }
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > 32 * 1024) throw new CasesAdminError("REQUEST_TOO_LARGE", 413);
  try { return raw ? JSON.parse(raw) : {}; }
  catch { throw new CasesAdminError("INVALID_JSON", 400); }
}

function clampLimit(value, fallback = 50, max = 200) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
}

export function normalizeNonNegativeCents(value, optional = true) {
  if ((value === null || value === undefined || value === "") && optional) return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) return undefined;
  return parsed;
}

export function returnNextStatuses(status) {
  return (RETURN_TRANSITIONS[String(status || "").toUpperCase()] || []).slice();
}

export function damageNextStatuses(status) {
  return (DAMAGE_TRANSITIONS[String(status || "").toUpperCase()] || []).slice();
}

function nullableIso(value) {
  const text = safeText(value, 50);
  if (!text) return null;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) throw new CasesAdminError("INVALID_DATE", 400);
  return parsed.toISOString();
}

async function audit(env, entityType, entityId, eventType, reqId, metadata = null) {
  await env.DB.prepare(`INSERT INTO audit_events
    (id,actor_type,entity_type,entity_id,event_type,request_id,metadata_json,created_at)
    VALUES (?,'ADMIN',?,?,?,?,?,?)`).bind(
      crypto.randomUUID(), entityType, String(entityId), eventType, reqId,
      metadata ? JSON.stringify(metadata) : null, new Date().toISOString()
    ).run();
}

function decorateReturn(row) {
  return row ? { ...row, nextStatuses: returnNextStatuses(row.status) } : row;
}

function decorateDamage(row) {
  return row ? { ...row, nextStatuses: damageNextStatuses(row.status) } : row;
}

async function getCases(env, url) {
  const db = env.DB;
  const limit = clampLimit(url.searchParams.get("limit"));
  const [summary, returns, damages, tasks, refunds, payments] = await db.batch([
    db.prepare(`SELECT
      (SELECT COUNT(*) FROM returns WHERE status NOT IN ('CLOSED','REJECTED')) AS openReturns,
      (SELECT COUNT(*) FROM damage_cases WHERE status IN ('OPEN','REVIEW')) AS openDamages,
      (SELECT COUNT(*) FROM operations_tasks WHERE status='OPEN') AS openTasks,
      (SELECT COUNT(*) FROM operations_tasks WHERE status='OPEN' AND due_at IS NOT NULL AND julianday(due_at)<julianday('now')) AS overdueTasks,
      (SELECT COUNT(*) FROM payment_events WHERE processed_at IS NULL) AS unprocessedPaymentEvents,
      (SELECT COUNT(*) FROM payments WHERE status IN ('CREATED','PENDING','AUTHORIZED','FAILED')) AS paymentAttention,
      (SELECT COUNT(*) FROM refunds WHERE status IN ('PENDING','FAILED')) AS refundAttention`),
    db.prepare(`SELECT r.*,o.order_number AS orderNumber,rr.rental_reservation_id AS rentalReservationId,
        i.item_id AS itemId,i.article_no AS articleNo
      FROM returns r
      LEFT JOIN commerce_orders o ON o.id=r.order_id
      LEFT JOIN rentals rr ON rr.id=r.rental_id
      LEFT JOIN inventory i ON i.id=rr.inventory_id
      ORDER BY CASE WHEN r.status IN ('CLOSED','REJECTED') THEN 1 ELSE 0 END,r.created_at DESC LIMIT ?`).bind(limit),
    db.prepare(`SELECT d.*,rr.rental_reservation_id AS rentalReservationId,i.item_id AS itemId,i.article_no AS articleNo,
        ret.status AS returnStatus
      FROM damage_cases d
      JOIN rentals rr ON rr.id=d.rental_id
      JOIN inventory i ON i.id=rr.inventory_id
      LEFT JOIN returns ret ON ret.id=d.return_id
      ORDER BY CASE WHEN d.status IN ('RESOLVED','WAIVED') THEN 1 ELSE 0 END,d.created_at DESC LIMIT ?`).bind(limit),
    db.prepare(`SELECT * FROM operations_tasks
      ORDER BY CASE status WHEN 'OPEN' THEN 0 ELSE 1 END,
        CASE priority WHEN 'URGENT' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'NORMAL' THEN 2 ELSE 3 END,
        CASE WHEN due_at IS NULL THEN 1 ELSE 0 END,due_at,created_at DESC LIMIT ?`).bind(limit),
    db.prepare(`SELECT rf.*,o.order_number AS orderNumber,rr.rental_reservation_id AS rentalReservationId,
        p.provider,p.provider_payment_id AS providerPaymentId
      FROM refunds rf
      LEFT JOIN commerce_orders o ON o.id=rf.order_id
      LEFT JOIN rentals rr ON rr.id=rf.rental_id
      LEFT JOIN payments p ON p.id=rf.payment_id
      ORDER BY rf.created_at DESC LIMIT ?`).bind(limit),
    db.prepare(`SELECT p.id,p.order_id AS orderId,o.order_number AS orderNumber,p.provider,p.provider_order_id AS providerOrderId,
        p.provider_payment_id AS providerPaymentId,p.status,p.amount_cents AS amountCents,p.currency,p.created_at AS createdAt,p.updated_at AS updatedAt
      FROM payments p JOIN commerce_orders o ON o.id=p.order_id ORDER BY p.created_at DESC LIMIT ?`).bind(limit),
  ]);
  return {
    generatedAt: new Date().toISOString(),
    summary: summary.results?.[0] || {},
    returns: (returns.results || []).map(decorateReturn),
    damages: (damages.results || []).map(decorateDamage),
    tasks: tasks.results || [],
    refunds: refunds.results || [],
    payments: payments.results || [],
  };
}

async function resolveRental(db, value) {
  const id = safeText(value, 160);
  if (!id) return null;
  return db.prepare(`SELECT r.id,r.rental_reservation_id,r.inventory_id,r.status
    FROM rentals r WHERE r.id=? OR r.rental_reservation_id=? LIMIT 1`).bind(id, id).first();
}

async function createReturn(env, body, reqId) {
  const db = env.DB;
  const entityType = safeText(body.entityType, 20).toUpperCase();
  const entityId = safeText(body.entityId, 160);
  const reasonCode = safeText(body.reasonCode, 120) || null;
  if (!entityId || !["ORDER", "RENTAL"].includes(entityType)) throw new CasesAdminError("INVALID_RETURN_ENTITY", 400);

  let orderId = null;
  let rentalId = null;
  if (entityType === "ORDER") {
    const order = await db.prepare("SELECT id FROM commerce_orders WHERE id=? OR order_number=?").bind(entityId, entityId).first();
    if (!order) throw new CasesAdminError("ORDER_NOT_FOUND", 404);
    orderId = order.id;
  } else {
    const rental = await resolveRental(db, entityId);
    if (!rental) throw new CasesAdminError("DURABLE_RENTAL_NOT_FOUND", 404);
    rentalId = rental.id;
  }

  const open = orderId
    ? await db.prepare("SELECT id FROM returns WHERE order_id=? AND status NOT IN ('CLOSED','REJECTED') LIMIT 1").bind(orderId).first()
    : await db.prepare("SELECT id FROM returns WHERE rental_id=? AND status NOT IN ('CLOSED','REJECTED') LIMIT 1").bind(rentalId).first();
  if (open) throw new CasesAdminError("OPEN_RETURN_ALREADY_EXISTS", 409);

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.prepare(`INSERT INTO returns (id,order_id,rental_id,status,reason_code,created_at,updated_at)
    VALUES (?,?,?,'REQUESTED',?,?,?)`).bind(id, orderId, rentalId, reasonCode, now, now).run();
  await audit(env, "return", id, "RETURN_CREATED", reqId, { entityType, entityId: orderId || rentalId, reasonCode });
  return decorateReturn(await db.prepare("SELECT * FROM returns WHERE id=?").bind(id).first());
}

async function updateReturn(env, id, body, reqId) {
  const db = env.DB;
  const row = await db.prepare("SELECT * FROM returns WHERE id=?").bind(id).first();
  if (!row) throw new CasesAdminError("RETURN_NOT_FOUND", 404);
  const next = safeText(body.status, 40).toUpperCase();
  const reasonProvided = Object.prototype.hasOwnProperty.call(body, "reasonCode");
  const reason = reasonProvided ? (safeText(body.reasonCode, 120) || null) : row.reason_code;
  if (!next && !reasonProvided) throw new CasesAdminError("NO_RETURN_CHANGES", 400);
  if (next && !returnNextStatuses(row.status).includes(next)) throw new CasesAdminError("INVALID_RETURN_STATUS_TRANSITION", 409);
  const now = new Date().toISOString();
  await db.prepare("UPDATE returns SET status=?,reason_code=?,updated_at=? WHERE id=?")
    .bind(next || row.status, reason, now, id).run();
  await audit(env, "return", id, "RETURN_UPDATED", reqId, { from: row.status, to: next || row.status, reasonCode: reason });
  return decorateReturn(await db.prepare("SELECT * FROM returns WHERE id=?").bind(id).first());
}

async function createDamage(env, body, reqId) {
  const db = env.DB;
  const rental = await resolveRental(db, body.rentalId || body.rentalReservationId);
  if (!rental) throw new CasesAdminError("DURABLE_RENTAL_NOT_FOUND", 404);
  const returnId = safeText(body.returnId, 160) || null;
  if (returnId) {
    const ret = await db.prepare("SELECT id,rental_id FROM returns WHERE id=?").bind(returnId).first();
    if (!ret || ret.rental_id !== rental.id) throw new CasesAdminError("RETURN_RENTAL_MISMATCH", 409);
  }
  const severity = safeText(body.severity, 20).toUpperCase();
  const description = safeText(body.description, 4000);
  const estimated = normalizeNonNegativeCents(body.estimatedAmountCents, true);
  const withheld = normalizeNonNegativeCents(body.withheldAmountCents, true);
  if (!DAMAGE_SEVERITIES.includes(severity) || !description) throw new CasesAdminError("INVALID_DAMAGE_CASE", 400);
  if (estimated === undefined || withheld === undefined) throw new CasesAdminError("INVALID_DAMAGE_AMOUNT", 400);

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.prepare(`INSERT INTO damage_cases
    (id,rental_id,return_id,severity,status,description,estimated_amount_cents,withheld_amount_cents,created_at,updated_at)
    VALUES (?,?,?,?,'OPEN',?,?,?,?,?)`).bind(id, rental.id, returnId, severity, description, estimated, withheld, now, now).run();
  await audit(env, "damage_case", id, "DAMAGE_CASE_CREATED", reqId, {
    rentalId: rental.id,
    rentalReservationId: rental.rental_reservation_id,
    severity,
    estimatedAmountCents: estimated,
    withheldAmountCents: withheld,
  });
  return decorateDamage(await db.prepare("SELECT * FROM damage_cases WHERE id=?").bind(id).first());
}

async function updateDamage(env, id, body, reqId) {
  const db = env.DB;
  const row = await db.prepare("SELECT * FROM damage_cases WHERE id=?").bind(id).first();
  if (!row) throw new CasesAdminError("DAMAGE_CASE_NOT_FOUND", 404);

  const next = Object.prototype.hasOwnProperty.call(body, "status") ? safeText(body.status, 20).toUpperCase() : row.status;
  if (!DAMAGE_STATUSES.includes(next)) throw new CasesAdminError("INVALID_DAMAGE_STATUS", 400);
  if (next !== row.status && !damageNextStatuses(row.status).includes(next)) throw new CasesAdminError("INVALID_DAMAGE_STATUS_TRANSITION", 409);

  const severity = Object.prototype.hasOwnProperty.call(body, "severity") ? safeText(body.severity, 20).toUpperCase() : row.severity;
  if (!DAMAGE_SEVERITIES.includes(severity)) throw new CasesAdminError("INVALID_DAMAGE_SEVERITY", 400);
  const description = Object.prototype.hasOwnProperty.call(body, "description") ? safeText(body.description, 4000) : row.description;
  if (!description) throw new CasesAdminError("INVALID_DAMAGE_CASE", 400);

  const estimated = Object.prototype.hasOwnProperty.call(body, "estimatedAmountCents")
    ? normalizeNonNegativeCents(body.estimatedAmountCents, true) : row.estimated_amount_cents;
  const withheld = Object.prototype.hasOwnProperty.call(body, "withheldAmountCents")
    ? normalizeNonNegativeCents(body.withheldAmountCents, true) : row.withheld_amount_cents;
  if (estimated === undefined || withheld === undefined) throw new CasesAdminError("INVALID_DAMAGE_AMOUNT", 400);

  const now = new Date().toISOString();
  const resolvedAt = ["RESOLVED", "WAIVED"].includes(next) ? (row.resolved_at || now) : null;
  await db.prepare(`UPDATE damage_cases
    SET status=?,severity=?,description=?,estimated_amount_cents=?,withheld_amount_cents=?,updated_at=?,resolved_at=? WHERE id=?`)
    .bind(next, severity, description, estimated, withheld, now, resolvedAt, id).run();
  await audit(env, "damage_case", id, "DAMAGE_CASE_UPDATED", reqId, {
    from: row.status,
    to: next,
    severity,
    estimatedAmountCents: estimated,
    withheldAmountCents: withheld,
  });
  return decorateDamage(await db.prepare("SELECT * FROM damage_cases WHERE id=?").bind(id).first());
}

async function createTask(env, body, reqId) {
  const db = env.DB;
  const entityType = safeText(body.entityType, 30).toUpperCase();
  const entityId = safeText(body.entityId, 160);
  const title = safeText(body.title, 240);
  const text = safeText(body.body, 4000) || null;
  const priority = safeText(body.priority || "NORMAL", 20).toUpperCase();
  const dueAt = nullableIso(body.dueAt);
  if (!TASK_ENTITY_TYPES.includes(entityType) || !entityId || !title || !TASK_PRIORITIES.includes(priority)) {
    throw new CasesAdminError("INVALID_OPERATIONS_TASK", 400);
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.prepare(`INSERT INTO operations_tasks
    (id,entity_type,entity_id,title,body,priority,status,due_at,created_at,updated_at)
    VALUES (?,?,?,?,?,?,'OPEN',?,?,?)`).bind(id, entityType, entityId, title, text, priority, dueAt, now, now).run();
  await audit(env, "operations_task", id, "OPERATIONS_TASK_CREATED", reqId, { entityType, entityId, priority, dueAt });
  return db.prepare("SELECT * FROM operations_tasks WHERE id=?").bind(id).first();
}

async function updateTask(env, id, body, reqId) {
  const db = env.DB;
  const row = await db.prepare("SELECT * FROM operations_tasks WHERE id=?").bind(id).first();
  if (!row) throw new CasesAdminError("OPERATIONS_TASK_NOT_FOUND", 404);

  const status = Object.prototype.hasOwnProperty.call(body, "status") ? safeText(body.status, 20).toUpperCase() : row.status;
  const priority = Object.prototype.hasOwnProperty.call(body, "priority") ? safeText(body.priority, 20).toUpperCase() : row.priority;
  const title = Object.prototype.hasOwnProperty.call(body, "title") ? safeText(body.title, 240) : row.title;
  const text = Object.prototype.hasOwnProperty.call(body, "body") ? (safeText(body.body, 4000) || null) : row.body;
  const dueAt = Object.prototype.hasOwnProperty.call(body, "dueAt") ? nullableIso(body.dueAt) : row.due_at;
  if (!TASK_STATUSES.includes(status) || !TASK_PRIORITIES.includes(priority) || !title) {
    throw new CasesAdminError("INVALID_OPERATIONS_TASK", 400);
  }

  const now = new Date().toISOString();
  const completedAt = status === "OPEN" ? null : (row.completed_at || now);
  await db.prepare(`UPDATE operations_tasks
    SET title=?,body=?,priority=?,status=?,due_at=?,updated_at=?,completed_at=? WHERE id=?`)
    .bind(title, text, priority, status, dueAt, now, completedAt, id).run();
  await audit(env, "operations_task", id, "OPERATIONS_TASK_UPDATED", reqId, { from: row.status, to: status, priority, dueAt });
  return db.prepare("SELECT * FROM operations_tasks WHERE id=?").bind(id).first();
}

export async function handleAdminCases(request, env, url, reqId, origin = null) {
  try {
    if (request.method === "OPTIONS") {
      if (origin && !ADMIN_ORIGINS.includes(origin)) return new Response(null, { status: 403, headers: securityHeaders() });
      return new Response(null, { status: 204, headers: { ...securityHeaders(), ...corsHeaders(origin) } });
    }
    if (origin && !ADMIN_ORIGINS.includes(origin)) throw new CasesAdminError("ORIGIN_NOT_ALLOWED", 403);
    await requireAdmin(request, env);
    const path = url.pathname;

    if (path === "/admin/cases" && request.method === "GET") return json(await getCases(env, url), 200, origin);
    if (path === "/admin/returns" && request.method === "POST") return json(await createReturn(env, await readJson(request), reqId), 201, origin);
    if (path === "/admin/damages" && request.method === "POST") return json(await createDamage(env, await readJson(request), reqId), 201, origin);
    if (path === "/admin/tasks" && request.method === "POST") return json(await createTask(env, await readJson(request), reqId), 201, origin);

    const returnMatch = /^\/admin\/returns\/([^/]+)$/.exec(path);
    if (returnMatch && request.method === "PATCH") {
      return json(await updateReturn(env, decodeURIComponent(returnMatch[1]), await readJson(request), reqId), 200, origin);
    }
    const damageMatch = /^\/admin\/damages\/([^/]+)$/.exec(path);
    if (damageMatch && request.method === "PATCH") {
      return json(await updateDamage(env, decodeURIComponent(damageMatch[1]), await readJson(request), reqId), 200, origin);
    }
    const taskMatch = /^\/admin\/tasks\/([^/]+)$/.exec(path);
    if (taskMatch && request.method === "PATCH") {
      return json(await updateTask(env, decodeURIComponent(taskMatch[1]), await readJson(request), reqId), 200, origin);
    }
    throw new CasesAdminError("NOT_FOUND", 404);
  } catch (err) {
    if (err instanceof CasesAdminError) return json({ error: err.code, requestId: reqId }, err.status, origin);
    console.error(JSON.stringify({
      level: "error",
      event: "admin_cases_error",
      requestId: reqId,
      message: safeText(err?.message || "unknown", 180),
    }));
    return json({ error: "INTERNAL_ADMIN_CASES_ERROR", requestId: reqId }, 500, origin);
  }
}

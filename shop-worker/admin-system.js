import { safeText } from "./commerce-core.js";
import { OPERATIONS_AUTOMATION_SCHEMA_COLUMNS, OPERATIONS_AUTOMATION_VERSION } from "./operations-monitor.js";

export const SYSTEM_SCHEMA_TARGET = "0007_operations_automation";

const ADMIN_ORIGINS = Object.freeze([
  "https://admin.disorder119.com",
  "http://localhost:8765",
  "http://127.0.0.1:8765",
]);

const REQUIRED_TABLES = Object.freeze([
  "orders",
  "rental_requests",
  "customers",
  "customer_addresses",
  "inventory",
  "reservations",
  "commerce_orders",
  "order_items",
  "payments",
  "payment_events",
  "shipments",
  "rental_reservations",
  "rental_days",
  "rentals",
  "returns",
  "refunds",
  "audit_events",
  "idempotency_keys",
  "account_privacy_requests",
  "order_contact_snapshots",
  "admin_notes",
  "rental_groups",
  "damage_cases",
  "operations_tasks",
]);

class AdminSystemError extends Error {
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
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...securityHeaders(),
      ...corsHeaders(origin),
    },
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
  if (!env.ADMIN_TOKEN) throw new AdminSystemError("ADMIN_NOT_CONFIGURED", 503);
  const supplied = String(request.headers.get("Authorization") || "")
    .replace(/^Bearer\s+/i, "")
    .trim();
  if (!(await tokenEquals(supplied, env.ADMIN_TOKEN))) throw new AdminSystemError("UNAUTHORIZED", 401);
  if (!env.DB) throw new AdminSystemError("COMMERCE_DATABASE_NOT_CONFIGURED", 503);
}

export function detectSchemaVersion(tableNames, operationsTaskColumns = []) {
  const names = new Set(Array.from(tableNames || [], String));
  const taskColumns = new Set(Array.from(operationsTaskColumns || [], String));
  const hasOperationsCases = names.has("damage_cases") && names.has("operations_tasks") && names.has("rental_groups");
  const hasAutomation = OPERATIONS_AUTOMATION_SCHEMA_COLUMNS.every(name => taskColumns.has(name));
  if (hasOperationsCases && hasAutomation) return "0007_operations_automation";
  if (hasOperationsCases) return "0006_operations_cases";
  if (names.has("rental_groups")) return "0005_rental_groups";
  if (names.has("admin_notes") && names.has("order_contact_snapshots")) return "0004_admin_operations";
  if (names.has("payment_events") && names.has("audit_events")) return "0003_state_integrity";
  if (names.has("commerce_orders") && names.has("rental_reservations")) return "0002_commerce_foundation";
  return "schema_base_or_unknown";
}

function configured(env) {
  return {
    database: Boolean(env.DB),
    adminToken: Boolean(env.ADMIN_TOKEN),
    githubCatalogWrite: Boolean(env.GITHUB_TOKEN),
    paypal: Boolean(env.PAYPAL_CLIENT_ID && env.PAYPAL_CLIENT_SECRET),
    paypalWebhook: Boolean(env.PAYPAL_WEBHOOK_ID),
    turnstile: Boolean(env.TURNSTILE_SECRET),
    rateLimiter: Boolean(env.RATE_LIMITER),
  };
}

async function getSystem(env) {
  const tablesResult = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  ).all();
  const tables = (tablesResult.results || []).map(row => String(row.name));
  const present = new Set(tables);
  const taskInfo = present.has("operations_tasks")
    ? await env.DB.prepare("PRAGMA table_info(operations_tasks)").all()
    : { results: [] };
  const operationsTaskColumns = (taskInfo.results || []).map(row => String(row.name));
  const taskColumnSet = new Set(operationsTaskColumns);

  const specs = [
    ["legacyOrders", "orders", "SELECT COUNT(*) AS value FROM orders"],
    ["legacyRentalRequests", "rental_requests", "SELECT COUNT(*) AS value FROM rental_requests"],
    ["customers", "customers", "SELECT COUNT(*) AS value FROM customers WHERE status<>'DELETED'"],
    ["orders", "commerce_orders", "SELECT COUNT(*) AS value FROM commerce_orders"],
    ["rentals", "rental_reservations", "SELECT COUNT(*) AS value FROM rental_reservations"],
    ["durableRentals", "rentals", "SELECT COUNT(*) AS value FROM rentals"],
    ["rentalGroups", "rental_groups", "SELECT COUNT(*) AS value FROM rental_groups"],
    ["inventory", "inventory", "SELECT COUNT(*) AS value FROM inventory"],
    ["payments", "payments", "SELECT COUNT(*) AS value FROM payments"],
    ["shipments", "shipments", "SELECT COUNT(*) AS value FROM shipments"],
    ["returns", "returns", "SELECT COUNT(*) AS value FROM returns"],
    ["openReturns", "returns", "SELECT COUNT(*) AS value FROM returns WHERE status NOT IN ('CLOSED','REJECTED')"],
    ["refunds", "refunds", "SELECT COUNT(*) AS value FROM refunds"],
    ["refundAttention", "refunds", "SELECT COUNT(*) AS value FROM refunds WHERE status IN ('PENDING','FAILED')"],
    ["damageCases", "damage_cases", "SELECT COUNT(*) AS value FROM damage_cases"],
    ["openDamageCases", "damage_cases", "SELECT COUNT(*) AS value FROM damage_cases WHERE status IN ('OPEN','REVIEW')"],
    ["operationsTasks", "operations_tasks", "SELECT COUNT(*) AS value FROM operations_tasks"],
    ["openOperationsTasks", "operations_tasks", "SELECT COUNT(*) AS value FROM operations_tasks WHERE status='OPEN'"],
    ["overdueOperationsTasks", "operations_tasks", "SELECT COUNT(*) AS value FROM operations_tasks WHERE status='OPEN' AND due_at IS NOT NULL AND julianday(due_at)<julianday('now')"],
    ["autoOperationsTasks", "operations_tasks", "SELECT COUNT(*) AS value FROM operations_tasks WHERE auto_managed=1", "auto_managed"],
    ["openAutoOperationsTasks", "operations_tasks", "SELECT COUNT(*) AS value FROM operations_tasks WHERE auto_managed=1 AND status='OPEN'", "auto_managed"],
    ["dismissedAutoOperationsTasks", "operations_tasks", "SELECT COUNT(*) AS value FROM operations_tasks WHERE auto_managed=1 AND status='DISMISSED'", "auto_managed"],
    ["auditEvents", "audit_events", "SELECT COUNT(*) AS value FROM audit_events"],
    ["unprocessedPaymentEvents", "payment_events", "SELECT COUNT(*) AS value FROM payment_events WHERE processed_at IS NULL"],
    ["expiredIdempotencyKeys", "idempotency_keys", "SELECT COUNT(*) AS value FROM idempotency_keys WHERE expires_at IS NOT NULL AND julianday(expires_at)<=julianday('now')"],
  ];

  const runnable = specs.filter(([, table, , requiredColumn]) => present.has(table) && (!requiredColumn || taskColumnSet.has(requiredColumn)));
  const results = runnable.length
    ? await env.DB.batch(runnable.map(([, , sql]) => env.DB.prepare(sql)))
    : [];
  const counts = Object.fromEntries(specs.map(([key]) => [key, 0]));
  runnable.forEach(([key], index) => {
    counts[key] = Number(results[index]?.results?.[0]?.value || 0);
  });

  const missingRequiredTables = REQUIRED_TABLES.filter(name => !present.has(name));
  const missingRequiredColumns = present.has("operations_tasks")
    ? OPERATIONS_AUTOMATION_SCHEMA_COLUMNS.filter(name => !taskColumnSet.has(name)).map(name => `operations_tasks.${name}`)
    : [];
  return {
    generatedAt: new Date().toISOString(),
    schemaTarget: SYSTEM_SCHEMA_TARGET,
    schemaDetected: detectSchemaVersion(tables, operationsTaskColumns),
    schemaReady: missingRequiredTables.length === 0 && missingRequiredColumns.length === 0,
    missingRequiredTables,
    missingRequiredColumns,
    configured: configured(env),
    operationsAutomation: {
      version: OPERATIONS_AUTOMATION_VERSION,
      schemaReady: missingRequiredColumns.length === 0 && present.has("operations_tasks"),
      schedulerConfigured: null,
      schedulerNote: "Scheduled handler is implemented, but cron configuration cannot be inferred from Worker runtime bindings.",
    },
    tables,
    counts,
  };
}

export async function handleAdminSystem(request, env, url, reqId, origin = null) {
  try {
    if (request.method === "OPTIONS") {
      if (origin && !ADMIN_ORIGINS.includes(origin)) {
        return new Response(null, { status: 403, headers: securityHeaders() });
      }
      return new Response(null, {
        status: 204,
        headers: { ...securityHeaders(), ...corsHeaders(origin) },
      });
    }
    if (origin && !ADMIN_ORIGINS.includes(origin)) throw new AdminSystemError("ORIGIN_NOT_ALLOWED", 403);
    await requireAdmin(request, env);
    if (url.pathname !== "/admin/system") throw new AdminSystemError("NOT_FOUND", 404);
    if (request.method !== "GET") throw new AdminSystemError("METHOD_NOT_ALLOWED", 405);
    return json(await getSystem(env), 200, origin);
  } catch (err) {
    if (err instanceof AdminSystemError) {
      return json({ error: err.code, requestId: reqId }, err.status, origin);
    }
    console.error(JSON.stringify({
      level: "error",
      event: "admin_system_error",
      requestId: reqId,
      message: safeText(err?.message || "unknown", 180),
    }));
    return json({ error: "INTERNAL_ADMIN_SYSTEM_ERROR", requestId: reqId }, 500, origin);
  }
}

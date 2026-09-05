import { safeText } from "./commerce-core.js";
import { syncOperationsAlerts } from "./operations-monitor.js";

const ADMIN_ORIGINS = Object.freeze([
  "https://admin.disorder119.com",
  "http://localhost:8765",
  "http://127.0.0.1:8765",
]);

class AdminAlertsError extends Error {
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
    "Access-Control-Allow-Methods": "POST, OPTIONS",
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
  if (!env.ADMIN_TOKEN) throw new AdminAlertsError("ADMIN_NOT_CONFIGURED", 503);
  const supplied = String(request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!(await tokenEquals(supplied, env.ADMIN_TOKEN))) throw new AdminAlertsError("UNAUTHORIZED", 401);
  if (!env.DB) throw new AdminAlertsError("COMMERCE_DATABASE_NOT_CONFIGURED", 503);
}

export async function handleAdminAlerts(request, env, url, reqId, origin = null) {
  try {
    if (request.method === "OPTIONS") {
      if (origin && !ADMIN_ORIGINS.includes(origin)) return new Response(null, { status: 403, headers: securityHeaders() });
      return new Response(null, { status: 204, headers: { ...securityHeaders(), ...corsHeaders(origin) } });
    }
    if (origin && !ADMIN_ORIGINS.includes(origin)) throw new AdminAlertsError("ORIGIN_NOT_ALLOWED", 403);
    await requireAdmin(request, env);
    if (url.pathname !== "/admin/alerts/sync") throw new AdminAlertsError("NOT_FOUND", 404);
    if (request.method !== "POST") throw new AdminAlertsError("METHOD_NOT_ALLOWED", 405);
    const result = await syncOperationsAlerts(env, { requestId: reqId, source: "ADMIN" });
    return json(result, result.ready ? 200 : 409, origin);
  } catch (err) {
    if (err instanceof AdminAlertsError) return json({ error: err.code, requestId: reqId }, err.status, origin);
    console.error(JSON.stringify({
      level: "error",
      event: "admin_alerts_error",
      requestId: reqId,
      message: safeText(err?.message || "unknown", 180),
    }));
    return json({ error: "INTERNAL_ADMIN_ALERTS_ERROR", requestId: reqId }, 500, origin);
  }
}

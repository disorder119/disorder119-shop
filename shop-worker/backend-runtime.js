import { MAX_RENTAL_DAYS, MAX_REQUEST_BYTES } from "./commerce-core.js";

export const BACKEND_HARDENING_VERSION = "backend-runtime-v2";
export const ADMIN_ROLE_READER = "READER";
export const ADMIN_ROLE_OWNER = "OWNER";

const PUBLIC_ORIGINS = Object.freeze([
  "https://disorder119.com",
  "https://www.disorder119.com",
  "https://admin.disorder119.com",
  "http://localhost:8765",
  "http://127.0.0.1:8765",
]);

const EXACT_METHODS = Object.freeze({
  "/health": "GET",
  "/rental-quote": "POST",
  "/rental-request": "POST",
  "/rental-bundle": "POST",
  "/create-order": "POST",
  "/capture-order": "POST",
  "/paypal-webhook": "POST",
  "/rental-requests": "GET",
});

const HUMAN_LIVE_WRITES = new Set([
  "/rental-request",
  "/rental-bundle",
  "/create-order",
]);

const COMMERCE_LIVE_WRITES = new Set([
  "/create-order",
  "/capture-order",
  "/paypal-webhook",
]);

const LIVE_DB_WRITES = new Set([
  "/rental-request",
  "/rental-bundle",
  "/create-order",
  "/capture-order",
  "/paypal-webhook",
]);

const ADMIN_READ_METHODS = new Set(["GET", "HEAD"]);
const ADMIN_WRITE_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);

export class RuntimeGuardError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

function isLive(env) {
  return String(env?.PAYPAL_ENVIRONMENT || "sandbox").toLowerCase() === "live";
}

function allowedOrigin(origin) {
  return Boolean(origin && PUBLIC_ORIGINS.includes(origin));
}

function bearerToken(request) {
  const auth = String(request.headers.get("Authorization") || "");
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

async function digest(value) {
  const bytes = new TextEncoder().encode(String(value || ""));
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
}

export async function timingSafeEqualText(left, right) {
  if (!left || !right) return false;
  const [a, b] = await Promise.all([digest(left), digest(right)]);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export function adminRequiredRoleForMethod(method) {
  const normalized = String(method || "").toUpperCase();
  if (normalized === "OPTIONS") return null;
  if (ADMIN_READ_METHODS.has(normalized)) return ADMIN_ROLE_READER;
  if (ADMIN_WRITE_METHODS.has(normalized)) return ADMIN_ROLE_OWNER;
  throw new RuntimeGuardError("METHOD_NOT_ALLOWED", 405);
}

export function adminAuthReadiness(env = {}) {
  const readToken = Boolean(env.ADMIN_READ_TOKEN);
  const writeToken = Boolean(env.ADMIN_WRITE_TOKEN);
  const legacyToken = Boolean(env.ADMIN_TOKEN);
  const splitConfigured = readToken || writeToken;
  return {
    readConfigured: readToken,
    writeConfigured: writeToken,
    legacyConfigured: legacyToken,
    splitConfigured,
    readReady: readToken || writeToken || (!splitConfigured && legacyToken),
    writeReady: writeToken || (!isLive(env) && !splitConfigured && legacyToken),
    productionRbacReady: !isLive(env) || (readToken && writeToken),
  };
}

export async function authorizeAdminRequest(request, env, requiredRole = adminRequiredRoleForMethod(request.method)) {
  if (!requiredRole) return { role: null, mode: "PREFLIGHT", token: "" };
  const supplied = bearerToken(request);
  if (!supplied) throw new RuntimeGuardError("UNAUTHORIZED", 401);

  const readiness = adminAuthReadiness(env);
  if (!readiness.readReady) throw new RuntimeGuardError("ADMIN_NOT_CONFIGURED", 503);

  if (readiness.splitConfigured) {
    if (readiness.writeConfigured && await timingSafeEqualText(supplied, env.ADMIN_WRITE_TOKEN)) {
      return { role: ADMIN_ROLE_OWNER, mode: "SPLIT_WRITE", token: supplied, readiness };
    }
    if (requiredRole === ADMIN_ROLE_READER && readiness.readConfigured && await timingSafeEqualText(supplied, env.ADMIN_READ_TOKEN)) {
      return { role: ADMIN_ROLE_READER, mode: "SPLIT_READ", token: supplied, readiness };
    }
    if (requiredRole === ADMIN_ROLE_OWNER && !readiness.writeConfigured) {
      throw new RuntimeGuardError("ADMIN_RBAC_NOT_READY", 503);
    }
    throw new RuntimeGuardError(requiredRole === ADMIN_ROLE_OWNER ? "FORBIDDEN" : "UNAUTHORIZED", requiredRole === ADMIN_ROLE_OWNER ? 403 : 401);
  }

  if (!readiness.legacyConfigured) throw new RuntimeGuardError("ADMIN_NOT_CONFIGURED", 503);
  if (!(await timingSafeEqualText(supplied, env.ADMIN_TOKEN))) throw new RuntimeGuardError("UNAUTHORIZED", 401);
  if (requiredRole === ADMIN_ROLE_OWNER && isLive(env)) {
    throw new RuntimeGuardError("ADMIN_RBAC_NOT_READY", 503);
  }
  return { role: ADMIN_ROLE_OWNER, mode: "LEGACY", token: supplied, readiness };
}

export function scopeAdminEnv(env, auth) {
  const scoped = Object.create(env || null);
  Object.defineProperties(scoped, {
    ADMIN_TOKEN: { value: auth?.token || "", enumerable: true },
    ADMIN_AUTH_CONTEXT: {
      value: Object.freeze({
        role: auth?.role || null,
        mode: auth?.mode || null,
        readConfigured: Boolean(auth?.readiness?.readConfigured ?? env?.ADMIN_READ_TOKEN),
        writeConfigured: Boolean(auth?.readiness?.writeConfigured ?? env?.ADMIN_WRITE_TOKEN),
        legacyConfigured: Boolean(auth?.readiness?.legacyConfigured ?? env?.ADMIN_TOKEN),
        productionRbacReady: Boolean(auth?.readiness?.productionRbacReady ?? (!isLive(env) || (env?.ADMIN_READ_TOKEN && env?.ADMIN_WRITE_TOKEN))),
      }),
      enumerable: true,
    },
  });
  return scoped;
}

export async function requireLegacyAdmin(request, env) {
  return authorizeAdminRequest(request, env, ADMIN_ROLE_READER);
}

function hasPaypalCore(env) {
  return Boolean(env?.PAYPAL_CLIENT_ID && env?.PAYPAL_CLIENT_SECRET);
}

export function productionReadiness(env = {}) {
  const live = isLive(env);
  const database = Boolean(env.DB);
  const rateLimiter = Boolean(env.RATE_LIMITER && typeof env.RATE_LIMITER.limit === "function");
  const turnstile = Boolean(env.TURNSTILE_SECRET);
  const paypal = hasPaypalCore(env);
  const webhook = paypal && Boolean(env.PAYPAL_WEBHOOK_ID);
  const catalogWrite = Boolean(env.GITHUB_TOKEN);
  return {
    environment: live ? "live" : "sandbox",
    live,
    productionGuardsReady: !live || (database && rateLimiter && turnstile),
    rentalWritesReady: !live || (database && rateLimiter && turnstile),
    checkoutReady: database && paypal && catalogWrite && (!live || (rateLimiter && turnstile)),
    webhookReady: database && webhook && catalogWrite,
  };
}

function assertMethod(request, pathname) {
  const expected = EXACT_METHODS[pathname];
  if (expected && request.method !== expected && request.method !== "OPTIONS") {
    throw new RuntimeGuardError("METHOD_NOT_ALLOWED", 405);
  }
  if (pathname.startsWith("/rental-request/") && request.method !== "PATCH" && request.method !== "OPTIONS") {
    throw new RuntimeGuardError("METHOD_NOT_ALLOWED", 405);
  }
}

function assertDeclaredBodySize(request) {
  if (!["POST", "PATCH", "PUT"].includes(request.method)) return;
  const header = request.headers.get("Content-Length");
  if (!header) return;
  const declared = Number(header);
  if (Number.isFinite(declared) && declared > MAX_REQUEST_BYTES) {
    throw new RuntimeGuardError("REQUEST_TOO_LARGE", 413);
  }
}

function assertLiveControls(env, pathname) {
  if (!isLive(env) || !LIVE_DB_WRITES.has(pathname)) return;
  if (!env.DB) throw new RuntimeGuardError("LIVE_BACKEND_NOT_READY", 503);

  if (pathname !== "/paypal-webhook") {
    if (!env.RATE_LIMITER || typeof env.RATE_LIMITER.limit !== "function") {
      throw new RuntimeGuardError("LIVE_BACKEND_NOT_READY", 503);
    }
  }

  if (HUMAN_LIVE_WRITES.has(pathname) && !env.TURNSTILE_SECRET) {
    throw new RuntimeGuardError("LIVE_BACKEND_NOT_READY", 503);
  }

  if (COMMERCE_LIVE_WRITES.has(pathname)) {
    if (!hasPaypalCore(env) || !env.GITHUB_TOKEN) {
      throw new RuntimeGuardError("LIVE_BACKEND_NOT_READY", 503);
    }
    if (pathname === "/paypal-webhook" && !env.PAYPAL_WEBHOOK_ID) {
      throw new RuntimeGuardError("LIVE_BACKEND_NOT_READY", 503);
    }
  }
}

export async function guardRuntimeRequest(request, env, url = new URL(request.url)) {
  const pathname = url.pathname;
  assertMethod(request, pathname);
  assertDeclaredBodySize(request);

  if (pathname === "/rental-requests" && request.method === "GET") {
    await authorizeAdminRequest(request, env, ADMIN_ROLE_READER);
  }
  if (pathname.startsWith("/rental-request/") && request.method === "PATCH") {
    await authorizeAdminRequest(request, env, ADMIN_ROLE_OWNER);
  }

  assertLiveControls(env, pathname);
}

function baseSecurityHeaders(requestId) {
  return {
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "X-Request-Id": requestId,
  };
}

export function runtimeErrorResponse(err, requestId, origin = null) {
  const status = err instanceof RuntimeGuardError ? err.status : 500;
  const code = err instanceof RuntimeGuardError ? err.code : "INTERNAL_RUNTIME_ERROR";
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Vary": "Origin",
    ...baseSecurityHeaders(requestId),
  });
  if (allowedOrigin(origin)) headers.set("Access-Control-Allow-Origin", origin);
  return new Response(JSON.stringify({ error: code, requestId }), { status, headers });
}

async function augmentHealth(response, env) {
  if (!response.ok || !(response.headers.get("Content-Type") || "").includes("application/json")) return response;
  try {
    const data = await response.clone().json();
    return new Response(JSON.stringify({
      ...data,
      backendHardening: {
        version: BACKEND_HARDENING_VERSION,
        maxRequestBytes: MAX_REQUEST_BYTES,
        maxRentalDays: MAX_RENTAL_DAYS,
        ...productionReadiness(env),
      },
    }), {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  } catch {
    return response;
  }
}

export async function finalizeRuntimeResponse(response, request, env, requestId, pathname) {
  let out = response;
  if (pathname === "/health") out = await augmentHealth(out, env);
  const headers = new Headers(out.headers);
  headers.set("X-Request-Id", requestId);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("Cache-Control", "no-store");
  if (new URL(request.url).protocol === "https:") {
    headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  return new Response(out.body, {
    status: out.status,
    statusText: out.statusText,
    headers,
  });
}

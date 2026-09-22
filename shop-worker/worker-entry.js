import shopWorker from "./worker.js";
import {
  handleAdminRequest,
  enrichRentalReservation,
  snapshotPaypalOrder,
} from "./admin-api.js";
import { handleAdminInsights } from "./admin-insights.js";
import { handleAdminCommerceMetrics } from "./admin-commerce-metrics.js";
import { handleAdminRentalGroups } from "./admin-rental-groups.js";
import { handleAdminCases } from "./admin-cases.js";
import { handleAdminSystem } from "./admin-system.js";
import { handleAdminAlerts } from "./admin-alerts.js";
import { handleAdminNotifications } from "./admin-notifications.js";
import { syncOperationsAlerts } from "./operations-monitor.js";
import { handleRentalBundle } from "./rental-bundle.js";
import { notifyPaidOrder, notifyPaidOrderByProviderOrder } from "./notifications.js";
import {
  applyCouponToCreatedOrder,
  couponContextFromCreateRequest,
  finalizeCouponForOrder,
  handleGameRewards,
} from "./game-rewards.js";
import {
  ADMIN_ROLE_OWNER,
  ADMIN_ROLE_READER,
  RuntimeGuardError,
  adminRequiredRoleForMethod,
  authorizeAdminRequest,
  finalizeRuntimeResponse,
  guardRuntimeRequest,
  runtimeErrorResponse,
  scopeAdminEnv,
} from "./backend-runtime.js";

const ADMIN_REQUEST_ORIGINS = new Set([
  "https://admin.disorder119.com",
  "http://localhost:8765",
  "http://127.0.0.1:8765",
]);

function requestId(request) {
  const existing = request.headers.get("cf-ray");
  return existing ? `cf-${existing}` : crypto.randomUUID();
}

function logBackgroundFailure(event, reqId, err) {
  console.error(JSON.stringify({
    level: "error",
    event,
    requestId: reqId,
    message: String(err?.message || err || "unknown").slice(0, 180),
  }));
}

function logAdminSecurity(level, event, reqId, request, url, details = {}) {
  const payload = {
    level,
    event,
    requestId: reqId,
    method: request.method,
    path: url.pathname,
    ...details,
  };
  if (level === "error") console.error(JSON.stringify(payload));
  else if (level === "warn") console.warn(JSON.stringify(payload));
  else console.log(JSON.stringify(payload));
}

function isAdminRoute(url) {
  return url.pathname === "/admin" || url.pathname.startsWith("/admin/");
}

function isLegacyAdminRoute(pathname) {
  return pathname === "/rental-requests" || pathname.startsWith("/rental-request/");
}

function isGameRewardRoute(pathname) {
  return pathname.startsWith("/game/") || pathname === "/coupon/validate";
}

function assertAdminOrigin(request) {
  const origin = request.headers.get("Origin");
  if (!origin) return;
  if (!ADMIN_REQUEST_ORIGINS.has(origin)) {
    throw new RuntimeGuardError("ADMIN_ORIGIN_FORBIDDEN", 403);
  }
}

async function authorizeRouteEnv(request, env, url, reqId) {
  const adminRoute = isAdminRoute(url);
  const legacyAdminRoute = isLegacyAdminRoute(url.pathname);
  if (!adminRoute && !legacyAdminRoute) return env;

  assertAdminOrigin(request);
  if (request.method === "OPTIONS" && adminRoute) return env;

  let requiredRole;
  if (legacyAdminRoute) {
    requiredRole = request.method === "GET" ? ADMIN_ROLE_READER : ADMIN_ROLE_OWNER;
  } else {
    requiredRole = adminRequiredRoleForMethod(request.method);
  }

  try {
    const auth = await authorizeAdminRequest(request, env, requiredRole);
    if (requiredRole === ADMIN_ROLE_OWNER) {
      logAdminSecurity("info", "admin_write_authorized", reqId, request, url, {
        role: auth.role,
        authMode: auth.mode,
      });
    }
    return scopeAdminEnv(env, auth);
  } catch (err) {
    logAdminSecurity("warn", "admin_access_denied", reqId, request, url, {
      requiredRole,
      code: err instanceof RuntimeGuardError ? err.code : "AUTH_ERROR",
    });
    throw err;
  }
}

async function runBackground(ctx, task, event, reqId) {
  const guarded = Promise.resolve(task).catch(err => logBackgroundFailure(event, reqId, err));
  if (ctx && typeof ctx.waitUntil === "function") {
    ctx.waitUntil(guarded);
    return;
  }
  await guarded;
}

function publicCouponError(err) {
  if (err instanceof RuntimeGuardError) return err;
  if (err?.publicCode) return new RuntimeGuardError(String(err.publicCode), Number(err.status) || 400);
  return new RuntimeGuardError("COUPON_APPLY_FAILED", 502);
}

function replaceJsonResponse(response, payload) {
  const headers = new Headers(response.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.delete("Content-Length");
  return new Response(JSON.stringify(payload), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");
    const reqId = requestId(request);
    const finish = response => finalizeRuntimeResponse(response, request, env, reqId, url.pathname);

    try {
      const runtimeEnv = await authorizeRouteEnv(request, env, url, reqId);
      await guardRuntimeRequest(request, runtimeEnv, url);

      if (isGameRewardRoute(url.pathname)) {
        return finish(await handleGameRewards(request, runtimeEnv, url, reqId, origin));
      }

      if (url.pathname === "/rental-bundle") {
        return finish(await handleRentalBundle(request, runtimeEnv, url, reqId, origin));
      }

      if (url.pathname === "/admin/insights") {
        return finish(await handleAdminInsights(request, runtimeEnv, url, reqId, origin));
      }

      if (url.pathname === "/admin/commerce-metrics") {
        return finish(await handleAdminCommerceMetrics(request, runtimeEnv, url, reqId, origin));
      }

      if (url.pathname === "/admin/system") {
        return finish(await handleAdminSystem(request, runtimeEnv, url, reqId, origin));
      }

      if (url.pathname === "/admin/alerts/sync") {
        return finish(await handleAdminAlerts(request, runtimeEnv, url, reqId, origin));
      }

      if (url.pathname === "/admin/notifications/telegram/test") {
        return finish(await handleAdminNotifications(request, runtimeEnv, url, reqId, origin));
      }

      if (url.pathname === "/admin/rental-groups" || url.pathname.startsWith("/admin/rental-groups/")) {
        return finish(await handleAdminRentalGroups(request, runtimeEnv, url, reqId, origin));
      }

      if (
        url.pathname === "/admin/cases" ||
        url.pathname === "/admin/returns" || url.pathname.startsWith("/admin/returns/") ||
        url.pathname === "/admin/damages" || url.pathname.startsWith("/admin/damages/") ||
        url.pathname === "/admin/tasks" || url.pathname.startsWith("/admin/tasks/")
      ) {
        return finish(await handleAdminCases(request, runtimeEnv, url, reqId, origin));
      }

      if (isAdminRoute(url)) {
        return finish(await handleAdminRequest(request, runtimeEnv, url, reqId, origin));
      }

      const shouldInspectRental = url.pathname === "/rental-request" && request.method === "POST";
      const shouldInspectCreate = url.pathname === "/create-order" && request.method === "POST";
      const shouldInspectCapture = url.pathname === "/capture-order" && request.method === "POST";
      const shouldInspectWebhook = url.pathname === "/paypal-webhook" && request.method === "POST";
      const requestCopy = (shouldInspectRental || shouldInspectCreate || shouldInspectCapture || shouldInspectWebhook) ? request.clone() : null;

      let couponContext = null;
      if (shouldInspectCreate && requestCopy && runtimeEnv.DB) {
        try {
          couponContext = await couponContextFromCreateRequest(requestCopy.clone(), runtimeEnv);
        } catch (err) {
          throw publicCouponError(err);
        }
      }

      let response = await shopWorker.fetch(request, runtimeEnv, ctx);

      if (response.ok && shouldInspectCreate && couponContext && runtimeEnv.DB) {
        let result;
        try {
          result = await response.clone().json();
          const coupon = await applyCouponToCreatedOrder(runtimeEnv, couponContext, result, reqId);
          response = replaceJsonResponse(response, { ...result, coupon });
        } catch (err) {
          throw publicCouponError(err);
        }
      }

      if (!response.ok || !requestCopy || !runtimeEnv.DB) return finish(response);

      if (shouldInspectRental) {
        try {
          const [payload, result] = await Promise.all([
            requestCopy.json(),
            response.clone().json(),
          ]);
          if (result?.rentalReservationId) {
            await enrichRentalReservation(runtimeEnv, result.rentalReservationId, payload, reqId);
          }
        } catch (err) {
          logBackgroundFailure("rental_metadata_snapshot_failed", reqId, err);
        }
      }

      if (shouldInspectCapture) {
        try {
          const [payload, result] = await Promise.all([
            requestCopy.json(),
            response.clone().json(),
          ]);
          if (payload?.orderId) {
            await runBackground(ctx, snapshotPaypalOrder(runtimeEnv, String(payload.orderId), reqId), "checkout_snapshot_failed", reqId);
          }
          if (result?.orderId) {
            await runBackground(ctx, finalizeCouponForOrder(runtimeEnv, String(result.orderId), reqId), "coupon_finalize_failed", reqId);
            await runBackground(ctx, notifyPaidOrder(runtimeEnv, String(result.orderId), reqId), "sale_notification_failed", reqId);
          }
        } catch (err) {
          logBackgroundFailure("capture_observer_failed", reqId, err);
        }
      }

      if (shouldInspectWebhook) {
        try {
          const event = await requestCopy.json();
          if (event?.event_type === "PAYMENT.CAPTURE.COMPLETED") {
            const providerOrderId = event?.resource?.supplementary_data?.related_ids?.order_id;
            if (providerOrderId) {
              await runBackground(ctx, snapshotPaypalOrder(runtimeEnv, String(providerOrderId), reqId), "webhook_checkout_snapshot_failed", reqId);
              await runBackground(ctx, notifyPaidOrderByProviderOrder(runtimeEnv, String(providerOrderId), reqId), "webhook_sale_notification_failed", reqId);
            }
          }
        } catch (err) {
          logBackgroundFailure("webhook_observer_failed", reqId, err);
        }
      }

      return finish(response);
    } catch (err) {
      if (!(err instanceof RuntimeGuardError)) {
        logBackgroundFailure("worker_entry_unhandled", reqId, err);
      }
      return finish(runtimeErrorResponse(err, reqId, origin));
    }
  },

  async scheduled(event, env, ctx) {
    const scheduledTime = Number(event?.scheduledTime || Date.now());
    const reqId = `cron-${scheduledTime}`;
    await runBackground(
      ctx,
      syncOperationsAlerts(env, {
        now: new Date(scheduledTime).toISOString(),
        requestId: reqId,
        source: "CRON",
      }),
      "operations_automation_failed",
      reqId,
    );
  },
};

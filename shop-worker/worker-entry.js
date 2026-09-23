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
import { sendOrderConfirmation, sendOrderConfirmationByProviderOrder } from "./customer-mail.js";
import { handleAccountRequest, isAccountRoute } from "./customer-account.js";
import { handleBuchhaltung, istBuchhaltungsRoute } from "./buchhaltung.js";
import { handleVersand, istVersandRoute } from "./dhl.js";
import { handleGameRewards, isGameRewardsRoute } from "./game-rewards.js";
import {
  CouponCheckoutError,
  applyCouponToCreatedOrder,
  assertCouponUsable,
  couponCodeFromCreateRequest,
  redeemCouponAfterPayment,
} from "./coupon-checkout.js";
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

function couponRuntimeError(error) {
  if (error instanceof RuntimeGuardError) return error;
  if (error instanceof CouponCheckoutError || error?.code) {
    return new RuntimeGuardError(String(error.code || "COUPON_APPLY_FAILED"), Number(error.status) || 409);
  }
  return new RuntimeGuardError("COUPON_APPLY_FAILED", 502);
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

      if (isGameRewardsRoute(url.pathname)) {
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

      // Das Kundenkonto laeuft vor den Shop-Routen, weil worker.js /account/
      // bisher bewusst mit 501 beantwortet hat.
      if (isAccountRoute(url)) {
        return finish(await handleAccountRequest(request, runtimeEnv, url, reqId, origin));
      }

      if (istVersandRoute(url)) {
        return finish(await handleVersand(request, runtimeEnv, url, reqId, origin));
      }

      if (istBuchhaltungsRoute(url)) {
        return finish(await handleBuchhaltung(request, runtimeEnv, url, reqId, origin));
      }

      if (url.pathname === "/admin/notifications/telegram/test" || url.pathname === "/admin/notifications/mail/test") {
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

      let couponCode = "";
      if (shouldInspectCreate && requestCopy) {
        try {
          couponCode = await couponCodeFromCreateRequest(requestCopy.clone());
          if (couponCode) await assertCouponUsable(runtimeEnv, couponCode);
        } catch (error) {
          throw couponRuntimeError(error);
        }
      }

      let response = await shopWorker.fetch(request, runtimeEnv, ctx);

      if (response.ok && shouldInspectCreate && couponCode && runtimeEnv.DB) {
        try {
          const result = await response.clone().json();
          const coupon = await applyCouponToCreatedOrder(runtimeEnv, couponCode, result, reqId);
          response = replaceJsonResponse(response, { ...result, coupon });
        } catch (error) {
          throw couponRuntimeError(error);
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
            // Reihenfolge ist wichtig: die Bestellbestaetigung braucht die
            // Kundenadresse, die erst der PayPal-Abzug in die Datenbank
            // schreibt. Scheitert der Abzug, wird das protokolliert und die
            // Mail meldet sauber NO_CUSTOMER_EMAIL, statt die Kette zu kippen.
            const confirmFor = result?.orderId ? String(result.orderId) : "";
            await runBackground(
              ctx,
              snapshotPaypalOrder(runtimeEnv, String(payload.orderId), reqId)
                .catch(err => logBackgroundFailure("checkout_snapshot_failed", reqId, err))
                .then(() => (confirmFor ? sendOrderConfirmation(runtimeEnv, confirmFor, reqId) : null)),
              "order_confirmation_failed",
              reqId,
            );
          }
          if (result?.orderId) {
            await runBackground(ctx, redeemCouponAfterPayment(runtimeEnv, String(result.orderId), reqId), "coupon_redeem_failed", reqId);
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
              await runBackground(
                ctx,
                snapshotPaypalOrder(runtimeEnv, String(providerOrderId), reqId)
                  .catch(err => logBackgroundFailure("webhook_checkout_snapshot_failed", reqId, err))
                  .then(() => sendOrderConfirmationByProviderOrder(runtimeEnv, String(providerOrderId), reqId)),
                "webhook_order_confirmation_failed",
                reqId,
              );
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

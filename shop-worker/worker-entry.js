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
import { syncOperationsAlerts } from "./operations-monitor.js";
import { handleRentalBundle } from "./rental-bundle.js";

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

async function runBackground(ctx, task, event, reqId) {
  const guarded = Promise.resolve(task).catch(err => logBackgroundFailure(event, reqId, err));
  if (ctx && typeof ctx.waitUntil === "function") {
    ctx.waitUntil(guarded);
    return;
  }
  await guarded;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");
    const reqId = requestId(request);

    if (url.pathname === "/rental-bundle") {
      return handleRentalBundle(request, env, url, reqId, origin);
    }

    if (url.pathname === "/admin/insights") {
      return handleAdminInsights(request, env, url, reqId, origin);
    }

    if (url.pathname === "/admin/commerce-metrics") {
      return handleAdminCommerceMetrics(request, env, url, reqId, origin);
    }

    if (url.pathname === "/admin/system") {
      return handleAdminSystem(request, env, url, reqId, origin);
    }

    if (url.pathname === "/admin/alerts/sync") {
      return handleAdminAlerts(request, env, url, reqId, origin);
    }

    if (url.pathname === "/admin/rental-groups" || url.pathname.startsWith("/admin/rental-groups/")) {
      return handleAdminRentalGroups(request, env, url, reqId, origin);
    }

    if (
      url.pathname === "/admin/cases" ||
      url.pathname === "/admin/returns" || url.pathname.startsWith("/admin/returns/") ||
      url.pathname === "/admin/damages" || url.pathname.startsWith("/admin/damages/") ||
      url.pathname === "/admin/tasks" || url.pathname.startsWith("/admin/tasks/")
    ) {
      return handleAdminCases(request, env, url, reqId, origin);
    }

    if (url.pathname === "/admin" || url.pathname.startsWith("/admin/")) {
      return handleAdminRequest(request, env, url, reqId, origin);
    }

    const shouldInspectRental = url.pathname === "/rental-request" && request.method === "POST";
    const shouldInspectCapture = url.pathname === "/capture-order" && request.method === "POST";
    const shouldInspectWebhook = url.pathname === "/paypal-webhook" && request.method === "POST";
    const requestCopy = (shouldInspectRental || shouldInspectCapture || shouldInspectWebhook) ? request.clone() : null;

    const response = await shopWorker.fetch(request, env, ctx);
    if (!response.ok || !requestCopy || !env.DB) return response;

    if (shouldInspectRental) {
      try {
        const [payload, result] = await Promise.all([
          requestCopy.json(),
          response.clone().json(),
        ]);
        if (result?.rentalReservationId) {
          await enrichRentalReservation(env, result.rentalReservationId, payload, reqId);
        }
      } catch (err) {
        // Metadata enrichment must never turn a valid rental reservation into a
        // failed customer request. Missing migration/config is surfaced in the
        // admin system view and logs instead.
        logBackgroundFailure("rental_metadata_snapshot_failed", reqId, err);
      }
    }

    if (shouldInspectCapture) {
      try {
        const payload = await requestCopy.json();
        if (payload?.orderId) {
          await runBackground(ctx, snapshotPaypalOrder(env, String(payload.orderId), reqId), "checkout_snapshot_failed", reqId);
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
            await runBackground(ctx, snapshotPaypalOrder(env, String(providerOrderId), reqId), "webhook_checkout_snapshot_failed", reqId);
          }
        }
      } catch (err) {
        logBackgroundFailure("webhook_observer_failed", reqId, err);
      }
    }

    return response;
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

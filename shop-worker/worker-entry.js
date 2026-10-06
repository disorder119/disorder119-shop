import { handleAdminPrivacy } from "./admin-privacy.js";
import shopWorker, { reconcilePurchasePayments } from "./worker.js";
import {
  handleAdminRequest,
  enrichRentalReservation,
  snapshotPaypalOrder,
  erstattungAusPaypal,
  paypalErstattungenAbgleichen,
  ruecklaufPflegen,
  widerrufAusKonto,
  widerrufVonWebsite,
  zahlungenPflegen,
} from "./admin-api.js";
import { isWiderrufRoute } from "./widerruf.js";
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
import { sendInvoiceAfterCaptureByProviderOrder, sendOrderConfirmation, sendOrderConfirmationByProviderOrder } from "./customer-mail.js";
import { handleAccountRequest, isAccountRoute, sendRequestedAccountLink, sendRequestedAccountLinkByProviderOrder } from "./customer-account.js";
import { handleBuchhaltung, istBuchhaltungsRoute } from "./buchhaltung.js";
import { handleVersand, istVersandRoute } from "./dhl.js";
import { handleDhlQr, isDhlQrRoute } from "./dhl-qr.js";
import { handlePacklink, handlePacklinkWebhook, isPacklinkRoute, isPacklinkWebhookRoute } from "./packlink.js";
import { handleVersandOptionen, isVersandOptionenRoute } from "./versand.js";
import { handleAdresse, isAdresseRoute } from "./adresse.js";
import { handleKatalog, isKatalogRoute } from "./admin-katalog.js";
import { handleSiteLock, isSiteLockRoute } from "./site-lock.js";
import { handleIncomingEmail, handlePostfach, isPostfachRoute } from "./postfach.js";
import { besucherAufraeumen, handleBesucher, istBesucherRoute } from "./besucher.js";
import { applePayDomainSicherstellen } from "./paypal-einrichtung.js";
import { handleNewsletter, isNewsletterRoute } from "./newsletter.js";
import { handleGameRewards, isGameRewardsRoute } from "./game-rewards.js";
import { handleAdminAuth, isAdminAuthRoute } from "./admin-passkeys.js";
import { handleManagerConnection, isManagerRoute } from "./manager-connection.js";
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
  // detail der eigenen Fehlerklassen (Status, Debug-ID, Grund des Anbieters) -
  // nie Zugangsdaten, nie Kundendaten.
  let detail;
  try { detail = err?.detail ? JSON.stringify(err.detail).slice(0, 300) : undefined; } catch { detail = undefined; }
  console.error(JSON.stringify({
    level: "error",
    event,
    requestId: reqId,
    message: String(err?.message || err || "unknown").slice(0, 180),
    detail,
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
  if (!adminRoute && !legacyAdminRoute) return { env, request };

  assertAdminOrigin(request);
  if (request.method === "OPTIONS" && adminRoute) return { env, request };

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
    let routedRequest = request;
    if (auth.mode === "PASSKEY_SESSION") {
      // Jedes Admin-Modul prueft selbst noch einen Bearer-Token. Eine per
      // Passkey angemeldete Anfrage bekommt dafuer einen Einmal-Schluessel,
      // der nur fuer genau diese Anfrage gilt und den Worker nie verlaesst.
      auth.token = `${crypto.randomUUID()}${crypto.randomUUID()}`;
      const headers = new Headers(request.headers);
      headers.set("Authorization", `Bearer ${auth.token}`);
      routedRequest = new Request(request, { headers });
    }
    return { env: scopeAdminEnv(env, auth), request: routedRequest };
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

// Alles nach einer gesicherten Zahlung (reserviert oder eingezogen): Adresse
// von PayPal, Bestellbestaetigung, Gutschein, Telegram, Konto-Link. Jeder
// Schritt ist fuer sich gegen Doppelungen gesichert - ein zweiter Lauf holt
// nur nach, was fehlt.
//
// Reihenfolge ist wichtig: die Bestellbestaetigung braucht die Kundenadresse,
// die erst der PayPal-Abzug in die Datenbank schreibt. Scheitert der Abzug,
// wird das protokolliert und die Mail meldet sauber NO_CUSTOMER_EMAIL, statt
// die Kette zu kippen.
async function bestellungNachbereiten(env, ctx, orderId, providerOrderId, reqId) {
  await runBackground(
    ctx,
    (providerOrderId ? snapshotPaypalOrder(env, String(providerOrderId), reqId) : Promise.resolve(false))
      .catch(err => logBackgroundFailure("checkout_snapshot_failed", reqId, err))
      .then(() => sendOrderConfirmation(env, String(orderId), reqId)),
    "order_confirmation_failed",
    reqId,
  );
  await runBackground(ctx, redeemCouponAfterPayment(env, String(orderId), reqId), "coupon_redeem_failed", reqId);
  await runBackground(ctx, notifyPaidOrder(env, String(orderId), reqId), "sale_notification_failed", reqId);
  await runBackground(ctx, sendRequestedAccountLink(env, String(orderId), reqId), "account_link_failed", reqId);
}

// Bestellungen, deren Abschluss nicht ueber die Kasse lief (Abbruch nach der
// PayPal-Freigabe, Abgleich, Mail-Aussetzer): Bestaetigung & Co. nachholen.
// Nur die letzten drei Tage und erst zwei Minuten nach der Zahlung, damit der
// Lauf der Kasse selbst Vorrang hat.
async function offeneBestellungenNachbereiten(env, reqId, now) {
  if (!env?.DB) return;
  const rows = (await env.DB.prepare(`SELECT o.id AS order_id,
      (SELECT p.provider_order_id FROM payments p WHERE p.order_id=o.id AND p.provider='PAYPAL'
        AND p.status IN ('AUTHORIZED','COMPLETED') ORDER BY p.created_at DESC LIMIT 1) AS provider_order_id
    FROM commerce_orders o
    WHERE o.status IN ('PAID','PREPARING','SHIPPED','DELIVERED') AND o.created_at>=?
      AND EXISTS (SELECT 1 FROM payments p WHERE p.order_id=o.id AND p.provider='PAYPAL'
        AND p.status IN ('AUTHORIZED','COMPLETED') AND COALESCE(p.authorized_at,p.updated_at,p.created_at)<=?)
      AND NOT EXISTS (SELECT 1 FROM audit_events a WHERE a.id='notify:email:confirmation:' || o.id)
    ORDER BY o.created_at LIMIT 5`)
    .bind(new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString(), new Date(now.getTime() - 2 * 60 * 1000).toISOString())
    .all()).results || [];
  for (const row of rows) {
    await bestellungNachbereiten(env, null, row.order_id, row.provider_order_id, reqId);
  }
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
      // Face-ID-/Windows-Hello-Anmeldung der Admin-App: muss ohne Sitzung
      // erreichbar sein und prueft Herkunft und Berechtigung selbst.
      if (isManagerRoute(url)) {
        return finish(await handleManagerConnection(request, env, url));
      }
      if (isAdminAuthRoute(url)) {
        await guardRuntimeRequest(request, env, url);
        return finish(await handleAdminAuth(request, env, url, reqId));
      }

      const routed = await authorizeRouteEnv(request, env, url, reqId);
      const runtimeEnv = routed.env;
      request = routed.request;
      await guardRuntimeRequest(request, runtimeEnv, url);

      // Versandoptionen fuer Produktseite und Warenkorb: oeffentlich, nur lesen.
      if (isVersandOptionenRoute(url)) {
        return finish(await handleVersandOptionen(request, runtimeEnv, url, reqId, origin));
      }

      // Adressvorschlaege fuer die Kasse (PLZ -> Ort, Strassenanfang -> Strassen).
      if (isAdresseRoute(url)) {
        return finish(await handleAdresse(request, runtimeEnv, url, reqId, origin));
      }

      // Meldungen von Packlink kommen ohne Origin und ohne Anmeldung - der
      // Schluessel steckt im Pfad. Deshalb vor worker.js, das Schreibzugriffe
      // ohne erlaubte Herkunft ablehnt.
      if (isPacklinkWebhookRoute(url)) {
        return finish(await handlePacklinkWebhook(request, runtimeEnv, url, reqId));
      }

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

      if (url.pathname.startsWith("/admin/privacy/")) {
        return finish(await handleAdminPrivacy(request, runtimeEnv, url));
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
        return finish(await handleAccountRequest(request, runtimeEnv, url, reqId, origin, {
          widerrufErfassen: orderId => widerrufAusKonto(runtimeEnv, orderId, reqId),
        }));
      }

      // Widerrufsfunktion nach § 356a BGB ("Vertrag widerrufen" auf der Website).
      if (isWiderrufRoute(url)) {
        return finish(await widerrufVonWebsite(request, runtimeEnv, url, reqId, origin));
      }

      // Katalog-Editor der Admin-App: speichert ueber Pull Requests, ohne
      // GitHub-Token im Browser.
      if (isKatalogRoute(url)) {
        return finish(await handleKatalog(request, runtimeEnv, url, reqId, origin));
      }

      // Shop voruebergehend sperren: /site-status und /site-unlock fragt der
      // Shop ohne Anmeldung, /admin/site-lock schaltet die Admin-App.
      if (isSiteLockRoute(url)) {
        return finish(await handleSiteLock(request, runtimeEnv, url, reqId, origin));
      }

      // Postfach der Admin-App (Mails an kontakt@disorder119.com).
      if (istBesucherRoute(url)) {
        return finish(await handleBesucher(request, runtimeEnv, url, reqId, ctx));
      }

      if (isPostfachRoute(url)) {
        return finish(await handlePostfach(request, runtimeEnv, url, reqId, origin));
      }

      // Newsletter: Anmeldung, Bestaetigung und Abmeldung von der Website,
      // /admin/newsletter fuer die Liste in der Admin-App.
      if (isNewsletterRoute(url)) {
        return finish(await handleNewsletter(request, runtimeEnv, url, reqId, origin));
      }

      // Packlink PRO (DPD, DHL): Angebote, Etikett kaufen, Entwurf, Sendungsnummer.
      if (isPacklinkRoute(url)) {
        return finish(await handlePacklink(request, runtimeEnv, url, reqId, origin));
      }

      // QR-Versandmarke (DHL Online Frankierung) vor dem Geschaeftskunden-Versand:
      // beide liegen unter /admin/versand/.
      if (isDhlQrRoute(url)) {
        return finish(await handleDhlQr(request, runtimeEnv, url, reqId, origin));
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
          if (result?.orderId) {
            await bestellungNachbereiten(runtimeEnv, ctx, String(result.orderId), payload?.orderId ? String(payload.orderId) : null, reqId);
          } else if (payload?.orderId) {
            await runBackground(ctx, snapshotPaypalOrder(runtimeEnv, String(payload.orderId), reqId), "checkout_snapshot_failed", reqId);
          }
        } catch (err) {
          logBackgroundFailure("capture_observer_failed", reqId, err);
        }
      }

      if (shouldInspectWebhook) {
        let event = null;
        try {
          event = await requestCopy.json();
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
              await runBackground(ctx, sendRequestedAccountLinkByProviderOrder(runtimeEnv, String(providerOrderId), reqId), "webhook_account_link_failed", reqId);
              // Eingezogene Reservierung: die Rechnung (hoechstens einmal).
              await runBackground(ctx, sendInvoiceAfterCaptureByProviderOrder(runtimeEnv, String(providerOrderId), reqId), "webhook_invoice_failed", reqId);
            }
          }
          if (event?.event_type === "PAYMENT.CAPTURE.REFUNDED") {
            // Erst dann 2xx an PayPal senden, wenn Refund, Zahlungsstatus und
            // Bestellstatus dauerhaft geschrieben wurden. Bei einem Fehler
            // bekommt PayPal non-2xx und stellt das Ereignis erneut zu.
            await erstattungAusPaypal(runtimeEnv, event, reqId);
          }
        } catch (err) {
          logBackgroundFailure("webhook_observer_failed", reqId, err);
          if (event?.event_type === "PAYMENT.CAPTURE.REFUNDED") throw err;
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
    await runBackground(ctx, reconcilePurchasePayments(env, reqId), "purchase_reconciliation_failed", reqId);
    await runBackground(ctx, offeneBestellungenNachbereiten(env, reqId, new Date(scheduledTime)), "order_followup_failed", reqId);
    // Reservierte Zahlungen spaetestens am Ende der PayPal-Garantiezeit
    // einziehen, gepruefte Abbuchungen nachfragen, Rechnungen nachholen.
    await runBackground(ctx, zahlungenPflegen(env, reqId, new Date(scheduledTime)), "payment_capture_failed", reqId);
    await runBackground(ctx, paypalErstattungenAbgleichen(env, reqId, true), "paypal_refund_reconciliation_failed", reqId);
    // Nach dem Abgleich: wartende Erstattungen erneut versuchen, erledigte
    // abschliessen (Kundenmail, wieder im Shop), an Offenes erinnern.
    await runBackground(ctx, ruecklaufPflegen(env, reqId, new Date(scheduledTime)), "refund_jobs_failed", reqId);
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
    await runBackground(ctx, besucherAufraeumen(env, scheduledTime), "besucher_cleanup_failed", reqId);
    await runBackground(ctx, applePayDomainSicherstellen(env, scheduledTime), "apple_pay_domain_failed", reqId);
  },

  // Cloudflare Email Routing: kontakt@disorder119.com -> Postfach + Kopie ins Gmail.
  async email(message, env, ctx) {
    return handleIncomingEmail(message, env, ctx);
  },
};

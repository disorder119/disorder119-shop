import {
  claimCouponForOrder,
  findValidCoupon,
  normalizeCouponCode,
  releaseCouponClaim,
  redeemCouponForOrder,
} from "./game-rewards.js";

const CURRENCY = "EUR";

export class CouponCheckoutError extends Error {
  constructor(code, status = 409) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

export function formatEuros(cents) {
  const value = Math.max(0, Math.round(Number(cents) || 0));
  return (value / 100).toFixed(2);
}

// Der Gutschein rabattiert nur den Warenwert. Die Versandpauschale bleibt
// unveraendert stehen, deshalb wird der Betrag bei PayPal immer als Aufteilung
// (Ware + Versand) geschrieben - sonst wuerde die Pauschale im Rabatt
// verschwinden oder PayPal die Summe als widerspruechlich ablehnen.
export function paypalAmountPatch(itemCents, shippingCents = 0) {
  const item = Math.max(0, Math.round(Number(itemCents) || 0));
  const shipping = Math.max(0, Math.round(Number(shippingCents) || 0));
  const amount = { currency_code: CURRENCY, value: formatEuros(item + shipping) };
  if (shipping > 0) {
    amount.breakdown = {
      item_total: { currency_code: CURRENCY, value: formatEuros(item) },
      shipping: { currency_code: CURRENCY, value: formatEuros(shipping) },
    };
  }
  return [{
    op: "replace",
    path: "/purchase_units/@reference_id=='default'/amount",
    value: amount,
  }];
}

export async function couponCodeFromCreateRequest(request) {
  let body = {};
  try { body = await request.json(); }
  catch { return ""; }
  if (!body || typeof body !== "object" || Array.isArray(body)) return "";
  const raw = String(body.couponCode || "").trim();
  if (!raw) return "";
  const code = normalizeCouponCode(raw);
  if (!code) throw new CouponCheckoutError("COUPON_INVALID_OR_USED", 409);
  return code;
}

export async function assertCouponUsable(env, code) {
  if (!code) return null;
  const row = await findValidCoupon(env, code);
  if (!row) throw new CouponCheckoutError("COUPON_INVALID_OR_USED", 409);
  return row;
}

function paypalBase(env) {
  return String(env?.PAYPAL_ENVIRONMENT || "sandbox").toLowerCase() === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";
}

async function paypalAccessToken(env) {
  if (!env?.PAYPAL_CLIENT_ID || !env?.PAYPAL_CLIENT_SECRET) {
    throw new CouponCheckoutError("PAYPAL_NOT_CONFIGURED", 503);
  }
  const auth = btoa(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`);
  const response = await fetch(`${paypalBase(env)}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!response.ok) throw new CouponCheckoutError("COUPON_PROVIDER_UPDATE_FAILED", 502);
  const data = await response.json();
  if (!data?.access_token) throw new CouponCheckoutError("COUPON_PROVIDER_UPDATE_FAILED", 502);
  return data.access_token;
}

async function patchPaypalAmount(env, providerOrderId, itemCents, shippingCents = 0) {
  const token = await paypalAccessToken(env);
  const response = await fetch(`${paypalBase(env)}/v2/checkout/orders/${encodeURIComponent(providerOrderId)}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(paypalAmountPatch(itemCents, shippingCents)),
  });
  if (!response.ok) throw new CouponCheckoutError("COUPON_PROVIDER_UPDATE_FAILED", 502);
}

async function orderSnapshot(env, orderId) {
  if (!env?.DB) throw new CouponCheckoutError("COMMERCE_DATABASE_NOT_CONFIGURED", 503);
  return env.DB.prepare(`SELECT
      o.id AS order_id,o.status AS order_status,o.reservation_id,
      o.subtotal_cents,o.shipping_cents,o.total_cents,
      oi.inventory_id,oi.unit_price_cents,
      p.id AS payment_id,p.status AS payment_status,p.provider_order_id,p.amount_cents
    FROM commerce_orders o
    JOIN order_items oi ON oi.order_id=o.id
    JOIN payments p ON p.order_id=o.id AND p.provider='PAYPAL'
    WHERE o.id=? LIMIT 1`).bind(String(orderId)).first();
}

async function couponAlreadyAttached(env, orderId) {
  if (!env?.DB) return null;
  return env.DB.prepare(`SELECT id,discount_bps,status
    FROM reward_coupons
    WHERE reserved_order_id=? OR redeemed_order_id=?
    ORDER BY created_at DESC LIMIT 1`).bind(String(orderId), String(orderId)).first();
}

async function audit(env, orderId, requestId, eventType, metadata = {}) {
  if (!env?.DB) return;
  try {
    await env.DB.prepare(`INSERT INTO audit_events
      (id,actor_type,entity_type,entity_id,event_type,request_id,metadata_json,created_at)
      VALUES (?,'SYSTEM','order',?,?,?,?,?)`)
      .bind(
        crypto.randomUUID(),
        String(orderId),
        String(eventType),
        String(requestId || ""),
        JSON.stringify(metadata),
        new Date().toISOString(),
      ).run();
  } catch {}
}

async function cancelCreatedOrder(env, row, requestId, reason) {
  if (!env?.DB || !row) return;
  const db = env.DB;
  const now = new Date().toISOString();
  try {
    await db.batch([
      db.prepare("UPDATE payments SET status='CANCELLED',updated_at=? WHERE id=? AND status IN ('CREATED','PENDING','AUTHORIZED')")
        .bind(now, row.payment_id),
      db.prepare("UPDATE commerce_orders SET status='CANCELLED',updated_at=? WHERE id=? AND status IN ('RESERVED','PAYMENT_PENDING')")
        .bind(now, row.order_id),
      db.prepare("UPDATE reservations SET status='CANCELLED',updated_at=? WHERE id=? AND status='RESERVED'")
        .bind(now, row.reservation_id),
      db.prepare("UPDATE inventory SET status='CANCELLED',updated_at=?,version=version+1 WHERE id=? AND status IN ('RESERVED','PAYMENT_PENDING')")
        .bind(now, row.inventory_id),
      db.prepare("UPDATE inventory SET status='AVAILABLE',updated_at=?,version=version+1 WHERE id=? AND status='CANCELLED'")
        .bind(now, row.inventory_id),
    ]);
    await audit(env, row.order_id, requestId, "COUPON_CHECKOUT_CANCELLED", { reason: String(reason || "coupon_apply_failed").slice(0, 80) });
  } catch {}
}

export async function applyCouponToCreatedOrder(env, code, createResult, requestId = "") {
  if (!code) return null;
  const orderId = String(createResult?.orderId || "");
  if (!orderId) throw new CouponCheckoutError("COUPON_ORDER_NOT_FOUND", 502);

  const row = await orderSnapshot(env, orderId);
  if (!row || !row.provider_order_id) throw new CouponCheckoutError("COUPON_ORDER_NOT_FOUND", 502);
  // create-order itself is idempotent. If the same request is replayed after we
  // already patched the provider and DB, return the existing coupon state rather
  // than trying to claim the one-time code a second time.
  const attached = await couponAlreadyAttached(env, orderId);
  if (attached) {
    return {
      applied: true,
      discountPercent: Number(attached.discount_bps || 0) / 100,
      discountedTotalCents: Number(row.total_cents || 0),
      status: attached.status,
    };
  }

  if (row.order_status !== "PAYMENT_PENDING" || row.payment_status !== "CREATED") {
    throw new CouponCheckoutError("COUPON_ORDER_NOT_PAYABLE", 409);
  }

  let claim = null;
  const originalSubtotal = Number(row.subtotal_cents || row.unit_price_cents || 0);
  const shippingCents = Math.max(0, Number(row.shipping_cents || 0));
  const originalTotal = Number(row.total_cents || row.amount_cents || originalSubtotal + shippingCents);
  if (!Number.isFinite(originalSubtotal) || originalSubtotal <= 0 || !Number.isFinite(originalTotal) || originalTotal <= 0) {
    throw new CouponCheckoutError("COUPON_ORDER_AMOUNT_INVALID", 502);
  }

  try {
    claim = await claimCouponForOrder(env, code, orderId, originalSubtotal);
  } catch (error) {
    await cancelCreatedOrder(env, row, requestId, "coupon_claim_failed");
    if (error?.code) throw new CouponCheckoutError(error.code, error.status || 409);
    throw new CouponCheckoutError("COUPON_INVALID_OR_USED", 409);
  }

  const discountedSubtotal = Number(claim.totalCents || 0);
  // Rabattiert wird der Warenwert, der Versand kommt unveraendert obendrauf.
  const finalTotal = discountedSubtotal + shippingCents;
  if (!Number.isFinite(finalTotal) || finalTotal <= 0 || finalTotal >= originalTotal) {
    await releaseCouponClaim(env, claim.couponId, orderId);
    await cancelCreatedOrder(env, row, requestId, "coupon_amount_invalid");
    throw new CouponCheckoutError("COUPON_ORDER_AMOUNT_INVALID", 502);
  }

  let providerPatched = false;
  try {
    await patchPaypalAmount(env, row.provider_order_id, discountedSubtotal, shippingCents);
    providerPatched = true;

    const now = new Date().toISOString();
    const updates = await env.DB.batch([
      env.DB.prepare("UPDATE commerce_orders SET subtotal_cents=?,total_cents=?,updated_at=? WHERE id=? AND status='PAYMENT_PENDING'")
        .bind(discountedSubtotal, finalTotal, now, orderId),
      env.DB.prepare("UPDATE order_items SET unit_price_cents=? WHERE order_id=?")
        .bind(discountedSubtotal, orderId),
      env.DB.prepare("UPDATE payments SET amount_cents=?,updated_at=? WHERE id=? AND status='CREATED'")
        .bind(finalTotal, now, row.payment_id),
    ]);
    if (updates.some(result => !result?.meta?.changes)) {
      throw new CouponCheckoutError("COUPON_LOCAL_SYNC_FAILED", 502);
    }

    await audit(env, orderId, requestId, "COUPON_RESERVED", {
      couponId: claim.couponId,
      discountBps: claim.discountBps,
      discountCents: claim.discountCents,
      originalTotalCents: originalTotal,
      discountedTotalCents: finalTotal,
    });

    return {
      applied: true,
      discountPercent: Number(claim.discountBps || 0) / 100,
      discountCents: Number(claim.discountCents || 0),
      discountedTotalCents: finalTotal,
      status: "RESERVED",
    };
  } catch (error) {
    // If local synchronization failed after the PayPal patch, restore PayPal to
    // the original trusted amount before releasing the coupon whenever possible.
    if (providerPatched) {
      try { await patchPaypalAmount(env, row.provider_order_id, originalSubtotal, shippingCents); } catch {}
    }
    try { await releaseCouponClaim(env, claim?.couponId, orderId); } catch {}
    await cancelCreatedOrder(env, row, requestId, "coupon_provider_or_db_update_failed");
    if (error instanceof CouponCheckoutError) throw error;
    throw new CouponCheckoutError("COUPON_APPLY_FAILED", 502);
  }
}

export async function redeemCouponAfterPayment(env, orderId, requestId = "") {
  if (!env?.DB || !orderId) return;
  const reserved = await env.DB.prepare(`SELECT id FROM reward_coupons
    WHERE status='RESERVED' AND reserved_order_id=? LIMIT 1`).bind(String(orderId)).first();
  if (!reserved) return;
  await redeemCouponForOrder(env, String(orderId));
  await audit(env, orderId, requestId, "COUPON_REDEEMED", { couponId: reserved.id });
}

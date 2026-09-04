import {
  CURRENCY,
  MAX_REQUEST_BYTES,
  RESERVATION_TTL_SECONDS,
  isValidIdempotencyKey,
  money,
  parsePriceToCents,
  publicOrderNumber,
  rentalQuoteFromItem,
  safeText,
} from "./commerce-core.js";

const CONFIG = Object.freeze({
  githubOwner: "disorder119",
  githubRepo: "disorder119-shop",
  githubBranch: "main",
  itemsPath: "data/items.json",
});

const ALLOWED_ORIGINS = Object.freeze([
  "https://disorder119.com",
  "https://www.disorder119.com",
  "https://admin.disorder119.com",
  "http://localhost:8765",
]);

const ACTIVE_RENTAL_STATUSES = ["RESERVED", "PAYMENT_PENDING", "CONFIRMED", "ACTIVE", "RETURN_DUE"];

class PublicError extends Error {
  constructor(code, status = 400, message = code) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function paypalApiBase(env) {
  return String(env.PAYPAL_ENVIRONMENT || "sandbox").toLowerCase() === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";
}

function isLive(env) {
  return String(env.PAYPAL_ENVIRONMENT || "sandbox").toLowerCase() === "live";
}

function isAllowedOrigin(origin) {
  return ALLOWED_ORIGINS.includes(origin);
}

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": isAllowedOrigin(origin) ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, Idempotency-Key, X-Turnstile-Token",
    "Access-Control-Max-Age": "600",
  };
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

function json(data, status = 200, origin = null) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Vary": "Origin",
      ...securityHeaders(),
      ...corsHeaders(origin),
    },
  });
}

function requestId(request) {
  const existing = request.headers.get("cf-ray");
  return existing ? `cf-${existing}` : crypto.randomUUID();
}

async function readJson(request) {
  const type = (request.headers.get("Content-Type") || "").toLowerCase();
  if (!type.includes("application/json")) throw new PublicError("CONTENT_TYPE_REQUIRED", 415);
  const declared = Number(request.headers.get("Content-Length") || 0);
  if (declared > MAX_REQUEST_BYTES) throw new PublicError("REQUEST_TOO_LARGE", 413);
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_REQUEST_BYTES) throw new PublicError("REQUEST_TOO_LARGE", 413);
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    throw new PublicError("INVALID_JSON", 400);
  }
}

function idempotencyKey(request, body) {
  const key = request.headers.get("Idempotency-Key") || body?.idempotencyKey;
  if (!isValidIdempotencyKey(key)) throw new PublicError("IDEMPOTENCY_KEY_REQUIRED", 400);
  return key;
}

async function rateLimit(request, env, scope) {
  if (!env.RATE_LIMITER || typeof env.RATE_LIMITER.limit !== "function") return;
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const result = await env.RATE_LIMITER.limit({ key: `${scope}:${ip}` });
  if (result && result.success === false) throw new PublicError("RATE_LIMITED", 429);
}

async function verifyTurnstile(env, request, body) {
  if (!env.TURNSTILE_SECRET) return;
  const token = request.headers.get("X-Turnstile-Token") || body?.turnstileToken;
  if (!token) throw new PublicError("TURNSTILE_REQUIRED", 403);
  const form = new FormData();
  form.append("secret", env.TURNSTILE_SECRET);
  form.append("response", token);
  const ip = request.headers.get("CF-Connecting-IP");
  if (ip) form.append("remoteip", ip);
  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
  const result = await res.json();
  if (!result.success) throw new PublicError("TURNSTILE_FAILED", 403);
}

function requireDb(env) {
  if (!env.DB) throw new PublicError("COMMERCE_DATABASE_NOT_CONFIGURED", 503);
  return env.DB;
}

function isAdminAuthorized(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  return Boolean(env.ADMIN_TOKEN && token && token === env.ADMIN_TOKEN);
}

function ghHeaders(env) {
  if (!env.GITHUB_TOKEN) throw new PublicError("CATALOG_BACKEND_NOT_CONFIGURED", 503);
  return {
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "disorder119-shop-worker",
  };
}

async function loadItems(env) {
  const url = `https://api.github.com/repos/${CONFIG.githubOwner}/${CONFIG.githubRepo}/contents/${CONFIG.itemsPath}?ref=${CONFIG.githubBranch}`;
  const res = await fetch(url, { headers: ghHeaders(env) });
  if (!res.ok) throw new Error(`catalog_load_${res.status}`);
  const file = await res.json();
  const text = new TextDecoder().decode(Uint8Array.from(atob(file.content.replace(/\n/g, "")), c => c.charCodeAt(0)));
  return { items: JSON.parse(text), sha: file.sha };
}

async function findItem(env, itemId) {
  const { items } = await loadItems(env);
  return items.find(item => String(item.id) === String(itemId));
}

function assertCatalogItemForSale(item) {
  if (!item) throw new PublicError("ITEM_NOT_FOUND", 404);
  if (String(item.public_status || "").toUpperCase() === "SOLD") throw new PublicError("ITEM_UNAVAILABLE", 409);
  const cents = parsePriceToCents(item.price);
  if (cents === null) throw new PublicError("PRICE_ON_REQUEST", 409);
  return cents;
}

async function ensureInventory(env, item) {
  const db = requireDb(env);
  const id = `inv_${item.id}`;
  const now = new Date().toISOString();
  const priceCents = parsePriceToCents(item.price);
  const catalogStatus = String(item.public_status || "DRAFT").toUpperCase();
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO inventory
      (id,item_id,article_no,status,sale_price_cents,currency,catalog_status,version,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?)`).bind(
        id, Number(item.id), String(item.article || item.id), catalogStatus === "SOLD" ? "PAID" : "AVAILABLE",
        priceCents, CURRENCY, catalogStatus, 1, now
      ),
    db.prepare(`UPDATE inventory SET article_no=?, sale_price_cents=?, catalog_status=?, updated_at=?, version=version+1
      WHERE item_id=?`).bind(String(item.article || item.id), priceCents, catalogStatus, now, Number(item.id)),
  ]);
  return db.prepare("SELECT * FROM inventory WHERE item_id=?").bind(Number(item.id)).first();
}

async function cleanupExpired(env, inventoryId) {
  const db = requireDb(env);
  const now = new Date().toISOString();
  await db.batch([
    db.prepare("UPDATE reservations SET status='EXPIRED', updated_at=? WHERE inventory_id=? AND status='RESERVED' AND expires_at<=?")
      .bind(now, inventoryId, now),
    db.prepare("UPDATE rental_reservations SET status='CANCELLED', updated_at=? WHERE inventory_id=? AND status='RESERVED' AND expires_at IS NOT NULL AND expires_at<=?")
      .bind(now, inventoryId, now),
    db.prepare(`DELETE FROM rental_days WHERE rental_reservation_id IN
      (SELECT id FROM rental_reservations WHERE inventory_id=? AND status IN ('CANCELLED','REFUNDED','RETURNED'))`).bind(inventoryId),
    db.prepare(`UPDATE inventory SET status='AVAILABLE', updated_at=?, version=version+1
      WHERE id=? AND status='RESERVED'
      AND NOT EXISTS (SELECT 1 FROM reservations r WHERE r.inventory_id=inventory.id AND r.status='RESERVED')
      AND NOT EXISTS (SELECT 1 FROM rental_reservations rr WHERE rr.inventory_id=inventory.id AND rr.status IN ('RESERVED','PAYMENT_PENDING','CONFIRMED','ACTIVE','RETURN_DUE'))`)
      .bind(now, inventoryId),
  ]);
}

async function claimIdempotency(env, scope, key, ownerRequestId) {
  const db = requireDb(env);
  const now = new Date();
  const expires = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
  await db.prepare(`INSERT OR IGNORE INTO idempotency_keys
    (scope,idempotency_key,resource_id,created_at,expires_at) VALUES (?,?,?,?,?)`)
    .bind(scope, key, ownerRequestId, now.toISOString(), expires).run();
  const row = await db.prepare("SELECT * FROM idempotency_keys WHERE scope=? AND idempotency_key=?").bind(scope, key).first();
  if (row?.response_json) {
    return { replay: true, status: row.response_status || 200, data: JSON.parse(row.response_json) };
  }
  if (row?.resource_id !== ownerRequestId) throw new PublicError("IDEMPOTENT_REQUEST_IN_PROGRESS", 409);
  return { replay: false };
}

async function finishIdempotency(env, scope, key, status, data, resourceId = null) {
  const db = requireDb(env);
  await db.prepare(`UPDATE idempotency_keys SET response_status=?,response_json=?,resource_id=COALESCE(?,resource_id)
    WHERE scope=? AND idempotency_key=?`).bind(status, JSON.stringify(data), resourceId, scope, key).run();
}

async function audit(env, entityType, entityId, eventType, reqId, metadata = null, actorType = "SYSTEM") {
  if (!env.DB) return;
  const clean = metadata ? JSON.stringify(metadata) : null;
  await env.DB.prepare(`INSERT INTO audit_events
    (id,actor_type,entity_type,entity_id,event_type,request_id,metadata_json,created_at)
    VALUES (?,?,?,?,?,?,?,?)`).bind(
      crypto.randomUUID(), actorType, entityType, String(entityId), eventType, reqId, clean, new Date().toISOString()
    ).run();
}

async function reserveForPurchase(env, item, key, reqId) {
  const db = requireDb(env);
  const inv = await ensureInventory(env, item);
  await cleanupExpired(env, inv.id);
  const reservationId = crypto.randomUUID();
  const now = new Date();
  const expires = new Date(now.getTime() + RESERVATION_TTL_SECONDS * 1000).toISOString();
  const statements = await db.batch([
    db.prepare(`INSERT INTO reservations (id,inventory_id,kind,status,idempotency_key,expires_at,created_at)
      SELECT ?,id,'PURCHASE','RESERVED',?,?,? FROM inventory
      WHERE id=? AND status='AVAILABLE' AND catalog_status!='SOLD'
      AND NOT EXISTS (SELECT 1 FROM rental_reservations rr WHERE rr.inventory_id=inventory.id AND rr.status IN ('RESERVED','PAYMENT_PENDING','CONFIRMED','ACTIVE','RETURN_DUE'))`)
      .bind(reservationId, key, expires, now.toISOString(), inv.id),
    db.prepare(`UPDATE inventory SET status='RESERVED',updated_at=?,version=version+1
      WHERE id=? AND status='AVAILABLE' AND EXISTS (SELECT 1 FROM reservations WHERE id=? AND status='RESERVED')`)
      .bind(now.toISOString(), inv.id, reservationId),
  ]);
  if (!statements[0]?.meta?.changes) throw new PublicError("ITEM_UNAVAILABLE", 409);
  await audit(env, "reservation", reservationId, "PURCHASE_RESERVED", reqId, { itemId: item.id, expiresAt: expires });
  return { reservationId, inventoryId: inv.id, expiresAt: expires };
}

async function releasePurchaseReservation(env, reservationId, reason, reqId) {
  const db = requireDb(env);
  const row = await db.prepare("SELECT inventory_id FROM reservations WHERE id=?").bind(reservationId).first();
  if (!row) return;
  const now = new Date().toISOString();
  await db.batch([
    db.prepare("UPDATE reservations SET status='CANCELLED',updated_at=? WHERE id=? AND status='RESERVED'").bind(now, reservationId),
    db.prepare(`UPDATE inventory SET status='AVAILABLE',updated_at=?,version=version+1 WHERE id=? AND status='RESERVED'
      AND NOT EXISTS (SELECT 1 FROM reservations WHERE inventory_id=? AND status='RESERVED' AND id<>?)`)
      .bind(now, row.inventory_id, row.inventory_id, reservationId),
  ]);
  await audit(env, "reservation", reservationId, "RESERVATION_RELEASED", reqId, { reason });
}

async function createRentalReservation(env, item, quote, body, key, reqId) {
  const db = requireDb(env);
  const inv = await ensureInventory(env, item);
  await cleanupExpired(env, inv.id);
  if (["PAID","PREPARING","SHIPPED","DELIVERED","RETURN_REQUESTED"].includes(inv.status) || inv.catalog_status === "SOLD") {
    throw new PublicError("ITEM_UNAVAILABLE", 409);
  }
  const existingSale = await db.prepare("SELECT 1 AS yes FROM reservations WHERE inventory_id=? AND status='RESERVED' AND expires_at>? LIMIT 1")
    .bind(inv.id, new Date().toISOString()).first();
  if (existingSale) throw new PublicError("ITEM_UNAVAILABLE", 409);

  const rentalId = crypto.randomUUID();
  const now = new Date();
  const expires = new Date(now.getTime() + RESERVATION_TTL_SECONDS * 1000).toISOString();
  const statements = [
    db.prepare(`INSERT INTO rental_reservations
      (id,inventory_id,start_date,end_date,days,daily_price_cents,total_price_cents,currency,price_on_request,status,idempotency_key,expires_at,purpose,message,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,'RESERVED',?,?,?,?,?)`).bind(
        rentalId, inv.id, body.start, body.end, quote.days, quote.dailyPriceCents, quote.totalPriceCents,
        CURRENCY, quote.priceOnRequest ? 1 : 0, key, expires, safeText(body.purpose || "other", 40), safeText(body.message, 2000), now.toISOString()
      ),
  ];
  for (let offset = 0; offset < quote.days; offset++) {
    const d = new Date(`${body.start}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + offset);
    statements.push(db.prepare("INSERT INTO rental_days (inventory_id,rental_date,rental_reservation_id) VALUES (?,?,?)")
      .bind(inv.id, d.toISOString().slice(0,10), rentalId));
  }
  statements.push(db.prepare("UPDATE inventory SET status='RESERVED',updated_at=?,version=version+1 WHERE id=? AND status='AVAILABLE'")
    .bind(now.toISOString(), inv.id));
  try {
    await db.batch(statements);
  } catch (err) {
    if (String(err?.message || err).toLowerCase().includes("unique")) throw new PublicError("RENTAL_DATES_UNAVAILABLE", 409);
    throw err;
  }
  await audit(env, "rental_reservation", rentalId, "RENTAL_RESERVED", reqId, {
    itemId: item.id, start: body.start, end: body.end, days: quote.days,
    dailyPriceCents: quote.dailyPriceCents, totalPriceCents: quote.totalPriceCents, priceOnRequest: quote.priceOnRequest,
  });
  return { rentalId, expiresAt: expires };
}

async function paypalAccessToken(env) {
  if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET) throw new PublicError("PAYPAL_NOT_CONFIGURED", 503);
  const creds = btoa(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`);
  const res = await fetch(`${paypalApiBase(env)}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${creds}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`paypal_auth_${res.status}`);
  return (await res.json()).access_token;
}

async function createPaypalOrder(env, item, cents, idempotency) {
  const token = await paypalAccessToken(env);
  const res = await fetch(`${paypalApiBase(env)}/v2/checkout/orders`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "PayPal-Request-Id": idempotency,
    },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [{
        custom_id: String(item.id),
        description: `${item.brand || ""} ${item.title || ""}`.trim().slice(0,127),
        amount: { currency_code: CURRENCY, value: money(cents) },
      }],
      application_context: { shipping_preference: "GET_FROM_FILE", brand_name: "Disorder119" },
    }),
  });
  if (!res.ok) throw new Error(`paypal_create_${res.status}`);
  return res.json();
}

async function capturePaypalOrder(env, providerOrderId, idempotency) {
  const token = await paypalAccessToken(env);
  const res = await fetch(`${paypalApiBase(env)}/v2/checkout/orders/${encodeURIComponent(providerOrderId)}/capture`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "PayPal-Request-Id": idempotency },
  });
  if (!res.ok) throw new Error(`paypal_capture_${res.status}`);
  return res.json();
}

function capturePayment(capture) {
  return capture?.purchase_units?.[0]?.payments?.captures?.[0] || null;
}

function captureMatches(capture, itemId, cents) {
  const unit = capture?.purchase_units?.[0];
  const payment = capturePayment(capture);
  return capture?.status === "COMPLETED" && String(unit?.custom_id || "") === String(itemId) &&
    payment?.status === "COMPLETED" && payment?.amount?.currency_code === CURRENCY &&
    Math.round(Number(payment.amount.value) * 100) === cents;
}

async function verifyPaypalWebhook(env, headers, body) {
  if (!env.PAYPAL_WEBHOOK_ID) return false;
  const ts = Date.parse(headers.get("paypal-transmission-time") || "");
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > 10 * 60 * 1000) return false;
  const token = await paypalAccessToken(env);
  const res = await fetch(`${paypalApiBase(env)}/v1/notifications/verify-webhook-signature`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      auth_algo: headers.get("paypal-auth-algo"), cert_url: headers.get("paypal-cert-url"),
      transmission_id: headers.get("paypal-transmission-id"), transmission_sig: headers.get("paypal-transmission-sig"),
      transmission_time: headers.get("paypal-transmission-time"), webhook_id: env.PAYPAL_WEBHOOK_ID, webhook_event: body,
    }),
  });
  if (!res.ok) return false;
  return (await res.json()).verification_status === "SUCCESS";
}

async function markCatalogSold(env, itemId, providerOrderId) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const { items, sha } = await loadItems(env);
    const item = items.find(it => String(it.id) === String(itemId));
    if (!item) throw new Error("catalog_item_missing");
    if (item.public_status === "SOLD") {
      if (!item.paypal_order_id || item.paypal_order_id === providerOrderId) return;
      throw new Error("catalog_sale_conflict");
    }
    item.public_status = "SOLD";
    item.status = "Verkauft";
    item.paypal_order_id = providerOrderId;
    delete item.reserved_order_id;
    delete item.reserved_until;
    delete item.reserved_price;
    delete item.reserved_currency;
    const content = btoa(unescape(encodeURIComponent(JSON.stringify(items, null, 2))));
    const url = `https://api.github.com/repos/${CONFIG.githubOwner}/${CONFIG.githubRepo}/contents/${CONFIG.itemsPath}`;
    const res = await fetch(url, { method: "PUT", headers: ghHeaders(env), body: JSON.stringify({
      message: `Verkauft via PayPal: Artikel ${itemId}`, content, sha, branch: CONFIG.githubBranch,
    }) });
    if (res.ok) return;
    if (res.status !== 409) throw new Error(`catalog_mark_sold_${res.status}`);
  }
  throw new Error("catalog_mark_sold_conflict");
}

async function createOrderRecords(env, item, cents, reservation, providerOrder, key, reqId) {
  const db = requireDb(env);
  const orderId = crypto.randomUUID();
  const paymentId = crypto.randomUUID();
  const now = new Date().toISOString();
  const orderNumber = publicOrderNumber(orderId, new Date());
  await db.batch([
    db.prepare(`INSERT INTO commerce_orders
      (id,order_number,reservation_id,status,currency,subtotal_cents,shipping_cents,total_cents,idempotency_key,created_at)
      VALUES (?,?,?,'PAYMENT_PENDING',?,?,0,?,?,?)`).bind(orderId, orderNumber, reservation.reservationId, CURRENCY, cents, cents, key, now),
    db.prepare(`INSERT INTO order_items
      (id,order_id,inventory_id,item_id,article_no,title_snapshot,unit_price_cents,quantity,currency)
      VALUES (?,?,?,?,?,?,?,1,?)`).bind(crypto.randomUUID(), orderId, reservation.inventoryId, Number(item.id), String(item.article || item.id), `${item.brand || ""} ${item.title || ""}`.trim(), cents, CURRENCY),
    db.prepare(`INSERT INTO payments
      (id,order_id,provider,provider_order_id,status,amount_cents,currency,idempotency_key,created_at)
      VALUES (?,?,'PAYPAL',?,'CREATED',?,?,?,?)`).bind(paymentId, orderId, providerOrder.id, cents, CURRENCY, `paypal-create:${key}`, now),
    db.prepare("UPDATE reservations SET status='RESERVED',updated_at=? WHERE id=?").bind(now, reservation.reservationId),
    db.prepare("UPDATE inventory SET status='PAYMENT_PENDING',updated_at=?,version=version+1 WHERE id=? AND status='RESERVED'").bind(now, reservation.inventoryId),
  ]);
  await audit(env, "order", orderId, "PAYMENT_STARTED", reqId, { orderNumber, itemId: item.id, provider: "PAYPAL" });
  return { orderId, orderNumber, paymentId };
}

async function completePayment(env, providerOrderId, capture, reqId) {
  const db = requireDb(env);
  const payment = await db.prepare(`SELECT p.*,o.id AS commerce_order_id,o.order_number,o.reservation_id,oi.inventory_id,oi.item_id,oi.unit_price_cents
    FROM payments p JOIN commerce_orders o ON o.id=p.order_id JOIN order_items oi ON oi.order_id=o.id
    WHERE p.provider='PAYPAL' AND p.provider_order_id=?`).bind(providerOrderId).first();
  if (!payment) throw new PublicError("ORDER_NOT_FOUND", 404);
  if (payment.status === "COMPLETED") return payment;
  if (!captureMatches(capture, payment.item_id, payment.unit_price_cents)) throw new PublicError("PAYMENT_MISMATCH", 409);
  const providerPayment = capturePayment(capture);
  const now = new Date().toISOString();
  await db.batch([
    db.prepare("UPDATE payments SET provider_payment_id=?,status='COMPLETED',updated_at=? WHERE id=? AND status!='COMPLETED'")
      .bind(providerPayment.id, now, payment.id),
    db.prepare("UPDATE commerce_orders SET status='PAID',updated_at=? WHERE id=? AND status IN ('PAYMENT_PENDING','RESERVED')")
      .bind(now, payment.commerce_order_id),
    db.prepare("UPDATE reservations SET status='CONSUMED',updated_at=? WHERE id=? AND status='RESERVED'").bind(now, payment.reservation_id),
    db.prepare("UPDATE inventory SET status='PAID',updated_at=?,version=version+1 WHERE id=? AND status IN ('RESERVED','PAYMENT_PENDING')")
      .bind(now, payment.inventory_id),
  ]);
  await audit(env, "payment", payment.id, "PAYMENT_COMPLETED", reqId, { orderId: payment.commerce_order_id, itemId: payment.item_id, provider: "PAYPAL" }, "PAYMENT_PROVIDER");
  return payment;
}

async function recordWebhookEvent(env, event, verified) {
  const db = requireDb(env);
  const providerEventId = safeText(event?.id, 200);
  if (!providerEventId) throw new PublicError("WEBHOOK_EVENT_ID_MISSING", 400);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const result = await db.prepare(`INSERT OR IGNORE INTO payment_events
    (id,provider,provider_event_id,event_type,verified,received_at) VALUES (?,'PAYPAL',?,?,?,?)`)
    .bind(id, providerEventId, safeText(event.event_type, 100), verified ? 1 : 0, now).run();
  return Boolean(result.meta?.changes);
}

async function listRentalRequests(env) {
  const db = requireDb(env);
  const result = await db.prepare(`SELECT rr.id, i.item_id AS itemId, i.article_no AS articleNo,
    rr.start_date AS start, rr.end_date AS end, rr.days, rr.purpose, rr.message, rr.status,
    rr.daily_price_cents AS dailyPriceCents, rr.total_price_cents AS totalPriceCents,
    rr.price_on_request AS priceOnRequest, rr.created_at AS createdAt, rr.updated_at AS updatedAt
    FROM rental_reservations rr JOIN inventory i ON i.id=rr.inventory_id ORDER BY rr.created_at DESC LIMIT 500`).all();
  return result.results || [];
}

async function updateRentalStatus(env, id, status, reqId) {
  const allowed = ["RESERVED","PAYMENT_PENDING","CONFIRMED","ACTIVE","RETURN_DUE","RETURNED","CANCELLED","REFUNDED"];
  if (!allowed.includes(status)) throw new PublicError("INVALID_RENTAL_STATUS", 400);
  const db = requireDb(env);
  const now = new Date().toISOString();
  const row = await db.prepare("SELECT inventory_id,status FROM rental_reservations WHERE id=?").bind(id).first();
  if (!row) throw new PublicError("RENTAL_NOT_FOUND", 404);
  await db.prepare("UPDATE rental_reservations SET status=?,updated_at=? WHERE id=?").bind(status, now, id).run();
  if (["RETURNED","CANCELLED","REFUNDED"].includes(status)) {
    await db.batch([
      db.prepare("DELETE FROM rental_days WHERE rental_reservation_id=?").bind(id),
      db.prepare(`UPDATE inventory SET status='AVAILABLE',updated_at=?,version=version+1 WHERE id=?
        AND NOT EXISTS (SELECT 1 FROM reservations WHERE inventory_id=? AND status='RESERVED')
        AND NOT EXISTS (SELECT 1 FROM rental_reservations WHERE inventory_id=? AND id<>? AND status IN ('RESERVED','PAYMENT_PENDING','CONFIRMED','ACTIVE','RETURN_DUE'))`)
        .bind(now, row.inventory_id, row.inventory_id, row.inventory_id, id),
    ]);
  }
  await audit(env, "rental_reservation", id, `RENTAL_${status}`, reqId, null, "ADMIN");
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");
    const reqId = requestId(request);

    if (request.method === "OPTIONS") {
      if (origin && !isAllowedOrigin(origin)) return new Response(null, { status: 403, headers: securityHeaders() });
      return new Response(null, { status: 204, headers: { ...corsHeaders(origin), ...securityHeaders() } });
    }

    try {
      if (url.pathname === "/health" && request.method === "GET") {
        return json({ ok: true, version: "commerce-foundation-v2", environment: isLive(env) ? "live" : "sandbox", dbReady: Boolean(env.DB), checkoutReady: Boolean(env.DB && env.PAYPAL_CLIENT_ID && env.PAYPAL_CLIENT_SECRET && env.PAYPAL_WEBHOOK_ID && env.GITHUB_TOKEN) }, 200, origin);
      }

      const browserWrite = request.method !== "GET" && url.pathname !== "/paypal-webhook";
      if (browserWrite && !isAllowedOrigin(origin)) throw new PublicError("ORIGIN_NOT_ALLOWED", 403);

      if (url.pathname === "/rental-quote" && request.method === "POST") {
        await rateLimit(request, env, "rental-quote");
        const body = await readJson(request);
        if (!/^\d+$/.test(String(body.itemId || ""))) throw new PublicError("INVALID_ITEM_ID", 400);
        const item = await findItem(env, body.itemId);
        if (!item) throw new PublicError("ITEM_NOT_FOUND", 404);
        let quote;
        try { quote = rentalQuoteFromItem(item, String(body.start || ""), String(body.end || "")); }
        catch (err) {
          if (err.message === "ITEM_SOLD") throw new PublicError("ITEM_UNAVAILABLE", 409);
          if (err.message === "INVALID_RENTAL_DATES") throw new PublicError("INVALID_RENTAL_DATES", 400);
          throw err;
        }
        return json({ itemId: item.id, currency: CURRENCY, days: quote.days, dailyPrice: quote.dailyPriceCents === null ? null : money(quote.dailyPriceCents), totalPrice: quote.totalPriceCents === null ? null : money(quote.totalPriceCents), priceOnRequest: quote.priceOnRequest }, 200, origin);
      }

      if (url.pathname === "/rental-request" && request.method === "POST") {
        await rateLimit(request, env, "rental-request");
        const body = await readJson(request);
        await verifyTurnstile(env, request, body);
        const key = idempotencyKey(request, body);
        const claimed = await claimIdempotency(env, "rental-request", key, reqId);
        if (claimed.replay) return json(claimed.data, claimed.status, origin);
        if (!/^\d+$/.test(String(body.itemId || ""))) throw new PublicError("INVALID_ITEM_ID", 400);
        const item = await findItem(env, body.itemId);
        if (!item) throw new PublicError("ITEM_NOT_FOUND", 404);
        let quote;
        try { quote = rentalQuoteFromItem(item, String(body.start || ""), String(body.end || "")); }
        catch (err) {
          if (err.message === "ITEM_SOLD") throw new PublicError("ITEM_UNAVAILABLE", 409);
          if (err.message === "INVALID_RENTAL_DATES") throw new PublicError("INVALID_RENTAL_DATES", 400);
          throw err;
        }
        const rental = await createRentalReservation(env, item, quote, body, key, reqId);
        const response = { ok: true, rentalReservationId: rental.rentalId, expiresAt: rental.expiresAt, currency: CURRENCY, days: quote.days, dailyPrice: quote.dailyPriceCents === null ? null : money(quote.dailyPriceCents), totalPrice: quote.totalPriceCents === null ? null : money(quote.totalPriceCents), priceOnRequest: quote.priceOnRequest };
        await finishIdempotency(env, "rental-request", key, 201, response, rental.rentalId);
        return json(response, 201, origin);
      }

      if (url.pathname === "/create-order" && request.method === "POST") {
        await rateLimit(request, env, "create-order");
        if (isLive(env) && !env.DB) throw new PublicError("COMMERCE_DATABASE_NOT_CONFIGURED", 503);
        const body = await readJson(request);
        await verifyTurnstile(env, request, body);
        const key = idempotencyKey(request, body);
        const claimed = await claimIdempotency(env, "create-order", key, reqId);
        if (claimed.replay) return json(claimed.data, claimed.status, origin);
        if (!/^\d+$/.test(String(body.itemId || ""))) throw new PublicError("INVALID_ITEM_ID", 400);
        const item = await findItem(env, body.itemId);
        const cents = assertCatalogItemForSale(item);
        const reservation = await reserveForPurchase(env, item, key, reqId);
        let providerOrder;
        try {
          providerOrder = await createPaypalOrder(env, item, cents, key);
        } catch (err) {
          await releasePurchaseReservation(env, reservation.reservationId, "provider_create_failed", reqId);
          throw err;
        }
        const local = await createOrderRecords(env, item, cents, reservation, providerOrder, key, reqId);
        const response = { id: providerOrder.id, orderId: local.orderId, orderNumber: local.orderNumber, expiresAt: reservation.expiresAt };
        await finishIdempotency(env, "create-order", key, 200, response, local.orderId);
        return json(response, 200, origin);
      }

      if (url.pathname === "/capture-order" && request.method === "POST") {
        await rateLimit(request, env, "capture-order");
        const body = await readJson(request);
        const key = idempotencyKey(request, body);
        const claimed = await claimIdempotency(env, "capture-order", key, reqId);
        if (claimed.replay) return json(claimed.data, claimed.status, origin);
        const providerOrderId = safeText(body.orderId, 128);
        if (!providerOrderId) throw new PublicError("ORDER_ID_REQUIRED", 400);
        const db = requireDb(env);
        const payment = await db.prepare(`SELECT p.*,o.reservation_id,oi.inventory_id FROM payments p
          JOIN commerce_orders o ON o.id=p.order_id JOIN order_items oi ON oi.order_id=o.id
          WHERE p.provider='PAYPAL' AND p.provider_order_id=?`).bind(providerOrderId).first();
        if (!payment) throw new PublicError("ORDER_NOT_FOUND", 404);
        if (payment.status === "COMPLETED") {
          const response = { ok: true, orderId: payment.order_id };
          await finishIdempotency(env, "capture-order", key, 200, response, payment.order_id);
          return json(response, 200, origin);
        }
        const reservation = await db.prepare("SELECT * FROM reservations WHERE id=?").bind(payment.reservation_id).first();
        if (!reservation || reservation.status !== "RESERVED" || reservation.expires_at <= new Date().toISOString()) throw new PublicError("RESERVATION_EXPIRED", 409);
        const capture = await capturePaypalOrder(env, providerOrderId, key);
        const completed = await completePayment(env, providerOrderId, capture, reqId);
        try { await markCatalogSold(env, completed.item_id, providerOrderId); }
        catch (catalogErr) {
          await audit(env, "order", completed.commerce_order_id, "CATALOG_SYNC_FAILED", reqId, { code: safeText(catalogErr.message, 80) });
          console.error(JSON.stringify({ level: "error", event: "catalog_sync_failed", requestId: reqId, orderId: completed.commerce_order_id }));
        }
        const response = { ok: true, orderId: completed.commerce_order_id, orderNumber: completed.order_number };
        await finishIdempotency(env, "capture-order", key, 200, response, completed.commerce_order_id);
        return json(response, 200, origin);
      }

      if (url.pathname === "/paypal-webhook" && request.method === "POST") {
        await rateLimit(request, env, "paypal-webhook");
        const body = await readJson(request);
        const verified = await verifyPaypalWebhook(env, request.headers, body);
        if (!verified) throw new PublicError("WEBHOOK_SIGNATURE_INVALID", 400);
        const isNew = await recordWebhookEvent(env, body, true);
        if (!isNew) return json({ ok: true, duplicate: true }, 200, origin);
        if (body.event_type === "PAYMENT.CAPTURE.COMPLETED") {
          const providerOrderId = body.resource?.supplementary_data?.related_ids?.order_id;
          if (providerOrderId) {
            const token = await paypalAccessToken(env);
            const res = await fetch(`${paypalApiBase(env)}/v2/checkout/orders/${encodeURIComponent(providerOrderId)}`, { headers: { Authorization: `Bearer ${token}` } });
            if (res.ok) {
              const order = await res.json();
              const completed = await completePayment(env, providerOrderId, order, reqId);
              try { await markCatalogSold(env, completed.item_id, providerOrderId); } catch (err) {
                await audit(env, "order", completed.commerce_order_id, "CATALOG_SYNC_FAILED", reqId, { code: safeText(err.message, 80) });
              }
            }
          }
        }
        await requireDb(env).prepare("UPDATE payment_events SET processed_at=? WHERE provider='PAYPAL' AND provider_event_id=?")
          .bind(new Date().toISOString(), safeText(body.id, 200)).run();
        return json({ ok: true }, 200, origin);
      }

      if (url.pathname === "/rental-requests" && request.method === "GET") {
        if (!isAdminAuthorized(request, env)) throw new PublicError("UNAUTHORIZED", 401);
        return json({ requests: await listRentalRequests(env) }, 200, origin);
      }

      if (url.pathname.startsWith("/rental-request/") && request.method === "PATCH") {
        if (!isAdminAuthorized(request, env)) throw new PublicError("UNAUTHORIZED", 401);
        const body = await readJson(request);
        const id = safeText(url.pathname.slice("/rental-request/".length), 100);
        await updateRentalStatus(env, id, String(body.status || "").toUpperCase(), reqId);
        return json({ ok: true }, 200, origin);
      }

      if (url.pathname.startsWith("/account/") && ["GET","POST","PATCH","DELETE"].includes(request.method)) {
        throw new PublicError("AUTH_PROVIDER_NOT_CONFIGURED", 501);
      }

      throw new PublicError("NOT_FOUND", 404);
    } catch (err) {
      if (err instanceof PublicError) return json({ error: err.code, requestId: reqId }, err.status, origin);
      console.error(JSON.stringify({ level: "error", event: "unhandled_worker_error", requestId: reqId, message: safeText(err?.message || "unknown", 160) }));
      return json({ error: "INTERNAL_SHOP_ERROR", requestId: reqId }, 500, origin);
    }
  },
};

import {
  CURRENCY,
  MAX_REQUEST_BYTES,
  RESERVATION_TTL_SECONDS,
  isValidIdempotencyKey,
  money,
  parsePriceToCents,
  rentalQuoteFromItem,
  safeText,
} from "./commerce-core.js";

const ALLOWED_ORIGINS = Object.freeze([
  "https://disorder119.com",
  "https://www.disorder119.com",
  "http://localhost:8765",
  "http://127.0.0.1:8765",
]);
const MAX_BUNDLE_ITEMS = 20;
const STANDARD_MAX_DAYS = 7;
const DEPOSIT_RATE_BPS = 5000;
const DEPOSIT_MIN_CENTS = 5000;

class BundleError extends Error {
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
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Idempotency-Key, X-Turnstile-Token",
    "Access-Control-Max-Age": "600",
    "Vary": "Origin",
  };
}

function json(data, status = 200, origin = null) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...securityHeaders(), ...corsHeaders(origin) },
  });
}

function requireDb(env) {
  if (!env.DB) throw new BundleError("COMMERCE_DATABASE_NOT_CONFIGURED", 503);
  return env.DB;
}

async function readJson(request) {
  const type = (request.headers.get("Content-Type") || "").toLowerCase();
  if (!type.includes("application/json")) throw new BundleError("CONTENT_TYPE_REQUIRED", 415);
  const declared = Number(request.headers.get("Content-Length") || 0);
  if (declared > MAX_REQUEST_BYTES) throw new BundleError("REQUEST_TOO_LARGE", 413);
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_REQUEST_BYTES) throw new BundleError("REQUEST_TOO_LARGE", 413);
  try { return raw ? JSON.parse(raw) : {}; }
  catch { throw new BundleError("INVALID_JSON", 400); }
}

async function rateLimit(request, env) {
  if (!env.RATE_LIMITER || typeof env.RATE_LIMITER.limit !== "function") return;
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const result = await env.RATE_LIMITER.limit({ key: `rental-bundle:${ip}` });
  if (result && result.success === false) throw new BundleError("RATE_LIMITED", 429);
}

async function verifyTurnstile(env, request, body) {
  if (!env.TURNSTILE_SECRET) return;
  const token = request.headers.get("X-Turnstile-Token") || body?.turnstileToken;
  if (!token) throw new BundleError("TURNSTILE_REQUIRED", 403);
  const form = new FormData();
  form.append("secret", env.TURNSTILE_SECRET);
  form.append("response", token);
  const ip = request.headers.get("CF-Connecting-IP");
  if (ip) form.append("remoteip", ip);
  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
  const result = await res.json();
  if (!result.success) throw new BundleError("TURNSTILE_FAILED", 403);
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      if (key === "idempotencyKey" || key === "turnstileToken") continue;
      out[key] = canonical(value[key]);
    }
    return out;
  }
  return value;
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

async function claimIdempotency(env, key, requestOwner, body) {
  const db = requireDb(env);
  if (!isValidIdempotencyKey(key)) throw new BundleError("IDEMPOTENCY_KEY_REQUIRED", 400);
  const fingerprint = await sha256Hex(JSON.stringify({ scope: "rental-bundle", body: canonical(body) }));
  const now = new Date();
  const nowIso = now.toISOString();
  const expires = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
  await db.prepare("DELETE FROM idempotency_keys WHERE scope='rental-bundle' AND idempotency_key=? AND expires_at<=?")
    .bind(key, nowIso).run();
  await db.prepare(`INSERT OR IGNORE INTO idempotency_keys
    (scope,idempotency_key,request_hash,resource_id,created_at,expires_at) VALUES ('rental-bundle',?,?,?,?,?)`)
    .bind(key, fingerprint, requestOwner, nowIso, expires).run();
  const row = await db.prepare("SELECT * FROM idempotency_keys WHERE scope='rental-bundle' AND idempotency_key=?").bind(key).first();
  if (!row || row.request_hash !== fingerprint) throw new BundleError("IDEMPOTENCY_KEY_REUSED", 409);
  if (row.response_json) return { replay: true, status: row.response_status || 200, data: JSON.parse(row.response_json) };
  if (row.resource_id !== requestOwner) throw new BundleError("IDEMPOTENT_REQUEST_IN_PROGRESS", 409);
  return { replay: false };
}

async function finishIdempotency(env, key, status, data, groupId) {
  await requireDb(env).prepare(`UPDATE idempotency_keys SET response_status=?,response_json=?,resource_id=?
    WHERE scope='rental-bundle' AND idempotency_key=?`).bind(status, JSON.stringify(data), groupId, key).run();
}

async function releaseIdempotencyClaim(env, key, requestOwner) {
  if (!env.DB || !key) return;
  await env.DB.prepare(`DELETE FROM idempotency_keys
    WHERE scope='rental-bundle' AND idempotency_key=? AND resource_id=? AND response_json IS NULL`)
    .bind(key, requestOwner).run().catch(() => {});
}

function decodeGitHubContent(content) {
  const binary = atob(String(content || "").replace(/\n/g, ""));
  const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

async function loadItems(env) {
  if (env.GITHUB_TOKEN) {
    const res = await fetch("https://api.github.com/repos/disorder119/disorder119-shop/contents/data/items.json?ref=main", {
      headers: {
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "disorder119-rental-bundle",
      },
    });
    if (res.ok) {
      const file = await res.json();
      return JSON.parse(decodeGitHubContent(file.content));
    }
  }
  const fallback = await fetch("https://raw.githubusercontent.com/disorder119/disorder119-shop/main/data/items.json", {
    headers: { Accept: "application/json", "User-Agent": "disorder119-rental-bundle" },
  });
  if (!fallback.ok) throw new BundleError("CATALOG_BACKEND_NOT_CONFIGURED", 503);
  return fallback.json();
}

function normalizeItemIds(value) {
  if (!Array.isArray(value) || !value.length || value.length > MAX_BUNDLE_ITEMS) throw new BundleError("INVALID_RENTAL_ITEMS", 400);
  const ids = value.map(raw => String(raw));
  if (ids.some(id => !/^\d+$/.test(id))) throw new BundleError("INVALID_ITEM_ID", 400);
  const unique = Array.from(new Set(ids));
  if (unique.length !== ids.length) throw new BundleError("DUPLICATE_RENTAL_ITEM", 400);
  return unique;
}

function depositCents(salePriceCents) {
  if (!Number.isSafeInteger(salePriceCents) || salePriceCents <= 0) return null;
  return Math.max(DEPOSIT_MIN_CENTS, Math.round((salePriceCents * DEPOSIT_RATE_BPS) / 10000));
}

async function ensureInventory(env, items) {
  const db = requireDb(env);
  const now = new Date().toISOString();
  const statements = [];
  for (const item of items) {
    const price = parsePriceToCents(item.price);
    const catalogStatus = String(item.public_status || "DRAFT").toUpperCase();
    const inventoryId = `inv_${item.id}`;
    statements.push(db.prepare(`INSERT OR IGNORE INTO inventory
      (id,item_id,article_no,status,sale_price_cents,currency,catalog_status,version,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?)`).bind(
        inventoryId, Number(item.id), String(item.article || item.id), catalogStatus === "SOLD" ? "PAID" : "AVAILABLE",
        price, CURRENCY, catalogStatus, 1, now
      ));
    statements.push(db.prepare(`UPDATE inventory SET article_no=?,sale_price_cents=?,catalog_status=?,updated_at=?,version=version+1
      WHERE item_id=?`).bind(String(item.article || item.id), price, catalogStatus, now, Number(item.id)));
  }
  await db.batch(statements);
}

async function cleanupExpiredBundles(env) {
  const db = requireDb(env);
  const now = new Date().toISOString();
  await db.batch([
    db.prepare(`UPDATE rental_reservations SET status='CANCELLED',updated_at=?
      WHERE status='RESERVED' AND group_id IN (
        SELECT id FROM rental_groups WHERE status='RESERVED' AND expires_at IS NOT NULL AND expires_at<=?
      )`).bind(now, now),
    db.prepare(`DELETE FROM rental_days WHERE rental_reservation_id IN (
      SELECT id FROM rental_reservations WHERE status='CANCELLED' AND group_id IN (
        SELECT id FROM rental_groups WHERE status='RESERVED' AND expires_at IS NOT NULL AND expires_at<=?
      )
    )`).bind(now),
    db.prepare(`UPDATE rental_groups SET status='CANCELLED',updated_at=?
      WHERE status='RESERVED' AND expires_at IS NOT NULL AND expires_at<=?`).bind(now, now),
    db.prepare(`UPDATE inventory SET status='AVAILABLE',updated_at=?,version=version+1
      WHERE status='RESERVED'
      AND NOT EXISTS (SELECT 1 FROM reservations r WHERE r.inventory_id=inventory.id AND r.status='RESERVED' AND r.expires_at>?)
      AND NOT EXISTS (SELECT 1 FROM rental_reservations rr WHERE rr.inventory_id=inventory.id AND rr.status IN ('RESERVED','PAYMENT_PENDING','CONFIRMED','ACTIVE','RETURN_DUE'))`)
      .bind(now, now),
  ]);
}

async function preflightAvailability(env, items, start, end) {
  const db = requireDb(env);
  const checks = [];
  for (const item of items) {
    const inventoryId = `inv_${item.id}`;
    checks.push(db.prepare(`SELECT i.status,i.catalog_status,
      EXISTS(SELECT 1 FROM reservations r WHERE r.inventory_id=i.id AND r.status='RESERVED' AND r.expires_at>?) AS saleHeld,
      EXISTS(SELECT 1 FROM rental_days rd WHERE rd.inventory_id=i.id AND rd.rental_date BETWEEN ? AND ?) AS datesHeld
      FROM inventory i WHERE i.id=?`).bind(new Date().toISOString(), start, end, inventoryId));
  }
  const results = await db.batch(checks);
  for (let i = 0; i < results.length; i++) {
    const row = results[i]?.results?.[0];
    if (!row) throw new BundleError("ITEM_NOT_FOUND", 404);
    if (String(row.catalog_status || "").toUpperCase() === "SOLD") throw new BundleError("ITEM_UNAVAILABLE", 409);
    if (!["AVAILABLE", "RESERVED"].includes(String(row.status || "").toUpperCase())) throw new BundleError("ITEM_UNAVAILABLE", 409);
    if (Number(row.saleHeld || 0)) throw new BundleError("ITEM_UNAVAILABLE", 409);
    if (Number(row.datesHeld || 0)) throw new BundleError("RENTAL_DATES_UNAVAILABLE", 409);
  }
}

function safePurpose(value) {
  return safeText(value || "other", 40) || "other";
}

async function createAtomicBundle(env, items, quotes, body, key, reqId) {
  const db = requireDb(env);
  const groupId = crypto.randomUUID();
  const now = new Date();
  const nowIso = now.toISOString();
  const holdExpires = new Date(now.getTime() + RESERVATION_TTL_SECONDS * 1000).toISOString();
  const anyPriceOnRequest = quotes.some(q => q.priceOnRequest);
  const rentalTotal = anyPriceOnRequest ? null : quotes.reduce((sum, q) => sum + Number(q.totalPriceCents || 0), 0);
  const deposits = quotes.map(q => depositCents(q.salePriceCents));
  const depositTotal = deposits.some(v => v === null) ? null : deposits.reduce((sum, value) => sum + value, 0);
  const purpose = safePurpose(body.purpose);
  const message = safeText(body.message, 2000);
  const delivery = ["shipping", "pickup"].includes(String(body.delivery || "")) ? String(body.delivery) : null;
  const postal = safeText(body.postal, 160) || null;
  const risk = safeText(body.risk, 1000) || null;
  const termsVersion = safeText(body.termsVersion, 120);
  const termsLanguage = safeText(body.termsLanguage || body.language, 12) || null;
  const termsAcceptedAt = safeText(body.termsAcceptedAt, 40);
  if (!termsVersion || !termsAcceptedAt) throw new BundleError("RENTAL_TERMS_ACCEPTANCE_REQUIRED", 400);

  const statements = [
    db.prepare(`INSERT INTO rental_groups
      (id,status,item_count,start_date,end_date,days,rental_total_cents,deposit_total_cents,currency,price_on_request,
       purpose,message,delivery_method,postal_text,risk_notes,terms_version,terms_language,terms_accepted_at,idempotency_key,expires_at,created_at,updated_at)
      VALUES (?,'BUILDING',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
        groupId, items.length, body.start, body.end, quotes[0].days, rentalTotal, depositTotal, CURRENCY, anyPriceOnRequest ? 1 : 0,
        purpose, message, delivery, postal, risk, termsVersion, termsLanguage, termsAcceptedAt, key, holdExpires, nowIso, nowIso
      ),
  ];
  const responseItems = [];

  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    const quote = quotes[index];
    const inventoryId = `inv_${item.id}`;
    const rentalId = crypto.randomUUID();
    const childKey = `bundle:${groupId}:${item.id}`;
    const deposit = deposits[index];
    statements.push(db.prepare(`INSERT INTO rental_reservations
      (id,inventory_id,start_date,end_date,days,daily_price_cents,total_price_cents,currency,price_on_request,status,idempotency_key,
       expires_at,purpose,message,created_at,group_id,deposit_cents,delivery_method,postal_text,risk_notes,terms_version,terms_language,terms_accepted_at,updated_at)
      SELECT ?,i.id,?,?,?,?,?,?,?,'RESERVED',?,?,?,?,?,?,?,?,?,?,?,?,?,?
      FROM inventory i
      WHERE i.id=? AND i.status IN ('AVAILABLE','RESERVED') AND i.catalog_status!='SOLD'
      AND NOT EXISTS (SELECT 1 FROM reservations r WHERE r.inventory_id=i.id AND r.status='RESERVED' AND r.expires_at>?)`).bind(
        rentalId, body.start, body.end, quote.days, quote.dailyPriceCents, quote.totalPriceCents, CURRENCY, quote.priceOnRequest ? 1 : 0,
        childKey, holdExpires, purpose, message, nowIso, groupId, deposit, delivery, postal, risk, termsVersion, termsLanguage, termsAcceptedAt, nowIso,
        inventoryId, nowIso
      ));
    for (let offset = 0; offset < quote.days; offset++) {
      const date = new Date(`${body.start}T00:00:00Z`);
      date.setUTCDate(date.getUTCDate() + offset);
      statements.push(db.prepare(`INSERT INTO rental_days (inventory_id,rental_date,rental_reservation_id)
        SELECT ?,?,? WHERE EXISTS (SELECT 1 FROM rental_reservations WHERE id=?)`)
        .bind(inventoryId, date.toISOString().slice(0, 10), rentalId, rentalId));
    }
    statements.push(db.prepare("UPDATE inventory SET status='RESERVED',updated_at=?,version=version+1 WHERE id=? AND status='AVAILABLE'")
      .bind(nowIso, inventoryId));
    statements.push(db.prepare(`INSERT INTO audit_events
      (id,actor_type,entity_type,entity_id,event_type,request_id,metadata_json,created_at)
      SELECT ?,'CUSTOMER','rental_reservation',?,'RENTAL_BUNDLE_RESERVED',?,?,?
      WHERE EXISTS (SELECT 1 FROM rental_reservations WHERE id=?)`).bind(
        crypto.randomUUID(), rentalId, reqId,
        JSON.stringify({ groupId, itemId: item.id, start: body.start, end: body.end, depositCents: deposit }), nowIso, rentalId
      ));
    responseItems.push({
      itemId: Number(item.id),
      articleNo: String(item.article || item.id),
      rentalReservationId: rentalId,
      dailyPriceCents: quote.dailyPriceCents,
      totalPriceCents: quote.totalPriceCents,
      depositCents: deposit,
      priceOnRequest: quote.priceOnRequest,
    });
  }

  statements.push(db.prepare("UPDATE rental_groups SET status='RESERVED',updated_at=? WHERE id=? AND status='BUILDING'").bind(nowIso, groupId));
  statements.push(db.prepare(`INSERT INTO audit_events
    (id,actor_type,entity_type,entity_id,event_type,request_id,metadata_json,created_at)
    VALUES (?,'CUSTOMER','rental_group',?,'RENTAL_BUNDLE_RESERVED',?,?,?)`).bind(
      crypto.randomUUID(), groupId, reqId,
      JSON.stringify({ itemCount: items.length, start: body.start, end: body.end, rentalTotalCents: rentalTotal, depositTotalCents: depositTotal }), nowIso
    ));

  try {
    await db.batch(statements);
  } catch (err) {
    const text = String(err?.message || err).toLowerCase();
    if (text.includes("unique") || text.includes("rental_days")) throw new BundleError("RENTAL_DATES_UNAVAILABLE", 409);
    if (text.includes("rental_group_incomplete")) throw new BundleError("ITEM_UNAVAILABLE", 409);
    if (text.includes("invalid_rental_group_totals")) throw new BundleError("RENTAL_BUNDLE_INTEGRITY_ERROR", 409);
    if (text.includes("no such table") || text.includes("no such column")) throw new BundleError("RENTAL_BUNDLE_MIGRATION_REQUIRED", 503);
    throw err;
  }

  return {
    ok: true,
    rentalGroupId: groupId,
    status: "RESERVED",
    itemCount: items.length,
    start: body.start,
    end: body.end,
    days: quotes[0].days,
    currency: CURRENCY,
    rentalTotalCents: rentalTotal,
    rentalTotal: rentalTotal === null ? null : money(rentalTotal),
    depositTotalCents: depositTotal,
    depositTotal: depositTotal === null ? null : money(depositTotal),
    priceOnRequest: anyPriceOnRequest,
    expiresAt: holdExpires,
    items: responseItems,
  };
}

export async function handleRentalBundle(request, env, url, reqId, origin = null) {
  let key = null;
  try {
    if (request.method === "OPTIONS") {
      if (origin && !ALLOWED_ORIGINS.includes(origin)) return new Response(null, { status: 403, headers: securityHeaders() });
      return new Response(null, { status: 204, headers: { ...securityHeaders(), ...corsHeaders(origin) } });
    }
    if (request.method !== "POST") throw new BundleError("METHOD_NOT_ALLOWED", 405);
    if (origin && !ALLOWED_ORIGINS.includes(origin)) throw new BundleError("ORIGIN_NOT_ALLOWED", 403);
    await rateLimit(request, env);
    const body = await readJson(request);
    await verifyTurnstile(env, request, body);
    key = request.headers.get("Idempotency-Key") || body.idempotencyKey;
    const claimed = await claimIdempotency(env, key, reqId, body);
    if (claimed.replay) return json(claimed.data, claimed.status, origin);

    const ids = normalizeItemIds(body.itemIds);
    const allItems = await loadItems(env);
    const itemMap = new Map((Array.isArray(allItems) ? allItems : []).map(item => [String(item.id), item]));
    const items = ids.map(id => itemMap.get(id));
    if (items.some(item => !item)) throw new BundleError("ITEM_NOT_FOUND", 404);
    if (items.some(item => String(item.public_status || "").toUpperCase() === "SOLD")) throw new BundleError("ITEM_UNAVAILABLE", 409);

    const quotes = items.map(item => {
      try { return rentalQuoteFromItem(item, String(body.start || ""), String(body.end || "")); }
      catch (err) {
        if (err.message === "ITEM_SOLD") throw new BundleError("ITEM_UNAVAILABLE", 409);
        if (err.message === "INVALID_RENTAL_DATES") throw new BundleError("INVALID_RENTAL_DATES", 400);
        throw err;
      }
    });
    if (!quotes.length || quotes[0].days > STANDARD_MAX_DAYS) throw new BundleError("INVALID_RENTAL_DATES", 400);

    requireDb(env);
    await cleanupExpiredBundles(env);
    await ensureInventory(env, items);
    await preflightAvailability(env, items, String(body.start), String(body.end));
    const response = await createAtomicBundle(env, items, quotes, body, key, reqId);
    await finishIdempotency(env, key, 201, response, response.rentalGroupId);
    return json(response, 201, origin);
  } catch (err) {
    await releaseIdempotencyClaim(env, key, reqId);
    if (err instanceof BundleError) return json({ error: err.code, requestId: reqId }, err.status, origin);
    console.error(JSON.stringify({ level: "error", event: "rental_bundle_error", requestId: reqId, message: safeText(err?.message || "unknown", 180) }));
    return json({ error: "INTERNAL_RENTAL_BUNDLE_ERROR", requestId: reqId }, 500, origin);
  }
}

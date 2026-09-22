const GAME_REWARD_SCORE = 20000;
const GAME_SESSION_MIN_MS = 40000;
const GAME_SESSION_TTL_MS = 10 * 60 * 1000;
const GAME_MAX_SCORE = 250000;
const COUPON_PERCENT = 10;
const CURRENCY = "EUR";

const PUBLIC_ORIGINS = new Set([
  "https://disorder119.com",
  "https://www.disorder119.com",
  "http://localhost:8765",
  "http://127.0.0.1:8765",
]);

function cors(origin) {
  const headers = {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Idempotency-Key, X-Turnstile-Token",
    "Access-Control-Max-Age": "600",
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "Vary": "Origin",
  };
  if (PUBLIC_ORIGINS.has(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

function json(data, status = 200, origin = null) {
  return new Response(JSON.stringify(data), { status, headers: cors(origin) });
}

function requireDb(env) {
  if (!env?.DB) throw Object.assign(new Error("GAME_DATABASE_NOT_CONFIGURED"), { publicCode: "GAME_DATABASE_NOT_CONFIGURED", status: 503 });
  return env.DB;
}

async function rateLimit(request, env, scope) {
  if (!env?.RATE_LIMITER || typeof env.RATE_LIMITER.limit !== "function") return;
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const result = await env.RATE_LIMITER.limit({ key: `${scope}:${ip}` });
  if (result && result.success === false) {
    throw Object.assign(new Error("RATE_LIMITED"), { publicCode: "RATE_LIMITED", status: 429 });
  }
}

async function readJson(request) {
  const type = String(request.headers.get("Content-Type") || "").toLowerCase();
  if (!type.includes("application/json")) {
    throw Object.assign(new Error("CONTENT_TYPE_REQUIRED"), { publicCode: "CONTENT_TYPE_REQUIRED", status: 415 });
  }
  try {
    return await request.json();
  } catch {
    throw Object.assign(new Error("INVALID_JSON"), { publicCode: "INVALID_JSON", status: 400 });
  }
}

export function normalizeUsername(value) {
  return String(value == null ? "" : value)
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[^0-9A-Za-zÀ-ÖØ-öø-ÿ._ -]/g, "")
    .slice(0, 18)
    .trim();
}

export function normalizeCouponCode(value) {
  const compact = String(value == null ? "" : value).toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!/^WARP[A-Z0-9]{12}$/.test(compact)) return "";
  return compact;
}

export function discountedCents(originalCents, percentOff = COUPON_PERCENT) {
  const cents = Math.max(0, Math.round(Number(originalCents) || 0));
  const pct = Math.max(0, Math.min(90, Math.round(Number(percentOff) || 0)));
  return Math.max(1, Math.round(cents * (100 - pct) / 100));
}

export function isRewardScore(score) {
  return Number.isFinite(Number(score)) && Math.round(Number(score)) >= GAME_REWARD_SCORE;
}

function money(cents) {
  return (Math.round(cents) / 100).toFixed(2);
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value || "")));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
}

function randomChars(length) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const byte of bytes) out += alphabet[byte % alphabet.length];
  return out;
}

function newCouponCode() {
  const raw = randomChars(12);
  return `WARP-${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
}

async function leaderboard(db, limit = 10) {
  const safeLimit = Math.max(1, Math.min(50, Math.round(Number(limit) || 10)));
  const rows = await db.prepare(
    "SELECT username,score,created_at FROM game_scores ORDER BY score DESC, created_at ASC LIMIT ?"
  ).bind(safeLimit).all();
  return (rows?.results || []).map((row, index) => ({
    rank: index + 1,
    username: String(row.username || ""),
    score: Number(row.score || 0),
    createdAt: row.created_at,
  }));
}

async function createGameSession(request, env, origin) {
  await rateLimit(request, env, "game-session");
  const db = requireDb(env);
  const now = new Date();
  const id = crypto.randomUUID();
  const expiresAt = new Date(now.getTime() + GAME_SESSION_TTL_MS).toISOString();
  await db.prepare(
    "INSERT INTO game_sessions (id,status,started_at,expires_at) VALUES (?,'ACTIVE',?,?)"
  ).bind(id, now.toISOString(), expiresAt).run();
  return json({ ok: true, sessionId: id, rewardScore: GAME_REWARD_SCORE, expiresAt }, 201, origin);
}

async function issueRewardCoupon(db, sessionId, nowIso) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const displayCode = newCouponCode();
    const normalized = normalizeCouponCode(displayCode);
    const hash = await sha256Hex(normalized);
    const id = crypto.randomUUID();
    try {
      await db.prepare(`INSERT INTO coupons
        (id,code_hash,kind,percent_off,source,issued_session_id,status,created_at)
        VALUES (?,?,'PERCENT',?,'WARP_JAGD',?,'ACTIVE',?)`
      ).bind(id, hash, COUPON_PERCENT, sessionId, nowIso).run();
      await db.prepare("UPDATE game_sessions SET reward_issued_at=? WHERE id=?")
        .bind(nowIso, sessionId).run();
      return displayCode;
    } catch (err) {
      if (attempt === 3) throw err;
    }
  }
  return null;
}

async function submitGameScore(request, env, origin) {
  await rateLimit(request, env, "game-score");
  const db = requireDb(env);
  const body = await readJson(request);
  const sessionId = String(body.sessionId || "").trim();
  const username = normalizeUsername(body.username);
  const score = Math.round(Number(body.score));
  if (!/^[0-9a-f-]{36}$/i.test(sessionId)) return json({ error: "INVALID_GAME_SESSION" }, 400, origin);
  if (username.length < 2) return json({ error: "INVALID_USERNAME" }, 400, origin);
  if (!Number.isFinite(score) || score < 0 || score > GAME_MAX_SCORE) return json({ error: "INVALID_SCORE" }, 400, origin);

  const session = await db.prepare("SELECT * FROM game_sessions WHERE id=?").bind(sessionId).first();
  if (!session) return json({ error: "GAME_SESSION_NOT_FOUND" }, 404, origin);
  if (session.status !== "ACTIVE") return json({ error: "GAME_SESSION_ALREADY_SUBMITTED" }, 409, origin);

  const now = new Date();
  const started = new Date(session.started_at);
  const expires = new Date(session.expires_at);
  if (!Number.isFinite(started.getTime()) || now.getTime() - started.getTime() < GAME_SESSION_MIN_MS) {
    return json({ error: "GAME_SESSION_TOO_SHORT" }, 409, origin);
  }
  if (!Number.isFinite(expires.getTime()) || now > expires) {
    await db.prepare("UPDATE game_sessions SET status='EXPIRED' WHERE id=? AND status='ACTIVE'").bind(sessionId).run();
    return json({ error: "GAME_SESSION_EXPIRED" }, 409, origin);
  }

  const nowIso = now.toISOString();
  const claimed = await db.prepare(
    "UPDATE game_sessions SET status='SUBMITTED',submitted_at=? WHERE id=? AND status='ACTIVE'"
  ).bind(nowIso, sessionId).run();
  if (!claimed?.meta?.changes) return json({ error: "GAME_SESSION_ALREADY_SUBMITTED" }, 409, origin);

  await db.prepare(
    "INSERT INTO game_scores (id,session_id,username,score,created_at) VALUES (?,?,?,?,?)"
  ).bind(crypto.randomUUID(), sessionId, username, score, nowIso).run();

  let couponCode = null;
  if (isRewardScore(score)) couponCode = await issueRewardCoupon(db, sessionId, nowIso);

  const higher = await db.prepare("SELECT COUNT(*) AS count FROM game_scores WHERE score>?").bind(score).first();
  const board = await leaderboard(db, 10);
  return json({
    ok: true,
    username,
    score,
    rank: Number(higher?.count || 0) + 1,
    rewardScore: GAME_REWARD_SCORE,
    rewardEligible: Boolean(couponCode),
    couponCode,
    couponPercent: couponCode ? COUPON_PERCENT : null,
    leaderboard: board,
  }, 201, origin);
}

async function cleanupCouponReservation(db, row) {
  if (!row || row.status !== "RESERVED" || !row.reservation_expires_at) return row;
  if (row.reservation_expires_at > new Date().toISOString()) return row;
  await db.prepare(`UPDATE coupons SET status='ACTIVE',reserved_order_id=NULL,reservation_expires_at=NULL
    WHERE id=? AND status='RESERVED' AND reservation_expires_at<=?`)
    .bind(row.id, new Date().toISOString()).run();
  return db.prepare("SELECT * FROM coupons WHERE id=?").bind(row.id).first();
}

async function couponByCode(env, code) {
  const db = requireDb(env);
  const normalized = normalizeCouponCode(code);
  if (!normalized) return null;
  const hash = await sha256Hex(normalized);
  let row = await db.prepare("SELECT * FROM coupons WHERE code_hash=?").bind(hash).first();
  row = await cleanupCouponReservation(db, row);
  return row;
}

async function validateCouponRequest(request, env, origin) {
  await rateLimit(request, env, "coupon-validate");
  const body = await readJson(request);
  const row = await couponByCode(env, body.code);
  const valid = Boolean(row && row.status === "ACTIVE" && Number(row.percent_off) > 0);
  return json({
    ok: true,
    valid,
    percentOff: valid ? Number(row.percent_off) : null,
    source: valid ? String(row.source || "") : null,
  }, 200, origin);
}

export async function couponContextFromCreateRequest(request, env) {
  let body;
  try { body = await request.clone().json(); } catch { return null; }
  const code = normalizeCouponCode(body?.couponCode);
  if (!code) return null;
  const row = await couponByCode(env, code);
  if (!row || row.status !== "ACTIVE") {
    throw Object.assign(new Error("COUPON_INVALID"), { publicCode: "COUPON_INVALID", status: 409 });
  }
  return { id: row.id, percentOff: Number(row.percent_off), source: row.source };
}

function paypalBase(env) {
  return String(env?.PAYPAL_ENVIRONMENT || "sandbox").toLowerCase() === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";
}

async function paypalToken(env) {
  if (!env?.PAYPAL_CLIENT_ID || !env?.PAYPAL_CLIENT_SECRET) throw new Error("paypal_not_configured");
  const auth = btoa(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`);
  const response = await fetch(`${paypalBase(env)}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  if (!response.ok) throw new Error(`paypal_auth_${response.status}`);
  return (await response.json()).access_token;
}

async function patchPaypalAmount(env, providerOrderId, cents, requestSuffix) {
  const token = await paypalToken(env);
  const response = await fetch(`${paypalBase(env)}/v2/checkout/orders/${encodeURIComponent(providerOrderId)}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "PayPal-Request-Id": `coupon-${String(requestSuffix || crypto.randomUUID()).slice(0, 100)}`,
    },
    body: JSON.stringify([{
      op: "replace",
      path: "/purchase_units/@reference_id=='default'/amount",
      value: { currency_code: CURRENCY, value: money(cents) },
    }]),
  });
  if (!response.ok) throw new Error(`paypal_coupon_patch_${response.status}`);
}

async function audit(env, orderId, eventType, reqId, metadata) {
  if (!env?.DB) return;
  try {
    await env.DB.prepare(`INSERT INTO audit_events
      (id,actor_type,entity_type,entity_id,event_type,request_id,metadata_json,created_at)
      VALUES (?,'SYSTEM','order',?,?,?,?,?)`)
      .bind(crypto.randomUUID(), String(orderId), eventType, reqId, JSON.stringify(metadata || {}), new Date().toISOString()).run();
  } catch {}
}

async function cancelCreatedOrder(env, row) {
  const db = requireDb(env);
  const now = new Date().toISOString();
  await db.batch([
    db.prepare("UPDATE payments SET status='CANCELLED',updated_at=? WHERE order_id=? AND status='CREATED'").bind(now, row.order_id),
    db.prepare("UPDATE commerce_orders SET status='CANCELLED',updated_at=? WHERE id=? AND status IN ('RESERVED','PAYMENT_PENDING')").bind(now, row.order_id),
    db.prepare("UPDATE reservations SET status='CANCELLED',updated_at=? WHERE id=? AND status='RESERVED'").bind(now, row.reservation_id),
    db.prepare(`UPDATE inventory SET status='AVAILABLE',updated_at=?,version=version+1
      WHERE id=? AND status='PAYMENT_PENDING'`).bind(now, row.inventory_id),
  ]);
}

export async function applyCouponToCreatedOrder(env, coupon, createResult, reqId) {
  if (!coupon || !createResult?.orderId) return null;
  const db = requireDb(env);
  const row = await db.prepare(`SELECT o.id AS order_id,o.reservation_id,o.subtotal_cents,o.shipping_cents,o.total_cents,
      oi.inventory_id,oi.unit_price_cents,p.id AS payment_id,p.provider_order_id,p.amount_cents,r.expires_at
    FROM commerce_orders o
    JOIN order_items oi ON oi.order_id=o.id
    JOIN payments p ON p.order_id=o.id AND p.provider='PAYPAL'
    JOIN reservations r ON r.id=o.reservation_id
    WHERE o.id=? LIMIT 1`).bind(String(createResult.orderId)).first();
  if (!row || !row.provider_order_id) throw new Error("coupon_order_not_found");

  const original = Number(row.unit_price_cents || row.subtotal_cents || 0);
  if (!Number.isFinite(original) || original <= 0) throw new Error("coupon_order_amount_invalid");
  const discounted = discountedCents(original, coupon.percentOff);
  const discount = original - discounted;
  const total = discounted + Math.max(0, Number(row.shipping_cents || 0));

  const reserved = await db.prepare(`UPDATE coupons
    SET status='RESERVED',reserved_order_id=?,reservation_expires_at=?
    WHERE id=? AND status='ACTIVE'`)
    .bind(row.order_id, row.expires_at, coupon.id).run();
  if (!reserved?.meta?.changes) {
    await cancelCreatedOrder(env, row);
    throw Object.assign(new Error("COUPON_IN_USE"), { publicCode: "COUPON_IN_USE", status: 409 });
  }

  try {
    await patchPaypalAmount(env, row.provider_order_id, total, reqId);
    const now = new Date().toISOString();
    await db.batch([
      db.prepare("UPDATE commerce_orders SET subtotal_cents=?,total_cents=?,updated_at=? WHERE id=?")
        .bind(discounted, total, now, row.order_id),
      db.prepare("UPDATE order_items SET unit_price_cents=? WHERE order_id=?")
        .bind(discounted, row.order_id),
      db.prepare("UPDATE payments SET amount_cents=?,updated_at=? WHERE id=?")
        .bind(total, now, row.payment_id),
      db.prepare(`INSERT INTO coupon_redemptions
        (id,coupon_id,order_id,original_amount_cents,discount_cents,discounted_amount_cents,created_at)
        VALUES (?,?,?,?,?,?,?)`)
        .bind(crypto.randomUUID(), coupon.id, row.order_id, original, discount, total, now),
    ]);
    await audit(env, row.order_id, "COUPON_RESERVED", reqId, { percentOff: coupon.percentOff, discountCents: discount, totalCents: total, source: coupon.source });
    return { applied: true, percentOff: coupon.percentOff, discountCents: discount, totalCents: total };
  } catch (err) {
    try { await patchPaypalAmount(env, row.provider_order_id, Number(row.total_cents), `${reqId}-rollback`); } catch {}
    await db.prepare(`UPDATE coupons SET status='ACTIVE',reserved_order_id=NULL,reservation_expires_at=NULL
      WHERE id=? AND status='RESERVED' AND reserved_order_id=?`).bind(coupon.id, row.order_id).run();
    await cancelCreatedOrder(env, row);
    throw err;
  }
}

export async function finalizeCouponForOrder(env, orderId, reqId) {
  if (!env?.DB || !orderId) return;
  const db = env.DB;
  const now = new Date().toISOString();
  const coupon = await db.prepare("SELECT id FROM coupons WHERE reserved_order_id=? AND status='RESERVED'")
    .bind(String(orderId)).first();
  if (!coupon) return;
  await db.batch([
    db.prepare(`UPDATE coupons SET status='REDEEMED',redeemed_order_id=?,redeemed_at=?,reservation_expires_at=NULL
      WHERE id=? AND status='RESERVED' AND reserved_order_id=?`).bind(String(orderId), now, coupon.id, String(orderId)),
    db.prepare("UPDATE coupon_redemptions SET redeemed_at=? WHERE coupon_id=? AND order_id=?")
      .bind(now, coupon.id, String(orderId)),
  ]);
  await audit(env, orderId, "COUPON_REDEEMED", reqId, { couponId: coupon.id });
}

export async function handleGameRewards(request, env, url, reqId, origin) {
  try {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
    if (url.pathname === "/game/session" && request.method === "POST") return await createGameSession(request, env, origin);
    if (url.pathname === "/game/leaderboard" && request.method === "GET") {
      await rateLimit(request, env, "game-leaderboard");
      const board = await leaderboard(requireDb(env), url.searchParams.get("limit") || 10);
      return json({ ok: true, rewardScore: GAME_REWARD_SCORE, leaderboard: board }, 200, origin);
    }
    if (url.pathname === "/game/score" && request.method === "POST") return await submitGameScore(request, env, origin);
    if (url.pathname === "/coupon/validate" && request.method === "POST") return await validateCouponRequest(request, env, origin);
    return json({ error: "NOT_FOUND" }, 404, origin);
  } catch (err) {
    console.error(JSON.stringify({ level: "error", event: "game_rewards_error", requestId: reqId, message: String(err?.message || err).slice(0, 160) }));
    return json({ error: err?.publicCode || "GAME_REWARDS_ERROR", requestId: reqId }, err?.status || 500, origin);
  }
}

export { GAME_REWARD_SCORE, COUPON_PERCENT };

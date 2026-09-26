const ALLOWED_ORIGINS = new Set([
  "https://disorder119.com",
  "https://www.disorder119.com",
  "https://admin.disorder119.com",
  "http://localhost:8765",
  "http://127.0.0.1:8765",
]);

export const GAME_VERSION = "archive-raid-v3";
export const GAME_RULES = Object.freeze({
  // Keep the stable "warp" database id because the deployed D1 schema allows
  // warp/signal/memory. The public game itself is now only ARCHIVE RAID 119.
  warp: Object.freeze({ target: 48000, minDurationMs: 35000, maxDurationMs: 70000, maxScore: 150000 }),
});

const RUN_TTL_MS = 12 * 60 * 1000;
const COUPON_RESERVATION_MS = 22 * 60 * 1000;
const DISCOUNT_BPS = 1000;
const MAX_BODY_BYTES = 24 * 1024;

export class GameRewardError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

export function normalizeGame(value) {
  const game = String(value || "").trim().toLowerCase();
  if (["warp", "raid", "archive", "archive-raid", "signal", "memory"].includes(game)) return "warp";
  return "";
}

export function normalizeUsername(value) {
  const name = String(value || "").trim().replace(/\s+/g, " ").slice(0, 16);
  if (name.length < 3 || name.length > 16) return "";
  try {
    if (!/^[\p{L}\p{N}._ -]+$/u.test(name)) return "";
  } catch {
    if (!/^[A-Za-z0-9._ -]+$/.test(name)) return "";
  }
  return name;
}

export function normalizeCouponCode(value) {
  const code = String(value || "").trim().toUpperCase().replace(/\s+/g, "");
  return /^D119-10-[A-Z0-9]{10}$/.test(code) ? code : "";
}

export function discountForSubtotal(subtotalCents, discountBps = DISCOUNT_BPS) {
  const subtotal = Math.max(0, Math.round(Number(subtotalCents) || 0));
  const bps = Math.max(0, Math.min(10000, Math.round(Number(discountBps) || 0)));
  const discountCents = Math.min(subtotal, Math.round(subtotal * bps / 10000));
  return {
    subtotalCents: subtotal,
    discountBps: bps,
    discountCents,
    totalCents: Math.max(1, subtotal - discountCents),
  };
}

export function scoreIsPlausible(game, score, durationMs) {
  const rule = GAME_RULES[normalizeGame(game)];
  const value = Math.round(Number(score));
  const duration = Math.round(Number(durationMs));
  return Boolean(
    rule &&
    Number.isFinite(value) &&
    Number.isFinite(duration) &&
    value >= 0 &&
    value <= rule.maxScore &&
    duration >= rule.minDurationMs &&
    duration <= rule.maxDurationMs
  );
}

export function qualifiedScore(game, score) {
  const rule = GAME_RULES[normalizeGame(game)];
  return Boolean(rule && Number(score) >= rule.target);
}

function requireDb(env) {
  if (!env?.DB) throw new GameRewardError("GAME_DATABASE_NOT_CONFIGURED", 503);
  return env.DB;
}

function allowedOrigin(origin) {
  return Boolean(origin && ALLOWED_ORIGINS.has(origin));
}

function headers(origin) {
  const out = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Vary": "Origin",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  };
  if (allowedOrigin(origin)) out["Access-Control-Allow-Origin"] = origin;
  return out;
}

function json(data, status = 200, origin = null) {
  return new Response(JSON.stringify(data), { status, headers: headers(origin) });
}

async function readJson(request) {
  const type = String(request.headers.get("Content-Type") || "").toLowerCase();
  if (!type.includes("application/json")) throw new GameRewardError("CONTENT_TYPE_REQUIRED", 415);
  const declared = Number(request.headers.get("Content-Length") || 0);
  if (declared > MAX_BODY_BYTES) throw new GameRewardError("REQUEST_TOO_LARGE", 413);
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) throw new GameRewardError("REQUEST_TOO_LARGE", 413);
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    throw new GameRewardError("INVALID_JSON", 400);
  }
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value || "")));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

function randomToken(bytes = 24) {
  const data = new Uint8Array(bytes);
  crypto.getRandomValues(data);
  return Array.from(data, byte => byte.toString(16).padStart(2, "0")).join("");
}

function makeCouponCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const data = new Uint8Array(10);
  crypto.getRandomValues(data);
  let suffix = "";
  for (const byte of data) suffix += alphabet[byte % alphabet.length];
  return `D119-10-${suffix}`;
}

async function timingSafeHashMatch(plain, expectedHash) {
  const actual = await sha256Hex(plain);
  const a = new TextEncoder().encode(actual);
  const b = new TextEncoder().encode(String(expectedHash || ""));
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function rateLimit(request, env, scope) {
  if (!env?.RATE_LIMITER || typeof env.RATE_LIMITER.limit !== "function") return;
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const result = await env.RATE_LIMITER.limit({ key: `games:${scope}:${ip}` });
  if (result && result.success === false) throw new GameRewardError("RATE_LIMITED", 429);
}

async function leaderboard(env, game, limit = 10) {
  const db = requireDb(env);
  const safeLimit = Math.max(1, Math.min(20, Math.round(Number(limit) || 10)));
  // v3 starts a clean leaderboard even though D1 keeps historical warp scores.
  const result = await db.prepare(`SELECT username, score, created_at AS createdAt
    FROM game_scores
    WHERE game_id=? AND detail_json LIKE ?
    ORDER BY score DESC, duration_ms ASC, created_at ASC LIMIT ?`)
    .bind(game, `%"version":"${GAME_VERSION}"%`, safeLimit).all();
  return result.results || [];
}

async function startRun(request, env, origin) {
  await rateLimit(request, env, "start");
  const body = await readJson(request);
  const game = normalizeGame(body.game);
  if (!game) throw new GameRewardError("INVALID_GAME", 400);

  const db = requireDb(env);
  const runId = crypto.randomUUID();
  const token = randomToken(24);
  const nowMs = Date.now();
  const startedAt = new Date(nowMs).toISOString();
  const expiresAt = new Date(nowMs + RUN_TTL_MS).toISOString();

  await db.prepare(`INSERT INTO game_runs (id,run_token_hash,game_id,started_at,expires_at)
    VALUES (?,?,?,?,?)`)
    .bind(runId, await sha256Hex(token), game, startedAt, expiresAt).run();

  return json({ runId, runToken: token, game, startedAt: nowMs, expiresAt }, 201, origin);
}

// Einmaliger 10-%-Code. Auch der Newsletter vergibt seine Codes hierueber
// (ohne Spiel und Punktestand), damit Warenkorb und Checkout nur eine Sorte
// Gutschein kennen.
export async function issueRewardCoupon(db, { game = null, scoreId = null, usernameKey = null } = {}) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = makeCouponCode();
    const hash = await sha256Hex(code);
    const id = crypto.randomUUID();
    try {
      await db.prepare(`INSERT INTO reward_coupons
        (id,code_hash,code_hint,discount_bps,source_game,source_score_id,username_key,status,created_at)
        VALUES (?,?,?,?,?,?,?,'ACTIVE',?)`)
        .bind(
          id,
          hash,
          code.slice(-4),
          DISCOUNT_BPS,
          game,
          scoreId,
          usernameKey,
          new Date().toISOString(),
        ).run();
      return { id, code, hint: code.slice(-4) };
    } catch (error) {
      if (!String(error?.message || error).toLowerCase().includes("unique")) throw error;
    }
  }
  throw new GameRewardError("COUPON_ISSUE_FAILED", 503);
}

async function issueCoupon(db, game, scoreId, usernameKey) {
  return (await issueRewardCoupon(db, { game, scoreId, usernameKey })).code;
}

async function submitScore(request, env, origin) {
  await rateLimit(request, env, "score");
  const body = await readJson(request);
  const game = normalizeGame(body.game);
  const username = normalizeUsername(body.username);
  const runId = String(body.runId || "").trim();
  const runToken = String(body.runToken || "").trim();
  const score = Math.round(Number(body.score));
  const durationMs = Math.round(Number(body.durationMs));
  const detail = body.detail && typeof body.detail === "object" && !Array.isArray(body.detail) ? body.detail : {};

  if (!game) throw new GameRewardError("INVALID_GAME", 400);
  if (!username) throw new GameRewardError("INVALID_USERNAME", 400);
  if (!runId || !runToken) throw new GameRewardError("RUN_REQUIRED", 400);
  if (String(detail.version || "") !== GAME_VERSION) throw new GameRewardError("GAME_VERSION_REQUIRED", 409);
  if (!scoreIsPlausible(game, score, durationMs)) throw new GameRewardError("IMPLAUSIBLE_SCORE", 400);

  const db = requireDb(env);
  const run = await db.prepare("SELECT * FROM game_runs WHERE id=?").bind(runId).first();
  if (!run || run.game_id !== game) throw new GameRewardError("RUN_NOT_FOUND", 404);
  if (run.submitted_at) throw new GameRewardError("RUN_ALREADY_SUBMITTED", 409);
  if (run.expires_at <= new Date().toISOString()) throw new GameRewardError("RUN_EXPIRED", 409);
  if (!(await timingSafeHashMatch(runToken, run.run_token_hash))) throw new GameRewardError("RUN_TOKEN_INVALID", 403);

  const serverElapsed = Date.now() - Date.parse(run.started_at);
  if (
    !Number.isFinite(serverElapsed) ||
    serverElapsed < Math.max(GAME_RULES[game].minDurationMs, durationMs * 0.7) ||
    serverElapsed > RUN_TTL_MS
  ) {
    throw new GameRewardError("RUN_TIMING_INVALID", 409);
  }

  const detailJson = JSON.stringify(detail).slice(0, 1200);
  const scoreId = crypto.randomUUID();
  const usernameKey = username.toLocaleLowerCase("de-DE");
  const submittedAt = new Date().toISOString();

  try {
    await db.batch([
      db.prepare(`INSERT INTO game_scores
        (id,run_id,game_id,username,username_key,score,duration_ms,detail_json,created_at)
        VALUES (?,?,?,?,?,?,?,?,?)`)
        .bind(scoreId, runId, game, username, usernameKey, score, durationMs, detailJson, submittedAt),
      db.prepare("UPDATE game_runs SET submitted_at=? WHERE id=? AND submitted_at IS NULL")
        .bind(submittedAt, runId),
    ]);
  } catch (error) {
    if (String(error?.message || error).toLowerCase().includes("unique")) {
      throw new GameRewardError("RUN_ALREADY_SUBMITTED", 409);
    }
    throw error;
  }

  const qualified = qualifiedScore(game, score);
  const couponCode = qualified ? await issueCoupon(db, game, scoreId, usernameKey) : "";
  return json({
    ok: true,
    gameTitle: "ARCHIVE RAID 119",
    version: GAME_VERSION,
    qualified,
    target: GAME_RULES[game].target,
    couponCode,
    discountPercent: couponCode ? 10 : 0,
    leaderboard: await leaderboard(env, game, 10),
  }, 201, origin);
}

async function getLeaderboard(request, env, url, origin) {
  await rateLimit(request, env, "leaderboard");
  const game = normalizeGame(url.searchParams.get("game"));
  if (!game) throw new GameRewardError("INVALID_GAME", 400);
  return json({
    game,
    gameTitle: "ARCHIVE RAID 119",
    version: GAME_VERSION,
    target: GAME_RULES[game].target,
    scores: await leaderboard(env, game, url.searchParams.get("limit")),
  }, 200, origin);
}

export async function findValidCoupon(env, value) {
  const code = normalizeCouponCode(value);
  if (!code) return null;
  const db = requireDb(env);
  const hash = await sha256Hex(code);
  const row = await db.prepare("SELECT * FROM reward_coupons WHERE code_hash=? LIMIT 1").bind(hash).first();
  if (!row || row.status === "REDEEMED" || row.status === "VOID") return null;
  const nowIso = new Date().toISOString();
  if (row.status === "RESERVED" && row.reserved_until && row.reserved_until > nowIso) return null;
  return row;
}

async function validateCoupon(request, env, origin) {
  await rateLimit(request, env, "coupon");
  const body = await readJson(request);
  const row = await findValidCoupon(env, body.code);
  if (!row) return json({ valid: false }, 200, origin);
  return json({ valid: true, discountPercent: row.discount_bps / 100, oneTime: true }, 200, origin);
}

export async function claimCouponForOrder(env, value, orderId, subtotalCents) {
  const code = normalizeCouponCode(value);
  if (!code) return null;
  const db = requireDb(env);
  const hash = await sha256Hex(code);
  const nowDate = new Date();
  const nowIso = nowDate.toISOString();
  const reservedUntil = new Date(nowDate.getTime() + COUPON_RESERVATION_MS).toISOString();

  await db.prepare(`UPDATE reward_coupons
    SET status='ACTIVE',reserved_order_id=NULL,reserved_until=NULL
    WHERE status='RESERVED' AND reserved_until<=?`).bind(nowIso).run();

  const result = await db.prepare(`UPDATE reward_coupons
    SET status='RESERVED',reserved_order_id=?,reserved_until=?
    WHERE code_hash=? AND status='ACTIVE'`)
    .bind(String(orderId), reservedUntil, hash).run();

  if (!result.meta?.changes) throw new GameRewardError("COUPON_INVALID_OR_USED", 409);

  const row = await db.prepare("SELECT * FROM reward_coupons WHERE code_hash=?").bind(hash).first();
  const money = discountForSubtotal(subtotalCents, row.discount_bps);
  return { couponId: row.id, orderId: String(orderId), ...money };
}

export async function releaseCouponClaim(env, couponId, orderId) {
  if (!env?.DB || !couponId || !orderId) return;
  await env.DB.prepare(`UPDATE reward_coupons
    SET status='ACTIVE',reserved_order_id=NULL,reserved_until=NULL
    WHERE id=? AND status='RESERVED' AND reserved_order_id=?`)
    .bind(String(couponId), String(orderId)).run();
}

export async function redeemCouponForOrder(env, orderId) {
  if (!env?.DB || !orderId) return;
  const nowIso = new Date().toISOString();
  await env.DB.prepare(`UPDATE reward_coupons
    SET status='REDEEMED',redeemed_order_id=?,redeemed_at=?,reserved_until=NULL
    WHERE status='RESERVED' AND reserved_order_id=?`)
    .bind(String(orderId), nowIso, String(orderId)).run();
}

export function isGameRewardsRoute(pathname) {
  return pathname === "/games/start" ||
    pathname === "/games/score" ||
    pathname === "/games/leaderboard" ||
    pathname === "/coupons/validate";
}

export async function handleGameRewards(
  request,
  env,
  url = new URL(request.url),
  requestId = "",
  origin = request.headers.get("Origin"),
) {
  if (request.method === "OPTIONS") {
    if (origin && !allowedOrigin(origin)) return new Response(null, { status: 403 });
    const preflight = new Headers(headers(origin));
    preflight.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    preflight.set("Access-Control-Allow-Headers", "Content-Type");
    preflight.set("Access-Control-Max-Age", "600");
    preflight.delete("Content-Type");
    return new Response(null, { status: 204, headers: preflight });
  }

  if (origin && !allowedOrigin(origin)) {
    return json({ error: "ORIGIN_NOT_ALLOWED", requestId }, 403, origin);
  }

  try {
    if (url.pathname === "/games/start" && request.method === "POST") return startRun(request, env, origin);
    if (url.pathname === "/games/score" && request.method === "POST") return submitScore(request, env, origin);
    if (url.pathname === "/games/leaderboard" && request.method === "GET") return getLeaderboard(request, env, url, origin);
    if (url.pathname === "/coupons/validate" && request.method === "POST") return validateCoupon(request, env, origin);
    return json({ error: "METHOD_NOT_ALLOWED", requestId }, 405, origin);
  } catch (error) {
    if (error instanceof GameRewardError) {
      return json({ error: error.code, requestId }, error.status, origin);
    }
    console.error(JSON.stringify({
      level: "error",
      event: "game_reward_error",
      requestId,
      message: String(error?.message || error).slice(0, 160),
    }));
    return json({ error: "GAME_REWARD_ERROR", requestId }, 500, origin);
  }
}

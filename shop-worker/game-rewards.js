export const UNIVERSE_REWARD_SCORE = 19119;
export const UNIVERSE_GAME_SECONDS = 45;
export const UNIVERSE_COUPON_PERCENT = 10;
export const UNIVERSE_SCORE_MAX = 250000;

const ALLOWED_ORIGINS = new Set([
  "https://disorder119.com",
  "https://www.disorder119.com",
  "http://localhost:8765",
  "http://127.0.0.1:8765",
  "http://127.0.0.1:4173",
]);

class GameRewardError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
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

function response(data, status, origin) {
  return new Response(JSON.stringify(data), { status, headers: headers(origin) });
}

async function readJson(request) {
  if (!(request.headers.get("Content-Type") || "").toLowerCase().includes("application/json")) {
    throw new GameRewardError("CONTENT_TYPE_REQUIRED", 415);
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > 8192) throw new GameRewardError("REQUEST_TOO_LARGE", 413);
  try { return text ? JSON.parse(text) : {}; }
  catch { throw new GameRewardError("INVALID_JSON", 400); }
}

async function rateLimit(request, env, scope) {
  if (!env.RATE_LIMITER || typeof env.RATE_LIMITER.limit !== "function") return;
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const result = await env.RATE_LIMITER.limit({ key: `universe:${scope}:${ip}` });
  if (result && result.success === false) throw new GameRewardError("RATE_LIMITED", 429);
}

function requireDb(env) {
  if (!env.DB) throw new GameRewardError("LEADERBOARD_NOT_CONFIGURED", 503);
  return env.DB;
}

export function normalizeUniverseUsername(value) {
  const username = String(value || "").trim();
  if (!/^[A-Za-z0-9_-]{2,16}$/.test(username)) return null;
  return username;
}

export function normalizeCouponCode(value) {
  const code = String(value || "").trim().toUpperCase().replace(/\s+/g, "");
  return /^WARP10-[A-Z0-9]{8}$/.test(code) ? code : null;
}

export function couponDiscountCents(subtotalCents, percent = UNIVERSE_COUPON_PERCENT) {
  const subtotal = Math.max(0, Math.round(Number(subtotalCents) || 0));
  const pct = Math.min(100, Math.max(0, Math.round(Number(percent) || 0)));
  return Math.min(subtotal, Math.round(subtotal * pct / 100));
}

function randomCouponCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let suffix = "";
  for (const byte of bytes) suffix += alphabet[byte % alphabet.length];
  return `WARP10-${suffix}`;
}

async function createGameRun(env) {
  const db = requireDb(env);
  const id = crypto.randomUUID();
  const now = new Date();
  const expires = new Date(now.getTime() + 120000);
  await db.prepare(`INSERT INTO game_runs (id,started_at,expires_at,created_at) VALUES (?,?,?,?)`)
    .bind(id, now.toISOString(), expires.toISOString(), now.toISOString()).run();
  return {
    runId: id,
    rewardScore: UNIVERSE_REWARD_SCORE,
    durationSeconds: UNIVERSE_GAME_SECONDS,
    expiresAt: expires.toISOString(),
  };
}

async function leaderboard(env, url) {
  const db = requireDb(env);
  const requested = Number(url.searchParams.get("limit") || 20);
  const limit = Math.max(1, Math.min(50, Number.isFinite(requested) ? Math.floor(requested) : 20));
  const rows = await db.prepare(`SELECT username,score,created_at AS createdAt
    FROM game_scores ORDER BY score DESC, created_at ASC LIMIT ?`).bind(limit).all();
  return (rows.results || []).map((row, index) => ({
    rank: index + 1,
    username: row.username,
    score: Number(row.score || 0),
    createdAt: row.createdAt,
  }));
}

async function couponForRun(db, runId) {
  return db.prepare(`SELECT code,percent_off AS percentOff,expires_at AS expiresAt
    FROM coupons WHERE source_run_id=? AND status IN ('ISSUED','RESERVED') LIMIT 1`).bind(runId).first();
}

async function issueCoupon(db, runId, username, score, nowIso) {
  const existing = await couponForRun(db, runId);
  if (existing) return existing;
  const expiresAt = new Date(Date.parse(nowIso) + 90 * 24 * 60 * 60 * 1000).toISOString();
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomCouponCode();
    try {
      await db.prepare(`INSERT INTO coupons
        (code,percent_off,status,source,source_run_id,username,score,issued_at,expires_at)
        VALUES (?,10,'ISSUED','UNIVERSE_WARP_HUNT',?,?,?,?,?)`)
        .bind(code, runId, username, score, nowIso, expiresAt).run();
      return { code, percentOff: UNIVERSE_COUPON_PERCENT, expiresAt };
    } catch (err) {
      const after = await couponForRun(db, runId);
      if (after) return after;
      if (attempt === 4) throw err;
    }
  }
  throw new Error("coupon_issue_failed");
}

async function submitScore(env, body) {
  const db = requireDb(env);
  const runId = String(body?.runId || "").trim();
  const username = normalizeUniverseUsername(body?.username);
  const score = Number(body?.score);
  if (!/^[0-9a-f-]{36}$/i.test(runId)) throw new GameRewardError("INVALID_RUN", 400);
  if (!username) throw new GameRewardError("INVALID_USERNAME", 400);
  if (!Number.isInteger(score) || score < 0 || score > UNIVERSE_SCORE_MAX) throw new GameRewardError("INVALID_SCORE", 400);

  const run = await db.prepare("SELECT * FROM game_runs WHERE id=?").bind(runId).first();
  if (!run) throw new GameRewardError("RUN_NOT_FOUND", 404);
  const nowMs = Date.now();
  const elapsedMs = nowMs - Date.parse(run.started_at);
  if (!Number.isFinite(elapsedMs) || elapsedMs < 35000) throw new GameRewardError("RUN_TOO_FAST", 409);
  if (nowMs > Date.parse(run.expires_at) || elapsedMs > 120000) throw new GameRewardError("RUN_EXPIRED", 409);

  const nowIso = new Date(nowMs).toISOString();
  const scoreId = crypto.randomUUID();
  const rewardEarned = score >= UNIVERSE_REWARD_SCORE ? 1 : 0;
  const inserted = await db.prepare(`INSERT OR IGNORE INTO game_scores
    (id,run_id,username,score,reward_earned,created_at) VALUES (?,?,?,?,?,?)`)
    .bind(scoreId, runId, username, score, rewardEarned, nowIso).run();

  let finalUsername = username;
  let finalScore = score;
  let finalReward = rewardEarned;
  if (!inserted.meta?.changes) {
    const existing = await db.prepare("SELECT username,score,reward_earned FROM game_scores WHERE run_id=?").bind(runId).first();
    if (!existing) throw new GameRewardError("RUN_ALREADY_SUBMITTED", 409);
    finalUsername = existing.username;
    finalScore = Number(existing.score || 0);
    finalReward = Number(existing.reward_earned || 0);
  } else {
    await db.prepare(`UPDATE game_runs SET submitted_at=?,username=?,score=?,reward_earned=? WHERE id=?`)
      .bind(nowIso, username, score, rewardEarned, runId).run();
  }

  let coupon = null;
  if (finalReward) coupon = await issueCoupon(db, runId, finalUsername, finalScore, nowIso);

  const rankRow = await db.prepare(`SELECT COUNT(*) + 1 AS rank FROM game_scores
    WHERE score > ? OR (score = ? AND created_at < (SELECT created_at FROM game_scores WHERE run_id=?))`)
    .bind(finalScore, finalScore, runId).first();

  return {
    ok: true,
    username: finalUsername,
    score: finalScore,
    rank: Number(rankRow?.rank || 1),
    rewardScore: UNIVERSE_REWARD_SCORE,
    rewardEarned: Boolean(finalReward),
    coupon,
  };
}

async function validateCoupon(env, body) {
  const db = requireDb(env);
  const code = normalizeCouponCode(body?.code);
  if (!code) throw new GameRewardError("INVALID_COUPON", 400);
  const now = new Date().toISOString();
  await db.prepare("UPDATE coupons SET status='EXPIRED' WHERE code=? AND status='ISSUED' AND expires_at<=?")
    .bind(code, now).run();
  const row = await db.prepare(`SELECT code,percent_off AS percentOff,expires_at AS expiresAt,status
    FROM coupons WHERE code=?`).bind(code).first();
  if (!row || row.status !== "ISSUED" || row.expiresAt <= now) throw new GameRewardError("COUPON_NOT_VALID", 404);
  return { ok: true, code: row.code, percentOff: Number(row.percentOff), expiresAt: row.expiresAt };
}

export function isGameRewardsRoute(pathname) {
  return pathname === "/game/start" || pathname === "/game/submit" || pathname === "/game/leaderboard" || pathname === "/coupons/validate";
}

export async function handleGameRewards(request, env, url, reqId, origin) {
  if (!isGameRewardsRoute(url.pathname)) return null;
  try {
    if (request.method === "OPTIONS") {
      if (origin && !allowedOrigin(origin)) return response({ error: "ORIGIN_NOT_ALLOWED", requestId: reqId }, 403, origin);
      const h = headers(origin);
      h["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
      h["Access-Control-Allow-Headers"] = "Content-Type";
      h["Access-Control-Max-Age"] = "600";
      return new Response(null, { status: 204, headers: h });
    }

    if (request.method !== "GET" && !allowedOrigin(origin)) throw new GameRewardError("ORIGIN_NOT_ALLOWED", 403);
    if (url.pathname === "/game/start" && request.method === "POST") {
      await rateLimit(request, env, "start");
      return response(await createGameRun(env), 201, origin);
    }
    if (url.pathname === "/game/submit" && request.method === "POST") {
      await rateLimit(request, env, "submit");
      return response(await submitScore(env, await readJson(request)), 200, origin);
    }
    if (url.pathname === "/game/leaderboard" && request.method === "GET") {
      await rateLimit(request, env, "leaderboard");
      return response({ rewardScore: UNIVERSE_REWARD_SCORE, scores: await leaderboard(env, url) }, 200, origin);
    }
    if (url.pathname === "/coupons/validate" && request.method === "POST") {
      await rateLimit(request, env, "coupon");
      return response(await validateCoupon(env, await readJson(request)), 200, origin);
    }
    throw new GameRewardError("METHOD_NOT_ALLOWED", 405);
  } catch (err) {
    if (err instanceof GameRewardError) return response({ error: err.code, requestId: reqId }, err.status, origin);
    console.error(JSON.stringify({ level: "error", event: "game_rewards_error", requestId: reqId, message: String(err?.message || err || "unknown").slice(0,160) }));
    return response({ error: "GAME_REWARDS_INTERNAL_ERROR", requestId: reqId }, 500, origin);
  }
}

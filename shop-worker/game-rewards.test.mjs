import test from "node:test";
import assert from "node:assert/strict";
import {
  GAME_RULES,
  GAME_VERSION,
  discountForSubtotal,
  normalizeCouponCode,
  normalizeGame,
  normalizeUsername,
  qualifiedScore,
  scoreIsPlausible,
} from "./game-rewards.js";

test("Archive Raid is the single public reward game with a hard target", () => {
  assert.equal(GAME_VERSION, "archive-raid-v3");
  assert.equal(normalizeGame("WARP"), "warp");
  assert.equal(normalizeGame("raid"), "warp");
  assert.equal(normalizeGame("signal"), "warp");
  assert.equal(normalizeGame("memory"), "warp");
  assert.equal(normalizeGame("unknown"), "");
  assert.deepEqual(Object.keys(GAME_RULES), ["warp"]);
  assert.equal(GAME_RULES.warp.target, 48000);
  assert.equal(GAME_RULES.warp.maxScore, 150000);
});

test("public usernames are bounded and reject markup", () => {
  assert.equal(normalizeUsername("  archive_119  "), "archive_119");
  assert.equal(normalizeUsername("ab"), "");
  assert.equal(normalizeUsername("<script>alert(1)</script>"), "");
  assert.equal(normalizeUsername("Jean Paul"), "Jean Paul");
});

test("Archive Raid scores need full-run timing and bounded values", () => {
  assert.equal(scoreIsPlausible("warp", 52000, 42000), true);
  assert.equal(scoreIsPlausible("raid", 48000, 35000), true);
  assert.equal(scoreIsPlausible("warp", 52000, 1000), false);
  assert.equal(scoreIsPlausible("warp", 999999, 42000), false);
  assert.equal(qualifiedScore("warp", 47999), false);
  assert.equal(qualifiedScore("warp", 48000), true);
});

test("10 percent coupon calculation never trusts floating browser prices", () => {
  assert.deepEqual(discountForSubtotal(28000, 1000), {
    subtotalCents: 28000,
    discountBps: 1000,
    discountCents: 2800,
    totalCents: 25200,
  });
  assert.equal(discountForSubtotal(1, 1000).totalCents, 1);
});

test("only server reward code format is accepted", () => {
  assert.equal(normalizeCouponCode(" d119-10-abc234def5 "), "D119-10-ABC234DEF5");
  assert.equal(normalizeCouponCode("D11910-WAR-LOCAL1"), "");
  assert.equal(normalizeCouponCode("SAVE10"), "");
});

// ------------------------------------------------------------------ HTTP gegen echte Migrationen

import { createHash } from "node:crypto";
import workerEntry from "./worker-entry.js";
import { handleGameRewards, SPIEL_CODES_JE_ANSCHLUSS } from "./game-rewards.js";
import { allMigrations, sqliteD1 } from "./test-d1.mjs";

const SHOP = "https://disorder119.com";

// Ein Lauf, der vor 45 Sekunden gestartet wurde - wie nach einer echten Runde.
function laufAnlegen(DB) {
  const id = crypto.randomUUID();
  const token = crypto.randomUUID().replace(/-/g, "");
  DB.raw.prepare("INSERT INTO game_runs (id,run_token_hash,game_id,started_at,expires_at) VALUES (?,?,?,?,?)")
    .run(id, createHash("sha256").update(token).digest("hex"), "warp",
      new Date(Date.now() - 45000).toISOString(), new Date(Date.now() + 600000).toISOString());
  return { id, token };
}

async function punkte(env, { ip = "192.0.2.10", origin = SHOP, score = 52000, name = "Spieler119" } = {}) {
  const lauf = laufAnlegen(env.DB);
  const headers = { "Content-Type": "application/json", "CF-Connecting-IP": ip };
  if (origin) headers.Origin = origin;
  const request = new Request("https://api.disorder119.com/games/score", {
    method: "POST",
    headers,
    body: JSON.stringify({ game: "warp", username: name, runId: lauf.id, runToken: lauf.token, score, durationMs: 40000, detail: { version: GAME_VERSION } }),
  });
  const response = await handleGameRewards(request, env, new URL(request.url), "req-spiel", origin);
  return { status: response.status, data: await response.json() };
}

test("leaderboard without a valid game answers 400 INVALID_GAME instead of 500", async () => {
  const DB = sqliteD1(allMigrations());
  for (const query of ["", "?game=", "?game=tetris"]) {
    const response = await workerEntry.fetch(new Request(`https://api.disorder119.com/games/leaderboard${query}`, { headers: { Origin: SHOP } }), { DB }, { waitUntil() {} });
    assert.equal(response.status, 400, query);
    assert.equal((await response.json()).error, "INVALID_GAME");
  }
  const ok = await workerEntry.fetch(new Request("https://api.disorder119.com/games/leaderboard?game=warp", { headers: { Origin: SHOP } }), { DB }, { waitUntil() {} });
  assert.equal(ok.status, 200);
  // Auch die anderen Fehler der Spiel-Routen kommen als sauberer Code an.
  const limiter = { limit: async () => ({ success: false }) };
  const gebremst = await workerEntry.fetch(new Request("https://api.disorder119.com/games/leaderboard?game=warp", { headers: { Origin: SHOP } }), { DB, RATE_LIMITER: limiter }, { waitUntil() {} });
  assert.equal(gebremst.status, 429);
  assert.equal((await gebremst.json()).error, "RATE_LIMITED");
});

test("score without Origin is refused: no entry, no code", async () => {
  const DB = sqliteD1(allMigrations());
  const res = await punkte({ DB }, { origin: null });
  assert.equal(res.status, 403);
  assert.equal(res.data.error, "ORIGIN_REQUIRED");
  assert.equal(DB.raw.prepare("SELECT COUNT(*) AS n FROM game_scores").get().n, 0);
  assert.equal(DB.raw.prepare("SELECT COUNT(*) AS n FROM reward_coupons").get().n, 0);
});

test("game codes: at most two per connection (IPv6 per /64) in 30 days, score still counts", async () => {
  const DB = sqliteD1(allMigrations());
  const env = { DB };
  const codes = [];
  for (let i = 0; i < SPIEL_CODES_JE_ANSCHLUSS; i++) {
    const res = await punkte(env, { ip: `2001:db8:1:2::${i + 1}`, name: `Spieler${i + 1}` });
    assert.equal(res.status, 201, JSON.stringify(res.data));
    assert.match(res.data.couponCode, /^D119-10-[A-Z0-9]{10}$/);
    assert.equal(res.data.couponLimited, undefined);
    codes.push(res.data.couponCode);
  }
  // Andere Adresse im selben /64-Netz: derselbe Anschluss, kein Code mehr.
  const dritte = await punkte(env, { ip: "2001:db8:1:2:ffff:eeee:dddd:cccc", name: "Spieler3" });
  assert.equal(dritte.status, 201);
  assert.equal(dritte.data.qualified, true);
  assert.equal(dritte.data.couponCode, "");
  assert.equal(dritte.data.discountPercent, 0);
  assert.equal(dritte.data.couponLimited, true);
  assert.ok(dritte.data.leaderboard.some(row => row.username === "Spieler3"), "Score steht trotzdem im Ranking");
  assert.equal(DB.raw.prepare("SELECT COUNT(*) AS n FROM reward_coupons").get().n, 2);
  // Ein anderer Anschluss bekommt seinen Code.
  const anders = await punkte(env, { ip: "2001:db8:1:3::1", name: "Spieler4" });
  assert.match(anders.data.couponCode, /^D119-10-/);
  // Unter dem Ziel: weder Code noch Hinweis.
  const knapp = await punkte(env, { ip: "198.51.100.7", score: 1000, name: "Spieler5" });
  assert.equal(knapp.data.qualified, false);
  assert.equal(knapp.data.couponLimited, undefined);
  // Nach 30 Tagen ist der Anschluss wieder frei.
  DB.raw.prepare("UPDATE audit_events SET created_at=? WHERE entity_type='kontingent:spiel-code'")
    .run(new Date(Date.now() - 31 * 24 * 3600 * 1000).toISOString());
  const spaeter = await punkte(env, { ip: "2001:db8:1:2::9", name: "Spieler6" });
  assert.match(spaeter.data.couponCode, /^D119-10-/);
});

test("game codes: fixed daily cap across all connections", async () => {
  const DB = sqliteD1(allMigrations());
  const env = { DB, GAME_CODES_DAILY_CAP: "3" };
  const ergebnisse = [];
  for (let i = 0; i < 5; i++) ergebnisse.push(await punkte(env, { ip: `203.0.113.${i + 1}`, name: `Tag${i + 1}` }));
  assert.deepEqual(ergebnisse.map(r => Boolean(r.data.couponCode)), [true, true, true, false, false]);
  assert.deepEqual(ergebnisse.map(r => r.data.couponLimited === true), [false, false, false, true, true]);
  assert.equal(DB.raw.prepare("SELECT COUNT(*) AS n FROM reward_coupons").get().n, 3);
  assert.equal(DB.raw.prepare("SELECT COUNT(*) AS n FROM game_scores").get().n, 5);
});

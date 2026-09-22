import test from "node:test";
import assert from "node:assert/strict";
import {
  GAME_RULES,
  discountForSubtotal,
  normalizeCouponCode,
  normalizeGame,
  normalizeUsername,
  qualifiedScore,
  scoreIsPlausible,
} from "./game-rewards.js";

test("game ids and difficult reward thresholds stay explicit", () => {
  assert.equal(normalizeGame("WARP"), "warp");
  assert.equal(normalizeGame("signal"), "signal");
  assert.equal(normalizeGame("unknown"), "");
  assert.deepEqual(Object.keys(GAME_RULES), ["warp", "signal", "memory"]);
  assert.equal(GAME_RULES.warp.target, 4500);
  assert.equal(GAME_RULES.signal.target, 18000);
  assert.equal(GAME_RULES.memory.target, 7600);
});

test("public usernames are bounded and reject markup", () => {
  assert.equal(normalizeUsername("  archive_119  "), "archive_119");
  assert.equal(normalizeUsername("ab"), "");
  assert.equal(normalizeUsername("<script>alert(1)</script>"), "");
  assert.equal(normalizeUsername("Jean Paul"), "Jean Paul");
});

test("scores need plausible duration and bounded values", () => {
  assert.equal(scoreIsPlausible("warp", 4600, 32000), true);
  assert.equal(scoreIsPlausible("warp", 4600, 1000), false);
  assert.equal(scoreIsPlausible("signal", 999999, 25000), false);
  assert.equal(scoreIsPlausible("memory", 7600, 12000), true);
  assert.equal(qualifiedScore("warp", 4499), false);
  assert.equal(qualifiedScore("warp", 4500), true);
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

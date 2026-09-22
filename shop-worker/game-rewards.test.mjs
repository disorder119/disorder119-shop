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

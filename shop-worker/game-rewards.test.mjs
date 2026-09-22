import assert from "node:assert/strict";
import test from "node:test";

import {
  COUPON_PERCENT,
  GAME_REWARD_SCORE,
  discountedCents,
  isRewardScore,
  normalizeCouponCode,
  normalizeUsername,
} from "./game-rewards.js";

test("reward threshold is deliberately difficult and exact", () => {
  assert.equal(GAME_REWARD_SCORE, 20000);
  assert.equal(isRewardScore(19999), false);
  assert.equal(isRewardScore(20000), true);
  assert.equal(isRewardScore(24501), true);
});

test("Warp reward is exactly ten percent", () => {
  assert.equal(COUPON_PERCENT, 10);
  assert.equal(discountedCents(10000), 9000);
  assert.equal(discountedCents(9999), 8999);
  assert.equal(discountedCents(1), 1);
});

test("coupon input accepts formatted or pasted compact Warp codes", () => {
  assert.equal(normalizeCouponCode(" warp-abcd-2345-efgh "), "WARPABCD2345EFGH");
  assert.equal(normalizeCouponCode("WARPABCD2345EFGH"), "WARPABCD2345EFGH");
  assert.equal(normalizeCouponCode("DISCOUNT10"), "");
});

test("leaderboard usernames are short and markup-safe", () => {
  assert.equal(normalizeUsername("  joel   119  "), "joel 119");
  assert.equal(normalizeUsername("<script>alert(1)</script>"), "scriptalert1script");
  assert.ok(normalizeUsername("abcdefghijklmnopqrstuv").length <= 18);
});

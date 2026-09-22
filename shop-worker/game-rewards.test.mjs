import test from "node:test";
import assert from "node:assert/strict";
import {
  UNIVERSE_REWARD_SCORE,
  UNIVERSE_GAME_SECONDS,
  UNIVERSE_COUPON_PERCENT,
  normalizeUniverseUsername,
  normalizeCouponCode,
  couponDiscountCents,
  isGameRewardsRoute,
} from "./game-rewards.js";

test("Universe reward threshold stays deliberately difficult and branded", () => {
  assert.equal(UNIVERSE_REWARD_SCORE, 19119);
  assert.equal(UNIVERSE_GAME_SECONDS, 45);
  assert.equal(UNIVERSE_COUPON_PERCENT, 10);
});

test("leaderboard usernames accept only a small safe public alphabet", () => {
  assert.equal(normalizeUniverseUsername("  JOEL_119  "), "JOEL_119");
  assert.equal(normalizeUniverseUsername("a"), null);
  assert.equal(normalizeUniverseUsername("name with space"), null);
  assert.equal(normalizeUniverseUsername("<script>"), null);
  assert.equal(normalizeUniverseUsername("abcdefghijklmnopq"), null);
});

test("coupon codes normalize but reject arbitrary discounts", () => {
  assert.equal(normalizeCouponCode(" warp10-abcd2345 "), "WARP10-ABCD2345");
  assert.equal(normalizeCouponCode("SAVE100-ABCDEFGH"), null);
  assert.equal(normalizeCouponCode("WARP10-TOO-SHORT"), null);
});

test("discount arithmetic is cents-based and capped", () => {
  assert.equal(couponDiscountCents(19999, 10), 2000);
  assert.equal(couponDiscountCents(1, 10), 0);
  assert.equal(couponDiscountCents(1000, 200), 1000);
  assert.equal(couponDiscountCents(-10, 10), 0);
});

test("only explicit public game and coupon routes are claimed", () => {
  for (const path of ["/game/start", "/game/submit", "/game/leaderboard", "/coupons/validate"]) {
    assert.equal(isGameRewardsRoute(path), true, path);
  }
  assert.equal(isGameRewardsRoute("/admin/game"), false);
  assert.equal(isGameRewardsRoute("/coupons/redeem"), false);
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  GAME_RULES,
  GAME_VERSION,
  couponBudgetAvailable,
  discountForSubtotal,
  normalizeCouponCode,
  normalizeGame,
  normalizeUsername,
  qualifiedScore,
  scoreIsPlausible,
} from "./game-rewards.js";

// Kleiner In-Memory-Ersatz fuer die beiden COUNT-Abfragen des Farming-Schutzes.
function couponCountDb(rows = []) {
  return {
    prepare(sql) {
      const s = sql.replace(/\s+/g, " ").trim();
      return {
        bind(...args) {
          return {
            async first() {
              const since = s.includes("username_key=?") ? args[1] : args[0];
              const usernameKey = s.includes("username_key=?") ? args[0] : null;
              const anzahl = rows.filter(r =>
                r.source_game &&
                r.created_at >= since &&
                (usernameKey === null || r.username_key === usernameKey)
              ).length;
              return { anzahl };
            },
          };
        },
      };
    },
  };
}

const NOW_ISO = new Date().toISOString();

test("coupon budget stops farming once the daily caps are reached", async () => {
  // Fresh username, empty ledger, defaults: a code may be issued.
  assert.equal(await couponBudgetAvailable(couponCountDb([]), {}, "neu"), true);

  // Same username already has today's coupon → blocked (default per-user cap 1).
  const withUserCoupon = [{ source_game: "warp", username_key: "neu", created_at: NOW_ISO }];
  assert.equal(await couponBudgetAvailable(couponCountDb(withUserCoupon), {}, "neu"), false);
  // A different username is still within the per-user cap...
  assert.equal(await couponBudgetAvailable(couponCountDb(withUserCoupon), {}, "andere"), true);

  // ...but the global daily cap bounds the blast radius across all usernames.
  const many = Array.from({ length: 100 }, (_, i) => ({ source_game: "warp", username_key: "u" + i, created_at: NOW_ISO }));
  assert.equal(await couponBudgetAvailable(couponCountDb(many), {}, "ganzneu"), false);

  // An explicit kill switch disables issuance entirely.
  assert.equal(await couponBudgetAvailable(couponCountDb([]), { GAME_COUPONS_ENABLED: "false" }, "neu"), false);

  // Old coupons outside the 24h window do not count against the caps.
  const old = { source_game: "warp", username_key: "neu", created_at: "2020-01-01T00:00:00.000Z" };
  assert.equal(await couponBudgetAvailable(couponCountDb([old]), {}, "neu"), true);
});

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

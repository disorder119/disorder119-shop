from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
js = (ROOT / "assets" / "universe-upgrade.js").read_text(encoding="utf-8")
css = (ROOT / "assets" / "universe-upgrade.css").read_text(encoding="utf-8")
rewards = (ROOT / "assets" / "rewards-coupon.js").read_text(encoding="utf-8")
rewards_css = (ROOT / "assets" / "rewards-coupon.css").read_text(encoding="utf-8")
loader = (ROOT / "assets" / "ios-zoom-lock.js").read_text(encoding="utf-8")
pwa = (ROOT / "assets" / "pwa.js").read_text(encoding="utf-8")


def require(condition, message):
    if not condition:
        raise SystemExit(f"Universe regression failed: {message}")


mobile_delay = re.search(r"STAR_FIRST_MOBILE_MS\s*=\s*(\d+)", js)
require(mobile_delay, "mobile shooting-star delay constant missing")
require(int(mobile_delay.group(1)) <= 4000, "first mobile shooting star must appear within 4 seconds")

require('mode: "Universum-Modus"' in js, "German mode name is not Universum-Modus")
require('mode: "Universe Mode"' in js, "English mode name is not Universe Mode")
require('mode: "Mode Univers"' in js, "French mode name is not Mode Univers")
require('mode-rail__icon--universe' in js and '<svg viewBox="0 0 32 32"' in js, "orbit/planet icon missing")
require('reduceMotion() ? " is-reduced" : ""' in js, "reduced-motion shooting-star fallback missing")
require('.universe-shooting-star.is-reduced' in css, "reduced-motion static star style missing")
require('getElementById("chaosGameAgain")' in js and 'nativeStart.click()' in js, "shooting star no longer uses native Warp Hunt start wiring")
require('[0, 38, 76]' not in js, "legacy synthetic 119 trigger must not return")

require('id = "universeTurbo"' in js, "mobile Turbo button missing")
require('dispatchGameKey("keydown", " ")' in js, "Turbo press is not wired")
require('dispatchGameKey("keyup", " ")' in js, "Turbo release is not wired")
require('@media (pointer: coarse), (max-width: 700px)' in css, "mobile/coarse-pointer layout missing")
require('.universe-game__turbo { display: flex; }' in css, "Turbo is not exposed on mobile")
require('env(safe-area-inset-bottom' in css and 'env(safe-area-inset-top' in css, "iPhone safe-area support missing")

# New direct-play, leaderboard and voucher layer.
require('params.get("play") !== "1"' in rewards and 'start.click()' in rewards, "?play=1 direct game start missing")
require('REWARD_SCORE = 19119' in rewards, "19,119 reward threshold missing")
require('/game/start' in rewards and '/game/submit' in rewards and '/game/leaderboard?limit=20' in rewards, "leaderboard API wiring missing")
require('/coupons/validate' in rewards and 'd119CouponWidget' in rewards, "global coupon UI/validation missing")
require('USERNAME_KEY' in rewards and '^[A-Za-z0-9_-]{2,16}$' in rewards, "safe username persistence missing")
require('env(safe-area-inset-bottom' in rewards_css, "reward/coupon mobile safe area missing")

# Bootstrap is global and cache-busted.
require('/assets/universe-upgrade.js?v=20260922-2' in loader, "Universe JS loader missing")
require('/assets/universe-upgrade.css?v=20260922-2' in loader, "Universe CSS loader missing")
require('/assets/rewards-coupon.js?v=20260922-1' in loader, "rewards/coupon JS loader missing")
require('/assets/rewards-coupon.css?v=20260922-1' in loader, "rewards/coupon CSS loader missing")
require('/assets/ios-zoom-lock.js?v=20260922-1' in pwa, "iOS helper loader missing")

print("Universe Mode + leaderboard/coupon regression checks passed")

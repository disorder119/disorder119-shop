from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
js = (ROOT / "assets" / "universe-upgrade.js").read_text(encoding="utf-8")
css = (ROOT / "assets" / "universe-upgrade.css").read_text(encoding="utf-8")
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

# The accessible reduced-motion path must still expose a tappable star instead
# of disabling the only discoverable entry to the minigame.
require('reduceMotion() ? " is-reduced" : ""' in js, "reduced-motion shooting-star fallback missing")
require('.universe-shooting-star.is-reduced' in css, "reduced-motion static star style missing")

# Reuse the existing Warp Hunt's native replay/start wiring. This deliberately
# avoids duplicating protected game logic or relying on synthetic secret keys.
require('getElementById("chaosGameAgain")' in js and 'nativeStart.click()' in js, "shooting star no longer uses native Warp Hunt start wiring")
require('[0, 38, 76]' not in js, "legacy synthetic 119 trigger must not return")

# Mobile game must have a holdable Turbo control mapped to the existing space
# boost input, with both press and release so boost cannot get stuck.
require('id = "universeTurbo"' in js, "mobile Turbo button missing")
require('dispatchGameKey("keydown", " ")' in js, "Turbo press is not wired")
require('dispatchGameKey("keyup", " ")' in js, "Turbo release is not wired")
require('@media (pointer: coarse), (max-width: 700px)' in css, "mobile/coarse-pointer layout missing")
require('.universe-game__turbo { display: flex; }' in css, "Turbo is not exposed on mobile")
require('env(safe-area-inset-bottom' in css and 'env(safe-area-inset-top' in css, "iPhone safe-area support missing")

# Bootstrap is intentionally attached to the already-global helper to avoid a
# new render-blocking tag in every generated HTML page. PWA loader version must
# move with it so iPhones cannot keep an older helper from HTTP cache.
require('/assets/universe-upgrade.js?v=20260922-1' in loader, "Universe JS loader missing")
require('/assets/universe-upgrade.css?v=20260922-1' in loader, "Universe CSS loader missing")
require('/assets/ios-zoom-lock.js?v=20260922-1' in pwa, "iOS helper cache-bust missing")

print("Universe Mode regression checks passed")

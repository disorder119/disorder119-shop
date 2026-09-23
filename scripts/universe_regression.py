from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
upgrade = (ROOT / "assets" / "universe-upgrade.js").read_text(encoding="utf-8")
upgrade_css = (ROOT / "assets" / "universe-upgrade.css").read_text(encoding="utf-8")
game = (ROOT / "assets" / "zero-g-runway.js").read_text(encoding="utf-8")
game_css = (ROOT / "assets" / "zero-g-runway.css").read_text(encoding="utf-8")
promos = (ROOT / "assets" / "shop-promos.js").read_text(encoding="utf-8")
loader = (ROOT / "assets" / "ios-zoom-lock.js").read_text(encoding="utf-8")
worker = (ROOT / "shop-worker" / "game-rewards.js").read_text(encoding="utf-8")


def require(condition, message):
    if not condition:
        raise SystemExit(f"Universe regression failed: {message}")


# Universe identity and the improved desktop navigation stay intact.
require('mode: "Universum-Modus"' in upgrade, "German mode name is not Universum-Modus")
require('mode: "Universe Mode"' in upgrade, "English mode name is not Universe Mode")
require('mode: "Mode Univers"' in upgrade, "French mode name is not Mode Univers")
require('mode-rail__icon--universe' in upgrade and '<svg viewBox="0 0 32 32"' in upgrade, "orbit/planet icon missing")
require('.universe-shooting-star,.d119-warp-control,#universeTurbo,.d119-secret-relic' in upgrade, "legacy visible entries are not removed")

# Exactly one loaded public game: ZERO-G RUNWAY 119. The superseded shooter and
# Dodge bundles may remain as historical files but are not loaded by Universe.
require('ZERO-G RUNWAY 119' in game, "Zero-G Runway title missing")
require('PUBLIC_VERSION = "zero-g-runway-v1"' in game, "Zero-G public version missing")
require('function startRunway' in game, "Zero-G runway engine missing")
require('/assets/zero-g-runway.js?v=' in upgrade and '/assets/zero-g-runway.css?v=' in upgrade, "Zero-G bundle bootstrap missing")
require('/assets/secret-games.js?v=' not in upgrade and '/assets/secret-games.css?v=' not in upgrade, "superseded game bundle is still loaded")
require('D119SecretGames.start("zero")' in upgrade, "legacy Universe game bridge does not route to Zero-G")

# Fashion is the mechanic: real catalogue pieces are classified into a four-slot
# look, wrong pieces/hazards penalize, complete looks and archive pieces score.
require('/data/catalog.json' in game, "game does not source public catalogue pieces")
for slot in ('"top"', '"bottom"', '"shoes"', '"accessory"'):
    require(slot in game, f"look slot missing: {slot}")
require('function slotFor' in game, "fashion category classifier missing")
require('currentLook.push(o.item)' in game, "matching piece is not added to the look")
require('LOOK 0' in game and 'COMPLETE' in game, "complete-look bonus missing")
require('ARCHIVE PIECE // +3.600' in game and 'slowUntil=t+1350' in game, "archive slow-motion bonus missing")
require('SOLD' in game and 'WRONG PIECE' in game, "fashion hazards or wrong-piece penalty missing")
require('finalLook' in game and 'YOUR 119 LOOK' in game, "final collected look is not shown")
require('articleUrl(item)' in game and '/artikel/' in game, "result look does not link back to shop products")
require('RUNWAY RANKING' in game and '/games/leaderboard?game=' in game, "username/leaderboard integration missing")

# Perspective gameplay and controls: mouse movement alone steers, touch is owned
# by the canvas, runway depth is projected and difficulty rises over the run.
require('d119-runway-canvas' in game and '.d119-runway-canvas' in game_css, "runway canvas missing")
require('canvas.addEventListener("pointermove",onPointer' in game, "mouse/finger movement control missing")
require('canvas.addEventListener("pointerdown",onPointer' in game, "touch start control missing")
require('function project(o)' in game and 'Math.pow(depth,1.62)' in game, "perspective projection missing")
require('drawBackground(elapsed,speedScale)' in game, "space runway renderer missing")
require('interval=860-progress*300' in game, "difficulty escalation missing")
require('touch-action:none' in game_css, "canvas does not own mobile touch input")
require('cursor:none' in game_css, "native cursor is not hidden during the run")
require('env(safe-area-inset-bottom' in game_css and 'env(safe-area-inset-top' in game_css, "iPhone safe-area support missing")

# Random discovery is a floating Disorder119 bag inside Universe, not a generic
# game menu. Direct links still exist for sharing/testing.
require('function spawnEncounter' in game, "random encounter bootstrap missing")
require('d119-zero-g-bag' in game and '.d119-zero-g-bag__icon' in game_css, "floating shopping-bag discovery missing")
require('7600+Math.random()*18000' in game, "first discovery timing is not randomized")
require('35000+Math.random()*56000' in game, "repeat discovery timing is not randomized")
require('"zero","zero-g","runway","fashion"' in game, "new direct-link aliases missing")
require('discover:spawnEncounter' in game, "deterministic discovery hook missing")

# Regression for the blue iOS selection/drag handles.
for source, label in ((upgrade_css, "Universe shell"), (game_css, "Zero-G game")):
    require('-webkit-user-select:none' in source.replace(' ', '') or '-webkit-user-select: none' in source, f"{label} selection guard missing")
    require('-webkit-touch-callout:none' in source.replace(' ', '') or '-webkit-touch-callout: none' in source, f"{label} touch-callout guard missing")
require('selectstart' in game and 'dragstart' in game, "runtime selection/drag guard missing")

# Reward/coupon transport remains server validated and compatible.
require('target: 48000' in game, "48k reward target missing")
require('10 % UNLOCKED' in game, "10 percent reward result missing")
require('SUBMISSION_VERSION = "archive-raid-v3"' in game, "reward API compatibility version missing")
require('mode:PUBLIC_VERSION' in game, "Zero-G mode is not tagged in score detail")
require('GAME_VERSION = "archive-raid-v3"' in worker, "worker reward version mismatch")
require('target: 48000' in worker and 'maxScore: 150000' in worker, "worker score rule mismatch")
require('document.getElementById("cartFoot")' in promos and 'data-d119-coupon' in promos, "shop coupon field missing")
require('/coupons/validate' in promos and 'payload.couponCode = code' in promos, "server coupon validation/checkout forwarding missing")

# Cache-bust the new game and the Universe loader.
require('ASSET_VERSION = "20260923-3"' in upgrade, "Zero-G asset version not bumped")
require('if (!document.getElementById("chaosView")) return;' in upgrade, "game bundle is loaded on normal shop pages")
require('/assets/universe-upgrade.js?v=20260923-2' in loader, "Universe JS cache-bust missing")
require('/assets/universe-upgrade.css?v=20260923-2' in loader, "Universe CSS cache-bust missing")

print("Universe Zero-G Runway 119 regression checks passed")

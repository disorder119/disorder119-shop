from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
upgrade = (ROOT / "assets" / "universe-upgrade.js").read_text(encoding="utf-8")
upgrade_css = (ROOT / "assets" / "universe-upgrade.css").read_text(encoding="utf-8")
games = (ROOT / "assets" / "secret-games.js").read_text(encoding="utf-8")
games_css = (ROOT / "assets" / "secret-games.css").read_text(encoding="utf-8")
promos = (ROOT / "assets" / "shop-promos.js").read_text(encoding="utf-8")
loader = (ROOT / "assets" / "ios-zoom-lock.js").read_text(encoding="utf-8")
pwa = (ROOT / "assets" / "pwa.js").read_text(encoding="utf-8")
worker = (ROOT / "shop-worker" / "game-rewards.js").read_text(encoding="utf-8")


def require(condition, message):
    if not condition:
        raise SystemExit(f"Universe regression failed: {message}")


# Universe identity stays stable.
require('mode: "Universum-Modus"' in upgrade, "German mode name is not Universum-Modus")
require('mode: "Universe Mode"' in upgrade, "English mode name is not Universe Mode")
require('mode: "Mode Univers"' in upgrade, "French mode name is not Mode Univers")
require('mode-rail__icon--universe' in upgrade and '<svg viewBox="0 0 32 32"' in upgrade, "orbit/planet icon missing")
require('.universe-shooting-star,.d119-warp-control,#universeTurbo,.d119-secret-relic' in upgrade, "legacy visible entries are not removed")

# Exactly one public game: DODGE THE DROP. The old shooter presentation must
# not be shipped in the visible game bundle anymore. The worker protocol keeps
# its historic warp/archive-raid-v3 identifiers only for D1/reward compatibility.
require('DODGE THE DROP' in games, "Dodge the Drop title missing")
require('PUBLIC_VERSION = "dodge-the-drop-v1"' in games, "Dodge the Drop public version missing")
require('function startDodge' in games, "single dodge engine missing")
for old in ("ARCHIVE RAID 119", "AUTO-CANNON", "STARSHIP 119", "NULL CARRIER", "function firePlayer", "function spawnBullet", "function spawnBoss"):
    require(old not in games, f"obsolete shooter element still shipped: {old}")
require('function startSignal' not in games and 'function startMemory' not in games, "old minigames still shipped")
require('d119-game-card' not in games and 'Drei Signale. Drei Spiele.' not in games, "old game menu returned")
require('params.get("game")' in games or 'searchParams).get("game")' in games or 'URLSearchParams(location.search).get("game")' in games,
        "direct game link support missing")

# A subtle moving in-world tag is the discovery entry; it launches the same
# clothing dodge game rather than a ship/shooter encounter.
require('function spawnEncounter' in games, "random encounter bootstrap missing")
require('d119-universe-encounter' in games and '.d119-universe-encounter' in games_css, "in-world game entry missing")
require('DODGE<br><b>THE DROP</b>' in games, "in-world game tag is not Dodge the Drop")
require('9000 + Math.random() * 22000' in games, "first game encounter timing is not randomized")
require('34000 + Math.random() * 62000' in games, "repeat game encounter timing is not randomized")
require('discover: spawnEncounter' in games, "deterministic CI discovery hook missing")

# Gameplay is clothing-first: real catalogue images fall through a canvas and
# the player marker follows pointer movement without requiring mouse clicks.
require('d119-dodge-canvas' in games and '.d119-dodge-canvas' in games_css, "dodge canvas surface missing")
require('/data/catalog.json' in games, "game does not source public catalogue pieces")
require('canvas.addEventListener("pointermove", onPointer' in games, "mouse/finger movement control missing")
require('canvas.addEventListener("pointerdown", onPointer' in games, "touch start control missing")
require('ctx.drawImage(o.img' in games, "real clothing images are not rendered as obstacles")
require('dodged++' in games and 'hits++' in games, "dodge/hit scoring loop missing")
require('score = Math.max(0, score - 2800)' in games, "collision penalty missing")
require('player.x = clamp(e.clientX - r.left' in games and 'player.y = clamp(e.clientY - r.top' in games,
        "pointer does not directly steer the 119 marker")
require('cursor: none' in games_css, "native cursor is not hidden behind the 119 player marker")
require('touch-action: none' in games_css, "canvas does not own mobile touch input")
require('@media (max-width: 680px)' in games_css, "mobile layout missing")
require('env(safe-area-inset-bottom' in games_css and 'env(safe-area-inset-top' in games_css, "iPhone safe-area support missing")

# Regression for the user's blue iOS selection/drag handles.
for source, label in ((upgrade_css, "Universe shell"), (games_css, "game bundle")):
    require('-webkit-user-select: none' in source and '-webkit-touch-callout: none' in source, f"{label} selection guard missing")
require('selectstart' in games and 'dragstart' in games, "runtime selection/drag guard missing")

# One hard reward threshold remains server validated. The browser identifies the
# new public mode separately while using the existing deployed protocol version.
require('target: 48000' in games, "48k reward target missing from game UI")
require('10 % UNLOCKED' in games, "10 percent reward result missing")
require('SUBMISSION_VERSION = "archive-raid-v3"' in games, "reward API compatibility version missing")
require('mode: PUBLIC_VERSION' in games, "new public game mode is not tagged in score detail")
require('GAME_VERSION = "archive-raid-v3"' in worker, "worker game version mismatch")
require('target: 48000' in worker and 'maxScore: 150000' in worker, "worker hard-score rule mismatch")
require('detail_json LIKE ?' in worker, "reward leaderboard/version isolation missing")
require('GAME_VERSION_REQUIRED' in worker, "server does not reject incompatible score payloads")
require('document.getElementById("cartFoot")' in promos and 'data-d119-coupon' in promos, "shop coupon field missing")
require('/coupons/validate' in promos and 'payload.couponCode = code' in promos, "server coupon validation/checkout forwarding missing")

# Heavy game assets load only where Universe exists; cache-bust prevents Safari
# from keeping the superseded Archive Raid bundle.
require('ASSET_VERSION = "20260923-2"' in upgrade, "Dodge game asset version not bumped")
require('if (!document.getElementById("chaosView")) return;' in upgrade, "game bundle is still loaded on normal shop pages")
require('/assets/secret-games.js?v=' in upgrade, "game bundle bootstrap missing")
require('/assets/shop-promos.js?v=' in upgrade, "shop promo bootstrap missing")
require('D119SecretGames.start("dodge")' in upgrade, "legacy canvas bridge does not route to Dodge the Drop")
require('/assets/universe-upgrade.js?v=20260923-1' in loader, "Universe JS cache-bust missing")
require('/assets/universe-upgrade.css?v=20260923-1' in loader, "Universe CSS cache-bust missing")
require('/assets/ios-zoom-lock.js?v=20260923-1' in pwa, "fresh global iOS helper loader missing")

print("Universe Dodge the Drop v1 regression checks passed")

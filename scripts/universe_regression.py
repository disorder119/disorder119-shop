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

# Exactly one public game: ARCHIVE RAID 119. Old links may alias to it, but the
# old three mechanics/menu must be gone from the shipped game bundle.
require('ARCHIVE RAID 119' in games, "Archive Raid title missing")
require('GAME_VERSION = "archive-raid-v3"' in games, "Archive Raid version missing")
require('function startRaid' in games, "single raid engine missing")
require('function startSignal' not in games and 'function startMemory' not in games, "old minigames still shipped")
require('WORMHOLE LOCK' not in games and 'ZERO-G BAG' not in games, "old game names still shipped")
require('d119-game-card' not in games and 'Drei Signale. Drei Spiele.' not in games, "old game menu returned")
require('params.get("game")' in games and '"raid"' in games and '"signal"' in games and '"memory"' in games, "backwards-compatible direct-link aliases missing")

# One random in-world discovery: a passing STARSHIP 119. There is no permanent
# button and no random selection between unrelated game types.
require('function spawnEncounter' in games, "random encounter bootstrap missing")
require('d119-universe-encounter--raid' in games and '.d119-universe-encounter--raid' in games_css, "ship encounter visual missing")
require('7000 + Math.random() * 21000' in games, "first ship encounter timing is not randomized")
require('34000 + Math.random() * 62000' in games, "repeat ship encounter timing is not randomized")
require('discover: spawnEncounter' in games, "deterministic CI discovery hook missing")

# Gameplay is a real mobile canvas arcade loop: steering + auto-cannon,
# destructible threats, cargo rescue, escalating phases and final boss.
require('d119-raid-canvas' in games and '.d119-raid-canvas' in games_css, "canvas game surface missing")
require('pointerdown' in games and 'pointermove' in games and 'setPointerCapture' in games, "mobile drag steering missing")
require('function firePlayer' in games and 'spawnBullet' in games, "player weapon system missing")
require('asteroid' in games and 'drone' in games and 'mine' in games, "destructible hazards missing")
require('function spawnCargo' in games and 'ARCHIVE' in games, "archive cargo rescue missing")
require('NULL CARRIER' in games and 'function spawnBoss' in games, "final boss phase missing")
require('overdriveUntil' in games and 'shieldUntil' in games, "power-up system missing")
require('touch-action: none' in games_css, "canvas does not own mobile touch input")
require('@media (pointer: coarse), (max-width: 700px)' in games_css, "mobile layout missing")
require('env(safe-area-inset-bottom' in games_css and 'env(safe-area-inset-top' in games_css, "iPhone safe-area support missing")

# Regression for the user's blue iOS selection/drag handles.
for source, label in ((upgrade_css, "Universe shell"), (games_css, "game bundle")):
    require('-webkit-user-select: none' in source and '-webkit-touch-callout: none' in source, f"{label} selection guard missing")
require('selectstart' in games and 'dragstart' in games, "runtime selection/drag guard missing")

# One hard reward threshold and a fresh v3 leaderboard; checkout coupon field is
# still shop-wide and server validated.
require('target: 48000' in games, "48k reward target missing from game UI")
require('10 % UNLOCKED' in games, "10 percent reward result missing")
require('GAME_VERSION = "archive-raid-v3"' in worker, "worker game version mismatch")
require('target: 48000' in worker and 'maxScore: 150000' in worker, "worker hard-score rule mismatch")
require('detail_json LIKE ?' in worker, "v3 leaderboard is not isolated from old scores")
require('GAME_VERSION_REQUIRED' in worker, "server does not reject old score payloads")
require('document.getElementById("cartFoot")' in promos and 'data-d119-coupon' in promos, "shop coupon field missing")
require('/coupons/validate' in promos and 'payload.couponCode = code' in promos, "server coupon validation/checkout forwarding missing")

# Heavy arcade assets load only on Universe pages; cache-bust prevents Safari
# from keeping the superseded games.
require('ASSET_VERSION = "20260923-1"' in upgrade, "Archive Raid asset version not bumped")
require('if (!document.getElementById("chaosView")) return;' in upgrade, "game bundle is still loaded on normal shop pages")
require('/assets/secret-games.js?v=' in upgrade, "game bundle bootstrap missing")
require('/assets/shop-promos.js?v=' in upgrade, "shop promo bootstrap missing")
require('D119SecretGames.start("raid")' in upgrade, "legacy canvas bridge does not route to Archive Raid")
require('/assets/universe-upgrade.js?v=20260923-1' in loader, "Universe JS cache-bust missing")
require('/assets/universe-upgrade.css?v=20260923-1' in loader, "Universe CSS cache-bust missing")
require('/assets/ios-zoom-lock.js?v=20260922-1' in pwa, "global iOS helper loader missing")

print("Universe Archive Raid v3 regression checks passed")

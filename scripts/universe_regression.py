from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
upgrade = (ROOT / "assets" / "universe-upgrade.js").read_text(encoding="utf-8")
games = (ROOT / "assets" / "secret-games.js").read_text(encoding="utf-8")
games_css = (ROOT / "assets" / "secret-games.css").read_text(encoding="utf-8")
promos = (ROOT / "assets" / "shop-promos.js").read_text(encoding="utf-8")
loader = (ROOT / "assets" / "ios-zoom-lock.js").read_text(encoding="utf-8")
pwa = (ROOT / "assets" / "pwa.js").read_text(encoding="utf-8")


def require(condition, message):
    if not condition:
        raise SystemExit(f"Universe regression failed: {message}")


# Universe keeps the curated mode name/icon and removes the old permanent
# Warp/Turbo entry. Games must be discovered as in-world encounters instead.
require('mode: "Universum-Modus"' in upgrade, "German mode name is not Universum-Modus")
require('mode: "Universe Mode"' in upgrade, "English mode name is not Universe Mode")
require('mode: "Mode Univers"' in upgrade, "French mode name is not Mode Univers")
require('mode-rail__icon--universe' in upgrade and '<svg viewBox="0 0 32 32"' in upgrade, "orbit/planet icon missing")
require('universe-shooting-star,.d119-warp-control,#universeTurbo' in upgrade, "legacy visible Warp controls are not removed")
require('startWarpGame' not in upgrade and 'universe-game__turbo' not in upgrade, "legacy visible Warp/Turbo bootstrap returned")

# Same stable backend ids, completely new Universe-native mechanics.
require('GAME_IDS = ["warp", "signal", "memory"]' in games, "three stable game ids missing")
require('STARSHIP 119' in games and 'function startWarp' in games, "STARSHIP 119 encounter missing")
require('WORMHOLE LOCK' in games and 'function startSignal' in games, "WORMHOLE LOCK encounter missing")
require('ZERO-G BAG' in games and 'function startMemory' in games, "ZERO-G BAG encounter missing")
require('d119-game-card' not in games and 'Drei Signale. Drei Spiele.' not in games, "old visible game menu returned")
require('params.get("game")' in games and 'value === "1"' in games and 'value === "2"' in games and 'value === "3"' in games, "direct test links missing")

# Random discovery is represented by actual Universe objects: ship, rift and bag.
require('function spawnEncounter' in games and 'GAME_IDS[Math.floor(Math.random() * GAME_IDS.length)]' in games, "random encounter selection missing")
require('6500 + Math.random() * 24000' in games, "first encounter timing is not randomized")
require('28000 + Math.random() * 72000' in games, "repeat encounter timing is not randomized")
for selector in ("d119-universe-encounter--ship", "d119-universe-encounter--rift", "d119-universe-encounter--bag"):
    require(selector in games and f'.{selector}' in games_css, f"{selector} visual missing")
require('discover: spawnEncounter' in games, "deterministic CI discovery hook missing")

# Mobile controls are direct pointer controls, not tiny tap targets.
require('d119-flight-field d119-warp-field' in games, "ship flight field missing")
require('field.addEventListener("pointermove", steer' in games, "drag steering missing")
require('d119-player-ship' in games and '.d119-player-ship' in games_css, "ship control visual missing")
require('d119-orbit-ring--1' in games and 'field.addEventListener("pointermove", moveRing' in games, "wormhole ring control missing")
require('d119-catch-bag' in games and '.d119-catch-bag' in games_css, "shopping bag control missing")
require('touch-action: none' in games_css, "game fields do not suppress browser touch gestures")
require('@media (pointer: coarse), (max-width: 700px)' in games_css, "mobile/coarse-pointer layout missing")
require('env(safe-area-inset-bottom' in games_css and 'env(safe-area-inset-top' in games_css, "iPhone safe-area support missing")

# Usernames, leaderboards, reward targets and the shop-wide coupon field remain intact.
require('/games/start' in games and '/games/score' in games, "score API wiring missing")
require('d119_secret_player' in games and 'd119_game_board_v2' in games, "callsign/local leaderboard persistence missing")
require('target: 4500' in games and 'target: 18000' in games and 'target: 7600' in games, "reward targets changed unexpectedly")
require('10 % UNLOCKED' in games, "10 percent reward result missing")
require('document.getElementById("cartFoot")' in promos and 'data-d119-coupon' in promos, "shop coupon field missing")
require('/coupons/validate' in promos and 'payload.couponCode = code' in promos, "server coupon validation/checkout forwarding missing")

# Global loader must actually bust the old encounter assets on Safari/Pages.
require('ASSET_VERSION = "20260922-3"' in upgrade, "Universe encounter asset version not bumped")
require('/assets/secret-games.js?v=' in upgrade, "secret game bundle is not bootstrapped")
require('/assets/shop-promos.js?v=' in upgrade, "coupon bundle is not bootstrapped")
require('chaos-view--game' in upgrade and 'D119SecretGames.start' in upgrade, "legacy canvas bridge missing")
require('/assets/universe-upgrade.js?v=20260922-3' in loader, "Universe JS cache-bust missing")
require('/assets/universe-upgrade.css?v=20260922-3' in loader, "Universe CSS cache-bust missing")
require('/assets/ios-zoom-lock.js?v=20260922-1' in pwa, "global iOS helper loader missing")

print("Universe encounter v2 regression checks passed")

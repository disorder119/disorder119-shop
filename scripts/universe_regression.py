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


# Universe keeps the curated mode name/icon but no longer exposes an obvious
# Warp/Turbo game control. Discovery happens through rare in-world relics.
require('mode: "Universum-Modus"' in upgrade, "German mode name is not Universum-Modus")
require('mode: "Universe Mode"' in upgrade, "English mode name is not Universe Mode")
require('mode: "Mode Univers"' in upgrade, "French mode name is not Mode Univers")
require('mode-rail__icon--universe' in upgrade and '<svg viewBox="0 0 32 32"' in upgrade, "orbit/planet icon missing")
require('universe-shooting-star,.d119-warp-control,#universeTurbo' in upgrade, "legacy visible Warp controls are not removed")
require('startWarpGame' not in upgrade and 'universe-game__turbo' not in upgrade, "legacy visible Warp/Turbo bootstrap returned")

# Three genuinely different games, direct deep links and rare discovery.
for game in ("warp", "signal", "memory"):
    require(f'{game}:' in games, f"{game} game metadata missing")
require('GAME_IDS = ["warp", "signal", "memory"]' in games, "three game ids missing")
require('function startWarp' in games, "mobile-safe VOID RUN missing")
require('function startSignal' in games, "SIGNAL 119 missing")
require('function startMemory' in games, "ARCHIVE MATCH missing")
require('params.get("game")' in games and 'value === "1"' in games and 'value === "2"' in games and 'value === "3"' in games, "direct game links missing")
require('42000 + Math.random() * 62000' in games, "secret relic is no longer rare after first discovery")
require('d119-secret-relic' in games and '.d119-secret-relic' in games_css, "secret in-world relic missing")

# Regression for the reported iPhone bug: coarse pointers get a larger actual
# collision radius and pointermove drives the crosshair directly.
require('var hitRadius = coarse() ? 76 : 54' in games, "mobile hit radius regression")
require('field.addEventListener("pointermove", onPointer' in games, "mobile crosshair pointer tracking missing")
require('hudScore.textContent = money(score)' in games, "Warp merchandise value HUD no longer updates on hit")
require('touch-action: none' in games_css, "game field does not suppress browser touch gestures")
require('@media (pointer: coarse), (max-width: 700px)' in games_css, "mobile/coarse-pointer layout missing")
require('env(safe-area-inset-bottom' in games_css and 'env(safe-area-inset-top' in games_css, "iPhone safe-area support missing")

# Usernames, leaderboards, reward targets and the shop-wide coupon field.
require('/games/leaderboard?game=' in games and '/games/start' in games and '/games/score' in games, "leaderboard API wiring missing")
require('d119_secret_player' in games, "username persistence missing")
require('target: 4500' in games and 'target: 18000' in games and 'target: 7600' in games, "reward targets changed unexpectedly")
require('10 % UNLOCKED' in games, "10 percent reward result missing")
require('document.getElementById("cartFoot")' in promos and 'data-d119-coupon' in promos, "shop coupon field missing")
require('/coupons/validate' in promos and 'payload.couponCode = code' in promos, "server coupon validation/checkout forwarding missing")

# The global loader must pull the new system on every page and bridge any old
# canvas secret into the new games rather than exposing the broken native game.
require('/assets/secret-games.js?v=' in upgrade, "secret game bundle is not bootstrapped")
require('/assets/shop-promos.js?v=' in upgrade, "coupon bundle is not bootstrapped")
require('chaos-view--game' in upgrade and 'D119SecretGames.start' in upgrade, "legacy canvas secret bridge missing")
require('/assets/universe-upgrade.js?v=20260922-2' in loader, "Universe JS cache-bust missing")
require('/assets/universe-upgrade.css?v=20260922-2' in loader, "Universe CSS cache-bust missing")
# pwa.js keeps its stable helper URL; the helper itself cache-busts the new
# Universe bundle. GitHub Pages revalidates the helper asset on deployment.
require('/assets/ios-zoom-lock.js?v=20260922-1' in pwa, "global iOS helper loader missing")

print("Universe secret games regression checks passed")

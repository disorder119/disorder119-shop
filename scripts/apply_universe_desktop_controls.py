#!/usr/bin/env python3
"""Apply the requested desktop Universe controls and expose Dodge the Drop.

The creative modes are protected by config/mode-guard.json. This migration is
strict and idempotent: it only transforms the known current Universe code and
refreshes the guard after those exact intentional changes.
"""
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "assets" / "app.js"
TEMPLATE = ROOT / "index_template.html"
MARKER = "UNIVERSE_DESKTOP_GAZE_V1"


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"FEHLER: {label} nicht eindeutig gefunden ({count})")
    return text.replace(old, new, 1)


def main() -> None:
    app = APP.read_text(encoding="utf-8")
    template = TEMPLATE.read_text(encoding="utf-8")
    if MARKER in app and "data-d119-game-launch" in template:
        print("Universe Desktop-Gaze und Game-Launcher bereits aktuell.")
        return

    app = replace_once(
        app,
        '    focusKey: null, focusItem: null, hoverKey: "",\n    lastInput: 0, pointers: new Map(), gesture: null, lastTap: { t: 0, x: 0, y: 0 },',
        '    focusKey: null, focusItem: null, hoverKey: "",\n    mouseLook: { active: false, x: 0, y: 0 }, // UNIVERSE_DESKTOP_GAZE_V1\n    lastInput: 0, pointers: new Map(), gesture: null, lastTap: { t: 0, x: 0, y: 0, key: "" },',
        "Universe-State fuer Mouse-Look",
    )

    app = replace_once(
        app,
        '''    } else if (S.pointers.size === 0) {\n      var v = S.vel;''',
        '''    } else if (S.pointers.size === 0) {\n      // Desktop: der Mauszeiger steuert die Blickrichtung bereits beim\n      // Bewegen/Positionieren, ohne dass eine Taste gehalten werden muss.\n      // In der Mitte ist eine kleine Ruhezone; Richtung Rand steigt das Tempo.\n      if (S.mouseLook && S.mouseLook.active && chaosFinePointer()) {\n        var lx = S.mouseLook.x, ly = S.mouseLook.y, dead = 0.12;\n        var ax = Math.abs(lx) > dead ? (Math.abs(lx) - dead) / (1 - dead) * (lx < 0 ? -1 : 1) : 0;\n        var ay = Math.abs(ly) > dead ? (Math.abs(ly) - dead) / (1 - dead) * (ly < 0 ? -1 : 1) : 0;\n        S.cam.x += ax * 0.00042 * dt * (1 + Math.abs(ax) * 0.75);\n        S.cam.y += ay * 0.00042 * dt * (1 + Math.abs(ay) * 0.75);\n        if (ax || ay) S.lastInput = now;\n      }\n      var v = S.vel;''',
        "Mouse-Look im Universe-Tick",
    )

    start = app.find("  function chaosUTap(x, y) {")
    end = app.find("\n\n  // ---- Geheim: Warp-Jagd", start)
    if start < 0 or end < 0:
        raise SystemExit("FEHLER: chaosUTap-Block nicht gefunden")
    new_tap = '''  function chaosUTap(x, y, pointerType) {\n    var S = chaosU, now = performance.now();\n    var sh = S.shoot;\n    if (sh && sh.hx !== undefined && Math.hypot(x - sh.hx, y - sh.hy) < 42) { S.shoot = null; chaosGameStart(); return; }\n    var hit = chaosUHitTest(x, y);\n    if (hit) {\n      // Touch bleibt direkt. Am Desktop verhindert ein einzelner Klick jetzt\n      // versehentliches Oeffnen: 1x fokussieren/anfahren, Doppelklick oeffnet.\n      if (pointerType !== "mouse") {\n        S.lastTap.t = 0;\n        if (hit.w >= CHAOS_U.BIG) { openModal(hit.it); return; }\n        var touchTargetD = CHAOS_U.ITEM_W * S.FOC / Math.min(S.W * 0.62, 260);\n        chaosUFlyTo(hit.x, hit.y, hit.z - touchTargetD, 900);\n        return;\n      }\n      var samePiece = S.lastTap.key === hit.key && now - S.lastTap.t < 360 &&\n        Math.hypot(x - S.lastTap.x, y - S.lastTap.y) < 36;\n      if (samePiece) {\n        S.lastTap = { t: 0, x: x, y: y, key: "" };\n        if (S.mouseLook) S.mouseLook.active = false;\n        openModal(hit.it);\n        return;\n      }\n      S.lastTap = { t: now, x: x, y: y, key: hit.key };\n      if (hit.w < CHAOS_U.BIG) {\n        var targetD = CHAOS_U.ITEM_W * S.FOC / Math.min(S.W * 0.62, 260);\n        chaosUFlyTo(hit.x, hit.y, hit.z - targetD, 720);\n      } else {\n        S.focusKey = hit.key; S.focusItem = hit.it;\n        chaosURequest();\n      }\n      return;\n    }\n    if (now - S.lastTap.t < 320 && !S.lastTap.key && Math.hypot(x - S.lastTap.x, y - S.lastTap.y) < 30) {\n      S.lastTap.t = 0;\n      chaosUZoomAt(x, y, 2.0);\n      return;\n    }\n    S.lastTap = { t: now, x: x, y: y, key: "" };\n  }'''
    app = app[:start] + new_tap + app[end:]

    app = replace_once(
        app,
        '''    chaosSky.addEventListener("pointerdown", function (e) {\n      var S = chaosU;\n      if (!S.active) return;\n      try { chaosSky.setPointerCapture(e.pointerId); } catch (err) {}''',
        '''    chaosSky.addEventListener("pointerdown", function (e) {\n      var S = chaosU;\n      if (!S.active) return;\n      // Rechts-/Mittelklick darf im Universum nie einen Artikel aktivieren.\n      if (e.pointerType === "mouse" && e.button !== 0) return;\n      if (S.mouseLook) S.mouseLook.active = false;\n      try { chaosSky.setPointerCapture(e.pointerId); } catch (err) {}''',
        "primaere Desktop-Pointersteuerung",
    )

    app = replace_once(
        app,
        '''      if (!S.pointers.has(e.pointerId) || !S.gesture) {\n        if (e.pointerType === "mouse" && !e.buttons) chaosUHover(p.x, p.y);\n        return;\n      }''',
        '''      if (!S.pointers.has(e.pointerId) || !S.gesture) {\n        if (e.pointerType === "mouse" && !e.buttons) {\n          chaosUHover(p.x, p.y);\n          // Position relativ zur Mitte (-1..1) treibt den Blick kontinuierlich.\n          S.mouseLook.active = true;\n          S.mouseLook.x = Math.max(-1, Math.min(1, (p.x - S.W / 2) / Math.max(1, S.W / 2)));\n          S.mouseLook.y = Math.max(-1, Math.min(1, (p.y - S.H / 2) / Math.max(1, S.H / 2)));\n          S.anim = null; S.vel.x = S.vel.y = S.vel.z = 0;\n          S.lastInput = performance.now();\n          chaosURequest();\n        }\n        return;\n      }''',
        "hover-basierter Mouse-Look",
    )

    app = replace_once(
        app,
        '        chaosUTap(local.x, local.y);',
        '        chaosUTap(local.x, local.y, e.pointerType);',
        "Pointertyp an Tap-Logik",
    )

    app = replace_once(
        app,
        '''    chaosSky.addEventListener("pointerleave", function (e) {\n      if (e.pointerType === "mouse") { chaosTooltip.classList.remove("visible"); chaosU.hoverKey = ""; }\n    });''',
        '''    chaosSky.addEventListener("pointerleave", function (e) {\n      if (e.pointerType === "mouse") {\n        chaosTooltip.classList.remove("visible"); chaosU.hoverKey = "";\n        if (chaosU.mouseLook) chaosU.mouseLook.active = false;\n      }\n    });''',
        "Mouse-Look bei Pointerleave stoppen",
    )

    app = replace_once(
        app,
        '''      // Trackpads melden viele kleine Schritte, Mausraeder wenige grosse\n      var delta = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;\n      chaosUZoomStep(p.x, p.y, Math.exp(-Math.max(-240, Math.min(240, delta)) * 0.0016));''',
        '''      // Trackpads melden viele kleine Schritte, Mausraeder wenige grosse.\n      // Sanftere Kurve + engeres Clamping verhindert das bisherige Springen.\n      var delta = e.deltaMode === 1 ? e.deltaY * 28 : e.deltaY;\n      delta = Math.max(-120, Math.min(120, delta));\n      if (Math.abs(delta) > 0.01) chaosUZoomStep(p.x, p.y, Math.exp(-delta * 0.00105));''',
        "sanfter Trackpad-Zoom",
    )

    app = replace_once(
        app,
        '''      else if (e.key === "ArrowLeft") chaosUFlyTo(S.cam.x - step, S.cam.y, S.cam.z, 240);\n      else if (e.key === "ArrowRight") chaosUFlyTo(S.cam.x + step, S.cam.y, S.cam.z, 240);\n      else if (e.key === "ArrowUp") chaosUFlyTo(S.cam.x, S.cam.y - step, S.cam.z, 240);\n      else if (e.key === "ArrowDown") chaosUFlyTo(S.cam.x, S.cam.y + step, S.cam.z, 240);''',
        '''      else if (e.key === "ArrowLeft") chaosUFlyTo(S.cam.x - step, S.cam.y, S.cam.z, 210);\n      else if (e.key === "ArrowRight") chaosUFlyTo(S.cam.x + step, S.cam.y, S.cam.z, 210);\n      else if (e.key === "ArrowUp") chaosUZoomAt(S.W / 2, S.H / 2, 1.35, 190);\n      else if (e.key === "ArrowDown") chaosUZoomAt(S.W / 2, S.H / 2, 1 / 1.35, 190);''',
        "Pfeiltasten-Zoom",
    )

    app = replace_once(
        app,
        '    S.pointers.clear(); S.gesture = null;\n    S.lastInput = performance.now();',
        '    S.pointers.clear(); S.gesture = null;\n    if (S.mouseLook) { S.mouseLook.active = false; S.mouseLook.x = 0; S.mouseLook.y = 0; }\n    S.lastInput = performance.now();',
        "Mouse-Look beim Start resetten",
    )
    app = replace_once(
        app,
        '    S.raf = 0; S.anim = null; S.gesture = null;\n    S.pointers.clear();',
        '    S.raf = 0; S.anim = null; S.gesture = null;\n    S.pointers.clear();\n    if (S.mouseLook) S.mouseLook.active = false;',
        "Mouse-Look beim Stoppen resetten",
    )

    replacements = [
        (
            'chaosSkyLabel: "Universum: Artikel im Raum. Zoomen mit zwei Fingern oder Mausrad, ziehen zum Umsehen, tippen oder klicken für Details. Tastatur: Pfeiltasten, Plus und Minus, Eingabe öffnet das Teil in der Mitte.",',
            'chaosSkyLabel: "Universum: Artikel im Raum. Am Desktop Maus bewegen zum Umsehen, Trackpad oder Mausrad zum Zoomen, Doppelklick öffnet ein Teil. Pfeil hoch und runter zoomt.",',
            "DE Universe-Aria",
        ),
        ('chaosHintMouse: "Mausrad: zoomen · Ziehen: umsehen · Klicken: hinfliegen",',
         'chaosHintMouse: "Maus bewegen: umsehen · Trackpad/Mausrad: zoomen · Doppelklick: öffnen",',
         "DE Mouse-Hint"),
        (
            'chaosSkyLabel: "Universe: pieces floating in space. Zoom with two fingers or the mouse wheel, drag to look around, tap or click for details. Keyboard: arrow keys, plus and minus, Enter opens the piece in the centre.",',
            'chaosSkyLabel: "Universe: pieces floating in space. On desktop move the mouse to look around, use the trackpad or wheel to zoom, double-click to open a piece. Arrow up and down zoom.",',
            "EN Universe-Aria",
        ),
        ('chaosHintMouse: "Wheel: zoom · Drag: look around · Click: fly there",',
         'chaosHintMouse: "Move mouse: look around · Trackpad/wheel: zoom · Double-click: open",',
         "EN Mouse-Hint"),
        (
            'chaosSkyLabel: "Univers : les pièces flottent dans l\'espace. Zoomer à deux doigts ou à la molette, glisser pour explorer, toucher ou cliquer pour les détails. Clavier : flèches, plus et moins, Entrée ouvre la pièce au centre.",',
            'chaosSkyLabel: "Univers : les pièces flottent dans l\'espace. Sur ordinateur, déplacez la souris pour explorer, utilisez le pavé tactile ou la molette pour zoomer et double-cliquez pour ouvrir une pièce.",',
            "FR Universe-Aria",
        ),
        ('chaosHintMouse: "Molette : zoomer · Glisser : explorer · Clic : s\'approcher",',
         'chaosHintMouse: "Déplacer la souris : explorer · Pavé/molette : zoomer · Double-clic : ouvrir",',
         "FR Mouse-Hint"),
    ]
    for old, new, label in replacements:
        app = replace_once(app, old, new, label)

    template = replace_once(
        template,
        '<canvas class="chaos-sky" id="chaosSky" tabindex="0" data-i18n-aria="chaosSkyLabel" aria-label="Universum: Artikel im Raum. Zoomen mit zwei Fingern oder Mausrad, ziehen zum Umsehen, tippen oder klicken für Details."></canvas>',
        '<canvas class="chaos-sky" id="chaosSky" tabindex="0" data-i18n-aria="chaosSkyLabel" aria-label="Universum: Maus bewegen zum Umsehen, Trackpad oder Mausrad zum Zoomen, Doppelklick öffnet ein Teil."></canvas>',
        "statisches Universe-Aria",
    )
    template = replace_once(
        template,
        '    <button type="button" class="view-enter-btn" id="chaosShuffle" data-i18n="chaosShuffle">Mischen</button>\n    <a href="/" class="view-enter-btn" data-enter-classic data-i18n="toArchive">Zum Archiv →</a>',
        '    <button type="button" class="view-enter-btn" id="chaosShuffle" data-i18n="chaosShuffle">Mischen</button>\n    <button type="button" class="view-enter-btn" data-d119-game-launch aria-label="Dodge the Drop starten">GAME</button>\n    <a href="/" class="view-enter-btn" data-enter-classic data-i18n="toArchive">Zum Archiv →</a>',
        "sichtbarer Game-Launcher",
    )

    APP.write_text(app, encoding="utf-8")
    TEMPLATE.write_text(template, encoding="utf-8")

    sys.path.insert(0, str(ROOT / "scripts"))
    import validate_shop
    validate_shop.init_mode_guard()
    print("Universe Desktop-Gaze, sanfter Zoom, sichere Klicklogik und GAME-Launcher angewendet.")


if __name__ == "__main__":
    main()

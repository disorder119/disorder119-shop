#!/usr/bin/env python3
"""Increase desktop Universe mouse responsiveness without changing interaction rules.

Strict/idempotent migration: only the known V1 mouse-look constants are changed.
After the exact transition, the protected mode guard is refreshed.
"""
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "assets" / "app.js"
MARKER_V1 = "UNIVERSE_DESKTOP_GAZE_V1"
MARKER_V2 = "UNIVERSE_DESKTOP_GAZE_V2"


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"FEHLER: {label} nicht eindeutig gefunden ({count})")
    return text.replace(old, new, 1)


def main() -> None:
    app = APP.read_text(encoding="utf-8")
    if MARKER_V2 in app:
        print("Universe Desktop-Reaktion V2 bereits aktuell.")
        return
    if MARKER_V1 not in app:
        raise SystemExit("FEHLER: Universe Desktop-Gaze V1 fehlt; V2 wird nicht blind angewendet")

    app = replace_once(
        app,
        "        var lx = S.mouseLook.x, ly = S.mouseLook.y, dead = 0.12;",
        "        var lx = S.mouseLook.x, ly = S.mouseLook.y, dead = 0.055; // UNIVERSE_DESKTOP_GAZE_V2",
        "kleinere Mouse-Look-Ruhezone",
    )
    app = replace_once(
        app,
        "        S.cam.x += ax * 0.00042 * dt * (1 + Math.abs(ax) * 0.75);",
        "        S.cam.x += ax * 0.00072 * dt * (1 + Math.abs(ax) * 1.05);",
        "schnellere horizontale Mausreaktion",
    )
    app = replace_once(
        app,
        "        S.cam.y += ay * 0.00042 * dt * (1 + Math.abs(ay) * 0.75);",
        "        S.cam.y += ay * 0.00072 * dt * (1 + Math.abs(ay) * 1.05);",
        "schnellere vertikale Mausreaktion",
    )
    app = replace_once(
        app,
        "      delta = Math.max(-120, Math.min(120, delta));\n      if (Math.abs(delta) > 0.01) chaosUZoomStep(p.x, p.y, Math.exp(-delta * 0.00105));",
        "      delta = Math.max(-140, Math.min(140, delta));\n      if (Math.abs(delta) > 0.01) chaosUZoomStep(p.x, p.y, Math.exp(-delta * 0.00145));",
        "reaktiver Trackpad-/Wheel-Zoom",
    )

    APP.write_text(app, encoding="utf-8")
    sys.path.insert(0, str(ROOT / "scripts"))
    import validate_shop
    validate_shop.init_mode_guard()
    print("Universe Desktop-Reaktion V2 angewendet: kleinere Ruhezone, ca. 70% mehr Mausreaktion und direkterer Zoom.")


if __name__ == "__main__":
    main()

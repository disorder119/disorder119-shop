#!/usr/bin/env python3
"""Intentionally enlarge the floating product pieces in Disorder119 Universe.

This is a protected creative-mode change. The script only accepts the exact
known Universe size constant, changes it once from 0.78 to 1.02 (~31%), and
refreshes the mode guard only when that exact change was performed by this
script. This keeps visual size, touch hit-testing and fly-to math in sync.
"""
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "assets" / "app.js"
sys.path.insert(0, str(ROOT / "scripts"))

OLD = "    ITEM_W: 0.78,   // Breite eines Fotos in Raumeinheiten (inkl. transparentem Rand)"
NEW = "    ITEM_W: 1.02,   // UNIVERSE_PIECE_SCALE_V1: ~31% groesser, inkl. Touch-/Hitbox-Geometrie"


def main() -> None:
    text = APP.read_text(encoding="utf-8")
    if NEW in text:
        if OLD in text:
            raise SystemExit("FEHLER: alte und neue Universe-Groesse gleichzeitig vorhanden")
        print("Universe-Pieces bereits auf 1.02 skaliert.")
        return

    count = text.count(OLD)
    if count != 1:
        raise SystemExit(f"FEHLER: erwartete Universe-Groesse 0.78 nicht eindeutig gefunden ({count})")

    text = text.replace(OLD, NEW, 1)
    APP.write_text(text, encoding="utf-8")

    # Deliberately acknowledge exactly this protected Chaos/Universe change.
    # Do this only on the transition above; never auto-bless unrelated changes.
    import validate_shop
    validate_shop.init_mode_guard()

    verify = APP.read_text(encoding="utf-8")
    if NEW not in verify or "ITEM_W: 0.78" in verify:
        raise SystemExit("FEHLER: Universe-Piece-Skalierung wurde nicht sauber angewendet")
    print("Universe-Pieces: 0.78 -> 1.02 (~31% groesser); Mode-Guard bewusst aktualisiert.")


if __name__ == "__main__":
    main()

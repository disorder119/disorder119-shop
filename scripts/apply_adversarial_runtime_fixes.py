#!/usr/bin/env python3
"""Apply only runtime fixes proven by adversarial browser tests.

The protected Match/Chaos/Baukasten JS and markup are not modified. This patch
only corrects shared overlay layering so an open Baukasten picker cannot have
its close control intercepted by the one-time global mode hint.
"""
from pathlib import Path

BASE = Path(__file__).resolve().parents[1]
CSS = BASE / "assets" / "app.css"
MARKER = "ADVERSARIAL_MODAL_LAYERING"

OVERRIDE = r'''

  /* ADVERSARIAL_MODAL_LAYERING
     The one-time global mode hint is z-index 281 while the Baukasten picker
     used 260. On a first visit the hint's close button could therefore sit on
     top of the open picker and intercept its close control. Keep the fixed
     mode rail (300) above everything, but place an *open* picker above the
     hint. No layout, styling or protected-mode behaviour changes. */
  .outfit-picker.open { z-index: 290; }
'''


def main() -> None:
    text = CSS.read_text(encoding="utf-8")
    if MARKER in text:
        print("Adversarial Runtime-Fixes bereits aktuell.")
        return
    CSS.write_text(text.rstrip() + OVERRIDE + "\n", encoding="utf-8")
    print("Adversarial Runtime-Fix angewendet: Modal-Layering des Baukasten-Pickers.")


if __name__ == "__main__":
    main()

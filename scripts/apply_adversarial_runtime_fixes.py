#!/usr/bin/env python3
"""Apply only runtime fixes proven by adversarial browser tests.

The protected Match/Chaos/Baukasten JS and markup are not modified. The fixes
only correct shared overlay layering where a globally fixed helper/navigation
layer was proven to intercept an open modal control in real Chromium.
"""
from pathlib import Path

BASE = Path(__file__).resolve().parents[1]
CSS = BASE / "assets" / "app.css"
PICKER_MARKER = "ADVERSARIAL_MODAL_LAYERING"
QUICKVIEW_MARKER = "ADVERSARIAL_QUICKVIEW_LAYERING"

PICKER_OVERRIDE = r'''

  /* ADVERSARIAL_MODAL_LAYERING
     The one-time global mode hint is z-index 281 while the Baukasten picker
     used 260. On a first visit the hint's close button could therefore sit on
     top of the open picker and intercept its close control. Keep the fixed
     mode rail (300) above the picker, but place an *open* picker above the
     hint. No layout, styling or protected-mode behaviour changes. */
  .outfit-picker.open { z-index: 290; }
'''

QUICKVIEW_OVERRIDE = r'''

  /* ADVERSARIAL_QUICKVIEW_LAYERING
     The shared product quickview used z-index 50 while the global mode rail is
     300. In Chaos this allowed a rail tab to physically cover the modal close
     button. A modal must own pointer/focus interaction while open, so only the
     open backdrop is raised above the rail. */
  .modal-backdrop.open { z-index: 320; }
'''


def main() -> None:
    text = CSS.read_text(encoding="utf-8")
    changed = []
    if PICKER_MARKER not in text:
        text = text.rstrip() + PICKER_OVERRIDE + "\n"
        changed.append("Baukasten-Picker vs. Erstbesuchs-Hinweis")
    if QUICKVIEW_MARKER not in text:
        text = text.rstrip() + QUICKVIEW_OVERRIDE + "\n"
        changed.append("Quickview vs. Modusleiste")
    if not changed:
        print("Adversarial Runtime-Fixes bereits aktuell.")
        return
    CSS.write_text(text, encoding="utf-8")
    print("Adversarial Runtime-Fixes angewendet: " + ", ".join(changed) + ".")


if __name__ == "__main__":
    main()

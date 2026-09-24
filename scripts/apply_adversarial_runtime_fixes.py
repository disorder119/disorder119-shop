#!/usr/bin/env python3
"""Apply runtime fixes proven by adversarial/browser review.

Shared overlay fixes remain narrowly scoped. Intentional Universe changes are
delegated to guarded migrations so protected creative-mode hashes are refreshed
only for exact, reviewed transitions.
"""
from pathlib import Path
import subprocess
import sys

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


def run_guarded(script_name: str) -> None:
    script = BASE / "scripts" / script_name
    subprocess.run([sys.executable, str(script)], cwd=BASE, check=True)


def main() -> None:
    text = CSS.read_text(encoding="utf-8")
    changed = []
    if PICKER_MARKER not in text:
        text = text.rstrip() + PICKER_OVERRIDE + "\n"
        changed.append("Baukasten-Picker vs. Erstbesuchs-Hinweis")
    if QUICKVIEW_MARKER not in text:
        text = text.rstrip() + QUICKVIEW_OVERRIDE + "\n"
        changed.append("Quickview vs. Modusleiste")
    if changed:
        CSS.write_text(text, encoding="utf-8")
        print("Adversarial Runtime-Fixes angewendet: " + ", ".join(changed) + ".")
    else:
        print("Adversarial Runtime-Fixes bereits aktuell.")

    run_guarded("apply_universe_piece_scale.py")
    run_guarded("apply_universe_desktop_controls.py")
    run_guarded("apply_universe_desktop_response_v2.py")
    run_guarded("apply_zero_g_cache_refresh.py")


if __name__ == "__main__":
    main()

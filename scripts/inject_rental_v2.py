#!/usr/bin/env python3
"""Inject the Rental V2 frontend into every generated bundle page.

The bundle pages all load assets/rental-commerce.js. Product detail pages use a
separate article shell and are intentionally untouched here. Running this after
build_site.py makes the integration deterministic without changing protected
Match, Chaos or Baukasten source blocks.
"""
from pathlib import Path

BASE = Path(__file__).resolve().parents[1]
BRIDGE = '<script src="/assets/rental-commerce.js"></script>'
V2 = '<script src="/assets/rental-v2.js"></script>'


def main() -> None:
    changed = 0
    seen = 0
    for path in BASE.rglob("*.html"):
        # Generated article pages do not load the bundle bridge and are skipped.
        text = path.read_text(encoding="utf-8")
        if BRIDGE not in text:
            continue
        seen += 1
        clean = text.replace("\n" + V2, "").replace(V2 + "\n", "").replace(V2, "")
        clean = clean.replace(BRIDGE, BRIDGE + "\n" + V2, 1)
        if clean != text:
            path.write_text(clean, encoding="utf-8")
            changed += 1
    if not seen:
        raise SystemExit("FEHLER: Keine generierte Bundle-Seite mit rental-commerce.js gefunden.")
    print(f"Rental V2 eingebunden: {changed} aktualisiert, {seen} Bundle-Seiten geprüft.")


if __name__ == "__main__":
    main()

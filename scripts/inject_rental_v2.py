#!/usr/bin/env python3
"""Inject the single Rental V2 frontend into every generated bundle page.

The normal archive pages are identified by the catalog-filter helper. Legacy
rental-commerce.js and the interception-only rental-v2-bundle.js are removed
from generated pages. Product detail pages use a separate article shell.
"""
from pathlib import Path

BASE = Path(__file__).resolve().parents[1]
ANCHOR = '<script src="/assets/catalog-filter-simplify.js"></script>'
LEGACY_BRIDGE = '<script src="/assets/rental-commerce.js"></script>'
V2 = '<script src="/assets/rental-v2.js"></script>'
V2_UI = '<script src="/assets/rental-v2-ui.js"></script>'
V2_PICKER = '<script src="/assets/rental-v2-picker.js"></script>'
LEGACY_BUNDLE = '<script src="/assets/rental-v2-bundle.js"></script>'


def remove_script(text: str, script: str) -> str:
    return text.replace("\n" + script, "").replace(script + "\n", "").replace(script, "")


def main() -> None:
    changed = 0
    seen = 0
    for path in BASE.rglob("*.html"):
        text = path.read_text(encoding="utf-8")
        if ANCHOR not in text:
            continue
        seen += 1
        clean = text
        for script in (LEGACY_BRIDGE, V2, V2_UI, V2_PICKER, LEGACY_BUNDLE):
            clean = remove_script(clean, script)
        clean = clean.replace(ANCHOR, ANCHOR + "\n" + V2 + "\n" + V2_UI + "\n" + V2_PICKER, 1)
        if LEGACY_BRIDGE in clean or LEGACY_BUNDLE in clean:
            raise SystemExit(f"FEHLER: Legacy-Rental-Script blieb in {path.relative_to(BASE)} erhalten.")
        if clean != text:
            path.write_text(clean, encoding="utf-8")
            changed += 1
    if not seen:
        raise SystemExit("FEHLER: Keine generierte Bundle-Seite mit catalog-filter-simplify.js gefunden.")
    print(f"Single Rental V2 + UI + Picker eingebunden: {changed} aktualisiert, {seen} Bundle-Seiten geprüft.")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Inject context-aware simplified archive filters into generated bundle pages."""
from pathlib import Path

BASE = Path(__file__).resolve().parents[1]
APP = '<script src="/assets/app.js'
SCRIPT = '<script src="/assets/catalog-filter-simplify.js"></script>'


def main() -> None:
    seen = 0
    changed = 0
    for path in BASE.rglob("*.html"):
        text = path.read_text(encoding="utf-8")
        if APP not in text or 'id="filterPanel"' not in text:
            continue
        seen += 1
        clean = text.replace("\n" + SCRIPT, "").replace(SCRIPT + "\n", "").replace(SCRIPT, "")
        # app.js carries a content-hash query string; insert after its complete tag.
        marker_start = clean.find(APP)
        marker_end = clean.find("</script>", marker_start)
        if marker_start < 0 or marker_end < 0:
            raise SystemExit(f"FEHLER: app.js-Script in {path.relative_to(BASE)} nicht sauber gefunden")
        marker_end += len("</script>")
        clean = clean[:marker_end] + "\n" + SCRIPT + clean[marker_end:]
        if clean != text:
            path.write_text(clean, encoding="utf-8")
            changed += 1
    if not seen:
        raise SystemExit("FEHLER: Keine generierte Archivseite mit Filterpanel gefunden.")
    print(f"Vereinfachte kontextabhaengige Archivfilter eingebunden: {changed} aktualisiert, {seen} Seiten geprueft.")


if __name__ == "__main__":
    main()

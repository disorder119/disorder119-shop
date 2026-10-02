#!/usr/bin/env python3
"""Inject context-aware simplified archive filters into generated bundle pages.

Dazu die Kategorie-Leiste und die Chip-Filter (assets/archiv-navigation.js):
sie bauen auf den vereinfachten Filtern auf und kommen deshalb direkt danach.
"""
from hashlib import sha256
from pathlib import Path

BASE = Path(__file__).resolve().parents[1]
APP = '<script src="/assets/app.js'
SCRIPT = '<script src="/assets/catalog-filter-simplify.js"></script>'
NAV_PREFIX = '<script src="/assets/archiv-navigation.js'


def nav_script() -> str:
    # Versionsnummer aus dem Inhalt: ein geaendertes Skript erreicht sofort
    # jeden Browser, ein unveraendertes bleibt im Cache.
    version = sha256((BASE / "assets" / "archiv-navigation.js").read_bytes()).hexdigest()[:10]
    return f'{NAV_PREFIX}?v={version}"></script>'


def strip_nav(text: str) -> str:
    start = text.find(NAV_PREFIX)
    while start >= 0:
        end = text.find("</script>", start)
        if end < 0:
            break
        end += len("</script>")
        if text[end:end + 1] == "\n":
            end += 1
        elif start > 0 and text[start - 1] == "\n":
            start -= 1
        text = text[:start] + text[end:]
        start = text.find(NAV_PREFIX)
    return text


def main() -> None:
    seen = 0
    changed = 0
    nav = nav_script()
    for path in BASE.rglob("*.html"):
        text = path.read_text(encoding="utf-8")
        if APP not in text or 'id="filterPanel"' not in text:
            continue
        seen += 1
        clean = text.replace("\n" + SCRIPT, "").replace(SCRIPT + "\n", "").replace(SCRIPT, "")
        clean = strip_nav(clean)
        # app.js carries a content-hash query string; insert after its complete tag.
        marker_start = clean.find(APP)
        marker_end = clean.find("</script>", marker_start)
        if marker_start < 0 or marker_end < 0:
            raise SystemExit(f"FEHLER: app.js-Script in {path.relative_to(BASE)} nicht sauber gefunden")
        marker_end += len("</script>")
        clean = clean[:marker_end] + "\n" + SCRIPT + "\n" + nav + clean[marker_end:]
        if clean != text:
            path.write_text(clean, encoding="utf-8")
            changed += 1
    if not seen:
        raise SystemExit("FEHLER: Keine generierte Archivseite mit Filterpanel gefunden.")
    print(f"Vereinfachte kontextabhaengige Archivfilter eingebunden: {changed} aktualisiert, {seen} Seiten geprueft.")


if __name__ == "__main__":
    main()

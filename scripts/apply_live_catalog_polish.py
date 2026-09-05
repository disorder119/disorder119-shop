#!/usr/bin/env python3
"""Apply small live-catalog polish outside protected Match/Chaos/Baukasten blocks."""
from __future__ import annotations

from pathlib import Path

BASE = Path(__file__).resolve().parents[1]
APP_JS = BASE / "assets" / "app.js"

REPLACEMENTS = {
    'searchPlaceholder: "Suche nach Marke, Titel"': 'searchPlaceholder: "Suche nach Marke, Artikel, Größe"',
    'searchPlaceholder: "Search by brand, title"': 'searchPlaceholder: "Search by brand, item, size"',
    'searchPlaceholder: "Recherche par marque, titre"': 'searchPlaceholder: "Recherche par marque, article, taille"',
}


def main() -> None:
    text = APP_JS.read_text(encoding="utf-8")
    original = text
    for old, new in REPLACEMENTS.items():
        if new in text:
            continue
        if old not in text:
            raise SystemExit(f"FEHLER: Live-Polish-Marker fehlt: {old}")
        text = text.replace(old, new, 1)
    if text != original:
        APP_JS.write_text(text, encoding="utf-8")
        print("Live-Katalog-Polish: Suchhinweise DE/EN/FR aktualisiert.")
    else:
        print("Live-Katalog-Polish: bereits aktuell.")


if __name__ == "__main__":
    main()

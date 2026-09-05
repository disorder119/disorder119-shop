#!/usr/bin/env python3
"""Regression checks for live catalog polish and verified source-data repairs."""
from __future__ import annotations

import json
from pathlib import Path

BASE = Path(__file__).resolve().parents[1]
APP_JS = BASE / "assets" / "app.js"
ITEMS_PATH = BASE / "data" / "items.json"


def fail(message: str) -> None:
    raise SystemExit("FEHLER: " + message)


def main() -> None:
    app = APP_JS.read_text(encoding="utf-8")
    items = json.loads(ITEMS_PATH.read_text(encoding="utf-8"))
    by_id = {int(item["id"]): item for item in items}

    for expected in (
        'searchPlaceholder: "Suche nach Marke, Artikel, Größe"',
        'searchPlaceholder: "Search by brand, item, size"',
        'searchPlaceholder: "Recherche par marque, article, taille"',
    ):
        if expected not in app:
            fail(f"aktueller Suchhinweis fehlt: {expected}")

    for stale in (
        'searchPlaceholder: "Suche nach Marke, Titel"',
        'searchPlaceholder: "Search by brand, title"',
        'searchPlaceholder: "Recherche par marque, titre"',
    ):
        if stale in app:
            fail(f"veralteter Suchhinweis ist wieder vorhanden: {stale}")

    item = by_id.get(9536)
    if not item:
        fail("Artikel 9536 fehlt")
    if item.get("brand") != "Y's":
        fail("Artikel 9536 muss strukturiert der Marke Y's zugeordnet sein")
    if not str(item.get("title", "")).startswith("Y's "):
        fail("Artikel 9536 Titel/Markenbezug ist unerwartet")

    print("Live-Katalog-Polish: OK – Suchhinweise korrekt und Y's-Markenfehler repariert.")


if __name__ == "__main__":
    main()

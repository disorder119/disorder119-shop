#!/usr/bin/env python3
"""Erzeugt shop-worker/catalog-number-routes.js aus config/catalog-number-links.json.

Die Storefront leitet alte Shop-IDs (/artikel/9642/) per 301 auf die
Artikelnummer (/artikel/280/) weiter. Die Tabelle wurde bisher von Hand
gepflegt und lief der Konfiguration hinterher (06.11.2026: 9601-9642 fehlten).
Jetzt ist die Konfiguration die einzige Quelle; der Test
shop-worker/catalog-number-routes.test.mjs prueft, dass beide gleich sind.
Ausgeschlossene IDs (excluded_shop_ids) bekommen keine Weiterleitung.

Aufruf: python scripts/sync_catalog_number_routes.py
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONFIG = ROOT / "config" / "catalog-number-links.json"
ZIEL = ROOT / "shop-worker" / "catalog-number-routes.js"


def routen(config):
    ausgeschlossen = {str(i) for i in config.get("excluded_shop_ids", [])}
    out = {}
    for link in config.get("links", []):
        shop_id, artikel = str(link.get("shop_id", "")).strip(), str(link.get("article", "")).strip()
        if not shop_id.isdigit() or not artikel.isdigit() or shop_id in ausgeschlossen or shop_id == artikel:
            continue
        out[shop_id] = artikel
    return out


def main():
    config = json.loads(CONFIG.read_text(encoding="utf-8"))
    tabelle = routen(config)
    inhalt = "export const ARTICLE_NUMBER_ROUTES = Object.freeze(" + json.dumps(tabelle, separators=(",", ":")) + ");\n"
    alt = ZIEL.read_text(encoding="utf-8") if ZIEL.exists() else ""
    if alt != inhalt:
        ZIEL.write_text(inhalt, encoding="utf-8", newline="\n")
        print(f"catalog-number-routes.js aktualisiert: {len(tabelle)} Weiterleitungen")
    else:
        print(f"catalog-number-routes.js unveraendert: {len(tabelle)} Weiterleitungen")


if __name__ == "__main__":
    main()

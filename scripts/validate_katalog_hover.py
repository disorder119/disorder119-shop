#!/usr/bin/env python3
"""Prueft das Hover-Bild der Katalogkacheln: nie ein Etikett, nie unfreigestellt.

Beim Ueberfahren einer Kachel zeigte die Seite bisher immer das zweite
Galeriefoto. Bei rund 40 Artikeln war das ein Marken- oder Pflegeetikett,
eine Nahaufnahme oder ein Foto mit Studiohintergrund (Meldung vom
17.09.2026). build_site.py waehlt das Foto jetzt ueber die Freistellmaske
aus und legt es als hover_image in data/catalog.json ab; assets/app.js zeigt
ausschliesslich dieses Foto.
"""
from __future__ import annotations

import json
from pathlib import Path

BASE = Path(__file__).resolve().parents[1]
APP_JS = BASE / "assets" / "app.js"
CATALOG_PATH = BASE / "data" / "catalog.json"

# Artikel aus der Meldung: Hysteric Glamour Top, Prada Jacke Beige Ohne
# Kapuze, Kiko Kostadinov Weste, Prada Jacke (500 EUR). Ihr zweites
# Galeriefoto ist ein Etikett bzw. ein Markenaufnaeher und darf beim
# Ueberfahren nie wieder erscheinen.
GEMELDET = (9399, 9492, 9451, 9410)


def fail(message: str) -> None:
    raise SystemExit("FEHLER: " + message)


def main() -> None:
    app = APP_JS.read_text(encoding="utf-8")
    if "assetUrl(it.gallery[1])" in app:
        fail("assets/app.js zeigt beim Ueberfahren wieder stur das zweite Galeriefoto")
    if "it.hover_image" not in app:
        fail("assets/app.js nutzt das gepruefte hover_image nicht mehr")

    from PIL import Image  # in der CI installiert (pip install pillow)

    catalog = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    if not catalog:
        fail("data/catalog.json ist leer")
    by_id = {int(row["id"]): row for row in catalog}
    mit_hover = 0
    for row in catalog:
        hover = row.get("hover_image")
        if not hover:
            continue  # kein passendes Foto: Kachel bleibt beim Ueberfahren stehen
        gallery = row.get("gallery") or []
        if hover not in gallery[1:]:
            fail(f"Artikel {row.get('id')}: hover_image {hover} steht nicht in der Galerie")
        datei = BASE / hover
        if not datei.is_file():
            fail(f"Artikel {row.get('id')}: hover_image {hover} fehlt auf der Platte")
        with Image.open(datei) as im:
            if im.mode != "RGBA":
                fail(f"Artikel {row.get('id')}: hover_image {hover} ist nicht freigestellt")
        mit_hover += 1

    for artikel in GEMELDET:
        row = by_id.get(artikel)
        if not row:
            continue  # Artikel verkauft oder entfernt
        gallery = row.get("gallery") or []
        hover = row.get("hover_image")
        if hover and len(gallery) > 1 and hover == gallery[1]:
            fail(f"Artikel {artikel}: beim Ueberfahren erscheint wieder das gemeldete Etikettfoto")

    print(f"Katalog-Hover: OK - {mit_hover} von {len(catalog)} Artikeln mit freigestelltem Hover-Bild.")


if __name__ == "__main__":
    main()

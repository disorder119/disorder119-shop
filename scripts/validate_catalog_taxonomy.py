#!/usr/bin/env python3
"""Regression validation for the reviewed Disorder119 catalogue taxonomy."""
from __future__ import annotations

import json
from pathlib import Path

from catalog_taxonomy import DEPARTMENTS, TAXONOMY_CATEGORIES

BASE = Path(__file__).resolve().parents[1]
ITEMS_PATH = BASE / "data" / "items.json"
CATALOG_PATH = BASE / "data" / "catalog.json"
REPORT_PATH = BASE / "data" / "catalog-taxonomy-report.json"
REQUIRED = {
    "department", "product_type", "taxonomy_category", "size_normalized",
    "size_source", "taxonomy_confidence", "taxonomy_reviewed",
}


def fail(message: str) -> None:
    raise SystemExit("FEHLER: " + message)


def main() -> None:
    items = json.loads(ITEMS_PATH.read_text(encoding="utf-8"))
    by_id = {int(item["id"]): item for item in items}
    if len(by_id) != len(items):
        fail("doppelte Item-ID in data/items.json")

    for item in items:
        missing = REQUIRED - set(item)
        if missing:
            fail(f"Taxonomie fehlt bei {item.get('id')}: {sorted(missing)}")
        if item["department"] not in DEPARTMENTS:
            fail(f"ungültiger Bereich bei {item['id']}: {item['department']}")
        if item["taxonomy_category"] not in TAXONOMY_CATEGORIES:
            fail(f"ungültige Taxonomie-Kategorie bei {item['id']}: {item['taxonomy_category']}")
        if not str(item["product_type"]).strip():
            fail(f"Produkttyp fehlt bei {item['id']}")
        if not str(item["size_normalized"]).strip():
            fail(f"normalisierte Größe fehlt bei {item['id']}")
        if item["taxonomy_reviewed"] is not True:
            fail(f"Artikel {item['id']} nicht als geprüft markiert")

    # Known high-value/manual-review cases. These lock in the actual findings
    # from the article-by-article pass rather than only testing generic rules.
    expected = {
        6240: ("Objects", "Toaster", "Objects"),
        9463: ("Women", "Heels", "Shoes"),
        9386: ("Unisex", "Hat", "Accessories"),
        9434: ("Men", "Sweatshirt", "Knitwear"),
        6202: ("Kids", "Jacket", "Jackets"),
        6235: ("Men", "Sneakers", "Shoes"),
        9524: ("Women", "Bomber Jacket", "Jackets"),
        9534: ("Men", "Shoes", "Shoes"),
        9432: ("Women", "Underwear Shorts", "Pants"),
        6042: ("Men", "Skirt", "Skirts"),
    }
    for item_id, wanted in expected.items():
        row = by_id.get(item_id)
        if not row:
            fail(f"geprüfter Referenzartikel {item_id} fehlt")
        got = (row["department"], row["product_type"], row["taxonomy_category"])
        if got != wanted:
            fail(f"Taxonomie bei {item_id} unerwartet: {got!r} statt {wanted!r}")

    # The old field must remain unchanged for protected modes even where it is
    # clearly wrong; the new field carries the corrected classification.
    legacy_expected = {
        6240: "Accessories",
        9463: "Tops",
        9386: "Tops",
        9434: "Objects",
    }
    for item_id, category in legacy_expected.items():
        if by_id[item_id].get("category") != category:
            fail(f"geschützte Legacy-Kategorie bei {item_id} wurde verändert")

    # Description-derived label sizes prove the detailed text is actually used.
    if str(by_id[9510].get("label_size")) != "3":
        fail("Balenciaga SNCF Weste: Labelgröße 3 nicht aus Beschreibung erkannt")
    if str(by_id[9538].get("label_size")) != "40":
        fail("Gucci Herrenblazer: Labelgröße 40 nicht aus Beschreibung erkannt")

    report = json.loads(REPORT_PATH.read_text(encoding="utf-8"))
    if report.get("totalItems") != len(items) or report.get("reviewedItems") != len(items):
        fail("Taxonomie-Report deckt nicht alle Artikel ab")
    if report.get("schema") != "catalog-taxonomy-v1":
        fail("unerwartete Taxonomie-Report-Version")

    catalog = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    public_expected = sum(1 for item in items if item.get("public_status") != "DRAFT")
    if len(catalog) != public_expected:
        fail(f"catalog.json enthält {len(catalog)} statt {public_expected} öffentliche Artikel")
    for row in catalog:
        missing = REQUIRED - set(row)
        if missing:
            fail(f"Browser-Taxonomie fehlt bei {row.get('id')}: {sorted(missing)}")

    page_count = 0
    for item in items:
        for lang in ("de", "en", "fr"):
            root = BASE if lang == "de" else BASE / lang
            page = root / "artikel" / str(item["id"]) / "index.html"
            if not page.exists():
                fail(f"Produktseite fehlt: {page.relative_to(BASE)}")
            html = page.read_text(encoding="utf-8")
            if 'data-taxonomy-fact="department"' not in html or 'data-taxonomy-fact="product-type"' not in html:
                fail(f"Taxonomie-Fakten fehlen auf {page.relative_to(BASE)}")
            if '"department":' not in html or '"product_type":' not in html:
                fail(f"ARTICLE_ITEM-Taxonomie fehlt auf {page.relative_to(BASE)}")
            page_count += 1

    print(
        "Katalog-Taxonomie: OK – "
        f"{len(items)} Artikel vollständig klassifiziert, {len(catalog)} öffentlich, "
        f"{page_count} Sprach-Produktseiten geprüft; "
        f"{report.get('missingSizeCount', 0)} Größe(n) bleiben bewusst unbekannt."
    )


if __name__ == "__main__":
    main()

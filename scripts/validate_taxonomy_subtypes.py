#!/usr/bin/env python3
"""Hard regression gate for reviewed jacket-vs-vest product subtypes."""
from __future__ import annotations

import json
from pathlib import Path

BASE = Path(__file__).resolve().parents[1]


def fail(message: str) -> None:
    raise SystemExit("FEHLER: Taxonomie-Subtype: " + message)


def require(condition: bool, message: str) -> None:
    if not condition:
        fail(message)


def main() -> None:
    taxonomy = (BASE / "scripts" / "catalog_taxonomy.py").read_text(encoding="utf-8")
    require("TAXONOMY_SUBTYPE_AUDIT_20260906" in taxonomy, "reviewter Subtype-Fix fehlt")
    require(r'(r"\bvest\b|\bweste\b|\bveste\b", "Vest")' not in taxonomy,
            "französisches 'veste' wird weiterhin als Weste klassifiziert")

    catalog = json.loads((BASE / "data" / "catalog.json").read_text(encoding="utf-8"))
    by_id = {int(item["id"]): item for item in catalog}

    expected = {
        9512: "Jacket",
        9500: "Jacket",
        9454: "Jacket",
        9443: "Jacket",
        9442: "Jacket",
        9417: "Vest",
    }
    for item_id, product_type in expected.items():
        item = by_id.get(item_id)
        require(item is not None, f"Artikel {item_id} fehlt im öffentlichen Katalog")
        require(item.get("taxonomy_category") == "Jackets",
                f"Artikel {item_id} ist nicht mehr in der Broad-Category Jackets")
        require(item.get("product_type") == product_type,
                f"Artikel {item_id}: {item.get('product_type')!r} statt {product_type!r}")

    # End-to-end: generated DE pages must show the same subtype and JSON-LD
    # additionalProperty value as catalog.json.
    de_label = {"Jacket": "Jacke", "Vest": "Weste"}
    for item_id, product_type in expected.items():
        page = BASE / "artikel" / str(item_id) / "index.html"
        require(page.is_file(), f"Produktseite artikel/{item_id}/ fehlt")
        html = page.read_text(encoding="utf-8")
        label = de_label[product_type]
        require(
            f'<div data-taxonomy-fact="product-type"><div class="fact__label">Produkttyp</div><div class="fact__value">{label}</div></div>' in html,
            f"Artikel {item_id}: sichtbarer Produkttyp ist nicht {label}",
        )
        require(f'"name": "Product type", "value": "{label}"' in html,
                f"Artikel {item_id}: JSON-LD Produkttyp ist nicht {label}")

    print("Taxonomie-Subtype: OK — 5 geprüfte Jacken bleiben Jacken; Y-3 Veste bleibt echte Weste.")


if __name__ == "__main__":
    main()

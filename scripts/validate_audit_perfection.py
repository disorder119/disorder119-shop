#!/usr/bin/env python3
"""Regression checks for the final Disorder119 audit-perfection pass.

These checks target bugs that can stay invisible while generic syntax/SEO tests
remain green: iOS native select options with zero hits, duplicate rental flows,
zero-priced purchase inquiries and semantically impossible taxonomy results.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

BASE = Path(__file__).resolve().parents[1]


def fail(message: str) -> None:
    raise SystemExit("FEHLER: Audit-Perfection: " + message)


def text(rel: str) -> str:
    return (BASE / rel).read_text(encoding="utf-8")


def require(condition: bool, message: str) -> None:
    if not condition:
        fail(message)


def validate_zero_hit_facets() -> None:
    app = text("assets/app.js")
    helper = text("assets/catalog-filter-simplify.js")
    require("AUDIT_PERFECT_NATIVE_FACETS" in app, "native Facet-Rebuild fehlt")
    require("while (selectEl.options.length > 1) selectEl.remove(1);" in app, "Facet-Optionen werden nicht neu aufgebaut")
    require("if (count === 0 && value !== selectedValue) return;" in app, "0-Treffer-Optionen bleiben im nativen Select")
    require("AUDIT_PERFECT_IOS_ZERO_OPTIONS" in helper, "iOS-Sicherheitsnetz fuer 0-Treffer fehlt")
    require("select.remove(i);" in helper, "0-Treffer werden nicht physisch aus dem DOM entfernt")


def validate_single_rental_architecture() -> None:
    app = text("assets/app.js")
    template = text("index_template.html")
    rental = text("assets/rental-v2.js")

    for needle in (
        "function openRentalModal(",
        "rentalModalBackdrop",
        "RENTAL_PURPOSE_KEYS",
        "openRentalModal(rentalItemId)",
    ):
        require(needle not in app, f"Legacy-Rental-Code ist noch aktiv: {needle}")
    require('id="rentalModalBackdrop"' not in template, "altes Single-Rental-Modal ist noch im Template")
    require("AUDIT_PERFECT_RENTAL_V2_ONLY" in app, "Rental-V2-only Marker fehlt")
    require("AUDIT_PERFECT_RENTAL_V2_ONLY" in template, "Rental-V2-only Template-Marker fehlt")
    require("queryItemRequested" in rental, "Produktseiten-Deep-Link wird nicht von Rental V2 uebernommen")
    require("AUDIT_PERFECT_RENTAL_AUTO_OPEN" in rental, "Rental-V2-Deep-Link oeffnet die Mietanfrage nicht")
    require("state.ids.indexOf(queryItemRequested) >= 0) openOverlay();" in rental, "Deep-Link oeffnet nicht gezielt Rental V2")


def validate_purchase_price_on_request() -> None:
    app = text("assets/app.js")
    article = text("assets/article.js")
    require("AUDIT_PERFECT_CART_TOTAL" in app, "Warenkorb kennt keine teilweise offenen Preise")
    require("rows.push(fmtPriceDisplay(it.price));" in app, "Warenkorb-Anfragetext kann 0,00 EUR ausgeben")
    require("fmtPriceDisplay(it.price) + \"</span>\"" in app, "Warenkorbzeile kann 0,00 EUR ausgeben")
    require("cartTotalDisplay(total, hasUnknownPrice)" in app, "Warenkorb-Gesamt ignoriert offene Preise")
    require("AUDIT_PERFECT_ARTICLE_PRICE_REQUEST" in article, "Direktanfrage kann 0,00 EUR ausgeben")


def validate_semantic_taxonomy() -> None:
    catalog = json.loads(text("data/catalog.json"))
    by_id = {int(item["id"]): item for item in catalog}

    # These were verified false classifications in the audit. They must never
    # silently regress even if descriptions are edited later.
    expected = {
        9519: ("Top", "Tops"),
        9527: ("Top", "Tops"),
        9512: ("Jacket", "Jackets"),
        9511: ("Jacket", "Jackets"),
        9508: ("Top", "Tops"),
        9500: ("Jacket", "Jackets"),
        9496: ("Polo Shirt", "Shirts"),
        9499: ("Jacket", "Jackets"),
        9462: ("Skirt", "Skirts"),
        9442: ("Jacket", "Jackets"),
        9454: ("Jacket", "Jackets"),
        9443: ("Jacket", "Jackets"),
        9401: ("Top", "Tops"),
    }
    for item_id, (ptype, category) in expected.items():
        item = by_id.get(item_id)
        require(item is not None, f"Katalogartikel {item_id} fehlt")
        require(item.get("product_type") == ptype, f"Artikel {item_id}: Produkttyp {item.get('product_type')!r} statt {ptype!r}")
        require(item.get("taxonomy_category") == category, f"Artikel {item_id}: Kategorie {item.get('taxonomy_category')!r} statt {category!r}")

    report = json.loads(text("data/catalog-taxonomy-report.json"))
    mismatch_ids = {int(row["id"]) for row in report.get("legacyCategoryMismatches", [])}
    intentional = {
        6240, 6201, 6199, 6194, 9496, 9477, 9463, 9456,
        9449, 9423, 9435, 9434, 9383, 9386,
    }
    unexpected = sorted(mismatch_ids - intentional)
    require(not unexpected, "unerwartete Broad-Category-Abweichungen: " + ", ".join(map(str, unexpected)))

    # Generated public pages must agree with the repaired taxonomy, not merely
    # catalog.json. Two former failures are checked end-to-end here.
    p9500 = text("artikel/9500/index.html")
    require('<div class="fact__value" id="factCategoryValue">Jacken</div>' in p9500, "Prada Knitterjacke ist oeffentlich nicht als Jacke klassifiziert")
    require('"category": "Jacken"' in p9500 and '"value": "Jacke"' in p9500, "Prada Knitterjacke JSON-LD ist noch falsch")
    p9512 = text("artikel/9512/index.html")
    require('<div class="fact__value" id="factCategoryValue">Jacken</div>' in p9512, "Dsquared2 Suf Camp ist oeffentlich nicht als Jacke klassifiziert")


def validate_existing_quality_debt_does_not_grow() -> None:
    quality = json.loads(text("data/shop-quality.json"))
    q = quality.get("quality", {})
    # Known legacy data debt may require physical label/photo verification and
    # is not guessed by code. The audit nevertheless prevents silent growth.
    require(int(q.get("duplicate_article_number", {}).get("count", 0)) <= 3, "doppelte Artikelnummern haben zugenommen")
    require(int(q.get("price_on_request", {}).get("count", 0)) <= 7, "verfuegbare Artikel ohne Preis haben zugenommen")
    require(int(q.get("missing_gallery", {}).get("count", 0)) == 0, "mindestens ein Artikel hat keine Galerie")


CHECKS = {
    "facets": validate_zero_hit_facets,
    "rental": validate_single_rental_architecture,
    "purchase": validate_purchase_price_on_request,
    "taxonomy": validate_semantic_taxonomy,
    "quality": validate_existing_quality_debt_does_not_grow,
}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--section", choices=["all", *CHECKS], default="all")
    args = parser.parse_args()
    selected = CHECKS.items() if args.section == "all" else [(args.section, CHECKS[args.section])]
    for name, check in selected:
        check()
        print(f"Audit-Perfection [{name}]: OK")
    if args.section == "all":
        print("Audit-Perfection: OK — Zero-Facets, Single Rental V2, Kaufanfragen und Taxonomie regressionsgesichert.")


if __name__ == "__main__":
    main()

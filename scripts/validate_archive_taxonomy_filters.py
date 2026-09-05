#!/usr/bin/env python3
"""Regression checks for the browse-only archive taxonomy filters."""
from __future__ import annotations

import json
from pathlib import Path

BASE = Path(__file__).resolve().parents[1]
TEMPLATE = BASE / "index_template.html"
APP_JS = BASE / "assets" / "app.js"
APP_CSS = BASE / "assets" / "app.css"
CATALOG = BASE / "data" / "catalog.json"


def fail(message: str) -> None:
    raise SystemExit("FEHLER: " + message)


def main() -> None:
    template = TEMPLATE.read_text(encoding="utf-8")
    app = APP_JS.read_text(encoding="utf-8")
    css = APP_CSS.read_text(encoding="utf-8")
    catalog = json.loads(CATALOG.read_text(encoding="utf-8"))

    for needle in (
        'id="filterDepartment"', 'id="filterProductType"',
        'data-i18n="filterAllDepartments"', 'data-i18n="filterAllProductTypes"',
        'id="activeFilters"', 'aria-live="polite"',
        'for="filterDepartment"', 'for="filterProductType"', 'for="filterBrand"',
        'for="filterSize"', 'for="filterColor"', 'for="filterCondition"',
        '<div class="rail__right">',
    ):
        if needle not in template:
            fail(f"Archivfilter fehlt im Template: {needle}")

    # The old class combination made the entire right-hand archive controls
    # invisible because .catalog-controls is display:none !important.
    if '<div class="rail__right catalog-controls"' in template:
        fail("Weitere Filter/Sortierung sind durch catalog-controls unsichtbar")
    if '<div class="rail__right" aria-hidden="true">' in template:
        fail("sichtbare Archiv-Steuerung darf nicht aria-hidden sein")

    required_js = (
        'state.department = filterDepartmentEl.value',
        'state.productType = filterProductTypeEl.value',
        'it.size_normalized !== state.size',
        'var browseCategory = it.taxonomy_category || it.category;',
        'state.categoryGroup.indexOf(browseCategory)',
        'it.product_type, it.department',
        '["Women", "Men", "Unisex", "Objects"]',
        'function matches(it, ignoreFacet)',
        'function refreshFacetOptions()',
        'function renderActiveFilters()',
        'function clearOneArchiveFilter(key)',
        'function clearAllActiveArchiveFilters()',
        'opt.disabled = count === 0 && opt.value !== selectEl.value',
        'moreFiltersToggle.textContent = t("moreFilters")',
        'if (size === "One Size") return t("sizeEinheitsgroesse")',
        'if (size === "Adjustable") return t("sizeVerstellbar")',
        'activeFilterRemove',
        'key: "query"',
        'refreshFacetOptions();', 'renderActiveFilters();',
        'normalizeText(state.catalogLabelText) !== state.query',
        'state.catalogLabelKey = state.status === "Verkauft"',
        '(state.status === "all" ? "statusAll" : "statusAvailable")',
        'var filterBrandsSet = {};',
        'Object.keys(filterBrandsSet)',
        'category/categoryGroup belong to the main archive navigation',
    )
    for needle in required_js:
        if needle not in app:
            fail(f"Taxonomie-/Facet-Filterlogik fehlt: {needle}")

    # Advanced reset must not destroy a category chosen in the main menu.
    bad_reset = '''    state.priceMin = null; state.priceMax = null;\n    state.categoryGroup = null;\n    filterDepartmentEl.value = ""; filterProductTypeEl.value = "";'''
    if bad_reset in app:
        fail("Weitere-Filter-Reset entfernt weiterhin die Menuekategorie")

    # The facet must not reuse the AVAILABLE-only set. Otherwise sold-only
    # brands disappear exactly when the user switches to the archive.
    if 'var brandList = Object.keys(brandsSet)' in app:
        fail("Markenfacette blendet weiterhin reine Archiv-Marken aus")

    for needle in (
        '.active-filter-row {', '.active-filter-row.hidden { display: none; }',
        '.active-filter-clear {', '.filter-field select option:disabled',
        '.catalog-controls { display: none !important; }',
    ):
        if needle not in css:
            fail(f"Archivfilter-UX CSS fehlt: {needle}")

    if '["Women", "Men", "Unisex", "Kids", "Objects"]' in app:
        fail("Kinder darf nicht als Archiv-Bereich angeboten werden")
    if 'Kids:' in app or 'department == "Kids"' in app:
        fail("Kinder-Bereich wurde erneut in die Archivfilterlogik aufgenommen")

    if not catalog:
        fail("catalog.json ist leer")
    for item in catalog:
        for field in ("department", "product_type", "taxonomy_category", "size_normalized"):
            if field not in item:
                fail(f"{field} fehlt bei Artikel {item.get('id')}")
        if item.get("department") == "Kids":
            fail(f"Kinder-Bereich bei Artikel {item.get('id')} gefunden")

    by_id = {int(item["id"]): item for item in catalog}
    expected = {
        9463: ("Tops", "Shoes", "Heels"),
        9386: ("Tops", "Accessories", "Hat"),
        9434: ("Objects", "Knitwear", "Sweatshirt"),
    }
    for item_id, (legacy, taxonomy, product_type) in expected.items():
        item = by_id.get(item_id)
        if not item:
            continue
        if item.get("category") != legacy:
            fail(f"geschützte Legacy-Kategorie bei {item_id} verändert")
        if item.get("taxonomy_category") != taxonomy or item.get("product_type") != product_type:
            fail(f"Browse-Taxonomie bei {item_id} ist nicht korrigiert")

    print(
        "Archiv-Taxonomie-Filter: OK – sichtbare Steuerung, synchroner Titel, "
        "reset-sichere Kategorie, komplette Archiv-Marken, Facets und kein Kinder-Bereich."
    )


if __name__ == "__main__":
    main()

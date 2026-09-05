#!/usr/bin/env python3
"""Run the archive taxonomy UI patch only when it is not already materialized.

The original string patcher predates later accessibility/UX changes. Those
changes legitimately alter its exact replacement text (for example labels gain
``for`` attributes), so re-running the original patcher on an already-generated
main branch can fail even though the taxonomy UI is fully present. This wrapper
keeps clean-source patching strict while making repeated production rebuilds
idempotent.
"""
from __future__ import annotations

from pathlib import Path

from apply_archive_taxonomy_filters import main as apply_taxonomy_filters

BASE = Path(__file__).resolve().parents[1]
TEMPLATE = BASE / "index_template.html"
APP_JS = BASE / "assets" / "app.js"


def already_materialized() -> bool:
    template = TEMPLATE.read_text(encoding="utf-8")
    app = APP_JS.read_text(encoding="utf-8")

    template_markers = (
        'id="filterDepartment"',
        'id="filterProductType"',
        'data-i18n="filterAllDepartments"',
        'data-i18n="filterAllProductTypes"',
    )
    app_markers = (
        'department: ""',
        'productType: ""',
        'var filterDepartmentEl = document.getElementById("filterDepartment")',
        'var filterProductTypeEl = document.getElementById("filterProductType")',
        'var browseCategory = it.taxonomy_category || it.category;',
        'it.size_normalized !== state.size',
        '["Women", "Men", "Unisex", "Objects"]',
    )
    return all(marker in template for marker in template_markers) and all(
        marker in app for marker in app_markers
    )


def main() -> None:
    if already_materialized():
        print("Archiv-Taxonomie-Filter: bereits materialisiert – Patch uebersprungen.")
        return
    apply_taxonomy_filters()


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Regression checks for the simplified, context-aware archive filter UI."""
from pathlib import Path
import sys

BASE = Path(__file__).resolve().parents[1]
JS = BASE / "assets" / "catalog-filter-simplify.js"
SCRIPT_TAG = '<script src="/assets/catalog-filter-simplify.js"></script>'


def main() -> None:
    errors = []
    js = JS.read_text(encoding="utf-8") if JS.exists() else ""
    for needle in [
        'PRODUCT_TYPE_ID = "filterProductType"',
        'AUDIT_PERFECT_IOS_ZERO_OPTIONS',
        'select.remove(i);',
        'DEPENDENT_IDS',
        'resetInvalidDependents',
        'closest(".filter-field")',
        'syncFieldVisibility',
        'field.classList.toggle("hidden", shouldHide)',
        'reconcileAll',
        'scheduleReconcile',
        'if (!option || parsedCount(option) === 0)',
        'attributeFilter: ["disabled", "hidden"]',
    ]:
        if needle not in js:
            errors.append(f"catalog-filter-simplify.js: Logik fehlt: {needle}")

    # Native iOS pickers may still render <option hidden>. Zero-hit values must
    # therefore be physically absent instead of only visually hidden.
    if 'option.hidden = unavailable' in js:
        errors.append("catalog-filter-simplify.js: Null-Treffer werden nur versteckt statt aus dem nativen Select entfernt")

    # Reconciliation must react to every facet. A department-only listener was
    # the old failure mode: brand/size/colour changes could leave another
    # selected facet disabled at zero results and strand the catalogue at 0 hits.
    if 'var department = document.getElementById("filterDepartment")' in js:
        errors.append("catalog-filter-simplify.js: Facetten-Reconciliation ist wieder nur an Bereich/Herren-Damen gekoppelt")

    checked = 0
    for rel in ["index.html", "en/index.html", "fr/index.html", "mieten/index.html"]:
        path = BASE / rel
        if not path.exists():
            continue
        checked += 1
        text = path.read_text(encoding="utf-8")
        if SCRIPT_TAG not in text:
            errors.append(f"{rel}: vereinfachter Filter-Bridge fehlt")
        if 'id="filterProductType"' not in text:
            errors.append(f"{rel}: technischer Produkttyp-Facet fehlt; app.js waere sonst inkompatibel")
    if checked < 3:
        errors.append("Zu wenige generierte Katalogseiten fuer Filter-Regression gefunden")

    # Creative modes must remain completely outside this helper.
    for forbidden in ["swipeView", "chaosView", "outfitView", "mode-guard"]:
        if forbidden in js:
            errors.append(f"catalog-filter-simplify.js darf geschuetzte Modi nicht referenzieren: {forbidden}")

    if errors:
        for error in errors:
            print("FEHLER:", error, file=sys.stderr)
        raise SystemExit(1)
    print(
        "Vereinfachte Archivfilter: OK "
        "(Produkttyp UI entfernt, Null-Treffer physisch entfernt, "
        "alle Facetten reconciled, leere Facetten verborgen, Modi unberuehrt)"
    )


if __name__ == "__main__":
    main()

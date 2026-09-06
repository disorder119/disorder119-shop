#!/usr/bin/env python3
"""Hard non-regression floors for measured Disorder119 quality.

The Lighthouse/axe collector intentionally keeps slightly tolerant internal
budgets so it can always produce useful diagnostics. This validator is the
stable CI contract layered on top of those measurements: it prevents the shop
from silently falling back from the currently proven >9/10 quality level while
still leaving realistic headroom for normal Lighthouse variance.

Protected Match, Chaos and Baukasten behavior is not modified here; those modes
remain covered by their dedicated browser and Mode Guard checks.
"""
from __future__ import annotations

import json
from pathlib import Path

BASE = Path(__file__).resolve().parents[1]
QUALITY_SUMMARY = BASE / ".quality-reports" / "summary.json"
PRODUCT_REPORT = BASE / "data" / "product-data-quality.json"

# Proven repeatedly on the current shop at 99/100 mobile performance,
# 100/100 accessibility/SEO and ~2.0-2.1 s mobile LCP. The floors below keep
# deliberate headroom while blocking a return to 80-point performance.
PERFORMANCE_FLOOR = 0.95
ACCESSIBILITY_FLOOR = 0.95
BEST_PRACTICES_FLOOR = 0.95
SEO_FLOOR = 0.95
MOBILE_LCP_CEILING_MS = 2500.0
DESKTOP_LCP_CEILING_MS = 2000.0
CLS_CEILING = 0.10
TBT_CEILING_MS = 200.0

# Product data currently measures 9.68/10 truthfully. Do not allow the score
# to drift back to merely "above nine". Raw field floors prevent that composite
# score from hiding broad metadata regressions.
PRODUCT_DATA_SCORE_FLOOR = 9.50
PRODUCT_RAW_FLOORS = {
    "size_required_percent": 90.0,
    "color_percent": 80.0,
    "condition_percent": 60.0,
    "description_percent": 98.0,
}

EXPECTED_LIGHTHOUSE_CASES = {"home-mobile", "home-desktop", "product-mobile"}
EXPECTED_AXE_CONTEXTS = {
    "archive-desktop",
    "archive-mobile-filter",
    "product-mobile",
    "cart-mobile",
    "rental-mobile-dialog",
    "archive-en",
    "archive-fr",
}


def fail(message: str) -> None:
    raise SystemExit("Quality-Regression-Floor: " + message)


def number(value, label: str) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        fail(f"{label} ist nicht numerisch: {value!r}")
        raise AssertionError  # pragma: no cover


def validate_product_data() -> None:
    if not PRODUCT_REPORT.is_file():
        fail("data/product-data-quality.json fehlt")
    report = json.loads(PRODUCT_REPORT.read_text(encoding="utf-8"))
    score = number(report.get("score_10"), "Produktdaten-Score")
    if score < PRODUCT_DATA_SCORE_FLOOR:
        fail(f"Produktdaten {score:.2f}/10 < {PRODUCT_DATA_SCORE_FLOOR:.2f}/10")

    raw = report.get("raw_completeness") or {}
    for key, floor in PRODUCT_RAW_FLOORS.items():
        actual = number(raw.get(key), f"Produktdaten {key}")
        if actual < floor:
            fail(f"Produktdaten {key} {actual:.1f}% < Floor {floor:.1f}%")


def validate_lighthouse(summary: dict) -> None:
    reports = summary.get("lighthouse")
    if not isinstance(reports, list):
        fail("Lighthouse-Reports fehlen im Quality-Summary")
    by_name = {str(row.get("name")): row for row in reports if isinstance(row, dict)}
    missing = EXPECTED_LIGHTHOUSE_CASES - set(by_name)
    if missing:
        fail("Lighthouse-Faelle fehlen: " + ", ".join(sorted(missing)))

    for name in sorted(EXPECTED_LIGHTHOUSE_CASES):
        row = by_name[name]
        scores = row.get("scores") or {}
        metrics = row.get("metrics") or {}
        required_scores = {
            "performance": PERFORMANCE_FLOOR,
            "accessibility": ACCESSIBILITY_FLOOR,
            "best-practices": BEST_PRACTICES_FLOOR,
            "seo": SEO_FLOOR,
        }
        for category, floor in required_scores.items():
            actual = number(scores.get(category), f"{name} {category}")
            if actual + 1e-9 < floor:
                fail(f"{name} {category} {actual * 100:.0f} < Floor {floor * 100:.0f}")

        lcp = number(metrics.get("largest-contentful-paint"), f"{name} LCP")
        lcp_ceiling = DESKTOP_LCP_CEILING_MS if name == "home-desktop" else MOBILE_LCP_CEILING_MS
        if lcp > lcp_ceiling:
            fail(f"{name} LCP {lcp:.0f} ms > {lcp_ceiling:.0f} ms")

        cls = number(metrics.get("cumulative-layout-shift"), f"{name} CLS")
        if cls > CLS_CEILING:
            fail(f"{name} CLS {cls:.3f} > {CLS_CEILING:.2f}")

        tbt = number(metrics.get("total-blocking-time"), f"{name} TBT")
        if tbt > TBT_CEILING_MS:
            fail(f"{name} TBT {tbt:.0f} ms > {TBT_CEILING_MS:.0f} ms")


def validate_axe(summary: dict) -> None:
    reports = summary.get("axe")
    if not isinstance(reports, list):
        fail("axe-Reports fehlen im Quality-Summary")
    by_context = {str(row.get("context")): row for row in reports if isinstance(row, dict)}
    missing = EXPECTED_AXE_CONTEXTS - set(by_context)
    if missing:
        fail("axe-Kontexte fehlen: " + ", ".join(sorted(missing)))

    # Current measured baseline is exactly zero WCAG violations in all normal
    # customer contexts. Keep that stronger guarantee instead of only blocking
    # serious/critical issues.
    for context in sorted(EXPECTED_AXE_CONTEXTS):
        violations = int(number(by_context[context].get("violation_count"), f"axe {context} violations"))
        if violations != 0:
            fail(f"axe {context}: {violations} WCAG-Verstoss/Verstoesse; Floor ist exakt 0")


def main() -> None:
    validate_product_data()
    if not QUALITY_SUMMARY.is_file():
        fail(".quality-reports/summary.json fehlt")
    summary = json.loads(QUALITY_SUMMARY.read_text(encoding="utf-8"))
    validate_lighthouse(summary)
    validate_axe(summary)
    print(
        "Quality-Regression-Floors: OK — Produktdaten >=9.50/10, "
        "Lighthouse >=95, mobile LCP <=2.5s, TBT <=200ms und 0 axe/WCAG-Verstoesse."
    )


if __name__ == "__main__":
    main()

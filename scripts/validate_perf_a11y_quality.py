#!/usr/bin/env python3
"""Static invariants for the measured Performance/A11y quality patch."""
from pathlib import Path

BASE = Path(__file__).resolve().parents[1]


def need(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit("Performance/A11y-Regression: " + message)


def main() -> None:
    app_js = (BASE / "assets" / "app.js").read_text(encoding="utf-8")
    app_css = (BASE / "assets" / "app.css").read_text(encoding="utf-8")
    article_js = (BASE / "assets" / "article.js").read_text(encoding="utf-8")
    article_css = (BASE / "assets" / "article.css").read_text(encoding="utf-8")
    template = (BASE / "index_template.html").read_text(encoding="utf-8")
    migration = (BASE / "scripts" / "apply_perf_a11y_quality.py").read_text(encoding="utf-8")

    need("mode-guard" not in migration.lower(), "Migration darf Mode Guard nicht referenzieren")
    need('id="sortSelect" aria-label="Artikel sortieren"' in template, "Sortierauswahl ohne statischen Accessible Name")
    need("PERF_A11Y_95_ARCHIVE" in app_js, "Archiv-JS-Patch fehlt")
    need('idx >= 2 && idx < animateCount' in app_js, "erste Karten werden weiterhin fuer LCP ausgeblendet")
    # The measured Focus-3 follow-up deliberately narrowed eager/high-priority
    # loading from four cards to the two SSR/LCP cards. Keeping the old idx<4
    # assertion would reject the exact final state that Lighthouse measured at
    # 99/100 on mobile.
    need('var heroLoading = idx < 2 ? "eager" : "lazy";' in app_js,
         "gemessene Zwei-Karten-LCP-Strategie fehlt")
    need("idx < 2 ? ' fetchpriority=\"high\"' : ' fetchpriority=\"low\"'" in app_js,
         "kritische und nachgelagerte Bildprioritaet ist nicht explizit getrennt")
    need('var heroDecoding = idx < 2 ? "sync" : "async";' in app_js,
         "kritische SSR/LCP-Bilder verwenden nicht den gemessenen Decode-Pfad")
    need('plate.setAttribute("aria-label", it.title)' not in app_js, "redundantes Karten-aria-label wieder vorhanden")
    need('setAttribute("aria-label", LANG === "fr"' in app_js, "Sortiername nicht lokalisiert")

    need("PERF_A11Y_95_ARCHIVE_STYLE" in app_css, "Archiv-Contrast/Target-Styles fehlen")
    need("#appShell .plate__brand" in app_css and "min-height: 24px" in app_css, "Brand-Filter unterschreitet Target-Gate")
    need("#appShell .plate__rental-btn" in app_css, "Rental-Kartenkontrast nicht abgesichert")

    need("PERF_A11Y_95_ARTICLE" in article_js, "Produktgalerie-A11y-Patch fehlt")
    need('t2.setAttribute("aria-label"' in article_js, "Galerie-Thumbnail ohne Accessible Name")
    need("PERF_A11Y_95_ARTICLE_STYLE" in article_css, "Produktseiten-Kontrastpatch fehlt")
    need(".fact__label" in article_css and ".info__note" in article_css, "Produkt-Fakten/Note nicht abgesichert")

    quality = (BASE / "scripts" / "browser_quality_budget.py").read_text(encoding="utf-8")
    need("AXE_BLOCKING_IMPACTS" in quality and '"critical", "serious"' in quality, "axe Serious/Critical Gate fehlt")
    need('"performance": 0.85' in quality, "mobiles Performance-Gate fehlt")
    need('"accessibility": 0.95' in quality, "Accessibility-Gate fehlt")
    need('"cumulative-layout-shift": 0.10' in quality, "CLS-Gate fehlt")

    print("Performance/A11y-Qualitaet: OK — gemessene 2-Card-LCP-Prioritaet, Accessible Names, Kontrast, Targets und Browser-Budgets statisch abgesichert.")


if __name__ == "__main__":
    main()

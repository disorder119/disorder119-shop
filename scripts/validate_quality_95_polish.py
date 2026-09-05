#!/usr/bin/env python3
"""Regression checks for the Disorder119 9.5 polish layer."""
from __future__ import annotations

import re
from pathlib import Path

BASE = Path(__file__).resolve().parents[1]


def text(path: str) -> str:
    return (BASE / path).read_text(encoding="utf-8")


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit("FEHLER: " + message)


def main() -> None:
    app = text("assets/app.js")
    app_css = text("assets/app.css")
    article = text("assets/article.js")
    article_css = text("assets/article.css")
    filters = text("assets/catalog-filter-simplify.js")
    rental = text("assets/rental-v2.js")
    picker = text("assets/rental-v2-picker.js")
    rental_ui = text("assets/rental-v2-ui.js")
    build = text("build_site.py")
    migration = text("scripts/apply_quality_95_polish.py")

    # Absolute protection rules: this migration must never write/initialize guards.
    require("config/mode-guard.json" not in migration, "Quality migration darf mode-guard.json nicht anfassen")
    require("--init-mode-guard" not in migration, "Quality migration darf Mode Guard nicht neu initialisieren")

    # Search: keep the existing typo tolerance, plus exact punctuation/hyphen variants.
    require("QUALITY95_SEARCH_COMPACT" in app, "kompakte Interpunktions-/Bindestrichsuche fehlt")
    require('it.size_normalized, it.article, String(it.id || "")' in app, "interne Artikelnummer fehlt im Archiv-Suchindex")
    require("levenshtein" in app and "BRAND_ALIASES" in app, "bestehende vorsichtige Tippfehlertoleranz fehlt")

    # Product cards/public article numbers.
    require('class="plate__size"' in app and "function cardSizeLabel" in app, "dezentes Size-Label fehlt auf Produktkarten")
    require('data-i18n="factArticleNo"' not in build, "Artikelnummer wird weiterhin als sichtbarer Produkt-Fakt gebaut")
    require("Interne Artikelnummern bleiben in ARTICLE_ITEM/Anfragen erhalten" in build, "interne Artikelnummern wurden aus Produktdaten entfernt")

    # Purchase enquiry completeness, including an optional customer note.
    require("QUALITY95_CART_MESSAGE" in app and "QUALITY95_CART_LINK_REFRESH" in app, "optionale Kundennachricht im Warenkorb fehlt")
    require("cartOrderMessage.trim()" in app and "purchaseMessageLabel()" in app, "Kundennachricht wird nicht in Kaufanfrage übernommen")
    require('rows.push("URL: " + location.origin + langHome(LANG) + "artikel/" + it.id + "/")' in app, "Produkt-URL fehlt in Warenkorbanfrage")
    require('it.article || it.id' in app, "interne Artikelnummer fehlt in Warenkorbanfrage")
    require("QUALITY95_CART_MESSAGE_STYLE" in app_css, "Warenkorb-Nachrichtenfeld ist nicht sauber scoped")
    require("QUALITY95_ARTICLE_MESSAGE" in article and "function ensureArticleMessageField" in article, "optionale Kundennachricht auf Produktseite fehlt")
    require("articleOrderMessage.trim()" in article and "articleMessageLabel()" in article, "Produktseiten-Nachricht wird nicht in Anfrage übernommen")
    require('IT.article || IT.id' in article, "interne Artikelnummer fehlt in direkter Produktanfrage")
    require('rows.push("URL: " + window.location.href' in article, "URL fehlt in direkter Produktanfrage")

    # Mobile filter drawer: a real, accessible modal interaction without extra filter complexity.
    require("QUALITY95_FILTER_DRAWER" in filters, "Quality-95 Mobile-Drawer fehlt")
    require("d119-filter-backdrop" in filters, "abgedunkelter Filter-Hintergrund fehlt")
    require('panel.setAttribute("role", "dialog")' in filters and 'panel.setAttribute("aria-modal", "true")' in filters, "Filter-Drawer hat keine Dialog-Semantik")
    require('event.key !== "Tab"' in filters and "focusables(panel)" in filters, "Focus-Trap im Filter-Drawer fehlt")
    require("previousFocus" in filters and "target.focus" in filters, "Fokus-Rückgabe des Filter-Drawers fehlt")
    require("min-height:44px" in filters and "env(safe-area-inset-bottom)" in filters, "Touch-Ziele/Safe-Area im Filter-Drawer fehlen")
    require("option.hidden = unavailable" in filters, "Null-Treffer-Optionen werden nicht ausgeblendet")
    require('PRODUCT_TYPE_ID = "filterProductType"' in filters, "redundanter Produkttyp-Filter wird nicht kontrolliert")

    # Rental business invariants must remain untouched.
    require("var RENTAL_RATE_BPS = 1000" in rental, "10-%-Tagesmietregel wurde verändert")
    require("var DEPOSIT_RATE_BPS = 5000" in rental, "50-%-Kautionsregel wurde verändert")
    require("var DEPOSIT_MIN_CENTS = 5000" in rental, "Mindestkaution 50 EUR wurde verändert")
    require("var STANDARD_MAX_DAYS = 7" in rental, "7-Tage-Standardfenster wurde verändert")
    require("var RENTAL_RATE_BPS = 1000" in picker, "Mietpreis im Picker weicht von 10 % ab")

    # Rental UI remains concise and accessible, while article numbers stay internal.
    require("QUALITY95_RENTAL_FOCUS_TRAP" in rental and "QUALITY95_RENTAL_FOCUS_RETURN" in rental, "Rental-Dialog Focus-Trap/-Rückgabe fehlt")
    require('<details class="d119-rental-process-details">' in rental, "Rental-Prozess ist nicht visuell eingeklappt")
    require('id="d119RentalDateStatus" aria-live="polite"' in rental, "Datumstatus ist nicht live angekündigt")
    require('id="d119RentalAvailability" aria-live="polite"' in rental, "Verfügbarkeitsstatus ist nicht live angekündigt")
    visible_item = rental.split("function itemHtml", 1)[1].split("function renderOverlay", 1)[0]
    require("Art.-Nr." not in visible_item, "Artikelnummer ist im sichtbaren Mietdrawer vorhanden")
    message_fn = rental.split("function buildMessage", 1)[1].split("function purposeLabel", 1)[0]
    require('lines.push("   Art.-Nr.: " + (item.article || item.id))' in message_fn, "Artikelnummer fehlt in Multi-Rental-Anfrage")
    require('lines.push("   URL: " + window.location.origin' in message_fn, "Produkt-URL fehlt in Multi-Rental-Anfrage")
    require('if (state.message) lines.push' in message_fn, "Kundennachricht fehlt in Rental-Anfrage")

    # Rental picker: localized, punctuation-tolerant, keyboard friendly, no public item number label.
    require("QUALITY95_PICKER_I18N" in picker and "categoryLabel(cat)" in picker, "Rental-Picker-Kategorien sind nicht lokalisiert")
    require("QUALITY95_PICKER_SEARCH" in picker, "Rental-Picker-Suche toleriert Y3/Y-3 nicht")
    require("QUALITY95_PICKER_FOCUS_TRAP" in picker, "Rental-Picker hat keinen Focus-Trap")
    require('autocomplete="off" aria-label="' in picker, "Rental-Picker-Suche hat kein zugängliches Label")
    require('id="d119PickerAlert" role="status" aria-live="polite"' in picker, "Picker-Status ist nicht zugänglich")
    require("Artikelnummer suchen" not in picker and "article number" not in picker.lower(), "öffentlicher Picker bewirbt Artikelnummernsuche")
    require("item.article, item.id" in picker, "interne Artikelnummer-/ID-Suche im Picker fehlt")
    require("QUALITY95_RENTAL_OBSERVER" in rental_ui and 'attributeFilter: ["aria-pressed"]' in rental_ui, "Rental-UI beobachtet weiterhin unnötige globale Class-Änderungen")

    # Product lightbox must be keyboard-accessible and restore focus.
    require("QUALITY95_ARTICLE_LIGHTBOX" in article, "Produkt-Lightbox-A11y fehlt")
    require("mainImg.tabIndex = 0" in article and 'mainImg.setAttribute("role", "button")' in article, "Produktbild ist per Tastatur nicht zoombar")
    require('lightbox.setAttribute("aria-modal", "true")' in article, "Lightbox hat keine Modal-Semantik")
    require("lightboxLastFocus" in article and "target.focus()" in article, "Lightbox gibt Fokus nicht zurück")
    require("QUALITY95_ARTICLE_A11Y" in article_css, "Produktseiten-Fokusstyles fehlen")

    # Canonical rental terms source must no longer contradict the protected formula.
    require("Wie die Miete funktiert" not in build, "Tippfehler in Miet-Einleitung ist noch vorhanden")
    require("in der Regel ca. 15&nbsp;%" not in build, "Build-Quelle enthält noch alte 15-%-Mietregel")
    require("typically around 15%" not in build, "EN Build-Quelle enthält noch alte 15-%-Mietregel")
    require("environ 15&nbsp;%" not in build, "FR Build-Quelle enthält noch alte 15-%-Mietregel")
    require("exakt 10&nbsp;% des im Archiv angegebenen Verkaufspreises" in build, "DE Build-Quelle enthält nicht die 10-%-Regel")
    require("exactly 10% of the listed archive sale price" in build, "EN Build-Quelle enthält nicht die 10-%-Regel")
    require("exactement 10&nbsp;% du prix de vente indiqué" in build, "FR Build-Quelle enthält nicht die 10-%-Regel")

    # Generated rental pages are checked after build + canonical terms post-processing.
    generated_terms = {
        "mieten/index.html": "10&nbsp;%",
        "en/mieten/index.html": "10%",
        "fr/mieten/index.html": "10&nbsp;%",
    }
    for path, expected in generated_terms.items():
        page = text(path)
        require(expected in page, f"{path}: aktuelle 10-%-Mietregel fehlt")
        require("15&nbsp;%" not in page and "around 15%" not in page, f"{path}: veraltete 15-%-Regel ist noch sichtbar")

    # Generated product pages must not expose article numbers as visible facts.
    product_pages = list((BASE / "artikel").glob("*/index.html"))[:30]
    require(bool(product_pages), "keine generierten Produktseiten für Regressionstest gefunden")
    for page_path in product_pages:
        page = page_path.read_text(encoding="utf-8")
        require('data-i18n="factArticleNo"' not in page, f"sichtbare Artikelnummer auf {page_path.relative_to(BASE)}")

    print("OK: Quality-95-Polish, A11y, Suche, Anfragen und Rental-Invarianten sind konsistent.")


if __name__ == "__main__":
    main()

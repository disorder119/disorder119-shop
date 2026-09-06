#!/usr/bin/env python3
"""Regression checks for simplified catalogue UI and internal item identifiers."""
from pathlib import Path

BASE = Path(__file__).resolve().parents[1]


def read(rel: str) -> str:
    return (BASE / rel).read_text(encoding="utf-8")


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit("FEHLER: " + message)


def main() -> None:
    app = read("assets/app.js")
    helper = read("assets/catalog-filter-simplify.js")
    article = read("assets/article.js")
    rental = read("assets/rental-v2.js")
    picker = read("assets/rental-v2-picker.js")
    build = read("build_site.py")

    # Suche: interne Kennung bleibt auffindbar, ohne sie auf Karten anzuzeigen.
    require('it.size_normalized, it.article, String(it.id || "")' in app,
            "Katalogsuche indexiert Artikelnummer/ID nicht intern.")
    require('item.article, item.id, itemCategory(item), item.size' in picker,
            "Rental-Picker indexiert Artikelnummer/ID bzw. geprüfte Kategorie nicht intern.")
    require('article number' not in picker.lower() and 'artikelnummer suchen' not in picker.lower(),
            "Rental-Picker bewirbt die interne Artikelnummer weiterhin öffentlich.")

    # Produktkarten: dezente Groesse, keine sichtbare interne Kennung.
    require("function cardSizeLabel(it)" in app and 'class="plate__size"' in app,
            "Groessenlabel auf Archivkarten fehlt.")
    require(".plate__size{" in helper, "Dezentes Karten-Groessenstyling fehlt.")
    require('plate__article' not in app and 'plate__sku' not in app,
            "Produktkarte enthält eine sichtbare interne Kennung.")

    # Produktdetail: Artikelnummer bleibt in ARTICLE_ITEM technisch verfügbar,
    # darf aber nicht als sichtbarer Fakt generiert werden.
    require('"article": it.get("article")' in build,
            "Artikelnummer wurde aus den internen Produktdaten entfernt.")
    require('data-i18n="factArticleNo"' not in build,
            "Produktdetail generiert die Artikelnummer weiterhin sichtbar.")
    require('t("orderArticleAbbrev") + (IT.article || IT.id)' in article,
            "Direkte Kaufanfrage enthält keine Artikelnummer mehr.")
    require('rows.push("URL: " + window.location.href' in article and 'new Date().toLocaleString()' in article,
            "Direkte Kaufanfrage enthält URL/Zeitpunkt nicht.")
    require('AUDIT_PERFECT_ARTICLE_PRICE_REQUEST' in article,
            "Direkte Kaufanfrage behandelt Preis auf Anfrage nicht sauber.")

    # Warenkorb/Kaufanfrage bleibt intern eindeutig und darf einen offenen Preis
    # niemals in 0,00 EUR umdeuten.
    require('t("orderArticleAbbrev") + (it.article || it.id)' in app,
            "Kaufanfrage aus dem Warenkorb enthält keine Artikelnummer.")
    require('rows.push("URL: " + location.origin + langHome(LANG) + "artikel/" + it.id + "/")' in app,
            "Kaufanfrage aus dem Warenkorb enthält keine Artikel-URL.")
    require('rows.push(fmtPriceDisplay(it.price));' in app and 'AUDIT_PERFECT_CART_TOTAL' in app,
            "Warenkorb behandelt Preis-auf-Anfrage nicht konsistent.")

    # Miet-UI: keine Artikelnummer im sichtbaren Drawer, aber jede Anfrage
    # enthält sie weiterhin – auch für Multi-Rental.
    require('<span>Art.-Nr. ' not in rental,
            "Miet-Drawer zeigt die Artikelnummer weiterhin sichtbar.")
    require('lines.push("   Art.-Nr.: " + (item.article || item.id))' in rental,
            "Multi-Rental-Anfrage enthält nicht jede Artikelnummer.")
    require('lines.push("   URL: " + window.location.origin + HOME + "artikel/" + item.id + "/")' in rental,
            "Multi-Rental-Anfrage enthält keine Artikel-URL.")
    require('if (state.message) lines.push(t("message") + ": " + state.message);' in rental,
            "Kundennachricht fehlt in Multi-Rental-Anfrage.")

    # Kritische Preisregeln bleiben unverändert.
    require("var RENTAL_RATE_BPS = 1000;" in rental and "var RENTAL_RATE_BPS = 1000;" in picker,
            "10-%-Mietpreisregel wurde verändert.")
    require("var DEPOSIT_RATE_BPS = 5000;" in rental and "var DEPOSIT_MIN_CENTS = 5000;" in rental,
            "Automatische Kautionslogik wurde verändert.")

    # Filter: technische Detailtaxonomie bleibt vorhanden, wird aber versteckt;
    # Null-Treffer sind auf nativen iOS-Selects physisch entfernt und Mobile
    # erhält einen echten Drawer.
    require('PRODUCT_TYPE_ID = "filterProductType"' in helper,
            "Technischer Produkttyp-Filter fehlt.")
    require("AUDIT_PERFECT_IOS_ZERO_OPTIONS" in helper and "select.remove(i);" in helper,
            "Filterwerte ohne Treffer werden nicht iOS-sicher entfernt.")
    require("d119CompactFilterDrawer" in helper and "d119-filter-drawer__apply" in helper,
            "Mobiler Filter-Drawer mit Trefferaktion fehlt.")

    # Generierte Produktseiten aller Sprachen dürfen das sichtbare Label nicht
    # wieder einschleusen. Die interne Nummer im eingebetteten Produktobjekt ist
    # bewusst zulässig, weil sie für Anfragen/Suche benötigt wird.
    generated = []
    for pattern in ("artikel/*/index.html", "en/artikel/*/index.html", "fr/artikel/*/index.html"):
        generated.extend(BASE.glob(pattern))
    require(bool(generated), "Keine generierten Produktseiten für Regressionstest gefunden.")
    offenders = [str(p.relative_to(BASE)) for p in generated if 'data-i18n="factArticleNo"' in p.read_text(encoding="utf-8")]
    require(not offenders, "Artikelnummer weiterhin sichtbar auf Produktseiten: " + ", ".join(offenders[:5]))

    print(f"Catalog/Inquiry UX OK: {len(generated)} Produktseiten geprüft.")


if __name__ == "__main__":
    main()

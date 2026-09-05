#!/usr/bin/env python3
"""Regression checks for the public rental UI / commerce bridge."""
from pathlib import Path
import sys

BASE = Path(__file__).resolve().parents[1]
TEMPLATE = BASE / "index_template.html"
BRIDGE = BASE / "assets" / "rental-commerce.js"
V2 = BASE / "assets" / "rental-v2.js"
V2_UI = BASE / "assets" / "rental-v2-ui.js"
PATCHER = BASE / "scripts" / "apply_rental_terms.py"
INJECTOR = BASE / "scripts" / "inject_rental_v2.py"
RENTAL_PAGES = {
    "de": BASE / "mieten" / "index.html",
    "en": BASE / "en" / "mieten" / "index.html",
    "fr": BASE / "fr" / "mieten" / "index.html",
}


def fail(message: str) -> None:
    print("FEHLER:", message, file=sys.stderr)
    raise SystemExit(1)


def require(text: str, needle: str, label: str) -> None:
    if needle not in text:
        fail(f"Rental-Frontend: {label} fehlt ({needle!r}).")


def main() -> None:
    if not BRIDGE.is_file():
        fail("assets/rental-commerce.js fehlt.")
    if not V2.is_file():
        fail("assets/rental-v2.js fehlt.")
    if not V2_UI.is_file():
        fail("assets/rental-v2-ui.js fehlt.")
    if not PATCHER.is_file():
        fail("scripts/apply_rental_terms.py fehlt.")
    if not INJECTOR.is_file():
        fail("scripts/inject_rental_v2.py fehlt.")

    template = TEMPLATE.read_text(encoding="utf-8")
    bridge = BRIDGE.read_text(encoding="utf-8")
    v2 = V2.read_text(encoding="utf-8")
    v2_ui = V2_UI.read_text(encoding="utf-8")

    require(template, '/assets/rental-commerce.js', "Script-Einbindung")
    require(bridge, "RENTAL_RATE_BPS = 1000", "10-Prozent-Regel")
    require(bridge, '"/rental-quote"', "serverseitiger Mietpreis-Abgleich")
    require(bridge, '"/rental-request"', "Rental-Request-Anbindung")
    require(bridge, '"Idempotency-Key"', "Idempotency-Header")
    require(bridge, "totalPriceCents", "Gesamtpreis-Anzeige")
    require(bridge, "priceOnRequest", "Preis-auf-Anfrage-Fallback")
    require(bridge, "10&nbsp;%", "sichtbare 10-Prozent-Kondition")
    require(bridge, "RENTAL_DATES_UNAVAILABLE", "Verfuegbarkeitsfehler")
    require(bridge, "ITEM_UNAVAILABLE", "Artikel-nicht-verfuegbar-Fehler")

    # Rental V2: combined requests, automatic deposit and transparent summary.
    require(v2, "DEPOSIT_RATE_BPS = 5000", "50-Prozent-Kaution")
    require(v2, "DEPOSIT_MIN_CENTS = 5000", "Mindestkaution 50 Euro")
    require(v2, "STANDARD_MAX_DAYS = 7", "Standard-Mietdauer")
    require(v2, "d119_rental_cart_v2", "persistenter Mietkorb")
    require(v2, "itemIds: state.ids.slice()", "Mehrfachartikel-Anfrage")
    require(v2, "termsAccepted", "Mietbedingungen-Checkbox")
    require(v2, "TERMS_VERSION", "versionierte Mietbedingungen")
    require(v2, "refundableDeposit", "Kautions-Zusammenfassung")
    require(v2, "moveRentalNavigation", "Verleih als eigener Service-Bereich")
    require(v2, '"/rental-quote"', "V2-Verfuegbarkeitspruefung")
    require(v2, '"/rental-request"', "V2-Backend-Anbindung")
    require(v2, "MULTI_ITEM", "Backend-Kennzeichnung der Mehrfachanfrage")

    # UI enhancement: explicit plus picker, selection rail and rental-card affordance.
    require(v2_ui, "d119-rental-set-add", "Plus-Kachel fuer weitere Mietartikel")
    require(v2_ui, "d119-rental-add-side", "seitliches Plus im Mietfenster")
    require(v2_ui, "d119-rental-add-inline", "Inline-Button fuer weitere Artikel")
    require(v2_ui, "d119-rental-set-thumb", "sichtbare Multi-Item-Auswahlleiste")
    require(v2_ui, "d119-rental-card-add", "Plus-Kennzeichnung im Mietkatalog")
    require(v2_ui, "closeOverlayAndBrowse", "Ruecksprung zum Katalog fuer weitere Auswahl")
    require(v2_ui, "d119_rental_cart_v2", "gemeinsamer Rental-V2-Mietkorb")

    expected = {
        "de": ["Mietbedingungen", "10&nbsp;%", "50&nbsp;%", "Verspätete Rückgabe", "Keine Weitervermietung", "Nicht passend oder nicht gefallen"],
        "en": ["Rental terms", "exactly 10%", "50%", "Late return", "No sub-rental", "Does not fit or is not suitable"],
        "fr": ["Conditions de location", "10&nbsp;%", "50&nbsp;%", "Retour tardif", "Pas de sous-location", "La pièce ne convient pas"],
    }
    obsolete = ["ca. 15&nbsp;%", "typically around 15%", "environ 15&nbsp;%"]
    for lang, page in RENTAL_PAGES.items():
        if not page.is_file():
            fail(f"Rental-Seite fehlt: {page.relative_to(BASE)}")
        html = page.read_text(encoding="utf-8")
        require(html, 'id="rentalTermsCanonical"', f"kanonischer Rental-Terms-Sync ({lang})")
        require(html, '/assets/rental-v2.js', f"Rental-V2-Einbindung ({lang})")
        require(html, '/assets/rental-v2-ui.js', f"Rental-V2-UI-Einbindung ({lang})")
        for phrase in expected[lang]:
            require(html, phrase, f"Mietbedingung {phrase} ({lang})")
        for phrase in obsolete:
            if phrase in html:
                fail(f"Rental-Frontend: veraltete Mietpreisregel in {page.relative_to(BASE)} gefunden: {phrase!r}")

    # Rental layers must not directly manipulate protected creative-mode roots.
    for protected in ("swipeView", "chaosView", "outfitView"):
        if protected in bridge:
            fail(f"Rental-Frontend greift in geschuetzten Modus ein: {protected}")
        if protected in v2:
            fail(f"Rental V2 greift in geschuetzten Modus ein: {protected}")
        if protected in v2_ui:
            fail(f"Rental V2 UI greift in geschuetzten Modus ein: {protected}")

    print("Rental-Frontend: Multi-Piece-Plus-UI, V2-Mietkorb, automatische Kaution, Quote, Bedingungen und Fehlerbehandlung konsistent (DE/EN/FR).")


if __name__ == "__main__":
    main()

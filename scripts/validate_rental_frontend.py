#!/usr/bin/env python3
"""Regression checks for the single public Rental V2 frontend."""
from pathlib import Path
import sys

BASE = Path(__file__).resolve().parents[1]
TEMPLATE = BASE / "index_template.html"
V2 = BASE / "assets" / "rental-v2.js"
V2_UI = BASE / "assets" / "rental-v2-ui.js"
V2_PICKER = BASE / "assets" / "rental-v2-picker.js"
PATCHER = BASE / "scripts" / "apply_rental_terms.py"
INJECTOR = BASE / "scripts" / "inject_rental_v2.py"
RENTAL_PAGES = {
    "de": BASE / "mieten" / "index.html",
    "en": BASE / "en" / "mieten" / "index.html",
    "fr": BASE / "fr" / "mieten" / "index.html",
}
LEGACY_RUNTIME = ("/assets/rental-commerce.js", "/assets/rental-v2-bundle.js")


def fail(message: str) -> None:
    print("FEHLER:", message, file=sys.stderr)
    raise SystemExit(1)


def require(text: str, needle: str, label: str) -> None:
    if needle not in text:
        fail(f"Rental-Frontend: {label} fehlt ({needle!r}).")


def main() -> None:
    for path, label in ((V2, "assets/rental-v2.js"), (V2_UI, "assets/rental-v2-ui.js"), (V2_PICKER, "assets/rental-v2-picker.js"), (PATCHER, "scripts/apply_rental_terms.py"), (INJECTOR, "scripts/inject_rental_v2.py")):
        if not path.is_file():
            fail(label + " fehlt.")

    template = TEMPLATE.read_text(encoding="utf-8")
    v2 = V2.read_text(encoding="utf-8")
    v2_ui = V2_UI.read_text(encoding="utf-8")
    v2_picker = V2_PICKER.read_text(encoding="utf-8")
    patcher = PATCHER.read_text(encoding="utf-8")
    injector = INJECTOR.read_text(encoding="utf-8")

    for legacy in LEGACY_RUNTIME:
        if legacy in template:
            fail(f"Template lädt Legacy-Rental-Runtime: {legacy}")

    # Rental V2: one combined request, automatic deposit and transparent summary.
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
    require(v2, ' + "/rental-bundle"', "atomare Bundle-Anbindung")
    require(v2, '"Idempotency-Key"', "Idempotency-Header")
    require(v2, "RUNTIME_AUDIT_ATOMIC_BUNDLE_POST", "Single-Bundle-Runtime")
    require(v2, "RUNTIME_AUDIT_NO_PAST_RENTAL", "Vergangenheits-Sperre")
    if ' + "/rental-request"' in v2:
        fail("Rental V2 sendet weiterhin einzelne /rental-request Requests.")

    # UI enhancement: explicit plus picker, selection rail and rental-card affordance.
    require(v2_ui, "d119-rental-set-add", "Plus-Kachel fuer weitere Mietartikel")
    require(v2_ui, "d119-rental-add-side", "seitliches Plus im Mietfenster")
    require(v2_ui, "d119-rental-add-inline", "Inline-Button fuer weitere Artikel")
    require(v2_ui, "d119-rental-set-thumb", "sichtbare Multi-Item-Auswahlleiste")
    require(v2_ui, "d119-rental-card-add", "Plus-Kennzeichnung im Mietkatalog")
    require(v2_ui, "d119_rental_cart_v2", "gemeinsamer Rental-V2-Mietkorb")

    # Integrated picker: reviewed taxonomy and direct Rental-V2 API, independent of rendered archive cards.
    require(v2_picker, "d119RentalIntegratedPicker", "integrierter Piece-Picker")
    require(v2_picker, "d119-rental-picker__search", "Piece-Suche")
    require(v2_picker, "data-picker-category", "Kategorie-Filter")
    require(v2_picker, "data-picker-toggle", "direktes Hinzufuegen im Picker")
    require(v2_picker, "RENTAL_RATE_BPS = 1000", "10-Prozent-Tagespreis im Picker")
    require(v2_picker, "d119_rental_cart_v2", "gemeinsamer Rental-V2-State im Picker")
    require(v2_picker, "#d119RentalAddSide,#d119RentalStripAdd,#d119RentalAddInline", "Uebernahme aller Plus-Einstiege")
    require(v2_picker, "item.taxonomy_category || item.category", "geprüfte Taxonomie mit Legacy-Fallback")
    require(v2_picker, "api.toggleItem(id)", "direkte Rental-V2-API fuer Off-DOM-Artikel")

    require(patcher, "RUNTIME_TERMS_V2_ANCHOR", "Rental-Terms V2-Anker")
    require(injector, "Single Rental V2 + UI + Picker", "Single-Runtime Injector")

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
        require(html, '/assets/rental-v2-picker.js', f"Rental-Picker-Einbindung ({lang})")
        for legacy in LEGACY_RUNTIME:
            if legacy in html:
                fail(f"Rental-Seite {page.relative_to(BASE)} lädt Legacy-Runtime: {legacy}")
        for phrase in expected[lang]:
            require(html, phrase, f"Mietbedingung {phrase} ({lang})")
        for phrase in obsolete:
            if phrase in html:
                fail(f"Rental-Frontend: veraltete Mietpreisregel in {page.relative_to(BASE)} gefunden: {phrase!r}")

    # Rental layers must not directly manipulate protected creative-mode roots.
    for protected in ("swipeView", "chaosView", "outfitView"):
        if protected in v2:
            fail(f"Rental V2 greift in geschuetzten Modus ein: {protected}")
        if protected in v2_ui:
            fail(f"Rental V2 UI greift in geschuetzten Modus ein: {protected}")
        if protected in v2_picker:
            fail(f"Rental Picker greift in geschuetzten Modus ein: {protected}")

    print("Rental-Frontend: Single Rental V2, integrierter Picker, Multi-Piece-UI, Kaution, atomarer Bundle-Request und Bedingungen konsistent (DE/EN/FR).")


if __name__ == "__main__":
    main()

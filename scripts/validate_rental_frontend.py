#!/usr/bin/env python3
"""Regression checks for the public rental UI / commerce bridge."""
from pathlib import Path
import sys

BASE = Path(__file__).resolve().parents[1]
TEMPLATE = BASE / "index_template.html"
BRIDGE = BASE / "assets" / "rental-commerce.js"
PATCHER = BASE / "scripts" / "apply_rental_terms.py"
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
    if not PATCHER.is_file():
        fail("scripts/apply_rental_terms.py fehlt.")
    template = TEMPLATE.read_text(encoding="utf-8")
    bridge = BRIDGE.read_text(encoding="utf-8")

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
        for phrase in expected[lang]:
            require(html, phrase, f"Mietbedingung {phrase} ({lang})")
        for phrase in obsolete:
            if phrase in html:
                fail(f"Rental-Frontend: veraltete Mietpreisregel in {page.relative_to(BASE)} gefunden: {phrase!r}")

    # This bridge must stay outside the three protected creative modes.
    for protected in ("swipeView", "chaosView", "outfitView"):
        if protected in bridge:
            fail(f"Rental-Frontend greift in geschuetzten Modus ein: {protected}")

    print("Rental-Frontend: Preis, Quote, Idempotency, Bedingungen und Fehlerbehandlung konsistent (DE/EN/FR).")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Regression checks for the public rental UI / commerce bridge."""
from pathlib import Path
import sys

BASE = Path(__file__).resolve().parents[1]
TEMPLATE = BASE / "index_template.html"
BRIDGE = BASE / "assets" / "rental-commerce.js"


def fail(message: str) -> None:
    print("FEHLER:", message, file=sys.stderr)
    raise SystemExit(1)


def require(text: str, needle: str, label: str) -> None:
    if needle not in text:
        fail(f"Rental-Frontend: {label} fehlt ({needle!r}).")


def main() -> None:
    if not BRIDGE.is_file():
        fail("assets/rental-commerce.js fehlt.")
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

    # This bridge must stay outside the three protected creative modes.
    for protected in ("swipeView", "chaosView", "outfitView"):
        if protected in bridge:
            fail(f"Rental-Frontend greift in geschuetzten Modus ein: {protected}")

    print("Rental-Frontend: Preis, Quote, Idempotency und Fehlerbehandlung konsistent.")


if __name__ == "__main__":
    main()

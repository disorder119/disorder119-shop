#!/usr/bin/env python3
"""Remove the obsolete manual rental-price field from the catalog admin.

Rental V2 remains authoritative: daily rent is always 10% of the current sale
price. This script only changes the admin editor; it does not modify rental
constants, public shop UI, Match, Chaos, Baukasten, or mode-guard.json.
"""
from pathlib import Path

BASE = Path(__file__).resolve().parents[1]
ADMIN = BASE / "admin" / "index.html"
MARKER = "ADMIN_RENTAL_READONLY_V1"
FIELD = '        field("Mietpreis (€, leer = auf Anfrage)", "rental_price", "number", it.rental_price || "") +\n'
NOTE = '<p class="quality-note">Mietpreis ist nicht mehr manuell: Rental V2 berechnet unverändert exakt 10 % des Verkaufspreises pro Kalendertag.</p>'


def main() -> None:
    text = ADMIN.read_text(encoding="utf-8")
    if MARKER in text and FIELD not in text:
        print("Admin-Mietpreis bereits read-only.")
        return
    if FIELD not in text:
        raise SystemExit("FEHLER: Erwartetes manuelles Mietpreisfeld im Admin nicht gefunden.")
    text = text.replace(FIELD, "", 1)
    if NOTE in text:
        text = text.replace(NOTE, NOTE + f'<!-- {MARKER} -->', 1)
    else:
        text = text.replace(
            '<div class="banner">',
            f'<!-- {MARKER} -->\n  <div class="banner">',
            1,
        )
    ADMIN.write_text(text, encoding="utf-8")
    print("Admin-Mietpreisfeld entfernt; 10%-Berechnung bleibt read-only sichtbar.")


if __name__ == "__main__":
    main()

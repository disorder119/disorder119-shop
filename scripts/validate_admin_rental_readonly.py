#!/usr/bin/env python3
"""Validate that catalog admin cannot override Rental V2 pricing."""
from pathlib import Path

BASE = Path(__file__).resolve().parents[1]
ADMIN = BASE / "admin" / "index.html"
text = ADMIN.read_text(encoding="utf-8")

checks = {
    "readonly marker": "ADMIN_RENTAL_READONLY_V1" in text,
    "no editable rental field": 'data-field="rental_price"' not in text,
    "no legacy rental field builder": 'field("Mietpreis (€, leer = auf Anfrage)", "rental_price"' not in text,
    "10 percent display remains": 'Number(it.price) * 0.10' in text,
    "rental rule note remains": 'Rental V2 berechnet unverändert exakt 10 % des Verkaufspreises' in text,
}
failed = [name for name, ok in checks.items() if not ok]
if failed:
    raise SystemExit("FEHLER Admin-Rental-Readonly: " + ", ".join(failed))
print("Admin-Rental-Readonly: OK — kein manueller Mietpreis, 10%-Regel unverändert.")

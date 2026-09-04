#!/usr/bin/env python3
"""Validate hard database commerce invariants without touching the mode guard."""
from pathlib import Path
import sys

BASE = Path(__file__).resolve().parents[1]
CORE = BASE / "shop-worker" / "commerce-core.js"
MIGRATION = BASE / "shop-worker" / "migrations" / "0003_state_integrity.sql"


def main() -> None:
    errors: list[str] = []
    core = CORE.read_text(encoding="utf-8")
    sql = MIGRATION.read_text(encoding="utf-8")

    for needle in ["canTransitionInventory", "canTransitionOrder", "canTransitionRental"]:
        if needle not in core:
            errors.append(f"commerce-core.js: State-Guard fehlt: {needle}")

    for needle in [
        "trg_inventory_status_transition",
        "trg_order_status_transition",
        "trg_rental_status_transition",
        "trg_rental_price_integrity_insert",
        "trg_rental_price_integrity_update",
        "invalid_inventory_status_transition",
        "invalid_order_status_transition",
        "invalid_rental_status_transition",
        "invalid_rental_price",
    ]:
        if needle not in sql:
            errors.append(f"0003_state_integrity.sql: Invariante fehlt: {needle}")

    if "NEW.total_price_cents <> NEW.daily_price_cents * NEW.days" not in sql:
        errors.append("0003_state_integrity.sql: Gesamtmiete wird nicht serverseitig validiert")
    if "sale_price_cents" not in sql or "+ 5) / 10" not in sql:
        errors.append("0003_state_integrity.sql: zentrale 10%-Mietpreisregel fehlt")

    if errors:
        for error in errors:
            print("FEHLER:", error, file=sys.stderr)
        raise SystemExit(1)
    print("State-Integritaet: OK (Inventory/Order/Rental + 10%-Mietpreis in D1)")


if __name__ == "__main__":
    main()

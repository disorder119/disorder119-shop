#!/usr/bin/env python3
"""Validate hard database/worker commerce invariants without touching the mode guard."""
from pathlib import Path
import sys

BASE = Path(__file__).resolve().parents[1]
CORE = BASE / "shop-worker" / "commerce-core.js"
WORKER = BASE / "shop-worker" / "worker.js"
MIGRATION = BASE / "shop-worker" / "migrations" / "0003_state_integrity.sql"


def main() -> None:
    errors: list[str] = []
    core = CORE.read_text(encoding="utf-8")
    worker = WORKER.read_text(encoding="utf-8")
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

    for needle in [
        "request_hash",
        "IDEMPOTENCY_KEY_REUSED",
        'requestHash("rental-request", body)',
        'requestHash("create-order", body)',
        'requestHash("capture-order", body)',
        "delete item.paypal_order_id",
        "canTransitionRental(row.status, status)",
        "payload_hash",
    ]:
        if needle not in worker:
            errors.append(f"worker.js: Security-Invariante fehlt: {needle}")
    if "item.paypal_order_id = providerOrderId" in worker:
        errors.append("worker.js: PayPal Provider-ID darf nicht in oeffentlichen Katalog geschrieben werden")

    if errors:
        for error in errors:
            print("FEHLER:", error, file=sys.stderr)
        raise SystemExit(1)
    print("State-Integritaet: OK (Lifecycle, 10%-Miete, Payload-Idempotenz, private Provider-IDs)")


if __name__ == "__main__":
    main()

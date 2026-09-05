#!/usr/bin/env python3
"""Execute and smoke-test the complete Disorder119 D1 migration chain in SQLite CI."""
from __future__ import annotations

import sqlite3
from pathlib import Path

BASE = Path(__file__).resolve().parents[1]
FILES = [
    BASE / "shop-worker" / "schema.sql",
    BASE / "shop-worker" / "migrations" / "0002_commerce_foundation.sql",
    BASE / "shop-worker" / "migrations" / "0003_state_integrity.sql",
    BASE / "shop-worker" / "migrations" / "0004_admin_operations.sql",
    BASE / "shop-worker" / "migrations" / "0005_rental_groups.sql",
]


def main() -> None:
    db = sqlite3.connect(":memory:")
    db.execute("PRAGMA foreign_keys = ON")
    for path in FILES:
        if not path.exists():
            raise SystemExit(f"FEHLER: Migration fehlt: {path.relative_to(BASE)}")
        try:
            db.executescript(path.read_text(encoding="utf-8"))
        except sqlite3.Error as exc:
            raise SystemExit(f"FEHLER in {path.relative_to(BASE)}: {exc}") from exc

    tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    required_tables = {
        "inventory", "commerce_orders", "order_items", "payments", "shipments",
        "rental_reservations", "rental_days", "rentals", "returns", "refunds",
        "audit_events", "idempotency_keys", "order_contact_snapshots", "admin_notes",
        "rental_groups",
    }
    missing = sorted(required_tables - tables)
    if missing:
        raise SystemExit("FEHLER: Tabellen nach Migration fehlen: " + ", ".join(missing))

    rental_columns = {row[1] for row in db.execute("PRAGMA table_info(rental_reservations)")}
    for name in ["group_id", "deposit_cents", "terms_version", "terms_accepted_at"]:
        if name not in rental_columns:
            raise SystemExit(f"FEHLER: rental_reservations.{name} fehlt nach Migration")

    group_columns = {row[1] for row in db.execute("PRAGMA table_info(rental_groups)")}
    for name in ["item_count", "rental_total_cents", "deposit_total_cents", "idempotency_key", "expires_at"]:
        if name not in group_columns:
            raise SystemExit(f"FEHLER: rental_groups.{name} fehlt nach Migration")

    triggers = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='trigger'")}
    for name in [
        "trg_inventory_status_transition",
        "trg_order_status_transition",
        "trg_rental_status_transition",
        "trg_rental_group_complete_before_reserve",
        "trg_rental_group_totals_before_reserve",
        "trg_rental_group_status_transition",
    ]:
        if name not in triggers:
            raise SystemExit(f"FEHLER: Trigger fehlt nach Migration: {name}")

    # Directly smoke-test that the group lifecycle cannot skip from RESERVED to RETURNED.
    db.execute(
        """INSERT INTO rental_groups
        (id,status,item_count,start_date,end_date,days,rental_total_cents,deposit_total_cents,currency,price_on_request,
         idempotency_key,expires_at,created_at,updated_at)
        VALUES ('test-group','RESERVED',1,'2026-09-10','2026-09-10',1,1000,5000,'EUR',0,'test-key',NULL,'2026-09-05','2026-09-05')"""
    )
    try:
        db.execute("UPDATE rental_groups SET status='RETURNED' WHERE id='test-group'")
    except sqlite3.IntegrityError as exc:
        if "invalid_rental_group_status_transition" not in str(exc):
            raise SystemExit(f"FEHLER: falscher Lifecycle-Triggerfehler: {exc}") from exc
    else:
        raise SystemExit("FEHLER: Ungueltiger Rental-Group-Statussprung wurde von D1 nicht blockiert")

    print("D1-Migrationskette: OK (schema + 0002 + 0003 + 0004 + 0005, inkl. Rental-Group-Lifecycle)")


if __name__ == "__main__":
    main()

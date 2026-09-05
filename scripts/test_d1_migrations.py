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
        "trg_rental_materialize_on_confirm",
        "trg_rental_record_status_sync",
        "trg_rental_record_deposit_sync",
        "trg_rental_group_complete_before_reserve",
        "trg_rental_group_totals_before_reserve",
        "trg_rental_group_status_transition",
    ]:
        if name not in triggers:
            raise SystemExit(f"FEHLER: Trigger fehlt nach Migration: {name}")

    # Confirming a reservation must create exactly one durable rental row used by
    # deposit, return and refund workflows. Later lifecycle/deposit changes must
    # remain synchronized at the D1 layer even if a future admin path forgets it.
    db.execute(
        """INSERT INTO inventory
        (id,item_id,article_no,status,sale_price_cents,currency,catalog_status,version,updated_at)
        VALUES ('inv-materialize',999001,'T-999001','AVAILABLE',10000,'EUR','AVAILABLE',1,'2026-09-05T10:00:00Z')"""
    )
    db.execute(
        """INSERT INTO rental_reservations
        (id,inventory_id,start_date,end_date,days,daily_price_cents,total_price_cents,currency,price_on_request,status,
         idempotency_key,deposit_cents,created_at,updated_at)
        VALUES ('rr-materialize','inv-materialize','2026-09-10','2026-09-11',2,1000,2000,'EUR',0,'RESERVED',
                'materialize-test-key',5000,'2026-09-05T10:00:00Z','2026-09-05T10:00:00Z')"""
    )
    before = db.execute("SELECT COUNT(*) FROM rentals WHERE rental_reservation_id='rr-materialize'").fetchone()[0]
    if before != 0:
        raise SystemExit("FEHLER: Durable Rental wurde vor CONFIRMED materialisiert")

    db.execute(
        "UPDATE rental_reservations SET status='CONFIRMED',updated_at='2026-09-05T10:01:00Z' WHERE id='rr-materialize'"
    )
    materialized = db.execute(
        """SELECT rental_reservation_id,inventory_id,status,deposit_cents,due_at,started_at,returned_at
           FROM rentals WHERE rental_reservation_id='rr-materialize'"""
    ).fetchall()
    expected = [("rr-materialize", "inv-materialize", "CONFIRMED", 5000, "2026-09-11", None, None)]
    if materialized != expected:
        raise SystemExit(f"FEHLER: Durable Rental nach CONFIRMED unerwartet: {materialized!r}")

    db.execute(
        "UPDATE rental_reservations SET status='ACTIVE',updated_at='2026-09-05T10:02:00Z' WHERE id='rr-materialize'"
    )
    active = db.execute(
        "SELECT status,started_at FROM rentals WHERE rental_reservation_id='rr-materialize'"
    ).fetchone()
    if active != ("ACTIVE", "2026-09-05T10:02:00Z"):
        raise SystemExit(f"FEHLER: Durable Rental ACTIVE-Sync fehlgeschlagen: {active!r}")

    db.execute(
        "UPDATE rental_reservations SET deposit_cents=6000,updated_at='2026-09-05T10:03:00Z' WHERE id='rr-materialize'"
    )
    deposit = db.execute(
        "SELECT deposit_cents FROM rentals WHERE rental_reservation_id='rr-materialize'"
    ).fetchone()[0]
    if deposit != 6000:
        raise SystemExit(f"FEHLER: Durable Rental Kautions-Sync fehlgeschlagen: {deposit!r}")

    db.execute(
        "UPDATE rental_reservations SET status='RETURNED',updated_at='2026-09-05T10:04:00Z' WHERE id='rr-materialize'"
    )
    returned = db.execute(
        "SELECT status,returned_at FROM rentals WHERE rental_reservation_id='rr-materialize'"
    ).fetchone()
    if returned != ("RETURNED", "2026-09-05T10:04:00Z"):
        raise SystemExit(f"FEHLER: Durable Rental RETURNED-Sync fehlgeschlagen: {returned!r}")

    count = db.execute("SELECT COUNT(*) FROM rentals WHERE rental_reservation_id='rr-materialize'").fetchone()[0]
    if count != 1:
        raise SystemExit(f"FEHLER: CONFIRMED darf genau einen Durable Rental erzeugen, gefunden: {count}")

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

    print(
        "D1-Migrationskette: OK (schema + 0002 + 0003 + 0004 + 0005, "
        "inkl. Durable-Rental-Materialisierung und Rental-Group-Lifecycle)"
    )


if __name__ == "__main__":
    main()

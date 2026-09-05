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
    BASE / "shop-worker" / "migrations" / "0006_operations_cases.sql",
    BASE / "shop-worker" / "migrations" / "0007_operations_automation.sql",
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
        "rental_groups", "damage_cases", "operations_tasks",
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

    damage_columns = {row[1] for row in db.execute("PRAGMA table_info(damage_cases)")}
    for name in ["rental_id", "return_id", "severity", "estimated_amount_cents", "withheld_amount_cents", "resolved_at"]:
        if name not in damage_columns:
            raise SystemExit(f"FEHLER: damage_cases.{name} fehlt nach Migration")

    task_columns = {row[1] for row in db.execute("PRAGMA table_info(operations_tasks)")}
    for name in [
        "entity_type", "entity_id", "priority", "status", "due_at", "completed_at",
        "automation_key", "automation_kind", "auto_managed", "first_seen_at",
        "last_seen_at", "occurrence_count",
    ]:
        if name not in task_columns:
            raise SystemExit(f"FEHLER: operations_tasks.{name} fehlt nach Migration")

    indexes = {row[1] for row in db.execute("PRAGMA index_list(operations_tasks)")}
    if "uniq_operations_tasks_automation_key" not in indexes:
        raise SystemExit("FEHLER: Dedupe-Index fuer automatische Operations-Tasks fehlt")

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

    durable = db.execute("SELECT id FROM rentals WHERE rental_reservation_id='rr-materialize'").fetchone()
    if not durable:
        raise SystemExit("FEHLER: Durable Rental fehlt fuer Operations-Cases-Smoke-Test")
    durable_id = durable[0]

    # Operational records must be structurally usable without touching a payment
    # provider. They are private D1 records only.
    db.execute(
        """INSERT INTO damage_cases
        (id,rental_id,severity,status,description,estimated_amount_cents,withheld_amount_cents,created_at,updated_at)
        VALUES ('damage-test',?,'MINOR','OPEN','Test damage',1200,600,'2026-09-05T10:05:00Z','2026-09-05T10:05:00Z')""",
        (durable_id,),
    )
    damage = db.execute(
        "SELECT severity,status,estimated_amount_cents,withheld_amount_cents FROM damage_cases WHERE id='damage-test'"
    ).fetchone()
    if damage != ("MINOR", "OPEN", 1200, 600):
        raise SystemExit(f"FEHLER: Damage-Case-Schema unerwartet: {damage!r}")

    db.execute(
        """INSERT INTO operations_tasks
        (id,entity_type,entity_id,title,priority,status,due_at,created_at,updated_at)
        VALUES ('task-test','RENTAL',?,'Rueckgabe pruefen','HIGH','OPEN','2026-09-12T12:00:00Z','2026-09-05T10:05:00Z','2026-09-05T10:05:00Z')""",
        (durable_id,),
    )
    task = db.execute(
        "SELECT entity_type,priority,status,auto_managed,automation_key FROM operations_tasks WHERE id='task-test'"
    ).fetchone()
    if task != ("RENTAL", "HIGH", "OPEN", 0, None):
        raise SystemExit(f"FEHLER: Manueller Operations-Task unerwartet: {task!r}")

    # Automated tasks have a durable unique key while manual tasks retain NULL.
    db.execute(
        """INSERT INTO operations_tasks
        (id,entity_type,entity_id,title,priority,status,created_at,updated_at,
         automation_key,automation_kind,auto_managed,first_seen_at,last_seen_at,occurrence_count)
        VALUES ('task-auto-1','SYSTEM','payment-event-1','Payment Event pruefen','URGENT','OPEN',
                '2026-09-05T10:06:00Z','2026-09-05T10:06:00Z','ops-auto-v1:PAYMENT_EVENT_UNPROCESSED:event-1',
                'PAYMENT_EVENT_UNPROCESSED',1,'2026-09-05T10:06:00Z','2026-09-05T10:06:00Z',1)"""
    )
    auto_task = db.execute(
        "SELECT auto_managed,automation_kind,occurrence_count FROM operations_tasks WHERE id='task-auto-1'"
    ).fetchone()
    if auto_task != (1, "PAYMENT_EVENT_UNPROCESSED", 1):
        raise SystemExit(f"FEHLER: Automatischer Operations-Task unerwartet: {auto_task!r}")
    try:
        db.execute(
            """INSERT INTO operations_tasks
            (id,entity_type,entity_id,title,priority,status,created_at,updated_at,automation_key,auto_managed)
            VALUES ('task-auto-duplicate','SYSTEM','payment-event-1','Duplikat','URGENT','OPEN',
                    '2026-09-05T10:06:01Z','2026-09-05T10:06:01Z','ops-auto-v1:PAYMENT_EVENT_UNPROCESSED:event-1',1)"""
        )
    except sqlite3.IntegrityError:
        pass
    else:
        raise SystemExit("FEHLER: Automations-Dedupe-Key erlaubt doppelte Tasks")

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
        "D1-Migrationskette: OK (schema + 0002 + 0003 + 0004 + 0005 + 0006 + 0007, "
        "inkl. Durable-Rental-Materialisierung, Rental-Group-Lifecycle, Operations-Cases und Alert-Dedupe)"
    )


if __name__ == "__main__":
    main()

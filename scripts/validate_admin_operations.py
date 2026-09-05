#!/usr/bin/env python3
"""Exercise the private admin-operations D1 schema in an in-memory SQLite DB.

This complements source-string validators by actually applying schema/migrations
and testing the rental materialization lifecycle. It never touches production.
"""
from __future__ import annotations

import sqlite3
from pathlib import Path

BASE = Path(__file__).resolve().parents[1]
SQL_FILES = [
    BASE / "shop-worker" / "schema.sql",
    BASE / "shop-worker" / "migrations" / "0002_commerce_foundation.sql",
    BASE / "shop-worker" / "migrations" / "0003_state_integrity.sql",
    BASE / "shop-worker" / "migrations" / "0004_admin_operations.sql",
]


def one(db: sqlite3.Connection, sql: str, params=()):
    row = db.execute(sql, params).fetchone()
    return row[0] if row else None


def main() -> None:
    db = sqlite3.connect(":memory:")
    db.execute("PRAGMA foreign_keys=ON")
    for path in SQL_FILES:
        db.executescript(path.read_text(encoding="utf-8"))

    now = "2026-09-05T07:30:00.000Z"
    db.execute(
        """INSERT INTO inventory
        (id,item_id,article_no,status,sale_price_cents,currency,catalog_status,version,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?)""",
        ("inv_test", 900001, "TEST-1", "AVAILABLE", 20000, "EUR", "AVAILABLE", 1, now),
    )
    db.execute(
        """INSERT INTO rental_reservations
        (id,inventory_id,start_date,end_date,days,daily_price_cents,total_price_cents,currency,price_on_request,
         status,idempotency_key,expires_at,purpose,message,created_at,updated_at,group_id,deposit_cents,
         delivery_method,postal_text,risk_notes,terms_version,terms_language,terms_accepted_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (
            "rr_test", "inv_test", "2026-09-10", "2026-09-11", 2, 2000, 4000, "EUR", 0,
            "RESERVED", "rental-test-key-000001", "2026-09-05T08:00:00.000Z", "photo", "test", now, now,
            "rental-v2:test", 10000, "shipping", "63739 Aschaffenburg", "none",
            "rental-2026-09-05-v2", "de", now,
        ),
    )

    # Existing state-integrity trigger must still reject manipulated rental price.
    try:
        db.execute("UPDATE rental_reservations SET daily_price_cents=1999,total_price_cents=3998 WHERE id='rr_test'")
    except sqlite3.IntegrityError as exc:
        if "invalid_rental_price" not in str(exc):
            raise
    else:
        raise SystemExit("FEHLER: Manipulierter Mietpreis wurde von D1-Invarianten akzeptiert.")

    # Confirmation must materialize exactly one durable rental entity.
    db.execute("UPDATE rental_reservations SET status='CONFIRMED',updated_at=? WHERE id='rr_test'", ("2026-09-05T07:31:00.000Z",))
    if one(db, "SELECT COUNT(*) FROM rentals WHERE rental_reservation_id='rr_test'") != 1:
        raise SystemExit("FEHLER: CONFIRMED materialisiert keinen eindeutigen rentals-Datensatz.")
    if one(db, "SELECT status FROM rentals WHERE rental_reservation_id='rr_test'") != "CONFIRMED":
        raise SystemExit("FEHLER: Materialisierter Rental-Status ist nicht CONFIRMED.")
    if one(db, "SELECT deposit_cents FROM rentals WHERE rental_reservation_id='rr_test'") != 10000:
        raise SystemExit("FEHLER: Kaution wurde nicht in den dauerhaften Rental-Datensatz uebernommen.")

    # Lifecycle sync must follow valid reservation transitions.
    db.execute("UPDATE rental_reservations SET status='ACTIVE',updated_at=? WHERE id='rr_test'", ("2026-09-10T10:00:00.000Z",))
    if one(db, "SELECT status FROM rentals WHERE rental_reservation_id='rr_test'") != "ACTIVE":
        raise SystemExit("FEHLER: ACTIVE wird nicht in rentals synchronisiert.")
    if not one(db, "SELECT started_at FROM rentals WHERE rental_reservation_id='rr_test'"):
        raise SystemExit("FEHLER: Rental started_at fehlt nach ACTIVE.")

    db.execute("UPDATE rental_reservations SET status='RETURNED',updated_at=? WHERE id='rr_test'", ("2026-09-12T10:00:00.000Z",))
    if one(db, "SELECT status FROM rentals WHERE rental_reservation_id='rr_test'") != "RETURNED":
        raise SystemExit("FEHLER: RETURNED wird nicht in rentals synchronisiert.")
    if not one(db, "SELECT returned_at FROM rentals WHERE rental_reservation_id='rr_test'"):
        raise SystemExit("FEHLER: Rental returned_at fehlt nach RETURNED.")

    # Deposit metadata updates must remain synchronized after materialization.
    db.execute("UPDATE rental_reservations SET deposit_cents=12000,updated_at=? WHERE id='rr_test'", ("2026-09-12T10:01:00.000Z",))
    if one(db, "SELECT deposit_cents FROM rentals WHERE rental_reservation_id='rr_test'") != 12000:
        raise SystemExit("FEHLER: Spaetere Kautionsaenderung wird nicht synchronisiert.")

    # Private operations tables must be writable and linked.
    db.execute(
        "INSERT INTO admin_notes (id,entity_type,entity_id,body,created_at) VALUES (?,?,?,?,?)",
        ("note_test", "RENTAL", "rr_test", "Zustand nach Rueckgabe pruefen", now),
    )
    if one(db, "SELECT COUNT(*) FROM admin_notes WHERE entity_id='rr_test'") != 1:
        raise SystemExit("FEHLER: Admin-Notizen koennen nicht gespeichert werden.")

    order_id = "order_test"
    db.execute(
        """INSERT INTO commerce_orders
        (id,order_number,status,currency,subtotal_cents,shipping_cents,total_cents,idempotency_key,created_at)
        VALUES (?,?,?,?,?,?,?,?,?)""",
        (order_id, "D119-TEST-1", "PAYMENT_PENDING", "EUR", 20000, 0, 20000, "order-test-key-000001", now),
    )
    db.execute(
        """INSERT INTO order_contact_snapshots
        (order_id,source_provider,email,recipient_name,address_line1,postal_code,city,country_code,captured_at)
        VALUES (?,?,?,?,?,?,?,?,?)""",
        (order_id, "PAYPAL", "buyer@example.invalid", "Test Buyer", "Teststrasse 1", "63739", "Aschaffenburg", "DE", now),
    )
    if one(db, "SELECT city FROM order_contact_snapshots WHERE order_id=?", (order_id,)) != "Aschaffenburg":
        raise SystemExit("FEHLER: Checkout-Snapshot ist nicht lesbar.")

    tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    for table in ("order_contact_snapshots", "admin_notes", "commerce_orders", "rental_reservations", "rentals", "audit_events"):
        if table not in tables:
            raise SystemExit(f"FEHLER: Erwartete Operations-Tabelle fehlt: {table}")

    print("Admin-Operations-D1: OK (Migrationen, Mietpreis, Materialisierung, Kaution, Notizen, Checkout-Snapshot)")


if __name__ == "__main__":
    main()

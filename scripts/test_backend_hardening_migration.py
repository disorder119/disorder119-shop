#!/usr/bin/env python3
"""Smoke-test the backend-hardening migration on the complete D1 schema chain."""
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
    BASE / "shop-worker" / "migrations" / "0008_backend_hardening.sql",
]


def expect_integrity_error(db: sqlite3.Connection, sql: str, expected: str) -> None:
    try:
        db.execute(sql)
    except sqlite3.IntegrityError as exc:
        if expected not in str(exc):
            raise SystemExit(f"FEHLER: erwartete {expected!r}, erhalten: {exc}") from exc
    else:
        raise SystemExit(f"FEHLER: D1 hat {expected!r} nicht erzwungen")


def main() -> None:
    db = sqlite3.connect(":memory:")
    db.execute("PRAGMA foreign_keys = ON")
    for path in FILES:
        db.executescript(path.read_text(encoding="utf-8"))

    triggers = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='trigger'")}
    expected_triggers = {
        "trg_rental_duration_insert",
        "trg_rental_duration_update",
        "trg_rental_group_duration_insert",
        "trg_rental_group_duration_update",
    }
    missing = sorted(expected_triggers - triggers)
    if missing:
        raise SystemExit("FEHLER: Backend-Hardening-Trigger fehlen: " + ", ".join(missing))

    db.execute(
        """INSERT INTO inventory
        (id,item_id,article_no,status,sale_price_cents,currency,catalog_status,version,updated_at)
        VALUES ('inv-hardening',990001,'H-990001','AVAILABLE',10000,'EUR','AVAILABLE',1,'2026-09-08T10:00:00Z')"""
    )

    db.execute(
        """INSERT INTO rental_reservations
        (id,inventory_id,start_date,end_date,days,daily_price_cents,total_price_cents,currency,price_on_request,status,
         idempotency_key,created_at,updated_at)
        VALUES ('rr-seven','inv-hardening','2026-09-10','2026-09-16',7,1000,7000,'EUR',0,'RESERVED',
                'backend-hardening-valid-seven','2026-09-08T10:00:00Z','2026-09-08T10:00:00Z')"""
    )

    expect_integrity_error(
        db,
        """INSERT INTO rental_reservations
        (id,inventory_id,start_date,end_date,days,daily_price_cents,total_price_cents,currency,price_on_request,status,
         idempotency_key,created_at,updated_at)
        VALUES ('rr-eight','inv-hardening','2026-09-20','2026-09-27',8,1000,8000,'EUR',0,'RESERVED',
                'backend-hardening-invalid-eight','2026-09-08T10:00:00Z','2026-09-08T10:00:00Z')""",
        "invalid_rental_duration",
    )

    expect_integrity_error(
        db,
        "UPDATE rental_reservations SET end_date='2026-09-17',days=8,total_price_cents=8000 WHERE id='rr-seven'",
        "invalid_rental_duration",
    )

    db.execute(
        """INSERT INTO rental_groups
        (id,status,item_count,start_date,end_date,days,rental_total_cents,deposit_total_cents,currency,price_on_request,
         idempotency_key,created_at,updated_at)
        VALUES ('rg-seven','BUILDING',1,'2026-10-01','2026-10-07',7,7000,5000,'EUR',0,
                'backend-hardening-group-seven','2026-09-08T10:00:00Z','2026-09-08T10:00:00Z')"""
    )

    expect_integrity_error(
        db,
        """INSERT INTO rental_groups
        (id,status,item_count,start_date,end_date,days,rental_total_cents,deposit_total_cents,currency,price_on_request,
         idempotency_key,created_at,updated_at)
        VALUES ('rg-eight','BUILDING',1,'2026-10-10','2026-10-17',8,8000,5000,'EUR',0,
                'backend-hardening-group-eight','2026-09-08T10:00:00Z','2026-09-08T10:00:00Z')""",
        "invalid_rental_group_duration",
    )

    print("Backend-Hardening-Migration: OK — D1 erzwingt maximal 7 Miettage.")


if __name__ == "__main__":
    main()

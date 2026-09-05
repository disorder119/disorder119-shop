#!/usr/bin/env python3
"""Hard commerce invariants that complement validate_shop.py.

This validator deliberately does not touch or re-initialize the mode guard.
"""
from __future__ import annotations

import json
import re
import sys
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path

BASE = Path(__file__).resolve().parents[1]
ITEMS = BASE / "data" / "items.json"
WORKER = BASE / "shop-worker" / "worker.js"
ENTRY = BASE / "shop-worker" / "worker-entry.js"
ADMIN_API = BASE / "shop-worker" / "admin-api.js"
CORE = BASE / "shop-worker" / "commerce-core.js"
MIGRATION = BASE / "shop-worker" / "migrations" / "0002_commerce_foundation.sql"
ADMIN_MIGRATION = BASE / "shop-worker" / "migrations" / "0004_admin_operations.sql"
WRANGLER = BASE / "shop-worker" / "wrangler.toml"
CONFIG = BASE / "config" / "shop-config.json"

INVENTORY_STATUSES = {
    "AVAILABLE", "RESERVED", "PAYMENT_PENDING", "PAID", "PREPARING", "SHIPPED",
    "DELIVERED", "RETURN_REQUESTED", "RETURNED", "REFUNDED", "CANCELLED",
}
FORBIDDEN_PUBLIC_DATA = {
    "customers.json", "customer-addresses.json", "customer_addresses.json", "orders.json",
    "payments.json", "shipments.json", "returns.json", "refunds.json", "rentals.json",
    "rental-requests.json", "sessions.json",
}
RENTAL_FIELDS = ("rental_price", "rentalPrice", "daily_rental_price", "rentalDailyPrice")


def fail(messages: list[str]) -> None:
    for message in messages:
        print("FEHLER:", message, file=sys.stderr)
    raise SystemExit(1)


def load(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        fail([f"{path.relative_to(BASE)} unlesbar: {exc}"])


def price_cents(value):
    if value is None or value == "":
        return None
    try:
        amount = Decimal(str(value).replace(",", "."))
    except InvalidOperation:
        return None
    if amount <= 0:
        return None
    return int((amount * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def expected_daily_cents(sale_cents: int | None):
    if sale_cents is None:
        return None
    return int((Decimal(sale_cents) * Decimal("0.10")).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def main() -> None:
    errors: list[str] = []
    items = load(ITEMS)
    cfg = load(CONFIG)
    worker = WORKER.read_text(encoding="utf-8")
    core = CORE.read_text(encoding="utf-8")
    migration = MIGRATION.read_text(encoding="utf-8")

    for required in (ENTRY, ADMIN_API, ADMIN_MIGRATION, WRANGLER):
        if not required.is_file():
            errors.append(f"Backend-Datei fehlt: {required.relative_to(BASE)}")
    if errors:
        fail(errors)

    entry = ENTRY.read_text(encoding="utf-8")
    admin_api = ADMIN_API.read_text(encoding="utf-8")
    admin_migration = ADMIN_MIGRATION.read_text(encoding="utf-8")
    wrangler = WRANGLER.read_text(encoding="utf-8")

    # Central rental rule: no catalogue item may override the server rule with a conflicting fixed field.
    for item in items:
        if not isinstance(item, dict):
            continue
        item_id = item.get("id", "?")
        sale = price_cents(item.get("price"))
        expected = expected_daily_cents(sale)
        for field in RENTAL_FIELDS:
            if field not in item:
                continue
            actual = price_cents(item.get(field))
            if expected is None and actual is not None:
                errors.append(f"Artikel {item_id}: {field} setzt Mietpreis trotz Preis auf Anfrage")
            elif expected is not None and actual != expected:
                errors.append(f"Artikel {item_id}: {field} verletzt zentrale 10%-Regel ({actual} statt {expected} Cent)")

    # Never allow likely customer/transaction JSON stores in the public static repository.
    for path in (BASE / "data").rglob("*.json"):
        if path.name.lower() in FORBIDDEN_PUBLIC_DATA:
            errors.append(f"Personen-/Transaktionsdatei im oeffentlichen Repo: {path.relative_to(BASE)}")

    required_core = [
        "RENTAL_RATE_BPS = 1000", "rentalDailyPriceCents", "rentalQuoteFromItem",
        "isValidIdempotencyKey", "canTransitionInventory", "canTransitionOrder", "canTransitionRental",
    ]
    for needle in required_core:
        if needle not in core:
            errors.append(f"commerce-core.js: Invariante fehlt: {needle}")

    # Old public GitHub JSON rental persistence must stay removed.
    for forbidden in ["rental-requests.json", "rentalRequestsPath", "appendRentalRequest(env", "loadRentalRequests(env"]:
        if forbidden in worker:
            errors.append(f"worker.js enthaelt veralteten Public-JSON-Mietpfad: {forbidden}")

    required_worker = [
        "Idempotency-Key", "MAX_REQUEST_BYTES", "ORIGIN_NOT_ALLOWED", "PAYMENT_MISMATCH",
        "verifyPaypalWebhook", "TURNSTILE_SECRET", "RATE_LIMITER", "payment_events",
        "audit_events", "rentalQuoteFromItem", "COMMERCE_DATABASE_NOT_CONFIGURED",
    ]
    for needle in required_worker:
        if needle not in worker:
            errors.append(f"worker.js: Security-/Commerce-Invariante fehlt: {needle}")

    for status in sorted(INVENTORY_STATUSES):
        if status not in migration:
            errors.append(f"D1-Migration: Inventarstatus fehlt: {status}")

    required_tables = [
        "customers", "customer_addresses", "inventory", "reservations", "commerce_orders", "order_items",
        "payments", "payment_events", "shipments", "rental_reservations", "rental_days", "rentals",
        "returns", "refunds", "audit_events", "idempotency_keys", "account_privacy_requests",
    ]
    for table in required_tables:
        if not re.search(rf"CREATE TABLE IF NOT EXISTS\s+{re.escape(table)}\b", migration, re.I):
            errors.append(f"D1-Migration: Tabelle fehlt: {table}")
    if "PRIMARY KEY(inventory_id, rental_date)" not in migration.replace(" ", ""):
        if not re.search(r"PRIMARY\s+KEY\s*\(\s*inventory_id\s*,\s*rental_date\s*\)", migration, re.I):
            errors.append("D1-Migration: harte Sperre gegen ueberlappende Miettage fehlt")

    # Private admin/operations layer: no second public data store, only D1.
    for needle in [
        'main = "worker-entry.js"',
    ]:
        if needle not in wrangler:
            errors.append(f"wrangler.toml: Admin-Entry fehlt: {needle}")
    for needle in [
        'url.pathname === "/admin"', "handleAdminRequest", "enrichRentalReservation", "snapshotPaypalOrder",
        'url.pathname === "/rental-request"', 'url.pathname === "/capture-order"', 'url.pathname === "/paypal-webhook"',
    ]:
        if needle not in entry:
            errors.append(f"worker-entry.js: Operations-Verdrahtung fehlt: {needle}")
    for needle in [
        '"/admin/overview"', '"/admin/orders"', '"/admin/rentals"', '"/admin/inventory"',
        '"/admin/customers"', '"/admin/activity"', '"/admin/system"', '"/admin/notes"',
        "orderNextStatuses", "rentalNextStatuses", "ADMIN_TOKEN", "order_contact_snapshots", "admin_notes",
    ]:
        if needle not in admin_api:
            errors.append(f"admin-api.js: Admin-Funktion fehlt: {needle}")
    for needle in [
        "deposit_cents", "group_id", "terms_version", "terms_accepted_at",
        "order_contact_snapshots", "admin_notes", "idx_orders_created_status", "idx_payments_created_status",
    ]:
        if needle not in admin_migration:
            errors.append(f"0004_admin_operations.sql: Operations-Invariante fehlt: {needle}")
    for forbidden in ["raw_payload", "payload_json", "paypal_payload"]:
        if forbidden in admin_migration.lower():
            errors.append(f"0004_admin_operations.sql: roher Provider-Payload darf nicht gespeichert werden: {forbidden}")

    features = cfg.get("features") or {}
    if features.get("paypalCheckout"):
        if not cfg.get("paypalClientId") or not cfg.get("shopWorkerUrl"):
            errors.append("paypalCheckout darf ohne Client-ID und Worker-URL nicht aktiviert sein")
    if features.get("customerAccounts") and not cfg.get("authProvider"):
        errors.append("customerAccounts darf ohne externen Auth-Provider nicht aktiviert sein")

    for sale, daily in [(12500, 1250), (25000, 2500), (49000, 4900)]:
        if expected_daily_cents(sale) != daily:
            errors.append(f"Interner Mietpreis-Test fehlgeschlagen: {sale} -> {daily}")

    if errors:
        fail(errors)
    print("Commerce-Invarianten: OK (10%-Miete, D1-Lifecycle, Idempotenz, Security + private Admin-Operations)")


if __name__ == "__main__":
    main()

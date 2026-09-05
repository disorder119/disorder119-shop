#!/usr/bin/env python3
"""Validate the atomic Rental V2 multi-item backend without touching Mode Guard."""
from pathlib import Path
import sys

BASE = Path(__file__).resolve().parents[1]
BUNDLE = BASE / "shop-worker" / "rental-bundle.js"
ENTRY = BASE / "shop-worker" / "worker-entry.js"
MIGRATION = BASE / "shop-worker" / "migrations" / "0005_rental_groups.sql"
BRIDGE = BASE / "assets" / "rental-v2-bundle.js"
INJECT = BASE / "scripts" / "inject_rental_v2.py"


def main() -> None:
    errors: list[str] = []
    files = [BUNDLE, ENTRY, MIGRATION, BRIDGE, INJECT]
    for path in files:
        if not path.exists():
            errors.append(f"Fehlende Rental-Bundle-Datei: {path.relative_to(BASE)}")
    if errors:
        for error in errors:
            print("FEHLER:", error, file=sys.stderr)
        raise SystemExit(1)

    bundle = BUNDLE.read_text(encoding="utf-8")
    entry = ENTRY.read_text(encoding="utf-8")
    migration = MIGRATION.read_text(encoding="utf-8")
    bridge = BRIDGE.read_text(encoding="utf-8")
    inject = INJECT.read_text(encoding="utf-8")

    for needle in [
        "MAX_BUNDLE_ITEMS = 20",
        "STANDARD_MAX_DAYS = 7",
        "DEPOSIT_RATE_BPS = 5000",
        "DEPOSIT_MIN_CENTS = 5000",
        'scope: "rental-bundle"',
        "IDEMPOTENCY_KEY_REUSED",
        "rentalQuoteFromItem",
        "preflightAvailability",
        "createAtomicBundle",
        "RENTAL_TERMS_ACCEPTANCE_REQUIRED",
        "RENTAL_DATES_UNAVAILABLE",
        "rental_groups",
        "group_id",
        "deposit_cents",
        "db.batch(statements)",
    ]:
        if needle not in bundle:
            errors.append(f"rental-bundle.js: Invariante fehlt: {needle}")

    for needle in [
        'url.pathname === "/rental-bundle"',
        "handleRentalBundle",
        'from "./rental-bundle.js"',
    ]:
        if needle not in entry:
            errors.append(f"worker-entry.js: Bundle-Routing fehlt: {needle}")

    for needle in [
        "CREATE TABLE IF NOT EXISTS rental_groups",
        "item_count INTEGER NOT NULL CHECK (item_count BETWEEN 1 AND 20)",
        "trg_rental_group_complete_before_reserve",
        "rental_group_incomplete",
        "trg_rental_group_totals_before_reserve",
        "invalid_rental_group_totals",
        "expires_at TEXT",
    ]:
        if needle not in migration:
            errors.append(f"0005_rental_groups.sql: Invariante fehlt: {needle}")

    for needle in [
        'STORAGE_KEY = "d119_rental_cart_v2"',
        'TERMS_VERSION = "rental-2026-09-05-v2"',
        '"/rental-bundle"',
        '"Idempotency-Key"',
        "event.stopImmediatePropagation()",
        "keepalive: true",
        "termsAcceptedAt",
        "d119_rental_bundle_receipts",
    ]:
        if needle not in bridge:
            errors.append(f"rental-v2-bundle.js: Frontend-Invariante fehlt: {needle}")

    if 'V2_BUNDLE = \'<script src="/assets/rental-v2-bundle.js"></script>\'' not in inject:
        errors.append("inject_rental_v2.py: atomarer Bundle-Bridge wird nicht eingebunden")

    forbidden = [
        "mode-guard.json",
        "swipeView",
        "chaosView",
        "outfitView",
    ]
    for needle in forbidden:
        if needle in bundle or needle in bridge:
            errors.append(f"Rental-Bundle darf geschuetzte Modi nicht referenzieren: {needle}")

    if errors:
        for error in errors:
            print("FEHLER:", error, file=sys.stderr)
        raise SystemExit(1)
    print("Atomic Rental Bundle: OK (Multi-Item, Kaution, Idempotenz, D1-Transaktion, Terms, Mode-Isolation)")


if __name__ == "__main__":
    main()

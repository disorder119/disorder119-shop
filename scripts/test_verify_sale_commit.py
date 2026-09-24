#!/usr/bin/env python3
"""Regressionstests fuer scripts/verify_sale_commit.py (ohne Netzwerk)."""
from __future__ import annotations

import copy
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from verify_sale_commit import NotASale, verify  # noqa: E402

BEFORE = [
    {"id": 6241, "title": "Jeans", "price": 90, "public_status": "AVAILABLE", "status": "Verfügbar"},
    {"id": 6242, "title": "Jacke", "price": 120, "public_status": "AVAILABLE", "status": "Verfügbar",
     "reserved_until": "2026-09-24T12:00:00Z", "paypal_order_id": "X1"},
]


def compare(*messages, files=("data/items.json",), status="ahead"):
    return {
        "status": status,
        "behind_by": 0,
        "commits": [{"commit": {"message": m}} for m in messages],
        "files": [{"filename": f, "status": "modified"} for f in files],
    }


def sold(items, item_id):
    out = copy.deepcopy(items)
    for it in out:
        if it["id"] == item_id:
            it["public_status"] = "SOLD"
            it["status"] = "Verkauft"
            for key in ("paypal_order_id", "reserved_until"):
                it.pop(key, None)
    return out


def expect_reject(label, *args):
    try:
        verify(*args)
    except NotASale:
        print(f"ok - rejects: {label}")
        return
    raise SystemExit(f"FEHLER: haette abgelehnt werden muessen: {label}")


def main():
    assert verify(compare("Verkauft: Artikel 6241"), BEFORE, sold(BEFORE, 6241)) == ["6241"]
    print("ok - accepts the worker's single sale commit")

    assert verify(compare("Verkauft: Artikel 6242"), BEFORE, sold(BEFORE, 6242)) == ["6242"]
    print("ok - accepts removal of internal reservation fields")

    both = sold(sold(BEFORE, 6241), 6242)
    assert verify(compare("Verkauft: Artikel 6241", "Verkauft: Artikel 6242"), BEFORE, both) == ["6241", "6242"]
    print("ok - accepts two sale commits in one push")

    expect_reject("a second file in the push",
                  compare("Verkauft: Artikel 6241", files=("data/items.json", "assets/app.js")), BEFORE, sold(BEFORE, 6241))
    expect_reject("a workflow change",
                  compare("Verkauft: Artikel 6241", files=(".github/workflows/main-integrity.yml",)), BEFORE, sold(BEFORE, 6241))
    expect_reject("an extra non-sale commit hidden before the sale commit",
                  compare("Preise anpassen", "Verkauft: Artikel 6241"), BEFORE, sold(BEFORE, 6241))
    expect_reject("a message with a trailing body",
                  compare("Verkauft: Artikel 6241\n\nund noch mehr"), BEFORE, sold(BEFORE, 6241))
    expect_reject("a diverged / force push", compare("Verkauft: Artikel 6241", status="diverged"), BEFORE, sold(BEFORE, 6241))

    wrong_item = sold(BEFORE, 6242)
    expect_reject("an item that is not named in the message", compare("Verkauft: Artikel 6241"), BEFORE, wrong_item)

    price_change = sold(BEFORE, 6241)
    price_change[0]["price"] = 1
    expect_reject("a price change smuggled into a sale", compare("Verkauft: Artikel 6241"), BEFORE, price_change)

    title_change = sold(BEFORE, 6241)
    title_change[0]["title"] = "<script>alert(1)</script>"
    expect_reject("a text change smuggled into a sale", compare("Verkauft: Artikel 6241"), BEFORE, title_change)

    unsell = copy.deepcopy(BEFORE)
    unsell[0]["public_status"] = "DRAFT"
    expect_reject("a status other than SOLD", compare("Verkauft: Artikel 6241"), BEFORE, unsell)

    added_field = sold(BEFORE, 6241)
    added_field[0]["reserved_until"] = "2099-01-01"
    expect_reject("adding a reservation field", compare("Verkauft: Artikel 6241"), BEFORE, added_field)

    expect_reject("a removed item", compare("Verkauft: Artikel 6241"), BEFORE, sold(BEFORE, 6241)[:1])
    expect_reject("no change at all", compare("Verkauft: Artikel 6241"), BEFORE, copy.deepcopy(BEFORE))
    print("verify_sale_commit: alle Pruefungen bestanden")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Repair only catalog-source defects that are unambiguous from the record itself.

This script intentionally does not guess missing metadata or renumber duplicate
legacy article numbers. It only applies repairs backed by explicit title/
description evidence and fails if the expected record no longer matches.
"""
from __future__ import annotations

import json
from pathlib import Path

BASE = Path(__file__).resolve().parents[1]
ITEMS_PATH = BASE / "data" / "items.json"


def fail(message: str) -> None:
    raise SystemExit("FEHLER: " + message)


def main() -> None:
    items = json.loads(ITEMS_PATH.read_text(encoding="utf-8"))
    by_id = {int(item["id"]): item for item in items}

    item = by_id.get(9536)
    if not item:
        fail("Artikel 9536 fehlt")
    if not str(item.get("title", "")).startswith("Y's "):
        fail("Artikel 9536 ist nicht mehr der erwartete Y's-Datensatz")
    descriptions = " ".join(str(item.get(key, "")) for key in ("desc", "desc_de", "desc_en", "desc_fr"))
    if "Y's" not in descriptions:
        fail("Y's-Markenbeleg in den Beschreibungen von Artikel 9536 fehlt")
    if item.get("brand") not in ("", "Y's"):
        fail(f"Artikel 9536 hat unerwartete Marke: {item.get('brand')!r}")

    changed = item.get("brand") != "Y's"
    item["brand"] = "Y's"

    if changed:
        ITEMS_PATH.write_text(json.dumps(items, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print("Katalog-Quellintegritaet: Artikel 9536 -> Marke Y's repariert.")
    else:
        print("Katalog-Quellintegritaet: bereits korrekt.")


if __name__ == "__main__":
    main()

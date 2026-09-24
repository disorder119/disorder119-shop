#!/usr/bin/env python3
"""Prueft, ob ein Direkt-Push auf main ausschliesslich die Verkaufsbuchung des
Shop-Workers ist.

Nach einer bestaetigten Zahlung schreibt der Worker (shop-worker/worker.js,
markCatalogSold) per GitHub-API genau einen Commit "Verkauft: Artikel <id>"
nach main, der nur data/items.json aendert. Der Main-Integrity-Guard wuerde
diesen Push sonst als unautorisiert zuruecksetzen - und ein verkauftes Unikat
stuende wieder als verfuegbar im Shop.

Die Ausnahme haengt bewusst nicht an einer Identitaet, sondern am Inhalt des
gesamten Pushes (before...after):

* der Push ist ein reiner Fast-Forward,
* jeder Commit im Push heisst exakt "Verkauft: Artikel <id>",
* ueber den ganzen Push aendert sich nur data/items.json,
* Reihenfolge und Anzahl der Artikel bleiben gleich,
* geaendert werden nur Artikel, deren id in einer Commit-Nachricht steht,
* und an diesen nur der Verkaufsstatus (public_status -> SOLD,
  status -> Verkauft) plus das Entfernen interner Reservierungsfelder.

Aufruf: verify_sale_commit.py <compare.json> <items_before.json> <items_after.json>
Exit 0 = zulaessige Verkaufsbuchung, Exit 1 = nicht zulaessig (mit Grund).
"""
from __future__ import annotations

import json
import re
import sys

SALE_SUBJECT = re.compile(r"^Verkauft: Artikel (\d+)$")
ITEMS_PATH = "data/items.json"
STATUS_KEYS = {"public_status", "status"}
REMOVABLE_KEYS = {
    "paypal_order_id",
    "reserved_order_id",
    "reserved_until",
    "reserved_price",
    "reserved_currency",
}


class NotASale(Exception):
    pass


def sale_ids_from_commits(compare: dict) -> set[str]:
    commits = compare.get("commits") or []
    if not commits:
        raise NotASale("Push enthaelt keine Commits.")
    ids: set[str] = set()
    for commit in commits:
        message = ((commit.get("commit") or {}).get("message") or "").strip()
        match = SALE_SUBJECT.fullmatch(message)
        if not match:
            first = message.splitlines()[0] if message else ""
            raise NotASale(f"Commit-Nachricht ist keine Verkaufsbuchung: {first[:80]!r}")
        ids.add(match.group(1))
    return ids


def check_range(compare: dict) -> None:
    if compare.get("status") != "ahead" or compare.get("behind_by", 0) != 0:
        raise NotASale("Push ist kein reiner Fast-Forward auf main.")
    files = compare.get("files") or []
    names = sorted({f.get("filename", "") for f in files})
    if names != [ITEMS_PATH]:
        raise NotASale(f"Push aendert andere Dateien als {ITEMS_PATH}: {names[:10]}")
    for f in files:
        if f.get("status") != "modified":
            raise NotASale(f"{ITEMS_PATH} wurde nicht nur geaendert (Status {f.get('status')}).")


def check_items(before: list, after: list, sale_ids: set[str]) -> list[str]:
    if not isinstance(before, list) or not isinstance(after, list):
        raise NotASale("items.json ist keine Liste.")
    if len(before) != len(after):
        raise NotASale("Anzahl der Artikel hat sich geaendert.")
    changed: list[str] = []
    for old, new in zip(before, after):
        if not isinstance(old, dict) or not isinstance(new, dict):
            raise NotASale("Artikel ist kein Objekt.")
        if str(old.get("id")) != str(new.get("id")):
            raise NotASale("Reihenfolge oder ids der Artikel haben sich geaendert.")
        if old == new:
            continue
        item_id = str(new.get("id"))
        if item_id not in sale_ids:
            raise NotASale(f"Artikel {item_id} geaendert, steht aber in keiner Verkaufsnachricht.")
        keys = set(old) | set(new)
        for key in keys:
            if old.get(key) == new.get(key) and (key in old) == (key in new):
                continue
            if key in STATUS_KEYS:
                continue
            if key in REMOVABLE_KEYS and key in old and key not in new:
                continue
            raise NotASale(f"Artikel {item_id}: Feld {key!r} darf bei einer Verkaufsbuchung nicht geaendert werden.")
        if str(new.get("public_status", "")).upper() != "SOLD" or new.get("status") != "Verkauft":
            raise NotASale(f"Artikel {item_id} wird nicht auf SOLD/Verkauft gesetzt.")
        changed.append(item_id)
    if not changed:
        raise NotASale("Keine Verkaufsaenderung gefunden.")
    return changed


def verify(compare: dict, before: list, after: list) -> list[str]:
    sale_ids = sale_ids_from_commits(compare)
    check_range(compare)
    return check_items(before, after, sale_ids)


def main(argv: list[str]) -> int:
    if len(argv) != 4:
        print(__doc__.strip().splitlines()[-2])
        return 2
    with open(argv[1], encoding="utf-8") as fh:
        compare = json.load(fh)
    with open(argv[2], encoding="utf-8") as fh:
        before = json.load(fh)
    with open(argv[3], encoding="utf-8") as fh:
        after = json.load(fh)
    try:
        changed = verify(compare, before, after)
    except NotASale as reason:
        print(f"Keine zulaessige Verkaufsbuchung: {reason}")
        return 1
    print("Verkaufsbuchung des Shop-Workers bestaetigt: Artikel " + ", ".join(changed) + " -> SOLD.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))

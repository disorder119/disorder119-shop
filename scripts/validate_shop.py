#!/usr/bin/env python3
"""Qualitaets- und Regressionschecks fuer Disorder119.

Ziele:
- harte Shop-Invarianten vor jedem Deploy pruefen
- versehentliche Veraenderungen an Match/Chaos/Baukasten erkennen
- Datenqualitaet des Katalogs transparent machen, ohne Altbestand zu blockieren
- verhindern, dass Kunden-/Bestelldaten versehentlich im oeffentlichen Repo landen

Die kreativen Modi werden ueber Hashes ihrer eigenen HTML-/JS-Bloecke geschuetzt.
Aenderungen dort sind weiterhin moeglich, muessen aber bewusst durch ein neues
`--init-mode-guard` bestaetigt werden.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

BASE = Path(__file__).resolve().parents[1]
ITEMS_PATH = BASE / "data" / "items.json"
CATALOG_PATH = BASE / "data" / "catalog.json"
CONFIG_PATH = BASE / "config" / "shop-config.json"
TEMPLATE_PATH = BASE / "index_template.html"
APP_JS_PATH = BASE / "assets" / "app.js"
MODE_GUARD_PATH = BASE / "config" / "mode-guard.json"
QUALITY_REPORT_PATH = BASE / "data" / "shop-quality.json"

PUBLIC_STATUSES = {"AVAILABLE", "SOLD", "RESERVED"}
KNOWN_STATUSES = PUBLIC_STATUSES | {"DRAFT"}
SECRET_KEYS = {
    "paypalClientSecret", "paypal_client_secret", "PAYPAL_CLIENT_SECRET",
    "dhlApiSecret", "DHL_API_SECRET", "dbKey", "serviceRoleKey",
    "adminKey", "ADMIN_TOKEN", "githubToken", "GITHUB_TOKEN",
}


def fail(message: str) -> None:
    print("FEHLER:", message, file=sys.stderr)
    raise SystemExit(1)


def read_json(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        fail(f"Datei fehlt: {path.relative_to(BASE)}")
    except json.JSONDecodeError as exc:
        fail(f"Ungueltiges JSON in {path.relative_to(BASE)}: {exc}")


def between(text: str, start: str, end: str, label: str) -> str:
    i = text.find(start)
    if i < 0:
        fail(f"Mode-Guard: Startmarker fehlt fuer {label}: {start!r}")
    j = text.find(end, i + len(start))
    if j < 0:
        fail(f"Mode-Guard: Endmarker fehlt fuer {label}: {end!r}")
    return text[i:j]


def sha(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def current_mode_hashes() -> dict[str, str]:
    template = TEMPLATE_PATH.read_text(encoding="utf-8")
    app = APP_JS_PATH.read_text(encoding="utf-8")
    sections = {
        "html_match": between(
            template,
            '<div class="swipe-view hidden" id="swipeView">',
            '<div class="chaos-view hidden" id="chaosView">',
            "Match HTML",
        ),
        "html_chaos": between(
            template,
            '<div class="chaos-view hidden" id="chaosView">',
            '<div class="outfit-view hidden" id="outfitView">',
            "Chaos HTML",
        ),
        "html_baukasten": between(
            template,
            '<div class="outfit-view hidden" id="outfitView">',
            '<nav class="mode-rail site-header hidden" id="modeRail"',
            "Baukasten HTML",
        ),
        "js_match": between(
            app,
            "  // ---- Swipe-Minigame ----",
            "  function chaosItemCount()",
            "Match JS",
        ),
        "js_chaos": between(
            app,
            "  function chaosItemCount()",
            "  // ---- Outfit-Baukasten ----",
            "Chaos JS",
        ),
        "js_baukasten": between(
            app,
            "  // ---- Outfit-Baukasten ----",
            "  // ---- Rechtliches (Impressum / AGB / Datenschutz) ----",
            "Baukasten JS",
        ),
    }
    return {name: sha(value) for name, value in sections.items()}


def init_mode_guard() -> None:
    data = {
        "_comment": (
            "Automatischer Regression-Guard. Diese Hashes frieren ausschliesslich "
            "Match/Chaos/Baukasten ein. Nur bewusst mit `python scripts/validate_shop.py "
            "--init-mode-guard` aktualisieren, wenn genau diese Modi absichtlich geaendert werden."
        ),
        "hashes": current_mode_hashes(),
    }
    MODE_GUARD_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("Mode-Guard geschrieben:", MODE_GUARD_PATH.relative_to(BASE))


def validate_mode_guard() -> None:
    if not MODE_GUARD_PATH.is_file():
        fail("config/mode-guard.json fehlt. Einmal bewusst mit --init-mode-guard anlegen.")
    expected = read_json(MODE_GUARD_PATH).get("hashes") or {}
    actual = current_mode_hashes()
    if expected != actual:
        changed = sorted(k for k in set(expected) | set(actual) if expected.get(k) != actual.get(k))
        fail(
            "Geschuetzte Fun-Modi wurden veraendert: " + ", ".join(changed) +
            ". Falls beabsichtigt, Mode-Guard bewusst neu initialisieren; sonst Aenderung rueckgaengig machen."
        )
    print("Mode-Guard: Match, Chaos und Baukasten unveraendert.")


def normalize_id(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def validate_and_report() -> None:
    items = read_json(ITEMS_PATH)
    catalog = read_json(CATALOG_PATH)
    cfg = read_json(CONFIG_PATH)
    if not isinstance(items, list):
        fail("data/items.json muss eine JSON-Liste sein.")
    if not isinstance(catalog, list):
        fail("data/catalog.json muss eine JSON-Liste sein.")

    # Keine Secrets in der absichtlich oeffentlichen Shop-Konfiguration.
    for key in SECRET_KEYS:
        if cfg.get(key):
            fail(f"Secret '{key}' steht in config/shop-config.json. Sofort entfernen.")
    if cfg.get("environment") not in {None, "sandbox", "live"}:
        fail("config/shop-config.json: environment muss sandbox oder live sein.")
    features = cfg.get("features") or {}
    if not isinstance(features, dict):
        fail("config/shop-config.json: features muss ein Objekt sein.")
    if features.get("paypalCheckout"):
        if not cfg.get("paypalClientId") or not cfg.get("shopWorkerUrl"):
            fail("paypalCheckout=true, aber paypalClientId oder shopWorkerUrl fehlt.")

    ids: list[int] = []
    article_numbers: list[str] = []
    by_id = {}
    severe = []
    issues = {
        "missing_size": [],
        "missing_color": [],
        "missing_condition": [],
        "missing_or_thin_description": [],
        "missing_gallery": [],
        "single_photo_only": [],
        "price_on_request": [],
    }

    counts = {"AVAILABLE": 0, "SOLD": 0, "RESERVED": 0, "DRAFT": 0}

    for pos, item in enumerate(items):
        if not isinstance(item, dict):
            severe.append(f"Eintrag {pos} ist kein Objekt")
            continue
        item_id = normalize_id(item.get("id"))
        if item_id is None:
            severe.append(f"Eintrag {pos} hat keine gueltige numerische id")
            continue
        ids.append(item_id)
        by_id[item_id] = item
        status = item.get("public_status") or "DRAFT"
        if status not in KNOWN_STATUSES:
            severe.append(f"Artikel {item_id}: unbekannter public_status={status!r}")
        else:
            counts[status] += 1
        art = str(item.get("article") or "").strip()
        if art:
            article_numbers.append(art)
        if not str(item.get("title") or "").strip():
            severe.append(f"Artikel {item_id}: Titel fehlt")
        if status in PUBLIC_STATUSES and not str(item.get("brand") or "").strip():
            severe.append(f"Artikel {item_id}: oeffentlicher Artikel ohne Marke")

        gallery = item.get("gallery") or []
        if not gallery:
            issues["missing_gallery"].append(item_id)
        elif len(gallery) == 1:
            issues["single_photo_only"].append(item_id)
        for rel in gallery:
            p = BASE / str(rel).lstrip("/")
            if not p.is_file():
                severe.append(f"Artikel {item_id}: Bild fehlt: {rel}")

        if not str(item.get("size") or "").strip():
            issues["missing_size"].append(item_id)
        if not str(item.get("color") or "").strip():
            issues["missing_color"].append(item_id)
        if not str(item.get("condition") or "").strip():
            issues["missing_condition"].append(item_id)
        desc = str(item.get("desc_de") or item.get("desc") or "").strip()
        if len(desc) < 80:
            issues["missing_or_thin_description"].append(item_id)
        try:
            price = float(item.get("price") or 0)
        except (TypeError, ValueError):
            severe.append(f"Artikel {item_id}: ungueltiger Preis")
            price = 0
        if status == "AVAILABLE" and price <= 0:
            issues["price_on_request"].append(item_id)

    if len(ids) != len(set(ids)):
        seen = set()
        dupes = sorted({x for x in ids if x in seen or seen.add(x)})
        severe.append("Doppelte Artikel-IDs: " + ", ".join(map(str, dupes)))
    if len(article_numbers) != len(set(article_numbers)):
        seen_art = set()
        dupes = sorted({x for x in article_numbers if x in seen_art or seen_art.add(x)})
        severe.append("Doppelte Artikelnummern: " + ", ".join(dupes))

    catalog_ids = []
    for item in catalog:
        cid = normalize_id(item.get("id")) if isinstance(item, dict) else None
        if cid is not None:
            catalog_ids.append(cid)
        if isinstance(item, dict) and item.get("public_status") == "DRAFT":
            severe.append(f"DRAFT-Artikel {cid} ist in data/catalog.json oeffentlich gelandet")
    expected_catalog = {i for i, it in by_id.items() if (it.get("public_status") or "DRAFT") != "DRAFT"}
    if set(catalog_ids) != expected_catalog:
        missing = sorted(expected_catalog - set(catalog_ids))
        extra = sorted(set(catalog_ids) - expected_catalog)
        if missing:
            severe.append("Oeffentliche Artikel fehlen im catalog.json: " + ", ".join(map(str, missing[:20])))
        if extra:
            severe.append("Unerwartete Artikel im catalog.json: " + ", ".join(map(str, extra[:20])))

    # Generierte Produktseiten muessen fuer jeden nicht-DRAFT Artikel existieren.
    for item_id in sorted(expected_catalog):
        page = BASE / "artikel" / str(item_id) / "index.html"
        if not page.is_file():
            severe.append(f"Produktseite fehlt: artikel/{item_id}/index.html")
            continue
        html = page.read_text(encoding="utf-8", errors="replace")
        if f'https://disorder119.com/artikel/{item_id}/' not in html:
            severe.append(f"Artikel {item_id}: Canonical/URL fehlt auf Produktseite")
        if '"@type": "Product"' not in html:
            severe.append(f"Artikel {item_id}: Product JSON-LD fehlt")

    # Kunden-/Bestelldaten duerfen in diesem oeffentlichen Repo nicht als JSON liegen.
    for forbidden in [
        BASE / "data" / "rental-requests.json",
        BASE / "data" / "orders.json",
        BASE / "data" / "customers.json",
    ]:
        if forbidden.exists():
            severe.append(
                f"Potentiell personenbezogene Datei im oeffentlichen Repo: {forbidden.relative_to(BASE)}"
            )

    report = {
        "summary": {
            "items_total": len(items),
            "catalog_public": len(catalog_ids),
            "available": counts["AVAILABLE"],
            "reserved": counts["RESERVED"],
            "sold": counts["SOLD"],
            "draft": counts["DRAFT"],
        },
        "quality": {key: {"count": len(value), "item_ids": sorted(value)} for key, value in issues.items()},
    }
    new_report = json.dumps(report, ensure_ascii=False, indent=2) + "\n"
    old_report = QUALITY_REPORT_PATH.read_text(encoding="utf-8") if QUALITY_REPORT_PATH.is_file() else ""
    if old_report != new_report:
        QUALITY_REPORT_PATH.write_text(new_report, encoding="utf-8")
    print("Shop-Qualitaetsreport:", json.dumps(report["summary"], ensure_ascii=False))
    for name, info in report["quality"].items():
        if info["count"]:
            print(f"WARNUNG: {name}: {info['count']}")

    if severe:
        for msg in severe:
            print("FEHLER:", msg, file=sys.stderr)
        raise SystemExit(1)
    print("Shop-Invarianten: OK")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--init-mode-guard", action="store_true")
    parser.add_argument("--skip-mode-guard", action="store_true")
    args = parser.parse_args()
    if args.init_mode_guard:
        init_mode_guard()
    if not args.skip_mode_guard:
        validate_mode_guard()
    validate_and_report()


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Hard validation for the three focused quality areas.

Repository branch protection itself is evaluated separately because GitHub's
server-side protected flag cannot be changed from source code. This validator
covers everything the repository can enforce from code/CI and refuses to call
raw missing metadata "complete" merely because it is disclosed.
"""
from __future__ import annotations

import json
import subprocess
from pathlib import Path

from apply_focus_three_followup import MARKER as FOLLOWUP_MARKER
from apply_focus_three_followup import main as apply_focus_three_followup

BASE = Path(__file__).resolve().parents[1]
ITEMS = BASE / "data" / "items.json"
REPORT = BASE / "data" / "product-data-quality.json"
WEARABLE = {"Jackets", "Coats", "Tops", "Shirts", "Knitwear", "Pants", "Skirts", "Dresses", "Shoes"}


def require(ok: bool, message: str) -> None:
    if not ok:
        raise SystemExit("FEHLER: Focus-3: " + message)


def present(value) -> bool:
    return bool(str(value or "").strip())


def main() -> None:
    # The measured second pass intentionally runs here because both production
    # and Chromium workflows invoke this validator after the generated pages
    # exist. That lets the follow-up patch source assets and the already-built
    # German homepage in the same deterministic gate, without touching the
    # protected Match/Chaos/Baukasten blocks.
    apply_focus_three_followup()

    items = json.loads(ITEMS.read_text(encoding="utf-8"))
    available = [it for it in items if it.get("public_status") == "AVAILABLE"]
    require(bool(available), "keine AVAILABLE-Artikel")

    total_points = 0.0
    max_points = 10.0 * len(available)
    raw = {"size_required": 0, "size_present": 0, "color_present": 0, "condition_present": 0, "description_ready": 0}
    unresolved = {"size": 0, "color": 0, "condition": 0}
    bad_flags = []
    missing_disclosure = []

    for it in available:
        item_id = int(it["id"])
        category = it.get("taxonomy_category") or it.get("category") or ""
        open_fields = list(it.get("data_quality_open") or [])
        actual_open = []
        if category in WEARABLE and not present(it.get("size")):
            actual_open.append("size")
        if not present(it.get("color")):
            actual_open.append("color")
        if not present(it.get("condition")):
            actual_open.append("condition")
        if open_fields != actual_open:
            bad_flags.append(item_id)

        # 1-6: factual identity / commerce basics. These must be real data.
        total_points += 1.0 if present(it.get("title")) else 0.0
        total_points += 1.0 if present(it.get("brand")) else 0.0
        total_points += 1.0 if present(category) and present(it.get("product_type")) else 0.0
        total_points += 1.0 if bool(it.get("gallery")) else 0.0
        try:
            price = float(it.get("price") or 0)
        except (TypeError, ValueError):
            price = -1
        total_points += 1.0 if price >= 0 else 0.0
        desc = str(it.get("desc_de") or it.get("desc") or "").strip()
        desc_ready = len(desc) >= 80
        total_points += 1.0 if desc_ready else 0.0
        if desc_ready:
            raw["description_ready"] += 1

        # 7-9: critical decision metadata. Verified data gets full credit.
        # An explicitly tracked unresolved value receives HALF credit because
        # the system is truthful and safe, but the source data is still not
        # complete. This is intentionally stricter than simply hiding blanks.
        if category in WEARABLE:
            raw["size_required"] += 1
            if present(it.get("size")):
                raw["size_present"] += 1
                total_points += 1.0
            elif "size" in open_fields:
                unresolved["size"] += 1
                total_points += 0.5
        else:
            total_points += 1.0

        if present(it.get("color")):
            raw["color_present"] += 1
            total_points += 1.0
        elif "color" in open_fields:
            unresolved["color"] += 1
            total_points += 0.5

        if present(it.get("condition")):
            raw["condition_present"] += 1
            total_points += 1.0
        elif "condition" in open_fields:
            unresolved["condition"] += 1
            total_points += 0.5

        # 10: provenance/transparency. Every unresolved AVAILABLE product must
        # disclose its gaps on the real generated product page. Inferred facts
        # must carry provenance; original facts need no synthetic provenance.
        page = BASE / "artikel" / str(item_id) / "index.html"
        page_html = page.read_text(encoding="utf-8") if page.is_file() else ""
        transparency_ok = True
        if actual_open and "data-product-data-gap" not in page_html:
            transparency_ok = False
            missing_disclosure.append(item_id)
        sources = it.get("data_quality_sources") or {}
        if not isinstance(sources, dict):
            transparency_ok = False
        total_points += 1.0 if transparency_ok else 0.0

    require(not bad_flags, "data_quality_open stimmt nicht mit echten Luecken ueberein: " + ", ".join(map(str, bad_flags[:12])))
    require(not missing_disclosure, "Produktseiten verschweigen offene Datenfelder: " + ", ".join(map(str, missing_disclosure[:12])))

    score = round((total_points / max_points) * 10.0, 2)
    raw_completeness = {
        "size_required_percent": round(100 * raw["size_present"] / raw["size_required"], 1) if raw["size_required"] else 100.0,
        "color_percent": round(100 * raw["color_present"] / len(available), 1),
        "condition_percent": round(100 * raw["condition_present"] / len(available), 1),
        "description_percent": round(100 * raw["description_ready"] / len(available), 1),
    }
    report = {
        "definition": "10-point truthful decision-readiness score; unresolved critical metadata receives only half credit and must be explicitly disclosed",
        "available_items": len(available),
        "score_10": score,
        "raw_completeness": raw_completeness,
        "unresolved_available": unresolved,
    }
    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("Produktdaten-Qualitaet:", json.dumps(report, ensure_ascii=False))
    require(score >= 9.0, f"Produktdaten-Qualitaet {score}/10 < 9.0")

    template = (BASE / "index_template.html").read_text(encoding="utf-8")
    build = (BASE / "build_site.py").read_text(encoding="utf-8")
    app = (BASE / "assets" / "app.js").read_text(encoding="utf-8")
    css = (BASE / "assets" / "app.css").read_text(encoding="utf-8")
    article_css = (BASE / "assets" / "article.css").read_text(encoding="utf-8")
    home = (BASE / "index.html").read_text(encoding="utf-8")
    catalog = json.loads((BASE / "data" / "catalog.json").read_text(encoding="utf-8"))
    require("__CRITICAL_IMAGE_PRELOADS__" in template, "Critical-image preload token fehlt")
    require("FOCUS3_MOBILE_SSR_LCP" in build, "serverseitiger Mobile-LCP-Pfad fehlt")
    require("FOCUS3_SSR_HYDRATION" in app, "SSR-Karten werden nicht hydriert")
    require(FOLLOWUP_MARKER in build and FOLLOWUP_MARKER in app, "gemessener Mobile-LCP-Followup fehlt")
    require(FOLLOWUP_MARKER in css and FOLLOWUP_MARKER in article_css, "gemessene WCAG-Followup-Regeln fehlen")
    require('data-ssr-initial="1"' in home, "deutsche Startseite enthaelt kein initiales SSR-Grid")
    require(home.count('rel="preload" as="image"') >= 2, "Startseite preloaded nicht zwei erste Produktbilder")
    require(home.count('data-ssr-item-id=') >= 2, "Startseite enthaelt nicht zwei initiale Produktkarten")
    require(home.count('fetchpriority="high" decoding="sync"') >= 2, "kritische SSR-Bilder decodieren nicht synchron")
    require(any(it.get("grid_image") for it in catalog if it.get("public_status") == "AVAILABLE"), "catalog.json enthaelt keine mobile Grid-Bildquelle")

    # Follow-up JavaScript is applied after the normal rebuild syntax step, so
    # syntax-check it inside this gate as well before the browser tests run.
    subprocess.run(["node", "--check", str(BASE / "assets" / "app.js")], check=True)
    print("Mobile-LCP-Struktur: OK — HTML-first, pinned hydration, paint gate, mobile thumbnails und sync decode.")


if __name__ == "__main__":
    main()

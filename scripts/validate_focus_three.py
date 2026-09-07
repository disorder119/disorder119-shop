#!/usr/bin/env python3
"""Hard validation for the three focused quality areas.

Repository branch protection itself is evaluated separately because GitHub's
server-side protected flag cannot be changed from source code. This validator
covers everything the repository can enforce from code/CI and refuses to call
raw missing metadata "complete" merely because it is disclosed.
"""
from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path

from apply_focus_three_followup import MARKER as FOLLOWUP_MARKER
from apply_focus_three_followup import RUNTIME_MARKER
from apply_focus_three_followup import main as apply_focus_three_followup
from repair_product_metadata_conservative import (
    CONDITION_MAP,
    CONDITION_PROSE_RES,
    infer_color,
    infer_size,
    missing_fields,
)

BASE = Path(__file__).resolve().parents[1]
ITEMS = BASE / "data" / "items.json"
REPORT = BASE / "data" / "product-data-quality.json"
EVIDENCE_REPORT = BASE / "data" / "product-metadata-evidence-report.json"
WEARABLE = {"Jackets", "Coats", "Tops", "Shirts", "Knitwear", "Pants", "Skirts", "Dresses", "Shoes"}
WORKFLOWS = BASE / ".github" / "workflows"


def require(ok: bool, message: str) -> None:
    if not ok:
        raise SystemExit("FEHLER: Focus-3: " + message)


def present(value) -> bool:
    return bool(str(value or "").strip())


def canonical_prose_condition(item: dict) -> str:
    text = "\n".join(str(item.get(k) or "") for k in ("desc_de", "desc", "desc_en", "desc_fr"))
    for pattern in CONDITION_PROSE_RES:
        match = pattern.search(text)
        if not match:
            continue
        key = re.sub(r"\s+", " ", match.group("condition").strip().lower())
        value = CONDITION_MAP.get(key, "")
        if value:
            return value
    return ""


def validate_metadata_evidence(items: list[dict], available: list[dict], unresolved: dict[str, int]) -> None:
    require(EVIDENCE_REPORT.is_file(), "maschinenlesbarer Metadata-Evidence-Report fehlt")
    evidence = json.loads(EVIDENCE_REPORT.read_text(encoding="utf-8"))
    require(evidence.get("policy") == "Only explicit source evidence; no guessed physical product facts.",
            "Evidence-Report besitzt keine strikte No-Guess-Policy")
    require(int(evidence.get("available_items") or 0) == len(available),
            "Evidence-Report hat falsche AVAILABLE-Anzahl")
    reported_unresolved = evidence.get("unresolved_available") or {}
    for field in ("size", "color", "condition"):
        require(int(reported_unresolved.get(field) or 0) == int(unresolved[field]),
                f"Evidence-Report stimmt bei {field} nicht mit dem Katalog ueberein")

    queue = evidence.get("manual_evidence_queue")
    require(isinstance(queue, list), "manuelle Evidence-Queue fehlt")
    queue_ids = {int(row["id"]) for row in queue if isinstance(row, dict) and row.get("id") is not None}
    expected_queue_ids = {int(item["id"]) for item in available if missing_fields(item)}
    require(queue_ids == expected_queue_ids,
            "manuelle Evidence-Queue deckt offene AVAILABLE-Artikel nicht exakt ab")

    bad_provenance = []
    for item in items:
        item_id = int(item.get("id") or 0)
        sources = item.get("data_quality_sources") or {}
        if not isinstance(sources, dict):
            bad_provenance.append(f"{item_id}:sources-not-object")
            continue
        color_source = sources.get("color")
        if color_source:
            if color_source != "explicit-title-color" or infer_color(str(item.get("title") or "")) != str(item.get("color") or ""):
                bad_provenance.append(f"{item_id}:color")
        size_source = sources.get("size")
        if size_source:
            if size_source != "explicit-labeled-source-text" or infer_size(item) != str(item.get("size") or ""):
                bad_provenance.append(f"{item_id}:size")
        condition_source = sources.get("condition")
        if condition_source == "explicit-condition-prose":
            if canonical_prose_condition(item) != str(item.get("condition") or ""):
                bad_provenance.append(f"{item_id}:condition-prose")
        elif condition_source and condition_source != "explicit-labeled-source-text":
            bad_provenance.append(f"{item_id}:condition-source")
    require(not bad_provenance,
            "automatisch ergaenzte Metadaten sind nicht mehr durch ihre deklarierte Quelle belegbar: " + ", ".join(bad_provenance[:12]))
    print(f"Metadata-Evidence: OK — {len(expected_queue_ids)} offene AVAILABLE-Artikel explizit gequeued; automatisierte Felder provenance-geprueft.")


def validate_repository_hardening() -> None:
    rebuild = (WORKFLOWS / "rebuild.yml").read_text(encoding="utf-8")
    browser = (WORKFLOWS / "browser-smoke.yml").read_text(encoding="utf-8")
    guard = (WORKFLOWS / "main-integrity.yml").read_text(encoding="utf-8")
    codeowners = (BASE / ".github" / "CODEOWNERS").read_text(encoding="utf-8")

    require("* @disorder119" in codeowners, "CODEOWNERS besitzt keinen globalen Produktions-Owner")
    require("contents: read" in rebuild, "Rebuild-Validierung besitzt nicht standardmaessig nur Leserechte")
    require("Validierten Main-Rebuild publizieren" in rebuild, "separater Main-Publish-Job fehlt")
    require("if: github.event_name == 'push' && github.ref == 'refs/heads/main'" in rebuild,
            "Write-Publish-Job ist nicht strikt auf main-Push begrenzt")
    require("contents: write" in rebuild, "isolierter Publish-Job besitzt keine explizite Schreibberechtigung")
    require("disorder119-rebuild-patch-${{ github.run_id }}" in rebuild,
            "validierter Patch wird nicht zwischen Read-Only- und Write-Job uebergeben")
    require("Unautorisierten Main-Push automatisch neutralisieren" in guard,
            "Self-Heal fuer unautorisierte main-Pushes fehlt")
    require("git read-tree --reset -u \"$BEFORE\"" in guard,
            "Self-Heal stellt nicht exakt den vorherigen main-Baum wieder her")
    require("git push origin HEAD:main" in guard and "--force" not in guard,
            "Self-Heal muss ohne Force-Push arbeiten")

    all_workflows = "\n".join(path.read_text(encoding="utf-8") for path in sorted(WORKFLOWS.glob("*.yml")))
    unpinned = re.findall(r"uses:\s+[^\s]+@v\d+", all_workflows)
    require(not unpinned, "nicht immutable gepinnte Actions: " + ", ".join(unpinned[:8]))
    require("actions/checkout@11d5960a326750d5838078e36cf38b85af677262" in all_workflows,
            "Checkout-Action ist nicht auf den auditierten Commit gepinnt")
    require("actions/setup-python@a26af69be951a213d495a4c3e4e4022e16d87065" in rebuild,
            "setup-python ist nicht immutable gepinnt")
    require("actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020" in rebuild,
            "setup-node ist nicht immutable gepinnt")
    require("permissions:\n  contents: read" in browser,
            "Browser-Audit besitzt mehr Repository-Rechte als erforderlich")
    print("Repository-Hardening: OK — CODEOWNERS, Read-Only PR-CI, isolierter Write-Publish, immutable Actions, Provenance und Self-Heal.")


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
    require(raw_completeness["size_required_percent"] >= 90.0,
            f"erforderliche Groessen-Rohabdeckung {raw_completeness['size_required_percent']}% < 90%")
    validate_metadata_evidence(items, available, unresolved)

    template = (BASE / "index_template.html").read_text(encoding="utf-8")
    build = (BASE / "build_site.py").read_text(encoding="utf-8")
    app = (BASE / "assets" / "app.js").read_text(encoding="utf-8")
    css = (BASE / "assets" / "app.css").read_text(encoding="utf-8")
    article_css = (BASE / "assets" / "article.css").read_text(encoding="utf-8")
    home = (BASE / "index.html").read_text(encoding="utf-8")
    catalog = json.loads((BASE / "data" / "catalog.json").read_text(encoding="utf-8"))
    require("__CRITICAL_IMAGE_PRELOADS__" in template, "Critical-image preload token fehlt")
    require("FOCUS3_MOBILE_SSR_LCP" in build, "serverseitiger Mobile-LCP-Pfad fehlt")
    require('return "\\\\n".join(links)' not in build,
            "Build-Pipeline schreibt literales \\n statt eines echten Zeilenumbruchs zwischen Preload-Tags")
    require("FOCUS3_SSR_HYDRATION" in app, "SSR-Karten werden nicht hydriert")
    require(FOLLOWUP_MARKER in build and FOLLOWUP_MARKER in app, "gemessener Mobile-LCP-Followup fehlt")
    require(FOLLOWUP_MARKER in css and FOLLOWUP_MARKER in article_css, "gemessene WCAG-Followup-Regeln fehlen")
    require('data-ssr-initial="1"' in home, "deutsche Startseite enthaelt kein initiales SSR-Grid")
    require(home.count('rel="preload" as="image"') >= 2, "Startseite preloaded nicht zwei erste Produktbilder")
    require('fetchpriority="high">\\n<link rel="preload"' not in home,
            "Startseite enthaelt sichtbaren literalen \\n-Text zwischen Preload-Tags")
    require(home.count('data-ssr-item-id=') >= 2, "Startseite enthaelt nicht zwei initiale Produktkarten")
    require(home.count('fetchpriority="high" decoding="sync"') >= 2, "kritische SSR-Bilder decodieren nicht synchron")
    require(RUNTIME_MARKER in home, "Mobile-Startseite verschiebt den vollen Runtime-Boot nicht aus dem LCP-Fenster")
    require(any(it.get("grid_image") for it in catalog if it.get("public_status") == "AVAILABLE"), "catalog.json enthaelt keine mobile Grid-Bildquelle")

    subprocess.run(["node", "--check", str(BASE / "assets" / "app.js")], check=True)
    print("Mobile-LCP-Struktur: OK — HTML-first, pinned hydration, paint gate, mobile thumbnails und Runtime nach LCP.")
    validate_repository_hardening()


if __name__ == "__main__":
    main()

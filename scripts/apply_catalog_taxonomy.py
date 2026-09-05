#!/usr/bin/env python3
"""Apply the reviewed Disorder119 catalogue taxonomy.

Default mode enriches data/items.json and writes an audit report before the
normal site build. ``--generated-only`` runs after build_site.py and copies the
same taxonomy into the public catalog plus product-page facts/ARTICLE_ITEM.

The protected legacy ``category`` field is never modified.
"""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

from catalog_taxonomy import (
    apply_taxonomy,
    department_label,
    product_type_label,
    taxonomy_category_label,
)

BASE = Path(__file__).resolve().parents[1]
ITEMS_PATH = BASE / "data" / "items.json"
CATALOG_PATH = BASE / "data" / "catalog.json"
REPORT_PATH = BASE / "data" / "catalog-taxonomy-report.json"
LANGS = ("de", "en", "fr")
PUBLIC_KEYS = (
    "department",
    "product_type",
    "taxonomy_category",
    "size_normalized",
    "size_source",
    "label_size",
    "taxonomy_confidence",
    "taxonomy_reviewed",
)


def load_items() -> list[dict]:
    data = json.loads(ITEMS_PATH.read_text(encoding="utf-8"))
    if not isinstance(data, list):
        raise SystemExit("FEHLER: data/items.json muss eine Liste sein")
    return data


def write_source(items: list[dict]) -> dict:
    # Remove stale taxonomy keys before recomputing so the operation is fully
    # deterministic when rules are improved in a later pass.
    for item in items:
        for key in PUBLIC_KEYS:
            item.pop(key, None)
    report = apply_taxonomy(items)
    ITEMS_PATH.write_text(json.dumps(items, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    REPORT_PATH.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return report


def enrich_catalog(items: list[dict]) -> int:
    if not CATALOG_PATH.exists():
        raise SystemExit("FEHLER: data/catalog.json fehlt; build_site.py zuerst ausführen")
    by_id = {int(item["id"]): item for item in items}
    catalog = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    changed = 0
    for row in catalog:
        source = by_id.get(int(row.get("id") or 0))
        if not source:
            continue
        for key in PUBLIC_KEYS:
            if key in source:
                row[key] = source[key]
        # If a formerly empty size was recovered from a product description,
        # expose that safe value to the browser as well.
        if source.get("size") and not row.get("size"):
            row["size"] = source["size"]
        changed += 1
    CATALOG_PATH.write_text(
        json.dumps(catalog, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    return changed


def article_path(lang: str, item_id: int) -> Path:
    root = BASE if lang == "de" else BASE / lang
    return root / "artikel" / str(item_id) / "index.html"


def replace_product_jsonld(html: str, item: dict, lang: str) -> str:
    pattern = re.compile(r'<script type="application/ld\+json">(.*?)</script>', re.S)

    def repl(match: re.Match[str]) -> str:
        raw = match.group(1)
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            return match.group(0)
        if data.get("@type") != "Product":
            return match.group(0)
        data["category"] = taxonomy_category_label(item["taxonomy_category"], lang)
        props = list(data.get("additionalProperty") or [])
        props = [p for p in props if p.get("name") not in {"Department", "Product type", "Bereich", "Produkttyp"}]
        props.extend([
            {"@type": "PropertyValue", "name": "Department", "value": department_label(item["department"], lang)},
            {"@type": "PropertyValue", "name": "Product type", "value": product_type_label(item["product_type"], lang)},
        ])
        data["additionalProperty"] = props
        return '<script type="application/ld+json">' + json.dumps(data, ensure_ascii=False) + '</script>'

    return pattern.sub(repl, html)


def replace_article_item(html: str, item: dict) -> str:
    start_token = "  window.ARTICLE_ITEM = "
    end_token = ";\n  window.ARTICLE_SHOP_CONFIG = "
    start = html.find(start_token)
    if start < 0:
        return html
    json_start = start + len(start_token)
    end = html.find(end_token, json_start)
    if end < 0:
        return html
    try:
        payload = json.loads(html[json_start:end])
    except json.JSONDecodeError:
        return html
    for key in PUBLIC_KEYS:
        if key in item:
            payload[key] = item[key]
    if item.get("size"):
        payload["size"] = item["size"]
    replacement = json.dumps(payload, ensure_ascii=False)
    return html[:json_start] + replacement + html[end:]


def replace_visible_facts(html: str, item: dict, lang: str) -> str:
    category_label = taxonomy_category_label(item["taxonomy_category"], lang)
    # Product pages can now show the reviewed category while the old source
    # category remains unchanged for protected modes.
    html = re.sub(
        r'(<div class="fact__value" id="factCategoryValue">).*?(</div>)',
        lambda m: m.group(1) + category_label + m.group(2),
        html,
        count=1,
        flags=re.S,
    )

    if 'data-taxonomy-fact="department"' in html:
        return html

    labels = {
        "de": {"department": "Bereich", "type": "Produkttyp", "label_size": "Labelgröße"},
        "en": {"department": "Department", "type": "Product type", "label_size": "Label size"},
        "fr": {"department": "Rayon", "type": "Type de produit", "label_size": "Taille étiquette"},
    }[lang]
    facts = [
        '<div data-taxonomy-fact="department"><div class="fact__label">' + labels["department"] + '</div>'
        '<div class="fact__value">' + department_label(item["department"], lang) + '</div></div>',
        '<div data-taxonomy-fact="product-type"><div class="fact__label">' + labels["type"] + '</div>'
        '<div class="fact__value">' + product_type_label(item["product_type"], lang) + '</div></div>',
    ]
    label_size = str(item.get("label_size") or "").strip()
    display_size = str(item.get("size") or "").strip()
    if label_size and label_size.casefold() != display_size.casefold():
        facts.append(
            '<div data-taxonomy-fact="label-size"><div class="fact__label">' + labels["label_size"] + '</div>'
            '<div class="fact__value">' + label_size.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;") + '</div></div>'
        )

    desc_marker = '    <p class="info__desc" id="itemDesc">'
    desc_pos = html.find(desc_marker)
    facts_start = html.find('<div class="info__facts">')
    if desc_pos < 0 or facts_start < 0 or facts_start > desc_pos:
        return html
    closing = html.rfind("</div>", facts_start, desc_pos)
    if closing < 0:
        return html
    insertion = "".join(facts)
    return html[:closing] + insertion + html[closing:]


def enrich_product_pages(items: list[dict]) -> tuple[int, list[str]]:
    changed = 0
    missing = []
    for item in items:
        item_id = int(item["id"])
        for lang in LANGS:
            path = article_path(lang, item_id)
            if not path.exists():
                missing.append(str(path.relative_to(BASE)))
                continue
            original = path.read_text(encoding="utf-8")
            html = replace_visible_facts(original, item, lang)
            html = replace_product_jsonld(html, item, lang)
            html = replace_article_item(html, item)
            if html != original:
                path.write_text(html, encoding="utf-8")
                changed += 1
    return changed, missing


def ensure_taxonomy(items: list[dict]) -> dict:
    # In generated-only mode source should already be enriched, but recomputing
    # if necessary makes this command safe to run locally by itself.
    if not all(item.get("taxonomy_reviewed") for item in items):
        return apply_taxonomy(items)
    return json.loads(REPORT_PATH.read_text(encoding="utf-8")) if REPORT_PATH.exists() else apply_taxonomy(items)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--generated-only", action="store_true")
    args = parser.parse_args()

    items = load_items()
    if args.generated_only:
        report = ensure_taxonomy(items)
        catalog_count = enrich_catalog(items)
        page_count, missing = enrich_product_pages(items)
        if missing:
            raise SystemExit("FEHLER: Produktseiten fehlen: " + ", ".join(missing[:10]))
        print(
            f"Katalog-Taxonomie in generierte Daten übernommen: {catalog_count} Katalogartikel, "
            f"{page_count} Produktseiten; {report.get('missingSizeCount', 0)} Größe(n) weiterhin unbekannt."
        )
        return

    report = write_source(items)
    print(
        "Katalog-Taxonomie angewendet: "
        f"{report['reviewedItems']}/{report['totalItems']} Artikel klassifiziert; "
        f"{report['missingSizeCount']} Größe(n) nicht belastbar angegeben; "
        f"{report['sizeConflictCount']} Größenkonflikt(e) dokumentiert; "
        f"{report['legacyCategoryMismatchCount']} alte Kategorieabweichung(en) separat markiert."
    )


if __name__ == "__main__":
    main()

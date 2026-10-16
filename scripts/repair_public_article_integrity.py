#!/usr/bin/env python3
"""Repair public product-page integrity after the normal site build.

The legacy ``category`` field must stay untouched in data/items.json because
Match / Chaos / Baukasten depend on it. Public product pages, however, must use
the reviewed taxonomy. This pass therefore operates only on generated article
HTML and also removes DRAFT article pages entirely.
"""
from __future__ import annotations

import html
import json
import re
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
# Gemeinsame Text- und Verlinkungslogik mit build_site.py. Frueher gab es hier
# eigene Kopien von Name, Meta-Beschreibung und "Aehnliche Teile"; weil dieses
# Skript nach dem Bauen laeuft, hat es jede Aenderung am Generator
# stillschweigend ueberschrieben (zuletzt: deutsche Titel und der Zustand in
# der Meta-Beschreibung der EN/FR-Seiten).
from i18n_text import CATEGORY_TR, apply_brand_aliases, meta_description, tr  # noqa: E402
from related_items import related_plan, related_sections_html  # noqa: E402

BASE = Path(__file__).resolve().parents[1]
ITEMS_PATH = BASE / "data" / "items.json"
LANGS = ("de", "en", "fr")
ARTICLE_ITEM_RE = re.compile(r"window\.ARTICLE_ITEM = (\{.*?\});", re.S)
FACT_CATEGORY_RE = re.compile(r'(<div class="fact__value" id="factCategoryValue">).*?(</div>)', re.S)


def article_dir(lang: str, item_id: int) -> Path:
    root = BASE if lang == "de" else BASE / lang
    return root / "artikel" / str(item_id)


def set_meta_content(text: str, marker: str, value: str) -> str:
    start = text.find(marker)
    if start < 0:
        raise SystemExit(f"FEHLER: Meta-Marker fehlt: {marker}")
    value_start = start + len(marker)
    value_end = text.find('">', value_start)
    if value_end < 0:
        raise SystemExit(f"FEHLER: Meta-Tag unvollständig: {marker}")
    return text[:value_start] + html.escape(value, quote=True) + text[value_end:]


def replace_related(text: str, sections: str) -> str:
    page_foot = text.find('<div class="page-foot">')
    if page_foot < 0:
        raise SystemExit("FEHLER: page-foot fehlt auf Produktseite")
    first_related = text.find('<div class="related">')
    if 0 <= first_related < page_foot:
        return text[:first_related] + sections + "\n" + text[page_foot:]
    return text[:page_foot] + sections + "\n" + text[page_foot:]


def repair_page(item: dict, plan: dict, lang: str) -> None:
    page = article_dir(lang, int(item.get("url_slug",item["id"]))) / "index.html"
    if not page.exists():
        raise SystemExit(f"FEHLER: öffentliche Produktseite fehlt: {page.relative_to(BASE)}")
    text = page.read_text(encoding="utf-8")
    desc = meta_description(item, lang)
    for marker in (
        '<meta name="description" content="',
        '<meta property="og:description" content="',
        '<meta name="twitter:description" content="',
    ):
        text = set_meta_content(text, marker, desc)

    taxonomy_category = item.get("taxonomy_category") or item.get("category") or ""
    expected_category = tr(CATEGORY_TR, taxonomy_category, lang)
    text, count = FACT_CATEGORY_RE.subn(r"\1" + expected_category.replace("\\", r"\\") + r"\2", text, count=1)
    if taxonomy_category and count != 1:
        raise SystemExit(f"FEHLER: Kategorie-Fakt fehlt bei {item['id']} ({lang})")

    match = ARTICLE_ITEM_RE.search(text)
    if not match:
        raise SystemExit(f"FEHLER: ARTICLE_ITEM fehlt bei {item['id']} ({lang})")
    article_data = json.loads(match.group(1))
    legacy = article_data.get("category")
    if legacy and legacy != taxonomy_category:
        article_data["legacy_category"] = legacy
    article_data["category"] = taxonomy_category
    article_data["taxonomy_category"] = taxonomy_category
    for field in ("department", "product_type", "size_normalized", "size_source", "taxonomy_confidence", "taxonomy_reviewed", "label_size"):
        if field in item:
            article_data[field] = item[field]
    replacement = "window.ARTICLE_ITEM = " + json.dumps(article_data, ensure_ascii=False) + ";"
    text = text[:match.start()] + replacement + text[match.end():]
    text = replace_related(text, related_sections_html(item, plan, lang, BASE))
    page.write_text(text, encoding="utf-8")
    if str(item.get('url_slug',item['id'])) != str(item['id']):
        # Legacy fallbacks must not retain stale related links to removed drafts.
        legacy=article_dir(lang,int(item['id']))/'index.html'
        if legacy.exists():
            prefix='/' if lang=='de' else '/'+lang+'/'
            redirected=text.replace('<head>','<head><meta name="robots" content="noindex,follow"><meta http-equiv="refresh" content="0;url='+prefix+'artikel/'+str(item['url_slug'])+'/">',1)
            legacy.write_text(redirected,encoding='utf-8')


def main() -> None:
    items = json.loads(ITEMS_PATH.read_text(encoding="utf-8"))
    # Wie build_site.py: Linien/Kollaborationen laufen unter der Hauptmarke
    # (nur im Speicher, data/items.json bleibt unveraendert).
    apply_brand_aliases(items)
    public_items = [item for item in items if item.get("public_status") != "DRAFT"]
    plan = related_plan(items)
    drafts = [item for item in items if item.get("public_status") == "DRAFT"]

    removed = 0
    for item in drafts:
        for lang in LANGS:
            path = article_dir(lang, int(item.get("url_slug",item["id"])))
            if path.exists():
                shutil.rmtree(path)
                removed += 1

    repaired = 0
    for item in public_items:
        for lang in LANGS:
            repair_page(item, plan, lang)
            repaired += 1

    print(
        f"Produktseiten-Integrität: OK – {repaired} öffentliche Sprachseiten repariert; "
        f"{removed} DRAFT-Seiten entfernt."
    )


if __name__ == "__main__":
    main()

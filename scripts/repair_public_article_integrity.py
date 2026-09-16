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
from pathlib import Path

BASE = Path(__file__).resolve().parents[1]
ITEMS_PATH = BASE / "data" / "items.json"
LANGS = ("de", "en", "fr")

CATEGORY_TR = {
    "Jackets": {"de": "Jacken", "en": "Jackets", "fr": "Vestes"},
    "Coats": {"de": "Mäntel", "en": "Coats", "fr": "Manteaux"},
    "Tops": {"de": "Tops", "en": "Tops", "fr": "Hauts"},
    "Shirts": {"de": "Hemden/Shirts", "en": "Shirts", "fr": "Chemises/T-shirts"},
    "Knitwear": {"de": "Strickwaren", "en": "Knitwear", "fr": "Maille"},
    "Pants": {"de": "Hosen", "en": "Pants", "fr": "Pantalons"},
    "Skirts": {"de": "Röcke", "en": "Skirts", "fr": "Jupes"},
    "Dresses": {"de": "Kleider", "en": "Dresses", "fr": "Robes"},
    "Shoes": {"de": "Schuhe", "en": "Shoes", "fr": "Chaussures"},
    "Accessories": {"de": "Accessoires", "en": "Accessories", "fr": "Accessoires"},
    "Objects": {"de": "Objekte", "en": "Objects", "fr": "Objets"},
}
CONDITION_TR = {
    "Repariert": {"de": "Repariert", "en": "Repaired", "fr": "Réparé"},
    "Mit Defekt": {"de": "Mit Defekt", "en": "With defect", "fr": "Avec défaut"},
    "Gut": {"de": "Gut", "en": "Good", "fr": "Bon"},
    "Sehr gut": {"de": "Sehr gut", "en": "Very good", "fr": "Très bon"},
    "Zufriedenstellend": {"de": "Zufriedenstellend", "en": "Satisfactory", "fr": "Satisfaisant"},
}
SIZE_TR = {
    "Einheitsgröße": {"de": "Einheitsgröße", "en": "One size", "fr": "Taille unique"},
    "verstellbar": {"de": "verstellbar", "en": "adjustable", "fr": "réglable"},
    "Größenverstellbar": {"de": "verstellbar", "en": "adjustable", "fr": "réglable"},
    "Kindergröße L": {"de": "Kindergröße L", "en": "Kids' size L", "fr": "Taille enfant L"},
    "Sonstige": {"de": "Sonstige", "en": "Other", "fr": "Autre"},
}
META = {
    "de": {
        "sold": "{name} – bereits verkauft, Teil des kuratierten Disorder119-Archivs für Designer- und Vintage-Mode.",
        "size": "Größe", "condition": "Zustand",
        "suffix": ". Aus dem kuratierten Second-Hand-Archiv von Disorder119.",
        "brand": "MEHR VON {brand}", "category": "ÄHNLICHE ARCHIVSTÜCKE", "request": "Preis auf Anfrage",
    },
    "en": {
        "sold": "{name} – already sold, part of the curated Disorder119 archive for designer and vintage fashion.",
        "size": "Size", "condition": "Condition",
        "suffix": ". From the curated second-hand archive of Disorder119.",
        "brand": "MORE FROM {brand}", "category": "SIMILAR ARCHIVE PIECES", "request": "Price on request",
    },
    "fr": {
        "sold": "{name} – déjà vendu, fait partie de l'archive sélectionnée Disorder119 pour la mode de créateurs et vintage.",
        "size": "Taille", "condition": "État",
        "suffix": ". Issu de l'archive seconde main sélectionnée de Disorder119.",
        "brand": "PLUS DE {brand}", "category": "PIÈCES D’ARCHIVE SIMILAIRES", "request": "Prix sur demande",
    },
}
ARTICLE_ITEM_RE = re.compile(r"window\.ARTICLE_ITEM = (\{.*?\});", re.S)
FACT_CATEGORY_RE = re.compile(r'(<div class="fact__value" id="factCategoryValue">).*?(</div>)', re.S)
RELATED_HREF_RE = re.compile(r'href="(?:/(?:en|fr))?/artikel/(\d+)/"')


def tr(table: dict, value: str, lang: str) -> str:
    row = table.get(value)
    return (row or {}).get(lang) or (row or {}).get("de") or value or ""


def display_name(item: dict) -> str:
    brand = item.get("brand") or ""
    title = item.get("title") or ""
    return title if brand and title.lower().startswith(brand.lower()) else (brand + " " + title).strip()


def meta_description(item: dict, lang: str) -> str:
    ph = META[lang]
    name = display_name(item)
    if item.get("public_status") == "SOLD":
        return ph["sold"].format(name=name)
    parts: list[str] = []
    category = item.get("taxonomy_category") or item.get("category") or ""
    if category:
        parts.append(tr(CATEGORY_TR, category, lang))
    if item.get("size"):
        parts.append(ph["size"] + " " + tr(SIZE_TR, str(item["size"]), lang))
    if item.get("condition"):
        parts.append(ph["condition"] + " " + tr(CONDITION_TR, str(item["condition"]), lang))
    return name + ((" – " + ", ".join(parts)) if parts else "") + ph["suffix"]


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


def fmt_price(value: float) -> str:
    s = f"{value:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    return s + " €"


def related_card(item: dict, lang: str) -> str:
    sold = item.get("public_status") == "SOLD"
    if sold:
        price = '<span class="related-card__sold">SOLD</span>'
        price_line = ""
    else:
        price = ""
        price_line = (
            '<span class="related-card__price">' + fmt_price(float(item["price"])) + "</span>"
            if float(item.get("price") or 0) > 0
            else '<span class="related-card__price" data-price-on-request>' + html.escape(META[lang]["request"]) + "</span>"
        )
    prefix = "/" if lang == "de" else f"/{lang}/"
    gallery = item.get("gallery") or []
    hero = gallery[0]
    return (
        f'<a class="related-card" href="{prefix}artikel/{item["id"]}/">'
        '<div class="related-card__frame">'
        f'<img src="/{html.escape(hero, quote=True)}" alt="{html.escape(display_name(item), quote=True)}" loading="lazy" decoding="async" />'
        + price + "</div>"
        f'<span class="related-card__brand">{html.escape(item.get("brand") or "")}</span>'
        f'<span class="related-card__title">{html.escape(item.get("title") or "")}</span>'
        + price_line + "</a>"
    )


def related_sections(item: dict, public_items: list[dict], lang: str, n: int = 4) -> str:
    candidates = [x for x in public_items if x["id"] != item["id"] and (x.get("gallery") or [None])[0]]
    same_brand = [x for x in candidates if x.get("brand") and x.get("brand") == item.get("brand")]
    same_brand.sort(key=lambda x: x.get("public_status") == "SOLD")
    brand_items = same_brand[:n]
    excluded = {x["id"] for x in brand_items}
    wanted_category = item.get("taxonomy_category") or item.get("category")
    same_category = [
        x for x in candidates
        if x["id"] not in excluded
        and (x.get("taxonomy_category") or x.get("category")) == wanted_category
    ]
    same_category.sort(key=lambda x: x.get("public_status") == "SOLD")
    category_items = same_category[:n]
    parts: list[str] = []
    if brand_items:
        heading = META[lang]["brand"].format(brand=(item.get("brand") or "").upper())
        parts.append(
            '<div class="related"><h2 class="related__title" data-related-heading="brand">'
            + html.escape(heading) + '</h2><div class="related__grid">'
            + "".join(related_card(x, lang) for x in brand_items) + "</div></div>"
        )
    if category_items:
        parts.append(
            '<div class="related"><h2 class="related__title" data-related-heading="category">'
            + html.escape(META[lang]["category"]) + '</h2><div class="related__grid">'
            + "".join(related_card(x, lang) for x in category_items) + "</div></div>"
        )
    return "".join(parts)


def replace_related(text: str, sections: str) -> str:
    page_foot = text.find('<div class="page-foot">')
    if page_foot < 0:
        raise SystemExit("FEHLER: page-foot fehlt auf Produktseite")
    first_related = text.find('<div class="related">')
    if 0 <= first_related < page_foot:
        return text[:first_related] + sections + "\n" + text[page_foot:]
    return text[:page_foot] + sections + "\n" + text[page_foot:]


def repair_page(item: dict, public_items: list[dict], lang: str) -> None:
    page = article_dir(lang, int(item["id"])) / "index.html"
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
    text = replace_related(text, related_sections(item, public_items, lang))
    page.write_text(text, encoding="utf-8")


def main() -> None:
    items = json.loads(ITEMS_PATH.read_text(encoding="utf-8"))
    public_items = [item for item in items if item.get("public_status") != "DRAFT"]
    drafts = [item for item in items if item.get("public_status") == "DRAFT"]

    removed = 0
    for item in drafts:
        for lang in LANGS:
            path = article_dir(lang, int(item["id"]))
            if path.exists():
                shutil.rmtree(path)
                removed += 1

    repaired = 0
    for item in public_items:
        for lang in LANGS:
            repair_page(item, public_items, lang)
            repaired += 1

    print(
        f"Produktseiten-Integrität: OK – {repaired} öffentliche Sprachseiten repariert; "
        f"{removed} DRAFT-Seiten entfernt."
    )


if __name__ == "__main__":
    main()

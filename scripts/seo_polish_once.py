#!/usr/bin/env python3
from pathlib import Path

BASE = Path(__file__).resolve().parents[1]


def replace_once(text, old, new, label):
    if new in text:
        return text
    if old not in text:
        raise SystemExit(f"{label}: Ausgangstext nicht gefunden")
    return text.replace(old, new, 1)


def replace_between(text, start, end, new_block, label):
    i = text.find(start)
    if i < 0:
        raise SystemExit(f"{label}: Startmarker nicht gefunden")
    j = text.find(end, i)
    if j < 0:
        raise SystemExit(f"{label}: Endmarker nicht gefunden")
    return text[:i] + new_block + text[j:]


p = BASE / "build_site.py"
s = p.read_text(encoding="utf-8")

# Related-product images become useful for image search/accessibility instead of alt="".
s = replace_once(
    s,
    "'<img src=\"/' + esc(x[\"gallery\"][0]) + '\" alt=\"\" loading=\"lazy\" />' +",
    "'<img src=\"/' + esc(x[\"gallery\"][0]) + '\" alt=\"' + esc(display_name(x)) + '\" loading=\"lazy\" decoding=\"async\" />' +",
    "Related image alt",
)

related_block = '''def related_sections_html(it, lang):
    brand_items = related_same_brand(it)
    exclude = {it["id"]} | {b["id"] for b in brand_items}
    cat_items = related_same_category(it, exclude)
    labels = {
        "de": {"brand": "MEHR VON {brand}", "category": "ÄHNLICHE ARCHIVSTÜCKE"},
        "en": {"brand": "MORE FROM {brand}", "category": "SIMILAR ARCHIVE PIECES"},
        "fr": {"brand": "PLUS DE {brand}", "category": "PIÈCES D’ARCHIVE SIMILAIRES"},
    }[lang]
    parts = []
    if brand_items:
        parts.append(
            '<div class="related"><h2 class="related__title" data-related-heading="brand">'
            + esc(labels["brand"].format(brand=(it.get("brand") or "").upper())) + "</h2>"
            '<div class="related__grid">' + "".join(related_card_html(x, lang) for x in brand_items) + "</div></div>"
        )
    if cat_items:
        parts.append(
            '<div class="related"><h2 class="related__title" data-related-heading="category">'
            + esc(labels["category"]) + "</h2>"
            '<div class="related__grid">' + "".join(related_card_html(x, lang) for x in cat_items) + "</div></div>"
        )
    return "".join(parts)


'''
s = replace_between(s, "def related_sections_html(it, lang):\n", "def facts_html(it", related_block, "Related headings")

facts_block = '''def facts_html(it, lang):
    labels = {
        "de": {"category": "Kategorie", "size": "Größe", "color": "Farbe", "condition": "Zustand", "article": "Artikelnummer"},
        "en": {"category": "Category", "size": "Size", "color": "Color", "condition": "Condition", "article": "Article number"},
        "fr": {"category": "Catégorie", "size": "Taille", "color": "Couleur", "condition": "État", "article": "Numéro d’article"},
    }[lang]
    facts = []
    if it.get("category"):
        facts.append(('factCategory', labels["category"], "factCategoryValue", cat_tr(it["category"], lang)))
    if it.get("size"):
        facts.append(('factSize', labels["size"], "factSizeValue", size_tr(it["size"], lang)))
    if it.get("color"):
        facts.append(('factColor', labels["color"], None, it["color"]))
    if it.get("condition"):
        facts.append(('factCondition', labels["condition"], "factConditionValue", cond_tr(it["condition"], lang)))
    out = []
    for i18n_key, label, value_id, value in facts:
        value_attr = f' id="{value_id}"' if value_id else ""
        out.append(
            '<div><div class="fact__label" data-i18n="' + i18n_key + '">' + esc(label) + "</div>"
            '<div class="fact__value"' + value_attr + ">" + esc(value) + "</div></div>"
        )
    art_no = it.get("article") or str(it["id"])
    out.append(
        '<div><div class="fact__label" data-i18n="factArticleNo">' + esc(labels["article"]) + "</div>"
        '<div class="fact__value">' + esc(art_no) + "</div></div>"
    )
    return "".join(out)


'''
s = replace_between(s, "def facts_html(it", "def price_block_html(it):\n", facts_block, "SSR facts translation")
s = replace_once(s, '<div class="info__facts">{facts_html(it)}</div>', '<div class="info__facts">{facts_html(it, lang)}</div>', "Facts call")

# Product OpenGraph gets alternate locales, just like the homepage.
old = '''    hreflang_links = "\\n".join(
        '<link rel="alternate" hreflang="' + l + '" href="'
        + SITE_URL.rstrip("/") + lang_home(l) + "artikel/" + str(it["id"]) + '/">'
        for l in LANGS
    ) + '\\n<link rel="alternate" hreflang="x-default" href="' + SITE_URL.rstrip("/") + lang_home("de") + "artikel/" + str(it["id"]) + '/">'
    sold = it.get("public_status") == "SOLD"
'''
new = '''    hreflang_links = "\\n".join(
        '<link rel="alternate" hreflang="' + l + '" href="'
        + SITE_URL.rstrip("/") + lang_home(l) + "artikel/" + str(it["id"]) + '/">'
        for l in LANGS
    ) + '\\n<link rel="alternate" hreflang="x-default" href="' + SITE_URL.rstrip("/") + lang_home("de") + "artikel/" + str(it["id"]) + '/">'
    og_locale_alternates = "\\n".join(
        '<meta property="og:locale:alternate" content="' + OG_LOCALES[l] + '">'
        for l in LANGS if l != lang
    )
    sold = it.get("public_status") == "SOLD"
'''
s = replace_once(s, old, new, "Product OG locale alternates variable")
s = replace_once(
    s,
    '<meta property="og:locale" content="{OG_LOCALES[lang]}">\n<meta property="og:title" content="{esc(title_tag)}">',
    '<meta property="og:locale" content="{OG_LOCALES[lang]}">\n{og_locale_alternates}\n<meta property="og:title" content="{esc(title_tag)}">',
    "Product OG locale alternates output",
)

p.write_text(s, encoding="utf-8")


# Add crawler-hygiene checks to the permanent validator.
p = BASE / "scripts" / "validate_shop.py"
v = p.read_text(encoding="utf-8")
marker = '''    home_html = (BASE / "index.html").read_text(encoding="utf-8", errors="replace")
'''
insert = '''    robots_text = (BASE / "robots.txt").read_text(encoding="utf-8", errors="replace")
    if "Sitemap: https://disorder119.com/sitemap.xml" not in robots_text:
        severe.append("robots.txt: Sitemap-Verweis fehlt")
    for blocked in ["/admin/", "/config/", "/scripts/", "/shop-worker/", "/data/items.json", "/data/shop-quality.json"]:
        if f"Disallow: {blocked}" not in robots_text:
            severe.append(f"robots.txt: interner Pfad nicht ausgeschlossen: {blocked}")

    home_html = (BASE / "index.html").read_text(encoding="utf-8", errors="replace")
'''
v = replace_once(v, marker, insert, "Robots validation")
p.write_text(v, encoding="utf-8")

print("SEO-Polish erfolgreich angewendet.")

#!/usr/bin/env python3
"""Read-only validation of the generated catalogue and localized product pages."""
from collections import Counter
import html
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import xml.etree.ElementTree as ET

from seo_text import is_internal_product

BASE = Path(__file__).resolve().parents[1]
SITE = "https://disorder119.com/"
LANGUAGES = ("de", "en", "fr")
PAGE_SIZE = 24


class Anchors(HTMLParser):
    def __init__(self, source):
        super().__init__()
        self.anchors = []
        self.feed(source)

    def handle_starttag(self, tag, attrs):
        if tag == "a":
            self.anchors.append(dict(attrs))


def require(condition, message):
    if not condition:
        raise SystemExit("SEO: " + message)


def prefix(lang):
    return "" if lang == "de" else lang + "/"


def main():
    source = json.loads((BASE / "data/items.json").read_text(encoding="utf-8"))
    catalog = json.loads((BASE / "data/catalog.json").read_text(encoding="utf-8"))
    require(not any(is_internal_product(row) for row in catalog), "internal fixture in public catalogue")
    require(any(is_internal_product(row) for row in source), "internal fixture source must remain available privately")
    expected = {int(row["id"]) for row in source if row.get("public_status") != "DRAFT" and not is_internal_product(row)}
    require({int(row["id"]) for row in catalog} == expected, "public catalogue inventory differs from source visibility")
    slugs = {str(row.get("url_slug", row["id"])) for row in catalog}
    sitemap = ET.parse(BASE / "sitemap.xml")
    locations = [node.text for node in sitemap.findall("{http://www.sitemaps.org/schemas/sitemap/0.9}url/{http://www.sitemaps.org/schemas/sitemap/0.9}loc")]
    require(len(locations) == len(set(locations)), "duplicate sitemap URL")
    require(not any(re.search(r"/artikel/9999/?$", url) for url in locations), "internal fixture in sitemap")

    categories = Counter(row.get("taxonomy_category") or row.get("category") for row in catalog)
    segments = []
    for category, count in [(None, len(catalog))] + sorted(categories.items()):
        segment = "katalog/" + (("kategorie/" + category.lower() + "/") if category else "")
        pages = (count + PAGE_SIZE - 1) // PAGE_SIZE
        segments.extend((segment + (f"seite/{page}/" if page > 1 else ""), min(PAGE_SIZE, count - (page - 1) * PAGE_SIZE))
                        for page in range(1, pages + 1))
    expected_urls = {"/" + prefix(lang) + segment for lang in LANGUAGES for segment, _ in segments}
    checked = 0
    product_titles = {lang: [] for lang in LANGUAGES}
    for lang in LANGUAGES:
        root = BASE / prefix(lang)
        files = {"/" + str(path.relative_to(BASE).parent) + "/" for path in (root / "katalog").rglob("index.html")}
        expected_local = {"/" + prefix(lang) + segment for segment, _ in segments}
        require(files == expected_local, f"{lang}: missing or stale catalogue pages")
        home = (root / "index.html").read_text(encoding="utf-8")
        require(f'href="/{prefix(lang)}katalog/"' in home, f"{lang}: homepage has no crawlable catalogue link")
        for segment, count in segments:
            page = (root / segment / "index.html").read_text(encoding="utf-8")
            canonical = SITE + prefix(lang) + segment
            require(f'<link rel="canonical" href="{canonical}">' in page, f"wrong canonical: {canonical}")
            require(canonical in locations, f"catalogue page missing from sitemap: {canonical}")
            require("/assets/app.js" not in page, f"interactive archive may overwrite catalogue: {canonical}")
            for alternate in LANGUAGES:
                require(f'hreflang="{alternate}" href="{SITE}{prefix(alternate)}{segment}"' in page, f"missing hreflang: {canonical}")
            anchors = Anchors(page).anchors
            cards = [anchor for anchor in anchors if anchor.get("class") == "plate"]
            require(len(cards) == count, f"wrong product-card count: {canonical}")
            for anchor in anchors:
                href = anchor.get("href", "")
                if re.match(r"/(?:en/|fr/)?katalog/", href):
                    require(href in expected_urls, f"dead catalogue navigation: {href}")
                match = re.fullmatch(r"/(?:en/|fr/)?artikel/([0-9]+)/", href)
                if match:
                    require(match[1] in slugs, f"private or unknown product link: {href}")
            checked += 1
        require(not (root / "artikel/9999/index.html").exists(), f"{lang}: internal fixture HTML remains public")
        for row in catalog:
            slug = str(row.get("url_slug", row["id"]))
            page = (root / "artikel" / slug / "index.html").read_text(encoding="utf-8")
            title = html.unescape(re.search(r"<title>(.*?)</title>", page)[1])
            product_titles[lang].append(title)
            if lang == "fr":
                name = row.get("title_fr")
                h1 = html.unescape(re.search(r"<h1>(.*?)</h1>", page, re.S)[1])
                require(name and h1 == name, f"French H1 differs from catalogue: {slug}")
                require(name in title, f"French title differs from H1: {slug}")
                for text in re.findall(r'<script type="application/ld\+json">(.*?)</script>', page):
                    schema = json.loads(text)
                    if schema.get("@type") == "Product":
                        require(schema.get("name") == name, f"French Product name differs from H1: {slug}")
    for lang, titles in product_titles.items():
        require(len(titles) == len(set(titles)), f"{lang}: duplicate product titles remain")
    print(f"SEO catalogue: {checked} crawlable pages, {len(catalog)} public products, 3 consistent languages; no public test fixture or duplicate product titles.")


if __name__ == "__main__":
    main()

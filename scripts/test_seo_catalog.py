"""Regression coverage for crawlable inventory, fixture visibility and metadata."""
import html
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import sys
import tempfile
import unittest
from unittest.mock import patch

BASE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BASE))
sys.path.insert(0, str(BASE / "scripts"))
from seo_text import distinct_metadata_name, is_internal_product, seo_title

# Importing the build module must not rewrite shared JS/legal assets during tests.
with patch("sync_legal_content.sync_legal_content"):
    import build_site


class Links(HTMLParser):
    def __init__(self, source):
        super().__init__()
        self.links = []
        self.feed(source)

    def handle_starttag(self, tag, attrs):
        if tag == "a":
            self.links.append(dict(attrs))


class CatalogSeoTests(unittest.TestCase):
    def test_generated_taxonomy_does_not_require_internal_fixture_pages(self):
        import apply_catalog_taxonomy
        fixture = {"id": 9999, "url_slug": "9999", "public_status": "SOLD"}
        with tempfile.TemporaryDirectory() as tmp, patch.object(apply_catalog_taxonomy, "BASE", Path(tmp)):
            changed, missing = apply_catalog_taxonomy.enrich_product_pages([fixture])
            self.assertEqual((changed, missing), (0, []))
            _, missing = apply_catalog_taxonomy.enrich_product_pages([{"id": 42, "url_slug": "42"}])
            self.assertEqual(len(missing), 3, "real product pages must still be required")

    def test_hero_dimensions_come_from_the_source_photo(self):
        from PIL import Image
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            Image.new("RGB", (800, 450)).save(root / "landscape.webp", "WEBP")
            with patch.object(build_site, "BASE", root):
                self.assertEqual(build_site.image_intrinsic_attributes("landscape.webp"), ' width="800" height="450"')
                self.assertEqual(build_site.image_intrinsic_attributes("missing.webp"), "")

    def test_internal_fixture_stays_in_source_but_not_public_generator_inventory(self):
        source = json.loads((BASE / "data/items.json").read_text(encoding="utf-8"))
        self.assertTrue(any(str(item["id"]) == "9999" for item in source))
        self.assertFalse(any(is_internal_product(item) for item in build_site.ITEMS))
        self.assertTrue(is_internal_product({"id": 42, "internal_only": True}))

    def test_catalogue_pages_cover_each_public_piece_once_and_categories_match(self):
        specs = build_site.catalog_page_specs()
        general = [spec for spec in specs if spec["category"] is None]
        ids = [item["id"] for spec in general for item in spec["items"]]
        expected = [item["id"] for item in build_site.ITEMS if item.get("public_status") in {"AVAILABLE", "SOLD"}]
        self.assertCountEqual(ids, expected)
        self.assertEqual(len(ids), len(set(ids)))
        self.assertGreater(len(general), 1)
        self.assertEqual(len(specs), len({spec["segment"] for spec in specs}))
        for spec in specs:
            self.assertLessEqual(len(spec["items"]), 24)
            self.assertNotIn("seite/1/", spec["segment"])
            if spec["category"]:
                for item in spec["items"]:
                    self.assertEqual(item.get("taxonomy_category") or item.get("category"), spec["category"])

    def test_page_two_has_real_navigation_self_canonical_and_24_html_product_links(self):
        spec = next(spec for spec in build_site.catalog_page_specs() if spec["category"] is None and spec["page"] == 2)
        with tempfile.TemporaryDirectory() as tmp, patch.object(build_site, "BASE", Path(tmp)):
            page = build_site.catalog_page_html(spec, "fr", build_site.get_shop_config())
        links = Links(page).links
        products = [link for link in links if link.get("class") == "plate"]
        self.assertEqual(len(products), 24)
        self.assertTrue(all(re.fullmatch(r"/fr/artikel/[0-9]+/", link["href"]) for link in products))
        self.assertIn('<link rel="canonical" href="https://disorder119.com/fr/katalog/seite/2/">', page)
        self.assertIn('hreflang="en" href="https://disorder119.com/en/katalog/seite/2/"', page)
        self.assertTrue(any(link.get("href") == "/fr/katalog/" and link.get("rel") == "prev" for link in links))
        self.assertTrue(any(link.get("href") == "/fr/katalog/seite/3/" and link.get("rel") == "next" for link in links))
        self.assertTrue(any(link.get("href") == "/fr/katalog/kategorie/shoes/" for link in links))
        self.assertNotIn("/assets/app.js", page)
        self.assertNotIn("data-brand-filter", page)
        self.assertEqual(page.count('loading="lazy"'), 22)
        self.assertEqual(page.count('fetchpriority="high"'), 2)
        for value in re.findall(r'<script type="application/ld\+json">(.*?)</script>', page):
            json.loads(value)

    def test_stale_catalogue_page_is_removed_when_inventory_shrinks(self):
        rows = [next(item for item in build_site.ITEMS if item.get("public_status") == "AVAILABLE")]
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            stale = root / "katalog/seite/99/index.html"
            stale.parent.mkdir(parents=True)
            stale.write_text("old", encoding="utf-8")
            config = build_site.get_shop_config()
            with patch.object(build_site, "BASE", root), patch.object(build_site, "ITEMS", rows), patch.object(build_site, "get_shop_config", return_value=config):
                build_site.build_catalog_pages()
            self.assertFalse(stale.exists())
            self.assertTrue((root / "katalog/index.html").is_file())
            self.assertTrue((root / "en/katalog/index.html").is_file())

    def test_internal_fixture_legacy_html_is_removed_in_every_locale(self):
        fixture = next(item for item in build_site.SOURCE_ITEMS if is_internal_product(item))
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            paths = [root / language / "artikel/9999/index.html" for language in ("", "en", "fr")]
            for path in paths:
                path.parent.mkdir(parents=True)
                path.write_text("private test", encoding="utf-8")
            with patch.object(build_site, "BASE", root), patch.object(build_site, "ITEMS", []), patch.object(build_site, "SOURCE_ITEMS", [fixture]), patch.object(build_site, "get_shop_config", return_value={"whatsappNumber": "", "email": ""}):
                build_site.build_articles()
            self.assertFalse(any(path.exists() for path in paths))

    def test_french_product_name_agrees_in_h1_metadata_and_product_schema(self):
        item = next(item for item in build_site.ITEMS if str(item.get("url_slug")) == "238")
        name = build_site.item_title(item, "fr")
        with tempfile.TemporaryDirectory() as tmp, patch.object(build_site, "BASE", Path(tmp)):
            page = build_site.build_page(item, build_site.get_shop_config(), "fr")
        self.assertIn("jean marbré femme bleu", name)
        self.assertIn("<h1>" + html.escape(name, quote=True) + "</h1>", page)
        self.assertIn(name, html.unescape(re.search(r"<title>(.*?)</title>", page)[1]))
        product = next(json.loads(value) for value in re.findall(r'<script type="application/ld\+json">(.*?)</script>', page)
                       if json.loads(value).get("@type") == "Product")
        self.assertEqual(product["name"], name)
        self.assertEqual(product["color"], "bleu")
        self.assertNotIn("Marmorierte", page)

    def test_duplicate_archive_metadata_prefers_real_sizes_and_keeps_visible_names(self):
        rows = [item for item in build_site.ITEMS if str(item.get("url_slug")) in {"150", "149", "138"}]
        names = [build_site.product_metadata_name(item, "de") for item in rows]
        self.assertEqual(len(set(names)), 3)
        self.assertTrue(all("Art." not in name for name in names))
        self.assertTrue(all("Gr." in name for name in names))
        for item in rows:
            self.assertEqual(build_site.item_title(item, "de"), "A.F. Vandevorst Kleid Damen")
        boots = [item for item in build_site.ITEMS if str(item.get("url_slug")) in {"135", "97"}]
        self.assertEqual(len({build_site.product_metadata_name(item, "de") for item in boots}), 2)
        self.assertTrue(all("Art." in build_site.product_metadata_name(item, "de") for item in boots))

    def test_unique_names_are_unchanged_and_size_is_not_repeated(self):
        row = {"id": 1, "article": "1", "size": "S"}
        self.assertEqual(distinct_metadata_name("Prada Jacke", row, [row], "de"), "Prada Jacke")
        title = seo_title("Prada Jacke · Gr. S", "Jacket", "S", "de")
        self.assertEqual(title.count("Gr. S"), 1)


if __name__ == "__main__":
    unittest.main()

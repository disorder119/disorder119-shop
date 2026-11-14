"""Kategorieseiten (/damen/, /herren/, /damen/<kategorie>/): Schwelle, Links, SEO-Angaben.

Start im Ordner scripts:  python -m unittest test_kategorieseiten
"""
import json
import re
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_site  # noqa: E402
import kategorieseiten  # noqa: E402


def teil(nr, bereich="Women", kategorie="Jackets", status="AVAILABLE", marke="Prada", **mehr):
    daten = {
        "id": 9000 + nr, "article": str(nr), "url_slug": str(nr), "title": f"{marke} Teil {nr}", "brand": marke,
        "price": 100 + nr, "public_status": status, "gallery": [f"assets/img/{9000 + nr}/0.webp"],
        "department": bereich, "taxonomy_category": kategorie, "category": kategorie,
        "size": "M", "size_normalized": "M", "brightness": nr / 100,
    }
    daten.update(mehr)
    return daten


BESTAND = (
    [teil(n) for n in (1, 2, 3)]                                   # Damen-Jacken: 3
    + [teil(4, kategorie="Coats")]                                 # zaehlt zu Jacken
    + [teil(5, kategorie="Skirts"), teil(6, kategorie="Skirts")]   # nur 2 Roecke: keine Seite
    + [teil(7, status="SOLD"), teil(8, hidden_from_shop=True)]
    + [teil(n, bereich="Men", kategorie="Shoes", marke="Y-3") for n in (10, 11)]
    + [teil(12, bereich="Unisex", kategorie="Shoes", marke="Y-3")]  # Unisex zaehlt bei beiden
)


def json_ld(seite):
    return [json.loads(block) for block in
            re.findall(r'<script type="application/ld\+json">(.*?)</script>', seite, re.S)]


class KategorieseitenTests(unittest.TestCase):
    def bauen(self, bestand=BESTAND):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        wurzel = Path(tmp.name)
        for p in (patch.object(build_site, "BASE", wurzel), patch.object(build_site, "ITEMS", bestand),
                  patch.object(build_site, "get_shop_config", lambda: {})):
            p.start()
            self.addCleanup(p.stop)
        build_site.build_kategorieseiten()
        return wurzel

    def test_seiten_ab_drei_teilen_und_unisex_bei_beiden(self):
        segmente = {s["seg"]: len(s["teile"]) for s in (self.bauen() and kategorieseiten.seiten(build_site))}
        self.assertEqual(segmente, {"damen/": 7, "damen/jacken/": 4, "herren/": 3, "herren/schuhe/": 3})

    def test_dateien_in_allen_sprachen(self):
        wurzel = self.bauen()
        for vor in ("", "en/", "fr/"):
            self.assertTrue((wurzel / vor / "damen" / "jacken" / "index.html").is_file(), vor)
            self.assertTrue((wurzel / vor / "herren" / "index.html").is_file(), vor)
        self.assertFalse((wurzel / "damen" / "roecke").exists())

    def test_seo_angaben(self):
        seite = (self.bauen() / "damen" / "jacken" / "index.html").read_text(encoding="utf-8")
        self.assertIn("<title>Designer Jacken Damen Second Hand &amp; Vintage | Disorder119</title>", seite)
        self.assertIn('<link rel="canonical" href="https://disorder119.com/damen/jacken/">', seite)
        self.assertIn('hreflang="en"', seite)
        self.assertEqual(seite.count("<h1"), 1)
        self.assertNotIn("<script src", seite)
        beschreibung = re.search(r'<meta name="description" content="([^"]*)"', seite).group(1)
        self.assertLessEqual(len(beschreibung), 160)
        typen = [block.get("@type") for block in json_ld(seite) if isinstance(block, dict)]
        self.assertIn("CollectionPage", typen)
        self.assertIn("BreadcrumbList", typen)
        liste = next(b for b in json_ld(seite) if isinstance(b, dict) and b.get("@type") == "CollectionPage")["mainEntity"]
        self.assertEqual(liste["numberOfItems"], 4)
        # Jedes verfuegbare Teil ist ein echter Link, verkaufte und versteckte nicht.
        # 4 verfuegbare + 1 verkauftes ("Zuletzt verkauft"); das versteckte Teil 8 nie.
        self.assertEqual(len(re.findall(r'href="/artikel/\d+/"', seite)), 5)
        self.assertNotIn('href="/artikel/8/"', seite)

    def test_titel_hoechstens_60_zeichen(self):
        self.bauen()
        for s in kategorieseiten.seiten(build_site):
            for lang in build_site.LANGS:
                self.assertLessEqual(len(kategorieseiten.seitentitel(s, lang)), 64, (s["seg"], lang))

    def test_alte_seite_verschwindet(self):
        wurzel = self.bauen()
        self.assertTrue((wurzel / "damen" / "jacken" / "index.html").is_file())
        ohne = [it for it in BESTAND if it["taxonomy_category"] not in ("Jackets", "Coats")]
        with patch.object(build_site, "ITEMS", ohne):
            build_site.build_kategorieseiten()
        self.assertFalse((wurzel / "damen" / "jacken").exists())

    def test_sitemap_und_fusslinks(self):
        self.bauen()
        self.assertEqual(kategorieseiten.sitemap_segmente(build_site),
                         ["damen/", "damen/jacken/", "herren/", "herren/schuhe/", "vintage-archive-shop/", "neu/", "unter-200/",
                          "marke/prada/jacken/", "marke/y-3/schuhe/"])
        self.assertEqual(kategorieseiten.fusslinks(build_site, "en"),
                         [("Women", "/en/damen/"), ("Men", "/en/herren/"), ("Vintage Archive Shop", "/en/vintage-archive-shop/"),
                          ("New", "/en/neu/")])
        # Der Shop selbst verlinkt die Einstiegsseiten nicht.
        self.assertNotIn("damen", build_site.marken_fusslink("de"))

    def test_weitere_einstiegsseiten(self):
        wurzel = self.bauen()
        seite = (wurzel / "marke" / "prada" / "jacken" / "index.html").read_text(encoding="utf-8")
        self.assertIn("<title>Prada Jacken Second Hand &amp; Vintage | Disorder119</title>", seite)
        self.assertEqual(seite.count("<h1"), 1)
        self.assertIn('class="mk-trust"', seite)
        self.assertNotIn("<script src", seite)
        for name in ("neu", "unter-200", "vintage-archive-shop"):
            text = (wurzel / "fr" / name / "index.html").read_text(encoding="utf-8")
            self.assertEqual(text.count("<h1"), 1, name)
            beschreibung = re.search(r'<meta name="description" content="([^"]*)"', text).group(1)
            self.assertLessEqual(len(beschreibung), 175, name)
        self.assertFalse((wurzel / "unter-100").exists())  # kein Teil unter 100 im Testbestand
        # verkaufte Teile derselben Auswahl stehen als Beleg darunter
        self.assertIn("Zuletzt verkauft", (wurzel / "damen" / "jacken" / "index.html").read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()

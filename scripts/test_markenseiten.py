"""Markenseiten (/marke/<slug>/, /marken/): Schwelle, Links, SEO-Angaben.

Start im Ordner scripts:  python -m unittest test_markenseiten
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
import markenseiten  # noqa: E402


def teil(nr, marke, status="AVAILABLE", **mehr):
    daten = {
        "id": 9000 + nr, "article": str(nr), "url_slug": str(nr), "title": f"{marke} Jacke {nr}", "brand": marke,
        "price": 100 + nr, "public_status": status, "gallery": [f"assets/img/{9000 + nr}/0.webp"],
        "department": "Women", "taxonomy_category": "Jackets", "category": "Jackets", "product_type": "Jacket",
        "size": "M", "size_normalized": "M", "brightness": nr / 100,
    }
    daten.update(mehr)
    return daten


BESTAND = (
    [teil(n, "Jean Paul Gaultier") for n in (1, 2, 3, 4)]
    + [teil(5, "Jean Paul Gaultier", "SOLD"), teil(6, "Jean Paul Gaultier", "DRAFT"),
       teil(7, "Jean Paul Gaultier", hidden_from_shop=True)]
    + [teil(n, "Comme des Garçons", department="Men") for n in (10, 11, 12)]
    + [teil(n, "Gucci") for n in (20, 21)]
    + [teil(22, "Gucci", "SOLD")]
)


def json_ld(seite):
    return [json.loads(block) for block in
            re.findall(r'<script type="application/ld\+json">(.*?)</script>', seite, re.S)]


class MarkenseitenTests(unittest.TestCase):
    def bauen(self, bestand=BESTAND):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        wurzel = Path(tmp.name)
        (wurzel / "config").mkdir()
        (wurzel / "config" / "marken-texte.json").write_text(json.dumps({
            "_hinweis": "nur ein Hinweis",
            "jean-paul-gaultier": {"de": "Gepflegter Text DE.", "en": "Curated text EN.", "fr": "Texte FR."},
        }), encoding="utf-8")
        for p in (patch.object(build_site, "BASE", wurzel), patch.object(build_site, "ITEMS", bestand),
                  patch.object(build_site, "get_shop_config", lambda: {})):
            p.start()
            self.addCleanup(p.stop)
        build_site.build_markenseiten()
        return wurzel

    def test_slug(self):
        self.assertEqual(markenseiten.marken_slug("Jean Paul Gaultier"), "jean-paul-gaultier")
        self.assertEqual(markenseiten.marken_slug("Y-3"), "y-3")
        self.assertEqual(markenseiten.marken_slug("Comme des Garçons"), "comme-des-garcons")
        self.assertEqual(markenseiten.marken_slug("Dolce & Gabbana"), "dolce-and-gabbana")
        self.assertEqual(markenseiten.marken_slug("A.F. Vandevorst"), "a-f-vandevorst")
        self.assertEqual(markenseiten.marken_slug("Arc’teryx"), "arcteryx")

    def test_seite_ab_drei_teilen_keine_darunter(self):
        wurzel = self.bauen()
        for sprache in ("", "en/", "fr/"):
            self.assertTrue((wurzel / sprache / "marke/jean-paul-gaultier/index.html").is_file(), sprache)
            self.assertTrue((wurzel / sprache / "marke/comme-des-garcons/index.html").is_file(), sprache)
            self.assertTrue((wurzel / sprache / "marken/index.html").is_file(), sprache)
            self.assertFalse((wurzel / sprache / "marke/gucci").exists(), sprache)
        self.assertEqual([m["slug"] for m in markenseiten.marken(build_site)],
                         ["jean-paul-gaultier", "comme-des-garcons"])
        self.assertEqual(markenseiten.kleine_marken(build_site), [("Gucci", 2)])

    def test_alle_verfuegbaren_teile_verlinkt_entwuerfe_nie(self):
        wurzel = self.bauen()
        for sprache, home in (("", "/"), ("en/", "/en/"), ("fr/", "/fr/")):
            seite = (wurzel / sprache / "marke/jean-paul-gaultier/index.html").read_text(encoding="utf-8")
            raster = seite.split('<ul class="mk-grid">', 1)[1].split("</ul>", 1)[0]
            self.assertEqual(sorted(re.findall(r'href="([^"]+)"', raster)),
                             sorted(f"{home}artikel/{n}/" for n in (1, 2, 3, 4)))
            # Bild, Titel, Groesse und Preis stehen im HTML - ohne Skript.
            self.assertEqual(raster.count("<img "), 4)
            self.assertIn({"": "Jean Paul Gaultier Jacke 4", "en/": "Jean Paul Gaultier Jacket 4"}.get(sprache, "Jean Paul Gaultier"), raster)
            self.assertIn("104,00 €", raster)
            self.assertRegex(raster, r'mk-card__size">[^<]+ M<')
            # Verkauftes Teil darunter, Entwurf und verborgenes Teil nirgends.
            verkauft = seite.split('mk-grid--sold">', 1)[1].split("</ul>", 1)[0]
            self.assertEqual(re.findall(r'href="([^"]+)"', verkauft), [f"{home}artikel/5/"])
            self.assertNotIn("artikel/6/", seite)
            self.assertNotIn("artikel/7/", seite)
            self.assertNotIn("104,00 €", verkauft)

    def test_erstes_bild_nicht_lazy_rest_lazy(self):
        bestand = [teil(n, "Prada") for n in range(1, 9)]
        wurzel = self.bauen(bestand)
        seite = (wurzel / "marke/prada/index.html").read_text(encoding="utf-8")
        bilder = re.findall(r"<img [^>]+>", seite)
        self.assertEqual(len(bilder), 8)
        self.assertIn('fetchpriority="high"', bilder[0])
        for bild in bilder[:markenseiten.EAGER_KACHELN]:
            self.assertIn('loading="eager"', bild)
        for bild in bilder[markenseiten.EAGER_KACHELN:]:
            self.assertIn('loading="lazy"', bild)

    def test_canonical_hreflang_titel_h1(self):
        wurzel = self.bauen()
        erwartet = {
            "": ("https://disorder119.com/marke/jean-paul-gaultier/", "Jean Paul Gaultier Second Hand &amp; Vintage | Disorder119",
                 "Jean Paul Gaultier – Second Hand &amp; Vintage"),
            "en/": ("https://disorder119.com/en/marke/jean-paul-gaultier/", "Jean Paul Gaultier Pre-Owned &amp; Vintage | Disorder119",
                    "Jean Paul Gaultier – Pre-Owned &amp; Vintage"),
            "fr/": ("https://disorder119.com/fr/marke/jean-paul-gaultier/", "Jean Paul Gaultier Seconde Main &amp; Vintage | Disorder119",
                    "Jean Paul Gaultier – Seconde Main &amp; Vintage"),
        }
        for sprache, (canonical, titel, h1) in erwartet.items():
            seite = (wurzel / sprache / "marke/jean-paul-gaultier/index.html").read_text(encoding="utf-8")
            self.assertEqual(re.findall(r'<link rel="canonical" href="([^"]+)">', seite), [canonical])
            self.assertEqual(re.findall(r"<title>(.*?)</title>", seite), [titel])
            self.assertEqual(re.findall(r"<h1[^>]*>(.*?)</h1>", seite), [h1])
            alternativen = dict(re.findall(r'<link rel="alternate" hreflang="([^"]+)" href="([^"]+)">', seite))
            self.assertEqual(alternativen, {
                "de": erwartet[""][0], "en": erwartet["en/"][0], "fr": erwartet["fr/"][0], "x-default": erwartet[""][0]})
            self.assertIn('<meta name="robots" content="index,follow', seite)
            self.assertRegex(seite, r'<meta name="description" content="4 [^"]+">')
            self.assertIn('<meta property="og:image" content="https://disorder119.com/assets/img/9004/0.webp">', seite)
            self.assertIn(f'<meta property="og:url" content="{canonical}">', seite)

    def test_titel_hoechstens_60_zeichen(self):
        for name in ("Jean Paul Gaultier", "Walter Van Beirendonck", "Eine Marke Mit Einem Wirklich Sehr Langen Namen"):
            for lang in build_site.LANGS:
                titel = markenseiten.seitentitel({"brand": name}, lang)
                self.assertLessEqual(len(titel), 60, titel)
                self.assertTrue(titel.startswith(name))

    def test_kein_skript_ausser_json_ld(self):
        wurzel = self.bauen()
        for pfad in ("marke/jean-paul-gaultier/index.html", "marken/index.html", "en/marken/index.html"):
            seite = (wurzel / pfad).read_text(encoding="utf-8")
            for tag in re.findall(r"<script\b[^>]*>", seite):
                self.assertEqual(tag, '<script type="application/ld+json">')
            self.assertNotRegex(seite, r"\son[a-z]+=")

    def test_json_ld_sammlung_liste_brotkrumen(self):
        wurzel = self.bauen()
        seite = (wurzel / "en/marke/jean-paul-gaultier/index.html").read_text(encoding="utf-8")
        bloecke = {b.get("@type"): b for b in json_ld(seite) if "@type" in b}
        sammlung = bloecke["CollectionPage"]
        self.assertEqual(sammlung["url"], "https://disorder119.com/en/marke/jean-paul-gaultier/")
        liste = sammlung["mainEntity"]
        self.assertEqual(liste["@type"], "ItemList")
        self.assertEqual(liste["numberOfItems"], 4)
        self.assertEqual([e["position"] for e in liste["itemListElement"]], [1, 2, 3, 4])
        self.assertEqual(sorted(e["url"] for e in liste["itemListElement"]),
                         [f"https://disorder119.com/en/artikel/{n}/" for n in (1, 2, 3, 4)])
        for eintrag in liste["itemListElement"]:
            self.assertTrue(eintrag["name"])
            self.assertTrue(eintrag["image"].startswith("https://disorder119.com/assets/img/"))
        krumen = bloecke["BreadcrumbList"]["itemListElement"]
        self.assertEqual([(k["name"], k["item"]) for k in krumen], [
            ("Archive", "https://disorder119.com/en/"),
            ("Brands", "https://disorder119.com/en/marken/"),
            ("Jean Paul Gaultier", "https://disorder119.com/en/marke/jean-paul-gaultier/"),
        ])

    def test_text_gepflegt_plus_berechnet(self):
        wurzel = self.bauen()
        seite = (wurzel / "marke/jean-paul-gaultier/index.html").read_text(encoding="utf-8")
        text = seite.split('<div class="mk-text">', 1)[1].split("</div>", 1)[0]
        self.assertIn("<p>Gepflegter Text DE.</p>", text)
        self.assertIn("4 Teile von Jean Paul Gaultier für Damen: Jacken (4).", text)
        self.assertIn("zwischen 101 € und 104 €", text)
        # Marke ohne gepflegten Text: nur der berechnete Absatz.
        ohne = (wurzel / "marke/comme-des-garcons/index.html").read_text(encoding="utf-8")
        absaetze = re.findall(r"<p>(.*?)</p>", ohne.split('<div class="mk-text">', 1)[1].split("</div>", 1)[0])
        self.assertEqual(len(absaetze), 1)
        self.assertIn("3 Teile von Comme des Garçons für Herren", absaetze[0])

    def test_uebersicht_listet_marken_mit_anzahl(self):
        wurzel = self.bauen()
        seite = (wurzel / "marken/index.html").read_text(encoding="utf-8")
        self.assertEqual(re.findall(r'<link rel="canonical" href="([^"]+)">', seite), ["https://disorder119.com/marken/"])
        self.assertEqual(len(re.findall(r"<h1\b", seite)), 1)
        raster = seite.split('mk-grid--brands">', 1)[1].split("</ul>", 1)[0]
        self.assertEqual(re.findall(r'href="([^"]+)"', raster), ["/marke/jean-paul-gaultier/", "/marke/comme-des-garcons/"])
        self.assertIn("4 Teile", raster)
        self.assertIn("3 Teile", raster)
        self.assertNotIn("/marke/gucci/", seite)
        self.assertIn('href="/?brand=Gucci"', seite)

    def test_seite_verschwindet_unter_der_schwelle(self):
        wurzel = self.bauen()
        self.assertTrue((wurzel / "marke/comme-des-garcons/index.html").is_file())
        weniger = [it for it in BESTAND if it["id"] != 9010]
        with patch.object(build_site, "ITEMS", weniger):
            build_site.build_markenseiten()
            self.assertEqual(markenseiten.sitemap_segmente(build_site), ["marken/", "marke/jean-paul-gaultier/"])
        for sprache in ("", "en/", "fr/"):
            self.assertFalse((wurzel / sprache / "marke/comme-des-garcons").exists())
            self.assertTrue((wurzel / sprache / "marke/jean-paul-gaultier/index.html").is_file())

    def test_produktseite_markenlink_und_brotkrumen(self):
        self.bauen()
        mit, ohne = BESTAND[0], next(it for it in BESTAND if it["brand"] == "Gucci")
        self.assertEqual(build_site.marken_link(mit, "de"), "/marke/jean-paul-gaultier/")
        self.assertEqual(build_site.marken_link(mit, "fr"), "/fr/marke/jean-paul-gaultier/")
        self.assertEqual(build_site.marken_link(ohne, "en"), "/en/?brand=Gucci")
        krumen = json.loads(build_site.breadcrumb_json_ld(mit, "de"))["itemListElement"]
        self.assertEqual([(k["position"], k["item"]) for k in krumen], [
            (1, "https://disorder119.com/"),
            (2, "https://disorder119.com/marke/jean-paul-gaultier/"),
            (3, "https://disorder119.com/artikel/1/"),
        ])
        self.assertEqual(krumen[1]["name"], "Jean Paul Gaultier")
        self.assertEqual(len(json.loads(build_site.breadcrumb_json_ld(ohne, "de"))["itemListElement"]), 2)
        self.assertEqual(build_site.marken_fusslink("en"), '<a href="/en/marken/">Brands</a>')

    def test_gepflegte_texte_gehoeren_zu_echten_marken(self):
        """config/marken-texte.json: je Marke alle drei Sprachen, Slug in gueltiger Form."""
        daten = json.loads((Path(__file__).resolve().parents[1] / "config" / "marken-texte.json").read_text(encoding="utf-8"))
        for slug, texte in daten.items():
            if slug.startswith("_"):
                continue
            self.assertRegex(slug, r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
            self.assertEqual(sorted(texte), ["de", "en", "fr"], slug)
            for lang, text in texte.items():
                self.assertGreater(len(text.split()), 20, (slug, lang))
                self.assertNotIn(" – ", text, (slug, lang))
                self.assertNotIn("<", text, (slug, lang))


if __name__ == "__main__":
    unittest.main()

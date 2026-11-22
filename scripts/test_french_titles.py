"""Focused tests for deterministic French title and colour localisation."""
import json
from pathlib import Path
import re
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent))
from french_titles import french_color, french_description, french_title


def item(title, brand="Prada", product_type="Jacket", department="Women", color="Schwarz"):
    return {"title": title, "brand": brand, "product_type": product_type,
            "department": department, "color": color}


class FrenchTitleTests(unittest.TestCase):
    def test_preserves_the_maintained_jean_details(self):
        row = item("Jean Paul Gaultier Marmorierte Jeans Damen Blau", "Jean Paul Gaultier", "Trousers", color="Blau")
        self.assertEqual(french_title(row), "Jean Paul Gaultier jean marbré femme bleu")

    def test_translates_compound_garments_and_colours(self):
        rows = [
            (item("Alexander McQueen Jeansjacke Damen Grau", "Alexander McQueen", color="Grau"),
             "Alexander McQueen veste en jean femme grise"),
            (item("Prada Wildleder-Chelsea-Boots Damen Grau", product_type="Boots", color="Grau"),
             "Prada bottines Chelsea en daim femme grises"),
            (item("Yohji Yamamoto Cat-Eye-Sonnenbrille Damen Dunkelblau", "Yohji Yamamoto", "Sunglasses", color="Dunkelblau"),
             "Yohji Yamamoto lunettes de soleil œil-de-chat femme bleu foncé"),
        ]
        for row, expected in rows:
            with self.subTest(title=row["title"]):
                self.assertEqual(french_title(row), expected)

    def test_keeps_collection_and_collaboration_names(self):
        rows = [
            (item("Prada America's Cup Sneaker Damen Dunkelblau", product_type="Sneakers"), "America's Cup"),
            (item("Dior I Love Dior Set Damen Schwarz", "Dior", "Set"), "I Love Dior"),
            (item("Jean Paul Gaultier Classique Patchwork-Mesh-Top Damen", "Jean Paul Gaultier", "Top"), "Classique top en résille patchwork"),
            (item("Maison Margiela x H&M Blazer Damen Grau", "Maison Margiela", "Blazer"), "Maison Margiela x H&M"),
            (item("MM6 Maison Margiela Kleid Damen Schwarz", "Maison Margiela", "Dress"), "MM6 Maison Margiela robe"),
            (item("Pierre Balmain Steppjacke Damen Grau", "Balmain"), "Pierre Balmain veste matelassée"),
            (item("Armani Collezioni Daunenjacke Herren Grau", "Armani", "Jacket", "Men"), "Armani Collezioni doudoune"),
        ]
        for row, expected in rows:
            with self.subTest(title=row["title"]):
                translated = french_title(row)
                self.assertIn(expected, translated)
                self.assertEqual(translated.count(row["brand"]), row["title"].count(row["brand"]))

    def test_unknown_words_use_only_recorded_attributes(self):
        row = item("Designer Unbekanntes-Geheimmodell Kleid Damen Blau", "Designer", "Dress", color="Blau")
        self.assertEqual(french_title(row), "Designer robe femme bleue")
        self.assertNotIn("Geheimmodell", french_title(row))
        self.assertEqual(french_title({"title": "Unbekannter Titel", "brand": "Designer"}), "Designer pièce")

    def test_colour_labels_use_the_recorded_palette(self):
        self.assertEqual(french_color("Schwarz, Weiß"), "noir, blanc")
        self.assertEqual(french_color("Dunkelgrün, Khaki"), "vert foncé, kaki")
        self.assertEqual(french_color("Schwarz, Unbekannt"), "")
        self.assertEqual(french_color(""), "")

    def test_replaces_title_and_german_colour_remnants_in_french_copy(self):
        row = item("Prada Lederjacke Damen Schwarz")
        text = "Prada Lederjacke Damen Schwarz. Une pièce d’archive.\nCouleur : Schwarz, Weiß\nTaille : 38"
        translated = french_description(row, text)
        self.assertIn("Prada veste en cuir femme noire", translated)
        self.assertIn("Couleur : noir, blanc", translated)
        self.assertIn("Une pièce d’archive.", translated)
        self.assertNotIn("Schwarz", translated)

    def test_public_catalogue_has_no_german_garment_or_gender_words(self):
        catalog_path = Path(__file__).resolve().parents[1] / "data" / "catalog.json"
        if not catalog_path.is_file():
            self.skipTest("Public catalogue is not checked out")
        catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
        german = re.compile(r"\b(?:Damen|Herren|Kleid|Jacke|Hose|Rock|Gürtel|Tasche|Blau|Schwarz|Weiß|Grau|Braun|Grün|mit|aus)\b", re.I)
        for row in catalog:
            with self.subTest(article=row.get("article")):
                self.assertFalse(german.search(french_title(row)))


if __name__ == "__main__":
    unittest.main()

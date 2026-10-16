"""Tests für scripts/i18n_text.py (Titel, Farben, Beschreibungen je Sprache)
und scripts/related_items.py (Ähnliche Teile, vor/zurück)."""
import ast
import json
import re
import unittest
from pathlib import Path

import i18n_text as T
import related_items as R
from repair_product_metadata_conservative import expand_description

GERMAN_WORDS = re.compile(r"\b(?:Damen|Herren|Schwarz|Grau|Braun|Weiß|Jacke|Hose|Mütze|Gürtel|Stiefel|mit|von)\b")


def item(**felder):
    basis = {"id": 1, "brand": "Prada", "title": "Prada Loafer Herren Rotbraun", "product_type": "Loafers",
             "department": "Men", "taxonomy_category": "Shoes", "category": "Shoes", "public_status": "AVAILABLE",
             "gallery": ["assets/img/1/0.webp"], "price": 120, "size": "9", "color": "Rotbraun"}
    basis.update(felder)
    return basis


class TitelTest(unittest.TestCase):
    def test_ableitung_ohne_deutsche_woerter(self):
        it = item()
        self.assertEqual(T.loc_title(it, "en"), "Prada Men's Reddish Brown Loafers")
        self.assertEqual(T.loc_title(it, "fr"), "Prada mocassins homme brun rouge")
        self.assertEqual(T.loc_title(it, "de"), "Prada Loafer Herren Rotbraun")

    def test_eigener_titel_hat_vorrang(self):
        it = item(title_en="Prada Burgundy Leather Loafers Men", title_fr="")
        self.assertEqual(T.loc_title(it, "en"), "Prada Burgundy Leather Loafers Men")
        self.assertEqual(T.loc_title(it, "fr"), "Prada mocassins homme brun rouge")

    def test_marke_aus_titelanfang_und_alias(self):
        it = item(brand="Luna Rossa", title="Prada Luna Rossa Sweatjacke Herren Schwarz",
                  product_type="Jacket", taxonomy_category="Jackets")
        T.apply_brand_aliases([it])
        self.assertEqual(it["brand"], "Prada")
        self.assertEqual(T.loc_name(it, "en"), "Prada Luna Rossa Men's Black Zip Sweatshirt")
        pierre = item(brand="Balmain", title="Pierre Balmain Sweatshirt Herren Grau", product_type="Sweatshirt")
        self.assertEqual(T.loc_name(pierre, "fr"), "Pierre Balmain sweat-shirt homme gris")
        ohne = item(brand="Y-3", title="Logo-Cap Grün", product_type="Cap")
        self.assertEqual(T.loc_name(ohne, "en"), "Y-3 Green Logo Cap")
        plus = item(brand="Jil Sander", title="Jil Sander+ Cord-Weste Damen", product_type="Vest")
        self.assertEqual(T.loc_title(plus, "en"), "Jil Sander+ Women's Corduroy Vest")

    def test_linien_und_modelle_bleiben(self):
        # Unbekannte Wörter (Linien, Modelle) gehen nicht verloren.
        faelle = [
            ("Prada", "Prada America's Cup Sneaker Damen Dunkelblau", "Sneakers",
             "Prada America's Cup Women's Dark Blue Sneakers", "Prada America's Cup baskets femme bleu foncé"),
            ("Jean Paul Gaultier", "Jean Paul Gaultier Tattoo-Kleid Damen Bunt", "Dress",
             "Jean Paul Gaultier Women's Multicolor Tattoo Dress", "Jean Paul Gaultier robe Tattoo femme multicolore"),
            ("Prada", "Prada Linea Rossa Bikerjacke Herren", "Biker Jacket",
             "Prada Linea Rossa Men's Biker Jacket", "Prada Linea Rossa perfecto homme"),
            ("Supreme", "Supreme Cloud-Wash-Jeans Herren Grau", "Trousers",
             "Supreme Men's Gray Cloud-Wash Jeans", "Supreme jean Cloud-Wash homme gris"),
            ("Hysteric Glamour", "Hysteric Glamour Pop-Up Toaster", "Toaster",
             "Hysteric Glamour Pop-Up Toaster", "Hysteric Glamour Pop-Up grille-pain"),
            ("Rundholz", "Rundholz Asymmetrischer Cardigan Damen Elfenbein", "Jacket",
             "Rundholz Women's Asymmetric Ivory Cardigan", "Rundholz cardigan asymétrique femme ivoire"),
        ]
        for marke, titel, typ, en, fr in faelle:
            it = item(title=titel, product_type=typ, brand=marke)
            self.assertEqual(T.loc_title(it, "en"), en)
            self.assertEqual(T.loc_title(it, "fr"), fr)

    def test_franzoesisch_angeglichen(self):
        faelle = [
            ("Prada Jacke Damen Schwarz", "Jacket", "Prada veste femme noire"),
            ("Prada Stiefel Damen Schwarz", "Boots", "Prada bottes femme noires"),
            ("Prada Sneaker mit Schnalle Damen Grün", "Sneakers", "Prada baskets à boucle femme vertes"),
            ("Prada Pumps Damen Schwarz", "Heels", "Prada escarpins femme noirs"),
            ("Prada Jacke Damen Hellblau", "Jacket", "Prada veste femme bleu clair"),
        ]
        for titel, typ, fr in faelle:
            it = item(title=titel, product_type=typ, brand="Prada")
            self.assertEqual(T.loc_title(it, "fr"), fr)
        cap = item(title="Y-3 Logo-Cap Grün", product_type="Cap", brand="Y-3")
        self.assertEqual(T.loc_title(cap, "fr"), "Y-3 casquette à logo verte")

    def test_unbekanntes_deutsch_wird_gemeldet(self):
        it = item(title="Prada Jacke mit Zierknöpfen Damen", product_type="Jacket")
        titel, weg = T.title_parts(it, "en")
        self.assertEqual(titel, "Prada Women's Jacket")
        self.assertEqual(weg, ["mit Zierknöpfen"])

    def test_kein_deutsches_wort_in_ableitung(self):
        faelle = [
            ("Jean Paul Gaultier Marmorierte Jeans Damen Blau", "Trousers"),
            ("Y-3 Rasta-Mütze", "Beanie"),
            ("Jean Paul Gaultier Schwanengürtel Damen", "Belt"),
            ("Prada Jacke mit Streifenkragen Damen Hellblau", "Jacket"),
            ("Prada Stiefel Damen Schwarz", "Boots"),
        ]
        for titel, typ in faelle:
            for lang in ("en", "fr"):
                abgeleitet = T.loc_title(item(title=titel, product_type=typ, brand=titel.split()[0]), lang)
                self.assertIsNone(GERMAN_WORDS.search(abgeleitet), (titel, lang, abgeleitet))


class DeutscherNameTest(unittest.TestCase):
    def test_gleiche_regel_wie_build_site(self):
        # build_site.display_name bleibt eigenstaendig (der Worker-Test liest
        # sie per AST); loc_name(it, "de") muss fuer jeden Artikel gleich sein.
        base = Path(__file__).resolve().parents[1]
        src = (base / "build_site.py").read_text(encoding="utf-8")
        fn = next(n for n in ast.parse(src).body if isinstance(n, ast.FunctionDef) and n.name == "display_name")
        ns = {"re": re}
        exec(compile(ast.Module(body=[fn], type_ignores=[]), "build_site.py", "exec"), ns)
        items = json.loads((base / "data" / "items.json").read_text(encoding="utf-8"))
        T.apply_brand_aliases(items)
        for it in items:
            self.assertEqual(ns["display_name"](it), T.loc_name(it, "de"), it["id"])


class FarbeTest(unittest.TestCase):
    def test_uebersetzung_und_google_format(self):
        self.assertEqual(T.color_tr("Schwarz, Grau", "en"), "Black, Gray")
        self.assertEqual(T.color_tr("Weiss", "fr"), "Blanc")
        self.assertEqual(T.merchant_color(item(color="Orange, Bunt"), "de"), "Orange")
        self.assertEqual(T.merchant_color(item(color="Rot, Blau, Grün, Gelb"), "en"), "Red/Blue/Green")
        self.assertEqual(T.merchant_color(item(color="Khaki, Braun"), "fr"), "Kaki/Marron")

    def test_bunt_allein_bleibt_mehrfarbig(self):
        # Bekleidung ohne Farbe lehnt Google ab - "Bunt" allein bleibt stehen.
        self.assertEqual(T.merchant_color(item(color="Bunt"), "de"), "Mehrfarbig")
        self.assertEqual(T.merchant_color(item(color="Bunt"), "en"), "Multicolor")
        self.assertEqual(T.merchant_color(item(color=""), "en"), "")

    def test_freie_farbangaben(self):
        # Admin-Feld color ist Freitext (admin-katalog.js text(60)).
        self.assertEqual(T.color_tr("Schwarz-Weiß", "en"), "Black, White")
        self.assertEqual(T.color_tr("Schwarz und Gold", "fr"), "Noir, Or")
        self.assertEqual(T.color_tr("Schwarz & Gold", "en"), "Black, Gold")
        self.assertEqual(T.color_tr("Grau meliert", "en"), "Heather Gray")
        self.assertEqual(T.color_tr("Grau meliert", "fr"), "Gris chiné")
        self.assertEqual(T.color_tr("Hellgrau", "en"), "Light Gray")
        self.assertEqual(T.color_tr("Dunkelgrau", "fr"), "Gris foncé")
        self.assertEqual(T.merchant_color(item(color="Schwarz-Weiß"), "de"), "Schwarz/Weiß")
        self.assertEqual(T.unknown_color_words("Schwarz, Petrolgrün"), ["Petrolgrün"])
        self.assertEqual(T.unknown_color_words("Grau meliert"), [])


class BeschreibungTest(unittest.TestCase):
    def test_ci_platzhalter_wird_ersatztext(self):
        it = item(desc_en="From the curated archive of Disorder119.\n\nPrada Loafer Herren Rotbraun by Prada. "
                          "Category: Shoes. Size: 9. Color: Rotbraun. For missing details, please see the photos or ask before buying.")
        self.assertEqual(T.own_description(it, "en"), "")
        self.assertEqual(T.body_description(it, "en"),
                         "Prada Men's Reddish Brown Loafers – Shoes, Size 9. From the curated archive of Disorder119.")

    def test_faktenzeile_mitten_im_text_und_titel_ersetzt(self):
        it = item(desc_en="From the curated archive of Disorder119.\n\nPrada Loafer Herren Rotbraun by Prada. "
                          "Category: Shoes. Size: 37.5. Color: Rotbraun.\n\nCondition note: small stain.")
        text = T.own_description(it, "en")
        self.assertIn("Prada Men's Reddish Brown Loafers by Prada.", text)
        self.assertIn("Condition note: small stain.", text)
        self.assertNotIn("Rotbraun", text)
        self.assertNotIn("Category:", text)

    def test_echte_uebersetzung_bleibt_unveraendert(self):
        echt = "Issu des archives sélectionnées de Disorder119.\n\nVeste en cuir.\nCouleur  : noir\nTaille: 38\nBoucle  : boutons"
        self.assertEqual(T.own_description(item(desc_fr=echt), "fr"), echt)

    def test_meta_ohne_zustand_und_mit_kategorie(self):
        it = item(condition="Sehr gut", desc_en="")
        meta = T.meta_description(it, "en")
        self.assertIn("Shoes", meta)
        self.assertNotIn("Condition", meta)
        self.assertNotIn("Zustand", T.meta_description(it, "de"))

    def test_meta_ohne_zustandshinweis_aus_der_beschreibung(self):
        it = item(desc_de="Aus dem kuratierten Archiv von Disorder119.\n\nHinweis zum Zustand: Die Jacke hat vorne "
                          "deutliche Flecken (siehe Fotos).\n\nKurz geschnittene Jacke von Prada in Hellblau mit Stehkragen "
                          "und Rippbündchen. Größe S.",
                  desc_fr="Issu des archives sélectionnées de Disorder119.\n\nRemarque sur l\u2019état : la veste présente "
                          "des taches.\n\nVeste courte Prada bleu clair à col montant et bords côtes aux poignets.")
        for lang in ("de", "fr"):
            meta = T.meta_description(it, lang)
            self.assertIsNone(T.CONDITION_META_RE.search(meta), meta)
        self.assertIn("Kurz geschnittene Jacke", T.meta_description(it, "de"))
        # Sichtbar bleibt der Hinweis (Regel 07.10.: Mängel in der Beschreibung).
        self.assertIn("Hinweis zum Zustand", T.body_description(it, "de"))
        neu = item(desc_de="Y-3 Cargohose aus festem Baumwollstoff mit vielen Taschen und weitem Bein. "
                           "Hinweis zum Zustand: neu mit Originaletiketten.")
        self.assertNotIn("Originaletikett", T.meta_description(neu, "de"))

    def test_sichtbare_beschreibung_ohne_kopfzeile(self):
        it = item(brand="Jean Paul Gaultier", title="Jean Paul Gaultier Tattoo-Kleid Damen Bunt",
                  desc_fr="Jean Paul Gaultier Tattoo Dress Multicolor M\n\nIssu des archives sélectionnées de "
                          "Disorder119.\n\nUne pièce iconique de la collection tatouage de 1996, imprimée de motifs "
                          "tribaux sur une maille élastique.")
        text = T.body_description(it, "fr")
        self.assertTrue(text.startswith("Une pièce iconique"), text)
        self.assertNotIn("Issu des archives", text)
        # Nur ein Platzhalter: bleibt wie er ist.
        platzhalter = item(desc_de="Aus dem kuratierten Archiv von Disorder119.\n\nPrada Loafer Herren Rotbraun von Prada.")
        self.assertEqual(T.body_description(platzhalter, "de"), platzhalter["desc_de"])

    def test_alte_platzhalter_und_rohmarke(self):
        alt = item(title="Burberry Nova Check Shorts Damen", brand="Burberry",
                   desc_en="Burberry Nova Check Shorts Damen – pants. From the curated Disorder119 archive. "
                           "Category: Pants. For missing details, please see the photos or ask before buying.")
        self.assertEqual(T.own_description(alt, "en"), "")
        roh = item(brand="Dior Homme", title="Dior Homme High-Top-Sneaker Herren Beige",
                   desc_en="From the curated archive of Disorder119.\n\nDior Homme High-Top-Sneaker Herren Beige by Dior Homme.")
        T.apply_brand_aliases([roh])
        self.assertEqual(T.own_description(roh, "en"), "")

    def test_einheitsgroesse_ohne_doppeltes_size(self):
        it = item(size="Einheitsgröße", taxonomy_category="Accessories", title="Y-3 Rasta-Mütze", product_type="Beanie", brand="Y-3")
        self.assertIn("Accessories, One size.", T.auto_description(it, "en"))
        self.assertIn("Accessoires, Taille unique.", T.auto_description(it, "fr"))
        self.assertEqual(T.size_phrase(item(size="One Size"), "en"), "One size")
        self.assertEqual(T.size_phrase(item(size="One Size"), "fr"), "Taille unique")

    def test_masse_statt_groesse(self):
        it = item(size="ca. 28 x 18 x 15.5 cm", size_normalized="Dimensions")
        self.assertEqual(T.size_phrase(it, "en"), "Dimensions approx. 28 x 18 x 15.5 cm")
        self.assertEqual(T.size_phrase(it, "fr"), "Dimensions env. 28 x 18 x 15.5 cm")
        self.assertTrue(T.size_is_word("ca. 28 x 18 x 15.5 cm"))
        self.assertFalse(T.size_is_word("M"))

    def test_strukturierte_beschreibung_ohne_kopfzeile(self):
        it = item(desc_de="Prada Loafer Rotbraun 9\nAus dem kuratierten Archiv von Disorder119.\n"
                          "Weiche Loafer aus glattem Leder mit Ledersohle. Getragen, aber gepflegt.")
        text = T.structured_description(it, "de")
        self.assertTrue(text.startswith("Weiche Loafer"), text)
        self.assertTrue(text.endswith("."), text)

    def test_ci_schreibt_keine_en_fr_texte(self):
        with self.assertRaises(ValueError):
            expand_description(item(desc_en=""), "en")


class ZustandUndGroesseTest(unittest.TestCase):
    def test_immer_gebraucht(self):
        # Kein Zustand je Artikel (07.10.2026, Bericht 1 P1-6).
        for zustand in ("Neu mit Etikett", "Neu", "Gut", ""):
            self.assertEqual(T.item_condition(item(condition=zustand)), "used")

    def test_groessensystem_nur_mit_beleg(self):
        spec = T.size_specification
        self.assertEqual(spec(item(size="M / 38 / 10", size_normalized="M"), "en"), ("M", ""))
        self.assertEqual(spec(item(size="3 / EU 41 / 26 cm", size_normalized="EU 41"), "de"), ("41", "EU"))
        self.assertEqual(spec(item(size="US 9", size_normalized="US 9"), "de"), ("9", "US"))
        self.assertEqual(spec(item(size="42", size_normalized="XL", label_size="IT 42"), "de"), ("42", "IT"))
        self.assertEqual(spec(item(size="38", size_normalized="EU 38"), "de"), ("38", "EU"))
        # Italienische Damengröße ohne Etikettangabe: kein System raten.
        self.assertEqual(spec(item(size="44", size_normalized="L"), "de"), ("44", ""))
        self.assertEqual(spec(item(size="9", size_normalized="9"), "de"), ("9", ""))
        self.assertEqual(spec(item(size="Einheitsgröße", size_normalized="One Size"), "en"), ("One size", ""))
        self.assertIsNone(spec(item(size="ca. 28 x 18 x 15.5 cm", size_normalized="Dimensions"), "de"))
        self.assertIsNone(spec(item(size="Sonstige", size_normalized="Other"), "de"))

    def test_material_nur_aus_feld(self):
        self.assertEqual(T.material_tr(None, "en"), "")
        self.assertEqual(T.material_tr("Leder, Gore-Tex", "fr"), "Cuir, Gore-Tex")


class BrowserSkriptTest(unittest.TestCase):
    """Statische Prüfungen der Browser-Skripte (die Seiten selbst prüft Playwright)."""

    def lesen(self, name):
        return (Path(__file__).resolve().parents[1] / "assets" / name).read_text(encoding="utf-8")

    def test_titel_wird_nicht_global_ueberschrieben(self):
        # Match/Chaos/Baukasten (Mode-Guard) lesen it.title und erkennen daran
        # z.B. Kopfteile - der deutsche Titel muss dort ankommen.
        app = self.lesen("app.js")
        self.assertNotRegex(app, r"\bit\.title\s*=\s*(?!=)")
        self.assertIn("function locTitle(it)", app)

    def test_testartikel_nie_im_band(self):
        nav = self.lesen("archiv-navigation.js")
        self.assertIn('String(it.id) === "9999"', nav)
        self.assertIn('String(it.article || "").toUpperCase() === "TEST"', nav)
        self.assertIn("!istTestartikel(it)", nav)


class VerlinkungTest(unittest.TestCase):
    def katalog(self):
        items = []
        for i in range(40):
            marke = ["Prada", "Dior", "Y-3", "Rundholz"][i % 4] if i < 36 else f"Einzel{i}"
            kategorie = ["Jackets", "Shoes", "Tops"][i % 3]
            status = "SOLD" if i % 7 == 0 else "AVAILABLE"
            items.append(item(id=100 + i, url_slug=str(i + 1), brand=marke, title=f"{marke} Teil {i}",
                              taxonomy_category=kategorie, public_status=status, brightness=(i * 37 % 100) / 100))
        items.append(item(id=999, url_slug="999", brand="Draft", public_status="DRAFT"))
        return items

    def test_nur_verfuegbare_und_richtige_abschnitte(self):
        items = self.katalog()
        plan = R.related_plan(items)
        self.assertNotIn(999, plan)
        for quelle in items:
            if quelle["id"] not in plan:
                continue
            marke, kategorie = plan[quelle["id"]]
            self.assertLessEqual(len(marke), R.RELATED_N)
            self.assertLessEqual(len(kategorie), R.RELATED_N)
            for x in marke + kategorie:
                self.assertEqual(x["public_status"], "AVAILABLE")
                self.assertNotEqual(x["id"], quelle["id"])
            for x in marke:
                self.assertEqual(x["brand"], quelle["brand"])
            for x in kategorie:
                self.assertEqual(x["taxonomy_category"], quelle["taxonomy_category"])
            self.assertFalse({x["id"] for x in marke} & {x["id"] for x in kategorie})

    def test_jedes_verfuegbare_stueck_mindestens_drei_links(self):
        items = self.katalog()
        eingehend = R.incoming_counts(R.related_plan(items))
        for it in items:
            if it["public_status"] == "AVAILABLE":
                self.assertGreaterEqual(eingehend.get(it["id"], 0), R.MIN_INCOMING, it["id"])

    def test_fenster_rotiert(self):
        items = self.katalog()
        plan = R.related_plan(items)
        prada = [it for it in items if it["brand"] == "Prada" and it["public_status"] == "AVAILABLE"]
        fenster = {tuple(x["id"] for x in plan[it["id"]][0]) for it in prada}
        self.assertGreater(len(fenster), 1)

    def test_vor_zurueck_hell_nach_dunkel_mit_slug(self):
        items = self.katalog()
        reihe = R.article_sequence(items)
        verfuegbar = sorted((it for it in items if it["public_status"] == "AVAILABLE"),
                            key=lambda it: -it["brightness"])
        erster, zweiter = str(verfuegbar[0]["url_slug"]), str(verfuegbar[1]["url_slug"])
        self.assertEqual(reihe[erster][1], zweiter)
        self.assertEqual(reihe[zweiter][0], erster)
        self.assertEqual(reihe[erster][0], str(verfuegbar[-1]["url_slug"]))
        self.assertNotIn("999", reihe)


if __name__ == "__main__":
    unittest.main()

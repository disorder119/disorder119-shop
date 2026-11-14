"""Kategorieseiten: /damen/, /herren/ und /damen/<kategorie>/, /herren/<kategorie>/,
dazu /marke/<slug>/<kategorie>/, /neu/, /unter-100/, /unter-200/ und /vintage-archive-shop/.

Reine Einstiegsseiten fuer Suchmaschinen: Der Shop selbst (Startseite, Menue,
Fusszeile) verlinkt sie nicht (Inhaber 14.11.2026). Erreichbar sind sie ueber
die Sitemap, untereinander und ueber die Markenseiten.

Eigene, indexierbare Adresse je Bereich und Produktart ("Designer Jacken Damen
Second Hand"), wie die Markenseiten (scripts/markenseiten.py) reines HTML ohne
Skript. Bisher gab es Kategorien nur als Filter der Startseite - keine Seite,
die Google fuer "Vintage Jacken Damen" zeigen konnte.

Geruest, Kacheln und Stil kommen aus markenseiten.py / assets/marken.css. Eine
Kategorieseite gibt es erst ab MIN_TEILE verfuegbaren Teilen; darunter loescht
der naechste Bau sie wieder. Unisex-Teile stehen bei Damen und Herren.
"""
from __future__ import annotations

import re
import shutil

import markenseiten as ms

MIN_TEILE = 3
MARKEN_MAX = 5

BEREICHE = (
    {"slug": "damen", "abteilungen": ("Women", "Unisex")},
    {"slug": "herren", "abteilungen": ("Men", "Unisex")},
)

# Wie das Menue des Archivs gruppiert (index_template.html, data-menu-categories).
GRUPPEN = (
    {"slug": "jacken", "kategorien": ("Jackets", "Coats")},
    {"slug": "tops", "kategorien": ("Tops", "Shirts", "Knitwear")},
    {"slug": "hosen", "kategorien": ("Pants",)},
    {"slug": "roecke", "kategorien": ("Skirts",)},
    {"slug": "kleider", "kategorien": ("Dresses",)},
    {"slug": "schuhe", "kategorien": ("Shoes",)},
    {"slug": "accessoires", "kategorien": ("Accessories", "Objects")},
)

TEXTE = {
    "de": {
        "bereich": {"damen": "Damen", "herren": "Herren"},
        "gruppe": {"jacken": "Jacken", "tops": "Tops & Hemden", "hosen": "Hosen", "roecke": "Röcke", "kleider": "Kleider",
                   "schuhe": "Schuhe", "accessoires": "Accessoires"},
        "titel": "Designer {gruppe} {bereich} Second Hand & Vintage | Disorder119",
        "titel_kurz": "Designer {gruppe} {bereich} Second Hand | Disorder119",
        "h1": "Designer-{gruppe} für {bereich} – Vintage & Second Hand",
        "hub_titel": "Designer Mode {bereich} Vintage & Second Hand | Disorder119",
        "hub_h1": "Designer-Mode für {bereich} – Vintage Archive Shop",
        "text": "Im Vintage-Archiv von Disorder119 sind aktuell {n} {gruppe} für {bereich} verfügbar{marken}. {preis}{groessen}"
                "Alle Teile sind Second-Hand- und Vintage-Einzelstücke ausgewählter Designer, werden einzeln fotografiert "
                "und sind jeweils nur einmal vorhanden. Versand mit DHL aus Deutschland.",
        "hub_text": "Disorder119 ist ein Vintage Archive Shop für Designer-Mode aus zweiter Hand. Für {bereich} sind aktuell "
                    "{n} Teile verfügbar{marken}. {preis}Jedes Teil ist ein Einzelstück, wird einzeln fotografiert und "
                    "mit DHL aus Deutschland verschickt.",
        "hub_wort": "Teile",
        "marken": ", unter anderem von {liste}",
        "desc": "{n} Designer-{gruppe} für {bereich} aus zweiter Hand{marken}. {preis}Vintage-Einzelstücke, einzeln fotografiert.",
        "hub_desc": "Vintage Archive Shop: {n} Designer-Teile für {bereich} aus zweiter Hand{marken}. {preis}Jedes Teil nur 1× verfügbar.",
        "desc_marken": " von {liste}",
        "kat_h2": "Kategorien", "andere_h2": "Auch im Archiv", "marken_h2": "Marken in dieser Auswahl",
        "llms": "Kategorien",
    },
    "en": {
        "bereich": {"damen": "Women", "herren": "Men"},
        "gruppe": {"jacken": "Jackets", "tops": "Tops & Shirts", "hosen": "Trousers", "roecke": "Skirts", "kleider": "Dresses",
                   "schuhe": "Shoes", "accessoires": "Accessories"},
        "titel": "Designer {gruppe} for {bereich} Pre-Owned & Vintage | Disorder119",
        "titel_kurz": "Designer {gruppe} {bereich} Pre-Owned | Disorder119",
        "h1": "Designer {gruppe} for {bereich} – Vintage & Pre-Owned",
        "hub_titel": "Designer Fashion {bereich} Vintage & Pre-Owned | Disorder119",
        "hub_h1": "Designer Fashion for {bereich} – Vintage Archive Shop",
        "text": "The Disorder119 vintage archive currently has {n} {gruppe} for {bereich} in stock{marken}. {preis}{groessen}"
                "Every piece is a pre-owned or vintage one-off by selected designers, photographed individually and "
                "available only once. Shipping with DHL from Germany.",
        "hub_text": "Disorder119 is a vintage archive shop for pre-owned designer fashion. {n} pieces for {bereich} are "
                    "currently available{marken}. {preis}Every piece is a one-off, photographed individually and shipped "
                    "with DHL from Germany.",
        "hub_wort": "pieces",
        "marken": ", including {liste}",
        "desc": "{n} pre-owned designer {gruppe} for {bereich}{marken}. {preis}Vintage one-offs, photographed individually.",
        "hub_desc": "Vintage archive shop: {n} pre-owned designer pieces for {bereich}{marken}. {preis}Each available only once.",
        "desc_marken": " by {liste}",
        "kat_h2": "Categories", "andere_h2": "Also in the archive", "marken_h2": "Brands in this selection",
        "llms": "Categories",
    },
    "fr": {
        "bereich": {"damen": "Femme", "herren": "Homme"},
        "gruppe": {"jacken": "Vestes", "tops": "Hauts & chemises", "hosen": "Pantalons", "roecke": "Jupes", "kleider": "Robes",
                   "schuhe": "Chaussures", "accessoires": "Accessoires"},
        "titel": "{gruppe} de créateurs {bereich} seconde main & vintage | Disorder119",
        "titel_kurz": "{gruppe} créateurs {bereich} seconde main | Disorder119",
        "h1": "{gruppe} de créateurs {bereich} – Vintage & Seconde Main",
        "hub_titel": "Mode de créateurs {bereich} vintage & seconde main | Disorder119",
        "hub_h1": "Mode de créateurs {bereich} – Vintage Archive Shop",
        "text": "L’archive vintage Disorder119 propose actuellement {n} {gruppe} {bereich}{marken}. {preis}{groessen}"
                "Chaque pièce est une pièce unique de seconde main ou vintage de créateurs choisis, photographiée "
                "individuellement et disponible une seule fois. Expédition par DHL depuis l’Allemagne.",
        "hub_text": "Disorder119 est un vintage archive shop de mode de créateurs de seconde main. {n} pièces {bereich} sont "
                    "actuellement disponibles{marken}. {preis}Chaque pièce est unique, photographiée individuellement et "
                    "expédiée par DHL depuis l’Allemagne.",
        "hub_wort": "pièces",
        "marken": ", notamment de {liste}",
        "desc": "{n} {gruppe} de créateurs {bereich} de seconde main{marken}. {preis}Pièces vintage uniques.",
        "hub_desc": "Vintage archive shop : {n} pièces de créateurs {bereich} de seconde main{marken}. {preis}Chaque pièce est unique.",
        "desc_marken": " de {liste}",
        "kat_h2": "Catégories", "andere_h2": "Aussi dans l’archive", "marken_h2": "Marques de cette sélection",
        "llms": "Catégories",
    },
}

# Weitere Landingpages: Marke + Produktart, Neuzugaenge, Preisgrenzen, "Vintage Archive Shop".
NEU_MAX = 24
PREISGRENZEN = (100, 200)
NEU_SEG = "neu/"
VAS_SEG = "vintage-archive-shop/"
EINZEL_SEGMENTE = ("neu", "vintage-archive-shop") + tuple(f"unter-{g}" for g in PREISGRENZEN)

EXTRA = {
    "de": {
        "mk_titel": "{brand} {gruppe} Second Hand & Vintage | Disorder119", "mk_titel_kurz": "{brand} {gruppe} Second Hand | Disorder119",
        "mk_h1": "{brand} {gruppe} – Second Hand & Vintage",
        "mk_text": "Im Vintage-Archiv von Disorder119 sind aktuell {n} {gruppe} von {brand} verfügbar. {preis}{groessen}Alle Teile sind "
                   "Second-Hand-Einzelstücke, werden einzeln fotografiert und sind jeweils nur einmal vorhanden. Versand mit DHL aus Deutschland.",
        "mk_desc": "{n} {brand} {gruppe} aus zweiter Hand. {preis}Vintage-Einzelstücke, jedes nur 1× verfügbar.",
        "neu_name": "Neu", "neu_titel": "Neu eingetroffen: Designer Second Hand & Vintage | Disorder119",
        "neu_h1": "Neu im Archiv – Designer Vintage & Second Hand",
        "neu_text": "Die {n} neuesten Teile im Vintage-Archiv von Disorder119{marken}. {preis}Jedes Teil ist ein Einzelstück: "
                    "Was verkauft ist, kommt nicht wieder. Versand mit DHL aus Deutschland.",
        "neu_desc": "Die {n} neuesten Designer-Teile aus zweiter Hand{marken}. {preis}Jedes Teil nur 1× verfügbar.",
        "preis_name": "Unter {grenze}", "preis_titel": "Designer Second Hand unter {grenze} | Disorder119",
        "preis_h1": "Designer-Mode unter {grenze} – Vintage & Second Hand",
        "preis_text": "{n} Designer-Teile aus zweiter Hand unter {grenze}{marken}. {preis}Alle Teile sind Einzelstücke aus dem "
                      "Vintage-Archiv von Disorder119, einzeln fotografiert und nur einmal vorhanden. Versand mit DHL aus Deutschland.",
        "preis_desc": "{n} Designer-Teile aus zweiter Hand unter {grenze}{marken}. Vintage-Einzelstücke, jedes nur 1× verfügbar.",
        "vas_name": "Vintage Archive Shop", "vas_titel": "Vintage Archive Shop: Designer Second Hand | Disorder119",
        "vas_h1": "Vintage Archive Shop – Designer-Mode aus zweiter Hand",
        "vas_text": "Disorder119 ist ein Vintage Archive Shop für Archive Fashion: ein kuratiertes Archiv für Designer-Mode aus zweiter Hand{marken}. "
                    "Aktuell sind {n} Teile verfügbar. {preis}Jedes Stück wird einzeln ausgewählt, fotografiert und beschrieben und "
                    "ist nur einmal vorhanden. Versand mit DHL aus Deutschland.",
        "vas_desc": "Vintage Archive Shop für Designer-Mode aus zweiter Hand{marken}. {n} Einzelstücke, {preis}jedes nur 1× verfügbar.",
        "trust": ["Jedes Teil nur 1× verfügbar", "14 Tage Widerrufsrecht", "PayPal & Apple Pay"],
        "trust_versand": "Kostenloser Versand ab {betrag} in Deutschland",
        "verkauft_h2": "Zuletzt verkauft", "mehr_h2": "Mehr entdecken",
    },
    "en": {
        "mk_titel": "{brand} {gruppe} Pre-Owned & Vintage | Disorder119", "mk_titel_kurz": "{brand} {gruppe} Pre-Owned | Disorder119",
        "mk_h1": "{brand} {gruppe} – Pre-Owned & Vintage",
        "mk_text": "The Disorder119 vintage archive currently has {n} {brand} {gruppe} in stock. {preis}{groessen}Every piece is a "
                   "pre-owned one-off, photographed individually and available only once. Shipping with DHL from Germany.",
        "mk_desc": "{n} pre-owned {brand} {gruppe}. {preis}Vintage one-offs, each available only once.",
        "neu_name": "New", "neu_titel": "New Arrivals: Pre-Owned Designer & Vintage | Disorder119",
        "neu_h1": "New in the Archive – Designer Vintage & Pre-Owned",
        "neu_text": "The {n} latest pieces in the Disorder119 vintage archive{marken}. {preis}Every piece is a one-off: once it is "
                    "sold, it is gone. Shipping with DHL from Germany.",
        "neu_desc": "The {n} latest pre-owned designer pieces{marken}. {preis}Each available only once.",
        "preis_name": "Under {grenze}", "preis_titel": "Pre-Owned Designer Fashion under {grenze} | Disorder119",
        "preis_h1": "Designer Fashion under {grenze} – Vintage & Pre-Owned",
        "preis_text": "{n} pre-owned designer pieces under {grenze}{marken}. {preis}All pieces are one-offs from the Disorder119 "
                      "vintage archive, photographed individually and available only once. Shipping with DHL from Germany.",
        "preis_desc": "{n} pre-owned designer pieces under {grenze}{marken}. Vintage one-offs, each available only once.",
        "vas_name": "Vintage Archive Shop", "vas_titel": "Archive Fashion: Vintage Archive Shop | Disorder119",
        "vas_h1": "Archive Fashion – Vintage Archive Shop for Pre-Owned Designer Pieces",
        "vas_text": "Disorder119 is a vintage archive shop for archive fashion: a curated archive of pre-owned designer pieces{marken}. {n} pieces are "
                    "currently available. {preis}Every piece is selected, photographed and described individually and exists only "
                    "once. Shipping with DHL from Germany.",
        "vas_desc": "Vintage archive shop for pre-owned designer fashion{marken}. {n} one-offs, {preis}each available only once.",
        "trust": ["Each piece available only once", "14-day right of withdrawal", "PayPal & Apple Pay"],
        "trust_versand": "Free shipping from {betrag} within Germany",
        "verkauft_h2": "Recently sold", "mehr_h2": "Discover more",
    },
    "fr": {
        "mk_titel": "{gruppe} {brand} seconde main & vintage | Disorder119", "mk_titel_kurz": "{gruppe} {brand} seconde main | Disorder119",
        "mk_h1": "{gruppe} {brand} – Seconde Main & Vintage",
        "mk_text": "L’archive vintage Disorder119 propose actuellement {n} {gruppe} {brand}. {preis}{groessen}Chaque pièce est une "
                   "pièce unique de seconde main, photographiée individuellement et disponible une seule fois. Expédition par DHL depuis l’Allemagne.",
        "mk_desc": "{n} {gruppe} {brand} de seconde main. {preis}Pièces vintage uniques.",
        "neu_name": "Nouveautés", "neu_titel": "Nouveautés : mode de créateurs seconde main | Disorder119",
        "neu_h1": "Nouveautés de l’archive – Vintage & Seconde Main",
        "neu_text": "Les {n} dernières pièces de l’archive vintage Disorder119{marken}. {preis}Chaque pièce est unique : une fois "
                    "vendue, elle ne revient pas. Expédition par DHL depuis l’Allemagne.",
        "neu_desc": "Les {n} dernières pièces de créateurs de seconde main{marken}. {preis}Chaque pièce est unique.",
        "preis_name": "Moins de {grenze}", "preis_titel": "Mode de créateurs seconde main à moins de {grenze} | Disorder119",
        "preis_h1": "Mode de créateurs à moins de {grenze} – Vintage & Seconde Main",
        "preis_text": "{n} pièces de créateurs de seconde main à moins de {grenze}{marken}. {preis}Toutes sont des pièces uniques de "
                      "l’archive vintage Disorder119, photographiées individuellement. Expédition par DHL depuis l’Allemagne.",
        "preis_desc": "{n} pièces de créateurs de seconde main à moins de {grenze}{marken}. Pièces vintage uniques.",
        "vas_name": "Vintage Archive Shop", "vas_titel": "Vintage Archive Shop : mode de créateurs | Disorder119",
        "vas_h1": "Vintage Archive Shop – Mode de créateurs de seconde main",
        "vas_text": "Disorder119 est un vintage archive shop : une archive sélectionnée de mode de créateurs de seconde main{marken}. "
                    "{n} pièces sont actuellement disponibles. {preis}Chaque pièce est choisie, photographiée et décrite "
                    "individuellement et n’existe qu’une fois. Expédition par DHL depuis l’Allemagne.",
        "vas_desc": "Vintage archive shop de mode de créateurs de seconde main{marken}. {n} pièces uniques, {preis}disponibles une seule fois.",
        "trust": ["Chaque pièce disponible une seule fois", "Droit de rétractation de 14 jours", "PayPal & Apple Pay"],
        "trust_versand": "Livraison gratuite dès {betrag} en Allemagne",
        "verkauft_h2": "Vendu récemment", "mehr_h2": "À découvrir",
    },
}

# Themenseiten /designer/<slug>/: Produkttyp, Farbe + Produktart, Material - nur aus gepflegten Daten.
THEMA_WURZEL = "designer/"
# product_type -> (slug, de, en, fr)
TYPEN = {
    "Sneakers": ("sneaker", "Designer Sneaker", "Designer Sneakers", "Sneakers de créateurs"),
    "Boots": ("stiefel", "Designer Stiefel & Boots", "Designer Boots", "Bottes de créateurs"),
    "Blazer": ("blazer", "Designer Blazer", "Designer Blazers", "Blazers de créateurs"),
    "Vest": ("westen", "Designer Westen", "Designer Vests", "Gilets de créateurs"),
    "Polo Shirt": ("poloshirts", "Designer Poloshirts", "Designer Polo Shirts", "Polos de créateurs"),
    "T-Shirt": ("t-shirts", "Designer T-Shirts", "Designer T-Shirts", "T-shirts de créateurs"),
    "Long Sleeve": ("longsleeves", "Designer Longsleeves", "Designer Long Sleeves", "Hauts à manches longues de créateurs"),
    "Cardigan": ("cardigans", "Designer Cardigans", "Designer Cardigans", "Cardigans de créateurs"),
    "Sweatshirt": ("sweatshirts", "Designer Sweatshirts", "Designer Sweatshirts", "Sweatshirts de créateurs"),
    "Biker Jacket": ("bikerjacken", "Designer Bikerjacken", "Designer Biker Jackets", "Blousons motard de créateurs"),
    "Cap": ("caps", "Designer Caps", "Designer Caps", "Casquettes de créateurs"),
    "Bag": ("taschen", "Designer Taschen", "Designer Bags", "Sacs de créateurs"),
    "Coat": ("maentel", "Designer Mäntel", "Designer Coats", "Manteaux de créateurs"),
    "Shorts": ("shorts", "Designer Shorts", "Designer Shorts", "Shorts de créateurs"),
}
# Farbfamilie -> (Farbwerte aus dem Katalog, slug-Teil, de-Adjektiv, en, fr)
FARBEN = (
    (("Schwarz",), "schwarze", "Schwarze", "Black", "noir"),
    (("Braun",), "braune", "Braune", "Brown", "marron"),
    (("Grau",), "graue", "Graue", "Grey", "gris"),
    (("Blau", "Dunkelblau", "Marineblau", "Hellblau"), "blaue", "Blaue", "Blue", "bleu"),
    (("Grün",), "gruene", "Grüne", "Green", "vert"),
    (("Beige",), "beige", "Beige", "Beige", "beige"),
    (("Weiß",), "weisse", "Weiße", "White", "blanc"),
    (("Rot",), "rote", "Rote", "Red", "rouge"),
)
# Material: Wort im (deutschen) Artikeltitel bzw. Kategorie Strick -> (slug, de, en, fr)
MATERIAL = (
    (r"(?<!kunst)leder", None, "leder", "Designer Mode aus Leder", "Designer Leather Pieces", "Pièces de créateurs en cuir"),
    (r"nylon", None, "nylon", "Designer Mode aus Nylon", "Designer Nylon Pieces", "Pièces de créateurs en nylon"),
    (r"jeans|denim", None, "denim", "Designer Denim & Jeans", "Designer Denim", "Denim de créateurs"),
    (None, "Knitwear", "strick", "Designer Strick", "Designer Knitwear", "Maille de créateurs"),
)
THEMA_TEXT = {
    "de": {"titel": "{wort} Second Hand & Vintage | Disorder119", "titel_kurz": "{wort} Second Hand | Disorder119",
           "h1": "{wort} – Second Hand & Vintage",
           "text": "{wort}: aktuell {n} Teile im Vintage-Archiv von Disorder119{marken}. {preis}{groessen}Alle Teile sind "
                   "Second-Hand- und Vintage-Einzelstücke, werden einzeln fotografiert und sind jeweils nur einmal vorhanden. "
                   "Versand mit DHL aus Deutschland.",
           "desc": "{wort} aus zweiter Hand: {n} Teile{marken}. {preis}Vintage-Einzelstücke, jedes nur 1× verfügbar."},
    "en": {"titel": "{wort} Pre-Owned & Vintage | Disorder119", "titel_kurz": "{wort} Pre-Owned | Disorder119",
           "h1": "{wort} – Pre-Owned & Vintage",
           "text": "{wort}: {n} pieces currently in the Disorder119 vintage archive{marken}. {preis}{groessen}Every piece is a "
                   "pre-owned or vintage one-off, photographed individually and available only once. Shipping with DHL from Germany.",
           "desc": "Pre-owned {wort}: {n} pieces{marken}. {preis}Vintage one-offs, each available only once."},
    "fr": {"titel": "{wort} seconde main & vintage | Disorder119", "titel_kurz": "{wort} seconde main | Disorder119",
           "h1": "{wort} – Seconde Main & Vintage",
           "text": "{wort} : {n} pièces actuellement dans l’archive vintage Disorder119{marken}. {preis}{groessen}Chaque pièce est "
                   "une pièce unique de seconde main ou vintage, photographiée individuellement. Expédition par DHL depuis l’Allemagne.",
           "desc": "{wort} de seconde main : {n} pièces{marken}. {preis}Pièces vintage uniques."},
}

SEGMENTE = tuple(b["slug"] for b in BEREICHE)
GRUPPEN_SLUGS = tuple(g["slug"] for g in GRUPPEN)


# ------------------------------------------------------------------ Daten
def _kategorie(it):
    return it.get("taxonomy_category") or it.get("category") or ""


def seiten(b):
    """Alle Seiten: [{bereich, gruppe|None, seg, teile}] - Bereichsseite zuerst, dann ihre Kategorien."""
    liste = []
    for bereich in BEREICHE:
        im_bereich = sorted((it for it in b.ITEMS if ms._sichtbar(it, "AVAILABLE") and it.get("department") in bereich["abteilungen"]),
                            key=ms._helligkeit, reverse=True)
        if len(im_bereich) < MIN_TEILE:
            continue
        liste.append({"bereich": bereich["slug"], "gruppe": None, "seg": bereich["slug"] + "/", "teile": im_bereich})
        for gruppe in GRUPPEN:
            teile = [it for it in im_bereich if _kategorie(it) in gruppe["kategorien"]]
            if len(teile) >= MIN_TEILE:
                liste.append({"bereich": bereich["slug"], "gruppe": gruppe["slug"],
                              "seg": bereich["slug"] + "/" + gruppe["slug"] + "/", "teile": teile})
    return liste


def _kuerzen(vorlage, werte, marken, lang, grenze=None):
    """Meta-Beschreibung: so viele Marken nennen, wie in die Laenge passen."""
    t = TEXTE[lang]
    text = ""
    for anzahl in (3, 2, 1, 0):
        teil = t["desc_marken"].format(liste=ms._aufzaehlung(marken[:anzahl], lang)) if anzahl and marken else ""
        text = vorlage.format(marken=teil, **werte)
        if len(text) <= (grenze or ms.BESCHREIBUNG_MAX):
            break
    return text


def _artikelnummer(it):
    try:
        return int(str(it.get("article") or "0").strip())
    except ValueError:
        return 0


def _eigene_seite(b, seg, art, teile, bau):
    """Seite mit fertigen Texten je Sprache; ``bau(lang, seite)`` liefert titel, h1, text, desc, krumen."""
    seite = {"bereich": None, "gruppe": None, "seg": seg, "teile": teile, "art": art}
    seite["eigen"] = {lang: bau(lang, seite) for lang in b.LANGS}
    return seite


def extra_seiten(b):
    """Marke + Produktart, Neuzugaenge, Preisgrenzen und die Seite 'Vintage Archive Shop'."""
    liste = []
    verfuegbar = sorted((it for it in b.ITEMS if ms._sichtbar(it, "AVAILABLE")), key=ms._helligkeit, reverse=True)

    def marken_text(seite, lang):
        namen = _marken(seite)[:MARKEN_MAX]
        return TEXTE[lang]["marken"].format(liste=ms._aufzaehlung(namen, lang)) if namen else ""

    def preis_kurz(seite, lang):
        preise = ms._preise(seite)
        return ms.TEXTE[lang]["desc_preis"].format(min=ms._preis(preise[0], lang)) if preise else ""

    # --- "Vintage Archive Shop": das ganze Archiv unter dem Begriff, unter dem der Shop gefunden werden soll
    if len(verfuegbar) >= MIN_TEILE:
        def vas(lang, seite):
            e = EXTRA[lang]
            werte = {"n": len(seite["teile"]), "preis": preis_kurz(seite, lang)}
            return {"titel": e["vas_titel"], "h1": e["vas_h1"],
                    "text": e["vas_text"].format(marken=marken_text(seite, lang), n=len(seite["teile"]), preis=_preis_satz(seite, lang)),
                    "desc": _kuerzen(e["vas_desc"], werte, _marken(seite), lang),
                    "krumen": [(e["vas_name"], VAS_SEG)]}
        liste.append(_eigene_seite(b, VAS_SEG, "vas", verfuegbar, vas))

    # --- Neuzugaenge: hoechste Artikelnummern zuerst
    neueste = sorted(verfuegbar, key=_artikelnummer, reverse=True)[:NEU_MAX]
    if len(neueste) >= MIN_TEILE:
        def neu(lang, seite):
            e = EXTRA[lang]
            werte = {"n": len(seite["teile"]), "preis": preis_kurz(seite, lang)}
            return {"titel": e["neu_titel"], "h1": e["neu_h1"],
                    "text": e["neu_text"].format(marken=marken_text(seite, lang), n=len(seite["teile"]), preis=_preis_satz(seite, lang)),
                    "desc": _kuerzen(e["neu_desc"], werte, _marken(seite), lang),
                    "krumen": [(e["neu_name"], NEU_SEG)]}
        liste.append(_eigene_seite(b, NEU_SEG, "neu", neueste, neu))

    # --- Preisgrenzen
    for grenze in PREISGRENZEN:
        teile = sorted((it for it in verfuegbar if 0 < float(it.get("price") or 0) < grenze), key=lambda it: float(it["price"]))
        if len(teile) < MIN_TEILE:
            continue
        seg = f"unter-{grenze}/"

        def preis(lang, seite, grenze=grenze, seg=seg):
            e = EXTRA[lang]
            g = ms._preis(float(grenze), lang)
            werte = {"n": len(seite["teile"]), "grenze": g}
            return {"titel": e["preis_titel"].format(grenze=g), "h1": e["preis_h1"].format(grenze=g),
                    "text": e["preis_text"].format(marken=marken_text(seite, lang), n=len(seite["teile"]), grenze=g,
                                                   preis=_preis_satz(seite, lang)),
                    "desc": _kuerzen(e["preis_desc"], werte, _marken(seite), lang),
                    "krumen": [(e["preis_name"].format(grenze=g), seg)]}
        liste.append(_eigene_seite(b, seg, "preis", teile, preis))

    # --- Themenseiten: Produkttyp, Farbe + Produktart, Material
    def thema(slug, woerter, teile):
        if len(teile) < MIN_TEILE:
            return
        seg = THEMA_WURZEL + slug + "/"

        def bau(lang, seite, woerter=woerter, seg=seg):
            tt, wort = THEMA_TEXT[lang], woerter[lang]
            titel = tt["titel"].format(wort=wort)
            if len(titel) > ms.TITEL_MAX:
                titel = tt["titel_kurz"].format(wort=wort)
            werte = {"wort": wort, "n": len(seite["teile"]), "preis": preis_kurz(seite, lang)}
            return {"titel": titel, "h1": tt["h1"].format(wort=wort),
                    "text": tt["text"].format(wort=wort, n=len(seite["teile"]), marken=marken_text(seite, lang),
                                              preis=_preis_satz(seite, lang), groessen=_groessen_satz(b, seite, lang)),
                    "desc": _kuerzen(tt["desc"], werte, _marken(seite), lang),
                    "krumen": [(wort, seg)]}
        liste.append(_eigene_seite(b, seg, "thema", teile, bau))

    for typ, (slug, de, en, fr) in TYPEN.items():
        thema(slug, {"de": de, "en": en, "fr": fr}, [it for it in verfuegbar if it.get("product_type") == typ])
    for werte, slug_teil, de_adj, en_adj, fr_adj in FARBEN:
        in_farbe = [it for it in verfuegbar if str(it.get("color") or "").split(",")[0].strip() in werte]
        for gruppe in GRUPPEN:
            teile = [it for it in in_farbe if _kategorie(it) in gruppe["kategorien"]]
            thema(slug_teil + "-" + gruppe["slug"],
                  {"de": de_adj + " Designer " + TEXTE["de"]["gruppe"][gruppe["slug"]],
                   "en": en_adj + " Designer " + TEXTE["en"]["gruppe"][gruppe["slug"]],
                   "fr": TEXTE["fr"]["gruppe"][gruppe["slug"]] + " de créateurs en " + fr_adj}, teile)
    for muster, kategorie, slug, de, en, fr in MATERIAL:
        if muster:
            teile = [it for it in verfuegbar if re.search(muster, str(it.get("title") or "").casefold())]
        else:
            teile = [it for it in verfuegbar if _kategorie(it) == kategorie]
        thema(slug, {"de": de, "en": en, "fr": fr}, teile)

    # --- Marke + Produktart ("Prada Jacken Second Hand")
    for marke in ms.marken(b):
        for gruppe in GRUPPEN:
            teile = [it for it in marke["teile"] if _kategorie(it) in gruppe["kategorien"]]
            if len(teile) < MIN_TEILE:
                continue
            seg = ms.segment(marke) + gruppe["slug"] + "/"

            def mk(lang, seite, marke=marke, gruppe=gruppe, seg=seg):
                e = EXTRA[lang]
                name = TEXTE[lang]["gruppe"][gruppe["slug"]]
                titel = e["mk_titel"].format(brand=marke["brand"], gruppe=name)
                if len(titel) > ms.TITEL_MAX:
                    titel = e["mk_titel_kurz"].format(brand=marke["brand"], gruppe=name)
                return {"titel": titel, "h1": e["mk_h1"].format(brand=marke["brand"], gruppe=name),
                        "text": e["mk_text"].format(n=len(seite["teile"]), brand=marke["brand"], gruppe=name,
                                                    preis=_preis_satz(seite, lang), groessen=_groessen_satz(b, seite, lang)),
                        "desc": e["mk_desc"].format(n=len(seite["teile"]), brand=marke["brand"], gruppe=name, preis=preis_kurz(seite, lang)),
                        "krumen": [(ms.TEXTE[lang]["marken"], ms.UEBERSICHT_SEGMENT), (marke["brand"], ms.segment(marke)), (name, seg)]}
            seite = _eigene_seite(b, seg, "marke_kat", teile, mk)
            seite["marke"], seite["gruppe_slug"] = marke["slug"], gruppe["slug"]
            liste.append(seite)
    return liste


def alle_seiten(b):
    return seiten(b) + extra_seiten(b)


def marken_kategorien(b, marke, lang):
    """Links der Markenseite zu ihren Produktart-Seiten: [(Name, Pfad, Anzahl)]."""
    home = b.lang_home(lang)
    return [(TEXTE[lang]["gruppe"][s["gruppe_slug"]], home + s["seg"], len(s["teile"]))
            for s in extra_seiten(b) if s["art"] == "marke_kat" and s["marke"] == marke["slug"]]


def sitemap_segmente(b):
    return [s["seg"] for s in alle_seiten(b)]


def _marken(seite):
    zahl = {}
    for it in seite["teile"]:
        marke = str(it.get("brand") or "").strip()
        if marke:
            zahl[marke] = zahl.get(marke, 0) + 1
    return [m for m, _ in sorted(zahl.items(), key=lambda kv: (-kv[1], kv[0].casefold()))]


def _preis_satz(seite, lang):
    t = ms.TEXTE[lang]
    preise = ms._preise(seite)
    if not preise:
        return ""
    if preise[0] == preise[-1]:
        return t["preis_einer"].format(min=ms._preis(preise[0], lang))
    return t["preis_spanne"].format(min=ms._preis(preise[0], lang), max=ms._preis(preise[-1], lang))


def _groessen_satz(b, seite, lang):
    t = ms.TEXTE[lang]
    zahl = {}
    for it in seite["teile"]:
        groesse = re.sub(r"\s*\(.*?\)", "", ms._groesse(b, it, lang)).strip()
        if groesse:
            zahl[groesse] = zahl.get(groesse, 0) + 1
    haeufig = [g for g, _ in sorted(zahl.items(), key=lambda kv: (-kv[1], kv[0]))]
    if not haeufig:
        return ""
    vorlage = t["groessen_alle"] if len(haeufig) <= ms.GROESSEN_MAX else t["groessen_auswahl"]
    return vorlage.format(sizes=ms._aufzaehlung(haeufig[:ms.GROESSEN_MAX], lang))


def _namen(seite, lang):
    t = TEXTE[lang]
    bereich = t["bereich"][seite["bereich"]]
    gruppe = t["gruppe"][seite["gruppe"]] if seite["gruppe"] else ""
    return bereich, gruppe


def seitentitel(seite, lang):
    if seite.get("eigen"):
        return seite["eigen"][lang]["titel"]
    t = TEXTE[lang]
    bereich, gruppe = _namen(seite, lang)
    if not seite["gruppe"]:
        return t["hub_titel"].format(bereich=bereich)
    titel = t["titel"].format(gruppe=gruppe, bereich=bereich)
    if len(titel) > ms.TITEL_MAX:
        titel = t["titel_kurz"].format(gruppe=gruppe, bereich=bereich)
    return titel


def ueberschrift(seite, lang):
    if seite.get("eigen"):
        return seite["eigen"][lang]["h1"]
    t = TEXTE[lang]
    bereich, gruppe = _namen(seite, lang)
    return t["h1"].format(gruppe=gruppe, bereich=bereich) if seite["gruppe"] else t["hub_h1"].format(bereich=bereich)


def absatz(b, seite, lang):
    if seite.get("eigen"):
        return seite["eigen"][lang]["text"]
    t = TEXTE[lang]
    bereich, gruppe = _namen(seite, lang)
    marken = _marken(seite)[:MARKEN_MAX]
    marken_text = t["marken"].format(liste=ms._aufzaehlung(marken, lang)) if marken else ""
    preis = _preis_satz(seite, lang)
    if not seite["gruppe"]:
        return t["hub_text"].format(n=len(seite["teile"]), bereich=bereich, marken=marken_text, preis=preis)
    return t["text"].format(n=len(seite["teile"]), gruppe=gruppe, bereich=bereich, marken=marken_text, preis=preis,
                            groessen=_groessen_satz(b, seite, lang))


def meta_beschreibung(seite, lang):
    if seite.get("eigen"):
        return seite["eigen"][lang]["desc"]
    t = TEXTE[lang]
    bereich, gruppe = _namen(seite, lang)
    preise = ms._preise(seite)
    preis = ms.TEXTE[lang]["desc_preis"].format(min=ms._preis(preise[0], lang)) if preise else ""
    alle = _marken(seite)
    text = ""
    for anzahl in (3, 2, 1, 0):
        marken = t["desc_marken"].format(liste=ms._aufzaehlung(alle[:anzahl], lang)) if anzahl and alle else ""
        vorlage = t["desc"] if seite["gruppe"] else t["hub_desc"]
        text = vorlage.format(n=len(seite["teile"]), gruppe=gruppe, bereich=bereich, marken=marken, preis=preis)
        if len(text) <= ms.BESCHREIBUNG_MAX:
            break
    return text


# ------------------------------------------------------------------ HTML
def _krumen(b, seite, lang):
    t = ms.TEXTE[lang]
    home = b.lang_home(lang)
    if seite.get("eigen"):
        eintraege = [(t["archiv"], home)] + [(name, home + pfad) for name, pfad in seite["eigen"][lang]["krumen"]]
    else:
        bereich, gruppe = _namen(seite, lang)
        eintraege = [(t["archiv"], home), (bereich, home + seite["bereich"] + "/")]
        if seite["gruppe"]:
            eintraege.append((gruppe, home + seite["seg"]))
    teile = []
    for i, (name, pfad) in enumerate(eintraege):
        if i == len(eintraege) - 1:
            teile.append(f'<li><span aria-current="page">{b.esc(name)}</span></li>')
        else:
            teile.append(f'<li><a href="{b.esc(pfad)}">{b.esc(name)}</a></li>')
    sichtbar = f'<nav aria-label="{b.esc(t["pfad"])}"><ol class="mk-crumbs">{"".join(teile)}</ol></nav>'
    daten = {
        "@context": "https://schema.org", "@type": "BreadcrumbList",
        "itemListElement": [{"@type": "ListItem", "position": i + 1, "name": name, "item": ms._absolut(b, pfad)}
                            for i, (name, pfad) in enumerate(eintraege)],
    }
    return sichtbar, daten


VERKAUFT_MAX = 8
MEHR_THEMEN_MAX = 18


def vertrauen_html(b, lang):
    """Leise Kaufgruende unter dem Text: nur Tatsachen (Einzelstueck, Widerruf, Zahlarten, Versandgrenze)."""
    e = EXTRA[lang]
    punkte = list(e["trust"])
    grenze = b.versandkostenfrei_ab_cents() if hasattr(b, "versandkostenfrei_ab_cents") else None
    if grenze:
        punkte.insert(1, e["trust_versand"].format(betrag=ms._preis(grenze / 100, lang)))
    return '<ul class="mk-trust">' + "".join(f"<li>{b.esc(p)}</li>" for p in punkte) + "</ul>"


def _links(b, eintraege):
    return "".join(f'<li><a href="{b.esc(pfad)}">{b.esc(name)}<small>{n}</small></a></li>' for name, pfad, n in eintraege)


def seite_html(b, seite, lang, alle, shop_config):
    t, mt = TEXTE[lang], ms.TEXTE[lang]
    home = b.lang_home(lang)
    titel = seitentitel(seite, lang)
    beschreibung = meta_beschreibung(seite, lang)
    canonical = ms._absolut(b, home + seite["seg"])
    krumen, krumen_daten = _krumen(b, seite, lang)
    kacheln = "".join(ms.kachel_html(b, it, lang, i) for i, it in enumerate(seite["teile"]))
    teile_html = [
        krumen,
        f'<h1 class="mk-title">{b.esc(ueberschrift(seite, lang))}</h1>',
        f'<p class="mk-count">{b.esc(mt["zahl"].format(n=len(seite["teile"])))}</p>',
        f'<div class="mk-text"><p>{b.esc(absatz(b, seite, lang))}</p></div>',
        vertrauen_html(b, lang),
    ]
    eigen = bool(seite.get("eigen"))
    basis = [s for s in alle if not s.get("eigen")]
    # Kategorien desselben Bereichs (auf der Bereichsseite ueber den Kacheln, sonst darunter).
    geschwister = [] if eigen else [s for s in basis if s["bereich"] == seite["bereich"] and s["gruppe"] and s["seg"] != seite["seg"]]
    kat_links = _links(b, [(t["gruppe"][s["gruppe"]], home + s["seg"], len(s["teile"])) for s in geschwister])
    if not seite["gruppe"] and kat_links:
        teile_html.append(f'<h2 class="mk-h2">{b.esc(t["kat_h2"])}</h2><ul class="mk-links">{kat_links}</ul>')
    teile_html.append(f'<ul class="mk-grid">{kacheln}</ul>')
    if seite["gruppe"] and kat_links:
        bereich_seite = next((s for s in alle if s["bereich"] == seite["bereich"] and not s["gruppe"]), None)
        if bereich_seite:
            kat_links += _links(b, [(t["bereich"][seite["bereich"]], home + bereich_seite["seg"], len(bereich_seite["teile"]))])
        teile_html.append(f'<h2 class="mk-h2">{b.esc(t["kat_h2"])}</h2><ul class="mk-links">{kat_links}</ul>')
    # Dieselbe Auswahl im anderen Bereich.
    andere = basis if eigen else [s for s in basis if s["bereich"] != seite["bereich"] and s["gruppe"] == seite["gruppe"]]
    if eigen and seite["art"] == "marke_kat":
        # weitere Produktarten derselben Marke zuerst
        marke = next((m for m in ms.marken(b) if m["slug"] == seite["marke"]), None)
        if marke:
            weitere = [(name, pfad, n) for name, pfad, n in marken_kategorien(b, marke, lang) if pfad != home + seite["seg"]]
            weitere.append((marke["brand"], home + ms.segment(marke), len(marke["teile"])))
            teile_html.append(f'<h2 class="mk-h2">{b.esc(marke["brand"])}</h2><ul class="mk-links">{_links(b, weitere)}</ul>')
    # Verkaufte Teile derselben Auswahl: zeigt, dass Einzelstuecke wirklich weggehen.
    if not eigen and seite["gruppe"]:
        gruppe_def = next(g for g in GRUPPEN if g["slug"] == seite["gruppe"])
        bereich_def = next(x for x in BEREICHE if x["slug"] == seite["bereich"])
        verkauft = sorted((it for it in b.ITEMS if ms._sichtbar(it, "SOLD") and it.get("department") in bereich_def["abteilungen"]
                           and _kategorie(it) in gruppe_def["kategorien"]), key=_artikelnummer, reverse=True)[:VERKAUFT_MAX]
        if verkauft:
            teile_html.append(f'<h2 class="mk-h2">{b.esc(EXTRA[lang]["verkauft_h2"])}</h2>')
            teile_html.append('<ul class="mk-grid mk-grid--sold">' + "".join(ms.verkauft_html(b, it, lang) for it in verkauft) + "</ul>")
    if andere:
        eintraege = []
        for s in andere:
            bereich, gruppe = _namen(s, lang)
            eintraege.append(((gruppe + " " + bereich).strip(), home + s["seg"], len(s["teile"])))
        teile_html.append(f'<h2 class="mk-h2">{b.esc(t["andere_h2"])}</h2><ul class="mk-links">{_links(b, eintraege)}</ul>')
    # Markenseiten der Marken dieser Auswahl.
    mit_seite = {m["brand"]: m for m in ms.marken(b)}
    marken_links = [(name, home + ms.segment(mit_seite[name]), sum(1 for it in seite["teile"] if str(it.get("brand") or "").strip() == name))
                    for name in _marken(seite) if name in mit_seite]
    if marken_links:
        teile_html.append(f'<h2 class="mk-h2">{b.esc(t["marken_h2"])}</h2><ul class="mk-links">{_links(b, marken_links)}'
                          f'<li><a href="{home}{ms.UEBERSICHT_SEGMENT}">{b.esc(mt["alle_marken"])}</a></li></ul>')
    # Neuzugaenge, Preisseiten und "Vintage Archive Shop" - untereinander verlinkt.
    mehr = [(s["eigen"][lang]["krumen"][-1][0], home + s["seg"], len(s["teile"]))
            for s in alle if s.get("eigen") and s["art"] != "marke_kat" and s["seg"] != seite["seg"]]
    fest = [m for m, s in zip(mehr, [s for s in alle if s.get("eigen") and s["art"] != "marke_kat" and s["seg"] != seite["seg"]])
            if s["art"] != "thema"]
    themen = sorted((m for m in mehr if m not in fest), key=lambda m: -m[2])[:MEHR_THEMEN_MAX]
    mehr = fest + themen
    if mehr:
        teile_html.append(f'<h2 class="mk-h2">{b.esc(EXTRA[lang]["mehr_h2"])}</h2><ul class="mk-links">{_links(b, mehr)}</ul>')
    sammlung = {
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        "@id": canonical + "#webpage",
        "url": canonical,
        "name": titel,
        "description": beschreibung,
        "inLanguage": lang,
        "isPartOf": {"@id": b.SITE_URL + "#website"},
        "publisher": {"@id": b.SITE_URL + "#store"},
        "mainEntity": {
            "@type": "ItemList",
            "name": ueberschrift(seite, lang),
            "numberOfItems": len(seite["teile"]),
            "itemListElement": [
                {"@type": "ListItem", "position": i + 1, "url": ms._absolut(b, ms._artikel_pfad(b, it, lang)),
                 "name": b.display_name(it, lang),
                 **({"image": b.SITE_URL + it["gallery"][0]} if it.get("gallery") else {})}
                for i, it in enumerate(seite["teile"])
            ],
        },
    }
    return ms._seite(b, lang, seite["seg"], titel, beschreibung, ms._erstes_bild(b, seite["teile"]),
                     [sammlung, krumen_daten], "\n".join(teile_html), shop_config)


# ------------------------------------------------------------------ Bau
def build(b):
    """Schreibt alle Kategorieseiten; entfernt Seiten, die unter MIN_TEILE gefallen sind."""
    alle = alle_seiten(b)
    shop_config = b.get_shop_config()
    gueltig = {s["seg"].rstrip("/") for s in alle}
    geschrieben = 0
    for lang in b.LANGS:
        for name in EINZEL_SEGMENTE:
            ordner = ms._ordner(b, lang, name + "/")
            if name not in gueltig and ordner.is_dir():
                shutil.rmtree(ordner)
        thema_wurzel = ms._ordner(b, lang, THEMA_WURZEL)
        if thema_wurzel.is_dir():
            for alt in thema_wurzel.iterdir():
                if alt.is_dir() and (THEMA_WURZEL + alt.name) not in gueltig:
                    shutil.rmtree(alt)
        marken_wurzel = ms._ordner(b, lang, "marke/")
        if marken_wurzel.is_dir():
            for marke_ordner in marken_wurzel.iterdir():
                for alt in (marke_ordner.iterdir() if marke_ordner.is_dir() else ()):
                    if alt.is_dir() and alt.name in GRUPPEN_SLUGS and ("marke/" + marke_ordner.name + "/" + alt.name) not in gueltig:
                        shutil.rmtree(alt)
        for bereich in BEREICHE:
            wurzel = ms._ordner(b, lang, bereich["slug"] + "/")
            if not wurzel.is_dir():
                continue
            for alt in wurzel.iterdir():
                if alt.is_dir() and alt.name in GRUPPEN_SLUGS and (bereich["slug"] + "/" + alt.name) not in gueltig:
                    shutil.rmtree(alt)
            if bereich["slug"] not in gueltig:
                (wurzel / "index.html").unlink(missing_ok=True)
        for s in alle:
            ziel = ms._ordner(b, lang, s["seg"])
            ziel.mkdir(parents=True, exist_ok=True)
            (ziel / "index.html").write_text(seite_html(b, s, lang, alle, shop_config), encoding="utf-8")
            geschrieben += 1
    print(f"{geschrieben} Kategorieseiten geschrieben ({len(alle)} Seiten x {len(b.LANGS)} Sprachen).")
    return alle


def fusslinks(b, lang):
    """Links zu den Bereichsseiten fuer die Fusszeile: [(Text, Pfad)]."""
    home = b.lang_home(lang)
    links = [(TEXTE[lang]["bereich"][s["bereich"]], home + s["seg"]) for s in seiten(b) if not s["gruppe"]]
    for s in extra_seiten(b):
        if s["art"] in ("neu", "vas"):
            links.append((s["eigen"][lang]["krumen"][-1][0], home + s["seg"]))
    return links


def llms_zeilen(b):
    alle = alle_seiten(b)
    if not alle:
        return []
    site = b.SITE_URL.rstrip("/")
    zeilen = ["", f"## Kategorien ({len(alle)})"]
    for s in alle:
        zeilen.append(f"- [{ueberschrift(s, 'de')}]({site}/{s['seg']}): {len(s['teile'])} Teile verfügbar")
    return zeilen

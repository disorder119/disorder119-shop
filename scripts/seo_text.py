"""Suchmaschinentexte fuer Produktseiten - an genau einer Stelle definiert.

Wird von build_site.py (Seitenaufbau, Sitemap) und von
scripts/repair_public_article_integrity.py (setzt die Meta-Beschreibung nach
dem Bauen erneut) gemeinsam genutzt. Zwei getrennte Kopien sind hier schon
einmal auseinandergelaufen: das Reparaturskript hat die Aenderung am
Generator stillschweigend ueberschrieben.

Anlass (Stichprobe 2026-09-16, Suche ohne Personalisierung):
* "Kiko Kostadinov Weste" -> disorder119.com auf Platz 1 - der Titel enthaelt
  die Produktart.
* "Balmain Furry Jacke" -> nicht auf Seite 1, obwohl die Seite indexiert ist.
  Der Titel lautete nur "Balmain Furry | Disorder119": ohne Produktart.
* Die Meta-Beschreibung war fuer alle Artikel dieselbe Schablone, obwohl zu
  vielen eine ausfuehrliche Beschreibung vorliegt.
"""
from __future__ import annotations

import re

TITLE_SUFFIX = " | Disorder119"
TITLE_MAX = 60          # darueber kuerzt Google den Titel in der Trefferliste
DESCRIPTION_MAX = 160   # dito fuer die Beschreibung

# Produktart im Singular. Schluessel sind die Werte aus product_type.
TYPE_TR = {
    "Accessory": ("Accessoire", "Accessory", "Accessoire"),
    "Backpack": ("Rucksack", "Backpack", "Sac à dos"),
    "Bag": ("Tasche", "Bag", "Sac"),
    "Beanie": ("Mütze", "Beanie", "Bonnet"),
    "Belt": ("Gürtel", "Belt", "Ceinture"),
    "Biker Jacket": ("Bikerjacke", "Biker Jacket", "Perfecto"),
    "Blazer": ("Blazer", "Blazer", "Blazer"),
    "Blouse": ("Bluse", "Blouse", "Chemisier"),
    "Bomber Jacket": ("Bomberjacke", "Bomber Jacket", "Blouson aviateur"),
    "Boots": ("Stiefel", "Boots", "Bottes"),
    "Cap": ("Cap", "Cap", "Casquette"),
    "Cardigan": ("Cardigan", "Cardigan", "Cardigan"),
    "Coat": ("Mantel", "Coat", "Manteau"),
    "Design Object": ("Designobjekt", "Design Object", "Objet design"),
    "Dress": ("Kleid", "Dress", "Robe"),
    "Hat": ("Hut", "Hat", "Chapeau"),
    "Heels": ("Pumps", "Heels", "Escarpins"),
    "Jacket": ("Jacke", "Jacket", "Veste"),
    "Joggers": ("Jogginghose", "Joggers", "Jogging"),
    "Knit Top": ("Strickoberteil", "Knit Top", "Haut en maille"),
    "Loafers": ("Loafer", "Loafers", "Mocassins"),
    "Long Sleeve": ("Longsleeve", "Long Sleeve", "T-shirt manches longues"),
    "Polo Shirt": ("Poloshirt", "Polo Shirt", "Polo"),
    "Sandals": ("Sandalen", "Sandals", "Sandales"),
    "Scarf": ("Schal", "Scarf", "Écharpe"),
    "Set": ("Set", "Set", "Ensemble"),
    "Shirt": ("Hemd", "Shirt", "Chemise"),
    "Shoes": ("Schuhe", "Shoes", "Chaussures"),
    "Shorts": ("Shorts", "Shorts", "Short"),
    "Skirt": ("Rock", "Skirt", "Jupe"),
    "Sleepwear": ("Nachtwäsche", "Sleepwear", "Vêtement de nuit"),
    "Sneakers": ("Sneaker", "Sneakers", "Baskets"),
    "Suit": ("Anzug", "Suit", "Costume"),
    "Sunglasses": ("Sonnenbrille", "Sunglasses", "Lunettes de soleil"),
    "Sweater": ("Pullover", "Sweater", "Pull"),
    "Sweatshirt": ("Sweatshirt", "Sweatshirt", "Sweat-shirt"),
    "Swim Shorts": ("Badeshorts", "Swim Shorts", "Short de bain"),
    "T-Shirt": ("T-Shirt", "T-Shirt", "T-shirt"),
    "Tank Top": ("Tanktop", "Tank Top", "Débardeur"),
    "Toaster": ("Toaster", "Toaster", "Grille-pain"),
    "Top": ("Top", "Top", "Haut"),
    "Trench Coat": ("Trenchcoat", "Trench Coat", "Trench"),
    "Trousers": ("Hose", "Trousers", "Pantalon"),
    "Tunic": ("Tunika", "Tunic", "Tunique"),
    "Underwear Shorts": ("Unterhose", "Underwear Shorts", "Caleçon"),
    "Vest": ("Weste", "Vest", "Gilet"),
    "Wallet": ("Geldbörse", "Wallet", "Portefeuille"),
}
# Weitere Woerter, die dieselbe Produktart bereits benennen. Ohne sie wuerde
# aus "Marbled Blue Denim Jeans" ein "... Jeans Hose".
TYPE_SYNONYMS = {
    "Trousers": ("Jeans", "Pants", "Hose", "Chino", "Denim"),
    "Joggers": ("Jogger", "Trackpants", "Sweatpants"),
    "Jacket": ("Blouson", "Parka", "Windbreaker", "Anorak", "Bomber"),
    "Biker Jacket": ("Biker", "Lederjacke", "Leather Jacket"),
    "Bomber Jacket": ("Bomber",),
    "Coat": ("Mantel", "Parka"),
    "Trench Coat": ("Trench",),
    "Sneakers": ("Sneaker", "Trainer"),
    "Boots": ("Boot", "Stiefelette", "Chelsea"),
    "Shoes": ("Schuh", "Loafer", "Derby", "Oxford"),
    "Top": ("Shirt", "Oberteil"),
    "Knit Top": ("Strick", "Knit"),
    "Sweater": ("Pulli", "Knit", "Strick"),
    "Vest": ("Weste", "Gilet"),
    "Bag": ("Bag", "Tasche", "Clutch", "Tote"),
}
_LANG_INDEX = {"de": 0, "en": 1, "fr": 2}
SIZE_WORD = {"de": "Gr.", "en": "Size", "fr": "Taille"}

# Einleitungssaetze, die in fast jeder Beschreibung stehen und nichts ueber
# das Stueck aussagen.
_BOILERPLATE = re.compile(
    r"\s*(Aus dem kuratierten (Second-Hand-)?Archiv von Disorder119\.?"
    r"|From the curated (second-hand )?archive of Disorder119\.?"
    r"|Issu (des archives sélectionnées|de l'archive (seconde main )?sélectionnée) de Disorder119\.?)\s*",
    re.I,
)
# Ab hier folgen Aufzaehlungen und Rechtstexte, keine Beschreibung mehr.
_SECTION_BREAK = re.compile(
    r"\n\s*(Details|Fotografie|Photography|Photographie|Zustand|Condition|État"
    r"|Rechtliche|Legal|Mentions|Maße|Measurements|Mesures)\b",
    re.I,
)


def _norm(text: str) -> str:
    return re.sub(r"[^a-z0-9äöüßéèêàâçôûîï]", "", (text or "").lower())


def type_label(product_type: str | None, lang: str) -> str:
    row = TYPE_TR.get(product_type or "")
    return row[_LANG_INDEX[lang]] if row else ""


def _type_already_named(name: str, product_type: str | None) -> bool:
    """Steht die Produktart schon im Namen - in irgendeiner Sprache?

    Viele Titel sind englisch ("Prada Light Blue Cropped Jacket"); ohne diese
    Pruefung entstuende "... Cropped Jacket Jacke". Verglichen wird ohne
    Leer- und Satzzeichen, damit auch Komposita wie "Knitterjacke" und
    Schreibweisen wie "Long Sleeve"/"Longsleeve" erkannt werden.
    """
    row = TYPE_TR.get(product_type or "")
    if not row:
        return True
    haystack = _norm(name)
    varianten = set(row) | {product_type or ""} | set(TYPE_SYNONYMS.get(product_type or "", ()))
    return any(_norm(v) and _norm(v) in haystack for v in varianten)


def seo_title(name: str, product_type: str | None, size_label: str, lang: str) -> str:
    """'Balmain Furry' -> 'Balmain Furry Jacke · Gr. S | Disorder119'.

    Die Groesse kommt nur dazu, wenn der Titel dann noch in die Trefferliste
    passt; ein langer Produktname wird nie gekuerzt.
    """
    basis = name.strip()
    if not _type_already_named(basis, product_type):
        basis = f"{basis} {type_label(product_type, lang)}".strip()
    if size_label:
        mit_groesse = f"{basis} · {SIZE_WORD[lang]} {size_label}"
        if len(mit_groesse) + len(TITLE_SUFFIX) <= TITLE_MAX:
            basis = mit_groesse
    return basis + TITLE_SUFFIX


def description_snippet(text: str | None, limit: int, name: str = "") -> str:
    """Erster aussagekraeftiger Satz der eigenen Beschreibung, hoechstens
    `limit` Zeichen, an einer Wortgrenze gekuerzt. Leer, wenn die Beschreibung
    ausser der Standardeinleitung nichts Eigenes enthaelt."""
    if not text or limit < 40:
        return ""
    rest = _BOILERPLATE.sub("\n", text.replace("\r\n", "\n"))
    rest = _SECTION_BREAK.split(rest, maxsplit=1)[0]
    # Manche Beschreibungen beginnen mit einer Ueberschriftszeile ohne
    # Satzzeichen ("Prada Lightweight Jacket Beige IT46") - die ist kein Satz.
    zeilen = [z.strip() for z in rest.split("\n") if z.strip()]
    while len(zeilen) > 1 and not re.search(r"[.!?]$", zeilen[0]):
        zeilen.pop(0)
    rest = re.sub(r"\s+", " ", " ".join(zeilen)).strip()
    if len(rest) < 40:
        return ""
    # "Hysteric Glamour Pop-Up Toaster von Hysteric Glamour." sagt nichts,
    # was nicht schon im Namen steht.
    if name and _norm(rest).startswith(_norm(name)) and len(rest) < len(name) + 40:
        return ""
    saetze = re.findall(r"[^.!?]+[.!?]", rest) or [rest]
    auszug = ""
    for satz in saetze:
        kandidat = (auszug + " " + satz.strip()).strip()
        if len(kandidat) > limit:
            break
        auszug = kandidat
    if not auszug:
        schnitt = rest[: limit - 1]
        auszug = schnitt[: schnitt.rfind(" ")].rstrip(",;:– ") + "…"
    return auszug


def compose_description(prefix: str, own_text: str | None, fallback_suffix: str,
                        name: str = "") -> str:
    """'<Name> – <Kategorie>, Größe S, Zustand Gut' plus eigener Auszug.

    Der Anfang bleibt bewusst unveraendert: scripts/validate_catalog_taxonomy.py
    verlangt, dass die Kategorie in der Beschreibung steht. Ersetzt wird nur
    der allgemeine Schlusssatz - und das nur, wenn es etwas Eigenes gibt.
    """
    platz = DESCRIPTION_MAX - len(prefix) - 2
    auszug = description_snippet(own_text, platz, name)
    if auszug:
        return f"{prefix}. {auszug}"
    return prefix + fallback_suffix

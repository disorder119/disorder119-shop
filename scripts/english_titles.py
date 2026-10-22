"""Englische Artikeltitel und Farben fuer den EN-Shop (/en/).

Die Titel in data/items.json folgen dem deutschen Schema
"Marke [Linie/Modell] Produktart [Merkmal] Damen|Herren|Unisex [Farbe]"
(siehe Katalog-Titelschema). Der englische Shop zeigte sie bisher
unveraendert - "Balmain Kunstfelljacke Damen", "Prada Loafer Herren
Rotbraun". Dieses Modul leitet beim Bauen einen englischen Titel ab:

1. Wort fuer Wort uebersetzen. Bekannt sind Marke und Modellnamen
   (unveraendert), deutsche Woerter aus WORTE/ADJEKTIVE und deutsche
   Zusammensetzungen aus VORSILBEN + ENDUNGEN ("Kunstfell" + "jacke"),
   auch mit Bindestrich ("Leder-Chelsea-Boots").
2. Bleibt auch nur ein Wort unbekannt, wird nichts geraten: Dann entsteht
   der Titel aus den gepflegten Feldern - Marke + Produktart (product_type,
   schon englisch) + Bereich + Farbe, z. B. "Prada Jacket Women Black".

So steht im EN-Shop nie ein halb deutscher Titel. Es gibt keine Titel je
Artikel; neue Woerter kommen in die Tabellen unten
(scripts/test_english_titles.py zeigt, welche Artikel den Rueckfall nehmen).
Genutzt von build_site.py (Seiten, catalog.json -> title_en) und
scripts/repair_public_article_integrity.py.
"""
from __future__ import annotations

import re

# Farben aus dem Farbfeld und dem Titelende (britisches Englisch wie
# "Colour" auf der Produktseite).
FARBEN = {
    "schwarz": "Black", "weiß": "White", "weiss": "White", "grau": "Grey",
    "braun": "Brown", "blau": "Blue", "beige": "Beige", "grün": "Green",
    "gruen": "Green", "bunt": "Multicolour", "mehrfarbig": "Multicolour",
    "marineblau": "Navy", "dunkelblau": "Dark Blue", "hellblau": "Light Blue",
    "khaki": "Khaki", "rot": "Red", "orange": "Orange", "rotbraun": "Reddish Brown",
    "creme": "Cream", "elfenbein": "Ivory", "silber": "Silver", "gold": "Gold",
    "rose": "Rose", "rosé": "Rosé", "rosa": "Pink", "pink": "Pink",
    "aprikose": "Apricot", "gelb": "Yellow", "flieder": "Lilac", "lila": "Purple",
    "violett": "Violet", "dunkelgrün": "Dark Green", "hellgrün": "Light Green",
    "neongrün": "Neon Green", "olivgrün": "Olive Green", "oliv": "Olive",
    "burgunderrot": "Burgundy", "bordeaux": "Burgundy", "dunkelrot": "Dark Red",
    "türkis": "Turquoise", "petrol": "Teal", "dunkelgrau": "Dark Grey",
    "hellgrau": "Light Grey", "anthrazit": "Charcoal", "dunkelbraun": "Dark Brown",
    "hellbraun": "Light Brown", "cognac": "Cognac", "camel": "Camel",
    "taupe": "Taupe", "sand": "Sand", "natur": "Natural", "transparent": "Clear",
    "kupfer": "Copper", "bronze": "Bronze", "metallic": "Metallic",
}

BEREICHE = {"damen": "Women", "herren": "Men", "unisex": "Unisex", "kinder": "Kids"}

# Ganze deutsche Woerter (klein geschrieben) -> Englisch.
WORTE = {
    # Bindewoerter
    "mit": "with", "aus": "in", "in": "in", "und": "and", "ohne": "without",
    # Produktarten
    "jacke": "Jacket", "kleid": "Dress", "hose": "Trousers", "rock": "Skirt",
    "mantel": "Coat", "weste": "Vest", "hemd": "Shirt", "bluse": "Blouse",
    "pullover": "Sweater", "pulli": "Sweater", "anzug": "Suit", "stiefel": "Boots",
    "stiefeletten": "Ankle Boots", "stiefelette": "Ankle Boots", "schuhe": "Shoes",
    "schuh": "Shoe", "sandalen": "Sandals", "sandaletten": "Sandals",
    "sneaker": "Sneakers", "loafer": "Loafers", "boots": "Boots", "pumps": "Pumps",
    "gürtel": "Belt", "tasche": "Bag", "rucksack": "Backpack", "geldbörse": "Wallet",
    "portemonnaie": "Wallet", "schal": "Scarf", "stola": "Stole", "hut": "Hat",
    "mütze": "Beanie", "sonnenbrille": "Sunglasses", "brille": "Glasses",
    "tunika": "Tunic", "unterhose": "Underwear", "badeshorts": "Swim Shorts",
    "jogginghose": "Joggers", "trenchcoat": "Trench Coat", "longsleeve": "Long Sleeve",
    "poloshirt": "Polo Shirt", "tanktop": "Tank Top", "strickjacke": "Cardigan",
    "schlafanzug": "Pyjamas", "badeanzug": "Swimsuit", "kette": "Necklace",
    "handschuhe": "Gloves", "socken": "Socks", "oberteil": "Top",
    # Merkmale
    "kragen": "Collar", "muster": "Pattern", "wolle": "Wool", "leder": "Leather",
    "seide": "Silk", "baumwolle": "Cotton", "nieten": "Studs", "riemen": "Straps",
    "schnalle": "Buckle", "bändern": "Ribbons", "bänder": "Ribbons",
    "rillensohle": "Lug Sole", "knitteroptik": "Crinkle Look",
    "perlenknöpfen": "Pearl Buttons", "knöpfen": "Buttons", "lederdetails": "Leather Details",
    "kapuze": "Hood", "fell": "Fur", "kunstfell": "Faux Fur", "felloptik": "Fur-Look",
    "streifen": "Stripes", "nadelstreifen": "Pinstripe", "barockmuster": "Baroque Pattern",
    "bügeln": "Temples", "bügel": "Temples", "logo": "Logo", "patch": "Patch",
    "strand": "Beach", "flügel": "Wing", "bienen": "Bee", "grafik": "Graphic",
    "cord": "Corduroy", "wildleder": "Suede", "langarm": "Long-Sleeve",
    "kurzarm": "Short-Sleeve", "klett": "Velcro", "plateau": "Platform",
    "wende": "Reversible", "denim": "Denim", "jeans": "Jeans", "zip": "Zip",
    "monogramm": "Monogram", "jeans-shorts": "Denim Shorts",
}

# Adjektive: Stamm -> Englisch; deklinierte Formen (-e/-er/-es/-en/-em)
# werden auf den Stamm zurueckgefuehrt.
ADJEKTIVE = {
    "asymmetrisch": "Asymmetric", "kurz": "Short", "lang": "Long", "gestreift": "Striped",
    "gepunktet": "Polka-Dot", "kariert": "Checked", "marmoriert": "Marbled",
    "meliert": "Melange", "drapiert": "Draped", "leicht": "Light", "gesteppt": "Quilted",
    "bestickt": "Embroidered", "bedruckt": "Printed", "gefüttert": "Lined",
    "transparent": "Sheer", "weit": "Wide", "schmal": "Slim", "klein": "Small",
    "groß": "Large", "gross": "Large", "warm": "Warm", "dick": "Thick",
}

# Zusammensetzungen ohne Bindestrich: Vorsilbe (mit Fugen-s/-en) + Endung.
ENDUNGEN = {
    "jacke": "Jacket", "kleid": "Dress", "rock": "Skirt", "hose": "Trousers",
    "mantel": "Coat", "weste": "Vest", "hemd": "Shirt", "bluse": "Blouse",
    "pullover": "Sweater", "top": "Top", "shirt": "Shirt", "gürtel": "Belt",
    "stiefel": "Boots", "schuhe": "Shoes", "tasche": "Bag", "mütze": "Beanie",
    "hut": "Hat", "kragen": "Collar", "stola": "Stole", "schal": "Scarf",
    "anzug": "Suit", "blazer": "Blazer", "sneaker": "Sneakers", "shorts": "Shorts",
    "sandalen": "Sandals", "boots": "Boots", "details": "Details", "jeans": "Jeans",
    "longsleeve": "Long Sleeve", "cardigan": "Cardigan", "set": "Set", "parka": "Parka",
}
VORSILBEN = {
    "leder": "Leather", "jeans": "Denim", "kunstfell": "Faux Fur", "fell": "Fur",
    "blumen": "Floral", "daunen": "Down", "fleece": "Fleece", "nylon": "Nylon",
    "kapuzen": "Hooded", "trainings": "Track", "winter": "Winter", "stepp": "Quilted",
    "sweat": "Sweat", "strick": "Knit", "seiden": "Silk", "woll": "Wool",
    "stroh": "Straw", "schwanen": "Swan", "monogramm": "Monogram", "maxi": "Maxi",
    "mini": "Mini", "ballon": "Balloon", "wende": "Reversible", "mantel": "Coat",
    "bomber": "Bomber", "biker": "Biker", "cargo": "Cargo", "anzug": "Suit",
    "funktions": "Technical", "streifen": "Striped", "kaschmir": "Cashmere",
    "perlen": "Pearl", "wildleder": "Suede", "schnür": "Lace-Up", "hemd": "Shirt",
    "lang": "Long", "kurz": "Short", "nadelstreifen": "Pinstripe", "regen": "Rain",
    "samt": "Velvet", "spitzen": "Lace", "satin": "Satin", "baumwoll": "Cotton",
    "zip": "Zip", "denim": "Denim", "cord": "Corduroy", "sommer": "Summer",
    "abend": "Evening", "hemdblusen": "Shirt", "tank": "Tank", "polo": "Polo",
    "mesh": "Mesh", "seide": "Silk", "military": "Military",
}

# Englische Woerter, Modell- und Linienbezeichnungen, die so bleiben. Klein
# geschrieben; die Schreibweise im Titel bleibt erhalten.
UNVERAENDERT = {
    "top", "t-shirt", "blazer", "cardigan", "sweatshirt", "cap", "beanie", "parka",
    "shorts", "set", "jeans", "mesh", "print", "sport", "oversized", "toaster",
    "pop-up", "flip-flops", "gore-tex", "high-top", "low-top", "half-zip", "cat-eye",
    "cloud-wash", "union", "jack", "hoodie", "slide", "walking", "lounge", "sample",
    "spider", "tattoo", "patchwork", "metallic", "military", "chelsea", "nylon",
    "fleece", "beachwear", "black", "label", "check", "classique", "soleil", "maille",
    "plume", "america's", "cup", "linea", "rossa", "luna", "kinetic", "youth",
    "challenge", "experience", "surf", "camp", "holy", "sweet", "angel", "bunny",
    "nova", "speedhunters", "sncf", "drkshdw", "originals", "yoyo", "collezioni",
    "rive", "gauche", "don't", "worry", "i", "love", "dior", "prada", "balmain",
    "pierre", "logo", "zip", "denim", "boots", "sneakers", "loafers", "pumps",
    "trench", "polo", "tank", "bomber", "biker", "cargo", "monogram", "rasta",
    "x", "vintage", "archive", "runway", "homme", "femme", "jersey", "tee",
}


def _schluessel(wort: str) -> str:
    return wort.strip().lower()


def farbe_en(farbe: str) -> str:
    """'Schwarz, Weiß' -> 'Black, White'; unbekannte Farben bleiben leer."""
    teile = []
    for teil in re.split(r"\s*,\s*", str(farbe or "").strip()):
        if not teil:
            continue
        uebersetzt = FARBEN.get(_schluessel(teil))
        if not uebersetzt:
            return ""
        teile.append(uebersetzt)
    return ", ".join(teile)


def _adjektiv(wort: str) -> str | None:
    w = _schluessel(wort)
    if w in ADJEKTIVE:
        return ADJEKTIVE[w]
    for endung in ("em", "en", "er", "es", "e"):
        stamm = w[: -len(endung)]
        if w.endswith(endung) and stamm in ADJEKTIVE:
            return ADJEKTIVE[stamm]
        if w.endswith(endung) and stamm in FARBEN:      # "schwarze Jacke"
            return FARBEN[stamm]
    return None


def _kompositum(wort: str, tiefe: int = 0) -> str | None:
    w = _schluessel(wort)
    if tiefe > 2:
        return None
    for endung in sorted(ENDUNGEN, key=len, reverse=True):
        if not w.endswith(endung) or len(w) - len(endung) < 3:
            continue
        vorne = w[: -len(endung)]
        vorne_en = VORSILBEN.get(vorne) or _einzelwort(vorne, tiefe + 1)
        if vorne_en:
            return vorne_en + " " + ENDUNGEN[endung]
    return None


def _einzelwort(wort: str, tiefe: int = 0) -> str | None:
    """Ein Wort ohne Bindestrich; None, wenn es unbekannt ist."""
    w = _schluessel(wort)
    if not w:
        return None
    if w in UNVERAENDERT:
        return wort
    for tabelle in (WORTE, BEREICHE, FARBEN):
        if w in tabelle:
            return tabelle[w]
    return _adjektiv(w) or _kompositum(w, tiefe)


def _wort(wort: str, marke: set[str]) -> str | None:
    """Ein Titelwort, auch mit Bindestrichen; None, wenn etwas unbekannt ist."""
    blank = re.sub(r"[^\w'’&.-]", "", wort, flags=re.UNICODE)
    if not re.search(r"[A-Za-zÄÖÜäöüß]", wort):
        return wort                       # "+", "&", Zahlen
    if re.search(r"\d", wort):
        return wort                       # Modellnummern wie "MA-1"
    if _schluessel(blank).strip(".+") in marke or _schluessel(wort) in marke:
        return wort
    ganz = _einzelwort(wort)
    if ganz:
        return ganz
    teile = wort.split("-")
    if len(teile) == 1:
        return None
    # Laengste bekannte Gruppe zuerst: "Cat-Eye" + "Sonnenbrille",
    # "Logo" + "T-Shirt", "Leder" + "Chelsea" + "Boots".
    ergebnis, i = [], 0
    while i < len(teile):
        for j in range(len(teile), i, -1):
            gruppe = "-".join(teile[i:j])
            uebersetzt = _einzelwort(gruppe)
            if uebersetzt:
                ergebnis.append(uebersetzt)
                i = j
                break
        else:
            return None
    return " ".join(ergebnis)


def _marken_woerter(marke: str) -> set[str]:
    woerter = set()
    for teil in re.split(r"\s+", str(marke or "")):
        k = _schluessel(teil)
        if k:
            woerter.add(k)
            woerter.add(k.strip(".+"))
    return woerter


def _rueckfall(item: dict) -> str:
    from seo_text import type_label
    marke = str(item.get("brand") or "").strip()
    art = type_label(item.get("product_type"), "en") or str(item.get("product_type") or "").strip()
    bereich = item.get("department")
    bereich_en = {"Women": "Women", "Men": "Men", "Unisex": "Unisex"}.get(bereich, "")
    # "Unisex" nur bei Kleidung - wie im deutschen Titelschema.
    if bereich_en == "Unisex" and item.get("taxonomy_category") in ("Accessories", "Objects"):
        bereich_en = ""
    farbe = farbe_en(str(item.get("color") or "").split(",")[0])
    return " ".join(t for t in (marke, art, bereich_en, farbe) if t).strip()


def uebersetzter_titel(item: dict) -> str | None:
    """Wort-fuer-Wort-Uebersetzung oder None, wenn ein Wort unbekannt ist."""
    titel = str(item.get("title") or "").strip()
    if not titel:
        return None
    marke = _marken_woerter(item.get("brand") or "")
    ausgabe = []
    for wort in titel.split():
        uebersetzt = _wort(wort, marke)
        if uebersetzt is None:
            return None
        ausgabe.append(uebersetzt)
    text = " ".join(ausgabe)
    return re.sub(r"\s+", " ", text).strip()


def english_title(item: dict) -> str:
    """Englischer Titel fuer den EN-Shop - nie mit deutschen Woertern."""
    return uebersetzter_titel(item) or _rueckfall(item) or str(item.get("title") or "")


def english_description(item: dict, text: str) -> str:
    """Deutsche Reste in desc_en ersetzen: den deutschen Titel (steht in
    vielen automatisch erzeugten Texten: "<Titel> by <Marke>.") und eine
    deutsche Farbe hinter "Color:"."""
    if not text:
        return text
    titel = str(item.get("title") or "").strip()
    if titel and titel in text:
        text = text.replace(titel, english_title(item))

    def farbe(match: re.Match[str]) -> str:
        en = farbe_en(match.group(2))
        return match.group(1) + (en or match.group(2))

    return re.sub(r"(Colou?r:\s*)([^.\n]+?)(?=\s*(?:\.|\n|$))", farbe, text)

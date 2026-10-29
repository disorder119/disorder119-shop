"""French names derived only from maintained product titles and attributes.

Known garment phrases are translated as phrases so French noun/adjective order
is preserved. Brand and collection names stay unchanged. If a title contains an
unknown phrase, the fallback uses the recorded type, department and colour;
unknown words are never presented as a partially German French title.
"""
from __future__ import annotations

import re


COLOURS = {
    "schwarz": "noir", "weiß": "blanc", "weiss": "blanc", "grau": "gris",
    "braun": "marron", "blau": "bleu", "beige": "beige", "grün": "vert",
    "gruen": "vert", "bunt": "multicolore", "mehrfarbig": "multicolore",
    "marineblau": "bleu marine", "dunkelblau": "bleu foncé", "hellblau": "bleu clair",
    "khaki": "kaki", "rot": "rouge", "orange": "orange", "rotbraun": "brun rouge",
    "creme": "crème", "elfenbein": "ivoire", "silber": "argenté", "gold": "doré",
    "rose": "rose", "rosé": "rose", "rosa": "rose", "pink": "rose",
    "aprikose": "abricot", "gelb": "jaune", "flieder": "lilas", "lila": "violet",
    "violett": "violet", "dunkelgrün": "vert foncé", "hellgrün": "vert clair",
    "neongrün": "vert fluo", "olivgrün": "vert olive", "oliv": "olive",
    "burgunderrot": "bordeaux", "bordeaux": "bordeaux", "dunkelrot": "rouge foncé",
    "türkis": "turquoise", "petrol": "bleu pétrole", "dunkelgrau": "gris foncé",
    "hellgrau": "gris clair", "anthrazit": "anthracite", "dunkelbraun": "marron foncé",
    "hellbraun": "marron clair", "cognac": "cognac", "camel": "camel",
    "taupe": "taupe", "sand": "sable", "natur": "naturel", "transparent": "transparent",
    "kupfer": "cuivré", "bronze": "bronze", "metallic": "métallisé",
}

TYPES = {
    "Accessory": "accessoire", "Backpack": "sac à dos", "Bag": "sac",
    "Beanie": "bonnet", "Belt": "ceinture", "Biker Jacket": "veste de motard",
    "Blazer": "blazer", "Blouse": "blouse", "Bomber Jacket": "blouson bomber",
    "Boots": "bottes", "Cap": "casquette", "Cardigan": "cardigan", "Coat": "manteau",
    "Dress": "robe", "Hat": "chapeau", "Heels": "chaussures à talons",
    "Jacket": "veste", "Joggers": "pantalon de jogging", "Knit Top": "top en maille",
    "Loafers": "mocassins", "Long Sleeve": "haut à manches longues", "Polo Shirt": "polo",
    "Sandals": "sandales", "Scarf": "écharpe", "Set": "ensemble", "Shirt": "chemise",
    "Shoes": "chaussures", "Shorts": "short", "Skirt": "jupe", "Sleepwear": "vêtement de nuit",
    "Sneakers": "baskets", "Suit": "costume", "Sunglasses": "lunettes de soleil",
    "Sweater": "pull", "Sweatshirt": "sweat", "Swim Shorts": "short de bain",
    "T-Shirt": "T-shirt", "Tank Top": "débardeur", "Toaster": "grille-pain", "Top": "top",
    "Trench Coat": "trench", "Trousers": "pantalon", "Tunic": "tunique", "Vest": "gilet",
    "Jackets": "veste", "Coats": "manteau", "Tops": "top", "Shirts": "chemise",
    "Knitwear": "maille", "Pants": "pantalon", "Skirts": "jupe", "Dresses": "robe",
    "Accessories": "accessoire", "Objects": "objet",
}

# Complete garment/detail phrases, rather than word order copied from German.
PHRASES = {
    "Marmorierte Jeans": "jean marbré", "Asymmetrischer Jeansrock": "jupe en jean asymétrique",
    "Asymmetrisches Maxikleid": "robe longue asymétrique", "Asymmetrischer Rock": "jupe asymétrique",
    "Asymmetrische Bikerjacke": "veste de motard asymétrique", "Asymmetrischer Cardigan": "cardigan asymétrique",
    "Asymmetrische Tunika": "tunique asymétrique", "Langer Rock": "jupe longue",
    "Lange Weste": "gilet long", "Langes Top": "top long", "Kurze Jacke": "veste courte",
    "Leichte Jacke": "veste légère", "Gestreiftes Hemd": "chemise rayée",
    "Gestreifte Hose": "pantalon rayé", "Karierte Hose": "pantalon à carreaux",
    "Melierter Cardigan": "cardigan chiné", "Drapiertes Top": "top drapé",
    "Gepunktete Slide-Sandalen": "sandales à enfiler à pois", "Oversized Cargohose": "pantalon cargo ample",
    "Leder-Chelsea-Boots": "bottines Chelsea en cuir", "Wildleder-Chelsea-Boots": "bottines Chelsea en daim",
    "Leder-Bikerjacke": "veste de motard en cuir", "High-Top-Sneaker": "baskets montantes",
    "High-Top-Schuhe": "chaussures montantes", "Low-Top-Sneaker": "baskets basses",
    "Walking-Sneaker": "baskets de marche", "Wildleder-Sneaker": "baskets en daim",
    "Metallic-Sneaker": "baskets métallisées", "Nylon-Sneaker": "baskets en nylon",
    "Mesh-Sneaker": "baskets en résille", "Klett-Sneaker": "baskets à scratch",
    "Leder-Boots": "bottes en cuir", "Cat-Eye-Sonnenbrille": "lunettes de soleil œil-de-chat",
    "Sonnenbrille": "lunettes de soleil", "mit Logo-Bügeln": "à branches ornées du logo",
    "mit Riemen": "à brides", "mit Schnalle": "à boucle", "mit Rillensohle": "à semelle crantée",
    "Nylon-Badeshorts": "short de bain en nylon", "Ballonrock": "jupe ballon",
    "Rasta-Mütze": "bonnet rasta", "Grafik-Beanie": "bonnet graphique", "Logo-Cap": "casquette à logo",
    "mit Muster": "à motif", "Patchwork-Mesh-Top": "top en résille patchwork",
    "Mesh-Top": "top en résille", "Mesh-Tanktop": "débardeur en résille", "Mesh-Bluse": "blouse en résille",
    "mit Print": "à imprimé", "Fleecejacke": "veste polaire", "Funktionsjacke": "veste technique",
    "Leder-Winterjacke": "veste d’hiver en cuir", "Jeansrock": "jupe en jean",
    "Schwanengürtel": "ceinture cygne", "Lederweste": "gilet en cuir",
    "mit Streifenkragen": "à col rayé", "Stricktop": "top en maille", "Ballonkleid": "robe ballon",
    "Half-Zip-Poloshirt": "polo à demi-zip", "Mantelkleid": "robe-manteau",
    "Bikerjacke": "veste de motard", "Trainingsjacke": "veste de survêtement",
    "mit Fellkragen": "à col en fourrure", "Logo-T-Shirt": "T-shirt à logo",
    "Blumenkleid": "robe à fleurs", "Wollhut": "chapeau en laine", "Strohhut": "chapeau en paille",
    "Cord-Hemdjacke": "surchemise en velours côtelé", "Wende-Top": "top réversible",
    "Plateau-Sandaletten": "sandales à plateforme", "Bomberjacke": "blouson bomber",
    "mit Lederdetails": "à détails en cuir", "Lederjacke": "veste en cuir", "Anzughose": "pantalon de costume",
    "Nadelstreifen-Blazer": "blazer à fines rayures", "mit Flügel-Print": "à imprimé ailes",
    "in Knitteroptik": "à effet froissé", "Langarm-Poloshirt": "polo à manches longues",
    "mit Bienen-Patch": "à écusson abeille", "Seidentop": "top en soie", "Lederblazer": "blazer en cuir",
    "Monogramm-Gürtel": "ceinture monogrammée", "mit Bändern": "à rubans", "Steppweste": "gilet matelassé",
    "Lounge-Set": "ensemble détente", "Zip-Jacke": "veste zippée", "mit Kunstfellkragen": "à col en fausse fourrure",
    "Langarm-Top": "top à manches longues", "Jeansjacke": "veste en jean", "Sweatjacke": "veste en molleton",
    "Tattoo-Kleid": "robe Tattoo", "Cord-Weste": "gilet en velours côtelé", "Daunenjacke": "doudoune",
    "Schnürstiefel": "bottes à lacets", "Kapuzenjacke": "veste à capuche", "mit Strand-Print": "à imprimé plage",
    "Sample-Parka": "parka prototype", "aus Wolle": "en laine", "Wendejacke": "veste réversible",
    "Geldbörse": "portefeuille", "Fellstola": "étole en fourrure", "Jogginghose": "pantalon de jogging",
    "Kunstfelljacke": "veste en fausse fourrure", "Gore-Tex-Jacke": "veste en Gore-Tex",
    "mit Gürtel": "à ceinture", "Kaschmirpullover": "pull en cachemire",
    "mit Felloptik-Kragen": "à col effet fourrure", "Nadelstreifen-Anzug": "costume à fines rayures",
    "Zip-Hoodie": "sweat à capuche zippé", "Lounge-Shorts": "short détente",
    "mit Barockmuster": "à motif baroque", "Winterjacke": "veste d’hiver", "mit Nieten": "à clous",
    "Denim-Gürtel": "ceinture en jean", "Union-Jack-Top": "top Union Jack",
    "Maxirock": "jupe longue", "mit Perlenknöpfen": "à boutons nacrés",
    "Kurzarm-Cardigan": "cardigan à manches courtes", "Spider-Longsleeve": "haut Spider à manches longues",
    "Military-Jacke": "veste militaire", "Jeans-Shorts": "short en jean", "Zip-Weste": "gilet zippé",
    "Cloud-Wash-Jeans": "jean Cloud Wash", "Patchwork-Hose": "pantalon patchwork",
    "Strickjacke": "cardigan", "Nylonjacke": "veste en nylon", "Steppjacke": "veste matelassée",
    "Pop-Up Toaster": "grille-pain à éjection", "Flip-Flops": "tongs", "Stiefeletten": "bottines",
    "Loafer": "mocassins", "Sneaker": "baskets", "Longsleeve": "haut à manches longues",
    "Tanktop": "débardeur", "Trenchcoat": "trench", "Poloshirt": "polo", "Pullover": "pull",
    "T-Shirt": "T-shirt", "Sweatshirt": "sweat", "Cardigan": "cardigan", "Blazer": "blazer",
    "Jacke": "veste", "Kleid": "robe", "Hose": "pantalon", "Rock": "jupe", "Mantel": "manteau",
    "Weste": "gilet", "Bluse": "blouse", "Hemd": "chemise", "Stiefel": "bottes", "Gürtel": "ceinture",
    "Tasche": "sac", "Rucksack": "sac à dos", "Schal": "écharpe", "Hut": "chapeau", "Top": "top",
    "Cap": "casquette", "Parka": "parka", "Pumps": "escarpins", "Set": "ensemble", "Shorts": "short",
    "Jeans": "jean", "Damen": "femme", "Herren": "homme", "Unisex": "unisexe",
}

# Collection and collaboration names found in maintained titles. No garment
# properties are inferred from these names.
PRESERVED = {
    "MM6", "Pierre", "x", "H&M", "Homme", "Plume", "America's Cup", "Sport",
    "Black Label", "Challenge", "Kinetic Youth", "Don't Worry", "Linea Rossa", "Classique",
    "Beachwear", "Sweet Angel", "DRKSHDW", "Soleil", "Maille", "Experience",
    "Surf Camp", "SNCF", "Holy", "Rive Gauche", "I Love Dior", "Luna Rossa",
    "Originals", "Speedhunters", "Yoyo", "Bunny", "Collezioni", "Nova Check",
}

_PHRASE_PATTERN = re.compile(
    r"(?<!\w)(?:" + "|".join(re.escape(word) for word in sorted(PHRASES, key=len, reverse=True)) + r")(?!\w)",
    re.I,
)
_PHRASES_LOWER = {key.casefold(): value for key, value in PHRASES.items()}


def french_color(value: str) -> str:
    """Translate recorded comma-separated colours; unknown values stay empty."""
    pieces = [part.strip() for part in str(value or "").split(",") if part.strip()]
    if not pieces or any(part.casefold() not in COLOURS for part in pieces):
        return ""
    return ", ".join(COLOURS[part.casefold()] for part in pieces)


def _title_colour(colour: str, item: dict) -> str:
    """Agree simple colour adjectives with the translated garment noun."""
    kind = item.get("product_type")
    feminine = kind in {"Blouse", "Dress", "Jacket", "Skirt", "Tunic", "Cap", "Belt", "Scarf", "Biker Jacket",
                         "Boots", "Heels", "Sandals", "Shoes", "Sneakers", "Sunglasses"}
    plural = kind in {"Boots", "Heels", "Sandals", "Shoes", "Sneakers", "Sunglasses", "Loafers"}
    # Compound colour names and colours derived from fruit/material are invariant.
    if " " in colour or colour in {"marron", "orange", "lilas", "bordeaux", "ivoire", "crème", "kaki",
                                     "cognac", "camel", "taupe", "sable", "abricot", "olive", "bronze"}:
        return colour
    if feminine:
        colour = {"noir": "noire", "blanc": "blanche", "gris": "grise", "bleu": "bleue", "vert": "verte",
                  "argenté": "argentée", "doré": "dorée", "violet": "violette", "naturel": "naturelle",
                  "transparent": "transparente", "cuivré": "cuivrée", "métallisé": "métallisée"}.get(colour, colour)
    if plural and not colour.endswith("s"):
        colour += "s"
    return colour


def _translated_title(item: dict) -> str | None:
    title = str(item.get("title") or "").strip()
    if not title:
        return None
    saved: list[str] = []

    def protect(text: str) -> str:
        saved.append(text)
        return f"\ue000{len(saved) - 1}\ue001"

    for name in sorted(PRESERVED, key=len, reverse=True):
        title = re.sub(r"(?<!\w)" + re.escape(name) + r"(?!\w)", lambda m: protect(m[0]), title)
    brand = str(item.get("brand") or "").strip()
    if brand:
        title = re.sub(r"(?<!\w)" + re.escape(brand) + r"(?!\w)", lambda m: protect(m[0]), title, flags=re.I)
    title = _PHRASE_PATTERN.sub(lambda m: protect(_PHRASES_LOWER[m[0].casefold()]), title)
    for colour in sorted(COLOURS, key=len, reverse=True):
        title = re.sub(r"(?<!\w)" + re.escape(colour) + r"(?!\w)", lambda m: protect(_title_colour(COLOURS[colour], item)), title, flags=re.I)
    # Once known phrases are protected, only separators and model numbers may
    # remain. Unknown letters trigger the conservative structured-field fallback.
    residue = re.sub(r"\ue000\d+\ue001", "", title)
    if re.search(r"[^\W\d_]", residue, flags=re.UNICODE):
        return None
    return re.sub(r"\s+", " ", re.sub(r"\ue000(\d+)\ue001", lambda m: saved[int(m[1])], title)).strip()


def french_title(item: dict) -> str:
    """A complete French product name without translating brand/model names."""
    translated = _translated_title(item)
    if translated:
        return translated
    brand = str(item.get("brand") or "").strip()
    product_type = TYPES.get(str(item.get("product_type") or ""))
    category = TYPES.get(str(item.get("taxonomy_category") or item.get("category") or ""))
    department = {"Women": "femme", "Men": "homme", "Unisex": "unisexe"}.get(item.get("department"), "")
    if department == "unisexe" and item.get("taxonomy_category") in {"Accessories", "Objects"}:
        department = ""
    colour = ", ".join(_title_colour(part, item) for part in french_color(str(item.get("color") or "")).split(", ") if part)
    return " ".join(part for part in (brand, product_type or category or "pièce", department, colour) if part)


def french_description(item: dict, text: str) -> str:
    """Replace maintained German title/colour remnants in existing French copy."""
    if not text:
        return text
    title = str(item.get("title") or "").strip()
    if title:
        text = text.replace(title, french_title(item))

    def colour(match: re.Match[str]) -> str:
        translated = french_color(match[2])
        return match[1] + (translated or match[2])

    return re.sub(r"(Couleur\s*:\s*)([^.\n]+?)(?=\s*(?:\.|\n|$))", colour, text, flags=re.I)

#!/usr/bin/env python3
"""Curated product taxonomy for the Disorder119 catalogue.

The legacy ``category`` field is deliberately left untouched because Match, Chaos
and Baukasten currently consume it. The reviewed taxonomy lives in separate
fields so archive/product metadata can become more precise without changing the
protected modes.
"""
from __future__ import annotations

import re
from collections import Counter
from typing import Any

DEPARTMENTS = {"Women", "Men", "Unisex", "Objects"}
TAXONOMY_CATEGORIES = {
    "Jackets", "Coats", "Tops", "Shirts", "Knitwear", "Pants", "Skirts",
    "Dresses", "Shoes", "Accessories", "Objects",
}

# Cases whose target group is explicit from the title/line or especially clear
# from the reviewed description. Keeping these as item IDs means future brand
# additions do not silently rewrite already-reviewed pieces.
DEPARTMENT_OVERRIDES = {
    # Disorder119 has no separate children's department. Real child-size facts
    # remain in the raw size field, while the browse department stays neutral.
    6202: "Unisex", # Prada Light Blue Cropped Jacket – Kindergröße L
    9533: "Unisex", # Prada Flops – EU 28
    6235: "Men",    # Dior Homme high-tops
    6233: "Men",    # Dior Homme high-tops
    6204: "Men",    # Raf Simons Kinetic Youth vest
    9534: "Men",    # title: Prada Herren Schuhe
    9524: "Women",  # title: Prada Frauenbomber
    9520: "Women",  # description explicitly describes feminine tailoring
    9538: "Men",    # title: Gucci Blazer Herren
    9496: "Men",    # title: Dior Herrenpolo
    9495: "Men",    # companion Dior polo, label size 46
    9463: "Women",  # Prada Heels
    9432: "Women",  # JPG underwear shorts, S/36/8
    9434: "Men",    # size 48 sweatshirt

    # Durchgang 17.09.2026: jedes Stueck einzeln angesehen (Fotos, Schnitt,
    # Groessenetikett, Linie). Vorher standen 91 Teile auf Unisex, obwohl der
    # Schnitt eindeutig war. Unisex bleibt jetzt dem vorbehalten, was wirklich
    # keine Zuordnung hat: Muetzen, Caps, Taschen, Brillen, Schals,
    # Einheitsgroessen.
    # -- Damen --------------------------------------------------------------
    9483: "Women",  # A.F. Vandevorst Guertel, schmaler Taillenguertel der Damenlinie
    9392: "Women",  # Alexander McQueen Blazer, taillierter Damenschnitt
    9479: "Women",  # Alexander McQueen Jacke, kurz und tailliert, Etikett 46 = IT 46/DE 40
    9421: "Women",  # Ann Demeulemeester Hose, hoch sitzender Damenschnitt, Etikett S
    9445: "Women",  # Ann Demeulemeester Jogginghose, Damenschnitt, Etikett S
    9368: "Women",  # Balmain Fake-Fur-Jacke, kurz und tailliert
    9442: "Women",  # Balmain Furry, Damenjacke Groesse S
    9458: "Women",  # Balmain Trenchcoat, taillierter Damentrench
    9426: "Women",  # Burberry Bermuda im Nova-Check, Damenschnitt
    9497: "Women",  # Dior Guertel 80 cm, schmaler Damenguertel
    9503: "Women",  # Dior Biene, Damentop
    9529: "Women",  # Dolce & Gabbana Jacke Groesse XS
    9358: "Women",  # Giorgio Brato Lederjacke, kurz und tailliert
    9473: "Women",  # Giorgio Brato Lederjacke, kurz und tailliert
    6191: "Women",  # Giorgio Brato lange Weste mit Fellkragen, Damenschnitt
    9513: "Women",  # Isaac Sellam Hose, Damenschnitt Groesse S
    6205: "Women",  # Jean Paul Gaultier Schwanenguertel, Damenlinie
    6212: "Women",  # Jean Paul Gaultier "Classique" = Damenlinie
    6213: "Women",  # Jean Paul Gaultier "Classique" = Damenlinie
    9387: "Women",  # Jean Paul Gaultier gestreifte Damenhose
    9388: "Women",  # Jean Paul Gaultier kurze Damenjacke
    9401: "Women",  # Jean Paul Gaultier Spidertop, Damentop
    9402: "Women",  # Jean Paul Gaultier Mesh-Bluse
    9408: "Women",  # Jean Paul Gaultier Jeans, Etikett 30, Damenschnitt
    9484: "Women",  # Jean Paul Gaultier figurbetontes Damenshirt
    9519: "Women",  # Jil Sander "Sweet Angel" Wendetop, Damenschnitt
    9532: "Women",  # Jil Sander Anzugshose Groesse XS
    9391: "Women",  # Maison Margiela Hose, tiefe Taille, Damenschnitt
    9385: "Women",  # Rundholz Jacke, stand faelschlich unter Objekte
    9455: "Women",  # Prada Jacke schwarz, Etikett Tg. 42 = Damen 36, Taillenguertel
    9465: "Women",  # Prada Wool Top, Damenschnitt
    9492: "Women",  # Prada Jacke beige, Etikett 46 = IT 46/DE 40
    9509: "Women",  # Prada Jacke babyblau, Etikett Tg. 42 = Damen 36
    9365: "Women",  # Prada Jacke lila mit Fellbesatz, tailliert
    9422: "Women",  # Prada karierte Hose, Etikett IT 46 = Damen 40
    9436: "Women",  # Prada Jacke Groesse M, Damenschnitt
    9437: "Women",  # Prada Jacke Groesse M, Damenschnitt
    9440: "Women",  # Prada Shirt grau mit Fellkragen
    9441: "Women",  # Prada Shirt schwarz mit Fellkragen
    9457: "Women",  # Prada Fellstola
    9494: "Women",  # Prada Weste rot, Etikett 44 = Damen 38
    9500: "Women",  # Prada Knitterjacke, Etikett 44 = Damen 38
    6042: "Women",  # Walter Van Beirendonck Rock (Zweiteintrag zu 9415)
    9415: "Women",  # Walter Van Beirendonck Rock
    9375: "Women",  # Y-3 drapiertes Damentop
    6192: "Women",  # Y-3 Track Jacket, kurz und tailliert, Groesse S
    6239: "Women",  # Yohji Yamamoto Cat-Eye-Sonnenbrille, Damenform
    9481: "Women",  # Yves Saint Laurent, Etikett "CLASSIC JACKET DONNA"
    # -- Herren -------------------------------------------------------------
    9469: "Men",    # Armani Collezioni Jacke, Etikett 52
    9383: "Men",    # Balenciaga Speedhunters Longsleeve, Herrenlinie, Groesse L
    9530: "Men",    # Dior Shirt, gerader Herrenschnitt, Groesse L
    9498: "Men",    # Helmut Lang klassisches Herrenhemd
    9505: "Men",    # Jean Paul Gaultier Jacke Groesse XL
    9522: "Men",    # Moose Knuckles Parka Groesse M
    9460: "Men",    # Prada Herren-Schnuerschuhe
    9464: "Men",    # Prada Herren-Loafer
    9526: "Men",    # Prada Holzfaellerjacke Groesse XXL
    9412: "Men",    # Supreme Hose, Herren-Streetwear
    6189: "Men",    # Y-3 T-Shirt, Herrenlinie
    6220: "Men",    # Y-3 Cargohose, Herrenlinie
    9379: "Men",    # Y-3 Jacke, Herrenlinie
    9380: "Men",    # Y-3 Nylonjacke, Herrenlinie
    9381: "Men",    # Y-3 Polo, Herrenlinie
    9423: "Men",    # Y-3 Longsleeve, Herrenlinie
    9376: "Men",    # Yves Saint Laurent Herrenanzug
    9424: "Men",    # Yves Saint Laurent Herrenanzug, Nadelstreifen
    9425: "Men",    # Yves Saint Laurent jeanswear Sweatshirt XL
    # -- Unisex (geprueft, bleibt bewusst offen) -----------------------------
    9466: "Unisex", # Adidas Sample Jacke, Sportschnitt ohne Zuordnung
    9393: "Unisex", # Oakley Longsleeve, Sportschnitt ohne Zuordnung
    9527: "Unisex", # Rick Owens DRKSHDW Longsleeve, gerader Schnitt
    9373: "Unisex", # Ravani T-Shirt, gerader Schnitt
    9490: "Unisex", # Jean Paul Gaultier Schlafanzug, Universalgroesse
    6207: "Unisex", # Yves Saint Laurent Ledermantel 80er, weiter Schnitt
    9449: "Unisex", # Yves Saint Laurent Kaschmirpullover, gerader Schnitt
}

# Product-type overrides for titles that are too vague or currently have a
# demonstrably wrong legacy category. These were checked against descriptions.
PRODUCT_TYPE_OVERRIDES = {
    # TAXONOMY_SUBTYPE_AUDIT_20260906: reviewed jacket/vest semantics.
    9512: "Jacket",  # Dsquared2 Suf Camp Gelb – description: Leichte Jacke
    9500: "Jacket",  # Prada Knitterjacke – description: Diese Prada Jacke
    9454: "Jacket",  # Prada Goretex Weiss – description: Diese Prada Jacke
    9443: "Jacket",  # Balmain Braun – description: Diese Balmain Jacke
    9442: "Jacket",  # Balmain Furry – description: Kurze Balmain Jacke
    9417: "Vest",    # Y-3 Veste – description: Ärmellose Zip-Weste
    # Die Altkategorie sagt "Objects", die Fotos zeigen eine Rundholz-Jacke
    # mit Knopfleiste und gerafften Aermeln (geprueft 17.09.2026).
    9385: "Jacket",
    6240: "Toaster",
    9524: "Bomber Jacket",
    9463: "Heels",
    9386: "Hat",
    9434: "Sweatshirt",
    9432: "Underwear Shorts",
    9496: "Polo Shirt",  # title: Dior Herrenpolo Schwarz
    9490: "Sleepwear",
    9489: "Set",
    9424: "Suit",
    9376: "Suit",
    9433: "Bag",
}

# A small number of data records are demonstrably misfiled in the old category
# system. We DO NOT mutate that protected legacy field; this maps them to the
# reviewed taxonomy shown on product pages and exported in catalog.json.
TAXONOMY_CATEGORY_OVERRIDES = {
    6240: "Objects",       # toaster, previously Accessories
    9463: "Shoes",         # Prada Heels, previously Tops
    9386: "Accessories",   # JPG Hat, previously Tops
    9434: "Knitwear",      # description identifies a sweatshirt, legacy Objects
    9435: "Knitwear",      # Prada Cardigan
    6199: "Knitwear",      # Rundholz Cardigan
    6194: "Knitwear",      # A.F. Vandevorst Cardigan
}

WOMEN_BRANDS = {
    "Miu Miu", "MM6 Maison Margiela", "Isabel Marant", "Ottolinger",
    "A.F. Vandevorst", "Rundholz", "Y's",
}
MEN_BRANDS = {
    "Raf Simons", "Walter Van Beirendonck", "Kiko Kostadinov",
}

PRODUCT_TYPE_CATEGORY = {
    "Toaster": "Objects", "Design Object": "Objects",
    "Dress": "Dresses", "Skirt": "Skirts",
    "Trousers": "Pants", "Shorts": "Pants", "Swim Shorts": "Pants",
    "Joggers": "Pants", "Underwear Shorts": "Pants",
    "Coat": "Coats", "Trench Coat": "Coats",
    "Jacket": "Jackets", "Biker Jacket": "Jackets", "Bomber Jacket": "Jackets",
    "Blazer": "Jackets", "Vest": "Jackets", "Suit": "Jackets",
    "Cardigan": "Knitwear", "Sweater": "Knitwear", "Knit Top": "Knitwear",
    "Sweatshirt": "Knitwear",
    "Shirt": "Shirts", "T-Shirt": "Shirts", "Long Sleeve": "Shirts",
    "Polo Shirt": "Shirts", "Tank Top": "Shirts",
    "Top": "Tops", "Blouse": "Tops", "Tunic": "Tops", "Set": "Tops",
    "Sleepwear": "Tops",
    "Shoes": "Shoes", "Sneakers": "Shoes", "Boots": "Shoes", "Loafers": "Shoes",
    "Heels": "Shoes", "Sandals": "Shoes",
    "Cap": "Accessories", "Hat": "Accessories", "Beanie": "Accessories",
    "Sunglasses": "Accessories", "Belt": "Accessories", "Scarf": "Accessories",
    "Bag": "Accessories", "Backpack": "Accessories", "Wallet": "Accessories",
    "Accessory": "Accessories",
}

DEPARTMENT_LABELS = {
    "de": {"Women": "Damen", "Men": "Herren", "Unisex": "Unisex", "Objects": "Objekt"},
    "en": {"Women": "Women", "Men": "Men", "Unisex": "Unisex", "Objects": "Object"},
    "fr": {"Women": "Femme", "Men": "Homme", "Unisex": "Unisexe", "Objects": "Objet"},
}

PRODUCT_TYPE_LABELS = {
    "de": {
        "Toaster": "Toaster / Designobjekt", "Design Object": "Designobjekt", "Dress": "Kleid",
        "Skirt": "Rock", "Trousers": "Hose", "Shorts": "Shorts", "Swim Shorts": "Badeshorts",
        "Joggers": "Jogginghose", "Underwear Shorts": "Unterwäsche-Shorts", "Coat": "Mantel",
        "Trench Coat": "Trenchcoat", "Jacket": "Jacke", "Biker Jacket": "Bikerjacke",
        "Bomber Jacket": "Bomberjacke", "Blazer": "Blazer", "Vest": "Weste", "Suit": "Anzug",
        "Cardigan": "Cardigan / Strickjacke", "Sweater": "Pullover", "Knit Top": "Stricktop",
        "Sweatshirt": "Sweatshirt", "Shirt": "Hemd / Shirt", "T-Shirt": "T-Shirt",
        "Long Sleeve": "Longsleeve", "Polo Shirt": "Poloshirt", "Tank Top": "Tanktop",
        "Top": "Top", "Blouse": "Bluse", "Tunic": "Tunika", "Set": "Set",
        "Sleepwear": "Schlafanzug / Sleepwear", "Shoes": "Schuhe", "Sneakers": "Sneaker",
        "Boots": "Stiefel / Boots", "Loafers": "Loafer", "Heels": "Heels / Absatzschuhe",
        "Sandals": "Sandalen", "Cap": "Cap", "Hat": "Hut", "Beanie": "Mütze / Beanie",
        "Sunglasses": "Sonnenbrille", "Belt": "Gürtel", "Scarf": "Schal", "Bag": "Tasche",
        "Backpack": "Rucksack", "Wallet": "Wallet / Geldbörse", "Accessory": "Accessoire",
    },
    "en": {},
    "fr": {
        "Dress": "Robe", "Skirt": "Jupe", "Trousers": "Pantalon", "Coat": "Manteau",
        "Jacket": "Veste", "Blazer": "Blazer", "Vest": "Gilet", "Suit": "Costume",
        "Cardigan": "Cardigan", "Sweater": "Pull", "Shirt": "Chemise", "T-Shirt": "T-shirt",
        "Polo Shirt": "Polo", "Top": "Haut", "Blouse": "Blouse", "Shoes": "Chaussures",
        "Sneakers": "Baskets", "Boots": "Bottes", "Loafers": "Mocassins", "Heels": "Chaussures à talons",
        "Sandals": "Sandales", "Hat": "Chapeau", "Sunglasses": "Lunettes de soleil", "Belt": "Ceinture",
        "Scarf": "Écharpe", "Bag": "Sac", "Backpack": "Sac à dos", "Wallet": "Portefeuille",
    },
}

CATEGORY_LABELS = {
    "de": {"Jackets": "Jacken", "Coats": "Mäntel", "Tops": "Tops", "Shirts": "Hemden/Shirts", "Knitwear": "Strickwaren", "Pants": "Hosen", "Skirts": "Röcke", "Dresses": "Kleider", "Shoes": "Schuhe", "Accessories": "Accessoires", "Objects": "Objekte"},
    "en": {key: key for key in TAXONOMY_CATEGORIES},
    "fr": {"Jackets": "Vestes", "Coats": "Manteaux", "Tops": "Hauts", "Shirts": "Chemises/T-shirts", "Knitwear": "Maille", "Pants": "Pantalons", "Skirts": "Jupes", "Dresses": "Robes", "Shoes": "Chaussures", "Accessories": "Accessoires", "Objects": "Objets"},
}


def _clean(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def _all_text(item: dict[str, Any]) -> str:
    return " ".join(
        _clean(item.get(key))
        for key in ("title", "brand", "desc_de", "desc", "desc_en", "desc_fr")
        if item.get(key)
    ).lower()


def extract_label_size(item: dict[str, Any]) -> str:
    """Extract the manufacturer's/description size without reading mannequin measurements."""
    for key in ("desc_de", "desc", "desc_en", "desc_fr"):
        text = str(item.get(key) or "")
        if not text:
            continue
        patterns = (
            r"(?im)^\s*(?:Größe|Groesse)\s*:\s*([^\n\r]+)",
            r"(?im)^\s*Size\s*:\s*([^\n\r]+)",
            r"(?im)^\s*Taille\s*:\s*([^\n\r]+)",
        )
        for pattern in patterns:
            match = re.search(pattern, text)
            if match:
                value = _clean(match.group(1)).strip(" .;,")
                if 0 < len(value) <= 40:
                    return value
    return ""


def extract_title_size(item: dict[str, Any]) -> str:
    title = _clean(item.get("title"))
    patterns = (
        r"(?i)\bgr(?:öße|osse|\.)?\s*([0-9]{2}(?:[.,][05])?|XXL|XL|L|M|S|XS)\b",
        r"(?i)\bsize\s*([0-9]{1,2}(?:[.,][05])?|XXL|XL|L|M|S|XS)\b",
    )
    for pattern in patterns:
        match = re.search(pattern, title)
        if match:
            return match.group(1).replace(",", ".").upper()
    return ""


def classify_product_type(item: dict[str, Any]) -> str:
    item_id = int(item.get("id") or 0)
    if item_id in PRODUCT_TYPE_OVERRIDES:
        return PRODUCT_TYPE_OVERRIDES[item_id]

    title = _clean(item.get("title")).lower()
    text = _all_text(item)

    rules = (
        (r"\btoaster\b", "Toaster"),
        (r"\bsunglasses\b|\bsonnenbrill", "Sunglasses"),
        (r"\bruck?sack\b|\bbackpack\b", "Backpack"),
        (r"\bwallet\b|geldb[oö]rse", "Wallet"),
        (r"\btasche\b|\bbag\b", "Bag"),
        (r"g[üu]rtel|\bbelt\b", "Belt"),
        (r"\bschal\b|\bscarf\b", "Scarf"),
        (r"\bbeanie\b|m[üu]tze", "Beanie"),
        (r"\bcap\b", "Cap"),
        (r"\bhat\b|\bhut\b", "Hat"),
        (r"\bheel", "Heels"),
        (r"\bloafer", "Loafers"),
        (r"\bsneaker", "Sneakers"),
        (r"\bchelsea\b|\bboots?\b|stiefel", "Boots"),
        (r"\bsandal|\bslides?\b|\bflops?\b", "Sandals"),
        (r"\bshoes?\b|schuhe", "Shoes"),
        (r"swim shorts|badeshorts", "Swim Shorts"),
        (r"underwear|unterhose", "Underwear Shorts"),
        (r"\bshorts?\b", "Shorts"),
        (r"jogginghose|\bjogger", "Joggers"),
        (r"\btrousers?\b|\bpants?\b|\bhose\b", "Trousers"),
        (r"\bskirt\b|\brock\b", "Skirt"),
        (r"\bdress\b|\bkleid\b", "Dress"),
        (r"\btrench", "Trench Coat"),
        (r"\bcoat\b|\bmantel\b", "Coat"),
        (r"bomber", "Bomber Jacket"),
        (r"\bbiker\b|\bmoto\b", "Biker Jacket"),
        (r"\bblazer\b", "Blazer"),
        (r"\bvest\b|\bweste\b", "Vest"),
        (r"\bjacket\b|\bjacke\b", "Jacket"),
        (r"\bcardigan\b", "Cardigan"),
        (r"\bsweatshirt\b|sweatjacke", "Sweatshirt"),
        (r"\bsweater\b|\bpulli\b|kaschmir", "Sweater"),
        (r"\bknit\b|strick", "Knit Top"),
        (r"\bpolo\b", "Polo Shirt"),
        (r"tank\s*top|tanktop", "Tank Top"),
        (r"t-?shirt|tshirt", "T-Shirt"),
        (r"long\s*sleeve|longsleeve|\bls\b", "Long Sleeve"),
        (r"\bshirt\b|\bhemd\b", "Shirt"),
        (r"\bbluse\b|\bblouse\b", "Blouse"),
        (r"\btunic\b|tunika", "Tunic"),
        (r"\banzug\b|\bsuit\b", "Suit"),
        (r"\bset\b", "Set"),
        (r"schlafanzug|sleepwear|pyjama|pajama", "Sleepwear"),
        (r"\btop\b|oberteil", "Top"),
    )
    for pattern, product_type in rules:
        if re.search(pattern, title):
            return product_type
    # Vague titles may use the description only inside the existing broad
    # category. This prevents incidental words in prose from turning a jacket
    # into Shorts/Dress, while explicit title rules and reviewed overrides can
    # still intentionally correct a genuinely wrong legacy category.
    legacy_category = _clean(item.get("category"))
    for pattern, product_type in rules:
        if not re.search(pattern, text):
            continue
        inferred_category = PRODUCT_TYPE_CATEGORY.get(product_type)
        if not legacy_category or inferred_category == legacy_category:
            return product_type

    fallback = {
        "Jackets": "Jacket", "Coats": "Coat", "Tops": "Top", "Shirts": "Shirt",
        "Knitwear": "Knit Top", "Pants": "Trousers", "Skirts": "Skirt",
        "Dresses": "Dress", "Shoes": "Shoes", "Accessories": "Accessory",
        "Objects": "Design Object",
    }
    return fallback.get(_clean(item.get("category")), "Accessory")


def taxonomy_category(item: dict[str, Any], product_type: str) -> str:
    item_id = int(item.get("id") or 0)
    if item_id in TAXONOMY_CATEGORY_OVERRIDES:
        return TAXONOMY_CATEGORY_OVERRIDES[item_id]
    return PRODUCT_TYPE_CATEGORY.get(product_type, _clean(item.get("category")) or "Accessories")


def _numeric_size(value: str) -> float | None:
    value = _clean(value).replace(",", ".")
    if re.fullmatch(r"\d{1,2}(?:\.5)?", value):
        try:
            return float(value)
        except ValueError:
            return None
    return None


_WOMEN_SIZE_CONVERSION = re.compile(
    r"\b(?:3[468]|4[024])\s*/\s*(?:[468]|1[0246])\b"   # M / 38 / 10
    r"|\bF\s?3[0-9]\b"                                   # S (F36 / I40)
    r"|\bEUR?\s?3[4-9]\b",                               # Etikett EUR 36
    re.I,
)


def _women_size_conversion(value: str) -> bool:
    """True, wenn die Groesse eine Damenumrechnung nennt (DE/UK bzw. F/I)."""
    return bool(value) and bool(_WOMEN_SIZE_CONVERSION.search(value))


def classify_department(item: dict[str, Any], product_type: str, tax_category: str, size_value: str,
                        label_size: str = "") -> tuple[str, str]:
    item_id = int(item.get("id") or 0)
    if item_id in DEPARTMENT_OVERRIDES:
        return DEPARTMENT_OVERRIDES[item_id], "explicit"

    text = _all_text(item)
    brand = _clean(item.get("brand"))

    if tax_category == "Objects" or product_type in {"Toaster", "Design Object"}:
        return "Objects", "explicit"
    # There is intentionally no children's browse department. When an item is
    # factually child-sized, keep that fact in ``size`` but use neutral Unisex.
    if re.search(r"kinder(?:größe|groesse)?|\bkids?\b|\bchild(?:ren)?\b|enfant", text):
        return "Unisex", "explicit"
    if re.search(r"\bherren\b|\bmenswear\b|\bmen['’]?s\b|\bhomme\b", text):
        return "Men", "explicit"
    if re.search(r"\bfrauen\b|\bdamen\b|\bwomenswear\b|\bwomen['’]?s\b|feminin", text):
        return "Women", "explicit"

    # Die Groessenumrechnung auf dem Etikett ist das staerkste Signal und geht
    # der Marke vor: "M / 38 / 10" oder "S (F36 / I40)" ist Damenkonfektion,
    # egal von wem. Ohne diese Reihenfolge landeten die Roecke, das Kleid und
    # die Shorts von Walter Van Beirendonck (Groesse M / 38 / 10) unter Herren,
    # weil das Label als Herrenmarke gefuehrt wird.
    # ``label_size`` kommt aus classify_item; im Artikel selbst steht das Feld
    # beim Neuberechnen nicht mehr (apply_catalog_taxonomy leert es vorher).
    if _women_size_conversion(size_value) or _women_size_conversion(label_size):
        return "Women", "high"

    # Prada fuehrt Sport, Linea Rossa, Luna Rossa und Challenge als
    # Herrenlinien. Schuhe und Accessoires bleiben ausgenommen, dort
    # entscheidet die Groesse (z. B. Sneaker in 36).
    if tax_category not in {"Shoes", "Accessories"} and re.search(
            r"prada\s+sport|linea\s+rossa|luna\s+rossa|challenge", text):
        return "Men", "high"

    if brand in MEN_BRANDS or brand == "Dior Homme":
        return "Men", "high"
    if brand in WOMEN_BRANDS:
        if tax_category == "Accessories":
            return "Unisex", "conservative"
        return "Women", "high"

    # Accessories are not gendered unless an explicit line/title says so.
    if tax_category == "Accessories":
        return "Unisex", "high"

    # Dresses/skirts in this archive are womenswear except reviewed menswear
    # labels handled above (e.g. Walter Van Beirendonck).
    if tax_category in {"Dresses", "Skirts"}:
        return "Women", "high"

    size = _clean(size_value)
    if product_type in {"Shoes", "Sneakers", "Boots", "Loafers", "Heels", "Sandals"}:
        n = _numeric_size(size)
        if product_type == "Heels":
            return "Women", "high"
        # Bare single-digit Prada shoe sizes in this catalogue are adult Prada
        # sizing (e.g. 6, 7.5, 8, 8.5, 9), not children's EU sizes. Keep the
        # size system unclaimed in size_normalized, but classify the department
        # as menswear rather than inventing a Kids department.
        if brand == "Prada" and (re.search(r"(?i)\b(?:US|UK)\s*\d", size) or (n is not None and n < 15)):
            return "Men", "high"
        # An actual small EU-like numeric size remains neutral when there is no
        # reliable gender signal; the factual size itself remains untouched.
        if n is not None and n <= 32:
            return "Unisex", "high"
        if n is not None and 33 <= n <= 40:
            return "Women", "conservative"
        if n is not None and n >= 41:
            return "Men", "conservative"
        return "Unisex", "conservative"

    # Compound XS/EU/UK conversions in this dataset (e.g. S / 36 / 8) are
    # womenswear sizing. Numeric tailoring 46+ is generally menswear here;
    # 34-42 is generally womenswear. Alpha-only sizes stay unisex absent a cue.
    if re.search(r"\b(?:XS|S|M|L|XL|XXL)\s*/\s*(?:34|36|38|40|42)\b", size, re.I):
        return "Women", "high"
    n = _numeric_size(size)
    if n is not None:
        if 34 <= n <= 42:
            return "Women", "conservative"
        if 46 <= n <= 60:
            return "Men", "conservative"

    # Strong menswear signals in this particular archive.
    if brand in {"Dsquared2", "CP Company", "C.P. Company"}:
        return "Men", "conservative"

    return "Unisex", "conservative"


def normalize_size(size_value: str, department: str, product_type: str) -> str:
    raw = _clean(size_value)
    if not raw:
        return "Unknown"
    lower = raw.lower()
    if lower in {"einheitsgröße", "einheitsgroesse", "one size", "universal"}:
        return "One Size"
    if "verstell" in lower or "adjustable" in lower:
        return "Adjustable"
    if "kinder" in lower:
        # Preserve the factual raw value (e.g. "Kindergröße L") on the item,
        # but keep normalized sizing independent from a non-existent department.
        suffix = re.search(r"\b(XXL|XL|L|M|S|XS)\b", raw, re.I)
        return suffix.group(1).upper() if suffix else raw
    if re.search(r"\b(?:XS|S|M|L|XL|XXL)\s*/", raw, re.I):
        return re.search(r"\b(XXL|XL|L|M|S|XS)\b", raw, re.I).group(1).upper()
    if raw.upper() in {"XXL", "XL", "L", "M", "S", "XS"}:
        return raw.upper()
    if raw.lower() in {"sonstige", "other"}:
        return "Other"
    if "cm" in lower and "x" in lower:
        return "Dimensions"

    is_shoe = product_type in {"Shoes", "Sneakers", "Boots", "Loafers", "Heels", "Sandals"}
    if is_shoe:
        explicit = re.search(r"(?i)\b(EU|UK|US)\s*([0-9]{1,2}(?:[.,]5)?)", raw)
        if explicit:
            return explicit.group(1).upper() + " " + explicit.group(2).replace(",", ".")
        n = _numeric_size(raw)
        if n is not None and n >= 20:
            return "EU " + (str(int(n)) if n.is_integer() else str(n))
        # Bare 6/7.5/8.5/9 values are preserved rather than falsely claiming a
        # size system that is not written in the product data.
        return raw

    n = _numeric_size(raw)
    if n is not None:
        iv = int(n) if n.is_integer() else None
        if department == "Women" and iv in {34, 36, 38, 40, 42, 44}:
            return {34: "XS", 36: "S", 38: "M", 40: "L", 42: "XL", 44: "XXL"}[iv]
        if department == "Men" and iv in {44, 46, 48, 50, 52, 54}:
            return {44: "XS", 46: "S", 48: "M", 50: "L", 52: "XL", 54: "XXL"}[iv]
    return raw


def classify_item(item: dict[str, Any]) -> dict[str, Any]:
    product_type = classify_product_type(item)
    tax_category = taxonomy_category(item, product_type)
    label_size = extract_label_size(item)
    title_size = extract_title_size(item)
    current_size = _clean(item.get("size"))

    if current_size:
        size_value = current_size
        size_source = "structured"
    elif label_size:
        size_value = label_size
        size_source = "description"
    elif title_size:
        size_value = title_size
        size_source = "title"
    else:
        size_value = ""
        size_source = "unknown"

    department, confidence = classify_department(item, product_type, tax_category, size_value, label_size)
    normalized = normalize_size(size_value, department, product_type)

    result = {
        "department": department,
        "product_type": product_type,
        "taxonomy_category": tax_category,
        "size_normalized": normalized,
        "size_source": size_source,
        "taxonomy_confidence": confidence,
        "taxonomy_reviewed": True,
    }
    if label_size:
        result["label_size"] = label_size
    if not current_size and size_value:
        result["size"] = size_value
    return result


def apply_taxonomy(items: list[dict[str, Any]]) -> dict[str, Any]:
    department_counts: Counter[str] = Counter()
    product_counts: Counter[str] = Counter()
    missing_size = []
    size_conflicts = []
    legacy_category_mismatches = []

    for item in items:
        original_size = _clean(item.get("size"))
        original_category = _clean(item.get("category"))
        classified = classify_item(item)
        item.update(classified)
        department_counts[item["department"]] += 1
        product_counts[item["product_type"]] += 1

        if item.get("size_normalized") == "Unknown":
            missing_size.append({"id": item.get("id"), "article": item.get("article"), "title": item.get("title")})
        label_size = _clean(item.get("label_size"))
        if original_size and label_size and original_size.casefold() != label_size.casefold():
            size_conflicts.append({
                "id": item.get("id"), "article": item.get("article"), "title": item.get("title"),
                "structuredSize": original_size, "descriptionLabelSize": label_size,
            })
        if original_category and item.get("taxonomy_category") != original_category:
            legacy_category_mismatches.append({
                "id": item.get("id"), "article": item.get("article"), "title": item.get("title"),
                "legacyCategory": original_category, "taxonomyCategory": item.get("taxonomy_category"),
                "productType": item.get("product_type"),
            })

    return {
        "schema": "catalog-taxonomy-v1",
        "totalItems": len(items),
        "reviewedItems": sum(1 for item in items if item.get("taxonomy_reviewed")),
        "departmentCounts": dict(sorted(department_counts.items())),
        "productTypeCounts": dict(sorted(product_counts.items())),
        "missingSizeCount": len(missing_size),
        "missingSize": missing_size,
        "sizeConflictCount": len(size_conflicts),
        "sizeConflicts": size_conflicts,
        "legacyCategoryMismatchCount": len(legacy_category_mismatches),
        "legacyCategoryMismatches": legacy_category_mismatches,
        "note": "Legacy category is intentionally preserved for protected Match/Chaos/Baukasten behavior; reviewed taxonomy is exported separately.",
    }


def department_label(value: str, lang: str) -> str:
    return DEPARTMENT_LABELS.get(lang, DEPARTMENT_LABELS["de"]).get(value, value)


def product_type_label(value: str, lang: str) -> str:
    if lang == "en":
        return value
    return PRODUCT_TYPE_LABELS.get(lang, {}).get(value, value)


def taxonomy_category_label(value: str, lang: str) -> str:
    return CATEGORY_LABELS.get(lang, CATEGORY_LABELS["de"]).get(value, value)

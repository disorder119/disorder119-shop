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
}

# Product-type overrides for titles that are too vague or currently have a
# demonstrably wrong legacy category. These were checked against descriptions.
PRODUCT_TYPE_OVERRIDES = {
    6240: "Toaster",
    9524: "Bomber Jacket",
    9463: "Heels",
    9386: "Hat",
    9434: "Sweatshirt",
    9432: "Underwear Shorts",
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
        (r"\bvest\b|\bweste\b|\bveste\b", "Vest"),
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
    # Vague legacy titles are resolved from their full description next.
    for pattern, product_type in rules:
        if re.search(pattern, text):
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


def classify_department(item: dict[str, Any], product_type: str, tax_category: str, size_value: str) -> tuple[str, str]:
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

    department, confidence = classify_department(item, product_type, tax_category, size_value)
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

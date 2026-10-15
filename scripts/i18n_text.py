"""Produkttexte je Sprache (DE/EN/FR) - an genau einer Stelle definiert.

Wird von build_site.py (Seitenaufbau, catalog.json, Merchant-Feed) und von
scripts/repair_public_article_integrity.py (setzt Meta-Beschreibung und
"Ähnliche Teile" nach dem Bauen neu) gemeinsam genutzt. Zwei Kopien sind schon
einmal auseinandergelaufen: das Reparaturskript hat danach wieder deutsche
Titel und den Zustand in die EN/FR-Seiten geschrieben.

Titel
  data/items.json kann je Artikel die optionalen Felder title_en/title_fr
  tragen. Fehlen sie, entsteht beim Bauen ein Titel aus Marke, Produktart
  (seo_text.TYPE_TR), Damen/Herren und Farbe - ohne deutsche Wörter, die sich
  übersetzen lassen. Diese Ableitung wird nie nach data/items.json
  zurückgeschrieben; die Titelprüfung im Admin sieht weiter nur `title`.

Beschreibungen
  desc_en/desc_fr werden nur noch gelesen. Ältere CI-Platzhalter ("From the
  curated Disorder119 archive. <deutscher Titel> by <Marke>. Color: Rotbraun")
  werden beim Rendern erkannt und durch den übersetzten Ersatztext ersetzt;
  ein wörtlich enthaltener deutscher Titel wird gegen den Titel der Sprache
  getauscht.
"""
from __future__ import annotations

import re

from seo_text import compose_description, description_snippet, type_label

LANGS = ("de", "en", "fr")

# Manche Marken im Rohbestand sind Linien/Kollaborationen einer anderen Marke
# und laufen im Shop unter der Hauptmarke (Filter, Markenliste, "Mehr von").
# Der Titel behält den spezifischeren Namen ("Prada Luna Rossa Sweatjacke").
BRAND_ALIASES = {
    "Luna Rossa": "Prada",
    "Maison Margiela x H&M": "Maison Margiela",
    "Dior Homme": "Dior",
    "MM6 Maison Margiela": "Maison Margiela",
}


def canonical_brand(brand: str | None) -> str:
    brand = brand or ""
    return BRAND_ALIASES.get(brand, brand)


def apply_brand_aliases(items: list[dict]) -> None:
    for it in items:
        alias = BRAND_ALIASES.get(it.get("brand") or "")
        if alias:
            it["brand"] = alias


CATEGORY_TR = {
    "Jackets": {"de": "Jacken", "en": "Jackets", "fr": "Vestes"},
    "Coats": {"de": "Mäntel", "en": "Coats", "fr": "Manteaux"},
    "Tops": {"de": "Tops", "en": "Tops", "fr": "Hauts"},
    "Shirts": {"de": "Hemden/Shirts", "en": "Shirts", "fr": "Chemises/T-shirts"},
    "Knitwear": {"de": "Strickwaren", "en": "Knitwear", "fr": "Maille"},
    "Pants": {"de": "Hosen", "en": "Pants", "fr": "Pantalons"},
    "Skirts": {"de": "Röcke", "en": "Skirts", "fr": "Jupes"},
    "Dresses": {"de": "Kleider", "en": "Dresses", "fr": "Robes"},
    "Shoes": {"de": "Schuhe", "en": "Shoes", "fr": "Chaussures"},
    "Accessories": {"de": "Accessoires", "en": "Accessories", "fr": "Accessoires"},
    "Objects": {"de": "Objekte", "en": "Objects", "fr": "Objets"},
}
SIZE_TR = {
    "Einheitsgröße": {"de": "Einheitsgröße", "en": "One size", "fr": "Taille unique"},
    "verstellbar": {"de": "verstellbar", "en": "adjustable", "fr": "réglable"},
    "Größenverstellbar": {"de": "verstellbar", "en": "adjustable", "fr": "réglable"},
    "Kindergröße L": {"de": "Kindergröße L", "en": "Kids' size L", "fr": "Taille enfant L"},
    "Sonstige": {"de": "Sonstige", "en": "Other", "fr": "Autre"},
    "Universal": {"de": "Universal", "en": "One size", "fr": "Taille unique"},
}


def tr(table: dict, key: str | None, lang: str) -> str:
    entry = table.get(key or "")
    if not entry:
        return key or ""
    return entry.get(lang) or entry.get("de") or ""


def cat_tr(cat: str | None, lang: str) -> str:
    return tr(CATEGORY_TR, cat, lang)


def size_tr(size: str | None, lang: str) -> str:
    return tr(SIZE_TR, size, lang)


def browse_category(it: dict) -> str:
    """Geprüfte Taxonomie-Kategorie; die alte `category` nur als Rückfall."""
    return it.get("taxonomy_category") or it.get("category") or ""


# ---------------------------------------------------------------- Größen
# Größensysteme für JSON-LD (schema.org) und Merchant-Feed (g:size_system).
SIZE_SYSTEM_URL = {
    "EU": "https://schema.org/WearableSizeSystemEurope",
    "IT": "https://schema.org/WearableSizeSystemIT",
    "FR": "https://schema.org/WearableSizeSystemFR",
    "UK": "https://schema.org/WearableSizeSystemUK",
    "US": "https://schema.org/WearableSizeSystemUS",
}
_LETTER_SIZE = re.compile(r"(?:XXS|XS|S|M|L|XL|XXL|XXXL)", re.I)
_SYSTEM_SIZE = re.compile(r"(EUR|EU|IT|FR|UK|US)\s*(\d{1,2}(?:[.,]\d)?)", re.I)


def size_specification(it: dict, lang: str) -> tuple[str, str] | None:
    """(name, system) aus dem Feld size - ("M", "EU") fuer "M / 38 / 10",
    ("41", "EU") fuer "3 / EU 41 / 26 cm", ("42", "IT") bei Etikett "IT 42".
    System "" wenn unbekannt (z.B. Schuhgroesse 9 ohne Angabe); None, wenn es
    keine Konfektionsgroesse gibt (Masse, "Sonstige", unbekannt)."""
    roh = str(it.get("size") or "").strip()
    norm = str(it.get("size_normalized") or "")
    if not roh or roh == "Sonstige" or norm in ("Unknown", "Dimensions", "Other"):
        return None
    if roh in SIZE_TR:
        return size_tr(roh, lang), ""
    teile = [t.strip() for t in roh.split("/") if t.strip()]
    for teil in teile:
        treffer = _SYSTEM_SIZE.fullmatch(teil)
        if treffer:
            return treffer.group(2).replace(",", "."), treffer.group(1).upper().replace("EUR", "EU")
    erster = teile[0] if teile else ""
    if not erster or "cm" in erster.lower() or len(erster) > 14:
        return None
    if _LETTER_SIZE.fullmatch(erster):
        return erster.upper(), "EU"
    if re.fullmatch(r"\d{2}(?:[.,]5)?", erster) and 30 <= float(erster.replace(",", ".")) <= 64:
        etikett = _SYSTEM_SIZE.fullmatch(str(it.get("label_size") or "").strip())
        if etikett and etikett.group(2) == erster:
            return erster, etikett.group(1).upper().replace("EUR", "EU")
        if norm.startswith("EU ") or norm == erster or _LETTER_SIZE.fullmatch(norm):
            return erster, "EU"
    return erster, ""


# ---------------------------------------------------------------- Farben
# Schlüssel sind die deutschen Farbwörter aus Titeln und dem Feld `color`
# (Shop-Wortwahl, siehe repair_product_metadata_conservative.COLOR_PATTERNS).
# Englisch wie og:locale en_US.
COLOR_TR = {
    "Schwarz": {"en": "Black", "fr": "Noir"},
    "Weiß": {"en": "White", "fr": "Blanc"},
    "Grau": {"en": "Gray", "fr": "Gris"},
    "Anthrazit": {"en": "Charcoal", "fr": "Anthracite"},
    "Silber": {"en": "Silver", "fr": "Argent"},
    "Gold": {"en": "Gold", "fr": "Or"},
    "Braun": {"en": "Brown", "fr": "Marron"},
    "Dunkelbraun": {"en": "Dark Brown", "fr": "Marron foncé"},
    "Rotbraun": {"en": "Reddish Brown", "fr": "Brun rouge"},
    "Taupe": {"en": "Taupe", "fr": "Taupe"},
    "Camel": {"en": "Camel", "fr": "Camel"},
    "Beige": {"en": "Beige", "fr": "Beige"},
    "Creme": {"en": "Cream", "fr": "Crème"},
    "Elfenbein": {"en": "Ivory", "fr": "Ivoire"},
    "Natur": {"en": "Natural", "fr": "Naturel"},
    "Khaki": {"en": "Khaki", "fr": "Kaki"},
    "Oliv": {"en": "Olive", "fr": "Olive"},
    "Grün": {"en": "Green", "fr": "Vert"},
    "Dunkelgrün": {"en": "Dark Green", "fr": "Vert foncé"},
    "Hellgrün": {"en": "Light Green", "fr": "Vert clair"},
    "Neongrün": {"en": "Neon Green", "fr": "Vert fluo"},
    "Mint": {"en": "Mint", "fr": "Menthe"},
    "Türkis": {"en": "Turquoise", "fr": "Turquoise"},
    "Petrol": {"en": "Teal", "fr": "Bleu pétrole"},
    "Blau": {"en": "Blue", "fr": "Bleu"},
    "Hellblau": {"en": "Light Blue", "fr": "Bleu clair"},
    "Dunkelblau": {"en": "Dark Blue", "fr": "Bleu foncé"},
    "Marineblau": {"en": "Navy", "fr": "Bleu marine"},
    "Rot": {"en": "Red", "fr": "Rouge"},
    "Bordeaux": {"en": "Burgundy", "fr": "Bordeaux"},
    "Burgunderrot": {"en": "Burgundy", "fr": "Bordeaux"},
    "Weinrot": {"en": "Burgundy", "fr": "Bordeaux"},
    "Orange": {"en": "Orange", "fr": "Orange"},
    "Aprikose": {"en": "Apricot", "fr": "Abricot"},
    "Gelb": {"en": "Yellow", "fr": "Jaune"},
    "Senf": {"en": "Mustard", "fr": "Moutarde"},
    "Rosa": {"en": "Pink", "fr": "Rose"},
    "Pink": {"en": "Pink", "fr": "Rose"},
    "Rose": {"en": "Rose", "fr": "Rose"},
    "Rosé": {"en": "Rose", "fr": "Rose"},
    "Lila": {"en": "Purple", "fr": "Violet"},
    "Violett": {"en": "Purple", "fr": "Violet"},
    "Flieder": {"en": "Lilac", "fr": "Lilas"},
    "Bunt": {"en": "Multicolor", "fr": "Multicolore"},
    "Mehrfarbig": {"en": "Multicolor", "fr": "Multicolore"},
}
# Google Merchant kennt kein "multicolor": diese Werte fallen im Feed und im
# JSON-LD weg (die übrigen Farben bleiben, höchstens drei, mit "/" verbunden).
MULTICOLOR_WORDS = {"Bunt", "Mehrfarbig"}


def _color_key(word: str) -> str:
    # casefold macht aus "Weiß" und "Weiss" denselben Schlüssel.
    return re.sub(r"\s+", " ", (word or "").strip().casefold())


_COLOR_LOOKUP = {_color_key(k): k for k in COLOR_TR}


def color_canonical(word: str) -> str:
    """'schwarz' -> 'Schwarz'; '' wenn kein bekanntes Farbwort."""
    return _COLOR_LOOKUP.get(_color_key(word), "")


def color_words(value: str | None) -> list[str]:
    """Einzelne Farben aus dem Feld `color` ("Schwarz, Grau" / "Rot/Blau")."""
    out: list[str] = []
    for part in re.split(r"[,/;]", str(value or "")):
        part = part.strip()
        if part and part not in out:
            out.append(part)
    return out


def color_word_tr(word: str, lang: str) -> str:
    if lang == "de":
        return word
    key = color_canonical(word)
    return COLOR_TR[key][lang] if key else word


def color_tr(value: str | None, lang: str) -> str:
    """Anzeigewert des Farbfelds in der Seitensprache ("Schwarz, Grau" -> "Black, Gray")."""
    return ", ".join(color_word_tr(w, lang) for w in color_words(value))


def merchant_color(it: dict, lang: str = "de") -> str:
    """Farbe im Google-Format: höchstens drei Werte mit "/", ohne "Bunt"."""
    worte = [w for w in color_words(it.get("color")) if color_canonical(w) not in MULTICOLOR_WORDS]
    return "/".join(color_word_tr(w, lang) for w in worte[:3])


# ---------------------------------------------------------------- Material
# data/items.json hat (noch) kein Feld `material`. Kommt es aus dem Manager,
# wird es so übernommen - nie aus der Beschreibung geraten. Unbekannte Wörter
# (Markennamen wie "Gore-Tex") bleiben stehen.
MATERIAL_TR = {
    "Leder": {"en": "Leather", "fr": "Cuir"},
    "Wildleder": {"en": "Suede", "fr": "Daim"},
    "Kunstleder": {"en": "Faux leather", "fr": "Similicuir"},
    "Lackleder": {"en": "Patent leather", "fr": "Cuir verni"},
    "Fell": {"en": "Fur", "fr": "Fourrure"},
    "Kunstfell": {"en": "Faux fur", "fr": "Fausse fourrure"},
    "Wolle": {"en": "Wool", "fr": "Laine"},
    "Baumwolle": {"en": "Cotton", "fr": "Coton"},
    "Seide": {"en": "Silk", "fr": "Soie"},
    "Leinen": {"en": "Linen", "fr": "Lin"},
    "Kaschmir": {"en": "Cashmere", "fr": "Cachemire"},
    "Viskose": {"en": "Viscose", "fr": "Viscose"},
    "Polyester": {"en": "Polyester", "fr": "Polyester"},
    "Polyamid": {"en": "Polyamide", "fr": "Polyamide"},
    "Nylon": {"en": "Nylon", "fr": "Nylon"},
    "Elasthan": {"en": "Elastane", "fr": "Élasthanne"},
    "Acryl": {"en": "Acrylic", "fr": "Acrylique"},
    "Denim": {"en": "Denim", "fr": "Denim"},
    "Mesh": {"en": "Mesh", "fr": "Mesh"},
    "Metall": {"en": "Metal", "fr": "Métal"},
    "Kunststoff": {"en": "Plastic", "fr": "Plastique"},
    "Stroh": {"en": "Straw", "fr": "Paille"},
}
_MATERIAL_LOOKUP = {k.casefold(): k for k in MATERIAL_TR}


def material_tr(value: str | None, lang: str) -> str:
    """'Leder, Wolle' -> 'Leather, Wool'; leer ohne Feld."""
    werte = [w.strip() for w in re.split(r"[,/;]", str(value or "")) if w.strip()]
    if lang == "de":
        return ", ".join(werte)
    out = []
    for w in werte:
        key = _MATERIAL_LOOKUP.get(w.casefold())
        out.append(MATERIAL_TR[key][lang] if key else w)
    return ", ".join(out)


# ---------------------------------------------------------------- Titel
GENDER_WORDS = {
    "damen": {"de": "Damen", "en": "Women", "fr": "Femme"},
    "herren": {"de": "Herren", "en": "Men", "fr": "Homme"},
    "unisex": {"de": "Unisex", "en": "Unisex", "fr": "Unisexe"},
}
DEPARTMENT_WORD = {"Women": "damen", "Men": "herren", "Unisex": "unisex"}


def _brand_pattern(name: str) -> re.Pattern:
    return re.compile(r"(?<!\w)" + re.escape(name) + r"(?!\w)", re.I)


def brand_in_title(brand: str, title: str) -> bool:
    return bool(brand) and bool(_brand_pattern(brand).search(title or ""))


def brand_prefix(title: str, brand: str) -> str:
    """Marke so, wie sie am Titelanfang steht ("Pierre Balmain", "Prada Luna
    Rossa", "MM6 Maison Margiela"); sonst die Marke selbst."""
    title = title or ""
    kandidaten = [brand] + [roh for roh, haupt in BRAND_ALIASES.items() if haupt == brand]
    ende = 0
    for name in kandidaten:
        if not name:
            continue
        treffer = _brand_pattern(name).search(title)
        # Nur am Titelanfang (höchstens zwei Wörter davor, etwa "Pierre").
        if treffer and len(title[: treffer.start()].split()) <= 2:
            ende = max(ende, treffer.end())
    return title[:ende].strip() if ende else brand


def _title_tokens(title: str) -> list[str]:
    return [t.strip(",.;:()") for t in (title or "").split()]


def title_gender_word(title: str) -> str:
    """'damen'/'herren'/'unisex', wenn der deutsche Titel es nennt."""
    gefunden = ""
    for token in _title_tokens(title):
        key = token.casefold()
        if key in GENDER_WORDS:
            gefunden = key
    return gefunden


def title_color_words(title: str) -> list[str]:
    """Farbwörter am Titelende ("... Damen Schwarz", "... Schwarz-Weiß")."""
    farben: list[str] = []
    for token in reversed(_title_tokens(title)):
        teile = [color_canonical(t) for t in token.split("-")]
        if not token or not all(teile):
            break
        farben[:0] = teile
    return farben


def derived_title(it: dict, lang: str) -> str:
    """Titel ohne deutsche Wörter: Marke, Produktart, Damen/Herren, Farbe.

    "Prada Loafer Herren Rotbraun" -> "Prada Loafers Men Reddish Brown" /
    "Prada Mocassins Homme Brun rouge". Eigennamen einer Linie gehen dabei
    verloren; dafür gibt es title_en/title_fr in data/items.json.
    """
    title = str(it.get("title") or "").strip()
    brand = canonical_brand(it.get("brand"))
    teile = [brand_prefix(title, brand) if brand else ""]
    teile.append(type_label(it.get("product_type"), lang) or cat_tr(browse_category(it), lang))
    geschlecht = title_gender_word(title)
    if geschlecht:
        teile.append(GENDER_WORDS[geschlecht][lang])
    teile.extend(color_word_tr(w, lang) for w in title_color_words(title))
    abgeleitet = " ".join(t for t in teile if t).strip()
    return abgeleitet or title


def loc_title(it: dict, lang: str) -> str:
    """Titel der Seitensprache: title_en/title_fr, sonst die Ableitung."""
    if lang == "de":
        return str(it.get("title") or "")
    eigen = str(it.get("title_" + lang) or "").strip()
    return eigen or derived_title(it, lang)


def loc_name(it: dict, lang: str = "de") -> str:
    """Marke + Titel; steht die Marke schon im Titel ("MM6 Maison Margiela",
    "Pierre Balmain"), wird sie nicht noch einmal vorangestellt."""
    brand = canonical_brand(it.get("brand"))
    title = loc_title(it, lang)
    if not brand or brand_in_title(brand, title):
        return title
    return (brand + " " + title).strip()


def display_name(it: dict) -> str:
    return loc_name(it, "de")


# ---------------------------------------------------------- Beschreibungen
META = {
    "de": {
        "sold": "{name} – bereits verkauft, Teil des kuratierten Disorder119-Archivs für Designer- und Vintage-Mode.",
        "size": "Größe",
        "tail_suffix": ". Aus dem kuratierten Second-Hand-Archiv von Disorder119.",
        "auto_suffix": ". Aus dem kuratierten Archiv von Disorder119.",
    },
    "en": {
        "sold": "{name} – already sold, part of the curated Disorder119 archive for designer and vintage fashion.",
        "size": "Size",
        "tail_suffix": ". From the curated second-hand archive of Disorder119.",
        "auto_suffix": ". From the curated archive of Disorder119.",
    },
    "fr": {
        "sold": "{name} – déjà vendu, fait partie de l'archive sélectionnée Disorder119 pour la mode de créateurs et vintage.",
        "size": "Taille",
        "tail_suffix": ". Issu de l'archive seconde main sélectionnée de Disorder119.",
        "auto_suffix": ". Issu de l'archive sélectionnée de Disorder119.",
    },
}

# Bausteine, die repair_product_metadata_conservative.py früher in desc_en /
# desc_fr geschrieben hat: Einleitung, "<Titel> by <Marke>.", eine Kette von
# Faktensätzen mit deutschen Werten am Ende ("Category: Shoes. Size: 9.
# Color: Rotbraun.") und der Lückensatz.
_CI_INTRO = {
    "en": re.compile(r"^From the curated (?:second-hand )?(?:archive of Disorder119|Disorder119 archive)\.\s*"),
    "fr": re.compile(r"^Issu (?:des archives sélectionnées|de l[’']archive (?:seconde main )?sélectionnée)(?: de)? Disorder119\.\s*"),
}
_CI_FACTS_TAIL = {
    "en": re.compile(r"(?<=\.)(?:[ \t]+\b(?:Category|Size|Colou?r)[ \t]*:[^\n]*?\.)+[ \t]*$", re.M),
    "fr": re.compile(r"(?<=\.)(?:[ \t]+\b(?:Catégorie|Taille|Couleur)[ \t]*:[^\n]*?\.)+[ \t]*$", re.M),
}
_CI_GAP = {
    "en": "For missing details, please see the photos or ask before buying.",
    "fr": "Pour les informations manquantes, merci de voir les photos ou de nous demander avant l’achat.",
}
_CI_BY = {"en": " by ", "fr": " par "}


def _is_name_only(rest: str, it: dict, lang: str) -> bool:
    """'<Titel> by <Marke>.' ohne weiteren Inhalt."""
    rest = rest.strip()
    marken = {str(it.get("brand") or ""), canonical_brand(it.get("brand")), "Disorder119"}
    for marke in filter(None, marken):
        ende = _CI_BY[lang] + marke + "."
        if rest.endswith(ende) and len(rest) <= len(str(it.get("title") or "")) + len(ende) + 25 \
                and "\n" not in rest:
            return True
    return False


def own_description(it: dict, lang: str) -> str:
    """Eigene Beschreibung der Sprache - bereinigt, ohne deutsche Titel.

    Leer, wenn es keine gibt; dann gilt auto_description()."""
    if lang == "de":
        return str(it.get("desc_de") or it.get("desc") or "").strip()
    text = str(it.get("desc_" + lang) or "").replace("\r\n", "\n").strip()
    if not text:
        return ""
    text = text.replace(" " + _CI_GAP[lang], "").replace(_CI_GAP[lang], "")
    text = _CI_FACTS_TAIL[lang].sub("", text)
    text = re.sub(r"[ \t]+$", "", text, flags=re.M).strip()
    rest = _CI_INTRO[lang].sub("", text, count=1).strip()
    if not rest or _is_name_only(rest, it, lang):
        return ""
    # Der deutsche Titel steht oft wörtlich im Text ("<Titel> by <Marke>.").
    for deutsch, lokal in ((display_name(it), loc_name(it, lang)),
                           (str(it.get("title") or ""), loc_title(it, lang))):
        if deutsch and deutsch != lokal and deutsch in text:
            text = text.replace(deutsch, lokal)
    return text.strip()


def size_phrase(it: dict, lang: str) -> str:
    """'Größe S' / 'Size S'; übersetzte Wörter wie 'One size' oder 'Taille
    unique' stehen auf Englisch und Französisch ohne doppeltes 'Size'."""
    roh = str(it.get("size") or "").strip()
    wert = size_tr(roh, lang)
    if lang != "de" and roh in SIZE_TR:
        return wert[:1].upper() + wert[1:]
    return META[lang]["size"] + " " + wert


def auto_description(it: dict, lang: str) -> str:
    """Sachlicher Ersatztext aus Marke, Kategorie und Größe - nichts erfunden."""
    facts = []
    cat = browse_category(it)
    if cat:
        facts.append(cat_tr(cat, lang))
    if it.get("size"):
        facts.append(size_phrase(it, lang))
    tail = (" – " + ", ".join(facts)) if facts else ""
    return loc_name(it, lang) + tail + META[lang]["auto_suffix"]


def body_description(it: dict, lang: str) -> str:
    return own_description(it, lang) or auto_description(it, lang)


def meta_description(it: dict, lang: str) -> str:
    """'<Name> – <Kategorie>, Größe S' plus eigener Auszug - ohne Zustand
    (Inhaber 07.10.2026: kein Zustand je Artikel)."""
    name = loc_name(it, lang)
    if it.get("public_status") == "SOLD":
        return META[lang]["sold"].format(name=name)
    parts: list[str] = []
    cat = browse_category(it)
    if cat:
        parts.append(cat_tr(cat, lang))
    if it.get("size"):
        parts.append(size_phrase(it, lang))
    prefix = name + ((" – " + ", ".join(parts)) if parts else "")
    return compose_description(prefix, own_description(it, lang), META[lang]["tail_suffix"], name)


def structured_description(it: dict, lang: str, limit: int = 1500) -> str:
    """Beschreibung für JSON-LD: ohne Kopfzeile und Standardsatz, am Satzende
    gekürzt; ohne eigenen Text die Meta-Beschreibung."""
    name = loc_name(it, lang)
    auszug = description_snippet(own_description(it, lang), limit, name)
    return auszug or meta_description(it, lang)


# ---------------------------------------------------------------- Zustand
# Kein Zustand je Artikel (07.10.2026) - mit einer Ausnahme: steht im
# Rohfeld `condition` eindeutig "Neu mit Etikett", gilt das Stück als neu.
# Produktseite (JSON-LD) und Merchant-Feed lesen beide nur diese Funktion.
_NEW_WITH_TAGS = re.compile(
    r"^\s*(?:neu mit (?:original)?etikett(?:en)?|new with tags?|neuf avec [ée]tiquettes?)\s*$", re.I
)


# Zustandsangaben, die in keiner Meta-Beschreibung mehr stehen dürfen
# (scripts/validate_product_seo.py).
CONDITION_PHRASES = {
    "de": {"Zustand": ("Gut", "Sehr gut", "Zufriedenstellend", "Repariert", "Mit Defekt")},
    "en": {"Condition": ("Good", "Very good", "Satisfactory", "Repaired", "With defect")},
    "fr": {"État": ("Bon", "Très bon", "Satisfaisant", "Réparé", "Avec défaut")},
}


def is_new_with_tags(it: dict) -> bool:
    return bool(_NEW_WITH_TAGS.match(str(it.get("condition") or "")))


def item_condition(it: dict) -> str:
    """'new' nur bei eindeutig "Neu mit Etikett", sonst 'used'."""
    return "new" if is_new_with_tags(it) else "used"

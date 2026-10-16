"""Produkttexte je Sprache (DE/EN/FR) - an genau einer Stelle definiert.

Wird von build_site.py (Seitenaufbau, catalog.json, Merchant-Feed) und von
scripts/repair_public_article_integrity.py (setzt Meta-Beschreibung und
"Ähnliche Teile" nach dem Bauen neu) gemeinsam genutzt. Zwei Kopien sind schon
einmal auseinandergelaufen: das Reparaturskript hat danach wieder deutsche
Titel und den Zustand in die EN/FR-Seiten geschrieben.

Titel
  data/items.json kann je Artikel die optionalen Felder title_en/title_fr
  tragen. Fehlen sie, wird der deutsche Titel Wort für Wort übertragen:
  Produktart, Merkmale, Damen/Herren und Farbe aus festen Tabellen,
  unbekannte Wörter (Linien und Modelle wie "America's Cup", "Linea Rossa",
  "Tattoo") bleiben stehen. Diese Ableitung wird nie nach data/items.json
  zurückgeschrieben; die Titelprüfung im Admin sieht weiter nur `title`.

Beschreibungen
  desc_en/desc_fr werden nur noch gelesen. Ältere CI-Platzhalter ("From the
  curated Disorder119 archive. <deutscher Titel> by <Marke>. Color: Rotbraun")
  werden beim Rendern erkannt und durch den übersetzten Ersatztext ersetzt;
  ein wörtlich enthaltener deutscher Titel wird gegen den Titel der Sprache
  getauscht. Meta-Beschreibungen nennen keinen Zustand (Inhaber 07.10.2026).
"""
from __future__ import annotations

import re

from seo_text import _BOILERPLATE, compose_description, description_snippet, type_label

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


def brand_variants(brand: str | None) -> list[str]:
    """Hauptmarke plus alle Rohmarken, die auf sie zeigen ("Dior", "Dior Homme")."""
    haupt = canonical_brand(brand)
    out = [b for b in (brand or "", haupt) if b]
    out += [roh for roh, ziel in BRAND_ALIASES.items() if ziel == haupt and roh not in out]
    return out


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
# Größen, die schon ein Wort sind ("One size") - davor steht kein "Size".
SIZE_TR = {
    "Einheitsgröße": {"de": "Einheitsgröße", "en": "One size", "fr": "Taille unique"},
    "One Size": {"de": "Einheitsgröße", "en": "One size", "fr": "Taille unique"},
    "One size": {"de": "Einheitsgröße", "en": "One size", "fr": "Taille unique"},
    "verstellbar": {"de": "verstellbar", "en": "adjustable", "fr": "réglable"},
    "Größenverstellbar": {"de": "verstellbar", "en": "adjustable", "fr": "réglable"},
    "Adjustable": {"de": "verstellbar", "en": "adjustable", "fr": "réglable"},
    "Kindergröße L": {"de": "Kindergröße L", "en": "Kids' size L", "fr": "Taille enfant L"},
    "Sonstige": {"de": "Sonstige", "en": "Other", "fr": "Autre"},
    "Universal": {"de": "Universal", "en": "One size", "fr": "Taille unique"},
}
# Maße statt Größe ("ca. 28 x 18 x 15.5 cm").
DIMENSIONS_WORD = {"de": "Maße", "en": "Dimensions", "fr": "Dimensions"}
APPROX_WORD = {"de": "ca.", "en": "approx.", "fr": "env."}
_DIMENSIONS = re.compile(r"^\s*(?:ca\.?\s*)?(\d[\d\s.,x×]*cm)\s*$", re.I)


def tr(table: dict, key: str | None, lang: str) -> str:
    entry = table.get(key or "")
    if not entry:
        return key or ""
    return entry.get(lang) or entry.get("de") or ""


def cat_tr(cat: str | None, lang: str) -> str:
    return tr(CATEGORY_TR, cat, lang)


def is_dimensions(size: str | None) -> bool:
    return bool(_DIMENSIONS.match(str(size or "")))


def size_tr(size: str | None, lang: str) -> str:
    """Anzeigewert der Größe: "Einheitsgröße" -> "One size", Maße mit
    "approx."/"env." statt "ca."."""
    roh = str(size or "").strip()
    if roh in SIZE_TR:
        return tr(SIZE_TR, roh, lang)
    masse = _DIMENSIONS.match(roh)
    if masse:
        ca = roh.lower().startswith("ca")
        return ((APPROX_WORD[lang] + " ") if ca else "") + masse.group(1)
    return roh


def size_is_word(size: str | None) -> bool:
    """True für "Einheitsgröße", "verstellbar", Maße: kein "Größe"/"Size" davor."""
    roh = str(size or "").strip()
    return roh in SIZE_TR or is_dimensions(roh)


def browse_category(it: dict) -> str:
    """Geprüfte Taxonomie-Kategorie; die alte `category` nur als Rückfall."""
    return it.get("taxonomy_category") or it.get("category") or ""


# ---------------------------------------------------------------- Größen
# Größensysteme für JSON-LD (schema.org) und Merchant-Feed (g:size_system).
# Gesetzt wird ein System nur mit Beleg - "EU 41"/"IT 42" in size oder
# label_size, bei Schuhen die normalisierte Größe "EU 38". Buchstaben (S, M)
# und Zahlen ohne Angabe bleiben ohne System: italienische Damengrößen wie
# "44" sind keine EU-Größe 44.
SIZE_SYSTEM_URL = {
    "EU": "https://schema.org/WearableSizeSystemEurope",
    "IT": "https://schema.org/WearableSizeSystemIT",
    "FR": "https://schema.org/WearableSizeSystemFR",
    "UK": "https://schema.org/WearableSizeSystemUK",
    "US": "https://schema.org/WearableSizeSystemUS",
}
_LETTER_SIZE = re.compile(r"(?:XXS|XS|S|M|L|XL|XXL|XXXL)", re.I)
_SYSTEM_SIZE = re.compile(r"(EUR|EU|IT|FR|UK|US)\s*(\d{1,2}(?:[.,]\d)?)", re.I)


def _system(code: str) -> str:
    return code.upper().replace("EUR", "EU")


def size_specification(it: dict, lang: str) -> tuple[str, str] | None:
    """(name, system) aus dem Feld size - ("M", "") für "M / 38 / 10",
    ("41", "EU") für "3 / EU 41 / 26 cm", ("42", "IT") bei Etikett "IT 42".
    None, wenn es keine Konfektionsgröße gibt (Maße, "Sonstige", unbekannt)."""
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
            return treffer.group(2).replace(",", "."), _system(treffer.group(1))
    erster = teile[0] if teile else ""
    if not erster or "cm" in erster.lower() or len(erster) > 14:
        return None
    if _LETTER_SIZE.fullmatch(erster):
        return erster.upper(), ""
    if re.fullmatch(r"\d{1,2}(?:[.,]5)?", erster):
        wert = erster.replace(",", ".")
        etikett = _SYSTEM_SIZE.fullmatch(str(it.get("label_size") or "").strip())
        if etikett and etikett.group(2).replace(",", ".") == wert:
            return wert, _system(etikett.group(1))
        normiert = _SYSTEM_SIZE.fullmatch(norm)
        if normiert and normiert.group(2).replace(",", ".") == wert:
            return wert, _system(normiert.group(1))
    return erster, ""


# ---------------------------------------------------------------- Farben
# Schlüssel sind die deutschen Farbwörter aus Titeln und dem Feld `color`
# (Shop-Wortwahl, siehe repair_product_metadata_conservative.COLOR_PATTERNS).
# Englisch wie og:locale en_US. "Lila" und "Violett" bleiben unterscheidbar,
# sonst stünde im Farbfilter zweimal dieselbe Option.
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
    "Lila": {"en": "Purple", "fr": "Mauve"},
    "Violett": {"en": "Violet", "fr": "Violet"},
    "Flieder": {"en": "Lilac", "fr": "Lilas"},
    "Bunt": {"en": "Multicolor", "fr": "Multicolore"},
    "Mehrfarbig": {"en": "Multicolor", "fr": "Multicolore"},
}
# "Bunt" fällt im Feed und im JSON-LD weg, solange eine echte Farbe daneben
# steht. Ist "Bunt" die einzige Angabe, bleibt sie als "Mehrfarbig" stehen -
# Bekleidung ohne Farbe lehnt Google ab.
MULTICOLOR_WORDS = {"Bunt", "Mehrfarbig"}
MULTICOLOR_LABEL = {"de": "Mehrfarbig", "en": "Multicolor", "fr": "Multicolore"}

# Französische Formen für Titel (männlich/weiblich, Einzahl/Mehrzahl). Was
# hier fehlt, ist unveränderlich (marron, orange, kaki, bleu clair ...).
COLOR_FR_FORMS = {
    "Schwarz": ("noir", "noire", "noirs", "noires"),
    "Weiß": ("blanc", "blanche", "blancs", "blanches"),
    "Grau": ("gris", "grise", "gris", "grises"),
    "Silber": ("argenté", "argentée", "argentés", "argentées"),
    "Gold": ("doré", "dorée", "dorés", "dorées"),
    "Beige": ("beige", "beige", "beiges", "beiges"),
    "Natur": ("naturel", "naturelle", "naturels", "naturelles"),
    "Grün": ("vert", "verte", "verts", "vertes"),
    "Blau": ("bleu", "bleue", "bleus", "bleues"),
    "Rot": ("rouge", "rouge", "rouges", "rouges"),
    "Gelb": ("jaune", "jaune", "jaunes", "jaunes"),
    "Rosa": ("rose", "rose", "roses", "roses"),
    "Pink": ("rose", "rose", "roses", "roses"),
    "Rose": ("rose", "rose", "roses", "roses"),
    "Rosé": ("rosé", "rosée", "rosés", "rosées"),
    "Lila": ("mauve", "mauve", "mauves", "mauves"),
    "Violett": ("violet", "violette", "violets", "violettes"),
    "Bunt": ("multicolore", "multicolore", "multicolores", "multicolores"),
    "Mehrfarbig": ("multicolore", "multicolore", "multicolores", "multicolores"),
}
# Vorsilben und Zusätze in freien Farbangaben ("Hellgrau", "Grau meliert").
COLOR_PREFIX = {
    "hell": {"en": "Light", "fr": "clair"},
    "dunkel": {"en": "Dark", "fr": "foncé"},
    "neon": {"en": "Neon", "fr": "fluo"},
    "pastell": {"en": "Pastel", "fr": "pastel"},
}
COLOR_MODIFIER = {
    "meliert": {"en": "Heather", "fr": "chiné"},
    "hell": {"en": "Light", "fr": "clair"},
    "dunkel": {"en": "Dark", "fr": "foncé"},
    "matt": {"en": "Matte", "fr": "mat"},
    "metallic": {"en": "Metallic", "fr": "métallisé"},
    "glänzend": {"en": "Glossy", "fr": "brillant"},
}
_GN_INDEX = {"ms": 0, "fs": 1, "mp": 2, "fp": 3}


def _color_key(word: str) -> str:
    # casefold macht aus "Weiß" und "Weiss" denselben Schlüssel.
    return re.sub(r"\s+", " ", (word or "").strip().casefold())


_COLOR_LOOKUP = {_color_key(k): k for k in COLOR_TR}


def color_canonical(word: str) -> str:
    """'schwarz' -> 'Schwarz'; '' wenn kein bekanntes Farbwort."""
    return _COLOR_LOOKUP.get(_color_key(word), "")


def _prefixed_color(word: str) -> tuple[str, str]:
    """('hell', 'Grau') für 'Hellgrau'; ('', '') sonst."""
    klein = (word or "").strip().casefold()
    for vorsilbe in COLOR_PREFIX:
        if klein.startswith(vorsilbe) and len(klein) > len(vorsilbe):
            basis = color_canonical(word.strip()[len(vorsilbe):])
            if basis:
                return vorsilbe, basis
    return "", ""


def is_color_word(word: str) -> bool:
    return bool(color_canonical(word) or _prefixed_color(word)[1])


def color_words(value: str | None) -> list[str]:
    """Einzelne Farben aus dem freien Feld `color`: "Schwarz, Grau",
    "Rot/Blau", "Schwarz und Gold", "Schwarz & Gold", "Schwarz-Weiß".
    "Grau meliert" bleibt eine Farbe."""
    out: list[str] = []
    for teil in re.split(r"\s*(?:[,/;&+]|\bund\b|\band\b|\bet\b)\s*", str(value or ""), flags=re.I):
        teil = teil.strip(" -")
        if not teil:
            continue
        stuecke = [s for s in teil.split("-") if s.strip()]
        if len(stuecke) > 1 and all(is_color_word(s.strip()) for s in stuecke):
            kandidaten = [s.strip() for s in stuecke]
        else:
            kandidaten = [teil]
        for k in kandidaten:
            if k not in out:
                out.append(k)
    return out


def _single_color(token: str, lang: str) -> str:
    """Ein Farbwort übersetzen ("Grau", "Hellgrau"); '' wenn unbekannt."""
    key = color_canonical(token)
    if key:
        return COLOR_TR[key][lang]
    vorsilbe, basis = _prefixed_color(token)
    if basis:
        farbe = COLOR_TR[basis][lang]
        zusatz = COLOR_PREFIX[vorsilbe][lang]
        return f"{zusatz} {farbe}" if lang == "en" else f"{farbe} {zusatz}"
    return ""


def color_word_tr(word: str, lang: str) -> str:
    """Eine Farbangabe in der Seitensprache. Bekannte Wörter werden einzeln
    übersetzt ("Grau meliert" -> "Heather Gray" / "Gris chiné"); unbekannte
    bleiben stehen (scripts/validate_i18n_titles.py meldet sie als Hinweis)."""
    if lang == "de":
        return word
    ganz = _single_color(word, lang)
    if ganz:
        return ganz
    farben: list[str] = []
    zusaetze: list[str] = []
    for token in re.split(r"[\s\-]+", word.strip()):
        if not token:
            continue
        uebersetzt = _single_color(token, lang)
        if uebersetzt:
            farben.append(uebersetzt)
        elif token.casefold() in COLOR_MODIFIER:
            zusaetze.append(COLOR_MODIFIER[token.casefold()][lang])
        else:
            farben.append(token)
    teile = (zusaetze + farben) if lang == "en" else (farben + zusaetze)
    text = " ".join(teile)
    return text[:1].upper() + text[1:]


def unknown_color_words(value: str | None) -> list[str]:
    """Wörter im Farbfeld, die keine Tabelle kennt (bleiben auf EN/FR deutsch)."""
    out = []
    for farbe in color_words(value):
        for token in re.split(r"[\s\-]+", farbe):
            if token and not is_color_word(token) and token.casefold() not in COLOR_MODIFIER:
                out.append(token)
    return out


def color_tr(value: str | None, lang: str) -> str:
    """Anzeigewert des Farbfelds in der Seitensprache ("Schwarz, Grau" -> "Black, Gray")."""
    return ", ".join(color_word_tr(w, lang) for w in color_words(value))


def merchant_color(it: dict, lang: str = "de") -> str:
    """Farbe im Google-Format: höchstens drei Werte mit "/". "Bunt" nur, wenn
    sonst keine Farbe angegeben ist - dann als "Mehrfarbig"/"Multicolor"."""
    farben = color_words(it.get("color"))
    echte = [w for w in farben if color_canonical(w) not in MULTICOLOR_WORDS]
    if not echte:
        return MULTICOLOR_LABEL[lang] if farben else ""
    return "/".join(color_word_tr(w, lang) for w in echte[:3])


def _color_title(word: str, lang: str, gn: str) -> str:
    """Farbe im Titel; französisch an die Produktart angeglichen ("veste noire")."""
    if lang != "fr":
        return color_word_tr(word, lang)
    key = color_canonical(word)
    if key in COLOR_FR_FORMS:
        return COLOR_FR_FORMS[key][_GN_INDEX[gn]]
    return color_word_tr(word, "fr").lower()


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
    "damen": {"de": "Damen", "en": "Women's", "fr": "femme"},
    "herren": {"de": "Herren", "en": "Men's", "fr": "homme"},
    "unisex": {"de": "Unisex", "en": "Unisex", "fr": "unisexe"},
}
DEPARTMENT_WORD = {"Women": "damen", "Men": "herren", "Unisex": "unisex"}

# Produktart im Titel: deutsches (oder schon englisches) Wort ->
# (Englisch, Französisch, Genus/Numerus für die Angleichung im Französischen).
# Schlüssel klein geschrieben; Wörter mit Bindestrich als Ganzes.
NOUN_TR = {
    "anzug": ("Suit", "costume", "ms"),
    "anzughose": ("Suit Pants", "pantalon de costume", "ms"),
    "badeshorts": ("Swim Shorts", "short de bain", "ms"),
    "ballonkleid": ("Balloon Dress", "robe ballon", "fs"),
    "ballonrock": ("Balloon Skirt", "jupe ballon", "fs"),
    "beanie": ("Beanie", "bonnet", "ms"),
    "bikerjacke": ("Biker Jacket", "perfecto", "ms"),
    "blazer": ("Blazer", "blazer", "ms"),
    "blumenkleid": ("Floral Dress", "robe à fleurs", "fs"),
    "bluse": ("Blouse", "chemisier", "ms"),
    "bomberjacke": ("Bomber Jacket", "blouson aviateur", "ms"),
    "boots": ("Boots", "bottes", "fp"),
    "cap": ("Cap", "casquette", "fs"),
    "cardigan": ("Cardigan", "cardigan", "ms"),
    "cargohose": ("Cargo Pants", "pantalon cargo", "ms"),
    "daunenjacke": ("Down Jacket", "doudoune", "fs"),
    "fellstola": ("Fur Stole", "étole en fourrure", "fs"),
    "fleecejacke": ("Fleece Jacket", "veste polaire", "fs"),
    "flip-flops": ("Flip-Flops", "tongs", "fp"),
    "funktionsjacke": ("Technical Jacket", "veste technique", "fs"),
    "geldbörse": ("Wallet", "portefeuille", "ms"),
    "gürtel": ("Belt", "ceinture", "fs"),
    "hemd": ("Shirt", "chemise", "fs"),
    "hemdjacke": ("Shirt Jacket", "surchemise", "fs"),
    "hoodie": ("Hoodie", "sweat à capuche", "ms"),
    "hose": ("Pants", "pantalon", "ms"),
    "hut": ("Hat", "chapeau", "ms"),
    "jacke": ("Jacket", "veste", "fs"),
    "jeans": ("Jeans", "jean", "ms"),
    "jogginghose": ("Joggers", "jogging", "ms"),
    "kapuzenjacke": ("Hooded Jacket", "veste à capuche", "fs"),
    "kleid": ("Dress", "robe", "fs"),
    "loafer": ("Loafers", "mocassins", "mp"),
    "longsleeve": ("Long Sleeve Top", "t-shirt à manches longues", "ms"),
    "mantel": ("Coat", "manteau", "ms"),
    "mantelkleid": ("Coat Dress", "robe manteau", "fs"),
    "maxikleid": ("Maxi Dress", "robe longue", "fs"),
    "maxirock": ("Maxi Skirt", "jupe longue", "fs"),
    "mütze": ("Beanie", "bonnet", "ms"),
    "parka": ("Parka", "parka", "fs"),
    "poloshirt": ("Polo Shirt", "polo", "ms"),
    "pullover": ("Sweater", "pull", "ms"),
    "pumps": ("Pumps", "escarpins", "mp"),
    "rock": ("Skirt", "jupe", "fs"),
    "rucksack": ("Backpack", "sac à dos", "ms"),
    "sandalen": ("Sandals", "sandales", "fp"),
    "sandaletten": ("Sandals", "sandales", "fp"),
    "schal": ("Scarf", "écharpe", "fs"),
    "schnürstiefel": ("Lace-Up Boots", "bottes à lacets", "fp"),
    "schuhe": ("Shoes", "chaussures", "fp"),
    "schwanengürtel": ("Swan Belt", "ceinture cygne", "fs"),
    "set": ("Set", "ensemble", "ms"),
    "shorts": ("Shorts", "short", "ms"),
    "slide-sandalen": ("Slide Sandals", "claquettes", "fp"),
    "sneaker": ("Sneakers", "baskets", "fp"),
    "sneakers": ("Sneakers", "baskets", "fp"),
    "sonnenbrille": ("Sunglasses", "lunettes de soleil", "fp"),
    "steppjacke": ("Quilted Jacket", "veste matelassée", "fs"),
    "steppweste": ("Quilted Vest", "gilet matelassé", "ms"),
    "stiefel": ("Boots", "bottes", "fp"),
    "stiefeletten": ("Ankle Boots", "bottines", "fp"),
    "strickjacke": ("Cardigan", "cardigan", "ms"),
    "stricktop": ("Knit Top", "haut en maille", "ms"),
    "strohhut": ("Straw Hat", "chapeau de paille", "ms"),
    "sweatjacke": ("Zip Sweatshirt", "sweat zippé", "ms"),
    "sweatshirt": ("Sweatshirt", "sweat-shirt", "ms"),
    "t-shirt": ("T-Shirt", "t-shirt", "ms"),
    "tanktop": ("Tank Top", "débardeur", "ms"),
    "tasche": ("Bag", "sac", "ms"),
    "testartikel": ("Test Item", "article test", "ms"),
    "toaster": ("Toaster", "grille-pain", "ms"),
    "top": ("Top", "haut", "ms"),
    "trainingsjacke": ("Track Jacket", "veste de survêtement", "fs"),
    "trenchcoat": ("Trench Coat", "trench", "ms"),
    "tunika": ("Tunic", "tunique", "fs"),
    "unterhose": ("Underwear", "culotte", "fs"),
    "weste": ("Vest", "gilet", "ms"),
    "winterjacke": ("Winter Jacket", "veste d'hiver", "fs"),
}
# Ohne Produktwort im Titel: die Produktart aus product_type.
TYPE_NOUN = {
    "Accessory": ("Accessory", "accessoire", "ms"),
    "Backpack": ("Backpack", "sac à dos", "ms"),
    "Bag": ("Bag", "sac", "ms"),
    "Beanie": ("Beanie", "bonnet", "ms"),
    "Belt": ("Belt", "ceinture", "fs"),
    "Biker Jacket": ("Biker Jacket", "perfecto", "ms"),
    "Blazer": ("Blazer", "blazer", "ms"),
    "Blouse": ("Blouse", "chemisier", "ms"),
    "Bomber Jacket": ("Bomber Jacket", "blouson aviateur", "ms"),
    "Boots": ("Boots", "bottes", "fp"),
    "Cap": ("Cap", "casquette", "fs"),
    "Cardigan": ("Cardigan", "cardigan", "ms"),
    "Coat": ("Coat", "manteau", "ms"),
    "Design Object": ("Design Object", "objet design", "ms"),
    "Dress": ("Dress", "robe", "fs"),
    "Hat": ("Hat", "chapeau", "ms"),
    "Heels": ("Heels", "escarpins", "mp"),
    "Jacket": ("Jacket", "veste", "fs"),
    "Joggers": ("Joggers", "jogging", "ms"),
    "Knit Top": ("Knit Top", "haut en maille", "ms"),
    "Loafers": ("Loafers", "mocassins", "mp"),
    "Long Sleeve": ("Long Sleeve Top", "t-shirt à manches longues", "ms"),
    "Polo Shirt": ("Polo Shirt", "polo", "ms"),
    "Sandals": ("Sandals", "sandales", "fp"),
    "Scarf": ("Scarf", "écharpe", "fs"),
    "Set": ("Set", "ensemble", "ms"),
    "Shirt": ("Shirt", "chemise", "fs"),
    "Shoes": ("Shoes", "chaussures", "fp"),
    "Shorts": ("Shorts", "short", "ms"),
    "Skirt": ("Skirt", "jupe", "fs"),
    "Sleepwear": ("Sleepwear", "vêtement de nuit", "ms"),
    "Sneakers": ("Sneakers", "baskets", "fp"),
    "Suit": ("Suit", "costume", "ms"),
    "Sunglasses": ("Sunglasses", "lunettes de soleil", "fp"),
    "Sweater": ("Sweater", "pull", "ms"),
    "Sweatshirt": ("Sweatshirt", "sweat-shirt", "ms"),
    "Swim Shorts": ("Swim Shorts", "short de bain", "ms"),
    "T-Shirt": ("T-Shirt", "t-shirt", "ms"),
    "Tank Top": ("Tank Top", "débardeur", "ms"),
    "Toaster": ("Toaster", "grille-pain", "ms"),
    "Top": ("Top", "haut", "ms"),
    "Trench Coat": ("Trench Coat", "trench", "ms"),
    "Trousers": ("Pants", "pantalon", "ms"),
    "Tunic": ("Tunic", "tunique", "fs"),
    "Underwear Shorts": ("Underwear", "culotte", "fs"),
    "Vest": ("Vest", "gilet", "ms"),
    "Wallet": ("Wallet", "portefeuille", "ms"),
}
# Vorderteil eines zusammengesetzten Worts ("Leder-Boots", "Lederjacke").
# Französisch steht es hinter der Produktart; ein Tupel heißt: wird
# angeglichen (männlich/weiblich, Einzahl/Mehrzahl).
PREFIX_TR = {
    "leder": ("Leather", "en cuir"),
    "wildleder": ("Suede", "en daim"),
    "kunstleder": ("Faux Leather", "en similicuir"),
    "kunstfell": ("Faux Fur", "en fausse fourrure"),
    "nylon": ("Nylon", "en nylon"),
    "mesh": ("Mesh", "en mesh"),
    "cord": ("Corduroy", "en velours côtelé"),
    "denim": ("Denim", "en denim"),
    "jeans": ("Denim", "en jean"),
    "seiden": ("Silk", "en soie"),
    "seide": ("Silk", "en soie"),
    "woll": ("Wool", "en laine"),
    "wolle": ("Wool", "en laine"),
    "kaschmir": ("Cashmere", "en cachemire"),
    "logo": ("Logo", "à logo"),
    "grafik": ("Graphic", ("graphique", "graphique", "graphiques", "graphiques")),
    "klett": ("Velcro", "à scratch"),
    "metallic": ("Metallic", ("métallisé", "métallisée", "métallisés", "métallisées")),
    "military": ("Military", ("militaire", "militaire", "militaires", "militaires")),
    "monogramm": ("Monogram", "monogramme"),
    "nadelstreifen": ("Pinstripe", "à fines rayures"),
    "patchwork": ("Patchwork", "patchwork"),
    "plateau": ("Platform", "à plateforme"),
    "walking": ("Walking", "de marche"),
    "kurzarm": ("Short-Sleeve", "à manches courtes"),
    "langarm": ("Long-Sleeve", "à manches longues"),
    "half-zip": ("Half-Zip", ("demi-zippé", "demi-zippée", "demi-zippés", "demi-zippées")),
    "zip": ("Zip", ("zippé", "zippée", "zippés", "zippées")),
    "high-top": ("High-Top", ("montant", "montante", "montants", "montantes")),
    "low-top": ("Low-Top", ("bas", "basse", "bas", "basses")),
    "wende": ("Reversible", ("réversible", "réversible", "réversibles", "réversibles")),
    "winter": ("Winter", "d'hiver"),
    "fleece": ("Fleece", "polaire"),
    "stepp": ("Quilted", ("matelassé", "matelassée", "matelassés", "matelassées")),
}
# Eigenschaftswörter vor der Produktart (Stamm ohne Endung).
ADJ_TR = {
    "asymmetrisch": ("Asymmetric", ("asymétrique", "asymétrique", "asymétriques", "asymétriques")),
    "marmoriert": ("Marbled", ("marbré", "marbrée", "marbrés", "marbrées")),
    "drapiert": ("Draped", ("drapé", "drapée", "drapés", "drapées")),
    "gepunktet": ("Polka-Dot", "à pois"),
    "gestreift": ("Striped", ("rayé", "rayée", "rayés", "rayées")),
    "kariert": ("Checked", "à carreaux"),
    "kurz": ("Short", ("court", "courte", "courts", "courtes")),
    "lang": ("Long", ("long", "longue", "longs", "longues")),
    "leicht": ("Lightweight", ("léger", "légère", "légers", "légères")),
    "meliert": ("Melange", ("chiné", "chinée", "chinés", "chinées")),
    "oversized": ("Oversized", "oversize"),
    "gesteppt": ("Quilted", ("matelassé", "matelassée", "matelassés", "matelassées")),
    "bestickt": ("Embroidered", ("brodé", "brodée", "brodés", "brodées")),
    "geblümt": ("Floral", "à fleurs"),
}
_ADJ_ENDINGS = ("es", "er", "en", "em", "e")
# Wendungen hinter der Produktart ("mit Schnalle", "aus Wolle"). Englisch mit
# "^" davor: steht vor der Produktart ("Wool Top").
POST_TR = {
    "mit logo-bügeln": ("with Logo Temples", "à branches logo"),
    "mit riemen": ("with Straps", "à brides"),
    "mit schnalle": ("with Buckle", "à boucle"),
    "mit rillensohle": ("with Lug Sole", "à semelle crantée"),
    "mit muster": ("with Pattern", "à motifs"),
    "mit print": ("with Print", ("imprimé", "imprimée", "imprimés", "imprimées")),
    "mit fellkragen": ("with Fur Collar", "à col en fourrure"),
    "mit kunstfellkragen": ("with Faux Fur Collar", "à col en fausse fourrure"),
    "mit felloptik-kragen": ("with Faux Fur Collar", "à col effet fourrure"),
    "mit lederdetails": ("with Leather Details", "à détails en cuir"),
    "mit bändern": ("with Ribbons", "à rubans"),
    "mit bienen-patch": ("with Bee Patch", "à patch abeille"),
    "mit flügel-print": ("with Wing Print", "à imprimé ailes"),
    "mit strand-print": ("with Beach Print", "à imprimé plage"),
    "mit barockmuster": ("with Baroque Pattern", "à motif baroque"),
    "mit gürtel": ("with Belt", "à ceinture"),
    "mit nieten": ("with Studs", "à clous"),
    "mit perlenknöpfen": ("with Pearl Buttons", "à boutons de perle"),
    "mit streifenkragen": ("with Striped Collar", "à col rayé"),
    "mit kapuze": ("with Hood", "à capuche"),
    "aus wolle": ("^Wool", "en laine"),
    "aus leder": ("^Leather", "en cuir"),
    "aus seide": ("^Silk", "en soie"),
    "in knitteroptik": ("with Crinkle Effect", "effet froissé"),
}
_PREPOSITIONS = {"mit", "aus", "in", "ohne", "für"}


def _fr_form(value, gn: str) -> str:
    return value if isinstance(value, str) else value[_GN_INDEX[gn]]


def _brand_pattern(name: str) -> re.Pattern:
    return re.compile(r"(?<!\w)" + re.escape(name) + r"(?!\w)", re.I)


def brand_in_title(brand: str, title: str) -> bool:
    return bool(brand) and bool(_brand_pattern(brand).search(title or ""))


def brand_prefix(title: str, brand: str) -> str:
    """Marke so, wie sie am Titelanfang steht ("Pierre Balmain", "Prada Luna
    Rossa", "MM6 Maison Margiela", "Jil Sander+"); sonst die Marke selbst."""
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
    if not ende:
        return brand
    # Zusatz direkt an der Marke gehört dazu ("Jil Sander+").
    while ende < len(title) and not title[ende].isspace():
        ende += 1
    return title[:ende].strip()


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


def _adj(token: str):
    klein = token.casefold()
    if klein in ADJ_TR:
        return ADJ_TR[klein]
    for endung in _ADJ_ENDINGS:
        if klein.endswith(endung) and klein[: -len(endung)] in ADJ_TR:
            return ADJ_TR[klein[: -len(endung)]]
    return None


def _prefix_parts(teile: list[str]) -> list[tuple]:
    """Vorderteile eines Kompositums: ('tr', en, fr) oder ('keep', text)."""
    if not teile:
        return []
    ganz = "-".join(teile).casefold()
    if ganz in PREFIX_TR:
        en, fr = PREFIX_TR[ganz]
        return [("tr", en, fr)]
    out: list[tuple] = []
    behalten: list[str] = []
    for teil in teile:
        eintrag = PREFIX_TR.get(teil.casefold())
        if eintrag:
            if behalten:
                out.append(("keep", "-".join(behalten)))
                behalten = []
            out.append(("tr", eintrag[0], eintrag[1]))
        else:
            behalten.append(teil)
    if behalten:
        out.append(("keep", "-".join(behalten)))
    return out


_NOUN_SUFFIXES = sorted((k for k in NOUN_TR if "-" not in k and len(k) >= 3), key=len, reverse=True)


def _noun(token: str):
    """(Eintrag aus NOUN_TR, Vorderteile, verworfen) oder None."""
    klein = token.casefold()
    if klein in NOUN_TR:
        return NOUN_TR[klein], [], []
    teile = token.split("-")
    if len(teile) > 1:
        for k in range(1, len(teile)):
            kopf = "-".join(teile[k:]).casefold()
            if kopf in NOUN_TR:
                return NOUN_TR[kopf], _prefix_parts(teile[:k]), []
    # Zusammengeschrieben: "Lederjacke", "Seidentop", "Wollhut".
    if token[:1].isupper():
        for kopf in _NOUN_SUFFIXES:
            if klein.endswith(kopf) and len(klein) > len(kopf):
                vorne = klein[: -len(kopf)]
                eintrag = PREFIX_TR.get(vorne)
                if eintrag:
                    return NOUN_TR[kopf], [("tr", eintrag[0], eintrag[1])], []
                # Unbekannter deutscher Vorderteil: nur die Produktart. Kurze
                # Endungen ("set", "top", "hut") nicht - "Sunset" ist ein Name.
                if len(kopf) >= 4:
                    return NOUN_TR[kopf], [], [token]
    return None


def title_parts(it: dict, lang: str) -> tuple[str, list[str]]:
    """(Titel der Sprache, verworfene deutsche Wörter) - siehe derived_title."""
    title = str(it.get("title") or "").strip()
    brand = canonical_brand(it.get("brand"))
    prefix = brand_prefix(title, brand) if brand else ""
    rest = title[len(prefix):].strip() if prefix and title.startswith(prefix) else title
    tokens = [t for t in rest.split() if t]

    farben: list[str] = []
    while tokens and all(color_canonical(t) for t in tokens[-1].split("-")):
        farben[:0] = [color_canonical(t) for t in tokens.pop().split("-")]
    geschlecht = ""
    uebrig: list[str] = []
    for t in tokens:
        if t.casefold() in GENDER_WORDS:
            geschlecht = t.casefold()
        else:
            uebrig.append(t)
    tokens = uebrig

    verworfen: list[str] = []
    # Wendungen ab der ersten Präposition ("mit Schnalle").
    post: list[tuple] = []
    for i, t in enumerate(tokens):
        if t.casefold() in _PREPOSITIONS:
            phrase = " ".join(tokens[i:])
            eintrag = POST_TR.get(phrase.casefold())
            if eintrag:
                post.append(eintrag)
            else:
                verworfen.append(phrase)
            tokens = tokens[:i]
            break

    kopf = None
    kopf_index = -1
    for i, t in enumerate(tokens):
        gefunden = _noun(t)
        if gefunden:
            kopf, kopf_index = gefunden, i
            break
    if kopf:
        (n_en, n_fr, gn), vorderteile, weg = kopf
        verworfen += weg
        vor, nach = tokens[:kopf_index], tokens[kopf_index + 1:]
    else:
        n_en, n_fr, gn = TYPE_NOUN.get(str(it.get("product_type") or ""), ("", "", "ms"))
        if not n_en:
            label = cat_tr(browse_category(it), "en")
            n_en, n_fr, gn = label, cat_tr(browse_category(it), "fr").lower(), "ms"
        vorderteile, vor, nach = [], tokens, []

    linie: list[str] = []      # unbekannte Wörter vor dem ersten Merkmal
    merkmale: list[tuple] = []  # ('adj', en, fr) oder ('keep', text)
    for t in vor:
        adj = _adj(t)
        if adj:
            merkmale.append(("adj", adj[0], adj[1]))
        elif merkmale:
            merkmale.append(("keep", t))
        else:
            linie.append(t)

    if lang == "en":
        teile = [prefix] + linie
        if geschlecht:
            teile.append(GENDER_WORDS[geschlecht]["en"])
        teile += [m[1] for m in merkmale]
        if farben:
            teile.append(" and ".join(color_word_tr(f, "en") for f in farben))
        teile += [p[0][1:] for p in post if p[0].startswith("^")]
        teile += [v[1] for v in vorderteile]
        teile.append(n_en)
        teile += nach
        teile += [p[0] for p in post if not p[0].startswith("^")]
    else:
        teile = [prefix] + linie + [n_fr]
        teile += [v[1] for v in vorderteile if v[0] == "keep"]
        teile += [_fr_form(v[2], gn) for v in vorderteile if v[0] == "tr"]
        teile += [m[1] if m[0] == "keep" else _fr_form(m[2], gn) for m in merkmale]
        teile += nach
        teile += [_fr_form(p[1], gn) for p in post]
        if geschlecht:
            teile.append(GENDER_WORDS[geschlecht]["fr"])
        if farben:
            teile.append(" et ".join(_color_title(f, "fr", gn) for f in farben))
    abgeleitet = re.sub(r"\s+", " ", " ".join(t for t in teile if t)).strip()
    return (abgeleitet or title), verworfen


def derived_title(it: dict, lang: str) -> str:
    """Titel ohne deutsche Wörter, Wort für Wort aus dem deutschen Titel.

    "Prada America's Cup Sneaker Damen Dunkelblau" ->
    "Prada America's Cup Women's Dark Blue Sneakers" /
    "Prada America's Cup baskets femme bleu foncé". Linien und Modellnamen
    bleiben stehen; Französisch mit angeglichener Farbe ("veste noire").
    """
    return title_parts(it, lang)[0]


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
# Color: Rotbraun.") und der Lückensatz. Älter: "<Titel> – pants. From the
# curated Disorder119 archive. Category: Pants."
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
_CI_OLD_FORM = {
    "en": re.compile(r"^[^\n]{1,200} – [^.\n]{1,60}\.\s*From the curated (?:second-hand )?"
                     r"(?:archive of Disorder119|Disorder119 archive)\.?\s*$"),
    "fr": re.compile(r"^[^\n]{1,200} – [^.\n]{1,60}\.\s*Issu (?:des archives sélectionnées|de l[’']archive "
                     r"(?:seconde main )?sélectionnée)(?: de)? Disorder119\.?\s*$"),
}


def _is_name_only(rest: str, it: dict, lang: str) -> bool:
    """'<Titel> by <Marke>.' ohne weiteren Inhalt (auch mit Rohmarke wie
    "Dior Homme", die im Shop unter "Dior" läuft)."""
    rest = rest.strip()
    for marke in brand_variants(it.get("brand")) + ["Disorder119"]:
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
    if _CI_OLD_FORM[lang].match(text):
        return ""
    rest = _CI_INTRO[lang].sub("", text, count=1).strip()
    if not rest or _is_name_only(rest, it, lang):
        return ""
    # Der deutsche Titel steht oft wörtlich im Text ("<Titel> by <Marke>.").
    for deutsch, lokal in ((display_name(it), loc_name(it, lang)),
                           (str(it.get("title") or ""), loc_title(it, lang))):
        if deutsch and deutsch != lokal and deutsch in text:
            text = text.replace(deutsch, lokal)
    return text.strip()


# Zustand: Absätze mit "Hinweis zum Zustand: ..." und Sätze wie "neu mit
# Originaletiketten" bleiben in der sichtbaren Beschreibung, aber nie in
# Meta-, og- und twitter-Beschreibungen (Inhaber 07.10.2026).
_CONDITION_LABEL = (r"(?:Hinweis zum Zustand|Zustandshinweis|Zustand|Condition note|Note on condition|Condition"
                    r"|Remarque sur l[’']état|État|Etat)")
_CONDITION_PARAGRAPH = re.compile(r"^\s*" + _CONDITION_LABEL + r"\s*:", re.I)
_CONDITION_HEADING = re.compile(r"^\s*" + _CONDITION_LABEL + r"\s*:?\s*$", re.I)
_NEW_WITH_TAGS = r"(?:neu mit (?:Original)?etikett(?:en)?|new with (?:original )?tags?|neuf avec (?:ses )?(?:[ée]tiquettes?)(?: d[’']origine)?)"
_CONDITION_SENTENCE = re.compile(r"[^.!?\n]*\b" + _NEW_WITH_TAGS + r"[^.!?\n]*[.!?]?", re.I)
# Prüfmuster für Meta-Texte (scripts/validate_product_seo.py).
CONDITION_META_RE = re.compile(
    r"(?:Hinweis zum Zustand|Zustand\s*:|Zustand (?:Gut|Sehr gut|Zufriedenstellend|Repariert|Mit Defekt)"
    r"|Condition note|Note on condition|Condition\s*:|Condition (?:Good|Very good|Satisfactory|Repaired|With defect)"
    r"|Remarque sur l[’']état|État\s*:|État (?:Bon|Très bon|Satisfaisant|Réparé|Avec défaut)|"
    + _NEW_WITH_TAGS + r")",
    re.I,
)


def without_condition(text: str) -> str:
    """Text ohne Zustandsangaben - Quelle für Meta-Beschreibungen."""
    absaetze = re.split(r"\n\s*\n", (text or "").replace("\r\n", "\n"))
    behalten: list[str] = []
    for absatz in absaetze:
        if _CONDITION_HEADING.match(absatz.split("\n", 1)[0]) and "\n" not in absatz.strip():
            break  # Abschnitt "Zustand:" - alles danach gehört dazu
        if _CONDITION_PARAGRAPH.match(absatz):
            continue
        behalten.append(absatz)
    rest = "\n\n".join(behalten)
    rest = _CONDITION_SENTENCE.sub("", rest)
    return re.sub(r"[ \t]+\n", "\n", rest).strip()


def size_phrase(it: dict, lang: str) -> str:
    """'Größe S' / 'Size S'; übersetzte Wörter wie 'One size' oder 'Taille
    unique' ohne doppeltes 'Size'; Maße als 'Dimensions approx. ...'."""
    roh = str(it.get("size") or "").strip()
    wert = size_tr(roh, lang)
    if roh in SIZE_TR:
        return wert[:1].upper() + wert[1:]
    if is_dimensions(roh):
        return DIMENSIONS_WORD[lang] + " " + wert
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


def _starts_with_brand(line: str, it: dict) -> bool:
    """Marke am Zeilenanfang, höchstens zwei Wörter davor ("Christian Dior ...")."""
    for marke in brand_variants(it.get("brand")):
        treffer = _brand_pattern(marke).search(line or "")
        if treffer and len(line[: treffer.start()].split()) <= 2:
            return True
    return False


def _clean_visible(text: str, it: dict) -> str:
    """Ohne Kopfzeile ("Jean Paul Gaultier Tattoo Dress Multicolor M") und
    ohne den Standardsatz "Aus dem kuratierten Archiv von Disorder119." -
    wie die Beschreibung im JSON-LD (seo_text.description_snippet)."""
    absaetze = [a.strip() for a in re.split(r"\n\s*\n", text.replace("\r\n", "\n")) if a.strip()]
    if len(absaetze) > 1:
        erste = absaetze[0]
        if "\n" not in erste and len(erste) <= 100 and not re.search(r"[.!?:]$", erste) \
                and _starts_with_brand(erste, it):
            absaetze = absaetze[1:]
    out = []
    for absatz in absaetze:
        absatz = _BOILERPLATE.sub(" ", absatz)
        absatz = re.sub(r"[ \t]{2,}", " ", absatz).strip()
        if absatz:
            out.append(absatz)
    return "\n\n".join(out)


def body_description(it: dict, lang: str) -> str:
    """Sichtbare Beschreibung: eigener Text ohne Kopfzeile und Standardsatz.
    Bleibt danach nichts Eigenes übrig, steht der Text unverändert da; ohne
    eigenen Text der übersetzte Ersatztext."""
    eigen = own_description(it, lang)
    if not eigen:
        return auto_description(it, lang)
    bereinigt = _clean_visible(eigen, it)
    if bereinigt and description_snippet(bereinigt, 1500, loc_name(it, lang)):
        return bereinigt
    return eigen


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
    return compose_description(prefix, without_condition(own_description(it, lang)), META[lang]["tail_suffix"], name)


def structured_description(it: dict, lang: str, limit: int = 1500) -> str:
    """Beschreibung für JSON-LD: ohne Kopfzeile und Standardsatz, am Satzende
    gekürzt; ohne eigenen Text die Meta-Beschreibung."""
    name = loc_name(it, lang)
    auszug = description_snippet(own_description(it, lang), limit, name)
    return auszug or meta_description(it, lang)


# ---------------------------------------------------------------- Zustand
# Kein Zustand je Artikel (07.10.2026, Bericht 1 P1-6): JSON-LD und
# Merchant-Feed melden jedes Stück als gebraucht - auch eines, dessen
# Beschreibung "neu mit Etikett" sagt. Eine Ausnahme wäre eine Entscheidung
# des Inhabers (mit eigenem Hinweistext auf der Seite).
CONDITION_PHRASES = {
    "de": {"Zustand": ("Gut", "Sehr gut", "Zufriedenstellend", "Repariert", "Mit Defekt")},
    "en": {"Condition": ("Good", "Very good", "Satisfactory", "Repaired", "With defect")},
    "fr": {"État": ("Bon", "Très bon", "Satisfaisant", "Réparé", "Avec défaut")},
}


def item_condition(it: dict) -> str:
    """Immer 'used' - Feed (g:condition) und JSON-LD (UsedCondition) gleich."""
    return "used"

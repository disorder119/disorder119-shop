"""Markenseiten: /marke/<slug>/ und die Uebersicht /marken/ (DE, /en/, /fr/).

Eigene, indexierbare Adresse je Marke, damit der Shop fuer "Marke + Second
Hand / Vintage" gefunden werden kann. Bisher gab es Marken nur als Filter der
Startseite (/?brand=..., canonical auf /), also keine Seite, die Google fuer
eine Marke zeigen konnte.

Die Seiten sind fertiges HTML ohne Skript: jedes verfuegbare Teil ist ein
echter Link mit Bild, Titel, Groesse und Preis; verkaufte Teile der Marke
stehen darunter als kleinere Liste. Der Text je Marke kommt aus
config/marken-texte.json (gepflegtes Wissen ueber die Marke) plus einem
Absatz, der bei jedem Bau aus data/items.json berechnet wird (Anzahl,
Produktarten, Bereiche, Preisspanne) und deshalb nie veraltet.

Eine Markenseite gibt es erst ab MIN_TEILE verfuegbaren Teilen; faellt eine
Marke darunter, loescht der naechste Bau die Seite wieder (kein duenner
Inhalt). Alle Funktionen bekommen das Modul build_site als ``b`` - so teilen
sie Titel, Preise, Bildpfade und Sprachen mit dem Rest des Baus.
"""
from __future__ import annotations

import json
import re
import shutil
import unicodedata
from urllib.parse import quote

MIN_TEILE = 3
TEXTE_DATEI = "config/marken-texte.json"
TITEL_MAX = 60
EAGER_KACHELN = 4
GROESSEN_MAX = 5
BESCHREIBUNG_MAX = 160

TEXTE = {
    "de": {
        "suffix": "Second Hand & Vintage", "suffix_kurz": "Second Hand",
        "archiv": "Archiv", "marken": "Marken", "warenkorb": "Warenkorb", "menue": "Archiv öffnen",
        "sprache": "Sprache wählen", "pfad": "Brotkrumen",
        "zahl": "{n} Teile verfügbar",
        "verkauft_h2": "Bereits verkauft", "verkauft": "Verkauft",
        "weitere_h2": "Weitere Marken", "alle_marken": "Alle Marken",
        "preis_anfrage": "Preis auf Anfrage", "groesse": "Größe",
        "und": "und",
        "daten": "Aktuell führt Disorder119 {n} Teile von {brand}{bereich}{liste}. {preis}{groessen}Alle Teile sind Second Hand, "
                 "werden einzeln fotografiert und sind jeweils nur einmal vorhanden. Versand mit DHL aus Deutschland.",
        "liste_alle": ": {cats}", "liste_auswahl": ", darunter {cats}",
        "bereich": " für {deps}",
        "groessen_alle": "Größen im Bestand: {sizes}. ", "groessen_auswahl": "Größen im Bestand unter anderem {sizes}. ",
        "preis_spanne": "Die Preise liegen zwischen {min} und {max}. ", "preis_einer": "Der Preis liegt bei {min}. ",
        "desc": "{n} Teile von {brand} aus zweiter Hand: {cats}. {preis}Jedes Teil nur 1× verfügbar, einzeln fotografiert.",
        "desc_preis": "Preise ab {min}. ",
        "bereiche": {"Women": "Damen", "Men": "Herren", "Unisex": "Unisex"},
        "u_title": "Designer-Marken Second Hand & Vintage | Disorder119",
        "u_h1": "Designer-Marken – Second Hand & Vintage",
        "u_desc": "Alle Marken im Disorder119-Archiv: {top} und weitere. {n} Second-Hand-Teile von {m} Marken, jedes nur 1× verfügbar.",
        "u_text": "Disorder119 führt Second-Hand- und Vintage-Mode ausgewählter Designer. Auf dieser Seite stehen alle Marken, "
                  "von denen derzeit mindestens {min} Teile verfügbar sind, jeweils mit der aktuellen Anzahl. Insgesamt sind "
                  "{n} Teile von {m} Marken im Archiv verfügbar. Jedes Teil ist nur einmal vorhanden, wird einzeln fotografiert "
                  "und mit DHL aus Deutschland verschickt.",
        "u_teile": "{n} Teile", "u_rest_h2": "Weitere Marken im Archiv",
        "fuss": "Disorder119 · Kuratiertes Archiv für Designer-, Vintage- und Contemporary-Mode. Jedes Stück wird einzeln ausgewählt, fotografiert und beschrieben.",
        "fuss_archiv": "Zum vollständigen Archiv",
        "recht": "Rechtliches",
    },
    "en": {
        "suffix": "Pre-Owned & Vintage", "suffix_kurz": "Pre-Owned",
        "archiv": "Archive", "marken": "Brands", "warenkorb": "Cart", "menue": "Open archive",
        "sprache": "Choose language", "pfad": "Breadcrumb",
        "zahl": "{n} pieces available",
        "verkauft_h2": "Already sold", "verkauft": "Sold",
        "weitere_h2": "More brands", "alle_marken": "All brands",
        "preis_anfrage": "Price on request", "groesse": "Size",
        "und": "and",
        "daten": "Disorder119 currently has {n} {brand} pieces in stock{bereich}{liste}. {preis}{groessen}Every piece is pre-owned, "
                 "photographed individually and available only once. Shipping with DHL from Germany.",
        "liste_alle": ": {cats}", "liste_auswahl": ", including {cats}",
        "bereich": " for {deps}",
        "groessen_alle": "Sizes in stock: {sizes}. ", "groessen_auswahl": "Sizes in stock include {sizes}. ",
        "preis_spanne": "Prices range from {min} to {max}. ", "preis_einer": "The price is {min}. ",
        "desc": "{n} pre-owned {brand} pieces: {cats}. {preis}Each piece available only once, photographed individually.",
        "desc_preis": "Prices from {min}. ",
        "bereiche": {"Women": "women", "Men": "men", "Unisex": "unisex"},
        "u_title": "Designer Brands Pre-Owned & Vintage | Disorder119",
        "u_h1": "Designer Brands – Pre-Owned & Vintage",
        "u_desc": "All brands in the Disorder119 archive: {top} and more. {n} pre-owned pieces by {m} brands, each available only once.",
        "u_text": "Disorder119 carries pre-owned and vintage fashion by selected designers. This page lists every brand with at "
                  "least {min} pieces currently available, each with its current count. In total {n} pieces by {m} brands are "
                  "available in the archive. Every piece exists only once, is photographed individually and ships with DHL from Germany.",
        "u_teile": "{n} pieces", "u_rest_h2": "More brands in the archive",
        "fuss": "Disorder119 · Curated archive for designer, vintage and contemporary fashion. Every piece is individually selected, photographed and described.",
        "fuss_archiv": "To the full archive",
        "recht": "Legal",
    },
    "fr": {
        "suffix": "Seconde Main & Vintage", "suffix_kurz": "Seconde Main",
        "archiv": "Archive", "marken": "Marques", "warenkorb": "Panier", "menue": "Ouvrir l’archive",
        "sprache": "Choisir la langue", "pfad": "Fil d’Ariane",
        "zahl": "{n} pièces disponibles",
        "verkauft_h2": "Déjà vendu", "verkauft": "Vendu",
        "weitere_h2": "Autres marques", "alle_marken": "Toutes les marques",
        "preis_anfrage": "Prix sur demande", "groesse": "Taille",
        "und": "et",
        "daten": "Disorder119 propose actuellement {n} pièces {brand}{bereich}{liste}. {preis}{groessen}Chaque pièce est de seconde main, "
                 "photographiée individuellement et disponible une seule fois. Expédition par DHL depuis l’Allemagne.",
        "liste_alle": " : {cats}", "liste_auswahl": ", dont {cats}",
        "bereich": " pour {deps}",
        "groessen_alle": "Tailles en stock : {sizes}. ", "groessen_auswahl": "Tailles en stock, entre autres : {sizes}. ",
        "preis_spanne": "Les prix vont de {min} à {max}. ", "preis_einer": "Le prix est de {min}. ",
        "desc": "{n} pièces {brand} de seconde main : {cats}. {preis}Chaque pièce n’est disponible qu’une fois.",
        "desc_preis": "Prix à partir de {min}. ",
        "bereiche": {"Women": "femme", "Men": "homme", "Unisex": "unisexe"},
        "u_title": "Marques de créateurs seconde main | Disorder119",
        "u_h1": "Marques de créateurs – Seconde Main & Vintage",
        "u_desc": "Toutes les marques de l’archive Disorder119 : {top} et d’autres. {n} pièces de seconde main de {m} marques, chacune disponible une seule fois.",
        "u_text": "Disorder119 propose de la mode de seconde main et vintage de créateurs choisis. Cette page réunit toutes les "
                  "marques dont au moins {min} pièces sont actuellement disponibles, avec leur nombre actuel. Au total, {n} pièces "
                  "de {m} marques sont disponibles dans l’archive. Chaque pièce n’existe qu’une fois, est photographiée "
                  "individuellement et expédiée par DHL depuis l’Allemagne.",
        "u_teile": "{n} pièces", "u_rest_h2": "Autres marques de l’archive",
        "fuss": "Disorder119 · Archive sélectionnée pour la mode de créateurs, vintage et contemporaine. Chaque pièce est choisie, photographiée et décrite individuellement.",
        "fuss_archiv": "Vers l’archive complète",
        "recht": "Informations légales",
    },
}


# Normalisierte Groessenangaben aus der Taxonomie sind englisch.
GROESSEN_TR = {
    "One Size": {"de": "Einheitsgröße", "en": "One size", "fr": "Taille unique"},
    "Adjustable": {"de": "verstellbar", "en": "adjustable", "fr": "réglable"},
}


# ------------------------------------------------------------------ Daten
def marken_slug(brand):
    s = str(brand or "").casefold()
    for a, z in (("ä", "ae"), ("ö", "oe"), ("ü", "ue"), ("ß", "ss"), ("&", " and ")):
        s = s.replace(a, z)
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")


def _sichtbar(it, status):
    return it.get("public_status") == status and not it.get("hidden_from_shop")


def _helligkeit(it):
    wert = it.get("brightness")
    return wert if isinstance(wert, (int, float)) else 0.5


_MERKER = {}


def marken(b):
    """Alle Marken mit eigener Seite: [{brand, slug, teile, verkauft}], groesste zuerst."""
    # Wird fuer jede Produktseite gebraucht (Markenlink, Breadcrumb): das
    # Ergebnis gilt, solange Marke, Status und Reihenfolge der Artikel gleich sind.
    stand = tuple((it.get("id"), it.get("brand"), it.get("public_status"), bool(it.get("hidden_from_shop")),
                   it.get("brightness")) for it in b.ITEMS)
    if _MERKER.get("stand") != stand:
        _MERKER["stand"], _MERKER["liste"] = stand, _marken_berechnen(b)
    return _MERKER["liste"]


def _marken_berechnen(b):
    nach_marke = {}
    for it in b.ITEMS:
        marke = str(it.get("brand") or "").strip()
        if marke and _sichtbar(it, "AVAILABLE"):
            nach_marke.setdefault(marke, []).append(it)
    liste, slugs = [], {}
    for marke, teile in sorted(nach_marke.items(), key=lambda kv: (-len(kv[1]), kv[0].casefold())):
        slug = marken_slug(marke)
        if len(teile) < MIN_TEILE or not slug:
            continue
        if slug in slugs:
            raise SystemExit(f"FEHLER: Markenseiten: {marke!r} und {slugs[slug]!r} ergeben dieselbe Adresse /marke/{slug}/")
        slugs[slug] = marke
        verkauft = [it for it in b.ITEMS if str(it.get("brand") or "").strip() == marke and _sichtbar(it, "SOLD")]
        liste.append({
            "brand": marke, "slug": slug,
            # Reihenfolge wie im Archiv: helle Fotos zuerst.
            "teile": sorted(teile, key=_helligkeit, reverse=True),
            "verkauft": verkauft,
        })
    return liste


def kleine_marken(b):
    """Marken mit verfuegbaren Teilen, aber ohne eigene Seite: [(brand, anzahl)]."""
    zahl = {}
    for it in b.ITEMS:
        marke = str(it.get("brand") or "").strip()
        if marke and _sichtbar(it, "AVAILABLE"):
            zahl[marke] = zahl.get(marke, 0) + 1
    mit_seite = {m["brand"] for m in marken(b)}
    return sorted(((m, n) for m, n in zahl.items() if m not in mit_seite), key=lambda kv: kv[0].casefold())


def segment(marke):
    return "marke/" + marke["slug"] + "/"


UEBERSICHT_SEGMENT = "marken/"


def marke_des_artikels(b, it):
    name = str(it.get("brand") or "").strip()
    if not name:
        return None
    return next((m for m in marken(b) if m["brand"] == name), None)


def marken_pfad(b, it, lang):
    """Adresse der Markenseite eines Artikels ('/en/marke/prada/') oder ''."""
    marke = marke_des_artikels(b, it)
    return (b.lang_home(lang) + segment(marke)) if marke else ""


def sitemap_segmente(b):
    liste = marken(b)
    return ([UEBERSICHT_SEGMENT] + [segment(m) for m in liste]) if liste else []


def lade_texte(b):
    try:
        daten = json.loads((b.BASE / TEXTE_DATEI).read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {}
    return {k: v for k, v in daten.items() if isinstance(v, dict)}


# ------------------------------------------------------------------ Texte
def _preis(wert, lang):
    zahl = f"{wert:,.0f}" if float(wert).is_integer() else f"{wert:,.2f}"
    if lang == "en":
        return "€" + zahl
    zahl = zahl.replace(",", "X").replace(".", ",").replace("X", " " if lang == "fr" else ".")
    return zahl + " €"


def _aufzaehlung(teile, lang):
    teile = [t for t in teile if t]
    if len(teile) <= 1:
        return "".join(teile)
    return ", ".join(teile[:-1]) + " " + TEXTE[lang]["und"] + " " + teile[-1]


def _kategorien(b, marke, lang):
    """[(Beschriftung, Anzahl)] der Produktkategorien, haeufigste zuerst."""
    zahl = {}
    for it in marke["teile"]:
        kat = it.get("taxonomy_category") or it.get("category") or ""
        if kat:
            zahl[kat] = zahl.get(kat, 0) + 1
    sortiert = sorted(zahl.items(), key=lambda kv: (-kv[1], kv[0]))
    return [(b.cat_tr(k, lang) if lang == "de" else b.cat_tr(k, lang).lower(), n) for k, n in sortiert]


def _preise(marke):
    return sorted(float(it["price"]) for it in marke["teile"] if float(it.get("price") or 0) > 0)


def daten_absatz(b, marke, lang):
    """Der berechnete Absatz: Anzahl, Produktarten, Bereiche, Preisspanne."""
    t = TEXTE[lang]
    kats = _kategorien(b, marke, lang)
    liste = ""
    if kats:
        cats = _aufzaehlung([f"{name} ({n})" for name, n in kats[:3]], lang)
        liste = (t["liste_alle"] if len(kats) <= 3 else t["liste_auswahl"]).format(cats=cats)
    vorhanden = {it.get("department") for it in marke["teile"]}
    deps = [t["bereiche"][d] for d in ("Women", "Men") if d in vorhanden]
    if not deps and "Unisex" in vorhanden:
        deps = [t["bereiche"]["Unisex"]]
    bereich = t["bereich"].format(deps=_aufzaehlung(deps, lang)) if deps else ""
    preise = _preise(marke)
    preis = ""
    if preise:
        if preise[0] == preise[-1]:
            preis = t["preis_einer"].format(min=_preis(preise[0], lang))
        else:
            preis = t["preis_spanne"].format(min=_preis(preise[0], lang), max=_preis(preise[-1], lang))
    zahl = {}
    for it in marke["teile"]:
        # ohne Zusaetze wie "(geschätzt)" - die stehen an der Kachel und auf der Produktseite
        groesse = re.sub(r"\s*\(.*?\)", "", _groesse(b, it, lang)).strip()
        if groesse:
            zahl[groesse] = zahl.get(groesse, 0) + 1
    haeufig = [g for g, _ in sorted(zahl.items(), key=lambda kv: (-kv[1], kv[0]))]
    groessen = ""
    if haeufig:
        vorlage = t["groessen_alle"] if len(haeufig) <= GROESSEN_MAX else t["groessen_auswahl"]
        groessen = vorlage.format(sizes=_aufzaehlung(haeufig[:GROESSEN_MAX], lang))
    return t["daten"].format(n=len(marke["teile"]), brand=marke["brand"], liste=liste, bereich=bereich, preis=preis,
                             groessen=groessen)


def absaetze(b, marke, lang, texte=None):
    """Gepflegter Markentext (falls vorhanden) + berechneter Absatz."""
    texte = lade_texte(b) if texte is None else texte
    eigener = str((texte.get(marke["slug"]) or {}).get(lang) or "").strip()
    return ([eigener] if eigener else []) + [daten_absatz(b, marke, lang)]


def seitentitel(marke, lang):
    t = TEXTE[lang]
    titel = f'{marke["brand"]} {t["suffix"]} | Disorder119'
    if len(titel) > TITEL_MAX:
        titel = f'{marke["brand"]} {t["suffix_kurz"]} | Disorder119'
    if len(titel) > TITEL_MAX:
        titel = f'{marke["brand"]} {t["suffix_kurz"]}'
    return titel


def ueberschrift(marke, lang):
    return f'{marke["brand"]} – {TEXTE[lang]["suffix"]}'


def meta_beschreibung(b, marke, lang):
    t = TEXTE[lang]
    preise = _preise(marke)
    preis = t["desc_preis"].format(min=_preis(preise[0], lang)) if preise else ""
    kats = [name for name, _ in _kategorien(b, marke, lang)]
    text = ""
    for anzahl in (3, 2, 1):
        text = t["desc"].format(n=len(marke["teile"]), brand=marke["brand"], cats=_aufzaehlung(kats[:anzahl], lang), preis=preis)
        if len(text) <= BESCHREIBUNG_MAX:
            break
    return text


# ------------------------------------------------------------------ HTML
def _artikel_pfad(b, it, lang):
    return b.lang_home(lang) + "artikel/" + str(it.get("url_slug", it["id"])) + "/"


def _groesse(b, it, lang):
    roh = it.get("size_normalized")
    if isinstance(roh, list):
        roh = " / ".join(str(x) for x in roh if x)
    if not roh or roh in ("Unknown", "Dimensions"):
        roh = str(it.get("size") or "").strip()
    if not roh or len(roh) > 16 or "cm" in roh.lower():
        return ""
    text = GROESSEN_TR.get(roh, {}).get(lang) or b.size_tr(roh, lang)
    schuh = (it.get("taxonomy_category") or it.get("category")) == "Shoes"
    if schuh and re.fullmatch(r"\d+(?:[.,]\d+)?", text):
        text = "EU " + text
    return text


def _bild(b, it, alt, eager, erstes=False, klein=False):
    gallery = it.get("gallery") or []
    if not gallery:
        return ""
    original = gallery[0]
    alt = b.esc(alt)
    if klein:
        return (f'<img src="/{b.esc(b.card_image(it))}" alt="{alt}" width="220" height="293" '
                'loading="lazy" decoding="async">')
    grid, display = b.grid_path(original), b.display_path(original)
    hat_grid, hat_display = (b.BASE / grid).is_file(), (b.BASE / display).is_file()
    src = grid if hat_grid else (display if hat_display else b.card_image(it))
    srcset = ""
    if hat_grid and hat_display:
        srcset = (f' srcset="/{b.esc(grid)} {b.GRID_SRCSET_W[0]}w, /{b.esc(display)} {b.GRID_SRCSET_W[1]}w"'
                  ' sizes="(max-width: 600px) 46vw, (max-width: 1100px) 30vw, 308px"')
    laden = ('loading="eager" decoding="async"' + (' fetchpriority="high"' if erstes else "")) if eager \
        else 'loading="lazy" decoding="async"'
    return f'<img src="/{b.esc(src)}"{srcset} alt="{alt}" {laden}>'


def kachel_html(b, it, lang, index):
    t = TEXTE[lang]
    preis = float(it.get("price") or 0)
    if preis > 0:
        praefix = b.ui(lang, "priceEstimatedPrefix") if it.get("price_estimated") else ""
        preis_text = praefix + b.fmt_price_de(preis)
    else:
        preis_text = t["preis_anfrage"]
    groesse = _groesse(b, it, lang)
    # "Einheitsgröße" und "verstellbar" stehen fuer sich, sonst "Größe M".
    ohne_wort = groesse in {eintrag[lang] for eintrag in GROESSEN_TR.values()}
    groesse_text = groesse if ohne_wort else f'{t["groesse"]} {groesse}'
    bild = _bild(b, it, b.display_name(it, lang), eager=index < EAGER_KACHELN, erstes=index == 0)
    return (
        f'<li><a class="mk-card" href="{b.esc(_artikel_pfad(b, it, lang))}">'
        f'<span class="mk-card__frame">{bild}</span>'
        '<span class="mk-card__body">'
        f'<span class="mk-card__title">{b.esc(b.item_title(it, lang))}</span>'
        '<span class="mk-card__row">'
        f'<span class="mk-card__price">{b.esc(preis_text)}</span>'
        + (f'<span class="mk-card__size">{b.esc(groesse_text)}</span>' if groesse else "")
        + '</span></span></a></li>'
    )


def verkauft_html(b, it, lang):
    t = TEXTE[lang]
    bild = _bild(b, it, b.display_name(it, lang), eager=False, klein=True)
    return (
        f'<li><a class="mk-card" href="{b.esc(_artikel_pfad(b, it, lang))}">'
        f'<span class="mk-card__frame">{bild}</span>'
        '<span class="mk-card__body">'
        f'<span class="mk-card__title">{b.esc(b.item_title(it, lang))}</span>'
        f'<span class="mk-card__sold">{b.esc(t["verkauft"])}</span>'
        '</span></a></li>'
    )


def _jsonld(daten):
    return '<script type="application/ld+json">' + json.dumps(daten, ensure_ascii=False).replace("</", "<\\/") + "</script>"


def _absolut(b, pfad):
    return b.SITE_URL.rstrip("/") + pfad


def _seite(b, lang, seg, titel, beschreibung, og_bild, jsonld, inhalt, shop_config):
    """Geruest einer Marken-/Uebersichtsseite: Kopf, Inhalt, Fuss - kein Skript."""
    t = TEXTE[lang]
    home = b.lang_home(lang)
    urls = {l: _absolut(b, b.lang_home(l) + seg) for l in b.LANGS}
    canonical = urls[lang]
    og_alternativen = "\n".join(
        f'<meta property="og:locale:alternate" content="{b.OG_LOCALES[l]}">' for l in b.LANGS if l != lang)
    sprachen = "".join(
        f'<a href="{b.lang_home(l)}{seg}" hreflang="{l}" lang="{l}"' + (' aria-current="page"' if l == lang else "")
        + f'>{l.upper()}</a>' for l in b.LANGS)
    recht_label, recht_links = b.ARTIKEL_RECHT_LINKS[lang]
    recht = "".join(f'<a href="{home}{pfad}">{b.esc(text)}</a>' for pfad, text in recht_links)
    css = b._asset_version("assets/marken.css")
    return f"""<!DOCTYPE html>
<html lang="{lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#000000">
<meta name="application-name" content="Disorder119">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="apple-touch-icon" href="/assets/favicon-centered.png">
<title>{b.esc(titel)}</title>
<meta name="description" content="{b.esc(beschreibung)}">
<meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1">
<link rel="canonical" href="{canonical}">
{b.hreflang_block(urls)}
<link rel="icon" type="image/png" href="/assets/favicon-centered.png">
<link rel="stylesheet" href="/assets/marken.css?v={css}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Disorder119">
<meta property="og:locale" content="{b.OG_LOCALES[lang]}">
{og_alternativen}
<meta property="og:title" content="{b.esc(titel)}">
<meta property="og:description" content="{b.esc(beschreibung)}">
<meta property="og:url" content="{canonical}">
<meta property="og:image" content="{b.esc(og_bild)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{b.esc(titel)}">
<meta name="twitter:description" content="{b.esc(beschreibung)}">
<meta name="twitter:image" content="{b.esc(og_bild)}">
{_jsonld(json.loads(b.site_entities_jsonld(shop_config)))}
{"".join(_jsonld(block) for block in jsonld)}
</head>
<body>
<header class="mk-head">
  <a class="mk-head__menu" href="{home}" aria-label="{b.esc(t['menue'])}"><span></span><span></span><span></span></a>
  <a class="mk-head__brand" href="{home}">DISORDER119</a>
  <div class="mk-head__right">
    <nav class="mk-lang" aria-label="{b.esc(t['sprache'])}">{sprachen}</nav>
    <a class="mk-head__link" href="{home}">{b.esc(t['archiv'])}</a>
    <a class="mk-head__link" href="{home}cart/">{b.esc(t['warenkorb'])}</a>
  </div>
</header>
<main class="mk-main">
{inhalt}
</main>
<footer class="mk-foot">
  <p>{b.esc(t['fuss'])}</p>
  <p><a href="{home}">{b.esc(t['fuss_archiv'])}</a> · <a href="{home}{UEBERSICHT_SEGMENT}">{b.esc(t['alle_marken'])}</a></p>
  <nav class="mk-foot__nav" aria-label="{b.esc(recht_label)}"><a href="{home}widerruf/">{b.esc(b.WIDERRUF_LINK_TEXT[lang])}</a>{recht}</nav>
</footer>
</body>
</html>
"""


def _krumen(b, lang, letzter=None):
    """Sichtbarer Pfad Archiv / Marken [/ Marke] und die BreadcrumbList dazu."""
    t = TEXTE[lang]
    home = b.lang_home(lang)
    eintraege = [(t["archiv"], home), (t["marken"], home + UEBERSICHT_SEGMENT)]
    if letzter:
        eintraege.append(letzter)
    teile = []
    for i, (name, pfad) in enumerate(eintraege):
        if i == len(eintraege) - 1:
            teile.append(f'<li><span aria-current="page">{b.esc(name)}</span></li>')
        else:
            teile.append(f'<li><a href="{b.esc(pfad)}">{b.esc(name)}</a></li>')
    sichtbar = f'<nav aria-label="{b.esc(t["pfad"])}"><ol class="mk-crumbs">{"".join(teile)}</ol></nav>'
    daten = {
        "@context": "https://schema.org", "@type": "BreadcrumbList",
        "itemListElement": [
            {"@type": "ListItem", "position": i + 1, "name": name, "item": _absolut(b, pfad)}
            for i, (name, pfad) in enumerate(eintraege)
        ],
    }
    return sichtbar, daten


def _erstes_bild(b, teile):
    for it in teile:
        gallery = it.get("gallery") or []
        if gallery:
            return b.SITE_URL + gallery[0]
    return b.SITE_URL + "assets/og-image.png"


def markenseite_html(b, marke, lang, alle, shop_config, texte=None):
    t = TEXTE[lang]
    home = b.lang_home(lang)
    seg = segment(marke)
    titel = seitentitel(marke, lang)
    beschreibung = meta_beschreibung(b, marke, lang)
    canonical = _absolut(b, home + seg)
    krumen, krumen_daten = _krumen(b, lang, (marke["brand"], home + seg))
    text = "".join(f"<p>{b.esc(p)}</p>" for p in absaetze(b, marke, lang, texte))
    kacheln = "".join(kachel_html(b, it, lang, i) for i, it in enumerate(marke["teile"]))
    teile_html = [
        krumen,
        f'<h1 class="mk-title">{b.esc(ueberschrift(marke, lang))}</h1>',
        f'<p class="mk-count">{b.esc(t["zahl"].format(n=len(marke["teile"])))}</p>',
        f'<div class="mk-text">{text}</div>',
        f'<ul class="mk-grid">{kacheln}</ul>',
    ]
    if marke["verkauft"]:
        teile_html.append(f'<h2 class="mk-h2">{b.esc(t["verkauft_h2"])}</h2>')
        teile_html.append('<ul class="mk-grid mk-grid--sold">'
                          + "".join(verkauft_html(b, it, lang) for it in marke["verkauft"]) + "</ul>")
    andere = [m for m in alle if m["slug"] != marke["slug"]]
    if andere:
        links = "".join(
            f'<li><a href="{home}{segment(m)}">{b.esc(m["brand"])}<small>{len(m["teile"])}</small></a></li>' for m in andere)
        links += f'<li><a href="{home}{UEBERSICHT_SEGMENT}">{b.esc(t["alle_marken"])}</a></li>'
        teile_html.append(f'<h2 class="mk-h2">{b.esc(t["weitere_h2"])}</h2>')
        teile_html.append(f'<ul class="mk-links">{links}</ul>')
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
        "about": {"@type": "Brand", "name": marke["brand"]},
        "mainEntity": {
            "@type": "ItemList",
            "name": ueberschrift(marke, lang),
            "numberOfItems": len(marke["teile"]),
            "itemListElement": [
                {"@type": "ListItem", "position": i + 1, "url": _absolut(b, _artikel_pfad(b, it, lang)),
                 "name": b.display_name(it, lang),
                 **({"image": b.SITE_URL + it["gallery"][0]} if it.get("gallery") else {})}
                for i, it in enumerate(marke["teile"])
            ],
        },
    }
    return _seite(b, lang, seg, titel, beschreibung, _erstes_bild(b, marke["teile"]),
                  [sammlung, krumen_daten], "\n".join(teile_html), shop_config)


def uebersicht_html(b, lang, alle, shop_config):
    t = TEXTE[lang]
    home = b.lang_home(lang)
    canonical = _absolut(b, home + UEBERSICHT_SEGMENT)
    gesamt = sum(1 for it in b.ITEMS if _sichtbar(it, "AVAILABLE"))
    rest = kleine_marken(b)
    marken_zahl = len(alle) + len(rest)
    beschreibung = t["u_desc"].format(top=", ".join(m["brand"] for m in alle[:4]), n=gesamt, m=marken_zahl)
    krumen, krumen_daten = _krumen(b, lang)
    karten = []
    for i, m in enumerate(alle):
        bild = _bild(b, m["teile"][0], m["brand"], eager=i < EAGER_KACHELN, erstes=i == 0)
        karten.append(
            f'<li><a class="mk-card" href="{home}{segment(m)}">'
            f'<span class="mk-card__frame">{bild}</span>'
            '<span class="mk-card__body">'
            f'<span class="mk-card__title">{b.esc(m["brand"])}</span>'
            f'<span class="mk-card__meta">{b.esc(t["u_teile"].format(n=len(m["teile"])))}</span>'
            '</span></a></li>')
    teile_html = [
        krumen,
        f'<h1 class="mk-title">{b.esc(t["u_h1"])}</h1>',
        f'<div class="mk-text"><p>{b.esc(t["u_text"].format(min=MIN_TEILE, n=gesamt, m=marken_zahl))}</p></div>',
        f'<ul class="mk-grid mk-grid--brands">{"".join(karten)}</ul>',
    ]
    if rest:
        # Marken mit weniger Teilen haben keine eigene Seite; der Link fuehrt
        # in das Archiv mit vorgewaehltem Markenfilter.
        links = "".join(
            f'<li><a href="{home}?brand={quote(name)}">{b.esc(name)}<small>{n}</small></a></li>' for name, n in rest)
        teile_html.append(f'<h2 class="mk-h2">{b.esc(t["u_rest_h2"])}</h2>')
        teile_html.append(f'<ul class="mk-links mk-links--plain">{links}</ul>')
    sammlung = {
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        "@id": canonical + "#webpage",
        "url": canonical,
        "name": t["u_title"],
        "description": beschreibung,
        "inLanguage": lang,
        "isPartOf": {"@id": b.SITE_URL + "#website"},
        "publisher": {"@id": b.SITE_URL + "#store"},
        "mainEntity": {
            "@type": "ItemList",
            "name": t["u_h1"],
            "numberOfItems": len(alle),
            "itemListElement": [
                {"@type": "ListItem", "position": i + 1, "url": _absolut(b, home + segment(m)), "name": m["brand"],
                 **({"image": b.SITE_URL + m["teile"][0]["gallery"][0]} if m["teile"][0].get("gallery") else {})}
                for i, m in enumerate(alle)
            ],
        },
    }
    return _seite(b, lang, UEBERSICHT_SEGMENT, t["u_title"], beschreibung, _erstes_bild(b, alle[0]["teile"]),
                  [sammlung, krumen_daten], "\n".join(teile_html), shop_config)


# ------------------------------------------------------------------ Bau
def _ordner(b, lang, seg):
    return b.BASE / b.lang_home(lang).strip("/") / seg.rstrip("/")


def build(b):
    """Schreibt alle Markenseiten und die Uebersicht; entfernt Seiten von
    Marken, die unter MIN_TEILE gefallen sind."""
    alle = marken(b)
    shop_config = b.get_shop_config()
    texte = lade_texte(b)
    gueltig = {m["slug"] for m in alle}
    geschrieben = 0
    for lang in b.LANGS:
        wurzel = _ordner(b, lang, "marke/")
        if wurzel.is_dir():
            for alt in wurzel.iterdir():
                if alt.is_dir() and alt.name not in gueltig:
                    shutil.rmtree(alt)
        uebersicht = _ordner(b, lang, UEBERSICHT_SEGMENT)
        if not alle:
            if uebersicht.is_dir():
                shutil.rmtree(uebersicht)
            continue
        for m in alle:
            ziel = _ordner(b, lang, segment(m))
            ziel.mkdir(parents=True, exist_ok=True)
            (ziel / "index.html").write_text(markenseite_html(b, m, lang, alle, shop_config, texte), encoding="utf-8")
            geschrieben += 1
        uebersicht.mkdir(parents=True, exist_ok=True)
        (uebersicht / "index.html").write_text(uebersicht_html(b, lang, alle, shop_config), encoding="utf-8")
        geschrieben += 1
    ohne_text = [m["brand"] for m in alle if not texte.get(m["slug"])]
    print(f"{geschrieben} Markenseiten geschrieben ({len(alle)} Marken + Uebersicht x {len(b.LANGS)} Sprachen)."
          + (f" Ohne gepflegten Text: {', '.join(ohne_text)}." if ohne_text else ""))
    return alle


def llms_zeilen(b):
    """Abschnitt fuer llms.txt: die Markenseiten mit Anzahl."""
    alle = marken(b)
    if not alle:
        return []
    site = b.SITE_URL.rstrip("/")
    zeilen = ["", f"## Marken ({len(alle)})",
              f"- [Alle Marken]({site}/{UEBERSICHT_SEGMENT}): Übersicht mit Anzahl verfügbarer Teile je Marke"]
    for m in alle:
        zeilen.append(f"- [{m['brand']} Second Hand & Vintage]({site}/{segment(m)}): {len(m['teile'])} Teile verfügbar")
    return zeilen

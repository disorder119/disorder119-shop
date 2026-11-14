"""Kategorieseiten: /damen/, /herren/ und /damen/<kategorie>/, /herren/<kategorie>/.

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


def sitemap_segmente(b):
    return [s["seg"] for s in seiten(b)]


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
    t = TEXTE[lang]
    bereich, gruppe = _namen(seite, lang)
    if not seite["gruppe"]:
        return t["hub_titel"].format(bereich=bereich)
    titel = t["titel"].format(gruppe=gruppe, bereich=bereich)
    if len(titel) > ms.TITEL_MAX:
        titel = t["titel_kurz"].format(gruppe=gruppe, bereich=bereich)
    return titel


def ueberschrift(seite, lang):
    t = TEXTE[lang]
    bereich, gruppe = _namen(seite, lang)
    return t["h1"].format(gruppe=gruppe, bereich=bereich) if seite["gruppe"] else t["hub_h1"].format(bereich=bereich)


def absatz(b, seite, lang):
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
    ]
    # Kategorien desselben Bereichs (auf der Bereichsseite ueber den Kacheln, sonst darunter).
    geschwister = [s for s in alle if s["bereich"] == seite["bereich"] and s["gruppe"] and s["seg"] != seite["seg"]]
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
    andere = [s for s in alle if s["bereich"] != seite["bereich"] and s["gruppe"] == seite["gruppe"]]
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
    alle = seiten(b)
    shop_config = b.get_shop_config()
    gueltig = {s["seg"].rstrip("/") for s in alle}
    geschrieben = 0
    for lang in b.LANGS:
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
    return [(TEXTE[lang]["bereich"][s["bereich"]], home + s["seg"]) for s in seiten(b) if not s["gruppe"]]


def llms_zeilen(b):
    alle = seiten(b)
    if not alle:
        return []
    site = b.SITE_URL.rstrip("/")
    zeilen = ["", f"## Kategorien ({len(alle)})"]
    for s in alle:
        zeilen.append(f"- [{ueberschrift(s, 'de')}]({site}/{s['seg']}): {len(s['teile'])} Teile verfügbar")
    return zeilen

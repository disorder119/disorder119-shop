"""eBay-Export aus dem Shop-Katalog: Entwurfs-CSV fuer das Verkaeufer-Cockpit Pro
(Berichte -> Uploads, Vorlage "Angebotsentwuerfe") plus Fotos auf weissem Grund.

Quelle ist data/items.json (derselbe Stand wie die Website). Exportiert werden
verfuegbare Stuecke mit Preis. Die Entwuerfe veroeffentlichen nichts: eBay legt
sie unter "Angebote -> Entwuerfe" ab, dort werden sie geprueft und freigegeben.

    python scripts/ebay_export.py --bilder            # Fotos nach assets/ebay/<id>/<n>.webp
    python scripts/ebay_export.py --csv ebay.csv      # Entwurfs-CSV (alle verfuegbaren)
    python scripts/ebay_export.py --csv test.csv --ids 9479 9378 6202
    python scripts/ebay_export.py --csv test.csv --ids 9479 --bild-basis https://raw.githubusercontent.com/disorder119/disorder119-shop/<zweig>/

Preis: eBay behaelt bei Kleidung 12 % des Gesamtbetrags plus 0,45 EUR je
Bestellung (Zahlungsabwicklung inklusive, keine extra PayPal-Gebuehr). Damit
der Shop-Preis netto bleibt und Spielraum fuer Preisvorschlaege da ist:
    eBay-Preis = aufgerundet( (Shop-Preis + 0,45) / 0,88 * (1 + Spielraum) )
"""
from __future__ import annotations

import argparse
import csv
import html
import json
import math
import re
import sys
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
ITEMS = BASE / "data" / "items.json"
BILD_ORDNER = BASE / "assets" / "ebay"
SITE_URL = "https://disorder119.com/"
# Artikel-Research (Linie, Modell, Kollektion/Jahr, Konfidenz, Stichworte), Zustands-
# Notizen aus der Fotodurchsicht und Galeriefotos, die nicht zum Artikel gehoeren.
RECHERCHE_DATEI = BASE / "data" / "ebay_recherche.json"

EBAY_PROVISION = 0.12
EBAY_FIXGEBUEHR = 0.45
SPIELRAUM = 0.10          # Luft fuer Preisvorschlaege, 10 %
MAX_BILDER = 12
MAX_TITEL = 80

HEADER = [
    "Action(SiteID=Germany|Country=DE|Currency=EUR|Version=1193|CC=UTF-8)",
    "Custom label (SKU)", "Category ID", "Title", "UPC", "Price", "Quantity",
    "Item photo URL", "Condition ID", "Description", "Format",
]
INFO = [
    "#INFO;Version=0.0.2;Template= eBay-draft-listings-template_DE;;;;;;;;;",
    "#INFO Action und Category ID sind erforderliche Felder. 1) Stellen Sie Action auf Draft ein. 2) Die Kategorie-ID fuer Ihre Angebote finden Sie hier: https://pages.ebay.com/sellerinformation/news/categorychanges.html;;;;;;;;;",
    "#INFO Nachdem Sie Ihren Entwurf erfolgreich im Berichte-Tab Ihres Verkaeufer-Cockpit Pro hochgeladen haben; koennen Sie die Entwuerfe hier zu aktiven Angeboten vervollstaendigen: https://www.ebay.de/sh/lst/drafts;;;;;;;;;",
    "#INFO;;;;;;;;;;",
]

# eBay-DE-Kategorien (Blattkategorien), am 08.10.2026 ueber ebay.de/b/<id> geprueft.
KATEGORIEN = {
    ("Women", "Jackets"): "63862",   # Damen: Jacken, Maentel & Westen
    ("Women", "Coats"): "63862",
    ("Women", "Tops"): "53159",      # Damen: Blusen, Tops & Shirts
    ("Women", "Shirts"): "53159",
    ("Women", "Knitwear"): "63866",  # Damen: Pullover & Strickware
    ("Women", "Skirts"): "63864",    # Damen: Roecke
    ("Women", "Pants"): "63863",     # Damen: Hosen
    ("Women", "Dresses"): "63861",   # Damen: Kleider
    ("Women", "Shoes"): "3034",      # Damenschuhe
    ("Men", "Jackets"): "57988",     # Herrenjacken
    ("Men", "Coats"): "57988",
    ("Men", "Shirts"): "57990",      # Herren: Freizeithemden & Shirts
    ("Men", "Knitwear"): "11484",    # Herren: Pullover & Strickware
    ("Men", "Pants"): "57989",       # Herrenhosen
    ("Men", "Shoes"): "93427",       # Herrenschuhe
}
# Feinere Zuordnung nach Produktart, wo eBay eigene Blattkategorien hat.
PRODUKTART = {
    ("Men", "T-Shirt"): "15687",      # Herren: T-Shirts
    ("Men", "Long Sleeve"): "15687",
    ("Men", "Polo Shirt"): "185101",  # Herren: Poloshirts
    ("Men", "Sweatshirt"): "11484",
    # Schuhe brauchen Blattkategorien ("Damenschuhe"/"Herrenschuhe" lehnt eBay ab).
    ("Women", "Sneakers"): "95672",   # Damen: Sneaker
    ("Women", "Boots"): "53557",      # Damen: Stiefel & Stiefeletten
    ("Women", "Heels"): "55793",      # Damen: Pumps
    ("Women", "Sandals"): "62107",    # Damen: Sandalen
    ("Women", "Shoes"): "45333",      # Damen: Halbschuhe & Ballerinas
    ("Men", "Sneakers"): "15709",     # Herren: Sneaker
    ("Men", "Loafers"): "53120",      # Herren: Business-Schuhe
    ("Men", "Shoes"): "53120",
    ("Men", "Boots"): "11498",        # Herren: Stiefel
    ("Women", "Sunglasses"): "45246", # Damen: Sonnenbrillen
    ("Men", "Sunglasses"): "79720",   # Herren: Sonnenbrillen
    ("Women", "Hat"): "45230", ("Women", "Beanie"): "45230", ("Women", "Cap"): "45230",
    ("Men", "Hat"): "52365", ("Men", "Beanie"): "52365", ("Men", "Cap"): "52365",
    ("Women", "Belt"): "3003", ("Men", "Belt"): "2993",
    ("Women", "Scarf"): "45238", ("Men", "Scarf"): "52382",
    ("Women", "Backpack"): "169291", ("Men", "Backpack"): "169291",
}
# Unisex-Stuecke: eBay kennt nur Damen/Herren - Unisex-Kleidung als Damen,
# Muetzen, Schals, Guertel, Rucksaecke als Herren-Accessoire.
UNISEX_ALS = {"Accessories": "Men", "Jackets": "Women", "Shirts": "Women", "Tops": "Women"}

FARBEN_DE = {}


def lade_items():
    return json.loads(ITEMS.read_text(encoding="utf-8"))


def lade_recherche() -> dict:
    if RECHERCHE_DATEI.is_file():
        return json.loads(RECHERCHE_DATEI.read_text(encoding="utf-8"))
    return {}


RECHERCHE = lade_recherche()


def recherche(it) -> dict:
    return RECHERCHE.get("artikel", {}).get(str(it["id"]), {})


def konfidenz(it) -> str:
    # "hoch (Modell) / mittel (Aera)" -> "hoch"
    return str(recherche(it).get("konfidenz") or "").split(" ")[0].lower()


def _jahr(it) -> int:
    # Bei Zeitraeumen ("ca. 1999-2004") zaehlt das spaetere Jahr: so wird aus der fruehen
    # Linea Rossa "Y2K" und nicht "90s".
    r = recherche(it)
    jahre = re.findall(r"(19[89]\d|20[012]\d)", str(r.get("jahr") or "") + " " + str(r.get("era") or ""))
    return max(int(j) for j in jahre) if jahre else 0


def jahrzehnt(it) -> str:
    j = _jahr(it)
    return f"{j // 10 * 10}er" if j else ""


def ist_vintage(it) -> bool:
    # eBay-Kaeufer suchen "Vintage" fuer Stuecke, die rund 20 Jahre und aelter sind.
    j = _jahr(it)
    return bool(j) and j <= 2006


def zustand_hinweise(it) -> list[str]:
    """Maengel aus dem Katalogtext plus Notizen aus der Fotodurchsicht."""
    h = [x for x in _katalogtext(it)["hinweise"] if x]
    z = str(RECHERCHE.get("zustand", {}).get(str(it["id"])) or "").strip()
    if z and z.casefold() not in " ".join(h).casefold():
        h.append(z)
    return h


def verfuegbar(items):
    return [it for it in items if str(it.get("public_status", "")).upper() == "AVAILABLE" and float(it.get("price") or 0) > 0]


def kategorie(it):
    dep = str(it.get("department") or "")
    kat = str(it.get("taxonomy_category") or it.get("category") or "")
    art = str(it.get("product_type") or "")
    if dep == "Unisex":
        dep = UNISEX_ALS.get(kat, "Women")
    if dep == "Objects":
        return None
    return PRODUKTART.get((dep, art)) or KATEGORIEN.get((dep, kat))


def ebay_preis(shop_preis: float) -> int:
    roh = (float(shop_preis) + EBAY_FIXGEBUEHR) / (1 - EBAY_PROVISION) * (1 + SPIELRAUM)
    return int(math.ceil(roh))


# Linien-/Modellbegriffe aus dem Research, nach denen bei eBay gesucht wird; die
# Reihenfolge ist die Prioritaet im Titel (80 Zeichen).
_LINIEN_TOKENS = [
    (r"Linea Rossa", "Linea Rossa"), (r"Prada Sport", "Prada Sport"), (r"Luna Rossa", "Luna Rossa"),
    (r"Gaultier Jean's|JPG Jean's|JPG", "JPG Jean's"), (r"Soleil", "Soleil"), (r"Maille", "Maille"), (r"Classique", "Classique"),
    (r"W&LT", "W&LT"), (r"DRKSHDW", "DRKSHDW"), (r"Jil Sander\+", "Jil Sander+"), (r"with H&M|x H&M", "x H&M"),
    (r"Uniforme", "Uniforme"), (r"Beachwear", "Beachwear"), (r"Galliano", "Galliano"), (r"Demna", "Demna"),
    (r"SNCF", "SNCF"), (r"Rive Gauche", "Rive Gauche"), (r"Dior Homme", "Dior Homme"), (r"Pierre Balmain", "Pierre Balmain"),
    (r"Originals Blue", "Originals Blue"), (r"Kris Van Assche", "Kris Van Assche"),
]


def _saison_token(it) -> str:
    r = recherche(it)
    jahr = str(r.get("jahr") or "")
    m = re.search(r"(19[89]\d|20[012]\d)", jahr)
    if m and konfidenz(it) == "hoch" and "vermutlich" not in jahr:
        era = str(r.get("era") or "")
        kurz = m.group(1)[2:]
        if re.search(r"Frühjahr/Sommer|\bSS\b", era):
            return f"SS{kurz}"
        if re.search(r"Herbst/Winter|\bFW\b|\bAW\b", era):
            return f"FW{kurz}"
        return m.group(1)
    jz = jahrzehnt(it)
    if jz == "2000er":
        return "Y2K" if (_jahr(it) <= 2005 or "frühe 2000er" in str(r.get("era") or "")) else "2000er"
    return {"1980er": "80s", "1990er": "90s"}.get(jz, "")


def titel_tokens(it) -> list[str]:
    """Zusatzbegriffe fuer den eBay-Titel in Prioritaet: Linie, wichtigstes Modell-Stichwort, Saison,
    Groesse, weitere Stichworte, Vintage, Archive. Die Groesse steht vor den Nebenbegriffen, weil
    Kaeufer nach ihr filtern; was nicht mehr in 80 Zeichen passt, faellt hinten weg."""
    r = recherche(it)
    basis = str(it.get("title") or "").casefold()
    out = []
    def passt(wort):
        return wort and wort.casefold() not in basis and wort.casefold() not in " ".join(out).casefold()
    linie = str(r.get("linie") or "")
    for muster, token in _LINIEN_TOKENS:
        if re.search(muster, linie, re.I) and passt(token):
            out.append(token)
            break
    stichworte = [str(sw).strip() for sw in (r.get("stichworte") or [])]
    stichworte = [sw for sw in stichworte if len(sw) <= 24
                  and not re.fullmatch(r"(SS|FW|AW)?\s?\d{2,4}s?|Y2K|Vintage|Archive|Runway|Rare|Collab", sw, re.I)]
    if stichworte and passt(stichworte[0]):
        out.append(stichworte[0])
    saison = _saison_token(it)
    if passt(saison):
        out.append(saison)
    groesse = str(it.get("size") or "").split("/")[0].strip()
    if groesse and groesse.casefold() not in EINHEITSGROESSE:
        out.append("Gr. " + groesse)
    for sw in stichworte[1:3]:
        if passt(sw):
            out.append(sw)
    if ist_vintage(it) and passt("Vintage"):
        out.append("Vintage")
    if konfidenz(it) in ("hoch", "mittel") and 0 < _jahr(it) <= 2012 and passt("Archive"):
        out.append("Archive")
    return out


def titel(it) -> str:
    """eBay-Titel (max. 80 Zeichen): Katalogtitel (Marke Produktart Damen/Herren Farbe), dann die
    Suchbegriffe aus dem Research, solange sie passen. Keine Fremdmarken, nichts Erfundenes."""
    basis = re.sub(r"\s+", " ", str(it.get("title") or "")).strip()
    out = basis
    for tok in titel_tokens(it):
        if len(out) + 1 + len(tok) <= MAX_TITEL:
            out = out + " " + tok
    return out[:MAX_TITEL]


# Bloecke der Katalogtexte, die bei eBay nichts bringen (Puppenmasse, Rechtstext, Claim).
_WEGLASSEN = ("fotografie & passform", "maße der schneiderpuppe", "rechtliche hinweise", "disorder119 steht für",
              "diese maße dienen", "aus dem kuratierten archiv")
_DETAIL_KEYS = ("Marke", "Modell", "Linie", "Kollektion", "Saison", "Farbe", "Größe", "Passform", "Schnitt", "Verschluss",
                "Material", "Herstellungsland", "Länge", "Ärmel", "Muster", "Besonderheit", "Besonderheiten")


def kollektion_text(it) -> str:
    """Kollektion/Jahr fuer die Beschreibung: belegt ohne Zusatz, bei mittlerer Sicherheit mit
    'vermutlich', bei niedriger gar nicht (dann bleibt nur die Linie)."""
    r = recherche(it)
    wert = str(r.get("era") or r.get("jahr") or "").strip()
    if not wert:
        return ""
    k = konfidenz(it)
    if k == "hoch":
        return wert
    if k == "mittel":
        return wert if wert.casefold().startswith("vermutlich") else "vermutlich " + wert
    return ""


def _katalogtext(it) -> dict:
    """Zerlegt den Katalogtext in Einleitung, Detail-Paare, Zustand und Hinweise."""
    text = str(it.get("desc_de") or it.get("desc") or "").replace("\r", "").strip()
    absaetze = [a.strip() for a in re.split(r"\n\s*\n", text) if a.strip()]
    einleitung, details, zustand, hinweise = [], {}, [], []
    modus = None
    for a in absaetze:
        zeilen = [z.strip() for z in a.split("\n") if z.strip()]
        kopf = zeilen[0].rstrip(":").casefold()
        if any(kopf.startswith(w) or a.casefold().startswith(w) for w in _WEGLASSEN):
            modus = None
            continue
        if kopf in ("details", "zustand"):
            modus = kopf
            zeilen = zeilen[1:]
            if not zeilen:
                continue
        if zeilen and zeilen[0].casefold().startswith("hinweis"):
            hinweise.append(" ".join(zeilen).split(":", 1)[-1].strip())
            continue
        if modus == "details":
            # Beide Schreibweisen: "Marke: Prada" und "Marke" / "Prada" in Folgezeilen.
            i = 0
            while i < len(zeilen):
                z = zeilen[i]
                if ":" in z:
                    k, v = z.split(":", 1)
                    if k.strip() in _DETAIL_KEYS and v.strip():
                        details[k.strip()] = v.strip()
                    elif k.strip() in _DETAIL_KEYS:
                        werte = []
                        while i + 1 < len(zeilen) and ":" not in zeilen[i + 1] and zeilen[i + 1] not in _DETAIL_KEYS:
                            werte.append(zeilen[i + 1]); i += 1
                        details[k.strip()] = ", ".join(werte)
                elif z in _DETAIL_KEYS and i + 1 < len(zeilen):
                    werte = []
                    while i + 1 < len(zeilen) and zeilen[i + 1] not in _DETAIL_KEYS:
                        werte.append(zeilen[i + 1]); i += 1
                    details[z] = ", ".join(werte)
                i += 1
            continue
        if modus == "zustand":
            zustand.append(" ".join(zeilen))
            modus = None
            continue
        # Alles andere ist Fliesstext; eine einzelne Titelzeile am Anfang und der
        # automatisch erzeugte Faktensatz ("... Kategorie: Shoes. Groesse: 9. ...") fallen weg.
        if len(zeilen) == 1 and len(zeilen[0]) < 70 and not einleitung and zeilen[0].casefold().startswith(str(it.get("brand") or "zzz").casefold()):
            continue
        if re.search(r"Kategorie:\s*\w+\.", a) and "Fehlende Angaben" in a:
            continue
        einleitung.append(" ".join(zeilen))
    return dict(einleitung=einleitung, details=details, zustand=zustand, hinweise=hinweise)


def ist_neu(it) -> bool:
    # "neu mit Etikett" steht im Katalog nur als Hinweis im Text (keine Zustandsstufen im Shop).
    text = (str(it.get("condition") or "") + " " + str(it.get("desc_de") or it.get("desc") or "")).casefold()
    return bool(re.search(r"neu mit (original)?etikett", text))


def condition_id(it) -> str:
    # eBay: 1000 = Neu mit Etikett, 3000 = Gebraucht.
    return "1000" if ist_neu(it) else "3000"


def beschreibung(it) -> str:
    """eBay-Beschreibung: kurzer Text, danach alles Wichtige als Stichpunkte (so wird es am Handy gelesen)."""
    e = html.escape
    kt = _katalogtext(it)
    r = recherche(it)
    teile = [f"<h3>{e(titel(it))}</h3>"]
    # Maengel zuerst: Was ein Kaeufer wissen muss, steht vor allem anderen.
    maengel = [h for h in zustand_hinweise(it) if h and not re.search(r"neu mit (original)?etikett", h, re.I)]
    if maengel:
        teile.append("<p><b>Bitte beachten:</b> " + e(" ".join(maengel)) + "</p>")
    if kt["einleitung"]:
        teile.append("<p>" + e(kt["einleitung"][0]) + "</p>")
    punkte = []
    def punkt(label, wert):
        wert = str(wert or "").strip()
        if wert and wert.casefold() not in ("nicht angegeben", "keine angabe", "-", "–", "keiner"):
            punkte.append(f"<li><b>{e(label)}:</b> {e(wert)}</li>")
    punkt("Marke", kt["details"].get("Marke") or it.get("brand"))
    punkt("Artikel", PRODUKTART_DE.get(str(it.get("product_type") or ""), ""))
    punkt("Für", ABTEILUNG_DE.get(str(it.get("department") or ""), ""))
    # Research geht vor Katalogangabe: Linie, Modell, Kollektion/Jahr (nur so sicher, wie belegt).
    punkt("Linie", r.get("linie") or kt["details"].get("Linie"))
    punkt("Modell", r.get("modell") or kt["details"].get("Modell"))
    punkt("Kollektion / Jahr", kollektion_text(it) or kt["details"].get("Kollektion") or kt["details"].get("Saison"))
    groesse = str(it.get("size") or "").strip()
    eu, uk, us = schuhgroesse(it)
    if eu and (uk or us):
        groesse = f"{groesse} (Herstellerangabe {'UK ' + uk if uk else 'US ' + us}, entspricht ca. EU {eu})"
    punkt("Größe", groesse)
    punkt("Farbe", kt["details"].get("Farbe") or it.get("color"))
    for k in ("Passform", "Schnitt", "Länge", "Ärmel", "Verschluss", "Muster", "Material", "Herstellungsland", "Besonderheit", "Besonderheiten"):
        punkt(k, kt["details"].get(k))
    teile.append("<h4>Auf einen Blick</h4><ul>" + "".join(punkte) + "</ul>")
    # Archiv-Hintergrund: nur was belegt ist, mit Quelle (Etikett, Datumscode, Kollektionsvergleich).
    if r.get("quellen") and konfidenz(it) in ("hoch", "mittel"):
        quelle = str(r["quellen"][0]).strip()
        teile.append("<h4>Archiv-Hintergrund</h4><p>Belegt durch: " + e(quelle[:300]) + "</p>")
    zustand = [z for z in kt["zustand"] if z]
    if not zustand:
        zustand = ["Neu mit Originaletikett, ungetragen." if ist_neu(it) else "Gebrauchtes Einzelstück mit normalen, altersgemäßen Gebrauchsspuren."]
    zustand += ["Hinweis: " + h for h in maengel if h]
    zustand.append("Alle Besonderheiten sind auf den Fotos zu sehen – jedes Stück ist individuell fotografiert und geprüft.")
    teile.append("<h4>Zustand</h4><ul>" + "".join(f"<li>{e(z)}</li>" for z in zustand) + "</ul>")
    frei = float(it.get("price") or 0) >= VERSAND_FREI_AB
    teile.append("<h4>Versand &amp; Rückgabe</h4><ul>"
                 "<li>Versand mit DHL innerhalb von 3 Werktagen, sorgfältig von Hand verpackt" + (" – versandkostenfrei" if frei else "") + "</li>"
                 "<li>14 Tage Widerrufsrecht für Verbraucher</li>"
                 "<li>Kleinunternehmer gemäß § 19 UStG, keine Umsatzsteuer ausgewiesen</li>"
                 "<li>Aus dem kuratierten Designer-Archiv von DISORDER119 (disorder119.com)</li></ul>")
    return "".join(teile)


def bild_pfade(it):
    # Fotos, die laut Research zu einem anderen Artikel gehoeren, fallen weg (data/ebay_recherche.json,
    # "bild_ausschluss"), bis der Katalog selbst korrigiert ist.
    aus = set(RECHERCHE.get("bild_ausschluss", {}).get(str(it["id"]), []))
    return [str(p) for p in (it.get("gallery") or []) if isinstance(p, str) and p.startswith("assets/img/") and p not in aus][:MAX_BILDER]


# Hintergrund der eBay-Fotos: Weiss (eBay-Empfehlung), Schwarz (Shop-Optik) oder das
# freigestellte Original (transparent; eBay legt es selbst auf Weiss).
# Entscheidung 09.10.2026: Hellgrau (236) fuer alle Hauptbilder - weisse und hellblaue Teile loesen sich
# auf Weiss auf, schwarze auf Schwarz; Hellgrau traegt beides und wirkt im eBay-Raster wie Weiss.
HINTERGRUENDE = {"hellgrau": ((236, 236, 236), "assets/ebay"), "weiss": ((255, 255, 255), "assets/ebay_weiss"),
                 "schwarz": ((0, 0, 0), "assets/ebay_schwarz")}


def bild_urls(it, basis: str, hintergrund) -> list[str]:
    # hintergrund: "hellgrau" | "weiss" | "schwarz" | None (Original)
    if hintergrund is True:
        hintergrund = "hellgrau"
    urls = []
    for i, pfad in enumerate(bild_pfade(it)):
        if hintergrund in HINTERGRUENDE:
            urls.append(f"{basis}{HINTERGRUENDE[hintergrund][1]}/{it['id']}/{i}.webp")
        else:
            urls.append(f"{basis}{pfad}")
    return urls


def bilder_erzeugen(items, nur_fehlende=True, hintergrund="hellgrau") -> int:
    from PIL import Image
    farbe, ordner = HINTERGRUENDE[hintergrund]
    anzahl = 0
    for it in items:
        ziel = BASE / ordner / str(it["id"])
        for i, pfad in enumerate(bild_pfade(it)):
            quelle = BASE / pfad
            out = ziel / f"{i}.webp"
            if not quelle.is_file() or (nur_fehlende and out.is_file()):
                continue
            ziel.mkdir(parents=True, exist_ok=True)
            im = Image.open(quelle).convert("RGBA")
            # Freigestelltes Foto auf einfarbigen Grund legen.
            grund = Image.new("RGB", im.size, farbe)
            grund.paste(im, mask=im.getchannel("A"))
            grund.save(out, "WEBP", quality=82, method=6)
            anzahl += 1
    return anzahl


def sku(it, zusatz=""):
    return str(it["id"]) + (" " + zusatz if zusatz else "")


def zeile(it, basis, hintergrund, sku_zusatz=""):
    kat = kategorie(it)
    return [
        "Draft", sku(it, sku_zusatz), kat or "", titel(it), "", f"{ebay_preis(it['price'])}.00", "1",
        "|".join(bild_urls(it, basis, hintergrund)), condition_id(it), beschreibung(it), "FixedPrice",
    ]


# ---- Vollstaendige Angebots-Vorlage (Action=Add / VerifyAdd): mit Artikelmerkmalen,
# Zustand, Versand, Ruecknahme - entsteht direkt als Angebot (VerifyAdd prueft nur).
VOLL_HEADER = [
    "*Action(SiteID=Germany|Country=DE|Currency=EUR|Version=1193|CC=UTF-8)", "CustomLabel", "*Category", "*Title",
    "*Description", "*ConditionID", "ConditionDescription", "C:Marke", "C:Größe", "C:EU-Schuhgröße", "C:UK-Schuhgröße", "C:US-Schuhgröße", "C:Absatzhöhe",
    "C:Farbe", "C:Abteilung", "C:Produktart",
    "C:Stil", "C:Ärmellänge", "C:Außenmaterial", "C:Material", "C:Kleiderlänge", "C:Rocklänge", "C:Schrittlänge",
    "PicURL", "*Format", "*Duration", "*StartPrice", "*Quantity", "BestOfferEnabled", "*Location", "PostalCode",
    "*DispatchTimeMax", "ShippingType", "ShippingService-1:Option", "ShippingService-1:Cost",
    "*ReturnsAcceptedOption", "ReturnsWithinOption", "ShippingCostPaidByOption",
]
# eBay verlangt "Stil" als Merkmal; fuer das Archiv passt durchgehend "Designer".
STIL = "Designer"
PRODUKTART_DE = {
    "Jacket": "Jacke", "Biker Jacket": "Bikerjacke", "Bomber Jacket": "Bomberjacke", "Blazer": "Blazer", "Vest": "Weste",
    "Coat": "Mantel", "Trench Coat": "Trenchcoat", "Top": "Top", "Tank Top": "Tanktop", "Knit Top": "Stricktop", "Tunic": "Tunika",
    "Blouse": "Bluse", "T-Shirt": "T-Shirt", "Long Sleeve": "Langarmshirt", "Polo Shirt": "Poloshirt", "Shirt": "Hemd",
    "Sweatshirt": "Sweatshirt", "Sweater": "Pullover", "Cardigan": "Strickjacke", "Dress": "Kleid", "Skirt": "Rock",
    "Trousers": "Hose", "Shorts": "Shorts", "Swim Shorts": "Badeshorts", "Underwear Shorts": "Shorts", "Sleepwear": "Nachtwäsche",
    "Set": "Set", "Sneakers": "Sneaker", "Boots": "Stiefel", "Heels": "Pumps", "Sandals": "Sandalen", "Loafers": "Loafer",
    "Shoes": "Schuhe", "Scarf": "Schal", "Belt": "Gürtel", "Backpack": "Rucksack", "Beanie": "Beanie", "Cap": "Cap",
    "Hat": "Hut", "Sunglasses": "Sonnenbrille",
}
ABTEILUNG_DE = {"Women": "Damen", "Men": "Herren", "Unisex": "Unisex"}
VERSAND_FREI_AB = 99.0
VERSAND_CENTS = 6.19


AERMEL = {
    "T-Shirt": "Kurzarm", "Top": "Kurzarm", "Polo Shirt": "Kurzarm", "Tank Top": "Ärmellos", "Knit Top": "Kurzarm",
    "Long Sleeve": "Langarm", "Blouse": "Langarm", "Shirt": "Langarm", "Sweatshirt": "Langarm", "Sweater": "Langarm",
    "Cardigan": "Langarm", "Tunic": "Langarm", "Jacket": "Langarm", "Biker Jacket": "Langarm", "Bomber Jacket": "Langarm",
    "Blazer": "Langarm", "Coat": "Langarm", "Trench Coat": "Langarm", "Dress": "Kurzarm", "Vest": "Ärmellos", "Set": "Kurzarm",
}


def aermel(it) -> str:
    # Pflichtmerkmal bei Oberteilen; aus der Produktart abgeleitet, Hinweise im Titel gewinnen.
    t = str(it.get("title") or "").lower()
    if "ärmellos" in t or "tank" in t:
        return "Ärmellos"
    if "langarm" in t or "longsleeve" in t:
        return "Langarm"
    if "kurzarm" in t:
        return "Kurzarm"
    kat = str(it.get("taxonomy_category") or it.get("category") or "")
    standard = "Langarm" if kat in ("Tops", "Shirts", "Knitwear", "Jackets", "Coats", "Dresses") else ""
    return AERMEL.get(str(it.get("product_type") or ""), standard)


EINHEITSGROESSE = ("universal", "one size", "onesize", "einheitsgröße", "einheitsgroesse", "verstellbar", "größenverstellbar", "sonstige")


def ist_schuh(it) -> bool:
    return str(it.get("taxonomy_category") or it.get("category") or "") == "Shoes"


def ist_accessoire(it) -> bool:
    return str(it.get("taxonomy_category") or it.get("category") or "") == "Accessories"


def ebay_groesse(it) -> str:
    # eBay nimmt nur einen Wert aus seiner Liste: "M / 38 / 10" -> "M", "46" bleibt "46".
    # Schuhe laufen ueber "Schuhgroesse", Accessoires ohne Angabe als Einheitsgroesse.
    if ist_schuh(it):
        return ""
    roh = str(it.get("size") or "").strip()
    erster = roh.split("/")[0].strip()
    if erster.lower() in EINHEITSGROESSE or (not erster and ist_accessoire(it)):
        return "Einheitsgröße"
    return erster


# Marken, die Schuhe in UK-Groessen etikettieren (Prada "9" = UK 9 = EU 43).
UK_SCHUHMARKEN = ("prada", "church's", "churchs", "burberry", "dr. martens", "clarks", "grenson", "tricker's")


def _zahl(wert) -> str:
    # eBay.de kennt halbe Groessen nur mit Komma ("7,5"; "7.5" wird abgelehnt).
    wert = float(wert)
    return str(int(wert)) if wert == int(wert) else f"{wert:.1f}".replace(".", ",")


def schuhgroesse(it):
    # (EU, UK, US): eBay verlangt bei Schuhen die EU-Groesse. "3 / EU 41 / 26 cm" -> ("41", "", ""),
    # "US 9" -> ("42", "", "9"); kleine Zahlen sind UK (UK_SCHUHMARKEN, EU = UK + 34) oder US (EU = US + 33, Damen + 31).
    if not ist_schuh(it):
        return "", "", ""
    roh = str(it.get("size") or "").strip()
    damen = str(it.get("department") or "") == "Women"
    m = re.search(r"EU\s*(\d{2}(?:[.,]5)?)", roh, re.I)
    if m:
        return m.group(1).replace(",", "."), "", ""
    m = re.search(r"UK\s*(\d{1,2}(?:[.,]5)?)", roh, re.I)
    if m:
        uk = float(m.group(1).replace(",", "."))
        return _zahl(uk + (33 if damen else 34)), _zahl(uk), ""
    m = re.search(r"US\s*(\d{1,2}(?:[.,]5)?)", roh, re.I)
    if m:
        us = float(m.group(1).replace(",", "."))
        return _zahl(us + (31 if damen else 33)), "", _zahl(us)
    erster = roh.split("/")[0].strip().replace(",", ".")
    try:
        wert = float(erster)
    except ValueError:
        return "", "", ""
    if wert >= 30:
        return _zahl(wert), "", ""
    if str(it.get("brand") or "").strip().lower() in UK_SCHUHMARKEN:
        return _zahl(wert + (33 if damen else 34)), _zahl(wert), ""
    return _zahl(wert + (31 if damen else 33)), "", _zahl(wert)


def absatzhoehe(it) -> str:
    # Pflicht bei Damenstiefeln; aus der Produktart geschaetzt (eBay-Stufen).
    if not ist_schuh(it):
        return ""
    art = str(it.get("product_type") or "")
    if art == "Heels":
        return "Mittel (5-7,5 cm)"
    if art == "Boots":
        return "Niedrig (2,5-5 cm)"
    return "Flach (weniger als 2,5 cm)"


def hat_groesse(it) -> bool:
    # Kleidung ohne Groesse lehnt eBay ab (Merkmal "Groesse" ist Pflicht); Schuhe und Accessoires haben eigene Regeln.
    if ist_schuh(it):
        return bool(schuhgroesse(it)[0])
    return bool(ebay_groesse(it))


FARBWORTE = ["Schwarz", "Weiß", "Grau", "Blau", "Marineblau", "Hellblau", "Dunkelblau", "Rot", "Grün", "Gelb", "Orange",
             "Rosa", "Pink", "Lila", "Braun", "Beige", "Creme", "Khaki", "Silber", "Gold", "Bunt", "Türkis", "Oliv"]


def farbe(it) -> str:
    wert = str(it.get("color") or "").strip()
    if wert:
        return wert[:65]
    t = str(it.get("title") or "")
    for f in FARBWORTE:
        if re.search(rf"\b{f}\b", t, re.I):
            return f
    return "Mehrfarbig"


MATERIALWORTE = [("leder", "Leder"), ("kunstleder", "Kunstleder"), ("kunstfell", "Kunstfell"), ("fell", "Fell"), ("pelz", "Fell"),
                 ("daunen", "Daunen"), ("wolle", "Wolle"), ("kaschmir", "Kaschmir"), ("seide", "Seide"), ("leinen", "Leinen"),
                 ("denim", "Baumwolle"), ("jeans", "Baumwolle"), ("baumwolle", "Baumwolle"), ("nylon", "Nylon"), ("polyamid", "Polyamid"),
                 ("polyester", "Polyester"), ("viskose", "Viskose"), ("fleece", "Polyester"), ("mesh", "Polyester"), ("strick", "Wolle")]


def material(it) -> str:
    text = str(it.get("desc_de") or it.get("desc") or "")
    m = re.search(r"Material:\s*([^\n]+)", text)
    if m and m.group(1).strip().lower() not in ("keine angabe", "nicht angegeben", "unbekannt", "-", "–"):
        return m.group(1).strip()[:65]
    # Pflichtmerkmal "Aussenmaterial" bei Jacken: aus Titel/Text ableiten, sonst Mischgewebe.
    t = (str(it.get("title") or "") + " " + text).lower()
    for wort, wert in MATERIALWORTE:
        if wort in t:
            return wert
    return "Mischgewebe"


def laenge(it) -> str:
    # Kleider- und Rocklaenge (Pflicht bei Kleidern und Roecken), aus dem Titel; sonst knielang.
    t = (str(it.get("title") or "") + " " + str(it.get("desc_de") or "")).lower()
    if "mini" in t:
        return "Mini"
    if "maxi" in t or "bodenlang" in t:
        return "Maxi"
    if "midi" in t or "wadenlang" in t:
        return "Midi"
    return "Knielang"


def schrittlaenge(it) -> str:
    # Pflicht bei Herrenhosen; ohne Messwert als regulaer angeben.
    kat = str(it.get("taxonomy_category") or it.get("category") or "")
    return "Regulär" if kat == "Pants" else ""


def zustandsbeschreibung(it) -> str:
    """eBay-Feld 'Zustandsbeschreibung' (steht oben im Angebot neben dem Zustand): Maengel aus dem
    Katalog und aus der Fotodurchsicht, sonst der allgemeine Gebraucht-Hinweis. Max. 1000 Zeichen."""
    kt = _katalogtext(it)
    teile = [h for h in zustand_hinweise(it) if h and not re.search(r"neu mit (original)?etikett", h, re.I)]
    teile += [z for z in kt["zustand"] if z]
    if not teile:
        teile = ["Neu mit Originaletikett, ungetragen." if ist_neu(it) else "Gebrauchtes Einzelstück mit normalen, altersgemäßen Gebrauchsspuren, siehe Fotos."]
    return " ".join(teile)[:1000]


def zeile_voll(it, basis, hintergrund, aktion="VerifyAdd", sku_zusatz=""):
    frei = float(it["price"]) >= VERSAND_FREI_AB
    return [
        aktion, sku(it, sku_zusatz), kategorie(it) or "", titel(it), beschreibung(it), condition_id(it), zustandsbeschreibung(it),
        str(it.get("brand") or ""), ebay_groesse(it), *schuhgroesse(it), absatzhoehe(it), farbe(it),
        ABTEILUNG_DE.get(str(it.get("department") or ""), ""), PRODUKTART_DE.get(str(it.get("product_type") or ""), ""), STIL, aermel(it),
        material(it) if str(it.get("taxonomy_category") or "") in ("Jackets", "Coats", "Shoes", "Accessories") else "", material(it),
        laenge(it) if str(it.get("taxonomy_category") or "") == "Dresses" else "",
        laenge(it) if str(it.get("taxonomy_category") or "") == "Skirts" else "",
        schrittlaenge(it) if str(it.get("department") or "") == "Men" else "",
        "|".join(bild_urls(it, basis, hintergrund)), "FixedPrice", "GTC", f"{ebay_preis(it['price'])}.00", "1", "1",
        "Aschaffenburg", "63739", "3", "Flat", "DE_DHLPaket", "0.00" if frei else f"{VERSAND_CENTS:.2f}",
        "ReturnsAccepted", "Days_14", "Buyer",
    ]


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--csv", help="Entwurfs-CSV schreiben")
    p.add_argument("--ids", nargs="*", type=int, help="nur diese Artikelnummern")
    p.add_argument("--bilder", action="store_true", help="Fotos auf einfarbigem Grund erzeugen (Standard hellgrau nach assets/ebay/)")
    p.add_argument("--alle-bilder", action="store_true", help="auch vorhandene Fotos neu erzeugen")
    p.add_argument("--bild-basis", default=SITE_URL, help="Basis-URL fuer die Fotos (Standard: Website)")
    p.add_argument("--originalbilder", action="store_true", help="Original-Fotos (transparent) statt einfarbigem Grund verlinken")
    p.add_argument("--hintergrund", choices=sorted(HINTERGRUENDE), default="hellgrau", help="Grundfarbe der erzeugten Fotos (Standard: hellgrau)")
    p.add_argument("--sku-zusatz", default="", help="Zusatz hinter der Artikelnummer im SKU-Feld, z. B. 'schwarz' fuer Vergleichsentwuerfe")
    p.add_argument("--vollstaendig", choices=["VerifyAdd", "Add"], help="volle Angebots-Vorlage statt Entwurf (VerifyAdd prueft nur, Add stellt ein)")
    a = p.parse_args(argv)
    items = verfuegbar(lade_items())
    if a.ids:
        items = [it for it in items if int(it["id"]) in set(a.ids)]
    fehlend = [it["id"] for it in items if not kategorie(it)]
    if fehlend:
        print("Ohne eBay-Kategorie (werden ausgelassen):", fehlend, file=sys.stderr)
        items = [it for it in items if kategorie(it)]
    if a.vollstaendig:
        ohne_groesse = [it["id"] for it in items if not hat_groesse(it)]
        if ohne_groesse:
            print("Ohne Groesse (eBay-Pflichtmerkmal, werden ausgelassen):", ohne_groesse, file=sys.stderr)
            items = [it for it in items if hat_groesse(it)]
    if a.bilder:
        print("Fotos erzeugt:", bilder_erzeugen(items, nur_fehlende=not a.alle_bilder, hintergrund=a.hintergrund))
    if a.csv:
        basis = a.bild_basis if a.bild_basis.endswith("/") else a.bild_basis + "/"
        hintergrund = None if a.originalbilder else a.hintergrund
        ziel = Path(a.csv)
        with ziel.open("w", encoding="utf-8", newline="") as f:
            w = csv.writer(f, delimiter=";", quoting=csv.QUOTE_MINIMAL, lineterminator="\r\n")
            if a.vollstaendig:
                w.writerow(VOLL_HEADER)
                for it in items:
                    w.writerow(zeile_voll(it, basis, hintergrund, a.vollstaendig, sku_zusatz=a.sku_zusatz))
            else:
                for info in INFO:
                    f.write(info + "\r\n")
                w.writerow(HEADER)
                for it in items:
                    w.writerow(zeile(it, basis, hintergrund, sku_zusatz=a.sku_zusatz))
        print(f"{len(items)} Entwuerfe -> {ziel}")
        for it in items[:8]:
            print(f"  {it['id']}: {titel(it)} | Kat {kategorie(it)} | Shop {it['price']} -> eBay {ebay_preis(it['price'])} EUR | {len(bild_pfade(it))} Fotos")
    return 0


if __name__ == "__main__":
    sys.exit(main())

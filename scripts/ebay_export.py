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


def titel(it) -> str:
    t = re.sub(r"\s+", " ", str(it.get("title") or "")).strip()
    groesse = str(it.get("size") or "").strip()
    teile = [t]
    if groesse:
        teile.append("Gr. " + groesse)
    if "Designer" not in t:
        teile.append("Designer Secondhand")
    out = " ".join(teile)
    while len(out) > MAX_TITEL and len(teile) > 1:
        teile.pop()
        out = " ".join(teile)
    return out[:MAX_TITEL]


def beschreibung(it) -> str:
    text = str(it.get("desc_de") or it.get("desc") or "").strip()
    absaetze = [a.strip() for a in re.split(r"\n\s*\n", text) if a.strip()]
    teile = []
    for a in absaetze:
        zeilen = [html.escape(z.strip()) for z in a.split("\n") if z.strip()]
        teile.append("<p>" + "<br>".join(zeilen) + "</p>")
    fakten = []
    for label, key in (("Marke", "brand"), ("Größe", "size"), ("Farbe", "color"), ("Zustand", "condition")):
        wert = str(it.get(key) or "").strip()
        if wert:
            fakten.append(f"<li><b>{html.escape(label)}:</b> {html.escape(wert)}</li>")
    eu, uk, us = schuhgroesse(it)
    if eu and (uk or us):
        herkunft = f"UK {uk}" if uk else f"US {us}"
        fakten.append(f"<li><b>EU-Größe:</b> ca. {html.escape(eu)} (umgerechnet aus {herkunft}, Herstellerangabe)</li>")
    if fakten:
        teile.append("<ul>" + "".join(fakten) + "</ul>")
    teile.append("<p>Gebrauchtes Einzelstück aus dem kuratierten Archiv von DISORDER119 – individuell fotografiert und geprüft. "
                 "Normale, altersgemäße Gebrauchsspuren; Besonderheiten stehen in der Beschreibung und sind auf den Fotos zu sehen.</p>")
    teile.append("<p>Versand innerhalb Deutschlands mit DHL, sorgfältig von Hand verpackt, innerhalb von 3 Werktagen. "
                 "14 Tage Widerrufsrecht für Verbraucher. Kleinunternehmer gemäß § 19 UStG, keine Umsatzsteuer ausgewiesen.</p>")
    return "".join(teile)


def bild_pfade(it):
    return [str(p) for p in (it.get("gallery") or []) if isinstance(p, str) and p.startswith("assets/img/")][:MAX_BILDER]


def bild_urls(it, basis: str, weiss: bool) -> list[str]:
    urls = []
    for i, pfad in enumerate(bild_pfade(it)):
        if weiss:
            urls.append(f"{basis}assets/ebay/{it['id']}/{i}.webp")
        else:
            urls.append(f"{basis}{pfad}")
    return urls


def bilder_erzeugen(items, nur_fehlende=True) -> int:
    from PIL import Image
    anzahl = 0
    for it in items:
        ziel = BILD_ORDNER / str(it["id"])
        for i, pfad in enumerate(bild_pfade(it)):
            quelle = BASE / pfad
            out = ziel / f"{i}.webp"
            if not quelle.is_file() or (nur_fehlende and out.is_file()):
                continue
            ziel.mkdir(parents=True, exist_ok=True)
            im = Image.open(quelle).convert("RGBA")
            # Freigestelltes Foto auf reinem Weiss - eBay empfiehlt weissen Grund.
            weiss = Image.new("RGB", im.size, (255, 255, 255))
            weiss.paste(im, mask=im.getchannel("A"))
            weiss.save(out, "WEBP", quality=82, method=6)
            anzahl += 1
    return anzahl


def zeile(it, basis, weiss):
    kat = kategorie(it)
    return [
        "Draft", str(it["id"]), kat or "", titel(it), "", f"{ebay_preis(it['price'])}.00", "1",
        "|".join(bild_urls(it, basis, weiss)), "3000", beschreibung(it), "FixedPrice",
    ]


# ---- Vollstaendige Angebots-Vorlage (Action=Add / VerifyAdd): mit Artikelmerkmalen,
# Zustand, Versand, Ruecknahme - entsteht direkt als Angebot (VerifyAdd prueft nur).
VOLL_HEADER = [
    "*Action(SiteID=Germany|Country=DE|Currency=EUR|Version=1193|CC=UTF-8)", "CustomLabel", "*Category", "*Title",
    "*Description", "*ConditionID", "C:Marke", "C:Größe", "C:EU-Schuhgröße", "C:UK-Schuhgröße", "C:US-Schuhgröße", "C:Absatzhöhe",
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


def zeile_voll(it, basis, weiss, aktion="VerifyAdd"):
    frei = float(it["price"]) >= VERSAND_FREI_AB
    return [
        aktion, str(it["id"]), kategorie(it) or "", titel(it), beschreibung(it), "3000",
        str(it.get("brand") or ""), ebay_groesse(it), *schuhgroesse(it), absatzhoehe(it), farbe(it),
        ABTEILUNG_DE.get(str(it.get("department") or ""), ""), PRODUKTART_DE.get(str(it.get("product_type") or ""), ""), STIL, aermel(it),
        material(it) if str(it.get("taxonomy_category") or "") in ("Jackets", "Coats", "Shoes", "Accessories") else "", material(it),
        laenge(it) if str(it.get("taxonomy_category") or "") == "Dresses" else "",
        laenge(it) if str(it.get("taxonomy_category") or "") == "Skirts" else "",
        schrittlaenge(it) if str(it.get("department") or "") == "Men" else "",
        "|".join(bild_urls(it, basis, weiss)), "FixedPrice", "GTC", f"{ebay_preis(it['price'])}.00", "1", "1",
        "Aschaffenburg", "63739", "3", "Flat", "DE_DHLPaket", "0.00" if frei else f"{VERSAND_CENTS:.2f}",
        "ReturnsAccepted", "Days_14", "Buyer",
    ]


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--csv", help="Entwurfs-CSV schreiben")
    p.add_argument("--ids", nargs="*", type=int, help="nur diese Artikelnummern")
    p.add_argument("--bilder", action="store_true", help="Fotos auf weissem Grund nach assets/ebay/ erzeugen")
    p.add_argument("--alle-bilder", action="store_true", help="auch vorhandene Fotos neu erzeugen")
    p.add_argument("--bild-basis", default=SITE_URL, help="Basis-URL fuer die Fotos (Standard: Website)")
    p.add_argument("--originalbilder", action="store_true", help="Original-Fotos (transparent) statt weissem Grund verlinken")
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
        print("Fotos erzeugt:", bilder_erzeugen(items, nur_fehlende=not a.alle_bilder))
    if a.csv:
        basis = a.bild_basis if a.bild_basis.endswith("/") else a.bild_basis + "/"
        ziel = Path(a.csv)
        with ziel.open("w", encoding="utf-8", newline="") as f:
            w = csv.writer(f, delimiter=";", quoting=csv.QUOTE_MINIMAL, lineterminator="\r\n")
            if a.vollstaendig:
                w.writerow(VOLL_HEADER)
                for it in items:
                    w.writerow(zeile_voll(it, basis, not a.originalbilder, a.vollstaendig))
            else:
                for info in INFO:
                    f.write(info + "\r\n")
                w.writerow(HEADER)
                for it in items:
                    w.writerow(zeile(it, basis, not a.originalbilder))
        print(f"{len(items)} Entwuerfe -> {ziel}")
        for it in items[:8]:
            print(f"  {it['id']}: {titel(it)} | Kat {kategorie(it)} | Shop {it['price']} -> eBay {ebay_preis(it['price'])} EUR | {len(bild_pfade(it))} Fotos")
    return 0


if __name__ == "__main__":
    sys.exit(main())

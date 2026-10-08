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
    ("Women", "Sneakers"): "95672",   # Damen: Sneaker
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


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--csv", help="Entwurfs-CSV schreiben")
    p.add_argument("--ids", nargs="*", type=int, help="nur diese Artikelnummern")
    p.add_argument("--bilder", action="store_true", help="Fotos auf weissem Grund nach assets/ebay/ erzeugen")
    p.add_argument("--alle-bilder", action="store_true", help="auch vorhandene Fotos neu erzeugen")
    p.add_argument("--bild-basis", default=SITE_URL, help="Basis-URL fuer die Fotos (Standard: Website)")
    p.add_argument("--originalbilder", action="store_true", help="Original-Fotos (transparent) statt weissem Grund verlinken")
    a = p.parse_args(argv)
    items = verfuegbar(lade_items())
    if a.ids:
        items = [it for it in items if int(it["id"]) in set(a.ids)]
    fehlend = [it["id"] for it in items if not kategorie(it)]
    if fehlend:
        print("Ohne eBay-Kategorie (werden ausgelassen):", fehlend, file=sys.stderr)
        items = [it for it in items if kategorie(it)]
    if a.bilder:
        print("Fotos erzeugt:", bilder_erzeugen(items, nur_fehlende=not a.alle_bilder))
    if a.csv:
        basis = a.bild_basis if a.bild_basis.endswith("/") else a.bild_basis + "/"
        ziel = Path(a.csv)
        with ziel.open("w", encoding="utf-8", newline="") as f:
            for info in INFO:
                f.write(info + "\r\n")
            w = csv.writer(f, delimiter=";", quoting=csv.QUOTE_MINIMAL, lineterminator="\r\n")
            w.writerow(HEADER)
            for it in items:
                w.writerow(zeile(it, basis, not a.originalbilder))
        print(f"{len(items)} Entwuerfe -> {ziel}")
        for it in items[:8]:
            print(f"  {it['id']}: {titel(it)} | Kat {kategorie(it)} | Shop {it['price']} -> eBay {ebay_preis(it['price'])} EUR | {len(bild_pfade(it))} Fotos")
    return 0


if __name__ == "__main__":
    sys.exit(main())

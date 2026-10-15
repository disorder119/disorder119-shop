#!/usr/bin/env python3
"""SEO-Technik der Produktseiten, Startseiten und des Merchant-Feeds.

Prüft nach dem Bauen (und nach scripts/repair_public_article_integrity.py):
* Product-JSON-LD ist gültiges JSON; verfügbare Stücke tragen Versand mit
  Laufzeiten (deliveryTime), Größe als SizeSpecification, Zielgruppe aus dem
  Bereich und Farbe im Google-Format ("/", ohne Bunt/Multicolor).
* Seite und Feed stimmen überein: Versandpreis und Zustand (new/used).
* Meta-Beschreibungen nennen keinen Zustand (Inhaber 07.10.2026).
* vor/zurück sind echte Links auf url_slug-Adressen; "Ähnliche Teile" zeigt
  nur verfügbare Stücke, und jedes verfügbare Stück bekommt mindestens drei
  interne Links (Ähnliche Teile, soweit Marke/Kategorie es hergeben, plus
  vor/zurück).
* Startseiten DE/EN/FR: crawlbare Links auf alle verfügbaren Stücke, H1 mit
  Suchbegriff, ItemList nur mit verfügbaren Stücken, Rückgaberegel am Shop.
* /match/, /chaos/, /baukasten/: nur noindex, keine canonical-Angabe auf die
  Startseite.
"""
from __future__ import annotations

import html as html_lib
import json
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from i18n_text import COLOR_TR, CONDITION_PHRASES, MULTICOLOR_WORDS, apply_brand_aliases, item_condition  # noqa: E402
from related_items import MIN_INCOMING, related_plan  # noqa: E402

BASE = Path(__file__).resolve().parents[1]
SITE = "https://disorder119.com"
LANGS = ("de", "en", "fr")
G = "{http://base.google.com/ns/1.0}"
LD_RE = re.compile(r'<script type="application/ld\+json">(.*?)</script>', re.S)
META_DESC_RE = re.compile(r'<meta name="description" content="([^"]*)">')
SEQ_RE = re.compile(r'<a class="article-sequence-nav__link article-sequence-nav__link--(prev|next)"([^>]*)>')
HREF_RE = re.compile(r'href="(?:/(?:en|fr))?/artikel/(\d+)/"')
RELATED_BLOCK_RE = re.compile(r'<div class="related">.*?(?=<div class="page-foot">)', re.S)
MULTICOLOR_OUT = {w.casefold() for w in MULTICOLOR_WORDS} | {COLOR_TR[w][l].casefold() for w in MULTICOLOR_WORDS for l in ("en", "fr")}


def home(lang: str) -> str:
    return "/" if lang == "de" else f"/{lang}/"


def page_path(lang: str, slug: str) -> Path:
    root = BASE if lang == "de" else BASE / lang
    return root / "artikel" / slug / "index.html"


def lds(page: str) -> list[dict]:
    return [json.loads(raw) for raw in LD_RE.findall(page)]


def feed_entries() -> dict[str, dict]:
    tree = ET.parse(BASE / "feed" / "google-merchant.xml")
    out = {}
    for item in tree.getroot().iter("item"):
        link = item.findtext(G + "link") or ""
        slug = link.rstrip("/").rsplit("/", 1)[-1]
        shipping = item.find(G + "shipping")
        out[slug] = {
            "condition": item.findtext(G + "condition"),
            "color": item.findtext(G + "color"),
            "shipping": shipping.findtext(G + "price") if shipping is not None else None,
            "handling": shipping.findtext(G + "max_handling_time") if shipping is not None else None,
            "transit": shipping.findtext(G + "max_transit_time") if shipping is not None else None,
        }
    return out


def check() -> tuple[list[str], dict]:
    errors: list[str] = []
    items = json.loads((BASE / "data" / "items.json").read_text(encoding="utf-8"))
    apply_brand_aliases(items)
    public = [it for it in items if (it.get("public_status") or "DRAFT") != "DRAFT"]
    available = [it for it in public if it.get("public_status") == "AVAILABLE"]
    slug_of = {it["id"]: str(it.get("url_slug", it["id"])) for it in items}
    by_slug = {slug_of[it["id"]]: it for it in public}
    available_slugs = {slug_of[it["id"]] for it in available}
    feed = feed_entries()
    incoming_related = {s: set() for s in available_slugs}
    incoming_sequence = {s: set() for s in available_slugs}
    zustand_texte = CONDITION_PHRASES

    for it in public:
        slug = slug_of[it["id"]]
        for lang in LANGS:
            ort = f"{home(lang)}artikel/{slug}/"
            path = page_path(lang, slug)
            if not path.is_file():
                errors.append(f"{ort}: Seite fehlt")
                continue
            page = path.read_text(encoding="utf-8")
            try:
                daten = lds(page)
            except json.JSONDecodeError as exc:
                errors.append(f"{ort}: JSON-LD ungültig ({exc})")
                continue
            product = next((d for d in daten if d.get("@type") == "Product"), None)

            meta = META_DESC_RE.search(page)
            meta_text = html_lib.unescape(meta.group(1)) if meta else ""
            for label, werte in zustand_texte[lang].items():
                for wert in werte:
                    if f"{label} {wert}" in meta_text:
                        errors.append(f"{ort}: Meta-Beschreibung nennt den Zustand ({label} {wert})")

            if it.get("public_status") == "AVAILABLE" and float(it.get("price") or 0) > 0:
                if not product:
                    errors.append(f"{ort}: Product-JSON-LD fehlt")
                    continue
                offer = product.get("offers") or {}
                versand = offer.get("shippingDetails")
                if not versand or "deliveryTime" not in versand:
                    errors.append(f"{ort}: offers.shippingDetails mit deliveryTime fehlt")
                eintrag = feed.get(slug)
                if lang == "de" and eintrag:
                    if versand and eintrag["shipping"] != versand["shippingRate"]["value"] + " EUR":
                        errors.append(f"{ort}: Versand Seite {versand['shippingRate']['value']} ≠ Feed {eintrag['shipping']}")
                    erwartet = "https://schema.org/NewCondition" if eintrag["condition"] == "new" else "https://schema.org/UsedCondition"
                    if offer.get("itemCondition") != erwartet or eintrag["condition"] != item_condition(it):
                        errors.append(f"{ort}: Zustand Seite {offer.get('itemCondition')} ≠ Feed {eintrag['condition']}")
                    if not eintrag["handling"] or not eintrag["transit"]:
                        errors.append(f"{ort}: g:shipping ohne Bearbeitungs-/Laufzeit im Feed")
                farbe = product.get("color")
                if farbe is not None:
                    teile = farbe.split("/")
                    if len(teile) > 3 or "," in farbe or any(t.strip().casefold() in MULTICOLOR_OUT for t in teile):
                        errors.append(f"{ort}: JSON-LD color nicht im Google-Format: {farbe!r}")
                size = product.get("size")
                if size is not None and (not isinstance(size, dict) or size.get("@type") != "SizeSpecification"):
                    errors.append(f"{ort}: JSON-LD size ist keine SizeSpecification")
                if it.get("department") in ("Women", "Men", "Unisex") and "audience" not in product:
                    errors.append(f"{ort}: JSON-LD audience fehlt")
                if it.get("material") and not product.get("material"):
                    errors.append(f"{ort}: JSON-LD material fehlt trotz Feld")
                if not it.get("material") and "material" in product:
                    errors.append(f"{ort}: JSON-LD material ohne Feld (geraten?)")

            # vor/zurück
            for richtung, attrs in SEQ_RE.findall(page):
                ziel = HREF_RE.search(attrs)
                if it.get("public_status") == "AVAILABLE":
                    if not ziel:
                        errors.append(f"{ort}: {richtung}-Link ohne href")
                    elif ziel.group(1) not in available_slugs:
                        errors.append(f"{ort}: {richtung}-Link auf {ziel.group(1)} (nicht verfügbar)")
                    elif lang == "de":
                        incoming_sequence[ziel.group(1)].add(slug)

            # Ähnliche Teile
            block = RELATED_BLOCK_RE.search(page)
            for ziel in HREF_RE.findall(block.group(0) if block else ""):
                if ziel not in available_slugs:
                    errors.append(f"{ort}: 'Ähnliche Teile' verlinkt {ziel} (nicht verfügbar)")
                elif lang == "de":
                    incoming_related[ziel].add(slug)

    # Mindestens drei eingehende Links je verfügbarem Stück.
    plan = related_plan(items)
    for it in available:
        slug = slug_of[it["id"]]
        quellen = [x for x in public if x["id"] != it["id"] and (
            (x.get("brand") and x.get("brand") == it.get("brand"))
            or (x.get("taxonomy_category") or x.get("category")) == (it.get("taxonomy_category") or it.get("category")))]
        moeglich = min(MIN_INCOMING, len(quellen))
        if len(incoming_related[slug]) < moeglich:
            errors.append(f"artikel/{slug}: nur {len(incoming_related[slug])} Links aus 'Ähnliche Teile' (möglich {moeglich})")
        gesamt = incoming_related[slug] | incoming_sequence[slug]
        if len(gesamt) < MIN_INCOMING:
            errors.append(f"artikel/{slug}: nur {len(gesamt)} interne Links insgesamt")
        geplant = sum(1 for m, k in plan.values() for x in m + k if x["id"] == it["id"])
        if geplant != len(incoming_related[slug]):
            errors.append(f"artikel/{slug}: Seiten zeigen {len(incoming_related[slug])} statt {geplant} geplante Links "
                          "(Reparaturskript und Build laufen auseinander?)")

    # Startseiten
    for lang in LANGS:
        pfad = BASE / ("index.html" if lang == "de" else f"{lang}/index.html")
        page = pfad.read_text(encoding="utf-8")
        ort = home(lang)
        nav = re.search(r"<nav class=\"d119-sr-only\"[^>]*data-produktlinks>(.*?)</nav>", page, re.S)
        verlinkt = set(HREF_RE.findall(nav.group(1))) if nav else set()
        if verlinkt != available_slugs:
            errors.append(f"{ort}: crawlbare Produktlinks {len(verlinkt)} statt {len(available_slugs)}")
        h1 = re.search(r'<h1 class="wordmark"([^>]*)>(.*?)</h1>', page, re.S)
        if not h1 or "aria-label" in h1.group(1) or 'class="d119-sr-only"' not in h1.group(2):
            errors.append(f"{ort}: H1 ohne versteckten Suchbegriff (oder aria-label überdeckt ihn)")
        try:
            daten = lds(page)
        except json.JSONDecodeError as exc:
            errors.append(f"{ort}: JSON-LD ungültig ({exc})")
            continue
        liste = next((d for d in daten if d.get("@type") == "ItemList"), None)
        if not liste:
            errors.append(f"{ort}: ItemList fehlt")
        else:
            urls = {e["url"].rstrip("/").rsplit("/", 1)[-1] for e in liste["itemListElement"]}
            if urls != available_slugs:
                errors.append(f"{ort}: ItemList enthält {len(urls)} statt {len(available_slugs)} verfügbare Stücke")
        store = next((n for d in daten for n in d.get("@graph", []) if n.get("@type") == "OnlineStore"), None)
        if not store or "hasMerchantReturnPolicy" not in store:
            errors.append(f"{ort}: OnlineStore ohne hasMerchantReturnPolicy")

    for lang in LANGS:
        for variant in ("match", "chaos", "baukasten"):
            pfad = BASE / (variant if lang == "de" else f"{lang}/{variant}") / "index.html"
            page = pfad.read_text(encoding="utf-8")
            if 'name="robots" content="noindex,follow"' not in page:
                errors.append(f"{home(lang)}{variant}/: noindex fehlt")
            if f'<link rel="canonical" href="{SITE}{home(lang)}">' in page:
                errors.append(f"{home(lang)}{variant}/: canonical auf die Startseite trotz noindex")

    build = (BASE / "build_site.py").read_text(encoding="utf-8")
    if "LANDING_DEP_LABEL" in build:
        errors.append("build_site.py: Rest LANDING_DEP_LABEL aus dem geschlossenen SEO-PR")
    return errors, {"available": len(available), "pages": len(public) * len(LANGS)}


def main() -> None:
    errors, stats = check()
    if errors:
        for message in errors[:60]:
            print("FEHLER:", message, file=sys.stderr)
        if len(errors) > 60:
            print(f"FEHLER: … und {len(errors) - 60} weitere", file=sys.stderr)
        raise SystemExit(1)
    print(f"Produkt-SEO: OK – {stats['pages']} Sprachseiten, {stats['available']} verfügbare Stücke "
          "mit Versand, Zielgruppe, Größe, echten vor/zurück-Links und je ≥3 internen Links.")


if __name__ == "__main__":
    main()

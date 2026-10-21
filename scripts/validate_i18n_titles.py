#!/usr/bin/env python3
"""EN/FR-Produktseiten: Titel, Farben und Beschreibungen in der Seitensprache.

Bricht nur bei Code-Fehlern ab - nie wegen eines Datenwerts, sonst blockiert
eine Admin-Speicherung (freies Farbfeld, freie Beschreibung) den Rebuild:
* Steht title_en/title_fr in data/items.json oder wird er abgeleitet, müssen
  h1, <title>, og/twitter, JSON-LD name, Breadcrumb, Bild-Alt und die
  "Ähnliche Teile"-Karten ihn tragen - sonst hat ein Skript nach dem Bauen
  den Titel überschrieben.
* Der deutsche Titel darf auf EN/FR nirgends sichtbar oder in den
  Suchmaschinendaten stehen (außer in ARTICLE_ITEM.title_de/desc_de, die
  der Shop für Anfragen braucht).
* Bekannte deutsche Farbwörter (Tabelle COLOR_TR) sind im Fakt "Color/Couleur"
  und im JSON-LD übersetzt - die Übersetzung geht Wort für Wort, ein
  übrig gebliebenes bekanntes Wort ist also ein Fehler im Code.
* catalog.json trägt title_en/title_fr für jedes öffentliche Stück.
* assets/app.js übersetzt Farben mit derselben Tabelle wie scripts/i18n_text.py.

Nur als HINWEIS (Daten, kein Abbruch): unbekannte Farbwörter, beim Ableiten
verworfene deutsche Wendungen, Faktenzeilen mit deutschen Werten in einer
eigenen EN/FR-Beschreibung, Produktart oder Etikettgröße nicht übersetzt,
doppelte Titel in einer Sprache, fehlende eigene Titel/Texte.
"""
from __future__ import annotations

import html as html_lib
import json
import re
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import i18n_text  # noqa: E402
from i18n_text import (  # noqa: E402
    COLOR_TR, apply_brand_aliases, color_canonical, loc_name, loc_title, title_parts, unknown_color_words,
)

BASE = Path(__file__).resolve().parents[1]
LANGS = ("en", "fr")
LD_RE = re.compile(r'<script type="application/ld\+json">(.*?)</script>', re.S)
ARTICLE_ITEM_RE = re.compile(r"<script>\s*window\.ARTICLE_ITEM = .*?</script>", re.S)
H1_RE = re.compile(r"<h1>(.*?)</h1>", re.S)
TITLE_RE = re.compile(r"<title>(.*?)</title>", re.S)
META_RE = {
    "og:title": re.compile(r'<meta property="og:title" content="([^"]*)">'),
    "twitter:title": re.compile(r'<meta name="twitter:title" content="([^"]*)">'),
    "og:image:alt": re.compile(r'<meta property="og:image:alt" content="([^"]*)">'),
    "description": re.compile(r'<meta name="description" content="([^"]*)">'),
}
MAIN_ALT_RE = re.compile(r'<img id="galleryMain" [^>]*alt="([^"]*)"')
DESC_RE = re.compile(r'<p class="info__desc" id="itemDesc">(.*?)</p>', re.S)
COLOR_FACT_RE = re.compile(r'data-i18n="factColor">[^<]*</div><div class="fact__value">([^<]*)</div>')
TYPE_FACT_RE = re.compile(r'data-taxonomy-fact="product-type"><div class="fact__label">[^<]*</div><div class="fact__value">([^<]*)</div>')
LABEL_SIZE_FACT_RE = re.compile(r'data-taxonomy-fact="label-size"><div class="fact__label">[^<]*</div><div class="fact__value">([^<]*)</div>')
CARD_RE = re.compile(r'<a class="related-card" href="(?:/(?:en|fr))?/artikel/(\d+)/">.*?</a>', re.S)
CARD_TITLE_RE = re.compile(r'<span class="related-card__title">([^<]*)</span>')
GERMAN_FACT_RE = {
    "en": re.compile(r"\b(?:Category|Size|Colou?r)\s*:\s*([^.\n]*)"),
    "fr": re.compile(r"\b(?:Catégorie|Taille|Couleur)\s*:\s*([^.\n]*)"),
}
# Werte, die in CI-Faktenzeilen nur auf Deutsch vorkamen.
GERMAN_FACT_VALUES = re.compile(r"\b(?:Einheitsgröße|verstellbar|Größenverstellbar|Sonstige)\b")
# Produktarten, die auf Französisch genauso heißen.
FR_SAME_WORDS = {"blazer", "cardigan", "blouse", "sweatshirt", "polo", "parka", "trench"}
GERMAN_LABEL_WORDS = re.compile(r"\b(?:nicht|angegeben|geschätzt|eindeutig|lesbar|unbekannt|ca\.)", re.I)


def german_only_colors() -> set[str]:
    """Farbwörter, deren englische UND französische Form anders lautet."""
    return {k for k, v in COLOR_TR.items() if v["en"].casefold() != k.casefold() and v["fr"].casefold() != k.casefold()}


GERMAN_ONLY_COLORS = german_only_colors()


def page_path(lang: str, slug: str) -> Path:
    return BASE / lang / "artikel" / slug / "index.html"


def unesc(text: str) -> str:
    return html_lib.unescape(text or "").strip()


def product_ld(page: str) -> tuple[dict | None, dict | None]:
    product = breadcrumb = None
    for raw in LD_RE.findall(page):
        data = json.loads(raw)
        if data.get("@type") == "Product":
            product = data
        elif data.get("@type") == "BreadcrumbList":
            breadcrumb = data
    return product, breadcrumb


def js_color_table() -> dict:
    app = (BASE / "assets" / "app.js").read_text(encoding="utf-8")
    match = re.search(r"var COLOR_TR = (\{.*?\});\n", app)
    if not match:
        return {}
    return json.loads(match.group(1))


def german_color_words(text: str) -> list[str]:
    found = []
    for token in re.findall(r"[A-Za-zÄÖÜäöüßéè]+", text or ""):
        key = color_canonical(token)
        if key and key in GERMAN_ONLY_COLORS and token == key:
            found.append(token)
    return found


def check(items: list[dict]) -> tuple[list[str], list[str], dict]:
    errors: list[str] = []
    notes: list[str] = []
    stats = {"pages": 0, "own_title": {"en": 0, "fr": 0}, "derived_title": {"en": 0, "fr": 0},
             "fallback_description": {"en": 0, "fr": 0}}
    public = [it for it in items if (it.get("public_status") or "DRAFT") != "DRAFT"]
    by_slug = {str(it.get("url_slug", it["id"])): it for it in public}
    hinweise: dict[str, list[str]] = {}

    def hinweis(art: str, text: str) -> None:
        hinweise.setdefault(art, []).append(text)

    if js_color_table() != {k: {"en": v["en"], "fr": v["fr"]} for k, v in COLOR_TR.items()}:
        errors.append("assets/app.js COLOR_TR weicht von scripts/i18n_text.py COLOR_TR ab")

    catalog = json.loads((BASE / "data" / "catalog.json").read_text(encoding="utf-8"))
    by_id = {it["id"]: it for it in public}
    for row in catalog:
        it = by_id.get(row.get("id"))
        if not it:
            continue
        for lang in LANGS:
            if row.get("title_" + lang) != loc_title(it, lang):
                errors.append(f"catalog.json {it['id']}: title_{lang} fehlt oder weicht ab")

    for it in public:
        for wort in unknown_color_words(it.get("color")):
            hinweis("unbekanntes Farbwort (bleibt auf EN/FR deutsch)", f"{it['id']}: {wort!r}")
        for lang in LANGS:
            if not str(it.get("title_" + lang) or "").strip():
                for weg in title_parts(it, lang)[1]:
                    hinweis(f"beim Ableiten verworfen ({lang}, title_{lang} fehlt)", f"{it['id']}: {weg!r}")

    for it in public:
        slug = str(it.get("url_slug", it["id"]))
        deutsch_titel = str(it.get("title") or "")
        deutsch_name = i18n_text.display_name(it)
        for lang in LANGS:
            path = page_path(lang, slug)
            if not path.is_file():
                errors.append(f"{lang}/artikel/{slug}/ fehlt")
                continue
            page = path.read_text(encoding="utf-8")
            stats["pages"] += 1
            eigen = str(it.get("title_" + lang) or "").strip()
            stats["own_title" if eigen else "derived_title"][lang] += 1
            titel = loc_title(it, lang)
            name = loc_name(it, lang)
            ort = f"{lang}/artikel/{slug}"

            h1 = H1_RE.search(page)
            if not h1 or unesc(h1.group(1)) != titel:
                errors.append(f"{ort}: h1 ist nicht der Titel der Sprache ({titel!r})")
            title_tag = unesc((TITLE_RE.search(page) or [None, ""])[1])
            if name not in title_tag:
                errors.append(f"{ort}: <title> enthält nicht {name!r}")
            for key in ("og:title", "twitter:title", "og:image:alt"):
                found = META_RE[key].search(page)
                wert = unesc(found.group(1)) if found else ""
                soll = name if key == "og:image:alt" else None
                if (soll and wert != soll) or (not soll and name not in wert):
                    errors.append(f"{ort}: {key} passt nicht zum Titel der Sprache")
            alt = MAIN_ALT_RE.search(page)
            if not alt or unesc(alt.group(1)) != name:
                errors.append(f"{ort}: Alt-Text des Hauptbilds passt nicht")

            try:
                product, breadcrumb = product_ld(page)
            except json.JSONDecodeError as exc:
                errors.append(f"{ort}: JSON-LD ungültig ({exc})")
                product = breadcrumb = None
            if it.get("public_status") != "SOLD":
                if not product or product.get("name") != name:
                    errors.append(f"{ort}: JSON-LD name ist nicht {name!r}")
                elif german_color_words(str(product.get("color") or "")):
                    errors.append(f"{ort}: JSON-LD color mit bekanntem deutschem Farbwort: {product.get('color')!r}")
            if not breadcrumb or breadcrumb["itemListElement"][-1].get("name") != name:
                errors.append(f"{ort}: Breadcrumb nennt nicht {name!r}")

            # Deutscher Titel nirgends außerhalb von ARTICLE_ITEM.
            ohne_daten = ARTICLE_ITEM_RE.sub("", page)
            klartext = html_lib.unescape(ohne_daten)
            for deutsch in {deutsch_name, deutsch_titel}:
                if deutsch and deutsch not in (titel, name) and deutsch in klartext:
                    errors.append(f"{ort}: deutscher Titel {deutsch!r} steht auf der Seite")

            beschreibung = DESC_RE.search(page)
            text = unesc(beschreibung.group(1)) if beschreibung else ""
            for wert in GERMAN_FACT_RE[lang].findall(text):
                if german_color_words(wert) or GERMAN_FACT_VALUES.search(wert):
                    hinweis(f"Faktenzeile mit deutschem Wert in desc_{lang}", f"{ort}: {wert.strip()!r}")
            if not i18n_text.own_description(it, lang):
                stats["fallback_description"][lang] += 1

            farbe = COLOR_FACT_RE.search(page)
            if farbe and german_color_words(unesc(farbe.group(1))):
                errors.append(f"{ort}: bekanntes Farbwort nicht übersetzt: {unesc(farbe.group(1))!r}")

            typ = TYPE_FACT_RE.search(page)
            if lang == "fr" and typ and it.get("product_type") and unesc(typ.group(1)) == it["product_type"] \
                    and it["product_type"].casefold() not in FR_SAME_WORDS:
                hinweis("Produktart auf FR englisch (catalog_taxonomy PRODUCT_TYPE_LABELS['fr'])",
                        f"{ort}: {it['product_type']!r}")
            etikett = LABEL_SIZE_FACT_RE.search(page)
            if etikett and GERMAN_LABEL_WORDS.search(unesc(etikett.group(1))):
                hinweis("Etikettgröße mit deutschem Zusatz", f"{ort}: {unesc(etikett.group(1))!r}")

            # Karten "Ähnliche Teile": Titel der verlinkten Stücke in dieser Sprache.
            for karte in CARD_RE.finditer(page):
                ziel = by_slug.get(karte.group(1))
                titel_karte = CARD_TITLE_RE.search(karte.group(0))
                if ziel and titel_karte and unesc(titel_karte.group(1)) != loc_title(ziel, lang):
                    errors.append(f"{ort}: Karte {karte.group(1)} zeigt nicht den Titel der Sprache")

    # Doppelte Titel: nur melden, wenn der deutsche Titel eindeutig ist.
    verfuegbar = [it for it in public if it.get("public_status") == "AVAILABLE"]
    deutsch = Counter(loc_name(it, "de") for it in verfuegbar)
    for lang in LANGS:
        zaehler = Counter(loc_name(it, lang) for it in verfuegbar)
        for it in verfuegbar:
            name = loc_name(it, lang)
            if zaehler[name] > 1 and deutsch[loc_name(it, "de")] == 1:
                hinweis(f"doppelter Titel auf {lang.upper()} (title_{lang} setzen)", f"{it['id']}: {name!r}")

    for lang in LANGS:
        if stats["derived_title"][lang]:
            notes.append(f"{stats['derived_title'][lang]} Stücke ohne title_{lang} (Titel wird abgeleitet)")
        if stats["fallback_description"][lang]:
            notes.append(f"{stats['fallback_description'][lang]} Stücke ohne eigene desc_{lang} (Ersatztext)")
    for art, faelle in hinweise.items():
        beispiele = "; ".join(faelle[:6]) + (" …" if len(faelle) > 6 else "")
        notes.append(f"{len(faelle)}× {art}: {beispiele}")
    return errors, notes, stats


def main() -> None:
    items = json.loads((BASE / "data" / "items.json").read_text(encoding="utf-8"))
    apply_brand_aliases(items)
    errors, notes, stats = check(items)
    for note in notes:
        print("HINWEIS:", note)
    if errors:
        for message in errors[:60]:
            print("FEHLER:", message, file=sys.stderr)
        if len(errors) > 60:
            print(f"FEHLER: … und {len(errors) - 60} weitere", file=sys.stderr)
        raise SystemExit(1)
    print(f"EN/FR-Titel: OK – {stats['pages']} Sprachseiten ohne deutsche Produkttitel, "
          f"eigene Titel EN {stats['own_title']['en']} / FR {stats['own_title']['fr']}.")


if __name__ == "__main__":
    main()

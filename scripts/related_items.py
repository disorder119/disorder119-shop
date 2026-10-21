"""Interne Verlinkung der Produktseiten - an genau einer Stelle definiert.

* "Mehr von <Marke>" und "Ähnliche Archivstücke": je Seite höchstens vier
  Karten, nur verfügbare Stücke. Jede Seite zeigt ein Fenster, das in der
  Marken- bzw. Kategorieliste hinter dem eigenen Stück beginnt und rundum
  läuft. So bekommt jede Markenseite andere Nachbarn statt immer derselben
  vier Teile (gemessen 15.10.2026: 69 von 157 verfügbaren Stücken hatten keinen
  einzigen Link, die neuesten 50-69). Danach füllt ein Ausgleich auf, bis jedes
  verfügbare Stück mindestens MIN_INCOMING Links bekommt, soweit Marke und
  Kategorie das hergeben.
* vor/zurück: Reihenfolge wie das Archiv ohne Filter (AVAILABLE, hell nach
  dunkel - wie der Rückfall in assets/pwa-runtime.js), Adressen über url_slug.

build_site.py rendert die Karten, scripts/repair_public_article_integrity.py
setzt sie nach dem Bauen erneut - beide rufen dieses Modul auf.
"""
from __future__ import annotations

import html
from pathlib import Path

from i18n_text import browse_category, loc_name, loc_title

RELATED_N = 4
MIN_INCOMING = 3

HEADINGS = {
    "de": {"brand": "MEHR VON {brand}", "category": "ÄHNLICHE ARCHIVSTÜCKE", "request": "Preis auf Anfrage", "no_brand": "Ohne Marke"},
    "en": {"brand": "MORE FROM {brand}", "category": "SIMILAR ARCHIVE PIECES", "request": "Price on request", "no_brand": "No brand"},
    "fr": {"brand": "PLUS DE {brand}", "category": "PIÈCES D’ARCHIVE SIMILAIRES", "request": "Prix sur demande", "no_brand": "Sans marque"},
}


def slug(it: dict) -> str:
    return str(it.get("url_slug", it["id"]))


def lang_home(lang: str) -> str:
    return "/" if lang == "de" else "/" + lang + "/"


def _linkable(it: dict) -> bool:
    gallery = it.get("gallery") or []
    return it.get("public_status") == "AVAILABLE" and bool(gallery and gallery[0])


def _window(lst: list[dict], source: dict, pos: dict, k: int, exclude: set) -> list[dict]:
    """Bis zu k Stücke, die in `lst` hinter `source` folgen (rundum)."""
    if not lst or k <= 0:
        return []
    eigene = pos[source["id"]]
    start = next((i for i, x in enumerate(lst) if pos[x["id"]] > eigene), 0)
    out: list[dict] = []
    for j in range(len(lst)):
        x = lst[(start + j) % len(lst)]
        if x["id"] == source["id"] or x["id"] in exclude:
            continue
        out.append(x)
        if len(out) == k:
            break
    return out


def related_plan(items: list[dict], n: int = RELATED_N, min_incoming: int = MIN_INCOMING) -> dict:
    """{id: (marken_stuecke, kategorie_stuecke)} für jede öffentliche Seite.

    `items` in der Reihenfolge von data/items.json, Marken bereits
    vereinheitlicht (i18n_text.apply_brand_aliases)."""
    pos = {it["id"]: i for i, it in enumerate(items)}
    public = [it for it in items if (it.get("public_status") or "DRAFT") != "DRAFT"]
    pool = [it for it in items if _linkable(it)]
    by_brand: dict[str, list[dict]] = {}
    by_cat: dict[str, list[dict]] = {}
    for it in pool:
        if it.get("brand"):
            by_brand.setdefault(it["brand"], []).append(it)
        by_cat.setdefault(browse_category(it), []).append(it)

    plan: dict[int, tuple[list[dict], list[dict]]] = {}
    for src in public:
        marke = _window(by_brand.get(src.get("brand") or "", []), src, pos, n, set()) if src.get("brand") else []
        kategorie = _window(by_cat.get(browse_category(src), []), src, pos, n, {x["id"] for x in marke})
        plan[src["id"]] = (marke, kategorie)

    incoming = {it["id"]: 0 for it in pool}
    for marke, kategorie in plan.values():
        for x in marke + kategorie:
            incoming[x["id"]] += 1

    # Ausgleich: Stücke mit zu wenig Links kommen auf weitere Seiten derselben
    # Marke bzw. Kategorie - in einen freien Platz oder anstelle eines Stücks,
    # das mehr als genug Links hat. Reihenfolge fest, damit jeder Build gleich
    # aussieht.
    for ziel in sorted(pool, key=lambda x: (incoming[x["id"]], pos[x["id"]])):
        if incoming[ziel["id"]] >= min_incoming:
            continue
        for src in public:
            if incoming[ziel["id"]] >= min_incoming:
                break
            if src["id"] == ziel["id"]:
                continue
            marke, kategorie = plan[src["id"]]
            if any(x["id"] == ziel["id"] for x in marke + kategorie):
                continue
            if src.get("brand") and src.get("brand") == ziel.get("brand"):
                abschnitt = marke
            elif browse_category(src) == browse_category(ziel):
                abschnitt = kategorie
            else:
                continue
            if len(abschnitt) < n:
                abschnitt.append(ziel)
                incoming[ziel["id"]] += 1
                continue
            tausch = max(
                (i for i, x in enumerate(abschnitt) if incoming[x["id"]] > min_incoming),
                key=lambda i: (incoming[abschnitt[i]["id"]], -pos[abschnitt[i]["id"]]),
                default=None,
            )
            if tausch is None:
                continue
            incoming[abschnitt[tausch]["id"]] -= 1
            abschnitt[tausch] = ziel
            incoming[ziel["id"]] += 1
    return plan


def incoming_counts(plan: dict) -> dict:
    counts: dict[int, int] = {}
    for marke, kategorie in plan.values():
        for x in marke + kategorie:
            counts[x["id"]] = counts.get(x["id"], 0) + 1
    return counts


def article_sequence(items: list[dict]) -> dict:
    """{url_slug: (vorheriger, nächster)} wie das Archiv ohne Filter:
    verfügbare Stücke, hell nach dunkel, rundum."""
    verfuegbar = [it for it in items if it.get("public_status") == "AVAILABLE"]
    verfuegbar.sort(key=lambda it: -(it["brightness"] if isinstance(it.get("brightness"), (int, float)) else 0.5))
    reihe = [slug(it) for it in verfuegbar]
    if len(reihe) < 2:
        return {}
    return {s: (reihe[i - 1], reihe[(i + 1) % len(reihe)]) for i, s in enumerate(reihe)}


def fmt_price(value: float) -> str:
    s = f"{value:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    return s + " €"


def card_image(it: dict, base: Path) -> str:
    """Kleinste vorhandene Fassung des Titelbilds (220x293 reicht für die Karte;
    das volle Galeriebild kostete gemessen 915 KB für zwei Kacheln)."""
    gallery = it.get("gallery") or []
    if not gallery:
        return "assets/favicon.png"
    kopf, _, datei = gallery[0].rpartition("/")
    for kandidat in (f"{kopf}/thumbs/{datei}", f"{kopf}/display/{datei}"):
        if (base / kandidat).is_file():
            return kandidat
    return gallery[0]


def related_card_html(x: dict, lang: str, base: Path) -> str:
    texte = HEADINGS[lang]
    sold = x.get("public_status") == "SOLD"
    if sold:
        price_html = '<span class="related-card__sold">SOLD</span>'
        price_line = ""
    else:
        price_html = ""
        price_line = (
            '<span class="related-card__price">' + fmt_price(float(x["price"])) + "</span>"
            if float(x.get("price") or 0) > 0
            else '<span class="related-card__price" data-price-on-request>' + html.escape(texte["request"]) + "</span>"
        )
    href = lang_home(lang) + "artikel/" + slug(x) + "/"
    return (
        '<a class="related-card" href="' + href + '">'
        '<div class="related-card__frame">'
        '<img src="/' + html.escape(card_image(x, base), quote=True) + '" alt="'
        + html.escape(loc_name(x, lang), quote=True)
        + '" loading="lazy" decoding="async" width="220" height="293" />'
        + price_html + "</div>"
        '<span class="related-card__brand">' + html.escape(x.get("brand") or texte["no_brand"]) + "</span>"
        '<span class="related-card__title">' + html.escape(loc_title(x, lang)) + "</span>"
        + price_line + "</a>"
    )


def related_sections_html(it: dict, plan: dict, lang: str, base: Path) -> str:
    marke, kategorie = plan.get(it["id"], ([], []))
    texte = HEADINGS[lang]
    parts: list[str] = []
    if marke:
        parts.append(
            '<div class="related"><h2 class="related__title" data-related-heading="brand">'
            + html.escape(texte["brand"].format(brand=(it.get("brand") or "").upper())) + "</h2>"
            '<div class="related__grid">' + "".join(related_card_html(x, lang, base) for x in marke) + "</div></div>"
        )
    if kategorie:
        parts.append(
            '<div class="related"><h2 class="related__title" data-related-heading="category">'
            + html.escape(texte["category"]) + "</h2>"
            '<div class="related__grid">' + "".join(related_card_html(x, lang, base) for x in kategorie) + "</div></div>"
        )
    return "".join(parts)

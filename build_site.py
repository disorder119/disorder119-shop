"""Einzige, massgebliche Build-Pipeline fuer den Disorder119-Shop.

Eine Datenquelle (data/items.json) speist alles Weitere:
  data/items.json -> index.html            (aus index_template.html)
  data/items.json -> artikel/{id}.html      (236 Produktseiten)
  data/items.json -> sitemap.xml

Vorher lief das umgekehrt (regen_articles.py las die Artikeldaten aus dem
bereits erzeugten index.html zurueck) - fragil, weil index.html damit
gleichzeitig Ausgabe UND Datenquelle war. Jetzt gibt es nur noch eine
Richtung.

Nutzung: python build_site.py [--thumbs]
  --thumbs erzeugt zusaetzlich kleine WebP-Vorschaubilder fuer die
  Thumbnail-Leiste (assets/img/{ordner}/thumbs/{n}.webp). Das ist ein
  separater, laengerer Bildverarbeitungsschritt (PIL) und muss nur einmal
  bzw. nach neuen Fotos erneut laufen, nicht bei jeder Textaenderung.
"""
import html
import json
import re
import sys
from pathlib import Path

BASE = Path(__file__).parent
SITE_URL = "https://disorder119.com/"
DATA_PATH = BASE / "data" / "items.json"

# Jede dieser Seiten ist inhaltlich die Startseite (gleiches HTML/JS/CSS-Bundle),
# oeffnet beim Laden aber automatisch das passende Panel anhand von
# location.pathname (siehe index_template.html). So bekommt jede "Einstellung"
# eine echte, eigenstaendige, teilbare URL statt eines reinen JS-Modals.
# Slug bleibt sprachuebergreifend gleich (nur das Sprachpraefix davor
# aendert sich, z.B. /agb/ vs. /en/agb/) - eine vollstaendig uebersetzte
# URL-Struktur (z.B. /en/terms/) waere zwar denkbar, haette aber jede
# interne Verlinkung/Routing-Stelle verdoppelt, ohne einen SEO-Vorteil
# gegenueber dem Sprachpraefix allein zu bringen.
SPECIAL_PAGES = {
    "cart": {"de": "Warenkorb", "en": "Cart", "fr": "Panier"},
    "impressum": {"de": "Impressum", "en": "Legal Notice", "fr": "Mentions légales"},
    "agb": {"de": "AGB", "en": "Terms & Conditions", "fr": "CGV"},
    "datenschutz": {"de": "Datenschutz", "en": "Privacy Policy", "fr": "Politique de confidentialité"},
    "ueber-uns": {"de": "Über Disorder119", "en": "About Disorder119", "fr": "À propos de Disorder119"},
    "faq": {"de": "FAQ", "en": "FAQ", "fr": "FAQ"},
}

# ---------------------------------------------------------------------------
# Mehrsprachigkeit: echte eigene URLs pro Sprache (/, /en/, /fr/) statt nur
# eines JS-Umschalters auf derselben Adresse - Voraussetzung dafuer, dass
# hreflang-Angaben ueberhaupt zulaessig sind (Google verlangt dafuer
# unterschiedliche URLs, nicht nur unterschiedlichen Client-Zustand).
# Deutsch bleibt an der Wurzel (kein "/de/"-Praefix) und ist zugleich der
# hreflang="x-default".
# ---------------------------------------------------------------------------
LANGS = ["de", "en", "fr"]


def lang_home(lang):
    return "/" if lang == "de" else "/" + lang + "/"


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
CONDITION_TR = {
    "Repariert": {"de": "Repariert", "en": "Repaired", "fr": "Réparé"},
    "Mit Defekt": {"de": "Mit Defekt", "en": "With defect", "fr": "Avec défaut"},
    "Gut": {"de": "Gut", "en": "Good", "fr": "Bon"},
    "Sehr gut": {"de": "Sehr gut", "en": "Very good", "fr": "Très bon"},
    "Zufriedenstellend": {"de": "Zufriedenstellend", "en": "Satisfactory", "fr": "Satisfaisant"},
}
SIZE_TR = {
    "Einheitsgröße": {"de": "Einheitsgröße", "en": "One size", "fr": "Taille unique"},
    "verstellbar": {"de": "verstellbar", "en": "adjustable", "fr": "réglable"},
    "Größenverstellbar": {"de": "verstellbar", "en": "adjustable", "fr": "réglable"},
    "Kindergröße L": {"de": "Kindergröße L", "en": "Kids' size L", "fr": "Taille enfant L"},
    "Sonstige": {"de": "Sonstige", "en": "Other", "fr": "Autre"},
}


def _tr(table, key, lang):
    entry = table.get(key)
    if not entry:
        return key or ""
    return entry.get(lang) or entry.get("de") or ""


def cat_tr(cat, lang):
    return _tr(CATEGORY_TR, cat, lang)


def cond_tr(cond, lang):
    return _tr(CONDITION_TR, cond, lang)


def size_tr(size, lang):
    return _tr(SIZE_TR, size, lang)


META_PHRASES = {
    "de": {
        "sold": "{name} – bereits verkauft, Teil des kuratierten Disorder119-Archivs für Designer- und Vintage-Mode.",
        "size_label": "Größe", "condition_label": "Zustand", "no_brand": "Ohne Marke",
        "price_on_request": "Preis auf Anfrage",
        "tail_suffix": ". Aus dem kuratierten Second-Hand-Archiv von Disorder119.",
        "auto_suffix": ". Aus dem kuratierten Archiv von Disorder119.",
        "home_title": "Disorder119 — Archiv-Katalog",
        "home_desc": "Kuratiertes Archiv für Designer-Mode aus zweiter Hand: Prada, Dior, Jean Paul Gaultier, Yves Saint Laurent u.v.m. Jedes Stück handverlesen, einzeln fotografiert und genau beschrieben.",
    },
    "en": {
        "sold": "{name} – already sold, part of the curated Disorder119 archive for designer and vintage fashion.",
        "size_label": "Size", "condition_label": "Condition", "no_brand": "No brand",
        "price_on_request": "Price on request",
        "tail_suffix": ". From the curated second-hand archive of Disorder119.",
        "auto_suffix": ". From the curated archive of Disorder119.",
        "home_title": "Disorder119 — Curated Archive",
        "home_desc": "Curated archive of pre-owned designer fashion: Prada, Dior, Jean Paul Gaultier, Yves Saint Laurent and more. Every piece hand-picked, individually photographed and precisely described.",
    },
    "fr": {
        "sold": "{name} – déjà vendu, fait partie de l'archive sélectionnée Disorder119 pour la mode de créateurs et vintage.",
        "size_label": "Taille", "condition_label": "État", "no_brand": "Sans marque",
        "price_on_request": "Prix sur demande",
        "tail_suffix": ". Issu de l'archive seconde main sélectionnée de Disorder119.",
        "auto_suffix": ". Issu de l'archive sélectionnée de Disorder119.",
        "home_title": "Disorder119 — Archive Sélectionnée",
        "home_desc": "Archive sélectionnée de mode de créateurs de seconde main : Prada, Dior, Jean Paul Gaultier, Yves Saint Laurent et bien plus. Chaque pièce choisie à la main, photographiée individuellement et décrite avec précision.",
    },
}

ITEMS = json.loads(DATA_PATH.read_text(encoding="utf-8"))

# Manche Marken im Rohbestand sind eigentlich Linien/Kollaborationen einer
# anderen Marke und sollen im Shop nicht als eigene Marke gezaehlt/gefiltert
# werden, sondern unter der Hauptmarke laufen. Der Titel behaelt den
# spezifischeren Namen (z.B. "Luna Rossa Sweatjacke"), nur das brand-Feld
# wird hier zentral normalisiert - wirkt dadurch ueberall (Kachel-Filter,
# Menue-Markenliste, "MEHR VON ..."-Vorschlaege, Markenzaehler im Header).
BRAND_ALIASES = {
    "Luna Rossa": "Prada",
    "Maison Margiela x H&M": "Maison Margiela",
    "Dior Homme": "Dior",
    "MM6 Maison Margiela": "Maison Margiela",
}
for _it in ITEMS:
    _alias = BRAND_ALIASES.get(_it.get("brand") or "")
    if _alias:
        _it["brand"] = _alias

BY_ID = {it["id"]: it for it in ITEMS}


def esc(s):
    return html.escape(s or "", quote=True)


def fmt_price_de(v):
    s = f"{v:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    return s + " €"


def display_name(it):
    brand = it.get("brand") or ""
    title = it.get("title") or ""
    if brand and title.lower().startswith(brand.lower()):
        return title
    return (brand + " " + title).strip()


def meta_description(it, lang):
    ph = META_PHRASES[lang]
    cat = cat_tr(it.get("category") or "", lang)
    cond = cond_tr(it.get("condition") or "", lang)
    name = display_name(it)
    if it.get("public_status") == "SOLD":
        return ph["sold"].format(name=name)
    tail = []
    if cat:
        tail.append(cat)
    if it.get("size"):
        tail.append(ph["size_label"] + " " + size_tr(it["size"], lang))
    if cond:
        tail.append(ph["condition_label"] + " " + cond)
    tail_str = ", ".join(tail)
    if tail_str:
        return name + " – " + tail_str + ph["tail_suffix"]
    return name + ph["tail_suffix"]


def auto_description(it, lang):
    ph = META_PHRASES[lang]
    facts = []
    if it.get("category"):
        facts.append(cat_tr(it["category"], lang))
    if it.get("size"):
        facts.append(ph["size_label"] + " " + size_tr(it["size"], lang))
    if it.get("condition"):
        facts.append(ph["condition_label"] + " " + cond_tr(it["condition"], lang))
    name = display_name(it)
    tail = (" – " + ", ".join(facts)) if facts else ""
    return name + tail + ph["auto_suffix"]


# ---------------------------------------------------------------------------
# Related items (Task 4 Fix): zwei GETRENNTE Gruppen statt einer vermischten
# Liste - "MORE FROM BRAND" darf ausschliesslich exakt dieselbe Marke zeigen.
# ---------------------------------------------------------------------------
def related_same_brand(it, n=4):
    others = [x for x in ITEMS if x["id"] != it["id"] and x.get("gallery") and x["gallery"][0]
              and x.get("brand") and x.get("brand") == it.get("brand")]
    others.sort(key=lambda x: (x.get("public_status") == "SOLD"))
    return others[:n]


def related_same_category(it, exclude_ids, n=4):
    others = [x for x in ITEMS if x["id"] != it["id"] and x["id"] not in exclude_ids
              and x.get("gallery") and x["gallery"][0]
              and x.get("category") == it.get("category")]
    others.sort(key=lambda x: (x.get("public_status") == "SOLD"))
    return others[:n]


def related_card_html(x, lang):
    ph = META_PHRASES[lang]
    sold = x.get("public_status") == "SOLD"
    if sold:
        price_html = '<span class="related-card__sold">SOLD</span>'
        price_line = ""
    else:
        price_html = ""
        price_line = (
            '<span class="related-card__price">' + fmt_price_de(x["price"]) + "</span>"
            if x.get("price", 0) > 0
            else '<span class="related-card__price" data-price-on-request>' + esc(ph["price_on_request"]) + '</span>'
        )
    href = lang_home(lang) + "artikel/" + str(x["id"]) + "/"
    return (
        '<a class="related-card" href="' + href + '">'
        '<div class="related-card__frame">'
        '<img src="/' + esc(x["gallery"][0]) + '" alt="" loading="lazy" />' +
        (price_html if sold else "") +
        "</div>"
        '<span class="related-card__brand">' + esc(x.get("brand") or ph["no_brand"]) + "</span>"
        '<span class="related-card__title">' + esc(x["title"]) + "</span>" +
        price_line +
        "</a>"
    )


def related_sections_html(it, lang):
    brand_items = related_same_brand(it)
    exclude = {it["id"]} | {b["id"] for b in brand_items}
    cat_items = related_same_category(it, exclude)
    parts = []
    if brand_items:
        parts.append(
            '<div class="related"><h2 class="related__title" data-related-heading="brand">'
            + esc("MEHR VON " + (it.get("brand") or "").upper()) + "</h2>"
            '<div class="related__grid">' + "".join(related_card_html(x, lang) for x in brand_items) + "</div></div>"
        )
    if cat_items:
        parts.append(
            '<div class="related"><h2 class="related__title" data-related-heading="category">ÄHNLICHE ARCHIVSTÜCKE</h2>'
            '<div class="related__grid">' + "".join(related_card_html(x, lang) for x in cat_items) + "</div></div>"
        )
    return "".join(parts)


def facts_html(it):
    facts = []
    if it.get("category"):
        facts.append(('factCategory', "Kategorie", "factCategoryValue", cat_tr(it["category"], "de")))
    if it.get("size"):
        facts.append(('factSize', "Größe", "factSizeValue", it["size"]))
    if it.get("color"):
        facts.append(('factColor', "Farbe", None, it["color"]))
    if it.get("condition"):
        facts.append(('factCondition', "Zustand", "factConditionValue", it["condition"]))
    out = []
    for i18n_key, label, value_id, value in facts:
        value_attr = f' id="{value_id}"' if value_id else ""
        out.append(
            '<div><div class="fact__label" data-i18n="' + i18n_key + '">' + esc(label) + "</div>"
            '<div class="fact__value"' + value_attr + ">" + esc(value) + "</div></div>"
        )
    art_no = it.get("article") or str(it["id"])
    out.append(
        '<div><div class="fact__label" data-i18n="factArticleNo">Artikelnummer</div>'
        '<div class="fact__value">' + esc(art_no) + "</div></div>"
    )
    return "".join(out)


def price_block_html(it):
    sold = it.get("public_status") == "SOLD"
    if sold:
        return '<div class="info__badge info__badge--sold">SOLD — DISORDER119 ARCHIVE</div>'
    if it.get("price_estimated"):
        return (
            '<div class="info__price">ca. ' + fmt_price_de(it["price"]) + "</div>"
            '<div class="info__badge info__badge--estimate">Preis wird geprüft</div>'
        )
    if it.get("price", 0) > 0:
        return '<div class="info__price">' + fmt_price_de(it["price"]) + "</div>"
    return '<div class="info__price">Preis auf Anfrage</div>'


def cta_html(it, shop_config):
    sold = it.get("public_status") == "SOLD"
    if sold:
        return '<p class="info__note" id="soldNote">Dieses Stück ist bereits verkauft und bleibt als Teil des Disorder119-Archivs sichtbar.</p>'
    has_price = it.get("price", 0) > 0
    paypal_ready = bool(shop_config.get("paypalClientId")) and bool(shop_config.get("shopWorkerUrl"))
    parts = ['<div class="info__cta">']
    if has_price:
        parts.append('<button type="button" class="btn" id="addToCartBtn" data-i18n="addToCart">In den Warenkorb</button>')
    if has_price and paypal_ready:
        # Bleibt leer/unsichtbar, bis paypal_buy_button() in article.js den
        # echten PayPal-Button hineinrendert (siehe shop-worker/README.md).
        parts.append('<div id="paypalButtons" data-item-id="' + str(it["id"]) + '" data-price="' + f'{it["price"]:.2f}' + '"></div>')
    parts.append('<a class="btn btn--outline" id="inquireWhatsapp" target="_blank" rel="noopener" data-i18n="inquireWhatsapp">Anfrage per WhatsApp</a>')
    parts.append('<a class="btn btn--outline" id="inquireEmail" data-i18n="inquireEmail">Anfrage per E-Mail</a>')
    parts.append("</div>")
    if not shop_config["whatsappNumber"] and not shop_config["email"]:
        parts.append('<p class="info__config-warning" data-i18n="configWarning">Shop-Kontakt noch nicht eingerichtet: WhatsApp-Nummer oder E-Mail-Adresse fehlen in SHOP_CONFIG (index.html).</p>')
    return "".join(parts)


def json_ld(it, lang):
    sold = it.get("public_status") == "SOLD"
    url = SITE_URL.rstrip("/") + lang_home(lang) + "artikel/" + str(it["id"]) + "/"
    desc_field = {"de": it.get("desc_de") or it.get("desc"), "en": it.get("desc_en"), "fr": it.get("desc_fr")}[lang]
    data = {
        "@context": "https://schema.org",
        "@type": "Product",
        "name": it["title"],
        "url": url,
        "image": [SITE_URL + g for g in it.get("gallery") or []],
        "description": (desc_field or meta_description(it, lang))[:500],
        "sku": it.get("article") or str(it["id"]),
        "brand": {"@type": "Brand", "name": it.get("brand") or "Disorder119"},
    }
    if not sold and it.get("price", 0) > 0:
        data["offers"] = {
            "@type": "Offer", "url": data["url"], "priceCurrency": "EUR",
            "price": f'{it["price"]:.2f}',
            "availability": "https://schema.org/InStock",
            "itemCondition": "https://schema.org/UsedCondition",
        }
    elif sold:
        # Bewusst OHNE price/priceCurrency: der ehemalige Verkaufspreis eines
        # archivierten Stuecks darf auch in strukturierten Daten nicht mehr
        # oeffentlich stehen (Task 2).
        data["offers"] = {
            "@type": "Offer", "url": data["url"],
            "availability": "https://schema.org/OutOfStock",
            "itemCondition": "https://schema.org/UsedCondition",
        }
    return json.dumps(data, ensure_ascii=False)


def thumb_path(p):
    parts = p.rsplit("/", 1)
    if len(parts) != 2:
        return p
    return parts[0] + "/thumbs/" + parts[1]


def build_page(it, shop_config, lang):
    name = display_name(it)
    title_tag = name + " | Disorder119"
    desc = meta_description(it, lang)
    gallery = it.get("gallery") or []
    hero = gallery[0] if gallery else "assets/favicon.png"
    home = lang_home(lang)
    canonical = SITE_URL.rstrip("/") + home + "artikel/" + str(it["id"]) + "/"
    hreflang_links = "\n".join(
        '<link rel="alternate" hreflang="' + l + '" href="'
        + SITE_URL.rstrip("/") + lang_home(l) + "artikel/" + str(it["id"]) + '/">'
        for l in LANGS
    ) + '\n<link rel="alternate" hreflang="x-default" href="' + SITE_URL.rstrip("/") + lang_home("de") + "artikel/" + str(it["id"]) + '/">'
    sold = it.get("public_status") == "SOLD"
    paypal_sdk_tag = ""
    if shop_config.get("paypalClientId") and shop_config.get("shopWorkerUrl") and not sold and it.get("price", 0) > 0:
        paypal_sdk_tag = (
            '<script src="https://www.paypal.com/sdk/js?client-id='
            + esc(shop_config["paypalClientId"]) + '&currency=EUR"></script>\n'
        )

    # ARTICLE_ITEM enthaelt bei SOLD-Artikeln bewusst KEINEN Preis (Task 2) -
    # article.js bekommt stattdessen nur sold:true und zeigt ausschliesslich
    # die Archiv-Kennzeichnung.
    article_data = {
        "id": it["id"],
        "article": it.get("article"),
        "title": it["title"],
        "brand": it.get("brand"),
        "size": it.get("size"),
        "color": it.get("color"),
        "condition": it.get("condition"),
        "category": it.get("category"),
        "desc": it.get("desc") or "",
        "desc_de": it.get("desc_de") or it.get("desc") or "",
        "desc_en": it.get("desc_en") or "",
        "desc_fr": it.get("desc_fr") or "",
        "gallery": gallery,
        "thumbs": [thumb_path(g) for g in gallery],
        "sold": sold,
        "priceEstimated": bool(it.get("price_estimated")) and not sold,
        "price": 0 if sold else it.get("price", 0),
    }

    return f"""<!DOCTYPE html>
<html lang="{lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{esc(title_tag)}</title>
<meta name="description" content="{esc(desc)}">
{'<meta name="robots" content="noindex,nofollow">' if it.get("public_status") == "DRAFT" else ""}
<link rel="canonical" href="{canonical}">
{hreflang_links}
<link rel="icon" type="image/png" href="/assets/favicon.png">
<link rel="stylesheet" href="/assets/article.css">
<meta property="og:type" content="product">
<meta property="og:site_name" content="Disorder119">
<meta property="og:title" content="{esc(title_tag)}">
<meta property="og:description" content="{esc(desc)}">
<meta property="og:url" content="{canonical}">
<meta property="og:image" content="{SITE_URL}{esc(hero)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{esc(title_tag)}">
<meta name="twitter:description" content="{esc(desc)}">
<meta name="twitter:image" content="{SITE_URL}{esc(hero)}">
<script type="application/ld+json">{json_ld(it, lang)}</script>
</head>
<body>
<div class="page-head">
  <a class="page-head__brand" href="{home}">DISORDER119</a>
  <div class="page-head__right">
    <div class="lang-switch" id="langSwitch" role="group" aria-label="Sprache wählen">
      <a class="lang-switch__btn" data-lang="de" href="/artikel/{it['id']}/">DE</a>
      <a class="lang-switch__btn" data-lang="en" href="/en/artikel/{it['id']}/">EN</a>
      <a class="lang-switch__btn" data-lang="fr" href="/fr/artikel/{it['id']}/">FR</a>
    </div>
    <a class="page-head__back" href="{home}" data-i18n="backToArchive">← Zum Archiv</a>
    <a class="page-head__cart" id="pageHeadCart" href="{home}cart/"><span data-i18n="cartLink">Warenkorb</span><span class="page-head__cart-count" id="pageHeadCartCount"></span></a>
  </div>
</div>
<div class="product">
  <div class="gallery">
    <div class="gallery__stage">
      {'<span class="gallery__badge">SOLD</span>' if sold else ""}
      <img id="galleryMain" src="/{esc(hero)}" alt="{esc(name)}">
      <button type="button" class="gallery__nav gallery__nav--prev" id="galleryPrev" data-i18n-aria="prevPhotoAria" aria-label="Vorheriges Foto">‹</button>
      <button type="button" class="gallery__nav gallery__nav--next" id="galleryNext" data-i18n-aria="nextPhotoAria" aria-label="Nächstes Foto">›</button>
      <span class="gallery__counter" id="galleryCounter">1 / {max(len(gallery), 1)}</span>
    </div>
    <div class="gallery__thumbs" id="galleryThumbs"></div>
  </div>
  <div class="info">
    <a class="info__brand" href="{home}?brand={esc(it.get('brand') or '')}">{esc(it.get("brand") or "Ohne Marke")}</a>
    <h1>{esc(it["title"])}</h1>
    <div id="priceBlock">{price_block_html(it)}</div>
    <div class="info__facts">{facts_html(it)}</div>
    <p class="info__desc" id="itemDesc">{esc((it.get("desc_de") or it.get("desc") or "").strip() or auto_description(it, "de"))}</p>
    {cta_html(it, shop_config)}
  </div>
</div>
{related_sections_html(it, lang)}
<div class="page-foot">
  <p data-i18n="footerNote">Disorder119 · Kuratiertes Archiv für Designer-, Vintage- und Contemporary-Mode. Jedes Stück wird einzeln ausgewählt, fotografiert und beschrieben.</p>
  <p><a href="{home}" data-i18n="footerFullArchive">Zum vollständigen Archiv</a></p>
</div>
<div class="lightbox" id="lightbox">
  <button type="button" class="lightbox__close" id="lightboxClose" data-i18n-aria="closeAria" aria-label="Schließen">✕</button>
  <img id="lightboxImg" src="" alt="">
</div>
{paypal_sdk_tag}<script>
  window.ARTICLE_ITEM = {json.dumps(article_data, ensure_ascii=False)};
  window.ARTICLE_SHOP_CONFIG = {json.dumps(shop_config, ensure_ascii=False)};
  window.ARTICLE_LANG = "{lang}";
</script>
<script src="/assets/article.js"></script>
</body>
</html>
"""


def get_shop_config():
    # SHOP_CONFIG lebt (bewusst, s. Chat-Historie) weiterhin direkt in
    # index_template.html, nicht in data/items.json - es ist Shop-Konfiguration,
    # kein Artikeldatum. Wird von dort ausgelesen, damit es nur EINE Stelle
    # zum Pflegen gibt.
    tmpl = (BASE / "index_template.html").read_text(encoding="utf-8")
    wa = re.search(r'whatsappNumber:\s*"([^"]*)"', tmpl)
    em = re.search(r'\bemail:\s*"([^"]*)"', tmpl)
    pp = re.search(r'paypalClientId:\s*"([^"]*)"', tmpl)
    wk = re.search(r'shopWorkerUrl:\s*"([^"]*)"', tmpl)
    return {
        "whatsappNumber": wa.group(1) if wa else "",
        "email": em.group(1) if em else "",
        "paypalClientId": pp.group(1) if pp else "",
        "shopWorkerUrl": wk.group(1) if wk else "",
    }


def item_list_jsonld(public_items, lang):
    home = SITE_URL.rstrip("/") + lang_home(lang)
    entries = [
        {"@type": "ListItem", "position": i + 1, "url": home + "artikel/" + str(it["id"]) + "/"}
        for i, it in enumerate(public_items)
    ]
    data = {"@context": "https://schema.org", "@type": "ItemList", "name": "Disorder119 — Archiv-Katalog", "itemListElement": entries}
    return json.dumps(data, ensure_ascii=False)


def hreflang_block(urls_by_lang):
    links = [f'<link rel="alternate" hreflang="{l}" href="{urls_by_lang[l]}">' for l in LANGS]
    links.append(f'<link rel="alternate" hreflang="x-default" href="{urls_by_lang["de"]}">')
    return "\n".join(links)


def render_bundle_page(lang, path_segment, title_tag, desc_text):
    # Einzige Quelle fuer das Homepage-Bundle: wird sowohl fuer index.html
    # (path_segment="") als auch fuer /cart/, /impressum/ usw. verwendet -
    # inhaltlich exakt dieselbe Seite, sie oeffnet beim Laden nur automatisch
    # ein anderes Panel (anhand von location.pathname, siehe index_template.html).
    # path_segment ist relativ zur jeweiligen Sprach-Wurzel (z.B. "cart/").
    tmpl = (BASE / "index_template.html").read_text(encoding="utf-8")
    public_items = [it for it in ITEMS if it.get("public_status") != "DRAFT"]
    urls_by_lang = {l: SITE_URL.rstrip("/") + lang_home(l) + path_segment for l in LANGS}
    canonical = urls_by_lang[lang]
    out = tmpl
    out = out.replace("__ITEMLIST_JSONLD__", item_list_jsonld(public_items, lang))
    out = out.replace("__HTML_LANG__", lang)
    out = out.replace("__CANONICAL_URL__", canonical)
    out = out.replace("__HREFLANG_TAGS__", hreflang_block(urls_by_lang))
    out = out.replace("__META_TITLE__", esc(title_tag))
    out = out.replace("__META_DESC__", esc(desc_text))
    return out


def build_index():
    for lang in LANGS:
        ph = META_PHRASES[lang]
        out = render_bundle_page(lang, "", ph["home_title"], ph["home_desc"])
        path = BASE / "index.html" if lang == "de" else BASE / lang / "index.html"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(out, encoding="utf-8")
    print(f"index.html + {len(LANGS) - 1} Sprachvarianten geschrieben.")


def build_special_pages():
    # /cart/, /impressum/, /agb/, /datenschutz/, /ueber-uns/, /faq/ - jede
    # davon bekommt eine echte, eigenstaendige, teilbare URL statt eines
    # reinen JS-Modals (siehe openCart/openLegal/openInfo in app.js), und
    # zwar in allen drei Sprachen (/cart/, /en/cart/, /fr/cart/ usw.).
    n = 0
    for lang in LANGS:
        ph = META_PHRASES[lang]
        for slug, labels in SPECIAL_PAGES.items():
            label = labels[lang]
            title_tag = ("Disorder119 — " + label) if slug != "cart" else (label + " | Disorder119")
            out = render_bundle_page(lang, slug + "/", title_tag, ph["home_desc"])
            out_dir = (BASE / slug) if lang == "de" else (BASE / lang / slug)
            out_dir.mkdir(parents=True, exist_ok=True)
            (out_dir / "index.html").write_text(out, encoding="utf-8")
            n += 1
    print(f"{n} Sonderseiten geschrieben ({len(SPECIAL_PAGES)} x {len(LANGS)} Sprachen).")


def article_dir(lang, item_id):
    base = BASE if lang == "de" else BASE / lang
    return base / "artikel" / str(item_id)


def build_articles():
    shop_config = get_shop_config()
    count = 0
    for it in ITEMS:
        for lang in LANGS:
            page = build_page(it, shop_config, lang)
            item_dir = article_dir(lang, it["id"])
            item_dir.mkdir(parents=True, exist_ok=True)
            (item_dir / "index.html").write_text(page, encoding="utf-8")
            count += 1
    print(f"{count} Produktseiten geschrieben ({len(ITEMS)} Artikel x {len(LANGS)} Sprachen).")


def build_sitemap():
    # DRAFT-Artikel (unklarer interner Zwischenstatus) werden nicht indexiert -
    # ihre Seite existiert zwar (falls direkt aufgerufen), ist aber nirgends
    # verlinkt und soll auch nicht von Suchmaschinen als oeffentliches Angebot
    # gewertet werden. Der Warenkorb (/cart/) hat keinen eigenen, indexierbaren
    # Inhalt und wird bewusst nicht aufgenommen. Jede URL bekommt zusaetzlich
    # xhtml:link-Alternates fuer die jeweils anderen Sprachversionen - dasselbe
    # Signal wie die hreflang-<link>-Tags im <head>, nur fuer Crawler, die
    # direkt die Sitemap statt jede einzelne Seite auswerten.
    public_items = [it for it in ITEMS if it.get("public_status") != "DRAFT"]
    path_segments = (
        [""]
        + ["artikel/" + str(it["id"]) + "/" for it in public_items]
        + [slug + "/" for slug in SPECIAL_PAGES if slug != "cart"]
    )

    def url_entry(lang, segment):
        urls_by_lang = {l: SITE_URL.rstrip("/") + lang_home(l) + segment for l in LANGS}
        alt = "\n".join(
            f'    <xhtml:link rel="alternate" hreflang="{l}" href="{urls_by_lang[l]}"/>' for l in LANGS
        )
        alt += f'\n    <xhtml:link rel="alternate" hreflang="x-default" href="{urls_by_lang["de"]}"/>'
        return f"  <url>\n    <loc>{urls_by_lang[lang]}</loc>\n{alt}\n  </url>"

    entries = [url_entry(lang, seg) for seg in path_segments for lang in LANGS]
    body = "\n".join(entries)
    xml = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" '
        'xmlns:xhtml="http://www.w3.org/1999/xhtml">\n'
        f"{body}\n</urlset>\n"
    )
    (BASE / "sitemap.xml").write_text(xml, encoding="utf-8")
    print(f"sitemap.xml geschrieben ({len(entries)} URLs, {len(path_segments)} Seiten x {len(LANGS)} Sprachen).")


def build_thumbs():
    from PIL import Image
    THUMB_SIZE = (220, 293)
    count = 0
    for it in ITEMS:
        for g in it.get("gallery") or []:
            src = BASE / g
            if not src.is_file():
                continue
            dest = BASE / thumb_path(g)
            dest.parent.mkdir(parents=True, exist_ok=True)
            if dest.is_file():
                continue
            with Image.open(src) as im:
                im = im.convert("RGBA")
                im.thumbnail(THUMB_SIZE, Image.LANCZOS)
                im.save(dest, format="WEBP", quality=78, method=4)
            count += 1
    print(f"{count} Thumbnails erzeugt.")


def clean_old_flat_article_files():
    # Umstellung von artikel/{id}.html auf artikel/{id}/index.html (echte,
    # erweiterungslose URLs) - alte flache Dateien vom vorherigen Schema
    # muessen weg, sonst blieben sie als toter, nie mehr aktualisierter
    # Datenstand im Repo liegen.
    out_dir = BASE / "artikel"
    if not out_dir.is_dir():
        return
    removed = 0
    for f in out_dir.glob("*.html"):
        f.unlink()
        removed += 1
    if removed:
        print(f"{removed} alte artikel/*.html (Vorgaenger-Schema) entfernt.")


def main():
    clean_old_flat_article_files()
    build_index()
    build_special_pages()
    build_articles()
    build_sitemap()
    if "--thumbs" in sys.argv:
        build_thumbs()


if __name__ == "__main__":
    main()

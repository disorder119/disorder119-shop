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
SPECIAL_PAGES = {
    "cart": "Warenkorb",
    "impressum": "Impressum",
    "agb": "AGB",
    "datenschutz": "Datenschutz",
    "ueber-uns": "Über Disorder119",
    "faq": "FAQ",
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


CATEGORY_DE = {
    "Jackets": "Jacken", "Coats": "Mäntel", "Tops": "Tops", "Shirts": "Hemden/Shirts",
    "Knitwear": "Strickwaren", "Pants": "Hosen", "Skirts": "Röcke", "Dresses": "Kleider",
    "Shoes": "Schuhe", "Accessories": "Accessoires", "Objects": "Objekte",
}


def cat_de(cat):
    return CATEGORY_DE.get(cat, cat)


def meta_description(it):
    cat = cat_de(it.get("category") or "")
    cond = it.get("condition") or ""
    name = display_name(it)
    if it.get("public_status") == "SOLD":
        return (name + " – bereits verkauft, Teil des kuratierten Disorder119-Archivs "
                "fuer Designer- und Vintage-Mode.")
    tail = []
    if cat:
        tail.append(cat)
    if it.get("size"):
        tail.append("Größe " + it["size"])
    if cond:
        tail.append("Zustand " + cond)
    tail_str = ", ".join(tail)
    if tail_str:
        return name + " – " + tail_str + ". Aus dem kuratierten Second-Hand-Archiv von Disorder119."
    return name + ". Aus dem kuratierten Second-Hand-Archiv von Disorder119."


def auto_description(it):
    facts = []
    if it.get("category"):
        facts.append(cat_de(it["category"]))
    if it.get("size"):
        facts.append("Größe " + it["size"])
    if it.get("condition"):
        facts.append("Zustand " + it["condition"])
    name = display_name(it)
    tail = (" – " + ", ".join(facts)) if facts else ""
    return name + tail + ". Aus dem kuratierten Archiv von Disorder119."


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


def related_card_html(x):
    sold = x.get("public_status") == "SOLD"
    if sold:
        price_html = '<span class="related-card__sold">SOLD</span>'
        price_line = ""
    else:
        price_html = ""
        price_line = (
            '<span class="related-card__price">' + fmt_price_de(x["price"]) + "</span>"
            if x.get("price", 0) > 0
            else '<span class="related-card__price" data-price-on-request>Preis auf Anfrage</span>'
        )
    return (
        '<a class="related-card" href="../' + str(x["id"]) + '/">'
        '<div class="related-card__frame">'
        '<img src="../../' + esc(x["gallery"][0]) + '" alt="" loading="lazy" />' +
        (price_html if sold else "") +
        "</div>"
        '<span class="related-card__brand">' + esc(x.get("brand") or "Ohne Marke") + "</span>"
        '<span class="related-card__title">' + esc(x["title"]) + "</span>" +
        price_line +
        "</a>"
    )


def related_sections_html(it):
    brand_items = related_same_brand(it)
    exclude = {it["id"]} | {b["id"] for b in brand_items}
    cat_items = related_same_category(it, exclude)
    parts = []
    if brand_items:
        parts.append(
            '<div class="related"><h2 class="related__title" data-related-heading="brand">'
            + esc("MEHR VON " + (it.get("brand") or "").upper()) + "</h2>"
            '<div class="related__grid">' + "".join(related_card_html(x) for x in brand_items) + "</div></div>"
        )
    if cat_items:
        parts.append(
            '<div class="related"><h2 class="related__title" data-related-heading="category">ÄHNLICHE ARCHIVSTÜCKE</h2>'
            '<div class="related__grid">' + "".join(related_card_html(x) for x in cat_items) + "</div></div>"
        )
    return "".join(parts)


def facts_html(it):
    facts = []
    if it.get("category"):
        facts.append(('factCategory', "Kategorie", "factCategoryValue", cat_de(it["category"])))
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


def json_ld(it):
    sold = it.get("public_status") == "SOLD"
    data = {
        "@context": "https://schema.org",
        "@type": "Product",
        "name": it["title"],
        "url": SITE_URL + "artikel/" + str(it["id"]) + "/",
        "image": [SITE_URL + g for g in it.get("gallery") or []],
        "description": (it.get("desc_de") or it.get("desc") or meta_description(it))[:500],
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


def build_page(it, shop_config):
    name = display_name(it)
    title_tag = name + " | Disorder119"
    desc = meta_description(it)
    gallery = it.get("gallery") or []
    hero = gallery[0] if gallery else "assets/favicon.png"
    canonical = SITE_URL + "artikel/" + str(it["id"]) + "/"
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
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{esc(title_tag)}</title>
<meta name="description" content="{esc(desc)}">
{'<meta name="robots" content="noindex,nofollow">' if it.get("public_status") == "DRAFT" else ""}
<link rel="canonical" href="{canonical}">
<link rel="icon" type="image/png" href="../../assets/favicon.png">
<link rel="stylesheet" href="../../assets/article.css">
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
<script type="application/ld+json">{json_ld(it)}</script>
</head>
<body>
<div class="page-head">
  <a class="page-head__brand" href="../../">DISORDER119</a>
  <div class="page-head__right">
    <div class="lang-switch" id="langSwitch" role="group" aria-label="Sprache wählen">
      <button type="button" class="lang-switch__btn" data-lang="de">DE</button>
      <button type="button" class="lang-switch__btn" data-lang="en">EN</button>
      <button type="button" class="lang-switch__btn" data-lang="fr">FR</button>
    </div>
    <a class="page-head__back" href="../../" data-i18n="backToArchive">← Zum Archiv</a>
    <a class="page-head__cart" id="pageHeadCart" href="/cart/"><span data-i18n="cartLink">Warenkorb</span><span class="page-head__cart-count" id="pageHeadCartCount"></span></a>
  </div>
</div>
<div class="product">
  <div class="gallery">
    <div class="gallery__stage">
      {'<span class="gallery__badge">SOLD</span>' if sold else ""}
      <img id="galleryMain" src="../../{esc(hero)}" alt="{esc(name)}">
      <button type="button" class="gallery__nav gallery__nav--prev" id="galleryPrev" data-i18n-aria="prevPhotoAria" aria-label="Vorheriges Foto">‹</button>
      <button type="button" class="gallery__nav gallery__nav--next" id="galleryNext" data-i18n-aria="nextPhotoAria" aria-label="Nächstes Foto">›</button>
      <span class="gallery__counter" id="galleryCounter">1 / {max(len(gallery), 1)}</span>
    </div>
    <div class="gallery__thumbs" id="galleryThumbs"></div>
  </div>
  <div class="info">
    <a class="info__brand" href="../../?brand={esc(it.get('brand') or '')}">{esc(it.get("brand") or "Ohne Marke")}</a>
    <h1>{esc(it["title"])}</h1>
    <div id="priceBlock">{price_block_html(it)}</div>
    <div class="info__facts">{facts_html(it)}</div>
    <p class="info__desc" id="itemDesc">{esc((it.get("desc_de") or it.get("desc") or "").strip() or auto_description(it))}</p>
    {cta_html(it, shop_config)}
  </div>
</div>
{related_sections_html(it)}
<div class="page-foot">
  <p data-i18n="footerNote">Disorder119 · Kuratiertes Archiv für Designer-, Vintage- und Contemporary-Mode. Jedes Stück wird einzeln ausgewählt, fotografiert und beschrieben.</p>
  <p><a href="../../" data-i18n="footerFullArchive">Zum vollständigen Archiv</a></p>
</div>
<div class="lightbox" id="lightbox">
  <button type="button" class="lightbox__close" id="lightboxClose" data-i18n-aria="closeAria" aria-label="Schließen">✕</button>
  <img id="lightboxImg" src="" alt="">
</div>
{paypal_sdk_tag}<script>
  window.ARTICLE_ITEM = {json.dumps(article_data, ensure_ascii=False)};
  window.ARTICLE_SHOP_CONFIG = {json.dumps(shop_config, ensure_ascii=False)};
</script>
<script src="../../assets/article.js"></script>
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


def item_list_jsonld(public_items):
    entries = [
        {"@type": "ListItem", "position": i + 1, "url": SITE_URL + "artikel/" + str(it["id"]) + "/"}
        for i, it in enumerate(public_items)
    ]
    data = {"@context": "https://schema.org", "@type": "ItemList", "name": "Disorder119 — Archiv-Katalog", "itemListElement": entries}
    return json.dumps(data, ensure_ascii=False)


def render_index_html():
    # Einzige Quelle fuer das Homepage-Bundle: wird sowohl fuer index.html
    # als auch (siehe build_special_pages) fuer /cart/, /impressum/ usw.
    # verwendet - das sind inhaltlich exakt dieselbe Seite, sie oeffnen beim
    # Laden nur automatisch ein anderes Panel (anhand von location.pathname,
    # siehe index_template.html).
    tmpl = (BASE / "index_template.html").read_text(encoding="utf-8")
    public_items = [it for it in ITEMS if it.get("public_status") != "DRAFT"]
    out = tmpl.replace("__ITEMLIST_JSONLD__", item_list_jsonld(public_items))
    return out


def build_index():
    out = render_index_html()
    (BASE / "index.html").write_text(out, encoding="utf-8")
    print(f"index.html geschrieben ({len(out)} Zeichen)")


def build_special_pages():
    # /cart/, /impressum/, /agb/, /datenschutz/, /ueber-uns/, /faq/ -
    # jede davon bekommt eine echte, eigenstaendige, teilbare URL statt eines
    # reinen JS-Modals (siehe openCart/openLegal/openInfo in
    # index_template.html). Inhaltlich identisches Bundle wie index.html,
    # nur Title/Canonical/OG-Tags zeigen auf die jeweilige Unterseite, damit
    # Linkvorschauen (WhatsApp etc.) korrekt sind.
    base_out = render_index_html()
    for slug, label in SPECIAL_PAGES.items():
        page_url = SITE_URL + slug + "/"
        title_tag = ("Disorder119 — " + label) if slug != "cart" else "Warenkorb | Disorder119"
        out = base_out
        out = re.sub(r"<title>.*?</title>", "<title>" + esc(title_tag) + "</title>", out, count=1)
        out = out.replace('href="https://disorder119.com/"', 'href="' + page_url + '"')
        out = out.replace('content="https://disorder119.com/"', 'content="' + page_url + '"')
        out = re.sub(
            r'(<meta property="og:title" content=")[^"]*(")',
            r"\g<1>" + esc(title_tag) + r"\g<2>",
            out, count=1,
        )
        out_dir = BASE / slug
        out_dir.mkdir(exist_ok=True)
        (out_dir / "index.html").write_text(out, encoding="utf-8")
    print(f"{len(SPECIAL_PAGES)} Sonderseiten geschrieben ({', '.join(SPECIAL_PAGES)}).")


def build_articles():
    shop_config = get_shop_config()
    out_dir = BASE / "artikel"
    out_dir.mkdir(exist_ok=True)
    for it in ITEMS:
        page = build_page(it, shop_config)
        item_dir = out_dir / str(it["id"])
        item_dir.mkdir(exist_ok=True)
        (item_dir / "index.html").write_text(page, encoding="utf-8")
    print(f"{len(ITEMS)} Produktseiten geschrieben.")


def build_sitemap():
    # DRAFT-Artikel (unklarer interner Zwischenstatus) werden nicht indexiert -
    # ihre Seite existiert zwar (falls direkt aufgerufen), ist aber nirgends
    # verlinkt und soll auch nicht von Suchmaschinen als oeffentliches Angebot
    # gewertet werden. Der Warenkorb (/cart/) hat keinen eigenen, indexierbaren
    # Inhalt und wird bewusst nicht aufgenommen.
    public_items = [it for it in ITEMS if it.get("public_status") != "DRAFT"]
    urls = (
        [SITE_URL]
        + [SITE_URL + "artikel/" + str(it["id"]) + "/" for it in public_items]
        + [SITE_URL + slug + "/" for slug in SPECIAL_PAGES if slug != "cart"]
    )
    body = "\n".join(f"  <url><loc>{u}</loc></url>" for u in urls)
    xml = f'<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n{body}\n</urlset>\n'
    (BASE / "sitemap.xml").write_text(xml, encoding="utf-8")
    print(f"sitemap.xml geschrieben ({len(urls)} URLs).")


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

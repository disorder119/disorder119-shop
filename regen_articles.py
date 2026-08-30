"""Regeneriert alle artikel/*.html Produktseiten aus den Item-Daten, die
bereits in index.html eingebettet sind (kein Zugriff auf die urspruengliche
DB-gestuetzte Build-Pipeline mehr noetig - die ist in dieser Session durch
eine Temp-Bereinigung verloren gegangen, siehe Chat).

Ersetzt die bisherigen sehr schlanken Produktseiten (ein Bild, keine
Galerie, alter Verkaufspreis blieb bei verkauften Artikeln sichtbar) durch:
- vollstaendige Bild-Galerie (alle Fotos, Thumbnails, Pfeile, Zoom/Lightbox)
- korrekten SOLD-Zustand (kein Preis mehr sichtbar/strukturiert bei
  verkauften Artikeln, stattdessen eine ARCHIVE/SOLD-Kennzeichnung)
- direkte "In den Warenkorb" / WhatsApp / E-Mail Anfrage ohne Umweg
  ueber die Startseite (teilt sich das Warenkorb-localStorage-Format
  mit index.html)
- verlinkte Marke (fuehrt gefiltert zurueck ins Archiv)
- "Aehnliche Artikel" (erst gleiche Marke, dann gleiche Kategorie)
- bessere Meta-Beschreibung statt "X von X."
"""
import html
import json
import re
from pathlib import Path

BASE = Path(__file__).parent
SITE_URL = "https://disorder119.github.io/disorder119-shop/"

index_html = (BASE / "index.html").read_text(encoding="utf-8")
m = re.search(r'<script id="itemsData" type="application/json">(.*?)</script>', index_html, re.S)
ITEMS = json.loads(m.group(1))
BY_ID = {it["id"]: it for it in ITEMS}

cfg_m = re.search(r'whatsappNumber:\s*"([^"]*)"', index_html)
email_m = re.search(r'\bemail:\s*"([^"]*)"', index_html)
SHOP_CONFIG = {
    "whatsappNumber": cfg_m.group(1) if cfg_m else "",
    "email": email_m.group(1) if email_m else "",
}


def esc(s):
    return html.escape(s or "", quote=True)


def fmt_price_de(v):
    s = f"{v:,.2f}"
    s = s.replace(",", "X").replace(".", ",").replace("X", ".")
    return s + " €"


def display_name(it):
    brand = it.get("brand") or ""
    title = it.get("title") or ""
    if brand and title.lower().startswith(brand.lower()):
        return title
    return (brand + " " + title).strip()


def meta_description(it):
    brand = it.get("brand") or ""
    cat = it.get("category") or ""
    cond = it.get("condition") or ""
    name = display_name(it)
    if it.get("status") == "Verkauft":
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


def related_items(it, n=4):
    others = [x for x in ITEMS if x["id"] != it["id"] and x.get("gallery") and x["gallery"][0]]
    same_brand = [x for x in others if x.get("brand") and x.get("brand") == it.get("brand")]
    same_cat = [x for x in others if x.get("category") == it.get("category") and x.get("brand") != it.get("brand")]
    same_brand.sort(key=lambda x: (x.get("status") == "Verkauft"))
    same_cat.sort(key=lambda x: (x.get("status") == "Verkauft"))
    picks = []
    seen = set()
    for x in same_brand + same_cat:
        if x["id"] in seen:
            continue
        picks.append(x)
        seen.add(x["id"])
        if len(picks) >= n:
            break
    return picks


def related_card_html(x):
    sold = x.get("status") == "Verkauft"
    price_html = (
        '<span class="related-card__price">' + fmt_price_de(x["price"]) + "</span>"
        if not sold and x.get("price", 0) > 0
        else '<span class="related-card__price">Preis auf Anfrage</span>' if not sold
        else ""
    )
    sold_badge = '<span class="related-card__sold">SOLD</span>' if sold else ""
    return (
        '<a class="related-card" href="' + str(x["id"]) + '.html">'
        '<div class="related-card__frame">'
        '<img src="../' + esc(x["gallery"][0]) + '" alt="" loading="lazy" />' + sold_badge +
        "</div>"
        '<span class="related-card__brand">' + esc(x.get("brand") or "Ohne Marke") + "</span>"
        '<span class="related-card__title">' + esc(x["title"]) + "</span>" +
        price_html +
        "</a>"
    )


def facts_html(it):
    facts = []
    if it.get("category"):
        facts.append(("Kategorie", it["category"]))
    if it.get("size"):
        facts.append(("Größe", it["size"]))
    if it.get("color"):
        facts.append(("Farbe", it["color"]))
    if it.get("condition"):
        facts.append(("Zustand", it["condition"]))
    facts.append(("Artikelnummer", it.get("article") or str(it["id"])))
    return "".join(
        '<div><div class="fact__label">' + esc(k) + '</div><div class="fact__value">' + esc(v) + "</div></div>"
        for k, v in facts
    )


def price_block_html(it):
    sold = it.get("status") == "Verkauft"
    if sold:
        return (
            '<div class="info__badge info__badge--sold">SOLD — DISORDER119 ARCHIVE</div>'
        )
    if it.get("price_estimated"):
        return (
            '<div class="info__price">ca. ' + fmt_price_de(it["price"]) + "</div>"
            '<div class="info__badge info__badge--estimate">Preis wird geprüft</div>'
        )
    if it.get("price", 0) > 0:
        return '<div class="info__price">' + fmt_price_de(it["price"]) + "</div>"
    return '<div class="info__price">Preis auf Anfrage</div>'


def cta_html(it):
    sold = it.get("status") == "Verkauft"
    if sold:
        return '<p class="info__note">Dieses Stück ist bereits verkauft und bleibt als Teil des Disorder119-Archivs sichtbar.</p>'
    has_price = it.get("price", 0) > 0
    parts = ['<div class="info__cta">']
    if has_price:
        parts.append('<button type="button" class="btn" id="addToCartBtn">In den Warenkorb</button>')
    parts.append('<a class="btn btn--outline" id="inquireWhatsapp" target="_blank" rel="noopener">Anfrage per WhatsApp</a>')
    parts.append('<a class="btn btn--outline" id="inquireEmail">Anfrage per E-Mail</a>')
    parts.append("</div>")
    if not SHOP_CONFIG["whatsappNumber"] and not SHOP_CONFIG["email"]:
        parts.append('<p class="info__config-warning">Shop-Kontakt noch nicht eingerichtet: WhatsApp-Nummer oder E-Mail-Adresse fehlen in SHOP_CONFIG (index.html).</p>')
    return "".join(parts)


def json_ld(it):
    sold = it.get("status") == "Verkauft"
    data = {
        "@context": "https://schema.org",
        "@type": "Product",
        "name": it["title"],
        "url": SITE_URL + "artikel/" + str(it["id"]) + ".html",
        "image": [SITE_URL + g for g in it.get("gallery") or []],
        "description": (it.get("desc") or meta_description(it))[:500],
        "sku": it.get("article") or str(it["id"]),
        "brand": {"@type": "Brand", "name": it.get("brand") or "Disorder119"},
    }
    if not sold and it.get("price", 0) > 0:
        data["offers"] = {
            "@type": "Offer",
            "url": data["url"],
            "priceCurrency": "EUR",
            "price": f'{it["price"]:.2f}',
            "availability": "https://schema.org/InStock",
            "itemCondition": "https://schema.org/UsedCondition",
        }
    elif sold:
        # Bewusst OHNE Preis/Offer: der alte Verkaufspreis eines archivierten
        # Stuecks soll nicht mehr oeffentlich in strukturierten Daten stehen.
        data["offers"] = {
            "@type": "Offer",
            "url": data["url"],
            "priceCurrency": "EUR",
            "availability": "https://schema.org/OutOfStock",
            "itemCondition": "https://schema.org/UsedCondition",
        }
    return json.dumps(data, ensure_ascii=False)


def build_page(it):
    name = display_name(it)
    title_tag = name + " | Disorder119"
    desc = meta_description(it)
    gallery = it.get("gallery") or []
    hero = gallery[0] if gallery else "assets/favicon.png"
    canonical = SITE_URL + "artikel/" + str(it["id"]) + ".html"
    related = related_items(it)

    thumbs_note = "" if len(gallery) > 1 else ""

    related_section = ""
    if related:
        heading = ("MEHR VON " + it["brand"].upper()) if any(
            r.get("brand") == it.get("brand") for r in related
        ) else "ÄHNLICHE ARCHIVSTÜCKE"
        related_section = (
            '<div class="related"><h2 class="related__title">' + esc(heading) + "</h2>"
            '<div class="related__grid">' + "".join(related_card_html(r) for r in related) + "</div></div>"
        )

    article_data = json.dumps({
        "id": it["id"],
        "article": it.get("article"),
        "title": it["title"],
        "brand": it.get("brand"),
        "price": it.get("price", 0),
        "size": it.get("size"),
        "gallery": gallery,
    }, ensure_ascii=False)
    shop_cfg_data = json.dumps(SHOP_CONFIG, ensure_ascii=False)

    return f"""<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{esc(title_tag)}</title>
<meta name="description" content="{esc(desc)}">
<link rel="canonical" href="{canonical}">
<link rel="icon" type="image/png" href="../assets/favicon.png">
<link rel="stylesheet" href="../assets/article.css">
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
  <a class="page-head__brand" href="../index.html">DISORDER119</a>
  <a class="page-head__back" href="../index.html">← Zum Archiv</a>
</div>
<div class="product">
  <div class="gallery">
    <div class="gallery__stage">
      {'<span class="gallery__badge">SOLD</span>' if it.get("status") == "Verkauft" else ""}
      <img id="galleryMain" src="../{esc(hero)}" alt="{esc(name)}">
      <button type="button" class="gallery__nav gallery__nav--prev" id="galleryPrev" aria-label="Vorheriges Foto">‹</button>
      <button type="button" class="gallery__nav gallery__nav--next" id="galleryNext" aria-label="Nächstes Foto">›</button>
      <span class="gallery__counter" id="galleryCounter">1 / {max(len(gallery), 1)}</span>
    </div>
    <div class="gallery__thumbs" id="galleryThumbs"></div>
  </div>
  <div class="info">
    <a class="info__brand" href="../index.html?brand={esc(it.get('brand') or '')}">{esc(it.get("brand") or "Ohne Marke")}</a>
    <h1>{esc(it["title"])}</h1>
    {price_block_html(it)}
    <div class="info__facts">{facts_html(it)}</div>
    <p class="info__desc">{esc(it.get("desc") or "Keine Beschreibung hinterlegt.")}</p>
    {cta_html(it)}
  </div>
</div>
{related_section}
<div class="page-foot">
  <p>Disorder119 · Kuratiertes Archiv für Designer-, Vintage- und Contemporary-Mode. Jedes Stück wird einzeln ausgewählt, fotografiert und beschrieben.</p>
  <p><a href="../index.html">Zum vollständigen Archiv</a></p>
</div>
<div class="lightbox" id="lightbox">
  <button type="button" class="lightbox__close" id="lightboxClose" aria-label="Schließen">✕</button>
  <img id="lightboxImg" src="" alt="">
</div>
<script>
  window.ARTICLE_ITEM = {article_data};
  window.ARTICLE_SHOP_CONFIG = {shop_cfg_data};
</script>
<script src="../assets/article.js"></script>
</body>
</html>
"""


def main():
    out_dir = BASE / "artikel"
    written = 0
    for it in ITEMS:
        page = build_page(it)
        (out_dir / f"{it['id']}.html").write_text(page, encoding="utf-8")
        written += 1
    print(f"Regenerated {written} article pages.")


if __name__ == "__main__":
    main()

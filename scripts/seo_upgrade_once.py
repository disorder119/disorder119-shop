#!/usr/bin/env python3
from pathlib import Path

BASE = Path(__file__).resolve().parents[1]


def replace_once(text, old, new, label):
    if new in text:
        return text
    if old not in text:
        raise SystemExit(f"{label}: Ausgangstext nicht gefunden")
    return text.replace(old, new, 1)


def replace_between(text, start, end, new_block, label):
    i = text.find(start)
    if i < 0:
        raise SystemExit(f"{label}: Startmarker nicht gefunden")
    j = text.find(end, i)
    if j < 0:
        raise SystemExit(f"{label}: Endmarker nicht gefunden")
    return text[:i] + new_block + text[j:]


# ---------------------------------------------------------------------------
# build_site.py – Suchintention, strukturierte Daten, multilingualer SSR,
# Duplicate-Control und Image-Sitemap. Kein Layout/CSS/Mode-Code wird geaendert.
# ---------------------------------------------------------------------------
p = BASE / "build_site.py"
s = p.read_text(encoding="utf-8")

repls = [
    (
        '"home_title": "Disorder119 — Archiv-Katalog",\n        "home_desc": "Kuratiertes Archiv für Designer-Mode aus zweiter Hand: Prada, Dior, Jean Paul Gaultier, Yves Saint Laurent u.v.m. Jedes Stück handverlesen, einzeln fotografiert und genau beschrieben.",',
        '"home_title": "Designer Second Hand & Vintage Mode | Disorder119",\n        "home_desc": "Kuratiertes Designer-Second-Hand-Archiv mit Prada, Dior, Jean Paul Gaultier, Yves Saint Laurent, Y-3 und mehr. Einzelstücke, individuell fotografiert und archiviert.",',
        "DE Home Meta",
    ),
    (
        '"home_title": "Disorder119 — Curated Archive",\n        "home_desc": "Curated archive of pre-owned designer fashion: Prada, Dior, Jean Paul Gaultier, Yves Saint Laurent and more. Every piece hand-picked, individually photographed and precisely described.",',
        '"home_title": "Pre-Owned Designer & Vintage Fashion | Disorder119",\n        "home_desc": "Curated archive of pre-owned designer fashion including Prada, Dior, Jean Paul Gaultier, Yves Saint Laurent, Y-3 and more. One-off pieces, individually photographed and archived.",',
        "EN Home Meta",
    ),
    (
        '"home_title": "Disorder119 — Archive Sélectionnée",\n        "home_desc": "Archive sélectionnée de mode de créateurs de seconde main : Prada, Dior, Jean Paul Gaultier, Yves Saint Laurent et bien plus. Chaque pièce choisie à la main, photographiée individuellement et décrite avec précision.",',
        '"home_title": "Mode Designer Seconde Main & Vintage | Disorder119",\n        "home_desc": "Archive sélectionnée de mode de créateurs de seconde main avec Prada, Dior, Jean Paul Gaultier, Yves Saint Laurent, Y-3 et plus. Pièces uniques, photographiées individuellement et archivées.",',
        "FR Home Meta",
    ),
]
for old, new, label in repls:
    s = replace_once(s, old, new, label)

special_meta = '''SPECIAL_META_DESCRIPTIONS = {
    "ueber-uns": {
        "de": "Über Disorder119: unabhängig kuratiertes Archiv für Designer-, Vintage- und Contemporary-Mode aus zweiter Hand.",
        "en": "About Disorder119: an independently curated archive of pre-owned designer, vintage and contemporary fashion.",
        "fr": "À propos de Disorder119 : archive indépendante et sélectionnée de mode designer, vintage et contemporaine de seconde main.",
    },
    "faq": {
        "de": "Antworten zu Bestellung, Zustand, Authentizität, Versand, Widerruf und dem Designer-Second-Hand-Archiv von Disorder119.",
        "en": "Answers about ordering, condition, authenticity, shipping, returns and the Disorder119 pre-owned designer archive.",
        "fr": "Réponses sur les commandes, l’état, l’authenticité, l’expédition, les retours et l’archive designer seconde main Disorder119.",
    },
    "mieten": {
        "de": "Designer- und Vintage-Mode von Disorder119 für Shootings, Film, Theater, Events und private Anlässe mieten oder ausleihen.",
        "en": "Rent or borrow designer and vintage fashion from Disorder119 for shoots, film, theatre, events and private occasions.",
        "fr": "Louez des pièces designer et vintage Disorder119 pour shootings, film, théâtre, événements et occasions privées.",
    },
    "impressum": {
        "de": "Impressum und Anbieterinformationen von Disorder119.",
        "en": "Legal notice and provider information for Disorder119.",
        "fr": "Mentions légales et informations sur Disorder119.",
    },
    "agb": {
        "de": "Allgemeine Geschäftsbedingungen von Disorder119 für Bestellungen und Käufe.",
        "en": "Terms and conditions for orders and purchases from Disorder119.",
        "fr": "Conditions générales applicables aux commandes et achats chez Disorder119.",
    },
    "datenschutz": {
        "de": "Datenschutzhinweise von Disorder119 zur Verarbeitung personenbezogener Daten.",
        "en": "Disorder119 privacy information on the processing of personal data.",
        "fr": "Politique de confidentialité Disorder119 concernant le traitement des données personnelles.",
    },
}

OG_LOCALES = {"de": "de_DE", "en": "en_US", "fr": "fr_FR"}

'''
s = replace_once(s, "LEGAL_CONTENT_HTML = {\n", special_meta + "LEGAL_CONTENT_HTML = {\n", "Special SEO Meta")

new_json_ld = '''def json_ld(it, lang):
    status = it.get("public_status") or "DRAFT"
    sold = status == "SOLD"
    url = SITE_URL.rstrip("/") + lang_home(lang) + "artikel/" + str(it["id"]) + "/"
    desc_field = {"de": it.get("desc_de") or it.get("desc"), "en": it.get("desc_en"), "fr": it.get("desc_fr")}[lang]
    data = {
        "@context": "https://schema.org",
        "@type": "Product",
        "@id": url + "#product",
        "name": display_name(it),
        "url": url,
        "image": [SITE_URL + g for g in it.get("gallery") or []],
        "description": (desc_field or meta_description(it, lang))[:500],
        "sku": it.get("article") or str(it["id"]),
        "brand": {"@type": "Brand", "name": it.get("brand") or "Disorder119"},
        "seller": {"@id": SITE_URL + "#store"},
    }
    if it.get("category"):
        data["category"] = cat_tr(it["category"], lang)
    if it.get("color"):
        data["color"] = it["color"]
    if it.get("size"):
        data["size"] = size_tr(it["size"], lang)
    if not sold and it.get("price", 0) > 0:
        availability = (
            "https://schema.org/LimitedAvailability"
            if status == "RESERVED"
            else "https://schema.org/InStock"
        )
        data["offers"] = {
            "@type": "Offer",
            "url": data["url"],
            "priceCurrency": "EUR",
            "price": f'{it["price"]:.2f}',
            "availability": availability,
            "itemCondition": "https://schema.org/UsedCondition",
            "seller": {"@id": SITE_URL + "#store"},
        }
    return json.dumps(data, ensure_ascii=False)


'''
s = replace_between(s, "def json_ld(it, lang):\n", "def breadcrumb_json_ld(it, lang):\n", new_json_ld, "Product JSON-LD")

site_helpers = '''def site_entities_jsonld(shop_config):
    store = {
        "@type": "OnlineStore",
        "@id": SITE_URL + "#store",
        "name": "Disorder119",
        "url": SITE_URL,
        "logo": SITE_URL + "assets/favicon.png",
        "image": SITE_URL + "assets/og-image.png",
        "currenciesAccepted": "EUR",
        "address": {
            "@type": "PostalAddress",
            "streetAddress": "Nelseestraße 25",
            "postalCode": "63739",
            "addressLocality": "Aschaffenburg",
            "addressCountry": "DE",
        },
    }
    if shop_config.get("email"):
        store["email"] = shop_config["email"]
    data = {
        "@context": "https://schema.org",
        "@graph": [
            {
                "@type": "WebSite",
                "@id": SITE_URL + "#website",
                "url": SITE_URL,
                "name": "Disorder119",
                "inLanguage": LANGS,
                "publisher": {"@id": SITE_URL + "#store"},
            },
            store,
        ],
    }
    return json.dumps(data, ensure_ascii=False)


def webpage_jsonld(title, description, canonical, lang, slug=""):
    page_type = "AboutPage" if slug == "ueber-uns" else "WebPage"
    data = {
        "@context": "https://schema.org",
        "@type": page_type,
        "@id": canonical + "#webpage",
        "url": canonical,
        "name": title,
        "description": description,
        "inLanguage": lang,
        "isPartOf": {"@id": SITE_URL + "#website"},
        "publisher": {"@id": SITE_URL + "#store"},
    }
    return json.dumps(data, ensure_ascii=False)


def page_breadcrumb_jsonld(title, canonical, lang):
    home = SITE_URL.rstrip("/") + lang_home(lang)
    label = {"de": "Archiv", "en": "Archive", "fr": "Archive"}[lang]
    data = {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": label, "item": home},
            {"@type": "ListItem", "position": 2, "name": title, "item": canonical},
        ],
    }
    return json.dumps(data, ensure_ascii=False)


'''
s = replace_once(s, "def item_list_jsonld(public_items, lang):\n", site_helpers + "def item_list_jsonld(public_items, lang):\n", "Site Entity JSON-LD")

new_render_bundle = '''def render_bundle_page(lang, path_segment, title_tag, desc_text, shop_config,
                        include_item_list=False, robots=None, static_content="",
                        canonical_path_segment=None, slug=""):
    tmpl = (BASE / "index_template.html").read_text(encoding="utf-8")
    canonical_segment = path_segment if canonical_path_segment is None else canonical_path_segment
    urls_by_lang = {l: SITE_URL.rstrip("/") + lang_home(l) + canonical_segment for l in LANGS}
    canonical = urls_by_lang[lang]

    structured = []
    if include_item_list:
        public_items = [it for it in ITEMS if it.get("public_status") != "DRAFT"]
        structured.append(site_entities_jsonld(shop_config))
        structured.append(item_list_jsonld(public_items, lang))
    elif robots != "noindex,follow":
        structured.append(webpage_jsonld(title_tag, desc_text, canonical, lang, slug))
        if path_segment:
            structured.append(page_breadcrumb_jsonld(title_tag, canonical, lang))
    structured_block = "\n".join('<script type="application/ld+json">' + block + "</script>" for block in structured)

    robots_value = robots or "index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1"
    locale_alternates = "\n".join(
        f'<meta property="og:locale:alternate" content="{OG_LOCALES[l]}">'
        for l in LANGS if l != lang
    )

    out = tmpl
    out = out.replace("__ITEMLIST_JSONLD_BLOCK__", structured_block)
    out = out.replace("__HTML_LANG__", lang)
    out = out.replace("__CANONICAL_URL__", canonical)
    out = out.replace("__HREFLANG_TAGS__", hreflang_block(urls_by_lang))
    out = out.replace("__META_TITLE__", esc(title_tag))
    out = out.replace("__META_DESC__", esc(desc_text))
    out = out.replace("__ROBOTS_META__", f'<meta name="robots" content="{robots_value}">')
    out = out.replace("__OG_LOCALE__", OG_LOCALES[lang])
    out = out.replace("__OG_LOCALE_ALTERNATES__", locale_alternates)
    out = out.replace("__STATIC_PAGE_CONTENT__", static_content)
    out = out.replace("__SHOP_CONFIG_JSON__", json.dumps(shop_config, ensure_ascii=False))
    out = out.replace("__APP_CSS_VERSION__", APP_CSS_VERSION)
    out = out.replace("__APP_JS_VERSION__", APP_JS_VERSION)
    return out


'''
s = replace_between(s, "def render_bundle_page(lang, path_segment, title_tag, desc_text, shop_config,\n", "def build_index():\n", new_render_bundle, "Bundle SEO Render")

new_special = '''def build_special_pages():
    shop_config = get_shop_config()
    n = 0
    duplicate_variants = {"match", "chaos", "baukasten"}
    for lang in LANGS:
        ph = META_PHRASES[lang]
        for slug, labels in SPECIAL_PAGES.items():
            label = labels[lang]
            title_tag = ("Disorder119 — " + label) if slug != "cart" else (label + " | Disorder119")
            desc_text = SPECIAL_META_DESCRIPTIONS.get(slug, {}).get(lang, ph["home_desc"])
            robots = "noindex,follow" if slug == "cart" or slug in duplicate_variants else None
            canonical_segment = "" if slug in duplicate_variants else None
            static_content = static_page_content_html(slug, lang, shop_config)
            out = render_bundle_page(
                lang, slug + "/", title_tag, desc_text, shop_config,
                include_item_list=False, robots=robots, static_content=static_content,
                canonical_path_segment=canonical_segment, slug=slug,
            )
            out_dir = (BASE / slug) if lang == "de" else (BASE / lang / slug)
            out_dir.mkdir(parents=True, exist_ok=True)
            (out_dir / "index.html").write_text(out, encoding="utf-8")
            n += 1
    print(f"{n} Sonderseiten geschrieben ({len(SPECIAL_PAGES)} x {len(LANGS)} Sprachen).")


'''
s = replace_between(s, "def build_special_pages():\n", "def article_dir(lang, item_id):\n", new_special, "Special Page SEO")

new_sitemap = '''def build_sitemap():
    public_items = [it for it in ITEMS if it.get("public_status") != "DRAFT"]
    indexable_specials = [
        slug for slug in SPECIAL_PAGES
        if slug not in {"cart", "match", "chaos", "baukasten"}
    ]
    page_specs = (
        [("", None)]
        + [("artikel/" + str(it["id"]) + "/", it) for it in public_items]
        + [(slug + "/", None) for slug in indexable_specials]
    )

    def url_entry(lang, segment, item=None):
        urls_by_lang = {l: SITE_URL.rstrip("/") + lang_home(l) + segment for l in LANGS}
        alt = "\n".join(
            f'    <xhtml:link rel="alternate" hreflang="{l}" href="{urls_by_lang[l]}"/>' for l in LANGS
        )
        alt += f'\n    <xhtml:link rel="alternate" hreflang="x-default" href="{urls_by_lang["de"]}"/>'
        images = ""
        if item:
            image_nodes = []
            for rel in item.get("gallery") or []:
                loc = html.escape(SITE_URL + rel, quote=True)
                image_nodes.append(f"    <image:image><image:loc>{loc}</image:loc></image:image>")
            if image_nodes:
                images = "\n" + "\n".join(image_nodes)
        return f"  <url>\n    <loc>{urls_by_lang[lang]}</loc>\n{alt}{images}\n  </url>"

    entries = [url_entry(lang, seg, item) for seg, item in page_specs for lang in LANGS]
    body = "\n".join(entries)
    xml = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" '
        'xmlns:xhtml="http://www.w3.org/1999/xhtml" '
        'xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n'
        f"{body}\n</urlset>\n"
    )
    (BASE / "sitemap.xml").write_text(xml, encoding="utf-8")
    print(f"sitemap.xml geschrieben ({len(entries)} indexierbare URLs, inklusive Produktbildern).")


'''
s = replace_between(s, "def build_sitemap():\n", "CATALOG_PATH = BASE / \"data\" / \"catalog.json\"\n", new_sitemap, "Image Sitemap")

# EN/FR Produktseiten bekommen ihren Text direkt serverseitig in der richtigen Sprache.
old = '    desc = meta_description(it, lang)\n    gallery = it.get("gallery") or []\n'
new = '''    desc = meta_description(it, lang)
    raw_body_desc = {
        "de": it.get("desc_de") or it.get("desc") or "",
        "en": it.get("desc_en") or "",
        "fr": it.get("desc_fr") or "",
    }[lang]
    body_desc = raw_body_desc.strip() or auto_description(it, lang)
    gallery = it.get("gallery") or []
'''
s = replace_once(s, old, new, "Multilingual SSR Description")

s = replace_once(
    s,
    '<meta name="description" content="{esc(desc)}">\n{\'<meta name="robots" content="noindex,nofollow">\' if it.get("public_status") == "DRAFT" else ""}\n<link rel="canonical" href="{canonical}">',
    '<meta name="description" content="{esc(desc)}">\n{\'<meta name="robots" content="noindex,nofollow">\' if it.get("public_status") == "DRAFT" else \'<meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1">\'}\n<link rel="canonical" href="{canonical}">',
    "Product Robots",
)

s = replace_once(
    s,
    '<link rel="stylesheet" href="/assets/article.css?v={ARTICLE_CSS_VERSION}">\n<meta property="og:type" content="product">',
    '<link rel="stylesheet" href="/assets/article.css?v={ARTICLE_CSS_VERSION}">\n<link rel="preload" as="image" href="/{esc(hero)}" fetchpriority="high">\n<meta property="og:type" content="product">',
    "Hero Preload",
)

s = replace_once(
    s,
    '<meta property="og:site_name" content="Disorder119">\n<meta property="og:title" content="{esc(title_tag)}">',
    '<meta property="og:site_name" content="Disorder119">\n<meta property="og:locale" content="{OG_LOCALES[lang]}">\n<meta property="og:title" content="{esc(title_tag)}">',
    "Product OG Locale",
)

s = replace_once(
    s,
    '<meta property="og:image" content="{SITE_URL}{esc(hero)}">\n<meta name="twitter:card" content="summary_large_image">',
    '<meta property="og:image" content="{SITE_URL}{esc(hero)}">\n<meta property="og:image:alt" content="{esc(name)}">\n<meta name="twitter:card" content="summary_large_image">',
    "Product OG Image Alt",
)

s = replace_once(
    s,
    '<meta name="twitter:image" content="{SITE_URL}{esc(hero)}">\n<script type="application/ld+json">{json_ld(it, lang)}</script>',
    '<meta name="twitter:image" content="{SITE_URL}{esc(hero)}">\n<meta name="twitter:image:alt" content="{esc(name)}">\n<script type="application/ld+json">{site_entities_jsonld(shop_config)}</script>\n<script type="application/ld+json">{json_ld(it, lang)}</script>',
    "Product Site Entity + Twitter Alt",
)

s = replace_once(
    s,
    '<img id="galleryMain" src="/{esc(hero)}" alt="{esc(name)}">',
    '<img id="galleryMain" src="/{esc(hero)}" alt="{esc(name)}" fetchpriority="high" decoding="async">',
    "Product Hero LCP",
)

s = replace_once(
    s,
    '<p class="info__desc" id="itemDesc">{esc((it.get("desc_de") or it.get("desc") or "").strip() or auto_description(it, "de"))}</p>',
    '<p class="info__desc" id="itemDesc">{esc(body_desc)}</p>',
    "Product SSR Body Language",
)

p.write_text(s, encoding="utf-8")


# ---------------------------------------------------------------------------
# index_template.html – OpenGraph locale + Bild-Alt. Keine sichtbare Aenderung.
# ---------------------------------------------------------------------------
p = BASE / "index_template.html"
t = p.read_text(encoding="utf-8")
t = replace_once(
    t,
    '<meta property="og:site_name" content="Disorder119">\n<meta property="og:title" content="__META_TITLE__">',
    '<meta property="og:site_name" content="Disorder119">\n<meta property="og:locale" content="__OG_LOCALE__">\n__OG_LOCALE_ALTERNATES__\n<meta property="og:title" content="__META_TITLE__">',
    "Template OG Locale",
)
t = replace_once(
    t,
    '<meta property="og:image:height" content="630">\n<meta name="twitter:card" content="summary_large_image">',
    '<meta property="og:image:height" content="630">\n<meta property="og:image:alt" content="__META_TITLE__">\n<meta name="twitter:card" content="summary_large_image">',
    "Template OG Image Alt",
)
t = replace_once(
    t,
    '<meta name="twitter:image" content="https://disorder119.com/assets/og-image.png">',
    '<meta name="twitter:image" content="https://disorder119.com/assets/og-image.png">\n<meta name="twitter:image:alt" content="__META_TITLE__">',
    "Template Twitter Image Alt",
)
p.write_text(t, encoding="utf-8")


# ---------------------------------------------------------------------------
# validate_shop.py – SEO-Regressionschecks dauerhaft machen.
# ---------------------------------------------------------------------------
p = BASE / "scripts" / "validate_shop.py"
v = p.read_text(encoding="utf-8")
marker = '''    # Kunden-/Bestelldaten duerfen in diesem oeffentlichen Repo nicht als JSON liegen.\n'''
insert = '''    # Technische SEO-Invarianten: Homepage-Entitaeten, Produkt-Metadaten,
    # Duplicate-Control fuer alternative Katalogansichten und saubere Sitemap.
    home_html = (BASE / "index.html").read_text(encoding="utf-8", errors="replace")
    for needle, label in [
        ('"@type": "OnlineStore"', "OnlineStore JSON-LD"),
        ('"@type": "WebSite"', "WebSite JSON-LD"),
        ('hreflang="x-default"', "x-default hreflang"),
        ('max-image-preview:large', "Robots Rich Preview Directive"),
    ]:
        if needle not in home_html:
            severe.append(f"Homepage: {label} fehlt")

    sample_public = next((it for it in items if (it.get("public_status") or "DRAFT") != "DRAFT"), None)
    if sample_public:
        sample_path = BASE / "artikel" / str(sample_public["id"]) / "index.html"
        sample_html = sample_path.read_text(encoding="utf-8", errors="replace")
        for needle, label in [
            ('"@type": "Product"', "Product JSON-LD"),
            ('"@type": "BreadcrumbList"', "Breadcrumb JSON-LD"),
            ('property="og:image:alt"', "OpenGraph Bild-Alt"),
            ('name="twitter:image:alt"', "Twitter Bild-Alt"),
            ('fetchpriority="high"', "LCP Bildpriorisierung"),
        ]:
            if needle not in sample_html:
                severe.append(f"Produktseite {sample_public['id']}: {label} fehlt")

    for variant in ["match", "chaos", "baukasten"]:
        variant_html = (BASE / variant / "index.html").read_text(encoding="utf-8", errors="replace")
        if 'name="robots" content="noindex,follow"' not in variant_html:
            severe.append(f"/{variant}/: noindex,follow fehlt")
        if '<link rel="canonical" href="https://disorder119.com/">' not in variant_html:
            severe.append(f"/{variant}/: Canonical auf Archiv fehlt")

    sitemap_text = (BASE / "sitemap.xml").read_text(encoding="utf-8", errors="replace")
    for forbidden_slug in ["/cart/", "/match/", "/chaos/", "/baukasten/"]:
        if forbidden_slug in sitemap_text:
            severe.append(f"Sitemap enthaelt nicht-indexierbare URL: {forbidden_slug}")
    if 'xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"' not in sitemap_text:
        severe.append("Sitemap: Image-Sitemap Namespace fehlt")
    if "<image:image>" not in sitemap_text:
        severe.append("Sitemap: Produktbilder fehlen")

    # Kunden-/Bestelldaten duerfen in diesem oeffentlichen Repo nicht als JSON liegen.\n'''
v = replace_once(v, marker, insert, "SEO Validation")
p.write_text(v, encoding="utf-8")

print("SEO-Upgrade erfolgreich angewendet.")

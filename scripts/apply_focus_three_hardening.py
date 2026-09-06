#!/usr/bin/env python3
"""Apply the focused >9 hardening for mobile LCP and product-data transparency.

Scope:
- normal archive shell only (not Match/Chaos/Baukasten blocks)
- build pipeline / catalog payload
- product-page data-gap disclosure

The protected mode blocks and config/mode-guard.json are never modified.
"""
from pathlib import Path

BASE = Path(__file__).resolve().parents[1]
TEMPLATE = BASE / "index_template.html"
BUILD = BASE / "build_site.py"
APP = BASE / "assets" / "app.js"


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if new in text:
        return text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"FEHLER: {label}: erwartete 1 Fundstelle, gefunden {count}")
    return text.replace(old, new, 1)


def patch_template(text: str) -> str:
    text = replace_once(
        text,
        '<title>__META_TITLE__</title>\n<link rel="stylesheet" href="/assets/app.css?v=__APP_CSS_VERSION__">',
        '<title>__META_TITLE__</title>\n__CRITICAL_IMAGE_PRELOADS__\n<link rel="stylesheet" href="/assets/app.css?v=__APP_CSS_VERSION__">',
        "Critical-image preload token",
    )
    text = replace_once(
        text,
        '<div class="app-shell hidden" id="appShell">',
        '<div class="app-shell__APP_SHELL_HIDDEN_CLASS__" id="appShell">',
        "server-visible home shell token",
    )
    text = replace_once(
        text,
        '<div class="grid" id="grid"></div>',
        '<div class="grid" id="grid"__SSR_GRID_ATTR__>__SSR_INITIAL_GRID__</div>',
        "SSR initial grid token",
    )
    return text


def patch_build(text: str) -> str:
    marker = "FOCUS3_MOBILE_SSR_LCP"
    if marker not in text:
        anchor = '''def render_bundle_page(lang, path_segment, title_tag, desc_text, shop_config,\n                        include_item_list=False, robots=None, static_content="",\n                        canonical_path_segment=None, slug=""):\n'''
        helpers = r'''# FOCUS3_MOBILE_SSR_LCP
# The classic German homepage is the primary mobile landing page. Its first
# two default cards are emitted in the initial HTML and their images are
# preloaded. This removes the previous request chain HTML -> app.js ->
# catalog.json -> image that Lighthouse measured as ~4.8 s load delay.
# The exact same cards are then hydrated by app.js instead of being replaced.
def initial_archive_items(limit=2):
    available = [it for it in ITEMS if it.get("public_status") == "AVAILABLE"]
    return sorted(
        available,
        key=lambda it: it.get("brightness") if isinstance(it.get("brightness"), (int, float)) else 0.5,
        reverse=True,
    )[:limit]


def grid_thumb_path(it):
    gallery = it.get("gallery") or []
    if not gallery:
        return ""
    hero = gallery[0]
    candidate = thumb_path(hero)
    return candidate if (BASE / candidate).is_file() else hero


def initial_archive_alt(it):
    title = str(it.get("title") or "").strip()
    brand = str(it.get("brand") or "").strip()
    if not brand or title.lower().startswith(brand.lower()):
        return title
    return (brand + " " + title).strip()


def initial_archive_card_html(it, lang):
    ph = META_PHRASES[lang]
    home = lang_home(lang)
    gallery = it.get("gallery") or []
    original = gallery[0] if gallery else ""
    mobile = grid_thumb_path(it)
    size_raw = it.get("size_normalized")
    if not size_raw or size_raw == "Unknown":
        size_raw = it.get("size") or ""
    size_label = size_tr(size_raw, lang) if size_raw else ""
    price = float(it.get("price") or 0)
    if price > 0:
        price_text = ("ca. " if it.get("price_estimated") else "") + fmt_price_de(price)
    else:
        price_text = ph["price_on_request"]
    picture = ""
    if original:
        source = ""
        if mobile and mobile != original:
            source = '<source media="(max-width: 600px)" srcset="/' + esc(mobile) + '">'
        picture = (
            '<picture>' + source
            + '<img src="/' + esc(original) + '" alt="' + esc(initial_archive_alt(it))
            + '" loading="eager" fetchpriority="high" decoding="async">'
            + '</picture>'
        )
    return (
        '<a class="plate" data-ssr-item-id="' + str(it["id"]) + '" href="'
        + home + 'artikel/' + str(it["id"]) + '/">'
        + '<div class="plate__frame">' + picture + '</div>'
        + '<div class="plate__body">'
        + '<button type="button" class="plate__brand" data-brand-filter>'
        + esc(it.get("brand") or ph["no_brand"]) + '</button>'
        + '<span class="plate__title">' + esc(it.get("title") or "") + '</span>'
        + (('<span class="plate__size">' + esc(size_label) + '</span>') if size_label else "")
        + '<div class="plate__row"><span class="plate__price">' + esc(price_text) + '</span></div>'
        + '</div></a>'
    )


def initial_archive_grid_html(lang):
    return "".join(initial_archive_card_html(it, lang) for it in initial_archive_items(2))


def initial_archive_preloads():
    links = []
    for it in initial_archive_items(2):
        path = grid_thumb_path(it)
        if path:
            links.append('<link rel="preload" as="image" href="/' + esc(path) + '" fetchpriority="high">')
    return "\\n".join(links)


def product_data_gap_html(it, lang):
    """Truthful disclosure for unresolved source metadata; never invent facts."""
    category = it.get("taxonomy_category") or it.get("category") or ""
    size_expected = category in {"Jackets", "Coats", "Tops", "Shirts", "Knitwear", "Pants", "Skirts", "Dresses", "Shoes"}
    missing = []
    if size_expected and not str(it.get("size") or "").strip():
        missing.append({"de": "Größe", "en": "size", "fr": "taille"}[lang])
    if not str(it.get("color") or "").strip():
        missing.append({"de": "Farbe", "en": "color", "fr": "couleur"}[lang])
    if not str(it.get("condition") or "").strip():
        missing.append({"de": "Zustand", "en": "condition", "fr": "état"}[lang])
    if not missing:
        return ""
    copy = {
        "de": "Noch nicht abschließend dokumentiert: {fields}. Diese Angaben werden vor Vertragsschluss bestätigt; es werden keine fehlenden Produktdaten geschätzt.",
        "en": "Not yet fully documented: {fields}. These details are confirmed before the contract is concluded; missing product data is never guessed.",
        "fr": "Pas encore entièrement documenté : {fields}. Ces informations sont confirmées avant la conclusion du contrat ; aucune donnée produit manquante n’est inventée.",
    }[lang]
    return '<p class="info__note info__note--data-gap" data-product-data-gap>' + esc(copy.format(fields=", ".join(missing))) + '</p>'


'''
        if anchor not in text:
            raise SystemExit("FEHLER: render_bundle_page Anker fehlt")
        text = text.replace(anchor, helpers + anchor, 1)

    # Populate the new initial-render tokens. Only the German homepage starts
    # visible server-side because EN/FR static labels are translated by app.js;
    # showing them early would cause a German-language flash on slow devices.
    old = '''    out = out.replace("__STATIC_PAGE_CONTENT__", static_content)\n    out = out.replace("__SHOP_CONFIG_JSON__", json.dumps(shop_config, ensure_ascii=False))\n    out = out.replace("__APP_CSS_VERSION__", APP_CSS_VERSION)\n'''
    new = '''    out = out.replace("__STATIC_PAGE_CONTENT__", static_content)\n    initial_ssr_home = (lang == "de" and path_segment == "" and slug == "")\n    out = out.replace("__CRITICAL_IMAGE_PRELOADS__", initial_archive_preloads() if initial_ssr_home else "")\n    out = out.replace("__APP_SHELL_HIDDEN_CLASS__", "" if initial_ssr_home else " hidden")\n    out = out.replace("__SSR_GRID_ATTR__", ' data-ssr-initial="1"' if initial_ssr_home else "")\n    out = out.replace("__SSR_INITIAL_GRID__", initial_archive_grid_html(lang) if initial_ssr_home else "")\n    out = out.replace("__SHOP_CONFIG_JSON__", json.dumps(shop_config, ensure_ascii=False))\n    out = out.replace("__APP_CSS_VERSION__", APP_CSS_VERSION)\n'''
    text = replace_once(text, old, new, "render_bundle_page initial SSR tokens")

    # Publish a mobile thumbnail path in catalog.json only when that file
    # actually exists. Protected modes continue to use gallery originals.
    old_catalog = '''    catalog = [\n        {k: it.get(k) for k in CATALOG_FIELDS if k in it}\n        for it in public_items\n    ]\n'''
    new_catalog = '''    catalog = []\n    for it in public_items:\n        row = {k: it.get(k) for k in CATALOG_FIELDS if k in it}\n        row["grid_image"] = grid_thumb_path(it)\n        catalog.append(row)\n'''
    text = replace_once(text, old_catalog, new_catalog, "catalog mobile grid image")

    # Add explicit unresolved-data disclosure to purchasable product pages.
    old_cta = '''    parts.append('<p class="info__note">' + esc(trust_notes.get(lang, trust_notes["de"])) + '</p>')\n    if not shop_config["whatsappNumber"] and not shop_config["email"]:\n'''
    new_cta = '''    parts.append('<p class="info__note">' + esc(trust_notes.get(lang, trust_notes["de"])) + '</p>')\n    parts.append(product_data_gap_html(it, lang))\n    if not shop_config["whatsappNumber"] and not shop_config["email"]:\n'''
    text = replace_once(text, old_cta, new_cta, "product data gap disclosure")
    return text


def patch_app(text: str) -> str:
    marker = "FOCUS3_SSR_HYDRATION"
    if marker in text:
        return text

    # Use the pre-generated 220px thumbnail only on small screens. Desktop
    # continues to receive the original, preserving the existing visual quality.
    old_hero = '''      var hero = it.gallery && it.gallery[0];\n      var imgSrc = assetUrl(hero || "");\n\n      var altText = escapeHtml(productAltText(it));\n'''
    new_hero = '''      var hero = it.gallery && it.gallery[0];\n      var mobileGridImage = it.grid_image || hero;\n      var imgSrc = assetUrl(hero || "");\n      var mobileImgSrc = assetUrl(mobileGridImage || hero || "");\n\n      var altText = escapeHtml(productAltText(it));\n'''
    text = replace_once(text, old_hero, new_hero, "mobile grid image source")

    old_image = '''      plate.innerHTML =\n        '<div class="plate__frame">' +\n          (imgSrc ? '<img src="' + imgSrc + '" alt="' + altText + '" loading="' + heroLoading + '"' + heroPriority + ' />' : "") +\n        "</div>" +\n'''
    new_image = '''      var pictureHtml = "";\n      if (imgSrc) {\n        var mobileSource = mobileImgSrc && mobileImgSrc !== imgSrc\n          ? '<source media="(max-width: 600px)" srcset="' + mobileImgSrc + '">'\n          : "";\n        pictureHtml = '<picture>' + mobileSource + '<img src="' + imgSrc + '" alt="' + altText + '" loading="' + heroLoading + '"' + heroPriority + ' decoding="async"></picture>';\n      }\n      plate.innerHTML =\n        '<div class="plate__frame">' + pictureHtml +\n        "</div>" +\n'''
    text = replace_once(text, old_image, new_image, "responsive archive picture")

    # Hydrate the two server-rendered default cards instead of replacing them.
    old_clear = '''    countEl.textContent = tFormat("railCountTemplate", { filtered: filtered.length, total: PUBLIC_ITEMS.length });\n    gridEl.innerHTML = "";\n    emptyEl.classList.toggle("visible", filtered.length === 0);\n'''
    new_clear = '''    countEl.textContent = tFormat("railCountTemplate", { filtered: filtered.length, total: PUBLIC_ITEMS.length });\n    var ssrPlates = (!firstGridRenderDone && gridEl.getAttribute("data-ssr-initial") === "1")\n      ? Array.prototype.slice.call(gridEl.querySelectorAll("[data-ssr-item-id]"))\n      : []; // FOCUS3_SSR_HYDRATION\n    var reuseSsr = ssrPlates.length > 0 && ssrPlates.every(function (plate, i) {\n      return visibleItems[i] && Number(plate.getAttribute("data-ssr-item-id")) === Number(visibleItems[i].id);\n    });\n    if (!reuseSsr) gridEl.innerHTML = "";\n    emptyEl.classList.toggle("visible", filtered.length === 0);\n'''
    text = replace_once(text, old_clear, new_clear, "SSR grid preservation")

    # Reuse SSR nodes for idx 0/1, create all remaining cards normally.
    old_plate = '''      var plate = document.createElement("a");\n      plate.className = "plate";\n'''
    new_plate = '''      var reusedSsrPlate = reuseSsr && idx < ssrPlates.length;\n      var plate = reusedSsrPlate ? ssrPlates[idx] : document.createElement("a");\n      if (!reusedSsrPlate) plate.className = "plate";\n'''
    text = replace_once(text, old_plate, new_plate, "SSR plate reuse")

    # Don't rewrite an already painted SSR card; its static HTML is identical
    # in meaning and keeping the node is what preserves the early LCP paint.
    old_before_inner = '''      var heroLoading = idx < 4 ? "eager" : "lazy";\n      var heroPriority = idx < 2 ? ' fetchpriority="high"' : "";\n      var pictureHtml = "";\n'''
    new_before_inner = '''      var heroLoading = idx < 4 ? "eager" : "lazy";\n      var heroPriority = idx < 2 ? ' fetchpriority="high"' : "";\n      var pictureHtml = "";\n'''
    # no-op anchor sanity check
    if old_before_inner not in text:
        raise SystemExit("FEHLER: hero image block fuer SSR-Hydration fehlt")

    old_inner_start = '''      plate.innerHTML =\n        '<div class="plate__frame">' + pictureHtml +\n'''
    new_inner_start = '''      if (!reusedSsrPlate) plate.innerHTML =\n        '<div class="plate__frame">' + pictureHtml +\n'''
    text = replace_once(text, old_inner_start, new_inner_start, "SSR innerHTML preservation")

    old_append = '''      frag.appendChild(plate);\n    });\n    gridEl.appendChild(frag);\n'''
    new_append = '''      if (!reusedSsrPlate) frag.appendChild(plate);\n    });\n    gridEl.appendChild(frag);\n    if (reuseSsr) gridEl.removeAttribute("data-ssr-initial");\n'''
    text = replace_once(text, old_append, new_append, "SSR append behavior")
    return text


def main() -> None:
    changed = []
    for path, patcher in ((TEMPLATE, patch_template), (BUILD, patch_build), (APP, patch_app)):
        before = path.read_text(encoding="utf-8")
        after = patcher(before)
        if after != before:
            path.write_text(after, encoding="utf-8")
            changed.append(str(path.relative_to(BASE)))
    print("Focus-3 Hardening: " + (", ".join(changed) if changed else "bereits aktuell"))


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Apply the final audit fixes for archive filters, purchase inquiries and Rental V2.

This patch is intentionally limited to the classic archive/cart, product pages,
Rental V2 and catalogue taxonomy. Match, Chaos and Baukasten are never touched.
"""
from __future__ import annotations

from pathlib import Path

BASE = Path(__file__).resolve().parents[1]


def read(rel: str) -> str:
    return (BASE / rel).read_text(encoding="utf-8")


def write(rel: str, text: str) -> None:
    (BASE / rel).write_text(text, encoding="utf-8")


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if new in text:
        return text
    if old not in text:
        raise SystemExit(f"FEHLER: erwarteter Block fehlt: {label}")
    return text.replace(old, new, 1)


def replace_between(text: str, start: str, end: str, replacement: str, label: str) -> str:
    if replacement and replacement in text:
        return text
    i = text.find(start)
    if i < 0:
        raise SystemExit(f"FEHLER: Startmarker fehlt: {label}")
    j = text.find(end, i + len(start))
    if j < 0:
        raise SystemExit(f"FEHLER: Endmarker fehlt: {label}")
    return text[:i] + replacement + text[j:]


def patch_app() -> None:
    rel = "assets/app.js"
    text = read(rel)

    # Native iOS <select> ignores hidden options in some Safari versions.
    # Rebuild the option list from a stable master list and DO NOT put zero-hit
    # choices in the DOM at all. This also lets options return when another
    # department/category makes them valid again.
    start = "  function updateFacetSelect(selectEl, facet, labelFn, allLabelKey) {"
    end = "  function refreshFacetOptions() {"
    new = '''  function updateFacetSelect(selectEl, facet, labelFn, allLabelKey) { // AUDIT_PERFECT_NATIVE_FACETS\n    var eligible = PUBLIC_ITEMS.filter(function (it) { return matches(it, facet); });\n    var counts = {};\n    eligible.forEach(function (it) {\n      facetValues(it, facet).forEach(function (value) { counts[value] = (counts[value] || 0) + 1; });\n    });\n\n    if (!selectEl._d119FacetValues) {\n      selectEl._d119FacetValues = Array.prototype.slice.call(selectEl.options, 1).map(function (opt) { return opt.value; });\n    }\n    var selectedValue = selectEl.value;\n    var masterValues = selectEl._d119FacetValues.slice();\n    if (selectEl.options.length) selectEl.options[0].textContent = t(allLabelKey) + " (" + eligible.length + ")";\n    while (selectEl.options.length > 1) selectEl.remove(1);\n\n    masterValues.forEach(function (value) {\n      var count = counts[value] || 0;\n      if (count === 0 && value !== selectedValue) return;\n      var opt = document.createElement("option");\n      opt.value = value;\n      opt.textContent = labelFn(value) + " (" + count + ")";\n      opt.disabled = count === 0;\n      selectEl.appendChild(opt);\n    });\n    if (selectedValue) selectEl.value = selectedValue;\n  }\n\n'''
    if "AUDIT_PERFECT_NATIVE_FACETS" not in text:
        text = replace_between(text, start, end, new, "native zero-hit facets")

    # Purchase inquiries: a zero price means "price on request", never 0,00 €.
    marker = "  function cartTotalDisplay(total, hasUnknownPrice) { // AUDIT_PERFECT_CART_TOTAL"
    if marker not in text:
        anchor = "  function buildOrderText() {"
        helper = '''  function cartTotalDisplay(total, hasUnknownPrice) { // AUDIT_PERFECT_CART_TOTAL\n    if (!hasUnknownPrice) return fmtPrice(total);\n    return LANG === "fr" ? "partiellement sur demande" : LANG === "en" ? "partly on request" : "teilweise auf Anfrage";\n  }\n\n'''
        if anchor not in text:
            raise SystemExit("FEHLER: buildOrderText fehlt")
        text = text.replace(anchor, helper + anchor, 1)

    order_start = text.find("  function buildOrderText() {")
    order_end = text.find("\n  function renderCartDrawer", order_start)
    if order_start < 0 or order_end < 0:
        raise SystemExit("FEHLER: Warenkorb-Anfragetext nicht gefunden")
    order = text[order_start:order_end]
    order = order.replace('      rows.push(fmtPrice(it.price));', '      rows.push(fmtPriceDisplay(it.price));')
    order = order.replace(
        '''    var total = cart.reduce(function (sum, id) {\n      var it = findItem(id);\n      return sum + (it ? it.price : 0);\n    }, 0);''',
        '''    var hasUnknownPrice = cart.some(function (id) {\n      var it = findItem(id);\n      return !!it && !(it.price > 0);\n    });\n    var total = cart.reduce(function (sum, id) {\n      var it = findItem(id);\n      return sum + (it && it.price > 0 ? it.price : 0);\n    }, 0);'''
    )
    order = order.replace('"\\n\\n" + t("cartTotal") + ": " + fmtPrice(total) +', '"\\n\\n" + t("cartTotal") + ": " + cartTotalDisplay(total, hasUnknownPrice) +')
    text = text[:order_start] + order + text[order_end:]

    text = replace_once(
        text,
        '    var total = 0;\n    body.innerHTML = noticeHtml + cart.map(function (id) {',
        '    var total = 0;\n    var hasUnknownPrice = false; // AUDIT_PERFECT_CART_PRICE_REQUEST\n    body.innerHTML = noticeHtml + cart.map(function (id) {',
        "cart unknown-price state",
    )
    text = replace_once(
        text,
        '      total += it.price;',
        '      if (it.price > 0) total += it.price; else hasUnknownPrice = true;',
        "cart total calculation",
    )
    text = replace_once(
        text,
        '\'<span class="cart-line__price">\' + fmtPrice(it.price) + "</span>" +',
        '\'<span class="cart-line__price">\' + fmtPriceDisplay(it.price) + "</span>" +',
        "cart line price display",
    )
    text = replace_once(
        text,
        'var footHtml = \'<div class="cart-total"><span>\' + t("cartTotal") + \'</span><span>\' + fmtPrice(total) + "</span></div>" +',
        'var footHtml = \'<div class="cart-total"><span>\' + t("cartTotal") + \'</span><span>\' + cartTotalDisplay(total, hasUnknownPrice) + "</span></div>" +',
        "cart footer total",
    )

    # Remove the obsolete Single-Rental implementation completely. Rental V2
    # is the only owner of rental state, pricing, terms and submit behavior.
    legacy_start = "  // ---- Verleih-Anfrage (Rental) ----"
    legacy_end = "  // Warenkorb hat eine echte, eigene URL"
    if legacy_start in text:
        text = replace_between(text, legacy_start, legacy_end, "  // Rental V2 ist die einzige Mietarchitektur. // AUDIT_PERFECT_RENTAL_V2_ONLY\n\n", "legacy rental JS")

    # The card button is handled by Rental V2 in capture phase; no second
    # legacy click handler may exist.
    old_listener = '''      var rentalBtn = plate.querySelector("[data-rental]");\n      if (rentalBtn) {\n        rentalBtn.addEventListener("click", function (e) {\n          e.preventDefault();\n          e.stopPropagation();\n          openRentalModal(it.id);\n        });\n      }\n\n'''
    if old_listener in text:
        text = text.replace(old_listener, "", 1)

    # Product-page ?item= deep links are now owned and opened by rental-v2.js.
    deep_start = '    // Deep-Link von einer Produktseite ("...mieten/?item=123", siehe'
    deep_end = '  } else {\n    modeRail.classList.remove("hidden");'
    if deep_start in text:
        i = text.find(deep_start)
        j = text.find(deep_end, i)
        if j < 0:
            raise SystemExit("FEHLER: Legacy-Rental-Deep-Link-Ende fehlt")
        text = text[:i] + '    // ?item= Deep-Links werden ausschliesslich von Rental V2 verarbeitet. // AUDIT_PERFECT_RENTAL_DEEPLINK\n' + text[j:]

    write(rel, text)


def patch_filter_helper() -> None:
    rel = "assets/catalog-filter-simplify.js"
    text = read(rel)
    old = '''      option.hidden = unavailable && option.value !== select.value;\n      if (unavailable && option.value !== select.value) option.disabled = true;'''
    new = '''      // iOS Safari can still display <option hidden>. Remove zero-hit\n      // choices physically; app.js restores them from its stable master list\n      // when they become valid in another context. AUDIT_PERFECT_IOS_ZERO_OPTIONS\n      if (unavailable && option.value !== select.value) {\n        select.remove(i);\n        i--;\n      } else {\n        option.hidden = false;\n        option.disabled = unavailable;\n      }'''
    text = replace_once(text, old, new, "iOS zero-hit option removal")
    write(rel, text)


def patch_article() -> None:
    rel = "assets/article.js"
    text = read(rel)
    text = replace_once(
        text,
        '    rows.push(fmtPrice(IT.price));',
        '    rows.push(IT.price > 0 ? fmtPrice(IT.price) : t("priceOnRequest")); // AUDIT_PERFECT_ARTICLE_PRICE_REQUEST',
        "article inquiry price on request",
    )
    write(rel, text)


def patch_template() -> None:
    rel = "index_template.html"
    text = read(rel)
    start = "<!-- Verleih-Anfrage: ein einziges, wiederverwendbares Modal fuer alle Artikel -"
    end = "<!-- Schwebender Warenkorb-Button statt festem Platz in der Kopfzeile - dort"
    if start in text:
        text = replace_between(text, start, end, "<!-- Rental V2 ist die einzige Mietarchitektur. AUDIT_PERFECT_RENTAL_V2_ONLY -->\n\n", "legacy rental modal")
    write(rel, text)


def patch_rental_v2() -> None:
    rel = "assets/rental-v2.js"
    text = read(rel)
    text = replace_once(
        text,
        '  var availabilityBlocked = false;',
        '  var availabilityBlocked = false;\n  var queryItemRequested = 0; // AUDIT_PERFECT_RENTAL_QUERY_ITEM',
        "Rental V2 query state",
    )
    old = '''  function processQueryItemEarly() {\n    if (!isRentalPage()) return;\n    try {\n      var params = new URLSearchParams(window.location.search);\n      var id = Number(params.get("item"));\n      if (!id) return;\n      if (state.ids.indexOf(id) < 0) state.ids.push(id);\n      saveState();\n      params.delete("item");\n      var query = params.toString();\n      history.replaceState(history.state, "", window.location.pathname + (query ? "?" + query : "") + window.location.hash);\n    } catch (e) {}\n  }'''
    new = '''  function processQueryItemEarly() {\n    if (!isRentalPage()) return;\n    try {\n      var params = new URLSearchParams(window.location.search);\n      var id = Number(params.get("item"));\n      if (!id) return;\n      queryItemRequested = id;\n      if (state.ids.indexOf(id) < 0) state.ids.push(id);\n      saveState();\n      params.delete("item");\n      var query = params.toString();\n      history.replaceState(history.state, "", window.location.pathname + (query ? "?" + query : "") + window.location.hash);\n    } catch (e) {}\n  }'''
    text = replace_once(text, old, new, "Rental V2 query deep-link ownership")
    old_open = '        if (state.ids.length && /[?&]openRental=1(?:&|$)/.test(window.location.search)) openOverlay();'
    new_open = '''        if (queryItemRequested && state.ids.indexOf(queryItemRequested) >= 0) openOverlay();\n        else if (state.ids.length && /[?&]openRental=1(?:&|$)/.test(window.location.search)) openOverlay(); // AUDIT_PERFECT_RENTAL_AUTO_OPEN'''
    text = replace_once(text, old_open, new_open, "Rental V2 deep-link auto-open")
    write(rel, text)


def patch_taxonomy() -> None:
    rel = "scripts/catalog_taxonomy.py"
    text = read(rel)
    # Explicit compound German title whose legacy broad category is Tops but
    # whose title itself proves the more precise type.
    text = replace_once(
        text,
        '    9432: "Underwear Shorts",\n    9490: "Sleepwear",',
        '    9432: "Underwear Shorts",\n    9496: "Polo Shirt",  # title: Dior Herrenpolo Schwarz\n    9490: "Sleepwear",',
        "Dior Herrenpolo override",
    )
    old = '''    # Vague legacy titles are resolved from their full description next.\n    for pattern, product_type in rules:\n        if re.search(pattern, text):\n            return product_type\n\n    fallback = {'''
    new = '''    # Vague titles may use the description only inside the existing broad\n    # category. This prevents incidental words in prose from turning a jacket\n    # into Shorts/Dress, while explicit title rules and reviewed overrides can\n    # still intentionally correct a genuinely wrong legacy category.\n    legacy_category = _clean(item.get("category"))\n    for pattern, product_type in rules:\n        if not re.search(pattern, text):\n            continue\n        inferred_category = PRODUCT_TYPE_CATEGORY.get(product_type)\n        if not legacy_category or inferred_category == legacy_category:\n            return product_type\n\n    fallback = {'''
    text = replace_once(text, old, new, "taxonomy description category guard")
    write(rel, text)


def main() -> None:
    patch_app()
    patch_filter_helper()
    patch_article()
    patch_template()
    patch_rental_v2()
    patch_taxonomy()
    print("Audit-Perfection angewendet: native Zero-Facets, Kaufanfragen, Rental V2 und Taxonomie bereinigt.")


if __name__ == "__main__":
    main()

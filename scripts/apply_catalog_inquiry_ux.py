#!/usr/bin/env python3
"""Apply the customer-facing catalog/inquiry cleanup deterministically.

The migration is deliberately limited to archive catalogue, product inquiry and
rental UI code. Pricing/deposit constants and the protected discovery modes are
not modified here.
"""
from pathlib import Path

BASE = Path(__file__).resolve().parents[1]


def patch(path: str, old: str, new: str, marker: str) -> None:
    target = BASE / path
    text = target.read_text(encoding="utf-8")
    if marker in text:
        return
    if old not in text:
        raise SystemExit(f"FEHLER: erwarteter Quellblock fehlt in {path}: {marker}")
    target.write_text(text.replace(old, new, 1), encoding="utf-8")
    print(f"aktualisiert: {path} -> {marker}")


def patch_app() -> None:
    path = "assets/app.js"
    patch(
        path,
        '''      var hay = [\n        it.title, it.brand, browseCategory, it.product_type, it.department,\n        it.size, it.size_normalized\n      ].map(normalizeText).join(" ");''',
        '''      var hay = [\n        it.title, it.brand, browseCategory, it.product_type, it.department,\n        it.size, it.size_normalized, it.article, String(it.id || "")\n      ].map(normalizeText).join(" ");''',
        'it.size_normalized, it.article, String(it.id || "")',
    )

    patch(
        path,
        '''  function sortItems(list) {''',
        '''  // Kleine, untergeordnete Groessenangabe fuer Archivkarten. Bei\n  // Schuhgroessen wird eine rein numerische Angabe als EU-Groesse kenntlich\n  // gemacht; freie/mehrteilige Groessen bleiben vollstaendig lesbar.\n  function cardSizeLabel(it) {\n    var raw = trSize(it.size_normalized || it.size || "").trim();\n    if (!raw) return "";\n    var browseCategory = it.taxonomy_category || it.category;\n    if (browseCategory === "Shoes" && /^\\d+(?:[.,]\\d+)?$/.test(raw)) return "EU " + raw;\n    return raw;\n  }\n\n  function sortItems(list) {''',
        "function cardSizeLabel(it)",
    )

    patch(
        path,
        '''          '<span class="plate__title">' + escapeHtml(it.title) + "</span>" +\n          '<div class="plate__row">' +''',
        '''          '<span class="plate__title">' + escapeHtml(it.title) + "</span>" +\n          (cardSizeLabel(it) ? '<span class="plate__size">' + escapeHtml(cardSizeLabel(it)) + "</span>" : "") +\n          '<div class="plate__row">' +''',
        'class="plate__size"',
    )

    patch(
        path,
        '''      if (it.size) rows.push(t("factSize") + ": " + trSize(it.size));\n      rows.push(fmtPrice(it.price));\n      return rows.join("\\n");''',
        '''      if (it.size) rows.push(t("factSize") + ": " + trSize(it.size));\n      rows.push(fmtPrice(it.price));\n      rows.push("URL: " + location.origin + langHome(LANG) + "artikel/" + it.id + "/");\n      return rows.join("\\n");''',
        'rows.push("URL: " + location.origin + langHome(LANG) + "artikel/" + it.id + "/")',
    )

    patch(
        path,
        '''      "\\n\\n" + t("cartTotal") + ": " + fmtPrice(total) +\n      "\\n\\n" + t("orderAvailQuestion");''',
        '''      "\\n\\n" + t("cartTotal") + ": " + fmtPrice(total) +\n      "\\n" + (LANG === "de" ? "Zeitpunkt" : LANG === "fr" ? "Horodatage" : "Timestamp") + ": " + new Date().toLocaleString() +\n      "\\n\\n" + t("orderAvailQuestion");''',
        'LANG === "de" ? "Zeitpunkt" : LANG === "fr" ? "Horodatage" : "Timestamp"',
    )


def patch_build_site() -> None:
    path = "build_site.py"
    patch(
        path,
        '''    art_no = it.get("article") or str(it["id"])\n    out.append(\n        '<div><div class="fact__label" data-i18n="factArticleNo">' + esc(labels["article"]) + "</div>"\n        '<div class="fact__value">' + esc(art_no) + "</div></div>"\n    )\n    return "".join(out)''',
        '''    # Interne Artikelnummern bleiben in ARTICLE_ITEM/Anfragen erhalten,\n    # werden aber nicht als sichtbarer Produkt-Fakt an Kundschaft ausgegeben.\n    return "".join(out)''',
        "Interne Artikelnummern bleiben in ARTICLE_ITEM/Anfragen erhalten",
    )


def patch_article() -> None:
    path = "assets/article.js"
    patch(
        path,
        '''    if (IT.size) rows.push(t("factSize") + ": " + trSize(IT.size));\n    rows.push(fmtPrice(IT.price));\n    return t("orderGreeting") + "\\n\\n" + rows.join("\\n") + "\\n\\n" + t("orderAvailQuestion");''',
        '''    if (IT.size) rows.push(t("factSize") + ": " + trSize(IT.size));\n    rows.push(fmtPrice(IT.price));\n    rows.push("URL: " + window.location.href.split("?")[0].split("#")[0]);\n    rows.push((LANG === "de" ? "Zeitpunkt" : LANG === "fr" ? "Horodatage" : "Timestamp") + ": " + new Date().toLocaleString());\n    return t("orderGreeting") + "\\n\\n" + rows.join("\\n") + "\\n\\n" + t("orderAvailQuestion");''',
        'rows.push("URL: " + window.location.href.split("?")[0].split("#")[0])',
    )


def patch_rental_v2() -> None:
    path = "assets/rental-v2.js"
    patch(
        path,
        '''      '<div class="d119-rental-item__meta"><strong>' + esc(title) + '</strong><span>Art.-Nr. ' + esc(item.article || item.id) + '</span>' +\n      '<span>' + esc(daily === null ? t("onRequest") : fmt(t("daily"), { price: money(daily) })) + '</span>' +''',
        '''      '<div class="d119-rental-item__meta"><strong>' + esc(title) + '</strong>' +\n      (item.size ? '<span>' + esc((LANG === "de" ? "Größe: " : LANG === "fr" ? "Taille : " : "Size: ") + item.size) + '</span>' : '') +\n      '<span>' + esc(daily === null ? t("onRequest") : fmt(t("daily"), { price: money(daily) })) + '</span>' +''',
        'LANG === "de" ? "Größe: " : LANG === "fr" ? "Taille : " : "Size: "',
    )

    patch(
        path,
        '''      lines.push("   Art.-Nr.: " + (item.article || item.id));\n      lines.push("   " + t("rent") + ": " + (rent === null ? t("onRequest") : money(rent)) + (daily === null ? "" : " (" + money(daily) + " / " + (LANG === "de" ? "Tag" : LANG === "fr" ? "jour" : "day") + ")"));''',
        '''      lines.push("   Art.-Nr.: " + (item.article || item.id));\n      lines.push("   URL: " + window.location.origin + HOME + "artikel/" + item.id + "/");\n      lines.push("   " + t("rent") + ": " + (rent === null ? t("onRequest") : money(rent)) + (daily === null ? "" : " (" + money(daily) + " / " + (LANG === "de" ? "Tag" : LANG === "fr" ? "jour" : "day") + ")"));''',
        'lines.push("   URL: " + window.location.origin + HOME + "artikel/" + item.id + "/")',
    )

    patch(
        path,
        '''    lines.push(t("termsVersion") + ": " + TERMS_VERSION + " · " + LANG);''',
        '''    lines.push((LANG === "de" ? "Zeitpunkt" : LANG === "fr" ? "Horodatage" : "Timestamp") + ": " + new Date().toLocaleString());\n    lines.push(t("termsVersion") + ": " + TERMS_VERSION + " · " + LANG);''',
        '"Horodatage" : "Timestamp") + ": " + new Date().toLocaleString()',
    )


def patch_rental_picker() -> None:
    path = "assets/rental-v2-picker.js"
    patch(path, 'search: "Marke, Artikel oder Artikelnummer suchen …"', 'search: "Marke, Artikel oder Größe suchen …"', 'search: "Marke, Artikel oder Größe suchen …"')
    patch(path, 'search: "Search brand, item or article number …"', 'search: "Search brand, item or size …"', 'search: "Search brand, item or size …"')
    patch(path, 'search: "Rechercher une marque, une pièce ou un numéro …"', 'search: "Rechercher une marque, une pièce ou une taille …"', 'search: "Rechercher une marque, une pièce ou une taille …"')

    patch(
        path,
        '''      return normalize([item.brand, item.title, item.article, item.category, item.size].join(" ")).indexOf(q) >= 0;''',
        '''      return normalize([item.brand, item.title, item.article, item.id, item.category, item.size].join(" ")).indexOf(q) >= 0;''',
        "item.article, item.id, item.category",
    )

    patch(
        path,
        '''    if (item.size) meta.push(fmt(t("size"), { size: item.size }));\n    if (item.category) meta.push(item.category);''',
        '''    if (item.size) meta.push(fmt(t("size"), { size: item.size }));''',
        'var meta = [];\n    if (item.size) meta.push(fmt(t("size"), { size: item.size }));\n    return',
    )


def main() -> None:
    patch_app()
    patch_build_site()
    patch_article()
    patch_rental_v2()
    patch_rental_picker()
    print("Catalog/Inquiry UX-Migration abgeschlossen.")


if __name__ == "__main__":
    main()

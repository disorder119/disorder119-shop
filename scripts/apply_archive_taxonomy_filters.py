#!/usr/bin/env python3
"""Apply browse-only taxonomy filters to the public archive UI.

The creative Match / Chaos / Baukasten blocks are deliberately not touched.
This script is idempotent so CI can safely run it on every rebuild.  It upgrades
only the classic archive browsing/filtering code to consume the reviewed
``department``, ``product_type``, ``taxonomy_category`` and ``size_normalized``
fields that already exist in ``data/catalog.json``.
"""
from __future__ import annotations

from pathlib import Path

BASE = Path(__file__).resolve().parents[1]
TEMPLATE = BASE / "index_template.html"
APP_JS = BASE / "assets" / "app.js"


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if new in text:
        return text
    if old not in text:
        raise SystemExit(f"FEHLER: Archiv-Taxonomie-Patchmarker fehlt: {label}")
    return text.replace(old, new, 1)


def patch_template(text: str) -> str:
    old = '''    <div class="filter-field">\n      <label data-i18n="filterBrandLabel">Marke</label>\n      <select id="filterBrand"><option value="" data-i18n="filterAllBrands">Alle Marken</option></select>\n    </div>'''
    new = '''    <div class="filter-field">\n      <label data-i18n="filterDepartmentLabel">Bereich</label>\n      <select id="filterDepartment"><option value="" data-i18n="filterAllDepartments">Alle Bereiche</option></select>\n    </div>\n    <div class="filter-field">\n      <label data-i18n="filterProductTypeLabel">Produkttyp</label>\n      <select id="filterProductType"><option value="" data-i18n="filterAllProductTypes">Alle Produkttypen</option></select>\n    </div>\n''' + old
    return replace_once(text, old, new, "Filterfelder")


def patch_app(text: str) -> str:
    # I18N: only the classic archive filter panel gets new labels.
    text = replace_once(
        text,
        '''      moreFilters: "Weitere Filter",\n      filterBrandLabel: "Marke", filterAllBrands: "Alle Marken",''',
        '''      moreFilters: "Weitere Filter",\n      filterDepartmentLabel: "Bereich", filterAllDepartments: "Alle Bereiche",\n      filterProductTypeLabel: "Produkttyp", filterAllProductTypes: "Alle Produkttypen",\n      filterBrandLabel: "Marke", filterAllBrands: "Alle Marken",''',
        "DE Filtertexte",
    )
    text = replace_once(
        text,
        '''      moreFilters: "More filters",\n      filterBrandLabel: "Brand", filterAllBrands: "All brands",''',
        '''      moreFilters: "More filters",\n      filterDepartmentLabel: "Department", filterAllDepartments: "All departments",\n      filterProductTypeLabel: "Product type", filterAllProductTypes: "All product types",\n      filterBrandLabel: "Brand", filterAllBrands: "All brands",''',
        "EN Filtertexte",
    )
    text = replace_once(
        text,
        '''      moreFilters: "Plus de filtres",\n      filterBrandLabel: "Marque", filterAllBrands: "Toutes les marques",''',
        '''      moreFilters: "Plus de filtres",\n      filterDepartmentLabel: "Rayon", filterAllDepartments: "Tous les rayons",\n      filterProductTypeLabel: "Type de produit", filterAllProductTypes: "Tous les types",\n      filterBrandLabel: "Marque", filterAllBrands: "Toutes les marques",''',
        "FR Filtertexte",
    )

    # Human-readable taxonomy labels for the new selects. There is no Kids
    # option by design; factual child-size strings remain in the raw size data.
    anchor = '''  var CONDITION_MAP_DE_TO_KEY = {\n    "Repariert": "condRepariert", "Mit Defekt": "condDefekt",\n    "Gut": "condGut", "Sehr gut": "condSehrGut", "Zufriedenstellend": "condZufriedenstellend"\n  };'''
    addition = anchor + '''\n  var DEPARTMENT_LABELS = {\n    Women: { de: "Damen", en: "Women", fr: "Femme" },\n    Men: { de: "Herren", en: "Men", fr: "Homme" },\n    Unisex: { de: "Unisex", en: "Unisex", fr: "Unisexe" },\n    Objects: { de: "Objekte", en: "Objects", fr: "Objets" }\n  };\n  var PRODUCT_TYPE_LABELS = {\n    "Accessory": { de: "Accessoire", fr: "Accessoire" },\n    "Backpack": { de: "Rucksack", fr: "Sac à dos" },\n    "Bag": { de: "Tasche", fr: "Sac" },\n    "Beanie": { de: "Mütze / Beanie", fr: "Bonnet" },\n    "Belt": { de: "Gürtel", fr: "Ceinture" },\n    "Biker Jacket": { de: "Bikerjacke", fr: "Veste biker" },\n    "Blazer": { de: "Blazer", fr: "Blazer" },\n    "Blouse": { de: "Bluse", fr: "Blouse" },\n    "Bomber Jacket": { de: "Bomberjacke", fr: "Bomber" },\n    "Boots": { de: "Stiefel / Boots", fr: "Bottes" },\n    "Cap": { de: "Cap", fr: "Casquette" },\n    "Cardigan": { de: "Cardigan / Strickjacke", fr: "Cardigan" },\n    "Coat": { de: "Mantel", fr: "Manteau" },\n    "Design Object": { de: "Designobjekt", fr: "Objet design" },\n    "Dress": { de: "Kleid", fr: "Robe" },\n    "Hat": { de: "Hut", fr: "Chapeau" },\n    "Heels": { de: "Heels / Absatzschuhe", fr: "Chaussures à talons" },\n    "Jacket": { de: "Jacke", fr: "Veste" },\n    "Joggers": { de: "Jogginghose", fr: "Jogging" },\n    "Knit Top": { de: "Stricktop", fr: "Haut en maille" },\n    "Loafers": { de: "Loafer", fr: "Mocassins" },\n    "Long Sleeve": { de: "Longsleeve", fr: "Manches longues" },\n    "Polo Shirt": { de: "Poloshirt", fr: "Polo" },\n    "Sandals": { de: "Sandalen", fr: "Sandales" },\n    "Scarf": { de: "Schal", fr: "Écharpe" },\n    "Set": { de: "Set", fr: "Ensemble" },\n    "Shirt": { de: "Hemd / Shirt", fr: "Chemise" },\n    "Shoes": { de: "Schuhe", fr: "Chaussures" },\n    "Shorts": { de: "Shorts", fr: "Short" },\n    "Skirt": { de: "Rock", fr: "Jupe" },\n    "Sleepwear": { de: "Schlafanzug / Sleepwear", fr: "Vêtement de nuit" },\n    "Sneakers": { de: "Sneaker", fr: "Baskets" },\n    "Suit": { de: "Anzug", fr: "Costume" },\n    "Sunglasses": { de: "Sonnenbrille", fr: "Lunettes de soleil" },\n    "Sweater": { de: "Pullover", fr: "Pull" },\n    "Sweatshirt": { de: "Sweatshirt", fr: "Sweatshirt" },\n    "Swim Shorts": { de: "Badeshorts", fr: "Short de bain" },\n    "T-Shirt": { de: "T-Shirt", fr: "T-shirt" },\n    "Tank Top": { de: "Tanktop", fr: "Débardeur" },\n    "Toaster": { de: "Toaster / Designobjekt", fr: "Grille-pain / objet design" },\n    "Top": { de: "Top", fr: "Haut" },\n    "Trench Coat": { de: "Trenchcoat", fr: "Trench" },\n    "Trousers": { de: "Hose", fr: "Pantalon" },\n    "Tunic": { de: "Tunika", fr: "Tunique" },\n    "Underwear Shorts": { de: "Unterwäsche-Shorts", fr: "Sous-vêtement" },\n    "Vest": { de: "Weste", fr: "Gilet" },\n    "Wallet": { de: "Wallet / Geldbörse", fr: "Portefeuille" }\n  };'''
    text = replace_once(text, anchor, addition, "Taxonomie-Übersetzungen")

    old = '''  function trCategory(cat) { var k = CATEGORY_MAP_DE_TO_KEY[cat]; return k ? t(k) : (cat || ""); }\n  function trCondition(cond) { var k = CONDITION_MAP_DE_TO_KEY[cond]; return k ? t(k) : (cond || ""); }\n  function trSize(size) { var k = SIZE_MAP_DE_TO_KEY[size]; return k ? t(k) : (size || ""); }'''
    new = '''  function trCategory(cat) { var k = CATEGORY_MAP_DE_TO_KEY[cat]; return k ? t(k) : (cat || ""); }\n  function trDepartment(department) {\n    var labels = DEPARTMENT_LABELS[department];\n    return labels ? (labels[LANG] || labels.en || department) : (department || "");\n  }\n  function trProductType(productType) {\n    if (!productType) return "";\n    if (LANG === "en") return productType;\n    var labels = PRODUCT_TYPE_LABELS[productType];\n    return labels ? (labels[LANG] || productType) : productType;\n  }\n  function trCondition(cond) { var k = CONDITION_MAP_DE_TO_KEY[cond]; return k ? t(k) : (cond || ""); }\n  function trSize(size) { var k = SIZE_MAP_DE_TO_KEY[size]; return k ? t(k) : (size || ""); }'''
    text = replace_once(text, old, new, "Taxonomie-Übersetzungsfunktionen")

    text = replace_once(
        text,
        '''    sort: "brightness",\n    brand: "",\n    size: "",''',
        '''    sort: "brightness",\n    department: "",\n    productType: "",\n    brand: "",\n    size: "",''',
        "Filter-State",
    )

    old = '''  var categories = {};\n  PUBLIC_ITEMS.forEach(function (it) {\n    if (it.category) categories[it.category] = (categories[it.category] || 0) + 1;\n  });'''
    new = '''  var categories = {};\n  PUBLIC_ITEMS.forEach(function (it) {\n    var browseCategory = it.taxonomy_category || it.category;\n    if (browseCategory) categories[browseCategory] = (categories[browseCategory] || 0) + 1;\n  });'''
    text = replace_once(text, old, new, "Kategorie-Chips aus Taxonomie")

    text = replace_once(
        text,
        '''  // ---- Weitere Filter: Marke, Groesse, Farbe, Zustand, Preis ----''',
        '''  // ---- Weitere Filter: Bereich, Produkttyp, Marke, Groesse, Farbe, Zustand, Preis ----''',
        "Filter-Kommentar",
    )

    old = '''  var filterBrandEl = document.getElementById("filterBrand");\n  var filterSizeEl = document.getElementById("filterSize");'''
    new = '''  var filterDepartmentEl = document.getElementById("filterDepartment");\n  var filterProductTypeEl = document.getElementById("filterProductType");\n  var filterBrandEl = document.getElementById("filterBrand");\n  var filterSizeEl = document.getElementById("filterSize");'''
    text = replace_once(text, old, new, "Filter DOM-Referenzen")

    old = '''  var brandList = Object.keys(brandsSet).sort(function (a, b) { return a.localeCompare(b, "de"); });\n  fillSelect(filterBrandEl, brandList);\n\n  var sizeSet = {};\n  PUBLIC_ITEMS.forEach(function (it) { if (it.size) sizeSet[it.size] = true; });\n  fillSelect(filterSizeEl, Object.keys(sizeSet).sort(function (a, b) { return a.localeCompare(b, "de", { numeric: true }); }), trSize);'''
    new = '''  var departmentSet = {};\n  var productTypeSet = {};\n  PUBLIC_ITEMS.forEach(function (it) {\n    if (it.department) departmentSet[it.department] = true;\n    if (it.product_type) productTypeSet[it.product_type] = true;\n  });\n  ["Women", "Men", "Unisex", "Objects"].forEach(function (department) {\n    if (departmentSet[department]) fillSelect(filterDepartmentEl, [department], trDepartment);\n  });\n  fillSelect(\n    filterProductTypeEl,\n    Object.keys(productTypeSet).sort(function (a, b) { return trProductType(a).localeCompare(trProductType(b), LANG); }),\n    trProductType\n  );\n\n  var brandList = Object.keys(brandsSet).sort(function (a, b) { return a.localeCompare(b, "de"); });\n  fillSelect(filterBrandEl, brandList);\n\n  var sizeSet = {};\n  PUBLIC_ITEMS.forEach(function (it) {\n    if (it.size_normalized && it.size_normalized !== "Unknown") sizeSet[it.size_normalized] = true;\n  });\n  fillSelect(filterSizeEl, Object.keys(sizeSet).sort(function (a, b) { return a.localeCompare(b, "de", { numeric: true }); }), trSize);'''
    text = replace_once(text, old, new, "Filteroptionen")

    old = '''  filterBrandEl.addEventListener("change", function () { state.brand = filterBrandEl.value; render(); });\n  filterSizeEl.addEventListener("change", function () { state.size = filterSizeEl.value; render(); });'''
    new = '''  filterDepartmentEl.addEventListener("change", function () { state.department = filterDepartmentEl.value; render(); });\n  filterProductTypeEl.addEventListener("change", function () { state.productType = filterProductTypeEl.value; render(); });\n  filterBrandEl.addEventListener("change", function () { state.brand = filterBrandEl.value; render(); });\n  filterSizeEl.addEventListener("change", function () { state.size = filterSizeEl.value; render(); });'''
    text = replace_once(text, old, new, "Filter Events")

    old = '''    state.brand = ""; state.size = ""; state.color = ""; state.condition = "";\n    state.priceMin = null; state.priceMax = null;\n    state.categoryGroup = null;    filterBrandEl.value = ""; filterSizeEl.value = ""; filterColorEl.value = ""; filterConditionEl.value = "";'''
    new = '''    state.department = ""; state.productType = ""; state.brand = ""; state.size = ""; state.color = ""; state.condition = "";\n    state.priceMin = null; state.priceMax = null;\n    state.categoryGroup = null;\n    filterDepartmentEl.value = ""; filterProductTypeEl.value = ""; filterBrandEl.value = ""; filterSizeEl.value = ""; filterColorEl.value = ""; filterConditionEl.value = "";'''
    text = replace_once(text, old, new, "Filter Reset Button")

    old = '''    if (state.brand && it.brand !== state.brand) return false;\n    if (state.size && it.size !== state.size) return false;'''
    new = '''    if (state.department && it.department !== state.department) return false;\n    if (state.productType && it.product_type !== state.productType) return false;\n    if (state.brand && it.brand !== state.brand) return false;\n    if (state.size && it.size_normalized !== state.size) return false;'''
    text = replace_once(text, old, new, "Taxonomie Filter-Matches")

    old = '''    if (state.categoryGroup && state.categoryGroup.indexOf(it.category) === -1) return false;\n    if (state.category !== "all" && it.category !== state.category) return false;\n    if (state.query) {\n      var hay = normalizeText(it.title) + " " + normalizeText(it.brand) + " " + normalizeText(it.category);'''
    new = '''    var browseCategory = it.taxonomy_category || it.category;\n    if (state.categoryGroup && state.categoryGroup.indexOf(browseCategory) === -1) return false;\n    if (state.category !== "all" && browseCategory !== state.category) return false;\n    if (state.query) {\n      var hay = [\n        it.title, it.brand, browseCategory, it.product_type, it.department,\n        it.size, it.size_normalized\n      ].map(normalizeText).join(" ");'''
    text = replace_once(text, old, new, "Kategorien und Suche aus Taxonomie")

    old = '''      state.query, state.status, state.category, state.categoryGroup,\n      state.sort, state.brand, state.size, state.color,\n      state.condition, state.priceMin, state.priceMax'''
    new = '''      state.query, state.status, state.category, state.categoryGroup,\n      state.sort, state.department, state.productType, state.brand, state.size, state.color,\n      state.condition, state.priceMin, state.priceMax'''
    text = replace_once(text, old, new, "Filter-Signatur")

    # Brand clicks and menu category changes must clear the added filters too.
    old = '''    state.brand = ""; state.size = ""; state.color = ""; state.condition = "";\n    state.priceMin = null; state.priceMax = null;\n    if (filterBrandEl) filterBrandEl.value = "";'''
    new = '''    state.department = ""; state.productType = ""; state.brand = ""; state.size = ""; state.color = ""; state.condition = "";\n    state.priceMin = null; state.priceMax = null;\n    if (filterDepartmentEl) filterDepartmentEl.value = "";\n    if (filterProductTypeEl) filterProductTypeEl.value = "";\n    if (filterBrandEl) filterBrandEl.value = "";'''
    text = replace_once(text, old, new, "Markenfilter Reset")

    old = '''  function resetCatalogFilters() {\n    state.brand = ""; state.size = ""; state.color = ""; state.condition = "";\n    state.priceMin = null; state.priceMax = null;\n    filterBrandEl.value = ""; filterSizeEl.value = ""; filterColorEl.value = ""; filterConditionEl.value = "";'''
    new = '''  function resetCatalogFilters() {\n    state.department = ""; state.productType = ""; state.brand = ""; state.size = ""; state.color = ""; state.condition = "";\n    state.priceMin = null; state.priceMax = null;\n    filterDepartmentEl.value = ""; filterProductTypeEl.value = ""; filterBrandEl.value = ""; filterSizeEl.value = ""; filterColorEl.value = ""; filterConditionEl.value = "";'''
    text = replace_once(text, old, new, "Menüfilter Reset")

    return text


def main() -> None:
    template_before = TEMPLATE.read_text(encoding="utf-8")
    app_before = APP_JS.read_text(encoding="utf-8")

    template_after = patch_template(template_before)
    app_after = patch_app(app_before)

    if template_after != template_before:
        TEMPLATE.write_text(template_after, encoding="utf-8")
    if app_after != app_before:
        APP_JS.write_text(app_after, encoding="utf-8")

    print(
        "Archiv-Taxonomie-Filter: OK – Bereich/Produkttyp, geprüfte Kategorie "
        "und normalisierte Größe werden im klassischen Archiv verwendet."
    )


if __name__ == "__main__":
    main()

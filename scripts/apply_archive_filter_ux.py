#!/usr/bin/env python3
"""Improve the classic archive filter UX without touching protected modes.

This patch runs after ``apply_archive_taxonomy_filters.py``. It is deliberately
limited to the normal archive filter rail: active-filter pills, result counts,
zero-result option disabling and accessible labels. Match, Chaos and Baukasten
HTML/JS blocks are outside every patch marker.
"""
from __future__ import annotations

from pathlib import Path

BASE = Path(__file__).resolve().parents[1]
TEMPLATE = BASE / "index_template.html"
APP_JS = BASE / "assets" / "app.js"
APP_CSS = BASE / "assets" / "app.css"


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if new in text:
        return text
    if old not in text:
        raise SystemExit(f"FEHLER: Archiv-Filter-UX Patchmarker fehlt: {label}")
    return text.replace(old, new, 1)


def patch_template(text: str) -> str:
    replacements = {
        '<label data-i18n="filterDepartmentLabel">Bereich</label>': '<label for="filterDepartment" data-i18n="filterDepartmentLabel">Bereich</label>',
        '<label data-i18n="filterProductTypeLabel">Produkttyp</label>': '<label for="filterProductType" data-i18n="filterProductTypeLabel">Produkttyp</label>',
        '<label data-i18n="filterBrandLabel">Marke</label>': '<label for="filterBrand" data-i18n="filterBrandLabel">Marke</label>',
        '<label data-i18n="filterSizeLabel">Größe</label>': '<label for="filterSize" data-i18n="filterSizeLabel">Größe</label>',
        '<label data-i18n="filterColorLabel">Farbe</label>': '<label for="filterColor" data-i18n="filterColorLabel">Farbe</label>',
        '<label data-i18n="filterConditionLabel">Zustand</label>': '<label for="filterCondition" data-i18n="filterConditionLabel">Zustand</label>',
    }
    for old, new in replacements.items():
        text = replace_once(text, old, new, f"Label {old}")

    old = '''    <button type="button" class="filter-reset" id="filterReset" data-i18n="filterResetLabel">Filter zurücksetzen</button>\n  </div>\n</div>\n\n<div class="grid-wrap">'''
    new = '''    <button type="button" class="filter-reset" id="filterReset" data-i18n="filterResetLabel">Filter zurücksetzen</button>\n  </div>\n  <div class="active-filter-row hidden" id="activeFilters" aria-live="polite" aria-label="Aktive Filter"></div>\n</div>\n\n<div class="grid-wrap">'''
    return replace_once(text, old, new, "Aktive Filterzeile")


def patch_css(text: str) -> str:
    old = '''  .filter-reset:hover { color: var(--accent-text); }'''
    new = '''  .filter-reset:hover { color: var(--accent-text); }\n\n  /* Aktive Filter bleiben auch bei eingeklapptem Filterpanel sichtbar.\n     Ausschliesslich Teil des klassischen Archiv-Rails; geschuetzte Modi\n     verwenden diese Elemente nicht. */\n  .active-filter-row {\n    flex: 1 0 100%;\n    display: flex;\n    align-items: center;\n    gap: 8px;\n    flex-wrap: wrap;\n    min-width: 0;\n  }\n  .active-filter-row.hidden { display: none; }\n  .active-filter-row .chip {\n    text-transform: none;\n    letter-spacing: 0.02em;\n    font-size: 0.68rem;\n    padding: 5px 9px;\n  }\n  .active-filter-clear {\n    border: 0;\n    background: transparent;\n    color: var(--text-muted);\n    font: inherit;\n    font-size: 0.68rem;\n    text-decoration: underline;\n    cursor: pointer;\n    padding: 5px 2px;\n  }\n  .active-filter-clear:hover { color: var(--accent-text); }\n  .filter-field select option:disabled { color: var(--text-faint); }'''
    return replace_once(text, old, new, "Aktive Filter CSS")


def patch_app(text: str) -> str:
    # Small translation surface for removable active-filter pills.
    text = replace_once(
        text,
        '''      filterPriceLabel: "Preis (€)", filterPriceFrom: "von", filterPriceTo: "bis",\n      filterResetLabel: "Filter zurücksetzen",''',
        '''      filterPriceLabel: "Preis (€)", filterPriceFrom: "von", filterPriceTo: "bis",\n      filterResetLabel: "Filter zurücksetzen",\n      activeFilterDepartment: "Bereich", activeFilterProductType: "Produkttyp",\n      activeFilterBrand: "Marke", activeFilterSize: "Größe", activeFilterColor: "Farbe",\n      activeFilterCondition: "Zustand", activeFilterPrice: "Preis", activeFilterCategory: "Kategorie",\n      activeFilterStatus: "Status", activeFilterClear: "Alle Filter löschen",''',
        "DE aktive Filtertexte",
    )
    text = replace_once(
        text,
        '''      filterPriceLabel: "Price (€)", filterPriceFrom: "from", filterPriceTo: "to",\n      filterResetLabel: "Reset filters",''',
        '''      filterPriceLabel: "Price (€)", filterPriceFrom: "from", filterPriceTo: "to",\n      filterResetLabel: "Reset filters",\n      activeFilterDepartment: "Department", activeFilterProductType: "Product type",\n      activeFilterBrand: "Brand", activeFilterSize: "Size", activeFilterColor: "Colour",\n      activeFilterCondition: "Condition", activeFilterPrice: "Price", activeFilterCategory: "Category",\n      activeFilterStatus: "Status", activeFilterClear: "Clear all filters",''',
        "EN aktive Filtertexte",
    )
    text = replace_once(
        text,
        '''      filterPriceLabel: "Prix (€)", filterPriceFrom: "de", filterPriceTo: "à",\n      filterResetLabel: "Réinitialiser les filtres",''',
        '''      filterPriceLabel: "Prix (€)", filterPriceFrom: "de", filterPriceTo: "à",\n      filterResetLabel: "Réinitialiser les filtres",\n      activeFilterDepartment: "Rayon", activeFilterProductType: "Type de produit",\n      activeFilterBrand: "Marque", activeFilterSize: "Taille", activeFilterColor: "Couleur",\n      activeFilterCondition: "État", activeFilterPrice: "Prix", activeFilterCategory: "Catégorie",\n      activeFilterStatus: "Statut", activeFilterClear: "Effacer tous les filtres",''',
        "FR aktive Filtertexte",
    )

    text = replace_once(
        text,
        '''  var filterPanel = document.getElementById("filterPanel");\n  var moreFiltersToggle = document.getElementById("moreFiltersToggle");''',
        '''  var filterPanel = document.getElementById("filterPanel");\n  var activeFiltersEl = document.getElementById("activeFilters");\n  var moreFiltersToggle = document.getElementById("moreFiltersToggle");''',
        "Aktive Filter DOM-Referenz",
    )

    # Make the main matcher reusable for faceted result counts. Each select is
    # counted with only its own current value ignored, so impossible options
    # can be disabled without hiding valid alternatives.
    text = replace_once(text, '  function matches(it) {', '  function matches(it, ignoreFacet) {', "matches Signatur")
    replacements = {
        '    if (state.department && it.department !== state.department) return false;': '    if (ignoreFacet !== "department" && state.department && it.department !== state.department) return false;',
        '    if (state.productType && it.product_type !== state.productType) return false;': '    if (ignoreFacet !== "productType" && state.productType && it.product_type !== state.productType) return false;',
        '    if (state.brand && it.brand !== state.brand) return false;': '    if (ignoreFacet !== "brand" && state.brand && it.brand !== state.brand) return false;',
        '    if (state.size && it.size_normalized !== state.size) return false;': '    if (ignoreFacet !== "size" && state.size && it.size_normalized !== state.size) return false;',
        '    if (state.condition && it.condition !== state.condition) return false;': '    if (ignoreFacet !== "condition" && state.condition && it.condition !== state.condition) return false;',
        '    if (state.color) {': '    if (ignoreFacet !== "color" && state.color) {',
        '    if (state.priceMin != null && !(it.price >= state.priceMin)) return false;\n    if (state.priceMax != null && !(it.price > 0 && it.price <= state.priceMax)) return false;': '    if (ignoreFacet !== "price" && state.priceMin != null && !(it.price >= state.priceMin)) return false;\n    if (ignoreFacet !== "price" && state.priceMax != null && !(it.price > 0 && it.price <= state.priceMax)) return false;',
    }
    for old, new in replacements.items():
        text = replace_once(text, old, new, f"Facet matcher {old[:24]}")

    # Insert the facet-count and active-pill logic after the price listeners and
    # before the existing global reset handler.
    anchor = '''  filterPriceMaxEl.addEventListener("input", function () {\n    state.priceMax = filterPriceMaxEl.value === "" ? null : Number(filterPriceMaxEl.value);\n    render();\n  });\n\n  document.getElementById("filterReset").addEventListener("click", function () {'''
    addition = '''  filterPriceMaxEl.addEventListener("input", function () {\n    state.priceMax = filterPriceMaxEl.value === "" ? null : Number(filterPriceMaxEl.value);\n    render();\n  });\n\n  function facetValues(it, facet) {\n    if (facet === "department") return it.department ? [it.department] : [];\n    if (facet === "productType") return it.product_type ? [it.product_type] : [];\n    if (facet === "brand") return it.brand ? [it.brand] : [];\n    if (facet === "size") return it.size_normalized && it.size_normalized !== "Unknown" ? [it.size_normalized] : [];\n    if (facet === "condition") return it.condition ? [it.condition] : [];\n    if (facet === "color") return (it.color || "").split(",").map(function (c) { return c.trim(); }).filter(Boolean);\n    return [];\n  }\n\n  function updateFacetSelect(selectEl, facet, labelFn, allLabelKey) {\n    var eligible = PUBLIC_ITEMS.filter(function (it) { return matches(it, facet); });\n    var counts = {};\n    eligible.forEach(function (it) {\n      facetValues(it, facet).forEach(function (value) { counts[value] = (counts[value] || 0) + 1; });\n    });\n    if (selectEl.options.length) selectEl.options[0].textContent = t(allLabelKey) + " (" + eligible.length + ")";\n    for (var i = 1; i < selectEl.options.length; i++) {\n      var opt = selectEl.options[i];\n      var count = counts[opt.value] || 0;\n      opt.textContent = labelFn(opt.value) + " (" + count + ")";\n      opt.disabled = count === 0 && opt.value !== selectEl.value;\n    }\n  }\n\n  function refreshFacetOptions() {\n    updateFacetSelect(filterDepartmentEl, "department", trDepartment, "filterAllDepartments");\n    updateFacetSelect(filterProductTypeEl, "productType", trProductType, "filterAllProductTypes");\n    updateFacetSelect(filterBrandEl, "brand", function (v) { return v; }, "filterAllBrands");\n    updateFacetSelect(filterSizeEl, "size", trSize, "filterAllSizes");\n    updateFacetSelect(filterColorEl, "color", function (v) { return v; }, "filterAllColors");\n    updateFacetSelect(filterConditionEl, "condition", trCondition, "filterAllConditions");\n  }\n\n  function clearOneArchiveFilter(key) {\n    if (key === "department") { state.department = ""; filterDepartmentEl.value = ""; }\n    else if (key === "productType") { state.productType = ""; filterProductTypeEl.value = ""; }\n    else if (key === "brand") { state.brand = ""; filterBrandEl.value = ""; }\n    else if (key === "size") { state.size = ""; filterSizeEl.value = ""; }\n    else if (key === "color") { state.color = ""; filterColorEl.value = ""; }\n    else if (key === "condition") { state.condition = ""; filterConditionEl.value = ""; }\n    else if (key === "price") { state.priceMin = null; state.priceMax = null; filterPriceMinEl.value = ""; filterPriceMaxEl.value = ""; }\n    else if (key === "category") { state.category = "all"; state.categoryGroup = null; syncCatalogChips(); }\n    else if (key === "status") { state.status = "Verfügbar"; syncCatalogChips(); }\n    render();\n  }\n\n  function renderActiveFilters() {\n    var filters = [];\n    if (state.department) filters.push({ key: "department", label: t("activeFilterDepartment"), value: trDepartment(state.department) });\n    if (state.productType) filters.push({ key: "productType", label: t("activeFilterProductType"), value: trProductType(state.productType) });\n    if (state.brand) filters.push({ key: "brand", label: t("activeFilterBrand"), value: state.brand });\n    if (state.size) filters.push({ key: "size", label: t("activeFilterSize"), value: trSize(state.size) });\n    if (state.color) filters.push({ key: "color", label: t("activeFilterColor"), value: state.color });\n    if (state.condition) filters.push({ key: "condition", label: t("activeFilterCondition"), value: trCondition(state.condition) });\n    if (state.priceMin != null || state.priceMax != null) {\n      var priceValue = (state.priceMin != null ? state.priceMin : "0") + "–" + (state.priceMax != null ? state.priceMax : "∞") + " €";\n      filters.push({ key: "price", label: t("activeFilterPrice"), value: priceValue });\n    }\n    if (state.category !== "all") filters.push({ key: "category", label: t("activeFilterCategory"), value: trCategory(state.category) });\n    else if (state.categoryGroup && state.categoryGroup.length) {\n      filters.push({ key: "category", label: t("activeFilterCategory"), value: state.categoryGroup.map(trCategory).join(" + ") });\n    }\n    if (state.status !== "Verfügbar") {\n      var statusValue = state.status === "Verkauft" ? t("statusSold") : t("statusAll");\n      filters.push({ key: "status", label: t("activeFilterStatus"), value: statusValue });\n    }\n\n    activeFiltersEl.innerHTML = "";\n    filters.forEach(function (filter) {\n      var btn = document.createElement("button");\n      btn.type = "button";\n      btn.className = "chip";\n      btn.textContent = filter.label + ": " + filter.value + " ×";\n      btn.setAttribute("aria-label", filter.label + " " + filter.value + " entfernen");\n      btn.addEventListener("click", function () { clearOneArchiveFilter(filter.key); });\n      activeFiltersEl.appendChild(btn);\n    });\n    if (filters.length > 1) {\n      var clear = document.createElement("button");\n      clear.type = "button";\n      clear.className = "active-filter-clear";\n      clear.textContent = t("activeFilterClear");\n      clear.addEventListener("click", function () { document.getElementById("filterReset").click(); });\n      activeFiltersEl.appendChild(clear);\n    }\n    activeFiltersEl.classList.toggle("hidden", filters.length === 0);\n\n    var panelFilterCount = [state.department, state.productType, state.brand, state.size, state.color, state.condition].filter(Boolean).length +\n      ((state.priceMin != null || state.priceMax != null) ? 1 : 0);\n    moreFiltersToggle.textContent = t("moreFilters") + (panelFilterCount ? " · " + panelFilterCount : "");\n  }\n\n  document.getElementById("filterReset").addEventListener("click", function () {'''
    text = replace_once(text, anchor, addition, "Facet- und aktive Filterlogik")

    # Recalculate facet counts and pills on every render, including language
    # switches, menu category changes and back/forward navigation.
    old = '''  function render() {\n    var filtered = sortItems(ITEMS.filter(matches));'''
    new = '''  function render() {\n    refreshFacetOptions();\n    renderActiveFilters();\n    var filtered = sortItems(ITEMS.filter(function (it) { return matches(it); }));'''
    text = replace_once(text, old, new, "Render Facets")

    return text


def main() -> None:
    template_before = TEMPLATE.read_text(encoding="utf-8")
    app_before = APP_JS.read_text(encoding="utf-8")
    css_before = APP_CSS.read_text(encoding="utf-8")

    template_after = patch_template(template_before)
    app_after = patch_app(app_before)
    css_after = patch_css(css_before)

    if template_after != template_before:
        TEMPLATE.write_text(template_after, encoding="utf-8")
    if app_after != app_before:
        APP_JS.write_text(app_after, encoding="utf-8")
    if css_after != css_before:
        APP_CSS.write_text(css_after, encoding="utf-8")

    print("Archiv-Filter-UX: OK – aktive Filter, Facet-Zähler und Nulltreffer-Schutz angewendet.")


if __name__ == "__main__":
    main()

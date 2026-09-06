#!/usr/bin/env python3
"""Upgrade the existing Disorder119 admin with a practical data-quality center.

The admin remains a direct editor for data/items.json. This patch does not touch
Match, Chaos, Baukasten, mode-guard.json, rental price rules or public shop UI.
"""
from __future__ import annotations

from pathlib import Path

BASE = Path(__file__).resolve().parents[1]
PATH = BASE / "admin" / "index.html"
MARKER = "ADMIN_QUALITY_CENTER_V1"


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if new in text:
        return text
    if old not in text:
        raise SystemExit(f"FEHLER: Admin-Quality-Patchmarker fehlt: {label}")
    return text.replace(old, new, 1)


def main() -> None:
    text = PATH.read_text(encoding="utf-8")
    if MARKER in text:
        print("Admin-Qualitaetszentrale bereits aktuell.")
        return

    text = replace_once(
        text,
        "  .result-count { font-size: 0.72rem; color: var(--text-faint); margin-bottom: 12px; }\n",
        """  .result-count { font-size: 0.72rem; color: var(--text-faint); margin-bottom: 12px; }\n\n  /* ---------- Datenqualitaet ---------- */\n  .quality-board {\n    border: 1px solid var(--rule-strong); background: var(--surface); margin: 0 0 18px; padding: 14px;\n  }\n  .quality-board__head { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; margin-bottom:10px; flex-wrap:wrap; }\n  .quality-board__title { margin:0; font-size:.78rem; letter-spacing:.1em; text-transform:uppercase; }\n  .quality-board__copy { margin:3px 0 0; color:var(--text-faint); font-size:.7rem; line-height:1.45; }\n  .quality-board__chips { display:flex; flex-wrap:wrap; gap:7px; }\n  .quality-chip {\n    appearance:none; min-height:40px; border:1px solid var(--rule-strong); background:var(--ink); color:var(--text);\n    padding:7px 10px; cursor:pointer; text-align:left; font:inherit;\n  }\n  .quality-chip:hover, .quality-chip:focus-visible { border-color:var(--accent); outline:none; }\n  .quality-chip strong { display:block; font-size:.95rem; font-variant-numeric:tabular-nums; }\n  .quality-chip span { display:block; margin-top:1px; font-size:.6rem; letter-spacing:.06em; text-transform:uppercase; color:var(--text-faint); }\n  .quality-chip--warn strong { color:var(--danger); }\n  .quality-note { font-size:.69rem; color:var(--text-faint); margin-top:8px; }\n""",
        "quality CSS",
    )

    text = replace_once(
        text,
        '  <div class="stats" id="stats"></div>\n\n  <div class="filters">',
        '  <div class="stats" id="stats"></div>\n\n  <section class="quality-board" id="qualityBoard" aria-labelledby="qualityBoardTitle"></section> <!-- ADMIN_QUALITY_CENTER_V1 -->\n\n  <div class="filters">',
        "quality board HTML",
    )

    text = replace_once(
        text,
        '''    <select id="gapFilter">\n      <option value="all">Alle</option>\n      <option value="noRental">Ohne Mietpreis</option>\n      <option value="noDesc">Ohne Beschreibung (DE)</option>\n      <option value="estimated">Geschätzter Preis</option>\n    </select>''',
        '''    <select id="gapFilter" aria-label="Datenqualitaet filtern">\n      <option value="all">Alle Qualitätsstände</option>\n      <option value="qualityAvailable">Verfügbar mit Qualitätslücke</option>\n      <option value="missingSize">Größe fehlt</option>\n      <option value="missingColor">Farbe fehlt</option>\n      <option value="missingCondition">Zustand fehlt</option>\n      <option value="thinDescription">Beschreibung unter 80 Zeichen</option>\n      <option value="priceOnRequest">Preis auf Anfrage</option>\n      <option value="duplicateArticle">Doppelte Artikelnummer</option>\n      <option value="singlePhoto">Nur ein Foto</option>\n      <option value="estimated">Geschätzter Preis</option>\n    </select>''',
        "quality filter options",
    )

    text = replace_once(
        text,
        '''  function fmtPrice(n) {\n    return (n || 0).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";\n  }''',
        '''  function fmtPrice(n) {\n    var value = Number(n);\n    if (!Number.isFinite(value) || value <= 0) return "Auf Anfrage";\n    return value.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";\n  }''',
        "admin price display",
    )

    old_stats = '''  // ---------- Ableitungen / Stats ----------\n  function computeStats(items) {\n    var available = items.filter(function (it) { return it.public_status === "AVAILABLE"; });\n    var sold = items.filter(function (it) { return it.public_status === "SOLD"; });\n    var draft = items.filter(function (it) { return it.public_status === "DRAFT"; });\n    var noRental = available.filter(function (it) { return !(it.rental_price > 0); });\n    var noDesc = items.filter(function (it) { return !((it.desc_de || it.desc || "").trim()); });\n    var totalValue = available.reduce(function (sum, it) { return sum + (it.price || 0); }, 0);\n    var brands = {};\n    available.forEach(function (it) { if (it.brand) brands[it.brand] = true; });\n    return {\n      total: items.length,\n      available: available.length,\n      sold: sold.length,\n      draft: draft.length,\n      noRental: noRental.length,\n      noDesc: noDesc.length,\n      totalValue: totalValue,\n      avgPrice: available.length ? totalValue / available.length : 0,\n      brandCount: Object.keys(brands).length\n    };\n  }\n\n  function renderStats() {\n    var s = computeStats(state.items);\n    var cards = [\n      { label: "Gesamt", value: s.total },\n      { label: "Verfügbar", value: s.available },\n      { label: "Verkauft", value: s.sold },\n      { label: "Entwurf", value: s.draft, warn: s.draft > 0 },\n      { label: "Ohne Mietpreis", value: s.noRental, warn: s.noRental > 0 },\n      { label: "Ohne Beschreibung", value: s.noDesc, warn: s.noDesc > 0 },\n      { label: "Lagerwert (verfügbar)", value: fmtPrice(s.totalValue) },\n      { label: "Ø Preis (verfügbar)", value: fmtPrice(s.avgPrice) },\n      { label: "Marken (aktiv)", value: s.brandCount }\n    ];\n    $("stats").innerHTML = cards.map(function (c) {\n      return '<div class="stat' + (c.warn ? " stat--warn" : "") + '"><div class="stat__value">' + c.value +\n        '</div><div class="stat__label">' + esc(c.label) + "</div></div>";\n    }).join("");\n  }'''

    new_stats = '''  // ---------- Ableitungen / Stats / Datenqualitaet ----------\n  function articleNumberCounts(items) {\n    var counts = {};\n    items.forEach(function (it) {\n      var article = String(it.article || "").trim();\n      if (article) counts[article] = (counts[article] || 0) + 1;\n    });\n    return counts;\n  }\n\n  function qualityIssues(it, articleCounts) {\n    var issues = [];\n    var desc = String(it.desc_de || it.desc || "").trim();\n    var article = String(it.article || "").trim();\n    var gallery = Array.isArray(it.gallery) ? it.gallery : [];\n    if (!String(it.size || "").trim()) issues.push("missingSize");\n    if (!String(it.color || "").trim()) issues.push("missingColor");\n    if (!String(it.condition || "").trim()) issues.push("missingCondition");\n    if (desc.length < 80) issues.push("thinDescription");\n    if (it.public_status === "AVAILABLE" && !(Number(it.price) > 0)) issues.push("priceOnRequest");\n    if (article && articleCounts[article] > 1) issues.push("duplicateArticle");\n    if (gallery.length === 1) issues.push("singlePhoto");\n    return issues;\n  }\n\n  function qualitySummary(items) {\n    var articleCounts = articleNumberCounts(items);\n    var result = { missingSize:0, missingColor:0, missingCondition:0, thinDescription:0, priceOnRequest:0, duplicateArticle:0, singlePhoto:0, qualityAvailable:0 };\n    items.forEach(function (it) {\n      var issues = qualityIssues(it, articleCounts);\n      issues.forEach(function (name) { result[name]++; });\n      if (it.public_status === "AVAILABLE" && issues.length) result.qualityAvailable++;\n    });\n    return result;\n  }\n\n  function computeStats(items) {\n    var available = items.filter(function (it) { return it.public_status === "AVAILABLE"; });\n    var sold = items.filter(function (it) { return it.public_status === "SOLD"; });\n    var draft = items.filter(function (it) { return it.public_status === "DRAFT"; });\n    var totalValue = available.reduce(function (sum, it) { return sum + (Number(it.price) > 0 ? Number(it.price) : 0); }, 0);\n    var pricedAvailable = available.filter(function (it) { return Number(it.price) > 0; });\n    var brands = {};\n    available.forEach(function (it) { if (it.brand) brands[it.brand] = true; });\n    var quality = qualitySummary(items);\n    return {\n      total: items.length, available: available.length, sold: sold.length, draft: draft.length,\n      qualityAvailable: quality.qualityAvailable, totalValue: totalValue,\n      avgPrice: pricedAvailable.length ? totalValue / pricedAvailable.length : 0,\n      brandCount: Object.keys(brands).length\n    };\n  }\n\n  function renderStats() {\n    var s = computeStats(state.items);\n    var cards = [\n      { label: "Gesamt", value: s.total },\n      { label: "Verfügbar", value: s.available },\n      { label: "Verkauft", value: s.sold },\n      { label: "Entwurf", value: s.draft, warn: s.draft > 0 },\n      { label: "Verfügbar mit Lücke", value: s.qualityAvailable, warn: s.qualityAvailable > 0 },\n      { label: "Lagerwert (verfügbar)", value: fmtPrice(s.totalValue) },\n      { label: "Ø Preis mit Preis", value: fmtPrice(s.avgPrice) },\n      { label: "Marken (aktiv)", value: s.brandCount }\n    ];\n    $("stats").innerHTML = cards.map(function (c) {\n      return '<div class="stat' + (c.warn ? " stat--warn" : "") + '"><div class="stat__value">' + c.value +\n        '</div><div class="stat__label">' + esc(c.label) + "</div></div>";\n    }).join("");\n    renderQualityBoard();\n  }\n\n  function renderQualityBoard() {\n    var q = qualitySummary(state.items);\n    var cards = [\n      ["qualityAvailable", q.qualityAvailable, "Verfügbar mit Lücke"],\n      ["missingSize", q.missingSize, "Größe fehlt"],\n      ["missingColor", q.missingColor, "Farbe fehlt"],\n      ["missingCondition", q.missingCondition, "Zustand fehlt"],\n      ["thinDescription", q.thinDescription, "Beschreibung < 80"],\n      ["priceOnRequest", q.priceOnRequest, "Preis auf Anfrage"],\n      ["duplicateArticle", q.duplicateArticle, "Doppelte Art.-Nr."],\n      ["singlePhoto", q.singlePhoto, "Nur ein Foto"]\n    ];\n    var host = $("qualityBoard");\n    host.innerHTML = '<div class="quality-board__head"><div><h2 class="quality-board__title" id="qualityBoardTitle">Datenqualität</h2>' +\n      '<p class="quality-board__copy">Priorisiert echte Kataloglücken. Anklicken filtert die Liste; nichts wird automatisch erfunden.</p></div></div>' +\n      '<div class="quality-board__chips">' + cards.map(function (row) {\n        return '<button type="button" class="quality-chip' + (row[1] ? ' quality-chip--warn' : '') + '" data-quality-jump="' + row[0] + '">' +\n          '<strong>' + row[1] + '</strong><span>' + esc(row[2]) + '</span></button>';\n      }).join("") + '</div>' +\n      '<p class="quality-note">Mietpreis ist nicht mehr manuell: Rental V2 berechnet unverändert exakt 10 % des Verkaufspreises pro Kalendertag.</p>';\n    Array.prototype.forEach.call(host.querySelectorAll("[data-quality-jump]"), function (button) {\n      button.addEventListener("click", function () {\n        $("gapFilter").value = button.getAttribute("data-quality-jump");\n        applyFilters();\n        $("rows").scrollIntoView({ behavior: "smooth", block: "start" });\n      });\n    });\n  }'''
    text = replace_once(text, old_stats, new_stats, "quality stats logic")

    old_filter = '''    var list = state.items.filter(function (it) {\n      if (status !== "all" && it.public_status !== status) return false;\n      if (cat !== "all" && it.category !== cat) return false;\n      if (gap === "noRental" && !(it.public_status === "AVAILABLE" && !(it.rental_price > 0))) return false;\n      if (gap === "noDesc" && (it.desc_de || it.desc || "").trim()) return false;\n      if (gap === "estimated" && !it.price_estimated) return false;'''
    new_filter = '''    var articleCounts = articleNumberCounts(state.items);\n    var list = state.items.filter(function (it) {\n      if (status !== "all" && it.public_status !== status) return false;\n      if (cat !== "all" && it.category !== cat) return false;\n      var issues = qualityIssues(it, articleCounts);\n      if (gap === "qualityAvailable" && !(it.public_status === "AVAILABLE" && issues.length)) return false;\n      if (gap !== "all" && gap !== "qualityAvailable" && gap !== "estimated" && issues.indexOf(gap) === -1) return false;\n      if (gap === "estimated" && !it.price_estimated) return false;'''
    text = replace_once(text, old_filter, new_filter, "quality list filters")

    old_badges = '''  function statusBadges(it) {\n    var badges = "";\n    if (it.public_status === "AVAILABLE") badges += '<span class="badge badge--available">Verfügbar</span>';\n    else if (it.public_status === "SOLD") badges += '<span class="badge badge--sold">Verkauft</span>';\n    else if (it.public_status === "DRAFT") badges += '<span class="badge badge--draft">Entwurf</span>';\n    if (it.public_status === "AVAILABLE" && !(it.rental_price > 0)) badges += '<span class="badge badge--gap">Kein Mietpreis</span>';\n    if (!((it.desc_de || it.desc || "").trim())) badges += '<span class="badge badge--gap">Keine Beschreibung</span>';\n    if (it.price_estimated) badges += '<span class="badge">Preis geschätzt</span>';\n    return badges;\n  }'''
    new_badges = '''  function statusBadges(it) {\n    var badges = "";\n    if (it.public_status === "AVAILABLE") badges += '<span class="badge badge--available">Verfügbar</span>';\n    else if (it.public_status === "SOLD") badges += '<span class="badge badge--sold">Verkauft</span>';\n    else if (it.public_status === "DRAFT") badges += '<span class="badge badge--draft">Entwurf</span>';\n    var labels = { missingSize:"Größe", missingColor:"Farbe", missingCondition:"Zustand", thinDescription:"Beschreibung", priceOnRequest:"Preis", duplicateArticle:"Art.-Nr.", singlePhoto:"1 Foto" };\n    var counts = articleNumberCounts(state.items);\n    qualityIssues(it, counts).slice(0, 3).forEach(function (name) { badges += '<span class="badge badge--gap">' + esc(labels[name] || name) + '</span>'; });\n    var extra = qualityIssues(it, counts).length - 3;\n    if (extra > 0) badges += '<span class="badge badge--gap">+' + extra + '</span>';\n    if (it.price_estimated) badges += '<span class="badge">Preis geschätzt</span>';\n    return badges;\n  }'''
    text = replace_once(text, old_badges, new_badges, "quality badges")

    text = replace_once(
        text,
        '        field("Mietpreis (€, leer = auf Anfrage)", "rental_price", "number", it.rental_price || "") +\n',
        '',
        "remove obsolete rental price field",
    )

    text = replace_once(
        text,
        '        roField("Artikelnummer", esc(it.article)) +\n        roField("Fotos", (it.gallery ? it.gallery.length : 0) + " im Katalog" + (it.look ? " + Look-Foto" : "")) +',
        '        roField("Artikelnummer", esc(it.article)) +\n        roField("Mietpreis / Tag", Number(it.price) > 0 ? fmtPrice(Number(it.price) * 0.10) : "Auf Anfrage") +\n        roField("Fotos", (it.gallery ? it.gallery.length : 0) + " im Katalog" + (it.look ? " + Look-Foto" : "")) +',
        "derived rental price readonly",
    )

    text = replace_once(
        text,
        '''        else if (el.type === "number") updated[name] = el.value === "" ? (name === "rental_price" ? undefined : 0) : parseFloat(el.value);\n        else updated[name] = el.value;\n      });\n      if (updated.rental_price === undefined) delete updated.rental_price;''',
        '''        else if (el.type === "number") updated[name] = el.value === "" ? 0 : parseFloat(el.value);\n        else updated[name] = el.value;\n      });''',
        "remove obsolete rental save semantics",
    )

    text = replace_once(
        text,
        '      saveItem(updated, 1).then(function () {',
        '''      if (!String(updated.title || "").trim()) { stateEl.textContent = "Titel fehlt."; saveBtn.disabled = false; showToast("Titel darf nicht leer sein.", "err"); return; }\n      if (updated.public_status !== "DRAFT" && !String(updated.brand || "").trim()) { stateEl.textContent = "Marke fehlt."; saveBtn.disabled = false; showToast("Öffentliche Artikel brauchen eine Marke.", "err"); return; }\n      if (!Number.isFinite(Number(updated.price)) || Number(updated.price) < 0) { stateEl.textContent = "Preis ungültig."; saveBtn.disabled = false; showToast("Preis muss 0 oder größer sein.", "err"); return; }\n      saveItem(updated, 1).then(function () {''',
        "admin save validation",
    )

    PATH.write_text(text, encoding="utf-8")
    print("Admin-Datenqualitaetszentrale angewendet.")


if __name__ == "__main__":
    main()

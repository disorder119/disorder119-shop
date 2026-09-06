#!/usr/bin/env python3
"""Harden the inventory admin around truthful product evidence and guarded main writes.

This is an internal admin-only migration. It does not touch Match, Chaos,
Baukasten, mode-guard.json or the public visual design.

Goals:
- remove the obsolete editable rental-price field (Rental V2 derives 10%/day)
- make size gaps match the reviewed wearable taxonomy used by quality scoring
- stop the admin from editing the protected legacy category directly
- require a short human evidence note when size/color/condition is changed
- preserve human-verified evidence separately from automated source provenance
- prevent a manual correction from being overwritten by title inference later
"""
from pathlib import Path

BASE = Path(__file__).resolve().parents[1]
PATH = BASE / "admin" / "index.html"
MARKER = "ADMIN_EVIDENCE_HARDENING_V2"


def rep(text: str, old: str, new: str, label: str) -> str:
    if new in text:
        return text
    if old not in text:
        raise SystemExit(f"FEHLER: Admin-Evidence-Hardening Patchmarker fehlt: {label}")
    return text.replace(old, new, 1)


def main() -> None:
    text = PATH.read_text(encoding="utf-8")
    if MARKER in text:
        print("Admin-Evidence-Hardening bereits aktuell.")
        return
    if "ADMIN_QUALITY_CENTER_V1" not in text or "ADMIN_QUALITY_HARDENING_V1" not in text:
        raise SystemExit("FEHLER: Admin-Quality-Center/Hardening muss zuerst angewendet werden")

    text = rep(
        text,
        '  .quality-note { font-size:.69rem; color:var(--text-faint); margin-top:8px; }\n',
        '''  .quality-note { font-size:.69rem; color:var(--text-faint); margin-top:8px; }\n  .evidence-box {\n    grid-column:1 / -1; border:1px solid var(--rule); background:var(--ink-lift); padding:10px 11px;\n  }\n  .evidence-box label { display:block; font-size:.62rem; letter-spacing:.08em; text-transform:uppercase; color:var(--text-faint); margin-bottom:5px; }\n  .evidence-box textarea { width:100%; min-height:52px; resize:vertical; background:var(--ink); border:1px solid var(--rule-strong); color:var(--paper); padding:8px 9px; }\n  .evidence-box p { margin:5px 0 0; color:var(--text-faint); font-size:.66rem; line-height:1.45; }\n''',
        "evidence styles",
    )

    text = rep(
        text,
        '''  function qualityIssues(it, articleCounts) {\n    var issues = [];''',
        '''  var ADMIN_WEARABLE_CATEGORIES = { Jackets:true, Coats:true, Tops:true, Shirts:true, Knitwear:true, Pants:true, Skirts:true, Dresses:true, Shoes:true }; // ADMIN_EVIDENCE_HARDENING_V2\n\n  function isWearableItem(it) {\n    return !!ADMIN_WEARABLE_CATEGORIES[itemCategory(it)];\n  }\n\n  function computeOpenPhysicalFields(it) {\n    var open = [];\n    if (isWearableItem(it) && !String(it.size || "").trim()) open.push("size");\n    if (!String(it.color || "").trim()) open.push("color");\n    if (!String(it.condition || "").trim()) open.push("condition");\n    return open;\n  }\n\n  function qualityIssues(it, articleCounts) {\n    var issues = [];''',
        "wearable quality helper",
    )
    text = rep(
        text,
        '    if (!String(it.size || "").trim()) issues.push("missingSize");',
        '    if (isWearableItem(it) && !String(it.size || "").trim()) issues.push("missingSize");',
        "wearable size gaps",
    )

    text = rep(
        text,
        '        field("Mietpreis (€, leer = auf Anfrage)", "rental_price", "number", it.rental_price || "") +\n',
        '',
        "obsolete rental price input",
    )
    text = rep(
        text,
        '        selectField("Kategorie", "category", CATEGORIES, it.category) +\n',
        '',
        "protected legacy category input",
    )
    text = rep(
        text,
        '        selectField("Zustand", "condition", CONDITIONS, it.condition) +\n        selectField("Sichtbarer Status",',
        '''        selectField("Zustand", "condition", CONDITIONS, it.condition) +\n        evidenceField(it) +\n        selectField("Sichtbarer Status",''',
        "evidence note field",
    )

    text = rep(
        text,
        '''  function renderPanel(it) {\n    var descCompleteness = ["de", "en", "fr"].map(function (l) {''',
        '''  function evidenceSourceText(it, field) {\n    var manual = it.data_quality_manual_evidence && it.data_quality_manual_evidence[field];\n    if (manual && manual.note) return "manuell geprüft: " + manual.note;\n    var source = it.data_quality_sources && it.data_quality_sources[field];\n    var labels = {\n      "explicit-title-color": "explizit im Titel",\n      "explicit-labeled-source-text": "explizit im Quelltext",\n      "explicit-condition-prose": "explizite Zustandsangabe im Text"\n    };\n    return source ? (labels[source] || source) : "Quelle nicht markiert";\n  }\n\n  function evidenceSummary(it) {\n    return ["size", "color", "condition"].map(function (field) {\n      var value = String(it[field] || "").trim();\n      if (!value) return null;\n      var labels = { size:"Größe", color:"Farbe", condition:"Zustand" };\n      return labels[field] + ": " + evidenceSourceText(it, field);\n    }).filter(Boolean).join(" · ") || "—";\n  }\n\n  function evidenceField(it) {\n    return '<div class="evidence-box"><label for="evidenceNote-' + it.id + '">Nachweis für geänderte Größe / Farbe / Zustand</label>' +\n      '<textarea id="evidenceNote-' + it.id + '" data-evidence-note placeholder="z. B. Etikett geprüft, Originalrechnung, Artikel selbst geprüft"></textarea>' +\n      '<p>Nur nötig, wenn du Größe, Farbe oder Zustand änderst. Der Nachweis wird mit Zeitstempel gespeichert; automatische Quellen bleiben getrennt.</p></div>';\n  }\n\n  function renderPanel(it) {\n    var descCompleteness = ["de", "en", "fr"].map(function (l) {''',
        "evidence render helpers",
    )

    text = rep(
        text,
        '''        roField("Geprüfte Kategorie", esc(itemCategory(it) || "—")) +\n        roField("Mietpreis / Tag",''',
        '''        roField("Geprüfte Kategorie", esc(itemCategory(it) || "—")) +\n        roField("Offene physische Daten", esc(computeOpenPhysicalFields(it).join(", ") || "keine")) +\n        roField("Nachweise", esc(evidenceSummary(it))) +\n        roField("Mietpreis / Tag",''',
        "evidence readonly summary",
    )

    old_save = '''      var updated = Object.assign({}, it);\n      Array.prototype.forEach.call(row.querySelectorAll("[data-field]"), function (el) {\n        var name = el.getAttribute("data-field");\n        if (el.type === "checkbox") updated[name] = el.checked;\n        else if (el.type === "number") updated[name] = el.value === "" ? 0 : parseFloat(el.value);\n        else updated[name] = el.value;\n      });\n      var stateEl = row.querySelector('[data-savestate="' + id + '"]');'''
    new_save = '''      var updated = Object.assign({}, it);\n      Array.prototype.forEach.call(row.querySelectorAll("[data-field]"), function (el) {\n        var name = el.getAttribute("data-field");\n        if (el.type === "checkbox") updated[name] = el.checked;\n        else if (el.type === "number") updated[name] = el.value === "" ? 0 : parseFloat(el.value);\n        else updated[name] = el.value;\n      });\n\n      // Human verification is deliberately separate from automated provenance.\n      // A manual correction removes the automated source marker so the next\n      // conservative rebuild cannot overwrite a human-verified value.\n      var evidenceNoteEl = row.querySelector("[data-evidence-note]");\n      var evidenceNote = evidenceNoteEl ? evidenceNoteEl.value.trim() : "";\n      var changedPhysical = [];\n      ["size", "color", "condition"].forEach(function (fieldName) {\n        var before = String(it[fieldName] || "").trim();\n        var after = String(updated[fieldName] || "").trim();\n        if (before !== after) changedPhysical.push(fieldName);\n      });\n      var changedToValue = changedPhysical.filter(function (fieldName) { return String(updated[fieldName] || "").trim(); });\n      if (changedToValue.length && !evidenceNote) {\n        var missingEvidenceState = row.querySelector('[data-savestate="' + id + '"]');\n        if (missingEvidenceState) missingEvidenceState.textContent = "Nachweis fehlt.";\n        showToast("Für geänderte Größe/Farbe/Zustand bitte kurz den Nachweis angeben.", "err");\n        return;\n      }\n      var sources = Object.assign({}, it.data_quality_sources || {});\n      var manualEvidence = Object.assign({}, it.data_quality_manual_evidence || {});\n      var verifiedAt = new Date().toISOString();\n      changedPhysical.forEach(function (fieldName) {\n        delete sources[fieldName];\n        if (String(updated[fieldName] || "").trim()) {\n          manualEvidence[fieldName] = { note: evidenceNote, verified_at: verifiedAt };\n        } else {\n          delete manualEvidence[fieldName];\n        }\n      });\n      if (Object.keys(sources).length) updated.data_quality_sources = sources; else delete updated.data_quality_sources;\n      if (Object.keys(manualEvidence).length) updated.data_quality_manual_evidence = manualEvidence; else delete updated.data_quality_manual_evidence;\n      updated.data_quality_open = computeOpenPhysicalFields(updated);\n\n      var stateEl = row.querySelector('[data-savestate="' + id + '"]');'''
    text = rep(text, old_save, new_save, "manual evidence save semantics")

    # Explicitly prevent the old validator loophole from returning: the literal
    # field call itself must be absent, not merely rendered data-field markup.
    if 'field("Mietpreis (€, leer = auf Anfrage)", "rental_price"' in text:
        raise SystemExit("FEHLER: manueller Mietpreis blieb im Admin editierbar")
    if 'selectField("Kategorie", "category"' in text:
        raise SystemExit("FEHLER: Legacy-Kategorie blieb im Admin editierbar")

    PATH.write_text(text, encoding="utf-8")
    print("Admin-Evidence-Hardening V2 angewendet: Human-Provenance, Taxonomie-Gaps und Rental/Legacy-Felder abgesichert.")


if __name__ == "__main__":
    main()

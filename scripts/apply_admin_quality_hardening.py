#!/usr/bin/env python3
"""Second-stage hardening for the admin quality center.

Runs after apply_admin_quality_center.py. Fixes the existing optimistic-concurrency
retry edge case and aligns admin category/quality signals with reviewed taxonomy.
"""
from pathlib import Path

from apply_admin_large_items_loader import main as apply_large_items_loader
from apply_admin_rental_readonly import main as apply_rental_readonly

BASE = Path(__file__).resolve().parents[1]
PATH = BASE / "admin" / "index.html"
MARKER = "ADMIN_QUALITY_HARDENING_V1"


def rep(text: str, old: str, new: str, label: str) -> str:
    if new in text:
        return text
    if old not in text:
        raise SystemExit(f"FEHLER: Admin-Hardening Patchmarker fehlt: {label}")
    return text.replace(old, new, 1)


def main() -> None:
    text = PATH.read_text(encoding="utf-8")
    if MARKER in text:
        print("Admin-Quality-Hardening bereits aktuell.")
        apply_large_items_loader()
        apply_rental_readonly()
        return
    if "ADMIN_QUALITY_CENTER_V1" not in text:
        raise SystemExit("FEHLER: Admin-Quality-Center muss zuerst angewendet werden")

    text = rep(
        text,
        '''      if (res.status === 409 && attempt === 1) {\n        // Datei wurde zwischenzeitlich anderswo geaendert - einmal neu\n        // laden (frischer sha + frische Daten der ANDEREN Artikel) und\n        // die eine Bearbeitung erneut versuchen.\n        return fetchItems().then(function () { return saveItem(updatedItem, 2); });\n      }''',
        '''      if (res.status === 409 && attempt === 1) {\n        // Datei wurde zwischenzeitlich anderswo geaendert: frischen SHA +\n        // fremde Aenderungen laden, danach genau diese Bearbeitung erneut\n        // anwenden. Der Sentinel verhindert, dass der erste Promise-Frame\n        // anschliessend den frischen In-Memory-Stand wieder ueberschreibt.\n        return fetchItems().then(function () { return saveItem(updatedItem, 2); }).then(function () {\n          return { __retried: true };\n        }); // ADMIN_CONCURRENCY_RETRY_SAFE\n      }''',
        "409 retry",
    )
    text = rep(
        text,
        '''    }).then(function (data) {\n      state.items = nextItems;\n      state.sha = data.content.sha;\n    });''',
        '''    }).then(function (data) {\n      if (data && data.__retried) return;\n      state.items = nextItems;\n      state.sha = data.content.sha;\n    });''',
        "409 sentinel",
    )

    text = rep(
        text,
        '''    var gallery = Array.isArray(it.gallery) ? it.gallery : [];\n    if (!String(it.size || "").trim()) issues.push("missingSize");''',
        '''    var gallery = Array.isArray(it.gallery) ? it.gallery : [];\n    if (it.public_status !== "DRAFT" && !String(it.brand || "").trim()) issues.push("missingBrand");\n    if (!gallery.length) issues.push("missingGallery");\n    if (!String(it.size || "").trim()) issues.push("missingSize");''',
        "brand/gallery quality issues",
    )
    text = rep(
        text,
        'var result = { missingSize:0, missingColor:0, missingCondition:0, thinDescription:0, priceOnRequest:0, duplicateArticle:0, singlePhoto:0, qualityAvailable:0 };',
        'var result = { missingBrand:0, missingGallery:0, missingSize:0, missingColor:0, missingCondition:0, thinDescription:0, priceOnRequest:0, duplicateArticle:0, singlePhoto:0, qualityAvailable:0 };',
        "quality result keys",
    )
    text = rep(
        text,
        '''      ["qualityAvailable", q.qualityAvailable, "Verfügbar mit Lücke"],\n      ["missingSize", q.missingSize, "Größe fehlt"],''',
        '''      ["qualityAvailable", q.qualityAvailable, "Verfügbar mit Lücke"],\n      ["missingBrand", q.missingBrand, "Marke fehlt"],\n      ["missingGallery", q.missingGallery, "Fotos fehlen"],\n      ["missingSize", q.missingSize, "Größe fehlt"],''',
        "quality cards",
    )
    text = rep(text, '["duplicateArticle", q.duplicateArticle, "Doppelte Art.-Nr."],', '["duplicateArticle", q.duplicateArticle, "Artikel mit doppelter Nr."],', "duplicate label")
    text = rep(
        text,
        '''      <option value="qualityAvailable">Verfügbar mit Qualitätslücke</option>\n      <option value="missingSize">Größe fehlt</option>''',
        '''      <option value="qualityAvailable">Verfügbar mit Qualitätslücke</option>\n      <option value="missingBrand">Marke fehlt</option>\n      <option value="missingGallery">Fotos fehlen</option>\n      <option value="missingSize">Größe fehlt</option>''',
        "quality filter brand/gallery",
    )
    text = rep(
        text,
        'var labels = { missingSize:"Größe", missingColor:"Farbe", missingCondition:"Zustand", thinDescription:"Beschreibung", priceOnRequest:"Preis", duplicateArticle:"Art.-Nr.", singlePhoto:"1 Foto" };',
        'var labels = { missingBrand:"Marke", missingGallery:"Fotos", missingSize:"Größe", missingColor:"Farbe", missingCondition:"Zustand", thinDescription:"Beschreibung", priceOnRequest:"Preis", duplicateArticle:"Art.-Nr.", singlePhoto:"1 Foto" };',
        "quality badge labels",
    )

    text = rep(
        text,
        '''  function populateCategoryFilter() {\n    var sel = $("categoryFilter");\n    CATEGORIES.forEach(function (c) {\n      var opt = document.createElement("option");\n      opt.value = c; opt.textContent = c;\n      sel.appendChild(opt);\n    });\n  }''',
        '''  function itemCategory(it) {\n    return String(it && (it.taxonomy_category || it.category) || "").trim(); // ADMIN_REVIEWED_TAXONOMY\n  }\n\n  function populateCategoryFilter() {\n    var sel = $("categoryFilter");\n    var seen = {};\n    state.items.forEach(function (it) { var c = itemCategory(it); if (c) seen[c] = true; });\n    Object.keys(seen).sort(function (a, b) { return a.localeCompare(b, "de"); }).forEach(function (c) {\n      var opt = document.createElement("option");\n      opt.value = c; opt.textContent = c;\n      sel.appendChild(opt);\n    });\n  }''',
        "dynamic reviewed categories",
    )
    text = rep(text, 'if (cat !== "all" && it.category !== cat) return false;', 'if (cat !== "all" && itemCategory(it) !== cat) return false;', "category filter")
    text = rep(text, 'esc(it.category) + (it.size ?', 'esc(itemCategory(it)) + (it.size ?', "row reviewed category")
    text = rep(
        text,
        '        roField("Artikelnummer", esc(it.article)) +\n        roField("Mietpreis / Tag",',
        '        roField("Artikelnummer", esc(it.article)) +\n        roField("Geprüfte Kategorie", esc(itemCategory(it) || "—")) +\n        roField("Mietpreis / Tag",',
        "reviewed category detail",
    )

    text = text.replace('<!-- ADMIN_QUALITY_CENTER_V1 -->', '<!-- ADMIN_QUALITY_CENTER_V1 / ADMIN_QUALITY_HARDENING_V1 -->', 1)
    PATH.write_text(text, encoding="utf-8")
    print("Admin-Quality-Hardening angewendet.")
    apply_large_items_loader()
    apply_rental_readonly()


if __name__ == "__main__":
    main()

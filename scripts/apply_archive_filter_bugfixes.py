#!/usr/bin/env python3
"""Fix archive-filter regressions discovered by a dedicated bug hunt.

This pass intentionally runs after the taxonomy and filter-UX patchers.  It only
changes the classic archive rail / title bookkeeping and does not touch Match,
Chaos, Baukasten or config/mode-guard.json.
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
        raise SystemExit(f"FEHLER: Archiv-Bugfix-Patchmarker fehlt: {label}")
    return text.replace(old, new, 1)


def patch_template(text: str) -> str:
    # The status/category chip container is deliberately hidden, but the same
    # class had accidentally been copied onto the right-hand control group.
    # Because .catalog-controls is display:none !important, that also hid the
    # More Filters button, sorting and photo-mount control from real users.
    return replace_once(
        text,
        '<div class="rail__right catalog-controls" aria-hidden="true">',
        '<div class="rail__right">',
        "sichtbare rechte Archiv-Steuerung",
    )


def patch_app(text: str) -> str:
    old = '''    var filtered = sortItems(ITEMS.filter(function (it) { return matches(it); }));\n    catalogTitleEl.textContent = state.catalogLabelText ||\n      (state.catalogLabelCategory ? trCategory(state.catalogLabelCategory) : t(state.catalogLabelKey || "statusAvailable"));'''
    new = '''    var filtered = sortItems(ITEMS.filter(function (it) { return matches(it); }));\n\n    // Die sichtbare Katalog-Ueberschrift muss immer zum tatsaechlichen\n    // Filterzustand passen. Aktive Filter koennen einzeln geloescht werden;\n    // davor blieben dabei alte Labels wie "Archiv", "Schuhe" oder eine\n    // zuvor angeklickte Marke stehen, obwohl bereits andere Artikel gezeigt\n    // wurden. Ein Markenlabel gilt nur solange die Suchquery noch exakt dazu\n    // passt; Kategorie/Gruppen-Labels haben ansonsten Vorrang vor dem Status.\n    if (state.catalogLabelText && normalizeText(state.catalogLabelText) !== state.query) {\n      state.catalogLabelText = "";\n    }\n    if (state.category !== "all") {\n      state.catalogLabelKey = "";\n      state.catalogLabelCategory = state.category;\n      state.catalogLabelText = "";\n    } else if (!state.categoryGroup && !state.catalogLabelText) {\n      state.catalogLabelCategory = "";\n      state.catalogLabelKey = state.status === "Verkauft"\n        ? "statusSold"\n        : (state.status === "all" ? "statusAll" : "statusAvailable");\n    }\n\n    catalogTitleEl.textContent = state.catalogLabelText ||\n      (state.catalogLabelCategory ? trCategory(state.catalogLabelCategory) : t(state.catalogLabelKey || "statusAvailable"));'''
    return replace_once(text, old, new, "Katalogtitel folgt Filterzustand")


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
        "Archiv-Filter-Bugfixes: OK – Steuerung sichtbar und Katalogtitel "
        "mit dem realen Filterzustand synchronisiert."
    )


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Apply fixes proven by quantitative Lighthouse/axe browser audits.

Scope is deliberately limited to the normal archive/product/rental customer
flow. Match, Chaos and Baukasten markup/behaviour are protected and are not
modified here. The mode guard is never read, written or regenerated.
"""
from __future__ import annotations

from pathlib import Path

BASE = Path(__file__).resolve().parents[1]
APP_JS = BASE / "assets" / "app.js"
APP_CSS = BASE / "assets" / "app.css"
ARTICLE_JS = BASE / "assets" / "article.js"
ARTICLE_CSS = BASE / "assets" / "article.css"
INDEX_TEMPLATE = BASE / "index_template.html"

MARKER_JS = "PERF_A11Y_95_ARCHIVE"
MARKER_CSS = "PERF_A11Y_95_ARCHIVE_STYLE"
MARKER_ARTICLE = "PERF_A11Y_95_ARTICLE"
MARKER_ARTICLE_CSS = "PERF_A11Y_95_ARTICLE_STYLE"


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: erwartete genau 1 Fundstelle, gefunden {count}")
    return text.replace(old, new, 1)


def patch_index_template() -> bool:
    text = INDEX_TEMPLATE.read_text(encoding="utf-8")
    old = '<select class="rail__sort" id="sortSelect">'
    new = '<select class="rail__sort" id="sortSelect" aria-label="Artikel sortieren">'
    if new in text:
        return False
    text = replace_once(text, old, new, "Sortierauswahl")
    INDEX_TEMPLATE.write_text(text, encoding="utf-8")
    return True


def patch_app_js() -> bool:
    text = APP_JS.read_text(encoding="utf-8")
    if MARKER_JS in text:
        return False

    lang_anchor = '  var LANG = PATH_LANG_MATCH ? PATH_LANG_MATCH[1] : "de";\n'
    lang_block = lang_anchor + '''  // PERF_A11Y_95_ARCHIVE — measured axe/Lighthouse fixes for the classic archive.\n  var sortSelectA11yEl = document.getElementById("sortSelect");\n  if (sortSelectA11yEl) {\n    sortSelectA11yEl.setAttribute("aria-label", LANG === "fr" ? "Trier les articles" : LANG === "en" ? "Sort items" : "Artikel sortieren");\n  }\n'''
    text = replace_once(text, lang_anchor, lang_block, "lokalisierter Sortiername")

    text = replace_once(
        text,
        '      plate.setAttribute("aria-label", it.title);\n',
        '',
        "redundantes Karten-aria-label",
    )

    text = replace_once(
        text,
        '      if (animateEntry && idx < animateCount) {\n',
        '      if (animateEntry && idx >= 2 && idx < animateCount) {\n',
        "LCP-sicherer Karten-Einstieg",
    )

    image_old = '''      plate.innerHTML =\n        '<div class="plate__frame">' +\n          (imgSrc ? '<img src="' + imgSrc + '" alt="' + altText + '" loading="lazy" />' : "") +\n'''
    image_new = '''      var heroLoading = idx < 4 ? "eager" : "lazy";\n      var heroPriority = idx < 2 ? ' fetchpriority="high"' : "";\n      plate.innerHTML =\n        '<div class="plate__frame">' +\n          (imgSrc ? '<img src="' + imgSrc + '" alt="' + altText + '" loading="' + heroLoading + '"' + heroPriority + ' />' : "") +\n'''
    text = replace_once(text, image_old, image_new, "LCP-Bildprioritaet")

    APP_JS.write_text(text, encoding="utf-8")
    return True


def patch_app_css() -> bool:
    text = APP_CSS.read_text(encoding="utf-8")
    if MARKER_CSS in text:
        return False
    block = r'''

  /* PERF_A11Y_95_ARCHIVE_STYLE
     Quantitative axe/Lighthouse findings in the normal archive only.
     Selectors are scoped to #appShell so Match/Chaos/Baukasten retain their
     protected visual design. The hierarchy stays muted, but no essential
     small text is rendered at failing contrast. Brand filters gain the WCAG
     minimum pointer target without increasing their visible typography. */
  #appShell .eyebrow,
  #appShell .wordmark-kicker,
  #appShell .meta-figure__label,
  #appShell .catalog-heading .rail__count,
  #appShell .filter-field label,
  #appShell .footer__stamp,
  #appShell .footer__legal a,
  #appShell .plate__title {
    color: rgba(242, 239, 231, 0.72);
  }

  /* Opacity animations temporarily pushed otherwise compliant text below the
     contrast threshold during the first audit frame. Keep the original
     transform/letter-spacing motion, but text itself is readable immediately. */
  #appShell .reveal,
  #appShell .wordmark__line {
    opacity: 1 !important;
  }

  #appShell .plate__brand {
    display: inline-flex;
    align-items: center;
    justify-content: flex-start;
    min-width: 24px;
    min-height: 24px;
    padding: 4px 0;
  }

  #appShell .plate__rental-btn {
    color: var(--accent-text);
  }
'''
    APP_CSS.write_text(text.rstrip() + block + "\n", encoding="utf-8")
    return True


def patch_article_js() -> bool:
    text = ARTICLE_JS.read_text(encoding="utf-8")
    if MARKER_ARTICLE in text:
        return False
    old = '''      t2.className = "gallery-thumb" + (i === 0 ? " active" : "");\n      t2.innerHTML = '<img src="' + src + '" alt="" loading="lazy" />';\n'''
    new = '''      t2.className = "gallery-thumb" + (i === 0 ? " active" : "");\n      // PERF_A11Y_95_ARTICLE — thumbnail buttons need an accessible name.\n      t2.setAttribute("aria-label", (LANG === "fr" ? "Photo " : LANG === "en" ? "Photo " : "Foto ") + (i + 1) + " / " + thumbs.length);\n      t2.innerHTML = '<img src="' + src + '" alt="" loading="lazy" />';\n'''
    text = replace_once(text, old, new, "Galerie-Thumbnail-Name")
    ARTICLE_JS.write_text(text, encoding="utf-8")
    return True


def patch_article_css() -> bool:
    text = ARTICLE_CSS.read_text(encoding="utf-8")
    if MARKER_ARTICLE_CSS in text:
        return False
    block = r'''

/* PERF_A11Y_95_ARTICLE_STYLE — measured product-page contrast fixes. */
.fact__label,
.info__note {
  color: rgba(242, 239, 231, 0.68);
}
'''
    ARTICLE_CSS.write_text(text.rstrip() + block + "\n", encoding="utf-8")
    return True


def main() -> None:
    changed = []
    if patch_index_template(): changed.append("Sortiername")
    if patch_app_js(): changed.append("Archiv-LCP/A11y")
    if patch_app_css(): changed.append("Archiv-Kontrast/Targets")
    if patch_article_js(): changed.append("Galerie-A11y")
    if patch_article_css(): changed.append("Produkt-Kontrast")
    if changed:
        print("Performance-/A11y-Qualitaet angewendet: " + ", ".join(changed) + ".")
    else:
        print("Performance-/A11y-Qualitaet bereits aktuell.")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Second measured Focus-3 pass.

The first HTML-first pass removed the request-discovery bottleneck but the
measured mobile LCP still spent most of its remaining time between image load
and final paint. This patch is deliberately scoped to the classic archive and
shared rental/product text; protected Match/Chaos/Baukasten markup/logic is not
modified.
"""
from pathlib import Path

BASE = Path(__file__).resolve().parents[1]
APP = BASE / "assets" / "app.js"
CSS = BASE / "assets" / "app.css"
BUILD = BASE / "build_site.py"
ARTICLE_CSS = BASE / "assets" / "article.css"
INDEX = BASE / "index.html"
MARKER = "FOCUS3_MEASURED_LCP_FOLLOWUP"


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if new in text:
        return text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"FEHLER: {label}: erwartete 1 Fundstelle, gefunden {count}")
    return text.replace(old, new, 1)


def patch_build(text: str) -> str:
    if MARKER in text:
        return text
    old = '+ \'" loading="eager" fetchpriority="high" decoding="async">\''
    new = '+ \'" loading="eager" fetchpriority="high" decoding="sync">\'  # FOCUS3_MEASURED_LCP_FOLLOWUP'
    return replace_once(text, old, new, "SSR LCP decoding")


def patch_app(text: str) -> str:
    if MARKER in text:
        return text

    # On the server-rendered mobile homepage, do not start the 180KB catalog
    # transfer and full hydration while the above-fold LCP image is still
    # waiting for its first paint. Two genuine product cards are already useful.
    old_fetch = '  fetch("/data/catalog.json").then(function (r) { return r.json(); }).then(function (ITEMS) {'
    new_fetch = '''  var focus3CatalogGate = Promise.resolve(); // FOCUS3_MEASURED_LCP_FOLLOWUP\n  var focus3SsrGrid = document.getElementById("grid");\n  if (focus3SsrGrid && focus3SsrGrid.getAttribute("data-ssr-initial") === "1" &&\n      window.matchMedia("(max-width: 600px)").matches) {\n    focus3CatalogGate = new Promise(function (resolve) {\n      var criticalImages = focus3SsrGrid.querySelectorAll(".plate__frame img");\n      var critical = criticalImages[1] || criticalImages[0];\n      var finished = false;\n      function release() {\n        if (finished) return;\n        finished = true;\n        requestAnimationFrame(function () { requestAnimationFrame(resolve); });\n      }\n      if (!critical || critical.complete) { release(); return; }\n      critical.addEventListener("load", release, { once: true });\n      critical.addEventListener("error", release, { once: true });\n      setTimeout(release, 1800);\n    });\n  }\n  focus3CatalogGate.then(function () {\n    return fetch("/data/catalog.json");\n  }).then(function (r) { return r.json(); }).then(function (ITEMS) {'''
    text = replace_once(text, old_fetch, new_fetch, "mobile catalog paint gate")

    # Keep the server-rendered first two IDs authoritative for the first default
    # render. This guarantees hydration cannot throw away an already painted LCP
    # node because of a subtle Python/JS stable-sort difference on equal values.
    old_visible = '''    var visibleItems = filtered.slice(0, visibleLimit);\n    countEl.textContent = tFormat("railCountTemplate", { filtered: filtered.length, total: PUBLIC_ITEMS.length });'''
    new_visible = '''    var visibleItems = filtered.slice(0, visibleLimit);\n    if (!firstGridRenderDone && gridEl.getAttribute("data-ssr-initial") === "1") {\n      var focus3InitialIds = Array.prototype.slice.call(gridEl.querySelectorAll("[data-ssr-item-id]")).map(function (plate) {\n        return Number(plate.getAttribute("data-ssr-item-id"));\n      }).filter(Boolean);\n      if (focus3InitialIds.length) {\n        var focus3ById = {};\n        filtered.forEach(function (item) { focus3ById[Number(item.id)] = item; });\n        var focus3Pinned = focus3InitialIds.map(function (id) { return focus3ById[id]; }).filter(Boolean);\n        if (focus3Pinned.length === focus3InitialIds.length) {\n          var focus3PinnedSet = {};\n          focus3InitialIds.forEach(function (id) { focus3PinnedSet[id] = true; });\n          visibleItems = focus3Pinned.concat(filtered.filter(function (item) { return !focus3PinnedSet[Number(item.id)]; })).slice(0, visibleLimit);\n        }\n      }\n    }\n    countEl.textContent = tFormat("railCountTemplate", { filtered: filtered.length, total: PUBLIC_ITEMS.length });'''
    text = replace_once(text, old_visible, new_visible, "SSR hydration order alignment")

    # Critical cards decode synchronously; below-fold cards are explicitly low
    # priority. This removes decode/network competition from the LCP window.
    old = '''      var heroLoading = idx < 4 ? "eager" : "lazy";\n      var heroPriority = idx < 2 ? ' fetchpriority="high"' : "";\n      var pictureHtml = "";'''
    new = '''      var heroLoading = idx < 2 ? "eager" : "lazy";\n      var heroPriority = idx < 2 ? ' fetchpriority="high"' : ' fetchpriority="low"';\n      var heroDecoding = idx < 2 ? "sync" : "async";\n      var pictureHtml = "";'''
    text = replace_once(text, old, new, "critical image priorities")
    old_picture = '''        pictureHtml = '<picture>' + mobileSource + '<img src="' + imgSrc + '" alt="' + altText + '" loading="' + heroLoading + '"' + heroPriority + ' decoding="async"></picture>';'''
    new_picture = '''        pictureHtml = '<picture>' + mobileSource + '<img src="' + imgSrc + '" alt="' + altText + '" loading="' + heroLoading + '"' + heroPriority + ' decoding="' + heroDecoding + '"></picture>';'''
    text = replace_once(text, old_picture, new_picture, "critical decode mode")
    return text


def patch_css(text: str) -> str:
    if MARKER in text:
        return text
    block = r'''

  /* FOCUS3_MEASURED_LCP_FOLLOWUP
     axe measured transient contrast on cards 3+ while their opacity entrance
     animation was below 1. Keep the distinctive translate/scale entrance but
     never make readable product text translucent. The brand target is enlarged
     slightly beyond 24px to avoid device-pixel rounding failures. */
  #appShell .plate.plate--enter { opacity: 1 !important; }
  #appShell .plate__brand { min-height: 32px; min-width: 32px; padding: 4px 2px; }

  /* Measured Rental V2 contrast findings. Text-only contrast fix; pricing,
     layout and protected creative modes remain untouched. */
  #d119RentalV2Title,
  .d119-rental-set-copy strong,
  .d119-rental-set-copy span,
  .d119-rental-set-add__label,
  .d119-rental-process-details > summary,
  .d119-rental-v2__section h3,
  .d119-rental-item__meta strong,
  .d119-rental-item__meta span {
    color: #f2efe7 !important;
  }
'''
    return text.rstrip() + block + "\n"


def patch_article_css(text: str) -> str:
    if MARKER in text:
        return text
    block = r'''

/* FOCUS3_MEASURED_LCP_FOLLOWUP — measured product-footer contrast. */
p[data-i18n="footerNote"] { color: rgba(242, 239, 231, 0.82) !important; }
'''
    return text.rstrip() + block + "\n"


def patch_generated_index(text: str) -> str:
    # The workflow invokes this measured follow-up after build via the Focus-3
    # validator, so keep the already-generated homepage aligned with build_site.
    if 'data-ssr-initial="1"' not in text:
        return text
    return text.replace('fetchpriority="high" decoding="async"', 'fetchpriority="high" decoding="sync"', 2)


def main() -> None:
    changed = []
    targets = [(BUILD, patch_build), (APP, patch_app), (CSS, patch_css), (ARTICLE_CSS, patch_article_css)]
    if INDEX.is_file():
        targets.append((INDEX, patch_generated_index))
    for path, fn in targets:
        before = path.read_text(encoding="utf-8")
        after = fn(before)
        if after != before:
            path.write_text(after, encoding="utf-8")
            changed.append(str(path.relative_to(BASE)))
    print("Focus-3 Mess-Followup: " + (", ".join(changed) if changed else "bereits aktuell"))


if __name__ == "__main__":
    main()

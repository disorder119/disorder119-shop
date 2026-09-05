#!/usr/bin/env python3
"""Apply the Disorder119 9.5 quality polish deterministically.

Scope is deliberately limited to classic archive/cart, product pages and Rental V2.
Match, Chaos and Baukasten are not patched here. Rental pricing/deposit constants
are never changed.
"""
from __future__ import annotations

from pathlib import Path

BASE = Path(__file__).resolve().parents[1]


def replace_once(path: str, old: str, new: str, marker: str) -> None:
    target = BASE / path
    text = target.read_text(encoding="utf-8")
    if marker in text:
        return
    if old not in text:
        raise SystemExit(f"FEHLER: erwarteter Quellblock fehlt in {path}: {marker}")
    target.write_text(text.replace(old, new, 1), encoding="utf-8")
    print(f"aktualisiert: {path} -> {marker}")


def append_once(path: str, addon: str, marker: str) -> None:
    target = BASE / path
    text = target.read_text(encoding="utf-8")
    if marker in text:
        return
    target.write_text(text.rstrip() + "\n\n" + addon.strip() + "\n", encoding="utf-8")
    print(f"ergänzt: {path} -> {marker}")


def patch_filter_drawer() -> None:
    path = BASE / "assets" / "catalog-filter-simplify.js"
    text = path.read_text(encoding="utf-8")
    marker = "QUALITY95_FILTER_DRAWER"
    if marker in text:
        return
    start_marker = "/* Compact desktop controls + mobile bottom drawer. */"
    start = text.find(start_marker)
    if start < 0:
        raise SystemExit("FEHLER: bestehender kompakter Filter-Drawer fehlt")
    addon = r'''/* Compact desktop controls + accessible mobile bottom drawer. QUALITY95_FILTER_DRAWER */
(function () {
  "use strict";
  var MARKER_ID = "d119CompactFilterDrawer";
  var MOBILE = "(max-width: 720px)";
  var wasOpen = false;
  var previousFocus = null;
  var COPY = {
    de: { filter: "Filter", close: "Schließen", apply: "{count} Artikel anzeigen" },
    en: { filter: "Filters", close: "Close", apply: "Show {count} items" },
    fr: { filter: "Filtres", close: "Fermer", apply: "Afficher {count} articles" }
  };

  function lang() {
    var value = String(document.documentElement.lang || "de").toLowerCase();
    return value.indexOf("en") === 0 ? "en" : value.indexOf("fr") === 0 ? "fr" : "de";
  }
  function t(key, count) {
    return String((COPY[lang()] || COPY.de)[key] || "").replace("{count}", String(count == null ? 0 : count));
  }
  function isMobile() { return !!(window.matchMedia && window.matchMedia(MOBILE).matches); }
  function resultCount() {
    var el = document.getElementById("railCount");
    var match = /\d+/.exec(String(el && el.textContent || ""));
    return match ? Number(match[0]) : 0;
  }
  function activeCount() {
    var count = 0;
    ["filterDepartment", "filterBrand", "filterSize", "filterColor", "filterCondition"].forEach(function (id) {
      var el = document.getElementById(id);
      if (el && el.value) count++;
    });
    var min = document.getElementById("filterPriceMin"), max = document.getElementById("filterPriceMax");
    if ((min && min.value) || (max && max.value)) count++;
    return count;
  }
  function injectStyle() {
    if (document.getElementById(MARKER_ID + "Style")) return;
    var style = document.createElement("style");
    style.id = MARKER_ID + "Style";
    style.textContent = [
      ".filter-panel{gap:10px;padding-top:12px}.filter-field{gap:5px}.active-filter-row{gap:6px}.active-filter-row .chip{font-size:.66rem;padding:4px 8px}",
      ".plate__size{display:inline-flex;align-self:flex-start;max-width:100%;margin-top:5px;padding:2px 5px;border:1px solid var(--mount-rule);color:var(--mount-text);font-size:.58rem;line-height:1.3;letter-spacing:.08em;text-transform:uppercase;font-weight:500;white-space:normal;overflow-wrap:anywhere;opacity:.72}",
      ".d119-filter-drawer__head,.d119-filter-drawer__foot{display:none}.d119-filter-backdrop{display:none}",
      "@media(max-width:720px){body.d119-filter-open{overflow:hidden;touch-action:none}.d119-filter-backdrop{position:fixed;inset:0;z-index:129;display:block;background:rgba(0,0,0,.56);border:0;padding:0}.d119-filter-backdrop[hidden]{display:none}.filter-panel.d119-filter-drawer{position:fixed;inset:auto 0 0;z-index:130;width:100%;max-height:min(82dvh,680px);display:grid;grid-template-columns:1fr;gap:0;margin:0;padding:0 0 max(12px,env(safe-area-inset-bottom));overflow:auto;overscroll-behavior:contain;background:var(--bg);border-top:1px solid var(--rule-strong);box-shadow:0 -18px 50px rgba(0,0,0,.4)}.filter-panel.d119-filter-drawer.hidden{display:none}.d119-filter-drawer .filter-field{padding:0 18px 12px}.d119-filter-drawer .filter-field select,.d119-filter-drawer .filter-price-inputs input{min-height:44px;font-size:.82rem}.d119-filter-drawer .filter-reset{min-height:44px;margin:0 18px 12px;padding:8px 0}.d119-filter-drawer__head{position:sticky;top:0;z-index:2;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 14px 11px 18px;background:var(--bg);border-bottom:1px solid var(--rule);margin-bottom:14px}.d119-filter-drawer__title{font-size:.72rem;letter-spacing:.1em;text-transform:uppercase;font-weight:600}.d119-filter-drawer__close{appearance:none;min-width:44px;min-height:44px;border:0;background:transparent;color:var(--text-muted);font:inherit;font-size:.7rem;text-decoration:underline;text-underline-offset:3px;padding:8px;cursor:pointer}.d119-filter-drawer__foot{position:sticky;bottom:0;z-index:2;display:block;padding:12px 18px max(14px,env(safe-area-inset-bottom));background:var(--bg);border-top:1px solid var(--rule)}.d119-filter-drawer__apply{appearance:none;width:100%;min-height:46px;border:1px solid var(--text);background:var(--text);color:var(--bg);font:inherit;font-size:.72rem;letter-spacing:.06em;text-transform:uppercase;padding:12px 14px;cursor:pointer}.d119-filter-drawer :focus-visible{outline:2px solid var(--accent-text);outline-offset:2px}.rail__right{gap:8px}.plate__size{font-size:.56rem;margin-top:4px}}"
    ].join("");
    document.head.appendChild(style);
  }
  function focusables(panel) {
    return Array.prototype.filter.call(panel.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[href],[tabindex]:not([tabindex="-1"])'), function (el) {
      return !el.hidden && el.getAttribute("aria-hidden") !== "true";
    });
  }
  function closeDrawer() {
    var panel = document.getElementById("filterPanel");
    var toggle = document.getElementById("moreFiltersToggle");
    if (!panel) return;
    panel.classList.add("hidden");
    if (toggle) toggle.setAttribute("aria-expanded", "false");
    refresh();
    var target = previousFocus && previousFocus.isConnected ? previousFocus : toggle;
    if (target && target.focus) target.focus();
  }
  function refresh() {
    var panel = document.getElementById("filterPanel");
    var toggle = document.getElementById("moreFiltersToggle");
    var backdrop = document.getElementById(MARKER_ID + "Backdrop");
    if (!panel) return;
    var title = panel.querySelector(".d119-filter-drawer__title");
    var close = panel.querySelector(".d119-filter-drawer__close");
    var apply = panel.querySelector(".d119-filter-drawer__apply");
    if (title) title.textContent = t("filter");
    if (close) close.textContent = t("close");
    if (apply) apply.textContent = t("apply", resultCount());
    if (toggle) toggle.textContent = t("filter") + (activeCount() ? " · " + activeCount() : "");
    var open = isMobile() && !panel.classList.contains("hidden");
    document.body.classList.toggle("d119-filter-open", open);
    if (backdrop) backdrop.hidden = !open;
    if (open) {
      panel.setAttribute("role", "dialog");
      panel.setAttribute("aria-modal", "true");
      panel.setAttribute("aria-labelledby", MARKER_ID + "Title");
      if (!wasOpen) {
        previousFocus = document.activeElement;
        window.setTimeout(function () {
          var first = panel.querySelector(".d119-filter-drawer__close");
          if (first && first.focus) first.focus();
        }, 0);
      }
    } else {
      panel.removeAttribute("role");
      panel.removeAttribute("aria-modal");
      panel.removeAttribute("aria-labelledby");
    }
    wasOpen = open;
  }
  function init() {
    var panel = document.getElementById("filterPanel");
    if (!panel || document.getElementById(MARKER_ID)) return;
    injectStyle();
    panel.classList.add("d119-filter-drawer");
    var marker = document.createElement("span");
    marker.id = MARKER_ID;
    marker.hidden = true;
    panel.appendChild(marker);
    var head = document.createElement("div");
    head.className = "d119-filter-drawer__head";
    head.innerHTML = '<span class="d119-filter-drawer__title" id="' + MARKER_ID + 'Title"></span><button type="button" class="d119-filter-drawer__close"></button>';
    panel.insertBefore(head, panel.firstChild);
    var foot = document.createElement("div");
    foot.className = "d119-filter-drawer__foot";
    foot.innerHTML = '<button type="button" class="d119-filter-drawer__apply"></button>';
    panel.appendChild(foot);
    var backdrop = document.createElement("button");
    backdrop.type = "button";
    backdrop.id = MARKER_ID + "Backdrop";
    backdrop.className = "d119-filter-backdrop";
    backdrop.tabIndex = -1;
    backdrop.setAttribute("aria-hidden", "true");
    backdrop.hidden = true;
    panel.parentNode.insertBefore(backdrop, panel);
    head.querySelector("button").addEventListener("click", closeDrawer);
    foot.querySelector("button").addEventListener("click", closeDrawer);
    backdrop.addEventListener("click", closeDrawer);
    document.addEventListener("keydown", function (event) {
      if (!isMobile() || panel.classList.contains("hidden")) return;
      if (event.key === "Escape") { event.preventDefault(); closeDrawer(); return; }
      if (event.key !== "Tab") return;
      var list = focusables(panel);
      if (!list.length) return;
      var first = list[0], last = list[list.length - 1];
      if (!panel.contains(document.activeElement)) { event.preventDefault(); first.focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
    ["filterDepartment", "filterBrand", "filterSize", "filterColor", "filterCondition", "filterPriceMin", "filterPriceMax"].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) { el.addEventListener("change", refresh); el.addEventListener("input", refresh); }
    });
    window.addEventListener("resize", refresh, { passive: true });
    if (typeof MutationObserver !== "undefined") {
      new MutationObserver(refresh).observe(panel, { attributes: true, attributeFilter: ["class"] });
      var count = document.getElementById("railCount");
      if (count) new MutationObserver(refresh).observe(count, { childList: true, subtree: true, characterData: true });
    }
    refresh();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
'''
    path.write_text(text[:start].rstrip() + "\n\n" + addon.strip() + "\n", encoding="utf-8")
    print("aktualisiert: assets/catalog-filter-simplify.js -> accessible modal drawer")


def patch_app_search_and_cart() -> None:
    replace_once(
        "assets/app.js",
        '''  function fuzzyIncludes(haystack, needle) {\n    if (!needle) return true;\n    if (haystack.indexOf(needle) !== -1) return true;\n    if (needle.length < 4) return false;''',
        '''  function fuzzyIncludes(haystack, needle) {\n    if (!needle) return true;\n    if (haystack.indexOf(needle) !== -1) return true;\n    // Exakte Schreibvarianten mit Bindestrich, Punkt, Slash oder Leerzeichen\n    // sollen gleich behandelt werden (z. B. Y3 / Y-3 / Y 3), ohne die\n    // Tippfehlertoleranz aggressiver zu machen. QUALITY95_SEARCH_COMPACT\n    var compactHay = haystack.replace(/[^a-z0-9]+/g, "");\n    var compactNeedle = needle.replace(/[^a-z0-9]+/g, "");\n    if (compactNeedle.length >= 2 && compactHay.indexOf(compactNeedle) !== -1) return true;\n    if (needle.length < 4) return false;''',
        "QUALITY95_SEARCH_COMPACT",
    )
    replace_once(
        "assets/app.js",
        '''  var CART_KEY = "disorder119_cart";\n  var cart = loadCart();''',
        '''  var CART_KEY = "disorder119_cart";\n  var cart = loadCart();\n  // Nur fuer die aktuelle Sitzung: optionale Kundennachricht wird nicht\n  // dauerhaft gespeichert, aber in jede erzeugte Kaufanfrage übernommen.\n  var cartOrderMessage = ""; // QUALITY95_CART_MESSAGE\n  function purchaseMessageLabel() {\n    return LANG === "fr" ? "Message client" : LANG === "en" ? "Customer message" : "Kundennachricht";\n  }\n  function purchaseMessagePlaceholder() {\n    return LANG === "fr" ? "Question, mesures, souhait de livraison …" : LANG === "en" ? "Question, measurements, shipping request …" : "Frage, Maße, Versandwunsch …";\n  }''',
        "QUALITY95_CART_MESSAGE",
    )
    replace_once(
        "assets/app.js",
        '''      "\\n\\n" + t("cartTotal") + ": " + fmtPrice(total) +\n      "\\n" + (LANG === "de" ? "Zeitpunkt" : LANG === "fr" ? "Horodatage" : "Timestamp") + ": " + new Date().toLocaleString() +\n      "\\n\\n" + t("orderAvailQuestion");''',
        '''      "\\n\\n" + t("cartTotal") + ": " + fmtPrice(total) +\n      (cartOrderMessage.trim() ? "\\n" + purchaseMessageLabel() + ": " + cartOrderMessage.trim() : "") +\n      "\\n" + (LANG === "de" ? "Zeitpunkt" : LANG === "fr" ? "Horodatage" : "Timestamp") + ": " + new Date().toLocaleString() +\n      "\\n\\n" + t("orderAvailQuestion");''',
        "cartOrderMessage.trim() ?",
    )
    old = '''    var hasWhatsapp = !!SHOP_CONFIG.whatsappNumber;\n    var hasEmail = !!SHOP_CONFIG.email;\n    var encoded = encodeURIComponent(buildOrderText());\n\n    var footHtml = '<div class="cart-total"><span>' + t("cartTotal") + '</span><span>' + fmtPrice(total) + "</span></div>";\n    if (hasWhatsapp) {\n      footHtml += '<a class="cart-checkout-btn cart-checkout-btn--whatsapp" target="_blank" rel="noopener" href="https://wa.me/' +\n        SHOP_CONFIG.whatsappNumber + '?text=' + encoded + '">' + t("cartWhatsapp") + '</a>';\n    }\n    if (hasEmail) {\n      footHtml += '<a class="cart-checkout-btn cart-checkout-btn--email" href="mailto:' + SHOP_CONFIG.email +\n        '?subject=' + encodeURIComponent(t("orderSubject")) + '&body=' + encoded + '">' + t("cartEmail") + '</a>';\n    }\n    if (!hasWhatsapp && !hasEmail) {\n      footHtml += '<p class="cart-config-warning">' + t("cartConfigWarning") + '</p>';\n    }\n    footHtml += '<p class="cart-note">' + t("cartNote") + '</p>';\n    foot.innerHTML = footHtml;'''
    new = '''    var hasWhatsapp = !!SHOP_CONFIG.whatsappNumber;\n    var hasEmail = !!SHOP_CONFIG.email;\n    var footHtml = '<div class="cart-total"><span>' + t("cartTotal") + '</span><span>' + fmtPrice(total) + "</span></div>" +\n      '<label class="cart-order-message"><span>' + purchaseMessageLabel() + ' <small>(' + (LANG === "de" ? "optional" : LANG === "fr" ? "facultatif" : "optional") + ')</small></span>' +\n      '<textarea id="cartOrderMessage" maxlength="500" placeholder="' + escapeHtml(purchaseMessagePlaceholder()) + '">' + escapeHtml(cartOrderMessage) + '</textarea></label>';\n    if (hasWhatsapp) {\n      footHtml += '<a class="cart-checkout-btn cart-checkout-btn--whatsapp" data-cart-inquiry="whatsapp" target="_blank" rel="noopener" href="#">' + t("cartWhatsapp") + '</a>';\n    }\n    if (hasEmail) {\n      footHtml += '<a class="cart-checkout-btn cart-checkout-btn--email" data-cart-inquiry="email" href="#">' + t("cartEmail") + '</a>';\n    }\n    if (!hasWhatsapp && !hasEmail) {\n      footHtml += '<p class="cart-config-warning">' + t("cartConfigWarning") + '</p>';\n    }\n    footHtml += '<p class="cart-note">' + t("cartNote") + '</p>';\n    foot.innerHTML = footHtml;\n\n    function refreshCartInquiryLinks() {\n      var encoded = encodeURIComponent(buildOrderText());\n      var wa = foot.querySelector('[data-cart-inquiry="whatsapp"]');\n      var email = foot.querySelector('[data-cart-inquiry="email"]');\n      if (wa) wa.href = "https://wa.me/" + SHOP_CONFIG.whatsappNumber + "?text=" + encoded;\n      if (email) email.href = "mailto:" + SHOP_CONFIG.email + "?subject=" + encodeURIComponent(t("orderSubject")) + "&body=" + encoded;\n    }\n    var messageInput = foot.querySelector("#cartOrderMessage");\n    if (messageInput) messageInput.addEventListener("input", function () {\n      cartOrderMessage = messageInput.value.slice(0, 500);\n      refreshCartInquiryLinks();\n    });\n    refreshCartInquiryLinks(); // QUALITY95_CART_LINK_REFRESH'''
    replace_once("assets/app.js", old, new, "QUALITY95_CART_LINK_REFRESH")

    append_once(
        "assets/app.css",
        '''/* QUALITY95_CART_MESSAGE_STYLE — scoped to the classic cart only. */\n.cart-order-message{display:block;margin:12px 0 14px;font-size:.68rem;line-height:1.35;color:var(--text-muted)}\n.cart-order-message>span{display:block;margin-bottom:6px;letter-spacing:.04em;text-transform:uppercase}\n.cart-order-message small{font-size:inherit;text-transform:none;letter-spacing:0;color:var(--text-faint)}\n.cart-order-message textarea{display:block;width:100%;min-height:72px;max-height:150px;resize:vertical;border:1px solid var(--rule-strong);border-radius:0;background:transparent;color:var(--text);font:inherit;font-size:.78rem;line-height:1.45;padding:10px}\n.cart-order-message textarea:focus-visible{outline:2px solid var(--accent-text);outline-offset:2px;border-color:var(--accent-text)}''',
        "QUALITY95_CART_MESSAGE_STYLE",
    )


def patch_build_source_terms() -> None:
    replace_once("build_site.py", '"<h3>Wie die Miete funktiert</h3>"', '"<h3>Wie die Miete funktioniert</h3>"', "Wie die Miete funktioniert")
    replace_once(
        "build_site.py",
        '''        "<li><strong>Mietpreis:</strong> in der Regel ca. 15&nbsp;% des im Archiv angegebenen "\n        "Preises pro Zeitraum von bis zu 4 Tagen (Richtwert — der genaue Preis wird bei jeder "\n        "Anfrage persönlich bestätigt, abhängig von Stück und Zeitraum).</li>"''',
        '''        "<li><strong>Mietpreis:</strong> exakt 10&nbsp;% des im Archiv angegebenen Verkaufspreises "\n        "pro ausgewähltem Kalendertag. Standardmäßig sind bis zu 7 Miettage auswählbar; Start- und "\n        "Rückgabetag zählen jeweils als Miettag.</li>"''',
        "exakt 10&nbsp;% des im Archiv angegebenen Verkaufspreises",
    )
    replace_once(
        "build_site.py",
        '''        "<li><strong>Rental price:</strong> typically around 15% of the archive price per period of up "\n        "to 4 days (a guideline — the exact price is confirmed personally for every request, depending "\n        "on the piece and duration).</li>"''',
        '''        "<li><strong>Rental price:</strong> exactly 10% of the listed archive sale price per selected "\n        "calendar day. Up to 7 rental days can be selected as standard; both start and return day count.</li>"''',
        "exactly 10% of the listed archive sale price",
    )
    replace_once(
        "build_site.py",
        '''        "<li><strong>Prix de location :</strong> environ 15&nbsp;% du prix indiqué dans l'archive par "\n        "période de 4 jours maximum (indicatif — le prix exact est confirmé personnellement pour chaque "\n        "demande, selon la pièce et la durée).</li>"''',
        '''        "<li><strong>Prix de location :</strong> exactement 10&nbsp;% du prix de vente indiqué dans "\n        "l’archive par jour calendaire sélectionné. Jusqu’à 7 jours de location sont sélectionnables par "\n        "défaut ; le premier et le dernier jour comptent chacun comme jour de location.</li>"''',
        "exactement 10&nbsp;% du prix de vente indiqué",
    )


def patch_rental_v2() -> None:
    replace_once(
        "assets/rental-v2.js",
        '''  var overlay = null;\n  var toastTimer = null;''',
        '''  var overlay = null;\n  var overlayPreviousFocus = null; // QUALITY95_RENTAL_FOCUS_RETURN\n  var toastTimer = null;''',
        "QUALITY95_RENTAL_FOCUS_RETURN",
    )
    replace_once(
        "assets/rental-v2.js",
        '''      ".d119-rental-v2__close{border:0;background:transparent;color:inherit;font-size:22px;cursor:pointer}",''',
        '''      ".d119-rental-v2__close{min-width:44px;min-height:44px;border:0;background:transparent;color:inherit;font-size:22px;cursor:pointer}",''',
        "min-width:44px;min-height:44px;border:0",
    )
    replace_once(
        "assets/rental-v2.js",
        '''      ".d119-rental-item__remove{border:0;background:transparent;color:inherit;text-decoration:underline;cursor:pointer;font:inherit;font-size:11px}",''',
        '''      ".d119-rental-item__remove{min-width:44px;min-height:44px;border:0;background:transparent;color:inherit;text-decoration:underline;cursor:pointer;font:inherit;font-size:11px}",''',
        "d119-rental-item__remove{min-width:44px",
    )
    replace_once(
        "assets/rental-v2.js",
        '''      ".d119-rental-field input,.d119-rental-field select,.d119-rental-field textarea{width:100%;box-sizing:border-box;border:1px solid var(--line,#aaa);background:transparent;color:inherit;padding:10px;font:inherit}",''',
        '''      ".d119-rental-field input,.d119-rental-field select,.d119-rental-field textarea{width:100%;min-height:44px;box-sizing:border-box;border:1px solid var(--line,#aaa);background:transparent;color:inherit;padding:10px;font:inherit}",''',
        "textarea{width:100%;min-height:44px",
    )
    replace_once(
        "assets/rental-v2.js",
        '''      ".d119-rental-actions a{display:block;text-align:center;text-decoration:none;border:1px solid currentColor;color:inherit;padding:12px}",''',
        '''      ".d119-rental-actions a{display:flex;min-height:46px;align-items:center;justify-content:center;text-align:center;text-decoration:none;border:1px solid currentColor;color:inherit;padding:12px}",\n      ".d119-rental-process-details{margin:0}.d119-rental-process-details summary{min-height:44px;display:flex;align-items:center;cursor:pointer;font-size:12px;text-transform:uppercase;letter-spacing:.08em}.d119-rental-process-details[open] summary{margin-bottom:14px}.d119-rental-v2 :focus-visible{outline:2px solid currentColor;outline-offset:2px}",''',
        "d119-rental-process-details",
    )
    replace_once(
        "assets/rental-v2.js",
        '''    el.className = "d119-rental-toast";\n    el.textContent = message;''',
        '''    el.className = "d119-rental-toast";\n    el.setAttribute("role", "status");\n    el.setAttribute("aria-live", "polite"); // QUALITY95_RENTAL_LIVE\n    el.textContent = message;''',
        "QUALITY95_RENTAL_LIVE",
    )
    old = '''    backdrop.addEventListener("click", function (e) { if (e.target === backdrop) closeOverlay(); });\n    backdrop.querySelector(".d119-rental-v2__close").addEventListener("click", closeOverlay);\n    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && backdrop.classList.contains("open")) closeOverlay(); });'''
    new = '''    backdrop.addEventListener("click", function (e) { if (e.target === backdrop) closeOverlay(); });\n    backdrop.querySelector(".d119-rental-v2__close").addEventListener("click", closeOverlay);\n    document.addEventListener("keydown", function (e) {\n      if (!backdrop.classList.contains("open") || document.getElementById("d119RentalIntegratedPicker")) return;\n      if (e.key === "Escape") { e.preventDefault(); closeOverlay(); return; }\n      if (e.key !== "Tab") return;\n      var focusables = backdrop.querySelectorAll('button:not([disabled]),[href]:not([aria-disabled="true"]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])');\n      if (!focusables.length) return;\n      var first = focusables[0], last = focusables[focusables.length - 1];\n      if (!backdrop.contains(document.activeElement)) { e.preventDefault(); first.focus(); }\n      else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }\n      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }\n    }); // QUALITY95_RENTAL_FOCUS_TRAP'''
    replace_once("assets/rental-v2.js", old, new, "QUALITY95_RENTAL_FOCUS_TRAP")
    old = '''  function openOverlay() {\n    createOverlay();\n    renderOverlay();\n    overlay.classList.add("open");\n    document.documentElement.style.overflow = "hidden";\n    var close = overlay.querySelector(".d119-rental-v2__close");\n    if (close) close.focus();\n  }\n  function closeOverlay() {\n    if (!overlay) return;\n    overlay.classList.remove("open");\n    document.documentElement.style.overflow = "";\n  }'''
    new = '''  function openOverlay() {\n    createOverlay();\n    renderOverlay();\n    overlayPreviousFocus = document.activeElement;\n    overlay.classList.add("open");\n    document.documentElement.style.overflow = "hidden";\n    document.body.style.overflow = "hidden";\n    var close = overlay.querySelector(".d119-rental-v2__close");\n    if (close) close.focus();\n  }\n  function closeOverlay() {\n    if (!overlay) return;\n    overlay.classList.remove("open");\n    document.documentElement.style.overflow = "";\n    document.body.style.overflow = "";\n    var target = overlayPreviousFocus;\n    overlayPreviousFocus = null;\n    if (target && target.isConnected && target.focus) target.focus();\n  }'''
    replace_once("assets/rental-v2.js", old, new, "overlayPreviousFocus = document.activeElement")
    replace_once(
        "assets/rental-v2.js",
        '''      '<div class="d119-rental-v2__section"><h3>' + esc(t("processTitle")) + '</h3><div class="d119-rental-process">' + process + '</div><div class="d119-rental-trust" style="margin-top:16px">' + trust + '</div></div>' +''',
        '''      '<div class="d119-rental-v2__section"><details class="d119-rental-process-details"><summary>' + esc(t("processTitle")) + '</summary><div class="d119-rental-process">' + process + '</div><div class="d119-rental-trust" style="margin-top:16px">' + trust + '</div></details></div>' +''',
        '<details class="d119-rental-process-details">',
    )
    replace_once(
        "assets/rental-v2.js",
        '''      '<p class="d119-rental-note">' + esc(t("maxDays")) + '</p><p class="d119-rental-note">' + esc(t("longPeriod")) + '</p><p class="d119-rental-error" id="d119RentalDateStatus"></p></div>' +''',
        '''      '<p class="d119-rental-note">' + esc(t("maxDays")) + '</p><p class="d119-rental-error" id="d119RentalDateStatus" aria-live="polite"></p></div>' +''',
        'id="d119RentalDateStatus" aria-live="polite"',
    )
    replace_once(
        "assets/rental-v2.js",
        '''      '<p class="d119-rental-error" id="d119RentalAvailability">' + esc(SHOP_CONFIG.shopWorkerUrl ? t("availabilityChecking") : t("availabilityManual")) + '</p></div>' +''',
        '''      '<p class="d119-rental-error" id="d119RentalAvailability" aria-live="polite">' + esc(SHOP_CONFIG.shopWorkerUrl ? t("availabilityChecking") : t("availabilityManual")) + '</p></div>' +''',
        'id="d119RentalAvailability" aria-live="polite"',
    )


def patch_rental_picker() -> None:
    replace_once(
        "assets/rental-v2-picker.js",
        '''  var picker = null;\n  var previousFocus = null;''',
        '''  var picker = null;\n  var previousFocus = null;\n  var CATEGORY_LABELS = { // QUALITY95_PICKER_I18N\n    Jackets: { de: "Jacken", en: "Jackets", fr: "Vestes" }, Coats: { de: "Mäntel", en: "Coats", fr: "Manteaux" },\n    Tops: { de: "Oberteile", en: "Tops", fr: "Hauts" }, Shirts: { de: "Hemden / Shirts", en: "Shirts", fr: "Chemises / T-shirts" },\n    Knitwear: { de: "Strick", en: "Knitwear", fr: "Maille" }, Pants: { de: "Hosen", en: "Pants", fr: "Pantalons" },\n    Skirts: { de: "Röcke", en: "Skirts", fr: "Jupes" }, Dresses: { de: "Kleider", en: "Dresses", fr: "Robes" },\n    Shoes: { de: "Schuhe", en: "Shoes", fr: "Chaussures" }, Accessories: { de: "Accessoires", en: "Accessories", fr: "Accessoires" },\n    Objects: { de: "Objekte", en: "Objects", fr: "Objets" }\n  };\n  function categoryLabel(value) { var row = CATEGORY_LABELS[value]; return row ? (row[LANG] || row.de) : value; }''',
        "QUALITY95_PICKER_I18N",
    )
    replace_once(
        "assets/rental-v2-picker.js",
        '''      ".d119-rental-picker__back{appearance:none;border:0;background:transparent;color:inherit;padding:0 0 12px;font:inherit;font-size:11px;cursor:pointer;text-decoration:underline;text-underline-offset:3px}",''',
        '''      ".d119-rental-picker__back{appearance:none;min-height:44px;border:0;background:transparent;color:inherit;padding:8px 0 10px;font:inherit;font-size:11px;cursor:pointer;text-decoration:underline;text-underline-offset:3px}",''',
        "d119-rental-picker__back{appearance:none;min-height:44px",
    )
    replace_once(
        "assets/rental-v2-picker.js",
        '''      ".d119-rental-picker__chip{appearance:none;white-space:nowrap;border:1px solid var(--line,#aaa);background:transparent;color:inherit;padding:7px 10px;font:inherit;font-size:10px;cursor:pointer}",''',
        '''      ".d119-rental-picker__chip{appearance:none;min-height:44px;white-space:nowrap;border:1px solid var(--line,#aaa);background:transparent;color:inherit;padding:8px 11px;font:inherit;font-size:10px;cursor:pointer}",''',
        "d119-rental-picker__chip{appearance:none;min-height:44px",
    )
    replace_once(
        "assets/rental-v2-picker.js",
        '''      ".d119-rental-picker-card__action{appearance:none;border:1px solid currentColor;background:transparent;color:inherit;width:100%;padding:9px 8px;margin-top:6px;font:inherit;font-size:10px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:7px}",''',
        '''      ".d119-rental-picker-card__action{appearance:none;min-height:44px;border:1px solid currentColor;background:transparent;color:inherit;width:100%;padding:9px 8px;margin-top:6px;font:inherit;font-size:10px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:7px}",''',
        "d119-rental-picker-card__action{appearance:none;min-height:44px",
    )
    replace_once(
        "assets/rental-v2-picker.js",
        '''      ".d119-rental-picker__done{appearance:none;width:100%;border:1px solid currentColor;background:var(--ink,#111);color:var(--surface,#fff);padding:12px 14px;font:inherit;font-size:12px;cursor:pointer}",''',
        '''      ".d119-rental-picker__done{appearance:none;width:100%;min-height:46px;border:1px solid currentColor;background:var(--ink,#111);color:var(--surface,#fff);padding:12px 14px;font:inherit;font-size:12px;cursor:pointer}",\n      ".d119-rental-picker :focus-visible{outline:2px solid currentColor;outline-offset:2px}",''',
        "d119-rental-picker__done{appearance:none;width:100%;min-height:46px",
    )
    replace_once(
        "assets/rental-v2-picker.js",
        '''    return Object.keys(seen).sort(function (a, b) { return a.localeCompare(b, LOCALE); });''',
        '''    return Object.keys(seen).sort(function (a, b) { return categoryLabel(a).localeCompare(categoryLabel(b), LOCALE); });''',
        "categoryLabel(a).localeCompare",
    )
    replace_once(
        "assets/rental-v2-picker.js",
        '''      return normalize([item.brand, item.title, item.article, item.id, item.category, item.size].join(" ")).indexOf(q) >= 0;''',
        '''      var hay = normalize([item.brand, item.title, item.article, item.id, item.category, item.size].join(" "));\n      if (hay.indexOf(q) >= 0) return true;\n      var compactHay = hay.replace(/[^a-z0-9]+/g, "");\n      var compactQ = q.replace(/[^a-z0-9]+/g, "");\n      return compactQ.length >= 2 && compactHay.indexOf(compactQ) >= 0; // QUALITY95_PICKER_SEARCH''',
        "QUALITY95_PICKER_SEARCH",
    )
    replace_once(
        "assets/rental-v2-picker.js",
        '''        html += '<button type="button" class="d119-rental-picker__chip" data-picker-category="' + esc(cat) + '" aria-pressed="' + (activeCategory === cat ? "true" : "false") + '">' + esc(cat) + '</button>';''',
        '''        html += '<button type="button" class="d119-rental-picker__chip" data-picker-category="' + esc(cat) + '" aria-pressed="' + (activeCategory === cat ? "true" : "false") + '">' + esc(categoryLabel(cat)) + '</button>';''',
        "esc(categoryLabel(cat))",
    )
    replace_once(
        "assets/rental-v2-picker.js",
        '''    el.className = "d119-rental-picker";\n    el.setAttribute("aria-label", t("title"));\n    el.innerHTML = '<div class="d119-rental-picker__head">' +''',
        '''    el.className = "d119-rental-picker";\n    el.setAttribute("role", "region");\n    el.setAttribute("aria-labelledby", "d119PickerTitle");\n    el.innerHTML = '<div class="d119-rental-picker__head">' +''',
        'aria-labelledby", "d119PickerTitle"',
    )
    replace_once(
        "assets/rental-v2-picker.js",
        '''      '<div class="d119-rental-picker__title-row"><h2>' + esc(t("title")) + '</h2><div class="d119-rental-picker__count" id="d119PickerCount"></div></div>' +''',
        '''      '<div class="d119-rental-picker__title-row"><h2 id="d119PickerTitle">' + esc(t("title")) + '</h2><div class="d119-rental-picker__count" id="d119PickerCount" aria-live="polite"></div></div>' +''',
        'id="d119PickerTitle"',
    )
    replace_once(
        "assets/rental-v2-picker.js",
        '''      '<div class="d119-rental-picker__tools"><input class="d119-rental-picker__search" id="d119PickerSearch" type="search" autocomplete="off" placeholder="' + esc(t("search")) + '" value="' + esc(query) + '"><div class="d119-rental-picker__chips" id="d119PickerChips"></div></div>' +''',
        '''      '<div class="d119-rental-picker__tools"><input class="d119-rental-picker__search" id="d119PickerSearch" type="search" autocomplete="off" aria-label="' + esc(t("search")) + '" placeholder="' + esc(t("search")) + '" value="' + esc(query) + '"><div class="d119-rental-picker__chips" id="d119PickerChips"></div></div>' +''',
        'autocomplete="off" aria-label="',
    )
    replace_once(
        "assets/rental-v2-picker.js",
        '''      '<div class="d119-rental-picker__foot"><p class="d119-rental-picker__hint">' + esc(t("hint")) + '</p><button type="button" class="d119-rental-picker__done" id="d119PickerDone">' + esc(t("close")) + '</button><p class="d119-rental-picker__alert" id="d119PickerAlert"></p></div>';''',
        '''      '<div class="d119-rental-picker__foot"><p class="d119-rental-picker__hint">' + esc(t("hint")) + '</p><button type="button" class="d119-rental-picker__done" id="d119PickerDone">' + esc(t("close")) + '</button><p class="d119-rental-picker__alert" id="d119PickerAlert" role="status" aria-live="polite"></p></div>';''',
        'id="d119PickerAlert" role="status"',
    )
    old = '''    document.addEventListener("keydown", function (event) {\n      if (event.key === "Escape" && picker) {\n        event.preventDefault();\n        event.stopImmediatePropagation();\n        closePicker();\n      }\n    }, true);'''
    new = '''    document.addEventListener("keydown", function (event) {\n      if (!picker) return;\n      if (event.key === "Escape") {\n        event.preventDefault();\n        event.stopImmediatePropagation();\n        closePicker();\n        return;\n      }\n      if (event.key !== "Tab") return;\n      var focusables = picker.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[href],[tabindex]:not([tabindex="-1"])');\n      if (!focusables.length) return;\n      var first = focusables[0], last = focusables[focusables.length - 1];\n      if (!picker.contains(document.activeElement)) { event.preventDefault(); first.focus(); }\n      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }\n      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }\n    }, true); // QUALITY95_PICKER_FOCUS_TRAP'''
    replace_once("assets/rental-v2-picker.js", old, new, "QUALITY95_PICKER_FOCUS_TRAP")


def patch_rental_ui_performance() -> None:
    replace_once(
        "assets/rental-v2-ui.js",
        '''    document.documentElement.style.overflow = "";\n    document.body.classList.add("d119-rental-picking");''',
        '''    document.documentElement.style.overflow = "";\n    document.body.style.overflow = "";\n    document.body.classList.add("d119-rental-picking");''',
        'document.body.style.overflow = "";\n    document.body.classList.add("d119-rental-picking")',
    )
    replace_once(
        "assets/rental-v2-ui.js",
        '''    new MutationObserver(scheduleEnhance).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-pressed", "class"] });''',
        '''    // Class-Aenderungen im gesamten Dokument sind sehr haeufig. Fuer diese\n    // UI reichen neue/entfernte Nodes sowie aria-pressed der Mietbuttons.\n    new MutationObserver(scheduleEnhance).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-pressed"] }); // QUALITY95_RENTAL_OBSERVER''',
        "QUALITY95_RENTAL_OBSERVER",
    )


def patch_article_accessibility_and_message() -> None:
    replace_once(
        "assets/article.js",
        '''  var lightbox = document.getElementById("lightbox");\n  var lightboxImg = document.getElementById("lightboxImg");''',
        '''  var lightbox = document.getElementById("lightbox");\n  var lightboxImg = document.getElementById("lightboxImg");\n  var lightboxLastFocus = null; // QUALITY95_ARTICLE_LIGHTBOX''',
        "QUALITY95_ARTICLE_LIGHTBOX",
    )
    old = '''  function openLightbox() {\n    lightboxImg.src = gallery[idx];\n    lightbox.classList.add("open");\n    document.body.style.overflow = "hidden";\n  }\n  function closeLightbox() {\n    lightbox.classList.remove("open");\n    document.body.style.overflow = "";\n  }\n  mainImg.addEventListener("click", openLightbox);'''
    new = '''  function openLightbox() {\n    lightboxLastFocus = document.activeElement;\n    lightboxImg.src = gallery[idx];\n    lightbox.classList.add("open");\n    lightbox.setAttribute("role", "dialog");\n    lightbox.setAttribute("aria-modal", "true");\n    lightbox.setAttribute("aria-label", LANG === "fr" ? "Image produit agrandie" : LANG === "en" ? "Enlarged product image" : "Vergrößertes Produktbild");\n    document.body.style.overflow = "hidden";\n    var close = document.getElementById("lightboxClose");\n    if (close) close.focus();\n  }\n  function closeLightbox() {\n    if (!lightbox.classList.contains("open")) return;\n    lightbox.classList.remove("open");\n    document.body.style.overflow = "";\n    var target = lightboxLastFocus && lightboxLastFocus.isConnected ? lightboxLastFocus : mainImg;\n    lightboxLastFocus = null;\n    if (target && target.focus) target.focus();\n  }\n  mainImg.tabIndex = 0;\n  mainImg.setAttribute("role", "button");\n  mainImg.setAttribute("aria-label", LANG === "fr" ? "Agrandir l’image produit" : LANG === "en" ? "Enlarge product image" : "Produktbild vergrößern");\n  mainImg.addEventListener("click", openLightbox);\n  mainImg.addEventListener("keydown", function (e) {\n    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openLightbox(); }\n  });'''
    replace_once("assets/article.js", old, new, "mainImg.tabIndex = 0")
    old = '''  document.addEventListener("keydown", function (e) {\n    if (e.key === "Escape") closeLightbox();\n    else if (e.key === "ArrowLeft") showPhoto(idx - 1);\n    else if (e.key === "ArrowRight") showPhoto(idx + 1);\n  });'''
    new = '''  document.addEventListener("keydown", function (e) {\n    if (!lightbox.classList.contains("open")) return;\n    if (e.key === "Escape") { e.preventDefault(); closeLightbox(); }\n    else if (e.key === "ArrowLeft") { e.preventDefault(); showPhoto(idx - 1); lightboxImg.src = gallery[idx]; }\n    else if (e.key === "ArrowRight") { e.preventDefault(); showPhoto(idx + 1); lightboxImg.src = gallery[idx]; }\n    else if (e.key === "Tab") {\n      var close = document.getElementById("lightboxClose");\n      if (close) { e.preventDefault(); close.focus(); }\n    }\n  });'''
    replace_once("assets/article.js", old, new, 'if (!lightbox.classList.contains("open")) return;')
    replace_once(
        "assets/article.js",
        '''  var waBtn = document.getElementById("inquireWhatsapp");\n  var emailBtn = document.getElementById("inquireEmail");''',
        '''  var waBtn = document.getElementById("inquireWhatsapp");\n  var emailBtn = document.getElementById("inquireEmail");\n  var articleOrderMessage = ""; // QUALITY95_ARTICLE_MESSAGE\n  function articleMessageLabel() { return LANG === "fr" ? "Message client" : LANG === "en" ? "Customer message" : "Kundennachricht"; }\n  function articleMessagePlaceholder() { return LANG === "fr" ? "Question, mesures, souhait de livraison …" : LANG === "en" ? "Question, measurements, shipping request …" : "Frage, Maße, Versandwunsch …"; }''',
        "QUALITY95_ARTICLE_MESSAGE",
    )
    replace_once(
        "assets/article.js",
        '''    rows.push("URL: " + window.location.href.split("?")[0].split("#")[0]);\n    rows.push((LANG === "de" ? "Zeitpunkt" : LANG === "fr" ? "Horodatage" : "Timestamp") + ": " + new Date().toLocaleString());''',
        '''    rows.push("URL: " + window.location.href.split("?")[0].split("#")[0]);\n    if (articleOrderMessage.trim()) rows.push(articleMessageLabel() + ": " + articleOrderMessage.trim());\n    rows.push((LANG === "de" ? "Zeitpunkt" : LANG === "fr" ? "Horodatage" : "Timestamp") + ": " + new Date().toLocaleString());''',
        "articleOrderMessage.trim()) rows.push",
    )
    old = '''  function updateOrderLinks() {\n    if (IT.sold) {'''
    new = '''  function ensureArticleMessageField() {\n    var anchor = waBtn || emailBtn;\n    if (!anchor || (!SHOP_CONFIG.whatsappNumber && !SHOP_CONFIG.email)) return;\n    var field = document.getElementById("articleOrderMessageField");\n    if (!field) {\n      field = document.createElement("label");\n      field.id = "articleOrderMessageField";\n      field.className = "article-order-message";\n      field.innerHTML = '<span></span><textarea id="articleOrderMessage" maxlength="500"></textarea>';\n      anchor.parentNode.insertBefore(field, anchor);\n      field.querySelector("textarea").addEventListener("input", function (e) {\n        articleOrderMessage = e.target.value.slice(0, 500);\n        updateOrderLinks();\n      });\n    }\n    field.querySelector("span").textContent = articleMessageLabel() + " (" + (LANG === "fr" ? "facultatif" : "optional") + ")";\n    field.querySelector("textarea").placeholder = articleMessagePlaceholder();\n  }\n\n  function updateOrderLinks() {\n    ensureArticleMessageField();\n    if (IT.sold) {'''
    replace_once("assets/article.js", old, new, "function ensureArticleMessageField()")
    append_once(
        "assets/article.css",
        '''/* QUALITY95_ARTICLE_A11Y — product pages only. */\n.gallery__stage>img:focus-visible,.lightbox__close:focus-visible,.article-order-message textarea:focus-visible{outline:2px solid var(--accent-text);outline-offset:2px}\n.lightbox__close{min-width:44px;min-height:44px}\n.article-order-message{display:block;margin:4px 0 2px;font-size:.68rem;line-height:1.35;color:var(--text-muted)}\n.article-order-message>span{display:block;margin-bottom:6px;letter-spacing:.04em;text-transform:uppercase}\n.article-order-message textarea{display:block;width:100%;min-height:72px;max-height:150px;resize:vertical;border:1px solid var(--rule-strong);border-radius:0;background:transparent;color:var(--paper);font:inherit;font-size:.78rem;line-height:1.45;padding:10px}''',
        "QUALITY95_ARTICLE_A11Y",
    )


def main() -> None:
    patch_filter_drawer()
    patch_app_search_and_cart()
    patch_build_source_terms()
    patch_rental_v2()
    patch_rental_picker()
    patch_rental_ui_performance()
    patch_article_accessibility_and_message()
    print("Quality-95-Polish abgeschlossen.")


if __name__ == "__main__":
    main()

/* Disorder119 — simplified, context-aware archive filters.
   Keeps taxonomy data intact but removes redundant/empty choices from the UI.
   Match, Chaos and Baukasten are intentionally untouched. */
(function () {
  "use strict";

  var PRODUCT_TYPE_ID = "filterProductType";
  var FACET_IDS = ["filterDepartment", "filterBrand", "filterSize", "filterColor", "filterCondition"];
  var DEPENDENT_IDS = ["filterBrand", "filterSize", "filterColor", "filterCondition"];
  var scheduled = false;
  var resetting = false;

  function parsedCount(option) {
    var match = /\((\d+)\)\s*$/.exec(String(option && option.textContent || ""));
    return match ? Number(match[1]) : null;
  }

  function hideRedundantProductType() {
    var select = document.getElementById(PRODUCT_TYPE_ID);
    if (!select) return;
    var field = select.closest ? select.closest(".filter-field") : null;
    if (field) {
      field.classList.add("hidden");
      field.setAttribute("aria-hidden", "true");
    }
    // Produkttyp ist redundant zu den bereits bewusst grob gehaltenen
    // Hauptkategorien (Jacken, Tops, Hosen, Röcke, Kleider, Schuhe,
    // Accessoires). Falls ein alter Zustand gesetzt sein sollte, neutralisieren.
    if (select.value) {
      select.value = "";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }

  function compactSelect(select) {
    if (!select || !select.options) return;
    for (var i = 1; i < select.options.length; i++) {
      var option = select.options[i];
      var count = parsedCount(option);
      var unavailable = count === 0;
      // Nicht nur deaktivieren: nicht passende Marken/Groessen/Farben werden
      // komplett ausgeblendet. Beispiel: Herren zeigt keine Marke, fuer die
      // aktuell kein Herren-Artikel existiert.
      option.hidden = unavailable && option.value !== select.value;
      if (unavailable && option.value !== select.value) option.disabled = true;
    }
  }

  function compactAll() {
    scheduled = false;
    hideRedundantProductType();
    FACET_IDS.forEach(function (id) { compactSelect(document.getElementById(id)); });
  }

  function scheduleCompact() {
    if (scheduled) return;
    scheduled = true;
    window.setTimeout(compactAll, 0);
  }

  function resetInvalidDependents() {
    if (resetting) return;
    resetting = true;
    var changed = false;
    DEPENDENT_IDS.forEach(function (id) {
      var select = document.getElementById(id);
      if (!select || !select.value) return;
      var option = select.options[select.selectedIndex];
      if (parsedCount(option) === 0) {
        select.value = "";
        select.dispatchEvent(new Event("change", { bubbles: true }));
        changed = true;
      }
    });
    resetting = false;
    if (changed) scheduleCompact();
  }

  function init() {
    var panel = document.getElementById("filterPanel");
    if (!panel) return;

    hideRedundantProductType();
    compactAll();

    var department = document.getElementById("filterDepartment");
    if (department) {
      department.addEventListener("change", function () {
        // app.js rendert synchron zuerst die neuen Facettenzahlen. Danach
        // entfernen wir ungueltig gewordene Altwahlen und zeigen nur echte
        // Trefferoptionen fuer den neu gewaehlten Bereich.
        window.setTimeout(function () {
          resetInvalidDependents();
          compactAll();
        }, 0);
      });
    }

    FACET_IDS.forEach(function (id) {
      var select = document.getElementById(id);
      if (select) select.addEventListener("change", scheduleCompact);
    });

    // Suche, Kategorie- und Statuswechsel aktualisieren Facetten ebenfalls.
    // Beobachten statt bestehende Shop-Logik anzufassen.
    if (typeof MutationObserver !== "undefined") {
      new MutationObserver(scheduleCompact).observe(panel, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: ["disabled"]
      });
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();

/* Compact desktop controls + mobile bottom drawer. */
(function () {
  "use strict";
  var MARKER_ID = "d119CompactFilterDrawer";
  var MOBILE = "(max-width: 720px)";
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
      ".d119-filter-drawer__head,.d119-filter-drawer__foot{display:none}",
      "@media(max-width:720px){body.d119-filter-open{overflow:hidden}.filter-panel.d119-filter-drawer{position:fixed;inset:auto 0 0;z-index:130;width:100%;max-height:82dvh;display:grid;grid-template-columns:1fr;gap:0;margin:0;padding:0 0 max(12px,env(safe-area-inset-bottom));overflow:auto;background:var(--bg);border-top:1px solid var(--rule-strong);box-shadow:0 -18px 50px rgba(0,0,0,.4)}.filter-panel.d119-filter-drawer.hidden{display:none}.d119-filter-drawer .filter-field{padding:0 18px 12px}.d119-filter-drawer .filter-field select,.d119-filter-drawer .filter-price-inputs input{min-height:42px;font-size:.82rem}.d119-filter-drawer .filter-reset{margin:0 18px 12px;padding:8px 0}.d119-filter-drawer__head{position:sticky;top:0;z-index:2;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:15px 18px 13px;background:var(--bg);border-bottom:1px solid var(--rule);margin-bottom:14px}.d119-filter-drawer__title{font-size:.72rem;letter-spacing:.1em;text-transform:uppercase;font-weight:600}.d119-filter-drawer__close{appearance:none;border:0;background:transparent;color:var(--text-muted);font:inherit;font-size:.7rem;text-decoration:underline;text-underline-offset:3px;padding:4px;cursor:pointer}.d119-filter-drawer__foot{position:sticky;bottom:0;z-index:2;display:block;padding:12px 18px max(14px,env(safe-area-inset-bottom));background:var(--bg);border-top:1px solid var(--rule)}.d119-filter-drawer__apply{appearance:none;width:100%;border:1px solid var(--text);background:var(--text);color:var(--bg);font:inherit;font-size:.72rem;letter-spacing:.06em;text-transform:uppercase;padding:12px 14px;cursor:pointer}.rail__right{gap:8px}.plate__size{font-size:.56rem;margin-top:4px}}"
    ].join("");
    document.head.appendChild(style);
  }
  function closeDrawer() {
    var panel = document.getElementById("filterPanel");
    var toggle = document.getElementById("moreFiltersToggle");
    if (!panel) return;
    panel.classList.add("hidden");
    if (toggle) toggle.setAttribute("aria-expanded", "false");
    document.body.classList.remove("d119-filter-open");
    if (toggle && toggle.focus) toggle.focus();
  }
  function refresh() {
    var panel = document.getElementById("filterPanel");
    var toggle = document.getElementById("moreFiltersToggle");
    if (!panel) return;
    var title = panel.querySelector(".d119-filter-drawer__title");
    var close = panel.querySelector(".d119-filter-drawer__close");
    var apply = panel.querySelector(".d119-filter-drawer__apply");
    if (title) title.textContent = t("filter");
    if (close) close.textContent = t("close");
    if (apply) apply.textContent = t("apply", resultCount());
    if (toggle) toggle.textContent = t("filter") + (activeCount() ? " · " + activeCount() : "");
    document.body.classList.toggle("d119-filter-open", isMobile() && !panel.classList.contains("hidden"));
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
    head.innerHTML = '<span class="d119-filter-drawer__title"></span><button type="button" class="d119-filter-drawer__close"></button>';
    panel.insertBefore(head, panel.firstChild);
    var foot = document.createElement("div");
    foot.className = "d119-filter-drawer__foot";
    foot.innerHTML = '<button type="button" class="d119-filter-drawer__apply"></button>';
    panel.appendChild(foot);
    head.querySelector("button").addEventListener("click", closeDrawer);
    foot.querySelector("button").addEventListener("click", closeDrawer);
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && isMobile() && !panel.classList.contains("hidden")) closeDrawer();
    });
    window.addEventListener("resize", refresh, { passive: true });
    if (typeof MutationObserver !== "undefined") {
      new MutationObserver(refresh).observe(panel, { attributes: true, attributeFilter: ["class"], subtree: true, childList: true, characterData: true });
      var count = document.getElementById("railCount");
      if (count) new MutationObserver(refresh).observe(count, { childList: true, subtree: true, characterData: true });
    }
    refresh();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();


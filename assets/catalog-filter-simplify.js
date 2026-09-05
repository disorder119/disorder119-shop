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

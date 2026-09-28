/* Ansicht Schwarz / Weiss: runder Knopf unten links auf jeder Seite.

   Schwarz ist der Standard. Die Wahl merkt sich der Browser (localStorage
   "d119_ansicht"); das kleine Skript im <head> setzt sie schon vor dem
   ersten Bild. Die Farben stehen in theme.css. Andere Skripte (der Knopf
   "Ansicht" in der Filterleiste) hoeren auf das Ereignis "d119:ansicht". */
(function () {
  "use strict";
  if (window.D119Ansicht) return;
  var KEY = "d119_ansicht";
  var root = document.documentElement;
  var TEXT = {
    de: { hell: "Schwarze Ansicht", dunkel: "Weiße Ansicht" },
    en: { hell: "Black view", dunkel: "White view" },
    fr: { hell: "Affichage noir", dunkel: "Affichage blanc" },
  };
  var SONNE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6"/></svg>';
  var MOND = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.2A8.2 8.2 0 0 1 9.8 4a8.2 8.2 0 1 0 10.2 10.2z"/></svg>';
  var knopf = null;

  function aktuell() { return root.getAttribute("data-theme") === "hell" ? "hell" : "dunkel"; }
  function sprache() {
    var l = String(root.getAttribute("lang") || "de").slice(0, 2).toLowerCase();
    return TEXT[l] ? l : "de";
  }

  function knopfZeigen() {
    if (!knopf) return;
    var a = aktuell();
    var text = TEXT[sprache()][a];
    // In Schwarz zeigt der Knopf die Sonne (zu Weiss), in Weiss den Mond.
    knopf.innerHTML = a === "hell" ? MOND : SONNE;
    knopf.setAttribute("aria-label", text);
    knopf.setAttribute("title", text);
    knopf.setAttribute("aria-pressed", a === "hell" ? "true" : "false");
  }

  function setzen(a) {
    if (a === "hell") root.setAttribute("data-theme", "hell");
    else root.removeAttribute("data-theme");
    try {
      if (a === "hell") window.localStorage.setItem(KEY, "hell");
      else window.localStorage.removeItem(KEY);
    } catch (e) {}
    var farbe = document.querySelector('meta[name="theme-color"]');
    if (farbe) farbe.setAttribute("content", a === "hell" ? "#ffffff" : "#000000");
    knopfZeigen();
    try { document.dispatchEvent(new CustomEvent("d119:ansicht", { detail: { ansicht: a } })); } catch (e) {}
  }

  function umschalten() { setzen(aktuell() === "hell" ? "dunkel" : "hell"); }

  function bauen() {
    if (knopf || !document.body) return;
    knopf = document.createElement("button");
    knopf.type = "button";
    knopf.className = "d119-ansicht";
    knopf.addEventListener("click", umschalten);
    document.body.appendChild(knopf);
    knopfZeigen();
  }

  // Andere Tabs: Wechsel sofort uebernehmen.
  window.addEventListener("storage", function (e) {
    if (e.key === KEY) setzen(e.newValue === "hell" ? "hell" : "dunkel");
  });
  // Sprache kann auf der Seite wechseln (DE/EN/FR).
  new MutationObserver(knopfZeigen).observe(root, { attributes: true, attributeFilter: ["lang"] });

  window.D119Ansicht = { umschalten: umschalten, setzen: setzen, aktuell: aktuell };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bauen);
  else bauen();
})();

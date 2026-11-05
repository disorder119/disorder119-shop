/* Zusatz-Skripte erst nach dem ersten Bild (Inhaber 05.11.2026: Handy-Ladezeit).

   Skripte, die fuer das erste Bild nicht gebraucht werden (Ansicht-Knopf, Zurueck,
   Artikelnummer-Links, Oberflaeche d119-ui, Newsletter), stehen im HTML als
   <script type="text/d119-spaet" src="..."> - der Browser laedt sie so nicht.
   Diese Datei startet sie in Dokumentreihenfolge, sobald die Seite geladen ist,
   bei der ersten Beruehrung oder Taste oder spaetestens nach 4 Sekunden.
   Eigene Datei statt Inline-Skript: die Content-Security-Policy erlaubt nur
   Skripte vom eigenen Ursprung (shop-worker/storefront-csp.js). */
(function () {
  "use strict";
  var los = false;
  function start() {
    if (los) return;
    los = true;
    var liste = document.querySelectorAll('script[type="text/d119-spaet"]');
    for (var i = 0; i < liste.length; i++) {
      var e = document.createElement("script");
      e.src = liste[i].getAttribute("src");
      e.async = false; // Reihenfolge wie im HTML
      document.body.appendChild(e);
    }
  }
  function bald() { setTimeout(start, 0); }
  if (document.readyState === "complete") bald();
  else window.addEventListener("load", bald, { once: true });
  ["pointerdown", "keydown", "touchstart"].forEach(function (typ) {
    window.addEventListener(typ, start, { once: true, passive: true, capture: true });
  });
  setTimeout(start, 4000);
})();

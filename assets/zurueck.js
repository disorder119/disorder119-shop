/* Zurueck/Vor ohne Neuladen und vorab geladene Seiten (Ladezeit, Runde 3).

   1. Besuchszaehlung: Der Storefront-Worker zaehlt echte Seitenabrufe beim
      Server (storefront-edge.js). Drei Faelle erreichen ihn nicht:
      - Zurueck/Vor aus dem Seitenspeicher des Browsers (bfcache),
      - Seiten, die der Browser beim Ueberfahren vorab geholt hat (Speculation
        Rules; dieser Vorab-Abruf wird bewusst nicht gezaehlt),
      - Zurueck/Vor aus dem normalen Browser-Cache.
      Fuer genau diese Faelle geht ein kleiner Ping an /_seitenaufruf - in
      denselben Zaehler, mit denselben Ausnahmen (Do Not Track, Global
      Privacy Control, #nicht-zaehlen; prueft der Server). Kein Cookie,
      nichts wird auf dem Geraet gespeichert; mitgeschickt werden nur Adresse
      der Seite und verweisende Seite (Datenschutzerklaerung,
      "Besuchszaehlung auf dem Server").
   2. Wiederhergestellte Seiten auf Stand bringen: Was andere Seiten
      inzwischen in localStorage geaendert haben (Warenkorb, Ansicht, ...),
      kommt als normales "storage"-Ereignis an die vorhandenen Zuhoerer.
      Dazu das Ereignis "d119:wiederhergestellt" (z. B. Site-Lock).
   3. Kasse, Konto, Warenkorb, Widerruf und Newsletter laufen nie mit altem
      Zustand weiter: Werden sie trotzdem aus dem Seitenspeicher geholt,
      laedt der Browser sie neu. */
(function () {
  "use strict";
  if (window.D119Zurueck) return;
  window.D119Zurueck = true;

  var PING = "/_seitenaufruf";
  var NEU_LADEN = /^\/(?:(?:en|fr)\/)?(?:kasse|konto|cart|widerruf|newsletter)(?:\/|$)/;
  var ALT_MS = 30 * 60 * 1000;

  // Die Ausnahmen (Do Not Track, Global Privacy Control, Widerspruchs-Cookie)
  // prueft der Server an dieser Anfrage selbst - das Skript liest dafuer
  // nichts auf dem Geraet aus.
  function ping(art, referrer) {
    var daten = JSON.stringify({ u: location.pathname + location.search, r: referrer || "", a: art });
    try {
      if (navigator.sendBeacon && navigator.sendBeacon(PING, daten)) return;
    } catch (e) {}
    try {
      fetch(PING, { method: "POST", body: daten, keepalive: true, credentials: "same-origin" }).catch(function () {});
    } catch (e) {}
  }

  // Beim ersten Anzeigen: kam die Seite ohne Abruf beim Server?
  try {
    var nav = performance.getEntriesByType("navigation")[0];
    if (nav) {
      if (nav.deliveryType === "navigational-prefetch") ping("vorab", document.referrer);
      else if (nav.type === "back_forward" && nav.transferSize === 0 && nav.decodedBodySize > 0) ping("cache", "");
    }
  } catch (e) {}

  // Seitenspeicher (bfcache)
  var stand = null;
  var versteckt = 0;
  function lokalerStand() {
    var s = {};
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        s[k] = localStorage.getItem(k);
      }
    } catch (e) {}
    return s;
  }

  window.addEventListener("pagehide", function (e) {
    if (!e.persisted) return;
    stand = lokalerStand();
    versteckt = Date.now();
  });

  window.addEventListener("pageshow", function (e) {
    if (!e.persisted) return;
    var paypal = document.getElementById("paypalButtons");
    if (NEU_LADEN.test(location.pathname) || (paypal && paypal.childNodes.length) ||
        (versteckt && Date.now() - versteckt > ALT_MS)) {
      // Nicht zaehlen: das Neuladen ist ein echter Seitenabruf beim Server.
      location.reload();
      return;
    }
    ping("zurueck", "");
    var jetzt = lokalerStand();
    var vorher = stand || {};
    var schluessel = {};
    Object.keys(vorher).forEach(function (k) { schluessel[k] = true; });
    Object.keys(jetzt).forEach(function (k) { schluessel[k] = true; });
    Object.keys(schluessel).forEach(function (k) {
      var alt = Object.prototype.hasOwnProperty.call(vorher, k) ? vorher[k] : null;
      var neu = Object.prototype.hasOwnProperty.call(jetzt, k) ? jetzt[k] : null;
      if (alt === neu) return;
      try {
        window.dispatchEvent(new StorageEvent("storage", {
          key: k, oldValue: alt, newValue: neu, url: location.href, storageArea: localStorage
        }));
      } catch (x) {}
    });
    stand = null;
    try { document.dispatchEvent(new CustomEvent("d119:wiederhergestellt")); } catch (x) {}
  });
})();

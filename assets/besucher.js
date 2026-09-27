/* Live-Besucher: meldet Seitenaufrufe, angesehene Artikel, Warenkorb-
   Aenderungen und geoeffnete Anfragen an den Shop-Worker (POST /besuch).
   Keine Cookies, nichts wird fuer das Tracking im Browser gespeichert.
   "Do Not Track" und Global Privacy Control werden respektiert.
   Eigene Besuche ausschliessen: einmal https://disorder119.com/#nicht-zaehlen
   aufrufen (#zaehlen macht es rueckgaengig). */
(function () {
  "use strict";
  var cfg = window.SHOP_CONFIG || window.ARTICLE_SHOP_CONFIG || {};
  var basis = String(cfg.shopWorkerUrl || "").replace(/\/+$/, "");
  if (!/^https:\/\//.test(basis)) return;

  var AUS_KEY = "d119_nicht_zaehlen";
  var CART_KEY = "disorder119_cart";
  try {
    if (location.hash === "#nicht-zaehlen") window.localStorage.setItem(AUS_KEY, "1");
    if (location.hash === "#zaehlen") window.localStorage.removeItem(AUS_KEY);
    if (window.localStorage.getItem(AUS_KEY) === "1") return;
  } catch (e) {}
  if (navigator.globalPrivacyControl === true) return;
  if (navigator.doNotTrack === "1" || window.doNotTrack === "1") return;
  if (navigator.webdriver) return;

  var ziel = basis + "/besuch";
  var sprache = (document.documentElement.getAttribute("lang") || "de").slice(0, 2);
  var referrerGesendet = false;

  function senden(daten) {
    daten.p = location.pathname;
    daten.l = sprache;
    if (!referrerGesendet) { daten.r = document.referrer || ""; referrerGesendet = true; }
    var body = JSON.stringify(daten);
    try {
      if (navigator.sendBeacon && navigator.sendBeacon(ziel, new Blob([body], { type: "text/plain" }))) return;
    } catch (e) {}
    try {
      fetch(ziel, { method: "POST", body: body, keepalive: true, mode: "cors", credentials: "omit",
        headers: { "Content-Type": "text/plain" } }).catch(function () {});
    } catch (e) {}
  }

  function warenkorb() {
    try {
      var liste = JSON.parse(window.localStorage.getItem(CART_KEY) || "[]");
      return Array.isArray(liste) ? liste.map(String) : [];
    } catch (e) { return []; }
  }

  // Warenkorb-Aenderungen erkennen, egal ueber welchen Knopf (Raster, Detail,
  // Swipe, Produktseite): nach jedem Klick den Stand vergleichen.
  var letzterStand = warenkorb();
  function warenkorbPruefen() {
    var jetzt = warenkorb();
    jetzt.forEach(function (id) {
      if (letzterStand.indexOf(id) === -1) senden({ t: "warenkorb_rein", a: id, n: jetzt.length });
    });
    letzterStand.forEach(function (id) {
      if (jetzt.indexOf(id) === -1) senden({ t: "warenkorb_raus", a: id, n: jetzt.length });
    });
    letzterStand = jetzt;
  }

  document.addEventListener("click", function (e) {
    var anfrage = e.target && e.target.closest ? e.target.closest("[data-cart-inquiry]") : null;
    if (anfrage) senden({ t: "anfrage", k: anfrage.getAttribute("data-cart-inquiry"), n: warenkorb().length });
    setTimeout(warenkorbPruefen, 60);
  }, true);
  window.addEventListener("storage", function (e) { if (e.key === CART_KEY) letzterStand = warenkorb(); });

  // Artikel-Detail auf der Startseite (Overlay ohne eigene URL).
  document.addEventListener("d119:artikel", function (e) {
    if (e.detail && e.detail.id !== undefined) senden({ t: "artikel", a: e.detail.id });
  });

  var artikel = window.ARTICLE_ITEM;
  if (artikel && artikel.id !== undefined) senden({ t: "artikel", a: artikel.id });
  else senden({ t: "seite" });
})();

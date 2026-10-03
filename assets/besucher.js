/* Live-Besucher: meldet Seitenaufrufe, angesehene Artikel, Warenkorb-
   Aenderungen, geoeffnete Anfragen und das Verlassen der Seite (fuer die
   Verweildauer) an den Shop-Worker (POST /besuch).
   Optionale Analyse erst nach ausdruecklicher Zustimmung. Die Entscheidung
   wird lokal gespeichert und kann jederzeit widerrufen werden.
   "Do Not Track" und Global Privacy Control werden respektiert.
   Eigene Besuche ausschliessen: einmal https://disorder119.com/#nicht-zaehlen
   aufrufen (#zaehlen macht es rueckgaengig). */
(function () {
  "use strict";
  if (window.D119Privacy) return;
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

  var CONSENT_KEY = "d119_analytics_consent_v1";
  var consent = null;
  try { consent = JSON.parse(window.localStorage.getItem(CONSENT_KEY) || "null"); } catch (e) {}
  function erlaubt() {
    return consent && consent.version === 1 && consent.allowed === true
      && Date.now() - Number(consent.at) < 180 * 86400000
      && Number(consent.at) <= Date.now();
  }
  var started = false;
  var box = null;
  var lang = (document.documentElement.lang || "de").slice(0, 2);
  var words = {
    de: ["Datenschutz-Einstellungen", "Warenkorb und Anmeldung verwenden notwendige Speicherung. Möchtest du zusätzlich die Besucherstatistik erlauben? Sie erfasst Seiten, Artikel, Warenkorb-Änderungen, Browser und den ungefähren Ort. Wir erhalten dazu Benachrichtigungen über Telegram. Deine Wahl ist freiwillig und jederzeit änderbar.", "Nur notwendige", "Statistik erlauben", "Datenschutzerklärung"],
    en: ["Privacy settings", "Your cart and sign-in use necessary storage. Would you also like to allow visitor statistics? They include pages, items, cart changes, browser and approximate location. We receive notifications via Telegram. Your choice is optional and can be changed at any time.", "Necessary only", "Allow statistics", "Privacy policy"],
    fr: ["Paramètres de confidentialité", "Le panier et la connexion utilisent un stockage nécessaire. Souhaites-tu également autoriser les statistiques de visite ? Elles incluent pages, articles, modifications du panier, navigateur et localisation approximative. Nous recevons des notifications via Telegram. Ce choix est facultatif et modifiable à tout moment.", "Nécessaires seulement", "Autoriser les statistiques", "Confidentialité"]
  }[lang] || null;
  if (!words) words = ["Privacy settings", "Allow optional visitor statistics? Your choice can be changed at any time. See our privacy policy.", "Necessary only", "Allow statistics", "Privacy policy"];
  function choose(allowed) {
    consent = {version:1, allowed:allowed === true, at:Date.now()};
    try { window.localStorage.setItem(CONSENT_KEY, JSON.stringify(consent)); } catch (e) {}
    if (box) { box.remove(); box = null; }
    if (erlaubt()) start();
    else { started = false; referrerGesendet = false; letzterStand = []; }
  }
  function settings() {
    if (box) return;
    box = document.createElement("section");
    box.className = "d119-privacy-choice";
    box.setAttribute("aria-label", words[0]);
    var title = document.createElement("h2"); title.textContent = words[0];
    var description = document.createElement("p"); description.textContent = words[1];
    var link = document.createElement("a"); link.href = (lang === "de" ? "/" : "/" + lang + "/") + "datenschutz/"; link.textContent = words[4];
    var actions = document.createElement("div"); actions.className = "d119-privacy-actions";
    [false, true].forEach(function (allowed) {
      var button = document.createElement("button"); button.type = "button";
      button.textContent = words[allowed ? 3 : 2];
      button.addEventListener("click", function () { choose(allowed); });
      actions.appendChild(button);
    });
    box.append(title, description, link, actions);
    document.body.appendChild(box);
  }
  var settingsButton = document.createElement("button");
  settingsButton.type = "button"; settingsButton.className = "d119-privacy-settings";
  settingsButton.textContent = words[0]; settingsButton.addEventListener("click", settings);
  document.body.appendChild(settingsButton);
  window.D119Privacy = {open:settings, allowed:erlaubt};
  window.addEventListener("storage", function (e) {
    if (e.key !== CONSENT_KEY) return;
    try { consent = JSON.parse(e.newValue || "null"); } catch (err) { consent = null; }
    if (erlaubt()) start(); else { started = false; referrerGesendet = false; letzterStand = []; }
  });
  if (!consent || consent.version !== 1 || !Number.isFinite(Number(consent.at)) || Date.now() - Number(consent.at) >= 180 * 86400000 || Number(consent.at) > Date.now()) settings();

  var ziel = basis + "/besuch";
  var sprache = (document.documentElement.getAttribute("lang") || "de").slice(0, 2);
  var referrerGesendet = false;

  function senden(daten) {
    if (!erlaubt()) return;
    daten.consentVersion = 1;
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
    if (!erlaubt()) return [];
    try {
      var liste = JSON.parse(window.localStorage.getItem(CART_KEY) || "[]");
      return Array.isArray(liste) ? liste.map(String) : [];
    } catch (e) { return []; }
  }

  // Warenkorb-Aenderungen erkennen, egal ueber welchen Knopf (Raster, Detail,
  // Swipe, Produktseite): nach jedem Klick den Stand vergleichen.
  var letzterStand = [];
  function warenkorbPruefen() {
    if (!erlaubt()) return;
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
    if (erlaubt()) setTimeout(warenkorbPruefen, 60);
  }, true);
  window.addEventListener("storage", function (e) { if (e.key === CART_KEY) letzterStand = warenkorb(); });

  // Artikel-Detail auf der Startseite (Overlay ohne eigene URL).
  document.addEventListener("d119:artikel", function (e) {
    if (e.detail && e.detail.id !== undefined) senden({ t: "artikel", a: e.detail.id });
  });

  // Seitenwechsel ohne Neuladen (Warenkorb, Kategorien, Universe laufen per
  // pushState auf der Startseite): jede neue Adresse zaehlt als Seite.
  var letzterPfad = location.pathname;
  function pfadPruefen() {
    if (location.pathname === letzterPfad) return;
    letzterPfad = location.pathname;
    senden({ t: "seite" });
  }
  try {
    var pushOriginal = history.pushState;
    history.pushState = function () {
      var ergebnis = pushOriginal.apply(this, arguments);
      setTimeout(pfadPruefen, 0);
      return ergebnis;
    };
  } catch (e) {}
  window.addEventListener("popstate", function () { setTimeout(pfadPruefen, 0); });

  // Verlassen oder in den Hintergrund: ergibt die Verweildauer der letzten
  // Seite. pagehide und visibilitychange feuern beim Schliessen oft beide.
  var zuletztVerlassen = 0;
  function verlassen() {
    var jetzt = Date.now();
    if (jetzt - zuletztVerlassen < 2000) return;
    zuletztVerlassen = jetzt;
    senden({ t: "verlassen" });
  }
  window.addEventListener("pagehide", verlassen);
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") verlassen();
  });

  function start() {
    if (started || !erlaubt()) return;
    started = true;
    letzterStand = warenkorb();
    var artikel = window.ARTICLE_ITEM;
    if (artikel && artikel.id !== undefined) senden({t:"artikel", a:artikel.id});
    else senden({t:"seite"});
  }
  start();
})();

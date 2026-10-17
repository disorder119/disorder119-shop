/* Live-Besucher: meldet Seitenaufrufe, angesehene Artikel, Warenkorb-
   Aenderungen, geoeffnete Anfragen und das Verlassen der Seite (fuer die
   Verweildauer) an den Shop-Worker (POST /besuch).
   Optionale Analyse erst nach ausdruecklicher Zustimmung. Die Entscheidung
   wird lokal gespeichert und kann jederzeit widerrufen werden.
   "Do Not Track" und Global Privacy Control werden respektiert.
   Ganze Seitenaufrufe zaehlt ohne Einwilligung schon der Server
   (shop-worker/storefront-edge.js); das Startereignis traegt deshalb s=1,
   damit der Worker es nicht doppelt zaehlt.
   Eigene Besuche ausschliessen: einmal https://disorder119.com/#nicht-zaehlen
   aufrufen (#zaehlen macht es rueckgaengig). Das setzt zusaetzlich das Cookie
   d119_nicht_zaehlen, denn nur das sieht die Zaehlung auf dem Server. */
(function () {
  "use strict";
  if (window.D119Privacy) return;
  var cfg = window.SHOP_CONFIG || window.ARTICLE_SHOP_CONFIG || {};
  var basis = String(cfg.shopWorkerUrl || "").replace(/\/+$/, "");
  if (!/^https:\/\//.test(basis)) return;

  var AUS_KEY = "d119_nicht_zaehlen";
  var CART_KEY = "disorder119_cart";
  // Nur auf ausdruecklichen Wunsch (#nicht-zaehlen), nie von selbst.
  function ausCookie(an) {
    try {
      document.cookie = AUS_KEY + "=" + (an ? "1; Max-Age=31536000" : "; Max-Age=0") + "; Path=/; Secure; SameSite=Lax";
    } catch (e) {}
  }
  try {
    if (location.hash === "#nicht-zaehlen") window.localStorage.setItem(AUS_KEY, "1");
    if (location.hash === "#zaehlen") { window.localStorage.removeItem(AUS_KEY); ausCookie(false); }
    if (window.localStorage.getItem(AUS_KEY) === "1") { ausCookie(true); return; }
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
    de: ["Datenschutz-Einstellungen", "Warenkorb und Anmeldung verwenden notwendige Speicherung. Seitenaufrufe zählt unser Server ohne Zugriff auf dein Gerät pseudonym mit Land, Gerätetyp und Browser. Möchtest du zusätzlich die Besucherstatistik erlauben? Sie erfasst angesehene Artikel, Warenkorb-Änderungen, Zeit im sichtbaren Tab und den ungefähren Ort. Über beides erhalten wir Benachrichtigungen per Telegram. Deine Wahl ist freiwillig und jederzeit änderbar.", "Nur notwendige", "Statistik erlauben", "Datenschutzerklärung"],
    en: ["Privacy settings", "Your cart and sign-in use necessary storage. Our server counts page views pseudonymously, without accessing your device, with country, device type and browser. Would you also like to allow visitor statistics? They include viewed items, cart changes, time in a visible tab and approximate location. We receive Telegram notifications about both. Your choice is optional and can be changed at any time.", "Necessary only", "Allow statistics", "Privacy policy"],
    fr: ["Paramètres de confidentialité", "Le panier et la connexion utilisent un stockage nécessaire. Notre serveur compte les pages consultées de façon pseudonyme, sans accéder à ton appareil, avec pays, type d’appareil et navigateur. Souhaites-tu également autoriser les statistiques de visite ? Elles incluent articles consultés, modifications du panier, temps dans l’onglet visible et localisation approximative. Nous recevons des notifications Telegram pour les deux. Ce choix est facultatif et modifiable à tout moment.", "Nécessaires seulement", "Autoriser les statistiques", "Confidentialité"]
  }[lang] || null;
  if (!words) words = ["Privacy settings", "Allow optional visitor statistics? Your choice can be changed at any time. See our privacy policy.", "Necessary only", "Allow statistics", "Privacy policy"];
  function choose(allowed) {
    consent = {version:1, allowed:allowed === true, at:Date.now()};
    try { window.localStorage.setItem(CONSENT_KEY, JSON.stringify(consent)); } catch (e) {}
    if (box) { box.remove(); box = null; }
    if (erlaubt()) start();
    else { started = false; sichtStop(); referrerGesendet = false; letzterStand = []; }
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
    if (erlaubt()) start(); else { started = false; sichtStop(); referrerGesendet = false; letzterStand = []; }
  });
  if (!consent || consent.version !== 1 || !Number.isFinite(Number(consent.at)) || Date.now() - Number(consent.at) >= 180 * 86400000 || Number(consent.at) > Date.now()) settings();

  var ziel = basis + "/besuch";
  var sprache = (document.documentElement.getAttribute("lang") || "de").slice(0, 2);
  var referrerGesendet = false;

  function senden(daten) {
    if (!erlaubt()) return;
    daten.consentVersion = 1;
    daten.p = daten.p || location.pathname;
    daten.l = sprache;
    if (!referrerGesendet) {
      try { daten.r = document.referrer ? new URL(document.referrer).origin : ""; } catch (e) { daten.r = ""; }
      referrerGesendet = true;
    }
    var body = JSON.stringify(daten);
    try {
      if (navigator.sendBeacon && navigator.sendBeacon(ziel, new Blob([body], { type: "text/plain" }))) return;
    } catch (e) {}
    try {
      fetch(ziel, { method: "POST", body: body, keepalive: true, mode: "cors", credentials: "omit",
        headers: { "Content-Type": "text/plain" } }).catch(function () {});
    } catch (e) {}
  }

  // Ein fluechtiger Abschnitt pro sichtbarer Seiten-/Artikelansicht, niemals
  // in Storage. Kumulative Zaehler verhindern doppelte Zeit bei Beacon-Retries.
  var sicht = null, sichtTimer = null, overlayArtikel = null, modalObserver = null;
  function monoton() { return window.performance && window.performance.now ? window.performance.now() : Date.now(); }
  function kontextArtikel() { return overlayArtikel || (window.ARTICLE_ITEM && window.ARTICLE_ITEM.id != null ? String(window.ARTICLE_ITEM.id) : null); }
  function sichtStart() {
    if (!started || !erlaubt() || document.visibilityState === "hidden" || !window.crypto || !window.crypto.getRandomValues) return;
    var bytes = new Uint8Array(12); window.crypto.getRandomValues(bytes);
    sicht = {v:Array.prototype.map.call(bytes,function(b){return b.toString(16).padStart(2,"0");}).join(""),p:location.pathname,a:kontextArtikel(),ms:0,at:monoton()};
    senden({t:"sichtzeit",v:sicht.v,p:sicht.p,a:sicht.a,ms:0});
  }
  function sichtSenden() {
    if (!sicht || !erlaubt()) return;
    var jetzt = monoton(); sicht.ms = Math.min(86400000,sicht.ms + Math.max(0,jetzt-sicht.at)); sicht.at = jetzt;
    senden({t:"sichtzeit",v:sicht.v,p:sicht.p,a:sicht.a,ms:Math.floor(sicht.ms)});
  }
  function sichtEnde() { sichtSenden(); sicht = null; }
  function sichtStop() { sicht = null; if (sichtTimer) clearInterval(sichtTimer); sichtTimer = null; }
  function sichtKontext(artikel) {
    if (!erlaubt()) return;
    sichtEnde(); overlayArtikel = artikel == null ? null : String(artikel); sichtStart();
  }
  function sichtEinrichten() {
    sichtStart();
    if (!sichtTimer) sichtTimer = setInterval(function(){
      if (!erlaubt()) { sichtStop(); return; }
      if (document.visibilityState !== "hidden") { if (!sicht) sichtStart(); else sichtSenden(); }
    },30000);
    // Nur den Oeffnungszustand des bekannten Artikel-Fensters beobachten,
    // niemals Eingabefelder oder Formularinhalte.
    var modal = document.getElementById("modalBackdrop");
    if (modal && !modalObserver && window.MutationObserver) {
      modalObserver = new window.MutationObserver(function(){
        if (erlaubt() && overlayArtikel !== null && !modal.classList.contains("open")) {
          sichtKontext(null); senden({t:"seite"});
        }
      });
      modalObserver.observe(modal,{attributes:true,attributeFilter:["class"]});
    }
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
    if (e.detail && e.detail.id !== undefined && erlaubt()) { sichtKontext(e.detail.id); senden({ t: "artikel", a: e.detail.id }); }
  });

  // Seitenwechsel ohne Neuladen (Warenkorb, Kategorien, Universe laufen per
  // pushState auf der Startseite): jede neue Adresse zaehlt als Seite.
  var letzterPfad = location.pathname;
  function pfadPruefen() {
    if (location.pathname === letzterPfad) return;
    letzterPfad = location.pathname;
    sichtKontext(null);
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
  window.addEventListener("pagehide", function(){ sichtEnde(); verlassen(); });
  window.addEventListener("pageshow", function(){ if(started && erlaubt() && !sicht) sichtStart(); });
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") { sichtEnde(); verlassen(); }
    else if (started && erlaubt() && !sicht) sichtStart();
  });

  function start() {
    if (started || !erlaubt()) return;
    started = true;
    letzterStand = warenkorb();
    var artikel = window.ARTICLE_ITEM;
    if (artikel && artikel.id !== undefined) senden({t:"artikel", a:artikel.id, s:1});
    else senden({t:"seite", s:1});
    sichtEinrichten();
  }
  start();
})();

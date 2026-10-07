/* Passwort-Sperre des Shops - schaltbar in der Admin-App (Übersicht → Shop sperren).

   Der Shop fragt bei jedem Seitenaufruf api.disorder119.com/site-status. Ist er
   gesperrt, liegt eine Passwort-Seite über allem. Das richtige Passwort gibt
   einen Pass für 7 Tage (im Browser gespeichert); eine neue Sperre macht ihn
   ungültig. Ist der Server nicht erreichbar, bleibt der Shop offen - lieber
   kurz ungeschützt als dauerhaft ausgesperrt.

   Auch gesperrt bleiben erreichbar: Impressum, Datenschutz, AGB und die
   Widerrufsfunktion (§ 356a BGB) - und die Datenschutz-Einstellungen, damit
   die Besucherstatistik schon auf der Sperrseite erlaubt werden kann. */
(function () {
  "use strict";
  // Gesperrt wird nur der echte Shop; lokale Vorschau und CI-Tests fragen
  // den Server nicht (er antwortet nur disorder119.com).
  if (!/^(www\.)?disorder119\.com$/i.test(location.hostname)) return;
  if (/^\/(?:(?:en|fr)\/)?(?:impressum|datenschutz|agb|widerruf)(?:\/(?:index\.html)?)?$/.test(location.pathname)) return;
  var API = "https://api.disorder119.com";
  var PASS = "d119_site_pass";
  var ZULETZT = "d119_site_lock_last";
  var wurzel = document.documentElement;
  var sprache = (wurzel.getAttribute("lang") || "de").slice(0, 2);
  var TEXT = {
    de: { titel: "Gerade geschlossen", unter: "Der Shop ist kurz privat. Mit Passwort geht es weiter.", feld: "Passwort", knopf: "Öffnen", falsch: "Das Passwort stimmt nicht.", viele: "Zu viele Versuche – bitte kurz warten.", fehler: "Keine Verbindung. Bitte gleich noch einmal.", impressum: "Impressum", datenschutz: "Datenschutz", widerruf: "Vertrag widerrufen", einstellungen: "Datenschutz-Einstellungen" },
    en: { titel: "Closed for now", unter: "The shop is private for a moment. Enter the password to continue.", feld: "Password", knopf: "Enter", falsch: "Wrong password.", viele: "Too many attempts – please wait a moment.", fehler: "No connection. Please try again.", impressum: "Legal notice", datenschutz: "Privacy", widerruf: "Withdraw from contract", einstellungen: "Privacy settings" },
    fr: { titel: "Fermé pour l’instant", unter: "La boutique est privée pour un moment. Entre le mot de passe pour continuer.", feld: "Mot de passe", knopf: "Entrer", falsch: "Mot de passe incorrect.", viele: "Trop d’essais – attends un instant.", fehler: "Pas de connexion. Réessaie.", impressum: "Mentions légales", datenschutz: "Confidentialité", widerruf: "Se rétracter du contrat", einstellungen: "Paramètres de confidentialité" }
  }[sprache] || null;
  if (!TEXT) TEXT = { titel: "Gerade geschlossen", unter: "Der Shop ist kurz privat. Mit Passwort geht es weiter.", feld: "Passwort", knopf: "Öffnen", falsch: "Das Passwort stimmt nicht.", viele: "Zu viele Versuche – bitte kurz warten.", fehler: "Keine Verbindung. Bitte gleich noch einmal.", impressum: "Impressum", datenschutz: "Datenschutz", widerruf: "Vertrag widerrufen", einstellungen: "Datenschutz-Einstellungen" };
  var PRAEFIX = sprache === "en" || sprache === "fr" ? "/" + sprache : "";

  function lesen(k) { try { return localStorage.getItem(k) || ""; } catch (e) { return ""; } }
  function schreiben(k, v) { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch (e) {} }

  var stil = document.createElement("style");
  stil.textContent =
    "html.d119-gesperrt,html.d119-gesperrt body{overflow:hidden!important;background:#000!important}" +
    "html.d119-gesperrt body>*:not(#d119Sperre):not(.d119-privacy-choice){visibility:hidden!important}" +
    "html.d119-gesperrt .d119-privacy-choice{z-index:2147483647!important;visibility:visible!important}" +
    "#d119Sperre{position:fixed;inset:0;z-index:2147483646;display:grid;place-items:center;padding:24px;background:#000;color:#f2efe7;" +
    "font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;visibility:visible!important;overflow:auto}" +
    "#d119Sperre form{width:min(360px,100%);display:grid;gap:14px;text-align:left}" +
    "#d119Sperre .marke{font-weight:800;letter-spacing:.14em;font-size:13px;margin-bottom:18px}" +
    "#d119Sperre h1{margin:0;font-size:34px;line-height:1.05;font-weight:800;letter-spacing:-.01em}" +
    "#d119Sperre p{margin:0;color:rgba(242,239,231,.68);font-size:15px;line-height:1.45}" +
    "#d119Sperre .notiz{color:#f2efe7}" +
    "#d119Sperre input{width:100%;box-sizing:border-box;height:52px;padding:0 14px;border:1px solid rgba(242,239,231,.35);background:#0d0d0d;color:#f2efe7;font:inherit;font-size:17px}" +
    "#d119Sperre input:focus{outline:2px solid #f2efe7;outline-offset:1px}" +
    "#d119Sperre button{height:52px;border:0;background:#f2efe7;color:#000;font:inherit;font-weight:700;letter-spacing:.08em;text-transform:uppercase;cursor:pointer}" +
    "#d119Sperre .fehler{color:#e39a8f;min-height:1.4em;font-size:14px}" +
    "#d119Sperre nav{display:flex;flex-wrap:wrap;gap:6px 16px;margin-top:10px;font-size:12px}" +
    "#d119Sperre nav a,#d119Sperre nav button{color:rgba(242,239,231,.68);background:none;border:0;padding:0;height:auto;font:inherit;font-size:12px;" +
    "font-weight:400;letter-spacing:0;text-transform:none;text-decoration:underline;text-underline-offset:3px;cursor:pointer}" +
    "#d119Sperre nav a:hover,#d119Sperre nav button:hover{color:#f2efe7}";
  (document.head || wurzel).appendChild(stil);

  var pass = lesen(PASS);
  if (lesen(ZULETZT) === "1" && !pass) wurzel.classList.add("d119-gesperrt");

  function freigeben() {
    wurzel.classList.remove("d119-gesperrt");
    var alt = document.getElementById("d119Sperre");
    if (alt) alt.parentNode.removeChild(alt);
  }

  function esc(s) { return String(s || "").replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  function zeigen(nachricht) {
    wurzel.classList.add("d119-gesperrt");
    function bauen() {
      if (document.getElementById("d119Sperre")) return;
      var box = document.createElement("div");
      box.id = "d119Sperre";
      box.setAttribute("role", "dialog");
      // Kein aria-modal: der Rest der Seite ist ohnehin unsichtbar, und die
      // Datenschutz-Einstellungen ueber der Sperre muessen erreichbar bleiben.
      box.setAttribute("aria-labelledby", "d119SperreTitel");
      box.innerHTML = '<form novalidate><div class="marke">DISORDER119</div>' +
        '<h1 id="d119SperreTitel">' + esc(TEXT.titel) + "</h1>" +
        "<p>" + esc(TEXT.unter) + "</p>" + (nachricht ? '<p class="notiz">' + esc(nachricht) + "</p>" : "") +
        '<label><span style="position:absolute;left:-9999px">' + esc(TEXT.feld) + '</span><input type="password" autocomplete="current-password" placeholder="' + esc(TEXT.feld) + '" required></label>' +
        '<button type="submit">' + esc(TEXT.knopf) + '</button><div class="fehler" role="alert"></div>' +
        '<nav aria-label="' + esc(TEXT.datenschutz) + '"><a href="' + PRAEFIX + '/impressum/">' + esc(TEXT.impressum) + '</a>' +
        '<a href="' + PRAEFIX + '/datenschutz/">' + esc(TEXT.datenschutz) + '</a>' +
        '<a href="' + PRAEFIX + '/widerruf/">' + esc(TEXT.widerruf) + '</a>' +
        '<button type="button" data-d119-einstellungen>' + esc(TEXT.einstellungen) + '</button></nav></form>';
      document.body.appendChild(box);
      // assets/besucher.js stellt die Datenschutz-Einstellungen bereit (nur
      // mit eingerichtetem Shop-Worker); ohne sie bleibt der Knopf weg.
      var einstellungen = box.querySelector("[data-d119-einstellungen]");
      var versuche = 0;
      (function einstellungenPruefen() {
        einstellungen.hidden = !(window.D119Privacy && window.D119Privacy.open);
        if (einstellungen.hidden && ++versuche < 20) setTimeout(einstellungenPruefen, 500);
      })();
      einstellungen.addEventListener("click", function () { if (window.D119Privacy) window.D119Privacy.open(); });
      var feld = box.querySelector("input");
      var meldung = box.querySelector(".fehler");
      var knopf = box.querySelector("button");
      setTimeout(function () { try { feld.focus(); } catch (e) {} }, 50);
      box.querySelector("form").addEventListener("submit", function (event) {
        event.preventDefault();
        if (!feld.value) { feld.focus(); return; }
        knopf.disabled = true;
        meldung.textContent = "";
        fetch(API + "/site-unlock", {
          method: "POST", credentials: "omit", cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password: feld.value })
        }).then(function (res) {
          return res.json().catch(function () { return {}; }).then(function (daten) { return { status: res.status, daten: daten }; });
        }).then(function (r) {
          knopf.disabled = false;
          if (r.status === 200 && r.daten.pass) { schreiben(PASS, r.daten.pass); freigeben(); return; }
          if (r.status === 200 && r.daten.locked === false) { schreiben(ZULETZT, ""); freigeben(); return; }
          meldung.textContent = r.status === 429 ? TEXT.viele : TEXT.falsch;
          feld.select();
        }).catch(function () { knopf.disabled = false; meldung.textContent = TEXT.fehler; });
      });
    }
    if (document.body) bauen(); else document.addEventListener("DOMContentLoaded", bauen);
  }

  fetch(API + "/site-status" + (pass ? "?pass=" + encodeURIComponent(pass) : ""), { credentials: "omit", cache: "no-store" })
    .then(function (res) { return res.json(); })
    .then(function (s) {
      if (!s || !s.locked) { schreiben(ZULETZT, ""); freigeben(); return; }
      schreiben(ZULETZT, "1");
      if (s.access) { freigeben(); return; }
      schreiben(PASS, "");
      zeigen(s.message || "");
    })
    .catch(freigeben);
})();

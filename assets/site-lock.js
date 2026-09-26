/* Passwort-Sperre des Shops - schaltbar in der Admin-App (Übersicht → Shop sperren).

   Der Shop fragt bei jedem Seitenaufruf api.disorder119.com/site-status. Ist er
   gesperrt, liegt eine Passwort-Seite über allem. Das richtige Passwort gibt
   einen Pass für 7 Tage (im Browser gespeichert); eine neue Sperre macht ihn
   ungültig. Ist der Server nicht erreichbar, bleibt der Shop offen - lieber
   kurz ungeschützt als dauerhaft ausgesperrt. */
(function () {
  "use strict";
  var API = "https://api.disorder119.com";
  var PASS = "d119_site_pass";
  var ZULETZT = "d119_site_lock_last";
  var wurzel = document.documentElement;
  var sprache = (wurzel.getAttribute("lang") || "de").slice(0, 2);
  var TEXT = {
    de: { titel: "Gerade geschlossen", unter: "Der Shop ist kurz privat. Mit Passwort geht es weiter.", feld: "Passwort", knopf: "Öffnen", falsch: "Das Passwort stimmt nicht.", viele: "Zu viele Versuche – bitte kurz warten.", fehler: "Keine Verbindung. Bitte gleich noch einmal." },
    en: { titel: "Closed for now", unter: "The shop is private for a moment. Enter the password to continue.", feld: "Password", knopf: "Enter", falsch: "Wrong password.", viele: "Too many attempts – please wait a moment.", fehler: "No connection. Please try again." },
    fr: { titel: "Fermé pour l’instant", unter: "La boutique est privée pour un moment. Entre le mot de passe pour continuer.", feld: "Mot de passe", knopf: "Entrer", falsch: "Mot de passe incorrect.", viele: "Trop d’essais – attends un instant.", fehler: "Pas de connexion. Réessaie." }
  }[sprache] || null;
  if (!TEXT) TEXT = { titel: "Gerade geschlossen", unter: "Der Shop ist kurz privat. Mit Passwort geht es weiter.", feld: "Passwort", knopf: "Öffnen", falsch: "Das Passwort stimmt nicht.", viele: "Zu viele Versuche – bitte kurz warten.", fehler: "Keine Verbindung. Bitte gleich noch einmal." };

  function lesen(k) { try { return localStorage.getItem(k) || ""; } catch (e) { return ""; } }
  function schreiben(k, v) { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch (e) {} }

  var stil = document.createElement("style");
  stil.textContent =
    "html.d119-gesperrt,html.d119-gesperrt body{overflow:hidden!important;background:#000!important}" +
    "html.d119-gesperrt body>*:not(#d119Sperre){visibility:hidden!important}" +
    "#d119Sperre{position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;padding:24px;background:#000;color:#f2efe7;" +
    "font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;visibility:visible!important}" +
    "#d119Sperre form{width:min(360px,100%);display:grid;gap:14px;text-align:left}" +
    "#d119Sperre .marke{font-weight:800;letter-spacing:.14em;font-size:13px;margin-bottom:18px}" +
    "#d119Sperre h1{margin:0;font-size:34px;line-height:1.05;font-weight:800;letter-spacing:-.01em}" +
    "#d119Sperre p{margin:0;color:rgba(242,239,231,.68);font-size:15px;line-height:1.45}" +
    "#d119Sperre .notiz{color:#f2efe7}" +
    "#d119Sperre input{width:100%;box-sizing:border-box;height:52px;padding:0 14px;border:1px solid rgba(242,239,231,.35);background:#0d0d0d;color:#f2efe7;font:inherit;font-size:17px}" +
    "#d119Sperre input:focus{outline:2px solid #f2efe7;outline-offset:1px}" +
    "#d119Sperre button{height:52px;border:0;background:#f2efe7;color:#000;font:inherit;font-weight:700;letter-spacing:.08em;text-transform:uppercase;cursor:pointer}" +
    "#d119Sperre .fehler{color:#e39a8f;min-height:1.4em;font-size:14px}";
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
      box.setAttribute("aria-modal", "true");
      box.setAttribute("aria-labelledby", "d119SperreTitel");
      box.innerHTML = '<form novalidate><div class="marke">DISORDER119</div>' +
        '<h1 id="d119SperreTitel">' + esc(TEXT.titel) + "</h1>" +
        "<p>" + esc(TEXT.unter) + "</p>" + (nachricht ? '<p class="notiz">' + esc(nachricht) + "</p>" : "") +
        '<label><span style="position:absolute;left:-9999px">' + esc(TEXT.feld) + '</span><input type="password" autocomplete="current-password" placeholder="' + esc(TEXT.feld) + '" required></label>' +
        '<button type="submit">' + esc(TEXT.knopf) + '</button><div class="fehler" role="alert"></div></form>';
      document.body.appendChild(box);
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

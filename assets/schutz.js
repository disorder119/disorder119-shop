/* Schutzbausteine fuer alle Anfragen an den Shop-Server.

   Der Server verlangt bei Bestellung, Mietanfrage und Konto-Anmeldung zwei
   Dinge: einen Einmal-Schluessel (damit ein doppelter Klick nicht doppelt
   bestellt) und im Livebetrieb ein Turnstile-Token (damit kein Bot massenhaft
   Artikel reserviert oder Anmeldemails verschickt). Beides stand bisher nur
   auf dem Server - die Seite hat es nie mitgeschickt, und jeder Kauf waere im
   Livebetrieb mit einer Fehlermeldung gescheitert.

   Wird bei Bedarf nachgeladen, nicht auf jeder Seite:
     D119Schutz.schluessel("create-order")  -> "create-order:<uuid>"
     D119Schutz.waechter().token()          -> Promise mit Token ("" ohne Site-Key)

   Ein Turnstile-Token gilt genau einmal. Der Waechter haelt deshalb immer ein
   frisches bereit: Er startet die Pruefung, sobald er zum ersten Mal gebraucht
   wird, gibt das Token beim Absenden heraus und holt sofort das naechste. So
   wartet niemand beim Klick auf die Pruefung - und muss Turnstile doch einmal
   nachfragen, erscheint das Feld schon vorher und nicht erst hinter dem
   PayPal-Fenster.
*/
(function () {
  "use strict";
  if (window.D119Schutz) return;

  var SKRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
  var WARTEZEIT_MS = 30000;
  var laden = null;
  var instanz = null;

  function uuid() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }
    // Rueckfall fuer aeltere Browser: 16 Zufallsbytes als Hex.
    var bytes = new Uint8Array(16);
    window.crypto.getRandomValues(bytes);
    return Array.prototype.map.call(bytes, function (b) {
      return ("0" + b.toString(16)).slice(-2);
    }).join("");
  }

  function schluessel(zweck) {
    // Der Server nimmt 16 bis 128 Zeichen aus Buchstaben, Ziffern und ._:-
    return String(zweck || "anfrage").replace(/[^A-Za-z0-9._-]/g, "") + ":" + uuid();
  }

  function siteKey() {
    var konfig = window.SHOP_CONFIG || window.ARTICLE_SHOP_CONFIG || {};
    return String(konfig.turnstileSiteKey || "");
  }

  function skriptLaden() {
    if (window.turnstile) return Promise.resolve();
    if (laden) return laden;
    laden = new Promise(function (ok, fehler) {
      var s = document.createElement("script");
      s.src = SKRIPT;
      s.async = true;
      s.onload = function () { ok(); };
      s.onerror = function () { laden = null; fehler(new Error("turnstile_nicht_ladbar")); };
      document.head.appendChild(s);
    });
    return laden;
  }

  function waechter() {
    if (instanz) return instanz;
    var key = siteKey();
    // Ohne Site-Key laeuft der Server im Testbetrieb ohne Turnstile - dann
    // wird auch keins geholt. Im Livebetrieb verweigert der Server Anfragen
    // ohne Token; ein fehlender Schluessel faellt also beim ersten Test auf.
    if (!key) {
      instanz = { token: function () { return Promise.resolve(""); } };
      return instanz;
    }

    var vorrat = "";
    var wartende = [];
    var widget = null;
    var gestoert = false;

    // Fest unten rechts statt im Formular: Miet-Dialog und Kaufbereich werden
    // neu gezeichnet, ein Feld darin ginge dabei verloren. Unsichtbar, solange
    // Turnstile keine Rueckfrage braucht.
    var kasten = document.createElement("div");
    kasten.className = "d119-schutz";
    kasten.style.cssText = "position:fixed;right:12px;bottom:12px;z-index:2147483000;";
    document.body.appendChild(kasten);

    function nachfuellen() {
      if (widget === null || !window.turnstile) return;
      try { window.turnstile.reset(widget); } catch (e) { /* naechster token()-Aufruf versucht es erneut */ }
    }

    function ausgeben(wert) {
      gestoert = false;
      var naechster = wartende.shift();
      if (!naechster) { vorrat = wert; return; }
      clearTimeout(naechster.uhr);
      naechster.ok(wert);
      nachfuellen();
    }

    function scheitern(grund) {
      gestoert = true;
      vorrat = "";
      wartende.splice(0).forEach(function (w) {
        clearTimeout(w.uhr);
        w.nein(new Error(grund));
      });
    }

    function starten() {
      return skriptLaden().then(function () {
        if (widget !== null) return;
        widget = window.turnstile.render(kasten, {
          sitekey: key,
          appearance: "interaction-only",
          callback: ausgeben,
          // Abgelaufene Tokens erneuert Turnstile selbst; bis dahin gilt keins.
          "expired-callback": function () { vorrat = ""; },
          "error-callback": function () { scheitern("turnstile_fehler"); return true; },
        });
      });
    }

    var bereit = starten();
    bereit.catch(function () { /* wird beim naechsten token()-Aufruf gemeldet */ });

    instanz = {
      token: function () {
        // Konnte das Skript nicht geladen werden (Funkloch), beim naechsten
        // Absenden neu versuchen statt fuer immer beim alten Fehler zu bleiben.
        bereit = bereit.catch(starten);
        return bereit.then(function () {
          if (vorrat) {
            var wert = vorrat;
            vorrat = "";
            nachfuellen();
            return wert;
          }
          if (gestoert) nachfuellen();
          return new Promise(function (ok, nein) {
            var eintrag = { ok: ok, nein: nein, uhr: 0 };
            eintrag.uhr = setTimeout(function () {
              var pos = wartende.indexOf(eintrag);
              if (pos !== -1) wartende.splice(pos, 1);
              nein(new Error("turnstile_zeitueberschreitung"));
            }, WARTEZEIT_MS);
            wartende.push(eintrag);
          });
        });
      },
    };
    return instanz;
  }

  window.D119Schutz = { schluessel: schluessel, waechter: waechter };
})();

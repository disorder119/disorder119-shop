/* Widerrufsfunktion ("Vertrag widerrufen", § 356a BGB).

   Zwei Schritte, wie das Gesetz sie verlangt: erst Name, E-Mail-Adresse und
   Bestellung eingeben, dann auf einer Uebersicht mit "Widerruf bestaetigen"
   abschicken. Danach zeigt die Seite den Eingang mit Datum und Uhrzeit; die
   Eingangsbestaetigung kommt vom Server per Mail.

   Alle Texte kommen fertig uebersetzt aus build_site.py (window.WIDERRUF_TEXT),
   damit Seite und Skript nie auseinanderlaufen. */
(function () {
  "use strict";

  var CFG = window.SHOP_CONFIG || {};
  var T = window.WIDERRUF_TEXT || {};
  var API = String(CFG.shopWorkerUrl || "").replace(/\/+$/, "");
  var LANG = (document.documentElement.lang || "de").slice(0, 2);

  function el(id) { return document.getElementById(id); }
  function zeigen(knoten, sichtbar) { if (knoten) knoten.hidden = !sichtbar; }

  var form = el("wdForm");
  if (!form) return;
  var pruefen = el("wdPruefen");
  var fertig = el("wdFertig");
  var meldungBox = el("wdMeldung");
  var bestaetigen = el("wdBestaetigen");
  var angaben = null;

  function meldung(art, text) {
    meldungBox.textContent = text || "";
    meldungBox.className = "konto-meldung" + (art ? " konto-meldung--" + art : "");
    zeigen(meldungBox, Boolean(text));
    if (text) meldungBox.focus();
  }

  // ?bestellung=D119-... aus der Bestellbestaetigung oder dem Kundenkonto.
  try {
    var vorgabe = new URLSearchParams(location.search).get("bestellung");
    if (vorgabe) el("wdBestellung").value = vorgabe.slice(0, 120);
  } catch (e) { /* alter Browser: Feld bleibt leer */ }

  function umfang() {
    var gewaehlt = form.querySelector('input[name="umfang"]:checked');
    return gewaehlt ? gewaehlt.value : "GANZ";
  }

  function teileFeldAnpassen() {
    var teil = umfang() === "TEIL";
    zeigen(el("wdTeileFeld"), teil);
    el("wdTeile").required = teil;
  }
  Array.prototype.forEach.call(form.querySelectorAll('input[name="umfang"]'), function (radio) {
    radio.addEventListener("change", teileFeldAnpassen);
  });
  teileFeldAnpassen();

  // Turnstile wie bei Konto und Newsletter: bei Bedarf nachladen und schon
  // waehrend der Uebersicht vorbereiten, damit beim Bestaetigen nichts wartet.
  function schutzLaden() {
    if (window.D119Schutz) return Promise.resolve(window.D119Schutz);
    return new Promise(function (ok, nein) {
      var s = document.createElement("script");
      s.src = "/assets/schutz.js";
      s.async = true;
      s.onload = function () { if (window.D119Schutz) ok(window.D119Schutz); else nein(new Error("schutz_fehlt")); };
      s.onerror = function () { nein(new Error("schutz_nicht_ladbar")); };
      document.head.appendChild(s);
    });
  }

  function zeile(liste, beschriftung, wert) {
    var dt = document.createElement("dt");
    dt.textContent = beschriftung;
    var dd = document.createElement("dd");
    dd.textContent = wert;
    liste.appendChild(dt);
    liste.appendChild(dd);
  }

  function zusammenfassen(liste, daten, extra) {
    liste.textContent = "";
    zeile(liste, T.name, daten.name);
    zeile(liste, T.email, daten.email);
    zeile(liste, T.bestellung, daten.bestellnummer);
    zeile(liste, T.umfang, daten.umfang === "TEIL" ? T.umfangTeil + ": " + daten.teile : T.umfangGanz);
    if (daten.nachricht) zeile(liste, T.nachricht, daten.nachricht);
    (extra || []).forEach(function (paar) { zeile(liste, paar[0], paar[1]); });
  }

  form.addEventListener("submit", function (ereignis) {
    ereignis.preventDefault();
    meldung("", "");
    var daten = {
      name: el("wdName").value.trim(),
      email: el("wdEmail").value.trim(),
      bestellnummer: el("wdBestellung").value.trim(),
      umfang: umfang(),
      teile: el("wdTeile").value.trim(),
      nachricht: el("wdNachricht").value.trim(),
    };
    if (!daten.name || !daten.bestellnummer || (daten.umfang === "TEIL" && !daten.teile)) {
      meldung("fehler", T.pflicht);
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(daten.email)) {
      meldung("fehler", T.emailFalsch);
      el("wdEmail").focus();
      return;
    }
    angaben = daten;
    zusammenfassen(el("wdZusammenfassung"), daten);
    zeigen(form, false);
    zeigen(pruefen, true);
    el("wdPruefenTitel").focus();
    if (API) schutzLaden().then(function (S) { S.waechter(); }).catch(function () {});
  });

  el("wdAendern").addEventListener("click", function () {
    zeigen(pruefen, false);
    zeigen(form, true);
    el("wdName").focus();
  });

  function fehlerText(fehler) {
    var code = (fehler && (fehler.code || fehler.message)) || "";
    if (/^TURNSTILE_|^turnstile_|^schutz_/.test(code)) return T.fehlerPruefung;
    if (code === "RATE_LIMITED") return T.fehlerZuOft;
    if (code === "EMAIL_UNGUELTIG") return T.emailFalsch;
    return T.fehlerAllgemein;
  }

  bestaetigen.addEventListener("click", function () {
    if (!angaben) return;
    if (!API) { meldung("fehler", T.fehlerAllgemein); return; }
    bestaetigen.disabled = true;
    meldung("info", T.sende);
    schutzLaden()
      .then(function (S) { return S.waechter().token(); })
      .then(function (token) {
        var koerper = {
          name: angaben.name,
          email: angaben.email,
          bestellnummer: angaben.bestellnummer,
          umfang: angaben.umfang,
          teile: angaben.umfang === "TEIL" ? angaben.teile : "",
          nachricht: angaben.nachricht,
          sprache: LANG,
          bestaetigt: true,
          turnstileToken: token || undefined,
        };
        var kopf = { "Content-Type": "application/json" };
        if (token) kopf["X-Turnstile-Token"] = token;
        return fetch(API + "/widerruf", { method: "POST", headers: kopf, body: JSON.stringify(koerper) });
      })
      .then(function (antwort) {
        return antwort.json().catch(function () { return {}; }).then(function (daten) {
          if (!antwort.ok) {
            var fehler = new Error(daten.error || "REQUEST_FAILED");
            fehler.code = daten.error || "REQUEST_FAILED";
            throw fehler;
          }
          return daten;
        });
      })
      .then(function (daten) {
        meldung("", "");
        el("wdEingang").textContent = T.eingangText.replace("{zeit}", daten.eingegangen || "");
        zusammenfassen(el("wdBeleg"), angaben, [[T.eingegangen, daten.eingegangen || ""], [T.vorgang, daten.vorgang || ""]]);
        el("wdMailHinweis").textContent = (daten.bestaetigungGesendet ? T.mailGesendet : T.mailFolgt)
          .replace("{email}", daten.email || angaben.email);
        zeigen(pruefen, false);
        zeigen(fertig, true);
        el("wdFertigTitel").focus();
      })
      .catch(function (fehler) {
        bestaetigen.disabled = false;
        meldung("fehler", fehlerText(fehler));
      });
  });

  el("wdDrucken").addEventListener("click", function () { window.print(); });
})();

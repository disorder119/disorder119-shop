/* Kundenkonto. Eigene, schlanke Seite statt eines weiteren Zustands in
   assets/app.js: das Konto teilt sich mit dem Archiv weder Katalogmaschine noch
   Filter noch Warenkorb, und eine Aenderung hier kann den laufenden Shop nicht
   beschaedigen.

   Bilder kommen aus dem oeffentlichen catalog.json, nicht aus dem Worker - der
   Worker liefert nur die Artikelnummer. So laufen keine Bilddaten durch die
   Bestell-Schnittstelle, und die Fotos kommen weiter vom CDN. */
(function () {
  "use strict";

  var CFG = window.SHOP_CONFIG || {};
  var API = String(CFG.shopWorkerUrl || "").replace(/\/+$/, "");
  var LANG = document.documentElement.lang || "de";
  // Absolut ab Wurzel, nicht relativ: /en/konto/ und /fr/konto/ liegen eine
  // Ebene tiefer, ein "../data/catalog.json" landete dort bei /en/data/.
  var HOME = LANG === "de" ? "/" : "/" + LANG + "/";

  var T = {
    de: {
      titel: "Dein Konto",
      loginIntro: "Gib die E-Mail-Adresse ein, mit der du bestellt hast. Du bekommst einen Anmeldelink — ein Passwort brauchst du nicht.",
      emailLabel: "E-Mail-Adresse",
      loginBtn: "Anmeldelink schicken",
      loginGesendet: "Falls zu dieser Adresse ein Konto passt, ist der Anmeldelink unterwegs. Er gilt 20 Minuten.",
      pruefe: "Einen Moment …",
      linkUngueltig: "Dieser Anmeldelink ist abgelaufen oder wurde schon benutzt. Fordere einfach einen neuen an.",
      abmelden: "Abmelden",
      bestellungen: "Bestellungen",
      keineBestellungen: "Hier erscheinen deine Bestellungen, sobald du etwas gekauft hast.",
      bestellNr: "Bestellung",
      zwischensumme: "Zwischensumme",
      versand: "Versand",
      gesamt: "Gesamt",
      sendung: "Sendung verfolgen",
      adresse: "Lieferadresse",
      adresseSpeichern: "Adresse speichern",
      adresseGespeichert: "Adresse gespeichert.",
      empfaenger: "Name",
      strasse: "Straße und Hausnummer",
      zusatz: "Adresszusatz (optional)",
      plz: "PLZ",
      ort: "Ort",
      land: "Land",
      widerruf: "Widerruf erklären",
      widerrufFrage: "Widerruf für diese Bestellung erklären? Du hast 14 Tage ab Erhalt. Wir melden uns dann mit den Rücksendehinweisen.",
      widerrufOk: "Dein Widerruf ist eingegangen. Wir melden uns mit den Rücksendehinweisen.",
      daten: "Deine Daten",
      datenExport: "Daten herunterladen",
      datenLoeschen: "Konto löschen lassen",
      loeschFrage: "Konto wirklich löschen lassen? Bestell- und Rechnungsdaten müssen wir gesetzlich aufbewahren (§ 147 AO). Dein Konto wird gesperrt und du wirst abgemeldet.",
      loeschOk: "Dein Löschwunsch ist eingegangen. Du wurdest abgemeldet.",
      fehler: "Das hat nicht geklappt. Versuch es bitte noch einmal.",
      pruefungFehlgeschlagen: "Die Sicherheitsprüfung hat nicht geklappt. Lade die Seite bitte neu und versuch es noch einmal.",
      zuOft: "Zu viele Versuche in kurzer Zeit. Warte bitte ein paar Minuten.",
      nichtAktiv: "Das Kundenkonto ist noch nicht freigeschaltet.",
      status: {
        PAID: "Bezahlt", PREPARING: "Wird gepackt", SHIPPED: "Unterwegs",
        DELIVERED: "Zugestellt", RETURN_REQUESTED: "Widerruf erklärt",
        RETURNED: "Zurückgesendet", REFUNDED: "Erstattet", CANCELLED: "Storniert",
        PAYMENT_PENDING: "Zahlung offen", RESERVED: "Reserviert",
      },
    },
    en: {
      titel: "Your account",
      loginIntro: "Enter the e-mail address you ordered with. You will get a sign-in link — no password needed.",
      emailLabel: "E-mail address",
      loginBtn: "Send sign-in link",
      loginGesendet: "If an account matches this address, the sign-in link is on its way. It is valid for 20 minutes.",
      pruefe: "One moment …",
      linkUngueltig: "This sign-in link has expired or was already used. Just request a new one.",
      abmelden: "Sign out",
      bestellungen: "Orders",
      keineBestellungen: "Your orders will appear here once you have bought something.",
      bestellNr: "Order",
      zwischensumme: "Subtotal",
      versand: "Shipping",
      gesamt: "Total",
      sendung: "Track parcel",
      adresse: "Delivery address",
      adresseSpeichern: "Save address",
      adresseGespeichert: "Address saved.",
      empfaenger: "Name",
      strasse: "Street and number",
      zusatz: "Additional address line (optional)",
      plz: "Postcode",
      ort: "City",
      land: "Country",
      widerruf: "Withdraw from contract",
      widerrufFrage: "Withdraw from this order? You have 14 days from receipt. We will send you the return instructions.",
      widerrufOk: "Your withdrawal has been received. We will send you the return instructions.",
      daten: "Your data",
      datenExport: "Download my data",
      datenLoeschen: "Request account deletion",
      loeschFrage: "Really request deletion? Order and invoice data must be kept by law. Your account will be locked and you will be signed out.",
      loeschOk: "Your deletion request has been received. You have been signed out.",
      fehler: "That did not work. Please try again.",
      pruefungFehlgeschlagen: "The security check did not work. Please reload the page and try again.",
      zuOft: "Too many attempts in a short time. Please wait a few minutes.",
      nichtAktiv: "Customer accounts are not active yet.",
      status: {
        PAID: "Paid", PREPARING: "Being packed", SHIPPED: "On its way",
        DELIVERED: "Delivered", RETURN_REQUESTED: "Withdrawal declared",
        RETURNED: "Returned", REFUNDED: "Refunded", CANCELLED: "Cancelled",
        PAYMENT_PENDING: "Payment open", RESERVED: "Reserved",
      },
    },
    fr: {
      titel: "Ton compte",
      loginIntro: "Saisis l'adresse e-mail utilisée pour ta commande. Tu recevras un lien de connexion — sans mot de passe.",
      emailLabel: "Adresse e-mail",
      loginBtn: "Envoyer le lien",
      loginGesendet: "Si un compte correspond à cette adresse, le lien est en route. Il est valable 20 minutes.",
      pruefe: "Un instant …",
      linkUngueltig: "Ce lien a expiré ou a déjà été utilisé. Demande simplement un nouveau lien.",
      abmelden: "Se déconnecter",
      bestellungen: "Commandes",
      keineBestellungen: "Tes commandes apparaîtront ici dès ton premier achat.",
      bestellNr: "Commande",
      zwischensumme: "Sous-total",
      versand: "Livraison",
      gesamt: "Total",
      sendung: "Suivre le colis",
      adresse: "Adresse de livraison",
      adresseSpeichern: "Enregistrer l'adresse",
      adresseGespeichert: "Adresse enregistrée.",
      empfaenger: "Nom",
      strasse: "Rue et numéro",
      zusatz: "Complément d'adresse (facultatif)",
      plz: "Code postal",
      ort: "Ville",
      land: "Pays",
      widerruf: "Exercer la rétractation",
      widerrufFrage: "Te rétracter pour cette commande ? Tu disposes de 14 jours à compter de la réception. Nous t'enverrons les instructions de retour.",
      widerrufOk: "Ta rétractation est enregistrée. Nous t'enverrons les instructions de retour.",
      daten: "Tes données",
      datenExport: "Télécharger mes données",
      datenLoeschen: "Demander la suppression",
      loeschFrage: "Demander vraiment la suppression ? Les données de commande et de facturation doivent être conservées par la loi. Ton compte sera bloqué et tu seras déconnecté.",
      loeschOk: "Ta demande de suppression est enregistrée. Tu as été déconnecté.",
      fehler: "Cela n'a pas fonctionné. Réessaie.",
      pruefungFehlgeschlagen: "La vérification de sécurité a échoué. Recharge la page et réessaie.",
      zuOft: "Trop de tentatives en peu de temps. Patiente quelques minutes.",
      nichtAktiv: "Le compte client n'est pas encore activé.",
      status: {
        PAID: "Payée", PREPARING: "En préparation", SHIPPED: "En route",
        DELIVERED: "Livrée", RETURN_REQUESTED: "Rétractation déclarée",
        RETURNED: "Retournée", REFUNDED: "Remboursée", CANCELLED: "Annulée",
        PAYMENT_PENDING: "Paiement en attente", RESERVED: "Réservée",
      },
    },
  };
  var t = T[LANG] || T.de;

  // Die Sitzung liegt im HttpOnly-Cookie, das der Worker setzt. Der Wert hier
  // ist nur der Rueckfall fuer Browser, die das Cookie zwischen den beiden
  // Adressen nicht mitschicken (etwa bei strengem Trackingschutz).
  var SPEICHER = "d119_konto_sitzung";
  function sitzung() {
    try { return window.localStorage.getItem(SPEICHER) || ""; } catch (e) { return ""; }
  }
  function sitzungSetzen(wert) {
    try {
      if (wert) window.localStorage.setItem(SPEICHER, wert);
      else window.localStorage.removeItem(SPEICHER);
    } catch (e) { /* privater Modus: dann traegt allein das Cookie */ }
  }

  var katalogCache = null;
  function katalog() {
    if (katalogCache) return katalogCache;
    katalogCache = fetch("/data/catalog.json", { credentials: "omit" })
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (liste) {
        var karte = {};
        (liste || []).forEach(function (it) { karte[String(it.id)] = it; });
        return karte;
      })
      .catch(function () { return {}; });
    return katalogCache;
  }

  function api(pfad, optionen) {
    var opts = optionen || {};
    var kopf = { "Content-Type": "application/json" };
    var token = sitzung();
    if (token) kopf.Authorization = "Bearer " + token;
    return fetch(API + pfad, {
      method: opts.method || "GET",
      headers: kopf,
      credentials: "include",
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    }).then(function (antwort) {
      return antwort.json().catch(function () { return {}; }).then(function (daten) {
        if (!antwort.ok) {
          var fehler = new Error(daten.error || "REQUEST_FAILED");
          fehler.code = daten.error || "REQUEST_FAILED";
          fehler.status = antwort.status;
          throw fehler;
        }
        return daten;
      });
    });
  }

  function el(id) { return document.getElementById(id); }
  function text(knoten, wert) { knoten.textContent = wert; }
  function zeigen(knoten, sichtbar) { knoten.hidden = !sichtbar; }

  function preis(cents, waehrung) {
    try {
      return new Intl.NumberFormat(LANG === "de" ? "de-DE" : LANG === "fr" ? "fr-FR" : "en-GB",
        { style: "currency", currency: waehrung || "EUR" }).format((cents || 0) / 100);
    } catch (e) {
      return ((cents || 0) / 100).toFixed(2) + " €";
    }
  }

  function datum(iso) {
    var d = new Date(String(iso || ""));
    if (isNaN(d.getTime())) return "";
    return d.toLocaleDateString(LANG === "de" ? "de-DE" : LANG === "fr" ? "fr-FR" : "en-GB",
      { day: "2-digit", month: "2-digit", year: "numeric" });
  }

  function meldung(art, inhalt) {
    var box = el("kontoMeldung");
    text(box, inhalt);
    box.className = "konto-meldung konto-meldung--" + art;
    zeigen(box, Boolean(inhalt));
    if (inhalt) box.focus();
  }

  // ------------------------------------------------------------- Anmeldung

  function anmeldeFormular() {
    zeigen(el("kontoAnmeldung"), true);
    zeigen(el("kontoBereich"), false);
    zeigen(el("kontoAbmelden"), false);
    // Pruefung schon starten, waehrend die Adresse getippt wird - dann liegt
    // beim Absenden ein Token bereit.
    if (API) schutzLaden().then(function (S) { S.waechter(); }).catch(function () {});
  }

  function angemeldet(email) {
    zeigen(el("kontoAnmeldung"), false);
    zeigen(el("kontoBereich"), true);
    zeigen(el("kontoAbmelden"), true);
    text(el("kontoEmail"), email || "");
    bestellungenLaden();
    profilLaden();
  }

  // Jeder Anmeldelink ist eine Mail auf Kosten des Shop-Kontingents. Ohne
  // Turnstile koennte ein Skript damit das Tageskontingent leeren - und dann
  // kaeme auch keine Bestellbestaetigung mehr an.
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

  function anmeldeFehlerText(fehler) {
    var code = (fehler && (fehler.code || fehler.message)) || "";
    if (/^TURNSTILE_|^turnstile_|^schutz_/.test(code)) return t.pruefungFehlgeschlagen;
    if (code === "RATE_LIMITED") return t.zuOft;
    return t.fehler;
  }

  function anmeldelinkAnfordern(ereignis) {
    ereignis.preventDefault();
    var knopf = el("kontoLoginBtn");
    var email = el("kontoLoginEmail").value.trim();
    if (!email) return;
    knopf.disabled = true;
    schutzLaden()
      .then(function (S) { return S.waechter().token(); })
      .then(function (token) {
        return api("/account/login", { method: "POST", body: { email: email, turnstileToken: token } });
      })
      .then(function () { meldung("ok", t.loginGesendet); })
      .catch(function (fehler) { meldung("fehler", anmeldeFehlerText(fehler)); })
      .then(function () { knopf.disabled = false; });
  }

  function linkEinloesen(token) {
    meldung("info", t.pruefe);
    api("/account/session", { method: "POST", body: { token: token } })
      .then(function (daten) {
        sitzungSetzen(daten.session || "");
        meldung("", "");
        angemeldet(daten.email);
      })
      .catch(function () {
        sitzungSetzen("");
        meldung("fehler", t.linkUngueltig);
        anmeldeFormular();
      });
  }

  function abmelden() {
    api("/account/logout", { method: "POST", body: {} })
      .catch(function () { /* auch ohne Serverantwort lokal abmelden */ })
      .then(function () {
        sitzungSetzen("");
        meldung("", "");
        anmeldeFormular();
      });
  }

  // ----------------------------------------------------------- Bestellungen

  function bestellKarte(bestellung, bilder) {
    var karte = document.createElement("article");
    karte.className = "bestellung";

    var kopf = document.createElement("header");
    kopf.className = "bestellung__kopf";
    var nummer = document.createElement("h3");
    nummer.textContent = t.bestellNr + " " + bestellung.orderNumber;
    var meta = document.createElement("p");
    meta.className = "bestellung__meta";
    var statusText = (t.status && t.status[bestellung.status]) || bestellung.status;
    meta.textContent = datum(bestellung.createdAt) + " · " + statusText;
    kopf.appendChild(nummer);
    kopf.appendChild(meta);
    karte.appendChild(kopf);

    var liste = document.createElement("ul");
    liste.className = "bestellung__teile";
    (bestellung.items || []).forEach(function (teil) {
      var zeile = document.createElement("li");
      var eintrag = bilder[String(teil.itemId)];
      var bildPfad = eintrag && (eintrag.grid_image || (eintrag.gallery && eintrag.gallery[0]));
      if (bildPfad) {
        var bild = document.createElement("img");
        bild.src = "/" + bildPfad;
        bild.alt = teil.title;
        bild.loading = "lazy";
        bild.width = 72;
        bild.height = 96;
        zeile.appendChild(bild);
      }
      var text2 = document.createElement("div");
      var titel = document.createElement("strong");
      if (eintrag) {
        var verweis = document.createElement("a");
        verweis.href = HOME + "artikel/" + teil.itemId + "/";
        verweis.textContent = teil.title;
        titel.appendChild(verweis);
      } else {
        titel.textContent = teil.title;
      }
      text2.appendChild(titel);
      if (teil.articleNo) {
        var art = document.createElement("span");
        art.className = "bestellung__art";
        art.textContent = "Art.-Nr. " + teil.articleNo;
        text2.appendChild(art);
      }
      var p = document.createElement("span");
      p.className = "bestellung__preis";
      p.textContent = preis(teil.priceCents, bestellung.currency);
      text2.appendChild(p);
      zeile.appendChild(text2);
      liste.appendChild(zeile);
    });
    karte.appendChild(liste);

    var summe = document.createElement("dl");
    summe.className = "bestellung__summe";
    [[t.zwischensumme, bestellung.subtotalCents, false],
     [t.versand, bestellung.shippingCents, false],
     [t.gesamt, bestellung.totalCents, true]].forEach(function (zeile) {
      var dt = document.createElement("dt");
      dt.textContent = zeile[0];
      var dd = document.createElement("dd");
      dd.textContent = preis(zeile[1], bestellung.currency);
      if (zeile[2]) { dt.className = "ist-gesamt"; dd.className = "ist-gesamt"; }
      summe.appendChild(dt);
      summe.appendChild(dd);
    });
    karte.appendChild(summe);

    var fuss = document.createElement("div");
    fuss.className = "bestellung__fuss";
    if (bestellung.shipment && bestellung.shipment.trackingUrl) {
      var sendung = document.createElement("a");
      sendung.className = "konto-btn konto-btn--schlicht";
      sendung.href = bestellung.shipment.trackingUrl;
      sendung.target = "_blank";
      sendung.rel = "noopener";
      sendung.textContent = t.sendung;
      fuss.appendChild(sendung);
    }
    if (["PAID", "PREPARING", "SHIPPED", "DELIVERED"].indexOf(bestellung.status) >= 0) {
      var widerruf = document.createElement("button");
      widerruf.type = "button";
      widerruf.className = "konto-btn konto-btn--schlicht";
      widerruf.textContent = t.widerruf;
      widerruf.addEventListener("click", function () {
        if (!window.confirm(t.widerrufFrage)) return;
        widerruf.disabled = true;
        api("/account/orders/" + encodeURIComponent(bestellung.id) + "/widerruf",
          { method: "POST", body: { grund: "WITHDRAWAL" } })
          .then(function () { meldung("ok", t.widerrufOk); bestellungenLaden(); })
          .catch(function () { meldung("fehler", t.fehler); widerruf.disabled = false; });
      });
      fuss.appendChild(widerruf);
    }
    if (fuss.childNodes.length) karte.appendChild(fuss);
    return karte;
  }

  function bestellungenLaden() {
    var ziel = el("kontoBestellungen");
    Promise.all([api("/account/orders"), katalog()]).then(function (ergebnis) {
      var bestellungen = ergebnis[0].orders || [];
      var bilder = ergebnis[1];
      ziel.innerHTML = "";
      if (!bestellungen.length) {
        var leer = document.createElement("p");
        leer.className = "konto-leer";
        leer.textContent = t.keineBestellungen;
        ziel.appendChild(leer);
        return;
      }
      bestellungen.forEach(function (bestellung) {
        ziel.appendChild(bestellKarte(bestellung, bilder));
      });
    }).catch(function (fehler) {
      if (fehler.status === 401) { sitzungSetzen(""); anmeldeFormular(); return; }
      meldung("fehler", t.fehler);
    });
  }

  // --------------------------------------------------------------- Adresse

  function profilLaden() {
    api("/account/profile").then(function (daten) {
      text(el("kontoEmail"), daten.email || "");
      var adresse = (daten.addresses || [])[0];
      if (!adresse) return;
      el("adrName").value = adresse.recipientName || "";
      el("adrStrasse").value = adresse.addressLine1 || "";
      el("adrZusatz").value = adresse.addressLine2 || "";
      el("adrPlz").value = adresse.postalCode || "";
      el("adrOrt").value = adresse.city || "";
      el("adrLand").value = adresse.countryCode || "DE";
    }).catch(function () { /* Adresse ist optional */ });
  }

  function adresseSpeichern(ereignis) {
    ereignis.preventDefault();
    var knopf = el("adrSpeichern");
    knopf.disabled = true;
    api("/account/address", {
      method: "PUT",
      body: {
        recipientName: el("adrName").value.trim(),
        addressLine1: el("adrStrasse").value.trim(),
        addressLine2: el("adrZusatz").value.trim(),
        postalCode: el("adrPlz").value.trim(),
        city: el("adrOrt").value.trim(),
        countryCode: (el("adrLand").value || "DE").trim().toUpperCase(),
      },
    }).then(function () { meldung("ok", t.adresseGespeichert); })
      .catch(function () { meldung("fehler", t.fehler); })
      .then(function () { knopf.disabled = false; });
  }

  // ------------------------------------------------------------ Datenschutz

  function datenHerunterladen() {
    api("/account/export").then(function (antwort) {
      var inhalt = JSON.stringify(antwort.daten, null, 2);
      var blob = new Blob([inhalt], { type: "application/json" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = "disorder119-meine-daten.json";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    }).catch(function () { meldung("fehler", t.fehler); });
  }

  function kontoLoeschen() {
    if (!window.confirm(t.loeschFrage)) return;
    api("/account/loeschen", { method: "POST", body: {} })
      .then(function () {
        sitzungSetzen("");
        meldung("ok", t.loeschOk);
        anmeldeFormular();
      })
      .catch(function () { meldung("fehler", t.fehler); });
  }

  // ----------------------------------------------------------------- Start

  function start() {
    text(el("kontoTitel"), t.titel);
    text(el("kontoLoginIntro"), t.loginIntro);
    text(el("kontoLoginLabel"), t.emailLabel);
    text(el("kontoLoginBtn"), t.loginBtn);
    text(el("kontoAbmelden"), t.abmelden);
    text(el("kontoBestellungenTitel"), t.bestellungen);
    text(el("kontoAdresseTitel"), t.adresse);
    text(el("adrNameLabel"), t.empfaenger);
    text(el("adrStrasseLabel"), t.strasse);
    text(el("adrZusatzLabel"), t.zusatz);
    text(el("adrPlzLabel"), t.plz);
    text(el("adrOrtLabel"), t.ort);
    text(el("adrLandLabel"), t.land);
    text(el("adrSpeichern"), t.adresseSpeichern);
    text(el("kontoDatenTitel"), t.daten);
    text(el("kontoExport"), t.datenExport);
    text(el("kontoLoeschen"), t.datenLoeschen);

    if (!API) {
      meldung("info", t.nichtAktiv);
      zeigen(el("kontoAnmeldung"), false);
      return;
    }

    el("kontoLoginForm").addEventListener("submit", anmeldelinkAnfordern);
    el("kontoAdressForm").addEventListener("submit", adresseSpeichern);
    el("kontoAbmelden").addEventListener("click", abmelden);
    el("kontoExport").addEventListener("click", datenHerunterladen);
    el("kontoLoeschen").addEventListener("click", kontoLoeschen);

    var parameter = new URLSearchParams(window.location.search);
    var linkToken = parameter.get("anmeldung");
    if (linkToken) {
      // Das Token gehoert nicht in den Verlauf und nicht in den Referrer.
      window.history.replaceState({}, "", window.location.pathname);
      linkEinloesen(linkToken);
      return;
    }

    // Schon angemeldet? Das Cookie allein reicht, deshalb wird es einfach
    // versucht - schlaegt es fehl, erscheint das Anmeldeformular.
    api("/account/profile")
      .then(function (daten) { angemeldet(daten.email); })
      .catch(function () { anmeldeFormular(); });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();

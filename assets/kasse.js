/* Kasse: Stuecke aus dem Warenkorb (oder ?artikel=<ID> von der Produktseite),
   Lieferadresse mit Vorschlaegen fuer Ort und Strasse, Versandart mit
   Live-Preis und Bezahlen mit PayPal.

   Der Browser rechnet hier nichts Verbindliches: Preise, Paketgroesse,
   Versandpreis und Adresse prueft der Server (shop-worker) beim Bestellen
   noch einmal selbst. Ist PayPal noch nicht verbunden, geht die komplette
   Bestellung als E-Mail-Anfrage raus - so bleibt die Seite nie eine Sackgasse. */
(function () {
  "use strict";

  var CFG = window.SHOP_CONFIG || {};
  var LANG = window.KASSE_LANG || document.documentElement.lang || "de";
  var HOME = LANG === "de" ? "/" : "/" + LANG + "/";
  var WORKER = /^https:\/\//.test(String(CFG.shopWorkerUrl || "")) ? String(CFG.shopWorkerUrl).replace(/\/$/, "") : "";
  var CART_KEY = "disorder119_cart";
  var CODE_KEY = "d119_coupon_code";
  var PAYPAL_BEREIT = !!(CFG.features && CFG.features.paypalCheckout && CFG.paypalClientId && WORKER);

  var TEXTE = {
    de: {
      titel: "Kasse", zurueck: "Warenkorb", stuecke: "Deine Stücke", adresse: "Lieferadresse", versand: "Versand",
      uebersicht: "Übersicht", email: "E-Mail-Adresse für Bestellung und Rechnung", kontoAnlegen: "Kostenloses Kundenkonto erstellen (optional). Nach der Zahlung erhältst du einen Anmeldelink.",
      fehltEmail: "Bitte gib eine gültige E-Mail-Adresse an.", appleCoupon: "Mit Gutschein bitte PayPal wählen; der Rabatt wird dort vor der Zahlung geprüft.",
      vorname: "Vorname", nachname: "Nachname", plz: "PLZ", ort: "Ort", strasse: "Straße",
      hausnummer: "Nr.", zusatz: "Adresszusatz (optional)",
      landHinweis: "Wir liefern innerhalb Deutschlands. Lieferung an eine Packstation ist bald mit DHL möglich.",
      agb: "AGB & Widerruf", datenschutz: "Datenschutz", impressum: "Impressum", widerruf: "Vertrag widerrufen",
      laedt: "Wird geladen …", leer: "Dein Warenkorb ist leer.", zumArchiv: "Zum Archiv",
      nichtMehr: "Nicht mehr verfügbar – wird nicht mitbestellt:", groesse: "Größe", paket: "Paket",
      paketS: "klein", paketM: "mittel", paketL: "groß", tag1: "1 Werktag", tageN: "{n} Werktage",
      versandLaedt: "Versand wird berechnet …", versandFehlt: "Der Versandpreis ist gerade nicht abrufbar. Bitte lade die Seite gleich neu.",
      versandWahlFehlt: "Dein gewählter Versanddienst ist nicht mehr verfügbar. Bitte wähle eine neue Versandart.",
      zwischensumme: "Stücke", versandZeile: "Versand", gesamt: "Gesamt",
      gutschein: "Gutschein {code} wird beim Bezahlen verrechnet.",
      recht: "Kleinunternehmer gemäß § 19 UStG, daher keine Umsatzsteuer. Versand in der Regel innerhalb von 2 Werktagen. Mit dem PayPal-Knopf und deiner Bestätigung bei PayPal bestellst du zahlungspflichtig. PayPal reserviert den Betrag – abgebucht wird erst mit dem Versand, spätestens drei Tage nach der Bestellung.",
      rechtAnfrage: "Kleinunternehmer gemäß § 19 UStG, daher keine Umsatzsteuer. Die Anfrage ist unverbindlich – wir bestätigen Verfügbarkeit und Gesamtpreis per E-Mail.",
      agbLink: "AGB und Widerrufsbelehrung", dsLink: "Datenschutz",
      paypalBald: "Bezahlen mit PayPal kommt in Kürze. Bis dahin schickst du uns die Bestellung per E-Mail – mit Adresse und Versandart, wir bestätigen sie dir.",
      anfrage: "Bestellung per E-Mail senden", betreff: "Bestellung Disorder119",
      fehltVorname: "Bitte gib deinen Vornamen an.", fehltNachname: "Bitte gib deinen Nachnamen an.",
      fehltPlz: "Bitte gib eine fünfstellige PLZ an.", fehltOrt: "Bitte gib den Ort an.", fehltStrasse: "Bitte gib die Straße an.",
      fehltNummer: "Bitte gib die Hausnummer an.", packstation: "An eine Packstation oder Filiale können wir noch nicht liefern – das kommt bald mit DHL.",
      plzUnbekannt: "Diese PLZ kennen wir nicht – bitte prüf sie noch einmal.", ortWaehlen: "Bitte wähle deinen Ort:",
      pruefen: "Bitte prüf die markierten Felder.", schonWeg: "Ein Stück ist gerade reserviert oder schon verkauft. Wir haben die Liste aktualisiert.",
      versandGeaendert: "Der Versandpreis hat sich gerade geändert. Bitte prüf die Übersicht und klick noch einmal auf PayPal.",
      abgelaufen: "Die Reservierung ist abgelaufen, es wurde nichts abgebucht. Bitte klick noch einmal auf PayPal.",
      wirdGeprueft: "PayPal prüft deine Zahlung noch. Sobald sie bestätigt ist, bekommst du eine Mail – bitte nicht noch einmal bezahlen.",
      botCheck: "Die Sicherheitsprüfung hat nicht geklappt. Lade die Seite bitte neu und versuch es noch einmal.",
      zuSchnell: "Zu viele Versuche in kurzer Zeit. Warte bitte eine Minute.",
      nurDe: "Wir liefern bisher nur innerhalb Deutschlands.",
      fehler: "Da ist leider etwas schiefgelaufen. Bitte versuch es gleich noch einmal oder schreib uns.",
      abschliessen: "Zahlung wird abgeschlossen …", abgebrochen: "Bezahlung abgebrochen – es wurde nichts abgebucht.",
      danke: "Danke für deine Bestellung!", bestellnr: "Bestellnummer:",
      dankeText: "Die Bestellbestätigung kommt an deine angegebene E-Mail-Adresse. PayPal hat den Betrag reserviert – abgebucht wird erst, wenn wir versenden (spätestens nach drei Tagen), dann kommt auch die Rechnung. Wir packen deine Stücke von Hand und verschicken sie in der Regel innerhalb von 2 Werktagen.",
      dankeTextEingezogen: "Die Bestätigung mit Rechnung kommt an deine angegebene E-Mail-Adresse. Wir packen deine Stücke von Hand und verschicken sie in der Regel innerhalb von 2 Werktagen.",
      konto: "Bestellung im Konto ansehen", weiter: "Weiter stöbern",
      mailAdresse: "Lieferadresse", mailVersand: "Versand", mailGesamt: "Gesamt", mailGruss: "Hallo! Ich möchte folgende Stücke bestellen:",
      mailFrage: "Bitte bestätigt mir Verfügbarkeit und Zahlungsweg. Danke!"
    },
    en: {
      titel: "Checkout", zurueck: "Cart", stuecke: "Your pieces", adresse: "Delivery address", versand: "Shipping",
      uebersicht: "Summary", email: "Email address for order and invoice", kontoAnlegen: "Create a free customer account (optional). We will email a sign-in link after payment.",
      fehltEmail: "Please enter a valid email address.", appleCoupon: "For coupons, please choose PayPal; the discount is checked before payment.",
      vorname: "First name", nachname: "Last name", plz: "Postcode", ort: "Town", strasse: "Street",
      hausnummer: "No.", zusatz: "Address line 2 (optional)",
      landHinweis: "We deliver within Germany. Delivery to a DHL Packstation is coming soon.",
      agb: "Terms & withdrawal", datenschutz: "Privacy", impressum: "Legal notice", widerruf: "Withdraw from contract here",
      laedt: "Loading …", leer: "Your cart is empty.", zumArchiv: "To the archive",
      nichtMehr: "No longer available – not included:", groesse: "Size", paket: "parcel",
      paketS: "small", paketM: "medium", paketL: "large", tag1: "1 working day", tageN: "{n} working days",
      versandLaedt: "Calculating shipping …", versandFehlt: "The shipping price is not available right now. Please reload the page in a moment.",
      versandWahlFehlt: "Your selected carrier is no longer available. Please choose another shipping option.",
      zwischensumme: "Pieces", versandZeile: "Shipping", gesamt: "Total",
      gutschein: "Coupon {code} is applied when you pay.",
      recht: "Small business under § 19 UStG, so no VAT is charged. Usually shipped within 2 working days. With the PayPal button and your confirmation at PayPal you place a binding order. PayPal reserves the amount – it is only charged when we ship, at the latest three days after your order.",
      rechtAnfrage: "Small business under § 19 UStG, so no VAT is charged. The request is non-binding – we confirm availability and the total by e-mail.",
      agbLink: "Terms and withdrawal", dsLink: "Privacy",
      paypalBald: "Paying with PayPal is coming soon. Until then, send us your order by e-mail – with address and shipping, and we will confirm it.",
      anfrage: "Send order by e-mail", betreff: "Order Disorder119",
      fehltVorname: "Please enter your first name.", fehltNachname: "Please enter your last name.",
      fehltPlz: "Please enter a five-digit postcode.", fehltOrt: "Please enter the town.", fehltStrasse: "Please enter the street.",
      fehltNummer: "Please enter the house number.", packstation: "We cannot deliver to a Packstation or post office yet – that is coming soon with DHL.",
      plzUnbekannt: "We don't know this postcode – please check it.", ortWaehlen: "Please pick your town:",
      pruefen: "Please check the highlighted fields.", schonWeg: "A piece has just been reserved or sold. We have updated the list.",
      versandGeaendert: "The shipping price has just changed. Please check the summary and click PayPal again.",
      abgelaufen: "The reservation has expired, nothing was charged. Please click PayPal again.",
      wirdGeprueft: "PayPal is still reviewing your payment. You will get an email as soon as it is confirmed – please do not pay again.",
      botCheck: "The security check failed. Please reload the page and try again.",
      zuSchnell: "Too many attempts in a short time. Please wait a minute.",
      nurDe: "For now we only deliver within Germany.",
      fehler: "Something went wrong. Please try again in a moment or write to us.",
      abschliessen: "Completing payment …", abgebrochen: "Payment cancelled – nothing was charged.",
      danke: "Thank you for your order!", bestellnr: "Order number:",
      dankeText: "The order confirmation is on its way to the email address you entered. PayPal has reserved the amount – it is only charged when we ship (at the latest after three days), and then the invoice follows. We pack your pieces by hand and usually ship within 2 working days.",
      dankeTextEingezogen: "The confirmation and invoice will be sent to the email address you entered. We pack your pieces by hand and usually ship within 2 working days.",
      konto: "View order in your account", weiter: "Keep browsing",
      mailAdresse: "Delivery address", mailVersand: "Shipping", mailGesamt: "Total", mailGruss: "Hello! I would like to order these pieces:",
      mailFrage: "Please confirm availability and payment. Thank you!"
    },
    fr: {
      titel: "Commande", zurueck: "Panier", stuecke: "Tes pièces", adresse: "Adresse de livraison", versand: "Livraison",
      uebersicht: "Récapitulatif", email: "Adresse e-mail pour la commande et la facture", kontoAnlegen: "Créer un compte client gratuit (facultatif). Un lien de connexion sera envoyé après le paiement.",
      fehltEmail: "Saisis une adresse e-mail valide.", appleCoupon: "Pour utiliser un bon, choisis PayPal ; la réduction est vérifiée avant le paiement.",
      vorname: "Prénom", nachname: "Nom", plz: "Code postal", ort: "Ville", strasse: "Rue",
      hausnummer: "N°", zusatz: "Complément d'adresse (facultatif)",
      landHinweis: "Nous livrons en Allemagne. La livraison en Packstation DHL arrive bientôt.",
      agb: "CGV & rétractation", datenschutz: "Confidentialité", impressum: "Mentions légales", widerruf: "Se rétracter du contrat ici",
      laedt: "Chargement …", leer: "Ton panier est vide.", zumArchiv: "Vers l'archive",
      nichtMehr: "Plus disponible – non inclus :", groesse: "Taille", paket: "colis",
      paketS: "petit", paketM: "moyen", paketL: "grand", tag1: "1 jour ouvré", tageN: "{n} jours ouvrés",
      versandLaedt: "Calcul de la livraison …", versandFehlt: "Le prix de livraison n'est pas disponible pour le moment. Recharge la page dans un instant.",
      versandWahlFehlt: "Le transporteur choisi n'est plus disponible. Choisis un autre mode de livraison.",
      zwischensumme: "Pièces", versandZeile: "Livraison", gesamt: "Total",
      gutschein: "Le bon {code} est déduit au paiement.",
      recht: "Micro-entreprise selon le § 19 UStG, pas de TVA. Expédition en général sous 2 jours ouvrés. Avec le bouton PayPal et ta confirmation chez PayPal, tu passes une commande ferme. PayPal réserve le montant – il n'est débité qu'à l'expédition, au plus tard trois jours après la commande.",
      rechtAnfrage: "Micro-entreprise selon le § 19 UStG, pas de TVA. La demande est sans engagement – nous confirmons disponibilité et total par e-mail.",
      agbLink: "CGV et rétractation", dsLink: "Confidentialité",
      paypalBald: "Le paiement PayPal arrive bientôt. En attendant, envoie-nous ta commande par e-mail – avec adresse et livraison, nous la confirmons.",
      anfrage: "Envoyer la commande par e-mail", betreff: "Commande Disorder119",
      fehltVorname: "Indique ton prénom.", fehltNachname: "Indique ton nom.",
      fehltPlz: "Indique un code postal à cinq chiffres.", fehltOrt: "Indique la ville.", fehltStrasse: "Indique la rue.",
      fehltNummer: "Indique le numéro.", packstation: "Nous ne livrons pas encore en Packstation ni en bureau de poste – bientôt avec DHL.",
      plzUnbekannt: "Nous ne connaissons pas ce code postal – vérifie-le.", ortWaehlen: "Choisis ta ville :",
      pruefen: "Vérifie les champs signalés.", schonWeg: "Une pièce vient d'être réservée ou vendue. Nous avons mis la liste à jour.",
      versandGeaendert: "Le prix de livraison vient de changer. Vérifie le récapitulatif et clique à nouveau sur PayPal.",
      abgelaufen: "La réservation a expiré, rien n'a été débité. Clique à nouveau sur PayPal.",
      wirdGeprueft: "PayPal vérifie encore ton paiement. Tu recevras un e-mail dès qu'il sera confirmé – merci de ne pas payer une seconde fois.",
      botCheck: "La vérification de sécurité a échoué. Recharge la page et réessaie.",
      zuSchnell: "Trop de tentatives en peu de temps. Attends une minute.",
      nurDe: "Pour l'instant, nous ne livrons qu'en Allemagne.",
      fehler: "Une erreur s'est produite. Réessaie dans un instant ou écris-nous.",
      abschliessen: "Finalisation du paiement …", abgebrochen: "Paiement annulé – rien n'a été débité.",
      danke: "Merci pour ta commande !", bestellnr: "Numéro de commande :",
      dankeText: "La confirmation de commande arrive à l'adresse e-mail indiquée. PayPal a réservé le montant – il n'est débité qu'à l'expédition (au plus tard après trois jours), et la facture suit alors. Nous emballons tes pièces à la main et expédions en général sous 2 jours ouvrés.",
      dankeTextEingezogen: "La confirmation et la facture seront envoyées à l'adresse e-mail indiquée. Nous emballons tes pièces à la main et expédions en général sous 2 jours ouvrés.",
      konto: "Voir la commande dans ton compte", weiter: "Continuer",
      mailAdresse: "Adresse de livraison", mailVersand: "Livraison", mailGesamt: "Total", mailGruss: "Bonjour ! Je souhaite commander ces pièces :",
      mailFrage: "Merci de me confirmer disponibilité et paiement !"
    }
  };
  function t(k) { var s = TEXTE[LANG] || TEXTE.de; return s[k] != null ? s[k] : TEXTE.de[k]; }
  function tf(k, werte) { return t(k).replace(/\{(\w+)\}/g, function (_, n) { return werte[n] != null ? werte[n] : ""; }); }

  function geld(cents) {
    var wert = (Number(cents) || 0) / 100;
    if (LANG === "en") return "€" + wert.toFixed(2);
    return wert.toFixed(2).replace(".", ",") + " €";
  }
  function el(tag, klasse, text) {
    var e = document.createElement(tag);
    if (klasse) e.className = klasse;
    if (text != null) e.textContent = text;
    return e;
  }
  function $(id) { return document.getElementById(id); }

  var meldung = $("kasseMeldung");
  var status = $("kasseStatus");
  function melden(text, ziel) {
    var z = ziel || meldung;
    z.textContent = text || "";
    z.hidden = !text;
    if (text && z === meldung) z.focus();
  }

  // ---- Texte der Vorlage in der richtigen Sprache
  Array.prototype.forEach.call(document.querySelectorAll("[data-t]"), function (e) { e.textContent = t(e.getAttribute("data-t")); });
  $("kasseTitel").textContent = t("titel");
  $("kasseZurueck").textContent = "← " + t("zurueck");

  var zustand = { stuecke: [], weg: [], versand: null, wahl: null, laeuft: false, versuch: null, orte: [] };

  // ---- Welche Stuecke? ?artikel=<ID> (Produktseite) oder der Warenkorb
  function gewuenschteIds() {
    var param = new URLSearchParams(location.search).get("artikel");
    if (param && /^\d{1,9}$/.test(param)) return [Number(param)];
    try {
      var liste = JSON.parse(localStorage.getItem(CART_KEY) || "[]");
      return (Array.isArray(liste) ? liste : []).map(Number).filter(function (n) { return n > 0; }).slice(0, 10);
    } catch (e) { return []; }
  }
  function vorschau(it) {
    var pfad = it.grid_image || (it.gallery && it.gallery[0]) || "";
    if (!pfad) return "";
    pfad = String(pfad).replace(/^\/+/, "");
    if (!it.grid_image) {
      var i = pfad.lastIndexOf("/");
      pfad = pfad.slice(0, i) + "/thumbs/" + pfad.slice(i + 1);
    }
    return "/" + pfad;
  }

  function artikelLaden() {
    var ids = gewuenschteIds();
    if (!ids.length) { leer(); return Promise.resolve(); }
    return fetch("/data/catalog.json", { cache: "no-cache" })
      .then(function (r) { return r.json(); })
      .then(function (katalog) {
        var nachId = {};
        katalog.forEach(function (it) { nachId[it.id] = it; });
        zustand.stuecke = []; zustand.weg = [];
        ids.forEach(function (id) {
          var it = nachId[id];
          if (it && it.public_status === "AVAILABLE" && it.price > 0) zustand.stuecke.push(it);
          else if (it) zustand.weg.push(it);
        });
        artikelZeichnen();
        if (!zustand.stuecke.length) { leer(); return; }
        versandLaden();
      })
      .catch(function () { melden(t("fehler")); });
  }

  function leer() {
    $("kasseRaster").hidden = true;
    if (document.querySelector(".kasse-leer")) return;
    var box = el("div", "kasse-leer");
    box.appendChild(el("p", "", t("leer")));
    var link = el("a", "kasse-knopf kasse-knopf--hell", t("zumArchiv"));
    link.href = HOME;
    box.appendChild(link);
    $("kasseRaster").parentNode.insertBefore(box, $("kasseRaster"));
  }

  function artikelZeichnen() {
    var liste = $("kasseArtikel");
    liste.textContent = "";
    liste.setAttribute("aria-busy", "false");
    zustand.stuecke.forEach(function (it) {
      var li = el("li", "kasse-stueck");
      var bild = el("span", "kasse-stueck__bild");
      // Helle Ansicht: gemessener Aufhell-Faktor des Fotos (build_site.py).
      if (Number(it.foto_hell) > 0) bild.style.setProperty("--d119-hell", String(Number(it.foto_hell)));
      var src = vorschau(it);
      if (src) {
        var img = document.createElement("img");
        img.src = src; img.alt = ""; img.loading = "lazy"; img.decoding = "async";
        bild.appendChild(img);
      }
      var text = el("span", "kasse-stueck__text");
      if (it.brand) text.appendChild(el("span", "kasse-stueck__marke", it.brand));
      text.appendChild(el("span", "kasse-stueck__titel", it.title || ""));
      if (it.size) text.appendChild(el("span", "kasse-stueck__meta", t("groesse") + " " + it.size));
      li.appendChild(bild);
      li.appendChild(text);
      li.appendChild(el("span", "kasse-stueck__preis", geld(Math.round(it.price * 100))));
      liste.appendChild(li);
    });
    if (zustand.weg.length) {
      var hinweis = el("li", "kasse-weg", t("nichtMehr") + " " + zustand.weg.map(function (it) { return it.title; }).join(", "));
      liste.appendChild(hinweis);
    }
    summeZeichnen();
  }

  // ---- Versand: Standard (und Express, wenn angeboten) mit Live-Preis
  function versandLaden() {
    var box = $("kasseVersand");
    box.textContent = t("versandLaedt");
    box.setAttribute("aria-busy", "true");
    if (!WORKER) { zustand.versand = null; versandZeichnen(); return Promise.resolve(); }
    var ids = zustand.stuecke.map(function (it) { return it.id; }).join(",");
    return fetch(WORKER + "/versand/optionen?artikel=" + encodeURIComponent(ids))
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; })
      .then(function (daten) { versandSetzen(daten); });
  }
  function versandSetzen(daten) {
    var gueltig = daten && daten.optionen && daten.optionen.length ? daten : null;
    var vorher = zustand.wahl;
    zustand.versand = gueltig;
    zustand.wahl = !gueltig ? null : !vorher ? gueltig.optionen[0] :
      gueltig.optionen.filter(function (o) { return o.id === vorher.id; })[0] ||
      gueltig.optionen.filter(function (o) { return o.carrier && o.carrier === vorher.carrier && o.art === vorher.art; })[0] || null;
    versandZeichnen();
  }
  function tage(o) { return !o || !o.tage ? "" : (o.tage === 1 ? t("tag1") : tf("tageN", { n: o.tage })); }
  function paketName(d) { return d ? t("paket") + " " + (t("paket" + d.paket) || d.paketName) : ""; }

  function versandZeichnen() {
    var box = $("kasseVersand");
    box.textContent = "";
    box.setAttribute("aria-busy", "false");
    var d = zustand.versand;
    if (!d) { box.appendChild(el("p", "kasse-hinweis", t("versandFehlt"))); summeZeichnen(); return; }
    var gruppe = el("div", "kasse-optionen");
    gruppe.setAttribute("role", "radiogroup");
    gruppe.setAttribute("aria-label", t("versand"));
    var gesperrt = zustand.versuch && zustand.versuch.ablauf > Date.now();
    d.optionen.forEach(function (o) {
      var label = el("label", "kasse-option");
      var radio = document.createElement("input");
      radio.type = "radio"; radio.name = "kasseVersand"; radio.value = o.id;
      radio.checked = !!zustand.wahl && zustand.wahl.id === o.id;
      radio.disabled = !!gesperrt;
      radio.addEventListener("change", function () { zustand.wahl = o; versandZeichnen(); });
      var name = el("span", "kasse-option__name", o.titel);
      var meta = [o.carrier, tage(o)].filter(Boolean).join(" · ");
      if (meta) name.appendChild(el("small", "", meta));
      label.appendChild(radio);
      label.appendChild(name);
      label.appendChild(el("span", "kasse-option__preis", geld(o.preisCents)));
      gruppe.appendChild(label);
    });
    box.appendChild(gruppe);
    if (!zustand.wahl) box.appendChild(el("p", "kasse-hinweis", t("versandWahlFehlt")));
    box.appendChild(el("p", "kasse-hinweis", paketName(d)));
    summeZeichnen();
  }

  // ---- Uebersicht
  function stueckeCents() {
    return zustand.stuecke.reduce(function (s, it) { return s + Math.round(it.price * 100); }, 0);
  }
  function summeZeichnen() {
    var liste = $("kasseSumme");
    liste.textContent = "";
    function zeile(a, b, klasse) {
      var reihe = el("div", klasse || "");
      reihe.appendChild(el("dt", "", a));
      reihe.appendChild(el("dd", "", b));
      liste.appendChild(reihe);
    }
    var ware = stueckeCents();
    zeile(t("zwischensumme") + " (" + zustand.stuecke.length + ")", geld(ware));
    zeile(t("versandZeile") + (zustand.wahl ? " · " + [zustand.wahl.carrier, zustand.wahl.titel].filter(Boolean).join(" ") : ""), zustand.wahl ? geld(zustand.wahl.preisCents) : "…");
    zeile(t("gesamt"), zustand.wahl ? geld(ware + zustand.wahl.preisCents) : "…", "kasse-summe__gesamt");
    var code = "";
    try { code = String(localStorage.getItem(CODE_KEY) || "").trim().toUpperCase(); } catch (e) { code = ""; }
    var gs = $("kasseGutschein");
    gs.hidden = !(code && PAYPAL_BEREIT);
    if (code && PAYPAL_BEREIT) gs.textContent = tf("gutschein", { code: code });
  }
  function rechtZeichnen() {
    var p = $("kasseRecht");
    p.textContent = (PAYPAL_BEREIT ? t("recht") : t("rechtAnfrage")) + " ";
    var agb = el("a", "", t("agbLink")); agb.href = HOME + "agb/";
    var ds = el("a", "", t("dsLink")); ds.href = HOME + "datenschutz/";
    p.appendChild(agb); p.appendChild(document.createTextNode(" · ")); p.appendChild(ds);
  }

  // ---- Lieferadresse: Ort zur PLZ, Strassen zum Anfang
  var f = { email: $("kEmail"), vorname: $("kVorname"), nachname: $("kNachname"), plz: $("kPlz"), ort: $("kOrt"), strasse: $("kStrasse"), nummer: $("kNummer"), zusatz: $("kZusatz") };
  var orteBox = $("kOrte");
  var vorschlagListe = $("kStrassen");
  var ortAutomatisch = "";

  function adressdienst(query) {
    if (!WORKER) return Promise.resolve(null);
    return fetch(WORKER + "/adresse/vorschlag?" + query)
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }
  function feldFehler(feld, text) {
    var huelle = feld.closest(".kasse-feld");
    if (!huelle) return;
    var alt = huelle.querySelector(".kasse-fehler");
    if (alt) alt.remove();
    feld.removeAttribute("aria-invalid");
    if (text) {
      feld.setAttribute("aria-invalid", "true");
      var p = el("p", "kasse-fehler", text);
      p.id = feld.id + "Fehler";
      feld.setAttribute("aria-describedby", p.id);
      huelle.appendChild(p);
    }
  }

  var plzAnfrage = 0;
  f.plz.addEventListener("input", function () {
    f.plz.value = f.plz.value.replace(/\D/g, "").slice(0, 5);
    orteBox.hidden = true;
    feldFehler(f.plz, "");
    if (f.plz.value.length !== 5) return;
    var nr = ++plzAnfrage;
    adressdienst("plz=" + f.plz.value).then(function (daten) {
      if (nr !== plzAnfrage || !daten || !Array.isArray(daten.orte)) return;
      zustand.orte = daten.orte;
      if (!daten.orte.length) { feldFehler(f.plz, t("plzUnbekannt")); return; }
      if (daten.orte.length === 1) {
        if (!f.ort.value || f.ort.value === ortAutomatisch) { f.ort.value = daten.orte[0]; ortAutomatisch = daten.orte[0]; feldFehler(f.ort, ""); }
        return;
      }
      orteBox.textContent = "";
      orteBox.appendChild(el("span", "kasse-orte__titel", t("ortWaehlen")));
      daten.orte.slice(0, 8).forEach(function (name) {
        var b = el("button", "kasse-chip", name);
        b.type = "button";
        b.addEventListener("click", function () { f.ort.value = name; ortAutomatisch = name; orteBox.hidden = true; feldFehler(f.ort, ""); f.strasse.focus(); });
        orteBox.appendChild(b);
      });
      orteBox.hidden = false;
    });
  });

  var strassenUhr = 0, strassenAnfrage = 0, aktiv = -1;
  function vorschlaegeSchliessen() {
    vorschlagListe.hidden = true;
    vorschlagListe.textContent = "";
    f.strasse.setAttribute("aria-expanded", "false");
    f.strasse.removeAttribute("aria-activedescendant");
    aktiv = -1;
  }
  function vorschlagWaehlen(name) {
    f.strasse.value = name;
    vorschlaegeSchliessen();
    feldFehler(f.strasse, "");
    f.nummer.focus();
  }
  function vorschlaegeZeigen(namen) {
    vorschlagListe.textContent = "";
    aktiv = -1;
    if (!namen.length || document.activeElement !== f.strasse) { vorschlaegeSchliessen(); return; }
    namen.forEach(function (name, i) {
      var li = el("li", "kasse-vorschlag", name);
      li.id = "kStrasse" + i;
      li.setAttribute("role", "option");
      li.addEventListener("mousedown", function (e) { e.preventDefault(); vorschlagWaehlen(name); });
      vorschlagListe.appendChild(li);
    });
    vorschlagListe.hidden = false;
    f.strasse.setAttribute("aria-expanded", "true");
  }
  function aktivSetzen(i) {
    var eintraege = vorschlagListe.children;
    if (!eintraege.length) return;
    aktiv = (i + eintraege.length) % eintraege.length;
    Array.prototype.forEach.call(eintraege, function (li, k) { li.setAttribute("aria-selected", String(k === aktiv)); });
    f.strasse.setAttribute("aria-activedescendant", eintraege[aktiv].id);
  }
  f.strasse.addEventListener("input", function () {
    clearTimeout(strassenUhr);
    var anfang = f.strasse.value.trim();
    if (anfang.length < 2 || !/^\d{5}$/.test(f.plz.value)) { vorschlaegeSchliessen(); return; }
    strassenUhr = setTimeout(function () {
      var nr = ++strassenAnfrage;
      adressdienst("plz=" + f.plz.value + "&strasse=" + encodeURIComponent(anfang)).then(function (daten) {
        if (nr !== strassenAnfrage || !daten || !Array.isArray(daten.strassen)) return;
        var passend = daten.strassen.filter(function (n) { return n.toLowerCase() !== f.strasse.value.trim().toLowerCase(); });
        vorschlaegeZeigen(passend);
      });
    }, 220);
  });
  f.strasse.addEventListener("keydown", function (e) {
    if (vorschlagListe.hidden) return;
    if (e.key === "ArrowDown") { e.preventDefault(); aktivSetzen(aktiv + 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); aktivSetzen(aktiv - 1); }
    else if (e.key === "Enter" && aktiv >= 0) { e.preventDefault(); vorschlagWaehlen(vorschlagListe.children[aktiv].textContent); }
    else if (e.key === "Escape") { vorschlaegeSchliessen(); }
  });
  f.strasse.addEventListener("blur", function () { setTimeout(vorschlaegeSchliessen, 120); });
  // "Musterstraße 12" in einem Feld: die Nummer wandert ins Nummernfeld.
  f.strasse.addEventListener("change", function () {
    var m = /^(.*\D)\s+(\d{1,5}\s?[a-zA-Z]?(?:\s?[-/]\s?\d{1,5}[a-zA-Z]?)?)$/.exec(f.strasse.value.trim());
    if (m && !f.nummer.value) { f.strasse.value = m[1].trim(); f.nummer.value = m[2].replace(/\s+/g, ""); }
  });
  Object.keys(f).forEach(function (k) { f[k].addEventListener("input", function () { if (k !== "plz") feldFehler(f[k], ""); }); });

  function adresse() {
    return {
      name: (f.vorname.value.trim() + " " + f.nachname.value.trim()).trim(),
      strasse: f.strasse.value.trim(),
      hausnummer: f.nummer.value.trim(),
      zusatz: f.zusatz.value.trim(),
      plz: f.plz.value.trim(),
      ort: f.ort.value.trim(),
      land: "DE"
    };
  }
  function pruefen() {
    var fehler = [];
    function pruef(feld, ok, text) { feldFehler(feld, ok ? "" : text); if (!ok) fehler.push(feld); }
    pruef(f.email, f.email.validity.valid && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(f.email.value.trim()), t("fehltEmail"));
    pruef(f.vorname, f.vorname.value.trim().length >= 1, t("fehltVorname"));
    pruef(f.nachname, f.nachname.value.trim().length >= 2, t("fehltNachname"));
    pruef(f.plz, /^\d{5}$/.test(f.plz.value), t("fehltPlz"));
    pruef(f.ort, f.ort.value.trim().length >= 2, t("fehltOrt"));
    var packstation = /packstation|postfiliale|postfach|paketshop/i.test(f.strasse.value + " " + f.zusatz.value);
    pruef(f.strasse, f.strasse.value.trim().length >= 2 && !packstation, packstation ? t("packstation") : t("fehltStrasse"));
    pruef(f.nummer, /^\d{1,5}\s?[a-zA-Z]?(?:\s?[-/]\s?\d{1,5}[a-zA-Z]?)?$/.test(f.nummer.value.trim()), t("fehltNummer"));
    if (fehler.length) { melden(t("pruefen"), status); fehler[0].focus(); return false; }
    melden("", status);
    return true;
  }

  // ---- Bezahlen: PayPal oder, solange PayPal fehlt, Bestellung per E-Mail
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
  function antwortLesen(r) {
    return r.json().catch(function () { return {}; }).then(function (daten) {
      if (!r.ok) {
        var e = new Error(daten.error || "HTTP_" + r.status);
        e.code = daten.error || ""; e.status = r.status; e.daten = daten;
        throw e;
      }
      return daten;
    });
  }
  function fehlerText(e) {
    var code = (e && (e.code || e.message)) || "";
    if (code === "RESERVATION_EXPIRED") return t("abgelaufen");
    if (code === "PAYMENT_CONFIRMATION_PENDING") return t("wirdGeprueft");
    if (/^VERSAND_/.test(code)) return t("versandGeaendert");
    if (code === "PACKSTATION_NICHT_MOEGLICH") return t("packstation");
    if (code === "NUR_DEUTSCHLAND") return t("nurDe");
    if (code === "ADRESSE_UNVOLLSTAENDIG") return t("pruefen");
    if (code === "EMAIL_REQUIRED") return t("fehltEmail");
    if (/^TURNSTILE_|^schutz_/.test(code)) return t("botCheck");
    if (code === "RATE_LIMITED") return t("zuSchnell");
    if (code === "ITEM_UNAVAILABLE" || code === "ITEM_NOT_FOUND" || code === "PRICE_ON_REQUEST") return t("schonWeg");
    return t("fehler");
  }
  function sperren(bis) {
    if (zustand.versuch) zustand.versuch.ablauf = bis;
    versandZeichnen();
    Array.prototype.forEach.call($("kasseForm").elements, function (feld) { feld.readOnly = bis > Date.now(); });
    $("kKonto").disabled = bis > Date.now();
    if (bis > Date.now()) setTimeout(function () { sperren(0); }, Math.min(bis - Date.now() + 500, 2147483000));
  }

  // zahlung: "RESERVIERT" (heute: PayPal reserviert, Abbuchung beim Versand)
  // oder "EINGEZOGEN" (Bestellung aus der Zeit vor der Umstellung).
  function danke(bestellNr, ids, zahlung) {
    try {
      var liste = JSON.parse(localStorage.getItem(CART_KEY) || "[]");
      localStorage.setItem(CART_KEY, JSON.stringify((Array.isArray(liste) ? liste : []).filter(function (id) { return ids.indexOf(Number(id)) < 0; })));
    } catch (e) { /* Warenkorb bleibt, der Server kennt die Stuecke als verkauft */ }
    $("kasseRaster").hidden = true;
    var box = el("div", "kasse-danke");
    box.setAttribute("tabindex", "-1");
    box.appendChild(el("h2", "", t("danke")));
    if (bestellNr) {
      var p = el("p", "", t("bestellnr") + " ");
      p.appendChild(el("strong", "", bestellNr));
      box.appendChild(p);
    }
    box.appendChild(el("p", "", t(zahlung === "EINGEZOGEN" ? "dankeTextEingezogen" : "dankeText")));
    var knoepfe = el("div", "kasse-danke__knoepfe");
    var konto = el("a", "kasse-knopf kasse-knopf--hell", t("konto")); konto.href = HOME + "konto/";
    var weiter = el("a", "kasse-knopf", t("weiter")); weiter.href = HOME;
    knoepfe.appendChild(konto); knoepfe.appendChild(weiter);
    box.appendChild(knoepfe);
    $("kasseRaster").parentNode.insertBefore(box, $("kasseRaster"));
    box.focus();
  }

  function paypalEinrichten() {
    var ziel = $("kasseZahlen");
    ziel.textContent = "";
    var knopf = el("div", "kasse-paypal");
    knopf.id = "kassePaypal";
    ziel.appendChild(knopf);
    var schutz = schutzLaden();
    schutz.then(function (S) { S.waechter(); }).catch(function () { /* meldet sich beim Klick */ });
    var bezahlSchluessel = {};
    var letzterFehler = "";

    var zahlung = {
      style: { shape: "rect", color: "black", layout: "vertical", label: "pay" },
      onClick: function (daten, actions) {
        if (!zustand.stuecke.length || !zustand.wahl) { melden(t(zustand.versand ? "versandWahlFehlt" : "versandFehlt"), status); return actions.reject(); }
        return pruefen() ? actions.resolve() : actions.reject();
      },
      createOrder: function () {
        letzterFehler = "";
        melden("", status);
        var wahl = zustand.wahl;
        var ids = zustand.stuecke.map(function (it) { return it.id; });
        var inhalt = { itemIds: ids, adresse: adresse(), email: f.email.value.trim(), createAccount: $("kKonto").checked,
          versand: wahl.id, versandPreisCents: wahl.preisCents };
        var fingerabdruck = JSON.stringify(inhalt);
        return schutz.then(function (S) {
          // Neuer Schluessel, sobald sich der Inhalt aendert - derselbe
          // Schluessel mit anderem Inhalt waere eine andere Bestellung.
          if (!zustand.versuch || zustand.versuch.inhalt !== fingerabdruck ||
              (zustand.versuch.ablauf && Date.now() > zustand.versuch.ablauf - 60000)) {
            zustand.versuch = { schluessel: S.schluessel("create-order"), inhalt: fingerabdruck, ablauf: 0, bestellNr: "" };
          }
          return S.waechter().token();
        }).then(function (token) {
          var kopf = { "Content-Type": "application/json", "Idempotency-Key": zustand.versuch.schluessel };
          if (token) kopf["X-Turnstile-Token"] = token;
          return fetch(WORKER + "/create-order", { method: "POST", headers: kopf, body: JSON.stringify(inhalt) });
        }).then(antwortLesen).then(function (daten) {
          zustand.versuch.bestellNr = daten.orderNumber || "";
          sperren(Date.parse(daten.expiresAt) || 0);
          return daten.id;
        }).catch(function (e) {
          var code = (e && e.code) || "";
          if (!zustand.versuch || !zustand.versuch.ablauf) zustand.versuch = null;
          if (/^VERSAND_/.test(code) && e.daten && e.daten.versand) versandSetzen(e.daten.versand);
          if (code === "ITEM_UNAVAILABLE" || code === "ITEM_NOT_FOUND") artikelLaden();
          letzterFehler = fehlerText(e);
          throw e;
        });
      },
      onApprove: function (daten) {
        melden(t("abschliessen"), status);
        return schutz.then(function (S) {
          var schluessel = bezahlSchluessel[daten.orderID] || (bezahlSchluessel[daten.orderID] = S.schluessel("capture-order"));
          return fetch(WORKER + "/capture-order", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Idempotency-Key": schluessel },
            body: JSON.stringify({ orderId: daten.orderID })
          });
        }).then(antwortLesen).then(function (antwort) {
          melden("", status);
          danke(antwort.orderNumber || (zustand.versuch && zustand.versuch.bestellNr) || "", zustand.stuecke.map(function (it) { return Number(it.id); }), antwort.zahlung);
          zustand.versuch = null;
        }).catch(function (e) {
          if ((e && e.code) === "RESERVATION_EXPIRED") { zustand.versuch = null; sperren(0); }
          letzterFehler = fehlerText(e);
          throw e;
        });
      },
      onCancel: function () { melden(t("abgebrochen"), status); },
      onError: function () { melden(letzterFehler || t("fehler"), status); }
    };
    window.paypal.Buttons(zahlung).render("#kassePaypal");
    appleEinrichten(ziel, zahlung);
  }

  function appleEinrichten(ziel, zahlung) {
    // Ein Gutschein wird erst serverseitig beim Anlegen der PayPal-Bestellung
    // bewertet. Apple Pay darf davor keinen hoeheren Endbetrag anzeigen.
    try {
      if (localStorage.getItem(CODE_KEY)) {
        ziel.appendChild(el("p", "kasse-hinweis kasse-apple-coupon", t("appleCoupon")));
        return;
      }
    } catch (e) { /* ohne Gutschein fortfahren */ }
    if (!window.paypal || typeof window.paypal.Applepay !== "function" ||
        !window.ApplePaySession || !window.ApplePaySession.canMakePayments()) return;
    var apple = window.paypal.Applepay();
    apple.config().then(function (cfg) {
      if (!cfg.isEligible) return;
      var host = el("div", "kasse-applepay");
      var button = document.createElement("apple-pay-button");
      button.setAttribute("buttonstyle", "black");
      button.setAttribute("type", "buy");
      button.setAttribute("locale", LANG === "de" ? "de-DE" : LANG === "fr" ? "fr-FR" : "en-US");
      host.appendChild(button);
      ziel.insertBefore(host, ziel.firstChild);
      button.addEventListener("click", function () {
        if (!zustand.stuecke.length || !zustand.wahl || !pruefen()) return;
        var total = (stueckeCents() + zustand.wahl.preisCents) / 100;
        var session;
        try {
          session = new window.ApplePaySession(4, {
            countryCode: cfg.countryCode,
            merchantCapabilities: cfg.merchantCapabilities,
            supportedNetworks: cfg.supportedNetworks,
            currencyCode: "EUR",
            requiredBillingContactFields: ["postalAddress"],
            total: { label: "DISORDER119", type: "final", amount: total.toFixed(2) }
          });
        } catch (e) { melden(t("fehler"), status); return; }
        session.onvalidatemerchant = function (event) {
          apple.validateMerchant({ validationUrl: event.validationURL, displayName: "DISORDER119" })
            .then(function (result) { session.completeMerchantValidation(result.merchantSession); })
            .catch(function () { session.abort(); melden(t("fehler"), status); });
        };
        session.onpaymentauthorized = function (event) {
          zahlung.createOrder().then(function (orderId) {
            return apple.confirmOrder({ orderId: orderId, token: event.payment.token,
              billingContact: event.payment.billingContact }).then(function () { return orderId; });
          }).then(function (orderId) {
            return zahlung.onApprove({ orderID: orderId });
          }).then(function () {
            session.completePayment(window.ApplePaySession.STATUS_SUCCESS);
          }).catch(function (err) {
            session.completePayment(window.ApplePaySession.STATUS_FAILURE);
            melden(fehlerText(err), status);
          });
        };
        session.begin();
      });
    }).catch(function () { /* Nicht berechtigter Haendler oder Geraet: PayPal bleibt verfuegbar. */ });
  }

  function anfrageEinrichten() {
    var ziel = $("kasseZahlen");
    ziel.textContent = "";
    ziel.appendChild(el("p", "kasse-hinweis", t("paypalBald")));
    if (!CFG.email) return;
    var knopf = el("button", "kasse-knopf kasse-knopf--hell kasse-knopf--breit", t("anfrage"));
    knopf.type = "button";
    knopf.addEventListener("click", function () {
      if (!zustand.stuecke.length || !pruefen()) return;
      var a = adresse();
      var zeilen = [t("mailGruss"), ""];
      zustand.stuecke.forEach(function (it) {
        zeilen.push("- " + (it.title || "") + (it.size ? " · " + t("groesse") + " " + it.size : "") + " · Art.-Nr. " + (it.article || it.id) + " · " + geld(Math.round(it.price * 100)));
      });
      zeilen.push("");
      if (zustand.wahl) zeilen.push(t("mailVersand") + ": " + zustand.wahl.titel + (zustand.wahl.carrier ? " (" + zustand.wahl.carrier + ")" : "") + ", " + paketName(zustand.versand) + " – " + geld(zustand.wahl.preisCents));
      zeilen.push(t("mailGesamt") + ": " + geld(stueckeCents() + (zustand.wahl ? zustand.wahl.preisCents : 0)));
      zeilen.push("", t("email") + ": " + f.email.value.trim(), t("mailAdresse") + ":", a.name, a.strasse + " " + a.hausnummer);
      if (a.zusatz) zeilen.push(a.zusatz);
      zeilen.push(a.plz + " " + a.ort, "Deutschland", "", t("mailFrage"));
      location.href = "mailto:" + CFG.email + "?subject=" + encodeURIComponent(t("betreff")) + "&body=" + encodeURIComponent(zeilen.join("\n"));
    });
    ziel.appendChild(knopf);
  }

  rechtZeichnen();
  artikelLaden().then(function () {
    if (!zustand.stuecke.length) return;
    if (PAYPAL_BEREIT && window.paypal && typeof window.paypal.Buttons === "function") paypalEinrichten();
    else anfrageEinrichten();
  });
})();

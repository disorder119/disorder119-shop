/* Newsletter-Anmeldung mit 10-%-Willkommenscode.

   Ein Skript fuer alle Stellen: Fusszeile, Produktseiten, Kontoseite und die
   Seite /newsletter/. Es sucht [data-d119-newsletter]-Platzhalter und baut
   dort das Formular ein; auf /newsletter/ loest es ausserdem die Links aus den
   Mails ein (?bestaetigen= und ?abmelden=).

   Die Einwilligung ist ein eigenes, nicht vorausgewaehltes Haekchen; erst der
   Klick in der Bestaetigungsmail macht daraus eine Anmeldung (Double-Opt-in).
   Der Wortlaut muss zum Einwilligungstext im Shop-Worker passen
   (shop-worker/newsletter.js, CONSENT_TEXT), dort wird er gespeichert.

   Den Code legt die Bestaetigungsseite gleich im Warenkorb ab - derselbe
   Speicherplatz, den shop-promos.js liest. Einloesbar ist er genau einmal,
   das prueft der Server. */
(function () {
  "use strict";

  if (window.__D119_NEWSLETTER__) return;
  window.__D119_NEWSLETTER__ = true;

  var CFG = window.SHOP_CONFIG || window.ARTICLE_SHOP_CONFIG || {};
  var API = String(CFG.shopWorkerUrl || "https://api.disorder119.com").replace(/\/+$/, "");
  var LANG = (function () {
    var l = String(document.documentElement.lang || "de").toLowerCase();
    return l.indexOf("en") === 0 ? "en" : l.indexOf("fr") === 0 ? "fr" : "de";
  })();
  var HOME = LANG === "de" ? "/" : "/" + LANG + "/";
  var CODE_KEY = "d119_coupon_code";
  var SELF = document.currentScript;

  var TEXTE = {
    de: {
      eyebrow: "Newsletter",
      titel: "10 % auf deine nächste Bestellung",
      intro: "Neue Stücke zuerst sehen – und als Dankeschön einen einmaligen 10-%-Code.",
      emailLabel: "E-Mail-Adresse",
      platzhalter: "name@beispiel.de",
      einwilligung: "Ja, ich möchte den DISORDER119-Newsletter mit neuen Stücken und Aktionen per E-Mail erhalten – einschließlich der Messung, ob die Mails geöffnet und Links angeklickt werden. Die Einwilligung kann ich jederzeit widerrufen, z. B. über den Abmeldelink in jeder Mail.",
      datenschutz: "Datenschutz",
      knopf: "Anmelden",
      sende: "Einen Moment …",
      gesendet: "Fast geschafft: Wir haben dir eine Mail geschickt. Klick auf den Link darin – dann bekommst du deinen Code.",
      fehlerEmail: "Bitte gib eine gültige E-Mail-Adresse ein.",
      fehlerHaken: "Bitte setz das Häkchen, damit wir dir den Newsletter schicken dürfen.",
      fehlerWegwerf: "Bitte nutze eine dauerhafte E-Mail-Adresse – Wegwerf-Adressen nehmen wir nicht an.",
      fehlerZuOft: "Zu viele Versuche. Bitte probier es in ein paar Minuten noch einmal.",
      fehler: "Das hat nicht geklappt. Bitte versuch es gleich noch einmal.",
      pruefe: "Deine Anmeldung wird bestätigt …",
      dabei: "Du bist dabei!",
      codeIntro: "Dein Code für 10 % auf deine nächste Bestellung:",
      codeHinweis: "Einmal einlösbar. Wir haben ihn schon in deinen Warenkorb eingetragen und dir zusätzlich per Mail geschickt.",
      kopieren: "Code kopieren",
      kopiert: "Kopiert",
      zumShop: "Zum Archiv",
      keinNeuerCode: "Deine Anmeldung ist bestätigt. Den Willkommensrabatt gibt es pro E-Mail-Adresse nur einmal – für diese Adresse wurde er schon vergeben.",
      begrenzt: "Deine Anmeldung ist bestätigt. Über diesen Internetanschluss wurden in letzter Zeit schon Willkommenscodes vergeben, deshalb gibt es diesmal keinen weiteren.",
      schonBestaetigt: "Deine Anmeldung war schon bestätigt. Deinen Code findest du in der Willkommensmail.",
      abgelaufen: "Dieser Link ist abgelaufen. Melde dich einfach unten noch einmal an – du bekommst sofort einen neuen.",
      ungueltig: "Dieser Link ist ungültig oder wurde schon benutzt.",
      melde: "Du wirst abgemeldet …",
      abgemeldet: "Du bist abgemeldet und bekommst keinen Newsletter mehr von uns.",
    },
    en: {
      eyebrow: "Newsletter",
      titel: "10% off your next order",
      intro: "See new pieces first – and get a one-time 10% code as a thank-you.",
      emailLabel: "Email address",
      platzhalter: "name@example.com",
      einwilligung: "Yes, I want to receive the DISORDER119 newsletter with new pieces and offers by email – including measurement of whether the emails are opened and links are clicked. I can withdraw my consent at any time, e.g. via the unsubscribe link in every email.",
      datenschutz: "Privacy policy",
      knopf: "Subscribe",
      sende: "One moment …",
      gesendet: "Almost there: we've sent you an email. Click the link in it – then you'll get your code.",
      fehlerEmail: "Please enter a valid email address.",
      fehlerHaken: "Please tick the box so we're allowed to send you the newsletter.",
      fehlerWegwerf: "Please use a permanent email address – we can't accept disposable ones.",
      fehlerZuOft: "Too many attempts. Please try again in a few minutes.",
      fehler: "That didn't work. Please try again in a moment.",
      pruefe: "Confirming your subscription …",
      dabei: "You're in!",
      codeIntro: "Your code for 10% off your next order:",
      codeHinweis: "Valid once. It's already in your cart, and we've emailed it to you as well.",
      kopieren: "Copy code",
      kopiert: "Copied",
      zumShop: "Back to the archive",
      keinNeuerCode: "Your subscription is confirmed. The welcome discount is limited to one per email address – this address already received it.",
      begrenzt: "Your subscription is confirmed. Welcome codes were recently issued via this internet connection, so there isn't another one this time.",
      schonBestaetigt: "Your subscription was already confirmed. You'll find your code in the welcome email.",
      abgelaufen: "This link has expired. Just sign up again below – you'll get a new one right away.",
      ungueltig: "This link is invalid or has already been used.",
      melde: "Unsubscribing …",
      abgemeldet: "You're unsubscribed and won't receive our newsletter any more.",
    },
    fr: {
      eyebrow: "Newsletter",
      titel: "10 % sur ta prochaine commande",
      intro: "Découvre les nouvelles pièces en premier – et reçois un code unique de 10 % en remerciement.",
      emailLabel: "Adresse e-mail",
      platzhalter: "nom@exemple.fr",
      einwilligung: "Oui, je souhaite recevoir la newsletter DISORDER119 avec les nouvelles pièces et offres par e-mail – y compris la mesure de l'ouverture des e-mails et des clics sur les liens. Je peux retirer mon consentement à tout moment, p. ex. via le lien de désinscription dans chaque e-mail.",
      datenschutz: "Confidentialité",
      knopf: "S'inscrire",
      sende: "Un instant …",
      gesendet: "Presque fini : nous t'avons envoyé un e-mail. Clique sur le lien – ensuite tu recevras ton code.",
      fehlerEmail: "Merci d'indiquer une adresse e-mail valide.",
      fehlerHaken: "Merci de cocher la case pour que nous puissions t'envoyer la newsletter.",
      fehlerWegwerf: "Merci d'utiliser une adresse e-mail permanente – les adresses jetables ne sont pas acceptées.",
      fehlerZuOft: "Trop de tentatives. Réessaie dans quelques minutes.",
      fehler: "Cela n'a pas fonctionné. Réessaie dans un instant.",
      pruefe: "Confirmation de ton inscription …",
      dabei: "C'est fait !",
      codeIntro: "Ton code de 10 % sur ta prochaine commande :",
      codeHinweis: "Valable une fois. Il est déjà dans ton panier, et nous te l'avons aussi envoyé par e-mail.",
      kopieren: "Copier le code",
      kopiert: "Copié",
      zumShop: "Retour à l'archive",
      keinNeuerCode: "Ton inscription est confirmée. La remise de bienvenue est limitée à une par adresse e-mail – cette adresse l'a déjà reçue.",
      begrenzt: "Ton inscription est confirmée. Des codes de bienvenue ont déjà été émis récemment via cette connexion internet, il n'y en a donc pas d'autre cette fois.",
      schonBestaetigt: "Ton inscription était déjà confirmée. Tu trouveras ton code dans l'e-mail de bienvenue.",
      abgelaufen: "Ce lien a expiré. Inscris-toi simplement à nouveau ci-dessous – tu en recevras un nouveau tout de suite.",
      ungueltig: "Ce lien est invalide ou a déjà été utilisé.",
      melde: "Désinscription en cours …",
      abgemeldet: "Tu es désinscrit·e et ne recevras plus notre newsletter.",
    },
  };
  var t = TEXTE[LANG];

  function el(tag, klasse, text) {
    var node = document.createElement(tag);
    if (klasse) node.className = klasse;
    if (text) node.textContent = text;
    return node;
  }

  function stilLaden() {
    var vorhanden = Array.prototype.some.call(document.querySelectorAll('link[rel="stylesheet"]'), function (l) {
      return /\/assets\/newsletter\.css/.test(l.getAttribute("href") || "");
    });
    if (vorhanden) return;
    var version = "";
    try { version = new URL((SELF && SELF.src) || "", location.href).searchParams.get("v") || ""; } catch (e) {}
    var link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "/assets/newsletter.css" + (version ? "?v=" + encodeURIComponent(version) : "");
    document.head.appendChild(link);
  }

  function senden(pfad, daten) {
    return fetch(API + pfad, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(daten),
      credentials: "omit",
      cache: "no-store",
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (body) {
        if (!res.ok) {
          var err = new Error(body && body.error || "HTTP " + res.status);
          err.code = body && body.error;
          err.status = res.status;
          throw err;
        }
        return body;
      });
    });
  }

  function meldung(ziel, art, text) {
    ziel.textContent = text;
    ziel.hidden = !text;
    ziel.className = "d119-nl__msg" + (art ? " d119-nl__msg--" + art : "");
  }

  // ------------------------------------------------------------------ Formular

  function formularBauen(platz) {
    var quelle = String(platz.getAttribute("data-quelle") || "website").replace(/[^a-z0-9_-]/gi, "").slice(0, 40);
    var form = el("form", "d119-nl__form");
    form.noValidate = true;

    var kopf = el("div", "d119-nl__head");
    kopf.appendChild(el("p", "d119-nl__eyebrow", t.eyebrow));
    kopf.appendChild(el("p", "d119-nl__title", t.titel));
    kopf.appendChild(el("p", "d119-nl__intro", t.intro));
    form.appendChild(kopf);

    var zeile = el("div", "d119-nl__row");
    var feld = el("label", "d119-nl__field");
    feld.appendChild(el("span", "d119-nl__label", t.emailLabel));
    var email = el("input", "d119-nl__input");
    email.type = "email";
    email.name = "email";
    email.autocomplete = "email";
    email.required = true;
    email.placeholder = t.platzhalter;
    email.setAttribute("inputmode", "email");
    feld.appendChild(email);
    zeile.appendChild(feld);
    var knopf = el("button", "d119-nl__btn", t.knopf);
    knopf.type = "submit";
    zeile.appendChild(knopf);
    form.appendChild(zeile);

    var haken = el("label", "d119-nl__consent");
    var box = el("input");
    box.type = "checkbox";
    box.name = "consent";
    box.required = true;
    haken.appendChild(box);
    var text = el("span", "", t.einwilligung + " ");
    var link = el("a", "", t.datenschutz);
    link.href = HOME + "datenschutz/";
    text.appendChild(link);
    haken.appendChild(text);
    form.appendChild(haken);

    var msg = el("p", "d119-nl__msg");
    msg.setAttribute("role", "status");
    msg.setAttribute("aria-live", "polite");
    msg.hidden = true;
    form.appendChild(msg);

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var adresse = String(email.value || "").trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(adresse)) {
        meldung(msg, "fehler", t.fehlerEmail);
        email.focus();
        return;
      }
      if (!box.checked) {
        meldung(msg, "fehler", t.fehlerHaken);
        box.focus();
        return;
      }
      knopf.disabled = true;
      meldung(msg, "", t.sende);
      senden("/newsletter/subscribe", { email: adresse, consent: true, lang: LANG, source: quelle })
        .then(function () {
          form.classList.add("d119-nl__form--fertig");
          meldung(msg, "ok", t.gesendet);
          email.value = "";
          box.checked = false;
        })
        .catch(function (err) {
          var text = err.code === "INVALID_EMAIL" ? t.fehlerEmail
            : err.code === "DISPOSABLE_EMAIL" ? t.fehlerWegwerf
            : err.code === "CONSENT_REQUIRED" ? t.fehlerHaken
            : err.status === 429 ? t.fehlerZuOft
            : t.fehler;
          meldung(msg, "fehler", text);
        })
        .then(function () { knopf.disabled = false; });
    });

    platz.textContent = "";
    platz.classList.add("d119-nl");
    platz.appendChild(form);
  }

  // ------------------------------------------------------------------ /newsletter/

  function codeSpeichern(code) {
    try { localStorage.setItem(CODE_KEY, code); } catch (e) {}
  }

  function codeZeigen(ziel, code) {
    var box = el("div", "d119-nl__code");
    box.appendChild(el("p", "d119-nl__code-intro", t.codeIntro));
    var wert = el("p", "d119-nl__code-wert", code);
    box.appendChild(wert);
    var knopf = el("button", "d119-nl__btn d119-nl__btn--schlicht", t.kopieren);
    knopf.type = "button";
    knopf.addEventListener("click", function () {
      var fertig = function () { knopf.textContent = t.kopiert; };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(code).then(fertig, function () {});
      } else {
        var bereich = document.createRange();
        bereich.selectNodeContents(wert);
        var auswahl = window.getSelection();
        auswahl.removeAllRanges();
        auswahl.addRange(bereich);
      }
    });
    box.appendChild(knopf);
    box.appendChild(el("p", "d119-nl__code-hinweis", t.codeHinweis));
    ziel.appendChild(box);
  }

  function statusSeite() {
    var ziel = document.getElementById("d119NewsletterStatus");
    if (!ziel) return;
    var params = new URLSearchParams(location.search);
    var bestaetigen = params.get("bestaetigen");
    var abmelden = params.get("abmelden");
    if (!bestaetigen && !abmelden) return;
    // Den Token nicht in der Adresszeile stehen lassen: kein Neu-Senden beim
    // Neuladen, und er landet in keinem Verlauf oder Referrer.
    try { history.replaceState(null, "", location.pathname); } catch (e) {}

    var titel = el("h2", "d119-nl__status-titel");
    var text = el("p", "d119-nl__status-text", bestaetigen ? t.pruefe : t.melde);
    text.setAttribute("role", "status");
    ziel.appendChild(titel);
    ziel.appendChild(text);
    ziel.hidden = false;
    // Hat der Link geklappt, braucht es das Anmeldeformular darunter nicht.
    var formular = document.querySelector("[data-d119-newsletter]");
    var formularWeg = function () { if (formular) formular.hidden = true; };

    if (abmelden) {
      senden("/newsletter/unsubscribe", { token: abmelden })
        .then(function () { text.textContent = t.abgemeldet; formularWeg(); })
        .catch(function (err) { text.textContent = err.status === 404 ? t.ungueltig : t.fehler; });
      return;
    }

    senden("/newsletter/confirm", { token: bestaetigen })
      .then(function (data) {
        formularWeg();
        titel.textContent = t.dabei;
        if (data.couponCode) {
          text.textContent = "";
          text.hidden = true;
          codeSpeichern(data.couponCode);
          codeZeigen(ziel, data.couponCode);
          var weiter = el("a", "d119-nl__btn", t.zumShop);
          weiter.href = HOME;
          ziel.appendChild(weiter);
        } else {
          text.textContent = data.alreadyConfirmed ? t.schonBestaetigt : data.couponLimited ? t.begrenzt : t.keinNeuerCode;
        }
      })
      .catch(function (err) {
        text.textContent = err.code === "NEWSLETTER_LINK_EXPIRED" ? t.abgelaufen
          : err.status === 404 ? t.ungueltig
          : t.fehler;
      });
  }

  function start() {
    var plaetze = document.querySelectorAll("[data-d119-newsletter]");
    if (!plaetze.length && !document.getElementById("d119NewsletterStatus")) return;
    stilLaden();
    Array.prototype.forEach.call(plaetze, formularBauen);
    statusSeite();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();

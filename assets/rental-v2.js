/* Disorder119 Rental V2
   Multi-item rental basket, automatic deposit calculation and clearer rental flow.
   Intentionally isolated from Match, Chaos and Baukasten. */
(function () {
  "use strict";

  var SHOP_CONFIG = window.SHOP_CONFIG || {};
  var LANG_MATCH = /^\/(en|fr)(?:\/|$)/.exec(window.location.pathname);
  var LANG = LANG_MATCH ? LANG_MATCH[1] : "de";
  var LOCALE = { de: "de-DE", en: "en-GB", fr: "fr-FR" }[LANG] || "de-DE";
  var HOME = LANG === "de" ? "/" : "/" + LANG + "/";
  var RENTAL_PATH = HOME + "mieten/";
  var STORAGE_KEY = "d119_rental_cart_v2";
  var RECEIPT_KEY = "d119_rental_terms_receipts";
  var TERMS_VERSION = "rental-2026-09-05-v2";
  var RENTAL_RATE_BPS = 1000;     // 10% of sale price per selected calendar day.
  var DEPOSIT_RATE_BPS = 5000;    // 50% of sale price.
  var DEPOSIT_MIN_CENTS = 5000;   // Minimum EUR 50 per item.
  var STANDARD_MAX_DAYS = 7;

  var TEXT = {
    de: {
      menu: "Mieten & Verleih",
      menuHint: "Designer-Pieces zeitweise ausleihen",
      add: "Zur Mietanfrage hinzufügen",
      added: "Hinzugefügt ✓",
      basket: "Mietanfrage",
      selected: "{count} Artikel ausgewählt",
      empty: "Noch keine Artikel ausgewählt.",
      emptyHint: "Wähle im Mietkatalog mehrere Stücke aus und stelle anschließend eine gemeinsame Anfrage.",
      continue: "Weitere Artikel auswählen",
      close: "Schließen",
      remove: "Entfernen",
      daily: "{price} / Tag",
      onRequest: "Preis auf Anfrage",
      deposit: "Kaution",
      depositAuto: "automatisch berechnet",
      depositRule: "50 % des Verkaufspreises, mindestens 50 € pro Artikel",
      period: "Mietzeitraum",
      start: "Von",
      end: "Bis",
      days: "{days} Miettag(e)",
      maxDays: "Standardmäßig sind bis zu 7 Miettage auswählbar. Für längere Zeiträume bitte im Nachrichtenfeld anfragen.",
      invalidDates: "Bitte wähle einen gültigen Zeitraum von maximal 7 Miettagen.",
      purpose: "Verwendungszweck",
      purposePrivate: "Privater Anlass",
      purposePhoto: "Fotoshooting",
      purposeVideo: "Musikvideo",
      purposeFilm: "Film / Theater / Bühne",
      purposeEditorial: "Editorial / Redaktion",
      purposeEvent: "Event / Ausstellung",
      purposeOther: "Sonstiges",
      delivery: "Übergabe",
      shipping: "Versand",
      pickup: "Abholung",
      postal: "PLZ / Ort (optional)",
      risk: "Besondere Nutzung (optional)",
      riskPh: "z. B. Outdoor, Wasser, Tiere, Make-up/Bodypaint, Bühne …",
      message: "Nachricht (optional)",
      messagePh: "Weitere Angaben zur Anfrage …",
      summary: "Zusammenfassung",
      rent: "Mietpreis",
      refundableDeposit: "Rückerstattbare Kaution",
      shippingCost: "Versand",
      shippingConfirm: "wird bestätigt",
      provisional: "Vorläufig fällig",
      partialRequest: "teilweise auf Anfrage",
      terms: "Ich habe die Mietbedingungen gelesen und akzeptiere sie.",
      termsOpen: "Mietbedingungen ansehen",
      noPayment: "Noch keine Zahlung. Die Anfrage wird erst nach ausdrücklicher Bestätigung durch Disorder119 verbindlich.",
      sendEmail: "Mietanfrage per E-Mail",
      sendWhatsapp: "Mietanfrage per WhatsApp",
      contactMissing: "Der Shop-Kontakt ist noch nicht vollständig eingerichtet.",
      availabilityChecking: "Verfügbarkeit wird geprüft …",
      availabilityOk: "Ausgewählter Zeitraum ist für die angefragten Artikel derzeit verfügbar.",
      availabilityProblem: "Mindestens ein Artikel ist für diesen Zeitraum nicht verfügbar. Bitte ändere den Zeitraum oder entferne den Artikel.",
      availabilityManual: "Die endgültige Verfügbarkeit wird von Disorder119 bestätigt.",
      buyWarning: "Bei mindestens einem Artikel erreicht die Miete den Verkaufspreis. Kaufen kann für diesen Zeitraum günstiger sein.",
      processTitle: "So läuft die Miete ab",
      process: ["Anfrage", "Bestätigung", "Zahlung", "Nutzung", "Rückgabe", "Kaution zurück"],
      trust: ["Normale Reinigung inklusive", "Zustand vor Versand dokumentiert", "Rückgabe nachverfolgbar", "Kaution nach Prüfung freigegeben"],
      addedToast: "Zur Mietanfrage hinzugefügt.",
      removedToast: "Aus der Mietanfrage entfernt.",
      subject: "Mietanfrage Disorder119 – mehrere Artikel",
      intro: "Hallo! Ich möchte folgende Artikel aus dem Disorder119-Archiv gemeinsam mieten:",
      totalLabel: "Gesamt",
      termsVersion: "Mietbedingungen",
      requestSent: "Anfrage vorbereitet. Die Artikel bleiben bis zur Bestätigung unverbindlich.",
      longPeriod: "Mehr als 7 Tage? Schreib den gewünschten Zeitraum einfach in die Nachricht; Disorder119 bestätigt Preis und Verfügbarkeit individuell."
    },
    en: {
      menu: "Rent & Borrow",
      menuHint: "Borrow designer pieces for a limited period",
      add: "Add to rental request",
      added: "Added ✓",
      basket: "Rental request",
      selected: "{count} item(s) selected",
      empty: "No items selected yet.",
      emptyHint: "Select several pieces in the rental catalogue and send one combined request afterwards.",
      continue: "Select more items",
      close: "Close",
      remove: "Remove",
      daily: "{price} / day",
      onRequest: "Price on request",
      deposit: "Deposit",
      depositAuto: "calculated automatically",
      depositRule: "50% of the sale price, minimum €50 per item",
      period: "Rental period",
      start: "From",
      end: "To",
      days: "{days} rental day(s)",
      maxDays: "Up to 7 rental days can be selected as standard. For longer periods, add the requested dates in the message.",
      invalidDates: "Please select a valid period of no more than 7 rental days.",
      purpose: "Purpose",
      purposePrivate: "Private occasion",
      purposePhoto: "Photo shoot",
      purposeVideo: "Music video",
      purposeFilm: "Film / theatre / stage",
      purposeEditorial: "Editorial",
      purposeEvent: "Event / exhibition",
      purposeOther: "Other",
      delivery: "Handover",
      shipping: "Shipping",
      pickup: "Pickup",
      postal: "Postcode / city (optional)",
      risk: "Special use (optional)",
      riskPh: "e.g. outdoors, water, animals, make-up/bodypaint, stage …",
      message: "Message (optional)",
      messagePh: "Further information about your request …",
      summary: "Summary",
      rent: "Rental price",
      refundableDeposit: "Refundable deposit",
      shippingCost: "Shipping",
      shippingConfirm: "to be confirmed",
      provisional: "Provisional amount",
      partialRequest: "partly on request",
      terms: "I have read and accept the rental terms.",
      termsOpen: "View rental terms",
      noPayment: "No payment is taken yet. The request only becomes binding after explicit confirmation by Disorder119.",
      sendEmail: "Send rental request by e-mail",
      sendWhatsapp: "Send rental request by WhatsApp",
      contactMissing: "The shop contact is not fully configured yet.",
      availabilityChecking: "Checking availability …",
      availabilityOk: "The selected period is currently available for the requested items.",
      availabilityProblem: "At least one item is unavailable for this period. Please change the dates or remove the item.",
      availabilityManual: "Final availability is confirmed by Disorder119.",
      buyWarning: "For at least one item, the rental total reaches the sale price. Buying may be cheaper for this period.",
      processTitle: "How the rental works",
      process: ["Request", "Confirmation", "Payment", "Use", "Return", "Deposit released"],
      trust: ["Normal cleaning included", "Condition documented before shipping", "Trackable return", "Deposit released after inspection"],
      addedToast: "Added to rental request.",
      removedToast: "Removed from rental request.",
      subject: "Disorder119 rental request – multiple items",
      intro: "Hello! I would like to rent the following Disorder119 archive pieces together:",
      totalLabel: "Total",
      termsVersion: "Rental terms",
      requestSent: "Request prepared. The items remain non-binding until confirmed.",
      longPeriod: "Need more than 7 days? Add the requested period to the message and Disorder119 will confirm price and availability individually."
    },
    fr: {
      menu: "Location",
      menuHint: "Louer temporairement des pièces designer",
      add: "Ajouter à la demande de location",
      added: "Ajouté ✓",
      basket: "Demande de location",
      selected: "{count} article(s) sélectionné(s)",
      empty: "Aucun article sélectionné.",
      emptyHint: "Sélectionne plusieurs pièces dans le catalogue de location puis envoie une demande commune.",
      continue: "Choisir d’autres articles",
      close: "Fermer",
      remove: "Retirer",
      daily: "{price} / jour",
      onRequest: "Prix sur demande",
      deposit: "Caution",
      depositAuto: "calculée automatiquement",
      depositRule: "50 % du prix de vente, minimum 50 € par article",
      period: "Période de location",
      start: "Du",
      end: "Au",
      days: "{days} jour(s) de location",
      maxDays: "Jusqu’à 7 jours de location peuvent être sélectionnés par défaut. Pour une durée plus longue, indique les dates souhaitées dans le message.",
      invalidDates: "Merci de sélectionner une période valide de 7 jours maximum.",
      purpose: "Utilisation",
      purposePrivate: "Occasion privée",
      purposePhoto: "Shooting photo",
      purposeVideo: "Clip musical",
      purposeFilm: "Film / théâtre / scène",
      purposeEditorial: "Éditorial",
      purposeEvent: "Événement / exposition",
      purposeOther: "Autre",
      delivery: "Remise",
      shipping: "Expédition",
      pickup: "Retrait",
      postal: "Code postal / ville (facultatif)",
      risk: "Utilisation particulière (facultatif)",
      riskPh: "p. ex. extérieur, eau, animaux, maquillage/bodypaint, scène …",
      message: "Message (facultatif)",
      messagePh: "Informations complémentaires …",
      summary: "Récapitulatif",
      rent: "Prix de location",
      refundableDeposit: "Caution remboursable",
      shippingCost: "Expédition",
      shippingConfirm: "à confirmer",
      provisional: "Montant provisoire",
      partialRequest: "partiellement sur demande",
      terms: "J’ai lu et j’accepte les conditions de location.",
      termsOpen: "Voir les conditions de location",
      noPayment: "Aucun paiement n’est effectué maintenant. La demande ne devient contraignante qu’après confirmation expresse de Disorder119.",
      sendEmail: "Envoyer la demande par e-mail",
      sendWhatsapp: "Envoyer la demande par WhatsApp",
      contactMissing: "Le contact de la boutique n’est pas encore entièrement configuré.",
      availabilityChecking: "Vérification de la disponibilité …",
      availabilityOk: "La période sélectionnée est actuellement disponible pour les articles demandés.",
      availabilityProblem: "Au moins un article n’est pas disponible pour cette période. Modifie les dates ou retire l’article.",
      availabilityManual: "La disponibilité définitive est confirmée par Disorder119.",
      buyWarning: "Pour au moins un article, le prix de location atteint le prix de vente. L’achat peut être plus avantageux.",
      processTitle: "Déroulement de la location",
      process: ["Demande", "Confirmation", "Paiement", "Utilisation", "Retour", "Caution libérée"],
      trust: ["Nettoyage normal inclus", "État documenté avant expédition", "Retour traçable", "Caution libérée après contrôle"],
      addedToast: "Ajouté à la demande de location.",
      removedToast: "Retiré de la demande de location.",
      subject: "Demande de location Disorder119 – plusieurs articles",
      intro: "Bonjour ! Je souhaite louer ensemble les pièces suivantes de l’archive Disorder119 :",
      totalLabel: "Total",
      termsVersion: "Conditions de location",
      requestSent: "Demande préparée. Les articles restent sans engagement jusqu’à confirmation.",
      longPeriod: "Besoin de plus de 7 jours ? Indique la période souhaitée dans le message ; Disorder119 confirmera individuellement le prix et la disponibilité."
    }
  };

  function t(key) { return (TEXT[LANG] || TEXT.de)[key]; }
  function fmt(template, vars) {
    var out = String(template || "");
    Object.keys(vars || {}).forEach(function (key) {
      out = out.split("{" + key + "}").join(String(vars[key]));
    });
    return out;
  }
  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function cents(value) {
    var n = typeof value === "number" ? value : Number(String(value || "").replace(",", "."));
    if (!Number.isFinite(n) || n <= 0) return null;
    var result = Math.round((n + Number.EPSILON) * 100);
    return Number.isSafeInteger(result) && result > 0 ? result : null;
  }
  function money(value) {
    if (!Number.isSafeInteger(value) || value < 0) return t("onRequest");
    return (value / 100).toLocaleString(LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
  }
  function dailyCents(item) {
    var sale = cents(item && item.price);
    return sale === null ? null : Math.round((sale * RENTAL_RATE_BPS) / 10000);
  }
  function depositCents(item) {
    var sale = cents(item && item.price);
    return sale === null ? null : Math.max(DEPOSIT_MIN_CENTS, Math.round((sale * DEPOSIT_RATE_BPS) / 10000));
  }
  function dayCount(start, end) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start || "") || !/^\d{4}-\d{2}-\d{2}$/.test(end || "")) return null;
    var s = start.split("-").map(Number), e = end.split("-").map(Number);
    var st = Date.UTC(s[0], s[1] - 1, s[2]), et = Date.UTC(e[0], e[1] - 1, e[2]);
    var sc = new Date(st), ec = new Date(et);
    if (sc.getUTCFullYear() !== s[0] || sc.getUTCMonth() !== s[1] - 1 || sc.getUTCDate() !== s[2]) return null;
    if (ec.getUTCFullYear() !== e[0] || ec.getUTCMonth() !== e[1] - 1 || ec.getUTCDate() !== e[2]) return null;
    var days = Math.floor((et - st) / 86400000) + 1;
    return days > 0 ? days : null;
  }
  function addDays(iso, amount) {
    if (!iso) return "";
    var p = iso.split("-").map(Number);
    var d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
    d.setUTCDate(d.getUTCDate() + amount);
    return d.toISOString().slice(0, 10);
  }
  function formatDate(iso) {
    if (!iso) return "";
    var p = iso.split("-").map(Number);
    return new Date(Date.UTC(p[0], p[1] - 1, p[2])).toLocaleDateString(LOCALE, { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });
  }

  function loadState() {
    var fallback = { ids: [], start: "", end: "", purpose: "private", delivery: "shipping", postal: "", risk: "", message: "", termsAccepted: false };
    try {
      var saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (!saved || !Array.isArray(saved.ids)) return fallback;
      saved.ids = saved.ids.map(Number).filter(function (x) { return Number.isFinite(x) && x > 0; }).slice(0, 20);
      return Object.assign(fallback, saved);
    } catch (e) { return fallback; }
  }
  var state = loadState();
  var catalog = [];
  var catalogMap = {};
  var overlay = null;
  var toastTimer = null;
  var availabilitySerial = 0;
  var availabilityBlocked = false;

  function saveState() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) {}
  }
  function invalidateAcceptance() {
    state.termsAccepted = false;
    saveState();
  }
  function isRentalPage() {
    return /(?:^|\/)mieten\/$/.test(window.location.pathname);
  }

  function injectStyles() {
    if (document.getElementById("d119RentalV2Styles")) return;
    var style = document.createElement("style");
    style.id = "d119RentalV2Styles";
    style.textContent = [
      ".d119-rental-menu-section{border-top:1px solid var(--line,#bbb);border-bottom:1px solid var(--line,#bbb);padding:12px 0;margin:8px 0}",
      ".d119-rental-menu-section a{display:block;text-decoration:none;color:inherit;font:inherit;padding:8px 0}",
      ".d119-rental-menu-section small{display:block;opacity:.6;font-size:11px;line-height:1.35;padding:0 0 6px}",
      ".d119-rental-toolbar{display:flex;gap:12px;align-items:center;justify-content:space-between;margin:18px 0 8px;padding:14px 0;border-top:1px solid var(--line,#bbb);border-bottom:1px solid var(--line,#bbb)}",
      ".d119-rental-toolbar__copy{font-size:12px;line-height:1.4;max-width:620px}",
      ".d119-rental-toolbar__button,.d119-rental-btn{appearance:none;border:1px solid currentColor;background:transparent;color:inherit;padding:10px 14px;font:inherit;cursor:pointer}",
      ".d119-rental-toolbar__button[disabled]{opacity:.4;cursor:not-allowed}",
      ".d119-rental-fab{position:fixed;right:18px;bottom:18px;z-index:75;border:1px solid #fff;background:#111;color:#fff;padding:12px 16px;font:inherit;cursor:pointer;box-shadow:0 8px 30px rgba(0,0,0,.22)}",
      ".d119-rental-fab[hidden]{display:none}",
      ".d119-rental-v2-backdrop{position:fixed;inset:0;z-index:120;background:rgba(0,0,0,.62);display:none;align-items:stretch;justify-content:flex-end}",
      ".d119-rental-v2-backdrop.open{display:flex}",
      ".d119-rental-v2{width:min(620px,100%);height:100%;overflow:auto;background:var(--surface,#fff);color:var(--ink,#111);padding:20px;box-sizing:border-box}",
      ".d119-rental-v2__head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding-bottom:14px;border-bottom:1px solid var(--line,#bbb)}",
      ".d119-rental-v2__head h2{font-size:20px;margin:0}",
      ".d119-rental-v2__close{border:0;background:transparent;color:inherit;font-size:22px;cursor:pointer}",
      ".d119-rental-v2__section{padding:18px 0;border-bottom:1px solid var(--line,#bbb)}",
      ".d119-rental-v2__section h3{font-size:12px;text-transform:uppercase;letter-spacing:.08em;margin:0 0 12px}",
      ".d119-rental-v2__items{display:grid;gap:12px}",
      ".d119-rental-item{display:grid;grid-template-columns:72px 1fr auto;gap:12px;align-items:start}",
      ".d119-rental-item img{width:72px;height:92px;object-fit:cover;background:#eee}",
      ".d119-rental-item strong,.d119-rental-item span{display:block}",
      ".d119-rental-item__meta{font-size:12px;line-height:1.5}",
      ".d119-rental-item__remove{border:0;background:transparent;color:inherit;text-decoration:underline;cursor:pointer;font:inherit;font-size:11px}",
      ".d119-rental-grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px}",
      ".d119-rental-field label{display:block;font-size:11px;margin-bottom:6px;opacity:.75}",
      ".d119-rental-field input,.d119-rental-field select,.d119-rental-field textarea{width:100%;box-sizing:border-box;border:1px solid var(--line,#aaa);background:transparent;color:inherit;padding:10px;font:inherit}",
      ".d119-rental-field textarea{resize:vertical;min-height:76px}",
      ".d119-rental-note{font-size:11px;line-height:1.45;opacity:.72;margin:8px 0 0}",
      ".d119-rental-error{font-size:12px;line-height:1.4;margin:10px 0 0}",
      ".d119-rental-process{display:grid;grid-template-columns:repeat(6,1fr);gap:6px;counter-reset:step}",
      ".d119-rental-process span{font-size:10px;text-align:center;line-height:1.25}",
      ".d119-rental-process span:before{counter-increment:step;content:counter(step);display:block;width:24px;height:24px;border:1px solid currentColor;border-radius:50%;line-height:22px;margin:0 auto 6px}",
      ".d119-rental-trust{display:grid;grid-template-columns:1fr 1fr;gap:7px;font-size:11px;line-height:1.35}",
      ".d119-rental-trust span:before{content:'✓ ';}",
      ".d119-rental-summary{display:grid;gap:8px;font-size:13px}",
      ".d119-rental-summary__row{display:flex;justify-content:space-between;gap:20px}",
      ".d119-rental-summary__row--total{font-weight:700;padding-top:9px;border-top:1px solid var(--line,#bbb);font-size:15px}",
      ".d119-rental-terms{display:flex;gap:9px;align-items:flex-start;font-size:12px;line-height:1.4}",
      ".d119-rental-actions{display:grid;gap:8px;margin-top:14px}",
      ".d119-rental-actions a{display:block;text-align:center;text-decoration:none;border:1px solid currentColor;color:inherit;padding:12px}",
      ".d119-rental-actions a[aria-disabled='true']{opacity:.4;pointer-events:none}",
      ".d119-rental-toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:160;background:#111;color:#fff;padding:10px 14px;font-size:12px}",
      ".d119-rental-terms-collapsed details{margin-top:12px}",
      ".d119-rental-terms-collapsed summary{cursor:pointer;font-size:12px;text-decoration:underline}",
      "@media(max-width:640px){.d119-rental-toolbar{align-items:flex-start;flex-direction:column}.d119-rental-toolbar__button{width:100%}.d119-rental-v2{padding:16px}.d119-rental-grid2{grid-template-columns:1fr}.d119-rental-process{grid-template-columns:repeat(3,1fr);row-gap:14px}.d119-rental-trust{grid-template-columns:1fr}.d119-rental-fab{left:12px;right:12px;bottom:12px;width:calc(100% - 24px)}}"
    ].join("");
    document.head.appendChild(style);
  }

  function moveRentalNavigation() {
    var link = document.getElementById("menuRental");
    var drawer = document.getElementById("menuDrawer");
    if (!link || !drawer || document.getElementById("d119RentalMenuSection")) return;
    var nav = link.closest(".menu-drawer__nav");
    var cartSection = drawer.querySelector(".menu-drawer__section");
    var section = document.createElement("div");
    section.id = "d119RentalMenuSection";
    section.className = "menu-drawer__section d119-rental-menu-section";
    link.textContent = t("menu");
    link.href = RENTAL_PATH;
    section.appendChild(link);
    var hint = document.createElement("small");
    hint.textContent = t("menuHint");
    section.appendChild(hint);
    if (cartSection) drawer.insertBefore(section, cartSection);
    else if (nav && nav.parentNode) nav.parentNode.insertBefore(section, nav.nextSibling);
  }

  function selectedItems() {
    return state.ids.map(function (id) { return catalogMap[id]; }).filter(Boolean);
  }
  function toggleItem(id) {
    id = Number(id);
    if (!catalogMap[id]) return;
    var idx = state.ids.indexOf(id);
    if (idx >= 0) {
      state.ids.splice(idx, 1);
      showToast(t("removedToast"));
    } else {
      if (state.ids.length >= 20) return;
      state.ids.push(id);
      showToast(t("addedToast"));
    }
    invalidateAcceptance();
    saveState();
    refreshCardButtons();
    refreshToolbar();
    renderOverlay();
  }

  function showToast(message) {
    var old = document.getElementById("d119RentalToast");
    if (old) old.remove();
    var el = document.createElement("div");
    el.id = "d119RentalToast";
    el.className = "d119-rental-toast";
    el.textContent = message;
    document.body.appendChild(el);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { if (el.parentNode) el.remove(); }, 1800);
  }

  function refreshCardButtons() {
    Array.prototype.forEach.call(document.querySelectorAll("[data-rental]"), function (btn) {
      var id = Number(btn.getAttribute("data-rental"));
      var active = state.ids.indexOf(id) >= 0;
      btn.textContent = active ? t("added") : t("add");
      btn.setAttribute("aria-pressed", active ? "true" : "false");
    });
  }

  function ensureToolbar() {
    if (!isRentalPage() || document.getElementById("d119RentalToolbar")) return;
    var rail = document.querySelector(".rail");
    if (!rail || !rail.parentNode) return;
    var bar = document.createElement("div");
    bar.id = "d119RentalToolbar";
    bar.className = "d119-rental-toolbar";
    bar.innerHTML = '<div class="d119-rental-toolbar__copy"><strong>' + esc(t("basket")) + '</strong><br><span>' + esc(t("emptyHint")) + '</span></div>' +
      '<button type="button" class="d119-rental-toolbar__button" id="d119RentalOpen"></button>';
    rail.parentNode.insertBefore(bar, rail.nextSibling);
    bar.querySelector("#d119RentalOpen").addEventListener("click", openOverlay);

    var fab = document.createElement("button");
    fab.type = "button";
    fab.id = "d119RentalFab";
    fab.className = "d119-rental-fab";
    fab.addEventListener("click", openOverlay);
    document.body.appendChild(fab);
    refreshToolbar();
  }

  function refreshToolbar() {
    var count = state.ids.length;
    var open = document.getElementById("d119RentalOpen");
    var fab = document.getElementById("d119RentalFab");
    var label = t("basket") + " (" + count + ")";
    if (open) { open.textContent = label; open.disabled = count === 0; }
    if (fab) { fab.textContent = label; fab.hidden = count === 0; }
  }

  function collapseLongTerms() {
    if (!isRentalPage()) return;
    var panel = document.querySelector(".static-page .legal-panel");
    if (!panel || panel.classList.contains("d119-rental-terms-collapsed")) return;
    var h3 = panel.querySelector("#mietbedingungen");
    var list = h3 && h3.nextElementSibling;
    if (!h3 || !list || list.tagName !== "UL") return;
    panel.classList.add("d119-rental-terms-collapsed");
    var details = document.createElement("details");
    details.id = "d119FullRentalTerms";
    var summary = document.createElement("summary");
    summary.textContent = t("termsOpen");
    details.appendChild(summary);
    details.appendChild(list);
    h3.parentNode.insertBefore(details, h3.nextSibling);
    h3.style.display = "none";
  }

  function createOverlay() {
    if (overlay) return overlay;
    var backdrop = document.createElement("div");
    backdrop.className = "d119-rental-v2-backdrop";
    backdrop.id = "d119RentalV2Backdrop";
    backdrop.innerHTML = '<div class="d119-rental-v2" role="dialog" aria-modal="true" aria-labelledby="d119RentalV2Title">' +
      '<div class="d119-rental-v2__head"><h2 id="d119RentalV2Title"></h2><button type="button" class="d119-rental-v2__close" aria-label="' + esc(t("close")) + '">✕</button></div>' +
      '<div id="d119RentalV2Body"></div></div>';
    backdrop.addEventListener("click", function (e) { if (e.target === backdrop) closeOverlay(); });
    backdrop.querySelector(".d119-rental-v2__close").addEventListener("click", closeOverlay);
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && backdrop.classList.contains("open")) closeOverlay(); });
    document.body.appendChild(backdrop);
    overlay = backdrop;
    return backdrop;
  }

  function openOverlay() {
    createOverlay();
    renderOverlay();
    overlay.classList.add("open");
    document.documentElement.style.overflow = "hidden";
    var close = overlay.querySelector(".d119-rental-v2__close");
    if (close) close.focus();
  }
  function closeOverlay() {
    if (!overlay) return;
    overlay.classList.remove("open");
    document.documentElement.style.overflow = "";
  }

  function quoteSummary(items) {
    var days = dayCount(state.start, state.end);
    var rentTotal = 0, depositTotal = 0, unknown = false, buyWarning = false;
    items.forEach(function (item) {
      var sale = cents(item.price), daily = dailyCents(item), dep = depositCents(item);
      if (sale === null || daily === null || dep === null || !days) unknown = true;
      else {
        rentTotal += daily * days;
        depositTotal += dep;
        if (daily * days >= sale) buyWarning = true;
      }
    });
    return { days: days, rentTotal: rentTotal, depositTotal: depositTotal, unknown: unknown, buyWarning: buyWarning };
  }

  function itemHtml(item, days) {
    var daily = dailyCents(item), dep = depositCents(item);
    var img = item.gallery && item.gallery[0] ? "/" + String(item.gallery[0]).replace(/^\//, "") : "/assets/favicon.png";
    var title = ((item.brand ? item.brand + " " : "") + (item.title || "")).trim();
    var total = daily !== null && days ? daily * days : null;
    return '<div class="d119-rental-item" data-rental-v2-item="' + Number(item.id) + '">' +
      '<img src="' + esc(img) + '" alt="' + esc(title) + '">' +
      '<div class="d119-rental-item__meta"><strong>' + esc(title) + '</strong><span>Art.-Nr. ' + esc(item.article || item.id) + '</span>' +
      '<span>' + esc(daily === null ? t("onRequest") : fmt(t("daily"), { price: money(daily) })) + '</span>' +
      '<span>' + esc(t("deposit")) + ': ' + esc(dep === null ? t("onRequest") : money(dep)) + '</span>' +
      (days ? '<span>' + esc(t("rent")) + ': ' + esc(total === null ? t("onRequest") : money(total)) + '</span>' : '') + '</div>' +
      '<button type="button" class="d119-rental-item__remove" data-rental-v2-remove="' + Number(item.id) + '">' + esc(t("remove")) + '</button></div>';
  }

  function renderOverlay() {
    if (!overlay) return;
    var body = overlay.querySelector("#d119RentalV2Body");
    var title = overlay.querySelector("#d119RentalV2Title");
    var items = selectedItems();
    var quote = quoteSummary(items);
    if (title) title.textContent = t("basket") + " · " + fmt(t("selected"), { count: items.length });
    if (!items.length) {
      body.innerHTML = '<div class="d119-rental-v2__section"><strong>' + esc(t("empty")) + '</strong><p class="d119-rental-note">' + esc(t("emptyHint")) + '</p></div>' +
        '<div class="d119-rental-v2__section"><button type="button" class="d119-rental-btn" id="d119RentalContinue">' + esc(t("continue")) + '</button></div>';
      body.querySelector("#d119RentalContinue").addEventListener("click", closeOverlay);
      refreshToolbar();
      return;
    }

    var process = t("process").map(function (x) { return "<span>" + esc(x) + "</span>"; }).join("");
    var trust = t("trust").map(function (x) { return "<span>" + esc(x) + "</span>"; }).join("");
    var itemRows = items.map(function (item) { return itemHtml(item, quote.days); }).join("");
    var knownSummary = quote.unknown ? t("partialRequest") : money(quote.rentTotal);
    var knownDeposit = quote.unknown ? t("partialRequest") : money(quote.depositTotal);
    var provisional = quote.unknown ? t("partialRequest") : money(quote.rentTotal + quote.depositTotal);

    body.innerHTML =
      '<div class="d119-rental-v2__section"><h3>' + esc(t("processTitle")) + '</h3><div class="d119-rental-process">' + process + '</div><div class="d119-rental-trust" style="margin-top:16px">' + trust + '</div></div>' +
      '<div class="d119-rental-v2__section"><h3>' + esc(fmt(t("selected"), { count: items.length })) + '</h3><div class="d119-rental-v2__items">' + itemRows + '</div><p class="d119-rental-note">' + esc(t("deposit")) + ': ' + esc(t("depositRule")) + ' · ' + esc(t("depositAuto")) + '.</p></div>' +
      '<div class="d119-rental-v2__section"><h3>' + esc(t("period")) + '</h3><div class="d119-rental-grid2">' +
      '<div class="d119-rental-field"><label for="d119RentalStart">' + esc(t("start")) + '</label><input type="date" id="d119RentalStart" value="' + esc(state.start) + '"></div>' +
      '<div class="d119-rental-field"><label for="d119RentalEnd">' + esc(t("end")) + '</label><input type="date" id="d119RentalEnd" value="' + esc(state.end) + '"></div></div>' +
      '<p class="d119-rental-note">' + esc(t("maxDays")) + '</p><p class="d119-rental-note">' + esc(t("longPeriod")) + '</p><p class="d119-rental-error" id="d119RentalDateStatus"></p></div>' +
      '<div class="d119-rental-v2__section"><div class="d119-rental-grid2">' +
      '<div class="d119-rental-field"><label for="d119RentalPurpose">' + esc(t("purpose")) + '</label><select id="d119RentalPurpose">' +
      option("private", t("purposePrivate"), state.purpose) + option("photo", t("purposePhoto"), state.purpose) + option("video", t("purposeVideo"), state.purpose) + option("filmTheater", t("purposeFilm"), state.purpose) + option("editorial", t("purposeEditorial"), state.purpose) + option("event", t("purposeEvent"), state.purpose) + option("other", t("purposeOther"), state.purpose) + '</select></div>' +
      '<div class="d119-rental-field"><label for="d119RentalDelivery">' + esc(t("delivery")) + '</label><select id="d119RentalDelivery">' + option("shipping", t("shipping"), state.delivery) + option("pickup", t("pickup"), state.delivery) + '</select></div></div>' +
      '<div class="d119-rental-field" style="margin-top:12px"><label for="d119RentalPostal">' + esc(t("postal")) + '</label><input id="d119RentalPostal" value="' + esc(state.postal) + '"></div>' +
      '<div class="d119-rental-field" style="margin-top:12px"><label for="d119RentalRisk">' + esc(t("risk")) + '</label><input id="d119RentalRisk" value="' + esc(state.risk) + '" placeholder="' + esc(t("riskPh")) + '"></div>' +
      '<div class="d119-rental-field" style="margin-top:12px"><label for="d119RentalMessage">' + esc(t("message")) + '</label><textarea id="d119RentalMessage" placeholder="' + esc(t("messagePh")) + '">' + esc(state.message) + '</textarea></div></div>' +
      '<div class="d119-rental-v2__section"><h3>' + esc(t("summary")) + '</h3><div class="d119-rental-summary">' +
      '<div class="d119-rental-summary__row"><span>' + esc(t("rent")) + '</span><strong id="d119RentTotal">' + esc(knownSummary) + '</strong></div>' +
      '<div class="d119-rental-summary__row"><span>' + esc(t("refundableDeposit")) + '</span><strong id="d119DepositTotal">' + esc(knownDeposit) + '</strong></div>' +
      '<div class="d119-rental-summary__row"><span>' + esc(t("shippingCost")) + '</span><strong>' + esc(t("shippingConfirm")) + '</strong></div>' +
      '<div class="d119-rental-summary__row d119-rental-summary__row--total"><span>' + esc(t("provisional")) + '</span><strong id="d119Provisional">' + esc(provisional) + '</strong></div></div>' +
      '<p class="d119-rental-error" id="d119RentalBuyWarning">' + (quote.buyWarning ? esc(t("buyWarning")) : '') + '</p>' +
      '<p class="d119-rental-error" id="d119RentalAvailability">' + esc(SHOP_CONFIG.shopWorkerUrl ? t("availabilityChecking") : t("availabilityManual")) + '</p></div>' +
      '<div class="d119-rental-v2__section"><label class="d119-rental-terms"><input type="checkbox" id="d119RentalTerms"' + (state.termsAccepted ? ' checked' : '') + '><span>' + esc(t("terms")) + ' <a href="' + esc(RENTAL_PATH + '#mietbedingungen') + '" target="_blank" rel="noopener">' + esc(t("termsOpen")) + '</a></span></label>' +
      '<p class="d119-rental-note">' + esc(t("noPayment")) + '</p><div class="d119-rental-actions" id="d119RentalActions"></div></div>';

    bindOverlayControls();
    syncDateConstraints();
    refreshQuoteDisplay();
    checkAvailability();
  }

  function option(value, label, current) {
    return '<option value="' + esc(value) + '"' + (value === current ? ' selected' : '') + '>' + esc(label) + '</option>';
  }

  function bindOverlayControls() {
    Array.prototype.forEach.call(overlay.querySelectorAll("[data-rental-v2-remove]"), function (btn) {
      btn.addEventListener("click", function () { toggleItem(btn.getAttribute("data-rental-v2-remove")); });
    });
    var start = overlay.querySelector("#d119RentalStart");
    var end = overlay.querySelector("#d119RentalEnd");
    var purpose = overlay.querySelector("#d119RentalPurpose");
    var delivery = overlay.querySelector("#d119RentalDelivery");
    var postal = overlay.querySelector("#d119RentalPostal");
    var risk = overlay.querySelector("#d119RentalRisk");
    var message = overlay.querySelector("#d119RentalMessage");
    var terms = overlay.querySelector("#d119RentalTerms");
    if (start) start.addEventListener("change", function () { state.start = start.value; state.end = ""; invalidateAcceptance(); syncDateConstraints(); refreshQuoteDisplay(); checkAvailability(); });
    if (end) end.addEventListener("change", function () { state.end = end.value; invalidateAcceptance(); refreshQuoteDisplay(); checkAvailability(); });
    if (purpose) purpose.addEventListener("change", function () { state.purpose = purpose.value; invalidateAcceptance(); saveState(); refreshActions(); });
    if (delivery) delivery.addEventListener("change", function () { state.delivery = delivery.value; invalidateAcceptance(); saveState(); refreshActions(); });
    if (postal) postal.addEventListener("input", function () { state.postal = postal.value.slice(0, 120); saveState(); });
    if (risk) risk.addEventListener("input", function () { state.risk = risk.value.slice(0, 500); saveState(); });
    if (message) message.addEventListener("input", function () { state.message = message.value.slice(0, 1500); saveState(); });
    if (terms) terms.addEventListener("change", function () { state.termsAccepted = terms.checked; saveState(); refreshActions(); });
  }

  function syncDateConstraints() {
    if (!overlay) return;
    var start = overlay.querySelector("#d119RentalStart"), end = overlay.querySelector("#d119RentalEnd");
    if (!start || !end) return;
    var today = new Date();
    var yyyy = today.getFullYear(), mm = String(today.getMonth() + 1).padStart(2, "0"), dd = String(today.getDate()).padStart(2, "0");
    var min = yyyy + "-" + mm + "-" + dd;
    start.min = min;
    end.min = state.start || min;
    end.max = state.start ? addDays(state.start, STANDARD_MAX_DAYS - 1) : "";
    end.value = state.end || "";
  }

  function validPeriod() {
    var days = dayCount(state.start, state.end);
    return days && days <= STANDARD_MAX_DAYS ? days : null;
  }

  function refreshQuoteDisplay() {
    if (!overlay) return;
    var items = selectedItems(), quote = quoteSummary(items), valid = validPeriod();
    var dateStatus = overlay.querySelector("#d119RentalDateStatus");
    if (dateStatus) {
      if (!state.start || !state.end) dateStatus.textContent = "";
      else if (!valid) dateStatus.textContent = t("invalidDates");
      else dateStatus.textContent = fmt(t("days"), { days: valid });
    }
    var rent = overlay.querySelector("#d119RentTotal"), dep = overlay.querySelector("#d119DepositTotal"), prov = overlay.querySelector("#d119Provisional"), warning = overlay.querySelector("#d119RentalBuyWarning");
    if (rent) rent.textContent = quote.unknown ? t("partialRequest") : money(quote.rentTotal);
    if (dep) dep.textContent = quote.unknown ? t("partialRequest") : money(quote.depositTotal);
    if (prov) prov.textContent = quote.unknown ? t("partialRequest") : money(quote.rentTotal + quote.depositTotal);
    if (warning) warning.textContent = quote.buyWarning ? t("buyWarning") : "";
    refreshActions();
  }

  function checkAvailability() {
    if (!overlay) return;
    var status = overlay.querySelector("#d119RentalAvailability");
    var items = selectedItems();
    var days = validPeriod();
    availabilityBlocked = false;
    if (!SHOP_CONFIG.shopWorkerUrl || !days || !items.length) {
      if (status) status.textContent = t("availabilityManual");
      refreshActions();
      return;
    }
    var serial = ++availabilitySerial;
    if (status) status.textContent = t("availabilityChecking");
    Promise.all(items.map(function (item) {
      return fetch(String(SHOP_CONFIG.shopWorkerUrl).replace(/\/+$/, "") + "/rental-quote", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId: item.id, start: state.start, end: state.end })
      }).then(function (r) { return { ok: r.ok, status: r.status }; }).catch(function () { return { ok: true, network: true }; });
    })).then(function (results) {
      if (serial !== availabilitySerial) return;
      availabilityBlocked = results.some(function (r) { return !r.ok && r.status === 409; });
      if (status) status.textContent = availabilityBlocked ? t("availabilityProblem") : t("availabilityOk");
      refreshActions();
    });
  }

  function requestPayload() {
    return {
      itemIds: state.ids.slice(), start: state.start, end: state.end, purpose: state.purpose,
      delivery: state.delivery, postal: state.postal, risk: state.risk, message: state.message,
      termsVersion: TERMS_VERSION, language: LANG
    };
  }

  function buildMessage() {
    var items = selectedItems(), quote = quoteSummary(items), days = validPeriod();
    var lines = [t("intro"), ""];
    items.forEach(function (item, index) {
      var daily = dailyCents(item), dep = depositCents(item), rent = daily !== null && days ? daily * days : null;
      lines.push((index + 1) + ". " + ((item.brand ? item.brand + " " : "") + (item.title || "")).trim());
      lines.push("   Art.-Nr.: " + (item.article || item.id));
      lines.push("   " + t("rent") + ": " + (rent === null ? t("onRequest") : money(rent)) + (daily === null ? "" : " (" + money(daily) + " / " + (LANG === "de" ? "Tag" : LANG === "fr" ? "jour" : "day") + ")"));
      lines.push("   " + t("deposit") + ": " + (dep === null ? t("onRequest") : money(dep)));
    });
    lines.push("");
    lines.push(t("period") + ": " + formatDate(state.start) + " – " + formatDate(state.end) + " (" + days + ")");
    lines.push(t("purpose") + ": " + purposeLabel(state.purpose));
    lines.push(t("delivery") + ": " + (state.delivery === "pickup" ? t("pickup") : t("shipping")));
    if (state.postal) lines.push(t("postal") + ": " + state.postal);
    if (state.risk) lines.push(t("risk") + ": " + state.risk);
    if (state.message) lines.push(t("message") + ": " + state.message);
    lines.push("");
    lines.push(t("rent") + " – " + t("totalLabel") + ": " + (quote.unknown ? t("partialRequest") : money(quote.rentTotal)));
    lines.push(t("refundableDeposit") + " – " + t("totalLabel") + ": " + (quote.unknown ? t("partialRequest") : money(quote.depositTotal)));
    lines.push(t("provisional") + ": " + (quote.unknown ? t("partialRequest") : money(quote.rentTotal + quote.depositTotal)) + " + " + t("shippingConfirm"));
    lines.push("");
    lines.push(t("termsVersion") + ": " + TERMS_VERSION + " · " + LANG);
    lines.push(t("noPayment"));
    return lines.join("\n");
  }

  function purposeLabel(value) {
    var map = { private: "purposePrivate", photo: "purposePhoto", video: "purposeVideo", filmTheater: "purposeFilm", editorial: "purposeEditorial", event: "purposeEvent", other: "purposeOther" };
    return t(map[value] || "purposeOther");
  }

  function refreshActions() {
    if (!overlay) return;
    var actions = overlay.querySelector("#d119RentalActions");
    if (!actions) return;
    var enabled = state.ids.length > 0 && !!validPeriod() && state.termsAccepted && !availabilityBlocked;
    var msg = enabled ? buildMessage() : "";
    var html = "";
    if (SHOP_CONFIG.email) {
      html += '<a data-d119-rental-send="email" aria-disabled="' + (enabled ? "false" : "true") + '" href="' + (enabled ? "mailto:" + encodeURIComponent(SHOP_CONFIG.email) + "?subject=" + encodeURIComponent(t("subject")) + "&body=" + encodeURIComponent(msg) : "#") + '">' + esc(t("sendEmail")) + '</a>';
    }
    if (SHOP_CONFIG.whatsappNumber) {
      html += '<a data-d119-rental-send="whatsapp" aria-disabled="' + (enabled ? "false" : "true") + '" href="' + (enabled ? "https://wa.me/" + encodeURIComponent(SHOP_CONFIG.whatsappNumber) + "?text=" + encodeURIComponent(msg) : "#") + '" target="_blank" rel="noopener">' + esc(t("sendWhatsapp")) + '</a>';
    }
    if (!SHOP_CONFIG.email && !SHOP_CONFIG.whatsappNumber) html = '<p class="d119-rental-error">' + esc(t("contactMissing")) + '</p>';
    actions.innerHTML = html;
    Array.prototype.forEach.call(actions.querySelectorAll("[data-d119-rental-send]"), function (a) {
      a.addEventListener("click", function (e) {
        if (!enabled) { e.preventDefault(); return; }
        saveTermsReceipt();
        reportBundleToWorker();
        showToast(t("requestSent"));
      });
    });
  }

  function saveTermsReceipt() {
    var quote = quoteSummary(selectedItems());
    var receipt = {
      version: TERMS_VERSION, language: LANG, acceptedAt: new Date().toISOString(),
      itemIds: state.ids.slice(), start: state.start, end: state.end,
      rentTotalCents: quote.unknown ? null : quote.rentTotal,
      depositTotalCents: quote.unknown ? null : quote.depositTotal
    };
    try {
      var list = JSON.parse(localStorage.getItem(RECEIPT_KEY) || "[]");
      if (!Array.isArray(list)) list = [];
      list.push(receipt);
      localStorage.setItem(RECEIPT_KEY, JSON.stringify(list.slice(-20)));
    } catch (e) {}
  }

  function stableHash(value) {
    var str = JSON.stringify(value), hash = 2166136261;
    for (var i = 0; i < str.length; i++) { hash ^= str.charCodeAt(i); hash = Math.imul(hash, 16777619); }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }

  function reportBundleToWorker() {
    if (!SHOP_CONFIG.shopWorkerUrl || !validPeriod()) return;
    var payload = requestPayload();
    var bundleHash = stableHash(payload);
    selectedItems().forEach(function (item) {
      var body = {
        itemId: item.id,
        start: state.start,
        end: state.end,
        purpose: state.purpose,
        message: "[MULTI_ITEM " + state.ids.length + " | " + TERMS_VERSION + " | bundle " + bundleHash + "] " + [state.delivery, state.postal, state.risk, state.message].filter(Boolean).join(" | ").slice(0, 1750)
      };
      fetch(String(SHOP_CONFIG.shopWorkerUrl).replace(/\/+$/, "") + "/rental-request", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": "rental-v2:" + bundleHash + ":" + item.id },
        body: JSON.stringify(body)
      }).catch(function () {});
    });
  }

  function processQueryItemEarly() {
    if (!isRentalPage()) return;
    try {
      var params = new URLSearchParams(window.location.search);
      var id = Number(params.get("item"));
      if (!id) return;
      if (state.ids.indexOf(id) < 0) state.ids.push(id);
      saveState();
      params.delete("item");
      var query = params.toString();
      history.replaceState(history.state, "", window.location.pathname + (query ? "?" + query : "") + window.location.hash);
    } catch (e) {}
  }

  function interceptLegacyRentalClicks() {
    document.addEventListener("click", function (event) {
      if (!isRentalPage()) return;
      var btn = event.target.closest && event.target.closest("[data-rental]");
      if (!btn) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      toggleItem(btn.getAttribute("data-rental"));
    }, true);
  }

  function observeGrid() {
    var grid = document.getElementById("grid");
    if (!grid || typeof MutationObserver === "undefined") return;
    new MutationObserver(function () { refreshCardButtons(); }).observe(grid, { childList: true, subtree: true });
  }

  function bootstrap() {
    injectStyles();
    moveRentalNavigation();
    processQueryItemEarly();
    interceptLegacyRentalClicks();
    if (!isRentalPage()) return;
    ensureToolbar();
    collapseLongTerms();
    observeGrid();
    refreshCardButtons();

    fetch("/data/catalog.json", { credentials: "same-origin" })
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (items) {
        catalog = Array.isArray(items) ? items : [];
        catalog.forEach(function (item) { catalogMap[Number(item.id)] = item; });
        state.ids = state.ids.filter(function (id) { return !!catalogMap[id] && String(catalogMap[id].public_status || "").toUpperCase() !== "SOLD"; });
        saveState();
        refreshCardButtons();
        refreshToolbar();
        if (state.ids.length && /[?&]openRental=1(?:&|$)/.test(window.location.search)) openOverlay();
      })
      .catch(function () {});
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bootstrap, { once: true });
  else bootstrap();
})();

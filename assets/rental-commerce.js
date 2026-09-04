/* Rental-specific frontend bridge.
   Keeps the visible rental experience aligned with the server-authoritative
   commerce rules without touching Match, Chaos or Baukasten. */
(function () {
  "use strict";

  var RENTAL_RATE_BPS = 1000; // Must mirror shop-worker/commerce-core.js: 10.00% per calendar day.
  var SHOP_CONFIG = window.SHOP_CONFIG || {};
  var LANG_MATCH = /^\/(en|fr)(?:\/|$)/.exec(window.location.pathname);
  var LANG = LANG_MATCH ? LANG_MATCH[1] : "de";
  var LOCALES = { de: "de-DE", en: "en-GB", fr: "fr-FR" };
  var TEXT = {
    de: {
      daily: "Mietpreis: {price} / Tag",
      onRequest: "Mietpreis auf Anfrage",
      total: "{days} Tag(e) · {total} gesamt",
      totalOnRequest: "{days} Tag(e) · Gesamtpreis auf Anfrage",
      subject: "Verleih-Anfrage Disorder119",
      intro: "Hallo!\n\nIch interessiere mich für folgendes Stück aus dem Disorder119-Archiv und würde es gerne ausleihen:\n\n{item}",
      period: "Zeitraum",
      purpose: "Zweck",
      price: "Mietpreis",
      message: "Nachricht",
      closing: "Über eine Rückmeldung zu Verfügbarkeit, Kaution und den weiteren Konditionen würde ich mich freuen.\n\nViele Grüße",
      unavailable: "Dieser Zeitraum ist aktuell nicht verfügbar. Bitte wähle andere Daten.",
      itemUnavailable: "Dieses Stück ist aktuell nicht mehr verfügbar.",
      requestFailed: "Die Anfrage konnte nicht automatisch im System vorgemerkt werden. Die Kontaktanfrage kann trotzdem gesendet werden.",
      termsHeading: "Wie die Miete funktioniert",
      termsHtml: "<ul><li><strong>Mietpreis:</strong> exakt 10&nbsp;% des aktuell im Archiv angegebenen Verkaufspreises pro ausgewähltem Kalendertag. Der Gesamtpreis wird vor dem Absenden automatisch aus Tagespreis × Miettage berechnet. Hat ein Stück keinen festen Verkaufspreis, bleibt auch der Mietpreis auf Anfrage.</li><li><strong>Kaution:</strong> wird bei Abholung/Versand hinterlegt und nach unbeschädigter, vollständiger Rückgabe innerhalb von 7 Tagen zurückerstattet.</li><li><strong>Reinigung:</strong> normale Gebrauchsspuren und einfache Verschmutzungen sind im Mietpreis enthalten. Für die professionelle Reinigung nach der Nutzung kann ggf. eine Reinigungspauschale einbehalten werden.</li><li><strong>Schäden:</strong> Reparable Schäden werden von der Kaution beglichen; bei nicht behebbaren Schäden oder Verlust wird der aktuelle Archivwert des Stücks fällig.</li><li><strong>Zeitraum:</strong> Start- und Endtag zählen jeweils als Miettag. Verfügbarkeit wird für den gewählten Zeitraum geprüft.</li><li>Die Anfrage ist unverbindlich und noch keine bestätigte Buchung. Verfügbarkeit, Kaution und weitere Konditionen werden persönlich bestätigt.</li></ul>"
    },
    en: {
      daily: "Rental price: {price} / day",
      onRequest: "Rental price on request",
      total: "{days} day(s) · {total} total",
      totalOnRequest: "{days} day(s) · total price on request",
      subject: "Disorder119 rental request",
      intro: "Hello!\n\nI'm interested in the following piece from the Disorder119 archive and would like to rent it:\n\n{item}",
      period: "Period",
      purpose: "Purpose",
      price: "Rental price",
      message: "Message",
      closing: "I would appreciate confirmation of availability, the deposit and the remaining rental terms.\n\nBest regards",
      unavailable: "These dates are currently unavailable. Please choose different dates.",
      itemUnavailable: "This piece is currently no longer available.",
      requestFailed: "The request could not be reserved automatically in the system. You can still send the contact request.",
      termsHeading: "How renting works",
      termsHtml: "<ul><li><strong>Rental price:</strong> exactly 10% of the current archive sale price per selected calendar day. The total shown before sending is calculated automatically as daily price × rental days. If a piece has no fixed sale price, its rental price remains on request.</li><li><strong>Deposit:</strong> collected at pickup/shipping and refunded after an undamaged, complete return within 7 days.</li><li><strong>Cleaning:</strong> normal wear and light soiling are included in the rental price. A professional cleaning fee may be retained where necessary after use.</li><li><strong>Damage:</strong> repairable damage is settled from the deposit; for damage beyond repair or loss, the piece's current archive value becomes due.</li><li><strong>Period:</strong> both the start and end date count as rental days. Availability is checked for the selected period.</li><li>The request is non-binding and is not yet a confirmed booking. Availability, deposit and further terms are confirmed personally.</li></ul>"
    },
    fr: {
      daily: "Prix de location : {price} / jour",
      onRequest: "Prix de location sur demande",
      total: "{days} jour(s) · {total} au total",
      totalOnRequest: "{days} jour(s) · prix total sur demande",
      subject: "Demande de location Disorder119",
      intro: "Bonjour !\n\nJe souhaite louer la pièce suivante de l'archive Disorder119 :\n\n{item}",
      period: "Période",
      purpose: "Utilisation",
      price: "Prix de location",
      message: "Message",
      closing: "Merci de me confirmer la disponibilité, la caution et les autres conditions de location.\n\nCordialement",
      unavailable: "Ces dates ne sont actuellement pas disponibles. Merci de choisir une autre période.",
      itemUnavailable: "Cette pièce n'est actuellement plus disponible.",
      requestFailed: "La demande n'a pas pu être réservée automatiquement dans le système. La demande de contact peut tout de même être envoyée.",
      termsHeading: "Comment fonctionne la location",
      termsHtml: "<ul><li><strong>Prix de location :</strong> exactement 10&nbsp;% du prix de vente actuel indiqué dans l'archive par jour calendaire sélectionné. Le total affiché avant l'envoi est calculé automatiquement : prix journalier × nombre de jours. Si une pièce n'a pas de prix de vente fixe, son prix de location reste sur demande.</li><li><strong>Caution :</strong> déposée au retrait/à l'envoi et remboursée après un retour complet et non endommagé sous 7 jours.</li><li><strong>Nettoyage :</strong> l'usure normale et les salissures légères sont incluses dans le prix de location. Des frais de nettoyage professionnel peuvent être retenus si nécessaire après usage.</li><li><strong>Dommages :</strong> les dommages réparables sont réglés via la caution ; en cas de dommage irréparable ou de perte, la valeur actuelle de la pièce dans l'archive est due.</li><li><strong>Période :</strong> les jours de début et de fin comptent tous les deux comme jours de location. La disponibilité est vérifiée pour la période choisie.</li><li>La demande est sans engagement et ne constitue pas encore une réservation confirmée. La disponibilité, la caution et les autres conditions sont confirmées personnellement.</li></ul>"
    }
  };

  function text() { return TEXT[LANG] || TEXT.de; }
  function format(template, vars) {
    var out = template;
    Object.keys(vars || {}).forEach(function (key) {
      out = out.split("{" + key + "}").join(String(vars[key]));
    });
    return out;
  }
  function moneyFromCents(cents) {
    if (!Number.isSafeInteger(cents) || cents < 0) return null;
    return (cents / 100).toLocaleString(LOCALES[LANG] || "de-DE", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }) + " €";
  }
  function parseSalePriceCents(value) {
    if (value === null || value === undefined || value === "") return null;
    var number = typeof value === "number" ? value : Number(String(value).replace(",", "."));
    if (!Number.isFinite(number) || number <= 0) return null;
    var cents = Math.round((number + Number.EPSILON) * 100);
    return Number.isSafeInteger(cents) && cents > 0 ? cents : null;
  }
  function dailyPriceCents(item) {
    var sale = parseSalePriceCents(item && item.price);
    return sale === null ? null : Math.round((sale * RENTAL_RATE_BPS) / 10000);
  }
  function rentalDayCount(start, end) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(start || "")) || !/^\d{4}-\d{2}-\d{2}$/.test(String(end || ""))) return null;
    var sp = start.split("-").map(Number);
    var ep = end.split("-").map(Number);
    var s = Date.UTC(sp[0], sp[1] - 1, sp[2]);
    var e = Date.UTC(ep[0], ep[1] - 1, ep[2]);
    var sc = new Date(s), ec = new Date(e);
    if (sc.getUTCFullYear() !== sp[0] || sc.getUTCMonth() !== sp[1] - 1 || sc.getUTCDate() !== sp[2]) return null;
    if (ec.getUTCFullYear() !== ep[0] || ec.getUTCMonth() !== ep[1] - 1 || ec.getUTCDate() !== ep[2]) return null;
    var days = Math.floor((e - s) / 86400000) + 1;
    return days > 0 && days <= 366 ? days : null;
  }
  function localQuote(item, start, end) {
    var days = rentalDayCount(start, end);
    var daily = dailyPriceCents(item);
    return {
      days: days,
      dailyPriceCents: daily,
      totalPriceCents: days && daily !== null ? daily * days : null,
      priceOnRequest: daily === null
    };
  }

  var catalog = [];
  var currentItemId = null;
  var queryItem = null;
  try { queryItem = Number(new URLSearchParams(window.location.search).get("item")); } catch (e) {}
  if (queryItem) currentItemId = queryItem;

  var catalogPromise = fetch("/data/catalog.json", { credentials: "same-origin" })
    .then(function (res) { return res.ok ? res.json() : []; })
    .then(function (items) {
      catalog = Array.isArray(items) ? items : [];
      refreshRentalCards();
      refreshCurrentQuote();
      return catalog;
    })
    .catch(function () { catalog = []; return catalog; });

  function findItem(id) {
    return catalog.find(function (item) { return String(item.id) === String(id); }) || null;
  }
  function setCurrentItem(id) {
    var parsed = Number(id);
    if (!parsed) return;
    currentItemId = parsed;
    catalogPromise.then(function () { setTimeout(refreshCurrentQuote, 0); });
  }

  function rentalPriceText(item) {
    var daily = dailyPriceCents(item);
    return daily === null ? text().onRequest : format(text().daily, { price: moneyFromCents(daily) });
  }

  function refreshRentalCards() {
    if (!catalog.length) return;
    Array.prototype.forEach.call(document.querySelectorAll("[data-rental]"), function (button) {
      var item = findItem(button.getAttribute("data-rental"));
      var plate = button.closest(".plate");
      var priceEl = plate && plate.querySelector(".plate__price");
      if (item && priceEl) priceEl.textContent = rentalPriceText(item);
    });
  }

  function ensureStatusEl() {
    var existing = document.getElementById("rentalCommerceStatus");
    if (existing) return existing;
    var errorEl = document.getElementById("rentalDateError");
    if (!errorEl || !errorEl.parentNode) return null;
    var el = document.createElement("p");
    el.id = "rentalCommerceStatus";
    el.className = "rental-modal__error hidden";
    errorEl.parentNode.insertBefore(el, errorEl.nextSibling);
    return el;
  }
  function clearStatus() {
    var el = ensureStatusEl();
    if (!el) return;
    el.textContent = "";
    el.classList.add("hidden");
  }
  function showStatus(message) {
    var el = ensureStatusEl();
    if (!el) return;
    el.textContent = message;
    el.classList.remove("hidden");
  }

  function applyQuoteToModal(item, quote) {
    var priceEl = document.querySelector("#rentalModalItem .rental-modal__item-price");
    if (priceEl && !priceEl.classList.contains("rental-modal__item-price--sold")) {
      if (quote.priceOnRequest || quote.dailyPriceCents === null) priceEl.textContent = text().onRequest;
      else priceEl.textContent = format(text().daily, { price: moneyFromCents(quote.dailyPriceCents) });
    }
    var daysEl = document.getElementById("rentalDaysText");
    if (!daysEl || !quote.days) return;
    if (quote.priceOnRequest || quote.totalPriceCents === null) {
      daysEl.textContent = format(text().totalOnRequest, { days: quote.days });
    } else {
      daysEl.textContent = format(text().total, { days: quote.days, total: moneyFromCents(quote.totalPriceCents) });
    }
  }

  var quoteRequestSerial = 0;
  function refreshCurrentQuote() {
    var backdrop = document.getElementById("rentalModalBackdrop");
    if (!backdrop || backdrop.classList.contains("hidden") || !currentItemId) return;
    var item = findItem(currentItemId);
    if (!item) return;
    var startEl = document.getElementById("rentalStart");
    var endEl = document.getElementById("rentalEnd");
    var start = startEl ? startEl.value : "";
    var end = endEl ? endEl.value : "";
    var local = localQuote(item, start, end);
    applyQuoteToModal(item, local);
    clearStatus();

    if (!SHOP_CONFIG.shopWorkerUrl || !local.days) return;
    var serial = ++quoteRequestSerial;
    fetch(String(SHOP_CONFIG.shopWorkerUrl).replace(/\/+$/, "") + "/rental-quote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId: currentItemId, start: start, end: end })
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (body) { return { ok: res.ok, status: res.status, body: body }; });
    }).then(function (result) {
      if (serial !== quoteRequestSerial) return;
      if (!result.ok) {
        if (result.body && result.body.error === "ITEM_UNAVAILABLE") showStatus(text().itemUnavailable);
        return;
      }
      var serverQuote = {
        days: Number(result.body.days) || local.days,
        dailyPriceCents: result.body.dailyPrice == null ? null : Math.round(Number(result.body.dailyPrice) * 100),
        totalPriceCents: result.body.totalPrice == null ? null : Math.round(Number(result.body.totalPrice) * 100),
        priceOnRequest: !!result.body.priceOnRequest
      };
      applyQuoteToModal(item, serverQuote);
    }).catch(function () {
      // Local 10% display remains available; the server stays authoritative once a request is submitted.
    });
  }

  function fmtDate(iso) {
    if (!iso) return "";
    var p = iso.split("-").map(Number);
    var date = new Date(p[0], p[1] - 1, p[2]);
    try {
      return date.toLocaleDateString(LOCALES[LANG] || "de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
    } catch (e) { return iso; }
  }

  function currentRequestBody() {
    var purpose = document.getElementById("rentalPurpose");
    var message = document.getElementById("rentalMessage");
    var start = document.getElementById("rentalStart");
    var end = document.getElementById("rentalEnd");
    return {
      itemId: currentItemId,
      start: start ? start.value : "",
      end: end ? end.value : "",
      purpose: purpose ? purpose.value : "other",
      message: message ? message.value.trim() : ""
    };
  }

  function buildRentalMessage(item, body) {
    var quote = localQuote(item, body.start, body.end);
    var purposeEl = document.getElementById("rentalPurpose");
    var selected = purposeEl && purposeEl.options[purposeEl.selectedIndex];
    var purposeText = selected ? selected.textContent : body.purpose;
    var itemLine = ((item.brand ? item.brand + " " : "") + (item.title || "")).trim() + " (Art.-Nr. " + (item.article || item.id) + ")";
    var priceLine = quote.priceOnRequest
      ? text().onRequest
      : moneyFromCents(quote.dailyPriceCents) + " / " + (LANG === "de" ? "Tag" : LANG === "fr" ? "jour" : "day") + " · " + moneyFromCents(quote.totalPriceCents) + " " + (LANG === "de" ? "gesamt" : LANG === "fr" ? "au total" : "total");
    var lines = [
      format(text().intro, { item: itemLine }),
      "",
      text().period + ": " + fmtDate(body.start) + " – " + fmtDate(body.end) + " (" + quote.days + ")",
      text().price + ": " + priceLine,
      text().purpose + ": " + purposeText
    ];
    if (body.message) lines.push(text().message + ": " + body.message);
    lines.push("");
    lines.push(text().closing);
    return lines.join("\n");
  }

  function fingerprint(body) {
    var str = JSON.stringify(body);
    var hash = 2166136261;
    for (var i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16);
  }
  function newIdempotencyKey() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") return "rental-ui:" + window.crypto.randomUUID();
    return "rental-ui:" + Date.now().toString(36) + ":" + Math.random().toString(36).slice(2, 18);
  }
  function idempotencyKeyFor(body) {
    var fp = fingerprint(body);
    var storageKey = "d119_rental_idempotency";
    try {
      var map = JSON.parse(window.sessionStorage.getItem(storageKey) || "{}");
      if (!map[fp]) {
        map[fp] = newIdempotencyKey();
        window.sessionStorage.setItem(storageKey, JSON.stringify(map));
      }
      return map[fp];
    } catch (e) {
      if (!idempotencyKeyFor.memory) idempotencyKeyFor.memory = {};
      if (!idempotencyKeyFor.memory[fp]) idempotencyKeyFor.memory[fp] = newIdempotencyKey();
      return idempotencyKeyFor.memory[fp];
    }
  }

  function reportRental(body) {
    if (!SHOP_CONFIG.shopWorkerUrl || !body.itemId) return;
    fetch(String(SHOP_CONFIG.shopWorkerUrl).replace(/\/+$/, "") + "/rental-request", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKeyFor(body)
      },
      body: JSON.stringify(body)
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (bodyJson) { return { ok: res.ok, status: res.status, body: bodyJson }; });
    }).then(function (result) {
      if (result.ok) { clearStatus(); return; }
      var code = result.body && result.body.error;
      if (code === "RENTAL_DATES_UNAVAILABLE") showStatus(text().unavailable);
      else if (code === "ITEM_UNAVAILABLE") showStatus(text().itemUnavailable);
      else showStatus(text().requestFailed);
    }).catch(function () { showStatus(text().requestFailed); });
  }

  function rewriteAndReportSubmit(anchor) {
    var item = findItem(currentItemId);
    var body = currentRequestBody();
    if (!item || !rentalDayCount(body.start, body.end)) return;
    var message = buildRentalMessage(item, body);
    var channel = anchor.getAttribute("data-rental-submit");
    if (channel === "email" && SHOP_CONFIG.email) {
      anchor.href = "mailto:" + SHOP_CONFIG.email + "?subject=" + encodeURIComponent(text().subject) + "&body=" + encodeURIComponent(message);
    } else if (channel === "whatsapp" && SHOP_CONFIG.whatsappNumber) {
      anchor.href = "https://wa.me/" + SHOP_CONFIG.whatsappNumber + "?text=" + encodeURIComponent(message);
    }
    reportRental(body);
  }

  function refreshRentalTerms() {
    if (!/(?:^|\/)mieten\/$/.test(window.location.pathname)) return;
    var panel = document.querySelector(".static-page .legal-panel");
    if (!panel) return;
    var h3 = panel.querySelector("h3");
    var list = panel.querySelector("ul");
    if (h3) h3.textContent = text().termsHeading;
    if (list) {
      var holder = document.createElement("div");
      holder.innerHTML = text().termsHtml;
      var replacement = holder.querySelector("ul");
      if (replacement) list.replaceWith(replacement);
    }
  }

  document.addEventListener("click", function (event) {
    var rentalButton = event.target.closest && event.target.closest("[data-rental]");
    if (rentalButton) setCurrentItem(rentalButton.getAttribute("data-rental"));

    var submit = event.target.closest && event.target.closest("[data-rental-submit]");
    if (submit) {
      // Stop the legacy app.js backend reporter: it predates the required
      // Idempotency-Key. The link's default mailto/WhatsApp action is not prevented.
      event.stopPropagation();
      rewriteAndReportSubmit(submit);
    }
  }, true);

  ["rentalStart", "rentalEnd"].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.addEventListener("change", function () { setTimeout(refreshCurrentQuote, 0); });
  });

  var rentalBackdrop = document.getElementById("rentalModalBackdrop");
  if (rentalBackdrop && typeof MutationObserver !== "undefined") {
    new MutationObserver(function () { setTimeout(refreshCurrentQuote, 0); }).observe(rentalBackdrop, { attributes: true, attributeFilter: ["class"] });
  }
  var grid = document.getElementById("grid");
  if (grid && typeof MutationObserver !== "undefined") {
    new MutationObserver(function () { refreshRentalCards(); }).observe(grid, { childList: true });
  }

  refreshRentalTerms();
})();

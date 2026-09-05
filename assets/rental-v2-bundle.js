/* Disorder119 Rental V2 atomic bundle bridge.
   When a production Worker is configured, one multi-piece request is persisted
   as one server-side rental group. The customer-facing email/WhatsApp action
   still opens normally. */
(function () {
  "use strict";

  var SHOP_CONFIG = window.SHOP_CONFIG || {};
  var STORAGE_KEY = "d119_rental_cart_v2";
  var RECEIPT_KEY = "d119_rental_bundle_receipts";
  var TERMS_VERSION = "rental-2026-09-05-v2";
  var LANG_MATCH = /^\/(en|fr)(?:\/|$)/.exec(window.location.pathname);
  var LANG = LANG_MATCH ? LANG_MATCH[1] : "de";
  var TEXT = {
    de: { saving: "Mietanfrage wird sicher gespeichert …", saved: "Mietanfrage als gemeinsamer Vorgang gespeichert.", failed: "Die Server-Speicherung ist fehlgeschlagen; deine E-Mail-Anfrage kann trotzdem gesendet werden." },
    en: { saving: "Saving rental request securely …", saved: "Rental request saved as one combined booking.", failed: "Server saving failed; you can still send the e-mail request." },
    fr: { saving: "Enregistrement sécurisé de la demande …", saved: "Demande enregistrée comme une location groupée.", failed: "L’enregistrement serveur a échoué ; la demande par e-mail peut tout de même être envoyée." }
  };

  function t(key) { return (TEXT[LANG] || TEXT.de)[key]; }
  function loadState() {
    try {
      var value = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      return value && Array.isArray(value.ids) ? value : null;
    } catch (e) { return null; }
  }
  function stableHash(value) {
    var str = JSON.stringify(value), hash = 2166136261;
    for (var i = 0; i < str.length; i++) { hash ^= str.charCodeAt(i); hash = Math.imul(hash, 16777619); }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }
  function showToast(message) {
    var old = document.getElementById("d119RentalToast");
    if (old) old.remove();
    var el = document.createElement("div");
    el.id = "d119RentalToast";
    el.className = "d119-rental-toast";
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(function () { if (el.parentNode) el.remove(); }, 2200);
  }
  function acceptanceTimestamp(hash) {
    var key = "d119_rental_bundle_acceptance:" + hash;
    try {
      var existing = localStorage.getItem(key);
      if (existing) return existing;
      var created = new Date().toISOString();
      localStorage.setItem(key, created);
      return created;
    } catch (e) { return new Date().toISOString(); }
  }
  function saveReceipt(data, payload) {
    try {
      var list = JSON.parse(localStorage.getItem(RECEIPT_KEY) || "[]");
      if (!Array.isArray(list)) list = [];
      list.push({
        rentalGroupId: data.rentalGroupId || null,
        savedAt: new Date().toISOString(),
        expiresAt: data.expiresAt || null,
        itemIds: payload.itemIds,
        start: payload.start,
        end: payload.end,
        rentalTotalCents: data.rentalTotalCents == null ? null : data.rentalTotalCents,
        depositTotalCents: data.depositTotalCents == null ? null : data.depositTotalCents,
        termsVersion: payload.termsVersion,
        termsAcceptedAt: payload.termsAcceptedAt
      });
      localStorage.setItem(RECEIPT_KEY, JSON.stringify(list.slice(-30)));
    } catch (e) {}
  }
  function validState(state) {
    return state && state.termsAccepted && Array.isArray(state.ids) && state.ids.length > 0 && state.ids.length <= 20 &&
      /^\d{4}-\d{2}-\d{2}$/.test(String(state.start || "")) && /^\d{4}-\d{2}-\d{2}$/.test(String(state.end || ""));
  }
  function payloadFromState(state) {
    var base = {
      itemIds: state.ids.map(Number),
      start: state.start,
      end: state.end,
      purpose: state.purpose || "other",
      delivery: state.delivery || "shipping",
      postal: state.postal || "",
      risk: state.risk || "",
      message: state.message || "",
      termsVersion: TERMS_VERSION,
      termsLanguage: LANG
    };
    var hash = stableHash(base);
    base.termsAcceptedAt = acceptanceTimestamp(hash);
    return { payload: base, hash: hash };
  }
  function sendBundle(state) {
    var configured = String(SHOP_CONFIG.shopWorkerUrl || "").replace(/\/+$/, "");
    if (!configured || !validState(state)) return;
    var prepared = payloadFromState(state);
    var key = "rental-bundle-v1:" + prepared.hash;
    showToast(t("saving"));
    fetch(configured + "/rental-bundle", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": key },
      body: JSON.stringify(prepared.payload),
      keepalive: true
    }).then(function (res) {
      return res.text().then(function (raw) {
        var data = {};
        try { data = raw ? JSON.parse(raw) : {}; } catch (e) {}
        if (!res.ok) throw new Error(data.error || ("HTTP " + res.status));
        saveReceipt(data, prepared.payload);
        showToast(t("saved"));
      });
    }).catch(function () {
      showToast(t("failed"));
    });
  }

  document.addEventListener("click", function (event) {
    var link = event.target.closest && event.target.closest("[data-d119-rental-send]");
    if (!link || link.getAttribute("aria-disabled") === "true" || !SHOP_CONFIG.shopWorkerUrl) return;
    var state = loadState();
    if (!validState(state)) return;

    // Stop Rental V2's legacy per-item /rental-request reporter. We deliberately
    // do not preventDefault(), so the already prepared mailto/WhatsApp link keeps
    // working for the customer while one atomic server bundle is saved.
    event.stopImmediatePropagation();
    sendBundle(state);
  }, true);
})();

(function () {
  "use strict";

  if (window.__D119_SHOP_PROMOS__) return;
  window.__D119_SHOP_PROMOS__ = true;

  var CODE_KEY = "d119_coupon_code";
  var REWARD_KEY = "d119_reward_coupon";
  var observer = null;
  var nativeFetch = window.fetch.bind(window);

  function shopConfig() { return window.SHOP_CONFIG || window.ARTICLE_SHOP_CONFIG || {}; }
  function apiBase() { return String(shopConfig().shopWorkerUrl || window.D119_GAME_API || "").replace(/\/$/, ""); }
  function codeValue() {
    try { return String(localStorage.getItem(CODE_KEY) || "").trim().toUpperCase().slice(0, 40); }
    catch (_) { return ""; }
  }
  function earnedReward() {
    try {
      var raw = JSON.parse(localStorage.getItem(REWARD_KEY) || "null");
      return raw && raw.code ? raw : null;
    } catch (_) { return null; }
  }
  function cleanCode(code) {
    return String(code || "").trim().toUpperCase().replace(/\s+/g, "").slice(0, 40);
  }
  function saveCode(code) {
    var clean = cleanCode(code);
    try {
      if (clean) localStorage.setItem(CODE_KEY, clean);
      else localStorage.removeItem(CODE_KEY);
    } catch (_) {}
    return clean;
  }
  // Ein eingeloester oder endgueltig abgelehnter Code darf nicht im Browser
  // bleiben: Der Fetch-Wrapper unten haengt ihn sonst an jede weitere
  // Bestellung, und der Server lehnt jede davon mit COUPON_INVALID_OR_USED ab
  // (unbekannt, eingeloest oder gesperrt). Der Spielcode faellt mit weg, wenn
  // es derselbe Code ist - sonst schriebe couponForm ihn beim naechsten Oeffnen
  // des Warenkorbs zurueck. Ein anderer, noch unbenutzter Spielcode bleibt
  // erhalten. COUPON_RESERVED (eine offene Bestellung haelt den Code noch, er
  // wird danach wieder frei) loescht nichts - oft ist es die einzige Kopie.
  function forgetCode(code) {
    var used = cleanCode(code);
    if (!used) return;
    try {
      if (cleanCode(localStorage.getItem(CODE_KEY)) === used) localStorage.removeItem(CODE_KEY);
      var reward = earnedReward();
      if (reward && cleanCode(reward.code) === used) localStorage.removeItem(REWARD_KEY);
    } catch (_) {}
  }
  function language() {
    var value = String(document.documentElement.lang || "de").toLowerCase();
    return value.indexOf("fr") === 0 ? "fr" : value.indexOf("en") === 0 ? "en" : "de";
  }
  function copy() {
    var all = {
      de: { label: "GUTSCHEINCODE", placeholder: "Code eingeben", apply: "PRÜFEN", valid: "10 % Rabatt aktiv", invalid: "Code ist nicht gültig oder bereits benutzt.", preview: "10 % vorgemerkt · wird beim Checkout serverseitig geprüft.", offline: "Code gespeichert · Prüfung erfolgt beim Checkout.", artikel: "{label} für {preis} € – der Code gilt nur für dieses Teil.", artikelFehlt: "Der Code gilt nur für {label} – leg das Teil in den Warenkorb.", zeile: "Gutschein {code}" },
      en: { label: "COUPON CODE", placeholder: "Enter code", apply: "APPLY", valid: "10% discount active", invalid: "Code is invalid or has already been used.", preview: "10% queued · server validation happens at checkout.", offline: "Code saved · validation happens at checkout.", artikel: "{label} for €{preis} – this code is valid for this piece only.", artikelFehlt: "This code is only valid for {label} – add that piece to your cart.", zeile: "Coupon {code}" },
      fr: { label: "CODE PROMO", placeholder: "Saisir le code", apply: "VÉRIFIER", valid: "Réduction de 10 % active", invalid: "Code invalide ou déjà utilisé.", preview: "10 % enregistré · validation serveur au paiement.", offline: "Code enregistré · validation au paiement.", artikel: "{label} à {preis} € – ce code est valable uniquement pour cette pièce.", artikelFehlt: "Ce code n'est valable que pour {label} – ajoute cette pièce au panier.", zeile: "Bon {code}" }
    };
    return all[language()];
  }

  async function validateCoupon(code) {
    var base = apiBase();
    if (!base) {
      var reward = earnedReward();
      if (reward && String(reward.code || "").toUpperCase() === code) return { valid: true, preview: !reward.server, discountPercent: 10 };
      return { valid: null };
    }
    try {
      var response = await nativeFetch(base + "/coupons/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code }),
        credentials: "omit"
      });
      var data = await response.json().catch(function () { return {}; });
      if (!response.ok) return { valid: false };
      return data;
    } catch (_) {
      return { valid: null };
    }
  }

  // Artikel-Code (Festpreis fuer genau ein Stueck): Name und Preis vom Server.
  function artikelText(c, result) {
    var cents = Number(result.fixedPriceCents) || 0;
    var preis = cents % 100 ? (cents / 100).toFixed(2) : String(cents / 100);
    if (language() !== "en") preis = preis.replace(".", ",");
    return c.artikel.replace("{label}", String(result.itemLabel || "").trim() || "1 Teil").replace("{preis}", preis);
  }

  function setStatus(form, kind, text) {
    var status = form && form.querySelector("[data-coupon-status]");
    if (!status) return;
    status.className = "d119-coupon__status" + (kind ? " is-" + kind : "");
    status.textContent = text || "";
  }

  async function apply(form) {
    var input = form.querySelector("input");
    var button = form.querySelector("button");
    var code = saveCode(input.value);
    input.value = code;
    if (!code) { setStatus(form, "", ""); return; }
    button.disabled = true;
    var c = copy();
    setStatus(form, "pending", "…");
    var result = await validateCoupon(code);
    button.disabled = false;
    bestaetigt = result.valid === true ? Object.assign({ code: code }, result) : null;
    if (result.valid === true && result.fixedPriceCents) setStatus(form, "valid", artikelText(c, result));
    else if (result.valid === true) setStatus(form, "valid", result.preview ? c.preview : c.valid);
    else if (result.valid === false) setStatus(form, "invalid", c.invalid);
    else setStatus(form, "saved", c.offline);
    abzugZeigen();
  }

  // ---- Abzug sofort im Warenkorb: Zeile "Gutschein CODE  − 50,00 €" unter dem
  //      Codefeld, Gesamtbetrag (Fuss und Kassenleiste) entsprechend gesenkt.
  //      Verbindlich rechnet nur der Worker beim Anlegen der Bestellung.
  //      app.js zeichnet den Warenkorb bei jeder Aenderung neu (Observer unten).
  var bestaetigt = null;
  function euroCents(text) {
    var roh = String(text || "").replace(/[^\d,.]/g, "");
    if (!/\d/.test(roh)) return NaN;
    var wert = Number(roh.replace(/\./g, "").replace(",", "."));
    return isFinite(wert) ? Math.round(wert * 100) : NaN;
  }
  function euroText(cents) {   // wie fmtPrice in app.js: immer de-DE
    return (cents / 100).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
  }
  function warenkorbPreise() {
    var body = document.getElementById("cartBody");
    if (!body) return [];
    return Array.prototype.map.call(body.querySelectorAll("[data-remove]"), function (knopf) {
      var zeile = knopf.closest(".cart-line");
      var preis = zeile && zeile.querySelector(".cart-line__price");
      return { id: Number(knopf.getAttribute("data-remove")), cents: euroCents(preis && preis.textContent) };
    });
  }
  function rabattCents() {
    if (!bestaetigt || bestaetigt.code !== codeValue()) return 0;
    var preise = warenkorbPreise();
    if (bestaetigt.fixedPriceCents) {
      var stueck = preise.filter(function (p) { return p.id === Number(bestaetigt.itemId); })[0];
      return stueck && isFinite(stueck.cents) ? Math.max(0, stueck.cents - Number(bestaetigt.fixedPriceCents)) : 0;
    }
    var prozent = Number(bestaetigt.discountPercent) || 0;
    if (!prozent || preise.some(function (p) { return !isFinite(p.cents); })) return 0;
    var summe = preise.reduce(function (s, p) { return s + p.cents; }, 0);
    return Math.min(summe, Math.round(summe * prozent / 100));
  }
  // Betrag in einem von app.js gezeichneten Feld senken (oder zuruecksetzen);
  // der Ausgangswert bleibt am Element, damit nie doppelt abgezogen wird.
  function betragSetzen(feld, rabatt) {
    if (!feld) return;
    var jetzt = feld.textContent;
    var basis = feld.getAttribute("data-d119-neu") === jetzt ? feld.getAttribute("data-d119-basis") : jetzt;
    var cents = euroCents(basis);
    var neu = rabatt > 0 && isFinite(cents) ? euroText(Math.max(0, cents - rabatt)) : basis;
    feld.setAttribute("data-d119-basis", basis);
    feld.setAttribute("data-d119-neu", neu);
    if (jetzt !== neu) feld.textContent = neu;
  }
  function abzugZeigen() {
    var foot = document.getElementById("cartFoot");
    if (!foot) return;
    var form = foot.querySelector("[data-d119-coupon]");
    var rabatt = rabattCents();
    var c = copy();
    if (form && bestaetigt && bestaetigt.fixedPriceCents && bestaetigt.code === codeValue()) {
      setStatus(form, rabatt > 0 ? "valid" : "saved", rabatt > 0 ? artikelText(c, bestaetigt)
        : c.artikelFehlt.replace("{label}", String(bestaetigt.itemLabel || "").trim() || "1"));
    }
    var zeile = foot.querySelector(".d119-coupon-abzug");
    var wert = rabatt > 0 ? "− " + euroText(rabatt) : "";
    if (!wert && zeile) zeile.remove();
    if (wert && form && (!zeile || zeile.getAttribute("data-wert") !== wert + bestaetigt.code)) {
      if (zeile) zeile.remove();
      zeile = document.createElement("div");
      zeile.className = "cart-total cart-total--line d119-coupon-abzug";
      zeile.setAttribute("data-wert", wert + bestaetigt.code);
      var name = document.createElement("span");
      name.textContent = c.zeile.replace("{code}", bestaetigt.code);
      var betrag = document.createElement("span");
      betrag.textContent = wert;
      zeile.appendChild(name);
      zeile.appendChild(betrag);
      form.insertAdjacentElement("afterend", zeile);
    }
    var gesamt = foot.querySelectorAll(".cart-total:not(.cart-total--line)");
    if (gesamt.length) betragSetzen(gesamt[gesamt.length - 1].lastElementChild, rabatt);
    var kasse = document.querySelector("#cartKasse .cart-kasse__summe strong");
    betragSetzen(kasse, rabatt);
  }

  function couponForm() {
    var c = copy();
    var form = document.createElement("form");
    form.className = "d119-coupon";
    form.setAttribute("data-d119-coupon", "");
    form.innerHTML = '<label><span>' + c.label + '</span><div class="d119-coupon__row"><input type="text" inputmode="text" autocomplete="off" maxlength="40" placeholder="' + c.placeholder + '" aria-label="' + c.label + '"><button type="submit">' + c.apply + '</button></div></label><p class="d119-coupon__status" data-coupon-status aria-live="polite"></p>';
    var existing = codeValue();
    var reward = earnedReward();
    if (!existing && reward && reward.code) existing = saveCode(reward.code);
    form.querySelector("input").value = existing;
    form.addEventListener("submit", function (event) { event.preventDefault(); apply(form); });
    if (existing) window.setTimeout(function () { apply(form); }, 20);
    return form;
  }

  function installCouponField() {
    var foot = document.getElementById("cartFoot");
    if (!foot || !foot.children.length || foot.querySelector("[data-d119-coupon]")) return;
    var total = foot.querySelector(".cart-total");
    var form = couponForm();
    if (total && total.nextSibling) foot.insertBefore(form, total.nextSibling);
    else if (total) total.insertAdjacentElement("afterend", form);
    else foot.insertBefore(form, foot.firstChild);
  }

  function observeCart() {
    var foot = document.getElementById("cartFoot");
    if (!foot) return;
    installCouponField();
    if (observer) observer.disconnect();
    observer = new MutationObserver(function () { installCouponField(); abzugZeigen(); });
    observer.observe(foot, { childList: true });
    var kasse = document.getElementById("cartKasse");
    if (kasse && !kasse.__d119Abzug) {
      kasse.__d119Abzug = true;
      new MutationObserver(function () { abzugZeigen(); }).observe(kasse, { childList: true });
    }
  }

  function appendCouponToInquiry(anchor) {
    var code = codeValue();
    if (!code || !anchor || !anchor.href) return;
    try {
      var url = new URL(anchor.href);
      var type = anchor.getAttribute("data-cart-inquiry");
      var key = type === "whatsapp" ? "text" : "body";
      var body = url.searchParams.get(key) || "";
      var line = "Gutscheincode: " + code;
      if (body.indexOf(line) === -1) url.searchParams.set(key, body + (body ? "\n\n" : "") + line);
      anchor.href = url.toString();
    } catch (_) {}
  }

  document.addEventListener("click", function (event) {
    var anchor = event.target && event.target.closest ? event.target.closest("[data-cart-inquiry]") : null;
    if (anchor) appendCouponToInquiry(anchor);
  }, true);

  document.addEventListener("d119:coupon-earned", function (event) {
    var code = event && event.detail ? event.detail.code : "";
    if (!code) return;
    saveCode(code);
    var form = document.querySelector("[data-d119-coupon]");
    if (form) {
      form.querySelector("input").value = code;
      apply(form);
    }
  });

  // Future direct checkout path: coupon value is forwarded, while the Worker
  // remains the only authority allowed to calculate a discount.
  window.fetch = function (input, init) {
    var target = typeof input === "string" ? input : (input && input.url ? input.url : "");
    var code = codeValue();
    // Bezahlt: der mitgeschickte Code ist jetzt eingeloest.
    if (code && target && /\/capture-order(?:\?|$)/.test(target)) {
      return nativeFetch(input, init).then(function (response) {
        if (response && response.ok) forgetCode(code);
        return response;
      });
    }
    if (!code || !target || !/\/create-order(?:\?|$)/.test(target) || !init || typeof init.body !== "string") {
      return nativeFetch(input, init);
    }
    try {
      var payload = JSON.parse(init.body);
      if (payload && typeof payload === "object" && !Array.isArray(payload)) {
        payload.couponCode = code;
        init = Object.assign({}, init, { body: JSON.stringify(payload) });
      }
    } catch (_) {}
    // Endgueltig abgelehnt (ungueltig oder schon eingeloest): vergessen, bevor
    // die Kasse die Antwort sieht - der naechste Versuch geht dann ohne Code.
    // Nur voruebergehend belegt (COUPON_RESERVED): Code behalten.
    return nativeFetch(input, init).then(function (response) {
      if (!response || response.ok || typeof response.clone !== "function") return response;
      return response.clone().json().then(function (data) {
        // COUPON_NOT_FOR_ORDER: Artikel-Code, aber das Stueck ist nicht in der Bestellung.
        if (data && (data.error === "COUPON_INVALID_OR_USED" || data.error === "COUPON_NOT_FOR_ORDER")) forgetCode(code);
        return response;
      }, function () { return response; });
    });
  };

  function boot() {
    observeCart();
    // Cart HTML can be created after catalogue data finishes loading.
    var rootObserver = new MutationObserver(function () {
      if (document.getElementById("cartFoot")) observeCart();
    });
    rootObserver.observe(document.documentElement, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
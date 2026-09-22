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
  function saveCode(code) {
    var clean = String(code || "").trim().toUpperCase().replace(/\s+/g, "").slice(0, 40);
    try {
      if (clean) localStorage.setItem(CODE_KEY, clean);
      else localStorage.removeItem(CODE_KEY);
    } catch (_) {}
    return clean;
  }
  function language() {
    var value = String(document.documentElement.lang || "de").toLowerCase();
    return value.indexOf("fr") === 0 ? "fr" : value.indexOf("en") === 0 ? "en" : "de";
  }
  function copy() {
    var all = {
      de: { label: "GUTSCHEINCODE", placeholder: "Code eingeben", apply: "PRÜFEN", valid: "10 % Rabatt aktiv", invalid: "Code ist nicht gültig oder bereits benutzt.", preview: "10 % vorgemerkt · wird beim Checkout serverseitig geprüft.", offline: "Code gespeichert · Prüfung erfolgt beim Checkout." },
      en: { label: "COUPON CODE", placeholder: "Enter code", apply: "APPLY", valid: "10% discount active", invalid: "Code is invalid or has already been used.", preview: "10% queued · server validation happens at checkout.", offline: "Code saved · validation happens at checkout." },
      fr: { label: "CODE PROMO", placeholder: "Saisir le code", apply: "VÉRIFIER", valid: "Réduction de 10 % active", invalid: "Code invalide ou déjà utilisé.", preview: "10 % enregistré · validation serveur au paiement.", offline: "Code enregistré · validation au paiement." }
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
    if (result.valid === true) setStatus(form, "valid", result.preview ? c.preview : c.valid);
    else if (result.valid === false) setStatus(form, "invalid", c.invalid);
    else setStatus(form, "saved", c.offline);
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
    observer = new MutationObserver(function () { installCouponField(); });
    observer.observe(foot, { childList: true });
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
    return nativeFetch(input, init);
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
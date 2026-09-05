/* Disorder119 Rental V2 UI enhancement.
   Adds an explicit multi-piece picker and visual rental-set rail on /mieten/.
   Kept separate from the protected creative views. */
(function () {
  "use strict";

  var STORAGE_KEY = "d119_rental_cart_v2";
  var LANG_MATCH = /^\/(en|fr)(?:\/|$)/.exec(window.location.pathname);
  var LANG = LANG_MATCH ? LANG_MATCH[1] : "de";
  var TEXT = {
    de: {
      addMore: "Weiteres Piece hinzufügen",
      addMoreShort: "Mehr",
      setTitle: "Deine Mietauswahl",
      setHint: "Mehrere Pieces gemeinsam anfragen",
      selected: "{count} ausgewählt",
      browseHint: "Wähle weitere Pieces aus dem Mietkatalog.",
      cardAdd: "Zur Mietauswahl hinzufügen",
      cardAdded: "In deiner Mietauswahl"
    },
    en: {
      addMore: "Add another piece",
      addMoreShort: "More",
      setTitle: "Your rental selection",
      setHint: "Request several pieces together",
      selected: "{count} selected",
      browseHint: "Choose more pieces from the rental catalogue.",
      cardAdd: "Add to rental selection",
      cardAdded: "In your rental selection"
    },
    fr: {
      addMore: "Ajouter une autre pièce",
      addMoreShort: "Plus",
      setTitle: "Votre sélection de location",
      setHint: "Demander plusieurs pièces ensemble",
      selected: "{count} sélectionné(s)",
      browseHint: "Choisissez d’autres pièces dans le catalogue de location.",
      cardAdd: "Ajouter à la sélection de location",
      cardAdded: "Dans votre sélection de location"
    }
  };

  var catalogMap = {};
  var scheduled = false;

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
  function isRentalPage() {
    return /(?:^|\/)mieten\/$/.test(window.location.pathname);
  }
  function loadIds() {
    try {
      var state = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (!state || !Array.isArray(state.ids)) return [];
      return state.ids.map(Number).filter(function (id) { return Number.isFinite(id) && id > 0; }).slice(0, 20);
    } catch (e) { return []; }
  }
  function firstImage(item) {
    var raw = item && item.gallery && item.gallery[0] ? String(item.gallery[0]) : "assets/favicon.png";
    return "/" + raw.replace(/^\//, "");
  }
  function itemTitle(item) {
    if (!item) return "";
    return ((item.brand ? item.brand + " " : "") + (item.title || "")).trim();
  }

  function injectStyles() {
    if (document.getElementById("d119RentalV2UiStyles")) return;
    var style = document.createElement("style");
    style.id = "d119RentalV2UiStyles";
    style.textContent = [
      ".d119-rental-v2-backdrop{--d119-rental-drawer:620px}",
      ".d119-rental-set-strip{display:flex;gap:10px;align-items:stretch;overflow-x:auto;padding:14px 0 16px;border-bottom:1px solid var(--line,#bbb);scrollbar-width:thin}",
      ".d119-rental-set-copy{min-width:138px;max-width:160px;display:flex;flex-direction:column;justify-content:center;padding-right:6px}",
      ".d119-rental-set-copy strong{font-size:12px;line-height:1.25}",
      ".d119-rental-set-copy span{font-size:10px;line-height:1.35;opacity:.62;margin-top:4px}",
      ".d119-rental-set-add{appearance:none;flex:0 0 64px;height:82px;border:1px dashed currentColor;background:transparent;color:inherit;display:grid;place-items:center;align-content:center;gap:5px;cursor:pointer;font:inherit;padding:4px}",
      ".d119-rental-set-add__plus{display:grid;place-items:center;width:34px;height:34px;border:1px solid currentColor;border-radius:50%;font-size:25px;line-height:1;font-weight:300}",
      ".d119-rental-set-add__label{font-size:9px;line-height:1.1;text-transform:uppercase;letter-spacing:.06em}",
      ".d119-rental-set-thumb{appearance:none;flex:0 0 58px;height:82px;border:1px solid var(--line,#bbb);background:transparent;color:inherit;padding:0;cursor:pointer;position:relative;overflow:hidden}",
      ".d119-rental-set-thumb img{display:block;width:100%;height:100%;object-fit:cover}",
      ".d119-rental-set-thumb span{position:absolute;left:3px;right:3px;bottom:3px;background:rgba(0,0,0,.72);color:#fff;font-size:8px;line-height:1.1;padding:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
      ".d119-rental-add-side{position:fixed;right:638px;top:118px;z-index:123;width:64px;min-height:78px;border:1px solid #fff;background:#111;color:#fff;display:grid;place-items:center;align-content:center;gap:6px;cursor:pointer;font:inherit;padding:8px 5px}",
      ".d119-rental-add-side__plus{display:grid;place-items:center;width:38px;height:38px;border:1px solid #fff;border-radius:50%;font-size:28px;line-height:1;font-weight:300}",
      ".d119-rental-add-side__label{font-size:9px;line-height:1.15;text-align:center;text-transform:uppercase;letter-spacing:.05em}",
      ".d119-rental-add-inline{appearance:none;width:100%;border:1px dashed currentColor;background:transparent;color:inherit;padding:13px 14px;margin-top:12px;display:flex;align-items:center;gap:11px;cursor:pointer;font:inherit;text-align:left}",
      ".d119-rental-add-inline__plus{display:grid;place-items:center;flex:0 0 36px;width:36px;height:36px;border:1px solid currentColor;border-radius:50%;font-size:26px;line-height:1}",
      ".d119-rental-add-inline__copy strong{display:block;font-size:12px}",
      ".d119-rental-add-inline__copy span{display:block;font-size:10px;opacity:.62;margin-top:2px}",
      ".d119-rental-card-add{display:flex!important;align-items:center;justify-content:center;gap:7px}",
      ".d119-rental-card-add:before{content:'+';display:grid;place-items:center;width:20px;height:20px;border:1px solid currentColor;border-radius:50%;font-size:17px;line-height:1;flex:0 0 20px}",
      ".d119-rental-card-add[aria-pressed='true']:before{content:'✓';font-size:11px}",
      ".d119-rental-picking .plate__rental-btn{outline:1px solid currentColor;outline-offset:3px}",
      ".d119-rental-item{border:1px solid var(--line,#bbb);padding:9px}",
      ".d119-rental-summary__row--total{padding:13px 0 2px}",
      "@media(max-width:760px){.d119-rental-add-side{display:none}.d119-rental-set-copy{min-width:112px}.d119-rental-set-strip{margin-left:-2px;margin-right:-2px}.d119-rental-set-add{flex-basis:58px}.d119-rental-set-thumb{flex-basis:54px}.d119-rental-item{grid-template-columns:62px 1fr auto}.d119-rental-item img{width:62px;height:82px}}"
    ].join("");
    document.head.appendChild(style);
  }

  function closeOverlayAndBrowse() {
    var backdrop = document.getElementById("d119RentalV2Backdrop");
    if (backdrop) backdrop.classList.remove("open");
    document.documentElement.style.overflow = "";
    document.body.classList.add("d119-rental-picking");
    var grid = document.getElementById("grid") || document.querySelector(".grid-wrap");
    if (grid) {
      try { grid.scrollIntoView({ behavior: "smooth", block: "start" }); }
      catch (e) { grid.scrollIntoView(); }
    }
    window.setTimeout(function () { document.body.classList.remove("d119-rental-picking"); }, 2400);
  }

  function enhanceCardButtons() {
    Array.prototype.forEach.call(document.querySelectorAll("[data-rental]"), function (btn) {
      btn.classList.add("d119-rental-card-add");
      var active = btn.getAttribute("aria-pressed") === "true";
      btn.setAttribute("aria-label", active ? t("cardAdded") : t("cardAdd"));
    });
  }

  function ensureSideAdd(backdrop) {
    var ids = loadIds();
    var existing = document.getElementById("d119RentalAddSide");
    if (!ids.length) {
      if (existing) existing.remove();
      return;
    }
    if (existing) return;
    var btn = document.createElement("button");
    btn.type = "button";
    btn.id = "d119RentalAddSide";
    btn.className = "d119-rental-add-side";
    btn.setAttribute("aria-label", t("addMore"));
    btn.innerHTML = '<span class="d119-rental-add-side__plus" aria-hidden="true">+</span><span class="d119-rental-add-side__label">' + esc(t("addMoreShort")) + '</span>';
    btn.addEventListener("click", closeOverlayAndBrowse);
    backdrop.appendChild(btn);
  }

  function ensureSelectionStrip(backdrop) {
    var drawer = backdrop.querySelector(".d119-rental-v2");
    var head = drawer && drawer.querySelector(".d119-rental-v2__head");
    if (!drawer || !head) return;
    var ids = loadIds();
    var signature = ids.join(",");
    var strip = drawer.querySelector("#d119RentalSetStrip");
    if (!ids.length) {
      if (strip) strip.remove();
      return;
    }
    if (!strip) {
      strip = document.createElement("div");
      strip.id = "d119RentalSetStrip";
      strip.className = "d119-rental-set-strip";
      head.insertAdjacentElement("afterend", strip);
    }
    if (strip.getAttribute("data-signature") === signature) return;
    strip.setAttribute("data-signature", signature);

    var html = '<div class="d119-rental-set-copy"><strong>' + esc(t("setTitle")) + '</strong><span>' + esc(fmt(t("selected"), { count: ids.length })) + '<br>' + esc(t("setHint")) + '</span></div>' +
      '<button type="button" class="d119-rental-set-add" id="d119RentalStripAdd" aria-label="' + esc(t("addMore")) + '"><span class="d119-rental-set-add__plus" aria-hidden="true">+</span><span class="d119-rental-set-add__label">' + esc(t("addMoreShort")) + '</span></button>';
    ids.forEach(function (id) {
      var item = catalogMap[id];
      if (!item) return;
      var title = itemTitle(item);
      html += '<button type="button" class="d119-rental-set-thumb" data-d119-rental-jump="' + id + '" aria-label="' + esc(title) + '"><img src="' + esc(firstImage(item)) + '" alt=""><span>' + esc(item.brand || item.title || ("#" + id)) + '</span></button>';
    });
    strip.innerHTML = html;
    var add = strip.querySelector("#d119RentalStripAdd");
    if (add) add.addEventListener("click", closeOverlayAndBrowse);
    Array.prototype.forEach.call(strip.querySelectorAll("[data-d119-rental-jump]"), function (btn) {
      btn.addEventListener("click", function () {
        var target = backdrop.querySelector('[data-rental-v2-item="' + btn.getAttribute("data-d119-rental-jump") + '"]');
        if (target) target.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    });
  }

  function ensureInlineAdd(backdrop) {
    var items = backdrop.querySelector(".d119-rental-v2__items");
    if (!items || !items.parentNode || document.getElementById("d119RentalAddInline")) return;
    var btn = document.createElement("button");
    btn.type = "button";
    btn.id = "d119RentalAddInline";
    btn.className = "d119-rental-add-inline";
    btn.innerHTML = '<span class="d119-rental-add-inline__plus" aria-hidden="true">+</span><span class="d119-rental-add-inline__copy"><strong>' + esc(t("addMore")) + '</strong><span>' + esc(t("browseHint")) + '</span></span>';
    btn.addEventListener("click", closeOverlayAndBrowse);
    items.insertAdjacentElement("afterend", btn);
  }

  function enhanceOverlay() {
    var backdrop = document.getElementById("d119RentalV2Backdrop");
    if (!backdrop) return;
    ensureSideAdd(backdrop);
    ensureSelectionStrip(backdrop);
    ensureInlineAdd(backdrop);
  }

  function scheduleEnhance() {
    if (scheduled) return;
    scheduled = true;
    window.requestAnimationFrame(function () {
      scheduled = false;
      enhanceCardButtons();
      enhanceOverlay();
    });
  }

  function observeUi() {
    if (typeof MutationObserver === "undefined") return;
    new MutationObserver(scheduleEnhance).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-pressed", "class"] });
  }

  function bootstrap() {
    if (!isRentalPage()) return;
    injectStyles();
    observeUi();
    fetch("/data/catalog.json", { credentials: "same-origin" })
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (items) {
        if (Array.isArray(items)) items.forEach(function (item) { catalogMap[Number(item.id)] = item; });
        scheduleEnhance();
      })
      .catch(function () { scheduleEnhance(); });
    scheduleEnhance();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bootstrap, { once: true });
  else bootstrap();
})();

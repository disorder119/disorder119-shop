/* Disorder119 Rental V2 integrated piece picker.
   Opens inside the rental drawer so customers can add several archive pieces
   without leaving the request flow. Intentionally isolated from protected modes. */
(function () {
  "use strict";

  var STORAGE_KEY = "d119_rental_cart_v2";
  var RENTAL_RATE_BPS = 1000;
  var LANG_MATCH = /^\/(en|fr)(?:\/|$)/.exec(window.location.pathname);
  var LANG = LANG_MATCH ? LANG_MATCH[1] : "de";
  var LOCALE = { de: "de-DE", en: "en-GB", fr: "fr-FR" }[LANG] || "de-DE";
  var RENTAL_PATH = LANG === "de" ? "/mieten/" : "/" + LANG + "/mieten/";
  var catalog = [];
  var activeCategory = "all";
  var query = "";
  var picker = null;
  var previousFocus = null;

  var TEXT = {
    de: {
      title: "Weiteres Piece hinzufügen",
      subtitle: "Wähle mehrere Pieces direkt hier aus. Deine bisherige Mietanfrage bleibt erhalten.",
      close: "Zurück zur Mietanfrage",
      search: "Marke, Artikel oder Artikelnummer suchen …",
      all: "Alle",
      selected: "Ausgewählt",
      add: "Hinzufügen",
      added: "Ausgewählt ✓",
      remove: "Entfernen",
      daily: "{price} / Tag",
      onRequest: "Preis auf Anfrage",
      size: "Größe {size}",
      empty: "Keine passenden Pieces gefunden.",
      limit: "Maximal 20 Pieces pro Mietanfrage.",
      count: "{count} Piece(s) in deiner Mietauswahl",
      hint: "Mietpreis: exakt 10 % des Verkaufspreises pro Kalendertag. Die Kaution wird im nächsten Schritt automatisch berechnet.",
      unavailable: "Dieses Piece kann gerade nicht hinzugefügt werden."
    },
    en: {
      title: "Add another piece",
      subtitle: "Choose several pieces here without leaving your rental request.",
      close: "Back to rental request",
      search: "Search brand, item or article number …",
      all: "All",
      selected: "Selected",
      add: "Add",
      added: "Selected ✓",
      remove: "Remove",
      daily: "{price} / day",
      onRequest: "Price on request",
      size: "Size {size}",
      empty: "No matching pieces found.",
      limit: "Maximum 20 pieces per rental request.",
      count: "{count} piece(s) in your rental selection",
      hint: "Rental price: exactly 10% of the sale price per calendar day. The deposit is calculated automatically in the next step.",
      unavailable: "This piece cannot be added right now."
    },
    fr: {
      title: "Ajouter une autre pièce",
      subtitle: "Choisissez plusieurs pièces ici sans quitter votre demande de location.",
      close: "Retour à la demande",
      search: "Rechercher une marque, une pièce ou un numéro …",
      all: "Tout",
      selected: "Sélection",
      add: "Ajouter",
      added: "Sélectionné ✓",
      remove: "Retirer",
      daily: "{price} / jour",
      onRequest: "Prix sur demande",
      size: "Taille {size}",
      empty: "Aucune pièce correspondante.",
      limit: "Maximum 20 pièces par demande de location.",
      count: "{count} pièce(s) dans votre sélection",
      hint: "Prix de location : exactement 10 % du prix de vente par jour calendaire. La caution est calculée automatiquement à l’étape suivante.",
      unavailable: "Cette pièce ne peut pas être ajoutée pour le moment."
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
  function isRentalPage() {
    return /(?:^|\/)mieten\/$/.test(window.location.pathname);
  }
  function loadIds() {
    try {
      var state = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      return state && Array.isArray(state.ids)
        ? state.ids.map(Number).filter(function (id) { return Number.isFinite(id) && id > 0; }).slice(0, 20)
        : [];
    } catch (e) { return []; }
  }
  function money(value) {
    if (!Number.isFinite(value) || value <= 0) return t("onRequest");
    return value.toLocaleString(LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
  }
  function dailyPrice(item) {
    var sale = Number(item && item.price);
    if (!Number.isFinite(sale) || sale <= 0) return null;
    return Math.round(((sale * 100) * RENTAL_RATE_BPS) / 10000) / 100;
  }
  function firstImage(item) {
    var raw = item && item.gallery && item.gallery[0] ? String(item.gallery[0]) : "assets/favicon.png";
    return "/" + raw.replace(/^\//, "");
  }
  function title(item) {
    return ((item && item.brand ? item.brand + " " : "") + (item && item.title ? item.title : "")).trim();
  }
  function normalize(value) {
    return String(value == null ? "" : value).toLocaleLowerCase(LOCALE).normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  }

  function injectStyles() {
    if (document.getElementById("d119RentalPickerStyles")) return;
    var style = document.createElement("style");
    style.id = "d119RentalPickerStyles";
    style.textContent = [
      ".d119-rental-v2{position:relative}",
      ".d119-rental-picker{position:absolute;inset:0;z-index:12;background:var(--surface,#fff);color:var(--ink,#111);display:flex;flex-direction:column;min-height:100%;animation:d119RentalPickerIn .16s ease-out}",
      "@keyframes d119RentalPickerIn{from{opacity:.4;transform:translateX(18px)}to{opacity:1;transform:none}}",
      ".d119-rental-picker__head{position:sticky;top:0;z-index:3;background:var(--surface,#fff);padding:18px 20px 14px;border-bottom:1px solid var(--line,#bbb)}",
      ".d119-rental-picker__back{appearance:none;border:0;background:transparent;color:inherit;padding:0 0 12px;font:inherit;font-size:11px;cursor:pointer;text-decoration:underline;text-underline-offset:3px}",
      ".d119-rental-picker__title-row{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}",
      ".d119-rental-picker__title-row h2{font-size:20px;line-height:1.1;margin:0}",
      ".d119-rental-picker__count{font-size:10px;line-height:1.25;text-align:right;opacity:.65;max-width:135px}",
      ".d119-rental-picker__sub{font-size:11px;line-height:1.45;opacity:.66;margin:8px 0 0;max-width:480px}",
      ".d119-rental-picker__tools{padding:14px 20px 10px;background:var(--surface,#fff)}",
      ".d119-rental-picker__search{width:100%;box-sizing:border-box;border:1px solid var(--line,#aaa);background:transparent;color:inherit;padding:12px 13px;font:inherit;font-size:13px}",
      ".d119-rental-picker__chips{display:flex;gap:6px;overflow-x:auto;padding:10px 0 2px;scrollbar-width:none}",
      ".d119-rental-picker__chips::-webkit-scrollbar{display:none}",
      ".d119-rental-picker__chip{appearance:none;white-space:nowrap;border:1px solid var(--line,#aaa);background:transparent;color:inherit;padding:7px 10px;font:inherit;font-size:10px;cursor:pointer}",
      ".d119-rental-picker__chip[aria-pressed='true']{background:var(--ink,#111);color:var(--surface,#fff);border-color:var(--ink,#111)}",
      ".d119-rental-picker__body{padding:8px 20px 30px;overflow:auto;flex:1}",
      ".d119-rental-picker__grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}",
      ".d119-rental-picker-card{border:1px solid var(--line,#bbb);background:transparent;min-width:0;display:flex;flex-direction:column}",
      ".d119-rental-picker-card__image{aspect-ratio:4/5;background:#eee;overflow:hidden;position:relative}",
      ".d119-rental-picker-card__image img{width:100%;height:100%;display:block;object-fit:cover}",
      ".d119-rental-picker-card__badge{position:absolute;left:7px;top:7px;background:#111;color:#fff;padding:4px 6px;font-size:9px;line-height:1}",
      ".d119-rental-picker-card__body{padding:10px;display:flex;flex-direction:column;gap:4px;flex:1}",
      ".d119-rental-picker-card__brand{font-size:10px;text-transform:uppercase;letter-spacing:.055em;opacity:.7}",
      ".d119-rental-picker-card__title{font-size:12px;line-height:1.3;font-weight:600;min-height:31px}",
      ".d119-rental-picker-card__meta{font-size:10px;line-height:1.35;opacity:.62;min-height:14px}",
      ".d119-rental-picker-card__price{font-size:12px;line-height:1.3;margin-top:3px}",
      ".d119-rental-picker-card__action{appearance:none;border:1px solid currentColor;background:transparent;color:inherit;width:100%;padding:9px 8px;margin-top:6px;font:inherit;font-size:10px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:7px}",
      ".d119-rental-picker-card__action:before{content:'+';display:grid;place-items:center;width:19px;height:19px;border:1px solid currentColor;border-radius:50%;font-size:16px;line-height:1}",
      ".d119-rental-picker-card__action[aria-pressed='true']{background:var(--ink,#111);color:var(--surface,#fff)}",
      ".d119-rental-picker-card__action[aria-pressed='true']:before{content:'✓';font-size:10px}",
      ".d119-rental-picker__empty{border:1px dashed var(--line,#aaa);padding:28px 18px;text-align:center;font-size:12px;line-height:1.5;opacity:.7}",
      ".d119-rental-picker__foot{position:sticky;bottom:0;z-index:3;background:var(--surface,#fff);border-top:1px solid var(--line,#bbb);padding:12px 20px 16px}",
      ".d119-rental-picker__hint{font-size:10px;line-height:1.4;opacity:.64;margin:0 0 10px}",
      ".d119-rental-picker__done{appearance:none;width:100%;border:1px solid currentColor;background:var(--ink,#111);color:var(--surface,#fff);padding:12px 14px;font:inherit;font-size:12px;cursor:pointer}",
      ".d119-rental-picker__alert{font-size:10px;line-height:1.35;margin:8px 0 0}",
      "@media(max-width:640px){.d119-rental-picker__head{padding:15px 16px 12px}.d119-rental-picker__tools{padding:12px 16px 8px}.d119-rental-picker__body{padding:6px 16px 24px}.d119-rental-picker__foot{padding:11px 16px 14px}.d119-rental-picker__grid{gap:9px}.d119-rental-picker-card__body{padding:8px}.d119-rental-picker-card__title{font-size:11px}.d119-rental-picker-card__action{padding:8px 5px}.d119-rental-picker__count{max-width:105px}}"
    ].join("");
    document.head.appendChild(style);
  }

  function categories() {
    var seen = {};
    catalog.forEach(function (item) {
      var cat = String(item.category || "").trim();
      if (cat) seen[cat] = true;
    });
    return Object.keys(seen).sort(function (a, b) { return a.localeCompare(b, LOCALE); });
  }

  function filteredItems() {
    var ids = loadIds();
    var selectedOnly = activeCategory === "__selected__";
    var q = normalize(query);
    return catalog.filter(function (item) {
      if (String(item.public_status || "").toUpperCase() === "SOLD") return false;
      var id = Number(item.id);
      if (selectedOnly && ids.indexOf(id) < 0) return false;
      if (!selectedOnly && activeCategory !== "all" && String(item.category || "") !== activeCategory) return false;
      if (!q) return true;
      return normalize([item.brand, item.title, item.article, item.category, item.size].join(" ")).indexOf(q) >= 0;
    }).slice(0, 120);
  }

  function pickerCard(item, ids) {
    var id = Number(item.id);
    var selected = ids.indexOf(id) >= 0;
    var daily = dailyPrice(item);
    var meta = [];
    if (item.size) meta.push(fmt(t("size"), { size: item.size }));
    if (item.category) meta.push(item.category);
    return '<article class="d119-rental-picker-card" data-picker-item="' + id + '">' +
      '<div class="d119-rental-picker-card__image"><img loading="lazy" src="' + esc(firstImage(item)) + '" alt="' + esc(title(item)) + '">' +
      (selected ? '<span class="d119-rental-picker-card__badge">✓ ' + esc(t("selected")) + '</span>' : '') + '</div>' +
      '<div class="d119-rental-picker-card__body"><div class="d119-rental-picker-card__brand">' + esc(item.brand || "Disorder119") + '</div>' +
      '<div class="d119-rental-picker-card__title">' + esc(item.title || title(item)) + '</div>' +
      '<div class="d119-rental-picker-card__meta">' + esc(meta.join(" · ")) + '</div>' +
      '<div class="d119-rental-picker-card__price">' + esc(daily === null ? t("onRequest") : fmt(t("daily"), { price: money(daily) })) + '</div>' +
      '<button type="button" class="d119-rental-picker-card__action" data-picker-toggle="' + id + '" aria-pressed="' + (selected ? "true" : "false") + '">' + esc(selected ? t("added") : t("add")) + '</button></div></article>';
  }

  function renderPicker() {
    if (!picker) return;
    var ids = loadIds();
    var count = picker.querySelector("#d119PickerCount");
    if (count) count.textContent = fmt(t("count"), { count: ids.length });

    var chips = picker.querySelector("#d119PickerChips");
    if (chips) {
      var html = '<button type="button" class="d119-rental-picker__chip" data-picker-category="all" aria-pressed="' + (activeCategory === "all" ? "true" : "false") + '">' + esc(t("all")) + '</button>' +
        '<button type="button" class="d119-rental-picker__chip" data-picker-category="__selected__" aria-pressed="' + (activeCategory === "__selected__" ? "true" : "false") + '">' + esc(t("selected")) + ' (' + ids.length + ')</button>';
      categories().forEach(function (cat) {
        html += '<button type="button" class="d119-rental-picker__chip" data-picker-category="' + esc(cat) + '" aria-pressed="' + (activeCategory === cat ? "true" : "false") + '">' + esc(cat) + '</button>';
      });
      chips.innerHTML = html;
    }

    var grid = picker.querySelector("#d119PickerGrid");
    if (grid) {
      var items = filteredItems();
      grid.innerHTML = items.length ? items.map(function (item) { return pickerCard(item, ids); }).join("") : '<div class="d119-rental-picker__empty">' + esc(t("empty")) + '</div>';
    }

    bindDynamicPickerControls();
  }

  function bindDynamicPickerControls() {
    if (!picker) return;
    Array.prototype.forEach.call(picker.querySelectorAll("[data-picker-category]"), function (button) {
      button.addEventListener("click", function () {
        activeCategory = button.getAttribute("data-picker-category") || "all";
        renderPicker();
      });
    });
    Array.prototype.forEach.call(picker.querySelectorAll("[data-picker-toggle]"), function (button) {
      button.addEventListener("click", function () { toggleViaRentalUi(Number(button.getAttribute("data-picker-toggle"))); });
    });
  }

  function toggleViaRentalUi(id) {
    var ids = loadIds();
    if (ids.indexOf(id) < 0 && ids.length >= 20) {
      showAlert(t("limit"));
      return;
    }
    var source = document.querySelector('[data-rental="' + id + '"]');
    if (source) {
      source.click();
      window.requestAnimationFrame(renderPicker);
      return;
    }
    showAlert(t("unavailable"));
  }

  function showAlert(message) {
    if (!picker) return;
    var el = picker.querySelector("#d119PickerAlert");
    if (el) el.textContent = message || "";
  }

  function createPicker() {
    var drawer = document.querySelector("#d119RentalV2Backdrop .d119-rental-v2");
    if (!drawer) return null;
    var el = document.createElement("section");
    el.id = "d119RentalIntegratedPicker";
    el.className = "d119-rental-picker";
    el.setAttribute("aria-label", t("title"));
    el.innerHTML = '<div class="d119-rental-picker__head">' +
      '<button type="button" class="d119-rental-picker__back" id="d119PickerBack">← ' + esc(t("close")) + '</button>' +
      '<div class="d119-rental-picker__title-row"><h2>' + esc(t("title")) + '</h2><div class="d119-rental-picker__count" id="d119PickerCount"></div></div>' +
      '<p class="d119-rental-picker__sub">' + esc(t("subtitle")) + '</p></div>' +
      '<div class="d119-rental-picker__tools"><input class="d119-rental-picker__search" id="d119PickerSearch" type="search" autocomplete="off" placeholder="' + esc(t("search")) + '" value="' + esc(query) + '"><div class="d119-rental-picker__chips" id="d119PickerChips"></div></div>' +
      '<div class="d119-rental-picker__body"><div class="d119-rental-picker__grid" id="d119PickerGrid"></div></div>' +
      '<div class="d119-rental-picker__foot"><p class="d119-rental-picker__hint">' + esc(t("hint")) + '</p><button type="button" class="d119-rental-picker__done" id="d119PickerDone">' + esc(t("close")) + '</button><p class="d119-rental-picker__alert" id="d119PickerAlert"></p></div>';
    drawer.appendChild(el);
    picker = el;
    el.querySelector("#d119PickerBack").addEventListener("click", closePicker);
    el.querySelector("#d119PickerDone").addEventListener("click", closePicker);
    var search = el.querySelector("#d119PickerSearch");
    if (search) search.addEventListener("input", function () { query = search.value.slice(0, 100); renderPicker(); });
    renderPicker();
    return el;
  }

  function openPicker(trigger) {
    previousFocus = trigger || document.activeElement;
    var backdrop = document.getElementById("d119RentalV2Backdrop");
    if (!backdrop || !backdrop.classList.contains("open")) return;
    if (!picker || !picker.isConnected) createPicker();
    if (!picker) return;
    picker.hidden = false;
    renderPicker();
    var search = picker.querySelector("#d119PickerSearch");
    if (search) window.setTimeout(function () { search.focus(); }, 0);
  }

  function closePicker() {
    if (!picker) return;
    picker.remove();
    picker = null;
    var backdrop = document.getElementById("d119RentalV2Backdrop");
    if (backdrop) {
      var titleNode = backdrop.querySelector("#d119RentalV2Title");
      if (titleNode) titleNode.focus && titleNode.focus();
    }
    if (previousFocus && previousFocus.isConnected && previousFocus.focus) previousFocus.focus();
  }

  function interceptPlusControls(event) {
    if (!isRentalPage()) return;
    var target = event.target.closest && event.target.closest("#d119RentalAddSide,#d119RentalStripAdd,#d119RentalAddInline");
    if (!target) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    openPicker(target);
  }

  function observeDrawer() {
    if (typeof MutationObserver === "undefined") return;
    new MutationObserver(function () {
      if (picker && !document.getElementById("d119RentalV2Backdrop")) {
        picker = null;
      }
    }).observe(document.body, { childList: true, subtree: true });
  }

  function bootstrap() {
    if (!isRentalPage()) return;
    injectStyles();
    document.addEventListener("click", interceptPlusControls, true);
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && picker) {
        event.preventDefault();
        event.stopImmediatePropagation();
        closePicker();
      }
    }, true);
    observeDrawer();
    fetch("/data/catalog.json", { credentials: "same-origin" })
      .then(function (response) { return response.ok ? response.json() : []; })
      .then(function (items) {
        catalog = Array.isArray(items) ? items.filter(function (item) { return String(item.public_status || "").toUpperCase() !== "SOLD"; }) : [];
        if (picker) renderPicker();
      })
      .catch(function () { catalog = []; });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bootstrap, { once: true });
  else bootstrap();
})();

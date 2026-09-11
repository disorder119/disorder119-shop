(function () {
  "use strict";

  var standalone = false;
  try {
    standalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  } catch (e) {
    standalone = window.navigator.standalone === true;
  }
  document.documentElement.setAttribute("data-display-mode", standalone ? "standalone" : "browser");

  var ARTICLE_NAV_KEY = "disorder119_article_nav_v2";
  var ARTICLE_NAV_TTL_MS = 2 * 60 * 60 * 1000;

  function articleIdFromHref(href) {
    var match = /\/artikel\/(\d+)\/?/i.exec(href || "");
    return match ? String(match[1]) : "";
  }

  function saveCatalogSequence(ids) {
    if (!Array.isArray(ids) || ids.length < 2) return;
    var clean = [];
    var seen = {};
    ids.forEach(function (id) {
      id = String(id || "");
      if (!id || seen[id]) return;
      seen[id] = true;
      clean.push(id);
    });
    if (clean.length < 2) return;
    try {
      window.sessionStorage.setItem(ARTICLE_NAV_KEY, JSON.stringify({
        ids: clean,
        savedAt: Date.now(),
        sourcePath: location.pathname + location.search
      }));
    } catch (e) {}
  }

  // Capture the exact rendered catalogue order before entering a product.
  // This preserves active filters and sorting across previous/next navigation.
  function captureCatalogSequenceBeforeOpen(event) {
    var target = event.target;
    if (!target || !target.closest) return;

    var plate = target.closest("a.plate");
    if (!plate) return;

    var grid = document.getElementById("grid");
    if (!grid || !grid.contains(plate)) return;
    if (target.closest("button, input, select, textarea, [data-brand-filter]")) return;

    var clickedId = articleIdFromHref(plate.getAttribute("href") || plate.href);
    if (!clickedId) return;

    var simpleLeftClick = event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
    if (simpleLeftClick) event.preventDefault();

    var loadMore = document.getElementById("loadMoreBtn");
    var guard = 0;
    while (loadMore && !loadMore.classList.contains("hidden") && guard < 100) {
      loadMore.click();
      guard += 1;
    }

    var ids = [];
    Array.prototype.forEach.call(grid.querySelectorAll("a.plate[href*='/artikel/']"), function (link) {
      var id = articleIdFromHref(link.getAttribute("href") || link.href);
      if (id) ids.push(id);
    });

    if (ids.indexOf(clickedId) !== -1) saveCatalogSequence(ids);
    if (simpleLeftClick) location.href = plate.href;
  }

  document.addEventListener("click", captureCatalogSequenceBeforeOpen, true);

  function loadStoredSequence(currentId) {
    try {
      var raw = window.sessionStorage.getItem(ARTICLE_NAV_KEY);
      if (!raw) return null;
      var data = JSON.parse(raw);
      if (!data || !Array.isArray(data.ids)) return null;
      if (!data.savedAt || Date.now() - Number(data.savedAt) > ARTICLE_NAV_TTL_MS) return null;

      var ids = data.ids.map(function (id) { return String(id); }).filter(Boolean);
      if (ids.length < 2 || ids.indexOf(String(currentId)) === -1) return null;
      return ids;
    } catch (e) {
      return null;
    }
  }

  function installProductLayoutStyles() {
    if (document.querySelector("style[data-d119-product-layout-v3]")) return;
    var style = document.createElement("style");
    style.setAttribute("data-d119-product-layout-v3", "");
    style.textContent =
      ".page-head__back{display:none!important}" +
      ".article-sequence-nav{max-width:1240px;margin:18px auto 0;padding:0 clamp(20px,5vw,48px);display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:10px}" +
      ".article-sequence-nav__link{display:inline-flex;align-items:center;justify-content:center;min-height:38px;padding:0 13px;border:1px solid rgba(242,239,231,.24);background:transparent;color:#f2efe7;text-decoration:none;font:600 10px/1.1 Helvetica Neue,Helvetica,Arial,sans-serif;letter-spacing:.06em;text-transform:uppercase;white-space:nowrap;transition:background .16s ease,color .16s ease,border-color .16s ease}" +
      ".article-sequence-nav__link:hover,.article-sequence-nav__link:focus-visible{background:#f2efe7;color:#000;border-color:#f2efe7;outline:none}" +
      ".article-sequence-nav__link--prev{justify-self:start}.article-sequence-nav__link--archive{justify-self:center;color:rgba(242,239,231,.65)}.article-sequence-nav__link--next{justify-self:end}" +
      ".product{padding-top:18px}" +
      "@media(max-width:860px){" +
        ".page-head{display:block;padding:22px 16px 14px;text-align:center}" +
        ".page-head__brand{display:block;width:max-content;margin:0 auto 14px;font-size:1.55rem;letter-spacing:-.02em}" +
        ".page-head__right{position:relative;display:grid!important;grid-template-columns:44px minmax(0,1fr) 44px;align-items:center;width:100%;gap:8px}" +
        ".lang-switch{grid-column:2;justify-self:center;border:0;gap:4px}" +
        ".lang-switch__btn{display:inline-flex;align-items:center;justify-content:center;width:36px;height:34px;padding:0;border:1px solid rgba(242,239,231,.22);font-size:.63rem}" +
        ".lang-switch__btn[aria-current=true]{background:#f2efe7;color:#000;border-color:#f2efe7}" +
        ".page-head__cart{grid-column:3;justify-self:end;position:relative;display:flex;align-items:center;justify-content:center;width:40px;height:40px;padding:0;border:1px solid rgba(242,239,231,.28);background:transparent;color:#f2efe7;font-size:0}" +
        ".page-head__cart:hover{background:transparent;color:#f2efe7;border-color:#f2efe7}" +
        ".page-head__cart>span:first-child{display:none}" +
        ".page-head__cart:before{content:'';width:17px;height:15px;border:1.5px solid currentColor;border-radius:1px;transform:translateY(2px)}" +
        ".page-head__cart:after{content:'';position:absolute;left:50%;top:8px;width:8px;height:6px;border:1.5px solid currentColor;border-bottom:0;border-radius:6px 6px 0 0;transform:translateX(-50%)}" +
        ".page-head__cart-count{position:absolute;right:2px;top:2px;display:inline-flex;align-items:center;justify-content:center;min-width:13px;height:13px;padding:0 2px;border-radius:8px;background:#f2efe7;color:#000;font-size:8px!important;line-height:1;font-weight:700}" +
        ".page-head__cart-count:empty{display:none}" +
        ".article-sequence-nav{margin:12px 16px 0;padding:0;max-width:none;grid-template-columns:1fr auto 1fr;gap:0;border:1px solid rgba(242,239,231,.24)}" +
        ".article-sequence-nav__link{min-width:0;min-height:42px;padding:0 6px;border:0;font-size:9px;letter-spacing:.035em}" +
        ".article-sequence-nav__link--archive{border-left:1px solid rgba(242,239,231,.18);border-right:1px solid rgba(242,239,231,.18);padding-left:10px;padding-right:10px}" +
        ".product{padding-top:12px}" +
      "}" +
      "@media(max-width:380px){.article-sequence-nav__link{font-size:8px;padding:0 4px}.article-sequence-nav__link--archive{padding-left:7px;padding-right:7px}.page-head__brand{font-size:1.45rem}}";
    document.head.appendChild(style);
  }

  function renderArticleSequence(ids, currentId, lang) {
    var currentIndex = ids.indexOf(String(currentId));
    if (currentIndex < 0 || ids.length < 2) return;

    var previousId = ids[(currentIndex - 1 + ids.length) % ids.length];
    var nextId = ids[(currentIndex + 1) % ids.length];
    if (!previousId || !nextId) return;

    var labels = {
      de: { prev: "← Vorheriger", archive: "Zum Archiv", next: "Nächster →", prevAria: "Zum vorherigen Artikel", archiveAria: "Zum Archiv", nextAria: "Zum nächsten Artikel" },
      en: { prev: "← Previous", archive: "To archive", next: "Next →", prevAria: "Go to previous item", archiveAria: "Go to archive", nextAria: "Go to next item" },
      fr: { prev: "← Précédent", archive: "Vers l’archive", next: "Suivant →", prevAria: "Voir l’article précédent", archiveAria: "Voir l’archive", nextAria: "Voir l’article suivant" }
    };
    var copy = labels[lang] || labels.de;
    var prefix = lang === "de" ? "/" : "/" + lang + "/";

    installProductLayoutStyles();

    var nav = document.createElement("nav");
    nav.className = "article-sequence-nav";
    nav.setAttribute("aria-label", lang === "fr" ? "Navigation des articles" : lang === "en" ? "Item navigation" : "Artikelnavigation");

    var previous = document.createElement("a");
    previous.className = "article-sequence-nav__link article-sequence-nav__link--prev";
    previous.href = prefix + "artikel/" + encodeURIComponent(previousId) + "/";
    previous.textContent = copy.prev;
    previous.setAttribute("aria-label", copy.prevAria);
    previous.setAttribute("rel", "prev");

    var archive = document.createElement("a");
    archive.className = "article-sequence-nav__link article-sequence-nav__link--archive";
    archive.href = prefix;
    archive.textContent = copy.archive;
    archive.setAttribute("aria-label", copy.archiveAria);

    var next = document.createElement("a");
    next.className = "article-sequence-nav__link article-sequence-nav__link--next";
    next.href = prefix + "artikel/" + encodeURIComponent(nextId) + "/";
    next.textContent = copy.next;
    next.setAttribute("aria-label", copy.nextAria);
    next.setAttribute("rel", "next");

    nav.appendChild(previous);
    nav.appendChild(archive);
    nav.appendChild(next);

    var product = document.querySelector(".product");
    if (product && product.parentNode) product.parentNode.insertBefore(nav, product);
    else document.body.appendChild(nav);

    var headPrev = document.createElement("link");
    headPrev.rel = "prev";
    headPrev.href = previous.href;
    document.head.appendChild(headPrev);

    var headNext = document.createElement("link");
    headNext.rel = "next";
    headNext.href = next.href;
    document.head.appendChild(headNext);
  }

  function initArticleSequence() {
    var current = window.ARTICLE_ITEM;
    if (!current || !current.id || !/\/(?:en\/|fr\/)?artikel\/\d+\/?$/i.test(location.pathname)) return;

    installProductLayoutStyles();

    var lang = window.ARTICLE_LANG || "de";
    var currentId = String(current.id);
    var stored = loadStoredSequence(currentId);

    if (stored) {
      renderArticleSequence(stored, currentId, lang);
      return;
    }

    // Directly opened product pages have no catalogue context. The fallback
    // mirrors the normal public archive: AVAILABLE items only, never SOLD.
    fetch("/data/catalog.json", { cache: "no-store" })
      .then(function (response) {
        if (!response.ok) throw new Error("catalog HTTP " + response.status);
        return response.json();
      })
      .then(function (items) {
        if (!Array.isArray(items)) return;
        var available = items.filter(function (item) {
          return item && item.id && item.public_status === "AVAILABLE";
        });
        available.sort(function (a, b) {
          var av = typeof a.brightness === "number" ? a.brightness : 0.5;
          var bv = typeof b.brightness === "number" ? b.brightness : 0.5;
          return bv - av;
        });
        var ids = available.map(function (item) { return String(item.id); });
        if (ids.indexOf(currentId) === -1) return;
        renderArticleSequence(ids, currentId, lang);
      })
      .catch(function () {
        // Navigation is optional. Never block the product page on failure.
      });
  }

  initArticleSequence();

  if (!("serviceWorker" in navigator)) return;
  var secureEnough = location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1";
  if (!secureEnough) return;

  function registerWorker() {
    navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(function (error) {
      console.warn("Disorder119 App-Service-Worker konnte nicht registriert werden.", error);
    });
  }

  window.addEventListener("load", function () {
    if (standalone) {
      registerWorker();
      return;
    }
    window.setTimeout(registerWorker, 3500);
  }, { once: true });
})();
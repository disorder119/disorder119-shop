(function () {
  "use strict";

  var standalone = false;
  try {
    standalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  } catch (e) {
    standalone = window.navigator.standalone === true;
  }
  document.documentElement.setAttribute("data-display-mode", standalone ? "standalone" : "browser");

  // iOS Safari ignores user-scalable=no in some cases. Load the dedicated
  // guard early on every shop page so pinch/gesture zoom stays locked on
  // iPhone/iPad while desktop and Android remain untouched.
  if (!document.querySelector('script[data-d119-ios-zoom-lock]')) {
    var zoomLockScript = document.createElement("script");
    zoomLockScript.src = "/assets/ios-zoom-lock.js?v=20260911-1";
    zoomLockScript.async = false;
    zoomLockScript.setAttribute("data-d119-ios-zoom-lock", "");
    document.head.appendChild(zoomLockScript);
  }

  var ARTICLE_NAV_KEY = "disorder119_article_nav_v2";
  var ARTICLE_NAV_TTL_MS = 2 * 60 * 60 * 1000;
  var PRODUCT_CSS_ID = "d119-product-page-v4";

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

  function copyFor(lang) {
    var labels = {
      de: {
        prev: "← Vorheriger",
        archive: "Zum Archiv",
        next: "Nächster →",
        prevAria: "Zum vorherigen Artikel",
        archiveAria: "Zum Archiv",
        nextAria: "Zum nächsten Artikel",
        navAria: "Artikelnavigation",
        menuAria: "Archiv öffnen",
        cartAria: "Warenkorb öffnen"
      },
      en: {
        prev: "← Previous",
        archive: "To archive",
        next: "Next →",
        prevAria: "Go to previous item",
        archiveAria: "Go to archive",
        nextAria: "Go to next item",
        navAria: "Item navigation",
        menuAria: "Open archive",
        cartAria: "Open cart"
      },
      fr: {
        prev: "← Précédent",
        archive: "Vers l’archive",
        next: "Suivant →",
        prevAria: "Voir l’article précédent",
        archiveAria: "Vers l’archive",
        nextAria: "Voir l’article suivant",
        navAria: "Navigation des articles",
        menuAria: "Ouvrir l’archive",
        cartAria: "Ouvrir le panier"
      }
    };
    return labels[lang] || labels.de;
  }

  function prefixFor(lang) {
    return lang === "de" ? "/" : "/" + lang + "/";
  }

  function installProductLayout(lang) {
    if (!document.getElementById(PRODUCT_CSS_ID)) {
      var css = document.createElement("link");
      css.id = PRODUCT_CSS_ID;
      css.rel = "stylesheet";
      css.href = "/assets/product-page-v4.css?v=20260911-1";
      document.head.appendChild(css);
    }

    var head = document.querySelector(".page-head");
    var brand = document.querySelector(".page-head__brand");
    if (head && brand && !head.querySelector(".page-head__menu")) {
      var menu = document.createElement("a");
      menu.className = "page-head__menu";
      menu.href = prefixFor(lang);
      menu.setAttribute("aria-label", copyFor(lang).menuAria);
      menu.innerHTML = "<span></span><span></span><span></span>";
      head.insertBefore(menu, brand);
    }

    var cart = document.getElementById("pageHeadCart");
    if (cart) cart.setAttribute("aria-label", copyFor(lang).cartAria);
  }

  function ensureArticleNavShell(lang) {
    var existing = document.querySelector(".article-sequence-nav");
    if (existing) return existing;

    var copy = copyFor(lang);
    var nav = document.createElement("nav");
    nav.className = "article-sequence-nav";
    nav.setAttribute("aria-label", copy.navAria);

    var previous = document.createElement("a");
    previous.className = "article-sequence-nav__link article-sequence-nav__link--prev";
    previous.textContent = copy.prev;
    previous.setAttribute("aria-label", copy.prevAria);
    previous.style.visibility = "hidden";

    var archive = document.createElement("a");
    archive.className = "article-sequence-nav__link article-sequence-nav__link--archive";
    archive.href = prefixFor(lang);
    archive.textContent = copy.archive;
    archive.setAttribute("aria-label", copy.archiveAria);

    var next = document.createElement("a");
    next.className = "article-sequence-nav__link article-sequence-nav__link--next";
    next.textContent = copy.next;
    next.setAttribute("aria-label", copy.nextAria);
    next.style.visibility = "hidden";

    nav.appendChild(previous);
    nav.appendChild(archive);
    nav.appendChild(next);

    var product = document.querySelector(".product");
    if (product && product.parentNode) product.parentNode.insertBefore(nav, product);
    else document.body.appendChild(nav);
    return nav;
  }

  function renderArticleSequence(ids, currentId, lang) {
    var currentIndex = ids.indexOf(String(currentId));
    if (currentIndex < 0 || ids.length < 2) return;

    var previousId = ids[(currentIndex - 1 + ids.length) % ids.length];
    var nextId = ids[(currentIndex + 1) % ids.length];
    if (!previousId || !nextId) return;

    var prefix = prefixFor(lang);
    var nav = ensureArticleNavShell(lang);
    var previous = nav.querySelector(".article-sequence-nav__link--prev");
    var next = nav.querySelector(".article-sequence-nav__link--next");

    previous.href = prefix + "artikel/" + encodeURIComponent(previousId) + "/";
    previous.rel = "prev";
    previous.style.visibility = "visible";

    next.href = prefix + "artikel/" + encodeURIComponent(nextId) + "/";
    next.rel = "next";
    next.style.visibility = "visible";

    if (!document.querySelector('link[rel="prev"][data-d119-sequence]')) {
      var headPrev = document.createElement("link");
      headPrev.rel = "prev";
      headPrev.href = previous.href;
      headPrev.setAttribute("data-d119-sequence", "");
      document.head.appendChild(headPrev);
    }
    if (!document.querySelector('link[rel="next"][data-d119-sequence]')) {
      var headNext = document.createElement("link");
      headNext.rel = "next";
      headNext.href = next.href;
      headNext.setAttribute("data-d119-sequence", "");
      document.head.appendChild(headNext);
    }
  }

  function initArticleSequence() {
    var current = window.ARTICLE_ITEM;
    if (!current || !current.id || !/\/(?:en\/|fr\/)?artikel\/\d+\/?$/i.test(location.pathname)) return;

    var lang = window.ARTICLE_LANG || "de";
    var currentId = String(current.id);

    installProductLayout(lang);
    ensureArticleNavShell(lang);

    var stored = loadStoredSequence(currentId);
    if (stored) {
      renderArticleSequence(stored, currentId, lang);
      return;
    }

    // Directly opened product pages use the normal public archive fallback:
    // AVAILABLE items only, never SOLD. The navigation shell is reserved from
    // first paint so asynchronous catalogue loading does not shift the page.
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
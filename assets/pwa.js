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

  // D119_ARTICLE_NAV_CONTEXT_V2
  // Capture the exact rendered catalogue order before entering a product.
  // This preserves active filters AND sort order. The "load more" button is
  // expanded synchronously first, so the sequence is the full filtered result,
  // not only the first 12 cards currently painted on screen.
  function captureCatalogSequenceBeforeOpen(event) {
    var target = event.target;
    if (!target || !target.closest) return;

    var plate = target.closest("a.plate");
    if (!plate) return;

    var grid = document.getElementById("grid");
    if (!grid || !grid.contains(plate)) return;

    // Nested controls such as the brand filter must keep their own behaviour.
    if (target.closest("button, input, select, textarea, [data-brand-filter]")) return;

    var clickedId = articleIdFromHref(plate.getAttribute("href") || plate.href);
    if (!clickedId) return;

    var simpleLeftClick = event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
    if (simpleLeftClick) event.preventDefault();

    // app.js updates render synchronously when this button is clicked.
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

  function renderArticleSequence(ids, currentId, lang) {
    var currentIndex = ids.indexOf(String(currentId));
    if (currentIndex < 0 || ids.length < 2) return;

    var previousId = ids[(currentIndex - 1 + ids.length) % ids.length];
    var nextId = ids[(currentIndex + 1) % ids.length];
    if (!previousId || !nextId) return;

    var labels = {
      de: { prev: "← Vorheriger Artikel", next: "Nächster Artikel →", prevAria: "Zum vorherigen Artikel", nextAria: "Zum nächsten Artikel" },
      en: { prev: "← Previous item", next: "Next item →", prevAria: "Go to previous item", nextAria: "Go to next item" },
      fr: { prev: "← Article précédent", next: "Article suivant →", prevAria: "Voir l’article précédent", nextAria: "Voir l’article suivant" }
    };
    var copy = labels[lang] || labels.de;
    var prefix = lang === "de" ? "/" : "/" + lang + "/";

    var style = document.createElement("style");
    style.setAttribute("data-d119-article-sequence-style", "");
    style.textContent =
      ".article-sequence-nav{position:fixed;right:18px;top:50%;transform:translateY(-50%);z-index:90;" +
      "display:flex;flex-direction:column;gap:8px;align-items:stretch}" +
      ".article-sequence-nav__link{display:inline-flex;align-items:center;justify-content:center;min-height:40px;padding:0 13px;" +
      "border:1px solid rgba(255,255,255,.28);background:rgba(0,0,0,.88);color:#f2efe7;" +
      "text-decoration:none;font:600 10px/1.1 Helvetica Neue,Helvetica,Arial,sans-serif;" +
      "letter-spacing:.07em;text-transform:uppercase;white-space:nowrap;backdrop-filter:blur(8px);" +
      "transition:background .16s ease,color .16s ease,border-color .16s ease,transform .16s ease}" +
      ".article-sequence-nav__link:hover,.article-sequence-nav__link:focus-visible{background:#f2efe7;color:#000;border-color:#f2efe7;outline:none}" +
      "@media(max-width:900px){.article-sequence-nav{position:static;right:auto;top:auto;bottom:auto;transform:none;z-index:auto;" +
      "flex-direction:row;gap:6px;width:100%;margin:12px 0 0}.article-sequence-nav__link{flex:1;min-height:38px;padding:0 10px;" +
      "font-size:9px;background:transparent}}" +
      "@media(max-width:480px){.article-sequence-nav__link{letter-spacing:.04em;padding:0 8px}}";
    document.head.appendChild(style);

    var nav = document.createElement("nav");
    nav.className = "article-sequence-nav";
    nav.setAttribute("aria-label", lang === "fr" ? "Navigation des articles" : lang === "en" ? "Item navigation" : "Artikelnavigation");

    var previous = document.createElement("a");
    previous.className = "article-sequence-nav__link";
    previous.href = prefix + "artikel/" + encodeURIComponent(previousId) + "/";
    previous.textContent = copy.prev;
    previous.setAttribute("aria-label", copy.prevAria);
    previous.setAttribute("rel", "prev");

    var next = document.createElement("a");
    next.className = "article-sequence-nav__link";
    next.href = prefix + "artikel/" + encodeURIComponent(nextId) + "/";
    next.textContent = copy.next;
    next.setAttribute("aria-label", copy.nextAria);
    next.setAttribute("rel", "next");

    nav.appendChild(previous);
    nav.appendChild(next);

    var mobile = window.matchMedia("(max-width: 900px)").matches;
    var rental = document.querySelector(".info .btn--rental");
    if (mobile && rental && rental.parentNode) {
      rental.parentNode.insertBefore(nav, rental.nextSibling);
    } else {
      document.body.appendChild(nav);
    }

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

    var lang = window.ARTICLE_LANG || "de";
    var currentId = String(current.id);
    var stored = loadStoredSequence(currentId);

    if (stored) {
      renderArticleSequence(stored, currentId, lang);
      return;
    }

    // Directly opened/bookmarked product pages have no catalogue context.
    // Fallback mirrors the normal archive default: AVAILABLE only, brightness
    // descending. SOLD pieces are deliberately excluded here.
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
    // Installed/standalone launches should attach immediately. In a normal
    // browser tab, keep Service-Worker startup and precache work out of the
    // product page's critical render/TTI window, then register shortly after.
    if (standalone) {
      registerWorker();
      return;
    }
    window.setTimeout(registerWorker, 3500);
  }, { once: true });
})();

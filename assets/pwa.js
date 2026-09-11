(function () {
  "use strict";

  var standalone = false;
  try {
    standalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  } catch (e) {
    standalone = window.navigator.standalone === true;
  }
  document.documentElement.setAttribute("data-display-mode", standalone ? "standalone" : "browser");

  // D119_ARTICLE_NEXT_V1
  // Bewusst extrem reduzierte Produktnavigation: auf jeder Artikelseite nur
  // ein permanenter "Naechster Artikel"-Button, ohne Bild/Preview-Karte.
  // Die Reihenfolge kommt aus dem ohnehin oeffentlichen Katalog und folgt
  // damit derselben zentralen Datenquelle wie der Shop. DRAFTs werden nie
  // angesprungen; am Ende beginnt die Navigation wieder beim ersten Artikel.
  function initArticleNext() {
    var current = window.ARTICLE_ITEM;
    if (!current || !current.id || !/\/(?:en\/|fr\/)?artikel\/\d+\/?$/i.test(location.pathname)) return;

    var labels = {
      de: "Nächster Artikel →",
      en: "Next item →",
      fr: "Article suivant →"
    };
    var ariaLabels = {
      de: "Zum nächsten Artikel",
      en: "Go to next item",
      fr: "Voir l’article suivant"
    };
    var lang = window.ARTICLE_LANG || "de";

    var style = document.createElement("style");
    style.setAttribute("data-d119-article-next-style", "");
    style.textContent =
      ".article-next{position:fixed;right:18px;top:50%;transform:translateY(-50%);z-index:90;" +
      "display:none;align-items:center;justify-content:center;min-height:42px;padding:0 15px;" +
      "border:1px solid rgba(255,255,255,.28);background:rgba(0,0,0,.88);color:#f2efe7;" +
      "text-decoration:none;font:600 11px/1.1 Helvetica Neue,Helvetica,Arial,sans-serif;" +
      "letter-spacing:.08em;text-transform:uppercase;white-space:nowrap;backdrop-filter:blur(8px);" +
      "transition:background .16s ease,color .16s ease,border-color .16s ease,transform .16s ease}" +
      ".article-next:hover,.article-next:focus-visible{background:#f2efe7;color:#000;border-color:#f2efe7;outline:none;" +
      "transform:translateY(-50%) translateX(-2px)}" +
      "@media(max-width:900px){.article-next{right:12px;top:auto;bottom:14px;transform:none;min-height:40px;padding:0 13px;" +
      "font-size:10px;background:rgba(0,0,0,.94)}.article-next:hover,.article-next:focus-visible{transform:translateX(-2px)}}";
    document.head.appendChild(style);

    var link = document.createElement("a");
    link.className = "article-next";
    link.textContent = labels[lang] || labels.de;
    link.setAttribute("aria-label", ariaLabels[lang] || ariaLabels.de);
    link.setAttribute("data-article-next", "");
    document.body.appendChild(link);

    fetch("/data/catalog.json", { cache: "no-store" })
      .then(function (response) {
        if (!response.ok) throw new Error("catalog HTTP " + response.status);
        return response.json();
      })
      .then(function (items) {
        if (!Array.isArray(items)) return;
        var publicItems = items.filter(function (item) {
          return item && item.id && item.public_status !== "DRAFT";
        });
        if (publicItems.length < 2) return;

        var currentIndex = -1;
        for (var i = 0; i < publicItems.length; i += 1) {
          if (String(publicItems[i].id) === String(current.id)) {
            currentIndex = i;
            break;
          }
        }
        if (currentIndex < 0) return;

        var next = publicItems[(currentIndex + 1) % publicItems.length];
        if (!next || String(next.id) === String(current.id)) return;

        var prefix = lang === "de" ? "/" : "/" + lang + "/";
        link.href = prefix + "artikel/" + encodeURIComponent(next.id) + "/";
        link.style.display = "inline-flex";
        link.setAttribute("rel", "next");

        var headNext = document.createElement("link");
        headNext.rel = "next";
        headNext.href = link.href;
        document.head.appendChild(headNext);
      })
      .catch(function () {
        // Navigation ist Komfortfunktion. Bei einem Katalog-/Netzwerkfehler
        // bleibt sie unsichtbar und beeinflusst Kauf, Galerie und Seite nicht.
      });
  }

  initArticleNext();

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

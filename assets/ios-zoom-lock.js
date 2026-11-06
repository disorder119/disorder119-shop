(function () {
  "use strict";

  // This helper is injected by pwa.js on every shop page, not only on iOS.
  // Keep the Universe Mode enhancement here so it is available everywhere
  // without adding another blocking tag to the main HTML template.
  if (!document.querySelector('link[data-d119-universe-upgrade]')) {
    var universeCss = document.createElement("link");
    universeCss.rel = "stylesheet";
    universeCss.href = "/assets/universe-upgrade.css?v=20260924-1";
    universeCss.setAttribute("data-d119-universe-upgrade", "");
    document.head.appendChild(universeCss);
  }
  if (!document.querySelector('script[data-d119-universe-upgrade]')) {
    var universeScript = document.createElement("script");
    universeScript.src = "/assets/universe-upgrade.js?v=20260924-1";
    universeScript.async = false;
    universeScript.setAttribute("data-d119-universe-upgrade", "");
    document.head.appendChild(universeScript);
  }

  if (window.ARTICLE_ITEM && document.getElementById("lightbox") &&
      !document.querySelector('script[data-d119-product-lightbox-v2]')) {
    var productLightbox = document.createElement("script");
    productLightbox.src = "/assets/product-lightbox-v2.js?v=20260912-2";
    productLightbox.async = false;
    productLightbox.setAttribute("data-d119-product-lightbox-v2", "");
    document.head.appendChild(productLightbox);
  }

  var ua = window.navigator.userAgent || "";
  var isIOS = /iPad|iPhone|iPod/.test(ua) || (window.navigator.platform === "MacIntel" && window.navigator.maxTouchPoints > 1);
  if (!isIOS) return;

  // minimum-scale=1: iOS liess das Herauszoomen trotz Sperre zu (Inhaber
  // 06.11.2026, iPhone): die Seite stand dann winzig links oben, und weil alle
  // Gesten gesperrt waren, kam man nicht mehr zurueck.
  var INHALT = "width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover";
  var viewport = document.querySelector('meta[name="viewport"]');
  if (viewport) {
    viewport.setAttribute("content", INHALT);
  }

  function insideOpenLightbox(event) {
    var target = event && event.target;
    return !!(target && target.closest && target.closest(".lightbox.open"));
  }
  // Gesten nur sperren, solange die Seite auf 100 % steht. Ist sie doch
  // gezoomt, darf man sie mit zwei Fingern zurueckholen - nie festkleben.
  var vv = window.visualViewport;
  function gezoomt() { return !!(vv && Math.abs(vv.scale - 1) > 0.01); }
  function stopGesture(event) { if (!gezoomt()) event.preventDefault(); }
  document.addEventListener("gesturestart", stopGesture, { passive: false });
  document.addEventListener("gesturechange", stopGesture, { passive: false });
  document.addEventListener("gestureend", stopGesture, { passive: false });
  document.addEventListener("touchmove", function (event) {
    if (insideOpenLightbox(event) || gezoomt()) return;
    if (event.touches && event.touches.length > 1) event.preventDefault();
  }, { passive: false });
  // Steht die Seite trotzdem verkleinert (unter 100 %), auf 100 % zurueck:
  // iOS rechnet den Massstab neu, wenn sich der Viewport-Eintrag aendert.
  var zurueck = null;
  if (vv && viewport) {
    vv.addEventListener("resize", function () {
      clearTimeout(zurueck);
      zurueck = setTimeout(function () {
        if (vv.scale >= 0.99 || document.querySelector(".lightbox.open")) return;
        viewport.setAttribute("content", INHALT.replace("initial-scale=1", "initial-scale=1.0001"));
        setTimeout(function () { viewport.setAttribute("content", INHALT); }, 60);
      }, 350);
    });
  }
})();
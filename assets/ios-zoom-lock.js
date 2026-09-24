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

  var viewport = document.querySelector('meta[name="viewport"]');
  if (viewport) {
    viewport.setAttribute("content", "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover");
  }

  function insideOpenLightbox(event) {
    var target = event && event.target;
    return !!(target && target.closest && target.closest(".lightbox.open"));
  }
  function stopGesture(event) { event.preventDefault(); }
  document.addEventListener("gesturestart", stopGesture, { passive: false });
  document.addEventListener("gesturechange", stopGesture, { passive: false });
  document.addEventListener("gestureend", stopGesture, { passive: false });
  document.addEventListener("touchmove", function (event) {
    if (insideOpenLightbox(event)) return;
    if (event.touches && event.touches.length > 1) event.preventDefault();
  }, { passive: false });
})();
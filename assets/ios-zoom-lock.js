(function () {
  "use strict";

  // Product pages get a dedicated full-screen image viewer enhancement.
  // It keeps normal page zoom locked on iOS, but allows controlled pinch
  // zoom, swipe navigation and visible previous/next controls inside lightbox.
  if (window.ARTICLE_ITEM && document.getElementById("lightbox") &&
      !document.querySelector('script[data-d119-product-lightbox-v2]')) {
    var productLightbox = document.createElement("script");
    productLightbox.src = "/assets/product-lightbox-v2.js?v=20260912-1";
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

  function stopGesture(event) {
    event.preventDefault();
  }

  document.addEventListener("gesturestart", stopGesture, { passive: false });
  document.addEventListener("gesturechange", stopGesture, { passive: false });
  document.addEventListener("gestureend", stopGesture, { passive: false });

  document.addEventListener("touchmove", function (event) {
    if (event.touches && event.touches.length > 1) event.preventDefault();
  }, { passive: false });
})();

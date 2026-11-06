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

  // Inhaber 06.11.2026: Auf dem iPhone ist die Seite immer fest - kein
  // Zoomen, weder hinein noch heraus, auch nicht per Doppeltippen. Nur Fotos
  // lassen sich vergroessern: in der Bildansicht (.lightbox.open) mit eigener
  // Zwei-Finger-Logik (product-lightbox-v2.js), unabhaengig vom Seitenzoom.
  // minimum-scale=1 dazu, weil iOS das Herauszoomen sonst teils zuliess (die
  // Seite stand dann winzig links oben).
  var INHALT = "width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover";
  var viewport = document.querySelector('meta[name="viewport"]');
  if (viewport) {
    viewport.setAttribute("content", INHALT);
  }
  // Doppeltippen zoomt nicht mehr; Wischen und Tippen bleiben wie gehabt.
  document.documentElement.style.touchAction = "manipulation";

  function lightboxOffen() { return !!document.querySelector(".lightbox.open"); }
  function insideOpenLightbox(event) {
    var target = event && event.target;
    return !!(target && target.closest && target.closest(".lightbox.open"));
  }
  // Zwei-Finger-Gesten der Seite immer sperren (die Bildansicht wertet ihre
  // Touch-Ereignisse selbst aus).
  function stopGesture(event) { event.preventDefault(); }
  document.addEventListener("gesturestart", stopGesture, { passive: false });
  document.addEventListener("gesturechange", stopGesture, { passive: false });
  document.addEventListener("gestureend", stopGesture, { passive: false });
  document.addEventListener("touchmove", function (event) {
    if (insideOpenLightbox(event)) return;
    if (event.touches && event.touches.length > 1) event.preventDefault();
  }, { passive: false });

  // Steht die Seite trotzdem nicht auf 100 % (iOS laesst Zoom fuer die
  // Bedienungshilfen teils zu), sofort zurueck: iOS rechnet den Massstab neu,
  // wenn sich der Viewport-Eintrag aendert. Feste Groesse, egal was passiert.
  var vv = window.visualViewport;
  var zurueck = null;
  function aufHundert() {
    if (!vv || !viewport || Math.abs(vv.scale - 1) <= 0.01 || lightboxOffen()) return;
    viewport.setAttribute("content", INHALT.replace("initial-scale=1", "initial-scale=1.0001"));
    setTimeout(function () { viewport.setAttribute("content", INHALT); }, 60);
  }
  if (vv && viewport) {
    vv.addEventListener("resize", function () {
      clearTimeout(zurueck);
      zurueck = setTimeout(aufHundert, 250);
    });
    document.addEventListener("touchend", function (event) {
      if (!event.touches || !event.touches.length) setTimeout(aufHundert, 120);
    }, { passive: true });
  }
})();
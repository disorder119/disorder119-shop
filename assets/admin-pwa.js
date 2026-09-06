"use strict";

(function () {
  if (!("serviceWorker" in navigator)) return;

  function isStandalone() {
    return window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  }

  function markMode() {
    document.documentElement.classList.toggle("d119-admin-standalone", isStandalone());
  }

  markMode();
  try {
    window.matchMedia("(display-mode: standalone)").addEventListener("change", markMode);
  } catch (error) {
    // Older iOS versions do not expose MediaQueryList.addEventListener.
  }

  window.addEventListener("load", function () {
    navigator.serviceWorker.register("/admin/sw.js", { scope: "/admin/", updateViaCache: "none" })
      .then(function (registration) { return registration.update().catch(function () { return registration; }); })
      .catch(function (error) {
        console.warn("Disorder119 Admin App konnte den Service Worker nicht registrieren.", error);
      });
  }, { once: true });
})();

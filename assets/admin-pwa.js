"use strict";

(function () {
  function isStandalone() {
    return window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  }

  function markMode() {
    document.documentElement.classList.toggle("d119-admin-standalone", isStandalone());
  }

  function addOperationsEntry() {
    var path = String(window.location.pathname || "");
    if (path === "/admin/operations.html" || document.getElementById("d119AdminOperationsEntry")) return;
    if (!(path === "/admin/" || path === "/admin" || path === "/admin/index.html")) return;

    var link = document.createElement("a");
    link.id = "d119AdminOperationsEntry";
    link.href = "/admin/operations.html";
    link.textContent = "Besucher & Bestellungen";
    link.setAttribute("aria-label", "Operations: Besucher und Bestellungen öffnen");
    link.style.cssText = [
      "position:fixed",
      "right:14px",
      "bottom:max(14px,env(safe-area-inset-bottom))",
      "z-index:2147483000",
      "display:inline-flex",
      "align-items:center",
      "min-height:44px",
      "padding:9px 12px",
      "border:1px solid #444",
      "border-radius:8px",
      "background:#111",
      "color:#fff",
      "font:600 12px/1.2 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif",
      "letter-spacing:.02em",
      "text-decoration:none",
      "box-shadow:0 8px 28px rgba(0,0,0,.35)"
    ].join(";");
    document.body.appendChild(link);
  }

  markMode();
  try {
    window.matchMedia("(display-mode: standalone)").addEventListener("change", markMode);
  } catch (error) {
    // Older iOS versions do not expose MediaQueryList.addEventListener.
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", addOperationsEntry, { once: true });
  } else {
    addOperationsEntry();
  }

  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", function () {
    navigator.serviceWorker.register("/admin/sw.js", { scope: "/admin/", updateViaCache: "none" })
      .then(function (registration) { return registration.update().catch(function () { return registration; }); })
      .catch(function (error) {
        console.warn("Disorder119 Admin App konnte den Service Worker nicht registrieren.", error);
      });
  }, { once: true });
})();

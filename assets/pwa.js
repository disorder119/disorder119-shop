(function () {
  "use strict";

  var standalone = false;
  try {
    standalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  } catch (e) {
    standalone = window.navigator.standalone === true;
  }
  document.documentElement.setAttribute("data-display-mode", standalone ? "standalone" : "browser");

  if (!("serviceWorker" in navigator)) return;
  var secureEnough = location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1";
  if (!secureEnough) return;

  window.addEventListener("load", function () {
    navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(function (error) {
      console.warn("Disorder119 App-Service-Worker konnte nicht registriert werden.", error);
    });
  }, { once: true });
})();

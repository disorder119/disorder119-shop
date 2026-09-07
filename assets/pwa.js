(function () {
  "use strict";

  var standalone = false;
  try {
    standalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  } catch (e) {
    standalone = window.navigator.standalone === true;
  }
  document.documentElement.setAttribute("data-display-mode", standalone ? "standalone" : "browser");

  function randomSessionId() {
    try {
      var bytes = new Uint8Array(18);
      crypto.getRandomValues(bytes);
      return "s_" + Array.prototype.map.call(bytes, function (value) {
        return value.toString(16).padStart(2, "0");
      }).join("");
    } catch (error) {
      return "s_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 18);
    }
  }

  function getSessionId() {
    var key = "d119_session_id";
    try {
      var existing = sessionStorage.getItem(key);
      if (existing) return existing;
      var created = randomSessionId();
      sessionStorage.setItem(key, created);
      return created;
    } catch (error) {
      return randomSessionId();
    }
  }

  function browserName() {
    var ua = navigator.userAgent || "";
    if (/Edg\//.test(ua)) return "Edge";
    if (/OPR\//.test(ua)) return "Opera";
    if (/Firefox\//.test(ua)) return "Firefox";
    if (/Chrome\//.test(ua) || /CriOS\//.test(ua)) return "Chrome";
    if (/Safari\//.test(ua)) return "Safari";
    return "Other";
  }

  function deviceType() {
    var width = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0);
    if (width <= 720) return "mobile";
    if (width <= 1100) return "tablet";
    return "desktop";
  }

  function publicWorkerBase() {
    var config = window.SHOP_CONFIG || window.ARTICLE_SHOP_CONFIG || {};
    var value = String(config.shopWorkerUrl || "").trim();
    return value.replace(/\/+$/, "");
  }

  function sendVisit() {
    var base = publicWorkerBase();
    if (!base || typeof fetch !== "function") return;
    var current = new URL(window.location.href);
    var payload = {
      sessionId: getSessionId(),
      path: current.pathname + current.search,
      title: document.title || "",
      referrer: document.referrer || "",
      utmSource: current.searchParams.get("utm_source") || "",
      utmMedium: current.searchParams.get("utm_medium") || "",
      utmCampaign: current.searchParams.get("utm_campaign") || "",
      language: navigator.language || document.documentElement.lang || "",
      deviceType: deviceType(),
      browser: browserName(),
      platform: (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || "",
      viewportWidth: Math.round(window.innerWidth || 0),
      viewportHeight: Math.round(window.innerHeight || 0)
    };
    fetch(base + "/visit", {
      method: "POST",
      mode: "cors",
      credentials: "omit",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }).catch(function () {
      // Observability is best-effort and must never affect the shopping path.
    });
  }

  if (document.visibilityState === "loading") {
    document.addEventListener("DOMContentLoaded", sendVisit, { once: true });
  } else {
    window.setTimeout(sendVisit, 0);
  }

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

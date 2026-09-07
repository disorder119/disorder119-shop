(function () {
  "use strict";

  var standalone = false;
  try {
    standalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  } catch (e) {
    standalone = window.navigator.standalone === true;
  }
  document.documentElement.setAttribute("data-display-mode", standalone ? "standalone" : "browser");

  // Privacy-safe first-party operations telemetry. This intentionally does not
  // use cookies, raw IP addresses or fingerprinting. A random ID exists only
  // for the current browser session and is used to understand the path from
  // archive -> product -> cart -> checkout in the private operations admin.
  (function initVisitorIntelligence() {
    var protectedMode = /^\/(?:de\/|en\/|fr\/)?(?:match|chaos|baukasten)(?:\/|$)/i.test(location.pathname);
    if (protectedMode) return;

    var config = window.SHOP_CONFIG || window.ARTICLE_SHOP_CONFIG || {};
    var workerUrl = String(config.shopWorkerUrl || "").replace(/\/+$/, "");
    if (!/^https?:\/\//i.test(workerUrl)) return;

    var storageKey = "d119_visitor_session_v1";
    var sessionId = "";
    try { sessionId = window.sessionStorage.getItem(storageKey) || ""; } catch (e) {}
    if (!/^[a-f0-9-]{20,64}$/i.test(sessionId)) {
      try {
        sessionId = crypto.randomUUID();
      } catch (e) {
        sessionId = "v-" + Date.now().toString(16) + "-" + Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2);
      }
      try { window.sessionStorage.setItem(storageKey, sessionId); } catch (e) {}
    }

    function deviceClass() {
      var width = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0);
      if (width <= 720) return "MOBILE";
      if (width <= 1100) return "TABLET";
      return "DESKTOP";
    }

    function referrerHost() {
      if (!document.referrer) return "";
      try { return new URL(document.referrer).hostname || ""; } catch (e) { return ""; }
    }

    function cleanPath() {
      return String(location.pathname || "/").slice(0, 240);
    }

    function send(eventType, extra) {
      var payload = {
        sessionId: sessionId,
        eventType: eventType,
        path: cleanPath(),
        referrerHost: referrerHost(),
        deviceClass: deviceClass(),
      };
      extra = extra || {};
      if (extra.itemId) payload.itemId = Number(extra.itemId) || undefined;
      if (extra.metadata) payload.metadata = extra.metadata;
      return window.fetch(workerUrl + "/analytics/event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        credentials: "omit",
        keepalive: true,
      }).catch(function () {});
    }

    function itemIdFromElement(el) {
      if (!el) return null;
      var raw = el.getAttribute("data-item-id") || el.getAttribute("data-id") || "";
      var parsed = Number.parseInt(raw, 10);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
      var link = el.closest && el.closest("a[href*='/artikel/']");
      if (link) {
        var match = String(link.getAttribute("href") || "").match(/\/artikel\/(\d+)/);
        if (match) return Number(match[1]);
      }
      return null;
    }

    send("PAGE_VIEW");
    if (/\/artikel\/\d+\/?$/i.test(location.pathname) && window.ARTICLE_ITEM) {
      var article = window.ARTICLE_ITEM || {};
      send("PRODUCT_VIEW", {
        itemId: article.id,
        metadata: {
          itemId: article.id,
          brand: article.brand,
          title: article.title,
          source: "article",
        },
      });
    }
    if (/\/cart\/?$/i.test(location.pathname)) send("CART_VIEW");

    document.addEventListener("click", function (event) {
      var target = event.target && event.target.closest ? event.target.closest("button,a,[data-item-id],[data-id]") : null;
      if (!target) return;

      if (target.id === "modalCartBtn" || target.matches("[data-cart-add]")) {
        send("CART_ADD", { itemId: itemIdFromElement(target) });
        return;
      }
      if (target.matches("[data-cart-remove], .cart-item__remove, .cart-remove")) {
        send("CART_REMOVE", { itemId: itemIdFromElement(target) });
        return;
      }
      var href = target.getAttribute && target.getAttribute("href");
      if (href && /\/cart\/?(?:$|[?#])/i.test(href)) {
        send("CART_VIEW");
        return;
      }
      if (href && /\/artikel\/\d+/i.test(href)) {
        var itemId = itemIdFromElement(target);
        if (itemId) send("PRODUCT_VIEW", { itemId: itemId, metadata: { itemId: itemId, source: "archive" } });
      }
    }, true);

    // Observe the existing checkout calls without changing their payload or
    // delaying the customer response. Successful provider IDs are recorded as
    // operational references so the private admin can resolve them to the
    // corresponding local commerce order.
    var originalFetch = window.fetch.bind(window);
    window.fetch = function (input, init) {
      var rawUrl = typeof input === "string" ? input : (input && input.url) || "";
      var parsed = null;
      try { parsed = new URL(rawUrl, location.href); } catch (e) {}
      var checkoutKind = "";
      if (parsed && parsed.origin === new URL(workerUrl).origin) {
        if (parsed.pathname === "/create-order") checkoutKind = "create";
        else if (parsed.pathname === "/capture-order") checkoutKind = "capture";
      }
      if (checkoutKind === "create") send("CHECKOUT_STARTED", { metadata: { source: "paypal" } });

      return originalFetch(input, init).then(function (response) {
        if (!checkoutKind || !response.ok) return response;
        response.clone().json().then(function (data) {
          data = data || {};
          var orderId = data.orderId || data.id || data.providerOrderId || data.paypalOrderId || "";
          var orderNumber = data.orderNumber || data.publicOrderNumber || "";
          send(checkoutKind === "capture" ? "ORDER_COMPLETED" : "ORDER_CREATED", {
            metadata: {
              orderId: orderId,
              orderNumber: orderNumber,
              source: "paypal",
            },
          });
        }).catch(function () {});
        return response;
      });
    };
  })();

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

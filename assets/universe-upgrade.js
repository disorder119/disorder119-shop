(function () {
  "use strict";

  if (window.__D119_UNIVERSE_UPGRADE__) return;
  window.__D119_UNIVERSE_UPGRADE__ = true;

  var ASSET_VERSION = "20260922-2";
  var legacyObserver = null;
  var redirectingLegacyGame = false;

  function lang() {
    var value = String(document.documentElement.lang || "de").toLowerCase();
    return value.indexOf("fr") === 0 ? "fr" : value.indexOf("en") === 0 ? "en" : "de";
  }

  function copy() {
    var all = {
      de: { mode: "Universum-Modus", modeAria: "Universum-Modus öffnen" },
      en: { mode: "Universe Mode", modeAria: "Open Universe Mode" },
      fr: { mode: "Mode Univers", modeAria: "Ouvrir le mode Univers" }
    };
    return all[lang()];
  }

  function injectCss(href, marker) {
    if (document.querySelector('link[' + marker + ']')) return;
    var link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.setAttribute(marker, "");
    document.head.appendChild(link);
  }

  function injectScript(src, marker, done) {
    var existing = document.querySelector('script[' + marker + ']');
    if (existing) {
      if (done) {
        if (existing.getAttribute("data-loaded") === "1") done();
        else existing.addEventListener("load", done, { once: true });
      }
      return;
    }
    var script = document.createElement("script");
    script.src = src;
    script.async = false;
    script.setAttribute(marker, "");
    script.addEventListener("load", function () {
      script.setAttribute("data-loaded", "1");
      if (done) done();
    }, { once: true });
    document.head.appendChild(script);
  }

  function installModeBranding() {
    var button = document.querySelector('.mode-rail__btn[data-mode-view="chaos"]');
    if (!button) return;
    var label = button.querySelector(".mode-rail__label");
    var icon = button.querySelector(".mode-rail__icon");
    var c = copy();
    if (label) {
      label.textContent = c.mode;
      label.removeAttribute("data-i18n");
    }
    button.setAttribute("aria-label", c.modeAria);
    button.removeAttribute("data-i18n-aria");
    button.setAttribute("data-universe-mode", "");
    if (icon && !icon.querySelector("svg")) {
      icon.classList.add("mode-rail__icon--universe");
      icon.innerHTML = '<svg viewBox="0 0 32 32" aria-hidden="true" focusable="false"><circle cx="16" cy="16" r="6.2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M4.2 18.5c4.8 5.2 15.2 6.3 22.8 1.4 2.2-1.4 2-2.7.4-3.4-2.2-.9-6.8-.1-11.4 2-4.8 2.2-9.8 2.5-11.8.7" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="round"/><circle cx="21.4" cy="10.2" r="1.05" fill="currentColor"/></svg>';
    }
  }

  function removeLegacyVisibleControls() {
    Array.prototype.forEach.call(document.querySelectorAll(".universe-shooting-star,.d119-warp-control,#universeTurbo"), function (node) {
      node.remove();
    });
  }

  function randomGame() {
    var ids = ["warp", "signal", "memory"];
    return ids[Math.floor(Math.random() * ids.length)];
  }

  function installLegacyGameBridge() {
    var view = document.getElementById("chaosView");
    if (!view || legacyObserver) return;
    legacyObserver = new MutationObserver(function () {
      if (!view.classList.contains("chaos-view--game") || redirectingLegacyGame) return;
      if (!window.D119SecretGames || typeof window.D119SecretGames.start !== "function") return;
      redirectingLegacyGame = true;
      var back = document.getElementById("chaosGameBack");
      if (back) back.click();
      window.setTimeout(function () {
        try { window.D119SecretGames.start(randomGame()); }
        finally { redirectingLegacyGame = false; }
      }, 0);
    });
    legacyObserver.observe(view, { attributes: true, attributeFilter: ["class"] });
  }

  function loadSecretSystem() {
    injectCss("/assets/secret-games.css?v=" + ASSET_VERSION, "data-d119-secret-games");
    injectCss("/assets/shop-promos.css?v=" + ASSET_VERSION, "data-d119-shop-promos");
    injectScript("/assets/shop-promos.js?v=" + ASSET_VERSION, "data-d119-shop-promos", null);
    injectScript("/assets/secret-games.js?v=" + ASSET_VERSION, "data-d119-secret-games", installLegacyGameBridge);
  }

  function install() {
    installModeBranding();
    removeLegacyVisibleControls();
    loadSecretSystem();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install, { once: true });
  else install();
})();

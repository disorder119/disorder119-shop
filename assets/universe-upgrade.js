(function () {
  "use strict";

  if (window.__D119_UNIVERSE_UPGRADE__) return;
  window.__D119_UNIVERSE_UPGRADE__ = true;

  var STAR_FIRST_MOBILE_MS = 3200;
  var STAR_FIRST_DESKTOP_MS = 6500;
  var STAR_REPEAT_MIN_MS = 15000;
  var STAR_REPEAT_SPAN_MS = 10000;
  var starTimer = 0;
  var starEl = null;
  var observer = null;

  function lang() {
    var value = String(document.documentElement.lang || "de").toLowerCase();
    return value.indexOf("fr") === 0 ? "fr" : value.indexOf("en") === 0 ? "en" : "de";
  }

  function copy() {
    var all = {
      de: {
        mode: "Universum-Modus",
        modeAria: "Universum-Modus öffnen",
        star: "Sternschnuppe antippen – Warp-Jagd starten",
        turbo: "TURBO",
        turboAria: "Turbo gedrückt halten",
        gameHelp: "Finger bewegen: zielen · TURBO halten: beschleunigen · Teile ins Fadenkreuz bringen"
      },
      en: {
        mode: "Universe Mode",
        modeAria: "Open Universe Mode",
        star: "Tap the shooting star – start Warp Hunt",
        turbo: "TURBO",
        turboAria: "Hold for turbo",
        gameHelp: "Move your finger to aim · hold TURBO to boost · guide pieces into the crosshair"
      },
      fr: {
        mode: "Mode Univers",
        modeAria: "Ouvrir le mode Univers",
        star: "Touchez l’étoile filante – lancer la Chasse Warp",
        turbo: "TURBO",
        turboAria: "Maintenir pour le turbo",
        gameHelp: "Déplacez le doigt pour viser · maintenez TURBO · placez les pièces dans le viseur"
      }
    };
    return all[lang()];
  }

  function isCoarsePointer() {
    try { return window.matchMedia("(pointer: coarse)").matches; } catch (e) { return false; }
  }

  function reduceMotion() {
    try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; }
  }

  function universeVisible() {
    var view = document.getElementById("chaosView");
    return !!(view && !view.classList.contains("hidden") && !view.classList.contains("chaos-view--game"));
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

  function dispatchGameKey(type, key) {
    try {
      document.dispatchEvent(new KeyboardEvent(type, { key: key, bubbles: true, cancelable: true }));
    } catch (e) {}
  }

  function startWarpGame() {
    removeStar();
    // Reuse the existing game's own start wiring instead of duplicating or
    // reaching into its protected closure. The hidden replay control is
    // permanently wired to chaosGameStart() by the main runtime, so click()
    // invokes the exact same start path as a normal replay.
    var nativeStart = document.getElementById("chaosGameAgain");
    if (nativeStart) {
      nativeStart.click();
      return;
    }
  }

  function removeStar() {
    if (!starEl) return;
    var old = starEl;
    starEl = null;
    if (old.parentNode) old.parentNode.removeChild(old);
  }

  function scheduleStar(delay) {
    window.clearTimeout(starTimer);
    starTimer = window.setTimeout(function () {
      if (!universeVisible()) {
        scheduleStar(900);
        return;
      }
      showStar();
    }, delay);
  }

  function showStar() {
    removeStar();
    var host = document.getElementById("chaosScreen");
    if (!host || !universeVisible()) return;

    var c = copy();
    var button = document.createElement("button");
    button.type = "button";
    button.className = "universe-shooting-star" + (reduceMotion() ? " is-reduced" : "");
    button.setAttribute("aria-label", c.star);
    button.setAttribute("title", c.star);
    button.innerHTML = '<span class="universe-shooting-star__tail" aria-hidden="true"></span><span class="universe-shooting-star__core" aria-hidden="true"></span>';
    starEl = button;

    function activate(event) {
      if (event) {
        event.preventDefault();
        event.stopPropagation();
      }
      startWarpGame();
    }
    button.addEventListener("pointerdown", function (event) { event.stopPropagation(); });
    button.addEventListener("click", activate);
    button.addEventListener("animationend", function () {
      if (starEl === button) {
        removeStar();
        scheduleStar(STAR_REPEAT_MIN_MS + Math.random() * STAR_REPEAT_SPAN_MS);
      }
    });
    host.appendChild(button);

    // With Reduce Motion the comet deliberately stays still. Keep it visible
    // long enough to be discovered, then offer it again later.
    if (reduceMotion()) {
      window.setTimeout(function () {
        if (starEl === button) {
          removeStar();
          scheduleStar(STAR_REPEAT_MIN_MS);
        }
      }, 9000);
    }
  }

  function installTurboButton() {
    var game = document.getElementById("chaosGame");
    if (!game || document.getElementById("universeTurbo")) return;
    var c = copy();
    var button = document.createElement("button");
    button.type = "button";
    button.id = "universeTurbo";
    button.className = "universe-game__turbo";
    button.textContent = c.turbo;
    button.setAttribute("aria-label", c.turboAria);

    var pressed = false;
    function on() {
      if (pressed) return;
      pressed = true;
      button.classList.add("is-active");
      dispatchGameKey("keydown", " ");
    }
    function off() {
      if (!pressed) return;
      pressed = false;
      button.classList.remove("is-active");
      dispatchGameKey("keyup", " ");
    }

    button.addEventListener("pointerdown", function (event) {
      event.preventDefault();
      event.stopPropagation();
      try { button.setPointerCapture(event.pointerId); } catch (e) {}
      on();
    });
    button.addEventListener("pointerup", function (event) { event.preventDefault(); off(); });
    button.addEventListener("pointercancel", off);
    button.addEventListener("lostpointercapture", off);
    button.addEventListener("contextmenu", function (event) { event.preventDefault(); });
    game.appendChild(button);
  }

  function localizeMobileGameHelp() {
    if (!isCoarsePointer()) return;
    var help = document.querySelector(".chaos-game__keys");
    if (!help) return;
    help.textContent = copy().gameHelp;
    help.removeAttribute("data-i18n");
  }

  function observeUniverse() {
    var view = document.getElementById("chaosView");
    if (!view) return;
    if (observer) observer.disconnect();
    observer = new MutationObserver(function () {
      if (universeVisible()) {
        if (!starEl) scheduleStar(isCoarsePointer() ? STAR_FIRST_MOBILE_MS : STAR_FIRST_DESKTOP_MS);
      } else {
        window.clearTimeout(starTimer);
        removeStar();
      }
    });
    observer.observe(view, { attributes: true, attributeFilter: ["class"] });

    if (universeVisible()) scheduleStar(isCoarsePointer() ? STAR_FIRST_MOBILE_MS : STAR_FIRST_DESKTOP_MS);
  }

  function install() {
    installModeBranding();
    installTurboButton();
    localizeMobileGameHelp();
    observeUniverse();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install, { once: true });
  else install();
})();

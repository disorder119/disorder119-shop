(function () {
  "use strict";

  function init() {
    var item = window.ARTICLE_ITEM;
    var lightbox = document.getElementById("lightbox");
    var image = document.getElementById("lightboxImg");
    var mainImage = document.getElementById("galleryMain");
    if (!item || !lightbox || !image || !mainImage) return;
    if (lightbox.getAttribute("data-d119-lightbox-ready") === "1") return;
    lightbox.setAttribute("data-d119-lightbox-ready", "1");

    if (!document.getElementById("d119-product-lightbox-v2-css")) {
      var css = document.createElement("link");
      css.id = "d119-product-lightbox-v2-css";
      css.rel = "stylesheet";
      css.href = "/assets/product-lightbox-v2.css?v=20260912-1";
      document.head.appendChild(css);
    }

    var gallery = (item.gallery || []).map(function (path) {
      return new URL("/" + String(path || "").replace(/^\/+/, ""), location.origin).href;
    }).filter(Boolean);
    if (!gallery.length) return;

    var lang = window.ARTICLE_LANG || "de";
    var labels = {
      de: { prev: "Vorheriges Foto", next: "Nächstes Foto", counter: "Foto" },
      en: { prev: "Previous photo", next: "Next photo", counter: "Photo" },
      fr: { prev: "Photo précédente", next: "Photo suivante", counter: "Photo" }
    }[lang] || { prev: "Vorheriges Foto", next: "Nächstes Foto", counter: "Foto" };

    function makeButton(className, text, aria) {
      var button = document.createElement("button");
      button.type = "button";
      button.className = className;
      button.textContent = text;
      button.setAttribute("aria-label", aria);
      return button;
    }

    var prev = lightbox.querySelector(".lightbox__photo-nav--prev");
    if (!prev) {
      prev = makeButton("lightbox__photo-nav lightbox__photo-nav--prev", "‹", labels.prev);
      lightbox.appendChild(prev);
    }
    var next = lightbox.querySelector(".lightbox__photo-nav--next");
    if (!next) {
      next = makeButton("lightbox__photo-nav lightbox__photo-nav--next", "›", labels.next);
      lightbox.appendChild(next);
    }
    var counter = lightbox.querySelector(".lightbox__photo-counter");
    if (!counter) {
      counter = document.createElement("div");
      counter.className = "lightbox__photo-counter";
      counter.setAttribute("aria-live", "polite");
      lightbox.appendChild(counter);
    }

    if (gallery.length < 2) {
      prev.hidden = true;
      next.hidden = true;
    }

    var currentIndex = 0;
    var scale = 1;
    var panX = 0;
    var panY = 0;
    var pinchStartDistance = 0;
    var pinchStartScale = 1;
    var panStartX = 0;
    var panStartY = 0;
    var panOriginX = 0;
    var panOriginY = 0;
    var swipeStartX = null;
    var swipeStartY = null;
    var pinching = false;

    function clamp(value, min, max) {
      return Math.min(max, Math.max(min, value));
    }

    function imagePath(url) {
      try { return new URL(url, location.href).pathname; }
      catch (e) { return String(url || ""); }
    }

    function indexFromSrc(src) {
      var path = imagePath(src);
      for (var i = 0; i < gallery.length; i += 1) {
        if (imagePath(gallery[i]) === path) return i;
      }
      return 0;
    }

    function distance(a, b) {
      var dx = a.clientX - b.clientX;
      var dy = a.clientY - b.clientY;
      return Math.sqrt(dx * dx + dy * dy);
    }

    function clampPan() {
      if (scale <= 1.01) {
        panX = 0;
        panY = 0;
        return;
      }
      var maxX = Math.max(0, image.clientWidth * (scale - 1) / 2);
      var maxY = Math.max(0, image.clientHeight * (scale - 1) / 2);
      panX = clamp(panX, -maxX, maxX);
      panY = clamp(panY, -maxY, maxY);
    }

    function applyTransform() {
      clampPan();
      image.style.transform = "translate3d(" + panX + "px," + panY + "px,0) scale(" + scale + ")";
      if (scale > 1.01) lightbox.classList.add("is-zoomed");
      else lightbox.classList.remove("is-zoomed");
    }

    function resetZoom() {
      scale = 1;
      panX = 0;
      panY = 0;
      pinchStartDistance = 0;
      pinchStartScale = 1;
      pinching = false;
      lightbox.classList.remove("is-interacting");
      lightbox.classList.remove("is-zoomed");
      image.style.transform = "translate3d(0,0,0) scale(1)";
    }

    function updateCounter() {
      counter.textContent = (currentIndex + 1) + " / " + gallery.length;
      counter.setAttribute("aria-label", labels.counter + " " + (currentIndex + 1) + " / " + gallery.length);
    }

    function show(index) {
      currentIndex = ((index % gallery.length) + gallery.length) % gallery.length;
      resetZoom();
      image.src = gallery[currentIndex];
      updateCounter();
    }

    function syncFromCurrentImage() {
      if (!lightbox.classList.contains("open")) return;
      currentIndex = indexFromSrc(image.src || mainImage.src);
      resetZoom();
      updateCounter();
    }

    function syncAfterOpen() {
      window.setTimeout(syncFromCurrentImage, 0);
    }

    prev.addEventListener("click", function (event) {
      event.preventDefault();
      event.stopPropagation();
      show(currentIndex - 1);
    });
    next.addEventListener("click", function (event) {
      event.preventDefault();
      event.stopPropagation();
      show(currentIndex + 1);
    });

    mainImage.addEventListener("click", syncAfterOpen);
    mainImage.addEventListener("keydown", function (event) {
      if (event.key === "Enter" || event.key === " ") syncAfterOpen();
    });

    var closeButton = document.getElementById("lightboxClose");
    if (closeButton) {
      closeButton.addEventListener("click", function () {
        window.setTimeout(resetZoom, 0);
      });
    }
    lightbox.addEventListener("click", function (event) {
      if (event.target === lightbox) window.setTimeout(resetZoom, 0);
    });

    image.setAttribute("draggable", "false");

    image.addEventListener("touchstart", function (event) {
      if (!lightbox.classList.contains("open")) return;

      if (event.touches.length === 2) {
        event.preventDefault();
        pinching = true;
        pinchStartDistance = distance(event.touches[0], event.touches[1]);
        pinchStartScale = scale;
        lightbox.classList.add("is-interacting");
        return;
      }

      if (event.touches.length !== 1) return;
      var touch = event.touches[0];
      swipeStartX = touch.clientX;
      swipeStartY = touch.clientY;

      if (scale > 1.01) {
        panStartX = touch.clientX;
        panStartY = touch.clientY;
        panOriginX = panX;
        panOriginY = panY;
        lightbox.classList.add("is-interacting");
      }
    }, { passive: false });

    image.addEventListener("touchmove", function (event) {
      if (!lightbox.classList.contains("open")) return;

      if (event.touches.length === 2) {
        event.preventDefault();
        var d = distance(event.touches[0], event.touches[1]);
        if (pinchStartDistance > 0) {
          scale = clamp(pinchStartScale * (d / pinchStartDistance), 1, 4);
          applyTransform();
        }
        return;
      }

      if (event.touches.length === 1) {
        event.preventDefault();
        if (scale > 1.01) {
          var touch = event.touches[0];
          panX = panOriginX + touch.clientX - panStartX;
          panY = panOriginY + touch.clientY - panStartY;
          applyTransform();
        }
      }
    }, { passive: false });

    image.addEventListener("touchend", function (event) {
      if (!lightbox.classList.contains("open")) return;

      if (event.touches && event.touches.length === 1 && pinching) {
        pinching = false;
        panStartX = event.touches[0].clientX;
        panStartY = event.touches[0].clientY;
        panOriginX = panX;
        panOriginY = panY;
        return;
      }
      if (event.touches && event.touches.length > 0) return;

      lightbox.classList.remove("is-interacting");
      if (pinching) {
        pinching = false;
        if (scale < 1.05) resetZoom();
        swipeStartX = null;
        swipeStartY = null;
        return;
      }

      if (scale <= 1.01 && swipeStartX !== null && event.changedTouches && event.changedTouches.length) {
        var changed = event.changedTouches[0];
        var dx = changed.clientX - swipeStartX;
        var dy = changed.clientY - swipeStartY;
        if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.15) {
          show(currentIndex + (dx < 0 ? 1 : -1));
        }
      }

      swipeStartX = null;
      swipeStartY = null;
    }, { passive: false });

    image.addEventListener("touchcancel", function () {
      pinching = false;
      swipeStartX = null;
      swipeStartY = null;
      lightbox.classList.remove("is-interacting");
    }, { passive: true });

    document.addEventListener("keydown", function (event) {
      if (!lightbox.classList.contains("open")) return;

      if (event.key === "Escape") {
        window.setTimeout(resetZoom, 0);
        return;
      }
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;

      event.preventDefault();
      event.stopPropagation();
      if (event.stopImmediatePropagation) event.stopImmediatePropagation();
      show(currentIndex + (event.key === "ArrowRight" ? 1 : -1));
    }, true);

    window.addEventListener("resize", function () {
      if (lightbox.classList.contains("open") && scale > 1.01) applyTransform();
    });
  }

  if (document.readyState === "complete") init();
  else window.addEventListener("load", init, { once: true });
})();

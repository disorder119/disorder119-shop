/* Geteiltes Skript fuer alle Produktseiten - liest die kleine, pro Seite
   eingebettete ARTICLE_ITEM/ARTICLE_SHOP_CONFIG-Variable, keine Frameworks.
   Der Warenkorb teilt sich das localStorage-Format mit der Hauptseite
   (index.html), damit ein hier hinzugefuegtes Stueck dort im Warenkorb
   auftaucht und umgekehrt. */
(function () {
  "use strict";

  var IT = window.ARTICLE_ITEM;
  if (!IT) return;
  var SHOP_CONFIG = window.ARTICLE_SHOP_CONFIG || { whatsappNumber: "", email: "" };
  var CART_KEY = "disorder119_cart";

  function fmtPrice(v) {
    return v.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
  }

  // ---- Galerie ----
  var mainImg = document.getElementById("galleryMain");
  var thumbsEl = document.getElementById("galleryThumbs");
  var counterEl = document.getElementById("galleryCounter");
  var prevBtn = document.getElementById("galleryPrev");
  var nextBtn = document.getElementById("galleryNext");
  var idx = 0;
  // IT.gallery-Pfade sind relativ zur Site-Wurzel (z.B. "assets/img/123/0.webp"),
  // die Produktseite selbst liegt aber unter /artikel/ - deshalb hier einmalig
  // mit "../" auf Seiten-relative Pfade umrechnen, statt das bei jedem Zugriff
  // zu vergessen (genau das brach zuvor das Hauptbild beim ersten showPhoto()-Aufruf).
  var gallery = (IT.gallery || []).map(function (p) { return "../" + p; });

  function showPhoto(i) {
    if (!gallery.length) return;
    idx = ((i % gallery.length) + gallery.length) % gallery.length;
    mainImg.src = gallery[idx];
    if (counterEl) counterEl.textContent = (idx + 1) + " / " + gallery.length;
    if (thumbsEl) {
      Array.prototype.forEach.call(thumbsEl.children, function (t, ti) {
        t.classList.toggle("active", ti === idx);
      });
    }
  }

  if (gallery.length > 1) {
    gallery.forEach(function (src, i) {
      var t = document.createElement("button");
      t.type = "button";
      t.className = "gallery-thumb" + (i === 0 ? " active" : "");
      t.innerHTML = '<img src="' + src + '" alt="" loading="lazy" />';
      t.addEventListener("click", function () { showPhoto(i); });
      thumbsEl.appendChild(t);
    });
  } else {
    if (prevBtn) prevBtn.hidden = true;
    if (nextBtn) nextBtn.hidden = true;
  }

  if (prevBtn) prevBtn.addEventListener("click", function () { showPhoto(idx - 1); });
  if (nextBtn) nextBtn.addEventListener("click", function () { showPhoto(idx + 1); });

  var touchStartX = null;
  mainImg.addEventListener("touchstart", function (e) { touchStartX = e.touches[0].clientX; }, { passive: true });
  mainImg.addEventListener("touchend", function (e) {
    if (touchStartX === null) return;
    var dx = e.changedTouches[0].clientX - touchStartX;
    if (Math.abs(dx) > 40) showPhoto(idx + (dx < 0 ? 1 : -1));
    touchStartX = null;
  });

  // ---- Lightbox (Zoom/Vollbild) ----
  var lightbox = document.getElementById("lightbox");
  var lightboxImg = document.getElementById("lightboxImg");
  function openLightbox() {
    lightboxImg.src = gallery[idx];
    lightbox.classList.add("open");
    document.body.style.overflow = "hidden";
  }
  function closeLightbox() {
    lightbox.classList.remove("open");
    document.body.style.overflow = "";
  }
  mainImg.addEventListener("click", openLightbox);
  var lightboxClose = document.getElementById("lightboxClose");
  if (lightboxClose) lightboxClose.addEventListener("click", closeLightbox);
  if (lightbox) {
    lightbox.addEventListener("click", function (e) { if (e.target === lightbox) closeLightbox(); });
  }
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closeLightbox();
    else if (e.key === "ArrowLeft") showPhoto(idx - 1);
    else if (e.key === "ArrowRight") showPhoto(idx + 1);
  });

  // ---- Warenkorb (teilt sich localStorage mit der Hauptseite) ----
  function loadCart() {
    try { return JSON.parse(window.localStorage.getItem(CART_KEY) || "[]"); } catch (e) { return []; }
  }
  function saveCart(c) {
    try { window.localStorage.setItem(CART_KEY, JSON.stringify(c)); } catch (e) {}
  }

  var cartBtn = document.getElementById("addToCartBtn");
  if (cartBtn) {
    function refreshCartBtn() {
      var cart = loadCart();
      var inCart = cart.indexOf(IT.id) !== -1;
      cartBtn.textContent = inCart ? "Im Warenkorb ✓ — entfernen" : "In den Warenkorb";
      cartBtn.classList.toggle("active", inCart);
    }
    cartBtn.addEventListener("click", function () {
      var cart = loadCart();
      var pos = cart.indexOf(IT.id);
      if (pos === -1) cart.push(IT.id); else cart.splice(pos, 1);
      saveCart(cart);
      refreshCartBtn();
    });
    refreshCartBtn();
  }

  // ---- Direkte Anfrage fuer genau dieses Stueck (kein Umweg ueber die Startseite) ----
  function orderText() {
    var name = [IT.brand, IT.title].filter(Boolean).join(" ");
    return "Hallo! Ich interessiere mich für folgendes Stück aus dem Disorder119-Archiv:\n\n" +
      "• " + name + (IT.size ? " (Gr. " + IT.size + ")" : "") + " – " + fmtPrice(IT.price) +
      " (Art.-Nr. " + IT.article + ")" +
      "\n\nIst dieses Stück noch verfügbar?";
  }

  var waBtn = document.getElementById("inquireWhatsapp");
  var emailBtn = document.getElementById("inquireEmail");
  if (waBtn) {
    if (SHOP_CONFIG.whatsappNumber) {
      waBtn.href = "https://wa.me/" + SHOP_CONFIG.whatsappNumber + "?text=" + encodeURIComponent(orderText());
    } else {
      waBtn.style.display = "none";
    }
  }
  if (emailBtn) {
    if (SHOP_CONFIG.email) {
      emailBtn.href = "mailto:" + SHOP_CONFIG.email +
        "?subject=" + encodeURIComponent("Anfrage Disorder119 – " + IT.title) +
        "&body=" + encodeURIComponent(orderText());
    } else {
      emailBtn.style.display = "none";
    }
  }

  showPhoto(0);
})();

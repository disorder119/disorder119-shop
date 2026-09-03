/* Geteiltes Skript fuer alle Produktseiten - liest die kleine, pro Seite
   eingebettete ARTICLE_ITEM/ARTICLE_SHOP_CONFIG/ARTICLE_LANG-Variable, keine
   Frameworks. Der Warenkorb teilt sich das localStorage-Format mit der
   Hauptseite (index.html, gleicher Key), damit ein hier hinzugefuegtes
   Stueck dort im Warenkorb erscheint. */
(function () {
  "use strict";

  var IT = window.ARTICLE_ITEM;
  if (!IT) return;
  var SHOP_CONFIG = window.ARTICLE_SHOP_CONFIG || { whatsappNumber: "", email: "" };
  var CART_KEY = "disorder119_cart";

  function fmtPrice(v) {
    return v.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
  }

  // Jede Sprache hat eine echte eigene URL (/artikel/, /en/artikel/,
  // /fr/artikel/ - siehe hreflang-Tags im <head>), die Seite selbst
  // bestimmt also die Sprache verbindlich (window.ARTICLE_LANG, von
  // build_page() in build_site.py gesetzt) - nicht mehr localStorage, das
  // sonst z.B. eine EN-URL faelschlich auf Deutsch rendern wuerde.
  var LANG = window.ARTICLE_LANG || "de";

  var I18N = {
    de: {
      langGroupAria: "Sprache wählen", backToArchive: "← Zum Archiv", cartLink: "Warenkorb",
      prevPhotoAria: "Vorheriges Foto", nextPhotoAria: "Nächstes Foto", closeAria: "Schließen",
      factCategory: "Kategorie", factSize: "Größe", factColor: "Farbe", factCondition: "Zustand",
      factArticleNo: "Artikelnummer",
      priceOnRequest: "Preis auf Anfrage", priceEstimatedPrefix: "ca. ", priceEstimatedBadge: "Preis wird geprüft",
      soldBadge: "SOLD — DISORDER119 ARCHIVE",
      soldNote: "Dieses Stück ist bereits verkauft und bleibt als Teil des Disorder119-Archivs sichtbar.",
      addToCart: "In den Warenkorb", inCartRemove: "Im Warenkorb ✓ — entfernen",
      inquireWhatsapp: "Anfrage per WhatsApp", inquireEmail: "Anfrage per E-Mail",
      rentalTeaser: "📅 Auch mietbar – Für Miete anfragen",
      configWarning: "Shop-Kontakt noch nicht eingerichtet: WhatsApp-Nummer oder E-Mail-Adresse fehlen in SHOP_CONFIG (index.html).",
      moreFromBrand: "MEHR VON {brand}", relatedPieces: "ÄHNLICHE ARCHIVSTÜCKE",
      relatedPrice: "Preis auf Anfrage", relatedSold: "SOLD",
      footerNote: "Disorder119 · Kuratiertes Archiv für Designer-, Vintage- und Contemporary-Mode. Jedes Stück wird einzeln ausgewählt, fotografiert und beschrieben.",
      footerFullArchive: "Zum vollständigen Archiv",
      orderGreeting: "Hallo! Ich interessiere mich für folgendes Stück aus dem Disorder119-Archiv:",
      orderArticleAbbrev: "Art.-Nr. ", orderAvailQuestion: "Ist dieses Stück noch verfügbar?",
      orderSubjectPrefix: "Anfrage Disorder119 – ",
      noBrand: "Ohne Marke", noDesc: "Keine Beschreibung hinterlegt.",
      autoDescTemplate: "{name}{facts}. Aus dem kuratierten Archiv von Disorder119."
    },
    en: {
      langGroupAria: "Choose language", backToArchive: "← To the archive", cartLink: "Cart",
      prevPhotoAria: "Previous photo", nextPhotoAria: "Next photo", closeAria: "Close",
      factCategory: "Category", factSize: "Size", factColor: "Colour", factCondition: "Condition",
      factArticleNo: "Item number",
      priceOnRequest: "Price on request", priceEstimatedPrefix: "approx. ", priceEstimatedBadge: "Price being confirmed",
      soldBadge: "SOLD — DISORDER119 ARCHIVE",
      soldNote: "This piece has already been sold and remains visible as part of the Disorder119 archive.",
      addToCart: "Add to cart", inCartRemove: "In cart ✓ — remove",
      inquireWhatsapp: "Enquire via WhatsApp", inquireEmail: "Enquire via e-mail",
      rentalTeaser: "📅 Also rentable – Request to rent",
      configWarning: "Shop contact not set up yet: WhatsApp number or e-mail address missing in SHOP_CONFIG (index.html).",
      moreFromBrand: "MORE FROM {brand}", relatedPieces: "RELATED ARCHIVE PIECES",
      relatedPrice: "Price on request", relatedSold: "SOLD",
      footerNote: "Disorder119 · Curated archive for designer, vintage and contemporary fashion. Every piece is individually selected, photographed and described.",
      footerFullArchive: "To the full archive",
      orderGreeting: "Hello! I'm interested in the following piece from the Disorder119 archive:",
      orderArticleAbbrev: "Item no. ", orderAvailQuestion: "Is this piece still available?",
      orderSubjectPrefix: "Disorder119 enquiry – ",
      noBrand: "No brand", noDesc: "No description available.",
      autoDescTemplate: "{name}{facts}. From the curated archive of Disorder119."
    },
    fr: {
      langGroupAria: "Choisir la langue", backToArchive: "← Vers l'archive", cartLink: "Panier",
      prevPhotoAria: "Photo précédente", nextPhotoAria: "Photo suivante", closeAria: "Fermer",
      factCategory: "Catégorie", factSize: "Taille", factColor: "Couleur", factCondition: "État",
      factArticleNo: "N° d'article",
      priceOnRequest: "Prix sur demande", priceEstimatedPrefix: "env. ", priceEstimatedBadge: "Prix en cours de vérification",
      soldBadge: "SOLD — DISORDER119 ARCHIVE",
      soldNote: "Cette pièce est déjà vendue et reste visible comme partie de l'archive Disorder119.",
      addToCart: "Ajouter au panier", inCartRemove: "Dans le panier ✓ — retirer",
      inquireWhatsapp: "Demande par WhatsApp", inquireEmail: "Demande par e-mail",
      rentalTeaser: "📅 Également louable – Demander la location",
      configWarning: "Le contact de la boutique n'est pas encore configuré : numéro WhatsApp ou e-mail manquant dans SHOP_CONFIG (index.html).",
      moreFromBrand: "PLUS DE {brand}", relatedPieces: "PIÈCES D'ARCHIVE SIMILAIRES",
      relatedPrice: "Prix sur demande", relatedSold: "SOLD",
      footerNote: "Disorder119 · Archive sélectionnée pour la mode de créateurs, vintage et contemporaine. Chaque pièce est choisie, photographiée et décrite individuellement.",
      footerFullArchive: "Vers l'archive complète",
      orderGreeting: "Bonjour ! Je suis intéressé(e) par la pièce suivante de l'archive Disorder119 :",
      orderArticleAbbrev: "N° d'article ", orderAvailQuestion: "Cette pièce est-elle toujours disponible ?",
      orderSubjectPrefix: "Demande Disorder119 – ",
      noBrand: "Sans marque", noDesc: "Aucune description disponible.",
      autoDescTemplate: "{name}{facts}. Issu de l'archive sélectionnée de Disorder119."
    }
  };

  function t(key) { return (I18N[LANG] && I18N[LANG][key] != null) ? I18N[LANG][key] : I18N.de[key]; }
  function tFormat(key, vars) {
    var s = t(key);
    for (var k in vars) { s = s.split("{" + k + "}").join(vars[k]); }
    return s;
  }

  // Kategorie-Werte in den Artikeldaten sind die englischen Kanonisch-Namen
  // (z.B. "Jackets") - diese Map ist eine reine Sprach-Uebersetzung.
  var CATEGORY_TR = {
    Jackets: { de: "Jacken", en: "Jackets", fr: "Vestes" },
    Coats: { de: "Mäntel", en: "Coats", fr: "Manteaux" },
    Tops: { de: "Tops", en: "Tops", fr: "Hauts" },
    Shirts: { de: "Hemden/Shirts", en: "Shirts", fr: "Chemises/T-shirts" },
    Knitwear: { de: "Strickwaren", en: "Knitwear", fr: "Maille" },
    Pants: { de: "Hosen", en: "Pants", fr: "Pantalons" },
    Skirts: { de: "Röcke", en: "Skirts", fr: "Jupes" },
    Dresses: { de: "Kleider", en: "Dresses", fr: "Robes" },
    Shoes: { de: "Schuhe", en: "Shoes", fr: "Chaussures" },
    Accessories: { de: "Accessoires", en: "Accessories", fr: "Accessoires" },
    Objects: { de: "Objekte", en: "Objects", fr: "Objets" }
  };
  var CONDITION_TR = {
    "Repariert": { de: "Repariert", en: "Repaired", fr: "Réparé" },
    "Mit Defekt": { de: "Mit Defekt", en: "With defect", fr: "Avec défaut" },
    "Gut": { de: "Gut", en: "Good", fr: "Bon" },
    "Sehr gut": { de: "Sehr gut", en: "Very good", fr: "Très bon" },
    "Zufriedenstellend": { de: "Zufriedenstellend", en: "Satisfactory", fr: "Satisfaisant" }
  };
  var SIZE_TR = {
    "Einheitsgröße": { de: "Einheitsgröße", en: "One size", fr: "Taille unique" },
    "verstellbar": { de: "verstellbar", en: "adjustable", fr: "réglable" },
    "Größenverstellbar": { de: "verstellbar", en: "adjustable", fr: "réglable" },
    "Kindergröße L": { de: "Kindergröße L", en: "Kids' size L", fr: "Taille enfant L" },
    "Sonstige": { de: "Sonstige", en: "Other", fr: "Autre" }
  };

  function trCat(cat) { var e = CATEGORY_TR[cat]; return e ? e[LANG] || e.de : (cat || ""); }
  function trCond(cond) { var e = CONDITION_TR[cond]; return e ? e[LANG] || e.de : (cond || ""); }
  function trSize(size) { var e = SIZE_TR[size]; return e ? e[LANG] || e.de : (size || ""); }

  function displayName() {
    var brand = IT.brand || "", title = IT.title || "";
    if (brand && title.toLowerCase().indexOf(brand.toLowerCase()) === 0) return title;
    return (brand + " " + title).trim();
  }
  function autoDescription() {
    var facts = [];
    if (IT.category) facts.push(trCat(IT.category));
    if (IT.size) facts.push(t("factSize") + " " + trSize(IT.size));
    if (IT.condition) facts.push(t("factCondition") + " " + trCond(IT.condition));
    var factsStr = facts.join(", ");
    return tFormat("autoDescTemplate", { name: displayName(), facts: factsStr ? " – " + factsStr : "" });
  }
  function descriptionText() {
    var descriptions = {
      de: IT.desc_de || IT.desc || "",
      en: IT.desc_en || "",
      fr: IT.desc_fr || ""
    };
    var localized = (descriptions[LANG] || "").trim();
    return localized || autoDescription();
  }

  function applyLang() {
    document.documentElement.setAttribute("lang", LANG);
    Array.prototype.forEach.call(document.querySelectorAll("#langSwitch [data-lang]"), function (btn) {
      if (btn.getAttribute("data-lang") === LANG) btn.setAttribute("aria-current", "true");
      else btn.removeAttribute("aria-current");
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-i18n]"), function (el) {
      el.textContent = t(el.getAttribute("data-i18n"));
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-i18n-aria]"), function (el) {
      el.setAttribute("aria-label", t(el.getAttribute("data-i18n-aria")));
    });

    var brandFig = document.getElementById("factCategoryValue");
    if (brandFig) brandFig.textContent = trCat(IT.category);
    var sizeFig = document.getElementById("factSizeValue");
    if (sizeFig) sizeFig.textContent = trSize(IT.size);
    var condFig = document.getElementById("factConditionValue");
    if (condFig) condFig.textContent = trCond(IT.condition);

    var priceEl = document.getElementById("priceBlock");
    if (priceEl) renderPriceBlock(priceEl);

    var descEl = document.getElementById("itemDesc");
    if (descEl) descEl.textContent = descriptionText();

    var soldNoteEl = document.getElementById("soldNote");
    if (soldNoteEl) soldNoteEl.textContent = t("soldNote");

    Array.prototype.forEach.call(document.querySelectorAll("[data-related-heading]"), function (el) {
      var kind = el.getAttribute("data-related-heading");
      el.textContent = kind === "brand" ? tFormat("moreFromBrand", { brand: (IT.brand || "").toUpperCase() }) : t("relatedPieces");
    });
    Array.prototype.forEach.call(document.querySelectorAll(".related-card__price[data-price-on-request]"), function (el) {
      el.textContent = t("relatedPrice");
    });
    Array.prototype.forEach.call(document.querySelectorAll(".related-card__sold"), function (el) {
      el.textContent = t("relatedSold");
    });

    updateOrderLinks();
    refreshCartBtn();
  }

  function renderPriceBlock(el) {
    if (IT.sold) {
      el.innerHTML = '<div class="info__badge info__badge--sold">' + t("soldBadge") + "</div>";
      return;
    }
    if (IT.priceEstimated) {
      el.innerHTML = '<div class="info__price">' + t("priceEstimatedPrefix") + fmtPrice(IT.price) + "</div>" +
        '<div class="info__badge info__badge--estimate">' + t("priceEstimatedBadge") + "</div>";
      return;
    }
    if (IT.price > 0) {
      el.innerHTML = '<div class="info__price">' + fmtPrice(IT.price) + "</div>";
      return;
    }
    el.innerHTML = '<div class="info__price">' + t("priceOnRequest") + "</div>";
  }

  // DE/EN/FR im Sprachumschalter sind echte Links auf die jeweilige
  // Sprach-URL dieses Artikels (siehe build_page() in build_site.py) -
  // kein In-Place-Umschalten mehr noetig, das braeuchte sonst wieder eine
  // eigene Loesung fuer Title/Meta-Tags/hreflang der aktuellen Seite.

  // ---- Galerie ----
  var mainImg = document.getElementById("galleryMain");
  var thumbsEl = document.getElementById("galleryThumbs");
  var counterEl = document.getElementById("galleryCounter");
  var prevBtn = document.getElementById("galleryPrev");
  var nextBtn = document.getElementById("galleryNext");
  var idx = 0;
  // IT.gallery-Pfade sind relativ zur Site-Wurzel (z.B. "assets/img/123/0.webp")
  // - hier wurzel-absolut gemacht ("/" davor), das funktioniert unabhaengig
  // davon, wie tief die aktuelle Produktseite verschachtelt ist
  // (/artikel/{id}/, /en/artikel/{id}/, /fr/artikel/{id}/). IT.thumbs (falls
  // vorhanden) sind kleinere, eigens erzeugte Vorschaubilder - spart
  // Datenvolumen, die grosse Version wird erst als Hauptbild/im
  // Lightbox-Modus geladen.
  var gallery = (IT.gallery || []).map(function (p) { return "/" + p; });
  var thumbs = (IT.thumbs && IT.thumbs.length === gallery.length ? IT.thumbs : IT.gallery || [])
    .map(function (p) { return "/" + p; });

  function showPhoto(i) {
    if (!gallery.length) return;
    idx = ((i % gallery.length) + gallery.length) % gallery.length;
    mainImg.src = gallery[idx];
    if (counterEl) counterEl.textContent = (idx + 1) + " / " + gallery.length;
    if (thumbsEl) {
      Array.prototype.forEach.call(thumbsEl.children, function (t2, ti) {
        t2.classList.toggle("active", ti === idx);
      });
    }
  }

  if (gallery.length > 1) {
    thumbs.forEach(function (src, i) {
      var t2 = document.createElement("button");
      t2.type = "button";
      t2.className = "gallery-thumb" + (i === 0 ? " active" : "");
      t2.innerHTML = '<img src="' + src + '" alt="" loading="lazy" />';
      t2.addEventListener("click", function () { showPhoto(i); });
      thumbsEl.appendChild(t2);
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

  // ---- Lightbox (Zoom/Vollbild) - immer die grosse Version, nie das Thumbnail ----
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
  var pageHeadCartCount = document.getElementById("pageHeadCartCount");
  function refreshCartBtn() {
    if (!cartBtn) return;
    var cart = loadCart();
    var inCart = cart.indexOf(IT.id) !== -1;
    cartBtn.textContent = inCart ? t("inCartRemove") : t("addToCart");
    cartBtn.classList.toggle("active", inCart);
  }
  function refreshCartCount() {
    if (!pageHeadCartCount) return;
    var count = loadCart().length;
    pageHeadCartCount.textContent = count ? " (" + count + ")" : "";
  }
  refreshCartCount();
  window.addEventListener("storage", function (e) {
    if (e.key === CART_KEY) { refreshCartBtn(); refreshCartCount(); }
  });
  if (cartBtn) {
    cartBtn.addEventListener("click", function () {
      // Sicherheitsnetz: ein SOLD-Artikel darf nie in den Warenkorb gelangen,
      // selbst wenn der Button aus irgendeinem Grund noch aktiv waere.
      if (IT.sold) return;
      var cart = loadCart();
      var pos = cart.indexOf(IT.id);
      if (pos === -1) cart.push(IT.id); else cart.splice(pos, 1);
      saveCart(cart);
      refreshCartBtn();
      refreshCartCount();
    });
  }

  // ---- PayPal "Jetzt kaufen" (nur gerendert, wenn CONFIG.paypalClientId +
  // shopWorkerUrl gesetzt sind - build_site.py laesst den Container sonst
  // ganz weg, siehe shop-worker/README.md fuer die Einrichtung) ----
  var paypalContainer = document.getElementById("paypalButtons");
  if (paypalContainer && window.paypal && SHOP_CONFIG.shopWorkerUrl) {
    var workerUrl = SHOP_CONFIG.shopWorkerUrl.replace(/\/$/, "");
    paypal.Buttons({
      style: { shape: "rect", color: "black", layout: "vertical", label: "paypal" },
      createOrder: function () {
        return fetch(workerUrl + "/create-order", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ itemId: IT.id }),
        })
          .then(function (r) {
            if (!r.ok) throw new Error("nicht mehr verfuegbar");
            return r.json();
          })
          .then(function (data) { return data.id; });
      },
      onApprove: function (data) {
        return fetch(workerUrl + "/capture-order", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderId: data.orderID, itemId: IT.id }),
        })
          .then(function (r) { if (!r.ok) throw new Error("Zahlung fehlgeschlagen"); })
          .then(function () { location.reload(); }); // Seite neu laden -> Artikel zeigt sich als verkauft, sobald der Rebuild durch ist
      },
      onError: function (err) {
        console.error(err);
        alert(t("paypalError") || "Da ist leider etwas schiefgelaufen. Bitte versuch es gleich nochmal oder schreib uns.");
      },
    }).render("#paypalButtons");
  }

  // ---- Direkte Anfrage fuer genau dieses Stueck (kein Umweg ueber die Startseite) ----
  function orderText() {
    var name = displayName();
    var rows = [name, t("orderArticleAbbrev") + (IT.article || IT.id)];
    if (IT.size) rows.push(t("factSize") + ": " + trSize(IT.size));
    rows.push(fmtPrice(IT.price));
    return t("orderGreeting") + "\n\n" + rows.join("\n") + "\n\n" + t("orderAvailQuestion");
  }

  var waBtn = document.getElementById("inquireWhatsapp");
  var emailBtn = document.getElementById("inquireEmail");
  function updateOrderLinks() {
    if (IT.sold) {
      if (waBtn) waBtn.style.display = "none";
      if (emailBtn) emailBtn.style.display = "none";
      return;
    }
    if (waBtn) {
      if (SHOP_CONFIG.whatsappNumber) {
        waBtn.href = "https://wa.me/" + SHOP_CONFIG.whatsappNumber + "?text=" + encodeURIComponent(orderText());
        waBtn.style.display = "";
      } else {
        waBtn.style.display = "none";
      }
    }
    if (emailBtn) {
      if (SHOP_CONFIG.email) {
        emailBtn.href = "mailto:" + SHOP_CONFIG.email +
          "?subject=" + encodeURIComponent(t("orderSubjectPrefix") + IT.title) +
          "&body=" + encodeURIComponent(orderText());
        emailBtn.style.display = "";
      } else {
        emailBtn.style.display = "none";
      }
    }
  }

  showPhoto(0);
  applyLang();
})();

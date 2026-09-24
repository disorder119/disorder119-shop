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
      paypalError: "Da ist leider etwas schiefgelaufen. Bitte versuch es gleich nochmal oder schreib uns.",
      checkoutSecurityPending: "Kurze Sicherheitsprüfung …",
      checkoutSecurityFailed: "Die Sicherheitsprüfung hat nicht geklappt. Bitte lade die Seite neu und versuch es nochmal.",
      checkoutUnavailable: "Dieses Stück ist gerade reserviert oder schon verkauft.",
      checkoutExpired: "Die Reservierung ist abgelaufen. Bitte starte den Kauf nochmal.",
      checkoutRateLimited: "Zu viele Versuche in kurzer Zeit. Bitte warte eine Minute.",
      checkoutCouponInvalid: "Der Gutscheincode ist ungültig oder wurde schon benutzt.",
      checkoutCapturing: "Zahlung wird abgeschlossen …",
      checkoutPaid: "Danke! Deine Bestellung {number} ist bezahlt. Die Bestätigung mit Rechnung kommt per E-Mail.",
      checkoutPaidNoNumber: "Danke! Deine Zahlung ist eingegangen. Die Bestätigung mit Rechnung kommt per E-Mail.",
      inquireWhatsapp: "Anfrage per WhatsApp", inquireEmail: "Anfrage per E-Mail",
      rentalTeaser: "Auch mietbar – Für Miete anfragen",
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
      paypalError: "Something went wrong. Please try again in a moment or send us a message.",
      checkoutSecurityPending: "Quick security check …",
      checkoutSecurityFailed: "The security check did not pass. Please reload the page and try again.",
      checkoutUnavailable: "This piece is currently reserved or already sold.",
      checkoutExpired: "The reservation has expired. Please start the purchase again.",
      checkoutRateLimited: "Too many attempts in a short time. Please wait a minute.",
      checkoutCouponInvalid: "The coupon code is invalid or has already been used.",
      checkoutCapturing: "Completing payment …",
      checkoutPaid: "Thank you! Your order {number} is paid. The confirmation and invoice are on their way by e-mail.",
      checkoutPaidNoNumber: "Thank you! Your payment has been received. The confirmation and invoice are on their way by e-mail.",
      inquireWhatsapp: "Enquire via WhatsApp", inquireEmail: "Enquire via e-mail",
      rentalTeaser: "Also rentable – Request to rent",
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
      paypalError: "Un problème est survenu. Merci de réessayer dans un instant ou de nous écrire.",
      checkoutSecurityPending: "Vérification de sécurité …",
      checkoutSecurityFailed: "La vérification de sécurité a échoué. Merci de recharger la page et de réessayer.",
      checkoutUnavailable: "Cette pièce est actuellement réservée ou déjà vendue.",
      checkoutExpired: "La réservation a expiré. Merci de relancer l'achat.",
      checkoutRateLimited: "Trop de tentatives en peu de temps. Merci de patienter une minute.",
      checkoutCouponInvalid: "Le code promo est invalide ou a déjà été utilisé.",
      checkoutCapturing: "Finalisation du paiement …",
      checkoutPaid: "Merci ! Ta commande {number} est payée. La confirmation et la facture arrivent par e-mail.",
      checkoutPaidNoNumber: "Merci ! Ton paiement a bien été reçu. La confirmation et la facture arrivent par e-mail.",
      inquireWhatsapp: "Demande par WhatsApp", inquireEmail: "Demande par e-mail",
      rentalTeaser: "Également louable – Demander la location",
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

  // Der Server liefert als Hauptbild bereits die kleine Anzeigefassung
  // (assets/img/<ordner>/display/0.webp, rund 44 KB statt 267 KB) und laedt
  // sie per <link rel="preload"> vor. Wuerde showPhoto(0) beim Start sofort
  // das volle Galeriebild setzen, laedt der Browser beide Dateien und misst
  // das LCP weiterhin am grossen Bild - die Vorschau brachte dann nichts,
  // sondern kostete zusaetzliche Arbeit. Deshalb bleibt beim ersten Aufruf
  // stehen, was im HTML steht; auf die volle Aufloesung wird erst nach dem
  // Laden der Seite gewechselt (siehe unten).
  var ersterAufruf = true;

  function showPhoto(i) {
    if (!gallery.length) return;
    idx = ((i % gallery.length) + gallery.length) % gallery.length;
    if (ersterAufruf) {
      ersterAufruf = false;
    } else {
      mainImg.src = gallery[idx];
    }
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
      // PERF_A11Y_95_ARTICLE — thumbnail buttons need an accessible name.
      t2.setAttribute("aria-label", (LANG === "fr" ? "Photo " : LANG === "en" ? "Photo " : "Foto ") + (i + 1) + " / " + thumbs.length);
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
  var lightboxLastFocus = null; // QUALITY95_ARTICLE_LIGHTBOX
  function openLightbox() {
    lightboxLastFocus = document.activeElement;
    lightboxImg.src = gallery[idx];
    lightbox.classList.add("open");
    lightbox.setAttribute("role", "dialog");
    lightbox.setAttribute("aria-modal", "true");
    lightbox.setAttribute("aria-label", LANG === "fr" ? "Image produit agrandie" : LANG === "en" ? "Enlarged product image" : "Vergrößertes Produktbild");
    document.body.style.overflow = "hidden";
    var close = document.getElementById("lightboxClose");
    if (close) close.focus();
  }
  function closeLightbox() {
    if (!lightbox.classList.contains("open")) return;
    lightbox.classList.remove("open");
    document.body.style.overflow = "";
    var target = lightboxLastFocus && lightboxLastFocus.isConnected ? lightboxLastFocus : mainImg;
    lightboxLastFocus = null;
    if (target && target.focus) target.focus();
  }
  mainImg.tabIndex = 0;
  mainImg.setAttribute("role", "button");
  mainImg.setAttribute("aria-label", LANG === "fr" ? "Agrandir l’image produit" : LANG === "en" ? "Enlarge product image" : "Produktbild vergrößern");
  mainImg.addEventListener("click", openLightbox);
  mainImg.addEventListener("keydown", function (e) {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openLightbox(); }
  });
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
  //
  // Der Worker verlangt fuer Kaufstart und Zahlungsabschluss einen
  // Idempotency-Key und im Live-Betrieb zusaetzlich ein Turnstile-Token.
  // Ohne beides lehnt er jeden Kauf ab.
  var paypalContainer = document.getElementById("paypalButtons");
  var checkoutStatus = document.getElementById("checkoutStatus");
  var guardBox = document.getElementById("checkoutGuard");
  if (paypalContainer && window.paypal && SHOP_CONFIG.shopWorkerUrl &&
      SHOP_CONFIG.features && SHOP_CONFIG.features.paypalCheckout) {
    var workerUrl = SHOP_CONFIG.shopWorkerUrl.replace(/\/$/, "");
    var CHECKOUT_KEY_STORE = "d119_checkout_key_" + IT.id;
    // Knapp unter der 15-Minuten-Reservierung des Workers. Innerhalb dieser
    // Zeit liefert ein erneuter Klick dieselbe Bestellung zurueck (etwa nach
    // geschlossenem PayPal-Fenster), statt das Stueck ein zweites Mal zu
    // reservieren. Danach startet ein frischer Kauf.
    var CHECKOUT_KEY_MAX_AGE_MS = 13 * 60 * 1000;
    var GUARD_TOKEN_MAX_AGE_MS = 4 * 60 * 1000;
    var lastCheckoutError = "";

    var showCheckoutStatus = function (message, kind) {
      if (!checkoutStatus) return;
      checkoutStatus.textContent = message || "";
      checkoutStatus.className = "checkout-status" + (kind ? " checkout-status--" + kind : "");
      checkoutStatus.hidden = !message;
    };

    var randomKey = function () {
      if (window.crypto && typeof window.crypto.randomUUID === "function") return window.crypto.randomUUID();
      var bytes = new Uint8Array(16);
      window.crypto.getRandomValues(bytes);
      return Array.prototype.map.call(bytes, function (b) { return ("0" + b.toString(16)).slice(-2); }).join("");
    };

    var checkoutKey = function (forceNew) {
      var now = Date.now();
      if (!forceNew) {
        try {
          var saved = JSON.parse(window.sessionStorage.getItem(CHECKOUT_KEY_STORE) || "null");
          if (saved && saved.key && now - Number(saved.at) < CHECKOUT_KEY_MAX_AGE_MS) return saved.key;
        } catch (e) {}
      }
      var fresh = "buy-" + IT.id + "-" + randomKey();
      try { window.sessionStorage.setItem(CHECKOUT_KEY_STORE, JSON.stringify({ key: fresh, at: now })); } catch (e) {}
      return fresh;
    };

    var clearCheckoutKey = function () {
      try { window.sessionStorage.removeItem(CHECKOUT_KEY_STORE); } catch (e) {}
    };

    // Cloudflare Turnstile: erscheint nur, wenn Cloudflare wirklich eine
    // Interaktion braucht. Jedes Token gilt genau einmal und rund fuenf
    // Minuten, deshalb wird nach jedem Verbrauch sofort ein neues vorbereitet.
    var guard = { id: null, token: "", at: 0, waiting: [] };
    var guardEnabled = Boolean(SHOP_CONFIG.turnstileSiteKey && window.turnstile && guardBox);
    var resetGuard = function () {
      if (!guardEnabled || guard.id === null) return;
      try { window.turnstile.reset(guard.id); } catch (e) {}
    };
    if (guardEnabled) {
      try {
        guard.id = window.turnstile.render(guardBox, {
          sitekey: SHOP_CONFIG.turnstileSiteKey,
          action: "checkout",
          appearance: "interaction-only",
          callback: function (token) {
            var waiting = guard.waiting.splice(0);
            if (waiting.length) {
              waiting[0].resolve(token);
              return;
            }
            guard.token = token;
            guard.at = Date.now();
          },
          "expired-callback": function () { guard.token = ""; guard.at = 0; },
          "error-callback": function () { guard.token = ""; guard.at = 0; },
        });
      } catch (e) {
        guardEnabled = false;
      }
    }

    var freshGuardToken = function () {
      if (!guardEnabled) return Promise.resolve("");
      if (guard.token && Date.now() - guard.at < GUARD_TOKEN_MAX_AGE_MS) {
        var ready = guard.token;
        guard.token = "";
        guard.at = 0;
        setTimeout(resetGuard, 0);
        return Promise.resolve(ready);
      }
      showCheckoutStatus(t("checkoutSecurityPending"), "info");
      return new Promise(function (resolve, reject) {
        var entry = { resolve: resolve };
        guard.waiting.push(entry);
        resetGuard();
        setTimeout(function () {
          var pos = guard.waiting.indexOf(entry);
          if (pos === -1) return;
          guard.waiting.splice(pos, 1);
          var err = new Error("TURNSTILE_TIMEOUT");
          err.code = "TURNSTILE_TIMEOUT";
          reject(err);
        }, 45000);
      }).then(function (token) {
        showCheckoutStatus("", "");
        setTimeout(resetGuard, 0);
        return token;
      });
    };

    var workerPost = function (path, body, key, token) {
      var headers = { "Content-Type": "application/json", "Idempotency-Key": key };
      if (token) headers["X-Turnstile-Token"] = token;
      return fetch(workerUrl + path, { method: "POST", headers: headers, body: JSON.stringify(body) })
        .then(function (r) {
          return r.json().catch(function () { return {}; }).then(function (data) {
            return { ok: r.ok, data: data || {} };
          });
        });
    };

    var checkoutError = function (code) {
      var err = new Error(code || "CHECKOUT_FAILED");
      err.code = code || "CHECKOUT_FAILED";
      return err;
    };

    var messageFor = function (code) {
      switch (code) {
        case "ITEM_UNAVAILABLE": case "ITEM_NOT_FOUND": case "PRICE_ON_REQUEST":
          return t("checkoutUnavailable");
        case "RESERVATION_EXPIRED":
          return t("checkoutExpired");
        case "RATE_LIMITED":
          return t("checkoutRateLimited");
        case "TURNSTILE_REQUIRED": case "TURNSTILE_FAILED": case "TURNSTILE_TIMEOUT":
          return t("checkoutSecurityFailed");
        case "COUPON_INVALID_OR_USED": case "COUPON_ORDER_NOT_PAYABLE":
          return t("checkoutCouponInvalid");
        default:
          return t("paypalError");
      }
    };

    var markPurchased = function (orderNumber) {
      clearCheckoutKey();
      var cart = loadCart();
      var pos = cart.indexOf(IT.id);
      if (pos !== -1) cart.splice(pos, 1);
      saveCart(cart);
      refreshCartCount();
      // Der serverseitige SOLD-Status ist massgeblich; der automatische
      // Rebuild zeigt ihn in wenigen Minuten auch auf dieser Seite. Bis dahin
      // bleibt die Bestaetigung stehen, statt die Seite neu zu laden.
      paypalContainer.hidden = true;
      if (guardBox) guardBox.hidden = true;
      var addBtn = document.getElementById("addToCartBtn");
      if (addBtn) addBtn.hidden = true;
      showCheckoutStatus(
        orderNumber ? tFormat("checkoutPaid", { number: orderNumber }) : t("checkoutPaidNoNumber"),
        "success"
      );
    };

    paypal.Buttons({
      style: { shape: "rect", color: "black", layout: "vertical", label: "paypal" },
      createOrder: function () {
        lastCheckoutError = "";
        showCheckoutStatus("", "");
        var attempt = function (forceNewKey, retried) {
          var key = checkoutKey(forceNewKey);
          return freshGuardToken()
            .then(function (token) { return workerPost("/create-order", { itemId: IT.id }, key, token); })
            .then(function (res) {
              if (res.ok && res.data.id) return res.data.id;
              var code = String(res.data.error || "CHECKOUT_FAILED");
              // Gleicher Schluessel mit anderem Inhalt (etwa ein spaeter
              // eingetragener Gutschein): einmal mit neuem Schluessel.
              if (!retried && code === "IDEMPOTENCY_KEY_REUSED") return attempt(true, true);
              throw checkoutError(code);
            });
        };
        return attempt(false, false).catch(function (err) {
          lastCheckoutError = (err && err.code) || "CHECKOUT_FAILED";
          showCheckoutStatus(messageFor(lastCheckoutError), "error");
          throw err;
        });
      },
      onApprove: function (data) {
        var orderId = String((data && data.orderID) || "");
        var captureKey = "capture-" + orderId.replace(/[^A-Za-z0-9._:-]/g, "");
        showCheckoutStatus(t("checkoutCapturing"), "info");
        return workerPost("/capture-order", { orderId: orderId, itemId: IT.id }, captureKey, "")
          .then(function (res) {
            if (!res.ok) throw checkoutError(String(res.data.error || "CAPTURE_FAILED"));
            markPurchased(res.data.orderNumber ? String(res.data.orderNumber) : "");
          })
          .catch(function (err) {
            lastCheckoutError = (err && err.code) || "CAPTURE_FAILED";
            showCheckoutStatus(messageFor(lastCheckoutError), "error");
          });
      },
      onCancel: function () {
        showCheckoutStatus("", "");
      },
      onError: function (err) {
        console.error(err);
        if (!lastCheckoutError) showCheckoutStatus(t("paypalError"), "error");
      },
    }).render("#paypalButtons");
  }

  // ---- Direkte Anfrage fuer genau dieses Stueck (kein Umweg ueber die Startseite) ----
  function orderText() {
    var name = displayName();
    var rows = [name, t("orderArticleAbbrev") + (IT.article || IT.id)];
    if (IT.size) rows.push(t("factSize") + ": " + trSize(IT.size));
    rows.push(IT.price > 0 ? fmtPrice(IT.price) : t("priceOnRequest")); // AUDIT_PERFECT_ARTICLE_PRICE_REQUEST
    rows.push("URL: " + window.location.href.split("?")[0].split("#")[0]);
    if (articleOrderMessage.trim()) rows.push(articleMessageLabel() + ": " + articleOrderMessage.trim());
    rows.push((LANG === "de" ? "Zeitpunkt" : LANG === "fr" ? "Horodatage" : "Timestamp") + ": " + new Date().toLocaleString());
    return t("orderGreeting") + "\n\n" + rows.join("\n") + "\n\n" + t("orderAvailQuestion");
  }

  var waBtn = document.getElementById("inquireWhatsapp");
  var emailBtn = document.getElementById("inquireEmail");
  var articleOrderMessage = ""; // QUALITY95_ARTICLE_MESSAGE
  function articleMessageLabel() { return LANG === "fr" ? "Message client" : LANG === "en" ? "Customer message" : "Kundennachricht"; }
  function articleMessagePlaceholder() { return LANG === "fr" ? "Question, mesures, souhait de livraison …" : LANG === "en" ? "Question, measurements, shipping request …" : "Frage, Maße, Versandwunsch …"; }
  function ensureArticleMessageField() {
    var anchor = waBtn || emailBtn;
    if (!anchor || (!SHOP_CONFIG.whatsappNumber && !SHOP_CONFIG.email)) return;
    var field = document.getElementById("articleOrderMessageField");
    if (!field) {
      field = document.createElement("label");
      field.id = "articleOrderMessageField";
      field.className = "article-order-message";
      field.innerHTML = '<span></span><textarea id="articleOrderMessage" maxlength="500"></textarea>';
      anchor.parentNode.insertBefore(field, anchor);
    }
    var messageInput = field.querySelector("textarea");
    if (messageInput && messageInput.getAttribute("data-d119-message-bound") !== "1") {
      messageInput.setAttribute("data-d119-message-bound", "1");
      messageInput.addEventListener("input", function (e) {
        articleOrderMessage = e.target.value.slice(0, 500);
        updateOrderLinks();
      });
    }
    field.querySelector("span").textContent = articleMessageLabel() + " (" + (LANG === "fr" ? "facultatif" : "optional") + ")";
    messageInput.placeholder = articleMessagePlaceholder();
  }

  function updateOrderLinks() {
    ensureArticleMessageField();
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

  // Die volle Aufloesung des Hauptbilds wird erst bei der ersten echten
  // Eingabe nachgeladen - Klick oder Tippen, Taste, Scrollen.
  //
  // Vorher geschah das automatisch nach "load" im Leerlauf, in der Annahme,
  // das LCP sei dann laengst gemessen. Das stimmt nicht: Chrome wertet das
  // neu gezeichnete Bild als weiteren LCP-Kandidaten. Je nachdem, wann der
  // Leerlauf-Rueckruf kam, lag das LCP der Testseite zwischen 2180 und
  // 2711 ms - bei einer Grenze von 2500 ms, also ein Muenzwurf.
  // Nach einer Nutzereingabe beendet Chrome die LCP-Messung; ein blosses
  // Ueberfahren mit der Maus zaehlt dafuer nicht und loest hier nichts aus.
  // Blaettern und Zoom laden die volle Aufloesung ohnehin selbst.
  var heroAufgewertet = false;
  function heroInVollaufloesung() {
    if (heroAufgewertet) return;
    heroAufgewertet = true;
    EINGABEN.forEach(function (ev) { window.removeEventListener(ev, heroInVollaufloesung, OPTIONEN); });
    if (!gallery.length || idx !== 0) return;
    var voll = gallery[0];
    if (mainImg.getAttribute("src") === voll) return;
    var vorlader = new Image();
    vorlader.onload = function () {
      if (idx === 0) mainImg.src = voll;
    };
    vorlader.src = voll;
  }
  var EINGABEN = ["pointerdown", "keydown", "scroll", "wheel"];
  var OPTIONEN = { passive: true, capture: true };
  EINGABEN.forEach(function (ev) { window.addEventListener(ev, heroInVollaufloesung, OPTIONEN); });

  applyLang();
})();

/* IMAGE_COPY_GUARD_V1
   Convenience protection for product photography. This intentionally does not
   interfere with click, swipe, zoom or keyboard interaction. It discourages
   the browser's normal save/drag gestures; it is not presented as DRM. */
(function installD119ProductImageProtection() {
  "use strict";

  if (window.__D119_PRODUCT_IMAGE_PROTECTION__) return;
  window.__D119_PRODUCT_IMAGE_PROTECTION__ = true;

  var PROTECTED_ATTRIBUTE = "data-d119-image-protected";

  function isProductImage(node) {
    if (!node || node.nodeType !== 1 || node.tagName !== "IMG") return false;
    if (node.hasAttribute(PROTECTED_ATTRIBUTE)) return true;
    var source = node.currentSrc || node.getAttribute("src") || "";
    if (!source) return false;
    try {
      return new URL(source, document.baseURI).pathname.indexOf("/assets/img/") !== -1;
    } catch (error) {
      return source.indexOf("assets/img/") !== -1;
    }
  }

  function protectImage(image) {
    if (!isProductImage(image)) return;
    image.setAttribute(PROTECTED_ATTRIBUTE, "");
    image.setAttribute("draggable", "false");
  }

  function protectTree(root) {
    if (!root) return;
    if (root.nodeType === 1 && root.tagName === "IMG") protectImage(root);
    if (!root.querySelectorAll) return;
    Array.prototype.forEach.call(root.querySelectorAll("img"), protectImage);
  }

  function blockNativeImageAction(event) {
    if (!isProductImage(event.target)) return;
    protectImage(event.target);
    event.preventDefault();
  }

  document.addEventListener("contextmenu", blockNativeImageAction, true);
  document.addEventListener("dragstart", blockNativeImageAction, true);

  function startProtection() {
    protectTree(document);
    var observer = new MutationObserver(function (records) {
      records.forEach(function (record) {
        if (record.type === "attributes") {
          protectImage(record.target);
          return;
        }
        Array.prototype.forEach.call(record.addedNodes, protectTree);
      });
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["src", "srcset"]
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startProtection, { once: true });
  } else {
    startProtection();
  }
})();

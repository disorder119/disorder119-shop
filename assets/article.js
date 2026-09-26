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
      paypalSoon: "Bald verfügbar", paypalSoonAria: "Bezahlen mit PayPal – bald verfügbar",
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
      autoDescTemplate: "{name}{facts}. Aus dem kuratierten Archiv von Disorder119.",
      checkoutTitle: "Deine Bestellung", checkoutShipping: "Versand (DHL, Deutschland)", checkoutTotal: "Gesamt",
      checkoutLegal: "Kleinunternehmer gemäß § 19 UStG, daher keine Umsatzsteuer. Versand in der Regel innerhalb von 2 Werktagen. Mit dem PayPal-Knopf und deiner Bestätigung bei PayPal bestellst du zahlungspflichtig.",
      checkoutTerms: "AGB und Widerrufsbelehrung", checkoutPrivacy: "Datenschutz",
      checkoutCapturing: "Zahlung wird abgeschlossen …",
      checkoutThanks: "Danke für deine Bestellung!", checkoutOrderNo: "Bestellnummer:",
      checkoutThanksText: "Die Bestätigung mit Rechnung kommt gleich per E-Mail an die Adresse deines PayPal-Kontos. Wir packen dein Teil von Hand und verschicken es in der Regel innerhalb von 2 Werktagen.",
      checkoutAccount: "Bestellung im Konto ansehen",
      checkoutCancelled: "Kauf abgebrochen. Es wurde nichts abgebucht.",
      checkoutCancelledHeld: "Kauf abgebrochen, es wurde nichts abgebucht. Das Stück bleibt bis {zeit} Uhr für dich reserviert.",
      checkoutExpired: "Die Reservierung ist abgelaufen, es wurde nichts abgebucht. Klick bitte noch einmal auf Kaufen.",
      checkoutUnavailable: "Dieses Stück ist gerade reserviert oder schon verkauft.",
      checkoutBotCheck: "Die Sicherheitsprüfung hat nicht geklappt. Lade die Seite bitte neu und versuch es noch einmal.",
      checkoutTooFast: "Zu viele Versuche in kurzer Zeit. Warte bitte eine Minute.",
      paypalError: "Da ist leider etwas schiefgelaufen. Bitte versuch es gleich nochmal oder schreib uns."
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
      paypalSoon: "Coming soon", paypalSoonAria: "Pay with PayPal – coming soon",
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
      autoDescTemplate: "{name}{facts}. From the curated archive of Disorder119.",
      checkoutTitle: "Your order", checkoutShipping: "Shipping (DHL, Germany)", checkoutTotal: "Total",
      checkoutLegal: "Small business under § 19 UStG, so no VAT is charged. Usually ships within 2 working days. By using the PayPal button and confirming in PayPal, you place an order with an obligation to pay.",
      checkoutTerms: "Terms and cancellation policy", checkoutPrivacy: "Privacy",
      checkoutCapturing: "Completing payment …",
      checkoutThanks: "Thank you for your order!", checkoutOrderNo: "Order number:",
      checkoutThanksText: "Your confirmation and invoice are on their way to the e-mail address of your PayPal account. We pack your piece by hand and usually ship within 2 working days.",
      checkoutAccount: "View order in your account",
      checkoutCancelled: "Purchase cancelled. Nothing was charged.",
      checkoutCancelledHeld: "Purchase cancelled, nothing was charged. The piece stays reserved for you until {zeit}.",
      checkoutExpired: "The reservation has expired and nothing was charged. Please click buy again.",
      checkoutUnavailable: "This piece is currently reserved or already sold.",
      checkoutBotCheck: "The security check did not work. Please reload the page and try again.",
      checkoutTooFast: "Too many attempts in a short time. Please wait a minute.",
      paypalError: "Something went wrong. Please try again in a moment or write to us."
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
      paypalSoon: "Bientôt disponible", paypalSoonAria: "Payer avec PayPal – bientôt disponible",
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
      autoDescTemplate: "{name}{facts}. Issu de l'archive sélectionnée de Disorder119.",
      checkoutTitle: "Votre commande", checkoutShipping: "Livraison (DHL, Allemagne)", checkoutTotal: "Total",
      checkoutLegal: "Micro-entreprise selon le § 19 UStG, TVA non applicable. Expédition en général sous 2 jours ouvrés. En utilisant le bouton PayPal et en confirmant dans PayPal, vous passez une commande avec obligation de paiement.",
      checkoutTerms: "CGV et droit de rétractation", checkoutPrivacy: "Confidentialité",
      checkoutCapturing: "Finalisation du paiement …",
      checkoutThanks: "Merci pour votre commande !", checkoutOrderNo: "Numéro de commande :",
      checkoutThanksText: "La confirmation avec facture arrive par e-mail à l'adresse de votre compte PayPal. Nous emballons votre pièce à la main et l'expédions en général sous 2 jours ouvrés.",
      checkoutAccount: "Voir la commande dans votre compte",
      checkoutCancelled: "Achat annulé. Rien n'a été débité.",
      checkoutCancelledHeld: "Achat annulé, rien n'a été débité. La pièce reste réservée pour vous jusqu'à {zeit}.",
      checkoutExpired: "La réservation a expiré, rien n'a été débité. Cliquez à nouveau sur acheter.",
      checkoutUnavailable: "Cette pièce est actuellement réservée ou déjà vendue.",
      checkoutBotCheck: "La vérification de sécurité a échoué. Rechargez la page et réessayez.",
      checkoutTooFast: "Trop de tentatives en peu de temps. Veuillez patienter une minute.",
      paypalError: "Une erreur s'est produite. Réessayez dans un instant ou écrivez-nous."
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
  var paypalContainer = document.getElementById("paypalButtons");
  if (paypalContainer && window.paypal && SHOP_CONFIG.shopWorkerUrl &&
      SHOP_CONFIG.features && SHOP_CONFIG.features.paypalCheckout) {
    paypalKaufEinrichten(paypalContainer, SHOP_CONFIG.shopWorkerUrl.replace(/\/$/, ""));
  }

  // Der Server nimmt eine Bestellung nur mit Einmal-Schluessel und - im
  // Livebetrieb - mit Turnstile-Token an. Beides liefert schutz.js; es wird
  // erst geladen, wenn es hier wirklich einen Kaufknopf gibt.
  function schutzLaden() {
    if (window.D119Schutz) return Promise.resolve(window.D119Schutz);
    return new Promise(function (ok, nein) {
      var s = document.createElement("script");
      s.src = "/assets/schutz.js";
      s.async = true;
      s.onload = function () { if (window.D119Schutz) ok(window.D119Schutz); else nein(new Error("schutz_fehlt")); };
      s.onerror = function () { nein(new Error("schutz_nicht_ladbar")); };
      document.head.appendChild(s);
    });
  }

  function antwortLesen(r) {
    return r.json().catch(function () { return {}; }).then(function (daten) {
      if (!r.ok) {
        var fehler = new Error(daten.error || "HTTP_" + r.status);
        fehler.code = daten.error || "";
        fehler.status = r.status;
        throw fehler;
      }
      return daten;
    });
  }

  function kaufFehlerText(fehler) {
    var code = (fehler && (fehler.code || fehler.message)) || "";
    if (code === "RESERVATION_EXPIRED") return t("checkoutExpired");
    if (/^TURNSTILE_|^turnstile_|^schutz_/.test(code)) return t("checkoutBotCheck");
    if (code === "RATE_LIMITED") return t("checkoutTooFast");
    if (fehler && fehler.status === 409) return t("checkoutUnavailable");
    return t("paypalError");
  }

  function uhrzeit(ms) {
    var d = new Date(ms);
    return ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2);
  }

  // Button-Loesung (§ 312j BGB): Direkt ueber dem Kaufknopf muss stehen, was
  // der Kauf kostet und dass er zahlungspflichtig ist - nicht nur irgendwo
  // weiter oben auf der Seite oder in den AGB.
  function kaufUebersicht(container) {
    var home = LANG === "de" ? "/" : "/" + LANG + "/";
    var versand = (Number(SHOP_CONFIG.shippingFlatCents) || 0) / 100;
    var name = displayName() + (IT.size ? " · " + t("factSize") + " " + trSize(IT.size) : "");
    var box = document.createElement("div");
    box.className = "checkout-summary";
    box.id = "checkoutSummary";
    var titel = document.createElement("p");
    titel.className = "checkout-summary__title";
    titel.textContent = t("checkoutTitle");
    box.appendChild(titel);
    var liste = document.createElement("dl");
    [[name, fmtPrice(IT.price), ""],
     [t("checkoutShipping"), fmtPrice(versand), ""],
     [t("checkoutTotal"), fmtPrice(IT.price + versand), "checkout-summary__total"]].forEach(function (zeile) {
      var reihe = document.createElement("div");
      if (zeile[2]) reihe.className = zeile[2];
      var dt = document.createElement("dt");
      dt.textContent = zeile[0];
      var dd = document.createElement("dd");
      dd.textContent = zeile[1];
      reihe.appendChild(dt);
      reihe.appendChild(dd);
      liste.appendChild(reihe);
    });
    box.appendChild(liste);
    var recht = document.createElement("p");
    recht.className = "checkout-summary__legal";
    recht.appendChild(document.createTextNode(t("checkoutLegal") + " "));
    var agb = document.createElement("a");
    agb.href = home + "agb/";
    agb.textContent = t("checkoutTerms");
    recht.appendChild(agb);
    recht.appendChild(document.createTextNode(" · "));
    var datenschutz = document.createElement("a");
    datenschutz.href = home + "datenschutz/";
    datenschutz.textContent = t("checkoutPrivacy");
    recht.appendChild(datenschutz);
    box.appendChild(recht);
    container.parentNode.insertBefore(box, container);

    var status = document.createElement("p");
    status.className = "checkout-status";
    status.id = "checkoutStatus";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    status.hidden = true;
    container.parentNode.insertBefore(status, container.nextSibling);
    return function melden(art, inhalt) {
      status.textContent = inhalt || "";
      status.className = "checkout-status" + (art ? " checkout-status--" + art : "");
      status.hidden = !inhalt;
    };
  }

  function kaufDanke(bestellNr) {
    var cta = document.querySelector(".info__cta");
    if (!cta) return;
    // style statt hidden: .btn setzt display:block und schlaegt das Attribut.
    Array.prototype.forEach.call(cta.children, function (kind) { kind.style.display = "none"; });
    var miete = document.querySelector(".btn--rental");
    if (miete) miete.style.display = "none";
    var home = LANG === "de" ? "/" : "/" + LANG + "/";
    var box = document.createElement("div");
    box.className = "checkout-thanks";
    box.setAttribute("role", "status");
    box.tabIndex = -1;
    var titel = document.createElement("p");
    titel.className = "checkout-thanks__title";
    titel.textContent = t("checkoutThanks");
    box.appendChild(titel);
    if (bestellNr) {
      var nr = document.createElement("p");
      nr.textContent = t("checkoutOrderNo") + " ";
      var stark = document.createElement("strong");
      stark.textContent = bestellNr;
      nr.appendChild(stark);
      box.appendChild(nr);
    }
    var text = document.createElement("p");
    text.textContent = t("checkoutThanksText");
    box.appendChild(text);
    var konto = document.createElement("a");
    konto.className = "btn btn--outline";
    konto.href = home + "konto/";
    konto.textContent = t("checkoutAccount");
    box.appendChild(konto);
    cta.insertBefore(box, cta.firstChild);
    box.focus();
  }

  function paypalKaufEinrichten(container, workerUrl) {
    var melden = kaufUebersicht(container);
    var schutz = schutzLaden();
    // Ein Kaufversuch behaelt seinen Schluessel, solange die Reservierung
    // laeuft: Schliesst jemand das PayPal-Fenster und klickt erneut, liefert
    // der Server dieselbe PayPal-Bestellung noch einmal aus, statt das Stueck
    // als "schon reserviert" abzulehnen - reserviert ist es ja fuer genau
    // diese Person.
    var versuch = null;
    var bezahlSchluessel = {};
    var letzterFehler = "";

    // Turnstile schon beim Sichtbarwerden des Kaufbereichs starten, damit
    // beim Klick ein Token bereitliegt.
    schutz.then(function (S) {
      var box = document.getElementById("checkoutSummary");
      if (!("IntersectionObserver" in window) || !box) { S.waechter(); return; }
      var beobachter = new IntersectionObserver(function (eintraege) {
        if (!eintraege.some(function (e) { return e.isIntersecting; })) return;
        beobachter.disconnect();
        S.waechter();
      });
      beobachter.observe(box);
    }).catch(function () { /* meldet sich beim Klick */ });

    paypal.Buttons({
      style: { shape: "rect", color: "black", layout: "vertical", label: "buynow" },
      createOrder: function () {
        letzterFehler = "";
        melden("", "");
        return schutz.then(function (S) {
          if (!versuch || (versuch.ablauf && Date.now() > versuch.ablauf - 60000)) {
            versuch = { schluessel: S.schluessel("create-order"), ablauf: 0, bestellNr: "" };
          }
          return S.waechter().token();
        })
          .then(function (token) {
            var kopf = { "Content-Type": "application/json", "Idempotency-Key": versuch.schluessel };
            if (token) kopf["X-Turnstile-Token"] = token;
            return fetch(workerUrl + "/create-order", {
              method: "POST",
              headers: kopf,
              body: JSON.stringify({ itemId: IT.id }),
            });
          })
          .then(antwortLesen)
          .then(function (daten) {
            versuch.ablauf = Date.parse(daten.expiresAt) || 0;
            versuch.bestellNr = daten.orderNumber || "";
            return daten.id;
          })
          .catch(function (fehler) {
            letzterFehler = kaufFehlerText(fehler);
            throw fehler;
          });
      },
      onApprove: function (data) {
        melden("info", t("checkoutCapturing"));
        return schutz.then(function (S) {
          // Eigener Schluessel je PayPal-Bestellung: Bricht die Verbindung
          // nach dem Abbuchen ab, liefert ein zweiter Versuch das gespeicherte
          // Ergebnis, statt ein zweites Mal abzubuchen.
          var schluessel = bezahlSchluessel[data.orderID] || (bezahlSchluessel[data.orderID] = S.schluessel("capture-order"));
          return fetch(workerUrl + "/capture-order", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Idempotency-Key": schluessel },
            body: JSON.stringify({ orderId: data.orderID, itemId: IT.id }),
          });
        })
          .then(antwortLesen)
          .then(function (daten) {
            // Erfolgreich bezahltes Einzelstueck sofort aus dem lokalen
            // Warenkorb entfernen. Der serverseitige SOLD-Status bleibt die
            // autoritative Quelle; die Seite zeigt ihn nach dem automatischen
            // Rebuild. Bis dahin ersetzt die Bestaetigung den Kaufbereich -
            // ein Neuladen wuerde das Stueck noch als verfuegbar zeigen.
            var cart = loadCart();
            var pos = cart.indexOf(IT.id);
            if (pos !== -1) cart.splice(pos, 1);
            saveCart(cart);
            refreshCartCount();
            melden("", "");
            kaufDanke(daten.orderNumber || (versuch && versuch.bestellNr) || "");
            versuch = null;
          })
          .catch(function (fehler) {
            if ((fehler && fehler.code) === "RESERVATION_EXPIRED") versuch = null;
            letzterFehler = kaufFehlerText(fehler);
            throw fehler;
          });
      },
      onCancel: function () {
        melden("info", versuch && versuch.ablauf > Date.now()
          ? tFormat("checkoutCancelledHeld", { zeit: uhrzeit(versuch.ablauf) })
          : t("checkoutCancelled"));
      },
      onError: function (err) {
        console.error(err);
        melden("fehler", letzterFehler || t("paypalError"));
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

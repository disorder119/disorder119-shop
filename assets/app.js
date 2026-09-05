(function () {
  "use strict";

  // Artikeldaten liegen als eigene Datei vor (nicht mehr in dieses Skript
  // eingebettet) - das haelt index.html/cart/impressum/... klein und laesst
  // den Browser diese Datei wie app.css/app.js separat cachen. catalog.json
  // statt items.json: von build_catalog_json() erzeugt, enthaelt keine
  // DRAFT-Artikel (die duerfen nie im Netzwerk-Payload landen) und hat
  // bereits normalisierte Markennamen (siehe BRAND_ALIASES in build_site.py).
  fetch("/data/catalog.json").then(function (r) { return r.json(); }).then(function (ITEMS) {

  var canHover = window.matchMedia("(hover: hover) and (pointer: fine)").matches;

  function fmtPrice(v) {
    return v.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
  }

  // Ein paar Artikel haben (noch) keinen Preis in der Datenbank (0 oder leer).
  // "0,00 €" würde wie ein kostenloser Artikel aussehen - stattdessen anfragen lassen.
  function fmtPriceDisplay(v) {
    return v > 0 ? fmtPrice(v) : t("priceOnRequest");
  }

  function escapeHtml(s) {
    var div = document.createElement("div");
    div.textContent = s || "";
    return div.innerHTML;
  }

  // Gemeinsame Fokus-Falle fuer Dialog-Overlays (Menue, Warenkorb, Produkt-
  // Schnellansicht, Verleih-Anfrage): Tab/Shift+Tab bleiben innerhalb des
  // Dialogs statt in den (vom Backdrop verdeckten) Hintergrund zu springen.
  // isOpenFn prueft, ob das Overlay gerade sichtbar ist (Tastatur-Events
  // laufen global auf document, sollen aber nur greifen, wenn das jeweilige
  // Overlay tatsaechlich offen ist).
  function bindFocusTrap(containerEl, isOpenFn, closeFn) {
    document.addEventListener("keydown", function (e) {
      if (!isOpenFn()) return;
      if (e.key === "Escape") { closeFn(); return; }
      if (e.key !== "Tab") return;
      var focusables = containerEl.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
      if (!focusables.length) return;
      var first = focusables[0], last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
  }

  function productAltText(it) {
    var title = it.title || "";
    var brand = it.brand || "";
    if (!brand || title.toLowerCase().indexOf(brand.toLowerCase()) === 0) return title;
    return brand + " " + title;
  }

  // ---- Sprachen (DE Standard, EN/FR unter eigenen /en/-/fr/-URLs) ----
  // Jede Sprache hat eine echte eigene URL (/, /en/, /fr/ - siehe hreflang-Tags
  // im <head>), damit Suchmaschinen pro Sprache die richtige Seite indexieren
  // koennen. Die URL ist deshalb die alleinige Quelle fuer LANG beim Laden -
  // localStorage wuerde sonst z.B. "/" fuer einen EN-Nutzer auf Englisch
  // rendern, obwohl die Seite sich selbst per hreflang als Deutsch deklariert.
  var LANG_KEY = "disorder119_lang";
  var PATH_LANG_MATCH = /^\/(en|fr)\/(.*)$/.exec(location.pathname);
  var LANG = PATH_LANG_MATCH ? PATH_LANG_MATCH[1] : "de";
  var PATH_REST = PATH_LANG_MATCH ? PATH_LANG_MATCH[2] : location.pathname.replace(/^\//, "");
  function langHome(lang) { return lang === "de" ? "/" : "/" + lang + "/"; }

  var I18N = {
    de: {
      langGroupAria: "Sprache wählen", cartOpenAria: "Warenkorb öffnen",
      eyebrow: "Designer-, Vintage- und Contemporary-Pieces mit Fokus auf Qualität, Authentizität und Zeitlosigkeit",
      wordmarkKicker: "Das kuratierte Archiv von",
      metaTotalLabel: "Objekte im Archiv", metaAvailableLabel: "Verfügbar", metaBrandsLabel: "Marken",
      brandLineMore: "u.v.m.",
      searchPlaceholder: "Suche nach Marke, Titel",
      statusAll: "Alle", statusAvailable: "Verfügbar", statusSold: "Archiv",
      categoryAll: "Alle Kategorien",
      sortBrightness: "Hell → Dunkel", sortNew: "Neueste zuerst", sortPriceAsc: "Preis aufsteigend",
      sortPriceDesc: "Preis absteigend", sortBrand: "Marke A–Z",
      mountBlack: "Fotomontage: Schwarz", mountWhite: "Fotomontage: Weiß",
      moreFilters: "Weitere Filter",
      filterDepartmentLabel: "Bereich", filterAllDepartments: "Alle Bereiche",
      filterProductTypeLabel: "Produkttyp", filterAllProductTypes: "Alle Produkttypen",
      filterBrandLabel: "Marke", filterAllBrands: "Alle Marken",
      filterSizeLabel: "Größe", filterAllSizes: "Alle Größen",
      filterColorLabel: "Farbe", filterAllColors: "Alle Farben",
      filterConditionLabel: "Zustand", filterAllConditions: "Alle Zustände",
      filterPriceLabel: "Preis (€)", filterPriceFrom: "von", filterPriceTo: "bis",
      filterResetLabel: "Filter zurücksetzen",
      activeFiltersAria: "Aktive Filter", activeFilterSearch: "Suche",
      activeFilterDepartment: "Bereich", activeFilterProductType: "Produkttyp",
      activeFilterBrand: "Marke", activeFilterSize: "Größe", activeFilterColor: "Farbe",
      activeFilterCondition: "Zustand", activeFilterPrice: "Preis", activeFilterCategory: "Kategorie",
      activeFilterStatus: "Status", activeFilterRemove: "entfernen", activeFilterClear: "Alle Filter löschen",
      railCountTemplate: "{filtered} von {total} Objekten",
      emptyTitle: "Keine Treffer im Archiv",
      emptyBody: "Versuche einen anderen Suchbegriff oder setze die Filter zurück.",
      footerTagline: "Kuratiertes Second-Hand-Archiv für Designer- und Vintage-Mode.",
      menuTitle: "Menü", menuAllItems: "Alle Artikel", menuJackets: "Jacken", menuTops: "Tops",
      menuPants: "Hosen", menuSkirts: "Röcke", menuDresses: "Kleider", menuShoes: "Schuhe",
      menuAccessories: "Accessoires", menuBrands: "Marken", menuArchive: "Archiv",
      menuCart: "Warenkorb",
      loadMore: "Weitere laden", footerAbout: "Über Disorder119", footerFaq: "FAQ", footerContact: "Kontakt",
      aboutHtml: "<h2>Über Disorder119</h2><p>DISORDER119 ist ein unabhängig geführtes, kuratiertes Archiv für ausgewählte Designer-, Vintage- und Contemporary-Pieces mit Fokus auf Qualität, Authentizität und Zeitlosigkeit.</p><h3>Auswahl &amp; Dokumentation</h3><p>Jedes angebotene Stück wird einzeln ausgewählt, fotografiert und beschrieben. Da es sich überwiegend um gebrauchte Einzelstücke handelt, werden Zustand und erkennbare Besonderheiten nach bestem Wissen dokumentiert. Wenn zu einem Artikel Angaben fehlen oder du zusätzliche Detailfotos oder Maße brauchst, klären wir das vor dem Kauf.</p><h3>Transparent einkaufen</h3><p>Hinter Disorder119 steht Joel Bittner als Einzelunternehmer in Aschaffenburg. Anbieterangaben, Widerrufsbelehrung, Gewährleistungsinformationen und Datenschutz findest du jederzeit in Impressum, AGB und Datenschutz.</p>",
      faqHtml: "<h2>FAQ</h2><h3>Sind alle Artikel Einzelstücke?</h3><p>Ja. Alle verfügbaren Artikel sind kuratierte Einzelstücke. Deshalb kann ein Artikel nach Verkauf nicht erneut bestellt werden.</p><h3>Wie funktioniert eine Bestellung?</h3><p>Lege verfügbare Artikel in den Warenkorb und sende die Bestellanfrage über die angebotene Kontaktmöglichkeit. Die Anfrage ist zunächst unverbindlich. Verfügbarkeit, Gesamtpreis, Zahlungsart und Versand werden bestätigt; erst mit dieser Bestätigung kommt der Kaufvertrag zustande.</p><h3>Sind die Artikel neu?</h3><p>In der Regel nicht. Disorder119 ist ein Designer-, Vintage- und Second-Hand-Archiv. Zustand und erkennbare Besonderheiten werden nach bestem Wissen in den Produktangaben beschrieben.</p><h3>Was ist, wenn Angaben wie Größe, Zustand oder Maße fehlen?</h3><p>Dann solltest du vor dem Kauf nachfragen. Zusätzliche Maße, Detailfotos und produktbezogene Informationen können vor Vertragsabschluss geklärt werden.</p><h3>Wie wird mit Authentizität umgegangen?</h3><p>Authentizität ist Teil des Auswahlfokus von Disorder119. Eine Prüfung oder Zertifizierung durch den jeweiligen Markenhersteller oder einen externen Authentifizierungsdienst wird jedoch nur dann zugesichert, wenn dies beim konkreten Artikel ausdrücklich angegeben ist. Bei Fragen können zusätzliche Detailfotos angefragt werden.</p><h3>Kann ich widerrufen und welche Gewährleistung gilt?</h3><p>Für Verbraucher:innen gilt das gesetzliche 14-tägige Widerrufsrecht. Außerdem gelten die gesetzlichen Gewährleistungsrechte. Die vollständigen Bedingungen und die Widerrufsbelehrung findest du in den AGB.</p><h3>Wie werden meine Daten behandelt?</h3><p>Die Website verwendet keine Analyse-, Marketing- oder Tracking-Cookies. Warenkorb und Outfit-Baukasten werden lokal im Browser gespeichert. Details findest du in der Datenschutzerklärung.</p><h3>Warum bleiben verkaufte Artikel sichtbar?</h3><p>Verkaufte Pieces bleiben als Teil des DISORDER119-Archivs sichtbar und sind eindeutig als verkauft gekennzeichnet.</p>",
      legalImpressum: "Impressum", legalAgb: "AGB", legalDatenschutz: "Datenschutz",
      legalEmailPending: "wird nachgereicht, sobald der Shop live geht",
      closeAria: "Schließen",
      cookieText: "Diese Seite verwendet keine Tracking- oder Marketing-Cookies. Warenkorb und Outfit-Baukasten speichern deine Auswahl nur lokal in deinem Browser (localStorage), damit sie beim nächsten Besuch noch da ist — diese Daten verlassen nie deinen Browser.",
      cookieOk: "Verstanden",
      shareAria: "Teilen", shareToast: "Link kopiert",
      prevPhotoAria: "Vorheriges Foto", nextPhotoAria: "Nächstes Foto",
      modalNote: "Disorder119-Archiv",
      factCategory: "Kategorie", factSize: "Größe", factColor: "Farbe", factCondition: "Zustand",
      noBrand: "Ohne Marke", noDesc: "Keine Beschreibung hinterlegt.",
      priceOnRequest: "Preis auf Anfrage", priceEstimatedPrefix: "ca. ", priceEstimatedBadge: "Preis wird geprüft",
      sold: "Verkauft", priceOnRequestCta: "Preis auf Anfrage — bitte kontaktieren",
      soldArchiveBadge: "SOLD — DISORDER119 ARCHIVE",
      inCartRemove: "Im Warenkorb ✓ — entfernen", addToCart: "In den Warenkorb",
      removeFromCartAria: "Aus Warenkorb entfernen",
      cartHeading: "Warenkorb", cartAria: "Warenkorb", cartEmpty: "Dein Warenkorb ist leer.",
      cartItemsRemovedSold: "Inzwischen verkauft und aus dem Warenkorb entfernt: {items}.",
      cartRemove: "Entfernen", cartTotal: "Gesamt",
      cartWhatsapp: "Anfrage per WhatsApp senden", cartEmail: "Anfrage per E-Mail senden",
      cartConfigWarning: "Shop-Kontakt noch nicht eingerichtet: Trage in index.html bei SHOP_CONFIG deine WhatsApp-Nummer oder E-Mail-Adresse ein, damit Bestellanfragen bei dir ankommen.",
      cartNote: "Alle Artikel sind Einzelstücke. Nach deiner Anfrage bestätigen wir Verfügbarkeit, Gesamtpreis, Zahlungs- und Versandart. Erst mit dieser Bestätigung kommt der Kaufvertrag zustande. Für Verbraucher:innen gilt das gesetzliche 14-tägige Widerrufsrecht.",
      orderGreeting: "Hallo! Ich interessiere mich für folgende Artikel aus dem Disorder119-Archiv:",
      orderAvailQuestion: "Sind diese Artikel noch verfügbar?", orderSubject: "Bestellanfrage Disorder119",
      orderSizeAbbrev: "Gr. ", orderArticleAbbrev: "Art.-Nr. ",
      modeArchiv: "Archiv", modeMatch: "Match", modeChaos: "Chaos", modeBaukasten: "Baukasten",
      menuRental: "Verleih",
      pageTitleHome: "Disorder119 — Archiv-Katalog", pageTitleMatch: "Disorder119 — Match",
      pageTitleChaos: "Disorder119 — Chaos", pageTitleOutfit: "Disorder119 — Outfit-Baukasten",
      modeHint: "Entdecke auch Match, Chaos & Baukasten", hintCloseAria: "Hinweis schließen",
      modeRailAria: "Ansicht wechseln",
      rentalCta: "Für Miete anfragen", rentalCloseAria: "Schließen",
      rentalPriceLabel: "Mietpreis", rentalPriceOnRequest: "Mietpreis auf Anfrage",
      rentalSoldNote: "Bereits verkauft – nicht mehr mietbar",
      rentalModalTitle: "Stück ausleihen",
      rentalStartLabel: "Von", rentalEndLabel: "Bis",
      rentalDaysTemplate: "{days} Tag(e) ausgewählt",
      rentalPurposeLabel: "Verwendungszweck",
      rentalPurposeVideo: "Musikvideo", rentalPurposePhoto: "Fotoshooting",
      rentalPurposeFilmTheater: "Film/Theater/Bühne", rentalPurposeEditorial: "Redaktionell/Editorial",
      rentalPurposeEvent: "Event/Ausstellung", rentalPurposePrivate: "Privater Anlass",
      rentalPurposeOther: "Sonstiges",
      rentalMessageLabel: "Nachricht (optional)",
      rentalMessagePh: "z. B. Produktion, Set, Anlass, Ansprechpartner …",
      rentalNote: "Dies ist eine unverbindliche Anfrage, keine Buchung. Verfügbarkeit, Kaution und Konditionen bestätige ich dir persönlich.",
      rentalDateError: "Bitte wähle ein gültiges Zeitfenster (Ende nach oder gleich Beginn).",
      rentalWhatsapp: "Anfrage per WhatsApp senden", rentalEmail: "Anfrage per E-Mail senden",
      rentalConfigWarning: "Shop-Kontakt noch nicht eingerichtet: Trage in config/shop-config.json deine WhatsApp-Nummer oder E-Mail-Adresse ein, damit Verleih-Anfragen bei dir ankommen.",
      rentalSubject: "Verleih-Anfrage Disorder119",
      rentalEmailIntro: "Hallo!\n\nIch interessiere mich für folgendes Stück aus dem Disorder119-Archiv und würde es gerne ausleihen:\n\n{item}",
      rentalEmailClosing: "Über eine Rückmeldung zu Verfügbarkeit, Mietpreis und Kaution würde ich mich freuen.\n\nViele Grüße",
      rentalPeriodLabel: "Zeitraum", rentalPurposeMsgLabel: "Zweck", rentalMessageMsgLabel: "Nachricht",
      pageTitleMieten: "Disorder119 — Mieten & Ausleihen",
      mietenCatalogHeading: "Mieten & Ausleihen",
      mietenIntroTitle: "Mieten & Ausleihen",
      mietenIntroLead: "Jedes verfügbare Stück im Archiv kann auch geliehen statt gekauft werden — für Shootings, Musikvideos, Film- und Theaterproduktionen, redaktionelle Strecken, Events oder private Anlässe. Wähle unten ein Stück und sende eine unverbindliche Anfrage mit deinem Wunschzeitraum.",
      mietenTermsHeading: "Wie die Miete funktiert",
      mietenTermsHtml: "<ul><li><strong>Mietpreis:</strong> in der Regel ca. 15&nbsp;% des im Archiv angegebenen Preises pro Zeitraum von bis zu 4 Tagen (Richtwert — der genaue Preis wird bei jeder Anfrage persönlich bestätigt, abhängig von Stück und Zeitraum).</li><li><strong>Kaution:</strong> wird bei Abholung/Versand hinterlegt und nach unbeschädigter, vollständiger Rückgabe innerhalb von 7 Tagen zurückerstattet.</li><li><strong>Reinigung:</strong> normale Gebrauchsspuren und einfache Verschmutzungen sind im Mietpreis enthalten. Für die professionelle Reinigung nach der Nutzung wird ggf. eine Reinigungspauschale einbehalten.</li><li><strong>Schäden:</strong> Reparable Schäden werden von der Kaution beglichen; bei nicht behebbaren Schäden oder Verlust wird der aktuelle Archivwert des Stücks fällig.</li><li><strong>Zeitraum:</strong> Standard bis zu 4 Tage, längere Zeiträume auf Anfrage möglich.</li><li>Alle Angaben sind unverbindlich und werden bei jeder Anfrage individuell bestätigt — dies ist kein automatisiertes Buchungssystem.</li></ul>",
      toArchive: "Zum Archiv →",
      swipeHint: "Ziehen oder klicken — ✕ überspringen, ♥ merken",
      swipeRoundDone: "Runde beendet", swipeSavedInCart: "Teile gemerkt &amp; im Warenkorb",
      swipeViewCart: "Warenkorb ansehen", swipePlayAgain: "Nochmal spielen", swipeNopeTag: "Nope",
      swipeNopeAria: "Nicht mein Stil", swipeLikeAria: "Merken",
      chaosLabel: "Chaos-Ansicht — anklicken für Details",
      chaosShuffle: "Neu mischen",
      outfitEyebrow: "Outfit-Baukasten", outfitTitle: "Bau dir einen Look",
      outfitPickerCloseAria: "Schließen",
      outfitPickerChoose: "wählen", outfitPickerSearchPh: "Suche nach Marke, Titel …",
      outfitPickerAllSizes: "Alle Größen", outfitPickerPriceMaxPh: "Preis bis (€)",
      outfitEmptyOptions: "Keine Treffer.", outfitChoose: "Wählen …",
      outfitDressCovers: "Das Kleid deckt das schon ab",
      outfitStatusStart: "Wähl ein Oberteil oder Kleid zum Start.",
      outfitStatusComplete: "Kompletter Look! 🔥",
      outfitStatusProgress: "{filled} von {required} Pflichtteilen ausgewählt.",
      outfitSlotTop: "Oberteil / Kleid", outfitSlotJacket: "Jacke (optional)", outfitSlotBottom: "Unterteil",
      outfitSlotShoes: "Schuhe", outfitSlotAccessory: "Accessoire",
      outfitRandomAria: "Überrasch mich", outfitResetLabel: "Neu",
      outfitLookLabel: "Dein Look", outfitEmptyLook: "Wähl Teile aus,<br>um deinen Look zu sehen.",
      catJackets: "Jacken", catCoats: "Mäntel", catTops: "Tops", catShirts: "Hemden/Shirts",
      catKnitwear: "Strickwaren", catPants: "Hosen", catSkirts: "Röcke", catDresses: "Kleider",
      catShoes: "Schuhe", catAccessories: "Accessoires", catObjects: "Objekte",
      condRepariert: "Repariert", condDefekt: "Mit Defekt",
      condGut: "Gut", condSehrGut: "Sehr gut", condZufriedenstellend: "Zufriedenstellend",
      sizeEinheitsgroesse: "Einheitsgröße", sizeVerstellbar: "verstellbar", sizeKidsL: "Kindergröße L",
      autoDescTemplate: "{name}{facts}. Aus dem kuratierten Archiv von Disorder119.",
      legalImpressumHtml: "<h2>Impressum</h2>" +
        "<p>Angaben gemäß § 5 DDG</p>" +
        "<p>Joel Bittner<br>Disorder119 (Einzelunternehmen)<br>Nelseestraße 25<br>63739 Aschaffenburg<br>Deutschland</p>" +
        "<h3>Kontakt</h3><p>E-Mail: {email}</p>" +
        "<h3>Umsatzsteuer</h3><p>Kleinunternehmer gemäß § 19 UStG — es wird keine Umsatzsteuer ausgewiesen.</p>" +
        "<h3>Verantwortlich für den Inhalt nach § 18 Abs. 2 MStV</h3><p>Joel Bittner (Anschrift wie oben)</p>" +
        "<h3>Streitschlichtung</h3><p>Wir sind nicht verpflichtet und nicht bereit, an Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle teilzunehmen.</p>",
      legalAgbHtml: "<h2>Allgemeine Geschäftsbedingungen</h2>" +
        "<h3>1. Geltungsbereich</h3><p>Diese Bedingungen gelten für Kaufanfragen über diese Website zwischen Joel Bittner (Disorder119) und Kundinnen und Kunden.</p>" +
        "<h3>2. Zustandekommen des Vertrags</h3><p>Über den Warenkorb kann eine unverbindliche Anfrage per WhatsApp oder E-Mail gestellt werden. " +
        "Ein Kaufvertrag kommt erst durch gesonderte Bestätigung (Verfügbarkeit, Preis, Zahlungs- und Versandart) zustande — nicht bereits durch das Absenden der Anfrage.</p>" +
        "<h3>3. Artikel</h3><p>Alle angebotenen Artikel sind gebrauchte Einzelstücke (Vintage / Second Hand). Kleine gebrauchsbedingte " +
        "Abweichungen sind möglich und werden nach bestem Wissen in der Artikelbeschreibung angegeben.</p>" +
        "<h3>4. Preise &amp; Zahlung</h3><p>Alle Preise verstehen sich in Euro. Kleinunternehmer gemäß § 19 UStG, keine Umsatzsteuer ausgewiesen. " +
        "Zahlungs- und Versandart werden individuell vereinbart.</p>" +
        "<h3>5. Gewährleistung</h3><p>Es gelten die gesetzlichen Gewährleistungsrechte. Da alle Artikel gebrauchte Einzelstücke sind, wird der " +
        "Zustand nach bestem Wissen in der jeweiligen Artikelbeschreibung angegeben.</p>" +
        "<h3>6. Widerrufsbelehrung für Verbraucher:innen</h3>" +
        "<p><strong>Widerrufsrecht</strong><br>Du hast das Recht, binnen vierzehn Tagen ohne Angabe von Gründen diesen Vertrag zu widerrufen. " +
        "Die Widerrufsfrist beträgt vierzehn Tage ab dem Tag, an dem du oder ein von dir benannter Dritter, der nicht der Beförderer ist, die Waren in Besitz genommen hast bzw. hat. " +
        "Um dein Widerrufsrecht auszuüben, musst du uns (Joel Bittner, Disorder119, Nelseestraße 25, 63739 Aschaffenburg, E-Mail: {email}) mittels einer eindeutigen Erklärung " +
        "(z. B. ein mit der Post versandter Brief oder eine E-Mail) über deinen Entschluss, diesen Vertrag zu widerrufen, informieren. Du kannst dafür das unten stehende " +
        "Muster-Widerrufsformular verwenden, das ist jedoch nicht vorgeschrieben. Zur Wahrung der Widerrufsfrist reicht es aus, dass du die Mitteilung über die Ausübung " +
        "des Widerrufsrechts vor Ablauf der Widerrufsfrist absendest.</p>" +
        "<p><strong>Folgen des Widerrufs</strong><br>Wenn du diesen Vertrag widerrufst, haben wir dir alle Zahlungen, die wir von dir erhalten haben, einschließlich der Lieferkosten " +
        "(mit Ausnahme der zusätzlichen Kosten, die sich daraus ergeben, dass du eine andere Art der Lieferung als die von uns angebotene, günstigste Standardlieferung gewählt hast), " +
        "unverzüglich und spätestens binnen vierzehn Tagen ab dem Tag zurückzuzahlen, an dem die Mitteilung über deinen Widerruf dieses Vertrags bei uns eingegangen ist. Für diese " +
        "Rückzahlung verwenden wir dasselbe Zahlungsmittel, das du bei der ursprünglichen Transaktion eingesetzt hast, es sei denn, mit dir wurde ausdrücklich etwas anderes vereinbart; " +
        "in keinem Fall werden dir wegen dieser Rückzahlung Entgelte berechnet. Wir können die Rückzahlung verweigern, bis wir die Waren wieder zurückerhalten haben oder bis du den " +
        "Nachweis erbracht hast, dass du die Waren zurückgesandt hast, je nachdem, welches der frühere Zeitpunkt ist. Du hast die Waren unverzüglich und in jedem Fall spätestens binnen " +
        "vierzehn Tagen ab dem Tag, an dem du uns über den Widerruf dieses Vertrags unterrichtest, an uns zurückzusenden oder zu übergeben. Die Frist ist gewahrt, wenn du die Waren vor " +
        "Ablauf der Frist von vierzehn Tagen absendest. Du trägst die unmittelbaren Kosten der Rücksendung der Waren. Du musst für einen etwaigen Wertverlust der Waren nur aufkommen, " +
        "wenn dieser Wertverlust auf einen zur Prüfung der Beschaffenheit, Eigenschaften und Funktionsweise der Waren nicht notwendigen Umgang mit ihnen zurückzuführen ist.</p>" +
        "<p><strong>Muster-Widerrufsformular</strong><br>(Wenn du den Vertrag widerrufen willst, dann fülle bitte dieses Formular aus und sende es zurück.)</p>" +
        "<p>An: Joel Bittner, Disorder119, Nelseestraße 25, 63739 Aschaffenburg, E-Mail: {email}<br>" +
        "Hiermit widerrufe(n) ich/wir (*) den von mir/uns (*) abgeschlossenen Vertrag über den Kauf der folgenden Waren (*)/die Erbringung der folgenden Dienstleistung (*)<br>" +
        "Bestellt am (*)/erhalten am (*)<br>" +
        "Name des/der Verbraucher(s)<br>" +
        "Anschrift des/der Verbraucher(s)<br>" +
        "Unterschrift des/der Verbraucher(s) (nur bei Mitteilung auf Papier)<br>" +
        "Datum<br>" +
        "(*) Unzutreffendes streichen.</p>",
      legalDatenschutzHtml: "<h2>Datenschutzerklärung</h2>" +
        "<h3>Verantwortlicher</h3><p>Joel Bittner, Nelseestraße 25, 63739 Aschaffenburg — Kontakt siehe Impressum.</p>" +
        "<h3>Lokale Speicherung (localStorage)</h3><p>Warenkorb und Outfit-Baukasten speichern deine Auswahl ausschließlich lokal in deinem Browser " +
        "(localStorage). Diese Daten werden nicht an uns oder Dritte übertragen und verlassen nie dein Gerät. Du kannst sie jederzeit über die Browser-Einstellungen löschen.</p>" +
        "<h3>Bestellanfragen</h3><p>Wenn du über WhatsApp oder E-Mail eine Anfrage sendest, werden die von dir eingegebenen Daten " +
        "(z. B. Name, Nachricht) an den jeweiligen Dienst (WhatsApp/Meta bzw. deinen E-Mail-Anbieter) und an uns übermittelt, um deine Anfrage zu bearbeiten. Es findet keine Weitergabe an weitere Dritte statt.</p>" +
        "<h3>Hosting</h3><p>Diese Seite wird bei GitHub Pages (GitHub Inc.) gehostet. Beim Aufruf verarbeitet GitHub technisch " +
        "notwendige Zugriffsdaten (u. a. IP-Adresse) zur Auslieferung der Seite. Näheres in der " +
        '<a href="https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement" target="_blank" rel="noopener">Datenschutzerklärung von GitHub</a>.</p>' +
        "<h3>Keine Tracking-Cookies</h3><p>Diese Seite verwendet keine Analyse-, Marketing- oder Tracking-Cookies.</p>"
    },
    en: {
      langGroupAria: "Choose language", cartOpenAria: "Open cart",
      eyebrow: "Designer, vintage and contemporary pieces with a focus on quality, authenticity and timelessness",
      wordmarkKicker: "The curated archive of",
      metaTotalLabel: "Pieces in the archive", metaAvailableLabel: "Available", metaBrandsLabel: "Brands",
      brandLineMore: "& more",
      searchPlaceholder: "Search by brand, title",
      statusAll: "All", statusAvailable: "Available", statusSold: "Archive",
      categoryAll: "All categories",
      sortBrightness: "Light → dark", sortNew: "Newest first", sortPriceAsc: "Price ascending",
      sortPriceDesc: "Price descending", sortBrand: "Brand A–Z",
      mountBlack: "Photo backdrop: black", mountWhite: "Photo backdrop: white",
      moreFilters: "More filters",
      filterDepartmentLabel: "Department", filterAllDepartments: "All departments",
      filterProductTypeLabel: "Product type", filterAllProductTypes: "All product types",
      filterBrandLabel: "Brand", filterAllBrands: "All brands",
      filterSizeLabel: "Size", filterAllSizes: "All sizes",
      filterColorLabel: "Colour", filterAllColors: "All colours",
      filterConditionLabel: "Condition", filterAllConditions: "All conditions",
      filterPriceLabel: "Price (€)", filterPriceFrom: "from", filterPriceTo: "to",
      filterResetLabel: "Reset filters",
      activeFiltersAria: "Active filters", activeFilterSearch: "Search",
      activeFilterDepartment: "Department", activeFilterProductType: "Product type",
      activeFilterBrand: "Brand", activeFilterSize: "Size", activeFilterColor: "Colour",
      activeFilterCondition: "Condition", activeFilterPrice: "Price", activeFilterCategory: "Category",
      activeFilterStatus: "Status", activeFilterRemove: "remove", activeFilterClear: "Clear all filters",
      railCountTemplate: "{filtered} of {total} pieces",
      emptyTitle: "No matches in the archive",
      emptyBody: "Try a different search term or reset the filters.",
      footerTagline: "Curated second-hand archive for designer and vintage fashion.",
      menuTitle: "Menu", menuAllItems: "All pieces", menuJackets: "Jackets", menuTops: "Tops",
      menuPants: "Trousers", menuSkirts: "Skirts", menuDresses: "Dresses", menuShoes: "Shoes",
      menuAccessories: "Accessories", menuBrands: "Brands", menuArchive: "Archive",
      menuCart: "Cart",
      loadMore: "Load more", footerAbout: "About Disorder119", footerFaq: "FAQ", footerContact: "Contact",
      aboutHtml: "<h2>About Disorder119</h2><p>DISORDER119 is an independently run, curated archive of selected designer, vintage and contemporary pieces with a focus on quality, authenticity and timelessness.</p><h3>Selection &amp; documentation</h3><p>Every listed piece is individually selected, photographed and described. As most pieces are pre-owned one-offs, condition and visible characteristics are documented to the best of our knowledge. If information is missing or you need additional detail photos or measurements, we clarify this before purchase.</p><h3>Transparent shopping</h3><p>Disorder119 is operated by Joel Bittner as a sole proprietor in Aschaffenburg, Germany. Seller information, withdrawal instructions, statutory warranty information and privacy details are available at all times in the legal notice, terms and privacy policy.</p>",
      faqHtml: "<h2>FAQ</h2><h3>Is every item one of a kind?</h3><p>Yes. Every available item is a curated one-off piece, so an item cannot be ordered again once sold.</p><h3>How do orders work?</h3><p>Add available pieces to the cart and send an order enquiry through the available contact method. The enquiry is initially non-binding. Availability, total price, payment method and shipping are confirmed; the purchase contract is only formed with that confirmation.</p><h3>Are the items new?</h3><p>Usually not. Disorder119 is a designer, vintage and second-hand archive. Condition and visible characteristics are described in the product information to the best of our knowledge.</p><h3>What if size, condition or measurements are missing?</h3><p>Please ask before purchasing. Additional measurements, detail photos and product-specific information can be clarified before the contract is concluded.</p><h3>How is authenticity handled?</h3><p>Authenticity is part of Disorder119’s selection focus. Authentication or certification by the respective brand or an external authentication service is only promised when this is explicitly stated for the specific item. Additional detail photos can be requested if needed.</p><h3>Can I withdraw and what warranty applies?</h3><p>Consumers have the statutory 14-day right of withdrawal. Statutory warranty rights also apply. Full terms and withdrawal instructions are available in the terms and conditions.</p><h3>How is my data handled?</h3><p>The website does not use analytics, marketing or tracking cookies. The cart and outfit builder are stored locally in your browser. See the privacy policy for details.</p><h3>Why do sold pieces remain visible?</h3><p>Sold pieces remain visible as part of the DISORDER119 archive and are clearly marked as sold.</p>",
      legalImpressum: "Legal notice", legalAgb: "Terms", legalDatenschutz: "Privacy",
      legalEmailPending: "to be added once the shop goes live",
      closeAria: "Close",
      cookieText: "This site does not use tracking or marketing cookies. Your cart and outfit builder only save your selection locally in your browser (localStorage), so they're still there on your next visit — this data never leaves your browser.",
      cookieOk: "Got it",
      shareAria: "Share", shareToast: "Link copied",
      prevPhotoAria: "Previous photo", nextPhotoAria: "Next photo",
      modalNote: "Disorder119 archive",
      factCategory: "Category", factSize: "Size", factColor: "Colour", factCondition: "Condition",
      noBrand: "No brand", noDesc: "No description available.",
      priceOnRequest: "Price on request", priceEstimatedPrefix: "approx. ", priceEstimatedBadge: "Price being confirmed",
      sold: "Sold", priceOnRequestCta: "Price on request — please get in touch",
      soldArchiveBadge: "SOLD — DISORDER119 ARCHIVE",
      inCartRemove: "In cart ✓ — remove", addToCart: "Add to cart",
      removeFromCartAria: "Remove from cart",
      cartHeading: "Cart", cartAria: "Cart", cartEmpty: "Your cart is empty.",
      cartItemsRemovedSold: "Sold in the meantime and removed from your cart: {items}.",
      cartRemove: "Remove", cartTotal: "Total",
      cartWhatsapp: "Send request via WhatsApp", cartEmail: "Send request via e-mail",
      cartConfigWarning: "Shop contact not set up yet: add your WhatsApp number or e-mail address to SHOP_CONFIG in index.html so order requests reach you.",
      cartNote: "All pieces are one-offs. After your enquiry we confirm availability, total price, payment and shipping method. The purchase contract is only formed with that confirmation. Consumers have the statutory 14-day right of withdrawal.",
      orderGreeting: "Hello! I'm interested in the following pieces from the Disorder119 archive:",
      orderAvailQuestion: "Are these pieces still available?", orderSubject: "Order request Disorder119",
      orderSizeAbbrev: "Size ", orderArticleAbbrev: "Item no. ",
      modeArchiv: "Archive", modeMatch: "Match", modeChaos: "Chaos", modeBaukasten: "Outfit builder",
      menuRental: "Rental",
      pageTitleHome: "Disorder119 — Curated Archive", pageTitleMatch: "Disorder119 — Match",
      pageTitleChaos: "Disorder119 — Chaos", pageTitleOutfit: "Disorder119 — Outfit Builder",
      modeHint: "Also discover Match, Chaos & the outfit builder", hintCloseAria: "Close hint",
      modeRailAria: "Switch view",
      rentalCta: "Request to rent", rentalCloseAria: "Close",
      rentalPriceLabel: "Rental price", rentalPriceOnRequest: "Rental price on request",
      rentalSoldNote: "Already sold – no longer available to rent",
      rentalModalTitle: "Rent this piece",
      rentalStartLabel: "From", rentalEndLabel: "To",
      rentalDaysTemplate: "{days} day(s) selected",
      rentalPurposeLabel: "Purpose",
      rentalPurposeVideo: "Music video", rentalPurposePhoto: "Photo shoot",
      rentalPurposeFilmTheater: "Film/theatre/stage", rentalPurposeEditorial: "Editorial",
      rentalPurposeEvent: "Event/exhibition", rentalPurposePrivate: "Personal occasion",
      rentalPurposeOther: "Other",
      rentalMessageLabel: "Message (optional)",
      rentalMessagePh: "e.g. production, set, occasion, contact person …",
      rentalNote: "This is a non-binding request, not a booking. I'll confirm availability, deposit and terms with you personally.",
      rentalDateError: "Please choose a valid time window (end on or after start).",
      rentalWhatsapp: "Send request via WhatsApp", rentalEmail: "Send request via email",
      rentalConfigWarning: "Shop contact not set up yet: add your WhatsApp number or email address in config/shop-config.json so rental requests reach you.",
      rentalSubject: "Rental request Disorder119",
      rentalEmailIntro: "Hi!\n\nI'm interested in the following piece from the Disorder119 archive and would like to rent it:\n\n{item}",
      rentalEmailClosing: "I'd love to hear back about availability, rental price and deposit.\n\nBest regards",
      rentalPeriodLabel: "Period", rentalPurposeMsgLabel: "Purpose", rentalMessageMsgLabel: "Message",
      pageTitleMieten: "Disorder119 — Rent & Borrow",
      mietenCatalogHeading: "Rent & Borrow",
      mietenIntroTitle: "Rent & Borrow",
      mietenIntroLead: "Every available piece in the archive can also be rented instead of bought — for shoots, music videos, film and theatre productions, editorial stories, events or personal occasions. Pick a piece below and send a non-binding request with your preferred dates.",
      mietenTermsHeading: "How renting works",
      mietenTermsHtml: "<ul><li><strong>Rental price:</strong> typically around 15% of the archive price per period of up to 4 days (a guideline — the exact price is confirmed personally for every request, depending on the piece and duration).</li><li><strong>Deposit:</strong> collected at pickup/shipping and refunded after undamaged, complete return within 7 days.</li><li><strong>Cleaning:</strong> normal wear and light soiling are included in the rental price. A cleaning fee may be withheld for professional cleaning after use.</li><li><strong>Damage:</strong> repairable damage is settled from the deposit; for damage beyond repair or loss, the piece's current archive value becomes due.</li><li><strong>Duration:</strong> up to 4 days by default, longer periods on request.</li><li>All details are non-binding and confirmed individually for every request — this is not an automated booking system.</li></ul>",
      toArchive: "To the archive →",
      swipeHint: "Drag or click — ✕ skip, ♥ save",
      swipeRoundDone: "Round finished", swipeSavedInCart: "Pieces saved &amp; in cart",
      swipeViewCart: "View cart", swipePlayAgain: "Play again", swipeNopeTag: "Nope",
      swipeNopeAria: "Not my style", swipeLikeAria: "Save",
      chaosLabel: "Chaos view — click for details",
      chaosShuffle: "Shuffle again",
      outfitEyebrow: "Outfit builder", outfitTitle: "Build a look",
      outfitPickerCloseAria: "Close",
      outfitPickerChoose: "choose", outfitPickerSearchPh: "Search by brand, title …",
      outfitPickerAllSizes: "All sizes", outfitPickerPriceMaxPh: "Price up to (€)",
      outfitEmptyOptions: "No matches.", outfitChoose: "Choose …",
      outfitDressCovers: "The dress already covers this",
      outfitStatusStart: "Pick a top or dress to start.",
      outfitStatusComplete: "Complete look! 🔥",
      outfitStatusProgress: "{filled} of {required} required pieces selected.",
      outfitSlotTop: "Top / dress", outfitSlotJacket: "Jacket (optional)", outfitSlotBottom: "Bottoms",
      outfitSlotShoes: "Shoes", outfitSlotAccessory: "Accessory",
      outfitRandomAria: "Surprise me", outfitResetLabel: "Reset",
      outfitLookLabel: "Your look", outfitEmptyLook: "Pick pieces<br>to see your look.",
      catJackets: "Jackets", catCoats: "Coats", catTops: "Tops", catShirts: "Shirts",
      catKnitwear: "Knitwear", catPants: "Pants", catSkirts: "Skirts", catDresses: "Dresses",
      catShoes: "Shoes", catAccessories: "Accessories", catObjects: "Objects",
      condRepariert: "Repaired", condDefekt: "With defect",
      condGut: "Good", condSehrGut: "Very good", condZufriedenstellend: "Satisfactory",
      sizeEinheitsgroesse: "One size", sizeVerstellbar: "adjustable", sizeKidsL: "Kids' size L",
      autoDescTemplate: "{name}{facts}. From the curated archive of Disorder119.",
      legalImpressumHtml: "<h2>Legal notice</h2>" +
        "<p>This page is translated for convenience — the German version above is the legally binding one.</p>" +
        "<p>Information pursuant to § 5 DDG (German Digital Services Act)</p>" +
        "<p>Joel Bittner<br>Disorder119 (sole proprietorship)<br>Nelseestraße 25<br>63739 Aschaffenburg<br>Germany</p>" +
        "<h3>Contact</h3><p>E-mail: {email}</p>" +
        "<h3>VAT</h3><p>Small business as per § 19 UStG (German VAT Act) — no VAT is shown.</p>" +
        "<h3>Responsible for content pursuant to § 18 (2) MStV</h3><p>Joel Bittner (address as above)</p>" +
        "<h3>Dispute resolution</h3><p>We are neither obliged nor willing to take part in dispute resolution proceedings before a consumer arbitration board.</p>",
      legalAgbHtml: "<h2>Terms &amp; conditions</h2>" +
        "<p>This page is translated for convenience — the German version is the legally binding one.</p>" +
        "<h3>1. Scope</h3><p>These terms apply to purchase enquiries made via this website between Joel Bittner (Disorder119) and customers.</p>" +
        "<h3>2. Formation of contract</h3><p>A non-binding enquiry can be sent via WhatsApp or e-mail through the cart. " +
        "A purchase contract is only formed once separately confirmed (availability, price, payment and shipping method) — not simply by sending the enquiry.</p>" +
        "<h3>3. Items</h3><p>All items offered are used one-off pieces (vintage / second-hand). Minor wear-related " +
        "variations are possible and are noted to the best of our knowledge in the item description.</p>" +
        "<h3>4. Prices &amp; payment</h3><p>All prices are in euros. Small business as per § 19 UStG, no VAT shown. " +
        "Payment and shipping method are agreed individually.</p>" +
        "<h3>5. Warranty</h3><p>Statutory warranty rights apply. As all items are used one-off pieces, condition is described to the best of our " +
        "knowledge in the respective item description.</p>" +
        "<h3>6. Right of withdrawal for consumers</h3>" +
        "<p><strong>Right of withdrawal</strong><br>You have the right to withdraw from this contract within 14 days without giving any reason. " +
        "The withdrawal period will expire 14 days from the day on which you, or a third party other than the carrier and indicated by you, acquire physical possession of the goods. " +
        "To exercise the right of withdrawal, you must inform us (Joel Bittner, Disorder119, Nelseestraße 25, 63739 Aschaffenburg, Germany, e-mail: {email}) of your decision to withdraw " +
        "from this contract by an unequivocal statement (e.g. a letter sent by post or e-mail). You may use the model withdrawal form below, but it is not obligatory. To meet the " +
        "withdrawal deadline, it is sufficient for you to send your communication concerning the exercise of the right of withdrawal before the withdrawal period has expired.</p>" +
        "<p><strong>Effects of withdrawal</strong><br>If you withdraw from this contract, we shall reimburse all payments received from you, including delivery costs (except for the " +
        "supplementary costs resulting from your choice of a delivery type other than the least expensive standard delivery offered by us), without undue delay and in any event not " +
        "later than 14 days from the day on which we are informed about your decision to withdraw. We will use the same means of payment as you used for the initial transaction, " +
        "unless expressly agreed otherwise; in any event, you will not incur any fees as a result of such reimbursement. We may withhold reimbursement until we have received the goods " +
        "back, or you have supplied evidence of having sent back the goods, whichever is the earliest. You shall send back the goods without undue delay and in any event not later than " +
        "14 days from the day on which you communicate your withdrawal from this contract to us. The deadline is met if you send back the goods before the period of 14 days has expired. " +
        "You will bear the direct cost of returning the goods. You are only liable for any diminished value of the goods resulting from handling other than what is necessary to " +
        "establish the nature, characteristics and functioning of the goods.</p>" +
        "<p><strong>Model withdrawal form</strong><br>(Complete and return this form only if you wish to withdraw from the contract.)</p>" +
        "<p>To: Joel Bittner, Disorder119, Nelseestraße 25, 63739 Aschaffenburg, Germany, e-mail: {email}<br>" +
        "I/We (*) hereby give notice that I/We (*) withdraw from my/our (*) contract for the sale of the following goods (*)/for the provision of the following service (*)<br>" +
        "Ordered on (*)/received on (*)<br>" +
        "Name of consumer(s)<br>" +
        "Address of consumer(s)<br>" +
        "Signature of consumer(s) (only if this form is notified on paper)<br>" +
        "Date<br>" +
        "(*) Delete as appropriate.</p>",
      legalDatenschutzHtml: "<h2>Privacy policy</h2>" +
        "<p>This page is translated for convenience — the German version is the legally binding one.</p>" +
        "<h3>Controller</h3><p>Joel Bittner, Nelseestraße 25, 63739 Aschaffenburg, Germany — contact details in the legal notice.</p>" +
        "<h3>Local storage (localStorage)</h3><p>The cart and outfit builder save your selection exclusively locally in your browser " +
        "(localStorage). This data is never transmitted to us or third parties and never leaves your device. You can delete it at any time via your browser settings.</p>" +
        "<h3>Order enquiries</h3><p>If you send an enquiry via WhatsApp or e-mail, the data you enter " +
        "(e.g. name, message) is transmitted to the respective service (WhatsApp/Meta or your e-mail provider) and to us in order to process your enquiry. It is not passed on to any further third parties.</p>" +
        "<h3>Hosting</h3><p>This site is hosted on GitHub Pages (GitHub Inc.). GitHub technically processes " +
        "access data required for delivery (including IP address). See the " +
        '<a href="https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement" target="_blank" rel="noopener">GitHub privacy statement</a> for details.</p>' +
        "<h3>No tracking cookies</h3><p>This site does not use analytics, marketing or tracking cookies.</p>"
    },
    fr: {
      langGroupAria: "Choisir la langue", cartOpenAria: "Ouvrir le panier",
      eyebrow: "Pièces de créateurs, vintage et contemporaines, avec un accent sur la qualité, l'authenticité et l'intemporalité",
      wordmarkKicker: "L'archive sélectionnée de",
      metaTotalLabel: "Objets dans l'archive", metaAvailableLabel: "Disponibles", metaBrandsLabel: "Marques",
      brandLineMore: "et plus",
      searchPlaceholder: "Recherche par marque, titre",
      statusAll: "Tous", statusAvailable: "Disponible", statusSold: "Archive",
      categoryAll: "Toutes les catégories",
      sortBrightness: "Clair → foncé", sortNew: "Plus récent d'abord", sortPriceAsc: "Prix croissant",
      sortPriceDesc: "Prix décroissant", sortBrand: "Marque A–Z",
      mountBlack: "Fond photo : noir", mountWhite: "Fond photo : blanc",
      moreFilters: "Plus de filtres",
      filterDepartmentLabel: "Rayon", filterAllDepartments: "Tous les rayons",
      filterProductTypeLabel: "Type de produit", filterAllProductTypes: "Tous les types",
      filterBrandLabel: "Marque", filterAllBrands: "Toutes les marques",
      filterSizeLabel: "Taille", filterAllSizes: "Toutes les tailles",
      filterColorLabel: "Couleur", filterAllColors: "Toutes les couleurs",
      filterConditionLabel: "État", filterAllConditions: "Tous les états",
      filterPriceLabel: "Prix (€)", filterPriceFrom: "de", filterPriceTo: "à",
      filterResetLabel: "Réinitialiser les filtres",
      activeFiltersAria: "Filtres actifs", activeFilterSearch: "Recherche",
      activeFilterDepartment: "Rayon", activeFilterProductType: "Type de produit",
      activeFilterBrand: "Marque", activeFilterSize: "Taille", activeFilterColor: "Couleur",
      activeFilterCondition: "État", activeFilterPrice: "Prix", activeFilterCategory: "Catégorie",
      activeFilterStatus: "Statut", activeFilterRemove: "supprimer", activeFilterClear: "Effacer tous les filtres",
      railCountTemplate: "{filtered} sur {total} objets",
      emptyTitle: "Aucun résultat dans l'archive",
      emptyBody: "Essaie un autre terme de recherche ou réinitialise les filtres.",
      footerTagline: "Archive de seconde main sélectionnée pour la mode de créateurs et vintage.",
      menuTitle: "Menu", menuAllItems: "Tous les articles", menuJackets: "Vestes", menuTops: "Hauts",
      menuPants: "Pantalons", menuSkirts: "Jupes", menuDresses: "Robes", menuShoes: "Chaussures",
      menuAccessories: "Accessoires", menuBrands: "Marques", menuArchive: "Archive",
      menuCart: "Panier",
      loadMore: "Charger plus", footerAbout: "À propos de Disorder119", footerFaq: "FAQ", footerContact: "Contact",
      aboutHtml: "<h2>À propos de Disorder119</h2><p>DISORDER119 est une archive indépendante et sélectionnée de pièces de créateurs, vintage et contemporaines, axée sur la qualité, l’authenticité et l’intemporalité.</p><h3>Sélection &amp; documentation</h3><p>Chaque pièce proposée est sélectionnée, photographiée et décrite individuellement. La plupart étant des pièces uniques d’occasion, leur état et leurs particularités visibles sont documentés au mieux de notre connaissance. Si une information manque ou si tu souhaites des photos de détail ou des mesures supplémentaires, nous clarifions cela avant l’achat.</p><h3>Achat transparent</h3><p>Disorder119 est exploité par Joel Bittner en tant qu’entreprise individuelle à Aschaffenburg, en Allemagne. Les informations vendeur, le droit de rétractation, les droits de garantie légaux et les informations de confidentialité sont disponibles à tout moment dans les mentions légales, les CGV et la politique de confidentialité.</p>",
      faqHtml: "<h2>FAQ</h2><h3>Chaque article est-il unique ?</h3><p>Oui. Chaque article disponible est une pièce unique sélectionnée ; une fois vendu, il ne peut donc pas être commandé une seconde fois.</p><h3>Comment commander ?</h3><p>Ajoute les articles disponibles au panier et envoie une demande de commande via le moyen de contact proposé. La demande est d’abord sans engagement. La disponibilité, le prix total, le mode de paiement et l’expédition sont confirmés ; le contrat de vente n’est conclu qu’avec cette confirmation.</p><h3>Les articles sont-ils neufs ?</h3><p>En général non. Disorder119 est une archive de créateurs, vintage et seconde main. L’état et les particularités visibles sont décrits au mieux de notre connaissance dans les informations produit.</p><h3>Que faire si la taille, l’état ou les mesures manquent ?</h3><p>Merci de demander avant l’achat. Des mesures, photos de détail et informations spécifiques supplémentaires peuvent être clarifiées avant la conclusion du contrat.</p><h3>Comment l’authenticité est-elle traitée ?</h3><p>L’authenticité fait partie des critères de sélection de Disorder119. Une authentification ou certification par la marque concernée ou un service externe n’est toutefois garantie que si cela est expressément indiqué pour l’article concerné. Des photos de détail supplémentaires peuvent être demandées.</p><h3>Puis-je me rétracter et quelle garantie s’applique ?</h3><p>Les consommateurs disposent du droit légal de rétractation de 14 jours. Les droits de garantie légaux s’appliquent également. Les conditions complètes et les informations de rétractation figurent dans les CGV.</p><h3>Comment mes données sont-elles traitées ?</h3><p>Le site n’utilise aucun cookie d’analyse, de marketing ou de suivi. Le panier et le configurateur de tenues sont enregistrés localement dans le navigateur. Consulte la politique de confidentialité pour les détails.</p><h3>Pourquoi les articles vendus restent-ils visibles ?</h3><p>Les pièces vendues restent visibles dans l’archive DISORDER119 et sont clairement indiquées comme vendues.</p>",
      legalImpressum: "Mentions légales", legalAgb: "CGV", legalDatenschutz: "Confidentialité",
      legalEmailPending: "sera ajoutée dès la mise en ligne de la boutique",
      closeAria: "Fermer",
      cookieText: "Ce site n'utilise aucun cookie de suivi ou marketing. Le panier et le configurateur de tenues n'enregistrent ta sélection que localement dans ton navigateur (localStorage), pour qu'elle soit encore là lors de ta prochaine visite — ces données ne quittent jamais ton navigateur.",
      cookieOk: "Compris",
      shareAria: "Partager", shareToast: "Lien copié",
      prevPhotoAria: "Photo précédente", nextPhotoAria: "Photo suivante",
      modalNote: "Archive Disorder119",
      factCategory: "Catégorie", factSize: "Taille", factColor: "Couleur", factCondition: "État",
      noBrand: "Sans marque", noDesc: "Aucune description disponible.",
      priceOnRequest: "Prix sur demande", priceEstimatedPrefix: "env. ", priceEstimatedBadge: "Prix en cours de vérification",
      sold: "Vendu", priceOnRequestCta: "Prix sur demande — merci de nous contacter",
      soldArchiveBadge: "SOLD — DISORDER119 ARCHIVE",
      inCartRemove: "Dans le panier ✓ — retirer", addToCart: "Ajouter au panier",
      removeFromCartAria: "Retirer du panier",
      cartHeading: "Panier", cartAria: "Panier", cartEmpty: "Ton panier est vide.",
      cartItemsRemovedSold: "Entre-temps vendu(s) et retiré(s) du panier : {items}.",
      cartRemove: "Retirer", cartTotal: "Total",
      cartWhatsapp: "Envoyer la demande par WhatsApp", cartEmail: "Envoyer la demande par e-mail",
      cartConfigWarning: "Le contact de la boutique n'est pas encore configuré : renseigne ton numéro WhatsApp ou ton adresse e-mail dans SHOP_CONFIG (index.html) pour recevoir les demandes de commande.",
      cartNote: "Toutes les pièces sont uniques. Après ta demande, nous confirmons la disponibilité, le prix total, le mode de paiement et l’expédition. Le contrat de vente n’est conclu qu’avec cette confirmation. Les consommateurs disposent du droit légal de rétractation de 14 jours.",
      orderGreeting: "Bonjour ! Je suis intéressé(e) par les pièces suivantes de l'archive Disorder119 :",
      orderAvailQuestion: "Ces pièces sont-elles toujours disponibles ?", orderSubject: "Demande de commande Disorder119",
      orderSizeAbbrev: "Taille ", orderArticleAbbrev: "N° d'article ",
      modeArchiv: "Archive", modeMatch: "Match", modeChaos: "Chaos", modeBaukasten: "Configurateur",
      menuRental: "Location",
      pageTitleHome: "Disorder119 — Archive Sélectionnée", pageTitleMatch: "Disorder119 — Match",
      pageTitleChaos: "Disorder119 — Chaos", pageTitleOutfit: "Disorder119 — Configurateur de tenues",
      modeHint: "Découvre aussi Match, Chaos et le configurateur de tenues", hintCloseAria: "Fermer l'info",
      modeRailAria: "Changer de vue",
      rentalCta: "Demander la location", rentalCloseAria: "Fermer",
      rentalPriceLabel: "Prix de location", rentalPriceOnRequest: "Prix de location sur demande",
      rentalSoldNote: "Déjà vendu – plus disponible à la location",
      rentalModalTitle: "Louer cette pièce",
      rentalStartLabel: "Du", rentalEndLabel: "Au",
      rentalDaysTemplate: "{days} jour(s) sélectionné(s)",
      rentalPurposeLabel: "Utilisation prévue",
      rentalPurposeVideo: "Clip musical", rentalPurposePhoto: "Shooting photo",
      rentalPurposeFilmTheater: "Film/théâtre/scène", rentalPurposeEditorial: "Éditorial",
      rentalPurposeEvent: "Événement/exposition", rentalPurposePrivate: "Occasion privée",
      rentalPurposeOther: "Autre",
      rentalMessageLabel: "Message (facultatif)",
      rentalMessagePh: "p. ex. production, plateau, occasion, contact …",
      rentalNote: "Ceci est une demande sans engagement, pas une réservation. Je te confirme personnellement la disponibilité, la caution et les conditions.",
      rentalDateError: "Merci de choisir une période valide (fin après ou égale au début).",
      rentalWhatsapp: "Envoyer la demande via WhatsApp", rentalEmail: "Envoyer la demande par e-mail",
      rentalConfigWarning: "Le contact de la boutique n'est pas encore configuré : renseigne ton numéro WhatsApp ou ton adresse e-mail dans config/shop-config.json pour recevoir les demandes de location.",
      rentalSubject: "Demande de location Disorder119",
      rentalEmailIntro: "Bonjour !\n\nJe suis intéressé(e) par la pièce suivante de l'archive Disorder119 et souhaiterais la louer :\n\n{item}",
      rentalEmailClosing: "Je serais ravi(e) d'avoir un retour sur la disponibilité, le prix de location et la caution.\n\nBien cordialement",
      rentalPeriodLabel: "Période", rentalPurposeMsgLabel: "Utilisation", rentalMessageMsgLabel: "Message",
      pageTitleMieten: "Disorder119 — Location",
      mietenCatalogHeading: "Location",
      mietenIntroTitle: "Location",
      mietenIntroLead: "Chaque pièce disponible de l'archive peut aussi être louée plutôt qu'achetée — pour des shootings, clips musicaux, productions de film ou de théâtre, sujets éditoriaux, événements ou occasions privées. Choisis une pièce ci-dessous et envoie une demande sans engagement avec tes dates souhaitées.",
      mietenTermsHeading: "Comment fonctionne la location",
      mietenTermsHtml: "<ul><li><strong>Prix de location :</strong> environ 15&nbsp;% du prix indiqué dans l'archive par période de 4 jours maximum (indicatif — le prix exact est confirmé personnellement pour chaque demande, selon la pièce et la durée).</li><li><strong>Caution :</strong> déposée au retrait/à l'envoi et remboursée après un retour complet et non endommagé sous 7 jours.</li><li><strong>Nettoyage :</strong> l'usure normale et les salissures légères sont incluses dans le prix de location. Des frais de nettoyage professionnel peuvent être retenus après usage.</li><li><strong>Dommages :</strong> les dommages réparables sont réglés via la caution ; en cas de dommage irréparable ou de perte, la valeur actuelle de la pièce dans l'archive est due.</li><li><strong>Durée :</strong> 4 jours maximum par défaut, périodes plus longues sur demande.</li><li>Toutes les informations sont sans engagement et confirmées individuellement pour chaque demande — il ne s'agit pas d'un système de réservation automatisé.</li></ul>",
      toArchive: "Vers l'archive →",
      swipeHint: "Glisse ou clique — ✕ passer, ♥ garder",
      swipeRoundDone: "Manche terminée", swipeSavedInCart: "Pièces enregistrées &amp; dans le panier",
      swipeViewCart: "Voir le panier", swipePlayAgain: "Rejouer", swipeNopeTag: "Non",
      swipeNopeAria: "Pas mon style", swipeLikeAria: "Garder",
      chaosLabel: "Vue Chaos — clique pour les détails",
      chaosShuffle: "Remélanger",
      outfitEyebrow: "Configurateur de tenues", outfitTitle: "Compose un look",
      outfitPickerCloseAria: "Fermer",
      outfitPickerChoose: "choisir", outfitPickerSearchPh: "Recherche par marque, titre …",
      outfitPickerAllSizes: "Toutes les tailles", outfitPickerPriceMaxPh: "Prix jusqu'à (€)",
      outfitEmptyOptions: "Aucun résultat.", outfitChoose: "Choisir …",
      outfitDressCovers: "La robe couvre déjà cette partie",
      outfitStatusStart: "Choisis un haut ou une robe pour commencer.",
      outfitStatusComplete: "Look complet ! 🔥",
      outfitStatusProgress: "{filled} pièce(s) obligatoire(s) sur {required} sélectionnée(s).",
      outfitSlotTop: "Haut / robe", outfitSlotJacket: "Veste (optionnel)", outfitSlotBottom: "Bas",
      outfitSlotShoes: "Chaussures", outfitSlotAccessory: "Accessoire",
      outfitRandomAria: "Surprends-moi", outfitResetLabel: "Réinitialiser",
      outfitLookLabel: "Ton look", outfitEmptyLook: "Choisis des pièces<br>pour voir ton look.",
      catJackets: "Vestes", catCoats: "Manteaux", catTops: "Hauts", catShirts: "Chemises/T-shirts",
      catKnitwear: "Maille", catPants: "Pantalons", catSkirts: "Jupes", catDresses: "Robes",
      catShoes: "Chaussures", catAccessories: "Accessoires", catObjects: "Objets",
      condRepariert: "Réparé", condDefekt: "Avec défaut",
      condGut: "Bon", condSehrGut: "Très bon", condZufriedenstellend: "Satisfaisant",
      sizeEinheitsgroesse: "Taille unique", sizeVerstellbar: "réglable", sizeKidsL: "Taille enfant L",
      autoDescTemplate: "{name}{facts}. Issu de l'archive sélectionnée de Disorder119.",
      legalImpressumHtml: "<h2>Mentions légales</h2>" +
        "<p>Cette page est traduite par courtoisie — la version allemande ci-dessus fait foi juridiquement.</p>" +
        "<p>Informations selon le § 5 DDG (loi allemande sur les services numériques)</p>" +
        "<p>Joel Bittner<br>Disorder119 (entreprise individuelle)<br>Nelseestraße 25<br>63739 Aschaffenburg<br>Allemagne</p>" +
        "<h3>Contact</h3><p>E-mail : {email}</p>" +
        "<h3>TVA</h3><p>Micro-entreprise selon le § 19 UStG (loi allemande sur la TVA) — la TVA n'est pas indiquée.</p>" +
        "<h3>Responsable du contenu selon le § 18 al. 2 MStV</h3><p>Joel Bittner (adresse ci-dessus)</p>" +
        "<h3>Règlement des litiges</h3><p>Nous ne sommes ni tenus ni disposés à participer à une procédure de règlement des litiges devant un organisme de médiation de la consommation.</p>",
      legalAgbHtml: "<h2>Conditions générales de vente</h2>" +
        "<p>Cette page est traduite par courtoisie — la version allemande fait foi juridiquement.</p>" +
        "<h3>1. Champ d'application</h3><p>Ces conditions s'appliquent aux demandes d'achat effectuées via ce site entre Joel Bittner (Disorder119) et les client(e)s.</p>" +
        "<h3>2. Formation du contrat</h3><p>Une demande sans engagement peut être envoyée par WhatsApp ou e-mail via le panier. " +
        "Un contrat de vente n'est conclu qu'après confirmation séparée (disponibilité, prix, mode de paiement et d'expédition) — pas par le simple envoi de la demande.</p>" +
        "<h3>3. Articles</h3><p>Tous les articles proposés sont des pièces uniques d'occasion (vintage / seconde main). De légères " +
        "variations liées à l'usage sont possibles et sont indiquées au mieux de notre connaissance dans la description de l'article.</p>" +
        "<h3>4. Prix &amp; paiement</h3><p>Tous les prix s'entendent en euros. Micro-entreprise selon le § 19 UStG, TVA non indiquée. " +
        "Le mode de paiement et d'expédition est convenu individuellement.</p>" +
        "<h3>5. Garantie</h3><p>Les droits de garantie légaux s'appliquent. Tous les articles étant des pièces uniques d'occasion, leur état est décrit " +
        "au mieux de notre connaissance dans la description de l'article concerné.</p>" +
        "<h3>6. Droit de rétractation des consommateurs</h3>" +
        "<p><strong>Droit de rétractation</strong><br>Tu disposes d'un délai de 14 jours pour te rétracter du présent contrat sans avoir à motiver ta décision. " +
        "Le délai de rétractation expire 14 jours après le jour où toi, ou un tiers autre que le transporteur et désigné par toi, prend physiquement possession du bien. " +
        "Pour exercer le droit de rétractation, tu dois nous notifier (Joel Bittner, Disorder119, Nelseestraße 25, 63739 Aschaffenburg, Allemagne, e-mail : {email}) ta décision de te " +
        "rétracter du présent contrat au moyen d'une déclaration dénuée d'ambiguïté (par exemple lettre envoyée par la poste ou e-mail). Tu peux utiliser le formulaire type de " +
        "rétractation ci-dessous, sans que cela soit obligatoire. Pour respecter le délai de rétractation, il suffit que tu transmettes ta communication relative à l'exercice du droit " +
        "de rétractation avant l'expiration du délai de rétractation.</p>" +
        "<p><strong>Effets de la rétractation</strong><br>En cas de rétractation, nous te rembourserons tous les paiements reçus, y compris les frais de livraison (à l'exception des " +
        "frais supplémentaires découlant du fait que tu as choisi un mode de livraison autre que le mode le moins coûteux de livraison standard proposé par nous), sans retard excessif " +
        "et en tout état de cause au plus tard 14 jours à compter du jour où nous sommes informés de ta décision de te rétracter. Nous procéderons au remboursement en utilisant le même " +
        "moyen de paiement que celui utilisé pour la transaction initiale, sauf accord exprès contraire ; en tout état de cause, ce remboursement ne t'occasionnera aucun frais. Nous " +
        "pouvons différer le remboursement jusqu'à ce que nous ayons reçu le bien ou jusqu'à ce que tu aies fourni une preuve de l'expédition du bien, la date retenue étant celle du " +
        "premier de ces faits. Tu devras renvoyer ou restituer les biens sans retard excessif et en tout état de cause au plus tard 14 jours après nous avoir communiqué ta décision de " +
        "te rétracter. Ce délai est réputé respecté si tu renvoies le bien avant l'expiration du délai de 14 jours. Les frais directs de renvoi du bien sont à ta charge. Ta responsabilité " +
        "n'est engagée qu'à l'égard de la dépréciation du bien résultant de manipulations autres que celles nécessaires pour établir la nature, les caractéristiques et le bon " +
        "fonctionnement de ce bien.</p>" +
        "<p><strong>Formulaire type de rétractation</strong><br>(Veuillez compléter et renvoyer le présent formulaire uniquement si vous souhaitez vous rétracter du contrat.)</p>" +
        "<p>À l'attention de : Joel Bittner, Disorder119, Nelseestraße 25, 63739 Aschaffenburg, Allemagne, e-mail : {email}<br>" +
        "Je/nous (*) vous notifie/notifions par la présente ma/notre (*) rétractation du contrat portant sur la vente du bien (*)/pour la prestation de service (*) ci-dessous<br>" +
        "Commandé le (*)/reçu le (*)<br>" +
        "Nom du (des) consommateur(s)<br>" +
        "Adresse du (des) consommateur(s)<br>" +
        "Signature du (des) consommateur(s) (uniquement en cas de notification du présent formulaire sur papier)<br>" +
        "Date<br>" +
        "(*) Rayez la mention inutile.</p>",
      legalDatenschutzHtml: "<h2>Politique de confidentialité</h2>" +
        "<p>Cette page est traduite par courtoisie — la version allemande fait foi juridiquement.</p>" +
        "<h3>Responsable</h3><p>Joel Bittner, Nelseestraße 25, 63739 Aschaffenburg, Allemagne — contact, voir mentions légales.</p>" +
        "<h3>Stockage local (localStorage)</h3><p>Le panier et le configurateur de tenues enregistrent ta sélection exclusivement en local dans ton navigateur " +
        "(localStorage). Ces données ne sont jamais transmises à nous ou à des tiers et ne quittent jamais ton appareil. Tu peux les supprimer à tout moment via les réglages de ton navigateur.</p>" +
        "<h3>Demandes de commande</h3><p>Si tu envoies une demande par WhatsApp ou e-mail, les données que tu saisis " +
        "(par ex. nom, message) sont transmises au service concerné (WhatsApp/Meta ou ton fournisseur e-mail) ainsi qu'à nous, afin de traiter ta demande. Aucune transmission à d'autres tiers n'a lieu.</p>" +
        "<h3>Hébergement</h3><p>Ce site est hébergé sur GitHub Pages (GitHub Inc.). Lors de l'accès, GitHub traite les " +
        "données techniques nécessaires (dont l'adresse IP) pour la mise à disposition du site. Plus de détails dans la " +
        '<a href="https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement" target="_blank" rel="noopener">politique de confidentialité de GitHub</a>.</p>' +
        "<h3>Aucun cookie de suivi</h3><p>Ce site n'utilise aucun cookie d'analyse, marketing ou de suivi.</p>"
    }
  };

  function t(key) { return (I18N[LANG] && I18N[LANG][key] != null) ? I18N[LANG][key] : I18N.de[key]; }
  function tFormat(key, vars) {
    var s = t(key);
    for (var k in vars) { s = s.split("{" + k + "}").join(vars[k]); }
    return s;
  }

  // Kategorie-Werte in den Artikeldaten sind seit dem Kategorie-Umbau die
  // englischen Kanonisch-Namen selbst (z.B. "Jackets") - diese Map ist also
  // eine reine Sprach-Uebersetzung, kein Umschluesseln mehr.
  var CATEGORY_MAP_DE_TO_KEY = {
    "Jackets": "catJackets", "Coats": "catCoats", "Tops": "catTops", "Shirts": "catShirts",
    "Knitwear": "catKnitwear", "Pants": "catPants", "Skirts": "catSkirts", "Dresses": "catDresses",
    "Shoes": "catShoes", "Accessories": "catAccessories", "Objects": "catObjects"
  };
  var CONDITION_MAP_DE_TO_KEY = {
    "Repariert": "condRepariert", "Mit Defekt": "condDefekt",
    "Gut": "condGut", "Sehr gut": "condSehrGut", "Zufriedenstellend": "condZufriedenstellend"
  };
  var DEPARTMENT_LABELS = {
    Women: { de: "Damen", en: "Women", fr: "Femme" },
    Men: { de: "Herren", en: "Men", fr: "Homme" },
    Unisex: { de: "Unisex", en: "Unisex", fr: "Unisexe" },
    Objects: { de: "Objekte", en: "Objects", fr: "Objets" }
  };
  var PRODUCT_TYPE_LABELS = {
    "Accessory": { de: "Accessoire", fr: "Accessoire" },
    "Backpack": { de: "Rucksack", fr: "Sac à dos" },
    "Bag": { de: "Tasche", fr: "Sac" },
    "Beanie": { de: "Mütze / Beanie", fr: "Bonnet" },
    "Belt": { de: "Gürtel", fr: "Ceinture" },
    "Biker Jacket": { de: "Bikerjacke", fr: "Veste biker" },
    "Blazer": { de: "Blazer", fr: "Blazer" },
    "Blouse": { de: "Bluse", fr: "Blouse" },
    "Bomber Jacket": { de: "Bomberjacke", fr: "Bomber" },
    "Boots": { de: "Stiefel / Boots", fr: "Bottes" },
    "Cap": { de: "Cap", fr: "Casquette" },
    "Cardigan": { de: "Cardigan / Strickjacke", fr: "Cardigan" },
    "Coat": { de: "Mantel", fr: "Manteau" },
    "Design Object": { de: "Designobjekt", fr: "Objet design" },
    "Dress": { de: "Kleid", fr: "Robe" },
    "Hat": { de: "Hut", fr: "Chapeau" },
    "Heels": { de: "Heels / Absatzschuhe", fr: "Chaussures à talons" },
    "Jacket": { de: "Jacke", fr: "Veste" },
    "Joggers": { de: "Jogginghose", fr: "Jogging" },
    "Knit Top": { de: "Stricktop", fr: "Haut en maille" },
    "Loafers": { de: "Loafer", fr: "Mocassins" },
    "Long Sleeve": { de: "Longsleeve", fr: "Manches longues" },
    "Polo Shirt": { de: "Poloshirt", fr: "Polo" },
    "Sandals": { de: "Sandalen", fr: "Sandales" },
    "Scarf": { de: "Schal", fr: "Écharpe" },
    "Set": { de: "Set", fr: "Ensemble" },
    "Shirt": { de: "Hemd / Shirt", fr: "Chemise" },
    "Shoes": { de: "Schuhe", fr: "Chaussures" },
    "Shorts": { de: "Shorts", fr: "Short" },
    "Skirt": { de: "Rock", fr: "Jupe" },
    "Sleepwear": { de: "Schlafanzug / Sleepwear", fr: "Vêtement de nuit" },
    "Sneakers": { de: "Sneaker", fr: "Baskets" },
    "Suit": { de: "Anzug", fr: "Costume" },
    "Sunglasses": { de: "Sonnenbrille", fr: "Lunettes de soleil" },
    "Sweater": { de: "Pullover", fr: "Pull" },
    "Sweatshirt": { de: "Sweatshirt", fr: "Sweatshirt" },
    "Swim Shorts": { de: "Badeshorts", fr: "Short de bain" },
    "T-Shirt": { de: "T-Shirt", fr: "T-shirt" },
    "Tank Top": { de: "Tanktop", fr: "Débardeur" },
    "Toaster": { de: "Toaster / Designobjekt", fr: "Grille-pain / objet design" },
    "Top": { de: "Top", fr: "Haut" },
    "Trench Coat": { de: "Trenchcoat", fr: "Trench" },
    "Trousers": { de: "Hose", fr: "Pantalon" },
    "Tunic": { de: "Tunika", fr: "Tunique" },
    "Underwear Shorts": { de: "Unterwäsche-Shorts", fr: "Sous-vêtement" },
    "Vest": { de: "Weste", fr: "Gilet" },
    "Wallet": { de: "Wallet / Geldbörse", fr: "Portefeuille" }
  };
  var SIZE_MAP_DE_TO_KEY = {
    "Einheitsgröße": "sizeEinheitsgroesse", "verstellbar": "sizeVerstellbar",
    "Größenverstellbar": "sizeVerstellbar", "Kindergröße L": "sizeKidsL", "Sonstige": "catSonstiges"
  };

  function trCategory(cat) { var k = CATEGORY_MAP_DE_TO_KEY[cat]; return k ? t(k) : (cat || ""); }
  function trDepartment(department) {
    var labels = DEPARTMENT_LABELS[department];
    return labels ? (labels[LANG] || labels.en || department) : (department || "");
  }
  function trProductType(productType) {
    if (!productType) return "";
    if (LANG === "en") return productType;
    var labels = PRODUCT_TYPE_LABELS[productType];
    return labels ? (labels[LANG] || productType) : productType;
  }
  function trCondition(cond) { var k = CONDITION_MAP_DE_TO_KEY[cond]; return k ? t(k) : (cond || ""); }
  function trSize(size) {
    if (size === "One Size") return t("sizeEinheitsgroesse");
    if (size === "Adjustable") return t("sizeVerstellbar");
    var k = SIZE_MAP_DE_TO_KEY[size];
    return k ? t(k) : (size || "");
  }

  // Jede Sprache verwendet die fest im Artikeldatensatz hinterlegte Beschreibung.
  // Manche Artikel haben (noch) gar keine Beschreibung im Manager hinterlegt
  // (echte Datenluecke, kein Anzeigefehler - z.B. bei schnell erfassten
  // "Ohne Preis"-Artikeln). Statt eines nichtssagenden "Keine Beschreibung
  // hinterlegt." wird aus den ohnehin vorhandenen, verlaesslichen Fakten
  // (Marke, Kategorie, Groesse, Zustand) automatisch ein kurzer, sachlicher
  // Ersatztext gebaut - keine erfundenen Materialangaben oder Ausschmueckung.
  function autoDescription(it) {
    var facts = [];
    if (it.category) facts.push(trCategory(it.category));
    if (it.size) facts.push(t("factSize") + " " + trSize(it.size));
    if (it.condition) facts.push(t("factCondition") + " " + trCondition(it.condition));
    var name = it.brand && it.title.toLowerCase().indexOf(it.brand.toLowerCase()) === 0
      ? it.title
      : [it.brand, it.title].filter(Boolean).join(" ");
    var factsStr = facts.join(", ");
    return tFormat("autoDescTemplate", { name: name, facts: factsStr ? " – " + factsStr : "" });
  }

  function trDescription(it) {
    var descriptions = {
      de: it.desc_de || it.desc || "",
      en: it.desc_en || "",
      fr: it.desc_fr || ""
    };
    var localized = (descriptions[LANG] || "").trim();
    return localized || autoDescription(it);
  }

  // Wird nach dem Aufbau der restlichen Seite (Chips, Modal, Warenkorb, Baukasten,
  // Legal-Panel) unten am Skriptende einmal initial aufgerufen und danach bei jedem
  // Klick auf DE/EN/FR - deshalb rufen die Callbacks unten teils Funktionen auf,
  // die erst weiter unten im Skript definiert werden (per Function-Hoisting sicher).
  function applyLanguage(lang) {
    LANG = lang;
    try { window.localStorage.setItem(LANG_KEY, lang); } catch (e) {}
    document.documentElement.setAttribute("lang", lang);

    Array.prototype.forEach.call(document.querySelectorAll("[data-lang]"), function (btn) {
      if (btn.getAttribute("data-lang") === lang) btn.setAttribute("aria-current", "true");
      else btn.removeAttribute("aria-current");
    });

    Array.prototype.forEach.call(document.querySelectorAll("[data-i18n]"), function (el) {
      el.innerHTML = t(el.getAttribute("data-i18n"));
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-i18n-placeholder]"), function (el) {
      el.setAttribute("placeholder", t(el.getAttribute("data-i18n-placeholder")));
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-i18n-aria]"), function (el) {
      el.setAttribute("aria-label", t(el.getAttribute("data-i18n-aria")));
    });
    Array.prototype.forEach.call(document.querySelectorAll("#categoryChips [data-cat]"), function (el) {
      el.textContent = trCategory(el.getAttribute("data-cat"));
    });

    var brandMore = document.getElementById("brandLineMore");
    if (brandMore) brandMore.textContent = t("brandLineMore");

    var mountBtn = document.getElementById("mountToggle");
    if (mountBtn) {
      var isWhite = document.documentElement.getAttribute("data-mount") === "white";
      mountBtn.textContent = isWhite ? t("mountWhite") : t("mountBlack");
    }

    if (typeof render === "function") render();
    if (typeof renderCartDrawer === "function") renderCartDrawer();
    if (typeof renderOutfitStack === "function") renderOutfitStack();
    if (typeof currentItem !== "undefined" && currentItem && typeof openModal === "function") openModal(currentItem);
    if (typeof currentLegalKey !== "undefined" && currentLegalKey) {
      var legalContentEl = document.getElementById("legalContent");
      if (legalContentEl) legalContentEl.innerHTML = legalContent(currentLegalKey);
    }
    if (typeof currentInfoKey !== "undefined" && currentInfoKey) {
      var infoContentEl = document.getElementById("legalContent");
      if (infoContentEl) infoContentEl.innerHTML = t(INFO_HTML_KEY[currentInfoKey]);
    }
  }

  // Warenkorb-Icon sitzt jetzt fest in der Kopfzeile (feste CSS-Groesse je
  // Breakpoint) statt an die Eyebrow-Texthoehe im Hero gekoppelt zu sein -
  // kein JS-Sync mehr noetig.

  // Sprachwahl navigiert jetzt zur eigenen Sprach-URL (siehe langHome() oben)
  // statt nur die aktuelle Seite umzuskinnen - jede Sprache hat eine echte
  // eigene Adresse, das muss sich auch beim Umschalten in der Adresszeile
  // widerspiegeln (sonst waeren die hreflang-Angaben irrefuehrend).
  Array.prototype.forEach.call(document.querySelectorAll("[data-lang]"), function (btn) {
    if (btn.tagName === "A") {
      btn.href = langHome(btn.getAttribute("data-lang")) + PATH_REST;
    } else {
      btn.addEventListener("click", function () {
        location.href = langHome(btn.getAttribute("data-lang")) + PATH_REST;
      });
    }
  });

  // ---- Shop-Kontakt ----
  // Kommt jetzt aus config/shop-config.json (einzige Quelle, siehe
  // build_site.py:get_shop_config()) und wird von build_site.py als
  // window.SHOP_CONFIG in JEDE erzeugte Seite eingebaut (Startseite UND
  // jede Produktseite als window.ARTICLE_SHOP_CONFIG) - vorher stand
  // dieselbe Config als JS-Literal zusaetzlich hier hart im Code und ist
  // genau dadurch schon einmal von der tatsaechlich verwendeten Config
  // auseinandergelaufen (Produktseiten bekamen eine leere Konfiguration,
  // obwohl hier eine echte E-Mail-Adresse stand).
  var SHOP_CONFIG = window.SHOP_CONFIG || {
    whatsappNumber: "", email: "", paypalClientId: "", shopWorkerUrl: ""
  };

  // Bild-/Asset-Pfade aus items.json sind Site-Wurzel-relativ ohne fuehrenden
  // Schraegstrich (z.B. "assets/img/123/0.webp"). Diese Seite (index.html)
  // wird unveraendert auch fuer /cart/, /impressum/ usw. wiederverwendet
  // (siehe build_special_pages() in build_site.py) - dort liegt das Dokument
  // eine Ebene tiefer, ein simples "assets/..." wuerde also faelschlich zu
  // "/cart/assets/..." aufgeloest. assetUrl() macht jeden Pfad wurzel-absolut,
  // das funktioniert unabhaengig davon, auf welcher Seite/Tiefe er verwendet wird.
  function assetUrl(p) { return p ? "/" + String(p).replace(/^\/+/, "") : ""; }

  // ---- Warenkorb ----
  var CART_KEY = "disorder119_cart";
  var cart = loadCart();

  function loadCart() {
    try {
      var raw = window.localStorage.getItem(CART_KEY);
      var ids = raw ? JSON.parse(raw) : [];
      return Array.isArray(ids) ? ids : [];
    } catch (e) {
      return [];
    }
  }

  function saveCart() {
    try { window.localStorage.setItem(CART_KEY, JSON.stringify(cart)); } catch (e) {}
  }

  function isInCart(id) { return cart.indexOf(id) !== -1; }

  function findItem(id) {
    for (var i = 0; i < ITEMS.length; i++) if (ITEMS[i].id === id) return ITEMS[i];
    return null;
  }

  // Ein im Warenkorb gemerkter Artikel kann zwischenzeitlich verkauft worden
  // sein (neuer Datenstand seit dem letzten Besuch). Ein SOLD-Artikel darf
  // dann nicht mehr als kaufbar erscheinen, nicht mehr in die Summe eingehen
  // und nicht mehr Teil einer Bestellanfrage sein - deshalb wird der
  // Warenkorb bei jedem Laden bereinigt, nicht nur beim Hinzufuegen.
  var cartRemovedNotice = null;
  function sanitizeCart() {
    var before = cart.length;
    var removedTitles = [];
    cart = cart.filter(function (id) {
      var it = findItem(id);
      var ok = !!it && it.public_status === "AVAILABLE";
      if (!ok && it) removedTitles.push(it.title);
      return ok;
    });
    if (cart.length !== before) {
      saveCart();
      cartRemovedNotice = removedTitles;
      return true;
    }
    return false;
  }
  sanitizeCart();

  // Warenkorb kann auch von einer Produktseite in einem anderen Tab
  // veraendert worden sein (geteiltes localStorage) - bei Rueckkehr in
  // diesen Tab wird der Stand dann live nachgezogen statt erst beim naechsten
  // vollstaendigen Neuladen.
  window.addEventListener("storage", function (e) {
    if (e.key === CART_KEY) {
      cart = loadCart();
      sanitizeCart();
      updateCartCount();
      render();
      renderCartDrawer();
    }
  });

  function updateCartCount() {
    var fab = document.getElementById("cartToggle");
    var navBadge = document.getElementById("cartCountNav");
    var drawerCount = document.getElementById("cartCountDrawer");
    var menuCount = document.getElementById("menuCartCount");
    var footerCount = document.getElementById("footerCartCount");
    if (fab) fab.classList.toggle("cart-bag--visible", cart.length > 0);
    if (navBadge) navBadge.textContent = cart.length;
    if (drawerCount) drawerCount.textContent = cart.length;
    if (menuCount) menuCount.textContent = cart.length;
    if (footerCount) footerCount.textContent = cart.length;
  }

  function toggleCart(id) {
    var idx = cart.indexOf(id);
    if (idx === -1) cart.push(id); else cart.splice(idx, 1);
    saveCart();
    updateCartCount();
    render();
    renderCartDrawer();
    if (currentItem && currentItem.id === id) updateModalCartBtn();
  }

  function removeFromCart(id) {
    var idx = cart.indexOf(id);
    if (idx !== -1) cart.splice(idx, 1);
    saveCart();
    updateCartCount();
    render();
    renderCartDrawer();
    if (currentItem && currentItem.id === id) updateModalCartBtn();
  }

  function buildOrderText() {
    // Mehrzeilig pro Artikel (Marke+Titel / Art.-Nr. / Groesse / Preis) statt
    // einer kompakten Zeile - so bleibt jede Angabe fuer den Empfaenger auf
    // den ersten Blick eindeutig zuordenbar.
    var lines = cart.map(function (id) {
      var it = findItem(id);
      if (!it) return null;
      var name = productAltText(it);
      var rows = [name, t("orderArticleAbbrev") + (it.article || it.id)];
      if (it.size) rows.push(t("factSize") + ": " + trSize(it.size));
      rows.push(fmtPrice(it.price));
      return rows.join("\n");
    }).filter(Boolean);
    var total = cart.reduce(function (sum, id) {
      var it = findItem(id);
      return sum + (it ? it.price : 0);
    }, 0);
    return t("orderGreeting") + "\n\n" +
      lines.join("\n\n") +
      "\n\n" + t("cartTotal") + ": " + fmtPrice(total) +
      "\n\n" + t("orderAvailQuestion");
  }

  function renderCartDrawer(consumeNotice) {
    var body = document.getElementById("cartBody");
    var foot = document.getElementById("cartFoot");
    var wasSanitized = sanitizeCart();
    if (wasSanitized) updateCartCount();
    // Der Hinweis darf nicht schon durch einen stillen Zwischen-Aufruf
    // (z.B. applyLanguage() beim Start, das renderCartDrawer() ohnehin mit-
    // aufruft) verschwinden, bevor der Nutzer den Warenkorb je geoeffnet hat -
    // er wird deshalb erst beim tatsaechlichen Oeffnen (openCart) konsumiert.
    var noticeHtml = cartRemovedNotice
      ? '<p class="cart-removed-notice">' + tFormat("cartItemsRemovedSold", { items: cartRemovedNotice.join(", ") }) + "</p>"
      : "";
    if (consumeNotice) cartRemovedNotice = null;

    if (!cart.length) {
      body.innerHTML = noticeHtml + '<p class="cart-empty">' + t("cartEmpty") + '</p>';
      foot.innerHTML = "";
      return;
    }

    var total = 0;
    body.innerHTML = noticeHtml + cart.map(function (id) {
      var it = findItem(id);
      if (!it) return "";
      total += it.price;
      var hero = assetUrl(it.gallery && it.gallery[0] ? it.gallery[0] : "");
      return '<div class="cart-line">' +
        '<div class="cart-line__frame">' + (hero ? '<img src="' + hero + '" alt="" loading="lazy" />' : "") + "</div>" +
        '<div class="cart-line__body">' +
          '<span class="cart-line__title">' + escapeHtml(it.title) + "</span>" +
          '<span class="cart-line__meta">' + escapeHtml(trSize(it.size) || "") + "</span>" +
          '<div class="cart-line__row">' +
            '<span class="cart-line__price">' + fmtPrice(it.price) + "</span>" +
            '<button type="button" class="cart-line__remove" data-remove="' + it.id + '">' + t("cartRemove") + '</button>' +
          "</div>" +
        "</div>" +
      "</div>";
    }).join("");

    Array.prototype.forEach.call(body.querySelectorAll("[data-remove]"), function (btn) {
      btn.addEventListener("click", function () {
        removeFromCart(Number(btn.getAttribute("data-remove")));
      });
    });

    var hasWhatsapp = !!SHOP_CONFIG.whatsappNumber;
    var hasEmail = !!SHOP_CONFIG.email;
    var encoded = encodeURIComponent(buildOrderText());

    var footHtml = '<div class="cart-total"><span>' + t("cartTotal") + '</span><span>' + fmtPrice(total) + "</span></div>";
    if (hasWhatsapp) {
      footHtml += '<a class="cart-checkout-btn cart-checkout-btn--whatsapp" target="_blank" rel="noopener" href="https://wa.me/' +
        SHOP_CONFIG.whatsappNumber + '?text=' + encoded + '">' + t("cartWhatsapp") + '</a>';
    }
    if (hasEmail) {
      footHtml += '<a class="cart-checkout-btn cart-checkout-btn--email" href="mailto:' + SHOP_CONFIG.email +
        '?subject=' + encodeURIComponent(t("orderSubject")) + '&body=' + encoded + '">' + t("cartEmail") + '</a>';
    }
    if (!hasWhatsapp && !hasEmail) {
      footHtml += '<p class="cart-config-warning">' + t("cartConfigWarning") + '</p>';
    }
    footHtml += '<p class="cart-note">' + t("cartNote") + '</p>';
    foot.innerHTML = footHtml;
  }

  // ---- Verleih-Anfrage (Rental) ----
  // Jedes verfuegbare Stueck laesst sich ausleihen statt kaufen - fuer
  // Shootings, Musikvideos, Film-/Theaterproduktionen, redaktionelle
  // Strecken, Events oder private Anlaesse (siehe eigene Mieten-Kategorie,
  // showMieten()). Kein echtes Buchungssystem/Verfuegbarkeitskalender im
  // Backend (es gibt noch keine Datenbank), sondern wie der Warenkorb eine
  // unverbindliche Anfrage per WhatsApp/E-Mail, hier zusaetzlich mit
  // Zeitraum (natives <input type="date">, also ein echter, barrierefreier
  // Systemkalender) und Verwendungszweck.
  var RENTAL_PURPOSE_KEYS = {
    photo: "rentalPurposePhoto", video: "rentalPurposeVideo",
    filmTheater: "rentalPurposeFilmTheater", editorial: "rentalPurposeEditorial",
    event: "rentalPurposeEvent", private: "rentalPurposePrivate", other: "rentalPurposeOther"
  };
  var rentalBackdrop = document.getElementById("rentalModalBackdrop");
  var rentalModalEl = document.querySelector(".rental-modal");
  var rentalItemEl = document.getElementById("rentalModalItem");
  var rentalStartEl = document.getElementById("rentalStart");
  var rentalEndEl = document.getElementById("rentalEnd");
  var rentalDaysEl = document.getElementById("rentalDaysText");
  var rentalErrorEl = document.getElementById("rentalDateError");
  var rentalPurposeEl = document.getElementById("rentalPurpose");
  var rentalMessageEl = document.getElementById("rentalMessage");
  var rentalActionsEl = document.getElementById("rentalModalActions");
  var rentalCloseBtn = document.getElementById("rentalModalClose");
  var rentalCurrentItem = null;
  var rentalLastFocusEl = null;

  function todayIso() {
    var d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  function rentalDayCount() {
    if (!rentalStartEl.value || !rentalEndEl.value) return null;
    var start = new Date(rentalStartEl.value + "T00:00:00");
    var end = new Date(rentalEndEl.value + "T00:00:00");
    var diff = Math.round((end - start) / 86400000) + 1;
    return diff;
  }

  function rentalValid() {
    var days = rentalDayCount();
    return days !== null && days >= 1;
  }

  function updateRentalSummary() {
    var days = rentalDayCount();
    if (days === null) {
      rentalDaysEl.textContent = "";
      rentalErrorEl.classList.add("hidden");
    } else if (days < 1) {
      rentalDaysEl.textContent = "";
      rentalErrorEl.classList.remove("hidden");
    } else {
      rentalDaysEl.textContent = tFormat("rentalDaysTemplate", { days: days });
      rentalErrorEl.classList.add("hidden");
    }
    renderRentalActions();
  }

  // "2026-09-10" -> "10.09.2026" (DE/FR) bzw. sprachgerechtes Datum (EN) -
  // liesst sich in der fertig formulierten Mail natuerlicher als das rohe
  // ISO-Format aus dem <input type="date">.
  function fmtRentalDate(iso) {
    if (!iso) return "";
    var parts = iso.split("-");
    if (parts.length !== 3) return iso;
    var d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    if (isNaN(d.getTime())) return iso;
    var localeMap = { de: "de-DE", en: "en-GB", fr: "fr-FR" };
    try {
      return d.toLocaleDateString(localeMap[LANG] || "de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
    } catch (e) {
      return iso;
    }
  }

  // Fertig formulierte, komplette E-Mail statt einer reinen Stichpunktliste -
  // liest sich wie eine echte Nachricht der Kundschaft an den Shop (Anrede,
  // konkreter Artikel, Zeitraum, Zweck, Schlussformel), nicht wie ein reiner
  // Datenauszug. Gilt fuer WhatsApp genauso wie fuer die E-Mail, damit beide
  // Kanaele denselben, vollstaendigen Text verwenden.
  function buildRentalText() {
    var it = rentalCurrentItem;
    if (!it) return "";
    var purposeKey = RENTAL_PURPOSE_KEYS[rentalPurposeEl.value] || "rentalPurposeOther";
    var itemLine = productAltText(it) + " (" + t("orderArticleAbbrev") + (it.article || it.id) + ")";
    var periodLine = fmtRentalDate(rentalStartEl.value) + " – " + fmtRentalDate(rentalEndEl.value) +
      " (" + tFormat("rentalDaysTemplate", { days: rentalDayCount() }) + ")";
    var lines = [
      tFormat("rentalEmailIntro", { item: itemLine }),
      "",
      t("rentalPeriodLabel") + ": " + periodLine,
      t("rentalPurposeMsgLabel") + ": " + t(purposeKey)
    ];
    if (rentalMessageEl.value.trim()) {
      lines.push(t("rentalMessageMsgLabel") + ": " + rentalMessageEl.value.trim());
    }
    lines.push("");
    lines.push(t("rentalEmailClosing"));
    return lines.join("\n");
  }

  // Meldet die Anfrage zusaetzlich zur WhatsApp-/E-Mail-Nachricht best-effort
  // an den Shop-Worker (POST /rental-request, siehe shop-worker/worker.js),
  // damit sie im (kuenftigen) Admin-Dashboard auftaucht. Nur aktiv, wenn
  // shopWorkerUrl in config/shop-config.json gesetzt ist - ohne Worker-URL
  // funktioniert die Anfrage weiterhin unveraendert rein per WhatsApp/E-Mail.
  // Fehler werden bewusst verschluckt: das Absenden der eigentlichen
  // Anfrage (WhatsApp/E-Mail) darf niemals von der Erreichbarkeit des
  // Workers abhaengen.
  var rentalReportedForKey = null;
  function reportRentalToBackend() {
    if (!SHOP_CONFIG.shopWorkerUrl || !rentalCurrentItem) return;
    var key = rentalCurrentItem.id + "|" + rentalStartEl.value + "|" + rentalEndEl.value;
    if (rentalReportedForKey === key) return;
    rentalReportedForKey = key;
    fetch(SHOP_CONFIG.shopWorkerUrl.replace(/\/+$/, "") + "/rental-request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        itemId: rentalCurrentItem.id,
        start: rentalStartEl.value,
        end: rentalEndEl.value,
        purpose: rentalPurposeEl.value,
        message: rentalMessageEl.value.trim()
      })
    }).catch(function () {});
  }

  function renderRentalActions() {
    var hasWhatsapp = !!SHOP_CONFIG.whatsappNumber;
    var hasEmail = !!SHOP_CONFIG.email;
    var valid = rentalValid();
    var html = "";
    if (!valid) {
      rentalActionsEl.innerHTML = "";
      return;
    }
    var encoded = encodeURIComponent(buildRentalText());
    if (hasWhatsapp) {
      html += '<a href="https://wa.me/' + SHOP_CONFIG.whatsappNumber + '?text=' + encoded +
        '" target="_blank" rel="noopener" data-rental-submit="whatsapp">' + t("rentalWhatsapp") + '</a>';
    }
    if (hasEmail) {
      html += '<a href="mailto:' + SHOP_CONFIG.email + '?subject=' + encodeURIComponent(t("rentalSubject")) +
        '&body=' + encoded + '" data-rental-submit="email">' + t("rentalEmail") + '</a>';
    }
    if (!hasWhatsapp && !hasEmail) {
      html += '<p class="rental-modal__config-warning">' + t("rentalConfigWarning") + '</p>';
    }
    rentalActionsEl.innerHTML = html;
    Array.prototype.forEach.call(rentalActionsEl.querySelectorAll("[data-rental-submit]"), function (a) {
      a.addEventListener("click", reportRentalToBackend);
    });
  }

  // Fester Mietpreis pro Stueck (optional, siehe rental_price in
  // data/items.json) statt einer dem Kunden vorgerechneten Formel -
  // branchenueblich (Rent the Runway, By Rotation: jedes Stueck hat einen
  // vom Anbieter festgelegten Preis, keine live berechnete Kundenanzeige).
  // Ohne gepflegten Wert bleibt es bei "Mietpreis auf Anfrage".
  function fmtRentalPrice(it) {
    if (it.rental_price > 0) return t("rentalPriceLabel") + ": " + fmtPrice(it.rental_price);
    return t("rentalPriceOnRequest");
  }

  function openRentalModal(itemId) {
    var it = findItem(itemId);
    if (!it) return;
    rentalCurrentItem = it;
    rentalLastFocusEl = document.activeElement;
    var hero = assetUrl(it.gallery && it.gallery[0] ? it.gallery[0] : "");
    // Verkaufte Stuecke sind nicht mehr mietbar - Katalog/Artikelseite
    // verstecken den Anfragen-Button dafuer bereits, aber der Deep-Link
    // /mieten/?item=<id> (z.B. ein alter geteilter Link) rief bisher
    // ungeprueft direkt dieses Formular auf. Statt es zu oeffnen, zeigt
    // der Dialog jetzt nur Foto + Hinweis, keine Datums-/Anfragefelder
    // (siehe .rental-modal--sold in app.css).
    var isSold = it.status === "Verkauft";
    rentalModalEl.classList.toggle("rental-modal--sold", isSold);
    rentalItemEl.innerHTML =
      (hero ? '<img src="' + hero + '" alt="" />' : "") +
      '<div class="rental-modal__item-body">' +
        '<div>' + escapeHtml(productAltText(it)) + "</div>" +
        '<div class="rental-modal__item-price' + (isSold ? " rental-modal__item-price--sold" : "") + '">' +
          (isSold ? t("rentalSoldNote") : fmtRentalPrice(it)) +
        "</div>" +
      "</div>";
    rentalBackdrop.classList.remove("hidden");
    document.body.classList.add("no-scroll");
    if (isSold) {
      rentalActionsEl.innerHTML = "";
      rentalCloseBtn.focus();
      return;
    }
    var min = todayIso();
    rentalStartEl.min = min;
    rentalEndEl.min = min;
    rentalStartEl.value = "";
    rentalEndEl.value = "";
    rentalPurposeEl.value = "photo";
    rentalMessageEl.value = "";
    updateRentalSummary();
    rentalStartEl.focus();
  }

  function closeRentalModal() {
    rentalBackdrop.classList.add("hidden");
    document.body.classList.remove("no-scroll");
    rentalCurrentItem = null;
    if (rentalLastFocusEl && typeof rentalLastFocusEl.focus === "function") rentalLastFocusEl.focus();
  }

  rentalStartEl.addEventListener("change", function () {
    rentalEndEl.min = rentalStartEl.value || todayIso();
    updateRentalSummary();
  });
  rentalEndEl.addEventListener("change", updateRentalSummary);
  rentalPurposeEl.addEventListener("change", renderRentalActions);
  rentalMessageEl.addEventListener("input", renderRentalActions);
  rentalCloseBtn.addEventListener("click", closeRentalModal);
  rentalBackdrop.addEventListener("click", function (e) {
    if (e.target === rentalBackdrop) closeRentalModal();
  });
  // Einfache Fokus-Falle: Tab/Shift+Tab bleiben innerhalb des Dialogs,
  // Escape schliesst - wie bei den anderen Overlays der Seite.
  rentalBackdrop.addEventListener("keydown", function (e) {
    if (e.key === "Escape") { closeRentalModal(); return; }
    if (e.key !== "Tab") return;
    var focusables = rentalBackdrop.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (!focusables.length) return;
    var first = focusables[0], last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  // Warenkorb hat eine echte, eigene URL (/cart/, /en/cart/, /fr/cart/) statt
  // nur eine Overlay-Klasse umzuschalten oder eines Hash-Fragments - jede
  // existiert als eigene Datei (siehe build_special_pages() in build_site.py,
  // eine vollstaendige Kopie dieser Seite, die beim Laden anhand von
  // location.pathname die Schublade sofort oeffnet). Von hier aus wechselt
  // ein Klick per pushState schnell und ohne Neuladen dorthin; der
  // Zurueck-Button des Browsers schliesst den Warenkorb wieder; die URL
  // laesst sich echt teilen.
  var CART_PATH = langHome(LANG) + "cart/";
  Array.prototype.forEach.call(document.querySelectorAll("#cartToggle, #footerCartToggle"), function (el) {
    el.href = CART_PATH;
  });

  var cartLastFocusEl = null;
  function showCartUI() {
    renderCartDrawer(true);
    cartLastFocusEl = document.activeElement;
    document.getElementById("cartBackdrop").classList.add("open");
    document.body.style.overflow = "hidden";
    document.getElementById("cartClose").focus();
  }

  function hideCartUI() {
    document.getElementById("cartBackdrop").classList.remove("open");
    document.body.style.overflow = "";
    if (cartLastFocusEl && typeof cartLastFocusEl.focus === "function") cartLastFocusEl.focus();
  }
  bindFocusTrap(
    document.getElementById("cartDrawer"),
    function () { return document.getElementById("cartBackdrop").classList.contains("open"); },
    closeCart
  );

  function openCart() {
    if (location.pathname !== CART_PATH) history.pushState({ cart: true }, "", CART_PATH);
    showCartUI();
  }

  function closeCart() {
    // Bewusst kein history.back(): wenn /cart/ direkt (neuer Tab, geteilter
    // Link) statt per Klick von der Startseite aus geoeffnet wurde, gibt es
    // in der Tab-Historie u.U. gar keinen eigenen vorherigen Eintrag mehr -
    // "Zurueck" wuerde dann auf eine fremde Seite oder eine leere Seite
    // fuehren statt auf disorder119.com. Immer gezielt zur Sprach-Startseite.
    if (location.pathname === CART_PATH) location.href = langHome(LANG);
    else hideCartUI();
  }

  window.addEventListener("popstate", function () {
    if (location.pathname === CART_PATH) showCartUI();
    else hideCartUI();
  });

  Array.prototype.forEach.call(document.querySelectorAll("#cartToggle, #footerCartToggle"), function (el) {
    el.addEventListener("click", function (e) { e.preventDefault(); openCart(); });
  });
  document.getElementById("menuCart").addEventListener("click", function () {
    closeMenu();
    showClassic();
    openCart();
  });
  document.getElementById("menuRental").href = langHome(LANG) + "mieten/";
  document.getElementById("menuRental").addEventListener("click", function (e) {
    e.preventDefault();
    closeMenu();
    showMieten();
  });
  document.getElementById("cartClose").addEventListener("click", closeCart);
  document.getElementById("cartBackdrop").addEventListener("click", function (e) {
    if (e.target === document.getElementById("cartBackdrop")) closeCart();
  });
  updateCartCount();
  // Direktaufruf von /cart/ - Schublade sofort zeigen, ohne einen weiteren
  // Verlaufseintrag draufzupacken (der existiert ja schon durch das Laden
  // dieser Seite selbst).
  if (location.pathname === CART_PATH) showCartUI();

  var state = {
    query: "",
    // Standardmaessig nur AVAILABLE zeigen - das Archiv (SOLD) ist ein
    // bewusster, eigener Erkundungs-Zustand, kein Standard-Anblick.
    status: "Verfügbar",
    category: "all",
    categoryGroup: null,
    sort: "brightness",
    department: "",
    productType: "",
    brand: "",
    size: "",
    color: "",
    condition: "",
    priceMin: null,
    priceMax: null,
    catalogLabelKey: "statusAvailable",
    catalogLabelCategory: "",
    catalogLabelText: ""
  };

  // Nur oeffentliche Artikel (AVAILABLE/SOLD) fliessen in Statistiken,
  // Filter-Optionen und Chip-Listen ein - DRAFT-Artikel (unklarer interner
  // Zwischenstatus) bleiben komplett unsichtbar, auch indirekt.
  var PUBLIC_ITEMS = ITEMS.filter(function (it) { return it.public_status !== "DRAFT"; });

  // Marken, von denen aktuell nichts verfuegbar ist (nur noch verkaufte
  // Stuecke), tauchen bewusst nirgends auf (Zaehler, Marken-Filter, Menue-
  // Markenliste) - man kann dort ohnehin nichts kaufen, das waere nur
  // Frust staetter Auswahl.
  var brandsSet = {};
  var availableCount = 0;
  PUBLIC_ITEMS.forEach(function (it) {
    if (it.public_status === "AVAILABLE") {
      if (it.brand) brandsSet[it.brand] = true;
      availableCount++;
    }
  });

  document.getElementById("metaTotal").textContent = PUBLIC_ITEMS.length;
  document.getElementById("metaAvailable").textContent = availableCount;
  document.getElementById("metaBrands").textContent = Object.keys(brandsSet).length;
  document.getElementById("footerStamp").textContent =
    "Stand: " + new Date().toLocaleDateString("de-DE", { year: "numeric", month: "long", day: "numeric" });

  // ---- Status chips ----
  var statusChipsEl = document.getElementById("statusChips");
  var statusOptions = [
    { key: "all", label: "Alle", i18n: "statusAll" },
    { key: "Verfügbar", label: "Verfügbar", i18n: "statusAvailable" },
    { key: "Verkauft", label: "Bereits verkauft", i18n: "statusSold" }
  ];
  statusOptions.forEach(function (opt) {
    var b = document.createElement("button");
    b.className = "chip";
    b.type = "button";
    b.textContent = opt.label;
    b.setAttribute("data-i18n", opt.i18n);
    b.setAttribute("aria-pressed", opt.key === state.status ? "true" : "false");
    b.addEventListener("click", function () {
      state.status = opt.key;
      state.catalogLabelKey = opt.i18n;
      state.catalogLabelCategory = "";
      state.catalogLabelText = "";
      Array.prototype.forEach.call(statusChipsEl.children, function (c) {
        c.setAttribute("aria-pressed", "false");
      });
      b.setAttribute("aria-pressed", "true");
      render();
    });
    statusChipsEl.appendChild(b);
  });

  // ---- Category chips ----
  var categoryChipsEl = document.getElementById("categoryChips");
  var categories = {};
  PUBLIC_ITEMS.forEach(function (it) {
    var browseCategory = it.taxonomy_category || it.category;
    if (browseCategory) categories[browseCategory] = (categories[browseCategory] || 0) + 1;
  });
  var categoryList = Object.keys(categories).sort(function (a, b) {
    return categories[b] - categories[a];
  });
  var allCatBtn = document.createElement("button");
  allCatBtn.className = "chip";
  allCatBtn.type = "button";
  allCatBtn.textContent = "Alle Kategorien";
  allCatBtn.setAttribute("data-i18n", "categoryAll");
  allCatBtn.setAttribute("aria-pressed", "true");
  allCatBtn.addEventListener("click", function () {
    state.category = "all";
    state.categoryGroup = null;
    state.catalogLabelKey = "categoryAll";
    state.catalogLabelCategory = "";
    state.catalogLabelText = "";
    Array.prototype.forEach.call(categoryChipsEl.children, function (c) {
      c.setAttribute("aria-pressed", "false");
    });
    allCatBtn.setAttribute("aria-pressed", "true");
    render();
  });
  categoryChipsEl.appendChild(allCatBtn);
  categoryList.forEach(function (cat) {
    var b = document.createElement("button");
    b.className = "chip";
    b.type = "button";
    b.textContent = trCategory(cat);
    b.setAttribute("data-cat", cat);
    b.setAttribute("aria-pressed", "false");
    b.addEventListener("click", function () {
      state.category = cat;
      state.categoryGroup = null;
      state.catalogLabelKey = "";
      state.catalogLabelCategory = cat;
      state.catalogLabelText = "";
      Array.prototype.forEach.call(categoryChipsEl.children, function (c) {
        c.setAttribute("aria-pressed", "false");
      });
      b.setAttribute("aria-pressed", "true");
      render();
    });
    categoryChipsEl.appendChild(b);
  });

  // ---- Weitere Filter: Bereich, Produkttyp, Marke, Groesse, Farbe, Zustand, Preis ----
  // Bewusst hinter einem Umschalter versteckt (statt permanent in der Leiste),
  // damit die Oberflaeche bei "nur mal schnell stoebern" nicht ueberladen
  // wirkt - wer gezielt filtern will, klappt sie auf.
  var filterPanel = document.getElementById("filterPanel");
  var activeFiltersEl = document.getElementById("activeFilters");
  var moreFiltersToggle = document.getElementById("moreFiltersToggle");
  moreFiltersToggle.addEventListener("click", function () {
    var willShow = filterPanel.classList.contains("hidden");
    filterPanel.classList.toggle("hidden", !willShow);
    moreFiltersToggle.setAttribute("aria-expanded", willShow ? "true" : "false");
  });

  var filterDepartmentEl = document.getElementById("filterDepartment");
  var filterProductTypeEl = document.getElementById("filterProductType");
  var filterBrandEl = document.getElementById("filterBrand");
  var filterSizeEl = document.getElementById("filterSize");
  var filterColorEl = document.getElementById("filterColor");
  var filterConditionEl = document.getElementById("filterCondition");
  var filterPriceMinEl = document.getElementById("filterPriceMin");
  var filterPriceMaxEl = document.getElementById("filterPriceMax");

  function fillSelect(el, values, translateFn) {
    values.forEach(function (v) {
      var opt = document.createElement("option");
      opt.value = v;
      opt.textContent = translateFn ? translateFn(v) : v;
      el.appendChild(opt);
    });
  }

  var departmentSet = {};
  var productTypeSet = {};
  PUBLIC_ITEMS.forEach(function (it) {
    if (it.department) departmentSet[it.department] = true;
    if (it.product_type) productTypeSet[it.product_type] = true;
  });
  ["Women", "Men", "Unisex", "Objects"].forEach(function (department) {
    if (departmentSet[department]) fillSelect(filterDepartmentEl, [department], trDepartment);
  });
  fillSelect(
    filterProductTypeEl,
    Object.keys(productTypeSet).sort(function (a, b) { return trProductType(a).localeCompare(trProductType(b), LANG); }),
    trProductType
  );

  var filterBrandsSet = {};
  PUBLIC_ITEMS.forEach(function (it) { if (it.brand) filterBrandsSet[it.brand] = true; });
  var brandList = Object.keys(filterBrandsSet).sort(function (a, b) { return a.localeCompare(b, "de"); });
  fillSelect(filterBrandEl, brandList);

  var sizeSet = {};
  PUBLIC_ITEMS.forEach(function (it) {
    if (it.size_normalized && it.size_normalized !== "Unknown") sizeSet[it.size_normalized] = true;
  });
  fillSelect(filterSizeEl, Object.keys(sizeSet).sort(function (a, b) { return a.localeCompare(b, "de", { numeric: true }); }), trSize);

  var colorSet = {};
  PUBLIC_ITEMS.forEach(function (it) {
    (it.color || "").split(",").forEach(function (c) {
      c = c.trim();
      if (c) colorSet[c] = true;
    });
  });
  fillSelect(filterColorEl, Object.keys(colorSet).sort(function (a, b) { return a.localeCompare(b, "de"); }));

  var conditionSet = {};
  PUBLIC_ITEMS.forEach(function (it) { if (it.condition) conditionSet[it.condition] = true; });
  var conditionList = Object.keys(conditionSet).sort();
  fillSelect(filterConditionEl, conditionList, trCondition);

  filterDepartmentEl.addEventListener("change", function () { state.department = filterDepartmentEl.value; render(); });
  filterProductTypeEl.addEventListener("change", function () { state.productType = filterProductTypeEl.value; render(); });
  filterBrandEl.addEventListener("change", function () { state.brand = filterBrandEl.value; render(); });
  filterSizeEl.addEventListener("change", function () { state.size = filterSizeEl.value; render(); });
  filterColorEl.addEventListener("change", function () { state.color = filterColorEl.value; render(); });
  filterConditionEl.addEventListener("change", function () { state.condition = filterConditionEl.value; render(); });
  filterPriceMinEl.addEventListener("input", function () {
    state.priceMin = filterPriceMinEl.value === "" ? null : Number(filterPriceMinEl.value);
    render();
  });
  filterPriceMaxEl.addEventListener("input", function () {
    state.priceMax = filterPriceMaxEl.value === "" ? null : Number(filterPriceMaxEl.value);
    render();
  });

  function facetValues(it, facet) {
    if (facet === "department") return it.department ? [it.department] : [];
    if (facet === "productType") return it.product_type ? [it.product_type] : [];
    if (facet === "brand") return it.brand ? [it.brand] : [];
    if (facet === "size") return it.size_normalized && it.size_normalized !== "Unknown" ? [it.size_normalized] : [];
    if (facet === "condition") return it.condition ? [it.condition] : [];
    if (facet === "color") return (it.color || "").split(",").map(function (c) { return c.trim(); }).filter(Boolean);
    return [];
  }

  function updateFacetSelect(selectEl, facet, labelFn, allLabelKey) {
    var eligible = PUBLIC_ITEMS.filter(function (it) { return matches(it, facet); });
    var counts = {};
    eligible.forEach(function (it) {
      facetValues(it, facet).forEach(function (value) { counts[value] = (counts[value] || 0) + 1; });
    });
    if (selectEl.options.length) selectEl.options[0].textContent = t(allLabelKey) + " (" + eligible.length + ")";
    for (var i = 1; i < selectEl.options.length; i++) {
      var opt = selectEl.options[i];
      var count = counts[opt.value] || 0;
      opt.textContent = labelFn(opt.value) + " (" + count + ")";
      opt.disabled = count === 0 && opt.value !== selectEl.value;
    }
  }

  function refreshFacetOptions() {
    updateFacetSelect(filterDepartmentEl, "department", trDepartment, "filterAllDepartments");
    updateFacetSelect(filterProductTypeEl, "productType", trProductType, "filterAllProductTypes");
    updateFacetSelect(filterBrandEl, "brand", function (v) { return v; }, "filterAllBrands");
    updateFacetSelect(filterSizeEl, "size", trSize, "filterAllSizes");
    updateFacetSelect(filterColorEl, "color", function (v) { return v; }, "filterAllColors");
    updateFacetSelect(filterConditionEl, "condition", trCondition, "filterAllConditions");
  }

  function clearOneArchiveFilter(key) {
    if (key === "query") { state.query = ""; searchInputEl.value = ""; }
    else if (key === "department") { state.department = ""; filterDepartmentEl.value = ""; }
    else if (key === "productType") { state.productType = ""; filterProductTypeEl.value = ""; }
    else if (key === "brand") { state.brand = ""; filterBrandEl.value = ""; }
    else if (key === "size") { state.size = ""; filterSizeEl.value = ""; }
    else if (key === "color") { state.color = ""; filterColorEl.value = ""; }
    else if (key === "condition") { state.condition = ""; filterConditionEl.value = ""; }
    else if (key === "price") { state.priceMin = null; state.priceMax = null; filterPriceMinEl.value = ""; filterPriceMaxEl.value = ""; }
    else if (key === "category") { state.category = "all"; state.categoryGroup = null; syncCatalogChips(); }
    else if (key === "status") { state.status = "Verfügbar"; syncCatalogChips(); }
    render();
  }

  function clearAllActiveArchiveFilters() {
    state.query = ""; searchInputEl.value = "";
    state.department = ""; state.productType = ""; state.brand = ""; state.size = ""; state.color = ""; state.condition = "";
    state.priceMin = null; state.priceMax = null;
    state.category = "all"; state.categoryGroup = null; state.status = "Verfügbar";
    filterDepartmentEl.value = ""; filterProductTypeEl.value = ""; filterBrandEl.value = ""; filterSizeEl.value = "";
    filterColorEl.value = ""; filterConditionEl.value = ""; filterPriceMinEl.value = ""; filterPriceMaxEl.value = "";
    syncCatalogChips();
    render();
  }

  function renderActiveFilters() {
    var filters = [];
    if (state.query) filters.push({ key: "query", label: t("activeFilterSearch"), value: searchInputEl.value.trim() });
    if (state.department) filters.push({ key: "department", label: t("activeFilterDepartment"), value: trDepartment(state.department) });
    if (state.productType) filters.push({ key: "productType", label: t("activeFilterProductType"), value: trProductType(state.productType) });
    if (state.brand) filters.push({ key: "brand", label: t("activeFilterBrand"), value: state.brand });
    if (state.size) filters.push({ key: "size", label: t("activeFilterSize"), value: trSize(state.size) });
    if (state.color) filters.push({ key: "color", label: t("activeFilterColor"), value: state.color });
    if (state.condition) filters.push({ key: "condition", label: t("activeFilterCondition"), value: trCondition(state.condition) });
    if (state.priceMin != null || state.priceMax != null) {
      var priceValue = (state.priceMin != null ? state.priceMin : "0") + "–" + (state.priceMax != null ? state.priceMax : "∞") + " €";
      filters.push({ key: "price", label: t("activeFilterPrice"), value: priceValue });
    }
    if (state.category !== "all") filters.push({ key: "category", label: t("activeFilterCategory"), value: trCategory(state.category) });
    else if (state.categoryGroup && state.categoryGroup.length) {
      filters.push({ key: "category", label: t("activeFilterCategory"), value: state.categoryGroup.map(trCategory).join(" + ") });
    }
    if (state.status !== "Verfügbar") {
      var statusValue = state.status === "Verkauft" ? t("statusSold") : t("statusAll");
      filters.push({ key: "status", label: t("activeFilterStatus"), value: statusValue });
    }

    activeFiltersEl.setAttribute("aria-label", t("activeFiltersAria"));
    activeFiltersEl.innerHTML = "";
    filters.forEach(function (filter) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "chip";
      btn.textContent = filter.label + ": " + filter.value + " ×";
      btn.setAttribute("aria-label", filter.label + " " + filter.value + " " + t("activeFilterRemove"));
      btn.addEventListener("click", function () { clearOneArchiveFilter(filter.key); });
      activeFiltersEl.appendChild(btn);
    });
    if (filters.length > 1) {
      var clear = document.createElement("button");
      clear.type = "button";
      clear.className = "active-filter-clear";
      clear.textContent = t("activeFilterClear");
      clear.addEventListener("click", clearAllActiveArchiveFilters);
      activeFiltersEl.appendChild(clear);
    }
    activeFiltersEl.classList.toggle("hidden", filters.length === 0);

    var panelFilterCount = [state.department, state.productType, state.brand, state.size, state.color, state.condition].filter(Boolean).length +
      ((state.priceMin != null || state.priceMax != null) ? 1 : 0);
    moreFiltersToggle.textContent = t("moreFilters") + (panelFilterCount ? " · " + panelFilterCount : "");
  }

  document.getElementById("filterReset").addEventListener("click", function () {
    state.department = ""; state.productType = ""; state.brand = ""; state.size = ""; state.color = ""; state.condition = "";
    state.priceMin = null; state.priceMax = null;
    // category/categoryGroup belong to the main archive navigation, not this panel.
    filterDepartmentEl.value = ""; filterProductTypeEl.value = ""; filterBrandEl.value = ""; filterSizeEl.value = ""; filterColorEl.value = ""; filterConditionEl.value = "";
    filterPriceMinEl.value = ""; filterPriceMaxEl.value = "";
    render();
  });

  // ---- Suche: Umlaute/Akzente ignorieren, Marken-Kurzformen/Tippfehler tolerieren ----
  function normalizeText(s) {
    return (s || "").toLowerCase()
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[’'`]/g, "");
  }

  var BRAND_ALIASES = {
    "gaultier": "jean paul gaultier", "jpg": "jean paul gaultier",
    "yohji": "yohji yamamoto",
    "y3": "y-3",
    "cdg": "comme des garcons", "comme": "comme des garcons",
    "mcqueen": "alexander mcqueen",
    "ysl": "yves saint laurent", "saint laurent": "yves saint laurent",
    "margiela": "maison margiela", "mmm": "maison margiela",
    "mm6": "mm6 maison margiela",
    "raf": "raf simons",
    "vandevorst": "a.f. vandevorst", "af vandevorst": "a.f. vandevorst",
    "demeulemeester": "ann demeulemeester",
    "dg": "dolce gabbana", "d&g": "dolce gabbana"
  };

  // Kleine Levenshtein-Distanz fuer Tippfehlertoleranz - bewusst ohne
  // Bibliothek, da nur kurze Woerter (Marken/Titel-Tokens) verglichen werden.
  function levenshtein(a, b) {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    var prev = [];
    for (var j = 0; j <= b.length; j++) prev[j] = j;
    for (var i = 1; i <= a.length; i++) {
      var cur = [i];
      for (var j2 = 1; j2 <= b.length; j2++) {
        cur[j2] = Math.min(prev[j2] + 1, cur[j2 - 1] + 1, prev[j2 - 1] + (a[i - 1] === b[j2 - 1] ? 0 : 1));
      }
      prev = cur;
    }
    return prev[b.length];
  }

  function fuzzyIncludes(haystack, needle) {
    if (!needle) return true;
    if (haystack.indexOf(needle) !== -1) return true;
    if (needle.length < 4) return false;
    var maxDist = needle.length <= 6 ? 1 : 2;
    var words = haystack.split(/\s+/);
    for (var i = 0; i < words.length; i++) {
      if (Math.abs(words[i].length - needle.length) > maxDist + 1) continue;
      if (levenshtein(words[i], needle) <= maxDist) return true;
    }
    return false;
  }

  function queryMatchesHay(hay, q) {
    var expanded = BRAND_ALIASES[q] || q;
    if (fuzzyIncludes(hay, expanded)) return true;
    var qWords = q.split(/\s+/).filter(Boolean);
    if (qWords.length < 2) return false;
    return qWords.every(function (w) {
      var exp = BRAND_ALIASES[w] || w;
      return fuzzyIncludes(hay, exp);
    });
  }

  // ---- Search + sort ----
  var searchInputEl = document.getElementById("searchInput");
  searchInputEl.addEventListener("input", function (e) {
    state.query = normalizeText(e.target.value.trim());
    render();
  });
  document.getElementById("sortSelect").addEventListener("change", function (e) {
    state.sort = e.target.value;
    render();
  });

  // Setzt Suchfeld + Filter auf eine Marke - genutzt von klickbaren Marken-
  // Namen (Produktkarte/Modal) und von Produktseiten-Links ("?brand=...").
  function filterByBrand(brand) {
    if (!brand) return;
    searchInputEl.value = brand;
    state.query = normalizeText(brand);
    state.status = "all";
    state.catalogLabelKey = "";
    state.catalogLabelCategory = "";
    state.catalogLabelText = brand;
    Array.prototype.forEach.call(statusChipsEl.children, function (c) {
      c.setAttribute("aria-pressed", c.getAttribute("data-i18n") === "statusAll" ? "true" : "false");
    });
    state.category = "all";
    state.categoryGroup = null;
    Array.prototype.forEach.call(categoryChipsEl.children, function (c) {
      c.setAttribute("aria-pressed", c === allCatBtn ? "true" : "false");
    });
    // Zusaetzliche Filter zuruecksetzen, damit sie einem Marken-Klick nicht
    // unerwartet Ergebnisse wegfiltern (z.B. eine vorher gewaehlte Farbe).
    state.department = ""; state.productType = ""; state.brand = ""; state.size = ""; state.color = ""; state.condition = "";
    state.priceMin = null; state.priceMax = null;
    if (filterDepartmentEl) filterDepartmentEl.value = "";
    if (filterProductTypeEl) filterProductTypeEl.value = "";
    if (filterBrandEl) filterBrandEl.value = "";
    if (filterSizeEl) filterSizeEl.value = "";
    if (filterColorEl) filterColorEl.value = "";
    if (filterConditionEl) filterConditionEl.value = "";
    if (filterPriceMinEl) filterPriceMinEl.value = "";
    if (filterPriceMaxEl) filterPriceMaxEl.value = "";
    showClassic();
    render();
  }

  // ---- Grid rendering ----
  var gridEl = document.getElementById("grid");
  var emptyEl = document.getElementById("emptyState");
  var countEl = document.getElementById("railCount");
  var catalogTitleEl = document.getElementById("catalogTitle");
  var loadMoreBtn = document.getElementById("loadMoreBtn");
  var visibleLimit = 12;
  var lastFilterSignature = "";

  function matches(it, ignoreFacet) {
    // Klare, konsistente Statuslogik (statt der vorherigen impliziten
    // Sonderbehandlung): public_status kommt bereits fertig aus den
    // Artikeldaten (AVAILABLE/SOLD/DRAFT) - interne Manager-Zwischenstatus
    // wie "Bilder importiert" wurden dort schon zu DRAFT zusammengefasst und
    // erscheinen NIE oeffentlich, unabhaengig vom gewaehlten Filter.
    if (it.public_status === "DRAFT") return false;
    // "Alle" zeigt wirklich alle oeffentlichen Artikel (verfuegbar + Archiv) -
    // die Beschriftung darf nicht etwas versprechen, was der Filter nicht haelt.
    if (state.status === "Verfügbar" && it.public_status !== "AVAILABLE") return false;
    if (state.status === "Verkauft" && it.public_status !== "SOLD") return false;
    if (ignoreFacet !== "department" && state.department && it.department !== state.department) return false;
    if (ignoreFacet !== "productType" && state.productType && it.product_type !== state.productType) return false;
    if (ignoreFacet !== "brand" && state.brand && it.brand !== state.brand) return false;
    if (ignoreFacet !== "size" && state.size && it.size_normalized !== state.size) return false;
    if (ignoreFacet !== "condition" && state.condition && it.condition !== state.condition) return false;
    if (ignoreFacet !== "color" && state.color) {
      // Farbfeld ist teils Mehrfachangabe ("Schwarz, Weiß") - Treffer, wenn
      // die gewaehlte Farbe EINE der genannten Farben ist, nicht nur bei
      // exakter Gleichheit des ganzen Textfelds.
      var itColors = (it.color || "").split(",").map(function (c) { return c.trim(); });
      if (itColors.indexOf(state.color) === -1) return false;
    }
    if (ignoreFacet !== "price" && state.priceMin != null && !(it.price >= state.priceMin)) return false;
    if (ignoreFacet !== "price" && state.priceMax != null && !(it.price > 0 && it.price <= state.priceMax)) return false;
    var browseCategory = it.taxonomy_category || it.category;
    if (state.categoryGroup && state.categoryGroup.indexOf(browseCategory) === -1) return false;
    if (state.category !== "all" && browseCategory !== state.category) return false;
    if (state.query) {
      var hay = [
        it.title, it.brand, browseCategory, it.product_type, it.department,
        it.size, it.size_normalized
      ].map(normalizeText).join(" ");
      if (!queryMatchesHay(hay, state.query)) return false;
    }
    return true;
  }

  function sortItems(list) {
    var copy = list.slice();
    if (state.sort === "price-asc") copy.sort(function (a, b) { return a.price - b.price; });
    else if (state.sort === "price-desc") copy.sort(function (a, b) { return b.price - a.price; });
    else if (state.sort === "brand") copy.sort(function (a, b) { return a.brand.localeCompare(b.brand, "de"); });
    else if (state.sort === "brightness") {
      // Helle Teile zuerst, damit gegen den dunklen Seitenhintergrund nichts
      // "verschwindet" - je weiter man scrollt, desto dunkler/farbiger wird es.
      copy.sort(function (a, b) {
        var ba = typeof a.brightness === "number" ? a.brightness : 0.5;
        var bb = typeof b.brightness === "number" ? b.brightness : 0.5;
        return bb - ba;
      });
    }
    // "new" keeps the incoming (already newest-first) order

    // Verkaufte Artikel bleiben innerhalb der gewählten Sortierung,
    // rutschen aber immer ans Ende der Liste.
    var available = copy.filter(function (it) { return it.status !== "Verkauft"; });
    var sold = copy.filter(function (it) { return it.status === "Verkauft"; });
    return available.concat(sold);
  }

  var firstGridRenderDone = false;

  function render() {
    refreshFacetOptions();
    renderActiveFilters();
    var filtered = sortItems(ITEMS.filter(function (it) { return matches(it); }));

    // Die sichtbare Katalog-Ueberschrift muss immer zum tatsaechlichen
    // Filterzustand passen. Aktive Filter koennen einzeln geloescht werden;
    // davor blieben dabei alte Labels wie "Archiv", "Schuhe" oder eine
    // zuvor angeklickte Marke stehen, obwohl bereits andere Artikel gezeigt
    // wurden. Ein Markenlabel gilt nur solange die Suchquery noch exakt dazu
    // passt; Kategorie/Gruppen-Labels haben ansonsten Vorrang vor dem Status.
    if (state.catalogLabelText && normalizeText(state.catalogLabelText) !== state.query) {
      state.catalogLabelText = "";
    }
    if (state.category !== "all") {
      state.catalogLabelKey = "";
      state.catalogLabelCategory = state.category;
      state.catalogLabelText = "";
    } else if (!state.categoryGroup && !state.catalogLabelText) {
      state.catalogLabelCategory = "";
      state.catalogLabelKey = state.status === "Verkauft"
        ? "statusSold"
        : (state.status === "all" ? "statusAll" : "statusAvailable");
    }

    catalogTitleEl.textContent = state.catalogLabelText ||
      (state.catalogLabelCategory ? trCategory(state.catalogLabelCategory) : t(state.catalogLabelKey || "statusAvailable"));
    var filterSignature = JSON.stringify([
      state.query, state.status, state.category, state.categoryGroup,
      state.sort, state.department, state.productType, state.brand, state.size, state.color,
      state.condition, state.priceMin, state.priceMax
    ]);
    if (filterSignature !== lastFilterSignature) {
      visibleLimit = 12;
      lastFilterSignature = filterSignature;
    }
    var visibleItems = filtered.slice(0, visibleLimit);
    countEl.textContent = tFormat("railCountTemplate", { filtered: filtered.length, total: PUBLIC_ITEMS.length });
    gridEl.innerHTML = "";
    emptyEl.classList.toggle("visible", filtered.length === 0);

    // Nur beim allerersten Aufbau der Seite bekommen die ersten Karten ein
    // gestaffeltes Einblenden (spuerbarer Einstieg statt starrem Grid-Dump).
    // Bei jedem weiteren Render (Filter/Sortierung/Suche) bleibt es sofort
    // sichtbar, damit Interaktionen nicht kuenstlich verzoegert wirken.
    var animateEntry = !firstGridRenderDone;
    var animateCount = 16;

    var frag = document.createDocumentFragment();
    visibleItems.forEach(function (it, idx) {
      // Echter Link statt Klick-Handler auf ein <article> - Artikelseiten
      // existieren als vollwertige, einzeln teilbare Seiten (artikel/{id}/,
      // eigene og:-Tags fuer WhatsApp/Social-Vorschau) sowieso schon fuer jedes
      // Stueck. Rechtsklick "In neuem Tab oeffnen", Hover zeigt die Ziel-URL,
      // der Zurueck-Button des Browsers funktioniert normal - all das gibt es
      // bei einem reinen JS-Modal ohne eigene URL nicht.
      var plate = document.createElement("a");
      plate.className = "plate";
      // Absolut statt relativ ("artikel/" + id + "/"): das Klassik-Grid wird
      // immer aufgebaut (auch waehrend Match/Chaos/Baukasten aktiv sind, nur
      // eben unsichtbar), diese Katalog-Ansichten liegen aber jetzt auf
      // echten eigenen Pfaden wie /chaos/ - ein relativer Link haette sich
      // dort falsch aufgeloest (".../chaos/artikel/123/" statt "/artikel/123/").
      plate.href = langHome(LANG) + "artikel/" + it.id + "/";
      plate.setAttribute("aria-label", it.title);
      if (animateEntry && idx < animateCount) {
        plate.classList.add("plate--enter");
        plate.style.transitionDelay = (idx * 20) + "ms";
      }

      var hero = it.gallery && it.gallery[0];
      var imgSrc = assetUrl(hero || "");

      var altText = escapeHtml(productAltText(it));
      var isSold = it.status === "Verkauft";
      var priceHtml = isSold
        ? '<span class="plate__price plate__price--sold">' + t("sold") + "</span>"
        : RENTAL_CATALOG_MODE
          ? '<span class="plate__price">' + fmtRentalPrice(it) + "</span>"
          : '<span class="plate__price">' + (it.price_estimated ? t("priceEstimatedPrefix") : "") + fmtPriceDisplay(it.price) + "</span>";

      plate.innerHTML =
        '<div class="plate__frame">' +
          (imgSrc ? '<img src="' + imgSrc + '" alt="' + altText + '" loading="lazy" />' : "") +
        "</div>" +
        '<div class="plate__body">' +
          '<button type="button" class="plate__brand" data-brand-filter>' + escapeHtml(it.brand || t("noBrand")) + "</button>" +
          '<span class="plate__title">' + escapeHtml(it.title) + "</span>" +
          '<div class="plate__row">' +
            priceHtml +
          "</div>" +
          (isSold || !RENTAL_CATALOG_MODE ? "" : '<button type="button" class="plate__rental-btn" data-rental="' + it.id + '">' + t("rentalCta") + "</button>") +
        "</div>";

      var brandBtn = plate.querySelector("[data-brand-filter]");
      if (brandBtn && it.brand) {
        brandBtn.addEventListener("click", function (e) {
          e.preventDefault();
          e.stopPropagation();
          filterByBrand(it.brand);
        });
      }

      var rentalBtn = plate.querySelector("[data-rental]");
      if (rentalBtn) {
        rentalBtn.addEventListener("click", function (e) {
          e.preventDefault();
          e.stopPropagation();
          openRentalModal(it.id);
        });
      }

      if (canHover && it.gallery && it.gallery.length > 1) {
        var frameImg = plate.querySelector(".plate__frame img");
        var secondSrc = assetUrl(it.gallery[1]);
        plate.addEventListener("mouseenter", function () { frameImg.src = secondSrc; });
        plate.addEventListener("mouseleave", function () { frameImg.src = imgSrc; });
      }

      frag.appendChild(plate);
    });
    gridEl.appendChild(frag);
    loadMoreBtn.classList.toggle("hidden", filtered.length === 0 || visibleItems.length >= filtered.length);
    if (animateEntry) {
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          Array.prototype.forEach.call(gridEl.querySelectorAll(".plate--enter"), function (el) {
            el.classList.add("plate--in");
          });
        });
      });
      firstGridRenderDone = true;
    }
  }

  loadMoreBtn.addEventListener("click", function () {
    visibleLimit += 12;
    render();
  });

  // Automatisches Nachladen beim Runterscrollen - der Button bleibt im DOM
  // (Tastatur/Fallback), wird aber praktisch nie gebraucht: sobald er in die
  // Naehe des sichtbaren Bereichs kommt, laedt er sich selbst nach.
  if (typeof IntersectionObserver !== "undefined") {
    var loadMoreObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          visibleLimit += 12;
          render();
        }
      });
    }, { rootMargin: "1200px 0px" });
    loadMoreObserver.observe(loadMoreBtn);
  }

  // ---- Modal ----
  var backdrop = document.getElementById("modalBackdrop");
  var modalImg = document.getElementById("modalImg");
  var modalBrand = document.getElementById("modalBrand");
  modalBrand.addEventListener("click", function () {
    if (currentItem && currentItem.brand) {
      var brandToFilter = currentItem.brand;
      closeModal();
      filterByBrand(brandToFilter);
    }
  });
  var modalTitle = document.getElementById("modalTitle");
  var modalPrice = document.getElementById("modalPrice");
  var modalStamp = document.getElementById("modalStamp");
  var modalFacts = document.getElementById("modalFacts");
  var modalDesc = document.getElementById("modalDesc");
  var modalPrev = document.getElementById("modalPrev");
  var modalNext = document.getElementById("modalNext");
  var modalCounter = document.getElementById("modalCounter");
  var modalDots = document.getElementById("modalDots");
  var lastFocused = null;
  var currentItem = null;
  var currentPhoto = 0;

  function showPhoto(index) {
    var gallery = (currentItem && currentItem.gallery) || [];
    if (!gallery.length) {
      modalImg.src = "";
      modalImg.alt = "";
      modalPrev.style.display = "none";
      modalNext.style.display = "none";
      modalCounter.textContent = "";
      modalDots.innerHTML = "";
      return;
    }
    currentPhoto = Math.max(0, Math.min(index, gallery.length - 1));
    modalImg.src = assetUrl(gallery[currentPhoto]);
    modalImg.alt = currentItem.title + " — Foto " + (currentPhoto + 1) + " von " + gallery.length;

    var multi = gallery.length > 1;
    modalPrev.style.display = multi ? "" : "none";
    modalNext.style.display = multi ? "" : "none";
    modalPrev.disabled = currentPhoto === 0;
    modalNext.disabled = currentPhoto === gallery.length - 1;
    modalCounter.textContent = multi ? (currentPhoto + 1) + " / " + gallery.length : "";

    if (multi && gallery.length <= 12) {
      modalDots.innerHTML = gallery.map(function (_, i) {
        return '<button class="modal__dot" type="button" aria-current="' + (i === currentPhoto) + '" aria-label="Foto ' + (i + 1) + '"></button>';
      }).join("");
      Array.prototype.forEach.call(modalDots.children, function (dot, i) {
        dot.addEventListener("click", function () { showPhoto(i); });
      });
    } else {
      modalDots.innerHTML = "";
    }
  }

  modalPrev.addEventListener("click", function () { showPhoto(currentPhoto - 1); });
  modalNext.addEventListener("click", function () { showPhoto(currentPhoto + 1); });

  function openModal(it) {
    lastFocused = document.activeElement;
    currentItem = it;
    showPhoto(0);
    modalBrand.textContent = it.brand || t("noBrand");
    modalTitle.textContent = it.title;
    // Verkaufte Artikel zeigen nie mehr einen (alten) Preis - stattdessen die
    // Archiv-Kennzeichnung direkt an der Preis-Stelle, nicht nur als Badge.
    modalPrice.textContent = it.status === "Verkauft"
      ? t("soldArchiveBadge")
      : (it.price_estimated ? t("priceEstimatedPrefix") : "") + fmtPriceDisplay(it.price);
    modalPrice.classList.toggle("modal__price--sold", it.status === "Verkauft");

    modalStamp.innerHTML = it.price_estimated && it.status !== "Verkauft"
      ? '<span style="font-size:0.66rem;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:var(--accent);">' + t("priceEstimatedBadge") + '</span>'
      : "";

    var facts = [];
    if (it.category) facts.push([t("factCategory"), trCategory(it.category)]);
    if (it.size) facts.push([t("factSize"), trSize(it.size)]);
    if (it.color) facts.push([t("factColor"), it.color]);
    if (it.condition) facts.push([t("factCondition"), trCondition(it.condition)]);
    modalFacts.innerHTML = facts.map(function (f) {
      return '<div><div class="fact__label">' + escapeHtml(f[0]) + '</div><div class="fact__value">' + escapeHtml(f[1]) + "</div></div>";
    }).join("");

    modalDesc.textContent = trDescription(it);
    updateModalCartBtn();

    backdrop.classList.add("open");
    document.body.style.overflow = "hidden";
    document.getElementById("modalClose").focus();
  }

  function closeModal() {
    backdrop.classList.remove("open");
    document.body.style.overflow = "";
    currentItem = null;
    if (lastFocused) lastFocused.focus();
  }

  function updateModalCartBtn() {
    var btn = document.getElementById("modalCartBtn");
    if (!currentItem) return;
    if (currentItem.status === "Verkauft") {
      btn.textContent = t("sold");
      btn.disabled = true;
      btn.classList.remove("cart-cta--active");
      return;
    }
    if (!(currentItem.price > 0)) {
      btn.textContent = t("priceOnRequestCta");
      btn.disabled = true;
      btn.classList.remove("cart-cta--active");
      return;
    }
    btn.disabled = false;
    var active = isInCart(currentItem.id);
    btn.textContent = active ? t("inCartRemove") : t("addToCart");
    btn.classList.toggle("cart-cta--active", active);
  }

  document.getElementById("modalCartBtn").addEventListener("click", function () {
    if (!currentItem || currentItem.status === "Verkauft" || !(currentItem.price > 0)) return;
    toggleCart(currentItem.id);
  });

  document.getElementById("modalShare").addEventListener("click", function () {
    if (!currentItem) return;
    // Absolut + sprachbewusst statt relativ gegen location.href aufgeloest:
    // dieses Modal kann jetzt auch von /match/, /chaos/ oder /baukasten/ aus
    // geoeffnet werden (echte eigene URLs, keine reinen Client-Zustaende
    // mehr) - eine relative Aufloesung haette dort z.B. ".../chaos/artikel/
    // 123/" ergeben (404) statt der echten Artikel-URL.
    var shareUrl = location.origin + langHome(LANG) + "artikel/" + currentItem.id + "/";
    var shareTitle = (currentItem.brand ? currentItem.brand + " — " : "") + currentItem.title;
    var shareText = shareTitle + " bei Disorder119";
    if (navigator.share) {
      navigator.share({ title: shareTitle, text: shareText, url: shareUrl }).catch(function () {});
      return;
    }
    var toast = document.getElementById("modalShareToast");
    function showToast() {
      toast.classList.add("visible");
      setTimeout(function () { toast.classList.remove("visible"); }, 1800);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(shareUrl).then(showToast).catch(function () {});
    }
  });

  document.getElementById("modalClose").addEventListener("click", closeModal);
  backdrop.addEventListener("click", function (e) {
    if (e.target === backdrop) closeModal();
  });
  document.addEventListener("keydown", function (e) {
    if (!backdrop.classList.contains("open")) return;
    if (e.key === "Escape") { closeModal(); return; }
    if (e.key === "ArrowLeft") { showPhoto(currentPhoto - 1); return; }
    if (e.key === "ArrowRight") { showPhoto(currentPhoto + 1); return; }
    // Fokus-Falle: Tab/Shift+Tab bleiben innerhalb des Dialogs, statt in den
    // (unsichtbaren, weil vom Backdrop verdeckten) Hintergrund zu springen -
    // gleiches Muster wie beim Verleih-Modal.
    if (e.key !== "Tab") return;
    var focusables = document.getElementById("modal").querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (!focusables.length) return;
    var first = focusables[0], last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  // ---- Photo mount toggle (black / white ground behind the cut-out photos) ----
  var root = document.documentElement;
  var mountBtn = document.getElementById("mountToggle");
  mountBtn.addEventListener("click", function () {
    var next = root.getAttribute("data-mount") === "white" ? "black" : "white";
    if (next === "black") root.removeAttribute("data-mount");
    else root.setAttribute("data-mount", "white");
    mountBtn.textContent = next === "white" ? t("mountWhite") : t("mountBlack");
  });

  // ---- Ansicht-Auswahl (Archiv / Match / Chaos / Outfit-Baukasten) ----
  var appShell = document.getElementById("appShell");
  var swipeView = document.getElementById("swipeView");
  var chaosView = document.getElementById("chaosView");
  var outfitView = document.getElementById("outfitView");

  var modeRail = document.getElementById("modeRail");

  // Match/Chaos/Baukasten sind echte, eigenstaendige Seiten mit eigener URL
  // (/match/, /chaos/, /baukasten/ - siehe SPECIAL_PAGES in build_site.py),
  // genau wie /cart/ - kein reiner Client-Zustand auf derselben Adresse
  // mehr. Direktaufruf, Teilen, Lesezeichen und Browser-Zurueck/Vorwaerts
  // funktionieren dadurch wie bei jeder normalen Seite. Der Wechsel
  // zwischen ihnen bleibt trotzdem schnell (kein Neuladen): ein Klick
  // navigiert per pushState, genau wie beim Warenkorb.
  var CLASSIC_PATH = langHome(LANG);
  var SWIPE_PATH = langHome(LANG) + "match/";
  var CHAOS_PATH = langHome(LANG) + "chaos/";
  var OUTFIT_PATH = langHome(LANG) + "baukasten/";
  var MIETEN_PATH = langHome(LANG) + "mieten/";
  function isCatalogPath(path) {
    return path === CLASSIC_PATH || path === SWIPE_PATH || path === CHAOS_PATH || path === OUTFIT_PATH || path === MIETEN_PATH;
  }
  function modeFromPath(path) {
    if (path === SWIPE_PATH) return "swipe";
    if (path === CHAOS_PATH) return "chaos";
    if (path === OUTFIT_PATH) return "outfit";
    if (path === MIETEN_PATH) return "mieten";
    return "classic";
  }
  function pathForMode(mode) {
    if (mode === "swipe") return SWIPE_PATH;
    if (mode === "chaos") return CHAOS_PATH;
    if (mode === "outfit") return OUTFIT_PATH;
    if (mode === "mieten") return MIETEN_PATH;
    return CLASSIC_PATH;
  }
  // true nur auf der eigenen Mieten/Ausleihen-Kategorieseite - steuert, ob
  // die Katalogkacheln den "Anfragen"-Button zeigen. Vorher stand dieser
  // Button auf JEDER Kachel im normalen Archiv, was dort nur unnoetig
  // ablenkte; jetzt gehoert er ausschliesslich zur eigenen Mieten-Kategorie.
  var RENTAL_CATALOG_MODE = false;
  // Sonderseiten wie /impressum/ oder /cart/ nutzen dieselbe Vorlage
  // (index_template.html), sind aber KEINE Katalog-Ansicht - der Katalog
  // darf dort nicht automatisch mitgeladen/angezeigt werden (frueher lief
  // er dort unsichtbar unterhalb des eigentlichen Inhalts mit, siehe
  // Kommentar beim Skript-Einstiegspunkt weiter unten). Dort bleibt nur die
  // persistente Kopfzeile sichtbar; ein Klick auf Match/Chaos/Baukasten/
  // Marke navigiert per echtem pushState zur jeweiligen Katalog-Seite.
  var IS_CATALOG_PAGE = isCatalogPath(location.pathname);
  var suppressModePush = false;
  var MODE_TITLE_KEY = { classic: "pageTitleHome", swipe: "pageTitleMatch", chaos: "pageTitleChaos", outfit: "pageTitleOutfit", mieten: "pageTitleMieten" };
  function updateModeDocumentMeta(mode) {
    // pushState allein aendert weder <title> noch <link rel="canonical">
    // (der Browser macht das nur bei einem echten Seitenaufruf) - ohne das
    // haette der Tab/Verlaufseintrag nach einem In-Page-Wechsel weiterhin
    // den Titel der vorher besuchten Seite.
    document.title = t(MODE_TITLE_KEY[mode]);
    var canonicalEl = document.querySelector('link[rel="canonical"]');
    if (canonicalEl) canonicalEl.href = location.origin + pathForMode(mode);
  }
  function pushModePath(path) {
    updateModeDocumentMeta(modeFromPath(path));
    if (suppressModePush) return;
    if (location.pathname !== path) history.pushState({}, "", path);
  }
  window.addEventListener("popstate", function () {
    if (!isCatalogPath(location.pathname)) return;
    var mode = modeFromPath(location.pathname);
    suppressModePush = true;
    if (mode === "swipe") showSwipe();
    else if (mode === "chaos") showChaos();
    else if (mode === "outfit") showOutfit();
    else if (mode === "mieten") showMieten();
    else showClassic();
    suppressModePush = false;
  });

  // Leiste blendet sich beim Runterscrollen im Archiv aus (bleibt sonst
  // dauerhaft ueber dem Katalog haengen) und taucht beim Hochscrollen oder
  // ganz oben sofort wieder auf. In Match/Chaos/Baukasten (kein Scrollen,
  // volle Vollbild-Ansicht) bleibt sie immer sichtbar.
  var RAIL_HIDE_AT = 24;
  var railLastScrollY = window.pageYOffset || 0;
  function updateRailScrollVisibility() {
    var y = window.pageYOffset || document.documentElement.scrollTop || 0;
    if (y <= RAIL_HIDE_AT || y < railLastScrollY) {
      modeRail.classList.remove("rail-hidden");
    } else if (y > railLastScrollY) {
      modeRail.classList.add("rail-hidden");
    }
    railLastScrollY = y;
  }
  window.addEventListener("scroll", function () {
    if (!appShell.classList.contains("hidden")) updateRailScrollVisibility();
  }, { passive: true });

  function syncModeRail(activeKey) {
    modeRail.classList.remove("hidden");
    if (activeKey === "classic") updateRailScrollVisibility();
    else modeRail.classList.remove("rail-hidden");
    Array.prototype.forEach.call(modeRail.querySelectorAll(".mode-rail__btn"), function (btn) {
      var isActive = btn.getAttribute("data-mode-view") === activeKey;
      if (isActive) btn.setAttribute("aria-current", "true");
      else btn.removeAttribute("aria-current");
    });
  }

  // Match/Chaos/Baukasten sind jetzt echte <a href> (siehe index_template.
  // html) - echte Ziel-URL fuer Rechtsklick/neuer Tab/Hover, per Klick aber
  // schnelle pushState-Navigation ohne Neuladen (gleiches Muster wie beim
  // Warenkorb-Icon). Href pro Sprache korrigieren, da die Vorlage nur die
  // deutschen Pfade fest verlinkt.
  document.querySelector('.mode-rail__btn[data-mode-view="swipe"]').href = SWIPE_PATH;
  document.querySelector('.mode-rail__btn[data-mode-view="chaos"]').href = CHAOS_PATH;
  document.querySelector('.mode-rail__btn[data-mode-view="outfit"]').href = OUTFIT_PATH;
  Array.prototype.forEach.call(modeRail.querySelectorAll(".mode-rail__btn"), function (btn) {
    btn.addEventListener("click", function (e) {
      e.preventDefault();
      var target = btn.getAttribute("data-mode-view");
      if (target === "classic") showClassic();
      else if (target === "swipe") showSwipe();
      else if (target === "chaos") showChaos();
      else if (target === "outfit") showOutfit();
      dismissModeRailHint();
    });
  });

  // ---- Minimalistisches Hauptmenue ----
  var menuBackdrop = document.getElementById("menuBackdrop");
  var menuToggle = document.getElementById("menuToggle");
  var menuBrandsToggle = document.getElementById("menuBrandsToggle");
  var menuBrandList = document.getElementById("menuBrandList");

  brandList.forEach(function (brand) {
    var btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = brand;
    btn.addEventListener("click", function () {
      closeMenu();
      filterByBrand(brand);
      focusCatalog();
    });
    menuBrandList.appendChild(btn);
  });

  function resetCatalogFilters() {
    state.department = ""; state.productType = ""; state.brand = ""; state.size = ""; state.color = ""; state.condition = "";
    state.priceMin = null; state.priceMax = null;
    filterDepartmentEl.value = ""; filterProductTypeEl.value = ""; filterBrandEl.value = ""; filterSizeEl.value = ""; filterColorEl.value = ""; filterConditionEl.value = "";
    filterPriceMinEl.value = ""; filterPriceMaxEl.value = "";
  }

  function syncCatalogChips() {
    Array.prototype.forEach.call(statusChipsEl.children, function (chip) {
      var key = chip.getAttribute("data-i18n");
      var active = (state.status === "all" && key === "statusAll") ||
        (state.status === "Verfügbar" && key === "statusAvailable") ||
        (state.status === "Verkauft" && key === "statusSold");
      chip.setAttribute("aria-pressed", active ? "true" : "false");
    });
    Array.prototype.forEach.call(categoryChipsEl.children, function (chip) {
      chip.setAttribute("aria-pressed", chip === allCatBtn ? "true" : "false");
    });
  }

  function focusCatalog() {
    var catalog = document.querySelector(".catalog-heading");
    if (!catalog) return;
    requestAnimationFrame(function () {
      catalog.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  function applyMenuView(status, categories, labelKey) {
    state.query = "";
    searchInputEl.value = "";
    state.status = status;
    state.category = "all";
    state.categoryGroup = categories || null;
    state.catalogLabelKey = labelKey || "statusAvailable";
    state.catalogLabelCategory = "";
    state.catalogLabelText = "";
    resetCatalogFilters();
    syncCatalogChips();
    closeMenu();
    showClassic();
    render();
    focusCatalog();
  }

  var menuLastFocusEl = null;
  function openMenu() {
    menuLastFocusEl = document.activeElement;
    menuBackdrop.classList.add("open");
    menuToggle.setAttribute("aria-expanded", "true");
    document.body.style.overflow = "hidden";
    document.getElementById("menuClose").focus();
  }

  function closeMenu() {
    menuBackdrop.classList.remove("open");
    menuToggle.setAttribute("aria-expanded", "false");
    document.body.style.overflow = "";
    if (menuLastFocusEl && typeof menuLastFocusEl.focus === "function") menuLastFocusEl.focus();
  }
  bindFocusTrap(document.getElementById("menuDrawer"), function () { return menuBackdrop.classList.contains("open"); }, closeMenu);

  menuToggle.addEventListener("click", openMenu);
  document.getElementById("menuClose").addEventListener("click", closeMenu);
  menuBackdrop.addEventListener("click", function (e) {
    if (e.target === menuBackdrop) closeMenu();
  });

  menuBrandsToggle.addEventListener("click", function () {
    var willOpen = menuBrandList.classList.contains("hidden");
    menuBrandList.classList.toggle("hidden", !willOpen);
    menuBrandsToggle.setAttribute("aria-expanded", willOpen ? "true" : "false");
  });

  Array.prototype.forEach.call(document.querySelectorAll("[data-menu-status]"), function (btn) {
    btn.addEventListener("click", function () {
      applyMenuView(btn.getAttribute("data-menu-status"), null, btn.getAttribute("data-i18n"));
    });
  });

  Array.prototype.forEach.call(document.querySelectorAll("[data-menu-categories]"), function (btn) {
    btn.addEventListener("click", function () {
      applyMenuView("Verfügbar", btn.getAttribute("data-menu-categories").split(","), btn.getAttribute("data-i18n"));
    });
  });

  document.getElementById("footerArchive").addEventListener("click", function () {
    applyMenuView("Verkauft", null, "menuArchive");
  });

  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    if (menuBackdrop.classList.contains("open")) closeMenu();
  });

  // ---- Einmaliger Hinweis auf die Fun-Modi (nur beim allerersten Besuch) ----
  var modeRailHint = document.getElementById("modeRailHint");
  var MODE_HINT_KEY = "disorder119_mode_hint_seen";
  var modeHintTimer = null;

  function positionModeRailHint() {
    // Leiste ist jetzt eine fest fixierte Zeile ganz oben - Hinweis erscheint
    // darunter, zentriert unter dem Match-Button.
    var firstBtn = modeRail.querySelector(".mode-rail__btn[data-mode-view='swipe']") || modeRail;
    var railRect = firstBtn.getBoundingClientRect();
    var hintRect = modeRailHint.getBoundingClientRect();
    var left = railRect.left + railRect.width / 2 - hintRect.width / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - hintRect.width - 8));
    modeRailHint.style.left = left + "px";
    modeRailHint.style.top = (railRect.bottom + 10) + "px";
  }

  function dismissModeRailHint() {
    if (modeHintTimer) { clearTimeout(modeHintTimer); modeHintTimer = null; }
    modeRailHint.classList.remove("visible");
    window.removeEventListener("resize", positionModeRailHint);
    try { window.localStorage.setItem(MODE_HINT_KEY, "1"); } catch (e) {}
    setTimeout(function () { modeRailHint.classList.add("hidden"); }, 400);
  }

  function showModeRailHint() {
    var alreadySeen = false;
    try { alreadySeen = !!window.localStorage.getItem(MODE_HINT_KEY); } catch (e) {}
    if (alreadySeen) return;
    modeRailHint.classList.remove("hidden");
    positionModeRailHint();
    window.addEventListener("resize", positionModeRailHint);
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { modeRailHint.classList.add("visible"); });
    });
    modeHintTimer = setTimeout(dismissModeRailHint, 7000);
  }

  document.getElementById("modeRailHintClose").addEventListener("click", dismissModeRailHint);

  function showClassic() {
    swipeView.classList.add("hidden");
    chaosView.classList.add("hidden");
    outfitView.classList.add("hidden");
    outfitPicker.classList.remove("open");
    appShell.classList.remove("hidden");
    syncModeRail("classic");
    if (RENTAL_CATALOG_MODE) {
      // Zurueck vom Mieten-Katalog ins normale Archiv - Anfragen-Button
      // gehoert nur zur eigenen Mieten-Kategorie, hier wieder ausblenden.
      RENTAL_CATALOG_MODE = false;
      state.catalogLabelText = "";
      render();
    }
    pushModePath(CLASSIC_PATH);
  }

  // ---- Mieten & Ausleihen (eigene Katalog-Kategorie, siehe RENTAL_CATALOG_MODE) ----
  function showMieten() {
    swipeView.classList.add("hidden");
    chaosView.classList.add("hidden");
    outfitView.classList.add("hidden");
    outfitPicker.classList.remove("open");
    appShell.classList.remove("hidden");
    syncModeRail("classic");
    RENTAL_CATALOG_MODE = true;
    state.catalogLabelText = t("mietenCatalogHeading");
    render();
    pushModePath(MIETEN_PATH);
  }

  // ---- Swipe-Minigame ----
  var swipeQueue = [];
  var swipeIndex = 0;
  var swipeLiked = [];

  function buildSwipeQueue() {
    var pool = ITEMS.filter(function (it) {
      return it.status !== "Verkauft" && it.price > 0 && it.gallery && it.gallery[0];
    });
    for (var i = pool.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = pool[i]; pool[i] = pool[j]; pool[j] = tmp;
    }
    swipeQueue = pool.slice(0, Math.min(25, pool.length));
    swipeIndex = 0;
    swipeLiked = [];
  }

  function wireSwipeCard(card, it, setPhoto, getPhotoIdx, photoCount) {
    var startX = 0, dx = 0, dragging = false;
    var likeTag = card.querySelector('[data-tag="like"]');
    var nopeTag = card.querySelector('[data-tag="nope"]');

    card.addEventListener("pointerdown", function (e) {
      dragging = true;
      startX = e.clientX;
      dx = 0;
      card.classList.add("dragging");
      try { card.setPointerCapture(e.pointerId); } catch (err) {}
    });
    card.addEventListener("pointermove", function (e) {
      if (!dragging) return;
      dx = e.clientX - startX;
      card.style.transform = "translateX(" + dx + "px) rotate(" + (dx / 18) + "deg)";
      var progress = Math.min(Math.abs(dx) / 90, 1);
      likeTag.style.opacity = dx > 0 ? progress : 0;
      nopeTag.style.opacity = dx < 0 ? progress : 0;
    });
    function release(e) {
      if (!dragging) return;
      dragging = false;
      card.classList.remove("dragging");
      if (Math.abs(dx) > 90) {
        decideSwipe(dx > 0 ? "like" : "nope", card, it);
        return;
      }
      card.style.transform = "";
      likeTag.style.opacity = 0;
      nopeTag.style.opacity = 0;
      // Kaum Bewegung = Tap statt Wisch-Entscheidung -> auf linker/rechter
      // Bildhaelfte durch die Fotos des Artikels blättern.
      if (Math.abs(dx) < 6 && photoCount > 1 && typeof e.clientX === "number") {
        var rect = card.getBoundingClientRect();
        var relX = (e.clientX - rect.left) / rect.width;
        var idx = getPhotoIdx();
        setPhoto(relX < 0.5 ? idx - 1 : idx + 1);
      }
    }
    card.addEventListener("pointerup", release);
    card.addEventListener("pointercancel", function () {
      dragging = false;
      card.classList.remove("dragging");
      card.style.transform = "";
      likeTag.style.opacity = 0;
      nopeTag.style.opacity = 0;
    });
  }

  function decideSwipe(direction, card, it) {
    card.classList.add(direction === "like" ? "fly-right" : "fly-left");
    if (direction === "like") {
      if (!isInCart(it.id)) {
        cart.push(it.id);
        saveCart();
        updateCartCount();
      }
      swipeLiked.push(it.id);
    }
    swipeIndex++;
    setTimeout(renderSwipeCard, 300);
  }

  function showSwipeSummary() {
    document.getElementById("swipeProgress").textContent = "";
    document.getElementById("swipeActions").style.display = "none";
    var stage = document.getElementById("swipeStage");
    stage.innerHTML =
      '<div class="swipe-summary">' +
        '<p class="swipe-view__hint">' + t("swipeRoundDone") + '</p>' +
        '<div class="swipe-summary__count">' + swipeLiked.length + " / " + swipeQueue.length + "</div>" +
        '<p class="swipe-view__hint">' + t("swipeSavedInCart") + '</p>' +
        '<div class="swipe-summary__actions">' +
          '<button type="button" class="view-enter-btn" id="swipeOpenCart">' + t("swipeViewCart") + '</button>' +
          '<button type="button" class="view-enter-btn" id="swipeAgain">' + t("swipePlayAgain") + '</button>' +
        "</div>" +
      "</div>";
    document.getElementById("swipeOpenCart").addEventListener("click", function () {
      showClassic();
      openCart();
    });
    document.getElementById("swipeAgain").addEventListener("click", function () {
      buildSwipeQueue();
      renderSwipeCard();
    });
  }

  function renderSwipeCard() {
    var stage = document.getElementById("swipeStage");
    stage.innerHTML = "";
    if (swipeIndex >= swipeQueue.length) {
      showSwipeSummary();
      return;
    }
    document.getElementById("swipeActions").style.display = "";
    document.getElementById("swipeProgress").textContent = (swipeIndex + 1) + " / " + swipeQueue.length;
    var it = swipeQueue[swipeIndex];
    var photos = (it.gallery && it.gallery.length ? it.gallery : [""]).map(assetUrl);

    var card = document.createElement("div");
    card.className = "swipe-card";

    var dotsHtml = photos.length > 1
      ? '<div class="swipe-card__dots">' + photos.map(function (_, i) {
          return '<span class="swipe-card__dot' + (i === 0 ? " swipe-card__dot--active" : "") + '"></span>';
        }).join("") + "</div>"
      : "";

    card.innerHTML =
      '<div class="swipe-card__frame">' +
        '<img src="' + photos[0] + '" alt="' + escapeHtml(productAltText(it)) + '" />' +
        '<div class="swipe-card__zones"><span class="swipe-card__zone"></span><span class="swipe-card__zone"></span></div>' +
        dotsHtml +
        '<span class="swipe-card__tag swipe-card__tag--like" data-tag="like">' + t("swipeLikeAria") + '</span>' +
        '<span class="swipe-card__tag swipe-card__tag--nope" data-tag="nope">' + t("swipeNopeTag") + '</span>' +
      "</div>" +
      '<div class="swipe-card__body">' +
        '<div class="swipe-card__brand">' + escapeHtml(it.brand || t("noBrand")) + "</div>" +
        '<div class="swipe-card__title">' + escapeHtml(it.title) + "</div>" +
        '<div class="swipe-card__row">' +
          '<span class="swipe-card__price">' + fmtPrice(it.price) + "</span>" +
          '<span class="swipe-card__size">' + escapeHtml(trSize(it.size) || "") + "</span>" +
        "</div>" +
      "</div>";
    stage.appendChild(card);

    var photoIdx = 0;
    var imgEl = card.querySelector(".swipe-card__frame img");
    var dotEls = card.querySelectorAll(".swipe-card__dot");
    function setPhoto(i) {
      photoIdx = Math.max(0, Math.min(i, photos.length - 1));
      imgEl.src = photos[photoIdx];
      Array.prototype.forEach.call(dotEls, function (d, i2) {
        d.classList.toggle("swipe-card__dot--active", i2 === photoIdx);
      });
    }

    wireSwipeCard(card, it, setPhoto, function () { return photoIdx; }, photos.length);
  }

  document.getElementById("swipeNope").addEventListener("click", function () {
    var card = document.querySelector(".swipe-card");
    if (card && swipeQueue[swipeIndex]) decideSwipe("nope", card, swipeQueue[swipeIndex]);
  });
  document.getElementById("swipeLike").addEventListener("click", function () {
    var card = document.querySelector(".swipe-card");
    if (card && swipeQueue[swipeIndex]) decideSwipe("like", card, swipeQueue[swipeIndex]);
  });
  document.addEventListener("keydown", function (e) {
    if (swipeView.classList.contains("hidden")) return;
    var card = document.querySelector(".swipe-card");
    if (!card || !swipeQueue[swipeIndex]) return;
    if (e.key === "ArrowLeft") decideSwipe("nope", card, swipeQueue[swipeIndex]);
    else if (e.key === "ArrowRight") decideSwipe("like", card, swipeQueue[swipeIndex]);
  });

  function showSwipe() {
    appShell.classList.add("hidden");
    chaosView.classList.add("hidden");
    outfitView.classList.add("hidden");
    outfitPicker.classList.remove("open");
    buildSwipeQueue();
    renderSwipeCard();
    swipeView.classList.remove("hidden");
    syncModeRail("swipe");
    pushModePath(SWIPE_PATH);
  }

  function chaosItemCount() {
    var w = window.innerWidth;
    // Auf schmalen Handys weniger Artikel als vorher (14 -> 9) - sonst
    // ueberlappten sich die kleinen, treibenden Karten zu stark und liessen
    // sich kaum noch einzeln antippen.
    if (w < 420) return 9;
    if (w < 640) return 12;
    if (w < 1100) return 26;
    if (w < 1600) return 38;
    return 48;
  }

  // Ab dieser Breite gibt's den automatisch schwenkenden 360-Grad-Showroom
  // statt dem einfachen Treiben-lassen - am Handy waer's per Touch eh nicht
  // steuerbar, deshalb bewusst nur am Desktop.
  function chaosIsShowroom() {
    return window.innerWidth >= 900;
  }

  function chaosShowroomItemCount() {
    // Bewusst begrenzt: bei zu vielen Artikeln rings um den Raum ueberlappen
    // sie sich (Perspektive vergroessert Artikel vorne im Blickfeld) so
    // stark, dass viele nicht mehr anklickbar waeren.
    var w = window.innerWidth;
    if (w < 1300) return 18;
    if (w < 1800) return 22;
    return 26;
  }

  // ---- Chaos-Showroom: echter 3D-Panoramaraum. Die Artikel stehen rund um
  // ein Zentrum verteilt (rotateY + translateZ je Artikel), und der ganze
  // Raum dreht sich um die eigene Achse, je nachdem wo die Maus steht - wie
  // wenn man in der Mitte eines Rundraums den Kopf dreht, statt dass sich
  // die Artikel selbst bewegen. Naehert man sich beim Umschauen einem Rand
  // des Blickbereichs (= man hat den Raum einmal "abgelaufen"), wird der
  // Raum mit neuen Artikeln aufgefrischt, ohne die Blickrichtung zu
  // resetten - so wird ueber laengeres Umschauen irgendwann der ganze
  // Katalog gezeigt, nie dieselben Teile in Dauerschleife. ----
  var chaosPan = { active: false, target: 0, current: 0, raf: null, maxYaw: 0, lapArmed: true };
  var chaosShownIds = null;

  function chaosPanPointerMove(e) {
    var nx = (e.clientX / window.innerWidth) * 2 - 1; // -1 (links) .. 1 (rechts)
    chaosPan.target = -nx * chaosPan.maxYaw;
  }

  function chaosPanFrame() {
    var chaosViewEl = document.getElementById("chaosView");
    if (!chaosPan.active || !chaosViewEl || chaosViewEl.classList.contains("hidden")) {
      chaosPan.active = false;
      document.removeEventListener("mousemove", chaosPanPointerMove);
      return;
    }
    chaosPan.current += (chaosPan.target - chaosPan.current) * 0.025;
    var host = document.getElementById("chaosItems");
    if (host) host.style.transform = "rotateY(" + chaosPan.current.toFixed(2) + "deg)";

    var edgeFrac = Math.abs(chaosPan.current) / chaosPan.maxYaw;
    if (edgeFrac > 0.9 && chaosPan.lapArmed) {
      chaosPan.lapArmed = false;
      populateChaosItems(true);
    } else if (edgeFrac < 0.3) {
      chaosPan.lapArmed = true;
    }

    chaosPan.raf = requestAnimationFrame(chaosPanFrame);
  }

  function stopChaosPan() {
    chaosPan.active = false;
    if (chaosPan.raf) cancelAnimationFrame(chaosPan.raf);
    document.removeEventListener("mousemove", chaosPanPointerMove);
    var host = document.getElementById("chaosItems");
    if (host) host.style.transform = "";
  }

  function startChaosPan() {
    stopChaosPan();
    chaosPan.active = true;
    chaosPan.maxYaw = 185; // Grad - deckt den vollen Rundumblick (360 Grad) ueber die Mausbreite ab
    chaosPan.target = 0;
    chaosPan.current = 0;
    chaosPan.lapArmed = true;
    document.addEventListener("mousemove", chaosPanPointerMove);
    chaosPanFrame();
  }

  // Waehlt eine frische Auswahl Artikel - bevorzugt solche, die in dieser
  // Chaos-Sitzung noch nicht gezeigt wurden. Erst wenn der ganze Katalog
  // durch ist, faengt die "gezeigt"-Liste wieder von vorne an.
  function chaosPickRoomItems(count) {
    var pool = ITEMS.filter(function (it) {
      return it.status !== "Verkauft" && it.gallery && it.gallery[0];
    });
    if (!chaosShownIds) chaosShownIds = new Set();
    var unseen = pool.filter(function (it) { return !chaosShownIds.has(it.id); });
    var source = unseen.length >= count ? unseen : pool;
    if (source === pool) chaosShownIds = new Set();
    for (var i = source.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = source[i]; source[i] = source[j]; source[j] = tmp;
    }
    var picks = source.slice(0, Math.min(count, source.length));
    picks.forEach(function (it) { chaosShownIds.add(it.id); });
    return picks;
  }

  function populateChaosItems(showroom) {
    var host = document.getElementById("chaosItems");
    var count = showroom ? chaosShowroomItemCount() : chaosItemCount();
    var picks = chaosPickRoomItems(count);
    var slotWidth = 360 / picks.length;
    // Raster mit Streuung statt reinem Zufall fuer die flache (Nicht-Showroom)
    // Anordnung - dasselbe Prinzip wie beim 3D-Showroom weiter unten (dort
    // schon "Slot + Jitter" statt Vollzufall), nur in 2D. Vollzufall liess
    // Artikel auf kleinen Bildschirmen zu oft stark ueberlappend haufen.
    var cols = Math.max(1, Math.round(Math.sqrt(picks.length * 1.6)));
    var rows = Math.ceil(picks.length / cols);
    var cellW = 92 / cols;
    var cellH = 88 / rows;
    // Auf schmalen Handys ist ein Zell-Raster viel kleiner als am Desktop -
    // der bisherige feste Drift von +-65px war dort ein grosser Teil der
    // Zellbreite und liess Artikel waehrend des Schwebens ineinanderlaufen.
    // Drift + Jitter deshalb an die tatsaechliche Bildschirmbreite koppeln.
    var narrow = window.innerWidth < 640;
    var driftPx = narrow ? 26 : 65;
    var jitterFactor = narrow ? 0.42 : 0.65;
    // Unterer Rand bleibt frei fuer "Neu mischen"/"Zum Archiv" - vorher
    // konnten Artikel bis auf 92% Hoehe spawnen und damit fast auf die
    // Buttons rutschen.
    var maxTop = narrow ? 78 : 92;
    var frag = document.createDocumentFragment();
    picks.forEach(function (it, idx) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "chaos-item";
      btn.style.animationDuration = (6 + Math.random() * 7) + "s";
      btn.style.animationDelay = (Math.random() * -13) + "s";
      btn.style.setProperty("--dx", (Math.random() * driftPx * 2 - driftPx).toFixed(0) + "px");
      btn.style.setProperty("--dy", (Math.random() * driftPx * 2 - driftPx).toFixed(0) + "px");
      btn.style.setProperty("--rot0", (Math.random() * 18 - 9).toFixed(1) + "deg");
      btn.style.setProperty("--rot1", (Math.random() * 18 - 9).toFixed(1) + "deg");
      btn.setAttribute("aria-label", it.title);
      btn.innerHTML = '<img src="' + assetUrl(it.gallery[0]) + '" alt="" loading="lazy" />';
      btn.addEventListener("click", function () {
        // Frueher stand hier zusaetzlich showClassic() vor openModal() - das
        // war harmlos, solange Moduswechsel nur lokale Zustaende umschalteten.
        // Jetzt navigiert showClassic() aber wirklich zu / (siehe pushModePath
        // oben) - ein Klick auf ein Chaos-Objekt haette also unbemerkt die
        // URL auf die Startseite umgeschrieben und man waere nach dem
        // Schliessen des Quickviews ueberraschend im Archiv statt wieder in
        // Chaos gelandet. Die Schnellansicht liegt als eigenes Overlay
        // ausserhalb von #appShell (siehe index_template.html) und
        // funktioniert daher unabhaengig davon, ob Chaos oder Archiv aktiv
        // ist - keine Navigation noetig, um sie zu zeigen.
        openModal(it);
      });
      btn.addEventListener("mouseenter", function () { showChaosTooltip(it); });
      btn.addEventListener("mousemove", function (ev) { positionChaosTooltip(ev.clientX, ev.clientY); });
      btn.addEventListener("mouseleave", hideChaosTooltip);

      if (showroom) {
        // Echter 3D-Rundraum: jeder Artikel steht an einem Winkel rings um
        // die Mitte (volle 360 Grad), auf "Armlaenge" nach aussen versetzt
        // und zur Mitte hin gedreht - wie Bilder an einer runden Wand, die
        // man von innen betrachtet. rotateY(theta) translateZ(radius)
        // platziert den Artikel am Kreis; das abschliessende rotateY(180deg)
        // dreht ihn so, dass er zur Mitte (zur Kamera) zeigt statt nach
        // aussen. translateY vorneweg (im Weltkoordinatensystem, vor der
        // Drehung) gibt Hoehen-Streuung ohne die Kreisposition zu verzerren.
        // Theta NICHT rein zufaellig ueber 360 Grad verteilen - das haeuft
        // per Zufall zu viele Artikel im selben Sichtbereich (starke
        // Ueberlappung, kaum noch anklickbar). Stattdessen ein eigener
        // "Slot" pro Artikel mit Streuung nur innerhalb des Slots.
        var theta = idx * slotWidth + (Math.random() - 0.5) * slotWidth * 0.8;
        var radius = 780 + Math.random() * 220;
        var yOffset = Math.random() * 480 - 240;
        var itemScale = 0.85 + Math.random() * 0.3;
        var wrap = document.createElement("div");
        wrap.className = "chaos-item-wrap";
        wrap.style.transform =
          "translateY(" + yOffset.toFixed(0) + "px) rotateY(" + theta.toFixed(1) + "deg) " +
          "translateZ(" + radius.toFixed(0) + "px) rotateY(180deg) scale(" + itemScale.toFixed(3) + ")";
        wrap.appendChild(btn);
        frag.appendChild(wrap);
      } else {
        var col = idx % cols;
        var row = Math.floor(idx / cols);
        var jitterX = (Math.random() - 0.5) * cellW * jitterFactor;
        var jitterY = (Math.random() - 0.5) * cellH * jitterFactor;
        var left = 2 + col * cellW + cellW / 2 + jitterX;
        var top = 4 + row * cellH + cellH / 2 + jitterY;
        btn.style.left = Math.min(94, Math.max(2, left)) + "%";
        btn.style.top = Math.min(maxTop, Math.max(4, top)) + "%";
        frag.appendChild(btn);
      }
    });
    host.innerHTML = "";
    host.appendChild(frag);
  }

  var chaosTooltip = document.getElementById("chaosTooltip");
  function showChaosTooltip(it) {
    chaosTooltip.innerHTML =
      '<span class="chaos-tooltip__brand">' + escapeHtml(it.brand || "") + '</span>' +
      escapeHtml(it.title) + '<br><span class="chaos-tooltip__price">' + fmtPriceDisplay(it.price) + '</span>';
    chaosTooltip.classList.add("visible");
  }
  function positionChaosTooltip(x, y) {
    chaosTooltip.style.left = x + "px";
    chaosTooltip.style.top = (y - 14) + "px";
  }
  function hideChaosTooltip() {
    chaosTooltip.classList.remove("visible");
  }

  // ---- Chaos: sanfte Neige-Parallaxe fuers Handy (Gyroskop) ----
  // Laeuft nur in der flachen (Nicht-Showroom) Ansicht, als mobile Entsprechung
  // zum Maus-Schwenk des Desktop-Showrooms - dasselbe manuelle Lerp-Muster wie
  // chaosPanFrame(), damit sich beide Effekte technisch nicht in die Quere
  // kommen (unabhaengige rAF-Schleifen auf demselben Element, aber nie
  // gleichzeitig aktiv, da showroom/flach sich gegenseitig ausschliessen).
  // Fruehere Version bewegte die Buehne NUR per Handy-Neigung - auf iOS haengt
  // das an einer Permission, die beim Moduswechsel nicht zuverlaessig aus der
  // Nutzer-Geste heraus ausgeloest wurde (blieb oft stumm haengen), und selbst
  // mit erteilter Freigabe passiert nichts, wenn man das Handy einfach nur
  // ruhig haelt (der Normalfall). Jetzt laeuft immer eine sanfte, automatische
  // Kreisbewegung der ganzen Buehne (kein Sensor, keine Permission noetig) -
  // Neigung (falls erlaubt) legt sich nur noch zusaetzlich obendrauf.
  var chaosMotion = { active: false, angle: 0, tiltTargetX: 0, tiltTargetY: 0, tiltX: 0, tiltY: 0, raf: null };

  function chaosTiltHandler(e) {
    var gamma = Math.max(-30, Math.min(30, e.gamma || 0)); // links/rechts
    var beta = Math.max(-30, Math.min(30, (e.beta || 45) - 45)); // vor/zurueck, 45deg = normale Haltung
    chaosMotion.tiltTargetX = (gamma / 30) * 10;
    chaosMotion.tiltTargetY = (beta / 30) * 7;
  }

  function chaosMotionFrame() {
    var chaosViewEl = document.getElementById("chaosView");
    var host = document.getElementById("chaosItems");
    if (!chaosMotion.active || !host || !chaosViewEl || chaosViewEl.classList.contains("hidden")) {
      chaosMotion.active = false;
      window.removeEventListener("deviceorientation", chaosTiltHandler);
      return;
    }
    // Langsame elliptische Bahn (~25s pro Umlauf) - dezent genug, um nicht vom
    // Stoebern abzulenken, aber deutlich sichtbar ohne dass am Geraet gewackelt
    // werden muss. Tippen auf ein Teil bleibt unveraendert moeglich (reine
    // transform-Verschiebung der ganzen Buehne, keine Aenderung an den
    // einzelnen Klick-/Touch-Zielen).
    chaosMotion.angle += 0.0022;
    var driftX = Math.cos(chaosMotion.angle) * 13;
    var driftY = Math.sin(chaosMotion.angle) * 8;
    chaosMotion.tiltX += (chaosMotion.tiltTargetX - chaosMotion.tiltX) * 0.06;
    chaosMotion.tiltY += (chaosMotion.tiltTargetY - chaosMotion.tiltY) * 0.06;
    var x = driftX + chaosMotion.tiltX;
    var y = driftY + chaosMotion.tiltY;
    host.style.transform = "translate(" + x.toFixed(1) + "px, " + y.toFixed(1) + "px)";
    chaosMotion.raf = requestAnimationFrame(chaosMotionFrame);
  }

  function stopChaosTilt() {
    chaosMotion.active = false;
    if (chaosMotion.raf) cancelAnimationFrame(chaosMotion.raf);
    window.removeEventListener("deviceorientation", chaosTiltHandler);
    var host = document.getElementById("chaosItems");
    if (host) host.style.transform = "";
  }

  function startChaosTilt() {
    stopChaosTilt();
    // Respektiert "Bewegung reduzieren" - wie ueberall sonst auf der Seite.
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    chaosMotion.active = true;
    chaosMotion.angle = Math.random() * Math.PI * 2; // nicht jedes Mal am selben Punkt starten
    chaosMotion.tiltTargetX = chaosMotion.tiltX = 0;
    chaosMotion.tiltTargetY = chaosMotion.tiltY = 0;
    chaosMotionFrame();
    if (typeof window.DeviceOrientationEvent === "undefined") return;
    function beginTilt() { window.addEventListener("deviceorientation", chaosTiltHandler); }
    if (typeof DeviceOrientationEvent.requestPermission === "function") {
      // iOS 13+: Freigabe muss aus einer Nutzer-Geste heraus angefragt werden.
      // Wird sie verweigert oder schlaegt fehl, laeuft die automatische
      // Kreisbewegung trotzdem normal weiter - kein Fehlerzustand.
      try {
        DeviceOrientationEvent.requestPermission().then(function (state) {
          if (state === "granted") beginTilt();
        }).catch(function () {});
      } catch (e) {}
    } else {
      beginTilt();
    }
  }

  function buildChaos() {
    var chaosViewEl = document.getElementById("chaosView");
    var host = document.getElementById("chaosItems");
    stopChaosPan();
    stopChaosTilt();
    hideChaosTooltip();
    host.style.transform = "";
    var showroom = chaosIsShowroom();
    chaosViewEl.classList.toggle("chaos-view--showroom", showroom);
    chaosShownIds = new Set(); // frischer Start jedes Mal, wenn die Ansicht neu geoeffnet wird
    populateChaosItems(showroom);
    if (showroom) startChaosPan();
    else startChaosTilt();
  }

  document.getElementById("chaosShuffle").addEventListener("click", buildChaos);

  function showChaos() {
    appShell.classList.add("hidden");
    swipeView.classList.add("hidden");
    outfitView.classList.add("hidden");
    outfitPicker.classList.remove("open");
    chaosView.classList.remove("hidden");
    buildChaos();
    syncModeRail("chaos");
    pushModePath(CHAOS_PATH);
  }

  // ---- Outfit-Baukasten ----
  var outfitPicker = document.getElementById("outfitPicker");
  var OUTFIT_KEY = "disorder119_outfit";
  var OUTFIT_ORDER = ["top", "jacket", "bottom", "shoes", "accessory"];
  var outfitSlots = {
    top: { labelKey: "outfitSlotTop", categories: ["Tops", "Shirts", "Knitwear", "Dresses"], item: null },
    jacket: { labelKey: "outfitSlotJacket", categories: ["Jackets", "Coats"], item: null },
    bottom: { labelKey: "outfitSlotBottom", categories: ["Pants", "Skirts"], item: null },
    shoes: { labelKey: "outfitSlotShoes", categories: ["Shoes"], item: null },
    accessory: { labelKey: "outfitSlotAccessory", categories: ["Accessories"], item: null }
  };
  function outfitSlotLabel(key) { return t(outfitSlots[key].labelKey); }
  var outfitPickerKey = null;
  var outfitPickerQuery = "";

  function outfitEligible(categories, query, opts) {
    // public_status statt der alten "status === Verkauft"-Pruefung - sonst
    // koennten hier (anders als im Rest des Shops) auch interne Workflow-
    // Staende oder inzwischen verkaufte Artikel auftauchen.
    opts = opts || {};
    var q = (query || "").trim().toLowerCase();
    return ITEMS.filter(function (it) {
      if (it.public_status !== "AVAILABLE" || !(it.price > 0) || !it.gallery || !it.gallery[0]) return false;
      if (categories.indexOf(it.category) === -1) return false;
      if (opts.size && it.size !== opts.size) return false;
      if (opts.priceMax && it.price > opts.priceMax) return false;
      if (!q) return true;
      var hay = ((it.brand || "") + " " + (it.title || "")).toLowerCase();
      return hay.indexOf(q) !== -1;
    });
  }

  function outfitIsDress() {
    return !!(outfitSlots.top.item && outfitSlots.top.item.category === "Dresses");
  }

  function outfitVisibleKeys() {
    return OUTFIT_ORDER.filter(function (k) { return k !== "bottom" || !outfitIsDress(); });
  }

  function outfitStatusText() {
    var required = outfitVisibleKeys().filter(function (k) { return k !== "jacket" && k !== "accessory"; });
    var filledRequired = required.filter(function (k) { return outfitSlots[k].item; }).length;
    var filledAny = OUTFIT_ORDER.filter(function (k) { return outfitSlots[k].item; }).length;
    if (filledAny === 0) return t("outfitStatusStart");
    if (filledRequired >= required.length) return t("outfitStatusComplete");
    return tFormat("outfitStatusProgress", { filled: filledRequired, required: required.length });
  }

  function outfitTotalPrice() {
    return OUTFIT_ORDER.reduce(function (sum, k) {
      var it = outfitSlots[k].item;
      return sum + (it ? it.price : 0);
    }, 0);
  }

  function saveOutfit() {
    try {
      var ids = {};
      OUTFIT_ORDER.forEach(function (k) {
        if (outfitSlots[k].item) ids[k] = outfitSlots[k].item.id;
      });
      window.localStorage.setItem(OUTFIT_KEY, JSON.stringify(ids));
    } catch (e) {}
  }

  function loadOutfit() {
    try {
      var raw = window.localStorage.getItem(OUTFIT_KEY);
      if (!raw) return;
      var ids = JSON.parse(raw);
      OUTFIT_ORDER.forEach(function (k) {
        if (ids[k] != null) {
          var it = findItem(ids[k]);
          if (it && it.public_status === "AVAILABLE" && it.price > 0) outfitSlots[k].item = it;
        }
      });
    } catch (e) {}
  }

  function setOutfitSlot(key, item) {
    outfitSlots[key].item = item;
    if (key === "top" && item && item.category === "Dresses") {
      outfitSlots.bottom.item = null;
    }
    saveOutfit();
    renderOutfitStack();
  }

  function renderOutfitStack() {
    var stack = document.getElementById("outfitStack");
    stack.innerHTML = "";
    var isDress = outfitIsDress();

    OUTFIT_ORDER.forEach(function (key) {
      var slot = outfitSlots[key];
      var locked = key === "bottom" && isDress;
      var row = document.createElement("div");
      row.className = "outfit-slot" + (slot.item ? "" : " outfit-slot--empty") + (locked ? " outfit-slot--locked" : "");

      if (locked) {
        row.innerHTML =
          '<div class="outfit-slot__frame">👗</div>' +
          '<div class="outfit-slot__body">' +
            '<div class="outfit-slot__label">' + outfitSlotLabel(key) + "</div>" +
            '<div class="outfit-slot__value">' + t("outfitDressCovers") + "</div>" +
          "</div>";
        stack.appendChild(row);
        return;
      }

      var slotAriaLabel;
      if (slot.item) {
        var it = slot.item;
        slotAriaLabel = outfitSlotLabel(key) + ": " + it.title + ", " + fmtPrice(it.price);
        row.innerHTML =
          '<div class="outfit-slot__frame" data-slot="' + key + '"><img src="' + assetUrl(it.gallery[0]) + '" alt="" /></div>' +
          '<div class="outfit-slot__body" data-slot="' + key + '">' +
            '<div class="outfit-slot__label">' + outfitSlotLabel(key) + "</div>" +
            '<div class="outfit-slot__value">' + escapeHtml(it.title) + "</div>" +
            '<div class="outfit-slot__price">' + fmtPrice(it.price) + "</div>" +
          "</div>" +
          '<button type="button" class="outfit-slot__remove" data-remove="' + key + '" aria-label="' + t("cartRemove") + '">✕</button>';
      } else {
        slotAriaLabel = outfitSlotLabel(key) + ": " + t("outfitChoose");
        row.innerHTML =
          '<div class="outfit-slot__frame" data-slot="' + key + '">+</div>' +
          '<div class="outfit-slot__body" data-slot="' + key + '">' +
            '<div class="outfit-slot__label">' + outfitSlotLabel(key) + "</div>" +
            '<div class="outfit-slot__value">' + t("outfitChoose") + "</div>" +
          "</div>";
      }
      // Frame/Body waren bisher reine <div>s ohne jede Tastaturbedienbarkeit -
      // per Tab nicht erreichbar, Enter/Leertaste taten nichts. Die ganze
      // Zeile bekommt jetzt role="button"/tabindex, damit sie EIN
      // Tab-Stopp ist (nicht zwei getrennte fuer Bild und Text), mit
      // Enter/Leertaste bedienbar, ohne die bestehende Klick-Zuordnung auf
      // frame/body fuer Maus/Touch anzufassen. Klicks auf den verschachtelten
      // echten Entfernen-Button duerfen dabei nicht zusaetzlich die Zeile
      // aktivieren (e.target-Pruefung im keydown-Handler unten).
      row.setAttribute("role", "button");
      row.setAttribute("tabindex", "0");
      row.setAttribute("aria-label", slotAriaLabel);
      stack.appendChild(row);
    });

    Array.prototype.forEach.call(stack.querySelectorAll("[data-slot]"), function (el) {
      el.addEventListener("click", function () { openOutfitPicker(el.getAttribute("data-slot")); });
    });
    Array.prototype.forEach.call(stack.querySelectorAll(".outfit-slot[role='button']"), function (el) {
      el.addEventListener("keydown", function (e) {
        if (e.target !== el) return; // Klick/Enter auf dem verschachtelten Entfernen-Button nicht zusaetzlich als Zeilen-Aktivierung werten
        if (e.key !== "Enter" && e.key !== " " && e.key !== "Spacebar") return;
        e.preventDefault();
        var frame = el.querySelector("[data-slot]");
        if (frame) openOutfitPicker(frame.getAttribute("data-slot"));
      });
    });
    Array.prototype.forEach.call(stack.querySelectorAll("[data-remove]"), function (el) {
      el.addEventListener("click", function (e) {
        e.stopPropagation();
        setOutfitSlot(el.getAttribute("data-remove"), null);
      });
    });

    document.getElementById("outfitTotal").textContent = fmtPrice(outfitTotalPrice());
    document.getElementById("outfitStatus").textContent = outfitStatusText();
    var anyFilled = OUTFIT_ORDER.some(function (k) { return outfitSlots[k].item; });
    document.getElementById("outfitAddCart").disabled = !anyFilled;
    renderOutfitFigure();
  }

  // Feste Regel, WO ein Accessoire im Look-Board auftaucht - "Accessories"
  // ist im Katalog eine einzige grobe Kategorie (Muetzen, Sonnenbrillen,
  // Guertel, Taschen, Schals, ...), es gibt kein eigenes Datenfeld fuer den
  // genauen Typ. Deshalb per Titel-Stichwort erkannt: NUR echte Kopf-/
  // Gesichts-Accessoires (Muetzen, Caps, Hueten, Sonnenbrillen) wandern
  // ganz nach oben (CSS order:1, noch vor Jacke/Oberteil) - Guertel gehoert
  // NICHT dazu (Nutzer-Feedback: "Guertel darf nie ganz oben sein"), sitzt
  // koerperlich auf Taillenhoehe und bleibt daher bei der normalen
  // Accessoire-Position zwischen Oberteil und Unterteil (order:4, siehe
  // .look-card--accessory in app.css) - genau wie Taschen, Schals, Wallets.
  var ACCESSORY_TOP_PATTERN = /(m[üu]tze|beanie|\bcap\b|kappe|h[uü]t(e|chen)?|sonnenbrille|brille|sunglasses)/i;

  function renderOutfitFigure() {
    var anyVisible = false;

    // Jede Karte zeigt das vollstaendige Look-Foto unbeschnitten
    // (object-fit:contain, siehe .look-card in app.css) - keine
    // Koerperteil-Crops/Sonderformen mehr noetig, da die Karten nicht mehr
    // uebereinandergelegt werden, sondern als eigene Reihe in einer Spalte
    // stehen (siehe Kommentar bei .look-card in app.css).
    function setCard(cardEl, item) {
      var src = assetUrl(item && (item.look || (item.gallery && item.gallery[0])) ? (item.look || item.gallery[0]) : "");
      var imgEl = cardEl.querySelector("img");
      if (src) {
        if (imgEl.getAttribute("src") !== src) imgEl.src = src;
        imgEl.alt = item.title;
        cardEl.classList.add("visible");
        anyVisible = true;
      } else {
        cardEl.classList.remove("visible");
      }
    }
    setCard(document.getElementById("figTop"), outfitSlots.top.item);
    setCard(document.getElementById("figJacket"), outfitSlots.jacket.item);
    setCard(document.getElementById("figBottom"), outfitIsDress() ? null : outfitSlots.bottom.item);
    setCard(document.getElementById("figShoes"), outfitSlots.shoes.item);
    setCard(document.getElementById("figAccessory"), outfitSlots.accessory.item);
    var accItem = outfitSlots.accessory.item;
    document.getElementById("figAccessory").classList.toggle(
      "look-card--accessory-top",
      !!(accItem && ACCESSORY_TOP_PATTERN.test(accItem.title))
    );
    document.getElementById("lookBoardEmpty").classList.toggle("hidden-empty", anyVisible);
  }

  var outfitPickerSize = "";
  var outfitPickerPriceMax = null;

  function renderOutfitPickerGrid() {
    var slot = outfitSlots[outfitPickerKey];
    var grid = document.getElementById("outfitPickerGrid");
    var options = outfitEligible(slot.categories, outfitPickerQuery, {
      size: outfitPickerSize,
      priceMax: outfitPickerPriceMax
    });
    grid.innerHTML = "";
    if (!options.length) {
      grid.innerHTML = '<p class="outfit-picker__empty">' + t("outfitEmptyOptions") + '</p>';
      return;
    }
    var frag = document.createDocumentFragment();
    options.forEach(function (it) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "outfit-picker__item" + (slot.item && slot.item.id === it.id ? " outfit-picker__item--active" : "");
      btn.innerHTML =
        '<div class="outfit-picker__item-frame"><img src="' + assetUrl(it.gallery[0]) + '" alt="" loading="lazy" /></div>' +
        '<div class="outfit-picker__item-title">' + escapeHtml(it.title) + "</div>" +
        '<div class="outfit-picker__item-price">' + fmtPrice(it.price) + "</div>";
      btn.addEventListener("click", function () {
        setOutfitSlot(outfitPickerKey, it);
        closeOutfitPicker();
      });
      frag.appendChild(btn);
    });
    grid.appendChild(frag);
  }

  var outfitPickerLastFocusEl = null;
  function openOutfitPicker(key) {
    outfitPickerLastFocusEl = document.activeElement;
    outfitPickerKey = key;
    outfitPickerQuery = "";
    outfitPickerSize = "";
    outfitPickerPriceMax = null;
    document.getElementById("outfitPickerTitle").textContent = outfitSlotLabel(key) + " " + t("outfitPickerChoose");
    var search = document.getElementById("outfitPickerSearch");
    search.value = "";
    var priceInput = document.getElementById("outfitPickerPriceMax");
    priceInput.value = "";

    // Groessen-Auswahl neu befuellen - nur Groessen, die in dieser Kategorie
    // tatsaechlich vorkommen (unabhaengig von Text-/Preisfilter).
    var sizeSelect = document.getElementById("outfitPickerSize");
    var sizes = [];
    outfitEligible(outfitSlots[key].categories).forEach(function (it) {
      if (it.size && sizes.indexOf(it.size) === -1) sizes.push(it.size);
    });
    sizes.sort();
    sizeSelect.innerHTML = '<option value="" data-i18n="outfitPickerAllSizes">' + t("outfitPickerAllSizes") + '</option>' +
      sizes.map(function (s) { return '<option value="' + escapeHtml(s) + '">' + escapeHtml(s) + '</option>'; }).join("");

    renderOutfitPickerGrid();
    outfitPicker.classList.add("open");
    search.focus();
  }

  function closeOutfitPicker() {
    outfitPicker.classList.remove("open");
    if (outfitPickerLastFocusEl && typeof outfitPickerLastFocusEl.focus === "function") outfitPickerLastFocusEl.focus();
  }
  bindFocusTrap(outfitPicker, function () { return outfitPicker.classList.contains("open"); }, closeOutfitPicker);

  document.getElementById("outfitPickerClose").addEventListener("click", closeOutfitPicker);
  document.getElementById("outfitPickerSearch").addEventListener("input", function (e) {
    outfitPickerQuery = e.target.value;
    renderOutfitPickerGrid();
  });
  document.getElementById("outfitPickerSize").addEventListener("change", function (e) {
    outfitPickerSize = e.target.value;
    renderOutfitPickerGrid();
  });
  document.getElementById("outfitPickerPriceMax").addEventListener("input", function (e) {
    var v = parseFloat(e.target.value);
    outfitPickerPriceMax = (e.target.value !== "" && !isNaN(v)) ? v : null;
    renderOutfitPickerGrid();
  });

  function randomOutfit() {
    OUTFIT_ORDER.forEach(function (k) { outfitSlots[k].item = null; });

    // Manchmal bewusst einen "Marken-Moment" versuchen statt komplett wild
    // zu mischen - wirkt kuratierter statt zufaellig. Nur Marken mit
    // genuegend Auswahl ueber mehrere Kategorien hinweg kommen infrage.
    var monoBrand = null;
    if (Math.random() < 0.4) {
      var brandCounts = {};
      ITEMS.forEach(function (it) {
        if (it.public_status === "AVAILABLE" && it.price > 0 && it.gallery && it.gallery[0] && it.brand) {
          brandCounts[it.brand] = (brandCounts[it.brand] || 0) + 1;
        }
      });
      var candidates = Object.keys(brandCounts).filter(function (b) { return brandCounts[b] >= 3; });
      if (candidates.length) monoBrand = candidates[Math.floor(Math.random() * candidates.length)];
    }

    function pick(categories) {
      var pool = outfitEligible(categories);
      if (monoBrand) {
        var brandPool = pool.filter(function (it) { return it.brand === monoBrand; });
        // Nicht stur erzwingen - wenn die Marke in dieser Kategorie nichts
        // Passendes hat, faellt es zurueck auf die volle Auswahl.
        if (brandPool.length && Math.random() < 0.8) pool = brandPool;
      }
      return pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
    }

    outfitSlots.top.item = pick(outfitSlots.top.categories);
    if (!outfitIsDress() && Math.random() > 0.5) outfitSlots.jacket.item = pick(outfitSlots.jacket.categories);
    if (!outfitIsDress()) outfitSlots.bottom.item = pick(outfitSlots.bottom.categories);
    outfitSlots.shoes.item = pick(outfitSlots.shoes.categories);
    if (Math.random() > 0.35) outfitSlots.accessory.item = pick(outfitSlots.accessory.categories);
    saveOutfit();
    renderOutfitStack();
  }

  document.getElementById("outfitRandom").addEventListener("click", randomOutfit);
  document.getElementById("outfitReset").addEventListener("click", function () {
    OUTFIT_ORDER.forEach(function (k) { outfitSlots[k].item = null; });
    saveOutfit();
    renderOutfitStack();
  });
  document.getElementById("outfitAddCart").addEventListener("click", function () {
    OUTFIT_ORDER.forEach(function (k) {
      var it = outfitSlots[k].item;
      if (it && !isInCart(it.id)) cart.push(it.id);
    });
    saveCart();
    updateCartCount();
    showClassic();
    openCart();
  });

  function showOutfit() {
    appShell.classList.add("hidden");
    swipeView.classList.add("hidden");
    chaosView.classList.add("hidden");
    renderOutfitStack();
    outfitView.classList.remove("hidden");
    syncModeRail("outfit");
    pushModePath(OUTFIT_PATH);
  }

  loadOutfit();

  // ---- Rechtliches (Impressum / AGB / Datenschutz) ----
  function legalEmailLine() {
    return SHOP_CONFIG.email
      ? '<a href="mailto:' + SHOP_CONFIG.email + '">' + escapeHtml(SHOP_CONFIG.email) + "</a>"
      : t("legalEmailPending");
  }

  var LEGAL_HTML_KEY = { impressum: "legalImpressumHtml", agb: "legalAgbHtml", datenschutz: "legalDatenschutzHtml" };
  var INFO_HTML_KEY = { about: "aboutHtml", faq: "faqHtml" };
  function legalContent(key) {
    var htmlKey = LEGAL_HTML_KEY[key];
    if (!htmlKey) return "";
    return t(htmlKey).split("{email}").join(legalEmailLine());
  }

  // Jede Rechts-/Infoseite hat wie der Warenkorb eine echte, eigene URL
  // (siehe build_special_pages() in build_site.py - vollstaendige Kopien
  // dieser Seite, die beim Laden anhand von location.pathname das passende
  // Panel sofort oeffnen). Von hier aus wechselt ein Klick per pushState
  // schnell dorthin; Direktaufruf/Teilen der URL funktioniert genauso.
  var LEGAL_PATHS = { impressum: langHome(LANG) + "impressum/", agb: langHome(LANG) + "agb/", datenschutz: langHome(LANG) + "datenschutz/" };
  var INFO_PATHS = { about: langHome(LANG) + "ueber-uns/", faq: langHome(LANG) + "faq/" };
  // Statisches HTML (index_template.html) verlinkt hier fest auf die
  // deutschen Pfade, weil dieselbe Vorlage fuer /, /en/ und /fr/ verwendet
  // wird - fuer EN/FR hier auf die passende Sprachversion korrigieren.
  Array.prototype.forEach.call(document.querySelectorAll("[data-legal]"), function (btn) {
    if (btn.tagName === "A") btn.href = LEGAL_PATHS[btn.getAttribute("data-legal")];
  });
  Array.prototype.forEach.call(document.querySelectorAll("[data-info]"), function (btn) {
    if (btn.tagName === "A") btn.href = INFO_PATHS[btn.getAttribute("data-info")];
  });

  var legalBackdrop = document.getElementById("legalBackdrop");
  var currentLegalKey = null;
  var currentInfoKey = null;
  function openLegal(key) {
    currentLegalKey = key;
    currentInfoKey = null;
    document.getElementById("legalContent").innerHTML = legalContent(key);
    legalBackdrop.classList.add("open");
    document.getElementById("legalClose").focus();
    var path = LEGAL_PATHS[key];
    if (path && location.pathname !== path) history.pushState({ legal: key }, "", path);
  }
  function openInfo(key) {
    if (!INFO_HTML_KEY[key]) return;
    currentLegalKey = null;
    currentInfoKey = key;
    document.getElementById("legalContent").innerHTML = t(INFO_HTML_KEY[key]);
    legalBackdrop.classList.add("open");
    document.getElementById("legalClose").focus();
    var path = INFO_PATHS[key];
    if (path && location.pathname !== path) history.pushState({ info: key }, "", path);
  }
  function closeLegal() {
    var onOwnPage = LEGAL_PATHS[currentLegalKey] === location.pathname || INFO_PATHS[currentInfoKey] === location.pathname;
    legalBackdrop.classList.remove("open");
    currentLegalKey = null;
    currentInfoKey = null;
    if (onOwnPage) location.href = langHome(LANG);
  }

  Array.prototype.forEach.call(document.querySelectorAll("[data-legal]"), function (btn) {
    btn.addEventListener("click", function (e) { e.preventDefault(); openLegal(btn.getAttribute("data-legal")); });
  });
  Array.prototype.forEach.call(document.querySelectorAll("[data-info]"), function (btn) {
    btn.addEventListener("click", function (e) { e.preventDefault(); openInfo(btn.getAttribute("data-info")); });
  });
  document.getElementById("legalClose").addEventListener("click", closeLegal);
  legalBackdrop.addEventListener("click", function (e) {
    if (e.target === legalBackdrop) closeLegal();
  });
  window.addEventListener("popstate", function () {
    var legalKey = null, infoKey = null;
    Object.keys(LEGAL_PATHS).forEach(function (k) { if (LEGAL_PATHS[k] === location.pathname) legalKey = k; });
    Object.keys(INFO_PATHS).forEach(function (k) { if (INFO_PATHS[k] === location.pathname) infoKey = k; });
    if (legalKey) openLegal(legalKey);
    else if (infoKey) openInfo(infoKey);
    else if (currentLegalKey || currentInfoKey) {
      legalBackdrop.classList.remove("open");
      currentLegalKey = null;
      currentInfoKey = null;
    }
  });

  // Kein Auto-Open des JS-Panels mehr bei Direktaufruf von /impressum/ usw. -
  // diese Seiten haben jetzt echten, serverseitig gerenderten Inhalt direkt
  // im HTML (siehe static_page_content_html() in build_site.py), das Panel
  // bleibt nur fuer die schnelle Schnellansicht per Klick von der Startseite
  // aus da (openLegal()/openInfo() oben, per pushState statt Neuladen).

  // ---- Hinweis zur lokalen Speicherung (kein Tracking, daher kein Consent-Banner mit Ablehnen-Option) ----
  var COOKIE_NOTE_KEY = "disorder119_cookie_note_seen";
  try {
    if (!window.localStorage.getItem(COOKIE_NOTE_KEY)) {
      document.getElementById("cookieNote").classList.add("visible");
    }
  } catch (e) {}
  document.getElementById("cookieNoteOk").addEventListener("click", function () {
    document.getElementById("cookieNote").classList.remove("visible");
    try { window.localStorage.setItem(COOKIE_NOTE_KEY, "1"); } catch (e) {}
  });

  // "DISORDER119"-Marke, "Zum Archiv"-Buttons und das Baukasten-Schliessen-
  // Kreuz sind jetzt echte <a href="/"> (siehe index_template.html) - Href
  // pro Sprache korrigieren, Klick per pushState statt Neuladen abfangen.
  Array.prototype.forEach.call(document.querySelectorAll("[data-enter-classic]"), function (btn) {
    if (btn.tagName === "A") btn.href = CLASSIC_PATH;
    btn.addEventListener("click", function (e) {
      e.preventDefault();
      showClassic();
    });
  });

  // Direkter Einstieg: auf /, /match/, /chaos/ oder /baukasten/ startet
  // sofort in der passenden Ansicht (wie bei jeder normalen Seite - Direkt-
  // aufruf/Reload/geteilter Link landen exakt dort, wo sie hinzeigen). Auf
  // allen anderen Seiten (Warenkorb, Rechtstexte, Info) bleibt der Katalog
  // unsichtbar - dort zeigt stattdessen der jeweils eigene Seiteninhalt,
  // nur die persistente Kopfzeile (Menue, Marke, Match/Chaos/Baukasten)
  // bleibt sichtbar, damit von ueberall aus echt navigiert werden kann.
  if (IS_CATALOG_PAGE) {
    suppressModePush = true;
    var initialMode = modeFromPath(location.pathname);
    if (initialMode === "swipe") showSwipe();
    else if (initialMode === "chaos") showChaos();
    else if (initialMode === "outfit") showOutfit();
    else if (initialMode === "mieten") showMieten();
    else showClassic();
    suppressModePush = false;
    // Deep-Link von einer Produktseite ("...mieten/?item=123", siehe
    // rentalTeaser-Link in build_site.py/cta_html()) - oeffnet die Anfrage
    // direkt fuer genau dieses Stueck, statt nur auf die allgemeine
    // Mieten-Kategorie zu verweisen. Parameter danach aus der URL entfernen,
    // damit ein Reload/Teilen des Links nicht dauerhaft dasselbe Modal
    // erneut aufreisst.
    if (initialMode === "mieten") {
      try {
        var rentalItemId = Number(new URLSearchParams(window.location.search).get("item"));
        if (rentalItemId && findItem(rentalItemId)) {
          openRentalModal(rentalItemId);
          window.history.replaceState(history.state, "", window.location.pathname);
        }
      } catch (e) {}
    }
  } else {
    modeRail.classList.remove("hidden");
  }
  // Sprache VOR dem ersten render() anwenden (nicht danach) - sonst wuerde ein
  // EN/FR-Erstbesucher kurz deutschen Text sehen, bevor auf seine gespeicherte
  // Sprache umgeschaltet wird. applyLanguage() ruft render() bereits selbst auf.
  applyLanguage(LANG);

  // Marken-Link von einer Produktseite ("artikel/{id}.html?brand=...zurueck
  // ins Archiv") - Parameter danach aus der URL entfernen, damit ein Reload
  // oder Teilen des Links nicht dauerhaft auf diese Marke fixiert bleibt.
  try {
    var brandParam = new URLSearchParams(window.location.search).get("brand");
    if (brandParam) {
      filterByBrand(brandParam);
      window.history.replaceState(null, "", window.location.pathname);
    }
  } catch (e) {}
  // Kurz warten, bis Layout/Fonts sich gesetzt haben, damit die Positionsmessung
  // der Leiste (fuer den Erstbesuch-Hinweis) verlaessliche Werte liefert.
  setTimeout(showModeRailHint, 900);
  }).catch(function (e) { console.error("Konnte Artikeldaten nicht laden:", e); });
})();

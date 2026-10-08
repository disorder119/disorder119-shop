/* Kasse: Stuecke aus dem Warenkorb (oder ?artikel=<ID> von der Produktseite),
   Lieferadresse mit Vorschlaegen fuer Ort und Strasse, Versandart mit
   Live-Preis und Bezahlen mit PayPal.

   Der Browser rechnet hier nichts Verbindliches: Preise, Paketgroesse,
   Versandpreis und Adresse prueft der Server (shop-worker) beim Bestellen
   noch einmal selbst. Ist PayPal noch nicht verbunden, geht die komplette
   Bestellung als E-Mail-Anfrage raus - so bleibt die Seite nie eine Sackgasse. */
(function () {
  "use strict";

  var CFG = window.SHOP_CONFIG || {};
  var LANG = window.KASSE_LANG || document.documentElement.lang || "de";
  var HOME = LANG === "de" ? "/" : "/" + LANG + "/";
  var WORKER = /^https:\/\//.test(String(CFG.shopWorkerUrl || "")) ? String(CFG.shopWorkerUrl).replace(/\/$/, "") : "";
  var CART_KEY = "disorder119_cart";
  var CODE_KEY = "d119_coupon_code";
  var PAYPAL_BEREIT = !!(CFG.features && CFG.features.paypalCheckout && CFG.paypalClientId && WORKER);

  var TEXTE = {
    de: {
      titel: "Kasse", zurueck: "Warenkorb", stuecke: "Deine Stücke", adresse: "Lieferadresse", versand: "Versand",
      uebersicht: "Übersicht", email: "E-Mail-Adresse für Bestellung und Rechnung", kontoAnlegen: "Kostenloses Kundenkonto erstellen (optional). Nach der Zahlung erhältst du einen Anmeldelink.",
      fehltEmail: "Bitte gib eine gültige E-Mail-Adresse an.", appleCoupon: "Mit Gutschein bitte PayPal wählen; der Rabatt wird dort vor der Zahlung geprüft.",
      vorname: "Vorname", nachname: "Nachname", plz: "PLZ", ort: "Ort", strasse: "Straße",
      hausnummer: "Nr.", zusatz: "Adresszusatz (optional)",
      landHinweis: "Wir liefern innerhalb Deutschlands mit DHL oder DPD, bezahlt wird mit PayPal oder Apple Pay. Mit DHL auch an eine Packstation oder Filiale.",
      agb: "AGB & Widerruf", datenschutz: "Datenschutz", impressum: "Impressum", widerruf: "Vertrag widerrufen",
      laedt: "Wird geladen …", leer: "Dein Warenkorb ist leer.", zumArchiv: "Zum Archiv",
      nichtMehr: "Nicht mehr verfügbar – wird nicht mitbestellt:", groesse: "Größe", paket: "Paket",
      paketS: "klein", paketM: "mittel", paketL: "groß", tag1: "1 Werktag", tageN: "{n} Werktage",
      versandLaedt: "Versand wird berechnet …", versandFehlt: "Der Versandpreis ist gerade nicht abrufbar. Bitte lade die Seite gleich neu.",
      versandWahlFehlt: "Dein gewählter Versanddienst ist nicht mehr verfügbar. Bitte wähle eine neue Versandart.",
      zwischensumme: "Stücke", versandZeile: "Versand", gesamt: "Gesamt", kostenlos: "kostenlos",
      freiFehlt: "Noch {betrag} bis zum kostenlosen Versand – ab {grenze} Warenwert übernehmen wir den günstigsten Standardversand.",
      lieferung: "Heute bestellt – voraussichtlich bei dir zwischen {von} und {bis}.", zahlart: "Mit PayPal-Käuferschutz",
      gutschein: "Gutschein {code} wird beim Bezahlen verrechnet.",
      recht: "Kleinunternehmer gemäß § 19 UStG, daher keine Umsatzsteuer. Versand innerhalb von 3 Werktagen; die angezeigte Lieferzeit gilt ab Bestellung. Mit dem PayPal-Knopf und deiner Bestätigung bei PayPal bestellst du zahlungspflichtig. PayPal reserviert den Betrag – abgebucht wird erst mit dem Versand, spätestens drei Tage nach der Bestellung.",
      rechtAnfrage: "Kleinunternehmer gemäß § 19 UStG, daher keine Umsatzsteuer. Die Anfrage ist unverbindlich – wir bestätigen Verfügbarkeit und Gesamtpreis per E-Mail.",
      agbLink: "AGB und Widerrufsbelehrung", dsLink: "Datenschutz",
      paypalBald: "Bezahlen mit PayPal kommt in Kürze. Bis dahin schickst du uns die Bestellung per E-Mail – mit Adresse und Versandart, wir bestätigen sie dir.",
      anfrage: "Bestellung per E-Mail senden", betreff: "Bestellung Disorder119",
      fehltVorname: "Bitte gib deinen Vornamen an.", fehltNachname: "Bitte gib deinen Nachnamen an.",
      fehltPlz: "Bitte gib eine fünfstellige PLZ an.", fehltOrt: "Bitte gib den Ort an.", fehltStrasse: "Bitte gib die Straße an.",
      fehltNummer: "Bitte gib die Hausnummer an.", packstation: "Für eine Packstation oder Filiale wähle unten bei Versand „An Packstation oder Filiale“ – das geht mit DHL.",
      plzUnbekannt: "Diese PLZ kennen wir nicht – bitte prüf sie noch einmal.", ortWaehlen: "Bitte wähle deinen Ort:",
      pruefen: "Bitte prüf die markierten Felder.", schonWeg: "Ein Stück ist gerade reserviert oder schon verkauft. Wir haben die Liste aktualisiert.",
      versandGeaendert: "Der Versandpreis hat sich gerade geändert. Bitte prüf die Übersicht und klick noch einmal auf PayPal.",
      abgelaufen: "Die Reservierung ist abgelaufen, es wurde nichts abgebucht. Bitte klick noch einmal auf PayPal.",
      wirdGeprueft: "PayPal prüft deine Zahlung noch. Sobald sie bestätigt ist, bekommst du eine Mail – bitte nicht noch einmal bezahlen.",
      botCheck: "Die Sicherheitsprüfung hat nicht geklappt. Lade die Seite bitte neu und versuch es noch einmal.",
      zuSchnell: "Zu viele Versuche in kurzer Zeit. Warte bitte eine Minute.",
      nurDe: "Wir liefern bisher nur innerhalb Deutschlands.",
      fehler: "Da ist leider etwas schiefgelaufen. Bitte versuch es gleich noch einmal oder schreib uns.",
      abschliessen: "Zahlung wird abgeschlossen …", abgebrochen: "Bezahlung abgebrochen – es wurde nichts abgebucht.",
      danke: "Danke für deine Bestellung!", bestellnr: "Bestellnummer:",
      dankeText: "Die Bestellbestätigung kommt an deine angegebene E-Mail-Adresse. PayPal hat den Betrag reserviert – abgebucht wird erst, wenn wir versenden (spätestens nach drei Tagen), dann kommt auch die Rechnung. Wir packen deine Stücke von Hand und verschicken sie innerhalb von 3 Werktagen.",
      dankeTextEingezogen: "Die Bestätigung mit Rechnung kommt an deine angegebene E-Mail-Adresse. Wir packen deine Stücke von Hand und verschicken sie innerhalb von 3 Werktagen.",
      konto: "Bestellung im Konto ansehen", weiter: "Weiter stöbern",
      mailAdresse: "Lieferadresse", mailVersand: "Versand", mailGesamt: "Gesamt", mailGruss: "Hallo! Ich möchte folgende Stücke bestellen:",
      mailFrage: "Bitte bestätigt mir Verfügbarkeit und Zahlungsweg. Danke!",
      angaben: "Deine Angaben", zustWohin: "Wohin soll das Paket?", zustHaustuer: "An meine Adresse", zustAbholort: "An Packstation oder Filiale",
      zustNurDhl: "mit DHL", nurHaustuer: "nur an die Haustür", versichert: "versichert bis {betrag}", abholSuche: "PLZ für die Suche",
      abholSuchen: "Suchen", abholLaedt: "Suche Packstationen und Filialen …", abholKeine: "Hier haben wir keine Packstation oder Filiale gefunden. Probier eine andere PLZ oder gib die Nummer selbst ein.",
      abholFehler: "Die Suche bei DHL klappt gerade nicht. Gib die Nummer der Packstation oder Filiale selbst ein oder lass an deine Adresse liefern.",
      abholPlzFehlt: "Gib eine fünfstellige PLZ ein, dann zeigen wir dir Packstationen und Filialen in der Nähe.", abholOhneSuche: "Gib die Nummer deiner Packstation oder Filiale ein – du findest sie in der DHL-App oder auf dhl.de.", abholGefunden: "{n} Abholorte in der Nähe – wähle einen aus der Liste oder auf der Karte.",
      abholWaehlen: "Bitte wähle eine Packstation oder Filiale.", abholPackstation: "Packstation", abholFiliale: "Filiale",
      abholKarte: "Auf der Karte zeigen", abholKarteZu: "Karte ausblenden", abholKarteHinweis: "Die Karte lädt Kartenbilder von OpenStreetMap – dabei sieht der Kartendienst deine IP-Adresse.",
      kartePlus: "Karte vergrößern", karteMinus: "Karte verkleinern", karteLuftbild: "Luftbild", karteStrassen: "Karte",
      abholKarteHinweisLuftbild: "Die amtlichen Luftbilder holt unser Server beim Vermessungsamt deines Bundeslands – ohne deine IP-Adresse. Die Straßenkarte kommt direkt von OpenStreetMap, das dabei deine IP-Adresse sieht.", abholManuell: "Nummer selbst eingeben", abholArt: "Art",
      abholNummer: "Nummer", abholUebernehmen: "Übernehmen", abholNummerFehlt: "Bitte gib die Nummer ein (bis zu 4 Ziffern).",
      postnummer: "DHL-Postnummer", optional: "optional", postnummerHinweisP: "Pflicht an der Packstation: deine 6- bis 10-stellige Postnummer aus der DHL-App. Vor- und Nachname müssen zu deinem DHL-Konto passen.",
      postnummerHinweisF: "Optional – in der Filiale holst du das Paket mit Ausweis ab.", fehltPostnummer: "Bitte gib deine DHL-Postnummer an (6 bis 10 Ziffern).",
      postnummerUngueltig: "Die Postnummer hat 6 bis 10 Ziffern.", abholNurDhl: "An Packstation und Filiale liefert nur DHL. Bitte wähle DHL oder die Lieferung an deine Adresse.",
      abholUnvollstaendig: "Bitte wähle die Packstation oder Filiale noch einmal aus.", adresseAbhol: "Für Packstation oder Filiale brauchen wir nur Namen und E-Mail – Straße und Hausnummer kannst du leer lassen.",
      lieferungAn: "Lieferung an"
    },
    en: {
      titel: "Checkout", zurueck: "Cart", stuecke: "Your pieces", adresse: "Delivery address", versand: "Shipping",
      uebersicht: "Summary", email: "Email address for order and invoice", kontoAnlegen: "Create a free customer account (optional). We will email a sign-in link after payment.",
      fehltEmail: "Please enter a valid email address.", appleCoupon: "For coupons, please choose PayPal; the discount is checked before payment.",
      vorname: "First name", nachname: "Last name", plz: "Postcode", ort: "Town", strasse: "Street",
      hausnummer: "No.", zusatz: "Address line 2 (optional)",
      landHinweis: "We deliver within Germany with DHL or DPD; payment is made with PayPal or Apple Pay. With DHL also to a Packstation or post office.",
      agb: "Terms & withdrawal", datenschutz: "Privacy", impressum: "Legal notice", widerruf: "Withdraw from contract here",
      laedt: "Loading …", leer: "Your cart is empty.", zumArchiv: "To the archive",
      nichtMehr: "No longer available – not included:", groesse: "Size", paket: "parcel",
      paketS: "small", paketM: "medium", paketL: "large", tag1: "1 working day", tageN: "{n} working days",
      versandLaedt: "Calculating shipping …", versandFehlt: "The shipping price is not available right now. Please reload the page in a moment.",
      versandWahlFehlt: "Your selected carrier is no longer available. Please choose another shipping option.",
      zwischensumme: "Pieces", versandZeile: "Shipping", gesamt: "Total", kostenlos: "free",
      freiFehlt: "{betrag} more for free shipping – from {grenze} goods value we cover the cheapest standard shipping.",
      lieferung: "Order today – expected to arrive between {von} and {bis}.", zahlart: "With PayPal Buyer Protection",
      gutschein: "Coupon {code} is applied when you pay.",
      recht: "Small business under § 19 UStG, so no VAT is charged. Shipped within 3 working days; the delivery time shown counts from your order. With the PayPal button and your confirmation at PayPal you place a binding order. PayPal reserves the amount – it is only charged when we ship, at the latest three days after your order.",
      rechtAnfrage: "Small business under § 19 UStG, so no VAT is charged. The request is non-binding – we confirm availability and the total by e-mail.",
      agbLink: "Terms and withdrawal", dsLink: "Privacy",
      paypalBald: "Paying with PayPal is coming soon. Until then, send us your order by e-mail – with address and shipping, and we will confirm it.",
      anfrage: "Send order by e-mail", betreff: "Order Disorder119",
      fehltVorname: "Please enter your first name.", fehltNachname: "Please enter your last name.",
      fehltPlz: "Please enter a five-digit postcode.", fehltOrt: "Please enter the town.", fehltStrasse: "Please enter the street.",
      fehltNummer: "Please enter the house number.", packstation: "For a Packstation or post office, choose “To a Packstation or post office” under Shipping below – available with DHL.",
      plzUnbekannt: "We don't know this postcode – please check it.", ortWaehlen: "Please pick your town:",
      pruefen: "Please check the highlighted fields.", schonWeg: "A piece has just been reserved or sold. We have updated the list.",
      versandGeaendert: "The shipping price has just changed. Please check the summary and click PayPal again.",
      abgelaufen: "The reservation has expired, nothing was charged. Please click PayPal again.",
      wirdGeprueft: "PayPal is still reviewing your payment. You will get an email as soon as it is confirmed – please do not pay again.",
      botCheck: "The security check failed. Please reload the page and try again.",
      zuSchnell: "Too many attempts in a short time. Please wait a minute.",
      nurDe: "For now we only deliver within Germany.",
      fehler: "Something went wrong. Please try again in a moment or write to us.",
      abschliessen: "Completing payment …", abgebrochen: "Payment cancelled – nothing was charged.",
      danke: "Thank you for your order!", bestellnr: "Order number:",
      dankeText: "The order confirmation is on its way to the email address you entered. PayPal has reserved the amount – it is only charged when we ship (at the latest after three days), and then the invoice follows. We pack your pieces by hand and ship within 3 working days.",
      dankeTextEingezogen: "The confirmation and invoice will be sent to the email address you entered. We pack your pieces by hand and ship within 3 working days.",
      konto: "View order in your account", weiter: "Keep browsing",
      mailAdresse: "Delivery address", mailVersand: "Shipping", mailGesamt: "Total", mailGruss: "Hello! I would like to order these pieces:",
      mailFrage: "Please confirm availability and payment. Thank you!",
      angaben: "Your details", zustWohin: "Where should the parcel go?", zustHaustuer: "To my address", zustAbholort: "To a Packstation or post office",
      zustNurDhl: "with DHL", nurHaustuer: "home delivery only", versichert: "insured up to {betrag}", abholSuche: "Postcode to search",
      abholSuchen: "Search", abholLaedt: "Searching for Packstations and post offices …", abholKeine: "We found no Packstation or post office here. Try another postcode or enter the number yourself.",
      abholFehler: "The DHL search is not working right now. Enter the Packstation or post office number yourself, or have the parcel delivered to your address.",
      abholPlzFehlt: "Enter a five-digit postcode and we will show you Packstations and post offices nearby.", abholOhneSuche: "Enter the number of your Packstation or post office – you can find it in the DHL app or on dhl.de.", abholGefunden: "{n} pickup points nearby – choose one from the list or on the map.",
      abholWaehlen: "Please choose a Packstation or post office.", abholPackstation: "Packstation", abholFiliale: "Post office",
      abholKarte: "Show on map", abholKarteZu: "Hide map", abholKarteHinweis: "The map loads tiles from OpenStreetMap – the map service sees your IP address.",
      kartePlus: "Zoom in", karteMinus: "Zoom out", karteLuftbild: "Aerial", karteStrassen: "Map",
      abholKarteHinweisLuftbild: "Our server fetches the official aerial images from your state's survey office – without your IP address. The street map comes directly from OpenStreetMap, which sees your IP address.", abholManuell: "Enter the number yourself", abholArt: "Type", abholNummer: "Number",
      abholUebernehmen: "Use this", abholNummerFehlt: "Please enter the number (up to 4 digits).", postnummer: "DHL Postnummer",
      optional: "optional", postnummerHinweisP: "Required for a Packstation: your 6 to 10 digit Postnummer from the DHL app. First and last name must match your DHL account.",
      postnummerHinweisF: "Optional – you collect the parcel at the post office with your ID.", fehltPostnummer: "Please enter your DHL Postnummer (6 to 10 digits).",
      postnummerUngueltig: "The Postnummer has 6 to 10 digits.", abholNurDhl: "Only DHL delivers to Packstations and post offices. Please choose DHL or delivery to your address.",
      abholUnvollstaendig: "Please choose the Packstation or post office again.", adresseAbhol: "For a Packstation or post office we only need your name and email – you can leave street and house number empty.",
      lieferungAn: "Deliver to"
    },
    fr: {
      titel: "Commande", zurueck: "Panier", stuecke: "Tes pièces", adresse: "Adresse de livraison", versand: "Livraison",
      uebersicht: "Récapitulatif", email: "Adresse e-mail pour la commande et la facture", kontoAnlegen: "Créer un compte client gratuit (facultatif). Un lien de connexion sera envoyé après le paiement.",
      fehltEmail: "Saisis une adresse e-mail valide.", appleCoupon: "Pour utiliser un bon, choisis PayPal ; la réduction est vérifiée avant le paiement.",
      vorname: "Prénom", nachname: "Nom", plz: "Code postal", ort: "Ville", strasse: "Rue",
      hausnummer: "N°", zusatz: "Complément d'adresse (facultatif)",
      landHinweis: "Nous livrons en Allemagne avec DHL ou DPD ; le paiement se fait avec PayPal ou Apple Pay. Avec DHL aussi en Packstation ou bureau de poste.",
      agb: "CGV & rétractation", datenschutz: "Confidentialité", impressum: "Mentions légales", widerruf: "Se rétracter du contrat ici",
      laedt: "Chargement …", leer: "Ton panier est vide.", zumArchiv: "Vers l'archive",
      nichtMehr: "Plus disponible – non inclus :", groesse: "Taille", paket: "colis",
      paketS: "petit", paketM: "moyen", paketL: "grand", tag1: "1 jour ouvré", tageN: "{n} jours ouvrés",
      versandLaedt: "Calcul de la livraison …", versandFehlt: "Le prix de livraison n'est pas disponible pour le moment. Recharge la page dans un instant.",
      versandWahlFehlt: "Le transporteur choisi n'est plus disponible. Choisis un autre mode de livraison.",
      zwischensumme: "Pièces", versandZeile: "Livraison", gesamt: "Total", kostenlos: "gratuite",
      freiFehlt: "Plus que {betrag} pour la livraison gratuite – dès {grenze} d’articles, nous offrons la livraison standard la moins chère.",
      lieferung: "Commande aujourd’hui – livraison prévue entre le {von} et le {bis}.", zahlart: "Avec la Protection des achats PayPal",
      gutschein: "Le bon {code} est déduit au paiement.",
      recht: "Micro-entreprise selon le § 19 UStG, pas de TVA. Expédition sous 3 jours ouvrés ; le délai de livraison indiqué court à partir de la commande. Avec le bouton PayPal et ta confirmation chez PayPal, tu passes une commande ferme. PayPal réserve le montant – il n'est débité qu'à l'expédition, au plus tard trois jours après la commande.",
      rechtAnfrage: "Micro-entreprise selon le § 19 UStG, pas de TVA. La demande est sans engagement – nous confirmons disponibilité et total par e-mail.",
      agbLink: "CGV et rétractation", dsLink: "Confidentialité",
      paypalBald: "Le paiement PayPal arrive bientôt. En attendant, envoie-nous ta commande par e-mail – avec adresse et livraison, nous la confirmons.",
      anfrage: "Envoyer la commande par e-mail", betreff: "Commande Disorder119",
      fehltVorname: "Indique ton prénom.", fehltNachname: "Indique ton nom.",
      fehltPlz: "Indique un code postal à cinq chiffres.", fehltOrt: "Indique la ville.", fehltStrasse: "Indique la rue.",
      fehltNummer: "Indique le numéro.", packstation: "Pour une Packstation ou un bureau de poste, choisis « En Packstation ou bureau de poste » sous Livraison – possible avec DHL.",
      plzUnbekannt: "Nous ne connaissons pas ce code postal – vérifie-le.", ortWaehlen: "Choisis ta ville :",
      pruefen: "Vérifie les champs signalés.", schonWeg: "Une pièce vient d'être réservée ou vendue. Nous avons mis la liste à jour.",
      versandGeaendert: "Le prix de livraison vient de changer. Vérifie le récapitulatif et clique à nouveau sur PayPal.",
      abgelaufen: "La réservation a expiré, rien n'a été débité. Clique à nouveau sur PayPal.",
      wirdGeprueft: "PayPal vérifie encore ton paiement. Tu recevras un e-mail dès qu'il sera confirmé – merci de ne pas payer une seconde fois.",
      botCheck: "La vérification de sécurité a échoué. Recharge la page et réessaie.",
      zuSchnell: "Trop de tentatives en peu de temps. Attends une minute.",
      nurDe: "Pour l'instant, nous ne livrons qu'en Allemagne.",
      fehler: "Une erreur s'est produite. Réessaie dans un instant ou écris-nous.",
      abschliessen: "Finalisation du paiement …", abgebrochen: "Paiement annulé – rien n'a été débité.",
      danke: "Merci pour ta commande !", bestellnr: "Numéro de commande :",
      dankeText: "La confirmation de commande arrive à l'adresse e-mail indiquée. PayPal a réservé le montant – il n'est débité qu'à l'expédition (au plus tard après trois jours), et la facture suit alors. Nous emballons tes pièces à la main et expédions sous 3 jours ouvrés.",
      dankeTextEingezogen: "La confirmation et la facture seront envoyées à l'adresse e-mail indiquée. Nous emballons tes pièces à la main et expédions sous 3 jours ouvrés.",
      konto: "Voir la commande dans ton compte", weiter: "Continuer",
      mailAdresse: "Adresse de livraison", mailVersand: "Livraison", mailGesamt: "Total", mailGruss: "Bonjour ! Je souhaite commander ces pièces :",
      mailFrage: "Merci de me confirmer disponibilité et paiement !",
      angaben: "Tes coordonnées", zustWohin: "Où livrer le colis ?", zustHaustuer: "À mon adresse", zustAbholort: "En Packstation ou bureau de poste",
      zustNurDhl: "avec DHL", nurHaustuer: "à domicile uniquement", versichert: "assuré jusqu’à {betrag}", abholSuche: "Code postal pour la recherche",
      abholSuchen: "Rechercher", abholLaedt: "Recherche des Packstations et bureaux de poste …", abholKeine: "Aucune Packstation ni bureau de poste trouvé ici. Essaie un autre code postal ou saisis le numéro toi-même.",
      abholFehler: "La recherche DHL ne fonctionne pas pour le moment. Saisis toi-même le numéro de la Packstation ou du bureau de poste, ou fais livrer à ton adresse.",
      abholPlzFehlt: "Saisis un code postal à cinq chiffres pour voir les Packstations et bureaux de poste à proximité.", abholOhneSuche: "Saisis le numéro de ta Packstation ou de ton bureau de poste – tu le trouves dans l’app DHL ou sur dhl.de.",
      abholGefunden: "{n} points de retrait à proximité – choisis-en un dans la liste ou sur la carte.", abholWaehlen: "Choisis une Packstation ou un bureau de poste.",
      abholPackstation: "Packstation", abholFiliale: "Bureau de poste", abholKarte: "Afficher sur la carte", abholKarteZu: "Masquer la carte",
      abholKarteHinweis: "La carte charge des images d’OpenStreetMap – le service de carte voit ton adresse IP.", kartePlus: "Zoom avant",
      karteMinus: "Zoom arrière", karteLuftbild: "Vue aérienne", karteStrassen: "Plan",
      abholKarteHinweisLuftbild: "Notre serveur charge les vues aériennes officielles auprès du service cadastral de ton Land – sans ton adresse IP. Le plan vient directement d’OpenStreetMap, qui voit ton adresse IP.", abholManuell: "Saisir le numéro toi-même", abholArt: "Type", abholNummer: "Numéro", abholUebernehmen: "Valider",
      abholNummerFehlt: "Saisis le numéro (jusqu’à 4 chiffres).", postnummer: "Postnummer DHL", optional: "facultatif",
      postnummerHinweisP: "Obligatoire pour une Packstation : ta Postnummer de 6 à 10 chiffres de l’app DHL. Prénom et nom doivent correspondre à ton compte DHL.",
      postnummerHinweisF: "Facultatif – tu retires le colis au bureau de poste avec une pièce d’identité.", fehltPostnummer: "Saisis ta Postnummer DHL (6 à 10 chiffres).",
      postnummerUngueltig: "La Postnummer compte 6 à 10 chiffres.", abholNurDhl: "Seul DHL livre en Packstation et en bureau de poste. Choisis DHL ou la livraison à ton adresse.",
      abholUnvollstaendig: "Choisis à nouveau la Packstation ou le bureau de poste.", adresseAbhol: "Pour une Packstation ou un bureau de poste, il nous faut seulement ton nom et ton e-mail – rue et numéro peuvent rester vides.",
      lieferungAn: "Livraison à"
    }
  };
  function t(k) { var s = TEXTE[LANG] || TEXTE.de; return s[k] != null ? s[k] : TEXTE.de[k]; }
  function tf(k, werte) { return t(k).replace(/\{(\w+)\}/g, function (_, n) { return werte[n] != null ? werte[n] : ""; }); }

  function geld(cents) {
    var wert = (Number(cents) || 0) / 100;
    if (LANG === "en") return "€" + wert.toFixed(2);
    return wert.toFixed(2).replace(".", ",") + " €";
  }
  function el(tag, klasse, text) {
    var e = document.createElement(tag);
    if (klasse) e.className = klasse;
    if (text != null) e.textContent = text;
    return e;
  }
  function $(id) { return document.getElementById(id); }

  var meldung = $("kasseMeldung");
  var status = $("kasseStatus");
  function melden(text, ziel) {
    var z = ziel || meldung;
    z.textContent = text || "";
    z.hidden = !text;
    if (text && z === meldung) z.focus();
  }

  // ---- Texte der Vorlage in der richtigen Sprache
  Array.prototype.forEach.call(document.querySelectorAll("[data-t]"), function (e) { e.textContent = t(e.getAttribute("data-t")); });
  $("kasseTitel").textContent = t("titel");
  $("kasseZurueck").textContent = "← " + t("zurueck");

  var zustand = { stuecke: [], weg: [], versand: null, wahl: null, laeuft: false, versuch: null, orte: [] };

  // ---- Welche Stuecke? ?artikel=<ID> (Produktseite) oder der Warenkorb
  function gewuenschteIds() {
    var param = new URLSearchParams(location.search).get("artikel");
    if (param && /^\d{1,9}$/.test(param)) return [Number(param)];
    try {
      var liste = JSON.parse(localStorage.getItem(CART_KEY) || "[]");
      return (Array.isArray(liste) ? liste : []).map(Number).filter(function (n) { return n > 0; }).slice(0, 10);
    } catch (e) { return []; }
  }
  function vorschau(it) {
    var pfad = it.grid_image || (it.gallery && it.gallery[0]) || "";
    if (!pfad) return "";
    pfad = String(pfad).replace(/^\/+/, "");
    if (!it.grid_image) {
      var i = pfad.lastIndexOf("/");
      pfad = pfad.slice(0, i) + "/thumbs/" + pfad.slice(i + 1);
    }
    return "/" + pfad;
  }

  function artikelLaden() {
    var ids = gewuenschteIds();
    if (!ids.length) { leer(); return Promise.resolve(); }
    return fetch("/data/catalog.json", { cache: "no-cache" })
      .then(function (r) { return r.json(); })
      .then(function (katalog) {
        var nachId = {};
        katalog.forEach(function (it) { nachId[it.id] = it; });
        zustand.stuecke = []; zustand.weg = [];
        ids.forEach(function (id) {
          var it = nachId[id];
          if (it && it.public_status === "AVAILABLE" && it.price > 0) zustand.stuecke.push(it);
          else if (it) zustand.weg.push(it);
        });
        artikelZeichnen();
        if (!zustand.stuecke.length) { leer(); return; }
        versandLaden();
      })
      .catch(function () { melden(t("fehler")); });
  }

  function leer() {
    $("kasseRaster").hidden = true;
    if (document.querySelector(".kasse-leer")) return;
    var box = el("div", "kasse-leer");
    box.appendChild(el("p", "", t("leer")));
    var link = el("a", "kasse-knopf kasse-knopf--hell", t("zumArchiv"));
    link.href = HOME;
    box.appendChild(link);
    $("kasseRaster").parentNode.insertBefore(box, $("kasseRaster"));
  }

  function artikelZeichnen() {
    var liste = $("kasseArtikel");
    liste.textContent = "";
    liste.setAttribute("aria-busy", "false");
    zustand.stuecke.forEach(function (it) {
      var li = el("li", "kasse-stueck");
      var bild = el("span", "kasse-stueck__bild");
      // Helle Ansicht: gemessener Aufhell-Faktor des Fotos (build_site.py).
      if (Number(it.foto_hell) > 0) bild.style.setProperty("--d119-hell", String(Number(it.foto_hell)));
      var src = vorschau(it);
      if (src) {
        var img = document.createElement("img");
        img.src = src; img.alt = ""; img.loading = "lazy"; img.decoding = "async";
        bild.appendChild(img);
      }
      var text = el("span", "kasse-stueck__text");
      if (it.brand) text.appendChild(el("span", "kasse-stueck__marke", it.brand));
      text.appendChild(el("span", "kasse-stueck__titel", it.title || ""));
      if (it.size) text.appendChild(el("span", "kasse-stueck__meta", t("groesse") + " " + it.size));
      li.appendChild(bild);
      li.appendChild(text);
      li.appendChild(el("span", "kasse-stueck__preis", geld(Math.round(it.price * 100))));
      liste.appendChild(li);
    });
    if (zustand.weg.length) {
      var hinweis = el("li", "kasse-weg", t("nichtMehr") + " " + zustand.weg.map(function (it) { return it.title; }).join(", "));
      liste.appendChild(hinweis);
    }
    summeZeichnen();
  }

  // ---- Versand: Standard (und Express, wenn angeboten) mit Live-Preis
  function versandLaden() {
    var box = $("kasseVersand");
    box.textContent = t("versandLaedt");
    box.setAttribute("aria-busy", "true");
    if (!WORKER) { zustand.versand = null; versandZeichnen(); return Promise.resolve(); }
    var ids = zustand.stuecke.map(function (it) { return it.id; }).join(",");
    return fetch(WORKER + "/versand/optionen?artikel=" + encodeURIComponent(ids))
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; })
      .then(function (daten) { versandSetzen(daten); });
  }
  function versandSetzen(daten) {
    var gueltig = daten && daten.optionen && daten.optionen.length ? daten : null;
    var vorher = zustand.wahl;
    zustand.versand = gueltig;
    zustand.wahl = !gueltig ? null : !vorher ? gueltig.optionen[0] :
      gueltig.optionen.filter(function (o) { return o.id === vorher.id; })[0] ||
      gueltig.optionen.filter(function (o) { return o.carrier && o.carrier === vorher.carrier && o.art === vorher.art; })[0] || null;
    versandZeichnen();
  }
  // Gesamte Lieferzeit: Versand innerhalb von 1 bis VERSAND_TAGE Werktagen plus Laufzeit des Paketdienstes.
  var VERSAND_TAGE = 3;
  function tage(o) { return !o || !o.tage ? "" : tf("tageN", { n: (o.tage + 1) + "–" + (o.tage + VERSAND_TAGE) }); }
  function paketName(d) { return d ? t("paket") + " " + (t("paket" + d.paket) || d.paketName) : ""; }
  // Ab 99 € Warenwert uebernimmt der Shop den guenstigsten Standard (Worker).
  function preisText(cents) { return Number(cents) === 0 ? t("kostenlos") : geld(cents); }
  function geldRund(cents) {
    var euro = Math.round((Number(cents) || 0) / 100);
    return LANG === "en" ? "€" + euro : euro + " €";
  }
  // "DHL Paket" statt "DHL DHL Paket": den Paketdienst nur nennen, wenn der Titel ihn nicht schon traegt.
  function versandName(o) {
    if (!o) return "";
    return o.carrier && String(o.titel || "").indexOf(o.carrier) !== 0 ? o.carrier + " " + (o.titel || "") : (o.titel || o.carrier || "");
  }
  // "Mo., 12.10." - das Datum rechnet der Worker (shop-worker/lieferzeit.js).
  function datumKurz(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
    if (!m) return "";
    var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    try {
      return d.toLocaleDateString(LANG === "en" ? "en-GB" : LANG === "fr" ? "fr-FR" : "de-DE",
        { weekday: "short", day: "numeric", month: LANG === "de" ? "numeric" : "short", timeZone: "UTC" });
    } catch (e) { return +m[3] + "." + +m[2] + "."; }
  }
  function lieferText(o) {
    var l = o && o.lieferung;
    // "14.10." am Satzende: kein doppelter Punkt.
    return l && l.von && l.bis ? tf("lieferung", { von: datumKurz(l.von), bis: datumKurz(l.bis) }).replace(/\.\.$/, ".") : "";
  }

  function versandZeichnen() {
    var box = $("kasseVersand");
    var fokus = document.activeElement && box.contains(document.activeElement) ? document.activeElement.name : "";
    box.textContent = "";
    box.setAttribute("aria-busy", "false");
    var d = zustand.versand;
    if (!d) { box.appendChild(el("p", "kasse-hinweis", t("versandFehlt"))); summeZeichnen(); return; }
    var gesperrt = gesperrtJetzt();
    // Packstation/Filiale nur, wenn ein Dienst sie anbietet (DHL).
    var abholbar = d.optionen.some(kannAbholen);
    if (!abholbar) abhol.art = "haustuer";
    if (abhol.art === "abholort" && !kannAbholen(zustand.wahl)) zustand.wahl = d.optionen.filter(kannAbholen)[0];
    if (abholbar) {
      box.appendChild(el("p", "kasse-wohin__titel", t("zustWohin")));
      var wohin = el("div", "kasse-wohin");
      wohin.setAttribute("role", "radiogroup");
      wohin.setAttribute("aria-label", t("zustWohin"));
      [["haustuer", t("zustHaustuer"), ""], ["abholort", t("zustAbholort"), t("zustNurDhl")]].forEach(function (w) {
        var label = el("label", "kasse-option kasse-option--wohin");
        var radio = document.createElement("input");
        radio.type = "radio"; radio.name = "kasseWohin"; radio.value = w[0];
        radio.checked = abhol.art === w[0];
        radio.disabled = gesperrt;
        radio.addEventListener("change", function () { if (radio.checked) wohinSetzen(w[0]); });
        var name = el("span", "kasse-option__name", w[1]);
        if (w[2]) name.appendChild(el("small", "", w[2]));
        label.appendChild(radio);
        label.appendChild(name);
        wohin.appendChild(label);
      });
      box.appendChild(wohin);
    }
    var gruppe = el("div", "kasse-optionen");
    gruppe.setAttribute("role", "radiogroup");
    gruppe.setAttribute("aria-label", t("versand"));
    d.optionen.forEach(function (o) {
      var nurHaustuer = abhol.art === "abholort" && !kannAbholen(o);
      var label = el("label", "kasse-option" + (nurHaustuer ? " kasse-option--aus" : ""));
      var radio = document.createElement("input");
      radio.type = "radio"; radio.name = "kasseVersand"; radio.value = o.id;
      radio.checked = !!zustand.wahl && zustand.wahl.id === o.id;
      radio.disabled = gesperrt || nurHaustuer;
      radio.addEventListener("change", function () { zustand.wahl = o; versandZeichnen(); });
      var name = el("span", "kasse-option__name", o.titel);
      var dienst = o.carrier && String(o.titel || "").indexOf(o.carrier) !== 0 ? o.carrier : "";
      var meta = [dienst, tage(o), o.versichertBisCents ? tf("versichert", { betrag: geldRund(o.versichertBisCents) }) : "",
        nurHaustuer ? t("nurHaustuer") : ""].filter(Boolean).join(" · ");
      if (meta) name.appendChild(el("small", "", meta));
      label.appendChild(radio);
      label.appendChild(name);
      label.appendChild(el("span", "kasse-option__preis", preisText(o.preisCents)));
      gruppe.appendChild(label);
    });
    box.appendChild(gruppe);
    formModus();
    if (abhol.art === "abholort") {
      box.appendChild(aPanel);
      abholZeichnen();
    }
    if (!zustand.wahl) box.appendChild(el("p", "kasse-hinweis", t("versandWahlFehlt")));
    var lieferung = lieferText(zustand.wahl);
    if (lieferung) box.appendChild(el("p", "kasse-lieferung", lieferung));
    var frei = d.frei;
    if (frei && !frei.erreicht && frei.fehltCents > 0) {
      box.appendChild(el("p", "kasse-hinweis kasse-frei", tf("freiFehlt", { betrag: geld(frei.fehltCents), grenze: geld(frei.abCents) })));
    }
    box.appendChild(el("p", "kasse-hinweis", paketName(d)));
    summeZeichnen();
    if (fokus) {
      var wieder = box.querySelector('input[name="' + fokus + '"]:checked');
      if (wieder) wieder.focus();
    }
  }

  // ---- Uebersicht
  function stueckeCents() {
    return zustand.stuecke.reduce(function (s, it) { return s + Math.round(it.price * 100); }, 0);
  }
  function summeZeichnen() {
    var liste = $("kasseSumme");
    liste.textContent = "";
    function zeile(a, b, klasse) {
      var reihe = el("div", klasse || "");
      reihe.appendChild(el("dt", "", a));
      reihe.appendChild(el("dd", "", b));
      liste.appendChild(reihe);
    }
    var ware = stueckeCents();
    zeile(t("zwischensumme") + " (" + zustand.stuecke.length + ")", geld(ware));
    zeile(t("versandZeile") + (zustand.wahl ? " · " + versandName(zustand.wahl) : ""), zustand.wahl ? preisText(zustand.wahl.preisCents) : "…");
    if (abholung() && abhol.ort) zeile(t("lieferungAn"), abhol.ort.name + (abhol.ort.ort ? ", " + abhol.ort.ort : ""), "kasse-summe__ziel");
    zeile(t("gesamt"), zustand.wahl ? geld(ware + zustand.wahl.preisCents) : "…", "kasse-summe__gesamt");
    var code = "";
    try { code = String(localStorage.getItem(CODE_KEY) || "").trim().toUpperCase(); } catch (e) { code = ""; }
    var gs = $("kasseGutschein");
    gs.hidden = !(code && PAYPAL_BEREIT);
    if (code && PAYPAL_BEREIT) gs.textContent = tf("gutschein", { code: code });
  }
  function rechtZeichnen() {
    var p = $("kasseRecht");
    p.textContent = (PAYPAL_BEREIT ? t("recht") : t("rechtAnfrage")) + " ";
    var agb = el("a", "", t("agbLink")); agb.href = HOME + "agb/";
    var ds = el("a", "", t("dsLink")); ds.href = HOME + "datenschutz/";
    p.appendChild(agb); p.appendChild(document.createTextNode(" · ")); p.appendChild(ds);
  }

  // ---- Lieferadresse: Ort zur PLZ, Strassen zum Anfang
  var f = { email: $("kEmail"), vorname: $("kVorname"), nachname: $("kNachname"), plz: $("kPlz"), ort: $("kOrt"), strasse: $("kStrasse"), nummer: $("kNummer"), zusatz: $("kZusatz") };
  var orteBox = $("kOrte");
  var vorschlagListe = $("kStrassen");
  var ortAutomatisch = "";

  function adressdienst(query) {
    if (!WORKER) return Promise.resolve(null);
    return fetch(WORKER + "/adresse/vorschlag?" + query)
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }
  function feldFehler(feld, text) {
    var huelle = feld.closest(".kasse-feld");
    if (!huelle) return;
    var alt = huelle.querySelector(".kasse-fehler");
    if (alt) alt.remove();
    feld.removeAttribute("aria-invalid");
    if (text) {
      feld.setAttribute("aria-invalid", "true");
      var p = el("p", "kasse-fehler", text);
      p.id = feld.id + "Fehler";
      feld.setAttribute("aria-describedby", p.id);
      huelle.appendChild(p);
    }
  }

  var plzAnfrage = 0;
  f.plz.addEventListener("input", function () {
    f.plz.value = f.plz.value.replace(/\D/g, "").slice(0, 5);
    orteBox.hidden = true;
    feldFehler(f.plz, "");
    if (f.plz.value.length !== 5) return;
    var nr = ++plzAnfrage;
    adressdienst("plz=" + f.plz.value).then(function (daten) {
      if (nr !== plzAnfrage || !daten || !Array.isArray(daten.orte)) return;
      zustand.orte = daten.orte;
      if (!daten.orte.length) { feldFehler(f.plz, t("plzUnbekannt")); return; }
      if (daten.orte.length === 1) {
        if (!f.ort.value || f.ort.value === ortAutomatisch) { f.ort.value = daten.orte[0]; ortAutomatisch = daten.orte[0]; feldFehler(f.ort, ""); }
        return;
      }
      orteBox.textContent = "";
      orteBox.appendChild(el("span", "kasse-orte__titel", t("ortWaehlen")));
      daten.orte.slice(0, 8).forEach(function (name) {
        var b = el("button", "kasse-chip", name);
        b.type = "button";
        b.addEventListener("click", function () { f.ort.value = name; ortAutomatisch = name; orteBox.hidden = true; feldFehler(f.ort, ""); f.strasse.focus(); });
        orteBox.appendChild(b);
      });
      orteBox.hidden = false;
    });
  });

  var strassenUhr = 0, strassenAnfrage = 0, aktiv = -1;
  function vorschlaegeSchliessen() {
    vorschlagListe.hidden = true;
    vorschlagListe.textContent = "";
    f.strasse.setAttribute("aria-expanded", "false");
    f.strasse.removeAttribute("aria-activedescendant");
    aktiv = -1;
  }
  function vorschlagWaehlen(name) {
    f.strasse.value = name;
    vorschlaegeSchliessen();
    feldFehler(f.strasse, "");
    f.nummer.focus();
  }
  function vorschlaegeZeigen(namen) {
    vorschlagListe.textContent = "";
    aktiv = -1;
    if (!namen.length || document.activeElement !== f.strasse) { vorschlaegeSchliessen(); return; }
    namen.forEach(function (name, i) {
      var li = el("li", "kasse-vorschlag", name);
      li.id = "kStrasse" + i;
      li.setAttribute("role", "option");
      li.addEventListener("mousedown", function (e) { e.preventDefault(); vorschlagWaehlen(name); });
      vorschlagListe.appendChild(li);
    });
    vorschlagListe.hidden = false;
    f.strasse.setAttribute("aria-expanded", "true");
  }
  function aktivSetzen(i) {
    var eintraege = vorschlagListe.children;
    if (!eintraege.length) return;
    aktiv = (i + eintraege.length) % eintraege.length;
    Array.prototype.forEach.call(eintraege, function (li, k) { li.setAttribute("aria-selected", String(k === aktiv)); });
    f.strasse.setAttribute("aria-activedescendant", eintraege[aktiv].id);
  }
  f.strasse.addEventListener("input", function () {
    clearTimeout(strassenUhr);
    var anfang = f.strasse.value.trim();
    if (anfang.length < 2 || !/^\d{5}$/.test(f.plz.value)) { vorschlaegeSchliessen(); return; }
    strassenUhr = setTimeout(function () {
      var nr = ++strassenAnfrage;
      adressdienst("plz=" + f.plz.value + "&strasse=" + encodeURIComponent(anfang)).then(function (daten) {
        if (nr !== strassenAnfrage || !daten || !Array.isArray(daten.strassen)) return;
        var passend = daten.strassen.filter(function (n) { return n.toLowerCase() !== f.strasse.value.trim().toLowerCase(); });
        vorschlaegeZeigen(passend);
      });
    }, 220);
  });
  f.strasse.addEventListener("keydown", function (e) {
    if (vorschlagListe.hidden) return;
    if (e.key === "ArrowDown") { e.preventDefault(); aktivSetzen(aktiv + 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); aktivSetzen(aktiv - 1); }
    else if (e.key === "Enter" && aktiv >= 0) { e.preventDefault(); vorschlagWaehlen(vorschlagListe.children[aktiv].textContent); }
    else if (e.key === "Escape") { vorschlaegeSchliessen(); }
  });
  f.strasse.addEventListener("blur", function () { setTimeout(vorschlaegeSchliessen, 120); });
  // "Musterstraße 12" in einem Feld: die Nummer wandert ins Nummernfeld.
  f.strasse.addEventListener("change", function () {
    var m = /^(.*\D)\s+(\d{1,5}\s?[a-zA-Z]?(?:\s?[-/]\s?\d{1,5}[a-zA-Z]?)?)$/.exec(f.strasse.value.trim());
    if (m && !f.nummer.value) { f.strasse.value = m[1].trim(); f.nummer.value = m[2].replace(/\s+/g, ""); }
  });
  Object.keys(f).forEach(function (k) { f[k].addEventListener("input", function () { if (k !== "plz") feldFehler(f[k], ""); }); });

  // ---- Zustellung: DHL liefert auch an Packstation oder Filiale. Die Orte
  // sucht der Shop-Server bei DHL (shop-worker/abholorte.js) - an DHL gehen
  // nur PLZ und Strasse. Die Karte laedt OpenStreetMap-Kacheln erst nach
  // einem Klick (Datenschutz) und kommt ohne Bibliothek aus.
  // luftbild: { land, quelle } - amtliche Luftbilder des Bundeslands (shop-worker/karte.js) oder null;
  // ebene: "luftbild" oder "karte" (Strassenkarte von OpenStreetMap).
  var abhol = { art: "haustuer", ort: null, orte: null, laedt: false, fehler: "", gesucht: "", karte: false, zoom: 0, luftbild: false, ebene: "" };
  var abholCache = {};
  var abholAnfrage = 0;
  function kannAbholen(o) { return !!(o && o.abholstation); }
  function abholung() { return abhol.art === "abholort" && kannAbholen(zustand.wahl); }
  function gleicherOrt(a, b) { return !!(a && b) && a.typ === b.typ && a.nummer === b.nummer && a.plz === b.plz; }
  function ortTyp(o) { return t(o.typ === "packstation" ? "abholPackstation" : "abholFiliale"); }
  function entfernung(m) {
    if (typeof m !== "number" || !(m >= 0)) return "";
    if (m < 1000) return Math.max(10, Math.round(m / 10) * 10) + " m";
    var km = (m / 1000).toFixed(1);
    return (LANG === "en" ? km : km.replace(".", ",")) + " km";
  }
  function feldBauen(klasse, text, feld) {
    var huelle = el("label", "kasse-feld " + klasse);
    huelle.appendChild(el("span", "", text));
    huelle.appendChild(feld);
    return huelle;
  }
  function eingabe(id, max, ziffern) {
    var e = document.createElement("input");
    e.type = "text"; e.id = id; e.maxLength = max; e.autocomplete = "off";
    if (ziffern) e.inputMode = "numeric";
    return e;
  }
  function gesperrtJetzt() { return !!(zustand.versuch && zustand.versuch.ablauf > Date.now()); }

  var aPanel = el("div", "kasse-abholort");
  var aPlz = eingabe("kAbholPlz", 5, true);
  var aSuchKnopf = el("button", "kasse-chip", t("abholSuchen"));
  aSuchKnopf.type = "button";
  var aSuche = el("div", "kasse-abholort__suche");
  aSuche.appendChild(feldBauen("kasse-feld--plz", t("abholSuche"), aPlz));
  aSuche.appendChild(aSuchKnopf);
  var aStatus = el("p", "kasse-hinweis kasse-abholort__status");
  aStatus.setAttribute("role", "status");
  var aKarteKnopf = el("button", "kasse-link", t("abholKarte"));
  aKarteKnopf.type = "button";
  aKarteKnopf.setAttribute("aria-expanded", "false");
  var aKarteHinweis = el("p", "kasse-hinweis kasse-abholort__klein", t("abholKarteHinweis"));
  var aKarte = el("div", "kasse-karte");
  aKarte.hidden = true;
  var aListe = el("div", "kasse-abholort__liste");
  aListe.setAttribute("role", "radiogroup");
  aListe.setAttribute("aria-label", t("zustAbholort"));
  var aManuellKnopf = el("button", "kasse-link", t("abholManuell"));
  aManuellKnopf.type = "button";
  aManuellKnopf.setAttribute("aria-expanded", "false");
  var aManuell = el("div", "kasse-abholort__manuell");
  aManuell.hidden = true;
  var mTyp = document.createElement("select");
  mTyp.id = "kAbholArt";
  [["packstation", t("abholPackstation")], ["filiale", t("abholFiliale")]].forEach(function (o) {
    var opt = el("option", "", o[1]); opt.value = o[0]; mTyp.appendChild(opt);
  });
  var mNummer = eingabe("kAbholNummer", 4, true);
  var mOrt = eingabe("kAbholOrt", 80, false);
  var mKnopf = el("button", "kasse-chip", t("abholUebernehmen"));
  mKnopf.type = "button";
  aManuell.appendChild(feldBauen("kasse-feld--art", t("abholArt"), mTyp));
  aManuell.appendChild(feldBauen("kasse-feld--nummer", t("abholNummer"), mNummer));
  aManuell.appendChild(feldBauen("kasse-feld--ortklein", t("ort"), mOrt));
  aManuell.appendChild(mKnopf);
  var aPost = eingabe("kPostnummer", 14, true);
  var aPostTitel = el("span", "", t("postnummer"));
  var aPostHinweis = el("p", "kasse-hinweis kasse-abholort__klein");
  var aPostFeld = el("label", "kasse-feld kasse-abholort__post");
  aPostFeld.appendChild(aPostTitel);
  aPostFeld.appendChild(aPost);
  aPostFeld.appendChild(aPostHinweis);
  var aWerkzeug = el("div", "kasse-abholort__werkzeug");
  aWerkzeug.appendChild(aKarteKnopf);
  aWerkzeug.appendChild(aManuellKnopf);
  [aSuche, aStatus, aWerkzeug, aKarteHinweis, aKarte, aManuell, aListe, aPostFeld].forEach(function (e) { aPanel.appendChild(e); });

  // Hinweis im Adressblock: Bei der Abholung reichen Name und E-Mail.
  var aAdressHinweis = el("p", "kasse-hinweis kasse-feld--breit kasse-abholhinweis", t("adresseAbhol"));
  aAdressHinweis.hidden = true;
  $("kLand").parentNode.insertBefore(aAdressHinweis, $("kLand").nextSibling);

  function formModus() {
    var an = abholung();
    $("kasseForm").classList.toggle("kasse-form--abholort", an);
    aAdressHinweis.hidden = !an;
    var titel = document.querySelector("#kasseAdresseTitel [data-t]");
    if (titel) titel.textContent = t(an ? "angaben" : "adresse");
    if (an) [f.plz, f.ort, f.strasse, f.nummer].forEach(function (x) { feldFehler(x, ""); });
  }

  function statusZeichnen() {
    var text = abhol.laedt ? t("abholLaedt") : abhol.fehler ? t(abhol.fehler)
      : abhol.orte && !abhol.orte.length ? t("abholKeine")
      : abhol.orte ? tf("abholGefunden", { n: abhol.orte.length })
      : t("abholPlzFehlt");
    aStatus.textContent = text;
    aStatus.classList.toggle("kasse-abholort__status--fehler", !!abhol.fehler && abhol.fehler !== "abholOhneSuche");
  }
  function listeZeichnen() {
    aListe.textContent = "";
    var orte = abhol.orte || [];
    var eintraege = orte.map(function (o, i) { return { ort: o, nr: String(i + 1) }; });
    // Ein selbst eingegebener (oder frueher gefundener) Ort bleibt sichtbar.
    if (abhol.ort && !orte.some(function (o) { return gleicherOrt(o, abhol.ort); })) eintraege.unshift({ ort: abhol.ort, nr: "•" });
    aListe.hidden = !eintraege.length;
    var gesperrt = gesperrtJetzt();
    eintraege.forEach(function (e) {
      var o = e.ort;
      var label = el("label", "kasse-ort");
      var radio = document.createElement("input");
      radio.type = "radio"; radio.name = "kasseAbholort"; radio.value = o.id || o.typ + "-" + o.nummer;
      radio.checked = gleicherOrt(abhol.ort, o);
      radio.disabled = gesperrt;
      radio._ort = o;
      radio.addEventListener("change", function () { if (radio.checked) ortWaehlen(o, false); });
      var text = el("span", "kasse-ort__text");
      text.appendChild(el("span", "kasse-ort__name", o.name));
      var adresse = [o.strasse, [o.plz, o.ort].filter(Boolean).join(" ")].filter(Boolean).join(", ");
      text.appendChild(el("small", "", [o.geschaeft, ortTyp(o), adresse].filter(Boolean).join(" · ")));
      label.appendChild(radio);
      label.appendChild(el("span", "kasse-ort__nr" + (o.typ === "packstation" ? "" : " kasse-ort__nr--filiale"), e.nr));
      label.appendChild(text);
      label.appendChild(el("span", "kasse-ort__weg", entfernung(o.entfernungM)));
      aListe.appendChild(label);
    });
  }
  function postZeichnen() {
    var filiale = !!abhol.ort && abhol.ort.typ === "filiale";
    aPostTitel.textContent = t("postnummer") + (filiale ? " (" + t("optional") + ")" : "");
    aPostHinweis.textContent = t(filiale ? "postnummerHinweisF" : "postnummerHinweisP");
  }

  // ---- Karte: Kacheln im Web-Mercator-Raster, Ausschnitt passt sich den Orten an.
  var KACHEL = 256;
  function karteX(lng, z) { return (lng + 180) / 360 * Math.pow(2, z) * KACHEL; }
  function karteY(lat, z) {
    var r = lat * Math.PI / 180;
    return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * Math.pow(2, z) * KACHEL;
  }
  function mitGeo(o) { return typeof o.lat === "number" && typeof o.lng === "number"; }
  function karteZeichnen() {
    var orte = (abhol.orte || []).filter(mitGeo);
    aKarteKnopf.hidden = !orte.length;
    aKarteHinweis.hidden = !orte.length || abhol.karte;
    aKarteHinweis.textContent = t(abhol.luftbild ? "abholKarteHinweisLuftbild" : "abholKarteHinweis");
    var ebene = abhol.luftbild && abhol.ebene !== "karte" ? "luftbild" : "karte";
    aKarteKnopf.textContent = t(abhol.karte ? "abholKarteZu" : "abholKarte");
    aKarteKnopf.setAttribute("aria-expanded", String(abhol.karte && !!orte.length));
    aKarte.textContent = "";
    if (!abhol.karte || !orte.length) { aKarte.hidden = true; return; }
    aKarte.hidden = false;
    var breite = aKarte.clientWidth || 320;
    var hoehe = aKarte.clientHeight || 260;
    var lngs = orte.map(function (o) { return o.lng; });
    var lats = orte.map(function (o) { return o.lat; });
    var w = Math.min.apply(null, lngs), e = Math.max.apply(null, lngs);
    var s = Math.min.apply(null, lats), n = Math.max.apply(null, lats);
    var z = 17;
    while (z > 9 && (karteX(e, z) - karteX(w, z) > breite - 60 || karteY(s, z) - karteY(n, z) > hoehe - 60)) z--;
    abhol.passend = z;
    z = Math.max(ebene === "luftbild" ? 13 : 5, Math.min(18, z + abhol.zoom));
    var cx = (karteX(w, z) + karteX(e, z)) / 2;
    var cy = (karteY(n, z) + karteY(s, z)) / 2;
    if (abhol.zoom > 0 && abhol.ort && mitGeo(abhol.ort)) { cx = karteX(abhol.ort.lng, z); cy = karteY(abhol.ort.lat, z); }
    var links = cx - breite / 2, oben = cy - hoehe / 2;
    var anzahl = Math.pow(2, z);
    var flaeche = el("div", "kasse-karte__flaeche kasse-karte__flaeche--" + ebene);
    for (var tx = Math.floor(links / KACHEL); tx * KACHEL < links + breite; tx++) {
      for (var ty = Math.floor(oben / KACHEL); ty * KACHEL < oben + hoehe; ty++) {
        if (ty < 0 || ty >= anzahl) continue;
        var img = document.createElement("img");
        img.alt = ""; img.decoding = "async"; img.draggable = false;
        // Die Kasse schickt sonst keine Herkunft mit (meta referrer same-origin). OpenStreetMap
        // sperrt Kacheln ohne Herkunft ("Access blocked"), und der Shop-Server prueft sie bei den
        // Luftbildern. Nur die Shop-Adresse geht mit, nie die Seite mit dem Warenkorb.
        img.referrerPolicy = "strict-origin-when-cross-origin";
        var spalte = ((tx % anzahl) + anzahl) % anzahl;
        img.src = ebene === "luftbild" ? WORKER + "/karte/luftbild/" + abhol.luftbild.land + "/" + z + "/" + ty + "/" + spalte
          : "https://tile.openstreetmap.org/" + z + "/" + spalte + "/" + ty + ".png";
        img.style.left = Math.round(tx * KACHEL - links) + "px";
        img.style.top = Math.round(ty * KACHEL - oben) + "px";
        flaeche.appendChild(img);
      }
    }
    aKarte.appendChild(flaeche);
    var gesperrt = gesperrtJetzt();
    (abhol.orte || []).forEach(function (o, i) {
      if (!mitGeo(o)) return;
      var p = el("button", "kasse-karte__punkt" + (o.typ === "packstation" ? "" : " kasse-karte__punkt--filiale"), String(i + 1));
      p.type = "button";
      p._ort = o;
      p.style.left = Math.round(karteX(o.lng, z) - links) + "px";
      p.style.top = Math.round(karteY(o.lat, z) - oben) + "px";
      p.setAttribute("aria-label", (i + 1) + ": " + o.name + (o.strasse ? ", " + o.strasse : ""));
      p.setAttribute("aria-pressed", String(gleicherOrt(abhol.ort, o)));
      p.disabled = gesperrt;
      p.addEventListener("click", function () { ortWaehlen(o, true); });
      aKarte.appendChild(p);
    });
    var zoom = el("div", "kasse-karte__zoom");
    [["+", "kartePlus", 1], ["−", "karteMinus", -1]].forEach(function (k) {
      var b = el("button", "", k[0]);
      b.type = "button";
      b.setAttribute("aria-label", t(k[1]));
      b.addEventListener("click", function () {
        abhol.zoom = Math.max(-4, Math.min(4, abhol.zoom + k[2]));
        karteZeichnen();
        var neu = aKarte.querySelector(".kasse-karte__zoom button:nth-child(" + (k[2] > 0 ? 1 : 2) + ")");
        if (neu) neu.focus();
      });
      zoom.appendChild(b);
    });
    aKarte.appendChild(zoom);
    // Luftbild oder Strassenkarte - nur wenn der Server Luftbilder liefern kann.
    if (abhol.luftbild) {
      var ebenen = el("div", "kasse-karte__ebenen");
      ebenen.setAttribute("role", "group");
      [["luftbild", "karteLuftbild"], ["karte", "karteStrassen"]].forEach(function (k) {
        var b = el("button", "", t(k[1]));
        b.type = "button";
        b.setAttribute("aria-pressed", String(ebene === k[0]));
        b.addEventListener("click", function () {
          abhol.ebene = k[0];
          karteZeichnen();
          var neu = aKarte.querySelector(".kasse-karte__ebenen button[aria-pressed=true]");
          if (neu) neu.focus();
        });
        ebenen.appendChild(b);
      });
      aKarte.appendChild(ebenen);
    }
    var quelle;
    if (ebene === "luftbild") {
      // Quellenvermerk, wie ihn das Vermessungsamt des Landes verlangt (vom Server).
      quelle = el("span", "kasse-karte__quelle", abhol.luftbild.quelle);
    } else {
      quelle = el("a", "kasse-karte__quelle", "© OpenStreetMap");
      quelle.href = "https://www.openstreetmap.org/copyright";
      quelle.target = "_blank"; quelle.rel = "noopener";
    }
    aKarte.appendChild(quelle);
  }
  var karteUhr = 0;
  window.addEventListener("resize", function () {
    if (!abhol.karte || aKarte.hidden) return;
    clearTimeout(karteUhr);
    karteUhr = setTimeout(karteZeichnen, 200);
  });

  function sperrZeichnen() {
    var gesperrt = gesperrtJetzt();
    [aPlz, aPost, mNummer, mOrt].forEach(function (x) { x.readOnly = gesperrt; });
    [aSuchKnopf, mKnopf, mTyp].forEach(function (x) { x.disabled = gesperrt; });
  }
  function abholZeichnen() {
    statusZeichnen();
    listeZeichnen();
    karteZeichnen();
    postZeichnen();
    sperrZeichnen();
  }

  function ortWaehlen(o, vonKarte) {
    abhol.ort = o;
    if (abhol.fehler === "abholWaehlen") abhol.fehler = "";
    var radios = aListe.querySelectorAll("input");
    if (!Array.prototype.some.call(radios, function (r) { return gleicherOrt(r._ort, o); })) { listeZeichnen(); radios = aListe.querySelectorAll("input"); }
    Array.prototype.forEach.call(radios, function (r) {
      r.checked = gleicherOrt(r._ort, o);
      if (r.checked && vonKarte) {
        // Nur die Liste scrollen, nicht die Seite - die Karte bleibt im Blick.
        var zeile = r.closest("label");
        if (zeile.offsetTop < aListe.scrollTop || zeile.offsetTop + zeile.offsetHeight > aListe.scrollTop + aListe.clientHeight) {
          aListe.scrollTop = Math.max(0, zeile.offsetTop - 8);
        }
      }
    });
    Array.prototype.forEach.call(aKarte.querySelectorAll(".kasse-karte__punkt"), function (p) {
      p.setAttribute("aria-pressed", String(gleicherOrt(p._ort, o)));
    });
    // Aus der Liste gewaehlt und Karte offen: hineinzoomen, damit man das Haus erkennt.
    if (!vonKarte && abhol.karte && !aKarte.hidden && mitGeo(o)) {
      abhol.zoom = Math.max(abhol.zoom, 17 - (abhol.passend || 15));
      karteZeichnen();
    }
    statusZeichnen();
    postZeichnen();
    feldFehler(aPost, "");
    summeZeichnen();
  }

  function abholSuchen(automatisch) {
    var plz = aPlz.value.replace(/\D/g, "").slice(0, 5);
    aPlz.value = plz;
    if (!/^\d{5}$/.test(plz)) {
      feldFehler(aPlz, automatisch ? "" : t("fehltPlz"));
      statusZeichnen();
      return;
    }
    feldFehler(aPlz, "");
    // Die eigene Strasse hilft bei der Sortierung nach Entfernung - nur, wenn
    // die Suche dieselbe PLZ wie die Adresse hat.
    var strasse = plz === f.plz.value.trim() ? (f.strasse.value.trim() + " " + f.nummer.value.trim()).trim() : "";
    var schluessel = plz + "|" + strasse.toLowerCase();
    if (abhol.gesucht === schluessel && (abhol.laedt || abhol.orte)) return;
    abhol.gesucht = schluessel;
    abhol.zoom = 0;
    if (abholCache[schluessel]) {
      abhol.orte = abholCache[schluessel].orte; abhol.luftbild = abholCache[schluessel].luftbild;
      abhol.fehler = ""; abhol.laedt = false; abholZeichnen(); return;
    }
    var nr = ++abholAnfrage;
    abhol.laedt = true; abhol.fehler = "";
    statusZeichnen();
    if (!WORKER) { abhol.laedt = false; abhol.fehler = "abholFehler"; abhol.gesucht = ""; manuellZeigen(true); abholZeichnen(); return; }
    fetch(WORKER + "/versand/abholorte?plz=" + plz + (strasse ? "&strasse=" + encodeURIComponent(strasse) : ""))
      .then(antwortLesen)
      .then(function (daten) {
        if (nr !== abholAnfrage) return;
        abhol.laedt = false;
        abhol.orte = Array.isArray(daten.orte) ? daten.orte : [];
        // { land, quelle } - amtliche Luftbilder des Bundeslands der PLZ, sonst nur Strassenkarte.
        abhol.luftbild = WORKER && daten.luftbild && /^[A-Z]{2}$/.test(daten.luftbild.land) && daten.luftbild.quelle ? daten.luftbild : null;
        abholCache[schluessel] = { orte: abhol.orte, luftbild: abhol.luftbild };
        abholZeichnen();
      }, function (e) {
        if (nr !== abholAnfrage) return;
        var code = (e && e.code) || "";
        abhol.laedt = false; abhol.orte = null; abhol.gesucht = "";
        // Ohne DHL-Zugang am Server: gleich die Nummer eingeben lassen, ohne Stoerungsmeldung.
        abhol.fehler = code === "RATE_LIMITED" ? "zuSchnell" : code === "PLZ_UNGUELTIG" ? "fehltPlz"
          : code === "ABHOLORTE_NICHT_EINGERICHTET" ? "abholOhneSuche" : "abholFehler";
        if (abhol.fehler === "abholFehler" || abhol.fehler === "abholOhneSuche") manuellZeigen(true);
        abholZeichnen();
      });
  }

  function manuellZeigen(an) {
    aManuell.hidden = !an;
    aManuellKnopf.setAttribute("aria-expanded", String(an));
    if (an && !mOrt.value && aPlz.value === f.plz.value.trim()) mOrt.value = f.ort.value.trim();
  }
  function manuellUebernehmen() {
    var nummer = mNummer.value.replace(/\D/g, "");
    var plz = aPlz.value.replace(/\D/g, "");
    var ort = mOrt.value.trim();
    var ok = true;
    if (!/^\d{1,4}$/.test(nummer)) { feldFehler(mNummer, t("abholNummerFehlt")); ok = false; } else feldFehler(mNummer, "");
    if (!/^\d{5}$/.test(plz)) { feldFehler(aPlz, t("fehltPlz")); ok = false; } else feldFehler(aPlz, "");
    if (ort.length < 2) { feldFehler(mOrt, t("fehltOrt")); ok = false; } else feldFehler(mOrt, "");
    if (!ok) return;
    var typ = mTyp.value === "filiale" ? "filiale" : "packstation";
    ortWaehlen({ id: "eigen-" + typ + "-" + nummer + "-" + plz, typ: typ, nummer: nummer,
      name: (typ === "packstation" ? "Packstation " : "Postfiliale ") + nummer, strasse: "", plz: plz, ort: ort,
      lat: null, lng: null, entfernungM: null }, false);
  }

  aPlz.addEventListener("input", function () {
    aPlz.value = aPlz.value.replace(/\D/g, "").slice(0, 5);
    aPlz.dataset.auto = "0";
    feldFehler(aPlz, "");
    if (aPlz.value.length === 5) abholSuchen(true);
  });
  aPlz.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); abholSuchen(false); } });
  aSuchKnopf.addEventListener("click", function () { abholSuchen(false); });
  aKarteKnopf.addEventListener("click", function () { abhol.karte = !abhol.karte; abhol.zoom = 0; karteZeichnen(); });
  aManuellKnopf.addEventListener("click", function () { manuellZeigen(aManuell.hidden); if (!aManuell.hidden) mNummer.focus(); });
  mKnopf.addEventListener("click", manuellUebernehmen);
  [mNummer, mOrt].forEach(function (x) { x.addEventListener("input", function () { feldFehler(x, ""); }); });
  mNummer.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); manuellUebernehmen(); } });
  mOrt.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); manuellUebernehmen(); } });
  aPost.addEventListener("input", function () { aPost.value = aPost.value.replace(/[^\d ]/g, "").slice(0, 14); feldFehler(aPost, ""); });
  // PLZ der Adresse: wird zur Suche uebernommen, solange dort nichts Eigenes steht.
  f.plz.addEventListener("input", function () {
    if (!(aPlz.dataset.auto !== "0" || !aPlz.value) || f.plz.value.length !== 5) return;
    aPlz.value = f.plz.value;
    aPlz.dataset.auto = "1";
    if (abhol.art === "abholort") abholSuchen(true);
  });

  function wohinSetzen(art) {
    abhol.art = art;
    if (art === "abholort") {
      if (!kannAbholen(zustand.wahl)) zustand.wahl = zustand.versand.optionen.filter(kannAbholen)[0] || zustand.wahl;
      if (!aPlz.value && /^\d{5}$/.test(f.plz.value)) { aPlz.value = f.plz.value; aPlz.dataset.auto = "1"; }
    }
    versandZeichnen();
    if (art === "abholort") abholSuchen(true);
  }

  // Was an den Server geht: Packstation/Filiale mit Nummer, PLZ und Ort.
  function zustellungDaten() {
    if (!abholung() || !abhol.ort) return null;
    var o = abhol.ort;
    var daten = { art: o.typ, abholort: { typ: o.typ, nummer: o.nummer, name: o.name, strasse: o.strasse || "", plz: o.plz, ort: o.ort } };
    var post = aPost.value.replace(/\s+/g, "");
    if (post) daten.postnummer = post;
    return daten;
  }
  // Fuer Anzeige und E-Mail: die Anschrift, an die das Paket geht.
  function lieferziel() {
    var z = zustellungDaten();
    if (!z) return adresse();
    return { name: adresse().name, strasse: z.art === "packstation" ? "Packstation" : "Postfiliale", hausnummer: z.abholort.nummer,
      zusatz: z.postnummer ? "Postnummer " + z.postnummer : "", plz: z.abholort.plz, ort: z.abholort.ort, land: "DE" };
  }

  function adresse() {
    return {
      name: (f.vorname.value.trim() + " " + f.nachname.value.trim()).trim(),
      strasse: f.strasse.value.trim(),
      hausnummer: f.nummer.value.trim(),
      zusatz: f.zusatz.value.trim(),
      plz: f.plz.value.trim(),
      ort: f.ort.value.trim(),
      land: "DE"
    };
  }
  function pruefen() {
    var fehler = [];
    function pruef(feld, ok, text) { feldFehler(feld, ok ? "" : text); if (!ok) fehler.push(feld); }
    pruef(f.email, f.email.validity.valid && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(f.email.value.trim()), t("fehltEmail"));
    pruef(f.vorname, f.vorname.value.trim().length >= 1, t("fehltVorname"));
    pruef(f.nachname, f.nachname.value.trim().length >= 2, t("fehltNachname"));
    if (abholung()) {
      // Packstation/Filiale: Name und E-Mail genuegen, die Anschrift ist die des Abholorts.
      [f.plz, f.ort, f.strasse, f.nummer].forEach(function (x) { feldFehler(x, ""); });
      if (!abhol.ort) {
        abhol.fehler = "abholWaehlen";
        statusZeichnen();
        fehler.push(aListe.querySelector("input:not(:disabled)") || aPlz);
      }
      var post = aPost.value.replace(/\s+/g, "");
      var pflicht = !abhol.ort || abhol.ort.typ === "packstation";
      pruef(aPost, /^\d{6,10}$/.test(post) || (!post && !pflicht), post ? t("postnummerUngueltig") : t("fehltPostnummer"));
    } else {
      pruef(f.plz, /^\d{5}$/.test(f.plz.value), t("fehltPlz"));
      pruef(f.ort, f.ort.value.trim().length >= 2, t("fehltOrt"));
      var packstation = /packstation|postfiliale|postfach|paketshop/i.test(f.strasse.value + " " + f.zusatz.value);
      pruef(f.strasse, f.strasse.value.trim().length >= 2 && !packstation, packstation ? t("packstation") : t("fehltStrasse"));
      pruef(f.nummer, /^\d{1,5}\s?[a-zA-Z]?(?:\s?[-/]\s?\d{1,5}[a-zA-Z]?)?$/.test(f.nummer.value.trim()), t("fehltNummer"));
    }
    if (fehler.length) { melden(t("pruefen"), status); fehler[0].focus(); return false; }
    melden("", status);
    return true;
  }

  // ---- Bezahlen: PayPal oder, solange PayPal fehlt, Bestellung per E-Mail
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
        var e = new Error(daten.error || "HTTP_" + r.status);
        e.code = daten.error || ""; e.status = r.status; e.daten = daten;
        throw e;
      }
      return daten;
    });
  }
  function fehlerText(e) {
    var code = (e && (e.code || e.message)) || "";
    if (code === "RESERVATION_EXPIRED") return t("abgelaufen");
    if (code === "PAYMENT_CONFIRMATION_PENDING") return t("wirdGeprueft");
    if (/^VERSAND_/.test(code)) return t("versandGeaendert");
    if (code === "PACKSTATION_NICHT_MOEGLICH") return t("packstation");
    if (code === "ABHOLSTATION_NUR_DHL") return t("abholNurDhl");
    if (code === "POSTNUMMER_FEHLT") return t("fehltPostnummer");
    if (code === "POSTNUMMER_UNGUELTIG") return t("postnummerUngueltig");
    if (code === "ABHOLORT_UNVOLLSTAENDIG" || code === "ZUSTELLUNG_UNGUELTIG") return t("abholUnvollstaendig");
    if (code === "NUR_DEUTSCHLAND") return t("nurDe");
    if (code === "ADRESSE_UNVOLLSTAENDIG") return t("pruefen");
    if (code === "EMAIL_REQUIRED") return t("fehltEmail");
    if (/^TURNSTILE_|^schutz_/.test(code)) return t("botCheck");
    if (code === "RATE_LIMITED") return t("zuSchnell");
    if (code === "ITEM_UNAVAILABLE" || code === "ITEM_NOT_FOUND" || code === "PRICE_ON_REQUEST") return t("schonWeg");
    return t("fehler");
  }
  function sperren(bis) {
    if (zustand.versuch) zustand.versuch.ablauf = bis;
    versandZeichnen();
    Array.prototype.forEach.call($("kasseForm").elements, function (feld) { feld.readOnly = bis > Date.now(); });
    $("kKonto").disabled = bis > Date.now();
    sperrZeichnen();
    if (bis > Date.now()) setTimeout(function () { sperren(0); }, Math.min(bis - Date.now() + 500, 2147483000));
  }

  // zahlung: "RESERVIERT" (heute: PayPal reserviert, Abbuchung beim Versand)
  // oder "EINGEZOGEN" (Bestellung aus der Zeit vor der Umstellung).
  function danke(bestellNr, ids, zahlung) {
    try {
      var liste = JSON.parse(localStorage.getItem(CART_KEY) || "[]");
      localStorage.setItem(CART_KEY, JSON.stringify((Array.isArray(liste) ? liste : []).filter(function (id) { return ids.indexOf(Number(id)) < 0; })));
    } catch (e) { /* Warenkorb bleibt, der Server kennt die Stuecke als verkauft */ }
    $("kasseRaster").hidden = true;
    var box = el("div", "kasse-danke");
    box.setAttribute("tabindex", "-1");
    box.appendChild(el("h2", "", t("danke")));
    if (bestellNr) {
      var p = el("p", "", t("bestellnr") + " ");
      p.appendChild(el("strong", "", bestellNr));
      box.appendChild(p);
    }
    box.appendChild(el("p", "", t(zahlung === "EINGEZOGEN" ? "dankeTextEingezogen" : "dankeText")));
    var knoepfe = el("div", "kasse-danke__knoepfe");
    var konto = el("a", "kasse-knopf kasse-knopf--hell", t("konto")); konto.href = HOME + "konto/";
    var weiter = el("a", "kasse-knopf", t("weiter")); weiter.href = HOME;
    knoepfe.appendChild(konto); knoepfe.appendChild(weiter);
    box.appendChild(knoepfe);
    $("kasseRaster").parentNode.insertBefore(box, $("kasseRaster"));
    box.focus();
  }

  function paypalEinrichten() {
    var ziel = $("kasseZahlen");
    ziel.textContent = "";
    var knopf = el("div", "kasse-paypal");
    knopf.id = "kassePaypal";
    ziel.appendChild(knopf);
    ziel.appendChild(el("p", "d119-zahlart", t("zahlart")));
    var schutz = schutzLaden();
    schutz.then(function (S) { S.waechter(); }).catch(function () { /* meldet sich beim Klick */ });
    var bezahlSchluessel = {};
    var letzterFehler = "";

    var zahlung = {
      style: { shape: "rect", color: "black", layout: "vertical", label: "pay" },
      onClick: function (daten, actions) {
        if (!zustand.stuecke.length || !zustand.wahl) { melden(t(zustand.versand ? "versandWahlFehlt" : "versandFehlt"), status); return actions.reject(); }
        return pruefen() ? actions.resolve() : actions.reject();
      },
      createOrder: function () {
        letzterFehler = "";
        melden("", status);
        var wahl = zustand.wahl;
        var ids = zustand.stuecke.map(function (it) { return it.id; });
        var zustellung = zustellungDaten();
        var inhalt = { itemIds: ids, adresse: zustellung ? { name: adresse().name, land: "DE" } : adresse(), email: f.email.value.trim(),
          createAccount: $("kKonto").checked, versand: wahl.id, versandPreisCents: wahl.preisCents };
        if (zustellung) inhalt.zustellung = zustellung;
        var fingerabdruck = JSON.stringify(inhalt);
        return schutz.then(function (S) {
          // Neuer Schluessel, sobald sich der Inhalt aendert - derselbe
          // Schluessel mit anderem Inhalt waere eine andere Bestellung.
          if (!zustand.versuch || zustand.versuch.inhalt !== fingerabdruck ||
              (zustand.versuch.ablauf && Date.now() > zustand.versuch.ablauf - 60000)) {
            zustand.versuch = { schluessel: S.schluessel("create-order"), inhalt: fingerabdruck, ablauf: 0, bestellNr: "" };
          }
          return S.waechter().token();
        }).then(function (token) {
          var kopf = { "Content-Type": "application/json", "Idempotency-Key": zustand.versuch.schluessel };
          if (token) kopf["X-Turnstile-Token"] = token;
          return fetch(WORKER + "/create-order", { method: "POST", headers: kopf, body: JSON.stringify(inhalt) });
        }).then(antwortLesen).then(function (daten) {
          zustand.versuch.bestellNr = daten.orderNumber || "";
          sperren(Date.parse(daten.expiresAt) || 0);
          return daten.id;
        }).catch(function (e) {
          var code = (e && e.code) || "";
          if (!zustand.versuch || !zustand.versuch.ablauf) zustand.versuch = null;
          if (/^VERSAND_/.test(code) && e.daten && e.daten.versand) versandSetzen(e.daten.versand);
          if (code === "ITEM_UNAVAILABLE" || code === "ITEM_NOT_FOUND") artikelLaden();
          letzterFehler = fehlerText(e);
          throw e;
        });
      },
      onApprove: function (daten) {
        melden(t("abschliessen"), status);
        return schutz.then(function (S) {
          var schluessel = bezahlSchluessel[daten.orderID] || (bezahlSchluessel[daten.orderID] = S.schluessel("capture-order"));
          return fetch(WORKER + "/capture-order", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Idempotency-Key": schluessel },
            body: JSON.stringify({ orderId: daten.orderID })
          });
        }).then(antwortLesen).then(function (antwort) {
          melden("", status);
          danke(antwort.orderNumber || (zustand.versuch && zustand.versuch.bestellNr) || "", zustand.stuecke.map(function (it) { return Number(it.id); }), antwort.zahlung);
          zustand.versuch = null;
        }).catch(function (e) {
          if ((e && e.code) === "RESERVATION_EXPIRED") { zustand.versuch = null; sperren(0); }
          letzterFehler = fehlerText(e);
          throw e;
        });
      },
      onCancel: function () { melden(t("abgebrochen"), status); },
      onError: function () { melden(letzterFehler || t("fehler"), status); }
    };
    window.paypal.Buttons(zahlung).render("#kassePaypal");
    appleEinrichten(ziel, zahlung);
  }

  function appleEinrichten(ziel, zahlung) {
    // Ein Gutschein wird erst serverseitig beim Anlegen der PayPal-Bestellung
    // bewertet. Apple Pay darf davor keinen hoeheren Endbetrag anzeigen.
    try {
      if (localStorage.getItem(CODE_KEY)) {
        ziel.appendChild(el("p", "kasse-hinweis kasse-apple-coupon", t("appleCoupon")));
        return;
      }
    } catch (e) { /* ohne Gutschein fortfahren */ }
    // ApplePaySession gibt es in Safari - und mit Apples Skript (apple-pay-sdk.js)
    // auch in Chrome, Edge und Firefox: Dort bezahlt man per QR-Code mit dem iPhone.
    if (!window.paypal || typeof window.paypal.Applepay !== "function" ||
        !window.ApplePaySession || !window.ApplePaySession.canMakePayments()) return;
    var apple = window.paypal.Applepay();
    apple.config().then(function (cfg) {
      if (!cfg.isEligible) return;
      var host = el("div", "kasse-applepay");
      var button = document.createElement("apple-pay-button");
      button.setAttribute("buttonstyle", "black");
      button.setAttribute("type", "buy");
      button.setAttribute("locale", LANG === "de" ? "de-DE" : LANG === "fr" ? "fr-FR" : "en-US");
      host.appendChild(button);
      ziel.insertBefore(host, ziel.firstChild);
      button.addEventListener("click", function () {
        if (!zustand.stuecke.length || !zustand.wahl || !pruefen()) return;
        var total = (stueckeCents() + zustand.wahl.preisCents) / 100;
        var session;
        try {
          session = new window.ApplePaySession(4, {
            countryCode: cfg.countryCode,
            merchantCapabilities: cfg.merchantCapabilities,
            supportedNetworks: cfg.supportedNetworks,
            currencyCode: "EUR",
            requiredBillingContactFields: ["postalAddress"],
            total: { label: "DISORDER119", type: "final", amount: total.toFixed(2) }
          });
        } catch (e) { melden(t("fehler"), status); return; }
        session.onvalidatemerchant = function (event) {
          apple.validateMerchant({ validationUrl: event.validationURL, displayName: "DISORDER119" })
            .then(function (result) { session.completeMerchantValidation(result.merchantSession); })
            .catch(function () { session.abort(); melden(t("fehler"), status); });
        };
        session.onpaymentauthorized = function (event) {
          zahlung.createOrder().then(function (orderId) {
            return apple.confirmOrder({ orderId: orderId, token: event.payment.token,
              billingContact: event.payment.billingContact }).then(function () { return orderId; });
          }).then(function (orderId) {
            return zahlung.onApprove({ orderID: orderId });
          }).then(function () {
            session.completePayment(window.ApplePaySession.STATUS_SUCCESS);
          }).catch(function (err) {
            session.completePayment(window.ApplePaySession.STATUS_FAILURE);
            melden(fehlerText(err), status);
          });
        };
        session.begin();
      });
    }).catch(function () { /* Nicht berechtigter Haendler oder Geraet: PayPal bleibt verfuegbar. */ });
  }

  function anfrageEinrichten() {
    var ziel = $("kasseZahlen");
    ziel.textContent = "";
    ziel.appendChild(el("p", "kasse-hinweis", t("paypalBald")));
    if (!CFG.email) return;
    var knopf = el("button", "kasse-knopf kasse-knopf--hell kasse-knopf--breit", t("anfrage"));
    knopf.type = "button";
    knopf.addEventListener("click", function () {
      if (!zustand.stuecke.length || !pruefen()) return;
      var a = lieferziel();
      var zeilen = [t("mailGruss"), ""];
      zustand.stuecke.forEach(function (it) {
        zeilen.push("- " + (it.title || "") + (it.size ? " · " + t("groesse") + " " + it.size : "") + " · Art.-Nr. " + (it.article || it.id) + " · " + geld(Math.round(it.price * 100)));
      });
      zeilen.push("");
      if (zustand.wahl) zeilen.push(t("mailVersand") + ": " + versandName(zustand.wahl) + ", " + paketName(zustand.versand) + " – " + preisText(zustand.wahl.preisCents));
      zeilen.push(t("mailGesamt") + ": " + geld(stueckeCents() + (zustand.wahl ? zustand.wahl.preisCents : 0)));
      zeilen.push("", t("email") + ": " + f.email.value.trim(), t("mailAdresse") + ":", a.name, a.strasse + " " + a.hausnummer);
      if (a.zusatz) zeilen.push(a.zusatz);
      zeilen.push(a.plz + " " + a.ort, "Deutschland", "", t("mailFrage"));
      location.href = "mailto:" + CFG.email + "?subject=" + encodeURIComponent(t("betreff")) + "&body=" + encodeURIComponent(zeilen.join("\n"));
    });
    ziel.appendChild(knopf);
  }

  rechtZeichnen();
  artikelLaden().then(function () {
    if (!zustand.stuecke.length) return;
    if (PAYPAL_BEREIT && window.paypal && typeof window.paypal.Buttons === "function") paypalEinrichten();
    else anfrageEinrichten();
  });
})();

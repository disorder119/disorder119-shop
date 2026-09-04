"""Einzige, massgebliche Build-Pipeline fuer den Disorder119-Shop.

Eine Datenquelle (data/items.json) speist alles Weitere:
  data/items.json -> index.html            (aus index_template.html)
  data/items.json -> artikel/{id}.html      (236 Produktseiten)
  data/items.json -> sitemap.xml

Vorher lief das umgekehrt (regen_articles.py las die Artikeldaten aus dem
bereits erzeugten index.html zurueck) - fragil, weil index.html damit
gleichzeitig Ausgabe UND Datenquelle war. Jetzt gibt es nur noch eine
Richtung.

Nutzung: python build_site.py [--thumbs]
  --thumbs erzeugt zusaetzlich kleine WebP-Vorschaubilder fuer die
  Thumbnail-Leiste (assets/img/{ordner}/thumbs/{n}.webp). Das ist ein
  separater, laengerer Bildverarbeitungsschritt (PIL) und muss nur einmal
  bzw. nach neuen Fotos erneut laufen, nicht bei jeder Textaenderung.
"""
import hashlib
import html
import json
import re
import sys
from pathlib import Path

BASE = Path(__file__).parent
SITE_URL = "https://disorder119.com/"
DATA_PATH = BASE / "data" / "items.json"


def _asset_version(rel_path):
    # app.css/app.js liegen mit Cache-Control:max-age=600 (10 Minuten) aus -
    # ohne Cache-Busting sieht ein Browser, der die Seite kurz vor einem
    # Deploy schon offen hatte oder kurz danach neu laedt, bis zu 10 Minuten
    # lang die ALTE Datei, obwohl der neue Code laengst live ist (genau so
    # als "Mieten-Mieten-Zufall/Reihenfolge falsch"-Meldung aufgefallen,
    # obwohl der Fix bereits laenger deployt war). Der Query-Parameter aendert
    # sich nur, wenn sich der tatsaechliche Dateiinhalt aendert (Content-Hash
    # statt z.B. Build-Zeitstempel) - ein unveraenderter Deploy erzwingt so
    # keinen unnoetigen Re-Download.
    try:
        data = (BASE / rel_path).read_bytes()
    except FileNotFoundError:
        return "0"
    return hashlib.sha256(data).hexdigest()[:10]


APP_CSS_VERSION = _asset_version("assets/app.css")
APP_JS_VERSION = _asset_version("assets/app.js")
ARTICLE_CSS_VERSION = _asset_version("assets/article.css")
ARTICLE_JS_VERSION = _asset_version("assets/article.js")

# Jede dieser Seiten ist inhaltlich die Startseite (gleiches HTML/JS/CSS-Bundle),
# oeffnet beim Laden aber automatisch das passende Panel anhand von
# location.pathname (siehe index_template.html). So bekommt jede "Einstellung"
# eine echte, eigenstaendige, teilbare URL statt eines reinen JS-Modals.
# Slug bleibt sprachuebergreifend gleich (nur das Sprachpraefix davor
# aendert sich, z.B. /agb/ vs. /en/agb/) - eine vollstaendig uebersetzte
# URL-Struktur (z.B. /en/terms/) waere zwar denkbar, haette aber jede
# interne Verlinkung/Routing-Stelle verdoppelt, ohne einen SEO-Vorteil
# gegenueber dem Sprachpraefix allein zu bringen.
SPECIAL_PAGES = {
    "cart": {"de": "Warenkorb", "en": "Cart", "fr": "Panier"},
    "impressum": {"de": "Impressum", "en": "Legal Notice", "fr": "Mentions légales"},
    "agb": {"de": "AGB", "en": "Terms & Conditions", "fr": "CGV"},
    "datenschutz": {"de": "Datenschutz", "en": "Privacy Policy", "fr": "Politique de confidentialité"},
    "ueber-uns": {"de": "Über Disorder119", "en": "About Disorder119", "fr": "À propos de Disorder119"},
    "faq": {"de": "FAQ", "en": "FAQ", "fr": "FAQ"},
    # Frueher nur clientseitig ein-/ausgeblendeter Zustand auf derselben
    # Adresse (kein eigener Link, kein Direktaufruf, Browser-Zurueck sprang
    # dadurch unzuverlaessig hin und her) - jetzt echte, eigene Seiten wie
    # /cart/, mit denselben Vorteilen (direkt aufrufbar, teilbar, echter
    # Verlaufseintrag). Das Umschalten dorthin bleibt trotzdem schnell/ohne
    # Neuladen, weil app.js beim Klick per pushState navigiert (siehe
    # showSwipe()/showChaos()/showOutfit() in assets/app.js) - ein
    # Direktaufruf/Reload rendert dieselbe Seite ganz normal serverseitig.
    "match": {"de": "Match", "en": "Match", "fr": "Match"},
    "chaos": {"de": "Chaos", "en": "Chaos", "fr": "Chaos"},
    "baukasten": {"de": "Outfit-Baukasten", "en": "Outfit Builder", "fr": "Configurateur de tenues"},
    # Eigene Kategorie statt nur ein Button auf jeder Archiv-Kachel (frueher):
    # /mieten/ zeigt den Katalog wie das normale Archiv, aber mit
    # "Anfragen"-Button pro Stueck (RENTAL_CATALOG_MODE in assets/app.js)
    # und einer Einleitung inkl. Konditionen (MIETEN_INTRO_HTML oben) - nicht
    # mehr nur fuer Shooting/Musikvideo, sondern breiter (Film/Theater,
    # Redaktion, Event, privater Anlass).
    "mieten": {"de": "Mieten & Ausleihen", "en": "Rent & Borrow", "fr": "Location"},
}

# Diese drei zeigen exakt denselben Katalog wie die Archiv-Startseite, nur
# in einer anderen Ansicht/Interaktionsform - fuer Suchmaschinen ist die
# Startseite die kanonische Quelle dieser Produktdaten (dieselbe Logik wie
# bei ItemList-JSON-LD, das ebenfalls nur auf der Startseite steht).
CATALOG_VARIANT_SLUGS = {"match", "chaos", "baukasten", "mieten"}

# ---------------------------------------------------------------------------
# Mehrsprachigkeit: echte eigene URLs pro Sprache (/, /en/, /fr/) statt nur
# eines JS-Umschalters auf derselben Adresse - Voraussetzung dafuer, dass
# hreflang-Angaben ueberhaupt zulaessig sind (Google verlangt dafuer
# unterschiedliche URLs, nicht nur unterschiedlichen Client-Zustand).
# Deutsch bleibt an der Wurzel (kein "/de/"-Praefix) und ist zugleich der
# hreflang="x-default".
# ---------------------------------------------------------------------------
LANGS = ["de", "en", "fr"]


def lang_home(lang):
    return "/" if lang == "de" else "/" + lang + "/"


CATEGORY_TR = {
    "Jackets": {"de": "Jacken", "en": "Jackets", "fr": "Vestes"},
    "Coats": {"de": "Mäntel", "en": "Coats", "fr": "Manteaux"},
    "Tops": {"de": "Tops", "en": "Tops", "fr": "Hauts"},
    "Shirts": {"de": "Hemden/Shirts", "en": "Shirts", "fr": "Chemises/T-shirts"},
    "Knitwear": {"de": "Strickwaren", "en": "Knitwear", "fr": "Maille"},
    "Pants": {"de": "Hosen", "en": "Pants", "fr": "Pantalons"},
    "Skirts": {"de": "Röcke", "en": "Skirts", "fr": "Jupes"},
    "Dresses": {"de": "Kleider", "en": "Dresses", "fr": "Robes"},
    "Shoes": {"de": "Schuhe", "en": "Shoes", "fr": "Chaussures"},
    "Accessories": {"de": "Accessoires", "en": "Accessories", "fr": "Accessoires"},
    "Objects": {"de": "Objekte", "en": "Objects", "fr": "Objets"},
}
CONDITION_TR = {
    "Repariert": {"de": "Repariert", "en": "Repaired", "fr": "Réparé"},
    "Mit Defekt": {"de": "Mit Defekt", "en": "With defect", "fr": "Avec défaut"},
    "Gut": {"de": "Gut", "en": "Good", "fr": "Bon"},
    "Sehr gut": {"de": "Sehr gut", "en": "Very good", "fr": "Très bon"},
    "Zufriedenstellend": {"de": "Zufriedenstellend", "en": "Satisfactory", "fr": "Satisfaisant"},
}
SIZE_TR = {
    "Einheitsgröße": {"de": "Einheitsgröße", "en": "One size", "fr": "Taille unique"},
    "verstellbar": {"de": "verstellbar", "en": "adjustable", "fr": "réglable"},
    "Größenverstellbar": {"de": "verstellbar", "en": "adjustable", "fr": "réglable"},
    "Kindergröße L": {"de": "Kindergröße L", "en": "Kids' size L", "fr": "Taille enfant L"},
    "Sonstige": {"de": "Sonstige", "en": "Other", "fr": "Autre"},
}


def _tr(table, key, lang):
    entry = table.get(key)
    if not entry:
        return key or ""
    return entry.get(lang) or entry.get("de") or ""


def cat_tr(cat, lang):
    return _tr(CATEGORY_TR, cat, lang)


def cond_tr(cond, lang):
    return _tr(CONDITION_TR, cond, lang)


def size_tr(size, lang):
    return _tr(SIZE_TR, size, lang)


META_PHRASES = {
    "de": {
        "sold": "{name} – bereits verkauft, Teil des kuratierten Disorder119-Archivs für Designer- und Vintage-Mode.",
        "size_label": "Größe", "condition_label": "Zustand", "no_brand": "Ohne Marke",
        "price_on_request": "Preis auf Anfrage",
        "tail_suffix": ". Aus dem kuratierten Second-Hand-Archiv von Disorder119.",
        "auto_suffix": ". Aus dem kuratierten Archiv von Disorder119.",
        "home_title": "Disorder119 — Archiv-Katalog",
        "home_desc": "Kuratiertes Archiv für Designer-Mode aus zweiter Hand: Prada, Dior, Jean Paul Gaultier, Yves Saint Laurent u.v.m. Jedes Stück handverlesen, einzeln fotografiert und genau beschrieben.",
    },
    "en": {
        "sold": "{name} – already sold, part of the curated Disorder119 archive for designer and vintage fashion.",
        "size_label": "Size", "condition_label": "Condition", "no_brand": "No brand",
        "price_on_request": "Price on request",
        "tail_suffix": ". From the curated second-hand archive of Disorder119.",
        "auto_suffix": ". From the curated archive of Disorder119.",
        "home_title": "Disorder119 — Curated Archive",
        "home_desc": "Curated archive of pre-owned designer fashion: Prada, Dior, Jean Paul Gaultier, Yves Saint Laurent and more. Every piece hand-picked, individually photographed and precisely described.",
    },
    "fr": {
        "sold": "{name} – déjà vendu, fait partie de l'archive sélectionnée Disorder119 pour la mode de créateurs et vintage.",
        "size_label": "Taille", "condition_label": "État", "no_brand": "Sans marque",
        "price_on_request": "Prix sur demande",
        "tail_suffix": ". Issu de l'archive seconde main sélectionnée de Disorder119.",
        "auto_suffix": ". Issu de l'archive sélectionnée de Disorder119.",
        "home_title": "Disorder119 — Archive Sélectionnée",
        "home_desc": "Archive sélectionnée de mode de créateurs de seconde main : Prada, Dior, Jean Paul Gaultier, Yves Saint Laurent et bien plus. Chaque pièce choisie à la main, photographiée individuellement et décrite avec précision.",
    },
}

LEGAL_CONTENT_HTML = {
    "legalImpressumHtml": {
        "de": '<h2>Impressum</h2><p>Angaben gemäß § 5 DDG</p><p>Joel Bittner<br>Disorder119 (Einzelunternehmen)<br>Nelseestraße 25<br>63739 Aschaffenburg<br>Deutschland</p><h3>Kontakt</h3><p>E-Mail: {email}</p><h3>Umsatzsteuer</h3><p>Kleinunternehmer gemäß § 19 UStG — es wird keine Umsatzsteuer ausgewiesen.</p><h3>Verantwortlich für den Inhalt nach § 18 Abs. 2 MStV</h3><p>Joel Bittner (Anschrift wie oben)</p><h3>Streitschlichtung</h3><p>Wir sind nicht verpflichtet und nicht bereit, an Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle teilzunehmen.</p>',
        "en": '<h2>Legal notice</h2><p>This page is translated for convenience — the German version above is the legally binding one.</p><p>Information pursuant to § 5 DDG (German Digital Services Act)</p><p>Joel Bittner<br>Disorder119 (sole proprietorship)<br>Nelseestraße 25<br>63739 Aschaffenburg<br>Germany</p><h3>Contact</h3><p>E-mail: {email}</p><h3>VAT</h3><p>Small business as per § 19 UStG (German VAT Act) — no VAT is shown.</p><h3>Responsible for content pursuant to § 18 (2) MStV</h3><p>Joel Bittner (address as above)</p><h3>Dispute resolution</h3><p>We are neither obliged nor willing to take part in dispute resolution proceedings before a consumer arbitration board.</p>',
        "fr": "<h2>Mentions légales</h2><p>Cette page est traduite par courtoisie — la version allemande ci-dessus fait foi juridiquement.</p><p>Informations selon le § 5 DDG (loi allemande sur les services numériques)</p><p>Joel Bittner<br>Disorder119 (entreprise individuelle)<br>Nelseestraße 25<br>63739 Aschaffenburg<br>Allemagne</p><h3>Contact</h3><p>E-mail : {email}</p><h3>TVA</h3><p>Micro-entreprise selon le § 19 UStG (loi allemande sur la TVA) — la TVA n'est pas indiquée.</p><h3>Responsable du contenu selon le § 18 al. 2 MStV</h3><p>Joel Bittner (adresse ci-dessus)</p><h3>Règlement des litiges</h3><p>Nous ne sommes ni tenus ni disposés à participer à une procédure de règlement des litiges devant un organisme de médiation de la consommation.</p>",
    },
    "legalAgbHtml": {
        "de": '<h2>Allgemeine Geschäftsbedingungen</h2><h3>1. Geltungsbereich</h3><p>Diese Bedingungen gelten für Kaufanfragen über diese Website zwischen Joel Bittner (Disorder119) und Kundinnen und Kunden.</p><h3>2. Zustandekommen des Vertrags</h3><p>Über den Warenkorb kann eine unverbindliche Anfrage per WhatsApp oder E-Mail gestellt werden. Ein Kaufvertrag kommt erst durch gesonderte Bestätigung (Verfügbarkeit, Preis, Zahlungs- und Versandart) zustande — nicht bereits durch das Absenden der Anfrage.</p><h3>3. Artikel</h3><p>Alle angebotenen Artikel sind gebrauchte Einzelstücke (Vintage / Second Hand). Kleine gebrauchsbedingte Abweichungen sind möglich und werden nach bestem Wissen in der Artikelbeschreibung angegeben.</p><h3>4. Preise &amp; Zahlung</h3><p>Alle Preise verstehen sich in Euro. Kleinunternehmer gemäß § 19 UStG, keine Umsatzsteuer ausgewiesen. Zahlungs- und Versandart werden individuell vereinbart.</p><h3>5. Gewährleistung</h3><p>Es gelten die gesetzlichen Gewährleistungsrechte. Da alle Artikel gebrauchte Einzelstücke sind, wird der Zustand nach bestem Wissen in der jeweiligen Artikelbeschreibung angegeben.</p><h3>6. Widerrufsbelehrung für Verbraucher:innen</h3><p><strong>Widerrufsrecht</strong><br>Du hast das Recht, binnen vierzehn Tagen ohne Angabe von Gründen diesen Vertrag zu widerrufen. Die Widerrufsfrist beträgt vierzehn Tage ab dem Tag, an dem du oder ein von dir benannter Dritter, der nicht der Beförderer ist, die Waren in Besitz genommen hast bzw. hat. Um dein Widerrufsrecht auszuüben, musst du uns (Joel Bittner, Disorder119, Nelseestraße 25, 63739 Aschaffenburg, E-Mail: {email}) mittels einer eindeutigen Erklärung (z.\xa0B. ein mit der Post versandter Brief oder eine E-Mail) über deinen Entschluss, diesen Vertrag zu widerrufen, informieren. Du kannst dafür das unten stehende Muster-Widerrufsformular verwenden, das ist jedoch nicht vorgeschrieben. Zur Wahrung der Widerrufsfrist reicht es aus, dass du die Mitteilung über die Ausübung des Widerrufsrechts vor Ablauf der Widerrufsfrist absendest.</p><p><strong>Folgen des Widerrufs</strong><br>Wenn du diesen Vertrag widerrufst, haben wir dir alle Zahlungen, die wir von dir erhalten haben, einschließlich der Lieferkosten (mit Ausnahme der zusätzlichen Kosten, die sich daraus ergeben, dass du eine andere Art der Lieferung als die von uns angebotene, günstigste Standardlieferung gewählt hast), unverzüglich und spätestens binnen vierzehn Tagen ab dem Tag zurückzuzahlen, an dem die Mitteilung über deinen Widerruf dieses Vertrags bei uns eingegangen ist. Für diese Rückzahlung verwenden wir dasselbe Zahlungsmittel, das du bei der ursprünglichen Transaktion eingesetzt hast, es sei denn, mit dir wurde ausdrücklich etwas anderes vereinbart; in keinem Fall werden dir wegen dieser Rückzahlung Entgelte berechnet. Wir können die Rückzahlung verweigern, bis wir die Waren wieder zurückerhalten haben oder bis du den Nachweis erbracht hast, dass du die Waren zurückgesandt hast, je nachdem, welches der frühere Zeitpunkt ist. Du hast die Waren unverzüglich und in jedem Fall spätestens binnen vierzehn Tagen ab dem Tag, an dem du uns über den Widerruf dieses Vertrags unterrichtest, an uns zurückzusenden oder zu übergeben. Die Frist ist gewahrt, wenn du die Waren vor Ablauf der Frist von vierzehn Tagen absendest. Du trägst die unmittelbaren Kosten der Rücksendung der Waren. Du musst für einen etwaigen Wertverlust der Waren nur aufkommen, wenn dieser Wertverlust auf einen zur Prüfung der Beschaffenheit, Eigenschaften und Funktionsweise der Waren nicht notwendigen Umgang mit ihnen zurückzuführen ist.</p><p><strong>Muster-Widerrufsformular</strong><br>(Wenn du den Vertrag widerrufen willst, dann fülle bitte dieses Formular aus und sende es zurück.)</p><p>An: Joel Bittner, Disorder119, Nelseestraße 25, 63739 Aschaffenburg, E-Mail: {email}<br>Hiermit widerrufe(n) ich/wir (*) den von mir/uns (*) abgeschlossenen Vertrag über den Kauf der folgenden Waren (*)/die Erbringung der folgenden Dienstleistung (*)<br>Bestellt am (*)/erhalten am (*)<br>Name des/der Verbraucher(s)<br>Anschrift des/der Verbraucher(s)<br>Unterschrift des/der Verbraucher(s) (nur bei Mitteilung auf Papier)<br>Datum<br>(*) Unzutreffendes streichen.</p>',
        "en": '<h2>Terms &amp; conditions</h2><p>This page is translated for convenience — the German version is the legally binding one.</p><h3>1. Scope</h3><p>These terms apply to purchase enquiries made via this website between Joel Bittner (Disorder119) and customers.</p><h3>2. Formation of contract</h3><p>A non-binding enquiry can be sent via WhatsApp or e-mail through the cart. A purchase contract is only formed once separately confirmed (availability, price, payment and shipping method) — not simply by sending the enquiry.</p><h3>3. Items</h3><p>All items offered are used one-off pieces (vintage / second-hand). Minor wear-related variations are possible and are noted to the best of our knowledge in the item description.</p><h3>4. Prices &amp; payment</h3><p>All prices are in euros. Small business as per § 19 UStG, no VAT shown. Payment and shipping method are agreed individually.</p><h3>5. Warranty</h3><p>Statutory warranty rights apply. As all items are used one-off pieces, condition is described to the best of our knowledge in the respective item description.</p><h3>6. Right of withdrawal for consumers</h3><p><strong>Right of withdrawal</strong><br>You have the right to withdraw from this contract within 14 days without giving any reason. The withdrawal period will expire 14 days from the day on which you, or a third party other than the carrier and indicated by you, acquire physical possession of the goods. To exercise the right of withdrawal, you must inform us (Joel Bittner, Disorder119, Nelseestraße 25, 63739 Aschaffenburg, Germany, e-mail: {email}) of your decision to withdraw from this contract by an unequivocal statement (e.g. a letter sent by post or e-mail). You may use the model withdrawal form below, but it is not obligatory. To meet the withdrawal deadline, it is sufficient for you to send your communication concerning the exercise of the right of withdrawal before the withdrawal period has expired.</p><p><strong>Effects of withdrawal</strong><br>If you withdraw from this contract, we shall reimburse all payments received from you, including delivery costs (except for the supplementary costs resulting from your choice of a delivery type other than the least expensive standard delivery offered by us), without undue delay and in any event not later than 14 days from the day on which we are informed about your decision to withdraw. We will use the same means of payment as you used for the initial transaction, unless expressly agreed otherwise; in any event, you will not incur any fees as a result of such reimbursement. We may withhold reimbursement until we have received the goods back, or you have supplied evidence of having sent back the goods, whichever is the earliest. You shall send back the goods without undue delay and in any event not later than 14 days from the day on which you communicate your withdrawal from this contract to us. The deadline is met if you send back the goods before the period of 14 days has expired. You will bear the direct cost of returning the goods. You are only liable for any diminished value of the goods resulting from handling other than what is necessary to establish the nature, characteristics and functioning of the goods.</p><p><strong>Model withdrawal form</strong><br>(Complete and return this form only if you wish to withdraw from the contract.)</p><p>To: Joel Bittner, Disorder119, Nelseestraße 25, 63739 Aschaffenburg, Germany, e-mail: {email}<br>I/We (*) hereby give notice that I/We (*) withdraw from my/our (*) contract for the sale of the following goods (*)/for the provision of the following service (*)<br>Ordered on (*)/received on (*)<br>Name of consumer(s)<br>Address of consumer(s)<br>Signature of consumer(s) (only if this form is notified on paper)<br>Date<br>(*) Delete as appropriate.</p>',
        "fr": "<h2>Conditions générales de vente</h2><p>Cette page est traduite par courtoisie — la version allemande fait foi juridiquement.</p><h3>1. Champ d'application</h3><p>Ces conditions s'appliquent aux demandes d'achat effectuées via ce site entre Joel Bittner (Disorder119) et les client(e)s.</p><h3>2. Formation du contrat</h3><p>Une demande sans engagement peut être envoyée par WhatsApp ou e-mail via le panier. Un contrat de vente n'est conclu qu'après confirmation séparée (disponibilité, prix, mode de paiement et d'expédition) — pas par le simple envoi de la demande.</p><h3>3. Articles</h3><p>Tous les articles proposés sont des pièces uniques d'occasion (vintage / seconde main). De légères variations liées à l'usage sont possibles et sont indiquées au mieux de notre connaissance dans la description de l'article.</p><h3>4. Prix &amp; paiement</h3><p>Tous les prix s'entendent en euros. Micro-entreprise selon le § 19 UStG, TVA non indiquée. Le mode de paiement et d'expédition est convenu individuellement.</p><h3>5. Garantie</h3><p>Les droits de garantie légaux s'appliquent. Tous les articles étant des pièces uniques d'occasion, leur état est décrit au mieux de notre connaissance dans la description de l'article concerné.</p><h3>6. Droit de rétractation des consommateurs</h3><p><strong>Droit de rétractation</strong><br>Tu disposes d'un délai de 14 jours pour te rétracter du présent contrat sans avoir à motiver ta décision. Le délai de rétractation expire 14 jours après le jour où toi, ou un tiers autre que le transporteur et désigné par toi, prend physiquement possession du bien. Pour exercer le droit de rétractation, tu dois nous notifier (Joel Bittner, Disorder119, Nelseestraße 25, 63739 Aschaffenburg, Allemagne, e-mail : {email}) ta décision de te rétracter du présent contrat au moyen d'une déclaration dénuée d'ambiguïté (par exemple lettre envoyée par la poste ou e-mail). Tu peux utiliser le formulaire type de rétractation ci-dessous, sans que cela soit obligatoire. Pour respecter le délai de rétractation, il suffit que tu transmettes ta communication relative à l'exercice du droit de rétractation avant l'expiration du délai de rétractation.</p><p><strong>Effets de la rétractation</strong><br>En cas de rétractation, nous te rembourserons tous les paiements reçus, y compris les frais de livraison (à l'exception des frais supplémentaires découlant du fait que tu as choisi un mode de livraison autre que le mode le moins coûteux de livraison standard proposé par nous), sans retard excessif et en tout état de cause au plus tard 14 jours à compter du jour où nous sommes informés de ta décision de te rétracter. Nous procéderons au remboursement en utilisant le même moyen de paiement que celui utilisé pour la transaction initiale, sauf accord exprès contraire ; en tout état de cause, ce remboursement ne t'occasionnera aucun frais. Nous pouvons différer le remboursement jusqu'à ce que nous ayons reçu le bien ou jusqu'à ce que tu aies fourni une preuve de l'expédition du bien, la date retenue étant celle du premier de ces faits. Tu devras renvoyer ou restituer les biens sans retard excessif et en tout état de cause au plus tard 14 jours après nous avoir communiqué ta décision de te rétracter. Ce délai est réputé respecté si tu renvoies le bien avant l'expiration du délai de 14 jours. Les frais directs de renvoi du bien sont à ta charge. Ta responsabilité n'est engagée qu'à l'égard de la dépréciation du bien résultant de manipulations autres que celles nécessaires pour établir la nature, les caractéristiques et le bon fonctionnement de ce bien.</p><p><strong>Formulaire type de rétractation</strong><br>(Veuillez compléter et renvoyer le présent formulaire uniquement si vous souhaitez vous rétracter du contrat.)</p><p>À l'attention de : Joel Bittner, Disorder119, Nelseestraße 25, 63739 Aschaffenburg, Allemagne, e-mail : {email}<br>Je/nous (*) vous notifie/notifions par la présente ma/notre (*) rétractation du contrat portant sur la vente du bien (*)/pour la prestation de service (*) ci-dessous<br>Commandé le (*)/reçu le (*)<br>Nom du (des) consommateur(s)<br>Adresse du (des) consommateur(s)<br>Signature du (des) consommateur(s) (uniquement en cas de notification du présent formulaire sur papier)<br>Date<br>(*) Rayez la mention inutile.</p>",
    },
    "legalDatenschutzHtml": {
        "de": '<h2>Datenschutzerklärung</h2><h3>Verantwortlicher</h3><p>Joel Bittner, Nelseestraße 25, 63739 Aschaffenburg — Kontakt siehe Impressum.</p><h3>Lokale Speicherung (localStorage)</h3><p>Warenkorb und Outfit-Baukasten speichern deine Auswahl ausschließlich lokal in deinem Browser (localStorage). Diese Daten werden nicht an uns oder Dritte übertragen und verlassen nie dein Gerät. Du kannst sie jederzeit über die Browser-Einstellungen löschen.</p><h3>Bestellanfragen</h3><p>Wenn du über WhatsApp oder E-Mail eine Anfrage sendest, werden die von dir eingegebenen Daten (z. B. Name, Nachricht) an den jeweiligen Dienst (WhatsApp/Meta bzw. deinen E-Mail-Anbieter) und an uns übermittelt, um deine Anfrage zu bearbeiten. Es findet keine Weitergabe an weitere Dritte statt.</p><h3>Hosting</h3><p>Diese Seite wird bei GitHub Pages (GitHub Inc.) gehostet. Beim Aufruf verarbeitet GitHub technisch notwendige Zugriffsdaten (u. a. IP-Adresse) zur Auslieferung der Seite. Näheres in der <a href="https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement" target="_blank" rel="noopener">Datenschutzerklärung von GitHub</a>.</p><h3>Keine Tracking-Cookies</h3><p>Diese Seite verwendet keine Analyse-, Marketing- oder Tracking-Cookies.</p>',
        "en": '<h2>Privacy policy</h2><p>This page is translated for convenience — the German version is the legally binding one.</p><h3>Controller</h3><p>Joel Bittner, Nelseestraße 25, 63739 Aschaffenburg, Germany — contact details in the legal notice.</p><h3>Local storage (localStorage)</h3><p>The cart and outfit builder save your selection exclusively locally in your browser (localStorage). This data is never transmitted to us or third parties and never leaves your device. You can delete it at any time via your browser settings.</p><h3>Order enquiries</h3><p>If you send an enquiry via WhatsApp or e-mail, the data you enter (e.g. name, message) is transmitted to the respective service (WhatsApp/Meta or your e-mail provider) and to us in order to process your enquiry. It is not passed on to any further third parties.</p><h3>Hosting</h3><p>This site is hosted on GitHub Pages (GitHub Inc.). GitHub technically processes access data required for delivery (including IP address). See the <a href="https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement" target="_blank" rel="noopener">GitHub privacy statement</a> for details.</p><h3>No tracking cookies</h3><p>This site does not use analytics, marketing or tracking cookies.</p>',
        "fr": '<h2>Politique de confidentialité</h2><p>Cette page est traduite par courtoisie — la version allemande fait foi juridiquement.</p><h3>Responsable</h3><p>Joel Bittner, Nelseestraße 25, 63739 Aschaffenburg, Allemagne — contact, voir mentions légales.</p><h3>Stockage local (localStorage)</h3><p>Le panier et le configurateur de tenues enregistrent ta sélection exclusivement en local dans ton navigateur (localStorage). Ces données ne sont jamais transmises à nous ou à des tiers et ne quittent jamais ton appareil. Tu peux les supprimer à tout moment via les réglages de ton navigateur.</p><h3>Demandes de commande</h3><p>Si tu envoies une demande par WhatsApp ou e-mail, les données que tu saisis (par ex. nom, message) sont transmises au service concerné (WhatsApp/Meta ou ton fournisseur e-mail) ainsi qu\'à nous, afin de traiter ta demande. Aucune transmission à d\'autres tiers n\'a lieu.</p><h3>Hébergement</h3><p>Ce site est hébergé sur GitHub Pages (GitHub Inc.). Lors de l\'accès, GitHub traite les données techniques nécessaires (dont l\'adresse IP) pour la mise à disposition du site. Plus de détails dans la <a href="https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement" target="_blank" rel="noopener">politique de confidentialité de GitHub</a>.</p><h3>Aucun cookie de suivi</h3><p>Ce site n\'utilise aucun cookie d\'analyse, marketing ou de suivi.</p>',
    },
}

INFO_CONTENT_HTML = {
    "aboutHtml": {
        "de": '<h2>Über Disorder119</h2><p>DISORDER119 ist ein unabhängig geführtes, kuratiertes Archiv für ausgewählte Designer-, Vintage- und Contemporary-Pieces mit Fokus auf Qualität, Authentizität und Zeitlosigkeit.</p><h3>Auswahl &amp; Dokumentation</h3><p>Jedes angebotene Stück wird einzeln ausgewählt, fotografiert und beschrieben. Da es sich überwiegend um gebrauchte Einzelstücke handelt, werden Zustand und erkennbare Besonderheiten nach bestem Wissen dokumentiert. Wenn zu einem Artikel Angaben fehlen oder du zusätzliche Detailfotos oder Maße brauchst, klären wir das vor dem Kauf.</p><h3>Transparent einkaufen</h3><p>Hinter Disorder119 steht Joel Bittner als Einzelunternehmer in Aschaffenburg. Anbieterangaben, Widerrufsbelehrung, Gewährleistungsinformationen und Datenschutz findest du jederzeit in Impressum, AGB und Datenschutz.</p>',
        "en": '<h2>About Disorder119</h2><p>DISORDER119 is an independently run, curated archive of selected designer, vintage and contemporary pieces with a focus on quality, authenticity and timelessness.</p><h3>Selection &amp; documentation</h3><p>Every listed piece is individually selected, photographed and described. As most pieces are pre-owned one-offs, condition and visible characteristics are documented to the best of our knowledge. If information is missing or you need additional detail photos or measurements, we clarify this before purchase.</p><h3>Transparent shopping</h3><p>Disorder119 is operated by Joel Bittner as a sole proprietor in Aschaffenburg, Germany. Seller information, withdrawal instructions, statutory warranty information and privacy details are available at all times in the legal notice, terms and privacy policy.</p>',
        "fr": '<h2>À propos de Disorder119</h2><p>DISORDER119 est une archive indépendante et sélectionnée de pièces de créateurs, vintage et contemporaines, axée sur la qualité, l’authenticité et l’intemporalité.</p><h3>Sélection &amp; documentation</h3><p>Chaque pièce proposée est sélectionnée, photographiée et décrite individuellement. La plupart étant des pièces uniques d’occasion, leur état et leurs particularités visibles sont documentés au mieux de notre connaissance. Si une information manque ou si tu souhaites des photos de détail ou des mesures supplémentaires, nous clarifions cela avant l’achat.</p><h3>Achat transparent</h3><p>Disorder119 est exploité par Joel Bittner en tant qu’entreprise individuelle à Aschaffenburg, en Allemagne. Les informations vendeur, le droit de rétractation, les droits de garantie légaux et les informations de confidentialité sont disponibles à tout moment dans les mentions légales, les CGV et la politique de confidentialité.</p>',
    },
    "faqHtml": {
        "de": '<h2>FAQ</h2><h3>Sind alle Artikel Einzelstücke?</h3><p>Ja. Alle verfügbaren Artikel sind kuratierte Einzelstücke. Deshalb kann ein Artikel nach Verkauf nicht erneut bestellt werden.</p><h3>Wie funktioniert eine Bestellung?</h3><p>Lege verfügbare Artikel in den Warenkorb und sende die Bestellanfrage über die angebotene Kontaktmöglichkeit. Die Anfrage ist zunächst unverbindlich. Verfügbarkeit, Gesamtpreis, Zahlungsart und Versand werden bestätigt; erst mit dieser Bestätigung kommt der Kaufvertrag zustande.</p><h3>Sind die Artikel neu?</h3><p>In der Regel nicht. Disorder119 ist ein Designer-, Vintage- und Second-Hand-Archiv. Zustand und erkennbare Besonderheiten werden nach bestem Wissen in den Produktangaben beschrieben.</p><h3>Was ist, wenn Angaben wie Größe, Zustand oder Maße fehlen?</h3><p>Dann solltest du vor dem Kauf nachfragen. Zusätzliche Maße, Detailfotos und produktbezogene Informationen können vor Vertragsabschluss geklärt werden.</p><h3>Wie wird mit Authentizität umgegangen?</h3><p>Authentizität ist Teil des Auswahlfokus von Disorder119. Eine Prüfung oder Zertifizierung durch den jeweiligen Markenhersteller oder einen externen Authentifizierungsdienst wird jedoch nur dann zugesichert, wenn dies beim konkreten Artikel ausdrücklich angegeben ist. Bei Fragen können zusätzliche Detailfotos angefragt werden.</p><h3>Kann ich widerrufen und welche Gewährleistung gilt?</h3><p>Für Verbraucher:innen gilt das gesetzliche 14-tägige Widerrufsrecht. Außerdem gelten die gesetzlichen Gewährleistungsrechte. Die vollständigen Bedingungen und die Widerrufsbelehrung findest du in den AGB.</p><h3>Wie werden meine Daten behandelt?</h3><p>Die Website verwendet keine Analyse-, Marketing- oder Tracking-Cookies. Warenkorb und Outfit-Baukasten werden lokal im Browser gespeichert. Details findest du in der Datenschutzerklärung.</p><h3>Warum bleiben verkaufte Artikel sichtbar?</h3><p>Verkaufte Pieces bleiben als Teil des DISORDER119-Archivs sichtbar und sind eindeutig als verkauft gekennzeichnet.</p>',
        "en": '<h2>FAQ</h2><h3>Is every item one of a kind?</h3><p>Yes. Every available item is a curated one-off piece, so an item cannot be ordered again once sold.</p><h3>How do orders work?</h3><p>Add available pieces to the cart and send an order enquiry through the available contact method. The enquiry is initially non-binding. Availability, total price, payment method and shipping are confirmed; the purchase contract is only formed with that confirmation.</p><h3>Are the items new?</h3><p>Usually not. Disorder119 is a designer, vintage and second-hand archive. Condition and visible characteristics are described in the product information to the best of our knowledge.</p><h3>What if size, condition or measurements are missing?</h3><p>Please ask before purchasing. Additional measurements, detail photos and product-specific information can be clarified before the contract is concluded.</p><h3>How is authenticity handled?</h3><p>Authenticity is part of Disorder119’s selection focus. Authentication or certification by the respective brand or an external authentication service is only promised when this is explicitly stated for the specific item. Additional detail photos can be requested if needed.</p><h3>Can I withdraw and what warranty applies?</h3><p>Consumers have the statutory 14-day right of withdrawal. Statutory warranty rights also apply. Full terms and withdrawal instructions are available in the terms and conditions.</p><h3>How is my data handled?</h3><p>The website does not use analytics, marketing or tracking cookies. The cart and outfit builder are stored locally in your browser. See the privacy policy for details.</p><h3>Why do sold pieces remain visible?</h3><p>Sold pieces remain visible as part of the DISORDER119 archive and are clearly marked as sold.</p>',
        "fr": '<h2>FAQ</h2><h3>Chaque article est-il unique ?</h3><p>Oui. Chaque article disponible est une pièce unique sélectionnée ; une fois vendu, il ne peut donc pas être commandé une seconde fois.</p><h3>Comment commander ?</h3><p>Ajoute les articles disponibles au panier et envoie une demande de commande via le moyen de contact proposé. La demande est d’abord sans engagement. La disponibilité, le prix total, le mode de paiement et l’expédition sont confirmés ; le contrat de vente n’est conclu qu’avec cette confirmation.</p><h3>Les articles sont-ils neufs ?</h3><p>En général non. Disorder119 est une archive de créateurs, vintage et seconde main. L’état et les particularités visibles sont décrits au mieux de notre connaissance dans les informations produit.</p><h3>Que faire si la taille, l’état ou les mesures manquent ?</h3><p>Merci de demander avant l’achat. Des mesures, photos de détail et informations spécifiques supplémentaires peuvent être clarifiées avant la conclusion du contrat.</p><h3>Comment l’authenticité est-elle traitée ?</h3><p>L’authenticité fait partie des critères de sélection de Disorder119. Une authentification ou certification par la marque concernée ou un service externe n’est toutefois garantie que si cela est expressément indiqué pour l’article concerné. Des photos de détail supplémentaires peuvent être demandées.</p><h3>Puis-je me rétracter et quelle garantie s’applique ?</h3><p>Les consommateurs disposent du droit légal de rétractation de 14 jours. Les droits de garantie légaux s’appliquent également. Les conditions complètes et les informations de rétractation figurent dans les CGV.</p><h3>Comment mes données sont-elles traitées ?</h3><p>Le site n’utilise aucun cookie d’analyse, de marketing ou de suivi. Le panier et le configurateur de tenues sont enregistrés localement dans le navigateur. Consulte la politique de confidentialité pour les détails.</p><h3>Pourquoi les articles vendus restent-ils visibles ?</h3><p>Les pièces vendues restent visibles dans l’archive DISORDER119 et sont clairement indiquées comme vendues.</p>',
    },
}

MIETEN_INTRO_HTML = {
    "de": (
        "<h2>Mieten &amp; Ausleihen</h2>"
        "<p>Jedes verfügbare Stück im Archiv kann auch geliehen statt gekauft werden — "
        "für Shootings, Musikvideos, Film- und Theaterproduktionen, redaktionelle Strecken, "
        "Events oder private Anlässe. Wähle unten ein Stück und sende eine unverbindliche "
        "Anfrage mit deinem Wunschzeitraum.</p>"
        "<h3>Wie die Miete funktiert</h3>"
        "<ul>"
        "<li><strong>Mietpreis:</strong> in der Regel ca. 15&nbsp;% des im Archiv angegebenen "
        "Preises pro Zeitraum von bis zu 4 Tagen (Richtwert — der genaue Preis wird bei jeder "
        "Anfrage persönlich bestätigt, abhängig von Stück und Zeitraum).</li>"
        "<li><strong>Kaution:</strong> wird bei Abholung/Versand hinterlegt und nach unbeschädigter, "
        "vollständiger Rückgabe innerhalb von 7 Tagen zurückerstattet.</li>"
        "<li><strong>Reinigung:</strong> normale Gebrauchsspuren und einfache Verschmutzungen sind "
        "im Mietpreis enthalten. Für die professionelle Reinigung nach der Nutzung wird ggf. eine "
        "Reinigungspauschale einbehalten.</li>"
        "<li><strong>Schäden:</strong> Reparable Schäden werden von der Kaution beglichen; bei nicht "
        "behebbaren Schäden oder Verlust wird der aktuelle Archivwert des Stücks fällig.</li>"
        "<li><strong>Zeitraum:</strong> Standard bis zu 4 Tage, längere Zeiträume auf Anfrage möglich.</li>"
        "<li>Alle Angaben sind unverbindlich und werden bei jeder Anfrage individuell bestätigt — "
        "dies ist kein automatisiertes Buchungssystem.</li>"
        "</ul>"
    ),
    "en": (
        "<h2>Rent &amp; Borrow</h2>"
        "<p>Every available piece in the archive can also be rented instead of bought — for shoots, "
        "music videos, film and theatre productions, editorial stories, events or personal occasions. "
        "Pick a piece below and send a non-binding request with your preferred dates.</p>"
        "<h3>How renting works</h3>"
        "<ul>"
        "<li><strong>Rental price:</strong> typically around 15% of the archive price per period of up "
        "to 4 days (a guideline — the exact price is confirmed personally for every request, depending "
        "on the piece and duration).</li>"
        "<li><strong>Deposit:</strong> collected at pickup/shipping and refunded after undamaged, "
        "complete return within 7 days.</li>"
        "<li><strong>Cleaning:</strong> normal wear and light soiling are included in the rental price. "
        "A cleaning fee may be withheld for professional cleaning after use.</li>"
        "<li><strong>Damage:</strong> repairable damage is settled from the deposit; for damage beyond "
        "repair or loss, the piece's current archive value becomes due.</li>"
        "<li><strong>Duration:</strong> up to 4 days by default, longer periods on request.</li>"
        "<li>All details are non-binding and confirmed individually for every request — this is not an "
        "automated booking system.</li>"
        "</ul>"
    ),
    "fr": (
        "<h2>Location</h2>"
        "<p>Chaque pièce disponible de l'archive peut aussi être louée plutôt qu'achetée — pour des "
        "shootings, clips musicaux, productions de film ou de théâtre, sujets éditoriaux, événements ou "
        "occasions privées. Choisis une pièce ci-dessous et envoie une demande sans engagement avec tes "
        "dates souhaitées.</p>"
        "<h3>Comment fonctionne la location</h3>"
        "<ul>"
        "<li><strong>Prix de location :</strong> environ 15&nbsp;% du prix indiqué dans l'archive par "
        "période de 4 jours maximum (indicatif — le prix exact est confirmé personnellement pour chaque "
        "demande, selon la pièce et la durée).</li>"
        "<li><strong>Caution :</strong> déposée au retrait/à l'envoi et remboursée après un retour complet "
        "et non endommagé sous 7 jours.</li>"
        "<li><strong>Nettoyage :</strong> l'usure normale et les salissures légères sont incluses dans le "
        "prix de location. Des frais de nettoyage professionnel peuvent être retenus après usage.</li>"
        "<li><strong>Dommages :</strong> les dommages réparables sont réglés via la caution ; en cas de "
        "dommage irréparable ou de perte, la valeur actuelle de la pièce dans l'archive est due.</li>"
        "<li><strong>Durée :</strong> 4 jours maximum par défaut, périodes plus longues sur demande.</li>"
        "<li>Toutes les informations sont sans engagement et confirmées individuellement pour chaque "
        "demande — il ne s'agit pas d'un système de réservation automatisé.</li>"
        "</ul>"
    ),
}

LEGAL_EMAIL_PENDING = {
    "de": 'wird nachgereicht, sobald der Shop live geht',
    "en": 'to be added once the shop goes live',
    "fr": 'sera ajoutée dès la mise en ligne de la boutique',
}

ITEMS = json.loads(DATA_PATH.read_text(encoding="utf-8"))

# Manche Marken im Rohbestand sind eigentlich Linien/Kollaborationen einer
# anderen Marke und sollen im Shop nicht als eigene Marke gezaehlt/gefiltert
# werden, sondern unter der Hauptmarke laufen. Der Titel behaelt den
# spezifischeren Namen (z.B. "Luna Rossa Sweatjacke"), nur das brand-Feld
# wird hier zentral normalisiert - wirkt dadurch ueberall (Kachel-Filter,
# Menue-Markenliste, "MEHR VON ..."-Vorschlaege, Markenzaehler im Header).
BRAND_ALIASES = {
    "Luna Rossa": "Prada",
    "Maison Margiela x H&M": "Maison Margiela",
    "Dior Homme": "Dior",
    "MM6 Maison Margiela": "Maison Margiela",
}
for _it in ITEMS:
    _alias = BRAND_ALIASES.get(_it.get("brand") or "")
    if _alias:
        _it["brand"] = _alias

BY_ID = {it["id"]: it for it in ITEMS}


def esc(s):
    return html.escape(s or "", quote=True)


def fmt_price_de(v):
    s = f"{v:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    return s + " €"


def display_name(it):
    brand = it.get("brand") or ""
    title = it.get("title") or ""
    if brand and title.lower().startswith(brand.lower()):
        return title
    return (brand + " " + title).strip()


def meta_description(it, lang):
    ph = META_PHRASES[lang]
    cat = cat_tr(it.get("category") or "", lang)
    cond = cond_tr(it.get("condition") or "", lang)
    name = display_name(it)
    if it.get("public_status") == "SOLD":
        return ph["sold"].format(name=name)
    tail = []
    if cat:
        tail.append(cat)
    if it.get("size"):
        tail.append(ph["size_label"] + " " + size_tr(it["size"], lang))
    if cond:
        tail.append(ph["condition_label"] + " " + cond)
    tail_str = ", ".join(tail)
    if tail_str:
        return name + " – " + tail_str + ph["tail_suffix"]
    return name + ph["tail_suffix"]


def auto_description(it, lang):
    ph = META_PHRASES[lang]
    facts = []
    if it.get("category"):
        facts.append(cat_tr(it["category"], lang))
    if it.get("size"):
        facts.append(ph["size_label"] + " " + size_tr(it["size"], lang))
    if it.get("condition"):
        facts.append(ph["condition_label"] + " " + cond_tr(it["condition"], lang))
    name = display_name(it)
    tail = (" – " + ", ".join(facts)) if facts else ""
    return name + tail + ph["auto_suffix"]


# ---------------------------------------------------------------------------
# Related items (Task 4 Fix): zwei GETRENNTE Gruppen statt einer vermischten
# Liste - "MORE FROM BRAND" darf ausschliesslich exakt dieselbe Marke zeigen.
# ---------------------------------------------------------------------------
def related_same_brand(it, n=4):
    others = [x for x in ITEMS if x["id"] != it["id"] and x.get("gallery") and x["gallery"][0]
              and x.get("brand") and x.get("brand") == it.get("brand")]
    others.sort(key=lambda x: (x.get("public_status") == "SOLD"))
    return others[:n]


def related_same_category(it, exclude_ids, n=4):
    others = [x for x in ITEMS if x["id"] != it["id"] and x["id"] not in exclude_ids
              and x.get("gallery") and x["gallery"][0]
              and x.get("category") == it.get("category")]
    others.sort(key=lambda x: (x.get("public_status") == "SOLD"))
    return others[:n]


def related_card_html(x, lang):
    ph = META_PHRASES[lang]
    sold = x.get("public_status") == "SOLD"
    if sold:
        price_html = '<span class="related-card__sold">SOLD</span>'
        price_line = ""
    else:
        price_html = ""
        price_line = (
            '<span class="related-card__price">' + fmt_price_de(x["price"]) + "</span>"
            if x.get("price", 0) > 0
            else '<span class="related-card__price" data-price-on-request>' + esc(ph["price_on_request"]) + '</span>'
        )
    href = lang_home(lang) + "artikel/" + str(x["id"]) + "/"
    return (
        '<a class="related-card" href="' + href + '">'
        '<div class="related-card__frame">'
        '<img src="/' + esc(x["gallery"][0]) + '" alt="" loading="lazy" />' +
        (price_html if sold else "") +
        "</div>"
        '<span class="related-card__brand">' + esc(x.get("brand") or ph["no_brand"]) + "</span>"
        '<span class="related-card__title">' + esc(x["title"]) + "</span>" +
        price_line +
        "</a>"
    )


def related_sections_html(it, lang):
    brand_items = related_same_brand(it)
    exclude = {it["id"]} | {b["id"] for b in brand_items}
    cat_items = related_same_category(it, exclude)
    parts = []
    if brand_items:
        parts.append(
            '<div class="related"><h2 class="related__title" data-related-heading="brand">'
            + esc("MEHR VON " + (it.get("brand") or "").upper()) + "</h2>"
            '<div class="related__grid">' + "".join(related_card_html(x, lang) for x in brand_items) + "</div></div>"
        )
    if cat_items:
        parts.append(
            '<div class="related"><h2 class="related__title" data-related-heading="category">ÄHNLICHE ARCHIVSTÜCKE</h2>'
            '<div class="related__grid">' + "".join(related_card_html(x, lang) for x in cat_items) + "</div></div>"
        )
    return "".join(parts)


def facts_html(it):
    facts = []
    if it.get("category"):
        facts.append(('factCategory', "Kategorie", "factCategoryValue", cat_tr(it["category"], "de")))
    if it.get("size"):
        facts.append(('factSize', "Größe", "factSizeValue", it["size"]))
    if it.get("color"):
        facts.append(('factColor', "Farbe", None, it["color"]))
    if it.get("condition"):
        facts.append(('factCondition', "Zustand", "factConditionValue", it["condition"]))
    out = []
    for i18n_key, label, value_id, value in facts:
        value_attr = f' id="{value_id}"' if value_id else ""
        out.append(
            '<div><div class="fact__label" data-i18n="' + i18n_key + '">' + esc(label) + "</div>"
            '<div class="fact__value"' + value_attr + ">" + esc(value) + "</div></div>"
        )
    art_no = it.get("article") or str(it["id"])
    out.append(
        '<div><div class="fact__label" data-i18n="factArticleNo">Artikelnummer</div>'
        '<div class="fact__value">' + esc(art_no) + "</div></div>"
    )
    return "".join(out)


def price_block_html(it):
    sold = it.get("public_status") == "SOLD"
    if sold:
        return '<div class="info__badge info__badge--sold">SOLD — DISORDER119 ARCHIVE</div>'
    if it.get("price_estimated"):
        return (
            '<div class="info__price">ca. ' + fmt_price_de(it["price"]) + "</div>"
            '<div class="info__badge info__badge--estimate">Preis wird geprüft</div>'
        )
    if it.get("price", 0) > 0:
        return '<div class="info__price">' + fmt_price_de(it["price"]) + "</div>"
    return '<div class="info__price">Preis auf Anfrage</div>'


def cta_html(it, shop_config, home, lang):
    sold = it.get("public_status") == "SOLD"
    if sold:
        return '<p class="info__note" id="soldNote">Dieses Stück ist bereits verkauft und bleibt als Teil des Disorder119-Archivs sichtbar.</p>'
    has_price = it.get("price", 0) > 0
    paypal_ready = (
        bool((shop_config.get("features") or {}).get("paypalCheckout"))
        and bool(shop_config.get("paypalClientId"))
        and bool(shop_config.get("shopWorkerUrl"))
    )
    parts = ['<div class="info__cta">']
    if has_price:
        parts.append('<button type="button" class="btn" id="addToCartBtn" data-i18n="addToCart">In den Warenkorb</button>')
    if has_price and paypal_ready:
        # Bleibt leer/unsichtbar, bis paypal_buy_button() in article.js den
        # echten PayPal-Button hineinrendert (siehe shop-worker/README.md).
        parts.append('<div id="paypalButtons" data-item-id="' + str(it["id"]) + '" data-price="' + f'{it["price"]:.2f}' + '"></div>')
    parts.append('<a class="btn btn--outline" id="inquireWhatsapp" target="_blank" rel="noopener" data-i18n="inquireWhatsapp">Anfrage per WhatsApp</a>')
    parts.append('<a class="btn btn--outline" id="inquireEmail" data-i18n="inquireEmail">Anfrage per E-Mail</a>')
    parts.append("</div>")
    # Verlinkt auf die eigene Mieten-Kategorie mit ?item=<id> - app.js
    # erkennt den Parameter beim Laden von /mieten/ und oeffnet die
    # Anfrage direkt fuer genau dieses Stueck (siehe showMieten() in
    # assets/app.js), statt nur auf die allgemeine Kategorie zu verweisen.
    # Vorher gab es auf der Produktseite selbst ueberhaupt keinen Hinweis
    # aufs Mieten - wer sich ein Stueck ansah, erfuhr nie, dass es auch
    # ausleihbar ist.
    parts.append(
        '<a class="btn btn--outline btn--rental" href="' + home + 'mieten/?item=' + str(it["id"])
        + '" data-i18n="rentalTeaser">Auch mietbar – Für Miete anfragen</a>'
    )
    trust_notes = {
        "de": "Einzelstück · individuell fotografiert · 14 Tage Widerrufsrecht für Verbraucher:innen · gesetzliche Gewährleistungsrechte. Zahlungs- und Versanddetails werden vor Vertragsschluss bestätigt.",
        "en": "One-off piece · individually photographed · 14-day statutory withdrawal right for consumers · statutory warranty rights. Payment and shipping details are confirmed before the contract is concluded.",
        "fr": "Pièce unique · photographiée individuellement · droit légal de rétractation de 14 jours pour les consommateurs · droits de garantie légaux. Les détails de paiement et d’expédition sont confirmés avant la conclusion du contrat.",
    }
    parts.append('<p class="info__note">' + esc(trust_notes.get(lang, trust_notes["de"])) + '</p>')
    if not shop_config["whatsappNumber"] and not shop_config["email"]:
        parts.append('<p class="info__config-warning" data-i18n="configWarning">Shop-Kontakt noch nicht eingerichtet: WhatsApp-Nummer oder E-Mail-Adresse fehlen in SHOP_CONFIG (index.html).</p>')
    return "".join(parts)


def json_ld(it, lang):
    sold = it.get("public_status") == "SOLD"
    url = SITE_URL.rstrip("/") + lang_home(lang) + "artikel/" + str(it["id"]) + "/"
    desc_field = {"de": it.get("desc_de") or it.get("desc"), "en": it.get("desc_en"), "fr": it.get("desc_fr")}[lang]
    data = {
        "@context": "https://schema.org",
        "@type": "Product",
        "name": it["title"],
        "url": url,
        "image": [SITE_URL + g for g in it.get("gallery") or []],
        "description": (desc_field or meta_description(it, lang))[:500],
        "sku": it.get("article") or str(it["id"]),
        "brand": {"@type": "Brand", "name": it.get("brand") or "Disorder119"},
        "seller": {"@type": "OnlineStore", "name": "Disorder119", "url": SITE_URL},
    }
    if not sold and it.get("price", 0) > 0:
        data["offers"] = {
            "@type": "Offer", "url": data["url"], "priceCurrency": "EUR",
            "price": f'{it["price"]:.2f}',
            "availability": "https://schema.org/InStock",
            "itemCondition": "https://schema.org/UsedCondition",
        }
    # SOLD-Artikel bekommen bewusst KEIN offers-Objekt (weder fuer verkaufte
    # noch fuer "Preis auf Anfrage"-Stuecke mit price==0): Google verlangt in
    # einem Offer zwingend price+priceCurrency - ein Offer ohne Preis ist ein
    # struktureller Fehler in der Search Console ("Missing field 'price'"),
    # kein gueltiger Zwischenzustand. Der alte Verkaufspreis eines
    # archivierten Stuecks soll ohnehin nicht mehr oeffentlich stehen, und
    # ein reines Product-Schema OHNE offers ist fuer sich genommen bereits
    # gueltiges Schema.org - kein Offer noetig, um ein Produkt zu beschreiben.
    return json.dumps(data, ensure_ascii=False)


def breadcrumb_json_ld(it, lang):
    home_url = SITE_URL.rstrip("/") + lang_home(lang)
    product_url = home_url + "artikel/" + str(it["id"]) + "/"
    labels = {"de": "Archiv", "en": "Archive", "fr": "Archive"}
    data = {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": labels.get(lang, "Archiv"), "item": home_url},
            {"@type": "ListItem", "position": 2, "name": display_name(it), "item": product_url},
        ],
    }
    return json.dumps(data, ensure_ascii=False)


def thumb_path(p):
    parts = p.rsplit("/", 1)
    if len(parts) != 2:
        return p
    return parts[0] + "/thumbs/" + parts[1]


def build_page(it, shop_config, lang):
    name = display_name(it)
    title_tag = name + " | Disorder119"
    desc = meta_description(it, lang)
    gallery = it.get("gallery") or []
    hero = gallery[0] if gallery else "assets/favicon.png"
    home = lang_home(lang)
    canonical = SITE_URL.rstrip("/") + home + "artikel/" + str(it["id"]) + "/"
    hreflang_links = "\n".join(
        '<link rel="alternate" hreflang="' + l + '" href="'
        + SITE_URL.rstrip("/") + lang_home(l) + "artikel/" + str(it["id"]) + '/">'
        for l in LANGS
    ) + '\n<link rel="alternate" hreflang="x-default" href="' + SITE_URL.rstrip("/") + lang_home("de") + "artikel/" + str(it["id"]) + '/">'
    sold = it.get("public_status") == "SOLD"
    paypal_sdk_tag = ""
    paypal_enabled = bool((shop_config.get("features") or {}).get("paypalCheckout"))
    if paypal_enabled and shop_config.get("paypalClientId") and shop_config.get("shopWorkerUrl") and not sold and it.get("price", 0) > 0:
        paypal_sdk_tag = (
            '<script src="https://www.paypal.com/sdk/js?client-id='
            + esc(shop_config["paypalClientId"]) + '&currency=EUR"></script>\n'
        )

    # ARTICLE_ITEM enthaelt bei SOLD-Artikeln bewusst KEINEN Preis (Task 2) -
    # article.js bekommt stattdessen nur sold:true und zeigt ausschliesslich
    # die Archiv-Kennzeichnung.
    article_data = {
        "id": it["id"],
        "article": it.get("article"),
        "title": it["title"],
        "brand": it.get("brand"),
        "size": it.get("size"),
        "color": it.get("color"),
        "condition": it.get("condition"),
        "category": it.get("category"),
        "desc": it.get("desc") or "",
        "desc_de": it.get("desc_de") or it.get("desc") or "",
        "desc_en": it.get("desc_en") or "",
        "desc_fr": it.get("desc_fr") or "",
        "gallery": gallery,
        "thumbs": [thumb_path(g) for g in gallery],
        "sold": sold,
        "priceEstimated": bool(it.get("price_estimated")) and not sold,
        "price": 0 if sold else it.get("price", 0),
    }

    return f"""<!DOCTYPE html>
<html lang="{lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{esc(title_tag)}</title>
<meta name="description" content="{esc(desc)}">
{'<meta name="robots" content="noindex,nofollow">' if it.get("public_status") == "DRAFT" else ""}
<link rel="canonical" href="{canonical}">
{hreflang_links}
<link rel="icon" type="image/png" href="/assets/favicon.png">
<link rel="stylesheet" href="/assets/article.css?v={ARTICLE_CSS_VERSION}">
<meta property="og:type" content="product">
<meta property="og:site_name" content="Disorder119">
<meta property="og:title" content="{esc(title_tag)}">
<meta property="og:description" content="{esc(desc)}">
<meta property="og:url" content="{canonical}">
<meta property="og:image" content="{SITE_URL}{esc(hero)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{esc(title_tag)}">
<meta name="twitter:description" content="{esc(desc)}">
<meta name="twitter:image" content="{SITE_URL}{esc(hero)}">
<script type="application/ld+json">{json_ld(it, lang)}</script>
<script type="application/ld+json">{breadcrumb_json_ld(it, lang)}</script>
</head>
<body>
<div class="page-head">
  <a class="page-head__brand" href="{home}">DISORDER119</a>
  <div class="page-head__right">
    <div class="lang-switch" id="langSwitch" role="group" aria-label="Sprache wählen">
      <a class="lang-switch__btn" data-lang="de" href="/artikel/{it['id']}/">DE</a>
      <a class="lang-switch__btn" data-lang="en" href="/en/artikel/{it['id']}/">EN</a>
      <a class="lang-switch__btn" data-lang="fr" href="/fr/artikel/{it['id']}/">FR</a>
    </div>
    <a class="page-head__back" href="{home}" data-i18n="backToArchive">← Zum Archiv</a>
    <a class="page-head__cart" id="pageHeadCart" href="{home}cart/"><span data-i18n="cartLink">Warenkorb</span><span class="page-head__cart-count" id="pageHeadCartCount"></span></a>
  </div>
</div>
<div class="product">
  <div class="gallery">
    <div class="gallery__stage">
      {'<span class="gallery__badge">SOLD</span>' if sold else ""}
      <img id="galleryMain" src="/{esc(hero)}" alt="{esc(name)}">
      <button type="button" class="gallery__nav gallery__nav--prev" id="galleryPrev" data-i18n-aria="prevPhotoAria" aria-label="Vorheriges Foto">‹</button>
      <button type="button" class="gallery__nav gallery__nav--next" id="galleryNext" data-i18n-aria="nextPhotoAria" aria-label="Nächstes Foto">›</button>
      <span class="gallery__counter" id="galleryCounter">1 / {max(len(gallery), 1)}</span>
    </div>
    <div class="gallery__thumbs" id="galleryThumbs"></div>
  </div>
  <div class="info">
    <a class="info__brand" href="{home}?brand={esc(it.get('brand') or '')}">{esc(it.get("brand") or "Ohne Marke")}</a>
    <h1>{esc(it["title"])}</h1>
    <div id="priceBlock">{price_block_html(it)}</div>
    <div class="info__facts">{facts_html(it)}</div>
    <p class="info__desc" id="itemDesc">{esc((it.get("desc_de") or it.get("desc") or "").strip() or auto_description(it, "de"))}</p>
    {cta_html(it, shop_config, home, lang)}
  </div>
</div>
{related_sections_html(it, lang)}
<div class="page-foot">
  <p data-i18n="footerNote">Disorder119 · Kuratiertes Archiv für Designer-, Vintage- und Contemporary-Mode. Jedes Stück wird einzeln ausgewählt, fotografiert und beschrieben.</p>
  <p><a href="{home}" data-i18n="footerFullArchive">Zum vollständigen Archiv</a></p>
</div>
<div class="lightbox" id="lightbox">
  <button type="button" class="lightbox__close" id="lightboxClose" data-i18n-aria="closeAria" aria-label="Schließen">✕</button>
  <img id="lightboxImg" src="" alt="">
</div>
{paypal_sdk_tag}<script>
  window.ARTICLE_ITEM = {json.dumps(article_data, ensure_ascii=False)};
  window.ARTICLE_SHOP_CONFIG = {json.dumps(shop_config, ensure_ascii=False)};
  window.ARTICLE_LANG = "{lang}";
</script>
<script src="/assets/article.js?v={ARTICLE_JS_VERSION}"></script>
</body>
</html>
"""


SHOP_CONFIG_PATH = BASE / "config" / "shop-config.json"


def get_shop_config():
    # Einzige Quelle fuer nicht-geheime Shop-Konfiguration (config/shop-config.json) -
    # wird identisch fuer Startseite (SHOP_CONFIG) und jede Produktseite
    # (ARTICLE_SHOP_CONFIG) verwendet. Vorher stand dieselbe Config als
    # JS-Literal doppelt im Code (einmal in index_template.html, einmal - nach
    # dem Monolith-Split - in assets/app.js) und ist genau dadurch schon einmal
    # auseinandergelaufen: get_shop_config() las weiter aus index_template.html,
    # obwohl die echten Werte laengst nur noch in app.js standen, wodurch jede
    # Produktseite eine leere Konfiguration bekam. Eine einzige Datei macht
    # dieses Auseinanderlaufen strukturell unmoeglich.
    if not SHOP_CONFIG_PATH.is_file():
        raise SystemExit(f"FEHLER: {SHOP_CONFIG_PATH} fehlt - Build abgebrochen.")
    raw = json.loads(SHOP_CONFIG_PATH.read_text(encoding="utf-8"))
    features_raw = raw.get("features") or {}
    if not isinstance(features_raw, dict):
        raise SystemExit(f"FEHLER: {SHOP_CONFIG_PATH} Feld 'features' muss ein Objekt sein.")
    environment = raw.get("environment") or "sandbox"
    if environment not in ("sandbox", "live"):
        raise SystemExit(f"FEHLER: {SHOP_CONFIG_PATH} environment muss 'sandbox' oder 'live' sein.")
    cfg = {
        "whatsappNumber": raw.get("whatsappNumber") or "",
        "email": raw.get("email") or "",
        "paypalClientId": raw.get("paypalClientId") or "",
        "shopWorkerUrl": raw.get("shopWorkerUrl") or "",
        "environment": environment,
        "features": {
            "paypalCheckout": bool(features_raw.get("paypalCheckout")),
            "customerAccounts": bool(features_raw.get("customerAccounts")),
        },
    }
    if cfg["features"]["paypalCheckout"] and (not cfg["paypalClientId"] or not cfg["shopWorkerUrl"]):
        raise SystemExit(
            "FEHLER: paypalCheckout=true, aber paypalClientId oder shopWorkerUrl fehlt. "
            "Checkout bleibt aus, bis die Sandbox-Konfiguration vollstaendig ist."
        )
    for secret_key in ("paypalClientSecret", "dhlApiSecret", "dpdApiSecret", "hermesApiSecret", "dbKey", "adminKey", "serviceRoleKey"):
        if raw.get(secret_key):
            raise SystemExit(
                f"FEHLER: {SHOP_CONFIG_PATH} enthaelt '{secret_key}' - Secrets duerfen "
                "niemals in der oeffentlichen Shop-Konfiguration stehen. Build abgebrochen."
            )
    return cfg


def validate_shop_contact_consistency(shop_config, articles_html_by_id):
    # Automatisierte Kontrolle fuer genau den Fehler, der frueher passiert ist:
    # der Hauptshop kennt eine Kontaktadresse, aber verfuegbare Produktseiten
    # zeigen "Shop-Kontakt noch nicht eingerichtet". Struktur allein verhindert
    # das jetzt schon (eine Quelle fuer beide Seiten), diese Pruefung faengt
    # zusaetzlich jede zukuenftige Regression ab, bevor sie deployt wird.
    has_contact = bool(shop_config["whatsappNumber"] or shop_config["email"])
    if not has_contact:
        return
    broken = [
        item_id for item_id, html in articles_html_by_id.items()
        if "info__config-warning" in html
    ]
    if broken:
        raise SystemExit(
            "FEHLER: Shop-Konfiguration hat eine Kontaktmoeglichkeit (E-Mail/WhatsApp), "
            f"aber {len(broken)} verfuegbare Produktseite(n) zeigen trotzdem die "
            "Konfigurationswarnung (kein Kontaktbutton). Betroffene Artikel-IDs: "
            f"{sorted(broken)[:10]}{'...' if len(broken) > 10 else ''}. Build abgebrochen."
        )


def item_list_jsonld(public_items, lang):
    home = SITE_URL.rstrip("/") + lang_home(lang)
    entries = [
        {"@type": "ListItem", "position": i + 1, "url": home + "artikel/" + str(it["id"]) + "/"}
        for i, it in enumerate(public_items)
    ]
    data = {"@context": "https://schema.org", "@type": "ItemList", "name": "Disorder119 — Archiv-Katalog", "itemListElement": entries}
    return json.dumps(data, ensure_ascii=False)


def hreflang_block(urls_by_lang):
    links = [f'<link rel="alternate" hreflang="{l}" href="{urls_by_lang[l]}">' for l in LANGS]
    links.append(f'<link rel="alternate" hreflang="x-default" href="{urls_by_lang["de"]}">')
    return "\n".join(links)


def legal_email_line(shop_config, lang):
    email = shop_config.get("email")
    if email:
        return '<a href="mailto:' + esc(email) + '">' + esc(email) + "</a>"
    return esc(LEGAL_EMAIL_PENDING[lang])


LEGAL_SLUG_KEY = {"impressum": "legalImpressumHtml", "agb": "legalAgbHtml", "datenschutz": "legalDatenschutzHtml"}
INFO_SLUG_KEY = {"ueber-uns": "aboutHtml", "faq": "faqHtml"}


def static_page_content_html(slug, lang, shop_config):
    # Echte, serverseitig gerenderte Seiteninhalte fuer Impressum/AGB/
    # Datenschutz/FAQ/Ueber-uns - direkter Aufruf dieser URLs enthaelt den
    # Text bereits im HTML, unabhaengig von JavaScript (vorher steckte dieser
    # Text ausschliesslich als JS-String in app.js und wurde erst nach dem
    # Laden in ein leeres Modal-Panel geschrieben - ohne JS war die Seite leer).
    if slug in LEGAL_SLUG_KEY:
        html = LEGAL_CONTENT_HTML[LEGAL_SLUG_KEY[slug]][lang]
        html = html.replace("{email}", legal_email_line(shop_config, lang))
    elif slug in INFO_SLUG_KEY:
        html = INFO_CONTENT_HTML[INFO_SLUG_KEY[slug]][lang]
    elif slug == "mieten":
        # Anders als bei den reinen Rechts-/Info-Seiten bleibt der Katalog
        # auf /mieten/ NICHT versteckt - dieser Text ist nur die Einleitung
        # oberhalb des (client-seitig nachgeladenen) Katalog-Grids in der
        # eigenen Mieten-Kategorie (siehe showMieten() in assets/app.js).
        html = MIETEN_INTRO_HTML[lang]
    else:
        return ""
    return '<div class="static-page"><div class="legal-panel">' + html + "</div></div>"


def render_bundle_page(lang, path_segment, title_tag, desc_text, shop_config,
                        include_item_list=False, robots=None, static_content=""):
    # Einzige Quelle fuer das Homepage-Bundle: wird sowohl fuer index.html
    # (path_segment="") als auch fuer /cart/, /impressum/ usw. verwendet -
    # inhaltlich dieselbe App-Shell (Katalog-JS, Warenkorb, Match/Chaos/
    # Baukasten), aber mit pro Seite unterschiedlichem SEO-Kopf und - bei den
    # rechtlichen/Info-Seiten - bereits serverseitig gerendertem Inhalt.
    tmpl = (BASE / "index_template.html").read_text(encoding="utf-8")
    urls_by_lang = {l: SITE_URL.rstrip("/") + lang_home(l) + path_segment for l in LANGS}
    canonical = urls_by_lang[lang]

    if include_item_list:
        public_items = [it for it in ITEMS if it.get("public_status") != "DRAFT"]
        item_list_block = '<script type="application/ld+json">' + item_list_jsonld(public_items, lang) + "</script>"
    else:
        item_list_block = ""

    out = tmpl
    out = out.replace("__ITEMLIST_JSONLD_BLOCK__", item_list_block)
    out = out.replace("__HTML_LANG__", lang)
    out = out.replace("__CANONICAL_URL__", canonical)
    out = out.replace("__HREFLANG_TAGS__", hreflang_block(urls_by_lang))
    out = out.replace("__META_TITLE__", esc(title_tag))
    out = out.replace("__META_DESC__", esc(desc_text))
    out = out.replace("__ROBOTS_META__", f'<meta name="robots" content="{robots}">' if robots else "")
    out = out.replace("__STATIC_PAGE_CONTENT__", static_content)
    out = out.replace("__SHOP_CONFIG_JSON__", json.dumps(shop_config, ensure_ascii=False))
    out = out.replace("__APP_CSS_VERSION__", APP_CSS_VERSION)
    out = out.replace("__APP_JS_VERSION__", APP_JS_VERSION)
    return out


def build_index():
    shop_config = get_shop_config()
    for lang in LANGS:
        ph = META_PHRASES[lang]
        out = render_bundle_page(lang, "", ph["home_title"], ph["home_desc"], shop_config, include_item_list=True)
        path = BASE / "index.html" if lang == "de" else BASE / lang / "index.html"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(out, encoding="utf-8")
    print(f"index.html + {len(LANGS) - 1} Sprachvarianten geschrieben.")


def build_special_pages():
    # /cart/, /impressum/, /agb/, /datenschutz/, /ueber-uns/, /faq/ - jede
    # davon bekommt eine echte, eigenstaendige, teilbare URL statt eines
    # reinen JS-Modals, und zwar in allen drei Sprachen. Warenkorb bleibt
    # bewusst nicht-indexierbar (kein oeffentlich relevanter Inhalt, individueller
    # Zustand), die rechtlichen/Info-Seiten sind normal indexierbar und
    # bekommen echten statischen Inhalt (siehe static_page_content_html()).
    shop_config = get_shop_config()
    n = 0
    for lang in LANGS:
        ph = META_PHRASES[lang]
        for slug, labels in SPECIAL_PAGES.items():
            label = labels[lang]
            title_tag = ("Disorder119 — " + label) if slug != "cart" else (label + " | Disorder119")
            robots = "noindex,follow" if slug == "cart" else None
            static_content = static_page_content_html(slug, lang, shop_config)
            out = render_bundle_page(
                lang, slug + "/", title_tag, ph["home_desc"], shop_config,
                include_item_list=False, robots=robots, static_content=static_content,
            )
            out_dir = (BASE / slug) if lang == "de" else (BASE / lang / slug)
            out_dir.mkdir(parents=True, exist_ok=True)
            (out_dir / "index.html").write_text(out, encoding="utf-8")
            n += 1
    print(f"{n} Sonderseiten geschrieben ({len(SPECIAL_PAGES)} x {len(LANGS)} Sprachen).")


def article_dir(lang, item_id):
    base = BASE if lang == "de" else BASE / lang
    return base / "artikel" / str(item_id)


def build_articles():
    shop_config = get_shop_config()
    count = 0
    de_pages_by_id = {}
    for it in ITEMS:
        for lang in LANGS:
            page = build_page(it, shop_config, lang)
            item_dir = article_dir(lang, it["id"])
            item_dir.mkdir(parents=True, exist_ok=True)
            (item_dir / "index.html").write_text(page, encoding="utf-8")
            if lang == "de" and it.get("public_status") != "SOLD":
                de_pages_by_id[it["id"]] = page
            count += 1
    validate_shop_contact_consistency(shop_config, de_pages_by_id)
    print(f"{count} Produktseiten geschrieben ({len(ITEMS)} Artikel x {len(LANGS)} Sprachen).")


def build_sitemap():
    # DRAFT-Artikel (unklarer interner Zwischenstatus) werden nicht indexiert -
    # ihre Seite existiert zwar (falls direkt aufgerufen), ist aber nirgends
    # verlinkt und soll auch nicht von Suchmaschinen als oeffentliches Angebot
    # gewertet werden. Der Warenkorb (/cart/) hat keinen eigenen, indexierbaren
    # Inhalt und wird bewusst nicht aufgenommen. Jede URL bekommt zusaetzlich
    # xhtml:link-Alternates fuer die jeweils anderen Sprachversionen - dasselbe
    # Signal wie die hreflang-<link>-Tags im <head>, nur fuer Crawler, die
    # direkt die Sitemap statt jede einzelne Seite auswerten.
    public_items = [it for it in ITEMS if it.get("public_status") != "DRAFT"]
    path_segments = (
        [""]
        + ["artikel/" + str(it["id"]) + "/" for it in public_items]
        + [slug + "/" for slug in SPECIAL_PAGES if slug != "cart"]
    )

    def url_entry(lang, segment):
        urls_by_lang = {l: SITE_URL.rstrip("/") + lang_home(l) + segment for l in LANGS}
        alt = "\n".join(
            f'    <xhtml:link rel="alternate" hreflang="{l}" href="{urls_by_lang[l]}"/>' for l in LANGS
        )
        alt += f'\n    <xhtml:link rel="alternate" hreflang="x-default" href="{urls_by_lang["de"]}"/>'
        return f"  <url>\n    <loc>{urls_by_lang[lang]}</loc>\n{alt}\n  </url>"

    entries = [url_entry(lang, seg) for seg in path_segments for lang in LANGS]
    body = "\n".join(entries)
    xml = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" '
        'xmlns:xhtml="http://www.w3.org/1999/xhtml">\n'
        f"{body}\n</urlset>\n"
    )
    (BASE / "sitemap.xml").write_text(xml, encoding="utf-8")
    print(f"sitemap.xml geschrieben ({len(entries)} URLs, {len(path_segments)} Seiten x {len(LANGS)} Sprachen).")


CATALOG_PATH = BASE / "data" / "catalog.json"

# Felder, die der Client (assets/app.js) tatsaechlich fuer Grid, Filter,
# Match-Modus, Chaos-Modus und Outfit-Baukasten braucht (per grep auf
# it.<feld> in assets/app.js verifiziert). desc/desc_de/desc_en/desc_fr
# fehlen bewusst - die werden nur auf der einzelnen Produktseite gebraucht
# (dort direkt von build_page() aus ITEMS gerendert, nicht ueber diese
# JSON-Datei), nicht fuer alle 237 Artikel im Grid-Payload.
CATALOG_FIELDS = [
    "id", "article", "title", "brand", "price", "price_estimated",
    "public_status", "status", "category", "size", "color", "condition",
    "brightness", "gallery", "look",
    # Optionaler, fester Mietpreis (siehe /mieten/) - branchenueblich zeigt
    # kein Vermieter dem Kunden eine Berechnung/Formel, sondern legt pro
    # Stueck einen festen Preis fest (Vorbild: Rent the Runway, By Rotation).
    # Fehlt das Feld, zeigt die Mieten-Seite stattdessen "Preis auf Anfrage" -
    # kein Zwang, sofort den gesamten Bestand zu befuellen.
    "rental_price",
]


def build_catalog_json():
    # Oeffentlicher Katalog fuer den Browser (assets/app.js laedt jetzt
    # /data/catalog.json statt /data/items.json). Zwei Gruende, warum das
    # eine eigene Datei sein muss statt einfach data/items.json direkt
    # auszuliefern: (1) DRAFT-Artikel duerfen nie ueber das Netzwerk
    # sichtbar sein, auch nicht im rohen JSON-Payload, bevor JS sie
    # herausfiltert - vorher waren sie das. (2) Markennormalisierung
    # (BRAND_ALIASES) passierte bisher nur im Python-Speicher fuer die
    # generierten HTML-Seiten, nie in der an den Browser ausgelieferten
    # items.json selbst - das Grid haette also unnormalisierte Markennamen
    # gesehen. catalog.json ist die einzige Quelle, die beides korrekt macht.
    public_items = [it for it in ITEMS if it.get("public_status") != "DRAFT"]
    catalog = [
        {k: it.get(k) for k in CATALOG_FIELDS if k in it}
        for it in public_items
    ]
    CATALOG_PATH.write_text(
        json.dumps(catalog, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    print(f"catalog.json geschrieben ({len(catalog)} Artikel, {len(ITEMS) - len(public_items)} DRAFT ausgeschlossen).")


def build_thumbs():
    from PIL import Image
    THUMB_SIZE = (220, 293)
    count = 0
    for it in ITEMS:
        for g in it.get("gallery") or []:
            src = BASE / g
            if not src.is_file():
                continue
            dest = BASE / thumb_path(g)
            dest.parent.mkdir(parents=True, exist_ok=True)
            if dest.is_file():
                continue
            with Image.open(src) as im:
                im = im.convert("RGBA")
                im.thumbnail(THUMB_SIZE, Image.LANCZOS)
                im.save(dest, format="WEBP", quality=78, method=4)
            count += 1
    print(f"{count} Thumbnails erzeugt.")


def clean_old_flat_article_files():
    # Umstellung von artikel/{id}.html auf artikel/{id}/index.html (echte,
    # erweiterungslose URLs) - alte flache Dateien vom vorherigen Schema
    # muessen weg, sonst blieben sie als toter, nie mehr aktualisierter
    # Datenstand im Repo liegen.
    out_dir = BASE / "artikel"
    if not out_dir.is_dir():
        return
    removed = 0
    for f in out_dir.glob("*.html"):
        f.unlink()
        removed += 1
    if removed:
        print(f"{removed} alte artikel/*.html (Vorgaenger-Schema) entfernt.")


def main():
    clean_old_flat_article_files()
    build_index()
    build_special_pages()
    build_articles()
    build_catalog_json()
    build_sitemap()
    if "--thumbs" in sys.argv:
        build_thumbs()


if __name__ == "__main__":
    main()

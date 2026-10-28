import { LEGAL_VERSION, CONTRACT_HTML, CONTRACT_HTML_EN, CONTRACT_HTML_FR } from "./legal-content.js";
// Transaktionsmails an Kundinnen und Kunden: Bestellbestaetigung, Versand,
// Anmeldelink fuers Kundenkonto.
//
// Die Bestellbestaetigung ist keine Hoeflichkeit, sondern Pflicht: § 312f BGB
// verlangt, dass der Vertrag samt Widerrufsbelehrung auf einem dauerhaften
// Datentraeger bestaetigt wird. Ein Link auf die AGB reicht dafuer nicht -
// deshalb steht die Belehrung vollstaendig im Text der Mail.
//
// Versand laeuft ueber Brevo (Sitz in Frankreich, Server in der EU). Das war
// eine bewusste Wahl gegen die US-Anbieter: so muss in der
// Datenschutzerklaerung keine Datenuebermittlung in die USA stehen.
import { safeText } from "./commerce-core.js";
import { invoiceProfile, renderInvoice } from './tax-invoice.js';
import { istSandbox, sandboxMail } from "./sandbox.js";
import { TAG_MS, kontingentBelegen } from "./kontingent.js";
import { linksEntschaerfen } from "./oeffentliche-mails.js";
import { landName } from "./laender.js";
import { katalogNachId } from "./oeffentlicher-katalog.js";

const BREVO_ENDPOINT = "https://api.brevo.com/v3/smtp/email";

// Testshop: api-test.disorder119.com ist oeffentlich, der Turnstile-
// Testschluessel laesst jede Anfrage durch, und Brevo zaehlt dasselbe
// Kontingent wie im echten Shop. Darum hoechstens so viele Mails am Tag
// (gezaehlt in D1, fuer alle Mails zusammen) - danach still keine mehr.
export const TESTSHOP_MAILS_JE_TAG = 20;

function testshopMailsJeTag(env) {
  const configured = Number(env?.TESTSHOP_MAIL_DAILY_CAP);
  return Number.isInteger(configured) && configured > 0 ? configured : TESTSHOP_MAILS_JE_TAG;
}

async function testshopMailFrei(env) {
  // Ohne Datenbank laesst sich nichts zaehlen - dann lieber keine Mail.
  if (!env?.DB) {
    console.warn(JSON.stringify({ level: "warn", event: "testshop_mail_no_database" }));
    return false;
  }
  const platz = await kontingentBelegen(env.DB, { art: "testshop-mail", gesamt: testshopMailsJeTag(env), gesamtFensterMs: TAG_MS });
  if (!platz.ok) console.warn(JSON.stringify({ level: "warn", event: "testshop_mail_daily_cap", cap: testshopMailsJeTag(env) }));
  return platz.ok;
}

// Muss Wort fuer Wort mit dem Impressum auf der Website uebereinstimmen.
// scripts/validate_shop.py vergleicht beide Stellen und bricht ab, wenn sie
// auseinanderlaufen - eine falsche Anbieterkennung in der Pflichtmail waere
// abmahnfaehig.
export const SELLER = {
  name: "Joel Bittner",
  brand: "Disorder119",
  street: "Nelseestraße 25",
  city: "63739 Aschaffenburg",
  country: "Deutschland",
  phone: "+49 152 0829 7741",
};

export const SHOP_URL = "https://disorder119.com";
// Widerrufsfunktion nach § 356a BGB ("Vertrag widerrufen").
export const WIDERRUF_URL = `${SHOP_URL}/widerruf/`;

// ---------------------------------------------------------------------------
// Sprachen
// ---------------------------------------------------------------------------
// Jede Mail an eine Kundin geht in der Sprache, in der sie eingekauft hat:
// commerce_orders.sprache (Migration 0043, gesetzt von der Kasse /, /en/,
// /fr/), beim Widerruf widerrufe.sprache, beim Anmeldelink die Sprache der
// Kontoseite. Rueckfall ist Deutsch; die deutschen Texte sind die bisherigen.
// Rechtstexte (AGB samt Widerrufsbelehrung) kommen nur aus der geprueften
// Quelle config/legal-content.json - die Uebersetzungen sagen selbst, dass die
// deutsche Fassung verbindlich ist, deshalb steht diese darunter mit in der Mail.
export const MAIL_SPRACHEN = Object.freeze(["de", "en", "fr"]);

export function mailSprache(wert) {
  const s = String(wert || "").trim().toLowerCase().slice(0, 2);
  return s === "en" || s === "fr" ? s : "de";
}

const LOCALE = Object.freeze({ de: "de-DE", en: "en-GB", fr: "fr-FR" });

// Shop-Seite in der Sprache der Mail: /konto/, /en/konto/, /fr/konto/.
export function shopLink(sprache, pfad = "") {
  const l = mailSprache(sprache);
  return `${SHOP_URL}/${l === "de" ? "" : `${l}/`}${String(pfad || "").replace(/^\/+/, "")}`;
}

// Texte, die in mehreren Mails vorkommen.
const ALLGEMEIN = Object.freeze({
  de: {
    archiv: "Kuratiertes Archiv für Designer-, Vintage- und Contemporary-Mode.",
    artNr: "Art.-Nr.",
    telefon: "Telefon",
    email: "E-Mail",
    versand: "Versand",
    kostenlos: "kostenlos",
    fragenMit: ["Fragen? Antworte einfach auf diese Mail oder schreib an ", "."],
    fragenOhne: "Fragen? Antworte einfach auf diese Mail.",
    rechnungDeutsch: "",
  },
  en: {
    archiv: "A curated archive of designer, vintage and contemporary fashion.",
    artNr: "Item no.",
    telefon: "Phone",
    email: "Email",
    versand: "Shipping",
    kostenlos: "free",
    fragenMit: ["Questions? Simply reply to this email or write to ", "."],
    fragenOhne: "Questions? Simply reply to this email.",
    rechnungDeutsch: "The invoice is issued in German.",
  },
  fr: {
    archiv: "Archive de mode designer, vintage et contemporaine.",
    artNr: "Réf.",
    telefon: "Téléphone",
    email: "E-mail",
    versand: "Livraison",
    kostenlos: "gratuite",
    fragenMit: ["Des questions ? Réponds simplement à cet e-mail ou écris à ", "."],
    fragenOhne: "Des questions ? Réponds simplement à cet e-mail.",
    rechnungDeutsch: "La facture est établie en allemand.",
  },
});

function allgemein(sprache) {
  return ALLGEMEIN[mailSprache(sprache)];
}

function fragenText(contactEmail, sprache) {
  const t = allgemein(sprache);
  return contactEmail ? `${t.fragenMit[0]}${contactEmail}${t.fragenMit[1]}` : t.fragenOhne;
}

// Namen der festen Versandtarife wie in der Kasse (assets/kasse.js).
const VERSAND_TITEL = Object.freeze({
  en: { "DHL Paket": "DHL Parcel", "DHL Paket mit Höherversicherung": "DHL Parcel with extra insurance",
    "DHL Paket EU": "DHL Parcel EU", "DHL Paket EU mit Höherversicherung": "DHL Parcel EU with extra insurance" },
  fr: { "DHL Paket": "DHL Colis", "DHL Paket mit Höherversicherung": "DHL Colis avec assurance complémentaire",
    "DHL Paket EU": "DHL Colis UE", "DHL Paket EU mit Höherversicherung": "DHL Colis UE avec assurance complémentaire" },
});

// Datum in der Sprache der Mail ("23.09.2026", "23 September 2026",
// "23 septembre 2026"), wie germanDate in UTC.
export function mailDatum(value, sprache = "de") {
  const l = mailSprache(sprache);
  if (l === "de") return germanDate(value);
  const date = value instanceof Date ? value : new Date(String(value || ""));
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(LOCALE[l], { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(date);
}

// Schwarzes DISORDER119-Mail-Design - dieselben Farben wie die Website und die
// Newsletter (mail-design.js nimmt sie von hier).
export const MAIL_FARBE = Object.freeze({
  grund: "#000000",
  flaeche: "#0d0d0d",
  text: "#f2efe7",
  leise: "#9c978d",
  linie: "#2b2a27",
});
const MAIL_SCHRIFT = "'Helvetica Neue',Helvetica,Arial,sans-serif";

// Rahmen der Kundenmails: Tabellen und Inline-Styles, weil Outlook und Gmail
// kein modernes CSS koennen. `vorschau` ist die Zeile, die das Postfach neben
// dem Betreff zeigt.
function kundenmailRahmen({ titel, eyebrow, kopf, inhalt, vorschau, sprache = "de" }) {
  const F = MAIL_FARBE;
  const l = mailSprache(sprache);
  return `<!DOCTYPE html>
<html lang="${l}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark">
<title>${escapeHtml(titel)}</title></head>
<body style="margin:0;padding:0;background:${F.grund};">
${vorschau ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${F.grund};">${escapeHtml(vorschau)}</div>` : ""}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${F.grund};">
<tr><td align="center" style="padding:0 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;font-family:${MAIL_SCHRIFT};color:${F.text};font-size:15px;line-height:1.55;">
  <tr><td align="center" style="padding:36px 0 26px;border-bottom:1px solid ${F.linie};">
    <a href="${shopLink(l)}" style="font-size:15px;font-weight:700;letter-spacing:0.34em;color:${F.text};text-decoration:none;">DISORDER119</a>
  </td></tr>
  <tr><td style="padding:40px 4px 6px;text-align:center;">
    <p style="margin:0 0 14px;font-size:11px;font-weight:700;letter-spacing:0.22em;text-transform:uppercase;color:${F.leise};">${escapeHtml(eyebrow)}</p>
    <h1 style="margin:0 0 16px;font-size:28px;line-height:1.15;font-weight:700;letter-spacing:-0.01em;text-transform:uppercase;color:${F.text};">${escapeHtml(titel)}</h1>
    ${kopf}
  </td></tr>
  ${inhalt}
  <tr><td style="padding:30px 4px 44px;border-top:1px solid ${F.linie};text-align:center;font-size:11px;line-height:1.6;color:${F.leise};">
    ${escapeHtml(allgemein(l).archiv)}<br>
    ${escapeHtml(SELLER.name)} — ${escapeHtml(SELLER.brand)}, ${escapeHtml(SELLER.street)}, ${escapeHtml(SELLER.city)}
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
}

function mailAbschnitt(ueberschrift, inhalt, rand = true) {
  const F = MAIL_FARBE;
  return `<tr><td style="padding:26px 4px 0;">
    <p style="margin:0 0 10px;padding-top:${rand ? "22px" : "0"};${rand ? `border-top:1px solid ${F.linie};` : ""}font-size:11px;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;color:${F.leise};">${escapeHtml(ueberschrift)}</p>
    ${inhalt}
  </td></tr>`;
}

function mailKnopf(href, label) {
  const F = MAIL_FARBE;
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;"><tr><td style="background:${F.text};">` +
    `<a href="${escapeHtml(href)}" style="display:inline-block;padding:15px 28px;font-family:${MAIL_SCHRIFT};font-size:13px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:${F.grund};text-decoration:none;">${escapeHtml(label)}</a>` +
    "</td></tr></table>";
}

// Titel eines Stuecks in der Sprache der Mail: Englisch, wenn der Katalog
// einen englischen Titel kennt (title_en, siehe artikelTitelUebersetzen),
// sonst der Titel aus der Bestellung.
function stueckTitel(item, sprache) {
  const englisch = mailSprache(sprache) === "en" ? safeText(item?.title_en || "", 180) : "";
  return englisch || safeText(item?.title_snapshot || item?.title || "Artikel", 180);
}

// Ein Stueck als Zeile: Foto (falls gespeichert), Titel, Art.-Nr., Preis.
function stueckZeile(item, preis, sprache = "de") {
  const F = MAIL_FARBE;
  const titel = escapeHtml(stueckTitel(item, sprache));
  const nr = escapeHtml(safeText(item.article_no || item.articleNo || "", 40));
  const pfad = safeText(item.bild || "", 200).replace(/^\/+/, "");
  const bild = /^assets\/img\/[A-Za-z0-9_\/.-]+$/.test(pfad)
    ? `<img src="${SHOP_URL}/${escapeHtml(pfad)}" width="64" alt="" style="display:block;width:64px;height:auto;border:0;background:${F.flaeche};">`
    : `<div style="width:64px;height:85px;background:${F.flaeche};"></div>`;
  return `<tr>
    <td width="78" valign="top" style="padding:14px 14px 14px 0;border-bottom:1px solid ${F.linie};">${bild}</td>
    <td valign="middle" style="padding:14px 0;border-bottom:1px solid ${F.linie};">
      <span style="display:block;font-size:15px;line-height:1.4;color:${F.text};">${titel}</span>
      ${nr ? `<span style="display:block;margin-top:4px;font-size:12px;color:${F.leise};">${escapeHtml(allgemein(sprache).artNr)} ${nr}</span>` : ""}
    </td>
    ${preis === null ? "" : `<td valign="middle" align="right" style="padding:14px 0 14px 12px;border-bottom:1px solid ${F.linie};white-space:nowrap;font-weight:700;">${escapeHtml(preis)}</td>`}
  </tr>`;
}

// "Versand · Standard (DPD)", solange die Kasse die Wahl gespeichert hat.
function versandBezeichnung(order, sprache = "de") {
  const l = mailSprache(sprache);
  const wort = allgemein(l).versand;
  const v = order.versand || {};
  const art = v.art === "express" ? "Express" : v.art === "standard" ? "Standard" : "";
  const carrier = safeText(v.carrier || "", 40);
  // Feste Tarife tragen den Namen der gewaehlten Option ("DHL Paket",
  // "DHL Paket mit Hoeherversicherung") - der sagt mehr als "Standard (DHL)".
  const name = safeText(v.service_name || v.serviceName || "", 60);
  const anzeige = (VERSAND_TITEL[l] && VERSAND_TITEL[l][name]) || name;
  if (name && carrier && name.toUpperCase().startsWith(carrier.toUpperCase())) return `${wort} · ${anzeige}`;
  if (!art) return wort;
  return `${wort} · ${art}${carrier ? ` (${carrier})` : ""}`;
}

// Ab 99 € Warenwert uebernimmt der Shop den Standardversand: dann
// "kostenlos" statt "0,00 €" (versand.js, versandkostenfrei).
function versandBetrag(cents, currency, sprache = "de") {
  return Number(cents) === 0 ? allgemein(sprache).kostenlos : euroAmount(cents, currency, sprache);
}

export function mailTransportReady(env = {}) {
  return Boolean(env.MAIL_API_KEY && env.MAIL_FROM);
}

export function mailSenderIdentity(env = {}) {
  const email = safeText(env.MAIL_FROM || "", 200).trim();
  const name = safeText(env.MAIL_FROM_NAME || "DISORDER119", 80).trim() || "DISORDER119";
  return { email, name };
}

export function normalizeEmail(value) {
  const raw = safeText(value || "", 200).trim().toLowerCase();
  // Bewusst streng: ein Zeichen vor dem @, ein Punkt danach, keine Leerzeichen.
  // Eine kaputte Adresse soll hier auffallen und nicht erst beim Versand.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(raw)) return "";
  return raw;
}

export function euroAmount(cents, currency = "EUR", sprache = "de") {
  const amount = Number(cents || 0) / 100;
  try {
    return new Intl.NumberFormat(LOCALE[mailSprache(sprache)], { style: "currency", currency: currency || "EUR" }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency || "EUR"}`;
  }
}

export function germanDate(value) {
  const date = value instanceof Date ? value : new Date(String(value || ""));
  if (Number.isNaN(date.getTime())) return "";
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${day}.${month}.${date.getUTCFullYear()}`;
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Anschrift des Verkaeufers; das Land in der Sprache der Mail (Impressum und
// SELLER bleiben deutsch).
function verkaeuferLand(sprache) {
  return mailSprache(sprache) === "de" ? SELLER.country : landName("DE", mailSprache(sprache));
}

function sellerBlockText(sprache = "de") {
  return [
    `${SELLER.name} — ${SELLER.brand}`,
    SELLER.street,
    SELLER.city,
    verkaeuferLand(sprache),
    `${allgemein(sprache).telefon}: ${SELLER.phone}`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Widerrufsbelehrung. Wortgleich zur AGB-Seite (build_site.py, Abschnitt 6).
// ---------------------------------------------------------------------------
export function widerrufsbelehrungText(contactEmail) {
  const anschrift = `${SELLER.name}, ${SELLER.brand}, ${SELLER.street}, ${SELLER.city}, Telefon: ${SELLER.phone}, E-Mail: ${contactEmail}`;
  return [
    "WIDERRUFSBELEHRUNG",
    "",
    "Widerrufsrecht",
    "Du hast das Recht, binnen vierzehn Tagen ohne Angabe von Gründen diesen Vertrag zu widerrufen. "
      + "Die Widerrufsfrist beträgt vierzehn Tage ab dem Tag, an dem du oder ein von dir benannter Dritter, "
      + "der nicht der Beförderer ist, die Waren in Besitz genommen hast bzw. hat. "
      + `Um dein Widerrufsrecht auszuüben, musst du uns (${anschrift}) mittels einer eindeutigen Erklärung `
      + "(z. B. ein mit der Post versandter Brief oder eine E-Mail) über deinen Entschluss, diesen Vertrag zu "
      + "widerrufen, informieren. "
      + `Du kannst dein Widerrufsrecht auch online unter ${WIDERRUF_URL} ausüben. Wenn du diese Online-Funktion `
      + "nutzt, übermitteln wir dir auf einem dauerhaften Datenträger (z. B. durch eine E-Mail) unverzüglich eine "
      + "Eingangsbestätigung mit Informationen zum Inhalt der Widerrufserklärung sowie dem Datum und der Uhrzeit ihres "
      + "Eingangs. Zur Wahrung der Widerrufsfrist reicht es aus, dass du die Mitteilung über die "
      + "Ausübung des Widerrufsrechts vor Ablauf der Widerrufsfrist absendest.",
    "",
    "Folgen des Widerrufs",
    "Wenn du diesen Vertrag widerrufst, haben wir dir alle Zahlungen, die wir von dir erhalten haben, "
      + "einschließlich der Lieferkosten (mit Ausnahme der zusätzlichen Kosten, die sich daraus ergeben, dass du "
      + "eine andere Art der Lieferung als die von uns angebotene, günstigste Standardlieferung gewählt hast), "
      + "unverzüglich und spätestens binnen vierzehn Tagen ab dem Tag zurückzuzahlen, an dem die Mitteilung über "
      + "deinen Widerruf dieses Vertrags bei uns eingegangen ist. Für diese Rückzahlung verwenden wir dasselbe "
      + "Zahlungsmittel, das du bei der ursprünglichen Transaktion eingesetzt hast, es sei denn, mit dir wurde "
      + "ausdrücklich etwas anderes vereinbart; in keinem Fall werden dir wegen dieser Rückzahlung Entgelte "
      + "berechnet. Wir können die Rückzahlung verweigern, bis wir die Waren wieder zurückerhalten haben oder bis "
      + "du den Nachweis erbracht hast, dass du die Waren zurückgesandt hast, je nachdem, welches der frühere "
      + "Zeitpunkt ist. Du hast die Waren unverzüglich und in jedem Fall spätestens binnen vierzehn Tagen ab dem "
      + "Tag, an dem du uns über den Widerruf dieses Vertrags unterrichtest, an uns zurückzusenden oder zu "
      + "übergeben. Die Frist ist gewahrt, wenn du die Waren vor Ablauf der Frist von vierzehn Tagen absendest. "
      + "Du trägst die unmittelbaren Kosten der Rücksendung der Waren. Du musst für einen etwaigen Wertverlust der "
      + "Waren nur aufkommen, wenn dieser Wertverlust auf einen zur Prüfung der Beschaffenheit, Eigenschaften und "
      + "Funktionsweise der Waren nicht notwendigen Umgang mit ihnen zurückzuführen ist.",
    "",
    "Muster-Widerrufsformular",
    "(Wenn du den Vertrag widerrufen willst, dann fülle bitte dieses Formular aus und sende es zurück.)",
    `An: ${anschrift}`,
    "Hiermit widerrufe(n) ich/wir (*) den von mir/uns (*) abgeschlossenen Vertrag über den Kauf der folgenden "
      + "Waren (*)/die Erbringung der folgenden Dienstleistung (*)",
    "Bestellt am (*)/erhalten am (*)",
    "Name des/der Verbraucher(s)",
    "Anschrift des/der Verbraucher(s)",
    "Unterschrift des/der Verbraucher(s) (nur bei Mitteilung auf Papier)",
    "Datum",
    "(*) Unzutreffendes streichen.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Bestellbestaetigung
// ---------------------------------------------------------------------------

function deliveryLines(contact = {}, sprache = "de") {
  const lines = [
    safeText(contact.recipient_name || contact.recipientName || "", 120),
    safeText(contact.address_line1 || contact.addressLine1 || "", 160),
    safeText(contact.address_line2 || contact.addressLine2 || "", 160),
    [safeText(contact.postal_code || contact.postalCode || "", 20), safeText(contact.city || "", 80)]
      .filter(Boolean).join(" "),
    // Land ausgeschrieben ("Frankreich", "France") - seit der EU-Kasse nicht mehr nur Deutschland.
    landName(safeText(contact.country_code || contact.countryCode || "", 4).toUpperCase(), mailSprache(sprache)),
  ];
  return lines.map(line => line.trim()).filter(Boolean);
}

// Vertragsbedingungen (AGB samt Widerrufsbelehrung und Muster-Formular) aus
// der geprueften Quelle config/legal-content.json, in der Sprache der Mail.
const VERTRAG_HTML = Object.freeze({ de: CONTRACT_HTML, en: CONTRACT_HTML_EN, fr: CONTRACT_HTML_FR });

function vertragAus(roh, contactEmail) {
  const html = roh.replaceAll("{email}", escapeHtml(contactEmail)).replaceAll('href="/', 'href="' + SHOP_URL + '/');
  const text = html.replace(/<br\s*\/?>(?:\s*)/gi, "\n").replace(/<\/(?:p|h[1-6])>/gi, "\n\n")
    .replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  return { html, text };
}

// options.zahlung: fehlt = sofort eingezogen (Rechnung steht in dieser Mail),
// "RESERVIERT" = PayPal hat nur reserviert, "EINGEZOGEN" = reserviert und
// inzwischen eingezogen. In beiden neuen Faellen kommt die Rechnung mit dem
// Einziehen (sendInvoiceAfterCapture) - ein Storno davor braucht keine.
export function contractInformation(contactEmail, sprache = "de") {
  const l = mailSprache(sprache);
  const { html, text } = vertragAus(VERTRAG_HTML[l] || CONTRACT_HTML, contactEmail);
  // Uebersetzungen sind ausdruecklich unverbindlich: die verbindliche deutsche
  // Fassung gehoert deshalb mit auf den dauerhaften Datentraeger.
  const verbindlich = l === "de" ? null : vertragAus(CONTRACT_HTML, contactEmail);
  return { html, text, version: LEGAL_VERSION, sprache: l, verbindlich };
}

const BESTELLUNG_TEXT = Object.freeze({
  de: {
    subject: n => `Deine Bestellung ${n} bei DISORDER119`,
    danke: (n, d) => `Danke für deine Bestellung ${n} vom ${d}.`,
    zahlungReserviert: "Deine Zahlung ist bei PayPal reserviert. Abgebucht wird erst, wenn wir dein Paket versenden – spätestens drei Tage nach deiner Bestellung. Mit dieser Bestätigung ist der Kaufvertrag geschlossen.",
    zahlungEingegangen: "Die Zahlung ist bei uns eingegangen. Damit ist der Kaufvertrag geschlossen.",
    zahlungEingegangenKopf: "Die Zahlung ist eingegangen — damit ist der Kaufvertrag geschlossen.",
    notizReserviert: "Die Rechnung schicken wir dir, sobald der Betrag eingezogen ist.",
    notizEingezogen: "Die Rechnung bekommst du in einer eigenen Mail.",
    notizRechnung: "Die folgende Rechnung gehört zu deiner Vertragsbestätigung.",
    notizOhneRechnung: "Dies ist deine Vertragsbestätigung. Eine Rechnung wird nach Klärung der Rechnungsangaben separat bereitgestellt.",
    zahlungsartReserviert: "Zahlungsart: PayPal – reserviert, Abbuchung mit dem Versand",
    zahlungsart: "Zahlungsart: PayPal",
    bestellung: "BESTELLUNG",
    zwischensumme: "Zwischensumme",
    gesamt: "Gesamt",
    lieferadresse: "Lieferadresse",
    wieWeiter: "Wie es weitergeht",
    weiter: mehrere => `${mehrere ? "Deine Stücke werden" : "Dein Teil wird"} von Hand verpackt und innerhalb von drei Werktagen versendet. Sobald das Paket unterwegs ist, bekommst du eine Mail mit der Sendungsnummer.`,
    weiterHtml: mehrere => `${mehrere ? "Deine Stücke werden" : "Dein Teil wird"} von Hand verpackt und innerhalb von drei Werktagen versendet. Sobald das Paket unterwegs ist, bekommst du eine Mail mit der Sendungsnummer und dem Link zur Sendungsverfolgung.`,
    weiterReserviert: " Mit dem Versand zieht PayPal den Betrag ein – dann kommt auch deine Rechnung.",
    kontoText: url => `Deine Bestellung im Konto: ${url}`,
    kontoKnopf: "Bestellung im Konto ansehen",
    verkaeufer: "Verkäufer",
    vertragText: v => `VERTRAGSINFORMATIONEN · Fassung ${v}`,
    vertragHtml: v => `Vertragsinformationen · Fassung ${v}`,
    verbindlich: "",
    onlinefassung: url => `Onlinefassung: ${url}`,
    alleBedingungen: "Alle Bedingungen: ",
    stuecke: n => n > 1 ? `Deine ${n} Stücke` : "Dein Stück",
    titel: "Danke für deine Bestellung",
    eyebrow: "Bestellbestätigung",
    kopf: (nr, d) => `Bestellung ${nr} vom ${d}`,
    vorschau: (n, anzahl, betrag) => `Bestellung ${n} · ${anzahl} ${anzahl === 1 ? "Stück" : "Stücke"} · ${betrag}`,
  },
  en: {
    subject: n => `Your order ${n} at DISORDER119`,
    danke: (n, d) => `Thank you for your order ${n} placed on ${d}.`,
    zahlungReserviert: "Your payment is reserved with PayPal. It is only charged when we ship your parcel – at the latest three days after your order. This confirmation concludes the purchase contract.",
    zahlungEingegangen: "We have received your payment. This concludes the purchase contract.",
    zahlungEingegangenKopf: "Your payment has been received — this concludes the purchase contract.",
    notizReserviert: "We’ll send you the invoice as soon as the amount has been charged.",
    notizEingezogen: "You’ll receive the invoice in a separate email.",
    notizRechnung: "The following invoice (issued in German) belongs to your contract confirmation.",
    notizOhneRechnung: "This is your contract confirmation. An invoice will be provided separately once the invoice details have been clarified.",
    zahlungsartReserviert: "Payment method: PayPal – reserved, charged when we ship",
    zahlungsart: "Payment method: PayPal",
    bestellung: "ORDER",
    zwischensumme: "Subtotal",
    gesamt: "Total",
    lieferadresse: "Delivery address",
    wieWeiter: "What happens next",
    weiter: mehrere => `${mehrere ? "Your pieces are" : "Your piece is"} packed by hand and shipped within three working days. As soon as the parcel is on its way, you’ll receive an email with the tracking number.`,
    weiterHtml: mehrere => `${mehrere ? "Your pieces are" : "Your piece is"} packed by hand and shipped within three working days. As soon as the parcel is on its way, you’ll receive an email with the tracking number and the tracking link.`,
    weiterReserviert: " PayPal charges the amount when we ship – your invoice follows then.",
    kontoText: url => `Your order in your account: ${url}`,
    kontoKnopf: "View order in your account",
    verkaeufer: "Seller",
    vertragText: v => `CONTRACT INFORMATION · Version ${v}`,
    vertragHtml: v => `Contract information · Version ${v}`,
    verbindlich: "Legally binding German version",
    onlinefassung: url => `Online version: ${url}`,
    alleBedingungen: "All terms: ",
    stuecke: n => n > 1 ? `Your ${n} pieces` : "Your piece",
    titel: "Thank you for your order",
    eyebrow: "Order confirmation",
    kopf: (nr, d) => `Order ${nr} placed on ${d}`,
    vorschau: (n, anzahl, betrag) => `Order ${n} · ${anzahl} ${anzahl === 1 ? "piece" : "pieces"} · ${betrag}`,
  },
  fr: {
    subject: n => `Ta commande ${n} chez DISORDER119`,
    danke: (n, d) => `Merci pour ta commande ${n} du ${d}.`,
    zahlungReserviert: "Ton paiement est réservé chez PayPal. Il n’est débité qu’à l’expédition de ton colis – au plus tard trois jours après ta commande. Cette confirmation conclut le contrat de vente.",
    zahlungEingegangen: "Nous avons bien reçu ton paiement. Le contrat de vente est ainsi conclu.",
    zahlungEingegangenKopf: "Ton paiement est bien arrivé — le contrat de vente est ainsi conclu.",
    notizReserviert: "Nous t’enverrons la facture dès que le montant aura été débité.",
    notizEingezogen: "Tu recevras la facture dans un e-mail séparé.",
    notizRechnung: "La facture ci-dessous (établie en allemand) fait partie de ta confirmation de contrat.",
    notizOhneRechnung: "Ceci est ta confirmation de contrat. Une facture te sera fournie séparément une fois les données de facturation clarifiées.",
    zahlungsartReserviert: "Moyen de paiement : PayPal – réservé, débité à l’expédition",
    zahlungsart: "Moyen de paiement : PayPal",
    bestellung: "COMMANDE",
    zwischensumme: "Sous-total",
    gesamt: "Total",
    lieferadresse: "Adresse de livraison",
    wieWeiter: "La suite",
    weiter: mehrere => `${mehrere ? "Tes articles sont emballés à la main et expédiés" : "Ton article est emballé à la main et expédié"} sous trois jours ouvrés. Dès que le colis est en route, tu reçois un e-mail avec le numéro de suivi.`,
    weiterHtml: mehrere => `${mehrere ? "Tes articles sont emballés à la main et expédiés" : "Ton article est emballé à la main et expédié"} sous trois jours ouvrés. Dès que le colis est en route, tu reçois un e-mail avec le numéro et le lien de suivi.`,
    weiterReserviert: " PayPal débite le montant à l’expédition – ta facture arrive à ce moment-là.",
    kontoText: url => `Ta commande dans ton compte : ${url}`,
    kontoKnopf: "Voir la commande dans ton compte",
    verkaeufer: "Vendeur",
    vertragText: v => `INFORMATIONS CONTRACTUELLES · Version ${v}`,
    vertragHtml: v => `Informations contractuelles · Version ${v}`,
    verbindlich: "Version allemande faisant foi",
    onlinefassung: url => `Version en ligne : ${url}`,
    alleBedingungen: "Toutes les conditions : ",
    stuecke: n => n > 1 ? `Tes ${n} articles` : "Ton article",
    titel: "Merci pour ta commande",
    eyebrow: "Confirmation de commande",
    kopf: (nr, d) => `Commande ${nr} du ${d}`,
    vorschau: (n, anzahl, betrag) => `Commande ${n} · ${anzahl} ${anzahl === 1 ? "article" : "articles"} · ${betrag}`,
  },
});

// options.sprache: "de" (Standard), "en" oder "fr" - die Sprache der Kasse.
export function formatOrderConfirmation(order = {}, options = {}) {
  const sprache = mailSprache(options.sprache || order.sprache);
  const t = BESTELLUNG_TEXT[sprache];
  const a = allgemein(sprache);
  const zahlung = ["RESERVIERT", "EINGEZOGEN"].includes(options.zahlung) ? options.zahlung : null;
  const invoice = zahlung
    ? { ready: false, deferred: true, grund: "RECHNUNG_NACH_EINZUG", number: safeText(order.order_number || "", 80) }
    : renderInvoice(order,options.taxProfile||invoiceProfile({},SELLER),options.issuedAt);
  const documentNote = zahlung === "RESERVIERT"
    ? t.notizReserviert
    : zahlung === "EINGEZOGEN"
      ? t.notizEingezogen
      : invoice.ready ? t.notizRechnung : t.notizOhneRechnung;
  const zahlungsSatz = zahlung === "RESERVIERT" ? t.zahlungReserviert : t.zahlungEingegangen;
  const zahlungsart = zahlung === "RESERVIERT" ? t.zahlungsartReserviert : t.zahlungsart;
  const contactEmail = safeText(options.contactEmail || "", 200) || "kontakt@disorder119.com";
  const contract = contractInformation(contactEmail, sprache);
  const number = safeText(order.order_number || order.orderNumber || "", 80) || "—";
  const items = Array.isArray(order.items) ? order.items : [];
  const currency = order.currency || "EUR";
  const subtotal = Number(order.subtotal_cents ?? order.subtotalCents ?? 0);
  const shipping = Number(order.shipping_cents ?? order.shippingCents ?? 0);
  const total = Number(order.total_cents ?? order.totalCents ?? subtotal + shipping);
  const ordered = mailDatum(order.created_at || order.createdAt || new Date(), sprache);
  const delivery = deliveryLines(order.contact || {}, sprache);
  const betrag = cents => euroAmount(cents, currency, sprache);
  const kontoUrl = shopLink(sprache, "konto/");
  const agbUrl = shopLink(sprache, "agb/");
  const mehrere = items.length > 1;

  const subject = t.subject(number);

  const itemTextLines = items.map(item => {
    const title = stueckTitel(item, sprache);
    const articleNo = safeText(item.article_no || item.articleNo || "", 40);
    const price = betrag(item.unit_price_cents ?? item.unitPriceCents ?? 0);
    return `· ${title}${articleNo ? ` (${a.artNr} ${articleNo})` : ""} — ${price}`;
  });

  const text = [
    "DISORDER119",
    "",
    t.danke(number, ordered),
    zahlungsSatz,
    documentNote,
    "",
    t.bestellung,
    ...itemTextLines,
    "",
    `${t.zwischensumme}: ${betrag(subtotal)}`,
    `${versandBezeichnung(order, sprache)}: ${versandBetrag(shipping, currency, sprache)}`,
    `${t.gesamt}: ${betrag(total)}`,
    zahlungsart,
    ...(invoice.ready?[invoice.text]:[]),
    "",
    ...(delivery.length ? [t.lieferadresse.toUpperCase(), ...delivery, ""] : []),
    t.wieWeiter.toUpperCase(),
    t.weiter(mehrere) + (zahlung === "RESERVIERT" ? t.weiterReserviert : ""),
    "",
    t.kontoText(kontoUrl),
    "",
    t.verkaeufer.toUpperCase(),
    sellerBlockText(sprache),
    `${a.email}: ${contactEmail}`,
    "",
    t.vertragText(contract.version),
    contract.text,
    ...(contract.verbindlich ? [t.verbindlich.toUpperCase(), contract.verbindlich.text] : []),
    "",
    t.onlinefassung(agbUrl),
  ].join("\n");

  const F = MAIL_FARBE;
  const summenZeile = (label, wert, stark) => `<tr>
    <td style="padding:${stark ? "14px 0 0" : "8px 0 0"};${stark ? `font-size:17px;font-weight:700;color:${F.text};` : `color:${F.leise};`}">${escapeHtml(label)}</td>
    <td align="right" style="padding:${stark ? "14px 0 0" : "8px 0 0"};white-space:nowrap;${stark ? `font-size:17px;font-weight:700;color:${F.text};` : `color:${F.leise};`}">${escapeHtml(wert)}</td>
  </tr>`;
  const kopf = `<p style="margin:0 auto 8px;max-width:440px;color:${F.leise};">${t.kopf(`<strong style="color:${F.text};">${escapeHtml(number)}</strong>`, escapeHtml(ordered))}</p>
    <p style="margin:0 auto;max-width:440px;font-size:13px;color:${F.leise};">${escapeHtml(zahlung === "RESERVIERT" ? zahlungsSatz : t.zahlungEingegangenKopf)} ${escapeHtml(documentNote)}</p>`;
  const stuecke = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid ${F.linie};">
      ${items.map(item => stueckZeile(item, betrag(item.unit_price_cents ?? item.unitPriceCents ?? 0), sprache)).join("")}
    </table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:6px;">
      ${summenZeile(t.zwischensumme, betrag(subtotal), false)}
      ${summenZeile(versandBezeichnung(order, sprache), versandBetrag(shipping, currency, sprache), false)}
      ${summenZeile(t.gesamt, betrag(total), true)}
    </table>
    <p style="margin:14px 0 0;font-size:12px;color:${F.leise};">${escapeHtml(zahlungsart)}</p>`;
  const vertragBlock = (ueberschrift, html) => `<div style="border-top:1px solid ${F.linie};padding-top:18px;font-size:12px;line-height:1.55;color:${F.leise};white-space:pre-wrap;"><p>${escapeHtml(ueberschrift)}</p>${html}</div>`;
  const inhalt = [
    ...(invoice.ready?[`<tr><td>${invoice.fragment}</td></tr>`]:[]),
    mailAbschnitt(t.stuecke(items.length), stuecke, false),
    delivery.length ? mailAbschnitt(t.lieferadresse, `<p style="margin:0;">${delivery.map(escapeHtml).join("<br>")}</p>`) : "",
    mailAbschnitt(t.wieWeiter, `<p style="margin:0 0 22px;color:${F.leise};">${escapeHtml(t.weiterHtml(mehrere) + (zahlung === "RESERVIERT" ? t.weiterReserviert : ""))}</p>
      ${mailKnopf(kontoUrl, t.kontoKnopf)}`),
    mailAbschnitt(t.verkaeufer, `<p style="margin:0;color:${F.leise};">${escapeHtml(SELLER.name)} — ${escapeHtml(SELLER.brand)}<br>${escapeHtml(SELLER.street)}<br>${escapeHtml(SELLER.city)}<br>${escapeHtml(verkaeuferLand(sprache))}<br>${escapeHtml(a.telefon)}: ${escapeHtml(SELLER.phone)}<br>${escapeHtml(a.email)}: <a href="mailto:${escapeHtml(contactEmail)}" style="color:${F.text};">${escapeHtml(contactEmail)}</a></p>`),
    `<tr><td style="padding:26px 4px 30px;">
      ${vertragBlock(t.vertragHtml(contract.version), contract.html)}${contract.verbindlich ? `
      <div style="margin-top:18px;">${vertragBlock(t.verbindlich, contract.verbindlich.html)}</div>` : ""}
      <p style="margin:14px 0 0;font-size:12px;color:${F.leise};">${escapeHtml(t.alleBedingungen)}<a href="${agbUrl}" style="color:${F.text};">${agbUrl}</a></p>
    </td></tr>`,
  ].join("");
  const html = kundenmailRahmen({
    titel: t.titel,
    eyebrow: t.eyebrow,
    kopf,
    inhalt,
    vorschau: t.vorschau(number, items.length, betrag(total)),
    sprache,
  });

  return { subject, text, html, invoice, sprache };
}

// ---------------------------------------------------------------------------
// Versandbestaetigung
// ---------------------------------------------------------------------------

// Deutsche Post/DHL-Sendungsverfolgung. Gleiche Quelle wie im Kundenkonto -
// stuende der Link an zwei Stellen, koennte einer davon veralten.
export const DHL_TRACKING_BASE =
  "https://www.dhl.de/de/privatkunden/pakete-empfangen/verfolgen.html?piececode=";
// Dieselbe Seite auf Englisch (dhl.de hat keine franzoesische Fassung).
export const DHL_TRACKING_BASE_EN =
  "https://www.dhl.de/en/privatkunden/pakete-empfangen/verfolgen.html?piececode=";

const CARRIER_TRACKING = [
  [/^DHL\s*EXPRESS\b/, "https://www.dhl.com/de-de/home/tracking/tracking-express.html?submit=1&tracking-id="],
  [/^DPD\b/, "https://tracking.dpd.de/status/de_DE/parcel/"],
  [/^UPS\b/, "https://www.ups.com/track?loc=de_DE&tracknum="],
  [/^GLS\b/, "https://gls-group.com/DE/de/paketverfolgung?match="],
];

export function trackingUrlFor(carrier, trackingNumber, sprache = "de") {
  const nummer = safeText(trackingNumber || "", 60).trim();
  if (!nummer) return "";
  const dienst = safeText(carrier || "DHL", 40).trim().toUpperCase();
  // Nur fuer bekannte Dienste wird ein Link gebaut. Bei einem unbekannten
  // Dienst steht die Nummer ohne Link in der Mail, statt auf eine geratene
  // Adresse zu zeigen.
  if (dienst === "DHL" || dienst === "DEUTSCHE POST") {
    return (mailSprache(sprache) === "de" ? DHL_TRACKING_BASE : DHL_TRACKING_BASE_EN) + encodeURIComponent(nummer);
  }
  // Packlink PRO bucht bei DPD, UPS, GLS und DHL Express.
  const weitere = CARRIER_TRACKING.find(([muster]) => muster.test(dienst));
  if (weitere) return weitere[1] + encodeURIComponent(nummer);
  return "";
}

const VERSANDMAIL_TEXT = Object.freeze({
  de: {
    subject: n => `Deine Bestellung ${n} ist unterwegs`,
    unterwegs: n => `Deine Bestellung ${n} ist unterwegs.`,
    imPaket: "Im Paket",
    nummer: (nr, c) => `Sendungsnummer: ${nr} (${c})`,
    versandMit: c => `Versand mit ${c}.`,
    verfolgen: url => `Verfolgen: ${url}`,
    erfasstText: "Bis die Sendung beim Dienstleister erfasst ist, kann es ein paar Stunden dauern.",
    erfasstHtml: "Bis die Sendung beim Paketdienst erfasst ist, kann es ein paar Stunden dauern.",
    widerrufText: link => `Passt etwas nicht? Innerhalb von 14 Tagen nach Erhalt kannst du hier widerrufen: ${link}`,
    widerrufHtml: ["Passt etwas nicht? Innerhalb von 14 Tagen nach Erhalt kannst du ", "den Vertrag hier widerrufen", "."],
    nummerLabel: c => `Sendungsnummer · ${c}`,
    knopf: "Sendung verfolgen",
    kopf: nr => `Bestellung ${nr} hat unser Lager verlassen.`,
    titel: "Dein Paket ist unterwegs",
    eyebrow: "Versandbestätigung",
    vorschauNummer: (nr, c) => `Sendungsnummer ${nr} · ${c}`,
    vorschauOhne: n => `Bestellung ${n} ist unterwegs`,
  },
  en: {
    subject: n => `Your order ${n} is on its way`,
    unterwegs: n => `Your order ${n} is on its way.`,
    imPaket: "In the parcel",
    nummer: (nr, c) => `Tracking number: ${nr} (${c})`,
    versandMit: c => `Shipped with ${c}.`,
    verfolgen: url => `Track: ${url}`,
    erfasstText: "It can take a few hours until the carrier has registered the parcel.",
    erfasstHtml: "It can take a few hours until the carrier has registered the parcel.",
    widerrufText: link => `Something not right? Within 14 days of receipt you can withdraw from the contract here: ${link}`,
    widerrufHtml: ["Something not right? Within 14 days of receipt you can ", "withdraw from the contract here", "."],
    nummerLabel: c => `Tracking number · ${c}`,
    knopf: "Track parcel",
    kopf: nr => `Order ${nr} has left our warehouse.`,
    titel: "Your parcel is on its way",
    eyebrow: "Shipping confirmation",
    vorschauNummer: (nr, c) => `Tracking number ${nr} · ${c}`,
    vorschauOhne: n => `Order ${n} is on its way`,
  },
  fr: {
    subject: n => `Ta commande ${n} est en route`,
    unterwegs: n => `Ta commande ${n} est en route.`,
    imPaket: "Dans le colis",
    nummer: (nr, c) => `Numéro de suivi : ${nr} (${c})`,
    versandMit: c => `Expédié avec ${c}.`,
    verfolgen: url => `Suivre : ${url}`,
    erfasstText: "Il peut s’écouler quelques heures avant que le transporteur n’enregistre le colis.",
    erfasstHtml: "Il peut s’écouler quelques heures avant que le transporteur n’enregistre le colis.",
    widerrufText: link => `Un souci ? Dans les 14 jours suivant la réception, tu peux te rétracter du contrat ici : ${link}`,
    widerrufHtml: ["Un souci ? Dans les 14 jours suivant la réception, tu peux ", "te rétracter du contrat ici", "."],
    nummerLabel: c => `Numéro de suivi · ${c}`,
    knopf: "Suivre le colis",
    kopf: nr => `La commande ${nr} a quitté notre entrepôt.`,
    titel: "Ton colis est en route",
    eyebrow: "Confirmation d’expédition",
    vorschauNummer: (nr, c) => `Numéro de suivi ${nr} · ${c}`,
    vorschauOhne: n => `Commande ${n} en route`,
  },
});

export function formatShippingConfirmation(order = {}, options = {}) {
  const sprache = mailSprache(options.sprache || order.sprache);
  const t = VERSANDMAIL_TEXT[sprache];
  const a = allgemein(sprache);
  const number = safeText(order.order_number || order.orderNumber || "", 80) || "—";
  const carrier = safeText(order.carrier || "DHL", 40) || "DHL";
  const tracking = safeText(order.tracking_number || order.trackingNumber || "", 60);
  const url = trackingUrlFor(carrier, tracking, sprache);
  const contactEmail = safeText(options.contactEmail || "", 200);
  const items = Array.isArray(order.items) ? order.items : [];
  const titles = items.map(item => (item.title_snapshot || item.title || (sprache === "en" && item.title_en)) ? stueckTitel(item, sprache) : "").filter(Boolean);
  // Wer zurueckschicken will, findet den Weg direkt hier - die Bestellnummer
  // ist auf der Widerrufsseite schon eingetragen.
  const widerrufBasis = shopLink(sprache, "widerruf/");
  const widerrufLink = number !== "—" ? `${widerrufBasis}?bestellung=${encodeURIComponent(number)}` : widerrufBasis;

  const subject = t.subject(number);

  const text = [
    "DISORDER119",
    "",
    t.unterwegs(number),
    "",
    ...(titles.length ? [t.imPaket.toUpperCase(), ...titles.map(title => `· ${title}`), ""] : []),
    ...(tracking ? [t.nummer(tracking, carrier)] : [t.versandMit(carrier)]),
    ...(url ? [t.verfolgen(url)] : []),
    "",
    t.erfasstText,
    "",
    t.widerrufText(widerrufLink),
    "",
    ...(contactEmail ? [fragenText(contactEmail, sprache)] : []),
  ].join("\n");

  const F = MAIL_FARBE;
  const nummerBox = tracking
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:6px 0 22px;">
        <p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;color:${F.leise};">${escapeHtml(t.nummerLabel(carrier))}</p>
        <div style="display:inline-block;border:1px solid ${F.text};padding:14px 20px;font-family:'Courier New',Courier,monospace;font-size:19px;font-weight:700;letter-spacing:0.08em;color:${F.text};">${escapeHtml(tracking)}</div>
      </td></tr></table>
      ${url ? mailKnopf(url, t.knopf) : ""}`
    : `<p style="margin:0;text-align:center;color:${F.leise};">${escapeHtml(t.versandMit(carrier))}</p>`;
  const kopf = `<p style="margin:0 auto;max-width:440px;color:${F.leise};">${t.kopf(`<strong style="color:${F.text};">${escapeHtml(number)}</strong>`)}</p>`;
  const inhalt = [
    `<tr><td style="padding:26px 4px 0;">${nummerBox}</td></tr>`,
    items.length ? mailAbschnitt(t.imPaket, `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid ${F.linie};">${items.map(item => stueckZeile(item, null, sprache)).join("")}</table>`) : "",
    `<tr><td style="padding:24px 4px 30px;">
      <p style="margin:0;font-size:13px;color:${F.leise};">${escapeHtml(t.erfasstHtml)}${contactEmail ? ` ${escapeHtml(a.fragenMit[0])}<a href="mailto:${escapeHtml(contactEmail)}" style="color:${F.text};">${escapeHtml(contactEmail)}</a>${escapeHtml(a.fragenMit[1])}` : ""}</p>
      <p style="margin:12px 0 0;font-size:13px;color:${F.leise};">${escapeHtml(t.widerrufHtml[0])}<a href="${escapeHtml(widerrufLink)}" style="color:${F.text};">${escapeHtml(t.widerrufHtml[1])}</a>${escapeHtml(t.widerrufHtml[2])}</p>
    </td></tr>`,
  ].join("");
  const html = kundenmailRahmen({
    titel: t.titel,
    eyebrow: t.eyebrow,
    kopf,
    inhalt,
    vorschau: tracking ? t.vorschauNummer(tracking, carrier) : t.vorschauOhne(number),
    sprache,
  });

  return { subject, text, html, sprache };
}

// ---------------------------------------------------------------------------
// Versand
// ---------------------------------------------------------------------------

export async function sendMail(env, message = {}) {
  if (!mailTransportReady(env)) return { sent: false, reason: "NOT_CONFIGURED" };
  // Testshop: jede Mail nur an das eigene Postfach, Betreff mit [TEST].
  if (istSandbox(env)) {
    message = sandboxMail(env, message);
    if (!message) return { sent: false, reason: "SANDBOX_NO_TARGET" };
  }
  const to = normalizeEmail(message.to);
  if (!to) return { sent: false, reason: "INVALID_RECIPIENT" };
  const subject = safeText(message.subject || "", 200);
  if (!subject) return { sent: false, reason: "EMPTY_SUBJECT" };
  if (istSandbox(env) && !(await testshopMailFrei(env))) return { sent: false, reason: "SANDBOX_DAILY_CAP" };

  const sender = mailSenderIdentity(env);
  const payload = {
    sender: { email: sender.email, name: sender.name },
    to: [{ email: to, ...(message.toName ? { name: safeText(message.toName, 120) } : {}) }],
    subject,
    htmlContent: message.html || `<pre>${escapeHtml(message.text || "")}</pre>`,
    textContent: message.text || "",
  };
  const replyTo = normalizeEmail(message.replyTo || env.MAIL_REPLY_TO || "");
  if (replyTo) payload.replyTo = { email: replyTo };
  if (message.tag) payload.tags = [safeText(message.tag, 40)];
  // Der Durchschlag wird je Nachricht ausdruecklich angefordert, nie pauschal:
  // ein Anmeldelink oder eine Auskunft nach Art. 15 DSGVO darf niemals
  // nebenbei in einem zweiten Postfach landen.
  if (message.kopieAnShop) {
    const kopie = normalizeEmail(env.MAIL_BCC || "");
    if (kopie && kopie !== to) payload.bcc = [{ email: kopie }];
  }

  let response;
  try {
    response = await fetch(BREVO_ENDPOINT, {
      method: "POST",
      headers: {
        "api-key": String(env.MAIL_API_KEY),
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    throw new Error(`mail_network_error:${safeText(err?.message || "unknown", 80)}`);
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    // Der Anbieter spiegelt Teile der Anfrage zurueck. Nur Code und Meldung
    // uebernehmen, damit keine Kundenadresse in die Logs laeuft.
    const detail = safeText(body?.message || body?.code || `HTTP ${response.status}`, 120);
    throw new Error(`mail_api_error:${detail}`);
  }
  return { sent: true, messageId: safeText(body?.messageId || "", 200) || null };
}

export function formatMailTestMessage(now = new Date()) {
  const stamp = now instanceof Date && !Number.isNaN(now.getTime()) ? now.toISOString() : new Date().toISOString();
  return {
    subject: "DISORDER119 — E-Mail-Test",
    text: [
      "DISORDER119 — E-MAIL-TEST",
      "Status: Versand funktioniert",
      `Zeit: ${stamp}`,
      "Ab jetzt können Bestellbestätigungen automatisch verschickt werden.",
    ].join("\n"),
  };
}

export async function sendMailTest(env, recipient, reqId = crypto.randomUUID()) {
  const message = formatMailTestMessage(new Date());
  const result = await sendMail(env, {
    to: recipient,
    subject: message.subject,
    text: message.text,
    tag: "test",
  });
  if (!result.sent) return result;
  return { ...result, requestId: safeText(reqId, 120) };
}

// ---------------------------------------------------------------------------
// Bestellbestaetigung ausloesen (genau einmal je Bestellung)
// ---------------------------------------------------------------------------

async function claimConfirmation(env, orderId, reqId) {
  const claimId = `notify:email:confirmation:${orderId}`;
  const result = await env.DB.prepare(`INSERT OR IGNORE INTO audit_events
    (id,actor_type,entity_type,entity_id,event_type,request_id,metadata_json,created_at)
    VALUES (?,'SYSTEM','order',?,'ORDER_CONFIRMATION_CLAIMED',?,?,?)`)
    .bind(claimId, String(orderId), safeText(reqId, 120), JSON.stringify({ channel: "email" }), new Date().toISOString())
    .run();
  return { claimId, claimed: Boolean(result?.meta?.changes) };
}

async function releaseConfirmationClaim(env, claimId) {
  try {
    await env.DB.prepare("DELETE FROM audit_events WHERE id=? AND event_type='ORDER_CONFIRMATION_CLAIMED'")
      .bind(claimId).run();
  } catch {
    // Eine fehlgeschlagene Mail darf eine bezahlte Bestellung nie kippen.
  }
}

async function markConfirmationSent(env, claimId) {
  await env.DB.prepare("UPDATE audit_events SET event_type='ORDER_CONFIRMATION_SENT',metadata_json=? WHERE id=?")
    .bind(JSON.stringify({ channel: "email", sentAt: new Date().toISOString() }), claimId).run();
}

export async function loadOrderForConfirmation(env, orderId) {
  const order = await env.DB.prepare(`SELECT o.id,o.order_number,o.status,o.currency,
      o.subtotal_cents,o.shipping_cents,o.total_cents,o.created_at
    FROM commerce_orders o WHERE o.id=? LIMIT 1`).bind(String(orderId)).first();
  if (!order) return null;
  const items = await env.DB.prepare(`SELECT item_id,article_no,title_snapshot,unit_price_cents,bild
    FROM order_items WHERE order_id=? ORDER BY id`).bind(String(orderId)).all();
  let versand = null;
  try {
    versand = await env.DB.prepare("SELECT art,carrier,service_name FROM order_versand WHERE order_id=? LIMIT 1").bind(String(orderId)).first();
  } catch { versand = null; }
  const contact = await env.DB.prepare(`SELECT email,recipient_name,given_name,surname,
      address_line1,address_line2,postal_code,city,region,country_code
    FROM order_contact_snapshots WHERE order_id=? LIMIT 1`).bind(String(orderId)).first();
  return { ...order, items: items?.results || [], contact: contact || {}, versand: versand || null };
}

// Sprache der Bestellung (Migration 0043). Fehlt die Spalte oder die Zeile,
// geht die Mail wie bisher auf Deutsch.
export async function bestellSprache(env, orderId) {
  try {
    const row = await env.DB.prepare("SELECT sprache FROM commerce_orders WHERE id=? LIMIT 1").bind(String(orderId)).first();
    return mailSprache(row?.sprache);
  } catch {
    return "de";
  }
}

// Englische Titel (title_en) aus dem oeffentlichen Katalog, je Katalog-ID.
// Die Bestellung speichert nur den deutschen Titel; faellt der Katalog aus,
// bleibt es bei ihm. Nur fuer englische Mails - fuer Franzoesisch gibt es
// keine eigenen Titel (die Website zeigt dort auch die deutschen).
export async function englischeTitel(env, itemIds = []) {
  const ids = itemIds.map(Number).filter(Number.isFinite);
  const ergebnis = new Map();
  if (!ids.length) return ergebnis;
  try {
    const katalog = await katalogNachId({ env, fetcher: env?.KATALOG_FETCH || null });
    for (const id of ids) {
      const titel = safeText(katalog.get(id)?.title_en || "", 180);
      if (titel) ergebnis.set(id, titel);
    }
  } catch {
    // ohne Katalog: deutsche Titel
  }
  return ergebnis;
}

// Stuecke einer Bestellung mit englischem Titel ergaenzen (nur sprache "en").
async function titelFuerSprache(env, order, sprache) {
  const items = Array.isArray(order?.items) ? order.items : [];
  if (mailSprache(sprache) !== "en" || !items.some(item => item.item_id !== undefined && item.item_id !== null)) return order;
  const titel = await englischeTitel(env, items.map(item => item.item_id));
  if (!titel.size) return order;
  return { ...order, items: items.map(item => titel.has(Number(item.item_id)) ? { ...item, title_en: titel.get(Number(item.item_id)) } : item) };
}

// Wie wurde bezahlt? "RESERVIERT" / "EINGEZOGEN" bei Zahlungen, die erst
// reserviert wurden (zahlung.js), sonst null (sofort eingezogen, bisheriger Weg).
async function zahlungsModus(env, orderId) {
  try {
    const zahlung = await env.DB.prepare(`SELECT status,authorization_id FROM payments WHERE order_id=? AND provider='PAYPAL'
      AND status IN ('AUTHORIZED','COMPLETED','PARTIALLY_REFUNDED','REFUNDED') ORDER BY created_at DESC LIMIT 1`)
      .bind(String(orderId)).first();
    if (!zahlung?.authorization_id) return null;
    return zahlung.status === "AUTHORIZED" ? "RESERVIERT" : "EINGEZOGEN";
  } catch {
    return null;
  }
}

export async function sendOrderConfirmation(env, orderId, reqId = crypto.randomUUID()) {
  if (!mailTransportReady(env) || !env.DB) return { sent: false, reason: "NOT_CONFIGURED" };
  const order = await loadOrderForConfirmation(env, orderId);
  if (!order) return { sent: false, reason: "ORDER_NOT_FOUND" };
  if (!["PAID", "PREPARING", "SHIPPED", "DELIVERED"].includes(String(order.status || "").toUpperCase())) {
    return { sent: false, reason: "ORDER_NOT_PAID" };
  }
  const recipient = normalizeEmail(order.contact?.email);
  if (!recipient) return { sent: false, reason: "NO_CUSTOMER_EMAIL" };

  const claim = await claimConfirmation(env, order.id, reqId);
  if (!claim.claimed) return { sent: false, duplicate: true };

  let message;let archiviert=false;
  try {
    const saved=await env.DB.prepare('SELECT * FROM order_confirmation_archive WHERE order_id=?').bind(order.id).first();
    if(saved) {
      if(await pruefsumme(saved.html)!==saved.html_sha256||await pruefsumme(saved.text)!==saved.text_sha256)throw new Error('confirmation_archive_hash_mismatch');
      message={subject:saved.subject,html:saved.html,text:saved.text,invoice:JSON.parse(saved.invoice_json)};
    } else {
      const sprache=await bestellSprache(env,order.id);
      message=formatOrderConfirmation(await titelFuerSprache(env,order,sprache),{contactEmail:mailSenderIdentity(env).email||safeText(env.MAIL_REPLY_TO||'',200),taxProfile:invoiceProfile(env,SELLER),zahlung:await zahlungsModus(env,order.id),sprache});
      await env.DB.prepare(`INSERT INTO order_confirmation_archive(order_id,subject,html,text,html_sha256,text_sha256,invoice_json,created_at) VALUES(?,?,?,?,?,?,?,?)`)
        .bind(order.id,message.subject,message.html,message.text,await pruefsumme(message.html),await pruefsumme(message.text),JSON.stringify(message.invoice),new Date().toISOString()).run();
    }
    if(message.invoice.ready) {
      archiviert=await archiviereRechnung(env,order,message,recipient);
      if(!archiviert)throw new Error('invoice_archive_failed');
    }
    const delivery = await sendMail(env, {
      to: recipient,
      toName: safeText(order.contact?.recipient_name || "", 120),
      subject: message.subject,
      html: message.html,
      text: message.text,
      tag: "order-confirmation",
      // Diese eine Mail ist zugleich die Rechnung, deshalb geht ein
      // Durchschlag ins Shop-Postfach.
      kopieAnShop: true,
    });
    if (!delivery.sent) throw new Error(delivery.reason || "mail_not_sent");
  } catch (err) {
    await releaseConfirmationClaim(env, claim.claimId);
    throw new Error(`order_confirmation_failed:${safeText(err?.message || "unknown", 120)}`);
  }

  // The exact mail and invoice bytes were archived before delivery. The
  // existing sent event separately records successful provider acceptance.

  try {
    await markConfirmationSent(env, claim.claimId);
    return { sent: true, recorded: true, archiviert };
  } catch {
    return { sent: true, recorded: false, archiviert };
  }
}

// ---------------------------------------------------------------------------
// Rechnungsarchiv
// ---------------------------------------------------------------------------

export async function pruefsumme(text) {
  const bytes = new TextEncoder().encode(String(text || ""));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, "0")).join("");
}

async function archiviereRechnung(env, order, message, recipient) {
  try {
    const invoice=message.invoice;
    if(!invoice?.ready)return false;
    const existing=await env.DB.prepare('SELECT html,text,html_sha256,pruefsumme FROM rechnungen WHERE order_id=?').bind(String(order.id)).first();
    if(existing)return existing.html===invoice.html&&existing.text===invoice.text&&await pruefsumme(existing.html)===existing.html_sha256&&await pruefsumme(existing.text)===existing.pruefsumme;
    const jetzt = new Date().toISOString();
    const warenwert = Number(order.subtotal_cents ?? 0);
    const versand = Number(order.shipping_cents ?? 0);
    const ergebnis = await env.DB.prepare(`INSERT OR IGNORE INTO rechnungen
      (id,order_id,rechnungsnummer,ausgestellt_am,waehrung,warenwert_cents,versand_cents,
       gesamt_cents,empfaenger_email,html,text,pruefsumme,erstellt_am,document_type,html_sha256,tax_profile_json)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(
        crypto.randomUUID(),
        String(order.id),
        safeText(order.order_number || "", 80),
        invoice.issued_at,
        order.currency || "EUR",
        warenwert,
        versand,
        Number(order.total_cents ?? warenwert + versand),
        recipient,
        invoice.html,
        invoice.text,
        await pruefsumme(invoice.text),
        jetzt,
        'invoice',await pruefsumme(invoice.html),JSON.stringify(invoice.profile),
      ).run();
    return Boolean(ergebnis?.meta?.changes);
  } catch (err) {
    console.error(JSON.stringify({
      level: "error",
      event: "rechnung_nicht_archiviert",
      orderId: String(order?.id || ""),
      message: safeText(err?.message || "unknown", 160),
    }));
    return false;
  }
}

// ---------------------------------------------------------------------------
// Rechnung nach dem Einziehen einer reservierten Zahlung
// ---------------------------------------------------------------------------

// invoice: fertige Rechnung (renderInvoice oder aus dem Archiv) mit
// fragment, text und number.
const RECHNUNGSMAIL_TEXT = Object.freeze({
  de: {
    einleitung: (n, b) => `Den Betrag für deine Bestellung ${n} (${b}) haben wir jetzt über PayPal eingezogen. Hier ist deine Rechnung.`,
    subject: n => `Deine Rechnung zur Bestellung ${n} – DISORDER119`,
    titel: "Deine Rechnung",
    eyebrow: "Rechnung",
    vorschau: (n, b) => `Rechnung ${n} · ${b}`,
  },
  en: {
    einleitung: (n, b) => `We have now collected the amount for your order ${n} (${b}) via PayPal. Here is your invoice.`,
    subject: n => `Your invoice for order ${n} – DISORDER119`,
    titel: "Your invoice",
    eyebrow: "Invoice",
    vorschau: (n, b) => `Invoice ${n} · ${b}`,
  },
  fr: {
    einleitung: (n, b) => `Nous avons maintenant débité via PayPal le montant de ta commande ${n} (${b}). Voici ta facture.`,
    subject: n => `Ta facture pour la commande ${n} – DISORDER119`,
    titel: "Ta facture",
    eyebrow: "Facture",
    vorschau: (n, b) => `Facture ${n} · ${b}`,
  },
});

// Die Rechnung selbst ist ein deutscher Steuerbeleg (tax-invoice.js, im
// Archiv mit Pruefsumme) - nur die Mail drumherum spricht die Sprache der
// Bestellung und sagt, dass die Rechnung deutsch ist.
export function formatInvoiceMail(order = {}, invoice = {}, options = {}) {
  const sprache = mailSprache(options.sprache || order.sprache);
  const t = RECHNUNGSMAIL_TEXT[sprache];
  const hinweis = allgemein(sprache).rechnungDeutsch;
  const contactEmail = safeText(options.contactEmail || "", 200);
  const number = safeText(order.order_number || invoice.number || "", 80) || "—";
  const betrag = euroAmount(order.total_cents ?? 0, order.currency || "EUR", sprache);
  const einleitung = t.einleitung(number, betrag);
  const subject = t.subject(number);
  const text = [
    "DISORDER119",
    "",
    einleitung,
    ...(hinweis ? [hinweis] : []),
    "",
    String(invoice.text || ""),
    "",
    fragenText(contactEmail, sprache),
  ].join("\n");
  const F = MAIL_FARBE;
  const kopf = `<p style="margin:0 auto;max-width:440px;color:${F.leise};">${escapeHtml(einleitung)}</p>${hinweis ? `
    <p style="margin:8px auto 0;max-width:440px;font-size:13px;color:${F.leise};">${escapeHtml(hinweis)}</p>` : ""}`;
  const inhalt = [
    `<tr><td>${invoice.fragment || ""}</td></tr>`,
    fragenZeile(contactEmail, sprache),
  ].join("");
  const html = kundenmailRahmen({ titel: t.titel, eyebrow: t.eyebrow, kopf, inhalt, vorschau: t.vorschau(number, betrag), sprache });
  return { subject, text, html, invoice, sprache };
}

// Eine archivierte Rechnung wieder als Rechnung lesen (fuer eine erneute Mail
// nach einem Versandfehler) - nie neu ausstellen, was schon ausgestellt ist.
async function archivierteRechnung(env, orderId) {
  const row = await env.DB.prepare(`SELECT rechnungsnummer,ausgestellt_am,html,text,pruefsumme,html_sha256
    FROM rechnungen WHERE order_id=?`).bind(String(orderId)).first();
  if (!row) return null;
  if (await pruefsumme(row.text) !== row.pruefsumme || (row.html_sha256 && await pruefsumme(row.html) !== row.html_sha256)) {
    throw new Error("invoice_archive_hash_mismatch");
  }
  const html = String(row.html || "");
  const start = html.indexOf("<body>");
  const ende = html.lastIndexOf("</body>");
  return {
    ready: true,
    number: row.rechnungsnummer,
    issued_at: row.ausgestellt_am,
    html,
    text: row.text,
    fragment: start >= 0 && ende > start ? html.slice(start + 6, ende) : "",
  };
}

// Genau einmal je Bestellung, erst wenn eine reservierte Zahlung wirklich
// eingezogen ist. Ausstellungsdatum ist der Zeitpunkt des Einziehens - so
// ergibt ein zweiter Versuch nach einem Mailfehler dieselbe Rechnung.
export async function sendInvoiceAfterCapture(env, orderId, reqId = crypto.randomUUID()) {
  if (!mailTransportReady(env) || !env.DB) return { sent: false, reason: "NOT_CONFIGURED" };
  const order = await loadOrderForConfirmation(env, orderId);
  if (!order) return { sent: false, reason: "ORDER_NOT_FOUND" };
  const zahlung = await env.DB.prepare(`SELECT p.id,p.status,p.authorization_id,
      (SELECT COALESCE(e.occurred_at,e.observed_at) FROM tax_cash_events e WHERE e.payment_id=p.id AND e.kind='capture'
        ORDER BY e.rowid LIMIT 1) AS eingezogen_am
    FROM payments p WHERE p.order_id=? AND p.provider='PAYPAL' AND p.authorization_id IS NOT NULL
      AND p.status IN ('COMPLETED','PARTIALLY_REFUNDED','REFUNDED') ORDER BY p.created_at DESC LIMIT 1`)
    .bind(String(order.id)).first();
  if (!zahlung) return { sent: false, reason: "NOT_CAPTURED" };
  // Stand die Rechnung schon in der Bestellbestaetigung (sofort eingezogen)?
  const bestaetigung = await env.DB.prepare("SELECT invoice_json FROM order_confirmation_archive WHERE order_id=?")
    .bind(String(order.id)).first();
  try {
    if (bestaetigung && JSON.parse(bestaetigung.invoice_json || "{}")?.ready === true) return { sent: false, reason: "IN_BESTAETIGUNG" };
  } catch {
    // Unlesbares Archiv: lieber die eigene Rechnungsmail schicken.
  }
  const recipient = normalizeEmail(order.contact?.email);
  if (!recipient) return { sent: false, reason: "NO_CUSTOMER_EMAIL" };
  const contactEmail = mailSenderIdentity(env).email || safeText(env.MAIL_REPLY_TO || "", 200);

  let invoice = await archivierteRechnung(env, order.id);
  if (!invoice) {
    const neu = renderInvoice(order, invoiceProfile(env, SELLER), zahlung.eingezogen_am || new Date().toISOString());
    if (!neu.ready) return { sent: false, reason: "INVOICE_NOT_READY", issues: neu.issues };
    invoice = neu;
  }

  const claimId = `notify:email:invoice:${order.id}`;
  const claim = await env.DB.prepare(`INSERT OR IGNORE INTO audit_events
    (id,actor_type,entity_type,entity_id,event_type,request_id,metadata_json,created_at)
    VALUES (?,'SYSTEM','order',?,'ORDER_INVOICE_CLAIMED',?,?,?)`)
    .bind(claimId, String(order.id), safeText(reqId, 120), JSON.stringify({ channel: "email" }), new Date().toISOString()).run();
  if (!claim?.meta?.changes) return { sent: false, duplicate: true };

  let archiviert = false;
  try {
    const message = formatInvoiceMail(order, invoice, { contactEmail, sprache: await bestellSprache(env, order.id) });
    archiviert = await archiviereRechnung(env, order, message, recipient);
    if (!archiviert) throw new Error("invoice_archive_failed");
    const delivery = await sendMail(env, {
      to: recipient,
      toName: safeText(order.contact?.recipient_name || "", 120),
      subject: message.subject,
      html: message.html,
      text: message.text,
      tag: "invoice",
      // Beleg: Durchschlag ins Shop-Postfach.
      kopieAnShop: true,
    });
    if (!delivery.sent) throw new Error(delivery.reason || "mail_not_sent");
  } catch (err) {
    try {
      await env.DB.prepare("DELETE FROM audit_events WHERE id=? AND event_type='ORDER_INVOICE_CLAIMED'").bind(claimId).run();
    } catch {
      // Eine fehlgeschlagene Mail darf die Zahlung nie kippen.
    }
    throw new Error(`invoice_mail_failed:${safeText(err?.message || "unknown", 120)}`);
  }
  try {
    await env.DB.prepare("UPDATE audit_events SET event_type='ORDER_INVOICE_SENT',metadata_json=? WHERE id=?")
      .bind(JSON.stringify({ channel: "email", sentAt: new Date().toISOString() }), claimId).run();
  } catch {
    // Versendet ist versendet.
  }
  return { sent: true, archiviert };
}

export async function sendInvoiceAfterCaptureByProviderOrder(env, providerOrderId, reqId = crypto.randomUUID()) {
  if (!mailTransportReady(env) || !env.DB) return { sent: false, reason: "NOT_CONFIGURED" };
  const payment = await env.DB.prepare(`SELECT order_id FROM payments
    WHERE provider='PAYPAL' AND provider_order_id=? LIMIT 1`)
    .bind(safeText(providerOrderId, 128)).first();
  if (!payment?.order_id) return { sent: false, reason: "ORDER_NOT_FOUND" };
  return sendInvoiceAfterCapture(env, payment.order_id, reqId);
}

// ---------------------------------------------------------------------------
// Versandbestaetigung ausloesen
// ---------------------------------------------------------------------------

async function loadShippedOrder(env, orderId) {
  const order = await env.DB.prepare(`SELECT o.id,o.order_number,o.status,
      s.carrier,s.tracking_number
    FROM commerce_orders o
    LEFT JOIN shipments s ON s.order_id=o.id
    WHERE o.id=? ORDER BY s.created_at DESC LIMIT 1`).bind(String(orderId)).first();
  if (!order) return null;
  const items = await env.DB.prepare(`SELECT item_id,title_snapshot,article_no,bild FROM order_items
    WHERE order_id=? ORDER BY id`).bind(String(orderId)).all();
  const contact = await env.DB.prepare(`SELECT email,recipient_name FROM order_contact_snapshots
    WHERE order_id=? LIMIT 1`).bind(String(orderId)).first();
  return { ...order, items: items?.results || [], contact: contact || {} };
}

export async function sendShippingConfirmation(env, orderId, reqId = crypto.randomUUID()) {
  if (!mailTransportReady(env) || !env.DB) return { sent: false, reason: "NOT_CONFIGURED" };
  const order = await loadShippedOrder(env, orderId);
  if (!order) return { sent: false, reason: "ORDER_NOT_FOUND" };
  if (!["SHIPPED", "DELIVERED"].includes(String(order.status || "").toUpperCase())) {
    return { sent: false, reason: "ORDER_NOT_SHIPPED" };
  }
  const recipient = normalizeEmail(order.contact?.email);
  if (!recipient) return { sent: false, reason: "NO_CUSTOMER_EMAIL" };

  // Der Anspruch haengt an der Sendungsnummer, nicht nur an der Bestellung:
  // wird eine falsch eingetragene Nummer korrigiert, soll die Kundin die
  // richtige noch bekommen - dieselbe Nummer aber nur einmal.
  const tracking = safeText(order.tracking_number || "", 60) || "ohne-nummer";
  const claimId = `notify:email:shipped:${order.id}:${tracking}`;
  const claim = await env.DB.prepare(`INSERT OR IGNORE INTO audit_events
    (id,actor_type,entity_type,entity_id,event_type,request_id,metadata_json,created_at)
    VALUES (?,'SYSTEM','order',?,'SHIPPING_NOTICE_CLAIMED',?,?,?)`)
    .bind(claimId, String(order.id), safeText(reqId, 120), JSON.stringify({ channel: "email" }), new Date().toISOString())
    .run();
  if (!claim?.meta?.changes) return { sent: false, duplicate: true };

  const sprache = await bestellSprache(env, order.id);
  const message = formatShippingConfirmation(await titelFuerSprache(env, order, sprache), {
    contactEmail: mailSenderIdentity(env).email || safeText(env.MAIL_REPLY_TO || "", 200),
    sprache,
  });
  try {
    const delivery = await sendMail(env, {
      to: recipient,
      toName: safeText(order.contact?.recipient_name || "", 120),
      subject: message.subject,
      html: message.html,
      text: message.text,
      tag: "shipping-confirmation",
    });
    if (!delivery.sent) throw new Error(delivery.reason || "mail_not_sent");
  } catch (err) {
    try {
      await env.DB.prepare("DELETE FROM audit_events WHERE id=? AND event_type='SHIPPING_NOTICE_CLAIMED'")
        .bind(claimId).run();
    } catch {
      // Eine fehlgeschlagene Mail darf den Versand nie kippen.
    }
    throw new Error(`shipping_confirmation_failed:${safeText(err?.message || "unknown", 120)}`);
  }

  try {
    await env.DB.prepare("UPDATE audit_events SET event_type='SHIPPING_NOTICE_SENT',metadata_json=? WHERE id=?")
      .bind(JSON.stringify({ channel: "email", sentAt: new Date().toISOString() }), claimId).run();
    return { sent: true, recorded: true };
  } catch {
    return { sent: true, recorded: false };
  }
}

export async function sendOrderConfirmationByProviderOrder(env, providerOrderId, reqId = crypto.randomUUID()) {
  if (!mailTransportReady(env) || !env.DB) return { sent: false, reason: "NOT_CONFIGURED" };
  const payment = await env.DB.prepare(`SELECT order_id FROM payments
    WHERE provider='PAYPAL' AND provider_order_id=? LIMIT 1`)
    .bind(safeText(providerOrderId, 128)).first();
  if (!payment?.order_id) return { sent: false, reason: "ORDER_NOT_FOUND" };
  return sendOrderConfirmation(env, payment.order_id, reqId);
}

// ---------------------------------------------------------------------------
// Rueckzahlung, Ruecksendung, Widerruf
// ---------------------------------------------------------------------------

// "30.09.2026, 15:42:07 MESZ" - der Eingang eines Widerrufs zaehlt nach
// deutscher Zeit, nicht nach UTC. Englisch/Franzoesisch: "30 September 2026,
// 15:42:07 CEST" bzw. "30 septembre 2026 à 15:42:07 UTC+2".
export function berlinZeit(value, sprache = "de") {
  const date = value instanceof Date ? value : new Date(String(value || ""));
  if (Number.isNaN(date.getTime())) return "";
  const l = mailSprache(sprache);
  if (l !== "de") {
    return new Intl.DateTimeFormat(LOCALE[l], {
      timeZone: "Europe/Berlin", day: "numeric", month: "long", year: "numeric",
      hour: "2-digit", minute: "2-digit", second: "2-digit", timeZoneName: "short",
    }).format(date);
  }
  return new Intl.DateTimeFormat("de-DE", {
    timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit", timeZoneName: "short",
  }).format(date);
}

export function berlinDatum(value, sprache = "de") {
  const date = value instanceof Date ? value : new Date(String(value || ""));
  if (Number.isNaN(date.getTime())) return "";
  const l = mailSprache(sprache);
  if (l !== "de") {
    return new Intl.DateTimeFormat(LOCALE[l], { timeZone: "Europe/Berlin", day: "numeric", month: "long", year: "numeric" }).format(date);
  }
  return new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
}

function rueckAdresseZeilen(sprache = "de") {
  return [`${SELLER.name} — ${SELLER.brand}`, SELLER.street, SELLER.city, verkaeuferLand(sprache)];
}

function leise(html) {
  return `<p style="margin:0 0 12px;color:${MAIL_FARBE.leise};">${html}</p>`;
}

function betragsZeile(label, wert, stark = false) {
  const F = MAIL_FARBE;
  const stil = stark ? `font-size:17px;font-weight:700;color:${F.text};` : `color:${F.leise};`;
  return `<tr>
    <td style="padding:${stark ? "14px 0 0" : "8px 0 0"};${stil}">${escapeHtml(label)}</td>
    <td align="right" style="padding:${stark ? "14px 0 0" : "8px 0 0"};white-space:nowrap;${stil}">${escapeHtml(wert)}</td>
  </tr>`;
}

function fragenZeile(contactEmail, sprache = "de") {
  const F = MAIL_FARBE;
  const t = allgemein(sprache);
  return `<tr><td style="padding:10px 4px 30px;">
      <p style="margin:0;font-size:13px;color:${F.leise};">${contactEmail
        ? `${escapeHtml(t.fragenMit[0])}<a href="mailto:${escapeHtml(contactEmail)}" style="color:${F.text};">${escapeHtml(contactEmail)}</a>${escapeHtml(t.fragenMit[1])}`
        : escapeHtml(t.fragenOhne)}</p>
    </td></tr>`;
}

const RUECKSENDUNG_TEXT = Object.freeze({
  de: {
    schritte: nummer => [
      `Pack die Ware sicher ein und leg einen Zettel mit deiner Bestellnummer ${nummer} bei.`,
      "Schick das Paket an die Adresse unten – am besten mit Sendungsnummer. Heb den Einlieferungsbeleg auf, er gilt als Nachweis.",
      "Bitte innerhalb von 14 Tagen, nachdem du uns den Widerruf mitgeteilt hast. Es reicht, wenn du das Paket vor Ablauf der Frist abschickst.",
      "Die unmittelbaren Kosten der Rücksendung trägst du (siehe Widerrufsbelehrung).",
    ],
    geldNachRuecksendung: "Sobald die Ware bei uns ist oder du uns den Versand nachweist, erstatten wir dir den Kaufpreis "
      + "– beim Widerruf der ganzen Bestellung auch die Standard-Versandkosten – über PayPal. Du bekommst eine Mail, sobald das Geld raus ist.",
    subject: n => `So schickst du deine Bestellung ${n} zurück`,
    mitWiderruf: (n, eingang) => `Wir haben deinen Widerruf zur Bestellung ${n} am ${eingang} erhalten.`,
    ohneWiderruf: n => `Du möchtest deine Bestellung ${n} zurückschicken.`,
    soWeiter: "So geht es weiter:",
    soWeiterHtml: "So geht es weiter.",
    betrifft: "Betrifft",
    soZurueck: "So schickst du zurück",
    adresse: "Rücksendeadresse",
    deinGeld: "Dein Geld",
    titel: "So geht die Rücksendung",
    eyebrow: "Rücksendung",
    vorschau: n => `Rücksendung zur Bestellung ${n}`,
  },
  en: {
    schritte: nummer => [
      `Pack the goods securely and include a note with your order number ${nummer}.`,
      "Send the parcel to the address below – ideally with a tracking number. Keep the proof of postage; it serves as evidence.",
      "Please do so within 14 days of telling us about your withdrawal. It is enough to send the parcel before the deadline.",
      "You bear the direct cost of returning the goods (see the withdrawal policy).",
    ],
    geldNachRuecksendung: "As soon as the goods are back with us or you show us proof of dispatch, we refund the purchase price via PayPal "
      + "– if you withdraw from the whole order, including the standard shipping costs. You’ll receive an email as soon as the money is on its way.",
    subject: n => `How to return your order ${n}`,
    mitWiderruf: (n, eingang) => `We received your withdrawal for order ${n} on ${eingang}.`,
    ohneWiderruf: n => `You would like to return your order ${n}.`,
    soWeiter: "Here’s what happens next:",
    soWeiterHtml: "Here’s what happens next.",
    betrifft: "Items",
    soZurueck: "How to return",
    adresse: "Return address",
    deinGeld: "Your money",
    titel: "How to return",
    eyebrow: "Return",
    vorschau: n => `Return for order ${n}`,
  },
  fr: {
    schritte: nummer => [
      `Emballe soigneusement la marchandise et joins un mot avec ton numéro de commande ${nummer}.`,
      "Envoie le colis à l’adresse ci-dessous – de préférence avec numéro de suivi. Garde le reçu de dépôt, il sert de preuve.",
      "Merci de le faire dans les 14 jours suivant l’annonce de ta rétractation. Il suffit d’expédier le colis avant la fin du délai.",
      "Les frais directs de renvoi sont à ta charge (voir les informations sur la rétractation).",
    ],
    geldNachRuecksendung: "Dès que la marchandise est arrivée chez nous ou que tu nous prouves l’envoi, nous te remboursons le prix d’achat via PayPal "
      + "– en cas de rétractation de toute la commande, frais de livraison standard inclus. Tu reçois un e-mail dès que l’argent est parti.",
    subject: n => `Comment renvoyer ta commande ${n}`,
    mitWiderruf: (n, eingang) => `Nous avons reçu ta rétractation pour la commande ${n} le ${eingang}.`,
    ohneWiderruf: n => `Tu souhaites renvoyer ta commande ${n}.`,
    soWeiter: "Voici la suite :",
    soWeiterHtml: "Voici la suite.",
    betrifft: "Articles",
    soZurueck: "Comment renvoyer",
    adresse: "Adresse de retour",
    deinGeld: "Ton argent",
    titel: "Comment faire le retour",
    eyebrow: "Retour",
    vorschau: n => `Retour de la commande ${n}`,
  },
});

// So kommt die Ware zurueck - fuer die Eingangsbestaetigung und fuer
// "Ruecksendung anlegen" in der Admin-App.
function ruecksendeSchritte(nummer, sprache = "de") {
  return RUECKSENDUNG_TEXT[mailSprache(sprache)].schritte(nummer);
}

function ruecksendeHtml(nummer, sprache = "de") {
  const F = MAIL_FARBE;
  const schritte = ruecksendeSchritte(nummer, sprache)
    .map((schritt, i) => `<tr><td valign="top" style="padding:0 12px 10px 0;font-weight:700;color:${F.text};">${i + 1}.</td><td style="padding:0 0 10px;color:${F.leise};">${escapeHtml(schritt)}</td></tr>`)
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${schritte}</table>
    <div style="margin:10px 0 0;border:1px solid ${F.text};padding:14px 18px;font-size:15px;line-height:1.5;color:${F.text};">${rueckAdresseZeilen(sprache).map(escapeHtml).join("<br>")}</div>`;
}

const ERSTATTUNG_TEXT = Object.freeze({
  de: {
    // So kommt das Geld zurueck.
    weg: "Das Geld geht über PayPal an dieselbe Zahlungsquelle zurück, mit der du bezahlt hast. "
      + "Auf dein PayPal-Guthaben meist sofort, auf Bankkonto oder Karte kann es ein paar Werktage dauern.",
    // Storno einer nur reservierten Zahlung: es ist nie Geld geflossen.
    reservierungAufgehoben: "Abgebucht wurde nichts. Je nach Bank oder Karte kann die Vormerkung noch ein paar Tage "
      + "in deinem Konto zu sehen sein – sie verschwindet dann von selbst.",
    freigegeben: {
      subject: n => `Deine Bestellung ${n} ist storniert – nichts abgebucht`,
      titel: "Bestellung storniert",
      einleitung: (n, b) => `Deine Bestellung ${n} ist storniert. Die Zahlung über ${b} war bei PayPal nur reserviert – wir haben die Reservierung aufgehoben.`,
    },
    kulanz: {
      subject: (n, b) => `Wir haben dir ${b} erstattet – Bestellung ${n}`,
      titel: "Geld ist unterwegs",
      einleitung: (n, b) => `Für deine Bestellung ${n} haben wir dir ${b} über PayPal erstattet.`,
    },
    vorVersand: {
      subject: (n, b) => `Deine Bestellung ${n} ist storniert – ${b} erstattet`,
      titel: "Bestellung storniert",
      einleitung: (n, b) => `Deine Bestellung ${n} ist storniert. Wir haben dir den vollen Betrag von ${b} über PayPal zurückgezahlt.`,
    },
    ruecksendung: {
      subject: (n, b) => `Deine Rücksendung ist angekommen – ${b} erstattet`,
      titel: "Rücksendung erstattet",
      einleitung: (n, b) => `Deine Rücksendung zur Bestellung ${n} ist bei uns angekommen. Wir haben dir ${b} über PayPal zurückgezahlt.`,
    },
    eyebrowWiderruf: "Widerruf",
    eyebrowStorno: "Stornierung",
    eyebrowErstattung: "Erstattung",
    eyebrowRuecksendung: "Rücksendung",
    grund: "Grund",
    betrifft: "Betrifft",
    erstattet: "Erstattet",
    storniert: "Storniert",
    betrag: "Betrag",
    stuecke: n => `${n} Stücke`,
    versandkosten: "Versandkosten",
    abzug: "Abzug",
    nichtAbgebucht: "Nicht abgebucht",
    deinGeld: "Dein Geld",
    wannDa: "Wann das Geld da ist",
    vorschauFrei: n => `Storniert · nichts abgebucht · Bestellung ${n}`,
    vorschauErstattet: (n, b) => `${b} über PayPal erstattet · Bestellung ${n}`,
  },
  en: {
    weg: "The money goes back via PayPal to the same payment source you paid with. "
      + "To your PayPal balance usually straight away; to a bank account or card it can take a few working days.",
    reservierungAufgehoben: "Nothing was charged. Depending on your bank or card, the pending amount may stay visible "
      + "in your account for a few days – it will then disappear on its own.",
    freigegeben: {
      subject: n => `Your order ${n} has been cancelled – nothing charged`,
      titel: "Order cancelled",
      einleitung: (n, b) => `Your order ${n} has been cancelled. The payment of ${b} was only reserved with PayPal – we have released the reservation.`,
    },
    kulanz: {
      subject: (n, b) => `We have refunded ${b} – order ${n}`,
      titel: "Your money is on its way",
      einleitung: (n, b) => `We have refunded ${b} to you via PayPal for your order ${n}.`,
    },
    vorVersand: {
      subject: (n, b) => `Your order ${n} has been cancelled – ${b} refunded`,
      titel: "Order cancelled",
      einleitung: (n, b) => `Your order ${n} has been cancelled. We have refunded the full amount of ${b} to you via PayPal.`,
    },
    ruecksendung: {
      subject: (n, b) => `Your return has arrived – ${b} refunded`,
      titel: "Return refunded",
      einleitung: (n, b) => `Your return for order ${n} has arrived. We have refunded ${b} to you via PayPal.`,
    },
    eyebrowWiderruf: "Withdrawal",
    eyebrowStorno: "Cancellation",
    eyebrowErstattung: "Refund",
    eyebrowRuecksendung: "Return",
    grund: "Reason",
    betrifft: "Items",
    erstattet: "Refunded",
    storniert: "Cancelled",
    betrag: "Amount",
    stuecke: n => `${n} pieces`,
    versandkosten: "Shipping costs",
    abzug: "Deduction",
    nichtAbgebucht: "Not charged",
    deinGeld: "Your money",
    wannDa: "When the money arrives",
    vorschauFrei: n => `Cancelled · nothing charged · order ${n}`,
    vorschauErstattet: (n, b) => `${b} refunded via PayPal · order ${n}`,
  },
  fr: {
    weg: "L’argent est reversé via PayPal sur le moyen de paiement que tu as utilisé. "
      + "Sur ton solde PayPal, c’est en général immédiat ; sur un compte bancaire ou une carte, cela peut prendre quelques jours ouvrés.",
    reservierungAufgehoben: "Rien n’a été débité. Selon ta banque ou ta carte, la pré-autorisation peut rester visible quelques jours "
      + "sur ton compte – elle disparaît ensuite d’elle-même.",
    freigegeben: {
      subject: n => `Ta commande ${n} est annulée – rien n’a été débité`,
      titel: "Commande annulée",
      einleitung: (n, b) => `Ta commande ${n} est annulée. Le paiement de ${b} était seulement réservé chez PayPal – nous avons levé la réservation.`,
    },
    kulanz: {
      subject: (n, b) => `Nous t’avons remboursé ${b} – commande ${n}`,
      titel: "Ton argent est en route",
      einleitung: (n, b) => `Nous t’avons remboursé ${b} via PayPal pour ta commande ${n}.`,
    },
    vorVersand: {
      subject: (n, b) => `Ta commande ${n} est annulée – ${b} remboursés`,
      titel: "Commande annulée",
      einleitung: (n, b) => `Ta commande ${n} est annulée. Nous t’avons remboursé l’intégralité du montant de ${b} via PayPal.`,
    },
    ruecksendung: {
      subject: (n, b) => `Ton retour est arrivé – ${b} remboursés`,
      titel: "Retour remboursé",
      einleitung: (n, b) => `Ton retour pour la commande ${n} est bien arrivé. Nous t’avons remboursé ${b} via PayPal.`,
    },
    eyebrowWiderruf: "Rétractation",
    eyebrowStorno: "Annulation",
    eyebrowErstattung: "Remboursement",
    eyebrowRuecksendung: "Retour",
    grund: "Motif",
    betrifft: "Articles",
    erstattet: "Remboursé",
    storniert: "Annulé",
    betrag: "Montant",
    stuecke: n => `${n} articles`,
    versandkosten: "Frais de livraison",
    abzug: "Déduction",
    nichtAbgebucht: "Non débité",
    deinGeld: "Ton argent",
    wannDa: "Quand l’argent arrive",
    vorschauFrei: n => `Annulée · rien débité · commande ${n}`,
    vorschauErstattet: (n, b) => `${b} remboursés via PayPal · commande ${n}`,
  },
});

// order: Bestellung; auftrag: Zeile aus erstattungsauftraege.
// options.sprache: Sprache der Bestellung.
export function formatRefundConfirmation(order = {}, auftrag = {}, options = {}) {
  const sprache = mailSprache(options.sprache || order.sprache);
  const t = ERSTATTUNG_TEXT[sprache];
  const a = allgemein(sprache);
  const geld = cents => euroAmount(cents, "EUR", sprache);
  const contactEmail = safeText(options.contactEmail || "", 200);
  const number = safeText(order.order_number || "", 80) || "—";
  const betrag = geld(auftrag.betrag_cents);
  const anlass = String(auftrag.anlass || "");
  let artikel = [];
  try { artikel = JSON.parse(auftrag.artikel_json || "[]") || []; } catch { artikel = []; }
  // Englische Titel aus dem Katalog (artikelTitelUebersetzen), falls bekannt.
  const titelEn = options.titelEn instanceof Map ? options.titelEn : new Map();
  const artikelTitel = a => (sprache === "en" && titelEn.get(Number(a.itemId))) || safeText(a.titel || "Artikel", 180);
  const versand = Number(auftrag.versand_cents || 0);
  const abzug = Number(auftrag.abzug_cents || 0);
  const warenwert = artikel.reduce((summe, a) => summe + Number(a.preisCents || 0), 0);
  // Die Aufschluesselung nur zeigen, wenn sie auf den Cent aufgeht.
  const aufschluesseln = anlass !== "KULANZ" && artikel.length > 0 && warenwert + versand - abzug === Number(auftrag.betrag_cents);
  const grund = safeText(auftrag.kunden_grund || "", 300);
  const abzugGrund = safeText(auftrag.abzug_grund || "", 300);

  const freigegeben = String(auftrag.ergebnis || "") === "FREIGEGEBEN";
  const fall = freigegeben ? t.freigegeben
    : anlass === "KULANZ" ? t.kulanz
      : Number(auftrag.vor_versand) === 1 ? t.vorVersand
        : t.ruecksendung;
  const subject = fall.subject(number, betrag);
  const titel = fall.titel;
  const einleitung = fall.einleitung(number, betrag);
  const eyebrow = freigegeben
    ? (anlass === "WIDERRUF" ? t.eyebrowWiderruf : t.eyebrowStorno)
    : anlass === "KULANZ"
      ? t.eyebrowErstattung
      : Number(auftrag.vor_versand) === 1
        ? (anlass === "WIDERRUF" ? t.eyebrowWiderruf : t.eyebrowStorno)
        : (anlass === "WIDERRUF" ? t.eyebrowWiderruf : t.eyebrowRuecksendung);

  const artikelText = a2 => `· ${artikelTitel(a2)}${a2.artikelNr ? ` (${a.artNr} ${safeText(a2.artikelNr, 40)})` : ""}${aufschluesseln ? ` — ${geld(a2.preisCents)}` : ""}`;
  const text = [
    "DISORDER119",
    "",
    einleitung,
    ...(grund ? ["", `${t.grund}: ${grund}`] : []),
    "",
    ...(artikel.length ? [(anlass === "KULANZ" ? t.betrifft : t.erstattet).toUpperCase(), ...artikel.map(artikelText), ""] : []),
    ...(aufschluesseln && versand ? [`${t.versandkosten}: ${geld(versand)}`] : []),
    ...(aufschluesseln && abzug ? [`${t.abzug}: −${geld(abzug)}${abzugGrund ? ` (${abzugGrund})` : ""}`] : []),
    freigegeben ? `${t.nichtAbgebucht}: ${betrag}` : `${t.erstattet}: ${betrag}`,
    "",
    freigegeben ? t.reservierungAufgehoben : t.weg,
    "",
    fragenText(contactEmail, sprache),
  ].join("\n");

  const F = MAIL_FARBE;
  const kopf = `<p style="margin:0 auto;max-width:440px;color:${F.leise};">${escapeHtml(einleitung)}</p>`;
  const liste = artikel.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid ${F.linie};">
        ${artikel.map(a2 => stueckZeile({ title: artikelTitel(a2), article_no: a2.artikelNr, bild: a2.bild }, aufschluesseln ? geld(a2.preisCents) : null, sprache)).join("")}
      </table>`
    : "";
  const summen = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:6px;">
      ${aufschluesseln && versand ? betragsZeile(t.versandkosten, geld(versand)) : ""}
      ${aufschluesseln && abzug ? betragsZeile(`${t.abzug}${abzugGrund ? ` · ${abzugGrund}` : ""}`, `−${geld(abzug)}`) : ""}
      ${betragsZeile(freigegeben ? t.nichtAbgebucht : t.erstattet, betrag, true)}
    </table>`;
  const inhalt = [
    grund ? mailAbschnitt(t.grund, leise(escapeHtml(grund)), false) : "",
    mailAbschnitt(anlass === "KULANZ" ? t.betrag : artikel.length > 1 ? t.stuecke(artikel.length) : freigegeben ? t.storniert : t.erstattet, `${liste}${summen}`, Boolean(grund)),
    freigegeben
      ? mailAbschnitt(t.deinGeld, leise(escapeHtml(t.reservierungAufgehoben)))
      : mailAbschnitt(t.wannDa, leise(escapeHtml(t.weg))),
    fragenZeile(contactEmail, sprache),
  ].join("");
  const html = kundenmailRahmen({ titel, eyebrow, kopf, inhalt, sprache,
    vorschau: freigegeben ? t.vorschauFrei(number) : t.vorschauErstattet(number, betrag) });
  return { subject, text, html, sprache };
}

// Nach der Rueckzahlung, genau einmal je Erstattungsauftrag.
export async function sendRefundConfirmation(env, auftrag, reqId = crypto.randomUUID()) {
  if (!mailTransportReady(env) || !env.DB) return { sent: false, reason: "NOT_CONFIGURED" };
  const order = await env.DB.prepare("SELECT id,order_number,status,total_cents FROM commerce_orders WHERE id=?")
    .bind(String(auftrag.order_id)).first();
  if (!order) return { sent: false, reason: "ORDER_NOT_FOUND" };
  const contact = await env.DB.prepare("SELECT email,recipient_name FROM order_contact_snapshots WHERE order_id=? LIMIT 1")
    .bind(String(order.id)).first();
  const recipient = normalizeEmail(contact?.email);
  if (!recipient) return { sent: false, reason: "NO_CUSTOMER_EMAIL" };

  const claimId = `notify:email:refund:${auftrag.id}`;
  const claim = await env.DB.prepare(`INSERT OR IGNORE INTO audit_events
    (id,actor_type,entity_type,entity_id,event_type,request_id,metadata_json,created_at)
    VALUES (?,'SYSTEM','order',?,'REFUND_NOTICE_CLAIMED',?,?,?)`)
    .bind(claimId, String(order.id), safeText(reqId, 120), JSON.stringify({ channel: "email", auftragId: auftrag.id }), new Date().toISOString())
    .run();
  if (!claim?.meta?.changes) return { sent: false, duplicate: true };

  const sprache = await bestellSprache(env, order.id);
  let titelEn = new Map();
  if (sprache === "en") {
    let artikel = [];
    try { artikel = JSON.parse(auftrag.artikel_json || "[]") || []; } catch { artikel = []; }
    titelEn = await englischeTitel(env, artikel.map(a => a.itemId));
  }
  const message = formatRefundConfirmation(order, auftrag, {
    contactEmail: mailSenderIdentity(env).email || safeText(env.MAIL_REPLY_TO || "", 200),
    sprache,
    titelEn,
  });
  try {
    const delivery = await sendMail(env, {
      to: recipient,
      toName: safeText(contact?.recipient_name || "", 120),
      subject: message.subject,
      html: message.html,
      text: message.text,
      tag: "refund-confirmation",
      // Beleg ueber die Rueckzahlung: Durchschlag ins Shop-Postfach.
      kopieAnShop: true,
    });
    if (!delivery.sent) throw new Error(delivery.reason || "mail_not_sent");
  } catch (err) {
    try {
      await env.DB.prepare("DELETE FROM audit_events WHERE id=? AND event_type='REFUND_NOTICE_CLAIMED'").bind(claimId).run();
    } catch {
      // Eine fehlgeschlagene Mail darf die Erstattung nie kippen.
    }
    throw new Error(`refund_confirmation_failed:${safeText(err?.message || "unknown", 120)}`);
  }
  try {
    await env.DB.prepare("UPDATE audit_events SET event_type='REFUND_NOTICE_SENT',metadata_json=? WHERE id=?")
      .bind(JSON.stringify({ channel: "email", auftragId: auftrag.id, sentAt: new Date().toISOString() }), claimId).run();
  } catch {
    // Versendet ist versendet.
  }
  return { sent: true };
}

// Anleitung zur Ruecksendung (Admin-App: "Ruecksendung anlegen", wenn die
// Kundin per Mail oder Brief widerrufen hat).
export function formatReturnInstructions(order = {}, options = {}) {
  const sprache = mailSprache(options.sprache || order.sprache);
  const t = RUECKSENDUNG_TEXT[sprache];
  const contactEmail = safeText(options.contactEmail || "", 200);
  const number = safeText(order.order_number || "", 80) || "—";
  const items = Array.isArray(order.items) ? order.items : [];
  const subject = t.subject(number);
  const eingang = options.widerrufAm ? berlinZeit(options.widerrufAm, sprache) : "";
  const einleitung = eingang ? t.mitWiderruf(number, eingang) : t.ohneWiderruf(number);
  const text = [
    "DISORDER119",
    "",
    `${einleitung} ${t.soWeiter}`,
    "",
    ...(items.length ? [t.betrifft.toUpperCase(), ...items.map(item => `· ${stueckTitel(item, sprache)}`), ""] : []),
    t.soZurueck.toUpperCase(),
    ...ruecksendeSchritte(number, sprache).map((schritt, i) => `${i + 1}. ${schritt}`),
    "",
    t.adresse.toUpperCase(),
    ...rueckAdresseZeilen(sprache),
    "",
    t.deinGeld.toUpperCase(),
    t.geldNachRuecksendung,
    "",
    fragenText(contactEmail, sprache),
  ].join("\n");
  const F = MAIL_FARBE;
  const kopf = `<p style="margin:0 auto;max-width:440px;color:${F.leise};">${escapeHtml(einleitung)} ${escapeHtml(t.soWeiterHtml)}</p>`;
  const inhalt = [
    items.length ? mailAbschnitt(t.betrifft, `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid ${F.linie};">${items.map(item => stueckZeile(item, null, sprache)).join("")}</table>`, false) : "",
    mailAbschnitt(t.soZurueck, ruecksendeHtml(number, sprache), Boolean(items.length)),
    mailAbschnitt(t.deinGeld, leise(escapeHtml(t.geldNachRuecksendung))),
    fragenZeile(contactEmail, sprache),
  ].join("");
  const html = kundenmailRahmen({ titel: t.titel, eyebrow: t.eyebrow, kopf, inhalt, vorschau: t.vorschau(number), sprache });
  return { subject, text, html, sprache };
}

export async function sendReturnInstructions(env, orderId, reqId = crypto.randomUUID(), { widerrufAm = null, schluessel = "", sprache = null } = {}) {
  if (!mailTransportReady(env) || !env.DB) return { sent: false, reason: "NOT_CONFIGURED" };
  const order = await loadShippedOrder(env, orderId);
  if (!order) return { sent: false, reason: "ORDER_NOT_FOUND" };
  const recipient = normalizeEmail(order.contact?.email);
  if (!recipient) return { sent: false, reason: "NO_CUSTOMER_EMAIL" };
  const claimId = `notify:email:return-instructions:${order.id}:${safeText(schluessel || "1", 80)}`;
  const claim = await env.DB.prepare(`INSERT OR IGNORE INTO audit_events
    (id,actor_type,entity_type,entity_id,event_type,request_id,metadata_json,created_at)
    VALUES (?,'SYSTEM','order',?,'RETURN_INSTRUCTIONS_CLAIMED',?,?,?)`)
    .bind(claimId, String(order.id), safeText(reqId, 120), JSON.stringify({ channel: "email" }), new Date().toISOString()).run();
  if (!claim?.meta?.changes) return { sent: false, duplicate: true };
  // Sprache: die der Bestellung - ausser der Aufrufer kennt eine juengere
  // (die Kundin hat auf /en/widerruf/ widerrufen).
  const mailSpracheJetzt = sprache ? mailSprache(sprache) : await bestellSprache(env, order.id);
  const message = formatReturnInstructions(await titelFuerSprache(env, order, mailSpracheJetzt), {
    contactEmail: mailSenderIdentity(env).email || safeText(env.MAIL_REPLY_TO || "", 200),
    widerrufAm,
    sprache: mailSpracheJetzt,
  });
  try {
    const delivery = await sendMail(env, {
      to: recipient,
      toName: safeText(order.contact?.recipient_name || "", 120),
      subject: message.subject,
      html: message.html,
      text: message.text,
      tag: "return-instructions",
    });
    if (!delivery.sent) throw new Error(delivery.reason || "mail_not_sent");
  } catch (err) {
    try {
      await env.DB.prepare("DELETE FROM audit_events WHERE id=? AND event_type='RETURN_INSTRUCTIONS_CLAIMED'").bind(claimId).run();
    } catch {
      // Die Ruecksendung bleibt angelegt, die Mail laesst sich erneut ausloesen.
    }
    throw new Error(`return_instructions_failed:${safeText(err?.message || "unknown", 120)}`);
  }
  try {
    await env.DB.prepare("UPDATE audit_events SET event_type='RETURN_INSTRUCTIONS_SENT',metadata_json=? WHERE id=?")
      .bind(JSON.stringify({ channel: "email", sentAt: new Date().toISOString() }), claimId).run();
  } catch {
    // Versendet ist versendet.
  }
  return { sent: true };
}

const EINGANG_TEXT = Object.freeze({
  de: {
    felder: { name: "Name", email: "E-Mail", bestellung: "Bestellung", erklaerung: "Erklärung", nachricht: "Nachricht", eingegangen: "Eingegangen", vorgang: "Vorgang" },
    teil: teile => `Widerruf für folgende Stücke: ${teile}`,
    ganz: "Widerruf des ganzen Vertrags",
    subject: datum => `Eingangsbestätigung: dein Widerruf vom ${datum}`,
    weiterVersendet: "Bitte schick uns die Ware zurück, wie unten beschrieben. Sobald sie bei uns ist oder du uns den Versand nachweist, erstatten wir dir alle Zahlungen über PayPal – beim Widerruf der ganzen Bestellung einschließlich der Standard-Versandkosten –, spätestens 14 Tage nach Eingang deines Widerrufs. Du bekommst eine Mail, sobald das Geld raus ist.",
    weiterReserviert: "Deine Bestellung ist noch nicht verschickt, und abgebucht ist noch nichts – PayPal hat den Betrag nur reserviert. Wir halten die Bestellung an und heben die Reservierung auf. Du bekommst eine Mail, sobald das erledigt ist. Sollte dein Paket doch schon unterwegs sein, melden wir uns bei dir.",
    weiterNichtVersendet: "Deine Bestellung ist noch nicht verschickt. Wir halten sie an und erstatten dir den vollen Betrag über PayPal. Du bekommst eine Mail, sobald das Geld zurück ist. Sollte dein Paket doch schon unterwegs sein, melden wir uns bei dir.",
    weiterOffen: "Wir ordnen deine Erklärung jetzt deiner Bestellung zu und schicken dir die nächsten Schritte. Falls wir dafür etwas von dir brauchen, melden wir uns.",
    ueberschrift: "Eingangsbestätigung",
    eingegangen: eingang => `Deine Widerrufserklärung ist am ${eingang} bei uns eingegangen.`,
    eingegangenHtml: eingang => `Deine Widerrufserklärung ist am ${eingang} bei uns eingegangen.`,
    bestaetigt: "Diese Mail bestätigt den Eingang deiner Erklärung mit ihrem Inhalt.",
    deineErklaerung: "Deine Erklärung",
    deineBestellung: "Deine Bestellung",
    wieWeiter: "Wie es weitergeht",
    soZurueck: "So schickst du zurück",
    adresse: "Rücksendeadresse",
    titel: "Widerruf eingegangen",
    vorschau: eingang => `Eingegangen am ${eingang}`,
  },
  en: {
    felder: { name: "Name", email: "Email", bestellung: "Order", erklaerung: "Declaration", nachricht: "Message", eingegangen: "Received", vorgang: "Reference" },
    teil: teile => `Withdrawal for the following pieces: ${teile}`,
    ganz: "Withdrawal from the entire contract",
    subject: datum => `Confirmation of receipt: your withdrawal of ${datum}`,
    weiterVersendet: "Please send the goods back to us as described below. As soon as they are back with us or you show us proof of dispatch, we refund all payments via PayPal – if you withdraw from the whole order, including the standard shipping costs – no later than 14 days after we received your withdrawal. You’ll receive an email as soon as the money is on its way.",
    weiterReserviert: "Your order has not been shipped yet, and nothing has been charged – PayPal has only reserved the amount. We are stopping the order and releasing the reservation. You’ll receive an email once that’s done. Should your parcel already be on its way, we’ll get in touch.",
    weiterNichtVersendet: "Your order has not been shipped yet. We are stopping it and refunding the full amount via PayPal. You’ll receive an email as soon as the money is back. Should your parcel already be on its way, we’ll get in touch.",
    weiterOffen: "We are now matching your declaration to your order and will send you the next steps. If we need anything from you, we’ll get in touch.",
    ueberschrift: "Confirmation of receipt",
    eingegangen: eingang => `Your notice of withdrawal reached us on ${eingang}.`,
    eingegangenHtml: eingang => `Your notice of withdrawal reached us on ${eingang}.`,
    bestaetigt: "This email confirms the receipt of your declaration and its content.",
    deineErklaerung: "Your declaration",
    deineBestellung: "Your order",
    wieWeiter: "What happens next",
    soZurueck: "How to return",
    adresse: "Return address",
    titel: "Withdrawal received",
    vorschau: eingang => `Received on ${eingang}`,
  },
  fr: {
    felder: { name: "Nom", email: "E-mail", bestellung: "Commande", erklaerung: "Déclaration", nachricht: "Message", eingegangen: "Reçue le", vorgang: "Référence" },
    teil: teile => `Rétractation pour les articles suivants : ${teile}`,
    ganz: "Rétractation de l’ensemble du contrat",
    subject: datum => `Accusé de réception : ta rétractation du ${datum}`,
    weiterVersendet: "Merci de nous renvoyer la marchandise comme décrit ci-dessous. Dès qu’elle est arrivée chez nous ou que tu nous prouves l’envoi, nous te remboursons tous les paiements via PayPal – en cas de rétractation de toute la commande, frais de livraison standard inclus –, au plus tard 14 jours après la réception de ta rétractation. Tu reçois un e-mail dès que l’argent est parti.",
    weiterReserviert: "Ta commande n’est pas encore expédiée et rien n’a été débité – PayPal a seulement réservé le montant. Nous arrêtons la commande et levons la réservation. Tu reçois un e-mail dès que c’est fait. Si ton colis était déjà en route, nous te contactons.",
    weiterNichtVersendet: "Ta commande n’est pas encore expédiée. Nous l’arrêtons et te remboursons l’intégralité du montant via PayPal. Tu reçois un e-mail dès que l’argent est reversé. Si ton colis était déjà en route, nous te contactons.",
    weiterOffen: "Nous associons maintenant ta déclaration à ta commande et t’envoyons les prochaines étapes. Si nous avons besoin de quelque chose, nous te contactons.",
    ueberschrift: "Accusé de réception",
    eingegangen: eingang => `Ta déclaration de rétractation nous est parvenue le ${eingang}.`,
    eingegangenHtml: eingang => `Ta déclaration de rétractation nous est parvenue le ${eingang}.`,
    bestaetigt: "Cet e-mail confirme la réception de ta déclaration et son contenu.",
    deineErklaerung: "Ta déclaration",
    deineBestellung: "Ta commande",
    wieWeiter: "La suite",
    soZurueck: "Comment renvoyer",
    adresse: "Adresse de retour",
    titel: "Rétractation reçue",
    vorschau: eingang => `Reçue le ${eingang}`,
  },
});

// Eingangsbestaetigung nach § 356a BGB: unverzueglich, auf einem dauerhaften
// Datentraeger, mit dem Inhalt der Erklaerung sowie Datum und Uhrzeit des
// Eingangs. Sie bestaetigt bewusst nur den Eingang - ob der Widerruf
// wirksam ist, steht nicht darin.
//
// lage: "VERSENDET" (Anleitung zur Ruecksendung), "NICHT_VERSENDET" (wir
// halten an und erstatten) oder "OFFEN" (noch keiner Bestellung zugeordnet).
// Sprache: options.sprache, sonst die der Widerrufsseite (widerrufe.sprache).
export function formatWithdrawalReceipt(widerruf = {}, options = {}) {
  const sprache = mailSprache(options.sprache || widerruf.sprache);
  const t = EINGANG_TEXT[sprache];
  const contactEmail = safeText(options.contactEmail || "", 200);
  const lage = options.lage || "OFFEN";
  const eingang = berlinZeit(widerruf.eingegangen_at, sprache);
  // Freitext aus dem Formular (Name, Bestellnummer, Stuecke, Nachricht) kann
  // jeder eintragen - auch mit fremder Empfaengeradresse. Links darin werden
  // entschaerft, damit die Bestaetigung kein Phishing-Kanal ist.
  const fremd = (wert, max) => linksEntschaerfen(safeText(wert || "", max));
  const nummer = fremd(widerruf.bestellnummer_eingabe, 80) || "—";
  const vorgang = safeText(widerruf.id || "", 80).replace(/-/g, "").slice(0, 8).toUpperCase();
  const umfang = widerruf.umfang === "TEIL"
    ? t.teil(fremd(widerruf.teile_text, 600))
    : t.ganz;
  const felder = [
    [t.felder.name, fremd(widerruf.name, 120)],
    [t.felder.email, safeText(widerruf.email || "", 200)],
    [t.felder.bestellung, nummer],
    [t.felder.erklaerung, umfang],
    ...(widerruf.nachricht ? [[t.felder.nachricht, fremd(widerruf.nachricht, 1000)]] : []),
    [t.felder.eingegangen, eingang],
    [t.felder.vorgang, vorgang],
  ];
  const items = Array.isArray(options.items) ? options.items : [];
  const subject = t.subject(berlinDatum(widerruf.eingegangen_at, sprache));
  const weiter = lage === "VERSENDET"
    ? t.weiterVersendet
    : lage === "NICHT_VERSENDET" && options.reserviert
      ? t.weiterReserviert
      : lage === "NICHT_VERSENDET"
        ? t.weiterNichtVersendet
        : t.weiterOffen;

  const text = [
    "DISORDER119",
    "",
    t.ueberschrift.toUpperCase(),
    t.eingegangen(eingang),
    t.bestaetigt,
    "",
    t.deineErklaerung.toUpperCase(),
    ...felder.map(([label, wert]) => `${label}: ${wert}`),
    "",
    ...(items.length ? [t.deineBestellung.toUpperCase(), ...items.map(item => `· ${stueckTitel(item, sprache)}`), ""] : []),
    t.wieWeiter.toUpperCase(),
    weiter,
    ...(lage === "VERSENDET"
      ? ["", t.soZurueck.toUpperCase(), ...ruecksendeSchritte(nummer, sprache).map((s, i) => `${i + 1}. ${s}`), "", t.adresse.toUpperCase(), ...rueckAdresseZeilen(sprache)]
      : []),
    "",
    fragenText(contactEmail, sprache),
  ].join("\n");

  const F = MAIL_FARBE;
  const tabelle = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid ${F.linie};">
    ${felder.map(([label, wert]) => `<tr>
      <td valign="top" width="120" style="padding:10px 12px 10px 0;border-bottom:1px solid ${F.linie};font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:${F.leise};">${escapeHtml(label)}</td>
      <td style="padding:10px 0;border-bottom:1px solid ${F.linie};color:${F.text};white-space:pre-wrap;">${escapeHtml(wert)}</td>
    </tr>`).join("")}
  </table>`;
  const kopf = `<p style="margin:0 auto 8px;max-width:440px;color:${F.leise};">${t.eingegangenHtml(`<strong style="color:${F.text};">${escapeHtml(eingang)}</strong>`)}</p>
    <p style="margin:0 auto;max-width:440px;font-size:13px;color:${F.leise};">${escapeHtml(t.bestaetigt)}</p>`;
  const inhalt = [
    mailAbschnitt(t.deineErklaerung, tabelle, false),
    items.length ? mailAbschnitt(t.deineBestellung, `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid ${F.linie};">${items.map(item => stueckZeile(item, null, sprache)).join("")}</table>`) : "",
    mailAbschnitt(t.wieWeiter, leise(escapeHtml(weiter))),
    lage === "VERSENDET" ? mailAbschnitt(t.soZurueck, ruecksendeHtml(nummer, sprache)) : "",
    fragenZeile(contactEmail, sprache),
  ].join("");
  const html = kundenmailRahmen({ titel: t.titel, eyebrow: t.ueberschrift, kopf, inhalt, vorschau: t.vorschau(eingang), sprache });
  return { subject, text, html, sprache };
}

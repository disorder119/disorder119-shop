import { LEGAL_VERSION, CONTRACT_HTML } from "./legal-content.js";
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

const BREVO_ENDPOINT = "https://api.brevo.com/v3/smtp/email";

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
function kundenmailRahmen({ titel, eyebrow, kopf, inhalt, vorschau }) {
  const F = MAIL_FARBE;
  return `<!DOCTYPE html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark">
<title>${escapeHtml(titel)}</title></head>
<body style="margin:0;padding:0;background:${F.grund};">
${vorschau ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${F.grund};">${escapeHtml(vorschau)}</div>` : ""}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${F.grund};">
<tr><td align="center" style="padding:0 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;font-family:${MAIL_SCHRIFT};color:${F.text};font-size:15px;line-height:1.55;">
  <tr><td align="center" style="padding:36px 0 26px;border-bottom:1px solid ${F.linie};">
    <a href="${SHOP_URL}/" style="font-size:15px;font-weight:700;letter-spacing:0.34em;color:${F.text};text-decoration:none;">DISORDER119</a>
  </td></tr>
  <tr><td style="padding:40px 4px 6px;text-align:center;">
    <p style="margin:0 0 14px;font-size:11px;font-weight:700;letter-spacing:0.22em;text-transform:uppercase;color:${F.leise};">${escapeHtml(eyebrow)}</p>
    <h1 style="margin:0 0 16px;font-size:28px;line-height:1.15;font-weight:700;letter-spacing:-0.01em;text-transform:uppercase;color:${F.text};">${escapeHtml(titel)}</h1>
    ${kopf}
  </td></tr>
  ${inhalt}
  <tr><td style="padding:30px 4px 44px;border-top:1px solid ${F.linie};text-align:center;font-size:11px;line-height:1.6;color:${F.leise};">
    Kuratiertes Archiv für Designer-, Vintage- und Contemporary-Mode.<br>
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

// Ein Stueck als Zeile: Foto (falls gespeichert), Titel, Art.-Nr., Preis.
function stueckZeile(item, preis) {
  const F = MAIL_FARBE;
  const titel = escapeHtml(safeText(item.title_snapshot || item.title || "Artikel", 180));
  const nr = escapeHtml(safeText(item.article_no || item.articleNo || "", 40));
  const pfad = safeText(item.bild || "", 200).replace(/^\/+/, "");
  const bild = /^assets\/img\/[A-Za-z0-9_\/.-]+$/.test(pfad)
    ? `<img src="${SHOP_URL}/${escapeHtml(pfad)}" width="64" alt="" style="display:block;width:64px;height:auto;border:0;background:${F.flaeche};">`
    : `<div style="width:64px;height:85px;background:${F.flaeche};"></div>`;
  return `<tr>
    <td width="78" valign="top" style="padding:14px 14px 14px 0;border-bottom:1px solid ${F.linie};">${bild}</td>
    <td valign="middle" style="padding:14px 0;border-bottom:1px solid ${F.linie};">
      <span style="display:block;font-size:15px;line-height:1.4;color:${F.text};">${titel}</span>
      ${nr ? `<span style="display:block;margin-top:4px;font-size:12px;color:${F.leise};">Art.-Nr. ${nr}</span>` : ""}
    </td>
    ${preis === null ? "" : `<td valign="middle" align="right" style="padding:14px 0 14px 12px;border-bottom:1px solid ${F.linie};white-space:nowrap;font-weight:700;">${escapeHtml(preis)}</td>`}
  </tr>`;
}

// "Versand · Standard (DPD)", solange die Kasse die Wahl gespeichert hat.
function versandBezeichnung(order) {
  const v = order.versand || {};
  const art = v.art === "express" ? "Express" : v.art === "standard" ? "Standard" : "";
  const carrier = safeText(v.carrier || "", 40);
  if (!art) return "Versand (Deutschland)";
  return `Versand · ${art}${carrier ? ` (${carrier})` : ""}`;
}

// Ab 99 € Warenwert uebernimmt der Shop den Standardversand: dann
// "kostenlos" statt "0,00 €" (versand.js, versandkostenfrei).
function versandBetrag(cents, currency) {
  return Number(cents) === 0 ? "kostenlos" : euroAmount(cents, currency);
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

export function euroAmount(cents, currency = "EUR") {
  const amount = Number(cents || 0) / 100;
  try {
    return new Intl.NumberFormat("de-DE", { style: "currency", currency: currency || "EUR" }).format(amount);
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

function sellerBlockText() {
  return [
    `${SELLER.name} — ${SELLER.brand}`,
    SELLER.street,
    SELLER.city,
    SELLER.country,
    `Telefon: ${SELLER.phone}`,
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

function deliveryLines(contact = {}) {
  const lines = [
    safeText(contact.recipient_name || contact.recipientName || "", 120),
    safeText(contact.address_line1 || contact.addressLine1 || "", 160),
    safeText(contact.address_line2 || contact.addressLine2 || "", 160),
    [safeText(contact.postal_code || contact.postalCode || "", 20), safeText(contact.city || "", 80)]
      .filter(Boolean).join(" "),
    safeText(contact.country_code || contact.countryCode || "", 4),
  ];
  return lines.map(line => line.trim()).filter(Boolean);
}

// options.zahlung: fehlt = sofort eingezogen (Rechnung steht in dieser Mail),
// "RESERVIERT" = PayPal hat nur reserviert, "EINGEZOGEN" = reserviert und
// inzwischen eingezogen. In beiden neuen Faellen kommt die Rechnung mit dem
// Einziehen (sendInvoiceAfterCapture) - ein Storno davor braucht keine.
export function contractInformation(contactEmail) {
  const html = CONTRACT_HTML.replaceAll("{email}", escapeHtml(contactEmail)).replaceAll('href="/', 'href="' + SHOP_URL + '/');
  const text = html.replace(/<br\s*\/?>(?:\s*)/gi, "\n").replace(/<\/(?:p|h[1-6])>/gi, "\n\n")
    .replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  return {html, text, version:LEGAL_VERSION};
}

export function formatOrderConfirmation(order = {}, options = {}) {
  const zahlung = ["RESERVIERT", "EINGEZOGEN"].includes(options.zahlung) ? options.zahlung : null;
  const invoice = zahlung
    ? { ready: false, deferred: true, grund: "RECHNUNG_NACH_EINZUG", number: safeText(order.order_number || "", 80) }
    : renderInvoice(order,options.taxProfile||invoiceProfile({},SELLER),options.issuedAt);
  const documentNote = zahlung === "RESERVIERT"
    ? "Die Rechnung schicken wir dir, sobald der Betrag eingezogen ist."
    : zahlung === "EINGEZOGEN"
      ? "Die Rechnung bekommst du in einer eigenen Mail."
      : invoice.ready?'Die folgende Rechnung gehört zu deiner Vertragsbestätigung.':'Dies ist deine Vertragsbestätigung. Eine Rechnung wird nach Klärung der Rechnungsangaben separat bereitgestellt.';
  const zahlungsSatz = zahlung === "RESERVIERT"
    ? "Deine Zahlung ist bei PayPal reserviert. Abgebucht wird erst, wenn wir dein Paket versenden – spätestens drei Tage nach deiner Bestellung. Mit dieser Bestätigung ist der Kaufvertrag geschlossen."
    : "Die Zahlung ist bei uns eingegangen. Damit ist der Kaufvertrag geschlossen.";
  const zahlungsart = zahlung === "RESERVIERT" ? "Zahlungsart: PayPal – reserviert, Abbuchung mit dem Versand" : "Zahlungsart: PayPal";
  const contactEmail = safeText(options.contactEmail || "", 200) || "kontakt@disorder119.com";
  const contract = contractInformation(contactEmail);
  const number = safeText(order.order_number || order.orderNumber || "", 80) || "—";
  const items = Array.isArray(order.items) ? order.items : [];
  const currency = order.currency || "EUR";
  const subtotal = Number(order.subtotal_cents ?? order.subtotalCents ?? 0);
  const shipping = Number(order.shipping_cents ?? order.shippingCents ?? 0);
  const total = Number(order.total_cents ?? order.totalCents ?? subtotal + shipping);
  const ordered = germanDate(order.created_at || order.createdAt || new Date());
  const delivery = deliveryLines(order.contact || {});

  const subject = `Deine Bestellung ${number} bei DISORDER119`;

  const itemTextLines = items.map(item => {
    const title = safeText(item.title_snapshot || item.title || "Artikel", 180);
    const articleNo = safeText(item.article_no || item.articleNo || "", 40);
    const price = euroAmount(item.unit_price_cents ?? item.unitPriceCents ?? 0, currency);
    return `· ${title}${articleNo ? ` (Art.-Nr. ${articleNo})` : ""} — ${price}`;
  });

  const text = [
    "DISORDER119",
    "",
    `Danke für deine Bestellung ${number} vom ${ordered}.`,
    zahlungsSatz,
    documentNote,
    "",
    "BESTELLUNG",
    ...itemTextLines,
    "",
    `Zwischensumme: ${euroAmount(subtotal, currency)}`,
    `${versandBezeichnung(order)}: ${versandBetrag(shipping, currency)}`,
    `Gesamt: ${euroAmount(total, currency)}`,
    zahlungsart,
    ...(invoice.ready?[invoice.text]:[]),
    "",
    ...(delivery.length ? ["LIEFERADRESSE", ...delivery, ""] : []),
    "WIE ES WEITERGEHT",
    (items.length > 1 ? "Deine Stücke werden" : "Dein Teil wird") + " von Hand verpackt und innerhalb von drei Werktagen "
      + "versendet. Sobald das Paket unterwegs ist, bekommst du eine Mail mit der Sendungsnummer."
      + (zahlung === "RESERVIERT" ? " Mit dem Versand zieht PayPal den Betrag ein – dann kommt auch deine Rechnung." : ""),
    "",
    `Deine Bestellung im Konto: ${SHOP_URL}/konto/`,
    "",
    "VERKÄUFER",
    sellerBlockText(),
    `E-Mail: ${contactEmail}`,
    "",
    `VERTRAGSINFORMATIONEN · Fassung ${contract.version}`,
    contract.text,
    "",
    `Onlinefassung: ${SHOP_URL}/agb/`,
  ].join("\n");

  const F = MAIL_FARBE;
  const summenZeile = (label, wert, stark) => `<tr>
    <td style="padding:${stark ? "14px 0 0" : "8px 0 0"};${stark ? `font-size:17px;font-weight:700;color:${F.text};` : `color:${F.leise};`}">${escapeHtml(label)}</td>
    <td align="right" style="padding:${stark ? "14px 0 0" : "8px 0 0"};white-space:nowrap;${stark ? `font-size:17px;font-weight:700;color:${F.text};` : `color:${F.leise};`}">${escapeHtml(wert)}</td>
  </tr>`;
  const kopf = `<p style="margin:0 auto 8px;max-width:440px;color:${F.leise};">Bestellung <strong style="color:${F.text};">${escapeHtml(number)}</strong> vom ${escapeHtml(ordered)}</p>
    <p style="margin:0 auto;max-width:440px;font-size:13px;color:${F.leise};">${zahlung === "RESERVIERT" ? escapeHtml(zahlungsSatz) : "Die Zahlung ist eingegangen — damit ist der Kaufvertrag geschlossen."} ${escapeHtml(documentNote)}</p>`;
  const stuecke = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid ${F.linie};">
      ${items.map(item => stueckZeile(item, euroAmount(item.unit_price_cents ?? item.unitPriceCents ?? 0, currency))).join("")}
    </table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:6px;">
      ${summenZeile("Zwischensumme", euroAmount(subtotal, currency), false)}
      ${summenZeile(versandBezeichnung(order), versandBetrag(shipping, currency), false)}
      ${summenZeile("Gesamt", euroAmount(total, currency), true)}
    </table>
    <p style="margin:14px 0 0;font-size:12px;color:${F.leise};">${escapeHtml(zahlungsart)}</p>`;
  const inhalt = [
    ...(invoice.ready?[`<tr><td>${invoice.fragment}</td></tr>`]:[]),
    mailAbschnitt(items.length > 1 ? `Deine ${items.length} Stücke` : "Dein Stück", stuecke, false),
    delivery.length ? mailAbschnitt("Lieferadresse", `<p style="margin:0;">${delivery.map(escapeHtml).join("<br>")}</p>`) : "",
    mailAbschnitt("Wie es weitergeht", `<p style="margin:0 0 22px;color:${F.leise};">${items.length > 1 ? "Deine Stücke werden" : "Dein Teil wird"} von Hand verpackt und innerhalb von drei Werktagen versendet. Sobald das Paket unterwegs ist, bekommst du eine Mail mit der Sendungsnummer und dem Link zur Sendungsverfolgung.${zahlung === "RESERVIERT" ? " Mit dem Versand zieht PayPal den Betrag ein – dann kommt auch deine Rechnung." : ""}</p>
      ${mailKnopf(`${SHOP_URL}/konto/`, "Bestellung im Konto ansehen")}`),
    mailAbschnitt("Verkäufer", `<p style="margin:0;color:${F.leise};">${escapeHtml(SELLER.name)} — ${escapeHtml(SELLER.brand)}<br>${escapeHtml(SELLER.street)}<br>${escapeHtml(SELLER.city)}<br>${escapeHtml(SELLER.country)}<br>Telefon: ${escapeHtml(SELLER.phone)}<br>E-Mail: <a href="mailto:${escapeHtml(contactEmail)}" style="color:${F.text};">${escapeHtml(contactEmail)}</a></p>`),
    `<tr><td style="padding:26px 4px 30px;">
      <div style="border-top:1px solid ${F.linie};padding-top:18px;font-size:12px;line-height:1.55;color:${F.leise};white-space:pre-wrap;"><p>Vertragsinformationen · Fassung ${escapeHtml(contract.version)}</p>${contract.html}</div>
      <p style="margin:14px 0 0;font-size:12px;color:${F.leise};">Alle Bedingungen: <a href="${SHOP_URL}/agb/" style="color:${F.text};">${SHOP_URL}/agb/</a></p>
    </td></tr>`,
  ].join("");
  const html = kundenmailRahmen({
    titel: "Danke für deine Bestellung",
    eyebrow: "Bestellbestätigung",
    kopf,
    inhalt,
    vorschau: `Bestellung ${number} · ${items.length} ${items.length === 1 ? "Stück" : "Stücke"} · ${euroAmount(total, currency)}`,
  });

  return { subject, text, html, invoice };
}

// ---------------------------------------------------------------------------
// Versandbestaetigung
// ---------------------------------------------------------------------------

// Deutsche Post/DHL-Sendungsverfolgung. Gleiche Quelle wie im Kundenkonto -
// stuende der Link an zwei Stellen, koennte einer davon veralten.
export const DHL_TRACKING_BASE =
  "https://www.dhl.de/de/privatkunden/pakete-empfangen/verfolgen.html?piececode=";

const CARRIER_TRACKING = [
  [/^DHL\s*EXPRESS\b/, "https://www.dhl.com/de-de/home/tracking/tracking-express.html?submit=1&tracking-id="],
  [/^DPD\b/, "https://tracking.dpd.de/status/de_DE/parcel/"],
  [/^UPS\b/, "https://www.ups.com/track?loc=de_DE&tracknum="],
  [/^GLS\b/, "https://gls-group.com/DE/de/paketverfolgung?match="],
];

export function trackingUrlFor(carrier, trackingNumber) {
  const nummer = safeText(trackingNumber || "", 60).trim();
  if (!nummer) return "";
  const dienst = safeText(carrier || "DHL", 40).trim().toUpperCase();
  // Nur fuer bekannte Dienste wird ein Link gebaut. Bei einem unbekannten
  // Dienst steht die Nummer ohne Link in der Mail, statt auf eine geratene
  // Adresse zu zeigen.
  if (dienst === "DHL" || dienst === "DEUTSCHE POST") return DHL_TRACKING_BASE + encodeURIComponent(nummer);
  // Packlink PRO bucht bei DPD, UPS, GLS und DHL Express.
  const weitere = CARRIER_TRACKING.find(([muster]) => muster.test(dienst));
  if (weitere) return weitere[1] + encodeURIComponent(nummer);
  return "";
}

export function formatShippingConfirmation(order = {}, options = {}) {
  const number = safeText(order.order_number || order.orderNumber || "", 80) || "—";
  const carrier = safeText(order.carrier || "DHL", 40) || "DHL";
  const tracking = safeText(order.tracking_number || order.trackingNumber || "", 60);
  const url = trackingUrlFor(carrier, tracking);
  const contactEmail = safeText(options.contactEmail || "", 200);
  const items = Array.isArray(order.items) ? order.items : [];
  const titles = items.map(item => safeText(item.title_snapshot || item.title || "", 180)).filter(Boolean);
  // Wer zurueckschicken will, findet den Weg direkt hier - die Bestellnummer
  // ist auf der Widerrufsseite schon eingetragen.
  const widerrufLink = number !== "—" ? `${WIDERRUF_URL}?bestellung=${encodeURIComponent(number)}` : WIDERRUF_URL;

  const subject = `Deine Bestellung ${number} ist unterwegs`;

  const text = [
    "DISORDER119",
    "",
    `Deine Bestellung ${number} ist unterwegs.`,
    "",
    ...(titles.length ? ["IM PAKET", ...titles.map(title => `· ${title}`), ""] : []),
    ...(tracking ? [`Sendungsnummer: ${tracking} (${carrier})`] : [`Versand mit ${carrier}.`]),
    ...(url ? [`Verfolgen: ${url}`] : []),
    "",
    "Bis die Sendung beim Dienstleister erfasst ist, kann es ein paar Stunden dauern.",
    "",
    `Passt etwas nicht? Innerhalb von 14 Tagen nach Erhalt kannst du hier widerrufen: ${widerrufLink}`,
    "",
    ...(contactEmail ? [`Fragen? Antworte einfach auf diese Mail oder schreib an ${contactEmail}.`] : []),
  ].join("\n");

  const F = MAIL_FARBE;
  const nummerBox = tracking
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:6px 0 22px;">
        <p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;color:${F.leise};">Sendungsnummer · ${escapeHtml(carrier)}</p>
        <div style="display:inline-block;border:1px solid ${F.text};padding:14px 20px;font-family:'Courier New',Courier,monospace;font-size:19px;font-weight:700;letter-spacing:0.08em;color:${F.text};">${escapeHtml(tracking)}</div>
      </td></tr></table>
      ${url ? mailKnopf(url, "Sendung verfolgen") : ""}`
    : `<p style="margin:0;text-align:center;color:${F.leise};">Versand mit ${escapeHtml(carrier)}.</p>`;
  const kopf = `<p style="margin:0 auto;max-width:440px;color:${F.leise};">Bestellung <strong style="color:${F.text};">${escapeHtml(number)}</strong> hat unser Lager verlassen.</p>`;
  const inhalt = [
    `<tr><td style="padding:26px 4px 0;">${nummerBox}</td></tr>`,
    items.length ? mailAbschnitt("Im Paket", `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid ${F.linie};">${items.map(item => stueckZeile(item, null)).join("")}</table>`) : "",
    `<tr><td style="padding:24px 4px 30px;">
      <p style="margin:0;font-size:13px;color:${F.leise};">Bis die Sendung beim Paketdienst erfasst ist, kann es ein paar Stunden dauern.${contactEmail ? ` Fragen? Antworte einfach auf diese Mail oder schreib an <a href="mailto:${escapeHtml(contactEmail)}" style="color:${F.text};">${escapeHtml(contactEmail)}</a>.` : ""}</p>
      <p style="margin:12px 0 0;font-size:13px;color:${F.leise};">Passt etwas nicht? Innerhalb von 14 Tagen nach Erhalt kannst du <a href="${escapeHtml(widerrufLink)}" style="color:${F.text};">den Vertrag hier widerrufen</a>.</p>
    </td></tr>`,
  ].join("");
  const html = kundenmailRahmen({
    titel: "Dein Paket ist unterwegs",
    eyebrow: "Versandbestätigung",
    kopf,
    inhalt,
    vorschau: tracking ? `Sendungsnummer ${tracking} · ${carrier}` : `Bestellung ${number} ist unterwegs`,
  });

  return { subject, text, html };
}

// ---------------------------------------------------------------------------
// Versand
// ---------------------------------------------------------------------------

export async function sendMail(env, message = {}) {
  if (!mailTransportReady(env)) return { sent: false, reason: "NOT_CONFIGURED" };
  const to = normalizeEmail(message.to);
  if (!to) return { sent: false, reason: "INVALID_RECIPIENT" };
  const subject = safeText(message.subject || "", 200);
  if (!subject) return { sent: false, reason: "EMPTY_SUBJECT" };

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
  const items = await env.DB.prepare(`SELECT article_no,title_snapshot,unit_price_cents,bild
    FROM order_items WHERE order_id=? ORDER BY id`).bind(String(orderId)).all();
  let versand = null;
  try {
    versand = await env.DB.prepare("SELECT art,carrier FROM order_versand WHERE order_id=? LIMIT 1").bind(String(orderId)).first();
  } catch { versand = null; }
  const contact = await env.DB.prepare(`SELECT email,recipient_name,given_name,surname,
      address_line1,address_line2,postal_code,city,region,country_code
    FROM order_contact_snapshots WHERE order_id=? LIMIT 1`).bind(String(orderId)).first();
  return { ...order, items: items?.results || [], contact: contact || {}, versand: versand || null };
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
      message=formatOrderConfirmation(order,{contactEmail:mailSenderIdentity(env).email||safeText(env.MAIL_REPLY_TO||'',200),taxProfile:invoiceProfile(env,SELLER),zahlung:await zahlungsModus(env,order.id)});
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
export function formatInvoiceMail(order = {}, invoice = {}, options = {}) {
  const contactEmail = safeText(options.contactEmail || "", 200);
  const number = safeText(order.order_number || invoice.number || "", 80) || "—";
  const betrag = euroAmount(order.total_cents ?? 0, order.currency || "EUR");
  const einleitung = `Den Betrag für deine Bestellung ${number} (${betrag}) haben wir jetzt über PayPal eingezogen. Hier ist deine Rechnung.`;
  const subject = `Deine Rechnung zur Bestellung ${number} – DISORDER119`;
  const text = [
    "DISORDER119",
    "",
    einleitung,
    "",
    String(invoice.text || ""),
    "",
    ...(contactEmail ? [`Fragen? Antworte einfach auf diese Mail oder schreib an ${contactEmail}.`] : ["Fragen? Antworte einfach auf diese Mail."]),
  ].join("\n");
  const F = MAIL_FARBE;
  const kopf = `<p style="margin:0 auto;max-width:440px;color:${F.leise};">${escapeHtml(einleitung)}</p>`;
  const inhalt = [
    `<tr><td>${invoice.fragment || ""}</td></tr>`,
    fragenZeile(contactEmail),
  ].join("");
  const html = kundenmailRahmen({ titel: "Deine Rechnung", eyebrow: "Rechnung", kopf, inhalt, vorschau: `Rechnung ${number} · ${betrag}` });
  return { subject, text, html, invoice };
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
    const message = formatInvoiceMail(order, invoice, { contactEmail });
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
  const items = await env.DB.prepare(`SELECT title_snapshot,article_no,bild FROM order_items
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

  const message = formatShippingConfirmation(order, {
    contactEmail: mailSenderIdentity(env).email || safeText(env.MAIL_REPLY_TO || "", 200),
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
// deutscher Zeit, nicht nach UTC.
export function berlinZeit(value) {
  const date = value instanceof Date ? value : new Date(String(value || ""));
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("de-DE", {
    timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit", timeZoneName: "short",
  }).format(date);
}

export function berlinDatum(value) {
  const date = value instanceof Date ? value : new Date(String(value || ""));
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
}

function rueckAdresseZeilen() {
  return [`${SELLER.name} — ${SELLER.brand}`, SELLER.street, SELLER.city, SELLER.country];
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

function fragenZeile(contactEmail) {
  const F = MAIL_FARBE;
  return `<tr><td style="padding:10px 4px 30px;">
      <p style="margin:0;font-size:13px;color:${F.leise};">${contactEmail
        ? `Fragen? Antworte einfach auf diese Mail oder schreib an <a href="mailto:${escapeHtml(contactEmail)}" style="color:${F.text};">${escapeHtml(contactEmail)}</a>.`
        : "Fragen? Antworte einfach auf diese Mail."}</p>
    </td></tr>`;
}

// So kommt die Ware zurueck - fuer die Eingangsbestaetigung und fuer
// "Ruecksendung anlegen" in der Admin-App.
function ruecksendeSchritte(nummer) {
  return [
    `Pack die Ware sicher ein und leg einen Zettel mit deiner Bestellnummer ${nummer} bei.`,
    "Schick das Paket an die Adresse unten – am besten mit Sendungsnummer. Heb den Einlieferungsbeleg auf, er gilt als Nachweis.",
    "Bitte innerhalb von 14 Tagen, nachdem du uns den Widerruf mitgeteilt hast. Es reicht, wenn du das Paket vor Ablauf der Frist abschickst.",
    "Die unmittelbaren Kosten der Rücksendung trägst du (siehe Widerrufsbelehrung).",
  ];
}

function ruecksendeHtml(nummer) {
  const F = MAIL_FARBE;
  const schritte = ruecksendeSchritte(nummer)
    .map((schritt, i) => `<tr><td valign="top" style="padding:0 12px 10px 0;font-weight:700;color:${F.text};">${i + 1}.</td><td style="padding:0 0 10px;color:${F.leise};">${escapeHtml(schritt)}</td></tr>`)
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${schritte}</table>
    <div style="margin:10px 0 0;border:1px solid ${F.text};padding:14px 18px;font-size:15px;line-height:1.5;color:${F.text};">${rueckAdresseZeilen().map(escapeHtml).join("<br>")}</div>`;
}

const ERSTATTUNGS_WEG = "Das Geld geht über PayPal an dieselbe Zahlungsquelle zurück, mit der du bezahlt hast. "
  + "Auf dein PayPal-Guthaben meist sofort, auf Bankkonto oder Karte kann es ein paar Werktage dauern.";

const GELD_NACH_RUECKSENDUNG = "Sobald die Ware bei uns ist oder du uns den Versand nachweist, erstatten wir dir den Kaufpreis "
  + "– beim Widerruf der ganzen Bestellung auch die Standard-Versandkosten – über PayPal. Du bekommst eine Mail, sobald das Geld raus ist.";

// Storno einer nur reservierten Zahlung: es ist nie Geld geflossen.
const RESERVIERUNG_AUFGEHOBEN = "Abgebucht wurde nichts. Je nach Bank oder Karte kann die Vormerkung noch ein paar Tage "
  + "in deinem Konto zu sehen sein – sie verschwindet dann von selbst.";

// order: Bestellung; auftrag: Zeile aus erstattungsauftraege.
export function formatRefundConfirmation(order = {}, auftrag = {}, options = {}) {
  const contactEmail = safeText(options.contactEmail || "", 200);
  const number = safeText(order.order_number || "", 80) || "—";
  const betrag = euroAmount(auftrag.betrag_cents);
  const anlass = String(auftrag.anlass || "");
  let artikel = [];
  try { artikel = JSON.parse(auftrag.artikel_json || "[]") || []; } catch { artikel = []; }
  const versand = Number(auftrag.versand_cents || 0);
  const abzug = Number(auftrag.abzug_cents || 0);
  const warenwert = artikel.reduce((summe, a) => summe + Number(a.preisCents || 0), 0);
  // Die Aufschluesselung nur zeigen, wenn sie auf den Cent aufgeht.
  const aufschluesseln = anlass !== "KULANZ" && artikel.length > 0 && warenwert + versand - abzug === Number(auftrag.betrag_cents);
  const grund = safeText(auftrag.kunden_grund || "", 300);
  const abzugGrund = safeText(auftrag.abzug_grund || "", 300);

  const freigegeben = String(auftrag.ergebnis || "") === "FREIGEGEBEN";
  let subject;
  let titel;
  let eyebrow;
  let einleitung;
  if (freigegeben) {
    subject = `Deine Bestellung ${number} ist storniert – nichts abgebucht`;
    titel = "Bestellung storniert";
    eyebrow = anlass === "WIDERRUF" ? "Widerruf" : "Stornierung";
    einleitung = `Deine Bestellung ${number} ist storniert. Die Zahlung über ${betrag} war bei PayPal nur reserviert – wir haben die Reservierung aufgehoben.`;
  } else if (anlass === "KULANZ") {
    subject = `Wir haben dir ${betrag} erstattet – Bestellung ${number}`;
    titel = "Geld ist unterwegs";
    eyebrow = "Erstattung";
    einleitung = `Für deine Bestellung ${number} haben wir dir ${betrag} über PayPal erstattet.`;
  } else if (Number(auftrag.vor_versand) === 1) {
    subject = `Deine Bestellung ${number} ist storniert – ${betrag} erstattet`;
    titel = "Bestellung storniert";
    eyebrow = anlass === "WIDERRUF" ? "Widerruf" : "Stornierung";
    einleitung = `Deine Bestellung ${number} ist storniert. Wir haben dir den vollen Betrag von ${betrag} über PayPal zurückgezahlt.`;
  } else {
    subject = `Deine Rücksendung ist angekommen – ${betrag} erstattet`;
    titel = "Rücksendung erstattet";
    eyebrow = anlass === "WIDERRUF" ? "Widerruf" : "Rücksendung";
    einleitung = `Deine Rücksendung zur Bestellung ${number} ist bei uns angekommen. Wir haben dir ${betrag} über PayPal zurückgezahlt.`;
  }

  const artikelText = a => `· ${safeText(a.titel || "Artikel", 180)}${a.artikelNr ? ` (Art.-Nr. ${safeText(a.artikelNr, 40)})` : ""}${aufschluesseln ? ` — ${euroAmount(a.preisCents)}` : ""}`;
  const text = [
    "DISORDER119",
    "",
    einleitung,
    ...(grund ? ["", `Grund: ${grund}`] : []),
    "",
    ...(artikel.length ? [anlass === "KULANZ" ? "BETRIFFT" : "ERSTATTET", ...artikel.map(artikelText), ""] : []),
    ...(aufschluesseln && versand ? [`Versandkosten: ${euroAmount(versand)}`] : []),
    ...(aufschluesseln && abzug ? [`Abzug: −${euroAmount(abzug)}${abzugGrund ? ` (${abzugGrund})` : ""}`] : []),
    freigegeben ? `Nicht abgebucht: ${betrag}` : `Erstattet: ${betrag}`,
    "",
    freigegeben ? RESERVIERUNG_AUFGEHOBEN : ERSTATTUNGS_WEG,
    "",
    ...(contactEmail ? [`Fragen? Antworte einfach auf diese Mail oder schreib an ${contactEmail}.`] : ["Fragen? Antworte einfach auf diese Mail."]),
  ].join("\n");

  const F = MAIL_FARBE;
  const kopf = `<p style="margin:0 auto;max-width:440px;color:${F.leise};">${escapeHtml(einleitung)}</p>`;
  const liste = artikel.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid ${F.linie};">
        ${artikel.map(a => stueckZeile({ title: a.titel, article_no: a.artikelNr, bild: a.bild }, aufschluesseln ? euroAmount(a.preisCents) : null)).join("")}
      </table>`
    : "";
  const summen = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:6px;">
      ${aufschluesseln && versand ? betragsZeile("Versandkosten", euroAmount(versand)) : ""}
      ${aufschluesseln && abzug ? betragsZeile(`Abzug${abzugGrund ? ` · ${abzugGrund}` : ""}`, `−${euroAmount(abzug)}`) : ""}
      ${betragsZeile(freigegeben ? "Nicht abgebucht" : "Erstattet", betrag, true)}
    </table>`;
  const inhalt = [
    grund ? mailAbschnitt("Grund", leise(escapeHtml(grund)), false) : "",
    mailAbschnitt(anlass === "KULANZ" ? "Betrag" : artikel.length > 1 ? `${artikel.length} Stücke` : freigegeben ? "Storniert" : "Erstattet", `${liste}${summen}`, Boolean(grund)),
    freigegeben
      ? mailAbschnitt("Dein Geld", leise(escapeHtml(RESERVIERUNG_AUFGEHOBEN)))
      : mailAbschnitt("Wann das Geld da ist", leise(escapeHtml(ERSTATTUNGS_WEG))),
    fragenZeile(contactEmail),
  ].join("");
  const html = kundenmailRahmen({ titel, eyebrow, kopf, inhalt,
    vorschau: freigegeben ? `Storniert · nichts abgebucht · Bestellung ${number}` : `${betrag} über PayPal erstattet · Bestellung ${number}` });
  return { subject, text, html };
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

  const message = formatRefundConfirmation(order, auftrag, {
    contactEmail: mailSenderIdentity(env).email || safeText(env.MAIL_REPLY_TO || "", 200),
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
  const contactEmail = safeText(options.contactEmail || "", 200);
  const number = safeText(order.order_number || "", 80) || "—";
  const items = Array.isArray(order.items) ? order.items : [];
  const subject = `So schickst du deine Bestellung ${number} zurück`;
  const eingang = options.widerrufAm ? berlinZeit(options.widerrufAm) : "";
  const einleitung = eingang
    ? `Wir haben deinen Widerruf zur Bestellung ${number} am ${eingang} erhalten.`
    : `Du möchtest deine Bestellung ${number} zurückschicken.`;
  const text = [
    "DISORDER119",
    "",
    `${einleitung} So geht es weiter:`,
    "",
    ...(items.length ? ["BETRIFFT", ...items.map(item => `· ${safeText(item.title_snapshot || item.title || "Artikel", 180)}`), ""] : []),
    "SO SCHICKST DU ZURÜCK",
    ...ruecksendeSchritte(number).map((schritt, i) => `${i + 1}. ${schritt}`),
    "",
    "RÜCKSENDEADRESSE",
    ...rueckAdresseZeilen(),
    "",
    "DEIN GELD",
    GELD_NACH_RUECKSENDUNG,
    "",
    ...(contactEmail ? [`Fragen? Antworte einfach auf diese Mail oder schreib an ${contactEmail}.`] : ["Fragen? Antworte einfach auf diese Mail."]),
  ].join("\n");
  const F = MAIL_FARBE;
  const kopf = `<p style="margin:0 auto;max-width:440px;color:${F.leise};">${escapeHtml(einleitung)} So geht es weiter.</p>`;
  const inhalt = [
    items.length ? mailAbschnitt("Betrifft", `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid ${F.linie};">${items.map(item => stueckZeile(item, null)).join("")}</table>`, false) : "",
    mailAbschnitt("So schickst du zurück", ruecksendeHtml(number), Boolean(items.length)),
    mailAbschnitt("Dein Geld", leise(escapeHtml(GELD_NACH_RUECKSENDUNG))),
    fragenZeile(contactEmail),
  ].join("");
  const html = kundenmailRahmen({ titel: "So geht die Rücksendung", eyebrow: "Rücksendung", kopf, inhalt, vorschau: `Rücksendung zur Bestellung ${number}` });
  return { subject, text, html };
}

export async function sendReturnInstructions(env, orderId, reqId = crypto.randomUUID(), { widerrufAm = null, schluessel = "" } = {}) {
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
  const message = formatReturnInstructions(order, {
    contactEmail: mailSenderIdentity(env).email || safeText(env.MAIL_REPLY_TO || "", 200),
    widerrufAm,
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

// Eingangsbestaetigung nach § 356a BGB: unverzueglich, auf einem dauerhaften
// Datentraeger, mit dem Inhalt der Erklaerung sowie Datum und Uhrzeit des
// Eingangs. Sie bestaetigt bewusst nur den Eingang - ob der Widerruf
// wirksam ist, steht nicht darin.
//
// lage: "VERSENDET" (Anleitung zur Ruecksendung), "NICHT_VERSENDET" (wir
// halten an und erstatten) oder "OFFEN" (noch keiner Bestellung zugeordnet).
export function formatWithdrawalReceipt(widerruf = {}, options = {}) {
  const contactEmail = safeText(options.contactEmail || "", 200);
  const lage = options.lage || "OFFEN";
  const eingang = berlinZeit(widerruf.eingegangen_at);
  const nummer = safeText(widerruf.bestellnummer_eingabe || "", 80) || "—";
  const vorgang = safeText(widerruf.id || "", 80).replace(/-/g, "").slice(0, 8).toUpperCase();
  const umfang = widerruf.umfang === "TEIL"
    ? `Widerruf für folgende Stücke: ${safeText(widerruf.teile_text || "", 600)}`
    : "Widerruf des ganzen Vertrags";
  const felder = [
    ["Name", safeText(widerruf.name || "", 120)],
    ["E-Mail", safeText(widerruf.email || "", 200)],
    ["Bestellung", nummer],
    ["Erklärung", umfang],
    ...(widerruf.nachricht ? [["Nachricht", safeText(widerruf.nachricht, 1000)]] : []),
    ["Eingegangen", eingang],
    ["Vorgang", vorgang],
  ];
  const items = Array.isArray(options.items) ? options.items : [];
  const subject = `Eingangsbestätigung: dein Widerruf vom ${berlinDatum(widerruf.eingegangen_at)}`;
  const weiter = lage === "VERSENDET"
    ? "Bitte schick uns die Ware zurück, wie unten beschrieben. Sobald sie bei uns ist oder du uns den Versand nachweist, erstatten wir dir alle Zahlungen über PayPal – beim Widerruf der ganzen Bestellung einschließlich der Standard-Versandkosten –, spätestens 14 Tage nach Eingang deines Widerrufs. Du bekommst eine Mail, sobald das Geld raus ist."
    : lage === "NICHT_VERSENDET" && options.reserviert
      ? "Deine Bestellung ist noch nicht verschickt, und abgebucht ist noch nichts – PayPal hat den Betrag nur reserviert. Wir halten die Bestellung an und heben die Reservierung auf. Du bekommst eine Mail, sobald das erledigt ist. Sollte dein Paket doch schon unterwegs sein, melden wir uns bei dir."
    : lage === "NICHT_VERSENDET"
      ? "Deine Bestellung ist noch nicht verschickt. Wir halten sie an und erstatten dir den vollen Betrag über PayPal. Du bekommst eine Mail, sobald das Geld zurück ist. Sollte dein Paket doch schon unterwegs sein, melden wir uns bei dir."
      : "Wir ordnen deine Erklärung jetzt deiner Bestellung zu und schicken dir die nächsten Schritte. Falls wir dafür etwas von dir brauchen, melden wir uns.";

  const text = [
    "DISORDER119",
    "",
    "EINGANGSBESTÄTIGUNG",
    `Deine Widerrufserklärung ist am ${eingang} bei uns eingegangen.`,
    "Diese Mail bestätigt den Eingang deiner Erklärung mit ihrem Inhalt.",
    "",
    "DEINE ERKLÄRUNG",
    ...felder.map(([label, wert]) => `${label}: ${wert}`),
    "",
    ...(items.length ? ["DEINE BESTELLUNG", ...items.map(item => `· ${safeText(item.title_snapshot || item.title || "Artikel", 180)}`), ""] : []),
    "WIE ES WEITERGEHT",
    weiter,
    ...(lage === "VERSENDET"
      ? ["", "SO SCHICKST DU ZURÜCK", ...ruecksendeSchritte(nummer).map((s, i) => `${i + 1}. ${s}`), "", "RÜCKSENDEADRESSE", ...rueckAdresseZeilen()]
      : []),
    "",
    ...(contactEmail ? [`Fragen? Antworte einfach auf diese Mail oder schreib an ${contactEmail}.`] : ["Fragen? Antworte einfach auf diese Mail."]),
  ].join("\n");

  const F = MAIL_FARBE;
  const tabelle = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid ${F.linie};">
    ${felder.map(([label, wert]) => `<tr>
      <td valign="top" width="120" style="padding:10px 12px 10px 0;border-bottom:1px solid ${F.linie};font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:${F.leise};">${escapeHtml(label)}</td>
      <td style="padding:10px 0;border-bottom:1px solid ${F.linie};color:${F.text};white-space:pre-wrap;">${escapeHtml(wert)}</td>
    </tr>`).join("")}
  </table>`;
  const kopf = `<p style="margin:0 auto 8px;max-width:440px;color:${F.leise};">Deine Widerrufserklärung ist am <strong style="color:${F.text};">${escapeHtml(eingang)}</strong> bei uns eingegangen.</p>
    <p style="margin:0 auto;max-width:440px;font-size:13px;color:${F.leise};">Diese Mail bestätigt den Eingang deiner Erklärung mit ihrem Inhalt.</p>`;
  const inhalt = [
    mailAbschnitt("Deine Erklärung", tabelle, false),
    items.length ? mailAbschnitt("Deine Bestellung", `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid ${F.linie};">${items.map(item => stueckZeile(item, null)).join("")}</table>`) : "",
    mailAbschnitt("Wie es weitergeht", leise(escapeHtml(weiter))),
    lage === "VERSENDET" ? mailAbschnitt("So schickst du zurück", ruecksendeHtml(nummer)) : "",
    fragenZeile(contactEmail),
  ].join("");
  const html = kundenmailRahmen({ titel: "Widerruf eingegangen", eyebrow: "Eingangsbestätigung", kopf, inhalt, vorschau: `Eingegangen am ${eingang}` });
  return { subject, text, html };
}

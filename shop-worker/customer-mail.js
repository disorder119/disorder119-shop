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
};

export const SHOP_URL = "https://disorder119.com";

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
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Widerrufsbelehrung. Wortgleich zur AGB-Seite (build_site.py, Abschnitt 6).
// ---------------------------------------------------------------------------
export function widerrufsbelehrungText(contactEmail) {
  const anschrift = `${SELLER.name}, ${SELLER.brand}, ${SELLER.street}, ${SELLER.city}, E-Mail: ${contactEmail}`;
  return [
    "WIDERRUFSBELEHRUNG",
    "",
    "Widerrufsrecht",
    "Du hast das Recht, binnen vierzehn Tagen ohne Angabe von Gründen diesen Vertrag zu widerrufen. "
      + "Die Widerrufsfrist beträgt vierzehn Tage ab dem Tag, an dem du oder ein von dir benannter Dritter, "
      + "der nicht der Beförderer ist, die Waren in Besitz genommen hast bzw. hat. "
      + `Um dein Widerrufsrecht auszuüben, musst du uns (${anschrift}) mittels einer eindeutigen Erklärung `
      + "(z. B. ein mit der Post versandter Brief oder eine E-Mail) über deinen Entschluss, diesen Vertrag zu "
      + "widerrufen, informieren. Zur Wahrung der Widerrufsfrist reicht es aus, dass du die Mitteilung über die "
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

export function formatOrderConfirmation(order = {}, options = {}) {
  const invoice=renderInvoice(order,options.taxProfile||invoiceProfile({},SELLER),options.issuedAt);
  const documentNote=invoice.ready?'Die folgende Rechnung gehört zu deiner Vertragsbestätigung.':'Dies ist deine Vertragsbestätigung. Eine Rechnung wird nach Klärung der Rechnungsangaben separat bereitgestellt.';
  const contactEmail = safeText(options.contactEmail || "", 200) || "kontakt@disorder119.com";
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
    "Die Zahlung ist bei uns eingegangen. Damit ist der Kaufvertrag geschlossen.",
    documentNote,
    "",
    "BESTELLUNG",
    ...itemTextLines,
    "",
    `Zwischensumme: ${euroAmount(subtotal, currency)}`,
    `${versandBezeichnung(order)}: ${euroAmount(shipping, currency)}`,
    `Gesamt: ${euroAmount(total, currency)}`,
    "Zahlungsart: PayPal",
    ...(invoice.ready?[invoice.text]:[]),
    "",
    ...(delivery.length ? ["LIEFERADRESSE", ...delivery, ""] : []),
    "WIE ES WEITERGEHT",
    (items.length > 1 ? "Deine Stücke werden" : "Dein Teil wird") + " von Hand verpackt und in der Regel innerhalb von zwei Werktagen "
      + "versendet. Sobald das Paket unterwegs ist, bekommst du eine Mail mit der Sendungsnummer.",
    "",
    `Deine Bestellung im Konto: ${SHOP_URL}/konto/`,
    "",
    "VERKÄUFER",
    sellerBlockText(),
    `E-Mail: ${contactEmail}`,
    "",
    widerrufsbelehrungText(contactEmail),
    "",
    `Alle Bedingungen: ${SHOP_URL}/agb/`,
  ].join("\n");

  const F = MAIL_FARBE;
  const summenZeile = (label, wert, stark) => `<tr>
    <td style="padding:${stark ? "14px 0 0" : "8px 0 0"};${stark ? `font-size:17px;font-weight:700;color:${F.text};` : `color:${F.leise};`}">${escapeHtml(label)}</td>
    <td align="right" style="padding:${stark ? "14px 0 0" : "8px 0 0"};white-space:nowrap;${stark ? `font-size:17px;font-weight:700;color:${F.text};` : `color:${F.leise};`}">${escapeHtml(wert)}</td>
  </tr>`;
  const kopf = `<p style="margin:0 auto 8px;max-width:440px;color:${F.leise};">Bestellung <strong style="color:${F.text};">${escapeHtml(number)}</strong> vom ${escapeHtml(ordered)}</p>
    <p style="margin:0 auto;max-width:440px;font-size:13px;color:${F.leise};">Die Zahlung ist eingegangen — damit ist der Kaufvertrag geschlossen. ${escapeHtml(documentNote)}</p>`;
  const stuecke = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid ${F.linie};">
      ${items.map(item => stueckZeile(item, euroAmount(item.unit_price_cents ?? item.unitPriceCents ?? 0, currency))).join("")}
    </table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:6px;">
      ${summenZeile("Zwischensumme", euroAmount(subtotal, currency), false)}
      ${summenZeile(versandBezeichnung(order), euroAmount(shipping, currency), false)}
      ${summenZeile("Gesamt", euroAmount(total, currency), true)}
    </table>
    <p style="margin:14px 0 0;font-size:12px;color:${F.leise};">Zahlungsart: PayPal</p>`;
  const inhalt = [
    ...(invoice.ready?[`<tr><td>${invoice.fragment}</td></tr>`]:[]),
    mailAbschnitt(items.length > 1 ? `Deine ${items.length} Stücke` : "Dein Stück", stuecke, false),
    delivery.length ? mailAbschnitt("Lieferadresse", `<p style="margin:0;">${delivery.map(escapeHtml).join("<br>")}</p>`) : "",
    mailAbschnitt("Wie es weitergeht", `<p style="margin:0 0 22px;color:${F.leise};">${items.length > 1 ? "Deine Stücke werden" : "Dein Teil wird"} von Hand verpackt und in der Regel innerhalb von zwei Werktagen versendet. Sobald das Paket unterwegs ist, bekommst du eine Mail mit der Sendungsnummer und dem Link zur Sendungsverfolgung.</p>
      ${mailKnopf(`${SHOP_URL}/konto/`, "Bestellung im Konto ansehen")}`),
    mailAbschnitt("Verkäufer", `<p style="margin:0;color:${F.leise};">${escapeHtml(SELLER.name)} — ${escapeHtml(SELLER.brand)}<br>${escapeHtml(SELLER.street)}<br>${escapeHtml(SELLER.city)}<br>${escapeHtml(SELLER.country)}<br>E-Mail: <a href="mailto:${escapeHtml(contactEmail)}" style="color:${F.text};">${escapeHtml(contactEmail)}</a></p>`),
    `<tr><td style="padding:26px 4px 30px;">
      <div style="border-top:1px solid ${F.linie};padding-top:18px;font-size:12px;line-height:1.55;color:${F.leise};white-space:pre-wrap;">${escapeHtml(widerrufsbelehrungText(contactEmail))}</div>
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
      message=formatOrderConfirmation(order,{contactEmail:mailSenderIdentity(env).email||safeText(env.MAIL_REPLY_TO||'',200),taxProfile:invoiceProfile(env,SELLER)});
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

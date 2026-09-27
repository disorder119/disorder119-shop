// Schwarzes DISORDER119-Mail-Design fuer Newsletter-Mails: Rahmen, Code-Box,
// Knopf und ein Raster mit den neuesten Stuecken aus dem Archiv.
//
// Mail-Programme koennen kein modernes CSS (Outlook, Gmail): deshalb
// Tabellen und Inline-Styles. Die Artikel kommen aus dem oeffentlichen
// catalog.json der Website, die Bilder direkt von disorder119.com - die
// freigestellten Fotos stehen auf Schwarz wie im Shop.
import { SELLER, SHOP_URL, escapeHtml } from "./customer-mail.js";

export const FARBE = Object.freeze({
  grund: "#000000",
  flaeche: "#0d0d0d",
  text: "#f2efe7",
  leise: "#9c978d",
  linie: "#2b2a27",
});

const SCHRIFT = "'Helvetica Neue',Helvetica,Arial,sans-serif";

function sprache(lang) {
  return lang === "en" || lang === "fr" ? lang : "de";
}

export function shopHome(lang) {
  return `${SHOP_URL}/${sprache(lang) === "de" ? "" : `${sprache(lang)}/`}`;
}

function preisText(preis, lang) {
  const betrag = Number(preis) || 0;
  const locale = { de: "de-DE", en: "en-GB", fr: "fr-FR" }[sprache(lang)];
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency", currency: "EUR",
      minimumFractionDigits: Number.isInteger(betrag) ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(betrag);
  } catch {
    return `${betrag} €`;
  }
}

// Neueste verfuegbare Stuecke: hoechste Artikel-ID zuerst, nur mit Preis und
// Bild. Faellt der Abruf aus, kommt die Mail eben ohne Raster - nie ohne Code.
export async function neuesteArtikel(anzahl = 4, lang = "de", fetcher = fetch) {
  try {
    const res = await fetcher(`${SHOP_URL}/data/catalog.json`, { cf: { cacheTtl: 600, cacheEverything: true } });
    if (!res || !res.ok) return [];
    const daten = await res.json();
    const liste = Array.isArray(daten) ? daten : Array.isArray(daten?.items) ? daten.items : [];
    return liste
      .filter(it => it && it.public_status === "AVAILABLE" && Number(it.price) > 0 && (it.grid_image || it.look))
      .sort((a, b) => Number(b.id) - Number(a.id))
      .slice(0, Math.max(0, Math.min(12, Number(anzahl) || 0)))
      .map(it => ({
        id: it.id,
        marke: String(it.brand || "").slice(0, 60),
        titel: String(it.title || "").slice(0, 90),
        preis: preisText(it.price, lang),
        bild: `${SHOP_URL}/${String(it.grid_image || it.look).replace(/^\/+/, "")}`,
        link: `${shopHome(lang)}artikel/${encodeURIComponent(it.id)}/`,
      }));
  } catch {
    return [];
  }
}

export function knopf(href, label) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;"><tr><td style="background:${FARBE.text};">` +
    `<a href="${escapeHtml(href)}" style="display:inline-block;padding:15px 28px;font-family:${SCHRIFT};font-size:13px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:${FARBE.grund};text-decoration:none;">${escapeHtml(label)}</a>` +
    "</td></tr></table>";
}

export function codeBox(code, hinweis) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:6px 0 0;">` +
    `<div style="display:inline-block;border:1px solid ${FARBE.text};padding:18px 26px;font-family:'Courier New',Courier,monospace;font-size:24px;font-weight:700;letter-spacing:0.12em;color:${FARBE.text};">${escapeHtml(code)}</div>` +
    (hinweis ? `<p style="margin:12px 0 0;font-family:${SCHRIFT};font-size:12px;letter-spacing:0.06em;color:${FARBE.leise};">${escapeHtml(hinweis)}</p>` : "") +
    "</td></tr></table>";
}

// Zwei Spalten, auf dem Handy bleiben es zwei schmale - Mail-Programme
// koennen kein verlaessliches Umbrechen.
export function artikelRaster(artikel, ueberschrift) {
  if (!artikel || !artikel.length) return "";
  const zellen = artikel.map(a =>
    `<td width="50%" valign="top" style="padding:0 8px 26px;">` +
    `<a href="${escapeHtml(a.link)}" style="text-decoration:none;color:${FARBE.text};">` +
    `<img src="${escapeHtml(a.bild)}" width="252" alt="${escapeHtml(`${a.marke} ${a.titel}`.trim())}" style="display:block;width:100%;max-width:252px;height:auto;border:0;background:${FARBE.flaeche};">` +
    `<p style="margin:12px 0 3px;font-family:${SCHRIFT};font-size:10px;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;color:${FARBE.leise};">${escapeHtml(a.marke)}</p>` +
    `<p style="margin:0 0 6px;font-family:${SCHRIFT};font-size:13px;line-height:1.4;color:${FARBE.text};">${escapeHtml(a.titel)}</p>` +
    `<p style="margin:0;font-family:${SCHRIFT};font-size:13px;font-weight:700;color:${FARBE.text};">${escapeHtml(a.preis)}</p>` +
    "</a></td>");
  const zeilen = [];
  for (let i = 0; i < zellen.length; i += 2) {
    zeilen.push(`<tr>${zellen[i]}${zellen[i + 1] || '<td width="50%" style="padding:0 8px 26px;"></td>'}</tr>`);
  }
  return (ueberschrift
    ? `<p style="margin:0 0 18px;padding-top:30px;border-top:1px solid ${FARBE.linie};font-family:${SCHRIFT};font-size:11px;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;color:${FARBE.leise};text-align:center;">${escapeHtml(ueberschrift)}</p>`
    : "") +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${zeilen.join("")}</table>`;
}

// Kleiner Bilderstreifen fuer die Bestaetigungsmail: drei Stuecke, ohne Text.
export function artikelStreifen(artikel) {
  if (!artikel || !artikel.length) return "";
  const zellen = artikel.slice(0, 3).map(a =>
    `<td width="33%" style="padding:0 4px;"><a href="${escapeHtml(a.link)}"><img src="${escapeHtml(a.bild)}" width="164" alt="${escapeHtml(`${a.marke} ${a.titel}`.trim())}" style="display:block;width:100%;max-width:164px;height:auto;border:0;background:${FARBE.flaeche};"></a></td>`);
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:30px 0 30px;"><tr>${zellen.join("")}</tr></table>`;
}

const FUSS_TEXT = {
  de: { absender: "Absender", abmelden: "Newsletter abbestellen", archiv: "Kuratiertes Archiv für Designer-, Vintage- und Contemporary-Mode." },
  en: { absender: "Sender", abmelden: "Unsubscribe", archiv: "A curated archive of designer, vintage and contemporary fashion." },
  fr: { absender: "Expéditeur", abmelden: "Se désinscrire", archiv: "Archive de mode designer, vintage et contemporaine." },
};

// Rahmen jeder Newsletter-Mail. `abmeldeLink` darf auch ein Brevo-Platzhalter
// wie {{ unsubscribe }} sein - der wird dann nicht escaped.
export function mailRahmen({ lang = "de", titel, eyebrow = "", inhalt, abmeldeLink = "", vorschau = "" }) {
  const t = FUSS_TEXT[sprache(lang)];
  const abmelden = abmeldeLink
    ? `<a href="${abmeldeLink.startsWith("{{") ? abmeldeLink : escapeHtml(abmeldeLink)}" style="color:${FARBE.leise};text-decoration:underline;">${escapeHtml(t.abmelden)}</a><br><br>`
    : "";
  return `<!DOCTYPE html>
<html lang="${sprache(lang)}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark">
<title>${escapeHtml(titel)}</title></head>
<body style="margin:0;padding:0;background:${FARBE.grund};">
${vorschau ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${FARBE.grund};">${escapeHtml(vorschau)}</div>` : ""}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${FARBE.grund};">
<tr><td align="center" style="padding:0 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
  <tr><td align="center" style="padding:40px 0 30px;border-bottom:1px solid ${FARBE.linie};">
    <a href="${escapeHtml(shopHome(lang))}" style="font-family:${SCHRIFT};font-size:15px;font-weight:700;letter-spacing:0.34em;color:${FARBE.text};text-decoration:none;">DISORDER119</a>
  </td></tr>
  <tr><td style="padding:44px 4px 12px;text-align:center;">
    ${eyebrow ? `<p style="margin:0 0 14px;font-family:${SCHRIFT};font-size:11px;font-weight:700;letter-spacing:0.22em;text-transform:uppercase;color:${FARBE.leise};">${escapeHtml(eyebrow)}</p>` : ""}
    <h1 style="margin:0 0 18px;font-family:${SCHRIFT};font-size:30px;line-height:1.15;font-weight:700;letter-spacing:-0.01em;text-transform:uppercase;color:${FARBE.text};">${escapeHtml(titel)}</h1>
    ${inhalt}
  </td></tr>
  <tr><td style="padding:30px 4px 44px;border-top:1px solid ${FARBE.linie};text-align:center;font-family:${SCHRIFT};font-size:11px;line-height:1.6;color:${FARBE.leise};">
    ${abmelden}${escapeHtml(t.archiv)}<br>
    ${escapeHtml(t.absender)}: ${escapeHtml(SELLER.name)} — ${escapeHtml(SELLER.brand)}, ${escapeHtml(SELLER.street)}, ${escapeHtml(SELLER.city)}
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
}

export function absatz(text) {
  return `<p style="margin:0 auto 26px;max-width:440px;font-family:${SCHRIFT};font-size:15px;line-height:1.6;color:${FARBE.leise};">${escapeHtml(text)}</p>`;
}

export function kleingedruckt(text) {
  return `<p style="margin:22px auto 0;max-width:420px;font-family:${SCHRIFT};font-size:12px;line-height:1.55;color:${FARBE.leise};">${escapeHtml(text)}</p>`;
}

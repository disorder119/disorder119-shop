// Postfach: Mails an kontakt@disorder119.com landen in der Admin-App.
//
// Cloudflare Email Routing leitet kontakt@ an diesen Worker (email-Handler).
// Der Worker liest die Mail, legt Absender, Betreff und Text in D1 ab, schickt
// eine Kopie an dein Gmail (MAIL_WEITERLEITUNG, muss bei Cloudflare als Ziel
// bestätigt sein) und meldet sich per Telegram, falls verbunden.
//
// Bewusst ohne Fremdbibliothek: ein kleiner MIME-Leser für Kopfzeilen
// (RFC 2047), multipart, quoted-printable und base64 reicht für Kundenmails.
// Anhänge werden nur mit Namen vermerkt, nicht gespeichert.

import { sendTelegramMessage, telegramTransportReady, telegramZeile } from "./notifications.js";
import { warenkorbAusMail, warenkorbZuordnen } from "./dhl-qr.js";
import { freieMail, normalizeEmail, sendMail } from "./customer-mail.js";

const ADMIN_ORIGINS = Object.freeze(["https://admin.disorder119.com"]);
// Rohmail bis 15 MB lesen (Cloudflare liefert bis 25 MB); Anhaenge kommen in D1,
// je Anhang hoechstens ANHANG_MAX_BYTES (D1: 2 MB je Zeile), je Mail ANHAENGE_MAX_SUMME.
const MAX_ROH_BYTES = 15 * 1024 * 1024;
export const ANHANG_MAX_BYTES = 1_900_000;
const ANHAENGE_MAX_SUMME = 12 * 1024 * 1024;
const ANHAENGE_MAX_ZAHL = 40;
const HTML_MAX = 600_000;
const MAX_TEXT = 60_000;
export const STANDARD_WEITERLEITUNG = "disorder119shop@gmail.com";

export class PostfachError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

// ------------------------------------------------------------ MIME lesen
function dekodieren(bytes, charset) {
  const name = String(charset || "utf-8").trim().toLowerCase().replace(/^"|"$/g, "");
  try { return new TextDecoder(name === "us-ascii" ? "utf-8" : name).decode(bytes); }
  catch { return new TextDecoder("utf-8").decode(bytes); }
}

function latin1Bytes(text) {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

function base64Bytes(text) {
  const sauber = String(text).replace(/[^A-Za-z0-9+/=]/g, "");
  try { return latin1Bytes(atob(sauber)); } catch { return new Uint8Array(0); }
}

function qpBytes(text, kopf = false) {
  let s = String(text);
  if (kopf) s = s.replace(/_/g, " ");
  else s = s.replace(/=\r?\n/g, "");
  const out = [];
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "=" && /^[0-9A-Fa-f]{2}$/.test(s.slice(i + 1, i + 3))) {
      out.push(parseInt(s.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      out.push(s.charCodeAt(i) & 0xff);
    }
  }
  return new Uint8Array(out);
}

// "=?UTF-8?B?...?=" und "=?iso-8859-1?Q?...?=" in Kopfzeilen. Eine Kopfzeile
// bleibt einzeilig: was die Kodierung an CR/LF, NEL, Unicode-Zeilentrennern
// oder anderen Steuerzeichen mitbringt ("=0A", B-kodiertes CR/LF), wird zum
// Leerzeichen.
export function kopfDekodieren(wert) {
  return String(wert || "")
    .replace(/\?=\s+=\?/g, "?==?")
    .replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_, charset, art, inhalt) =>
      dekodieren(art.toUpperCase() === "B" ? base64Bytes(inhalt) : qpBytes(inhalt, true), charset))
    .replace(/[\u0000-\u001f\u007f\u0085\u2028\u2029]/g, " ");
}

function kopfTeilen(block) {
  const kopf = {};
  const zeilen = block.replace(/\r?\n[ \t]+/g, " ").split(/\r?\n/);
  for (const zeile of zeilen) {
    const i = zeile.indexOf(":");
    if (i <= 0) continue;
    const name = zeile.slice(0, i).trim().toLowerCase();
    if (!(name in kopf)) kopf[name] = zeile.slice(i + 1).trim();
  }
  return kopf;
}

function parameter(wert, name) {
  const treffer = new RegExp(`${name}\\*?=\\s*("([^"]*)"|[^;\\s]+)`, "i").exec(String(wert || ""));
  if (!treffer) return "";
  let v = treffer[2] !== undefined ? treffer[2] : treffer[1];
  const rfc2231 = /^([^']*)'[^']*'(.*)$/.exec(v);
  if (rfc2231) { try { v = decodeURIComponent(rfc2231[2]); } catch {} }
  return kopfDekodieren(v);
}

function teilLesen(roh) {
  const trenn = /\r?\n\r?\n/.exec(roh);
  const kopfBlock = trenn ? roh.slice(0, trenn.index) : roh;
  const koerper = trenn ? roh.slice(trenn.index + trenn[0].length) : "";
  return { kopf: kopfTeilen(kopfBlock), koerper };
}

// Laengste HTML-Mail, die in Text umgewandelt wird (der Rest steht in der
// Kopie im Gmail). Vorher brauchten 180 KB mit vielen offenen "<style" bzw.
// "<" ohne ">" ueber 3 s Rechenzeit (quadratische Regex-Suche).
export const HTML_TEXT_MAX = 100_000;

// <style>/<script>-Bloecke ohne Regex-Rueckgriff entfernen: lineare Suche.
function bloeckeEntfernen(html) {
  const klein = html.toLowerCase();
  let aus = "";
  let pos = 0;
  while (pos < html.length) {
    const s1 = klein.indexOf("<style", pos);
    const s2 = klein.indexOf("<script", pos);
    const start = s1 < 0 ? s2 : s2 < 0 ? s1 : Math.min(s1, s2);
    if (start < 0) { aus += html.slice(pos); break; }
    aus += html.slice(pos, start);
    const ende = klein.indexOf(start === s1 ? "</style" : "</script", start);
    if (ende < 0) break; // nie geschlossen: der Rest ist Stil/Skript
    const zu = klein.indexOf(">", ende);
    pos = zu < 0 ? html.length : zu + 1;
  }
  return aus;
}

function rechtsKuerzen(zeile) {
  let ende = zeile.length;
  while (ende > 0 && (zeile[ende - 1] === " " || zeile[ende - 1] === "\t")) ende--;
  return zeile.slice(0, ende);
}

function textAusHtml(html) {
  return bloeckeEntfernen(String(html).slice(0, HTML_TEXT_MAX))
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<[^<>]*>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    // Zeilenweise statt /[ \t]+\n/: lange Leerzeichen-Folgen ohne Umbruch
    // waeren sonst wieder quadratisch.
    .split("\n").map(rechtsKuerzen).join("\n")
    .replace(/\n{3,}/g, "\n\n").trim();
}

function teilDurchgehen(roh, sammlung, tiefe = 0) {
  if (tiefe > 6) return;
  const { kopf, koerper } = teilLesen(roh);
  const typ = String(kopf["content-type"] || "text/plain").toLowerCase();
  const kodierung = String(kopf["content-transfer-encoding"] || "7bit").toLowerCase();
  const disposition = String(kopf["content-disposition"] || "");
  const dateiname = parameter(disposition, "filename") || parameter(kopf["content-type"], "name");
  if (typ.startsWith("multipart/")) {
    const grenze = parameter(kopf["content-type"], "boundary");
    if (!grenze) return;
    const teile = koerper.split(`--${grenze}`);
    for (let i = 1; i < teile.length; i++) {
      const teil = teile[i];
      if (teil.startsWith("--")) break;
      teilDurchgehen(teil.replace(/^\r?\n/, ""), sammlung, tiefe + 1);
    }
    return;
  }
  const cid = String(kopf["content-id"] || "").trim().replace(/^<|>$/g, "");
  const istBild = typ.startsWith("image/");
  const bytes = kodierung === "base64" ? base64Bytes(koerper) : kodierung === "quoted-printable" ? qpBytes(koerper) : latin1Bytes(koerper);
  if (dateiname || /^attachment/i.test(disposition) || (istBild && (cid || /^inline/i.test(disposition)))) {
    // Eingebettet = Bild im HTML (cid:) ohne ausdrueckliches "attachment".
    const inline = !/^attachment/i.test(disposition) && istBild && Boolean(cid || /^inline/i.test(disposition)) && !/\.pdf$/i.test(dateiname);
    if (!inline) sammlung.anhaenge.push(dateiname || "Anhang");
    sammlung.dateien.push({ name: dateiname || (inline ? cid || "Bild" : "Anhang"), typ: typ.split(";")[0].trim() || "application/octet-stream", cid, inline, bytes });
    return;
  }
  const text = dekodieren(bytes, parameter(kopf["content-type"], "charset") || "utf-8");
  if (typ.startsWith("text/plain") && !sammlung.text) sammlung.text = text;
  else if (typ.startsWith("text/html") && !sammlung.html) sammlung.html = text;
}

function adresse(wert) {
  const text = kopfDekodieren(wert);
  const winkel = /^(.*)<([^>]+)>\s*$/.exec(text);
  if (winkel) return { name: winkel[1].trim().replace(/^"|"$/g, ""), email: winkel[2].trim().toLowerCase() };
  return { name: "", email: text.trim().toLowerCase() };
}

/** Rohmail (Uint8Array oder String) -> lesbare Felder. */
export function mailLesen(roh) {
  const text = typeof roh === "string" ? roh : new TextDecoder("latin1").decode(roh);
  const { kopf } = teilLesen(text);
  const sammlung = { text: "", html: "", anhaenge: [], dateien: [] };
  teilDurchgehen(text, sammlung);
  const von = adresse(kopf.from || "");
  const antwortAn = kopf["reply-to"] ? adresse(kopf["reply-to"]) : null;
  let koerper = sammlung.text || (sammlung.html ? textAusHtml(sammlung.html) : "");
  koerper = koerper.replace(/\r\n/g, "\n").trim();
  if (koerper.length > MAX_TEXT) koerper = `${koerper.slice(0, MAX_TEXT)}\n\n[… gekürzt]`;
  return {
    vonEmail: von.email, vonName: von.name,
    antwortAn: antwortAn && antwortAn.email !== von.email ? antwortAn.email : "",
    an: adresse(kopf.to || "").email,
    betreff: kopfDekodieren(kopf.subject || "").trim() || "(ohne Betreff)",
    datum: kopf.date || "",
    messageId: String(kopf["message-id"] || "").trim(),
    inReplyTo: String(kopf["in-reply-to"] || "").trim(),
    text: koerper,
    anhaenge: sammlung.anhaenge.slice(0, 20),
    html: sammlung.html ? String(sammlung.html).slice(0, HTML_MAX) : "",
    dateien: sammlung.dateien.slice(0, ANHAENGE_MAX_ZAHL),
  };
}

// ---------------------------------------------------- Mail kommt herein
async function rohLesen(stream) {
  const reader = stream.getReader();
  const teile = [];
  let laenge = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (laenge < MAX_ROH_BYTES) teile.push(value.slice(0, MAX_ROH_BYTES - laenge));
    laenge += value.length;
  }
  const alles = new Uint8Array(Math.min(laenge, MAX_ROH_BYTES));
  let pos = 0;
  for (const t of teile) { alles.set(t, pos); pos += t.length; }
  return { bytes: alles, groesse: laenge };
}

export async function mailSpeichern(env, mail, groesse, empfaenger) {
  const id = crypto.randomUUID();
  const jetzt = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO postfach
    (id, received_at, from_email, from_name, reply_to, to_email, subject, body_text, message_id, in_reply_to, attachments_json, size_bytes, body_html)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(id, jetzt, mail.vonEmail.slice(0, 200), mail.vonName.slice(0, 200), mail.antwortAn.slice(0, 200),
      String(empfaenger || mail.an).slice(0, 200), mail.betreff.slice(0, 300), mail.text, mail.messageId.slice(0, 300),
      mail.inReplyTo.slice(0, 300), JSON.stringify(mail.anhaenge), groesse, mail.html || null)
    .run();
  // Anhaenge einzeln speichern: ein zu grosser Anhang bleibt nur mit Namen und Groesse stehen.
  let summe = 0;
  const zeilen = [];
  (mail.dateien || []).forEach((d, pos) => {
    const bytes = d.bytes instanceof Uint8Array ? d.bytes : new Uint8Array(0);
    const passt = bytes.length > 0 && bytes.length <= ANHANG_MAX_BYTES && summe + bytes.length <= ANHAENGE_MAX_SUMME;
    if (passt) summe += bytes.length;
    zeilen.push(env.DB.prepare(`INSERT INTO postfach_anhaenge (id, mail_id, pos, name, typ, cid, inline, groesse, daten, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).bind(crypto.randomUUID(), id, pos, String(d.name || "Anhang").slice(0, 200),
      String(d.typ || "application/octet-stream").slice(0, 100), d.cid ? String(d.cid).slice(0, 200) : null, d.inline ? 1 : 0,
      bytes.length, passt ? bytes : null, jetzt));
  });
  if (zeilen.length) {
    try { await env.DB.batch(zeilen); } catch (err) {
      console.error(JSON.stringify({ level: "error", event: "postfach_anhaenge_fehlgeschlagen", message: String(err?.message || err).slice(0, 160) }));
    }
  }
  return id;
}

// ---------------------------------------------------- Telegram (gedrosselt)
//
// Ohne Personendaten: Absender und Betreff stehen nur in der Admin-App (die
// Datenschutzerklaerung nennt Telegram nicht fuer Mails). Hoechstens eine
// Meldung je POSTFACH_MELDUNG_MINUTEN; was dazwischen kommt, meldet die
// naechste Nachricht bzw. der Cron (postfachMeldungNachholen) gesammelt.
export const POSTFACH_MELDUNG_MINUTEN = 10;
const MELDUNG_SCHLUESSEL = "postfach_telegram_gemeldet";
// Bis zu welcher Zeile (rowid) gemeldet wurde: ein Zeitstempel reicht nicht, zwei
// Mails in derselben Millisekunde wie die Meldung wuerden sonst nie gemeldet.
const MELDUNG_ROWID_SCHLUESSEL = "postfach_telegram_gemeldet_rowid";

export function postfachText(anzahl, seit = null) {
  if (anzahl <= 1) return "📬 Neue Mail an kontakt@disorder119.com – Absender und Inhalt: Admin-App → Postfach";
  const uhr = seit ? new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" }).format(new Date(seit)) : "";
  return `📬 ${anzahl} neue Mails${uhr ? ` seit ${uhr} Uhr` : ""} – Admin-App → Postfach`;
}

// Meldet alle seit der letzten Meldung eingegangenen Mails in EINER Nachricht,
// wenn die letzte Meldung lange genug her ist. Ergebnis: Anzahl gemeldet.
export async function postfachMeldungNachholen(env, now = Date.now()) {
  if (!env?.DB || !telegramTransportReady(env)) return 0;
  const jetzt = new Date(now).toISOString();
  const grenze = new Date(now - POSTFACH_MELDUNG_MINUTEN * 60_000).toISOString();
  const vorher = await env.DB.prepare("SELECT value FROM site_settings WHERE key=?").bind(MELDUNG_SCHLUESSEL).first();
  const seit = vorher?.value || null;
  if (seit && seit > grenze) return 0;
  const rowidVorher = await env.DB.prepare("SELECT value FROM site_settings WHERE key=?").bind(MELDUNG_ROWID_SCHLUESSEL).first();
  const abRowid = Number(rowidVorher?.value || 0);
  // Ohne Zeilenmarke (erste Meldung bzw. Bestand vor dieser Version): nach Zeit -
  // seit der letzten Meldung, sonst die letzten 24 Stunden.
  const abZeit = abRowid ? "" : (seit || new Date(now - 24 * 3_600_000).toISOString());
  const offen = await env.DB.prepare("SELECT COUNT(*) AS n, MIN(received_at) AS erste, MAX(rowid) AS letzte FROM postfach WHERE rowid>? AND received_at>?")
    .bind(abRowid, abZeit).first();
  const anzahl = Number(offen?.n || 0);
  if (!anzahl) return 0;
  // Anspruch atomar: nur wer den alten Wert noch sieht, meldet.
  const anspruch = seit
    ? await env.DB.prepare("UPDATE site_settings SET value=?, updated_at=? WHERE key=? AND value=?").bind(jetzt, jetzt, MELDUNG_SCHLUESSEL, seit).run()
    : await env.DB.prepare("INSERT OR IGNORE INTO site_settings (key,value,updated_at) VALUES (?,?,?)").bind(MELDUNG_SCHLUESSEL, jetzt, jetzt).run();
  if (Number(anspruch?.meta?.changes || 0) !== 1) return 0;
  let gesendet = false;
  try {
    gesendet = Boolean((await sendTelegramMessage(env, postfachText(anzahl, offen.erste)))?.sent);
  } catch {
    gesendet = false;
  }
  if (gesendet) {
    await env.DB.prepare("INSERT OR REPLACE INTO site_settings (key,value,updated_at) VALUES (?,?,?)")
      .bind(MELDUNG_ROWID_SCHLUESSEL, String(Number(offen?.letzte || 0)), jetzt).run().catch(() => {});
  }
  if (!gesendet) {
    // Nicht angekommen: Anspruch zuruecknehmen, der Cron versucht es erneut.
    if (seit) await env.DB.prepare("UPDATE site_settings SET value=?, updated_at=? WHERE key=? AND value=?").bind(seit, jetzt, MELDUNG_SCHLUESSEL, jetzt).run().catch(() => {});
    else await env.DB.prepare("DELETE FROM site_settings WHERE key=? AND value=?").bind(MELDUNG_SCHLUESSEL, jetzt).run().catch(() => {});
    return 0;
  }
  return anzahl;
}

export async function handleIncomingEmail(message, env, ctx) {
  const weiterleitung = String(env.MAIL_WEITERLEITUNG || STANDARD_WEITERLEITUNG);
  let gespeichert = false;
  let roh = null;
  try {
    roh = await rohLesen(message.raw);
  } catch (err) {
    console.error(JSON.stringify({ level: "error", event: "postfach_lesen_fehlgeschlagen", message: String(err?.message || err).slice(0, 160) }));
  }
  // Die Kopie ins Gmail zuerst - sie kommt immer, auch wenn das Auswerten
  // danach scheitert oder an der Rechenzeit haengen bleibt.
  let weitergeleitet = false;
  try {
    await message.forward(weiterleitung);
    weitergeleitet = true;
  } catch (err) {
    console.error(JSON.stringify({ level: "error", event: "postfach_weiterleitung_fehlgeschlagen", message: String(err?.message || err).slice(0, 160) }));
  }
  try {
    if (roh) {
      const mail = mailLesen(roh.bytes);
      if (!mail.vonEmail) mail.vonEmail = String(message.from || "").toLowerCase();
      if (env.DB) {
        await mailSpeichern(env, mail, roh.groesse, message.to);
        gespeichert = true;
        // DHL-Auftragsbestaetigung der Online-Frankierung: Warenkorb-Nummer an
        // die offene Marke haengen, Sendungsnummer bei DHL holen (dhl-qr.js).
        if (/dhl\.(com|de)$|deutschepost\.de$/i.test(String(mail.vonEmail || ""))) {
          const zuordnung = warenkorbZuordnen(env, mail).then(r => {
            if (r?.zugeordnet) console.log(JSON.stringify({ level: "info", event: "dhl_cart_from_mail", orderId: String(r.orderId), state: r.state || null }));
          }).catch(err => console.error(JSON.stringify({ level: "error", event: "dhl_cart_from_mail_failed", message: String(err?.message || err).slice(0, 160) })));
          if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(zuordnung); else await zuordnung;
        }
      }
    }
    if (telegramTransportReady(env)) {
      const senden = (env.DB ? postfachMeldungNachholen(env) : sendTelegramMessage(env, postfachText(1))).catch(() => {});
      if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(senden); else await senden;
    }
  } catch (err) {
    console.error(JSON.stringify({ level: "error", event: "postfach_speichern_fehlgeschlagen", message: String(err?.message || err).slice(0, 160) }));
  }
  if (!weitergeleitet && !gespeichert) message.setReject("Mailbox temporarily unavailable");
}

// ----------------------------------------------------------- Admin-API
export function isPostfachRoute(url) {
  const path = url.pathname.replace(/\/+$/, "");
  return path === "/admin/postfach" || path === "/admin/postfach/senden" || path === "/admin/postfach/vorschau"
    || /^\/admin\/postfach\/gesendet\/[0-9a-f-]{36}$/.test(path)
    || /^\/admin\/postfach\/[0-9a-f-]{36}(\/anhang\/[0-9a-f-]{36})?$/.test(path);
}

function kopf(origin) {
  const out = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Expose-Headers": "Content-Type, Content-Disposition",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
  if (origin && ADMIN_ORIGINS.includes(origin)) out["Access-Control-Allow-Origin"] = origin;
  return out;
}

// Anhang ausliefern: Bilder und PDFs zum Ansehen, alles andere als Download.
// Nie als HTML/SVG im Kontext der API ausfuehrbar (CSP sandbox, nosniff).
const ANSEHBAR = /^(image\/(png|jpe?g|gif|webp|heic|heif|bmp)|application\/pdf|text\/plain)$/i;
function anhangAntwort(row, origin) {
  const typ = ANSEHBAR.test(String(row.typ || "")) ? String(row.typ).toLowerCase() : "application/octet-stream";
  const name = String(row.name || "anhang").replace(/[^\w.\- ()äöüÄÖÜß]/g, "_").slice(0, 120) || "anhang";
  const headers = {
    ...kopf(origin),
    "Content-Type": typ,
    "Content-Disposition": `${typ === "application/octet-stream" ? "attachment" : "inline"}; filename="${name.replace(/"/g, "")}"; filename*=UTF-8''${encodeURIComponent(name)}`,
    "Content-Security-Policy": "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox",
    "Cache-Control": "private, max-age=3600",
  };
  // D1 liefert BLOBs je nach Laufzeit als ArrayBuffer oder Zahlen-Array.
  const roh = row.daten;
  const daten = roh instanceof Uint8Array ? roh : roh instanceof ArrayBuffer ? new Uint8Array(roh) : Array.isArray(roh) ? Uint8Array.from(roh) : new Uint8Array(0);
  return new Response(daten, { status: 200, headers });
}

// Eintrag aus dem Postausgang fuer die Admin-App.
const TAG_NAMEN = {
  "order-confirmation": "Bestellung", "shipping-confirmation": "Versand", "shipping-preview": "Test", manuell: "Selbst geschrieben",
  invoice: "Rechnung", "refund-confirmation": "Erstattung", "return-instructions": "Rücksendung", "withdrawal-receipt": "Widerruf", test: "Test",
  antwort: "Antwort", "login-link": "Anmeldelink", "newsletter-bestaetigung": "Newsletter", "newsletter-willkommen": "Newsletter",
};
function gesendetZeile(row, mitInhalt) {
  const out = {
    id: row.id, sentAt: row.gesendet_am, toEmail: row.an_email, toName: row.an_name || "", subject: row.betreff,
    tag: row.tag || "", tagName: TAG_NAMEN[row.tag] || (row.art === "MANUELL" ? "Selbst geschrieben" : "Automatisch"),
    manual: row.art === "MANUELL", status: row.status, error: row.fehler || "", confidential: Boolean(row.vertraulich),
    attachments: (() => { try { return JSON.parse(row.anhaenge_json || "[]"); } catch { return []; } })(),
  };
  if (mitInhalt) {
    out.html = row.html || "";
    out.text = row.text || "";
    out.antwortAuf = row.antwort_auf || "";
  } else {
    out.preview = String(row.text || "").replace(/\s+/g, " ").slice(0, 140);
  }
  return out;
}

function dhlLinks(text) {
  const links = [];
  for (const m of String(text || "").matchAll(/https:\/\/(?:www\.)?dhl\.de\/[^\s<>"')]+/g)) {
    if (!links.includes(m[0])) links.push(m[0]);
  }
  return links.slice(0, 5);
}

async function tokenEquals(left, right) {
  if (!left || !right) return false;
  const digest = async v => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(v))));
  const [a, b] = await Promise.all([digest(left), digest(right)]);
  let diff = a.length ^ b.length;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function zeileAusgeben(row, mitText) {
  const out = {
    id: row.id, receivedAt: row.received_at, fromEmail: row.from_email, fromName: row.from_name,
    replyTo: row.reply_to || "", toEmail: row.to_email, subject: row.subject,
    read: Boolean(row.read_at), archived: Boolean(row.archived_at),
    attachments: (() => { try { return JSON.parse(row.attachments_json || "[]"); } catch { return []; } })(),
  };
  out.attachmentCount = Number(row.anhang_zahl ?? out.attachments.length ?? 0);
  out.dhl = /@(?:[a-z0-9-]+\.)*(dhl\.(?:com|de)|deutschepost\.de)$/i.test(String(row.from_email || ""));
  if (mitText) out.text = row.body_text || "";
  else out.preview = String(row.body_text || "").replace(/\s+/g, " ").slice(0, 140);
  return out;
}

export async function handlePostfach(request, env, url, reqId = crypto.randomUUID(), origin = null) {
  try {
    if (request.method === "OPTIONS") {
      if (origin && !ADMIN_ORIGINS.includes(origin)) return new Response(null, { status: 403 });
      return new Response(null, { status: 204, headers: kopf(origin) });
    }
    if (origin && !ADMIN_ORIGINS.includes(origin)) throw new PostfachError("ORIGIN_NOT_ALLOWED", 403);
    const supplied = String(request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
    if (!env.ADMIN_TOKEN || !(await tokenEquals(supplied, env.ADMIN_TOKEN))) throw new PostfachError("UNAUTHORIZED", 401);
    if (!env.DB) throw new PostfachError("DB_FEHLT", 503);

    const path = url.pathname.replace(/\/+$/, "");
    // ---------------- Gesendet (Postausgang)
    if (path === "/admin/postfach" && request.method === "GET" && url.searchParams.get("ordner") === "gesendet") {
      const limit = Math.min(300, Math.max(1, Number(url.searchParams.get("limit") || 150)));
      const { results } = await env.DB.prepare(`SELECT id, gesendet_am, an_email, an_name, betreff, substr(COALESCE(text,''),1,400) AS text,
          tag, art, status, fehler, vertraulich, anhaenge_json FROM postausgang ORDER BY gesendet_am DESC LIMIT ?`).bind(limit).all();
      const zahl = await env.DB.prepare("SELECT COUNT(*) AS n FROM postfach WHERE read_at IS NULL AND archived_at IS NULL").first();
      return new Response(JSON.stringify({ unread: Number(zahl?.n || 0), mails: (results || []).map(r => gesendetZeile(r, false)) }), { status: 200, headers: kopf(origin) });
    }
    const gesendet = /^\/admin\/postfach\/gesendet\/([0-9a-f-]{36})$/.exec(path);
    if (gesendet && request.method === "GET") {
      const row = await env.DB.prepare("SELECT * FROM postausgang WHERE id=?").bind(gesendet[1]).first();
      if (!row) throw new PostfachError("NICHT_GEFUNDEN", 404);
      return new Response(JSON.stringify({ mail: gesendetZeile(row, true) }), { status: 200, headers: kopf(origin) });
    }
    // ---------------- Selbst schreiben (und Vorschau)
    if ((path === "/admin/postfach/senden" || path === "/admin/postfach/vorschau") && request.method === "POST") {
      let body;
      try { body = await request.json(); } catch { throw new PostfachError("INVALID_JSON", 400); }
      const betreff = String(body?.subject || "").trim().slice(0, 200);
      const text = String(body?.text || "").slice(0, 20_000);
      const mail = freieMail({ betreff, text, sprache: body?.sprache === "en" ? "en" : body?.sprache === "fr" ? "fr" : "de" });
      if (path === "/admin/postfach/vorschau") {
        return new Response(JSON.stringify({ html: mail.html }), { status: 200, headers: kopf(origin) });
      }
      const an = normalizeEmail(body?.to);
      if (!an) throw new PostfachError("EMPFAENGER_UNGUELTIG", 400);
      if (!betreff) throw new PostfachError("BETREFF_FEHLT", 400);
      if (!text.trim()) throw new PostfachError("TEXT_FEHLT", 400);
      const seit = new Date(Date.now() - 86_400_000).toISOString();
      const heute = await env.DB.prepare("SELECT COUNT(*) AS n FROM postausgang WHERE art='MANUELL' AND gesendet_am>=?").bind(seit).first();
      if (Number(heute?.n || 0) >= 100) throw new PostfachError("TAGESGRENZE", 429);
      let headers = null;
      let antwortAuf = null;
      if (body?.antwortAuf) {
        const original = await env.DB.prepare("SELECT id, message_id FROM postfach WHERE id=?").bind(String(body.antwortAuf).slice(0, 60)).first();
        if (original) {
          antwortAuf = original.id;
          const mid = String(original.message_id || "").trim();
          if (/^<[^<>\s]{3,300}>$/.test(mid)) headers = { "In-Reply-To": mid, References: mid };
        }
      }
      const ergebnis = await sendMail(env, {
        to: an, subject: mail.subject, text: mail.text, html: mail.html, tag: antwortAuf ? "antwort" : "manuell",
        art: "MANUELL", replyTo: env.MAIL_KONTAKT || "kontakt@disorder119.com", headers, antwortAuf,
      });
      if (!ergebnis?.sent) throw new PostfachError(ergebnis?.reason || "NICHT_GESENDET", 502);
      return new Response(JSON.stringify({ ok: true, id: ergebnis.protokollId || null }), { status: 200, headers: kopf(origin) });
    }
    if (path === "/admin/postfach" && request.method === "GET") {
      const archiv = url.searchParams.get("ordner") === "archiv";
      const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") || 100)));
      const { results } = await env.DB.prepare(`SELECT id, received_at, from_email, from_name, reply_to, to_email, subject,
          substr(body_text, 1, 400) AS body_text, attachments_json, read_at, archived_at,
          (SELECT COUNT(*) FROM postfach_anhaenge a WHERE a.mail_id=postfach.id AND a.inline=0) AS anhang_zahl
        FROM postfach WHERE ${archiv ? "archived_at IS NOT NULL" : "archived_at IS NULL"}
        ORDER BY received_at DESC LIMIT ?`).bind(limit).all();
      const zahl = await env.DB.prepare("SELECT COUNT(*) AS n FROM postfach WHERE read_at IS NULL AND archived_at IS NULL").first();
      return new Response(JSON.stringify({ mails: (results || []).map(r => zeileAusgeben(r, false)), unread: Number(zahl?.n || 0) }), { status: 200, headers: kopf(origin) });
    }
    const teile = /^\/admin\/postfach\/([0-9a-f-]{36})(?:\/anhang\/([0-9a-f-]{36}))?$/.exec(path);
    if (!teile) throw new PostfachError("NOT_FOUND", 404);
    const id = teile[1];
    if (teile[2]) {
      if (request.method !== "GET") throw new PostfachError("NOT_FOUND", 404);
      const anhang = await env.DB.prepare("SELECT name, typ, daten FROM postfach_anhaenge WHERE id=? AND mail_id=?").bind(teile[2], id).first();
      if (!anhang || anhang.daten == null) throw new PostfachError("ANHANG_NICHT_GESPEICHERT", 404);
      return anhangAntwort(anhang, origin);
    }
    if (request.method === "DELETE") {
      await env.DB.batch([
        env.DB.prepare("DELETE FROM postfach_anhaenge WHERE mail_id=?").bind(id),
        env.DB.prepare("DELETE FROM postfach WHERE id=?").bind(id),
      ]);
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: kopf(origin) });
    }
    if (request.method === "GET") {
      const row = await env.DB.prepare("SELECT * FROM postfach WHERE id=?").bind(id).first();
      if (!row) throw new PostfachError("NICHT_GEFUNDEN", 404);
      if (!row.read_at) {
        row.read_at = new Date().toISOString();
        await env.DB.prepare("UPDATE postfach SET read_at=? WHERE id=?").bind(row.read_at, id).run();
      }
      const dateien = (await env.DB.prepare(`SELECT id, pos, name, typ, cid, inline, groesse, (daten IS NOT NULL) AS gespeichert
        FROM postfach_anhaenge WHERE mail_id=? ORDER BY pos`).bind(id).all()).results || [];
      const mail = zeileAusgeben(row, true);
      mail.html = row.body_html || "";
      mail.files = dateien.map(d => ({ id: d.id, name: d.name, type: d.typ, cid: d.cid || "", inline: Boolean(d.inline),
        size: Number(d.groesse || 0), stored: Boolean(d.gespeichert) }));
      mail.attachmentCount = mail.files.filter(f => !f.inline).length || mail.attachments.length;
      mail.links = mail.dhl ? dhlLinks(row.body_text) : [];
      // DHL-Auftragsbestaetigung: die gekaufte Marke (QR-Code / PDF) direkt in der Mail zeigen.
      const kennung = mail.dhl ? warenkorbAusMail({ vonEmail: row.from_email, betreff: row.subject, text: row.body_text }) : null;
      if (kennung) {
        const marke = await env.DB.prepare(`SELECT m.order_id, m.state, m.shipment_number, m.qr_png_b64, m.label_pdf_b64, o.order_number
          FROM dhl_qr_marken m LEFT JOIN commerce_orders o ON o.id=m.order_id WHERE m.cart_id=? ORDER BY m.created_at DESC LIMIT 1`)
          .bind(kennung.cartId).first().catch(() => null);
        mail.marke = marke ? {
          warenkorb: kennung.cartId, orderId: marke.order_id, bestellnummer: marke.order_number || "", state: marke.state,
          sendungsnummer: marke.shipment_number || "",
          qrPng: marke.qr_png_b64 ? `data:image/png;base64,${marke.qr_png_b64}` : null,
          labelPdf: marke.label_pdf_b64 ? `data:application/pdf;base64,${marke.label_pdf_b64}` : null,
        } : { warenkorb: kennung.cartId, state: "UNBEKANNT" };
      }
      return new Response(JSON.stringify({ mail }), { status: 200, headers: kopf(origin) });
    }
    if (request.method === "POST") {
      let body;
      try { body = await request.json(); } catch { throw new PostfachError("INVALID_JSON", 400); }
      const jetzt = new Date().toISOString();
      if (typeof body.read === "boolean") {
        await env.DB.prepare("UPDATE postfach SET read_at=? WHERE id=?").bind(body.read ? jetzt : null, id).run();
      }
      if (typeof body.archived === "boolean") {
        await env.DB.prepare("UPDATE postfach SET archived_at=? WHERE id=?").bind(body.archived ? jetzt : null, id).run();
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: kopf(origin) });
    }
    throw new PostfachError("NOT_FOUND", 404);
  } catch (err) {
    if (err instanceof PostfachError) return new Response(JSON.stringify({ error: err.code, requestId: reqId }), { status: err.status, headers: kopf(origin) });
    console.error(JSON.stringify({ level: "error", event: "postfach_failed", requestId: reqId, message: String(err?.message || err).slice(0, 160) }));
    return new Response(JSON.stringify({ error: "INTERNAL_POSTFACH_ERROR", requestId: reqId }), { status: 500, headers: kopf(origin) });
  }
}

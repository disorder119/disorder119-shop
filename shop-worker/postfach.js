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

import { sendTelegramMessage, telegramTransportReady } from "./notifications.js";

const ADMIN_ORIGINS = Object.freeze(["https://admin.disorder119.com"]);
const MAX_ROH_BYTES = 2 * 1024 * 1024;
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

// "=?UTF-8?B?...?=" und "=?iso-8859-1?Q?...?=" in Kopfzeilen
export function kopfDekodieren(wert) {
  return String(wert || "")
    .replace(/\?=\s+=\?/g, "?==?")
    .replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_, charset, art, inhalt) =>
      dekodieren(art.toUpperCase() === "B" ? base64Bytes(inhalt) : qpBytes(inhalt, true), charset));
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

function textAusHtml(html) {
  return String(html)
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
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
  if (dateiname || /^attachment/i.test(disposition)) {
    sammlung.anhaenge.push(dateiname || "Anhang");
    return;
  }
  const bytes = kodierung === "base64" ? base64Bytes(koerper) : kodierung === "quoted-printable" ? qpBytes(koerper) : latin1Bytes(koerper);
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
  const sammlung = { text: "", html: "", anhaenge: [] };
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
  await env.DB.prepare(`INSERT INTO postfach
    (id, received_at, from_email, from_name, reply_to, to_email, subject, body_text, message_id, in_reply_to, attachments_json, size_bytes)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(id, new Date().toISOString(), mail.vonEmail.slice(0, 200), mail.vonName.slice(0, 200), mail.antwortAn.slice(0, 200),
      String(empfaenger || mail.an).slice(0, 200), mail.betreff.slice(0, 300), mail.text, mail.messageId.slice(0, 300),
      mail.inReplyTo.slice(0, 300), JSON.stringify(mail.anhaenge), groesse)
    .run();
  return id;
}

export async function handleIncomingEmail(message, env, ctx) {
  const weiterleitung = String(env.MAIL_WEITERLEITUNG || STANDARD_WEITERLEITUNG);
  let gespeichert = false;
  try {
    const { bytes, groesse } = await rohLesen(message.raw);
    const mail = mailLesen(bytes);
    if (!mail.vonEmail) mail.vonEmail = String(message.from || "").toLowerCase();
    if (env.DB) {
      await mailSpeichern(env, mail, groesse, message.to);
      gespeichert = true;
    }
    if (telegramTransportReady(env)) {
      const text = `📬 Neue Mail an ${message.to}\nVon: ${mail.vonName ? `${mail.vonName} <${mail.vonEmail}>` : mail.vonEmail}\nBetreff: ${mail.betreff}`;
      const senden = sendTelegramMessage(env, text).catch(() => {});
      if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(senden); else await senden;
    }
  } catch (err) {
    console.error(JSON.stringify({ level: "error", event: "postfach_speichern_fehlgeschlagen", message: String(err?.message || err).slice(0, 160) }));
  }
  // Die Kopie ins Gmail kommt immer - auch wenn das Speichern scheitert.
  try {
    await message.forward(weiterleitung);
  } catch (err) {
    console.error(JSON.stringify({ level: "error", event: "postfach_weiterleitung_fehlgeschlagen", gespeichert, message: String(err?.message || err).slice(0, 160) }));
    if (!gespeichert) message.setReject("Mailbox temporarily unavailable");
  }
}

// ----------------------------------------------------------- Admin-API
export function isPostfachRoute(url) {
  const path = url.pathname.replace(/\/+$/, "");
  return path === "/admin/postfach" || /^\/admin\/postfach\/[0-9a-f-]{36}$/.test(path);
}

function kopf(origin) {
  const out = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
  if (origin && ADMIN_ORIGINS.includes(origin)) out["Access-Control-Allow-Origin"] = origin;
  return out;
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
    if (path === "/admin/postfach" && request.method === "GET") {
      const archiv = url.searchParams.get("ordner") === "archiv";
      const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") || 100)));
      const { results } = await env.DB.prepare(`SELECT * FROM postfach WHERE ${archiv ? "archived_at IS NOT NULL" : "archived_at IS NULL"}
        ORDER BY received_at DESC LIMIT ?`).bind(limit).all();
      const zahl = await env.DB.prepare("SELECT COUNT(*) AS n FROM postfach WHERE read_at IS NULL AND archived_at IS NULL").first();
      return new Response(JSON.stringify({ mails: (results || []).map(r => zeileAusgeben(r, false)), unread: Number(zahl?.n || 0) }), { status: 200, headers: kopf(origin) });
    }
    const id = path.split("/").pop();
    if (request.method === "GET") {
      const row = await env.DB.prepare("SELECT * FROM postfach WHERE id=?").bind(id).first();
      if (!row) throw new PostfachError("NICHT_GEFUNDEN", 404);
      if (!row.read_at) {
        row.read_at = new Date().toISOString();
        await env.DB.prepare("UPDATE postfach SET read_at=? WHERE id=?").bind(row.read_at, id).run();
      }
      return new Response(JSON.stringify({ mail: zeileAusgeben(row, true) }), { status: 200, headers: kopf(origin) });
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

// Postfach der Shop-Adresse: Cloudflare Email Routing leitet Mails an
// bestellung@disorder119.com an den Worker (email()-Handler). Der Worker legt
// eine Kopie als Text in D1 ab, damit die Admin-App sie lesen und beantworten
// kann, und schickt das vollstaendige Original an MAIL_FORWARD_TO weiter.
//
// Sicherheit: Fremdes HTML wird nie gespeichert oder ausgeliefert, nur daraus
// gewonnener Text. So kann eine praeparierte Mail in der Admin-App keinen
// Code ausfuehren. Anhaenge bleiben im weitergeleiteten Original.
import { clampAdminLimit, clampAdminOffset } from "./admin-api.js";
import { isValidUuid, safeText } from "./commerce-core.js";
import { escapeHtml, mailTransportReady, normalizeEmail, sendMail } from "./customer-mail.js";
import { sendTelegramMessage, telegramTransportReady } from "./notifications.js";

export const POSTFACH_MAX_TEXT = 100_000;
export const POSTFACH_MAX_ANTWORT = 20_000;
const MAX_BETREFF = 300;
const MAX_ANHAENGE = 30;
const ZITAT_ZEICHEN = 1_500;

const ADMIN_ORIGINS = Object.freeze([
  "https://admin.disorder119.com",
  "http://localhost:8765",
  "http://127.0.0.1:8765",
]);

class PostfachError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

// ---------------------------------------------------------------- Text

const BENANNTE_ZEICHEN = Object.freeze({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " });

function zeichenAusEntity(match, entity) {
  const lower = entity.toLowerCase();
  if (lower in BENANNTE_ZEICHEN) return BENANNTE_ZEICHEN[lower];
  const code = lower.startsWith("#x") ? Number.parseInt(lower.slice(2), 16)
    : lower.startsWith("#") ? Number.parseInt(lower.slice(1), 10)
    : NaN;
  if (!Number.isInteger(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return match;
  return String.fromCodePoint(code);
}

// Steuerzeichen raus, Zeilenumbrueche und Tabs bleiben.
export function sauberText(value) {
  return String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "");
}

export function htmlZuText(html) {
  let text = String(html || "");
  text = text.replace(/<(script|style|head|title|template|noscript)\b[\s\S]*?<\/\1\s*>/gi, " ");
  text = text.replace(/<!--[\s\S]*?-->/g, " ");
  text = text.replace(/<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a\s*>/gi,
    (match, dq, sq, bare, inner) => {
      const href = String(dq ?? sq ?? bare ?? "").trim();
      const label = inner.replace(/<[^>]+>/g, "").trim();
      if (!/^(https?:|mailto:)/i.test(href)) return label;
      const ziel = href.replace(/^mailto:/i, "");
      return label && label !== ziel ? `${label} (${ziel})` : ziel;
    });
  text = text
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6]|blockquote|table|section|article)\s*>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, zeichenAusEntity);
  return sauberText(text)
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function spamVerdacht(headers = []) {
  for (const header of Array.isArray(headers) ? headers : []) {
    const key = String(header?.key || "").toLowerCase();
    const value = String(header?.value || "").toLowerCase();
    if ((key === "authentication-results" || key === "arc-authentication-results") && /\b(dmarc|spf)=fail\b/.test(value)) return true;
    if (key === "received-spf" && /^\s*fail\b/.test(value)) return true;
  }
  return false;
}

function adresse(value) {
  return normalizeEmail(value || "") || "";
}

// Baut aus einer zerlegten Mail den Datensatz fuer D1. Rein, ohne I/O.
export function nachrichtAusMail(email = {}, meta = {}) {
  const now = meta.now instanceof Date ? meta.now : new Date();
  const roh = email.text ? sauberText(email.text).trim() : htmlZuText(email.html);
  const gekuerzt = roh.length > POSTFACH_MAX_TEXT;
  const anhaenge = (Array.isArray(email.attachments) ? email.attachments : [])
    .slice(0, MAX_ANHAENGE)
    .map(anhang => ({
      name: safeText(anhang?.filename || "unbenannt", 200),
      typ: safeText(anhang?.mimeType || "application/octet-stream", 100),
      groesse: Number(anhang?.content?.byteLength ?? anhang?.content?.length ?? 0) || 0,
    }));
  const von = adresse(email.from?.address) || adresse(meta.envelopeFrom) || safeText(meta.envelopeFrom || "unbekannt", 200);
  const antwortAn = adresse(Array.isArray(email.replyTo) ? email.replyTo[0]?.address : "");
  return {
    id: meta.id || crypto.randomUUID(),
    empfangen_am: now.toISOString(),
    an: adresse(meta.envelopeTo) || safeText(meta.envelopeTo || "", 200),
    von,
    von_name: safeText(email.from?.name || "", 120) || null,
    antwort_an: antwortAn && antwortAn !== von ? antwortAn : null,
    betreff: safeText(email.subject || "", MAX_BETREFF),
    text: gekuerzt ? roh.slice(0, POSTFACH_MAX_TEXT) : roh,
    text_gekuerzt: gekuerzt ? 1 : 0,
    anhaenge_json: JSON.stringify(anhaenge),
    message_id: safeText(email.messageId || "", 300) || null,
    in_reply_to: safeText(email.inReplyTo || "", 300) || null,
    groesse: Math.max(0, Math.round(Number(meta.rawSize) || 0)),
    spam_verdacht: spamVerdacht(email.headers) ? 1 : 0,
    weitergeleitet: meta.weitergeleitet ? 1 : 0,
  };
}

// ---------------------------------------------------------------- Empfang

async function mailZerlegen(raw) {
  // Dynamisch geladen: Wrangler buendelt die Bibliothek mit, die Tests
  // kommen ohne sie aus.
  const { default: PostalMime } = await import("postal-mime");
  return PostalMime.parse(raw);
}

function logFehler(event, reqId, err) {
  console.error(JSON.stringify({
    level: "error",
    event,
    requestId: reqId,
    message: safeText(err?.message || err || "unknown", 180),
  }));
}

async function neueMailMelden(env, reqId) {
  if (String(env?.POSTFACH_TELEGRAM || "").toLowerCase() === "false" || !telegramTransportReady(env)) return;
  // Bewusst ohne Absender und Betreff: Kundendaten gehoeren nicht in Telegram.
  await sendTelegramMessage(env, "DISORDER119 — NEUE MAIL\nIm Postfach wartet eine neue Nachricht. Öffne die Admin-App zum Lesen.", reqId);
}

export async function handleInboundEmail(message, env, ctx, { parse = mailZerlegen, now = () => new Date() } = {}) {
  const reqId = `mail-${crypto.randomUUID()}`;
  let weitergeleitet = false;
  const weiterAn = normalizeEmail(env?.MAIL_FORWARD_TO || "");
  if (weiterAn) {
    try {
      await message.forward(weiterAn);
      weitergeleitet = true;
    } catch (err) {
      logFehler("postfach_forward_failed", reqId, err);
    }
  }

  let gespeichert = false;
  try {
    if (!env?.DB) throw new Error("POSTFACH_DB_MISSING");
    const raw = await new Response(message.raw).arrayBuffer();
    const email = await parse(raw);
    const row = nachrichtAusMail(email, {
      envelopeFrom: message.from,
      envelopeTo: message.to,
      rawSize: message.rawSize || raw.byteLength,
      now: now(),
      weitergeleitet,
    });
    const result = await env.DB.prepare(`INSERT OR IGNORE INTO postfach_nachrichten
      (id,empfangen_am,an,von,von_name,antwort_an,betreff,text,text_gekuerzt,anhaenge_json,
       message_id,in_reply_to,groesse,spam_verdacht,weitergeleitet)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(row.id, row.empfangen_am, row.an, row.von, row.von_name, row.antwort_an, row.betreff, row.text,
        row.text_gekuerzt, row.anhaenge_json, row.message_id, row.in_reply_to, row.groesse, row.spam_verdacht,
        row.weitergeleitet)
      .run();
    gespeichert = true;
    if (result?.meta?.changes && !row.spam_verdacht) {
      const hinweis = neueMailMelden(env, reqId).catch(err => logFehler("postfach_notice_failed", reqId, err));
      if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(hinweis);
      else await hinweis;
    }
  } catch (err) {
    logFehler("postfach_store_failed", reqId, err);
  }

  // Weder abgelegt noch weitergeleitet: lieber zurueckweisen, damit der
  // Absender eine Fehlermeldung bekommt, als die Mail still zu verlieren.
  if (!gespeichert && !weitergeleitet) {
    message.setReject("Postfach voruebergehend nicht erreichbar. Bitte spaeter erneut senden.");
  }
  return { gespeichert, weitergeleitet };
}

// ---------------------------------------------------------------- Admin-API

function securityHeaders() {
  return {
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  };
}

function corsHeaders(origin) {
  const headers = {
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
  if (origin && ADMIN_ORIGINS.includes(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

function json(data, status = 200, origin = null) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...securityHeaders(), ...corsHeaders(origin) },
  });
}

async function readJson(request) {
  try {
    const body = await request.json();
    return body && typeof body === "object" && !Array.isArray(body) ? body : {};
  } catch {
    throw new PostfachError("INVALID_JSON", 400);
  }
}

function anhaengeAus(jsonText) {
  try {
    const list = JSON.parse(jsonText || "[]");
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function listenEintrag(row) {
  return {
    id: String(row.id),
    von: String(row.von || ""),
    vonName: row.von_name || null,
    betreff: String(row.betreff || ""),
    vorschau: String(row.vorschau || "").replace(/\s+/g, " ").trim(),
    empfangenAm: row.empfangen_am,
    gelesen: Boolean(row.gelesen_am),
    beantwortet: Boolean(row.beantwortet_am),
    archiviert: Boolean(row.archiviert_am),
    anhaenge: anhaengeAus(row.anhaenge_json).length,
    spamVerdacht: Number(row.spam_verdacht || 0) === 1,
  };
}

async function liste(env, url) {
  const ordner = url.searchParams.get("ordner") === "archiv" ? "archiv" : "eingang";
  const limit = clampAdminLimit(url.searchParams.get("limit"), 50, 200);
  const offset = clampAdminOffset(url.searchParams.get("offset"));
  const q = safeText(url.searchParams.get("q"), 120);
  const where = [ordner === "archiv" ? "archiviert_am IS NOT NULL" : "archiviert_am IS NULL"];
  const binds = [];
  if (q) {
    const like = `%${q}%`;
    where.push("(von LIKE ? OR von_name LIKE ? OR betreff LIKE ? OR text LIKE ?)");
    binds.push(like, like, like, like);
  }
  const clause = `WHERE ${where.join(" AND ")}`;
  const [rows, total, ungelesen] = await Promise.all([
    env.DB.prepare(`SELECT id,von,von_name,betreff,substr(text,1,180) AS vorschau,empfangen_am,gelesen_am,
        beantwortet_am,archiviert_am,anhaenge_json,spam_verdacht
      FROM postfach_nachrichten ${clause} ORDER BY empfangen_am DESC LIMIT ? OFFSET ?`)
      .bind(...binds, limit, offset).all(),
    env.DB.prepare(`SELECT COUNT(*) AS anzahl FROM postfach_nachrichten ${clause}`).bind(...binds).first(),
    env.DB.prepare("SELECT COUNT(*) AS anzahl FROM postfach_nachrichten WHERE archiviert_am IS NULL AND gelesen_am IS NULL").first(),
  ]);
  return {
    ordner,
    total: Number(total?.anzahl || 0),
    ungelesen: Number(ungelesen?.anzahl || 0),
    nachrichten: (rows?.results || []).map(listenEintrag),
  };
}

async function ladeNachricht(env, id) {
  if (!isValidUuid(id)) throw new PostfachError("INVALID_MESSAGE_ID", 400);
  const row = await env.DB.prepare("SELECT * FROM postfach_nachrichten WHERE id=?").bind(id).first();
  if (!row) throw new PostfachError("MESSAGE_NOT_FOUND", 404);
  return row;
}

async function detail(env, id) {
  const row = await ladeNachricht(env, id);
  const antworten = await env.DB.prepare(`SELECT id,an,betreff,text,gesendet_am FROM postfach_antworten
    WHERE nachricht_id=? ORDER BY gesendet_am`).bind(id).all();
  return {
    ...listenEintrag({ ...row, vorschau: "" }),
    an: String(row.an || ""),
    antwortAn: row.antwort_an || null,
    text: String(row.text || ""),
    textGekuerzt: Number(row.text_gekuerzt || 0) === 1,
    anhaenge: anhaengeAus(row.anhaenge_json),
    weitergeleitet: Number(row.weitergeleitet || 0) === 1,
    gelesenAm: row.gelesen_am || null,
    beantwortetAm: row.beantwortet_am || null,
    archiviertAm: row.archiviert_am || null,
    antworten: (antworten?.results || []).map(a => ({
      id: String(a.id), an: String(a.an), betreff: String(a.betreff), text: String(a.text), gesendetAm: a.gesendet_am,
    })),
  };
}

async function markieren(env, id, body) {
  await ladeNachricht(env, id);
  const now = new Date().toISOString();
  const updates = [];
  if (typeof body.gelesen === "boolean") {
    updates.push(body.gelesen
      ? env.DB.prepare("UPDATE postfach_nachrichten SET gelesen_am=COALESCE(gelesen_am,?) WHERE id=?").bind(now, id)
      : env.DB.prepare("UPDATE postfach_nachrichten SET gelesen_am=NULL WHERE id=?").bind(id));
  }
  if (typeof body.archiviert === "boolean") {
    updates.push(body.archiviert
      ? env.DB.prepare("UPDATE postfach_nachrichten SET archiviert_am=COALESCE(archiviert_am,?) WHERE id=?").bind(now, id)
      : env.DB.prepare("UPDATE postfach_nachrichten SET archiviert_am=NULL WHERE id=?").bind(id));
  }
  if (!updates.length) throw new PostfachError("NOTHING_TO_UPDATE", 400);
  await env.DB.batch(updates);
  return detail(env, id);
}

async function loeschen(env, id) {
  await ladeNachricht(env, id);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM postfach_antworten WHERE nachricht_id=?").bind(id),
    env.DB.prepare("DELETE FROM postfach_nachrichten WHERE id=?").bind(id),
  ]);
  return { ok: true, geloescht: id };
}

export function antwortBetreff(betreff) {
  const basis = safeText(betreff || "", MAX_BETREFF - 4) || "Deine Nachricht";
  return /^(re|aw|antw)\s*:/i.test(basis) ? basis : `Re: ${basis}`;
}

export function antwortText(eigenerText, original) {
  const zitat = String(original.text || "").slice(0, ZITAT_ZEICHEN)
    .split("\n").map(zeile => `> ${zeile}`).join("\n");
  const datum = String(original.empfangen_am || "").slice(0, 10).split("-").reverse().join(".");
  const absender = original.von_name ? `${original.von_name} <${original.von}>` : original.von;
  return `${eigenerText}\n\nAm ${datum} schrieb ${absender}:\n${zitat}`;
}

async function antworten(env, id, body) {
  const original = await ladeNachricht(env, id);
  if (!mailTransportReady(env)) throw new PostfachError("MAIL_NOT_CONFIGURED", 503);
  const eigenerText = sauberText(body.text).trim();
  if (!eigenerText) throw new PostfachError("REPLY_TEXT_REQUIRED", 400);
  if (eigenerText.length > POSTFACH_MAX_ANTWORT) throw new PostfachError("REPLY_TEXT_TOO_LONG", 400);
  const an = adresse(original.antwort_an) || adresse(original.von);
  if (!an) throw new PostfachError("REPLY_RECIPIENT_INVALID", 409);

  const betreff = antwortBetreff(original.betreff);
  const text = antwortText(eigenerText, original);
  const headers = {};
  if (original.message_id) {
    headers["In-Reply-To"] = safeText(original.message_id, 300);
    headers.References = safeText(original.message_id, 300);
  }
  const zustellung = await sendMail(env, {
    to: an,
    subject: betreff,
    text,
    html: `<!DOCTYPE html><html lang="de"><head><meta charset="utf-8"></head><body><div style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;white-space:pre-wrap;color:#141310;">${escapeHtml(text)}</div></body></html>`,
    tag: "postfach-antwort",
    replyTo: env.MAIL_REPLY_TO || env.MAIL_FROM,
    headers,
  });
  if (!zustellung.sent) throw new PostfachError(`REPLY_NOT_SENT_${zustellung.reason || "UNKNOWN"}`, 502);

  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO postfach_antworten (id,nachricht_id,an,betreff,text,gesendet_am,provider_message_id)
      VALUES (?,?,?,?,?,?,?)`).bind(crypto.randomUUID(), id, an, betreff, eigenerText, now, zustellung.messageId || null),
    env.DB.prepare("UPDATE postfach_nachrichten SET beantwortet_am=?,gelesen_am=COALESCE(gelesen_am,?) WHERE id=?")
      .bind(now, now, id),
  ]);
  return detail(env, id);
}

function status(env) {
  const weiterAn = normalizeEmail(env?.MAIL_FORWARD_TO || "");
  const [name, domain] = weiterAn.split("@");
  return {
    ok: true,
    datenbank: Boolean(env?.DB),
    weiterleitungAn: weiterAn ? `${name.slice(0, 2)}…@${domain}` : null,
    antwortenMoeglich: mailTransportReady(env),
  };
}

export function istPostfachRoute(url) {
  return url.pathname === "/admin/postfach" || url.pathname.startsWith("/admin/postfach/");
}

export async function handlePostfach(request, env, url, reqId = crypto.randomUUID(), origin = null) {
  try {
    if (request.method === "OPTIONS") {
      if (origin && !ADMIN_ORIGINS.includes(origin)) return new Response(null, { status: 403, headers: securityHeaders() });
      return new Response(null, { status: 204, headers: { ...securityHeaders(), ...corsHeaders(origin) } });
    }
    if (origin && !ADMIN_ORIGINS.includes(origin)) throw new PostfachError("ORIGIN_NOT_ALLOWED", 403);
    // Zweite Schutzschicht hinter dem zentralen Gateway in worker-entry.js.
    const role = env?.ADMIN_AUTH_CONTEXT?.role;
    if (!role) throw new PostfachError("UNAUTHORIZED", 401);
    if (request.method !== "GET" && role !== "OWNER") throw new PostfachError("FORBIDDEN", 403);
    if (!env.DB) throw new PostfachError("COMMERCE_DATABASE_NOT_CONFIGURED", 503);

    const pfad = url.pathname.replace(/\/+$/, "");
    if (pfad === "/admin/postfach" && request.method === "GET") return json({ ok: true, ...(await liste(env, url)) }, 200, origin);
    if (pfad === "/admin/postfach/status" && request.method === "GET") return json(status(env), 200, origin);

    const antwortTreffer = /^\/admin\/postfach\/([^/]+)\/antwort$/.exec(pfad);
    if (antwortTreffer && request.method === "POST") {
      return json({ ok: true, nachricht: await antworten(env, decodeURIComponent(antwortTreffer[1]), await readJson(request)) }, 200, origin);
    }
    const treffer = /^\/admin\/postfach\/([^/]+)$/.exec(pfad);
    if (treffer) {
      const id = decodeURIComponent(treffer[1]);
      if (request.method === "GET") return json({ ok: true, nachricht: await detail(env, id) }, 200, origin);
      if (request.method === "PATCH") return json({ ok: true, nachricht: await markieren(env, id, await readJson(request)) }, 200, origin);
      if (request.method === "DELETE") return json(await loeschen(env, id), 200, origin);
    }
    throw new PostfachError("NOT_FOUND", 404);
  } catch (err) {
    if (err instanceof PostfachError) return json({ error: err.code, requestId: reqId }, err.status, origin);
    logFehler("admin_postfach_error", reqId, err);
    return json({ error: "INTERNAL_POSTFACH_ERROR", requestId: reqId }, 500, origin);
  }
}

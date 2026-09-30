// Widerruf und Ruecksendung.
//
// Seit dem 19.06.2026 muss ein Onlineshop eine Widerrufsfunktion anbieten
// (§ 356a BGB): gut sichtbar "Vertrag widerrufen", Name, Vertrag und
// E-Mail-Adresse eingeben, mit "Widerruf bestaetigen" absenden - und danach
// unverzueglich eine Eingangsbestaetigung auf einem dauerhaften Datentraeger
// mit dem Inhalt der Erklaerung sowie Datum und Uhrzeit des Eingangs.
//
// Dieses Modul haelt jede Widerrufserklaerung fest (Website, Kundenkonto oder
// vom Inhaber erfasst, wenn jemand per Mail oder Brief widerruft), schickt die
// Bestaetigung, ordnet die Bestellung zu und bringt sie in den richtigen
// Zustand:
//   * noch nicht versendet -> Versand gesperrt, Inhaber soll stornieren und
//     erstatten (erstattung-auftrag.js);
//   * versendet -> "Ruecksendung angefragt", Anleitung zur Ruecksendung.
// Kommt die Ware zurueck, erfasst der Inhaber in der Admin-App "Ware
// eingegangen": dann startet die Erstattung als Auftrag.
//
// Inhalt und Eingangszeitpunkt einer Erklaerung sind Belege: Die Datenbank
// laesst sie weder aendern noch loeschen (Migration 0029).
import { safeText } from "./commerce-core.js";
import {
  berlinZeit,
  formatWithdrawalReceipt,
  mailSenderIdentity,
  mailTransportReady,
  normalizeEmail,
  sendMail,
  sendReturnInstructions,
} from "./customer-mail.js";
import { sendTelegramMessage } from "./notifications.js";
import {
  erstattungBeauftragen,
  erstattungsfrist,
  laufenderAuftrag,
  stueckeZurueckInDenShop,
} from "./erstattung-auftrag.js";
import { schonErstattet } from "./erstattung.js";

const SHOP_ORIGINS = Object.freeze([
  "https://disorder119.com",
  "https://www.disorder119.com",
  "http://localhost:8765",
  "http://127.0.0.1:8765",
]);
const DOPPELT_FENSTER_MS = 10 * 60 * 1000;
const BESTAETIGUNGEN_JE_ADRESSE_UND_TAG = 5;
const TAG_MS = 24 * 60 * 60 * 1000;
const OFFEN = Object.freeze(["EINGEGANGEN", "IN_BEARBEITUNG"]);

export const WIDERRUF_STATUS_TEXT = Object.freeze({
  EINGEGANGEN: "Eingegangen",
  IN_BEARBEITUNG: "In Bearbeitung",
  ERLEDIGT: "Erledigt",
  NICHT_ZUORDENBAR: "Nicht zuordenbar",
});

export class WiderrufFehler extends Error {
  constructor(code, status = 400, detail = null) {
    super(code);
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

function log(level, event, reqId, felder = {}) {
  const payload = JSON.stringify({ level, event, requestId: safeText(reqId, 120), ...felder });
  if (level === "error") console.error(payload);
  else console.warn(payload);
}

async function protokoll(db, entityType, entityId, eventType, reqId, metadata, actor) {
  await db.prepare(`INSERT INTO audit_events (id,actor_type,entity_type,entity_id,event_type,request_id,metadata_json,created_at)
    VALUES (?,?,?,?,?,?,?,?)`)
    .bind(crypto.randomUUID(), actor, entityType, String(entityId), eventType, safeText(reqId, 120),
      JSON.stringify(metadata || {}), new Date().toISOString()).run();
}

// "d119-20260928-7984f340", "20260928-7984F340 " -> "D119-20260928-7984F340".
// Alles andere (Datum, Artikelname ...) bleibt als Text stehen - auch damit
// laesst sich ein Vertrag benennen.
export function bestellnummerNormalisieren(value) {
  const roh = safeText(value || "", 120).trim();
  const kompakt = roh.toUpperCase().replace(/\s+/g, "");
  if (/^D119-\d{8}-[A-Z0-9]{4,16}$/.test(kompakt)) return kompakt;
  if (/^\d{8}-[A-Z0-9]{4,16}$/.test(kompakt)) return `D119-${kompakt}`;
  return roh.replace(/\s+/g, " ");
}

// Versendet, noch nicht versendet oder (noch) keiner Bestellung zugeordnet.
export function widerrufLage(order) {
  const status = String(order?.status || "");
  if (["SHIPPED", "DELIVERED", "RETURN_REQUESTED"].includes(status)) return "VERSENDET";
  if (["PAID", "PREPARING"].includes(status)) return "NICHT_VERSENDET";
  return "OFFEN";
}

async function bestellungMitKontakt(db, id) {
  return db.prepare(`SELECT o.id,o.order_number,o.status,o.guest_email,o.customer_id,o.total_cents,o.created_at,
      c.email AS kontakt_email,c.recipient_name,cu.email_normalized AS konto_email
    FROM commerce_orders o
    LEFT JOIN order_contact_snapshots c ON c.order_id=o.id
    LEFT JOIN customers cu ON cu.id=o.customer_id
    WHERE o.id=? OR o.order_number=? LIMIT 1`).bind(id, id).first();
}

// Zugeordnet wird nur, wenn Bestellnummer UND E-Mail-Adresse zur Bestellung
// passen. Der Absender erfaehrt nie, ob es die Bestellung gibt.
async function bestellungZuordnen(db, nummer, email) {
  if (!/^D119-/.test(nummer) || !email) return null;
  const order = await bestellungMitKontakt(db, nummer);
  if (!order) return null;
  const adressen = [order.kontakt_email, order.guest_email, order.konto_email].map(normalizeEmail).filter(Boolean);
  return adressen.includes(email) ? order : null;
}

async function stueckeDerBestellung(db, orderId) {
  return (await db.prepare(`SELECT oi.item_id,oi.inventory_id,oi.article_no,oi.title_snapshot,oi.unit_price_cents,oi.bild,
      i.status AS inventory_status
    FROM order_items oi LEFT JOIN inventory i ON i.id=oi.inventory_id WHERE oi.order_id=? ORDER BY oi.rowid`).bind(orderId).all()).results || [];
}

async function ruecksendungSicherstellen(db, orderId, reqId, actor) {
  const offen = await db.prepare("SELECT id FROM returns WHERE order_id=? AND status NOT IN ('CLOSED','REJECTED') LIMIT 1")
    .bind(orderId).first();
  if (offen) return offen.id;
  const id = crypto.randomUUID();
  const jetzt = new Date().toISOString();
  await db.prepare(`INSERT INTO returns (id,order_id,status,reason_code,created_at,updated_at)
    VALUES (?,?,'AUTHORIZED','WITHDRAWAL',?,?)`).bind(id, orderId, jetzt, jetzt).run();
  await protokoll(db, "return", id, "RETURN_CREATED", reqId, { entityType: "ORDER", entityId: orderId, reasonCode: "WITHDRAWAL" }, actor);
  return id;
}

function gueltigerEingang(value, now) {
  const t = Date.parse(String(value || ""));
  if (!Number.isFinite(t)) throw new WiderrufFehler("EINGANG_UNGUELTIG", 400);
  if (t > now.getTime() + 5 * 60 * 1000) throw new WiderrufFehler("EINGANG_IN_ZUKUNFT", 400);
  if (t < now.getTime() - 400 * TAG_MS) throw new WiderrufFehler("EINGANG_ZU_ALT", 400);
  return new Date(t).toISOString();
}

export function widerrufView(row, extra = {}) {
  if (!row) return null;
  return {
    id: row.id,
    vorgang: String(row.id || "").replace(/-/g, "").slice(0, 8).toUpperCase(),
    orderId: row.order_id || null,
    orderNumber: extra.orderNumber || row.order_number || null,
    bestellnummerEingabe: row.bestellnummer_eingabe || null,
    name: row.name,
    email: row.email,
    umfang: row.umfang,
    teile: row.teile_text || null,
    nachricht: row.nachricht || null,
    quelle: row.quelle,
    sprache: row.sprache,
    eingegangenAt: row.eingegangen_at,
    eingegangenText: berlinZeit(row.eingegangen_at),
    erstattungsfrist: erstattungsfrist(row.eingegangen_at),
    bestaetigungGesendetAt: row.bestaetigung_gesendet_at || null,
    bestaetigungStatus: row.bestaetigung_status || null,
    status: row.status,
    statusText: WIDERRUF_STATUS_TEXT[row.status] || row.status,
    offen: OFFEN.includes(row.status),
    notiz: row.notiz || null,
    lage: extra.lage || null,
  };
}

// ------------------------------------------------------------- Erfassen

// eingabe (Website): { name, email, bestellnummer, umfang, teile, nachricht, sprache }
// eingabe (Konto/Admin): { orderId, umfang?, teile?, nachricht?, eingegangenAt? (nur Admin), anleitungSenden? }
// deps: { statusSetzen(orderId, status, { actor, nurInventar }) }
export async function widerrufErfassen(env, eingabe = {}, { quelle = "WEBSITE", reqId = crypto.randomUUID(), deps = {}, now = new Date() } = {}) {
  const db = env?.DB;
  if (!db) throw new WiderrufFehler("DATENBANK_FEHLT", 503);
  if (!["WEBSITE", "KONTO", "ADMIN"].includes(quelle)) throw new WiderrufFehler("QUELLE_UNBEKANNT", 400);
  const actor = quelle === "ADMIN" ? "ADMIN" : "CUSTOMER";

  let order = null;
  let name;
  let email;
  let nummer;
  if (eingabe.orderId) {
    order = await bestellungMitKontakt(db, safeText(eingabe.orderId, 80));
    if (!order) throw new WiderrufFehler("BESTELLUNG_NICHT_GEFUNDEN", 404);
    name = safeText(eingabe.name || order.recipient_name || "", 120).trim();
    email = normalizeEmail(eingabe.email || order.kontakt_email || order.guest_email || order.konto_email);
    nummer = order.order_number;
    if (!name) name = email || "Kundin";
  } else {
    name = safeText(eingabe.name || "", 120).trim();
    email = normalizeEmail(eingabe.email);
    nummer = bestellnummerNormalisieren(eingabe.bestellnummer);
  }
  const umfang = String(eingabe.umfang || "").toUpperCase() === "TEIL" ? "TEIL" : "GANZ";
  const teile = umfang === "TEIL" ? safeText(eingabe.teile || "", 600).trim() : "";
  const nachricht = safeText(eingabe.nachricht || "", 1000).trim();
  const sprache = ["de", "en", "fr"].includes(String(eingabe.sprache || "").toLowerCase()) ? String(eingabe.sprache).toLowerCase() : "de";
  if (!name) throw new WiderrufFehler("NAME_FEHLT", 400);
  if (!email) throw new WiderrufFehler("EMAIL_UNGUELTIG", 400);
  if (!nummer) throw new WiderrufFehler("BESTELLUNG_FEHLT", 400);
  if (umfang === "TEIL" && !teile) throw new WiderrufFehler("TEILE_FEHLEN", 400);
  const eingegangen = quelle === "ADMIN" && eingabe.eingegangenAt ? gueltigerEingang(eingabe.eingegangenAt, now) : now.toISOString();

  // Doppelt abgeschickt (Doppelklick, Neuladen): dieselbe Erklaerung kurz
  // nacheinander ist eine Erklaerung - keine zweite Mail.
  const doppelt = await db.prepare(`SELECT * FROM widerrufe WHERE email=? AND bestellnummer_eingabe=? AND umfang=?
      AND COALESCE(teile_text,'')=? AND eingegangen_at>=? ORDER BY eingegangen_at DESC LIMIT 1`)
    .bind(email, nummer, umfang, teile, new Date(now.getTime() - DOPPELT_FENSTER_MS).toISOString()).first();
  if (doppelt) {
    return { widerruf: doppelt, doppelt: true, lage: widerrufLage(doppelt.order_id ? await bestellungMitKontakt(db, doppelt.order_id) : null) };
  }

  if (!order) order = await bestellungZuordnen(db, nummer, email);
  const id = crypto.randomUUID();
  const jetzt = now.toISOString();
  await db.prepare(`INSERT INTO widerrufe (id,order_id,bestellnummer_eingabe,name,email,umfang,teile_text,nachricht,sprache,
      quelle,eingegangen_at,status,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,'EINGEGANGEN',?,?)`)
    .bind(id, order?.id || null, nummer, name, email, umfang, teile || null, nachricht || null, sprache, quelle, eingegangen, jetzt, jetzt)
    .run();
  const lage = widerrufLage(order);
  await protokoll(db, order ? "order" : "widerruf", order?.id || id, "WITHDRAWAL_RECEIVED", reqId,
    { widerrufId: id, quelle, umfang, lage, zugeordnet: Boolean(order) }, actor);

  // Versendete Bestellung: "Ruecksendung angefragt". Beim Teilwiderruf
  // bleiben die Lagerstuecke, bis klar ist, welche zurueckkommen.
  if (order && ["SHIPPED", "DELIVERED"].includes(String(order.status)) && typeof deps.statusSetzen === "function") {
    try {
      await deps.statusSetzen(order.id, "RETURN_REQUESTED", { actor, nurInventar: umfang === "GANZ" ? null : [] });
    } catch (err) {
      log("error", "withdrawal_status_failed", reqId, { widerrufId: id, code: safeText(err?.code || err?.message, 80) });
    }
  }
  if (order && lage === "VERSENDET") await ruecksendungSicherstellen(db, order.id, reqId, actor);

  let row = await db.prepare("SELECT * FROM widerrufe WHERE id=?").bind(id).first();
  let mail = { sent: false };
  if (quelle === "ADMIN") {
    // Per Mail oder Brief widerrufen: statt der Eingangsbestaetigung der
    // Online-Funktion die Anleitung zur Ruecksendung (falls versendet).
    if (lage === "VERSENDET" && eingabe.anleitungSenden !== false) {
      try {
        mail = await sendReturnInstructions(env, order.id, reqId, { widerrufAm: eingegangen, schluessel: id });
      } catch (err) {
        log("error", "return_instructions_failed", reqId, { widerrufId: id, message: safeText(err?.message, 160) });
      }
    }
    await db.prepare("UPDATE widerrufe SET bestaetigung_status='NICHT_NOETIG',updated_at=? WHERE id=? AND bestaetigung_status IS NULL")
      .bind(jetzt, id).run();
  } else {
    mail = await eingangBestaetigen(env, row, order, reqId, now);
  }
  row = await db.prepare("SELECT * FROM widerrufe WHERE id=?").bind(id).first();
  // Selbst in der Admin-App erfasst: keine Meldung an sich selbst.
  if (quelle !== "ADMIN") await inhaberInformieren(env, row, order, lage, reqId);
  return { widerruf: row, doppelt: false, lage, order, mail };
}

// Eingangsbestaetigung (einmal je Erklaerung). Scheitert der Versand, holt
// der Cron ihn nach.
export async function eingangBestaetigen(env, row, order, reqId = crypto.randomUUID(), now = new Date()) {
  const db = env.DB;
  const jetzt = new Date().toISOString();
  if (row.bestaetigung_gesendet_at) return { sent: false, duplicate: true };
  if (!mailTransportReady(env)) {
    await db.prepare("UPDATE widerrufe SET bestaetigung_status='NICHT_EINGERICHTET',updated_at=? WHERE id=?").bind(jetzt, row.id).run();
    return { sent: false, reason: "NOT_CONFIGURED" };
  }
  // Schutz vor Missbrauch des Formulars als Mail-Schleuder.
  const heute = await db.prepare(`SELECT COUNT(*) AS n FROM widerrufe WHERE email=? AND bestaetigung_gesendet_at IS NOT NULL
      AND eingegangen_at>=?`).bind(row.email, new Date(now.getTime() - TAG_MS).toISOString()).first();
  if (Number(heute?.n || 0) >= BESTAETIGUNGEN_JE_ADRESSE_UND_TAG) {
    await db.prepare("UPDATE widerrufe SET bestaetigung_status='GEDROSSELT',updated_at=? WHERE id=?").bind(jetzt, row.id).run();
    return { sent: false, reason: "GEDROSSELT" };
  }
  const claimId = `notify:email:widerruf:${row.id}`;
  const claim = await db.prepare(`INSERT OR IGNORE INTO audit_events
    (id,actor_type,entity_type,entity_id,event_type,request_id,metadata_json,created_at)
    VALUES (?,'SYSTEM','widerruf',?,'WITHDRAWAL_RECEIPT_CLAIMED',?,?,?)`)
    .bind(claimId, row.id, safeText(reqId, 120), JSON.stringify({ channel: "email" }), jetzt).run();
  if (!claim?.meta?.changes) return { sent: false, duplicate: true };

  const zugeordnet = order || (row.order_id ? await bestellungMitKontakt(db, row.order_id) : null);
  const items = zugeordnet ? await stueckeDerBestellung(db, zugeordnet.id) : [];
  const message = formatWithdrawalReceipt(row, {
    lage: widerrufLage(zugeordnet),
    items,
    contactEmail: mailSenderIdentity(env).email || safeText(env.MAIL_REPLY_TO || "", 200),
  });
  try {
    const delivery = await sendMail(env, {
      to: row.email,
      toName: safeText(row.name || "", 120),
      subject: message.subject,
      html: message.html,
      text: message.text,
      tag: "withdrawal-receipt",
      // Beleg fuer beide Seiten: Durchschlag ins Shop-Postfach.
      kopieAnShop: true,
    });
    if (!delivery.sent) throw new Error(delivery.reason || "mail_not_sent");
  } catch (err) {
    try {
      await db.prepare("DELETE FROM audit_events WHERE id=? AND event_type='WITHDRAWAL_RECEIPT_CLAIMED'").bind(claimId).run();
    } catch {
      // Der Cron versucht es erneut.
    }
    await db.prepare("UPDATE widerrufe SET bestaetigung_status='FEHLER',updated_at=? WHERE id=?").bind(jetzt, row.id).run();
    log("error", "withdrawal_receipt_failed", reqId, { widerrufId: row.id, message: safeText(err?.message, 160) });
    return { sent: false, reason: "FEHLER" };
  }
  const gesendet = new Date().toISOString();
  await db.prepare("UPDATE widerrufe SET bestaetigung_gesendet_at=?,bestaetigung_status='GESENDET',updated_at=? WHERE id=?")
    .bind(gesendet, gesendet, row.id).run();
  try {
    await db.prepare("UPDATE audit_events SET event_type='WITHDRAWAL_RECEIPT_SENT',metadata_json=? WHERE id=?")
      .bind(JSON.stringify({ channel: "email", sentAt: gesendet }), claimId).run();
  } catch {
    // Versendet ist versendet.
  }
  return { sent: true };
}

function inhaberText(row, order, lage) {
  const frist = erstattungsfrist(row.eingegangen_at);
  const fristText = frist ? berlinZeit(frist).split(",")[0] : "";
  const umfang = row.umfang === "TEIL" ? `Teilwiderruf: ${safeText(row.teile_text || "", 200)}` : "Ganzer Vertrag";
  const kopf = order
    ? `Bestellung ${order.order_number}`
    : `Eingabe: „${safeText(row.bestellnummer_eingabe || "", 80)}“ – keiner Bestellung zugeordnet`;
  const was = lage === "NICHT_VERSENDET"
    ? "NOCH NICHT VERSENDET – bitte nicht verschicken! Admin-App → Bestellung → „Stornieren & erstatten“."
    : lage === "VERSENDET"
      ? "Versendet → Rücksendung angefragt. Die Kundin hat die Rücksendeanleitung bekommen. Kommt die Ware an: Admin-App → „Ware eingegangen“."
      : order
        ? `Status der Bestellung: ${order.status}. Bitte in der Admin-App prüfen.`
        : "Bitte in der Admin-App unter „Widerrufe“ die Bestellung zuordnen.";
  return [
    "DISORDER119 — WIDERRUF EINGEGANGEN",
    kopf,
    `${safeText(row.name, 120)} · ${safeText(row.email, 200)}`,
    umfang,
    ...(row.nachricht ? [`Nachricht: ${safeText(row.nachricht, 300)}`] : []),
    `Eingegangen: ${berlinZeit(row.eingegangen_at)}`,
    was,
    ...(fristText ? [`Rückzahlung spätestens bis ${fristText} (bei Rücksendung: sobald die Ware da ist oder der Versand nachgewiesen ist).`] : []),
  ].join("\n");
}

async function inhaberInformieren(env, row, order, lage, reqId) {
  try {
    await sendTelegramMessage(env, inhaberText(row, order, lage), reqId);
  } catch (err) {
    log("warn", "withdrawal_owner_notice_failed", reqId, { widerrufId: row.id, message: safeText(err?.message, 120) });
  }
}

// ---------------------------------------------------------- Oeffentlich

export function isWiderrufRoute(url) {
  return url.pathname.replace(/\/+$/, "") === "/widerruf";
}

function antwortKopf(origin) {
  const out = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Turnstile-Token",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
  if (origin && SHOP_ORIGINS.includes(origin)) out["Access-Control-Allow-Origin"] = origin;
  return out;
}

function antwort(daten, status, origin) {
  return new Response(JSON.stringify(daten), { status, headers: antwortKopf(origin) });
}

async function limitieren(request, env) {
  if (!env.RATE_LIMITER || typeof env.RATE_LIMITER.limit !== "function") return;
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const result = await env.RATE_LIMITER.limit({ key: `widerruf:${ip}` });
  if (result && result.success === false) throw new WiderrufFehler("RATE_LIMITED", 429);
}

// Wie Newsletter und Konto: ohne Secret (Testbetrieb) keine Pruefung; im
// Livebetrieb laesst backend-runtime.js die Route ohne Secret nicht zu.
async function turnstilePruefen(env, request, body) {
  if (!env.TURNSTILE_SECRET) return;
  const token = request.headers.get("X-Turnstile-Token") || body?.turnstileToken;
  if (!token) throw new WiderrufFehler("TURNSTILE_REQUIRED", 403);
  const form = new FormData();
  form.append("secret", env.TURNSTILE_SECRET);
  form.append("response", String(token).slice(0, 2048));
  const ip = request.headers.get("CF-Connecting-IP");
  if (ip) form.append("remoteip", ip);
  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
  const result = await res.json().catch(() => ({}));
  if (!result.success) throw new WiderrufFehler("TURNSTILE_FAILED", 403);
}

// POST /widerruf von https://disorder119.com/widerruf/.
export async function handleWiderruf(request, env, url, reqId = crypto.randomUUID(), origin = null, deps = {}) {
  try {
    if (request.method === "OPTIONS") {
      if (origin && !SHOP_ORIGINS.includes(origin)) return new Response(null, { status: 403 });
      return new Response(null, { status: 204, headers: antwortKopf(origin) });
    }
    if (origin && !SHOP_ORIGINS.includes(origin)) throw new WiderrufFehler("ORIGIN_NOT_ALLOWED", 403);
    if (request.method !== "POST") throw new WiderrufFehler("METHOD_NOT_ALLOWED", 405);
    if (!env.DB) throw new WiderrufFehler("DATENBANK_FEHLT", 503);
    let body = {};
    try {
      body = (await request.json()) || {};
    } catch {
      body = {};
    }
    await limitieren(request, env);
    await turnstilePruefen(env, request, body);
    // Zweiter Schritt der Widerrufsfunktion: erst "Widerruf bestaetigen"
    // schickt ab.
    if (body.bestaetigt !== true) throw new WiderrufFehler("BESTAETIGUNG_FEHLT", 400);
    const ergebnis = await widerrufErfassen(env, body, { quelle: "WEBSITE", reqId, deps });
    const row = ergebnis.widerruf;
    return antwort({
      ok: true,
      vorgang: widerrufView(row).vorgang,
      eingegangenAt: row.eingegangen_at,
      eingegangen: berlinZeit(row.eingegangen_at),
      email: row.email,
      bestaetigungGesendet: Boolean(row.bestaetigung_gesendet_at),
    }, 200, origin);
  } catch (err) {
    if (err instanceof WiderrufFehler) return antwort({ error: err.code, requestId: reqId }, err.status, origin);
    log("error", "withdrawal_error", reqId, { message: safeText(err?.message || "unknown", 180) });
    return antwort({ error: "WIDERRUF_FEHLER", requestId: reqId }, 500, origin);
  }
}

// --------------------------------------------------------------- Admin

export async function widerrufeFuerBestellung(db, orderId) {
  try {
    const rows = await db.prepare("SELECT * FROM widerrufe WHERE order_id=? ORDER BY eingegangen_at DESC").bind(orderId).all();
    return (rows.results || []).map(row => widerrufView(row));
  } catch (err) {
    if (/no such table/i.test(String(err?.message || ""))) return [];
    throw err;
  }
}

export async function widerrufeUebersicht(env) {
  const db = env.DB;
  const rows = (await db.prepare(`SELECT w.*,o.order_number,o.status AS order_status FROM widerrufe w
      LEFT JOIN commerce_orders o ON o.id=w.order_id
      WHERE w.status IN ('EINGEGANGEN','IN_BEARBEITUNG') OR w.eingegangen_at>=?
      ORDER BY CASE WHEN w.status IN ('EINGEGANGEN','IN_BEARBEITUNG') THEN 0 ELSE 1 END, w.eingegangen_at DESC LIMIT 100`)
    .bind(new Date(Date.now() - 90 * TAG_MS).toISOString()).all()).results || [];
  const liste = [];
  for (const row of rows) {
    const view = widerrufView(row, { orderNumber: row.order_number, lage: row.order_id ? widerrufLage({ status: row.order_status }) : "OFFEN" });
    // Nicht zugeordnet: Bestellungen mit derselben Adresse als Vorschlag.
    if (!row.order_id && view.offen) {
      view.vorschlaege = ((await db.prepare(`SELECT o.id,o.order_number,o.status,o.created_at,o.total_cents FROM commerce_orders o
          LEFT JOIN order_contact_snapshots c ON c.order_id=o.id
          WHERE (lower(c.email)=? OR lower(o.guest_email)=? OR o.order_number=?)
            AND o.status NOT IN ('RESERVED','PAYMENT_PENDING','CANCELLED')
          ORDER BY o.created_at DESC LIMIT 5`).bind(row.email, row.email, row.bestellnummer_eingabe || "").all()).results || [])
        .map(o => ({ orderId: o.id, orderNumber: o.order_number, status: o.status, createdAt: o.created_at, totalCents: Number(o.total_cents) }));
    }
    liste.push(view);
  }
  return { widerrufe: liste, offeneWiderrufe: liste.filter(w => w.offen).length };
}

// Admin: zuordnen, Status setzen, Notiz, Bestaetigung erneut senden.
export async function widerrufBearbeiten(env, id, body = {}, reqId = crypto.randomUUID(), deps = {}) {
  const db = env.DB;
  let row = await db.prepare("SELECT * FROM widerrufe WHERE id=?").bind(safeText(id, 80)).first();
  if (!row) throw new WiderrufFehler("WIDERRUF_NICHT_GEFUNDEN", 404);
  const jetzt = new Date().toISOString();

  if (body.orderId && !row.order_id) {
    const order = await bestellungMitKontakt(db, safeText(body.orderId, 80));
    if (!order) throw new WiderrufFehler("BESTELLUNG_NICHT_GEFUNDEN", 404);
    const zugeordnet = await db.prepare("UPDATE widerrufe SET order_id=?,updated_at=? WHERE id=? AND order_id IS NULL")
      .bind(order.id, jetzt, row.id).run();
    if (!zugeordnet.meta?.changes) throw new WiderrufFehler("WIDERRUF_SCHON_ZUGEORDNET", 409);
    await protokoll(db, "order", order.id, "WITHDRAWAL_ASSIGNED", reqId, { widerrufId: row.id }, "ADMIN");
    if (["SHIPPED", "DELIVERED"].includes(String(order.status)) && typeof deps.statusSetzen === "function") {
      await deps.statusSetzen(order.id, "RETURN_REQUESTED", { actor: "ADMIN", nurInventar: row.umfang === "GANZ" ? null : [] });
    }
    if (widerrufLage(order) === "VERSENDET") {
      await ruecksendungSicherstellen(db, order.id, reqId, "ADMIN");
      if (body.anleitungSenden !== false) {
        try {
          await sendReturnInstructions(env, order.id, reqId, { widerrufAm: row.eingegangen_at, schluessel: row.id });
        } catch (err) {
          log("error", "return_instructions_failed", reqId, { widerrufId: row.id, message: safeText(err?.message, 160) });
        }
      }
    }
  }
  if (body.status) {
    const status = safeText(body.status, 30).toUpperCase();
    if (!Object.keys(WIDERRUF_STATUS_TEXT).includes(status)) throw new WiderrufFehler("STATUS_UNBEKANNT", 400);
    await db.prepare("UPDATE widerrufe SET status=?,updated_at=? WHERE id=?").bind(status, jetzt, row.id).run();
    await protokoll(db, row.order_id ? "order" : "widerruf", row.order_id || row.id, "WITHDRAWAL_STATUS", reqId,
      { widerrufId: row.id, from: row.status, to: status }, "ADMIN");
  }
  if (Object.prototype.hasOwnProperty.call(body, "notiz")) {
    await db.prepare("UPDATE widerrufe SET notiz=?,updated_at=? WHERE id=?")
      .bind(safeText(body.notiz || "", 1000).trim() || null, jetzt, row.id).run();
  }
  row = await db.prepare("SELECT * FROM widerrufe WHERE id=?").bind(row.id).first();
  if (body.bestaetigungSenden === true && !row.bestaetigung_gesendet_at && row.quelle !== "ADMIN") {
    await eingangBestaetigen(env, row, null, reqId);
    row = await db.prepare("SELECT * FROM widerrufe WHERE id=?").bind(row.id).first();
  }
  return widerrufView(row);
}

// "Ruecksendung anlegen": Die Kundin hat per Mail oder Brief widerrufen (oder
// schickt einfach zurueck). Legt den Widerruf mit dem Eingangszeitpunkt an,
// stellt die Bestellung auf "Ruecksendung angefragt" und schickt die Anleitung.
export async function ruecksendungAnlegen(env, orderId, body = {}, reqId = crypto.randomUUID(), deps = {}) {
  const db = env.DB;
  const order = await bestellungMitKontakt(db, safeText(orderId, 80));
  if (!order) throw new WiderrufFehler("BESTELLUNG_NICHT_GEFUNDEN", 404);
  if (!["SHIPPED", "DELIVERED", "RETURN_REQUESTED"].includes(String(order.status))) {
    throw new WiderrufFehler("RUECKSENDUNG_STATUS", 409, { status: order.status });
  }
  const offen = await db.prepare(`SELECT * FROM widerrufe WHERE order_id=? AND status IN ('EINGEGANGEN','IN_BEARBEITUNG')
    ORDER BY eingegangen_at LIMIT 1`).bind(order.id).first();
  if (!offen) {
    const ergebnis = await widerrufErfassen(env, {
      orderId: order.id,
      umfang: body.umfang,
      teile: body.teile,
      nachricht: body.nachricht,
      eingegangenAt: body.eingegangenAt,
      anleitungSenden: body.anleitungSenden,
    }, { quelle: "ADMIN", reqId, deps });
    return { widerruf: widerrufView(ergebnis.widerruf), anleitung: ergebnis.mail };
  }
  // Es gibt schon einen Widerruf (z. B. ueber die Website): nur Zustand
  // sicherstellen und die Anleitung auf Wunsch erneut schicken.
  if (["SHIPPED", "DELIVERED"].includes(String(order.status)) && typeof deps.statusSetzen === "function") {
    await deps.statusSetzen(order.id, "RETURN_REQUESTED", { actor: "ADMIN", nurInventar: offen.umfang === "GANZ" ? null : [] });
  }
  await ruecksendungSicherstellen(db, order.id, reqId, "ADMIN");
  let anleitung = { sent: false };
  if (body.anleitungSenden !== false) {
    anleitung = await sendReturnInstructions(env, order.id, reqId, { widerrufAm: offen.eingegangen_at, schluessel: `${offen.id}:${Date.now()}` });
  }
  return { widerruf: widerrufView(offen), anleitung };
}

// "Ware eingegangen": die zurueckgekommenen Stuecke auswaehlen, pruefen,
// optional Wertersatz abziehen - dann startet die Erstattung als Auftrag.
export async function wareEingegangen(env, orderId, body = {}, reqId = crypto.randomUUID(), deps = {}) {
  const db = env.DB;
  const order = await bestellungMitKontakt(db, safeText(orderId, 80));
  if (!order) throw new WiderrufFehler("BESTELLUNG_NICHT_GEFUNDEN", 404);
  if (!["SHIPPED", "DELIVERED", "RETURN_REQUESTED", "RETURNED"].includes(String(order.status))) {
    throw new WiderrufFehler("RUECKSENDUNG_STATUS", 409, { status: order.status });
  }
  if (await laufenderAuftrag(db, order.id)) throw new WiderrufFehler("ERSTATTUNG_LAEUFT", 409);
  const stuecke = await stueckeDerBestellung(db, order.id);
  const ids = Array.isArray(body.artikelIds) && body.artikelIds.length ? [...new Set(body.artikelIds.map(Number))] : stuecke.map(s => Number(s.item_id));
  const auswahl = stuecke.filter(s => ids.includes(Number(s.item_id)));
  if (!auswahl.length || auswahl.length !== ids.length) throw new WiderrufFehler("ARTIKEL_UNBEKANNT", 400);
  if (typeof deps.statusSetzen !== "function") throw new WiderrufFehler("STATUS_NICHT_MOEGLICH", 500);

  // Lager: die zurueckgekommenen Stuecke Schritt fuer Schritt auf
  // "Zurueckgeschickt" (die Datenbank prueft jeden Wechsel).
  const jetzt = new Date().toISOString();
  const inventar = auswahl.map(s => String(s.inventory_id));
  const platz = inventar.map(() => "?").join(",");
  await db.batch([
    db.prepare(`UPDATE inventory SET status='RETURN_REQUESTED',updated_at=?,version=version+1
      WHERE id IN (${platz}) AND status IN ('SHIPPED','DELIVERED')`).bind(jetzt, ...inventar),
    db.prepare(`UPDATE inventory SET status='RETURNED',updated_at=?,version=version+1
      WHERE id IN (${platz}) AND status='RETURN_REQUESTED'`).bind(jetzt, ...inventar),
  ]);
  if (["SHIPPED", "DELIVERED"].includes(String(order.status))) {
    await deps.statusSetzen(order.id, "RETURN_REQUESTED", { actor: "ADMIN", nurInventar: [] });
  }
  if (String(order.status) !== "RETURNED") {
    await deps.statusSetzen(order.id, "RETURNED", { actor: "ADMIN", nurInventar: [] });
  }
  await ruecksendungSicherstellen(db, order.id, reqId, "ADMIN");
  await db.prepare(`UPDATE returns SET status='INSPECTED',updated_at=? WHERE order_id=?
    AND status IN ('REQUESTED','AUTHORIZED','IN_TRANSIT','RECEIVED')`).bind(jetzt, order.id).run();
  await protokoll(db, "order", order.id, "RETURN_RECEIVED", reqId, {
    itemIds: auswahl.map(s => Number(s.item_id)),
    abzugCents: Number(body.abzugCents || 0) || 0,
  }, "ADMIN");

  const widerruf = await db.prepare(`SELECT id FROM widerrufe WHERE order_id=? AND status IN ('EINGEGANGEN','IN_BEARBEITUNG')
    ORDER BY eingegangen_at LIMIT 1`).bind(order.id).first();
  if (body.erstatten === false) return { auftrag: null, widerrufId: widerruf?.id || null };

  // Schon vorher voll erstattet (z. B. nach Versandnachweis): nur noch
  // abschliessen.
  const offen = Number(order.total_cents) - await schonErstattet(db, order.id);
  if (offen <= 0) {
    await deps.statusSetzen(order.id, "REFUNDED", { actor: "ADMIN", nurInventar: inventar });
    if (body.wiederVerfuegbar !== false) await stueckeZurueckInDenShop(env, order, ids, reqId, "Rücksendung");
    if (widerruf) await db.prepare("UPDATE widerrufe SET status='ERLEDIGT',updated_at=? WHERE id=?").bind(jetzt, widerruf.id).run();
    return { auftrag: null, schonErstattet: true };
  }
  const { auftrag } = await erstattungBeauftragen(env, order.id, {
    anlass: widerruf ? "WIDERRUF" : "RUECKSENDUNG",
    artikelIds: ids,
    versandCents: body.versandCents,
    abzugCents: body.abzugCents,
    abzugGrund: body.abzugGrund,
    wiederVerfuegbar: body.wiederVerfuegbar !== false,
    widerrufId: widerruf?.id || null,
  }, reqId, deps);
  return { auftrag };
}

// ----------------------------------------------------------------- Cron

// Bestaetigungen nachholen und an offene Widerrufe erinnern:
//   * nicht zugeordnet oder noch nicht versendet: taeglich,
//   * Ruecksendung unterwegs: nach 7 und nach 12 Tagen (die Rueckzahlungsfrist
//     laeuft ab Eingang, der Shop darf aber auf die Ware warten).
export async function widerrufePflegen(env, reqId = crypto.randomUUID(), now = new Date()) {
  const db = env?.DB;
  const ergebnis = { ok: true, bestaetigt: 0, erinnert: 0, fehler: [] };
  if (!db) return { ...ergebnis, ok: false };
  let nachholen;
  try {
    nachholen = (await db.prepare(`SELECT * FROM widerrufe WHERE bestaetigung_gesendet_at IS NULL AND quelle<>'ADMIN'
        AND (bestaetigung_status IS NULL OR bestaetigung_status IN ('FEHLER','NICHT_EINGERICHTET'))
        AND eingegangen_at>=? ORDER BY eingegangen_at LIMIT 10`)
      .bind(new Date(now.getTime() - 3 * TAG_MS).toISOString()).all()).results || [];
  } catch (err) {
    if (/no such table/i.test(String(err?.message || ""))) return { ...ergebnis, ok: false, code: "TABELLE_FEHLT" };
    throw err;
  }
  for (const row of nachholen) {
    try {
      const mail = await eingangBestaetigen(env, row, null, reqId, now);
      if (mail.sent) ergebnis.bestaetigt += 1;
    } catch (err) {
      ergebnis.fehler.push(safeText(err?.message || "RECEIPT_RETRY_FAILED", 80));
    }
  }

  const offen = (await db.prepare(`SELECT w.*,o.order_number,o.status AS order_status FROM widerrufe w
      LEFT JOIN commerce_orders o ON o.id=w.order_id
      WHERE w.status='EINGEGANGEN' ORDER BY w.eingegangen_at LIMIT 50`).all()).results || [];
  for (const row of offen) {
    const alter = now.getTime() - Date.parse(row.eingegangen_at);
    const zuletzt = row.erinnert_at ? Date.parse(row.erinnert_at) : 0;
    const lage = row.order_id ? widerrufLage({ status: row.order_status }) : "OFFEN";
    let faellig;
    if (lage === "VERSENDET") {
      const tag7 = Date.parse(row.eingegangen_at) + 7 * TAG_MS;
      const tag12 = Date.parse(row.eingegangen_at) + 12 * TAG_MS;
      faellig = (alter >= 7 * TAG_MS && zuletzt < tag7) || (alter >= 12 * TAG_MS && zuletzt < tag12);
    } else {
      faellig = alter >= TAG_MS && now.getTime() - zuletzt >= TAG_MS;
    }
    if (!faellig) continue;
    const frist = erstattungsfrist(row.eingegangen_at);
    const text = [
      "DISORDER119 — WIDERRUF OFFEN",
      row.order_id ? `Bestellung ${row.order_number}` : `Nicht zugeordnet: „${safeText(row.bestellnummer_eingabe || "", 80)}“ (${safeText(row.email, 200)})`,
      `Eingegangen: ${berlinZeit(row.eingegangen_at)}`,
      lage === "NICHT_VERSENDET"
        ? "Noch nicht versendet – bitte stornieren und erstatten (Admin-App → Bestellung)."
        : lage === "VERSENDET"
          ? "Rücksendung unterwegs? Kommt die Ware an: Admin-App → „Ware eingegangen“."
          : "Bitte in der Admin-App unter „Widerrufe“ zuordnen oder als erledigt markieren.",
      ...(frist ? [`Rückzahlungsfrist: ${berlinZeit(frist).split(",")[0]}`] : []),
    ].join("\n");
    try {
      await sendTelegramMessage(env, text, reqId);
    } catch (err) {
      ergebnis.fehler.push(safeText(err?.message || "REMINDER_FAILED", 80));
    }
    await db.prepare("UPDATE widerrufe SET erinnert_at=?,updated_at=? WHERE id=?").bind(now.toISOString(), now.toISOString(), row.id).run();
    ergebnis.erinnert += 1;
  }
  ergebnis.ok = ergebnis.fehler.length === 0;
  return ergebnis;
}

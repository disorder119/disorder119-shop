// Erstattungsauftraege: Storno, Ruecksendung, Widerruf und Kulanz.
//
// Bisher war "Erstatten" ein einzelner Klick. Reichte das PayPal-Guthaben
// nicht, stand nur eine Fehlermeldung da, alles musste spaeter von Hand
// wiederholt werden - und die Kundin erfuhr von nichts. Jetzt legt jeder
// Klick einen Auftrag an, der bestehen bleibt, bis das Geld wirklich zurueck
// ist:
//
//   1. Der Server versucht die Erstattung sofort ueber die urspruengliche
//      PayPal-Zahlung (keine neue Geldsendung).
//   2. Fehlt Guthaben, wartet der Auftrag. Der Cron versucht es erneut (erst
//      alle 15 Minuten, spaeter seltener), der Inhaber bekommt eine
//      Telegram-Nachricht und danach taeglich eine Erinnerung. "Jetzt erneut
//      versuchen" in der Admin-App geht jederzeit.
//   3. Erst wenn PayPal die Erstattung ausgefuehrt hat: Bestellstatus,
//      Stuecke zurueck in den Shop (falls gewuenscht), Mail an die Kundin,
//      Meldung an den Inhaber. Jeder Schritt wird einzeln nachgeholt, falls
//      er scheitert.
//
// Doppelt ausgezahlt wird nie: Jeder Versuch schickt PayPal eine Request-Id,
// eine neue gibt es nur nach einer eindeutigen Ablehnung. Erstattet jemand
// direkt in PayPal, erkennt der Auftrag das an der Summe der abgeschlossenen
// Erstattungen und zahlt nicht noch einmal.
import { safeText } from "./commerce-core.js";
import {
  paypalCaptureErstatten,
  paypalErstattungAbfragen,
  paypalGuthaben,
  paypalZahlung,
  schonErstattet,
  zahlungsstatusNachziehen,
} from "./erstattung.js";
import { euroAmount, sendRefundConfirmation } from "./customer-mail.js";
import { sendTelegramMessage } from "./notifications.js";
import { artikelWiederVerfuegbar } from "./admin-katalog.js";

export const AUFTRAG_LAUFEND = Object.freeze(["OFFEN", "IN_ARBEIT", "WARTET_AUF_DECKUNG", "BEI_PAYPAL", "FEHLER"]);
export const ANLAESSE = Object.freeze(["STORNO", "RUECKSENDUNG", "WIDERRUF", "KULANZ"]);

const LAUFEND_SQL = AUFTRAG_LAUFEND.map(s => `'${s}'`).join(",");
// Ein Lauf, der nach 10 Minuten noch "in Arbeit" steht, ist abgebrochen
// (Worker beendet). Derselbe PayPal-Schluessel macht die Wiederholung sicher.
const IN_ARBEIT_VERFALL_MS = 10 * 60 * 1000;
// Der Cron laeuft alle 15 Minuten; eine Minute Spielraum, damit ein Auftrag,
// der "um 12:15" dran ist, nicht erst um 12:30 laeuft.
const FAELLIG_SPIELRAUM_MS = 60 * 1000;
const AUFTRAEGE_JE_LAUF = 5;
const ERINNERN_ALLE_MS = 24 * 60 * 60 * 1000;
const NACHARBEIT_TAGE = 14;
const BEI_PAYPAL_PRUEFEN_MS = 30 * 60 * 1000;
const ABGELEHNT_HOECHSTENS = 5;

// Status der Bestellung, aus denen ein Anlass erstattet werden darf.
const STATUS_JE_ANLASS = Object.freeze({
  STORNO: ["PAID", "PREPARING"],
  WIDERRUF: ["PAID", "PREPARING", "RETURN_REQUESTED", "RETURNED"],
  RUECKSENDUNG: ["RETURN_REQUESTED", "RETURNED"],
  KULANZ: ["PAID", "PREPARING", "SHIPPED", "DELIVERED", "RETURN_REQUESTED", "RETURNED"],
});
const VOR_VERSAND = Object.freeze(["PAID", "PREPARING"]);
// Lagerstuecke, die mit der Bestellung auf "Erstattet" wechseln duerfen.
const INVENTAR_ZU_ERSTATTET = Object.freeze(["PAID", "PREPARING", "RETURNED"]);

export const ANLASS_TEXT = Object.freeze({
  STORNO: "Storno",
  RUECKSENDUNG: "Rücksendung",
  WIDERRUF: "Widerruf",
  KULANZ: "Kulanz",
});

const STATUS_TEXT = Object.freeze({
  OFFEN: "Wird gestartet",
  IN_ARBEIT: "Läuft gerade",
  WARTET_AUF_DECKUNG: "Wartet auf PayPal-Guthaben",
  BEI_PAYPAL: "PayPal bearbeitet die Erstattung",
  FEHLER: "Braucht deine Hilfe",
  ERLEDIGT: "Erstattet",
  ABGEBROCHEN: "Abgebrochen",
});

// Klartext fuer die Admin-App und Telegram. Unbekannte Codes bleiben stehen.
const FEHLER_TEXT = Object.freeze({
  REFUND_FAILED_INSUFFICIENT_FUNDS: "PayPal-Guthaben reicht nicht. Lade Guthaben auf oder hinterlege ein bestätigtes Bankkonto in PayPal – der Shop versucht es automatisch weiter.",
  CAPTURE_FULLY_REFUNDED: "PayPal meldet: Die Zahlung ist schon vollständig erstattet.",
  REFUND_AMOUNT_EXCEEDED: "PayPal meldet: Der Betrag ist höher als das, was von dieser Zahlung noch offen ist.",
  REFUND_TIME_LIMIT_EXCEEDED: "Die Zahlung ist zu alt für eine PayPal-Erstattung (über 180 Tage). Bitte per Überweisung erstatten und den Auftrag danach abbrechen.",
  REFUND_NOT_PERMITTED_DUE_TO_CHARGEBACK: "Die Kundin hat bei PayPal einen Konflikt oder eine Rückbuchung eröffnet. Bitte im PayPal-Konfliktlösungszentrum klären.",
  PERMISSION_DENIED: "PayPal verweigert die Erstattung für diese App (fehlende Berechtigung).",
  NOT_AUTHORIZED: "PayPal verweigert die Erstattung für diese App (fehlende Berechtigung).",
  PAYPAL_NOT_CONFIGURED: "PayPal ist am Server nicht eingerichtet.",
  PAYPAL_ANMELDUNG_FEHLGESCHLAGEN: "Anmeldung bei PayPal gescheitert – der Shop versucht es gleich noch einmal.",
  NETZFEHLER: "PayPal war nicht erreichbar – der Shop versucht es gleich noch einmal (ohne doppelte Auszahlung).",
  KEINE_PAYPAL_ZAHLUNG: "Zu dieser Bestellung gibt es keine PayPal-Zahlung, über die erstattet werden kann.",
  SCHON_VERSENDET: "Die Bestellung ist inzwischen versendet worden. Die Stornierung ist angehalten: Warte die Rücksendung ab oder brich den Auftrag ab.",
  BETRAG_UEBERHOLT: "Inzwischen wurde anderweitig erstattet. Bitte diesen Auftrag abbrechen und mit dem richtigen Betrag neu anlegen.",
  REFUND_FAILED: "PayPal hat die Erstattung abgelehnt. Der Shop versucht es später erneut.",
  REFUND_CANCELLED: "PayPal hat die Erstattung storniert. Der Shop versucht es später erneut.",
});

export class AuftragFehler extends Error {
  constructor(code, status = 409, detail = null) {
    super(code);
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

function fehlerText(code) {
  const text = safeText(code || "", 120);
  if (!text) return null;
  const grund = text.split(":")[0];
  return FEHLER_TEXT[grund] || FEHLER_TEXT[text] || `PayPal meldet: ${text}`;
}

function ohneTabelle(err) {
  return /no such table/i.test(String(err?.message || ""));
}

function log(level, event, reqId, felder = {}) {
  const payload = JSON.stringify({ level, event, requestId: safeText(reqId, 120), ...felder });
  if (level === "error") console.error(payload);
  else console.warn(payload);
}

async function protokoll(db, orderId, eventType, reqId, metadata, actor = "SYSTEM") {
  await db.prepare(`INSERT INTO audit_events (id,actor_type,entity_type,entity_id,event_type,request_id,metadata_json,created_at)
    VALUES (?,?,'order',?,?,?,?,?)`)
    .bind(crypto.randomUUID(), actor, orderId, eventType, safeText(reqId, 120), JSON.stringify(metadata || {}), new Date().toISOString()).run();
}

async function ladeBestellung(db, id) {
  return db.prepare("SELECT * FROM commerce_orders WHERE id=? OR order_number=?").bind(id, id).first();
}

async function ladeStuecke(db, orderId) {
  return (await db.prepare(`SELECT oi.item_id,oi.inventory_id,oi.article_no,oi.title_snapshot,oi.unit_price_cents,oi.bild,
      i.status AS inventory_status
    FROM order_items oi LEFT JOIN inventory i ON i.id=oi.inventory_id WHERE oi.order_id=? ORDER BY oi.rowid`).bind(orderId).all()).results || [];
}

async function zeile(db, auftragId) {
  return db.prepare("SELECT * FROM erstattungsauftraege WHERE id=?").bind(auftragId).first();
}

export async function laufenderAuftrag(db, orderId) {
  try {
    return await db.prepare(`SELECT * FROM erstattungsauftraege WHERE order_id=? AND status IN (${LAUFEND_SQL})
      ORDER BY created_at DESC LIMIT 1`).bind(orderId).first();
  } catch (err) {
    if (ohneTabelle(err)) return null;
    throw err;
  }
}

function artikelAus(row) {
  try {
    const liste = JSON.parse(row?.artikel_json || "[]");
    return Array.isArray(liste) ? liste : [];
  } catch {
    return [];
  }
}

// Wiederholungen nach fehlendem Guthaben: die ersten zwei Stunden bei jedem
// Cron-Lauf, bis zum ersten Tag stuendlich, danach alle drei Stunden. Mit
// "Jetzt erneut versuchen" geht es jederzeit sofort.
export function naechsterVersuch(versuche, now = new Date()) {
  const n = Number(versuche) || 0;
  const minuten = n <= 8 ? 15 : n <= 30 ? 60 : 180;
  return new Date(now.getTime() + minuten * 60 * 1000).toISOString();
}

function iso(now) {
  return (now instanceof Date ? now : new Date()).toISOString();
}

// Frist fuer die Rueckzahlung nach einem Widerruf: 14 Tage ab Eingang der
// Erklaerung (§ 357 Abs. 1 BGB).
export function erstattungsfrist(eingegangenAt) {
  const t = Date.parse(eingegangenAt || "");
  return Number.isFinite(t) ? new Date(t + 14 * 24 * 60 * 60 * 1000).toISOString() : null;
}

export function auftragView(row, extra = {}) {
  if (!row) return null;
  const laufend = AUFTRAG_LAUFEND.includes(row.status);
  const endgueltig = Number(row.fehler_endgueltig) === 1;
  let hinweis = null;
  if (row.status === "WARTET_AUF_DECKUNG") {
    hinweis = `Lade mindestens ${euroAmount(row.betrag_cents)} auf dein PayPal-Konto oder bestätige ein Bankkonto in PayPal. Der Shop versucht es automatisch weiter; die Kundin bekommt ihre Mail erst, wenn das Geld wirklich zurück ist.`;
  } else if (row.status === "FEHLER") {
    hinweis = fehlerText(row.letzter_fehler) || "Der letzte Versuch ist gescheitert.";
    if (!endgueltig) hinweis += " Nächster automatischer Versuch ist geplant.";
  } else if (row.status === "BEI_PAYPAL") {
    hinweis = "PayPal hat die Erstattung angenommen und bucht sie noch (z. B. über dein Bankkonto). Die Kundin bekommt ihre Mail, sobald sie abgeschlossen ist.";
  }
  return {
    id: row.id,
    orderId: row.order_id,
    orderNumber: extra.orderNumber || row.order_number || null,
    anlass: row.anlass,
    anlassText: ANLASS_TEXT[row.anlass] || row.anlass,
    betragCents: Number(row.betrag_cents),
    artikel: artikelAus(row),
    versandCents: Number(row.versand_cents || 0),
    abzugCents: Number(row.abzug_cents || 0),
    abzugGrund: row.abzug_grund || null,
    kundenGrund: row.kunden_grund || null,
    wiederVerfuegbar: Number(row.wieder_verfuegbar) === 1,
    vorVersand: Number(row.vor_versand) === 1,
    widerrufId: row.widerruf_id || null,
    status: row.status,
    statusText: STATUS_TEXT[row.status] || row.status,
    laufend,
    hinweis,
    fehler: row.letzter_fehler || null,
    fehlerText: row.status === "FEHLER" || row.status === "WARTET_AUF_DECKUNG" ? fehlerText(row.letzter_fehler) : null,
    fehlerEndgueltig: endgueltig,
    versuche: Number(row.versuche || 0),
    letzterVersuchAt: row.letzter_versuch_at || null,
    naechsterVersuchAt: laufend ? row.naechster_versuch_at || null : null,
    kundeBenachrichtigtAt: row.kunde_benachrichtigt_at || null,
    kundeMailStatus: row.kunde_mail_status || null,
    wiederImShopAt: row.wieder_im_shop_at || null,
    erstelltAm: row.created_at,
    erledigtAm: row.erledigt_at || null,
    aktionen: {
      erneutVersuchen: ["OFFEN", "WARTET_AUF_DECKUNG", "FEHLER"].includes(row.status),
      abbrechen: ["OFFEN", "WARTET_AUF_DECKUNG", "FEHLER"].includes(row.status),
    },
  };
}

export async function auftraegeFuerBestellung(db, orderId) {
  try {
    const rows = await db.prepare("SELECT * FROM erstattungsauftraege WHERE order_id=? ORDER BY created_at DESC LIMIT 20")
      .bind(orderId).all();
    return (rows.results || []).map(row => auftragView(row));
  } catch (err) {
    if (ohneTabelle(err)) return [];
    throw err;
  }
}

// Soll das Paket gerade NICHT raus? Fuer die Admin-App (Versandknopf) und
// Packlink (Etikett kaufen). Die Sendungsverfolgung selbst wird nie
// blockiert: Ist ein Paket wirklich unterwegs, gilt das.
export async function versandSperre(db, orderId) {
  try {
    const auftrag = await db.prepare(`SELECT id,anlass FROM erstattungsauftraege WHERE order_id=? AND vor_versand=1
      AND status IN (${LAUFEND_SQL}) LIMIT 1`).bind(orderId).first();
    if (auftrag) {
      return { code: "STORNO_LAEUFT", text: "Für diese Bestellung läuft eine Stornierung mit Erstattung – bitte nicht versenden." };
    }
    const widerruf = await db.prepare(`SELECT w.id FROM widerrufe w JOIN commerce_orders o ON o.id=w.order_id
      WHERE w.order_id=? AND w.status IN ('EINGEGANGEN','IN_BEARBEITUNG') AND o.status IN ('PAID','PREPARING') LIMIT 1`)
      .bind(orderId).first();
    if (widerruf) {
      return { code: "WIDERRUF_VOR_VERSAND", text: "Die Kundin hat vor dem Versand widerrufen – bitte nicht versenden, sondern stornieren und erstatten." };
    }
    return null;
  } catch (err) {
    if (ohneTabelle(err)) return null;
    throw err;
  }
}

// --------------------------------------------------------------- Anlegen

function ganzzahl(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : NaN;
}

// eingabe: { anlass, artikelIds?, versandCents?, abzugCents?, abzugGrund?,
//            betragCents? (nur Kulanz), kundenGrund?, wiederVerfuegbar?,
//            widerrufId?, sofort? }
// deps:    { statusSetzen(orderId, status, { actor, nurInventar }), abgleichen() }
export async function erstattungBeauftragen(env, id, eingabe = {}, reqId = crypto.randomUUID(), deps = {}) {
  const db = env?.DB;
  if (!db) throw new AuftragFehler("COMMERCE_DATABASE_NOT_CONFIGURED", 503);
  const order = await ladeBestellung(db, safeText(id, 80));
  if (!order) throw new AuftragFehler("ORDER_NOT_FOUND", 404);
  const anlass = safeText(eingabe.anlass, 20).toUpperCase();
  if (!ANLAESSE.includes(anlass)) throw new AuftragFehler("ANLASS_UNBEKANNT", 400);

  // Laeuft schon einer, gilt der - ein zweiter Klick legt nichts Neues an,
  // sondern versucht den wartenden Auftrag sofort erneut (z. B. nachdem
  // Guthaben aufgeladen wurde). Zwei Klicks gleichzeitig laufen nie doppelt:
  // den Lauf bekommt nur einer (auftragAusfuehren).
  const laufend = await laufenderAuftrag(db, order.id);
  if (laufend) {
    if (eingabe.sofort !== false && ["OFFEN", "WARTET_AUF_DECKUNG", "FEHLER"].includes(laufend.status)) {
      const lauf = await auftragAusfuehren(env, laufend.id, reqId, deps, { erzwingen: true });
      return { auftrag: lauf.auftrag, bereits: true };
    }
    return { auftrag: auftragView(laufend, { orderNumber: order.order_number }), bereits: true };
  }

  if (!STATUS_JE_ANLASS[anlass].includes(String(order.status))) {
    throw new AuftragFehler("ERSTATTUNG_STATUS", 409, { status: order.status, anlass });
  }
  const payment = await paypalZahlung(db, order.id);
  if (!payment) throw new AuftragFehler("KEINE_PAYPAL_ZAHLUNG", 409);
  const schon = await schonErstattet(db, order.id);
  const offen = Number(order.total_cents) - schon;
  if (offen <= 0) throw new AuftragFehler("NICHTS_MEHR_OFFEN", 409);

  const stuecke = await ladeStuecke(db, order.id);
  const vorVersand = VOR_VERSAND.includes(String(order.status)) && anlass !== "KULANZ";
  let artikel = [];
  let versandCents = 0;
  let abzugCents = 0;
  let abzugGrund = null;
  let kundenGrund = null;
  let betrag;

  if (vorVersand) {
    // Storno oder Widerruf vor dem Versand: alles zurueck, nichts abgezogen.
    artikel = stuecke;
    versandCents = Number(order.shipping_cents || 0);
    betrag = offen;
  } else if (anlass === "KULANZ") {
    betrag = ganzzahl(eingabe.betragCents);
    kundenGrund = safeText(eingabe.kundenGrund || eingabe.grund || "", 300).trim() || null;
    if (!kundenGrund) throw new AuftragFehler("GRUND_FEHLT", 400);
    const ids = Array.isArray(eingabe.artikelIds) ? eingabe.artikelIds.map(Number) : [];
    artikel = stuecke.filter(s => ids.includes(Number(s.item_id)));
  } else {
    // Ruecksendung oder Widerruf nach dem Versand: nur die zurueckgekommenen
    // Stuecke, Hinsendekosten beim vollstaendigen Widerruf, ein Abzug
    // (Wertersatz) nur mit Grund.
    const ids = Array.isArray(eingabe.artikelIds) ? [...new Set(eingabe.artikelIds.map(Number))] : [];
    artikel = ids.length ? stuecke.filter(s => ids.includes(Number(s.item_id))) : stuecke;
    if (!artikel.length || (ids.length && artikel.length !== ids.length)) throw new AuftragFehler("ARTIKEL_UNBEKANNT", 400);
    const alle = artikel.length === stuecke.length;
    const versandWunsch = ganzzahl(eingabe.versandCents);
    if (Number.isNaN(versandWunsch)) throw new AuftragFehler("VERSAND_BETRAG_UNGUELTIG", 400);
    versandCents = versandWunsch === null ? (alle ? Number(order.shipping_cents || 0) : 0) : versandWunsch;
    if (versandCents < 0 || versandCents > Number(order.shipping_cents || 0)) throw new AuftragFehler("VERSAND_BETRAG_UNGUELTIG", 400);
    abzugCents = ganzzahl(eingabe.abzugCents) ?? 0;
    if (Number.isNaN(abzugCents) || abzugCents < 0) throw new AuftragFehler("ABZUG_UNGUELTIG", 400);
    abzugGrund = safeText(eingabe.abzugGrund || "", 300).trim() || null;
    if (abzugCents > 0 && !abzugGrund) throw new AuftragFehler("ABZUG_GRUND_FEHLT", 400);
    betrag = artikel.reduce((summe, s) => summe + Number(s.unit_price_cents || 0), 0) + versandCents - abzugCents;
  }
  if (!Number.isSafeInteger(betrag) || betrag <= 0) throw new AuftragFehler("BETRAG_UNGUELTIG", 400);
  if (betrag > offen) throw new AuftragFehler("BETRAG_ZU_HOCH", 409, { offenCents: offen, betragCents: betrag });
  // Nie mehr aus einer Capture erstatten, als PayPal fuer sie verbucht hat.
  if (betrag > Number(payment.amount_cents) - schon || payment.currency !== order.currency) {
    throw new AuftragFehler("ERSTATTUNG_BETRAG_ABWEICHUNG", 409, {
      bestellungCents: Number(order.total_cents), zahlungCents: Number(payment.amount_cents), erstattetCents: schon,
    });
  }

  const wiederVerfuegbar = anlass === "KULANZ" || eingabe.wiederVerfuegbar === false ? 0 : 1;
  let widerrufId = safeText(eingabe.widerrufId || "", 80) || null;
  if (!widerrufId && (anlass === "WIDERRUF" || anlass === "STORNO")) {
    try {
      widerrufId = (await db.prepare(`SELECT id FROM widerrufe WHERE order_id=? AND status IN ('EINGEGANGEN','IN_BEARBEITUNG')
        ORDER BY eingegangen_at LIMIT 1`).bind(order.id).first())?.id || null;
    } catch (err) {
      if (!ohneTabelle(err)) throw err;
    }
  }
  const jetzt = new Date().toISOString();
  const auftragId = crypto.randomUUID();
  const artikelJson = JSON.stringify(artikel.map(s => ({
    itemId: Number(s.item_id),
    inventoryId: String(s.inventory_id),
    titel: safeText(s.title_snapshot || "", 180),
    artikelNr: safeText(s.article_no || "", 40) || null,
    preisCents: Number(s.unit_price_cents || 0),
    bild: safeText(s.bild || "", 200) || null,
  })));
  try {
    await db.prepare(`INSERT INTO erstattungsauftraege (id,order_id,anlass,betrag_cents,artikel_json,versand_cents,abzug_cents,
        abzug_grund,kunden_grund,basis_erstattet_cents,wieder_verfuegbar,vor_versand,widerruf_id,status,erstellt_von,
        created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'OFFEN',?,?,?)`)
      .bind(auftragId, order.id, anlass, betrag, artikelJson, versandCents, abzugCents, abzugGrund, kundenGrund, schon,
        wiederVerfuegbar, vorVersand ? 1 : 0, widerrufId, eingabe.actor === "SYSTEM" ? "SYSTEM" : "ADMIN", jetzt, jetzt).run();
  } catch (err) {
    // Zwei Klicks gleichzeitig: der eindeutige Index laesst nur einen durch.
    const anderer = await laufenderAuftrag(db, order.id);
    if (anderer) return { auftrag: auftragView(anderer, { orderNumber: order.order_number }), bereits: true };
    throw err;
  }
  // Alte Versuche, die PayPal sicher abgelehnt hat (keine PayPal-Id), ersetzt
  // dieser Auftrag - sonst staenden sie weiter als "fehlgeschlagen" da.
  await db.prepare(`UPDATE refunds SET status='CANCELLED',updated_at=? WHERE order_id=? AND status='FAILED'
    AND provider_refund_id IS NULL`).bind(jetzt, order.id).run();
  if (widerrufId) {
    await db.prepare("UPDATE widerrufe SET status='IN_BEARBEITUNG',updated_at=? WHERE id=? AND status='EINGEGANGEN'")
      .bind(jetzt, widerrufId).run();
  }
  await protokoll(db, order.id, "ORDER_REFUND_JOB_CREATED", reqId, {
    auftragId, anlass, betragCents: betrag, wiederVerfuegbar: wiederVerfuegbar === 1, vorVersand,
  }, eingabe.actor === "SYSTEM" ? "SYSTEM" : "ADMIN");

  if (eingabe.sofort === false) return { auftrag: auftragView(await zeile(db, auftragId), { orderNumber: order.order_number }), bereits: false };
  const lauf = await auftragAusfuehren(env, auftragId, reqId, deps, { erzwingen: true });
  return { auftrag: lauf.auftrag, bereits: false };
}

// ------------------------------------------------------------- Ausfuehren

async function statusSetzen(db, auftragId, felder) {
  const namen = Object.keys(felder);
  const werte = namen.map(n => felder[n]);
  await db.prepare(`UPDATE erstattungsauftraege SET ${namen.map(n => `${n}=?`).join(",")},updated_at=? WHERE id=?`)
    .bind(...werte, new Date().toISOString(), auftragId).run();
}

function notizFuer(auftrag, order) {
  const anlass = ANLASS_TEXT[auftrag.anlass] || "Erstattung";
  return `${anlass} Bestellung ${order.order_number} – DISORDER119`;
}

// Ist das Geld dieses Auftrags schon zurueck (eigene Erstattung per Webhook,
// oder jemand hat direkt in PayPal erstattet)?
async function erfuellt(db, auftrag) {
  const schon = await schonErstattet(db, auftrag.order_id);
  return schon >= Number(auftrag.basis_erstattet_cents) + Number(auftrag.betrag_cents);
}

export async function auftragAusfuehren(env, auftragId, reqId = crypto.randomUUID(), deps = {}, { erzwingen = false, now = new Date() } = {}) {
  const db = env.DB;
  const jetzt = iso(now);
  const bis = new Date(now.getTime() + FAELLIG_SPIELRAUM_MS).toISOString();
  const verfall = new Date(now.getTime() - IN_ARBEIT_VERFALL_MS).toISOString();
  const zwang = erzwingen ? 1 : 0;
  // Genau ein Lauf je Auftrag: Admin-Klick und Cron koennen sich nicht in die
  // Quere kommen, die Datenbank laesst nur einen Anspruch durch.
  const anspruch = await db.prepare(`UPDATE erstattungsauftraege SET status='IN_ARBEIT',versuche=versuche+1,
      letzter_versuch_at=?,updated_at=?
    WHERE id=? AND (
      (status IN ('OFFEN','WARTET_AUF_DECKUNG') AND (?=1 OR naechster_versuch_at IS NULL OR naechster_versuch_at<=?))
      OR (status='FEHLER' AND (?=1 OR (fehler_endgueltig=0 AND (naechster_versuch_at IS NULL OR naechster_versuch_at<=?))))
      OR (status='IN_ARBEIT' AND letzter_versuch_at<?))`)
    .bind(jetzt, jetzt, auftragId, zwang, bis, zwang, bis, verfall).run();
  if (!anspruch.meta?.changes) {
    const row = await zeile(db, auftragId);
    if (!row) throw new AuftragFehler("AUFTRAG_NICHT_GEFUNDEN", 404);
    return { auftrag: auftragView(row), gelaufen: false };
  }
  let auftrag = await zeile(db, auftragId);
  const order = await ladeBestellung(db, auftrag.order_id);
  try {
    return await versuchen(env, auftrag, order, reqId, deps, now);
  } catch (err) {
    // Unerwarteter Fehler (Datenbank, Code): Auftrag bleibt bestehen und wird
    // spaeter erneut versucht - der PayPal-Schluessel bleibt gleich.
    log("error", "refund_job_failed", reqId, { auftragId, code: safeText(err?.code || err?.message || "unknown", 120) });
    await statusSetzen(db, auftragId, {
      status: "FEHLER", fehler_endgueltig: 0, letzter_fehler: safeText(err?.code || "INTERNER_FEHLER", 120),
      naechster_versuch_at: naechsterVersuch(auftrag.versuche, now),
    });
    auftrag = await zeile(db, auftragId);
    return { auftrag: auftragView(auftrag, { orderNumber: order?.order_number }), gelaufen: true };
  }
}

async function versuchen(env, auftrag, order, reqId, deps, now) {
  const db = env.DB;
  const jetzt = iso(now);
  const view = () => zeile(db, auftrag.id).then(row => ({ auftrag: auftragView(row, { orderNumber: order.order_number }), gelaufen: true }));

  if (await erfuellt(db, auftrag)) {
    await auftragAbschliessen(env, auftrag.id, reqId, deps, now);
    return view();
  }
  const payment = await paypalZahlung(db, order.id);
  if (!payment) {
    await statusSetzen(db, auftrag.id, { status: "FEHLER", fehler_endgueltig: 1, letzter_fehler: "KEINE_PAYPAL_ZAHLUNG", naechster_versuch_at: null });
    await inhaberMelden(env, auftrag, order, "fehler", reqId);
    return view();
  }
  // Storno vor dem Versand, aber das Paket ist inzwischen unterwegs: nicht
  // blind auszahlen - sonst hat die Kundin Geld und Ware.
  if (Number(auftrag.vor_versand) === 1 && !VOR_VERSAND.includes(String(order.status))) {
    await statusSetzen(db, auftrag.id, { status: "FEHLER", fehler_endgueltig: 1, letzter_fehler: "SCHON_VERSENDET", naechster_versuch_at: null });
    await inhaberMelden(env, auftrag, order, "fehler", reqId);
    return view();
  }
  const schon = await schonErstattet(db, order.id);
  if (Number(auftrag.betrag_cents) > Number(order.total_cents) - schon) {
    await statusSetzen(db, auftrag.id, { status: "FEHLER", fehler_endgueltig: 1, letzter_fehler: "BETRAG_UEBERHOLT", naechster_versuch_at: null });
    await inhaberMelden(env, auftrag, order, "fehler", reqId);
    return view();
  }

  // Eine Refund-Zeile je Auftrag. Ihre idempotency_key ist PayPals
  // Request-Id: gleich bei unklarem Ausgang, neu nach sicherer Ablehnung.
  let refund = auftrag.refund_id ? await db.prepare("SELECT * FROM refunds WHERE id=?").bind(auftrag.refund_id).first() : null;
  if (refund?.status === "COMPLETED") {
    await auftragAbschliessen(env, auftrag.id, reqId, deps, now);
    return view();
  }
  if (!refund) {
    const refundId = crypto.randomUUID();
    const schluessel = `auftrag:${auftrag.id}`;
    await db.batch([
      db.prepare(`INSERT INTO refunds (id,order_id,payment_id,amount_cents,currency,status,idempotency_key,created_at,updated_at)
        VALUES (?,?,?,?,'EUR','PENDING',?,?,?)`).bind(refundId, order.id, payment.id, Number(auftrag.betrag_cents), schluessel, jetzt, jetzt),
      db.prepare("UPDATE erstattungsauftraege SET refund_id=?,updated_at=? WHERE id=?").bind(refundId, jetzt, auftrag.id),
    ]);
    refund = { id: refundId, idempotency_key: schluessel, status: "PENDING", provider_refund_id: null };
  } else if (refund.status === "FAILED" || refund.status === "CANCELLED") {
    const neu = `auftrag:${auftrag.id}:${auftrag.versuche}`;
    await db.prepare("UPDATE refunds SET status='PENDING',idempotency_key=?,updated_at=? WHERE id=?")
      .bind(neu, jetzt, refund.id).run();
    refund = { ...refund, status: "PENDING", idempotency_key: neu };
  } else if (refund.provider_refund_id) {
    // PayPal hat diese Erstattung schon angenommen (PENDING) - nachfragen
    // statt neu auszuloesen.
    await statusSetzen(db, auftrag.id, { status: "BEI_PAYPAL", naechster_versuch_at: jetzt });
    return beiPaypalPruefen(env, await zeile(db, auftrag.id), order, reqId, deps, now);
  }

  const ergebnis = await paypalCaptureErstatten(env, {
    captureId: payment.provider_payment_id,
    betragCents: Number(auftrag.betrag_cents),
    volleCapture: schon === 0 && Number(auftrag.betrag_cents) === Number(payment.amount_cents),
    requestId: refund.idempotency_key,
    notiz: notizFuer(auftrag, order),
  });

  if (ergebnis.ok) {
    await refundUebernehmen(db, auftrag, refund, ergebnis, jetzt);
    await protokoll(db, order.id, "ORDER_REFUND_SENT", reqId, {
      auftragId: auftrag.id, anlass: auftrag.anlass, betragCents: Number(auftrag.betrag_cents),
      paypalStatus: ergebnis.status, refundId: ergebnis.refundId,
    });
    if (ergebnis.status === "COMPLETED") {
      await zahlungsstatusNachziehen(db, payment, order);
      await auftragAbschliessen(env, auftrag.id, reqId, deps, now);
      return view();
    }
    await statusSetzen(db, auftrag.id, {
      status: "BEI_PAYPAL", letzter_fehler: ergebnis.grund ? `PAYPAL_PENDING:${ergebnis.grund}` : null,
      naechster_versuch_at: new Date(now.getTime() + BEI_PAYPAL_PRUEFEN_MS).toISOString(),
    });
    return view();
  }

  // Abgelehnt oder unklar.
  const meta = {
    auftragId: auftrag.id, grund: ergebnis.grund, art: ergebnis.art, debugId: ergebnis.debugId,
    paypalStatus: ergebnis.httpStatus, betragCents: Number(auftrag.betrag_cents),
  };
  await protokoll(db, order.id, "ORDER_REFUND_FAILED", reqId, meta);
  log("warn", "refund_job_attempt_failed", reqId, meta);

  if (ergebnis.art === "VORLAEUFIG") {
    // PENDING bleibt: derselbe Schluessel holt beim naechsten Mal die echte
    // Antwort ab, falls PayPal doch ausgezahlt hat.
    await statusSetzen(db, auftrag.id, {
      status: "FEHLER", fehler_endgueltig: 0, letzter_fehler: ergebnis.grund,
      naechster_versuch_at: naechsterVersuch(auftrag.versuche, now),
    });
    if (Number(auftrag.versuche) >= 6) await inhaberMelden(env, auftrag, order, "fehler", reqId);
    return view();
  }
  await db.prepare("UPDATE refunds SET status=?,updated_at=? WHERE id=?")
    .bind(ergebnis.art === "SCHON_ERSTATTET" ? "CANCELLED" : "FAILED", jetzt, refund.id).run();

  if (ergebnis.art === "DECKUNG") {
    await statusSetzen(db, auftrag.id, {
      status: "WARTET_AUF_DECKUNG", fehler_endgueltig: 0, letzter_fehler: ergebnis.grund,
      naechster_versuch_at: naechsterVersuch(auftrag.versuche, now),
    });
    await inhaberMelden(env, auftrag, order, "deckung", reqId);
    return view();
  }
  if (ergebnis.art === "SCHON_ERSTATTET") {
    // PayPal sagt, das Geld sei schon zurueck: Erstattungen nachlesen und
    // pruefen, ob sie diesen Auftrag abdecken.
    if (typeof deps.abgleichen === "function") {
      try { await deps.abgleichen(); } catch (err) { log("warn", "refund_job_sync_failed", reqId, { code: safeText(err?.code || err?.message, 80) }); }
    }
    if (await erfuellt(db, auftrag)) {
      await auftragAbschliessen(env, auftrag.id, reqId, deps, now);
      return view();
    }
    await statusSetzen(db, auftrag.id, { status: "FEHLER", fehler_endgueltig: 1, letzter_fehler: ergebnis.grund, naechster_versuch_at: null });
    await inhaberMelden(env, auftrag, order, "fehler", reqId);
    return view();
  }
  if (ergebnis.art === "ABGELEHNT" && Number(auftrag.versuche) < ABGELEHNT_HOECHSTENS) {
    await statusSetzen(db, auftrag.id, {
      status: "FEHLER", fehler_endgueltig: 0, letzter_fehler: ergebnis.grund,
      naechster_versuch_at: naechsterVersuch(auftrag.versuche + 8, now),
    });
    await inhaberMelden(env, auftrag, order, "fehler", reqId);
    return view();
  }
  await statusSetzen(db, auftrag.id, { status: "FEHLER", fehler_endgueltig: 1, letzter_fehler: ergebnis.grund, naechster_versuch_at: null });
  await inhaberMelden(env, auftrag, order, "fehler", reqId);
  return view();
}

// PayPals Antwort in die eigene Refund-Zeile. War der Webhook schneller und
// hat die Erstattung schon als eigene Zeile angelegt, gilt dessen Zeile.
async function refundUebernehmen(db, auftrag, refund, ergebnis, jetzt) {
  const vorhanden = ergebnis.refundId
    ? await db.prepare("SELECT id,status FROM refunds WHERE provider_refund_id=? AND id<>?").bind(ergebnis.refundId, refund.id).first()
    : null;
  if (vorhanden) {
    await db.batch([
      db.prepare("UPDATE refunds SET status='CANCELLED',updated_at=? WHERE id=?").bind(jetzt, refund.id),
      db.prepare(`UPDATE refunds SET status=CASE WHEN status='COMPLETED' THEN 'COMPLETED' ELSE ? END,updated_at=? WHERE id=?`)
        .bind(ergebnis.status, jetzt, vorhanden.id),
      db.prepare("UPDATE erstattungsauftraege SET refund_id=?,updated_at=? WHERE id=?").bind(vorhanden.id, jetzt, auftrag.id),
    ]);
    return;
  }
  await db.prepare(`UPDATE refunds SET status=CASE WHEN status='COMPLETED' THEN 'COMPLETED' ELSE ? END,
      provider_refund_id=COALESCE(provider_refund_id,?),updated_at=? WHERE id=?`)
    .bind(ergebnis.status, ergebnis.refundId, jetzt, refund.id).run();
}

// PayPal hat angenommen, bucht aber noch (PENDING): nachfragen.
async function beiPaypalPruefen(env, auftrag, order, reqId, deps, now) {
  const db = env.DB;
  const jetzt = iso(now);
  const view = () => zeile(db, auftrag.id).then(row => ({ auftrag: auftragView(row, { orderNumber: order.order_number }), gelaufen: true }));
  if (await erfuellt(db, auftrag)) {
    await auftragAbschliessen(env, auftrag.id, reqId, deps, now);
    return view();
  }
  const refund = auftrag.refund_id ? await db.prepare("SELECT * FROM refunds WHERE id=?").bind(auftrag.refund_id).first() : null;
  if (!refund?.provider_refund_id) {
    await statusSetzen(db, auftrag.id, { status: "FEHLER", fehler_endgueltig: 0, letzter_fehler: "PAYPAL_STATUS_UNBEKANNT", naechster_versuch_at: jetzt });
    return view();
  }
  let stand;
  try {
    stand = await paypalErstattungAbfragen(env, refund.provider_refund_id);
  } catch (err) {
    await statusSetzen(db, auftrag.id, { naechster_versuch_at: new Date(now.getTime() + BEI_PAYPAL_PRUEFEN_MS).toISOString() });
    log("warn", "refund_job_status_check_failed", reqId, { auftragId: auftrag.id, code: safeText(err?.code || err?.message, 80) });
    return view();
  }
  if (stand.status === "COMPLETED") {
    await db.prepare("UPDATE refunds SET status='COMPLETED',updated_at=? WHERE id=?").bind(jetzt, refund.id).run();
    const payment = await paypalZahlung(db, order.id);
    if (payment) await zahlungsstatusNachziehen(db, payment, order);
    await auftragAbschliessen(env, auftrag.id, reqId, deps, now);
    return view();
  }
  if (stand.status === "FAILED" || stand.status === "CANCELLED") {
    await db.prepare("UPDATE refunds SET status='FAILED',updated_at=? WHERE id=?").bind(jetzt, refund.id).run();
    await statusSetzen(db, auftrag.id, {
      status: "FEHLER", fehler_endgueltig: 0, letzter_fehler: `REFUND_${stand.status}`,
      naechster_versuch_at: naechsterVersuch(auftrag.versuche + 8, now),
    });
    await inhaberMelden(env, auftrag, order, "fehler", reqId);
    return view();
  }
  await statusSetzen(db, auftrag.id, { naechster_versuch_at: new Date(now.getTime() + BEI_PAYPAL_PRUEFEN_MS).toISOString() });
  return view();
}

// ------------------------------------------------------------ Abschliessen

// Stuecke zurueck in den Shop: Lager auf "verfuegbar" (aus Erstattet,
// Storniert oder Zurueckgeschickt), im Katalog ueber einen Pull Request.
// Ein Stueck, das inzwischen einer anderen Bestellung gehoert, bleibt, wie es
// ist. Wird auch vom Knopf "Wieder in den Shop" benutzt.
export async function stueckeZurueckInDenShop(env, order, itemIds, reqId, anlass = "Storno") {
  const db = env.DB;
  const alle = (await db.prepare("SELECT item_id,inventory_id FROM order_items WHERE order_id=? ORDER BY rowid").bind(order.id).all()).results || [];
  const auswahl = Array.isArray(itemIds) ? alle.filter(it => itemIds.map(Number).includes(Number(it.item_id))) : alle;
  const now = new Date().toISOString();
  if (auswahl.length) {
    await db.batch(auswahl.map(it => db.prepare(`UPDATE inventory SET status='AVAILABLE',updated_at=?,version=version+1
      WHERE id=? AND status IN ('REFUNDED','CANCELLED','RETURNED')`).bind(now, it.inventory_id)));
  }
  const inventarIds = auswahl.map(it => String(it.inventory_id));
  const frei = inventarIds.length
    ? ((await db.prepare(`SELECT oi.item_id FROM order_items oi JOIN inventory i ON i.id=oi.inventory_id
        WHERE oi.order_id=? AND i.status='AVAILABLE' AND oi.inventory_id IN (${inventarIds.map(() => "?").join(",")})
        ORDER BY oi.rowid`).bind(order.id, ...inventarIds).all()).results || []).map(row => row.item_id)
    : [];
  let katalog;
  try {
    katalog = frei.length
      ? await artikelWiederVerfuegbar(env, frei, `${anlass} ${order.order_number}`)
      : { ok: true, geaendert: [] };
  } catch (err) {
    log("error", "catalog_relist_failed", reqId, { orderId: String(order.id), code: safeText(err?.code || err?.message || "unknown", 80) });
    katalog = { ok: false, code: safeText(err?.code || "KATALOG_FEHLER", 80) };
  }
  await protokoll(db, order.id, "ORDER_ITEMS_RELISTED", reqId, {
    itemIds: auswahl.map(it => Number(it.item_id)),
    katalog: Boolean(katalog.ok),
    geaendert: katalog.geaendert || [],
    pullRequest: katalog.pullRequest ?? null,
    code: katalog.code || undefined,
  }, "ADMIN");
  return {
    ok: Boolean(katalog.ok),
    itemIds: auswahl.map(it => Number(it.item_id)),
    geaendert: katalog.geaendert || [],
    pullRequest: katalog.pullRequest ?? null,
    code: katalog.code || null,
  };
}

// Alles, was nach der Rueckzahlung passiert. Jeder Schritt steht einzeln im
// Auftrag; scheitert einer, holt der Cron ihn nach (NACHARBEIT_TAGE lang).
export async function auftragAbschliessen(env, auftragId, reqId = crypto.randomUUID(), deps = {}, now = new Date()) {
  const db = env.DB;
  const jetzt = iso(now);
  await db.prepare(`UPDATE erstattungsauftraege SET status='ERLEDIGT',erledigt_at=COALESCE(erledigt_at,?),
      naechster_versuch_at=NULL,fehler_endgueltig=0,letzter_fehler=NULL,updated_at=?
    WHERE id=? AND status<>'ABGEBROCHEN'`).bind(jetzt, jetzt, auftragId).run();
  let auftrag = await zeile(db, auftragId);
  if (!auftrag || auftrag.status !== "ERLEDIGT") return auftrag;
  let order = await ladeBestellung(db, auftrag.order_id);
  const erstmals = auftrag.erledigt_at === jetzt;
  // Kam das Geld auf anderem Weg zurueck (direkt in PayPal), bleibt die eigene,
  // sicher abgelehnte Zeile sonst als "fehlgeschlagen" stehen.
  if (auftrag.refund_id) {
    await db.prepare("UPDATE refunds SET status='CANCELLED',updated_at=? WHERE id=? AND status='FAILED' AND provider_refund_id IS NULL")
      .bind(jetzt, auftrag.refund_id).run();
  }
  if (erstmals) {
    await protokoll(db, order.id, "ORDER_REFUND_JOB_DONE", reqId, {
      auftragId, anlass: auftrag.anlass, betragCents: Number(auftrag.betrag_cents),
    });
  }

  // 1. Bestellung "Erstattet", sobald alles zurueckgezahlt ist.
  const schon = await schonErstattet(db, order.id);
  if (schon >= Number(order.total_cents) && order.status !== "REFUNDED"
    && ["PAID", "PREPARING", "RETURNED"].includes(order.status) && typeof deps.statusSetzen === "function") {
    const stuecke = await ladeStuecke(db, order.id);
    try {
      await deps.statusSetzen(order.id, "REFUNDED", {
        actor: "SYSTEM",
        nurInventar: stuecke.filter(s => INVENTAR_ZU_ERSTATTET.includes(String(s.inventory_status))).map(s => String(s.inventory_id)),
      });
    } catch (err) {
      log("error", "refund_job_order_status_failed", reqId, { auftragId, code: safeText(err?.code || err?.message, 80) });
    }
    order = await ladeBestellung(db, order.id);
  }

  // 2. Ruecksendung und Widerruf abschliessen.
  const offeneRuecksendung = ["REFUNDED"].includes(order.status) || auftrag.anlass !== "KULANZ";
  if (offeneRuecksendung) {
    await db.prepare(`UPDATE returns SET status='CLOSED',updated_at=? WHERE order_id=? AND status IN ('RECEIVED','INSPECTED')`)
      .bind(jetzt, order.id).run();
    if (order.status === "REFUNDED") {
      await db.prepare(`UPDATE returns SET status='CLOSED',updated_at=? WHERE order_id=? AND status NOT IN ('CLOSED','REJECTED')`)
        .bind(jetzt, order.id).run();
    }
  }
  if (auftrag.widerruf_id) {
    try {
      await db.prepare("UPDATE widerrufe SET status='ERLEDIGT',updated_at=? WHERE id=? AND status IN ('EINGEGANGEN','IN_BEARBEITUNG')")
        .bind(jetzt, auftrag.widerruf_id).run();
    } catch (err) {
      if (!ohneTabelle(err)) throw err;
    }
  }

  // 3. Stuecke zurueck in den Shop.
  if (Number(auftrag.wieder_verfuegbar) === 1 && !auftrag.wieder_im_shop_at) {
    const artikel = artikelAus(auftrag).map(a => a.itemId);
    const ergebnis = await stueckeZurueckInDenShop(env, order, artikel.length ? artikel : null, reqId, ANLASS_TEXT[auftrag.anlass]);
    if (ergebnis.ok) await statusSetzen(db, auftragId, { wieder_im_shop_at: jetzt });
  }

  // 4. Mail an die Kundin - erst jetzt, das Geld ist wirklich zurueck.
  if (!auftrag.kunde_benachrichtigt_at && !["KEINE_ADRESSE", "GESENDET"].includes(auftrag.kunde_mail_status)) {
    let mailStatus = "FEHLER";
    try {
      const mail = await sendRefundConfirmation(env, auftrag, reqId);
      if (mail.sent || mail.duplicate) mailStatus = "GESENDET";
      else if (mail.reason === "NO_CUSTOMER_EMAIL") mailStatus = "KEINE_ADRESSE";
      else if (mail.reason === "NOT_CONFIGURED") mailStatus = "NICHT_EINGERICHTET";
    } catch (err) {
      log("error", "refund_confirmation_failed", reqId, { auftragId, message: safeText(err?.message, 160) });
    }
    await statusSetzen(db, auftragId, {
      kunde_mail_status: mailStatus,
      kunde_benachrichtigt_at: mailStatus === "GESENDET" ? jetzt : null,
    });
  }

  // 5. Meldung an den Inhaber (genau einmal).
  auftrag = await zeile(db, auftragId);
  await erledigtMelden(env, auftrag, order, reqId);
  return auftrag;
}

// ---------------------------------------------------------- Inhaber melden

function telegramText(art, auftrag, order, extra = {}) {
  const betrag = euroAmount(auftrag.betrag_cents);
  const anlass = ANLASS_TEXT[auftrag.anlass] || auftrag.anlass;
  const kopf = `Bestellung ${order.order_number} · ${anlass} · ${betrag}`;
  if (art === "deckung") {
    return [
      "DISORDER119 — ERSTATTUNG WARTET",
      kopf,
      extra.fehltCents > 0 ? `PayPal-Guthaben reicht nicht – es fehlen ${euroAmount(extra.fehltCents)}.` : "PayPal-Guthaben reicht nicht.",
      "Lade Guthaben auf oder bestätige ein Bankkonto in PayPal.",
      "Der Shop versucht es automatisch weiter. Die Kundin bekommt ihre Mail erst, wenn das Geld zurück ist.",
      ...(extra.frist ? [`Frist für die Rückzahlung: ${deutschesDatum(extra.frist)}`] : []),
    ].join("\n");
  }
  if (art === "erinnerung") {
    return [
      "DISORDER119 — ERSTATTUNG WARTET NOCH",
      kopf,
      fehlerText(auftrag.letzter_fehler) || "Der letzte Versuch ist gescheitert.",
      `Versuche bisher: ${auftrag.versuche}`,
      ...(extra.frist ? [`Frist für die Rückzahlung: ${deutschesDatum(extra.frist)}`] : []),
      "Admin-App → Bestellung → „Jetzt erneut versuchen“.",
    ].join("\n");
  }
  if (art === "fehler") {
    return [
      "DISORDER119 — ERSTATTUNG BRAUCHT DICH",
      kopf,
      fehlerText(auftrag.letzter_fehler) || "Der letzte Versuch ist gescheitert.",
      "Admin-App → Bestellung öffnen.",
    ].join("\n");
  }
  return [
    "DISORDER119 — ERSTATTET",
    kopf,
    `Kundin informiert: ${auftrag.kunde_mail_status === "GESENDET" ? "ja" : auftrag.kunde_mail_status === "KEINE_ADRESSE" ? "nein (keine Mailadresse)" : "noch nicht – wird nachgeholt"}`,
    ...(Number(auftrag.wieder_verfuegbar) === 1
      ? [`Wieder im Shop: ${auftrag.wieder_im_shop_at ? "ja" : "noch nicht – wird nachgeholt"}`]
      : []),
  ].join("\n");
}

function deutschesDatum(wert) {
  const d = new Date(wert);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", year: "numeric" }).format(d);
}

async function widerrufsfrist(db, auftrag) {
  if (!auftrag.widerruf_id) return null;
  try {
    const w = await db.prepare("SELECT eingegangen_at FROM widerrufe WHERE id=?").bind(auftrag.widerruf_id).first();
    return w ? erstattungsfrist(w.eingegangen_at) : null;
  } catch (err) {
    if (ohneTabelle(err)) return null;
    throw err;
  }
}

async function inhaberMelden(env, auftrag, order, art, reqId) {
  const db = env.DB;
  const row = await zeile(db, auftrag.id);
  // Eine Meldung je Lage, danach hoechstens taeglich eine Erinnerung (Cron).
  if (row?.inhaber_gemeldet_at && Date.now() - Date.parse(row.inhaber_gemeldet_at) < ERINNERN_ALLE_MS
    && row.letzter_fehler === auftrag.letzter_fehler) return;
  const extra = { frist: await widerrufsfrist(db, row) };
  if (art === "deckung") {
    const guthaben = await paypalGuthaben(env);
    if (guthaben.bekannt) extra.fehltCents = Number(row.betrag_cents) - Number(guthaben.verfuegbarCents);
  }
  try {
    await sendTelegramMessage(env, telegramText(art, row, order, extra), reqId);
  } catch (err) {
    log("warn", "refund_job_owner_notice_failed", reqId, { auftragId: auftrag.id, message: safeText(err?.message, 120) });
  }
  await statusSetzen(db, auftrag.id, { inhaber_gemeldet_at: new Date().toISOString() });
}

async function erledigtMelden(env, auftrag, order, reqId) {
  const claim = await env.DB.prepare(`INSERT OR IGNORE INTO audit_events
    (id,actor_type,entity_type,entity_id,event_type,request_id,metadata_json,created_at)
    VALUES (?,'SYSTEM','order',?,'REFUND_DONE_OWNER_NOTICE',?,?,?)`)
    .bind(`notify:telegram:refund-done:${auftrag.id}`, order.id, safeText(reqId, 120),
      JSON.stringify({ auftragId: auftrag.id }), new Date().toISOString()).run();
  if (!claim.meta?.changes) return;
  try {
    await sendTelegramMessage(env, telegramText("erledigt", auftrag, order), reqId);
  } catch (err) {
    log("warn", "refund_done_owner_notice_failed", reqId, { auftragId: auftrag.id, message: safeText(err?.message, 120) });
  }
}

// ------------------------------------------------------------- Abbrechen

export async function auftragAbbrechen(env, auftragId, grund, reqId = crypto.randomUUID()) {
  const db = env.DB;
  const row = await zeile(db, safeText(auftragId, 80));
  if (!row) throw new AuftragFehler("AUFTRAG_NICHT_GEFUNDEN", 404);
  if (row.status === "ABGEBROCHEN") return auftragView(row);
  // Waehrend PayPal bucht oder ein Lauf aktiv ist, nicht abbrechen - sonst
  // wuerde Geld fliessen, das der Shop nicht mehr zuordnet.
  if (!["OFFEN", "WARTET_AUF_DECKUNG", "FEHLER"].includes(row.status)) throw new AuftragFehler("AUFTRAG_NICHT_ABBRECHBAR", 409);
  const jetzt = new Date().toISOString();
  const result = await db.prepare(`UPDATE erstattungsauftraege SET status='ABGEBROCHEN',naechster_versuch_at=NULL,updated_at=?
    WHERE id=? AND status IN ('OFFEN','WARTET_AUF_DECKUNG','FEHLER')`).bind(jetzt, row.id).run();
  if (!result.meta?.changes) throw new AuftragFehler("AUFTRAG_STATUS_GEAENDERT", 409);
  // Eine nie ausgezahlte Refund-Zeile gilt als storniert. Eine mit unklarem
  // Ausgang (PENDING) bleibt stehen - der Abgleich klaert sie.
  if (row.refund_id) {
    await db.prepare(`UPDATE refunds SET status='CANCELLED',updated_at=? WHERE id=? AND status='FAILED'`)
      .bind(jetzt, row.refund_id).run();
  }
  await protokoll(db, row.order_id, "ORDER_REFUND_JOB_CANCELLED", reqId, {
    auftragId: row.id, grund: safeText(grund || "", 200) || null,
  }, "ADMIN");
  return auftragView(await zeile(db, row.id));
}

// ---------------------------------------------------------- Webhook, Cron

// Nach einer Erstattungsmeldung von PayPal: laufende Auftraege dieser
// Bestellung abschliessen, deren Geld jetzt zurueck ist.
export async function auftraegeDerBestellungPruefen(env, orderId, reqId, deps = {}) {
  const auftrag = await laufenderAuftrag(env.DB, orderId);
  if (!auftrag || auftrag.status === "IN_ARBEIT") return null;
  if (!(await erfuellt(env.DB, auftrag))) return null;
  return auftragAbschliessen(env, auftrag.id, reqId, deps);
}

// Cron: faellige Auftraege, PayPal-Stand, Nacharbeit, Erinnerungen.
export async function erstattungsauftraegePflegen(env, reqId = crypto.randomUUID(), deps = {}, now = new Date()) {
  const db = env?.DB;
  const ergebnis = { ok: true, ausgefuehrt: 0, erledigt: 0, nachgeholt: 0, erinnert: 0, fehler: [] };
  if (!db) return { ...ergebnis, ok: false };
  const bis = new Date(now.getTime() + FAELLIG_SPIELRAUM_MS).toISOString();
  const verfall = new Date(now.getTime() - IN_ARBEIT_VERFALL_MS).toISOString();
  let laufend;
  try {
    laufend = (await db.prepare(`SELECT * FROM erstattungsauftraege WHERE status IN (${LAUFEND_SQL})
      ORDER BY created_at LIMIT 50`).all()).results || [];
  } catch (err) {
    if (ohneTabelle(err)) return { ...ergebnis, ok: false, code: "TABELLE_FEHLT" };
    throw err;
  }

  let budget = AUFTRAEGE_JE_LAUF;
  for (const row of laufend) {
    try {
      // Geld schon zurueck (Webhook, Abgleich, direkt in PayPal)?
      if (row.status !== "IN_ARBEIT" && await erfuellt(db, row)) {
        await auftragAbschliessen(env, row.id, reqId, deps, now);
        ergebnis.erledigt += 1;
        continue;
      }
      if (budget <= 0) continue;
      const order = await ladeBestellung(db, row.order_id);
      if (row.status === "BEI_PAYPAL") {
        if (!row.naechster_versuch_at || row.naechster_versuch_at <= bis) {
          budget -= 1;
          await beiPaypalPruefen(env, row, order, reqId, deps, now);
          ergebnis.ausgefuehrt += 1;
        }
        continue;
      }
      const faellig = row.status === "IN_ARBEIT"
        ? String(row.letzter_versuch_at || "") < verfall
        : (row.status !== "FEHLER" || Number(row.fehler_endgueltig) === 0)
          && (!row.naechster_versuch_at || row.naechster_versuch_at <= bis);
      if (faellig) {
        budget -= 1;
        const lauf = await auftragAusfuehren(env, row.id, reqId, deps, { now });
        if (lauf.gelaufen) ergebnis.ausgefuehrt += 1;
        if (lauf.auftrag?.status === "ERLEDIGT") ergebnis.erledigt += 1;
        continue;
      }
      // Wartet weiter: hoechstens taeglich erinnern.
      if (["WARTET_AUF_DECKUNG", "FEHLER"].includes(row.status)
        && (!row.inhaber_gemeldet_at || now.getTime() - Date.parse(row.inhaber_gemeldet_at) >= ERINNERN_ALLE_MS)) {
        const extra = { frist: await widerrufsfrist(db, row) };
        await sendTelegramMessage(env, telegramText("erinnerung", row, order, extra), reqId).catch(() => null);
        await statusSetzen(db, row.id, { inhaber_gemeldet_at: now.toISOString() });
        ergebnis.erinnert += 1;
      }
    } catch (err) {
      ergebnis.fehler.push(safeText(err?.code || err?.message || "REFUND_JOB_ERROR", 80));
      log("error", "refund_job_cron_failed", reqId, { auftragId: row.id, code: safeText(err?.code || err?.message, 120) });
    }
  }

  // Nacharbeit: Geld ist zurueck, aber Mail oder "wieder im Shop" fehlen noch.
  const seit = new Date(now.getTime() - NACHARBEIT_TAGE * 24 * 60 * 60 * 1000).toISOString();
  const offen = (await db.prepare(`SELECT id FROM erstattungsauftraege WHERE status='ERLEDIGT' AND erledigt_at>=?
      AND ((kunde_benachrichtigt_at IS NULL AND (kunde_mail_status IS NULL OR kunde_mail_status IN ('FEHLER','NICHT_EINGERICHTET')))
        OR (wieder_verfuegbar=1 AND wieder_im_shop_at IS NULL))
    ORDER BY erledigt_at LIMIT 10`).bind(seit).all()).results || [];
  for (const row of offen) {
    try {
      await auftragAbschliessen(env, row.id, reqId, deps, now);
      ergebnis.nachgeholt += 1;
    } catch (err) {
      ergebnis.fehler.push(safeText(err?.code || err?.message || "REFUND_FOLLOWUP_ERROR", 80));
    }
  }
  ergebnis.ok = ergebnis.fehler.length === 0;
  return ergebnis;
}

// Uebersicht fuer die Admin-App: alles, was laeuft oder Hilfe braucht, dazu
// die zuletzt erledigten und - wenn PayPal es verraet - das Guthaben.
export async function erstattungenUebersicht(env) {
  const db = env.DB;
  let rows = [];
  try {
    rows = (await db.prepare(`SELECT e.*,o.order_number FROM erstattungsauftraege e JOIN commerce_orders o ON o.id=e.order_id
      WHERE e.status IN (${LAUFEND_SQL}) OR e.created_at>=?
      ORDER BY CASE WHEN e.status IN (${LAUFEND_SQL}) THEN 0 ELSE 1 END, e.created_at DESC LIMIT 100`)
      .bind(new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString()).all()).results || [];
  } catch (err) {
    if (!ohneTabelle(err)) throw err;
  }
  const auftraege = rows.map(row => auftragView(row, { orderNumber: row.order_number }));
  const wartend = auftraege.filter(a => a.status === "WARTET_AUF_DECKUNG");
  const guthaben = wartend.length && env.PAYPAL_CLIENT_ID ? await paypalGuthaben(env) : null;
  const benoetigt = wartend.reduce((summe, a) => summe + a.betragCents, 0);
  return {
    auftraege,
    offeneAuftraege: auftraege.filter(a => a.laufend).length,
    brauchtHilfe: auftraege.filter(a => a.status === "FEHLER" && a.fehlerEndgueltig).length,
    paypal: guthaben
      ? { ...guthaben, benoetigtCents: benoetigt, fehltCents: guthaben.bekannt ? Math.max(0, benoetigt - guthaben.verfuegbarCents) : null }
      : null,
  };
}

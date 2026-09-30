// Zahlung beim Kauf nur reservieren, beim Versand einziehen.
//
// Die Kasse bestellt bei PayPal mit intent AUTHORIZE: PayPal reserviert den
// Betrag bei der Kundin, bewegt aber noch kein Geld. Eingezogen (Capture)
// wird erst,
//   * sobald ein Etikett gekauft wird (Packlink, DHL) oder die Bestellung auf
//     "Versendet" geht,
//   * spaetestens gut zweieinhalb Tage nach dem Kauf (PayPal garantiert eine
//     Reservierung drei Tage lang, danach kann das Einziehen scheitern),
//   * oder mit "Jetzt einziehen" in der Admin-App.
// Ein Storno vor dem Versand gibt die Reservierung frei (Void): es fliesst
// kein Geld, PayPal berechnet keine Gebuehr, es braucht kein Guthaben.
//
// Klappt das Einziehen nicht, bleibt der Versand gesperrt, und der Inhaber
// bekommt eine Telegram-Nachricht ("NICHT VERSENDEN").
//
// Doppelt eingezogen wird nie: PayPal bekommt je Zahlung immer dieselbe
// Request-Id, und eine Reservierung laesst sich ohnehin nur einmal voll
// einziehen. Die Rechnung geht erst nach dem Einziehen raus - vorher ist
// nichts verkauft, was eine Rechnung braucht, und ein Storno braucht keine
// Stornorechnung.
import { safeText } from "./commerce-core.js";
import { paypalApiBase, paypalToken } from "./erstattung.js";
import { captureStatements, decimalCents } from "./tax-evidence.js";
import { euroAmount, sendInvoiceAfterCapture } from "./customer-mail.js";
import { sendTelegramMessage } from "./notifications.js";

const STUNDE_MS = 60 * 60 * 1000;
// Spaetestens dann zieht der Cron ein: drei Tage Garantiezeit minus sechs
// Stunden Sicherheitsabstand fuer Cron-Takt und kurze PayPal-Stoerungen.
export const EINZUG_SPAETESTENS_MS = 66 * STUNDE_MS;
// So lange haelt PayPal eine Reservierung hoechstens.
export const RESERVIERUNG_GUELTIG_MS = 29 * 24 * STUNDE_MS;
const EINZUEGE_JE_LAUF = 8;
const RECHNUNGEN_JE_LAUF = 5;
const RECHNUNG_NACHHOLEN_TAGE = 14;

export const EINGEZOGEN = Object.freeze(["COMPLETED", "PARTIALLY_REFUNDED", "REFUNDED"]);

export class ZahlungFehler extends Error {
  constructor(code, status = 409, text = "") {
    super(code);
    this.code = code;
    this.status = status;
    this.text = text || zahlungFehlerText(code);
  }
}

// Klartext fuer Admin-App und Telegram. Unbekannte Codes bleiben lesbar.
const FEHLER_TEXT = Object.freeze({
  KEINE_ZAHLUNG: "Zu dieser Bestellung gibt es keine PayPal-Zahlung.",
  RESERVIERUNG_FEHLT: "PayPal hat für diese Bestellung keine Reservierung gemeldet.",
  RESERVIERUNG_FREIGEGEBEN: "Die Reservierung wurde aufgehoben – es kann nichts mehr eingezogen werden. Nicht versenden.",
  ZAHLUNG_GESCHEITERT: "PayPal lässt die Zahlung nicht einziehen. Nicht versenden – Bestellung stornieren oder die Kundin um eine neue Zahlung bitten.",
  ZAHLUNG_NICHT_EINGEZOGEN: "PayPal hat das Einziehen gerade nicht bestätigt. Bitte gleich noch einmal versuchen – erst versenden, wenn das Geld eingezogen ist.",
  ZAHLUNG_WIRD_GEPRUEFT: "PayPal prüft die Zahlung noch. Erst versenden, wenn sie eingegangen ist – der Shop fragt selbst nach.",
  ZAHLUNG_FAILED: "Die Zahlung ist gescheitert. Nicht versenden – Bestellung stornieren.",
  ZAHLUNG_CANCELLED: "Die Zahlung wurde abgebrochen oder freigegeben. Nicht versenden.",
  ZAHLUNG_CREATED: "Die Kundin hat noch nicht bezahlt.",
  ZAHLUNG_PENDING: "Die Zahlung wird gerade bestätigt – bitte kurz warten.",
  AUTHORIZATION_EXPIRED: "Die PayPal-Reservierung ist abgelaufen.",
  AUTHORIZATION_VOIDED: "Die PayPal-Reservierung wurde aufgehoben.",
  PREVIOUSLY_VOIDED: "Die PayPal-Reservierung wurde aufgehoben.",
  CAPTURE_DECLINED: "PayPal hat das Einziehen abgelehnt.",
  CAPTURE_FAILED: "PayPal hat das Einziehen abgelehnt.",
  PAYER_CANNOT_PAY: "PayPal lässt die Zahlung der Kundin nicht zu.",
  PAYER_ACCOUNT_LOCKED_OR_CLOSED: "Das PayPal-Konto der Kundin ist gesperrt oder geschlossen.",
  PAYER_ACCOUNT_RESTRICTED: "Das PayPal-Konto der Kundin ist eingeschränkt.",
  TRANSACTION_REFUSED: "PayPal hat die Zahlung abgelehnt.",
  INSTRUMENT_DECLINED: "Die Zahlungsquelle der Kundin wurde abgelehnt.",
  PAYEE_ACCOUNT_RESTRICTED: "Dein PayPal-Konto ist eingeschränkt – bitte in PayPal prüfen.",
  PAYEE_ACCOUNT_LOCKED_OR_CLOSED: "Dein PayPal-Konto ist gesperrt – bitte in PayPal prüfen.",
  PERMISSION_DENIED: "PayPal verweigert das Einziehen für diese App (fehlende Berechtigung).",
  NOT_AUTHORIZED: "PayPal verweigert das Einziehen für diese App (fehlende Berechtigung).",
  PAYPAL_NOT_CONFIGURED: "PayPal ist am Server nicht eingerichtet.",
  PAYPAL_ANMELDUNG_FEHLGESCHLAGEN: "Anmeldung bei PayPal gescheitert – der Shop versucht es gleich noch einmal.",
  NETZFEHLER: "PayPal war nicht erreichbar – der Shop versucht es gleich noch einmal (ohne doppelte Abbuchung).",
  CAPTURE_PENDING: "PayPal prüft die Zahlung noch.",
  BETRAG_ABWEICHUNG: "PayPal hat einen anderen Betrag eingezogen als bestellt – bitte in PayPal prüfen.",
});

export function zahlungFehlerText(code) {
  const text = safeText(code || "", 120);
  if (!text) return null;
  return FEHLER_TEXT[text] || FEHLER_TEXT[text.split(":")[0]] || `PayPal meldet: ${text}`;
}

function requireDb(env) {
  if (!env?.DB) throw new ZahlungFehler("COMMERCE_DATABASE_NOT_CONFIGURED", 503);
  return env.DB;
}

function iso(now) {
  return (now instanceof Date ? now : new Date()).toISOString();
}

function log(level, event, reqId, felder = {}) {
  const payload = JSON.stringify({ level, event, requestId: safeText(reqId, 120), ...felder });
  if (level === "error") console.error(payload);
  else console.warn(payload);
}

async function protokoll(db, orderId, eventType, reqId, metadata, actor = "PAYMENT_PROVIDER") {
  await db.prepare(`INSERT INTO audit_events (id,actor_type,entity_type,entity_id,event_type,request_id,metadata_json,created_at)
    VALUES (?,?,'order',?,?,?,?,?)`)
    .bind(crypto.randomUUID(), actor, String(orderId), eventType, safeText(reqId, 120), JSON.stringify(metadata || {}), new Date().toISOString())
    .run();
}

// ------------------------------------------------------------- Lesen

// Die juengste PayPal-Zahlung der Bestellung, egal in welchem Stand.
export async function zahlungDerBestellung(db, orderId) {
  return db.prepare(`SELECT p.*,o.order_number,o.status AS order_status,o.total_cents
    FROM payments p JOIN commerce_orders o ON o.id=p.order_id
    WHERE p.order_id=? AND p.provider='PAYPAL' ORDER BY p.created_at DESC LIMIT 1`).bind(String(orderId)).first();
}

// Eine nur reservierte, noch nicht eingezogene Zahlung - oder null.
export async function reservierteZahlung(db, orderId) {
  return db.prepare(`SELECT * FROM payments WHERE order_id=? AND provider='PAYPAL' AND status='AUTHORIZED'
    AND authorization_id IS NOT NULL ORDER BY created_at DESC LIMIT 1`).bind(String(orderId)).first();
}

// Die Reservierung aus einer PayPal-Bestellung (Antwort von /authorize oder
// GET /v2/checkout/orders/<id>).
export function autorisierungAus(providerOrder) {
  return providerOrder?.purchase_units?.[0]?.payments?.authorizations?.[0] || null;
}

export function einzugAus(providerOrder) {
  return providerOrder?.purchase_units?.[0]?.payments?.captures?.[0] || null;
}

// Felder fuer die Zahlungszeile, sobald PayPal reserviert hat.
export function reservierungFelder(authorization, now = new Date()) {
  const jetzt = iso(now);
  const erstellt = Date.parse(authorization?.create_time || "");
  const basis = Number.isFinite(erstellt) ? erstellt : now.getTime();
  const ablauf = Date.parse(authorization?.expiration_time || "");
  return {
    authorizationId: safeText(authorization?.id, 64),
    authorizedAt: jetzt,
    captureDueAt: new Date(basis + EINZUG_SPAETESTENS_MS).toISOString(),
    expiresAt: new Date(Number.isFinite(ablauf) ? ablauf : basis + RESERVIERUNG_GUELTIG_MS).toISOString(),
  };
}

// Was die Admin-App ueber die Zahlung zeigt.
export function zahlungView(zahlung, now = new Date()) {
  if (!zahlung) return null;
  const status = String(zahlung.status || "");
  const reserviert = status === "AUTHORIZED";
  const faellig = zahlung.capture_due_at || null;
  return {
    status,
    reserviert,
    eingezogen: EINGEZOGEN.includes(status),
    freigegeben: status === "CANCELLED" && Boolean(zahlung.voided_at),
    gescheitert: status === "FAILED",
    mitReservierung: Boolean(zahlung.authorization_id),
    betragCents: Number(zahlung.amount_cents || 0),
    reserviertAm: zahlung.authorized_at || null,
    einziehenSpaetestens: reserviert ? faellig : null,
    reservierungGueltigBis: reserviert ? zahlung.authorization_expires_at || null : null,
    wirdGeprueft: reserviert && Boolean(zahlung.provider_payment_id),
    ueberfaellig: reserviert && Boolean(faellig) && Date.parse(faellig) < now.getTime(),
    versuche: Number(zahlung.capture_attempts || 0),
    letzterVersuchAm: zahlung.capture_last_attempt_at || null,
    fehler: zahlung.capture_error || null,
    fehlerText: zahlung.capture_error ? zahlungFehlerText(zahlung.capture_error) : null,
    freigegebenAm: zahlung.voided_at || null,
    captureId: EINGEZOGEN.includes(status) ? zahlung.provider_payment_id || null : null,
    einziehenMoeglich: reserviert && !zahlung.provider_payment_id,
  };
}

// ------------------------------------------------------------ PayPal

const SCHON_EINGEZOGEN = new Set(["AUTHORIZATION_ALREADY_CAPTURED", "PREVIOUSLY_CAPTURED", "MAX_CAPTURE_COUNT_EXCEEDED"]);
const SCHON_FREIGEGEBEN = new Set(["AUTHORIZATION_VOIDED", "PREVIOUSLY_VOIDED", "AUTHORIZATION_ALREADY_VOIDED"]);
const ABGELEHNT = new Set([
  "AUTHORIZATION_EXPIRED", "AUTHORIZATION_DENIED", "PAYER_CANNOT_PAY", "PAYER_ACCOUNT_LOCKED_OR_CLOSED",
  "PAYER_ACCOUNT_RESTRICTED", "TRANSACTION_REFUSED", "INSTRUMENT_DECLINED",
]);

// Wie bei den Erstattungen (erstattung.js): VORLAEUFIG heisst, derselbe
// Schluessel holt beim naechsten Versuch die echte Antwort - nie doppelt.
export function einzugFehlerArt(httpStatus, grund) {
  if (SCHON_EINGEZOGEN.has(grund)) return "SCHON_EINGEZOGEN";
  if (SCHON_FREIGEGEBEN.has(grund)) return "FREIGEGEBEN";
  if (ABGELEHNT.has(grund)) return "ABGELEHNT";
  const status = Number(httpStatus) || 0;
  if (!status || status >= 500 || [408, 409, 429].includes(status)) return "VORLAEUFIG";
  return "ENDGUELTIG";
}

async function paypalAufruf(env, pfad, { method = "POST", body, requestId } = {}) {
  let token;
  try {
    token = await paypalToken(env);
  } catch (err) {
    const grund = safeText(err?.code || "PAYPAL_ANMELDUNG_FEHLGESCHLAGEN", 80);
    return { ok: false, httpStatus: 0, grund, art: grund === "PAYPAL_NOT_CONFIGURED" ? "ENDGUELTIG" : "VORLAEUFIG", debugId: null };
  }
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };
  if (method !== "GET") {
    headers["Content-Type"] = "application/json";
    headers.Prefer = "return=representation";
  }
  if (requestId) headers["PayPal-Request-Id"] = requestId;
  let res;
  try {
    res = await fetch(`${paypalApiBase(env)}${pfad}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    return { ok: false, httpStatus: 0, grund: "NETZFEHLER", art: "VORLAEUFIG", debugId: null };
  }
  const daten = res.status === 204 ? {} : await res.json().catch(() => ({}));
  const debugId = safeText(daten?.debug_id || res.headers?.get?.("paypal-debug-id") || "", 120) || null;
  if (!res.ok) {
    const grund = safeText(daten?.details?.[0]?.issue || daten?.name || `HTTP_${res.status}`, 80);
    return { ok: false, httpStatus: res.status, grund, art: einzugFehlerArt(res.status, grund), debugId };
  }
  return { ok: true, httpStatus: res.status, daten, debugId };
}

async function paypalBestellungLesen(env, providerOrderId) {
  if (!providerOrderId) return null;
  const antwort = await paypalAufruf(env, `/v2/checkout/orders/${encodeURIComponent(providerOrderId)}`, { method: "GET" });
  return antwort.ok ? antwort.daten : null;
}

// ------------------------------------------------------- Inhaber melden

// Je Zahlung und Lage genau eine Nachricht (der Anspruch steht im Protokoll).
async function inhaberMelden(env, zahlung, art, grund, reqId) {
  const db = env.DB;
  const claimId = `notify:telegram:einzug:${zahlung.id}:${safeText(art, 20)}:${safeText(grund || "", 60)}`;
  try {
    const claim = await db.prepare(`INSERT OR IGNORE INTO audit_events
      (id,actor_type,entity_type,entity_id,event_type,request_id,metadata_json,created_at)
      VALUES (?,'SYSTEM','order',?,'PAYMENT_OWNER_NOTICE',?,?,?)`)
      .bind(claimId, String(zahlung.order_id), safeText(reqId, 120), JSON.stringify({ art, grund }), new Date().toISOString()).run();
    if (!claim.meta?.changes) return;
  } catch {
    return;
  }
  const nummer = zahlung.order_number || String(zahlung.order_id);
  const betrag = euroAmount(zahlung.amount_cents);
  const zeilen = art === "gescheitert"
    ? [
      "DISORDER119 — NICHT VERSENDEN",
      `Bestellung ${nummer} · ${betrag}`,
      `PayPal lässt die Zahlung nicht einziehen: ${zahlungFehlerText(grund)}`,
      "Es ist kein Geld eingegangen. Bitte nicht versenden – in der Admin-App stornieren oder die Kundin um eine neue Zahlung bitten.",
    ]
    : art === "geprueft"
      ? [
        "DISORDER119 — ZAHLUNG WIRD GEPRÜFT",
        `Bestellung ${nummer} · ${betrag}`,
        "PayPal hat das Einziehen angenommen, prüft die Zahlung aber noch. Bitte erst versenden, wenn sie eingegangen ist – der Shop fragt selbst nach.",
      ]
      : [
        "DISORDER119 — EINZIEHEN KLAPPT NICHT",
        `Bestellung ${nummer} · ${betrag}`,
        zahlungFehlerText(grund) || "PayPal hat das Einziehen nicht bestätigt.",
        "Der Shop versucht es automatisch weiter. Bitte erst versenden, wenn das Geld eingezogen ist (Admin-App → Bestellung → „Jetzt einziehen“).",
      ];
  try {
    await sendTelegramMessage(env, zeilen.join("\n"), reqId);
  } catch (err) {
    log("warn", "payment_owner_notice_failed", reqId, { orderId: String(zahlung.order_id), message: safeText(err?.message, 120) });
  }
}

// --------------------------------------------------------------- Einziehen

// Rechnung nach dem Einziehen - blockiert nie, der Cron holt sie nach.
async function rechnungNachEinzug(env, orderId, reqId) {
  try {
    return await sendInvoiceAfterCapture(env, orderId, reqId);
  } catch (err) {
    log("error", "invoice_after_capture_failed", reqId, { orderId: String(orderId), message: safeText(err?.message, 160) });
    return { sent: false, reason: "FEHLER" };
  }
}

// PayPals Capture in die eigene Zahlung uebernehmen.
async function einzugUebernehmen(env, zahlung, capture, reqId, { anlass, now }) {
  const db = env.DB;
  const jetzt = iso(now);
  const status = String(capture?.status || "").toUpperCase();
  const captureId = safeText(capture?.id, 64);
  if (!captureId) {
    await db.prepare("UPDATE payments SET capture_error=?,updated_at=? WHERE id=?").bind("CAPTURE_ANTWORT_UNVOLLSTAENDIG", jetzt, zahlung.id).run();
    return { ok: false, code: "ZAHLUNG_NICHT_EINGEZOGEN", grund: "CAPTURE_ANTWORT_UNVOLLSTAENDIG", vorlaeufig: true };
  }
  const cents = decimalCents(capture?.amount?.value);
  if (status === "COMPLETED") {
    const evidence = await captureStatements(db, { id: zahlung.id, commerce_order_id: zahlung.order_id }, capture, jetzt);
    const ergebnis = await db.batch([
      ...evidence,
      db.prepare(`UPDATE payments SET status='COMPLETED',provider_payment_id=?,capture_error=NULL,updated_at=?
        WHERE id=? AND status IN ('AUTHORIZED','FAILED')`).bind(captureId, jetzt, zahlung.id),
    ]);
    if (ergebnis[evidence.length]?.meta?.changes) {
      await protokoll(db, zahlung.order_id, "PAYMENT_CAPTURED", reqId, {
        anlass, captureId, betragCents: cents, reserviertCents: Number(zahlung.amount_cents),
      });
      if (cents !== Number(zahlung.amount_cents) || capture?.amount?.currency_code !== "EUR") {
        log("error", "capture_amount_mismatch", reqId, { orderId: String(zahlung.order_id), cents, erwartet: Number(zahlung.amount_cents) });
        await inhaberMelden(env, zahlung, "fehler", "BETRAG_ABWEICHUNG", reqId);
      }
      await rechnungNachEinzug(env, zahlung.order_id, reqId);
    }
    return { ok: true, captureId, betragCents: cents };
  }
  if (status === "PENDING") {
    const grund = `CAPTURE_PENDING${capture?.status_details?.reason ? `:${safeText(capture.status_details.reason, 60)}` : ""}`;
    await db.prepare(`UPDATE payments SET provider_payment_id=COALESCE(provider_payment_id,?),capture_error=?,updated_at=?
      WHERE id=? AND status='AUTHORIZED'`).bind(captureId, grund, jetzt, zahlung.id).run();
    await protokoll(db, zahlung.order_id, "PAYMENT_CAPTURE_PENDING", reqId, { anlass, captureId, grund });
    await inhaberMelden(env, zahlung, "geprueft", "CAPTURE_PENDING", reqId);
    return { ok: false, code: "ZAHLUNG_WIRD_GEPRUEFT", grund, vorlaeufig: true, captureId };
  }
  // DECLINED, FAILED: es ist kein Geld geflossen, und es kommt auch keins.
  const grund = `CAPTURE_${status || "UNBEKANNT"}`;
  await db.prepare(`UPDATE payments SET status='FAILED',capture_error=?,updated_at=? WHERE id=? AND status='AUTHORIZED'`)
    .bind(grund, jetzt, zahlung.id).run();
  await protokoll(db, zahlung.order_id, "PAYMENT_CAPTURE_FAILED", reqId, { anlass, captureId, grund, endgueltig: true });
  await inhaberMelden(env, zahlung, "gescheitert", grund, reqId);
  return { ok: false, code: "ZAHLUNG_GESCHEITERT", grund, endgueltig: true };
}

async function einzugGescheitert(env, zahlung, antwort, reqId, { anlass, now }) {
  const db = env.DB;
  const jetzt = iso(now);
  const grund = antwort.grund || "UNBEKANNT";
  const meta = { anlass, grund, art: antwort.art, paypalStatus: antwort.httpStatus, debugId: antwort.debugId };
  if (antwort.art === "SCHON_EINGEZOGEN") {
    // Eingezogen ist schon (etwa ein Versuch mit unklarem Ausgang): die
    // Capture aus der PayPal-Bestellung uebernehmen.
    const providerOrder = await paypalBestellungLesen(env, zahlung.provider_order_id);
    const capture = einzugAus(providerOrder);
    if (capture) return einzugUebernehmen(env, zahlung, capture, reqId, { anlass, now });
    await db.prepare("UPDATE payments SET capture_error=?,updated_at=? WHERE id=?").bind(grund, jetzt, zahlung.id).run();
    return { ok: false, code: "ZAHLUNG_NICHT_EINGEZOGEN", grund, vorlaeufig: true };
  }
  if (antwort.art === "FREIGEGEBEN") {
    await db.prepare(`UPDATE payments SET status='CANCELLED',voided_at=COALESCE(voided_at,?),capture_error=?,updated_at=?
      WHERE id=? AND status='AUTHORIZED'`).bind(jetzt, grund, jetzt, zahlung.id).run();
    await protokoll(db, zahlung.order_id, "PAYMENT_CAPTURE_FAILED", reqId, { ...meta, endgueltig: true });
    await inhaberMelden(env, zahlung, "gescheitert", grund, reqId);
    return { ok: false, code: "RESERVIERUNG_FREIGEGEBEN", grund, endgueltig: true };
  }
  if (antwort.art === "ABGELEHNT") {
    await db.prepare(`UPDATE payments SET status='FAILED',capture_error=?,updated_at=? WHERE id=? AND status='AUTHORIZED'`)
      .bind(grund, jetzt, zahlung.id).run();
    await protokoll(db, zahlung.order_id, "PAYMENT_CAPTURE_FAILED", reqId, { ...meta, endgueltig: true });
    await inhaberMelden(env, zahlung, "gescheitert", grund, reqId);
    return { ok: false, code: "ZAHLUNG_GESCHEITERT", grund, endgueltig: true };
  }
  // Voruebergehend oder auf Haendlerseite zu klaeren: die Reservierung steht
  // weiter, der Cron versucht es erneut.
  await db.prepare("UPDATE payments SET capture_error=?,updated_at=? WHERE id=?").bind(grund, jetzt, zahlung.id).run();
  await protokoll(db, zahlung.order_id, "PAYMENT_CAPTURE_FAILED", reqId, meta);
  log("warn", "payment_capture_failed", reqId, { orderId: String(zahlung.order_id), ...meta });
  if (antwort.art !== "VORLAEUFIG" || Number(zahlung.capture_attempts || 0) + 1 >= 3) {
    await inhaberMelden(env, zahlung, "fehler", grund, reqId);
  }
  return { ok: false, code: "ZAHLUNG_NICHT_EINGEZOGEN", grund, vorlaeufig: antwort.art === "VORLAEUFIG" };
}

// Eine von PayPal noch gepruefte Abbuchung (PENDING) nachfragen.
async function einzugPruefen(env, zahlung, reqId, { anlass, now }) {
  const antwort = await paypalAufruf(env, `/v2/payments/captures/${encodeURIComponent(zahlung.provider_payment_id)}`, { method: "GET" });
  if (!antwort.ok) return { ok: false, code: "ZAHLUNG_WIRD_GEPRUEFT", grund: antwort.grund, vorlaeufig: true };
  const status = String(antwort.daten?.status || "").toUpperCase();
  if (status === "PENDING") {
    await env.DB.prepare("UPDATE payments SET capture_last_attempt_at=?,updated_at=? WHERE id=?").bind(iso(now), iso(now), zahlung.id).run();
    return { ok: false, code: "ZAHLUNG_WIRD_GEPRUEFT", grund: zahlung.capture_error || "CAPTURE_PENDING", vorlaeufig: true };
  }
  return einzugUebernehmen(env, zahlung, antwort.daten, reqId, { anlass, now });
}

// Zieht eine reservierte Zahlung ein. Wirft nie wegen PayPal, sondern meldet
// { ok, code, grund, vorlaeufig, endgueltig } - der Aufrufer entscheidet.
//   anlass: VERSAND (Etikett), VERSENDET (Status), FAELLIG (Cron), ADMIN.
export async function zahlungEinziehen(env, orderId, reqId = crypto.randomUUID(), { anlass = "VERSAND", now = new Date() } = {}) {
  const db = requireDb(env);
  const zahlung = await zahlungDerBestellung(db, orderId);
  if (!zahlung) return { ok: false, code: "KEINE_ZAHLUNG", endgueltig: true };
  if (EINGEZOGEN.includes(zahlung.status)) return { ok: true, schon: true, captureId: zahlung.provider_payment_id || null };
  if (zahlung.status === "CANCELLED" && zahlung.voided_at) return { ok: false, code: "RESERVIERUNG_FREIGEGEBEN", endgueltig: true };
  if (zahlung.status !== "AUTHORIZED") return { ok: false, code: `ZAHLUNG_${zahlung.status}`, endgueltig: zahlung.status !== "PENDING" };
  if (!zahlung.authorization_id) return { ok: false, code: "RESERVIERUNG_FEHLT", endgueltig: true };
  if (zahlung.provider_payment_id) return einzugPruefen(env, zahlung, reqId, { anlass, now });

  const jetzt = iso(now);
  await db.prepare(`UPDATE payments SET capture_attempts=capture_attempts+1,capture_last_attempt_at=?,updated_at=?
    WHERE id=? AND status='AUTHORIZED'`).bind(jetzt, jetzt, zahlung.id).run();
  // Voll einziehen (ohne Betrag = der reservierte Betrag) und die
  // Reservierung damit abschliessen. Die Request-Id gehoert zur Zahlung:
  // Wiederholungen nach einem Timeout ziehen nie ein zweites Mal ein.
  const antwort = await paypalAufruf(env, `/v2/payments/authorizations/${encodeURIComponent(zahlung.authorization_id)}/capture`, {
    requestId: `einzug:${zahlung.id}`,
    body: {
      final_capture: true,
      note_to_payer: safeText(`Bestellung ${zahlung.order_number || ""} – DISORDER119`, 255),
    },
  });
  if (antwort.ok) return einzugUebernehmen(env, zahlung, antwort.daten, reqId, { anlass, now });
  return einzugGescheitert(env, zahlung, antwort, reqId, { anlass, now });
}

// Vor jedem Versandschritt: Geld muss eingezogen sein, sonst geht nichts raus.
export async function zahlungSicherstellen(env, orderId, reqId = crypto.randomUUID(), { anlass = "VERSAND", now = new Date() } = {}) {
  const ergebnis = await zahlungEinziehen(env, orderId, reqId, { anlass, now });
  if (ergebnis.ok) return ergebnis;
  const code = ["RESERVIERUNG_FREIGEGEBEN", "ZAHLUNG_WIRD_GEPRUEFT", "ZAHLUNG_NICHT_EINGEZOGEN", "KEINE_ZAHLUNG", "RESERVIERUNG_FEHLT"].includes(ergebnis.code)
    ? ergebnis.code
    : ergebnis.endgueltig ? "ZAHLUNG_GESCHEITERT" : "ZAHLUNG_NICHT_EINGEZOGEN";
  const grundText = ergebnis.grund && !["ZAHLUNG_NICHT_EINGEZOGEN", "ZAHLUNG_GESCHEITERT"].includes(ergebnis.grund)
    ? ` (${zahlungFehlerText(ergebnis.grund)})`
    : "";
  throw new ZahlungFehler(code, 409, `${zahlungFehlerText(code)}${grundText}`);
}

// --------------------------------------------------------------- Freigeben

// Hebt die Reservierung auf (Storno vor dem Versand): kein Geld, keine Gebuehr.
//   { ok: true }                          freigegeben (oder war es schon)
//   { ok: false, art: "SCHON_EINGEZOGEN" } Geld ist schon eingezogen -> erstatten
//   { ok: false, art: "VORLAEUFIG" }      unklar, spaeter erneut
//   { ok: false, art: "ENDGUELTIG" }      PayPal lehnt ab, der Inhaber muss ran
export async function reservierungFreigeben(env, orderId, reqId = crypto.randomUUID(), { now = new Date() } = {}) {
  const db = requireDb(env);
  const jetzt = iso(now);
  const zahlung = await zahlungDerBestellung(db, orderId);
  if (!zahlung) return { ok: false, art: "ENDGUELTIG", code: "KEINE_ZAHLUNG" };
  if (zahlung.status === "CANCELLED" && zahlung.voided_at) return { ok: true, schon: true };
  if (EINGEZOGEN.includes(zahlung.status)) return { ok: false, art: "SCHON_EINGEZOGEN", code: "ZAHLUNG_SCHON_EINGEZOGEN" };
  // FAILED: Einziehen ist endgueltig gescheitert (abgelaufen, abgelehnt).
  // Trotzdem bei PayPal freigeben, damit bei der Kundin nichts vorgemerkt
  // bleibt - lehnt PayPal das ab, ist ohnehin nichts mehr reserviert.
  const gescheitert = zahlung.status === "FAILED";
  if ((zahlung.status !== "AUTHORIZED" && !gescheitert) || !zahlung.authorization_id) {
    return { ok: false, art: "ENDGUELTIG", code: `ZAHLUNG_${zahlung.status}` };
  }
  // PayPal prueft eine schon angenommene Abbuchung: freigeben geht nicht mehr,
  // erst deren Ausgang abwarten (dann erstatten oder es ist nichts geflossen).
  if (!gescheitert && zahlung.provider_payment_id) {
    const stand = await einzugPruefen(env, zahlung, reqId, { anlass: "FREIGABE", now });
    if (stand.ok) return { ok: false, art: "SCHON_EINGEZOGEN", code: "ZAHLUNG_SCHON_EINGEZOGEN" };
    if (stand.endgueltig) return reservierungFreigeben(env, orderId, reqId, { now });
    return { ok: false, art: "VORLAEUFIG", code: "ZAHLUNG_WIRD_GEPRUEFT" };
  }

  const antwort = await paypalAufruf(env, `/v2/payments/authorizations/${encodeURIComponent(zahlung.authorization_id)}/void`, {
    requestId: `freigabe:${zahlung.id}`,
  });
  const schonFrei = !antwort.ok && (antwort.art === "FREIGEGEBEN" || antwort.grund === "AUTHORIZATION_EXPIRED"
    || (gescheitert && antwort.art !== "VORLAEUFIG" && antwort.art !== "SCHON_EINGEZOGEN"));
  if (antwort.ok || schonFrei) {
    await db.prepare(`UPDATE payments SET status='CANCELLED',voided_at=COALESCE(voided_at,?),capture_error=NULL,updated_at=?
      WHERE id=? AND status IN ('AUTHORIZED','FAILED')`).bind(jetzt, jetzt, zahlung.id).run();
    await protokoll(db, zahlung.order_id, "PAYMENT_VOIDED", reqId, {
      authorizationId: zahlung.authorization_id, betragCents: Number(zahlung.amount_cents), grund: schonFrei ? antwort.grund : null,
    });
    return { ok: true };
  }
  await protokoll(db, zahlung.order_id, "PAYMENT_VOID_FAILED", reqId, {
    grund: antwort.grund, art: antwort.art, paypalStatus: antwort.httpStatus, debugId: antwort.debugId,
  });
  if (antwort.art === "SCHON_EINGEZOGEN") {
    // Wettlauf mit dem Einziehen (Etikett, Cron): die Capture verbuchen, dann
    // geht der Storno ueber die Erstattung.
    const providerOrder = await paypalBestellungLesen(env, zahlung.provider_order_id);
    const capture = einzugAus(providerOrder);
    if (capture) await einzugUebernehmen(env, zahlung, capture, reqId, { anlass: "ABGLEICH", now });
    return { ok: false, art: "SCHON_EINGEZOGEN", code: "ZAHLUNG_SCHON_EINGEZOGEN" };
  }
  return { ok: false, art: antwort.art === "ABGELEHNT" ? "ENDGUELTIG" : antwort.art, code: antwort.grund, httpStatus: antwort.httpStatus, debugId: antwort.debugId };
}

// Eine Reservierung ohne gueltige Bestellung (sollte nie vorkommen) sofort
// wieder freigeben, damit bei der Kundin nichts vorgemerkt bleibt.
export async function autorisierungVerwerfen(env, authorizationId, requestId) {
  const id = safeText(authorizationId, 64);
  if (!id) return { ok: false, grund: "RESERVIERUNG_FEHLT" };
  const antwort = await paypalAufruf(env, `/v2/payments/authorizations/${encodeURIComponent(id)}/void`, { requestId });
  return antwort.ok || antwort.art === "FREIGEGEBEN" ? { ok: true } : { ok: false, grund: antwort.grund };
}

// ------------------------------------------------------------------- Cron

function wiederFaellig(row, now) {
  if (!row.capture_last_attempt_at) return true;
  const n = Number(row.capture_attempts) || 0;
  const minuten = row.provider_payment_id ? 30 : n <= 4 ? 15 : n <= 12 ? 60 : 180;
  return now.getTime() - Date.parse(row.capture_last_attempt_at) >= (minuten - 1) * 60 * 1000;
}

// Faellige Reservierungen einziehen: spaetestens am Ende der Garantiezeit,
// sofort, wenn die Bestellung schon unterwegs ist (Sendungsverfolgung), und
// Abbuchungen nachfragen, die PayPal noch prueft. Laeuft fuer eine Bestellung
// ein Storno oder Widerruf vor dem Versand, zieht der Cron nicht ein - der
// Erstattungsauftrag gibt die Reservierung frei.
//   deps.sperre(orderId) -> { code } | null   (erstattung-auftrag.js versandSperre)
export async function faelligeZahlungenEinziehen(env, reqId = crypto.randomUUID(), now = new Date(), deps = {}) {
  const db = env?.DB;
  const ergebnis = { ok: true, eingezogen: 0, offen: 0, gesperrt: 0, rechnungen: 0, fehler: [] };
  if (!db) return { ...ergebnis, ok: false };
  const jetzt = iso(now);
  let rows;
  try {
    rows = (await db.prepare(`SELECT p.id,p.order_id,p.capture_due_at,p.capture_attempts,p.capture_last_attempt_at,
        p.provider_payment_id,o.status AS order_status
      FROM payments p JOIN commerce_orders o ON o.id=p.order_id
      WHERE p.provider='PAYPAL' AND p.status='AUTHORIZED' AND p.authorization_id IS NOT NULL
        AND (p.capture_due_at<=? OR p.provider_payment_id IS NOT NULL
          OR o.status IN ('SHIPPED','DELIVERED','RETURN_REQUESTED','RETURNED'))
      ORDER BY p.capture_due_at LIMIT 30`).bind(jetzt).all()).results || [];
  } catch (err) {
    if (/no such column|no such table/i.test(String(err?.message || ""))) return { ...ergebnis, ok: false, code: "SCHEMA_FEHLT" };
    throw err;
  }
  let budget = EINZUEGE_JE_LAUF;
  for (const row of rows) {
    if (budget <= 0) break;
    if (!wiederFaellig(row, now)) continue;
    try {
      if (["PAID", "PREPARING"].includes(String(row.order_status)) && typeof deps.sperre === "function" && await deps.sperre(row.order_id)) {
        ergebnis.gesperrt += 1;
        continue;
      }
      budget -= 1;
      const lauf = await zahlungEinziehen(env, row.order_id, reqId, { anlass: "FAELLIG", now });
      if (lauf.ok) ergebnis.eingezogen += 1;
      else ergebnis.offen += 1;
    } catch (err) {
      ergebnis.fehler.push(safeText(err?.code || err?.message || "EINZUG_FEHLER", 80));
      log("error", "payment_capture_cron_failed", reqId, { orderId: String(row.order_id), code: safeText(err?.code || err?.message, 120) });
    }
  }

  // Rechnungen, deren Mail nach dem Einziehen gescheitert ist, nachholen.
  const seit = new Date(now.getTime() - RECHNUNG_NACHHOLEN_TAGE * 24 * STUNDE_MS).toISOString();
  const ohneRechnung = (await db.prepare(`SELECT p.order_id FROM payments p
      WHERE p.provider='PAYPAL' AND p.authorization_id IS NOT NULL AND p.status IN ('COMPLETED','PARTIALLY_REFUNDED','REFUNDED')
        AND p.updated_at>=?
        AND NOT EXISTS (SELECT 1 FROM audit_events a WHERE a.id='notify:email:invoice:' || p.order_id)
      ORDER BY p.updated_at LIMIT ${RECHNUNGEN_JE_LAUF}`).bind(seit).all()).results || [];
  for (const row of ohneRechnung) {
    const mail = await rechnungNachEinzug(env, row.order_id, reqId);
    if (mail?.sent) ergebnis.rechnungen += 1;
  }
  ergebnis.ok = ergebnis.fehler.length === 0;
  return ergebnis;
}

// Packlink PRO - Versandlabels von DPD und DHL ueber ein Konto, ohne
// Grundgebuehr.
//
// Ablauf je Auftrag (Admin-App, Bestellung -> Versand):
//   1. Die Kundschaft hat im Checkout Standard oder Express gewaehlt
//      (versand.js, Tabelle order_versand). Die Admin-App schlaegt genau diese
//      Leistung und Paketgroesse vor und zeigt nur die Paketdienste, die auch
//      die Kasse anbietet (config/shop-config.json -> versand.dienste).
//   2. "Etikett kaufen" -> der Server bucht die Sendung direkt ueber
//      POST /v1/orders. Packlink rechnet sie ueber die in Packlink PRO
//      hinterlegte Zahlungsart ab (Sammelrechnung alle 15 Tage), das Etikett
//      entsteht von allein.
//   3. Ohne hinterlegte Zahlungsart lehnt Packlink den Kauf ab. Dann bleibt der
//      Entwurf: POST /v1/shipments legt ihn an, bezahlt wird in Packlink PRO
//      per Direktlink - so arbeiten auch Packlinks eigene Shop-Plugins.
//   4. Danach meldet Packlink jeden Schritt an /packlink/webhook/<Schluessel>.
//      Der Server holt dann Status, Sendungsnummer und Etikett selbst ab
//      (dem Inhalt der Meldung wird nie geglaubt) und fuehrt die Bestellung
//      weiter: Etikett da -> "Wird gepackt", Paket beim Paketdienst ->
//      "Versendet" mit Versandmail, zugestellt -> "Zugestellt". Dasselbe
//      passiert, wenn du in der Admin-App "Status holen" drueckst.
//
// Schnittstelle wie in Packlinks offenem Plugin-Kern (packlink-dev/
// ecommerce_module_core, src/BusinessLogic/Http/Proxy.php): Basis
// https://api.packlink.com/v1/, Header "Authorization: <API-Schluessel>".
// Angebote liefert Packlink auch ohne Schluessel; Kauf, Entwurf, Status und
// Etikett brauchen das Secret PACKLINK_API_KEY aus Packlink PRO (Einstellungen).
//
// Datenschutz: An Packlink gehen nur Name und Lieferadresse, keine E-Mail-
// Adresse oder Telefonnummer der Kundin - dafuer braeuchte es eine Einwilligung.
import { safeText } from "./commerce-core.js";
import { orderStatusAutomatisch } from "./admin-api.js";
import { versandSperre } from "./erstattung-auftrag.js";
import { ZahlungFehler, zahlungSicherstellen } from "./zahlung.js";
import { PAKETE, dienstErlaubt, paketFuer } from "./versand-config.js";

export { PAKETE };

const API = "https://api.packlink.com/v1";
const PRO_SHIPMENTS = "https://pro.packlink.de/private/shipments/";
// Sperrzeile waehrend eines Kaufs: Platzhalter statt Packlink-Referenz.
const KAUF_PRAEFIX = "kauf-";
// Zeilen, die einem neuen Kauf oder Entwurf nicht im Weg stehen.
const RUHEND = "'ERSETZT','KAUF_ABGELEHNT','CANCELED','CANCELLED'";
const ADMIN_ORIGINS = Object.freeze([
  "https://admin.disorder119.com",
  "http://localhost:8765",
  "http://127.0.0.1:8765",
]);

// Paketgroessen (Masse, Gewicht, Ersatzpreis) stehen einmal in
// config/shop-config.json, siehe versand-config.js. Im Entwurf in Packlink PRO
// lassen sie sich noch anpassen.
const MAX_ANGEBOTE = 8;

export class PacklinkError extends Error {
  constructor(code, status = 400, detail = "", httpStatus = null) {
    super(code);
    this.code = code;
    this.status = status;
    this.detail = detail;
    // Was Packlink selbst geantwortet hat (null: keine Antwort bekommen).
    this.httpStatus = httpStatus;
  }
}

export function packlinkReady(env = {}) {
  return Boolean(env.PACKLINK_API_KEY);
}

// ------------------------------------------------------------------- Status

// Packlink-Zustaende wie im Plugin-Kern (ShippingMethod/Utility/ShipmentStatus.php),
// zusammengefasst zu dem, was fuer dich zaehlt.
const PHASEN = [
  ["offen", ["AWAITING_COMPLETION", "READY_TO_PURCHASE"]],
  ["bezahlt", ["PURCHASE_SUCCESS", "CARRIER_PENDING", "RETRY", "CARRIER_KO", "LABELS_KO", "INTEGRATION_KO"]],
  ["bereit", ["READY_TO_PRINT", "READY_FOR_COLLECTION", "COMPLETED", "CARRIER_OK"]],
  ["unterwegs", ["IN_TRANSIT", "OUT_FOR_DELIVERY"]],
  ["zugestellt", ["DELIVERED", "RETURNED_TO_SENDER"]],
  ["storniert", ["CANCELED", "CANCELLED"]],
  ["problem", ["INCIDENT"]],
  // Eigene Zustaende beim Direktkauf: "kauf" = Anfrage laeuft (KAUF_LAEUFT)
  // oder blieb ohne klare Antwort (KAUF_UNKLAR) - erst in Packlink PRO
  // nachsehen, nie blind zweimal kaufen. "abgelehnt" = Packlink hat eindeutig
  // nein gesagt, nichts gekauft.
  ["kauf", ["KAUF_LAEUFT", "KAUF_UNKLAR"]],
  ["abgelehnt", ["KAUF_ABGELEHNT"]],
];

export function phase(state) {
  const s = String(state || "").toUpperCase();
  for (const [name, states] of PHASEN) if (states.includes(s)) return name;
  return "offen";
}

// Packlink-Zustand -> Status der Sendung in shipments (CHECK der Tabelle:
// PENDING, LABEL_CREATED, SHIPPED, IN_TRANSIT, DELIVERED, EXCEPTION, RETURNED).
// null = nichts aendern (Entwurf offen, storniert).
export function sendungsStatusIntern(state) {
  const s = String(state || "").toUpperCase();
  if (s === "RETURNED_TO_SENDER") return "RETURNED";
  if (s === "INCIDENT" || ["CARRIER_KO", "LABELS_KO", "INTEGRATION_KO"].includes(s)) return "EXCEPTION";
  const ph = phase(s);
  if (ph === "bezahlt") return "PENDING";
  if (ph === "bereit") return "LABEL_CREATED";
  if (ph === "unterwegs") return "IN_TRANSIT";
  if (ph === "zugestellt") return "DELIVERED";
  return null;
}

// Welchen Bestellstatus der Packlink-Zustand erreichen soll. Die Schritte
// dazwischen laufen einzeln ueber die normale Statuspruefung der Admin-App.
export function bestellZiel(state) {
  const s = String(state || "").toUpperCase();
  if (s === "DELIVERED") return "DELIVERED";
  if (phase(s) === "unterwegs") return "SHIPPED";
  return null;
}

// ------------------------------------------------------------------- Adressen

function text(value, max) {
  return safeText(value, max).replace(/\s+/g, " ");
}

export function landCode(value) {
  const code = String(value || "DE").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : "DE";
}

// "Maria Müller" -> Vorname "Maria", Nachname "Müller". Packlink will beides
// getrennt; bei nur einem Wort steht es im Nachnamen.
export function nameTeile(contact = {}) {
  const vor = text(contact.given_name, 60);
  const nach = text(contact.surname, 60);
  if (vor || nach) return { name: vor, surname: nach || vor };
  const voll = text(contact.recipient_name, 120);
  const teile = voll.split(" ");
  if (teile.length < 2) return { name: "", surname: voll };
  return { name: teile.slice(0, -1).join(" "), surname: teile[teile.length - 1] };
}

export function absender(env = {}) {
  return {
    name: text(env.PACKLINK_ABSENDER_VORNAME || "Joel", 60),
    surname: text(env.PACKLINK_ABSENDER_NACHNAME || "Bittner", 60),
    company: text(env.PACKLINK_ABSENDER_FIRMA || "Disorder119", 60),
    street1: text(env.PACKLINK_ABSENDER_STRASSE || env.DHL_SHIPPER_STREET || "Nelseestraße 25", 80),
    zip_code: text(env.PACKLINK_ABSENDER_PLZ || env.DHL_SHIPPER_POSTAL || "63739", 10),
    city: text(env.PACKLINK_ABSENDER_ORT || env.DHL_SHIPPER_CITY || "Aschaffenburg", 60),
    country: "DE",
    email: text(env.PACKLINK_ABSENDER_EMAIL || env.MAIL_REPLY_TO || "kontakt@disorder119.com", 120),
    phone: text(env.PACKLINK_ABSENDER_TELEFON || "", 30),
  };
}

export function empfaenger(contact = {}) {
  const { name, surname } = nameTeile(contact);
  return {
    name,
    surname,
    company: "",
    street1: text(contact.address_line1, 80),
    street2: text(contact.address_line2, 80),
    zip_code: text(contact.postal_code, 10),
    city: text(contact.city, 60),
    country: landCode(contact.country_code),
  };
}

export function pruefeEmpfaenger(to) {
  const fehlend = [];
  if (!to.surname) fehlend.push("Name");
  if (!to.street1) fehlend.push("Straße");
  if (!to.zip_code) fehlend.push("PLZ");
  if (!to.city) fehlend.push("Ort");
  if (to.country === "DE" && to.zip_code && !/^\d{5}$/.test(to.zip_code)) fehlend.push("PLZ (5 Ziffern)");
  if (fehlend.length) throw new PacklinkError("ADRESSE_UNVOLLSTAENDIG", 409, fehlend.join(", "));
}

// Nur https-Adressen aus Antworten uebernehmen - sie landen als Link in der App.
export function sichereUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------- Schnittstelle

async function packlink(env, path, { method = "GET", body, auth = true } = {}) {
  if (auth && !packlinkReady(env)) throw new PacklinkError("PACKLINK_NICHT_EINGERICHTET", 503);
  const headers = { Accept: "application/json" };
  if (packlinkReady(env)) headers.Authorization = String(env.PACKLINK_API_KEY);
  if (body) headers["Content-Type"] = "application/json";
  let res;
  try {
    res = await fetch(`${API}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch (err) {
    throw new PacklinkError("PACKLINK_NICHT_ERREICHBAR", 502, text(err?.message || "", 120));
  }
  if (!res.ok) {
    let detail = "";
    try {
      const fehler = await res.json();
      const meldungen = Array.isArray(fehler?.messages) ? fehler.messages.map(m => m?.message).filter(Boolean) : [];
      detail = text(meldungen.join(" ") || fehler?.messages?.message || fehler?.message || "", 240);
    } catch { /* keine lesbare Fehlerantwort */ }
    if (res.status === 401 || res.status === 403) throw new PacklinkError("PACKLINK_ZUGANG_ABGELEHNT", 502, detail, res.status);
    if (res.status === 404) throw new PacklinkError("PACKLINK_SENDUNG_UNBEKANNT", 404, detail, res.status);
    throw new PacklinkError("PACKLINK_FEHLER", 502, detail || `HTTP ${res.status}`, res.status);
  }
  return res;
}

function cents(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
}

// "2 DAYS" -> "2 Tage"
export function laufzeit(value) {
  const m = /(\d+)\s*DAY/i.exec(String(value || ""));
  if (!m) return "";
  return m[1] === "1" ? "1 Tag" : `${m[1]} Tage`;
}

export function angebotAus(service = {}) {
  const brutto = cents(service.price?.total_price) ?? cents(service.base_price);
  return {
    id: Number(service.id),
    carrier: text(service.carrier_name, 40),
    name: text(service.name, 80),
    preisCents: brutto,
    nettoCents: cents(service.price?.base_price) ?? cents(service.base_price),
    abgabe: service.dropoff ? "PAKETSHOP" : "ABHOLUNG",
    laufzeit: laufzeit(service.transit_time),
    express: String(service.category || "").toLowerCase() === "express",
  };
}

// behalten: Packlink-Leistung, die eine Kundin im Checkout schon bezahlt hat -
// sie bleibt buchbar, auch wenn ihr Paketdienst inzwischen nicht mehr
// angeboten wird.
export async function angeboteLaden(env, ziel, paketKey, { behalten = null, nurErlaubteDienste = true } = {}) {
  const paket = paketFuer(paketKey);
  const von = absender(env);
  const query = new URLSearchParams({
    "from[country]": "DE",
    "from[zip]": von.zip_code,
    "to[country]": landCode(ziel.country_code),
    "to[zip]": text(ziel.postal_code, 10),
    "packages[0][height]": String(paket.hoehe),
    "packages[0][width]": String(paket.breite),
    "packages[0][length]": String(paket.laenge),
    "packages[0][weight]": String(paket.gewichtKg),
    source: "PRO",
    platform: "PRO",
    platform_country: "DE",
  });
  if (!query.get("to[zip]")) throw new PacklinkError("ADRESSE_UNVOLLSTAENDIG", 409, "PLZ");
  const liste = await (await packlink(env, `/services?${query}`, { auth: false })).json();
  return {
    paket,
    angebote: (Array.isArray(liste) ? liste : [])
      // Bezahlt ist Zustellung an die Haustuer - keine Abholung im Paketshop
      // durch die Kundin, keine Sondertarife fuer unfoermige Pakete.
      .filter(s => s && !s.delivery_to_parcelshop && !/nicht rechteckig|non.?rectang/i.test(String(s.name || "")))
      .map(angebotAus)
      .filter(a => Number.isInteger(a.id) && a.id > 0 && a.preisCents)
      // Die Kasse folgt der oeffentlichen Allowlist. Im privaten Admin darf
      // der Inhaber dagegen jedes sichere Haustuer-Angebot waehlen; sonst
      // koennte er trotz gueltiger Packlink-Preise kein Etikett kaufen.
      .filter(a => !nurErlaubteDienste || dienstErlaubt(a.carrier) || (behalten !== null && a.id === behalten))
      .sort((a, b) => a.preisCents - b.preisCents)
      .slice(0, MAX_ANGEBOTE),
  };
}

// Ein Etikett kostet echtes Geld. Deshalb werden Service, Paket und Preis
// direkt vor dem Packlink-Aufruf erneut aus Packlinks eigener Angebotsliste
// gelesen. Werte aus dem Browser dienen nur als Auswahl, nie als Wahrheit.
async function angebotFuerBuchung(env, order, body = {}) {
  const serviceId = Number(body.serviceId);
  if (!Number.isInteger(serviceId) || serviceId <= 0) throw new PacklinkError("ANGEBOT_FEHLT", 400);
  const paket = paketFuer(body.paket || order.wahl_paket);
  const frisch = await angeboteLaden(env, order, paket.key, { behalten: serviceId, nurErlaubteDienste: false });
  const angebot = frisch.angebote.find(entry => entry.id === serviceId);
  if (!angebot) throw new PacklinkError("ANGEBOT_NICHT_MEHR_VERFUEGBAR", 409);
  const gesehen = Number(body.preisCents);
  if (Number.isSafeInteger(gesehen) && gesehen > 0 && gesehen !== angebot.preisCents) {
    throw new PacklinkError("ANGEBOT_PREIS_GEAENDERT", 409, `Neuer Preis: ${(angebot.preisCents / 100).toFixed(2)} EUR`);
  }
  return { serviceId, paket, angebot };
}

// --------------------------------------------------------------- Ablauf je Auftrag

function requireDb(env) {
  if (!env?.DB) throw new PacklinkError("DATENBANK_FEHLT", 503);
  return env.DB;
}

async function loadOrder(env, orderId, erlaubt = ["PAID", "PREPARING"]) {
  const order = await requireDb(env).prepare(`SELECT o.id,o.order_number,o.status,o.subtotal_cents,o.total_cents,
      c.recipient_name,c.given_name,c.surname,c.address_line1,c.address_line2,c.postal_code,c.city,c.country_code,
      v.option_id AS wahl_option_id,v.art AS wahl_art,v.quelle AS wahl_quelle,v.packlink_service_id AS wahl_service_id,
      v.carrier AS wahl_carrier,v.service_name AS wahl_service_name,v.paket AS wahl_paket,
      v.preis_cents AS wahl_preis_cents,v.laufzeit AS wahl_laufzeit
    FROM commerce_orders o LEFT JOIN order_contact_snapshots c ON c.order_id=o.id
    LEFT JOIN order_versand v ON v.order_id=o.id
    WHERE o.id=? LIMIT 1`).bind(safeText(orderId, 80)).first();
  if (!order) throw new PacklinkError("BESTELLUNG_NICHT_GEFUNDEN", 404);
  if (!erlaubt.includes(String(order.status))) {
    throw new PacklinkError("BESTELLUNG_NICHT_VERSANDBEREIT", 409, String(order.status));
  }
  return order;
}

// Was die Kundschaft im Checkout gewaehlt und bezahlt hat - die Admin-App
// schlaegt genau diese Leistung vor.
export function wahlView(order) {
  if (!order || !order.wahl_option_id) return null;
  const p = PAKETE[order.wahl_paket];
  return {
    optionId: order.wahl_option_id,
    art: order.wahl_art,
    quelle: order.wahl_quelle,
    serviceId: order.wahl_service_id == null ? null : Number(order.wahl_service_id),
    carrier: order.wahl_carrier || null,
    service: order.wahl_service_name || null,
    paket: order.wahl_paket,
    paketName: p ? p.name : order.wahl_paket,
    preisCents: Number(order.wahl_preis_cents),
    laufzeit: order.wahl_laufzeit || null,
    auslandsadresse: Boolean(order.country_code) && landCode(order.country_code) !== "DE",
  };
}

async function letzteSendung(env, orderId) {
  return requireDb(env).prepare(`SELECT * FROM packlink_sendungen WHERE order_id=?
    AND state NOT IN ('ERSETZT','KAUF_ABGELEHNT') ORDER BY created_at DESC LIMIT 1`).bind(orderId).first();
}

// Warum ein Kauf gerade gesperrt ist: ein zweiter Klick waehrend der Anfrage
// (KAUF_LAEUFT_SCHON) oder ein Kauf ohne klare Antwort (KAUF_UNKLAR). Eine
// Anfrage, die nach zwei Minuten noch "laeuft", ist abgebrochen - unklar.
function kaufGesperrt(row) {
  const alter = Date.now() - Date.parse(row.updated_at || row.created_at || "");
  return row.state === "KAUF_LAEUFT" && alter < 120_000 ? "KAUF_LAEUFT_SCHON" : "KAUF_UNKLAR";
}

// Ob "Etikett kaufen" (POST /v1/orders) bei diesem Packlink-Konto geht. Den
// Direktkauf rechnet Packlink ueber die Lastschrift ab, und die schaltet
// Packlink erst frei nach 3 Monaten mit direkter Zahlung und mindestens 100 €
// je Zweiwochenrechnung. Bis ein Direktkauf einmal geklappt hat, schlaegt die
// Admin-App deshalb den Entwurf vor (bezahlt in Packlink per PayPal/Karte).
async function direktkaufStand(env) {
  const db = requireDb(env);
  const [gekauft, letzte] = await Promise.all([
    db.prepare("SELECT created_at FROM audit_events WHERE event_type='PACKLINK_ETIKETT_GEKAUFT' ORDER BY created_at DESC LIMIT 1").first(),
    db.prepare(`SELECT event_type,created_at FROM audit_events
      WHERE event_type IN ('PACKLINK_KAUF_ABGELEHNT','PACKLINK_ETIKETT_GEKAUFT') ORDER BY created_at DESC LIMIT 1`).first(),
  ]);
  return {
    bewaehrt: Boolean(gekauft),
    zuletztAbgelehntAm: letzte?.event_type === 'PACKLINK_KAUF_ABGELEHNT' ? letzte.created_at : null,
  };
}

function protokoll(db, orderId, eventType, reqId, metadata) {
  return db.prepare(`INSERT INTO audit_events (id,actor_type,entity_type,entity_id,event_type,request_id,metadata_json,created_at)
      VALUES (?,'ADMIN','order',?,?,?,?,?)`)
    .bind(crypto.randomUUID(), orderId, eventType, reqId ? safeText(reqId, 120) : null, JSON.stringify(metadata), new Date().toISOString());
}

export function sendungView(row) {
  if (!row) return null;
  const ph = phase(row.state);
  const platzhalter = String(row.reference).startsWith(KAUF_PRAEFIX);
  const reference = platzhalter ? null : String(row.reference);
  return {
    reference,
    phase: ph,
    state: String(row.state),
    carrier: row.carrier || null,
    service: row.service_name || null,
    paket: row.paket || null,
    preisCents: row.price_cents == null ? null : Number(row.price_cents),
    bezahlLink: ph === "offen" && reference ? `${PRO_SHIPMENTS}${encodeURIComponent(reference)}/create/address` : null,
    // Ohne Referenz (Kauf unklar): die Sendungsliste in Packlink PRO.
    packlinkLink: reference ? `${PRO_SHIPMENTS}${encodeURIComponent(reference)}` : `${PRO_SHIPMENTS}all`,
    sendungsnummer: row.tracking_number || null,
    trackingUrl: row.tracking_url || null,
    etikettUrl: row.label_url || null,
    erstelltAm: row.created_at,
  };
}

// Keine neue Sendung, solange eine Stornierung mit Erstattung laeuft oder die
// Kundin vor dem Versand widerrufen hat (erstattung-auftrag.js). Die
// Sendungsverfolgung bestehender Pakete bleibt davon unberuehrt.
//
// Erst das Geld, dann das Etikett: eine beim Kauf nur reservierte Zahlung
// wird jetzt eingezogen (zahlung.js). Klappt das nicht, gibt es kein Etikett.
async function versandFrei(env, orderId, reqId = crypto.randomUUID()) {
  const sperre = await versandSperre(requireDb(env), orderId);
  if (sperre) throw new PacklinkError(sperre.code, 409, sperre.text);
  try {
    await zahlungSicherstellen(env, orderId, reqId, { anlass: "VERSAND" });
  } catch (err) {
    if (err instanceof ZahlungFehler) throw new PacklinkError(err.code, err.status, err.text);
    throw err;
  }
}

export async function entwurfAnlegen(env, orderId, body = {}) {
  if (!packlinkReady(env)) throw new PacklinkError("PACKLINK_NICHT_EINGERICHTET", 503);
  const db = requireDb(env);
  const order = await loadOrder(env, orderId);
  await versandFrei(env, order.id);
  const vorhanden = await letzteSendung(env, order.id);
  // Ein Entwurf je Auftrag. Ein zweiter nur ausdruecklich ("neu") und nie,
  // wenn der erste schon bezahlt ist. Nach einem unklaren Kauf erst, wenn in
  // Packlink PRO nachgesehen wurde ("trotzdem").
  if (vorhanden && phase(vorhanden.state) === "kauf") {
    if (!body.trotzdem) throw new PacklinkError(kaufGesperrt(vorhanden), 409);
  } else if (vorhanden && !["storniert"].includes(phase(vorhanden.state))) {
    if (!body.neu) return sendungView(vorhanden);
    if (phase(vorhanden.state) !== "offen") throw new PacklinkError("SENDUNG_SCHON_BEZAHLT", 409);
  }

  const { serviceId, paket, angebot } = await angebotFuerBuchung(env, order, body);
  const to = empfaenger(order);
  pruefeEmpfaenger(to);

  const warenwert = Number(order.subtotal_cents || order.total_cents || 0) / 100;
  const entwurf = {
    service_id: serviceId,
    source: "PRO",
    platform: "PRO",
    platform_country: "DE",
    from: absender(env),
    to,
    packages: [{ width: paket.breite, height: paket.hoehe, length: paket.laenge, weight: paket.gewichtKg }],
    content: "Bekleidung",
    contentvalue: Math.round(warenwert * 100) / 100,
    contentValue_currency: "EUR",
    content_second_hand: true,
    shipment_custom_reference: safeText(order.order_number, 60),
  };
  const antwort = await (await packlink(env, "/shipments", { method: "POST", body: entwurf })).json();
  const reference = safeText(antwort?.reference, 60);
  if (!/^[A-Za-z0-9-]{6,60}$/.test(reference)) throw new PacklinkError("PACKLINK_ANTWORT_UNGUELTIG", 502);

  const now = new Date().toISOString();
  const statements = [];
  if (vorhanden) {
    statements.push(db.prepare("UPDATE packlink_sendungen SET state='ERSETZT',updated_at=? WHERE id=?").bind(now, vorhanden.id));
  }
  // Nie neben einem laufenden Kauf: dann bliebe der Entwurf liegen.
  statements.push(db.prepare(`INSERT INTO packlink_sendungen
      (id,order_id,reference,service_id,carrier,service_name,paket,price_cents,state,created_at,updated_at)
      SELECT ?,?,?,?,?,?,?,?,'AWAITING_COMPLETION',?,?
      WHERE NOT EXISTS (SELECT 1 FROM packlink_sendungen WHERE order_id=? AND state IN ('KAUF_LAEUFT','KAUF_UNKLAR'))`)
    .bind(crypto.randomUUID(), order.id, reference, serviceId, angebot.carrier || null,
      angebot.name || null, paket.key, angebot.preisCents, now, now, order.id));
  statements.push(db.prepare(`INSERT INTO audit_events (id,actor_type,entity_type,entity_id,event_type,request_id,metadata_json,created_at)
      SELECT ?,'ADMIN','order',?,'PACKLINK_ENTWURF_ANGELEGT',NULL,?,?
      WHERE EXISTS (SELECT 1 FROM packlink_sendungen WHERE reference=?)`)
    .bind(crypto.randomUUID(), order.id, JSON.stringify({ reference, serviceId, paket: paket.key }), now, reference));
  const ergebnis = await db.batch(statements);
  if (!ergebnis[ergebnis.length - 2]?.meta?.changes) throw new PacklinkError("KAUF_LAEUFT_SCHON", 409);
  return sendungView(await letzteSendung(env, order.id));
}

// Direktkauf ueber POST /v1/orders: Packlink bucht die Sendung sofort und
// rechnet sie ueber die in Packlink PRO hinterlegte Zahlungsart ab
// (Einstellungen -> Abrechnung und Rechnungen -> Zahlungsinformationen).
//
// Doppelt kaufen darf nie passieren. Deshalb steht vor der Anfrage eine
// Sperrzeile KAUF_LAEUFT in der Datenbank - ein zweiter Klick oder ein
// zweites Geraet findet sie und bekommt KAUF_LAEUFT_SCHON. Lehnt Packlink
// eindeutig ab (4xx), ist nichts gekauft: die Zeile wird KAUF_ABGELEHNT und
// die Angebote stehen wieder da. Kommt keine klare Antwort (Netz, 5xx, Antwort
// ohne Sendung), wird sie KAUF_UNKLAR und sperrt weiter: erst in Packlink PRO
// nachsehen, dann ausdruecklich "trotzdem" neu kaufen.
export async function etikettKaufen(env, orderId, body = {}, reqId = crypto.randomUUID()) {
  if (!packlinkReady(env)) throw new PacklinkError("PACKLINK_NICHT_EINGERICHTET", 503);
  const db = requireDb(env);
  const order = await loadOrder(env, orderId);
  await versandFrei(env, order.id, reqId);
  const vorhanden = await letzteSendung(env, order.id);
  if (vorhanden) {
    const ph = phase(vorhanden.state);
    if (ph === "kauf" && !body.trotzdem) throw new PacklinkError(kaufGesperrt(vorhanden), 409);
    if (ph === "offen" && !body.neu) throw new PacklinkError("ENTWURF_VORHANDEN", 409);
    if (!["kauf", "offen", "storniert"].includes(ph)) throw new PacklinkError("SENDUNG_SCHON_BEZAHLT", 409);
  }

  const { serviceId, paket, angebot } = await angebotFuerBuchung(env, order, body);
  const to = empfaenger(order);
  pruefeEmpfaenger(to);

  const now = new Date().toISOString();
  const zeileId = crypto.randomUUID();
  const statements = [];
  if (vorhanden) {
    // Entwurf, stornierte Sendung oder ein in Packlink geprueft nicht
    // zustande gekommener Kauf: der neue Kauf ersetzt ihn.
    statements.push(db.prepare("UPDATE packlink_sendungen SET state='ERSETZT',updated_at=? WHERE id=? AND state=?")
      .bind(now, vorhanden.id, vorhanden.state));
  }
  statements.push(db.prepare(`INSERT INTO packlink_sendungen
      (id,order_id,reference,service_id,carrier,service_name,paket,price_cents,state,created_at,updated_at)
      SELECT ?,?,?,?,?,?,?,?,'KAUF_LAEUFT',?,?
      WHERE NOT EXISTS (SELECT 1 FROM packlink_sendungen WHERE order_id=? AND state NOT IN (${RUHEND}))`)
    .bind(zeileId, order.id, `${KAUF_PRAEFIX}${zeileId}`, serviceId, angebot.carrier || null,
      angebot.name || null, paket.key, angebot.preisCents, now, now, order.id));
  const gesperrt = await db.batch(statements);
  if (!gesperrt[gesperrt.length - 1]?.meta?.changes) throw new PacklinkError("KAUF_LAEUFT_SCHON", 409);

  const kennung = safeText(order.order_number, 60);
  const warenwert = Number(order.subtotal_cents || order.total_cents || 0) / 100;
  const auftrag = {
    order_custom_reference: kennung,
    shipments: [{
      service_id: serviceId,
      source: "PRO",
      platform: "PRO",
      platform_country: "DE",
      from: absender(env),
      to,
      packages: [{ width: paket.breite, height: paket.hoehe, length: paket.laenge, weight: paket.gewichtKg }],
      content: "Bekleidung",
      contentvalue: Math.round(warenwert * 100) / 100,
      contentValue_currency: "EUR",
      content_second_hand: true,
      shipment_custom_reference: kennung,
    }],
  };

  let antwort;
  try {
    antwort = await (await packlink(env, "/orders", { method: "POST", body: auftrag })).json();
  } catch (err) {
    const abgelehnt = err instanceof PacklinkError && err.httpStatus >= 400 && err.httpStatus < 500;
    const detail = text(err?.detail || "", 240);
    await db.batch([
      db.prepare("UPDATE packlink_sendungen SET state=?,updated_at=? WHERE id=?")
        .bind(abgelehnt ? "KAUF_ABGELEHNT" : "KAUF_UNKLAR", new Date().toISOString(), zeileId),
      protokoll(db, order.id, abgelehnt ? "PACKLINK_KAUF_ABGELEHNT" : "PACKLINK_KAUF_UNKLAR", reqId,
        { serviceId, paket: paket.key, http: err?.httpStatus ?? null, detail }),
    ]);
    if (abgelehnt) {
      throw new PacklinkError(err.code === "PACKLINK_ZUGANG_ABGELEHNT" ? err.code : "KAUF_ABGELEHNT", 409, detail, err.httpStatus);
    }
    throw new PacklinkError("KAUF_UNKLAR", 502, detail);
  }

  const zeile = (Array.isArray(antwort?.shipments) ? antwort.shipments : [])[0] || {};
  const reference = safeText(zeile.shipment_reference || zeile.reference || "", 60);
  if (!/^[A-Za-z0-9-]{6,60}$/.test(reference) || reference.startsWith(KAUF_PRAEFIX)) {
    await db.batch([
      db.prepare("UPDATE packlink_sendungen SET state='KAUF_UNKLAR',updated_at=? WHERE id=?").bind(new Date().toISOString(), zeileId),
      protokoll(db, order.id, "PACKLINK_KAUF_UNKLAR", reqId, { serviceId, paket: paket.key, detail: "Antwort ohne Sendung" }),
    ]);
    throw new PacklinkError("KAUF_UNKLAR", 502, "Packlink hat keine Sendungsnummer zurückgegeben.");
  }
  const preis = cents(zeile.total_price) ?? cents(antwort?.total_amount) ?? angebot.preisCents;
  const jetzt = new Date().toISOString();
  await db.batch([
    db.prepare("UPDATE packlink_sendungen SET reference=?,state='PURCHASE_SUCCESS',price_cents=?,updated_at=? WHERE id=?")
      .bind(reference, preis, jetzt, zeileId),
    protokoll(db, order.id, "PACKLINK_ETIKETT_GEKAUFT", reqId, {
      reference, serviceId, paket: paket.key, preisCents: preis, packlinkAuftrag: safeText(antwort?.order_reference, 60) || null,
    }),
  ]);
  const row = await db.prepare("SELECT * FROM packlink_sendungen WHERE id=?").bind(zeileId).first();
  // Oft ist das Etikett schon fertig. Sonst meldet Packlink es gleich per
  // Webhook - ein Fehler beim Nachsehen aendert nichts am Kauf.
  try {
    return await sendungAktualisieren(env, row, reqId);
  } catch {
    return sendungView(row);
  }
}

function ersteSendungsnummer(trackings) {
  for (const eintrag of Array.isArray(trackings) ? trackings : []) {
    const nummer = typeof eintrag === "string" ? eintrag : (eintrag?.tracking_code || eintrag?.code || eintrag?.number);
    const sauber = safeText(nummer, 60).replace(/\s+/g, "");
    if (/^[A-Za-z0-9-]{6,60}$/.test(sauber)) return sauber;
  }
  return "";
}

function ersteUrl(liste) {
  for (const eintrag of Array.isArray(liste) ? liste : []) {
    const url = sichereUrl(typeof eintrag === "string" ? eintrag : eintrag?.url);
    if (url) return url;
  }
  return "";
}

export async function statusAbrufen(env, orderId, reqId = crypto.randomUUID()) {
  const row = await letzteSendung(env, safeText(orderId, 80));
  if (!row) return null;
  return sendungAktualisieren(env, row, reqId);
}

// Stand einer Sendung bei Packlink abholen, speichern und die Bestellung
// nachziehen. Gemeinsamer Weg fuer "Status holen" in der Admin-App und die
// Meldungen von Packlink (Webhook).
async function sendungAktualisieren(env, row, reqId) {
  const db = requireDb(env);
  // Fertige Sendungen nicht bei jedem Oeffnen neu abfragen. Eine Sperrzeile
  // (Kauf laeuft oder unklar) hat noch keine Packlink-Referenz.
  if (!packlinkReady(env) || phase(row.state) === "kauf"
      || (["zugestellt", "storniert"].includes(phase(row.state)) && row.label_url)) {
    return sendungView(row);
  }

  const daten = await (await packlink(env, `/shipments/${encodeURIComponent(row.reference)}`)).json();
  const state = safeText(daten?.state, 40).toUpperCase() || row.state;
  const carrier = text(daten?.carrier, 40) || row.carrier;
  const serviceName = text(daten?.service, 80) || row.service_name;
  const sendungsnummer = ersteSendungsnummer(daten?.trackings) || row.tracking_number || "";
  const trackingUrl = sichereUrl(daten?.tracking_url) || row.tracking_url || "";
  let etikett = row.label_url || "";
  if (!etikett && ["bereit", "unterwegs", "zugestellt"].includes(phase(state))) {
    etikett = ersteUrl(await (await packlink(env, `/shipments/${encodeURIComponent(row.reference)}/labels`)).json());
  }

  const now = new Date().toISOString();
  await db.prepare(`UPDATE packlink_sendungen SET state=?,carrier=?,service_name=?,tracking_number=?,
      tracking_url=?,label_url=?,updated_at=? WHERE id=?`)
    .bind(state, carrier || null, serviceName || null, sendungsnummer || null, trackingUrl || null,
      etikett || null, now, row.id).run();
  if (sendungsnummer && sendungsnummer !== row.tracking_number) {
    await sendungsnummerAnhaengen(env, row.order_id, carrier || "Packlink", serviceName, sendungsnummer, now);
  }
  if (row.state !== "ERSETZT") await verlaufUebernehmen(env, row.order_id, state, now, reqId);
  return sendungView({
    ...row, state, carrier, service_name: serviceName, tracking_number: sendungsnummer || null,
    tracking_url: trackingUrl || null, label_url: etikett || null,
  });
}

// Reihenfolge der Sendungszustaende in shipments. Nie rueckwaerts: eine
// verspaetete "unterwegs"-Meldung macht aus "zugestellt" nichts anderes.
const SENDUNG_RANG = Object.freeze({
  PENDING: 0, LABEL_CREATED: 1, SHIPPED: 2, IN_TRANSIT: 3, EXCEPTION: 3, RETURNED: 5, DELIVERED: 5,
});

export function sendungsStatusFolgt(alt, neu) {
  if (!neu || alt === neu) return false;
  if (!(alt in SENDUNG_RANG)) return true;
  if (alt === "EXCEPTION" && neu === "IN_TRANSIT") return true;
  if (neu === "EXCEPTION") return SENDUNG_RANG[alt] <= SENDUNG_RANG.IN_TRANSIT;
  return SENDUNG_RANG[neu] > SENDUNG_RANG[alt];
}

const BESTELL_REIHE = Object.freeze(["PAID", "PREPARING", "SHIPPED", "DELIVERED"]);

// Bestellung und Sendung dem Packlink-Zustand nachfuehren. Jeder Schritt
// laeuft ueber dieselbe Statuspruefung wie der Knopf in der Admin-App - bei
// "Versendet" geht also die Versandmail mit Sendungsnummer raus (hoechstens
// einmal je Sendungsnummer). Stornierte, erstattete oder zurueckgegebene
// Bestellungen fasst das nie an.
async function verlaufUebernehmen(env, orderId, state, now, reqId) {
  const db = requireDb(env);
  const ziel = bestellZiel(state);
  if (ziel) {
    const order = await db.prepare("SELECT status FROM commerce_orders WHERE id=?").bind(orderId).first();
    let ist = BESTELL_REIHE.indexOf(String(order?.status || ""));
    const soll = BESTELL_REIHE.indexOf(ziel);
    while (ist >= 0 && ist < soll) {
      ist += 1;
      await orderStatusAutomatisch(env, orderId, BESTELL_REIHE[ist], reqId);
    }
  }
  const intern = sendungsStatusIntern(state);
  if (!intern) return;
  const shipment = await db.prepare("SELECT id,status FROM shipments WHERE order_id=? ORDER BY created_at DESC LIMIT 1").bind(orderId).first();
  if (!shipment || !sendungsStatusFolgt(String(shipment.status || ""), intern)) return;
  await db.prepare(`UPDATE shipments SET status=?,
      delivered_at=CASE WHEN ?='DELIVERED' THEN COALESCE(delivered_at,?) ELSE delivered_at END,updated_at=? WHERE id=?`)
    .bind(intern, intern, now, now, shipment.id).run();
}

// Sendungsnummer an den Auftrag haengen, noch ohne "Versendet": abgegeben ist
// das Paket erst im Paketshop. Die Versandmail kommt mit dem Statuswechsel.
async function sendungsnummerAnhaengen(env, orderId, carrier, service, trackingNumber, now) {
  const db = requireDb(env);
  const shipment = await db.prepare("SELECT id FROM shipments WHERE order_id=? ORDER BY created_at DESC LIMIT 1").bind(orderId).first();
  const statements = [];
  if (shipment) {
    statements.push(db.prepare(`UPDATE shipments SET carrier=?,service=?,tracking_number=?,
        status=CASE WHEN status='PENDING' THEN 'LABEL_CREATED' ELSE status END,updated_at=? WHERE id=?`)
      .bind(carrier, service || null, trackingNumber, now, shipment.id));
  } else {
    statements.push(db.prepare(`INSERT INTO shipments (id,order_id,carrier,service,tracking_number,status,created_at,updated_at)
        VALUES (?,?,?,?,?,'LABEL_CREATED',?,?)`)
      .bind(crypto.randomUUID(), orderId, carrier, service || null, trackingNumber, now, now));
  }
  // Bezahlt -> "Wird gepackt": Bestellung und Lagerstueck wechseln gemeinsam,
  // sonst lehnt die Statuspruefung spaeter "Versendet" ab.
  statements.push(
    db.prepare("UPDATE commerce_orders SET status='PREPARING',updated_at=? WHERE id=? AND status='PAID'").bind(now, orderId),
    db.prepare(`UPDATE inventory SET status='PREPARING',updated_at=?,version=version+1
      WHERE id IN (SELECT inventory_id FROM order_items WHERE order_id=?) AND status='PAID'`).bind(now, orderId),
    db.prepare(`INSERT INTO audit_events (id,actor_type,entity_type,entity_id,event_type,request_id,metadata_json,created_at)
      VALUES (?,'ADMIN','order',?,'PACKLINK_SENDUNGSNUMMER',NULL,?,?)`)
      .bind(crypto.randomUUID(), orderId, JSON.stringify({ carrier, tracking: true }), now),
  );
  await db.batch(statements);
}

// ------------------------------------------------------------------- Routen

function headers(origin) {
  const out = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
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

const ROUTE = /^\/admin\/versand\/([^/]+)\/packlink(\/angebote|\/kaufen)?$/;

export function isPacklinkRoute(url) {
  return ROUTE.test(url.pathname.replace(/\/+$/, ""));
}

function antwort(daten, status, origin) {
  return new Response(JSON.stringify(daten), { status, headers: headers(origin) });
}

export async function handlePacklink(request, env, url, reqId = crypto.randomUUID(), origin = null) {
  try {
    if (request.method === "OPTIONS") {
      if (origin && !ADMIN_ORIGINS.includes(origin)) return new Response(null, { status: 403, headers: headers(null) });
      return new Response(null, { status: 204, headers: headers(origin) });
    }
    if (origin && !ADMIN_ORIGINS.includes(origin)) throw new PacklinkError("ORIGIN_NOT_ALLOWED", 403);
    // Wie alle Admin-Module: worker-entry.js hat die Berechtigung schon
    // geprueft und den Schluessel dieser Anfrage in env.ADMIN_TOKEN gelegt.
    const supplied = String(request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
    if (!env.ADMIN_TOKEN || !(await tokenEquals(supplied, env.ADMIN_TOKEN))) throw new PacklinkError("UNAUTHORIZED", 401);

    const [, rohId, zusatz] = ROUTE.exec(url.pathname.replace(/\/+$/, ""));
    const orderId = safeText(decodeURIComponent(rohId), 80);

    if (zusatz === "/angebote") {
      if (request.method !== "GET") throw new PacklinkError("METHOD_NOT_ALLOWED", 405);
      const order = await loadOrder(env, orderId);
      const wahl = wahlView(order);
      // Ohne ausdrueckliche Groesse: die Paketgroesse aus dem Checkout.
      const ergebnis = await angeboteLaden(env, order, url.searchParams.get("paket") || wahl?.paket,
        { behalten: wahl?.serviceId ?? null, nurErlaubteDienste: false });
      return antwort({ ok: true, eingerichtet: packlinkReady(env), direktkauf: await direktkaufStand(env), wahl, ...ergebnis }, 200, origin);
    }
    if (zusatz === "/kaufen") {
      if (request.method !== "POST") throw new PacklinkError("METHOD_NOT_ALLOWED", 405);
      let body = {};
      try { body = (await request.json()) || {}; } catch { body = {}; }
      return antwort({ ok: true, sendung: await etikettKaufen(env, orderId, body, reqId) }, 200, origin);
    }
    if (request.method === "GET") {
      const order = await loadOrder(env, orderId, ["PAID", "PREPARING", "SHIPPED", "DELIVERED"]);
      const sendung = await statusAbrufen(env, orderId, reqId);
      return antwort({ ok: true, eingerichtet: packlinkReady(env), direktkauf: await direktkaufStand(env), pakete: PAKETE, wahl: wahlView(order), sendung }, 200, origin);
    }
    if (request.method === "POST") {
      let body = {};
      try { body = (await request.json()) || {}; } catch { body = {}; }
      return antwort({ ok: true, sendung: await entwurfAnlegen(env, orderId, body) }, 200, origin);
    }
    throw new PacklinkError("METHOD_NOT_ALLOWED", 405);
  } catch (err) {
    if (err instanceof PacklinkError) {
      return antwort({ error: err.code, detail: err.detail || undefined, requestId: reqId }, err.status, origin);
    }
    console.error(JSON.stringify({ level: "error", event: "packlink_error", requestId: reqId, message: safeText(err?.message || "unknown", 180) }));
    return antwort({ error: "INTERNAL_PACKLINK_ERROR", requestId: reqId }, 500, origin);
  }
}

// ------------------------------------------------------------------- Webhook

// Packlink meldet Zustandswechsel an https://api.disorder119.com/packlink/
// webhook/<PACKLINK_WEBHOOK_TOKEN> (als Worker-Secret gesetzt und bei
// Packlink ueber POST /v1/shipments/callback registriert). Packlink signiert
// die Meldungen nicht.
// Deshalb gilt: Der Schluessel im Pfad haelt nur Fremde fern - geglaubt wird
// der Meldung trotzdem nichts. Sie loest lediglich aus, dass der Server den
// Stand der Sendung mit dem eigenen API-Schluessel bei Packlink abholt.
const WEBHOOK_ROUTE = /^\/packlink\/webhook\/([^/]{1,200})$/;

export function isPacklinkWebhookRoute(url) {
  return WEBHOOK_ROUTE.test(url.pathname.replace(/\/+$/, ""));
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value)));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
}

function webhookAntwort(daten, status) {
  return new Response(JSON.stringify(daten), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function handlePacklinkWebhook(request, env, url, reqId = crypto.randomUUID()) {
  try {
    if (request.method !== "POST") return webhookAntwort({ error: "METHOD_NOT_ALLOWED", requestId: reqId }, 405);
    const [, roh] = WEBHOOK_ROUTE.exec(url.pathname.replace(/\/+$/, ""));
    let schluessel = "";
    try { schluessel = decodeURIComponent(roh); } catch { schluessel = ""; }
    // Falscher oder (noch) nicht eingerichteter Schluessel: wie jede
    // unbekannte Adresse, ohne Hinweis, dass es diese Route gibt.
    if (!env.PACKLINK_WEBHOOK_TOKEN || !(await tokenEquals(schluessel, env.PACKLINK_WEBHOOK_TOKEN))) {
      return webhookAntwort({ error: "NOT_FOUND", requestId: reqId }, 404);
    }
    let body;
    try { body = await request.json(); } catch { return webhookAntwort({ error: "INVALID_JSON", requestId: reqId }, 400); }
    const event = safeText(body?.event, 60) || "unbekannt";
    const reference = safeText(body?.data?.shipment_reference ?? body?.data?.reference ?? body?.shipment_reference, 60);
    const zeitpunkt = safeText(body?.datetime, 40);
    if (!/^[A-Za-z0-9-]{6,60}$/.test(reference)) return webhookAntwort({ ok: true, ignoriert: "OHNE_SENDUNG" }, 200);

    const db = requireDb(env);
    const id = await sha256Hex(`${event}|${reference}|${zeitpunkt}`);
    const now = new Date().toISOString();
    const eingetragen = await db.prepare(`INSERT OR IGNORE INTO packlink_webhook_events (id,event,reference,received_at)
      VALUES (?,?,?,?)`).bind(id, event, reference, now).run();
    if (!eingetragen?.meta?.changes) return webhookAntwort({ ok: true, duplicate: true }, 200);

    const erledigt = ergebnis => db.prepare("UPDATE packlink_webhook_events SET processed_at=?,result=? WHERE id=?")
      .bind(new Date().toISOString(), ergebnis, id).run();
    try {
      const row = await db.prepare("SELECT * FROM packlink_sendungen WHERE reference=? LIMIT 1").bind(reference).first();
      if (!row) {
        await erledigt("UNBEKANNTE_SENDUNG");
        return webhookAntwort({ ok: true, ignoriert: "UNBEKANNTE_SENDUNG" }, 200);
      }
      if (!packlinkReady(env)) {
        await erledigt("OHNE_API_SCHLUESSEL");
        return webhookAntwort({ ok: true, ignoriert: "OHNE_API_SCHLUESSEL" }, 200);
      }
      const sendung = await sendungAktualisieren(env, row, reqId);
      await erledigt(safeText(sendung?.state || "OK", 40));
      return webhookAntwort({ ok: true, phase: sendung?.phase || null }, 200);
    } catch (err) {
      // Nicht als verarbeitet merken: Packlink darf dieselbe Meldung noch
      // einmal schicken, dann wird sie normal verarbeitet.
      await db.prepare("DELETE FROM packlink_webhook_events WHERE id=? AND processed_at IS NULL").bind(id).run();
      throw err;
    }
  } catch (err) {
    const code = err instanceof PacklinkError ? err.code : "INTERNAL_PACKLINK_ERROR";
    console.error(JSON.stringify({ level: "error", event: "packlink_webhook_error", requestId: reqId, code, message: safeText(err?.message || "unknown", 180) }));
    return webhookAntwort({ error: code, requestId: reqId }, err instanceof PacklinkError && err.status < 500 ? err.status : 502);
  }
}

// -------------------------------------------------------------- Systemstatus

// Fuer /admin/system: ist Packlink eingerichtet, kommen Meldungen an, wie
// viele Sendungen laufen noch? Keine Schluessel, keine Adressen.
export async function versandStatus(env) {
  const out = {
    packlinkSchluessel: packlinkReady(env),
    webhookSchluessel: Boolean(env.PACKLINK_WEBHOOK_TOKEN),
    meldungen: 0,
    letzteMeldung: null,
    offeneSendungen: 0,
    bestellungenMitVersandwahl: 0,
    tabellen: true,
  };
  if (!env?.DB) return { ...out, tabellen: false };
  try {
    const [meldungen, offen, wahl] = await Promise.all([
      env.DB.prepare("SELECT COUNT(*) AS n, MAX(received_at) AS letzte FROM packlink_webhook_events").first(),
      env.DB.prepare(`SELECT COUNT(*) AS n FROM packlink_sendungen
        WHERE state NOT IN ('DELIVERED','RETURNED_TO_SENDER','CANCELED','CANCELLED','ERSETZT')`).first(),
      env.DB.prepare("SELECT COUNT(*) AS n FROM order_versand").first(),
    ]);
    out.meldungen = Number(meldungen?.n || 0);
    out.letzteMeldung = meldungen?.letzte || null;
    out.offeneSendungen = Number(offen?.n || 0);
    out.bestellungenMitVersandwahl = Number(wahl?.n || 0);
  } catch {
    out.tabellen = false;
  }
  return out;
}

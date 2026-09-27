// Packlink PRO - Versandlabels von DPD, UPS, GLS und weiteren ueber ein Konto,
// ohne Grundgebuehr.
//
// Ablauf je Auftrag (Admin-App, Bestellung -> Versand):
//   1. Paketgroesse waehlen -> Angebote der Paketdienste mit Bruttopreis.
//   2. Angebot waehlen -> der Server legt in Packlink PRO einen Sendungsentwurf
//      mit Lieferadresse und Paketmassen an.
//   3. Bezahlt wird in Packlink PRO (Direktlink). Per Schnittstelle geht das
//      bewusst nicht - genauso arbeiten Packlinks eigene Shop-Plugins.
//   4. Zurueck in der App: Status abrufen -> Sendungsnummer und Etikett (PDF).
//      Die Sendungsnummer landet am Auftrag, "Versendet" setzt du nach der
//      Abgabe; dann geht die Versandmail mit Tracking-Link raus.
//
// Schnittstelle wie in Packlinks offenem Plugin-Kern (packlink-dev/
// ecommerce_module_core, src/BusinessLogic/Http/Proxy.php): Basis
// https://api.packlink.com/v1/, Header "Authorization: <API-Schluessel>".
// Angebote liefert Packlink auch ohne Schluessel; Entwurf, Status und Etikett
// brauchen das Secret PACKLINK_API_KEY aus Packlink PRO (Einstellungen).
//
// Datenschutz: An Packlink gehen nur Name und Lieferadresse, keine E-Mail-
// Adresse oder Telefonnummer der Kundin - dafuer braeuchte es eine Einwilligung.
import { safeText } from "./commerce-core.js";

const API = "https://api.packlink.com/v1";
const PRO_SHIPMENTS = "https://pro.packlink.de/private/shipments/";
const ADMIN_ORIGINS = Object.freeze([
  "https://admin.disorder119.com",
  "http://localhost:8765",
  "http://127.0.0.1:8765",
]);

// Paketgroessen fuer Kleidung aus dem Archiv. Masse und Gewicht lassen sich im
// Entwurf in Packlink PRO noch anpassen.
export const PAKETE = Object.freeze({
  S: Object.freeze({ name: "Klein", beispiel: "Shirt, Top, Accessoire", laenge: 35, breite: 25, hoehe: 8, gewichtKg: 1 }),
  M: Object.freeze({ name: "Mittel", beispiel: "Jacke, Hose, Schuhe", laenge: 40, breite: 30, hoehe: 15, gewichtKg: 2 }),
  L: Object.freeze({ name: "Groß", beispiel: "Mantel, Stiefel, mehrere Teile", laenge: 50, breite: 40, hoehe: 20, gewichtKg: 5 }),
});
const MAX_ANGEBOTE = 8;

export class PacklinkError extends Error {
  constructor(code, status = 400, detail = "") {
    super(code);
    this.code = code;
    this.status = status;
    this.detail = detail;
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
];

export function phase(state) {
  const s = String(state || "").toUpperCase();
  for (const [name, states] of PHASEN) if (states.includes(s)) return name;
  return "offen";
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

function paketFuer(key) {
  const k = String(key || "M").toUpperCase();
  return PAKETE[k] ? { key: k, ...PAKETE[k] } : { key: "M", ...PAKETE.M };
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
    if (res.status === 401 || res.status === 403) throw new PacklinkError("PACKLINK_ZUGANG_ABGELEHNT", 502, detail);
    if (res.status === 404) throw new PacklinkError("PACKLINK_SENDUNG_UNBEKANNT", 404, detail);
    throw new PacklinkError("PACKLINK_FEHLER", 502, detail || `HTTP ${res.status}`);
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

export async function angeboteLaden(env, ziel, paketKey) {
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
      .sort((a, b) => a.preisCents - b.preisCents)
      .slice(0, MAX_ANGEBOTE),
  };
}

// --------------------------------------------------------------- Ablauf je Auftrag

function requireDb(env) {
  if (!env?.DB) throw new PacklinkError("DATENBANK_FEHLT", 503);
  return env.DB;
}

async function loadOrder(env, orderId, erlaubt = ["PAID", "PREPARING"]) {
  const order = await requireDb(env).prepare(`SELECT o.id,o.order_number,o.status,o.subtotal_cents,o.total_cents,
      c.recipient_name,c.given_name,c.surname,c.address_line1,c.address_line2,c.postal_code,c.city,c.country_code
    FROM commerce_orders o LEFT JOIN order_contact_snapshots c ON c.order_id=o.id
    WHERE o.id=? LIMIT 1`).bind(safeText(orderId, 80)).first();
  if (!order) throw new PacklinkError("BESTELLUNG_NICHT_GEFUNDEN", 404);
  if (!erlaubt.includes(String(order.status))) {
    throw new PacklinkError("BESTELLUNG_NICHT_VERSANDBEREIT", 409, String(order.status));
  }
  return order;
}

async function letzteSendung(env, orderId) {
  return requireDb(env).prepare(`SELECT * FROM packlink_sendungen WHERE order_id=? AND state<>'ERSETZT'
    ORDER BY created_at DESC LIMIT 1`).bind(orderId).first();
}

export function sendungView(row) {
  if (!row) return null;
  const ph = phase(row.state);
  const reference = String(row.reference);
  return {
    reference,
    phase: ph,
    state: String(row.state),
    carrier: row.carrier || null,
    service: row.service_name || null,
    paket: row.paket || null,
    preisCents: row.price_cents == null ? null : Number(row.price_cents),
    bezahlLink: ph === "offen" ? `${PRO_SHIPMENTS}${encodeURIComponent(reference)}/create/address` : null,
    packlinkLink: `${PRO_SHIPMENTS}${encodeURIComponent(reference)}`,
    sendungsnummer: row.tracking_number || null,
    trackingUrl: row.tracking_url || null,
    etikettUrl: row.label_url || null,
    erstelltAm: row.created_at,
  };
}

export async function entwurfAnlegen(env, orderId, body = {}) {
  if (!packlinkReady(env)) throw new PacklinkError("PACKLINK_NICHT_EINGERICHTET", 503);
  const db = requireDb(env);
  const order = await loadOrder(env, orderId);
  const vorhanden = await letzteSendung(env, order.id);
  // Ein Entwurf je Auftrag. Ein zweiter nur ausdruecklich ("neu") und nie,
  // wenn der erste schon bezahlt ist.
  if (vorhanden && !["storniert"].includes(phase(vorhanden.state))) {
    if (!body.neu) return sendungView(vorhanden);
    if (phase(vorhanden.state) !== "offen") throw new PacklinkError("SENDUNG_SCHON_BEZAHLT", 409);
  }

  const serviceId = Number(body.serviceId);
  if (!Number.isInteger(serviceId) || serviceId <= 0) throw new PacklinkError("ANGEBOT_FEHLT", 400);
  const paket = paketFuer(body.paket);
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
  statements.push(db.prepare(`INSERT INTO packlink_sendungen
      (id,order_id,reference,service_id,carrier,service_name,paket,price_cents,state,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,'AWAITING_COMPLETION',?,?)`)
    .bind(crypto.randomUUID(), order.id, reference, serviceId, text(body.carrier, 40) || null,
      text(body.name, 80) || null, paket.key, cents(Number(body.preisCents) / 100), now, now));
  statements.push(db.prepare(`INSERT INTO audit_events (id,actor_type,entity_type,entity_id,event_type,request_id,metadata_json,created_at)
      VALUES (?,'ADMIN','order',?,'PACKLINK_ENTWURF_ANGELEGT',NULL,?,?)`)
    .bind(crypto.randomUUID(), order.id, JSON.stringify({ reference, serviceId, paket: paket.key }), now));
  await db.batch(statements);
  return sendungView(await letzteSendung(env, order.id));
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

export async function statusAbrufen(env, orderId) {
  const db = requireDb(env);
  const row = await letzteSendung(env, safeText(orderId, 80));
  if (!row) return null;
  // Fertige Sendungen nicht bei jedem Oeffnen neu abfragen.
  if (!packlinkReady(env) || (["zugestellt", "storniert"].includes(phase(row.state)) && row.label_url)) {
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
  return sendungView({
    ...row, state, carrier, service_name: serviceName, tracking_number: sendungsnummer || null,
    tracking_url: trackingUrl || null, label_url: etikett || null,
  });
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

const ROUTE = /^\/admin\/versand\/([^/]+)\/packlink(\/angebote)?$/;

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

    const [, rohId, angebote] = ROUTE.exec(url.pathname.replace(/\/+$/, ""));
    const orderId = safeText(decodeURIComponent(rohId), 80);

    if (angebote) {
      if (request.method !== "GET") throw new PacklinkError("METHOD_NOT_ALLOWED", 405);
      const order = await loadOrder(env, orderId);
      const ergebnis = await angeboteLaden(env, order, url.searchParams.get("paket"));
      return antwort({ ok: true, eingerichtet: packlinkReady(env), ...ergebnis }, 200, origin);
    }
    if (request.method === "GET") {
      await loadOrder(env, orderId, ["PAID", "PREPARING", "SHIPPED", "DELIVERED"]);
      const sendung = await statusAbrufen(env, orderId);
      return antwort({ ok: true, eingerichtet: packlinkReady(env), pakete: PAKETE, sendung }, 200, origin);
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

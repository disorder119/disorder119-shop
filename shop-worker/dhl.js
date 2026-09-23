// DHL-Versandschein erzeugen (Parcel DE Shipping API v2).
//
// Ein erzeugter Versandschein kostet echtes Geld und laesst sich nicht einfach
// zurueckgeben. Deshalb ist die wichtigste Eigenschaft hier nicht die
// Anbindung selbst, sondern dass ein zweiter Aufruf fuer dieselbe Bestellung
// keinen zweiten Schein erzeugt.
//
// Ohne Zugangsdaten passiert nichts: der Worker meldet NOT_CONFIGURED, und der
// Versand laeuft weiter ueber das DHL-Portal mit haendisch eingetragener
// Sendungsnummer. Die Bestellung haengt also nie an dieser Anbindung.
import { safeText } from "./commerce-core.js";

const SANDBOX_BASE = "https://api-sandbox.dhl.com/parcel/de/shipping/v2";
const LIVE_BASE = "https://api-eu.dhl.com/parcel/de/shipping/v2";

// V01PAK ist das nationale DHL Paket. Auslandssendungen brauchen ein anderes
// Produkt und eine Zollinhaltserklaerung - das waere eine eigene Anbindung,
// deshalb wird hier klar abgelehnt statt geraten.
export const NATIONAL_PRODUCT = "V01PAK";
export const DEFAULT_WEIGHT_G = 2000;
export const MIN_WEIGHT_G = 100;
export const MAX_WEIGHT_G = 31_500;

export class DhlError extends Error {
  constructor(code, status = 400, detail = "") {
    super(code);
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

export function dhlReady(env = {}) {
  return Boolean(env.DHL_API_KEY && env.DHL_USER && env.DHL_PASSWORD && env.DHL_BILLING_NUMBER);
}

export function dhlBase(env = {}) {
  return String(env.DHL_ENVIRONMENT || "sandbox").toLowerCase() === "live" ? LIVE_BASE : SANDBOX_BASE;
}

export function weightGrams(value, fallback = DEFAULT_WEIGHT_G) {
  const zahl = Number(value);
  const gewaehlt = Number.isFinite(zahl) && zahl > 0 ? Math.round(zahl) : Math.round(Number(fallback) || DEFAULT_WEIGHT_G);
  return Math.min(MAX_WEIGHT_G, Math.max(MIN_WEIGHT_G, gewaehlt));
}

// DHL erwartet den dreistelligen ISO-Code. Nur Laender, die wirklich
// unterstuetzt werden, stehen hier - ein unbekanntes Land soll auffallen.
const LAENDER = { DE: "DEU", AT: "AUT", CH: "CHE", NL: "NLD", BE: "BEL", FR: "FRA", LU: "LUX" };

export function laendercode(zweistellig) {
  const code = safeText(zweistellig || "DE", 4).trim().toUpperCase();
  return LAENDER[code] || "";
}

function absenderAus(env) {
  return {
    name1: safeText(env.DHL_SHIPPER_NAME || "Joel Bittner - Disorder119", 50),
    addressStreet: safeText(env.DHL_SHIPPER_STREET || "Nelseestraße 25", 50),
    postalCode: safeText(env.DHL_SHIPPER_POSTAL || "63739", 10),
    city: safeText(env.DHL_SHIPPER_CITY || "Aschaffenburg", 40),
    country: "DEU",
    ...(env.MAIL_FROM ? { email: safeText(env.MAIL_FROM, 80) } : {}),
  };
}

function empfaengerAus(kontakt = {}) {
  const name = safeText(kontakt.recipient_name || kontakt.recipientName || "", 50).trim()
    || [safeText(kontakt.given_name || "", 30), safeText(kontakt.surname || "", 30)].filter(Boolean).join(" ").trim();
  const strasse = safeText(kontakt.address_line1 || kontakt.addressLine1 || "", 50).trim();
  const plz = safeText(kontakt.postal_code || kontakt.postalCode || "", 10).trim();
  const ort = safeText(kontakt.city || "", 40).trim();
  const land = laendercode(kontakt.country_code || kontakt.countryCode || "DE");

  const fehlend = [];
  if (!name) fehlend.push("Name");
  if (!strasse) fehlend.push("Strasse");
  if (!plz) fehlend.push("PLZ");
  if (!ort) fehlend.push("Ort");
  if (fehlend.length) {
    throw new DhlError("VERSANDADRESSE_UNVOLLSTAENDIG", 409, fehlend.join(", "));
  }
  if (!land) {
    throw new DhlError("VERSANDLAND_NICHT_UNTERSTUETZT", 409,
      safeText(kontakt.country_code || kontakt.countryCode || "", 4));
  }
  if (land !== "DEU") {
    // Auslandssendungen brauchen ein anderes Produkt und eine
    // Zollinhaltserklaerung. Lieber klar ablehnen als einen Schein erzeugen,
    // der an der Grenze liegen bleibt.
    throw new DhlError("AUSLANDSVERSAND_NICHT_ANGEBUNDEN", 409, land);
  }

  const zusatz = safeText(kontakt.address_line2 || kontakt.addressLine2 || "", 50).trim();
  return {
    name1: name,
    addressStreet: strasse,
    ...(zusatz ? { additionalAddressInformation1: zusatz } : {}),
    postalCode: plz,
    city: ort,
    country: land,
  };
}

export function buildShipmentRequest(env, bestellung = {}, kontakt = {}, optionen = {}) {
  const referenz = safeText(bestellung.order_number || bestellung.orderNumber || bestellung.id || "", 35);
  if (!referenz) throw new DhlError("BESTELLNUMMER_FEHLT", 409);
  return {
    profile: safeText(env.DHL_PROFILE || "STANDARD_GRUPPENPROFIL", 40),
    shipments: [{
      product: NATIONAL_PRODUCT,
      billingNumber: safeText(env.DHL_BILLING_NUMBER, 20),
      refNo: referenz,
      shipper: absenderAus(env),
      consignee: empfaengerAus(kontakt),
      details: {
        weight: { uom: "g", value: weightGrams(optionen.weightG, env.DHL_DEFAULT_WEIGHT_G) },
      },
    }],
  };
}

function basicAuth(env) {
  const roh = `${String(env.DHL_USER)}:${String(env.DHL_PASSWORD)}`;
  const bytes = new TextEncoder().encode(roh);
  let binaer = "";
  for (const byte of bytes) binaer += String.fromCharCode(byte);
  return "Basic " + btoa(binaer);
}

export function ersteSendungAus(antwort) {
  const eintrag = Array.isArray(antwort?.items) ? antwort.items[0] : null;
  const nummer = safeText(eintrag?.shipmentNo || "", 60);
  if (!nummer) {
    // Fehlermeldungen von DHL koennen die Empfaengeradresse zurueckspiegeln.
    // Nur der Statustext wird uebernommen, damit keine Kundenadresse in die
    // Logs laeuft.
    const grund = safeText(eintrag?.sstatus?.title || antwort?.status?.title || "unbekannt", 120);
    throw new DhlError("DHL_ANTWORT_OHNE_SENDUNGSNUMMER", 502, grund);
  }
  return {
    trackingNumber: nummer,
    labelUrl: safeText(eintrag?.label?.url || "", 400) || null,
    labelB64: eintrag?.label?.b64 ? String(eintrag.label.b64) : null,
  };
}

export async function requestLabel(env, anfrage) {
  let antwort;
  try {
    antwort = await fetch(`${dhlBase(env)}/orders?includeDocs=URL`, {
      method: "POST",
      headers: {
        "dhl-api-key": String(env.DHL_API_KEY),
        Authorization: basicAuth(env),
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(anfrage),
    });
  } catch (err) {
    throw new DhlError("DHL_NICHT_ERREICHBAR", 502, safeText(err?.message || "unknown", 80));
  }
  const daten = await antwort.json().catch(() => null);
  if (!antwort.ok) {
    const grund = safeText(daten?.status?.detail || daten?.status?.title || `HTTP ${antwort.status}`, 160);
    throw new DhlError("DHL_ABGELEHNT", antwort.status === 401 || antwort.status === 403 ? 502 : 409, grund);
  }
  return ersteSendungAus(daten);
}

async function vorhandeneSendung(env, orderId) {
  return env.DB.prepare(`SELECT id,tracking_number,carrier,status FROM shipments
    WHERE order_id=? AND tracking_number IS NOT NULL AND tracking_number<>''
    ORDER BY created_at DESC LIMIT 1`).bind(String(orderId)).first();
}

export async function createLabelForOrder(env, orderId, optionen = {}) {
  if (!env?.DB) throw new DhlError("COMMERCE_DATABASE_NOT_CONFIGURED", 503);
  if (!dhlReady(env)) throw new DhlError("DHL_NOT_CONFIGURED", 503);

  const bestellung = await env.DB.prepare(`SELECT id,order_number,status FROM commerce_orders
    WHERE id=? OR order_number=? LIMIT 1`).bind(String(orderId), String(orderId)).first();
  if (!bestellung) throw new DhlError("BESTELLUNG_NICHT_GEFUNDEN", 404);
  if (!["PAID", "PREPARING", "SHIPPED"].includes(String(bestellung.status || "").toUpperCase())) {
    throw new DhlError("BESTELLUNG_NICHT_VERSANDFERTIG", 409, String(bestellung.status || ""));
  }

  // Der wichtigste Zweig: ein zweiter Klick darf keinen zweiten Schein kaufen.
  const vorhanden = await vorhandeneSendung(env, bestellung.id);
  if (vorhanden?.tracking_number) {
    return {
      created: false,
      trackingNumber: String(vorhanden.tracking_number),
      carrier: String(vorhanden.carrier || "DHL"),
      shipmentId: String(vorhanden.id),
    };
  }

  const kontakt = await env.DB.prepare(`SELECT recipient_name,given_name,surname,
      address_line1,address_line2,postal_code,city,country_code
    FROM order_contact_snapshots WHERE order_id=? LIMIT 1`).bind(String(bestellung.id)).first();
  if (!kontakt) throw new DhlError("VERSANDADRESSE_FEHLT", 409);

  const anfrage = buildShipmentRequest(env, bestellung, kontakt, optionen);
  const schein = await requestLabel(env, anfrage);

  const jetzt = new Date().toISOString();
  const shipmentId = crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO shipments
    (id,order_id,carrier,service,tracking_number,status,created_at,updated_at)
    VALUES (?,?,'DHL',?,?,'LABEL_CREATED',?,?)`)
    .bind(shipmentId, String(bestellung.id), NATIONAL_PRODUCT, schein.trackingNumber, jetzt, jetzt).run();
  await env.DB.prepare(`INSERT OR IGNORE INTO audit_events
    (id,actor_type,entity_type,entity_id,event_type,request_id,metadata_json,created_at)
    VALUES (?,'ADMIN','shipment',?,'DHL_LABEL_CREATED',?,?,?)`)
    .bind(crypto.randomUUID(), shipmentId, safeText(optionen.requestId || "", 120),
      JSON.stringify({ orderId: String(bestellung.id), carrier: "DHL", product: NATIONAL_PRODUCT }), jetzt)
    .run();

  return {
    created: true,
    trackingNumber: schein.trackingNumber,
    carrier: "DHL",
    shipmentId,
    labelUrl: schein.labelUrl,
  };
}

// ---------------------------------------------------------------------------
// Admin-Zugang
// ---------------------------------------------------------------------------

const ADMIN_ORIGINS = Object.freeze([
  "https://admin.disorder119.com",
  "http://localhost:8765",
  "http://127.0.0.1:8765",
]);

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
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
  if (origin && ADMIN_ORIGINS.includes(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

function json(daten, status = 200, origin = null) {
  return new Response(JSON.stringify(daten), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...securityHeaders(),
      ...corsHeaders(origin),
    },
  });
}

async function digest(value) {
  const bytes = new TextEncoder().encode(String(value || ""));
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
}

async function tokenEquals(left, right) {
  if (!left || !right) return false;
  const [a, b] = await Promise.all([digest(left), digest(right)]);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export function istVersandRoute(url) {
  return url.pathname.startsWith("/admin/versand/");
}

export async function handleVersand(request, env, url, reqId = crypto.randomUUID(), origin = null) {
  try {
    if (request.method === "OPTIONS") {
      if (origin && !ADMIN_ORIGINS.includes(origin)) {
        return new Response(null, { status: 403, headers: securityHeaders() });
      }
      return new Response(null, { status: 204, headers: { ...securityHeaders(), ...corsHeaders(origin) } });
    }
    if (origin && !ADMIN_ORIGINS.includes(origin)) throw new DhlError("ORIGIN_NOT_ALLOWED", 403);
    if (request.method !== "POST") throw new DhlError("METHOD_NOT_ALLOWED", 405);
    // Einen Versandschein zu kaufen ist eine Schreibaktion, deshalb der
    // Schreib-Token und nicht der Lese-Token.
    if (!env.ADMIN_TOKEN) throw new DhlError("ADMIN_NOT_CONFIGURED", 503);
    const uebergeben = String(request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
    if (!(await tokenEquals(uebergeben, env.ADMIN_TOKEN))) throw new DhlError("UNAUTHORIZED", 401);

    const treffer = /^\/admin\/versand\/([^/]+)\/label$/.exec(url.pathname.replace(/\/+$/, ""));
    if (!treffer) throw new DhlError("NOT_FOUND", 404);

    let koerper = {};
    try { koerper = (await request.json()) || {}; } catch { koerper = {}; }
    const ergebnis = await createLabelForOrder(env, decodeURIComponent(treffer[1]), {
      weightG: koerper.gewichtGramm,
      requestId: reqId,
    });
    return json({ ok: true, ...ergebnis, requestId: reqId }, 200, origin);
  } catch (err) {
    if (err instanceof DhlError) {
      return json({ error: err.code, detail: err.detail || undefined, requestId: reqId }, err.status, origin);
    }
    console.error(JSON.stringify({
      level: "error",
      event: "dhl_label_error",
      requestId: reqId,
      message: safeText(err?.message || "unknown", 180),
    }));
    return json({ error: "INTERNAL_DHL_ERROR", requestId: reqId }, 500, origin);
  }
}

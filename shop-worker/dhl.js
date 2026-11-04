// DHL-Versandmarke aus dem Geschaeftskundenvertrag (Parcel DE Shipping API v2).
//
// Gegenstueck zu dhl-qr.js (Online-Frankierung fuer Privatkunden, Bezahlen auf
// dhl.de): hier erzeugt die Schnittstelle die Marke direkt als PDF, DHL rechnet
// monatlich ueber den Vertrag ab. Dafuer braucht es den Vertrag (Kundennummer
// EKP, Teilnahme je Verfahren) und einen Benutzer im Post & DHL
// Geschaeftskundenportal (Secrets DHL_USER / DHL_PASSWORD), dazu den
// API-Schluessel der App im Entwicklerportal (DHL_API_KEY, Produkt "Parcel DE
// Shipping" muss der App zugeordnet sein).
//
// Eine erzeugte Marke kostet echtes Geld und laesst sich nur bis zum
// Tagesabschluss stornieren. Deshalb ist die wichtigste Eigenschaft hier nicht
// die Anbindung selbst, sondern dass ein zweiter Aufruf fuer dieselbe
// Bestellung keine zweite Marke erzeugt.
//
// Produkte: V01PAK (DHL Paket, Deutschland), V62KP (DHL Kleinpaket bis 1 kg,
// Deutschland, nur auf ausdrueckliche Wahl), V53WPAK (DHL Paket International,
// EU ohne Zoll). Abrechnungsnummer = EKP (10) + Verfahren (2) + Teilnahme (2).
//
// Automatik (DHL_AUTO_MARKE = "an"): der Cron erzeugt fuer jede bezahlte
// Bestellung ohne Sendung die Marke von selbst (dhlAutoMarken) - dabei wird die
// reservierte PayPal-Zahlung eingezogen (zahlung.js). Fehler landen im Protokoll,
// die Bestellung bleibt im Admin von Hand versendbar.
//
// Ohne Zugangsdaten passiert nichts: der Worker meldet DHL_NOT_CONFIGURED, und
// der Versand laeuft weiter ueber die QR-Marke (dhl-qr.js) oder das DHL-Portal
// mit haendisch eingetragener Sendungsnummer.
import { safeText } from "./commerce-core.js";
import { versandSperre } from "./erstattung-auftrag.js";
import { ZahlungFehler, zahlungSicherstellen } from "./zahlung.js";
import { iso3, plzNormalisieren } from "./laender.js";
import { zoneFuerLand } from "./versand-config.js";
import { dhlText, splitStreet } from "./dhl-qr.js";

const SANDBOX_BASE = "https://api-sandbox.dhl.com/parcel/de/shipping/v2";
const LIVE_BASE = "https://api-eu.dhl.com/parcel/de/shipping/v2";

export const PRODUKTE = Object.freeze({
  V01PAK: Object.freeze({ verfahren: "01", name: "DHL Paket", zone: "DE", maxG: 31_500 }),
  V62KP: Object.freeze({ verfahren: "62", name: "DHL Kleinpaket", zone: "DE", maxG: 1_000 }),
  V53WPAK: Object.freeze({ verfahren: "53", name: "DHL Paket International", zone: "EU", maxG: 31_500 }),
});
export const NATIONAL_PRODUCT = "V01PAK";
export const DEFAULT_WEIGHT_G = 2000;
export const MIN_WEIGHT_G = 100;
export const MAX_WEIGHT_G = 31_500;
// Gewicht nach Paketklasse der Kasse (versand-config.js), wenn der Admin nichts
// anderes eintraegt: die Klasse ist die Obergrenze, das Teil wiegt weniger.
const KLASSEN_GEWICHT_G = Object.freeze({ S: 1500, M: 4000, L: 8000, XL: 15_000, XXL: 25_000 });

export class DhlError extends Error {
  constructor(code, status = 400, detail = "") {
    super(code);
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

export function dhlReady(env = {}) {
  return Boolean(env.DHL_API_KEY && env.DHL_USER && env.DHL_PASSWORD
    && (/^\d{10}$/.test(String(env.DHL_EKP || "")) || /^[A-Za-z0-9]{14}$/.test(String(env.DHL_BILLING_NUMBER || ""))));
}

export function dhlBase(env = {}) {
  return String(env.DHL_ENVIRONMENT || "sandbox").toLowerCase() === "live" ? LIVE_BASE : SANDBOX_BASE;
}

export function autoMarkeAn(env = {}) {
  return String(env.DHL_AUTO_MARKE || "aus").toLowerCase() === "an";
}

export function weightGrams(value, fallback = DEFAULT_WEIGHT_G) {
  const zahl = Number(value);
  const gewaehlt = Number.isFinite(zahl) && zahl > 0 ? Math.round(zahl) : Math.round(Number(fallback) || DEFAULT_WEIGHT_G);
  return Math.min(MAX_WEIGHT_G, Math.max(MIN_WEIGHT_G, gewaehlt));
}

// Zone der Kasse: "DE", "EU" (ohne Zoll) - alles andere braucht Zollpapiere und
// laeuft nicht ueber diese Anbindung.
export function zoneAus(land) {
  const code = String(land || "DE").trim().toUpperCase();
  if (code === "DE") return "DE";
  return zoneFuerLand(code) ? "EU" : "";
}

// DHL erwartet den dreistelligen ISO-Code; nur Laender der Kasse.
export function laendercode(zweistellig) {
  const code = safeText(zweistellig || "DE", 4).trim().toUpperCase();
  return zoneAus(code) ? iso3(code) : "";
}

// Abrechnungsnummer: 10-stellige Kundennummer (EKP) + Verfahren des Produkts +
// Teilnahme (meist "01"). Ersatzweise eine fest hinterlegte 14-stellige Nummer,
// wenn ihr Verfahren zum Produkt passt.
export function abrechnungsnummer(env, produkt) {
  const p = PRODUKTE[produkt];
  if (!p) throw new DhlError("PRODUKT_UNBEKANNT", 400, safeText(produkt, 10));
  const ekp = safeText(env.DHL_EKP || "", 10);
  if (/^\d{10}$/.test(ekp)) {
    const teilnahme = safeText(env.DHL_TEILNAHME || "01", 2).toUpperCase();
    return ekp + p.verfahren + (/^[A-Z0-9]{2}$/.test(teilnahme) ? teilnahme : "01");
  }
  const fest = safeText(env.DHL_BILLING_NUMBER || "", 14);
  if (/^[A-Za-z0-9]{14}$/.test(fest) && fest.slice(10, 12) === p.verfahren) return fest;
  throw new DhlError("ABRECHNUNGSNUMMER_FEHLT", 503, produkt);
}

export function produktFuer(land, { produkt = "", gewichtG = DEFAULT_WEIGHT_G } = {}) {
  const zone = zoneAus(land);
  if (!zone) {
    const code = safeText(land || "", 4).toUpperCase();
    // Nur Laender der Kasse (laender.js) - Schweiz, UK, USA brauchen Zollpapiere und laufen auf Anfrage.
    throw new DhlError("VERSANDLAND_NICHT_UNTERSTUETZT", 409, code);
  }
  if (zone === "EU") return "V53WPAK";
  const wunsch = safeText(produkt || "", 10).toUpperCase();
  if (wunsch === "V62KP") {
    if (gewichtG > PRODUKTE.V62KP.maxG) throw new DhlError("KLEINPAKET_ZU_SCHWER", 409, `${gewichtG} g`);
    return "V62KP";
  }
  if (wunsch && wunsch !== "V01PAK") throw new DhlError("PRODUKT_NICHT_FUER_LAND", 409, `${wunsch} → ${zone}`);
  return "V01PAK";
}

function absenderAus(env) {
  const { street, streetNumber } = splitStreet(env.DHL_SHIPPER_STREET || "Nelseestraße 25");
  return {
    name1: safeText(env.DHL_SHIPPER_NAME || "Joel Bittner - Disorder119", 50),
    addressStreet: safeText(street, 50),
    ...(streetNumber ? { addressHouse: safeText(streetNumber, 10) } : {}),
    postalCode: safeText(env.DHL_SHIPPER_POSTAL || "63739", 10),
    city: safeText(env.DHL_SHIPPER_CITY || "Aschaffenburg", 40),
    country: "DEU",
    ...(env.MAIL_FROM ? { email: safeText(env.MAIL_FROM, 80) } : {}),
  };
}

const ABHOLORT = /^(packstation|postfiliale)$/i;

// Empfaenger im Format der Parcel-DE-Shipping-API. Packstation/Postfiliale
// (nur Deutschland) nehmen lockerID bzw. retailID und die Postnummer der
// Kundin, die Haustuer Strasse + Hausnummer. EU: PLZ in der Schreibweise des
// Landes, Land als ISO-3.
export function empfaengerAus(kontakt = {}) {
  const name = dhlText(kontakt.recipient_name || kontakt.recipientName || "", 50).trim()
    || [dhlText(kontakt.given_name || "", 30), dhlText(kontakt.surname || "", 30)].filter(Boolean).join(" ").trim();
  const zeile = dhlText(kontakt.address_line1 || kontakt.addressLine1 || "", 60).trim();
  const plzRoh = dhlText(kontakt.postal_code || kontakt.postalCode || "", 12).trim();
  const ort = dhlText(kontakt.city || "", 40).trim();
  const landCode = String(kontakt.country_code || kontakt.countryCode || "DE").trim().toUpperCase();
  const land = laendercode(landCode);

  const fehlend = [];
  if (!name) fehlend.push("Name");
  if (!zeile) fehlend.push("Strasse");
  if (!plzRoh) fehlend.push("PLZ");
  if (!ort) fehlend.push("Ort");
  if (fehlend.length) throw new DhlError("VERSANDADRESSE_UNVOLLSTAENDIG", 409, fehlend.join(", "));
  if (!land) {
    throw new DhlError("VERSANDLAND_NICHT_UNTERSTUETZT", 409, safeText(landCode, 4));
  }

  const zusatz = dhlText(kontakt.address_line2 || kontakt.addressLine2 || "", 50).trim();
  const { street, streetNumber } = splitStreet(zeile);
  if (land === "DEU" && ABHOLORT.test(street)) {
    const postnummer = String((/\b(\d{6,10})\b/.exec(zusatz.replace(/(\d)\s+(?=\d)/g, "$1")) || [])[1] || "");
    if (!/^\d{1,6}$/.test(streetNumber)) throw new DhlError("ABHOLORT_NUMMER_FEHLT", 409, street);
    const packstation = /^packstation$/i.test(street);
    if (packstation && !postnummer) throw new DhlError("POSTNUMMER_FEHLT", 409, "Packstation");
    return {
      name1: name,
      ...(postnummer ? { postNumber: postnummer } : {}),
      ...(packstation ? { lockerID: streetNumber } : { retailID: streetNumber }),
      postalCode: dhlText(plzRoh, 5),
      city: ort,
      country: "DEU",
    };
  }
  const plz = land === "DEU" ? dhlText(plzRoh, 5) : (plzNormalisieren(landCode, plzRoh) || plzRoh);
  return {
    name1: name,
    addressStreet: street,
    ...(streetNumber ? { addressHouse: streetNumber } : {}),
    ...(zusatz ? { additionalAddressInformation1: zusatz } : {}),
    postalCode: plz,
    city: ort,
    country: land,
  };
}

export function buildShipmentRequest(env, bestellung = {}, kontakt = {}, optionen = {}) {
  const referenz = safeText(bestellung.order_number || bestellung.orderNumber || bestellung.id || "", 35);
  if (!referenz) throw new DhlError("BESTELLNUMMER_FEHLT", 409);
  const land = String(kontakt.country_code || kontakt.countryCode || "DE").trim().toUpperCase();
  const consignee = empfaengerAus(kontakt);
  const gewicht = weightGrams(optionen.weightG, optionen.fallbackWeightG || env.DHL_DEFAULT_WEIGHT_G);
  const produkt = produktFuer(land, { produkt: optionen.produkt, gewichtG: gewicht });
  return {
    profile: safeText(env.DHL_PROFILE || "STANDARD_GRUPPENPROFIL", 40),
    shipments: [{
      product: produkt,
      billingNumber: abrechnungsnummer(env, produkt),
      refNo: referenz,
      shipper: absenderAus(env),
      consignee,
      details: {
        weight: { uom: "g", value: gewicht },
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

function apiHeaders(env, mitBody = true) {
  return {
    "dhl-api-key": String(env.DHL_API_KEY),
    Authorization: basicAuth(env),
    ...(mitBody ? { "Content-Type": "application/json" } : {}),
    Accept: "application/json",
  };
}

export function ersteSendungAus(antwort) {
  const eintrag = Array.isArray(antwort?.items) ? antwort.items[0] : null;
  const nummer = safeText(eintrag?.shipmentNo || "", 60);
  if (!nummer) {
    // Fehlermeldungen von DHL koennen die Empfaengeradresse zurueckspiegeln.
    // Nur Statustext und Validierungshinweise werden uebernommen, damit keine
    // Kundenadresse in die Logs laeuft.
    const hinweise = (Array.isArray(eintrag?.validationMessages) ? eintrag.validationMessages : [])
      .map(v => safeText(v?.validationMessage || v?.property || "", 80)).filter(Boolean).slice(0, 3);
    const grund = safeText(eintrag?.sstatus?.title || antwort?.status?.title || "unbekannt", 120);
    throw new DhlError("DHL_ANTWORT_OHNE_SENDUNGSNUMMER", 502, hinweise.length ? `${grund}: ${hinweise.join("; ")}` : grund);
  }
  const b64 = eintrag?.label?.b64 ? String(eintrag.label.b64) : null;
  return {
    trackingNumber: nummer,
    labelUrl: safeText(eintrag?.label?.url || "", 400) || null,
    // Nur ein echtes PDF (Base64 "JVBERi0" = "%PDF-") wird aufgehoben.
    labelB64: b64 && b64.startsWith("JVBERi0") && b64.length < 4_000_000 ? b64 : null,
  };
}

export async function requestLabel(env, anfrage) {
  const format = safeText(env.DHL_DRUCKFORMAT || "A4", 20);
  let antwort;
  try {
    antwort = await fetch(`${dhlBase(env)}/orders?includeDocs=include&docFormat=PDF&printFormat=${encodeURIComponent(format)}`, {
      method: "POST",
      headers: apiHeaders(env),
      body: JSON.stringify(anfrage),
    });
  } catch (err) {
    throw new DhlError("DHL_NICHT_ERREICHBAR", 502, safeText(err?.message || "unknown", 80));
  }
  const daten = await antwort.json().catch(() => null);
  if (!antwort.ok) {
    // 200/207: Sendung angelegt (evtl. mit Warnung); alles andere: nichts angelegt.
    const hinweise = (Array.isArray(daten?.items?.[0]?.validationMessages) ? daten.items[0].validationMessages : [])
      .map(v => safeText(v?.validationMessage || "", 80)).filter(Boolean).slice(0, 3);
    const grund = safeText(daten?.status?.detail || daten?.status?.title || daten?.items?.[0]?.sstatus?.title || `HTTP ${antwort.status}`, 160);
    throw new DhlError("DHL_ABGELEHNT", antwort.status === 401 || antwort.status === 403 ? 502 : 409,
      hinweise.length ? `${grund}: ${hinweise.join("; ")}` : grund);
  }
  return ersteSendungAus(daten);
}

// Storno bei DHL: geht nur bis zum Tagesabschluss (Manifest). Danach meldet
// DHL einen Fehler, und die Marke bleibt berechnet.
export async function cancelLabel(env, shipmentNo) {
  const nummer = safeText(shipmentNo, 60);
  if (!nummer) throw new DhlError("SENDUNGSNUMMER_FEHLT", 400);
  let antwort;
  try {
    antwort = await fetch(`${dhlBase(env)}/orders?profile=${encodeURIComponent(safeText(env.DHL_PROFILE || "STANDARD_GRUPPENPROFIL", 40))}&shipment=${encodeURIComponent(nummer)}`, {
      method: "DELETE",
      headers: apiHeaders(env, false),
    });
  } catch (err) {
    throw new DhlError("DHL_NICHT_ERREICHBAR", 502, safeText(err?.message || "unknown", 80));
  }
  const daten = await antwort.json().catch(() => null);
  const status = safeText(daten?.items?.[0]?.sstatus?.statusCode ?? daten?.items?.[0]?.sstatus?.status ?? "", 10);
  if (!antwort.ok || (status && !/^2/.test(status))) {
    const grund = safeText(daten?.items?.[0]?.sstatus?.title || daten?.status?.detail || daten?.status?.title || `HTTP ${antwort.status}`, 160);
    throw new DhlError("DHL_STORNO_ABGELEHNT", 409, grund);
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Bestellung lesen, Marke anlegen, ansehen, stornieren
// ---------------------------------------------------------------------------

async function bestellungLesen(env, orderId) {
  const bestellung = await env.DB.prepare(`SELECT o.id,o.order_number,o.status,
      c.recipient_name,c.given_name,c.surname,c.address_line1,c.address_line2,c.postal_code,c.city,c.country_code,
      v.paket AS versand_paket,v.zustellart AS versand_zustellart
    FROM commerce_orders o
    LEFT JOIN order_contact_snapshots c ON c.order_id=o.id
    LEFT JOIN order_versand v ON v.order_id=o.id
    WHERE o.id=? OR o.order_number=? LIMIT 1`).bind(String(orderId), String(orderId)).first();
  if (!bestellung) throw new DhlError("BESTELLUNG_NICHT_GEFUNDEN", 404);
  return bestellung;
}

async function vorhandeneSendung(env, orderId) {
  return env.DB.prepare(`SELECT id,tracking_number,carrier,status FROM shipments
    WHERE order_id=? AND tracking_number IS NOT NULL AND tracking_number<>''
    ORDER BY created_at DESC LIMIT 1`).bind(String(orderId)).first();
}

async function letzteMarke(env, orderId) {
  return env.DB.prepare(`SELECT * FROM dhl_vertragsmarken WHERE order_id=? ORDER BY created_at DESC LIMIT 1`)
    .bind(String(orderId)).first().catch(() => null);
}

export function markeView(marke, sendung = null) {
  if (!marke) {
    return sendung?.tracking_number
      ? { state: "FREMD", sendungsnummer: String(sendung.tracking_number), carrier: String(sendung.carrier || "") }
      : { state: "KEINE" };
  }
  const produkt = PRODUKTE[marke.product] || {};
  return {
    state: String(marke.state),
    sendungsnummer: String(marke.shipment_number),
    produkt: String(marke.product),
    produktName: produkt.name || String(marke.product),
    abrechnungsnummer: String(marke.billing_number),
    gewichtG: marke.weight_g == null ? null : Number(marke.weight_g),
    pdf: marke.label_pdf_b64 ? `data:application/pdf;base64,${marke.label_pdf_b64}` : null,
    pdfLink: marke.label_url || null,
    automatisch: Number(marke.automatisch) === 1,
    erstelltAm: marke.created_at,
    aktualisiertAm: marke.updated_at,
  };
}

export async function markeAnsehen(env, orderId) {
  if (!env?.DB) throw new DhlError("COMMERCE_DATABASE_NOT_CONFIGURED", 503);
  const bestellung = await bestellungLesen(env, orderId);
  const marke = await letzteMarke(env, bestellung.id);
  if (marke && marke.state === "ERSTELLT") return markeView(marke);
  return markeView(null, await vorhandeneSendung(env, bestellung.id));
}

export async function createLabelForOrder(env, orderId, optionen = {}) {
  if (!env?.DB) throw new DhlError("COMMERCE_DATABASE_NOT_CONFIGURED", 503);
  if (!dhlReady(env)) throw new DhlError("DHL_NOT_CONFIGURED", 503);

  const bestellung = await bestellungLesen(env, orderId);
  if (!["PAID", "PREPARING", "SHIPPED"].includes(String(bestellung.status || "").toUpperCase())) {
    throw new DhlError("BESTELLUNG_NICHT_VERSANDFERTIG", 409, String(bestellung.status || ""));
  }

  // Der wichtigste Zweig: ein zweiter Klick darf keine zweite Marke kaufen.
  const marke = await letzteMarke(env, bestellung.id);
  if (marke && marke.state === "ERSTELLT") {
    return { created: false, trackingNumber: String(marke.shipment_number), carrier: "DHL", shipmentId: marke.shipment_id ? String(marke.shipment_id) : null, marke: markeView(marke) };
  }
  const vorhanden = await vorhandeneSendung(env, bestellung.id);
  if (vorhanden?.tracking_number) {
    return {
      created: false,
      trackingNumber: String(vorhanden.tracking_number),
      carrier: String(vorhanden.carrier || "DHL"),
      shipmentId: String(vorhanden.id),
      marke: markeView(null, vorhanden),
    };
  }
  if (!bestellung.address_line1 && !bestellung.recipient_name) throw new DhlError("VERSANDADRESSE_FEHLT", 409);

  // Anfrage zuerst bauen: Adresse, Produkt und Abrechnungsnummer muessen
  // stimmen, bevor irgendetwas eingezogen wird.
  const fallbackWeightG = KLASSEN_GEWICHT_G[String(bestellung.versand_paket || "")] || env.DHL_DEFAULT_WEIGHT_G;
  const anfrage = buildShipmentRequest(env, bestellung, bestellung, { ...optionen, fallbackWeightG });
  const sendung = anfrage.shipments[0];

  // Keine Marke, solange ein Storno oder Widerruf vor dem Versand laeuft - und
  // erst, wenn das Geld eingezogen ist (zahlung.js).
  const sperre = await versandSperre(env.DB, bestellung.id);
  if (sperre) throw new DhlError(sperre.code, 409, sperre.text);
  try {
    await zahlungSicherstellen(env, bestellung.id, crypto.randomUUID(), { anlass: "VERSAND" });
  } catch (err) {
    if (err instanceof ZahlungFehler) throw new DhlError(err.code, err.status, err.text);
    throw err;
  }

  const schein = await requestLabel(env, anfrage);

  const jetzt = new Date().toISOString();
  const shipmentId = crypto.randomUUID();
  const markeId = crypto.randomUUID();
  const produktName = PRODUKTE[sendung.product]?.name || sendung.product;
  const automatisch = optionen.automatisch ? 1 : 0;
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO shipments (id,order_id,carrier,service,tracking_number,status,created_at,updated_at)
      VALUES (?,?,'DHL',?,?,'LABEL_CREATED',?,?)`)
      .bind(shipmentId, String(bestellung.id), produktName, schein.trackingNumber, jetzt, jetzt),
    env.DB.prepare(`INSERT INTO dhl_vertragsmarken
      (id,order_id,shipment_id,shipment_number,product,billing_number,weight_g,label_pdf_b64,label_url,state,automatisch,request_id,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,'ERSTELLT',?,?,?,?)`)
      .bind(markeId, String(bestellung.id), shipmentId, schein.trackingNumber, sendung.product, sendung.billingNumber,
        sendung.details.weight.value, schein.labelB64, schein.labelUrl, automatisch, safeText(optionen.requestId || "", 120), jetzt, jetzt),
    // Bezahlt -> "Wird gepackt": Bestellung und Lagerstueck wechseln gemeinsam,
    // sonst lehnt die Statuspruefung spaeter "Versendet" ab.
    env.DB.prepare("UPDATE commerce_orders SET status='PREPARING',updated_at=? WHERE id=? AND status='PAID'").bind(jetzt, String(bestellung.id)),
    env.DB.prepare(`UPDATE inventory SET status='PREPARING',updated_at=?,version=version+1
      WHERE id IN (SELECT inventory_id FROM order_items WHERE order_id=?) AND status='PAID'`).bind(jetzt, String(bestellung.id)),
    env.DB.prepare(`INSERT OR IGNORE INTO audit_events
      (id,actor_type,entity_type,entity_id,event_type,request_id,metadata_json,created_at)
      VALUES (?,?,'shipment',?,'DHL_LABEL_CREATED',?,?,?)`)
      .bind(crypto.randomUUID(), automatisch ? "SYSTEM" : "ADMIN", shipmentId, safeText(optionen.requestId || "", 120),
        JSON.stringify({ orderId: String(bestellung.id), carrier: "DHL", product: sendung.product, weightG: sendung.details.weight.value, automatisch: Boolean(automatisch), pdf: Boolean(schein.labelB64) }), jetzt),
  ]);

  return {
    created: true,
    trackingNumber: schein.trackingNumber,
    carrier: "DHL",
    shipmentId,
    labelUrl: schein.labelUrl,
    marke: markeView({
      id: markeId, shipment_number: schein.trackingNumber, product: sendung.product, billing_number: sendung.billingNumber,
      weight_g: sendung.details.weight.value, label_pdf_b64: schein.labelB64, label_url: schein.labelUrl, state: "ERSTELLT",
      automatisch, created_at: jetzt, updated_at: jetzt,
    }),
  };
}

export async function cancelLabelForOrder(env, orderId, optionen = {}) {
  if (!env?.DB) throw new DhlError("COMMERCE_DATABASE_NOT_CONFIGURED", 503);
  if (!dhlReady(env)) throw new DhlError("DHL_NOT_CONFIGURED", 503);
  const bestellung = await bestellungLesen(env, orderId);
  const marke = await letzteMarke(env, bestellung.id);
  if (!marke || marke.state !== "ERSTELLT") throw new DhlError("KEINE_MARKE", 409);
  const sendung = await env.DB.prepare("SELECT id,status FROM shipments WHERE id=? OR (order_id=? AND tracking_number=?) LIMIT 1")
    .bind(String(marke.shipment_id || ""), String(bestellung.id), String(marke.shipment_number)).first();
  if (sendung && !["PENDING", "LABEL_CREATED"].includes(String(sendung.status))) throw new DhlError("SCHON_VERSENDET", 409, String(sendung.status));

  await cancelLabel(env, marke.shipment_number);

  const jetzt = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare("UPDATE dhl_vertragsmarken SET state='STORNIERT',updated_at=? WHERE id=?").bind(jetzt, marke.id),
    ...(sendung ? [env.DB.prepare("UPDATE shipments SET tracking_number=NULL,status='PENDING',updated_at=? WHERE id=?").bind(jetzt, sendung.id)] : []),
    env.DB.prepare(`INSERT OR IGNORE INTO audit_events
      (id,actor_type,entity_type,entity_id,event_type,request_id,metadata_json,created_at)
      VALUES (?,'ADMIN','shipment',?,'DHL_LABEL_STORNIERT',?,?,?)`)
      .bind(crypto.randomUUID(), String(marke.shipment_id || marke.id), safeText(optionen.requestId || "", 120),
        JSON.stringify({ orderId: String(bestellung.id), shipmentNo: String(marke.shipment_number), product: String(marke.product) }), jetzt),
  ]);
  return { ok: true, storniert: String(marke.shipment_number), marke: markeView(null, null) };
}

// ---------------------------------------------------------------------------
// Automatik: bezahlte Bestellungen ohne Sendung bekommen ihre Marke von selbst
// (Cron alle 15 Minuten und beim Oeffnen der Admin-App). Nur Haustuer-, Pack-
// station- und Filialadressen in DE/EU; jede Bestellung hoechstens einmal pro
// Lauf, ein Fehler je Bestellung steht im Protokoll und blockiert nicht die
// anderen. Nach einem Fehler wird nach 6 Stunden erneut versucht - laengstens
// drei Tage, dann bleibt es beim Admin.
// ---------------------------------------------------------------------------

export const AUTO_MARKE_WARTEZEIT_MS = 6 * 3_600_000;
export const AUTO_MARKE_HOECHSTALTER_MS = 3 * 24 * 3_600_000;

export async function dhlAutoMarken(env, reqId = crypto.randomUUID(), now = Date.now()) {
  if (!env?.DB || !dhlReady(env) || !autoMarkeAn(env)) return { uebersprungen: true };
  const db = env.DB;
  const seit = new Date(now - AUTO_MARKE_HOECHSTALTER_MS).toISOString();
  const offene = (await db.prepare(`SELECT o.id,o.order_number,o.created_at FROM commerce_orders o
      WHERE o.status='PAID' AND o.created_at>=?
        AND NOT EXISTS (SELECT 1 FROM shipments s WHERE s.order_id=o.id AND s.tracking_number IS NOT NULL AND s.tracking_number<>'')
        AND NOT EXISTS (SELECT 1 FROM dhl_vertragsmarken m WHERE m.order_id=o.id AND m.state='ERSTELLT')
      ORDER BY o.created_at ASC LIMIT 20`).bind(seit).all()).results || [];
  const ergebnis = { erzeugt: [], fehler: [], gewartet: 0 };
  for (const bestellung of offene) {
    // Letzter Fehlversuch zu jung? Dann erst spaeter wieder.
    const letzter = await db.prepare(`SELECT created_at FROM audit_events WHERE entity_type='order' AND entity_id=? AND event_type='DHL_AUTO_MARKE_FEHLER'
        ORDER BY created_at DESC LIMIT 1`).bind(String(bestellung.id)).first();
    if (letzter && now - Date.parse(letzter.created_at) < AUTO_MARKE_WARTEZEIT_MS) { ergebnis.gewartet += 1; continue; }
    try {
      const r = await createLabelForOrder(env, bestellung.id, { automatisch: true, requestId: reqId });
      if (r.created) ergebnis.erzeugt.push({ orderId: String(bestellung.id), nummer: r.trackingNumber });
    } catch (err) {
      const code = err instanceof DhlError ? err.code : "INTERNAL";
      const detail = safeText(err instanceof DhlError ? err.detail : err?.message || "", 160);
      ergebnis.fehler.push({ orderId: String(bestellung.id), code, detail });
      console.error(JSON.stringify({ level: "error", event: "dhl_auto_marke_fehler", requestId: reqId, orderId: String(bestellung.id), code, detail }));
      try {
        await db.prepare(`INSERT OR IGNORE INTO audit_events (id,actor_type,entity_type,entity_id,event_type,request_id,metadata_json,created_at)
          VALUES (?,'SYSTEM','order',?,'DHL_AUTO_MARKE_FEHLER',?,?,?)`)
          .bind(crypto.randomUUID(), String(bestellung.id), reqId, JSON.stringify({ code, detail }), new Date(now).toISOString()).run();
      } catch { /* Protokoll ist Beiwerk */ }
    }
  }
  if (ergebnis.erzeugt.length || ergebnis.fehler.length) {
    console.log(JSON.stringify({ level: "info", event: "dhl_auto_marken", requestId: reqId, erzeugt: ergebnis.erzeugt.length, fehler: ergebnis.fehler.length, gewartet: ergebnis.gewartet }));
  }
  return ergebnis;
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
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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

// Stand der Anbindung fuer die Admin-App - ohne Geheimnisse.
export function statusView(env = {}) {
  const ekp = safeText(env.DHL_EKP || "", 10);
  return {
    bereit: dhlReady(env),
    umgebung: dhlBase(env) === LIVE_BASE ? "live" : "sandbox",
    automatisch: autoMarkeAn(env),
    kundennummer: /^\d{10}$/.test(ekp) ? `${ekp.slice(0, 3)}…${ekp.slice(-2)}` : null,
    produkte: Object.entries(PRODUKTE).map(([id, p]) => ({ id, name: p.name, zone: p.zone, maxG: p.maxG })),
    druckformat: safeText(env.DHL_DRUCKFORMAT || "A4", 20),
  };
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
    if (!["GET", "POST"].includes(request.method)) throw new DhlError("METHOD_NOT_ALLOWED", 405);
    // Eine Marke zu kaufen ist eine Schreibaktion, deshalb der Schreib-Token
    // und nicht der Lese-Token (worker-entry.js legt ihn in env.ADMIN_TOKEN).
    if (!env.ADMIN_TOKEN) throw new DhlError("ADMIN_NOT_CONFIGURED", 503);
    const uebergeben = String(request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
    if (!(await tokenEquals(uebergeben, env.ADMIN_TOKEN))) throw new DhlError("UNAUTHORIZED", 401);

    const pfad = url.pathname.replace(/\/+$/, "");
    if (pfad === "/admin/versand/dhl-status" && request.method === "GET") {
      return json({ ok: true, ...statusView(env), requestId: reqId }, 200, origin);
    }
    const treffer = /^\/admin\/versand\/([^/]+)\/label(\/storno)?$/.exec(pfad);
    if (!treffer) throw new DhlError("NOT_FOUND", 404);
    const orderId = decodeURIComponent(treffer[1]);
    if (treffer[2]) {
      if (request.method !== "POST") throw new DhlError("METHOD_NOT_ALLOWED", 405);
      return json({ ok: true, ...(await cancelLabelForOrder(env, orderId, { requestId: reqId })), requestId: reqId }, 200, origin);
    }
    if (request.method === "GET") {
      return json({ ok: true, marke: await markeAnsehen(env, orderId), requestId: reqId }, 200, origin);
    }
    let koerper = {};
    try { koerper = (await request.json()) || {}; } catch { koerper = {}; }
    const ergebnis = await createLabelForOrder(env, orderId, {
      weightG: koerper.gewichtGramm,
      produkt: koerper.produkt,
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

// DHL-Versandmarke als QR-Code - fuer Versender unter 200 Paketen im Jahr.
//
// Nutzt die DHL-Online-Frankierung per Schnittstelle ("Parcel DE Private
// Shipping"). Dafuer braucht es keinen Geschaeftskundenvertrag, nur einen
// kostenlosen Zugang im DHL-Entwicklerportal (Secret DHL_PRIVAT_API_KEY).
//
//   1. Admin-App, Bestellung: "QR-Versandmarke" -> der Server legt bei DHL
//      einen Warenkorb mit fertig ausgefuellter Adresse an.
//   2. Bezahlt wird auf der DHL-Seite (PayPal, Karte ...). Per Schnittstelle
//      geht das bewusst nicht: DHL verlangt die Zahlung im eigenen Frontend.
//   3. Zurueck in der App: bezahlt? -> Sendungsnummer und QR-Code.
//   4. QR an Packstation oder Filiale zeigen, dort wird das Etikett gedruckt.
//
// Die Sendungsnummer landet sofort am Auftrag (Status "Label erstellt").
// "Versendet" setzt du erst nach der Abgabe - dann geht die Versandmail raus.
import { safeText } from "./commerce-core.js";

const ADMIN_ORIGINS = Object.freeze([
  "https://admin.disorder119.com",
  "http://localhost:8765",
  "http://127.0.0.1:8765",
]);

const API = Object.freeze({
  live: "https://api-eu.dhl.com/parcel/de/shipping/of/v1/public",
  sandbox: "https://api-sandbox.dhl.com/parcel/de/shipping/of/v1/public",
});

const PRODUCT_CACHE_MS = 12 * 3_600_000;
let productCache = null;

export class DhlQrError extends Error {
  constructor(code, status = 400, detail = "") {
    super(code);
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

function apiBase(env) {
  return String(env.DHL_PRIVAT_ENVIRONMENT || "sandbox").toLowerCase() === "live" ? API.live : API.sandbox;
}

export function dhlQrReady(env = {}) {
  return Boolean(env.DHL_PRIVAT_API_KEY);
}

// ------------------------------------------------------------------- Adressen

// DHL Online Frankierung nimmt nur Latin-1 und lehnt diese Zeichen ab:
// ? * ^ ! # % $ : { } [ ]. Umlaute sind Latin-1 und bleiben; "ł" oder Emojis
// verlieren wir lieber, als die ganze Marke an der Validierung scheitern zu lassen.
export function dhlText(value, max) {
  let out = "";
  for (const zeichen of String(value || "").normalize("NFC")) {
    if (/[?*^!#%$:{}[\]]/.test(zeichen)) { out += " "; continue; }
    if (zeichen.codePointAt(0) <= 0xff) { out += zeichen; continue; }
    const basis = zeichen.normalize("NFKD").replace(/[̀-ͯ]/g, "");
    if (basis && [...basis].every(c => c.codePointAt(0) <= 0xff)) out += basis;
  }
  return out.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

// "Musterstraße 12a" -> ["Musterstraße", "12a"]. Scheitert die Trennung,
// bleibt die Hausnummer leer - die Admin-App zeigt beide Felder zum Pruefen.
export function splitStreet(line) {
  const text = dhlText(line, 60);
  const match = /^(.*?\D)[\s,]*(\d+\s*[a-zA-Z]?(?:\s*[-/]\s*\d+\s*[a-zA-Z]?)?)$/.exec(text);
  if (!match) return { street: text, streetNumber: "" };
  return { street: match[1].replace(/[\s,]+$/, ""), streetNumber: match[2].replace(/\s+/g, "") };
}

export function senderAddress(env) {
  const { street, streetNumber } = splitStreet(env.DHL_SHIPPER_STREET || "Nelseestraße 25");
  return {
    name2: dhlText(env.DHL_SHIPPER_NAME || "Joel Bittner - Disorder119", 50),
    street,
    streetNumber,
    plz: dhlText(env.DHL_SHIPPER_POSTAL || "63739", 5),
    city: dhlText(env.DHL_SHIPPER_CITY || "Aschaffenburg", 40),
    country: "DEU",
    email: dhlText(env.DHL_SHIPPER_EMAIL || env.MAIL_FROM || "bestellung@disorder119.com", 80),
  };
}

// Vorschlag aus der Bestellung; die Admin-App darf jedes Feld ueberschreiben.
export function receiverAddress(contact = {}, override = {}) {
  const name = override.name ?? (contact.recipient_name
    || [contact.given_name, contact.surname].filter(Boolean).join(" "));
  const split = splitStreet(contact.address_line1 || "");
  const receiver = {
    name2: dhlText(name, 50),
    street: dhlText(override.street ?? split.street, 50),
    streetNumber: dhlText(override.streetNumber ?? split.streetNumber, 10),
    plz: dhlText(override.plz ?? contact.postal_code, 5),
    city: dhlText(override.city ?? contact.city, 40),
    country: "DEU",
  };
  const zusatz = dhlText(override.addressAddition ?? contact.address_line2, 50);
  if (zusatz) receiver.addressAddition1 = zusatz;
  return receiver;
}

export function assertReceiver(receiver, countryCode = "DE") {
  if (String(countryCode || "DE").toUpperCase() !== "DE") {
    throw new DhlQrError("NUR_INLANDSVERSAND", 409, "Die QR-Marke ist für Sendungen innerhalb Deutschlands.");
  }
  const fehlend = [];
  if (!receiver.name2) fehlend.push("Name");
  if (!receiver.street) fehlend.push("Straße");
  if (!receiver.streetNumber) fehlend.push("Hausnummer");
  if (!/^\d{5}$/.test(receiver.plz)) fehlend.push("PLZ");
  if (!receiver.city) fehlend.push("Ort");
  if (fehlend.length) throw new DhlQrError("ADRESSE_UNVOLLSTAENDIG", 409, fehlend.join(", "));
}

// ------------------------------------------------------------------- DHL-API

async function dhl(env, path, { method = "GET", body, accept = "application/json" } = {}) {
  if (!dhlQrReady(env)) throw new DhlQrError("DHL_QR_NICHT_EINGERICHTET", 503);
  const res = await fetch(`${apiBase(env)}${path}`, {
    method,
    headers: {
      "dhl-api-key": env.DHL_PRIVAT_API_KEY,
      Accept: accept,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let detail = "";
    try {
      const problem = await res.json();
      detail = safeText(problem?.detail || problem?.code || "", 200);
    } catch { /* keine lesbare Fehlerantwort */ }
    if (res.status === 401 || res.status === 403) throw new DhlQrError("DHL_ZUGANG_ABGELEHNT", 502, detail);
    if (res.status === 402) throw new DhlQrError("DHL_NICHT_BEZAHLT", 409, detail);
    throw new DhlQrError("DHL_FEHLER", 502, detail || `HTTP ${res.status}`);
  }
  return res;
}

export async function listProducts(env) {
  if (productCache && productCache.until > Date.now() && productCache.base === apiBase(env)) return productCache.products;
  const catalog = await (await dhl(env, "/catalog/current/products")).json();
  const products = Object.entries(catalog?.products || {}).map(([id, product]) => {
    const inland = (product.regions || []).find(r => (r.countries || []).includes("DEU") && !r.unavailable);
    if (!inland) return null;
    const attrs = product.attributes || {};
    return {
      id: safeText(id, 40),
      name: safeText(attrs.displayName?.text || id, 80),
      maxWeightG: Number(attrs.maxWeight || 0) || null,
      tracking: attrs.tracking !== false,
      priceCents: Math.round(Number(inland.price?.amount || 0) * 100) || null,
    };
  }).filter(Boolean).filter(p => p.tracking).sort((a, b) => (a.priceCents || 0) - (b.priceCents || 0));
  productCache = { until: Date.now() + PRODUCT_CACHE_MS, base: apiBase(env), products, defaultProduct: catalog?.defaultProduct || null };
  return products;
}

// --------------------------------------------------------------- Ablauf je Auftrag

function requireDb(env) {
  if (!env.DB) throw new DhlQrError("DATENBANK_FEHLT", 503);
  return env.DB;
}

async function loadOrder(env, orderId) {
  const order = await requireDb(env).prepare(`SELECT o.id,o.order_number,o.status,
      c.recipient_name,c.given_name,c.surname,c.address_line1,c.address_line2,c.postal_code,c.city,c.country_code
    FROM commerce_orders o LEFT JOIN order_contact_snapshots c ON c.order_id=o.id
    WHERE o.id=? LIMIT 1`).bind(safeText(orderId, 80)).first();
  if (!order) throw new DhlQrError("BESTELLUNG_NICHT_GEFUNDEN", 404);
  if (!["PAID", "PREPARING", "SHIPPED"].includes(String(order.status))) {
    throw new DhlQrError("BESTELLUNG_NICHT_VERSANDBEREIT", 409, String(order.status));
  }
  return order;
}

async function latestMark(env, orderId) {
  return requireDb(env).prepare(`SELECT * FROM dhl_qr_marken WHERE order_id=?
    ORDER BY created_at DESC LIMIT 1`).bind(orderId).first();
}

function view(mark) {
  if (!mark) return { state: "KEINE" };
  return {
    state: String(mark.state),
    produkt: mark.product_id,
    preisCents: mark.price_cents == null ? null : Number(mark.price_cents),
    bezahlLink: mark.state === "PAYED" ? null : mark.entry_url,
    sendungsnummer: mark.shipment_number || null,
    qrPng: mark.qr_png_b64 ? `data:image/png;base64,${mark.qr_png_b64}` : null,
    erstelltAm: mark.created_at,
    bezahltAm: mark.paid_at || null,
  };
}

export async function createMark(env, orderId, body = {}) {
  const db = requireDb(env);
  const order = await loadOrder(env, orderId);
  const existing = await latestMark(env, order.id);
  if (existing?.state === "PAYED") throw new DhlQrError("MARKE_SCHON_BEZAHLT", 409);

  const produkt = safeText(body.produkt, 40);
  if (!/^[A-Z0-9.]{3,40}$/.test(produkt)) throw new DhlQrError("PRODUKT_FEHLT", 400);
  const receiver = receiverAddress(order, body.empfaenger || {});
  assertReceiver(receiver, order.country_code);

  const response = await dhl(env, "/shopping-carts/pre-paid", {
    method: "POST",
    body: {
      shoppingcart: {
        confirmation: { email: senderAddress(env).email },
        items: [{
          type: "ShipmentItem",
          product: { id: produkt },
          address: { sender: senderAddress(env), receiver },
        }],
      },
    },
  });
  const cart = (await response.json())?.shoppingcart || {};
  const cartId = safeText(cart.shoppingCartId, 12);
  const entryUrl = String(cart.download?.entryUrl || "");
  if (!/^[A-Za-z0-9]{12}$/.test(cartId) || !/^https:\/\/[a-z0-9.-]*dhl\.(de|com)\//.test(entryUrl)) {
    throw new DhlQrError("DHL_ANTWORT_UNGUELTIG", 502);
  }
  const price = (cart.items?.[0]?.prices || []).reduce((sum, p) => sum + Math.round(Number(p.amount || 0) * 100), 0);
  const now = new Date().toISOString();
  // Ein offener, unbezahlter Warenkorb wird ersetzt - bezahlt ist nur einer.
  await db.batch([
    db.prepare("UPDATE dhl_qr_marken SET state='ERSETZT',updated_at=? WHERE order_id=? AND state<>'PAYED'").bind(now, order.id),
    db.prepare(`INSERT INTO dhl_qr_marken (id,order_id,cart_id,product_id,entry_url,state,price_cents,created_at,updated_at)
      VALUES (?,?,?,?,?,'PREPAID',?,?,?)`).bind(crypto.randomUUID(), order.id, cartId, produkt, entryUrl, price || null, now, now),
  ]);
  return view(await latestMark(env, order.id));
}

function toBase64(buffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export async function refreshMark(env, orderId) {
  const db = requireDb(env);
  const mark = await latestMark(env, safeText(orderId, 80));
  if (!mark || mark.state === "ERSETZT") return view(null);
  if (mark.state === "PAYED" && mark.qr_png_b64) return view(mark);

  const now = new Date().toISOString();
  if (mark.state !== "PAYED") {
    const cart = (await (await dhl(env, `/shopping-carts/${encodeURIComponent(mark.cart_id)}`)).json())?.shoppingcart || {};
    const state = safeText(cart.state, 20);
    if (state !== "PAYED") {
      if (state && state !== mark.state) {
        await db.prepare("UPDATE dhl_qr_marken SET state=?,updated_at=? WHERE id=?").bind(state, now, mark.id).run();
      }
      return view({ ...mark, state: state || mark.state });
    }
    const item = (cart.items || []).find(x => x?.shipmentNumber) || {};
    const shipmentNumber = safeText(item.shipmentNumber, 40);
    if (!/^[A-Za-z0-9]{8,40}$/.test(shipmentNumber)) throw new DhlQrError("DHL_ANTWORT_UNGUELTIG", 502);
    await db.prepare(`UPDATE dhl_qr_marken SET state='PAYED',shipment_number=?,pak_id=?,paid_at=?,updated_at=? WHERE id=?`)
      .bind(shipmentNumber, safeText(item.pakId, 9) || null, now, now, mark.id).run();
    await attachTracking(env, mark.order_id, shipmentNumber, now);
    mark.state = "PAYED";
    mark.shipment_number = shipmentNumber;
    mark.paid_at = now;
  }

  // QR einmal holen und aufheben - er aendert sich nicht mehr.
  const png = await (await dhl(env, `/labels/${encodeURIComponent(mark.shipment_number)}/qr-code`, { accept: "image/png" })).arrayBuffer();
  if (png.byteLength < 100 || png.byteLength > 200_000) throw new DhlQrError("DHL_ANTWORT_UNGUELTIG", 502);
  const b64 = toBase64(png);
  await db.prepare("UPDATE dhl_qr_marken SET qr_png_b64=?,updated_at=? WHERE id=?").bind(b64, now, mark.id).run();
  return view({ ...mark, qr_png_b64: b64 });
}

// Sendungsnummer an den Auftrag haengen, noch ohne "Versendet": abgegeben ist
// das Paket erst an der Packstation. Die Versandmail kommt mit dem Statuswechsel.
async function attachTracking(env, orderId, trackingNumber, now) {
  const db = requireDb(env);
  const shipment = await db.prepare("SELECT id,status FROM shipments WHERE order_id=? ORDER BY created_at DESC LIMIT 1").bind(orderId).first();
  if (shipment) {
    await db.prepare(`UPDATE shipments SET carrier='DHL',service='Online-Frankierung',tracking_number=?,
        status=CASE WHEN status='PENDING' THEN 'LABEL_CREATED' ELSE status END,updated_at=? WHERE id=?`)
      .bind(trackingNumber, now, shipment.id).run();
  } else {
    await db.prepare(`INSERT INTO shipments (id,order_id,carrier,service,tracking_number,status,created_at,updated_at)
      VALUES (?,?,'DHL','Online-Frankierung',?,'LABEL_CREATED',?,?)`)
      .bind(crypto.randomUUID(), orderId, trackingNumber, now, now).run();
  }
  // Bezahlt -> "Wird gepackt": Bestellung und Lagerstueck wechseln gemeinsam,
  // sonst lehnt die Statuspruefung spaeter "Versendet" ab (PAID -> SHIPPED
  // ist kein erlaubter Schritt).
  await db.batch([
    db.prepare("UPDATE commerce_orders SET status='PREPARING',updated_at=? WHERE id=? AND status='PAID'").bind(now, orderId),
    db.prepare(`UPDATE inventory SET status='PREPARING',updated_at=?,version=version+1
      WHERE id IN (SELECT inventory_id FROM order_items WHERE order_id=?) AND status='PAID'`).bind(now, orderId),
    db.prepare(`INSERT INTO audit_events (id,actor_type,entity_type,entity_id,event_type,request_id,metadata_json,created_at)
      VALUES (?,'ADMIN','order',?,'DHL_QR_MARKE_BEZAHLT',NULL,?,?)`)
      .bind(crypto.randomUUID(), orderId, JSON.stringify({ tracking: true }), now),
  ]);
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

export function isDhlQrRoute(url) {
  const path = url.pathname.replace(/\/+$/, "");
  return path === "/admin/versand/dhl-produkte" || /^\/admin\/versand\/[^/]+\/qr$/.test(path);
}

export async function handleDhlQr(request, env, url, reqId = crypto.randomUUID(), origin = null) {
  try {
    if (request.method === "OPTIONS") {
      if (origin && !ADMIN_ORIGINS.includes(origin)) return new Response(null, { status: 403, headers: headers(null) });
      return new Response(null, { status: 204, headers: headers(origin) });
    }
    if (origin && !ADMIN_ORIGINS.includes(origin)) throw new DhlQrError("ORIGIN_NOT_ALLOWED", 403);
    // Wie alle Admin-Module: worker-entry.js hat die Berechtigung schon
    // geprueft und den Schluessel dieser Anfrage in env.ADMIN_TOKEN gelegt.
    const supplied = String(request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
    if (!env.ADMIN_TOKEN || !(await tokenEquals(supplied, env.ADMIN_TOKEN))) throw new DhlQrError("UNAUTHORIZED", 401);

    const path = url.pathname.replace(/\/+$/, "");
    if (path === "/admin/versand/dhl-produkte" && request.method === "GET") {
      return new Response(JSON.stringify({ ok: true, produkte: await listProducts(env) }), { status: 200, headers: headers(origin) });
    }
    const match = /^\/admin\/versand\/([^/]+)\/qr$/.exec(path);
    const orderId = decodeURIComponent(match[1]);
    if (request.method === "GET") {
      return new Response(JSON.stringify({ ok: true, marke: await refreshMark(env, orderId) }), { status: 200, headers: headers(origin) });
    }
    if (request.method === "POST") {
      let body = {};
      try { body = (await request.json()) || {}; } catch { body = {}; }
      return new Response(JSON.stringify({ ok: true, marke: await createMark(env, orderId, body) }), { status: 200, headers: headers(origin) });
    }
    throw new DhlQrError("METHOD_NOT_ALLOWED", 405);
  } catch (err) {
    if (err instanceof DhlQrError) {
      return new Response(JSON.stringify({ error: err.code, detail: err.detail || undefined, requestId: reqId }), { status: err.status, headers: headers(origin) });
    }
    console.error(JSON.stringify({ level: "error", event: "dhl_qr_error", requestId: reqId, message: safeText(err?.message || "unknown", 180) }));
    return new Response(JSON.stringify({ error: "INTERNAL_DHL_QR_ERROR", requestId: reqId }), { status: 500, headers: headers(origin) });
  }
}

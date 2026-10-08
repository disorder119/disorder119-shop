import {
  CURRENCY,
  MAX_REQUEST_BYTES,
  RESERVATION_TTL_SECONDS,
  canTransitionRental,
  isValidIdempotencyKey,
  money,
  parsePriceToCents,
  publicOrderNumber,
  rentalQuoteFromItem,
  safeText,
} from "./commerce-core.js";
import { branchHead, createCommit, fastForward, readRepoFile } from "./github-datei.js";
import { istSandbox, sandboxKatalogLaden, sandboxVerkauft } from "./sandbox.js";
import { VersandError, versandFuerBestellung, versandWahlStatement } from "./versand.js";
import { AbholortError, abholadresse, zustellungAus } from "./abholorte.js";
import { captureStatements, recordVerifiedRefund } from './tax-evidence.js';
import { normalizeEmail } from './customer-mail.js';
import { autorisierungAus, autorisierungVerwerfen, reservierungFelder } from "./zahlung.js";

const CONFIG = Object.freeze({
  githubOwner: "disorder119",
  githubRepo: "disorder119-shop",
  githubBranch: "main",
  itemsPath: "data/items.json",
});

const ALLOWED_ORIGINS = Object.freeze([
  "https://disorder119.com",
  "https://www.disorder119.com",
  "https://admin.disorder119.com",
  "http://localhost:8765",
]);

class PublicError extends Error {
  constructor(code, status = 400, message = code) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function paypalApiBase(env) {
  return String(env.PAYPAL_ENVIRONMENT || "sandbox").toLowerCase() === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";
}

function isLive(env) {
  return String(env.PAYPAL_ENVIRONMENT || "sandbox").toLowerCase() === "live";
}

function isAllowedOrigin(origin) {
  return ALLOWED_ORIGINS.includes(origin);
}

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": isAllowedOrigin(origin) ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, Idempotency-Key, X-Turnstile-Token",
    "Access-Control-Max-Age": "600",
  };
}

function securityHeaders() {
  return {
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  };
}

function json(data, status = 200, origin = null) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Vary": "Origin",
      ...securityHeaders(),
      ...corsHeaders(origin),
    },
  });
}

function requestId(request) {
  const existing = request.headers.get("cf-ray");
  return existing ? `cf-${existing}` : crypto.randomUUID();
}

async function readJson(request) {
  const type = (request.headers.get("Content-Type") || "").toLowerCase();
  if (!type.includes("application/json")) throw new PublicError("CONTENT_TYPE_REQUIRED", 415);
  const declared = Number(request.headers.get("Content-Length") || 0);
  if (declared > MAX_REQUEST_BYTES) throw new PublicError("REQUEST_TOO_LARGE", 413);
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_REQUEST_BYTES) throw new PublicError("REQUEST_TOO_LARGE", 413);
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    throw new PublicError("INVALID_JSON", 400);
  }
}

function idempotencyKey(request, body) {
  const key = request.headers.get("Idempotency-Key") || body?.idempotencyKey;
  if (!isValidIdempotencyKey(key)) throw new PublicError("IDEMPOTENCY_KEY_REQUIRED", 400);
  return key;
}

function canonicalRequestValue(value) {
  if (Array.isArray(value)) return value.map(canonicalRequestValue);
  if (value && typeof value === "object") {
    const result = {};
    for (const key of Object.keys(value).sort()) {
      if (key === "idempotencyKey" || key === "turnstileToken") continue;
      result[key] = canonicalRequestValue(value[key]);
    }
    return result;
  }
  return value;
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

async function requestHash(scope, body) {
  return sha256Hex(JSON.stringify({ scope, body: canonicalRequestValue(body) }));
}

async function rateLimit(request, env, scope) {
  if (!env.RATE_LIMITER || typeof env.RATE_LIMITER.limit !== "function") return;
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const result = await env.RATE_LIMITER.limit({ key: `${scope}:${ip}` });
  if (result && result.success === false) throw new PublicError("RATE_LIMITED", 429);
}

async function verifyTurnstile(env, request, body) {
  if (!env.TURNSTILE_SECRET) return;
  const token = request.headers.get("X-Turnstile-Token") || body?.turnstileToken;
  if (!token) throw new PublicError("TURNSTILE_REQUIRED", 403);
  const form = new FormData();
  form.append("secret", env.TURNSTILE_SECRET);
  form.append("response", token);
  const ip = request.headers.get("CF-Connecting-IP");
  if (ip) form.append("remoteip", ip);
  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
  const result = await res.json();
  if (!result.success) throw new PublicError("TURNSTILE_FAILED", 403);
}

function requireDb(env) {
  if (!env.DB) throw new PublicError("COMMERCE_DATABASE_NOT_CONFIGURED", 503);
  return env.DB;
}

function isAdminAuthorized(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  return Boolean(env.ADMIN_TOKEN && token && token === env.ADMIN_TOKEN);
}

function ghHeaders(env) {
  if (!env.GITHUB_TOKEN) throw new PublicError("CATALOG_BACKEND_NOT_CONFIGURED", 503);
  return {
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "disorder119-shop-worker",
  };
}

async function loadItems(env) {
  // Testshop: oeffentlicher Katalog ohne Schluessel, Verkauftes aus D1.
  if (istSandbox(env)) return sandboxKatalogLaden(env);
  ghHeaders(env); // ohne GITHUB_TOKEN: CATALOG_BACKEND_NOT_CONFIGURED wie bisher
  // Ueber den Blob statt die Contents-API: items.json ist groesser als die
  // 1 MiB, bis zu der GitHub dort noch Inhalt mitschickt (github-datei.js).
  const { text, sha } = await readRepoFile(env, CONFIG.itemsPath, {
    repo: { owner: CONFIG.githubOwner, repo: CONFIG.githubRepo, branch: CONFIG.githubBranch },
  });
  return { items: JSON.parse(text), sha, text };
}

async function findItem(env, itemId) {
  const { items } = await loadItems(env);
  return items.find(item => String(item.id) === String(itemId));
}

// Kasse: bis zu zehn Einzelstuecke in einer Bestellung, jede Nummer hoechstens
// einmal. Die Produktseite schickt weiter nur itemId.
const MAX_CHECKOUT_ITEMS = 10;
function checkoutItemIds(body) {
  const roh = Array.isArray(body?.itemIds) ? body.itemIds : [body?.itemId];
  const ids = [...new Set(roh.map(v => String(v ?? "").trim()))];
  if (!ids.length || ids.length > MAX_CHECKOUT_ITEMS || ids.some(id => !/^\d{1,9}$/.test(id))) {
    throw new PublicError("INVALID_ITEM_ID", 400);
  }
  return ids;
}

async function findItems(env, ids) {
  const { items } = await loadItems(env);
  return ids.map(id => items.find(item => String(item.id) === id));
}

// Lieferadresse aus der Kasse (assets/kasse.js). Versendet wird nur innerhalb
// Deutschlands. Packstation und Filiale gehen nicht ueber die Strasse, sondern
// ueber die Zustellung (abholorte.js) - nur mit DHL, DPD stellt dort nicht zu.
export function lieferadresseAus(roh) {
  if (roh === undefined || roh === null) return null;
  if (typeof roh !== "object" || Array.isArray(roh)) throw new PublicError("ADRESSE_UNVOLLSTAENDIG", 422);
  const zeile = (wert, max) => safeText(wert, max).replace(/\s+/g, " ").trim();
  const adresse = {
    name: zeile(roh.name, 120),
    strasse: zeile(roh.strasse, 100),
    hausnummer: zeile(roh.hausnummer, 12).replace(/\s+/g, ""),
    zusatz: zeile(roh.zusatz, 100),
    plz: zeile(roh.plz, 5),
    ort: zeile(roh.ort, 80),
    land: zeile(roh.land || "DE", 2).toUpperCase(),
  };
  if (/packstation|postfiliale|postfach|paketshop/i.test(`${adresse.strasse} ${adresse.zusatz}`)) {
    throw new PublicError("PACKSTATION_NICHT_MOEGLICH", 422);
  }
  if (adresse.land !== "DE") throw new PublicError("NUR_DEUTSCHLAND", 422);
  const vollstaendig = adresse.name.length >= 3 && /\s/.test(adresse.name)
    && adresse.strasse.length >= 2 && /^\d{1,5}[a-zA-Z]?(?:[-/]\d{1,5}[a-zA-Z]?)?$/.test(adresse.hausnummer)
    && /^\d{5}$/.test(adresse.plz) && adresse.ort.length >= 2;
  if (!vollstaendig) throw new PublicError("ADRESSE_UNVOLLSTAENDIG", 422);
  return adresse;
}

export function checkoutKontaktAus(body) {
  if (typeof body?.email !== "string" || body.email.length > 200 || /[\u0000-\u001f\u007f]/.test(body.email)) {
    throw new PublicError("EMAIL_REQUIRED", 422);
  }
  const email = normalizeEmail(body?.email);
  if (!email) throw new PublicError("EMAIL_REQUIRED", 422);
  if (body?.createAccount !== undefined && typeof body.createAccount !== "boolean") {
    throw new PublicError("ACCOUNT_CHOICE_INVALID", 422);
  }
  return { email, createAccount: body.createAccount === true };
}

// Vorschaubild des Titelfotos ("assets/img/<ordner>/thumbs/<n>.webp") fuer die
// Mails - dieselbe Ableitung wie thumbUrl() in assets/app.js.
export function vorschaubild(item) {
  const pfad = String((item?.gallery || [])[0] || "").replace(/^\/+/, "");
  const i = pfad.lastIndexOf("/");
  if (!/^assets\/img\/[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+\.(?:webp|jpe?g|png)$/.test(pfad) || i < 0) return null;
  return `${pfad.slice(0, i)}/thumbs/${pfad.slice(i + 1)}`;
}

// custom_id der PayPal-Bestellung: die Artikelnummern. Bei einem Stueck wie
// bisher nur dessen Nummer.
function paypalCustomId(itemIds) {
  return itemIds.map(String).join(",");
}

function assertCatalogItemForSale(item) {
  if (!item) throw new PublicError("ITEM_NOT_FOUND", 404);
  if (String(item.public_status || "").toUpperCase() === "SOLD") throw new PublicError("ITEM_UNAVAILABLE", 409);
  const cents = parsePriceToCents(item.price);
  if (cents === null) throw new PublicError("PRICE_ON_REQUEST", 409);
  return cents;
}

async function ensureInventory(env, item) {
  const db = requireDb(env);
  const id = `inv_${item.id}`;
  const now = new Date().toISOString();
  const priceCents = parsePriceToCents(item.price);
  const catalogStatus = String(item.public_status || "DRAFT").toUpperCase();
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO inventory
      (id,item_id,article_no,status,sale_price_cents,currency,catalog_status,version,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?)`).bind(
        id, Number(item.id), String(item.article || item.id), catalogStatus === "SOLD" ? "PAID" : "AVAILABLE",
        priceCents, CURRENCY, catalogStatus, 1, now
      ),
    db.prepare(`UPDATE inventory SET article_no=?, sale_price_cents=?, catalog_status=?, updated_at=?, version=version+1
      WHERE item_id=?`).bind(String(item.article || item.id), priceCents, catalogStatus, now, Number(item.id)),
  ]);
  return db.prepare("SELECT * FROM inventory WHERE item_id=?").bind(Number(item.id)).first();
}

export async function expirePurchaseReservations(env, now = new Date().toISOString()) {
  const db = requireDb(env);
  await db.batch([
    db.prepare(`UPDATE commerce_orders SET status='CANCELLED',updated_at=?
      WHERE status='PAYMENT_PENDING' AND id IN (
        SELECT oi.order_id FROM order_items oi JOIN commerce_orders o ON o.id=oi.order_id
        JOIN reservations r ON r.inventory_id=oi.inventory_id
          AND (r.id=o.reservation_id OR r.idempotency_key=o.idempotency_key || '#' || oi.item_id)
        WHERE r.status='RESERVED' AND r.expires_at<=?
      ) AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.order_id=commerce_orders.id AND p.status IN ('PENDING','AUTHORIZED','COMPLETED','REFUNDED','PARTIALLY_REFUNDED'))`)
      .bind(now, now),
    db.prepare(`UPDATE reservations SET status='EXPIRED',updated_at=? WHERE status='RESERVED'
      AND (expires_at<=? OR EXISTS (SELECT 1 FROM order_items oi JOIN commerce_orders o ON o.id=oi.order_id
        WHERE oi.inventory_id=reservations.inventory_id AND o.status='CANCELLED'
          AND (reservations.id=o.reservation_id OR reservations.idempotency_key=o.idempotency_key || '#' || oi.item_id)))
      AND NOT EXISTS (SELECT 1 FROM payments p JOIN commerce_orders o ON o.id=p.order_id
        JOIN order_items oi ON oi.order_id=o.id WHERE oi.inventory_id=reservations.inventory_id
        AND (reservations.id=o.reservation_id OR reservations.idempotency_key=o.idempotency_key || '#' || oi.item_id)
        AND p.status IN ('PENDING','AUTHORIZED','COMPLETED','REFUNDED','PARTIALLY_REFUNDED'))`)
      .bind(now, now),
    db.prepare(`UPDATE payments SET status='CANCELLED',updated_at=? WHERE status='CREATED'
      AND order_id IN (SELECT id FROM commerce_orders WHERE status='CANCELLED')`).bind(now),
    db.prepare(`UPDATE inventory SET status='CANCELLED',updated_at=?,version=version+1
      WHERE status='PAYMENT_PENDING' AND catalog_status!='SOLD'
      AND NOT EXISTS (SELECT 1 FROM reservations r WHERE r.inventory_id=inventory.id AND r.status='RESERVED')
      AND NOT EXISTS (SELECT 1 FROM rental_reservations rr WHERE rr.inventory_id=inventory.id AND rr.status IN ('RESERVED','PAYMENT_PENDING','CONFIRMED','ACTIVE','RETURN_DUE'))`)
      .bind(now),
    db.prepare(`UPDATE inventory SET status='AVAILABLE',updated_at=?,version=version+1
      WHERE status IN ('RESERVED','CANCELLED') AND catalog_status!='SOLD'
      AND NOT EXISTS (SELECT 1 FROM reservations r WHERE r.inventory_id=inventory.id AND r.status='RESERVED')
      AND NOT EXISTS (SELECT 1 FROM rental_reservations rr WHERE rr.inventory_id=inventory.id AND rr.status IN ('RESERVED','PAYMENT_PENDING','CONFIRMED','ACTIVE','RETURN_DUE'))`)
      .bind(now),
  ]);
}

async function cleanupExpired(env, inventoryId) {
  const db = requireDb(env);
  const now = new Date().toISOString();
  await expirePurchaseReservations(env, now);
  await db.batch([
    db.prepare("UPDATE rental_reservations SET status='CANCELLED', updated_at=? WHERE inventory_id=? AND status='RESERVED' AND expires_at IS NOT NULL AND expires_at<=?")
      .bind(now, inventoryId, now),
    db.prepare(`DELETE FROM rental_days WHERE rental_reservation_id IN
      (SELECT id FROM rental_reservations WHERE inventory_id=? AND status IN ('CANCELLED','REFUNDED','RETURNED'))`).bind(inventoryId),
    db.prepare(`UPDATE inventory SET status='AVAILABLE', updated_at=?, version=version+1
      WHERE id=? AND status='RESERVED'
      AND NOT EXISTS (SELECT 1 FROM reservations r WHERE r.inventory_id=inventory.id AND r.status='RESERVED')
      AND NOT EXISTS (SELECT 1 FROM rental_reservations rr WHERE rr.inventory_id=inventory.id AND rr.status IN ('RESERVED','PAYMENT_PENDING','CONFIRMED','ACTIVE','RETURN_DUE'))`)
      .bind(now, inventoryId),
  ]);
}

async function claimIdempotency(env, scope, key, ownerRequestId, fingerprint) {
  const db = requireDb(env);
  const now = new Date();
  const nowIso = now.toISOString();
  const expires = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
  await db.prepare("DELETE FROM idempotency_keys WHERE scope=? AND idempotency_key=? AND expires_at<=?")
    .bind(scope, key, nowIso).run();
  await db.prepare(`INSERT OR IGNORE INTO idempotency_keys
    (scope,idempotency_key,request_hash,resource_id,created_at,expires_at) VALUES (?,?,?,?,?,?)`)
    .bind(scope, key, fingerprint, ownerRequestId, nowIso, expires).run();
  const row = await db.prepare("SELECT * FROM idempotency_keys WHERE scope=? AND idempotency_key=?").bind(scope, key).first();
  if (!row || !row.request_hash || row.request_hash !== fingerprint) throw new PublicError("IDEMPOTENCY_KEY_REUSED", 409);
  if (row.response_json) {
    return { replay: true, status: row.response_status || 200, data: JSON.parse(row.response_json) };
  }
  if (row.resource_id !== ownerRequestId) throw new PublicError("IDEMPOTENT_REQUEST_IN_PROGRESS", 409);
  return { replay: false };
}

async function finishIdempotency(env, scope, key, status, data, resourceId = null) {
  const db = requireDb(env);
  await db.prepare(`UPDATE idempotency_keys SET response_status=?,response_json=?,resource_id=COALESCE(?,resource_id)
    WHERE scope=? AND idempotency_key=?`).bind(status, JSON.stringify(data), resourceId, scope, key).run();
}

async function audit(env, entityType, entityId, eventType, reqId, metadata = null, actorType = "SYSTEM") {
  if (!env.DB) return;
  const clean = metadata ? JSON.stringify(metadata) : null;
  await env.DB.prepare(`INSERT INTO audit_events
    (id,actor_type,entity_type,entity_id,event_type,request_id,metadata_json,created_at)
    VALUES (?,?,?,?,?,?,?,?)`).bind(
      crypto.randomUUID(), actorType, entityType, String(entityId), eventType, reqId, clean, new Date().toISOString()
    ).run();
}

async function reserveForPurchase(env, item, key, reqId) {
  const db = requireDb(env);
  const inv = await ensureInventory(env, item);
  if (inv.status === "PAYMENT_PENDING") {
    const interrupted = await db.prepare(`SELECT p.provider_order_id FROM payments p
      JOIN order_items oi ON oi.order_id=p.order_id
      WHERE oi.inventory_id=? AND p.provider='PAYPAL' AND p.status='PENDING' LIMIT 1`).bind(inv.id).first();
    if (interrupted?.provider_order_id) {
      await reconcilePurchasePayments(env, reqId, interrupted.provider_order_id);
    }
  }
  await cleanupExpired(env, inv.id);
  const reservationId = crypto.randomUUID();
  const now = new Date();
  const expires = new Date(now.getTime() + RESERVATION_TTL_SECONDS * 1000).toISOString();
  const statements = await db.batch([
    db.prepare(`INSERT INTO reservations (id,inventory_id,kind,status,idempotency_key,expires_at,created_at)
      SELECT ?,id,'PURCHASE','RESERVED',?,?,? FROM inventory
      WHERE id=? AND status='AVAILABLE' AND catalog_status!='SOLD'
      AND NOT EXISTS (SELECT 1 FROM rental_reservations rr WHERE rr.inventory_id=inventory.id AND rr.status IN ('RESERVED','PAYMENT_PENDING','CONFIRMED','ACTIVE','RETURN_DUE'))`)
      .bind(reservationId, key, expires, now.toISOString(), inv.id),
    db.prepare(`UPDATE inventory SET status='RESERVED',updated_at=?,version=version+1
      WHERE id=? AND status='AVAILABLE' AND EXISTS (SELECT 1 FROM reservations WHERE id=? AND status='RESERVED')`)
      .bind(now.toISOString(), inv.id, reservationId),
  ]);
  if (!statements[0]?.meta?.changes) throw new PublicError("ITEM_UNAVAILABLE", 409);
  await audit(env, "reservation", reservationId, "PURCHASE_RESERVED", reqId, { itemId: item.id, expiresAt: expires });
  return { reservationId, inventoryId: inv.id, expiresAt: expires };
}

async function releasePurchaseReservation(env, reservationId, reason, reqId) {
  const db = requireDb(env);
  const row = await db.prepare("SELECT inventory_id FROM reservations WHERE id=?").bind(reservationId).first();
  if (!row) return;
  const now = new Date().toISOString();
  await db.batch([
    db.prepare("UPDATE reservations SET status='CANCELLED',updated_at=? WHERE id=? AND status='RESERVED'").bind(now, reservationId),
    db.prepare(`UPDATE inventory SET status='AVAILABLE',updated_at=?,version=version+1 WHERE id=? AND status='RESERVED'
      AND NOT EXISTS (SELECT 1 FROM reservations WHERE inventory_id=? AND status='RESERVED' AND id<>?)`)
      .bind(now, row.inventory_id, row.inventory_id, reservationId),
  ]);
  await audit(env, "reservation", reservationId, "RESERVATION_RELEASED", reqId, { reason });
}

// Jedes Stueck bekommt eine eigene Reservierung mit dem Schluessel
// "<Bestellschluessel>#<Artikelnummer>" - daran erkennen Bezahlung und
// Abschluss spaeter genau die Reservierungen dieser Bestellung. Ist ein Stueck
// schon weg, werden die davor reservierten sofort wieder frei.
async function reserveAll(env, items, key, reqId) {
  const reservations = [];
  try {
    for (const item of items) reservations.push(await reserveForPurchase(env, item, `${key}#${item.id}`, reqId));
  } catch (err) {
    await releaseAll(env, reservations, "checkout_item_unavailable", reqId);
    throw err;
  }
  return reservations;
}

async function releaseAll(env, reservations, reason, reqId) {
  for (const r of reservations) {
    try {
      await releasePurchaseReservation(env, r.reservationId, reason, reqId);
    } catch (err) {
      console.error(JSON.stringify({ level: "error", event: "reservation_release_failed", requestId: reqId, message: safeText(err?.message || "unknown", 120) }));
    }
  }
}

async function createRentalReservation(env, item, quote, body, key, reqId) {
  const db = requireDb(env);
  const inv = await ensureInventory(env, item);
  await cleanupExpired(env, inv.id);
  if (["PAID","PREPARING","SHIPPED","DELIVERED","RETURN_REQUESTED"].includes(inv.status) || inv.catalog_status === "SOLD") {
    throw new PublicError("ITEM_UNAVAILABLE", 409);
  }
  const existingSale = await db.prepare("SELECT 1 AS yes FROM reservations WHERE inventory_id=? AND status='RESERVED' AND expires_at>? LIMIT 1")
    .bind(inv.id, new Date().toISOString()).first();
  if (existingSale) throw new PublicError("ITEM_UNAVAILABLE", 409);

  const rentalId = crypto.randomUUID();
  const now = new Date();
  const expires = new Date(now.getTime() + RESERVATION_TTL_SECONDS * 1000).toISOString();
  const statements = [
    db.prepare(`INSERT INTO rental_reservations
      (id,inventory_id,start_date,end_date,days,daily_price_cents,total_price_cents,currency,price_on_request,status,idempotency_key,expires_at,purpose,message,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,'RESERVED',?,?,?,?,?)`).bind(
        rentalId, inv.id, body.start, body.end, quote.days, quote.dailyPriceCents, quote.totalPriceCents,
        CURRENCY, quote.priceOnRequest ? 1 : 0, key, expires, safeText(body.purpose || "other", 40), safeText(body.message, 2000), now.toISOString()
      ),
  ];
  for (let offset = 0; offset < quote.days; offset++) {
    const d = new Date(`${body.start}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + offset);
    statements.push(db.prepare("INSERT INTO rental_days (inventory_id,rental_date,rental_reservation_id) VALUES (?,?,?)")
      .bind(inv.id, d.toISOString().slice(0,10), rentalId));
  }
  statements.push(db.prepare("UPDATE inventory SET status='RESERVED',updated_at=?,version=version+1 WHERE id=? AND status='AVAILABLE'")
    .bind(now.toISOString(), inv.id));
  try {
    await db.batch(statements);
  } catch (err) {
    if (String(err?.message || err).toLowerCase().includes("unique")) throw new PublicError("RENTAL_DATES_UNAVAILABLE", 409);
    throw err;
  }
  await audit(env, "rental_reservation", rentalId, "RENTAL_RESERVED", reqId, {
    itemId: item.id, start: body.start, end: body.end, days: quote.days,
    dailyPriceCents: quote.dailyPriceCents, totalPriceCents: quote.totalPriceCents, priceOnRequest: quote.priceOnRequest,
  });
  return { rentalId, expiresAt: expires };
}

async function paypalAccessToken(env) {
  if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET) throw new PublicError("PAYPAL_NOT_CONFIGURED", 503);
  const creds = btoa(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`);
  const res = await fetch(`${paypalApiBase(env)}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${creds}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`paypal_auth_${res.status}`);
  return (await res.json()).access_token;
}

// Eine PayPal-Bestellung fuer ein oder mehrere Stuecke. Kommt die Adresse aus
// der Kasse, zeigt PayPal genau diese an und laesst sie nicht mehr aendern
// (SET_PROVIDED_ADDRESS) - Versandpreis und Adresse passen so immer zusammen.
async function createPaypalOrder(env, items, itemCents, shippingCents, idempotency, adresse = null) {
  const token = await paypalAccessToken(env);
  const titel = items.map(item => `${item.brand || ""} ${item.title || ""}`.trim());
  const unit = {
    custom_id: paypalCustomId(items.map(item => item.id)),
    description: (items.length === 1 ? titel[0] : `${items.length} Teile: ${titel.join(", ")}`).slice(0, 127),
    // Versand getrennt ausweisen: PayPal zeigt dem Kunden damit Warenwert
    // und Versandkosten einzeln an, und die Gutschein-Korrektur kann spaeter
    // genau den Warenwert ersetzen, ohne den Versand zu verschieben.
    amount: {
      currency_code: CURRENCY,
      value: money(itemCents + shippingCents),
      breakdown: {
        item_total: { currency_code: CURRENCY, value: money(itemCents) },
        shipping: { currency_code: CURRENCY, value: money(shippingCents) },
      },
    },
  };
  if (adresse) {
    unit.shipping = {
      type: "SHIPPING",
      name: { full_name: adresse.name.slice(0, 300) },
      address: {
        address_line_1: `${adresse.strasse} ${adresse.hausnummer}`.slice(0, 300),
        ...(adresse.zusatz ? { address_line_2: adresse.zusatz.slice(0, 300) } : {}),
        admin_area_2: adresse.ort.slice(0, 120),
        postal_code: adresse.plz,
        country_code: "DE",
      },
    };
  }
  const res = await fetch(`${paypalApiBase(env)}/v2/checkout/orders`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "PayPal-Request-Id": idempotency,
    },
    body: JSON.stringify({
      // Nur reservieren: eingezogen wird erst beim Versand (zahlung.js). Ein
      // Storno davor gibt die Reservierung frei - ohne PayPal-Gebuehr.
      intent: "AUTHORIZE",
      purchase_units: [unit],
      application_context: {
        shipping_preference: adresse ? "SET_PROVIDED_ADDRESS" : "GET_FROM_FILE",
        brand_name: "Disorder119",
        user_action: "PAY_NOW",
      },
    }),
  });
  if (!res.ok) throw new Error(`paypal_create_${res.status}`);
  return res.json();
}

async function capturePaypalOrder(env, providerOrderId, idempotency) {
  const token = await paypalAccessToken(env);
  const res = await fetch(`${paypalApiBase(env)}/v2/checkout/orders/${encodeURIComponent(providerOrderId)}/capture`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "PayPal-Request-Id": idempotency },
  });
  if (!res.ok) throw new Error(`paypal_capture_${res.status}`);
  return res.json();
}

async function readPaypalOrder(env, providerOrderId) {
  const token = await paypalAccessToken(env);
  const res = await fetch(`${paypalApiBase(env)}/v2/checkout/orders/${encodeURIComponent(providerOrderId)}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`paypal_order_read_${res.status}`);
  return res.json();
}

// Nach der Freigabe durch die Kundin: PayPal reserviert den Betrag, bucht aber
// nichts ab. Bestellungen aus der Zeit vor der Umstellung (intent CAPTURE)
// werden wie bisher sofort eingezogen.
async function authorizePaypalOrder(env, providerOrderId, paymentId) {
  const token = await paypalAccessToken(env);
  const res = await fetch(`${paypalApiBase(env)}/v2/checkout/orders/${encodeURIComponent(providerOrderId)}/authorize`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "PayPal-Request-Id": `authorize:${paymentId}`,
      Prefer: "return=representation",
    },
  });
  if (res.ok) return res.json();
  const body = await res.json().catch(() => ({}));
  const issue = safeText(body?.details?.[0]?.issue || "", 80);
  if (res.status === 422 && issue === "ACTION_DOES_NOT_MATCH_INTENT") {
    return capturePaypalOrder(env, providerOrderId, `capture:${paymentId}`);
  }
  // Schon reserviert (Wiederholung nach einem Timeout): den Stand abholen.
  if (res.status === 422 && issue === "ORDER_ALREADY_AUTHORIZED") return readPaypalOrder(env, providerOrderId);
  throw new Error(`paypal_authorize_${res.status}${issue ? `_${issue}` : ""}`);
}

function capturePayment(capture) {
  return capture?.purchase_units?.[0]?.payments?.captures?.[0] || null;
}

function captureMatches(capture, customId, cents) {
  const unit = capture?.purchase_units?.[0];
  const payment = capturePayment(capture);
  return capture?.status === "COMPLETED" && String(unit?.custom_id || "") === String(customId) &&
    payment?.status === "COMPLETED" && payment?.amount?.currency_code === CURRENCY &&
    Math.round(Number(payment.amount.value) * 100) === cents;
}

// Eine frische, noch nicht eingezogene Reservierung ueber genau den Betrag.
function authorizationMatches(providerOrder, customId, cents) {
  const unit = providerOrder?.purchase_units?.[0];
  const authorization = autorisierungAus(providerOrder);
  return providerOrder?.status === "COMPLETED" && String(unit?.custom_id || "") === String(customId) &&
    authorization?.status === "CREATED" && Boolean(authorization?.id) && authorization?.amount?.currency_code === CURRENCY &&
    Math.round(Number(authorization.amount.value) * 100) === cents;
}

async function verifyPaypalWebhook(env, headers, body) {
  if (!env.PAYPAL_WEBHOOK_ID) return false;
  const ts = Date.parse(headers.get("paypal-transmission-time") || "");
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > 10 * 60 * 1000) return false;
  const token = await paypalAccessToken(env);
  const res = await fetch(`${paypalApiBase(env)}/v1/notifications/verify-webhook-signature`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      auth_algo: headers.get("paypal-auth-algo"), cert_url: headers.get("paypal-cert-url"),
      transmission_id: headers.get("paypal-transmission-id"), transmission_sig: headers.get("paypal-transmission-sig"),
      transmission_time: headers.get("paypal-transmission-time"), webhook_id: env.PAYPAL_WEBHOOK_ID, webhook_event: body,
    }),
  });
  if (!res.ok) return false;
  return (await res.json()).verification_status === "SUCCESS";
}

// Der Commit muss genau die Statuszeilen eines Artikels aendern und sonst
// nichts: der Main-Waechter (.github/workflows/main-integrity.yml) laesst
// einen "Verkauft: Artikel"-Commit nur unter dieser Bedingung stehen und
// dreht alles andere zurueck. JSON.stringify(..., 2) erzeugt dieselbe Form wie
// build_site.py - bis auf den Zeilenumbruch am Dateiende, der deshalb
// erhalten bleibt.
export async function markCatalogSold(env, itemId) {
  // Testshop: nie in den echten Katalog schreiben.
  if (istSandbox(env)) return sandboxVerkauft(env, itemId);
  ghHeaders(env); // ohne GITHUB_TOKEN: CATALOG_BACKEND_NOT_CONFIGURED
  const repo = { owner: CONFIG.githubOwner, repo: CONFIG.githubRepo, branch: CONFIG.githubBranch };
  for (let attempt = 0; attempt < 4; attempt++) {
    // Lesen und Schreiben auf genau demselben Stand von main: bewegt sich main
    // dazwischen (etwa durch den Rebuild), scheitert das Vorspulen und wir
    // setzen neu auf, statt eine fremde Aenderung zu ueberschreiben.
    const head = await branchHead(env, { repo });
    const { text } = await readRepoFile(env, CONFIG.itemsPath, { repo, ref: head.commitSha });
    const items = JSON.parse(text);
    const item = items.find(it => String(it.id) === String(itemId));
    if (!item) throw new Error("catalog_item_missing");
    const alreadySold = String(item.public_status || "").toUpperCase() === "SOLD";
    const hadPrivateProviderField = Object.prototype.hasOwnProperty.call(item, "paypal_order_id");
    if (alreadySold && !hadPrivateProviderField) return;
    item.public_status = "SOLD";
    item.status = "Verkauft";
    delete item.paypal_order_id;
    delete item.reserved_order_id;
    delete item.reserved_until;
    delete item.reserved_price;
    delete item.reserved_currency;
    const serialized = JSON.stringify(items, null, 2) + (text.endsWith("\n") ? "\n" : "");
    // Als UTF-8-Blob ueber die Git-Datenschnittstelle: kein Base64, das im
    // kostenlosen Worker-Tarif allein schon das Rechenzeit-Limit sprengt.
    const commitSha = await createCommit(env, {
      repo,
      parent: head.commitSha,
      baseTree: head.treeSha,
      message: `Verkauft: Artikel ${itemId}`,
      files: [{ path: CONFIG.itemsPath, text: serialized }],
    });
    if (await fastForward(env, commitSha, { repo })) return;
  }
  throw new Error("catalog_mark_sold_conflict");
}

async function createOrderRecords(env, items, centsList, versand, reservations, providerOrder, key, reqId, adresse = null, kontakt = null) {
  const db = requireDb(env);
  const orderId = crypto.randomUUID();
  const paymentId = crypto.randomUUID();
  const now = new Date().toISOString();
  const orderNumber = publicOrderNumber(orderId, new Date());
  const cents = centsList.reduce((summe, c) => summe + c, 0);
  const shippingCents = versand.preisCents;
  const totalCents = cents + shippingCents;
  const statements = [
    db.prepare(`INSERT INTO commerce_orders
      (id,order_number,reservation_id,status,currency,subtotal_cents,shipping_cents,total_cents,idempotency_key,created_at)
      VALUES (?,?,?,'PAYMENT_PENDING',?,?,?,?,?,?)`).bind(orderId, orderNumber, reservations[0].reservationId, CURRENCY, cents, shippingCents, totalCents, key, now),
    ...items.map((item, i) => db.prepare(`INSERT INTO order_items
      (id,order_id,inventory_id,item_id,article_no,title_snapshot,unit_price_cents,quantity,currency,bild)
      VALUES (?,?,?,?,?,?,?,1,?,?)`).bind(crypto.randomUUID(), orderId, reservations[i].inventoryId, Number(item.id), String(item.article || item.id), `${item.brand || ""} ${item.title || ""}`.trim(), centsList[i], CURRENCY, vorschaubild(item))),
    db.prepare(`INSERT INTO payments
      (id,order_id,provider,provider_order_id,status,amount_cents,currency,idempotency_key,created_at)
      VALUES (?,?,'PAYPAL',?,'CREATED',?,?,?,?)`).bind(paymentId, orderId, providerOrder.id, totalCents, CURRENCY, `paypal-create:${key}`, now),
    ...reservations.map(r => db.prepare("UPDATE reservations SET status='RESERVED',updated_at=? WHERE id=?").bind(now, r.reservationId)),
    ...reservations.map(r => db.prepare("UPDATE inventory SET status='PAYMENT_PENDING',updated_at=?,version=version+1 WHERE id=? AND status='RESERVED'").bind(now, r.inventoryId)),
    // Gewaehlte Versandart gehoert zur Bestellung (Admin-App, Etikett).
    versandWahlStatement(db, orderId, versand, now),
  ];
  if (adresse) {
    // Adresse aus der Kasse sofort sichern - PayPal ueberschreibt sie nach dem
    // Bezahlen mit denselben Angaben plus E-Mail (snapshotPaypalOrder).
    statements.push(db.prepare(`INSERT INTO order_contact_snapshots
      (order_id,source_provider,email,account_requested,recipient_name,address_line1,address_line2,postal_code,city,country_code,captured_at,updated_at)
      VALUES (?,'CHECKOUT',?,?,?,?,?,?,?,'DE',?,?)`).bind(orderId, kontakt.email, kontakt.createAccount ? 1 : 0,
      adresse.name, `${adresse.strasse} ${adresse.hausnummer}`, adresse.zusatz || null, adresse.plz, adresse.ort, now, now));
  }
  await db.batch(statements);
  await audit(env, "order", orderId, "PAYMENT_STARTED", reqId, {
    orderNumber, itemId: items[0].id, itemIds: items.map(item => item.id), provider: "PAYPAL", versand: versand.id,
  });
  return { orderId, orderNumber, paymentId };
}

// Bestellung, Reservierungen und Lagerstuecke nach einer gesicherten Zahlung:
// eingezogen (COMPLETED) oder nur reserviert (AUTHORIZED) - beides heisst
// "Bezahlt", die Stuecke sind verkauft.
function bezahltStatements(db, payment, now) {
  return [
    db.prepare(`UPDATE commerce_orders SET status='PAID',updated_at=? WHERE id=? AND status='PAYMENT_PENDING'
      AND EXISTS (SELECT 1 FROM payments p WHERE p.order_id=commerce_orders.id AND p.status IN ('AUTHORIZED','COMPLETED'))`)
      .bind(now, payment.commerce_order_id),
    // Genau die Reservierungen dieser Bestellung: Schluessel "<Bestellung>#<Artikel>".
    db.prepare(`UPDATE reservations SET status='CONSUMED',updated_at=? WHERE status='RESERVED' AND (id=? OR idempotency_key IN
      (SELECT o.idempotency_key || '#' || oi.item_id FROM order_items oi JOIN commerce_orders o ON o.id=oi.order_id WHERE oi.order_id=?))
      AND EXISTS (SELECT 1 FROM payments p WHERE p.order_id=? AND p.status IN ('AUTHORIZED','COMPLETED'))`)
      .bind(now, payment.reservation_id, payment.commerce_order_id, payment.commerce_order_id),
    db.prepare(`UPDATE inventory SET status='PAID',updated_at=?,version=version+1
      WHERE id IN (SELECT inventory_id FROM order_items WHERE order_id=?) AND status='PAYMENT_PENDING'
      AND EXISTS (SELECT 1 FROM payments p WHERE p.order_id=? AND p.status IN ('AUTHORIZED','COMPLETED'))`)
      .bind(now, payment.commerce_order_id, payment.commerce_order_id),
  ];
}

// Die Zahlung darf nur gesichert werden, solange alle eigenen Reservierungen
// der Bestellung noch gelten (oder der Abschluss schon beansprucht ist).
const RESERVIERUNGEN_GELTEN_SQL = `EXISTS (SELECT 1 FROM commerce_orders o WHERE o.id=payments.order_id AND o.status='PAYMENT_PENDING')
      AND (SELECT COUNT(*) FROM order_items WHERE order_id=payments.order_id)>0
      AND (SELECT COUNT(*) FROM order_items oi JOIN inventory i ON i.id=oi.inventory_id
        JOIN commerce_orders o ON o.id=oi.order_id
        JOIN reservations r ON r.inventory_id=oi.inventory_id AND
          (r.id=o.reservation_id OR r.idempotency_key=o.idempotency_key || '#' || oi.item_id)
        WHERE oi.order_id=payments.order_id AND i.status='PAYMENT_PENDING' AND r.status='RESERVED'
          AND (payments.status='PENDING' OR r.expires_at>?)) =
        (SELECT COUNT(*) FROM order_items WHERE order_id=payments.order_id)`;

// providerOrder: PayPal-Bestellung (Antwort von /authorize oder /capture oder
// GET /v2/checkout/orders/<id>). Drei Lagen:
//   * eingezogen (Capture COMPLETED): wie bisher - oder die Reservierung einer
//     schon verbuchten Bestellung wurde eingezogen (Webhook, Abgleich);
//   * reserviert (Authorization CREATED): Bestellung "Bezahlt", Geld wird
//     beim Versand eingezogen (zahlung.js);
//   * sonst: PAYMENT_MISMATCH bzw. PAYMENT_CONFIRMATION_PENDING.
export async function completePayment(env, providerOrderId, providerOrder, reqId) {
  const db = requireDb(env);
  // Verglichen wird gegen den Zahlbetrag der Bestellung (Ware + Versand, nach
  // einem eingeloesten Gutschein der reduzierte Betrag) - nicht mehr gegen den
  // reinen Artikelpreis.
  const payment = await db.prepare(`SELECT p.*,o.id AS commerce_order_id,o.order_number,o.reservation_id,o.total_cents,o.status AS order_status
    FROM payments p JOIN commerce_orders o ON o.id=p.order_id
    WHERE p.provider='PAYPAL' AND p.provider_order_id=?`).bind(providerOrderId).first();
  if (!payment) throw new PublicError("ORDER_NOT_FOUND", 404);
  const rows = (await db.prepare("SELECT item_id FROM order_items WHERE order_id=? ORDER BY rowid")
    .bind(payment.commerce_order_id).all()).results || [];
  const itemIds = rows.map(row => row.item_id);
  const result = { ...payment, item_ids: itemIds, item_id: itemIds[0] };
  const customId = paypalCustomId(itemIds);
  const cents = Number(payment.amount_cents ?? payment.total_cents);
  const now = new Date().toISOString();
  const authorization = autorisierungAus(providerOrder);

  if (captureMatches(providerOrder, customId, cents)) {
    const providerPayment = capturePayment(providerOrder);
    const evidence = await captureStatements(db, payment, providerPayment, now);
    if (['COMPLETED','REFUNDED','PARTIALLY_REFUNDED'].includes(payment.status)) {
      await db.batch(evidence);
      if (payment.order_status === 'CANCELLED') throw new PublicError('PAYMENT_RECONCILIATION_REQUIRED', 409);
      return result;
    }
    if (['AUTHORIZED','FAILED'].includes(payment.status) && payment.authorization_id) {
      // Die Reservierung ist eingezogen, ohne dass der Shop die Antwort
      // verbucht hat (Timeout beim Einziehen): jetzt nachtragen.
      const committed = await db.batch([
        ...evidence,
        db.prepare(`UPDATE payments SET status='COMPLETED',provider_payment_id=?,capture_error=NULL,updated_at=?
          WHERE id=? AND status IN ('AUTHORIZED','FAILED')`).bind(providerPayment.id, now, payment.id),
      ]);
      if (!committed[evidence.length]?.meta?.changes) return result;
      await audit(env, "payment", payment.id, "PAYMENT_CAPTURED", reqId, {
        orderId: payment.commerce_order_id, captureId: providerPayment.id, anlass: "ABGLEICH",
      }, "PAYMENT_PROVIDER");
      return { ...result, status: 'COMPLETED', eingezogen: true };
    }
    const committed = await db.batch([
      ...evidence,
      db.prepare(`UPDATE payments SET provider_payment_id=?,status='COMPLETED',authorization_id=COALESCE(authorization_id,?),updated_at=?
        WHERE id=? AND status IN ('CREATED','PENDING')
        AND ${RESERVIERUNGEN_GELTEN_SQL}`)
        .bind(providerPayment.id, authorization?.id ? safeText(authorization.id, 64) : null, now, payment.id, now),
      ...bezahltStatements(db, payment, now),
    ]);
    if (!committed[evidence.length]?.meta?.changes) throw new PublicError("PAYMENT_RECONCILIATION_REQUIRED", 409);
    await audit(env, "payment", payment.id, "PAYMENT_COMPLETED", reqId, { orderId: payment.commerce_order_id, itemId: itemIds[0], itemIds, provider: "PAYPAL" }, "PAYMENT_PROVIDER");
    return { ...result, status: 'COMPLETED' };
  }

  if (authorizationMatches(providerOrder, customId, cents)) {
    if (payment.status === 'AUTHORIZED' || ['COMPLETED','REFUNDED','PARTIALLY_REFUNDED'].includes(payment.status)) return result;
    if (!['CREATED','PENDING'].includes(payment.status)) {
      // Keine gueltige Bestellung mehr zu dieser Reservierung: sofort
      // freigeben, damit bei der Kundin nichts vorgemerkt bleibt.
      const frei = await autorisierungVerwerfen(env, authorization.id, `verwaist:${payment.id}`);
      await audit(env, "payment", payment.id, "PAYMENT_ORPHAN_AUTHORIZATION_VOIDED", reqId, {
        orderId: payment.commerce_order_id, ok: frei.ok, grund: frei.grund || null,
      }, "SYSTEM");
      throw new PublicError('PAYMENT_RECONCILIATION_REQUIRED', 409);
    }
    const felder = reservierungFelder(authorization, new Date(now));
    const committed = await db.batch([
      db.prepare(`UPDATE payments SET status='AUTHORIZED',authorization_id=?,authorized_at=?,capture_due_at=?,
          authorization_expires_at=?,updated_at=?
        WHERE id=? AND status IN ('CREATED','PENDING')
        AND ${RESERVIERUNGEN_GELTEN_SQL}`)
        .bind(felder.authorizationId, felder.authorizedAt, felder.captureDueAt, felder.expiresAt, now, payment.id, now),
      ...bezahltStatements(db, payment, now),
    ]);
    if (!committed[0]?.meta?.changes) throw new PublicError("PAYMENT_RECONCILIATION_REQUIRED", 409);
    await audit(env, "payment", payment.id, "PAYMENT_AUTHORIZED", reqId, {
      orderId: payment.commerce_order_id, itemId: itemIds[0], itemIds, provider: "PAYPAL",
      authorizationId: felder.authorizationId, einziehenSpaetestens: felder.captureDueAt,
    }, "PAYMENT_PROVIDER");
    return { ...result, status: 'AUTHORIZED', reserviert: true, capture_due_at: felder.captureDueAt };
  }

  // PayPal prueft die Reservierung noch: nichts freigeben, der Abgleich
  // (reconcilePurchasePayments) schliesst sie ab, sobald sie steht.
  if (String(authorization?.status || "") === "PENDING") throw new PublicError("PAYMENT_CONFIRMATION_PENDING", 409);
  throw new PublicError("PAYMENT_MISMATCH", 409);
}

// Nach dem Bezahlen jedes Stueck im Katalog als verkauft markieren - je Stueck
// ein eigener Commit, genau so, wie der Main-Waechter ihn stehen laesst.
async function markAllSold(env, completed, reqId) {
  if (['REFUNDED','PARTIALLY_REFUNDED'].includes(completed.status)) return;
  for (const itemId of completed.item_ids?.length ? completed.item_ids : [completed.item_id]) {
    try {
      await markCatalogSold(env, itemId);
    } catch (catalogErr) {
      await audit(env, "order", completed.commerce_order_id, "CATALOG_SYNC_FAILED", reqId, { itemId, code: safeText(catalogErr.message, 80) });
      console.error(JSON.stringify({ level: "error", event: "catalog_sync_failed", requestId: reqId, orderId: completed.commerce_order_id, itemId }));
    }
  }
}

// Ein unterbrochener Capture-Request bleibt zunaechst gesperrt. Erst die
// PayPal-Abfrage entscheidet, ob er bezahlt wurde oder nach mehreren Stunden
// wirklich unbezahlt ist. Ein Providerfehler gibt nie Bestand frei.
export async function reconcilePurchasePayments(env, reqId = "purchase-reconcile", providerOrderId = null) {
  const db = requireDb(env);
  const now = Date.now();
  const candidates = (await db.prepare(`SELECT provider_order_id,COALESCE(updated_at,created_at) AS started_at FROM payments
    WHERE provider='PAYPAL' AND status='PENDING' AND COALESCE(updated_at,created_at)<?
      AND (? IS NULL OR provider_order_id=?)
    ORDER BY COALESCE(updated_at,created_at) LIMIT 20`)
    .bind(new Date(now - 2 * 60 * 1000).toISOString(), providerOrderId, providerOrderId).all()).results || [];
  if (!candidates.length) { await expirePurchaseReservations(env); return; }
  const token = await paypalAccessToken(env);
  for (const candidate of candidates) {
    try {
      const response = await fetch(`${paypalApiBase(env)}/v2/checkout/orders/${encodeURIComponent(candidate.provider_order_id)}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      });
      if (!response.ok) throw new Error(`paypal_reconcile_${response.status}`);
      const providerOrder = await response.json();
      // Reservierung abgelehnt oder verfallen und nichts eingezogen: bezahlt
      // ist diese Bestellung nie - wie eine abgebrochene Zahlung behandeln.
      const ohneGeld = providerOrder.status === "COMPLETED" && !capturePayment(providerOrder)
        && ["DENIED", "VOIDED", "EXPIRED"].includes(String(autorisierungAus(providerOrder)?.status || ""));
      if (providerOrder.status === "COMPLETED" && !ohneGeld) {
        const completed = await completePayment(env, candidate.provider_order_id, providerOrder, reqId);
        await markAllSold(env, completed, reqId);
      } else if ((ohneGeld || ["CREATED", "APPROVED", "VOIDED"].includes(providerOrder.status))
          && Date.parse(candidate.started_at) <= now - 4 * 60 * 60 * 1000) {
        await db.prepare(`UPDATE payments SET status='FAILED',updated_at=?
          WHERE provider='PAYPAL' AND provider_order_id=? AND status='PENDING' AND COALESCE(updated_at,created_at)=?`)
          .bind(new Date().toISOString(), candidate.provider_order_id, candidate.started_at).run();
      }
    } catch (error) {
      console.error(JSON.stringify({ level: "error", event: "purchase_reconciliation_failed", requestId: reqId,
        code: safeText(error?.message, 80) }));
    }
  }
  await expirePurchaseReservations(env);
}

async function recordWebhookEvent(env, event, verified) {
  const db = requireDb(env);
  const providerEventId = safeText(event?.id, 200);
  if (!providerEventId) throw new PublicError("WEBHOOK_EVENT_ID_MISSING", 400);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const payloadHash = await sha256Hex(JSON.stringify(canonicalRequestValue(event)));
  const result = await db.prepare(`INSERT OR IGNORE INTO payment_events
    (id,provider,provider_event_id,event_type,verified,received_at,payload_hash) VALUES (?,'PAYPAL',?,?,?,?,?)`)
    .bind(id, providerEventId, safeText(event.event_type, 100), verified ? 1 : 0, now, payloadHash).run();
  if (result.meta?.changes) return true;
  const existing=await db.prepare("SELECT processed_at,payload_hash FROM payment_events WHERE provider='PAYPAL' AND provider_event_id=?").bind(providerEventId).first();
  if (existing?.payload_hash!==payloadHash) throw new PublicError('WEBHOOK_REPLAY_CONFLICT',409);
  return !existing?.processed_at;
}

async function listRentalRequests(env) {
  const db = requireDb(env);
  const result = await db.prepare(`SELECT rr.id, i.item_id AS itemId, i.article_no AS articleNo,
    rr.start_date AS start, rr.end_date AS end, rr.days, rr.purpose, rr.message, rr.status,
    rr.daily_price_cents AS dailyPriceCents, rr.total_price_cents AS totalPriceCents,
    rr.price_on_request AS priceOnRequest, rr.created_at AS createdAt, rr.updated_at AS updatedAt
    FROM rental_reservations rr JOIN inventory i ON i.id=rr.inventory_id ORDER BY rr.created_at DESC LIMIT 500`).all();
  return result.results || [];
}

async function updateRentalStatus(env, id, status, reqId) {
  const allowed = ["RESERVED","PAYMENT_PENDING","CONFIRMED","ACTIVE","RETURN_DUE","RETURNED","CANCELLED","REFUNDED"];
  if (!allowed.includes(status)) throw new PublicError("INVALID_RENTAL_STATUS", 400);
  const db = requireDb(env);
  const now = new Date().toISOString();
  const row = await db.prepare("SELECT inventory_id,status FROM rental_reservations WHERE id=?").bind(id).first();
  if (!row) throw new PublicError("RENTAL_NOT_FOUND", 404);
  if (!canTransitionRental(row.status, status)) throw new PublicError("INVALID_RENTAL_STATUS_TRANSITION", 409);
  await db.prepare("UPDATE rental_reservations SET status=?,updated_at=? WHERE id=?").bind(status, now, id).run();
  if (["RETURNED","CANCELLED","REFUNDED"].includes(status)) {
    await db.batch([
      db.prepare("DELETE FROM rental_days WHERE rental_reservation_id=?").bind(id),
      db.prepare(`UPDATE inventory SET status='AVAILABLE',updated_at=?,version=version+1 WHERE id=?
        AND NOT EXISTS (SELECT 1 FROM reservations WHERE inventory_id=? AND status='RESERVED')
        AND NOT EXISTS (SELECT 1 FROM rental_reservations WHERE inventory_id=? AND id<>? AND status IN ('RESERVED','PAYMENT_PENDING','CONFIRMED','ACTIVE','RETURN_DUE'))`)
        .bind(now, row.inventory_id, row.inventory_id, row.inventory_id, id),
    ]);
  }
  await audit(env, "rental_reservation", id, `RENTAL_${status}`, reqId, null, "ADMIN");
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");
    const reqId = requestId(request);

    if (request.method === "OPTIONS") {
      if (origin && !isAllowedOrigin(origin)) return new Response(null, { status: 403, headers: securityHeaders() });
      return new Response(null, { status: 204, headers: { ...corsHeaders(origin), ...securityHeaders() } });
    }

    try {
      if (url.pathname === "/health" && request.method === "GET") {
        return json({ ok: true, version: "commerce-foundation-v2", environment: isLive(env) ? "live" : "sandbox", dbReady: Boolean(env.DB), checkoutReady: Boolean(env.DB && env.PAYPAL_CLIENT_ID && env.PAYPAL_CLIENT_SECRET && env.PAYPAL_WEBHOOK_ID && env.GITHUB_TOKEN) }, 200, origin);
      }

      const browserWrite = request.method !== "GET" && url.pathname !== "/paypal-webhook";
      if (browserWrite && !isAllowedOrigin(origin)) throw new PublicError("ORIGIN_NOT_ALLOWED", 403);

      if (url.pathname === "/rental-quote" && request.method === "POST") {
        await rateLimit(request, env, "rental-quote");
        const body = await readJson(request);
        if (!/^\d+$/.test(String(body.itemId || ""))) throw new PublicError("INVALID_ITEM_ID", 400);
        const item = await findItem(env, body.itemId);
        if (!item) throw new PublicError("ITEM_NOT_FOUND", 404);
        let quote;
        try { quote = rentalQuoteFromItem(item, String(body.start || ""), String(body.end || "")); }
        catch (err) {
          if (err.message === "ITEM_SOLD") throw new PublicError("ITEM_UNAVAILABLE", 409);
          if (err.message === "INVALID_RENTAL_DATES" || err.message === "RENTAL_DATE_IN_PAST") throw new PublicError("INVALID_RENTAL_DATES", 400); // RUNTIME_AUDIT_SERVER_DATE_MAP
          throw err;
        }
        return json({ itemId: item.id, currency: CURRENCY, days: quote.days, dailyPrice: quote.dailyPriceCents === null ? null : money(quote.dailyPriceCents), totalPrice: quote.totalPriceCents === null ? null : money(quote.totalPriceCents), priceOnRequest: quote.priceOnRequest }, 200, origin);
      }

      if (url.pathname === "/rental-request" && request.method === "POST") {
        await rateLimit(request, env, "rental-request");
        const body = await readJson(request);
        await verifyTurnstile(env, request, body);
        const key = idempotencyKey(request, body);
        const fingerprint = await requestHash("rental-request", body);
        const claimed = await claimIdempotency(env, "rental-request", key, reqId, fingerprint);
        if (claimed.replay) return json(claimed.data, claimed.status, origin);
        if (!/^\d+$/.test(String(body.itemId || ""))) throw new PublicError("INVALID_ITEM_ID", 400);
        const item = await findItem(env, body.itemId);
        if (!item) throw new PublicError("ITEM_NOT_FOUND", 404);
        let quote;
        try { quote = rentalQuoteFromItem(item, String(body.start || ""), String(body.end || "")); }
        catch (err) {
          if (err.message === "ITEM_SOLD") throw new PublicError("ITEM_UNAVAILABLE", 409);
          if (err.message === "INVALID_RENTAL_DATES" || err.message === "RENTAL_DATE_IN_PAST") throw new PublicError("INVALID_RENTAL_DATES", 400); // RUNTIME_AUDIT_SERVER_DATE_MAP
          throw err;
        }
        const rental = await createRentalReservation(env, item, quote, body, key, reqId);
        const response = { ok: true, rentalReservationId: rental.rentalId, expiresAt: rental.expiresAt, currency: CURRENCY, days: quote.days, dailyPrice: quote.dailyPriceCents === null ? null : money(quote.dailyPriceCents), totalPrice: quote.totalPriceCents === null ? null : money(quote.totalPriceCents), priceOnRequest: quote.priceOnRequest };
        await finishIdempotency(env, "rental-request", key, 201, response, rental.rentalId);
        return json(response, 201, origin);
      }

      if (url.pathname === "/create-order" && request.method === "POST") {
        await rateLimit(request, env, "create-order");
        if (isLive(env) && !env.DB) throw new PublicError("COMMERCE_DATABASE_NOT_CONFIGURED", 503);
        const body = await readJson(request);
        const kontakt = checkoutKontaktAus(body);
        await verifyTurnstile(env, request, body);
        const key = idempotencyKey(request, body);
        const fingerprint = await requestHash("create-order", body);
        const claimed = await claimIdempotency(env, "create-order", key, reqId, fingerprint);
        if (claimed.replay) return json(claimed.data, claimed.status, origin);
        const ids = checkoutItemIds(body);
        const items = await findItems(env, ids);
        const centsList = items.map(assertCatalogItemForSale);
        const cents = centsList.reduce((summe, c) => summe + c, 0);
        // Haustuer: die eingegebene Anschrift. Packstation/Filiale (nur DHL):
        // die Anschrift des Abholorts mit Postnummer (abholorte.js).
        let zustellung;
        let adresse;
        try {
          zustellung = zustellungAus(body.zustellung);
          adresse = zustellung.art === "haustuer" ? lieferadresseAus(body.adresse) : abholadresse(body.adresse?.name, zustellung);
        } catch (err) {
          if (err instanceof AbholortError) throw new PublicError(err.code, err.status);
          throw err;
        }
        if (!adresse) throw new PublicError("ADRESSE_UNVOLLSTAENDIG", 422);
        // Versandart und -preis prueft der Server selbst (versand.js). Weicht
        // der Preis von dem ab, den die Kundschaft gesehen hat, gibt es 409
        // mit der aktuellen Liste - noch bevor etwas reserviert wird. Ab dem
        // Warenwert in versand.versandkostenfrei kostet der Standard 0 Cent.
        const gewaehlt = await versandFuerBestellung(env, items, body.versand, body.versandPreisCents, cents);
        if (zustellung.art !== "haustuer" && !gewaehlt.abholstation) throw new PublicError("ABHOLSTATION_NUR_DHL", 422);
        const versand = { ...gewaehlt, zustellung };
        const shippingCents = versand.preisCents;
        const reservations = await reserveAll(env, items, key, reqId);
        let providerOrder;
        try {
          providerOrder = await createPaypalOrder(env, items, cents, shippingCents, key, adresse);
        } catch (err) {
          await releaseAll(env, reservations, "provider_create_failed", reqId);
          throw err;
        }
        const local = await createOrderRecords(env, items, centsList, versand, reservations, providerOrder, key, reqId, adresse, kontakt);
        const expiresAt = reservations.map(r => r.expiresAt).sort()[0];
        const response = { id: providerOrder.id, orderId: local.orderId, orderNumber: local.orderNumber, expiresAt,
          currency: CURRENCY, itemIds: items.map(item => item.id), itemPrice: money(cents), shipping: money(shippingCents), total: money(cents + shippingCents),
          versand: { id: versand.id, art: versand.art, titel: versand.titel, preisCents: versand.preisCents, carrier: versand.carrier, laufzeit: versand.laufzeit } };
        await finishIdempotency(env, "create-order", key, 200, response, local.orderId);
        return json(response, 200, origin);
      }

      if (url.pathname === "/capture-order" && request.method === "POST") {
        await rateLimit(request, env, "capture-order");
        const body = await readJson(request);
        const key = idempotencyKey(request, body);
        const fingerprint = await requestHash("capture-order", body);
        const claimed = await claimIdempotency(env, "capture-order", key, reqId, fingerprint);
        if (claimed.replay) return json(claimed.data, claimed.status, origin);
        const providerOrderId = safeText(body.orderId, 128);
        if (!providerOrderId) throw new PublicError("ORDER_ID_REQUIRED", 400);
        const db = requireDb(env);
        const payment = await db.prepare(`SELECT p.*,o.reservation_id,o.status AS order_status FROM payments p
          JOIN commerce_orders o ON o.id=p.order_id
          WHERE p.provider='PAYPAL' AND p.provider_order_id=?`).bind(providerOrderId).first();
        if (!payment) throw new PublicError("ORDER_NOT_FOUND", 404);
        if (["AUTHORIZED", "COMPLETED"].includes(payment.status) && payment.order_status !== "CANCELLED") {
          const response = { ok: true, orderId: payment.order_id, zahlung: payment.status === "AUTHORIZED" ? "RESERVIERT" : "EINGEZOGEN" };
          await finishIdempotency(env, "capture-order", key, 200, response, payment.order_id);
          return json(response, 200, origin);
        }
        if (payment.status === "PENDING") throw new PublicError("PAYMENT_CONFIRMATION_PENDING", 409);
        // Der atomare Claim sperrt Ablauf und Admin-Storno vor dem externen
        // PayPal-Call. Nur alle noch gueltigen, eigenen Reservierungen zaehlen.
        const now = new Date().toISOString();
        const claim = await db.prepare(`UPDATE payments SET status='PENDING',updated_at=?
          WHERE id=? AND status='CREATED' AND EXISTS (
            SELECT 1 FROM commerce_orders o WHERE o.id=payments.order_id AND o.status='PAYMENT_PENDING')
          AND (SELECT COUNT(*) FROM order_items WHERE order_id=payments.order_id)>0
          AND (SELECT COUNT(*) FROM order_items oi JOIN inventory i ON i.id=oi.inventory_id
            JOIN commerce_orders o ON o.id=oi.order_id
            JOIN reservations r ON r.inventory_id=oi.inventory_id AND
              (r.id=o.reservation_id OR r.idempotency_key=o.idempotency_key || '#' || oi.item_id)
            WHERE oi.order_id=payments.order_id AND i.status='PAYMENT_PENDING'
              AND r.status='RESERVED' AND r.expires_at>?) =
            (SELECT COUNT(*) FROM order_items WHERE order_id=payments.order_id)`)
          .bind(now, payment.id, now).run();
        if (!claim.meta?.changes) throw new PublicError("RESERVATION_EXPIRED", 409);
        // Dieser Schluessel gehoert zur PayPal-Bestellung, nicht zum Browser-
        // Retry. Auch nach einem Timeout reserviert PayPal nur einmal. Das
        // Geld wird erst beim Versand eingezogen (zahlung.js).
        const providerOrder = await authorizePaypalOrder(env, providerOrderId, payment.id);
        const completed = await completePayment(env, providerOrderId, providerOrder, reqId);
        await markAllSold(env, completed, reqId);
        const response = { ok: true, orderId: completed.commerce_order_id, orderNumber: completed.order_number,
          zahlung: completed.status === "AUTHORIZED" ? "RESERVIERT" : "EINGEZOGEN" };
        await finishIdempotency(env, "capture-order", key, 200, response, completed.commerce_order_id);
        return json(response, 200, origin);
      }

      if (url.pathname === "/paypal-webhook" && request.method === "POST") {
        await rateLimit(request, env, "paypal-webhook");
        const body = await readJson(request);
        const verified = await verifyPaypalWebhook(env, request.headers, body);
        if (!verified) throw new PublicError("WEBHOOK_SIGNATURE_INVALID", 400);
        const isNew = await recordWebhookEvent(env, body, true);
        if (!isNew) return json({ ok: true, duplicate: true }, 200, origin);
        if (body.event_type === "PAYMENT.CAPTURE.COMPLETED") {
          const providerOrderId = body.resource?.supplementary_data?.related_ids?.order_id;
          if (providerOrderId) {
            const token = await paypalAccessToken(env);
            const res = await fetch(`${paypalApiBase(env)}/v2/checkout/orders/${encodeURIComponent(providerOrderId)}`, { headers: { Authorization: `Bearer ${token}` } });
            if (res.ok) {
              const order = await res.json();
              const completed = await completePayment(env, providerOrderId, order, reqId);
              await markAllSold(env, completed, reqId);
            } else throw new PublicError('PROVIDER_ORDER_UNAVAILABLE',502);
          } else throw new PublicError('PROVIDER_ORDER_REFERENCE_MISSING',400);
        }
        if (body.event_type === 'PAYMENT.CAPTURE.REFUNDED') await recordVerifiedRefund(env,body);
        await requireDb(env).prepare("UPDATE payment_events SET processed_at=? WHERE provider='PAYPAL' AND provider_event_id=?")
          .bind(new Date().toISOString(), safeText(body.id, 200)).run();
        return json({ ok: true }, 200, origin);
      }

      if (url.pathname === "/rental-requests" && request.method === "GET") {
        if (!isAdminAuthorized(request, env)) throw new PublicError("UNAUTHORIZED", 401);
        return json({ requests: await listRentalRequests(env) }, 200, origin);
      }

      if (url.pathname.startsWith("/rental-request/") && request.method === "PATCH") {
        if (!isAdminAuthorized(request, env)) throw new PublicError("UNAUTHORIZED", 401);
        const body = await readJson(request);
        const id = safeText(url.pathname.slice("/rental-request/".length), 100);
        await updateRentalStatus(env, id, String(body.status || "").toUpperCase(), reqId);
        return json({ ok: true }, 200, origin);
      }

      if (url.pathname.startsWith("/account/") && ["GET","POST","PATCH","DELETE"].includes(request.method)) {
        throw new PublicError("AUTH_PROVIDER_NOT_CONFIGURED", 501);
      }

      throw new PublicError("NOT_FOUND", 404);
    } catch (err) {
      if (err instanceof PublicError) return json({ error: err.code, requestId: reqId }, err.status, origin);
      if (err instanceof VersandError) return json({ error: err.code, versand: err.versand || undefined, requestId: reqId }, err.status, origin);
      console.error(JSON.stringify({ level: "error", event: "unhandled_worker_error", requestId: reqId, message: safeText(err?.message || "unknown", 160) }));
      return json({ error: "INTERNAL_SHOP_ERROR", requestId: reqId }, 500, origin);
    }
  },
};

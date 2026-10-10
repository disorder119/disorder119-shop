/* Mobile parcel tracker for the private DISORDER119 admin app.

   Tracking concepts and the 17TRACK v2.2 status parser are adapted from
   SoerenKaiser99/parcel_tracker (Copyright (c) 2026 Sören Kaiser), MIT License.
   See THIRD_PARTY_NOTICES.md in the repository.

   Privacy: only tracking number and the carrier code returned by 17TRACK are
   sent to 17TRACK. shipping_info and address objects are intentionally ignored.
*/

import { parseTrackingInput, trackingUrlFor } from "./tracking-input.js";

const TRACK17_URL = "https://api.17track.net/track/v2.2";
const TRACK17_TIMEOUT_MS = 8000;
const SYNC_TTL_MS = 5 * 60 * 1000;
const MAX_REFRESH_ROWS = 40;
const ADMIN_ORIGINS = Object.freeze([
  "https://admin.disorder119.com",
  "http://localhost:8765",
  "http://127.0.0.1:8765",
]);
const ACTIVE_STATUSES = new Set(["UNKNOWN", "INFO_RECEIVED", "IN_TRANSIT", "OUT_FOR_DELIVERY", "PICKUP_READY", "EXCEPTION"]);
const STATUS_MAP = Object.freeze({
  InfoReceived: "INFO_RECEIVED",
  InTransit: "IN_TRANSIT",
  OutForDelivery: "OUT_FOR_DELIVERY",
  AvailableForPickup: "PICKUP_READY",
  Delivered: "DELIVERED",
  DeliveryFailure: "EXCEPTION",
  Exception: "EXCEPTION",
  NotFound: "UNKNOWN",
  Expired: "UNKNOWN",
});
const AUTH_CODES = new Set([-18010001, -18010002, -18010005]);
const ALREADY_REGISTERED = -18019901;

class ParcelError extends Error {
  constructor(code, status = 400, detail = "") {
    super(code);
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
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
function corsHeaders(origin) {
  const h = {
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
  if (origin && ADMIN_ORIGINS.includes(origin)) h["Access-Control-Allow-Origin"] = origin;
  return h;
}
function json(data, status = 200, origin = null) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...securityHeaders(), ...corsHeaders(origin) },
  });
}

async function digest(value) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value || ""))));
}
async function tokenEquals(a, b) {
  if (!a || !b) return false;
  const [x, y] = await Promise.all([digest(a), digest(b)]);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}
async function requireAdmin(request, env) {
  if (!env.ADMIN_TOKEN) throw new ParcelError("ADMIN_NOT_CONFIGURED", 503);
  const supplied = String(request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!(await tokenEquals(supplied, env.ADMIN_TOKEN))) throw new ParcelError("UNAUTHORIZED", 401);
  if (!env.DB) throw new ParcelError("COMMERCE_DATABASE_NOT_CONFIGURED", 503);
}

function clean(value, max = 120) {
  return String(value == null ? "" : value).trim().replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, max);
}
function direction(value) {
  const d = String(value || "IN").toUpperCase();
  if (!new Set(["IN", "OUT", "RETURN"]).has(d)) throw new ParcelError("DIRECTION_INVALID", 400);
  return d;
}
function manualStatus(value) {
  const s = String(value || "UNKNOWN").toUpperCase();
  const allowed = new Set(["UNKNOWN", "INFO_RECEIVED", "IN_TRANSIT", "OUT_FOR_DELIVERY", "PICKUP_READY", "DELIVERED", "EXCEPTION", "RETURNED"]);
  if (!allowed.has(s)) throw new ParcelError("STATUS_INVALID", 400);
  return s;
}
function parseJson(value, fallback) {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
}
function nowIso() { return new Date().toISOString(); }
function trackingLink(number, carrier) {
  try { return trackingUrlFor(number, carrier); }
  catch {
    // Existing records allowed punctuation and longer IDs. Keep those entries
    // readable even when they do not pass the stricter paste parser.
    return `https://t.17track.net/de#nums=${encodeURIComponent(number)}`;
  }
}

function shopStatus(status, orderStatus) {
  const s = String(status || "").toUpperCase();
  const o = String(orderStatus || "").toUpperCase();
  if (s === "DELIVERED" || o === "DELIVERED") return "DELIVERED";
  if (s === "RETURNED" || o === "RETURNED") return "RETURNED";
  if (s === "EXCEPTION") return "EXCEPTION";
  if (s === "IN_TRANSIT" || s === "SHIPPED" || o === "SHIPPED") return "IN_TRANSIT";
  if (s === "LABEL_CREATED") return "INFO_RECEIVED";
  return "UNKNOWN";
}

function manualView(row) {
  return {
    id: row.id,
    source: "MANUAL",
    trackingNumber: row.tracking_number,
    label: row.label || row.tracking_number,
    carrier: row.carrier || "",
    direction: row.direction,
    platform: row.platform || "",
    externalRef: row.external_ref || "",
    status: row.status,
    statusText: row.status_text || "",
    etaDate: row.eta_date || null,
    etaLatest: row.eta_latest || null,
    etaFrom: row.eta_from || null,
    etaTo: row.eta_to || null,
    location: row.location || "",
    deliveredAt: row.delivered_at || null,
    events: parseJson(row.track17_events_json, []),
    track17: {
      registered: Boolean(row.track17_registered),
      carrier: row.track17_carrier == null ? null : Number(row.track17_carrier),
      expired: Boolean(row.track17_expired),
      lastSync: row.track17_last_sync || null,
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    trackingUrl: trackingLink(row.tracking_number, row.carrier),
    editable: true,
  };
}
function shopView(row) {
  const title = clean(row.titles || "", 160) || `Bestellung ${row.order_number}`;
  return {
    id: `shop:${row.id}`,
    source: "SHOP",
    shipmentId: row.id,
    orderId: row.order_id,
    orderNumber: row.order_number,
    trackingNumber: row.tracking_number || "",
    label: title,
    carrier: row.carrier || "",
    service: row.service || "",
    direction: "OUT",
    platform: "DISORDER119",
    status: shopStatus(row.status, row.order_status),
    statusText: row.status || row.order_status || "",
    etaDate: null,
    etaLatest: null,
    etaFrom: null,
    etaTo: null,
    location: "",
    deliveredAt: row.delivered_at || null,
    events: [],
    track17: { registered: false, carrier: null, expired: false, lastSync: null },
    createdAt: row.created_at,
    updatedAt: row.updated_at || row.created_at,
    trackingUrl: row.tracking_number ? trackingLink(row.tracking_number, row.carrier) : null,
    editable: false,
  };
}

async function listParcels(env) {
  const [manual, shop] = await Promise.all([
    env.DB.prepare("SELECT * FROM parcel_tracker_manual ORDER BY updated_at DESC, created_at DESC").all(),
    env.DB.prepare(`SELECT s.*, o.order_number, o.status AS order_status,
      GROUP_CONCAT(oi.title_snapshot, ' · ') AS titles
      FROM shipments s JOIN commerce_orders o ON o.id=s.order_id
      LEFT JOIN order_items oi ON oi.order_id=o.id
      GROUP BY s.id ORDER BY COALESCE(s.updated_at,s.created_at) DESC`).all(),
  ]);
  const parcels = [
    ...(manual.results || []).map(manualView),
    ...(shop.results || []).map(shopView),
  ].sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)));
  return { parcels, counts: parcelCounts(parcels), trackingEnabled: track17Configured(env) };
}

export function parcelCounts(parcels, today = new Date()) {
  const localDay = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit" }).format(today);
  const out = { total: parcels.length, today: 0, transit: 0, incoming: 0, outgoing: 0, problems: 0, done: 0 };
  for (const p of parcels) {
    const done = p.status === "DELIVERED" || p.status === "RETURNED";
    if (done) out.done += 1;
    else if (p.status === "EXCEPTION") out.problems += 1;
    else if (ACTIVE_STATUSES.has(p.status)) out.transit += 1;
    if (!done && p.direction === "IN") out.incoming += 1;
    if (!done && (p.direction === "OUT" || p.direction === "RETURN")) out.outgoing += 1;
    if (!done && (p.status === "OUT_FOR_DELIVERY" || p.status === "PICKUP_READY" || p.etaDate === localDay)) out.today += 1;
  }
  return out;
}

async function createManual(env, body) {
  const id = crypto.randomUUID();
  const created = nowIso();
  let parsed;
  try {
    parsed = parseTrackingInput(body.trackingInput ?? body.trackingNumber);
  } catch (err) {
    const code = ["TRACKING_NUMBER_INVALID", "TRACKING_INPUT_UNSUPPORTED", "TRACKING_INPUT_AMBIGUOUS"].includes(err?.code || err?.message)
      ? (err.code || err.message) : "TRACKING_NUMBER_INVALID";
    throw new ParcelError(code, 400);
  }
  const number = parsed.trackingNumber.toUpperCase();
  const d = direction(body.direction);
  const label = clean(body.label, 120);
  const carrier = clean(body.carrier, 40) || clean(parsed.carrier, 40);
  const platform = clean(body.platform, 40) || clean(parsed.platform, 40);
  const externalRef = clean(body.externalRef, 120);
  // Older entries may still use lowercase; keep a pasted link from creating
  // a second entry for the same parcel without rewriting existing data.
  const existing = await env.DB.prepare("SELECT id FROM parcel_tracker_manual WHERE UPPER(tracking_number)=? LIMIT 1").bind(number).first();
  if (existing) throw new ParcelError("TRACKING_NUMBER_EXISTS", 409);
  try {
    await env.DB.prepare(`INSERT INTO parcel_tracker_manual
      (id,tracking_number,label,carrier,direction,platform,external_ref,status,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,'UNKNOWN',?,?)`)
      .bind(id, number, label || null, carrier || null, d, platform || null, externalRef || null, created, created).run();
  } catch (err) {
    if (/UNIQUE/i.test(String(err && err.message || err))) throw new ParcelError("TRACKING_NUMBER_EXISTS", 409);
    throw err;
  }
  return manualView(await env.DB.prepare("SELECT * FROM parcel_tracker_manual WHERE id=?").bind(id).first());
}

async function getManual(env, id) {
  const row = await env.DB.prepare("SELECT * FROM parcel_tracker_manual WHERE id=?").bind(id).first();
  if (!row) throw new ParcelError("PARCEL_NOT_FOUND", 404);
  return row;
}
async function updateManual(env, id, body) {
  const row = await getManual(env, id);
  const next = {
    label: body.label === undefined ? row.label : clean(body.label, 120) || null,
    carrier: body.carrier === undefined ? row.carrier : clean(body.carrier, 40) || null,
    direction: body.direction === undefined ? row.direction : direction(body.direction),
    platform: body.platform === undefined ? row.platform : clean(body.platform, 40) || null,
    externalRef: body.externalRef === undefined ? row.external_ref : clean(body.externalRef, 120) || null,
    status: body.status === undefined ? row.status : manualStatus(body.status),
  };
  await env.DB.prepare(`UPDATE parcel_tracker_manual SET label=?,carrier=?,direction=?,platform=?,external_ref=?,status=?,updated_at=? WHERE id=?`)
    .bind(next.label,next.carrier,next.direction,next.platform,next.externalRef,next.status,nowIso(),id).run();
  return manualView(await getManual(env, id));
}
async function deleteManual(env, id) {
  await getManual(env, id);
  await env.DB.prepare("DELETE FROM parcel_tracker_manual WHERE id=?").bind(id).run();
  return { ok: true };
}

function track17Configured(env) { return Boolean(String(env.TRACK17_API_KEY || "").trim()); }
function errorFor17(code) {
  if (AUTH_CODES.has(code)) return new ParcelError("TRACK17_AUTH", 502);
  if (code === -18019902) return new ParcelError("TRACK17_NOT_REGISTERED", 409);
  if (code === -18019903 || code === -18019910) return new ParcelError("TRACK17_CARRIER_NOT_DETECTED", 422);
  if (code === -18019907) return new ParcelError("TRACK17_RATE_LIMIT", 429);
  if (code === -18019908) return new ParcelError("TRACK17_QUOTA_EXHAUSTED", 409);
  if (code === -18019909) return new ParcelError("TRACK17_NO_DATA", 404);
  return new ParcelError("TRACK17_ERROR", 502, String(code));
}
async function track17Post(env, endpoint, payload) {
  if (!track17Configured(env)) throw new ParcelError("TRACK17_NOT_CONFIGURED", 503);
  const controller = new AbortController();
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new ParcelError("TRACK17_TIMEOUT", 504));
    }, TRACK17_TIMEOUT_MS);
  });
  const operation = async () => {
    let response;
    try {
      response = await fetch(`${TRACK17_URL}/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "17token": String(env.TRACK17_API_KEY).trim() },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (err) {
      if (controller.signal.aborted) throw new ParcelError("TRACK17_TIMEOUT", 504);
      throw new ParcelError("TRACK17_UNREACHABLE", 502);
    }
    if (response.status === 401 || response.status === 403) throw new ParcelError("TRACK17_AUTH", 502);
    if (response.status === 429) throw new ParcelError("TRACK17_RATE_LIMIT", 429);
    if (!response.ok) throw new ParcelError("TRACK17_HTTP", 502, String(response.status));
    let body;
    try { body = await response.json(); }
    catch {
      if (controller.signal.aborted) throw new ParcelError("TRACK17_TIMEOUT", 504);
      throw new ParcelError("TRACK17_INVALID_RESPONSE", 502);
    }
    if (!body || typeof body !== "object") throw new ParcelError("TRACK17_INVALID_RESPONSE", 502);
    if (body.code !== 0) throw errorFor17(body.code);
    if (!body.data || typeof body.data !== "object") throw new ParcelError("TRACK17_INVALID_RESPONSE", 502);
    return body.data;
  };
  try {
    return await Promise.race([operation(), deadline]);
  } finally {
    clearTimeout(timer);
  }
}
function rejectedCode(data, number) {
  for (const item of Array.isArray(data.rejected) ? data.rejected : []) {
    if (String(item && item.number) === number && item.error) return item.error.code;
  }
  return null;
}
async function getQuota(env) {
  if (!track17Configured(env)) return { enabled: false, total: null, used: null, remain: null };
  const data = await track17Post(env, "getquota", []);
  const total = Number(data.quota_total), used = Number(data.quota_used), remain = Number(data.quota_remain);
  if (![total,used,remain].every(Number.isFinite)) throw new ParcelError("TRACK17_INVALID_QUOTA", 502);
  return { enabled: true, total, used, remain };
}
async function register17(env, id) {
  const row = await getManual(env, id);
  if (row.track17_registered) return { parcel: manualView(row), trackingEnabled: track17Configured(env), alreadyRegistered: true };
  const number = row.tracking_number;
  const data = await track17Post(env, "register", [{ number }]);
  if (!Array.isArray(data.accepted) || (data.rejected !== undefined && !Array.isArray(data.rejected))) {
    throw new ParcelError("TRACK17_INVALID_RESPONSE", 502);
  }
  let carrier = null;
  for (const item of data.accepted) {
    if (String(item && item.number) === number) {
      carrier = Number.isInteger(item.carrier) && item.carrier > 0 ? item.carrier : null;
      break;
    }
  }
  const code = rejectedCode(data, number);
  if (carrier === null && code !== null && code !== ALREADY_REGISTERED) throw errorFor17(code);
  if (carrier === null && code === null && !(data.accepted || []).some(x => String(x && x.number) === number)) {
    throw new ParcelError("TRACK17_INVALID_RESPONSE", 502);
  }
  await env.DB.prepare("UPDATE parcel_tracker_manual SET track17_registered=1,track17_carrier=?,updated_at=? WHERE id=?")
    .bind(carrier,nowIso(),id).run();
  return { parcel: manualView(await getManual(env, id)), trackingEnabled: true, alreadyRegistered: code === ALREADY_REGISTERED };
}

function textValue(value) { return typeof value === "string" ? value.trim().slice(0, 500) : ""; }
function iso(value) {
  if (typeof value !== "string" || !value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
function eventFrom(raw) {
  if (!raw || typeof raw !== "object") return null;
  const at = iso(raw.time_iso) || iso(raw.time_utc);
  const description = textValue(raw.description);
  if (!at || !description) return null;
  return { at, text: description, location: textValue(raw.location) || "" };
}
function eventsFrom(info) {
  const out = [];
  const providers = info && info.tracking && Array.isArray(info.tracking.providers) ? info.tracking.providers : [];
  for (const provider of providers) {
    for (const raw of Array.isArray(provider?.events) ? provider.events : []) {
      const event = eventFrom(raw);
      if (event) out.push(event);
    }
  }
  return out.sort((a,b)=>String(b.at).localeCompare(String(a.at))).slice(0, 8);
}
function etaFrom(info) {
  const estimate = info && info.time_metrics && info.time_metrics.estimated_delivery_date;
  if (!estimate || typeof estimate !== "object") return { etaDate:null, etaLatest:null, etaFrom:null, etaTo:null };
  const from = iso(estimate.from) || iso(estimate.to);
  const to = iso(estimate.to);
  if (!from) return { etaDate:null, etaLatest:null, etaFrom:null, etaTo:null };
  const day = new Intl.DateTimeFormat("sv-SE", { timeZone:"Europe/Berlin", year:"numeric", month:"2-digit", day:"2-digit" });
  const first = day.format(new Date(from));
  if (!to || new Date(to) <= new Date(from)) return { etaDate:first, etaLatest:null, etaFrom:null, etaTo:null };
  const last = day.format(new Date(to));
  if (last !== first) return { etaDate:first, etaLatest:last, etaFrom:null, etaTo:null };
  return { etaDate:first, etaLatest:null, etaFrom:from, etaTo:to };
}
export function parseTrack17(item) {
  if (!item || typeof item !== "object" || !item.track_info || typeof item.track_info !== "object") {
    throw new ParcelError("TRACK17_NO_DATA", 404);
  }
  const info = item.track_info;
  const rawStatus = info.latest_status && typeof info.latest_status === "object" ? String(info.latest_status.status || "") : "";
  const status = STATUS_MAP[rawStatus] || "UNKNOWN";
  const latest = info.latest_event && typeof info.latest_event === "object" ? info.latest_event : {};
  const events = eventsFrom(info);
  const latestEvent = eventFrom(latest);
  const eta = status === "DELIVERED" ? { etaDate:null, etaLatest:null, etaFrom:null, etaTo:null } : etaFrom(info);
  const deliveredAt = status === "DELIVERED" ? (latestEvent && latestEvent.at || (events[0] && events[0].at) || null) : null;
  return {
    status,
    statusText: textValue(latest.description),
    location: textValue(latest.location) || (events[0] && events[0].location) || "",
    deliveredAt,
    events,
    expired: rawStatus === "Expired",
    carrier: Number.isInteger(item.carrier) && item.carrier > 0 ? item.carrier : null,
    ...eta,
  };
}

async function refreshRows(env, rows, { force = false } = {}) {
  const now = Date.now();
  const eligible = rows.filter(row => row.track17_registered && (force || (
    !row.track17_expired && ACTIVE_STATUSES.has(String(row.status)) &&
    (!row.track17_last_sync || !Number.isFinite(Date.parse(row.track17_last_sync)) || now - Date.parse(row.track17_last_sync) >= SYNC_TTL_MS)
  ))).sort((a, b) => String(a.track17_last_sync || "").localeCompare(String(b.track17_last_sync || "")));
  const active = eligible.slice(0, MAX_REFRESH_ROWS);
  const errorCodes = new Set();
  let refreshed = 0, errors = 0, skipped = rows.length - active.length;
  if (eligible.length > active.length) errorCodes.add("TRACK17_BATCH_LIMIT");
  const result = () => ({ refreshed, errors, skipped, errorCodes: [...errorCodes] });
  if (!active.length) return result();
  const payload = active.map(row => row.track17_carrier ? { number:row.tracking_number, carrier:Number(row.track17_carrier) } : { number:row.tracking_number });
  let data;
  try { data = await track17Post(env, "gettrackinfo", payload); }
  catch (err) {
    errors = active.length;
    errorCodes.add(err instanceof ParcelError ? err.code : "TRACK17_ERROR");
    return result();
  }
  if (!Array.isArray(data.accepted)) {
    errors = active.length;
    errorCodes.add("TRACK17_INVALID_RESPONSE");
    return result();
  }
  const accepted = new Map(data.accepted.map(item => [String(item && item.number), item]));
  for (const row of active) {
    try {
      const item = accepted.get(row.tracking_number);
      if (!item) {
        const code = rejectedCode(data, row.tracking_number);
        throw code === null ? new ParcelError("TRACK17_NO_DATA", 404) : errorFor17(code);
      }
      const p = parseTrack17(item);
      // NotFound and empty responses must not replace the last useful status.
      // Expired means automatic tracking stops, while its cached history stays.
      if (p.status === "UNKNOWN" && !p.expired) throw new ParcelError("TRACK17_NO_DATA", 404);
      const synced = nowIso();
      const next = p.expired ? {
        ...p, status:row.status, statusText:row.status_text, etaDate:row.eta_date, etaLatest:row.eta_latest,
        etaFrom:row.eta_from, etaTo:row.eta_to, location:row.location, deliveredAt:row.delivered_at,
        events:parseJson(row.track17_events_json, []),
      } : p;
      // A manual edit while the provider request is running wins over this
      // older response. The user can explicitly refresh again afterwards.
      const update = await env.DB.prepare(`UPDATE parcel_tracker_manual SET status=?,status_text=?,eta_date=?,eta_latest=?,eta_from=?,eta_to=?,location=?,delivered_at=?,track17_carrier=COALESCE(?,track17_carrier),track17_events_json=?,track17_expired=?,track17_last_sync=?,updated_at=? WHERE id=? AND updated_at=? AND status=?`)
        .bind(next.status,next.statusText||null,next.etaDate??null,next.etaLatest??null,next.etaFrom??null,next.etaTo??null,next.location||null,next.deliveredAt??null,p.carrier,JSON.stringify(next.events),p.expired?1:0,synced,synced,row.id,row.updated_at,row.status).run();
      if (update.meta?.changes === 0) {
        skipped += 1;
        errorCodes.add("PARCEL_CHANGED_DURING_REFRESH");
      } else refreshed += 1;
    } catch (err) {
      errors += 1;
      errorCodes.add(err instanceof ParcelError ? err.code : "PARCEL_SAVE_FAILED");
    }
  }
  return result();
}
async function refreshOne(env, id) {
  const row = await getManual(env, id);
  if (!row.track17_registered) throw new ParcelError("TRACK17_NOT_REGISTERED", 409);
  const result = await refreshRows(env, [row], { force: true });
  return { ...result, parcel: manualView(await getManual(env, id)) };
}
export async function refreshManualParcels(env) {
  if (!track17Configured(env)) return { refreshed:0, errors:0, skipped:0, errorCodes:["TRACK17_NOT_CONFIGURED"] };
  if (!env.DB) return { refreshed:0, errors:0, skipped:0, errorCodes:["PARCEL_TRACKER_NOT_READY"] };
  let rows;
  try {
    rows = (await env.DB.prepare("SELECT * FROM parcel_tracker_manual WHERE track17_registered=1 AND track17_expired=0").all()).results || [];
  } catch (err) {
    return { refreshed:0, errors:0, skipped:0, errorCodes:[/no such table/i.test(String(err?.message)) ? "PARCEL_TRACKER_NOT_READY" : "PARCEL_LOAD_FAILED"] };
  }
  return refreshRows(env, rows);
}

async function readBody(request) {
  if (!request.body) return {};
  let body;
  try { body = await request.json(); } catch { throw new ParcelError("INVALID_JSON", 400); }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new ParcelError("INVALID_JSON", 400);
  return body;
}

export function isAdminParcelsRoute(url) {
  return url.pathname === "/admin/parcels" || url.pathname === "/admin/parcels/quota" ||
    url.pathname === "/admin/parcels/refresh" || /^\/admin\/parcels\/[^/]+(?:\/17track\/register|\/refresh)?$/.test(url.pathname);
}

export async function handleAdminParcels(request, env, url, reqId, origin) {
  if (request.method === "OPTIONS") return new Response(null, { status:204, headers:{...securityHeaders(),...corsHeaders(origin)} });
  try {
    await requireAdmin(request, env);
    const path = url.pathname;
    if (path === "/admin/parcels" && request.method === "GET") return json(await listParcels(env), 200, origin);
    if (path === "/admin/parcels" && request.method === "POST") return json({ parcel: await createManual(env, await readBody(request)) }, 201, origin);
    if (path === "/admin/parcels/quota" && request.method === "GET") return json(await getQuota(env), 200, origin);
    if (path === "/admin/parcels/refresh" && request.method === "POST") return json(await refreshManualParcels(env), 200, origin);

    const reg = /^\/admin\/parcels\/([^/]+)\/17track\/register$/.exec(path);
    if (reg && request.method === "POST") return json(await register17(env, decodeURIComponent(reg[1])), 200, origin);
    const refresh = /^\/admin\/parcels\/([^/]+)\/refresh$/.exec(path);
    if (refresh && request.method === "POST") return json(await refreshOne(env, decodeURIComponent(refresh[1])), 200, origin);
    const one = /^\/admin\/parcels\/([^/]+)$/.exec(path);
    if (one && request.method === "PATCH") return json({ parcel: await updateManual(env, decodeURIComponent(one[1]), await readBody(request)) }, 200, origin);
    if (one && request.method === "DELETE") return json(await deleteManual(env, decodeURIComponent(one[1])), 200, origin);
    throw new ParcelError("METHOD_NOT_ALLOWED", 405);
  } catch (err) {
    if (err instanceof ParcelError) return json({ error:err.code, detail:err.detail || undefined, requestId:reqId }, err.status, origin);
    console.error(JSON.stringify({ level:"error", event:"parcel_tracker_failed", requestId:reqId, message:clean(err && err.message,160) }));
    return json({ error:"PARCEL_TRACKER_FAILED", requestId:reqId }, 500, origin);
  }
}


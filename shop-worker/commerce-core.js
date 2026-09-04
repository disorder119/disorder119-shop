export const CURRENCY = "EUR";
export const RENTAL_RATE_BPS = 1000; // 10.00% of authoritative sale price
export const RESERVATION_TTL_SECONDS = 15 * 60;
export const MAX_REQUEST_BYTES = 32 * 1024;

export const INVENTORY_STATUSES = Object.freeze([
  "AVAILABLE",
  "RESERVED",
  "PAYMENT_PENDING",
  "PAID",
  "PREPARING",
  "SHIPPED",
  "DELIVERED",
  "RETURN_REQUESTED",
  "RETURNED",
  "REFUNDED",
  "CANCELLED",
]);

export const ORDER_STATUSES = Object.freeze([
  "RESERVED", "PAYMENT_PENDING", "PAID", "PREPARING", "SHIPPED",
  "DELIVERED", "RETURN_REQUESTED", "RETURNED", "REFUNDED", "CANCELLED",
]);

export const RENTAL_STATUSES = Object.freeze([
  "RESERVED", "PAYMENT_PENDING", "CONFIRMED", "ACTIVE", "RETURN_DUE",
  "RETURNED", "CANCELLED", "REFUNDED",
]);

const INVENTORY_TRANSITIONS = Object.freeze({
  AVAILABLE: ["RESERVED"],
  RESERVED: ["AVAILABLE", "PAYMENT_PENDING", "CANCELLED"],
  PAYMENT_PENDING: ["RESERVED", "PAID", "CANCELLED"],
  PAID: ["PREPARING", "REFUNDED"],
  PREPARING: ["SHIPPED", "REFUNDED"],
  SHIPPED: ["DELIVERED", "RETURN_REQUESTED"],
  DELIVERED: ["RETURN_REQUESTED"],
  RETURN_REQUESTED: ["RETURNED"],
  RETURNED: ["REFUNDED", "AVAILABLE"],
  REFUNDED: ["AVAILABLE"],
  CANCELLED: ["AVAILABLE"],
});

export function canTransitionInventory(from, to) {
  return from === to || (INVENTORY_TRANSITIONS[from] || []).includes(to);
}

export function parsePriceToCents(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).replace(",", "."));
  if (!Number.isFinite(n) || n <= 0) return null;
  const cents = Math.round((n + Number.EPSILON) * 100);
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null;
}

export function rentalDailyPriceCents(salePriceCents) {
  if (!Number.isSafeInteger(salePriceCents) || salePriceCents <= 0) return null;
  return Math.round((salePriceCents * RENTAL_RATE_BPS) / 10000);
}

export function money(cents) {
  if (!Number.isSafeInteger(cents) || cents < 0) return null;
  return (cents / 100).toFixed(2);
}

export function rentalDayCount(startDate, endDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(startDate || "")) || !/^\d{4}-\d{2}-\d{2}$/.test(String(endDate || ""))) return null;
  const [sy, sm, sd] = startDate.split("-").map(Number);
  const [ey, em, ed] = endDate.split("-").map(Number);
  const s = Date.UTC(sy, sm - 1, sd);
  const e = Date.UTC(ey, em - 1, ed);
  const sCheck = new Date(s);
  const eCheck = new Date(e);
  if (sCheck.getUTCFullYear() !== sy || sCheck.getUTCMonth() !== sm - 1 || sCheck.getUTCDate() !== sd) return null;
  if (eCheck.getUTCFullYear() !== ey || eCheck.getUTCMonth() !== em - 1 || eCheck.getUTCDate() !== ed) return null;
  const days = Math.floor((e - s) / 86400000) + 1;
  return days > 0 && days <= 366 ? days : null;
}

export function rentalQuoteFromItem(item, startDate, endDate) {
  if (!item || typeof item !== "object") throw new Error("UNKNOWN_ITEM");
  if (String(item.public_status || "").toUpperCase() === "SOLD") throw new Error("ITEM_SOLD");
  const days = rentalDayCount(startDate, endDate);
  if (!days) throw new Error("INVALID_RENTAL_DATES");
  const salePriceCents = parsePriceToCents(item.price);
  if (salePriceCents === null) {
    return { currency: CURRENCY, days, dailyPriceCents: null, totalPriceCents: null, priceOnRequest: true };
  }
  const dailyPriceCents = rentalDailyPriceCents(salePriceCents);
  return {
    currency: CURRENCY,
    days,
    salePriceCents,
    dailyPriceCents,
    totalPriceCents: dailyPriceCents * days,
    priceOnRequest: false,
  };
}

export function isValidIdempotencyKey(value) {
  return typeof value === "string" && /^[A-Za-z0-9._:-]{16,128}$/.test(value);
}

export function isValidUuid(value) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function safeText(value, max = 500) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);
}

export function publicOrderNumber(uuid, now = new Date()) {
  const compact = String(uuid || "").replace(/-/g, "").slice(0, 8).toUpperCase();
  const date = now.toISOString().slice(0, 10).replace(/-/g, "");
  return `D119-${date}-${compact}`;
}

export function isoNow() {
  return new Date().toISOString();
}

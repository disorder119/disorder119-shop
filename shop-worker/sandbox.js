// Testshop: test.disorder119.com (sandbox-edge.js) spricht mit
// api-test.disorder119.com - demselben Code wie der echte Server, aber mit
// SANDBOX="1" (wrangler.toml, [env.sandbox]), eigener D1-Datenbank und
// PayPal-Sandbox. Nichts aus dem Testshop darf den echten Shop beruehren:
//
//   * Herkunft: Die Module kennen nur https://disorder119.com. Anfragen vom
//     Testshop laufen deshalb mit dieser Herkunft durch den Server, die
//     Antwort bekommt danach wieder die Testshop-Herkunft.
//   * Katalog: gelesen wird der oeffentliche Stand von main (ohne Schluessel),
//     verkauft wird nur in der Tabelle sandbox_verkauft - nie per Commit.
//   * Mails gehen nur an SANDBOX_MAIL_AN (sonst MAIL_REPLY_TO), Betreff mit
//     "[TEST]"; Telegram-Meldungen beginnen mit "🧪 TEST".
//   * Newsletter-Kontakte bei Brevo bleiben unberuehrt.
import { safeText } from "./commerce-core.js";

export const TESTSHOP_ORIGIN = "https://test.disorder119.com";
export const LIVE_ORIGIN = "https://disorder119.com";
const KATALOG_ROH = "https://raw.githubusercontent.com/disorder119/disorder119-shop/main/data/items.json";
const KATALOG_CACHE_MS = 60 * 1000;

export function istSandbox(env) {
  return String(env?.SANDBOX ?? "").trim() === "1";
}

// ------------------------------------------------------------------ Herkunft

function kopfOhne(headers, name, wert) {
  const h = new Headers(headers);
  h.set(name, wert);
  return h;
}

// Huelle um den ganzen Server (worker-entry.js): Herkunft rein und raus
// uebersetzen, dazu die oeffentliche Liste der im Testshop verkauften Stuecke.
export async function testshopFetch(request, env, weiter) {
  const url = new URL(request.url);
  const origin = request.headers.get("Origin");
  if (url.pathname === "/sandbox/verkauft") return verkauftAntwort(request, env, origin);

  const ausTestshop = origin === TESTSHOP_ORIGIN;
  const anfrage = ausTestshop ? new Request(request, { headers: kopfOhne(request.headers, "Origin", LIVE_ORIGIN) }) : request;
  const antwort = await weiter(anfrage);
  if (!ausTestshop || antwort.headers.get("Access-Control-Allow-Origin") !== LIVE_ORIGIN) return antwort;
  return new Response(antwort.body, {
    status: antwort.status,
    statusText: antwort.statusText,
    headers: kopfOhne(antwort.headers, "Access-Control-Allow-Origin", TESTSHOP_ORIGIN),
  });
}

// ------------------------------------------------------------------ Katalog

let katalogCache = { bis: 0, text: null };

export function sandboxKatalogCacheLeeren() {
  katalogCache = { bis: 0, text: null };
}

async function verkaufteIds(env) {
  if (!env?.DB) return new Set();
  try {
    const { results } = await env.DB.prepare("SELECT item_id FROM sandbox_verkauft").all();
    return new Set((results || []).map(r => String(r.item_id)));
  } catch {
    return new Set();
  }
}

// Wie loadItems in worker.js: { items, sha, text }. Grundlage ist der
// oeffentliche Katalog auf main; im Testshop Verkauftes steht darueber.
export async function sandboxKatalogLaden(env, now = Date.now()) {
  if (!katalogCache.text || katalogCache.bis < now) {
    const res = await fetch(KATALOG_ROH, { headers: { "User-Agent": "disorder119-testshop" } });
    if (!res.ok) throw new Error(`sandbox_katalog_http_${res.status}`);
    katalogCache = { bis: now + KATALOG_CACHE_MS, text: await res.text() };
  }
  const items = JSON.parse(katalogCache.text);
  const verkauft = await verkaufteIds(env);
  for (const item of items) {
    if (!verkauft.has(String(item.id))) continue;
    item.public_status = "SOLD";
    item.status = "Verkauft";
  }
  return { items, sha: "testshop", text: katalogCache.text };
}

export async function sandboxVerkauft(env, itemId, now = new Date().toISOString()) {
  await env.DB.prepare("INSERT OR IGNORE INTO sandbox_verkauft (item_id, verkauft_am) VALUES (?, ?)")
    .bind(String(itemId), now).run();
}

export async function sandboxWiederVerfuegbar(env, itemIds) {
  const ids = [...new Set((Array.isArray(itemIds) ? itemIds : []).map(String).filter(id => /^\d{1,9}$/.test(id)))];
  const geaendert = [];
  for (const id of ids) {
    const r = await env.DB.prepare("DELETE FROM sandbox_verkauft WHERE item_id=?").bind(id).run();
    if (Number(r?.meta?.changes || 0) > 0) geaendert.push(Number(id));
  }
  return { ok: true, geaendert, testshop: true };
}

async function verkauftAntwort(request, env, origin) {
  const kopf = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    Vary: "Origin",
  };
  if (origin === TESTSHOP_ORIGIN) kopf["Access-Control-Allow-Origin"] = origin;
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: kopf });
  if (request.method !== "GET") return new Response(JSON.stringify({ error: "METHOD_NOT_ALLOWED" }), { status: 405, headers: kopf });
  const ids = [...await verkaufteIds(env)].map(Number).sort((a, b) => a - b);
  return new Response(JSON.stringify({ ok: true, verkauft: ids }), { status: 200, headers: kopf });
}

// ------------------------------------------------------------------ Mails und Telegram

// Im Testshop geht jede Mail an das eigene Postfach, egal an wen sie
// eigentlich gerichtet ist. Ohne Ziel: gar nicht senden.
export function sandboxMail(env, message) {
  const ziel = String(env?.SANDBOX_MAIL_AN || env?.MAIL_REPLY_TO || "").trim();
  if (!ziel) return null;
  return {
    ...message,
    to: ziel,
    toName: "Testshop",
    subject: `[TEST] ${safeText(message.subject || "", 190)}`,
    kopieAnShop: false,
  };
}

export function sandboxTelegramText(text) {
  return `🧪 TEST · ${String(text ?? "")}`;
}

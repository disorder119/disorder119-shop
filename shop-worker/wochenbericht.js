// Wochenbericht per Telegram: montags 08:00 (Europe/Berlin) eine Nachricht
// mit der vergangenen Woche - Besuche (nur Menschen), Herkunft, Laender,
// meistgesehene Teile, Warenkorb/Anfragen, Bestellungen und Umsatz,
// Waechter. Alles aus dem, was ohnehin gespeichert ist (keine IP, keine
// Kennung). Ausgeloest vom 15-Minuten-Cron (worker-entry.js); gegen
// Doppelungen merkt sich site_settings die zuletzt gemeldete Kalenderwoche.
// WOCHENBERICHT=aus schaltet ab.
import { artikelName, artikelNummer, euro, herkunftAus, katalogLaden, landName } from "./besucher.js";
import { sendTelegramMessage, telegramFremd, telegramTransportReady, telegramZeile } from "./notifications.js";

const TAG = 24 * 60 * 60 * 1000;
const WOCHE = 7 * TAG;
const SCHLUESSEL = "wochenbericht";
const STUNDE_BERLIN = 8;
const AUS = ["aus", "false", "0", "off", "nein"];
const BEZAHLT = ["PAID", "PREPARING", "SHIPPED", "DELIVERED"];

const iso = ms => new Date(ms).toISOString();

function aktiv(env) {
  return !AUS.includes(String(env?.WOCHENBERICHT ?? "").trim().toLowerCase());
}

// Wochentag, Stunde und Datum in Berlin.
export function berlin(now) {
  const teile = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Berlin", weekday: "short", hour: "2-digit", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(now));
  const w = Object.fromEntries(teile.filter(t => t.type !== "literal").map(t => [t.type, t.value]));
  return { wochentag: w.weekday, stunde: Number(w.hour), datum: `${w.year}-${w.month}-${w.day}` };
}

// ISO-Kalenderwoche des Berliner Datums, z. B. "2026-W46".
export function kalenderwoche(datum) {
  const d = new Date(`${datum}T00:00:00Z`);
  const tag = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - tag);
  const jahr = d.getUTCFullYear();
  const erster = new Date(Date.UTC(jahr, 0, 1));
  const woche = Math.ceil(((d - erster) / TAG + 1) / 7);
  return `${jahr}-W${String(woche).padStart(2, "0")}`;
}

export function wochenberichtFaellig(now) {
  const b = berlin(now);
  return b.wochentag === "Mon" && b.stunde === STUNDE_BERLIN ? kalenderwoche(b.datum) : null;
}

function datumKurz(ms) {
  return new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit" }).format(new Date(ms));
}

function trend(neu, alt) {
  if (!alt) return neu ? " (Vorwoche 0)" : "";
  const p = Math.round(((neu - alt) / alt) * 100);
  return ` (Vorwoche ${alt}, ${p >= 0 ? "+" : ""}${p} %)`;
}

async function zahl(env, sql, ...args) {
  const row = await env.DB.prepare(sql).bind(...args).first();
  return Number(row?.n || 0);
}

async function liste(env, sql, ...args) {
  return (await env.DB.prepare(sql).bind(...args).all()).results || [];
}

// Zahlen der Woche [von, bis) und der Vorwoche. Nur lesend.
export async function wochenDaten(env, now = Date.now()) {
  const bis = iso(now), von = iso(now - WOCHE), vorher = iso(now - 2 * WOCHE);
  const d = { von: now - WOCHE, bis: now };
  const sitz = "FROM besucher_sitzungen WHERE beginn>=? AND beginn<? AND verdacht<2";
  d.besuche = await zahl(env, `SELECT COUNT(*) AS n ${sitz}`, von, bis);
  d.besucheVorwoche = await zahl(env, `SELECT COUNT(*) AS n ${sitz}`, vorher, von);
  d.einwilligung = await zahl(env, `SELECT COUNT(*) AS n ${sitz} AND einwilligung=1`, von, bis);
  d.wiederkehrer = await zahl(env, `SELECT COUNT(*) AS n ${sitz} AND besuch_nr>1`, von, bis);
  d.automatisiert = await zahl(env, "SELECT COUNT(*) AS n FROM besucher_sitzungen WHERE beginn>=? AND beginn<? AND verdacht>=2", von, bis);
  const menschen = `SELECT DISTINCT besucher FROM besucher_sitzungen WHERE beginn>=? AND beginn<? AND verdacht<2`;
  d.laender = await liste(env, `SELECT land, COUNT(DISTINCT besucher) AS n FROM besucher_ereignisse
    WHERE zeit>=? AND zeit<? AND land IS NOT NULL AND land<>'' AND besucher IN (${menschen}) GROUP BY land ORDER BY n DESC, land LIMIT 5`, von, bis, von, bis);
  d.quellen = await liste(env, `SELECT quelle, COUNT(DISTINCT besucher) AS n FROM besucher_ereignisse
    WHERE zeit>=? AND zeit<? AND quelle IS NOT NULL AND quelle<>'' AND besucher IN (${menschen}) GROUP BY quelle ORDER BY n DESC, quelle LIMIT 5`, von, bis, von, bis);
  d.artikel = await liste(env, `SELECT artikel_id, MAX(titel) AS titel, COUNT(DISTINCT besucher) AS n FROM besucher_ereignisse
    WHERE zeit>=? AND zeit<? AND typ='artikel' AND artikel_id IS NOT NULL AND besucher IN (${menschen}) GROUP BY artikel_id ORDER BY n DESC, artikel_id LIMIT 5`, von, bis, von, bis);
  d.warenkorb = await zahl(env, "SELECT COUNT(*) AS n FROM besucher_ereignisse WHERE zeit>=? AND zeit<? AND typ='warenkorb_rein'", von, bis);
  d.anfragen = await zahl(env, "SELECT COUNT(*) AS n FROM besucher_ereignisse WHERE zeit>=? AND zeit<? AND typ='anfrage'", von, bis);
  const platz = BEZAHLT.map(() => "?").join(",");
  const best = await env.DB.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(total_cents),0) AS cents FROM commerce_orders
    WHERE versteckt=0 AND created_at>=? AND created_at<? AND status IN (${platz})`).bind(von, bis, ...BEZAHLT).first().catch(() => null);
  d.bestellungen = Number(best?.n || 0);
  d.umsatzCents = Number(best?.cents || 0);
  const bestVor = await env.DB.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(total_cents),0) AS cents FROM commerce_orders
    WHERE versteckt=0 AND created_at>=? AND created_at<? AND status IN (${platz})`).bind(vorher, von, ...BEZAHLT).first().catch(() => null);
  d.bestellungenVorwoche = Number(bestVor?.n || 0);
  d.umsatzVorwocheCents = Number(bestVor?.cents || 0);
  d.verkauft = await liste(env, `SELECT i.title_snapshot AS titel, i.unit_price_cents AS cents, i.article_no AS nr FROM order_items i
    JOIN commerce_orders o ON o.id=i.order_id WHERE o.versteckt=0 AND o.created_at>=? AND o.created_at<? AND o.status IN (${platz}) ORDER BY o.created_at LIMIT 10`, von, bis, ...BEZAHLT).catch(() => []);
  d.storniert = await zahl(env, "SELECT COUNT(*) AS n FROM commerce_orders WHERE versteckt=0 AND created_at>=? AND created_at<? AND status IN ('CANCELLED','REFUNDED')", von, bis).catch(() => 0);
  d.sperren = await zahl(env, "SELECT COUNT(*) AS n FROM waechter_sperren WHERE seit>=? AND seit<?", von, bis).catch(() => 0);
  d.vorfaelle = await zahl(env, "SELECT COUNT(*) AS n FROM waechter_vorfaelle WHERE zeit>=? AND zeit<?", von, bis).catch(() => 0);
  d.kampagnen = await zahl(env, "SELECT COUNT(*) AS n FROM waechter_kampagnen WHERE seit>=? AND seit<?", von, bis).catch(() => 0);
  return d;
}

function quelleName(quelle) {
  const h = herkunftAus(quelle);
  return h.kanal !== "unbekannt" ? h.name : telegramFremd(quelle, 40);
}

// Reiner Text, testbar ohne Netz. map = Katalog (artikelId -> Artikel).
export function wochenberichtText(d, map = new Map()) {
  const zeilen = [`📊 WOCHENBERICHT ${datumKurz(d.von)}–${datumKurz(d.bis - TAG)}`];
  zeilen.push(`👥 ${d.besuche} Besuche${trend(d.besuche, d.besucheVorwoche)}`
    + (d.einwilligung ? ` · ${d.einwilligung} mit Statistik-Einwilligung` : "")
    + (d.wiederkehrer ? ` · ${d.wiederkehrer} Wiederkehrer` : ""));
  if (d.automatisiert) zeilen.push(`🤖 ${d.automatisiert} automatisierte Aufrufe ausgefiltert (nicht mitgezählt)`);
  if (d.laender?.length) zeilen.push(`📍 ${d.laender.map(l => `${landName(l.land) || l.land} ${l.n}`).join(", ")}`);
  if (d.quellen?.length) zeilen.push(`↪️ ${d.quellen.map(q => `${quelleName(q.quelle)} ${q.n}`).join(", ")}`);
  else zeilen.push("↪️ Keine Herkunft übermittelt (direkt, In-App oder unbekannt)");
  if (d.artikel?.length) {
    zeilen.push("👀 Meistgesehen:");
    for (const a of d.artikel) {
      const it = map.get(String(a.artikel_id));
      const name = it ? `#${artikelNummer(a.artikel_id, it)} ${artikelName(it)}${euro(it.price) ? ` (${euro(it.price)})` : ""}` : (a.titel || `Artikel ${a.artikel_id}`);
      zeilen.push(`• ${telegramZeile(name, 90)} · ${a.n}×`);
    }
  }
  zeilen.push(`🛒 ${d.warenkorb}× in den Warenkorb · 💬 ${d.anfragen} Anfragen`);
  const umsatz = (d.umsatzCents / 100).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const umsatzVor = (d.umsatzVorwocheCents / 100).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  zeilen.push(`💶 ${d.bestellungen} ${d.bestellungen === 1 ? "Bestellung" : "Bestellungen"} · ${umsatz} € (Vorwoche ${d.bestellungenVorwoche} · ${umsatzVor} €)`
    + (d.storniert ? ` · ${d.storniert} storniert/erstattet` : ""));
  for (const v of (d.verkauft || []).slice(0, 10)) {
    zeilen.push(`• ${v.nr ? `#${telegramZeile(v.nr, 10)} ` : ""}${telegramZeile(v.titel, 80)} · ${(Number(v.cents || 0) / 100).toLocaleString("de-DE")} €`);
  }
  if (d.besuche && !d.bestellungen) zeilen.push("💡 Besuche ohne Kauf: Preise, erstes Foto und Größenangaben der meistgesehenen Teile prüfen.");
  zeilen.push(`🛡 ${d.sperren} Sperren · ${d.vorfaelle} abgewehrte Versuche${d.kampagnen ? ` · ${d.kampagnen} Kampagnen` : ""}`);
  zeilen.push("Details: Admin-App → Besucher");
  return zeilen.join("\n").slice(0, 4000);
}

async function zuletztGemeldet(env) {
  try {
    const row = await env.DB.prepare("SELECT value FROM site_settings WHERE key=?").bind(SCHLUESSEL).first();
    return row ? JSON.parse(row.value)?.woche || null : null;
  } catch {
    return null;
  }
}

async function merken(env, woche, now) {
  await env.DB.prepare(`INSERT INTO site_settings (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`)
    .bind(SCHLUESSEL, JSON.stringify({ woche, gesendet: iso(now) }), iso(now)).run();
}

// Vom Cron: schickt den Bericht genau einmal je Kalenderwoche im Montagsfenster.
// erzwingen=true (Admin/Test) schickt sofort, ohne das Fenster zu pruefen.
export async function wochenberichtSenden(env, now = Date.now(), { erzwingen = false } = {}) {
  if (!env?.DB || !aktiv(env) || !telegramTransportReady(env)) return { gesendet: 0, grund: "aus" };
  const woche = erzwingen ? kalenderwoche(berlin(now).datum) : wochenberichtFaellig(now);
  if (!woche) return { gesendet: 0, grund: "nicht faellig" };
  if (!erzwingen && (await zuletztGemeldet(env)) === woche) return { gesendet: 0, grund: "schon gemeldet" };
  try {
    const daten = await wochenDaten(env, now);
    let map = new Map();
    try { map = await katalogLaden(env); } catch { /* ohne Katalog: Titel aus den Ereignissen */ }
    const ergebnis = await sendTelegramMessage(env, wochenberichtText(daten, map));
    if (!ergebnis?.sent) return { gesendet: 0, grund: ergebnis?.reason || "telegram" };
    await merken(env, woche, now);
    return { gesendet: 1, woche };
  } catch (err) {
    if (!/no such (table|column)/i.test(String(err?.message || err))) {
      console.error(JSON.stringify({ level: "error", event: "weekly_report_failed", message: String(err?.message || err).slice(0, 160) }));
    }
    return { gesendet: 0, grund: "fehler" };
  }
}

// Telegram-Zusammenfassung je Besuch (Migration 0040, besucher-sitzung.js).
//
// sitzungenMelden() nimmt jeden faelligen Besuch genau einmal (Status 3 als
// Sperre gegen doppelte Laeufe von Wecker, Seitenaufruf und Cron), baut aus
// den gespeicherten Ereignissen eine Nachricht und schickt sie. Der
// Stunden-Deckel BESUCHER_TELEGRAM_PRO_STUNDE (Standard 40) bleibt.
// Inhalt nur aus dem, was ohnehin gespeichert ist: keine IP, keine Kennung.
import {
  artikelNummer, artikelName, besucherLabel, euro, herkunftAus, katalogLaden, landName, sitzungenBilden,
  spracheName, telegramModus,
} from "./besucher.js";
import { sendTelegramMessage, telegramFremd, telegramTransportReady, telegramZeile } from "./notifications.js";
import { sperreLesen } from "./site-lock.js";

const MINUTE = 60_000;
const STANDARD_PRO_STUNDE = 40;
const MAX_SCHRITTE = 14;

function ganzzahl(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n) || String(value ?? "").trim() === "") return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

const iso = ms => new Date(ms).toISOString();

function uhr(isoText) {
  return new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" }).format(new Date(isoText));
}

function datum(text) {
  const d = new Date(`${text}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", year: "numeric" }).format(d);
}

export function dauerText(ms) {
  if (ms == null || !Number.isFinite(ms)) return null;
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} Sek.`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}:${String(s % 60).padStart(2, "0")} Min.`;
  return `${Math.floor(m / 60)} Std. ${m % 60} Min.`;
}

const SEITEN = {
  "/": "Startseite (Archiv)", "/cart/": "Warenkorb", "/kasse/": "Kasse", "/faq/": "FAQ", "/mieten/": "Mieten",
  "/universe/": "Universum", "/chaos/": "Universum", "/match/": "Match", "/baukasten/": "Outfit-Baukasten",
  "/konto/": "Kundenkonto", "/newsletter/": "Newsletter", "/impressum/": "Impressum", "/datenschutz/": "Datenschutz",
  "/agb/": "AGB", "/ueber-uns/": "Über uns", "/widerruf/": "Widerruf",
};

function seitenName(pfad) {
  let p = String(pfad || "/");
  let sprache = "";
  const m = /^\/(en|fr)(\/.*)?$/.exec(p);
  if (m) { sprache = ` (${m[1].toUpperCase()})`; p = m[2] || "/"; }
  // Fremder Pfad (kann jeder aufrufen): Links darin entschaerft.
  return `${SEITEN[p] || telegramFremd(p, 60)}${sprache}`;
}

function artikelZeile(artikelId, titel, map) {
  const it = artikelId ? map.get(String(artikelId)) : null;
  if (!it) return telegramZeile(titel ? `${titel}` : `Artikel ${artikelId}`, 110);
  const preis = euro(it.price);
  return telegramZeile(`#${artikelNummer(artikelId, it)} ${artikelName(it)}${preis ? ` (${preis})` : ""}`, 110);
}

const KANAL = { whatsapp: "WhatsApp", email: "E-Mail", gmail: "Gmail", paypal: "PayPal" };

function herkunftText(s) {
  const h = herkunftAus(s.quelle);
  const teile = [];
  // Verweis-Domain und Kampagne stammen vom Besucher: nicht klickbar.
  if (h.kanal !== "unbekannt") teile.push(h.domain && h.domain !== h.name.toLowerCase() + ".com" ? `${h.name} (${telegramFremd(h.domain, 60)})` : h.name);
  else if (/Instagram|TikTok|Facebook/.test(s.browser || "")) teile.push(`${String(s.browser).replace("-App", "")} (In-App-Browser, ohne Verweis)`);
  else teile.push("direkt oder unbekannt (keine Herkunft übermittelt)");
  if (s.kampagne) teile.push(`Kampagne ${telegramFremd(s.kampagne, 60)}`);
  return teile.join(" · ");
}

function wiederkehrText(lauf, heuteNr) {
  if (lauf?.besuch_nr) {
    const nr = Number(lauf.besuch_nr);
    if (nr <= 1) return "🆕 Erster Besuch (laut Browser-Speicher)";
    const teile = [`🔁 ${nr}. Besuch`];
    if (lauf.erster_besuch && datum(lauf.erster_besuch)) teile.push(`zuerst am ${datum(lauf.erster_besuch)}`);
    if (lauf.vorher_besuch && datum(lauf.vorher_besuch)) teile.push(`davor zuletzt am ${datum(lauf.vorher_besuch)}`);
    return teile.join(" · ");
  }
  if (heuteNr > 1) return `🔁 Heute schon der ${heuteNr}. Besuch (über Tage hinweg nur mit Einwilligung erkennbar)`;
  return lauf?.einwilligung
    ? "🆕 Erster Besuch heute"
    : "🆕 Erster Besuch heute · ohne Einwilligung keine Wiedererkennung an anderen Tagen";
}

// Reine Textbausteine: s = Sitzung aus sitzungenBilden, lauf = Zeile aus
// besucher_sitzungen, map = Katalog. Kein Netz, damit testbar.
export function zusammenfassungText(s, lauf, map = new Map(), { heuteNr = 1, gesperrt = false, schluessel = "" } = {}) {
  const ort = s.ort || {};
  const label = besucherLabel(schluessel, { geraet: s.geraet, stadt: ort.stadt, land: ort.land });
  const einwilligung = Boolean(lauf?.einwilligung) || s.datenUmfang === "browser_detail";
  const abschied = lauf?.abschied && Date.parse(lauf.abschied) >= Date.parse(lauf.zuletzt);
  const zeilen = [`👋 BESUCH VORBEI · ${label}`];

  const dauer = dauerText(s.dauerBekannt ? s.dauerMs : null);
  const sichtbar = s.vordergrundMs != null ? dauerText(s.vordergrundMs) : null;
  zeilen.push(`🕒 ${uhr(s.start)}–${uhr(s.ende)} Uhr${dauer ? ` · ${dauer}` : " · nur ein Aufruf"}${sichtbar ? ` (davon ${sichtbar} Tab sichtbar)` : ""}`);
  zeilen.push(`📍 ${[ort.stadt, ort.region && ort.region !== ort.stadt ? ort.region : null, landName(ort.land)].filter(Boolean).join(", ") || "Ort unbekannt"}`);
  zeilen.push(`📱 ${[s.geraet, s.system, s.browser].filter(Boolean).join(" · ") || "Gerät unbekannt"}`);
  const sprachen = [];
  if (s.sprache) sprachen.push(`Seite ${spracheName(s.sprache) || s.sprache}`);
  if (s.browserSprache) sprachen.push(`Browser ${spracheName(s.browserSprache) || s.browserSprache}`);
  if (s.sprache && s.browserSprache && s.sprache === s.browserSprache) zeilen.push(`🗣 ${spracheName(s.sprache) || s.sprache}`);
  else if (sprachen.length) zeilen.push(`🗣 ${sprachen.join(" · ")}`);
  zeilen.push(`↪️ ${herkunftText(s)}`);
  zeilen.push(wiederkehrText(lauf, heuteNr));

  zeilen.push(`📄 ${s.seiten} ${s.seiten === 1 ? "Seite" : "Seiten"}${s.artikel ? ` · ${s.artikel} Artikel angesehen` : ""}`);
    const liste = [];
  for (const x of s.schritte) {
    const zeit = x.vordergrundMs != null ? dauerText(x.vordergrundMs) : x.dauerMs != null ? `≈ ${dauerText(x.dauerMs)}` : null;
    let text;
    if (x.typ === "seite") text = seitenName(x.pfad);
    else if (x.typ === "artikel") text = artikelZeile(x.artikelId, x.titel, map);
    else if (x.typ === "warenkorb_rein") text = `🛒 + ${artikelZeile(x.artikelId, x.titel, map)}`;
    else if (x.typ === "warenkorb_raus") text = `🛒 − ${artikelZeile(x.artikelId, x.titel, map)}`;
    else if (x.typ === "anfrage") text = `💬 Anfrage per ${KANAL[x.kanal] || "Nachricht"} geöffnet (${x.warenkorb} im Warenkorb)`;
    else continue;
    liste.push(`${liste.length + 1}. ${text}${zeit && ["seite", "artikel"].includes(x.typ) ? ` · ${zeit}` : ""}`);
  }
  if (liste.length) {
    zeilen.push("👉 Verlauf:");
    zeilen.push(...liste.slice(0, MAX_SCHRITTE));
    if (liste.length > MAX_SCHRITTE) zeilen.push(`… und ${liste.length - MAX_SCHRITTE} weitere Schritte (Admin-App)`);
  }

  // Warenkorb am Ende: letzter Stand je Artikel.
  const drin = new Map();
  for (const x of s.schritte) {
    if (x.typ === "warenkorb_rein") drin.set(x.artikelId, x);
    if (x.typ === "warenkorb_raus") drin.delete(x.artikelId);
  }
  if (drin.size) {
    zeilen.push(`🧾 Am Ende im Warenkorb (${drin.size}):`);
    for (const x of [...drin.values()].slice(0, 8)) zeilen.push(`• ${artikelZeile(x.artikelId, x.titel, map)}`);
  } else if (s.warenkorb) {
    zeilen.push("🧾 Warenkorb am Ende wieder leer");
  }
  if (lauf?.entsperrt) zeilen.push("🔓 Hat das Passwort für den gesperrten Shop eingegeben");
  zeilen.push(abschied ? "🚪 Seite geschlossen bzw. App gewechselt" : "⏱ Keine Aktivität mehr – Besuch gilt als beendet");
  zeilen.push(einwilligung
    ? "✅ Statistik erlaubt (Detaildaten mit Einwilligung)"
    : "🔒 Ohne Einwilligung: nur Seitenaufrufe, Land, Gerät und Herkunft");
  if (gesperrt) zeilen.push("🔒 Shop ist gesperrt: ohne Passwort sieht man nur die Sperrseite");
  return zeilen.join("\n").slice(0, 4000);
}

async function budgetFrei(env, now) {
  const max = ganzzahl(env?.BESUCHER_TELEGRAM_PRO_STUNDE, STANDARD_PRO_STUNDE, 0, 1000);
  if (max === 0) return false;
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM besucher_sitzungen WHERE gemeldet=1 AND gemeldet_zeit>=?")
    .bind(iso(now - 60 * MINUTE)).first();
  return Number(row?.n || 0) < max;
}

async function abschliessen(env, id, gemeldet, grund, now) {
  await env.DB.prepare("UPDATE besucher_sitzungen SET gemeldet=?, meldung_grund=?, gemeldet_zeit=?, offen=0 WHERE id=?")
    .bind(gemeldet, grund, iso(now), id).run();
}

// Baut die Sitzung eines Lebenslauf-Eintrags aus den gespeicherten Daten.
export async function sitzungLaden(env, lauf) {
  const von = iso(Date.parse(lauf.beginn) - 1000);
  const bis = iso(Math.max(Date.parse(lauf.zuletzt), Date.parse(lauf.abschied || lauf.zuletzt)) + 1000);
  const { results: zeilen } = await env.DB.prepare(`SELECT * FROM besucher_ereignisse
    WHERE besucher=? AND zeit>=? AND zeit<=? ORDER BY zeit, id LIMIT 500`).bind(lauf.besucher, von, bis).all();
  if (!zeilen?.length) return null;
  let verlassen = [], sicht = [];
  try {
    verlassen = (await env.DB.prepare("SELECT besucher, zeit, pfad FROM besucher_verlassen WHERE besucher=? AND zeit>=? AND zeit<=? ORDER BY zeit")
      .bind(lauf.besucher, von, bis).all()).results || [];
  } catch { /* Migration 0020 fehlt */ }
  try {
    sicht = (await env.DB.prepare("SELECT besucher,beginn,zuletzt,pfad,artikel_id,sicht_ms,begrenzt FROM besucher_sichtzeit WHERE besucher=? AND zuletzt>=? AND beginn<=? ORDER BY beginn")
      .bind(lauf.besucher, von, bis).all()).results || [];
  } catch { /* Migration 0039 fehlt */ }
  const teile = sitzungenBilden(zeilen, verlassen, sicht).sort((a, b) => a.start.localeCompare(b.start));
  if (teile.length === 1) return teile[0];
  // Selten (lange Pause innerhalb eines Besuchs): Teile zusammenlegen.
  const erste = teile[0], letzte = teile[teile.length - 1];
  return {
    ...erste,
    ende: letzte.ende,
    dauerMs: Date.parse(letzte.ende) - Date.parse(erste.start),
    dauerBekannt: true,
    vordergrundMs: teile.some(t => t.vordergrundMs != null) ? teile.reduce((n, t) => n + (t.vordergrundMs || 0), 0) : null,
    seiten: teile.reduce((n, t) => n + t.seiten, 0),
    artikel: new Set(teile.flatMap(t => t.schritte.filter(x => x.typ === "artikel" && x.artikelId).map(x => x.artikelId))).size,
    warenkorb: teile.reduce((n, t) => n + t.warenkorb, 0),
    anfrage: teile.some(t => t.anfrage),
    schritte: teile.flatMap(t => t.schritte),
  };
}

// Faellige Besuche melden. Gibt { gesendet, uebersprungen } zurueck.
export async function sitzungenMelden(env, now = Date.now(), { limit = 10 } = {}) {
  const ergebnis = { gesendet: 0, uebersprungen: 0 };
  if (!env?.DB) return ergebnis;
  let faellige;
  try {
    // Nach einem Absturz mitten im Senden: nach 10 Minuten neu versuchen.
    await env.DB.prepare("UPDATE besucher_sitzungen SET gemeldet=0 WHERE gemeldet=3 AND gemeldet_zeit<?").bind(iso(now - 10 * MINUTE)).run();
    faellige = (await env.DB.prepare("SELECT * FROM besucher_sitzungen WHERE gemeldet=0 AND faellig<=? ORDER BY faellig LIMIT ?")
      .bind(iso(now), ganzzahl(limit, 10, 1, 100)).all()).results || [];
  } catch (err) {
    if (!/no such (table|column)/i.test(String(err?.message || err))) throw err;
    return ergebnis; // Migration 0040 fehlt noch
  }
  let map = null, gesperrt = null;
  for (const lauf of faellige) {
    const genommen = await env.DB.prepare("UPDATE besucher_sitzungen SET gemeldet=3, offen=0, gemeldet_zeit=? WHERE id=? AND gemeldet=0 AND faellig<=?")
      .bind(iso(now), lauf.id, iso(now)).run();
    if (Number(genommen?.meta?.changes || 0) !== 1) continue;
    try {
      if (telegramModus(env) === "aus" || !telegramTransportReady(env)) { await abschliessen(env, lauf.id, 2, "aus", now); ergebnis.uebersprungen++; continue; }
      const s = await sitzungLaden(env, lauf);
      if (!s) { await abschliessen(env, lauf.id, 2, "leer", now); ergebnis.uebersprungen++; continue; }
      if (!(await budgetFrei(env, now))) { await abschliessen(env, lauf.id, 2, "deckel", now); ergebnis.uebersprungen++; continue; }
      map ??= await katalogLaden(env);
      gesperrt ??= Boolean((await sperreLesen(env).catch(() => ({})))?.locked);
      const heute = await env.DB.prepare("SELECT COUNT(*) AS n FROM besucher_sitzungen WHERE besucher=? AND id<=?").bind(lauf.besucher, lauf.id).first();
      const text = zusammenfassungText(s, lauf, map, { heuteNr: Number(heute?.n || 1), gesperrt, schluessel: lauf.besucher });
      const gesendet = await sendTelegramMessage(env, text);
      if (!gesendet?.sent) throw new Error(`telegram_${gesendet?.reason || "failed"}`);
      await abschliessen(env, lauf.id, 1, null, now);
      ergebnis.gesendet++;
    } catch (err) {
      console.error(JSON.stringify({ level: "error", event: "besucher_summary_failed", message: String(err?.message || err).slice(0, 160) }));
      // Zweimal in 5 Minuten neu versuchen, dann aufgeben.
      const versuche = Number(lauf.versuche || 0) + 1;
      if (versuche >= 3) await abschliessen(env, lauf.id, 2, "fehler", now).catch(() => {});
      else await env.DB.prepare("UPDATE besucher_sitzungen SET gemeldet=0, versuche=?, faellig=? WHERE id=?")
        .bind(versuche, iso(now + 5 * MINUTE), lauf.id).run().catch(() => {});
    }
  }
  return ergebnis;
}

export async function naechsteFaelligkeit(env) {
  try {
    const row = await env.DB.prepare("SELECT MIN(faellig) AS t FROM besucher_sitzungen WHERE gemeldet=0").first();
    const t = Date.parse(row?.t || "");
    return Number.isFinite(t) ? t : null;
  } catch {
    return null;
  }
}

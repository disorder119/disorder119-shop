// Waechter: sperrt "komische Besucher" (Scanner, Angriffsproben,
// Angriffs-Programme, Fluten, durchprobierte Codes, Bots in Formularen) und
// warnt gebuendelt per Telegram. Regeln in waechter-regeln.js, Seiten fuer
// disorder119.com in waechter-seiten.js, Tabellen aus Migration 0041/0042.
//
// Stufen:
// - Eindeutiger Angriff (SQL-Injection, XSS, Path-Traversal, Log4Shell,
//   Angriffs-Programm) sperrt sofort, ohne Selbst-Entsperrung.
// - Alles andere sperrt erst ab einer Schwelle (SCHWELLEN) und darf sich per
//   Turnstile ("Ich bin ein Mensch") selbst entsperren - geteilte Anschluesse
//   (Mobilfunk-CGNAT, iCloud Privat-Relay, Firmen-NAT) sollen echte Kunden
//   nicht dauerhaft aussperren. Wer danach wieder auffaellt, bekommt keine
//   Turnstile-Option mehr.
// - Erste Sperre 24 h; eine erneute Sperre innerhalb von 7 Tagen nach dem
//   Ende der letzten dauert 7 Tage (Wiederholungstaeter).
// - Kampagne: dieselbe Angriffssignatur (Grund + normalisierter Pfad) von
//   mindestens drei Anschluessen in zehn Minuten = verteilter Angriff. Dann
//   fuer WAECHTER_KAMPAGNE_STUNDEN (Standard 2, 1-6) strenger: Anschluesse
//   aus beteiligten Netzen (cf.asn) sperrt schon der erste Scanner-Pfad.
// - Rechenzentren/Hoster (istHosting) gelten immer als streng: erster
//   Scanner-Pfad sperrt, 404-Flut ab 10.
// - Angriffsmuster, die eine FREMDE Seite ausgeloest hat (Sec-Fetch-Site:
//   cross-site, z. B. <img src="https://disorder119.com/?q=<svg..">), werden
//   nur abgewiesen, nie gezaehlt oder gesperrt - sonst koennte jede fremde
//   Seite unsere Kunden aussperren. Wer den Kopf faelscht, bleibt abgewiesen.
//
// Datenschutz: nie die IP, nur ein Hash des Anschlusses (IPv6 je /64) mit dem
// geheimen Pfeffer LOGIN_IP_PEPPER; dazu Land, Netz, Kurzform der
// Browserkennung, Grund, gekuerzter Pfad, Anzahl. Vorfaelle verschwinden nach
// 24 h, Sperren 7 Tage nach ihrem Ablauf, Kampagnen nach 7 Tagen.
//
// Telegram: neue Sperren und Kampagnen werden gesammelt und hoechstens alle
// 10 Minuten als EINE Nachricht geschickt (Wecker-Durable-Object ca. eine
// Minute nach der ersten Sperre, Cron als Rueckfall).
//
// Nie gesperrt: verifizierte Bots (Cloudflare oder Kennung + Netz des
// Betreibers), PayPal-, Packlink- und eBay-Meldungen, die Manager-Verbindung,
// die interne Dienstbindung und die Admin-Routen (Passkey-geschuetzt - der
// Inhaber kommt immer an "Sperre aufheben"). Die Widerrufsfunktion bleibt
// auch fuer gesperrte Anschluesse erreichbar (nur Angriffsmuster nicht).
// Ohne Migration oder Pfeffer und bei D1-Ausfall arbeitet der Shop normal
// weiter (fail-open); die einzelne Probe-Anfrage bekommt trotzdem 404/403.
import { anschlussVonIp, ipPepper } from "./privacy-security.js";
import {
  GRUND_TEXT, HARTE_GRUENDE, angriffsSignatur, bekannterBot, fremdAusgeloest, istHosting, kurzPfad, netzVon, verifizierterBot, waechterPruefen,
} from "./waechter-regeln.js";
import { geraetUndBrowser, landName } from "./besucher.js";
import { weckerStellen } from "./besucher-sitzung.js";
import { sendTelegramMessage, telegramFremd, telegramTransportReady, telegramZeile } from "./notifications.js";
import { isPacklinkWebhookRoute } from "./packlink.js";

const MINUTE = 60_000;
const STUNDE = 60 * MINUTE;
const TAG = 24 * STUNDE;
const SPERRE_MS = TAG;
const WIEDERHOLT_MS = 7 * TAG;
const RUECKFALL_FENSTER = 7 * TAG;
// [Schwelle, Fenster, gezaehlte Arten]
const SCHWELLEN = Object.freeze({
  probe: [3, 10 * MINUTE, ["probe"]],
  "404": [20, 5 * MINUTE, ["404", "probe"]],
  flut: [3, 10 * MINUTE, ["flut"]],
  enum: [12, 30 * MINUTE, ["enum"]],
  kasse: [8, 30 * MINUTE, ["kasse"]],
  falle: [2, TAG, ["falle"]],
});
const ART_GRUND = Object.freeze({
  "404": "zu-viele-404", flut: "zu-viele-anfragen", enum: "codes-durchprobiert", kasse: "kasse-fehlschlaege", falle: "formular-falle",
});
const ARTEN = Object.freeze(["angriff", ...Object.keys(SCHWELLEN)]);
const KAMPAGNE_MIN = 3;
const KAMPAGNE_FENSTER = 10 * MINUTE;
const BUENDEL_WARTEN = MINUTE;
const MELDE_ABSTAND = 10 * MINUTE;
const TURNSTILE_HOSTS = Object.freeze(["disorder119.com", "www.disorder119.com", "test.disorder119.com"]);

const ADMIN_ORIGINS = Object.freeze(["https://admin.disorder119.com", "http://localhost:8765", "http://127.0.0.1:8765"]);
const AUS = ["aus", "false", "0", "off", "nein"];

export function waechterAktiv(env) {
  return !AUS.includes(String(env?.WAECHTER ?? "").trim().toLowerCase());
}

function ganzzahl(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n) || String(value ?? "").trim() === "") return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

const iso = ms => new Date(ms).toISOString();
const fehlendeTabelle = err => /no such (table|column)|has no column/i.test(String(err?.message || err));
const kampagneStunden = env => ganzzahl(env?.WAECHTER_KAMPAGNE_STUNDEN, 2, 1, 6);

export async function anschlussHash(env, ip) {
  const netz = anschlussVonIp(ip);
  if (!netz) return null;
  const bytes = new TextEncoder().encode(`waechter:netz:${netz}:${ipPepper(env)}`);
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), b => b.toString(16).padStart(2, "0")).join("");
}

// Kurzform der Browserkennung: Werkzeugname, sonst Geraet · Browser, sonst
// das erste Produktkuerzel ("python-requests/2.31").
export function uaKurz(ua) {
  const text = String(ua || "").trim();
  if (!text) return "ohne Browserkennung";
  const werkzeug = /\b(sqlmap|nikto|nuclei|masscan|zgrab|gobuster|dirbuster|wpscan|acunetix|nessus|openvas|netsparker|w3af|havij|feroxbuster|ffuf|joomscan|whatweb|commix|xsstrike|jaeles)(?:\/[\w.]+)?/i.exec(text);
  if (werkzeug) return werkzeug[0].slice(0, 40);
  if (/^Mozilla\//.test(text)) {
    const { geraet, browser } = geraetUndBrowser(text);
    return `${geraet} · ${browser}`;
  }
  return telegramZeile(text.split(/\s+/)[0], 40);
}

function logFehler(event, err) {
  console.error(JSON.stringify({ level: "error", event, message: String(err?.message || err).slice(0, 160) }));
}

function signaturAus(pfad, grund) {
  try { return angriffsSignatur(new URL(String(pfad || "/"), "https://disorder119.com"), grund).slice(0, 160); }
  catch { return `${grund}|?`; }
}

export function zielAusSignatur(signatur) {
  const text = String(signatur || "");
  return text.includes("|") ? text.slice(text.indexOf("|") + 1) : text;
}

// ---------------------------------------------------------------- Pruefen

// Gegen Schreib-Fluten: ein gesperrter Angreifer darf mit jeder Anfrage nur
// lesen, geschrieben wird hoechstens einmal je Minute und Anschluss (Anzahl
// im Speicher gesammelt). Meldungen aus dem Anfrageweg (404, Flut) hoechstens
// alle 2 Sekunden je Anschluss.
const drossel = new Map();
const offeneVersuche = new Map();
export function waechterSpeicherLeeren() { drossel.clear(); offeneVersuche.clear(); }
function gedrosselt(schluessel, ms, now) {
  if ((drossel.get(schluessel) || -Infinity) > now - ms) return true;
  if (drossel.size > 5000) drossel.clear();
  drossel.set(schluessel, now);
  return false;
}
async function versuchZaehlen(env, id, hash, now, verlaengern) {
  const z = offeneVersuche.get(hash) || { n: 0, seit: -Infinity };
  z.n++;
  if (z.seit > now - MINUTE) { offeneVersuche.set(hash, z); return false; }
  if (offeneVersuche.size > 5000) offeneVersuche.clear();
  offeneVersuche.set(hash, { n: 0, seit: now });
  await env.DB.prepare(`UPDATE waechter_sperren SET versuche=versuche+?, zuletzt=?${verlaengern ? ", bis=MAX(bis, ?)" : ""} WHERE id=?`)
    .bind(...(verlaengern ? [z.n, iso(now), iso(now + SPERRE_MS), id] : [z.n, iso(now), id])).run().catch(() => {});
  return true;
}

async function aktiveSperre(env, hash, now) {
  // SELECT * statt fester Spalten: laeuft auch vor Migration 0042.
  return env.DB.prepare(`SELECT * FROM waechter_sperren
    WHERE anschluss=? AND aufgehoben IS NULL AND bis>? LIMIT 1`).bind(hash, iso(now)).first();
}

// null oder { gesperrt: true, selbst, bis, grund }. Zaehlt den Versuch mit.
export async function waechterSperrInfo(env, ip, now = Date.now()) {
  if (!waechterAktiv(env) || !env?.DB || !ip) return null;
  try {
    const hash = await anschlussHash(env, ip);
    if (!hash) return null;
    const row = await aktiveSperre(env, hash, now);
    if (!row) return null;
    await versuchZaehlen(env, row.id, hash, now, false);
    return { gesperrt: true, selbst: Number(row.selbst) === 1, bis: row.bis, grund: row.grund };
  } catch (err) {
    if (!fehlendeTabelle(err) && err?.code !== "IP_PRIVACY_NOT_CONFIGURED") logFehler("waechter_check_failed", err);
    return null;
  }
}

// true = Anschluss ist gesperrt.
export async function waechterGesperrt(env, ip, now = Date.now()) {
  return Boolean(await waechterSperrInfo(env, ip, now));
}

// ---------------------------------------------------------------- Kampagnen

// Gleiche Signatur von >= 3 Anschluessen in 10 Minuten: Kampagne anlegen bzw.
// fortschreiben. Ergebnis { id, strengBis } oder null.
async function kampagnePruefen(env, v, now) {
  const bestehend = await env.DB.prepare("SELECT * FROM waechter_kampagnen WHERE signatur=?").bind(v.signatur).first();
  const aktiv = Boolean(bestehend && Date.parse(bestehend.streng_bis) > now);
  const ab = aktiv ? bestehend.seit : iso(now - KAMPAGNE_FENSTER);
  const stand = await env.DB.prepare(`SELECT COUNT(DISTINCT anschluss) AS n, COUNT(*) AS versuche, MIN(zeit) AS erste
    FROM waechter_vorfaelle WHERE signatur=? AND zeit>=?`).bind(v.signatur, ab).first();
  const anschluesse = Number(stand?.n || 0);
  if (!aktiv && anschluesse < KAMPAGNE_MIN) return null;
  const laender = ((await env.DB.prepare(`SELECT land, COUNT(DISTINCT anschluss) AS n FROM waechter_vorfaelle
    WHERE signatur=? AND zeit>=? GROUP BY land ORDER BY n DESC LIMIT 6`).bind(v.signatur, ab).all()).results || [])
    .map(r => [r.land || "", Number(r.n || 0)]);
  const netze = ((await env.DB.prepare(`SELECT asn, MAX(netz) AS netz, COUNT(DISTINCT anschluss) AS n FROM waechter_vorfaelle
    WHERE signatur=? AND zeit>=? AND asn IS NOT NULL GROUP BY asn ORDER BY n DESC LIMIT 6`).bind(v.signatur, ab).all()).results || [])
    .map(r => [Number(r.asn), r.netz || "", Number(r.n || 0)]);
  const strengBis = iso(now + kampagneStunden(env) * STUNDE);
  const zeit = iso(now);
  if (aktiv) {
    await env.DB.prepare(`UPDATE waechter_kampagnen SET zuletzt=?, streng_bis=MAX(streng_bis, ?), anschluesse=?, versuche=?, laender=?, netze=? WHERE id=?`)
      .bind(zeit, strengBis, anschluesse, Number(stand?.versuche || 0), JSON.stringify(laender), JSON.stringify(netze), bestehend.id).run();
    return { id: bestehend.id, strengBis };
  }
  const seit = stand?.erste || zeit;
  await env.DB.prepare(`INSERT INTO waechter_kampagnen (signatur, grund, beispiel, seit, zuletzt, streng_bis, anschluesse, versuche, laender, netze)
      VALUES (?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(signatur) DO UPDATE SET grund=excluded.grund, beispiel=excluded.beispiel, seit=excluded.seit, zuletzt=excluded.zuletzt,
        streng_bis=excluded.streng_bis, anschluesse=excluded.anschluesse, versuche=excluded.versuche, laender=excluded.laender,
        netze=excluded.netze, gemeldet_zeit=NULL, gemeldet_anschluesse=0`)
    .bind(v.signatur, v.grund, v.pfad, seit, zeit, strengBis, anschluesse, Number(stand?.versuche || 0), JSON.stringify(laender), JSON.stringify(netze)).run();
  const neu = await env.DB.prepare("SELECT id FROM waechter_kampagnen WHERE signatur=?").bind(v.signatur).first();
  if (!neu) return null;
  // Beteiligte, die schon gesperrt sind, der Kampagne zuordnen (eine Meldung).
  await env.DB.prepare(`UPDATE waechter_sperren SET kampagne=? WHERE kampagne IS NULL AND aufgehoben IS NULL
    AND anschluss IN (SELECT DISTINCT anschluss FROM waechter_vorfaelle WHERE signatur=? AND zeit>=?)`).bind(neu.id, v.signatur, seit).run();
  return { id: neu.id, strengBis };
}

// Laeuft gerade eine Kampagne, an der dieses Netz beteiligt ist?
async function strengesNetz(env, asn, now) {
  const row = await env.DB.prepare(`SELECT k.id FROM waechter_kampagnen k WHERE k.streng_bis>?
    AND EXISTS (SELECT 1 FROM waechter_vorfaelle v WHERE v.signatur=k.signatur AND v.zeit>=k.seit AND v.asn=?) LIMIT 1`)
    .bind(iso(now), asn).first();
  return row ? row.id : null;
}

// ---------------------------------------------------------------- Vorfall

// vorfall: { ip, ua, land, pfad, art, grund, bot, asn, netz, nr }.
// Ergebnis { gesperrt, grund?, selbst?, bis?, wiederholt?, kampagne? }.
export async function waechterVorfall(env, ctx, vorfall, now = Date.now()) {
  const art = ARTEN.includes(vorfall?.art) ? vorfall.art : null;
  if (!art || !waechterAktiv(env) || !env?.DB || !vorfall.ip || vorfall.bot) return { gesperrt: false };
  try {
    const hash = await anschlussHash(env, vorfall.ip);
    if (!hash) return { gesperrt: false };
    const zeit = iso(now);
    const land = /^[A-Z]{2}$/.test(String(vorfall.land || "")) ? String(vorfall.land) : null;
    const pfad = telegramZeile(vorfall.pfad || "", 90) || null;
    const grund = ART_GRUND[art] || (GRUND_TEXT[vorfall.grund] ? vorfall.grund : "scanner-pfad");
    const asn = ganzzahl(vorfall.asn, 0, 0, 4_294_967_295) || null;
    const netz = telegramZeile(vorfall.netz || "", 60) || null;
    const hosting = Boolean((asn || netz) && istHosting(asn, netz));
    const nr = /^W-[A-Z0-9]{4,12}$/.test(String(vorfall.nr || "")) ? String(vorfall.nr) : null;
    const hart = art === "angriff" && HARTE_GRUENDE.includes(grund);

    // Schon gesperrt: nur mitzaehlen (hoechstens eine Schreibung je Minute),
    // die Sperre laeuft ab dem letzten Versuch weiter.
    const laufend = await aktiveSperre(env, hash, now);
    if (laufend) {
      if (hart && Number(laufend.selbst) === 1) {
        // Waehrend einer milden Sperre echt angegriffen: ab jetzt ohne Turnstile.
        await env.DB.prepare("UPDATE waechter_sperren SET selbst=0, grund=?, beispiel=COALESCE(?, beispiel), nr=COALESCE(?, nr) WHERE id=?")
          .bind(grund, pfad, nr, laufend.id).run();
        laufend.selbst = 0;
        laufend.grund = grund;
      }
      await versuchZaehlen(env, laufend.id, hash, now, true);
      return { gesperrt: true, grund: laufend.grund, selbst: Number(laufend.selbst) === 1, bis: laufend.bis };
    }

    const signatur = (art === "angriff" || art === "probe") && pfad ? signaturAus(vorfall.pfad, grund) : null;
    await env.DB.prepare(`INSERT INTO waechter_vorfaelle (anschluss, zeit, art, grund, pfad, land, signatur, asn, netz, nr)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).bind(hash, zeit, art, grund, pfad, land, signatur, asn, netz, nr).run();

    let kampagne = null;
    if (signatur) {
      try { kampagne = await kampagnePruefen(env, { signatur, grund, pfad, land, asn, netz }, now); }
      catch (err) { if (!fehlendeTabelle(err)) logFehler("waechter_campaign_failed", err); }
    }

    let sperrGrund = null;
    if (art === "angriff") sperrGrund = grund;
    else {
      let [schwelle, fenster, arten] = SCHWELLEN[art];
      if (art === "probe" && (hosting || kampagne)) schwelle = 1;
      else if (art === "probe" && asn) {
        try { if (await strengesNetz(env, asn, now)) schwelle = 1; } catch {}
      }
      if (art === "404" && hosting) schwelle = 10;
      let n = 1;
      if (schwelle > 1) {
        const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM waechter_vorfaelle
          WHERE anschluss=? AND zeit>=? AND art IN (${arten.map(() => "?").join(",")})`)
          .bind(hash, iso(now - fenster), ...arten).first();
        n = Number(row?.n || 0);
      }
      if (n >= schwelle) sperrGrund = grund;
    }
    if (!sperrGrund) return { gesperrt: false, kampagne: kampagne?.id || null };
    return await sperren(env, ctx, { hash, now, land, ua: vorfall.ua, grund: sperrGrund, pfad, hart, asn, netz, kampagne: kampagne?.id || null, nr });
  } catch (err) {
    if (!fehlendeTabelle(err) && err?.code !== "IP_PRIVACY_NOT_CONFIGURED") logFehler("waechter_incident_failed", err);
    return { gesperrt: false };
  }
}

async function sperren(env, ctx, s) {
  const { hash, now } = s;
  const zeit = iso(now);
  const vorher = await env.DB.prepare("SELECT * FROM waechter_sperren WHERE anschluss=?").bind(hash).first();
  // Wiederholung: die letzte Sperre endete vor weniger als 7 Tagen (und der
  // Inhaber hat sie nicht als Irrtum aufgehoben).
  const wiederholt = Boolean(vorher && !vorher.admin_frei && Date.parse(vorher.bis) > now - RUECKFALL_FENSTER);
  const anzahl = wiederholt ? Math.max(1, Number(vorher.anzahl || 1)) + 1 : 1;
  const nachSelbst = Boolean(vorher?.selbst_entsperrt && !vorher.admin_frei && Date.parse(vorher.selbst_entsperrt) > now - RUECKFALL_FENSTER);
  const selbst = !s.hart && !nachSelbst ? 1 : 0;
  const bis = iso(now + (wiederholt ? WIEDERHOLT_MS : SPERRE_MS));
  const versuche = Number((await env.DB.prepare("SELECT COUNT(*) AS n FROM waechter_vorfaelle WHERE anschluss=? AND zeit>=?")
    .bind(hash, iso(now - TAG)).first())?.n || 1);
  await env.DB.prepare(`INSERT INTO waechter_sperren (anschluss, seit, bis, zuletzt, land, ua_kurz, grund, beispiel, versuche,
      sammeln, sammeln_seit, anzahl, selbst, asn, netz, kampagne, nr)
    VALUES (?,?,?,?,?,?,?,?,?,1,?,?,?,?,?,?,?)
    ON CONFLICT(anschluss) DO UPDATE SET
      seit=excluded.seit, bis=excluded.bis, zuletzt=excluded.zuletzt,
      land=COALESCE(excluded.land, waechter_sperren.land), ua_kurz=excluded.ua_kurz,
      grund=excluded.grund, beispiel=COALESCE(excluded.beispiel, waechter_sperren.beispiel),
      versuche=excluded.versuche, sammeln=1, sammeln_seit=excluded.sammeln_seit,
      anzahl=excluded.anzahl, selbst=excluded.selbst,
      asn=COALESCE(excluded.asn, waechter_sperren.asn), netz=COALESCE(excluded.netz, waechter_sperren.netz),
      kampagne=excluded.kampagne, nr=COALESCE(excluded.nr, waechter_sperren.nr),
      aufgehoben=NULL, admin_frei=NULL`)
    .bind(hash, zeit, bis, zeit, s.land, uaKurz(s.ua), s.grund, s.pfad, versuche, zeit, anzahl, selbst, s.asn, s.netz, s.kampagne, s.nr).run();
  // Gebuendelte Telegram-Meldung in etwa einer Minute (Wecker), Cron als Rueckfall.
  const wecker = weckerStellen(env, ctx, now + BUENDEL_WARTEN).catch(() => false);
  if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(wecker);
  return { gesperrt: true, grund: s.grund, selbst: selbst === 1, bis, wiederholt, kampagne: s.kampagne };
}

// ---------------------------------------------------------------- Telegram

function berlinKurz(isoText) {
  return new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
    .format(new Date(isoText));
}

function dauerText(sperre) {
  const ms = Date.parse(sperre.bis) - Date.parse(sperre.seit || sperre.bis);
  return Number(sperre.anzahl || 1) > 1 || ms > 2 * TAG ? "7 Tage, Wiederholungstäter" : "24 h";
}

function netzText(netz, asn) {
  const name = telegramFremd(netz || "", 50);
  return name ? `${name}${asn ? ` (AS${Number(asn)})` : ""}` : (asn ? `AS${Number(asn)}` : "");
}

export function waechterText(sperre) {
  const netz = netzText(sperre.netz, sperre.asn);
  return [
    `🛡 SICHERHEIT: verdächtiger Besucher gesperrt (${dauerText(sperre)})`,
    `📍 ${landName(sperre.land) || "Land unbekannt"}${netz ? ` · ${netz}` : ""}`,
    `📱 ${telegramFremd(sperre.ua_kurz || "unbekannt", 60)}`,
    `🔎 ${GRUND_TEXT[sperre.grund] || sperre.grund}${sperre.beispiel ? `: ${telegramFremd(sperre.beispiel, 90)}` : ""}`,
    `🔁 ${Number(sperre.versuche || 1)} ${Number(sperre.versuche || 1) === 1 ? "Versuch" : "Versuche"}`,
    `⏳ gesperrt bis ${berlinKurz(sperre.bis)}${Number(sperre.selbst) === 1 ? " (Mensch kann sich per Turnstile selbst entsperren)" : ""}`,
    "Aufheben: Admin-App → Besucher → Sicherheit",
  ].join("\n");
}

function json(text, fallback) {
  try { const wert = JSON.parse(text || ""); return Array.isArray(wert) ? wert : fallback; } catch { return fallback; }
}

function topText(map, max = 5) {
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, max).map(([k, n]) => `${k} ${n}`).join(", ");
}

export function kampagneText(k) {
  const laender = json(k.laender, []).map(([land, n]) => `${landName(land) || "unbekannt"} ${n}`).join(", ");
  const netze = json(k.netze, []).slice(0, 4).map(([asn, name, n]) => `${netzText(name, asn)} ${n}`).join(", ");
  return [
    `⚠️ Verteilter Angriff: ${GRUND_TEXT[k.grund] || k.grund} auf ${telegramFremd(zielAusSignatur(k.signatur), 70)}`,
    `🌐 ${Number(k.anschluesse || 0)} Anschlüsse${laender ? ` · ${laender}` : ""}`,
    ...(netze ? [`🏢 Netze: ${netze}`] : []),
    `🔒 strenger Modus bis ${berlinKurz(k.streng_bis)}: gleiches Netz schon beim 1. Scanner-Pfad gesperrt`,
  ].join("\n");
}

// Eine Nachricht fuer alles, was seit der letzten Meldung passiert ist.
export function waechterBuendelText(sperren, kampagnen) {
  const neue = kampagnen.filter(k => !k.gemeldet_zeit);
  if (sperren.length === 1 && !neue.length) return waechterText(sperren[0]);
  const zeilen = [neue.length ? "🛡 SICHERHEIT: verteilter Angriff erkannt" : `🛡 SICHERHEIT: ${sperren.length} Anschlüsse gesperrt`];
  for (const k of neue.slice(0, 3)) zeilen.push("", kampagneText(k));
  if (sperren.length) {
    const laender = new Map(), gruende = new Map();
    let versuche = 0, wiederholt = 0, selbst = 0;
    for (const s of sperren) {
      const land = landName(s.land) || "unbekannt";
      laender.set(land, (laender.get(land) || 0) + 1);
      const g = GRUND_TEXT[s.grund] || s.grund;
      gruende.set(g, (gruende.get(g) || 0) + 1);
      versuche += Number(s.versuche || 0);
      if (Number(s.anzahl || 1) > 1) wiederholt++;
      if (Number(s.selbst) === 1) selbst++;
    }
    const inKampagne = sperren.filter(s => s.kampagne).length;
    zeilen.push("", `🔒 ${sperren.length} ${sperren.length === 1 ? "Anschluss" : "Anschlüsse"} gesperrt${inKampagne ? ` (davon ${inKampagne} aus Kampagnen)` : ""}`);
    zeilen.push(`📍 ${topText(laender)}`, `🔎 ${topText(gruende)}`, `🔁 ${versuche} Versuche`);
    if (wiederholt) zeilen.push(`♻️ ${wiederholt} Wiederholungstäter (7 Tage gesperrt)`);
    if (selbst) zeilen.push(`🙋 ${selbst} mit Selbst-Entsperrung per Turnstile (geteilte Anschlüsse)`);
  }
  zeilen.push("", "Einzelheiten/Aufheben: Admin-App → Besucher → Sicherheit");
  return zeilen.join("\n");
}

function telegramAus(env) {
  return AUS.includes(String(env?.WAECHTER_TELEGRAM ?? "").trim().toLowerCase());
}

// Wann die naechste gebuendelte Meldung faellig ist (ms) oder null.
export async function waechterFaelligkeit(env, now = Date.now()) {
  if (!env?.DB || !waechterAktiv(env)) return null;
  try {
    const offen = await env.DB.prepare(`SELECT COUNT(*) AS n, MIN(COALESCE(sammeln_seit, seit)) AS s FROM waechter_sperren
      WHERE sammeln=1 AND aufgehoben IS NULL`).first();
    const kampagne = await env.DB.prepare("SELECT MIN(seit) AS s FROM waechter_kampagnen WHERE gemeldet_zeit IS NULL").first();
    const zeiten = [Number(offen?.n || 0) ? Date.parse(offen.s) : NaN, Date.parse(kampagne?.s || "")].filter(Number.isFinite);
    if (!zeiten.length) return null;
    const letzte = await env.DB.prepare(`SELECT MAX(z) AS z FROM (SELECT MAX(gemeldet_zeit) AS z FROM waechter_sperren
      UNION ALL SELECT MAX(gemeldet_zeit) AS z FROM waechter_kampagnen)`).first();
    const letzteMs = Date.parse(letzte?.z || "");
    return Math.max(Math.min(...zeiten) + BUENDEL_WARTEN, Number.isFinite(letzteMs) ? letzteMs + MELDE_ABSTAND : 0);
  } catch (err) {
    if (!fehlendeTabelle(err)) logFehler("waechter_due_failed", err);
    return null;
  }
}

// Wecker (besucher-wecker.js) und Cron: faellige Sammelmeldung schicken.
export async function waechterBuendeln(env, now = Date.now()) {
  if (!env?.DB || !telegramTransportReady(env) || telegramAus(env)) return { gesendet: 0 };
  try {
    const faellig = await waechterFaelligkeit(env, now);
    if (faellig === null || faellig > now) return { gesendet: 0, faellig };
    const sperren = (await env.DB.prepare(`SELECT * FROM waechter_sperren WHERE sammeln=1 AND aufgehoben IS NULL
      ORDER BY seit LIMIT 500`).all()).results || [];
    const ids = [...new Set(sperren.map(s => s.kampagne).filter(Boolean))];
    const kampagnen = (await env.DB.prepare(`SELECT * FROM waechter_kampagnen WHERE gemeldet_zeit IS NULL
      ${ids.length ? `OR id IN (${ids.map(() => "?").join(",")})` : ""} ORDER BY seit LIMIT 20`).bind(...ids).all()).results || [];
    if (!sperren.length && !kampagnen.some(k => !k.gemeldet_zeit)) return { gesendet: 0 };
    const ergebnis = await sendTelegramMessage(env, waechterBuendelText(sperren, kampagnen));
    if (!ergebnis?.sent) return { gesendet: 0, fehler: ergebnis?.reason || "failed" };
    const zeit = iso(now);
    const sperrIds = sperren.map(s => s.id);
    for (let i = 0; i < sperrIds.length; i += 50) {
      const teil = sperrIds.slice(i, i + 50);
      await env.DB.prepare(`UPDATE waechter_sperren SET sammeln=0, gemeldet_zeit=? WHERE id IN (${teil.map(() => "?").join(",")})`)
        .bind(zeit, ...teil).run();
    }
    for (const k of kampagnen) {
      await env.DB.prepare("UPDATE waechter_kampagnen SET gemeldet_zeit=?, gemeldet_anschluesse=anschluesse WHERE id=?").bind(zeit, k.id).run();
    }
    return { gesendet: 1, sperren: sperren.length, kampagnen: kampagnen.length };
  } catch (err) {
    if (!fehlendeTabelle(err)) logFehler("waechter_bundle_failed", err);
    return { gesendet: 0 };
  }
}

// Cron (alle 15 Minuten): Sammelmeldung (Rueckfall fuer den Wecker) und Aufraeumen.
export async function waechterPflegen(env, now = Date.now()) {
  if (!env?.DB) return { gesendet: 0 };
  try {
    await env.DB.prepare("DELETE FROM waechter_vorfaelle WHERE zeit<?").bind(iso(now - TAG)).run();
    await env.DB.prepare("DELETE FROM waechter_sperren WHERE bis<?").bind(iso(now - RUECKFALL_FENSTER)).run();
    await env.DB.prepare("DELETE FROM waechter_kampagnen WHERE zuletzt<? AND streng_bis<?").bind(iso(now - 7 * TAG), iso(now)).run().catch(() => {});
  } catch (err) {
    if (!fehlendeTabelle(err)) logFehler("waechter_maintenance_failed", err);
  }
  return waechterBuendeln(env, now);
}

// ---------------------------------------------------------------- API-Schutz (worker-entry.js)

// Diese Wege werden nie geprueft oder gesperrt.
export function waechterAusnahme(url) {
  const p = url.pathname;
  return p === "/paypal-webhook" || isPacklinkWebhookRoute(url) || p.startsWith("/ebay/") || p.startsWith("/manager/")
    || p === "/admin" || p.startsWith("/admin/") || p.startsWith("/intern/");
}

// Widerrufsfunktion (§ 356a BGB): auch fuer gesperrte Anschluesse erreichbar
// (eigene Grenzen und Turnstile in widerruf.js), Angriffsmuster bleiben gesperrt.
function immerErreichbar(url) {
  return url.pathname.replace(/\/+$/, "") === "/widerruf";
}

function sperrAntwort(status, code) {
  return new Response(JSON.stringify({ error: code }), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

function nebenher(ctx, laeuft) {
  if (ctx && typeof ctx.waitUntil === "function") { ctx.waitUntil(laeuft); return Promise.resolve(); }
  return laeuft;
}

// Vor dem Routing der Shop-API: Probe -> 404/403 und Vorfall, gesperrter
// Anschluss -> 403, Flut ueber WAECHTER_LIMITER -> 429 und Vorfall.
export async function waechterVorab(request, env, ctx, url, now = Date.now()) {
  if (!waechterAktiv(env) || waechterAusnahme(url)) return null;
  const ip = request.headers.get("CF-Connecting-IP") || "";
  if (!ip) return null;
  const ua = request.headers.get("User-Agent") || "";
  // Abrufe anderer Cloudflare-Worker ohne Browserkennung (Testshop) nie sperren.
  const bot = bekannterBot(request, ua) || (!ua && Number(request.cf?.asn) === 13335);
  const land = String(request.cf?.country || "").toUpperCase();
  const { asn, name: netz } = netzVon(request);
  const treffer = waechterPruefen(url, ua);
  if (treffer) {
    // Von einer fremden Seite ausgeloest (Bild/Link mit Angriffsmuster): nur
    // abweisen - der Browser gehoert vermutlich einem unbeteiligten Kunden.
    const fremd = treffer.art === "angriff" && fremdAusgeloest(request);
    if (!fremd && (treffer.art === "angriff" || !gedrosselt(`probe|${ip}`, 2000, now))) {
      await nebenher(ctx, waechterVorfall(env, ctx, { ip, ua, land, pfad: treffer.detail, art: treffer.art, grund: treffer.grund, bot, asn, netz }, now));
    }
    return treffer.art === "angriff" ? sperrAntwort(403, "FORBIDDEN") : sperrAntwort(404, "NOT_FOUND");
  }
  if (!bot && !immerErreichbar(url) && await waechterGesperrt(env, ip, now)) return sperrAntwort(403, "BLOCKED");
  // Flut-Grenze fuer alle ausser von Cloudflare verifizierten Bots; Bots nach
  // Kennung + Netz und andere Cloudflare-Worker bekommen nur 429, keine Sperre.
  if (!verifizierterBot(request) && env.WAECHTER_LIMITER && typeof env.WAECHTER_LIMITER.limit === "function") {
    const ergebnis = await env.WAECHTER_LIMITER.limit({ key: `waechter:${anschlussVonIp(ip)}` }).catch(() => null);
    if (ergebnis && ergebnis.success === false) {
      if (bot || gedrosselt(`flut|${ip}`, 2000, now)) return sperrAntwort(429, "RATE_LIMITED");
      await nebenher(ctx, waechterVorfall(env, ctx, { ip, ua, land, pfad: kurzPfad(url), art: "flut", grund: "zu-viele-anfragen", asn, netz }, now));
      return sperrAntwort(429, "RATE_LIMITED");
    }
  }
  return null;
}

// Nach der Antwort: 404 der API zaehlen (Scanner raten Adressen).
export function waechterNachher(request, env, ctx, url, status, now = Date.now()) {
  if (status !== 404 || !waechterAktiv(env) || waechterAusnahme(url)) return;
  const ip = request.headers.get("CF-Connecting-IP") || "";
  const ua = request.headers.get("User-Agent") || "";
  if (!ip || bekannterBot(request, ua) || (!ua && Number(request.cf?.asn) === 13335) || gedrosselt(`404|${ip}`, 2000, now)) return;
  const { asn, name: netz } = netzVon(request);
  const laeuft = waechterVorfall(env, ctx, { ip, ua, land: String(request.cf?.country || "").toUpperCase(), pfad: kurzPfad(url), art: "404", grund: "zu-viele-404", asn, netz }, now);
  if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(laeuft);
}

// Verdaechtiges an der API, das erst die Antwort zeigt: falsche Gutschein-
// Codes (enum), fehlgeschlagene Zahlungsabschluesse (kasse), ausgefuellte
// Formular-Fallen (falle). Sperrt erst ab der Schwelle, mit Turnstile-Option.
export function waechterFehlversuch(request, env, ctx, url, art, now = Date.now()) {
  if (!["enum", "kasse", "falle"].includes(art) || !waechterAktiv(env)) return Promise.resolve();
  const ip = request.headers.get("CF-Connecting-IP") || "";
  const ua = request.headers.get("User-Agent") || "";
  if (!ip || bekannterBot(request, ua)) return Promise.resolve();
  const { asn, name: netz } = netzVon(request);
  const laeuft = waechterVorfall(env, ctx, { ip, ua, land: String(request.cf?.country || "").toUpperCase(), pfad: kurzPfad(url), art, asn, netz }, now)
    .catch(err => logFehler("waechter_failure_count_failed", err));
  return nebenher(ctx, laeuft);
}

// ---------------------------------------------------------------- Storefront (Dienstbindung)

export const WAECHTER_PFAD_VORFALL = "/intern/waechter/vorfall";
export const WAECHTER_PFAD_PRUEFEN = "/intern/waechter/pruefen";
export const WAECHTER_PFAD_ENTSPERREN = "/intern/waechter/entsperren";
const INTERN_PFADE = [WAECHTER_PFAD_VORFALL, WAECHTER_PFAD_PRUEFEN, WAECHTER_PFAD_ENTSPERREN];

export function istWaechterIntern(url) {
  return url.hostname === "storefront.intern" && INTERN_PFADE.includes(url.pathname);
}

// Selbst-Entsperrung per Turnstile ("Ich bin ein Mensch") - nur fuer milde
// Sperren (selbst=1). Danach zaehlt jede neue Auffaelligkeit als Rueckfall.
export async function waechterSelbstEntsperren(env, { ip, token } = {}, now = Date.now(), fetcher = fetch) {
  if (!waechterAktiv(env) || !env?.DB || !ip) return { ok: true };
  const antwort = String(token || "").slice(0, 2048);
  if (!antwort) return { ok: false, fehler: "TOKEN_FEHLT" };
  try {
    const hash = await anschlussHash(env, ip);
    if (!hash) return { ok: true };
    const sperre = await aktiveSperre(env, hash, now);
    if (!sperre) return { ok: true };
    if (Number(sperre.selbst) !== 1) return { ok: false, fehler: "NICHT_ERLAUBT" };
    if (!env.TURNSTILE_SECRET) return { ok: false, fehler: "NICHT_EINGERICHTET" };
    const form = new FormData();
    form.append("secret", env.TURNSTILE_SECRET);
    form.append("response", antwort);
    form.append("remoteip", String(ip).slice(0, 64));
    const res = await fetcher("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
    const pruefung = await res.json().catch(() => ({}));
    if (!pruefung?.success || (pruefung.hostname && !TURNSTILE_HOSTS.includes(String(pruefung.hostname)))) return { ok: false, fehler: "TURNSTILE" };
    await env.DB.prepare("UPDATE waechter_sperren SET aufgehoben=?, selbst_entsperrt=?, sammeln=0 WHERE id=? AND selbst=1 AND aufgehoben IS NULL")
      .bind(iso(now), iso(now), sperre.id).run();
    // Schwellen beginnen von vorn (sonst sperrt der naechste Tippfehler sofort).
    await env.DB.prepare("DELETE FROM waechter_vorfaelle WHERE anschluss=?").bind(hash).run();
    return { ok: true, entsperrt: true };
  } catch (err) {
    if (!fehlendeTabelle(err)) logFehler("waechter_unlock_failed", err);
    return { ok: false, fehler: "FEHLER" };
  }
}

export async function waechterIntern(request, env, ctx, url, now = Date.now()) {
  const leer = (status, daten) => new Response(daten ? JSON.stringify(daten) : null, {
    status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
  if (request.method !== "POST") return leer(405);
  const raw = await request.text();
  if (raw.length > 4096) return leer(413);
  let body;
  try { body = JSON.parse(raw); } catch { return leer(400); }
  const ip = String(body?.ip || "").slice(0, 64);
  if (url.pathname === WAECHTER_PFAD_PRUEFEN) {
    const info = await waechterSperrInfo(env, ip, now);
    return leer(200, info ? { gesperrt: true, selbst: info.selbst, bis: info.bis } : { gesperrt: false });
  }
  if (url.pathname === WAECHTER_PFAD_ENTSPERREN) {
    return leer(200, await waechterSelbstEntsperren(env, { ip, token: body?.token }, now));
  }
  const ergebnis = await waechterVorfall(env, ctx, {
    ip,
    ua: String(body?.ua || "").slice(0, 400),
    land: String(body?.land || "").toUpperCase().slice(0, 2),
    pfad: String(body?.pfad || "").slice(0, 200),
    art: String(body?.art || ""),
    grund: String(body?.grund || ""),
    bot: body?.bot === true,
    asn: body?.asn,
    netz: String(body?.netz || "").slice(0, 80),
    nr: String(body?.nr || "").slice(0, 16),
  }, now);
  return leer(200, ergebnis.gesperrt ? { gesperrt: true, selbst: Boolean(ergebnis.selbst), bis: ergebnis.bis || null } : { gesperrt: false });
}

// ---------------------------------------------------------------- Admin

export function istWaechterAdmin(url) {
  return url.pathname === "/admin/besucher/sicherheit" || url.pathname.startsWith("/admin/besucher/sicherheit/");
}

function adminAntwort(daten, status, origin) {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
    "X-Content-Type-Options": "nosniff",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
  if (origin && ADMIN_ORIGINS.includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Credentials"] = "true";
  }
  return new Response(daten === null ? null : JSON.stringify(daten), { status, headers });
}

function kampagnenAbfrage(env, seit, now) {
  return env.DB.prepare(`SELECT * FROM waechter_kampagnen WHERE zuletzt>=? OR streng_bis>?
      ORDER BY zuletzt DESC LIMIT 50`).bind(seit, iso(now));
}

function kampagnenAus(results, now) {
  return (results || []).map(k => ({
      id: k.id, grund: k.grund, grundText: GRUND_TEXT[k.grund] || k.grund, ziel: zielAusSignatur(k.signatur), beispiel: k.beispiel,
      seit: k.seit, zuletzt: k.zuletzt, strengBis: k.streng_bis, aktiv: Date.parse(k.streng_bis) > now,
      anschluesse: Number(k.anschluesse || 0), versuche: Number(k.versuche || 0), gemeldet: Boolean(k.gemeldet_zeit),
      laender: json(k.laender, []).map(([land, n]) => ({ land, landName: landName(land), anschluesse: Number(n || 0) })),
      netze: json(k.netze, []).map(([asn, name, n]) => ({ asn: Number(asn) || null, name: String(name || ""), anschluesse: Number(n || 0) })),
  }));
}

async function kampagnenListe(env, seit, now) {
  try {
    const { results } = await kampagnenAbfrage(env, seit, now).all();
    return kampagnenAus(results, now);
  } catch (err) {
    if (!fehlendeTabelle(err)) throw err;
    return [];
  }
}

// Sperren, Vorfaelle der letzten 24 h und Kampagnen in einer Rundreise zu D1
// (einzeln live je ~50 ms). Fehlt eine Tabelle, scheitert der Batch als
// Ganzes - dann einzeln wie bisher, mit den Rueckfaellen.
async function sicherheitLesen(env, seit, now) {
  const sperrenAbfrage = () => env.DB.prepare(`SELECT * FROM waechter_sperren WHERE zuletzt>=? OR bis>? ORDER BY zuletzt DESC LIMIT 200`)
    .bind(seit, iso(now));
  const heuteAbfrage = () => env.DB.prepare("SELECT COUNT(*) AS n FROM waechter_vorfaelle WHERE zeit>=?").bind(iso(now - TAG));
  if (typeof env.DB.batch === "function") {
    try {
      const [s, h, k] = await env.DB.batch([sperrenAbfrage(), heuteAbfrage(), kampagnenAbfrage(env, seit, now)]);
      return { results: s?.results || [], heute: h?.results?.[0] || null, kampagnen: kampagnenAus(k?.results, now) };
    } catch {
      // einzeln weiter
    }
  }
  const { results } = await sperrenAbfrage().all();
  const heute = await heuteAbfrage().first();
  return { results, heute, kampagnen: await kampagnenListe(env, seit, now) };
}

export async function handleWaechterAdmin(request, env, url, now = Date.now()) {
  const origin = request.headers.get("Origin");
  if (request.method === "OPTIONS") return adminAntwort(null, origin && !ADMIN_ORIGINS.includes(origin) ? 403 : 204, origin);
  if (origin && !ADMIN_ORIGINS.includes(origin)) return adminAntwort({ error: "ORIGIN_NOT_ALLOWED" }, 403, origin);
  if (!env?.ADMIN_AUTH_CONTEXT?.role) return adminAntwort({ error: "UNAUTHORIZED" }, 401, origin);
  if (!env.DB) return adminAntwort({ error: "COMMERCE_DATABASE_NOT_CONFIGURED" }, 503, origin);
  const pfad = url.pathname.replace(/\/+$/, "");
  try {
    if (pfad === "/admin/besucher/sicherheit" && request.method === "GET") {
      const tage = ganzzahl(url.searchParams.get("tage"), 7, 1, 30);
      const seit = iso(now - tage * TAG);
      const { results, heute, kampagnen } = await sicherheitLesen(env, seit, now);
      const sperren = (results || []).map(s => {
        const dauerTage = Math.max(1, Math.round((Date.parse(s.bis) - Date.parse(s.seit)) / TAG));
        return {
          id: s.id, seit: s.seit, bis: s.bis, zuletzt: s.zuletzt, land: s.land, landName: landName(s.land),
          geraet: s.ua_kurz, grund: s.grund, grundText: GRUND_TEXT[s.grund] || s.grund, beispiel: s.beispiel,
          versuche: Number(s.versuche || 0), aufgehoben: s.aufgehoben, gemeldet: Boolean(s.gemeldet_zeit),
          aktiv: !s.aufgehoben && Date.parse(s.bis) > now,
          anzahl: Number(s.anzahl || 1), wiederholt: Number(s.anzahl || 1) > 1, dauerTage,
          selbstEntsperrbar: Number(s.selbst) === 1, selbstEntsperrt: s.selbst_entsperrt || null,
          vomInhaberAufgehoben: Boolean(s.admin_frei), netz: s.netz || null, asn: s.asn || null,
          kampagne: s.kampagne || null, nr: s.nr || null,
        };
      });
      const laender = new Map();
      for (const s of sperren) {
        const key = s.land || "??";
        const e = laender.get(key) || { land: s.land, landName: s.landName, sperren: 0, versuche: 0 };
        e.sperren++; e.versuche += s.versuche; laender.set(key, e);
      }
      return adminAntwort({
        ok: true, tage, erstellt: iso(now), aktiv: waechterAktiv(env),
        aktiveSperren: sperren.filter(s => s.aktiv).length,
        wiederholer: sperren.filter(s => s.wiederholt).length,
        selbstEntsperrt: sperren.filter(s => s.selbstEntsperrt).length,
        kampagnenAktiv: kampagnen.filter(k => k.aktiv).length,
        vorfaelle24h: Number(heute?.n || 0),
        sperren,
        kampagnen,
        laender: [...laender.values()].sort((a, b) => b.versuche - a.versuche),
        vorschau: "https://disorder119.com/_waechter/vorschau",
      }, 200, origin);
    }
    if (pfad === "/admin/besucher/sicherheit/aufheben" && request.method === "POST") {
      if (env.ADMIN_AUTH_CONTEXT.role !== "OWNER") return adminAntwort({ error: "FORBIDDEN" }, 403, origin);
      let body;
      try { body = JSON.parse(await request.text()); } catch { return adminAntwort({ error: "INVALID_JSON" }, 400, origin); }
      const id = ganzzahl(body?.id, 0, 0, Number.MAX_SAFE_INTEGER);
      if (!id) return adminAntwort({ error: "ID_REQUIRED" }, 400, origin);
      const sperre = await env.DB.prepare("SELECT anschluss FROM waechter_sperren WHERE id=?").bind(id).first();
      if (!sperre) return adminAntwort({ error: "NOT_FOUND" }, 404, origin);
      // Vom Inhaber aufgehoben = Irrtum: zaehlt nicht als Vorstrafe.
      await env.DB.prepare("UPDATE waechter_sperren SET aufgehoben=?, admin_frei=?, selbst_entsperrt=NULL, sammeln=0 WHERE id=?")
        .bind(iso(now), iso(now), id).run();
      // Alte Vorfaelle weg, sonst sperrt der naechste Tippfehler sofort wieder.
      await env.DB.prepare("DELETE FROM waechter_vorfaelle WHERE anschluss=?").bind(sperre.anschluss).run();
      return adminAntwort({ ok: true, id, aufgehoben: iso(now) }, 200, origin);
    }
    return adminAntwort({ error: request.method === "GET" || request.method === "POST" ? "NOT_FOUND" : "METHOD_NOT_ALLOWED" }, 404, origin);
  } catch (err) {
    if (fehlendeTabelle(err)) return adminAntwort({ ok: true, fehlt: "MIGRATION_0042", sperren: [], kampagnen: [], laender: [], aktiveSperren: 0, vorfaelle24h: 0 }, 200, origin);
    logFehler("waechter_admin_failed", err);
    return adminAntwort({ error: "WAECHTER_ERROR" }, 500, origin);
  }
}

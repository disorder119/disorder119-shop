// Einmaliges Nachholen: Mails, die der Shop verschickt hat, bevor es den
// Postausgang gab (Migration 0052), aus dem Brevo-Protokoll in den Ordner
// "Gesendet" der Admin-App uebernehmen. Laeuft im Cron, bis alles da ist,
// danach nie wieder (site_settings "postausgang_nachgeholt").
// Anmelde- und Bestaetigungslinks werden nur als Eintrag ohne Inhalt gefuehrt.
import { VERTRAULICHE_TAGS, normalizeEmail } from "./customer-mail.js";

const BREVO = "https://api.brevo.com/v3/smtp/emails";
const FLAG = "postausgang_nachgeholt";
const START = "2026-09-01";
const MAX_ABRUFE = 45;
const MAX_EMPFAENGER = 60;
const FEHLER_EREIGNISSE = new Set(["hardBounce", "softBounce", "blocked", "invalid", "error", "spam"]);

// Brevo erlaubt hoechstens 30 Tage zwischen startDate und endDate.
function monatsFenster(heute) {
  const fenster = [];
  const tag = 86_400_000;
  let von = new Date(`${START}T00:00:00Z`);
  while (von <= heute) {
    const bis = new Date(Math.min(von.getTime() + 27 * tag, heute.getTime()));
    fenster.push([von.toISOString().slice(0, 10), bis.toISOString().slice(0, 10)]);
    von = new Date(bis.getTime() + tag);
  }
  return fenster;
}

async function spalte(env, sql) {
  try {
    const { results } = await env.DB.prepare(sql).all();
    return (results || []).map((r) => normalizeEmail(r.e)).filter(Boolean);
  } catch {
    return [];
  }
}

async function empfaenger(env) {
  const alle = [
    ...(await spalte(env, "SELECT DISTINCT email AS e FROM order_contact_snapshots WHERE email IS NOT NULL")),
    ...(await spalte(env, "SELECT DISTINCT empfaenger_email AS e FROM rechnungen WHERE empfaenger_email IS NOT NULL")),
    ...(await spalte(env, "SELECT DISTINCT guest_email AS e FROM commerce_orders WHERE guest_email IS NOT NULL")),
    ...(await spalte(env, "SELECT DISTINCT guest_email AS e FROM rental_reservations WHERE guest_email IS NOT NULL")),
    ...(await spalte(env, "SELECT DISTINCT email_normalized AS e FROM newsletter_subscribers")),
    ...(await spalte(env, "SELECT DISTINCT email AS e FROM widerrufe")),
    ...(await spalte(env, "SELECT DISTINCT email AS e FROM customers")),
    ...(await spalte(env, "SELECT DISTINCT from_email AS e FROM postfach")),
  ];
  const ohne = new Set([normalizeEmail(env.MAIL_BCC || ""), normalizeEmail(env.MAIL_FROM || "")].filter(Boolean));
  return [...new Set(alle)].filter((e) => !ohne.has(e)).slice(0, MAX_EMPFAENGER);
}

export async function postausgangNachholen(env, scheduledTime = Date.now(), { fetchImpl = fetch } = {}) {
  if (!env?.DB || !env.MAIL_API_KEY) return { skipped: "NOT_CONFIGURED" };
  const fertig = await env.DB.prepare("SELECT value FROM site_settings WHERE key = ?").bind(FLAG).first().catch(() => null);
  if (fertig) return { skipped: "DONE" };
  const kopf = { "api-key": env.MAIL_API_KEY, Accept: "application/json" };
  let abrufe = 0;
  let neu = 0;
  let unvollstaendig = false;
  const codes = {};
  let ersterFehler = null;
  const pause = (ms) => (fetchImpl === fetch ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());
  const merke = async (res) => {
    codes[res.status] = (codes[res.status] || 0) + 1;
    if (!res.ok && !ersterFehler) ersterFehler = String(await res.clone().text().catch(() => "")).slice(0, 200);
  };
  const liste = await empfaenger(env);
  const heute = new Date(scheduledTime);
  outer: for (const email of liste) {
    for (const [von, bis] of monatsFenster(heute)) {
      if (abrufe >= MAX_ABRUFE) { unvollstaendig = true; break outer; }
      abrufe += 1;
      await pause(700);
      const q = new URLSearchParams({ email, startDate: von, endDate: bis, limit: "500", sort: "desc" });
      const res = await fetchImpl(`${BREVO}?${q}`, { headers: kopf });
      await merke(res);
      if (!res.ok) { if (res.status === 429 || res.status >= 500) unvollstaendig = true; continue; }
      const daten = await res.json().catch(() => ({}));
      for (const m of daten.transactionalEmails || []) {
        const mid = String(m.messageId || "").slice(0, 300);
        if (!mid) continue;
        const da = await env.DB.prepare("SELECT 1 FROM postausgang WHERE message_id = ? AND an_email = ?").bind(mid, email).first();
        if (da) continue;
        const tag = Array.isArray(m.tags) && m.tags[0] ? String(m.tags[0]).slice(0, 40) : null;
        const vertraulich = VERTRAULICHE_TAGS.has(tag || "");
        let html = null;
        let text = null;
        let status = "GESENDET";
        let fehler = null;
        if (!vertraulich && m.uuid) {
          if (abrufe >= MAX_ABRUFE) { unvollstaendig = true; break outer; }
          abrufe += 1;
          await pause(700);
          const d = await fetchImpl(`${BREVO}/${encodeURIComponent(m.uuid)}`, { headers: kopf });
          await merke(d);
          if (d.ok) {
            const info = await d.json().catch(() => ({}));
            html = info.body ? String(info.body).slice(0, 400_000) : null;
            const schlecht = (info.events || []).find((ev) => FEHLER_EREIGNISSE.has(ev?.name));
            if (schlecht) { status = "FEHLER"; fehler = String(schlecht.name); }
          } else if (d.status === 429 || d.status >= 500) {
            unvollstaendig = true;
            continue;
          }
        }
        if (!vertraulich && !html) text = "Inhalt bei Brevo nicht mehr abrufbar.";
        await env.DB.prepare(`INSERT INTO postausgang
          (id, gesendet_am, an_email, an_name, betreff, html, text, tag, art, anhaenge_json, status, fehler, message_id, antwort_auf, vertraulich)
          VALUES (?,?,?,?,?,?,?,?,'AUTO','[]',?,?,?,NULL,?)`)
          .bind(crypto.randomUUID(), new Date(m.date || scheduledTime).toISOString(), email, null,
            String(m.subject || "(ohne Betreff)").slice(0, 200), html, text, tag, status, fehler, mid, vertraulich ? 1 : 0)
          .run();
        neu += 1;
      }
    }
  }
  const info = JSON.stringify({ am: new Date(scheduledTime).toISOString(), empfaenger: liste.length, abrufe, neu, codes, fehler: ersterFehler });
  await env.DB.prepare("INSERT OR REPLACE INTO site_settings (key, value, updated_at) VALUES (?, ?, ?)")
    .bind(`${FLAG}_info`, info, new Date(scheduledTime).toISOString()).run().catch(() => null);
  if (!unvollstaendig) {
    await env.DB.prepare("INSERT OR REPLACE INTO site_settings (key, value, updated_at) VALUES (?, ?, ?)")
      .bind(FLAG, String(neu), new Date(scheduledTime).toISOString()).run();
  }
  return { neu, abrufe, fertig: !unvollstaendig, codes, empfaenger: liste.length };
}

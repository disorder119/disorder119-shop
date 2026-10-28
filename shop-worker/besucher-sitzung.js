// Besuchs-Lebenslauf fuer die Telegram-Zusammenfassung (Migration 0040).
//
// Jeder Besucher-Schluessel (Tages-Hash aus IP, Browserkennung und Tagessalz,
// siehe besucher.js) hat hoechstens EINE offene Sitzung. Jede Aktivitaet
// schiebt den Zeitpunkt "faellig" nach hinten; sobald er erreicht ist, gilt
// der Besuch als beendet und besucher-zusammenfassung.js schickt genau eine
// Telegram-Nachricht.
//
// - Ohne Einwilligung gibt es nur Seitenaufrufe vom Server: der Besuch endet
//   nach BESUCHER_ENDE_MINUTEN (Standard 10) ohne neuen Aufruf.
// - Mit Einwilligung meldet assets/besucher.js alle 30 s die sichtbare Zeit
//   und beim Schliessen/Wegwechseln einen Abschied (pagehide /
//   visibilitychange per sendBeacon). Nach einem Abschied endet der Besuch
//   schon nach BESUCHER_ABSCHIED_MINUTEN (Standard 3), wenn nichts mehr kommt
//   - wer nur kurz die App wechselt und zurueckkommt, bleibt im selben Besuch.
//
// Ausgeloest wird die Meldung vom Durable-Object-Wecker (besucher-wecker.js,
// puenktlich), nebenbei bei jedem neuen Seitenaufruf und vom Cron alle 15
// Minuten als Rueckfall. Hier wird nichts gespeichert, was nicht schon in
// besucher_ereignisse steht - ausser der Besuchszahl, die der Browser nur mit
// Einwilligung mitschickt.
const MINUTE = 60_000;

function ganzzahl(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n) || String(value ?? "").trim() === "") return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

const iso = ms => new Date(ms).toISOString();

export function sitzungsZeiten(env = {}) {
  return {
    ruheMs: ganzzahl(env?.BESUCHER_ENDE_MINUTEN, 10, 3, 60) * MINUTE,
    abschiedMs: ganzzahl(env?.BESUCHER_ABSCHIED_MINUTEN, 3, 1, 30) * MINUTE,
  };
}

// Besuchszahl aus dem Browser-Speicher (nur mit Einwilligung, consentVersion 2):
// wn = wievielter Besuch, we = Datum des ersten, wv = Datum des vorigen Besuchs.
// Kein Kennzeichen, nur Zahl und Tage - der Server kann Besuche damit nicht
// miteinander verknuepfen.
export function wiederkehrAusBody(body) {
  if (!body || body.consentVersion !== 2) return null;
  const nr = ganzzahl(body.wn, 0, 0, 9999);
  if (!nr) return null;
  const datum = v => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) && Number.isFinite(Date.parse(String(v))) ? String(v) : null);
  return { nr, erster: datum(body.we), vorher: nr > 1 ? datum(body.wv) : null };
}

// Weckt den Durable Object (besucher-wecker.js) zum angegebenen Zeitpunkt.
// Ohne Bindung (aeltere Konfiguration, Tests) bleibt es beim Cron.
export function weckerStellen(env, ctx, zeitpunkt) {
  const ns = env?.BESUCHER_WECKER;
  if (!ns || typeof ns.idFromName !== "function" || !Number.isFinite(zeitpunkt)) return Promise.resolve(false);
  let laeuft;
  try {
    laeuft = ns.get(ns.idFromName("besucher"))
      .fetch(`https://wecker.intern/stellen?t=${Math.round(zeitpunkt)}`, { method: "POST" })
      .then(res => { res?.body?.cancel?.(); return true; })
      .catch(err => {
        console.error(JSON.stringify({ level: "error", event: "besucher_wecker_failed", message: String(err?.message || err).slice(0, 160) }));
        return false;
      });
  } catch {
    return Promise.resolve(false);
  }
  if (ctx && typeof ctx.waitUntil === "function") {
    ctx.waitUntil(laeuft);
    return Promise.resolve(true);
  }
  return laeuft;
}

async function offeneSitzung(env, besucher) {
  return env.DB.prepare("SELECT * FROM besucher_sitzungen WHERE besucher=? AND offen=1 LIMIT 1").bind(besucher).first();
}

// Aktivitaet eines Besuchers verbuchen. Gibt die Sitzungs-ID zurueck oder
// null (z. B. Abschied ohne laufenden Besuch, Migration 0040 fehlt).
// neuErlaubt (optional): async () => boolean, wird nur vor dem Anlegen eines
// NEUEN Besuchs gefragt (Obergrenze je Anschluss und Tag, besucher.js).
// Ergebnis dann SITZUNG_GRENZE: der Aufruf zaehlt gar nicht.
export const SITZUNG_GRENZE = "GRENZE";

export async function sitzungBeruehren(env, ctx, info, now = Date.now()) {
  const { besucher, einwilligung = false, wiederkehr = null, abschied = false, entsperrt = false, neuErlaubt = null } = info || {};
  if (!env?.DB || !besucher) return null;
  const { ruheMs, abschiedMs } = sitzungsZeiten(env);
  const zeit = iso(now);
  try {
    for (let versuch = 0; versuch < 3; versuch++) {
      const offen = await offeneSitzung(env, besucher);
      if (offen && Date.parse(offen.faellig) <= now) {
        // Schon abgelaufen, nur noch nicht gemeldet: schliessen, die Meldung
        // uebernimmt der naechste Durchlauf; ein neuer Besuch beginnt.
        await env.DB.prepare("UPDATE besucher_sitzungen SET offen=0 WHERE id=? AND offen=1").bind(offen.id).run();
        continue;
      }
      if (!offen) {
        if (abschied) return null;
        if (typeof neuErlaubt === "function" && !(await neuErlaubt())) return SITZUNG_GRENZE;
        const faellig = now + ruheMs;
        const neu = await env.DB.prepare(`INSERT INTO besucher_sitzungen
          (besucher, beginn, zuletzt, faellig, offen, einwilligung, besuch_nr, erster_besuch, vorher_besuch, entsperrt)
          VALUES (?,?,?,?,1,?,?,?,?,?) ON CONFLICT DO NOTHING`)
          .bind(besucher, zeit, zeit, iso(faellig), einwilligung ? 1 : 0,
            wiederkehr?.nr ?? null, wiederkehr?.erster ?? null, wiederkehr?.vorher ?? null, entsperrt ? 1 : 0)
          .run();
        if (Number(neu?.meta?.changes || 0) !== 1) continue; // gleichzeitig angelegt: dort weiter
        await weckerStellen(env, ctx, faellig);
        return neu?.meta?.last_row_id ?? (await offeneSitzung(env, besucher))?.id ?? null;
      }
      const bisher = Date.parse(offen.faellig);
      const faellig = abschied ? Math.min(bisher, now + abschiedMs) : now + ruheMs;
      const res = await env.DB.prepare(`UPDATE besucher_sitzungen SET
          zuletzt=CASE WHEN ?1 THEN zuletzt ELSE MAX(zuletzt, ?2) END,
          abschied=CASE WHEN ?1 THEN ?2 ELSE abschied END,
          faellig=?3,
          einwilligung=MAX(einwilligung, ?4),
          besuch_nr=COALESCE(?5, besuch_nr),
          erster_besuch=COALESCE(?6, erster_besuch),
          vorher_besuch=COALESCE(?7, vorher_besuch),
          entsperrt=MAX(entsperrt, ?8)
        WHERE id=?9 AND offen=1 AND gemeldet=0`)
        .bind(abschied ? 1 : 0, zeit, iso(faellig), einwilligung ? 1 : 0,
          wiederkehr?.nr ?? null, wiederkehr?.erster ?? null, wiederkehr?.vorher ?? null, entsperrt ? 1 : 0, offen.id)
        .run();
      if (Number(res?.meta?.changes || 0) !== 1) continue; // gerade gemeldet: neuer Besuch
      if (faellig < bisher) await weckerStellen(env, ctx, faellig);
      return offen.id;
    }
    return null;
  } catch (err) {
    // Migration 0040 noch nicht eingespielt: Zaehlung laeuft ohne Zusammenfassung.
    if (!/no such (table|column)/i.test(String(err?.message || err))) {
      console.error(JSON.stringify({ level: "error", event: "besucher_sitzung_failed", message: String(err?.message || err).slice(0, 160) }));
    }
    return null;
  }
}

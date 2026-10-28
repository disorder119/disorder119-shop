// Datenpflege im Cron (worker-entry.js, alle 15 Minuten): loescht, was seinen
// Zweck erfuellt hat - Datensparsamkeit (Art. 5 Abs. 1 lit. c/e DSGVO).
//
// - Newsletter-Anmeldungen, die nie bestaetigt wurden: nach 30 Tagen (der
//   Bestaetigungslink gilt 48 Stunden; ohne Bestaetigung gibt es keine
//   Einwilligung, also keinen Grund, die Adresse zu behalten). Nie Zeilen mit
//   Rabattcode.
// - Konto-Anmeldelinks: abgelaufen und aelter als zwei Tage (so lange zaehlen
//   sie fuer die Grenzen in customer-account.js).
// - Einmal-Schluessel der Kasse/Miete (idempotency_keys): einen Tag nach
//   Ablauf - abgelaufen liefert sie niemand mehr aus.
// - Admin- und Kundensitzungen: einen Tag nach Ablauf oder Abmeldung.
//
// Je Lauf und Tabelle hoechstens LIMIT Zeilen; fehlt eine Tabelle (Migration
// noch nicht eingespielt), wird sie uebersprungen.
const TAG_MS = 24 * 60 * 60 * 1000;
const LIMIT = 500;

export const DATENPFLEGE = Object.freeze([
  {
    name: "newsletter_pending",
    sql: `DELETE FROM newsletter_subscribers WHERE rowid IN (SELECT rowid FROM newsletter_subscribers
      WHERE status='PENDING' AND coupon_id IS NULL AND confirmed_at IS NULL
        AND julianday(requested_at) < julianday(?1)
        AND (confirm_expires_at IS NULL OR julianday(confirm_expires_at) < julianday(?2))
      LIMIT ${LIMIT})`,
    werte: jetzt => [new Date(jetzt - 30 * TAG_MS).toISOString(), new Date(jetzt).toISOString()],
  },
  {
    name: "customer_login_tokens",
    sql: `DELETE FROM customer_login_tokens WHERE rowid IN (SELECT rowid FROM customer_login_tokens
      WHERE julianday(expires_at) < julianday(?1) AND julianday(created_at) < julianday(?2) LIMIT ${LIMIT})`,
    werte: jetzt => [new Date(jetzt).toISOString(), new Date(jetzt - 2 * TAG_MS).toISOString()],
  },
  {
    name: "idempotency_keys",
    sql: `DELETE FROM idempotency_keys WHERE rowid IN (SELECT rowid FROM idempotency_keys
      WHERE julianday(expires_at) < julianday(?1) LIMIT ${LIMIT})`,
    werte: jetzt => [new Date(jetzt - TAG_MS).toISOString()],
  },
  {
    name: "admin_sessions",
    sql: `DELETE FROM admin_sessions WHERE rowid IN (SELECT rowid FROM admin_sessions
      WHERE julianday(expires_at) < julianday(?1) OR (revoked_at IS NOT NULL AND julianday(revoked_at) < julianday(?1)) LIMIT ${LIMIT})`,
    werte: jetzt => [new Date(jetzt - TAG_MS).toISOString()],
  },
  {
    name: "customer_sessions",
    sql: `DELETE FROM customer_sessions WHERE rowid IN (SELECT rowid FROM customer_sessions
      WHERE julianday(expires_at) < julianday(?1) OR (revoked_at IS NOT NULL AND julianday(revoked_at) < julianday(?1)) LIMIT ${LIMIT})`,
    werte: jetzt => [new Date(jetzt - TAG_MS).toISOString()],
  },
]);

export async function datenPflegen(env, jetzt = Date.now()) {
  const ergebnis = {};
  if (!env?.DB) return ergebnis;
  for (const schritt of DATENPFLEGE) {
    try {
      const res = await env.DB.prepare(schritt.sql).bind(...schritt.werte(jetzt)).run();
      ergebnis[schritt.name] = Number(res?.meta?.changes || 0);
    } catch (err) {
      if (!/no such (table|column)/i.test(String(err?.message || err))) {
        console.error(JSON.stringify({ level: "error", event: "datenpflege_failed", schritt: schritt.name, message: String(err?.message || err).slice(0, 160) }));
      }
      ergebnis[schritt.name] = null;
    }
  }
  return ergebnis;
}

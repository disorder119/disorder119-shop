// Offene Halte gegen das Sperren des Shops: Kasse (/create-order),
// Mietanfrage (/rental-request) und Mietpaket (/rental-bundle) halten Stuecke
// je 15 Minuten fest. Ohne Grenze liesse sich der ganze Shop mit
// Reservierungen sperren. Darum hoechstens OFFENE_HALTE_MAX offene Halte je
// Anschluss (IPv6 je /64) und je E-Mail-Adresse (nur Kasse) - gezaehlt ueber
// alle drei Wege zusammen.
//
// Gezaehlt wird in audit_events (ohne Migration), eine Zeile je Halt:
//   entity_type   = "kontingent:halt-offen"
//   entity_id     = IP-Hash des Anschlusses, sonst "-"
//   metadata_json = {"mail":"<Hash der E-Mail-Adresse>"} (Kasse), sonst NULL
//   actor_ref     = Bestellung, Mietanfrage oder Mietpaket; NULL, solange die
//                   Anfrage noch laeuft
// Offen ist ein Halt, solange die Anfrage laeuft (hoechstens so lange wie
// eine Reservierung) oder das Gehaltene noch gilt: Bestellung PAYMENT_PENDING
// mit gueltiger Reservierung, Mietanfrage bzw. Mietpaket RESERVED und nicht
// abgelaufen. Bezahlt, storniert oder abgelaufen zaehlt nicht mehr.
//
// Belegen ist ein einziges INSERT ... SELECT ... WHERE: parallele Anfragen
// koennen die Grenze nicht gemeinsam ueberschreiten. Scheitert die Anfrage
// danach, gibt haltFreigeben den Platz zurueck. Zeilen werden nach einem Tag
// geloescht (beim Belegen und im Cron, kontingent.js).

import { RESERVATION_TTL_SECONDS } from "./commerce-core.js";
import { kontingentTyp } from "./kontingent.js";
import { ipPepper, privateNetzHash } from "./privacy-security.js";

export const OFFENE_HALTE_MAX = 2;
export const HALT_ART = "halt-offen";
const HALT_TYP = kontingentTyp(HALT_ART);
const IN_ARBEIT_MS = RESERVATION_TTL_SECONDS * 1000;
const FENSTER_MS = 2 * IN_ARBEIT_MS;
const AUFHEBEN_MS = 24 * 60 * 60 * 1000;

const OFFEN_SQL = `((a.actor_ref IS NULL AND a.created_at>=?)
    OR EXISTS (SELECT 1 FROM commerce_orders o WHERE o.id=a.actor_ref AND o.status='PAYMENT_PENDING'
      AND EXISTS (SELECT 1 FROM order_items oi JOIN reservations r ON r.inventory_id=oi.inventory_id
          AND (r.id=o.reservation_id OR r.idempotency_key=o.idempotency_key || '#' || oi.item_id)
        WHERE oi.order_id=o.id AND r.status='RESERVED' AND r.expires_at>?))
    OR EXISTS (SELECT 1 FROM rental_reservations rr WHERE rr.id=a.actor_ref AND rr.status='RESERVED' AND rr.expires_at>?)
    OR EXISTS (SELECT 1 FROM rental_groups g WHERE g.id=a.actor_ref AND g.status='RESERVED' AND g.expires_at>?))`;

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

// IP-Hash des Anschlusses - fuer alle drei Wege derselbe, sonst zaehlten sie
// getrennt. Ohne IP-Schutz (LOGIN_IP_PEPPER) im Livebetrieb: null, dann
// bleibt die Grenze je E-Mail-Adresse.
export async function haltNetzHash(request, env) {
  try {
    return await privateNetzHash(request, env, "halt");
  } catch {
    return null;
  }
}

// Hash der E-Mail-Adresse - gespeichert wird nie die Adresse selbst.
export async function haltMailHash(env, email) {
  const adresse = String(email || "").trim().toLowerCase();
  if (!adresse) return null;
  let pepper = "";
  try {
    pepper = ipPepper(env);
  } catch {
    // Ohne Pepper ein einfacher Hash - die Zeile ist nach einem Tag weg.
  }
  return sha256Hex(`halt-mail:${adresse}:${pepper}`);
}

// Wie viele Halte sind fuer diesen Anschluss bzw. diese Adresse offen?
// Ergebnis { ok: true, id } (id null, wenn es nichts zu zaehlen gibt) oder
// { ok: false, grund: "ANSCHLUSS" | "MAIL" }.
export async function haltBelegen(db, { netz = null, mail = null, reqId = null, jetzt = new Date() } = {}) {
  if (!netz && !mail) return { ok: true, id: null };
  const nowIso = jetzt.toISOString();
  const seit = new Date(jetzt.getTime() - FENSTER_MS).toISOString();
  const offen = [new Date(jetzt.getTime() - IN_ARBEIT_MS).toISOString(), nowIso, nowIso, nowIso];
  const metadata = mail ? JSON.stringify({ mail }) : null;
  const zaehlen = feld => `(SELECT COUNT(*) FROM audit_events a WHERE a.entity_type=? AND a.${feld}=? AND a.created_at>=? AND ${OFFEN_SQL})`;
  const bedingungen = [];
  const werte = [];
  if (netz) {
    bedingungen.push(`${zaehlen("entity_id")} < ?`);
    werte.push(HALT_TYP, netz, seit, ...offen, OFFENE_HALTE_MAX);
  }
  if (mail) {
    bedingungen.push(`${zaehlen("metadata_json")} < ?`);
    werte.push(HALT_TYP, metadata, seit, ...offen, OFFENE_HALTE_MAX);
  }

  try {
    await db.prepare("DELETE FROM audit_events WHERE entity_type=? AND created_at<?")
      .bind(HALT_TYP, new Date(jetzt.getTime() - AUFHEBEN_MS).toISOString()).run();
  } catch {
    // Aufraeumen ist Nebensache - beim naechsten Mal.
  }

  const id = `${HALT_TYP}:${crypto.randomUUID()}`;
  const result = await db.prepare(`INSERT INTO audit_events
      (id,actor_type,actor_ref,entity_type,entity_id,event_type,request_id,metadata_json,created_at)
    SELECT ?,'SYSTEM',NULL,?,?,'KONTINGENT_BELEGT',?,?,?
    WHERE ${bedingungen.join(" AND ")}`)
    .bind(id, HALT_TYP, netz ? String(netz).slice(0, 128) : "-", reqId ? String(reqId).slice(0, 120) : null, metadata, nowIso, ...werte)
    .run();
  if (result?.meta?.changes) return { ok: true, id };

  let grund = "MAIL";
  if (netz) {
    const row = await db.prepare(`SELECT ${zaehlen("entity_id")} AS n`).bind(HALT_TYP, netz, seit, ...offen).first();
    if (Number(row?.n || 0) >= OFFENE_HALTE_MAX) grund = "ANSCHLUSS";
  }
  return { ok: false, grund };
}

// Der Halt gehoert ab jetzt zu dieser Bestellung, Mietanfrage oder diesem
// Mietpaket - er zaehlt, solange das Gehaltene offen ist. Scheitert das,
// zaehlt der Halt eben bis zum Ende der Reservierungszeit.
export async function haltZuordnen(db, id, bezug) {
  if (!db || !id || !bezug) return;
  try {
    await db.prepare("UPDATE audit_events SET actor_ref=? WHERE id=? AND entity_type=? AND actor_ref IS NULL")
      .bind(String(bezug).slice(0, 120), String(id), HALT_TYP).run();
  } catch (err) {
    console.error(JSON.stringify({ level: "error", event: "open_hold_assign_failed", message: String(err?.message || "unknown").slice(0, 120) }));
  }
}

// Die Anfrage hat nichts festgehalten (Stueck weg, PayPal-Fehler, ...):
// Platz zurueck.
export async function haltFreigeben(db, id) {
  if (!db || !id) return;
  try {
    await db.prepare("DELETE FROM audit_events WHERE id=? AND entity_type=?").bind(String(id), HALT_TYP).run();
  } catch {
    // Dann zaehlt der Halt bis zum Ende der Reservierungszeit.
  }
}

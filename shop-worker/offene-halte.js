// Offene Halte gegen das Sperren des Shops: Kasse (/create-order),
// Mietanfrage (/rental-request) und Mietpaket (/rental-bundle) halten Stuecke
// je 15 Minuten fest. Ohne Grenze liesse sich der ganze Shop mit
// Reservierungen sperren. Kasse und Miete zaehlen getrennt - Mietanfragen
// duerfen die Kasse nicht blockieren:
//   Kasse: hoechstens KASSE_JE_ANSCHLUSS offene Halte je Anschluss (IPv6 je
//          /64; mehrere Leute im selben Netz) und KASSE_JE_MAIL je E-Mail-
//          Adresse.
//   Miete: hoechstens MIETE_JE_ANSCHLUSS offene Halte je Anschluss -
//          Mietanfrage und Mietpaket zusammen.
//
// Gezaehlt wird in audit_events (ohne Migration), eine Zeile je Halt:
//   entity_type   = "kontingent:halt-kasse" bzw. "kontingent:halt-miete"
//   entity_id     = IP-Hash des Anschlusses, sonst "-"
//   metadata_json = {"mail":"<Hash der E-Mail-Adresse>"} (Kasse), sonst NULL
//   actor_ref     = Bestellung, Mietanfrage oder Mietpaket; NULL, solange die
//                   Anfrage noch laeuft
// Offen ist ein Halt, solange die Anfrage laeuft (hoechstens so lange wie
// eine Reservierung) oder das Gehaltene noch gilt: Bestellung PAYMENT_PENDING
// mit gueltiger Reservierung, Mietanfrage bzw. Mietpaket RESERVED und nicht
// abgelaufen. Bezahlt, storniert oder abgelaufen zaehlt nicht mehr - und
// nach HALT_FENSTER_MS zaehlt ein Halt ohnehin nicht mehr.
//
// Belegen ist ein einziges INSERT ... SELECT ... WHERE: parallele Anfragen
// koennen die Grenze nicht gemeinsam ueberschreiten. Scheitert die Anfrage
// danach, gibt haltFreigeben den Platz zurueck. Zeilen werden nach
// HALT_FENSTER_MS geloescht (beim Belegen und im Cron: halteAufraeumen).
//
// Ohne IP-Schutz (LOGIN_IP_PEPPER) im Livebetrieb gibt es keine offene Tuer:
// haltNetzHash und haltMailHash werfen IP_PRIVACY_NOT_CONFIGURED (503).
// Testshop und Tests zaehlen mit einem festen Test-Pepper.

import { RESERVATION_TTL_SECONDS } from "./commerce-core.js";
import { kontingentTyp } from "./kontingent.js";
import { ipPepper, privateNetzHash } from "./privacy-security.js";

export const KASSE_JE_ANSCHLUSS = 5;
export const KASSE_JE_MAIL = 2;
export const MIETE_JE_ANSCHLUSS = 3;

const ARTEN = Object.freeze({
  kasse: { art: "halt-kasse", jeAnschluss: KASSE_JE_ANSCHLUSS, jeMail: KASSE_JE_MAIL },
  miete: { art: "halt-miete", jeAnschluss: MIETE_JE_ANSCHLUSS, jeMail: null },
});
export const HALT_ARTEN = Object.freeze(Object.values(ARTEN).map(a => a.art));

const IN_ARBEIT_MS = RESERVATION_TTL_SECONDS * 1000;
// Laenger als eine Reservierung haelt kein Halt - doppelte Reservierungszeit
// als Puffer, danach zaehlt und bleibt nichts.
export const HALT_FENSTER_MS = 2 * IN_ARBEIT_MS;
// Retry-After: so lange, bis der aelteste offene Halt frei wird, mindestens
// eine Minute.
export const MIN_WARTEN_SEKUNDEN = 60;

const OFFEN_SQL = `((a.actor_ref IS NULL AND a.created_at>=?)
    OR EXISTS (SELECT 1 FROM commerce_orders o WHERE o.id=a.actor_ref AND o.status='PAYMENT_PENDING'
      AND EXISTS (SELECT 1 FROM order_items oi JOIN reservations r ON r.inventory_id=oi.inventory_id
          AND (r.id=o.reservation_id OR r.idempotency_key=o.idempotency_key || '#' || oi.item_id)
        WHERE oi.order_id=o.id AND r.status='RESERVED' AND r.expires_at>?))
    OR EXISTS (SELECT 1 FROM rental_reservations rr WHERE rr.id=a.actor_ref AND rr.status='RESERVED' AND rr.expires_at>?)
    OR EXISTS (SELECT 1 FROM rental_groups g WHERE g.id=a.actor_ref AND g.status='RESERVED' AND g.expires_at>?))`;

// Bis wann haelt ein offener Halt fest? Je nach Bezug das Ende der
// Reservierung (Bestellung: die letzte ihrer Reservierungen).
const ENDE_SQL = `SELECT a.actor_ref AS bezug, a.created_at AS seit,
    (SELECT MAX(r.expires_at) FROM commerce_orders o JOIN order_items oi ON oi.order_id=o.id
       JOIN reservations r ON r.inventory_id=oi.inventory_id
         AND (r.id=o.reservation_id OR r.idempotency_key=o.idempotency_key || '#' || oi.item_id)
       WHERE o.id=a.actor_ref AND o.status='PAYMENT_PENDING' AND r.status='RESERVED' AND r.expires_at>?) AS kauf_bis,
    (SELECT rr.expires_at FROM rental_reservations rr WHERE rr.id=a.actor_ref AND rr.status='RESERVED' AND rr.expires_at>?) AS anfrage_bis,
    (SELECT g.expires_at FROM rental_groups g WHERE g.id=a.actor_ref AND g.status='RESERVED' AND g.expires_at>?) AS paket_bis
  FROM audit_events a`;

function artVon(name) {
  const art = ARTEN[name];
  if (!art) throw new Error("halt_art_unbekannt");
  return { ...art, typ: kontingentTyp(art.art) };
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

// IP-Hash des Anschlusses (IPv6 je /64). Ohne IP-Schutz im Livebetrieb:
// IP_PRIVACY_NOT_CONFIGURED (503) - ohne Hash gaebe es keine Grenze.
export async function haltNetzHash(request, env) {
  return privateNetzHash(request, env, "halt");
}

// Hash der E-Mail-Adresse - gespeichert wird nie die Adresse selbst. Im
// Livebetrieb nur mit Pepper (sonst IP_PRIVACY_NOT_CONFIGURED).
export async function haltMailHash(env, email) {
  const adresse = String(email || "").trim().toLowerCase();
  if (!adresse) return null;
  return sha256Hex(`halt-mail:${adresse}:${ipPepper(env)}`);
}

// Sekunden, bis fuer diesen Anschluss bzw. diese Adresse der erste offene
// Halt frei wird - fuer Retry-After. Mindestens MIN_WARTEN_SEKUNDEN.
async function warteSekunden(db, typ, feld, wert, jetzt) {
  const nowMs = jetzt.getTime();
  const nowIso = jetzt.toISOString();
  const seit = new Date(nowMs - HALT_FENSTER_MS).toISOString();
  let ende = null;
  try {
    const { results = [] } = await db.prepare(`${ENDE_SQL}
      WHERE a.entity_type=? AND a.${feld}=? AND a.created_at>=? AND ${OFFEN_SQL}`)
      .bind(nowIso, nowIso, nowIso, typ, wert, seit, new Date(nowMs - IN_ARBEIT_MS).toISOString(), nowIso, nowIso, nowIso)
      .all();
    for (const row of results) {
      const start = Date.parse(row.seit);
      const bis = row.bezug
        ? Math.max(...[row.kauf_bis, row.anfrage_bis, row.paket_bis].map(v => Date.parse(v || "")).filter(Number.isFinite))
        : start + IN_ARBEIT_MS;
      // Nach HALT_FENSTER_MS zaehlt der Halt in keinem Fall mehr.
      const frei = Math.min(Number.isFinite(bis) ? bis : start + HALT_FENSTER_MS, start + HALT_FENSTER_MS);
      if (Number.isFinite(frei) && (ende === null || frei < ende)) ende = frei;
    }
  } catch {
    // Dann eben die Mindestzeit.
  }
  const sekunden = ende === null ? 0 : Math.ceil((ende - nowMs) / 1000);
  return Math.min(Math.max(sekunden, MIN_WARTEN_SEKUNDEN), Math.ceil(HALT_FENSTER_MS / 1000));
}

// Platz fuer einen offenen Halt belegen.
//   art:  "kasse" oder "miete"
//   netz: haltNetzHash, mail: haltMailHash (nur Kasse)
// Ergebnis { ok: true, id } (id null, wenn es nichts zu zaehlen gibt) oder
// { ok: false, grund: "ANSCHLUSS" | "MAIL", warteSekunden }.
export async function haltBelegen(db, { art = "kasse", netz = null, mail = null, reqId = null, jetzt = new Date() } = {}) {
  const halt = artVon(art);
  const mailHash = halt.jeMail ? mail : null;
  if (!netz && !mailHash) return { ok: true, id: null };
  const nowIso = jetzt.toISOString();
  const seit = new Date(jetzt.getTime() - HALT_FENSTER_MS).toISOString();
  const offen = [new Date(jetzt.getTime() - IN_ARBEIT_MS).toISOString(), nowIso, nowIso, nowIso];
  const metadata = mailHash ? JSON.stringify({ mail: mailHash }) : null;
  const zaehlen = feld => `(SELECT COUNT(*) FROM audit_events a WHERE a.entity_type=? AND a.${feld}=? AND a.created_at>=? AND ${OFFEN_SQL})`;
  const bedingungen = [];
  const werte = [];
  if (netz) {
    bedingungen.push(`${zaehlen("entity_id")} < ?`);
    werte.push(halt.typ, netz, seit, ...offen, halt.jeAnschluss);
  }
  if (mailHash) {
    bedingungen.push(`${zaehlen("metadata_json")} < ?`);
    werte.push(halt.typ, metadata, seit, ...offen, halt.jeMail);
  }

  try {
    await db.prepare("DELETE FROM audit_events WHERE entity_type=? AND created_at<?").bind(halt.typ, seit).run();
  } catch {
    // Aufraeumen ist Nebensache - beim naechsten Mal.
  }

  const id = `${halt.typ}:${crypto.randomUUID()}`;
  const result = await db.prepare(`INSERT INTO audit_events
      (id,actor_type,actor_ref,entity_type,entity_id,event_type,request_id,metadata_json,created_at)
    SELECT ?,'SYSTEM',NULL,?,?,'KONTINGENT_BELEGT',?,?,?
    WHERE ${bedingungen.join(" AND ")}`)
    .bind(id, halt.typ, netz ? String(netz).slice(0, 128) : "-", reqId ? String(reqId).slice(0, 120) : null, metadata, nowIso, ...werte)
    .run();
  if (result?.meta?.changes) return { ok: true, id };

  // Voll. Die eigene Adresse geht vor: dann stimmt der Hinweis "du hast
  // schon offene Bestellungen" - sonst sind es andere im selben Netz.
  let grund = "ANSCHLUSS";
  if (mailHash) {
    const row = await db.prepare(`SELECT ${zaehlen("metadata_json")} AS n`).bind(halt.typ, metadata, seit, ...offen).first();
    if (Number(row?.n || 0) >= halt.jeMail || !netz) grund = "MAIL";
  }
  const warte = grund === "MAIL"
    ? await warteSekunden(db, halt.typ, "metadata_json", metadata, jetzt)
    : await warteSekunden(db, halt.typ, "entity_id", netz, jetzt);
  return { ok: false, grund, warteSekunden: warte };
}

// Der Halt gehoert ab jetzt zu dieser Bestellung, Mietanfrage oder diesem
// Mietpaket - er zaehlt, solange das Gehaltene offen ist. Scheitert das,
// zaehlt der Halt eben bis zum Ende der Reservierungszeit.
export async function haltZuordnen(db, id, bezug) {
  if (!db || !id || !bezug) return;
  try {
    await db.prepare(`UPDATE audit_events SET actor_ref=? WHERE id=? AND actor_ref IS NULL
        AND entity_type IN (${HALT_ARTEN.map(() => "?").join(",")})`)
      .bind(String(bezug).slice(0, 120), String(id), ...HALT_ARTEN.map(kontingentTyp)).run();
  } catch (err) {
    console.error(JSON.stringify({ level: "error", event: "open_hold_assign_failed", message: String(err?.message || "unknown").slice(0, 120) }));
  }
}

// Die Anfrage hat nichts festgehalten (Stueck weg, PayPal-Fehler, ...):
// Platz zurueck.
export async function haltFreigeben(db, id) {
  if (!db || !id) return;
  try {
    await db.prepare(`DELETE FROM audit_events WHERE id=? AND entity_type IN (${HALT_ARTEN.map(() => "?").join(",")})`)
      .bind(String(id), ...HALT_ARTEN.map(kontingentTyp)).run();
  } catch {
    // Dann zaehlt der Halt bis zum Ende der Reservierungszeit.
  }
}

// Cron (worker-entry.js, alle 15 Minuten): Halte-Zeilen nach HALT_FENSTER_MS
// loeschen, auch wenn gerade niemand bestellt oder mietet - IP- und
// Adress-Hashes bleiben nur so lange, wie die Grenze sie braucht.
export async function halteAufraeumen(db, jetzt = new Date()) {
  if (!db) return { geloescht: 0 };
  const result = await db.prepare(`DELETE FROM audit_events
      WHERE entity_type IN (${HALT_ARTEN.map(() => "?").join(",")}) AND created_at<?`)
    .bind(...HALT_ARTEN.map(kontingentTyp), new Date(jetzt.getTime() - HALT_FENSTER_MS).toISOString()).run();
  return { geloescht: Number(result?.meta?.changes || 0) };
}

// Kontingente gegen Missbrauch: Gutscheine aus dem Spiel, Mails im Testshop,
// Eingangsbestaetigungen der Widerrufsfunktion, offene Bestellungen je
// Anschluss.
//
// Gezaehlt wird in audit_events - ohne eigene Tabelle, also ohne Migration.
// Eine belegte Einheit ist eine Zeile mit
//   entity_type = "kontingent:<art>"
//   entity_id   = Schluessel (IP-Hash des Anschlusses, sonst "-")
//   actor_ref   = Bezug (z. B. Bestellung), sonst NULL
//   created_at  = Zeitpunkt
// idx_audit_entity (entity_type, entity_id, created_at) traegt die Zaehlung
// je Anschluss, idx_audit_created_at die Tagessumme.
//
// Belegen ist ein einziges INSERT ... SELECT ... WHERE: zwei gleichzeitige
// Anfragen koennen eine Grenze nicht gemeinsam ueberschreiten. Alte Zeilen
// werden beim Belegen geloescht - IP-Hashes bleiben nur so lange, wie die
// Grenze sie braucht.

export const TAG_MS = 24 * 60 * 60 * 1000;
const OHNE_SCHLUESSEL = "-";

function typ(art) {
  const name = String(art || "").replace(/[^a-z0-9_-]/gi, "").slice(0, 40);
  if (!name) throw new Error("kontingent_art_fehlt");
  return `kontingent:${name}`;
}

// entity_type einer Art - fuer eigene Abfragen (z. B. offene Bestellungen).
export function kontingentTyp(art) {
  return typ(art);
}

function schluesselText(schluessel) {
  const text = String(schluessel ?? "").slice(0, 128);
  return text || OHNE_SCHLUESSEL;
}

function grenze(wert) {
  const zahl = Number(wert);
  return Number.isInteger(zahl) && zahl > 0 ? zahl : null;
}

// Wie viele Einheiten in den letzten fensterMs belegt sind - je Schluessel
// oder (schluessel weggelassen) insgesamt.
export async function kontingentStand(db, { art, schluessel, fensterMs = TAG_MS, jetzt = new Date() }) {
  const seit = new Date(jetzt.getTime() - fensterMs).toISOString();
  const row = schluessel === undefined
    ? await db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE entity_type=? AND created_at>=?").bind(typ(art), seit).first()
    : await db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE entity_type=? AND entity_id=? AND created_at>=?")
      .bind(typ(art), schluesselText(schluessel), seit).first();
  return Number(row?.n || 0);
}

// Belegt eine Einheit, wenn beide Grenzen es erlauben:
//   jeSchluessel: hoechstens so viele je Schluessel in fensterMs
//   gesamt:       hoechstens so viele insgesamt in gesamtFensterMs
// Ergebnis: { ok: true, id } oder { ok: false, grund: "ANSCHLUSS" | "GESAMT" }.
export async function kontingentBelegen(db, {
  art,
  schluessel = null,
  jeSchluessel = null,
  fensterMs = TAG_MS,
  gesamt = null,
  gesamtFensterMs = TAG_MS,
  bezug = null,
  reqId = null,
  jetzt = new Date(),
}) {
  const entityType = typ(art);
  const entityId = schluesselText(schluessel);
  const proSchluessel = grenze(jeSchluessel);
  const insgesamt = grenze(gesamt);
  const nowIso = jetzt.toISOString();
  const bedingungen = [];
  const werte = [];
  if (proSchluessel) {
    bedingungen.push("(SELECT COUNT(*) FROM audit_events WHERE entity_type=? AND entity_id=? AND created_at>=?) < ?");
    werte.push(entityType, entityId, new Date(jetzt.getTime() - fensterMs).toISOString(), proSchluessel);
  }
  if (insgesamt) {
    bedingungen.push("(SELECT COUNT(*) FROM audit_events WHERE entity_type=? AND created_at>=?) < ?");
    werte.push(entityType, new Date(jetzt.getTime() - gesamtFensterMs).toISOString(), insgesamt);
  }

  // Was keine Grenze mehr braucht, muss nicht liegen bleiben.
  const aufheben = Math.max(proSchluessel ? fensterMs : 0, insgesamt ? gesamtFensterMs : 0, TAG_MS);
  try {
    await db.prepare("DELETE FROM audit_events WHERE entity_type=? AND created_at<?")
      .bind(entityType, new Date(jetzt.getTime() - aufheben).toISOString()).run();
  } catch {
    // Aufraeumen ist Nebensache - beim naechsten Mal.
  }

  const id = `${entityType}:${crypto.randomUUID()}`;
  const result = await db.prepare(`INSERT INTO audit_events
      (id,actor_type,actor_ref,entity_type,entity_id,event_type,request_id,metadata_json,created_at)
    SELECT ?,'SYSTEM',?,?,?,'KONTINGENT_BELEGT',?,NULL,?
    ${bedingungen.length ? `WHERE ${bedingungen.join(" AND ")}` : ""}`)
    .bind(id, bezug === null || bezug === undefined ? null : String(bezug).slice(0, 120), entityType, entityId,
      reqId ? String(reqId).slice(0, 120) : null, nowIso, ...werte)
    .run();
  if (result?.meta?.changes) return { ok: true, id };

  const anschlussVoll = proSchluessel
    && await kontingentStand(db, { art, schluessel: entityId, fensterMs, jetzt }) >= proSchluessel;
  return { ok: false, grund: anschlussVoll ? "ANSCHLUSS" : "GESAMT" };
}

// Gibt eine belegte Einheit zurueck, wenn die Aktion danach doch nicht
// stattgefunden hat (z. B. Mail nicht verschickt).
export async function kontingentFreigeben(db, id) {
  if (!db || !id || !String(id).startsWith("kontingent:")) return;
  try {
    await db.prepare("DELETE FROM audit_events WHERE id=? AND event_type='KONTINGENT_BELEGT'").bind(String(id)).run();
  } catch {
    // Dann zaehlt die Einheit eben bis zum Ende des Fensters.
  }
}

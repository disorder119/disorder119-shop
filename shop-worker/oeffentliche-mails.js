// Gemeinsames Tagesbudget fuer Mails, die jeder von aussen ausloesen kann:
// Newsletter-Bestaetigung, Anmeldelink fuer das Kundenkonto und die
// Eingangsbestaetigung der Widerrufsfunktion. Brevo (kostenloser Plan)
// erlaubt 300 Mails am Tag - fuer ALLE Mails des Shops. Damit Bestell-,
// Versand-, Rechnungs- und Erstattungsmails nie leer ausgehen, belegen
// oeffentlich ausloesbare Mails zusammen hoechstens OEFFENTLICHE_MAILS_JE_TAG
// (Standard 150, env OEFFENTLICHE_MAILS_JE_TAG). Bestell- und
// Transaktionsmails fragen dieses Budget nie.
//
// Gezaehlt wird mit kontingent.js (audit_events, atomar). Mehrere Grenzen
// nacheinander belegen: scheitert eine, werden die schon belegten wieder
// freigegeben.
import { TAG_MS, kontingentBelegen, kontingentFreigeben } from "./kontingent.js";

export const OEFFENTLICHE_MAILS_JE_TAG = 150;

export function oeffentlicheMailsJeTag(env) {
  const n = Number(env?.OEFFENTLICHE_MAILS_JE_TAG);
  return Number.isInteger(n) && n > 0 ? Math.min(n, 280) : OEFFENTLICHE_MAILS_JE_TAG;
}

// Schritt fuer kontingenteBelegen: das gemeinsame Tagesbudget.
export function oeffentlichesBudget(env, bezug = null) {
  return { art: "mail-oeffentlich", gesamt: oeffentlicheMailsJeTag(env), gesamtFensterMs: TAG_MS, bezug };
}

// schritte: Argumente fuer kontingentBelegen (ohne jetzt/reqId).
// Ergebnis { ok: true, ids } oder { ok: false, art, grund } (nichts belegt).
export async function kontingenteBelegen(db, schritte, { jetzt = new Date(), reqId = null } = {}) {
  const ids = [];
  for (const schritt of schritte.filter(Boolean)) {
    let ergebnis;
    try {
      ergebnis = await kontingentBelegen(db, { ...schritt, jetzt, reqId });
    } catch (err) {
      await kontingenteFreigeben(db, ids);
      throw err;
    }
    if (!ergebnis.ok) {
      await kontingenteFreigeben(db, ids);
      return { ok: false, art: schritt.art, grund: ergebnis.grund };
    }
    ids.push(ergebnis.id);
  }
  return { ok: true, ids };
}

export async function kontingenteFreigeben(db, ids = []) {
  for (const id of ids) await kontingentFreigeben(db, id);
}

export async function hashText(text) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(text ?? ""))));
  return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
}

// Links in fremdem Text entschaerfen, den eine Mail an Dritte wiedergibt
// (z. B. die Nachricht im Widerrufsformular): Mailprogramme machen sonst aus
// "evil.example/login" oder "https://..." klickbare Links. Lesbar bleibt es.
export function linksEntschaerfen(text) {
  return String(text ?? "")
    .replace(/:\/\//g, ":⁄⁄")
    .replace(/([\p{L}\p{N}])\.(?=[\p{L}\p{N}])/gu, "$1․")
    .replace(/@/g, "＠");
}

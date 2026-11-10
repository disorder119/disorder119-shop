// Sendungsverfolgung: der Shop erkennt selbst, wann ein Paket unterwegs und
// wann es zugestellt ist (Inhaber 04.11.2026).
//
// Quelle ist die DHL-Schnittstelle "Shipment Tracking - Unified"
// (https://api-eu.dhl.com/track/shipments, Schluessel DHL_TRACKING_API_KEY;
// ohne eigenen Schluessel gilt der der Online-Frankierung, wenn das Produkt im
// Entwicklerportal derselben App zugeordnet ist). Kostenloser Zugang: 250
// Abfragen am Tag, hoechstens eine alle 5 Sekunden - der Cron (alle 15 min)
// fragt deshalb je Sendung hoechstens alle ABFRAGE_ABSTAND_MS und je Lauf
// hoechstens ABFRAGEN_JE_LAUF Sendungen.
//
// Statuswechsel laufen ueber admin-api.updateOrder mit Akteur SYSTEM: "unterwegs"
// setzt die Bestellung auf SHIPPED (Versandmail mit Sendungsnummer geht wie
// beim Klick im Admin), "zugestellt" auf DELIVERED - ohne Mail, die Kundschaft
// weiss das selbst (Inhaber). Status im Kundenkonto zeigt beides.
//
// Sendungsverlauf im Kundenkonto (Inhaber 05.11.2026): die Stationen der
// letzten Abfrage stehen in sendungs_abfragen.ereignisse_json. DHL-Bedingungen
// (developer.dhl.com/api-reference/shipment-tracking): nur fuer die eigene
// Kundschaft, mit dem Vermerk "Delivered by Deutsche Post DHL Group", ohne
// Werbung daneben, und 30 Tage nach Zustellung loeschen (verlaufAufraeumen).
// Der kostenlose Zugang ist laut DHL fuer die Entwicklung gedacht; mit
// hoeherem Kontingent ("Request Upgrade") laesst sich der Abstand ueber
// DHL_TRACKING_ABSTAND_MIN verkuerzen.

import { safeText } from "./commerce-core.js";

export const TRACKING_URL = "https://api-eu.dhl.com/track/shipments";
export const ABFRAGE_ABSTAND_MS = 3 * 3_600_000;
export const ABFRAGEN_JE_LAUF = 6;
export const VERLAUF_LOESCHEN_NACH_ZUSTELLUNG_MS = 30 * 86_400_000;
// Nie zugestellt (Ruecksendung, verloren): 60 Tage nach der letzten Abfrage.
export const VERLAUF_LOESCHEN_OHNE_ZUSTELLUNG_MS = 60 * 86_400_000;
export const VERLAUF_MAX = 25;
const HOECHSTALTER_MS = 45 * 86_400_000;
const PAUSE_ZWISCHEN_ABFRAGEN_MS = 5_200;

// Abstand je Sendung zwischen zwei Abfragen: Standard 3 Stunden, per
// DHL_TRACKING_ABSTAND_MIN zwischen 15 Minuten und einem Tag.
export function abfrageAbstandMs(env = {}) {
  const min = Number.parseInt(String(env?.DHL_TRACKING_ABSTAND_MIN ?? ""), 10);
  if (!Number.isFinite(min)) return ABFRAGE_ABSTAND_MS;
  return Math.min(1440, Math.max(15, min)) * 60_000;
}

// Stationen der Sendung, neueste zuerst: { zeit, text, ort }.
export function verlaufAus(antwort = {}) {
  const sendung = Array.isArray(antwort?.shipments) ? antwort.shipments[0] : null;
  const ereignisse = Array.isArray(sendung?.events) ? sendung.events : [];
  const out = [];
  for (const e of ereignisse) {
    const t = Date.parse(String(e?.timestamp || ""));
    const text = safeText(e?.description || e?.status || "", 200).replace(/\s+/g, " ").trim();
    if (!Number.isFinite(t) || !text) continue;
    const adresse = e?.location?.address || {};
    const ort = safeText(adresse.addressLocality || "", 80).replace(/\s+/g, " ").trim();
    out.push({ zeit: new Date(t).toISOString(), text, ...(ort ? { ort } : {}) });
  }
  return out.sort((a, b) => b.zeit.localeCompare(a.zeit)).slice(0, VERLAUF_MAX);
}

export function trackingReady(env = {}) {
  return Boolean(trackingKey(env));
}

function trackingKey(env = {}) {
  // Die Frankierungs-API kann einen anderen Freigabestand haben. Ihr
  // Schluessel hat in Produktion wiederholt HTTP 401 beim Tracking geliefert.
  return String(env.DHL_TRACKING_API_KEY || "").trim();
}

// Zwischenschritt "abholbereit" (Inhaber 07.11.2026): Das Paket liegt in einer
// Packstation oder Filiale. Entscheidend ist nur der AKTUELLE Status - ist es
// danach abgeholt, gilt es als zugestellt.
const ABGEHOLT_RE = /(aus der|aus dem|in der|in einer) (packstation|postfiliale|filiale|paketshop|paketbox)[^.|]*abgeholt|vom empf[aä]nger abgeholt|picked up by (the )?(recipient|consignee)|collected by (the )?(recipient|consignee)|retir[ée] par le destinataire/i;
const ABHOLBEREIT_RE = /zur abholung bereit|bereit zur abholung|abholbereit|zur abholung (in|im)|ready for (pick-?up|collection)|available for (pick-?up|collection)|disponible (au|pour le) retrait|in die packstation eingelegt|in der packstation eingelegt/i;

// Abholort aus dem Statustext: "PACKSTATION 123 in 63739 Aschaffenburg" o. ae.
export function abholortAusText(text = "") {
  const t = String(text || "");
  const typ = /packstation/i.test(t) ? "packstation" : /filiale|paketshop|retail outlet|post office/i.test(t) ? "filiale" : "";
  const nummer = (/packstation\s*(?:nr\.?\s*)?(\d{1,4})\b/i.exec(t) || [])[1] || "";
  const ort = (/\b(?:in|at)\s+(\d{5})\s+([A-Za-zÄÖÜäöüß .'-]{2,40})/.exec(t) || []);
  return { typ, nummer, plz: ort[1] || "", ort: (ort[2] || "").replace(/\s+(zur|for|ready|bereit).*$/i, "").trim() };
}

// DHL-Antwort auf einen Zustand abbilden. "statusCode" ist das vereinheitlichte
// Feld (pre-transit, transit, delivered, failure, unknown); parcel-de liefert
// daneben Kuerzel wie "ZU" (zugestellt) und deutsche Texte - beides zaehlt.
export function zustandAusAntwort(antwort = {}) {
  const sendung = Array.isArray(antwort?.shipments) ? antwort.shipments[0] : null;
  if (!sendung) return { zustand: "UNBEKANNT", code: "", text: "" };
  const status = sendung.status || {};
  const code = safeText(status.statusCode || "", 40).toLowerCase();
  const text = safeText([status.status, status.description, status.remark].filter(Boolean).join(" · "), 300);
  const ereignisse = Array.isArray(sendung.events) ? sendung.events : [];
  if (ABGEHOLT_RE.test(text)) return { zustand: "ZUGESTELLT", code: code || "abgeholt", text };
  if (code !== "delivered" && ABHOLBEREIT_RE.test(text)) return { zustand: "ABHOLBEREIT", code: code || "abholbereit", text, abholort: abholortAusText(text) };
  const alleTexte = [text, ...ereignisse.map(e => safeText([e?.statusCode, e?.status, e?.description].filter(Boolean).join(" "), 200))].join(" | ");
  const zugestellt = /\bdelivered\b|zugestellt|livr[ée]/i.test(alleTexte) || code === "delivered" || /^zu$/i.test(String(status.statusCode || ""));
  if (zugestellt) return { zustand: "ZUGESTELLT", code: code || "zu", text };
  if (code === "transit") return { zustand: "UNTERWEGS", code, text };
  if (code === "failure") return { zustand: "PROBLEM", code, text };
  if (code === "pre-transit") return { zustand: "OFFEN", code, text };
  // Kein vereinheitlichter Code: ein echter Scan (Einlieferung, Paketzentrum,
  // Zustellung laeuft) heisst unterwegs; die blosse Ankuendigung nicht.
  if (/einlieferung|paketzentrum|in transit|unterwegs|zustellfahrzeug|zugestellt wird|out for delivery|abgeholt|entgegengenommen/i.test(alleTexte)) {
    return { zustand: "UNTERWEGS", code: code || "scan", text };
  }
  if (ereignisse.length === 0 || /angek[uü]ndigt|announced|elektronisch/i.test(alleTexte)) return { zustand: "OFFEN", code: code || "", text };
  return { zustand: "UNBEKANNT", code, text };
}

export async function sendungAbfragen(env, trackingNumber, { plz = "", fetchImpl = fetch } = {}) {
  const url = new URL(TRACKING_URL);
  url.searchParams.set("trackingNumber", trackingNumber);
  url.searchParams.set("service", "parcel-de");
  url.searchParams.set("language", "de");
  if (plz) url.searchParams.set("recipientPostalCode", plz);
  const res = await fetchImpl(url.toString(), {
    method: "GET",
    redirect: "manual",
    signal: AbortSignal.timeout(12_000),
    headers: { "DHL-API-Key": trackingKey(env), Accept: "application/json" },
  });
  if (res.status === 404) return { zustand: "OFFEN", code: "404", text: "DHL kennt die Sendung noch nicht", ereignisse: [] };
  if (res.status === 429) { const e = new Error("DHL_TRACKING_LIMIT"); e.code = "LIMIT"; throw e; }
  if (!res.ok) { const e = new Error(`DHL_TRACKING_HTTP_${res.status}`); e.code = `HTTP_${res.status}`; throw e; }
  const antwort = await res.json();
  return { ...zustandAusAntwort(antwort), ereignisse: verlaufAus(antwort) };
}

// DHL-Bedingungen: Tracking-Daten 30 Tage nach Zustellung loeschen. Uebrig
// bleibt nur der eigene Stand (zustand, Zeitpunkte) fuer den Cron.
export async function verlaufAufraeumen(db, now = Date.now()) {
  const nachZustellung = new Date(now - VERLAUF_LOESCHEN_NACH_ZUSTELLUNG_MS).toISOString();
  const ohneZustellung = new Date(now - VERLAUF_LOESCHEN_OHNE_ZUSTELLUNG_MS).toISOString();
  const r = await db.prepare(`UPDATE sendungs_abfragen SET ereignisse_json=NULL,status_text=NULL,status_code=NULL
    WHERE (ereignisse_json IS NOT NULL OR status_text IS NOT NULL OR status_code IS NOT NULL)
      AND ((zustand='ZUGESTELLT' AND COALESCE(zugestellt_am,geaendert_am,zuletzt_am)<?)
        OR (zustand<>'ZUGESTELLT' AND zuletzt_am<?))`).bind(nachZustellung, ohneZustellung).run();
  return Number(r?.meta?.changes || 0);
}

async function offeneSendungen(db, now, abstandMs = ABFRAGE_ABSTAND_MS) {
  const seit = new Date(now - HOECHSTALTER_MS).toISOString();
  const frist = new Date(now - abstandMs).toISOString();
  return (await db.prepare(`SELECT s.id AS shipment_id,s.order_id,s.tracking_number,s.status AS shipment_status,o.status AS order_status,
      c.postal_code,a.zustand AS letzter_zustand,a.zuletzt_am
    FROM shipments s
    JOIN commerce_orders o ON o.id=s.order_id
    LEFT JOIN order_contact_snapshots c ON c.order_id=o.id
    LEFT JOIN sendungs_abfragen a ON a.shipment_id=s.id
    WHERE s.tracking_number IS NOT NULL AND s.tracking_number<>'' AND s.created_at>=?
      AND o.status IN ('PAID','PREPARING','SHIPPED')
      AND (a.zuletzt_am IS NULL OR a.zuletzt_am<?)
      AND COALESCE(a.zustand,'')<>'ZUGESTELLT'
    ORDER BY COALESCE(a.zuletzt_am,'') ASC, s.created_at ASC LIMIT ?`).bind(seit, frist, ABFRAGEN_JE_LAUF).all()).results || [];
}

async function standMerken(db, sendung, ergebnis, now, fehler = null) {
  const stamp = new Date(now).toISOString();
  const geaendert = ergebnis && ergebnis.zustand !== sendung.letzter_zustand;
  const verlauf = Array.isArray(ergebnis?.ereignisse) && ergebnis.ereignisse.length ? ergebnis.ereignisse.slice(0, VERLAUF_MAX) : null;
  // Zugestellt am: Zeit des juengsten DHL-Ereignisses, sonst jetzt.
  const zugestellt = ergebnis?.zustand === "ZUGESTELLT" ? (verlauf?.[0]?.zeit || stamp) : null;
  await db.prepare(`INSERT INTO sendungs_abfragen (shipment_id,tracking_number,zustand,status_code,status_text,abfragen,zuletzt_am,geaendert_am,fehler,ereignisse_json,zugestellt_am)
    VALUES (?,?,?,?,?,1,?,?,?,?,?)
    ON CONFLICT(shipment_id) DO UPDATE SET zustand=excluded.zustand,status_code=excluded.status_code,status_text=excluded.status_text,
      abfragen=sendungs_abfragen.abfragen+1,zuletzt_am=excluded.zuletzt_am,
      geaendert_am=CASE WHEN sendungs_abfragen.zustand<>excluded.zustand THEN excluded.zuletzt_am ELSE sendungs_abfragen.geaendert_am END,
      fehler=excluded.fehler,
      ereignisse_json=COALESCE(excluded.ereignisse_json,sendungs_abfragen.ereignisse_json),
      zugestellt_am=COALESCE(sendungs_abfragen.zugestellt_am,excluded.zugestellt_am)`)
    .bind(sendung.shipment_id, sendung.tracking_number, ergebnis?.zustand || sendung.letzter_zustand || "UNBEKANNT",
      ergebnis?.code || null, ergebnis?.text || null, stamp, geaendert ? stamp : null, fehler ? safeText(fehler, 160) : null,
      verlauf ? JSON.stringify(verlauf) : null, zugestellt).run();
}

// Cron: offene Sendungen bei DHL nachsehen und Bestellstatus nachziehen.
// `statusSetzen(orderId, status)` ist admin-api.orderStatusAutomatisch; so
// bleibt dieses Modul frei von Mail- und Zahlungslogik.
// `abholbereitMelden(sendung, stand)` (optional): einmal, wenn eine Sendung
// neu "abholbereit" ist - der Cron meldet es per Telegram. Die Abholmail an
// die Kundschaft geht NIE von selbst, nur ueber die Admin-App (Inhaber).
export async function sendungenVerfolgen(env, reqId = crypto.randomUUID(), now = Date.now(), { statusSetzen, abholbereitMelden = null, fetchImpl = fetch, warten = null } = {}) {
  if (!env?.DB) return { uebersprungen: true };
  // Loeschpflicht gilt auch, wenn die Abfrage gerade nicht eingerichtet ist.
  const geloescht = await verlaufAufraeumen(env.DB, now).catch(err => {
    console.error(JSON.stringify({ level: "error", event: "dhl_tracking_cleanup_failed", requestId: reqId, message: safeText(err?.message || "", 160) }));
    return 0;
  });
  if (!trackingReady(env) || typeof statusSetzen !== "function") return { uebersprungen: true, geloescht };
  const db = env.DB;
  const ergebnis = { abgefragt: 0, versendet: [], abholbereit: [], zugestellt: [], fehler: [], geloescht };
  const sendungen = await offeneSendungen(db, now, abfrageAbstandMs(env));
  for (const [i, sendung] of sendungen.entries()) {
    if (i > 0) await (warten || (ms => new Promise(r => setTimeout(r, ms))))(PAUSE_ZWISCHEN_ABFRAGEN_MS);
    let stand;
    try {
      stand = await sendungAbfragen(env, sendung.tracking_number, { plz: safeText(sendung.postal_code || "", 10), fetchImpl });
      ergebnis.abgefragt += 1;
    } catch (err) {
      ergebnis.fehler.push({ orderId: sendung.order_id, code: err?.code || "FEHLER" });
      console.error(JSON.stringify({ level: "error", event: "dhl_tracking_failed", requestId: reqId, orderId: String(sendung.order_id), code: safeText(err?.code || err?.message || "", 80) }));
      await standMerken(db, sendung, null, now, err?.code || err?.message || "FEHLER").catch(() => {});
      if (err?.code === "LIMIT") break;
      continue;
    }
    await standMerken(db, sendung, stand, now);
    try {
      if (stand.zustand === "UNTERWEGS" || stand.zustand === "ABHOLBEREIT" || stand.zustand === "ZUGESTELLT") {
        if (sendung.order_status === "PAID") await statusSetzen(sendung.order_id, "PREPARING");
        if (sendung.order_status !== "SHIPPED") {
          await statusSetzen(sendung.order_id, "SHIPPED");
          ergebnis.versendet.push(sendung.order_id);
        }
      }
      if (stand.zustand === "ABHOLBEREIT" && sendung.letzter_zustand !== "ABHOLBEREIT") {
        ergebnis.abholbereit.push(sendung.order_id);
        if (typeof abholbereitMelden === "function") {
          await Promise.resolve(abholbereitMelden(sendung, stand)).catch(err => {
            console.error(JSON.stringify({ level: "warn", event: "dhl_abholbereit_meldung_failed", requestId: reqId, orderId: String(sendung.order_id), message: safeText(err?.message || "", 120) }));
          });
        }
      }
      if (stand.zustand === "ZUGESTELLT") {
        await statusSetzen(sendung.order_id, "DELIVERED");
        ergebnis.zugestellt.push(sendung.order_id);
      }
    } catch (err) {
      ergebnis.fehler.push({ orderId: sendung.order_id, code: safeText(err?.code || err?.message || "STATUS", 80) });
      console.error(JSON.stringify({ level: "error", event: "dhl_tracking_status_failed", requestId: reqId, orderId: String(sendung.order_id), code: safeText(err?.code || err?.message || "", 80) }));
    }
  }
  return ergebnis;
}

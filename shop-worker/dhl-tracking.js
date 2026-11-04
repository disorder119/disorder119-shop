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

import { safeText } from "./commerce-core.js";

export const TRACKING_URL = "https://api-eu.dhl.com/track/shipments";
export const ABFRAGE_ABSTAND_MS = 3 * 3_600_000;
export const ABFRAGEN_JE_LAUF = 6;
const HOECHSTALTER_MS = 45 * 86_400_000;
const PAUSE_ZWISCHEN_ABFRAGEN_MS = 5_200;

export function trackingReady(env = {}) {
  return Boolean(trackingKey(env));
}

function trackingKey(env = {}) {
  return String(env.DHL_TRACKING_API_KEY || env.DHL_PRIVAT_API_KEY || "").trim();
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
  if (res.status === 404) return { zustand: "OFFEN", code: "404", text: "DHL kennt die Sendung noch nicht" };
  if (res.status === 429) { const e = new Error("DHL_TRACKING_LIMIT"); e.code = "LIMIT"; throw e; }
  if (!res.ok) { const e = new Error(`DHL_TRACKING_HTTP_${res.status}`); e.code = `HTTP_${res.status}`; throw e; }
  return zustandAusAntwort(await res.json());
}

async function offeneSendungen(db, now) {
  const seit = new Date(now - HOECHSTALTER_MS).toISOString();
  const frist = new Date(now - ABFRAGE_ABSTAND_MS).toISOString();
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
  await db.prepare(`INSERT INTO sendungs_abfragen (shipment_id,tracking_number,zustand,status_code,status_text,abfragen,zuletzt_am,geaendert_am,fehler)
    VALUES (?,?,?,?,?,1,?,?,?)
    ON CONFLICT(shipment_id) DO UPDATE SET zustand=excluded.zustand,status_code=excluded.status_code,status_text=excluded.status_text,
      abfragen=sendungs_abfragen.abfragen+1,zuletzt_am=excluded.zuletzt_am,
      geaendert_am=CASE WHEN sendungs_abfragen.zustand<>excluded.zustand THEN excluded.zuletzt_am ELSE sendungs_abfragen.geaendert_am END,
      fehler=excluded.fehler`)
    .bind(sendung.shipment_id, sendung.tracking_number, ergebnis?.zustand || sendung.letzter_zustand || "UNBEKANNT",
      ergebnis?.code || null, ergebnis?.text || null, stamp, geaendert ? stamp : null, fehler ? safeText(fehler, 160) : null).run();
}

// Cron: offene Sendungen bei DHL nachsehen und Bestellstatus nachziehen.
// `statusSetzen(orderId, status)` ist admin-api.orderStatusAutomatisch; so
// bleibt dieses Modul frei von Mail- und Zahlungslogik.
export async function sendungenVerfolgen(env, reqId = crypto.randomUUID(), now = Date.now(), { statusSetzen, fetchImpl = fetch, warten = null } = {}) {
  if (!env?.DB || !trackingReady(env) || typeof statusSetzen !== "function") return { uebersprungen: true };
  const db = env.DB;
  const ergebnis = { abgefragt: 0, versendet: [], zugestellt: [], fehler: [] };
  const sendungen = await offeneSendungen(db, now);
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
      if (stand.zustand === "UNTERWEGS" || stand.zustand === "ZUGESTELLT") {
        if (sendung.order_status === "PAID") await statusSetzen(sendung.order_id, "PREPARING");
        if (sendung.order_status !== "SHIPPED") {
          await statusSetzen(sendung.order_id, "SHIPPED");
          ergebnis.versendet.push(sendung.order_id);
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

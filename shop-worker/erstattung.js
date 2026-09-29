// Erstattungen ueber PayPal.
//
// 1. Admin-App: "Erstatten" bei einer Bestellung zahlt den noch offenen
//    Betrag (Ware + Versand, abzueglich frueherer Erstattungen) ueber die
//    PayPal-API an den Kaeufer zurueck und stellt die Bestellung auf
//    "Erstattet". Derselbe Schluessel (PayPal-Request-Id) sorgt dafuer, dass
//    ein doppelter Klick oder ein Netzfehler nie doppelt auszahlt.
// 2. Webhook PAYMENT.CAPTURE.REFUNDED: wer direkt in PayPal erstattet, sieht
//    die Erstattung trotzdem in der Admin-App, und die Bestellung wechselt
//    auf "Erstattet", sobald alles zurueckgezahlt ist.
//
// Wie bisher gilt die Statuslogik aus commerce-core.js: "Erstattet" geht aus
// "Bezahlt", "In Vorbereitung" und "Zurueckgeschickt". Ist ein Paket schon
// unterwegs, erst die Ruecksendung erfassen.
import { canTransitionOrder, safeText } from "./commerce-core.js";

export class ErstattungsFehler extends Error {
  constructor(code, status = 409, detail = null) {
    super(code);
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

function paypalApiBase(env) {
  return String(env.PAYPAL_ENVIRONMENT || "sandbox").toLowerCase() === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";
}

async function paypalToken(env) {
  if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET) throw new ErstattungsFehler("PAYPAL_NOT_CONFIGURED", 503);
  const res = await fetch(`${paypalApiBase(env)}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new ErstattungsFehler("PAYPAL_ANMELDUNG_FEHLGESCHLAGEN", 502);
  return (await res.json()).access_token;
}

function euro(cents) {
  return (Number(cents) / 100).toFixed(2);
}

function centsAus(value) {
  const text = String(value ?? "");
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return null;
  const [ganz, teil = ""] = text.split(".");
  return Number(ganz) * 100 + Number(teil.padEnd(2, "0"));
}

async function bestellung(db, id) {
  const order = await db.prepare("SELECT * FROM commerce_orders WHERE id=? OR order_number=?").bind(id, id).first();
  if (!order) throw new ErstattungsFehler("ORDER_NOT_FOUND", 404);
  return order;
}

async function schonErstattet(db, orderId) {
  const row = await db.prepare("SELECT COALESCE(SUM(amount_cents),0) AS cents FROM refunds WHERE order_id=? AND status='COMPLETED'")
    .bind(orderId).first();
  return Number(row?.cents || 0);
}

async function paypalZahlung(db, orderId) {
  return db.prepare(`SELECT * FROM payments WHERE order_id=? AND provider='PAYPAL' AND provider_payment_id IS NOT NULL
    AND status IN ('COMPLETED','PARTIALLY_REFUNDED','REFUNDED') ORDER BY created_at DESC LIMIT 1`).bind(orderId).first();
}

async function protokoll(db, orderId, eventType, reqId, metadata, actor = "ADMIN") {
  await db.prepare(`INSERT INTO audit_events (id,actor_type,entity_type,entity_id,event_type,request_id,metadata_json,created_at)
    VALUES (?,?,'order',?,?,?,?,?)`)
    .bind(crypto.randomUUID(), actor, orderId, eventType, safeText(reqId, 120), JSON.stringify(metadata), new Date().toISOString()).run();
}

async function zahlungsstatusNachziehen(db, payment, order) {
  const erstattet = await schonErstattet(db, order.id);
  const status = erstattet >= Number(order.total_cents) ? "REFUNDED" : erstattet > 0 ? "PARTIALLY_REFUNDED" : null;
  if (status) {
    await db.prepare("UPDATE payments SET status=?,updated_at=? WHERE id=?").bind(status, new Date().toISOString(), payment.id).run();
  }
  return erstattet;
}

// statusSetzen(orderId, "REFUNDED", actor) kommt aus admin-api.js (updateOrder):
// derselbe Weg wie der Statusknopf, mit Lagerstueck und Protokoll.
export async function bestellungErstatten(env, id, body, reqId, statusSetzen) {
  const db = env.DB;
  if (!db) throw new ErstattungsFehler("COMMERCE_DATABASE_NOT_CONFIGURED", 503);
  const order = await bestellung(db, id);
  if (order.status === "REFUNDED") return { bereits: true, betragCents: 0 };
  if (!canTransitionOrder(order.status, "REFUNDED")) {
    throw new ErstattungsFehler("ERSTATTUNG_STATUS", 409, { status: order.status });
  }
  const payment = await paypalZahlung(db, order.id);
  if (!payment) throw new ErstattungsFehler("KEINE_PAYPAL_ZAHLUNG", 409);

  const schon = await schonErstattet(db, order.id);
  const offen = Number(order.total_cents) - schon;
  // Eine Bestellung darf nie mehr aus einer einzelnen Capture erstatten, als
  // PayPal fuer diese Zahlung urspruenglich verbucht hat.
  if (offen > Number(payment.amount_cents) - schon || payment.currency !== order.currency) {
    throw new ErstattungsFehler("ERSTATTUNG_BETRAG_ABWEICHUNG", 409, {
      bestellungCents: Number(order.total_cents), zahlungCents: Number(payment.amount_cents), erstattetCents: schon,
    });
  }
  if (offen > 0) {
    // Ein Schluessel je offenem Restbetrag: ein zweiter Klick findet dieselbe
    // Zeile und schickt PayPal dieselbe Request-Id - PayPal zahlt nur einmal.
    const schluessel = `erstattung:${order.id}:${schon}`;
    const jetzt = new Date().toISOString();
    await db.prepare(`INSERT OR IGNORE INTO refunds (id,order_id,payment_id,amount_cents,currency,status,idempotency_key,created_at,updated_at)
      VALUES (?,?,?,?,'EUR','PENDING',?,?,?)`).bind(crypto.randomUUID(), order.id, payment.id, offen, schluessel, jetzt, jetzt).run();
    const zeile = await db.prepare("SELECT * FROM refunds WHERE idempotency_key=?").bind(schluessel).first();

    if (zeile.status !== "COMPLETED") {
      // Ein fehlgeschlagener Versuch darf wiederholt werden (gleiche Request-Id).
      if (zeile.status === "FAILED") {
        await db.prepare("UPDATE refunds SET status='PENDING',updated_at=? WHERE id=?").bind(new Date().toISOString(), zeile.id).run();
      }
      const token = await paypalToken(env);
      const notiz = safeText(body?.notiz || `Erstattung Bestellung ${order.order_number}`, 250);
      const res = await fetch(`${paypalApiBase(env)}/v2/payments/captures/${encodeURIComponent(payment.provider_payment_id)}/refund`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "PayPal-Request-Id": schluessel,
          Prefer: "return=representation",
        },
        body: JSON.stringify({ amount: { value: euro(zeile.amount_cents), currency_code: "EUR" }, note_to_payer: notiz }),
      });
      const antwort = await res.json().catch(() => ({}));
      if (!res.ok) {
        const grund = safeText(antwort?.details?.[0]?.issue || antwort?.name || `HTTP ${res.status}`, 80);
        const debugId = safeText(antwort?.debug_id || res.headers.get("paypal-debug-id"), 120);
        await db.prepare("UPDATE refunds SET status='FAILED',updated_at=? WHERE id=?").bind(new Date().toISOString(), zeile.id).run();
        await protokoll(db, order.id, "ORDER_REFUND_FAILED", reqId, { grund, debugId, paypalStatus: res.status, betragCents: zeile.amount_cents });
        // Auch eine noch nicht aktualisierte Admin-App soll den konkreten
        // Deckungsfehler erkennen, statt nur die allgemeine Ablehnung zu zeigen.
        const code = grund === "REFUND_FAILED_INSUFFICIENT_FUNDS"
          ? "PAYPAL_GUTHABEN_NICHT_AUSREICHEND" : "PAYPAL_ERSTATTUNG_FEHLGESCHLAGEN";
        throw new ErstattungsFehler(code, 502, { grund, debugId, paypalStatus: res.status });
      }
      const status = String(antwort.status || "").toUpperCase() === "COMPLETED" ? "COMPLETED" : "PENDING";
      await db.prepare("UPDATE refunds SET status=?,provider_refund_id=?,updated_at=? WHERE id=?")
        .bind(status, safeText(antwort.id, 120) || null, new Date().toISOString(), zeile.id).run();
      await protokoll(db, order.id, "ORDER_REFUND_SENT", reqId, { betragCents: zeile.amount_cents, paypalStatus: status, refundId: safeText(antwort.id, 120) });
      if (status !== "COMPLETED") {
        return { ausstehend: true, betragCents: zeile.amount_cents };
      }
    }
  }
  const erstattet = await zahlungsstatusNachziehen(db, payment, order);
  if (erstattet >= Number(order.total_cents)) await statusSetzen(order.id, "REFUNDED");
  return { betragCents: offen > 0 ? offen : 0 };
}

// Webhook PAYMENT.CAPTURE.REFUNDED (Signatur hat worker.js schon geprueft).
export async function erstattungAusWebhook(env, event, reqId, statusSetzen) {
  const r = event?.resource || {};
  if (String(r.status || "").toUpperCase() !== "COMPLETED" || !r.id) return { uebersprungen: true };
  const db = env.DB;
  const captureId = r.supplementary_data?.related_ids?.capture_id
    || (r.links || []).map(x => /\/v2\/payments\/captures\/([^/?]+)/.exec(String(x.href || ""))?.[1]).find(Boolean);
  if (!captureId) return { uebersprungen: true };
  const payment = await db.prepare("SELECT * FROM payments WHERE provider='PAYPAL' AND provider_payment_id=?").bind(captureId).first();
  if (!payment) return { uebersprungen: true };
  const order = await bestellung(db, payment.order_id);
  const betrag = centsAus(r.amount?.value);
  if (!betrag || r.amount?.currency_code !== "EUR") return { uebersprungen: true };

  const jetzt = new Date().toISOString();
  const bekannt = await db.prepare("SELECT id FROM refunds WHERE provider_refund_id=?").bind(String(r.id)).first();
  if (bekannt) {
    await db.prepare("UPDATE refunds SET status='COMPLETED',updated_at=? WHERE id=?").bind(jetzt, bekannt.id).run();
  } else {
    await db.prepare(`INSERT OR IGNORE INTO refunds (id,order_id,payment_id,provider_refund_id,amount_cents,currency,status,idempotency_key,created_at,updated_at)
      VALUES (?,?,?,?,?,'EUR','COMPLETED',?,?,?)`)
      .bind(crypto.randomUUID(), order.id, payment.id, String(r.id), betrag, `paypal-refund:${r.id}`, jetzt, jetzt).run();
    await protokoll(db, order.id, "ORDER_REFUND_FROM_PAYPAL", reqId, { betragCents: betrag, refundId: String(r.id) }, "PAYMENT_PROVIDER");
  }
  const erstattet = await zahlungsstatusNachziehen(db, payment, order);
  if (erstattet >= Number(order.total_cents) && order.status !== "REFUNDED" && canTransitionOrder(order.status, "REFUNDED")) {
    await statusSetzen(order.id, "REFUNDED");
  }
  return { erstattetCents: erstattet };
}

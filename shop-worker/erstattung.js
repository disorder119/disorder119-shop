// Erstattungen ueber PayPal.
//
// 1. Admin-App: Stornieren, "Ware eingegangen" oder Kulanz legen einen
//    Erstattungsauftrag an (erstattung-auftrag.js). Er zahlt ueber die
//    urspruengliche PayPal-Zahlung zurueck - keine neue Geldsendung - und
//    wiederholt es selbst, wenn das Guthaben nicht reicht. Die Bausteine dafuer
//    (ein einzelner Versuch, Statusabfrage, Guthaben) stehen hier.
// 2. Webhook PAYMENT.CAPTURE.REFUNDED: wer direkt in PayPal erstattet, sieht
//    die Erstattung trotzdem in der Admin-App, und die Bestellung wechselt
//    auf "Erstattet", sobald alles zurueckgezahlt ist.
// 3. Abgleich: liest dieselben Ereignisse bei PayPal nach, falls ein Webhook
//    verloren ging.
//
// Wie bisher gilt die Statuslogik aus commerce-core.js: "Erstattet" geht aus
// "Bezahlt", "In Vorbereitung" und "Zurueckgeschickt".
import { canTransitionOrder, safeText } from "./commerce-core.js";
import { recordVerifiedRefund } from "./tax-evidence.js";

const REFUND_SYNC_CACHE_MS = 5 * 60 * 1000;
// PayPal haelt Webhook-Ereignisse rund 30 Tage vor; ein aelterer Beginn laesst
// die ganze Liste scheitern. Der Cron laeuft alle 15 Minuten, 29 Tage reichen.
const REFUND_SYNC_DAYS = 29;
const REFUND_SYNC_MAX_PAGES = 50;
const refundSyncByDatabase = new WeakMap();

export class ErstattungsFehler extends Error {
  constructor(code, status = 409, detail = null) {
    super(code);
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

export function paypalApiBase(env) {
  return String(env.PAYPAL_ENVIRONMENT || "sandbox").toLowerCase() === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";
}

export async function paypalToken(env) {
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

function captureIdAusErstattung(resource) {
  return resource?.supplementary_data?.related_ids?.capture_id
    || (resource?.links || []).map(x => /\/v2\/payments\/captures\/([^/?]+)/.exec(String(x.href || ""))?.[1]).find(Boolean)
    || null;
}

// PayPal erwartet Zeitpunkte ohne Millisekunden (2026-09-30T09:15:00Z).
export function paypalZeit(date) {
  return new Date(date).toISOString().replace(/\.\d{3}Z$/, "Z");
}

function paypalEventNextUrl(base, links) {
  const href = (links || []).find(link => String(link?.rel || "").toLowerCase() === "next")?.href;
  if (!href) return null;
  const next = new URL(String(href), base);
  const allowed = new URL(base);
  if (next.origin !== allowed.origin || next.pathname !== "/v1/notifications/webhooks-events") {
    throw new ErstattungsFehler("PAYPAL_EVENT_PAGINATION_INVALID", 502);
  }
  return next.toString();
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

export async function schonErstattet(db, orderId) {
  const row = await db.prepare("SELECT COALESCE(SUM(amount_cents),0) AS cents FROM refunds WHERE order_id=? AND status='COMPLETED'")
    .bind(orderId).first();
  return Number(row?.cents || 0);
}

export async function paypalZahlung(db, orderId) {
  return db.prepare(`SELECT * FROM payments WHERE order_id=? AND provider='PAYPAL' AND provider_payment_id IS NOT NULL
    AND status IN ('COMPLETED','PARTIALLY_REFUNDED','REFUNDED') ORDER BY created_at DESC LIMIT 1`).bind(orderId).first();
}

async function protokoll(db, orderId, eventType, reqId, metadata, actor = "ADMIN") {
  await db.prepare(`INSERT INTO audit_events (id,actor_type,entity_type,entity_id,event_type,request_id,metadata_json,created_at)
    VALUES (?,?,'order',?,?,?,?,?)`)
    .bind(crypto.randomUUID(), actor, orderId, eventType, safeText(reqId, 120), JSON.stringify(metadata), new Date().toISOString()).run();
}

export async function zahlungsstatusNachziehen(db, payment, order) {
  const erstattet = await schonErstattet(db, order.id);
  const status = erstattet >= Number(order.total_cents) ? "REFUNDED" : erstattet > 0 ? "PARTIALLY_REFUNDED" : null;
  if (status) {
    await db.prepare("UPDATE payments SET status=?,updated_at=? WHERE id=?").bind(status, new Date().toISOString(), payment.id).run();
  }
  return erstattet;
}

// ---------------------------------------------------------------------------
// Bausteine fuer Erstattungsauftraege (erstattung-auftrag.js). Ein einzelner
// Versuch wirft nie, sondern ordnet PayPals Antwort ein - der Auftrag
// entscheidet danach, ob und wann er es noch einmal versucht.
//
//   DECKUNG          Guthaben reicht nicht. PayPal hat sicher nichts gezahlt;
//                    der naechste Versuch braucht eine neue Request-Id, sonst
//                    liefert PayPal nur die alte Ablehnung zurueck.
//   SCHON_ERSTATTET  Die Zahlung ist (teilweise) schon zurueckgezahlt.
//   VORLAEUFIG       Netz, Zeitueberschreitung, PayPal-Stoerung: unklar, ob
//                    ausgezahlt wurde. Derselbe Schluessel holt beim naechsten
//                    Versuch die echte Antwort ab - nie doppelt.
//   ABGELEHNT        PayPal meldet die Erstattung als gescheitert.
//   ENDGUELTIG       Alles andere (Frist abgelaufen, Konflikt, keine Rechte):
//                    ein neuer Versuch aendert nichts, der Inhaber muss ran.
// ---------------------------------------------------------------------------
const SCHON_ERSTATTET_GRUENDE = new Set(["CAPTURE_FULLY_REFUNDED", "REFUND_AMOUNT_EXCEEDED"]);

export function paypalFehlerArt(httpStatus, grund) {
  if (grund === "REFUND_FAILED_INSUFFICIENT_FUNDS") return "DECKUNG";
  if (SCHON_ERSTATTET_GRUENDE.has(grund)) return "SCHON_ERSTATTET";
  const status = Number(httpStatus) || 0;
  if (!status || status >= 500 || [408, 409, 429].includes(status)) return "VORLAEUFIG";
  return "ENDGUELTIG";
}

export async function paypalCaptureErstatten(env, { captureId, betragCents, volleCapture, requestId, notiz }) {
  let token;
  try {
    token = await paypalToken(env);
  } catch (err) {
    const code = safeText(err?.code || "PAYPAL_ANMELDUNG_FEHLGESCHLAGEN", 80);
    return { ok: false, art: code === "PAYPAL_NOT_CONFIGURED" ? "ENDGUELTIG" : "VORLAEUFIG", grund: code, httpStatus: 0, debugId: null };
  }
  // Die volle Capture mit leerem Koerper, sonst genau der Betrag - immer
  // ueber die urspruengliche Zahlung, nie als neue Geldsendung.
  const body = volleCapture ? {} : {
    amount: { value: euro(betragCents), currency_code: "EUR" },
    ...(notiz ? { note_to_payer: safeText(notiz, 250) } : {}),
  };
  let res;
  try {
    res = await fetch(`${paypalApiBase(env)}/v2/payments/captures/${encodeURIComponent(captureId)}/refund`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "PayPal-Request-Id": requestId,
        Prefer: "return=representation",
      },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, art: "VORLAEUFIG", grund: "NETZFEHLER", httpStatus: 0, debugId: null };
  }
  const antwort = await res.json().catch(() => ({}));
  const debugId = safeText(antwort?.debug_id || res.headers.get("paypal-debug-id"), 120) || null;
  if (!res.ok) {
    const grund = safeText(antwort?.details?.[0]?.issue || antwort?.name || `HTTP ${res.status}`, 80);
    return { ok: false, art: paypalFehlerArt(res.status, grund), grund, httpStatus: res.status, debugId };
  }
  const status = String(antwort.status || "").toUpperCase();
  const refundId = safeText(antwort.id, 120) || null;
  if (status === "FAILED" || status === "CANCELLED") {
    return { ok: false, art: "ABGELEHNT", grund: `REFUND_${status}`, httpStatus: res.status, debugId, refundId };
  }
  return {
    ok: true,
    status: status === "COMPLETED" ? "COMPLETED" : "PENDING",
    refundId,
    grund: safeText(antwort?.status_details?.reason || "", 80) || null,
    httpStatus: res.status,
    debugId,
  };
}

// Stand einer Erstattung, die PayPal mit PENDING angenommen hat.
export async function paypalErstattungAbfragen(env, refundId) {
  const token = await paypalToken(env);
  const res = await fetch(`${paypalApiBase(env)}/v2/payments/refunds/${encodeURIComponent(refundId)}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ErstattungsFehler("PAYPAL_ERSTATTUNG_STATUS_UNBEKANNT", 502, { paypalStatus: res.status });
  return {
    status: String(body.status || "").toUpperCase(),
    betragCents: centsAus(body.amount?.value),
    grund: safeText(body?.status_details?.reason || "", 80) || null,
  };
}

// Verfuegbares PayPal-Guthaben (EUR) - nur zur Anzeige ("es fehlen 2,40 €").
// Die Abfrage braucht in der PayPal-App die Freigabe "Transaction search";
// ohne sie bleibt der Betrag unbekannt, und der Auftrag versucht es trotzdem:
// ein bestaetigtes Bankkonto deckt Erstattungen auch ohne Guthaben.
const GUTHABEN_CACHE_MS = 5 * 60 * 1000;
const guthabenCache = new WeakMap();

export async function paypalGuthaben(env, { frisch = false } = {}) {
  const schluessel = env?.DB || env;
  const gemerkt = schluessel && typeof schluessel === "object" ? guthabenCache.get(schluessel) : null;
  if (!frisch && gemerkt && Date.now() - gemerkt.zeit < GUTHABEN_CACHE_MS) return gemerkt.wert;
  let wert;
  try {
    const token = await paypalToken(env);
    const res = await fetch(`${paypalApiBase(env)}/v1/reporting/balances?currency_code=EUR`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    if (!res.ok) {
      wert = { bekannt: false, grund: res.status === 403 ? "NICHT_FREIGEGEBEN" : `HTTP_${res.status}` };
    } else {
      const body = await res.json().catch(() => ({}));
      const eur = (body.balances || []).find(b => String(b?.currency || "").toUpperCase() === "EUR");
      const cents = eur ? centsAus(eur.available_balance?.value ?? eur.total_balance?.value) : 0;
      wert = cents === null ? { bekannt: false, grund: "UNLESBAR" } : { bekannt: true, verfuegbarCents: cents, stand: new Date().toISOString() };
    }
  } catch {
    wert = { bekannt: false, grund: "NICHT_ERREICHBAR" };
  }
  if (schluessel && typeof schluessel === "object") guthabenCache.set(schluessel, { zeit: Date.now(), wert });
  return wert;
}

// Webhook PAYMENT.CAPTURE.REFUNDED (Signatur hat worker.js schon geprueft).
export async function erstattungAusWebhook(env, event, reqId, statusSetzen) {
  const r = event?.resource || {};
  if (String(r.status || "").toUpperCase() !== "COMPLETED" || !r.id) return { uebersprungen: true };
  const db = env.DB;
  const captureId = captureIdAusErstattung(r);
  if (!captureId) return { uebersprungen: true };
  const payment = await db.prepare("SELECT * FROM payments WHERE provider='PAYPAL' AND provider_payment_id=?").bind(captureId).first();
  if (!payment) return { uebersprungen: true };
  const order = await bestellung(db, payment.order_id);
  const betrag = centsAus(r.amount?.value);
  if (!betrag || r.amount?.currency_code !== "EUR") return { uebersprungen: true };

  const jetzt = new Date().toISOString();
  const bekannt = await db.prepare("SELECT id FROM refunds WHERE provider_refund_id=?").bind(String(r.id)).first();
  // Die Meldung kann schneller sein als der eigene Eintrag: Der Server wartet
  // noch auf PayPals Antwort, seine Zeile steht auf PENDING ohne PayPal-Id.
  // Dann gehoert die Meldung zu genau dieser Zeile - eine zweite Zeile wuerde
  // die Erstattung doppelt zaehlen.
  let zeileId = bekannt?.id || null;
  if (!zeileId) {
    const unterwegs = await db.prepare(`SELECT id FROM refunds WHERE payment_id=? AND amount_cents=?
      AND status='PENDING' AND provider_refund_id IS NULL ORDER BY created_at DESC LIMIT 1`).bind(payment.id, betrag).first();
    if (unterwegs) {
      const angehaengt = await db.prepare("UPDATE refunds SET provider_refund_id=?,updated_at=? WHERE id=? AND provider_refund_id IS NULL")
        .bind(String(r.id), jetzt, unterwegs.id).run();
      // Hat der Server die Zeile gerade selbst verknuepft, gilt seine Id.
      zeileId = angehaengt.meta?.changes ? unterwegs.id
        : (await db.prepare("SELECT id FROM refunds WHERE provider_refund_id=?").bind(String(r.id)).first())?.id || null;
    }
  }
  if (zeileId) {
    await db.prepare("UPDATE refunds SET status='COMPLETED',updated_at=? WHERE id=?").bind(jetzt, zeileId).run();
  } else {
    await db.prepare(`INSERT OR IGNORE INTO refunds (id,order_id,payment_id,provider_refund_id,amount_cents,currency,status,idempotency_key,created_at,updated_at)
      VALUES (?,?,?,?,?,'EUR','COMPLETED',?,?,?)`)
      .bind(crypto.randomUUID(), order.id, payment.id, String(r.id), betrag, `paypal-refund:${r.id}`, jetzt, jetzt).run();
    await protokoll(db, order.id, "ORDER_REFUND_FROM_PAYPAL", reqId, { betragCents: betrag, refundId: String(r.id) }, "PAYMENT_PROVIDER");
  }
  const erstattet = await zahlungsstatusNachziehen(db, payment, order);
  let bestellstatusAktualisiert = false;
  if (erstattet >= Number(order.total_cents) && order.status !== "REFUNDED" && canTransitionOrder(order.status, "REFUNDED")) {
    await statusSetzen(order.id, "REFUNDED");
    bestellstatusAktualisiert = true;
  }
  return {
    orderId: order.id,
    erstattetCents: erstattet,
    vollstaendig: erstattet >= Number(order.total_cents),
    bestellstatusAktualisiert,
    bestellstatusPruefen: erstattet >= Number(order.total_cents)
      && order.status !== "REFUNDED" && !bestellstatusAktualisiert,
  };
}

// Rueckzahlungen, die direkt im PayPal-Geschaeftskonto angestossen werden,
// meldet PayPal nur, wenn der Webhook PAYMENT.CAPTURE.REFUNDED abonniert hat -
// "8 - PayPal verbinden" legte ihn anfangs nur mit PAYMENT.CAPTURE.COMPLETED
// an. Die Admin-App bietet dafuer einen Knopf, sobald der Abgleich das Fehlen
// bemerkt; der Server ergaenzt das Ereignis und behaelt alle anderen.
export async function paypalWebhookErstattungenAbonnieren(env, { cacheLeeren = true } = {}) {
  if (!env.PAYPAL_WEBHOOK_ID) throw new ErstattungsFehler("PAYPAL_WEBHOOK_FEHLT", 409);
  const token = await paypalToken(env);
  const url = `${paypalApiBase(env)}/v1/notifications/webhooks/${encodeURIComponent(env.PAYPAL_WEBHOOK_ID)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
  const webhook = await res.json().catch(() => ({}));
  if (!res.ok) throw new ErstattungsFehler("PAYPAL_WEBHOOK_STATUS_UNAVAILABLE", 502, { paypalStatus: res.status });
  const vorher = (webhook.event_types || []).map(entry => String(entry?.name || "")).filter(Boolean);
  if (vorher.includes("*") || vorher.includes("PAYMENT.CAPTURE.REFUNDED")) return { ok: true, bereits: true, eventTypes: vorher };
  const eventTypes = [...new Set([...vorher, "PAYMENT.CAPTURE.COMPLETED", "PAYMENT.CAPTURE.REFUNDED"])];
  const patch = await fetch(url, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify([{ op: "replace", path: "/event_types", value: eventTypes.map(name => ({ name })) }]),
  });
  const antwort = await patch.json().catch(() => ({}));
  if (!patch.ok) {
    throw new ErstattungsFehler("PAYPAL_WEBHOOK_AENDERUNG_FEHLGESCHLAGEN", 502, {
      paypalStatus: patch.status, debugId: safeText(antwort?.debug_id || patch.headers.get("paypal-debug-id"), 120),
    });
  }
  // Der naechste Abgleich soll den neuen Stand zeigen, nicht den gemerkten.
  if (cacheLeeren && env.DB) refundSyncByDatabase.delete(env.DB);
  return { ok: true, bereits: false, eventTypes };
}

async function webhookProtokoll(db, eventType, reqId, metadata) {
  if (!db) return;
  await db.prepare(`INSERT INTO audit_events (id,actor_type,entity_type,entity_id,event_type,request_id,metadata_json,created_at)
    VALUES (?,'SYSTEM','paypal_webhook','refunds',?,?,?,?)`)
    .bind(crypto.randomUUID(), eventType, safeText(reqId, 120), JSON.stringify(metadata), new Date().toISOString()).run();
}

// Zweite Sicherung neben dem Webhook: PayPal fuehrt auch Rueckzahlungen auf,
// die direkt im Geschaeftskonto angestossen wurden. Der Abgleich liest diese
// Provider-Ereignisse nach und verarbeitet sie ueber denselben idempotenten
// Weg wie ein live zugestellter Webhook. So geht bei einem voruebergehenden
// Worker-/D1-Fehler kein Admin-Status dauerhaft verloren.
export async function paypalErstattungenAbgleichen(env, reqId, statusSetzen, options = {}) {
  if (!env?.DB) throw new ErstattungsFehler("COMMERCE_DATABASE_NOT_CONFIGURED", 503);
  if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET) {
    return { ok: false, configured: false, code: "PAYPAL_NOT_CONFIGURED" };
  }

  const force = options.force === true;
  const now = options.now instanceof Date ? options.now : new Date();
  const existing = refundSyncByDatabase.get(env.DB);
  if (!force && existing?.result && now.getTime() - existing.checkedAt < REFUND_SYNC_CACHE_MS) {
    return { ...existing.result, cached: true };
  }
  if (!force && existing?.promise) return existing.promise;

  const promise = (async () => {
    const token = await paypalToken(env);
    const base = paypalApiBase(env);
    let webhookSubscribed = null;
    let webhookCheckCode = null;
    if (env.PAYPAL_WEBHOOK_ID) {
      const webhookRes = await fetch(`${base}/v1/notifications/webhooks/${encodeURIComponent(env.PAYPAL_WEBHOOK_ID)}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      });
      const webhook = await webhookRes.json().catch(() => ({}));
      if (webhookRes.ok) {
        const types = (webhook.event_types || []).map(entry => String(entry?.name || ""));
        webhookSubscribed = types.includes("*") || types.includes("PAYMENT.CAPTURE.REFUNDED");
        if (!webhookSubscribed) {
          // Selbstheilung: Fehlt das Ereignis (so legte "8 - PayPal verbinden"
          // den Webhook anfangs an), ergaenzt der Server es einmal - alle
          // anderen Ereignisse bleiben. Klappt das nicht, bleibt der Hinweis
          // samt Knopf in der Admin-App.
          try {
            const ergebnis = await paypalWebhookErstattungenAbonnieren(env, { cacheLeeren: false });
            webhookSubscribed = true;
            await webhookProtokoll(env.DB, "PAYPAL_WEBHOOK_REFUNDS_SUBSCRIBED", reqId, { automatisch: true, eventTypes: ergebnis.eventTypes });
          } catch (err) {
            webhookCheckCode = "PAYPAL_REFUND_WEBHOOK_NOT_SUBSCRIBED";
            console.warn(JSON.stringify({ level: "warn", event: "paypal_webhook_refund_subscribe_failed", requestId: safeText(reqId, 120), code: safeText(err?.code || err?.message || "unknown", 80) }));
          }
        }
      } else {
        webhookCheckCode = "PAYPAL_WEBHOOK_STATUS_UNAVAILABLE";
      }
    }
    const start = paypalZeit(now.getTime() - REFUND_SYNC_DAYS * 24 * 60 * 60 * 1000);
    const end = paypalZeit(now);
    let next = `${base}/v1/notifications/webhooks-events?${new URLSearchParams({
      start_time: start,
      end_time: end,
      event_type: "PAYMENT.CAPTURE.REFUNDED",
      page_size: "20",
    })}`;
    let pages = 0;
    let gesehen = 0;
    let zugeordnet = 0;
    let aktualisiert = 0;
    let bestellstatusPruefen = 0;
    const fehler = [];

    while (next && pages < REFUND_SYNC_MAX_PAGES) {
      const res = await fetch(next, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new ErstattungsFehler("PAYPAL_REFUND_EVENT_LIST_FAILED", 502, {
          paypalStatus: res.status,
          debugId: safeText(body?.debug_id || res.headers.get("paypal-debug-id"), 120),
          // PayPals eigener Grund - ohne ihn laesst sich ein Fehler nur raten.
          grund: safeText(body?.details?.[0]?.issue || body?.name || "", 80),
          feld: safeText(body?.details?.[0]?.field || "", 80),
        });
      }
      pages += 1;
      for (const event of body.events || []) {
        if (event?.event_type !== "PAYMENT.CAPTURE.REFUNDED") continue;
        gesehen += 1;
        const captureId = captureIdAusErstattung(event.resource);
        if (!captureId) continue;
        const payment = await env.DB.prepare("SELECT id FROM payments WHERE provider='PAYPAL' AND provider_payment_id=?")
          .bind(captureId).first();
        if (!payment) continue;
        zugeordnet += 1;
        try {
          const result = await erstattungAusWebhook(env, event, reqId, statusSetzen);
          if (result?.uebersprungen) continue;
          await recordVerifiedRefund(env, event);
          aktualisiert += 1;
          if (result?.bestellstatusPruefen) bestellstatusPruefen += 1;
        } catch (err) {
          fehler.push(safeText(err?.code || err?.message || "REFUND_SYNC_FAILED", 80));
        }
      }
      next = paypalEventNextUrl(base, body.links);
    }
    if (next) throw new ErstattungsFehler("PAYPAL_REFUND_EVENT_PAGE_LIMIT", 502);

    const result = {
      ok: fehler.length === 0 && webhookSubscribed !== false,
      configured: true,
      webhookSubscribed,
      webhookCheckCode,
      checkedAt: now.toISOString(),
      windowStart: start,
      pages,
      seen: gesehen,
      matched: zugeordnet,
      updated: aktualisiert,
      orderStatusReview: bestellstatusPruefen,
      errors: [...new Set(fehler)].slice(0, 5),
      cached: false,
    };
    if (result.ok) refundSyncByDatabase.set(env.DB, { checkedAt: now.getTime(), result, promise: null });
    return result;
  })();

  refundSyncByDatabase.set(env.DB, { checkedAt: existing?.checkedAt || 0, result: existing?.result || null, promise });
  try {
    return await promise;
  } finally {
    const current = refundSyncByDatabase.get(env.DB);
    if (current?.promise === promise) refundSyncByDatabase.set(env.DB, { ...current, promise: null });
  }
}

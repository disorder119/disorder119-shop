// PayPal-Anbindung, die der Server selbst nachzieht (Cron alle 15 Minuten).
//
// Apple Pay laeuft ueber PayPal (assets/kasse.js, paypal.Applepay). Dafuer
// muss die Shop-Domain bei PayPal fuer Apple Pay registriert sein; die
// Bestaetigungsdatei liegt schon unter
// https://disorder119.com/.well-known/apple-developer-merchantid-domain-association.
// Der Server registriert die Domain einmal ueber die PayPal-API
// (POST /v1/customer/wallet-domains) mit den vorhandenen Zugangsdaten.
//
//   * Nur live und nur mit PayPal-Zugang am Server.
//   * Nach einem Erfolg nie wieder; nach einem Fehler hoechstens einmal am Tag
//     ein neuer Versuch (etwa bis Apple Pay fuer die PayPal-App freigeschaltet
//     ist) - kein Dauerfeuer auf PayPal, keine Flut im Protokoll.
//   * Ergebnis steht im Audit-Protokoll (entity paypal/apple-pay-domain), ohne
//     Zugangsdaten.
import { safeText } from "./commerce-core.js";
import { paypalApiBase, paypalToken } from "./erstattung.js";
import { istSandbox } from "./sandbox.js";

export const APPLE_PAY_DOMAIN = "disorder119.com";
const APPLE_PAY_DOMAIN_LIVE = APPLE_PAY_DOMAIN;
// Der Testshop meldet seine eigene Adresse in der PayPal-Sandbox an.
export const APPLE_PAY_DOMAIN_TEST = "test.disorder119.com";
const TAG_MS = 24 * 60 * 60 * 1000;
const ERFOLG = "PAYPAL_APPLE_PAY_DOMAIN_REGISTERED";
const FEHLER = "PAYPAL_APPLE_PAY_DOMAIN_FAILED";

async function protokoll(db, eventType, metadata) {
  await db.prepare(`INSERT INTO audit_events (id,actor_type,entity_type,entity_id,event_type,request_id,metadata_json,created_at)
    VALUES (?,'SYSTEM','paypal','apple-pay-domain',?,NULL,?,?)`)
    .bind(crypto.randomUUID(), eventType, JSON.stringify(metadata), new Date().toISOString()).run();
}

function domainNamen(liste) {
  const eintraege = Array.isArray(liste?.wallet_domains) ? liste.wallet_domains : Array.isArray(liste?.domains) ? liste.domains : [];
  return eintraege.map(e => String(e?.domain?.name || e?.name || "").toLowerCase()).filter(Boolean);
}

// PayPal meldet eine schon registrierte Domain als Fehler - das ist ein Erfolg.
function schonRegistriert(antwort) {
  const text = JSON.stringify(antwort || {}).toUpperCase();
  return /ALREADY[_ ]?(REGISTERED|EXISTS)|DUPLICATE/.test(text);
}

export async function applePayDomainSicherstellen(env, now = Date.now()) {
  if (!env?.DB || !env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET) return { uebersprungen: "PAYPAL_NOT_CONFIGURED" };
  const testshop = istSandbox(env);
  if (!testshop && String(env.PAYPAL_ENVIRONMENT || "").toLowerCase() !== "live") return { uebersprungen: "NOT_LIVE" };
  const APPLE_PAY_DOMAIN = testshop ? APPLE_PAY_DOMAIN_TEST : APPLE_PAY_DOMAIN_LIVE;
  const letzte = await env.DB.prepare(`SELECT event_type,created_at FROM audit_events
    WHERE entity_type='paypal' AND entity_id='apple-pay-domain' ORDER BY created_at DESC LIMIT 1`).first();
  if (letzte?.event_type === ERFOLG) return { ok: true, bereits: true };
  // Nach drei Fehlschlaegen nur noch woechentlich: Apple Pay laeuft dann meist
  // laengst ueber die Freigabe im PayPal-Konto, und das Protokoll soll nicht
  // jeden Tag denselben Eintrag bekommen.
  if (letzte) {
    const fehlschlaege = Number((await env.DB.prepare(`SELECT COUNT(*) AS n FROM audit_events
      WHERE entity_type='paypal' AND entity_id='apple-pay-domain' AND event_type=?`).bind(FEHLER).first())?.n || 0);
    if (Number(now) - Date.parse(letzte.created_at) < (fehlschlaege >= 3 ? 7 * TAG_MS : TAG_MS)) return { uebersprungen: "SPAETER_ERNEUT" };
  }

  const token = await paypalToken(env);
  const base = paypalApiBase(env);
  const kopf = { Authorization: `Bearer ${token}`, Accept: "application/json" };

  // Erst nachsehen - vielleicht ist die Domain schon im Dashboard eingetragen.
  const liste = await fetch(`${base}/v1/customer/wallet-domains?provider_type=APPLE_PAY&page=1&page_size=50`, { headers: kopf });
  const listeDaten = liste.ok ? await liste.json().catch(() => ({})) : {};
  if (liste.ok && domainNamen(listeDaten).includes(APPLE_PAY_DOMAIN)) {
    await protokoll(env.DB, ERFOLG, { domain: APPLE_PAY_DOMAIN, bereits: true });
    return { ok: true, bereits: true };
  }

  const res = await fetch(`${base}/v1/customer/wallet-domains`, {
    method: "POST",
    headers: { ...kopf, "Content-Type": "application/json" },
    body: JSON.stringify({ provider_type: "APPLE_PAY", domain: { name: APPLE_PAY_DOMAIN } }),
  });
  const antwort = await res.json().catch(() => ({}));
  if (res.ok || schonRegistriert(antwort)) {
    await protokoll(env.DB, ERFOLG, { domain: APPLE_PAY_DOMAIN, bereits: !res.ok });
    return { ok: true, bereits: !res.ok };
  }
  const grund = safeText(antwort?.details?.[0]?.issue || antwort?.name || `HTTP ${res.status}`, 80);
  await protokoll(env.DB, FEHLER, {
    domain: APPLE_PAY_DOMAIN, paypalStatus: res.status, grund,
    debugId: safeText(antwort?.debug_id || res.headers.get("paypal-debug-id") || "", 120) || null,
    listeStatus: liste.status, listeDomains: domainNamen(listeDaten).length,
    hinweis: "Apple Pay in der PayPal-App (Live) aktivieren; der Server versucht es morgen erneut, nach drei Fehlschlägen wöchentlich.",
  });
  return { ok: false, paypalStatus: res.status, grund };
}

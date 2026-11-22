// Ruecksendeetikett (Inhaber 05.11.2026): Joel erstellt in der Admin-App fuer
// eine Bestellung eine DHL-Marke der Online-Frankierung mit der Kundin als
// Absender und sich selbst als Empfaenger - IMMER an die Adresse des Shops
// (senderAddress = DHL_SHIPPER_*, Nelseestrasse 25, Aschaffenburg), nie an eine
// andere. Er bezahlt auf dhl.de; danach holt der Shop QR-Code und PDF und
// schickt der Kundin die Mail (Vorlagen A-D, ruecksendung-texte.js).
//
// Ohne DHL-Geschaeftskundenvertrag (unter 200 Pakete im Jahr) gibt es keine
// Returns-API; DHL erlaubt Haendlern ausdruecklich, Kundinnen ein vorbereitetes
// Etikett der Online-Frankierung zu geben. Absender muss eine deutsche
// Strassenadresse sein (keine Packstation), deshalb nur fuer Kundinnen in DE.
//
// Bezahlstatus: DHL liefert seit 11/2026 keine Warenkorb-Nummer mehr; sie kommt
// ueber die DHL-Auftragsbestaetigung an kontakt@ (dhl-qr.js#warenkorbZuordnen,
// beruecksichtigt auch diese Tabelle). Danach fragt der Cron (alle 15 min) nach.
//
// Oeffentlich (ohne Anmeldung, nur mit dem langen Zugang aus der Mail):
//   GET /ruecksendung/<zugang>            Seite mit grossem QR-Code (fuer den Schalter)
//   GET /ruecksendung/<zugang>/qr.png     QR-Code fuer die Mail
//   GET /ruecksendung/<zugang>/etikett.pdf
// Admin (wie dhl-qr.js mit Admin-Schluessel):
//   GET  /admin/ruecksendung/<orderId>                Stand, Vorschlag, DHL-Produkte
//   POST /admin/ruecksendung/<orderId>                Etikett anlegen -> Bezahl-Link
//   POST /admin/ruecksendung/<orderId>/aktualisieren  bei DHL nachsehen, QR holen, Mail senden
//   POST /admin/ruecksendung/<orderId>/mail           Mail (erneut) senden
//   GET  /admin/ruecksendung/<orderId>/vorschau       Mail-Vorschau (HTML)
import { safeText } from "./commerce-core.js";
import {
  DhlQrError, adminHerkunftErlaubt, adminKopf, adminTokenGleich, dhlAnfrage, dhlQrReady, dhlText,
  listProducts, safeDhlCheckoutUrl, senderAddress, splitStreet,
} from "./dhl-qr.js";
import { SELLER, normalizeEmail, sendMail } from "./customer-mail.js";
import { katalogNachId } from "./oeffentlicher-katalog.js";
import { istSandbox } from "./sandbox.js";
import { VORLAGEN, ruecksendeMailHtml, ruecksendeMailText, ruecksendeTexte, vorlageFuer } from "./ruecksendung-texte.js";

export const ANLAESSE = Object.freeze(["WIDERRUF", "REKLAMATION"]);
const KLASSEN_PRODUKT = Object.freeze({ S: "PAK02", M: "PAK05", L: "PAK10", XL: "PAK20", XXL: "PAK315" });
const RUECKSENDBAR = Object.freeze(["SHIPPED", "DELIVERED", "RETURN_REQUESTED", "RETURNED"]);
export const QR_MAX_VERSUCHE = 30;
const QR_PAUSE_MS = 10 * 60_000;
// Zugang aus der Mail: so lange gilt der Link (DHL-Etikett selbst gilt laenger).
export const ZUGANG_GUELTIG_MS = 180 * 86_400_000;
const ABGLEICH_TAGE = 30;

function oeffentlicheBasis(env) {
  return istSandbox(env) ? "https://api-test.disorder119.com" : "https://api.disorder119.com";
}

function db(env) {
  if (!env?.DB) throw new DhlQrError("DATENBANK_FEHLT", 503);
  return env.DB;
}

async function sha256Hex(text) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(text))));
  return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
}

function zufallsZugang() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function toBase64(buffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function istPdf(buffer) {
  return String.fromCharCode(...new Uint8Array(buffer.slice(0, 5))) === "%PDF-";
}

// ------------------------------------------------------------ Bestellung & Adressen

async function bestellungLesen(env, orderId) {
  const order = await db(env).prepare(`SELECT o.id,o.order_number,o.status,
      c.email,c.recipient_name,c.given_name,c.surname,c.address_line1,c.address_line2,c.postal_code,c.city,c.country_code,
      v.paket AS versand_paket
    FROM commerce_orders o
    LEFT JOIN order_contact_snapshots c ON c.order_id=o.id
    LEFT JOIN order_versand v ON v.order_id=o.id
    WHERE o.id=? OR o.order_number=? LIMIT 1`).bind(safeText(orderId, 80), safeText(orderId, 80)).first();
  if (!order) throw new DhlQrError("BESTELLUNG_NICHT_GEFUNDEN", 404);
  return order;
}

function kundinName(order) {
  return safeText(order.recipient_name || [order.given_name, order.surname].filter(Boolean).join(" "), 80).replace(/\s+/g, " ").trim();
}

// Vorschlag fuer den Absender (die Kundin). Packstation/Postfiliale geht als
// Absender nicht - dann muss Joel die Wohnadresse eintragen.
export function absenderVorschlag(order = {}) {
  const { street, streetNumber } = splitStreet(order.address_line1 || "");
  const abholort = /^(packstation|postfiliale)$/i.test(String(street || "").trim());
  return {
    name: kundinName(order),
    street: abholort ? "" : street,
    streetNumber: abholort ? "" : streetNumber,
    plz: abholort ? "" : safeText(order.postal_code || "", 10),
    city: abholort ? "" : safeText(order.city || "", 40),
    land: String(order.country_code || "DE").toUpperCase() || "DE",
    abholortBestellung: abholort,
  };
}

// Absender im Format der Online-Frankierung; nur deutsche Strassenadressen.
export function absenderAus(eingabe = {}, order = {}) {
  const vorschlag = absenderVorschlag(order);
  const a = { ...vorschlag, ...Object.fromEntries(Object.entries(eingabe || {}).filter(([, v]) => v !== undefined && v !== null)) };
  const land = String(a.land || "DE").toUpperCase();
  if (land !== "DE") throw new DhlQrError("RUECKSENDUNG_NUR_DE", 409, "Rücksendeetiketten der Online-Frankierung gehen nur aus Deutschland.");
  const absender = {
    name2: dhlText(a.name, 50).trim(),
    street: dhlText(a.street, 50).trim(),
    streetNumber: dhlText(a.streetNumber, 10).trim(),
    plz: dhlText(a.plz, 5).trim(),
    city: dhlText(a.city, 40).trim(),
    country: "DEU",
  };
  if (/^(packstation|postfiliale)$/i.test(absender.street)) {
    throw new DhlQrError("ABSENDER_ABHOLORT", 409, "Als Absender braucht DHL die Wohnadresse der Kundin, keine Packstation oder Filiale.");
  }
  const fehlend = [];
  if (absender.name2.length < 3) fehlend.push("Name");
  if (!absender.street) fehlend.push("Straße");
  if (!absender.streetNumber) fehlend.push("Hausnummer");
  if (!/^\d{5}$/.test(absender.plz)) fehlend.push("PLZ");
  if (absender.city.length < 2) fehlend.push("Ort");
  if (fehlend.length) throw new DhlQrError("ABSENDER_UNVOLLSTAENDIG", 409, fehlend.join(", "));
  return absender;
}

// Empfaenger ist immer der Shop selbst (Joel, Aschaffenburg).
export function empfaengerShop(env = {}) {
  const shop = senderAddress(env);
  return { name2: shop.name2, street: shop.street, streetNumber: shop.streetNumber, plz: shop.plz, city: shop.city, country: "DEU" };
}

// Stuecke der Bestellung mit Marke, Kategorie, Groesse und Foto aus dem Katalog.
async function artikelLesen(env, orderId, katalogOptionen = {}) {
  const zeilen = (await db(env).prepare(`SELECT item_id,article_no,title_snapshot FROM order_items WHERE order_id=? ORDER BY id`)
    .bind(orderId).all()).results || [];
  let katalog = new Map();
  try { katalog = await katalogNachId({ env, ...katalogOptionen }); } catch { katalog = new Map(); }
  return zeilen.map(z => {
    const k = katalog.get(Number(z.item_id)) || {};
    const galerie = Array.isArray(k.gallery) ? k.gallery : [];
    return {
      itemId: Number(z.item_id),
      title: safeText(k.title || z.title_snapshot || "Artikel", 180),
      brand: safeText(k.brand || "", 40),
      category: safeText(k.category || "", 30),
      size: safeText(k.size || "", 20),
      articleNo: safeText(z.article_no || k.article || "", 30),
      bild: safeText(galerie[0] || k.grid_image || "", 200),
    };
  });
}

async function widerrufFrist(env, orderId) {
  try {
    const w = await db(env).prepare(`SELECT eingegangen_at FROM widerrufe WHERE order_id=? ORDER BY eingegangen_at DESC LIMIT 1`).bind(orderId).first();
    const t = Date.parse(w?.eingegangen_at || "");
    return Number.isFinite(t) ? new Date(t + 14 * 86_400_000).toISOString() : null;
  } catch { return null; }
}

// ------------------------------------------------------------ Anzeige

function view(m) {
  if (!m) return null;
  return {
    id: m.id,
    anlass: m.anlass,
    vorlage: m.vorlage,
    kosten: m.kosten,
    state: m.state,
    produkt: m.product_id,
    preisCents: m.price_cents == null ? null : Number(m.price_cents),
    bezahlLink: m.state === "PAYED" || m.state === "ERSETZT" ? null : m.entry_url,
    sendungsnummer: m.shipment_number || null,
    qr: Boolean(m.qr_png_b64),
    pdf: Boolean(m.label_pdf_b64),
    ohneAbgleich: String(m.cart_id || "").startsWith("ohne-"),
    mailAn: m.mail_an || null,
    mailGesendetAm: m.mail_gesendet_at || null,
    mailFehler: m.mail_fehler || null,
    erstelltAm: m.created_at,
    bezahltAm: m.paid_at || null,
  };
}

async function markeLesen(env, id) {
  return db(env).prepare("SELECT * FROM ruecksende_marken WHERE id=?").bind(id).first();
}

export async function ruecksendungenDerBestellung(env, orderId) {
  const rows = (await db(env).prepare(`SELECT * FROM ruecksende_marken WHERE order_id=? AND state<>'ERSETZT' ORDER BY created_at DESC`)
    .bind(orderId).all()).results || [];
  return rows.map(view);
}

// ------------------------------------------------------------ Anlegen

export async function ruecksendungAnlegen(env, orderId, body = {}, now = new Date().toISOString()) {
  const order = await bestellungLesen(env, orderId);
  if (!RUECKSENDBAR.includes(String(order.status))) {
    throw new DhlQrError("BESTELLUNG_NICHT_RUECKSENDBAR", 409, `Status ${order.status}: erst nach dem Versand.`);
  }
  const anlass = ANLAESSE.includes(body.anlass) ? body.anlass : "WIDERRUF";
  const vorlage = anlass === "REKLAMATION" ? "D"
    : (["A", "B", "C"].includes(body.vorlage) ? body.vorlage : vorlageFuer(anlass, order.order_number));
  // Reklamation: Kosten traegt immer der Shop. Widerruf: Joel entscheidet.
  const kosten = anlass === "REKLAMATION" ? "SHOP" : body.kosten === "KUNDIN" ? "KUNDIN" : "SHOP";
  const absender = absenderAus(body.absender || {}, order);
  if (!dhlQrReady(env)) throw new DhlQrError("DHL_QR_NICHT_EINGERICHTET", 503);
  const produkt = safeText(body.produkt || KLASSEN_PRODUKT[String(order.versand_paket || "S")] || "PAK02", 40);
  if (!/^[A-Z0-9.]{3,40}$/.test(produkt)) throw new DhlQrError("PRODUKT_FEHLT", 400);
  if (!(await listProducts(env, "DE")).some(p => p.id === produkt)) throw new DhlQrError("PRODUKT_NICHT_FUER_LAND", 409, `${produkt} → DE`);

  const shop = senderAddress(env);
  const antwort = await dhlAnfrage(env, "/shopping-carts/pre-paid", {
    method: "POST",
    body: {
      shoppingcart: {
        // Die Bestaetigung geht an den Shop (kontakt@) - daraus kommt die Warenkorb-Nummer.
        confirmation: { email: shop.email },
        items: [{ type: "ShipmentItem", product: { id: produkt }, address: { sender: absender, receiver: empfaengerShop(env) } }],
      },
    },
  });
  const json = await antwort.json().catch(() => null);
  const cart = json?.shoppingcart || {};
  const entryUrl = String(cart.download?.entryUrl || "");
  if (!safeDhlCheckoutUrl(entryUrl)) throw new DhlQrError("DHL_ANTWORT_UNGUELTIG", 502, "kein Bezahl-Link von DHL");
  let cartId = safeText(cart.shoppingCartId, 12);
  if (!/^[A-Za-z0-9]{12}$/.test(cartId)) {
    const hash = await sha256Hex(entryUrl);
    cartId = "ohne-" + hash.slice(0, 20);
  }
  const preis = (cart.items?.[0]?.prices || []).reduce((s, p) => s + Math.round(Number(p.amount || 0) * 100), 0) || null;
  const id = crypto.randomUUID();
  const d = db(env);
  await d.batch([
    d.prepare("UPDATE ruecksende_marken SET state='ERSETZT',updated_at=? WHERE order_id=? AND state<>'PAYED'").bind(now, order.id),
    d.prepare(`INSERT INTO ruecksende_marken (id,order_id,anlass,vorlage,kosten,cart_id,product_id,entry_url,state,price_cents,absender_json,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,'PREPAID',?,?,?,?)`).bind(id, order.id, anlass, vorlage, kosten, cartId, produkt, entryUrl, preis,
      JSON.stringify({ name: absender.name2, street: absender.street, streetNumber: absender.streetNumber, plz: absender.plz, city: absender.city }), now, now),
    d.prepare(`INSERT INTO audit_events (id,actor_type,entity_type,entity_id,event_type,request_id,metadata_json,created_at)
      VALUES (?,'ADMIN','order',?,'RUECKSENDEETIKETT_ANGELEGT',NULL,?,?)`)
      .bind(crypto.randomUUID(), order.id, JSON.stringify({ anlass, vorlage, kosten, produkt, preisCents: preis }), now),
  ]);
  return view(await markeLesen(env, id));
}

// ------------------------------------------------------------ Bezahlt? QR? Mail?

async function qrHolen(env, mark, now) {
  const versuche = Number(mark.qr_versuche || 0);
  const zuletzt = Date.parse(mark.qr_versucht_am || "") || 0;
  if (versuche >= QR_MAX_VERSUCHE || (zuletzt && Date.parse(now) - zuletzt < QR_PAUSE_MS)) return mark;
  const d = db(env);
  await d.prepare("UPDATE ruecksende_marken SET qr_versuche=qr_versuche+1,qr_versucht_am=?,updated_at=? WHERE id=?").bind(now, now, mark.id).run();
  let qr = mark.qr_png_b64 || null;
  let pdf = mark.label_pdf_b64 || null;
  const kennungen = [...new Set([mark.pak_id, mark.shipment_number].map(v => safeText(v, 40)).filter(v => /^[A-Za-z0-9]{6,40}$/.test(v)))];
  for (const k of kennungen) {
    if (!qr) {
      try {
        const png = await (await dhlAnfrage(env, `/labels/${encodeURIComponent(k)}/qr-code`, { accept: "image/png" })).arrayBuffer();
        if (png.byteLength >= 100 && png.byteLength <= 200_000) qr = toBase64(png);
      } catch { /* naechste Kennung */ }
    }
    if (!pdf) {
      try {
        const buf = await (await dhlAnfrage(env, `/labels/${encodeURIComponent(k)}`, { accept: "application/pdf" })).arrayBuffer();
        if (buf.byteLength > 200 && buf.byteLength <= 1_400_000 && istPdf(buf)) pdf = toBase64(buf);
      } catch { /* naechste Kennung */ }
    }
    if (qr && pdf) break;
  }
  if (qr !== mark.qr_png_b64 || pdf !== mark.label_pdf_b64) {
    await d.prepare("UPDATE ruecksende_marken SET qr_png_b64=COALESCE(?,qr_png_b64),label_pdf_b64=COALESCE(?,label_pdf_b64),updated_at=? WHERE id=?")
      .bind(qr, pdf, now, mark.id).run();
  }
  return { ...mark, qr_png_b64: qr, label_pdf_b64: pdf };
}

export async function ruecksendungAktualisieren(env, markId, now = new Date().toISOString(), { katalogOptionen = {} } = {}) {
  let mark = await markeLesen(env, markId);
  if (!mark || mark.state === "ERSETZT") return view(mark);
  const d = db(env);
  if (mark.state !== "PAYED" && !String(mark.cart_id).startsWith("ohne-")) {
    const cart = (await (await dhlAnfrage(env, `/shopping-carts/${encodeURIComponent(mark.cart_id)}`)).json())?.shoppingcart || {};
    const state = safeText(cart.state, 20);
    if (state !== "PAYED") {
      if (state && state !== mark.state) await d.prepare("UPDATE ruecksende_marken SET state=?,updated_at=? WHERE id=?").bind(state, now, mark.id).run();
      return view({ ...mark, state: state || mark.state });
    }
    const item = (cart.items || []).find(x => x?.shipmentNumber) || {};
    const sendung = safeText(item.shipmentNumber, 40);
    if (!/^[A-Za-z0-9]{8,40}$/.test(sendung)) throw new DhlQrError("DHL_ANTWORT_UNGUELTIG", 502);
    const pakId = safeText(item.pakId, 12) || null;
    await d.batch([
      d.prepare("UPDATE ruecksende_marken SET state='PAYED',shipment_number=?,pak_id=?,paid_at=?,updated_at=? WHERE id=?").bind(sendung, pakId, now, now, mark.id),
      d.prepare(`INSERT INTO audit_events (id,actor_type,entity_type,entity_id,event_type,request_id,metadata_json,created_at)
        VALUES (?,'SYSTEM','order',?,'RUECKSENDEETIKETT_BEZAHLT',NULL,?,?)`)
        .bind(crypto.randomUUID(), mark.order_id, JSON.stringify({ sendungsnummer: sendung }), now),
    ]);
    mark = { ...mark, state: "PAYED", shipment_number: sendung, pak_id: pakId, paid_at: now };
  }
  if (mark.state === "PAYED" && (!mark.qr_png_b64 || !mark.label_pdf_b64)) mark = await qrHolen(env, mark, now);
  if (mark.state === "PAYED" && (mark.qr_png_b64 || mark.label_pdf_b64) && !mark.mail_gesendet_at) {
    await ruecksendeMailSenden(env, mark.id, { now, katalogOptionen });
    mark = await markeLesen(env, mark.id);
  }
  return view(mark);
}

// Mail an die Kundin. Neuer Zugang bei jedem Senden (alter Link verfaellt).
export async function ruecksendeMailSenden(env, markId, { now = new Date().toISOString(), erneut = false, katalogOptionen = {} } = {}) {
  const d = db(env);
  const mark = await markeLesen(env, markId);
  if (!mark || mark.state !== "PAYED") throw new DhlQrError("ETIKETT_NOCH_NICHT_BEZAHLT", 409);
  if (!mark.qr_png_b64 && !mark.label_pdf_b64) throw new DhlQrError("ETIKETT_NOCH_NICHT_DA", 409, "DHL hat QR-Code und PDF noch nicht geliefert.");
  // Nur einmal gleichzeitig: wer den Platz bekommt, sendet.
  const sperre = await d.prepare(`UPDATE ruecksende_marken SET mail_gesendet_at=?,mail_fehler=NULL,updated_at=?
    WHERE id=? AND (mail_gesendet_at IS NULL OR ?=1)`).bind(now, now, mark.id, erneut ? 1 : 0).run();
  if (!sperre?.meta?.changes) return { sent: false, reason: "SCHON_GESENDET" };
  try {
    const order = await bestellungLesen(env, mark.order_id);
    const an = normalizeEmail(order.email || "");
    if (!an) throw new DhlQrError("KUNDIN_OHNE_MAIL", 409);
    const zugang = zufallsZugang();
    const basis = `${oeffentlicheBasis(env)}/ruecksendung/${zugang}`;
    const links = { seite: basis, qr: mark.qr_png_b64 ? `${basis}/qr.png` : "", pdf: mark.label_pdf_b64 ? `${basis}/etikett.pdf` : "" };
    const texte = ruecksendeTexte({
      vorlage: mark.vorlage, anlass: mark.anlass, kosten: mark.kosten, preisCents: mark.price_cents,
      vorname: safeText(order.given_name || kundinName(order).split(" ")[0] || "", 40),
      bestellnummer: order.order_number, artikel: await artikelLesen(env, order.id, katalogOptionen),
      fristBis: mark.anlass === "WIDERRUF" ? await widerrufFrist(env, order.id) : null,
    });
    await d.prepare("UPDATE ruecksende_marken SET zugang_hash=?,mail_an=?,updated_at=? WHERE id=?").bind(await sha256Hex(zugang), an, now, mark.id).run();
    const ergebnis = await sendMail(env, {
      to: an, toName: kundinName(order), subject: texte.betreff,
      html: ruecksendeMailHtml(texte, { links, sendungsnummer: mark.shipment_number }),
      text: ruecksendeMailText(texte, { links, sendungsnummer: mark.shipment_number }),
      tag: "ruecksendung", kopieAnShop: true,
      anhaenge: mark.label_pdf_b64 ? [{ name: "Ruecksendeetikett-DHL.pdf", b64: mark.label_pdf_b64 }] : [],
    });
    if (!ergebnis?.sent) throw new DhlQrError("MAIL_NICHT_GESENDET", 502, safeText(ergebnis?.reason || "", 60));
    await d.prepare(`INSERT INTO audit_events (id,actor_type,entity_type,entity_id,event_type,request_id,metadata_json,created_at)
      VALUES (?,'SYSTEM','order',?,'RUECKSENDE_MAIL_GESENDET',NULL,?,?)`)
      .bind(crypto.randomUUID(), mark.order_id, JSON.stringify({ vorlage: mark.vorlage, erneut }), now).run().catch(() => {});
    return { sent: true, vorlage: mark.vorlage };
  } catch (err) {
    await d.prepare("UPDATE ruecksende_marken SET mail_gesendet_at=NULL,mail_fehler=?,updated_at=? WHERE id=?")
      .bind(safeText(err?.detail || err?.code || err?.message || "FEHLER", 160), now, mark.id).run().catch(() => {});
    throw err;
  }
}

// Cron: offene Warenkoerbe nachsehen, fehlende QR-Codes holen, Mails nachholen.
export async function ruecksendungenAbgleichen(env, now = Date.now()) {
  if (!env?.DB || !dhlQrReady(env)) return { uebersprungen: true };
  const seit = new Date(now - ABGLEICH_TAGE * 86_400_000).toISOString();
  let offene = [];
  try {
    offene = (await env.DB.prepare(`SELECT id,order_id FROM ruecksende_marken WHERE created_at>=? AND state<>'ERSETZT' AND (
        (state IN ('PREPAID','INPAYMENT') AND cart_id NOT LIKE 'ohne-%')
        OR (state='PAYED' AND (qr_png_b64 IS NULL OR label_pdf_b64 IS NULL) AND qr_versuche<?)
        OR (state='PAYED' AND mail_gesendet_at IS NULL AND (qr_png_b64 IS NOT NULL OR label_pdf_b64 IS NOT NULL) AND mail_fehler IS NULL))
      ORDER BY created_at ASC LIMIT 10`).bind(seit, QR_MAX_VERSUCHE).all()).results || [];
  } catch { return { uebersprungen: true, grund: "TABELLE_FEHLT" }; }
  const ergebnis = { geprueft: 0, fehler: [] };
  for (const row of offene) {
    try {
      await ruecksendungAktualisieren(env, row.id, new Date(now).toISOString());
      ergebnis.geprueft += 1;
    } catch (err) {
      ergebnis.fehler.push({ orderId: String(row.order_id), code: safeText(err?.code || err?.message || "", 80) });
    }
  }
  return ergebnis;
}

// ------------------------------------------------------------ Oeffentliche Seite

export function isRuecksendungOeffentlich(url) {
  return /^\/ruecksendung\/[A-Za-z0-9_-]{40,64}(\/qr\.png|\/etikett\.pdf)?\/?$/.test(url.pathname);
}

const SEITEN_KOPF = Object.freeze({
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-Robots-Tag": "noindex, nofollow",
});

// Nur QR-Code, Sendungsnummer und die Shop-Adresse - keine Daten der Kundin.
function seiteHtml(mark) {
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const nummer = String(mark.shipment_number || "").replace(/(.{4})/g, "$1 ").trim();
  return `<!DOCTYPE html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>Rücksendeetikett · DISORDER119</title>
<style>body{margin:0;background:#000;color:#f2efe7;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;text-align:center}
.w{max-width:440px;margin:0 auto;padding:28px 20px 40px}.m{font-weight:700;letter-spacing:.36em;font-size:14px;padding-bottom:20px;border-bottom:1px solid #2b2a27}
h1{font-size:24px;text-transform:uppercase;margin:26px 0 8px}p{color:#9c978d;font-size:14px;line-height:1.5}
.q{background:#fff;padding:14px;margin:18px auto;width:min(78vw,300px)}.q img{width:100%;display:block;image-rendering:pixelated}
.n{font-family:Consolas,monospace;font-size:16px;color:#f2efe7;letter-spacing:.04em}.k{display:inline-block;margin-top:14px;background:#f2efe7;color:#000;padding:13px 22px;font-weight:700;font-size:12px;letter-spacing:.16em;text-transform:uppercase;text-decoration:none}
.a{margin-top:22px;border-top:1px solid #2b2a27;padding-top:16px;font-size:13px;line-height:1.6;color:#f2efe7}</style></head>
<body><div class="w"><div class="m">DISORDER119</div><h1>Dein Ticket nach Hause</h1>
<p>Diesen QR-Code in einer DHL-Filiale, einem Paketshop oder an einer Packstation zeigen – DHL druckt das Etikett aus.</p>
${mark.qr_png_b64 ? `<div class="q"><img src="data:image/png;base64,${mark.qr_png_b64}" alt="QR-Code für DHL"></div>` : ""}
${nummer ? `<div class="n">${esc(nummer)}</div>` : ""}
${mark.label_pdf_b64 ? `<a class="k" href="etikett.pdf">Etikett als PDF</a>` : ""}
<div class="a">Geht zurück an<br><b>${esc(SELLER.brand.toUpperCase())} · ${esc(SELLER.name)}</b><br>${esc(SELLER.street)} · ${esc(SELLER.city)}</div>
</div></body></html>`;
}

export async function handleRuecksendungOeffentlich(request, env, url, now = Date.now()) {
  if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method Not Allowed", { status: 405, headers: SEITEN_KOPF });
  const m = /^\/ruecksendung\/([A-Za-z0-9_-]{40,64})(\/qr\.png|\/etikett\.pdf)?\/?$/.exec(url.pathname);
  const nichtDa = () => new Response("Dieser Link ist nicht (mehr) gültig.", { status: 404, headers: { ...SEITEN_KOPF, "Content-Type": "text/plain; charset=utf-8" } });
  if (!m || !env?.DB) return nichtDa();
  let mark = null;
  try { mark = await env.DB.prepare("SELECT * FROM ruecksende_marken WHERE zugang_hash=?").bind(await sha256Hex(m[1])).first(); } catch { mark = null; }
  if (!mark || mark.state !== "PAYED" || !mark.mail_gesendet_at) return nichtDa();
  if (now - Date.parse(mark.mail_gesendet_at) > ZUGANG_GUELTIG_MS) return nichtDa();
  const binaer = b64 => Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  if (m[2] === "/qr.png") {
    if (!mark.qr_png_b64) return nichtDa();
    return new Response(request.method === "HEAD" ? null : binaer(mark.qr_png_b64), { status: 200, headers: { ...SEITEN_KOPF, "Content-Type": "image/png" } });
  }
  if (m[2] === "/etikett.pdf") {
    if (!mark.label_pdf_b64) return nichtDa();
    return new Response(request.method === "HEAD" ? null : binaer(mark.label_pdf_b64), { status: 200, headers: {
      ...SEITEN_KOPF, "Content-Type": "application/pdf", "Content-Disposition": 'inline; filename="Ruecksendeetikett-DHL.pdf"' } });
  }
  return new Response(request.method === "HEAD" ? null : seiteHtml(mark), { status: 200, headers: {
    ...SEITEN_KOPF, "Content-Type": "text/html; charset=utf-8",
    "Content-Security-Policy": "default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" } });
}

// ------------------------------------------------------------ Admin

export function isRuecksendungAdmin(url) {
  return /^\/admin\/ruecksendung\/[^/]+(\/aktualisieren|\/mail|\/vorschau)?\/?$/.test(url.pathname);
}

export async function handleRuecksendungAdmin(request, env, url, reqId = crypto.randomUUID(), origin = null) {
  const json = (daten, status = 200) => new Response(JSON.stringify(daten), { status, headers: adminKopf(origin) });
  try {
    if (request.method === "OPTIONS") {
      if (!adminHerkunftErlaubt(origin)) return new Response(null, { status: 403, headers: adminKopf(null) });
      return new Response(null, { status: 204, headers: adminKopf(origin) });
    }
    if (!adminHerkunftErlaubt(origin)) throw new DhlQrError("ORIGIN_NOT_ALLOWED", 403);
    const supplied = String(request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
    if (!env.ADMIN_TOKEN || !(await adminTokenGleich(supplied, env.ADMIN_TOKEN))) throw new DhlQrError("UNAUTHORIZED", 401);
    const m = /^\/admin\/ruecksendung\/([^/]+)(\/aktualisieren|\/mail|\/vorschau)?\/?$/.exec(url.pathname);
    const orderId = decodeURIComponent(m[1]);
    const aktion = m[2] || "";
    const body = request.method === "POST" ? await request.json().catch(() => ({})) : {};

    if (aktion === "/vorschau" && request.method === "GET") {
      const order = await bestellungLesen(env, orderId);
      const anlass = ANLAESSE.includes(url.searchParams.get("anlass")) ? url.searchParams.get("anlass") : "WIDERRUF";
      const vorlage = VORLAGEN.includes(url.searchParams.get("vorlage")) ? url.searchParams.get("vorlage") : vorlageFuer(anlass, order.order_number);
      const texte = ruecksendeTexte({
        vorlage, anlass, kosten: url.searchParams.get("kosten") === "KUNDIN" ? "KUNDIN" : "SHOP", preisCents: Number(url.searchParams.get("preis") || 619),
        vorname: safeText(order.given_name || kundinName(order).split(" ")[0] || "", 40), bestellnummer: order.order_number,
        artikel: await artikelLesen(env, order.id), fristBis: anlass === "WIDERRUF" ? await widerrufFrist(env, order.id) : null,
      });
      // JSON wie alle Admin-Antworten; die App zeigt das HTML in einem eigenen Rahmen.
      return json({ ok: true, vorlage, betreff: texte.betreff, vorschau: texte.vorschau,
        html: ruecksendeMailHtml(texte, { links: {}, sendungsnummer: "" }) });
    }
    if (aktion === "" && request.method === "GET") {
      const order = await bestellungLesen(env, orderId);
      const vorschlag = absenderVorschlag(order);
      let produkte = [];
      try { produkte = dhlQrReady(env) ? await listProducts(env, "DE") : []; } catch { produkte = []; }
      return json({ ok: true, bestellnummer: order.order_number, status: order.status,
        rueckSendbar: RUECKSENDBAR.includes(String(order.status)) && vorschlag.land === "DE",
        // Empfaenger steht fest: immer der Shop (Joel, Aschaffenburg).
        empfaenger: empfaengerShop(env),
        vorschlag: { ...vorschlag, produkt: KLASSEN_PRODUKT[String(order.versand_paket || "S")] || "PAK02",
          vorlageWiderruf: vorlageFuer("WIDERRUF", order.order_number) },
        produkte, marken: await ruecksendungenDerBestellung(env, order.id) });
    }
    if (aktion === "" && request.method === "POST") {
      return json({ ok: true, marke: await ruecksendungAnlegen(env, orderId, body) });
    }
    const order = await bestellungLesen(env, orderId);
    const letzte = await db(env).prepare(`SELECT id FROM ruecksende_marken WHERE order_id=? AND state<>'ERSETZT' ORDER BY created_at DESC LIMIT 1`).bind(order.id).first();
    if (!letzte) throw new DhlQrError("KEIN_RUECKSENDEETIKETT", 404);
    if (aktion === "/aktualisieren" && request.method === "POST") {
      return json({ ok: true, marke: await ruecksendungAktualisieren(env, letzte.id) });
    }
    if (aktion === "/mail" && request.method === "POST") {
      const ergebnis = await ruecksendeMailSenden(env, letzte.id, { erneut: true });
      return json({ ok: true, ergebnis, marke: view(await markeLesen(env, letzte.id)) });
    }
    throw new DhlQrError("METHOD_NOT_ALLOWED", 405);
  } catch (err) {
    if (err instanceof DhlQrError) return json({ error: err.code, detail: err.detail || undefined, requestId: reqId }, err.status);
    console.error(JSON.stringify({ level: "error", event: "ruecksendung_error", requestId: reqId, message: safeText(err?.message || "unknown", 180) }));
    return json({ error: "INTERNAL_RUECKSENDUNG_ERROR", requestId: reqId }, 500);
  }
}

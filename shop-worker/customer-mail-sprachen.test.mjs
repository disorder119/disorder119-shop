import assert from "node:assert/strict";
import test from "node:test";
import shopWorker from "./worker.js";
import {
  formatOrderConfirmation,
  formatShippingConfirmation,
  formatRefundConfirmation,
  formatReturnInstructions,
  formatWithdrawalReceipt,
  formatInvoiceMail,
  sendOrderConfirmation,
  sendShippingConfirmation,
  mailSprache,
  mailDatum,
  berlinZeit,
} from "./customer-mail.js";
import { oeffentlichenKatalogLeeren } from "./oeffentlicher-katalog.js";
import { versandCacheLeeren } from "./versand.js";
import { allMigrations, sqliteD1 } from "./test-d1.mjs";

// ---------------------------------------------------------------------------
// Reine Formatierung: EN und FR
// ---------------------------------------------------------------------------

const ORDER = {
  order_number: "D119-20261028-ABCDEF12",
  currency: "EUR",
  subtotal_cents: 24000,
  shipping_cents: 0,
  total_cents: 24000,
  created_at: "2026-10-28T08:15:00.000Z",
  items: [
    { item_id: 6241, article_no: "238", title_snapshot: "Jean Paul Gaultier Marmorierte Jeans Damen Blau", title_en: "Jean Paul Gaultier Marbled Jeans Women Blue", unit_price_cents: 24000, bild: "assets/img/x/1.webp" },
  ],
  contact: { recipient_name: "Marie Martin", address_line1: "1 Rue de Rivoli", postal_code: "75001", city: "Paris", country_code: "FR" },
};

test("mailSprache keeps only de/en/fr, everything else is German", () => {
  assert.equal(mailSprache("en"), "en");
  assert.equal(mailSprache("FR"), "fr");
  assert.equal(mailSprache("es"), "de");
  assert.equal(mailSprache(undefined), "de");
  assert.equal(mailSprache("en-GB"), "en");
});

test("order confirmation in English: subject, language tag, English title, binding German terms appended", () => {
  const mail = formatOrderConfirmation(ORDER, { sprache: "en", zahlung: "RESERVIERT", contactEmail: "kontakt@disorder119.com" });
  assert.equal(mail.sprache, "en");
  assert.match(mail.subject, /Your order D119-20261028-ABCDEF12 at DISORDER119/);
  assert.match(mail.html, /<html lang="en"/);
  // English piece title from title_en, English UI words.
  assert.match(mail.html, /Jean Paul Gaultier Marbled Jeans Women Blue/);
  assert.match(mail.html, /Order confirmation/);
  assert.match(mail.html, /What happens next/);
  assert.match(mail.html, /Item no\. 238/);
  // Country written out in English.
  assert.match(mail.text, /\bFrance\b/);
  // EN contract plus the legally binding German version.
  assert.match(mail.html, /Terms &amp; conditions/);
  assert.match(mail.html, /Right of withdrawal/);
  assert.match(mail.html, /Legally binding German version/);
  assert.match(mail.html, /Allgemeine Geschäftsbedingungen/);
  assert.match(mail.html, /Widerrufsbelehrung/);
  // Account link in the English path.
  assert.match(mail.html, /disorder119\.com\/en\/konto\//);
  assert.doesNotMatch(mail.html, /\{email\}/);
});

test("order confirmation in French: subject, language tag, binding German terms appended", () => {
  const mail = formatOrderConfirmation(ORDER, { sprache: "fr", zahlung: "RESERVIERT", contactEmail: "kontakt@disorder119.com" });
  assert.equal(mail.sprache, "fr");
  assert.match(mail.subject, /Ta commande D119-20261028-ABCDEF12 chez DISORDER119/);
  assert.match(mail.html, /<html lang="fr"/);
  assert.match(mail.html, /Confirmation de commande/);
  assert.match(mail.text, /\bFrance\b/);
  assert.match(mail.html, /Conditions générales de vente/);
  assert.match(mail.html, /Droit de rétractation/);
  assert.match(mail.html, /Version allemande faisant foi/);
  assert.match(mail.html, /Allgemeine Geschäftsbedingungen/);
  assert.doesNotMatch(mail.html, /\{email\}/);
});

test("German order confirmation stays exactly as before: no binding-note, no foreign strings", () => {
  const mail = formatOrderConfirmation(ORDER, { sprache: "de", zahlung: "RESERVIERT", contactEmail: "kontakt@disorder119.com" });
  assert.equal(mail.sprache, "de");
  assert.match(mail.html, /<html lang="de"/);
  assert.match(mail.subject, /Deine Bestellung .* bei DISORDER119/);
  assert.doesNotMatch(mail.html, /Legally binding German version/);
  assert.doesNotMatch(mail.html, /Terms &amp; conditions/);
  // German order uses the German piece title, not title_en.
  assert.match(mail.html, /Marmorierte Jeans/);
});

test("shipping confirmation in EN/FR: subject, tracking link locale, withdrawal link in the language path", () => {
  const order = { order_number: "D119-1", carrier: "DHL", tracking_number: "00340434161234567890",
    items: [{ item_id: 6241, title_snapshot: "X", title_en: "Marbled Jeans", bild: "" }] };
  const en = formatShippingConfirmation(order, { sprache: "en", contactEmail: "kontakt@disorder119.com" });
  assert.match(en.subject, /Your order D119-1 is on its way/);
  assert.match(en.html, /<html lang="en"/);
  assert.match(en.html, /\/en\/widerruf\/\?bestellung=D119-1/);
  assert.match(en.html, /dhl\.de\/en\/privatkunden/);
  assert.match(en.html, /Marbled Jeans/);
  const fr = formatShippingConfirmation(order, { sprache: "fr" });
  assert.match(fr.subject, /Ta commande D119-1 est en route/);
  assert.match(fr.html, /\/fr\/widerruf\/\?bestellung=D119-1/);
  // dhl.de has no French tracking page, so the English one is used for FR too.
  assert.match(fr.html, /dhl\.de\/en\/privatkunden/);
});

test("refund confirmation (cancellation, nothing charged) in EN and FR", () => {
  const auftrag = { betrag_cents: 24000, anlass: "STORNO", ergebnis: "FREIGEGEBEN", vor_versand: 1,
    artikel_json: JSON.stringify([{ itemId: 6241, titel: "Jeans", artikelNr: "238", preisCents: 24000 }]) };
  const en = formatRefundConfirmation({ order_number: "D119-1" }, auftrag, { sprache: "en", titelEn: new Map([[6241, "Marbled Jeans"]]) });
  assert.match(en.subject, /cancelled – nothing charged/);
  assert.match(en.html, /<html lang="en"/);
  assert.match(en.html, /Not charged/);
  assert.match(en.html, /Marbled Jeans/);
  const fr = formatRefundConfirmation({ order_number: "D119-1" }, auftrag, { sprache: "fr" });
  assert.match(fr.subject, /annulée – rien n’a été débité/);
  assert.match(fr.html, /Non débité/);
});

test("refund confirmation (return received, refunded) in EN", () => {
  const auftrag = { betrag_cents: 9000, anlass: "RUECKSENDUNG",
    artikel_json: JSON.stringify([{ itemId: 9427, titel: "Jeans", artikelNr: "238", preisCents: 9000 }]) };
  const en = formatRefundConfirmation({ order_number: "D119-2", currency: "EUR" }, auftrag, { sprache: "en" });
  assert.match(en.subject, /Your return has arrived – .* refunded/);
  assert.match(en.html, /refunded .* via PayPal|via PayPal/);
});

test("return instructions and withdrawal receipt in EN/FR carry the statutory wording", () => {
  const order = { order_number: "D119-1", items: [{ title_snapshot: "Jacke", title_en: "Jacket" }] };
  const en = formatReturnInstructions(order, { sprache: "en", widerrufAm: "2026-10-28T10:00:00Z" });
  assert.match(en.subject, /How to return your order D119-1/);
  assert.match(en.html, /<html lang="en"/);
  assert.match(en.text, /return address/i);
  assert.match(en.html, /bear the direct cost of returning/);
  const widerruf = { id: "abcd1234-0000-0000-0000-000000000000", bestellnummer_eingabe: "D119-1", name: "Marie", email: "m@example.com",
    umfang: "GANZ", eingegangen_at: "2026-10-28T10:00:00Z", sprache: "fr" };
  const fr = formatWithdrawalReceipt(widerruf, { lage: "NICHT_VERSENDET" });
  assert.equal(fr.sprache, "fr");
  assert.match(fr.subject, /Accusé de réception/);
  assert.match(fr.html, /<html lang="fr"/);
  assert.match(fr.html, /Ta déclaration de rétractation nous est parvenue/);
});

test("invoice mail is wrapped in the order language and says the invoice itself is German", () => {
  const invoice = { number: "D119-1", text: "RECHNUNG ...", fragment: "<p>Rechnung</p>" };
  const en = formatInvoiceMail({ order_number: "D119-1", total_cents: 24000, currency: "EUR" }, invoice, { sprache: "en" });
  assert.match(en.subject, /Your invoice for order D119-1/);
  assert.match(en.html, /The invoice is issued in German/);
  const fr = formatInvoiceMail({ order_number: "D119-1", total_cents: 24000, currency: "EUR" }, invoice, { sprache: "fr" });
  assert.match(fr.subject, /Ta facture pour la commande D119-1/);
  assert.match(fr.html, /La facture est établie en allemand/);
});

test("localized date and Berlin time", () => {
  assert.equal(mailDatum("2026-10-28T08:15:00.000Z", "de"), "28.10.2026");
  assert.match(mailDatum("2026-10-28T08:15:00.000Z", "en"), /28 October 2026/);
  assert.match(mailDatum("2026-10-28T08:15:00.000Z", "fr"), /28 octobre 2026/);
  assert.match(berlinZeit("2026-10-28T10:00:00Z", "en"), /28 October 2026/);
});

// ---------------------------------------------------------------------------
// Kaeufer-Simulation gegen worker.js: eine EN- und eine FR-Bestellung
// ---------------------------------------------------------------------------

const ITEMS = [
  { id: 9428, article: "238", brand: "Jean Paul Gaultier", title: "Jean Paul Gaultier T-Shirt mit Print Damen Blau", title_en: "Jean Paul Gaultier Printed T-Shirt Women Blue", price: 150, public_status: "AVAILABLE", taxonomy_category: "Tops", product_type: "T-Shirt", gallery: ["assets/img/a/1.webp"] },
];

function fakeNetz(brevoSink) {
  const calls = [];
  let betrag = "150.00";
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    const body = typeof init.body === "string" && init.body.startsWith("{") ? JSON.parse(init.body) : null;
    calls.push({ host: u.host, path: u.pathname, method: init.method || "GET", body });
    if (u.host === "api.brevo.com") { brevoSink.push(body); return Response.json({ messageId: "m" }, { status: 201 }); }
    if (u.host === "raw.githubusercontent.com") return new Response(JSON.stringify(ITEMS));
    if (u.host === "api.github.com") {
      if (u.pathname.endsWith("/contents/data")) return Response.json([{ name: "items.json", type: "file", sha: "a".repeat(40) }]);
      if (u.pathname.endsWith(`/git/blobs/${"a".repeat(40)}`)) return new Response(JSON.stringify(ITEMS));
    }
    if (u.host === "api-m.sandbox.paypal.com") {
      if (u.pathname === "/v1/oauth2/token") return Response.json({ access_token: "t" });
      if (u.pathname === "/v2/checkout/orders") {
        // Betrag der Bestellung merken und spaeter spiegeln (DE frei, FR +14,49).
        betrag = body?.purchase_units?.[0]?.amount?.value || betrag;
        return Response.json({ id: "PP-1", status: "CREATED" }, { status: 201 });
      }
      if (u.pathname === "/v2/checkout/orders/PP-1" && !u.pathname.endsWith("/capture")) return Response.json({ payer: {}, purchase_units: [{ shipping: {} }] });
      if (u.pathname === "/v2/checkout/orders/PP-1/authorize") {
        return Response.json({ id: "PP-1", status: "COMPLETED", purchase_units: [{ custom_id: "9428", payments: { authorizations: [{
          id: "AUTH-1", status: "CREATED", amount: { currency_code: "EUR", value: betrag },
          create_time: "2026-10-28T10:00:00Z", expiration_time: "2026-11-26T10:00:00Z" }] } }] }, { status: 201 });
      }
    }
    return new Response("{}", { status: 404 });
  };
  return { calls, restore() { globalThis.fetch = original; } };
}

async function post(env, path, body, key) {
  const req = new Request(`https://api.disorder119.com${path}`, {
    method: "POST",
    headers: { Origin: "https://disorder119.com", "Content-Type": "application/json", "Idempotency-Key": key },
    body: JSON.stringify(body),
  });
  const res = await shopWorker.fetch(req, env);
  return { status: res.status, data: await res.json() };
}

async function kaufUndBestaetigung(sprache, adresse) {
  versandCacheLeeren();
  oeffentlichenKatalogLeeren();
  const brevo = [];
  const netz = fakeNetz(brevo);
  const DB = sqliteD1(allMigrations());
  const env = { VERSAND_QUELLE: "fest", DB, GITHUB_TOKEN: "gh", PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: "s",
    MAIL_API_KEY: "test-key", MAIL_FROM: "kontakt@disorder119.com" };
  try {
    // DE: Standard ab 99 EUR frei (150 EUR Warenwert); FR: DHL Paket EU 14,49.
    const inland = String(adresse.land || "DE").toUpperCase() === "DE";
    const created = await post(env, "/create-order",
      { itemIds: [9428], adresse, email: "kundin@example.com",
        versand: inland ? "fest-dhl-S" : "fest-dhl-eu-S", versandPreisCents: inland ? 0 : 1449, sprache },
      `k-${sprache}-000000000001`);
    assert.equal(created.status, 200, JSON.stringify(created.data));
    // Sprache steht an der Bestellung.
    assert.equal(DB.raw.prepare("SELECT sprache FROM commerce_orders").get().sprache, sprache);
    const paid = await post({ ...env, GITHUB_TOKEN: "" }, "/capture-order", { orderId: "PP-1" }, `k-${sprache}-zahlung-0001`);
    assert.equal(paid.status, 200, JSON.stringify(paid.data));
    // Bestaetigungsmail in der gespeicherten Sprache.
    const result = await sendOrderConfirmation(env, created.data.orderId, `req-${sprache}`);
    assert.equal(result.sent, true, JSON.stringify(result));
    const mail = brevo.find(m => Array.isArray(m?.tags) && m.tags.includes("order-confirmation"));
    assert.ok(mail, "keine Bestellbestaetigung verschickt");
    return { env, DB, brevo, orderId: created.data.orderId, mail };
  } finally {
    netz.restore();
  }
}

test("buyer simulation EN: checkout stores en, confirmation mail is English with English title", async () => {
  const { mail } = await kaufUndBestaetigung("en", { name: "Mary Smith", strasse: "Oxford Street", hausnummer: "10", plz: "63739", ort: "Aschaffenburg", land: "DE" });
  assert.match(mail.subject, /Your order .* at DISORDER119/);
  assert.match(mail.htmlContent, /<html lang="en"/);
  assert.match(mail.htmlContent, /Order confirmation/);
  assert.match(mail.htmlContent, /Jean Paul Gaultier Printed T-Shirt Women Blue/);
  assert.match(mail.htmlContent, /Legally binding German version/);
  assert.match(mail.htmlContent, /Allgemeine Geschäftsbedingungen/);
});

test("buyer simulation FR: checkout to France stores fr, confirmation mail is French", async () => {
  const { env, DB, brevo, orderId, mail } = await kaufUndBestaetigung("fr",
    { name: "Marie Martin", strasse: "Rue de Rivoli", hausnummer: "1", plz: "75001", ort: "Paris", land: "FR" });
  assert.match(mail.subject, /Ta commande .* chez DISORDER119/);
  assert.match(mail.htmlContent, /<html lang="fr"/);
  assert.match(mail.htmlContent, /Confirmation de commande/);
  assert.match(mail.htmlContent, /\bFrance\b/);
  assert.match(mail.htmlContent, /Version allemande faisant foi/);

  // Admin-ausgeloeste Versandmail nimmt dieselbe gespeicherte Sprache.
  const netz = fakeNetz(brevo);
  try {
    // PAID → PREPARING → SHIPPED (der Trigger erlaubt keinen Sprung).
    DB.raw.prepare("UPDATE commerce_orders SET status='PREPARING' WHERE id=?").run(orderId);
    DB.raw.prepare("UPDATE commerce_orders SET status='SHIPPED' WHERE id=?").run(orderId);
    DB.raw.prepare("INSERT INTO shipments (id,order_id,carrier,tracking_number,status,created_at) VALUES (?,?,?,?,?,?)")
      .run("s1", orderId, "DHL", "00340434161234567890", "SHIPPED", new Date().toISOString());
    const shipped = await sendShippingConfirmation(env, orderId, "req-fr-ship");
    assert.equal(shipped.sent, true, JSON.stringify(shipped));
    const versand = brevo.find(m => Array.isArray(m?.tags) && m.tags.includes("shipping-confirmation"));
    assert.ok(versand, "keine Versandmail");
    assert.match(versand.subject, /Ta commande .* est en route/);
    assert.match(versand.htmlContent, /<html lang="fr"/);
    assert.match(versand.htmlContent, /\/fr\/widerruf\//);
  } finally {
    netz.restore();
  }
});

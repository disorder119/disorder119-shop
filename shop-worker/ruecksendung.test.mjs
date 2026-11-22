import assert from "node:assert/strict";
import test from "node:test";
import { allMigrations, sqliteD1 } from "./test-d1.mjs";
import {
  absenderAus, handleRuecksendungAdmin, handleRuecksendungOeffentlich, ruecksendeMailSenden,
  ruecksendungAktualisieren, ruecksendungAnlegen, ruecksendungenAbgleichen,
} from "./ruecksendung.js";
import { artikelBezeichnung, grammatik, ruecksendeMailHtml, ruecksendeTexte, vorlageFuer } from "./ruecksendung-texte.js";
import { warenkorbZuordnen } from "./dhl-qr.js";
import { VORGANG_QUERIES } from "./tax-ready-vorgaenge.js";
import { oeffentlichenKatalogLeeren } from "./oeffentlicher-katalog.js";

// Ruecksendeetikett: Kundin als Absender, IMMER an Joel nach Aschaffenburg,
// Joel zahlt auf dhl.de, danach QR + PDF und Mail (Vorlagen A-D).

const TOKEN = "admin-test-token";
const CART_ID = "RUECK1234567";
const TRACKING = "00340434161234567890";
const PNG = new Uint8Array(160).fill(7);
const PDF = new TextEncoder().encode("%PDF-1.4 " + "x".repeat(400));
const KATALOG = [
  { id: 9641, title: "Y-3 Laufjacke mit Kapuze Herren Schwarz", brand: "Y-3", category: "Jackets", size: "M", article: "9641", gallery: ["assets/img/9641/0.webp"] },
  { id: 9639, title: "Prada Sport Low-Top-Sneaker Herren Schwarz", brand: "Prada", category: "Shoes", size: "EU 41", gallery: ["assets/img/9639/0.webp"] },
];
const KATALOG_OPTIONEN = { fetcher: async () => Response.json(KATALOG) };

function seed({ status = "DELIVERED", adresse = "Musterstraße 12a", itemId = 9641, land = "DE" } = {}) {
  const DB = sqliteD1(allMigrations());
  const now = "2026-11-05T10:00:00.000Z";
  const run = (sql, ...args) => DB.raw.prepare(sql).run(...args);
  run(`INSERT INTO inventory (id,item_id,article_no,status,sale_price_cents,currency,catalog_status,version,updated_at)
    VALUES ('inv_1',?,'9641','PAID',8500,'EUR','SOLD',1,?)`, itemId, now);
  run(`INSERT INTO commerce_orders (id,order_number,status,currency,subtotal_cents,shipping_cents,total_cents,idempotency_key,created_at)
    VALUES ('o1','D119-20261105-7F3A',?,'EUR',8500,769,9269,'k1',?)`, status, now);
  run(`INSERT INTO order_items (id,order_id,inventory_id,item_id,article_no,title_snapshot,unit_price_cents)
    VALUES ('oi1','o1','inv_1',?,'9641','Y-3 Laufjacke',8500)`, itemId);
  run(`INSERT INTO order_contact_snapshots (order_id,source_provider,email,given_name,recipient_name,address_line1,address_line2,postal_code,city,country_code,captured_at)
    VALUES ('o1','PAYPAL','kundin@example.com','Alex','Alex Beispiel',?,'Postnummer 12345678','63739','Aschaffenburg',?,?)`, adresse, land, now);
  run(`INSERT INTO order_versand (order_id,option_id,art,quelle,packlink_service_id,carrier,service_name,paket,preis_cents,laufzeit,created_at)
    VALUES ('o1','fest-dhl-M','standard','ersatz',NULL,'DHL','DHL Paket','M',769,'2 Tage',?)`, now);
  return DB;
}

function fakeNetz({ ohneKennung = false, bezahltNach = 0 } = {}) {
  const calls = [];
  const mails = [];
  let cartReads = 0;
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    if (u.hostname.includes("brevo")) {
      mails.push(JSON.parse(init.body));
      return Response.json({ messageId: "m1" }, { status: 201 });
    }
    const path = u.pathname.replace("/parcel/de/shipping/of/v1/public", "");
    calls.push({ path, method: init.method || "GET", body: init.body ? JSON.parse(init.body) : null });
    if (path === "/catalog/current/products") {
      return Response.json({ products: {
        PAK05: { attributes: { displayName: { text: "Paket bis 5 kg" }, maxWeight: 5000, tracking: true }, regions: [{ countries: ["DEU"], price: { amount: 7.69 } }] },
        PAK02: { attributes: { displayName: { text: "Paket bis 2 kg" }, maxWeight: 2000, tracking: true }, regions: [{ countries: ["DEU"], price: { amount: 6.19 } }] },
      } });
    }
    if (path === "/shopping-carts/pre-paid" && init.method === "POST") {
      return Response.json({ shoppingcart: { ...(ohneKennung ? {} : { shoppingCartId: CART_ID }), state: "PREPAID",
        download: { entryUrl: "https://www.dhl.de/send-parcel/gw/rest/init?token=RUECK" }, items: [{ prices: [{ amount: "7.69" }] }] } }, { status: 201 });
    }
    if (path === `/shopping-carts/${CART_ID}`) {
      cartReads += 1;
      const paid = cartReads > bezahltNach;
      return Response.json({ shoppingcart: { shoppingCartId: CART_ID, state: paid ? "PAYED" : "INPAYMENT",
        items: paid ? [{ shipmentNumber: TRACKING, pakId: "123456789" }] : [{}] } });
    }
    if (path === "/labels/123456789/qr-code") return new Response(PNG, { status: 200, headers: { "Content-Type": "image/png" } });
    if (path === "/labels/123456789") return new Response(PDF, { status: 200, headers: { "Content-Type": "application/pdf" } });
    return new Response("unbekannt", { status: 404 });
  };
  return { calls, mails, restore() { globalThis.fetch = original; } };
}

function env(DB, extra = {}) {
  return { DB, ADMIN_TOKEN: TOKEN, DHL_PRIVAT_API_KEY: "dhl-test-key", MAIL_API_KEY: "brevo-test", MAIL_FROM: "kontakt@disorder119.com",
    MAIL_FROM_NAME: "DISORDER119", DHL_SHIPPER_STREET: "Nelseestraße 25", DHL_SHIPPER_POSTAL: "63739", DHL_SHIPPER_CITY: "Aschaffenburg",
    DHL_SHIPPER_NAME: "Joel Bittner - Disorder119", ...extra };
}

test("Grammatik und Texte passen sich dem Artikel an, Vorlagen wechseln stabil", () => {
  assert.deepEqual(artikelBezeichnung({ title: "Y-3 Laufjacke", category: "Jackets" }), { nomen: "Jacke", genus: "f" });
  assert.deepEqual(artikelBezeichnung({ title: "Prada Sport Low-Top-Sneaker", category: "Shoes" }), { nomen: "Sneaker", genus: "pl" });
  assert.deepEqual(artikelBezeichnung({ title: "Helmut Lang Logo-Hoodie", category: "Knitwear" }), { nomen: "Hoodie", genus: "m" });
  assert.deepEqual(artikelBezeichnung({ title: "Jil Sander Mantel", category: "Coats" }), { nomen: "Mantel", genus: "m" });
  assert.equal(grammatik({ genus: "pl" }).dein, "deine");
  assert.equal(grammatik({ genus: "m" }).ihn, "ihn");

  const a = ruecksendeTexte({ vorlage: "A", anlass: "WIDERRUF", vorname: "Alex", bestellnummer: "D119-1", artikel: [KATALOG[0]] });
  assert.equal(a.betreff, "Deine Y-3 Jacke packt die Koffer");
  assert.match(a.absaetze[1].html, /hier spricht deine Y-3 Jacke/);
  assert.match(a.absaetze[1].html, /Regenschauer/, "Satz fuer Jacken");
  const b = ruecksendeTexte({ vorlage: "B", anlass: "WIDERRUF", artikel: [KATALOG[1]] });
  assert.equal(b.betreff, "In stiller Trauer: Deine Prada Sneaker kehren heim");
  assert.match(b.trauer.gross, /verlassen\.$/, "Mehrzahl: verlassen");
  const d = ruecksendeTexte({ vorlage: "D", anlass: "REKLAMATION", vorname: "Alex", artikel: [{ title: "Helmut Lang Logo-Hoodie", brand: "Helmut Lang", category: "Knitwear" }] });
  assert.equal(d.kostenText, "übernehmen wir");
  assert.match(d.absaetze[2].html, /Schick ihn einfach zurück/);
  const kundin = ruecksendeTexte({ vorlage: "C", anlass: "WIDERRUF", kosten: "KUNDIN", preisCents: 769, artikel: [KATALOG[0]] });
  assert.match(kundin.kostenText, /7,69 €, ziehen wir von der Erstattung ab/);
  assert.match(kundin.schritte.at(-1), /Kosten für das Etikett ziehen wir davon ab/);

  // Widerruf: A, B, C im Wechsel - dieselbe Bestellung immer gleich. Reklamation: D.
  const vorlagen = new Set(Array.from({ length: 30 }, (_, i) => vorlageFuer("WIDERRUF", `D119-2026-${i}`)));
  assert.deepEqual([...vorlagen].sort(), ["A", "B", "C"]);
  assert.equal(vorlageFuer("WIDERRUF", "D119-X"), vorlageFuer("WIDERRUF", "D119-X"));
  assert.equal(vorlageFuer("REKLAMATION", "D119-X"), "D");

  // Mail: Produktfoto, Ticket mit Joels Adresse, keine Platzhalter uebrig.
  const html = ruecksendeMailHtml(a, { links: { qr: "https://api.disorder119.com/ruecksendung/abc/qr.png", seite: "https://api.disorder119.com/ruecksendung/abc" }, sendungsnummer: TRACKING });
  assert.match(html, /https:\/\/disorder119\.com\/assets\/img\/9641\/0\.webp/);
  assert.match(html, /Geht zurück an/);
  assert.match(html, /Nelseestraße 25 · 63739 Aschaffenburg/);
  assert.match(html, /0034 0434 1612 3456 7890/);
  assert.doesNotMatch(html, /undefined|\$\{|null/);
});

test("Absender: Wohnadresse der Kundin in DE, keine Packstation, Empfaenger immer der Shop", () => {
  const order = { recipient_name: "Alex Beispiel", address_line1: "Packstation 123", postal_code: "63739", city: "Aschaffenburg", country_code: "DE" };
  assert.throws(() => absenderAus({}, order), e => e.code === "ABSENDER_UNVOLLSTAENDIG", "Packstation-Bestellung: Wohnadresse fehlt");
  assert.throws(() => absenderAus({ street: "Packstation", streetNumber: "123", plz: "63739", city: "Aschaffenburg" }, order), e => e.code === "ABSENDER_ABHOLORT");
  assert.deepEqual(absenderAus({ street: "Musterweg", streetNumber: "3", plz: "63739", city: "Aschaffenburg" }, order),
    { name2: "Alex Beispiel", street: "Musterweg", streetNumber: "3", plz: "63739", city: "Aschaffenburg", country: "DEU" });
  assert.throws(() => absenderAus({}, { ...order, address_line1: "Rue X 1", country_code: "FR" }), e => e.code === "RUECKSENDUNG_NUR_DE");
});

test("Ablauf: anlegen -> bezahlt -> QR und PDF -> Mail mit Link; Link zeigt QR, PDF und Seite", async () => {
  oeffentlichenKatalogLeeren();
  const DB = seed();
  const netz = fakeNetz();
  const e = env(DB);
  try {
    const marke = await ruecksendungAnlegen(e, "o1", { anlass: "WIDERRUF", kosten: "SHOP" }, "2026-11-05T10:00:00.000Z");
    assert.equal(marke.state, "PREPAID");
    assert.equal(marke.produkt, "PAK05", "Paketklasse der Bestellung (M)");
    assert.equal(marke.preisCents, 769);
    assert.match(marke.bezahlLink, /^https:\/\/www\.dhl\.de\//);
    const kauf = netz.calls.find(c => c.path === "/shopping-carts/pre-paid");
    const adresse = kauf.body.shoppingcart.items[0].address;
    assert.deepEqual(adresse.receiver, { name2: "Joel Bittner - Disorder119", street: "Nelseestraße", streetNumber: "25", plz: "63739", city: "Aschaffenburg", country: "DEU" },
      "Empfaenger ist immer Joels Adresse");
    assert.equal(adresse.sender.street, "Musterstraße");
    assert.equal(adresse.sender.streetNumber, "12a");
    assert.equal(kauf.body.shoppingcart.confirmation.email, "kontakt@disorder119.com");

    // Bezahlt: Sendungsnummer, QR, PDF, Mail - alles in einem Schritt.
    const stand = await ruecksendungAktualisieren(e, marke.id, "2026-11-05T10:20:00.000Z", { katalogOptionen: KATALOG_OPTIONEN });
    assert.equal(stand.state, "PAYED");
    assert.equal(stand.sendungsnummer, TRACKING);
    assert.equal(stand.qr, true);
    assert.equal(stand.pdf, true);
    assert.equal(stand.mailAn, "kundin@example.com");
    assert.ok(stand.mailGesendetAm);
    assert.equal(netz.mails.length, 1);
    const mail = netz.mails[0];
    assert.equal(mail.to[0].email, "kundin@example.com");
    assert.ok(["Deine Y-3 Jacke packt die Koffer", "In stiller Trauer: Deine Y-3 Jacke kehrt heim", "Es liegt nicht an dir. Es liegt an der Passform."].includes(mail.subject));
    assert.equal(mail.attachment[0].name, "Ruecksendeetikett-DHL.pdf");
    assert.match(mail.htmlContent, /Nelseestraße 25 · 63739 Aschaffenburg/);
    const link = /https:\/\/api\.disorder119\.com\/ruecksendung\/([A-Za-z0-9_-]{40,64})\/qr\.png/.exec(mail.htmlContent);
    assert.ok(link, "QR-Code als Bild aus dem Shop-Server");

    // Oeffentlicher Link: QR (PNG), PDF und Seite - ohne Daten der Kundin.
    const hol = async pfad => handleRuecksendungOeffentlich(new Request(`https://api.disorder119.com${pfad}`), e, new URL(`https://api.disorder119.com${pfad}`), Date.parse("2026-11-06T10:00:00Z"));
    const qr = await hol(`/ruecksendung/${link[1]}/qr.png`);
    assert.equal(qr.status, 200);
    assert.equal(qr.headers.get("Content-Type"), "image/png");
    assert.equal((await qr.arrayBuffer()).byteLength, PNG.byteLength);
    const pdf = await hol(`/ruecksendung/${link[1]}/etikett.pdf`);
    assert.equal(pdf.headers.get("Content-Type"), "application/pdf");
    const seite = await (await hol(`/ruecksendung/${link[1]}`)).text();
    assert.match(seite, /Dein Ticket nach Hause/);
    assert.doesNotMatch(seite, /Musterstraße|kundin@example\.com|Alex/, "keine Daten der Kundin auf der Seite");
    assert.equal((await hol(`/ruecksendung/${"x".repeat(43)}`)).status, 404);
    const spaet = await handleRuecksendungOeffentlich(new Request("https://api.disorder119.com/x"), e, new URL(`https://api.disorder119.com/ruecksendung/${link[1]}`), Date.parse("2027-06-01T00:00:00Z"));
    assert.equal(spaet.status, 404, "Link verfaellt nach 180 Tagen");

    // Kein zweites Mal von selbst; "erneut senden" gibt einen neuen Link.
    await ruecksendungAktualisieren(e, marke.id, "2026-11-05T11:00:00.000Z", { katalogOptionen: KATALOG_OPTIONEN });
    assert.equal(netz.mails.length, 1);
    await ruecksendeMailSenden(e, marke.id, { erneut: true, now: "2026-11-05T12:00:00.000Z", katalogOptionen: KATALOG_OPTIONEN });
    assert.equal(netz.mails.length, 2);
    assert.equal((await hol(`/ruecksendung/${link[1]}/qr.png`)).status, 404, "alter Link verfaellt beim erneuten Senden");

    // Buchhaltung: Ruecksendeetikett zaehlt als Etikettenaufwand der Bestellung.
    const labels = DB.raw.prepare(VORGANG_QUERIES.dhl_labels).all();
    assert.equal(labels.filter(l => l.order_id === "o1" && l.state === "PAYED").length, 1);
    assert.equal(labels[0].price_cents, 769);
  } finally {
    netz.restore();
  }
});

test("Ohne Warenkorb-Nummer: DHL-Mail ordnet das Ruecksendeetikett zu, dann geht es automatisch weiter", async () => {
  oeffentlichenKatalogLeeren();
  const DB = seed();
  const netz = fakeNetz({ ohneKennung: true });
  const e = env(DB);
  try {
    const marke = await ruecksendungAnlegen(e, "o1", { anlass: "REKLAMATION", kosten: "KUNDIN" }, new Date().toISOString());
    assert.equal(marke.ohneAbgleich, true);
    assert.equal(marke.vorlage, "D");
    assert.equal(marke.kosten, "SHOP", "Reklamation: Kosten traegt immer der Shop");
    // Cron: ohne Nummer nichts zu fragen.
    assert.equal((await ruecksendungenAbgleichen(e, Date.now())).geprueft, 0);
    const z = await warenkorbZuordnen(e, { vonEmail: "noreply@dhl.de", betreff: `Auftragsbestätigung Ihrer Online Frankierung ${CART_ID}`, text: `Warenkorb-Nr.: ${CART_ID} / 7,69 €` });
    assert.equal(z.zugeordnet, true);
    assert.equal(z.art, "ruecksendung");
    assert.equal(z.state, "PAYED");
    assert.equal(netz.mails.length, 1);
    assert.equal(netz.mails[0].subject, "Das geht auf uns – dein Rücksendeetikett");
  } finally {
    netz.restore();
  }
});

test("Admin: Vorschlag, Anlegen, Vorschau; nur nach dem Versand und nur mit Admin-Schluessel", async () => {
  oeffentlichenKatalogLeeren();
  const DB = seed({ adresse: "Packstation 123" });
  const netz = fakeNetz();
  const e = env(DB);
  const rufe = async (pfad, { method = "GET", body, bearer = TOKEN } = {}) => {
    const req = new Request(`https://api.disorder119.com${pfad}`, { method, headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const res = await handleRuecksendungAdmin(req, e, new URL(req.url), "req", "https://admin.disorder119.com");
    return { status: res.status, text: await res.text() };
  };
  try {
    assert.equal((await rufe("/admin/ruecksendung/o1", { bearer: "falsch" })).status, 401);
    const stand = JSON.parse((await rufe("/admin/ruecksendung/o1")).text);
    assert.equal(stand.rueckSendbar, true);
    assert.equal(stand.vorschlag.abholortBestellung, true, "Packstation-Bestellung: Wohnadresse eintragen");
    assert.equal(stand.vorschlag.street, "");
    assert.equal(stand.vorschlag.produkt, "PAK05");
    const ohne = JSON.parse((await rufe("/admin/ruecksendung/o1", { method: "POST", body: { anlass: "WIDERRUF" } })).text);
    assert.equal(ohne.error, "ABSENDER_UNVOLLSTAENDIG");
    const neu = JSON.parse((await rufe("/admin/ruecksendung/o1", { method: "POST", body: { anlass: "WIDERRUF", vorlage: "B",
      absender: { street: "Musterweg", streetNumber: "3", plz: "63739", city: "Aschaffenburg" } } })).text);
    assert.equal(neu.marke.vorlage, "B");
    assert.equal(stand.empfaenger.street, "Nelseestraße", "Empfaenger steht fest");
    const vorschau = await rufe("/admin/ruecksendung/o1/vorschau?vorlage=C&anlass=WIDERRUF");
    assert.equal(vorschau.status, 200);
    const v = JSON.parse(vorschau.text);
    assert.equal(v.vorlage, "C");
    assert.equal(v.betreff, "Es liegt nicht an dir. Es liegt an der Passform.");
    assert.match(v.html, /Es liegt nicht an dir/);
  } finally {
    netz.restore();
  }
  const offen = seed({ status: "PAID" });
  await assert.rejects(ruecksendungAnlegen(env(offen), "o1", {}), e2 => e2.code === "BESTELLUNG_NICHT_RUECKSENDBAR");
});

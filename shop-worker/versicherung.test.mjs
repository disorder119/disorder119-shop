import assert from "node:assert/strict";
import test from "node:test";
import { buildShipmentRequest } from "./dhl.js";
import { produktVersichertCents, versicherungPruefen } from "./dhl-qr.js";
import { VERSAND, hoeherversicherungCents } from "./versand-config.js";
import { festeOptionen } from "./versand.js";
import { allMigrations, sqliteD1 } from "./test-d1.mjs";

// Hoeherversicherung "der Wahrheit entsprechend" (Inhaber 05.11.2026): Wer sie
// bezahlt, bekommt eine versicherte Marke - oder es entsteht gar keine.

const ENV = { DHL_API_KEY: "test-key", DHL_USER: "u", DHL_PASSWORD: "p", DHL_EKP: "3333333333" };
const KONTAKT = { recipient_name: "A. Beispiel", address_line1: "Musterweg 3", postal_code: "63739", city: "Aschaffenburg", country_code: "DE" };
const BESTELLUNG = { id: "order-1", order_number: "D119-20261105-ABC12345" };

test("Nur echte Hoeherversicherung heisst versichert, das normale Paket nur Haftung", () => {
  const optionen = festeOptionen("M", VERSAND, "DE");
  const normal = optionen.find(o => o.id === "fest-dhl-M");
  const versichert = optionen.find(o => o.id === "fest-dhl-versichert-M");
  assert.equal(normal.hoeherversicherung, false);
  assert.equal(normal.versichertBisCents, 50000, "500 EUR Haftung von DHL");
  assert.equal(versichert.hoeherversicherung, true);
  assert.equal(versichert.versichertBisCents, 250000);
  assert.ok(VERSAND.tarife.filter(t => /hv\d+/.test(t.id)).every(t => t.hoeherversicherung), "alle EU-Stufen sind echte Versicherung");
});

test("Versicherungshoehe aus der Versandoption und aus dem DHL-Produkt", () => {
  assert.equal(hoeherversicherungCents("fest-dhl-versichert-M"), 250000);
  assert.equal(hoeherversicherungCents("fest-dhl-eu-hv3000-XL"), 300000);
  assert.equal(hoeherversicherungCents("fest-dhl-M"), 0, "normales Paket: nur Haftung");
  assert.equal(hoeherversicherungCents("pl-M-23655"), 0);
  assert.equal(hoeherversicherungCents(null), 0);
  assert.equal(produktVersichertCents("PAK05.HVERSI2000.EU"), 200000);
  assert.equal(produktVersichertCents("PAK05"), 0);
  assert.equal(produktVersichertCents("PAK05.HVERSIX.EU"), 0);
});

test("QR-Marke: bezahlte Hoeherversicherung nur mit passend versichertem DHL-Produkt", async () => {
  const DB = sqliteD1(allMigrations());
  const now = new Date().toISOString();
  DB.raw.prepare(`INSERT INTO commerce_orders (id,order_number,status,currency,subtotal_cents,shipping_cents,total_cents,idempotency_key,created_at)
    VALUES ('o1','D119-2026-0001','PAID','EUR',180000,2849,182849,'k1',?)`).run(now);
  DB.raw.prepare(`INSERT INTO commerce_orders (id,order_number,status,currency,subtotal_cents,shipping_cents,total_cents,idempotency_key,created_at)
    VALUES ('o2','D119-2026-0002','PAID','EUR',9000,619,9619,'k2',?)`).run(now);
  DB.raw.prepare(`INSERT INTO order_versand (order_id,option_id,art,quelle,packlink_service_id,carrier,service_name,paket,preis_cents,laufzeit,created_at)
    VALUES ('o1','fest-dhl-eu-hv2000-M','standard','ersatz',NULL,'DHL','DHL Paket EU mit Höherversicherung','M',4549,'3 Tage',?)`).run(now);
  await assert.rejects(versicherungPruefen(DB, "o1", "PAK05"), err => err.code === "VERSICHERUNG_FEHLT" && /2\.000 €/.test(err.detail || err.text || err.message || ""));
  await assert.rejects(versicherungPruefen(DB, "o1", "PAK05.HVERSI1000.EU"), err => err.code === "VERSICHERUNG_FEHLT", "zu niedrig versichert");
  assert.equal(await versicherungPruefen(DB, "o1", "PAK05.HVERSI2000.EU"), 200000);
  assert.equal(await versicherungPruefen(DB, "o2", "PAK02"), 0, "ohne Hoeherversicherung keine Pruefung");
});

test("Geschaeftskunden-Marke: bezahlte Hoeherversicherung geht als Zusatzleistung an DHL", () => {
  const ohne = buildShipmentRequest(ENV, BESTELLUNG, KONTAKT);
  assert.equal(ohne.shipments[0].services, undefined);
  const mit = buildShipmentRequest(ENV, BESTELLUNG, KONTAKT, { versichertCents: 250000 });
  assert.deepEqual(mit.shipments[0].services, { additionalInsurance: { currency: "EUR", value: 2500 } });
  assert.equal(mit.shipments[0].product, "V01PAK");
  const eu = buildShipmentRequest(ENV, BESTELLUNG, { ...KONTAKT, country_code: "AT", postal_code: "1010", city: "Wien" }, { versichertCents: 300000 });
  assert.equal(eu.shipments[0].product, "V53WPAK");
  assert.deepEqual(eu.shipments[0].services, { additionalInsurance: { currency: "EUR", value: 3000 } });
  assert.throws(() => buildShipmentRequest(ENV, BESTELLUNG, KONTAKT, { versichertCents: 250000, produkt: "V62KP", weightG: 500 }),
    err => err.code === "VERSICHERUNG_NICHT_MIT_KLEINPAKET");
});

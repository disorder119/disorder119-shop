// Tax Ready 2026: abgeleitete Sichten im Dataset v3 (Vorgaenge, Versand,
// Korrektur-Referenzen, Artikel-Verknuepfung, Kleinunternehmer-Warnungen)
// und die Schutzregeln fuer oeffentliche Daten. Nur synthetische Daten, keine
// echten Zahlungen oder Erstattungen.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { taxFixture } from './tax-fixture.mjs';
import { captureStatements, recordVerifiedRefund } from './tax-evidence.js';
import { prepareTaxDatasetV3 } from './tax-ready-dataset-v3.js';
import { etikettZahlstatus } from './tax-ready-vorgaenge.js';
import { handleBuchhaltung } from './buchhaltung.js';
import { applyChanges } from './admin-katalog.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ORIGIN = 'https://admin.disorder119.com';
const sha = text => crypto.createHash('sha256').update(text, 'utf8').digest('hex');

async function zipEintraege(dataset) {
  const out = new Map();
  for await (const entry of dataset.entries()) out.set(entry.path, entry.content);
  return out;
}

// Zusaetzliche Vorgaenge neben der Fixture-Bestellung o1 (bezahlt Ende 2025,
// Geld 2026 da, 20 € teilweise erstattet).
function weitereVorgaenge(DB) {
  DB.raw.exec(`
    INSERT INTO inventory(id,item_id,article_no,updated_at) VALUES('i2',2,'TEST-2','2026-03-01'),('i3',3,'TEST-3','2026-03-01'),('i4',4,'TEST-4','2026-03-01');
    -- Checkout ohne Zahlung (PayPal-Seite offen)
    INSERT INTO commerce_orders(id,order_number,status,currency,subtotal_cents,shipping_cents,total_cents,idempotency_key,created_at)
      VALUES('o2','TEST-2026-002','PAYMENT_PENDING','EUR',4000,559,4559,'k-o2','2026-03-01T10:00:00Z');
    INSERT INTO payments(id,order_id,provider,provider_order_id,status,amount_cents,currency,idempotency_key,created_at)
      VALUES('p2','o2','PAYPAL','PP-O2','CREATED',4559,'EUR','pk-o2','2026-03-01T10:00:05Z');
    INSERT INTO order_items(id,order_id,inventory_id,item_id,article_no,title_snapshot,unit_price_cents,quantity,currency)
      VALUES('oi2','o2','i2',2,'TEST-2','Testhose',4000,1,'EUR');
    -- Storniert ohne Zahlung
    INSERT INTO commerce_orders(id,order_number,status,currency,subtotal_cents,shipping_cents,total_cents,idempotency_key,created_at,updated_at)
      VALUES('o3','TEST-2026-003','CANCELLED','EUR',3000,559,3559,'k-o3','2026-03-02T10:00:00Z','2026-03-02T11:00:00Z');
    INSERT INTO order_items(id,order_id,inventory_id,item_id,article_no,title_snapshot,unit_price_cents,quantity,currency)
      VALUES('oi3','o3','i3',3,'TEST-3','Testmantel',3000,1,'EUR');
    -- Bezahlt mit Gutschein, Versand mit Etikett
    INSERT INTO commerce_orders(id,order_number,status,currency,subtotal_cents,shipping_cents,total_cents,idempotency_key,created_at)
      VALUES('o4','TEST-2026-004','PREPARING','EUR',9000,559,9559,'k-o4','2026-03-03T10:00:00Z');
    INSERT INTO payments(id,order_id,provider,provider_order_id,provider_payment_id,status,amount_cents,currency,idempotency_key,created_at)
      VALUES('p4','o4','PAYPAL','PP-O4','PP-CAPTURE-4','COMPLETED',9559,'EUR','pk-o4','2026-03-03T10:00:05Z');
    INSERT INTO order_items(id,order_id,inventory_id,item_id,article_no,title_snapshot,unit_price_cents,quantity,currency)
      VALUES('oi4','o4','i4',4,'TEST-4','Testkleid',9000,1,'EUR');
    INSERT INTO audit_events(id,actor_type,entity_type,entity_id,event_type,request_id,metadata_json,created_at)
      VALUES('a-coupon','SYSTEM','order','o4','COUPON_RESERVED','r1','{"couponId":"c1","discountBps":1000,"discountCents":1000,"originalTotalCents":10559,"discountedTotalCents":9559}','2026-03-03T10:00:03Z');
    INSERT INTO order_versand(order_id,option_id,art,quelle,packlink_service_id,carrier,service_name,paket,preis_cents,laufzeit,created_at)
      VALUES('o4','pl-S-20425','standard','packlink',20425,'DPD','Paketshop S','S',559,'2 Tage','2026-03-03T10:00:00Z');
    INSERT INTO packlink_sendungen(id,order_id,reference,service_id,carrier,service_name,paket,price_cents,state,created_at,updated_at)
      VALUES('s-alt','o4','DE-ENTWURF-1',20425,'DPD','Paketshop S','S',559,'ERSETZT','2026-03-04T09:00:00Z','2026-03-04T09:05:00Z'),
            ('s-storno','o4','DE-STORNO-1',20955,'DPD','Classic','M',785,'CANCELED','2026-03-04T09:05:00Z','2026-03-04T09:10:00Z'),
            ('s-kauf','o4','DE-KAUF-1',20425,'DPD','Paketshop S','S',559,'READY_TO_PRINT','2026-03-04T09:10:00Z','2026-03-04T09:12:00Z');
    INSERT INTO shipments(id,order_id,carrier,service,tracking_number,status,created_at)
      VALUES('sh4','o4','DPD','Paketshop S','01234567890123','LABEL_CREATED','2026-03-04T09:12:00Z');
  `);
}

async function vollerDatensatz() {
  const { DB, capture } = await taxFixture();
  weitereVorgaenge(DB);
  await DB.batch(await captureStatements(DB, { id: 'p4', commerce_order_id: 'o4' }, {
    id: 'PP-CAPTURE-4', status: 'COMPLETED', amount: { value: '95.59', currency_code: 'EUR' }, create_time: '2026-03-03T10:01:00Z',
    seller_receivable_breakdown: { paypal_fee: { value: '2.98', currency_code: 'EUR' } },
  }, '2026-03-03T10:01:05Z'));
  // Originalrechnung zu o1 (unveraenderlich archiviert).
  const html = '<html><body>Rechnung TEST-2025-001</body></html>', text = 'Rechnung TEST-2025-001';
  DB.raw.prepare(`INSERT INTO rechnungen (id,order_id,rechnungsnummer,ausgestellt_am,waehrung,warenwert_cents,versand_cents,gesamt_cents,html,text,pruefsumme,erstellt_am,document_type,html_sha256)
    VALUES ('r1','o1','R-2026-0001','2026-01-01T00:31:00Z','EUR',9500,500,10000,?,?,?,'2026-01-01T00:31:00Z','invoice',?)`).run(html, text, sha(text), sha(html));
  return { DB, capture };
}

test('checkout without payment, cancellation and reservation expiry never become a sale', async () => {
  const { DB } = await vollerDatensatz();
  const data = await prepareTaxDatasetV3({ DB }, 2026);
  const o2 = data.transactions.find(t => t.order_id === 'o2');
  assert.equal(o2.counts_as_sale, false);
  assert.equal(o2.revenue_state, 'NOT_PAID');
  assert.equal(o2.amounts_cents.gross_paid, 0);
  assert.equal(o2.timestamps.payment_started_at, '2026-03-01T10:00:05Z');
  assert.equal(o2.timestamps.payment_completed_at, null);
  const o3 = data.transactions.find(t => t.order_id === 'o3');
  assert.equal(o3.revenue_state, 'CANCELLED_UNPAID');
  assert.equal(o3.timestamps.cancelled_at, '2026-03-02T11:00:00Z');
  assert.equal(o3.timestamps.cancelled_at_source, 'order_updated_at');
  // Nur echte Zahlungen zaehlen: o1 (100 €) und o4 (95,59 €).
  assert.equal(data.summary.sale_income_cents, 10000 + 9559);
});

test('a successful payment keeps every raw timestamp and amount apart; the cash year comes from the money flow', async () => {
  const { DB } = await vollerDatensatz();
  const data = await prepareTaxDatasetV3({ DB }, 2026);
  const o1 = data.transactions.find(t => t.order_id === 'o1');
  assert.deepEqual(o1.timestamps, {
    order_created_at: '2025-12-30T12:00:00Z',
    payment_started_at: '2025-12-30T12:00:00Z',
    payment_completed_at: '2025-12-31T23:30:00.000Z',
    provider_settled_at: '2025-12-31T23:30:00.000Z',
    refunded_at: ['2026-02-01T10:00:00.000Z'],
    cancelled_at: null,
    cancelled_at_source: null,
  });
  assert.deepEqual(o1.amounts_cents, {
    item_total: 9500, discount: 0, item_total_after_discount: 9500, customer_shipping: 500, order_total: 10000,
    gross_paid: 10000, provider_fee: 320, refund: 2000, net_cash: 7680,
  });
  // Jahrwechsel: bestellt 2025, Geld um 00:30 Uhr (Berlin) am 1.1.2026.
  assert.deepEqual(o1.cash_years, [2026]);
  assert.equal(o1.revenue_state, 'REFUNDED_PARTIAL');
  const vorjahr = await prepareTaxDatasetV3({ DB }, 2025);
  assert.equal(vorjahr.summary.sale_income_cents, 0);
  // Gutschein: Warenwert, Rabatt, Versand und Zahlung einzeln.
  const o4 = data.transactions.find(t => t.order_id === 'o4');
  assert.equal(o4.amounts_cents.item_total, 10000);
  assert.equal(o4.amounts_cents.discount, 1000);
  assert.equal(o4.amounts_cents.item_total_after_discount, 9000);
  assert.equal(o4.amounts_cents.customer_shipping, 559);
  assert.equal(o4.amounts_cents.gross_paid, 9559);
  assert.equal(o4.amounts_cents.provider_fee, 298);
  assert.equal(o4.amounts_cents.net_cash, 9261);
  assert.equal(data.summary.payment_fee_cents, 320 + 298);
});

test('duplicate webhooks and replayed refunds never double income or refunds', async () => {
  const { DB, capture } = await vollerDatensatz();
  await DB.batch(await captureStatements(DB, { id: 'p1', commerce_order_id: 'o1' }, capture, '2026-01-02T08:00:00Z'));
  await recordVerifiedRefund({ DB }, { resource: { id: 'PP-REFUND', status: 'COMPLETED', amount: { value: '20.00', currency_code: 'EUR' },
    create_time: '2026-02-01T10:00:00Z', supplementary_data: { related_ids: { capture_id: 'PP-CAPTURE' } } } });
  const data = await prepareTaxDatasetV3({ DB }, 2026);
  const o1 = data.transactions.find(t => t.order_id === 'o1');
  assert.equal(o1.evidence.captures.length, 1);
  assert.equal(o1.evidence.refunds.length, 1);
  assert.equal(o1.amounts_cents.gross_paid, 10000);
  assert.equal(o1.amounts_cents.refund, 2000);
  assert.equal(data.corrections.length, 1);
});

test('a refund gets its own correction reference; the original invoice stays untouched', async () => {
  const { DB } = await vollerDatensatz();
  const vorher = DB.raw.prepare('SELECT html,text,pruefsumme,html_sha256 FROM rechnungen WHERE id=?').get('r1');
  const data = await prepareTaxDatasetV3({ DB }, 2026);
  assert.equal(data.corrections.length, 1);
  const k = data.corrections[0];
  assert.equal(k.id, 'korrektur:PP-REFUND');
  assert.equal(k.scope, 'PARTIAL');
  assert.equal(k.refund.amount_cents, 2000);
  assert.equal(k.original_invoice.number, 'R-2026-0001');
  assert.equal(k.original_invoice.html_sha256, vorher.html_sha256);
  assert.deepEqual({ ...DB.raw.prepare('SELECT html,text,pruefsumme,html_sha256 FROM rechnungen WHERE id=?').get('r1') }, { ...vorher });
  // Die Rechnung selbst laesst sich nicht aendern.
  assert.throws(() => DB.raw.prepare("UPDATE rechnungen SET gesamt_cents=8000 WHERE id='r1'").run());

  // Volle Erstattung von o4: eigene Referenz, Umfang FULL - ohne Rechnung wird es ein Pruefpunkt.
  await recordVerifiedRefund({ DB }, { resource: { id: 'PP-REFUND-4', status: 'COMPLETED', amount: { value: '95.59', currency_code: 'EUR' },
    create_time: '2026-03-05T10:00:00Z', supplementary_data: { related_ids: { capture_id: 'PP-CAPTURE-4' } } } });
  const danach = await prepareTaxDatasetV3({ DB }, 2026);
  const k4 = danach.corrections.find(c => c.order_id === 'o4');
  assert.equal(k4.refund.amount_cents, 9559);
  assert.equal(k4.original_invoice, null);
  assert.equal(danach.transactions.find(t => t.order_id === 'o4').revenue_state, 'REFUNDED_FULL');
  assert.ok(danach.issues.some(i => i.code === 'REFUND_WITHOUT_ORIGINAL_INVOICE' && i.reference === 'o4'));
});

test('customer shipping and label costs stay separate raw values', async () => {
  const { DB } = await vollerDatensatz();
  const data = await prepareTaxDatasetV3({ DB }, 2026);
  const s = data.shipping.find(row => row.order_id === 'o4');
  assert.equal(s.customer_paid_shipping_cents, 559);
  assert.equal(s.customer_choice.carrier, 'DPD');
  // Ersetzter Entwurf kostet nichts und fehlt; storniertes Etikett bleibt sichtbar.
  assert.deepEqual(s.labels.map(l => [l.reference, l.payment_state, l.label_cost_cents]), [
    ['DE-STORNO-1', 'VOIDED', 785], ['DE-KAUF-1', 'PAID', 559],
  ]);
  assert.equal(s.labels[0].label_refund, 'VOIDED_CHECK_PROVIDER_CREDIT');
  assert.equal(s.label_cost_paid_cents, 559);
  assert.equal(s.shipments[0].tracking_number, '01234567890123');
  // Nicht verrechnet: der Kundenversand bleibt im Vorgang, das Etikett im Versand.
  assert.equal(data.transactions.find(t => t.order_id === 'o4').amounts_cents.customer_shipping, 559);
  assert.ok(data.issues.some(i => i.code === 'SHIPPING_LABEL_EXPENSE_UNBOOKED' && i.reference === 'o4'));

  // Packlink-Rechnung als Versandausgabe mit Bestellbezug gebucht -> kein Pruefpunkt mehr.
  DB.raw.exec(`INSERT INTO tax_accounts(id,name,kind,created_at) VALUES('bank','Geschäftskonto','BUSINESS_BANK','2026-03-01T00:00:00Z');
    INSERT INTO tax_ledger_events(id,account_id,event_type,direction,amount_cents,occurred_at,order_id,reconciliation_status,created_at)
      VALUES('ship-1','bank','SHIPPING_EXPENSE','OUT',559,'2026-03-20T10:00:00Z','o4','MATCHED','2026-03-20T10:00:00Z');`);
  const danach = await prepareTaxDatasetV3({ DB }, 2026);
  assert.ok(!danach.issues.some(i => i.code === 'SHIPPING_LABEL_EXPENSE_UNBOOKED' && i.reference === 'o4'));
  assert.equal(danach.summary.shipping_expense_cents, 559);
});

test('Vinted wallet sale, payout transfer and a private purchase link to one stable item id', async () => {
  const { DB } = await vollerDatensatz();
  DB.raw.exec(`
    INSERT INTO tax_accounts(id,name,kind,created_at) VALUES('vinted','Vinted Wallet','VINTED_WALLET','2026-01-01T00:00:00Z'),
      ('bank','Geschäftskonto','BUSINESS_BANK','2026-01-01T00:00:00Z'),('privat','Privatkonto','PRIVATE_SOURCE','2026-01-01T00:00:00Z');
    INSERT INTO inventory(id,item_id,article_no,updated_at) VALUES('i5',5,'TEST-5','2026-04-01');
    INSERT INTO tax_ledger_events(id,account_id,event_type,direction,amount_cents,occurred_at,provider,provider_reference,inventory_id,reconciliation_status,created_at)
      VALUES('v-sale','vinted','SALE_INCOME','IN',3500,'2026-04-02T10:00:00Z','VINTED','VT-1','i5','MATCHED','2026-04-02T10:00:00Z');
    INSERT INTO tax_ledger_events(id,account_id,event_type,direction,amount_cents,occurred_at,transfer_group_id,reconciliation_status,created_at)
      VALUES('v-out','vinted','ACCOUNT_TRANSFER','OUT',3500,'2026-04-05T10:00:00Z','t-v1','MATCHED','2026-04-05T10:00:00Z'),
            ('v-in','bank','ACCOUNT_TRANSFER','IN',3500,'2026-04-05T10:00:00Z','t-v1','MATCHED','2026-04-05T10:00:00Z');
    INSERT INTO tax_purchases(id,source_platform,source_reference,purchase_date,payment_date,item_price_cents,buyer_protection_fee_cents,shipping_cost_cents,total_paid_cents,payment_account_id,funding_type,status,created_at)
      VALUES('kauf-5','VINTED','VK-9','2026-03-20','2026-03-20',1500,95,299,1894,'privat','PRIVATE_FUNDS','CONFIRMED','2026-03-20T12:00:00Z');
    INSERT INTO tax_purchase_items(id,purchase_id,inventory_id,item_id,article_no,quantity,allocated_item_price_cents,allocated_shared_cost_cents,created_at)
      VALUES('kp-5','kauf-5','i5',5,'TEST-5',1,1500,394,'2026-03-20T12:00:00Z');
    INSERT INTO tax_ledger_events(id,account_id,event_type,direction,amount_cents,occurred_at,purchase_id,reconciliation_status,created_at)
      VALUES('k5-out','privat','PURCHASE','OUT',1894,'2026-03-20T12:00:00Z','kauf-5','MATCHED','2026-03-20T12:00:00Z'),
            ('k5-einlage','privat','OWNER_CONTRIBUTION','IN',1894,'2026-03-20T12:00:00Z','kauf-5','MATCHED','2026-03-20T12:00:00Z');
  `);
  const data = await prepareTaxDatasetV3({ DB }, 2026);
  // Vinted-Verkauf zaehlt einmal, die Auszahlung aufs Bankkonto nie.
  assert.equal(data.summary.sale_income_cents, 10000 + 9559 + 3500);
  assert.equal(data.summary.account_transfers_cents, 3500);
  assert.equal(data.summary.owner_contributions_cents, 1894);
  assert.ok(!data.issues.some(i => i.code === 'PRIVATE_PURCHASE_CONTRIBUTION_MISSING'));
  assert.ok(!data.issues.some(i => i.code === 'TRANSFER_NOT_BALANCED'));
  const artikel = data.itemLinks.find(e => e.item_id === 5);
  assert.deepEqual(artikel.inventory_ids, ['i5']);
  assert.deepEqual(artikel.purchases, [{ purchase_id: 'kauf-5', purchase_item_id: 'kp-5', allocated_cost_cents: 1894 }]);
  assert.deepEqual(artikel.ledger_event_ids, ['v-sale']);
  const shopArtikel = data.itemLinks.find(e => e.item_id === 4);
  assert.deepEqual(shopArtikel.orders.map(o => [o.order_id, o.revenue_state]), [['o4', 'PAID']]);
  assert.deepEqual(shopArtikel.shipping_label_ids, ['s-kauf', 's-storno']);
});

test('small-business limits only warn and never change the configured status', async () => {
  const { DB } = await vollerDatensatz();
  DB.raw.exec(`INSERT INTO tax_year_profiles(tax_year,vat_mode,confirmed,prior_year_limit_cents,current_year_limit_cents,warning_ratio_basis_points,updated_at)
    VALUES(2026,'KLEINUNTERNEHMER',1,2500000,20000,8000,'2026-01-01T00:00:00Z')`);
  const data = await prepareTaxDatasetV3({ DB }, 2026);
  // 100 € + 95,59 € - 20 € Erstattung = 175,59 € -> ueber 80 % von 200 €.
  assert.equal(data.smallBusiness.recorded_turnover_cents, 17559);
  assert.deepEqual(data.smallBusiness.warnings.map(w => w.code), ['SMALL_BUSINESS_LIMIT_WARNING']);
  assert.ok(data.issues.some(i => i.code === 'SMALL_BUSINESS_LIMIT_WARNING'));
  const profil = DB.raw.prepare('SELECT vat_mode,confirmed FROM tax_year_profiles WHERE tax_year=2026').get();
  assert.deepEqual({ ...profil }, { vat_mode: 'KLEINUNTERNEHMER', confirmed: 1 });

  const url = new URL('https://api.disorder119.com/admin/buchhaltung/jahr/2026');
  const res = await handleBuchhaltung(new Request(url, { headers: { Origin: ORIGIN, Authorization: 'Bearer test' } }), { DB, ADMIN_TOKEN: 'test' }, url, 'req', ORIGIN);
  const jahr = await res.json();
  assert.equal(res.status, 200);
  assert.equal(jahr.einnahmenCents, 10000 + 9559);
  assert.equal(jahr.v3.summary.sale_income_cents, 10000 + 9559);
  assert.deepEqual(jahr.v3.kleinunternehmer.warnings.map(w => w.code), ['SMALL_BUSINESS_LIMIT_WARNING']);
  assert.equal(jahr.reviewRequired, true);
});

test('repeated exports are identical, hash-checked and free of duplicates', async () => {
  const { DB } = await vollerDatensatz();
  const erste = await zipEintraege(await prepareTaxDatasetV3({ DB }, 2026));
  const zweite = await zipEintraege(await prepareTaxDatasetV3({ DB }, 2026));
  for (const neu of ['v3/sales_transactions.json', 'v3/shipping.json', 'v3/invoice_corrections.json', 'v3/item_links.json', 'v3/small_business_check.json']) {
    assert.ok(erste.has(neu), neu);
  }
  assert.deepEqual([...erste.keys()], [...zweite.keys()]);
  for (const [pfad, inhalt] of erste) {
    if (pfad === 'manifest.json') continue;
    assert.deepEqual(zweite.get(pfad), inhalt, pfad);
  }
  const manifest = JSON.parse(erste.get('manifest.json'));
  assert.equal(manifest.schema_version, 3);
  assert.deepEqual(manifest.backwards_compatible_with, [2]);
  const pfade = manifest.files.map(f => f.path);
  assert.equal(new Set(pfade).size, pfade.length);
  for (const datei of manifest.files) {
    const inhalt = erste.get(datei.path);
    const bytes = typeof inhalt === 'string' ? Buffer.from(inhalt, 'utf8') : Buffer.from(inhalt);
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), datei.sha256, datei.path);
    assert.equal(bytes.length, datei.bytes, datei.path);
  }
  const vorgaenge = JSON.parse(erste.get('v3/sales_transactions.json'));
  assert.equal(new Set(vorgaenge.map(v => v.order_id)).size, vorgaenge.length);
  const korrekturen = JSON.parse(erste.get('v3/invoice_corrections.json'));
  assert.equal(new Set(korrekturen.map(k => k.id)).size, korrekturen.length);
  // v2 bleibt enthalten und unveraendert im Aufbau.
  assert.ok(erste.has('data/orders.json') && erste.has('ledger.json'));
});

test('every Packlink state has a clear payment meaning for the label costs', () => {
  const quelle = fs.readFileSync(path.join(here, 'packlink.js'), 'utf8');
  const block = /const PHASEN = \[([\s\S]*?)\];/.exec(quelle)[1];
  const zeilen = [...block.matchAll(/\["(\w+)", \[([^\]]*)\]\]/g)];
  assert.ok(zeilen.length >= 8);
  const erwartet = { offen: 'UNPAID', bezahlt: 'PAID', bereit: 'PAID', unterwegs: 'PAID', zugestellt: 'PAID', storniert: 'VOIDED', problem: 'PAID', kauf: 'UNCLEAR', abgelehnt: 'UNCLEAR' };
  for (const [, phase, liste] of zeilen) {
    for (const [, state] of liste.matchAll(/"(\w+)"/g)) {
      assert.equal(etikettZahlstatus('PACKLINK', state), erwartet[phase], `${phase}:${state}`);
    }
  }
  assert.equal(etikettZahlstatus('DHL', 'PAYED'), 'PAID');
  assert.equal(etikettZahlstatus('DHL', 'INPAYMENT'), 'UNPAID');
  assert.equal(etikettZahlstatus('DHL', 'CANCELED'), 'VOIDED');
});

test('private accounting data never reaches public code paths or public catalog files', () => {
  const privat = /\b(tax_purchases|tax_purchase_items|tax_expense_events|tax_ledger_events|tax_accounts|tax_documents|tax_reconciliations|tax_classifications|tax_year_profiles)\b/;
  const erlaubt = new Set(['tax-ready-2026.js', 'tax-ready-dataset-v3.js', 'tax-ready-vorgaenge.js']);
  for (const name of fs.readdirSync(here)) {
    if (!name.endsWith('.js') || erlaubt.has(name)) continue;
    assert.doesNotMatch(fs.readFileSync(path.join(here, name), 'utf8'), privat, `${name} liest private Buchhaltungstabellen`);
  }
  // Die privaten Module haengen nur an /admin/buchhaltung - hinter der Admin-Anmeldung.
  const entry = fs.readFileSync(path.join(here, 'worker-entry.js'), 'utf8');
  assert.doesNotMatch(entry, /tax-ready-(2026|dataset-v3|vorgaenge)/);
  const buchhaltung = fs.readFileSync(path.join(here, 'buchhaltung.js'), 'utf8');
  assert.match(buchhaltung, /url\.pathname\.startsWith\("\/admin\/buchhaltung\/"\)/);

  // Der Katalog-Editor kann keine privaten Felder in items.json schreiben.
  for (const feld of ['purchase_price', 'einkaufspreis', 'purchase_source', 'payment_account_id', 'funding_type', 'profit_margin', 'beleg_id']) {
    assert.throws(() => applyChanges([{ id: 1, title: 'X', brand: 'Y', public_status: 'AVAILABLE' }], [{ id: 1, set: { [feld]: 1 } }]),
      err => err.code === 'FELD_NICHT_BEARBEITBAR', feld);
  }

  // Oeffentliche Katalogdateien: keine privaten Schluessel.
  const verboten = /^(purchase_?price(_?cents)?|einkaufspreis(_?cents)?|purchase_?source|einkaufsquelle|private_?payment_?account|payment_?account_?id|funding_?type|tax_?category|tax_?classification|owner_?contribution|owner_?draw|einlage|entnahme|(internal_)?profit_?margin|marge|receipt(_?id)?|beleg(_?id)?|document_?id|cost(_?cents)?|einkauf)$/i;
  for (const datei of ['items.json', 'catalog.json']) {
    const pfad = path.join(here, '..', 'data', datei);
    if (!fs.existsSync(pfad)) continue;
    const pruefe = (wert, ort) => {
      if (Array.isArray(wert)) return wert.forEach((w, i) => pruefe(w, `${ort}[${i}]`));
      if (!wert || typeof wert !== 'object') return;
      for (const [schluessel, kind] of Object.entries(wert)) {
        assert.doesNotMatch(schluessel, verboten, `${datei}: privater Schluessel ${schluessel} bei ${ort}`);
        pruefe(kind, `${ort}.${schluessel}`);
      }
    };
    pruefe(JSON.parse(fs.readFileSync(pfad, 'utf8')), datei);
  }
});

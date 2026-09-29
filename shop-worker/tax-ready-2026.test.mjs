import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildAccountingYearSummary,
  combineAccountingLedger,
  validateAccountingSnapshot,
} from './tax-ready-dataset-v3.js';
import { isTaxReadyRoute } from './tax-ready-2026.js';

const here = path.dirname(fileURLToPath(import.meta.url));

function baseTables() {
  return {
    accounts: [],
    purchases: [],
    purchase_items: [],
    expense_events: [],
    documents: [],
    ledger_events: [],
    reconciliations: [],
    tax_classifications: [],
    tax_year_profiles: [{ tax_year: 2026, vat_mode: 'KLEINUNTERNEHMER', confirmed: 1 }],
  };
}

test('provider capture, refund and fee enter v3 exactly once', () => {
  const tables = baseTables();
  const provider = [
    { id:'p1', kind:'capture', provider:'PAYPAL', provider_reference:'cap-1', amount_cents:10000, currency:'EUR', occurred_at:'2026-02-01T10:00:00Z', book_date:'2026-02-01', blocks:[] },
    { id:'p2', kind:'fee', provider:'PAYPAL', provider_reference:'cap-1', amount_cents:300, currency:'EUR', occurred_at:'2026-02-01T10:00:00Z', book_date:'2026-02-01', blocks:[] },
    { id:'p3', kind:'refund', provider:'PAYPAL', provider_reference:'ref-1', amount_cents:2000, currency:'EUR', occurred_at:'2026-02-03T10:00:00Z', book_date:'2026-02-03', blocks:[] },
  ];
  const summary = buildAccountingYearSummary(tables, 2026, provider);
  assert.equal(summary.sale_income_cents, 10000);
  assert.equal(summary.payment_fee_cents, 300);
  assert.equal(summary.refund_out_cents, 2000);
  assert.equal(summary.preliminary_cash_result_cents, 7700);
});

test('manual provider duplicate suppresses the matching v2 provider event', () => {
  const manual = [{
    id:'m1', account_id:'paypal', event_type:'SALE_INCOME', direction:'IN', amount_cents:10000,
    currency:'EUR', occurred_at:'2026-02-01T10:00:00Z', provider:'PAYPAL', provider_reference:'cap-1',
    reconciliation_status:'MATCHED'
  }];
  const provider = [{
    id:'p1', kind:'capture', provider:'PAYPAL', provider_reference:'cap-1', amount_cents:10000,
    currency:'EUR', occurred_at:'2026-02-01T10:00:00Z', book_date:'2026-02-01', blocks:[]
  }];
  const combined = combineAccountingLedger(manual, provider);
  assert.equal(combined.length, 1);
  assert.equal(combined[0].id, 'm1');
});

test('account transfers and owner movements never change operating result', () => {
  const tables = baseTables();
  tables.ledger_events = [
    { id:'sale',event_type:'SALE_INCOME',direction:'IN',amount_cents:10000,occurred_at:'2026-03-01T12:00:00Z' },
    { id:'cost',event_type:'PURCHASE',direction:'OUT',amount_cents:4000,occurred_at:'2026-03-02T12:00:00Z' },
    { id:'t-out',event_type:'ACCOUNT_TRANSFER',direction:'OUT',amount_cents:5000,occurred_at:'2026-03-03T12:00:00Z',transfer_group_id:'t1' },
    { id:'t-in',event_type:'ACCOUNT_TRANSFER',direction:'IN',amount_cents:5000,occurred_at:'2026-03-03T12:00:00Z',transfer_group_id:'t1' },
    { id:'contribution',event_type:'OWNER_CONTRIBUTION',direction:'IN',amount_cents:4000,occurred_at:'2026-03-02T12:00:00Z' },
    { id:'draw',event_type:'OWNER_DRAW',direction:'OUT',amount_cents:1000,occurred_at:'2026-03-04T12:00:00Z' },
  ];
  const summary = buildAccountingYearSummary(tables, 2026);
  assert.equal(summary.preliminary_cash_result_cents, 6000);
  assert.equal(summary.account_transfers_cents, 5000);
  assert.equal(summary.owner_contributions_cents, 4000);
  assert.equal(summary.owner_draws_cents, 1000);
});

test('private purchase requires matching owner contribution', () => {
  const tables = baseTables();
  tables.purchases = [{
    id:'purchase-1',purchase_date:'2026-01-10',payment_date:'2026-01-10',item_price_cents:2000,
    buyer_protection_fee_cents:0,platform_fee_cents:0,shipping_cost_cents:0,other_cost_cents:0,
    total_paid_cents:2000,funding_type:'PRIVATE_FUNDS',status:'CONFIRMED'
  }];
  tables.purchase_items = [{ id:'pi-1',purchase_id:'purchase-1',item_id:1 }];
  let issues = validateAccountingSnapshot(tables, 2026);
  assert.ok(issues.some(issue => issue.code === 'PRIVATE_PURCHASE_CONTRIBUTION_MISSING'));
  tables.ledger_events.push({ id:'c1',event_type:'OWNER_CONTRIBUTION',purchase_id:'purchase-1',amount_cents:2000,occurred_at:'2026-01-10T12:00:00Z',reconciliation_status:'MATCHED' });
  issues = validateAccountingSnapshot(tables, 2026);
  assert.ok(!issues.some(issue => issue.code === 'PRIVATE_PURCHASE_CONTRIBUTION_MISSING'));
});

test('unbalanced transfer is review-required', () => {
  const tables = baseTables();
  tables.ledger_events = [{
    id:'t1-out',event_type:'ACCOUNT_TRANSFER',direction:'OUT',amount_cents:5000,
    occurred_at:'2026-04-01T12:00:00Z',transfer_group_id:'transfer-1',reconciliation_status:'MATCHED'
  }];
  const issues = validateAccountingSnapshot(tables, 2026);
  assert.ok(issues.some(issue => issue.code === 'TRANSFER_NOT_BALANCED'));
});

test('unknown or unconfirmed annual VAT profile is never silently approved', () => {
  const tables = baseTables();
  tables.tax_year_profiles = [{ tax_year:2026, vat_mode:'UNKNOWN', confirmed:0 }];
  const issues = validateAccountingSnapshot(tables, 2026);
  assert.ok(issues.some(issue => issue.code === 'TAX_YEAR_PROFILE_UNCONFIRMED'));
});

test('v3 routes are private bookkeeping routes while old v2 route stays opt-in', () => {
  assert.equal(isTaxReadyRoute(new URL('https://admin.disorder119.com/admin/buchhaltung/einkaeufe')), true);
  assert.equal(isTaxReadyRoute(new URL('https://admin.disorder119.com/admin/buchhaltung/steuercheck/2026')), true);
  assert.equal(isTaxReadyRoute(new URL('https://admin.disorder119.com/admin/buchhaltung/datensatz-v3.zip?jahr=2026')), true);
  assert.equal(isTaxReadyRoute(new URL('https://admin.disorder119.com/admin/buchhaltung/datensatz.zip?jahr=2026&format=v3')), true);
  assert.equal(isTaxReadyRoute(new URL('https://admin.disorder119.com/admin/buchhaltung/datensatz.zip?jahr=2026')), false);
});

test('public items.json contains no private accounting field names', () => {
  const items = JSON.parse(fs.readFileSync(path.join(here, '..', 'data', 'items.json'), 'utf8'));
  const forbidden = new Set([
    'purchase_price','purchase_price_cents','purchaseprice','purchasepricecents','einkaufspreis','einkaufspreiscents',
    'purchase_source','einkaufsquelle','private_payment_account','payment_account_id','funding_type','tax_category',
    'tax_classification','owner_contribution','owner_draw','einlage','entnahme','profit_margin','internal_profit_margin',
    'receipt','receipt_id','document_id','beleg','beleg_id'
  ]);
  function walk(value, location='items') {
    if (Array.isArray(value)) return value.forEach((entry,index) => walk(entry,`${location}[${index}]`));
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      const normalized = key.toLowerCase().replace(/[-\s]/g,'_');
      assert.ok(!forbidden.has(normalized), `private accounting key ${key} leaked at ${location}`);
      walk(child, `${location}.${key}`);
    }
  }
  walk(items);
});

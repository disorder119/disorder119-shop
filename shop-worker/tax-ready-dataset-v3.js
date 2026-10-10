// Tax dataset v3 extends, but does not replace, the existing v2 export.
// v2 stays byte-compatible at its existing route. v3 adds private accounting
// source data and combines it with the already immutable provider evidence.
import { prepareDataset } from './tax-dataset-stream.js';
import { bookDate } from './tax-dataset.js';
import { digestBytes, zipStream } from './tax-zip-stream.js';
import {
  VORGANG_QUERIES,
  buildInvoiceCorrections,
  buildItemLinks,
  buildSalesTransactions,
  buildShipping,
  smallBusinessCheck,
  vorgangIssues,
} from './tax-ready-vorgaenge.js';

const encoder = new TextEncoder();
const MAX_ROWS = 10000;

const V3_QUERIES = Object.freeze({
  accounts: 'SELECT * FROM tax_accounts ORDER BY id',
  purchases: 'SELECT * FROM tax_purchases ORDER BY id',
  purchase_items: 'SELECT * FROM tax_purchase_items ORDER BY id',
  expense_events: 'SELECT * FROM tax_expense_events ORDER BY id',
  documents: 'SELECT * FROM tax_documents ORDER BY id',
  ledger_events: 'SELECT * FROM tax_ledger_events ORDER BY id',
  reconciliations: 'SELECT * FROM tax_reconciliations ORDER BY id',
  tax_classifications: 'SELECT * FROM tax_classifications ORDER BY id',
  tax_year_profiles: 'SELECT * FROM tax_year_profiles ORDER BY tax_year',
});

function sum(rows, predicate) {
  return rows.filter(predicate).reduce((total, row) => total + Number(row.amount_cents || 0), 0);
}

function yearOfEvent(row) {
  const value = row.occurred_at || row.value_date || '';
  const date = bookDate(value);
  return date ? Number(date.slice(0, 4)) : null;
}

function purchaseYear(row) {
  const raw = row.payment_date || row.purchase_date || '';
  return /^\d{4}-\d{2}-\d{2}/.test(raw) ? Number(raw.slice(0, 4)) : null;
}

function expenseYear(row) {
  const raw = row.payment_date || row.incurred_date || '';
  return /^\d{4}-\d{2}-\d{2}/.test(raw) ? Number(raw.slice(0, 4)) : null;
}

function providerEventType(kind) {
  if (kind === 'capture') return { event_type: 'SALE_INCOME', direction: 'IN' };
  if (kind === 'refund') return { event_type: 'REFUND_OUT', direction: 'OUT' };
  if (kind === 'fee') return { event_type: 'PAYMENT_FEE', direction: 'OUT' };
  return null;
}

// The existing v2 ledger is the authoritative source for provider-confirmed
// PayPal cash. Manual v3 rows may cover bank/Vinted/cash or historical cases.
// If a manual row explicitly carries the same provider reference and mapped
// event type, it replaces the provider row in the combined view, never doubles it.
export function combineAccountingLedger(manualRows = [], providerRows = []) {
  const manual = manualRows.map(row => ({ ...row, source: row.source || 'private_accounting_ledger' }));
  const manualKeys = new Set(manual
    .filter(row => row.provider && row.provider_reference)
    .map(row => `${String(row.provider).toUpperCase()}|${row.provider_reference}|${row.event_type}`));
  const provider = [];
  for (const row of providerRows) {
    if (Array.isArray(row.blocks) && row.blocks.length) continue;
    const mapped = providerEventType(row.kind);
    if (!mapped || !row.book_date) continue;
    const key = `${String(row.provider || '').toUpperCase()}|${row.provider_reference || ''}|${mapped.event_type}`;
    if (manualKeys.has(key)) continue;
    provider.push({
      id: `provider:${row.id}`,
      account_id: null,
      ...mapped,
      amount_cents: Number(row.amount_cents || 0),
      currency: row.currency || 'EUR',
      occurred_at: row.occurred_at || null,
      value_date: row.book_date,
      provider: row.provider || null,
      provider_reference: row.provider_reference || null,
      transfer_group_id: null,
      order_id: row.order_id || null,
      payment_id: row.payment_id || null,
      refund_id: null,
      purchase_id: null,
      expense_id: null,
      inventory_id: null,
      document_id: null,
      reconciliation_status: 'MATCHED',
      notes: 'Aus unveränderlichem Zahlungsanbieter-Nachweis (TAX_DATASET_V2)',
      created_at: row.observed_at || row.occurred_at || null,
      source: row.source || 'verified_provider_event',
    });
  }
  return [...provider, ...manual];
}

export function validateAccountingSnapshot(tables, year) {
  const issues = [];
  const purchases = tables.purchases || [];
  const purchaseItems = tables.purchase_items || [];
  const expenses = tables.expense_events || [];
  const ledger = tables.ledger_events || [];
  const documents = tables.documents || [];
  const profiles = tables.tax_year_profiles || [];

  for (const p of purchases) {
    const calculated = Number(p.item_price_cents || 0)
      + Number(p.buyer_protection_fee_cents || 0)
      + Number(p.platform_fee_cents || 0)
      + Number(p.shipping_cost_cents || 0)
      + Number(p.other_cost_cents || 0);
    if (calculated !== Number(p.total_paid_cents || 0)) {
      issues.push({ code: 'PURCHASE_TOTAL_MISMATCH', reference: p.id, message: 'Einkaufssumme stimmt nicht mit Warenwert + Gebühren + Versand + Nebenkosten überein.' });
    }
    if (p.status === 'CONFIRMED' && !p.payment_date) {
      issues.push({ code: 'PURCHASE_PAYMENT_DATE_MISSING', reference: p.id, message: 'Bestätigter Einkauf ohne Zahlungsdatum; Jahreszuordnung nicht sicher.' });
    }
    if (!purchaseItems.some(item => item.purchase_id === p.id)) {
      issues.push({ code: 'PURCHASE_WITHOUT_ITEMS', reference: p.id, message: 'Einkauf ist keinem Artikel zugeordnet.' });
    }
    if (p.funding_type === 'PRIVATE_FUNDS' && p.status !== 'VOID') {
      const matchingContribution = ledger.some(event => event.event_type === 'OWNER_CONTRIBUTION'
        && event.purchase_id === p.id && Number(event.amount_cents) === Number(p.total_paid_cents));
      if (!matchingContribution) {
        issues.push({ code: 'PRIVATE_PURCHASE_CONTRIBUTION_MISSING', reference: p.id, message: 'Privat bezahlter Einkauf ohne verknüpfte Einlage/OWNER_CONTRIBUTION.' });
      }
    }
  }

  for (const item of purchaseItems) {
    if (!item.inventory_id && !item.item_id && !item.article_no) {
      issues.push({ code: 'PURCHASE_ITEM_IDENTITY_MISSING', reference: item.id, message: 'Einkaufsposition ohne stabile Artikelreferenz.' });
    }
  }

  for (const expense of expenses) {
    if (expense.status === 'CONFIRMED' && !expense.payment_date) {
      issues.push({ code: 'EXPENSE_PAYMENT_DATE_MISSING', reference: expense.id, message: 'Bestätigte Ausgabe ohne Zahlungsdatum.' });
    }
    if (expense.funding_type === 'PRIVATE_FUNDS' && expense.status !== 'VOID') {
      const matchingContribution = ledger.some(event => event.event_type === 'OWNER_CONTRIBUTION'
        && event.expense_id === expense.id && Number(event.amount_cents) === Number(expense.amount_cents));
      if (!matchingContribution) {
        issues.push({ code: 'PRIVATE_EXPENSE_CONTRIBUTION_MISSING', reference: expense.id, message: 'Privat bezahlte Betriebsausgabe ohne verknüpfte Einlage/OWNER_CONTRIBUTION.' });
      }
    }
  }

  for (const event of ledger) {
    if (!event.occurred_at && !event.value_date) {
      issues.push({ code: 'CASH_EVENT_DATE_MISSING', reference: event.id, message: 'Geldbewegung ohne Zahlungs-/Wertstellungsdatum.' });
    }
    if (event.reconciliation_status === 'UNRECONCILED' || event.reconciliation_status === 'REVIEW_REQUIRED') {
      issues.push({ code: 'CASH_EVENT_UNRECONCILED', reference: event.id, message: 'Geldbewegung ist noch nicht abschließend abgestimmt.' });
    }
  }

  const transferGroups = new Map();
  for (const event of ledger.filter(row => row.event_type === 'ACCOUNT_TRANSFER')) {
    if (!event.transfer_group_id) {
      issues.push({ code: 'TRANSFER_GROUP_MISSING', reference: event.id, message: 'Kontotransfer ohne Transfergruppe; Risiko einer doppelten Erfassung.' });
      continue;
    }
    const group = transferGroups.get(event.transfer_group_id) || [];
    group.push(event);
    transferGroups.set(event.transfer_group_id, group);
  }
  for (const [groupId, rows] of transferGroups) {
    const incoming = sum(rows, row => row.direction === 'IN');
    const outgoing = sum(rows, row => row.direction === 'OUT');
    if (rows.length !== 2 || incoming !== outgoing) {
      issues.push({ code: 'TRANSFER_NOT_BALANCED', reference: groupId, message: 'Kontotransfer braucht genau eine gleich hohe Abgangs- und Zugangsbuchung.' });
    }
  }

  for (const doc of documents) {
    if (doc.storage_state !== 'ARCHIVED') {
      issues.push({ code: 'DOCUMENT_NOT_ARCHIVED', reference: doc.id, message: 'Belegmetadaten vorhanden, Originaldatei aber nicht als archiviert bestätigt.' });
    }
  }

  const profile = profiles.find(row => Number(row.tax_year) === Number(year));
  if (!profile || profile.vat_mode === 'UNKNOWN' || Number(profile.confirmed) !== 1) {
    issues.push({ code: 'TAX_YEAR_PROFILE_UNCONFIRMED', reference: String(year), message: 'Umsatzsteuerstatus des Steuerjahres ist nicht ausdrücklich bestätigt.' });
  }

  return issues;
}

export function buildAccountingYearSummary(tables, year, providerLedger = []) {
  const ledger = combineAccountingLedger(tables.ledger_events || [], providerLedger)
    .filter(row => yearOfEvent(row) === Number(year));
  const purchases = (tables.purchases || []).filter(row => purchaseYear(row) === Number(year) && row.status !== 'VOID');
  const expenses = (tables.expense_events || []).filter(row => expenseYear(row) === Number(year) && row.status !== 'VOID');

  const pnlEventTypes = new Set([
    'SALE_INCOME','OTHER_INCOME','PURCHASE','PLATFORM_FEE','PAYMENT_FEE','SHIPPING_EXPENSE',
    'ADVERTISING','SOFTWARE','PACKAGING','REFUND_IN','REFUND_OUT','OTHER_EXPENSE','OTHER'
  ]);
  const operatingLedger = ledger.filter(row => pnlEventTypes.has(row.event_type));
  const operatingInflows = sum(operatingLedger, row => row.direction === 'IN');
  const operatingOutflows = sum(operatingLedger, row => row.direction === 'OUT');

  return {
    tax_year: Number(year),
    basis: 'verified_provider_evidence_plus_private_cash_ledger',
    review_required: true,
    sale_income_cents: sum(ledger, row => row.event_type === 'SALE_INCOME' && row.direction === 'IN'),
    other_income_cents: sum(ledger, row => row.event_type === 'OTHER_INCOME' && row.direction === 'IN'),
    refund_in_cents: sum(ledger, row => row.event_type === 'REFUND_IN' && row.direction === 'IN'),
    refund_out_cents: sum(ledger, row => row.event_type === 'REFUND_OUT' && row.direction === 'OUT'),
    platform_fee_cents: sum(ledger, row => row.event_type === 'PLATFORM_FEE' && row.direction === 'OUT'),
    payment_fee_cents: sum(ledger, row => row.event_type === 'PAYMENT_FEE' && row.direction === 'OUT'),
    shipping_expense_cents: sum(ledger, row => row.event_type === 'SHIPPING_EXPENSE' && row.direction === 'OUT'),
    advertising_cents: sum(ledger, row => row.event_type === 'ADVERTISING' && row.direction === 'OUT'),
    software_cents: sum(ledger, row => row.event_type === 'SOFTWARE' && row.direction === 'OUT'),
    packaging_cents: sum(ledger, row => row.event_type === 'PACKAGING' && row.direction === 'OUT'),
    owner_contributions_cents: sum(ledger, row => row.event_type === 'OWNER_CONTRIBUTION'),
    owner_draws_cents: sum(ledger, row => row.event_type === 'OWNER_DRAW'),
    account_transfers_cents: sum(ledger, row => row.event_type === 'ACCOUNT_TRANSFER' && row.direction === 'OUT'),
    purchase_source_total_cents: purchases.reduce((s, row) => s + Number(row.total_paid_cents || 0), 0),
    expense_source_total_cents: expenses.reduce((s, row) => s + Number(row.amount_cents || 0), 0),
    ledger_operating_inflow_cents: operatingInflows,
    ledger_operating_outflow_cents: operatingOutflows,
    preliminary_cash_result_cents: operatingInflows - operatingOutflows,
    combined_cash_event_count: ledger.length,
    note: 'Vorläufige technische Zusammenfassung. Kontotransfers, Einlagen und Entnahmen sind nicht als Betriebsergebnis behandelt. Provider-Zahlungsnachweise haben Vorrang vor manuell duplizierten Provider-Ereignissen. Keine automatische Steuerfreigabe.'
  };
}

async function loadV3Tables(env) {
  const names = Object.keys(V3_QUERIES);
  const result = await env.DB.batch(names.map(name => env.DB.prepare(`${V3_QUERIES[name]} LIMIT ${MAX_ROWS + 1}`)));
  const tables = {};
  names.forEach((name, index) => {
    if (result[index]?.success === false || !Array.isArray(result[index]?.results)) throw new Error('TAX_V3_SNAPSHOT_FAILED');
    if (result[index].results.length > MAX_ROWS) throw new Error('TAX_V3_ROW_LIMIT');
    tables[name] = result[index].results;
  });
  return tables;
}

async function loadVorgangTables(env) {
  const names = Object.keys(VORGANG_QUERIES);
  const result = await env.DB.batch(names.map(name => env.DB.prepare(`${VORGANG_QUERIES[name]} LIMIT ${MAX_ROWS + 1}`)));
  const tables = {};
  names.forEach((name, index) => {
    if (result[index]?.success === false || !Array.isArray(result[index]?.results)) throw new Error('TAX_V3_SNAPSHOT_FAILED');
    if (result[index].results.length > MAX_ROWS) throw new Error('TAX_V3_ROW_LIMIT');
    tables[name] = result[index].results;
  });
  return tables;
}

function v2Tabelle(base, name) {
  const text = base.files?.[`data/${name}.json`];
  return text ? JSON.parse(text) : [];
}

// Jahresueberblick fuer GET /admin/buchhaltung/jahr/:jahr - dieselbe Rechnung
// wie im v3-Export, ohne den ganzen Datensatz zu bauen.
export async function taxReadyYearOverview(env, year, providerLedger = []) {
  const tables = await loadV3Tables(env);
  const summary = buildAccountingYearSummary(tables, year, providerLedger);
  const kleinunternehmer = smallBusinessCheck(tables, year, y => (Number(y) === Number(year)
    ? summary : buildAccountingYearSummary(tables, y, providerLedger)));
  return { summary, kleinunternehmer };
}

export async function prepareTaxDatasetV3(env, year) {
  const base = await prepareDataset(env, year);
  const tables = await loadV3Tables(env);
  const extra = await loadVorgangTables(env);
  const v2 = {
    orders: v2Tabelle(base, 'orders'),
    payments: v2Tabelle(base, 'payments'),
    cash_events: v2Tabelle(base, 'cash_events'),
  };
  const ledgerV2 = base.ledger || [];
  const transactions = buildSalesTransactions(v2, ledgerV2, extra);
  const shipping = buildShipping(v2, extra);
  const corrections = buildInvoiceCorrections(v2, ledgerV2, extra);
  const itemLinks = buildItemLinks(v2, tables, extra, transactions, shipping);
  const summary = buildAccountingYearSummary(tables, year, ledgerV2);
  const smallBusiness = smallBusinessCheck(tables, year, y => (Number(y) === Number(year)
    ? summary : buildAccountingYearSummary(tables, y, ledgerV2)));
  const privateIssues = [
    ...validateAccountingSnapshot(tables, year),
    ...vorgangIssues(transactions, shipping, corrections, tables.ledger_events),
    ...smallBusiness.warnings,
  ];
  const issues = [...(base.issues || []), ...privateIssues];
  const combinedLedger = combineAccountingLedger(tables.ledger_events, ledgerV2);
  const ownerContributions = tables.ledger_events.filter(row => row.event_type === 'OWNER_CONTRIBUTION');
  const ownerDraws = tables.ledger_events.filter(row => row.event_type === 'OWNER_DRAW');

  const extraFiles = {
    'v3/accounts.json': JSON.stringify(tables.accounts),
    'v3/purchases.json': JSON.stringify(tables.purchases),
    'v3/purchase_items.json': JSON.stringify(tables.purchase_items),
    'v3/expense_events.json': JSON.stringify(tables.expense_events),
    'v3/documents.json': JSON.stringify(tables.documents),
    'v3/manual_cash_events.json': JSON.stringify(tables.ledger_events),
    'v3/combined_cash_ledger.json': JSON.stringify(combinedLedger),
    'v3/owner_contributions.json': JSON.stringify(ownerContributions),
    'v3/owner_draws.json': JSON.stringify(ownerDraws),
    'v3/reconciliations.json': JSON.stringify(tables.reconciliations),
    'v3/tax_classifications.json': JSON.stringify(tables.tax_classifications),
    'v3/tax_year_profiles.json': JSON.stringify(tables.tax_year_profiles),
    'v3/year_summary.json': JSON.stringify(summary, null, 2),
    'v3/sales_transactions.json': JSON.stringify(transactions),
    'v3/shipping.json': JSON.stringify(shipping),
    'v3/invoice_corrections.json': JSON.stringify(corrections),
    'v3/item_links.json': JSON.stringify(itemLinks),
    'v3/small_business_check.json': JSON.stringify(smallBusiness, null, 2),
    'v3/issues.json': JSON.stringify(issues, null, 2),
    'v3/README.txt': 'Tax Dataset v3 ergänzt den unveränderten v2-Shop-Datensatz um private Einkaufs-, Ausgaben-, Konten-, Cash-Ledger-, Einlagen/Entnahmen-, Belegmetadaten- und Abstimmungsdaten. Verifizierte Provider-Cash-Events aus v2 fließen automatisch in die v3-Jahressicht ein. ACCOUNT_TRANSFER ist niemals Umsatz oder Betriebsausgabe. UNKNOWN/REVIEW_REQUIRED bedeutet bewusst ungeklärt. Belegdateien selbst werden nur exportiert, wenn ein separates privates Archiv sie tatsächlich speichert; METADATA_ONLY ist kein archiviertes Original. Abgeleitete Sichten (aus denselben Rohdaten berechnet, nichts gespeichert): sales_transactions.json (je Bestellung alle Rohzeitpunkte und Beträge getrennt, Umsatz nur mit belegter Zahlung), shipping.json (Kundenversand und Etikettenkosten getrennt, nicht verrechnet), invoice_corrections.json (Erstattung als eigene Referenz zur unveränderten Originalrechnung), item_links.json (eine Artikel-ID verbindet Einkauf, Verkauf, Zahlung, Erstattung, Versand und private Geldbewegungen), small_business_check.json (Warnungen zu den selbst eingetragenen Grenzen, keine Statusänderung).'
  };

  const manifest = {
    format: 'disorder119.shop-dataset',
    schema_version: 3,
    backwards_compatible_with: [2],
    source_id: 'disorder119.com',
    scope: 'full_history_plus_tax_ready_2026',
    requested_year: Number(year),
    generated_at: new Date().toISOString(),
    timezone: 'Europe/Berlin',
    document_encoding: { ...base.manifest.document_encoding },
    counts: { ...base.manifest.counts },
    review_required: true,
    v3_counts: Object.fromEntries(Object.entries(tables).map(([name, rows]) => [name, rows.length])),
    derived_counts: {
      sales_transactions: transactions.length,
      shipping: shipping.length,
      invoice_corrections: corrections.length,
      item_links: itemLinks.length,
    },
    combined_cash_events: combinedLedger.length,
    files: []
  };

  async function* entries() {
    for await (const entry of base.entries()) {
      if (entry.path === 'manifest.json') continue;
      const bytes = typeof entry.content === 'string' ? encoder.encode(entry.content) : entry.content;
      const originalSpec = base.manifest.files[base.manifest.files.length - 1];
      if (!originalSpec || originalSpec.path !== entry.path) throw new Error('TAX_V3_ORIGINAL_MANIFEST_MISSING');
      manifest.files.push({ ...originalSpec, path: entry.path, sha256: await digestBytes(bytes), bytes: bytes.length });
      yield entry;
    }
    for (const [path, content] of Object.entries(extraFiles)) {
      const bytes = encoder.encode(content);
      manifest.files.push({ path, sha256: await digestBytes(bytes), bytes: bytes.length });
      yield { path, content };
    }
    const manifestText = JSON.stringify(manifest, null, 2);
    yield { path: 'manifest.json', content: manifestText };
  }

  return {
    manifest,
    tables,
    issues,
    summary,
    smallBusiness,
    transactions,
    shipping,
    corrections,
    itemLinks,
    combinedLedger,
    stream: () => zipStream(entries()),
    entries,
  };
}

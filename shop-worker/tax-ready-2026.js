// Private Tax Ready 2026 API. Routed only behind the existing admin gateway.
// Public shop/catalog routes never call this module.
import { safeText } from './commerce-core.js';
import { prepareTaxDatasetV3 } from './tax-ready-dataset-v3.js';

const ADMIN_ORIGINS = new Set([
  'https://admin.disorder119.com',
  'http://localhost:8765',
  'http://127.0.0.1:8765',
]);
const MAX_BODY_BYTES = 32 * 1024;
const FUNDING = new Set(['BUSINESS_FUNDS','PRIVATE_FUNDS','MIXED','UNKNOWN']);
const VAT_MODES = new Set(['KLEINUNTERNEHMER','REGELBESTEUERUNG','UNKNOWN']);
const ACCOUNT_KINDS = new Set(['BUSINESS_BANK','VINTED_WALLET','PAYPAL','CASH','PRIVATE_SOURCE','OTHER']);
const LEDGER_TYPES = new Set([
  'SALE_INCOME','OTHER_INCOME','PURCHASE','PLATFORM_FEE','PAYMENT_FEE','SHIPPING_EXPENSE',
  'ADVERTISING','SOFTWARE','PACKAGING','REFUND_IN','REFUND_OUT','OWNER_CONTRIBUTION',
  'OWNER_DRAW','ACCOUNT_TRANSFER','OTHER_EXPENSE','OTHER','UNKNOWN'
]);
const EXPENSE_EVENT_BY_CATEGORY = Object.freeze({
  SHIPPING: 'SHIPPING_EXPENSE', ADVERTISING: 'ADVERTISING', SOFTWARE: 'SOFTWARE',
  PACKAGING: 'PACKAGING', PLATFORM_FEE: 'PLATFORM_FEE', PAYMENT_FEE: 'PAYMENT_FEE'
});

export class TaxReadyError extends Error {
  constructor(code, status = 400, details = null) {
    super(code); this.code = code; this.status = status; this.details = details;
  }
}

function headers(origin) {
  const result = {
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, Idempotency-Key',
    'Access-Control-Max-Age': '600',
    'Vary': 'Origin',
  };
  if (origin && ADMIN_ORIGINS.has(origin)) result['Access-Control-Allow-Origin'] = origin;
  return result;
}
function json(data, status = 200, origin = null) {
  return new Response(JSON.stringify(data), { status, headers: { ...headers(origin), 'Content-Type': 'application/json; charset=utf-8' } });
}
function binary(body, type, filename, origin) {
  return new Response(body, { status: 200, headers: { ...headers(origin), 'Content-Type': type, 'Content-Disposition': `attachment; filename="${filename}"` } });
}
async function digest(value) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value || ''))));
}
async function tokenEquals(a, b) {
  if (!a || !b) return false;
  const [x, y] = await Promise.all([digest(a), digest(b)]);
  if (x.length !== y.length) return false;
  let diff = 0; for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}
async function requireAdmin(request, env) {
  if (!env.ADMIN_TOKEN) throw new TaxReadyError('ADMIN_NOT_CONFIGURED', 503);
  const supplied = String(request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!(await tokenEquals(supplied, env.ADMIN_TOKEN))) throw new TaxReadyError('UNAUTHORIZED', 401);
}
async function readJson(request) {
  const type = String(request.headers.get('Content-Type') || '').toLowerCase();
  if (!type.includes('application/json')) throw new TaxReadyError('CONTENT_TYPE_REQUIRED', 415);
  const declared = Number(request.headers.get('Content-Length') || 0);
  if (declared > MAX_BODY_BYTES) throw new TaxReadyError('REQUEST_TOO_LARGE', 413);
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) throw new TaxReadyError('REQUEST_TOO_LARGE', 413);
  try { return raw ? JSON.parse(raw) : {}; } catch { throw new TaxReadyError('INVALID_JSON', 400); }
}
function cents(value, field, allowZero = true) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < (allowZero ? 0 : 1)) throw new TaxReadyError('INVALID_CENTS', 422, field);
  return n;
}
function dateOnly(value, field, required = false) {
  const s = String(value || '').trim();
  if (!s && !required) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !Number.isFinite(Date.parse(`${s}T00:00:00Z`))) throw new TaxReadyError('INVALID_DATE', 422, field);
  return s;
}
function timestamp(value, field, required = false) {
  const s = String(value || '').trim();
  if (!s && !required) return null;
  if (!Number.isFinite(Date.parse(s))) throw new TaxReadyError('INVALID_TIMESTAMP', 422, field);
  return new Date(s).toISOString();
}
function id(value, field = 'id') {
  const s = String(value || '').trim();
  if (!/^[A-Za-z0-9:_-]{3,160}$/.test(s)) throw new TaxReadyError('INVALID_ID', 422, field);
  return s;
}
function optionalId(value, field) { return value == null || value === '' ? null : id(value, field); }
function short(value, max = 300) { return safeText(value == null ? '' : String(value), max).trim() || null; }
function funding(value) {
  const v = String(value || 'UNKNOWN').toUpperCase();
  if (!FUNDING.has(v)) throw new TaxReadyError('INVALID_FUNDING_TYPE', 422);
  return v;
}
function now() { return new Date().toISOString(); }
function uuid(prefix) { return `${prefix}_${crypto.randomUUID()}`; }

async function audit(env, reqId, entityType, entityId, eventType, metadata = {}) {
  const at = now();
  await env.DB.prepare(`INSERT INTO audit_events
    (id,actor_type,actor_ref,entity_type,entity_id,event_type,request_id,metadata_json,created_at)
    VALUES (?,?,?,?,?,?,?,?,?)`).bind(
      uuid('audit'), 'ADMIN', 'tax-ready-2026', entityType, entityId, eventType, reqId,
      JSON.stringify(metadata), at
    ).run();
}
async function account(env, accountId) {
  if (!accountId) return null;
  const row = await env.DB.prepare('SELECT * FROM tax_accounts WHERE id=?').bind(accountId).first();
  if (!row) throw new TaxReadyError('ACCOUNT_NOT_FOUND', 422, accountId);
  return row;
}
async function appendLedger(env, values) {
  const eventId = values.id || uuid('cash');
  await env.DB.prepare(`INSERT INTO tax_ledger_events
    (id,account_id,event_type,direction,amount_cents,currency,occurred_at,value_date,provider,provider_reference,
     transfer_group_id,order_id,payment_id,refund_id,purchase_id,expense_id,inventory_id,document_id,
     reconciliation_status,notes,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
      eventId, values.accountId, values.eventType, values.direction, values.amountCents, values.currency || 'EUR',
      values.occurredAt || null, values.valueDate || null, values.provider || null, values.providerReference || null,
      values.transferGroupId || null, values.orderId || null, values.paymentId || null, values.refundId || null,
      values.purchaseId || null, values.expenseId || null, values.inventoryId || null, values.documentId || null,
      values.reconciliationStatus || 'UNRECONCILED', values.notes || null, now()
    ).run();
  return eventId;
}

async function listAccounts(env) {
  return (await env.DB.prepare('SELECT * FROM tax_accounts ORDER BY active DESC,name,id').all())?.results || [];
}
async function createAccount(request, env, reqId) {
  const body = await readJson(request);
  const row = {
    id: body.id ? id(body.id) : uuid('acct'), name: short(body.name, 120),
    kind: String(body.kind || '').toUpperCase(), isBusiness: body.isBusiness === false ? 0 : 1,
    notes: short(body.notes, 500)
  };
  if (!row.name) throw new TaxReadyError('ACCOUNT_NAME_REQUIRED', 422);
  if (!ACCOUNT_KINDS.has(row.kind)) throw new TaxReadyError('INVALID_ACCOUNT_KIND', 422);
  if (row.kind === 'PRIVATE_SOURCE') row.isBusiness = 0;
  const at = now();
  await env.DB.prepare(`INSERT INTO tax_accounts
    (id,name,kind,currency,is_business,active,notes,created_at) VALUES (?,?,?,'EUR',?,1,?,?)`)
    .bind(row.id,row.name,row.kind,row.isBusiness,row.notes,at).run();
  await audit(env, reqId, 'tax_account', row.id, 'TAX_ACCOUNT_CREATED', { kind: row.kind });
  return row.id;
}

function purchaseNumbers(body) {
  const item = cents(body.itemPriceCents ?? 0, 'itemPriceCents');
  const protection = cents(body.buyerProtectionFeeCents ?? 0, 'buyerProtectionFeeCents');
  const platform = cents(body.platformFeeCents ?? 0, 'platformFeeCents');
  const shipping = cents(body.shippingCostCents ?? 0, 'shippingCostCents');
  const other = cents(body.otherCostCents ?? 0, 'otherCostCents');
  const calculated = item + protection + platform + shipping + other;
  const total = body.totalPaidCents == null ? calculated : cents(body.totalPaidCents, 'totalPaidCents');
  if (calculated !== total) throw new TaxReadyError('PURCHASE_TOTAL_MISMATCH', 422, { calculated, total });
  return { item, protection, platform, shipping, other, total };
}
async function createPurchase(request, env, reqId) {
  const body = await readJson(request), numbers = purchaseNumbers(body), at = now();
  const purchaseId = body.id ? id(body.id) : uuid('purchase');
  const paymentAccountId = optionalId(body.paymentAccountId, 'paymentAccountId');
  const fund = funding(body.fundingType);
  const purchaseDate = dateOnly(body.purchaseDate, 'purchaseDate', true);
  const paymentDate = dateOnly(body.paymentDate, 'paymentDate');
  const status = String(body.status || (paymentDate ? 'CONFIRMED' : 'REVIEW_REQUIRED')).toUpperCase();
  if (!['DRAFT','CONFIRMED','VOID','REVIEW_REQUIRED'].includes(status)) throw new TaxReadyError('INVALID_PURCHASE_STATUS', 422);
  const accountRow = await account(env, paymentAccountId);
  if (fund === 'PRIVATE_FUNDS' && (!accountRow || accountRow.kind !== 'PRIVATE_SOURCE')) {
    throw new TaxReadyError('PRIVATE_SOURCE_ACCOUNT_REQUIRED', 422);
  }
  if ((fund === 'BUSINESS_FUNDS' || fund === 'PRIVATE_FUNDS') && !paymentAccountId) throw new TaxReadyError('PAYMENT_ACCOUNT_REQUIRED', 422);
  const items = Array.isArray(body.items) ? body.items : [];
  if (!items.length) throw new TaxReadyError('PURCHASE_ITEMS_REQUIRED', 422);
  const itemRows = items.map((item, index) => ({
    id: item.id ? id(item.id, `items[${index}].id`) : uuid('purchase_item'),
    inventoryId: optionalId(item.inventoryId, `items[${index}].inventoryId`),
    itemId: item.itemId == null ? null : Number(item.itemId),
    articleNo: short(item.articleNo, 100), title: short(item.title, 250),
    quantity: Number(item.quantity ?? 1),
    allocatedItem: cents(item.allocatedItemPriceCents ?? 0, `items[${index}].allocatedItemPriceCents`),
    allocatedShared: cents(item.allocatedSharedCostCents ?? 0, `items[${index}].allocatedSharedCostCents`)
  }));
  if (itemRows.some(row => !Number.isSafeInteger(row.quantity) || row.quantity < 1)) throw new TaxReadyError('INVALID_PURCHASE_QUANTITY', 422);
  if (itemRows.some(row => !row.inventoryId && !Number.isSafeInteger(row.itemId) && !row.articleNo)) throw new TaxReadyError('PURCHASE_ITEM_IDENTITY_REQUIRED', 422);
  const allocated = itemRows.reduce((s,row) => s + row.allocatedItem + row.allocatedShared, 0);
  if (allocated !== numbers.total) throw new TaxReadyError('PURCHASE_ALLOCATION_MISMATCH', 422, { allocated, total: numbers.total });

  const statements = [env.DB.prepare(`INSERT INTO tax_purchases
    (id,source_platform,source_reference,seller_name,purchase_date,payment_date,currency,item_price_cents,
     buyer_protection_fee_cents,platform_fee_cents,shipping_cost_cents,other_cost_cents,total_paid_cents,
     payment_account_id,funding_type,status,primary_document_id,notes,created_at)
    VALUES (?,?,?,?,?,?,'EUR',?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
      purchaseId,short(body.sourcePlatform,80),short(body.sourceReference,160),short(body.sellerName,160),
      purchaseDate,paymentDate,numbers.item,numbers.protection,numbers.platform,numbers.shipping,numbers.other,numbers.total,
      paymentAccountId,fund,status,optionalId(body.primaryDocumentId,'primaryDocumentId'),short(body.notes,1000),at
    )];
  for (const row of itemRows) statements.push(env.DB.prepare(`INSERT INTO tax_purchase_items
    (id,purchase_id,inventory_id,item_id,article_no,title_snapshot,quantity,allocated_item_price_cents,allocated_shared_cost_cents,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).bind(row.id,purchaseId,row.inventoryId,Number.isSafeInteger(row.itemId)?row.itemId:null,row.articleNo,row.title,row.quantity,row.allocatedItem,row.allocatedShared,at));
  await env.DB.batch(statements);

  if (paymentDate && status !== 'VOID' && paymentAccountId && fund !== 'MIXED' && fund !== 'UNKNOWN') {
    await appendLedger(env, { accountId: paymentAccountId, eventType:'PURCHASE', direction:'OUT', amountCents:numbers.total,
      occurredAt:`${paymentDate}T12:00:00.000Z`, valueDate:paymentDate, purchaseId, reconciliationStatus:'MATCHED', notes:'Aus Einkauf automatisch erzeugt' });
    if (fund === 'PRIVATE_FUNDS') await appendLedger(env, { accountId: paymentAccountId, eventType:'OWNER_CONTRIBUTION', direction:'IN', amountCents:numbers.total,
      occurredAt:`${paymentDate}T12:00:00.000Z`, valueDate:paymentDate, purchaseId, reconciliationStatus:'MATCHED', notes:'Privat finanzierter betrieblicher Einkauf' });
  }
  await audit(env, reqId, 'tax_purchase', purchaseId, 'TAX_PURCHASE_CREATED', { fundingType:fund, totalPaidCents:numbers.total, items:itemRows.length });
  return purchaseId;
}
async function patchPurchase(request, env, reqId, purchaseId) {
  const body = await readJson(request);
  const old = await env.DB.prepare('SELECT * FROM tax_purchases WHERE id=?').bind(purchaseId).first();
  if (!old) throw new TaxReadyError('PURCHASE_NOT_FOUND', 404);
  const paymentDate = body.paymentDate === undefined ? old.payment_date : dateOnly(body.paymentDate,'paymentDate');
  const status = body.status === undefined ? old.status : String(body.status).toUpperCase();
  if (!['DRAFT','CONFIRMED','VOID','REVIEW_REQUIRED'].includes(status)) throw new TaxReadyError('INVALID_PURCHASE_STATUS',422);
  const notes = body.notes === undefined ? old.notes : short(body.notes,1000);
  const documentId = body.primaryDocumentId === undefined ? old.primary_document_id : optionalId(body.primaryDocumentId,'primaryDocumentId');
  await env.DB.prepare('UPDATE tax_purchases SET payment_date=?,status=?,primary_document_id=?,notes=?,updated_at=? WHERE id=?')
    .bind(paymentDate,status,documentId,notes,now(),purchaseId).run();
  await audit(env, reqId, 'tax_purchase', purchaseId, 'TAX_PURCHASE_UPDATED', { paymentDate,status });
  return purchaseId;
}

async function createExpense(request, env, reqId) {
  const body = await readJson(request), at = now();
  const expenseId = body.id ? id(body.id) : uuid('expense');
  const category = String(body.category || 'OTHER').toUpperCase().replace(/[^A-Z0-9_]/g,'').slice(0,60) || 'OTHER';
  const amount = cents(body.amountCents,'amountCents',false);
  const fund = funding(body.fundingType);
  const paymentAccountId = optionalId(body.paymentAccountId,'paymentAccountId');
  const accountRow = await account(env,paymentAccountId);
  if (fund === 'PRIVATE_FUNDS' && (!accountRow || accountRow.kind !== 'PRIVATE_SOURCE')) throw new TaxReadyError('PRIVATE_SOURCE_ACCOUNT_REQUIRED',422);
  if ((fund === 'BUSINESS_FUNDS'||fund === 'PRIVATE_FUNDS')&&!paymentAccountId) throw new TaxReadyError('PAYMENT_ACCOUNT_REQUIRED',422);
  const paymentDate = dateOnly(body.paymentDate,'paymentDate');
  const incurred = dateOnly(body.incurredDate,'incurredDate',true);
  const status = String(body.status || (paymentDate ? 'CONFIRMED' : 'REVIEW_REQUIRED')).toUpperCase();
  if (!['DRAFT','CONFIRMED','VOID','REVIEW_REQUIRED'].includes(status)) throw new TaxReadyError('INVALID_EXPENSE_STATUS',422);
  await env.DB.prepare(`INSERT INTO tax_expense_events
    (id,category,description,incurred_date,payment_date,amount_cents,currency,payment_account_id,funding_type,document_id,status,notes,created_at)
    VALUES (?,?,?,?,?,?,'EUR',?,?,?,?,?,?)`).bind(expenseId,category,short(body.description,300),incurred,paymentDate,amount,paymentAccountId,fund,
      optionalId(body.documentId,'documentId'),status,short(body.notes,1000),at).run();
  if (paymentDate && status !== 'VOID' && paymentAccountId && fund !== 'MIXED' && fund !== 'UNKNOWN') {
    const eventType = EXPENSE_EVENT_BY_CATEGORY[category] || 'OTHER_EXPENSE';
    await appendLedger(env,{accountId:paymentAccountId,eventType,direction:'OUT',amountCents:amount,occurredAt:`${paymentDate}T12:00:00.000Z`,valueDate:paymentDate,expenseId,reconciliationStatus:'MATCHED',notes:'Aus Betriebsausgabe automatisch erzeugt'});
    if (fund === 'PRIVATE_FUNDS') await appendLedger(env,{accountId:paymentAccountId,eventType:'OWNER_CONTRIBUTION',direction:'IN',amountCents:amount,occurredAt:`${paymentDate}T12:00:00.000Z`,valueDate:paymentDate,expenseId,reconciliationStatus:'MATCHED',notes:'Privat finanzierte Betriebsausgabe'});
  }
  await audit(env,reqId,'tax_expense',expenseId,'TAX_EXPENSE_CREATED',{category,amountCents:amount,fundingType:fund});
  return expenseId;
}

async function createDocument(request, env, reqId) {
  const body = await readJson(request), documentId = body.id ? id(body.id) : uuid('doc');
  const hash = String(body.sha256 || '').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new TaxReadyError('INVALID_DOCUMENT_SHA256',422);
  const storageState = String(body.storageState || 'METADATA_ONLY').toUpperCase();
  if (!['METADATA_ONLY','ARCHIVED','MISSING','REVIEW_REQUIRED'].includes(storageState)) throw new TaxReadyError('INVALID_DOCUMENT_STORAGE_STATE',422);
  const storageKey = short(body.storageKey,500);
  if (storageState === 'ARCHIVED' && !storageKey) throw new TaxReadyError('ARCHIVED_DOCUMENT_REQUIRES_STORAGE_KEY',422);
  await env.DB.prepare(`INSERT INTO tax_documents
    (id,document_type,original_filename,mime_type,byte_length,sha256,storage_state,storage_key,source_reference,notes,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).bind(documentId,short(body.documentType,80)||'OTHER',short(body.originalFilename,260)||'document',short(body.mimeType,120)||'application/octet-stream',
      cents(body.byteLength,'byteLength'),hash,storageState,storageKey,short(body.sourceReference,200),short(body.notes,1000),now()).run();
  await audit(env,reqId,'tax_document',documentId,'TAX_DOCUMENT_REGISTERED',{storageState,sha256:hash});
  return documentId;
}

async function createCashEvent(request, env, reqId) {
  const body = await readJson(request), eventType = String(body.eventType || 'UNKNOWN').toUpperCase();
  if (!LEDGER_TYPES.has(eventType)) throw new TaxReadyError('INVALID_LEDGER_EVENT_TYPE',422);
  if (eventType === 'ACCOUNT_TRANSFER') {
    const from = id(body.accountId,'accountId'), to = id(body.counterpartyAccountId,'counterpartyAccountId');
    if (from === to) throw new TaxReadyError('TRANSFER_ACCOUNTS_MUST_DIFFER',422);
    await Promise.all([account(env,from),account(env,to)]);
    const amount = cents(body.amountCents,'amountCents',false), occurredAt = timestamp(body.occurredAt,'occurredAt',true);
    const group = body.transferGroupId ? id(body.transferGroupId,'transferGroupId') : uuid('transfer');
    const outId = await appendLedger(env,{accountId:from,eventType,direction:'OUT',amountCents:amount,occurredAt,provider:short(body.provider,80),providerReference:short(body.providerReference,160),transferGroupId:group,reconciliationStatus:'MATCHED',notes:short(body.notes,1000)});
    const inId = await appendLedger(env,{accountId:to,eventType,direction:'IN',amountCents:amount,occurredAt,transferGroupId:group,reconciliationStatus:'MATCHED',notes:short(body.notes,1000)});
    await audit(env,reqId,'tax_transfer',group,'TAX_ACCOUNT_TRANSFER_RECORDED',{from,to,amountCents:amount,outId,inId});
    return { ids:[outId,inId],transferGroupId:group };
  }
  const accountId = id(body.accountId,'accountId'); await account(env,accountId);
  const direction = String(body.direction || '').toUpperCase();
  if (!['IN','OUT'].includes(direction)) throw new TaxReadyError('INVALID_LEDGER_DIRECTION',422);
  const eventId = await appendLedger(env,{accountId,eventType,direction,amountCents:cents(body.amountCents,'amountCents',false),occurredAt:timestamp(body.occurredAt,'occurredAt'),valueDate:dateOnly(body.valueDate,'valueDate'),provider:short(body.provider,80),providerReference:short(body.providerReference,160),orderId:optionalId(body.orderId,'orderId'),paymentId:optionalId(body.paymentId,'paymentId'),refundId:optionalId(body.refundId,'refundId'),purchaseId:optionalId(body.purchaseId,'purchaseId'),expenseId:optionalId(body.expenseId,'expenseId'),inventoryId:optionalId(body.inventoryId,'inventoryId'),documentId:optionalId(body.documentId,'documentId'),reconciliationStatus:String(body.reconciliationStatus||'UNRECONCILED').toUpperCase(),notes:short(body.notes,1000)});
  await audit(env,reqId,'tax_cash_event',eventId,'TAX_CASH_EVENT_RECORDED',{eventType,direction});
  return { ids:[eventId] };
}

async function reconcile(request, env, reqId) {
  const body = await readJson(request), reconciliationId = body.id ? id(body.id) : uuid('recon');
  const cashEventId = id(body.cashEventId,'cashEventId');
  const event = await env.DB.prepare('SELECT id FROM tax_ledger_events WHERE id=?').bind(cashEventId).first();
  if (!event) throw new TaxReadyError('CASH_EVENT_NOT_FOUND',404);
  const entityType = String(body.matchedEntityType || '').toUpperCase();
  if (!['ORDER','PAYMENT','REFUND','PURCHASE','EXPENSE','TRANSFER','DOCUMENT','OTHER'].includes(entityType)) throw new TaxReadyError('INVALID_RECONCILIATION_ENTITY',422);
  const status = String(body.status || 'MATCHED').toUpperCase();
  if (!['MATCHED','REVIEW_REQUIRED','REJECTED'].includes(status)) throw new TaxReadyError('INVALID_RECONCILIATION_STATUS',422);
  await env.DB.prepare(`INSERT INTO tax_reconciliations
    (id,cash_event_id,matched_entity_type,matched_entity_id,status,notes,created_at) VALUES (?,?,?,?,?,?,?)`)
    .bind(reconciliationId,cashEventId,entityType,id(body.matchedEntityId,'matchedEntityId'),status,short(body.notes,1000),now()).run();
  await audit(env,reqId,'tax_reconciliation',reconciliationId,'TAX_RECONCILIATION_RECORDED',{cashEventId,entityType,status});
  return reconciliationId;
}

async function putTaxProfile(request, env, reqId, year) {
  const body = await readJson(request), vatMode = String(body.vatMode || 'UNKNOWN').toUpperCase();
  if (!VAT_MODES.has(vatMode)) throw new TaxReadyError('INVALID_VAT_MODE',422);
  const confirmed = body.confirmed === true ? 1 : 0;
  const prior = body.priorYearLimitCents == null ? null : cents(body.priorYearLimitCents,'priorYearLimitCents',false);
  const current = body.currentYearLimitCents == null ? null : cents(body.currentYearLimitCents,'currentYearLimitCents',false);
  const warning = body.warningRatioBasisPoints == null ? 8000 : Number(body.warningRatioBasisPoints);
  if (!Number.isInteger(warning) || warning < 1 || warning > 10000) throw new TaxReadyError('INVALID_WARNING_RATIO',422);
  await env.DB.prepare(`INSERT INTO tax_year_profiles
    (tax_year,vat_mode,confirmed,prior_year_limit_cents,current_year_limit_cents,warning_ratio_basis_points,notes,updated_at)
    VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(tax_year) DO UPDATE SET
      vat_mode=excluded.vat_mode,confirmed=excluded.confirmed,prior_year_limit_cents=excluded.prior_year_limit_cents,
      current_year_limit_cents=excluded.current_year_limit_cents,warning_ratio_basis_points=excluded.warning_ratio_basis_points,
      notes=excluded.notes,updated_at=excluded.updated_at`).bind(year,vatMode,confirmed,prior,current,warning,short(body.notes,1000),now()).run();
  await audit(env,reqId,'tax_year_profile',String(year),'TAX_YEAR_PROFILE_UPDATED',{vatMode,confirmed:Boolean(confirmed)});
}

function parseYear(value) {
  const year = Number(value);
  if (!Number.isInteger(year) || year < 2020 || year > 2100) throw new TaxReadyError('INVALID_TAX_YEAR',422);
  return year;
}

export function isTaxReadyRoute(url) {
  const p = url.pathname.replace(/\/+$/,'');
  if (p === '/admin/buchhaltung/datensatz.zip' && url.searchParams.get('format') === 'v3') return true;
  return p === '/admin/buchhaltung/datensatz-v3.zip'
    || /^\/admin\/buchhaltung\/(einkaeufe|ausgaben|konten|cash-events|belege)(?:\/[^/]+)?$/.test(p)
    || p === '/admin/buchhaltung/reconcile'
    || /^\/admin\/buchhaltung\/(steuercheck|steuerprofil)\/\d{4}$/.test(p);
}

export async function handleTaxReady2026(request, env, url, reqId = crypto.randomUUID(), origin = null) {
  try {
    if (request.method === 'OPTIONS') {
      if (origin && !ADMIN_ORIGINS.has(origin)) return new Response(null,{status:403,headers:headers(null)});
      return new Response(null,{status:204,headers:headers(origin)});
    }
    if (origin && !ADMIN_ORIGINS.has(origin)) throw new TaxReadyError('ORIGIN_NOT_ALLOWED',403);
    await requireAdmin(request,env);
    if (!env.DB) throw new TaxReadyError('COMMERCE_DATABASE_NOT_CONFIGURED',503);
    const p = url.pathname.replace(/\/+$/,'');

    if ((p === '/admin/buchhaltung/datensatz-v3.zip' || (p === '/admin/buchhaltung/datensatz.zip' && url.searchParams.get('format') === 'v3')) && request.method === 'GET') {
      const year = parseYear(url.searchParams.get('jahr') || new Date().getUTCFullYear());
      const dataset = await prepareTaxDatasetV3(env,year);
      return binary(dataset.stream(),'application/zip',`disorder119-tax-dataset-v3-${year}.zip`,origin);
    }

    if (p === '/admin/buchhaltung/konten') {
      if (request.method === 'GET') return json({ok:true,accounts:await listAccounts(env)},200,origin);
      if (request.method === 'POST') return json({ok:true,id:await createAccount(request,env,reqId)},201,origin);
    }
    if (p === '/admin/buchhaltung/einkaeufe') {
      if (request.method === 'GET') {
        const rows=(await env.DB.prepare('SELECT * FROM tax_purchases ORDER BY COALESCE(payment_date,purchase_date) DESC,id DESC').all())?.results||[];
        return json({ok:true,purchases:rows},200,origin);
      }
      if (request.method === 'POST') return json({ok:true,id:await createPurchase(request,env,reqId)},201,origin);
    }
    const purchaseMatch=/^\/admin\/buchhaltung\/einkaeufe\/([^/]+)$/.exec(p);
    if (purchaseMatch && request.method === 'PATCH') return json({ok:true,id:await patchPurchase(request,env,reqId,decodeURIComponent(purchaseMatch[1]))},200,origin);

    if (p === '/admin/buchhaltung/ausgaben') {
      if (request.method === 'GET') {
        const rows=(await env.DB.prepare('SELECT * FROM tax_expense_events ORDER BY COALESCE(payment_date,incurred_date) DESC,id DESC').all())?.results||[];
        return json({ok:true,expenses:rows},200,origin);
      }
      if (request.method === 'POST') return json({ok:true,id:await createExpense(request,env,reqId)},201,origin);
    }
    if (p === '/admin/buchhaltung/cash-events') {
      if (request.method === 'GET') {
        const rows=(await env.DB.prepare('SELECT * FROM tax_ledger_events ORDER BY COALESCE(occurred_at,value_date,created_at) DESC,id DESC').all())?.results||[];
        return json({ok:true,cashEvents:rows},200,origin);
      }
      if (request.method === 'POST') return json({ok:true,...await createCashEvent(request,env,reqId)},201,origin);
    }
    if (p === '/admin/buchhaltung/belege') {
      if (request.method === 'GET') {
        const rows=(await env.DB.prepare('SELECT * FROM tax_documents ORDER BY created_at DESC,id DESC').all())?.results||[];
        return json({ok:true,documents:rows,note:'Nur Belegmetadaten. storage_state=ARCHIVED ist nur mit privatem storage_key zulässig; öffentliche GitHub-Dateien sind kein Belegarchiv.'},200,origin);
      }
      if (request.method === 'POST') return json({ok:true,id:await createDocument(request,env,reqId)},201,origin);
    }
    if (p === '/admin/buchhaltung/reconcile' && request.method === 'POST') return json({ok:true,id:await reconcile(request,env,reqId)},201,origin);

    const profileMatch=/^\/admin\/buchhaltung\/steuerprofil\/(\d{4})$/.exec(p);
    if (profileMatch) {
      const year=parseYear(profileMatch[1]);
      if (request.method === 'GET') return json({ok:true,profile:await env.DB.prepare('SELECT * FROM tax_year_profiles WHERE tax_year=?').bind(year).first()},200,origin);
      if (request.method === 'PUT') { await putTaxProfile(request,env,reqId,year); return json({ok:true,profile:await env.DB.prepare('SELECT * FROM tax_year_profiles WHERE tax_year=?').bind(year).first()},200,origin); }
    }
    const checkMatch=/^\/admin\/buchhaltung\/steuercheck\/(\d{4})$/.exec(p);
    if (checkMatch && request.method === 'GET') {
      const year=parseYear(checkMatch[1]),dataset=await prepareTaxDatasetV3(env,year);
      return json({ok:true,year,summary:dataset.summary,issues:dataset.issues,reviewRequired:true,note:'Technischer Vollständigkeitscheck, keine steuerliche Freigabe.'},200,origin);
    }

    throw new TaxReadyError('METHOD_NOT_ALLOWED_OR_ROUTE_NOT_FOUND', request.method === 'GET' ? 404 : 405);
  } catch (err) {
    if (err instanceof TaxReadyError) return json({error:err.code,details:err.details,requestId:reqId},err.status,origin);
    if (String(err?.message || '').includes('UNIQUE constraint failed')) return json({error:'DUPLICATE_ACCOUNTING_RECORD',requestId:reqId},409,origin);
    console.error(JSON.stringify({level:'error',event:'tax_ready_2026_error',requestId:reqId,message:safeText(err?.message||'unknown',180)}));
    return json({error:'INTERNAL_TAX_READY_ERROR',requestId:reqId},500,origin);
  }
}

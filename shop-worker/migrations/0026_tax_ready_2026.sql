-- Tax Ready 2026: private accounting source data.
-- This migration is additive. Existing commerce/tax-evidence tables remain unchanged.
-- No table created here is exposed by public shop APIs.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS tax_accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN (
    'BUSINESS_BANK','VINTED_WALLET','PAYPAL','CASH','PRIVATE_SOURCE','OTHER'
  )),
  currency TEXT NOT NULL DEFAULT 'EUR' CHECK (currency='EUR'),
  is_business INTEGER NOT NULL DEFAULT 1 CHECK (is_business IN (0,1)),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_tax_accounts_kind ON tax_accounts(kind, active);

CREATE TABLE IF NOT EXISTS tax_documents (
  id TEXT PRIMARY KEY,
  document_type TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  byte_length INTEGER NOT NULL CHECK (byte_length >= 0),
  sha256 TEXT NOT NULL CHECK (length(sha256)=64),
  storage_state TEXT NOT NULL DEFAULT 'METADATA_ONLY' CHECK (storage_state IN (
    'METADATA_ONLY','ARCHIVED','MISSING','REVIEW_REQUIRED'
  )),
  storage_key TEXT,
  source_reference TEXT,
  notes TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tax_documents_hash ON tax_documents(sha256);
CREATE INDEX IF NOT EXISTS idx_tax_documents_source ON tax_documents(source_reference);

CREATE TABLE IF NOT EXISTS tax_purchases (
  id TEXT PRIMARY KEY,
  source_platform TEXT,
  source_reference TEXT,
  seller_name TEXT,
  purchase_date TEXT NOT NULL,
  payment_date TEXT,
  currency TEXT NOT NULL DEFAULT 'EUR' CHECK (currency='EUR'),
  item_price_cents INTEGER NOT NULL DEFAULT 0 CHECK (item_price_cents >= 0),
  buyer_protection_fee_cents INTEGER NOT NULL DEFAULT 0 CHECK (buyer_protection_fee_cents >= 0),
  platform_fee_cents INTEGER NOT NULL DEFAULT 0 CHECK (platform_fee_cents >= 0),
  shipping_cost_cents INTEGER NOT NULL DEFAULT 0 CHECK (shipping_cost_cents >= 0),
  other_cost_cents INTEGER NOT NULL DEFAULT 0 CHECK (other_cost_cents >= 0),
  total_paid_cents INTEGER NOT NULL CHECK (total_paid_cents >= 0),
  payment_account_id TEXT REFERENCES tax_accounts(id),
  funding_type TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK (funding_type IN (
    'BUSINESS_FUNDS','PRIVATE_FUNDS','MIXED','UNKNOWN'
  )),
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','CONFIRMED','VOID','REVIEW_REQUIRED')),
  primary_document_id TEXT REFERENCES tax_documents(id),
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_tax_purchase_source
  ON tax_purchases(source_platform, source_reference)
  WHERE source_platform IS NOT NULL AND source_reference IS NOT NULL AND source_reference!='';
CREATE INDEX IF NOT EXISTS idx_tax_purchases_payment_date ON tax_purchases(payment_date);
CREATE INDEX IF NOT EXISTS idx_tax_purchases_funding ON tax_purchases(funding_type, status);

CREATE TABLE IF NOT EXISTS tax_purchase_items (
  id TEXT PRIMARY KEY,
  purchase_id TEXT NOT NULL REFERENCES tax_purchases(id),
  inventory_id TEXT REFERENCES inventory(id),
  item_id INTEGER,
  article_no TEXT,
  title_snapshot TEXT,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  allocated_item_price_cents INTEGER NOT NULL DEFAULT 0 CHECK (allocated_item_price_cents >= 0),
  allocated_shared_cost_cents INTEGER NOT NULL DEFAULT 0 CHECK (allocated_shared_cost_cents >= 0),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tax_purchase_items_purchase ON tax_purchase_items(purchase_id);
CREATE INDEX IF NOT EXISTS idx_tax_purchase_items_inventory ON tax_purchase_items(inventory_id);
CREATE INDEX IF NOT EXISTS idx_tax_purchase_items_item ON tax_purchase_items(item_id);

CREATE TABLE IF NOT EXISTS tax_expense_events (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  description TEXT,
  incurred_date TEXT NOT NULL,
  payment_date TEXT,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  currency TEXT NOT NULL DEFAULT 'EUR' CHECK (currency='EUR'),
  payment_account_id TEXT REFERENCES tax_accounts(id),
  funding_type TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK (funding_type IN (
    'BUSINESS_FUNDS','PRIVATE_FUNDS','MIXED','UNKNOWN'
  )),
  document_id TEXT REFERENCES tax_documents(id),
  status TEXT NOT NULL DEFAULT 'CONFIRMED' CHECK (status IN ('DRAFT','CONFIRMED','VOID','REVIEW_REQUIRED')),
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_tax_expenses_payment_date ON tax_expense_events(payment_date);
CREATE INDEX IF NOT EXISTS idx_tax_expenses_category ON tax_expense_events(category, status);

-- General cash ledger. Provider-specific immutable evidence stays in tax_cash_events.
-- amount_cents is always positive; direction defines the sign.
CREATE TABLE IF NOT EXISTS tax_ledger_events (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES tax_accounts(id),
  event_type TEXT NOT NULL CHECK (event_type IN (
    'SALE_INCOME','OTHER_INCOME','PURCHASE','PLATFORM_FEE','PAYMENT_FEE',
    'SHIPPING_EXPENSE','ADVERTISING','SOFTWARE','PACKAGING','REFUND_IN','REFUND_OUT',
    'OWNER_CONTRIBUTION','OWNER_DRAW','ACCOUNT_TRANSFER','OTHER_EXPENSE','OTHER','UNKNOWN'
  )),
  direction TEXT NOT NULL CHECK (direction IN ('IN','OUT')),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  currency TEXT NOT NULL DEFAULT 'EUR' CHECK (currency='EUR'),
  occurred_at TEXT,
  value_date TEXT,
  provider TEXT,
  provider_reference TEXT,
  transfer_group_id TEXT,
  order_id TEXT REFERENCES commerce_orders(id),
  payment_id TEXT REFERENCES payments(id),
  refund_id TEXT REFERENCES refunds(id),
  purchase_id TEXT REFERENCES tax_purchases(id),
  expense_id TEXT REFERENCES tax_expense_events(id),
  inventory_id TEXT REFERENCES inventory(id),
  document_id TEXT REFERENCES tax_documents(id),
  reconciliation_status TEXT NOT NULL DEFAULT 'UNRECONCILED' CHECK (reconciliation_status IN (
    'UNRECONCILED','MATCHED','IGNORED','REVIEW_REQUIRED'
  )),
  notes TEXT,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_tax_ledger_provider_ref
  ON tax_ledger_events(provider, provider_reference, event_type)
  WHERE provider IS NOT NULL AND provider_reference IS NOT NULL AND provider_reference!='';
CREATE INDEX IF NOT EXISTS idx_tax_ledger_date ON tax_ledger_events(occurred_at, value_date);
CREATE INDEX IF NOT EXISTS idx_tax_ledger_account ON tax_ledger_events(account_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_tax_ledger_transfer ON tax_ledger_events(transfer_group_id);
CREATE INDEX IF NOT EXISTS idx_tax_ledger_reconcile ON tax_ledger_events(reconciliation_status);

CREATE TABLE IF NOT EXISTS tax_reconciliations (
  id TEXT PRIMARY KEY,
  cash_event_id TEXT NOT NULL REFERENCES tax_ledger_events(id),
  matched_entity_type TEXT NOT NULL CHECK (matched_entity_type IN (
    'ORDER','PAYMENT','REFUND','PURCHASE','EXPENSE','TRANSFER','DOCUMENT','OTHER'
  )),
  matched_entity_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('MATCHED','REVIEW_REQUIRED','REJECTED')),
  notes TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(cash_event_id, matched_entity_type, matched_entity_id)
);
CREATE INDEX IF NOT EXISTS idx_tax_reconciliation_event ON tax_reconciliations(cash_event_id, status);

CREATE TABLE IF NOT EXISTS tax_classifications (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL CHECK (entity_type IN (
    'ORDER','PAYMENT','REFUND','PURCHASE','EXPENSE','CASH_EVENT','DOCUMENT','INVENTORY'
  )),
  entity_id TEXT NOT NULL,
  tax_year INTEGER NOT NULL CHECK (tax_year BETWEEN 2020 AND 2100),
  classification TEXT NOT NULL,
  review_status TEXT NOT NULL DEFAULT 'REVIEW_REQUIRED' CHECK (review_status IN (
    'REVIEW_REQUIRED','CONFIRMED','EXCLUDED'
  )),
  reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT,
  UNIQUE(entity_type, entity_id, tax_year)
);
CREATE INDEX IF NOT EXISTS idx_tax_classifications_year ON tax_classifications(tax_year, review_status);

-- Per-year tax settings are explicit facts, never inferred from turnover alone.
CREATE TABLE IF NOT EXISTS tax_year_profiles (
  tax_year INTEGER PRIMARY KEY CHECK (tax_year BETWEEN 2020 AND 2100),
  vat_mode TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK (vat_mode IN (
    'KLEINUNTERNEHMER','REGELBESTEUERUNG','UNKNOWN'
  )),
  confirmed INTEGER NOT NULL DEFAULT 0 CHECK (confirmed IN (0,1)),
  prior_year_limit_cents INTEGER CHECK (prior_year_limit_cents IS NULL OR prior_year_limit_cents > 0),
  current_year_limit_cents INTEGER CHECK (current_year_limit_cents IS NULL OR current_year_limit_cents > 0),
  warning_ratio_basis_points INTEGER NOT NULL DEFAULT 8000 CHECK (warning_ratio_basis_points BETWEEN 1 AND 10000),
  notes TEXT,
  updated_at TEXT NOT NULL
);

-- Financial evidence is retained. Corrections are represented by status/reversal records,
-- not destructive deletes.
CREATE TRIGGER IF NOT EXISTS tax_purchases_no_delete BEFORE DELETE ON tax_purchases
BEGIN SELECT RAISE(ABORT,'tax_purchase_must_be_retained'); END;
CREATE TRIGGER IF NOT EXISTS tax_purchase_items_no_delete BEFORE DELETE ON tax_purchase_items
BEGIN SELECT RAISE(ABORT,'tax_purchase_item_must_be_retained'); END;
CREATE TRIGGER IF NOT EXISTS tax_expenses_no_delete BEFORE DELETE ON tax_expense_events
BEGIN SELECT RAISE(ABORT,'tax_expense_must_be_retained'); END;
CREATE TRIGGER IF NOT EXISTS tax_ledger_events_no_update BEFORE UPDATE ON tax_ledger_events
BEGIN SELECT RAISE(ABORT,'tax_ledger_event_is_immutable'); END;
CREATE TRIGGER IF NOT EXISTS tax_ledger_events_no_delete BEFORE DELETE ON tax_ledger_events
BEGIN SELECT RAISE(ABORT,'tax_ledger_event_must_be_retained'); END;
CREATE TRIGGER IF NOT EXISTS tax_documents_no_update BEFORE UPDATE ON tax_documents
BEGIN SELECT RAISE(ABORT,'tax_document_metadata_is_immutable'); END;
CREATE TRIGGER IF NOT EXISTS tax_documents_no_delete BEFORE DELETE ON tax_documents
BEGIN SELECT RAISE(ABORT,'tax_document_must_be_retained'); END;
CREATE TRIGGER IF NOT EXISTS tax_reconciliations_no_update BEFORE UPDATE ON tax_reconciliations
BEGIN SELECT RAISE(ABORT,'tax_reconciliation_is_immutable'); END;
CREATE TRIGGER IF NOT EXISTS tax_reconciliations_no_delete BEFORE DELETE ON tax_reconciliations
BEGIN SELECT RAISE(ABORT,'tax_reconciliation_must_be_retained'); END;

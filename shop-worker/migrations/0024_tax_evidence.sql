-- Append-only payment evidence. Never backfill provider dates from order dates.
CREATE TABLE IF NOT EXISTS tax_cash_events (
  id TEXT PRIMARY KEY,
  payment_id TEXT NOT NULL REFERENCES payments(id),
  order_id TEXT NOT NULL REFERENCES commerce_orders(id),
  kind TEXT NOT NULL CHECK(kind IN ('capture','refund','fee')),
  provider TEXT NOT NULL,
  provider_reference TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK(amount_cents>0),
  currency TEXT NOT NULL,
  occurred_at TEXT,
  observed_at TEXT NOT NULL,
  evidence_hash TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  UNIQUE(provider,kind,provider_reference)
);
CREATE TRIGGER IF NOT EXISTS tax_cash_events_no_update BEFORE UPDATE ON tax_cash_events
BEGIN SELECT RAISE(ABORT,'tax_evidence_is_immutable'); END;
-- Also reject conflicting concurrent retries; INSERT OR IGNORE alone is unsafe.
CREATE TRIGGER IF NOT EXISTS tax_cash_events_conflict BEFORE INSERT ON tax_cash_events
WHEN EXISTS(SELECT 1 FROM tax_cash_events old WHERE old.id=NEW.id AND
  (old.payment_id!=NEW.payment_id OR old.order_id!=NEW.order_id OR old.kind!=NEW.kind OR
   old.provider!=NEW.provider OR old.provider_reference!=NEW.provider_reference OR
   old.amount_cents!=NEW.amount_cents OR old.currency!=NEW.currency OR old.occurred_at IS NOT NEW.occurred_at))
BEGIN SELECT RAISE(ABORT,'conflicting_tax_evidence'); END;
CREATE TRIGGER IF NOT EXISTS tax_cash_events_no_delete BEFORE DELETE ON tax_cash_events
BEGIN SELECT RAISE(ABORT,'tax_evidence_must_be_retained'); END;
ALTER TABLE rechnungen ADD COLUMN document_type TEXT NOT NULL DEFAULT 'legacy_unverified';
ALTER TABLE rechnungen ADD COLUMN html_sha256 TEXT;
ALTER TABLE rechnungen ADD COLUMN tax_profile_json TEXT;
CREATE TABLE IF NOT EXISTS order_confirmation_archive (
  order_id TEXT PRIMARY KEY REFERENCES commerce_orders(id),
  subject TEXT NOT NULL, html TEXT NOT NULL, text TEXT NOT NULL,
  html_sha256 TEXT NOT NULL, text_sha256 TEXT NOT NULL,
  invoice_json TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS order_confirmation_no_update BEFORE UPDATE ON order_confirmation_archive
BEGIN SELECT RAISE(ABORT,'confirmation_is_immutable'); END;
CREATE TRIGGER IF NOT EXISTS order_confirmation_no_delete BEFORE DELETE ON order_confirmation_archive
BEGIN SELECT RAISE(ABORT,'confirmation_must_be_retained'); END;

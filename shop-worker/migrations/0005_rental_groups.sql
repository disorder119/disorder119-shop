-- Disorder119 atomic multi-item rental groups.
-- Apply after 0004_admin_operations.sql.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS rental_groups (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('BUILDING','RESERVED','PAYMENT_PENDING','CONFIRMED','ACTIVE','RETURN_DUE','RETURNED','CANCELLED','REFUNDED')),
  item_count INTEGER NOT NULL CHECK (item_count BETWEEN 1 AND 20),
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  days INTEGER NOT NULL CHECK (days BETWEEN 1 AND 366),
  rental_total_cents INTEGER CHECK (rental_total_cents IS NULL OR rental_total_cents >= 0),
  deposit_total_cents INTEGER CHECK (deposit_total_cents IS NULL OR deposit_total_cents >= 0),
  currency TEXT NOT NULL DEFAULT 'EUR' CHECK (currency='EUR'),
  price_on_request INTEGER NOT NULL DEFAULT 0 CHECK (price_on_request IN (0,1)),
  purpose TEXT,
  message TEXT,
  delivery_method TEXT CHECK (delivery_method IS NULL OR delivery_method IN ('shipping','pickup')),
  postal_text TEXT,
  risk_notes TEXT,
  terms_version TEXT,
  terms_language TEXT,
  terms_accepted_at TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_rental_groups_status_created ON rental_groups(status, created_at);
CREATE INDEX IF NOT EXISTS idx_rental_groups_dates ON rental_groups(start_date, end_date, status);

-- A bundle becomes RESERVED only when every expected child reservation exists.
-- Because the final status change is part of the same D1 batch as the child
-- inserts, a mismatch aborts and rolls back the complete bundle.
CREATE TRIGGER IF NOT EXISTS trg_rental_group_complete_before_reserve
BEFORE UPDATE OF status ON rental_groups
FOR EACH ROW
WHEN NEW.status='RESERVED' AND OLD.status='BUILDING' AND (
  (SELECT COUNT(*) FROM rental_reservations rr WHERE rr.group_id=NEW.id) <> NEW.item_count
)
BEGIN
  SELECT RAISE(ABORT, 'rental_group_incomplete');
END;

-- Protect authoritative bundle totals after the child rows have been created.
CREATE TRIGGER IF NOT EXISTS trg_rental_group_totals_before_reserve
BEFORE UPDATE OF status ON rental_groups
FOR EACH ROW
WHEN NEW.status='RESERVED' AND OLD.status='BUILDING' AND (
  (NEW.price_on_request=0 AND (
    NEW.rental_total_cents IS NULL OR
    NEW.deposit_total_cents IS NULL OR
    NEW.rental_total_cents <> COALESCE((SELECT SUM(rr.total_price_cents) FROM rental_reservations rr WHERE rr.group_id=NEW.id),0) OR
    NEW.deposit_total_cents <> COALESCE((SELECT SUM(rr.deposit_cents) FROM rental_reservations rr WHERE rr.group_id=NEW.id),0)
  )) OR
  (NEW.price_on_request=1 AND NEW.rental_total_cents IS NOT NULL)
)
BEGIN
  SELECT RAISE(ABORT, 'invalid_rental_group_totals');
END;

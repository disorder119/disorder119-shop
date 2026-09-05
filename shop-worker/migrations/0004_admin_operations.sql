-- Disorder119 admin operations / observability foundation.
-- Apply after 0003_state_integrity.sql.
-- Keeps operational and customer data in private Cloudflare D1 only.
PRAGMA foreign_keys = ON;

-- Rental V2 metadata is snapshotted server-side after the reservation succeeds.
-- The deposit is a snapshot of the rule at request time, not a recalculation
-- from a future catalogue price.
ALTER TABLE rental_reservations ADD COLUMN group_id TEXT;
ALTER TABLE rental_reservations ADD COLUMN deposit_cents INTEGER CHECK (deposit_cents IS NULL OR deposit_cents >= 0);
ALTER TABLE rental_reservations ADD COLUMN delivery_method TEXT CHECK (delivery_method IS NULL OR delivery_method IN ('shipping','pickup'));
ALTER TABLE rental_reservations ADD COLUMN postal_text TEXT;
ALTER TABLE rental_reservations ADD COLUMN risk_notes TEXT;
ALTER TABLE rental_reservations ADD COLUMN terms_version TEXT;
ALTER TABLE rental_reservations ADD COLUMN terms_language TEXT;
ALTER TABLE rental_reservations ADD COLUMN terms_accepted_at TEXT;

CREATE INDEX IF NOT EXISTS idx_rental_group ON rental_reservations(group_id, created_at);
CREATE INDEX IF NOT EXISTS idx_rental_status_created ON rental_reservations(status, created_at);

-- A confirmed reservation becomes a durable rental record. Keeping this at the
-- database layer prevents a future admin/client path from forgetting to create
-- the operational rental entity used by returns, refunds and deposit tracking.
CREATE TRIGGER IF NOT EXISTS trg_rental_materialize_on_confirm
AFTER UPDATE OF status ON rental_reservations
FOR EACH ROW
WHEN OLD.status <> NEW.status AND NEW.status = 'CONFIRMED'
BEGIN
  INSERT OR IGNORE INTO rentals
    (id,rental_reservation_id,inventory_id,status,deposit_cents,started_at,due_at,returned_at,created_at,updated_at)
  VALUES
    ('rent_' || lower(hex(randomblob(16))),NEW.id,NEW.inventory_id,'CONFIRMED',NEW.deposit_cents,NULL,NEW.end_date,NULL,COALESCE(NEW.updated_at,NEW.created_at),NEW.updated_at);
END;

-- Once materialized, keep the durable rental record synchronized with the
-- reservation state. RESERVED/PAYMENT_PENDING intentionally have no rentals row.
CREATE TRIGGER IF NOT EXISTS trg_rental_record_status_sync
AFTER UPDATE OF status ON rental_reservations
FOR EACH ROW
WHEN OLD.status <> NEW.status AND NEW.status IN ('ACTIVE','RETURN_DUE','RETURNED','CANCELLED','REFUNDED')
BEGIN
  UPDATE rentals SET
    status=NEW.status,
    deposit_cents=COALESCE(NEW.deposit_cents,deposit_cents),
    started_at=CASE WHEN NEW.status='ACTIVE' THEN COALESCE(started_at,NEW.updated_at) ELSE started_at END,
    due_at=COALESCE(due_at,NEW.end_date),
    returned_at=CASE WHEN NEW.status='RETURNED' THEN COALESCE(returned_at,NEW.updated_at) ELSE returned_at END,
    updated_at=NEW.updated_at
  WHERE rental_reservation_id=NEW.id;
END;

-- If metadata/deposit arrives after confirmation, keep the durable rental
-- record aligned without changing lifecycle state.
CREATE TRIGGER IF NOT EXISTS trg_rental_record_deposit_sync
AFTER UPDATE OF deposit_cents ON rental_reservations
FOR EACH ROW
WHEN NEW.deposit_cents IS NOT OLD.deposit_cents
BEGIN
  UPDATE rentals SET deposit_cents=NEW.deposit_cents,updated_at=COALESCE(NEW.updated_at,updated_at)
  WHERE rental_reservation_id=NEW.id;
END;

-- Minimal checkout snapshot for operations. Do not persist raw payment-provider
-- payloads: only the fields required for fulfilment/support are retained.
CREATE TABLE IF NOT EXISTS order_contact_snapshots (
  order_id TEXT PRIMARY KEY REFERENCES commerce_orders(id) ON DELETE CASCADE,
  source_provider TEXT NOT NULL,
  payer_ref TEXT,
  email TEXT,
  given_name TEXT,
  surname TEXT,
  recipient_name TEXT,
  address_line1 TEXT,
  address_line2 TEXT,
  postal_code TEXT,
  city TEXT,
  region TEXT,
  country_code TEXT,
  captured_at TEXT NOT NULL,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_order_contact_email ON order_contact_snapshots(email);

-- Internal notes can be attached to any operational entity without polluting
-- provider data or public catalogue files.
CREATE TABLE IF NOT EXISTS admin_notes (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('ORDER','RENTAL','CUSTOMER','INVENTORY','PAYMENT','SHIPMENT','RETURN')),
  entity_id TEXT NOT NULL,
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  created_at TEXT NOT NULL,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_admin_notes_entity ON admin_notes(entity_type, entity_id, created_at);

-- Useful read indexes for the admin dashboard and historical analytics.
CREATE INDEX IF NOT EXISTS idx_orders_created_status ON commerce_orders(created_at, status);
CREATE INDEX IF NOT EXISTS idx_payments_created_status ON payments(created_at, status);
CREATE INDEX IF NOT EXISTS idx_shipments_status_updated ON shipments(status, updated_at);
CREATE INDEX IF NOT EXISTS idx_returns_status_created ON returns(status, created_at);
CREATE INDEX IF NOT EXISTS idx_refunds_status_created ON refunds(status, created_at);

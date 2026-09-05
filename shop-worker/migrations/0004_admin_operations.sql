-- Disorder119 admin operations / observability foundation.
-- Apply after 0003_state_integrity.sql.
-- Keeps operational and customer data in private Cloudflare D1 only.
PRAGMA foreign_keys = ON;

-- Rental V2 metadata is snapshotted server-side after the legacy reservation
-- succeeds. The deposit is a snapshot of the rule at request time, not a
-- recalculation from a future catalogue price.
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

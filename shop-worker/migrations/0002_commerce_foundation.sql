-- Disorder119 commerce foundation v2 (non-destructive)
-- Apply after shop-worker/schema.sql. No public customer data belongs in GitHub JSON.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  auth_provider TEXT,
  auth_subject TEXT,
  email_normalized TEXT,
  email_verified INTEGER NOT NULL DEFAULT 0 CHECK (email_verified IN (0,1)),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','DISABLED','DELETION_PENDING','DELETED')),
  created_at TEXT NOT NULL,
  updated_at TEXT,
  deleted_at TEXT,
  UNIQUE(auth_provider, auth_subject)
);
CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(email_normalized);

CREATE TABLE IF NOT EXISTS customer_addresses (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  label TEXT,
  recipient_name TEXT NOT NULL,
  address_line1 TEXT NOT NULL,
  address_line2 TEXT,
  postal_code TEXT NOT NULL,
  city TEXT NOT NULL,
  region TEXT,
  country_code TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_customer_addresses_customer ON customer_addresses(customer_id);

CREATE TABLE IF NOT EXISTS inventory (
  id TEXT PRIMARY KEY,
  item_id INTEGER NOT NULL UNIQUE,
  article_no TEXT,
  status TEXT NOT NULL DEFAULT 'AVAILABLE' CHECK (status IN ('AVAILABLE','RESERVED','PAYMENT_PENDING','PAID','PREPARING','SHIPPED','DELIVERED','RETURN_REQUESTED','RETURNED','REFUNDED','CANCELLED')),
  sale_price_cents INTEGER CHECK (sale_price_cents IS NULL OR sale_price_cents > 0),
  currency TEXT NOT NULL DEFAULT 'EUR' CHECK (currency = 'EUR'),
  catalog_status TEXT NOT NULL DEFAULT 'AVAILABLE',
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_inventory_status ON inventory(status);

CREATE TABLE IF NOT EXISTS reservations (
  id TEXT PRIMARY KEY,
  inventory_id TEXT NOT NULL REFERENCES inventory(id),
  kind TEXT NOT NULL CHECK (kind IN ('PURCHASE','RENTAL')),
  status TEXT NOT NULL CHECK (status IN ('RESERVED','CONSUMED','EXPIRED','CANCELLED')),
  idempotency_key TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_reservations_inventory ON reservations(inventory_id, status, expires_at);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_purchase_reservation
  ON reservations(inventory_id) WHERE kind='PURCHASE' AND status='RESERVED';

CREATE TABLE IF NOT EXISTS commerce_orders (
  id TEXT PRIMARY KEY,
  order_number TEXT NOT NULL UNIQUE,
  customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL,
  guest_email TEXT,
  reservation_id TEXT REFERENCES reservations(id),
  status TEXT NOT NULL CHECK (status IN ('RESERVED','PAYMENT_PENDING','PAID','PREPARING','SHIPPED','DELIVERED','RETURN_REQUESTED','RETURNED','REFUNDED','CANCELLED')),
  currency TEXT NOT NULL DEFAULT 'EUR' CHECK (currency='EUR'),
  subtotal_cents INTEGER NOT NULL CHECK (subtotal_cents >= 0),
  shipping_cents INTEGER NOT NULL DEFAULT 0 CHECK (shipping_cents >= 0),
  total_cents INTEGER NOT NULL CHECK (total_cents >= 0),
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_commerce_orders_customer ON commerce_orders(customer_id, created_at);
CREATE INDEX IF NOT EXISTS idx_commerce_orders_status ON commerce_orders(status, created_at);

CREATE TABLE IF NOT EXISTS order_items (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES commerce_orders(id) ON DELETE CASCADE,
  inventory_id TEXT NOT NULL REFERENCES inventory(id),
  item_id INTEGER NOT NULL,
  article_no TEXT,
  title_snapshot TEXT NOT NULL,
  unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity = 1),
  currency TEXT NOT NULL DEFAULT 'EUR' CHECK (currency='EUR'),
  UNIQUE(order_id, inventory_id)
);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES commerce_orders(id),
  provider TEXT NOT NULL CHECK (provider IN ('PAYPAL','STRIPE')),
  provider_order_id TEXT,
  provider_payment_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('CREATED','PENDING','AUTHORIZED','COMPLETED','FAILED','CANCELLED','REFUNDED','PARTIALLY_REFUNDED')),
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  currency TEXT NOT NULL DEFAULT 'EUR' CHECK (currency='EUR'),
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT,
  UNIQUE(provider, provider_order_id),
  UNIQUE(provider, provider_payment_id)
);
CREATE INDEX IF NOT EXISTS idx_payments_order ON payments(order_id, status);

CREATE TABLE IF NOT EXISTS payment_events (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  provider_event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payment_id TEXT REFERENCES payments(id),
  verified INTEGER NOT NULL DEFAULT 0 CHECK (verified IN (0,1)),
  received_at TEXT NOT NULL,
  processed_at TEXT,
  payload_hash TEXT,
  UNIQUE(provider, provider_event_id)
);

CREATE TABLE IF NOT EXISTS shipments (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES commerce_orders(id),
  carrier TEXT,
  service TEXT,
  tracking_number TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','LABEL_CREATED','SHIPPED','IN_TRANSIT','DELIVERED','EXCEPTION','RETURNED')),
  shipped_at TEXT,
  delivered_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_shipments_order ON shipments(order_id);

CREATE TABLE IF NOT EXISTS rental_reservations (
  id TEXT PRIMARY KEY,
  inventory_id TEXT NOT NULL REFERENCES inventory(id),
  customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL,
  guest_email TEXT,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  days INTEGER NOT NULL CHECK (days BETWEEN 1 AND 366),
  daily_price_cents INTEGER,
  total_price_cents INTEGER,
  currency TEXT NOT NULL DEFAULT 'EUR' CHECK (currency='EUR'),
  price_on_request INTEGER NOT NULL DEFAULT 0 CHECK (price_on_request IN (0,1)),
  status TEXT NOT NULL CHECK (status IN ('RESERVED','PAYMENT_PENDING','CONFIRMED','ACTIVE','RETURN_DUE','RETURNED','CANCELLED','REFUNDED')),
  idempotency_key TEXT NOT NULL UNIQUE,
  expires_at TEXT,
  purpose TEXT,
  message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_rental_reservations_inventory_dates ON rental_reservations(inventory_id, start_date, end_date, status);

-- One row per held/confirmed rental day gives SQLite a real uniqueness invariant
-- against overlapping bookings, rather than relying on browser checks.
CREATE TABLE IF NOT EXISTS rental_days (
  inventory_id TEXT NOT NULL REFERENCES inventory(id),
  rental_date TEXT NOT NULL,
  rental_reservation_id TEXT NOT NULL REFERENCES rental_reservations(id) ON DELETE CASCADE,
  PRIMARY KEY(inventory_id, rental_date)
);

CREATE TABLE IF NOT EXISTS rentals (
  id TEXT PRIMARY KEY,
  rental_reservation_id TEXT NOT NULL UNIQUE REFERENCES rental_reservations(id),
  inventory_id TEXT NOT NULL REFERENCES inventory(id),
  status TEXT NOT NULL CHECK (status IN ('CONFIRMED','ACTIVE','RETURN_DUE','RETURNED','CANCELLED','REFUNDED')),
  deposit_cents INTEGER,
  started_at TEXT,
  due_at TEXT,
  returned_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS returns (
  id TEXT PRIMARY KEY,
  order_id TEXT REFERENCES commerce_orders(id),
  rental_id TEXT REFERENCES rentals(id),
  status TEXT NOT NULL CHECK (status IN ('REQUESTED','AUTHORIZED','IN_TRANSIT','RECEIVED','INSPECTED','CLOSED','REJECTED')),
  reason_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT,
  CHECK ((order_id IS NOT NULL) != (rental_id IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS refunds (
  id TEXT PRIMARY KEY,
  order_id TEXT REFERENCES commerce_orders(id),
  rental_id TEXT REFERENCES rentals(id),
  payment_id TEXT REFERENCES payments(id),
  provider_refund_id TEXT,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  currency TEXT NOT NULL DEFAULT 'EUR' CHECK (currency='EUR'),
  status TEXT NOT NULL CHECK (status IN ('PENDING','COMPLETED','FAILED','CANCELLED')),
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('SYSTEM','CUSTOMER','ADMIN','PAYMENT_PROVIDER')),
  actor_ref TEXT,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  request_id TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_events(entity_type, entity_id, created_at);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  scope TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT,
  response_status INTEGER,
  response_json TEXT,
  resource_id TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY(scope, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_idempotency_expiry ON idempotency_keys(expires_at);

CREATE TABLE IF NOT EXISTS account_privacy_requests (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  request_type TEXT NOT NULL CHECK (request_type IN ('EXPORT','DELETE')),
  status TEXT NOT NULL CHECK (status IN ('REQUESTED','PROCESSING','COMPLETED','REJECTED')),
  requested_at TEXT NOT NULL,
  completed_at TEXT
);

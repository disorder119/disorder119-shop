-- Disorder119 private operational data (Cloudflare D1)
-- IMPORTANT: customer/order/rental data must not be stored in the public GitHub repository.

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  paypal_order_id TEXT NOT NULL UNIQUE,
  item_id INTEGER NOT NULL,
  article_no TEXT,
  item_title TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'EUR',
  payment_status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_orders_item_id ON orders(item_id);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);

CREATE TABLE IF NOT EXISTS rental_requests (
  id TEXT PRIMARY KEY,
  item_id INTEGER NOT NULL,
  item_title TEXT NOT NULL,
  article_no TEXT,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  days INTEGER NOT NULL,
  purpose TEXT NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'new',
  created_at TEXT NOT NULL,
  updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_rental_status ON rental_requests(status);
CREATE INDEX IF NOT EXISTS idx_rental_created_at ON rental_requests(created_at);

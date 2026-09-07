-- Disorder119 visitor intelligence v1.
-- Apply after 0007_operations_automation.sql.
-- Privacy model: pseudonymous browser-session IDs only. No raw IP addresses,
-- precise geolocation, cookies or fingerprint identifiers are persisted.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS visitor_sessions (
  id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  landing_path TEXT NOT NULL,
  current_path TEXT NOT NULL,
  referrer_host TEXT,
  country_code TEXT,
  device_class TEXT CHECK (device_class IS NULL OR device_class IN ('DESKTOP','TABLET','MOBILE','UNKNOWN')),
  page_views INTEGER NOT NULL DEFAULT 0 CHECK (page_views >= 0),
  product_views INTEGER NOT NULL DEFAULT 0 CHECK (product_views >= 0),
  cart_events INTEGER NOT NULL DEFAULT 0 CHECK (cart_events >= 0),
  checkout_events INTEGER NOT NULL DEFAULT 0 CHECK (checkout_events >= 0),
  order_events INTEGER NOT NULL DEFAULT 0 CHECK (order_events >= 0),
  linked_order_ref TEXT,
  converted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_visitor_sessions_last_seen
  ON visitor_sessions(last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_visitor_sessions_started
  ON visitor_sessions(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_visitor_sessions_order_ref
  ON visitor_sessions(linked_order_ref) WHERE linked_order_ref IS NOT NULL;

CREATE TABLE IF NOT EXISTS visitor_events (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES visitor_sessions(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'PAGE_VIEW','PRODUCT_VIEW','CART_ADD','CART_REMOVE','CART_VIEW',
    'CHECKOUT_STARTED','ORDER_CREATED','ORDER_COMPLETED'
  )),
  path TEXT NOT NULL,
  item_id INTEGER,
  metadata_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_visitor_events_session
  ON visitor_events(session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_visitor_events_type_time
  ON visitor_events(event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_visitor_events_item
  ON visitor_events(item_id, created_at DESC) WHERE item_id IS NOT NULL;

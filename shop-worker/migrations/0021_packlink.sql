-- Packlink PRO: ein Sendungsentwurf je Auftrag.
--
-- Der Server legt den Entwurf mit Adresse und Paketmaßen an, bezahlt wird in
-- Packlink PRO. Danach holt die Admin-App Status, Sendungsnummer und
-- Etikett ab. Die Sendungsnummer landet zusaetzlich in shipments, damit
-- Versandmail und Kundenkonto sie wie bei DHL finden.
CREATE TABLE IF NOT EXISTS packlink_sendungen (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES commerce_orders(id),
  reference TEXT NOT NULL UNIQUE,
  service_id INTEGER,
  carrier TEXT,
  service_name TEXT,
  paket TEXT,
  price_cents INTEGER,
  state TEXT NOT NULL DEFAULT 'AWAITING_COMPLETION',
  tracking_number TEXT,
  tracking_url TEXT,
  label_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_packlink_sendungen_order ON packlink_sendungen(order_id, created_at);

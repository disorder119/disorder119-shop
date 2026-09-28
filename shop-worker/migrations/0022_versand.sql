-- Versandoptionen im Checkout und Sendungsverfolgung ueber Packlink.
--
-- order_versand: die Versandart, die die Kundschaft vor dem Kaufknopf
-- gewaehlt und bezahlt hat (Standard/Express, Packlink-Leistung, Paketgroesse,
-- Preis). Genau eine Zeile je Bestellung; der Preis steht zusaetzlich wie
-- bisher in commerce_orders.shipping_cents. Aeltere Bestellungen haben keine
-- Zeile - die Admin-App zeigt dann nur die Versandkosten.
CREATE TABLE IF NOT EXISTS order_versand (
  order_id TEXT PRIMARY KEY REFERENCES commerce_orders(id),
  option_id TEXT NOT NULL,
  art TEXT NOT NULL CHECK (art IN ('standard','express')),
  quelle TEXT NOT NULL CHECK (quelle IN ('packlink','ersatz')),
  packlink_service_id INTEGER,
  carrier TEXT,
  service_name TEXT,
  paket TEXT NOT NULL CHECK (paket IN ('S','M','L')),
  preis_cents INTEGER NOT NULL CHECK (preis_cents > 0),
  laufzeit TEXT,
  created_at TEXT NOT NULL
);

-- Meldungen, die Packlink an /packlink/webhook/<Schluessel> schickt. Der
-- Inhalt wird nie geglaubt - der Server holt den Stand danach selbst ueber die
-- Schnittstelle ab. Die Tabelle verhindert nur, dass dieselbe Meldung doppelt
-- verarbeitet wird (Packlink wiederholt Zustellungen).
CREATE TABLE IF NOT EXISTS packlink_webhook_events (
  id TEXT PRIMARY KEY,
  event TEXT NOT NULL,
  reference TEXT,
  received_at TEXT NOT NULL,
  processed_at TEXT,
  result TEXT
);
CREATE INDEX IF NOT EXISTS idx_packlink_webhook_events_received ON packlink_webhook_events(received_at);

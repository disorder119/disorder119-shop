-- Disorder119: DHL-Versandmarken als QR-Code (DHL Online Frankierung).
-- Apply after 0014_admin_passkeys.sql.
--
-- Ein Eintrag je DHL-Warenkorb. Bezahlt wird auf der DHL-Seite; danach
-- stehen hier Sendungsnummer und der QR-Code fuer Packstation und Filiale.
CREATE TABLE IF NOT EXISTS dhl_qr_marken (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES commerce_orders(id),
  cart_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  entry_url TEXT NOT NULL,
  state TEXT NOT NULL,                 -- PREPAID, INPAYMENT, PAYED, CANCELED, ERSETZT ...
  price_cents INTEGER,
  shipment_number TEXT,
  pak_id TEXT,
  qr_png_b64 TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  paid_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_dhl_qr_marken_order ON dhl_qr_marken(order_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_dhl_qr_marken_cart ON dhl_qr_marken(cart_id);

-- Ruecksendeetiketten (ruecksendung.js, Inhaber 05.11.2026): Marke der
-- DHL-Online-Frankierung mit der Kundin als Absender und dem Shop (Joel,
-- Aschaffenburg) als Empfaenger - immer an diese Adresse. Joel bezahlt auf
-- dhl.de, danach holt der Shop QR-Code und PDF und schickt der Kundin eine Mail
-- (Vorlage A, B oder C beim Widerruf im Wechsel, D bei einer Reklamation).
-- Getrennt von dhl_qr_marken, damit Versandmarken-Logik (Ersetzen, Status
-- "Versendet", Sendungsnummer der Bestellung) nie eine Ruecksendung erwischt.
-- Rein additiv.
CREATE TABLE IF NOT EXISTS ruecksende_marken (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES commerce_orders(id),
  anlass TEXT NOT NULL CHECK (anlass IN ('WIDERRUF','REKLAMATION')),
  vorlage TEXT NOT NULL CHECK (vorlage IN ('A','B','C','D')),
  kosten TEXT NOT NULL CHECK (kosten IN ('SHOP','KUNDIN')),
  cart_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  entry_url TEXT NOT NULL,
  state TEXT NOT NULL,
  price_cents INTEGER,
  shipment_number TEXT,
  pak_id TEXT,
  qr_png_b64 TEXT,
  label_pdf_b64 TEXT,
  qr_versuche INTEGER NOT NULL DEFAULT 0,
  qr_versucht_am TEXT,
  absender_json TEXT NOT NULL,
  -- SHA-256 des Zugangs in der Mail (/ruecksendung/<zugang>), entsteht beim Senden.
  zugang_hash TEXT UNIQUE,
  mail_an TEXT,
  mail_gesendet_at TEXT,
  mail_fehler TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  paid_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_ruecksende_marken_order ON ruecksende_marken(order_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ruecksende_marken_offen ON ruecksende_marken(state, created_at);
CREATE INDEX IF NOT EXISTS idx_ruecksende_marken_cart ON ruecksende_marken(cart_id);

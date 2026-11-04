-- DHL-Versandmarken aus dem Geschaeftskundenvertrag (dhl.js, "Parcel DE
-- Shipping"): die Marke kommt als PDF direkt aus der Schnittstelle und wird
-- hier aufgehoben, damit die Admin-App sie jederzeit wieder oeffnen kann.
-- Die Sendungsnummer haengt zusaetzlich wie bisher an shipments.
CREATE TABLE IF NOT EXISTS dhl_vertragsmarken (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES commerce_orders(id),
  shipment_id TEXT,
  shipment_number TEXT NOT NULL,
  product TEXT NOT NULL,                 -- V01PAK, V62KP, V53WPAK
  billing_number TEXT NOT NULL,          -- EKP + Verfahren + Teilnahme
  weight_g INTEGER,
  label_pdf_b64 TEXT,                    -- PDF der Marke (Base64), ca. 50-150 KB
  label_url TEXT,                        -- Abruf bei DHL, gilt bis zum Tagesabschluss
  state TEXT NOT NULL CHECK (state IN ('ERSTELLT','STORNIERT')),
  automatisch INTEGER NOT NULL DEFAULT 0 CHECK (automatisch IN (0,1)),
  request_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dhl_vertragsmarken_order ON dhl_vertragsmarken(order_id, created_at);

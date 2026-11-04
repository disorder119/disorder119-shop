-- Sendungsverfolgung (dhl-tracking.js): je Sendung der letzte Stand der
-- DHL-Abfrage, damit der Cron nicht oefter als noetig fragt (250 Abfragen am
-- Tag im kostenlosen Zugang) und Statuswechsel nur einmal ausloest.
CREATE TABLE IF NOT EXISTS sendungs_abfragen (
  shipment_id TEXT PRIMARY KEY REFERENCES shipments(id),
  tracking_number TEXT NOT NULL,
  zustand TEXT NOT NULL,                -- OFFEN, UNTERWEGS, ZUGESTELLT, PROBLEM, UNBEKANNT
  status_code TEXT,
  status_text TEXT,
  abfragen INTEGER NOT NULL DEFAULT 0,
  zuletzt_am TEXT NOT NULL,
  geaendert_am TEXT,
  fehler TEXT
);

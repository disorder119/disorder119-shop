-- Kurze, fortlaufende Rechnungsnummern "2026-001" statt der Bestellnummer
-- (Inhaber 04.11.2026). Je Jahr ein Zaehler; vergeben wird atomar
-- (customer-mail.js naechsteRechnungsnummer). Die eine Rechnung vor diesem
-- Stand (D119-20261104-E1BBBE11, 04.11.2026) gehoert zum alten Nummernkreis
-- "Bestellnummer = Rechnungsnummer" und bleibt unveraendert im Archiv.
CREATE TABLE IF NOT EXISTS rechnungsnummern (
  jahr INTEGER PRIMARY KEY,
  zaehler INTEGER NOT NULL DEFAULT 0 CHECK (zaehler >= 0),
  updated_at TEXT NOT NULL
);
-- Die Rechnung als PDF, so wie sie der Kundschaft angehaengt wurde (Base64).
ALTER TABLE rechnungen ADD COLUMN pdf_b64 TEXT;

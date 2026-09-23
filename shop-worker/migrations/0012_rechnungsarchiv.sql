-- Disorder119 Rechnungsarchiv.
-- Apply after 0011_customer_accounts.sql.

-- Bisher wurde eine Rechnung bei jedem Aufruf frisch aus den Bestelldaten
-- gebaut. Aendert sich spaeter etwas an der Bestellung, aendert sich damit
-- rueckwirkend auch die Rechnung - fuer die GoBD ist das nicht haltbar: eine
-- verschickte Rechnung muss unveraendert nachweisbar bleiben.
--
-- Deshalb wird im Moment des Versands eine Kopie festgeschrieben. Der Text ist
-- genau der, den die Kundin bekommen hat.
CREATE TABLE IF NOT EXISTS rechnungen (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES commerce_orders(id),
  rechnungsnummer TEXT NOT NULL,
  ausgestellt_am TEXT NOT NULL,
  waehrung TEXT NOT NULL DEFAULT 'EUR' CHECK (waehrung='EUR'),
  warenwert_cents INTEGER NOT NULL CHECK (warenwert_cents >= 0),
  versand_cents INTEGER NOT NULL DEFAULT 0 CHECK (versand_cents >= 0),
  gesamt_cents INTEGER NOT NULL CHECK (gesamt_cents >= 0),
  empfaenger_email TEXT,
  -- Der vollstaendige Rechnungstext, so wie verschickt.
  html TEXT NOT NULL,
  text TEXT NOT NULL,
  -- Abdruck ueber den Text: faellt sofort auf, wenn jemand die Zeile
  -- nachtraeglich angefasst hat.
  pruefsumme TEXT NOT NULL,
  erstellt_am TEXT NOT NULL,
  -- Je Bestellung genau eine Rechnung. Ein zweiter Mailversand darf keine
  -- zweite Rechnungsnummer in die Buecher schreiben.
  UNIQUE(order_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_rechnungen_nummer ON rechnungen(rechnungsnummer);
CREATE INDEX IF NOT EXISTS idx_rechnungen_datum ON rechnungen(ausgestellt_am);

-- Eine einmal geschriebene Rechnung ist unveraenderlich. Korrekturen laufen
-- ueber eine Gutschrift oder Stornorechnung, nicht ueber das Ueberschreiben
-- des Originals - genau das verlangt die GoBD.
CREATE TRIGGER IF NOT EXISTS trg_rechnung_unveraenderlich
BEFORE UPDATE ON rechnungen
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'rechnung_ist_unveraenderlich');
END;

CREATE TRIGGER IF NOT EXISTS trg_rechnung_nicht_loeschbar
BEFORE DELETE ON rechnungen
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'rechnung_ist_aufbewahrungspflichtig');
END;

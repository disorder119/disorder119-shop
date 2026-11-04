-- Testbestellungen mit echten Belegen (bezahlt und erstattet) lassen sich nicht
-- loeschen, ohne Zahlungs- und Erstattungsbelege aus den Steuerdaten zu reissen.
-- Stattdessen: versteckt = 1 nimmt die Bestellung aus allen Admin-Listen, Zaehlern
-- und Statistiken; Steuer-Datensatz, Rechnungsarchiv und Belege bleiben unberuehrt.
ALTER TABLE commerce_orders ADD COLUMN versteckt INTEGER NOT NULL DEFAULT 0 CHECK (versteckt IN (0,1));

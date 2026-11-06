-- Sendungsverlauf im Kundenkonto (dhl-tracking.js, customer-account.js): die
-- Stationen der letzten DHL-Abfrage als JSON ([{zeit,text,ort}], neueste zuerst)
-- und der Zeitpunkt der Zustellung. DHL-Bedingungen (Shipment Tracking -
-- Unified): nur fuer die eigene Kundschaft und 30 Tage nach Zustellung
-- loeschen - das erledigt verlaufAufraeumen im Cron. Rein additiv.
ALTER TABLE sendungs_abfragen ADD COLUMN ereignisse_json TEXT;
ALTER TABLE sendungs_abfragen ADD COLUMN zugestellt_am TEXT;

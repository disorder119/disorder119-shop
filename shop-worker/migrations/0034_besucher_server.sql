-- Disorder119 Live-Besucher: Seitenaufrufe, die der Storefront-Worker beim
-- Ausliefern einer Seite meldet (ohne Skript und ohne Einwilligung, nur was
-- jeder Webserver beim Abruf ohnehin erhaelt). server=1 kennzeichnet sie,
-- damit das Startereignis von assets/besucher.js denselben Aufruf nach einer
-- Einwilligung nicht ein zweites Mal zaehlt. Gleiche Regeln wie bisher: keine
-- IP, Tages-Schluessel, Loeschung nach BESUCHER_AUFBEWAHRUNG_TAGE.
ALTER TABLE besucher_ereignisse ADD COLUMN server INTEGER NOT NULL DEFAULT 0 CHECK (server IN (0, 1));

CREATE INDEX IF NOT EXISTS idx_besucher_ereignisse_server ON besucher_ereignisse(besucher, server, zeit);

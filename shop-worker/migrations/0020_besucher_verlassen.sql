-- Disorder119 Live-Besucher: Zeitpunkt, an dem eine Seite verlassen oder in
-- den Hintergrund geschickt wurde. Daraus ergibt sich die Verweildauer auf der
-- letzten Seite eines Besuchs. Gleiche Regeln wie besucher_ereignisse: keine
-- IP, Tages-Schluessel, Loeschung nach BESUCHER_AUFBEWAHRUNG_TAGE.
CREATE TABLE IF NOT EXISTS besucher_verlassen (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  besucher TEXT NOT NULL,
  zeit TEXT NOT NULL,
  pfad TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_besucher_verlassen_besucher ON besucher_verlassen(besucher, zeit);
CREATE INDEX IF NOT EXISTS idx_besucher_verlassen_zeit ON besucher_verlassen(zeit);

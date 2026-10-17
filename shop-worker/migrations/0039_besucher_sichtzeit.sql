-- Freiwillige Detailstatistik: ein Datensatz je sichtbarem Abschnitt einer
-- Seite/Artikelansicht. Keine neue dauerhafte Browserkennung, keine IP.
-- Updates sind kumulativ und idempotent; dieselbe Aufbewahrung wie Besucher.
CREATE TABLE IF NOT EXISTS besucher_sichtzeit (
  besucher TEXT NOT NULL,
  abschnitt TEXT NOT NULL,
  beginn TEXT NOT NULL,
  zuletzt TEXT NOT NULL,
  pfad TEXT NOT NULL,
  artikel_id TEXT,
  zaehler_ms INTEGER NOT NULL DEFAULT 0 CHECK (zaehler_ms BETWEEN 0 AND 86400000),
  sicht_ms INTEGER NOT NULL DEFAULT 0 CHECK (sicht_ms BETWEEN 0 AND 86400000),
  begrenzt INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (besucher, abschnitt)
);
CREATE INDEX IF NOT EXISTS idx_besucher_sichtzeit_zuletzt ON besucher_sichtzeit(zuletzt);

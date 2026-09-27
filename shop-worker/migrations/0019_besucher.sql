-- Disorder119 Live-Besucher: was Besucher gerade im Shop ansehen und in den
-- Warenkorb legen. Cookielos und ohne IP-Adresse: der Besucher-Schluessel ist
-- ein Hash aus IP, Browserkennung und einem Tagessalz. Das Salz wird nach
-- Tagesende geloescht, danach laesst sich der Schluessel keiner IP mehr
-- zuordnen. Ereignisse werden nach BESUCHER_AUFBEWAHRUNG_TAGE (Standard 30)
-- vom Cron geloescht.
CREATE TABLE IF NOT EXISTS besucher_salz (
  tag TEXT PRIMARY KEY,
  salz TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS besucher_ereignisse (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  besucher TEXT NOT NULL,
  zeit TEXT NOT NULL,
  typ TEXT NOT NULL CHECK (typ IN ('seite', 'artikel', 'warenkorb_rein', 'warenkorb_raus', 'anfrage')),
  pfad TEXT NOT NULL DEFAULT '',
  artikel_id TEXT,
  titel TEXT,
  warenkorb INTEGER NOT NULL DEFAULT 0 CHECK (warenkorb >= 0),
  kanal TEXT,
  quelle TEXT,
  sprache TEXT,
  land TEXT,
  region TEXT,
  stadt TEXT,
  geraet TEXT,
  browser TEXT,
  gemeldet INTEGER NOT NULL DEFAULT 0 CHECK (gemeldet IN (0, 1))
);

CREATE INDEX IF NOT EXISTS idx_besucher_ereignisse_zeit ON besucher_ereignisse(zeit);
CREATE INDEX IF NOT EXISTS idx_besucher_ereignisse_besucher ON besucher_ereignisse(besucher, zeit);
CREATE INDEX IF NOT EXISTS idx_besucher_ereignisse_artikel ON besucher_ereignisse(artikel_id, zeit);
CREATE INDEX IF NOT EXISTS idx_besucher_ereignisse_gemeldet ON besucher_ereignisse(gemeldet, zeit);

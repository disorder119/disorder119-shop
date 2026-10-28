-- Waechter (waechter.js): 24-Stunden-Sperren fuer Scanner und Angriffsproben.
-- Keine IP: "anschluss" ist ein SHA-256 aus dem Anschluss (IPv6 je /64) und
-- dem geheimen Pfeffer LOGIN_IP_PEPPER. Vorfaelle zaehlen nur fuer die
-- Schwellen und werden nach 24 Stunden geloescht, Sperren 7 Tage nach ihrem
-- Ablauf (Cron: waechterPflegen).
CREATE TABLE IF NOT EXISTS waechter_vorfaelle (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  anschluss TEXT NOT NULL,
  zeit TEXT NOT NULL,
  art TEXT NOT NULL CHECK (art IN ('angriff', 'probe', '404', 'flut')),
  grund TEXT,
  pfad TEXT,
  land TEXT
);
CREATE INDEX IF NOT EXISTS idx_waechter_vorfaelle_anschluss ON waechter_vorfaelle(anschluss, zeit);
CREATE INDEX IF NOT EXISTS idx_waechter_vorfaelle_zeit ON waechter_vorfaelle(zeit);

CREATE TABLE IF NOT EXISTS waechter_sperren (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  anschluss TEXT NOT NULL UNIQUE,
  seit TEXT NOT NULL,
  bis TEXT NOT NULL,
  zuletzt TEXT NOT NULL,
  land TEXT,
  ua_kurz TEXT,
  grund TEXT NOT NULL,
  beispiel TEXT,
  versuche INTEGER NOT NULL DEFAULT 1,
  gemeldet_zeit TEXT,
  sammeln INTEGER NOT NULL DEFAULT 0 CHECK (sammeln IN (0, 1)),
  aufgehoben TEXT
);
CREATE INDEX IF NOT EXISTS idx_waechter_sperren_bis ON waechter_sperren(bis);
CREATE INDEX IF NOT EXISTS idx_waechter_sperren_zuletzt ON waechter_sperren(zuletzt);
CREATE INDEX IF NOT EXISTS idx_waechter_sperren_gemeldet ON waechter_sperren(gemeldet_zeit);

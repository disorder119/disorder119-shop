-- Waechter 2 (waechter.js): verteilte Angriffe (Kampagnen), Wiederholungstaeter,
-- Selbst-Entsperrung per Turnstile und Vorfall-Nummern.
--
-- waechter_vorfaelle wird neu angelegt, weil die neuen Arten (Durchprobieren
-- von Codes, Fehlschlaege der Kasse, Formular-Falle) nicht durch die alte
-- CHECK-Bedingung passen. Vorfaelle leben ohnehin nur 24 Stunden.
-- Neue Spalten:
--   signatur  Hash aus Grund + normalisiertem Pfad (Kampagnen-Erkennung)
--   asn, netz Netz des Anschlusses (cf.asn, cf.asOrganization) - fuer
--             "gleiches Netz strenger" und die Kampagnen-Meldung
--   nr        Vorfall-Nummer, die auch der Angreifer auf seiner Seite sieht
CREATE TABLE IF NOT EXISTS waechter_vorfaelle_neu (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  anschluss TEXT NOT NULL,
  zeit TEXT NOT NULL,
  art TEXT NOT NULL CHECK (art IN ('angriff', 'probe', '404', 'flut', 'enum', 'kasse', 'falle')),
  grund TEXT,
  pfad TEXT,
  land TEXT,
  signatur TEXT,
  asn INTEGER,
  netz TEXT,
  nr TEXT
);
INSERT INTO waechter_vorfaelle_neu (id, anschluss, zeit, art, grund, pfad, land)
  SELECT id, anschluss, zeit, art, grund, pfad, land FROM waechter_vorfaelle;
DROP TABLE waechter_vorfaelle;
ALTER TABLE waechter_vorfaelle_neu RENAME TO waechter_vorfaelle;
CREATE INDEX IF NOT EXISTS idx_waechter_vorfaelle_anschluss ON waechter_vorfaelle(anschluss, zeit);
CREATE INDEX IF NOT EXISTS idx_waechter_vorfaelle_zeit ON waechter_vorfaelle(zeit);
CREATE INDEX IF NOT EXISTS idx_waechter_vorfaelle_signatur ON waechter_vorfaelle(signatur, zeit);

-- Sperren: Stufe und Herkunft.
--   anzahl            wievielte Sperre in Folge (erneut innerhalb von 7 Tagen
--                     nach dem Ende der letzten = 7 Tage Sperre)
--   selbst            1 = der Besucher darf sich per Turnstile selbst
--                     entsperren (nie bei eindeutigen Angriffen)
--   selbst_entsperrt  Zeitpunkt der letzten Selbst-Entsperrung; wer danach
--                     wieder auffaellt, bekommt keine Turnstile-Option mehr
--   admin_frei        vom Inhaber aufgehoben: zaehlt nicht als Vorstrafe
--   asn, netz         Netz des Anschlusses (cf.asn / cf.asOrganization)
--   kampagne          Teil eines verteilten Angriffs (waechter_kampagnen.id)
--   nr                Vorfall-Nummer des ausloesenden Vorfalls
ALTER TABLE waechter_sperren ADD COLUMN anzahl INTEGER NOT NULL DEFAULT 1;
ALTER TABLE waechter_sperren ADD COLUMN selbst INTEGER NOT NULL DEFAULT 0;
ALTER TABLE waechter_sperren ADD COLUMN selbst_entsperrt TEXT;
ALTER TABLE waechter_sperren ADD COLUMN admin_frei TEXT;
ALTER TABLE waechter_sperren ADD COLUMN asn INTEGER;
ALTER TABLE waechter_sperren ADD COLUMN netz TEXT;
ALTER TABLE waechter_sperren ADD COLUMN kampagne INTEGER;
ALTER TABLE waechter_sperren ADD COLUMN nr TEXT;
-- Seit wann die Sperre auf die gebuendelte Telegram-Meldung wartet.
ALTER TABLE waechter_sperren ADD COLUMN sammeln_seit TEXT;
CREATE INDEX IF NOT EXISTS idx_waechter_sperren_sammeln ON waechter_sperren(sammeln);

-- Kampagnen: dieselbe Angriffssignatur von mindestens drei Anschluessen in
-- zehn Minuten. Solange streng_bis in der Zukunft liegt, sperrt der Waechter
-- Anschluesse aus beteiligten Netzen schon beim ersten Scanner-Pfad.
CREATE TABLE IF NOT EXISTS waechter_kampagnen (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  signatur TEXT NOT NULL UNIQUE,
  grund TEXT NOT NULL,
  beispiel TEXT,
  seit TEXT NOT NULL,
  zuletzt TEXT NOT NULL,
  streng_bis TEXT NOT NULL,
  anschluesse INTEGER NOT NULL DEFAULT 0,
  versuche INTEGER NOT NULL DEFAULT 0,
  laender TEXT,
  netze TEXT,
  gemeldet_zeit TEXT,
  gemeldet_anschluesse INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_waechter_kampagnen_streng ON waechter_kampagnen(streng_bis);
CREATE INDEX IF NOT EXISTS idx_waechter_kampagnen_zuletzt ON waechter_kampagnen(zuletzt);

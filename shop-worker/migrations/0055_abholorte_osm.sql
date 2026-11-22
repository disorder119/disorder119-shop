-- Abholorte aus OpenStreetMap (abholorte-osm.js): DHL-Packstationen und
-- -Postfilialen mit Nummer, PLZ und Ort fuer die Liste in der Kasse - ohne
-- den DHL Location Finder, dessen Bedingungen jedes Speichern verbieten
-- (abholorte.js). Daten: (c) OpenStreetMap-Mitwirkende, Open Database License
-- (ODbL 1.0) - speichern und zwischenspeichern ist erlaubt, die Kasse zeigt
-- den Quellenvermerk. Der Cron fuellt die Tabellen je Leitregion (die ersten
-- zwei Ziffern der PLZ, "01" bis "99"), ein Gebiet je Lauf. Rein additiv.
CREATE TABLE IF NOT EXISTS abholorte_osm (
  gebiet TEXT NOT NULL,                  -- Leitregion des PLZ-Gebiets, in dem der Ort liegt
  id TEXT NOT NULL,                      -- "<typ>-<nummer>-<plz>"
  typ TEXT NOT NULL CHECK (typ IN ('packstation', 'filiale')),
  nummer TEXT NOT NULL,                  -- Packstations- bzw. Filialnummer (OSM: ref)
  name TEXT NOT NULL,                    -- "Packstation 125" / "Postfiliale 593" - so steht es auf dem Etikett
  geschaeft TEXT,                        -- Laden einer Partnerfiliale, sonst NULL
  strasse TEXT NOT NULL DEFAULT '',
  plz TEXT NOT NULL,
  ort TEXT NOT NULL,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  osm_id TEXT NOT NULL,                  -- "n123" (Knoten) bzw. "w456" (Weg) in OpenStreetMap
  stand TEXT NOT NULL,                   -- zuletzt geschrieben (neu oder geaendert)
  PRIMARY KEY (gebiet, id)
);
-- Umkreissuche der Kasse: Rechteck um die Mitte des PLZ-Gebiets.
CREATE INDEX IF NOT EXISTS idx_abholorte_osm_lage ON abholorte_osm (lat, lng);

-- Mitte (und Ort) jedes PLZ-Gebiets aus den OSM-Grenzen boundary=postal_code.
CREATE TABLE IF NOT EXISTS abholorte_osm_plz (
  plz TEXT PRIMARY KEY,
  gebiet TEXT NOT NULL,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  ort TEXT NOT NULL DEFAULT '',
  stand TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_abholorte_osm_plz_gebiet ON abholorte_osm_plz (gebiet);

-- Stand je Leitregion: letzter erfolgreicher Abgleich, Anzahl, Fehler und
-- naechster Versuch (Pause nach Fehlern). Ohne Zeile: noch nie eingelesen.
CREATE TABLE IF NOT EXISTS abholorte_osm_gebiete (
  gebiet TEXT PRIMARY KEY,
  punkte INTEGER NOT NULL DEFAULT 0,
  plz INTEGER NOT NULL DEFAULT 0,
  stand TEXT,
  versuch_am TEXT,
  naechster_versuch TEXT,
  fehlversuche INTEGER NOT NULL DEFAULT 0,
  fehler TEXT,
  dauer_ms INTEGER,
  quelle TEXT                            -- Overpass-Server des letzten Abgleichs
);

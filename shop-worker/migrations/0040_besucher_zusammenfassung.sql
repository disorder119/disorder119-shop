-- Disorder119 Live-Besucher: eine Telegram-Zusammenfassung je Besuch, erst
-- wenn der Besucher die Seite verlassen hat (besucher-sitzung.js,
-- besucher-zusammenfassung.js, besucher-wecker.js).
--
-- besucher_sitzungen haelt nur den Ablauf eines Besuchs (Beginn, letzte
-- Aktivitaet, Abschied, wann gemeldet wird) unter demselben Tages-Schluessel
-- wie besucher_ereignisse - keine IP, keine neue Kennung. Mit Einwilligung
-- kommt hinzu, wievielter Besuch es laut Browser-Speicher ist (Zahl und zwei
-- Tagesdaten, kein Kennzeichen). Gleiche Aufbewahrung wie die Ereignisse
-- (BESUCHER_AUFBEWAHRUNG_TAGE, Standard 30).
--
-- gemeldet: 0 = ausstehend, 1 = an Telegram gesendet, 2 = nicht gesendet
-- (Telegram aus, Stunden-Deckel, leer, Fehler; Grund in meldung_grund),
-- 3 = wird gerade gesendet.
CREATE TABLE IF NOT EXISTS besucher_sitzungen (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  besucher TEXT NOT NULL,
  beginn TEXT NOT NULL,
  zuletzt TEXT NOT NULL,
  faellig TEXT NOT NULL,
  abschied TEXT,
  offen INTEGER NOT NULL DEFAULT 1 CHECK (offen IN (0, 1)),
  einwilligung INTEGER NOT NULL DEFAULT 0 CHECK (einwilligung IN (0, 1)),
  besuch_nr INTEGER CHECK (besuch_nr IS NULL OR besuch_nr BETWEEN 1 AND 9999),
  erster_besuch TEXT,
  vorher_besuch TEXT,
  entsperrt INTEGER NOT NULL DEFAULT 0 CHECK (entsperrt IN (0, 1)),
  gemeldet INTEGER NOT NULL DEFAULT 0 CHECK (gemeldet IN (0, 1, 2, 3)),
  gemeldet_zeit TEXT,
  meldung_grund TEXT,
  versuche INTEGER NOT NULL DEFAULT 0
);

-- Hoechstens eine offene Sitzung je Besucher, auch bei gleichzeitigen Aufrufen.
CREATE UNIQUE INDEX IF NOT EXISTS idx_besucher_sitzungen_offen ON besucher_sitzungen(besucher) WHERE offen = 1;
CREATE INDEX IF NOT EXISTS idx_besucher_sitzungen_faellig ON besucher_sitzungen(gemeldet, faellig);
CREATE INDEX IF NOT EXISTS idx_besucher_sitzungen_besucher ON besucher_sitzungen(besucher, beginn);
CREATE INDEX IF NOT EXISTS idx_besucher_sitzungen_zuletzt ON besucher_sitzungen(zuletzt);

-- Neue grobe Angaben je Ereignis, alle aus dem ohnehin gesendeten Seitenabruf:
-- Betriebssystem mit Hauptversion (aus der Browserkennung), erste
-- Browsersprache (nur Sprachcode aus Accept-Language) und die Kampagnen-
-- Kennung aus dem Link (utm_source/utm_campaign).
ALTER TABLE besucher_ereignisse ADD COLUMN system TEXT;
ALTER TABLE besucher_ereignisse ADD COLUMN browser_sprache TEXT;
ALTER TABLE besucher_ereignisse ADD COLUMN kampagne TEXT;

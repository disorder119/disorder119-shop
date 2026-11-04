-- Verdacht auf automatisierte Aufrufe je Besuch (Crawler mit Browserkennung,
-- Scanner aus Rechenzentren): Punkte aus Netz (Hoster), Tempo und Muster.
-- Ab 2 Punkten gibt es keine Telegram-Zusammenfassung (meldung_grund 'bot');
-- der Besuch bleibt in der Admin-App sichtbar. Keine neuen Besucherdaten.
ALTER TABLE besucher_sitzungen ADD COLUMN verdacht INTEGER NOT NULL DEFAULT 0 CHECK (verdacht BETWEEN 0 AND 99);

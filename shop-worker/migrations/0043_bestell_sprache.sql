-- Sprache der Bestellung (de/en/fr): in dieser Sprache gehen alle Mails an die
-- Kundin - Bestaetigung, Rechnung, Versand, Storno/Erstattung, Ruecksendung,
-- Konto-Link. Gespeichert beim Anlegen (Kasse /, /en/, /fr/), damit auch
-- spaeter in der Admin-App ausgeloeste Mails ("Versendet") sie kennen.
-- Alte Bestellungen bleiben Deutsch.
ALTER TABLE commerce_orders ADD COLUMN sprache TEXT NOT NULL DEFAULT 'de'
  CHECK (sprache IN ('de','en','fr'));

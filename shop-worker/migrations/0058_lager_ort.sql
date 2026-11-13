-- Lager: Teil gehoert in die Kiste, liegt aber gerade woanders (z. B. in der Wohnung).
-- Leer = liegt in der Kiste. Erscheint in der Admin-App als Aufgabe "zurueck ins Lager legen".
ALTER TABLE lager_plaetze ADD COLUMN ort TEXT NOT NULL DEFAULT '';
UPDATE lager_plaetze SET ort='wohnung' WHERE artikel='13';

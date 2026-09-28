-- Vorschaubild je bestelltem Stueck, gespeichert beim Bestellen wie der Titel
-- (title_snapshot). Bestellbestaetigung und Versandmail zeigen damit das Foto,
-- ohne den Katalog abzufragen - auch wenn das Stueck spaeter verkauft ist.
-- Pfad relativ zur Website, z. B. "assets/img/9428/thumbs/0.webp".
ALTER TABLE order_items ADD COLUMN bild TEXT;

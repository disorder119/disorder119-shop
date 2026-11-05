-- Postfach wie ein echtes Mailpostfach: Anhaenge (PDF, Bilder, QR-Codes) und die
-- HTML-Ansicht werden gespeichert und in der Admin-App 1:1 angezeigt.
-- D1 erlaubt bis 2 MB je Zeile: groessere Anhaenge werden nur mit Name und Groesse
-- vermerkt (daten NULL, die Originalmail liegt als Kopie im Gmail).
ALTER TABLE postfach ADD COLUMN body_html TEXT;

CREATE TABLE IF NOT EXISTS postfach_anhaenge (
  id TEXT PRIMARY KEY,
  mail_id TEXT NOT NULL,
  pos INTEGER NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  typ TEXT NOT NULL DEFAULT 'application/octet-stream',
  cid TEXT,
  inline INTEGER NOT NULL DEFAULT 0,
  groesse INTEGER NOT NULL DEFAULT 0,
  daten BLOB,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_postfach_anhaenge_mail ON postfach_anhaenge(mail_id, pos);

-- DHL-Marke: seit DHLs Umstellung (04.11.2026) laeuft der QR-Abruf ueber die PAKID.
-- Zusaetzlich die Marke als PDF, falls DHL sie liefert, und eine Bremse fuer Wiederholungen.
ALTER TABLE dhl_qr_marken ADD COLUMN label_pdf_b64 TEXT;
ALTER TABLE dhl_qr_marken ADD COLUMN qr_versuche INTEGER NOT NULL DEFAULT 0;
ALTER TABLE dhl_qr_marken ADD COLUMN qr_versucht_am TEXT;

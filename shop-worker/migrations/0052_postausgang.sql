-- Postausgang: jede Mail, die der Shop verschickt (Bestellung, Versand, Rechnung,
-- Newsletter, selbst geschriebene Mails aus der Admin-App), mit Empfaenger,
-- Betreff und genau dem Inhalt, der beim Empfaenger ankommt. Anmeldelinks und
-- Bestaetigungslinks werden nur als Eintrag ohne Inhalt gefuehrt (vertraulich).
CREATE TABLE IF NOT EXISTS postausgang (
  id TEXT PRIMARY KEY,
  gesendet_am TEXT NOT NULL,
  an_email TEXT NOT NULL,
  an_name TEXT,
  betreff TEXT NOT NULL,
  html TEXT,
  text TEXT,
  tag TEXT,
  art TEXT NOT NULL DEFAULT 'AUTO',
  anhaenge_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL,
  fehler TEXT,
  message_id TEXT,
  antwort_auf TEXT,
  vertraulich INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_postausgang_zeit ON postausgang(gesendet_am);

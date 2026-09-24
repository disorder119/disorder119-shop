-- Disorder119 Postfach: eingehende Mails an die Shop-Adresse (Cloudflare
-- Email Routing -> Worker email()) und die daraus gesendeten Antworten.
-- Kundenmails sind private Betriebsdaten: nur D1, nie das oeffentliche Repo.
-- Gespeichert wird nur der Text, kein fremdes HTML und keine Anhaenge; das
-- vollstaendige Original geht als Kopie an MAIL_FORWARD_TO.
-- Handelsbriefe unterliegen Aufbewahrungsfristen (§ 257 HGB), deshalb gibt es
-- bewusst keine automatische Loeschung.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS postfach_nachrichten (
  id TEXT PRIMARY KEY,
  empfangen_am TEXT NOT NULL,
  an TEXT NOT NULL,
  von TEXT NOT NULL,
  von_name TEXT,
  antwort_an TEXT,
  betreff TEXT NOT NULL DEFAULT '',
  text TEXT NOT NULL DEFAULT '',
  text_gekuerzt INTEGER NOT NULL DEFAULT 0 CHECK (text_gekuerzt IN (0, 1)),
  anhaenge_json TEXT NOT NULL DEFAULT '[]',
  message_id TEXT,
  in_reply_to TEXT,
  groesse INTEGER NOT NULL DEFAULT 0 CHECK (groesse >= 0),
  spam_verdacht INTEGER NOT NULL DEFAULT 0 CHECK (spam_verdacht IN (0, 1)),
  weitergeleitet INTEGER NOT NULL DEFAULT 0 CHECK (weitergeleitet IN (0, 1)),
  gelesen_am TEXT,
  archiviert_am TEXT,
  beantwortet_am TEXT
);

CREATE INDEX IF NOT EXISTS idx_postfach_liste
  ON postfach_nachrichten(archiviert_am, empfangen_am);

-- Zustellwiederholungen desselben Mailservers erzeugen keinen zweiten Eintrag.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_postfach_message_id
  ON postfach_nachrichten(message_id) WHERE message_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS postfach_antworten (
  id TEXT PRIMARY KEY,
  nachricht_id TEXT NOT NULL REFERENCES postfach_nachrichten(id) ON DELETE CASCADE,
  an TEXT NOT NULL,
  betreff TEXT NOT NULL,
  text TEXT NOT NULL,
  gesendet_am TEXT NOT NULL,
  provider_message_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_postfach_antworten_nachricht
  ON postfach_antworten(nachricht_id, gesendet_am);

-- Postfach: Mails an kontakt@disorder119.com für die Admin-App.
CREATE TABLE IF NOT EXISTS postfach (
  id TEXT PRIMARY KEY,
  received_at TEXT NOT NULL,
  from_email TEXT NOT NULL,
  from_name TEXT NOT NULL DEFAULT '',
  reply_to TEXT NOT NULL DEFAULT '',
  to_email TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT '',
  body_text TEXT NOT NULL DEFAULT '',
  message_id TEXT NOT NULL DEFAULT '',
  in_reply_to TEXT NOT NULL DEFAULT '',
  attachments_json TEXT NOT NULL DEFAULT '[]',
  size_bytes INTEGER NOT NULL DEFAULT 0,
  read_at TEXT,
  archived_at TEXT
);
CREATE INDEX IF NOT EXISTS postfach_eingang ON postfach (archived_at, received_at DESC);

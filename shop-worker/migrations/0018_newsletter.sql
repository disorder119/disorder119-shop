-- Newsletter mit Double-Opt-in und einmaligem 10-%-Willkommenscode.
-- Apply after 0017_postfach.sql.
--
-- Eine Zeile pro Adresse. Erst die Bestaetigung per Mail zaehlt als
-- Einwilligung (§ 7 Abs. 2 UWG, Art. 7 Abs. 1 DSGVO): Zeitpunkt, Wortlaut und
-- Herkunft der Einwilligung bleiben hier stehen, damit sie sich nachweisen
-- laesst. Tokens liegen nur als SHA-256 in der Datenbank.
-- coupon_id bleibt auch nach einer Abmeldung gesetzt: den Rabatt gibt es pro
-- Adresse genau einmal, auch wenn sich jemand ab- und wieder anmeldet.
CREATE TABLE IF NOT EXISTS newsletter_subscribers (
  id TEXT PRIMARY KEY,
  email_normalized TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('PENDING','CONFIRMED','UNSUBSCRIBED')),
  lang TEXT NOT NULL DEFAULT 'de' CHECK (lang IN ('de','en','fr')),
  source TEXT,
  consent_text TEXT NOT NULL,
  consent_version TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  request_ip_hash TEXT,
  confirm_token_hash TEXT,
  confirm_expires_at TEXT,
  last_confirm_mail_at TEXT,
  confirmed_at TEXT,
  confirm_ip_hash TEXT,
  unsubscribe_token_hash TEXT UNIQUE,
  unsubscribed_at TEXT,
  coupon_id TEXT,
  coupon_hint TEXT,
  brevo_synced_at TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (coupon_id) REFERENCES reward_coupons(id)
);

CREATE INDEX IF NOT EXISTS idx_newsletter_status ON newsletter_subscribers(status, confirmed_at DESC);
CREATE INDEX IF NOT EXISTS idx_newsletter_confirm_token ON newsletter_subscribers(confirm_token_hash);
CREATE INDEX IF NOT EXISTS idx_newsletter_mail_window ON newsletter_subscribers(last_confirm_mail_at);
CREATE INDEX IF NOT EXISTS idx_newsletter_ip_window ON newsletter_subscribers(request_ip_hash, last_confirm_mail_at);

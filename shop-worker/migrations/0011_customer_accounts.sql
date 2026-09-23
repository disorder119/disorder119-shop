-- Disorder119 Kundenkonto: Anmeldung per E-Mail-Link, serverseitige Sitzungen.
-- Apply after 0010_coupon_checkout.sql.

-- Bewusst ohne Passwoerter. Ein Konto ohne gespeichertes Passwort kann weder
-- durch ein Leck noch durch Wiederverwendung anderswo kompromittiert werden,
-- und die Kundin identifiziert sich ohnehin schon ueber die E-Mail-Adresse, mit
-- der sie bei PayPal bezahlt hat.
--
-- In beiden Tabellen steht als id der SHA-256-Abdruck des jeweiligen Tokens,
-- nie das Token selbst. Wer die Datenbank liest, kann sich damit nicht anmelden.

CREATE TABLE IF NOT EXISTS customer_login_tokens (
  id TEXT PRIMARY KEY,
  email_normalized TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  -- Nur ein Abdruck, keine Klartext-IP: reicht fuer Missbrauchserkennung,
  -- speichert aber kein zusaetzliches Personendatum.
  request_ip_hash TEXT
);
CREATE INDEX IF NOT EXISTS idx_login_tokens_email ON customer_login_tokens(email_normalized, created_at);
CREATE INDEX IF NOT EXISTS idx_login_tokens_expiry ON customer_login_tokens(expires_at);

CREATE TABLE IF NOT EXISTS customer_sessions (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT,
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_customer_sessions_customer ON customer_sessions(customer_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_customer_sessions_expiry ON customer_sessions(expires_at);

-- Ein abgelaufener oder benutzter Anmeldelink darf nicht ewig liegen bleiben.
-- Der Worker raeumt bei jeder Anmeldung auf; dieser Trigger sorgt dafuer, dass
-- auch ohne Aufraeumlauf nie zwei gueltige Links derselben Adresse existieren.
CREATE TRIGGER IF NOT EXISTS trg_login_token_single_active
AFTER INSERT ON customer_login_tokens
FOR EACH ROW
BEGIN
  DELETE FROM customer_login_tokens
   WHERE email_normalized = NEW.email_normalized
     AND id <> NEW.id;
END;

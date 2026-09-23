-- Disorder119 Kundenkonto: Anmeldelinks gegen Missbrauch absichern.
-- Apply after 0012_rechnungsarchiv.sql.

-- 0011 hat beim Ausstellen eines neuen Anmeldelinks alle aelteren derselben
-- Adresse geloescht. Damit sah die Grenze "fuenf Links je Adresse und Stunde"
-- nie mehr als einen Link, und ein Skript konnte einem fremden Postfach
-- beliebig viele Anmeldemails schicken. Aeltere Links werden jetzt nur noch
-- entwertet - gezaehlt werden sie weiter. Geloescht werden sie vom Worker erst,
-- wenn sie fuer keine Grenze mehr zaehlen (nach zwei Tagen).
DROP TRIGGER IF EXISTS trg_login_token_single_active;
CREATE TRIGGER IF NOT EXISTS trg_login_token_single_active
AFTER INSERT ON customer_login_tokens
FOR EACH ROW
BEGIN
  UPDATE customer_login_tokens
     SET used_at = NEW.created_at
   WHERE email_normalized = NEW.email_normalized
     AND id <> NEW.id
     AND used_at IS NULL;
END;

-- Fuer die Grenze je Anschluss und die Tagesobergrenze des ganzen Shops.
CREATE INDEX IF NOT EXISTS idx_login_tokens_ip ON customer_login_tokens(request_ip_hash, created_at);
CREATE INDEX IF NOT EXISTS idx_login_tokens_created ON customer_login_tokens(created_at);

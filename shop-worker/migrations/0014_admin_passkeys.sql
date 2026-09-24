-- Disorder119 Admin: Anmeldung per Passkey (Face ID, Windows Hello).
-- Apply after 0013_login_schutz.sql.
--
-- Gespeichert werden nur oeffentliche Schluessel und Abdruecke. Wer diese
-- Tabellen liest, kann sich damit nicht anmelden: der private Schluessel
-- verlaesst den Sicherheitschip des Geraets nie, und von Sitzungen und
-- Kopplungscodes liegt nur der SHA-256-Abdruck hier.

CREATE TABLE IF NOT EXISTS admin_passkeys (
  id TEXT PRIMARY KEY,                 -- Credential-ID (base64url)
  name TEXT NOT NULL,                  -- "iPhone", "Laptop"
  rp_id TEXT NOT NULL,                 -- admin.disorder119.com
  public_key_jwk TEXT NOT NULL,
  algorithm INTEGER NOT NULL CHECK (algorithm IN (-7, -257)),
  sign_count INTEGER NOT NULL DEFAULT 0,
  aaguid TEXT,
  -- 1 = synchronisierbarer Passkey (iCloud-Schluesselbund, Google- oder
  -- anderer Passwort-Manager), 0 = liegt nur im Chip dieses Geraets.
  backup_eligible INTEGER NOT NULL DEFAULT 0 CHECK (backup_eligible IN (0, 1)),
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS admin_auth_challenges (
  id TEXT PRIMARY KEY,                 -- die Challenge selbst (base64url, einmalig)
  purpose TEXT NOT NULL CHECK (purpose IN ('register', 'login')),
  rp_id TEXT NOT NULL,
  origin TEXT NOT NULL,
  grant_ref TEXT,                      -- 'setup' oder 'pairing:<id>' bei Freischaltungen
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_admin_challenges_expiry ON admin_auth_challenges(expires_at);

CREATE TABLE IF NOT EXISTS admin_sessions (
  id TEXT PRIMARY KEY,                 -- SHA-256 des Sitzungs-Cookies
  passkey_id TEXT NOT NULL REFERENCES admin_passkeys(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT,
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_passkey ON admin_sessions(passkey_id, revoked_at);

CREATE TABLE IF NOT EXISTS admin_pairing_codes (
  id TEXT PRIMARY KEY,                 -- SHA-256 des Kopplungscodes
  created_by_passkey TEXT NOT NULL REFERENCES admin_passkeys(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);

-- Ein entferntes Geraet bleibt entfernt: kein Weg zurueck ueber ein UPDATE.
CREATE TRIGGER IF NOT EXISTS trg_admin_passkey_revoke_final
BEFORE UPDATE OF revoked_at ON admin_passkeys
FOR EACH ROW
WHEN OLD.revoked_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'admin_passkey_revoke_is_final');
END;

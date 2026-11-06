-- PC Manager: zweite, getrennte Freigabe "Neue Artikel als Entwurf senden".
-- Die lesende Datensatz-Freigabe aus 0031 bleibt unveraendert: eigene Tabelle,
-- eigener Bearer, eigene CHECK-Bedingung. Eine Anfrage merkt sich, welche
-- Freigabe der Manager verlangt hat; bestehende Zeilen bleiben lesend.
ALTER TABLE manager_auth_requests ADD COLUMN scope TEXT NOT NULL DEFAULT 'shop_dataset_read'
 CHECK(scope IN ('shop_dataset_read','katalog_entwurf'));
CREATE TABLE manager_katalog_grants (
 id TEXT PRIMARY KEY,
 request_id TEXT NOT NULL UNIQUE REFERENCES manager_auth_requests(id),
 token_hash TEXT NOT NULL UNIQUE,
 passkey_id TEXT NOT NULL REFERENCES admin_passkeys(id),
 device_name TEXT NOT NULL,
 scope TEXT NOT NULL CHECK(scope='katalog_entwurf'),
 created_at TEXT NOT NULL,
 expires_at TEXT NOT NULL,
 revoked_at TEXT
);
CREATE INDEX idx_manager_katalog_grant_expiry ON manager_katalog_grants(expires_at);
CREATE TRIGGER trg_manager_katalog_grant_revoke_final BEFORE UPDATE ON manager_katalog_grants
WHEN OLD.revoked_at IS NOT NULL BEGIN SELECT RAISE(ABORT,'manager_grant_revoke_is_final'); END;

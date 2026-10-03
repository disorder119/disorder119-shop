-- Separate, revocable dataset grants. Never grants general admin rights.
CREATE TABLE manager_auth_requests (
 id TEXT PRIMARY KEY,
 device_name TEXT NOT NULL,
 redirect_uri TEXT NOT NULL,
 state TEXT NOT NULL,
 challenge TEXT NOT NULL,
 created_at TEXT NOT NULL,
 expires_at TEXT NOT NULL,
 approved_by TEXT REFERENCES admin_passkeys(id),
 code_hash TEXT UNIQUE,
 code_expires_at TEXT,
 used_at TEXT,
 denied_at TEXT
);
CREATE INDEX idx_manager_request_expiry ON manager_auth_requests(expires_at);
CREATE TABLE manager_dataset_grants (
 id TEXT PRIMARY KEY,
 request_id TEXT NOT NULL UNIQUE REFERENCES manager_auth_requests(id),
 token_hash TEXT NOT NULL UNIQUE,
 passkey_id TEXT NOT NULL REFERENCES admin_passkeys(id),
 device_name TEXT NOT NULL,
 scope TEXT NOT NULL CHECK(scope='shop_dataset_read'),
 created_at TEXT NOT NULL,
 expires_at TEXT NOT NULL,
 revoked_at TEXT
);
CREATE INDEX idx_manager_grant_expiry ON manager_dataset_grants(expires_at);
CREATE TRIGGER trg_manager_grant_revoke_final BEFORE UPDATE ON manager_dataset_grants
WHEN OLD.revoked_at IS NOT NULL BEGIN SELECT RAISE(ABORT,'manager_grant_revoke_is_final'); END;

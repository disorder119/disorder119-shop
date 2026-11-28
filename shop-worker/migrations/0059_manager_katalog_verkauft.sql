-- PC Manager: dritte, getrennte Freigabe "Verkauf melden" (katalog_verkauft).
-- Der Manager meldet ein Stueck, das auf Vinted, eBay oder anderswo verkauft
-- wurde; der Worker stellt es im Shop auf SOLD (manager-verkauft.js).
--
-- Eigene Anfragetabelle statt einer weiteren scope-Spalte: Der CHECK von
-- manager_auth_requests.scope (0056) kennt nur 'shop_dataset_read' und
-- 'katalog_entwurf', und SQLite kann eine CHECK-Bedingung nicht aendern. Neu
-- anlegen ginge nur per DROP TABLE - auf manager_auth_requests verweisen aber
-- beide Freigabetabellen, und D1 prueft Fremdschluessel immer (auch mit
-- defer_foreign_keys scheitert der Commit). Diese Migration ist deshalb rein
-- additiv: bestehende Tabellen, Freigaben und CHECKs bleiben unveraendert.
CREATE TABLE manager_verkauft_requests (
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
 denied_at TEXT,
 scope TEXT NOT NULL DEFAULT 'katalog_verkauft' CHECK(scope='katalog_verkauft')
);
CREATE INDEX idx_manager_verkauft_request_expiry ON manager_verkauft_requests(expires_at);
CREATE TABLE manager_verkauft_grants (
 id TEXT PRIMARY KEY,
 request_id TEXT NOT NULL UNIQUE REFERENCES manager_verkauft_requests(id),
 token_hash TEXT NOT NULL UNIQUE,
 passkey_id TEXT NOT NULL REFERENCES admin_passkeys(id),
 device_name TEXT NOT NULL,
 scope TEXT NOT NULL CHECK(scope='katalog_verkauft'),
 created_at TEXT NOT NULL,
 expires_at TEXT NOT NULL,
 revoked_at TEXT
);
CREATE INDEX idx_manager_verkauft_grant_expiry ON manager_verkauft_grants(expires_at);
CREATE TRIGGER trg_manager_verkauft_grant_revoke_final BEFORE UPDATE ON manager_verkauft_grants
WHEN OLD.revoked_at IS NOT NULL BEGIN SELECT RAISE(ABORT,'manager_grant_revoke_is_final'); END;
-- Jede Verkaufsmeldung genau einmal (request_id = UUID aus dem Manager). Nur
-- fertige 200-Antworten bleiben gespeichert und werden wiederholt; laeuft ein
-- Versuch noch, steht seine Kennung in "versuch". Abgelehnte Meldungen (409,
-- 404, 5xx) werden nicht gespeichert und bei einer Wiederholung neu geprueft.
CREATE TABLE manager_verkauft_meldungen (
 request_id TEXT PRIMARY KEY,
 grant_id TEXT NOT NULL REFERENCES manager_verkauft_grants(id),
 artikelnummer TEXT NOT NULL,
 plattform TEXT NOT NULL CHECK(plattform IN ('vinted','ebay','sonstige')),
 verkauft_am TEXT NOT NULL,
 shop_id INTEGER,
 versuch TEXT,
 antwort_status INTEGER,
 antwort_json TEXT,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE INDEX idx_manager_verkauft_meldung_artikel ON manager_verkauft_meldungen(artikelnummer, created_at);

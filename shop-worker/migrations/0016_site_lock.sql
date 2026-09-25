-- Shop vorübergehend sperren (Passwort-Seite), gesteuert aus der Admin-App.
-- Eine kleine Schlüssel-Wert-Tabelle für Einstellungen des Shops.
CREATE TABLE IF NOT EXISTS site_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

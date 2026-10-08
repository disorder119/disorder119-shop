-- Versand zu Privatpreisen (config/shop-config.json versand.quelle "fest"):
-- DHL und DPD mit festen Preisen statt Packlink, DHL auch an Packstation und
-- Filiale. order_versand bekommt dafuer
--   * quelle 'fest' (bisher nur 'packlink' und 'ersatz'),
--   * zustellart: 'haustuer', 'packstation' oder 'filiale',
--   * abholort_json: die gewaehlte Packstation/Filiale (Nummer, Name,
--     Anschrift) - die Postnummer der Kundin steht nur in der Lieferadresse.
-- SQLite kann eine CHECK-Bedingung nicht aendern: Tabelle neu anlegen, alle
-- Zeilen unveraendert uebernehmen, alte Tabelle ersetzen. Keine andere
-- Tabelle verweist auf order_versand.
CREATE TABLE order_versand_neu (
  order_id TEXT PRIMARY KEY REFERENCES commerce_orders(id),
  option_id TEXT NOT NULL,
  art TEXT NOT NULL CHECK (art IN ('standard','express')),
  quelle TEXT NOT NULL CHECK (quelle IN ('packlink','ersatz','fest')),
  packlink_service_id INTEGER,
  carrier TEXT,
  service_name TEXT,
  paket TEXT NOT NULL CHECK (paket IN ('S','M','L')),
  preis_cents INTEGER NOT NULL CHECK (preis_cents >= 0),
  laufzeit TEXT,
  created_at TEXT NOT NULL,
  zustellart TEXT NOT NULL DEFAULT 'haustuer' CHECK (zustellart IN ('haustuer','packstation','filiale')),
  abholort_json TEXT
);

INSERT INTO order_versand_neu
  (order_id,option_id,art,quelle,packlink_service_id,carrier,service_name,paket,preis_cents,laufzeit,created_at)
SELECT order_id,option_id,art,quelle,packlink_service_id,carrier,service_name,paket,preis_cents,laufzeit,created_at
FROM order_versand;

DROP TABLE order_versand;

ALTER TABLE order_versand_neu RENAME TO order_versand;

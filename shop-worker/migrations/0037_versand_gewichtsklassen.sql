-- Nur noch DHL, Paket nach Gewicht (config/shop-config.json versand.pakete):
--   S = bis 2 kg (60 x 30 x 15 cm), M = bis 5 kg, L = bis 10 kg,
--   XL = bis 20 kg, XXL = bis 31,5 kg.
-- order_versand.paket erlaubte bisher nur S, M und L. SQLite kann eine
-- CHECK-Bedingung nicht aendern: Tabelle neu anlegen, alle Zeilen
-- unveraendert uebernehmen, alte Tabelle ersetzen (wie 0036).
CREATE TABLE order_versand_neu (
  order_id TEXT PRIMARY KEY REFERENCES commerce_orders(id),
  option_id TEXT NOT NULL,
  art TEXT NOT NULL CHECK (art IN ('standard','express')),
  quelle TEXT NOT NULL CHECK (quelle IN ('packlink','ersatz','fest')),
  packlink_service_id INTEGER,
  carrier TEXT,
  service_name TEXT,
  paket TEXT NOT NULL CHECK (paket IN ('S','M','L','XL','XXL')),
  preis_cents INTEGER NOT NULL CHECK (preis_cents >= 0),
  laufzeit TEXT,
  created_at TEXT NOT NULL,
  zustellart TEXT NOT NULL DEFAULT 'haustuer' CHECK (zustellart IN ('haustuer','packstation','filiale')),
  abholort_json TEXT
);

INSERT INTO order_versand_neu
  (order_id,option_id,art,quelle,packlink_service_id,carrier,service_name,paket,preis_cents,laufzeit,created_at,zustellart,abholort_json)
SELECT order_id,option_id,art,quelle,packlink_service_id,carrier,service_name,paket,preis_cents,laufzeit,created_at,zustellart,abholort_json
FROM order_versand;

DROP TABLE order_versand;

ALTER TABLE order_versand_neu RENAME TO order_versand;

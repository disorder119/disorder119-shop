-- Versandkostenfrei ab einem Warenwert (config/shop-config.json,
-- versand.versandkostenfrei): Den guenstigsten Standardversand uebernimmt dann
-- der Shop, die Kundschaft zahlt dafuer 0 Cent.
--
-- order_versand.preis_cents ist der Versandpreis, den die Kundschaft bezahlt
-- hat (wie commerce_orders.shipping_cents), und darf deshalb jetzt 0 sein.
-- SQLite kann eine CHECK-Bedingung nicht aendern: Tabelle neu anlegen, alle
-- Zeilen unveraendert uebernehmen, alte Tabelle ersetzen. Keine andere
-- Tabelle verweist auf order_versand.
CREATE TABLE order_versand_neu (
  order_id TEXT PRIMARY KEY REFERENCES commerce_orders(id),
  option_id TEXT NOT NULL,
  art TEXT NOT NULL CHECK (art IN ('standard','express')),
  quelle TEXT NOT NULL CHECK (quelle IN ('packlink','ersatz')),
  packlink_service_id INTEGER,
  carrier TEXT,
  service_name TEXT,
  paket TEXT NOT NULL CHECK (paket IN ('S','M','L')),
  preis_cents INTEGER NOT NULL CHECK (preis_cents >= 0),
  laufzeit TEXT,
  created_at TEXT NOT NULL
);

INSERT INTO order_versand_neu
  (order_id,option_id,art,quelle,packlink_service_id,carrier,service_name,paket,preis_cents,laufzeit,created_at)
SELECT order_id,option_id,art,quelle,packlink_service_id,carrier,service_name,paket,preis_cents,laufzeit,created_at
FROM order_versand;

DROP TABLE order_versand;

ALTER TABLE order_versand_neu RENAME TO order_versand;

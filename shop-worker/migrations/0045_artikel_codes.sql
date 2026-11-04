-- Wort-Codes mit Festpreis fuer genau ein Stueck (z. B. ein Code fuer eine
-- bestimmte Beanie: 120 EUR -> 70 EUR). Sie liegen wie die Spiel- und
-- Newsletter-Codes in reward_coupons (nur der Hash), sind einmal einloesbar
-- und laufen durch dieselbe Reservierung/Einloesung (Trigger aus 0010).
-- item_id = Katalog-ID des Stuecks (order_items.item_id), fixed_price_cents =
-- Preis dieses Stuecks mit Code; der Rabatt gilt nur fuer diese Zeile.
-- Angelegt werden sie per wrangler d1 execute (siehe ARTIKELCODES.md).
ALTER TABLE reward_coupons ADD COLUMN item_id INTEGER;
ALTER TABLE reward_coupons ADD COLUMN fixed_price_cents INTEGER;
ALTER TABLE reward_coupons ADD COLUMN item_label TEXT;

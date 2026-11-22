# Artikel-Codes (Festpreis fuer ein Stueck)

Wort-Codes wie `CLOSERWITHNYLON`, die genau ein Stueck auf einen festen Preis setzen
(Migration `0045_artikel_codes.sql`). Sie liegen in `reward_coupons` wie die Spiel- und
Newsletter-Codes (nur SHA-256 des Codes in Grossbuchstaben), sind einmal einloesbar und
laufen durch dieselbe Reservierung, PayPal-Betragskorrektur und Einloesung.

- Kundinnen tippen den Code im Warenkorb (Gross-/Kleinschreibung egal) oder kommen ueber
  `https://disorder119.com/kasse/?products=<Artikelnummer>&coupon=<code>`.
- Nur die Zeile des Stuecks bekommt den Festpreis; andere Stuecke bleiben beim Normalpreis,
  der Versand kommt unveraendert dazu.
- Ist das Stueck nicht in der Bestellung, antwortet der Worker `COUPON_NOT_FOR_ORDER`, die
  Bestellung wird storniert, der Code ist sofort wieder frei und die Kasse entfernt ihn.
- Format: 6-32 Buchstaben/Ziffern (`normalizeArtikelCode` in `game-rewards.js`).

## Anlegen

`item_id` = Katalog-ID des Stuecks (`id` in `data/items.json`, nicht die Artikelnummer),
`fixed_price_cents` = Preis mit Code. `discount_bps` ist fuer Artikel-Codes nur eine Info
(Rabatt in Basispunkten, gerundet). Hash:
`node -e "console.log(require('crypto').createHash('sha256').update('CODE').digest('hex'))"`

```sql
INSERT INTO reward_coupons
  (id, code_hash, code_hint, discount_bps, username_key, status, created_at, item_id, fixed_price_cents, item_label)
VALUES ('artikelcode-<name>', '<sha256 von CODE>', '<letzte 4 Zeichen>', <bps>, 'artikelcode', 'ACTIVE',
        strftime('%Y-%m-%dT%H:%M:%fZ','now'), <katalog-id>, <cent>, '<Name im Warenkorb>');
```

`npx wrangler d1 execute disorder119-shop --remote --command "<SQL>"`. Sperren:
`UPDATE reward_coupons SET status='VOID' WHERE id='artikelcode-<name>'`.

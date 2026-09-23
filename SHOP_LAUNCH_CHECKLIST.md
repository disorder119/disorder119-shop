# Disorder119 — Professional Shop Launch Checklist

Diese Datei dokumentiert den technischen Stand fuer einen echten Checkout, ohne das bestehende Design oder die Modi Match, Chaos und Baukasten zu veraendern.

## Bereits im Repository abgesichert

- Produktpreise kommen fuer PayPal serverseitig aus `data/items.json`, nicht aus Browserdaten.
- Einzelstuecke werden vor dem Capture reserviert; Doppelverkaufsschutz nutzt den GitHub-Datei-SHA als optimistische Sperre.
- PayPal-Webhooks werden serverseitig verifiziert.
- DRAFT-Artikel duerfen nicht in `data/catalog.json` gelangen.
- Produktseiten besitzen Canonical/Hreflang/Product-JSON-LD.
- Impressum, AGB, Widerrufsbelehrung und Datenschutz sind vorhanden.
- Shop-Qualitaetspruefung: `python scripts/validate_shop.py`.
- Match/Chaos/Baukasten sind ueber `config/mode-guard.json` gegen unbeabsichtigte Aenderungen geschuetzt.
- Personenbezogene Betriebsdaten gehoeren in Cloudflare D1, nicht in das oeffentliche GitHub-Repository.

## Vor PayPal-Sandbox aktivieren

1. Cloudflare Worker deployen.
2. D1-Datenbank anlegen und `shop-worker/schema.sql` anwenden.
3. D1 als Binding `DB` am Worker konfigurieren.
4. Worker-Secrets setzen (`npx wrangler secret put NAME`):
   - `PAYPAL_CLIENT_ID`
   - `PAYPAL_CLIENT_SECRET`
   - `PAYPAL_WEBHOOK_ID`
   - `GITHUB_TOKEN` (nur Contents read/write fuer dieses Repository)
   - `ADMIN_READ_TOKEN` und `ADMIN_WRITE_TOKEN` (getrennte Rollen; der alte
     gemeinsame `ADMIN_TOKEN` funktioniert auf einem entfernten Worker nicht
     mehr, siehe `backend-runtime.js`)
   - `TURNSTILE_SECRET`
   - `TELEGRAM_BOT_TOKEN` (optional, fuer die Verkaufsmeldung)
   - `TELEGRAM_CHAT_ID` nur, wenn die automatische Verknuepfung nicht genutzt
     wird: sonst reicht eine private Nachricht an den eigenen Bot, der Worker
     merkt sich die Chat-ID selbst (`notifications.js`).
   - `MAIL_API_KEY` (Brevo, EU-Anbieter) — ohne diesen Schluessel wird **keine**
     Bestellbestaetigung verschickt. Die Bestaetigung ist nach § 312f BGB
     Pflicht, der Shop darf ohne sie nicht live gehen.
   - `MAIL_FROM` (z. B. `bestellung@disorder119.com`) und optional
     `MAIL_FROM_NAME`, `MAIL_REPLY_TO`.
   - Testen: `POST /admin/notifications/mail/test` (Owner-Token). Ohne Angabe
     im Aufruf geht die Testmail an `MAIL_REPLY_TO` bzw. `MAIL_FROM`.
5. DHL: Es gibt bisher **keine** DHL-Anbindung im Code, nur die Datenfelder
   fuer Versandstatus und Sendungsnummer. Labels werden vorerst manuell im
   DHL-Portal erzeugt und die Sendungsnummer im Admin eingetragen. Erst eine
   echte Label-Integration braucht eigene DHL-Zugangsdaten.
6. `PAYPAL_ENVIRONMENT=sandbox` am Worker setzen.
7. `config/shop-config.json` setzen:
   - `paypalClientId`
   - `shopWorkerUrl`
   - `environment: "sandbox"`
   - `features.paypalCheckout: true`
8. Sandbox-Testkauf durchfuehren und pruefen:
   - Reservierung
   - erfolgreicher Capture
   - SOLD-Markierung
   - Rebuild
   - Order-Eintrag in D1
   - DHL-Fehler darf Zahlung/SOLD nicht rueckgaengig machen
   - Webhook ist idempotent

## Eigene Shop-Mailadresse einrichten

Die Domain liegt bei Porkbun, ein Postfach gibt es noch nicht (kein MX-Eintrag).
Die Nameserver muessen dafuer **nicht** umgezogen werden — beides laeuft ueber
Eintraege im Porkbun-Panel:

1. **Empfangen:** Porkbun → Domain → *Email Forwarding*. `bestellung@disorder119.com`
   auf das eigene Postfach weiterleiten. Kostenlos, fertig in zwei Minuten.
2. **Senden:** Konto bei Brevo anlegen (Sitz Frankreich, Server in der EU —
   bewusst kein US-Anbieter, damit in der Datenschutzerklaerung keine
   Datenuebermittlung in die USA stehen muss). Dort die Domain
   `disorder119.com` verifizieren; Brevo nennt dazu drei DNS-Eintraege
   (DKIM, DMARC und eine Bestaetigung), die bei Porkbun eingetragen werden.
   Der bestehende SPF-Eintrag muss um `include:spf.brevo.com` ergaenzt werden.
3. **Schluessel setzen:** in Brevo einen API-Key erzeugen und selbst per
   `npx wrangler secret put MAIL_API_KEY` eintragen, dazu
   `npx wrangler secret put MAIL_FROM` mit `bestellung@disorder119.com`.
4. **Pruefen:** `POST /admin/notifications/mail/test` schickt eine Testmail an
   die eigene Adresse. Kommt sie an und landet nicht im Spam, ist DKIM/SPF in
   Ordnung.
5. Danach `config/shop-config.json` → `email` auf die neue Adresse umstellen,
   damit Impressum, AGB und Kontaktknoepfe dieselbe Adresse nennen.

## Vor Livebetrieb

- Sandbox-Test mit mindestens zwei parallelen Kaufversuchen fuer dasselbe Einzelstueck.
- PayPal-Live-App und Live-Webhook einrichten.
- `PAYPAL_ENVIRONMENT=live` setzen.
- Live Client ID in `config/shop-config.json` setzen; Client Secret bleibt ausschliesslich Worker-Secret.
- Datenschutztext um die dann tatsaechlich aktiv verwendeten Zahlungs-/Versanddienstleister ergaenzen und rechtlich pruefen.
- Versandkosten/Versandgebiet verbindlich festlegen.
- Testbestellung mit kleinem realen Betrag und anschliessendem Refund.
- Backup-/Export-Routine fuer private D1-Betriebsdaten festlegen.

## Nicht in GitHub speichern

Niemals committen:
- PayPal Client Secret
- GitHub PAT
- DHL-Zugangsdaten
- Admin-Token
- Kundennamen, Adressen, E-Mail-Adressen oder Bestellhistorien
- Verleih-Anfragen mit frei eingegebenen personenbezogenen Daten

`data/items.json` bleibt Produkt-/Inventarquelle. Private Transaktions- und Kundendaten gehoeren in D1 oder einen anderen privaten Datenspeicher.

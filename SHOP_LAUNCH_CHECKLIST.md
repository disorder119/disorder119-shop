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

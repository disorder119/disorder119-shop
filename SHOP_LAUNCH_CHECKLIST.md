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

## Gefuehrte Einrichtung

Schritte 1 bis 7 unten erledigt der Assistent in einem Durchgang: er meldet
bei Cloudflare an, legt D1 an und traegt die ID in `wrangler.toml` ein, spielt
alle Migrationen ein, veroeffentlicht den Worker, oeffnet fuer jedes Secret die
passende Anbieter-Seite im Browser und schreibt die oeffentlichen Werte in
`config/shop-config.json` (Checkout bleibt dabei aus).

```bash
cd shop-worker
node setup.mjs            # setzt dort fort, wo du aufgehoert hast
node setup.mjs --status   # was ist gesetzt, was fehlt
```

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
5. DHL — **zwei Wege, beide funktionieren:**
   - **Ohne Zugangsdaten (sofort nutzbar):** Label im DHL-Portal erzeugen,
     Sendungsnummer im Admin bei der Bestellung eintragen und den Status auf
     SHIPPED setzen. Die Kundin bekommt automatisch die Versandbestaetigung mit
     Sendungsnummer und Verfolgungslink. Der Shop kann so live gehen.
   - **Mit Anbindung (`shop-worker/dhl.js`):** `POST /admin/versand/<bestell-id>/label`
     erzeugt den Versandschein, traegt die Sendungsnummer ein und liefert die
     Label-Adresse zurueck. Dafuer noetig, alle als Worker-Secret:
     `DHL_API_KEY` (developer.dhl.com), `DHL_USER` und `DHL_PASSWORD`
     (Geschaeftskundenportal), `DHL_BILLING_NUMBER` (Abrechnungsnummer aus dem
     EKP). Optional `DHL_ENVIRONMENT=live` (Standard ist Sandbox),
     `DHL_DEFAULT_WEIGHT_G` und die `DHL_SHIPPER_*`-Felder.
     Voraussetzung ist ein **DHL-Geschaeftskundenvertrag** — ohne EKP-Nummer
     gibt es keinen API-Zugang.
   - Angebunden ist nur der nationale Versand (V01PAK). Auslandssendungen
     werden klar abgelehnt statt geraten: sie brauchen ein anderes Produkt und
     eine Zollinhaltserklaerung.
   - Ein zweiter Aufruf fuer dieselbe Bestellung erzeugt **keinen** zweiten
     Versandschein, sondern gibt den vorhandenen zurueck. Ein Schein kostet
     Geld und laesst sich nicht einfach zurueckgeben.
6. `PAYPAL_ENVIRONMENT=sandbox` am Worker setzen.
7. `config/shop-config.json` setzen:
   - `paypalClientId`
   - `shopWorkerUrl`
   - `turnstileSiteKey` (oeffentlicher Site-Key; im Live-Betrieb Pflicht, sonst
     bricht der Build ab, weil der Worker jeden Kauf ohne Turnstile-Token ablehnt)
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

Die Domain laeuft ueber Cloudflare-Nameserver (DNS in Cloudflare, registriert
bei Porkbun). Empfangen wird deshalb ueber **Cloudflare Email Routing** direkt
in den Worker, gesendet ueber Brevo:

1. **Empfangen:** Cloudflare → disorder119.com → Email Routing aktivieren. Dabei
   ersetzt Cloudflare die MX-Eintraege der bisherigen Porkbun-Weiterleitung.
   Unter „Destination addresses“ das eigene Postfach bestaetigen, unter
   „Routing rules“ `bestellung@disorder119.com` → „Send to a Worker“ → Shop-Worker.
2. **Postfach:** Der Worker (`postfach.js`) legt jede Mail als Text in D1 ab
   (Admin-API `GET /admin/postfach`) und schickt das vollstaendige Original mit
   Anhaengen an `MAIL_FORWARD_TO`. Fremdes HTML wird nie gespeichert oder
   ausgeliefert. Antworten gehen ueber `POST /admin/postfach/<id>/antwort`.
3. **Senden:** Konto bei Brevo anlegen (Sitz Frankreich, Server in der EU —
   bewusst kein US-Anbieter). Domain `disorder119.com` verifizieren und die drei
   DNS-Eintraege (DKIM, DMARC, Brevo-Code) in Cloudflare eintragen. Es darf nur
   **einen** SPF-Eintrag geben:
   `v=spf1 include:_spf.mx.cloudflare.net include:spf.brevo.com ~all`
4. **Schluessel setzen:** laeuft ueber `node setup.mjs` (MAIL_API_KEY, MAIL_FROM,
   MAIL_FORWARD_TO).
5. **Pruefen:** `POST /admin/notifications/mail/test` schickt eine Testmail. Eine
   Mail an `bestellung@disorder119.com` muss danach im Postfach der Admin-API
   und als Kopie im eigenen Postfach auftauchen.
6. Danach `config/shop-config.json` → `email` auf die neue Adresse umstellen,
   damit Impressum, AGB und Kontaktknoepfe dieselbe Adresse nennen.

## Buchhaltung

Aufgebaut wie der Vinted-Datenexport: eine Liste aller Bestellungen, eine
Rechnung je Bestellung, eine Zusammenfassung je Jahr. Alle drei Wege brauchen
den Owner-Token:

- `GET /admin/buchhaltung/jahr/2026` — Umsatz je Monat, Warenwert, Versand,
  Gesamt, plus Fruehwarnung zu den Kleinunternehmergrenzen nach § 19 UStG
  (25.000 EUR Vorjahr / 100.000 EUR laufendes Jahr).
- `GET /admin/buchhaltung/bestellungen.csv?jahr=2026` — fuer den Steuerberater,
  deutsche Dezimaltrennung, oeffnet direkt in Excel.
- `GET /admin/buchhaltung/rechnungen?jahr=2026` — alle ausgestellten Rechnungen
  des Jahres mit Nummer, Datum, Betrag und Pruefsumme.
- `GET /admin/buchhaltung/rechnung/<bestell-id>` — die Rechnung zum Ausdrucken
  oder Ablegen als PDF.

Jede verschickte Rechnung wird im Moment des Versands unveraenderlich
festgeschrieben (Tabelle `rechnungen`, Migration 0012). Aendert sich die
Bestellung spaeter im Admin, bleibt die ausgestellte Rechnung wie sie war -
genau das verlangt die GoBD. Liegt zu einer alten Bestellung keine archivierte
Fassung vor, wird eine aus den Bestelldaten erzeugt und sichtbar als solche
gekennzeichnet.

Mit gesetztem `MAIL_BCC` geht jede Rechnung zusaetzlich als Durchschlag ins
eigene Postfach. Der Durchschlag haengt ausdruecklich an der Rechnungsmail -
Anmeldelinks und Datenauskuenfte bekommen nie einen.

Gezaehlt werden nur bezahlte Bestellungen. Storniert, erstattet und
zurueckgesendet bleiben draussen, sonst stuende Geld in den Buechern, das nie
verdient wurde.

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

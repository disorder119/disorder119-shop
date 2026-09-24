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
2. D1-Datenbank anlegen (`npx wrangler d1 create disorder119-shop`), die
   ausgegebene `database_id` im vorbereiteten Block in
   `shop-worker/wrangler.toml` eintragen, dann
   `npx wrangler d1 execute disorder119-shop --remote --file=schema.sql` und
   `npx wrangler d1 migrations apply disorder119-shop --remote` (0002 bis 0013).
3. Der Ratenbegrenzer `RATE_LIMITER` steht fertig in `wrangler.toml`. Ohne ihn
   und ohne `TURNSTILE_SECRET` verweigert der Live-Worker Kauf, Miete und
   Konto-Anmeldung (`backend-runtime.js`).
4. Worker-Secrets setzen (`npx wrangler secret put NAME`):
   - `PAYPAL_CLIENT_ID`
   - `PAYPAL_CLIENT_SECRET`
   - `PAYPAL_WEBHOOK_ID`
   - `GITHUB_TOKEN` (fine-grained, nur dieses Repository: **Contents: Read and
     write** und **Pull requests: Read and write**). Damit markiert der Worker
     Verkaeufe und speichert der Katalog-Editor der Admin-App - ueber Pull
     Requests, weil der Main-Waechter direkte Pushes zurueckdreht.
   - `ADMIN_READ_TOKEN` und `ADMIN_WRITE_TOKEN` (getrennte Rollen; der alte
     gemeinsame `ADMIN_TOKEN` funktioniert auf einem entfernten Worker nicht
     mehr, siehe `backend-runtime.js`)
   - `TURNSTILE_SECRET` — das oeffentliche Gegenstueck (Site-Key) gehoert als
     `turnstileSiteKey` in `config/shop-config.json`. Der Build bricht ab, wenn
     `environment: "live"` ohne Site-Key gesetzt wird.
   - `LOGIN_IP_PEPPER` — eine lange Zufallszeichenkette. Die Konto-Anmeldung
     speichert von der IP nur einen Abdruck; ohne eigenen Pepper liesse sich
     der bei IPv4 zurueckrechnen.
   - optional `LOGIN_DAILY_CAP` (Standard 100): hoechstens so viele
     Anmeldelinks am Tag, damit das Mail-Kontingent fuer Rechnungen frei bleibt.
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
   - `turnstileSiteKey`
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

## Admin-App: Anmeldung per Face ID / Windows Hello

Die Admin-App (`admin.disorder119.com`, Repository `disorder119-admin`) meldet
sich per Passkey an (`shop-worker/admin-passkeys.js`, Migration 0014):

- **Erstes Geraet:** Admin-App oeffnen, einmal den `ADMIN_WRITE_TOKEN`
  einfuegen, Face ID bzw. Windows Hello bestaetigen. Das geht nur, solange noch
  kein Passkey existiert.
- **Weitere Geraete:** Auf einem angemeldeten Geraet unter *Geraete* einen
  Kopplungscode erzeugen (10 Minuten gueltig, einmal nutzbar) und auf dem
  neuen Geraet eintippen. Hoechstens `ADMIN_MAX_PASSKEYS` Geraete (Standard 2).
- Sobald ein Passkey existiert, oeffnen `ADMIN_READ_TOKEN`/`ADMIN_WRITE_TOKEN`
  allein nichts mehr (`PASSKEY_REQUIRED`). Fuer Skripte kann
  `ADMIN_BEARER_ENABLED=true` den Token bewusst weiter zulassen.
- Jede Anmeldung und jedes neue Geraet meldet sich per Telegram.
- Sitzung: HttpOnly-Cookie, `SameSite=Strict`, nur `/admin`, 12 Stunden
  (`ADMIN_SESSION_HOURS`), nur von `admin.disorder119.com` aus gueltig.
- **Beide Geraete verloren:** im Ordner `shop-worker`
  `npx wrangler d1 execute disorder119-shop --remote --command "DELETE FROM admin_sessions; DELETE FROM admin_pairing_codes; DELETE FROM admin_passkeys;"`
  - danach gilt wieder der Token fuer das erste Geraet. Das geht nur mit
  Zugang zum Cloudflare-Konto (Zwei-Faktor!).

## DHL-Versandmarke als QR-Code

Ohne Geschaeftskundenvertrag, fuer unter 200 Pakete im Jahr
(`shop-worker/dhl-qr.js`, Migration 0015, DHL "Parcel DE Private Shipping"):

1. Kostenloses Konto im DHL-Entwicklerportal, dort eine App anlegen und die
   API "DHL Parcel DE Private Shipping" freischalten lassen.
2. `npx wrangler secret put DHL_PRIVAT_API_KEY`, zum Testen
   `DHL_PRIVAT_ENVIRONMENT=sandbox`, danach `live`.
3. Absender: `DHL_SHIPPER_NAME`, `DHL_SHIPPER_STREET` (mit Hausnummer),
   `DHL_SHIPPER_POSTAL`, `DHL_SHIPPER_CITY` - ohne Angabe gelten die Werte aus
   dem Impressum.
4. In der Admin-App bei der Bestellung *QR-Versandmarke*: Groesse waehlen,
   Adresse pruefen, auf der DHL-Seite bezahlen, zurueck in die App - der
   QR-Code erscheint. An Packstation oder Filiale vorzeigen, dann
   *Versendet* tippen: die Kundin bekommt die Versandmail.

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

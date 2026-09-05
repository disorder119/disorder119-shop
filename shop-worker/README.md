# Disorder119 Commerce Worker

Serverseitige Commerce-Grundlage fuer Disorder119 auf Cloudflare Workers + D1. Diese Komponente veraendert weder das visuelle Design noch Match, Chaos oder Baukasten.

## Aktueller Produktionsstatus

Der Worker ist technisch vorbereitet, aber echter Checkout und Kundenkonten bleiben absichtlich deaktiviert, solange reale Infrastruktur und Zugangsdaten fehlen.

In `config/shop-config.json` bleiben deshalb insbesondere:

- `features.paypalCheckout: false`
- `features.customerAccounts: false`
- `paypalClientId: ""`
- `shopWorkerUrl: ""`

Keine dieser Optionen darf nur fuer Tests auf Produktion aktiviert werden.

## Source of truth

- `data/items.json`: kuratierter, oeffentlicher Produktkatalog.
- Cloudflare D1: private operative Daten fuer Inventar, Reservierungen, Bestellungen, Zahlungen, Mietvorgaenge, Versand, Retouren, Refunds, Admin-Notizen und Audit-Events.
- Zahlungs- und Kundeninformationen gehoeren niemals in oeffentliche GitHub-JSON-Dateien.
- Preise werden serverseitig aus vertrauenswuerdigen Katalogdaten bestimmt; der Browser ist keine Preisquelle.

## Mietpreis und Kaution

Die zentrale Regel lautet:

`Tagesmiete = 10 % des aktuellen Verkaufspreises`

Die Berechnung erfolgt in Integer-Cent mit Rundung auf zwei Nachkommastellen. Die Mietdauer wird serverseitig aus Start- und Enddatum berechnet und die Gesamtmiete ist `Tagespreis × Miettage`.

Die aktuelle Standard-Kaution wird bei der Mietanfrage serverseitig als Snapshot gespeichert:

`Kaution = 50 % des Verkaufspreises, mindestens 50 EUR je Artikel`

- SOLD-Artikel koennen nicht neu vermietet werden.
- Artikel ohne festen positiven Verkaufspreis bleiben `priceOnRequest`.
- `rental_days` verhindert ueberlappende aktive Mietbuchungen desselben Einzelstuecks fuer denselben Tag.
- `0003_state_integrity.sql` validiert Mietpreis und Gesamtpreis zusaetzlich direkt in D1.
- `0005_rental_groups.sql` schuetzt gebuendelte Mehrfachmieten auf Datenbankebene.

## Mehrfachmieten

`POST /rental-bundle` ist der bevorzugte Serverpfad fuer Rental V2 mit mehreren Pieces.

- Bis zu 20 Artikel koennen in einem Vorgang angefragt werden.
- Fuer den normalen Online-Flow sind maximal 7 Miettage vorgesehen; laengere Zeitraeume bleiben manuelle Anfrage.
- Alle Einzelpreise werden serverseitig aus dem aktuellen Katalog neu berechnet.
- Jede Kaution wird serverseitig neu berechnet und anschliessend im Bundle gesummt.
- Das Bundle beginnt intern als `BUILDING` und wird erst `RESERVED`, wenn alle erwarteten Child-Reservierungen vorhanden sind.
- D1-Trigger vergleichen Anzahl, Mietsumme und Kautionssumme mit den Child-Reservierungen.
- Scheitert ein Piece an Verfuegbarkeit oder Integritaet, soll der gesamte D1-Batch fehlschlagen statt eine Teilreservierung zu hinterlassen.
- Der Request ist idempotent; derselbe Key mit anderem Payload wird abgewiesen.
- Die akzeptierte Mietbedingungs-Version und der Akzeptanzzeitpunkt werden mit dem Bundle gespeichert.

Der alte `POST /rental-request` bleibt als kompatibler Einzelartikel-Pfad erhalten. Rental V2 nutzt bei konfiguriertem Worker den gebuendelten `/rental-bundle`-Pfad.

## Einzelstueck- und Bestellschutz

Kaeufe werden vor dem Zahlungsstart reserviert. Die Standard-Reservierung laeuft nach 15 Minuten ab.

Inventar- und Order-Lifecycle sind serverseitig begrenzt. Unzulaessige Statusspruenge werden sowohl in der Worker-Logik als auch ueber D1-Trigger verhindert.

Doppelte oder wiederholte Requests verwenden `Idempotency-Key`. Der Key wird an einen kanonischen Request-Hash gebunden; derselbe Key mit anderem Payload wird abgewiesen. Provider-Webhooks werden ueber eindeutige Event-IDs dedupliziert.

## Admin / Operations

Der private Admin-Client lebt absichtlich im separaten privaten Repo `disorder119/disorder119-admin`.

Der Worker stellt unter `/admin/*` private Operations-Routen bereit fuer:

- Uebersicht und Business-Insights,
- Bestellungen und Statuswechsel,
- Payments,
- Versand und Tracking,
- Vermietungen,
- Inventar,
- Kunden,
- Retouren und Refunds,
- Audit-Aktivitaet,
- Systemzustand,
- interne Admin-Notizen.

`ADMIN_TOKEN` ist nur eine temporaere Betriebsbruecke. Vor echtem breitem Produktivbetrieb sollte `admin.disorder119.com` zusaetzlich mit Cloudflare Access/MFA abgesichert werden.

## PayPal

PayPal ist vorbereitet, aber nicht live aktiviert.

Vor Aktivierung werden benoetigt:

1. Cloudflare Worker Deployment + D1-Datenbank als Binding `DB`.
2. `PAYPAL_CLIENT_ID` als serverseitiges Worker-Secret/Env und die oeffentliche Client-ID fuer die Frontend-Konfiguration.
3. `PAYPAL_CLIENT_SECRET` als Worker-Secret.
4. `PAYPAL_WEBHOOK_ID` als Worker-Secret.
5. Ein restriktiver `GITHUB_TOKEN`, falls der Worker den oeffentlichen Katalog nach erfolgreicher Zahlung weiterhin auf `SOLD` synchronisieren soll.
6. Eine reale `shopWorkerUrl` in `config/shop-config.json`.
7. Vollstaendiger Sandbox-End-to-End-Test inklusive Webhook, Idempotenz, Reservierungsablauf und Fehlerszenarien.

PayPal-Provider-Order-IDs und Payment-IDs bleiben in D1 und werden nicht in `data/items.json` geschrieben.

## Webhook-Sicherheit

Der PayPal-Webhook:

- verifiziert die Signatur ueber PayPal,
- akzeptiert nur frische Transmission-Zeitstempel,
- speichert Provider-Event-IDs eindeutig,
- verarbeitet Duplikate als No-op,
- speichert nur einen SHA-256-Hash des Event-Payloads fuer Integritaets-/Audit-Zwecke,
- loggt keine Secrets, Tokens oder vollstaendigen sensiblen Zahlungs-Payloads.

## D1 einrichten

Migrationen in dieser Reihenfolge anwenden:

1. `shop-worker/schema.sql` fuer bestehende Legacy-Installationen, falls noch nicht vorhanden.
2. `shop-worker/migrations/0002_commerce_foundation.sql`.
3. `shop-worker/migrations/0003_state_integrity.sql`.
4. `shop-worker/migrations/0004_admin_operations.sql`.
5. `shop-worker/migrations/0005_rental_groups.sql`.
6. Datenbank als Worker-Binding `DB` konfigurieren.

Die CI fuehrt die komplette Kette zusaetzlich in einer frischen SQLite-Datenbank aus. Vor Produktion muss die Migration dennoch in einer Cloudflare-D1-Testumgebung durchgespielt und ein Backup/Restore-Verfahren getestet werden.

Die Migrationen sind fuer eine einmalige, geordnete Anwendung gedacht. Bereits angewendete `ALTER TABLE`-Migrationen duerfen nicht blind erneut ausgefuehrt werden.

## Kundenkonten

Keine eigene Passwortdatenbank bauen. Vorgesehen ist ein externer Auth-Provider, bevorzugt Supabase Auth oder ein anderer OIDC-kompatibler Dienst.

Vorbereitet sind Datenmodelle fuer:

- Kundenprofile und Adressen,
- externe Auth-Subjects,
- Bestell- und Mietverlauf,
- Account-Export und Account-Loeschung.

Die `/account/*`-Routen bleiben absichtlich deaktiviert und antworten mit `AUTH_PROVIDER_NOT_CONFIGURED`, bis echte JWT-/Session-Verifikation konfiguriert ist. Gastbestellung bleibt vorgesehen.

## Optionaler Abuse-Schutz

Der Worker unterstuetzt optional:

- `RATE_LIMITER`
- `TURNSTILE_SECRET`

Sind diese Bindings nicht gesetzt, wird kein nicht konfiguriertes Feature vorgetaeuscht. Vor Live-Start sollten sie je nach Traffic- und Missbrauchsprofil bewusst aktiviert und getestet werden.

## Versand, E-Mail und DHL

Die Datenstruktur fuer Versandstatus und Tracking existiert, aber eine produktive DHL-Label-Integration und ein E-Mail-Provider sind derzeit **nicht** implementiert/konfiguriert. Es wird daher nichts automatisch als versendet bestaetigt und kein DHL-Label vorgetaeuscht.

Spaeter koennen auf Basis der gespeicherten Statuswechsel insbesondere folgende Nachrichten ausgeloest werden:

- Bestellbestaetigung
- Zahlungsbestaetigung
- Versand-/Trackingbestaetigung
- Retourenbestaetigung
- Refund-Bestaetigung
- Mietbestaetigung
- Rueckgabe-Erinnerung
- Kautionsfreigabe

## Health und Fehler

`GET /health` liefert nur nicht-sensible Readiness-Informationen. Die privaten `/admin/system`- und `/admin/insights`-Routen liefern nur nach Admin-Autorisierung zusaetzliche Betriebsinformationen.

Fehlerantworten verwenden stabile Fehlercodes und eine `requestId`, ohne Provider-Secrets oder rohe interne Fehlerdetails offenzulegen.

## Vor Live-Start

Mindestens erforderlich:

- D1-Migrationen bis einschliesslich `0005` anwenden und Restore/Backup-Verfahren testen.
- Worker deployen und `DB` binden.
- `ADMIN_TOKEN` als Secret setzen und Admin-Zugriff mit Cloudflare Access/MFA haerten.
- PayPal Sandbox komplett durchtesten.
- Mehrfachmiete mit Konkurrenz-/Ueberschneidungsfaellen testen.
- Origin-Allowlist fuer reale Domains pruefen.
- Rate Limiting/Turnstile nach Bedarf aktivieren.
- Datenschutz-/Retention-Regeln fuer Kunden-, Payment-, Audit- und Accounting-Daten festlegen.
- Optional E-Mail-/Versandprovider integrieren.
- Erst danach `shopWorkerUrl`, Client-ID und Feature-Flags bewusst aktivieren.

Die detaillierte Zielarchitektur steht in `shop-worker/COMMERCE_ARCHITECTURE.md`.

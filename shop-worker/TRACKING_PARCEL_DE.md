# DHL Parcel DE Tracking

Die automatische Sendungsverfolgung fragt nur eigene, offene DHL-Sendungen ab.
Standardabstand: sechs Stunden je Sendung. Nach erkannter Zustellung werden
keine weiteren Statusabfragen gemacht. Der Cron setzt die Bestellung auf
`DELIVERED`; die bestehende Abschlusslogik kann sie nach 14 Tagen abschliessen.

## Einrichtung

Die App `disorder119_paket_tracking` ist im DHL Developer Portal fuer
„Parcel DE Tracking (Post & Parcel Germany)“ freigeschaltet. DHLs
Authentifizierungsabschnitt sagt, dass fuer die oeffentliche Abfrage
API-Key und API-Secret der App genuegen. Das wurde mit einer eigenen,
offenen Sendung am 10.11.2026 lesend verifiziert: HTTP 200, oeffentliche
Statusdaten, ohne XML-Benutzer und -Passwort. Die Sandbox-Test-App
antwortete mit DHLs Beispielsendung auf `d-get-piece-detail` ebenfalls
erfolgreich; die oeffentliche Sandbox-Abfrage gab fuer diese alte Nummer
nur "keine Daten gefunden" zurueck. Ticket 328276 fragt zusaetzlich nach
dem dokumentierten Zugang. Keine Zugangsdaten raten oder aus der
Versandmarken-API uebernehmen.

Der Worker erwartet `DHL_PAKET_TRACKING_API_KEY` und
`DHL_PAKET_TRACKING_API_SECRET`. Falls DHL fuer die oeffentliche
Abfrage auch einen XML-Login bestaetigt, koennen zusaetzlich
`DHL_PAKET_TRACKING_USER` und `DHL_PAKET_TRACKING_PASSWORD`
eingerichtet werden. Ohne App-Key und -Secret bleibt der Cron inaktiv.
Die Werte gehoeren nur in Cloudflare Worker Secrets, nie ins Repository.
Vor Produktivschaltung: Worker-Secrets einrichten, PR mit gruenen Checks
mergen, Worker deployen und den naechsten Cron sowie den Bestellstatus
pruefen. Die produktive Probe war nur lesend und hat keine Bestellung
veraendert oder Mail verschickt.

Quelle: https://developer.dhl.com/api-reference/dhl-parcel-de-shipment-tracking-post-parcel-germany

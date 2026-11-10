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

## Abholmail per Telegram freigeben

Meldet DHL eine Sendung als abholbereit, bekommt der verbundene private
Inhaber-Chat ein Artikelfoto, den von DHL gemeldeten Abholort und zwei Knoepfe:
die **E-Mail-Vorschau ansehen** oder die Kundenmail direkt freigeben. Die
Vorschau zeigt dieselbe HTML-Mail wie die Kundschaft sie erhaelt, einschliesslich
Packstation-Motiv und Artikelfoto. Der Link enthaelt eine zufaellige Kennung,
ist hoechstens 48 Stunden gueltig und zeigt nur bei weiterhin aktuellem
Abholbereit-Status etwas an. Eine Nummer
wird nur angezeigt, wenn sie im aktuellen DHL-Status oder (ohne konkreten
DHL-Abholort) in der Lieferanschrift steht. Bei abweichenden Nummern hat DHL
Vorrang. Die Mail wird nicht automatisch ohne Freigabe gesendet.

Der Worker registriert den Telegram-Webhook beim naechsten Cron-Lauf selbst,
falls der Bot noch keinen anderen Webhook hat und der private Chat verbunden
ist. Die Freigabe prueft den Telegram-Secret-Header und den gespeicherten Chat,
gilt nur fuer genau eine Sendung und maximal 48 Stunden. Vor dem Senden muss
DHLs letzter Abholbereit-Stand hoechstens acht Stunden alt sein und die
Bestellung noch `SHIPPED` sein. Doppelte Klicks senden nicht doppelt.
Vor Produktivschaltung: Worker-Secrets einrichten, PR mit gruenen Checks
mergen, Worker deployen und den naechsten Cron sowie den Bestellstatus
pruefen. Die produktive Probe war nur lesend und hat keine Bestellung
veraendert oder Mail verschickt.

Quelle: https://developer.dhl.com/api-reference/dhl-parcel-de-shipment-tracking-post-parcel-germany

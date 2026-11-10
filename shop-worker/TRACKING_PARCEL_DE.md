# DHL Parcel DE Tracking

Die automatische Sendungsverfolgung fragt nur eigene, offene DHL-Sendungen ab.
Standardabstand: sechs Stunden je Sendung. Nach erkannter Zustellung werden
keine weiteren Statusabfragen gemacht. Der Cron setzt die Bestellung auf
`DELIVERED`; die bestehende Abschlusslogik kann sie nach 14 Tagen abschliessen.

## Einrichtung

Die App `disorder119_paket_tracking` ist im DHL Developer Portal fuer
„Parcel DE Tracking (Post & Parcel Germany)“ freigeschaltet. Fuer den
produktiven XML-Aufruf von `get-status-for-public-user` dokumentiert DHL
zusaetzlich zur App-Kennung und ihrem Secret die Tracking-Benutzerkennung
(`appname`) und das zugehoerige Passwort. Ob der oeffentliche Zugang fuer
Disorder119 ohne Geschaeftskunden-Trackingvertrag diese Kennung erhaelt,
ist bei DHL unter Ticket 328276 angefragt. Keine Zugangsdaten raten oder
aus der Versandmarken-API uebernehmen.

Vier Worker-Secrets werden benoetigt: `DHL_PAKET_TRACKING_API_KEY`,
`DHL_PAKET_TRACKING_API_SECRET`, `DHL_PAKET_TRACKING_USER` und
`DHL_PAKET_TRACKING_PASSWORD`. Ohne alle vier bleibt der Cron inaktiv.
Die Werte gehoeren nur in Cloudflare Worker Secrets, nie ins Repository.
Vor Produktivschaltung: DHL-Sandbox-Aufruf mit der separaten Test-App und
DHL-Testnummer durchfuehren; danach eine eigene offene Sendung mit
Produktionszugang pruefen. Erst dann den Worker deployen.

Quelle: https://developer.dhl.com/api-reference/dhl-parcel-de-shipment-tracking-post-parcel-germany

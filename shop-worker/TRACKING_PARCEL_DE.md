# DHL Parcel DE Tracking

Die automatische Sendungsverfolgung fragt nur eigene, offene DHL-Sendungen ab.
Standardabstand: sechs Stunden je Sendung. Nach erkannter Zustellung werden
keine weiteren Statusabfragen gemacht. Der Cron setzt die Bestellung auf
`DELIVERED`; die bestehende Abschlusslogik kann sie nach 14 Tagen abschliessen.

## Einrichtung

Die App `disorder119_paket_tracking` ist im DHL Developer Portal fuer
„Parcel DE Tracking (Post & Parcel Germany)“ freigeschaltet. DHLs
Authentifizierungsabschnitt sagt, dass fuer die oeffentliche Abfrage
API-Key und API-Secret der App genuegen. XML-Beispiele und die
Parameterreferenz nennen dennoch `appname` und `password`. Welche
Kombination die freigegebene Produktions-App fuer
`get-status-for-public-user` tatsaechlich akzeptiert, ist unter
Ticket 328276 bei DHL angefragt. Keine Zugangsdaten raten oder
aus der Versandmarken-API uebernehmen.

Der Worker erwartet `DHL_PAKET_TRACKING_API_KEY` und
`DHL_PAKET_TRACKING_API_SECRET`. Falls DHL fuer die oeffentliche
Abfrage auch einen XML-Login bestaetigt, koennen zusaetzlich
`DHL_PAKET_TRACKING_USER` und `DHL_PAKET_TRACKING_PASSWORD`
eingerichtet werden. Ohne App-Key und -Secret bleibt der Cron inaktiv.
Die Werte gehoeren nur in Cloudflare Worker Secrets, nie ins Repository.
Vor Produktivschaltung: DHL-Sandbox-Aufruf mit der separaten Test-App und
DHL-Testnummer durchfuehren; danach eine eigene offene Sendung mit
Produktionszugang pruefen. Erst dann den Worker deployen.

Quelle: https://developer.dhl.com/api-reference/dhl-parcel-de-shipment-tracking-post-parcel-germany

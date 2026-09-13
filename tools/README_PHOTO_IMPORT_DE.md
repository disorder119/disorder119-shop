# Lokaler Import der freigestellten Produktfotos

`FOTOIMPORT_STARTEN.cmd` ordnet die freigestellten Bilder aus
`D:\Doppelkontrolle\Produktfotos - Kopie (2)` den Website-Artikeln zu,
konvertiert sie lokal nach WebP und kann sie anschliessend in den Website-
Checkout uebernehmen.

Der Import verwendet **keine KI, keine ChatGPT-/Codex-Tokens und keine
Netzwerk-API**. Die Zuordnung wird zuerst aus Website-ID, Manager-ID und den im
Manager gespeicherten Originalpfaden bestimmt. Dabei werden das aktuelle
Studio-Profil und das fruehere Manager-Profil rein lesend ausgewertet, weil
einige archivierte Website-IDs nur dort vorhanden sind. Eindeutige Titel und
Shooting-Artikelnummern werden nur als weitere deterministische Methoden
benutzt. Unsichere oder nur teilweise passende Artikel werden nicht
automatisch angewendet.

## Empfohlener Ablauf

1. `FOTOIMPORT_STARTEN.cmd` doppelt anklicken.
2. Zuerst Option 1 ausfuehren und `fotoimport_zuordnung.csv` pruefen.
3. Mit Option 2 zwei Artikel testweise konvertieren. Die Website bleibt dabei
   unveraendert; die Ergebnisse liegen unter `.photo-import\...\staging`.
4. Erst danach Option 3 ausfuehren. Hierfuer muss zur Sicherheit
   `JA-BILDER-ERSETZEN` eingegeben werden.
5. Die lokalen Git-Aenderungen pruefen. Das Programm pusht nicht selbst und
   stellt daher nichts ungeprueft online.

## Bildqualitaet und Speicher

- Galeriebilder: maximal 2,0 MiB pro Datei, maximal 2400 Pixel lange Kante.
- Das Skript nimmt jeweils die hoechste getestete WebP-Qualitaet unterhalb der
  Grenze. Ein einfaches freigestelltes Bild darf deutlich kleiner als 2 MiB
  sein; es werden keine nutzlosen Fuellbytes erzeugt.
- Transparenz bleibt erhalten.
- Kleine 220 x 293 WebP-Thumbnails werden fuer das Produktgrid mit erzeugt.
- Pro Artikel entsteht zusaetzlich eine 960-Pixel-Anzeigevorschau fuer den
  schnellen Produktseiten-Start. Galerie-Interaktion und Zoom verwenden
  weiterhin die volle hochaufloesende Datei.
- Das erste Galeriebild wird standardmaessig auch fuer den Outfit-Baukasten
  verwendet. Dadurch ist kein zweites grosses Bild noetig. Mit `--keep-look`
  kann das bisherige Baukastenbild erhalten bleiben.
- Jeder Abschluss wird sofort in `fertige_fotos.jsonl` und `fotoimport.log`
  protokolliert. Die CMD-Ausgabe zeigt Anzahl, ETA und voraussichtliche
  Fertig-Uhrzeit. Nach Abbruch oder Neustart werden fertige Dateien per
  Quelldatei-Zeitstempel und SHA-256 geprueft und nicht erneut konvertiert.
- Die Staging-Zwischenkopie bleibt als Wiederaufnahme-Speicher erhalten.
  Nicht mehr referenzierte alte Galerie-, Thumbnail- und Look-Dateien werden
  erst gesichert und dann aus dem Arbeitsstand entfernt. Beide Bereinigungen
  lassen sich mit `--keep-staging` bzw. `--keep-stale-assets` abschalten.

2 MiB sind eine Obergrenze, kein Qualitaetsmerkmal. Bei 1.492 Fotos waere der
theoretische Maximalumfang rund 2,9 GiB. Der echte Umfang steht nach der
Testkonvertierung im Hash-Manifest.

Der aktuelle Probelauf ordnet alle 237 vorhandenen Website-Artikel eindeutig
zu. 19 der 1.492 Quelldateien gehoeren zu zusaetzlichen/fehlerhaften
Quellgruppen, fuer die es momentan keinen Website-Artikel gibt. Diese Dateien
werden nicht geraten zugeordnet; der JSON-Bericht listet sie unter
`unused_sources_without_website_item` vollstaendig auf.

## Urheberhinweise

Jedes erzeugte WebP erhaelt Copyright-, Autor- und Software-Angaben in EXIF
und XMP. Zusaetzlich schreibt das Skript fuer jede Datei einen SHA-256-Wert in
`fotoimport_manifest.json`. Metadaten und Hashes dokumentieren den Bestand,
sind aber kein technischer Kopierschutz. Browser muessen ein Bild ausliefern,
um es anzeigen zu koennen. Das bereits vorhandene Sperren von Rechtsklick und
Drag-and-drop erschwert normales Speichern, kann aber nicht jeden Download
verhindern.

## Kommandozeile

Nur Vorschau (Standard):

```powershell
py -3 tools\import_cutout_photos.py
```

Zwei bestimmte Artikel nur ins Staging konvertieren:

```powershell
py -3 tools\import_cutout_photos.py --mode stage --items 9364,9358
```

Alle sicheren Treffer lokal anwenden:

```powershell
py -3 tools\import_cutout_photos.py --mode apply --confirm JA-BILDER-ERSETZEN
```

Den vorbereiteten Vollimport direkt sichtbar in CMD starten/fortsetzen:

```cmd
FOTOIMPORT_STARTEN.cmd auto
```

Andere Qualitaetsgrenze oder Bildkante:

```powershell
py -3 tools\import_cutout_photos.py --mode stage --max-mib 2.25 --max-edge 2800 --limit-items 2
```

Eine manuelle Zuordnung kann in der erzeugten CSV in der Spalte
`override_source_group` eingetragen und so erneut eingelesen werden:

```powershell
py -3 tools\import_cutout_photos.py --mapping .photo-import\lauf-...\fotoimport_zuordnung.csv
```

Vor `apply` wird unter demselben Laufordner eine Sicherung der bisherigen
Katalogdatei und der ersetzten Bilder angelegt. Danach laeuft `build_site.py`,
damit Produktseiten und `data/catalog.json` aktualisiert werden. Commit und
Push bleiben bewusst ein separater, kontrollierter Schritt.

In einem eigens dafuer frisch angelegten Git-Branch kann mit
`--skip-asset-backup` auf die zusaetzliche Kopie der alten Bilder verzichtet
werden: Der unveraenderte Ausgangs-Commit bleibt dann die vollstaendige,
wiederherstellbare Sicherung. `data/items.json` wird trotzdem lokal gesichert.

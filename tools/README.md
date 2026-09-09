# cutout.py — Produktfoto-Freisteller

Entfernt den grauen Studiohintergrund aus Produktfotos, ohne Stoff oder
Mannequin mit wegzuschneiden. Gebaut für Detail-/Etikett-Nahaufnahmen, bei
denen der Hintergrund nur einen kleinen Teil des Bildes ausmacht.

## Funktionsweise

1. Lernt Stoff- und Hintergrundfarbe aus dem Hauptfoto des Artikels (dort
   erkennt ein allgemeines Segmentierungsmodell, u2net, die Silhouette
   zuverlässig).
2. Wendet dieses Farbmodell auf das Zielfoto an, behält aber nur den Teil als
   "Hintergrund", der tatsächlich mit dem Bildrand verbunden ist (ein
   Hintergrund-"Inselchen" mitten im Bild ist unmöglich - das ist Stoff, der
   nur ähnlich aussieht).
3. Übergibt diese grobe Schätzung an OpenCV GrabCut zur Verfeinerung.
4. **Sicherheitsnetz:** Wenn GrabCut deutlich mehr entfernen will, als die
   Farb-Schätzung nahelegt, wird das nicht vertraut - dann bleibt das Original
   unverändert, statt riskiert echten Stoff wegzuschneiden. Dasselbe gilt,
   wenn gar kein zuverlässig identifizierbarer Hintergrund gefunden wird
   (`MIN_BACKDROP_FRAC`, aktuell 20%).

**Kernprinzip:** ein unbearbeitetes Original ist immer besser als ein falsch
freigestelltes Foto. Das Tool schneidet lieber zu wenig als zu viel weg.

## Installation

```bash
pip install rembg opencv-python-headless scipy pillow numpy
```

(Erster Aufruf lädt einmalig das u2net-Modell aus dem Internet, ca. 180 MB,
danach lokal zwischengespeichert.)

## Benutzung

Einzelnes Bild:
```bash
python tools/cutout.py <hauptfoto.jpg> <zielfoto.jpg> <output.webp> [--max-side 1800]
```

Im Batch, z.B. aus einem eigenen Skript:
```python
from tools.cutout import cutout
info = cutout(main_photo_path, target_path, out_path, max_side=1800)
print(info)  # {'method': 'grabcut' | 'rough_fallback' | 'no_backdrop_skip', ...}
```

`info['method']` sagt, was tatsächlich passiert ist - bei `no_backdrop_skip`
oder `rough_fallback` lohnt sich ein kurzer Blick, ob von Hand nachgeholfen
werden soll.

## Bekannte Grenze

Bei Fotos, die deutlich anders belichtet sind als das Hauptfoto desselben
Artikels (z.B. ein dunkleres Detailfoto vom selben Shooting), kann die
Farb-Schätzung daneben liegen. Das Sicherheitsnetz fängt das ab, indem es in
diesem Fall lieber gar nichts zuschneidet, statt etwas falsch zuzuschneiden -
das Foto bleibt dann einfach im Original-Zustand mit sichtbarem Hintergrund.

# Disorder119 — Katalog-Shop

Statische, komplett clientseitige Shop-Seite: ein `index.html` plus Produktfotos
unter `assets/img/`. Kein Server, keine Datenbank, keine Zahlungsdaten auf der
Seite.

- **Technologie:** reines HTML/CSS/JavaScript, kein Build-Schritt, keine Abhängigkeiten
- **Lokal öffnen:** `index.html` direkt per Doppelklick im Browser öffnen
- **Live:** https://disorder119.github.io/disorder119-shop/

## Vor der Veröffentlichung: Kontakt eintragen

Der Warenkorb (Archiv-, Match- und Outfit-Baukasten-Ansicht) endet in einer
Bestellanfrage per WhatsApp und/oder E-Mail (kein Zahlungsanbieter nötig).
Dafür in `index.html` nach `SHOP_CONFIG` suchen und ausfüllen:

```js
var SHOP_CONFIG = {
  whatsappNumber: "",  // z. B. "491701234567" — Ländercode ohne "+", ohne führende 0
  email: ""             // z. B. "bestellungen@deine-domain.de"
};
```

Solange beide Felder leer sind, zeigt der Warenkorb im Footer nur einen
Hinweis statt eines Bestell-Buttons.

## Updates veröffentlichen

```bash
git add .
git commit -m "Update website"
git push
```

GitHub Pages baut die Seite danach automatisch neu (kein Workflow nötig, da
kein Build-Schritt existiert — Pages liefert `index.html` direkt aus).

## Eigene Domain später

Sobald eine eigene Domain vorhanden ist: in den Repository-Settings unter
**Pages → Custom domain** eintragen (erstellt automatisch eine `CNAME`-Datei
im Repo). Alle Pfade in `index.html` sind relativ, daher funktioniert der
Wechsel ohne weitere Anpassungen.

## Struktur

```
index.html             – die komplette Seite (Katalog, Warenkorb, Minigames)
assets/img/<id>/*.webp – freigestellte Produktfotos, ein Ordner pro Artikel
```

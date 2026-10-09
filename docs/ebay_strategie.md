# eBay-Strategie Disorder119 (Stand 08.10.2026)

Ziel: Bei eBay.de in der Suche oben stehen und das Archiv ohne Preisdruck verkaufen. eBays
Suche (Cassini) bewertet vor allem: Treffer im Titel und in den Artikelmerkmalen, Klick- und
Kaufrate des Angebots, Verkäuferleistung, Versand- und Rückgabekonditionen. Darauf ist der
Export in `scripts/ebay_export.py` ausgelegt.

## 1. Titel (80 Zeichen, die wichtigste Stellschraube)

Reihenfolge aus dem Export: `Marke Produktart Damen/Herren Farbe` (Katalogtitel) +
Linie (Linea Rossa, JPG Jean's, W&LT, DRKSHDW …) + wichtigstes Modell-Stichwort (Cyberbaba,
Rabbit Intarsia, Speedhunters) + Saison (SS96, FW16, Y2K, 90s) + `Gr. X` + weitere Stichworte +
Vintage/Archive. Was nicht mehr passt, fällt hinten weg.

Regeln:
- Keine Fremdmarken, keine Füllwörter („Top“, „selten“, „wow“), keine Ausrufezeichen, keine
  Großschreibung ganzer Wörter. eBay straft Keyword-Spam und Fremdmarken ab.
- Jahr/Saison nur, wenn belegt (Konfidenz hoch). Bei „mittel“ nur das Jahrzehnt (90s, Y2K).
- Größe immer, weil Käufer nach Größe filtern.

## 2. Artikelmerkmale (Item Specifics)

Werden aus dem Katalog gefüllt: Marke, Größe, EU/UK/US-Schuhgröße, Farbe, Abteilung,
Produktart, Stil „Designer“, Ärmellänge, Außenmaterial/Material, Kleider-/Rocklänge,
Schrittlänge, Absatzhöhe. eBay zeigt Angebote mit vollständigen Merkmalen bevorzugt in den
Filterergebnissen; fehlende Pflichtmerkmale werden gar nicht gelistet.

Ergänzung in eBay nach dem Upload (geht nur im Angebotsformular): „Jahrzehnt“ (1990er, 2000er),
„Thema“ (Designer, Vintage), „Muster“, „Besonderheiten“ (Logo, Print).

## 3. Beschreibung

Reihenfolge im Export: Mängel zuerst („Bitte beachten“), dann Einleitung, Stichpunkte
„Auf einen Blick“ (Marke, Linie, Modell, Kollektion/Jahr, Größe, Farbe, Material …),
„Archiv-Hintergrund“ (die Quelle: Datumscode, Etikett, Kollektionsvergleich), Zustand,
Versand & Rückgabe. Kurz, scannbar, mobil lesbar. Keine Links nach außen (verboten),
nur die Nennung disorder119.com als Herkunft.

## 4. Fotos

Alle Freisteller auf hellgrauem Grund (RGB 236, Ordner `assets/ebay/`), Detailfotos bleiben
Originalfotos. Entscheidung 09.10.2026 nach Vergleich Weiß / Hellgrau / Schwarz: Auf Weiß lösen
sich weiße und hellblaue Teile auf, auf Schwarz die schwarzen; Hellgrau trägt beide und wirkt im
eBay-Raster praktisch wie Weiß (eBay akzeptiert es als neutralen Hintergrund). Alle Detailfotos
mitgeben (bis 12), Etikett- und Mängelfotos immer dabei. Kein Text, keine Rahmen im Bild.
Neu erzeugen: `python scripts/ebay_export.py --bilder --alle-bilder` (Standard hellgrau).

## 5. Preis, Format, Konditionen

- Festpreis mit „Preisvorschlag“ (im Export aktiviert, 10 % Spielraum eingerechnet).
- Laufzeit „Gültig bis auf Widerruf“ (GTC): kein Verfall, Angebote sammeln Aufrufe und Beobachter.
- Versand: DHL, 3 Werktage Bearbeitung, versandkostenfrei ab 99 € (wie im Shop). Kostenloser
  Versand erhöht das Ranking; bei günstigen Teilen 6,19 €.
- Rücknahme 14 Tage (Pflicht für gewerbliche Verkäufer, hebt das Ranking).
- Zustand: „Neu mit Etikett“ nur bei belegter Neuware, sonst „Gebraucht“ plus
  Zustandsbeschreibung (Feld `ConditionDescription`, steht oben im Angebot).

## 6. Shop-Abo und Gebühren

Ab ca. 115 aktiven Angeboten lohnt der Basis-Shop (39,95 €/Monat, 400 Angebote inklusive) statt
0,35 € je Angebot und Monat. Mit 161 Artikeln: Shop abschließen, bevor alles live geht.

## 7. Laufender Betrieb

- Angebote nicht alle an einem Tag einstellen: 20–30 pro Tag über eine Woche, damit die
  „Neu eingestellt“-Sortierung mehrere Tage greift.
- Beobachter nach 7–10 Tagen ohne Verkauf per „Angebot an Beobachter senden“ (5–10 %) ansprechen.
- Wöchentlich: Angebote ohne Aufrufe prüfen → Titel-Stichworte tauschen, erstes Foto tauschen.
- Bewertungen: schnelle Antworten, Versand am selben/nächsten Tag, Sendungsnummer eintragen –
  die Verkäuferleistung ist ein Rankingfaktor.
- Nie Fremdmarken oder „Stil von …“ in Titel oder Merkmale (Richtlinie Markenrechte).

## 8. Was vor dem ersten Massen-Upload noch fehlt (nur der Inhaber)

1. eBay-Verkaufseinstellungen → „Rechtliche Informationen des Verkäufers“ (Impressum im Angebot,
   Pflicht für gewerbliche Verkäufer) und Umsatzsteuer-Status (Kleinunternehmer § 19 UStG).
2. Basis-Shop abonnieren.
3. Upload als Entwürfe (`--csv`), im Cockpit prüfen, dann freigeben – oder direkt `--vollstaendig Add`.

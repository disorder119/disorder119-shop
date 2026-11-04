"""Aehnliche Archivstuecke fuer die Produktseite ("AEHNLICHE ARCHIVSTUECKE").

Vorher standen dort einfach die ersten vier Teile derselben Kategorie - bei
jeder Hose dieselben vier Hosen. Jetzt bekommt jedes andere Teil Punkte:

  Produktart gleich (Hose/Hose)          4
  Kategorie gleich                        2
  Bereich gleich (Damen/Herren/Unisex)    2
  Groesse gleich                          2
  Preis im Bereich 70-140 % / 50-200 %    2 / 1
  Marke gleich                            1
  Farbe gleich                            1

Verfuegbare Teile kommen vor verkauften, dann nach Punkten, dann nach ID -
deterministisch, damit build_site.py und
scripts/repair_public_article_integrity.py dieselben Karten erzeugen (das
Reparaturskript ersetzt die Abschnitte in der CI noch einmal).
"""

UNBEKANNTE_GROESSEN = {"", "Dimensions", "Unknown", "Nicht angegeben"}


def _preis(x):
    try:
        return float(x.get("price") or 0)
    except (TypeError, ValueError):
        return 0.0


def _kategorie(x):
    return x.get("taxonomy_category") or x.get("category") or ""


def _groesse(x):
    return str(x.get("size_normalized") or x.get("size") or "").strip()


def aehnlichkeit(it, x):
    punkte = 0
    if it.get("product_type") and x.get("product_type") == it.get("product_type"):
        punkte += 4
    if _kategorie(it) and _kategorie(x) == _kategorie(it):
        punkte += 2
    if it.get("department") and x.get("department") == it.get("department"):
        punkte += 2
    g = _groesse(it)
    if g not in UNBEKANNTE_GROESSEN and _groesse(x) == g:
        punkte += 2
    if it.get("brand") and x.get("brand") == it.get("brand"):
        punkte += 1
    if it.get("color") and x.get("color") == it.get("color"):
        punkte += 1
    pi, px = _preis(it), _preis(x)
    if pi > 0 and px > 0:
        q = px / pi
        if 0.7 <= q <= 1.4:
            punkte += 2
        elif 0.5 <= q <= 2.0:
            punkte += 1
    return punkte


def aehnliche_teile(it, items, exclude_ids=(), n=4):
    """Die n aehnlichsten Teile zu `it` aus `items` (ohne `it`, ohne exclude_ids,
    ohne Entwuerfe, nur mit Bild). Verfuegbare zuerst."""
    ausschluss = {str(i) for i in exclude_ids} | {str(it["id"])}
    bewertet = []
    for x in items:
        if str(x["id"]) in ausschluss or x.get("public_status") == "DRAFT":
            continue
        if not (x.get("gallery") or [None])[0]:
            continue
        punkte = aehnlichkeit(it, x)
        if punkte <= 0:
            continue
        verkauft = 1 if x.get("public_status") == "SOLD" else 0
        bewertet.append((verkauft, -punkte, str(x["id"]).zfill(12), x))
    bewertet.sort(key=lambda b: b[:3])
    return [b[3] for b in bewertet[:n]]

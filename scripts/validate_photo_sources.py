"""Shop-Bilder gegen ihre freigestellten Quellbilder pruefen (config/photo-sources.json).

Seit 15.10.2026 heisst jedes freigestellte Bild wie sein Original + " freigestellt", z. B.
"y-3 jacke (1) #42 freigestellt.png"; die Zahl nach "(n)" ist die Artikelnummer. Dieser Check
stoppt einen Pull Request, wenn ein Shop-Bild einem Freisteller mit einer ANDEREN Artikelnummer
zugeordnet ist (so entstanden frueher falsche Fotos). Neue oder ersetzte Bilder (z. B. ueber den
Admin-Katalog) blockieren nie etwas, sondern werden als Hinweis gemeldet; die Zuordnung frischt
der Inhaber lokal mit "python tools/fotoquellen.py zuordnen" auf. Auf main (Push, z. B. eine
Admin-Speicherung) werden Fehler nur angezeigt, damit die Seite trotzdem veroeffentlicht wird.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
from pathlib import Path

BASE = Path(__file__).resolve().parents[1]
NAME = re.compile(r"^(?P<name>.+?)\s*\((?P<n>\d+)\)\s*#\s*(?P<nr>\d+)\s+freigestellt$", re.IGNORECASE)
GALERIE = re.compile(r"^assets/img/[A-Za-z0-9._-]{1,80}/\d{1,3}\.webp$")
HEX64 = re.compile(r"^[0-9a-f]{64}$")


def parse_name(rel: str):
    stem = Path(str(rel).replace("\\", "/")).stem
    m = NAME.match(stem.strip())
    return (int(m.group("n")), m.group("nr")) if m else None


def validate(items, manifest, sources, file_hash=None):
    """(fehler, hinweise). Fehler stoppen einen Pull Request, Hinweise nie."""
    fehler, hinweise = [], []
    if not isinstance(sources, dict) or sources.get("version") != 1 or not isinstance(sources.get("bilder"), list):
        return ["photo-sources.json: Version 1 mit Liste 'bilder' erwartet"], []
    try:
        links = {int(r["shop_id"]): str(r["article"]) for r in manifest.get("links", [])}
        excluded = {int(x) for x in manifest.get("excluded_shop_ids", [])}
        by_id = {int(i["id"]): i for i in items}
    except (KeyError, TypeError, ValueError) as exc:
        return [f"Katalog oder Nummern-Links unlesbar: {exc}"], []
    ausnahmen = {}
    for a in sources.get("ausnahmen", []) or []:
        try:
            ausnahmen[(int(a["shop_id"]), str(a["gallery"]))] = a
        except (KeyError, TypeError, ValueError):
            fehler.append(f"Ausnahme unvollstaendig: {a}")
    gesehen, quelle_artikel, webp_artikel = set(), {}, {}
    besitzer = {}
    for e in sources["bilder"]:
        try:
            sid0 = int(e["shop_id"])
        except (KeyError, TypeError, ValueError):
            continue
        w0 = str(e.get("webp_sha256") or "")
        if HEX64.match(w0) and sid0 not in excluded:
            webp_artikel.setdefault(w0, (str(e.get("article") or ""), sid0))
    for e in sources["bilder"]:
        try:
            sid, gal = int(e["shop_id"]), str(e["gallery"])
        except (KeyError, TypeError, ValueError):
            fehler.append(f"Eintrag unvollstaendig: {e}")
            continue
        ort = f"{sid} {gal}"
        if not GALERIE.match(gal):
            fehler.append(f"{ort}: Galerie-Pfad hat nicht das Format assets/img/<ordner>/<nr>.webp")
        if (sid, gal) in gesehen:
            fehler.append(f"{ort}: doppelt in photo-sources.json")
        gesehen.add((sid, gal))
        artikel = str(e.get("article") or "")
        item = by_id.get(sid)
        soll = links.get(sid, str(item.get("article") or "") if item else None)
        if soll is not None and soll != artikel:
            fehler.append(f"{ort}: Artikelnummer {artikel} passt nicht zur Nummer {soll} im Katalog")
        parsed = parse_name(e.get("freigestellt") or "")
        if not parsed:
            fehler.append(f"{ort}: Freisteller-Name ohne '(n) #Nummer freigestellt': {e.get('freigestellt')}")
        elif parsed[1] != artikel or parsed[0] != int(e.get("n") or 0):
            fehler.append(f"{ort}: Freisteller {e.get('freigestellt')} gehoert zu #{parsed[1]} Bild {parsed[0]}, "
                          f"nicht zu #{artikel} Bild {e.get('n')}")
        for feld in ("freigestellt_sha256", "webp_sha256"):
            if not HEX64.match(str(e.get(feld) or "")):
                fehler.append(f"{ort}: {feld} fehlt oder ist kein SHA-256")
        h = str(e.get("freigestellt_sha256") or "")
        if HEX64.match(h):
            vorher = quelle_artikel.setdefault(h, artikel)
            if vorher != artikel:
                fehler.append(f"{ort}: derselbe Freisteller ist auch Artikel #{vorher} zugeordnet")
        w = str(e.get("webp_sha256") or "")
        besitzer[gal] = (artikel, sid)
        if item is None:
            hinweise.append(f"{ort}: Artikel gibt es nicht mehr im Katalog (Eintrag veraltet)")
        elif gal not in (item.get("gallery") or []):
            hinweise.append(f"{ort}: Bild steht nicht mehr in der Galerie (Eintrag veraltet)")
        elif file_hash is not None and HEX64.match(w):
            aktuell = file_hash(gal)
            if aktuell is None:
                hinweise.append(f"{ort}: Bilddatei fehlt")
            elif aktuell != w:
                anderer = webp_artikel.get(aktuell)
                if anderer and anderer[0] != artikel:
                    hinweise.append(f"{ort}: Bild wurde ersetzt und zeigt jetzt das Foto von Artikel #{anderer[0]} - pruefen!")
                else:
                    hinweise.append(f"{ort}: Bild wurde ersetzt - Fotoquelle neu zuordnen")
    for (sid, gal), a in ausnahmen.items():
        if (sid, gal) in gesehen:
            hinweise.append(f"{sid} {gal}: steht als Ausnahme und als Zuordnung (Ausnahme entfernen)")
        item = by_id.get(sid)
        if item is None or gal not in (item.get("gallery") or []):
            hinweise.append(f"{sid} {gal}: Ausnahme ist veraltet (Bild nicht mehr in der Galerie)")
    for sid, item in by_id.items():
        if sid in excluded:
            continue
        artikel = links.get(sid, str(item.get("article") or ""))
        for gal in item.get("gallery") or []:
            if (sid, gal) in gesehen or (sid, gal) in ausnahmen:
                continue
            fremd = besitzer.get(gal)
            if fremd and fremd[0] != artikel and fremd[1] not in excluded:
                hinweise.append(f"{sid} {gal}: zeigt laut Fotoquellen das Foto von Artikel #{fremd[0]} - pruefen!")
            else:
                hinweise.append(f"{sid} {gal}: neues Shop-Bild ohne Fotoquelle - lokal 'python tools/fotoquellen.py zuordnen'")
    return fehler, hinweise


def _sha(rel):
    path = BASE / rel
    if not path.is_file():
        return None
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _lade(name):
    path = BASE / name
    try:
        return json.loads(path.read_text(encoding="utf-8-sig"))
    except FileNotFoundError:
        raise SystemExit(f"{name} fehlt.") from None
    except (UnicodeError, ValueError) as exc:
        raise SystemExit(f"{name} ist kein gueltiges UTF-8-JSON: {exc}") from None


def main():
    items = _lade("data/items.json")
    manifest = _lade("config/catalog-number-links.json")
    sources = _lade("config/photo-sources.json")
    fehler, hinweise = validate(items, manifest, sources, _sha)
    actions = os.environ.get("GITHUB_ACTIONS") == "true"
    for h in hinweise[:80]:
        print(f"::warning title=Fotoquellen::{h}" if actions else f"Hinweis: {h}")
    if len(hinweise) > 80:
        print(f"Hinweis: ... und {len(hinweise) - 80} weitere")
    if fehler:
        if actions and os.environ.get("GITHUB_EVENT_NAME") == "push":
            # Auf main nie die Veroeffentlichung aufhalten (z. B. Admin-Speicherung) - nur deutlich anzeigen.
            for f in fehler[:80]:
                print(f"::error title=Fotoquellen::{f}")
            print(f"Fotoquellen: {len(fehler)} Fehler (auf main nur angezeigt) - "
                  "Zuordnung lokal neu erzeugen: python tools/fotoquellen.py zuordnen")
            return
        raise SystemExit("Fotoquellen fehlerhaft:\n" + "\n".join(fehler[:100])
                         + "\nZuordnung lokal neu erzeugen: python tools/fotoquellen.py zuordnen")
    print(f"Fotoquellen: {len(sources['bilder'])} Shop-Bilder eindeutig ihrem Freisteller und ihrer Artikelnummer "
          f"zugeordnet, {len(sources.get('ausnahmen', []))} begruendete Ausnahmen, {len(hinweise)} Hinweise")


if __name__ == "__main__":
    main()

"""Fotoquellen: welches freigestellte Bild steckt hinter welchem Shop-Bild (lokal, auf dem Laptop).

Seit 15.10.2026 heißen alle freigestellten Bilder wie ihr Original-Shootingfoto + " freigestellt",
z. B. "y-3 jacke (1) #42 freigestellt.png" - die Zahl nach "(n)" ist die Artikelnummer im Katalog
(config/catalog-number-links.json), nie mehr ein alter Foto-Tag. Die Shop-Dateien selbst behalten
ihre Nummernnamen (assets/img/<id>/<k>.webp), weil URLs, Google, Merchant Center und Bestellmails
daran hängen. Die Verbindung steht in config/photo-sources.json; der Shop prüft sie bei jedem Build
(scripts/validate_photo_sources.py).

  python tools/fotoquellen.py pruefen     # Ordner gegen photo-sources.json: neu / geändert / fehlt
  python tools/fotoquellen.py zuordnen    # Shop-Bilder per Bildvergleich zuordnen und photo-sources.json schreiben

Liest den Freisteller-Ordner nur (nichts wird dort verändert). Braucht Pillow und numpy.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

BASE = Path(__file__).resolve().parents[1]
LOKAL = Path(__file__).resolve().with_name("fotoquellen.local.json")   # nicht im Repo (.gitignore)
CROSSWALK = BASE / "config" / "photo-sources.json"
LINKS = BASE / "config" / "catalog-number-links.json"
ITEMS = BASE / "data" / "items.json"
CACHE = BASE / ".fotoquellen-cache"
NAME = re.compile(r"^(?P<name>.+?)\s*\((?P<n>\d+)\)\s*#\s*(?P<nr>\d+)\s+freigestellt$", re.IGNORECASE)
BILD = {".png", ".jpg", ".jpeg"}
SIG_H = 160          # Vergleichshöhe in Pixeln
SICHER = 6.0         # mittlere Abweichung (0-255) unter der ein Treffer als sicher gilt
ABSTAND = 5.0        # Mindestabstand zum zweitbesten Kandidaten


def quelle() -> Path:
    """Lokaler Freisteller-Ordner: Umgebungsvariable D119_FREIGESTELLT oder tools/fotoquellen.local.json."""
    wert = os.environ.get("D119_FREIGESTELLT")
    if not wert and LOKAL.exists():
        wert = json.loads(LOKAL.read_text(encoding="utf-8-sig")).get("freigestellt")
    if not wert or not Path(wert).is_dir():
        raise SystemExit("Freisteller-Ordner unbekannt: in tools/fotoquellen.local.json "
                         '{"freigestellt": "<Ordner>"} eintragen oder D119_FREIGESTELLT setzen.')
    return Path(wert)


def parse_name(stem: str):
    """(n, artikelnummer) aus 'name (n) #nr freigestellt', sonst None."""
    m = NAME.match(stem.strip())
    return (int(m.group("n")), m.group("nr")) if m else None


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def rel_posix(path: Path, root: Path) -> str:
    return path.relative_to(root).as_posix()


def _signatur(path_str: str):
    """Kleines RGBA-Abbild (Höhe SIG_H, Seitenverhältnis bleibt) als Liste; Alpha 255 bei JPG."""
    from PIL import Image, ImageOps
    import numpy as np
    with Image.open(path_str) as im:
        im = ImageOps.exif_transpose(im).convert("RGBA")
        w = max(1, round(im.width * SIG_H / im.height))
        small = im.resize((w, SIG_H), Image.LANCZOS)
        return path_str, np.asarray(small, dtype=np.uint8)


def _signaturen(paths, workers=6):
    import numpy as np
    CACHE.mkdir(exist_ok=True)
    out, todo = {}, []
    for p in paths:
        st = Path(p).stat()
        key = hashlib.sha1(f"{p}|{st.st_size}|{st.st_mtime_ns}|{SIG_H}".encode()).hexdigest()
        cached = CACHE / (key + ".npy")
        if cached.exists():
            out[p] = np.load(cached)
        else:
            todo.append((p, cached))
    if todo:
        with ProcessPoolExecutor(max_workers=workers) as pool:
            for (p, cached), (_, arr) in zip(todo, pool.map(_signatur, [t[0] for t in todo], chunksize=4)):
                np.save(cached, arr)
                out[p] = arr
    return out


def _abstand(a, b):
    """Mittlere RGB-Abweichung in Pixeln, die in beiden Bildern deckend sind; inf bei anderem Format."""
    import numpy as np
    if abs(a.shape[1] - b.shape[1]) > 2:
        return float("inf")
    w = min(a.shape[1], b.shape[1])
    a, b = a[:, :w].astype(np.float32), b[:, :w].astype(np.float32)
    maske = (a[..., 3] > 200) & (b[..., 3] > 200)
    if maske.sum() < 40:
        return float("inf")
    return float(np.abs(a[..., :3] - b[..., :3])[maske].mean())


def freisteller(root: Path):
    """Alle freigestellten Dateien mit (n, nr) aus dem Namen."""
    result = []
    for p in sorted(root.rglob("*")):
        if p.is_file() and p.suffix.lower() in BILD:
            result.append(dict(pfad=p, rel=rel_posix(p, root), parsed=parse_name(p.stem)))
    return result


def lade_shop():
    items = json.loads(ITEMS.read_text(encoding="utf-8-sig"))
    manifest = json.loads(LINKS.read_text(encoding="utf-8-sig"))
    links = {int(r["shop_id"]): str(r["article"]) for r in manifest["links"]}
    return items, links, set(manifest.get("excluded_shop_ids", []))


def zuordnen(args):
    QUELLE = quelle()
    items, links, excluded = lade_shop()
    dateien = freisteller(QUELLE)
    nach_nr = {}
    for d in dateien:
        if d["parsed"]:
            nach_nr.setdefault(d["parsed"][1], []).append(d)
    shop_bilder = []
    for it in items:
        sid = int(it["id"])
        for k, g in enumerate(dict.fromkeys(it.get("gallery") or [])):   # doppelte Pfade nur einmal
            shop_bilder.append(dict(shop_id=sid, gallery=g, pos=k, article=links.get(sid, str(it.get("article") or "")),
                                    ausgeschlossen=sid in excluded))
    print(f"{len(shop_bilder)} Shop-Bilder, {len(dateien)} freigestellte Dateien in {QUELLE}")
    sig_shop = _signaturen([str(BASE / b["gallery"]) for b in shop_bilder if (BASE / b["gallery"]).is_file()])
    sig_frei = _signaturen([str(d["pfad"]) for d in dateien])
    eintraege, offen = [], []
    alle = dateien
    for it in items:
        sid = int(it["id"])
        bilder = [b for b in shop_bilder if b["shop_id"] == sid]
        kandidaten = nach_nr.get(links.get(sid, str(it.get("article") or "")), [])
        paare = []
        for b in bilder:
            s = sig_shop.get(str(BASE / b["gallery"]))
            if s is None:
                offen.append(dict(b, grund="Shop-Datei fehlt"))
                continue
            werte = sorted((_abstand(s, sig_frei[str(d["pfad"])]), i) for i, d in enumerate(kandidaten))
            if not werte or werte[0][0] > SICHER:
                # Kein passender Freisteller mit dieser Nummer: alle Dateien durchsuchen (zur Diagnose)
                werte_alle = sorted((_abstand(s, sig_frei[str(d["pfad"])]), i) for i, d in enumerate(alle))
                bester = alle[werte_alle[0][1]] if werte_alle and werte_alle[0][0] <= SICHER else None
                offen.append(dict(b, grund="kein Freisteller mit dieser Artikelnummer passt",
                                  bester_anderswo=(bester["rel"] if bester else None),
                                  wert=(round(werte_alle[0][0], 2) if werte_alle else None)))
                continue
            paare.append((b, werte))
        # eindeutige Zuordnung je Artikel (bester Wert zuerst)
        vergeben = set()
        for b, werte in sorted(paare, key=lambda x: x[1][0][0]):
            frei = [(v, i) for v, i in werte if i not in vergeben]
            if not frei or frei[0][0] > SICHER:
                offen.append(dict(b, grund="kein freier passender Freisteller"))
                continue
            v, i = frei[0]
            zweit = frei[1][0] if len(frei) > 1 else None
            if zweit is not None and zweit - v < ABSTAND:
                offen.append(dict(b, grund="nicht eindeutig", wert=round(v, 2), zweit=round(zweit, 2)))
                continue
            vergeben.add(i)
            d = kandidaten[i]
            eintraege.append(dict(shop_id=b["shop_id"], gallery=b["gallery"], article=b["article"], n=d["parsed"][0],
                                  freigestellt=d["rel"], freigestellt_sha256=sha256(d["pfad"]),
                                  webp_sha256=sha256(BASE / b["gallery"]), abweichung=round(v, 2),
                                  **({"ausgeschlossen": True} if b["ausgeschlossen"] else {})))
    eintraege.sort(key=lambda e: (e["shop_id"], e["gallery"]))
    alte = json.loads(CROSSWALK.read_text(encoding="utf-8-sig")) if CROSSWALK.exists() else {}
    ausnahmen = alte.get("ausnahmen", [])
    daten = dict(version=1, beschreibung=(
        "Shop-Bild -> freigestelltes Bild. Name des Freistellers = Originalfoto + ' freigestellt'; "
        "die Zahl nach '(n)' ist die Artikelnummer. Erzeugt mit tools/fotoquellen.py zuordnen, "
        "geprueft von scripts/validate_photo_sources.py."), quelle_ordner="lokaler Freisteller-Ordner (tools/fotoquellen.local.json)",
        bilder=eintraege, ausnahmen=ausnahmen)
    sys.path.insert(0, str(BASE / "scripts"))
    from validate_photo_sources import validate
    fehler, _ = validate(items, json.loads(LINKS.read_text(encoding="utf-8-sig")), daten)
    if fehler:
        print("Nicht gespeichert - die neue Zuordnung waere fehlerhaft:")
        for f in fehler[:50]:
            print("  " + f)
        return 1
    if args.ausgabe:
        Path(args.ausgabe).write_text(json.dumps(daten, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    else:
        CROSSWALK.write_text(json.dumps(daten, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    bericht = Path(args.bericht or (BASE / ".fotoquellen-cache" / "offen.json"))
    bericht.write_text(json.dumps(offen, ensure_ascii=False, indent=1, default=str), encoding="utf-8")
    print(f"zugeordnet: {len(eintraege)}, offen: {len(offen)} (Liste: {bericht})")
    return 0


def pruefen(args):
    """Freisteller-Ordner gegen photo-sources.json: was ist neu, geändert, umbenannt oder verschwunden?"""
    items, links, excluded = lade_shop()
    QUELLE = quelle()
    daten = json.loads(CROSSWALK.read_text(encoding="utf-8-sig"))
    nach_pfad = {e["freigestellt"].casefold(): e for e in daten["bilder"]}
    nach_sha = {}
    for e in daten["bilder"]:
        nach_sha.setdefault(e["freigestellt_sha256"], []).append(e)
    ausnahmen = {(a.get("freigestellt") or "").casefold() for a in daten.get("ausnahmen", []) if a.get("freigestellt")}
    artikel_von = {v: k for k, v in links.items()}
    dateien = freisteller(QUELLE)
    auf_platte = {d["rel"].casefold() for d in dateien}
    ok, neu, ohne_nr, geaendert, umbenannt, bekannt_ausnahme = [], [], [], [], [], []
    erledigt = set()
    for d in dateien:
        key = d["rel"].casefold()
        e = nach_pfad.get(key)
        if e:
            erledigt.add(key)
            (ok if sha256(d["pfad"]) == e["freigestellt_sha256"] else geaendert).append(d["rel"])
            continue
        if key in ausnahmen:
            bekannt_ausnahme.append(d["rel"])
            continue
        frueher = [x for x in nach_sha.get(sha256(d["pfad"]), []) if x["freigestellt"].casefold() not in auf_platte]
        if frueher:
            erledigt.add(frueher[0]["freigestellt"].casefold())
            umbenannt.append(f"{frueher[0]['freigestellt']} -> {d['rel']}")
            continue
        if d["parsed"]:
            n, nr = d["parsed"]
            sid = artikel_von.get(nr)
            neu.append(f"{d['rel']}  ->  Artikel #{nr}, Bild {n}" + (f", Shop {sid}" if sid else " (kein Shop-Artikel)"))
        else:
            ohne_nr.append(d["rel"])
    fehlt = [e["freigestellt"] for k, e in nach_pfad.items() if k not in erledigt]
    print(f"Ordner: {QUELLE}")
    print(f"Im Shop zugeordnet und unverändert: {len(ok)}")
    print(f"Bekannte Ausnahmen (nicht öffentliche Doppel, Zip Polo 7): {len(bekannt_ausnahme)}")
    print(f"Ohne Artikelnummer im Namen (kein Katalogartikel, z. B. Pelze): {len(ohne_nr)}")
    for titel, liste in (("Neue Freisteller (noch nicht im Shop)", neu), ("Geänderter Inhalt", geaendert),
                         ("Umbenannt", umbenannt), ("Im Ordner nicht mehr gefunden", fehlt)):
        print()
        print(f"{titel}: {len(liste)}")
        for z in liste[:200]:
            print("  " + z)
    if args.alles:
        print()
        print("Ohne Artikelnummer:")
        for z in ohne_nr:
            print("  " + z)
    return 1 if (geaendert or fehlt) else 0


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd")
    z = sub.add_parser("zuordnen")
    z.add_argument("--ausgabe")
    z.add_argument("--bericht")
    pr = sub.add_parser("pruefen")
    pr.add_argument("--alles", action="store_true")
    args = ap.parse_args(argv)
    if args.cmd == "zuordnen":
        return zuordnen(args)
    if not getattr(args, "alles", None):
        args.alles = False
    return pruefen(args)


if __name__ == "__main__":
    sys.exit(main())

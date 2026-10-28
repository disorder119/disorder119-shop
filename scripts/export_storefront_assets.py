"""Export public assets from immutable Git objects, never the working directory.

This does not rebuild, repair or modify the protected source catalog. The same
production allowlists filter files AND catalog fields before any upload.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parent.parent
MAX_FILES = 20000
MAX_BYTES = 25 * 1024 * 1024


def git(root, *args):
    return subprocess.check_output(["git", "-C", str(root), *args])


def node_json(node, cwd, script, value):
    result = subprocess.check_output([node, "--input-type=module", "-e", script],
        cwd=cwd, input=json.dumps(value).encode())
    return json.loads(result)


# Ladezeit (28.10.2026): Der Storefront-Worker (shop-worker/storefront-assets.js)
# gibt Skripten und Stilen mit ?v=<sha256[:10] des Inhalts> ein Jahr Browser-
# Cache. 17 Dateien hatten keine oder eine handgepflegte Version
# (?v=20261008-1) und wurden bei jedem Seitenwechsel neu nachgefragt. Beim
# Ausliefern bekommt deshalb jeder Verweis auf /assets/*.js|css den echten
# Inhalts-Hash - in den Seiten (src/href und die Liste im Startseiten-Lader)
# und in Skripten, die andere Dateien nachladen (Blaetter zuerst, weil sich
# der Hash eines Skripts mit den Verweisen darin aendert). Die Quellen in Git
# bleiben unveraendert; die CI-Patch-Skripte und Regressionspruefungen sehen
# weiter ihre gewohnten Verweise. Andere Inline-Skripte werden nie angefasst
# (CSP-Hashes in storefront-csp.js).
_ASSET_REF = r"/assets/(?P<datei>[A-Za-z0-9_-]+(?:/[A-Za-z0-9_-]+)*\.(?:js|css))"
# "…/x.js?v=20261008-1" (Literal) und "…/x.css?v=" + ASSET_VERSION (Verkettung)
_JS_LITERAL = re.compile(r"(?P<q>[\"'])" + _ASSET_REF + r"\?v=[A-Za-z0-9._-]+(?P=q)")
_JS_VERKETTET = re.compile(r"(?P<q>[\"'])" + _ASSET_REF + r"\?v=(?P=q)\s*\+\s*[A-Za-z_$][\w$]*")
_HTML_ATTR = re.compile(r"(?P<attr>\s(?:src|href)=\")" + _ASSET_REF + r"(?:\?v=[^\"]*)?\"")
_LADER_EINTRAG = re.compile(r"\"" + _ASSET_REF + r"(?:\?v=[^\"]*)?\"")
_SKRIPT = re.compile(r"(<script\b[^>]*>)(.*?)(</script\s*>)", re.S | re.I)
LADER_MARKER = "/* FOCUS3_MOBILE_RUNTIME_AFTER_LCP */"


def _kurz_hash(body: bytes) -> str:
    return hashlib.sha256(body).hexdigest()[:10]


def asset_versionen(public: Path) -> set[str]:
    """Setzt Inhalts-Hashes an alle Verweise; gibt die geaenderten Pfade zurueck."""
    assets = public / "assets"
    skripte = {p.relative_to(assets).as_posix(): p for p in assets.rglob("*.js")} if assets.is_dir() else {}
    verweise = {}
    for name, pfad in skripte.items():
        text = pfad.read_bytes().decode("utf-8")
        ziele = {m.group("datei") for rx in (_JS_LITERAL, _JS_VERKETTET) for m in rx.finditer(text)}
        verweise[name] = {z for z in ziele if (assets / z).is_file() and z != name}
    hashes, geaendert, offen = {}, set(), dict(verweise)

    def hash_von(datei: str) -> str:
        if datei not in hashes:
            hashes[datei] = _kurz_hash((assets / datei).read_bytes())
        return hashes[datei]

    while offen:
        bereit = sorted(n for n, ziele in offen.items() if not (ziele & offen.keys()))
        if not bereit:
            raise ValueError("Zyklische Skript-Verweise: " + ", ".join(sorted(offen)))
        for name in bereit:
            del offen[name]
            if not verweise[name]:
                continue
            pfad = skripte[name]
            alt = pfad.read_bytes().decode("utf-8")

            def setzen(m):
                datei = m.group("datei")
                if datei not in verweise[name]:
                    return m.group(0)
                return f'{m.group("q")}/assets/{datei}?v={hash_von(datei)}{m.group("q")}'
            neu = _JS_VERKETTET.sub(setzen, _JS_LITERAL.sub(setzen, alt))
            if neu != alt:
                pfad.write_bytes(neu.encode("utf-8"))
                geaendert.add("assets/" + name)
            hashes.pop(name, None)

    def html_setzen(m):
        datei = m.group("datei")
        if not (assets / datei).is_file():
            return m.group(0)
        return f'{m.group("attr")}/assets/{datei}?v={hash_von(datei)}"'

    def lader_setzen(m):
        datei = m.group("datei")
        if not (assets / datei).is_file():
            return m.group(0)
        return f'"/assets/{datei}?v={hash_von(datei)}"'

    for seite in public.rglob("*.html"):
        alt = seite.read_bytes().decode("utf-8")
        teile, pos = [], 0
        for m in _SKRIPT.finditer(alt):
            teile.append(_HTML_ATTR.sub(html_setzen, alt[pos:m.start()]))
            kopf, inhalt, fuss = m.group(1), m.group(2), m.group(3)
            # src-Attribut im Skript-Tag selbst; Inhalt nur beim Startseiten-Lader.
            kopf = _HTML_ATTR.sub(html_setzen, kopf)
            if inhalt.startswith(LADER_MARKER):
                inhalt = _LADER_EINTRAG.sub(lader_setzen, inhalt)
            teile.append(kopf + inhalt + fuss)
            pos = m.end()
        teile.append(_HTML_ATTR.sub(html_setzen, alt[pos:]))
        neu = "".join(teile)
        if neu != alt:
            seite.write_bytes(neu.encode("utf-8"))
            geaendert.add(seite.relative_to(public).as_posix())
    return geaendert


def asset_versionen_pruefen(public: Path) -> int:
    """Jeder ?v=-Verweis mit Hash-Form muss zum ausgelieferten Inhalt passen."""
    geprueft = 0
    for pfad in list(public.rglob("*.html")) + list((public / "assets").rglob("*.js")):
        for m in re.finditer(_ASSET_REF + r"\?v=(?P<v>[a-f0-9]{10})(?![a-f0-9])", pfad.read_bytes().decode("utf-8")):
            ziel = public / "assets" / m.group("datei")
            if ziel.is_file():
                if _kurz_hash(ziel.read_bytes()) != m.group("v"):
                    raise ValueError(f"Asset-Version passt nicht: {pfad.relative_to(public)} -> {m.group(0)}")
                geprueft += 1
    return geprueft


def export(root: Path, target: Path, revision: str, node="node"):
    commit = git(root, "rev-parse", "--verify", revision + "^{commit}").decode().strip()
    if target.exists():
        raise ValueError("Use a fresh output directory; existing files are never overwritten.")
    # The build directory must be outside the deployed public directory.
    target.mkdir(parents=True)
    public = target / "public"
    public.mkdir()
    with tempfile.TemporaryDirectory() as temporary:
        runtime = Path(temporary)
        (runtime / "package.json").write_text('{"type":"module","private":true}\n', encoding="utf-8")
        for name in ("storefront-edge.js", "storefront-csp.js", "catalog-number-routes.js", "geo-sperre.js", "waechter-regeln.js", "waechter-seiten.js", "privacy-security.js"):
            (runtime / name).write_bytes(git(root, "show", f"{commit}:shop-worker/{name}"))
        rows = []
        for row in git(root, "ls-tree", "-r", "-z", "-l", commit).split(b"\0"):
            if not row:
                continue
            info, path = row.split(b"\t", 1)
            mode, kind, oid, length = info.split()
            rows.append((path.decode("utf-8"), mode, kind, oid.decode(), int(length)))
        selected = set(node_json(node, runtime,
            "import {publicPath} from './storefront-edge.js';let s='';"
            "for await(const c of process.stdin)s+=c;"
            "console.log(JSON.stringify(JSON.parse(s).filter(p=>publicPath('/'+p))));",
            [r[0] for r in rows]))
        if len(selected) > MAX_FILES:
            raise ValueError("Public export exceeds the current Free plan file limit.")
        manifest, catalogs = [], {}
        process = subprocess.Popen(["git", "-C", str(root), "cat-file", "--batch"],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE)
        try:
            for path, mode, kind, oid, length in rows:
                if path not in selected:
                    continue
                if mode != b"100644" or kind != b"blob" or length > MAX_BYTES:
                    raise ValueError("Unexpected public file type or oversized asset: " + path)
                # Check normalized destinations independently of the JS allowlist.
                destination = (public / path).resolve()
                if not destination.is_relative_to(public.resolve()):
                    raise ValueError("Asset escapes public export.")
                process.stdin.write((oid + "\n").encode())
                process.stdin.flush()
                header = process.stdout.readline().decode().split()
                if header != [oid, "blob", str(length)]:
                    raise ValueError("Unexpected Git object header.")
                body = process.stdout.read(length)
                if len(body) != length or process.stdout.read(1) != b"\n":
                    raise ValueError("Truncated Git object.")
                if hashlib.sha1(b"blob " + str(length).encode() + b"\0" + body).hexdigest() != oid:
                    raise ValueError("Git object integrity check failed.")
                filtered = path in {"data/catalog.json", "data/items.json"}
                if filtered:
                    value = node_json(node, runtime,
                        "import {publicCatalog} from './storefront-edge.js';let s='';"
                        "for await(const c of process.stdin)s+=c;"
                        "console.log(JSON.stringify(publicCatalog(JSON.parse(s))));", json.loads(body))
                    body = (json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n").encode()
                    catalogs[path] = len(value)
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_bytes(body)
                manifest.append({"path": path, "bytes": len(body),
                    "sha256": hashlib.sha256(body).hexdigest(), "source_blob": oid,
                    "public_field_filter": filtered})
        finally:
            process.stdin.close()
            process.stdout.close()
            if process.wait() != 0:
                raise RuntimeError("Git object export failed.")
    # Inhalts-Hashes an alle Skript-/Stil-Verweise (siehe asset_versionen).
    versioniert = asset_versionen(public)
    for row in manifest:
        if row["path"] in versioniert:
            body = (public / row["path"]).read_bytes()
            row.update(bytes=len(body), sha256=hashlib.sha256(body).hexdigest(), asset_versions=True)
    asset_versionen_pruefen(public)
    for required in ("index.html", "en/index.html", "fr/index.html", "data/catalog.json",
                     "data/items.json", "kasse/index.html", "feed/google-merchant.xml",
                     "google7945c4dc594a9a9c.html", ".well-known/apple-developer-merchantid-domain-association"):
        if not (public / required).is_file():
            raise ValueError("Required integration/page asset missing: " + required)
    catalog = json.loads((public / "data/catalog.json").read_text("utf-8"))
    for item in catalog:
        for name in item.get("gallery", []):
            candidate = (public / name.lstrip("/")).resolve()
            if not candidate.is_relative_to(public.resolve()) or not candidate.is_file():
                raise ValueError("Public gallery points outside export or to a missing photo.")
        # Match the existing builder. A curated URL slug may intentionally
        # differ from the visible article number; migration must preserve it.
        article = str(item.get("url_slug", item["id"]))
        for language in ("", "en/", "fr/"):
            if not (public / language / "artikel" / article / "index.html").is_file():
                raise ValueError("Canonical product page missing.")
    result = {"source_commit": commit, "asset_count": len(manifest),
        "asset_bytes": sum(r["bytes"] for r in manifest), "public_catalog_rows": catalogs,
        "raw_private_catalog_uploaded": False, "files": manifest}
    (target / "manifest.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--revision", required=True)
    parser.add_argument("--output", type=Path, default=ROOT / ".storefront-build")
    parser.add_argument("--node", default="node")
    args = parser.parse_args()
    result = export(ROOT, args.output.resolve(), args.revision, args.node)
    print(json.dumps({k: v for k, v in result.items() if k != "files"}, indent=2))

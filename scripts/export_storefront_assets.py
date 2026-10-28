"""Export public assets from immutable Git objects, never the working directory.

This does not rebuild, repair or modify the protected source catalog. The same
production allowlists filter files AND catalog fields before any upload.
"""
from __future__ import annotations

import argparse
import hashlib
import json
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
        for name in ("storefront-edge.js", "storefront-csp.js", "catalog-number-routes.js", "geo-sperre.js", "waechter-regeln.js"):
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

#!/usr/bin/env python3
"""Make the browser admin robust to GitHub Contents API large-file responses.

GitHub's Contents API can omit inline ``content`` for files above the small-file
limit. The admin must then follow ``git_url`` and read the blob payload instead
of attempting JSON.parse(""). This migration is deliberately limited to the
public catalog editor under admin/ and does not touch protected shop modes.
"""
from pathlib import Path

BASE = Path(__file__).resolve().parents[1]
PATH = BASE / "admin" / "index.html"
MARKER = "ADMIN_LARGE_ITEMS_LOADER_V1"

OLD = '''  function fetchItems() {\n    var pat = currentPat;\n    return fetch(API_BASE + "?ref=" + BRANCH, { headers: ghHeaders(pat) }).then(function (res) {\n      if (res.status === 401 || res.status === 403) {\n        throw new Error("AUTH");\n      }\n      if (!res.ok) throw new Error("GitHub-Fehler " + res.status);\n      return res.json();\n    }).then(function (data) {\n      var text = b64DecodeUtf8(data.content);\n      state.items = JSON.parse(text);\n      state.sha = data.sha;\n    });\n  }'''

NEW = '''  // ADMIN_LARGE_ITEMS_LOADER_V1\n  function githubErrorFromResponse(res) {\n    if (res.status === 401) return Promise.reject(new Error("AUTH"));\n    if (res.status === 403) return Promise.reject(new Error("PERMISSION"));\n    return res.json().catch(function () { return {}; }).then(function (body) {\n      var detail = body && body.message ? ": " + body.message : "";\n      throw new Error("GitHub-Fehler " + res.status + detail);\n    });\n  }\n\n  function readGithubContentsPayload(data, pat) {\n    if (data && data.encoding === "base64" && typeof data.content === "string" && data.content.trim()) {\n      return Promise.resolve(data.content);\n    }\n    // GitHub Contents API returns encoding=none/no inline content for larger\n    // files. Follow the immutable Git-blob URL instead of parsing an empty\n    // string as JSON. This keeps the same repository/token scope.\n    if (!data || !data.git_url) {\n      return Promise.reject(new Error("GitHub liefert keine lesbaren Artikeldaten."));\n    }\n    return fetch(data.git_url, { headers: ghHeaders(pat) }).then(function (res) {\n      if (!res.ok) return githubErrorFromResponse(res);\n      return res.json();\n    }).then(function (blob) {\n      if (!blob || blob.encoding !== "base64" || typeof blob.content !== "string" || !blob.content.trim()) {\n        throw new Error("GitHub liefert den Artikelbestand nicht als lesbare Datei.");\n      }\n      return blob.content;\n    });\n  }\n\n  function fetchItems() {\n    var pat = currentPat;\n    return fetch(API_BASE + "?ref=" + encodeURIComponent(BRANCH), { headers: ghHeaders(pat) }).then(function (res) {\n      if (!res.ok) return githubErrorFromResponse(res);\n      return res.json();\n    }).then(function (data) {\n      state.sha = data.sha;\n      return readGithubContentsPayload(data, pat);\n    }).then(function (content) {\n      var text = b64DecodeUtf8(content);\n      if (!text.trim()) throw new Error("Artikeldaten sind leer.");\n      var parsed;\n      try {\n        parsed = JSON.parse(text);\n      } catch (err) {\n        throw new Error("Artikeldaten konnten nicht vollständig gelesen werden: " + err.message);\n      }\n      if (!Array.isArray(parsed)) throw new Error("Artikeldaten haben ein unerwartetes Format.");\n      state.items = parsed;\n    });\n  }'''


def main() -> None:
    text = PATH.read_text(encoding="utf-8")
    if MARKER in text:
        print("Admin Large-Items-Loader bereits aktuell.")
        return
    if OLD not in text:
        raise SystemExit("FEHLER: fetchItems-Anker fuer Admin Large-Items-Loader fehlt")
    text = text.replace(OLD, NEW, 1)
    PATH.write_text(text, encoding="utf-8")
    print("Admin Large-Items-Loader angewendet: Contents-API + Git-Blob-Fallback.")


if __name__ == "__main__":
    main()

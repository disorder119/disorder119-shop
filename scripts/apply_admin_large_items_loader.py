#!/usr/bin/env python3
"""Make the browser admin robust to GitHub Contents API responses.

The admin reads a comparatively large ``data/items.json`` file directly from
GitHub. The Contents API can omit inline content for large files and mobile or
browser connections can occasionally deliver an empty/truncated JSON response.
This migration follows ``git_url`` when necessary and retries only transport /
JSON-body failures. Authentication and permission failures remain hard errors.

The migration is deliberately limited to the catalog editor under ``admin/``
and does not touch Match, Chaos or Baukasten.
"""
from pathlib import Path

BASE = Path(__file__).resolve().parents[1]
PATH = BASE / "admin" / "index.html"
MARKER_V1 = "ADMIN_LARGE_ITEMS_LOADER_V1"
MARKER_V2 = "ADMIN_GITHUB_JSON_RETRY_V2"

OLD = '''  function fetchItems() {\n    var pat = currentPat;\n    return fetch(API_BASE + "?ref=" + BRANCH, { headers: ghHeaders(pat) }).then(function (res) {\n      if (res.status === 401 || res.status === 403) {\n        throw new Error("AUTH");\n      }\n      if (!res.ok) throw new Error("GitHub-Fehler " + res.status);\n      return res.json();\n    }).then(function (data) {\n      var text = b64DecodeUtf8(data.content);\n      state.items = JSON.parse(text);\n      state.sha = data.sha;\n    });\n  }'''

V1 = '''  // ADMIN_LARGE_ITEMS_LOADER_V1\n  function githubErrorFromResponse(res) {\n    if (res.status === 401) return Promise.reject(new Error("AUTH"));\n    if (res.status === 403) return Promise.reject(new Error("PERMISSION"));\n    return res.json().catch(function () { return {}; }).then(function (body) {\n      var detail = body && body.message ? ": " + body.message : "";\n      throw new Error("GitHub-Fehler " + res.status + detail);\n    });\n  }\n\n  function readGithubContentsPayload(data, pat) {\n    if (data && data.encoding === "base64" && typeof data.content === "string" && data.content.trim()) {\n      return Promise.resolve(data.content);\n    }\n    // GitHub Contents API returns encoding=none/no inline content for larger\n    // files. Follow the immutable Git-blob URL instead of parsing an empty\n    // string as JSON. This keeps the same repository/token scope.\n    if (!data || !data.git_url) {\n      return Promise.reject(new Error("GitHub liefert keine lesbaren Artikeldaten."));\n    }\n    return fetch(data.git_url, { headers: ghHeaders(pat) }).then(function (res) {\n      if (!res.ok) return githubErrorFromResponse(res);\n      return res.json();\n    }).then(function (blob) {\n      if (!blob || blob.encoding !== "base64" || typeof blob.content !== "string" || !blob.content.trim()) {\n        throw new Error("GitHub liefert den Artikelbestand nicht als lesbare Datei.");\n      }\n      return blob.content;\n    });\n  }\n\n  function fetchItems() {\n    var pat = currentPat;\n    return fetch(API_BASE + "?ref=" + encodeURIComponent(BRANCH), { headers: ghHeaders(pat) }).then(function (res) {\n      if (!res.ok) return githubErrorFromResponse(res);\n      return res.json();\n    }).then(function (data) {\n      state.sha = data.sha;\n      return readGithubContentsPayload(data, pat);\n    }).then(function (content) {\n      var text = b64DecodeUtf8(content);\n      if (!text.trim()) throw new Error("Artikeldaten sind leer.");\n      var parsed;\n      try {\n        parsed = JSON.parse(text);\n      } catch (err) {\n        throw new Error("Artikeldaten konnten nicht vollständig gelesen werden: " + err.message);\n      }\n      if (!Array.isArray(parsed)) throw new Error("Artikeldaten haben ein unerwartetes Format.");\n      state.items = parsed;\n    });\n  }'''

V2 = '''  // ADMIN_LARGE_ITEMS_LOADER_V1 / ADMIN_GITHUB_JSON_RETRY_V2\n  function githubDelay(ms) {\n    return new Promise(function (resolve) { setTimeout(resolve, ms); });\n  }\n\n  function githubErrorFromResponse(res) {\n    if (res.status === 401) return Promise.reject(new Error("AUTH"));\n    if (res.status === 403) return Promise.reject(new Error("PERMISSION"));\n    return res.text().catch(function () { return ""; }).then(function (text) {\n      var body = {};\n      if (text && text.trim()) {\n        try { body = JSON.parse(text); } catch (ignore) {}\n      }\n      var detail = body && body.message ? ": " + body.message : "";\n      throw new Error("GitHub-Fehler " + res.status + detail);\n    });\n  }\n\n  function githubJsonFetch(url, options, label, attempt) {\n    attempt = attempt || 1;\n    return fetch(url, options).then(function (res) {\n      if (!res.ok) return githubErrorFromResponse(res);\n      return res.text().then(function (text) {\n        var parsed;\n        if (text && text.trim()) {\n          try { parsed = JSON.parse(text); } catch (err) {\n            if (attempt < 3) {\n              return githubDelay(250 * attempt).then(function () {\n                return githubJsonFetch(url, options, label, attempt + 1);\n              });\n            }\n            throw new Error(label + " konnte nicht vollständig gelesen werden (" + err.message + "). Bitte Verbindung prüfen und erneut versuchen.");\n          }\n          return parsed;\n        }\n        if (attempt < 3) {\n          return githubDelay(250 * attempt).then(function () {\n            return githubJsonFetch(url, options, label, attempt + 1);\n          });\n        }\n        throw new Error(label + " lieferte nach 3 Versuchen eine leere Antwort. Bitte Verbindung prüfen und erneut versuchen.");\n      });\n    }).catch(function (err) {\n      // Browser/network fetch failures are usually TypeError. Retry those,\n      // but never retry explicit auth/permission/HTTP errors.\n      if (attempt < 3 && err && err.name === "TypeError") {\n        return githubDelay(250 * attempt).then(function () {\n          return githubJsonFetch(url, options, label, attempt + 1);\n        });\n      }\n      throw err;\n    });\n  }\n\n  function readGithubContentsPayload(data, pat) {\n    if (data && data.encoding === "base64" && typeof data.content === "string" && data.content.trim()) {\n      return Promise.resolve(data.content);\n    }\n    // GitHub Contents API returns encoding=none/no inline content for larger\n    // files. Follow the immutable Git-blob URL instead of parsing an empty\n    // string as JSON. This keeps the same repository/token scope.\n    if (!data || !data.git_url) {\n      return Promise.reject(new Error("GitHub liefert keine lesbaren Artikeldaten."));\n    }\n    return githubJsonFetch(data.git_url, { headers: ghHeaders(pat), cache: "no-store" }, "GitHub-Datei", 1).then(function (blob) {\n      if (!blob || blob.encoding !== "base64" || typeof blob.content !== "string" || !blob.content.trim()) {\n        throw new Error("GitHub liefert den Artikelbestand nicht als lesbare Datei.");\n      }\n      return blob.content;\n    });\n  }\n\n  function fetchItems() {\n    var pat = currentPat;\n    var url = API_BASE + "?ref=" + encodeURIComponent(BRANCH) + "&_=" + Date.now();\n    return githubJsonFetch(url, { headers: ghHeaders(pat), cache: "no-store" }, "GitHub-Verbindung", 1).then(function (data) {\n      if (!data || !data.sha) throw new Error("GitHub liefert keinen gültigen Dateistand.");\n      state.sha = data.sha;\n      return readGithubContentsPayload(data, pat);\n    }).then(function (content) {\n      var text = b64DecodeUtf8(content);\n      if (!text.trim()) throw new Error("Artikeldaten sind leer.");\n      var parsed;\n      try {\n        parsed = JSON.parse(text);\n      } catch (err) {\n        throw new Error("Artikeldaten konnten nicht vollständig gelesen werden: " + err.message);\n      }\n      if (!Array.isArray(parsed)) throw new Error("Artikeldaten haben ein unerwartetes Format.");\n      state.items = parsed;\n    });\n  }'''

VERIFY_V1 = '''      if (err.message === "AUTH") {\n        showError(errElId, "Token abgelehnt (401/403) — Berechtigung prüfen (Contents: Read and write) oder neu erstellen.");\n      } else {\n        showError(errElId, "Verbindung zu GitHub fehlgeschlagen: " + err.message);\n      }'''

VERIFY_V2 = '''      if (err.message === "AUTH") {\n        showError(errElId, "Token abgelehnt (401) — Token neu erstellen oder auf Tippfehler prüfen.");\n      } else if (err.message === "PERMISSION") {\n        showError(errElId, "Token hat keine Berechtigung (403) — Repository disorder119/disorder119-shop und Contents: Read and write prüfen.");\n      } else {\n        showError(errElId, "Verbindung zu GitHub fehlgeschlagen: " + err.message);\n      }'''


def main() -> None:
    text = PATH.read_text(encoding="utf-8")
    changed = False

    if MARKER_V2 not in text:
        if V1 in text:
            text = text.replace(V1, V2, 1)
            changed = True
        elif OLD in text:
            text = text.replace(OLD, V2, 1)
            changed = True
        else:
            raise SystemExit("FEHLER: fetchItems-Anker fuer Admin GitHub-Loader fehlt")

    if VERIFY_V2 not in text:
        if VERIFY_V1 not in text:
            raise SystemExit("FEHLER: verifyAndBoot-Anker fuer Admin GitHub-Loader fehlt")
        text = text.replace(VERIFY_V1, VERIFY_V2, 1)
        changed = True

    if changed:
        PATH.write_text(text, encoding="utf-8")
        print("Admin GitHub-Loader V2 angewendet: Blob-Fallback, no-store und Retry bei leeren/abgeschnittenen JSON-Antworten.")
    else:
        print("Admin GitHub-Loader V2 bereits aktuell.")


if __name__ == "__main__":
    main()

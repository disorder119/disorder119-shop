#!/usr/bin/env python3
"""Harden the browser admin's GitHub Contents API transport.

The admin reads and writes ``data/items.json`` directly through GitHub's REST
API. This migration keeps the large-file Git-blob fallback, removes blind
``Response.json()`` calls, classifies HTTP/auth/rate-limit/network failures,
uses the documented Bearer form for fine-grained PATs, and invalidates the
admin PWA shell cache so iOS/Safari cannot keep serving the pre-fix admin.

The migration is deliberately limited to ``admin/`` and does not touch Match,
Chaos, Baukasten, rental constants or ``config/mode-guard.json``.
"""
from pathlib import Path

BASE = Path(__file__).resolve().parents[1]
ADMIN = BASE / "admin" / "index.html"
ADMIN_SW = BASE / "admin" / "sw.js"
MARKER_V1 = "ADMIN_LARGE_ITEMS_LOADER_V1"
MARKER_V2 = "ADMIN_GITHUB_JSON_RETRY_V2"
MARKER_V3 = "ADMIN_GITHUB_RESPONSE_V3"


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if new in text:
        return text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"FEHLER: Admin GitHub V3 {label}: erwartete 1 Fundstelle, gefunden {count}")
    return text.replace(old, new, 1)


V3_TRANSPORT = r'''  // ADMIN_LARGE_ITEMS_LOADER_V1 / ADMIN_GITHUB_JSON_RETRY_V2 / ADMIN_GITHUB_RESPONSE_V3
  function githubFailure(code, message) {
    var err = new Error(message || code);
    err.code = code;
    return err;
  }

  function githubDelay(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function githubContentType(res) {
    return String((res.headers && res.headers.get("content-type")) || "").toLowerCase();
  }

  function githubIsJsonContentType(res) {
    var type = githubContentType(res);
    return type.indexOf("application/json") !== -1 || type.indexOf("+json") !== -1;
  }

  function githubReadText(res) {
    return res.text().catch(function () { return ""; });
  }

  function githubRateLimitDetail(res) {
    var retryAfter = Number((res.headers && res.headers.get("retry-after")) || 0);
    if (Number.isFinite(retryAfter) && retryAfter > 0) {
      return " Bitte nach etwa " + Math.ceil(retryAfter) + " Sekunden erneut versuchen.";
    }
    var reset = Number((res.headers && res.headers.get("x-ratelimit-reset")) || 0);
    if (Number.isFinite(reset) && reset > 0) {
      var seconds = Math.max(1, Math.ceil(reset - Date.now() / 1000));
      return " Bitte nach etwa " + seconds + " Sekunden erneut versuchen.";
    }
    return " Bitte später erneut versuchen.";
  }

  function githubErrorFromResponse(res, label) {
    return githubReadText(res).then(function (text) {
      var apiMessage = "";
      if (text && text.trim() && githubIsJsonContentType(res)) {
        try {
          var body = JSON.parse(text);
          if (body && typeof body.message === "string") apiMessage = body.message;
        } catch (ignore) {
          // Fehlerantworten sind optionales Diagnosematerial. Ein kaputtes
          // Error-JSON darf niemals selbst den sichtbaren Fehler auslösen.
        }
      }

      if (res.status === 401) {
        throw githubFailure("AUTH", "GitHub hat den Token mit HTTP 401 abgelehnt.");
      }

      var remaining = String((res.headers && res.headers.get("x-ratelimit-remaining")) || "");
      var retryAfter = String((res.headers && res.headers.get("retry-after")) || "");
      if (res.status === 429 || (res.status === 403 && (remaining === "0" || retryAfter))) {
        throw githubFailure("RATE_LIMIT", "GitHub-Rate-Limit erreicht." + githubRateLimitDetail(res));
      }

      if (res.status === 403) {
        throw githubFailure("PERMISSION", "GitHub verweigert den Repository-Zugriff mit HTTP 403.");
      }

      var detail = apiMessage ? ": " + apiMessage : "";
      if (res.status >= 500 && res.status <= 599) {
        throw githubFailure("SERVER", (label || "GitHub") + " meldet HTTP " + res.status + detail + ".");
      }
      throw githubFailure("HTTP", (label || "GitHub") + " meldet HTTP " + res.status + detail + ".");
    });
  }

  function githubJsonFromResponse(res, label) {
    if (!res.ok) return githubErrorFromResponse(res, label);

    // 204/205 sind erfolgreiche HTTP-Antworten ohne Body. Dieser Admin
    // erwartet an seinen GitHub-Endpunkten aber JSON und darf deshalb nie
    // response.json()/JSON.parse("") aufrufen.
    if (res.status === 204 || res.status === 205) {
      return Promise.reject(githubFailure(
        "EMPTY",
        (label || "GitHub") + " lieferte HTTP " + res.status + " ohne Inhalt."
      ));
    }

    return githubReadText(res).then(function (text) {
      if (!text || !text.trim()) {
        throw githubFailure("EMPTY", (label || "GitHub") + " lieferte eine leere Antwort.");
      }

      var contentType = githubContentType(res);
      if (!githubIsJsonContentType(res)) {
        throw githubFailure(
          "CONTENT_TYPE",
          (label || "GitHub") + " lieferte statt JSON den Content-Type " + (contentType || "unbekannt") + "."
        );
      }

      try {
        return JSON.parse(text);
      } catch (ignore) {
        throw githubFailure(
          "MALFORMED_JSON",
          (label || "GitHub") + " lieferte unvollständiges JSON. Bitte Verbindung prüfen und erneut versuchen."
        );
      }
    });
  }

  function githubRetryable(err) {
    return err && (
      err.code === "NETWORK" ||
      err.code === "EMPTY" ||
      err.code === "MALFORMED_JSON" ||
      err.code === "SERVER"
    );
  }

  function githubJsonFetch(url, options, label, attempt) {
    attempt = attempt || 1;
    return fetch(url, options).catch(function (err) {
      if (err && err.name === "TypeError") {
        throw githubFailure(
          "NETWORK",
          "Netzwerkzugriff auf api.github.com fehlgeschlagen. Internetverbindung, Content-Blocker oder CORS prüfen."
        );
      }
      throw err;
    }).then(function (res) {
      return githubJsonFromResponse(res, label);
    }).catch(function (err) {
      if (attempt < 3 && githubRetryable(err)) {
        return githubDelay(250 * attempt).then(function () {
          return githubJsonFetch(url, options, label, attempt + 1);
        });
      }
      throw err;
    });
  }
'''


def patch_admin(text: str) -> str:
    if MARKER_V1 not in text or MARKER_V2 not in text:
        raise SystemExit("FEHLER: erwarteter Admin GitHub Loader V2 fehlt")

    text = replace_once(
        text,
        '''  function ghHeaders(pat) {
    return { Authorization: "token " + pat, Accept: "application/vnd.github+json" };
  }''',
        '''  function ghHeaders(pat) {
    return {
      Authorization: "Bearer " + pat,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28"
    };
  }''',
        "Fine-grained-PAT Header",
    )

    start = text.find("  // ADMIN_LARGE_ITEMS_LOADER_V1 / ADMIN_GITHUB_JSON_RETRY_V2")
    end = text.find("  function readGithubContentsPayload(data, pat)", start)
    if start < 0 or end < 0:
        raise SystemExit("FEHLER: Transportblock V2 nicht gefunden")
    current_block = text[start:end]
    if MARKER_V3 not in current_block:
        text = text[:start] + V3_TRANSPORT + "\n" + text[end:]

    old_save = '''      if (!res.ok) {
        return res.json().catch(function () { return {}; }).then(function (err) {
          throw new Error("GitHub-Fehler " + res.status + (err.message ? ": " + err.message : ""));
        });
      }
      return res.json();
    }).then(function (data) {
      if (data && data.__retried) return;
      state.items = nextItems;
      state.sha = data.content.sha;
    });'''
    new_save = '''      return githubJsonFromResponse(res, "GitHub-Speichern");
    }).then(function (data) {
      if (data && data.__retried) return;
      if (!data || !data.content || !data.content.sha) {
        throw githubFailure("FORMAT", "GitHub-Speichern lieferte keinen neuen Dateistand.");
      }
      state.items = nextItems;
      state.sha = data.content.sha;
    });'''
    text = replace_once(text, old_save, new_save, "Save-Response")

    old_verify = '''      if (err.message === "AUTH") {
        showError(errElId, "Token abgelehnt (401) — Token neu erstellen oder auf Tippfehler prüfen.");
      } else if (err.message === "PERMISSION") {
        showError(errElId, "Token hat keine Berechtigung (403) — Repository disorder119/disorder119-shop und Contents: Read and write prüfen.");
      } else {
        showError(errElId, "Verbindung zu GitHub fehlgeschlagen: " + err.message);
      }'''
    new_verify = '''      if (err && err.code === "AUTH") {
        showError(errElId, "Token abgelehnt (401) — Token neu erstellen oder auf Tippfehler prüfen.");
      } else if (err && err.code === "PERMISSION") {
        showError(errElId, "Token hat keine Berechtigung (403) — Repository disorder119/disorder119-shop und Contents: Read and write prüfen.");
      } else if (err && err.code === "RATE_LIMIT") {
        showError(errElId, err.message);
      } else if (err && err.code === "NETWORK") {
        showError(errElId, err.message);
      } else if (err && err.code === "CONTENT_TYPE") {
        showError(errElId, "GitHub antwortet nicht mit JSON — Content-Blocker, Proxy oder Netzwerk prüfen.");
      } else {
        showError(errElId, "Verbindung zu GitHub fehlgeschlagen: " + (err && err.message ? err.message : "Unbekannter Fehler."));
      }'''
    text = replace_once(text, old_verify, new_verify, "verifyAndBoot")
    return text


def patch_admin_sw(text: str) -> str:
    if 'const CACHE_PREFIX = "disorder119-admin-pwa-";' not in text:
        raise SystemExit("FEHLER: Admin-PWA Cache-Prefix fehlt")
    if 'const CACHE_NAME = CACHE_PREFIX + "v2";' in text:
        return text
    return replace_once(
        text,
        'const CACHE_NAME = CACHE_PREFIX + "v1";',
        'const CACHE_NAME = CACHE_PREFIX + "v2"; // ADMIN_GITHUB_RESPONSE_V3 cache invalidation',
        "PWA Cache-Version",
    )


def main() -> None:
    admin = ADMIN.read_text(encoding="utf-8")
    patched_admin = patch_admin(admin)
    if patched_admin != admin:
        ADMIN.write_text(patched_admin, encoding="utf-8")

    sw = ADMIN_SW.read_text(encoding="utf-8")
    patched_sw = patch_admin_sw(sw)
    if patched_sw != sw:
        ADMIN_SW.write_text(patched_sw, encoding="utf-8")

    print(
        "Admin GitHub Loader V3 angewendet: Bearer-PAT, Status/Content-Type/Text-Handling, "
        "leer/204 ohne JSON-Parse, Rate-Limit/Netzwerkfehler und PWA-Cache-Invalidierung."
    )


if __name__ == "__main__":
    main()

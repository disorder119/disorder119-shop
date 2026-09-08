#!/usr/bin/env python3
"""Static regression guard for the browser admin's GitHub items loader."""
from pathlib import Path

BASE = Path(__file__).resolve().parents[1]
ADMIN = BASE / "admin" / "index.html"
ADMIN_SW = BASE / "admin" / "sw.js"


def require(text: str, needle: str, label: str) -> None:
    if needle not in text:
        raise SystemExit(f"FEHLER: Admin GitHub Loader fehlt: {label}")


def main() -> None:
    text = ADMIN.read_text(encoding="utf-8")
    sw = ADMIN_SW.read_text(encoding="utf-8")

    require(text, "ADMIN_LARGE_ITEMS_LOADER_V1", "Large-Items Marker")
    require(text, "ADMIN_GITHUB_JSON_RETRY_V2", "Retry Marker")
    require(text, "ADMIN_GITHUB_RESPONSE_V3", "Response V3 Marker")
    require(text, 'Authorization: "Bearer " + pat', "Bearer Fine-grained PAT")
    require(text, '"X-GitHub-Api-Version": "2022-11-28"', "API-Version")
    require(text, "function githubJsonFromResponse(res, label)", "sicherer Response-Parser")
    require(text, "githubIsJsonContentType(res)", "Content-Type-Pruefung")
    require(text, "res.status === 204 || res.status === 205", "204/205 Behandlung")
    require(text, "function readGithubContentsPayload(data, pat)", "Blob-Fallback")
    require(text, 'if (data && data.encoding === "base64"', "Inline-Base64-Pfad")
    require(text, "if (!data || !data.git_url)", "Git-URL-Pruefung")
    require(text, "githubJsonFetch(data.git_url", "Git-Blob-Abruf")
    require(text, 'blob.encoding !== "base64"', "Blob-Encoding-Pruefung")
    require(text, "if (!Array.isArray(parsed))", "Katalog-JSON-Format")
    require(text, "encodeURIComponent(BRANCH)", "sicherer Branch-Query")
    require(text, 'githubJsonFromResponse(res, "GitHub-Speichern")', "sicherer Save-Parser")
    require(sw, 'CACHE_NAME = CACHE_PREFIX + "v2"', "Admin-PWA Cache-Invalidierung")

    if "var text = b64DecodeUtf8(data.content);" in text:
        raise SystemExit("FEHLER: alter direkter data.content-Parser ist wieder aktiv")
    if "res.json(" in text:
        raise SystemExit("FEHLER: blinder Response.json()-Aufruf ist wieder aktiv")
    if 'Authorization: "token " + pat' in text:
        raise SystemExit("FEHLER: Legacy token Authorization ist wieder aktiv")

    print(
        "Admin GitHub Loader: OK — Fine-grained Bearer PAT, sicherer JSON-Response-Parser, "
        "Blob-Fallback und PWA-Cache-Invalidierung aktiv."
    )


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Static regression guard for the browser admin's large items.json loader."""
from pathlib import Path

BASE = Path(__file__).resolve().parents[1]
ADMIN = BASE / "admin" / "index.html"


def require(text: str, needle: str, label: str) -> None:
    if needle not in text:
        raise SystemExit(f"FEHLER: Admin Large-Items-Loader fehlt: {label}")


def main() -> None:
    text = ADMIN.read_text(encoding="utf-8")
    require(text, "ADMIN_LARGE_ITEMS_LOADER_V1", "Marker")
    require(text, "function readGithubContentsPayload(data, pat)", "Blob-Fallback")
    require(text, "if (data && data.encoding === \"base64\"", "Inline-Base64-Pfad")
    require(text, "if (!data || !data.git_url)", "Git-URL-Pruefung")
    require(text, "return fetch(data.git_url", "Git-Blob-Abruf")
    require(text, "blob.encoding !== \"base64\"", "Blob-Encoding-Pruefung")
    require(text, "if (!Array.isArray(parsed))", "JSON-Format-Pruefung")
    require(text, "encodeURIComponent(BRANCH)", "sicherer Branch-Query")
    if "var text = b64DecodeUtf8(data.content);" in text:
        raise SystemExit("FEHLER: alter direkter data.content-Parser ist wieder aktiv")
    print("Admin Large-Items-Loader: OK — grosse items.json nutzt sicheren Git-Blob-Fallback statt leerem JSON-Parse.")


if __name__ == "__main__":
    main()

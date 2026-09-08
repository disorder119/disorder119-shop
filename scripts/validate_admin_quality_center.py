#!/usr/bin/env python3
"""Hard regression checks for the Disorder119 admin data-quality center."""
from pathlib import Path
import subprocess

BASE = Path(__file__).resolve().parents[1]
ADMIN = (BASE / "admin" / "index.html").read_text(encoding="utf-8")
ADMIN_SW = (BASE / "admin" / "sw.js").read_text(encoding="utf-8")


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit("FEHLER: Admin-Qualitaetszentrale: " + message)


def run_github_api_mock_tests() -> None:
    test_path = BASE / "scripts" / "admin_github_api_mock.test.mjs"
    require(test_path.is_file(), "GitHub-API Mock-Test fehlt")
    result = subprocess.run(
        ["node", "--test", str(test_path)],
        cwd=BASE,
        check=False,
    )
    require(result.returncode == 0, "GitHub-API Mock-Test fehlgeschlagen")


def main() -> None:
    require("ADMIN_QUALITY_CENTER_V1" in ADMIN, "Quality-Center Marker fehlt")
    require("ADMIN_QUALITY_HARDENING_V1" in ADMIN, "Hardening Marker fehlt")
    require('id="qualityBoard"' in ADMIN and "renderQualityBoard()" in ADMIN, "Qualitaetsboard fehlt")
    for value in ["qualityAvailable", "missingBrand", "missingGallery", "missingSize", "missingColor", "missingCondition", "thinDescription", "priceOnRequest", "duplicateArticle", "singlePhoto"]:
        require(f'value="{value}"' in ADMIN, f"Filter {value} fehlt")
    require("function articleNumberCounts(items)" in ADMIN, "Artikelnummer-Duplikatzaehler fehlt")
    require("function qualityIssues(it, articleCounts)" in ADMIN, "zentrale Qualitaetslogik fehlt")
    require("desc.length < 80" in ADMIN, "Beschreibungsschwelle weicht vom Shop-Validator ab")
    require('it.public_status === "AVAILABLE" && !(Number(it.price) > 0)' in ADMIN, "Preis-auf-Anfrage-Logik fehlt")
    require('it.public_status !== "DRAFT" && !String(it.brand || "").trim()' in ADMIN, "fehlende öffentliche Marke wird nicht erfasst")
    require("!gallery.length" in ADMIN and "gallery.length === 1" in ADMIN, "Fotoqualitaet wird nicht vollständig erfasst")
    require('label: "Verfügbar mit Lücke"' in ADMIN, "Prioritaetsstatistik fuer aktuelle Artikel fehlt")
    require('Number(it.price) * 0.10' in ADMIN, "abgeleiteter 10-Prozent-Mietpreis fehlt")
    require('data-field="rental_price"' not in ADMIN, "manueller Mietpreis ist weiterhin editierbar")
    require("Ohne Mietpreis" not in ADMIN and "Kein Mietpreis" not in ADMIN, "veraltete Mietpreis-Luecke wird weiterhin angezeigt")
    require("ADMIN_CONCURRENCY_RETRY_SAFE" in ADMIN and "__retried" in ADMIN, "optimistischer GitHub-409-Retry kann fremde Änderungen überschreiben")
    require("ADMIN_REVIEWED_TAXONOMY" in ADMIN and "it.taxonomy_category || it.category" in ADMIN, "Admin zeigt/filtert nicht nach geprüfter Taxonomie")
    require('roField("Geprüfte Kategorie"' in ADMIN, "geprüfte Kategorie fehlt im Detail")
    require("Titel darf nicht leer sein" in ADMIN, "Client-Schutz fuer leeren Titel fehlt")
    require("Öffentliche Artikel brauchen eine Marke" in ADMIN, "Client-Schutz fuer fehlende Marke fehlt")
    require("Preis muss 0 oder größer sein" in ADMIN, "Client-Schutz fuer ungueltigen Preis fehlt")
    require("data/items.json" in ADMIN, "Admin darf seine Inventarquelle nicht verlieren")
    require("config/mode-guard.json" not in ADMIN, "Admin darf Mode Guard nicht editieren")

    # GitHub API transport: no direct Response.json() is allowed. The admin
    # checks HTTP status, content type and body text first, then parses only a
    # non-empty JSON response. Large items.json still uses the Git blob path.
    require("ADMIN_LARGE_ITEMS_LOADER_V1" in ADMIN, "Large-Items-Loader Marker fehlt")
    require("ADMIN_GITHUB_JSON_RETRY_V2" in ADMIN, "GitHub-JSON-Retry V2 Marker fehlt")
    require("ADMIN_GITHUB_RESPONSE_V3" in ADMIN, "GitHub-Response V3 Marker fehlt")
    require('Authorization: "Bearer " + pat' in ADMIN, "Fine-grained PAT nutzt nicht Bearer")
    require('"X-GitHub-Api-Version": "2022-11-28"' in ADMIN, "GitHub API-Version Header fehlt")
    require('Authorization: "token " + pat' not in ADMIN, "Legacy token Authorization ist weiterhin aktiv")
    require("function githubJsonFromResponse(res, label)" in ADMIN, "zentraler Response-Parser fehlt")
    require("function githubContentType(res)" in ADMIN and "function githubIsJsonContentType(res)" in ADMIN, "Content-Type-Pruefung fehlt")
    require("res.status === 204 || res.status === 205" in ADMIN, "204/205 Leerantwort wird nicht explizit behandelt")
    require('err.code === "RATE_LIMIT"' in ADMIN, "Rate-Limit Fehlerklasse fehlt")
    require('err.code === "NETWORK"' in ADMIN and "CORS" in ADMIN, "Netzwerk/CORS Fehlerklasse fehlt")
    require('err.code === "CONTENT_TYPE"' in ADMIN, "Nicht-JSON Content-Type wird nicht erkannt")
    require('err.code === "MALFORMED_JSON"' in ADMIN, "abgeschnittenes JSON wird nicht klassifiziert")
    require("attempt < 3" in ADMIN and "githubDelay(250 * attempt)" in ADMIN, "GitHub-JSON-Retry ist nicht begrenzt/gebremst")
    require('cache: "no-store"' in ADMIN, "GitHub-Dateizugriff kann veraltete Cache-Antworten verwenden")
    require("function readGithubContentsPayload(data, pat)" in ADMIN, "Git-Blob-Fallback fehlt")
    require('data.encoding === "base64"' in ADMIN, "Inline-Base64-Pfad fehlt")
    require("if (!data || !data.git_url)" in ADMIN, "Git-URL-Pruefung fehlt")
    require("githubJsonFetch(data.git_url" in ADMIN, "Git-Blob-Abruf ueber resilienten Loader fehlt")
    require('blob.encoding !== "base64"' in ADMIN, "Blob-Encoding-Pruefung fehlt")
    require("if (!Array.isArray(parsed))" in ADMIN, "JSON-Format-Pruefung fehlt")
    require("var text = b64DecodeUtf8(data.content);" not in ADMIN, "alter direkter data.content-Parser ist wieder aktiv")
    require("res.json(" not in ADMIN, "blinder Response.json()-Aufruf ist im Admin aktiv")
    require('githubJsonFromResponse(res, "GitHub-Speichern")' in ADMIN, "Speicherantwort umgeht den sicheren Parser")
    require("!data || !data.content || !data.content.sha" in ADMIN, "Speicherantwort validiert neuen SHA nicht")

    # Installed Safari/iOS PWAs may have cached the pre-fix /admin/. Bumping
    # the admin-only cache namespace causes activation to delete v1, while the
    # worker still ignores api.github.com and every non-GET request.
    require('CACHE_NAME = CACHE_PREFIX + "v2"' in ADMIN_SW, "Admin-PWA Cache wurde fuer den Fix nicht invalidiert")
    require("ADMIN_GITHUB_RESPONSE_V3 cache invalidation" in ADMIN_SW, "PWA Cache-Fix Marker fehlt")
    require('url.origin !== self.location.origin' in ADMIN_SW, "Admin-PWA darf Cross-Origin GitHub API nicht intercepten")
    require('request.method !== "GET"' in ADMIN_SW, "Admin-PWA darf Schreibrequests nicht cachen")
    require("api.github.com" not in ADMIN_SW and "data/items.json" not in ADMIN_SW, "Admin-PWA darf GitHub/Inventar nicht precachen")

    run_github_api_mock_tests()
    print(
        "Admin-Qualitaetszentrale: OK — Datenqualitaet, Taxonomie, Mietpreis, Concurrent-Save, "
        "Fine-grained-PAT GitHub-Transport und PWA-Cache sind regressionsgeschuetzt."
    )


if __name__ == "__main__":
    main()

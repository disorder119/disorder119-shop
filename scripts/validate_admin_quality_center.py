#!/usr/bin/env python3
"""Hard regression checks for the Disorder119 admin data-quality center."""
from pathlib import Path

BASE = Path(__file__).resolve().parents[1]
ADMIN = (BASE / "admin" / "index.html").read_text(encoding="utf-8")


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit("FEHLER: Admin-Qualitaetszentrale: " + message)


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

    # GitHub's Contents API can omit inline content for larger files, while
    # mobile/browser transports can occasionally yield an empty/truncated JSON
    # body. The admin must follow git_url and parse through the retrying loader.
    require("ADMIN_LARGE_ITEMS_LOADER_V1" in ADMIN, "Large-Items-Loader Marker fehlt")
    require("ADMIN_GITHUB_JSON_RETRY_V2" in ADMIN, "GitHub-JSON-Retry V2 Marker fehlt")
    require("function githubJsonFetch(url, options, label, attempt)" in ADMIN, "retryender GitHub-JSON-Loader fehlt")
    require("attempt < 3" in ADMIN and "githubDelay(250 * attempt)" in ADMIN, "GitHub-JSON-Retry ist nicht begrenzt/gebremst")
    require('cache: "no-store"' in ADMIN, "GitHub-Dateizugriff kann veraltete Cache-Antworten verwenden")
    require("function readGithubContentsPayload(data, pat)" in ADMIN, "Git-Blob-Fallback fehlt")
    require('data.encoding === "base64"' in ADMIN, "Inline-Base64-Pfad fehlt")
    require("if (!data || !data.git_url)" in ADMIN, "Git-URL-Pruefung fehlt")
    require("githubJsonFetch(data.git_url" in ADMIN, "Git-Blob-Abruf ueber resilienten Loader fehlt")
    require('blob.encoding !== "base64"' in ADMIN, "Blob-Encoding-Pruefung fehlt")
    require("if (!Array.isArray(parsed))" in ADMIN, "JSON-Format-Pruefung fehlt")
    require("var text = b64DecodeUtf8(data.content);" not in ADMIN, "alter direkter data.content-Parser ist wieder aktiv")

    print("Admin-Qualitaetszentrale: OK — Luecken priorisiert, Taxonomie geprueft, Mietpreis abgeleitet, Concurrent-Save und resilienter grosser GitHub-Katalog sicher.")


if __name__ == "__main__":
    main()

"""Vorschau-Build zusammenstellen (.vorschau-build): die gebauten oeffentlichen
Seiten und Assets aus dem Arbeitsverzeichnis, ohne Server-Code, ohne
data/items.json, ohne Service Worker (der wuerde die Vorschau einfrieren),
robots.txt sperrt alles. Danach: wrangler deploy -c wrangler.vorschau.toml."""
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ZIEL = ROOT / ".vorschau-build"
ORDNER = ["artikel", "en", "fr", "assets", "feed", "cart", "kasse", "konto", "match", "baukasten", "mieten", "faq",
          "ueber-uns", "marke", "marken", "damen", "herren", "neu", "unter-100", "unter-200", "vintage-archive-shop", "newsletter", "impressum", "agb", "datenschutz", "widerruf", "universe", "chaos"]
DATEIEN = ["index.html", "404.html", "offline.html", "manifest.webmanifest", "llms.txt", "sitemap.xml"]


def main():
    if ZIEL.exists():
        shutil.rmtree(ZIEL)
    ZIEL.mkdir()
    for name in ORDNER:
        quelle = ROOT / name
        if not quelle.is_dir():
            continue
        shutil.copytree(quelle, ZIEL / name, ignore=shutil.ignore_patterns("*.py", "*.test.*", "*.md", "__pycache__"))
    for name in DATEIEN:
        quelle = ROOT / name
        if quelle.is_file():
            shutil.copy2(quelle, ZIEL / name)
    (ZIEL / "data").mkdir()
    shutil.copy2(ROOT / "data" / "catalog.json", ZIEL / "data" / "catalog.json")
    (ZIEL / "robots.txt").write_text("User-agent: *\nDisallow: /\n", encoding="utf-8")
    anzahl = sum(1 for p in ZIEL.rglob("*") if p.is_file())
    groesse = sum(p.stat().st_size for p in ZIEL.rglob("*") if p.is_file())
    print(f"{anzahl} Dateien, {groesse / 1_048_576:.0f} MB in {ZIEL}")
    if anzahl > 20000:
        sys.exit("FEHLER: mehr als 20000 Dateien (Workers-Assets-Grenze)")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Hard regression checks for the installable Disorder119 smartphone PWAs."""
from __future__ import annotations

import json
import xml.etree.ElementTree as ET
from pathlib import Path

BASE = Path(__file__).resolve().parents[1]


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit("FEHLER: PWA: " + message)


def require_pwa_head(html: str, label: str) -> None:
    required = [
        '<link rel="manifest" href="/manifest.webmanifest">',
        '<meta name="theme-color" content="#000000">',
        '<meta name="mobile-web-app-capable" content="yes">',
        '<meta name="apple-mobile-web-app-capable" content="yes">',
        '<meta name="apple-mobile-web-app-status-bar-style" content="black">',
        '<meta name="apple-mobile-web-app-title" content="Disorder119">',
        '<link rel="apple-touch-icon" href="/assets/favicon.png">',
    ]
    for needle in required:
        require(needle in html, f"{label}: {needle} fehlt")


def validate_admin_pwa() -> None:
    manifest_path = BASE / "admin" / "manifest.webmanifest"
    sw_path = BASE / "admin" / "sw.js"
    runtime_path = BASE / "assets" / "admin-pwa.js"
    offline_path = BASE / "admin" / "offline.html"
    admin_html_path = BASE / "admin" / "index.html"
    apply_path = BASE / "scripts" / "apply_admin_pwa.py"
    for path in (manifest_path, sw_path, runtime_path, offline_path, admin_html_path, apply_path):
        require(path.is_file(), f"Admin-PWA-Datei fehlt: {path.relative_to(BASE)}")

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    require(manifest.get("id") == "/admin/", "Admin-Manifest id muss /admin/ sein")
    require(manifest.get("start_url") == "/admin/" and manifest.get("scope") == "/admin/", "Admin-App darf nicht aus /admin/ herausgreifen")
    require(manifest.get("display") == "standalone", "Admin-App display muss standalone sein")
    require(manifest.get("theme_color") == "#000000" and manifest.get("background_color") == "#000000", "Admin-App-Farben sind inkonsistent")

    runtime = runtime_path.read_text(encoding="utf-8")
    require('navigator.serviceWorker.register("/admin/sw.js", { scope: "/admin/", updateViaCache: "none" })' in runtime, "Admin-Service-Worker wird nicht eng auf /admin/ registriert")
    require('(display-mode: standalone)' in runtime and 'navigator.standalone === true' in runtime, "Admin-Standalone-Erkennung fehlt")

    sw = sw_path.read_text(encoding="utf-8")
    require('url.origin !== self.location.origin' in sw, "Admin-Service-Worker muss fremde Origins ignorieren")
    require('request.method !== "GET"' in sw, "Admin-Service-Worker darf Schreibrequests nicht cachen")
    require('"/admin/offline.html"' in sw, "Admin-Offline-Fallback fehlt")
    require("api.github.com" not in sw and "data/items.json" not in sw, "Admin-Service-Worker darf GitHub-/Inventardaten nicht precachen")

    admin_html = admin_html_path.read_text(encoding="utf-8")
    for needle in [
        "D119_ADMIN_PWA_V1",
        '<link rel="manifest" href="/admin/manifest.webmanifest">',
        '<meta name="apple-mobile-web-app-capable" content="yes">',
        '<meta name="apple-mobile-web-app-title" content="Disorder119 Admin">',
        '<link rel="apple-touch-icon" href="/assets/favicon.png">',
        '/assets/admin-pwa.js?v=',
    ]:
        require(needle in admin_html, f"Admin-App-Integration fehlt: {needle}")


def main() -> None:
    manifest_path = BASE / "manifest.webmanifest"
    sw_path = BASE / "sw.js"
    pwa_js_path = BASE / "assets" / "pwa.js"
    offline_path = BASE / "offline.html"
    require(manifest_path.is_file(), "manifest.webmanifest fehlt")
    require(sw_path.is_file(), "sw.js fehlt")
    require(pwa_js_path.is_file(), "assets/pwa.js fehlt")
    require(offline_path.is_file(), "offline.html fehlt")

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    require(manifest.get("id") == "/", "Manifest id muss / sein")
    require(manifest.get("name") == "Disorder119" and manifest.get("short_name") == "Disorder119", "App-Name ist inkonsistent")
    require(manifest.get("start_url") == "/" and manifest.get("scope") == "/", "Start-URL/Scope muessen die ganze Site umfassen")
    require(manifest.get("display") == "standalone", "display muss standalone sein")
    require(manifest.get("theme_color") == "#000000" and manifest.get("background_color") == "#000000", "App-Farben muessen zum schwarzen Disorder119-Shell passen")
    icons = manifest.get("icons") or []
    require(any(i.get("type") == "image/png" and i.get("sizes") == "256x256" for i in icons), "PNG-App-Icon fehlt")
    require(any(i.get("type") == "image/svg+xml" and i.get("sizes") == "any" and "any" in str(i.get("purpose") or "").split() for i in icons), "skalierbares Any-Icon fehlt")
    require(any(i.get("type") == "image/svg+xml" and "maskable" in str(i.get("purpose") or "").split() for i in icons), "Maskable-Icon fehlt")
    require((manifest.get("launch_handler") or {}).get("client_mode") == "navigate-existing", "Launch-Handler soll bestehendes App-Fenster wiederverwenden")

    for icon_path in (BASE / "assets" / "app-icon.svg", BASE / "assets" / "app-icon-maskable.svg"):
        require(icon_path.is_file(), f"{icon_path.name} fehlt")
        ET.parse(icon_path)

    sw = sw_path.read_text(encoding="utf-8")
    for needle in [
        'self.addEventListener("install"',
        'self.addEventListener("activate"',
        'self.addEventListener("fetch"',
        'request.method !== "GET"',
        'url.origin !== self.location.origin',
        'url.pathname.startsWith("/admin/")',
        'request.mode === "navigate"',
        '"/offline.html"',
        '"/data/catalog.json"',
        'self.clients.claim()',
        'self.skipWaiting()',
    ]:
        require(needle in sw, f"Service-Worker-Invariante fehlt: {needle}")

    pwa_js = pwa_js_path.read_text(encoding="utf-8")
    require('navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" })' in pwa_js, "Service Worker wird nicht rootweit registriert")
    require('(display-mode: standalone)' in pwa_js and 'navigator.standalone === true' in pwa_js, "Standalone-Erkennung fuer Android/iOS fehlt")

    template = (BASE / "index_template.html").read_text(encoding="utf-8")
    build = (BASE / "build_site.py").read_text(encoding="utf-8")
    require("D119_PWA_V1" in template, "PWA-Marker im Haupttemplate fehlt")
    require("D119_PWA_V1_ARTICLE" in build, "PWA-Marker fuer Produktseiten fehlt")
    require("PWA_JS_VERSION" in build and '__PWA_JS_VERSION__' in template, "PWA-Asset bekommt kein Build-Cache-Busting")
    require_pwa_head(template, "index_template.html")
    require('<script src="/assets/pwa.js?v=__PWA_JS_VERSION__"></script>' in template, "Hauptbundle registriert PWA-Runtime nicht")
    require('<script src="/assets/pwa.js?v={PWA_JS_VERSION}"></script>' in build, "Produktseiten registrieren PWA-Runtime nicht")

    generated_index = BASE / "index.html"
    if generated_index.is_file():
        index_html = generated_index.read_text(encoding="utf-8")
        require_pwa_head(index_html, "index.html")
        require("__PWA_JS_VERSION__" not in index_html, "PWA-Versionstoken wurde im Build nicht ersetzt")
        require('/assets/pwa.js?v=' in index_html, "gebautes index.html laedt PWA-Runtime nicht")

    article_candidates = sorted((BASE / "artikel").glob("*/index.html")) if (BASE / "artikel").is_dir() else []
    if article_candidates:
        article_html = article_candidates[0].read_text(encoding="utf-8")
        require_pwa_head(article_html, "Produktseite")
        require('/assets/pwa.js?v=' in article_html, "gebaute Produktseite laedt PWA-Runtime nicht")

    validate_admin_pwa()
    print("PWA: OK — öffentliche App + getrennte Admin-App standalone installierbar; iOS/Android, Offline-Katalog und sichere Worker-Scopes geprüft.")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Add the separate installable Disorder119 Admin PWA shell.

The public shop keeps its root-scoped service worker. The admin app receives
its own /admin/ manifest and /admin/sw.js so it can be installed as a separate
home-screen app without the public worker caching/administering GitHub API data.
"""
from __future__ import annotations

import hashlib
import re
from pathlib import Path

BASE = Path(__file__).resolve().parents[1]
ADMIN = BASE / "admin" / "index.html"
RUNTIME = BASE / "assets" / "admin-pwa.js"
MARKER = "D119_ADMIN_PWA_V1"


def runtime_version() -> str:
    return hashlib.sha256(RUNTIME.read_bytes()).hexdigest()[:10]


def main() -> None:
    html = ADMIN.read_text(encoding="utf-8")

    # Use viewport-fit=cover so standalone iOS gets correct safe-area behavior
    # while retaining the current visual layout.
    html = html.replace(
        '<meta name="viewport" content="width=device-width, initial-scale=1">',
        '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
        1,
    )

    head_block = f'''<!-- {MARKER} -->
<meta name="theme-color" content="#000000">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black">
<meta name="apple-mobile-web-app-title" content="Disorder119 Admin">
<link rel="manifest" href="/admin/manifest.webmanifest">
<link rel="apple-touch-icon" href="/assets/favicon.png">'''

    if MARKER not in html:
        anchor = '<meta name="robots" content="noindex,nofollow">'
        if anchor not in html:
            raise SystemExit("FEHLER: Admin robots-meta Anker fehlt")
        html = html.replace(anchor, anchor + "\n" + head_block, 1)

    script = f'<script src="/assets/admin-pwa.js?v={runtime_version()}"></script>'
    existing = re.compile(r'<script src="/assets/admin-pwa\.js\?v=[^"]+"></script>')
    if existing.search(html):
        html = existing.sub(script, html, count=1)
    else:
        if "</body>" not in html:
            raise SystemExit("FEHLER: Admin </body> Anker fehlt")
        html = html.replace("</body>", script + "\n</body>", 1)

    ADMIN.write_text(html, encoding="utf-8")
    print("Admin-PWA: standalone iOS/Android App-Metadaten und eigener Runtime registriert.")


if __name__ == "__main__":
    main()

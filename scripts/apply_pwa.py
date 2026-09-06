#!/usr/bin/env python3
"""Make Disorder119 installable as a standalone smartphone PWA.

This changes only global document metadata/runtime registration and product-page
head generation. Match, Chaos, Baukasten, rental pricing and mode-guard data are
not modified.
"""
from pathlib import Path

BASE = Path(__file__).resolve().parents[1]
TEMPLATE = BASE / "index_template.html"
BUILD = BASE / "build_site.py"
TEMPLATE_MARKER = "D119_PWA_V1"
ARTICLE_MARKER = "D119_PWA_V1_ARTICLE"


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if new in text:
        return text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"FEHLER: PWA {label}: erwartete 1 Fundstelle, gefunden {count}")
    return text.replace(old, new, 1)


def patch_template(text: str) -> str:
    if TEMPLATE_MARKER not in text:
        text = replace_once(
            text,
            '<meta name="viewport" content="width=device-width, initial-scale=1">\n<meta name="description" content="__META_DESC__">',
            '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
            '<meta name="theme-color" content="#000000">\n'
            '<meta name="application-name" content="Disorder119">\n'
            '<meta name="mobile-web-app-capable" content="yes">\n'
            '<meta name="apple-mobile-web-app-capable" content="yes">\n'
            '<meta name="apple-mobile-web-app-status-bar-style" content="black">\n'
            '<meta name="apple-mobile-web-app-title" content="Disorder119">\n'
            '<link rel="manifest" href="/manifest.webmanifest"> <!-- D119_PWA_V1 -->\n'
            '<meta name="description" content="__META_DESC__">',
            "head metadata",
        )
    text = replace_once(
        text,
        '<script>window.SHOP_CONFIG = __SHOP_CONFIG_JSON__;</script>\n<script src="/assets/app.js?v=__APP_JS_VERSION__"></script>',
        '<script>window.SHOP_CONFIG = __SHOP_CONFIG_JSON__;</script>\n'
        '<script src="/assets/pwa.js?v=__PWA_JS_VERSION__"></script>\n'
        '<script src="/assets/app.js?v=__APP_JS_VERSION__"></script>',
        "bundle registration",
    )
    return text


def patch_build(text: str) -> str:
    text = replace_once(
        text,
        'ARTICLE_JS_VERSION = _asset_version("assets/article.js")\n',
        'ARTICLE_JS_VERSION = _asset_version("assets/article.js")\nPWA_JS_VERSION = _asset_version("assets/pwa.js")\n',
        "PWA asset version",
    )
    text = replace_once(
        text,
        '    out = out.replace("__APP_JS_VERSION__", APP_JS_VERSION)\n    return out\n',
        '    out = out.replace("__APP_JS_VERSION__", APP_JS_VERSION)\n'
        '    out = out.replace("__PWA_JS_VERSION__", PWA_JS_VERSION)\n'
        '    return out\n',
        "bundle PWA version token",
    )
    if ARTICLE_MARKER not in text:
        text = replace_once(
            text,
            '<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>{esc(title_tag)}</title>',
            '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
            '<meta name="theme-color" content="#000000">\n'
            '<meta name="application-name" content="Disorder119">\n'
            '<meta name="mobile-web-app-capable" content="yes">\n'
            '<meta name="apple-mobile-web-app-capable" content="yes">\n'
            '<meta name="apple-mobile-web-app-status-bar-style" content="black">\n'
            '<meta name="apple-mobile-web-app-title" content="Disorder119">\n'
            '<link rel="manifest" href="/manifest.webmanifest"> <!-- D119_PWA_V1_ARTICLE -->\n'
            '<link rel="apple-touch-icon" href="/assets/favicon.png">\n'
            '<title>{esc(title_tag)}</title>',
            "article head metadata",
        )
    text = replace_once(
        text,
        '<script src="/assets/article.js?v={ARTICLE_JS_VERSION}"></script>\n</body>',
        '<script src="/assets/pwa.js?v={PWA_JS_VERSION}"></script>\n'
        '<script src="/assets/article.js?v={ARTICLE_JS_VERSION}"></script>\n</body>',
        "article service worker registration",
    )
    return text


def main() -> None:
    template = TEMPLATE.read_text(encoding="utf-8")
    build = BUILD.read_text(encoding="utf-8")
    new_template = patch_template(template)
    new_build = patch_build(build)
    if new_template != template:
        TEMPLATE.write_text(new_template, encoding="utf-8")
    if new_build != build:
        BUILD.write_text(new_build, encoding="utf-8")
    print("PWA-Integration angewendet: Manifest + standalone iOS/Android + Service Worker.")


if __name__ == "__main__":
    main()

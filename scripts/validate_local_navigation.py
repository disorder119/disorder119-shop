#!/usr/bin/env python3
"""Validate local links/assets across generated Disorder119 HTML.

This is intentionally network-free: it resolves local href/src targets against the
built repository so broken internal navigation is caught before GitHub Pages deploys.
"""
from __future__ import annotations

from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit, unquote

BASE = Path(__file__).resolve().parents[1]
SKIP_FILES = {BASE / "index_template.html"}
SCAN_ROOTS = [
    BASE / "index.html", BASE / "404.html", BASE / "admin",
    BASE / "artikel", BASE / "cart", BASE / "impressum", BASE / "agb",
    BASE / "datenschutz", BASE / "ueber-uns", BASE / "faq", BASE / "mieten",
    BASE / "en", BASE / "fr", BASE / "match", BASE / "chaos", BASE / "baukasten",
]


class RefParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.refs: list[tuple[str, str, str]] = []

    def handle_starttag(self, tag: str, attrs) -> None:
        data = dict(attrs)
        if tag in {"a", "link"} and data.get("href"):
            self.refs.append((tag, "href", data["href"]))
        if tag in {"script", "img", "source"} and data.get("src"):
            self.refs.append((tag, "src", data["src"]))
        if tag == "source" and data.get("srcset"):
            for token in data["srcset"].split(","):
                value = token.strip().split(" ", 1)[0]
                if value:
                    self.refs.append((tag, "srcset", value))


def html_files() -> list[Path]:
    out: list[Path] = []
    for root in SCAN_ROOTS:
        if root.is_file():
            out.append(root)
        elif root.is_dir():
            out.extend(root.rglob("*.html"))
    return sorted({p for p in out if p not in SKIP_FILES})


def target_for(page: Path, raw: str) -> Path | None:
    value = raw.strip()
    if not value or value.startswith(("#", "mailto:", "tel:", "javascript:", "data:", "blob:")):
        return None
    parsed = urlsplit(value)
    if parsed.scheme or parsed.netloc:
        return None
    path = unquote(parsed.path)
    if not path:
        return None
    if path.startswith("/"):
        target = BASE / path.lstrip("/")
    else:
        target = page.parent / path
    if path.endswith("/") or target.is_dir():
        target = target / "index.html"
    return target.resolve()


def main() -> None:
    pages = html_files()
    if not pages:
        raise SystemExit("FEHLER: Navigation: keine generierten HTML-Seiten gefunden")
    errors: list[str] = []
    checked = 0
    for page in pages:
        parser = RefParser()
        try:
            parser.feed(page.read_text(encoding="utf-8"))
        except Exception as exc:
            errors.append(f"{page.relative_to(BASE)}: HTML nicht parsebar: {exc}")
            continue
        for tag, attr, raw in parser.refs:
            target = target_for(page, raw)
            if target is None:
                continue
            checked += 1
            try:
                target.relative_to(BASE.resolve())
            except ValueError:
                errors.append(f"{page.relative_to(BASE)}: lokales Ziel verlaesst Repo: {raw}")
                continue
            if not target.is_file():
                errors.append(f"{page.relative_to(BASE)}: {tag}[{attr}] -> {raw} fehlt ({target.relative_to(BASE)})")
    if errors:
        for error in errors[:80]:
            print("FEHLER:", error)
        if len(errors) > 80:
            print(f"FEHLER: ... plus {len(errors) - 80} weitere")
        raise SystemExit(1)
    print(f"Navigation/Assets: OK — {len(pages)} HTML-Seiten, {checked} lokale Ziele auf Existenz geprueft.")


if __name__ == "__main__":
    main()

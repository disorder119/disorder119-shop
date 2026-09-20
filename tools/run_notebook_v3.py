from __future__ import annotations

import html as html_lib
import re

import build_notebook_v3 as build


def verify_visible_site_copy():
    raw = (build.ROOT / "index.html").read_text(encoding="utf-8")
    # Convert actual HTML to visible text: decode entities, remove tags, normalize spaces.
    visible = html_lib.unescape(re.sub(r"<[^>]+>", " ", raw))
    visible = re.sub(r"\s+", " ", visible).strip()
    missing = []
    for key, text in build.SITE_TEXTS.items():
        if key == "brandline":
            # On the live page this line is split by <br> and a nested <span>,
            # so verify each visible component rather than inventing a new phrase.
            parts = ["Prada", "Dior", "Saint Laurent", "Jean Paul Gaultier", "Y-3", "u.v.m."]
            if not all(part in visible for part in parts):
                missing.append((key, text))
            continue
        normalized = re.sub(r"\s+", " ", text).strip()
        if normalized not in visible:
            missing.append((key, text))
    if missing:
        raise RuntimeError(f"Website copy changed; refusing to use unsupported text: {missing}")
    if "https://disorder119.com/" not in raw:
        raise RuntimeError("Current site no longer contains the disorder119.com canonical URL")


build.assert_site_texts_exist = verify_visible_site_copy
build.main()

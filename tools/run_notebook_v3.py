from __future__ import annotations

import html as html_lib
import re

from tools import build_notebook_v3 as build


def verify_visible_site_copy():
    raw = (build.ROOT / "index.html").read_text(encoding="utf-8")
    # Convert the actual HTML to visible text: decode entities such as &amp;,
    # remove tags such as the <br> inside the brand line, then normalize spaces.
    visible = html_lib.unescape(re.sub(r"<[^>]+>", " ", raw))
    visible = re.sub(r"\s+", " ", visible).strip()
    missing = []
    for key, text in build.SITE_TEXTS.items():
        normalized = re.sub(r"\s+", " ", text).strip()
        if normalized not in visible:
            missing.append((key, text))
    if missing:
        raise RuntimeError(f"Website copy changed; refusing to use unsupported text: {missing}")
    if "https://disorder119.com/" not in raw:
        raise RuntimeError("Current site no longer contains the disorder119.com canonical URL")


build.assert_site_texts_exist = verify_visible_site_copy
build.main()

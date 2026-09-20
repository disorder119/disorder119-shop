from __future__ import annotations

import colorsys
import json
import random
from collections import deque
from functools import lru_cache
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps
import qrcode

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "out_notebook_original_v5"
OUT.mkdir(exist_ok=True)

DPI = 300
MM_PER_INCH = 25.4
W_MM, H_MM = 344.5, 245.0
W = round(W_MM / MM_PER_INCH * DPI)
H = round(H_MM / MM_PER_INCH * DPI)

# User-supplied hardcover template:
# 15 mm wrap | 152 mm back | 10.5 mm spine | 152 mm front | 15 mm wrap
BACK_L, BACK_R = 15.0, 167.0
SPINE_L, SPINE_R = 167.0, 177.5
FRONT_L, FRONT_R = 177.5, 329.5

BLACK = (0, 0, 0, 255)
OFFWHITE = (245, 245, 242, 255)

# Real products from the current shop catalogue. Availability and file existence are
# checked at build time; missing IDs are skipped and replaced from other available items.
CANDIDATE_IDS = [
    6241,6240,6239,6238,6237,6236,6235,6234,6233,6232,6231,6230,6229,6228,6227,
    6226,6225,6224,6223,6222,6221,6220,6219,6218,6217,6216,6215,6214,6213,6212,
    6211,6210,6209,6208,6207,6206,6205,6204,6203,6202,6201,6200,6199,6198,6197,
    6196,6195,6194,6193,6192,6191,6190,6189,6188,6187,6186,6185,6184,6183,6182,
    9479,9378,9442,9362,9476,9475,9480,9463,9456,9432,9404,9401,9400,9365,9359,
    9347,9338,9325,9317,9306,9299,9288,9272,9258,9244,9231,9218,9206,9197,9189,
]


def mm(v: float) -> int:
    return round(v / MM_PER_INCH * DPI)


def font(size_mm: float, bold=False, narrow=False):
    candidates = []
    if narrow and bold:
        candidates += [
            "/usr/share/fonts/truetype/liberation2/LiberationSansNarrow-Bold.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSansCondensed-Bold.ttf",
        ]
    elif narrow:
        candidates += [
            "/usr/share/fonts/truetype/liberation2/LiberationSansNarrow-Regular.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSansCondensed.ttf",
        ]
    elif bold:
        candidates += ["/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"]
    else:
        candidates += ["/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"]
    for p in candidates:
        if Path(p).exists():
            return ImageFont.truetype(p, mm(size_mm))
    return ImageFont.load_default()


def load_items():
    return json.loads((ROOT / "data/items.json").read_text(encoding="utf-8"))


def is_available(item):
    return item.get("public_status") == "AVAILABLE" or str(item.get("status", "")).lower() in {"verfügbar", "available"}


def src_path(item):
    p = item.get("look") or ((item.get("gallery") or [None])[0])
    if not p:
        return None
    path = ROOT / p
    return path if path.exists() else None


def candidates(items):
    by_id = {int(i["id"]): i for i in items if "id" in i}
    out, seen = [], set()
    for pid in CANDIDATE_IDS:
        i = by_id.get(pid)
        if i and is_available(i) and src_path(i):
            out.append(i); seen.add(pid)
    # Fallback from the current catalogue, still real current products.
    for i in items:
        pid = int(i.get("id", -1))
        if pid not in seen and is_available(i) and src_path(i):
            out.append(i)
    return out


@lru_cache(maxsize=256)
def tone_for_path(path_str: str):
    """Estimate visual tone without changing the image.
    Near-black studio background is ignored for palette selection only.
    """
    im = Image.open(path_str).convert("RGB")
    im.thumbnail((120, 120), Image.Resampling.LANCZOS)
    pts = []
    for r, g, b in im.getdata():
        if max(r, g, b) < 28:
            continue
        pts.append((r, g, b))
    if not pts:
        return "dark"
    r = sum(p[0] for p in pts) / len(pts) / 255
    g = sum(p[1] for p in pts) / len(pts) / 255
    b = sum(p[2] for p in pts) / len(pts) / 255
    h, s, v = colorsys.rgb_to_hsv(r, g, b)
    if v < 0.40:
        return "dark"
    if s < 0.18 and v > 0.62:
        return "light"
    if s < 0.22:
        return "neutral"
    if 0.045 <= h <= 0.18:
        return "earth"
    if 0.18 < h <= 0.46:
        return "olive"
    if h < 0.045 or h > 0.95:
        return "warm"
    return "neutral"


def tone(item):
    return tone_for_path(str(src_path(item)))


def choose_palette(pool, quotas, total, seed):
    rng = random.Random(seed)
    chosen = []
    used_ids, used_brands = set(), set()

    def desirability(item, wanted_tone):
        brand = item.get("brand") or ""
        cat = item.get("taxonomy_category") or item.get("category") or ""
        used_cats = {x.get("taxonomy_category") or x.get("category") or "" for x in chosen}
        return (
            8 * (tone(item) == wanted_tone)
            + 3 * (brand not in used_brands)
            + 2 * (cat not in used_cats)
            + rng.random()
        )

    for wanted, count in quotas:
        available = [i for i in pool if int(i.get("id", -1)) not in used_ids]
        available.sort(key=lambda i: desirability(i, wanted), reverse=True)
        for i in available[:count]:
            chosen.append(i); used_ids.add(int(i["id"])); used_brands.add(i.get("brand") or "")

    if len(chosen) < total:
        rest = [i for i in pool if int(i.get("id", -1)) not in used_ids]
        rng.shuffle(rest)
        for i in rest:
            chosen.append(i)
            if len(chosen) >= total:
                break
    return chosen[:total]


@lru_cache(maxsize=128)
def cutout(path_str: str) -> Image.Image:
    """Remove only the near-black studio background connected to the image border.
    RGB values of the product itself are never recolored, tinted or filtered.
    """
    im = ImageOps.exif_transpose(Image.open(path_str)).convert("RGBA")
    rgb = im.convert("RGB")
    w, h = rgb.size
    pix = rgb.load()
    seen = bytearray(w * h)
    q = deque()

    def is_bg(x, y):
        r, g, b = pix[x, y]
        return max(r, g, b) <= 26 and (max(r, g, b) - min(r, g, b)) <= 16

    def push(x, y):
        idx = y * w + x
        if seen[idx] or not is_bg(x, y):
            return
        seen[idx] = 1
        q.append((x, y))

    for x in range(w):
        push(x, 0); push(x, h - 1)
    for y in range(h):
        push(0, y); push(w - 1, y)

    while q:
        x, y = q.popleft()
        if x > 0: push(x - 1, y)
        if x + 1 < w: push(x + 1, y)
        if y > 0: push(x, y - 1)
        if y + 1 < h: push(x, y + 1)

    rgba = im.load()
    for y in range(h):
        base = y * w
        for x in range(w):
            if seen[base + x]:
                r, g, b, _ = rgba[x, y]
                rgba[x, y] = (r, g, b, 0)
    bb = im.getbbox()
    if bb:
        im = im.crop(bb)
    return im


def place(base, item, box, angle=0):
    x, y, bw, bh = [mm(v) for v in box]
    im = cutout(str(src_path(item))).copy()
    scale = min(bw / im.width, bh / im.height)
    im = im.resize((max(1, round(im.width * scale)), max(1, round(im.height * scale))), Image.Resampling.LANCZOS)
    if angle:
        im = im.rotate(angle, expand=True, resample=Image.Resampling.BICUBIC)
    base.alpha_composite(im, (x + (bw - im.width) // 2, y + (bh - im.height) // 2))


def qr(size_mm=29):
    q = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_H, box_size=12, border=4)
    q.add_data("https://disorder119.com/")
    q.make(fit=True)
    im = q.make_image(fill_color="black", back_color="white").convert("RGBA")
    s = mm(size_mm)
    return im.resize((s, s), Image.Resampling.NEAREST)


def draw_domain_and_qr(base, x_mm, y_mm, size_mm=27):
    q = qr(size_mm)
    base.alpha_composite(q, (mm(x_mm), mm(y_mm)))
    d = ImageDraw.Draw(base)
    f = font(2.2, bold=True, narrow=True)
    text = "DISORDER119.COM"
    bb = d.textbbox((0, 0), text, font=f)
    d.text((mm(x_mm + size_mm / 2) - (bb[2] - bb[0]) / 2, mm(y_mm + size_mm + 2.2)), text, font=f, fill=OFFWHITE)


def draw_logo(base, cx_mm, y_mm, style="tight", scale=1.0):
    """Free-standing typographic DIS / ORDER / 119 mark. No box or background."""
    d = ImageDraw.Draw(base)
    if style == "tight":
        lines = [("DIS", 19.2), ("ORDER", 18.0), ("119", 20.0)]
        gaps = [0, 26.0, 51.0]
    elif style == "wide":
        lines = [("DIS", 18.0), ("ORDER", 16.5), ("119", 19.0)]
        gaps = [0, 25.0, 49.0]
    elif style == "compact":
        lines = [("DIS", 17.0), ("ORDER", 16.0), ("119", 18.5)]
        gaps = [0, 23.0, 45.0]
    else:
        lines = [("DIS", 19.5), ("ORDER", 17.5), ("119", 20.5)]
        gaps = [0, 27.0, 53.0]
    for (text, sz), gap in zip(lines, gaps):
        f = font(sz * scale, bold=True, narrow=True)
        bb = d.textbbox((0, 0), text, font=f)
        d.text((mm(cx_mm) - (bb[2] - bb[0]) / 2, mm(y_mm + gap * scale)), text, font=f, fill=OFFWHITE)


def base_canvas():
    b = Image.new("RGBA", (W, H), BLACK)
    # Spine is deliberately pure black, with no text.
    d = ImageDraw.Draw(b)
    d.rectangle((mm(SPINE_L), 0, mm(SPINE_R), H), fill=BLACK)
    return b


def render_variant(name, products, front_boxes, back_boxes, front_angles, back_angles, logo, qrpos):
    b = base_canvas()
    front_n = len(front_boxes)
    for item, box, angle in zip(products[:front_n], front_boxes, front_angles):
        place(b, item, box, angle)
    for item, box, angle in zip(products[front_n:front_n + len(back_boxes)], back_boxes, back_angles):
        place(b, item, box, angle)
    draw_logo(b, *logo)
    draw_domain_and_qr(b, *qrpos)
    img = b.convert("RGB")
    full = OUT / f"Disorder119_{name}_344.5x245mm_300dpi.png"
    prev = OUT / f"Disorder119_{name}_preview.png"
    img.save(full, dpi=(DPI, DPI), optimize=True)
    img.resize((1600, round(1600 * H / W)), Image.Resampling.LANCZOS).save(prev, optimize=True)
    return prev


def main():
    pool = candidates(load_items())
    if len(pool) < 35:
        raise RuntimeError(f"Only {len(pool)} usable current shop products found")

    variants = []

    # V1 — Black / cream / olive. Balanced and closest to the user's preferred third concept.
    prod = choose_palette(pool, [("dark", 11), ("light", 5), ("olive", 4), ("earth", 3)], 23, 11951)
    front = [(184,8,37,61),(294,10,34,54),(184,142,37,59),(297,146,32,57),(218,11,30,48),(267,10,29,46),(182,80,29,45),(302,82,28,43),(265,183,30,42)]
    back = [(5,8,31,48),(40,10,29,44),(74,6,31,48),(111,12,29,43),(139,7,27,46),(7,66,30,47),(43,64,31,48),(80,70,27,42),(115,66,30,47),(140,72,27,41),(9,127,31,47),(47,130,29,44),(83,124,31,48),(121,130,29,44)]
    variants.append(("V1_NOIR_OLIVE", prod, front, back, [-3,2,2,-2,1,-2,2,-2,2], [-3,2,-2,2,-2,2,-2,3,-3,2,-2,2,-2,2], (255,76,"tight",1.0), (112,196,27)))

    # V2 — Mostly black + cream, fewer objects, more premium empty space.
    prod = choose_palette(pool, [("dark", 10), ("light", 6), ("neutral", 3), ("earth", 2)], 21, 11952)
    front = [(181,4,43,71),(292,7,39,63),(181,164,44,69),(294,166,37,65),(218,8,32,51),(269,12,29,45),(181,91,28,43),(303,91,27,42)]
    back = [(5,7,35,54),(45,9,31,47),(82,6,34,53),(124,11,33,48),(9,72,32,49),(49,68,34,52),(91,75,29,44),(128,70,31,49),(8,138,34,51),(48,134,31,47),(88,141,30,45),(126,136,32,49),(72,190,31,42)]
    variants.append(("V2_BLACK_CREAM", prod, front, back, [-2,2,2,-2,0,2,-2,2], [-2,2,-2,2,2,-2,2,-2,-2,2,-2,2,0], (255,79,"wide",1.03), (114,197,27)))

    # V3 — Earth tones + black, asymmetrical editorial layout.
    prod = choose_palette(pool, [("dark", 9), ("earth", 6), ("light", 4), ("olive", 3)], 22, 11953)
    front = [(179,6,39,63),(297,7,34,57),(182,153,38,61),(295,159,34,60),(220,7,30,47),(269,14,27,43),(181,87,28,45),(303,76,27,43),(217,185,28,41)]
    back = [(4,6,31,48),(39,13,30,45),(74,3,33,52),(111,14,29,43),(139,5,28,49),(6,67,30,47),(42,63,31,49),(79,72,28,42),(112,64,31,48),(139,72,27,42),(10,128,31,48),(48,135,28,43),(83,126,32,49)]
    variants.append(("V3_EARTH_EDITORIAL", prod, front, back, [-4,2,3,-2,0,-2,2,-3,2], [-4,2,-2,3,-2,2,-3,3,-2,2,-2,3,-2], (254,78,"tight",.99), (112,196,27)))

    # V4 — One stronger green accent, otherwise black/neutral. More fashion-magazine energy.
    prod = choose_palette(pool, [("dark", 10), ("neutral", 4), ("light", 4), ("olive", 4)], 22, 11954)
    front = [(182,7,39,64),(295,8,35,58),(180,155,42,66),(293,157,37,64),(219,10,31,49),(269,10,29,46),(181,84,29,45),(302,82,28,44),(268,183,28,41)]
    back = [(6,7,31,48),(42,6,31,48),(78,12,28,43),(111,6,32,50),(142,12,25,43),(6,68,31,48),(43,64,31,49),(80,71,28,43),(113,66,31,48),(142,71,25,42),(10,129,31,47),(48,125,31,49),(87,132,28,43)]
    variants.append(("V4_GREEN_ACCENT", prod, front, back, [-3,2,3,-2,1,-1,2,-2,2], [-3,2,-2,2,-2,2,-2,3,-2,2,-2,2,-2], (255,77,"compact",1.04), (113,196,27)))

    # V5 — Sparsest version: the logo has the most room; still enough original products to communicate the archive.
    prod = choose_palette(pool, [("dark", 8), ("light", 4), ("earth", 4), ("olive", 2)], 18, 11955)
    front = [(180,7,43,69),(294,9,38,61),(181,164,44,67),(295,167,37,63),(221,9,31,49),(269,14,28,44),(303,85,27,42)]
    back = [(7,9,35,54),(48,7,32,49),(89,10,31,47),(128,8,33,50),(9,75,33,50),(50,72,33,51),(91,78,30,45),(129,74,31,48),(10,140,34,50),(53,137,31,47),(96,140,30,45)]
    variants.append(("V5_SPARSE", prod, front, back, [-2,2,2,-2,0,2,-2], [-2,2,-2,2,2,-2,2,-2,-2,2,-2], (255,80,"tight",1.04), (115,198,27)))

    previews = []
    manifests = []
    for name, prod, front, back, fa, ba, logo, qrpos in variants:
        prev = render_variant(name, prod, front, back, fa, ba, logo, qrpos)
        previews.append((name, Image.open(prev).convert("RGB")))
        manifests.append(name + "\n" + "\n".join(f"{n:02d}. {i['id']} | {i.get('brand','')} | {i.get('title','')} | {tone(i)} | {src_path(i).relative_to(ROOT)}" for n, i in enumerate(prod, 1)))

    # Contact sheet of all five previews.
    tw, th = 760, round(760 * H / W)
    gap, label_h = 26, 44
    sheet = Image.new("RGB", (tw * 2 + gap * 3, (th + label_h) * 3 + gap * 4), (18,18,18))
    d = ImageDraw.Draw(sheet)
    f = font(2.9, bold=True, narrow=True)
    for idx, (name, im) in enumerate(previews):
        row, col = idx // 2, idx % 2
        x = gap + col * (tw + gap)
        y = gap + row * (th + label_h + gap)
        thumb = im.resize((tw, th), Image.Resampling.LANCZOS)
        sheet.paste(thumb, (x, y))
        d.text((x, y + th + 8), name, font=f, fill=(245,245,242))
    sheet.save(OUT / "Disorder119_5_Originalartikel_Entwuerfe_Uebersicht.png", optimize=True)
    (OUT / "verwendete_originalartikel.txt").write_text("\n\n".join(manifests), encoding="utf-8")
    print("Built 5 coordinated full-cover variants using only current original shop images; spine black; QR on back only; no product recoloring.")


if __name__ == "__main__":
    main()

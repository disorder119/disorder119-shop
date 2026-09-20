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
OUT = ROOT / "out_notebook_original_v6"
OUT.mkdir(exist_ok=True)

DPI = 300
MM_PER_INCH = 25.4
W_MM, H_MM = 344.5, 245.0
W = round(W_MM / MM_PER_INCH * DPI)
H = round(H_MM / MM_PER_INCH * DPI)

# Exact user-supplied hardcover spread:
# 15 mm wrap | 152 mm back | 10.5 mm spine | 152 mm front | 15 mm wrap
BACK_L, BACK_R = 15.0, 167.0
SPINE_L, SPINE_R = 167.0, 177.5
FRONT_L, FRONT_R = 177.5, 329.5

BLACK = (0, 0, 0, 255)
WHITE = (246, 246, 242, 255)

CANDIDATE_IDS = [
    6241,6240,6239,6238,6237,6236,6235,6234,6233,6232,6231,6230,6229,6228,6227,
    6226,6225,6224,6223,6222,6221,6220,6219,6218,6217,6216,6215,6214,6213,6212,
    6211,6210,6209,6208,6207,6206,6205,6204,6203,6202,6201,6200,6199,6198,6197,
    6196,6195,6194,6193,6192,6191,6190,6189,6188,6187,6186,6185,6184,6183,6182,
    6042,9523,9526,9525,9519,9531,9536,9527,9535,9534,9524,9533,9522,9521,9520,
    9518,9532,9517,9516,9515,9514,9513,9538,9512,9511,9530,9529,9510,9509,9508,
    9528,9507,9500,9479,9476,9475,9442,9432,9404,9401,9400,9378,9365,9362,9359,
]


def mm(v: float) -> int:
    return round(v / MM_PER_INCH * DPI)


def pick_font(size_mm: float, bold=True, narrow=True):
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


def available(item):
    return item.get("public_status") == "AVAILABLE" or str(item.get("status", "")).lower() in {"verfügbar", "available"}


def src_path(item):
    p = item.get("look") or ((item.get("gallery") or [None])[0])
    if not p:
        return None
    path = ROOT / p
    return path if path.exists() else None


def product_pool(items):
    by_id = {int(i["id"]): i for i in items if "id" in i}
    out, seen = [], set()
    for pid in CANDIDATE_IDS:
        i = by_id.get(pid)
        if i and available(i) and src_path(i):
            out.append(i)
            seen.add(pid)
    for i in items:
        pid = int(i.get("id", -1))
        if pid not in seen and available(i) and src_path(i):
            out.append(i)
    return out


@lru_cache(maxsize=512)
def tone_for_path(path_str: str):
    im = Image.open(path_str).convert("RGB")
    im.thumbnail((110, 110), Image.Resampling.LANCZOS)
    pts = []
    for r, g, b in im.getdata():
        if max(r, g, b) < 30:
            continue
        pts.append((r, g, b))
    if not pts:
        return "dark"
    r = sum(p[0] for p in pts) / len(pts) / 255
    g = sum(p[1] for p in pts) / len(pts) / 255
    b = sum(p[2] for p in pts) / len(pts) / 255
    h, s, v = colorsys.rgb_to_hsv(r, g, b)
    if v < 0.38:
        return "dark"
    if s < 0.15 and v > 0.68:
        return "light"
    if s < 0.21:
        return "neutral"
    if 0.05 <= h <= 0.16:
        return "earth"
    if 0.16 < h <= 0.44:
        return "olive"
    if h < 0.05 or h > 0.94:
        return "warm"
    return "neutral"


def tone(item):
    return tone_for_path(str(src_path(item)))


def choose_palette(pool, quotas, total, seed):
    rng = random.Random(seed)
    chosen, used_ids, used_brands, used_cats = [], set(), set(), set()

    def score(item, wanted):
        brand = item.get("brand") or ""
        cat = item.get("taxonomy_category") or item.get("category") or ""
        return (
            10 * (tone(item) == wanted)
            + 3 * (brand not in used_brands)
            + 2 * (cat not in used_cats)
            + rng.random()
        )

    for wanted, count in quotas:
        options = [i for i in pool if int(i.get("id", -1)) not in used_ids]
        options.sort(key=lambda i: score(i, wanted), reverse=True)
        for i in options[:count]:
            chosen.append(i)
            used_ids.add(int(i["id"]))
            used_brands.add(i.get("brand") or "")
            used_cats.add(i.get("taxonomy_category") or i.get("category") or "")

    if len(chosen) < total:
        rest = [i for i in pool if int(i.get("id", -1)) not in used_ids]
        rest.sort(key=lambda i: (i.get("brand") not in used_brands, i.get("taxonomy_category") not in used_cats), reverse=True)
        chosen.extend(rest[: total - len(chosen)])
    return chosen[:total]


@lru_cache(maxsize=256)
def cutout(path_str: str) -> Image.Image:
    """Remove only connected near-black studio background. Product RGB values remain unchanged."""
    im = ImageOps.exif_transpose(Image.open(path_str)).convert("RGBA")
    rgb = im.convert("RGB")
    w, h = rgb.size
    pix = rgb.load()
    seen = bytearray(w * h)
    q = deque()

    def is_bg(x, y):
        r, g, b = pix[x, y]
        mx, mn = max(r, g, b), min(r, g, b)
        return mx <= 24 and (mx - mn) <= 15

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
        row = y * w
        for x in range(w):
            if seen[row + x]:
                r, g, b, _ = rgba[x, y]
                rgba[x, y] = (r, g, b, 0)
    bb = im.getbbox()
    return im.crop(bb) if bb else im


def place(base, item, box, angle=0):
    x, y, bw, bh = [mm(v) for v in box]
    im = cutout(str(src_path(item))).copy()
    scale = min(bw / im.width, bh / im.height)
    im = im.resize((max(1, round(im.width * scale)), max(1, round(im.height * scale))), Image.Resampling.LANCZOS)
    if angle:
        im = im.rotate(angle, expand=True, resample=Image.Resampling.BICUBIC)
    base.alpha_composite(im, (x + (bw - im.width) // 2, y + (bh - im.height) // 2))


def qr_img(size_mm=27):
    qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_H, box_size=12, border=4)
    qr.add_data("https://disorder119.com/")
    qr.make(fit=True)
    q = qr.make_image(fill_color="black", back_color="white").convert("RGBA")
    s = mm(size_mm)
    return q.resize((s, s), Image.Resampling.NEAREST)


def draw_back_qr(base, cx_mm=91, y_mm=196, size_mm=27):
    q = qr_img(size_mm)
    x = mm(cx_mm - size_mm / 2)
    y = mm(y_mm)
    base.alpha_composite(q, (x, y))
    d = ImageDraw.Draw(base)
    f = pick_font(2.4, True, True)
    text = "DISORDER119.COM"
    bb = d.textbbox((0, 0), text, font=f)
    d.text((mm(cx_mm) - (bb[2]-bb[0]) / 2, mm(y_mm + size_mm + 3.2)), text, font=f, fill=WHITE)


def render_word(base, text, target_w_mm, height_mm, x_mm, y_mm):
    """Render a bold condensed word and geometrically fit it to a precise width."""
    f = pick_font(height_mm * 0.95, True, True)
    bb = f.getbbox(text)
    pad = mm(2)
    layer = Image.new("RGBA", (max(1, bb[2]-bb[0] + pad*2), max(1, bb[3]-bb[1] + pad*2)), (0,0,0,0))
    d = ImageDraw.Draw(layer)
    d.text((pad - bb[0], pad - bb[1]), text, font=f, fill=WHITE)
    crop = layer.getbbox()
    layer = layer.crop(crop) if crop else layer
    target_w = mm(target_w_mm)
    target_h = mm(height_mm)
    layer = layer.resize((target_w, target_h), Image.Resampling.LANCZOS)
    base.alpha_composite(layer, (mm(x_mm), mm(y_mm)))


def logo_editorial(base, x_mm=219, y_mm=69, scale=1.0):
    # Stronger than prior versions: aligned left edge, tuned widths, almost no dead leading.
    render_word(base, "DIS",   43*scale, 20*scale, x_mm, y_mm)
    render_word(base, "ORDER", 71*scale, 20*scale, x_mm, y_mm + 23*scale)
    render_word(base, "119",   49*scale, 22*scale, x_mm, y_mm + 46*scale)


def logo_centered(base, cx_mm=255, y_mm=72, scale=1.0):
    specs = [("DIS",43,20,0),("ORDER",71,20,23),("119",49,22,46)]
    for text,w,h,dy in specs:
        render_word(base, text, w*scale, h*scale, cx_mm - (w*scale)/2, y_mm + dy*scale)


def canvas():
    # Entire spread black. Spine remains completely empty and black.
    return Image.new("RGBA", (W, H), BLACK)


def build_variant(name, products, front_boxes, back_boxes, logo_fn, qrpos, front_angles=None, back_angles=None):
    base = canvas()
    front_angles = front_angles or [0] * len(front_boxes)
    back_angles = back_angles or [0] * len(back_boxes)
    nf = len(front_boxes)
    for item, box, ang in zip(products[:nf], front_boxes, front_angles):
        place(base, item, box, ang)
    for item, box, ang in zip(products[nf:nf+len(back_boxes)], back_boxes, back_angles):
        place(base, item, box, ang)
    logo_fn(base)
    draw_back_qr(base, *qrpos)

    rgb = base.convert("RGB")
    full = OUT / f"Disorder119_{name}_344.5x245mm_300dpi.png"
    prev = OUT / f"Disorder119_{name}_preview.png"
    rgb.save(full, dpi=(DPI,DPI), optimize=True)
    rgb.resize((1600, round(1600*H/W)), Image.Resampling.LANCZOS).save(prev, optimize=True)
    return prev


def main():
    pool = product_pool(load_items())
    if len(pool) < 40:
        raise RuntimeError(f"Only {len(pool)} usable shop products found")

    outputs = []

    # 1) EDITORIAL BLACK — most premium, restrained, mostly black/cream.
    p = choose_palette(pool, [("dark",9),("light",4),("neutral",3),("earth",2)], 18, 22061)
    front = [
        (181,9,37,61), (294,12,34,54),
        (181,157,39,62), (297,161,33,58),
        (225,9,28,43), (272,12,26,41),
        (183,91,28,44), (301,92,27,43),
    ]
    back = [
        (10,12,31,48), (51,9,30,47), (92,13,29,44), (132,10,28,48),
        (13,72,30,47), (55,69,29,46), (96,72,30,46), (134,70,27,46),
        (20,134,33,49), (67,128,31,51),
    ]
    outputs.append(build_variant(
        "V6A_EDITORIAL_BLACK", p, front, back,
        lambda b: logo_editorial(b, 220, 77, 0.96), (91,194,26),
        [-2,2,2,-2,1,-1,2,-2], [-2,1,-1,2,1,-2,2,-1,-2,2]
    ))

    # 2) OLIVE / CREAM — same sophistication, warmer and better coordinated.
    p = choose_palette(pool, [("dark",7),("olive",4),("earth",3),("light",4)], 18, 22062)
    front = [
        (182,8,38,62), (294,9,35,57),
        (181,158,39,60), (295,158,35,61),
        (224,10,29,45), (271,10,27,44),
        (182,92,29,44), (302,91,27,44),
    ]
    back = [
        (8,10,31,49), (48,12,30,46), (88,8,31,50), (132,11,28,47),
        (11,72,30,47), (51,69,30,49), (91,74,31,45), (134,70,27,47),
        (24,132,34,50), (75,130,34,50),
    ]
    outputs.append(build_variant(
        "V6B_OLIVE_CREAM", p, front, back,
        lambda b: logo_editorial(b, 219, 77, 0.98), (90,194,26),
        [-2,2,1,-2,0,-1,2,-1], [-2,1,-2,2,1,-1,2,-1,-2,2]
    ))

    # 3) GALLERY — fewer, larger pieces; strongest luxury-gift feel.
    p = choose_palette(pool, [("dark",8),("light",4),("neutral",2),("earth",2)], 16, 22063)
    front = [
        (179,5,42,70), (292,8,39,64),
        (180,158,42,67), (294,160,38,65),
        (181,91,29,46), (303,91,28,45),
        (270,15,27,43),
    ]
    back = [
        (12,12,36,56), (60,8,34,54), (108,14,34,50),
        (16,82,35,54), (65,78,34,55), (114,82,33,52),
        (30,147,37,52), (91,143,37,55), (135,149,27,46),
    ]
    outputs.append(build_variant(
        "V6C_GALLERY", p, front, back,
        lambda b: logo_centered(b, 255, 77, 0.98), (90,194,26),
        [-2,2,2,-2,1,-1,1], [-2,1,-1,2,-2,2,-1,2,-1]
    ))

    # 4) ONE ACCENT — nearly monochrome with a controlled color accent.
    p = choose_palette(pool, [("dark",10),("light",3),("earth",2),("olive",3)], 18, 22064)
    front = [
        (182,8,38,62), (294,10,34,56),
        (181,158,39,61), (296,160,34,59),
        (225,10,28,43), (270,11,27,42),
        (183,92,28,44), (302,91,27,44),
    ]
    back = [
        (10,10,31,49), (49,9,30,48), (90,10,30,48), (132,10,28,48),
        (12,72,31,48), (51,72,30,47), (92,71,30,48), (134,73,27,45),
        (29,133,35,50), (87,130,35,52),
    ]
    outputs.append(build_variant(
        "V6D_ONE_ACCENT", p, front, back,
        lambda b: logo_centered(b, 255, 77, 1.0), (91,194,26),
        [-2,2,2,-2,0,-1,2,-2], [-2,1,-1,2,1,-2,2,-1,-2,2]
    ))

    # Contact sheet
    thumb_w = 800
    thumb_h = round(thumb_w * H / W)
    gap, label_h = 28, 42
    sheet = Image.new("RGB", (thumb_w*2 + gap*3, (thumb_h+label_h)*2 + gap*3), (20,20,20))
    d = ImageDraw.Draw(sheet)
    lf = pick_font(3.0, True, True)
    names = ["V6A EDITORIAL BLACK", "V6B OLIVE CREAM", "V6C GALLERY", "V6D ONE ACCENT"]
    for idx, (name, path) in enumerate(zip(names, outputs)):
        im = Image.open(path).convert("RGB").resize((thumb_w, thumb_h), Image.Resampling.LANCZOS)
        r, c = divmod(idx, 2)
        x = gap + c*(thumb_w+gap)
        y = gap + r*(thumb_h+label_h+gap)
        sheet.paste(im, (x,y))
        d.text((x, y+thumb_h+9), name, font=lf, fill=(245,245,242))
    sheet.save(OUT / "Disorder119_V6_4_Entwuerfe_Uebersicht.png", optimize=True)

    manifest = []
    for n, i in enumerate(p, 1):
        manifest.append(f"{n:02d}. {i['id']} | {i.get('brand','')} | {i.get('title','')} | {src_path(i).relative_to(ROOT)}")
    (OUT / "hinweis.txt").write_text(
        "All clothing/product imagery comes directly from current repository catalogue files. "
        "No hue, saturation, brightness or recoloring filter is applied. Only connected near-black studio background pixels are removed. "
        "Spine is pure black and empty. QR points to https://disorder119.com/.\n\n" + "\n".join(manifest),
        encoding="utf-8",
    )
    print("Built 4 refined notebook cover variants from current original shop images.")


if __name__ == "__main__":
    main()

from __future__ import annotations

import json
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps, ImageFilter
import qrcode
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "out"
OUT.mkdir(exist_ok=True)

DPI = 300
MM_PER_INCH = 25.4
W_MM, H_MM = 344.5, 245.0
W = round(W_MM / MM_PER_INCH * DPI)
H = round(H_MM / MM_PER_INCH * DPI)


def mm(v: float) -> int:
    return round(v / MM_PER_INCH * DPI)


# Flyeralarm-Hardcover-Datenformat from the supplied template:
# 15 mm wrap/bleed + 152 mm back + 10.5 mm spine + 152 mm front + 15 mm wrap/bleed.
BACK_L = 15.0
BACK_R = 167.0
SPINE_L = 167.0
SPINE_R = 177.5
FRONT_L = 177.5
FRONT_R = 329.5

# Explicitly selected, real catalogue products. The script validates that they exist
# in data/items.json and are currently available. Missing/unavailable entries are
# replaced automatically with other available catalogue items.
PREFERRED_IDS = [
    6241, 6240, 6239, 6237, 6236, 6235,
    6218, 6217, 6215, 6214, 6213, 6211,
    6210, 6209, 6208, 6205, 6204, 6203,
    9476, 9479, 9378, 9442, 9362, 9404,
]
COUNT = 24


def load_items():
    return json.loads((ROOT / "data/items.json").read_text(encoding="utf-8"))


def is_available(item):
    return item.get("public_status") == "AVAILABLE" or str(item.get("status", "")).lower() in {"verfügbar", "available"}


def image_path(item):
    p = item.get("look")
    if not p:
        gallery = item.get("gallery") or []
        p = gallery[0] if gallery else None
    if not p:
        return None
    src = ROOT / p
    # Prefer generated display asset when present; otherwise use the original source photo.
    if src.exists():
        display = src.parent / "display" / src.name
        if display.exists():
            return display
        return src
    return None


def choose_products(items):
    by_id = {int(i["id"]): i for i in items if "id" in i}
    chosen = []
    seen = set()
    for pid in PREFERRED_IDS:
        i = by_id.get(pid)
        if i and is_available(i) and image_path(i):
            chosen.append(i)
            seen.add(pid)
    # Diverse fallback: rotate brands/categories rather than simply taking first N.
    pool = [i for i in items if is_available(i) and image_path(i) and int(i.get("id", -1)) not in seen]
    def novelty(i):
        used_brands = {x.get("brand") for x in chosen}
        used_cats = {x.get("taxonomy_category") or x.get("category") for x in chosen}
        return (
            (i.get("brand") not in used_brands) * 2
            + ((i.get("taxonomy_category") or i.get("category")) not in used_cats) * 3,
            int(i.get("id", 0)),
        )
    while len(chosen) < COUNT and pool:
        pool.sort(key=novelty, reverse=True)
        i = pool.pop(0)
        chosen.append(i)
    return chosen[:COUNT]


def font(bold=False, size_mm=4.0):
    candidates = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSansCondensed-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSansCondensed.ttf",
        "/usr/share/fonts/truetype/liberation2/LiberationSansNarrow-Bold.ttf" if bold else "/usr/share/fonts/truetype/liberation2/LiberationSansNarrow-Regular.ttf",
    ]
    for p in candidates:
        if Path(p).exists():
            return ImageFont.truetype(p, mm(size_mm))
    return ImageFont.load_default()


def crop_product(path: Path):
    im = Image.open(path)
    im = ImageOps.exif_transpose(im).convert("RGBA")
    rgb = im.convert("RGB")
    # Most shop photos are on black. Build a permissive content mask that keeps dark garments.
    r, g, b = rgb.split()
    mx = Image.new("L", rgb.size)
    # max(R,G,B), then threshold very close to black.
    import PIL.ImageChops as IC
    mx = IC.lighter(IC.lighter(r, g), b)
    mask = mx.point(lambda p: 255 if p > 5 else 0)
    # Close small holes so black garments remain a single visual object.
    mask = mask.filter(ImageFilter.MaxFilter(9))
    bbox = mask.getbbox()
    if bbox:
        x0, y0, x1, y1 = bbox
        pad_x = max(8, int((x1 - x0) * 0.035))
        pad_y = max(8, int((y1 - y0) * 0.035))
        x0 = max(0, x0 - pad_x); y0 = max(0, y0 - pad_y)
        x1 = min(im.width, x1 + pad_x); y1 = min(im.height, y1 + pad_y)
        im = im.crop((x0, y0, x1, y1))
    return im


def fit(im, w, h):
    scale = min(w / im.width, h / im.height)
    size = (max(1, round(im.width * scale)), max(1, round(im.height * scale)))
    return im.resize(size, Image.Resampling.LANCZOS)


def place(base, item, box_mm, angle=0, opacity=255):
    x, y, bw, bh = [mm(v) for v in box_mm]
    im = crop_product(image_path(item))
    im = fit(im, bw, bh)
    if opacity != 255:
        a = im.getchannel("A").point(lambda p: int(p * opacity / 255))
        im.putalpha(a)
    if angle:
        im = im.rotate(angle, resample=Image.Resampling.BICUBIC, expand=True)
    px = x + (bw - im.width) // 2
    py = y + (bh - im.height) // 2
    base.alpha_composite(im, (px, py))


def draw_centered(draw, text, cx, y, f, fill="white", tracking=False):
    if tracking:
        text = " ".join(text)
    b = draw.textbbox((0, 0), text, font=f)
    draw.text((cx - (b[2]-b[0])/2, y), text, font=f, fill=fill)


def build():
    items = load_items()
    products = choose_products(items)
    if len(products) < COUNT:
        raise RuntimeError(f"Only {len(products)} suitable available catalogue products found; expected {COUNT}.")

    print("Selected actual shop products:")
    for n, i in enumerate(products, 1):
        print(f"{n:02d}. {i['id']} | {i.get('brand','')} | {i.get('title','')} | {image_path(i).relative_to(ROOT)}")

    base = Image.new("RGBA", (W, H), (0, 0, 0, 255))
    d = ImageDraw.Draw(base)

    # Very subtle cover/spine structure; no template guides are printed.
    d.rectangle((mm(SPINE_L), 0, mm(SPINE_R), H), fill=(0, 0, 0, 255))
    d.line((mm(SPINE_L), 0, mm(SPINE_L), H), fill=(28, 28, 28, 255), width=1)
    d.line((mm(SPINE_R), 0, mm(SPINE_R), H), fill=(28, 28, 28, 255), width=1)

    # 12 real products on back cover. Coordinates are in the printer's full spread.
    back_boxes = [
        (19, 18, 35, 52), (55, 12, 31, 51), (88, 18, 34, 42), (124, 13, 34, 53),
        (20, 72, 35, 49), (58, 66, 34, 53), (98, 66, 27, 49), (128, 68, 31, 53),
        (20, 131, 34, 50), (55, 128, 32, 54), (116, 129, 42, 50), (113, 184, 45, 42),
    ]
    back_angles = [-3, 2, -2, 3, 2, -2, 3, -2, -3, 2, -1, 2]
    for i, box, ang in zip(products[:12], back_boxes, back_angles):
        place(base, i, box, ang)

    # 12 real products on front cover, framing but not covering the title block.
    front_boxes = [
        (182, 13, 35, 52), (218, 12, 31, 46), (252, 14, 31, 44), (291, 14, 34, 53),
        (183, 71, 29, 54), (296, 70, 29, 53),
        (182, 133, 34, 54), (296, 132, 29, 55),
        (183, 190, 39, 41), (224, 192, 31, 37), (261, 191, 29, 39), (295, 189, 31, 43),
    ]
    front_angles = [2, -2, 3, -3, -2, 3, 2, -2, -2, 2, -2, 2]
    for i, box, ang in zip(products[12:], front_boxes, front_angles):
        place(base, i, box, ang)

    # Front cover title — deliberately simple, hard, fashion-editorial.
    d = ImageDraw.Draw(base)
    title_f = font(True, 20.0)
    title2_f = font(True, 19.0)
    small_f = font(False, 3.2)
    tiny_bold = font(True, 2.4)
    tiny = font(False, 2.3)
    front_cx = mm((FRONT_L + FRONT_R) / 2)

    # Knockout black title field to guarantee legibility over photography.
    d.rectangle((mm(215), mm(57), mm(295), mm(187)), fill=(0, 0, 0, 245))
    draw_centered(d, "DIS", front_cx, mm(64), title_f)
    draw_centered(d, "ORDER", front_cx, mm(91), title2_f)
    draw_centered(d, "119", front_cx, mm(119), title_f)
    draw_centered(d, "ARCHIVE NOTES", front_cx, mm(151), font(False, 4.0), tracking=True)
    draw_centered(d, "CURATED FASHION NOTEBOOK", front_cx, mm(160), small_f, fill=(205,205,205,255), tracking=True)
    draw_centered(d, "DISORDER119.COM", front_cx, mm(177), tiny_bold, fill=(225,225,225,255), tracking=True)

    # Back cover editorial copy and QR. Keep it in an uncluttered black field.
    qr_field = (mm(67), mm(180), mm(110), mm(235))
    d.rectangle(qr_field, fill=(0, 0, 0, 255))
    back_cx = mm(88.5)
    draw_centered(d, "FROM THE CURATED ARCHIVE", back_cx, mm(184), tiny_bold, tracking=True)
    draw_centered(d, "OF DISORDER119", back_cx, mm(189), tiny_bold, tracking=True)

    qr = qrcode.QRCode(version=None, error_correction=qrcode.constants.ERROR_CORRECT_H, box_size=12, border=4)
    qr.add_data("https://disorder119.com/")
    qr.make(fit=True)
    qri = qr.make_image(fill_color="black", back_color="white").convert("RGB")
    qrs = mm(28)
    qri = qri.resize((qrs, qrs), Image.Resampling.NEAREST).convert("RGBA")
    qrx = back_cx - qrs // 2
    qry = mm(196)
    base.alpha_composite(qri, (qrx, qry))
    draw_centered(d, "DISORDER119.COM", back_cx, mm(226.5), tiny_bold, tracking=True)
    draw_centered(d, "DESIGNER · VINTAGE · CONTEMPORARY", back_cx, mm(231.5), tiny, fill=(205,205,205,255), tracking=True)

    # Spine typography, rotated 90° so it reads bottom-to-top on the printed spine.
    spine_w = mm(SPINE_R - SPINE_L)
    strip = Image.new("RGBA", (mm(114), spine_w), (0,0,0,0))
    sd = ImageDraw.Draw(strip)
    sf = font(True, 3.8)
    ss = font(False, 1.8)
    t = "DISORDER119"
    b = sd.textbbox((0,0), t, font=sf)
    sd.text(((strip.width-(b[2]-b[0]))/2, mm(0.7)), t, font=sf, fill="white")
    t2 = "ARCHIVE NOTES"
    b2 = sd.textbbox((0,0), t2, font=ss)
    sd.text(((strip.width-(b2[2]-b2[0]))/2, mm(5.1)), t2, font=ss, fill=(210,210,210,255))
    strip = strip.rotate(90, expand=True, resample=Image.Resampling.BICUBIC)
    sx = mm(SPINE_L) + (spine_w-strip.width)//2
    sy = (H-strip.height)//2
    base.alpha_composite(strip, (sx, sy))

    # Output
    rgb = base.convert("RGB")
    png = OUT / "Disorder119_A5_Hardcover_Originalprodukte_344.5x245mm_300dpi.png"
    pdf = OUT / "Disorder119_A5_Hardcover_Originalprodukte_344.5x245mm_Print.pdf"
    preview = OUT / "Disorder119_A5_Hardcover_Originalprodukte_preview.png"
    manifest = OUT / "Disorder119_A5_Hardcover_Originalprodukte_manifest.txt"

    rgb.save(png, dpi=(DPI, DPI), optimize=True)
    rgb.resize((round(W*0.25), round(H*0.25)), Image.Resampling.LANCZOS).save(preview, optimize=True)

    pt_per_mm = 72.0 / 25.4
    c = canvas.Canvas(str(pdf), pagesize=(W_MM*pt_per_mm, H_MM*pt_per_mm))
    c.drawImage(ImageReader(rgb), 0, 0, width=W_MM*pt_per_mm, height=H_MM*pt_per_mm, preserveAspectRatio=False)
    c.showPage(); c.save()

    manifest.write_text(
        "DISORDER119 A5 hardcover cover — actual catalogue products only\n"
        + "Source: disorder119/disorder119-shop main-derived branch\n"
        + "Website / QR: https://disorder119.com/\n\n"
        + "\n".join(f"{n:02d}. id {i['id']} — {i.get('brand','')} — {i.get('title','')} — {image_path(i).relative_to(ROOT)}" for n,i in enumerate(products,1)),
        encoding="utf-8",
    )
    print(f"Built {png} ({W}x{H}px @ {DPI} ppi)")
    print(f"Built {pdf} ({W_MM}x{H_MM}mm)")


if __name__ == "__main__":
    build()

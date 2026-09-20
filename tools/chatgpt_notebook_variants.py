from __future__ import annotations

import json
import math
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps, ImageFilter
import qrcode
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "out_notebook_variants"
OUT.mkdir(exist_ok=True)

DPI = 300
MM_PER_INCH = 25.4
W_MM, H_MM = 344.5, 245.0
W = round(W_MM / MM_PER_INCH * DPI)
H = round(H_MM / MM_PER_INCH * DPI)

# Printer template supplied by the user:
# 15 mm wrap/bleed | 152 mm back | 10.5 mm spine | 152 mm front | 15 mm wrap/bleed
BACK_L, BACK_R = 15.0, 167.0
SPINE_L, SPINE_R = 167.0, 177.5
FRONT_L, FRONT_R = 177.5, 329.5

# Existing website palette / visual system from assets/app.css.
INK = (0, 0, 0, 255)
PAPER = (242, 239, 231, 255)       # --paper
ACCENT = (143, 137, 124, 255)      # --accent
MUTED = (242, 239, 231, 184)
FAINT = (242, 239, 231, 112)
RULE = (242, 239, 231, 44)
RULE_STRONG = (242, 239, 231, 78)

# ONLY copy that is visibly present on the current website is allowed below.
SITE_KICKER = "Das kuratierte Archiv von"
SITE_EYEBROW = "Designer-, Vintage- und Contemporary-Pieces mit Fokus auf Qualität, Authentizität und Zeitlosigkeit"
SITE_BRAND_LINE = "Prada · Dior · Saint Laurent · Jean Paul Gaultier · Y-3 · u.v.m."
SITE_WORDMARK = "DISORDER119"
SITE_ARCHIVE = "Archiv"
SITE_AVAILABLE = "Verfügbar"
SITE_OBJECTS = "Objekte im Archiv"
SITE_BRANDS = "Marken"
DOMAIN = "disorder119.com"  # specifically requested by the user for the gift notebook

PREFERRED_IDS = [
    6241, 6240, 6239, 6235, 6218, 6217, 6215,
    6210, 6209, 6208, 6207, 6205, 6204, 6203,
    9479, 9378, 9442, 9362, 9476, 9475, 9480,
    9463, 9456, 9432, 9404, 9401, 9400, 9365,
]
COUNT = 28


def mm(v: float) -> int:
    return round(v / MM_PER_INCH * DPI)


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
    if not src.exists():
        return None
    display = src.parent / "display" / src.name
    if display.exists():
        return display
    return src


def select_products(items):
    by_id = {int(i["id"]): i for i in items if "id" in i}
    chosen = []
    seen = set()
    for pid in PREFERRED_IDS:
        item = by_id.get(pid)
        if item and is_available(item) and image_path(item):
            chosen.append(item)
            seen.add(pid)

    pool = [i for i in items if is_available(i) and image_path(i) and int(i.get("id", -1)) not in seen]
    while len(chosen) < COUNT and pool:
        used_brands = {x.get("brand") for x in chosen}
        used_cats = {x.get("taxonomy_category") or x.get("category") for x in chosen}
        pool.sort(
            key=lambda i: (
                4 * (i.get("brand") not in used_brands)
                + 3 * ((i.get("taxonomy_category") or i.get("category")) not in used_cats)
                + min(float(i.get("price") or 0), 900) / 900,
                int(i.get("id", 0)),
            ),
            reverse=True,
        )
        chosen.append(pool.pop(0))
    if len(chosen) < COUNT:
        raise RuntimeError(f"Only {len(chosen)} suitable products available; expected {COUNT}")
    return chosen[:COUNT]


def font(size_mm=4.0, bold=False, narrow=False):
    cands = []
    if narrow and bold:
        cands += [
            "/usr/share/fonts/truetype/liberation2/LiberationSansNarrow-Bold.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSansCondensed-Bold.ttf",
        ]
    elif narrow:
        cands += [
            "/usr/share/fonts/truetype/liberation2/LiberationSansNarrow-Regular.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSansCondensed.ttf",
        ]
    elif bold:
        cands += [
            "/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        ]
    else:
        cands += [
            "/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        ]
    for p in cands:
        if Path(p).exists():
            return ImageFont.truetype(p, mm(size_mm))
    return ImageFont.load_default()


def load_photo(item):
    im = Image.open(image_path(item))
    return ImageOps.exif_transpose(im).convert("RGBA")


def fit_contain(im, w, h):
    scale = min(w / im.width, h / im.height)
    return im.resize((max(1, round(im.width * scale)), max(1, round(im.height * scale))), Image.Resampling.LANCZOS)


def place_photo(base, item, box, angle=0, alpha=255, crop=False):
    x, y, bw, bh = [mm(v) for v in box]
    im = load_photo(item)
    if crop:
        # Keep the central product while making the card more graphic.
        target = bw / bh
        current = im.width / im.height
        if current > target:
            new_w = round(im.height * target)
            l = max(0, (im.width - new_w) // 2)
            im = im.crop((l, 0, l + new_w, im.height))
        else:
            new_h = round(im.width / target)
            t = max(0, (im.height - new_h) // 2)
            im = im.crop((0, t, im.width, t + new_h))
        im = im.resize((bw, bh), Image.Resampling.LANCZOS)
    else:
        im = fit_contain(im, bw, bh)
    if alpha != 255:
        a = im.getchannel("A").point(lambda p: int(p * alpha / 255))
        im.putalpha(a)
    if angle:
        im = im.rotate(angle, resample=Image.Resampling.BICUBIC, expand=True)
    px = x + (bw - im.width) // 2
    py = y + (bh - im.height) // 2
    base.alpha_composite(im, (px, py))


def draw_spaced(draw, xy, text, f, fill=PAPER, spacing_px=0, anchor="la"):
    x, y = xy
    if spacing_px == 0:
        draw.text((x, y), text, font=f, fill=fill, anchor=anchor)
        return
    widths = [draw.textlength(c, font=f) for c in text]
    total = sum(widths) + spacing_px * max(0, len(text)-1)
    if anchor in {"ma", "mm", "ms"}:
        x -= total / 2
    elif anchor in {"ra", "rm", "rs"}:
        x -= total
    for c, cw in zip(text, widths):
        draw.text((x, y), c, font=f, fill=fill, anchor="la")
        x += cw + spacing_px


def rotate_text(base, text, x_mm, y_mm, size_mm, angle, fill=PAPER, bold=True, narrow=True):
    f = font(size_mm, bold=bold, narrow=narrow)
    bbox = f.getbbox(text)
    pad = mm(2)
    layer = Image.new("RGBA", (bbox[2]-bbox[0] + pad*2, bbox[3]-bbox[1] + pad*2), (0,0,0,0))
    ld = ImageDraw.Draw(layer)
    ld.text((pad-bbox[0], pad-bbox[1]), text, font=f, fill=fill)
    layer = layer.rotate(angle, expand=True, resample=Image.Resampling.BICUBIC)
    base.alpha_composite(layer, (mm(x_mm), mm(y_mm)))


def euro(item):
    p = float(item.get("price") or 0)
    return f"{p:,.2f} €".replace(",", "X").replace(".", ",").replace("X", ".")


def product_label(base, item, x, y, w, rotate=0, invert=False):
    bg = PAPER if invert else INK
    fg = INK if invert else PAPER
    muted = (0,0,0,170) if invert else MUTED
    f_brand = font(2.0, bold=True)
    f_title = font(1.8)
    f_price = font(1.9, bold=True)
    h = mm(15)
    layer = Image.new("RGBA", (mm(w), h), bg)
    d = ImageDraw.Draw(layer)
    brand = str(item.get("brand") or "")[:34].upper()
    title = str(item.get("title") or "")[:50]
    d.text((mm(2), mm(1.5)), brand, font=f_brand, fill=fg)
    d.text((mm(2), mm(5.5)), title, font=f_title, fill=muted)
    d.text((mm(2), mm(10.3)), euro(item), font=f_price, fill=fg)
    if rotate:
        layer = layer.rotate(rotate, expand=True, resample=Image.Resampling.BICUBIC)
    base.alpha_composite(layer, (mm(x), mm(y)))


def draw_qr(base, x_mm, y_mm, size_mm=27):
    qr = qrcode.QRCode(version=None, error_correction=qrcode.constants.ERROR_CORRECT_H, box_size=12, border=4)
    qr.add_data("https://disorder119.com/")
    qr.make(fit=True)
    q = qr.make_image(fill_color="black", back_color="white").convert("RGBA")
    s = mm(size_mm)
    q = q.resize((s, s), Image.Resampling.NEAREST)
    base.alpha_composite(q, (mm(x_mm), mm(y_mm)))


def website_wordmark(base, x_mm, y_mm, size_mm=18, angle=0, fill=PAPER):
    # Mirrors website CSS: uppercase, narrow/condensed, 800 weight, tight spacing.
    rotate_text(base, SITE_WORDMARK, x_mm, y_mm, size_mm, angle, fill=fill, bold=True, narrow=True)


def spine(base):
    d = ImageDraw.Draw(base)
    d.rectangle((mm(SPINE_L), 0, mm(SPINE_R), H), fill=INK)
    f = font(3.5, bold=True, narrow=True)
    strip = Image.new("RGBA", (mm(100), mm(SPINE_R-SPINE_L)), (0,0,0,0))
    sd = ImageDraw.Draw(strip)
    b = sd.textbbox((0,0), SITE_WORDMARK, font=f)
    sd.text(((strip.width-(b[2]-b[0]))/2, mm(2.6)), SITE_WORDMARK, font=f, fill=PAPER)
    strip = strip.rotate(90, expand=True, resample=Image.Resampling.BICUBIC)
    sx = mm(SPINE_L) + (mm(SPINE_R-SPINE_L)-strip.width)//2
    sy = (H-strip.height)//2
    base.alpha_composite(strip, (sx, sy))


def back_qr_block(base, x=105, y=199):
    d = ImageDraw.Draw(base)
    d.rectangle((mm(x-5), mm(y-6), mm(x+36), mm(y+35)), fill=INK)
    draw_qr(base, x, y, 27)
    f = font(2.25, bold=True, narrow=True)
    draw_spaced(d, (mm(x+13.5), mm(y+29.8)), DOMAIN.upper(), f, fill=PAPER, spacing_px=0, anchor="ma")


def add_favicon(base, x_mm, y_mm, size_mm=10, invert=False):
    p = ROOT / "assets/favicon.png"
    if not p.exists():
        return
    im = Image.open(p).convert("RGBA")
    s = mm(size_mm)
    im.thumbnail((s, s), Image.Resampling.LANCZOS)
    base.alpha_composite(im, (mm(x_mm), mm(y_mm)))


def variant_1(products):
    # Universum / floating archive - closest to current site's Chaos/Universum language.
    base = Image.new("RGBA", (W, H), INK)
    d = ImageDraw.Draw(base)
    rng = random.Random(11901)

    # Bleeding objects, intentionally asymmetrical.
    back_boxes = [
        (5, 8, 38, 55),(40, 14, 31, 44),(76, 4, 35, 57),(118, 18, 41, 48),
        (19, 67, 34, 52),(62, 63, 39, 60),(113, 70, 49, 52),
        (4, 129, 38, 57),(49, 126, 31, 50),(87, 118, 39, 61),(130, 128, 36, 54),
        (15, 187, 42, 49),(60, 181, 38, 48),(124, 186, 42, 45),
    ]
    front_boxes = [
        (176, 3, 42, 59),(214, 17, 34, 51),(256, 5, 37, 55),(299, 19, 42, 52),
        (183, 72, 34, 55),(296, 64, 43, 58),
        (181, 132, 40, 56),(302, 130, 40, 58),
        (177, 188, 41, 50),(219, 190, 33, 45),(259, 183, 37, 54),(300, 186, 42, 49),
        (224, 68, 33, 38),(264, 145, 31, 40),
    ]
    for idx, box in enumerate(back_boxes + front_boxes):
        angle = rng.choice([-8,-6,-4,-2,0,2,4,6,8])
        place_photo(base, products[idx], box, angle=angle)

    # Strong wordmark block, but shifted left/right rather than centered.
    d.rectangle((mm(222), mm(69), mm(302), mm(173)), fill=(0,0,0,242))
    f_k = font(2.5, bold=True)
    draw_spaced(d, (mm(226), mm(75)), SITE_KICKER.upper(), f_k, fill=FAINT, spacing_px=mm(.12))
    website_wordmark(base, 222, 86, 16.5)
    # Site eyebrow broken into a narrow editorial block.
    f_eye = font(2.35)
    lines = [
        "DESIGNER-, VINTAGE- UND",
        "CONTEMPORARY-PIECES MIT FOKUS",
        "AUF QUALITÄT, AUTHENTIZITÄT",
        "UND ZEITLOSIGKEIT",
    ]
    for j, line in enumerate(lines):
        d.text((mm(226), mm(115 + j*5.2)), line, font=f_eye, fill=MUTED)
    d.line((mm(226), mm(139), mm(292), mm(139)), fill=RULE_STRONG, width=1)
    f_brand = font(2.1)
    d.text((mm(226), mm(144)), SITE_BRAND_LINE, font=f_brand, fill=FAINT)
    d.text((mm(226), mm(158)), DOMAIN.upper(), font=font(2.7, bold=True, narrow=True), fill=PAPER)

    # Small authentic site wordmark on the back.
    website_wordmark(base, 22, 166, 7.0, angle=-90, fill=ACCENT)
    back_qr_block(base, 84, 201)
    add_favicon(base, 23, 217, 10)
    spine(base)
    return base


def variant_2(products):
    # Fragmented typography + object collisions.
    base = Image.new("RGBA", (W, H), INK)
    d = ImageDraw.Draw(base)
    rng = random.Random(11902)

    # Giant repeated site wordmark, clipped by cover edges, exactly same text as site.
    rotate_text(base, SITE_WORDMARK, 181, 15, 23, -8, fill=(242,239,231,38), bold=True, narrow=True)
    rotate_text(base, SITE_WORDMARK, 205, 156, 17, 7, fill=(242,239,231,46), bold=True, narrow=True)
    rotate_text(base, SITE_WORDMARK, 9, 18, 15, -90, fill=(242,239,231,34), bold=True, narrow=True)

    boxes = [
        (12,10,39,48),(47,20,29,44),(81,7,33,55),(114,24,47,48),
        (22,70,37,54),(67,63,45,58),(119,76,44,51),
        (6,132,49,56),(50,126,34,55),(93,118,43,59),(130,135,35,51),
        (12,190,39,47),(60,181,43,52),(119,185,46,47),
        (178,9,43,56),(220,17,30,47),(254,8,36,56),(294,20,45,55),
        (182,72,37,54),(222,61,44,58),(292,70,46,55),
        (179,131,45,58),(229,126,34,53),(268,119,43,60),(304,139,38,52),
        (181,190,40,46),(239,183,40,52),(294,185,44,47),
    ]
    for idx, box in enumerate(boxes):
        angle = rng.choice([-11,-8,-5,-3,0,3,5,8,11])
        place_photo(base, products[idx], box, angle=angle)

    # Website copy on front, intentionally offset.
    d.rectangle((mm(209), mm(77), mm(303), mm(166)), fill=(0,0,0,238))
    d.text((mm(216), mm(83)), SITE_KICKER.upper(), font=font(2.35, bold=True), fill=FAINT)
    website_wordmark(base, 207, 94, 15.0, angle=-2)
    d.text((mm(218), mm(124)), SITE_AVAILABLE.upper(), font=font(2.2, bold=True), fill=ACCENT)
    d.text((mm(245), mm(124)), SITE_BRANDS.upper(), font=font(2.2, bold=True), fill=FAINT)
    d.text((mm(273), mm(124)), SITE_ARCHIVE.upper(), font=font(2.2, bold=True), fill=FAINT)
    d.line((mm(216), mm(134), mm(294), mm(134)), fill=RULE_STRONG, width=1)
    d.text((mm(216), mm(140)), SITE_BRAND_LINE, font=font(2.05), fill=MUTED)
    d.text((mm(216), mm(153)), DOMAIN.upper(), font=font(2.5, bold=True, narrow=True), fill=PAPER)

    # Actual product labels from website cards, no invented copy.
    product_label(base, products[0], 18, 92, 58, rotate=-4, invert=True)
    product_label(base, products[7], 97, 93, 58, rotate=3, invert=False)
    product_label(base, products[17], 188, 171, 62, rotate=-5, invert=True)
    product_label(base, products[23], 270, 176, 59, rotate=4, invert=False)

    back_qr_block(base, 84, 201)
    spine(base)
    return base


def variant_3(products):
    # Product-card language taken from the website, but broken into editorial strips.
    base = Image.new("RGBA", (W, H), INK)
    d = ImageDraw.Draw(base)
    rng = random.Random(11903)

    # Thin archive grid, then deliberately break it with larger floating products.
    for x in [15, 52, 89, 126, 177.5, 214, 251, 288, 329.5]:
        d.line((mm(x), 0, mm(x), H), fill=(242,239,231,22), width=1)
    for y in [20, 65, 110, 155, 200, 230]:
        d.line((0, mm(y), W, mm(y)), fill=(242,239,231,18), width=1)

    boxes = [
        (16,9,34,50),(53,17,33,46),(91,8,33,54),(126,22,38,48),
        (18,67,39,57),(63,62,36,54),(105,70,56,57),
        (7,128,50,63),(58,127,35,53),(96,119,39,61),(135,132,31,54),
        (17,190,44,42),(66,182,40,50),(119,184,46,46),
        (179,10,42,54),(221,20,29,44),(254,6,37,57),(294,19,43,52),
        (183,68,31,52),(217,61,37,59),(295,69,43,55),
        (181,132,36,53),(222,126,34,54),(260,120,37,58),(303,133,38,53),
        (181,189,38,47),(242,181,41,54),(298,185,42,48),
    ]
    for idx, box in enumerate(boxes):
        place_photo(base, products[idx], box, angle=rng.choice([-4,-2,0,2,4]))

    # Vertical website wordmark on front; exact site wordmark, not a newly invented logo.
    website_wordmark(base, 190, 52, 13.2, angle=90)

    # Website eyebrow in a hard horizontal strip, no extra slogan.
    d.rectangle((mm(225), mm(79), mm(325), mm(104)), fill=PAPER)
    f = font(2.15, bold=True)
    d.text((mm(229), mm(84)), "DESIGNER-, VINTAGE- UND CONTEMPORARY-PIECES", font=f, fill=INK)
    d.text((mm(229), mm(90)), "MIT FOKUS AUF QUALITÄT, AUTHENTIZITÄT", font=f, fill=INK)
    d.text((mm(229), mm(96)), "UND ZEITLOSIGKEIT", font=f, fill=INK)

    # Card-like actual visible information from products.
    label_specs = [
        (products[14], 229,112,62,-2,False),
        (products[15], 258,135,63,3,True),
        (products[16], 221,160,65,-3,False),
        (products[18], 260,185,62,2,True),
        (products[3], 20,91,62,3,False),
        (products[10], 89,101,62,-4,True),
    ]
    for item,x,y,w,a,inv in label_specs:
        product_label(base, item, x,y,w,rotate=a,invert=inv)

    d.text((mm(20), mm(214)), SITE_KICKER.upper(), font=font(2.2, bold=True), fill=FAINT)
    d.text((mm(20), mm(221)), SITE_WORDMARK, font=font(7.2, bold=True, narrow=True), fill=PAPER)
    d.text((mm(20), mm(234)), DOMAIN.upper(), font=font(2.2, bold=True, narrow=True), fill=ACCENT)
    back_qr_block(base, 128, 199)
    spine(base)
    return base


def variant_4(products):
    # Closest to the Spotify reference: central wordmark, products orbiting it,
    # but deliberately less symmetrical and more fashion-editorial.
    base = Image.new("RGBA", (W, H), INK)
    d = ImageDraw.Draw(base)
    rng = random.Random(11904)

    back_boxes = [
        (12,8,37,54),(47,22,32,45),(84,8,36,55),(124,19,40,49),
        (20,72,31,50),(61,65,39,58),(116,70,49,55),
        (6,133,43,58),(54,126,34,56),(99,121,38,62),(132,140,34,49),
        (17,190,42,45),(67,184,41,49),(121,184,44,47),
    ]
    front_boxes = [
        (179,8,39,54),(218,21,31,46),(254,9,35,53),(294,17,45,55),
        (182,74,30,51),(300,68,39,56),
        (179,132,36,55),(303,130,38,57),
        (181,191,42,43),(226,185,34,50),(263,190,32,44),(298,186,42,48),
        (216,66,29,38),(267,146,30,39),
    ]
    for idx, box in enumerate(back_boxes + front_boxes):
        place_photo(base, products[idx], box, angle=rng.choice([-7,-5,-3,0,2,4,6]))

    # Central front panel like the Spotify reference, but using the site's real wordmark/copy.
    d.rectangle((mm(216), mm(58), mm(300), mm(184)), fill=(0,0,0,248))
    d.text((mm(223), mm(67)), SITE_KICKER.upper(), font=font(2.1, bold=True), fill=FAINT)
    d.text((mm(222), mm(82)), SITE_WORDMARK, font=font(15.2, bold=True, narrow=True), fill=PAPER)
    d.line((mm(223), mm(110), mm(292), mm(110)), fill=RULE_STRONG, width=1)
    f_eye = font(2.15)
    d.text((mm(223), mm(117)), "DESIGNER-, VINTAGE- UND", font=f_eye, fill=MUTED)
    d.text((mm(223), mm(123)), "CONTEMPORARY-PIECES MIT FOKUS", font=f_eye, fill=MUTED)
    d.text((mm(223), mm(129)), "AUF QUALITÄT, AUTHENTIZITÄT", font=f_eye, fill=MUTED)
    d.text((mm(223), mm(135)), "UND ZEITLOSIGKEIT", font=f_eye, fill=MUTED)
    d.text((mm(223), mm(149)), SITE_BRAND_LINE, font=font(1.95), fill=FAINT)
    d.text((mm(223), mm(168)), DOMAIN.upper(), font=font(2.6, bold=True, narrow=True), fill=PAPER)

    # Back page: actual website-style card information scattered at the bottom.
    product_label(base, products[2], 16, 168, 59, rotate=-2, invert=False)
    product_label(base, products[5], 72, 173, 59, rotate=3, invert=True)
    back_qr_block(base, 128, 201)
    spine(base)
    return base


def save_variant(name, image):
    rgb = image.convert("RGB")
    png = OUT / f"{name}_344.5x245mm_300dpi.png"
    pdf = OUT / f"{name}_344.5x245mm_Print.pdf"
    preview = OUT / f"{name}_preview.png"
    rgb.save(png, dpi=(DPI, DPI), optimize=True)
    rgb.resize((round(W*0.27), round(H*0.27)), Image.Resampling.LANCZOS).save(preview, optimize=True)

    pt = 72.0 / 25.4
    c = canvas.Canvas(str(pdf), pagesize=(W_MM*pt, H_MM*pt))
    c.drawImage(ImageReader(rgb), 0, 0, width=W_MM*pt, height=H_MM*pt, preserveAspectRatio=False)
    c.showPage(); c.save()
    return preview


def contact_sheet(previews):
    ims = [Image.open(p).convert("RGB") for p in previews]
    pad = 36
    tw = max(i.width for i in ims)
    th = max(i.height for i in ims)
    sheet = Image.new("RGB", (tw*2 + pad*3, th*2 + pad*3), (20,20,20))
    for n, im in enumerate(ims):
        r, c = divmod(n, 2)
        x = pad + c*(tw+pad)
        y = pad + r*(th+pad)
        sheet.paste(im, (x, y))
    path = OUT / "Disorder119_A5_Notizbuch_4_Varianten_Uebersicht.png"
    sheet.save(path, optimize=True)
    return path


def main():
    items = load_items()
    products = select_products(items)

    print("Actual available products used (from data/items.json + assets/img):")
    for n, item in enumerate(products, 1):
        print(f"{n:02d}. {item['id']} | {item.get('brand','')} | {item.get('title','')} | {euro(item)} | {image_path(item).relative_to(ROOT)}")

    makers = [
        ("Disorder119_Notizbuch_V1_Universum", variant_1),
        ("Disorder119_Notizbuch_V2_Fragment", variant_2),
        ("Disorder119_Notizbuch_V3_Katalog", variant_3),
        ("Disorder119_Notizbuch_V4_Spotify", variant_4),
    ]
    previews = []
    for name, maker in makers:
        previews.append(save_variant(name, maker(products)))
        print("Built", name)

    contact_sheet(previews)
    (OUT / "verwendete_originalartikel.txt").write_text(
        "DISORDER119 notebook variants\n"
        "Source: disorder119/disorder119-shop\n"
        "Format: 344.5 x 245 mm, 300 ppi, 4069 x 2894 px\n"
        "Copy rule: only visible website copy/product card text + user-requested domain.\n"
        "Visual rule: existing site palette/wordmark treatment preserved.\n\n"
        + "\n".join(
            f"{n:02d}. {i['id']} | {i.get('brand','')} | {i.get('title','')} | {euro(i)} | {image_path(i).relative_to(ROOT)}"
            for n, i in enumerate(products, 1)
        ),
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()

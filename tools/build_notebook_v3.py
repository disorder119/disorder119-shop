from __future__ import annotations

import json
import math
import random
import re
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps, ImageFilter, ImageChops
import qrcode
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "out_notebook_v3"
OUT.mkdir(exist_ok=True)

DPI = 300
MM_PER_INCH = 25.4
W_MM, H_MM = 344.5, 245.0
W = round(W_MM / MM_PER_INCH * DPI)
H = round(H_MM / MM_PER_INCH * DPI)

# User-supplied print template:
# 15 mm bleed/wrap | 152 mm back | 10.5 mm spine | 152 mm front | 15 mm bleed/wrap
BACK_L, BACK_R = 15.0, 167.0
SPINE_L, SPINE_R = 167.0, 177.5
FRONT_L, FRONT_R = 177.5, 329.5

# Current website visual palette from assets/app.css
INK = (0, 0, 0, 255)
PAPER = (242, 239, 231, 255)
MUTED = (242, 239, 231, 175)
FAINT = (242, 239, 231, 105)
ACCENT = (143, 137, 124, 255)
RULE = (242, 239, 231, 42)
RULE_STRONG = (242, 239, 231, 74)

DOMAIN = "disorder119.com"
SITE_TEXTS = {
    "wordmark": "Disorder119",
    "kicker": "Das kuratierte Archiv von",
    "eyebrow": "Designer-, Vintage- und Contemporary-Pieces mit Fokus auf Qualität, Authentizität und Zeitlosigkeit",
    "brandline": "Prada · Dior · Saint Laurent · Jean Paul Gaultier · Y-3 · u.v.m.",
    "archive": "Archiv",
    "available": "Verfügbar",
    "objects": "Objekte im Archiv",
    "brands": "Marken",
    "rental": "Mieten & Ausleihen",
    "about": "Über Disorder119",
    "faq": "FAQ",
    "contact": "Kontakt",
}

# 30 actual catalogue products per design, selected for brand/category variety.
PREFERRED_IDS = [
    6241, 6240, 6239, 6238, 6237, 6236, 6235, 6234, 6233, 6232,
    6231, 6230, 6229, 6228, 6227, 6226, 6225, 6224, 6223, 6222,
    6221, 6220, 6219, 6218, 6217, 6216, 6215, 6214, 6213, 6212,
    9479, 9378, 9442, 9362, 9476, 9475, 9480, 9463, 9456, 9432,
    9404, 9401, 9400, 9365,
]
COUNT = 30


def mm(v: float) -> int:
    return round(v / MM_PER_INCH * DPI)


def assert_site_texts_exist():
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    missing = []
    for key, text in SITE_TEXTS.items():
        if text not in html:
            missing.append((key, text))
    if missing:
        raise RuntimeError(f"Website copy changed; refusing to invent/retain stale copy: {missing}")
    # The domain is present as canonical/OG URL in the current site and was explicitly requested by the user.
    if "https://disorder119.com/" not in html:
        raise RuntimeError("Current index.html no longer contains disorder119.com canonical URL")


def load_items():
    return json.loads((ROOT / "data/items.json").read_text(encoding="utf-8"))


def available(item):
    return item.get("public_status") == "AVAILABLE" or str(item.get("status", "")).lower() in {"verfügbar", "available"}


def image_path(item):
    p = item.get("look") or ((item.get("gallery") or [None])[0])
    if not p:
        return None
    src = ROOT / p
    if not src.exists():
        return None
    display = src.parent / "display" / src.name
    return display if display.exists() else src


def choose_products(items):
    by_id = {int(i["id"]): i for i in items if "id" in i}
    chosen, seen = [], set()
    for pid in PREFERRED_IDS:
        item = by_id.get(pid)
        if item and available(item) and image_path(item):
            chosen.append(item)
            seen.add(pid)
            if len(chosen) >= COUNT:
                break
    pool = [i for i in items if available(i) and image_path(i) and int(i.get("id", -1)) not in seen]
    while len(chosen) < COUNT and pool:
        brands = {x.get("brand") for x in chosen}
        cats = {x.get("taxonomy_category") or x.get("category") for x in chosen}
        pool.sort(key=lambda i: (
            5 * (i.get("brand") not in brands)
            + 3 * ((i.get("taxonomy_category") or i.get("category")) not in cats)
            + min(float(i.get("price") or 0), 1200) / 1200,
            int(i.get("id", 0)),
        ), reverse=True)
        chosen.append(pool.pop(0))
    if len(chosen) < COUNT:
        raise RuntimeError(f"Only {len(chosen)} suitable available catalogue products found")
    return chosen[:COUNT]


def font(size_mm=4.0, bold=False, narrow=False):
    if narrow and bold:
        cands = [
            "/usr/share/fonts/truetype/liberation2/LiberationSansNarrow-Bold.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSansCondensed-Bold.ttf",
        ]
    elif narrow:
        cands = [
            "/usr/share/fonts/truetype/liberation2/LiberationSansNarrow-Regular.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSansCondensed.ttf",
        ]
    elif bold:
        cands = [
            "/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        ]
    else:
        cands = [
            "/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        ]
    for p in cands:
        if Path(p).exists():
            return ImageFont.truetype(p, mm(size_mm))
    return ImageFont.load_default()


def crop_black(im: Image.Image):
    im = ImageOps.exif_transpose(im).convert("RGBA")
    rgb = im.convert("RGB")
    r, g, b = rgb.split()
    mx = ImageChops.lighter(ImageChops.lighter(r, g), b)
    mask = mx.point(lambda p: 255 if p > 7 else 0).filter(ImageFilter.MaxFilter(7))
    bb = mask.getbbox()
    if bb:
        x0, y0, x1, y1 = bb
        pad = max(5, int(max(x1 - x0, y1 - y0) * 0.025))
        bb = (max(0, x0 - pad), max(0, y0 - pad), min(im.width, x1 + pad), min(im.height, y1 + pad))
        im = im.crop(bb)
    return im


def place_product(base, item, box, angle=0, alpha=255, contain=True):
    x, y, bw, bh = [mm(v) for v in box]
    im = crop_black(Image.open(image_path(item)))
    if contain:
        scale = min(bw / im.width, bh / im.height)
        im = im.resize((max(1, round(im.width * scale)), max(1, round(im.height * scale))), Image.Resampling.LANCZOS)
    else:
        target = bw / bh
        current = im.width / im.height
        if current > target:
            nw = round(im.height * target)
            l = max(0, (im.width - nw) // 2)
            im = im.crop((l, 0, l + nw, im.height))
        else:
            nh = round(im.width / target)
            t = max(0, (im.height - nh) // 2)
            im = im.crop((0, t, im.width, t + nh))
        im = im.resize((bw, bh), Image.Resampling.LANCZOS)
    if alpha != 255:
        a = im.getchannel("A").point(lambda p: int(p * alpha / 255))
        im.putalpha(a)
    if angle:
        im = im.rotate(angle, expand=True, resample=Image.Resampling.BICUBIC)
    px = x + (bw - im.width) // 2
    py = y + (bh - im.height) // 2
    base.alpha_composite(im, (px, py))


def text_layer(text, size_mm, bold=False, narrow=False, fill=PAPER, angle=0, pad_mm=2):
    f = font(size_mm, bold=bold, narrow=narrow)
    bb = f.getbbox(text)
    pad = mm(pad_mm)
    layer = Image.new("RGBA", (bb[2] - bb[0] + pad * 2, bb[3] - bb[1] + pad * 2), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.text((pad - bb[0], pad - bb[1]), text, font=f, fill=fill)
    if angle:
        layer = layer.rotate(angle, expand=True, resample=Image.Resampling.BICUBIC)
    return layer


def paste_text(base, text, x_mm, y_mm, size_mm, bold=False, narrow=False, fill=PAPER, angle=0):
    layer = text_layer(text, size_mm, bold, narrow, fill, angle)
    base.alpha_composite(layer, (mm(x_mm), mm(y_mm)))


def wordmark(base, x_mm, y_mm, size_mm=10.0, angle=0, fill=PAPER):
    # Not a fake logo: this is simply the exact visible site name rendered with the website's font stack character.
    paste_text(base, SITE_TEXTS["wordmark"].upper(), x_mm, y_mm, size_mm, bold=True, narrow=True, fill=fill, angle=angle)


def euro(item):
    p = float(item.get("price") or 0)
    return f"{p:,.2f} €".replace(",", "X").replace(".", ",").replace("X", ".")


def product_tag(base, item, x_mm, y_mm, width_mm=44, angle=0, light=False):
    bg = PAPER if light else INK
    fg = INK if light else PAPER
    sub = (0, 0, 0, 165) if light else MUTED
    layer = Image.new("RGBA", (mm(width_mm), mm(15.5)), bg)
    d = ImageDraw.Draw(layer)
    f1 = font(1.95, bold=True)
    f2 = font(1.65)
    f3 = font(1.8, bold=True)
    brand = str(item.get("brand") or "").upper()[:34]
    title = str(item.get("title") or "")[:48]
    d.text((mm(2), mm(1.3)), brand, font=f1, fill=fg)
    d.text((mm(2), mm(5.5)), title, font=f2, fill=sub)
    d.text((mm(2), mm(10.4)), euro(item), font=f3, fill=fg)
    if angle:
        layer = layer.rotate(angle, expand=True, resample=Image.Resampling.BICUBIC)
    base.alpha_composite(layer, (mm(x_mm), mm(y_mm)))


def qr_block(base, x_mm, y_mm, size_mm=28, black_field=True):
    if black_field:
        d = ImageDraw.Draw(base)
        d.rectangle((mm(x_mm - 4), mm(y_mm - 4), mm(x_mm + size_mm + 4), mm(y_mm + size_mm + 12)), fill=INK)
    qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_H, box_size=12, border=4)
    qr.add_data("https://disorder119.com/")
    qr.make(fit=True)
    q = qr.make_image(fill_color="black", back_color="white").convert("RGBA")
    q = q.resize((mm(size_mm), mm(size_mm)), Image.Resampling.NEAREST)
    base.alpha_composite(q, (mm(x_mm), mm(y_mm)))
    paste_text(base, DOMAIN.upper(), x_mm - 0.5, y_mm + size_mm + 2.5, 2.0, bold=True, narrow=True)


def spine(base):
    d = ImageDraw.Draw(base)
    d.rectangle((mm(SPINE_L), 0, mm(SPINE_R), H), fill=INK)
    d.line((mm(SPINE_L), 0, mm(SPINE_L), H), fill=RULE, width=1)
    d.line((mm(SPINE_R), 0, mm(SPINE_R), H), fill=RULE, width=1)
    strip = text_layer(SITE_TEXTS["wordmark"].upper(), 3.6, bold=True, narrow=True)
    strip = strip.rotate(90, expand=True, resample=Image.Resampling.BICUBIC)
    sw = mm(SPINE_R - SPINE_L)
    base.alpha_composite(strip, (mm(SPINE_L) + (sw - strip.width) // 2, (H - strip.height) // 2))


def draw_eyebrow_block(base, x, y, width=78, angle=0, black=True):
    layer = Image.new("RGBA", (mm(width), mm(28)), INK if black else PAPER)
    d = ImageDraw.Draw(layer)
    fg = PAPER if black else INK
    sub = MUTED if black else (0, 0, 0, 165)
    f0 = font(2.2, bold=True)
    f1 = font(2.0)
    d.text((mm(2), mm(2)), SITE_TEXTS["kicker"].upper(), font=f0, fill=sub)
    lines = [
        "Designer-, Vintage- und Contemporary-Pieces",
        "mit Fokus auf Qualität, Authentizität",
        "und Zeitlosigkeit",
    ]
    yy = 8.0
    for line in lines:
        d.text((mm(2), mm(yy)), line, font=f1, fill=fg)
        yy += 5.0
    if angle:
        layer = layer.rotate(angle, expand=True, resample=Image.Resampling.BICUBIC)
    base.alpha_composite(layer, (mm(x), mm(y)))


def footer_nav(base, x, y, angle=0):
    text = "Über Disorder119   ·   Archiv   ·   FAQ   ·   Kontakt"
    paste_text(base, text, x, y, 1.9, bold=True, narrow=False, fill=MUTED, angle=angle)


def base_canvas():
    b = Image.new("RGBA", (W, H), INK)
    spine(b)
    return b


def v11_universum(products):
    b = base_canvas(); rng = random.Random(11911)
    boxes = []
    # 15 objects each side, no grid; large scale range, several bleed beyond trim.
    for side in ["back", "front"]:
        x0, x1 = (0, 167) if side == "back" else (177.5, 344.5)
        for j in range(15):
            ww = rng.uniform(24, 48); hh = rng.uniform(38, 70)
            x = rng.uniform(x0 - 10, x1 - ww + 10)
            y = rng.uniform(-4, 232 - hh)
            boxes.append((x, y, ww, hh))
    for item, box in zip(products, boxes):
        place_product(b, item, box, angle=rng.choice([-10,-7,-4,-2,0,2,4,7,10]))
    # Keep site name understated, not a fabricated logo lockup.
    d = ImageDraw.Draw(b)
    d.rectangle((mm(218), mm(82), mm(306), mm(135)), fill=(0,0,0,232))
    paste_text(b, SITE_TEXTS["kicker"].upper(), 222, 87, 2.3, bold=True, fill=FAINT)
    wordmark(b, 220, 94, 12.0)
    paste_text(b, SITE_TEXTS["brandline"], 222, 118, 1.85, fill=MUTED)
    qr_block(b, 126, 195, 27)
    return b.convert("RGB")


def v12_cutout_storm(products):
    b = base_canvas(); rng = random.Random(11912)
    # Products aggressively enter from all four edges; center remains black.
    side_boxes = [
        (-6,5,45,65),(24,-7,35,58),(55,4,40,58),(92,-9,43,65),(132,6,37,55),
        (-10,65,43,62),(129,65,42,62),(-8,128,42,64),(130,129,41,66),
        (-5,190,45,50),(33,202,38,39),(78,196,40,43),(117,202,40,36),(145,184,30,56),
        (173,0,40,62),(210,-9,36,58),(247,4,39,55),(286,-8,42,64),(321,8,32,56),
        (174,66,39,62),(307,64,43,64),(176,133,40,59),(309,130,40,65),
        (171,191,47,50),(213,199,36,39),(250,188,40,55),(290,199,38,38),(321,184,30,56),
        (226,57,32,47),(266,143,32,46),
    ]
    for item, box in zip(products, side_boxes):
        place_product(b, item, box, angle=rng.choice([-8,-5,-3,0,3,5,8]))
    draw_eyebrow_block(b, 226, 94, 75, angle=-2)
    wordmark(b, 222, 124, 9.5, angle=1)
    qr_block(b, 110, 100, 29)
    return b.convert("RGB")


def v13_archive_tags(products):
    b = base_canvas(); rng = random.Random(11913)
    # Deliberately inconsistent photo sizes plus real website product labels.
    positions = [
        (4,5,36,54),(42,15,29,43),(75,3,41,61),(119,19,34,47),(143,4,27,58),
        (7,73,34,53),(47,64,38,59),(91,76,28,43),(122,66,42,60),(5,138,40,60),
        (50,132,29,47),(83,141,37,55),(123,130,34,60),(145,145,24,50),
        (8,199,37,40),
        (181,5,38,58),(222,18,31,45),(257,5,39,57),(300,16,39,52),(181,75,31,47),
        (303,72,37,56),(180,135,40,58),(303,136,38,58),(180,199,36,39),(219,190,35,48),
        (259,197,29,41),(291,187,39,53),(321,198,26,39),(235,73,32,47),(266,139,31,45),
    ]
    for idx,(item,box) in enumerate(zip(products, positions)):
        place_product(b, item, box, angle=rng.choice([-6,-3,0,3,6]))
        if idx in {1,4,7,10,13,16,19,22,25,28}:
            product_tag(b, item, box[0] + 2, min(224, box[1] + box[3] - 3), width_mm=42, angle=rng.choice([-5,-2,2,5]), light=(idx%2==0))
    wordmark(b, 218, 101, 10.0)
    paste_text(b, SITE_TEXTS["kicker"].upper(), 220, 94, 2.15, bold=True, fill=FAINT)
    qr_block(b, 116, 177, 27)
    return b.convert("RGB")


def v14_negative_space(products):
    b = base_canvas(); rng = random.Random(11914)
    # More premium: large void, fewer big anchors + many tiny satellites still reaching 30 products.
    anchors = [
        (0,0,52,83),(49,12,39,61),(101,0,54,82),(5,116,53,81),(77,127,48,72),(128,113,40,78),
        (174,0,50,78),(294,0,51,77),(177,158,51,78),(293,160,51,76),
    ]
    sats = []
    for _ in range(20):
        side = rng.choice(["back","front"])
        x0,x1 = (0,167) if side=="back" else (177.5,344.5)
        w = rng.uniform(20,30); h=rng.uniform(30,45)
        x = rng.uniform(x0, x1-w); y=rng.choice([rng.uniform(80,116), rng.uniform(198,220)])
        sats.append((x,y,w,h))
    for item,box in zip(products[:10],anchors): place_product(b,item,box,angle=rng.choice([-5,-3,0,3,5]))
    for item,box in zip(products[10:],sats): place_product(b,item,box,angle=rng.choice([-9,-5,-2,2,5,9]))
    # Site typography inside negative space, left-aligned like the actual archive.
    paste_text(b, SITE_TEXTS["kicker"].upper(), 220, 82, 2.2, bold=True, fill=FAINT)
    wordmark(b, 216, 92, 13.0)
    draw_eyebrow_block(b, 215, 118, 84)
    qr_block(b, 111, 83, 28)
    return b.convert("RGB")


def v15_broken_columns(products):
    b=base_canvas(); rng=random.Random(11915)
    cols=[8,45,82,119,183,220,257,294]
    idx=0
    for c, x in enumerate(cols):
        y=-8 if c%2==0 else 12
        while y<228 and idx<len(products):
            w=rng.choice([27,31,35]); h=rng.choice([40,48,55])
            place_product(b,products[idx],(x+rng.uniform(-5,5),y,w,h),angle=rng.choice([-7,-3,0,3,7]))
            idx+=1; y+=rng.choice([48,55,62])
    # Literal website navigation/copy as editorial graphic elements.
    paste_text(b, SITE_TEXTS["archive"].upper(), 213, 66, 10.0, bold=True, narrow=True, angle=-90, fill=FAINT)
    wordmark(b, 235, 93, 9.5, angle=2)
    paste_text(b, SITE_TEXTS["available"].upper(), 237, 113, 2.3, bold=True, fill=MUTED)
    paste_text(b, SITE_TEXTS["objects"].upper(), 237, 120, 2.0, fill=FAINT)
    paste_text(b, SITE_TEXTS["brands"].upper(), 237, 127, 2.0, fill=FAINT)
    qr_block(b, 112, 181, 27)
    return b.convert("RGB")


def v16_front_clean_back_chaos(products):
    b=base_canvas(); rng=random.Random(11916)
    # Back: 24-product chaos wall.
    for i,item in enumerate(products[:24]):
        row=i//6; col=i%6
        x=2+col*27+rng.uniform(-4,4); y=3+row*56+rng.uniform(-6,6)
        place_product(b,item,(x,y,rng.uniform(26,34),rng.uniform(42,55)),angle=rng.choice([-8,-5,-3,0,3,5,8]))
    # Front: only six larger pieces. Premium usable gift, not ad clutter.
    front_boxes=[(180,5,47,72),(291,12,43,66),(182,166,48,70),(291,168,43,66),(233,15,42,64),(246,169,35,61)]
    for item,box in zip(products[24:],front_boxes): place_product(b,item,box,angle=rng.choice([-5,-2,2,5]))
    paste_text(b,SITE_TEXTS["kicker"].upper(),220,83,2.2,bold=True,fill=FAINT)
    wordmark(b,216,93,13.5)
    paste_text(b,SITE_TEXTS["eyebrow"],219,120,2.0,fill=MUTED)
    paste_text(b,SITE_TEXTS["brandline"],219,130,1.8,fill=FAINT)
    qr_block(b,116,184,28)
    footer_nav(b,219,143)
    return b.convert("RGB")


def v17_type_crop(products):
    b=base_canvas(); rng=random.Random(11917)
    # Products: 15 on each side, mostly small.
    for i,item in enumerate(products):
        side = 0 if i<15 else 1
        x0=0 if side==0 else 177.5
        x1=167 if side==0 else 344.5
        w=rng.uniform(24,36); h=rng.uniform(38,53)
        x=rng.uniform(x0-4,x1-w+4); y=rng.uniform(-2,218-h)
        place_product(b,item,(x,y,w,h),angle=rng.choice([-7,-4,-2,0,2,4,7]))
    # Huge cropped text, still exactly the website name, treated as type not a new logo.
    paste_text(b, SITE_TEXTS["wordmark"].upper(), 193, 65, 27.0, bold=True, narrow=True, fill=(242,239,231,235), angle=-4)
    d=ImageDraw.Draw(b)
    d.rectangle((mm(209),mm(121),mm(307),mm(164)),fill=(0,0,0,230))
    draw_eyebrow_block(b, 214, 126, 88, angle=1)
    qr_block(b, 111, 182, 27)
    return b.convert("RGB")


def v18_collage_collision(products):
    b=base_canvas(); rng=random.Random(11918)
    # Maximum controlled collision: real item photos + real item tags + existing site labels.
    positions=[]
    for side in [0,1]:
        x0=0 if side==0 else 177.5; x1=167 if side==0 else 344.5
        for j in range(15):
            w=rng.uniform(26,45); h=rng.uniform(42,68)
            x=rng.uniform(x0-8,x1-w+8); y=rng.uniform(-5,220-h)
            positions.append((x,y,w,h))
    for i,(item,box) in enumerate(zip(products,positions)):
        place_product(b,item,box,angle=rng.choice([-12,-9,-6,-3,0,3,6,9,12]))
        if i%4==1:
            product_tag(b,item,box[0]+rng.uniform(-3,8),min(224,box[1]+box[3]-4),width_mm=rng.uniform(34,47),angle=rng.choice([-8,-4,4,8]),light=(i%8==1))
    paste_text(b, SITE_TEXTS["kicker"].upper(), 216, 77, 2.2, bold=True, fill=FAINT, angle=-6)
    wordmark(b, 211, 91, 12.5, angle=3)
    paste_text(b, SITE_TEXTS["archive"].upper(), 289, 118, 8.0, bold=True, narrow=True, fill=FAINT, angle=90)
    paste_text(b, SITE_TEXTS["rental"].upper(), 219, 147, 2.0, bold=True, fill=MUTED, angle=-2)
    qr_block(b, 118, 185, 27)
    return b.convert("RGB")


VARIANTS = [
    ("V11_Universum", v11_universum),
    ("V12_CutoutStorm", v12_cutout_storm),
    ("V13_ArchiveTags", v13_archive_tags),
    ("V14_NegativeSpace", v14_negative_space),
    ("V15_BrokenColumns", v15_broken_columns),
    ("V16_FrontCleanBackChaos", v16_front_clean_back_chaos),
    ("V17_TypeCrop", v17_type_crop),
    ("V18_CollageCollision", v18_collage_collision),
]


def save_pdf(img, path):
    pt = 72.0 / 25.4
    c = canvas.Canvas(str(path), pagesize=(W_MM * pt, H_MM * pt))
    c.drawImage(ImageReader(img), 0, 0, width=W_MM * pt, height=H_MM * pt, preserveAspectRatio=False)
    c.showPage(); c.save()


def build_contact_sheet(previews):
    thumb_w=860; thumb_h=round(thumb_w*H/W)
    margin=40; label_h=55
    sheet=Image.new("RGB",(thumb_w*2+margin*3,(thumb_h+label_h)*4+margin*5),(18,18,18))
    d=ImageDraw.Draw(sheet); f=font(3.2,bold=True,narrow=True)
    for idx,(name,img) in enumerate(previews):
        r=idx//2; c=idx%2; x=margin+c*(thumb_w+margin); y=margin+r*(thumb_h+label_h+margin)
        t=img.resize((thumb_w,thumb_h),Image.Resampling.LANCZOS)
        sheet.paste(t,(x,y))
        d.text((x,y+thumb_h+12),name,font=f,fill=(242,239,231))
    return sheet


def main():
    assert_site_texts_exist()
    products=choose_products(load_items())
    previews=[]
    for name,fn in VARIANTS:
        img=fn(products)
        png=OUT/f"Disorder119_Notizbuch_{name}_344.5x245mm_300dpi.png"
        pdf=OUT/f"Disorder119_Notizbuch_{name}_344.5x245mm_Print.pdf"
        prev=OUT/f"Disorder119_Notizbuch_{name}_preview.png"
        img.save(png,dpi=(DPI,DPI),optimize=True)
        save_pdf(img,pdf)
        p=img.resize((round(W*.25),round(H*.25)),Image.Resampling.LANCZOS)
        p.save(prev,optimize=True)
        previews.append((name,p))
    sheet=build_contact_sheet(previews)
    sheet.save(OUT/"Disorder119_A5_Notizbuch_V11-V18_Uebersicht.png",optimize=True)
    (OUT/"verwendete_originalartikel_v3.txt").write_text(
        "\n".join(f"{n:02d}. {i['id']} | {i.get('brand','')} | {i.get('title','')} | {image_path(i).relative_to(ROOT)}" for n,i in enumerate(products,1)),
        encoding="utf-8"
    )
    (OUT/"textquellen.txt").write_text(
        "Nur sichtbare Website-Texte aus index.html plus die explizit gewünschte Domain:\n\n" +
        "\n".join(f"{k}: {v}" for k,v in SITE_TEXTS.items()) + f"\ndomain: {DOMAIN}\n",
        encoding="utf-8"
    )
    print(f"Built {len(VARIANTS)} variants at {W}x{H}px / {DPI}ppi with {len(products)} real shop products each.")

if __name__ == "__main__":
    main()

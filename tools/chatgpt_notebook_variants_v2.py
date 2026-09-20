from __future__ import annotations

import json
import math
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps
import qrcode
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "out_notebook_variants_v2"
OUT.mkdir(exist_ok=True)

DPI = 300
MM_PER_INCH = 25.4
W_MM, H_MM = 344.5, 245.0
W = round(W_MM / MM_PER_INCH * DPI)
H = round(H_MM / MM_PER_INCH * DPI)

# Supplied hardcover template:
# 15 mm wrap | 152 mm back | 10.5 mm spine | 152 mm front | 15 mm wrap
BACK_L, BACK_R = 15.0, 167.0
SPINE_L, SPINE_R = 167.0, 177.5
FRONT_L, FRONT_R = 177.5, 329.5

# Current website design system from assets/app.css.
INK = (0, 0, 0, 255)
PAPER = (242, 239, 231, 255)
SURFACE = (18, 18, 18, 255)
ACCENT = (143, 137, 124, 255)
MUTED = (242, 239, 231, 172)
FAINT = (242, 239, 231, 100)
RULE = (242, 239, 231, 42)
RULE2 = (242, 239, 231, 75)

# IMPORTANT: The cover may only use copy that is actually visible on the shop.
# These strings are taken from the current main/index.html.
SITE_KICKER = "Das kuratierte Archiv von"
SITE_WORDMARK = "DISORDER119"  # visually uppercase on the site via CSS
SITE_EYEBROW = "Designer-, Vintage- und Contemporary-Pieces mit Fokus auf Qualität, Authentizität und Zeitlosigkeit"
SITE_BRAND_LINE_1 = "Prada · Dior · Saint Laurent"
SITE_BRAND_LINE_2 = "Jean Paul Gaultier · Y-3 · u.v.m."
SITE_ARCHIVE = "Archiv"
SITE_AVAILABLE = "Verfügbar"
SITE_OBJECTS = "Objekte im Archiv"
SITE_BRANDS = "Marken"
DOMAIN = "disorder119.com"  # explicitly requested by the user together with the QR code

PREFERRED_IDS = [
    6241, 6240, 6239, 6237, 6236, 6235,
    6218, 6217, 6215, 6214, 6213, 6211,
    6210, 6209, 6208, 6207, 6205, 6204, 6203,
    9479, 9378, 9442, 9362, 9476, 9475, 9480,
    9463, 9456, 9432, 9404, 9401, 9400, 9365,
]
COUNT = 30


def mm(v: float) -> int:
    return round(v / MM_PER_INCH * DPI)


def font(size_mm=4.0, bold=False, narrow=False):
    if narrow and bold:
        candidates = [
            "/usr/share/fonts/truetype/liberation2/LiberationSansNarrow-Bold.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSansCondensed-Bold.ttf",
        ]
    elif narrow:
        candidates = [
            "/usr/share/fonts/truetype/liberation2/LiberationSansNarrow-Regular.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSansCondensed.ttf",
        ]
    elif bold:
        candidates = [
            "/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        ]
    else:
        candidates = [
            "/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        ]
    for p in candidates:
        if Path(p).exists():
            return ImageFont.truetype(p, mm(size_mm))
    return ImageFont.load_default()


def load_items():
    return json.loads((ROOT / "data/items.json").read_text(encoding="utf-8"))


def is_available(item):
    return item.get("public_status") == "AVAILABLE" or str(item.get("status", "")).lower() in {"verfügbar", "available"}


def image_path(item):
    p = item.get("look")
    if not p:
        g = item.get("gallery") or []
        p = g[0] if g else None
    if not p:
        return None
    src = ROOT / p
    if not src.exists():
        return None
    display = src.parent / "display" / src.name
    return display if display.exists() else src


def choose_products(items):
    by_id = {int(i["id"]): i for i in items if "id" in i}
    chosen = []
    seen = set()
    for pid in PREFERRED_IDS:
        i = by_id.get(pid)
        if i and is_available(i) and image_path(i):
            chosen.append(i)
            seen.add(pid)
        if len(chosen) >= COUNT:
            return chosen[:COUNT]

    pool = [i for i in items if is_available(i) and image_path(i) and int(i.get("id", -1)) not in seen]
    while pool and len(chosen) < COUNT:
        used_brands = {x.get("brand") for x in chosen}
        used_cats = {x.get("taxonomy_category") or x.get("category") for x in chosen}
        pool.sort(
            key=lambda i: (
                5 * (i.get("brand") not in used_brands)
                + 3 * ((i.get("taxonomy_category") or i.get("category")) not in used_cats)
                + min(float(i.get("price") or 0), 1000) / 1000,
                int(i.get("id", 0)),
            ),
            reverse=True,
        )
        chosen.append(pool.pop(0))
    if len(chosen) < COUNT:
        raise RuntimeError(f"Only {len(chosen)} available products with usable images; need {COUNT}")
    return chosen[:COUNT]


def stats(items):
    total = len(items)
    available = sum(1 for i in items if is_available(i))
    brands = len({str(i.get("brand", "")).strip() for i in items if str(i.get("brand", "")).strip()})
    return total, available, brands


def load_photo(item):
    return ImageOps.exif_transpose(Image.open(image_path(item))).convert("RGBA")


def contain(im, w, h):
    scale = min(w / im.width, h / im.height)
    return im.resize((max(1, round(im.width * scale)), max(1, round(im.height * scale))), Image.Resampling.LANCZOS)


def place(base, item, box_mm, angle=0, alpha=255):
    x, y, bw, bh = [mm(v) for v in box_mm]
    im = contain(load_photo(item), bw, bh)
    if alpha != 255:
        a = im.getchannel("A").point(lambda p: int(p * alpha / 255))
        im.putalpha(a)
    if angle:
        im = im.rotate(angle, expand=True, resample=Image.Resampling.BICUBIC)
    px = x + (bw - im.width)//2
    py = y + (bh - im.height)//2
    base.alpha_composite(im, (px, py))


def rotate_text(base, text, x_mm, y_mm, size_mm, angle=0, fill=PAPER, bold=True, narrow=True):
    f = font(size_mm, bold=bold, narrow=narrow)
    b = f.getbbox(text)
    pad = mm(2)
    layer = Image.new("RGBA", (b[2]-b[0]+pad*2, b[3]-b[1]+pad*2), (0,0,0,0))
    d = ImageDraw.Draw(layer)
    d.text((pad-b[0], pad-b[1]), text, font=f, fill=fill)
    if angle:
        layer = layer.rotate(angle, expand=True, resample=Image.Resampling.BICUBIC)
    base.alpha_composite(layer, (mm(x_mm), mm(y_mm)))


def draw_site_wordmark(base, x_mm, y_mm, size_mm=12, angle=0, fill=PAPER):
    # Same condensed, heavy uppercase character as the current website masthead.
    rotate_text(base, SITE_WORDMARK, x_mm, y_mm, size_mm, angle=angle, fill=fill, bold=True, narrow=True)


def draw_kicker(base, x_mm, y_mm, size_mm=2.2, angle=0, fill=MUTED):
    rotate_text(base, SITE_KICKER.upper(), x_mm, y_mm, size_mm, angle=angle, fill=fill, bold=True, narrow=False)


def draw_eyebrow_block(base, x_mm, y_mm, width_mm=58, size_mm=2.15, fill=MUTED):
    d = ImageDraw.Draw(base)
    f = font(size_mm, bold=False, narrow=False)
    words = SITE_EYEBROW.upper().split()
    lines = []
    current = ""
    max_px = mm(width_mm)
    for word in words:
        trial = (current + " " + word).strip()
        if d.textlength(trial, font=f) <= max_px:
            current = trial
        else:
            if current:
                lines.append(current)
            current = word
    if current:
        lines.append(current)
    yy = mm(y_mm)
    for line in lines:
        d.text((mm(x_mm), yy), line, font=f, fill=fill)
        yy += mm(size_mm * 1.55)


def draw_brand_line(base, x_mm, y_mm, size_mm=1.9, fill=FAINT, align="left"):
    d = ImageDraw.Draw(base)
    f = font(size_mm, bold=False, narrow=False)
    lines = [SITE_BRAND_LINE_1, SITE_BRAND_LINE_2]
    yy = mm(y_mm)
    for line in lines:
        if align == "right":
            d.text((mm(x_mm), yy), line, font=f, fill=fill, anchor="ra")
        elif align == "center":
            d.text((mm(x_mm), yy), line, font=f, fill=fill, anchor="ma")
        else:
            d.text((mm(x_mm), yy), line, font=f, fill=fill)
        yy += mm(size_mm*1.55)


def euro(item):
    p = float(item.get("price") or 0)
    return f"{p:,.2f} €".replace(",", "X").replace(".", ",").replace("X", ".")


def product_ticket(base, item, x_mm, y_mm, w_mm=48, angle=0, inverse=True):
    bg = PAPER if inverse else SURFACE
    fg = INK if inverse else PAPER
    muted = (0,0,0,170) if inverse else MUTED
    layer = Image.new("RGBA", (mm(w_mm), mm(15)), bg)
    d = ImageDraw.Draw(layer)
    fb = font(1.8, bold=True)
    ft = font(1.65)
    fp = font(1.7, bold=True)
    brand = str(item.get("brand") or "").upper()[:34]
    title = str(item.get("title") or "")[:56]
    d.text((mm(2), mm(1.4)), brand, font=fb, fill=fg)
    d.text((mm(2), mm(5.1)), title, font=ft, fill=muted)
    d.text((mm(2), mm(10.0)), euro(item), font=fp, fill=fg)
    if angle:
        layer = layer.rotate(angle, expand=True, resample=Image.Resampling.BICUBIC)
    base.alpha_composite(layer, (mm(x_mm), mm(y_mm)))


def draw_qr(base, x_mm, y_mm, size_mm=26):
    qr = qrcode.QRCode(version=None, error_correction=qrcode.constants.ERROR_CORRECT_H, box_size=10, border=4)
    qr.add_data("https://disorder119.com/")
    qr.make(fit=True)
    q = qr.make_image(fill_color="black", back_color="white").convert("RGBA")
    s = mm(size_mm)
    q = q.resize((s,s), Image.Resampling.NEAREST)
    base.alpha_composite(q, (mm(x_mm), mm(y_mm)))


def qr_block(base, x_mm, y_mm, align="left"):
    d = ImageDraw.Draw(base)
    draw_qr(base, x_mm, y_mm, 26)
    f = font(1.9, bold=True, narrow=True)
    if align == "left":
        d.text((mm(x_mm), mm(y_mm+28.5)), DOMAIN.upper(), font=f, fill=PAPER)
    else:
        d.text((mm(x_mm+26), mm(y_mm+28.5)), DOMAIN.upper(), font=f, fill=PAPER, anchor="ra")


def draw_site_stats(base, x_mm, y_mm, values, vertical=False):
    total, avail, brands = values
    rows = [(str(total), SITE_OBJECTS), (str(avail), SITE_AVAILABLE), (str(brands), SITE_BRANDS)]
    d = ImageDraw.Draw(base)
    fv = font(4.0, bold=True, narrow=True)
    fl = font(1.55, bold=True)
    if vertical:
        yy = y_mm
        for v, l in rows:
            d.text((mm(x_mm), mm(yy)), v, font=fv, fill=PAPER)
            d.text((mm(x_mm), mm(yy+5.2)), l.upper(), font=fl, fill=FAINT)
            yy += 15
    else:
        xx = x_mm
        for v, l in rows:
            d.text((mm(xx), mm(y_mm)), v, font=fv, fill=PAPER)
            d.text((mm(xx), mm(y_mm+5.2)), l.upper(), font=fl, fill=FAINT)
            xx += 30


def draw_spine(base):
    d = ImageDraw.Draw(base)
    d.rectangle((mm(SPINE_L), 0, mm(SPINE_R), H), fill=INK)
    d.line((mm(SPINE_L), 0, mm(SPINE_L), H), fill=RULE, width=1)
    d.line((mm(SPINE_R), 0, mm(SPINE_R), H), fill=RULE, width=1)
    # Site wordmark only, no invented spine copy.
    rotate_text(base, SITE_WORDMARK, SPINE_L+2.3, 73, 3.15, angle=90, fill=PAPER, bold=True, narrow=True)


def add_favicon(base, x_mm, y_mm, size_mm=7):
    p = ROOT / "assets/favicon.png"
    if not p.exists():
        return
    im = Image.open(p).convert("RGBA")
    s = mm(size_mm)
    im.thumbnail((s,s), Image.Resampling.LANCZOS)
    base.alpha_composite(im, (mm(x_mm), mm(y_mm)))


def base_cover():
    b = Image.new("RGBA", (W,H), INK)
    draw_spine(b)
    return b


def variant_a(products, st):
    # ORBIT: maximum negative space around a small, accurate website wordmark.
    b = base_cover(); d = ImageDraw.Draw(b); rng = random.Random(119101)
    centers = [(52,62),(88,34),(126,66),(46,124),(101,118),(136,156),(42,195),(96,200),
               (199,26),(236,47),(284,27),(317,60),(190,103),(305,109),(211,160),(276,151),(323,174),(203,211),(250,207),(309,216)]
    sizes = [(36,54),(29,44),(38,49),(30,48),(37,56),(33,48),(42,44),(36,42),
             (34,48),(31,43),(34,52),(30,44),(31,48),(39,55),(38,50),(32,49),(37,51),(34,43),(36,44),(31,42)]
    for i,(cx,cy) in enumerate(centers):
        w,h=sizes[i]
        place(b, products[i], (cx-w/2, cy-h/2, w,h), angle=rng.choice([-11,-7,-4,0,4,7,10]))
    # 10 smaller orbiters
    small = [(20,25),(148,27),(22,86),(147,113),(21,154),(149,210),(183,55),(335,19),(183,184),(335,126)]
    for j,(x,y) in enumerate(small, start=20):
        place(b, products[j], (x-13,y-20,26,40), angle=rng.choice([-12,-6,3,8]))
    draw_kicker(b, 232, 91, 2.1)
    draw_site_wordmark(b, 222, 99, 14.5)
    draw_eyebrow_block(b, 239, 122, 53, 1.9, FAINT)
    draw_brand_line(b, 239, 145, 1.65, FAINT)
    draw_site_stats(b, 223, 164, st, vertical=False)
    qr_block(b, 112, 199)
    add_favicon(b, 320, 219, 6)
    return b


def variant_b(products, st):
    # TICKETS: skewed catalogue fragments using only real product copy.
    b = base_cover(); d = ImageDraw.Draw(b); rng = random.Random(119102)
    boxes = []
    # back 15
    for row,y in enumerate([14,57,102,148,193]):
        xs = [19,68,119]
        for col,x in enumerate(xs):
            boxes.append((x, y + (col%2)*4, 38, 49))
    # front 15
    for row,y in enumerate([12,58,104,151,195]):
        xs = [181,229,285]
        for col,x in enumerate(xs):
            boxes.append((x, y + ((row+col)%2)*5, 36, 46))
    for i,box in enumerate(boxes[:30]):
        place(b, products[i], box, angle=rng.choice([-8,-5,-2,2,5,8]))
    # Tickets deliberately collide with images.
    tickets = [(25,36,46,-6),(79,91,51,4),(112,164,45,-3),(24,211,48,5),
               (192,38,51,5),(259,86,48,-5),(204,137,52,3),(270,175,50,-4),(208,214,49,4)]
    for n,(x,y,w,a) in enumerate(tickets):
        product_ticket(b, products[(n*3)%30], x,y,w,a, inverse=(n%3!=0))
    draw_kicker(b, 235, 71, 1.9, angle=-2)
    draw_site_wordmark(b, 225, 79, 13.8, angle=-2)
    draw_brand_line(b, 299, 107, 1.55, FAINT, align="right")
    qr_block(b, 115, 204)
    rotate_text(b, SITE_ARCHIVE.upper(), 177.8, 18, 2.2, angle=90, fill=FAINT)
    return b


def variant_c(products, st):
    # BROKEN GRID: site catalogue grid language, but deliberately misregistered.
    b = base_cover(); d = ImageDraw.Draw(b); rng = random.Random(119103)
    # Uneven grid rules.
    for x in [18,54,91,126,183,218,256,292,326]:
        d.line((mm(x), mm(8), mm(x+rng.choice([-3,0,4])), mm(236)), fill=RULE, width=2)
    for y in [18,61,103,148,193,229]:
        d.line((mm(9), mm(y), mm(337), mm(y+rng.choice([-3,0,3]))), fill=RULE, width=2)
    boxes = [(10,5,42,54),(49,15,38,49),(88,6,37,53),(125,19,38,45),
             (18,65,37,49),(62,71,34,44),(99,61,42,55),(131,84,32,44),
             (9,127,42,57),(53,121,39,52),(96,136,35,48),(129,130,34,51),
             (15,187,37,47),(59,180,37,50),(108,190,48,42),
             (179,6,38,52),(220,18,36,46),(257,4,40,55),(302,22,33,48),
             (183,65,35,50),(226,72,34,46),(268,61,40,55),(305,75,31,44),
             (179,126,39,57),(224,135,34,47),(267,119,39,54),(307,139,31,46),
             (185,188,36,44),(236,182,36,49),(298,190,37,45)]
    for i,box in enumerate(boxes):
        place(b, products[i], box, angle=rng.choice([-5,-3,0,3,5]))
    # Wordmark vertical but still exact site text.
    draw_site_wordmark(b, 221, 32, 12.8, angle=90)
    draw_kicker(b, 200, 166, 1.9)
    draw_eyebrow_block(b, 200, 174, 56, 1.7, FAINT)
    draw_site_stats(b, 200, 204, st, vertical=False)
    qr_block(b, 116, 200)
    return b


def variant_d(products, st):
    # EDGE PRESSURE: products crowd the perimeter, center remains almost empty.
    b = base_cover(); d = ImageDraw.Draw(b); rng = random.Random(119104)
    # Along outer edge / corners.
    boxes = [(-2,2,46,63),(34,0,36,52),(72,3,34,49),(108,-2,43,61),(142,11,30,46),
             (0,62,36,50),(3,116,34,52),(1,171,42,59),(42,198,40,44),(86,195,40,47),(128,197,41,43),
             (174,-2,41,60),(212,3,33,49),(248,-1,37,56),(287,5,34,50),(319,1,33,56),
             (310,58,36,51),(312,111,36,55),(309,167,39,58),(270,199,40,42),(228,197,39,45),(183,198,41,43),
             (178,65,31,44),(181,129,32,46),(134,70,32,46),(130,129,34,49),(42,72,30,44),(88,128,34,49),
             (252,67,31,47),(259,132,32,49)]
    for i,box in enumerate(boxes):
        place(b, products[i], box, angle=rng.choice([-10,-6,-3,3,6,10]))
    # Clean center, precise site masthead treatment but off-center.
    draw_kicker(b, 226, 86, 2.0)
    draw_site_wordmark(b, 216, 95, 15.8)
    d.line((mm(217),mm(119),mm(299),mm(119)),fill=RULE2,width=2)
    draw_eyebrow_block(b, 235, 126, 54, 1.8, FAINT)
    qr_block(b, 117, 103)
    draw_brand_line(b, 235, 157, 1.55, FAINT)
    add_favicon(b, 315, 220, 6)
    return b


def variant_e(products, st):
    # COLUMN SHIFT: asymmetric narrow columns like a fashion editorial contact sheet.
    b = base_cover(); d = ImageDraw.Draw(b); rng = random.Random(119105)
    columns = [
        (8, 26, 38, [0,1,2,3]), (48, 8, 34, [4,5,6,7]), (84, 35, 42, [8,9,10,11]), (130, 2, 34, [12,13,14]),
        (179, 23, 36, [15,16,17,18]), (220, 2, 34, [19,20,21,22]), (258, 33, 39, [23,24,25,26]), (302, 8, 35, [27,28,29])
    ]
    for x,y,w,ids in columns:
        yy=y
        for k,idx in enumerate(ids):
            h = rng.choice([42,47,53])
            place(b, products[idx], (x,yy,w,h), angle=rng.choice([-4,-2,0,2,4]))
            yy += h*0.88
    # Small wordmark, more like a label than a poster logo.
    draw_kicker(b, 216, 194, 1.8)
    draw_site_wordmark(b, 216, 201, 11.5)
    draw_brand_line(b, 216, 218, 1.45, FAINT)
    qr_block(b, 116, 198)
    # Exact site stats on back as editorial data.
    draw_site_stats(b, 20, 211, st, vertical=False)
    return b


def variant_f(products, st):
    # LABEL COLLISION: more chaotic, but every text fragment is real shop copy.
    b = base_cover(); d = ImageDraw.Draw(b); rng = random.Random(119106)
    boxes = [
        (3,7,46,57),(44,17,38,50),(80,1,41,60),(117,25,44,48),
        (10,69,39,52),(52,62,36,51),(91,74,41,50),(129,61,33,50),
        (1,128,45,60),(43,139,37,48),(83,121,42,59),(124,143,39,48),
        (11,191,44,46),(58,184,36,50),(109,195,51,40),
        (176,2,43,60),(215,17,36,49),(250,3,43,58),(294,18,41,50),
        (181,68,37,53),(220,60,42,57),(266,72,35,49),(302,63,36,55),
        (177,130,41,59),(220,142,38,49),(258,123,42,59),(301,143,37,49),
        (185,190,40,46),(235,184,37,50),(292,192,43,45)
    ]
    for i,box in enumerate(boxes):
        place(b, products[i], box, angle=rng.choice([-9,-6,-3,0,3,6,9]))
    # Real product labels collide with site copy, like pasted archive tags.
    tag_positions = [(17,46,48,-5),(99,36,48,4),(27,109,52,3),(103,174,50,-4),
                     (190,42,50,5),(257,95,51,-5),(198,151,52,4),(271,200,48,-3)]
    for n,(x,y,w,a) in enumerate(tag_positions):
        product_ticket(b, products[(n*4+2)%30], x,y,w,a, inverse=(n%2==0))
    # Site masthead appears small and displaced, not as a huge fake logo.
    draw_kicker(b, 229, 109, 1.8, angle=-1)
    draw_site_wordmark(b, 219, 116, 12.7, angle=-1)
    draw_brand_line(b, 221, 133, 1.45, FAINT)
    draw_site_stats(b, 220, 149, st, vertical=False)
    qr_block(b, 116, 200)
    return b


VARIANTS = [
    ("V5_Orbit", variant_a),
    ("V6_Tickets", variant_b),
    ("V7_BrokenGrid", variant_c),
    ("V8_EdgePressure", variant_d),
    ("V9_ColumnShift", variant_e),
    ("V10_LabelCollision", variant_f),
]


def export(name, image):
    rgb = image.convert("RGB")
    png = OUT / f"Disorder119_Notizbuch_{name}_344.5x245mm_300dpi.png"
    pdf = OUT / f"Disorder119_Notizbuch_{name}_344.5x245mm_Print.pdf"
    preview = OUT / f"Disorder119_Notizbuch_{name}_preview.png"
    rgb.save(png, dpi=(DPI,DPI), optimize=True)
    pv_w = 1400
    pv_h = round(H * pv_w / W)
    rgb.resize((pv_w,pv_h), Image.Resampling.LANCZOS).save(preview, optimize=True)
    pt = 72/25.4
    c = canvas.Canvas(str(pdf), pagesize=(W_MM*pt,H_MM*pt))
    c.drawImage(ImageReader(rgb),0,0,width=W_MM*pt,height=H_MM*pt,preserveAspectRatio=False)
    c.showPage(); c.save()
    return preview


def contact_sheet(previews):
    thumbs=[]
    for p in previews:
        im=Image.open(p).convert("RGB")
        im.thumbnail((1150,820),Image.Resampling.LANCZOS)
        thumbs.append(im)
    margin=40; gap=35; label_h=58
    cell_w=1150; cell_h=820+label_h
    sheet=Image.new("RGB",(margin*2+cell_w*2+gap,margin*2+cell_h*3+gap*2),(18,18,18))
    d=ImageDraw.Draw(sheet); lf=font(5.0,bold=True,narrow=True)
    for idx,(im,(name,_)) in enumerate(zip(thumbs,VARIANTS)):
        col=idx%2; row=idx//2
        x=margin+col*(cell_w+gap); y=margin+row*(cell_h+gap)
        sheet.paste(im,(x,y))
        d.text((x,y+820+8),name.replace("_"," "),font=lf,fill=(242,239,231))
    path=OUT/"Disorder119_A5_Notizbuch_6_neue_Varianten_Uebersicht.png"
    sheet.save(path,optimize=True)
    return path


def main():
    items=load_items(); products=choose_products(items); st=stats(items)
    previews=[]
    for name,fn in VARIANTS:
        previews.append(export(name,fn(products,st)))
    contact_sheet(previews)
    manifest=OUT/"verwendete_originalartikel_v2.txt"
    manifest.write_text(
        "DISORDER119 notebook cover variants V2\n"
        "Data format: 344.5 x 245 mm, 300 ppi\n"
        "QR target: https://disorder119.com/\n"
        "Visible advertising copy: current website copy only; product labels come directly from data/items.json.\n\n"
        + "\n".join(
            f"{n:02d}. id {i['id']} | {i.get('brand','')} | {i.get('title','')} | {euro(i)} | {image_path(i).relative_to(ROOT)}"
            for n,i in enumerate(products,1)
        ),
        encoding="utf-8"
    )
    print(f"built {len(VARIANTS)} variants using {len(products)} real available products")
    print(f"site stats: total={st[0]} available={st[1]} brands={st[2]}")


if __name__ == "__main__":
    main()

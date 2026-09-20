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
OUT = ROOT / "out_notebook_original_v7"
OUT.mkdir(exist_ok=True)

DPI = 300
MM_PER_INCH = 25.4
W_MM, H_MM = 344.5, 245.0
W = round(W_MM / MM_PER_INCH * DPI)
H = round(H_MM / MM_PER_INCH * DPI)

# Exact print spread from the user's printer template.
BACK_L, BACK_R = 15.0, 167.0
SPINE_L, SPINE_R = 167.0, 177.5
FRONT_L, FRONT_R = 177.5, 329.5

# Website palette from assets/app.css
INK = (0, 0, 0, 255)
PAPER = (242, 239, 231, 255)      # --paper / --text
ACCENT = (143, 137, 124, 255)     # --accent

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


def font(size_mm: float, bold=True, narrow=True):
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


def pool(items):
    by_id = {int(i["id"]): i for i in items if "id" in i}
    out, seen = [], set()
    for pid in CANDIDATE_IDS:
        i = by_id.get(pid)
        if i and available(i) and src_path(i):
            out.append(i); seen.add(pid)
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
    r = sum(x[0] for x in pts)/len(pts)/255
    g = sum(x[1] for x in pts)/len(pts)/255
    b = sum(x[2] for x in pts)/len(pts)/255
    h, s, v = colorsys.rgb_to_hsv(r, g, b)
    if v < 0.40: return "dark"
    if s < 0.16 and v > 0.68: return "light"
    if s < 0.22: return "neutral"
    if 0.05 <= h <= 0.16: return "earth"
    if 0.16 < h <= 0.44: return "olive"
    if h < 0.05 or h > 0.94: return "warm"
    return "neutral"


def tone(item):
    return tone_for_path(str(src_path(item)))


def choose_palette(items, quotas, total, seed):
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
        opts = [i for i in items if int(i.get("id", -1)) not in used_ids]
        opts.sort(key=lambda i: score(i, wanted), reverse=True)
        for i in opts[:count]:
            chosen.append(i)
            used_ids.add(int(i["id"]))
            used_brands.add(i.get("brand") or "")
            used_cats.add(i.get("taxonomy_category") or i.get("category") or "")
    if len(chosen) < total:
        rest = [i for i in items if int(i.get("id", -1)) not in used_ids]
        rng.shuffle(rest)
        chosen.extend(rest[:total-len(chosen)])
    return chosen[:total]


@lru_cache(maxsize=256)
def cutout(path_str: str):
    """Remove only connected near-black studio background. Never recolor product pixels."""
    im = ImageOps.exif_transpose(Image.open(path_str)).convert("RGBA")
    rgb = im.convert("RGB")
    w, h = rgb.size
    pix = rgb.load()
    seen = bytearray(w*h)
    q = deque()

    def is_bg(x, y):
        r, g, b = pix[x, y]
        mx, mn = max(r,g,b), min(r,g,b)
        return mx <= 24 and (mx-mn) <= 15

    def push(x, y):
        idx = y*w+x
        if seen[idx] or not is_bg(x,y):
            return
        seen[idx] = 1
        q.append((x,y))

    for x in range(w):
        push(x,0); push(x,h-1)
    for y in range(h):
        push(0,y); push(w-1,y)

    while q:
        x,y = q.popleft()
        if x>0: push(x-1,y)
        if x+1<w: push(x+1,y)
        if y>0: push(x,y-1)
        if y+1<h: push(x,y+1)

    rgba = im.load()
    for y in range(h):
        row=y*w
        for x in range(w):
            if seen[row+x]:
                r,g,b,_ = rgba[x,y]
                rgba[x,y] = (r,g,b,0)
    bb = im.getbbox()
    return im.crop(bb) if bb else im


def place(base, item, box, angle=0):
    x,y,bw,bh = [mm(v) for v in box]
    im = cutout(str(src_path(item))).copy()
    s = min(bw/im.width, bh/im.height)
    im = im.resize((max(1,round(im.width*s)), max(1,round(im.height*s))), Image.Resampling.LANCZOS)
    if angle:
        im = im.rotate(angle, expand=True, resample=Image.Resampling.BICUBIC)
    base.alpha_composite(im, (x+(bw-im.width)//2, y+(bh-im.height)//2))


def render_fitted_word(base, text, x_mm, y_mm, width_mm, height_mm, fill=PAPER):
    f = font(height_mm*1.05, True, True)
    bb = f.getbbox(text)
    pad = mm(2)
    layer = Image.new("RGBA", (max(1,bb[2]-bb[0]+pad*2), max(1,bb[3]-bb[1]+pad*2)), (0,0,0,0))
    d = ImageDraw.Draw(layer)
    d.text((pad-bb[0], pad-bb[1]), text, font=f, fill=fill)
    crop = layer.getbbox()
    if crop:
        layer = layer.crop(crop)
    layer = layer.resize((mm(width_mm), mm(height_mm)), Image.Resampling.LANCZOS)
    base.alpha_composite(layer, (mm(x_mm), mm(y_mm)))


def website_wordmark(base, x_mm, y_mm, width_mm, height_mm=15.5):
    # Mirrors current CSS identity: Helvetica Neue Condensed/Arial Narrow, 800, tight tracking.
    render_fitted_word(base, "DISORDER119", x_mm, y_mm, width_mm, height_mm, PAPER)


def qr_block(base, cx_mm=91, y_mm=197, size_mm=26):
    qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_H, box_size=12, border=4)
    qr.add_data("https://disorder119.com/")
    qr.make(fit=True)
    q = qr.make_image(fill_color="black", back_color="white").convert("RGBA")
    s=mm(size_mm)
    q=q.resize((s,s), Image.Resampling.NEAREST)
    base.alpha_composite(q,(mm(cx_mm-size_mm/2),mm(y_mm)))
    d=ImageDraw.Draw(base)
    f=font(2.35,True,True)
    t="DISORDER119.COM"
    bb=d.textbbox((0,0),t,font=f)
    d.text((mm(cx_mm)-(bb[2]-bb[0])/2,mm(y_mm+size_mm+3.2)),t,font=f,fill=PAPER)


def canvas():
    # Pure black full spread; spine deliberately empty.
    return Image.new("RGBA",(W,H),INK)


def build_variant(name, items, front_boxes, back_boxes, wordmark, qrpos, front_angles=None, back_angles=None):
    base=canvas()
    front_angles=front_angles or [0]*len(front_boxes)
    back_angles=back_angles or [0]*len(back_boxes)
    nf=len(front_boxes)
    for i,b,a in zip(items[:nf],front_boxes,front_angles):
        place(base,i,b,a)
    for i,b,a in zip(items[nf:nf+len(back_boxes)],back_boxes,back_angles):
        place(base,i,b,a)
    website_wordmark(base,*wordmark)
    qr_block(base,*qrpos)
    rgb=base.convert("RGB")
    full=OUT/f"Disorder119_{name}_344.5x245mm_300dpi.png"
    prev=OUT/f"Disorder119_{name}_preview.png"
    rgb.save(full,dpi=(DPI,DPI),optimize=True)
    rgb.resize((1600,round(1600*H/W)),Image.Resampling.LANCZOS).save(prev,optimize=True)
    return prev


def main():
    p=pool(load_items())
    if len(p)<40:
        raise RuntimeError(f"Only {len(p)} usable products")

    outputs=[]

    # A — Website Masthead: exact one-line identity, premium balance.
    items=choose_palette(p,[("dark",8),("light",4),("neutral",2),("earth",2)],16,31071)
    front=[(181,8,39,65),(295,9,35,58),(181,160,40,63),(296,163,34,59),(183,93,29,44),(302,92,27,44)]
    back=[(10,12,33,50),(53,9,31,49),(96,12,31,47),(137,10,26,48),(14,78,32,49),(58,75,30,48),(100,78,31,48),(138,78,26,46),(31,143,37,52),(91,140,37,55)]
    outputs.append(build_variant("V7A_MASTHEAD",items,front,back,(203,108,103,15.5),(91,196,26),[-2,2,2,-2,1,-1],[-2,1,-1,2,1,-2,2,-1,-2,2]))

    # B — Offset: asymmetrical editorial wordmark lower-left on the front.
    items=choose_palette(p,[("dark",7),("olive",3),("earth",3),("light",3)],16,31072)
    front=[(181,8,42,69),(294,9,36,60),(184,137,37,59),(298,151,31,55),(183,84,29,44),(301,80,28,44)]
    back=[(11,11,32,50),(52,10,31,48),(94,13,31,46),(136,10,27,48),(14,78,31,48),(56,75,30,49),(98,78,31,48),(139,77,25,46),(31,142,36,53),(94,142,36,53)]
    outputs.append(build_variant("V7B_OFFSET",items,front,back,(193,119,111,16.0),(91,196,26),[-2,2,1,-2,2,-1],[-2,1,-1,2,1,-2,2,-1,-2,2]))

    # C — Quiet luxury: fewer front pieces and more black negative space.
    items=choose_palette(p,[("dark",8),("light",4),("neutral",2)],14,31073)
    front=[(180,6,44,73),(292,8,39,66),(181,160,43,67),(295,161,37,64),(303,89,27,44)]
    back=[(15,14,38,58),(64,10,36,55),(113,15,35,52),(18,88,37,56),(70,83,35,57),(119,88,34,54),(35,158,39,53),(101,153,39,56),(139,158,25,47)]
    outputs.append(build_variant("V7C_QUIET",items,front,back,(210,110,94,14.6),(91,196,26),[-2,2,2,-2,-1],[-2,1,-1,2,-2,2,-1,2,-1]))

    # D — Poster: large brand statement with controlled ring of products.
    items=choose_palette(p,[("dark",8),("light",3),("earth",2),("olive",3)],16,31074)
    front=[(180,7,39,64),(296,9,34,56),(181,162,40,62),(296,164,34,58),(224,8,28,43),(273,10,27,42)]
    back=[(10,12,33,50),(53,10,31,48),(95,12,31,47),(137,10,26,48),(14,78,32,49),(57,76,30,48),(99,78,31,48),(139,78,25,46),(29,143,37,52),(93,141,37,54)]
    outputs.append(build_variant("V7D_POSTER",items,front,back,(194,107,120,17.0),(91,196,26),[-2,2,2,-2,1,-1],[-2,1,-1,2,1,-2,2,-1,-2,2]))

    # Contact sheet.
    tw=800; th=round(tw*H/W); gap=28; label_h=42
    sheet=Image.new("RGB",(tw*2+gap*3,(th+label_h)*2+gap*3),(20,20,20))
    d=ImageDraw.Draw(sheet); lf=font(3.0,True,True)
    labels=["V7A MASTHEAD","V7B OFFSET","V7C QUIET","V7D POSTER"]
    for idx,(label,path) in enumerate(zip(labels,outputs)):
        im=Image.open(path).convert("RGB").resize((tw,th),Image.Resampling.LANCZOS)
        r,c=divmod(idx,2); x=gap+c*(tw+gap); y=gap+r*(th+label_h+gap)
        sheet.paste(im,(x,y)); d.text((x,y+th+9),label,font=lf,fill=(242,239,231))
    sheet.save(OUT/"Disorder119_V7_4_Entwuerfe_Uebersicht.png",optimize=True)

    (OUT/"hinweis.txt").write_text(
        "All product images are loaded directly from current disorder119/disorder119-shop catalogue files. "
        "No hue/saturation/brightness/recoloring filter is applied. Only connected near-black studio background pixels are removed. "
        "The wordmark follows the current website CSS identity: condensed/narrow bold, tight tracking, paper color #f2efe7. "
        "Spine is pure black and empty. QR points to https://disorder119.com/.\n",
        encoding="utf-8",
    )
    print("Built 4 site-faithful original-product notebook variants.")


if __name__ == "__main__":
    main()

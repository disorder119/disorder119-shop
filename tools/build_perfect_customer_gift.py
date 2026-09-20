from __future__ import annotations

import json
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps, ImageFilter, ImageChops
import qrcode
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "out_perfect_gift"
OUT.mkdir(exist_ok=True)

DPI = 300
MM = 25.4
W_MM, H_MM = 344.5, 245.0
W = round(W_MM / MM * DPI)
H = round(H_MM / MM * DPI)

# Supplied notebook template: 15 mm wrap | 152 mm back | 10.5 mm spine | 152 mm front | 15 mm wrap
BACK_L, BACK_R = 15.0, 167.0
SPINE_L, SPINE_R = 167.0, 177.5
FRONT_L, FRONT_R = 177.5, 329.5

INK = (0, 0, 0, 255)
PAPER = (242, 239, 231, 255)
ACCENT = (143, 137, 124, 255)
MUTED = (242, 239, 231, 170)
FAINT = (242, 239, 231, 96)

# Only wording visibly used on the current website, plus the website address explicitly requested by the user.
WORDMARK = "DISORDER119"
KICKER = "Das kuratierte Archiv von"
EYEBROW = "Designer-, Vintage- und Contemporary-Pieces mit Fokus auf Qualität, Authentizität und Zeitlosigkeit"
BRANDLINE = "Prada · Dior · Saint Laurent · Jean Paul Gaultier · Y-3 · u.v.m."
DOMAIN = "disorder119.com"
COUNT = 36

PREFERRED = [
    6241,6240,6239,6238,6237,6236,6235,6234,6233,6232,6231,6230,
    6229,6228,6227,6226,6225,6224,6223,6222,6221,6220,6219,6218,
    6217,6216,6215,6214,6213,6212,6211,6210,6209,6208,6207,6206,
    9479,9378,9442,9362,9476,9475,9480,9463,9456,9432,9404,9401,9400,9365
]


def px(mm): return round(mm / MM * DPI)


def font(size_mm, bold=False, condensed=True):
    if condensed and bold:
        cands = [
            "/usr/share/fonts/truetype/liberation2/LiberationSansNarrow-Bold.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSansCondensed-Bold.ttf",
        ]
    elif condensed:
        cands = [
            "/usr/share/fonts/truetype/liberation2/LiberationSansNarrow-Regular.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSansCondensed.ttf",
        ]
    elif bold:
        cands = ["/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"]
    else:
        cands = ["/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"]
    for p in cands:
        if Path(p).exists(): return ImageFont.truetype(p, px(size_mm))
    return ImageFont.load_default()


def items():
    return json.loads((ROOT / "data/items.json").read_text(encoding="utf-8"))


def available(i):
    return i.get("public_status") == "AVAILABLE" or str(i.get("status", "")).lower() in {"verfügbar", "available"}


def img_path(i):
    p = i.get("look") or ((i.get("gallery") or [None])[0])
    if not p: return None
    src = ROOT / p
    if not src.exists(): return None
    display = src.parent / "display" / src.name
    return display if display.exists() else src


def choose(data):
    by_id = {int(i["id"]): i for i in data if "id" in i}
    chosen, seen = [], set()
    for pid in PREFERRED:
        i = by_id.get(pid)
        if i and available(i) and img_path(i):
            chosen.append(i); seen.add(pid)
            if len(chosen) == COUNT: break
    pool = [i for i in data if available(i) and img_path(i) and int(i.get("id", -1)) not in seen]
    while len(chosen) < COUNT and pool:
        brands = {x.get("brand") for x in chosen}
        cats = {x.get("taxonomy_category") or x.get("category") for x in chosen}
        pool.sort(key=lambda i: (
            5*(i.get("brand") not in brands)
            + 3*((i.get("taxonomy_category") or i.get("category")) not in cats)
            + min(float(i.get("price") or 0), 1000)/1000,
            int(i.get("id",0))
        ), reverse=True)
        chosen.append(pool.pop(0))
    if len(chosen) < COUNT: raise RuntimeError(f"Need {COUNT}, found {len(chosen)}")
    return chosen[:COUNT]


def crop_black(im):
    im = ImageOps.exif_transpose(im).convert("RGBA")
    rgb = im.convert("RGB")
    r,g,b = rgb.split()
    mx = ImageChops.lighter(ImageChops.lighter(r,g),b)
    mask = mx.point(lambda p: 255 if p > 7 else 0).filter(ImageFilter.MaxFilter(7))
    bb = mask.getbbox()
    if bb:
        x0,y0,x1,y1 = bb
        pad = max(6, int(max(x1-x0,y1-y0)*0.025))
        bb = (max(0,x0-pad), max(0,y0-pad), min(im.width,x1+pad), min(im.height,y1+pad))
        im = im.crop(bb)
    return im


def place(base, i, box, angle=0, alpha=255):
    x,y,w,h = [px(v) for v in box]
    im = crop_black(Image.open(img_path(i)))
    s = min(w/im.width, h/im.height)
    im = im.resize((max(1,round(im.width*s)), max(1,round(im.height*s))), Image.Resampling.LANCZOS)
    if alpha != 255:
        a = im.getchannel("A").point(lambda p: int(p*alpha/255)); im.putalpha(a)
    if angle:
        im = im.rotate(angle, expand=True, resample=Image.Resampling.BICUBIC)
    base.alpha_composite(im, (x+(w-im.width)//2, y+(h-im.height)//2))


def draw_spaced(d, x, y, text, f, fill=PAPER, tracking=0):
    if tracking <= 0:
        d.text((x,y), text, font=f, fill=fill)
        return
    pos=x
    for ch in text:
        d.text((pos,y), ch, font=f, fill=fill)
        pos += d.textlength(ch,font=f)+tracking


def qr_img(size_mm):
    qr=qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_H, box_size=12, border=4)
    qr.add_data("https://disorder119.com/"); qr.make(fit=True)
    q=qr.make_image(fill_color="black", back_color="white").convert("RGBA")
    s=px(size_mm); return q.resize((s,s),Image.Resampling.NEAREST)


def build_cover(products):
    base=Image.new("RGBA",(W,H),INK)
    d=ImageDraw.Draw(base)
    rng=random.Random(1192026)

    # Subtle spine and edge rules, matching the website's restrained rule system.
    d.rectangle((px(SPINE_L),0,px(SPINE_R),H),fill=(0,0,0,255))
    d.line((px(SPINE_L),0,px(SPINE_L),H),fill=(242,239,231,38),width=1)
    d.line((px(SPINE_R),0,px(SPINE_R),H),fill=(242,239,231,38),width=1)

    # Back: dense archive constellation, 22 products. Deliberately irregular but controlled.
    back_boxes=[
        (2,4,34,49),(34,13,28,43),(64,3,39,58),(102,16,29,43),(132,4,34,55),
        (10,57,33,50),(45,63,27,43),(74,55,42,60),(119,61,38,52),
        (3,114,41,59),(42,122,31,48),(76,113,35,55),(112,121,28,46),(139,112,27,56),
        (7,174,36,52),(39,183,31,45),(72,170,42,59),(116,181,34,47),(145,169,24,56),
        (21,215,31,27),(76,213,35,26),(130,213,31,27)
    ]
    for i,box in zip(products[:22],back_boxes):
        place(base,i,box,angle=rng.choice([-7,-5,-3,-2,0,2,3,5,7]))

    # Front: one commanding hero, four medium anchors, nine satellites = fashion-object rather than ad poster.
    place(base,products[22],(214,42,62,122),angle=-3)
    anchors=[(181,8,40,62),(279,9,48,68),(181,167,46,66),(284,168,44,62)]
    for i,box in zip(products[23:27],anchors): place(base,i,box,angle=rng.choice([-5,-3,2,4]))
    sats=[(224,5,27,42),(252,10,28,40),(298,78,34,52),(299,122,31,43),(183,93,33,47),(185,137,31,40),(233,181,28,44),(262,186,27,40),(251,151,31,38)]
    for i,box in zip(products[27:36],sats): place(base,i,box,angle=rng.choice([-7,-4,-2,2,4,6]))

    # Front wordmark: website-like, not stacked, not logo-ish. Asymmetric position with a generous black field.
    d.rectangle((px(215),px(80),px(302),px(145)),fill=(0,0,0,238))
    fk=font(2.3,bold=True,condensed=False)
    draw_spaced(d,px(219),px(84),KICKER.upper(),fk,fill=(242,239,231,125),tracking=px(.08))
    fw=font(17.0,bold=True,condensed=True)
    d.text((px(217),px(91)),WORDMARK,font=fw,fill=PAPER)
    fe=font(2.25,bold=False,condensed=False)
    # Website sentence, line-broken only for layout.
    lines=["Designer-, Vintage- und Contemporary-Pieces","mit Fokus auf Qualität, Authentizität","und Zeitlosigkeit"]
    yy=120
    for line in lines:
        d.text((px(219),px(yy)),line,font=fe,fill=(242,239,231,175)); yy+=5.4

    # Back QR block with only requested domain.
    d.rectangle((px(116),px(182),px(159),px(234)),fill=(0,0,0,245))
    q=qr_img(29); base.alpha_composite(q,(px(123),px(187)))
    fd=font(2.4,bold=True,condensed=True)
    d.text((px(121),px(219)),DOMAIN.upper(),font=fd,fill=PAPER)
    fb=font(1.95,bold=False,condensed=False)
    d.text((px(121),px(225)),BRANDLINE,font=fb,fill=(242,239,231,140))

    # Spine wordmark: simple and exact.
    strip=Image.new("RGBA",(px(103),px(SPINE_R-SPINE_L)),(0,0,0,0))
    sd=ImageDraw.Draw(strip); sf=font(3.6,bold=True,condensed=True)
    bb=sd.textbbox((0,0),WORDMARK,font=sf)
    sd.text(((strip.width-(bb[2]-bb[0]))/2,px(2.6)),WORDMARK,font=sf,fill=PAPER)
    strip=strip.rotate(90,expand=True,resample=Image.Resampling.BICUBIC)
    base.alpha_composite(strip,(px(SPINE_L)+(px(SPINE_R-SPINE_L)-strip.width)//2,(H-strip.height)//2))
    return base.convert("RGB")


def save_pdf(img,path,w_mm,h_mm):
    pt=72/25.4
    c=canvas.Canvas(str(path),pagesize=(w_mm*pt,h_mm*pt))
    c.drawImage(ImageReader(img),0,0,width=w_mm*pt,height=h_mm*pt,preserveAspectRatio=False)
    c.showPage(); c.save()


def build_bookmark(products):
    # Optional concept: 55x180 mm trim with 3 mm bleed on all sides = 61x186 mm data size.
    w_mm,h_mm=61,186
    w,h=px(w_mm),px(h_mm)
    b=Image.new("RGBA",(w,h),INK)
    d=ImageDraw.Draw(b)
    rng=random.Random(1197)
    boxes=[(-4,5,35,58),(26,17,32,53),(-2,70,34,58),(30,79,31,49),(3,128,34,53),(31,132,28,46)]
    for i,box in zip(products[:6],boxes): place(b,i,box,angle=rng.choice([-6,-4,3,5]))
    d.rectangle((px(8),px(66),px(54),px(122)),fill=(0,0,0,235))
    fw=font(6.7,bold=True,condensed=True)
    d.text((px(10),px(72)),WORDMARK,font=fw,fill=PAPER)
    q=qr_img(23); b.alpha_composite(q,(px(19),px(88)))
    fd=font(1.9,bold=True,condensed=True); d.text((px(14),px(114)),DOMAIN.upper(),font=fd,fill=PAPER)
    return b.convert("RGB"),w_mm,h_mm


def main():
    selected=choose(items())
    cover=build_cover(selected)
    png=OUT/"Disorder119_Perfektes_Werbegeschenk_A5_Notizbuch_344.5x245mm_300dpi.png"
    pdf=OUT/"Disorder119_Perfektes_Werbegeschenk_A5_Notizbuch_344.5x245mm_Print.pdf"
    preview=OUT/"Disorder119_Perfektes_Werbegeschenk_A5_Notizbuch_preview.png"
    front=OUT/"Disorder119_Perfektes_Werbegeschenk_Vorderseite_preview.png"
    back=OUT/"Disorder119_Perfektes_Werbegeschenk_Rueckseite_preview.png"
    cover.save(png,dpi=(DPI,DPI),optimize=True)
    save_pdf(cover,pdf,W_MM,H_MM)
    cover.resize((round(W*.28),round(H*.28)),Image.Resampling.LANCZOS).save(preview,optimize=True)
    # Cropped trim panels for easy judgement; previews only.
    y0,y1=px(15),px(230)
    cover.crop((px(BACK_L),y0,px(BACK_R),y1)).resize((608,860),Image.Resampling.LANCZOS).save(back,optimize=True)
    cover.crop((px(FRONT_L),y0,px(FRONT_R),y1)).resize((608,860),Image.Resampling.LANCZOS).save(front,optimize=True)

    bookmark,bw,bh=build_bookmark(selected[8:14])
    bmpng=OUT/"Disorder119_Bookmark_Konzept_61x186mm_300dpi.png"
    bmpdf=OUT/"Disorder119_Bookmark_Konzept_61x186mm.pdf"
    bookmark.save(bmpng,dpi=(DPI,DPI),optimize=True); save_pdf(bookmark,bmpdf,bw,bh)

    manifest=OUT/"verwendete_originalartikel.txt"
    manifest.write_text("\n".join(f"{n:02d}. {i['id']} | {i.get('brand','')} | {i.get('title','')} | {img_path(i).relative_to(ROOT)}" for n,i in enumerate(selected,1)),encoding="utf-8")
    print(f"Built cover {W}x{H} @ {DPI}dpi with {len(selected)} real catalogue products")

if __name__=="__main__": main()

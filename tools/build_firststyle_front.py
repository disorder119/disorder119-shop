from __future__ import annotations

import json
import random
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageOps
import qrcode

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "out_firststyle"
OUT.mkdir(exist_ok=True)

DPI = 300
MM = 25.4
W_MM, H_MM = 152.0, 215.0
W = round(W_MM / MM * DPI)
H = round(H_MM / MM * DPI)

BLACK = (0, 0, 0)
PAPER = (242, 239, 231)
MUTED = (185, 181, 171)

PREFERRED = [6241,6239,6237,6236,6235,6231,6229,6227,6225,6223,6221,6218,6217,6215,6213,6211,6209,6208,6205,6204,9479,9378,9442,9362,9476,9456,9432,9404,9401,9365]
COUNT = 24


def mm(v):
    return round(v / MM * DPI)


def font(size_mm, bold=False, condensed=False):
    candidates=[]
    if condensed and bold:
        candidates=["/usr/share/fonts/truetype/dejavu/DejaVuSansCondensed-Bold.ttf","/usr/share/fonts/truetype/liberation2/LiberationSansNarrow-Bold.ttf"]
    elif condensed:
        candidates=["/usr/share/fonts/truetype/dejavu/DejaVuSansCondensed.ttf","/usr/share/fonts/truetype/liberation2/LiberationSansNarrow-Regular.ttf"]
    elif bold:
        candidates=["/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"]
    else:
        candidates=["/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"]
    for p in candidates:
        if Path(p).exists():
            return ImageFont.truetype(p, mm(size_mm))
    return ImageFont.load_default()


def load_items():
    return json.loads((ROOT / "data/items.json").read_text(encoding="utf-8"))


def available(i):
    return i.get("public_status") == "AVAILABLE" or str(i.get("status", "")).lower() in {"verfügbar","available"}


def img_path(i):
    p = i.get("look") or ((i.get("gallery") or [None])[0])
    if not p:
        return None
    src = ROOT / p
    if not src.exists():
        return None
    display = src.parent / "display" / src.name
    return display if display.exists() else src


def choose(items):
    by_id={int(i["id"]):i for i in items if "id" in i}
    chosen=[]; seen=set()
    for pid in PREFERRED:
        i=by_id.get(pid)
        if i and available(i) and img_path(i):
            chosen.append(i); seen.add(pid)
            if len(chosen)>=COUNT: break
    pool=[i for i in items if available(i) and img_path(i) and int(i.get("id",-1)) not in seen]
    while len(chosen)<COUNT and pool:
        brands={x.get("brand") for x in chosen}
        cats={x.get("taxonomy_category") or x.get("category") for x in chosen}
        pool.sort(key=lambda i:(5*(i.get("brand") not in brands)+3*((i.get("taxonomy_category") or i.get("category")) not in cats)+min(float(i.get("price") or 0),1000)/1000,int(i.get("id",0))),reverse=True)
        chosen.append(pool.pop(0))
    return chosen[:COUNT]


def content_crop(im):
    im=ImageOps.exif_transpose(im).convert("RGB")
    # Shop photos use black backgrounds. Find the bounding box of pixels not close to black,
    # but keep the original black background so black garments are not damaged.
    gray=im.convert("L")
    mask=gray.point(lambda p: 255 if p>12 else 0)
    bb=mask.getbbox()
    if not bb:
        return im
    x0,y0,x1,y1=bb
    pad=max(8,int(max(x1-x0,y1-y0)*0.035))
    return im.crop((max(0,x0-pad),max(0,y0-pad),min(im.width,x1+pad),min(im.height,y1+pad)))


def paste_product(base, item, box_mm, angle=0):
    x,y,bw,bh=[mm(v) for v in box_mm]
    im=content_crop(Image.open(img_path(item)))
    scale=min(bw/im.width,bh/im.height)
    im=im.resize((max(1,round(im.width*scale)),max(1,round(im.height*scale))),Image.Resampling.LANCZOS)
    if angle:
        im=im.rotate(angle,expand=True,resample=Image.Resampling.BICUBIC,fillcolor=BLACK)
    px=x+(bw-im.width)//2
    py=y+(bh-im.height)//2
    base.paste(im,(px,py))


def centered(draw,text,cx,y,font_obj,fill=PAPER):
    bb=draw.textbbox((0,0),text,font=font_obj)
    draw.text((cx-(bb[2]-bb[0])/2,y),text,font=font_obj,fill=fill)


def main():
    html=(ROOT/"index.html").read_text(encoding="utf-8")
    for required in ["Disorder119","Das kuratierte Archiv von","https://disorder119.com/"]:
        if required not in html:
            raise RuntimeError(f"Required current website text missing: {required}")

    products=choose(load_items())
    if len(products)<COUNT:
        raise RuntimeError(f"Need {COUNT} products, found {len(products)}")

    base=Image.new("RGB",(W,H),BLACK)
    rng=random.Random(119)

    # 24 real shop products, arranged like the earliest concept: big negative-space center,
    # a few large cropped anchors, and many smaller floating pieces around the perimeter.
    boxes=[
        (-3,12,38,61), (15,2,24,38), (112,5,35,47), (123,46,30,45),
        (2,70,31,43), (119,91,31,44), (0,119,35,48), (120,135,34,47),
        (-7,161,43,58), (110,159,49,60),
        (37,7,20,31), (96,19,21,32), (36,47,20,30), (100,58,19,30),
        (29,100,18,28), (108,113,19,29), (34,144,20,31), (98,149,20,31),
        (42,176,19,27), (89,180,20,28), (4,41,18,25), (132,16,17,25),
        (8,196,24,20), (126,194,24,20),
    ]
    angles=[-3,2,-4,2,2,-2,-4,3,-6,4, 2,-3,-2,3,-4,2,3,-2,-3,2,4,-4,-2,3]
    for item,box,angle in zip(products,boxes,angles):
        paste_product(base,item,box,angle)

    draw=ImageDraw.Draw(base)
    # Quiet central black field, preserving the original poster-like feel.
    draw.rectangle((mm(42),mm(55),mm(111),mm(172)),fill=BLACK)

    # Stacked typographic treatment from the first concept, but using only the actual site name.
    f_big=font(22.5,bold=True,condensed=True)
    f_big2=font(20.7,bold=True,condensed=True)
    f_small=font(2.25,bold=True,condensed=False)
    f_domain=font(2.25,bold=True,condensed=True)
    cx=mm(76.5)
    centered(draw,"DIS",cx,mm(64),f_big)
    centered(draw,"ORDER",cx,mm(91),f_big2)
    centered(draw,"119",cx,mm(120),f_big)
    centered(draw,"DAS KURATIERTE ARCHIV VON",cx,mm(151.5),f_small,fill=MUTED)

    # QR code and exact requested website address, both kept small and secondary.
    qr=qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_H,box_size=10,border=3)
    qr.add_data("https://disorder119.com/")
    qr.make(fit=True)
    q=qr.make_image(fill_color="black",back_color="white").convert("RGB")
    qsize=mm(16)
    q=q.resize((qsize,qsize),Image.Resampling.NEAREST)
    qx=cx-qsize//2
    qy=mm(166.5)
    base.paste(q,(qx,qy))
    draw=ImageDraw.Draw(base)
    centered(draw,"DISORDER119.COM",cx,mm(184.5),f_domain,fill=PAPER)

    out=OUT/"Disorder119_FirstStyle_Front_152x215mm_300dpi.png"
    base.save(out,dpi=(DPI,DPI),optimize=True)
    preview=OUT/"Disorder119_FirstStyle_Front_preview.png"
    base.resize((900,round(900*H/W)),Image.Resampling.LANCZOS).save(preview,optimize=True)
    manifest=OUT/"used_products.txt"
    manifest.write_text("\n".join(f"{i['id']} | {i.get('brand','')} | {i.get('title','')}" for i in products),encoding="utf-8")
    print(out)

if __name__=="__main__":
    main()

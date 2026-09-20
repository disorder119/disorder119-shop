from __future__ import annotations

import json, random
from collections import deque
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps
import qrcode

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "out_original_cover_v4"
OUT.mkdir(exist_ok=True)

DPI = 300
MM_PER_INCH = 25.4
W_MM, H_MM = 344.5, 245.0
W = round(W_MM / MM_PER_INCH * DPI)
H = round(H_MM / MM_PER_INCH * DPI)

# Supplied print template: 15 mm wrap + 152 mm back + 10.5 mm spine + 152 mm front + 15 mm wrap
BACK_L, BACK_R = 15.0, 167.0
SPINE_L, SPINE_R = 167.0, 177.5
FRONT_L, FRONT_R = 177.5, 329.5

BLACK=(0,0,0,255)
WHITE=(245,245,242,255)
RULE=(255,255,255,45)

PREFERRED_IDS = [
  6241,6240,6239,6238,6237,6236,6235,6234,6233,6232,6231,6230,6229,6228,6227,
  6226,6225,6224,6223,6222,6221,6220,6219,6218,6217,6216,6215,6214,6213,6212,
  6211,6210,6209,6208,6207,6206,6205,6204,6203,6202,6201,6200,9479,9378,9442,
  9362,9476,9475,9480,9463,9456,9432,9404,9401,9400,9365
]
COUNT=40


def mm(v:float)->int:
    return round(v / MM_PER_INCH * DPI)


def font(size_mm:float,bold=False,narrow=False):
    cand=[]
    if narrow and bold:
        cand += ["/usr/share/fonts/truetype/liberation2/LiberationSansNarrow-Bold.ttf","/usr/share/fonts/truetype/dejavu/DejaVuSansCondensed-Bold.ttf"]
    elif narrow:
        cand += ["/usr/share/fonts/truetype/liberation2/LiberationSansNarrow-Regular.ttf","/usr/share/fonts/truetype/dejavu/DejaVuSansCondensed.ttf"]
    elif bold:
        cand += ["/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"]
    else:
        cand += ["/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"]
    for p in cand:
        if Path(p).exists(): return ImageFont.truetype(p,mm(size_mm))
    return ImageFont.load_default()


def load_items():
    return json.loads((ROOT/"data/items.json").read_text(encoding="utf-8"))


def available(i):
    return i.get("public_status")=="AVAILABLE" or str(i.get("status","")).lower() in {"verfügbar","available"}


def src_path(i):
    p=i.get("look") or ((i.get("gallery") or [None])[0])
    if not p: return None
    path=ROOT/p
    return path if path.exists() else None


def choose(items):
    byid={int(i["id"]):i for i in items if "id" in i}
    chosen=[]; used=set()
    for pid in PREFERRED_IDS:
        i=byid.get(pid)
        if i and available(i) and src_path(i):
            chosen.append(i); used.add(pid)
            if len(chosen)>=COUNT: return chosen
    pool=[i for i in items if available(i) and src_path(i) and int(i.get("id",-1)) not in used]
    while len(chosen)<COUNT and pool:
        brands={x.get("brand") for x in chosen}; cats={x.get("taxonomy_category") or x.get("category") for x in chosen}
        pool.sort(key=lambda i:(5*(i.get("brand") not in brands)+3*((i.get("taxonomy_category") or i.get("category")) not in cats), int(i.get("id",0))), reverse=True)
        chosen.append(pool.pop(0))
    return chosen[:COUNT]


def remove_connected_black_background(path:Path)->Image.Image:
    """Remove only near-black pixels connected to the image border.
    Product pixels are not recolored. Dark garments inside the silhouette are preserved.
    """
    im=ImageOps.exif_transpose(Image.open(path)).convert("RGBA")
    rgb=im.convert("RGB")
    w,h=rgb.size
    pix=rgb.load()
    seen=bytearray(w*h)
    q=deque()

    def near_bg(x,y):
        r,g,b=pix[x,y]
        # repository product shots use a very dark/black studio background
        return max(r,g,b) <= 26 and (max(r,g,b)-min(r,g,b)) <= 16
    def push(x,y):
        idx=y*w+x
        if seen[idx] or not near_bg(x,y): return
        seen[idx]=1; q.append((x,y))

    for x in range(w):
        push(x,0); push(x,h-1)
    for y in range(h):
        push(0,y); push(w-1,y)
    while q:
        x,y=q.popleft()
        if x>0: push(x-1,y)
        if x+1<w: push(x+1,y)
        if y>0: push(x,y-1)
        if y+1<h: push(x,y+1)

    rgba=im.load()
    # transparent background, with a 1px soft fringe by lowering alpha on adjacent very dark pixels
    for y in range(h):
        base=y*w
        for x in range(w):
            if seen[base+x]: rgba[x,y]=(rgba[x,y][0],rgba[x,y][1],rgba[x,y][2],0)
    # crop transparent margins only; original product RGB values stay untouched
    bb=im.getbbox()
    if bb: im=im.crop(bb)
    return im


def fit(im:Image.Image,bw:int,bh:int):
    s=min(bw/im.width,bh/im.height)
    return im.resize((max(1,round(im.width*s)),max(1,round(im.height*s))),Image.Resampling.LANCZOS)


def place(base:Image.Image,item,box,angle=0):
    x,y,bw,bh=[mm(v) for v in box]
    im=remove_connected_black_background(src_path(item))
    im=fit(im,bw,bh)
    if angle: im=im.rotate(angle,expand=True,resample=Image.Resampling.BICUBIC)
    base.alpha_composite(im,(x+(bw-im.width)//2,y+(bh-im.height)//2))


def qr_code(size_mm=29):
    qr=qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_H,box_size=12,border=4)
    qr.add_data("https://disorder119.com/"); qr.make(fit=True)
    q=qr.make_image(fill_color="black",back_color="white").convert("RGBA")
    s=mm(size_mm)
    return q.resize((s,s),Image.Resampling.NEAREST)


def draw_center(draw,text,cx_mm,y_mm,size_mm,bold=True,narrow=True):
    f=font(size_mm,bold,narrow)
    b=draw.textbbox((0,0),text,font=f)
    draw.text((mm(cx_mm)-(b[2]-b[0])/2,mm(y_mm)),text,font=f,fill=WHITE)


def draw_title_free(base,cx=253.5,y=73,scale=1.0):
    d=ImageDraw.Draw(base)
    draw_center(d,"DIS",cx,y,20*scale,True,True)
    draw_center(d,"ORDER",cx,y+28*scale,18.7*scale,True,True)
    draw_center(d,"119",cx,y+55*scale,20.5*scale,True,True)


def spine(base):
    d=ImageDraw.Draw(base)
    d.rectangle((mm(SPINE_L),0,mm(SPINE_R),H),fill=BLACK)
    d.line((mm(SPINE_L),0,mm(SPINE_L),H),fill=RULE,width=2)
    d.line((mm(SPINE_R),0,mm(SPINE_R),H),fill=RULE,width=2)
    f=font(3.3,True,True)
    strip=Image.new("RGBA",(mm(92),mm(8)),(0,0,0,0)); sd=ImageDraw.Draw(strip)
    t="DISORDER119"; b=sd.textbbox((0,0),t,font=f); sd.text(((strip.width-(b[2]-b[0]))/2,0),t,font=f,fill=WHITE)
    strip=strip.rotate(90,expand=True,resample=Image.Resampling.BICUBIC)
    sw=mm(SPINE_R-SPINE_L); base.alpha_composite(strip,(mm(SPINE_L)+(sw-strip.width)//2,(H-strip.height)//2))


def back_qr(base,x=111,y=196):
    q=qr_code(28); base.alpha_composite(q,(mm(x),mm(y)))
    d=ImageDraw.Draw(base); f=font(2.25,True,True); text="DISORDER119.COM"
    b=d.textbbox((0,0),text,font=f); d.text((mm(x+14)-(b[2]-b[0])/2,mm(y+31)),text,font=f,fill=WHITE)


def canvas():
    b=Image.new("RGBA",(W,H),BLACK); spine(b); return b


def v1(products):
    # Closest to the first concept: balanced constellation, free-standing title, dense back.
    b=canvas(); rng=random.Random(11901)
    back=[(4,4,32,48),(38,10,29,42),(70,3,34,52),(106,12,28,44),(136,3,30,49),
          (5,60,30,46),(39,56,31,50),(73,63,28,43),(105,57,34,52),(138,62,28,45),
          (3,116,34,51),(40,120,30,47),(72,112,33,53),(108,123,28,45),(138,114,29,53),
          (7,174,34,48),(43,180,28,43),(75,171,34,51),(111,181,28,41),(139,170,28,52)]
    for i,box in zip(products[:20],back): place(b,i,box,rng.choice([-5,-3,-2,0,2,3,5]))
    front=[(182,9,38,59),(294,8,35,55),(183,76,32,48),(302,69,29,47),(183,140,35,53),(298,139,31,51),(184,190,36,40),(294,187,34,44),(222,11,30,45),(265,184,26,39),(275,20,27,41),(217,178,29,43)]
    for i,box in zip(products[20:32],front): place(b,i,box,rng.choice([-4,-2,0,2,4]))
    draw_title_free(b,254,78,1.0); back_qr(b,113,195)
    return b


def v2(products):
    # More premium: larger pieces and more black breathing room on the front.
    b=canvas(); rng=random.Random(11902)
    back=[]
    for r in range(4):
        for c in range(5):
            back.append((3+c*32+rng.uniform(-3,3),4+r*56+rng.uniform(-4,4),30+rng.uniform(-2,4),46+rng.uniform(-3,6)))
    for i,box in zip(products[:20],back): place(b,i,box,rng.choice([-6,-3,0,3,6]))
    front=[(180,5,42,72),(292,9,38,63),(181,165,45,67),(291,164,39,67),(217,8,34,54),(267,11,30,49),(182,86,31,49),(301,84,30,49),(219,180,31,45),(263,183,29,43)]
    for i,box in zip(products[20:30],front): place(b,i,box,rng.choice([-4,-2,0,2,4]))
    draw_title_free(b,255,76,1.04); back_qr(b,115,197)
    return b


def v3(products):
    # Editorial ring around typography; asymmetric but controlled.
    b=canvas(); rng=random.Random(11903)
    back=[]
    for k in range(22):
        w=rng.uniform(24,35); h=rng.uniform(38,54); x=rng.uniform(2,165-w); y=rng.uniform(2,225-h)
        back.append((x,y,w,h))
    for i,box in zip(products[:22],back): place(b,i,box,rng.choice([-8,-5,-3,0,3,5,8]))
    front=[(180,4,37,59),(216,1,31,49),(293,4,38,60),(306,68,27,43),(304,132,29,46),(292,181,38,48),(254,191,28,40),(215,184,31,44),(179,180,38,50),(178,125,30,46),(179,65,30,46),(274,11,27,44)]
    for i,box in zip(products[22:34],front): place(b,i,box,rng.choice([-6,-3,-1,1,3,6]))
    draw_title_free(b,255,80,.96); back_qr(b,111,196)
    return b


def v4(products):
    # Deliberately playful: varied scales, slight overlaps, no background boxes.
    b=canvas(); rng=random.Random(11904)
    back=[(0,2,40,62),(30,8,29,45),(58,0,38,58),(92,13,30,45),(124,0,42,63),(4,61,31,48),(35,66,37,56),(73,58,28,43),(102,63,38,57),(139,68,27,43),(0,120,42,62),(37,114,30,47),(69,127,35,52),(106,116,30,46),(136,120,31,49),(5,182,34,47),(42,174,31,51),(75,184,29,42),(106,176,36,52),(140,182,27,43)]
    for i,box in zip(products[:20],back): place(b,i,box,rng.choice([-9,-6,-3,0,3,6,9]))
    front=[(176,0,49,78),(293,3,43,67),(176,161,50,75),(293,166,42,68),(216,4,34,51),(267,2,31,48),(180,82,30,46),(305,80,29,45),(218,181,30,45),(263,186,29,41),(303,120,29,45),(183,125,29,44)]
    for i,box in zip(products[20:32],front): place(b,i,box,rng.choice([-7,-4,-2,0,2,4,7]))
    draw_title_free(b,255,77,1.02); back_qr(b,114,197)
    return b

VARIANTS=[("01_BALANCED",v1),("02_PREMIUM",v2),("03_EDITORIAL_RING",v3),("04_PLAYFUL",v4)]


def main():
    products=choose(load_items())
    if len(products)<34: raise RuntimeError(f"Only {len(products)} usable products")
    previews=[]
    for name,fn in VARIANTS:
        img=fn(products).convert("RGB")
        full=OUT/f"Disorder119_{name}_344.5x245mm_300dpi.png"
        prev=OUT/f"Disorder119_{name}_preview.png"
        img.save(full,dpi=(DPI,DPI),optimize=True)
        p=img.resize((1600,round(1600*H/W)),Image.Resampling.LANCZOS)
        p.save(prev,optimize=True)
        previews.append((name,p))
    # contact sheet
    tw,th=800,round(800*H/W); gap=30; label=45
    sheet=Image.new("RGB",(tw*2+gap*3,(th+label)*2+gap*3),(22,22,22)); d=ImageDraw.Draw(sheet); f=font(3.0,True,True)
    for n,(name,p) in enumerate(previews):
        r=n//2;c=n%2;x=gap+c*(tw+gap);y=gap+r*(th+label+gap)
        t=p.resize((tw,th),Image.Resampling.LANCZOS);sheet.paste(t,(x,y));d.text((x,y+th+10),name,font=f,fill=(245,245,242))
    sheet.save(OUT/"Disorder119_4_Originalasset_Entwuerfe_Uebersicht.png",optimize=True)
    (OUT/"verwendete_originalartikel.txt").write_text("\n".join(f"{n:02d}. {i['id']} | {i.get('brand','')} | {i.get('title','')} | {src_path(i).relative_to(ROOT)}" for n,i in enumerate(products,1)),encoding="utf-8")
    print(f"Built 4 variants from {len(products)} current original repository product photos. No color transformations applied.")

if __name__=="__main__": main()

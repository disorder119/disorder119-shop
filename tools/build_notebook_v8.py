from __future__ import annotations

import colorsys, json, random
from collections import deque
from functools import lru_cache
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps
import qrcode

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "out_notebook_v8"
OUT.mkdir(exist_ok=True)

DPI = 300
MM = 25.4
W_MM, H_MM = 344.5, 245.0
W = round(W_MM / MM * DPI)
H = round(H_MM / MM * DPI)

# supplied hardcover spread: 15 + 152 + 10.5 + 152 + 15 mm
BACK_L, BACK_R = 15.0, 167.0
SPINE_L, SPINE_R = 167.0, 177.5
FRONT_L, FRONT_R = 177.5, 329.5
BLACK = (0,0,0,255)
PAPER = (242,239,231,255)

PREFERRED = [
  6241,6240,6239,6238,6237,6236,6235,6234,6233,6232,6231,6230,6229,6228,6227,
  6226,6225,6224,6223,6222,6221,6220,6219,6218,6217,6216,6215,6214,6213,6212,
  6211,6210,6209,6208,6207,6206,6205,6204,6203,6202,6201,6200,6199,6198,6197,
  6196,6195,6194,6193,6192,6191,6190,6189,6188,6187,6186,6185,6184,6183,6182,
  6042,9523,9526,9525,9519,9531,9536,9527,9535,9534,9524,9533,9522,9521,9520,
  9518,9532,9517,9516,9515,9514,9513,9538,9512,9511,9530,9529,9510,9509,9508,
  9528,9507,9500,9479,9476,9475,9463,9456,9442,9432,9404,9401,9400,9378,9365,9362
]


def mm(v): return round(v / MM * DPI)


def font(size_mm, bold=True):
    paths = [
      "/usr/share/fonts/truetype/liberation2/LiberationSansNarrow-Bold.ttf" if bold else "/usr/share/fonts/truetype/liberation2/LiberationSansNarrow-Regular.ttf",
      "/usr/share/fonts/truetype/dejavu/DejaVuSansCondensed-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSansCondensed.ttf",
    ]
    for p in paths:
        if Path(p).exists(): return ImageFont.truetype(p, mm(size_mm))
    return ImageFont.load_default()


def load_items(): return json.loads((ROOT/"data/items.json").read_text(encoding="utf-8"))

def available(i): return i.get("public_status") == "AVAILABLE" or str(i.get("status","")).lower() in {"verfügbar","available"}

def src(i):
    p = i.get("look") or ((i.get("gallery") or [None])[0])
    if not p: return None
    q = ROOT/p
    return q if q.exists() else None


def pool(items):
    byid = {int(i["id"]):i for i in items if "id" in i}
    out=[]; used=set()
    for pid in PREFERRED:
        i=byid.get(pid)
        if i and available(i) and src(i): out.append(i); used.add(pid)
    for i in items:
        pid=int(i.get("id",-1))
        if pid not in used and available(i) and src(i): out.append(i)
    return out


@lru_cache(maxsize=512)
def tone(path_str):
    im=Image.open(path_str).convert("RGB"); im.thumbnail((100,100))
    pts=[]
    for r,g,b in im.getdata():
        if max(r,g,b) < 28: continue
        pts.append((r,g,b))
    if not pts: return "dark"
    r=sum(x[0] for x in pts)/len(pts)/255; g=sum(x[1] for x in pts)/len(pts)/255; b=sum(x[2] for x in pts)/len(pts)/255
    h,s,v=colorsys.rgb_to_hsv(r,g,b)
    if v < .38: return "dark"
    if s < .17 and v > .65: return "light"
    if s < .23: return "neutral"
    if .045 <= h <= .18: return "earth"
    if .18 < h <= .46: return "olive"
    if h < .045 or h > .95: return "warm"
    return "other"


def cat(i): return i.get("taxonomy_category") or i.get("category") or ""


def choose(p, n, seed, palette=("dark","light","earth","olive","neutral"), avoid_bright=True):
    rng=random.Random(seed); chosen=[]; ids=set(); brands=set(); cats=set()
    candidates=list(p)
    for _ in range(n):
        scored=[]
        for i in candidates:
            pid=int(i.get("id",-1))
            if pid in ids: continue
            t=tone(str(src(i)))
            if avoid_bright and t in {"warm","other"}: pal=-3
            else:
                pal = 5 if t in palette else 0
            score = pal + (2.5 if (i.get("brand") or "") not in brands else 0) + (2 if cat(i) not in cats else 0) + rng.random()
            scored.append((score,i))
        if not scored: break
        scored.sort(key=lambda x:x[0], reverse=True)
        i=scored[0][1]
        chosen.append(i); ids.add(int(i["id"])); brands.add(i.get("brand") or ""); cats.add(cat(i))
    return chosen


@lru_cache(maxsize=256)
def cutout(path_str):
    # preserve product RGB exactly; remove only near-black background connected to image edges
    im=ImageOps.exif_transpose(Image.open(path_str)).convert("RGBA")
    rgb=im.convert("RGB"); w,h=rgb.size; px=rgb.load(); seen=bytearray(w*h); q=deque()
    def bg(x,y):
        r,g,b=px[x,y]; return max(r,g,b)<=26 and max(r,g,b)-min(r,g,b)<=16
    def push(x,y):
        j=y*w+x
        if seen[j] or not bg(x,y): return
        seen[j]=1; q.append((x,y))
    for x in range(w): push(x,0); push(x,h-1)
    for y in range(h): push(0,y); push(w-1,y)
    while q:
        x,y=q.popleft()
        if x>0: push(x-1,y)
        if x+1<w: push(x+1,y)
        if y>0: push(x,y-1)
        if y+1<h: push(x,y+1)
    rp=im.load()
    for y in range(h):
        base=y*w
        for x in range(w):
            if seen[base+x]:
                r,g,b,a=rp[x,y]; rp[x,y]=(r,g,b,0)
    bb=im.getbbox()
    return im.crop(bb) if bb else im


def place(base,item,box,angle=0):
    x,y,bw,bh=[mm(v) for v in box]
    im=cutout(str(src(item))).copy()
    s=min(bw/im.width,bh/im.height)
    im=im.resize((max(1,round(im.width*s)),max(1,round(im.height*s))),Image.Resampling.LANCZOS)
    if angle: im=im.rotate(angle,expand=True,resample=Image.Resampling.BICUBIC)
    base.alpha_composite(im,(x+(bw-im.width)//2,y+(bh-im.height)//2))


def logo(base,cx,y,scale=1.0,offset=0):
    # three-line free-standing mark inspired by the user's preferred first concept
    d=ImageDraw.Draw(base)
    specs=[("DIS",19.5,0), ("ORDER",18.2,24.0), ("119",21.5,49.0)]
    for text,sz,dy in specs:
        f=font(sz*scale,True); bb=d.textbbox((0,0),text,font=f)
        x=mm(cx+offset*(dy/49.0))-(bb[2]-bb[0])/2
        d.text((x,mm(y+dy*scale)),text,font=f,fill=PAPER)


def qr_block(base,x,y,size=28):
    q=qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_H,box_size=12,border=4)
    q.add_data("https://disorder119.com/"); q.make(fit=True)
    im=q.make_image(fill_color="black",back_color="white").convert("RGBA")
    s=mm(size); im=im.resize((s,s),Image.Resampling.NEAREST); base.alpha_composite(im,(mm(x),mm(y)))
    d=ImageDraw.Draw(base); text="DISORDER119.COM"; f=font(2.15,True); bb=d.textbbox((0,0),text,font=f)
    d.text((mm(x+size/2)-(bb[2]-bb[0])/2,mm(y+size+2.3)),text,font=f,fill=PAPER)


def render(name, selected, front_boxes, front_angles, back_boxes, back_angles, logo_args, qr_args):
    base=Image.new("RGBA",(W,H),BLACK)
    # spine: pure black, absolutely no type
    ImageDraw.Draw(base).rectangle((mm(SPINE_L),0,mm(SPINE_R),H),fill=BLACK)
    nf=len(front_boxes)
    for i,b,a in zip(selected[:nf],front_boxes,front_angles): place(base,i,b,a)
    for i,b,a in zip(selected[nf:nf+len(back_boxes)],back_boxes,back_angles): place(base,i,b,a)
    logo(base,*logo_args); qr_block(base,*qr_args)
    img=base.convert("RGB")
    prev=OUT/f"{name}_preview.png"; full=OUT/f"{name}_344.5x245mm_300dpi.png"
    img.save(full,dpi=(DPI,DPI),optimize=True)
    img.resize((1800,round(1800*H/W)),Image.Resampling.LANCZOS).save(prev,optimize=True)
    return prev


def main():
    p=pool(load_items())
    if len(p)<30: raise RuntimeError("not enough current shop products")
    variants=[]

    # A: balanced halo around a strong central mark. 6 front pieces, 12 back pieces.
    sel=choose(p,18,8101)
    front=[(183,12,40,64),(296,12,32,52),(181,154,38,60),(297,154,31,58),(218,12,30,47),(266,180,31,42)]
    back=[(20,12,34,54),(65,10,31,47),(109,14,31,49),(135,66,28,44),(18,77,32,48),(58,74,31,48),(98,78,31,47),(20,140,31,47),(61,138,31,49),(101,143,31,46),(135,143,29,45),(61,194,32,38)]
    variants.append(render("V8A_EDITORIAL_HALO",sel,front,[-3,2,2,-2,1,2],back,[-2,2,-2,2,2,-2,3,-2,2,-2,2,0],(255,79,1.03,0),(111,196,28)))

    # B: asymmetrical orbit, more movement but controlled palette.
    sel=choose(p,19,8102)
    front=[(180,8,41,66),(296,18,33,53),(183,148,37,61),(299,146,31,57),(218,6,29,46),(270,10,28,45),(268,185,30,38)]
    back=[(18,9,33,51),(57,18,29,45),(96,7,34,53),(132,20,30,45),(21,77,30,48),(61,70,31,50),(101,81,29,44),(132,83,29,43),(17,140,34,50),(57,146,29,43),(96,136,34,51),(132,149,29,42)]
    variants.append(render("V8B_ASYMMETRIC_ORBIT",sel,front,[-5,2,3,-3,2,-2,3],back,[-4,3,-2,4,2,-3,3,-2,-3,2,-2,3],(252,82,.98,-5),(112,197,28)))

    # C: premium poster: fewer, bigger objects and maximum black space.
    sel=choose(p,16,8103)
    front=[(181,8,44,72),(294,8,37,61),(182,165,45,65),(294,166,37,62),(221,9,29,45)]
    back=[(20,13,38,58),(68,10,35,53),(117,13,36,56),(21,84,34,53),(68,81,35,55),(117,86,35,52),(22,151,36,54),(70,151,34,51),(116,153,36,53),(70,205,31,29),(126,207,27,27)]
    variants.append(render("V8C_PREMIUM_POSTER",sel,front,[-2,2,2,-2,1],back,[-2,2,-2,2,-2,2,-2,2,-2,0,0],(255,83,1.07,0),(111,198,28)))

    # D: closest to the original Spotify-like feeling, but with real shop objects only.
    sel=choose(p,18,8104)
    front=[(182,9,38,62),(297,9,32,53),(184,155,36,59),(298,153,31,58),(218,11,30,47),(268,12,29,45)]
    back=[(18,11,32,50),(58,9,31,48),(99,12,31,49),(134,10,29,47),(19,75,31,48),(59,77,31,47),(100,73,31,49),(134,77,29,44),(18,141,32,49),(60,140,31,48),(101,143,31,46),(134,143,29,45)]
    variants.append(render("V8D_FIRST_CONCEPT_REFINED",sel,front,[-2,2,2,-2,1,-1],back,[-2,2,-2,2,2,-2,2,-2,-2,2,-2,2],(255,78,1.05,0),(111,196,28)))

    # contact sheet
    thumbs=[]
    for pth in variants:
        im=Image.open(pth).convert("RGB")
        thumbs.append(im)
    tw=900; th=round(tw*H/W); gap=28; label=48
    sheet=Image.new("RGB",(tw*2+gap*3,(th+label)*2+gap*3),(18,18,18)); d=ImageDraw.Draw(sheet); lf=font(4.0,True)
    names=["V8A EDITORIAL HALO","V8B ASYMMETRIC ORBIT","V8C PREMIUM POSTER","V8D FIRST CONCEPT REFINED"]
    for n,(im,name) in enumerate(zip(thumbs,names)):
        r=n//2;c=n%2;x=gap+c*(tw+gap);y=gap+r*(th+label+gap)
        sheet.paste(im.resize((tw,th),Image.Resampling.LANCZOS),(x,y)); d.text((x,y+th+7),name,font=lf,fill=(242,239,231))
    sheet.save(OUT/"Disorder119_V8_4_Entwuerfe_Uebersicht.png",optimize=True)

    (OUT/"manifest.txt").write_text("Built only from current AVAILABLE products in data/items.json. Original RGB is preserved; only edge-connected near-black studio background is made transparent. Spine is pure black; QR + DISORDER119.COM are on back only.\n",encoding="utf-8")

if __name__ == "__main__": main()

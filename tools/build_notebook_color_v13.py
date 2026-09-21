from __future__ import annotations

import colorsys, json, math
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageOps, ImageStat
import qrcode

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "out_v13"
OUT.mkdir(exist_ok=True)

DPI = 300
MM = 25.4
W_MM, H_MM = 344.5, 245.0
W = round(W_MM / MM * DPI)
H = round(H_MM / MM * DPI)

def mm(v): return round(v / MM * DPI)

# Flyeralarm spread geometry
BACK_L, BACK_R = 15.0, 167.0
SPINE_L, SPINE_R = 167.0, 177.5
FRONT_L, FRONT_R = 177.5, 329.5

CREAM = (242,239,231,255)
WHITE = (250,250,247,255)
BLACK = (0,0,0,255)

FONT_BOLD = next(p for p in [
    "/usr/share/fonts/truetype/liberation2/LiberationSansNarrow-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSansCondensed-Bold.ttf",
] if Path(p).exists())
FONT_REG = next(p for p in [
    "/usr/share/fonts/truetype/liberation2/LiberationSansNarrow-Regular.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSansCondensed.ttf",
] if Path(p).exists())

def font(sz, bold=False):
    return ImageFont.truetype(FONT_BOLD if bold else FONT_REG, mm(sz))


def display_path(item):
    p = item.get("look") or ((item.get("gallery") or [None])[0])
    if not p: return None
    src = ROOT / p
    dp = src.parent / "display" / src.name
    if dp.exists(): return dp
    return src if src.exists() else None


def color_score(path: Path):
    im = Image.open(path).convert("RGBA")
    im.thumbnail((140,140))
    px = im.load(); sats=[]; vals=[]; hues=[]
    for y in range(im.height):
        for x in range(im.width):
            r,g,b,a = px[x,y]
            if a < 30: continue
            mx=max(r,g,b); mn=min(r,g,b)
            if mx < 25: continue
            h,s,v = colorsys.rgb_to_hsv(r/255,g/255,b/255)
            if v > 0.08:
                sats.append(s); vals.append(v); hues.append(h)
    if not sats: return 0.0,0.0
    sat=sum(sats)/len(sats); val=sum(vals)/len(vals)
    vivid = sum(1 for s,v in zip(sats,vals) if s>0.35 and v>0.25)/len(sats)
    return sat*0.55 + vivid*0.35 + val*0.10, vivid


def choose_items():
    items=json.loads((ROOT/"data/items.json").read_text(encoding="utf-8"))
    pool=[]
    for it in items:
        if it.get("public_status")!="AVAILABLE": continue
        p=display_path(it)
        if not p: continue
        try:
            score,vivid=color_score(p)
        except Exception:
            continue
        pool.append((score,vivid,it,p))
    pool.sort(key=lambda x:x[0], reverse=True)

    chosen=[]; brand_count={}; cat_count={}
    for score,vivid,it,p in pool:
        brand=it.get("brand") or ""
        cat=it.get("taxonomy_category") or it.get("category") or ""
        if brand_count.get(brand,0)>=2: continue
        if cat_count.get(cat,0)>=5: continue
        chosen.append((it,p,score))
        brand_count[brand]=brand_count.get(brand,0)+1
        cat_count[cat]=cat_count.get(cat,0)+1
        if len(chosen)>=36: break
    # add a few neutral pieces for contrast
    for score,vivid,it,p in reversed(pool):
        if len(chosen)>=42: break
        if any(int(c[0].get("id",-1))==int(it.get("id",-2)) for c in chosen): continue
        chosen.append((it,p,score))
    return chosen


def product_image(path: Path):
    im=Image.open(path).convert("RGBA")
    # display assets already preserve the shop look; no recoloring, no hue/saturation edits.
    return im


def fit(im, bw, bh):
    s=min(bw/im.width,bh/im.height)
    return im.resize((max(1,int(im.width*s)),max(1,int(im.height*s))),Image.Resampling.LANCZOS)


def place(base, path, x,y,w,h, angle=0):
    im=fit(product_image(path), mm(w), mm(h))
    if angle:
        im=im.rotate(angle, resample=Image.Resampling.BICUBIC, expand=True)
    px=mm(x)+(mm(w)-im.width)//2; py=mm(y)+(mm(h)-im.height)//2
    base.alpha_composite(im,(px,py))


def title(draw, cx, top, scale=1.0, align="center"):
    f1=font(20.5*scale,True); f2=font(19.5*scale,True); f3=font(20.5*scale,True)
    lines=[("DIS",f1), ("ORDER",f2), ("119",f3)]
    y=mm(top)
    for text,f in lines:
        b=draw.textbbox((0,0),text,font=f); tw=b[2]-b[0]
        x=cx-tw//2 if align=="center" else cx
        draw.text((x,y),text,font=f,fill=WHITE)
        y += int((b[3]-b[1])*0.86)


def qr_block(base, x, y, size=29):
    qr=qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_H,box_size=10,border=4)
    qr.add_data("https://disorder119.com/"); qr.make(fit=True)
    qi=qr.make_image(fill_color="black",back_color="white").convert("RGBA")
    qpx=mm(size); qi=qi.resize((qpx,qpx),Image.Resampling.NEAREST)
    base.alpha_composite(qi,(mm(x),mm(y)))
    d=ImageDraw.Draw(base); f=font(2.7,True)
    txt="DISORDER119.COM"; b=d.textbbox((0,0),txt,font=f)
    d.text((mm(x)+(qpx-(b[2]-b[0]))//2, mm(y+size+2.2)), txt, font=f, fill=CREAM)


def add_spine(base):
    d=ImageDraw.Draw(base)
    d.rectangle((mm(SPINE_L),0,mm(SPINE_R),H),fill=BLACK)


def make_variant(name, front_boxes, back_boxes, title_top=76, title_x=None, qr_xy=(71,190), title_scale=1.0):
    base=Image.new("RGBA",(W,H),BLACK)
    add_spine(base)
    items=CHOSEN
    for idx,(box,ang) in enumerate(back_boxes):
        _,p,_=items[idx%len(items)]; place(base,p,*box,angle=ang)
    offset=len(back_boxes)
    for j,(box,ang) in enumerate(front_boxes):
        _,p,_=items[(offset+j)%len(items)]; place(base,p,*box,angle=ang)
    d=ImageDraw.Draw(base)
    cx=mm((FRONT_L+FRONT_R)/2) if title_x is None else mm(title_x)
    title(d,cx,title_top,title_scale)
    qr_block(base,*qr_xy)
    out=OUT/f"{name}.png"; base.convert("RGB").save(out,dpi=(DPI,DPI),optimize=True)
    prev=base.copy(); prev.thumbnail((1800,1300),Image.Resampling.LANCZOS)
    prev.convert("RGB").save(OUT/f"{name}_preview.png",quality=94)
    return out

CHOSEN=choose_items()

# A: colorful but still closest to the first Spotify-like composition
A_back=[((22,16,34,49),-3),((61,19,32,43),3),((104,13,42,54),-2),((22,75,33,47),2),((65,72,34,50),-2),((110,73,40,49),2),((22,132,38,48),-3),((69,132,32,47),3),((113,131,38,50),-2)]
A_front=[((185,13,35,47),-2),((285,16,39,53),3),((181,72,34,54),2),((296,78,27,45),-3),((182,167,39,48),-2),((292,165,33,52),3)]

# B: stronger color clash and asymmetry
B_back=[((20,12,45,61),-5),((74,18,30,42),4),((118,16,38,53),-3),((24,83,30,45),2),((61,72,47,62),-4),((118,88,34,43),4),((21,143,38,57),3),((72,151,31,42),-3),((116,143,41,58),2)]
B_front=[((184,12,45,61),4),((286,15,38,52),-3),((183,91,34,53),-4),((296,85,28,44),3),((183,178,43,48),3),((287,169,37,53),-4)]

# C: colorful hero objects, more premium breathing room
C_back=[((25,20,40,57),-2),((94,15,42,53),2),((26,88,36,48),2),((94,82,44,61),-2),((25,155,41,56),-2),((95,155,39,50),2)]
C_front=[((185,13,47,67),-2),((281,14,44,62),2),((187,153,38,58),3),((287,156,35,50),-3)]

# D: brighter, playful poster with more small accents around the wordmark
D_back=[((19,15,34,47),-4),((58,13,29,42),3),((93,17,35,47),-2),((129,16,28,42),4),((22,76,30,44),3),((62,72,32,46),-3),((103,74,31,44),2),((130,77,27,43),-4),((20,137,37,48),-2),((65,138,30,42),3),((104,137,33,45),-3),((132,139,27,42),2)]
D_front=[((181,15,31,48),2),((219,12,29,45),-3),((286,15,38,52),3),((181,87,31,47),-3),((296,91,27,43),2),((181,174,34,47),2),((222,181,29,40),-2),((294,169,31,49),3)]

make_variant("V13A_COLOR_SPOTIFY",A_front,A_back,title_top=70,title_scale=1.03,qr_xy=(70,190))
make_variant("V13B_COLOR_CLASH",B_front,B_back,title_top=75,title_scale=1.0,qr_xy=(68,190))
make_variant("V13C_COLOR_PREMIUM",C_front,C_back,title_top=78,title_scale=1.04,qr_xy=(69,190))
make_variant("V13D_COLOR_POSTER",D_front,D_back,title_top=76,title_scale=0.98,qr_xy=(69,190))

# overview
previews=[]
for p in sorted(OUT.glob("V13*_preview.png")):
    im=Image.open(p).convert("RGB"); im.thumbnail((1200,850)); previews.append((p.name,im.copy()))
canvas=Image.new("RGB",(2500,1900),(18,18,18)); d=ImageDraw.Draw(canvas)
label=ImageFont.truetype(FONT_BOLD,42)
for i,(name,im) in enumerate(previews):
    col=i%2; row=i//2; x=35+col*1230; y=55+row*910
    canvas.paste(im,(x,y+55)); d.text((x,y),name.replace("_preview.png",""),font=label,fill=(245,245,242))
canvas.save(OUT/"Disorder119_V13_4_Farbige_Entwuerfe_Uebersicht.png",quality=95)

manifest=OUT/"selected_colorful_items.txt"
manifest.write_text("\n".join(f"{i+1:02d}. {it.get('id')} | {it.get('brand')} | {it.get('title')} | score={score:.3f} | {p.relative_to(ROOT)}" for i,(it,p,score) in enumerate(CHOSEN)),encoding="utf-8")
print(f"Built {len(list(OUT.glob('*.png')))} PNG files using {len(CHOSEN)} original shop items")

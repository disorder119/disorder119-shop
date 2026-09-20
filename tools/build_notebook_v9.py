from __future__ import annotations

import colorsys, json, random
from collections import deque
from functools import lru_cache
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageOps
import qrcode

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "out_notebook_v9"
OUT.mkdir(exist_ok=True)
DPI=300; MM=25.4
W_MM,H_MM=344.5,245.0
W=round(W_MM/MM*DPI); H=round(H_MM/MM*DPI)
BACK_L,BACK_R=15.0,167.0
SPINE_L,SPINE_R=167.0,177.5
FRONT_L,FRONT_R=177.5,329.5
BLACK=(0,0,0,255); PAPER=(242,239,231,255)

PREF=[6241,6240,6239,6238,6237,6236,6235,6234,6233,6232,6231,6230,6229,6228,6227,6226,6225,6224,6223,6222,6221,6220,6219,6218,6217,6216,6215,6214,6213,6212,6211,6210,6209,6208,6207,6206,6205,6204,6203,6202,6201,6200,6199,6198,6197,6196,6195,6194,6193,6192,6191,6190,6189,6188,6187,6186,6185,6184,6183,6182,6042,9523,9526,9525,9519,9531,9536,9527,9535,9534,9524,9533,9522,9521,9520,9518,9532,9517,9516,9515,9514,9513,9538,9512,9511,9530,9529,9510,9509,9508,9528,9507,9500,9479,9476,9475,9463,9456,9442,9432,9404,9401,9400,9378,9365,9362]

def mm(v): return round(v/MM*DPI)

def font(size_mm):
    for p in ["/usr/share/fonts/truetype/liberation2/LiberationSansNarrow-Bold.ttf","/usr/share/fonts/truetype/dejavu/DejaVuSansCondensed-Bold.ttf"]:
        if Path(p).exists(): return ImageFont.truetype(p,mm(size_mm))
    return ImageFont.load_default()

def items(): return json.loads((ROOT/"data/items.json").read_text(encoding="utf-8"))
def ok(i): return i.get("public_status")=="AVAILABLE" or str(i.get("status","")).lower() in {"available","verfügbar"}
def src(i):
    p=i.get("look") or ((i.get("gallery") or [None])[0]); q=ROOT/p if p else None
    return q if q and q.exists() else None

def pool():
    data=items(); by={int(i["id"]):i for i in data if "id" in i}; out=[]; seen=set()
    for pid in PREF:
        i=by.get(pid)
        if i and ok(i) and src(i): out.append(i); seen.add(pid)
    for i in data:
        pid=int(i.get("id",-1))
        if pid not in seen and ok(i) and src(i): out.append(i)
    return out

def category(i): return (i.get("taxonomy_category") or i.get("category") or "").lower()

@lru_cache(maxsize=512)
def tone(path):
    im=Image.open(path).convert("RGB"); im.thumbnail((90,90))
    pts=[p for p in im.getdata() if max(p)>=28]
    if not pts:return "dark"
    r=sum(p[0] for p in pts)/len(pts)/255; g=sum(p[1] for p in pts)/len(pts)/255; b=sum(p[2] for p in pts)/len(pts)/255
    h,s,v=colorsys.rgb_to_hsv(r,g,b)
    if v<.40:return "dark"
    if s<.17 and v>.62:return "light"
    if s<.23:return "neutral"
    if .045<=h<=.18:return "earth"
    if .18<h<=.46:return "olive"
    if h<.045 or h>.95:return "warm"
    return "other"

def suitable(i): return tone(str(src(i))) in {"dark","light","neutral","earth","olive"}

def choose_by_categories(p, specs, seed):
    rng=random.Random(seed); out=[]; used=set(); brands=set()
    def score(i):
        return (3 if suitable(i) else -5)+(2 if (i.get("brand") or "") not in brands else 0)+rng.random()
    for keywords in specs:
        candidates=[i for i in p if int(i.get("id",-1)) not in used and any(k in category(i) for k in keywords)]
        if not candidates: candidates=[i for i in p if int(i.get("id",-1)) not in used]
        candidates.sort(key=score,reverse=True); i=candidates[0]
        out.append(i); used.add(int(i["id"])); brands.add(i.get("brand") or "")
    return out

@lru_cache(maxsize=256)
def cut(path):
    im=ImageOps.exif_transpose(Image.open(path)).convert("RGBA"); rgb=im.convert("RGB"); w,h=rgb.size; px=rgb.load(); seen=bytearray(w*h); q=deque()
    def bg(x,y):
        r,g,b=px[x,y]; return max(r,g,b)<=26 and max(r,g,b)-min(r,g,b)<=16
    def push(x,y):
        j=y*w+x
        if seen[j] or not bg(x,y):return
        seen[j]=1;q.append((x,y))
    for x in range(w):push(x,0);push(x,h-1)
    for y in range(h):push(0,y);push(w-1,y)
    while q:
        x,y=q.popleft()
        if x>0:push(x-1,y)
        if x+1<w:push(x+1,y)
        if y>0:push(x,y-1)
        if y+1<h:push(x,y+1)
    rp=im.load()
    for y in range(h):
        b0=y*w
        for x in range(w):
            if seen[b0+x]:
                r,g,b,a=rp[x,y]; rp[x,y]=(r,g,b,0)
    bb=im.getbbox(); return im.crop(bb) if bb else im

def place(base,i,box,angle=0):
    x,y,bw,bh=[mm(v) for v in box]; im=cut(str(src(i))).copy(); s=min(bw/im.width,bh/im.height); im=im.resize((max(1,round(im.width*s)),max(1,round(im.height*s))),Image.Resampling.LANCZOS)
    if angle: im=im.rotate(angle,expand=True,resample=Image.Resampling.BICUBIC)
    base.alpha_composite(im,(x+(bw-im.width)//2,y+(bh-im.height)//2))

def draw_logo(base,cx=254,y=72,scale=1.0):
    d=ImageDraw.Draw(base)
    # larger, tighter and more like a fashion masthead than the prior attempts
    for text,sz,dy in [("DIS",25.5,0),("ORDER",23.4,29.0),("119",27.8,57.0)]:
        f=font(sz*scale); bb=d.textbbox((0,0),text,font=f); d.text((mm(cx)-(bb[2]-bb[0])/2,mm(y+dy*scale)),text,font=f,fill=PAPER)

def qr(base,x=111,y=194,size=30):
    q=qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_H,box_size=12,border=4); q.add_data("https://disorder119.com/"); q.make(fit=True)
    im=q.make_image(fill_color="black",back_color="white").convert("RGBA"); s=mm(size); im=im.resize((s,s),Image.Resampling.NEAREST); base.alpha_composite(im,(mm(x),mm(y)))
    d=ImageDraw.Draw(base); t="DISORDER119.COM"; f=font(2.3); bb=d.textbbox((0,0),t,font=f); d.text((mm(x+size/2)-(bb[2]-bb[0])/2,mm(y+size+2)),t,font=f,fill=PAPER)

def render(name,front_items,back_items,front_boxes,back_boxes,fa,ba,logo=(254,72,1.0),qrpos=(111,194,30)):
    b=Image.new("RGBA",(W,H),BLACK)
    # book spine stays completely black
    ImageDraw.Draw(b).rectangle((mm(SPINE_L),0,mm(SPINE_R),H),fill=BLACK)
    for i,box,a in zip(front_items,front_boxes,fa):place(b,i,box,a)
    for i,box,a in zip(back_items,back_boxes,ba):place(b,i,box,a)
    draw_logo(b,*logo);qr(b,*qrpos)
    out=b.convert("RGB"); prev=OUT/f"{name}_preview.png"; full=OUT/f"{name}_344.5x245mm_300dpi.png"
    out.save(full,dpi=(DPI,DPI),optimize=True);out.resize((1800,round(1800*H/W)),Image.Resampling.LANCZOS).save(prev,optimize=True);return prev

def main():
    p=pool(); specs_front=[("outer","jack"),("dress",),("shoe",),("access",),("top","shirt"),("skirt","pant","bottom")]
    specs_back=[("outer","jack"),("dress",),("shoe",),("access",),("top","shirt"),("skirt","pant","bottom"),("shoe",),("dress",),("outer","jack"),("access",)]
    previews=[]

    # A: closest to the preferred reference: big logo, 6 hero objects orbiting it.
    f=choose_by_categories(p,specs_front,9101); used={int(i['id']) for i in f}; bp=[i for i in p if int(i.get('id',-1)) not in used]
    bk=choose_by_categories(bp,specs_back,9201)
    previews.append(render("V9A_HERO_ORBIT",f,bk,
      [(178,0,53,84),(292,4,43,70),(178,160,52,79),(292,166,43,69),(223,3,35,55),(271,182,37,48)],
      [(17,7,43,67),(65,6,39,59),(112,8,42,64),(20,79,37,56),(64,75,40,61),(111,78,40,58),(18,145,40,61),(65,145,39,58),(111,146,42,61),(66,204,36,31)],
      [-4,3,3,-3,2,2],[-3,2,-2,3,2,-3,-2,2,-2,0],(254,75,1.02),(111,194,30)))

    # B: slightly more asymmetric and editorial.
    f=choose_by_categories(p,specs_front,9102); used={int(i['id']) for i in f}; bp=[i for i in p if int(i.get('id',-1)) not in used]
    bk=choose_by_categories(bp,specs_back,9202)
    previews.append(render("V9B_EDITORIAL",f,bk,
      [(176,8,50,78),(298,2,38,66),(181,163,47,73),(297,160,39,72),(222,4,33,52),(269,187,38,44)],
      [(15,10,40,63),(61,7,41,64),(109,13,42,62),(17,83,38,57),(62,79,40,60),(109,82,41,58),(16,150,40,59),(62,148,39,60),(110,150,42,58),(124,207,30,27)],
      [-6,3,4,-4,2,3],[-5,3,-2,4,2,-4,-3,2,-2,0],(252,78,1.0),(111,194,30)))

    # C: more premium / calmer, only 5 front objects.
    f=choose_by_categories(p,specs_front[:5],9103); used={int(i['id']) for i in f}; bp=[i for i in p if int(i.get('id',-1)) not in used]
    bk=choose_by_categories(bp,specs_back[:9],9203)
    previews.append(render("V9C_PREMIUM",f,bk,
      [(177,0,55,90),(291,3,44,75),(179,168,53,74),(293,166,42,72),(267,6,33,52)],
      [(19,10,44,67),(67,9,41,62),(114,11,41,64),(20,84,40,61),(67,82,41,61),(114,84,41,59),(19,153,42,61),(67,151,41,61),(114,154,42,59)],
      [-3,2,3,-3,2],[-3,2,-2,3,2,-3,-2,2,-2],(254,78,1.06),(111,195,30)))

    # contact sheet
    ims=[Image.open(x).convert('RGB') for x in previews]; names=["V9A HERO ORBIT","V9B EDITORIAL","V9C PREMIUM"]
    tw=900;th=round(tw*H/W);gap=28;label=48
    sheet=Image.new('RGB',(tw*2+gap*3,(th+label)*2+gap*3),(18,18,18));d=ImageDraw.Draw(sheet);lf=font(4.2)
    for n,(im,name) in enumerate(zip(ims,names)):
        r=n//2;c=n%2;x=gap+c*(tw+gap);y=gap+r*(th+label+gap);sheet.paste(im.resize((tw,th),Image.Resampling.LANCZOS),(x,y));d.text((x,y+th+7),name,font=lf,fill=(242,239,231))
    sheet.save(OUT/"Disorder119_V9_3_Entwuerfe_Uebersicht.png",optimize=True)

if __name__=='__main__':main()

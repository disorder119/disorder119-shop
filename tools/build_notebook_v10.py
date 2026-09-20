from __future__ import annotations

import json
from collections import deque
from functools import lru_cache
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageOps
import qrcode

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "out_notebook_v10"
OUT.mkdir(exist_ok=True)
DPI=300; MM=25.4
W_MM,H_MM=344.5,245.0
W=round(W_MM/MM*DPI); H=round(H_MM/MM*DPI)
SPINE_L,SPINE_R=167.0,177.5
BLACK=(0,0,0,255); PAPER=(242,239,231,255)

# Hand-curated from current AVAILABLE shop items, chosen for visual shape/palette.
FRONT_IDS = [9516, 6204, 6237, 6239, 6202]
BACK_IDS  = [6203, 6218, 6220, 6200, 6199, 6224, 6223, 6241, 6240, 9517]

def mm(v): return round(v/MM*DPI)

def font(size_mm):
    for p in ["/usr/share/fonts/truetype/liberation2/LiberationSansNarrow-Bold.ttf","/usr/share/fonts/truetype/dejavu/DejaVuSansCondensed-Bold.ttf"]:
        if Path(p).exists(): return ImageFont.truetype(p,mm(size_mm))
    return ImageFont.load_default()

def load():
    data=json.loads((ROOT/"data/items.json").read_text(encoding="utf-8"))
    return {int(i['id']):i for i in data if 'id' in i}

def src(i):
    p=i.get('look') or ((i.get('gallery') or [None])[0])
    q=ROOT/p if p else None
    if not q or not q.exists(): raise RuntimeError(f"missing image for {i.get('id')}")
    return q

@lru_cache(maxsize=64)
def cut(path):
    im=ImageOps.exif_transpose(Image.open(path)).convert('RGBA')
    rgb=im.convert('RGB'); w,h=rgb.size; px=rgb.load(); seen=bytearray(w*h); q=deque()
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
    bb=im.getbbox(); return im.crop(bb) if bb else im

def place(base,item,box,angle=0):
    x,y,bw,bh=[mm(v) for v in box]
    im=cut(str(src(item))).copy()
    s=min(bw/im.width,bh/im.height)
    im=im.resize((max(1,round(im.width*s)),max(1,round(im.height*s))),Image.Resampling.LANCZOS)
    if angle: im=im.rotate(angle,expand=True,resample=Image.Resampling.BICUBIC)
    base.alpha_composite(im,(x+(bw-im.width)//2,y+(bh-im.height)//2))

def logo(base,cx,y,scale=1.0):
    d=ImageDraw.Draw(base)
    # oversized, tight, free-standing; no panel/background behind it
    specs=[('DIS',29.0,0),('ORDER',26.0,31.5),('119',31.0,61.5)]
    for text,sz,dy in specs:
        f=font(sz*scale); bb=d.textbbox((0,0),text,font=f)
        d.text((mm(cx)-(bb[2]-bb[0])/2,mm(y+dy*scale)),text,font=f,fill=PAPER)

def qr(base,x,y,size=30):
    q=qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_H,box_size=12,border=4)
    q.add_data('https://disorder119.com/');q.make(fit=True)
    im=q.make_image(fill_color='black',back_color='white').convert('RGBA');s=mm(size);im=im.resize((s,s),Image.Resampling.NEAREST)
    base.alpha_composite(im,(mm(x),mm(y)))
    d=ImageDraw.Draw(base); text='DISORDER119.COM';f=font(2.35);bb=d.textbbox((0,0),text,font=f)
    d.text((mm(x+size/2)-(bb[2]-bb[0])/2,mm(y+size+2.2)),text,font=f,fill=PAPER)

def render(name,front,back,fb,bb,fa,ba,logoargs,qrargs):
    base=Image.new('RGBA',(W,H),BLACK)
    ImageDraw.Draw(base).rectangle((mm(SPINE_L),0,mm(SPINE_R),H),fill=BLACK)
    for i,b,a in zip(front,fb,fa): place(base,i,b,a)
    for i,b,a in zip(back,bb,ba): place(base,i,b,a)
    logo(base,*logoargs); qr(base,*qrargs)
    out=base.convert('RGB');prev=OUT/f'{name}_preview.png';full=OUT/f'{name}_344.5x245mm_300dpi.png'
    out.save(full,dpi=(DPI,DPI),optimize=True);out.resize((1800,round(1800*H/W)),Image.Resampling.LANCZOS).save(prev,optimize=True);return prev

def main():
    by=load(); front=[by[i] for i in FRONT_IDS]; back=[by[i] for i in BACK_IDS]
    for i in front+back:
        if i.get('public_status')!='AVAILABLE': raise RuntimeError(f"{i['id']} is not available")

    previews=[]
    # A - strong central masthead with five large hero objects, back like a compact archive wall.
    previews.append(render('V10A_STRONG',front,back,
      [(178,2,52,85),(294,4,41,70),(180,163,49,73),(294,165,39,67),(268,9,31,48)],
      [(18,8,42,66),(65,8,39,61),(112,10,42,64),(20,80,38,57),(66,77,39,59),(113,80,39,57),(18,146,40,59),(65,145,39,58),(112,146,42,60),(67,204,35,31)],
      [-3,2,3,-2,2],[-2,2,-2,2,-2,2,-2,2,-2,0],(254,70,1.0),(111,194,30)))

    # B - more asymmetric, one product intentionally slightly intrudes toward the logo area.
    previews.append(render('V10B_ASYMMETRIC',front,back,
      [(177,7,49,78),(296,0,40,72),(181,164,49,72),(297,157,39,74),(270,12,30,47)],
      [(16,10,42,65),(63,4,40,64),(111,13,42,62),(18,82,39,58),(64,77,41,61),(112,84,39,56),(17,149,41,58),(64,143,40,61),(112,150,41,57),(126,205,28,29)],
      [-5,3,4,-3,2],[-4,3,-2,4,2,-3,-3,2,-2,0],(252,73,0.98),(111,194,30)))

    # C - calmer, luxury-gift version with huge mark and more breathing room.
    previews.append(render('V10C_LUXE',front,back,
      [(178,0,55,90),(292,3,43,76),(180,169,51,68),(294,167,40,67),(269,8,31,46)],
      [(19,10,44,67),(68,9,41,63),(115,11,40,63),(20,87,40,60),(68,84,40,61),(115,87,40,58),(19,155,41,58),(68,153,39,60),(115,156,40,56),(68,208,34,27)],
      [-2,2,2,-2,1],[-2,2,-2,2,-2,2,-2,2,-2,0],(254,73,1.05),(111,195,30)))

    ims=[Image.open(p).convert('RGB') for p in previews];names=['V10A STRONG','V10B ASYMMETRIC','V10C LUXE']
    tw=900;th=round(tw*H/W);gap=28;label=48
    sheet=Image.new('RGB',(tw*2+gap*3,(th+label)*2+gap*3),(18,18,18));d=ImageDraw.Draw(sheet);lf=font(4.2)
    for n,(im,name) in enumerate(zip(ims,names)):
        r=n//2;c=n%2;x=gap+c*(tw+gap);y=gap+r*(th+label+gap)
        sheet.paste(im.resize((tw,th),Image.Resampling.LANCZOS),(x,y));d.text((x,y+th+7),name,font=lf,fill=(242,239,231))
    sheet.save(OUT/'Disorder119_V10_3_Entwuerfe_Uebersicht.png',optimize=True)

if __name__=='__main__':main()

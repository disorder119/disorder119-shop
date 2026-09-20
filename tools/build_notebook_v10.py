from __future__ import annotations

import json
from collections import deque
from functools import lru_cache
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageOps
import qrcode

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'out_notebook_v11'; OUT.mkdir(exist_ok=True)
DPI=300; MM=25.4; W_MM,H_MM=344.5,245.0
W=round(W_MM/MM*DPI); H=round(H_MM/MM*DPI)
SPINE_L,SPINE_R=167.0,177.5
BLACK=(0,0,0,255); PAPER=(242,239,231,255)

FRONT_IDS=[9516,6204,6237,6239,6202,6218,6221,6219,6241]
BACK_IDS=[6203,6220,6200,6199,6224,6223,6240,9517,6201,6238,6217,6198,6197,6222]

def mm(v): return round(v/MM*DPI)
def font(sz):
    for p in ['/usr/share/fonts/truetype/noto/NotoSans-ExtraCondensedBlack.ttf','/usr/share/fonts/truetype/noto/NotoSans-CondensedBlack.ttf','/usr/share/fonts/truetype/dejavu/DejaVuSansCondensed-Bold.ttf']:
        if Path(p).exists(): return ImageFont.truetype(p,mm(sz))
    return ImageFont.load_default()

def load():
    d=json.loads((ROOT/'data/items.json').read_text(encoding='utf-8'))
    return {int(i['id']):i for i in d if 'id' in i}
def src(i):
    p=i.get('look') or ((i.get('gallery') or [None])[0]); q=ROOT/p if p else None
    if not q or not q.exists(): raise RuntimeError(f'missing {i.get("id")}')
    return q

@lru_cache(maxsize=64)
def cut(path):
    im=ImageOps.exif_transpose(Image.open(path)).convert('RGBA'); rgb=im.convert('RGB'); w,h=rgb.size; px=rgb.load(); seen=bytearray(w*h); q=deque()
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
        o=y*w
        for x in range(w):
            if seen[o+x]:
                r,g,b,a=rp[x,y]; rp[x,y]=(r,g,b,0)
    bb=im.getbbox(); return im.crop(bb) if bb else im

def place(base,item,box,angle=0):
    x,y,bw,bh=[mm(v) for v in box]; im=cut(str(src(item))).copy(); s=min(bw/im.width,bh/im.height); im=im.resize((max(1,round(im.width*s)),max(1,round(im.height*s))),Image.Resampling.LANCZOS)
    if angle: im=im.rotate(angle,expand=True,resample=Image.Resampling.BICUBIC)
    base.alpha_composite(im,(x+(bw-im.width)//2,y+(bh-im.height)//2))

def logo(base,x=226,y=65,scale=1.0):
    d=ImageDraw.Draw(base)
    # left-aligned stacked wordmark, much closer to the original reference cover
    for text,sz,dy in [('DIS',29.5,0),('ORDER',27.0,30.0),('119',31.5,59.5)]:
        d.text((mm(x),mm(y+dy*scale)),text,font=font(sz*scale),fill=PAPER)

def qrblock(base,x=112,y=196,size=29):
    q=qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_H,box_size=12,border=4); q.add_data('https://disorder119.com/'); q.make(fit=True)
    im=q.make_image(fill_color='black',back_color='white').convert('RGBA'); s=mm(size); im=im.resize((s,s),Image.Resampling.NEAREST); base.alpha_composite(im,(mm(x),mm(y)))
    d=ImageDraw.Draw(base); t='DISORDER119.COM'; f=font(2.15); bb=d.textbbox((0,0),t,font=f); d.text((mm(x+size/2)-(bb[2]-bb[0])/2,mm(y+size+2.0)),t,font=f,fill=PAPER)

def render(name,fb,fa,bb,ba,logoargs,qrargs):
    by=load(); front=[by[i] for i in FRONT_IDS]; back=[by[i] for i in BACK_IDS]
    for i in front+back:
        if i.get('public_status')!='AVAILABLE': raise RuntimeError(f'{i["id"]} not available')
    base=Image.new('RGBA',(W,H),BLACK); ImageDraw.Draw(base).rectangle((mm(SPINE_L),0,mm(SPINE_R),H),fill=BLACK)
    for i,b,a in zip(front,fb,fa): place(base,i,b,a)
    for i,b,a in zip(back,bb,ba): place(base,i,b,a)
    logo(base,*logoargs); qrblock(base,*qrargs)
    out=base.convert('RGB'); prev=OUT/f'{name}_preview.png'; full=OUT/f'{name}_344.5x245mm_300dpi.png'
    out.save(full,dpi=(DPI,DPI),optimize=True); out.resize((1800,round(1800*H/W)),Image.Resampling.LANCZOS).save(prev,optimize=True); return prev

def main():
    # A: dense fashion-editorial frame around a large free-standing mark.
    a=render('V11A_ARCHIVE_POSTER',
      [(176,-5,57,92),(292,-2,48,77),(176,158,55,87),(294,158,45,78),(260,1,34,52),(178,82,39,58),(301,83,34,56),(219,184,39,47),(267,184,36,45)],
      [-4,3,4,-3,2,-2,3,-2,2],
      [(12,3,42,64),(55,7,39,59),(98,2,42,65),(132,8,35,57),(14,63,39,59),(56,67,39,58),(99,63,40,61),(132,67,34,55),(14,125,41,61),(57,128,38,58),(100,123,40,62),(132,128,34,57),(18,188,38,42),(60,188,38,42)],
      [-3,2,-2,3,2,-3,2,-2,-2,3,-3,2,1,-1],(226,62,1.0),(112,196,29))

    # B: same materials, but more asymmetrical and with more aggressive edge crops.
    b=render('V11B_EDGE_COLLAGE',
      [(173,-8,61,96),(296,2,45,76),(177,160,58,87),(295,154,46,86),(258,-2,35,54),(176,84,42,60),(302,80,36,59),(220,188,38,45),(272,188,35,44)],
      [-6,4,5,-4,3,-3,4,-3,2],
      [(9,0,46,69),(54,9,41,61),(98,-2,46,70),(133,11,35,57),(11,64,42,61),(55,68,40,58),(98,63,43,63),(133,68,34,56),(10,127,43,63),(55,131,41,59),(99,126,42,63),(132,132,35,57),(12,191,40,40),(58,189,39,42)],
      [-5,3,-4,4,3,-4,3,-3,-3,4,-4,3,2,-2],(229,65,0.98),(112,196,29))

    ims=[Image.open(a).convert('RGB'),Image.open(b).convert('RGB')]; names=['V11A ARCHIVE POSTER','V11B EDGE COLLAGE']
    tw=900; th=round(tw*H/W); gap=28; label=48
    sheet=Image.new('RGB',(tw*2+gap*3,th+label+gap*2),(18,18,18)); d=ImageDraw.Draw(sheet); lf=font(4.0)
    for n,(im,name) in enumerate(zip(ims,names)):
        x=gap+n*(tw+gap); y=gap; sheet.paste(im.resize((tw,th),Image.Resampling.LANCZOS),(x,y)); d.text((x,y+th+7),name,font=lf,fill=(242,239,231))
    sheet.save(OUT/'Disorder119_V11_2_Entwuerfe_Uebersicht.png',optimize=True)

if __name__=='__main__': main()

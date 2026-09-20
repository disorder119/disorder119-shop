from __future__ import annotations

import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import qrcode

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'out_notebook_display_v12'; OUT.mkdir(exist_ok=True)
DPI=300; MM=25.4; W_MM,H_MM=344.5,245.0
W=round(W_MM/MM*DPI); H=round(H_MM/MM*DPI)
SPINE_L,SPINE_R=167.0,177.5
BLACK=(0,0,0,255); PAPER=(242,239,231,255)

# All IDs are current AVAILABLE products. The renderer refuses raw look files:
# it uses the exact transparent /display/ asset that the website itself uses.
FRONT_POOL=[6202,9516,6204,6237,6239,6203,6224,6221,6240,6201,6218,6219,6236,6235,6234,6232,6231,6230,6217]
BACK_POOL=[6241,6220,6200,6199,6223,9517,6201,6238,6198,6197,6222,6233,6232,6231,6230,6236,6235,6234,6240,6217,6218,6221]

def mm(v): return round(v/MM*DPI)

def font(sz):
    for p in [
      '/usr/share/fonts/truetype/noto/NotoSansDisplay-ExtraCondensedBlack.ttf',
      '/usr/share/fonts/truetype/noto/NotoSans-ExtraCondensedBlack.ttf',
      '/usr/share/fonts/truetype/dejavu/DejaVuSansCondensed-Bold.ttf']:
        if Path(p).exists(): return ImageFont.truetype(p,mm(sz))
    return ImageFont.load_default()

def load():
    data=json.loads((ROOT/'data/items.json').read_text(encoding='utf-8'))
    return {int(i['id']):i for i in data if 'id' in i}

def display_path(item):
    p=item.get('look') or ((item.get('gallery') or [None])[0])
    if not p: raise RuntimeError(f"No look for {item.get('id')}")
    src=ROOT/p; disp=src.parent/'display'/src.name
    if not disp.exists(): raise RuntimeError(f"No website display asset for {item.get('id')}: {disp}")
    return disp

def load_display(item):
    im=Image.open(display_path(item)).convert('RGBA')
    if im.getextrema()[3][0] == 255:
        raise RuntimeError(f"Display asset for {item['id']} is not transparent")
    return im

def place(base,item,box,angle=0):
    x,y,bw,bh=[mm(v) for v in box]
    im=load_display(item)
    s=min(bw/im.width,bh/im.height)
    im=im.resize((max(1,round(im.width*s)),max(1,round(im.height*s))),Image.Resampling.LANCZOS)
    if angle: im=im.rotate(angle,expand=True,resample=Image.Resampling.BICUBIC)
    base.alpha_composite(im,(x+(bw-im.width)//2,y+(bh-im.height)//2))

def logo_centered(base,cx,y,scale=1.0):
    d=ImageDraw.Draw(base)
    specs=[('DIS',31.0,0),('ORDER',28.4,30.2),('119',34.0,59.4)]
    for text,sz,dy in specs:
        f=font(sz*scale); bb=d.textbbox((0,0),text,font=f)
        d.text((mm(cx)-(bb[2]-bb[0])/2,mm(y+dy*scale)),text,font=f,fill=PAPER)

def logo_left(base,x,y,scale=1.0):
    d=ImageDraw.Draw(base)
    specs=[('DIS',30.0,0),('ORDER',27.4,29.3),('119',33.2,57.8)]
    for text,sz,dy in specs:
        d.text((mm(x),mm(y+dy*scale)),text,font=font(sz*scale),fill=PAPER)

def qr_block(base,x,y,size=30):
    q=qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_H,box_size=12,border=4)
    q.add_data('https://disorder119.com/'); q.make(fit=True)
    im=q.make_image(fill_color='black',back_color='white').convert('RGBA'); s=mm(size); im=im.resize((s,s),Image.Resampling.NEAREST)
    base.alpha_composite(im,(mm(x),mm(y)))
    d=ImageDraw.Draw(base); text='DISORDER119.COM'; f=font(2.3); bb=d.textbbox((0,0),text,font=f)
    d.text((mm(x+size/2)-(bb[2]-bb[0])/2,mm(y+size+2.2)),text,font=f,fill=PAPER)

def canvas():
    b=Image.new('RGBA',(W,H),BLACK)
    # pure black blank spine, no guides/text
    ImageDraw.Draw(b).rectangle((mm(SPINE_L),0,mm(SPINE_R),H),fill=BLACK)
    return b

def render(name,front_ids,back_ids,fb,bb,fa,ba,logo_fn,logo_args,qrargs):
    by=load(); base=canvas()
    front=[by[i] for i in front_ids]; back=[by[i] for i in back_ids]
    for item in front+back:
        if item.get('public_status')!='AVAILABLE': raise RuntimeError(f"{item['id']} not AVAILABLE")
        display_path(item)
    for item,box,a in zip(front,fb,fa): place(base,item,box,a)
    for item,box,a in zip(back,bb,ba): place(base,item,box,a)
    logo_fn(base,*logo_args); qr_block(base,*qrargs)
    out=base.convert('RGB'); prev=OUT/f'{name}_preview.png'; full=OUT/f'{name}_344.5x245mm_300dpi.png'
    out.save(full,dpi=(DPI,DPI),optimize=True)
    out.resize((1800,round(1800*H/W)),Image.Resampling.LANCZOS).save(prev,optimize=True)
    return prev

def main():
    previews=[]
    # 1 — closest to the early Spotify cover: big centered stack + eight medium/large pieces.
    previews.append(render('V12A_SPOTIFY_REFINED',
      [6202,6237,6239,6203,6224,6221,6201,6219],
      [6241,6220,6200,6199,6223,9517,6238,6198,6197,6233,6235,6217],
      [(180,5,43,68),(291,7,39,48),(298,63,31,36),(180,151,42,72),(294,151,38,57),(180,80,31,35),(294,99,36,55),(268,188,35,43)],
      [(18,9,35,54),(60,7,34,57),(104,10,34,54),(132,12,31,50),(18,74,33,40),(59,68,35,55),(103,74,33,39),(134,70,31,56),(18,136,34,51),(60,139,34,43),(104,134,34,45),(135,138,30,46)],
      [-3,2,-3,3,-2,2,-2,2],[-2,2,-2,2,-2,2,-2,2,-2,2,-2,2],logo_centered,(255,69,1.0),(110,195,30)))

    # 2 — asymmetric fashion poster; logo slightly left and objects break the rhythm.
    previews.append(render('V12B_EDITORIAL_OFFSET',
      [9516,6204,6237,6239,6218,6236,6240,6201],
      [6241,6220,6200,6199,6224,6223,9517,6238,6198,6197,6234,6232],
      [(178,1,43,61),(299,5,34,57),(293,65,40,48),(177,86,31,35),(178,150,41,59),(296,151,37,45),(272,2,31,40),(297,103,35,55)],
      [(17,7,35,54),(59,9,34,56),(103,7,35,55),(133,13,30,49),(18,73,34,42),(60,72,34,41),(103,70,34,54),(135,75,29,36),(18,136,35,52),(60,139,34,48),(104,137,34,44),(136,140,29,43)],
      [-5,3,3,-3,2,-2,3,-2],[-3,2,-2,3,2,-2,2,-3,-2,2,-2,3],logo_left,(220,67,1.0),(110,195,30)))

    # 3 — luxury/premium: fewer pieces and larger scale, still recognizably Disorder119.
    previews.append(render('V12C_PREMIUM_BLACK',
      [6202,6237,6203,6224,6201,6218],
      [6241,6220,6200,6199,6223,9517,6238,6198,6235,6217],
      [(180,4,46,74),(293,7,40,51),(180,157,44,74),(294,158,39,58),(295,97,36,55),(180,89,34,46)],
      [(18,9,39,59),(65,7,37,61),(110,9,37,58),(18,80,37,58),(65,82,36,44),(110,78,37,58),(19,145,36,42),(65,143,38,60),(111,145,36,48),(137,143,27,44)],
      [-2,2,2,-2,-2,2],[-2,2,-2,2,-2,2,-2,2,-2,2],logo_centered,(254,72,1.05),(112,196,30)))

    # 4 — bolder edge-crop poster, closest to a runway/fashion zine.
    previews.append(render('V12D_EDGE_POSTER',
      [9516,6202,6237,6239,6203,6236,6201,6219,6221],
      [6241,6220,6200,6199,6224,6223,9517,6238,6198,6197,6234,6232,6231],
      [(174,-4,49,72),(294,-3,43,75),(295,62,41,49),(175,91,32,36),(176,153,46,79),(295,153,43,49),(298,105,36,54),(263,190,36,42),(215,190,34,36)],
      [(14,4,40,62),(58,5,38,62),(102,4,38,59),(132,8,34,54),(15,71,37,47),(59,70,36,44),(101,68,38,59),(135,72,29,38),(15,134,38,58),(59,136,36,51),(102,134,37,48),(136,136,29,46),(16,198,34,34)],
      [-5,4,3,-4,4,-3,3,2,-2],[-4,3,-3,4,2,-2,3,-3,-3,3,-2,2,-2],logo_centered,(255,66,1.02),(112,195,30)))

    ims=[Image.open(p).convert('RGB') for p in previews]
    names=['V12A SPOTIFY REFINED','V12B EDITORIAL OFFSET','V12C PREMIUM BLACK','V12D EDGE POSTER']
    tw=900; th=round(tw*H/W); gap=28; label=48
    sheet=Image.new('RGB',(tw*2+gap*3,(th+label)*2+gap*3),(18,18,18)); d=ImageDraw.Draw(sheet); lf=font(4.0)
    for n,(im,name) in enumerate(zip(ims,names)):
        r=n//2;c=n%2;x=gap+c*(tw+gap);y=gap+r*(th+label+gap)
        sheet.paste(im.resize((tw,th),Image.Resampling.LANCZOS),(x,y));d.text((x,y+th+7),name,font=lf,fill=(242,239,231))
    sheet.save(OUT/'Disorder119_V12_4_Entwuerfe_Uebersicht.png',optimize=True)

if __name__=='__main__': main()

from __future__ import annotations

import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'out_display_audit'; OUT.mkdir(exist_ok=True)
IDS=[9516,6204,6237,6239,6202,6218,6221,6219,6241,6203,6220,6200,6199,6224,6223,6240,9517,6201,6238,6217,6198,6197,6222,6236,6235,6234,6233,6232,6231,6230]

def find_display(item):
    p=item.get('look') or ((item.get('gallery') or [None])[0])
    if not p:return None
    src=ROOT/p
    disp=src.parent/'display'/src.name
    return disp if disp.exists() else src

def main():
    data=json.loads((ROOT/'data/items.json').read_text(encoding='utf-8'))
    by={int(i['id']):i for i in data if 'id' in i}
    thumb=280; label=72; cols=5; rows=(len(IDS)+cols-1)//cols
    sheet=Image.new('RGB',(cols*thumb,rows*(thumb+label)),(96,96,96))
    d=ImageDraw.Draw(sheet)
    try:f=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',18)
    except:f=ImageFont.load_default()
    for n,pid in enumerate(IDS):
        i=by[pid]; path=find_display(i)
        im=Image.open(path).convert('RGBA')
        # checkerboard to reveal transparency vs baked background
        c=Image.new('RGB',(thumb,thumb),(180,180,180)); cd=ImageDraw.Draw(c)
        s=28
        for yy in range(0,thumb,s):
            for xx in range(0,thumb,s):
                if (xx//s+yy//s)%2: cd.rectangle((xx,yy,xx+s-1,yy+s-1),fill=(220,220,220))
        scale=min((thumb-14)/im.width,(thumb-14)/im.height)
        im=im.resize((max(1,round(im.width*scale)),max(1,round(im.height*scale))),Image.Resampling.LANCZOS)
        c.paste(im,((thumb-im.width)//2,(thumb-im.height)//2),im)
        x=(n%cols)*thumb; y=(n//cols)*(thumb+label)
        sheet.paste(c,(x,y))
        text=f"{pid}  {i.get('brand','')}\n{i.get('title','')[:30]}"
        d.multiline_text((x+6,y+thumb+4),text,font=f,fill='white',spacing=2)
    sheet.save(OUT/'display_assets_audit.png',optimize=True)

if __name__=='__main__':main()

from __future__ import annotations

from collections import deque
from pathlib import Path
from PIL import Image, ImageOps
import build_original_asset_cover_v4 as build

CACHE = {}

def fast_cutout(path: Path) -> Image.Image:
    key = str(path)
    if key in CACHE:
        return CACHE[key].copy()
    im = ImageOps.exif_transpose(Image.open(path)).convert("RGBA")
    # No colour adjustment. Downscale only for efficient compositing; final placements are far smaller than this.
    max_dim = 1200
    if max(im.size) > max_dim:
        s = max_dim / max(im.size)
        im = im.resize((round(im.width*s), round(im.height*s)), Image.Resampling.LANCZOS)
    rgb = im.convert("RGB")
    w,h = rgb.size
    pix = rgb.load()
    seen = bytearray(w*h)
    q = deque()
    def near_bg(x,y):
        r,g,b = pix[x,y]
        return max(r,g,b) <= 26 and (max(r,g,b)-min(r,g,b)) <= 16
    def push(x,y):
        idx=y*w+x
        if seen[idx] or not near_bg(x,y): return
        seen[idx]=1; q.append((x,y))
    for x in range(w): push(x,0); push(x,h-1)
    for y in range(h): push(0,y); push(w-1,y)
    while q:
        x,y=q.popleft()
        if x>0: push(x-1,y)
        if x+1<w: push(x+1,y)
        if y>0: push(x,y-1)
        if y+1<h: push(x,y+1)
    rgba=im.load()
    for y in range(h):
        base=y*w
        for x in range(w):
            if seen[base+x]:
                r,g,b,a=rgba[x,y]
                rgba[x,y]=(r,g,b,0)
    bb=im.getbbox()
    if bb: im=im.crop(bb)
    CACHE[key]=im.copy()
    return im

build.remove_connected_black_background = fast_cutout
build.main()

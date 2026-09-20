import random
from PIL import Image, ImageDraw
import build_perfect_customer_gift as base

# Curated order from real, currently available shop items.
# First 22 = back cover archive; last 14 = front cover fashion composition.
base.PREFERRED = [
    6241,6238,6237,6236,6235,6234,6233,6215,6214,6213,6211,
    6210,6209,6208,6207,6204,6203,9479,9480,9463,9456,9432,
    9476,9378,9442,9362,9475,9401,9400,9365,6218,6217,6205,6240,6239,6220,
]
base.COUNT = 36


def build_cover(products):
    px = base.px
    cover = Image.new("RGBA", (base.W, base.H), base.INK)
    d = ImageDraw.Draw(cover)
    rng = random.Random(1192026)

    d.rectangle((px(base.SPINE_L),0,px(base.SPINE_R),base.H), fill=base.INK)
    d.line((px(base.SPINE_L),0,px(base.SPINE_L),base.H), fill=(242,239,231,38), width=1)
    d.line((px(base.SPINE_R),0,px(base.SPINE_R),base.H), fill=(242,239,231,38), width=1)

    # Back: dense but mixed archive wall with real shop pieces.
    back_boxes=[
        (2,4,34,49),(34,13,28,43),(64,3,39,58),(102,16,29,43),(132,4,34,55),
        (10,57,33,50),(45,63,27,43),(74,55,42,60),(119,61,38,52),
        (3,114,41,59),(42,122,31,48),(76,113,35,55),(112,121,28,46),(139,112,27,56),
        (7,174,36,52),(39,183,31,45),(72,170,42,59),(116,181,34,47),(145,169,24,56),
        (21,215,31,27),(76,213,35,26),(130,213,31,27)
    ]
    for i,box in zip(products[:22],back_boxes):
        base.place(cover,i,box,angle=rng.choice([-7,-5,-3,-2,0,2,3,5,7]))

    # Front: fashion editorial. Hero sits on the right edge; copy owns an off-centre black field.
    base.place(cover,products[22],(267,34,62,132),angle=2)
    anchors=[(181,8,39,62),(223,8,35,58),(181,166,45,65),(228,177,38,52)]
    for i,box in zip(products[23:27],anchors):
        base.place(cover,i,box,angle=rng.choice([-5,-3,2,4]))
    sats=[
        (181,74,32,48),(218,65,34,50),(297,7,31,48),(297,170,31,56),
        (181,126,31,39),(231,145,29,40),(267,174,27,43),(262,9,25,40),(273,128,28,42)
    ]
    for i,box in zip(products[27:36],sats):
        base.place(cover,i,box,angle=rng.choice([-7,-4,-2,2,4,6]))

    # Website-style wordmark: one line, smaller than the previous attempt, fully inside the front panel.
    d.rectangle((px(199),px(88),px(287),px(147)),fill=(0,0,0,242))
    fk=base.font(2.2,bold=True,condensed=False)
    base.draw_spaced(d,px(203),px(92),base.KICKER.upper(),fk,fill=(242,239,231,130),tracking=px(.07))
    fw=base.font(13.7,bold=True,condensed=True)
    d.text((px(201),px(100)),base.WORDMARK,font=fw,fill=base.PAPER)
    fe=base.font(2.15,bold=False,condensed=False)
    for y,line in zip((123,128.3,133.6),[
        "Designer-, Vintage- und Contemporary-Pieces",
        "mit Fokus auf Qualität, Authentizität",
        "und Zeitlosigkeit",
    ]):
        d.text((px(203),px(y)),line,font=fe,fill=(242,239,231,178))

    # Back QR: visible but secondary; the gift should feel like a fashion object first.
    d.rectangle((px(116),px(182),px(159),px(234)),fill=(0,0,0,245))
    q=base.qr_img(29); cover.alpha_composite(q,(px(123),px(187)))
    fd=base.font(2.4,bold=True,condensed=True)
    d.text((px(121),px(219)),base.DOMAIN.upper(),font=fd,fill=base.PAPER)
    fb=base.font(1.95,bold=False,condensed=False)
    d.text((px(121),px(225)),base.BRANDLINE,font=fb,fill=(242,239,231,140))

    # Spine.
    strip=Image.new("RGBA",(px(103),px(base.SPINE_R-base.SPINE_L)),(0,0,0,0))
    sd=ImageDraw.Draw(strip); sf=base.font(3.6,bold=True,condensed=True)
    bb=sd.textbbox((0,0),base.WORDMARK,font=sf)
    sd.text(((strip.width-(bb[2]-bb[0]))/2,px(2.6)),base.WORDMARK,font=sf,fill=base.PAPER)
    strip=strip.rotate(90,expand=True,resample=Image.Resampling.BICUBIC)
    cover.alpha_composite(strip,(px(base.SPINE_L)+(px(base.SPINE_R-base.SPINE_L)-strip.width)//2,(base.H-strip.height)//2))
    return cover.convert("RGB")


base.build_cover = build_cover

if __name__ == "__main__":
    base.main()

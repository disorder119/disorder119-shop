from tools import build_notebook_color_v13 as v

# Stronger, larger-product layouts using the exact same automatically selected original shop display assets.
# All product colors remain untouched; only scale, placement and rotation change.

# A — colorful hero ring, large logo
A_back=[((20,12,44,61),-3),((69,14,39,52),2),((116,14,40,57),-2),((21,78,36,51),2),((66,73,42,58),-3),((116,80,40,50),3),((20,143,43,60),-2),((71,146,37,50),3),((117,143,39,59),-2)]
A_front=[((182,10,47,65),-2),((278,12,46,63),3),((181,78,35,53),3),((296,80,28,47),-3),((181,166,44,55),-2),((284,164,40,58),3)]

# B — asymmetrical color clash, logo shifted lower
B_back=[((18,15,50,67),-5),((77,12,35,51),4),((118,16,39,55),-3),((22,88,35,48),2),((67,73,47,65),-4),((119,91,35,46),3),((19,151,44,58),3),((69,153,37,49),-3),((116,148,42,61),2)]
B_front=[((181,11,51,70),4),((281,14,43,59),-3),((182,92,34,51),-4),((296,90,29,46),3),((182,177,46,49),3),((286,168,38,57),-4)]

# C — premium but unmistakably colorful: fewer, bigger products
C_back=[((24,16,49,68),-2),((91,12,51,64),2),((25,92,44,58),2),((92,85,52,72),-2),((24,162,47,59),-2),((96,161,43,55),2)]
C_front=[((181,10,55,77),-2),((274,12,50,70),2),((181,158,44,63),3),((282,160,42,58),-3)]

# D — colorful fashion poster: dense back, dramatic front corners
D_back=[((18,13,39,54),-4),((60,12,34,48),3),((98,15,38,52),-2),((126,14,33,48),4),((20,79,35,50),3),((61,73,39,54),-3),((104,76,36,50),2),((130,79,31,49),-4),((19,143,42,54),-2),((65,143,35,48),3),((105,142,38,51),-3),((131,143,30,48),2)]
D_front=[((180,8,49,70),2),((277,10,48,68),-3),((181,90,35,54),-3),((295,91,30,49),2),((180,169,45,56),2),((285,165,40,60),3)]

v.make_variant("V14A_COLOR_HERO",A_front,A_back,title_top=69,title_scale=1.12,qr_xy=(68,190))
v.make_variant("V14B_COLOR_ASYMMETRY",B_front,B_back,title_top=82,title_scale=1.08,qr_xy=(67,190))
v.make_variant("V14C_COLOR_LUXE",C_front,C_back,title_top=77,title_scale=1.13,qr_xy=(68,190))
v.make_variant("V14D_COLOR_EDITORIAL",D_front,D_back,title_top=74,title_scale=1.10,qr_xy=(68,190))

# overview only for V14
from PIL import Image, ImageDraw, ImageFont
previews=[]
for p in sorted(v.OUT.glob("V14*_preview.png")):
    im=Image.open(p).convert("RGB"); im.thumbnail((1200,850)); previews.append((p.name,im.copy()))
canvas=Image.new("RGB",(2500,1900),(18,18,18)); d=ImageDraw.Draw(canvas)
label=ImageFont.truetype(v.FONT_BOLD,42)
for i,(name,im) in enumerate(previews):
    col=i%2; row=i//2; x=35+col*1230; y=55+row*910
    canvas.paste(im,(x,y+55)); d.text((x,y),name.replace("_preview.png",""),font=label,fill=(245,245,242))
canvas.save(v.OUT/"Disorder119_V14_4_Bunte_Entwuerfe_Uebersicht.png",quality=95)
print("Built V14 colorful hero concepts")

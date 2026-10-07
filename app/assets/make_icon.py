# Generates icon.ico (and icon.png) for Save Tool: python app/assets/make_icon.py
import os
from PIL import Image, ImageDraw
S = 1024
im = Image.new("RGBA", (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(im)
d.rounded_rectangle([0, 0, S - 1, S - 1], radius=230, fill=(217, 119, 87, 255))   # terracotta
cream = (250, 249, 245, 255)
w = 96
cx = S // 2
d.line([(cx, 220), (cx, 600)], fill=cream, width=w)                                  # arrow shaft
d.polygon([(cx - 210, 520), (cx + 210, 520), (cx, 740)], fill=cream)                 # arrow head
d.rounded_rectangle([210, 780, S - 210, 780 + w], radius=w // 2, fill=cream)         # tray
d.ellipse([cx - w // 2, 220 - w // 2, cx + w // 2, 220 + w // 2], fill=cream)         # round top of shaft
here = os.path.dirname(os.path.abspath(__file__))
im.resize((256, 256), Image.LANCZOS).save(os.path.join(here, "icon.png"))
im.save(os.path.join(here, "icon.ico"), sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
print("ok")

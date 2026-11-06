"""Deterministic, fictional plan fixtures; no customer plans. Run with Pillow."""
from PIL import Image, ImageDraw, ImageFont
from pathlib import Path
import gzip
root = Path(__file__).parent
polygons = {
 'rectangle': [[(40,40),(440,40),(440,340),(40,340)]],
 'irregular': [[(40,40),(440,40),(440,160),(240,160),(240,340),(40,340)]],
 'multi-room': [[(30,40),(230,40),(230,340),(30,340)], [(270,40),(470,40),(470,340),(270,340)]],
 'open-wall': [[(40,40),(440,40),(440,340),(40,340)]],
 'blank': [],
}
for name, rooms in polygons.items():
 im = Image.new('RGB', (500,400), 'white'); draw = ImageDraw.Draw(im)
 for points in rooms: draw.line(points+[points[0]], fill='black', width=5)
 if name == 'open-wall': draw.rectangle((200,30,280,50), fill='white')
 im.save(root / f'{name}.png')
 (root / f'{name}.rgba.gz').write_bytes(gzip.compress(im.convert('RGBA').tobytes(), mtime=0))
ocr = Image.new('RGB', (1000,500),'white');d=ImageDraw.Draw(ocr)
f=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',48)
d.text((50,40),'4000 mm',font=f,fill='black');d.text((50,150),'300 cm',font=f,fill='black');d.text((50,260),'2.70 m',font=f,fill='black')
ocr.save(root/'ocr-dimensions.png')
(root/'unsupported.svg').write_text('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100"/></svg>')

labeled = Image.open(root/'rectangle.png').convert('RGB')
d=ImageDraw.Draw(labeled); font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',24)
d.text((160,5),'4000 mm',font=font,fill='black')
d.text((160,355),'3000 mm',font=font,fill='black')
labeled.save(root/'rectangle-labeled.png')

# Intentionally malformed CRC: rejected by the dimension guard BEFORE decode.
giant = bytearray((root/"rectangle.png").read_bytes()); giant[16:20]=(20000).to_bytes(4,"big")
(root/"oversized-header.png").write_bytes(giant)

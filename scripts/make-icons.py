"""Генерация иконок приложения и картинок установщика из исходного изображения.

Запуск: python scripts/make-icons.py <исходник.png|webp>
Создаёт:
  build/icon.png, build/icon.ico            — иконка exe/установщика (electron-builder)
  build/installerSidebar.bmp, build/uninstallerSidebar.bmp — боковая картинка мастера установки
  electron/icon.ico                          — иконка окна и панели задач во время работы
  public/icon.png                            — логотип в интерфейсе
"""
import os
import sys

from PIL import Image, ImageDraw, ImageFilter, ImageFont

SRC = sys.argv[1]
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# границы скруглённой плитки в исходнике 1254x1254 и радиус скругления
TILE = (46, 45, 1200, 1185)
RADIUS = 280


def rounded_mask(size, box, radius, scale=4):
    """Маска скруглённого прямоугольника со сглаживанием (рисуем в 4x и уменьшаем)."""
    w, h = size
    big = Image.new('L', (w * scale, h * scale), 0)
    d = ImageDraw.Draw(big)
    d.rounded_rectangle([c * scale for c in box], radius=radius * scale, fill=255)
    return big.resize(size, Image.LANCZOS)


src = Image.open(SRC).convert('RGBA')
mask = rounded_mask(src.size, TILE, RADIUS)
src.putalpha(mask)
tile = src.crop(TILE)

# квадратный холст с небольшим прозрачным полем
side = max(tile.size)
pad = int(side * 0.02)
canvas = Image.new('RGBA', (side + 2 * pad, side + 2 * pad), (0, 0, 0, 0))
canvas.paste(tile, (pad + (side - tile.width) // 2, pad + (side - tile.height) // 2), tile)
icon = canvas.resize((1024, 1024), Image.LANCZOS)

os.makedirs(os.path.join(ROOT, 'build'), exist_ok=True)
icon.save(os.path.join(ROOT, 'build', 'icon.png'))
icon.resize((256, 256), Image.LANCZOS).save(os.path.join(ROOT, 'public', 'icon.png'))

ico_sizes = [(16, 16), (20, 20), (24, 24), (32, 32), (40, 40), (48, 48), (64, 64), (128, 128), (256, 256)]
# маленькие размеры чуть подтягиваем по резкости, чтобы не превращались в кашу
frames = {}
for s in ico_sizes:
    im = icon.resize(s, Image.LANCZOS)
    if s[0] <= 48:
        im = im.filter(ImageFilter.UnsharpMask(radius=1, percent=60, threshold=2))
    frames[s] = im
frames[(256, 256)].save(
    os.path.join(ROOT, 'build', 'icon.ico'),
    sizes=ico_sizes,
    append_images=[frames[s] for s in ico_sizes if s != (256, 256)],
)
with open(os.path.join(ROOT, 'build', 'icon.ico'), 'rb') as f:
    data = f.read()
with open(os.path.join(ROOT, 'electron', 'icon.ico'), 'wb') as f:
    f.write(data)

# боковая картинка мастера установки NSIS: 164x314, 24-bit BMP
W, H = 164, 314
side_img = Image.new('RGB', (W, H), (11, 11, 15))
grad = ImageDraw.Draw(side_img)
for y in range(H):  # мягкий золотисто-синий градиент
    t = y / H
    grad.line([(0, y), (W, y)], fill=(int(26 - 12 * t), int(22 - 8 * t), int(30 + 4 * t)))
logo = icon.resize((132, 132), Image.LANCZOS)
side_img.paste(logo, ((W - 132) // 2, 46), logo)


def font(size, bold=False):
    for name in (['segoeuib.ttf', 'arialbd.ttf'] if bold else ['segoeui.ttf', 'arial.ttf']):
        try:
            return ImageFont.truetype(os.path.join(os.environ.get('WINDIR', 'C:/Windows'), 'Fonts', name), size)
        except OSError:
            continue
    return ImageFont.load_default()


d = ImageDraw.Draw(side_img)
for text, f, y, color in [
    ('PoE Atlas Docs', font(17, True), 196, (233, 201, 131)),
    ('Дерево атласа', font(12), 226, (190, 180, 160)),
    ('документы и таблицы', font(12), 243, (190, 180, 160)),
    ('для Path of Exile', font(12), 260, (139, 132, 120)),
]:
    tw = d.textlength(text, font=f)
    d.text(((W - tw) / 2, y), text, font=f, fill=color)
d.line([(30, 220), (W - 30, 220)], fill=(122, 95, 44), width=1)
side_img.save(os.path.join(ROOT, 'build', 'installerSidebar.bmp'))
side_img.save(os.path.join(ROOT, 'build', 'uninstallerSidebar.bmp'))
print('ok', icon.size)

from __future__ import annotations

from pathlib import Path
import shutil
import sys

from PIL import Image, ImageChops, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[2]
BRANDING_DIR = ROOT / 'resources' / 'branding'
RENDERER_BRANDING_DIR = ROOT / 'src' / 'renderer' / 'src' / 'assets' / 'branding'
LANDING_PUBLIC_DIR = ROOT / 'apps' / 'landing' / 'zyra-web' / 'public'
BLUEPRINT_SOURCE_PATH = BRANDING_DIR / 'zyra-blueprint-source.png'
APP_ICON_DIR = BRANDING_DIR / 'icons'
DEV_ICON_SOURCE_PATH = APP_ICON_DIR / 'zyra-dev-source.png'
PROD_ICON_SOURCE_PATH = APP_ICON_DIR / 'zyra-prod-source.png'
APPROVED_ICON_SOURCE_PATH = APP_ICON_DIR / 'zyra-flat-approved-source.png'

MASTER_SIZE = 1024
ICON_SIZES = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
LINUX_ICON_SIZES = (16, 32, 48, 64, 128, 256, 512, 1024)
APP_ICON_VARIANTS = (
    'zyra-dev.png',
    'zyra-dev-light.png',
    'zyra-dev-dark.png',
    'zyra-prod.png',
    'zyra-prod-light.png',
    'zyra-prod-dark.png'
)
APP_ICON_BACKGROUND = (4, 20, 43, 255)
DEV_ICON_BACKGROUND = (0, 0, 0, 255)
APP_ICON_MARK = (57, 206, 230, 255)
APP_ICON_OPTICAL_SIZES = {16, 24, 32}


def load_font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidates = []
    windows_fonts = Path('C:/Windows/Fonts')
    if bold:
        candidates.extend([
            windows_fonts / 'arialbd.ttf',
            windows_fonts / 'Arialbd.ttf',
            windows_fonts / 'segoeuib.ttf',
            windows_fonts / 'bahnschrift.ttf'
        ])
    else:
        candidates.extend([
            windows_fonts / 'arial.ttf',
            windows_fonts / 'segoeui.ttf',
            windows_fonts / 'bahnschrift.ttf'
        ])

    for candidate in candidates:
        if candidate.exists():
            return ImageFont.truetype(str(candidate), size=size)

    return ImageFont.load_default()


def draw_clean_mark(size: int) -> Image.Image:
    background = '#2d2d2f'
    cream = '#ddd1c3'
    ink = '#111015'

    image = Image.new('RGBA', (size, size), background)
    draw = ImageDraw.Draw(image)

    top_box = (
        int(size * 0.24),
        int(size * 0.27),
        int(size * 0.86),
        int(size * 0.44)
    )
    draw.rectangle(top_box, fill=cream)

    folder_points = [
        (int(size * 0.16), int(size * 0.59)),
        (int(size * 0.51), int(size * 0.59)),
        (int(size * 0.53), int(size * 0.525)),
        (int(size * 0.76), int(size * 0.525)),
        (int(size * 0.68), int(size * 0.755)),
        (int(size * 0.16), int(size * 0.755))
    ]
    draw.polygon(folder_points, fill=cream)

    font = load_font(int(size * 0.20), bold=True)
    draw.text((int(size * 0.58), int(size * 0.235)), '.air', font=font, fill=ink)
    return image


def draw_grid(draw: ImageDraw.ImageDraw, size: int) -> None:
    minor = max(20, size // 28)
    major = minor * 4

    for offset in range(0, size + 1, minor):
        color = (255, 255, 255, 34 if offset % major else 62)
        width = 1 if offset % major else 2
        draw.line((offset, 0, offset, size), fill=color, width=width)
        draw.line((0, offset, size, offset), fill=color, width=width)


def draw_hatched_region(
    base: Image.Image,
    points: list[tuple[int, int]],
    *,
    outline: tuple[int, int, int, int],
    hatch_alpha: int = 110
) -> None:
    mask = Image.new('L', base.size, 0)
    mask_draw = ImageDraw.Draw(mask)
    mask_draw.polygon(points, fill=255)

    hatch = Image.new('RGBA', base.size, (0, 0, 0, 0))
    hatch_draw = ImageDraw.Draw(hatch)
    spacing = 28
    for offset in range(-base.height, base.width * 2, spacing):
        hatch_draw.line(
            (offset, 0, offset - base.height, base.height),
            fill=(255, 255, 255, hatch_alpha),
            width=3
        )

    base.alpha_composite(Image.composite(hatch, Image.new('RGBA', base.size, (0, 0, 0, 0)), mask))
    outline_draw = ImageDraw.Draw(base)
    outline_draw.polygon(points, outline=outline, width=6)


def draw_dimension(draw: ImageDraw.ImageDraw, start: tuple[int, int], end: tuple[int, int], cross: int = 18) -> None:
    color = (255, 255, 255, 190)
    draw.line((start, end), fill=color, width=3)

    if start[0] == end[0]:
        for point in (start, end):
            draw.line((point[0] - cross, point[1], point[0] + cross, point[1]), fill=color, width=3)
    else:
        for point in (start, end):
            draw.line((point[0], point[1] - cross, point[0], point[1] + cross), fill=color, width=3)

    def draw_arrow(point: tuple[int, int], direction: tuple[int, int]) -> None:
        x, y = point
        dx, dy = direction
        scale = 14
        if dx != 0:
            arrow = [(x, y), (x - dx * scale, y - 8), (x - dx * scale, y + 8)]
        else:
            arrow = [(x, y), (x - 8, y - dy * scale), (x + 8, y - dy * scale)]
        draw.polygon(arrow, fill=color)

    if start[0] == end[0]:
        draw_arrow(start, (0, -1 if end[1] > start[1] else 1))
        draw_arrow(end, (0, 1 if end[1] > start[1] else -1))
    else:
        draw_arrow(start, (-1 if end[0] > start[0] else 1, 0))
        draw_arrow(end, (1 if end[0] > start[0] else -1, 0))


def draw_blueprint_mark(size: int) -> Image.Image:
    image = Image.new('RGBA', (size, size), '#0a5ba4')
    draw = ImageDraw.Draw(image)

    for y in range(size):
        depth = y / max(1, size - 1)
        row_color = (
            int(8 + depth * 22),
            int(78 + depth * 32),
            int(138 + depth * 28),
            255
        )
        draw.line((0, y, size, y), fill=row_color)

    draw_grid(draw, size)

    top_points = [
        (int(size * 0.17), int(size * 0.22)),
        (int(size * 0.89), int(size * 0.22)),
        (int(size * 0.89), int(size * 0.45)),
        (int(size * 0.17), int(size * 0.45))
    ]
    folder_points = [
        (int(size * 0.07), int(size * 0.60)),
        (int(size * 0.52), int(size * 0.60)),
        (int(size * 0.54), int(size * 0.53)),
        (int(size * 0.84), int(size * 0.53)),
        (int(size * 0.74), int(size * 0.82)),
        (int(size * 0.07), int(size * 0.82))
    ]

    outline = (255, 255, 255, 218)
    draw_hatched_region(image, top_points, outline=outline)
    draw_hatched_region(image, folder_points, outline=outline)

    font = load_font(int(size * 0.23), bold=True)
    text_position = (int(size * 0.62), int(size * 0.20))
    bg_fill = (11, 92, 164, 255)
    draw.text(
        text_position,
        '.air',
        font=font,
        fill=bg_fill,
        stroke_width=6,
        stroke_fill=outline
    )

    draw_dimension(draw, (int(size * 0.17), int(size * 0.14)), (int(size * 0.89), int(size * 0.14)))
    draw_dimension(draw, (int(size * 0.17), int(size * 0.18)), (int(size * 0.79), int(size * 0.18)))
    draw_dimension(draw, (int(size * 0.63), int(size * 0.48)), (int(size * 0.82), int(size * 0.48)))
    draw_dimension(draw, (int(size * 0.07), int(size * 0.87)), (int(size * 0.74), int(size * 0.87)))
    draw_dimension(draw, (int(size * 0.84), int(size * 0.57)), (int(size * 0.84), int(size * 0.82)))
    draw_dimension(draw, (int(size * 0.03), int(size * 0.61)), (int(size * 0.03), int(size * 0.82)))

    draw.arc(
        (int(size * 0.38), int(size * 0.50), int(size * 0.57), int(size * 0.68)),
        start=248,
        end=360,
        fill=(255, 255, 255, 170),
        width=4
    )
    draw.line(
        (int(size * 0.57), int(size * 0.60), int(size * 0.48), int(size * 0.60)),
        fill=(255, 255, 255, 170),
        width=4
    )
    draw.line(
        (int(size * 0.57), int(size * 0.60), int(size * 0.55), int(size * 0.58)),
        fill=(255, 255, 255, 170),
        width=4
    )
    draw.line(
        (int(size * 0.57), int(size * 0.60), int(size * 0.55), int(size * 0.62)),
        fill=(255, 255, 255, 170),
        width=4
    )

    return image


def load_blueprint_master(size: int) -> Image.Image:
    if BLUEPRINT_SOURCE_PATH.exists():
        source = Image.open(BLUEPRINT_SOURCE_PATH).convert('RGBA')
        return source.resize((size, size), Image.Resampling.LANCZOS)
    return draw_blueprint_mark(size)


def load_approved_app_icon_master() -> Image.Image:
    if not APPROVED_ICON_SOURCE_PATH.exists():
        raise FileNotFoundError(f'Missing approved app icon source: {APPROVED_ICON_SOURCE_PATH}')
    source = Image.open(APPROVED_ICON_SOURCE_PATH).convert('RGBA')
    if source.size != (MASTER_SIZE, MASTER_SIZE):
        raise ValueError('The approved app icon source must remain 1024px square.')
    return source


def approved_app_icon_masks(source: Image.Image) -> tuple[Image.Image, Image.Image]:
    tile_alpha = source.getchannel('A')
    mark_mask = Image.new('L', source.size, 0)
    mark_mask.putdata([
        255 if alpha > 0 and green > 100 and blue > 100 and red < 100 else 0
        for red, green, blue, alpha in source.getdata()
    ])
    if not mark_mask.getbbox():
        raise ValueError('The approved app icon source does not contain the cyan Zyra mark.')
    return tile_alpha, mark_mask


def render_16px_optical_mark() -> Image.Image:
    mark_mask = Image.new('L', (16, 16), 0)
    draw = ImageDraw.Draw(mark_mask)
    draw.rectangle((3, 2, 12, 13), outline=255, width=1)
    draw.line(((5, 4), (10, 4), (10, 9), (8, 9)), fill=255, width=1)
    draw.line(((5, 4), (5, 7), (8, 7)), fill=255, width=1)
    draw.line(((5, 8), (5, 11), (10, 11), (10, 10), (8, 10)), fill=255, width=1)
    draw.line(((9, 5), (9, 7)), fill=255, width=1)
    draw.line(((6, 9), (6, 10)), fill=255, width=1)
    return mark_mask


def create_dev_icon_master(source: Image.Image) -> Image.Image:
    """Reuse the approved geometry with a black field; never edit source artwork."""
    tile_alpha, mark_mask = approved_app_icon_masks(source)
    image = Image.new('RGBA', source.size, DEV_ICON_BACKGROUND)
    image.putalpha(tile_alpha)
    mark = Image.new('RGBA', source.size, APP_ICON_MARK)
    mark.putalpha(ImageChops.multiply(mark_mask, tile_alpha))
    image.alpha_composite(mark)
    return image


def clamp_approved_app_icon_palette(image: Image.Image, background=APP_ICON_BACKGROUND) -> Image.Image:
    red, green, blue, alpha = image.convert('RGBA').split()
    red = red.point(lambda value: max(background[0], min(57, value)))
    green = green.point(lambda value: max(background[1], min(207, value)))
    blue = blue.point(lambda value: max(background[2], min(231, value)))
    return Image.merge('RGBA', (red, green, blue, alpha))


def render_app_icon(source: Image.Image, size: int, background=APP_ICON_BACKGROUND) -> Image.Image:
    if size > 64:
        if size == MASTER_SIZE:
            return source.copy()
        return clamp_approved_app_icon_palette(source.resize((size, size), Image.Resampling.LANCZOS), background)

    tile_alpha_source, mark_mask_source = approved_app_icon_masks(source)
    tile_alpha = tile_alpha_source.resize((size, size), Image.Resampling.LANCZOS)
    mark_mask = render_16px_optical_mark() if size == 16 else mark_mask_source.resize((size, size), Image.Resampling.LANCZOS)
    if size in APP_ICON_OPTICAL_SIZES and size != 16:
        mark_mask = mark_mask.point(lambda value: 255 if value >= 96 else 0)
    elif size <= 64 and size != 16:
        mark_mask = mark_mask.point(lambda value: 255 if value >= 112 else 0)

    image = Image.new('RGBA', (size, size), background)
    image.putalpha(tile_alpha)
    mark_layer = Image.new('RGBA', (size, size), APP_ICON_MARK)
    mark_layer.putalpha(ImageChops.multiply(mark_mask, tile_alpha))
    image.alpha_composite(mark_layer)
    return image


def save_app_icon_png(source: Image.Image, *, path: Path, size: int, background=APP_ICON_BACKGROUND) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    render_app_icon(source, size, background).save(path, format='PNG', optimize=True)


def save_app_icon_ico(source: Image.Image, *, path: Path, background=APP_ICON_BACKGROUND) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    frames = [render_app_icon(source, size[0], background) for size in ICON_SIZES]
    frames[-1].save(path, format='ICO', sizes=ICON_SIZES, append_images=frames[:-1])


def save_app_icon_icns(source: Image.Image, *, path: Path, background=APP_ICON_BACKGROUND) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    sizes = (16, 32, 64, 128, 256, 512, 1024)
    frames = [render_app_icon(source, size, background) for size in sizes]
    frames[-1].save(path, format='ICNS', append_images=frames[:-1])


def save_png(image: Image.Image, path: Path, size: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    output = image.resize((size, size), Image.Resampling.LANCZOS)
    output.save(path, format='PNG', optimize=True)


def main() -> None:
    icons_only = '--icons-only' in sys.argv[1:]
    preview = '--preview' in sys.argv[1:]
    clean_brand_path = BRANDING_DIR / 'zyra-mark.png'
    blueprint_path = BRANDING_DIR / 'zyra-blueprint.png'

    BRANDING_DIR.mkdir(parents=True, exist_ok=True)
    if not icons_only:
        clean_master = draw_clean_mark(MASTER_SIZE)
        blueprint_master = load_blueprint_master(MASTER_SIZE)
        RENDERER_BRANDING_DIR.mkdir(parents=True, exist_ok=True)
        save_png(clean_master, clean_brand_path, 1024)
        save_png(blueprint_master, blueprint_path, 1024)

    approved_app_icon = load_approved_app_icon_master()
    dev_app_icon = create_dev_icon_master(approved_app_icon)
    for file_name in APP_ICON_VARIANTS:
        variant_path = APP_ICON_DIR / file_name
        # Packaged Preview uses the prod runtime filename family. Only its CI
        # staging checkout redirects that family; stable generation stays blue.
        is_dev = preview or file_name.startswith('zyra-dev')
        source = dev_app_icon if is_dev else approved_app_icon
        background = DEV_ICON_BACKGROUND if is_dev else APP_ICON_BACKGROUND
        save_app_icon_png(source, path=variant_path, size=1024, background=background)
        save_app_icon_ico(source, path=variant_path.with_suffix('.ico'), background=background)

    icon_png = ROOT / 'resources' / 'icon.png'
    dev_icon_png = ROOT / 'resources' / 'icon-dev.png'
    packaged_icon = dev_app_icon if preview else approved_app_icon
    packaged_background = DEV_ICON_BACKGROUND if preview else APP_ICON_BACKGROUND
    save_app_icon_png(packaged_icon, path=icon_png, size=512, background=packaged_background)
    save_app_icon_png(dev_app_icon, path=dev_icon_png, size=512, background=DEV_ICON_BACKGROUND)
    save_app_icon_ico(packaged_icon, path=ROOT / 'resources' / 'icon.ico', background=packaged_background)
    save_app_icon_ico(dev_app_icon, path=ROOT / 'resources' / 'icon-dev.ico', background=DEV_ICON_BACKGROUND)
    save_app_icon_icns(packaged_icon, path=ROOT / 'resources' / 'icon.icns', background=packaged_background)
    linux_icon_dir = ROOT / 'resources' / 'icons'
    for size in LINUX_ICON_SIZES:
        save_app_icon_png(
            packaged_icon,
            path=linux_icon_dir / f'{size}x{size}.png',
            size=size,
            background=packaged_background
        )

    if not icons_only:
        if LANDING_PUBLIC_DIR.exists():
            shutil.copyfile(clean_brand_path, LANDING_PUBLIC_DIR / 'logo.png')
        shutil.copyfile(clean_brand_path, RENDERER_BRANDING_DIR / 'zyra-mark.png')
        shutil.copyfile(blueprint_path, RENDERER_BRANDING_DIR / 'zyra-blueprint.png')

    print('Generated branding assets:')
    if not icons_only:
        if BLUEPRINT_SOURCE_PATH.exists():
            print(f'  {BLUEPRINT_SOURCE_PATH.relative_to(ROOT)}')
        print(f'  {clean_brand_path.relative_to(ROOT)}')
        print(f'  {blueprint_path.relative_to(ROOT)}')
    for source_path in (DEV_ICON_SOURCE_PATH, PROD_ICON_SOURCE_PATH, APPROVED_ICON_SOURCE_PATH):
        print(f'  {source_path.relative_to(ROOT)}')
    for file_name in APP_ICON_VARIANTS:
        variant_path = APP_ICON_DIR / file_name
        print(f'  {variant_path.relative_to(ROOT)}')
        print(f"  {variant_path.with_suffix('.ico').relative_to(ROOT)}")
    print(f'  {icon_png.relative_to(ROOT)}')
    print(f'  {dev_icon_png.relative_to(ROOT)}')
    print(f"  {(ROOT / 'resources' / 'icon.ico').relative_to(ROOT)}")
    print(f"  {(ROOT / 'resources' / 'icon-dev.ico').relative_to(ROOT)}")
    print(f"  {(ROOT / 'resources' / 'icon.icns').relative_to(ROOT)}")
    for size in LINUX_ICON_SIZES:
        print(f"  {(ROOT / 'resources' / 'icons' / f'{size}x{size}.png').relative_to(ROOT)}")
    if not icons_only:
        if LANDING_PUBLIC_DIR.exists():
            print(f"  {(LANDING_PUBLIC_DIR / 'logo.png').relative_to(ROOT)}")
        print(f"  {(RENDERER_BRANDING_DIR / 'zyra-mark.png').relative_to(ROOT)}")
        print(f"  {(RENDERER_BRANDING_DIR / 'zyra-blueprint.png').relative_to(ROOT)}")


if __name__ == '__main__':
    main()

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path

from PIL import Image, ImageChops


ROOT = Path(__file__).resolve().parents[1]
RESOURCES = ROOT / 'resources'
ICONS = RESOURCES / 'branding' / 'icons'
EXPECTED_ICO_SIZES = {(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)}
EXPECTED_LINUX_ICON_SIZES = (16, 32, 48, 64, 128, 256, 512, 1024)
APPROVED_BACKGROUND = (4, 20, 43)
APPROVED_MARK = (57, 207, 231)
SOURCE_SHA256 = {
    'zyra-dev-source.png': '7002a38e25e9891f8319f792ed8cadbfa9c6f9b3d7b7b9041d65e9576dea46aa',
    'zyra-prod-source.png': 'cd80292c6a14ddf2730454e43c6443b1c4f67b45ed72552649f4e3bd1b7550d8',
    'zyra-flat-approved-source.png': '6281d7b37ab067d4485f6688b46cb9f8a62115a2ed8fec284413d0fa6781cffe'
}


def open_rgba(path: Path) -> Image.Image:
    assert path.exists(), f'Missing branding asset: {path.relative_to(ROOT)}'
    return Image.open(path).convert('RGBA')


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def assert_flat_approved_artwork(image: Image.Image, label: str) -> None:
    rgba = image.convert('RGBA')
    alpha = rgba.getchannel('A')
    bounds = alpha.getbbox()
    assert bounds is not None, f'{label} must contain the rounded-square tile'
    assert rgba.getpixel((0, 0))[3] <= 2, f'{label} must keep visually transparent corners'
    assert rgba.getpixel((rgba.width // 2, rgba.height // 2))[3] == 255, f'{label} center must stay opaque'

    opaque_colors = {
        pixel[:3]
        for pixel in rgba.getdata()
        if pixel[3] == 255
    }
    for red, green, blue in opaque_colors:
        assert APPROVED_BACKGROUND[0] <= red <= APPROVED_MARK[0], f'{label} introduced a red outer treatment'
        assert APPROVED_BACKGROUND[1] <= green <= APPROVED_MARK[1], f'{label} introduced a green glow or field'
        assert APPROVED_BACKGROUND[2] <= blue <= APPROVED_MARK[2], f'{label} introduced a blue glow or field'
    assert APPROVED_BACKGROUND in opaque_colors, f'{label} is missing the deep-blue field'
    assert any(red <= 65 and green >= 190 and blue >= 210 for red, green, blue in opaque_colors), f'{label} is missing the cyan Zyra mark'

    top_center = next(
        rgba.getpixel((rgba.width // 2, y))
        for y in range(bounds[1], rgba.height // 2)
        if rgba.getpixel((rgba.width // 2, y))[3] == 255
    )
    assert max(abs(channel - expected) for channel, expected in zip(top_center[:3], APPROVED_BACKGROUND)) <= 5, f'{label} must not draw a cyan outer border'


def count_mark_pixels(image: Image.Image) -> int:
    rgba = image.convert('RGBA')
    return sum(
        1
        for red, green, blue, alpha in rgba.getdata()
        if alpha > 0 and green > 120 and blue > 120 and red < 100
    )


def assert_optical_mark(frame: Image.Image, label: str) -> None:
    rgba = frame.convert('RGBA')
    mark_pixels = count_mark_pixels(rgba)
    minimum = {16: 22, 24: 40, 32: 68}.get(rgba.width, max(8, rgba.width))
    assert mark_pixels >= minimum, f'{label} collapsed the Zyra mark at {rgba.width}px'

    width = rgba.width
    quadrants = [
        (0, 0, width // 2, width // 2),
        (width // 2, 0, width, width // 2),
        (0, width // 2, width // 2, width),
        (width // 2, width // 2, width, width)
    ]
    assert all(count_mark_pixels(rgba.crop(box)) > 0 for box in quadrants), f'{label} lost part of the supplied mark geometry'


def assert_images_identical(left: Path, right: Path) -> None:
    difference = ImageChops.difference(open_rgba(left), open_rgba(right))
    assert difference.getbbox() is None, f'{left.name} and {right.name} must use the same approved artwork'


def main() -> None:
    for file_name, expected_hash in SOURCE_SHA256.items():
        path = ICONS / file_name
        assert path.exists(), f'Missing source artwork: {file_name}'
        assert sha256(path) == expected_hash, f'{file_name} must remain unchanged'

    assert open_rgba(ICONS / 'zyra-dev-source.png').size == (1536, 1024)
    assert open_rgba(ICONS / 'zyra-prod-source.png').size == (1536, 1024)
    approved_source = open_rgba(ICONS / 'zyra-flat-approved-source.png')
    assert approved_source.size == (1024, 1024)

    variant_names = [
        f'zyra-{family}{suffix}.png'
        for family in ('dev', 'prod')
        for suffix in ('', '-light', '-dark')
    ]
    reference_variant = ICONS / variant_names[0]
    assert_images_identical(ICONS / 'zyra-flat-approved-source.png', reference_variant)
    for file_name in variant_names:
        icon_path = ICONS / file_name
        image = open_rgba(icon_path)
        assert image.size == (1024, 1024), f'{file_name} must remain a 1024px master'
        assert_flat_approved_artwork(image, file_name)
        assert_images_identical(reference_variant, icon_path)

        variant_ico = Image.open(icon_path.with_suffix('.ico'))
        assert EXPECTED_ICO_SIZES.issubset(set(variant_ico.ico.sizes())), f'{file_name} runtime ICO is incomplete'
        for size in ((16, 16), (24, 24), (32, 32)):
            assert_optical_mark(variant_ico.ico.getimage(size), f'{file_name} ICO')

    for file_name in ('icon.png', 'icon-dev.png'):
        image = open_rgba(RESOURCES / file_name)
        assert image.size == (512, 512), f'{file_name} must be 512px square'
        assert_flat_approved_artwork(image, file_name)
    assert_images_identical(RESOURCES / 'icon.png', RESOURCES / 'icon-dev.png')

    for file_name in ('icon.ico', 'icon-dev.ico'):
        path = RESOURCES / file_name
        image = Image.open(path)
        sizes = set(image.ico.sizes()) if hasattr(image, 'ico') else {image.size}
        assert EXPECTED_ICO_SIZES.issubset(sizes), f'{file_name} is missing Windows icon sizes: {EXPECTED_ICO_SIZES - sizes}'
        for size in sorted(EXPECTED_ICO_SIZES):
            frame = image.ico.getimage(size).convert('RGBA')
            assert frame.size == size
            assert_flat_approved_artwork(frame, f'{file_name} {size[0]}px')
            if size[0] <= 32:
                assert_optical_mark(frame, file_name)

    icns_path = RESOURCES / 'icon.icns'
    icns = Image.open(icns_path)
    icns_sizes = set(icns.info.get('sizes', []))
    assert {(16, 16, 2), (256, 256, 1), (512, 512, 2)}.issubset(icns_sizes), 'icon.icns is missing required macOS representations'
    for representation in ((16, 16, 2), (256, 256, 1), (512, 512, 2)):
        frame = icns.icns.getimage(representation).convert('RGBA')
        assert_flat_approved_artwork(frame, f'icon.icns {frame.width}px')
        if frame.width <= 32:
            assert_optical_mark(frame, 'icon.icns')

    for size in EXPECTED_LINUX_ICON_SIZES:
        icon_path = RESOURCES / 'icons' / f'{size}x{size}.png'
        image = open_rgba(icon_path)
        assert image.size == (size, size), f'{icon_path.name} must match its Linux icon size'
        assert_flat_approved_artwork(image, icon_path.name)
        if size <= 32:
            assert_optical_mark(image, icon_path.name)

    package = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))
    build = package['build']
    assert build['icon'] == 'resources/icon.png', 'production packaging must use the approved PNG master'
    assert build['win']['icon'] == 'resources/icon.ico', 'Windows packaging must use the approved ICO family'
    assert build['mac']['icon'] == 'resources/icon.icns', 'macOS packaging must use the approved ICNS family'
    assert build['linux']['icon'] == 'resources/icons', 'Linux packaging must use the approved PNG family'
    assert build['fileAssociations'][0]['icon'] == 'resources/icon', 'file associations must resolve the platform-correct icon extension'
    assert '!resources/branding/icons/*-source.png' in build['files'], 'source artwork must stay out of packaged apps'

    main_source = (ROOT / 'src' / 'main' / 'index.ts').read_text(encoding='utf-8')
    assert "runtimeIdentity.isDevRuntime ? 'dev' : 'prod'" in main_source, 'runtime filenames still distinguish dev and production metadata'
    assert "nativeTheme.shouldUseDarkColors ? 'dark' : 'light'" in main_source, 'runtime window icon filenames still follow the OS theme'
    assert "process.platform === 'win32' ? 'ico' : 'png'" in main_source, 'Windows runtime icons must use real size-specific ICO mip levels'
    theme_update = re.search(r"nativeTheme\.on\('updated',\s*\(\)\s*=>\s*\{(.*?)\}\)", main_source, re.S)
    assert theme_update and 'syncOpenWindowIcons()' in theme_update.group(1), 'open windows must refresh after an OS theme change, including when the handler also refreshes overlays'

    generator_source = (ROOT / 'scripts' / 'maint' / 'generate_branding_assets.py').read_text(encoding='utf-8')
    assert 'ImageEnhance' not in generator_source, 'the generator cannot reintroduce tonal or gradient treatments'
    assert 'border_color' not in generator_source and 'outline_color' not in generator_source, 'the generator cannot invent an outer border or mark halo'
    assert 'APP_ICON_OPTICAL_SIZES = {16, 24, 32}' in generator_source, 'small system icons require explicit optical variants'

    print('Zyra branding asset contract: ok')


if __name__ == '__main__':
    main()

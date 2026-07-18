#!/usr/bin/env python3
"""Build the home brand kit from deterministic geometry and the social backdrop."""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont, ImageOps


ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / "source" / "social-background.png"

DARK = "#12100e"
GOLD = "#d7a94b"
IVORY = "#f5f1e8"
CYAN = "#5fb8cb"
MUTED = "#aaa097"

MONO = Path("/System/Library/Fonts/SFNSMono.ttf")
MONO_SEMIBOLD = Path("/System/Library/Fonts/SFNSMonoSemibold.ttf")


def scaled(value: float, scale: int) -> int:
    return round(value * scale)


def points(values: list[tuple[float, float]], scale: int) -> list[tuple[int, int]]:
    return [(scaled(x, scale), scaled(y, scale)) for x, y in values]


def rounded_line(
    draw: ImageDraw.ImageDraw,
    coordinates: list[tuple[float, float]],
    *,
    fill: str,
    width: float,
    scale: int,
) -> None:
    line = points(coordinates, scale)
    stroke = scaled(width, scale)
    draw.line(line, fill=fill, width=stroke, joint="curve")
    radius = stroke // 2
    for x, y in (line[0], line[-1]):
        draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=fill)


def render_mark(size: int) -> Image.Image:
    scale = max(4, 2048 // size)
    canvas_size = size * scale
    logical_scale = canvas_size // 512
    image = Image.new("RGBA", (canvas_size, canvas_size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)

    draw.rounded_rectangle(
        (
            scaled(9, logical_scale),
            scaled(9, logical_scale),
            scaled(503, logical_scale),
            scaled(503, logical_scale),
        ),
        radius=scaled(99, logical_scale),
        fill=DARK,
        outline=GOLD,
        width=scaled(14, logical_scale),
    )
    bracket_width = scaled(18, logical_scale)
    draw.line(
        points([(78, 148), (78, 78), (148, 78)], logical_scale),
        fill=GOLD,
        width=bracket_width,
        joint="curve",
    )
    cap_radius = bracket_width // 2
    for x, y in points([(78, 148), (148, 78)], logical_scale):
        draw.ellipse(
            (x - cap_radius, y - cap_radius, x + cap_radius, y + cap_radius),
            fill=GOLD,
        )

    draw.polygon(
        points(
            [(112, 253), (256, 126), (400, 253), (370, 253), (370, 382), (142, 382), (142, 253)],
            logical_scale,
        ),
        fill=IVORY,
    )
    draw.polygon(
        points(
            [(256, 126), (400, 253), (370, 253), (256, 153), (142, 253), (112, 253)],
            logical_scale,
        ),
        fill=CYAN,
    )
    draw.rounded_rectangle(
        (
            scaled(168, logical_scale),
            scaled(235, logical_scale),
            scaled(344, logical_scale),
            scaled(343, logical_scale),
        ),
        radius=scaled(22, logical_scale),
        fill=DARK,
    )
    rounded_line(
        draw,
        [(202, 267), (230, 289), (202, 311)],
        fill=CYAN,
        width=17,
        scale=logical_scale,
    )
    rounded_line(
        draw,
        [(256, 311), (304, 311)],
        fill=GOLD,
        width=16,
        scale=logical_scale,
    )
    draw.polygon(
        points([(426, 400), (444, 418), (426, 436), (408, 418)], logical_scale),
        fill=GOLD,
    )

    return image.resize((size, size), Image.Resampling.LANCZOS)


def font(size: int, *, semibold: bool = False) -> ImageFont.FreeTypeFont:
    path = MONO_SEMIBOLD if semibold and MONO_SEMIBOLD.exists() else MONO
    return ImageFont.truetype(str(path), size=size)


def darken_left(image: Image.Image, boundary: float = 0.62) -> Image.Image:
    width, height = image.size
    overlay = Image.new("RGBA", image.size, (18, 16, 14, 0))
    alpha = Image.new("L", image.size)
    pixels = alpha.load()
    for x in range(width):
        progress = x / width
        if progress <= 0.42:
            opacity = 242
        elif progress >= boundary:
            opacity = 0
        else:
            opacity = round(242 * (boundary - progress) / (boundary - 0.42))
        for y in range(height):
            pixels[x, y] = opacity
    overlay.putalpha(alpha.filter(ImageFilter.GaussianBlur(radius=12)))
    return Image.alpha_composite(image.convert("RGBA"), overlay)


def social_card(size: tuple[int, int], footer: str) -> Image.Image:
    if not SOURCE.exists():
        raise FileNotFoundError(f"Missing generated social backdrop: {SOURCE}")

    backdrop = Image.open(SOURCE).convert("RGB")
    backdrop = ImageOps.fit(backdrop, size, method=Image.Resampling.LANCZOS, centering=(0.5, 0.5))
    backdrop = ImageEnhance.Contrast(backdrop).enhance(1.04)
    backdrop = ImageEnhance.Color(backdrop).enhance(0.92)
    image = darken_left(backdrop.convert("RGBA"))
    draw = ImageDraw.Draw(image)

    width, height = size
    unit = height / 630
    node_x = round(width * 0.477)
    node_y = round(height * 0.654)
    node_rx = round(24 * unit)
    node_ry = round(15 * unit)
    draw.ellipse(
        (node_x - node_rx, node_y - node_ry, node_x + node_rx, node_y + node_ry),
        fill="#171512",
    )
    node_points = [
        (node_x - round(11 * unit), node_y + round(4 * unit)),
        (node_x, node_y - round(6 * unit)),
        (node_x + round(11 * unit), node_y + round(4 * unit)),
    ]
    draw.line(node_points + [node_points[0]], fill=CYAN, width=max(1, round(2 * unit)))
    radius = max(2, round(3 * unit))
    for x, y in node_points:
        draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=CYAN)

    left = round(76 * unit)
    top = round(82 * unit)

    draw.text((left, top), "home", font=font(round(50 * unit)), fill=GOLD)
    headline_font = font(round(66 * unit), semibold=True)
    line_gap = round(76 * unit)
    headline_top = top + round(90 * unit)
    draw.text((left, headline_top), "One CLI for", font=headline_font, fill=IVORY)
    draw.text((left, headline_top + line_gap), "the homelab.", font=headline_font, fill=IVORY)

    label_top = headline_top + line_gap * 2 + round(38 * unit)
    draw.text(
        (left, label_top),
        "SERVICES · OPERATIONS · AGENT-READY SKILLS",
        font=font(round(18 * unit), semibold=True),
        fill=GOLD,
    )
    draw.text(
        (left, height - round(92 * unit)),
        footer,
        font=font(round(21 * unit)),
        fill=MUTED,
    )
    return image.convert("RGB")


def save_png(image: Image.Image, path: Path, *, colors: int | None = None) -> None:
    output = image
    if colors is not None:
        output = image.quantize(colors=colors, method=Image.Quantize.MEDIANCUT)
    output.save(path, format="PNG", optimize=True)


def main() -> None:
    icon_512 = render_mark(512)
    save_png(icon_512, ROOT / "icon.png")
    save_png(icon_512, ROOT / "icon-512.png")
    save_png(render_mark(192), ROOT / "icon-192.png")
    save_png(render_mark(180), ROOT / "apple-icon.png")

    icon_512.save(
        ROOT / "favicon.ico",
        format="ICO",
        sizes=[(16, 16), (32, 32), (48, 48)],
        bitmap_format="png",
    )

    save_png(
        social_card((1200, 630), "home.uptonm.dev"),
        ROOT / "og.png",
        colors=256,
    )
    save_png(
        social_card((1280, 640), "github.com/uptonm/home"),
        ROOT / "github-social-preview.png",
        colors=256,
    )


if __name__ == "__main__":
    main()

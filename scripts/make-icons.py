"""生成应用图标（build/icon.png + 各尺寸 ICO/ICNS 输入）。

图案取自应用顶栏 logo 的 Aperture 光圈：玫瑰色渐变圆角方块 + 白色光圈叶片。
用 Pillow 以矢量式绘制（多边形 + 径向渐变模拟），任何尺寸都清晰。
运行：python scripts/make-icons.py
"""
import math
import os

from PIL import Image, ImageDraw

OUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "build")


def rounded_gradient_base(size: int) -> Image.Image:
    """玫瑰→橙渐变的圆角方块背景。"""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    grad = Image.new("RGBA", (size, size))
    top = (244, 63, 94)    # rose-500
    bottom = (249, 115, 22)  # orange-500
    px = grad.load()
    for y in range(size):
        t = y / max(1, size - 1)
        r = int(top[0] + (bottom[0] - top[0]) * t)
        g = int(top[1] + (bottom[1] - top[1]) * t)
        b = int(top[2] + (bottom[2] - top[2]) * t)
        for x in range(size):
            px[x, y] = (r, g, b, 255)
    mask = Image.new("L", (size, size), 0)
    md = ImageDraw.Draw(mask)
    radius = int(size * 0.22)
    md.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    img.paste(grad, (0, 0), mask)
    return img


def draw_aperture(img: Image.Image) -> None:
    """在背景中央绘制白色 Aperture 光圈（6 叶片）。"""
    size = img.size[0]
    d = ImageDraw.Draw(img)
    cx = cy = size / 2
    r_outer = size * 0.30
    ring_w = size * 0.055
    # 外圈
    d.ellipse(
        [cx - r_outer, cy - r_outer, cx + r_outer, cy + r_outer],
        outline=(255, 255, 255, 255),
        width=max(2, int(ring_w)),
    )
    # 6 片叶片：从外圈切线扫向中心（模拟光圈叶片形状）
    blades = 6
    for i in range(blades):
        a0 = (360 / blades) * i - 90
        a1 = a0 + 360 / blades * 0.62
        a2 = a0 + 360 / blades * 0.5
        p_outer = (
            cx + r_outer * 0.97 * math.cos(math.radians(a0)),
            cy + r_outer * 0.97 * math.sin(math.radians(a0)),
        )
        p_mid = (
            cx + r_outer * 0.52 * math.cos(math.radians(a1)),
            cy + r_outer * 0.52 * math.sin(math.radians(a1)),
        )
        p_inner = (
            cx + r_outer * 0.16 * math.cos(math.radians(a2)),
            cy + r_outer * 0.16 * math.sin(math.radians(a2)),
        )
        # 叶片：从外圈到内圈的弯钩多边形
        d.polygon([p_outer, p_mid, p_inner], fill=(255, 255, 255, 255))


def main() -> None:
    os.makedirs(OUT_DIR, exist_ok=True)
    # 1024 主图（electron-builder 会自动缩出各平台所需尺寸）
    big = rounded_gradient_base(1024)
    draw_aperture(big)
    big.save(os.path.join(OUT_DIR, "icon.png"))
    # 256 图（ICO 内含多尺寸）
    for s in (256, 128, 64, 48, 32, 16):
        im = rounded_gradient_base(s)
        draw_aperture(im)
        im.save(os.path.join(OUT_DIR, f"icon-{s}.png"))
    # Windows ICO（内嵌多尺寸，资源管理器各视图清晰）
    icons = [Image.open(os.path.join(OUT_DIR, f"icon-{s}.png")) for s in (256, 128, 64, 48, 32, 16)]
    icons[0].save(
        os.path.join(OUT_DIR, "icon.ico"),
        format="ICO",
        sizes=[(s, s) for s in (256, 128, 64, 48, 32, 16)],
    )
    print("icons written to", OUT_DIR)


if __name__ == "__main__":
    main()

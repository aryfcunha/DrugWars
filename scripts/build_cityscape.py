"""
Convert reference.png -> src/ui/Cityscape.tsx as a faithful pixel-art SVG.

Pipeline:
  1. Detect the native pixel-block size of the source (image is rendered pixel
     art at a higher display resolution; we want to recover the actual grid).
  2. Downsample to that native resolution via mode (most-frequent color)
     per block — preserves crisp edges instead of smearing them.
  3. Quantize palette to N colors (default 64) using PIL's median-cut.
  4. Horizontal run-length encode rows -> SVG <rect> elements.
  5. Emit a self-contained React component.
"""
from __future__ import annotations
from collections import Counter
from pathlib import Path
import sys

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "reference.png"
SVG_OUT = ROOT / "public" / "cityscape.svg"
TSX_OUT = ROOT / "src" / "ui" / "Cityscape.tsx"
DEBUG_DUMP = ROOT / "scripts" / "downsample_debug.png"

# Target native grid (will be chosen automatically from candidates below).
CANDIDATE_BLOCKS = [4, 6, 8, 10, 12, 16]
MAX_PALETTE = 64
# Hard cap on output native resolution width — anything wider downsamples again.
MAX_WIDTH = 480


def detect_block_size(im: Image.Image) -> int:
    """Pick the block size that yields the lowest mean intra-block color variance."""
    w, h = im.size
    px = im.convert("RGB").load()

    best, best_score = None, float("inf")
    for b in CANDIDATE_BLOCKS:
        # Sample many blocks, compute average color spread within each
        score = 0.0
        n = 0
        for by in range(0, h - b, max(1, h // 20)):
            for bx in range(0, w - b, max(1, w // 20)):
                rs, gs, bs = [], [], []
                for dy in range(b):
                    for dx in range(b):
                        r, g, bl = px[bx + dx, by + dy]
                        rs.append(r); gs.append(g); bs.append(bl)
                # spread = (max-min) per channel, summed
                score += (max(rs) - min(rs)) + (max(gs) - min(gs)) + (max(bs) - min(bs))
                n += 1
        score /= n
        print(f"  block={b}: spread_score={score:.1f}")
        # Prefer the LARGEST block size whose score is still close to the minimum
        # (small blocks always win on variance but lose on faithfulness to source's
        # actual native grid). Use a soft criterion.
        if score < best_score:
            best_score = score
            best = b

    # Take the largest block within 20% of best_score (we want the true native size)
    chosen = best
    for b in sorted(CANDIDATE_BLOCKS, reverse=True):
        # re-measure
        score = 0.0
        n = 0
        for by in range(0, h - b, max(1, h // 20)):
            for bx in range(0, w - b, max(1, w // 20)):
                rs, gs, bs = [], [], []
                for dy in range(b):
                    for dx in range(b):
                        r, g, bl = px[bx + dx, by + dy]
                        rs.append(r); gs.append(g); bs.append(bl)
                score += (max(rs) - min(rs)) + (max(gs) - min(gs)) + (max(bs) - min(bs))
                n += 1
        score /= n
        if score <= best_score * 1.25:
            chosen = b
            break
    print(f"  -> chosen block={chosen}")
    return chosen


def mode_downsample(im: Image.Image, block: int) -> Image.Image:
    """Downsample by taking the most-frequent color in each block."""
    w, h = im.size
    nw, nh = w // block, h // block
    src = im.convert("RGB").load()
    out = Image.new("RGB", (nw, nh))
    op = out.load()
    for by in range(nh):
        for bx in range(nw):
            counter: Counter[tuple[int, int, int]] = Counter()
            for dy in range(block):
                for dx in range(block):
                    counter[src[bx * block + dx, by * block + dy]] += 1
            op[bx, by] = counter.most_common(1)[0][0]
    return out


def rgb_to_hex(rgb: tuple[int, int, int]) -> str:
    return "#%02x%02x%02x" % rgb


def patch_bottom_right_logo(im: Image.Image) -> Image.Image:
    """Clone pavement from the left to mask out the Gemini sparkle in the
    bottom-right corner. Operates on the post-downsample image.

    Mask region is the bottom-right ~12% wide × 18% tall block; donor pixels
    come from the same y-range, shifted left by half the mask width."""
    w, h = im.size
    mask_w = int(w * 0.12)
    mask_h = int(h * 0.18)
    x0 = w - mask_w
    y0 = h - mask_h
    donor_dx = -int(mask_w * 1.6)  # clone from further left so we don't overlap
    px = im.load()
    # Sample donor pixels first into a buffer so we don't read freshly-written cells
    buf: dict[tuple[int, int], tuple[int, int, int]] = {}
    for y in range(y0, h):
        for x in range(x0, w):
            sx = x + donor_dx
            sy = y
            if sx < 0:
                sx = 0
            buf[(x, y)] = px[sx, sy]
    for (x, y), c in buf.items():
        px[x, y] = c
    print(f"Patched bottom-right logo: ({x0},{y0})..({w},{h}) "
          f"<- clone from dx={donor_dx}")
    return im


def emit_svg(im: Image.Image) -> tuple[str, int]:
    """Horizontal RLE -> raw SVG string. Groups same-color rects under one fill
    to keep file size down (one <g fill=#...> per palette color, with the rects
    inside as path data 'M x y h w v 1 H x Z' segments)."""
    w, h = im.size
    px = im.load()
    # color -> list[(x, y, run)]
    groups: dict[tuple[int, int, int], list[tuple[int, int, int]]] = {}
    total_rects = 0
    for y in range(h):
        x = 0
        while x < w:
            c = px[x, y]
            x0 = x
            while x < w and px[x, y] == c:
                x += 1
            run = x - x0
            groups.setdefault(c, []).append((x0, y, run))
            total_rects += 1
    parts = [f'<?xml version="1.0" encoding="UTF-8"?>',
             f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" '
             f'shape-rendering="crispEdges" preserveAspectRatio="xMidYMid meet">']
    for c, runs in groups.items():
        d = "".join(f"M{x} {y}h{run}v1H{x}Z" for (x, y, run) in runs)
        parts.append(f'<path fill="{rgb_to_hex(c)}" d="{d}"/>')
    parts.append('</svg>')
    return "".join(parts), total_rects


TSX_TEMPLATE = """// Cityscape — references public/cityscape.svg, generated from reference.png
// via scripts/build_cityscape.py. To regenerate: py scripts/build_cityscape.py

export function Cityscape() {
  return (
    <img
      src={`${import.meta.env.BASE_URL}cityscape.svg`}
      alt="NYC noir cityscape"
      style={{
        width: '100%',
        height: 'auto',
        display: 'block',
        imageRendering: 'pixelated',
      }}
      draggable={false}
    />
  );
}
"""


def main() -> int:
    im = Image.open(SRC).convert("RGB")
    print(f"Source: {im.size}")

    block = detect_block_size(im)
    native = mode_downsample(im, block)
    print(f"Native grid: {native.size}")

    # If still too wide, downsample further (mode) to MAX_WIDTH
    if native.size[0] > MAX_WIDTH:
        scale = native.size[0] / MAX_WIDTH
        b2 = max(2, round(scale))
        native = mode_downsample(native, b2)
        print(f"Further downsampled to: {native.size}")

    # Patch out the Gemini sparkle in the bottom-right corner by cloning
    # pavement from the same y-range offset to the left.
    native = patch_bottom_right_logo(native)

    # Quantize palette
    pal = native.quantize(colors=MAX_PALETTE, method=Image.Quantize.MEDIANCUT).convert("RGB")
    print(f"Quantized to <= {MAX_PALETTE} colors")

    # Debug dump
    pal.save(DEBUG_DUMP)
    print(f"Debug dump: {DEBUG_DUMP}")

    svg, rects = emit_svg(pal)
    SVG_OUT.parent.mkdir(parents=True, exist_ok=True)
    SVG_OUT.write_text(svg, encoding="utf-8")
    TSX_OUT.write_text(TSX_TEMPLATE, encoding="utf-8")
    print(f"SVG rect count (horizontal RLE): {rects}")
    print(f"Wrote: {SVG_OUT} ({SVG_OUT.stat().st_size / 1024:.1f} KB)")
    print(f"Wrote: {TSX_OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

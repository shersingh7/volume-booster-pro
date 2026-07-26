#!/usr/bin/env python3
"""
Generate Chrome Web Store visual assets for Volume Booster Pro.

Produces:
  store-assets/logo-master-1024.png
  store-assets/store-icon-128.png
  store-assets/screenshot-01-control-1280x800.png
  store-assets/screenshot-02-boost-1280x800.png
  store-assets/screenshot-03-max-1280x800.png
  store-assets/promo-tile-440x280.png
  icons/icon{16,32,48,128}.png

Requires: Pillow, Playwright (Chromium).
Run:  .venv-assets/bin/python scripts/generate-store-assets.py
"""

from __future__ import annotations

import math
import os
import struct
import sys
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
STORE = ROOT / "store-assets"
ICONS = ROOT / "icons"
POPUP_HTML = ROOT / "popup.html"

# Palette — Signal Chassis
BONE = (228, 221, 208, 255)  # #e4ddd0
BONE_DEEP = (213, 205, 189, 255)
BONE_EDGE = (184, 174, 156, 255)
CHARCOAL = (26, 24, 20, 255)  # #1a1814
LCD = (18, 20, 16, 255)  # #121410
LCD_BEZEL = (42, 44, 38, 255)
SIGNAL = (255, 92, 20, 255)  # #ff5c14
SIGNAL_DEEP = (201, 68, 10, 255)
INK_MUTED = (122, 116, 104, 255)
INK_FAINT = (154, 148, 136, 255)
WHITE_SOFT = (245, 240, 230, 255)
TRANSPARENT = (0, 0, 0, 0)

POPUP_W, POPUP_H = 380, 540
SHOT_W, SHOT_H = 1280, 800


def _require_pillow():
    try:
        from PIL import Image, ImageDraw, ImageFilter, ImageFont  # noqa: F401
    except ImportError as e:
        print("Pillow is required. Install with: pip install pillow", file=sys.stderr)
        raise SystemExit(1) from e
    return __import__("PIL.Image", fromlist=["Image"]).Image


def load_font(size: int, bold: bool = False, condensed: bool = False):
    """Load a high-quality local macOS font via Pillow."""
    from PIL import ImageFont

    candidates = []
    if condensed and bold:
        candidates += [
            "/System/Library/Fonts/Supplemental/Arial Narrow Bold.ttf",
            "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
        ]
    elif condensed:
        candidates += [
            "/System/Library/Fonts/Supplemental/Arial Narrow.ttf",
            "/System/Library/Fonts/Supplemental/Arial.ttf",
        ]
    elif bold:
        candidates += [
            "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
            "/System/Library/Fonts/Supplemental/Arial Black.ttf",
            "/System/Library/Fonts/Helvetica.ttc",
        ]
    else:
        candidates += [
            "/System/Library/Fonts/Supplemental/Arial.ttf",
            "/System/Library/Fonts/Helvetica.ttc",
            "/Library/Fonts/Arial.ttf",
        ]
    # SF / Helvetica as last resorts
    candidates += [
        "/System/Library/Fonts/SFNS.ttf",
        "/System/Library/Fonts/Supplemental/Arial.ttf",
    ]
    for path in candidates:
        if os.path.isfile(path):
            try:
                if path.endswith(".ttc"):
                    return ImageFont.truetype(path, size=size, index=0)
                return ImageFont.truetype(path, size=size)
            except OSError:
                continue
    return ImageFont.load_default()


def rounded_rect(draw, box, radius, fill, outline=None, width=1):
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


def draw_logo_mark(size: int = 1024):
    """
    Original abstract speaker + fader mark.
    Warm bone plate, near-black module, fluorescent orange signal thumb.
    Generous safe margins for Chrome visual crop; strong 16px silhouette.
    """
    from PIL import Image, ImageDraw

    img = Image.new("RGBA", (size, size), TRANSPARENT)
    d = ImageDraw.Draw(img)

    # Safe area ~14% padding (Chrome crops store icons aggressively)
    pad = size * 0.12
    outer = [pad, pad, size - pad, size - pad]
    r_outer = size * 0.18

    # Warm bone chassis plate
    rounded_rect(d, outer, r_outer, BONE)

    # Subtle edge ring
    inset = size * 0.018
    rounded_rect(
        d,
        [outer[0] + inset, outer[1] + inset, outer[2] - inset, outer[3] - inset],
        r_outer - inset,
        None,
        outline=BONE_EDGE,
        width=max(1, size // 256),
    )

    # Near-black hardware module
    mpad = size * 0.20
    module = [mpad, mpad, size - mpad, size - mpad]
    r_mod = size * 0.12
    rounded_rect(d, module, r_mod, CHARCOAL)

    # Inner LCD-ish well
    ipad = size * 0.235
    well = [ipad, ipad, size - ipad, size - ipad]
    rounded_rect(d, well, r_mod * 0.75, LCD)

    cx = size / 2
    cy = size / 2

    # Abstract speaker / gain bars: three horizontal hardware segments.
    # Drawn top→bottom: longest (loud) on top in fluorescent orange so the
    # signal mass survives 16px downscale / Chrome crop.
    bar_left = size * 0.28
    bar_right_max = size * 0.58
    bar_h = size * 0.095
    gap = size * 0.045
    bar_radii = max(2, int(size * 0.022))
    # (length_frac, fill) top → bottom
    bars = [
        (1.0, SIGNAL),      # loud / signal
        (0.72, BONE),
        (0.45, WHITE_SOFT),  # quiet
    ]
    total_h = 3 * bar_h + 2 * gap
    y0 = cy - total_h / 2
    for i, (frac, fill) in enumerate(bars):
        y = y0 + i * (bar_h + gap)
        w = (bar_right_max - bar_left) * frac
        x0 = bar_left
        x1 = bar_left + w
        rounded_rect(d, [x0, y, x1, y + bar_h], bar_radii, fill)

    # Vertical fader (right): thick groove + solid orange thumb
    track_x = size * 0.66
    track_w = size * 0.09
    track_top = size * 0.30
    track_bot = size * 0.70
    rounded_rect(
        d,
        [track_x, track_top, track_x + track_w, track_bot],
        track_w / 2,
        LCD_BEZEL,
    )
    # Orange fill column (strong signal mass for small sizes)
    thumb_cy = size * 0.38
    rounded_rect(
        d,
        [track_x + track_w * 0.18, thumb_cy, track_x + track_w * 0.82, track_bot],
        track_w * 0.25,
        SIGNAL,
    )
    # Blocky fader thumb
    thumb_h = size * 0.12
    thumb_pad = size * 0.02
    rounded_rect(
        d,
        [
            track_x - thumb_pad,
            thumb_cy - thumb_h / 2,
            track_x + track_w + thumb_pad,
            thumb_cy + thumb_h / 2,
        ],
        size * 0.025,
        SIGNAL,
    )
    # Center highlight
    d.line(
        [
            (track_x - thumb_pad + size * 0.015, thumb_cy),
            (track_x + track_w + thumb_pad - size * 0.015, thumb_cy),
        ],
        fill=(255, 190, 140, 230),
        width=max(2, size // 128),
    )

    return img


def downscale_logo(master: "Image.Image", size: int) -> "Image.Image":
    from PIL import Image

    # For very small sizes, re-render at target size so signal mass stays solid
    # (pure LANCZOS from 1024 can wash pure orange into brown mush).
    if size <= 32:
        return draw_logo_mark(size)
    return master.resize((size, size), Image.Resampling.LANCZOS)


def verify_icon_16(icon16: "Image.Image") -> None:
    """Programmatic 16px checks: non-empty alpha, orange+dark present, not blank."""
    from PIL import Image

    assert icon16.size == (16, 16)
    assert icon16.mode == "RGBA"
    px = list(icon16.getdata())
    opaque = [p for p in px if p[3] > 40]
    if len(opaque) < 40:
        raise RuntimeError("icon16 too sparse — silhouette may vanish")
    # Detect near-black and orange signal
    dark = sum(1 for p in opaque if p[0] < 60 and p[1] < 60 and p[2] < 60)
    # Orange / signal: high R, G clearly below R, not pure bone
    orange = sum(
        1
        for p in opaque
        if p[0] > 160 and p[1] < 170 and p[2] < 120 and (p[0] - p[1]) > 40
    )
    bone = sum(
        1
        for p in opaque
        if p[0] > 180 and p[1] > 170 and p[2] > 150 and abs(p[0] - p[1]) < 40
    )
    if dark < 8:
        raise RuntimeError("icon16 missing near-black mass")
    if orange < 2:
        raise RuntimeError("icon16 missing fluorescent orange signal")
    if bone < 4:
        raise RuntimeError("icon16 missing warm bone field")
    print(
        f"  icon16 OK — opaque={len(opaque)} dark={dark} orange={orange} bone={bone}"
    )


def make_favicon_data_uri() -> str:
    """Tiny deterministic red play-style mark as PNG data URI (no remote assets)."""
    # 16x16 RGBA red rounded square with white triangle — simple YouTube-ish local mark
    w, h = 16, 16
    raw = bytearray()
    for y in range(h):
        raw.append(0)  # filter none
        for x in range(w):
            # circle-ish red pad
            cx, cy = 7.5, 7.5
            dist = math.hypot(x - cx, y - cy)
            # white play triangle pointing right
            in_tri = (
                x >= 6
                and x <= 11
                and y >= 4
                and y <= 11
                and (x - 6) <= (y - 4) * 0.9 + 0.5
                and (x - 6) <= (11 - y) * 0.9 + 0.5
            )
            if dist <= 7.2:
                if in_tri and dist <= 6.5:
                    r, g, b, a = 255, 255, 255, 255
                else:
                    r, g, b, a = 200, 40, 40, 255
            else:
                r, g, b, a = 0, 0, 0, 0
            raw.extend((r, g, b, a))

    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    ihdr = struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)
    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", ihdr)
    png += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
    png += chunk(b"IEND", b"")
    import base64

    return "data:image/png;base64," + base64.b64encode(png).decode("ascii")


def chrome_mock_script(volume: int) -> str:
    """Deterministic chrome.* mock injected before popup.js runs."""
    fav = make_favicon_data_uri()
    # Percent-format avoids f-string conflicts with JS braces.
    return """
(() => {
  const SAVED = %d;
  const TAB_ID = 42;
  const favicon = %s;
  const statusReady = {
    ok: true,
    started: true,
    contextState: 'running',
    mediaCount: 1,
    hookedCount: 1,
    code: 'OK'
  };
  const storage = {};
  storage['vol_' + TAB_ID] = SAVED;

  const chromeMock = {
    tabs: {
      query: async (q) => ([{
        id: TAB_ID,
        title: 'Late Night Mix — Live Session',
        url: 'https://www.youtube.com/watch?v=store-asset-preview',
        favIconUrl: favicon,
        discarded: false,
        active: true,
        status: 'complete'
      }]),
      sendMessage: async (tabId, message) => {
        if (!message || typeof message !== 'object') return statusReady;
        if (message.action === 'getStatus') return Object.assign({}, statusReady);
        if (message.action === 'setVolume') {
          return Object.assign({}, statusReady, { volume: message.volume });
        }
        return Object.assign({}, statusReady);
      }
    },
    storage: {
      local: {
        get: async (keys) => {
          if (keys == null) return Object.assign({}, storage);
          if (typeof keys === 'string') {
            const o = {};
            if (keys in storage) o[keys] = storage[keys];
            else o[keys] = SAVED;
            return o;
          }
          if (Array.isArray(keys)) {
            const o = {};
            keys.forEach(function (k) {
              o[k] = storage[k] !== undefined ? storage[k] : SAVED;
            });
            return o;
          }
          return Object.assign({}, storage);
        },
        set: async (obj) => { Object.assign(storage, obj || {}); },
        remove: async (keys) => {
          const list = Array.isArray(keys) ? keys : [keys];
          list.forEach(function (k) { delete storage[k]; });
        }
      }
    },
    runtime: {
      sendMessage: async () => ({ ok: true }),
      lastError: null
    }
  };
  Object.defineProperty(window, 'chrome', {
    value: chromeMock,
    configurable: true,
    writable: true
  });
})();
""" % (int(volume), repr(fav))


def capture_popup_png(volume: int, out_path: Path) -> Path:
    """Render real popup.html at 380x540 via Playwright with mock chrome API."""
    try:
        from playwright.sync_api import sync_playwright
    except ImportError as e:
        print(
            "Playwright is required. Install with: pip install playwright && playwright install chromium",
            file=sys.stderr,
        )
        raise SystemExit(1) from e

    if not POPUP_HTML.is_file():
        raise FileNotFoundError(POPUP_HTML)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    uri = POPUP_HTML.resolve().as_uri()

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            viewport={"width": POPUP_W, "height": POPUP_H},
            device_scale_factor=2,  # crisp retina capture
        )
        page = context.new_page()
        page.add_init_script(chrome_mock_script(volume))
        page.goto(uri, wait_until="networkidle")
        # Wait until operational state is ready and volume matches
        page.wait_for_function(
            """(expected) => {
              const app = document.getElementById('app');
              const val = document.getElementById('volumeValue');
              const label = document.getElementById('statusLabel');
              if (!app || !val || !label) return false;
              return app.dataset.state === 'ready'
                && val.textContent.trim() === String(expected)
                && /ready/i.test(label.textContent);
            }""",
            arg=volume,
            timeout=15000,
        )
        # Ensure caution strip visibility matches volume
        if volume > 300:
            page.wait_for_function(
                """() => {
                  const w = document.getElementById('highBoostWarning');
                  return w && !w.hidden;
                }""",
                timeout=5000,
            )
        # Settle layout / fonts
        page.wait_for_timeout(200)
        # Capture the chassis (body/app), clip to exact popup size
        page.screenshot(
            path=str(out_path),
            clip={"x": 0, "y": 0, "width": POPUP_W, "height": POPUP_H},
            omit_background=False,
        )
        browser.close()

    print(f"  captured popup @ {volume}% → {out_path.name}")
    return out_path


def _text_size(draw, text, font):
    bbox = draw.textbbox((0, 0), text, font=font)
    return bbox[2] - bbox[0], bbox[3] - bbox[1]


def compose_screenshot(
    popup_path: Path,
    out_path: Path,
    *,
    headline: str,
    subline: str,
    volume: int,
    variant: str,
) -> None:
    """
    Compose 1280x800 marketing canvas around the real popup capture.
    Warm bone / charcoal / orange editorial product photography language.
    """
    from PIL import Image, ImageDraw, ImageFilter

    canvas = Image.new("RGBA", (SHOT_W, SHOT_H), BONE)
    d = ImageDraw.Draw(canvas)

    # Variant backgrounds
    if variant == "control":
        # Quiet bone field, soft charcoal abstract browser frame left
        d.rectangle([0, 0, SHOT_W, SHOT_H], fill=BONE)
        # Soft vertical wash
        for y in range(SHOT_H):
            t = y / SHOT_H
            r = int(BONE[0] * (1 - t * 0.08) + BONE_DEEP[0] * t * 0.08)
            g = int(BONE[1] * (1 - t * 0.08) + BONE_DEEP[1] * t * 0.08)
            b = int(BONE[2] * (1 - t * 0.08) + BONE_DEEP[2] * t * 0.08)
            d.line([(0, y), (SHOT_W, y)], fill=(r, g, b, 255))
    elif variant == "boost":
        d.rectangle([0, 0, SHOT_W, SHOT_H], fill=(236, 230, 218, 255))
        # Charcoal band bottom
        d.rectangle([0, int(SHOT_H * 0.72), SHOT_W, SHOT_H], fill=(40, 38, 34, 255))
        # Thin signal rule
        d.rectangle(
            [0, int(SHOT_H * 0.72) - 3, SHOT_W, int(SHOT_H * 0.72)],
            fill=SIGNAL,
        )
    else:  # max — charcoal-forward
        d.rectangle([0, 0, SHOT_W, SHOT_H], fill=(36, 34, 30, 255))
        # Warm bone panel right third
        d.rectangle(
            [int(SHOT_W * 0.58), 0, SHOT_W, SHOT_H],
            fill=BONE,
        )
        # Signal accent edge
        d.rectangle(
            [int(SHOT_W * 0.58) - 4, 0, int(SHOT_W * 0.58), SHOT_H],
            fill=SIGNAL,
        )

    # Abstract browser / video context — geometric, no false UI claims
    _draw_abstract_context(d, variant, volume)

    # Load popup (retina 2x → 760x1080 logical pixels)
    popup = Image.open(popup_path).convert("RGBA")
    # Target display size: large enough to inspect (~0.92 of native CSS size * scale)
    # Capture is 2x so physical is 760x1080; scale to fit campaign
    # Keep full popup in frame with breathing room (no crop of footer/screws)
    if variant == "control":
        target_h = 580
        popup_x, popup_y = 88, 90
    elif variant == "boost":
        target_h = 560
        popup_x = SHOT_W - 88 - int(POPUP_W * (target_h / POPUP_H))
        popup_y = 72
    else:
        target_h = 570
        popup_x, popup_y = 100, 88

    scale = target_h / POPUP_H
    target_w = int(POPUP_W * scale)
    # Clamp so popup never leaves the canvas
    if popup_y + target_h > SHOT_H - 24:
        popup_y = max(24, SHOT_H - 24 - target_h)
    if popup_x + target_w > SHOT_W - 24:
        popup_x = max(24, SHOT_W - 24 - target_w)
    popup_disp = popup.resize((target_w, target_h), Image.Resampling.LANCZOS)

    # Soft drop shadow under popup (crafted product photo)
    shadow = Image.new("RGBA", (SHOT_W, SHOT_H), TRANSPARENT)
    sd = ImageDraw.Draw(shadow)
    sh_pad = 18
    sd.rounded_rectangle(
        [
            popup_x + 8,
            popup_y + 14,
            popup_x + target_w + 8,
            popup_y + target_h + 14,
        ],
        radius=8,
        fill=(0, 0, 0, 55),
    )
    shadow = shadow.filter(ImageFilter.GaussianBlur(radius=16))
    canvas = Image.alpha_composite(canvas, shadow)
    canvas.paste(popup_disp, (popup_x, popup_y), popup_disp)
    d = ImageDraw.Draw(canvas)

    # Typography — sparse, truthful; wrap long heads into bone panel width
    if variant == "max":
        text_x = int(SHOT_W * 0.62)
        text_y = 140
        head_color = CHARCOAL
        sub_color = (90, 84, 74, 255)
        max_text_w = SHOT_W - text_x - 40
        font_head = load_font(36, bold=True, condensed=True)
    elif variant == "boost":
        text_x = 72
        text_y = 100
        head_color = CHARCOAL
        sub_color = INK_MUTED
        max_text_w = popup_x - text_x - 24
        font_head = load_font(40, bold=True, condensed=True)
    else:
        text_x = popup_x + target_w + 48
        text_y = 170
        head_color = CHARCOAL
        sub_color = INK_MUTED
        max_text_w = SHOT_W - text_x - 48
        font_head = load_font(42, bold=True, condensed=True)

    font_sub = load_font(20, bold=False, condensed=True)
    font_meta = load_font(14, bold=False, condensed=True)

    def wrap_lines(text, font, max_w):
        words = text.split()
        lines, cur = [], ""
        for w in words:
            trial = (cur + " " + w).strip()
            tw, _ = _text_size(d, trial, font)
            if tw <= max_w or not cur:
                cur = trial
            else:
                lines.append(cur)
                cur = w
        if cur:
            lines.append(cur)
        return lines

    head_lines = wrap_lines(headline, font_head, max_text_w)
    line_h = 46 if variant != "max" else 42
    for i, line in enumerate(head_lines):
        d.text((text_x, text_y + i * line_h), line, font=font_head, fill=head_color)

    # Signal underline tick under last head line
    last = head_lines[-1] if head_lines else headline
    hw, _ = _text_size(d, last, font_head)
    tick_y = text_y + len(head_lines) * line_h + 8
    d.rectangle([text_x, tick_y, text_x + min(48, hw), tick_y + 3], fill=SIGNAL)

    d.text((text_x, tick_y + 18), subline, font=font_sub, fill=sub_color)

    # Meta label
    meta = f"PER-TAB  ·  {volume}%"
    if variant == "max":
        d.text((text_x, SHOT_H - 56), meta, font=font_meta, fill=SIGNAL_DEEP)
    elif variant == "boost":
        d.text((text_x, SHOT_H - 48), meta, font=font_meta, fill=(200, 190, 175, 255))
    else:
        d.text((text_x, tick_y + 56), meta, font=font_meta, fill=INK_FAINT)

    # Small logo mark corner
    mark = draw_logo_mark(128).resize((40, 40), Image.Resampling.LANCZOS)
    if variant == "max":
        canvas.paste(mark, (SHOT_W - 64, 28), mark)
    else:
        canvas.paste(mark, (SHOT_W - 64, SHOT_H - 64), mark)

    # Flatten to RGB for store (screenshots typically RGB)
    rgb = Image.new("RGB", (SHOT_W, SHOT_H), BONE[:3])
    rgb.paste(canvas, mask=canvas.split()[3])
    rgb.save(out_path, "PNG", optimize=True)
    print(f"  composed {out_path.name}")


def _draw_abstract_context(d, variant: str, volume: int) -> None:
    """Abstract browser chrome / video stage — geometric only."""
    if variant == "control":
        # Soft abstract window behind popup (does not clip the product)
        frame = [40, 56, 500, 700]
        rounded_rect(d, frame, 12, (245, 240, 230, 255), outline=BONE_EDGE, width=1)
        d.rectangle([40, 56, 500, 88], fill=BONE_DEEP)
        for i, col in enumerate([(200, 90, 80), (210, 170, 70), (100, 170, 100)]):
            x = 58 + i * 16
            d.ellipse([x, 66, x + 10, 76], fill=col)
        # Video stage peeks left of the product only
        d.rectangle([56, 110, 200, 300], fill=LCD)
        import random

        rng = random.Random(100 + volume)
        mid = 205
        for i in range(10):
            x = 70 + i * 12
            h = 8 + rng.randint(0, 36)
            d.rectangle(
                [x, mid - h, x + 5, mid + h],
                fill=SIGNAL if i == 7 else (80, 78, 70, 255),
            )
        d.rounded_rectangle([56, 320, 150, 346], radius=4, fill=BONE_DEEP)
        d.rounded_rectangle([160, 320, 240, 346], radius=4, fill=(250, 246, 238, 255))

    elif variant == "boost":
        # Wide abstract stage behind left text
        d.rounded_rectangle([48, 260, 540, 500], radius=8, fill=LCD)
        import random

        rng = random.Random(200 + volume)
        for i in range(34):
            x = 70 + i * 13
            h = 20 + rng.randint(0, 90)
            fill = SIGNAL if i > 22 else (90, 88, 78, 255)
            if i > 28:
                fill = SIGNAL_DEEP
            d.rectangle([x, 480 - h, x + 7, 480], fill=fill)
        d.line([(70, 490), (500, 490)], fill=BONE_EDGE, width=1)

    else:  # max
        # On charcoal left: abstract scale / caution geometry
        d.rectangle([48, 80, 90, 720], fill=(50, 48, 42, 255))
        for i in range(12):
            y = 100 + i * 50
            w = 20 if i % 3 else 36
            col = SIGNAL if i >= 9 else (90, 86, 78, 255)
            d.rectangle([48, y, 48 + w, y + 3], fill=col)
        # Caution-inspired diagonal ticks (not a warning triangle logo)
        for i in range(5):
            y = 520 + i * 14
            d.line([(120, y), (280, y - 40)], fill=(80, 50, 30, 255), width=2)


def make_promo_tile(logo: "Image.Image", out_path: Path) -> None:
    """Exact 440×280 optional promo tile — same campaign, minimal text."""
    from PIL import Image, ImageDraw

    W, H = 440, 280
    img = Image.new("RGBA", (W, H), BONE)
    d = ImageDraw.Draw(img)

    # Charcoal left plate
    d.rectangle([0, 0, 168, H], fill=CHARCOAL)
    # Signal edge
    d.rectangle([168, 0, 172, H], fill=SIGNAL)

    # Logo on charcoal
    mark = logo.resize((112, 112), Image.Resampling.LANCZOS)
    img.paste(mark, (28, (H - 112) // 2), mark)

    # Type on bone
    font_h = load_font(28, bold=True, condensed=True)
    font_s = load_font(15, bold=False, condensed=True)
    d.text((196, 96), "Volume Booster", font=font_h, fill=CHARCOAL)
    d.text((196, 132), "Pro", font=font_h, fill=CHARCOAL)
    d.rectangle([196, 172, 244, 175], fill=SIGNAL)
    d.text((196, 188), "Per-tab gain · up to 600%", font=font_s, fill=INK_MUTED)

    rgb = Image.new("RGB", (W, H), BONE[:3])
    rgb.paste(img, mask=img.split()[3])
    rgb.save(out_path, "PNG", optimize=True)
    print(f"  promo tile → {out_path.name}")


def validate_png(path: Path, expect_w: int, expect_h: int, modes=("RGBA", "RGB")) -> None:
    from PIL import Image

    if not path.is_file() or path.stat().st_size == 0:
        raise RuntimeError(f"Missing or zero-byte: {path}")
    with Image.open(path) as im:
        im.load()
        if im.size != (expect_w, expect_h):
            raise RuntimeError(f"{path.name}: size {im.size} != {(expect_w, expect_h)}")
        if im.mode not in modes:
            raise RuntimeError(f"{path.name}: mode {im.mode} not in {modes}")
    print(f"  validate OK {path.name} {expect_w}x{expect_h} {im.mode}")


def main() -> int:
    from PIL import Image

    print("=== Volume Booster Pro — store asset generator ===")
    STORE.mkdir(parents=True, exist_ok=True)
    ICONS.mkdir(parents=True, exist_ok=True)

    # 1. Logo master + icons
    print("\n[1/4] Logo + icons")
    master = draw_logo_mark(1024)
    master_path = STORE / "logo-master-1024.png"
    master.save(master_path, "PNG", optimize=True)

    store128 = downscale_logo(master, 128)
    store128.save(STORE / "store-icon-128.png", "PNG", optimize=True)

    for s in (16, 32, 48, 128):
        icon = downscale_logo(master, s)
        icon.save(ICONS / f"icon{s}.png", "PNG", optimize=True)
        print(f"  icons/icon{s}.png")

    verify_icon_16(Image.open(ICONS / "icon16.png"))
    validate_png(master_path, 1024, 1024, ("RGBA",))
    validate_png(STORE / "store-icon-128.png", 128, 128, ("RGBA",))
    for s in (16, 32, 48, 128):
        validate_png(ICONS / f"icon{s}.png", s, s, ("RGBA",))

    # 2. Capture real popup states
    print("\n[2/4] Playwright popup captures")
    tmp = STORE / ".captures"
    tmp.mkdir(exist_ok=True)
    captures = {
        100: tmp / "popup-100.png",
        200: tmp / "popup-200.png",
        600: tmp / "popup-600.png",
    }
    for vol, path in captures.items():
        capture_popup_png(vol, path)
        # Retina 2x → pixel size 760x1080
        with Image.open(path) as im:
            im.load()
            print(f"    raw capture {path.name}: {im.size} {im.mode}")

    # 3. Compose screenshots
    print("\n[3/4] Marketing screenshots 1280×800")
    shots = [
        (
            100,
            "screenshot-01-control-1280x800.png",
            "Hear every detail",
            "Studio-rack control for this tab",
            "control",
        ),
        (
            200,
            "screenshot-02-boost-1280x800.png",
            "Per-tab gain, instantly",
            "Boost without leaving the page",
            "boost",
        ),
        (
            600,
            "screenshot-03-max-1280x800.png",
            "Up to 600% when you need it",
            "High boost with a clear caution strip",
            "max",
        ),
    ]
    for vol, name, head, sub, variant in shots:
        compose_screenshot(
            captures[vol],
            STORE / name,
            headline=head,
            subline=sub,
            volume=vol,
            variant=variant,
        )
        validate_png(STORE / name, 1280, 800, ("RGB", "RGBA"))

    # 4. Promo tile
    print("\n[4/4] Promo tile 440×280")
    make_promo_tile(master, STORE / "promo-tile-440x280.png")
    validate_png(STORE / "promo-tile-440x280.png", 440, 280, ("RGB", "RGBA"))

    print("\n=== All store assets generated successfully ===")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

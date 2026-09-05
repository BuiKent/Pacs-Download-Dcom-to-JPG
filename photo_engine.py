"""
photo_engine.py — clinical photo and scanned-document processing, framework free.

Built on Pillow: fast and accurate enough for medical scans (A4 at 300 dpi is
~2480x3508) and for clinical or intra-operative photos of a few MB, with no GPU
needed. Redaction overwrites the real pixels (opaque paste plus flatten) rather
than drawing a cover box at display time, so the original data genuinely cannot
be recovered from an exported redacted copy.

Conventions:
  - Every function takes a source path and always writes to a new output path.
    The original file is never modified in place.
  - Region coordinates (crop/redact/annotate) are in source-image pixels, not
    screen pixels; the client converts before sending them.
"""

from __future__ import annotations

import io
import json
import logging
import os
import threading
import warnings
from dataclasses import dataclass, field
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps

logger = logging.getLogger("photo_engine")

SUPPORTED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".tif", ".tiff", ".webp"}
_MAX_DIMENSION = 8000  # refuse absurd/hostile images before they exhaust memory

# ---------------------------------------------------------------------------
# Concurrency limits
# ---------------------------------------------------------------------------


class ServerBusyError(Exception):
    """The image queue stayed full too long — not the same as a bad image or bad argument."""


class _ConcurrencyGate:
    def __init__(self, limit: int, wait_timeout_s: float, name: str):
        self._sem = threading.Semaphore(limit)
        self._limit = limit
        self._wait_timeout_s = wait_timeout_s
        self._name = name
        self._lock = threading.Lock()
        self._running = 0
        self._waiting = 0

    def reconfigure(self, limit: int, wait_timeout_s: float | None = None) -> None:
        with self._lock:
            self._sem = threading.Semaphore(limit)
            self._limit = limit
            if wait_timeout_s is not None:
                self._wait_timeout_s = wait_timeout_s

    def stats(self) -> dict:
        with self._lock:
            return {"name": self._name, "limit": self._limit,
                    "running": self._running, "waiting": self._waiting}

    def __enter__(self):
        with self._lock:
            self._waiting += 1
        acquired = self._sem.acquire(timeout=self._wait_timeout_s)
        with self._lock:
            self._waiting -= 1
        if not acquired:
            raise ServerBusyError(
                f"Máy chủ đang xử lý quá nhiều ảnh cùng lúc ({self._name}); "
                f"vui lòng thử lại sau ít giây."
            )
        with self._lock:
            self._running += 1
        return self

    def __exit__(self, exc_type, exc, tb):
        with self._lock:
            self._running -= 1
        self._sem.release()


_cpu_count = os.cpu_count() or 2
_HEAVY_LIMIT_DEFAULT = max(2, min(8, _cpu_count * 2))

_heavy_gate = _ConcurrencyGate(_HEAVY_LIMIT_DEFAULT, wait_timeout_s=30, name="photo")


def configure_concurrency(limit: int | None = None, wait_timeout_s: float | None = None) -> None:
    """Call at startup to override the default limits."""
    if limit is not None:
        _heavy_gate.reconfigure(limit, wait_timeout_s)
    elif wait_timeout_s is not None:
        _heavy_gate.reconfigure(_heavy_gate._limit, wait_timeout_s)


def concurrency_stats() -> dict:
    return {"photo": _heavy_gate.stats()}


class PhotoEngineError(Exception):
    """A business-rule failure whose message is safe to show the user verbatim."""


class UnsupportedFormatError(PhotoEngineError):
    pass


class InvalidRegionError(PhotoEngineError):
    pass


def _open_safely(path: str | Path) -> Image.Image:
    path = Path(path)
    if not path.exists():
        raise PhotoEngineError(f"Không tìm thấy file: {path.name}")
    if path.suffix.lower() not in SUPPORTED_EXTENSIONS:
        raise UnsupportedFormatError(
            f"Định dạng {path.suffix} chưa được hỗ trợ. "
            f"Hỗ trợ: {', '.join(sorted(SUPPORTED_EXTENSIONS))}"
        )
    with _heavy_gate:
        try:
            with warnings.catch_warnings(record=True) as caught:
                warnings.simplefilter("always", Image.DecompressionBombWarning)
                img = Image.open(path)
                for w in caught:
                    logger.warning("Pillow cảnh báo khi mở %s: %s", path.name, w.message)
            if img.width > _MAX_DIMENSION or img.height > _MAX_DIMENSION:
                img.close()
                raise PhotoEngineError(
                    f"Ảnh {img.width}x{img.height} vượt giới hạn xử lý ({_MAX_DIMENSION}px)."
                )
            img.load()
        except PhotoEngineError:
            raise
        except Exception as exc:
            raise PhotoEngineError(f"File ảnh hỏng hoặc không đọc được: {exc}") from exc

    return ImageOps.exif_transpose(img)


@dataclass
class ImageInfo:
    path: str
    width: int
    height: int
    format: str
    mode: str
    size_bytes: int


def probe(path: str | Path) -> ImageInfo:
    path = Path(path)
    img = _open_safely(path)
    return ImageInfo(
        path=str(path), width=img.width, height=img.height,
        format=img.format or path.suffix.lstrip(".").upper(),
        mode=img.mode, size_bytes=path.stat().st_size,
    )


# ---------------------------------------------------------------------------
# Thumbnail
# ---------------------------------------------------------------------------


def make_thumbnail(src: str | Path, out_path: str | Path, max_size: int = 320) -> Path:
    img = _open_safely(src)
    img = img.convert("RGB") if img.mode not in ("RGB", "L") else img
    img.thumbnail((max_size, max_size), Image.LANCZOS)
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    img.save(out_path, quality=82)
    return out_path


# ---------------------------------------------------------------------------
# Crop / rotate
# ---------------------------------------------------------------------------


@dataclass
class Rect:
    x: int
    y: int
    width: int
    height: int

    def to_box(self) -> tuple[int, int, int, int]:
        return (self.x, self.y, self.x + self.width, self.y + self.height)


def _validate_region(img: Image.Image, rect: Rect) -> None:
    if rect.width <= 0 or rect.height <= 0:
        raise InvalidRegionError("Vùng chọn phải có kích thước dương.")
    if rect.x < 0 or rect.y < 0 or rect.x + rect.width > img.width or rect.y + rect.height > img.height:
        raise InvalidRegionError(
            f"Vùng chọn ({rect.x},{rect.y},{rect.width}x{rect.height}) "
            f"vượt ra ngoài ảnh gốc ({img.width}x{img.height})."
        )


def crop(src: str | Path, out_path: str | Path, rect: Rect, quality: int = 92) -> Path:
    img = _open_safely(src)
    _validate_region(img, rect)
    cropped = img.crop(rect.to_box())
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    _save(cropped, out_path, quality)
    return out_path


def rotate(src: str | Path, out_path: str | Path, degrees: int, quality: int = 92) -> Path:
    """A positive `degrees` turns clockwise."""
    if degrees % 90 != 0:
        raise PhotoEngineError("Chỉ hỗ trợ xoay theo bội số 90° (chất lượng không mất mát).")
    img = _open_safely(src)
    rotated = img.rotate(-degrees, expand=True)
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    _save(rotated, out_path, quality)
    return out_path


def _save(img: Image.Image, out_path: Path, quality: int) -> None:
    ext = out_path.suffix.lower()
    if ext in (".jpg", ".jpeg"):
        img = img.convert("RGB") if img.mode not in ("RGB", "L") else img
        img.save(out_path, quality=quality, optimize=True)
    else:
        img.save(out_path)


# ---------------------------------------------------------------------------
# Redaction
# ---------------------------------------------------------------------------


def redact(src: str | Path, out_path: str | Path, regions: list[Rect],
           fill: tuple[int, int, int] = (0, 0, 0), quality: int = 92) -> Path:
    if not regions:
        raise PhotoEngineError("Cần ít nhất một vùng để che.")
    img = _open_safely(src).convert("RGB")
    for rect in regions:
        _validate_region(img, rect)
    draw = ImageDraw.Draw(img)
    for rect in regions:
        draw.rectangle(rect.to_box(), fill=fill)
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    _save(img, out_path, quality)
    return out_path


# ---------------------------------------------------------------------------
# Annotate
# ---------------------------------------------------------------------------


@dataclass
class TextAnnotation:
    text: str
    x: int
    y: int
    font_size: int = 24
    color: tuple[int, int, int] = (255, 255, 255)
    box: bool = True
    box_color: tuple[int, int, int, int] = (0, 0, 0, 160)


@dataclass
class ArrowAnnotation:
    x1: int
    y1: int
    x2: int
    y2: int
    color: tuple[int, int, int] = (255, 70, 70)
    width: int = 4


@dataclass
class BoxAnnotation:
    rect: Rect
    color: tuple[int, int, int] = (255, 70, 70)
    width: int = 3


_FONT_CANDIDATES = [
    "C:/Windows/Fonts/arial.ttf",
    "C:/Windows/Fonts/segoeui.ttf",
    "C:/Windows/Fonts/tahoma.ttf",
    "C:/Windows/Fonts/calibri.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    "/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf",
    "/Library/Fonts/Arial.ttf",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
]

# A codepoint in the Private Use Area that no real font defines. Rendering it
# gives the font's own .notdef glyph, which is what a missing character looks
# like — so comparing against it tells us whether a character is really there.
_NOTDEF_PROBE = ""

_font_cache: dict[tuple[str, int], ImageFont.FreeTypeFont] = {}


def _glyph_bitmap(font: ImageFont.FreeTypeFont, char: str) -> bytes:
    """One character drawn on its own, as raw pixels.

    `font.getmask()` hands back an ImagingCore, which has no `.tobytes()`; going
    through a real image is what makes two glyphs comparable at all.
    """
    canvas = Image.new("L", (64, 64), 0)
    ImageDraw.Draw(canvas).text((2, 2), char, fill=255, font=font)
    return canvas.tobytes()


def _renders(font: ImageFont.FreeTypeFont, text: str) -> bool:
    """
    Whether `font` has a real glyph for every character of `text`.

    A font that lacks one draws .notdef — an empty box — and Pillow reports no
    error at all. On a clinical photo that means a surgeon's note is exported as
    a row of rectangles with nothing anywhere saying so, which is why the font is
    chosen by what it can draw rather than by which file happens to exist.
    """
    try:
        probe_font = font.font_variant(size=32)
        notdef = _glyph_bitmap(probe_font, _NOTDEF_PROBE)
        for char in set(text):
            if char.isspace():
                continue
            if _glyph_bitmap(probe_font, char) == notdef:
                return False
    except Exception:
        # A font that cannot even be probed is not evidence against itself.
        return True
    return True


def _load_font(size: int, text: str = "") -> ImageFont.FreeTypeFont:
    """
    The first installed font that can actually draw `text` at `size`.

    Vietnamese needs Latin Extended Additional (the tone marks stacked on vowels
    — ế, ộ, ữ). Every candidate here carries it, but the check is on the text in
    hand rather than on an assumption, so a stripped machine falls through to
    whatever font on it does work instead of silently exporting boxes.
    """
    key = (text, size)
    cached = _font_cache.get(key)
    if cached is not None:
        return cached
    fallback = None
    for candidate in _FONT_CANDIDATES:
        if not Path(candidate).exists():
            continue
        try:
            font = ImageFont.truetype(candidate, size)
        except Exception:
            continue
        if fallback is None:
            fallback = font
        if not text or _renders(font, text):
            _font_cache[key] = font
            return font
    if fallback is not None:
        logger.warning(
            "Không có font nào vẽ đủ ký tự cho %r; dùng tạm font đầu tiên tìm được. "
            "Chữ tiếng Việt trên ảnh có thể mất dấu.", text[:40],
        )
        _font_cache[key] = fallback
        return fallback
    logger.warning("Không tìm thấy font TTF nào trên máy; chữ chèn vào ảnh sẽ bị lỗi dấu.")
    return ImageFont.load_default()


def annotate(src: str | Path, out_path: str | Path,
             texts: list[TextAnnotation] = (), arrows: list[ArrowAnnotation] = (),
             boxes: list[BoxAnnotation] = (), quality: int = 92) -> Path:
    img = _open_safely(src).convert("RGBA")
    overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    for box in boxes:
        _validate_region(img, box.rect)
        draw.rectangle(box.rect.to_box(), outline=box.color, width=box.width)

    for arrow in arrows:
        draw.line((arrow.x1, arrow.y1, arrow.x2, arrow.y2), fill=arrow.color, width=arrow.width)
        _draw_arrowhead(draw, arrow)

    for txt in texts:
        font = _load_font(txt.font_size, txt.text)
        bbox = draw.textbbox((txt.x, txt.y), txt.text, font=font)
        if txt.box:
            pad = 4
            draw.rectangle(
                (bbox[0] - pad, bbox[1] - pad, bbox[2] + pad, bbox[3] + pad),
                fill=txt.box_color,
            )
        draw.text((txt.x, txt.y), txt.text, fill=(*txt.color, 255), font=font)

    result = Image.alpha_composite(img, overlay).convert("RGB")
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    _save(result, out_path, quality)
    return out_path


def _draw_arrowhead(draw: ImageDraw.ImageDraw, arrow: ArrowAnnotation, size: int = 14) -> None:
    import math
    angle = math.atan2(arrow.y2 - arrow.y1, arrow.x2 - arrow.x1)
    for side_angle in (angle + math.radians(150), angle - math.radians(150)):
        wing_x = arrow.x2 + size * math.cos(side_angle)
        wing_y = arrow.y2 + size * math.sin(side_angle)
        draw.line((arrow.x2, arrow.y2, wing_x, wing_y), fill=arrow.color, width=arrow.width)


# ---------------------------------------------------------------------------
# PDF export
# ---------------------------------------------------------------------------


def export_pdf(sources: list[str | Path], out_path: str | Path) -> Path:
    if not sources:
        raise PhotoEngineError("Cần ít nhất một ảnh để xuất PDF.")
    images = []
    for src in sources:
        img = _open_safely(src).convert("RGB")
        images.append(img)
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    first, rest = images[0], images[1:]
    first.save(out_path, save_all=True, append_images=rest)
    return out_path


# ---------------------------------------------------------------------------
# Edit Session (Undo/Redo)
# ---------------------------------------------------------------------------


@dataclass
class EditOp:
    kind: str  # "crop" | "rotate" | "redact" | "annotate"
    params: dict = field(default_factory=dict)


class EditSession:
    def __init__(self, original_path: str | Path):
        self.original_path = Path(original_path)
        self.ops: list[EditOp] = []

    def push(self, op: EditOp) -> None:
        self.ops.append(op)

    def undo(self) -> EditOp | None:
        return self.ops.pop() if self.ops else None

    def render(self, out_path: str | Path, quality: int = 92) -> Path:
        current = str(self.original_path)
        tmp_dir = Path(out_path).parent / ".tmp_session"
        tmp_dir.mkdir(parents=True, exist_ok=True)
        try:
            for i, op in enumerate(self.ops):
                step_out = tmp_dir / f"step_{i}.png"
                current = str(_apply_op(current, step_out, op, quality))
            final = Path(out_path)
            final.parent.mkdir(parents=True, exist_ok=True)
            if self.ops:
                _save(Image.open(current), final, quality)
            else:
                _save(_open_safely(current), final, quality)
            return final
        finally:
            for f in tmp_dir.glob("step_*.png"):
                f.unlink(missing_ok=True)

    def to_json(self) -> str:
        return json.dumps([{"kind": op.kind, "params": op.params} for op in self.ops])

    @classmethod
    def from_json(cls, original_path: str | Path, data: str) -> "EditSession":
        session = cls(original_path)
        for item in json.loads(data):
            session.push(EditOp(kind=item["kind"], params=item["params"]))
        return session


def _apply_op(src: str, out_path: Path, op: EditOp, quality: int) -> Path:
    if op.kind == "crop":
        return crop(src, out_path, Rect(**op.params), quality)
    if op.kind == "rotate":
        return rotate(src, out_path, op.params["degrees"], quality)
    if op.kind == "redact":
        regions = [Rect(**r) for r in op.params["regions"]]
        fill = tuple(op.params.get("fill", (0, 0, 0)))
        return redact(src, out_path, regions, fill, quality)
    if op.kind == "annotate":
        texts = [TextAnnotation(**t) for t in op.params.get("texts", [])]
        arrows = [ArrowAnnotation(**a) for a in op.params.get("arrows", [])]
        boxes = [BoxAnnotation(rect=Rect(**b["rect"]), color=tuple(b.get("color", (255, 70, 70))),
                                width=b.get("width", 3)) for b in op.params.get("boxes", [])]
        return annotate(src, out_path, texts, arrows, boxes, quality)
    raise PhotoEngineError(f"Thao tác không hợp lệ: {op.kind}")


# ---------------------------------------------------------------------------
# Vector shape layer
# ---------------------------------------------------------------------------
#
# The studio draws on a canvas and sends the whole layer here once, instead of
# one HTTP round-trip and one JPEG re-encode per shape. Ten arrows used to mean
# ten generations of lossy re-compression of a patient's photo; now the file is
# decoded once, painted once and encoded once.
#
# Coordinates arrive in source-image pixels, so what the reader saw over the
# scaled-down preview is what lands on the full-resolution file.


_SHAPE_KINDS = {
    "arrow", "line", "rect", "ellipse", "highlight",
    "pixelate", "redact", "pen", "text", "marker",
}

# Kinds that overwrite the real pixels. They are painted onto the base image
# before the translucent overlay goes on, so the data underneath is genuinely
# gone from the exported file rather than merely covered at display time.
_DESTRUCTIVE_KINDS = {"pixelate", "redact"}

# The client speaks camelCase and the engine speaks snake_case. Accepting both
# here is not politeness: the text tool shipped broken for exactly this reason —
# TextAnnotation(**{"fontSize": 24}) raised TypeError on every single use.
_KEY_ALIASES = {
    "strokeWidth": "stroke_width",
    "fontSize": "font_size",
    "lineWidth": "stroke_width",
}


@dataclass
class Shape:
    """One drawn object. Fields not meaningful for a kind are simply unused."""

    kind: str
    color: tuple = (255, 59, 48)
    stroke_width: int = 4
    opacity: float = 1.0
    x: int = 0
    y: int = 0
    width: int = 0
    height: int = 0
    x1: int = 0
    y1: int = 0
    x2: int = 0
    y2: int = 0
    points: list = field(default_factory=list)
    text: str = ""
    font_size: int = 28
    # When a mark drawn on a clip is on screen. Absent on a photo, where the
    # idea has no meaning; the renderer ignores both.
    start_s: float | None = None
    end_s: float | None = None
    background: bool = True
    filled: bool = False
    label: str = ""

    @classmethod
    def from_dict(cls, data: dict) -> "Shape":
        if not isinstance(data, dict):
            raise PhotoEngineError("Mỗi hình vẽ phải là một đối tượng hợp lệ.")
        normalised = {}
        for raw_key, value in data.items():
            key = _KEY_ALIASES.get(raw_key, raw_key)
            if key in cls.__dataclass_fields__:
                normalised[key] = value
        kind = str(normalised.get("kind", "")).strip()
        if kind not in _SHAPE_KINDS:
            raise PhotoEngineError(f"Loại hình vẽ không hợp lệ: {kind or 'trống'}")
        normalised["kind"] = kind
        if "color" in normalised:
            normalised["color"] = _as_rgb(normalised["color"])
        if "points" in normalised:
            normalised["points"] = [
                (int(p[0]), int(p[1])) for p in normalised["points"] if len(p) >= 2
            ]
        for int_field in ("stroke_width", "x", "y", "width", "height",
                          "x1", "y1", "x2", "y2", "font_size"):
            if int_field in normalised:
                normalised[int_field] = int(round(float(normalised[int_field])))
        for span_field in ("start_s", "end_s"):
            if normalised.get(span_field) is not None:
                normalised[span_field] = float(normalised[span_field])
        if "opacity" in normalised:
            normalised["opacity"] = max(0.0, min(1.0, float(normalised["opacity"])))
        if "label" in normalised:
            normalised["label"] = str(normalised["label"])
        return cls(**normalised)


def _as_rgb(value) -> tuple:
    """Accept [r,g,b], (r,g,b) or a #rrggbb string; anything else is the default red."""
    if isinstance(value, str):
        text = value.strip().lstrip("#")
        if len(text) == 3:
            text = "".join(ch * 2 for ch in text)
        if len(text) == 6:
            try:
                return tuple(int(text[i:i + 2], 16) for i in (0, 2, 4))
            except ValueError:
                pass
        return (255, 59, 48)
    if isinstance(value, (list, tuple)) and len(value) >= 3:
        return tuple(max(0, min(255, int(round(float(c))))) for c in value[:3])
    return (255, 59, 48)


def _rgba(color: tuple, opacity: float) -> tuple:
    return (*color[:3], max(0, min(255, int(round(255 * opacity)))))


def _pixelate_block(shape: "Shape") -> int:
    """Mosaic block edge in source pixels. Mirrors pixelateBlock() in the client."""
    return max(4, int(round((shape.stroke_width or 4) * 2.5)))


def _readable_ink(color: tuple) -> tuple:
    """Black or white, whichever survives on `color`. A number nobody can read is not a marker."""
    r, g, b = color[:3]
    return (17, 17, 17) if (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6 else (255, 255, 255)


def _clamp_box(shape: "Shape", img_w: int, img_h: int):
    """A shape's rectangle clipped to the image, or None if nothing is left."""
    left = max(0, min(shape.x, img_w))
    top = max(0, min(shape.y, img_h))
    right = max(0, min(shape.x + shape.width, img_w))
    bottom = max(0, min(shape.y + shape.height, img_h))
    if right - left < 1 or bottom - top < 1:
        return None
    return (left, top, right, bottom)


def _apply_destructive(img: Image.Image, shapes: list) -> None:
    """Overwrite pixels for redact and pixelate, in place, on an RGB image."""
    draw = ImageDraw.Draw(img)
    for shape in shapes:
        box = _clamp_box(shape, img.width, img.height)
        if box is None:
            continue
        if shape.kind == "redact":
            draw.rectangle(box, fill=(0, 0, 0))
            continue
        left, top, right, bottom = box
        block = _pixelate_block(shape)
        region = img.crop(box)
        small = region.resize(
            (max(1, (right - left) // block), max(1, (bottom - top) // block)),
            Image.BILINEAR,
        )
        img.paste(small.resize((right - left, bottom - top), Image.NEAREST), box)


def _draw_arrowhead_at(draw: ImageDraw.ImageDraw, x1: float, y1: float,
                       x2: float, y2: float, color: tuple, stroke: float) -> float:
    """Draw the head and return how far short of the tip the shaft should stop."""
    import math

    head = max(stroke * 3.2, 10.0)
    angle = math.atan2(y2 - y1, x2 - x1)
    wings = [
        (x2 - head * math.cos(angle - math.pi / 7), y2 - head * math.sin(angle - math.pi / 7)),
        (x2 - head * math.cos(angle + math.pi / 7), y2 - head * math.sin(angle + math.pi / 7)),
    ]
    draw.polygon([(x2, y2), *wings], fill=color)
    return head * 0.72


def _paint_geometry(draw: ImageDraw.ImageDraw, shapes: list, scale: float) -> None:
    """Everything but text, at `scale` — the supersampling factor."""
    import math

    for shape in shapes:
        if shape.kind in _DESTRUCTIVE_KINDS:
            continue
        color = _rgba(shape.color, shape.opacity)
        stroke = max(1, int(round(shape.stroke_width * scale)))
        s = scale

        if shape.kind == "line":
            draw.line((shape.x1 * s, shape.y1 * s, shape.x2 * s, shape.y2 * s),
                      fill=color, width=stroke)
        elif shape.kind == "arrow":
            back = _draw_arrowhead_at(draw, shape.x1 * s, shape.y1 * s,
                                      shape.x2 * s, shape.y2 * s, color, stroke)
            angle = math.atan2(shape.y2 - shape.y1, shape.x2 - shape.x1)
            draw.line(
                (shape.x1 * s, shape.y1 * s,
                 shape.x2 * s - math.cos(angle) * back, shape.y2 * s - math.sin(angle) * back),
                fill=color, width=stroke,
            )
        elif shape.kind == "rect":
            box = (shape.x * s, shape.y * s,
                   (shape.x + shape.width) * s, (shape.y + shape.height) * s)
            if shape.filled:
                draw.rectangle(box, fill=color)
            else:
                draw.rectangle(box, outline=color, width=stroke)
        elif shape.kind == "ellipse":
            box = (shape.x * s, shape.y * s,
                   (shape.x + shape.width) * s, (shape.y + shape.height) * s)
            if shape.filled:
                draw.ellipse(box, fill=color)
            else:
                draw.ellipse(box, outline=color, width=stroke)
        elif shape.kind == "highlight":
            # A marker pen: the tissue underneath has to stay readable through it.
            draw.rectangle(
                (shape.x * s, shape.y * s,
                 (shape.x + shape.width) * s, (shape.y + shape.height) * s),
                fill=_rgba(shape.color, shape.opacity * 0.35),
            )
        elif shape.kind == "pen":
            if len(shape.points) >= 2:
                draw.line([(px * s, py * s) for px, py in shape.points],
                          fill=color, width=stroke, joint="curve")
        elif shape.kind == "marker":
            radius = _marker_radius(shape) * s
            centre = (shape.x * s, shape.y * s)
            draw.ellipse(
                (centre[0] - radius, centre[1] - radius, centre[0] + radius, centre[1] + radius),
                fill=_rgba(shape.color, shape.opacity),
                outline=(255, 255, 255, 235), width=max(1, int(radius * 0.12)),
            )


def _marker_radius(shape: "Shape") -> float:
    return max(12.0, (shape.font_size or 28) * 0.75)


def _paint_text(overlay: Image.Image, shapes: list) -> None:
    """
    Text at final resolution, after the supersampled pass has been downscaled.

    Glyphs rendered 3x and shrunk come back soft; a note on an operative photo
    has to stay legible at the size it was typed.
    """
    draw = ImageDraw.Draw(overlay)
    for shape in shapes:
        if shape.kind == "text":
            if not str(shape.text).strip():
                continue
            font = _load_font(max(6, shape.font_size))
            lines = str(shape.text).split("\n")
            line_height = shape.font_size * 1.25
            widths = [draw.textlength(line, font=font) for line in lines] or [1.0]
            if shape.background:
                pad = shape.font_size * 0.22
                draw.rectangle(
                    (shape.x - pad, shape.y - pad,
                     shape.x + max(widths) + pad, shape.y + line_height * len(lines) + pad),
                    fill=(0, 0, 0, 153),
                )
            for index, line in enumerate(lines):
                draw.text((shape.x, shape.y + index * line_height), line,
                          fill=_rgba(shape.color, shape.opacity), font=font)
        elif shape.kind == "marker":
            radius = _marker_radius(shape)
            font = _load_font(max(8, int(radius * 1.15)), shape.label or "1")
            draw.text((shape.x, shape.y), shape.label or "1",
                      fill=(*_readable_ink(shape.color), 255), font=font, anchor="mm")


def _supersample_factor(width: int, height: int) -> int:
    """
    How much to oversample the geometry pass.

    Pillow draws hard-edged, aliased lines; an arrow on a clinical photo drawn
    that way looks like a screenshot from 1998. Drawing at 3x and shrinking with
    LANCZOS is what gives it a smooth edge. Large scans skip it — a 3x buffer of
    an A4 at 300 dpi is 300 MB of RGBA and the win is invisible at that size.
    """
    longest = max(width, height)
    if longest <= 2200:
        return 3
    if longest <= 4200:
        return 2
    return 1


def _render_shape_overlay(size: tuple, shapes: list) -> Image.Image:
    """The translucent layer holding every non-destructive shape."""
    width, height = size
    factor = _supersample_factor(width, height)
    if factor > 1:
        big = Image.new("RGBA", (width * factor, height * factor), (0, 0, 0, 0))
        _paint_geometry(ImageDraw.Draw(big), shapes, factor)
        overlay = big.resize((width, height), Image.LANCZOS)
        big.close()
    else:
        overlay = Image.new("RGBA", (width, height), (0, 0, 0, 0))
        _paint_geometry(ImageDraw.Draw(overlay), shapes, 1)
    _paint_text(overlay, shapes)
    return overlay


def parse_shapes(raw: list) -> list:
    """Validate a client payload into shapes, rejecting the whole batch on a bad one."""
    return [Shape.from_dict(item) for item in (raw or [])]


def split_destructive(shapes: list) -> tuple[list, list]:
    """
    Separate the shapes that must destroy pixels from the ones that can be drawn over.

    A photo flattens both in one pass, but a video cannot: covering a face with
    a picture of a blur leaves the face in the frames underneath, so those
    rectangles have to become an ffmpeg filter instead of part of the overlay.
    Returns (drawn, destructive).
    """
    parsed = shapes if shapes and isinstance(shapes[0], Shape) else parse_shapes(shapes)
    drawn = [s for s in parsed if s.kind not in _DESTRUCTIVE_KINDS]
    destructive = [s for s in parsed if s.kind in _DESTRUCTIVE_KINDS]
    return drawn, destructive


def draw_shapes(src: str | Path, out_path: str | Path,
                shapes: list, quality: int = 92) -> Path:
    """
    Flatten a whole drawing layer onto the image in one pass.

    Destructive shapes go on first and overwrite pixels; the rest are composited
    from a translucent overlay, so a highlight really lets the tissue show
    through and a redaction really does not.
    """
    parsed = shapes if shapes and isinstance(shapes[0], Shape) else parse_shapes(shapes)
    if not parsed:
        raise PhotoEngineError("Chưa có hình vẽ nào để áp dụng lên ảnh.")
    img = _open_safely(src).convert("RGB")
    _apply_destructive(img, [s for s in parsed if s.kind in _DESTRUCTIVE_KINDS])
    overlay = _render_shape_overlay(img.size, parsed)
    result = Image.alpha_composite(img.convert("RGBA"), overlay).convert("RGB")
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    _save(result, out_path, quality)
    return out_path


def render_overlay_png(shapes: list, size: tuple, out_path: str | Path) -> Path:
    """
    The drawing layer alone, on transparency, sized to a video frame.

    This is what gets composited over a clip by ffmpeg. Destructive shapes are
    not painted here: blurring a face in a video means filtering the frames
    themselves, which video_engine.burn_overlay does with its own filter chain,
    not covering them with a picture of a blur.
    """
    width, height = int(size[0]), int(size[1])
    if width < 1 or height < 1 or width > _MAX_DIMENSION or height > _MAX_DIMENSION:
        raise PhotoEngineError(f"Kích thước khung hình không hợp lệ: {width}x{height}")
    parsed = shapes if shapes and isinstance(shapes[0], Shape) else parse_shapes(shapes)
    overlay = _render_shape_overlay((width, height), parsed)
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    overlay.save(out_path, "PNG")
    return out_path

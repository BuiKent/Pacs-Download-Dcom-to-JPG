"""
photo_engine.py — lõi xử lý ảnh/bệnh án scan, độc lập framework web.

Dùng Pillow (PIL): đủ nhanh và chuẩn cho ảnh scan y tế (A4 300dpi ~2480x3508,
ảnh chụp lâm sàng/mổ vài MB) — không cần GPU. Với redaction, ghi đè pixel thật
(paste màu đặc + flatten) chứ không chỉ vẽ hộp che ở tầng hiển thị, để đúng
yêu cầu "dữ liệu gốc không còn khôi phục được" khi xuất bản đã che.

Quy ước:
  - Hàm nhận đường dẫn nguồn, luôn ghi ra đường dẫn output mới — không sửa
    file gốc tại chỗ, khớp yêu cầu "bản gốc bất khả xâm phạm".
  - Toạ độ vùng chọn (crop/redact/annotate) tính theo pixel ảnh gốc, không
    theo pixel hiển thị trên màn hình — client phải quy đổi trước khi gửi
    lên (xem client/photo_api.js: toImageSpaceRect()).
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
_MAX_DIMENSION = 8000  # chặn ảnh bất thường/độc hại chiếm hết bộ nhớ khi mở

# ---------------------------------------------------------------------------
# Giới hạn đồng thời
# ---------------------------------------------------------------------------


class ServerBusyError(Exception):
    """Hàng đợi xử lý ảnh đã đầy quá lâu — khác về bản chất với lỗi ảnh/tham số."""


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
    """Gọi lúc khởi động app nếu muốn ghi đè giới hạn mặc định."""
    if limit is not None:
        _heavy_gate.reconfigure(limit, wait_timeout_s)
    elif wait_timeout_s is not None:
        _heavy_gate.reconfigure(_heavy_gate._limit, wait_timeout_s)


def concurrency_stats() -> dict:
    return {"photo": _heavy_gate.stats()}


class PhotoEngineError(Exception):
    """Lỗi nghiệp vụ, an toàn hiển thị nguyên văn cho người dùng."""


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
    """degrees dương = theo chiều kim đồng hồ."""
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
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
]


def _load_font(size: int) -> ImageFont.FreeTypeFont:
    for candidate in _FONT_CANDIDATES:
        if Path(candidate).exists():
            try:
                return ImageFont.truetype(candidate, size)
            except Exception:
                pass
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
        font = _load_font(txt.font_size)
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
# Xuất PDF
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

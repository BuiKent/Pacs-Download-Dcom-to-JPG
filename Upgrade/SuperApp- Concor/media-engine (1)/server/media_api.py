"""
media_api.py — lớp FastAPI mỏng bọc video_engine.py / photo_engine.py.

GIẢ ĐỊNH CẦN BẠN XÁC NHẬN (không thấy được api.js/server thật của bạn):
  1. Framework là FastAPI — nếu thực tế là Flask, logic nghiệp vụ trong
     video_engine.py/photo_engine.py không đổi gì cả (chúng không phụ thuộc
     framework); chỉ cần viết lại phần route bên dưới theo Flask Blueprint.
  2. Response envelope: đoán app hiện tại trả JSON thẳng (không bọc thêm
     {"ok":true,"data":...}) dựa trên cách main.js dùng `await api(...)` rồi
     đọc thẳng field — route dưới đây theo đúng kiểu đó. Nếu backend thật có
     envelope khác, đổi trong hàm `_ok()`/`_err()` ở cuối file, không phải
     sửa từng route.
  3. Auth: main.js đọc token từ query string lúc khởi động rồi xoá khỏi URL
     (dòng 51-61), gợi ý token được set 1 lần rồi backend giữ session qua
     cookie hoặc biến toàn cục — route dưới đây KHÔNG tự thêm auth, giả định
     bạn có middleware xác thực chung đặt trước router này trong app chính.

Mount vào app FastAPI hiện có bằng:
    from media_api import router as media_router
    app.include_router(media_router, prefix="/api/media")

Việc này thêm các route mới (/api/media/*), không đụng route cũ.
"""

from __future__ import annotations

import logging
import tempfile
import traceback
import uuid
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, HTTPException, UploadFile
from pydantic import BaseModel

import photo_engine as pe
import video_engine as ve

logger = logging.getLogger("media_api")
router = APIRouter()

# ---------------------------------------------------------------------------
# Thư mục làm việc — TODO: thay bằng đường dẫn thật trong app của bạn (vd.
# cùng cấp với thư mục kho DICOM). Dùng tempfile ở đây chỉ để module chạy
# độc lập lúc bạn thử nghiệm; đừng để nguyên khi tích hợp thật vì file trong
# tempdir hệ thống có thể bị dọn giữa các lần chạy.
# ---------------------------------------------------------------------------

WORK_ROOT = Path(tempfile.gettempdir()) / "concord_media_work"
WORK_ROOT.mkdir(parents=True, exist_ok=True)


def _new_work_path(suffix: str) -> Path:
    return WORK_ROOT / f"{uuid.uuid4().hex}{suffix}"


def _resolve_existing(path_str: str) -> Path:
    """Chặn path traversal: mọi path client gửi lên phải nằm trong WORK_ROOT
    hoặc trong kho lưu trữ đã biết — KHÔNG cho phép client trỏ tới path bất kỳ
    trên đĩa. TODO: khi tích hợp thật, thay điều kiện `is_relative_to` bằng
    danh sách thư mục gốc hợp lệ thật của bạn (kho DICOM, thư mục upload...).
    """
    path = Path(path_str).resolve()
    allowed_roots = [WORK_ROOT.resolve()]
    if not any(_is_relative_to(path, root) for root in allowed_roots):
        raise HTTPException(403, f"Đường dẫn không hợp lệ: {path_str}")
    if not path.exists():
        raise HTTPException(404, f"Không tìm thấy file: {path_str}")
    return path


def _is_relative_to(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False


def _engine_error_to_http(exc: Exception) -> HTTPException:
    if isinstance(exc, HTTPException):
        # _resolve_existing() đã tự quyết định đúng status (403/404) — không
        # được bọc lại thành 500, nếu không mọi lỗi path traversal/not-found
        # sẽ hiện sai thành "lỗi nội bộ" và che mất nguyên nhân thật.
        return exc
    if isinstance(exc, (ve.ServerBusyError, pe.ServerBusyError)):
        # 429 Too Many Requests: đúng ngữ nghĩa REST cho "quá tải, thử lại
        # sau" — khác hẳn 400 (lỗi input) và 500 (lỗi hệ thống thật). Client
        # nên đọc status này để tự động thử lại sau vài giây/phút thay vì
        # coi là lỗi vĩnh viễn.
        return HTTPException(429, str(exc))
    if isinstance(exc, (ve.VideoEngineError, pe.PhotoEngineError)):
        return HTTPException(400, str(exc))
    logger.error("Lỗi không mong đợi trong media_api: %s", traceback.format_exc())
    return HTTPException(500, "Lỗi xử lý nội bộ.")


# ---------------------------------------------------------------------------
# Health / concurrency status — cho UI hiển thị "máy đang bận" thay vì để
# người dùng đoán vì sao request treo lâu, và cho việc giám sát vận hành.
# ---------------------------------------------------------------------------


@router.get("/health")
def media_health():
    return {
        "video": ve.concurrency_stats(),
        "photo": pe.concurrency_stats(),
    }


# ---------------------------------------------------------------------------
# Upload — client gửi file nhị phân lên trước, nhận về work-path để dùng cho
# các route xử lý bên dưới. Tách bước này để trim/redact/... không phải nhận
# lại toàn bộ file mỗi lần chỉnh một chút.
# ---------------------------------------------------------------------------


@router.post("/upload")
async def upload_media(file: UploadFile):
    ext = Path(file.filename or "").suffix.lower()
    if ext not in ve.SUPPORTED_EXTENSIONS and ext not in pe.SUPPORTED_EXTENSIONS:
        raise HTTPException(400, f"Định dạng {ext} không được hỗ trợ.")
    dest = _new_work_path(ext)
    with dest.open("wb") as f:
        while chunk := await file.read(1024 * 1024):
            f.write(chunk)
    kind = "video" if ext in ve.SUPPORTED_EXTENSIONS else "photo"
    return {"workPath": str(dest), "kind": kind, "sizeBytes": dest.stat().st_size}


# ---------------------------------------------------------------------------
# Video routes
# ---------------------------------------------------------------------------


@router.get("/video/probe")
def video_probe(path: str):
    src = _resolve_existing(path)
    try:
        info = ve.probe(src)
    except Exception as exc:
        raise _engine_error_to_http(exc)
    return {
        "durationS": info.duration_s, "width": info.width, "height": info.height,
        "fps": info.fps, "codec": info.codec, "hasAudio": info.has_audio,
        "sizeBytes": info.size_bytes,
    }


@router.get("/video/thumbnail")
def video_thumbnail(path: str, atSeconds: float = 0.0):
    src = _resolve_existing(path)
    out = _new_work_path(".jpg")
    try:
        ve.extract_thumbnail(src, out, at_seconds=atSeconds)
    except Exception as exc:
        raise _engine_error_to_http(exc)
    return {"workPath": str(out)}


class FilmstripRequest(BaseModel):
    path: str
    count: int = 12


@router.post("/video/filmstrip")
def video_filmstrip(body: FilmstripRequest):
    src = _resolve_existing(body.path)
    out_dir = _new_work_path("")
    try:
        frames = ve.extract_filmstrip(src, out_dir, count=body.count)
    except Exception as exc:
        raise _engine_error_to_http(exc)
    return {"frames": [str(f) for f in frames]}


class TrimRequest(BaseModel):
    path: str
    startS: float
    endS: float
    reencode: bool = False


@router.post("/video/trim")
def video_trim(body: TrimRequest):
    src = _resolve_existing(body.path)
    out = _new_work_path(".mp4")
    try:
        ve.trim(src, out, body.startS, body.endS, reencode=body.reencode)
    except Exception as exc:
        raise _engine_error_to_http(exc)
    return {"workPath": str(out)}


class TextOverlayIn(BaseModel):
    text: str
    x: str = "20"
    y: str = "h-40"
    fontSize: int = 28
    color: str = "white"
    box: bool = True
    startS: float | None = None
    endS: float | None = None


class BurnTextRequest(BaseModel):
    path: str
    overlays: list[TextOverlayIn]


@router.post("/video/burn-text")
def video_burn_text(body: BurnTextRequest):
    src = _resolve_existing(body.path)
    out = _new_work_path(".mp4")
    overlays = [
        ve.TextOverlay(text=o.text, x=o.x, y=o.y, font_size=o.fontSize, color=o.color,
                        box=o.box, start_s=o.startS, end_s=o.endS)
        for o in body.overlays
    ]
    try:
        ve.burn_text(src, out, overlays)
    except Exception as exc:
        raise _engine_error_to_http(exc)
    return {"workPath": str(out)}


class ConcatRequest(BaseModel):
    paths: list[str]
    targetHeight: int = 1080


@router.post("/video/concat")
def video_concat(body: ConcatRequest):
    sources = [_resolve_existing(p) for p in body.paths]
    out = _new_work_path(".mp4")
    try:
        ve.concat(sources, out, target_height=body.targetHeight)
    except Exception as exc:
        raise _engine_error_to_http(exc)
    return {"workPath": str(out)}


@router.get("/video/hw-encoders")
def video_hw_encoders():
    return ve.detect_hw_encoders()


class TranscodeRequest(BaseModel):
    path: str
    useHw: bool = False
    crf: int = 20


@router.post("/video/export")
def video_export(body: TranscodeRequest):
    src = _resolve_existing(body.path)
    out = _new_work_path(".mp4")
    try:
        ve.transcode(src, out, use_hw=body.useHw, crf=body.crf)
    except Exception as exc:
        raise _engine_error_to_http(exc)
    return {"workPath": str(out)}


# ---------------------------------------------------------------------------
# Photo routes
# ---------------------------------------------------------------------------


@router.get("/photo/probe")
def photo_probe(path: str):
    src = _resolve_existing(path)
    try:
        info = pe.probe(src)
    except Exception as exc:
        raise _engine_error_to_http(exc)
    return {"width": info.width, "height": info.height, "format": info.format,
            "sizeBytes": info.size_bytes}


class RectIn(BaseModel):
    x: int
    y: int
    width: int
    height: int


class CropRequest(BaseModel):
    path: str
    rect: RectIn


@router.post("/photo/crop")
def photo_crop(body: CropRequest):
    src = _resolve_existing(body.path)
    out = _new_work_path(".jpg")
    try:
        pe.crop(src, out, pe.Rect(**body.rect.model_dump()))
    except Exception as exc:
        raise _engine_error_to_http(exc)
    return {"workPath": str(out)}


class RotateRequest(BaseModel):
    path: str
    degrees: int


@router.post("/photo/rotate")
def photo_rotate(body: RotateRequest):
    src = _resolve_existing(body.path)
    out = _new_work_path(".jpg")
    try:
        pe.rotate(src, out, body.degrees)
    except Exception as exc:
        raise _engine_error_to_http(exc)
    return {"workPath": str(out)}


class RedactRequest(BaseModel):
    path: str
    regions: list[RectIn]
    fill: tuple[int, int, int] = (0, 0, 0)


@router.post("/photo/redact")
def photo_redact(body: RedactRequest):
    src = _resolve_existing(body.path)
    out = _new_work_path(".jpg")
    regions = [pe.Rect(**r.model_dump()) for r in body.regions]
    try:
        pe.redact(src, out, regions, fill=body.fill)
    except Exception as exc:
        raise _engine_error_to_http(exc)
    return {"workPath": str(out)}


class TextAnnotationIn(BaseModel):
    text: str
    x: int
    y: int
    fontSize: int = 24
    color: tuple[int, int, int] = (255, 255, 255)


class ArrowAnnotationIn(BaseModel):
    x1: int
    y1: int
    x2: int
    y2: int
    color: tuple[int, int, int] = (255, 70, 70)


class AnnotateRequest(BaseModel):
    path: str
    texts: list[TextAnnotationIn] = []
    arrows: list[ArrowAnnotationIn] = []
    boxes: list[RectIn] = []


@router.post("/photo/annotate")
def photo_annotate(body: AnnotateRequest):
    src = _resolve_existing(body.path)
    out = _new_work_path(".jpg")
    texts = [pe.TextAnnotation(text=t.text, x=t.x, y=t.y, font_size=t.fontSize, color=t.color)
             for t in body.texts]
    arrows = [pe.ArrowAnnotation(**a.model_dump()) for a in body.arrows]
    boxes = [pe.BoxAnnotation(rect=pe.Rect(**b.model_dump())) for b in body.boxes]
    try:
        pe.annotate(src, out, texts, arrows, boxes)
    except Exception as exc:
        raise _engine_error_to_http(exc)
    return {"workPath": str(out)}


class ExportPdfRequest(BaseModel):
    paths: list[str]


@router.post("/photo/export-pdf")
def photo_export_pdf(body: ExportPdfRequest):
    sources = [_resolve_existing(p) for p in body.paths]
    out = _new_work_path(".pdf")
    try:
        pe.export_pdf(sources, out)
    except Exception as exc:
        raise _engine_error_to_http(exc)
    return {"workPath": str(out)}

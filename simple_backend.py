"""
simple_backend.py
=================
Minimal local HTTP server for the simplified DICOM Download & Viewer app.

Serves:
- Static frontend files (simple_web/)
- DICOM download API (delegates to simple_downloader)
- DICOM viewer API (reads DICOM files, serves raw pixel data, MPR manifest)
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import re
import secrets
import threading
import time
from dataclasses import dataclass, field
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Callable, Optional
from urllib.parse import unquote, urlparse

import mpr_engine
from dicom_io import discover_dicom_files

APP_VERSION = "2.0-simple"

MIME_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".wasm": "application/wasm",
}


def _natural_key(value: str) -> list[Any]:
    return [int(item) if item.isdigit() else item.casefold() for item in re.split(r"(\d+)", value)]


def _json_bytes(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def _finite_numbers(value: Any, count: int) -> Optional[list[float]]:
    if not isinstance(value, list) or len(value) != count:
        return None
    try:
        result = [float(item) for item in value]
    except (TypeError, ValueError):
        return None
    return result if all(math.isfinite(item) for item in result) else None


def _dicom_number(value: Any, default: float) -> float:
    if value is None:
        return default
    try:
        if not isinstance(value, (str, bytes)) and hasattr(value, "__len__"):
            value = value[0]
        result = float(value)
    except (IndexError, TypeError, ValueError):
        return default
    return result if math.isfinite(result) else default


# ── DICOM header reading ─────────────────────────────────────────────────────

@dataclass(frozen=True)
class DicomHeader:
    path: Path
    series_uid: str
    study_uid: str
    frame_uid: str
    series_number: str
    description: str
    modality: str
    rows: int
    columns: int
    samples_per_pixel: int
    photometric: str
    bits_allocated: int
    bits_stored: int
    high_bit: int
    pixel_representation: int
    pixel_spacing: Optional[list[float]]
    orientation: Optional[list[float]]
    position: Optional[list[float]]
    instance_number: float
    sop_uid: str
    rescale_slope: float
    rescale_intercept: float
    window_center: Optional[float]
    window_width: Optional[float]
    study_date: str = ""
    study_desc: str = ""


def _read_dicom_header(path: Path) -> Optional[DicomHeader]:
    import pydicom

    try:
        ds = pydicom.dcmread(str(path), stop_before_pixels=True, force=True)
        rows = int(getattr(ds, "Rows", 0) or 0)
        columns = int(getattr(ds, "Columns", 0) or 0)
        frames = int(getattr(ds, "NumberOfFrames", 1) or 1)
    except Exception:
        return None
    if rows <= 0 or columns <= 0 or frames != 1:
        return None
    samples = int(getattr(ds, "SamplesPerPixel", 1) or 1)
    photometric = str(getattr(ds, "PhotometricInterpretation", "MONOCHROME2") or "MONOCHROME2").upper()
    if samples != 1 or photometric not in {"MONOCHROME1", "MONOCHROME2"}:
        return None
    series_number = str(getattr(ds, "SeriesNumber", "") or "")
    description = str(getattr(ds, "SeriesDescription", "") or "").strip() or "DICOM series"
    series_uid = str(getattr(ds, "SeriesInstanceUID", "") or "").strip()
    if not series_uid:
        series_uid = f"fallback:{path.parent}:{series_number}:{description}"
    window_center_value = getattr(ds, "WindowCenter", None)
    window_width_value = getattr(ds, "WindowWidth", None)
    window_center = _dicom_number(window_center_value, math.nan)
    window_width = _dicom_number(window_width_value, math.nan)

    study_date = str(getattr(ds, "StudyDate", "") or "").strip()
    if study_date and len(study_date) == 8 and study_date.isdigit():
        study_date = f"{study_date[:4]}-{study_date[4:6]}-{study_date[6:]}"
    study_desc = str(getattr(ds, "StudyDescription", "") or "").strip()

    return DicomHeader(
        path=path,
        series_uid=series_uid,
        study_uid=str(getattr(ds, "StudyInstanceUID", "") or ""),
        frame_uid=str(getattr(ds, "FrameOfReferenceUID", "") or ""),
        series_number=series_number,
        description=description,
        modality=str(getattr(ds, "Modality", "UNKNOWN") or "UNKNOWN").upper(),
        rows=rows,
        columns=columns,
        samples_per_pixel=samples,
        photometric=photometric,
        bits_allocated=int(getattr(ds, "BitsAllocated", 16) or 16),
        bits_stored=int(getattr(ds, "BitsStored", 16) or 16),
        high_bit=int(getattr(ds, "HighBit", 15) or 15),
        pixel_representation=int(getattr(ds, "PixelRepresentation", 0) or 0),
        pixel_spacing=_finite_numbers(list(getattr(ds, "PixelSpacing", []) or []), 2),
        orientation=_finite_numbers(list(getattr(ds, "ImageOrientationPatient", []) or []), 6),
        position=_finite_numbers(list(getattr(ds, "ImagePositionPatient", []) or []), 3),
        instance_number=_dicom_number(getattr(ds, "InstanceNumber", None), math.inf),
        sop_uid=str(getattr(ds, "SOPInstanceUID", "") or ""),
        rescale_slope=_dicom_number(getattr(ds, "RescaleSlope", None), 1.0),
        rescale_intercept=_dicom_number(getattr(ds, "RescaleIntercept", None), 0.0),
        window_center=window_center if math.isfinite(window_center) else None,
        window_width=window_width if math.isfinite(window_width) and window_width > 0 else None,
        study_date=study_date,
        study_desc=study_desc,
    )


def _dicom_vectors_close(left, right):
    if left is None or right is None or len(left) != len(right):
        return False
    return all(abs(a - b) <= 1e-4 for a, b in zip(left, right))


def _ordered_dicom_headers(headers: list[DicomHeader]) -> list[DicomHeader]:
    if not headers or not headers[0].orientation or any(h.position is None for h in headers):
        return sorted(headers, key=lambda h: (h.instance_number, str(h.path).casefold()))
    orientation = headers[0].orientation
    row = orientation[:3]
    col = orientation[3:]
    normal = [
        row[1]*col[2] - row[2]*col[1],
        row[2]*col[0] - row[0]*col[2],
        row[0]*col[1] - row[1]*col[0],
    ]
    norm = math.sqrt(sum(n*n for n in normal))
    if norm <= 1e-9:
        return sorted(headers, key=lambda h: (h.instance_number, str(h.path).casefold()))
    normal = [n/norm for n in normal]
    return sorted(
        headers,
        key=lambda h: (
            sum(a*b for a, b in zip(h.position or [], normal)),
            h.instance_number,
            str(h.path).casefold(),
        ),
    )


# ── DICOM → MPR manifest ────────────────────────────────────────────────────

DICOM_MANIFEST_FORMAT = "dcom-direct-dicom"


def _direct_dicom_manifest(headers: list[DicomHeader]) -> tuple[Optional[dict], bool, str]:
    first = headers[0]
    spacing = first.pixel_spacing
    orientation = first.orientation
    if not spacing or min(spacing) <= 0:
        return None, False, "Thiếu PixelSpacing."
    if not orientation:
        return None, False, "Thiếu ImageOrientationPatient."
    frame_uids = {h.frame_uid for h in headers if h.frame_uid}
    if len(frame_uids) > 1:
        return None, False, "Không cùng FrameOfReferenceUID."
    row = orientation[:3]
    col = orientation[3:]
    row_norm = math.sqrt(sum(x*x for x in row))
    col_norm = math.sqrt(sum(x*x for x in col))
    dot = sum(a*b for a, b in zip(row, col))
    normal = [
        row[1]*col[2] - row[2]*col[1],
        row[2]*col[0] - row[0]*col[2],
        row[0]*col[1] - row[1]*col[0],
    ]
    normal_norm = math.sqrt(sum(n*n for n in normal))
    if abs(row_norm - 1) > 1e-3 or abs(col_norm - 1) > 1e-3 or abs(dot) > 1e-3 or normal_norm <= 1e-9:
        return None, False, "Orientation không hợp lệ."
    normal = [n/normal_norm for n in normal]
    if any(
        h.rows != first.rows or h.columns != first.columns
        or not _dicom_vectors_close(h.pixel_spacing, spacing)
        or not _dicom_vectors_close(h.orientation, orientation)
        or h.position is None
        for h in headers
    ):
        return None, False, "Geometry không đồng nhất."
    positioned = sorted(
        ((sum(a*b for a, b in zip(h.position or [], normal)), h) for h in headers),
        key=lambda p: p[0],
    )
    unique: list[tuple[float, DicomHeader]] = []
    for distance, h in positioned:
        if unique and abs(distance - unique[-1][0]) < 1e-4:
            continue
        unique.append((distance, h))
    if len(unique) != len(headers):
        return None, False, "Có lát trùng vị trí."
    gaps = [b[0] - a[0] for a, b in zip(unique, unique[1:])]
    slice_spacing = sorted(abs(v) for v in gaps)[len(gaps) // 2] if gaps else 0.0
    ordered = [
        {
            "file": f"dicom-{i+1:06d}",
            "position": list(h.position or []),
            "distance": float(d),
            "sop_instance_uid": h.sop_uid,
        }
        for i, (d, h) in enumerate(unique)
    ]
    origin = list(unique[0][1].position or [0.0, 0.0, 0.0])
    row_spacing, col_spacing = spacing
    affine = [
        [row[0]*col_spacing, col[0]*row_spacing, normal[0]*slice_spacing, origin[0]],
        [row[1]*col_spacing, col[1]*row_spacing, normal[1]*slice_spacing, origin[1]],
        [row[2]*col_spacing, col[2]*row_spacing, normal[2]*slice_spacing, origin[2]],
        [0.0, 0.0, 0.0, 1.0],
    ]
    manifest = {
        "format": DICOM_MANIFEST_FORMAT,
        "version": 1,
        "series_type": "DICOM_DIRECT",
        "series_description": first.description,
        "modality": "MR" if first.modality == "MRI" else first.modality,
        "series_number": first.series_number,
        "study_instance_uid": first.study_uid,
        "series_instance_uid": first.series_uid,
        "frame_of_reference_uid": first.frame_uid or first.series_uid,
        "rows": first.rows,
        "columns": first.columns,
        "slice_count": len(headers),
        "pixel_spacing": list(spacing),
        "slice_spacing": float(slice_spacing),
        "image_orientation_patient": list(orientation),
        "affine": affine,
        "ordered_slices": ordered,
    }
    if len(headers) < mpr_engine.DEFAULT_MIN_SLICES:
        return manifest, False, f"Cần ≥{mpr_engine.DEFAULT_MIN_SLICES} lát."
    if slice_spacing <= 0:
        return manifest, False, "Khoảng cách lát ≤ 0."
    if gaps and max(abs(abs(g) - slice_spacing) for g in gaps) > max(0.15, slice_spacing * 0.15):
        return manifest, False, "Khoảng cách lát không đồng nhất."
    return manifest, True, ""


# ── Pixel data serving ───────────────────────────────────────────────────────

def _dicom_pixel_payload(path: Path) -> tuple[bytes, dict[str, str]]:
    import numpy as np
    import pydicom

    try:
        ds = pydicom.dcmread(str(path), force=True)
        pixels = np.asarray(ds.pixel_array)
    except Exception as exc:
        raise ValueError(f"Lỗi đọc DICOM: {path.name} ({exc})") from exc
    if pixels.ndim != 2:
        raise ValueError("Chỉ hỗ trợ DICOM xám 2D.")

    bits = int(getattr(ds, "BitsAllocated", pixels.dtype.itemsize * 8) or pixels.dtype.itemsize * 8)
    signed = int(getattr(ds, "PixelRepresentation", 0) or 0) == 1
    if bits <= 8:
        dtype = np.dtype("i1" if signed else "u1")
        pixel_type = "int8" if signed else "uint8"
    elif bits <= 16:
        dtype = np.dtype("<i2" if signed else "<u2")
        pixel_type = "int16" if signed else "uint16"
    elif bits <= 32:
        dtype = np.dtype("<i4" if signed else "<u4")
        pixel_type = "int32" if signed else "uint32"
    else:
        raise ValueError(f"BitsAllocated={bits} chưa hỗ trợ.")
    pixels = np.ascontiguousarray(pixels.astype(dtype, copy=False))
    raw_min = int(pixels.min())
    raw_max = int(pixels.max())
    slope = _dicom_number(getattr(ds, "RescaleSlope", None), 1.0)
    intercept = _dicom_number(getattr(ds, "RescaleIntercept", None), 0.0)
    center = _dicom_number(getattr(ds, "WindowCenter", None), math.nan)
    width = _dicom_number(getattr(ds, "WindowWidth", None), math.nan)
    physical_min = raw_min * slope + intercept
    physical_max = raw_max * slope + intercept
    if not math.isfinite(center):
        center = (physical_min + physical_max) / 2.0
    if not math.isfinite(width) or width <= 0:
        width = max(1.0, physical_max - physical_min)
    headers = {
        "X-DCom-Pixel-Type": pixel_type,
        "X-DCom-Rows": str(pixels.shape[0]),
        "X-DCom-Columns": str(pixels.shape[1]),
        "X-DCom-Min": str(raw_min),
        "X-DCom-Max": str(raw_max),
        "X-DCom-Slope": repr(slope),
        "X-DCom-Intercept": repr(intercept),
        "X-DCom-Window-Center": repr(center),
        "X-DCom-Window-Width": repr(width),
        "X-DCom-Photometric": str(
            getattr(ds, "PhotometricInterpretation", "MONOCHROME2") or "MONOCHROME2"
        ).upper(),
    }
    return pixels.tobytes(order="C"), headers


# ── Series record & catalog ─────────────────────────────────────────────────

@dataclass
class SeriesRecord:
    series_id: str
    name: str
    folder: Path
    images: list[Path]
    manifest: Optional[dict]
    mpr_ready: bool
    mpr_reason: str
    modality: str = "UNKNOWN"
    study_group: str = ""
    pixel_data: Optional[dict] = None

    def public_dict(self) -> dict:
        data = {
            "id": self.series_id,
            "name": self.name,
            "sliceCount": len(self.images),
            "mprReady": self.mpr_ready,
            "mprReason": self.mpr_reason,
            "description": (self.manifest or {}).get("series_description", self.name),
            "modality": self.modality,
            "studyGroup": self.study_group,
        }
        if self.pixel_data:
            data["pixelData"] = self.pixel_data
        if self.manifest and all(
            k in self.manifest
            for k in ("rows", "columns", "pixel_spacing", "image_orientation_patient")
        ):
            data["geometry"] = {
                "rows": int(self.manifest["rows"]),
                "columns": int(self.manifest["columns"]),
                "pixelSpacing": self.manifest["pixel_spacing"],
                "sliceSpacing": float(self.manifest["slice_spacing"]),
                "orientation": self.manifest["image_orientation_patient"],
                "frameOfReferenceUID": self.manifest.get("frame_of_reference_uid") or self.series_id,
            }
        return data


class DicomCatalog:
    """Scans a folder for DICOM files, groups by series, computes MPR readiness."""

    def __init__(self):
        self._lock = threading.RLock()
        self.root: Optional[Path] = None
        self._series: dict[str, SeriesRecord] = {}

    def open(
        self,
        path: str,
        log: Optional[Callable[[str], None]] = None,
        should_stop: Optional[Callable[[], bool]] = None,
    ) -> dict:
        root = Path(path).expanduser().resolve(strict=True)
        if not root.is_dir():
            raise ValueError("Đường dẫn không phải thư mục.")

        paths = discover_dicom_files(root)
        if not paths:
            raise ValueError("Không tìm thấy file DICOM (.dcm, .dicom, .ima).")

        groups: dict[str, list[DicomHeader]] = {}
        unsupported = 0
        for i, p in enumerate(paths, 1):
            if should_stop and should_stop():
                return self.snapshot()
            if log and (i == 1 or i % 100 == 0):
                log(f"Đang đọc DICOM: {i}/{len(paths)} file…")
            header = _read_dicom_header(p)
            if header is not None:
                groups.setdefault(header.series_uid, []).append(header)
            else:
                unsupported += 1

        records: dict[str, SeriesRecord] = {}
        for uid, headers in groups.items():
            headers = _ordered_dicom_headers(headers)
            manifest, ready, reason = _direct_dicom_manifest(headers)
            first = headers[0]
            digest = hashlib.sha256(f"dicom:{root}:{uid}".casefold().encode("utf-8")).hexdigest()[:20]
            common = Path(os.path.commonpath([str(h.path.parent) for h in headers]))
            modality = "MR" if first.modality == "MRI" else first.modality

            parts = []
            if first.study_date:
                parts.append(first.study_date)
            parts.append(modality if modality in {"CT", "MR"} else first.modality)
            if first.study_desc:
                parts.append(first.study_desc)
            study_group = " - ".join(parts) if parts else "Không rõ ca chụp"

            records[digest] = SeriesRecord(
                series_id=digest,
                name=f"Series {first.series_number or '?'} - {first.description}",
                folder=common,
                images=[h.path for h in headers],
                manifest=manifest,
                mpr_ready=ready,
                mpr_reason=reason,
                modality=modality if modality in {"CT", "MR"} else "UNKNOWN",
                study_group=study_group,
                pixel_data={
                    "rows": first.rows,
                    "columns": first.columns,
                    "pixelSpacing": first.pixel_spacing,
                    "samplesPerPixel": first.samples_per_pixel,
                    "photometricInterpretation": first.photometric,
                    "bitsAllocated": first.bits_allocated,
                    "bitsStored": first.bits_stored,
                    "highBit": first.high_bit,
                    "pixelRepresentation": first.pixel_representation,
                    "rescaleSlope": first.rescale_slope,
                    "rescaleIntercept": first.rescale_intercept,
                    "windowCenter": first.window_center,
                    "windowWidth": first.window_width,
                },
            )

        if log and unsupported:
            log(f"Bỏ qua {unsupported} file DICOM không hỗ trợ.")
        if log:
            log(f"Tìm thấy {len(records)} series.")

        with self._lock:
            self.root = root
            self._series = records
        return self.snapshot()

    def snapshot(self) -> dict:
        with self._lock:
            return {
                "root": str(self.root) if self.root else "",
                "series": [r.public_dict() for r in self._series.values()],
            }

    def get(self, series_id: str) -> SeriesRecord:
        with self._lock:
            record = self._series.get(series_id)
        if not record:
            raise KeyError("Không tìm thấy series.")
        return record


# ── Job state ────────────────────────────────────────────────────────────────

@dataclass
class JobState:
    lock: threading.RLock = field(default_factory=threading.RLock)
    stop_event: threading.Event = field(default_factory=threading.Event)
    status: str = "idle"
    kind: str = ""
    message: str = ""
    logs: list[str] = field(default_factory=list)
    result: Any = None
    started_at: float = 0
    finished_at: float = 0

    def snapshot(self) -> dict:
        with self.lock:
            return {
                "status": self.status,
                "kind": self.kind,
                "message": self.message,
                "logs": self.logs[-300:],
                "result": self.result,
                "startedAt": self.started_at,
                "finishedAt": self.finished_at,
            }

    def log(self, message: str) -> None:
        with self.lock:
            self.logs.append(str(message))
            if len(self.logs) > 1000:
                del self.logs[:500]
            self.message = str(message)

    def start(self, kind: str, target: Callable[[], Any]) -> None:
        with self.lock:
            if self.status == "running":
                raise RuntimeError("Đang có tác vụ khác chạy.")
            self.stop_event = threading.Event()
            self.status = "running"
            self.kind = kind
            self.message = "Đang chuẩn bị..."
            self.logs = []
            self.result = None
            self.started_at = time.time()
            self.finished_at = 0

        def run():
            try:
                result = target()
                with self.lock:
                    self.result = result
                    self.status = "stopped" if self.stop_event.is_set() else "complete"
                    self.message = "Đã dừng." if self.stop_event.is_set() else "Hoàn tất."
            except Exception as exc:
                self.log(f"Lỗi: {exc}")
                with self.lock:
                    self.status = "error"
            finally:
                with self.lock:
                    self.finished_at = time.time()

        threading.Thread(target=run, name=f"simple-{kind}", daemon=True).start()


# ── Controller ───────────────────────────────────────────────────────────────

class SimpleController:
    def __init__(self):
        self.catalog = DicomCatalog()
        self.job = JobState()
        self.output_root = Path.home() / "DICOM Downloads"

    def bootstrap(self) -> dict:
        return {
            "version": APP_VERSION,
            "archive": self.catalog.snapshot(),
            "job": self.job.snapshot(),
            "outputRoot": str(self.output_root),
        }

    def set_output_root(self, path: str) -> dict:
        root = Path(path).expanduser().resolve()
        root.mkdir(parents=True, exist_ok=True)
        self.output_root = root
        return {"outputRoot": str(root)}

    def start_download(self, payload: dict) -> dict:
        import simple_downloader

        url = str(payload.get("url") or "").strip()
        parsed = urlparse(url)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            raise ValueError("Link viewer không hợp lệ.")
        output_root = Path(str(payload.get("outputRoot") or self.output_root)).expanduser().resolve()
        output_root.mkdir(parents=True, exist_ok=True)

        link_token = hashlib.sha256(url.encode("utf-8")).hexdigest()[:8]
        stamp = time.strftime("%Y%m%d_%H%M%S")
        download_dir = output_root / f"DICOM_{stamp}_{link_token}"

        def target() -> dict:
            stats = simple_downloader.download_all(
                url=url,
                output_dir=download_dir,
                log=self.job.log,
                headless=not bool(payload.get("showBrowser")),
                should_stop=self.job.stop_event.is_set,
            )
            if not self.job.stop_event.is_set() and stats.dicom <= 0:
                raise ValueError("Không tải được ảnh DICOM nào.")
            archive = self.catalog.open(
                str(download_dir),
                log=self.job.log,
                should_stop=self.job.stop_event.is_set,
            )
            return {"archive": archive, "output": str(download_dir), "dicom": stats.dicom}

        self.job.start("download", target)
        return self.job.snapshot()

    def start_viewer_open(self, path: str) -> dict:
        root = Path(path).expanduser().resolve(strict=True)
        if not root.is_dir():
            raise ValueError("Đường dẫn không phải thư mục.")

        def target() -> dict:
            return self.catalog.open(
                str(root),
                log=self.job.log,
                should_stop=self.job.stop_event.is_set,
            )

        self.job.start("viewer-open", target)
        return self.job.snapshot()

    def stop(self) -> dict:
        self.job.stop_event.set()
        self.job.log("Đang dừng...")
        return self.job.snapshot()


# ── HTTP Server ──────────────────────────────────────────────────────────────

class SimpleApiServer:
    def __init__(self, controller: SimpleController, static_dir: Path):
        self.controller = controller
        self.static_dir = Path(static_dir).resolve()
        self.token = secrets.token_urlsafe(32)
        self.httpd: Optional[ThreadingHTTPServer] = None
        self.thread: Optional[threading.Thread] = None

    @property
    def port(self) -> int:
        if not self.httpd:
            raise RuntimeError("Server chưa chạy.")
        return int(self.httpd.server_port)

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self.port}/?token={self.token}"

    def start(self) -> str:
        owner = self

        class Handler(BaseHTTPRequestHandler):
            server_version = "DComSimple/2.0"

            def log_message(self, _format, *_args):
                return

            def _send(self, status, body, content_type, extra=None):
                self.send_response(status)
                self.send_header("Content-Type", content_type)
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Cache-Control", "no-store")
                for name, value in (extra or {}).items():
                    self.send_header(name, value)
                try:
                    self.end_headers()
                    self.wfile.write(body)
                except (BrokenPipeError, ConnectionAbortedError, ConnectionResetError):
                    return

            def _json(self, status, value):
                self._send(status, _json_bytes(value), "application/json; charset=utf-8")

            def _authorized(self):
                return secrets.compare_digest(self.headers.get("X-DCom-Token", ""), owner.token)

            def _read_json(self):
                try:
                    length = int(self.headers.get("Content-Length", "0"))
                except ValueError:
                    raise ValueError("Content-Length không hợp lệ.")
                if length < 0 or length > 2 * 1024 * 1024:
                    raise ValueError("Yêu cầu quá lớn.")
                try:
                    value = json.loads(self.rfile.read(length).decode("utf-8")) if length else {}
                except Exception as exc:
                    raise ValueError("JSON không hợp lệ.") from exc
                if not isinstance(value, dict):
                    raise ValueError("Payload phải là object.")
                return value

            def _api_get(self, path):
                if path == "/api/bootstrap":
                    return owner.controller.bootstrap()
                if path == "/api/archive":
                    return owner.controller.catalog.snapshot()
                if path == "/api/job":
                    return owner.controller.job.snapshot()
                match = re.fullmatch(r"/api/series/([a-f0-9]{20})/manifest", path)
                if match:
                    record = owner.controller.catalog.get(match.group(1))
                    if not record.mpr_ready:
                        raise ValueError(record.mpr_reason)
                    return record.manifest
                raise KeyError("API không tồn tại.")

            def _api_post(self, path, payload):
                if path == "/api/download":
                    return owner.controller.start_download(payload)
                if path == "/api/viewer/open":
                    return owner.controller.start_viewer_open(str(payload.get("path") or ""))
                if path == "/api/output":
                    return owner.controller.set_output_root(str(payload.get("path") or ""))
                if path == "/api/job/stop":
                    return owner.controller.stop()
                raise KeyError("API không tồn tại.")

            def _serve_image(self, path):
                match = re.fullmatch(r"/api/series/([a-f0-9]{20})/image/(\d+)", path)
                if not match:
                    return False
                record = owner.controller.catalog.get(match.group(1))
                index = int(match.group(2))
                if not 0 <= index < len(record.images):
                    raise IndexError("Lát ảnh ngoài phạm vi.")
                body, headers = _dicom_pixel_payload(record.images[index])
                self._send(HTTPStatus.OK, body, "application/vnd.dcom.pixel-data", headers)
                return True

            def _static(self, path):
                relative = "index.html" if path in {"", "/"} else unquote(path.lstrip("/"))
                candidate = (owner.static_dir / relative).resolve()
                try:
                    candidate.relative_to(owner.static_dir)
                except ValueError:
                    self._json(HTTPStatus.NOT_FOUND, {"error": "Không tìm thấy."})
                    return
                if not candidate.is_file():
                    candidate = owner.static_dir / "index.html"
                if not candidate.is_file():
                    self._json(HTTPStatus.SERVICE_UNAVAILABLE, {"error": "Frontend chưa có."})
                    return
                body = candidate.read_bytes()
                mime = MIME_TYPES.get(candidate.suffix.casefold(), "application/octet-stream")
                self._send(HTTPStatus.OK, body, mime)

            def do_GET(self):
                path = urlparse(self.path).path
                if path.startswith("/api/"):
                    if not self._authorized():
                        self._json(HTTPStatus.UNAUTHORIZED, {"error": "Không được phép."})
                        return
                    try:
                        if self._serve_image(path):
                            return
                        self._json(HTTPStatus.OK, self._api_get(path))
                    except KeyError as exc:
                        self._json(HTTPStatus.NOT_FOUND, {"error": str(exc)})
                    except (ValueError, IndexError) as exc:
                        self._json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
                    except Exception as exc:
                        self._json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": str(exc)})
                    return
                self._static(path)

            def do_POST(self):
                path = urlparse(self.path).path
                if not path.startswith("/api/") or not self._authorized():
                    self._json(HTTPStatus.UNAUTHORIZED, {"error": "Không được phép."})
                    return
                try:
                    self._json(HTTPStatus.OK, self._api_post(path, self._read_json()))
                except KeyError as exc:
                    self._json(HTTPStatus.NOT_FOUND, {"error": str(exc)})
                except (ValueError, RuntimeError) as exc:
                    self._json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
                except Exception as exc:
                    self._json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": str(exc)})

        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.httpd.daemon_threads = True
        self.thread = threading.Thread(target=self.httpd.serve_forever, name="simple-api", daemon=True)
        self.thread.start()
        return self.url

    def stop(self):
        if self.httpd:
            self.httpd.shutdown()
            self.httpd.server_close()
        if self.thread and self.thread.is_alive():
            self.thread.join(timeout=2)

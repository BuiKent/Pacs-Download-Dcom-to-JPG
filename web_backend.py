"""Local-only HTTP backend for the WebView2 DICOM/JPG viewer.

The server is deliberately bound to 127.0.0.1 on a random port.  Every API
and image request requires a per-process bearer token, and image paths are
resolved through opaque series identifiers instead of accepting file paths
from the browser.
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

import dcom_pipeline
from dicom_io import discover_dicom_files
import mpr_engine


APP_VERSION = "1.1.0"
IMG_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}
ANNOTATIONS_NAME = "viewer-annotations.json"
# The classic Tk app writes the same file. Sharing it means a user who switches
# between the two UIs keeps one download history instead of two partial ones.
HISTORY_FILE = Path.home() / ".dcom_downloader_history.json"
HISTORY_MAX = 30
SUPPORTED_LANGUAGES = ("vi", "en")
MIME_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
    ".svg": "image/svg+xml",
    ".wasm": "application/wasm",
}

DICOM_MANIFEST_FORMAT = "dcom-direct-dicom"


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


def _dicom_numbers(value: Any, count: int) -> Optional[list[float]]:
    if value is None or isinstance(value, (str, bytes)):
        return None
    try:
        result = [float(item) for item in value]
    except (TypeError, ValueError):
        return None
    return result if len(result) == count and all(math.isfinite(item) for item in result) else None


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
        pixel_spacing=_dicom_numbers(getattr(ds, "PixelSpacing", None), 2),
        orientation=_dicom_numbers(getattr(ds, "ImageOrientationPatient", None), 6),
        position=_dicom_numbers(getattr(ds, "ImagePositionPatient", None), 3),
        instance_number=_dicom_number(getattr(ds, "InstanceNumber", None), math.inf),
        sop_uid=str(getattr(ds, "SOPInstanceUID", "") or ""),
        rescale_slope=_dicom_number(getattr(ds, "RescaleSlope", None), 1.0),
        rescale_intercept=_dicom_number(getattr(ds, "RescaleIntercept", None), 0.0),
        window_center=window_center if math.isfinite(window_center) else None,
        window_width=window_width if math.isfinite(window_width) and window_width > 0 else None,
        study_date=study_date,
        study_desc=study_desc,
    )


def _dicom_vectors_close(left: Optional[list[float]], right: Optional[list[float]]) -> bool:
    if left is None or right is None or len(left) != len(right):
        return False
    return all(abs(a - b) <= 1e-4 for a, b in zip(left, right))


def _ordered_dicom_headers(headers: list[DicomHeader]) -> list[DicomHeader]:
    if not headers or not headers[0].orientation or any(item.position is None for item in headers):
        return sorted(headers, key=lambda item: (item.instance_number, str(item.path).casefold()))
    orientation = headers[0].orientation
    row = orientation[:3]
    column = orientation[3:]
    normal = [
        row[1] * column[2] - row[2] * column[1],
        row[2] * column[0] - row[0] * column[2],
        row[0] * column[1] - row[1] * column[0],
    ]
    norm = math.sqrt(sum(item * item for item in normal))
    if norm <= 1e-9:
        return sorted(headers, key=lambda item: (item.instance_number, str(item.path).casefold()))
    normal = [item / norm for item in normal]
    return sorted(
        headers,
        key=lambda item: (
            sum(a * b for a, b in zip(item.position or [], normal)),
            item.instance_number,
            str(item.path).casefold(),
        ),
    )


def _direct_dicom_manifest(headers: list[DicomHeader]) -> tuple[Optional[dict], bool, str]:
    first = headers[0]
    spacing = first.pixel_spacing
    orientation = first.orientation
    if not spacing or min(spacing) <= 0:
        return None, False, "DICOM thiếu PixelSpacing nên chỉ mở được ảnh 2D theo pixel."
    if not orientation:
        return None, False, "DICOM thiếu ImageOrientationPatient nên chưa dựng được MPR/3D."
    frame_uids = {item.frame_uid for item in headers if item.frame_uid}
    if len(frame_uids) > 1:
        return None, False, "Các lát DICOM không cùng FrameOfReferenceUID."
    row = orientation[:3]
    column = orientation[3:]
    row_norm = math.sqrt(sum(item * item for item in row))
    column_norm = math.sqrt(sum(item * item for item in column))
    dot = sum(a * b for a, b in zip(row, column))
    normal = [
        row[1] * column[2] - row[2] * column[1],
        row[2] * column[0] - row[0] * column[2],
        row[0] * column[1] - row[1] * column[0],
    ]
    normal_norm = math.sqrt(sum(item * item for item in normal))
    if (
        abs(row_norm - 1) > 1e-3
        or abs(column_norm - 1) > 1e-3
        or abs(dot) > 1e-3
        or normal_norm <= 1e-9
    ):
        return None, False, "ImageOrientationPatient không hợp lệ."
    normal = [item / normal_norm for item in normal]
    if any(
        item.rows != first.rows
        or item.columns != first.columns
        or not _dicom_vectors_close(item.pixel_spacing, spacing)
        or not _dicom_vectors_close(item.orientation, orientation)
        or item.position is None
        for item in headers
    ):
        return None, False, "Các lát DICOM không đồng nhất geometry nên chưa dựng được MPR/3D."
    positioned = sorted(
        ((sum(a * b for a, b in zip(item.position or [], normal)), item) for item in headers),
        key=lambda pair: pair[0],
    )
    unique: list[tuple[float, DicomHeader]] = []
    for distance, item in positioned:
        if unique and abs(distance - unique[-1][0]) < 1e-4:
            continue
        unique.append((distance, item))
    if len(unique) != len(headers):
        return None, False, "Series DICOM có lát trùng vị trí nên chưa dựng được MPR/3D."
    gaps = [b[0] - a[0] for a, b in zip(unique, unique[1:])]
    slice_spacing = sorted(abs(value) for value in gaps)[len(gaps) // 2] if gaps else 0.0
    ordered = [
        {
            "file": f"dicom-{index + 1:06d}",
            "position": list(item.position or []),
            "distance": float(distance),
            "sop_instance_uid": item.sop_uid,
        }
        for index, (distance, item) in enumerate(unique)
    ]
    origin = list(unique[0][1].position or [0.0, 0.0, 0.0])
    row_spacing, column_spacing = spacing
    affine = [
        [row[0] * column_spacing, column[0] * row_spacing, normal[0] * slice_spacing, origin[0]],
        [row[1] * column_spacing, column[1] * row_spacing, normal[1] * slice_spacing, origin[1]],
        [row[2] * column_spacing, column[2] * row_spacing, normal[2] * slice_spacing, origin[2]],
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
        return manifest, False, f"Cần ít nhất {mpr_engine.DEFAULT_MIN_SLICES} lát đồng nhất để dựng MPR/3D."
    if slice_spacing <= 0:
        return manifest, False, "Khoảng cách lát cắt không hợp lệ."
    if gaps and max(abs(abs(gap) - slice_spacing) for gap in gaps) > max(0.15, slice_spacing * 0.15):
        return manifest, False, "Khoảng cách giữa các lát DICOM không đồng nhất."
    return manifest, True, ""


def _dicom_pixel_payload(path: Path) -> tuple[bytes, dict[str, str]]:
    import numpy as np
    import pydicom

    try:
        ds = pydicom.dcmread(str(path), force=True)
        pixels = np.asarray(ds.pixel_array)
    except Exception as exc:
        raise ValueError(f"Không giải mã được pixel DICOM: {path.name} ({exc})") from exc
    if pixels.ndim != 2:
        raise ValueError("Viewer trực tiếp hiện chỉ hỗ trợ DICOM xám một khung 2D.")

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
        raise ValueError(f"BitsAllocated={bits} chưa được hỗ trợ.")
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


def validate_mpr_manifest(folder: Path, manifest: Optional[dict]) -> tuple[bool, str]:
    """Validate geometry/completeness before exposing MPR or 3D controls."""
    if not manifest:
        return False, "Series này chỉ có ảnh 2D, không có gói hình học MPR."
    if manifest.get("format") != mpr_engine.MANIFEST_FORMAT:
        return False, "Định dạng manifest MPR không được hỗ trợ."
    if int(manifest.get("version", 0) or 0) != mpr_engine.MANIFEST_VERSION:
        return False, "Phiên bản manifest MPR không tương thích."

    rows = int(manifest.get("rows", 0) or 0)
    columns = int(manifest.get("columns", 0) or 0)
    count = int(manifest.get("slice_count", 0) or 0)
    spacing = _finite_numbers(manifest.get("pixel_spacing"), 2)
    orientation = _finite_numbers(manifest.get("image_orientation_patient"), 6)
    affine = manifest.get("affine")
    ordered = manifest.get("ordered_slices")

    if rows <= 0 or columns <= 0 or count < mpr_engine.DEFAULT_MIN_SLICES:
        return False, f"Cần ít nhất {mpr_engine.DEFAULT_MIN_SLICES} lát đồng nhất để dựng MPR/3D."
    if not spacing or min(spacing) <= 0:
        return False, "PixelSpacing không hợp lệ."
    try:
        slice_spacing = float(manifest.get("slice_spacing", 0))
    except (TypeError, ValueError):
        slice_spacing = 0
    if not math.isfinite(slice_spacing) or slice_spacing <= 0:
        return False, "Khoảng cách lát cắt không hợp lệ."
    if not orientation:
        return False, "ImageOrientationPatient không hợp lệ."
    row = orientation[:3]
    column = orientation[3:]
    row_norm = math.sqrt(sum(item * item for item in row))
    column_norm = math.sqrt(sum(item * item for item in column))
    dot = sum(a * b for a, b in zip(row, column))
    if abs(row_norm - 1) > 1e-3 or abs(column_norm - 1) > 1e-3 or abs(dot) > 1e-3:
        return False, "Hai vector định hướng DICOM không trực chuẩn."
    if not (
        isinstance(affine, list)
        and len(affine) == 4
        and all(_finite_numbers(item, 4) is not None for item in affine)
    ):
        return False, "Ma trận affine DICOM không hợp lệ."
    if not isinstance(ordered, list) or len(ordered) != count:
        return False, f"Gói MPR thiếu lát: có {len(ordered or [])}/{count}."

    distances: list[float] = []
    seen_files: set[str] = set()
    for item in ordered:
        if not isinstance(item, dict):
            return False, "Danh sách lát MPR bị hỏng."
        filename = str(item.get("file") or "")
        position = _finite_numbers(item.get("position"), 3)
        try:
            distance = float(item.get("distance"))
        except (TypeError, ValueError):
            return False, "Tọa độ lát MPR không hợp lệ."
        if (
            not filename
            or filename in seen_files
            or Path(filename).name != filename
            or not position
            or not math.isfinite(distance)
            or not (folder / filename).is_file()
        ):
            return False, "Một hoặc nhiều lát MPR bị thiếu hay không an toàn."
        seen_files.add(filename)
        distances.append(distance)

    if any(b <= a for a, b in zip(distances, distances[1:])):
        return False, "Thứ tự tọa độ lát MPR không tăng đều."
    if distances:
        gaps = [b - a for a, b in zip(distances, distances[1:])]
        if gaps and max(abs(gap - slice_spacing) for gap in gaps) > max(0.05, slice_spacing * 0.05):
            return False, "Khoảng cách giữa các lát không đồng nhất."
    return True, ""


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
    source_type: str = "image"
    pixel_data: Optional[dict] = None
    study_group: str = ""

    def public_dict(self) -> dict:
        data = {
            "id": self.series_id,
            "name": self.name,
            "sliceCount": len(self.images),
            "mprReady": self.mpr_ready,
            "mprReason": self.mpr_reason,
            "seriesType": (self.manifest or {}).get("series_type", ""),
            "description": (self.manifest or {}).get("series_description", self.name),
            "modality": self.modality,
            "sourceType": self.source_type,
            "studyGroup": self.study_group,
        }
        if self.pixel_data:
            data["pixelData"] = self.pixel_data
        if self.manifest and all(
            key in self.manifest
            for key in ("rows", "columns", "pixel_spacing", "image_orientation_patient")
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


class ArchiveCatalog:
    def __init__(self) -> None:
        self._lock = threading.RLock()
        self.root: Optional[Path] = None
        self._series: dict[str, SeriesRecord] = {}

    @staticmethod
    def _image_files(folder: Path, manifest: Optional[dict]) -> list[Path]:
        if manifest:
            files = mpr_engine.manifest_image_files(folder, manifest)
            if files:
                return files
        return sorted(
            (
                path for path in folder.iterdir()
                if path.is_file() and path.suffix.casefold() in IMG_EXTENSIONS
            ),
            key=lambda path: _natural_key(path.name),
        )

    @staticmethod
    def _modality(folder: Path, root: Path, manifest: Optional[dict]) -> str:
        declared = str((manifest or {}).get("modality") or "").strip().upper()
        if declared in {"CT", "MR", "MRI"}:
            return "MR" if declared == "MRI" else declared
        if str((manifest or {}).get("series_type") or "").upper().startswith("T1_"):
            return "MR"
        text = f"{root.name} {folder.relative_to(root)}"
        tokens = {token for token in re.split(r"[^A-Z0-9]+", text.upper()) if token}
        if "CT" in tokens:
            return "CT"
        if tokens.intersection({"MR", "MRI"}):
            return "MR"
        return "UNKNOWN"

    @staticmethod
    def _dicom_records(
        root: Path,
        *,
        log: Optional[Callable[[str], None]] = None,
        should_stop: Optional[Callable[[], bool]] = None,
    ) -> tuple[dict[str, SeriesRecord], int, int]:
        paths = discover_dicom_files(root)
        groups: dict[str, list[DicomHeader]] = {}
        unsupported = 0
        for index, path in enumerate(paths, start=1):
            if should_stop and should_stop():
                return {}, unsupported, len(paths)
            if log and (index == 1 or index % 100 == 0):
                log(f"Đang đọc metadata DICOM: {index}/{len(paths)} file…")
            header = _read_dicom_header(path)
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
            common = Path(os.path.commonpath([str(item.path.parent) for item in headers]))
            modality = "MR" if first.modality == "MRI" else first.modality
            
            parts = []
            if first.study_date: parts.append(first.study_date)
            parts.append(modality if modality in {"CT", "MR"} else first.modality)
            if first.study_desc: parts.append(first.study_desc)
            study_group = " - ".join(parts) if parts else "Không rõ ca chụp"

            records[digest] = SeriesRecord(
                series_id=digest,
                name=f"Series {first.series_number or '?'} - {first.description}",
                folder=common,
                images=[item.path for item in headers],
                manifest=manifest,
                mpr_ready=ready,
                mpr_reason=reason,
                modality=modality if modality in {"CT", "MR"} else "UNKNOWN",
                source_type="dicom",
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
            log(
                f"Bỏ qua {unsupported} file nghi DICOM chưa hỗ trợ "
                "(multi-frame, ảnh màu, metadata thiếu hoặc file hỏng)."
            )
        return records, unsupported, len(paths)

    def open(
        self,
        value: os.PathLike[str] | str,
        *,
        log: Optional[Callable[[str], None]] = None,
        should_stop: Optional[Callable[[], bool]] = None,
    ) -> dict:
        root = Path(value).expanduser().resolve(strict=True)
        if not root.is_dir():
            raise ValueError("Đường dẫn không phải thư mục.")
        if dcom_pipeline._read_patient_manifest(root) is None:
            patient_folders = []
            try:
                patient_folders = [
                    folder for folder in root.iterdir()
                    if folder.is_dir() and dcom_pipeline._read_patient_manifest(folder)
                ]
            except OSError:
                pass
            if len(patient_folders) == 1:
                root = patient_folders[0]
            elif len(patient_folders) > 1:
                raise ValueError(
                    "Folder tổng chứa nhiều bệnh nhân. Hãy mở đúng folder có tên bắt đầu bằng mã bệnh nhân để tránh trộn phim."
                )
        dicom_records, unsupported_dicom, dicom_candidates = self._dicom_records(
            root, log=log, should_stop=should_stop,
        )
        if dicom_records:
            if log:
                log(f"Đã nhận diện {len(dicom_records)} series DICOM, mở trực tiếp không chuyển JPG.")
            with self._lock:
                self.root = root
                self._series = dicom_records
            return self.snapshot()

        records: dict[str, SeriesRecord] = {}
        scanned = 0
        blocked = {"DICOM", "RAW_JPG"}
        for current, dirnames, _filenames in os.walk(root):
            if should_stop and should_stop():
                return self.snapshot()
            # Raw DICOM trees can contain tens of thousands of files and can
            # never be displayed by this JPG catalog. Prune them before walk
            # descends instead of filtering their children after rglob().
            dirnames[:] = [name for name in dirnames if name.upper() not in blocked]
            dirnames.sort(key=_natural_key)
            folder = Path(current)
            scanned += 1
            if log and (scanned == 1 or scanned % 100 == 0):
                log(f"Đang quét thư mục phim: {scanned} thư mục…")
            try:
                manifest = mpr_engine.read_manifest(folder)
                images = self._image_files(folder, manifest)
            except (OSError, ValueError) as exc:
                if log:
                    log(f"Bỏ qua thư mục không đọc được: {folder.name} ({exc})")
                continue
            if not images:
                continue
            digest = hashlib.sha256(str(folder).casefold().encode("utf-8")).hexdigest()[:20]
            ready, reason = validate_mpr_manifest(folder, manifest)
            relative_name = str(folder.relative_to(root)) if folder != root else folder.name
            
            study_group = ""
            if " - " in folder.name:
                parts = folder.name.rsplit(" - ", 1)
                if len(parts) == 2 and re.match(r'^[a-f0-9]+$', parts[1]):
                    study_group = parts[0]
            if not study_group:
                study_group = "Không rõ ca chụp"

            records[digest] = SeriesRecord(
                series_id=digest,
                name=relative_name,
                folder=folder,
                images=images,
                manifest=manifest,
                mpr_ready=ready,
                mpr_reason=reason,
                modality=self._modality(folder, root, manifest),
                study_group=study_group,
            )
        if log:
            log(f"Đã quét {scanned} thư mục, tìm thấy {len(records)} series ảnh.")
        if not records and dicom_candidates:
            raise ValueError(
                "Folder có file DICOM nhưng chưa có series ảnh xám một khung đọc được. "
                f"Đã bỏ qua {unsupported_dicom}/{dicom_candidates} file; "
                "hãy kiểm tra DICOM multi-frame, ảnh màu, file hỏng hoặc codec nén."
            )
        with self._lock:
            self.root = root
            self._series = records
        return self.snapshot()

    def snapshot(self) -> dict:
        with self._lock:
            return {
                "root": str(self.root) if self.root else "",
                "series": [record.public_dict() for record in self._series.values()],
            }

    def get(self, series_id: str) -> SeriesRecord:
        with self._lock:
            record = self._series.get(series_id)
        if not record:
            raise KeyError("Không tìm thấy series.")
        return record


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
        text = str(message)
        with self.lock:
            self.logs.append(text)
            if len(self.logs) > 1000:
                del self.logs[:500]
            self.message = text

    def start(self, kind: str, target: Callable[[], Any]) -> None:
        with self.lock:
            if self.status == "running":
                raise RuntimeError("Một tác vụ khác đang chạy.")
            self.stop_event = threading.Event()
            self.status = "running"
            self.kind = kind
            self.message = "Đang chuẩn bị..."
            self.logs = []
            self.result = None
            self.started_at = time.time()
            self.finished_at = 0

        def run() -> None:
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

        threading.Thread(target=run, name=f"dcom-{kind}", daemon=True).start()


class HistoryStore:
    """Recently downloaded/opened folders, shared with the classic Tk app.

    Every entry is ``{folder, url, time}`` exactly as the classic app writes it,
    so the two UIs can read each other's history. Writing history must never be
    able to fail a download, so all I/O errors here are swallowed.
    """

    def __init__(self, path: Path = HISTORY_FILE, limit: int = HISTORY_MAX):
        self.path = Path(path)
        self.limit = limit
        self._lock = threading.RLock()
        self._entries: list[dict] = []
        self.reload()

    def reload(self) -> list[dict]:
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
        except Exception:
            data = []
        entries = [
            {
                "folder": str(item.get("folder")),
                "url": str(item.get("url") or ""),
                "time": str(item.get("time") or ""),
            }
            for item in (data if isinstance(data, list) else [])
            if isinstance(item, dict) and item.get("folder")
        ]
        with self._lock:
            self._entries = entries[: self.limit]
            return list(self._entries)

    def snapshot(self) -> list[dict]:
        with self._lock:
            return [
                {**item, "exists": Path(item["folder"]).is_dir()}
                for item in self._entries
            ]

    def add(self, folder: Any, url: str = "") -> list[dict]:
        folder = str(folder)
        key = folder.casefold()
        with self._lock:
            previous = next(
                (item for item in self._entries if item["folder"].casefold() == key), None
            )
            if previous:
                self._entries.remove(previous)
                # Re-opening a folder from history must not erase the link that
                # was used to fill it; only a fresh link replaces the old one.
                url = url or previous.get("url", "")
            self._entries.insert(
                0,
                {
                    "folder": folder,
                    "url": url or "",
                    "time": time.strftime("%d/%m %H:%M"),
                },
            )
            del self._entries[self.limit:]
            entries = list(self._entries)
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            temporary = self.path.with_suffix(".json.tmp")
            temporary.write_text(
                json.dumps(entries, ensure_ascii=False, indent=1), encoding="utf-8"
            )
            temporary.replace(self.path)
        except Exception:
            pass
        return self.snapshot()

    def url_for(self, folder: Any) -> str:
        key = str(folder).casefold()
        with self._lock:
            match = next(
                (item for item in self._entries if item["folder"].casefold() == key), None
            )
            return match.get("url", "") if match else ""


class WebController:
    def __init__(self) -> None:
        self.catalog = ArchiveCatalog()
        self.job = JobState()
        app_data = Path(os.environ.get("LOCALAPPDATA") or Path.home())
        self.annotation_root = app_data / "DCom JPG PACS" / "viewer-annotations"
        self.settings_path = app_data / "DCom JPG PACS" / "settings.json"
        self.history = HistoryStore()
        settings = self._read_settings()
        self.language = settings.get("language", "vi")
        self.output_root = Path(settings.get("outputRoot") or (Path.home() / "DCom JPG PACS"))

    def _read_settings(self) -> dict:
        try:
            value = json.loads(self.settings_path.read_text(encoding="utf-8"))
        except Exception:
            return {}
        if not isinstance(value, dict):
            return {}
        language = str(value.get("language") or "vi")
        return {
            "language": language if language in SUPPORTED_LANGUAGES else "vi",
            "outputRoot": str(value.get("outputRoot") or ""),
        }

    def _write_settings(self) -> None:
        # A settings write must never break the session that triggered it.
        try:
            self.settings_path.parent.mkdir(parents=True, exist_ok=True)
            temporary = self.settings_path.with_suffix(".json.tmp")
            temporary.write_text(
                json.dumps(
                    {"language": self.language, "outputRoot": str(self.output_root)},
                    ensure_ascii=False,
                    indent=1,
                ),
                encoding="utf-8",
            )
            temporary.replace(self.settings_path)
        except Exception:
            pass

    def set_language(self, language: str) -> dict:
        value = str(language or "").casefold()
        if value not in SUPPORTED_LANGUAGES:
            raise ValueError("Ngôn ngữ không được hỗ trợ.")
        self.language = value
        self._write_settings()
        return {"language": self.language}

    def history_snapshot(self) -> list[dict]:
        return self.history.snapshot()

    def start_history_open(self, folder: str) -> dict:
        target = Path(str(folder or "")).expanduser()
        if not target.is_dir():
            raise ValueError(f"Thư mục không còn tồn tại:\n{target}")
        return self.start_archive_scan(str(target))

    def bootstrap(self) -> dict:
        # One snapshot: it serialises every series, so building it twice would
        # double the work on a large archive for no gain.
        archive = self.catalog.snapshot()
        return {
            "version": APP_VERSION,
            "archive": archive,
            "job": self.job.snapshot(),
            "outputRoot": str(self.output_root),
            "language": self.language,
            "history": self.history_snapshot(),
            "lastDirectUrl": self.history.url_for(archive.get("root", "")),
            "hospitals": [
                {
                    "id": key,
                    "name": value["name"],
                    "isDefault": bool(value.get("is_default")),
                }
                for key, value in dcom_pipeline.HOSPITALS.items()
            ],
        }

    def open_archive(self, path: str) -> dict:
        return self.catalog.open(path)

    def start_archive_scan(self, path: str) -> dict:
        root = str(Path(path).expanduser().resolve(strict=True))

        def target() -> dict:
            archive = self.catalog.open(
                root,
                log=self.job.log,
                should_stop=self.job.stop_event.is_set,
            )
            # A folder that was only browsed is worth remembering too; the
            # classic app records those the same way.
            self.history.add(root)
            return archive

        self.job.start("archive", target)
        return self.job.snapshot()

    def start_local_dicom_import(self, path: str, payload: Optional[dict] = None) -> dict:
        source = Path(path).expanduser().resolve(strict=True)
        if not source.is_dir():
            raise ValueError("Đường dẫn DICOM không phải thư mục.")
        options = payload or {}
        quality = max(70, min(int(options.get("quality", 100)), 100))
        output_root = Path(str(options.get("outputRoot") or self.output_root)).expanduser().resolve()
        output_root.mkdir(parents=True, exist_ok=True)

        def target() -> dict:
            stamp = f"{time.strftime('%Y%m%d_%H%M%S')}_{time.time_ns() % 1_000_000:06d}"
            source_token = hashlib.sha256(str(source).casefold().encode("utf-8")).hexdigest()[:8]
            destination = output_root / f"LOCAL_DICOM_{stamp}_{source_token}" / "JPG"
            self.job.log(f"Đang quét folder DICOM local và chuyển sang JPG chất lượng {quality}…")
            stats = dcom_pipeline.convert_all(
                source,
                destination,
                log=self.job.log,
                quality=quality,
                save_png=False,
                contrast_mode=dcom_pipeline.CLINICAL,
                should_stop=self.job.stop_event.is_set,
            )
            if not self.job.stop_event.is_set() and stats.converted <= 0:
                raise ValueError(
                    "Không tìm thấy ảnh DICOM có PixelData "
                    "(.dcm, .dicom, .ima hoặc file DICOM không đuôi)."
                )
            archive = self.catalog.open(
                destination,
                log=self.job.log,
                should_stop=self.job.stop_event.is_set,
            )
            self.history.add(destination)
            return {
                "archive": archive,
                "source": str(source),
                "output": str(destination),
                "converted": stats.converted,
                "failed": stats.failed,
            }

        self.job.start("local-import", target)
        return self.job.snapshot()

    def set_output_root(self, path: str) -> dict:
        root = Path(path).expanduser().resolve()
        root.mkdir(parents=True, exist_ok=True)
        self.output_root = root
        self._write_settings()
        return {"outputRoot": str(root)}

    def start_search(self, payload: dict) -> dict:
        hospital = str(payload.get("hospital") or "dhy")
        patient_id = str(payload.get("patientId") or "").strip()
        if not patient_id:
            raise ValueError("Cần nhập mã bệnh nhân.")

        def target() -> dict:
            studies = dcom_pipeline.search_patient_studies(
                hospital_key=hospital,
                patient_id=patient_id,
                modality="MR_CT",
                log=self.job.log,
                headless=not bool(payload.get("showBrowser")),
                should_stop=self.job.stop_event.is_set,
            )
            names = {
                dcom_pipeline._identity_token(item.get("patient_name")): item.get("patient_name")
                for item in studies
                if item.get("patient_name")
            }
            if len(names) > 1:
                raise ValueError(
                    "RIS trả nhiều tên khác nhau cho cùng mã bệnh nhân; không thể tự động gộp an toàn."
                )
            patient_name = next(iter(names.values()), "")
            hospital_name = dcom_pipeline.HOSPITALS.get(hospital, {}).get("name", hospital)
            patient = dcom_pipeline.patient_archive_status(
                self.output_root,
                patient_id=patient_id,
                patient_name=patient_name,
                hospital_key=hospital,
                hospital_name=hospital_name,
                studies=studies,
            )
            return {"studies": studies, "patient": patient}

        self.job.start("search", target)
        return self.job.snapshot()

    def start_download(self, payload: dict) -> dict:
        studies = payload.get("studies")
        if not isinstance(studies, list) or not studies:
            raise ValueError("Chưa chọn ca chụp.")
        all_studies = payload.get("allStudies")
        if not isinstance(all_studies, list) or not all_studies:
            all_studies = studies
        output_root = Path(str(payload.get("outputRoot") or self.output_root)).expanduser().resolve()
        output_root.mkdir(parents=True, exist_ok=True)
        quality = max(70, min(int(payload.get("quality", 100)), 100))
        patient_id = str(payload.get("patientId") or studies[0].get("patient_id") or "").strip()
        patient_name = str(payload.get("patientName") or studies[0].get("patient_name") or "").strip()
        hospital = str(payload.get("hospital") or studies[0].get("hospital_key") or "").strip().lower()
        hospital_name = dcom_pipeline.HOSPITALS.get(hospital, {}).get("name", hospital)
        if not patient_id or not hospital:
            raise ValueError("Thiếu mã bệnh nhân hoặc bệnh viện cho lượt tải theo RIS.")
        for study in all_studies:
            study_pid = str(study.get("patient_id") or patient_id)
            study_hospital = str(study.get("hospital_key") or hospital)
            if (
                dcom_pipeline._identity_token(study_pid) != dcom_pipeline._identity_token(patient_id)
                or dcom_pipeline._identity_token(study_hospital) != dcom_pipeline._identity_token(hospital)
            ):
                raise ValueError("Danh sách tải chứa study không cùng bệnh nhân/bệnh viện.")

        def target() -> dict:
            total = dcom_pipeline.download_studies_list(
                studies=studies,
                out_base=output_root,
                log=self.job.log,
                headless=not bool(payload.get("showBrowser")),
                quality=quality,
                save_png=bool(payload.get("savePng")),
                contrast_mode=str(payload.get("contrastMode") or dcom_pipeline.CLINICAL),
                should_stop=self.job.stop_event.is_set,
                patient_id=patient_id,
                patient_name=patient_name,
                hospital_key=hospital,
                hospital_name=hospital_name,
            )
            patient_folder, _manifest = dcom_pipeline.find_patient_archive(
                output_root, patient_id, hospital,
            )
            if patient_folder is None:
                raise ValueError("Không tìm thấy folder bệnh nhân sau khi tải.")
            archive = self.catalog.open(patient_folder)
            self.history.add(patient_folder)
            patient = dcom_pipeline.patient_archive_status(
                output_root,
                patient_id=patient_id,
                patient_name=patient_name,
                hospital_key=hospital,
                hospital_name=hospital_name,
                studies=all_studies,
            )
            return {
                "downloaded": total,
                "archive": archive,
                "patient": patient,
                "patientFolder": str(patient_folder),
                "studies": all_studies,
            }

        self.job.start("download", target)
        return self.job.snapshot()

    @staticmethod
    def _direct_download_root(output_root: Path, url: str, resume: bool) -> tuple[Path, bool]:
        """Pick the folder a direct link downloads into.

        A retry must merge into the folder the first attempt created, otherwise
        the already-downloaded slices are re-fetched into a second folder and
        the study ends up split. The link token is derived from the URL, so the
        previous attempt for the same link is recoverable even though its
        timestamp is not.
        """
        link_token = hashlib.sha256(url.encode("utf-8")).hexdigest()[:8]
        if resume:
            existing = sorted(
                (item for item in output_root.glob(f"LINK_*_{link_token}") if item.is_dir()),
                key=lambda item: item.name,
            )
            if existing:
                return existing[-1], True
        stamp = time.strftime("%Y%m%d_%H%M%S")
        return output_root / f"LINK_{stamp}_{link_token}", False

    def start_direct_download(self, payload: dict) -> dict:
        url = str(payload.get("url") or "").strip()
        parsed = urlparse(url)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            raise ValueError("Link viewer không hợp lệ.")
        output_root = Path(str(payload.get("outputRoot") or self.output_root)).expanduser().resolve()
        output_root.mkdir(parents=True, exist_ok=True)
        requested_resume = bool(payload.get("resume"))

        def target() -> dict:
            direct_root, resumed = self._direct_download_root(output_root, url, requested_resume)
            if requested_resume and not resumed:
                self.job.log(
                    "Không tìm thấy folder cũ của link này; sẽ tải mới vào folder riêng."
                )
            _, _, jpg_dir = dcom_pipeline.run_pipeline(
                url=url,
                out_base=direct_root,
                log=self.job.log,
                headless=not bool(payload.get("showBrowser")),
                quality=max(70, min(int(payload.get("quality", 100)), 100)),
                save_png=bool(payload.get("savePng")),
                contrast_mode=str(payload.get("contrastMode") or dcom_pipeline.CLINICAL),
                should_stop=self.job.stop_event.is_set,
                resume=resumed,
            )
            archive = self.catalog.open(jpg_dir if Path(jpg_dir).exists() else direct_root)
            # The link is stored with the folder so a later retry from history
            # can reuse it; these viewer links expire fast, but an expired link
            # is still better than none when the user wants to edit and resend.
            self.history.add(direct_root, url)
            return {"archive": archive, "output": str(direct_root), "resumed": resumed}

        self.job.start("direct-download", target)
        return self.job.snapshot()

    def stop(self) -> dict:
        self.job.stop_event.set()
        self.job.log("Đang yêu cầu dừng an toàn...")
        return self.job.snapshot()

    def _annotations_path(self, record: SeriesRecord) -> Path:
        if record.source_type == "dicom":
            return self.annotation_root / f"{record.series_id}.json"
        return record.folder / ANNOTATIONS_NAME

    def get_annotations(self, series_id: str) -> dict:
        record = self.catalog.get(series_id)
        path = self._annotations_path(record)
        if not path.is_file():
            return {"version": 1, "annotations": []}
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            return {"version": 1, "annotations": []}
        return data if isinstance(data, dict) else {"version": 1, "annotations": []}

    def save_annotations(self, series_id: str, value: dict) -> dict:
        record = self.catalog.get(series_id)
        annotations = value.get("annotations")
        if not isinstance(annotations, list):
            raise ValueError("Dữ liệu đo/ROI không hợp lệ.")
        payload = {"version": 1, "annotations": annotations}
        path = self._annotations_path(record)
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix(".json.tmp")
        temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        temporary.replace(path)
        return {"saved": True, "count": len(annotations)}


class LocalApiServer:
    def __init__(self, controller: WebController, static_dir: Path):
        self.controller = controller
        self.static_dir = Path(static_dir).resolve()
        self.token = secrets.token_urlsafe(32)
        self.httpd: Optional[ThreadingHTTPServer] = None
        self.thread: Optional[threading.Thread] = None

    @property
    def port(self) -> int:
        if not self.httpd:
            raise RuntimeError("Server chưa khởi động.")
        return int(self.httpd.server_port)

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self.port}/?token={self.token}"

    def start(self) -> str:
        owner = self

        class Handler(BaseHTTPRequestHandler):
            server_version = "DComLocal/1.1"

            def log_message(self, _format: str, *_args: Any) -> None:
                return

            def _headers(
                self,
                content_type: str,
                length: int,
                extra: Optional[dict[str, str]] = None,
            ) -> None:
                self.send_header("Content-Type", content_type)
                self.send_header("Content-Length", str(length))
                self.send_header("Cache-Control", "no-store")
                self.send_header("X-Content-Type-Options", "nosniff")
                self.send_header("X-Frame-Options", "DENY")
                self.send_header("Referrer-Policy", "no-referrer")
                self.send_header(
                    "Content-Security-Policy",
                    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
                    "img-src 'self' blob: data:; worker-src 'self' blob:; connect-src 'self'; "
                    "object-src 'none'; frame-ancestors 'none'; base-uri 'none'",
                )
                for name, value in (extra or {}).items():
                    self.send_header(name, value)

            def _send(
                self,
                status: int,
                body: bytes,
                content_type: str,
                extra: Optional[dict[str, str]] = None,
            ) -> None:
                self.send_response(status)
                self._headers(content_type, len(body), extra)
                try:
                    self.end_headers()
                    self.wfile.write(body)
                except (BrokenPipeError, ConnectionAbortedError, ConnectionResetError):
                    # The viewer can cancel prefetched slices while switching
                    # layouts or closing. The request is already gone; there is
                    # no client left to receive a second error response.
                    return

            def _json(self, status: int, value: Any) -> None:
                self._send(status, _json_bytes(value), "application/json; charset=utf-8")

            def _authorized(self) -> bool:
                host = self.headers.get("Host", "")
                if host not in {f"127.0.0.1:{owner.port}", f"localhost:{owner.port}"}:
                    return False
                origin = self.headers.get("Origin")
                if origin and origin not in {
                    f"http://127.0.0.1:{owner.port}",
                    f"http://localhost:{owner.port}",
                }:
                    return False
                return secrets.compare_digest(self.headers.get("X-DCom-Token", ""), owner.token)

            def _read_json(self) -> dict:
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

            def _api_get(self, path: str) -> Any:
                if path == "/api/bootstrap":
                    return owner.controller.bootstrap()
                if path == "/api/archive":
                    return owner.controller.catalog.snapshot()
                if path == "/api/job":
                    return owner.controller.job.snapshot()
                if path == "/api/history":
                    return {"history": owner.controller.history_snapshot()}
                match = re.fullmatch(r"/api/series/([a-f0-9]{20})/manifest", path)
                if match:
                    record = owner.controller.catalog.get(match.group(1))
                    if not record.mpr_ready:
                        raise ValueError(record.mpr_reason)
                    return record.manifest
                match = re.fullmatch(r"/api/series/([a-f0-9]{20})/annotations", path)
                if match:
                    return owner.controller.get_annotations(match.group(1))
                raise KeyError("API không tồn tại.")

            def _api_post(self, path: str, payload: dict) -> Any:
                if path == "/api/archive/open":
                    return owner.controller.open_archive(str(payload.get("path") or ""))
                if path == "/api/archive/scan":
                    return owner.controller.start_archive_scan(str(payload.get("path") or ""))
                if path == "/api/output":
                    return owner.controller.set_output_root(str(payload.get("path") or ""))
                if path == "/api/search":
                    return owner.controller.start_search(payload)
                if path == "/api/download":
                    return owner.controller.start_download(payload)
                if path == "/api/download/direct":
                    return owner.controller.start_direct_download(payload)
                if path == "/api/job/stop":
                    return owner.controller.stop()
                if path == "/api/history/open":
                    return owner.controller.start_history_open(str(payload.get("folder") or ""))
                if path == "/api/settings/language":
                    return owner.controller.set_language(str(payload.get("language") or ""))
                match = re.fullmatch(r"/api/series/([a-f0-9]{20})/annotations", path)
                if match:
                    return owner.controller.save_annotations(match.group(1), payload)
                raise KeyError("API không tồn tại.")

            def _serve_image(self, path: str) -> bool:
                match = re.fullmatch(r"/api/series/([a-f0-9]{20})/image/(\d+)", path)
                if not match:
                    return False
                record = owner.controller.catalog.get(match.group(1))
                index = int(match.group(2))
                if not 0 <= index < len(record.images):
                    raise IndexError("Lát ảnh ngoài phạm vi.")
                image = record.images[index]
                if record.source_type == "dicom":
                    body, headers = _dicom_pixel_payload(image)
                    self._send(
                        HTTPStatus.OK,
                        body,
                        "application/vnd.dcom.pixel-data",
                        headers,
                    )
                    return True
                body = image.read_bytes()
                mime = MIME_TYPES.get(image.suffix.casefold(), "application/octet-stream")
                self._send(HTTPStatus.OK, body, mime)
                return True

            def _static(self, path: str) -> None:
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
                    self._json(HTTPStatus.SERVICE_UNAVAILABLE, {"error": "Frontend chưa được build."})
                    return
                body = candidate.read_bytes()
                mime = MIME_TYPES.get(candidate.suffix.casefold(), "application/octet-stream")
                self._send(HTTPStatus.OK, body, mime)

            def do_GET(self) -> None:  # noqa: N802
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

            def do_POST(self) -> None:  # noqa: N802
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
        self.thread = threading.Thread(target=self.httpd.serve_forever, name="dcom-local-api", daemon=True)
        self.thread.start()
        return self.url

    def stop(self) -> None:
        if self.httpd:
            self.httpd.shutdown()
            self.httpd.server_close()
        if self.thread and self.thread.is_alive():
            self.thread.join(timeout=2)

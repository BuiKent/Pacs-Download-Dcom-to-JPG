"""Local-only HTTP backend for the WebView2 DICOM/JPG viewer.

The server is deliberately bound to 127.0.0.1 on a random port.  Every API
and image request requires a per-process bearer token, and image paths are
resolved through opaque series identifiers instead of accepting file paths
from the browser.
"""

from __future__ import annotations

import datetime
import copy
import hashlib
import json
import math
import os
import re
import secrets
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import uuid
from dataclasses import dataclass, field, replace
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Callable, Optional
from urllib.parse import unquote, urlparse

import dcom_pipeline
import dicom_io
from dicom_io import discover_dicom_files
import mpr_engine


APP_VERSION = "1.1.0"
IMG_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}
VIDEO_EXTENSIONS = {".mp4", ".webm", ".avi", ".mov", ".mkv"}
# Modalities whose slices belong on the reading canvas no matter what file
# format they arrived in. A converted JPG of an MR slice is still an MR slice.
DIAGNOSTIC_MODALITIES = {"CT", "MR", "MRI", "CR", "DX", "XA", "US", "PT", "NM", "MG"}
TEXT_EXTENSIONS = {".txt", ".json"}
# Scanned paperwork arrives as PDF. The worklist has always counted these, but
# nothing could open one, so they were tallied and then unreachable.
PDF_EXTENSIONS = {".pdf"}
# Bookkeeping the app writes for itself. They are .json sitting in the archive,
# so the text scanner would otherwise offer `patient-index.json` to a clinician
# as though it were a report.
APP_METADATA_NAMES = {
    "patient-index.json",
    "viewer-annotations.json",
    ".direct-download.json",
    ".dicom_cache.json",
    "manifest.json",
    # Written next to every converted JPG series by the MPR builder, so a
    # study folder would otherwise list a second "report" holding geometry.
    "mpr-volume.json",
    "pacs-strategies-v1.json",
    "settings.json",
}
# Largest text file the viewer will load into the page. A report or a manifest
# is kilobytes; anything past this is a data dump that would freeze the tab.
TEXT_MAX_BYTES = 2 * 1024 * 1024
# Folder names that mark scanned paperwork rather than clinical photographs.
# Matched against the folder name only — never against a study description,
# because "sau mổ" in a study description describes a scan of a patient, not a
# video of an operation.
DOC_FOLDER_HINTS = {"doc", "docs", "benh_an", "benh-an", "benhan", "scan", "scans", "hoso", "ho_so"}
DOC_FOLDER_WORDS = {
    "doc", "docs", "document", "documents",
    "scan", "scans",
    "benhan", "hoso", "giayto",
}
DOC_FOLDER_COMPOUNDS = {
    "benh_an", "benh-an", "ho_so", "ho-so", "giay_to", "giay-to",
    "tai_lieu", "tai-lieu", "don_thuoc", "don-thuoc", "ra_vien", "ra-vien",
}
IMAGING_MODALITY_TOKENS = {
    "ct", "mr", "mri", "xray", "x-ray", "xquang", "x-quang", "pet", "spect", "us", "sieuam", "sieu_am",
}
ANNOTATIONS_NAME = "viewer-annotations.json"


# What a folder can hold, in the order a folder with several kinds is read.
MEDIA_KINDS: tuple[tuple[set[str], str], ...] = (
    (VIDEO_EXTENSIONS, "video"),
    (PDF_EXTENSIONS, "pdf"),
    (TEXT_EXTENSIONS, "text"),
    # Photographs and scanned paperwork filed beside a study. Without this, a
    # patient folder holding both a scan and its operative photos listed the
    # scan and silently dropped the photos.
    (IMG_EXTENSIONS, "image"),
)


def media_type_for_file(path: Path) -> str:
    """Which viewer a file belongs in, decided by the file itself.

    Returns one of "dicom", "video", "photo", "text" or "" when nothing here
    can display it.

    The extension decides, never the wording of a study description. The old
    frontend heuristic looked for "mổ" and "phẫu thuật" in the description and
    sent anything matching to the video editor, which meant every follow-up
    scan — "MR khớp gối sau mổ", "CT bụng sau mổ ruột thừa" — opened in a video
    trimmer instead of the diagnostic canvas. A file's type is a property of
    the file, so that is what gets read.
    """
    if path.name.startswith("."):
        return ""
    suffix = path.suffix.casefold()
    if suffix in VIDEO_EXTENSIONS:
        return "video"
    if suffix in PDF_EXTENSIONS:
        return "pdf"
    if suffix in TEXT_EXTENSIONS:
        return "" if path.name.casefold() in APP_METADATA_NAMES else "text"
    if suffix in IMG_EXTENSIONS:
        return "photo"
    if suffix in {".dcm", ".dicom", ".ima"}:
        return "dicom"
    return ""


def is_document_folder(folder: Path) -> bool:
    """Whether a folder of images holds scanned paperwork rather than photos or diagnostic scans.

    Read off the folder name alone. Photographs and scanned records are both
    JPEGs, so the only honest signal available without opening every file is
    where the operator filed them.
    """
    name = folder.name.casefold()
    # A DICOM series or converted JPG series is diagnostic imaging, never paperwork
    if folder.name.startswith("Series_") or folder.name in {"DICOM", "JPG", "mpr", "MPR"}:
        return False

    norm = re.sub(r"[\s\-]+", "_", name)
    if any(compound in norm for compound in DOC_FOLDER_COMPOUNDS):
        return True

    tokens = set(re.split(r"[^a-z0-9]+", name))
    if any(word in tokens for word in DOC_FOLDER_WORDS):
        # 'CT Scan' or 'MRI scan' is diagnostic imaging, not scanned paperwork
        if "scan" in tokens and any(m in tokens for m in IMAGING_MODALITY_TOKENS):
            return False
        return True
    return False


def _is_document_image(study_dir: Path, root_path: Path, filename: str) -> bool:
    """Whether an image file represents scanned paperwork rather than a clinical photo or DICOM slice."""
    # Slices in converted JPG or DICOM series folders are diagnostic imaging
    try:
        rel_parts = root_path.relative_to(study_dir).parts
        if any(p in {"JPG", "DICOM", "mpr", "MPR"} or p.startswith("Series_") for p in rel_parts):
            return False
    except ValueError:
        pass

    # Check directory hierarchy from root_path up to study_dir
    curr = root_path
    while True:
        if is_document_folder(curr):
            return True
        if curr == study_dir or curr.parent == curr:
            break
        curr = curr.parent

    # Check file name tokens/compounds
    fn_lower = filename.casefold()
    fn_norm = re.sub(r"[\s\-]+", "_", fn_lower)
    if any(compound in fn_norm for compound in DOC_FOLDER_COMPOUNDS):
        return True
    fn_tokens = set(re.split(r"[^a-z0-9]+", fn_lower))
    if any(word in fn_tokens for word in DOC_FOLDER_WORDS):
        if "scan" in fn_tokens and any(m in fn_tokens for m in IMAGING_MODALITY_TOKENS):
            return False
        return True
    return False


MEDIA_WORK_ROOT = Path(tempfile.gettempdir()) / "concord_media_work"
MEDIA_WORK_ROOT.mkdir(parents=True, exist_ok=True)

# How much of a media file goes out per write. Intra-op video runs to hundreds
# of megabytes; answering a request by reading the whole file into memory made
# the player wait for the entire download before the first frame.
MEDIA_CHUNK_BYTES = 256 * 1024

# GET routes that only read one media file back out. A <video> or <img> element
# cannot set the `X-DCom-Token` header, so these accept the token in the query
# instead — that is what lets the player stream and seek a file itself rather
# than buffering the whole thing through fetch(). Nothing that writes is here.
_MEDIA_STREAM_PATH_RE = re.compile(r"/api/series/[a-f0-9]{20}/image/\d+")


def _allows_query_token(path: str) -> bool:
    return bool(_MEDIA_STREAM_PATH_RE.fullmatch(path)) or path == "/api/media/work-file"


def _token_matches(supplied: str, expected: str) -> bool:
    """Constant-time token comparison that survives non-ASCII input.

    `compare_digest` raises on strings it cannot encode, and both the header
    and the query string are attacker-controlled.
    """
    try:
        return secrets.compare_digest(supplied or "", expected)
    except TypeError:
        return False


# The classic Tk app writes the same file. Sharing it means a user who switches
# between the two UIs keeps one download history instead of two partial ones.
HISTORY_FILE = Path.home() / ".dcom_downloader_history.json"
HISTORY_MAX = 30
SUPPORTED_LANGUAGES = ("vi", "en")
DIRECT_DOWNLOAD_META_NAME = ".direct-download.json"
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
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".ogg": "video/ogg",
    ".mov": "video/quicktime",
    ".pdf": "application/pdf",
}

DICOM_MANIFEST_FORMAT = "dcom-direct-dicom"

# Grayscale is windowed; every other accepted form is converted to plain RGB
# before it leaves the backend, so the browser only ever sees these two shapes.
GRAYSCALE_PHOTOMETRICS = {"MONOCHROME1", "MONOCHROME2"}
COLOR_PHOTOMETRICS = {"RGB", "PALETTE COLOR", "YBR_FULL", "YBR_FULL_422", "YBR_RCT", "YBR_ICT"}
SUPPORTED_PHOTOMETRICS = GRAYSCALE_PHOTOMETRICS | COLOR_PHOTOMETRICS


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
    patient_id: str = ""
    patient_name: str = ""
    patient_birth_date: str = ""
    patient_sex: str = ""
    patient_age: str = ""
    number_of_frames: int = 1
    # Acquisition parameters the reader checks a sequence against: TR/TE on MR,
    # slice thickness and position on CT, kVp/mAs on radiography. Empty for a
    # file that records none of them — a missing parameter is shown as missing,
    # never as a zero.
    acquisition: dict = field(default_factory=dict)
    # Which frame inside `path` this header stands for. Always 0 for classic
    # single-frame files; an enhanced multi-frame file yields one header per
    # frame so the rest of the pipeline can treat frames as ordinary slices.
    frame_index: int = 0


def _sequence_item(group: Any, name: str) -> Any:
    """First item of a DICOM functional-group sub-sequence, or None."""
    sequence = getattr(group, name, None) if group is not None else None
    if sequence is None:
        return None
    try:
        return sequence[0] if len(sequence) else None
    except (IndexError, TypeError):
        return None


def _sequence_item_at(owner: Any, name: str, index: int) -> Any:
    """Item `index` of a top-level sequence, or None when it is out of reach."""
    sequence = getattr(owner, name, None)
    try:
        return sequence[index] if sequence is not None and index < len(sequence) else None
    except (IndexError, TypeError):
        return None


@dataclass(frozen=True)
class FrameAttributes:
    """Everything an enhanced frame can override on its own."""
    position: Optional[list[float]]
    orientation: Optional[list[float]]
    pixel_spacing: Optional[list[float]]
    rescale_slope: Optional[float]
    rescale_intercept: Optional[float]
    window_center: Optional[float]
    window_width: Optional[float]


def _frame_attributes(shared: Any, item: Any) -> FrameAttributes:
    """Read one frame's attributes, letting per-frame values win over shared.

    Enhanced CT/MR keeps geometry *and* the modality/VOI transforms inside the
    functional groups. Collapsing them to the first frame's values silently
    mislabels a file whose frames differ — which is exactly what a
    multi-orientation or variable-rescale acquisition looks like.
    """
    def read(name: str, attribute: str, count: Optional[int] = None) -> Any:
        for group in (item, shared):
            entry = _sequence_item(group, name)
            value = getattr(entry, attribute, None) if entry is not None else None
            if value is None:
                continue
            if count is None:
                number = _dicom_number(value, math.nan)
                if math.isfinite(number):
                    return number
                continue
            numbers = _dicom_numbers(value, count)
            if numbers is not None:
                return numbers
        return None

    width = read("FrameVOILUTSequence", "WindowWidth")
    return FrameAttributes(
        position=read("PlanePositionSequence", "ImagePositionPatient", 3),
        orientation=read("PlaneOrientationSequence", "ImageOrientationPatient", 6),
        pixel_spacing=read("PixelMeasuresSequence", "PixelSpacing", 2),
        rescale_slope=read("PixelValueTransformationSequence", "RescaleSlope"),
        rescale_intercept=read("PixelValueTransformationSequence", "RescaleIntercept"),
        window_center=read("FrameVOILUTSequence", "WindowCenter"),
        window_width=width if width is None or width > 0 else None,
    )


def _multiframe_attributes(ds: Any, frames: int) -> list[FrameAttributes]:
    """One FrameAttributes per frame, per-frame values overriding shared ones."""
    shared = _sequence_item(ds, "SharedFunctionalGroupsSequence")
    per_frame = getattr(ds, "PerFrameFunctionalGroupsSequence", None)
    result: list[FrameAttributes] = []
    for index in range(frames):
        item = None
        try:
            if per_frame is not None and index < len(per_frame):
                item = per_frame[index]
        except TypeError:
            item = None
        result.append(_frame_attributes(shared, item))
    return result


def _acquisition_parameters(ds: Any, modality: str) -> dict:
    """Technical parameters worth printing next to the image.

    Shared with the JPG conversion so a converted study keeps the same fields
    the DICOM carried — see `dicom_io.acquisition_parameters`.
    """
    return dicom_io.acquisition_parameters(ds, modality)


def _read_dicom_header(path: Path) -> list[DicomHeader]:
    import pydicom

    try:
        ds = pydicom.dcmread(str(path), stop_before_pixels=True, force=True)
        rows = int(getattr(ds, "Rows", 0) or 0)
        columns = int(getattr(ds, "Columns", 0) or 0)
        frames = int(getattr(ds, "NumberOfFrames", 1) or 1)
    except Exception:
        return []
    if rows <= 0 or columns <= 0:
        return []
    samples = int(getattr(ds, "SamplesPerPixel", 1) or 1)
    photometric = str(getattr(ds, "PhotometricInterpretation", "MONOCHROME2") or "MONOCHROME2").upper()
    if photometric not in SUPPORTED_PHOTOMETRICS:
        return []
    # Grayscale carries one sample; every colour form this viewer accepts is
    # normalised to three by _dicom_pixel_payload before it reaches the browser.
    expected_samples = 1 if photometric in GRAYSCALE_PHOTOMETRICS else 3
    if photometric == "PALETTE COLOR":
        expected_samples = 1
    if samples != expected_samples:
        return []
    series_number = str(getattr(ds, "SeriesNumber", "") or "")
    description = str(getattr(ds, "SeriesDescription", "") or "").strip() or "DICOM series"
    series_uid = str(getattr(ds, "SeriesInstanceUID", "") or "").strip()
    if not series_uid:
        series_uid = f"fallback:{path.parent}:{series_number}:{description}"
    window_center_value = getattr(ds, "WindowCenter", None)
    window_width_value = getattr(ds, "WindowWidth", None)
    window_center = _dicom_number(window_center_value, math.nan)
    window_width = _dicom_number(window_width_value, math.nan)

    # Date only, never StudyTime: the study group is keyed on this string, and
    # a series whose header is missing the time would otherwise land in a
    # second group of its own alongside the rest of the same study.
    study_date = str(getattr(ds, "StudyDate", "") or "").strip()
    if study_date and len(study_date) == 8 and study_date.isdigit():
        study_date = f"{study_date[:4]}-{study_date[4:6]}-{study_date[6:]}"
    study_desc = str(getattr(ds, "StudyDescription", "") or "").strip()

    patient_id = str(getattr(ds, "PatientID", "") or "").strip()
    patient_name = str(getattr(ds, "PatientName", "") or "").strip()

    patient_birth_date = str(getattr(ds, "PatientBirthDate", "") or "").strip()
    if patient_birth_date and len(patient_birth_date) == 8 and patient_birth_date.isdigit():
        patient_birth_date = f"{patient_birth_date[:4]}-{patient_birth_date[4:6]}-{patient_birth_date[6:]}"
    patient_sex = str(getattr(ds, "PatientSex", "") or "").strip().upper()
    patient_age = str(getattr(ds, "PatientAge", "") or "").strip().upper()

    pixel_spacing = _dicom_numbers(getattr(ds, "PixelSpacing", None), 2)
    orientation = _dicom_numbers(getattr(ds, "ImageOrientationPatient", None), 6)
    position = _dicom_numbers(getattr(ds, "ImagePositionPatient", None), 3)
    instance_number = _dicom_number(getattr(ds, "InstanceNumber", None), math.inf)

    slope = _dicom_number(getattr(ds, "RescaleSlope", None), 1.0)
    intercept = _dicom_number(getattr(ds, "RescaleIntercept", None), 0.0)

    # Enhanced multi-frame keeps geometry *and* the modality/VOI transforms in
    # the functional groups. Expanding one header per frame — each carrying its
    # own values — lets ordering, manifest building and crosslinking treat
    # frames exactly like the slices of a classic series, and keeps a file
    # whose frames genuinely differ from being flattened into a false average.
    modality_code = str(getattr(ds, "Modality", "UNKNOWN") or "UNKNOWN").upper()
    acquisition = _acquisition_parameters(ds, modality_code)

    blank = FrameAttributes(None, None, None, None, None, None, None)
    per_frame: list[FrameAttributes] = [blank] * frames
    if frames > 1:
        per_frame = _multiframe_attributes(ds, frames)

    def build(frame_index: int) -> DicomHeader:
        frame = per_frame[frame_index]
        return DicomHeader(
            path=path,
            series_uid=series_uid,
            study_uid=str(getattr(ds, "StudyInstanceUID", "") or ""),
            frame_uid=str(getattr(ds, "FrameOfReferenceUID", "") or ""),
            series_number=series_number,
            description=description,
            modality=modality_code,
            rows=rows,
            columns=columns,
            samples_per_pixel=samples,
            photometric=photometric,
            bits_allocated=int(getattr(ds, "BitsAllocated", 16) or 16),
            bits_stored=int(getattr(ds, "BitsStored", 16) or 16),
            high_bit=int(getattr(ds, "HighBit", 15) or 15),
            pixel_representation=int(getattr(ds, "PixelRepresentation", 0) or 0),
            pixel_spacing=frame.pixel_spacing or pixel_spacing,
            orientation=frame.orientation or orientation,
            position=frame.position or position,
            # Frames of one file share an InstanceNumber; frame_index breaks
            # the tie without disturbing the order between separate files.
            instance_number=instance_number,
            sop_uid=str(getattr(ds, "SOPInstanceUID", "") or ""),
            rescale_slope=frame.rescale_slope if frame.rescale_slope is not None else slope,
            rescale_intercept=(
                frame.rescale_intercept if frame.rescale_intercept is not None else intercept
            ),
            window_center=(
                frame.window_center if frame.window_center is not None
                else (window_center if math.isfinite(window_center) else None)
            ),
            window_width=(
                frame.window_width if frame.window_width is not None
                else (window_width if math.isfinite(window_width) and window_width > 0 else None)
            ),
            study_date=study_date,
            study_desc=study_desc,
            patient_id=patient_id,
            patient_name=patient_name,
            patient_birth_date=patient_birth_date,
            patient_sex=patient_sex,
            patient_age=patient_age,
            number_of_frames=frames,
            acquisition=acquisition,
            frame_index=frame_index,
        )

    return [build(index) for index in range(frames)]


def _dicom_vectors_close(left: Optional[list[float]], right: Optional[list[float]]) -> bool:
    if left is None or right is None or len(left) != len(right):
        return False
    return all(abs(a - b) <= 1e-4 for a, b in zip(left, right))


def _ordered_dicom_headers(headers: list[DicomHeader]) -> list[DicomHeader]:
    # frame_index is the last key, never the first: without it the frames of
    # two multi-frame files interleave as A0, B0, A1, B1 instead of following
    # their own file.
    if not headers or not headers[0].orientation or any(item.position is None for item in headers):
        return sorted(headers, key=lambda item: (
            item.instance_number, str(item.path).casefold(), item.frame_index,
        ))
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
            item.frame_index,
        ),
    )


def _direct_dicom_manifest(headers: list[DicomHeader]) -> tuple[Optional[dict], bool, str]:
    first = headers[0]
    if first.photometric not in GRAYSCALE_PHOTOMETRICS:
        # Colour pixels carry no modality LUT and no reliable slice geometry;
        # reslicing them as a scalar volume would be meaningless.
        return None, False, (
            f"Ảnh màu DICOM ({first.photometric}): xem được 2D, "
            "không dựng MPR/3D và không đo theo đơn vị vật lý."
        )
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
            "instance_number": (
                int(item.instance_number)
                if math.isfinite(item.instance_number) and item.instance_number.is_integer()
                else item.instance_number
            ),
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
        # The exam's own name, as distinct from this sequence's. Without it the
        # patient timeline had nothing to show but the grouping key, which
        # already repeats the modality: "MR - MR sọ não có tiêm".
        "study_description": first.study_desc,
        "modality": "MR" if first.modality == "MRI" else first.modality,
        "series_number": first.series_number,
        "study_date": first.study_date,
        "patient_id": first.patient_id,
        "patient_name": first.patient_name,
        "patient_birth_date": first.patient_birth_date,
        "patient_sex": first.patient_sex,
        "patient_age": first.patient_age,
        "study_instance_uid": first.study_uid,
        "series_instance_uid": first.series_uid,
        "frame_of_reference_uid": first.frame_uid or first.study_uid or first.series_uid,
        "frame_of_reference_synthetic": not bool(first.frame_uid),
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


def _palette_lut_bits(ds: Any) -> int:
    """Bits per entry of the palette colour LUT.

    Third value of the Palette Color Lookup Table Descriptor. Falls back to 16
    because that is what an out-of-spec descriptor almost always turns out to
    be, and over-estimating only darkens rather than saturating to white.
    """
    for name in (
        "RedPaletteColorLookupTableDescriptor",
        "GreenPaletteColorLookupTableDescriptor",
        "BluePaletteColorLookupTableDescriptor",
    ):
        descriptor = getattr(ds, name, None)
        try:
            bits = int(descriptor[2])
        except (IndexError, TypeError, ValueError):
            continue
        if bits in {8, 16}:
            return bits
    return 16


def _dicom_color_payload(ds: Any, pixels: Any, photometric: str) -> tuple[bytes, dict[str, str]]:
    """Normalise any accepted colour form to interleaved 8-bit RGB.

    Colour DICOM (ultrasound, secondary capture, palette-coded overlays) has no
    meaningful window/level, so it is handed to the browser already in display
    space instead of going through the modality LUT path.
    """
    import numpy as np
    from pydicom.pixels import apply_color_lut

    # pydicom already hands back RGB for every YBR form it can decode, so
    # calling convert_color_space here would apply the transform a second time
    # and tint the whole image. Only palette indices still need expanding.
    sample_bits = int(getattr(ds, "BitsStored", 8) or 8)
    if photometric == "PALETTE COLOR":
        pixels = np.asarray(apply_color_lut(pixels, ds))
        # The LUT entries have their own depth, declared in the third value of
        # the descriptor. Scaling 16-bit entries by the *index* depth instead
        # saturates almost everything to white.
        sample_bits = _palette_lut_bits(ds)

    if pixels.ndim != 3 or pixels.shape[2] < 3:
        raise ValueError(
            f"Ảnh màu DICOM có hình dạng không dùng được: {getattr(pixels, 'shape', None)}."
        )
    pixels = pixels[:, :, :3]
    if pixels.dtype != np.uint8:
        top = float(2 ** max(1, sample_bits) - 1)
        pixels = np.clip(pixels.astype("float32") / top * 255.0, 0, 255).round().astype("uint8")
    pixels = np.ascontiguousarray(pixels)
    headers = {
        "X-DCom-Pixel-Type": "uint8",
        "X-DCom-Rows": str(pixels.shape[0]),
        "X-DCom-Columns": str(pixels.shape[1]),
        "X-DCom-Samples": "3",
        "X-DCom-Min": "0",
        "X-DCom-Max": "255",
        "X-DCom-Slope": "1.0",
        "X-DCom-Intercept": "0.0",
        "X-DCom-Window-Center": "127.5",
        "X-DCom-Window-Width": "255.0",
        "X-DCom-Photometric": "RGB",
    }
    return pixels.tobytes(order="C"), headers


def _dicom_pixel_payload(path: Path, frame: int = 0) -> tuple[bytes, dict[str, str]]:
    import numpy as np
    import pydicom
    from dcom_pipeline import _is_dicom_dataset_valid_for_decode

    try:
        ds = pydicom.dcmread(str(path), force=True)
        valid, reason = _is_dicom_dataset_valid_for_decode(ds)
        if not valid:
            raise ValueError(f"Dữ liệu pixel không toàn vẹn: {reason}")
        pixels = np.asarray(ds.pixel_array)
    except Exception as exc:
        raise ValueError(f"Không giải mã được pixel DICOM: {path.name} ({exc})") from exc
    photometric = str(
        getattr(ds, "PhotometricInterpretation", "MONOCHROME2") or "MONOCHROME2"
    ).upper()
    frames = int(getattr(ds, "NumberOfFrames", 1) or 1)
    # Multi-frame pixel_array is (frames, rows, columns[, samples]). The catalog
    # expands such a file into one slice per frame, so the requested frame is
    # what the viewer asked for, not always the first one. A single-frame colour
    # image is also 3-D — shape[0] == frames keeps the two apart.
    if frames > 1 and pixels.ndim >= 3 and pixels.shape[0] == frames:
        if not 0 <= frame < frames:
            raise IndexError(f"Khung {frame} ngoài phạm vi {frames} khung.")
        pixels = pixels[frame]

    if photometric in COLOR_PHOTOMETRICS:
        return _dicom_color_payload(ds, pixels, photometric)

    if pixels.ndim != 2:
        raise ValueError("Viewer trực tiếp hiện chỉ hỗ trợ DICOM xám 2D (hoặc multi-frame xám).")

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
    if frames > 1:
        # Enhanced CT/MR states the modality LUT in
        # PixelValueTransformationSequence, not at the top level. Reporting the
        # 1/0 default there hands the viewer stored values while it believes it
        # is windowing Hounsfield units.
        attributes = _frame_attributes(
            _sequence_item(ds, "SharedFunctionalGroupsSequence"),
            _sequence_item_at(ds, "PerFrameFunctionalGroupsSequence", frame),
        )
        if attributes.rescale_slope is not None:
            slope = attributes.rescale_slope
        if attributes.rescale_intercept is not None:
            intercept = attributes.rescale_intercept
        if attributes.window_center is not None:
            center = attributes.window_center
        if attributes.window_width is not None:
            width = attributes.window_width
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
        "X-DCom-Samples": "1",
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


THUMBNAIL_BOX = (240, 240)


def _encode_thumbnail(image: Any) -> bytes:
    import io

    from PIL import Image

    image.thumbnail(THUMBNAIL_BOX, Image.Resampling.LANCZOS)
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", quality=92, subsampling=0)
    return buffer.getvalue()


def _dicom_thumbnail_image(path: Path, frame: int) -> Any:
    """Render one DICOM slice into a display-space PIL image.

    The viewer windows pixels itself in the browser, but a thumbnail has to
    arrive already in display space because an <img> cannot apply a modality
    LUT. Colour payloads are handed over untouched; grayscale ones go through
    the slice's own window/level, falling back to a percentile stretch when
    the file declares none.
    """
    import numpy as np
    from PIL import Image

    body, headers = _dicom_pixel_payload(path, frame)
    rows = int(headers["X-DCom-Rows"])
    columns = int(headers["X-DCom-Columns"])
    if int(headers.get("X-DCom-Samples", "1")) == 3:
        pixels = np.frombuffer(body, dtype=np.uint8).reshape((rows, columns, 3))
        return Image.fromarray(pixels, mode="RGB")

    pixels = np.frombuffer(
        body, dtype=np.dtype(headers.get("X-DCom-Pixel-Type", "uint16"))
    ).reshape((rows, columns))
    values = pixels.astype("float32") * float(headers.get("X-DCom-Slope", "1.0")) + float(
        headers.get("X-DCom-Intercept", "0.0")
    )
    center = float(headers.get("X-DCom-Window-Center", "nan"))
    width = float(headers.get("X-DCom-Window-Width", "nan"))
    if math.isfinite(center) and math.isfinite(width) and width > 0:
        low, high = center - width / 2.0, center + width / 2.0
    else:
        low, high = (float(bound) for bound in np.percentile(values, (0.5, 99.5)))
        if not math.isfinite(low) or not math.isfinite(high) or high <= low:
            low, high = float(np.min(values)), float(np.max(values))
        if high <= low:
            high = low + 1.0
    invert = headers.get("X-DCom-Photometric", "MONOCHROME2") == "MONOCHROME1"
    scaled = mpr_engine._to_uint8(values, low, high, invert)
    return Image.fromarray(scaled, mode="L").convert("RGB")


def _placeholder_thumbnail(kind: str) -> bytes:
    """A flat dark tile for a series that has no frame to preview.

    Video and text series carry no decodable image, so asking Pillow to open
    one raised and the strip logged a 500 per card. They still need a tile the
    same size as the others or the strip's rows jump.
    """
    from PIL import Image

    tint = {"video": (48, 30, 60), "text": (54, 46, 28), "pdf": (58, 34, 34)}.get(kind, (24, 28, 34))
    return _encode_thumbnail(Image.new("RGB", THUMBNAIL_BOX, tint))


def build_series_thumbnail(record: "SeriesRecord") -> bytes:
    """Encode a JPEG preview of the series' middle slice.

    Raises when the slice cannot be decoded; the caller decides what a failed
    preview should look like, so a transient decode error is never cached as
    the series' permanent thumbnail.
    """
    from PIL import Image

    middle = len(record.images) // 2
    path = record.images[middle]
    if record.source_type == "dicom":
        frame = record.frame_indices[middle] if record.frame_indices else 0
        return _encode_thumbnail(_dicom_thumbnail_image(path, frame))
    kind = record.resolved_media_type()
    if kind in {"video", "text", "pdf"}:
        return _placeholder_thumbnail(kind)
    with Image.open(path) as handle:
        return _encode_thumbnail(handle.convert("RGB"))


def validate_mpr_manifest(folder: Path, manifest: Optional[dict]) -> tuple[bool, str]:
    """Validate geometry/completeness before exposing MPR or 3D controls."""
    if not manifest:
        return False, "Series này chỉ có ảnh 2D, không có gói hình học MPR."
    if manifest.get("format") != mpr_engine.MANIFEST_FORMAT:
        return False, "Định dạng manifest MPR không được hỗ trợ."
    if int(manifest.get("version", 0) or 0) != mpr_engine.MANIFEST_VERSION:
        return False, "Phiên bản manifest MPR không tương thích."
    if manifest.get("series_type") == "JPG_GENERIC":
        if manifest.get("ordered_slices"):
            return False, (
                "Series JPG c\u00f3 geometry \u0111\u1ec3 \u0111\u1ed3ng b\u1ed9 kh\u00f4ng gian 2D, "
                "nh\u01b0ng kh\u00f4ng ph\u1ea3i g\u00f3i volume MPR/3D."
            )
        return False, "Series JPG 2D kh\u00f4ng c\u00f3 g\u00f3i volume MPR/3D."

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
    study_date: str = ""
    # TR/TE, slice thickness, kVp/mAs and the other technical fields a reader
    # confirms a sequence by. Read from DICOM, and carried into the JPG
    # manifest so a converted study keeps them too.
    acquisition: dict = field(default_factory=dict)
    # Parallel to `images`: which frame of that file each slice refers to.
    # Empty for series where every file holds exactly one frame.
    frame_indices: list[int] = field(default_factory=list)
    # JPEG preview of the middle slice, built on first request. Decoding a
    # slice is expensive and the strip re-requests it on every re-render.
    thumbnail_bytes: Optional[bytes] = None

    def resolved_media_type(self) -> str:
        """Which viewer this series opens in.

        Derived from the files the record holds, with one rule ahead of the
        file extension: a JPG that is a slice of an MR or CT study is a
        diagnostic image that happens to be stored as a picture. This app's own
        "Chuyển Dcom → JPG" pipeline produces exactly that, and those series
        must keep opening in the reading canvas — routing them to the photo
        editor would hand a radiologist crop and redact tools where the
        window/level and measurement tools belong.

        So the container decides only once nothing says the series is imaging:
        a recorded modality, or a pipeline manifest describing the series.
        """
        if self.source_type == "dicom":
            return "dicom"
        if self.modality in DIAGNOSTIC_MODALITIES:
            return "dicom"
        if (self.manifest or {}).get("series_type"):
            return "dicom"
        for image in self.images:
            kind = media_type_for_file(image)
            if kind == "photo" and is_document_folder(self.folder):
                return "doc"
            if kind:
                return kind
        return "photo"

    def public_dict(self) -> dict:
        m = self.manifest or {}
        data = {
            "id": self.series_id,
            "name": self.name,
            "sliceCount": len(self.images),
            "mprReady": self.mpr_ready,
            "mprReason": self.mpr_reason,
            "seriesType": m.get("series_type", ""),
            "description": m.get("series_description", self.name),
            "modality": self.modality,
            "sourceType": self.source_type,
            # The frontend routes on this. It is computed from the files on
            # disk, never from the wording of a description.
            "mediaType": self.resolved_media_type(),
            "studyGroup": self.study_group,
            "studyDate": self.study_date or m.get("study_date") or m.get("studyDate", ""),
            "studyDescription": self.study_label(),
            # The patient timeline shows one study/media group, while the
            # viewer's series selector still exposes every technical sequence.
            # DICOM series from one StudyInstanceUID therefore share this key.
            "timelineKey": self.timeline_key(),
        }
        acquisition = self.acquisition or m.get("acquisition") or {}
        if acquisition:
            data["acquisition"] = acquisition
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
                "frameOfReferenceUID": self.manifest.get("frame_of_reference_uid") or self.manifest.get("study_instance_uid") or self.series_id,
                "frameOfReferenceSynthetic": self.manifest.get(
                    "frame_of_reference_synthetic",
                    not bool(self.manifest.get("frame_of_reference_uid")),
                ),
            }
        return data

    def study_label(self) -> str:
        """The exam's own name, without the prefix its grouping key carries.

        `study_group` is assembled as "<ngày> - <modality> - <mô tả>" so the
        DICOM half and the converted-JPG half of one study agree on a key. The
        patient timeline shows that string to a reader, where the repeated
        modality read as "MR - MR sọ não có tiêm". Series scanned before the
        manifest carried `study_description` have only the group to recover it
        from, so the two known prefixes are peeled back off.
        """
        manifest = self.manifest or {}
        described = str(
            manifest.get("study_description") or manifest.get("studyDescription") or ""
        ).strip()
        if described:
            return described
        label = str(self.study_group or "").strip()
        if not label or label == "Không rõ ca chụp":
            return ""
        date = str(self.study_date or manifest.get("study_date") or "").strip()
        if date and label.startswith(date):
            label = label[len(date):].lstrip(" -")
        modality = str(self.modality or "").strip()
        if modality and label.upper().startswith(f"{modality.upper()} - "):
            label = label[len(modality):].lstrip(" -")
        return label.strip()

    def timeline_key(self) -> str:
        """Stable opaque identity for one patient-timeline row.

        Groups series by study group / folder and exam date so localizers, DWI,
        and post-processed reconstructions belong to the same clinical study row.
        """
        manifest = self.manifest or {}
        date = str(self.study_date or manifest.get("study_date") or "").strip()
        group = str(self.study_group or "").strip()
        cleaned_group = group
        if " - OT - " in group:
            cleaned_group = group.replace(" - OT - ", " - MR - ")
        if cleaned_group and cleaned_group != "Không rõ ca chụp":
            identity = f"group:{date}|{cleaned_group}"
        elif self.folder:
            identity = f"folder:{str(self.folder).casefold()}"
        else:
            study_uid = str(
                manifest.get("study_instance_uid")
                or manifest.get("studyInstanceUID")
                or manifest.get("study_uid")
                or ""
            ).strip()
            identity = f"uid:{study_uid}" if study_uid else f"date:{date}"
        raw = f"{identity}|{self.resolved_media_type()}"
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:20]


_DICOM_MEM_CACHE: dict[str, tuple[str, dict[str, SeriesRecord], int, int]] = {}


def _detached_records(records: dict[str, SeriesRecord]) -> dict[str, SeriesRecord]:
    """Hand out records whose manifest the caller is free to enrich.

    Enrichment writes the patient folder's name and ID into `manifest` in
    place, and it only fills fields that are still blank or redacted. Sharing
    that dict with the cache would bake the first scan's demographics into
    every later one, so a corrected patient name would never reach the reader
    while this process lives. The heavy fields stay shared: only the manifest
    is copied.
    """
    return {
        uid: (
            replace(rec, manifest=dict(rec.manifest))
            if isinstance(rec.manifest, dict)
            else rec
        )
        for uid, rec in records.items()
    }


def _dicom_fingerprint(paths: list[Path]) -> str:
    if not paths:
        return "0:0:0"
    count = len(paths)
    try:
        m0 = paths[0].stat().st_mtime_ns
        m_mid = paths[count // 2].stat().st_mtime_ns
        m_last = paths[-1].stat().st_mtime_ns
        return f"{count}:{m0}:{m_mid}:{m_last}"
    except OSError:
        return str(count)


def _to_portable_rel_path(p: Path, root: Optional[Path]) -> str:
    if root is not None:
        try:
            return str(p.resolve().relative_to(root.resolve()))
        except Exception:
            try:
                return str(p.relative_to(root))
            except Exception:
                pass
    return str(p)


def _from_portable_rel_path(raw: str, root: Optional[Path], is_dir: bool = False) -> Path:
    p = Path(raw)
    if root is None:
        return p
    if not p.is_absolute():
        return root / p
    # If absolute path still exists on disk, use it directly
    if p.exists():
        return p
    # If folder was moved/renamed, attempt to locate the matching relative subpath under root
    parts = p.parts
    for i in range(1, len(parts)):
        cand = root.joinpath(*parts[i:])
        if cand.is_dir() if is_dir else cand.is_file():
            return cand
    return p


def _serialize_series_record(rec: SeriesRecord, root: Optional[Path] = None) -> dict:
    return {
        "series_id": rec.series_id,
        "name": rec.name,
        "folder": _to_portable_rel_path(rec.folder, root),
        "images": [_to_portable_rel_path(img, root) for img in rec.images],
        "frame_indices": rec.frame_indices,
        "manifest": rec.manifest,
        "mpr_ready": rec.mpr_ready,
        "mpr_reason": rec.mpr_reason,
        "modality": rec.modality,
        "source_type": rec.source_type,
        "pixel_data": rec.pixel_data,
        "study_group": rec.study_group,
        "study_date": rec.study_date,
        "acquisition": rec.acquisition,
    }


def _deserialize_series_record(item: dict, root: Optional[Path] = None) -> SeriesRecord:
    return SeriesRecord(
        series_id=item["series_id"],
        name=item["name"],
        folder=_from_portable_rel_path(item["folder"], root, is_dir=True),
        images=[_from_portable_rel_path(x, root, is_dir=False) for x in item["images"]],
        frame_indices=item.get("frame_indices") or [],
        manifest=item.get("manifest"),
        mpr_ready=bool(item.get("mpr_ready")),
        mpr_reason=str(item.get("mpr_reason") or ""),
        modality=str(item.get("modality") or "UNKNOWN"),
        source_type=str(item.get("source_type") or "dicom"),
        pixel_data=item.get("pixel_data"),
        study_group=str(item.get("study_group") or ""),
        study_date=str(item.get("study_date") or ""),
        acquisition=item.get("acquisition") or {},
    )



def _get_dicom_cache_path(root: Path) -> Path:
    return root / ".dicom_cache.json"


class ArchiveCatalog:
    def __init__(self) -> None:
        self._lock = threading.RLock()
        self.root: Optional[Path] = None
        self._series: dict[str, SeriesRecord] = {}
        # Identity of the patient this archive belongs to, taken from
        # `patient-index.json`. Empty until an archive with a manifest is
        # opened — the viewer prints "—" rather than guessing from a path.
        self._patient: dict = {}

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

    def _media_records(
        self,
        root: Path,
        *,
        should_stop: Optional[Callable[[], bool]] = None,
    ) -> dict[str, SeriesRecord]:
        """Every video or text series under `root`, keyed by series id.

        Used by the DICOM branch, which would otherwise return the scan alone
        and hide the operative video and report filed next to it.
        """
        found: dict[str, SeriesRecord] = {}
        # `JPG` holds slices converted from the DICOM beside it, which the DICOM
        # series already represents. Everything else — intra-operative photos,
        # scanned records — is its own material and must still be listed.
        blocked = {"DICOM", "RAW_JPG", "JPG"}
        for current, dirnames, _filenames in os.walk(root):
            if should_stop and should_stop():
                break
            dirnames[:] = [name for name in dirnames if name.upper() not in blocked]
            dirnames.sort(key=_natural_key)
            folder = Path(current)
            record = self._media_record(folder, root)
            if record is not None:
                found[record.series_id] = record
                for extra in self._companion_media_records(
                    folder, root, skip={record.source_type},
                ):
                    found[extra.series_id] = extra
        return found

    def _media_record(self, folder: Path, root: Path) -> Optional[SeriesRecord]:
        """A video or text series for a folder that holds no displayable images.

        Runs only where the image scan came up empty, so a DICOM or JPG series
        is never reinterpreted as media. Videos and operative reports sit
        beside a study rather than inside it, which is exactly the shape this
        catches — and which the old scanner dropped on the floor entirely.
        """
        for extensions, source in MEDIA_KINDS:
            files = self._playable_files(folder, extensions)
            if files:
                return self._build_media_record(folder, root, files, source)
        return None

    def _companion_media_records(
        self,
        folder: Path,
        root: Path,
        *,
        skip: set[str],
    ) -> list[SeriesRecord]:
        """The other kinds of material filed in a folder that already lists one.

        A `benh_an` folder usually holds the scanned GPB picture and the typed
        MRI report side by side, and a study folder can hold the operative
        video. Only the first kind found was ever listed, so the report sat on
        disk with nothing on the timeline pointing at it.
        """
        found: list[SeriesRecord] = []
        for extensions, source in MEDIA_KINDS:
            # Photographs are what the image scan already produced; listing
            # them again here would double every folder of intra-op pictures.
            if source == "image" or source in skip:
                continue
            files = self._playable_files(folder, extensions)
            if files:
                found.append(self._build_media_record(folder, root, files, source, kinded_id=True))
        return found

    def _build_media_record(
        self,
        folder: Path,
        root: Path,
        files: list[Path],
        source: str,
        *,
        kinded_id: bool = False,
    ) -> SeriesRecord:
        """One media series for `folder`.

        The primary record keeps the plain folder digest as its id, because
        saved annotations are filed under it. A companion has to be told apart
        from the primary living in the same folder, so its kind goes into the
        hash.
        """
        key = f"{folder}\x00{source}" if kinded_id else str(folder)
        digest = hashlib.sha256(key.casefold().encode("utf-8")).hexdigest()[:20]
        study_date, folder_modality, study_desc = _study_from_folder_path(folder)
        relative_name = str(folder.relative_to(root)) if folder != root else folder.name
        return SeriesRecord(
            series_id=digest,
            name=relative_name,
            folder=folder,
            images=files,
            manifest={"series_description": folder.name},
            mpr_ready=False,
            mpr_reason="Series video, PDF hoặc văn bản, không dựng MPR.",
            modality=folder_modality or "UNKNOWN",
            source_type=source,
            study_group=study_desc or folder.name,
            study_date=study_date,
        )

    @staticmethod
    def _playable_files(folder: Path, extensions: set[str]) -> list[Path]:
        """Non-image files in `folder` the viewer can open, naturally sorted.

        Kept apart from `_image_files` so the DICOM and JPG paths are untouched:
        a folder is only ever read as video or as text once the image scan has
        already come up empty.
        """
        try:
            return sorted(
                (
                    path for path in folder.iterdir()
                    if path.is_file()
                    and path.suffix.casefold() in extensions
                    and path.name.casefold() not in APP_METADATA_NAMES
                ),
                key=lambda path: _natural_key(path.name),
            )
        except OSError:
            return []

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
    def _jpg_geometry_from_dicom_manifest(
        folder: Path,
        manifest: dict,
    ) -> Optional[tuple[dict, list[Path]]]:
        """Map a direct-DICOM geometry manifest onto existing converted JPGs.

        Older JPG exports retained SeriesInstanceUID but not per-slice geometry.
        When their sibling DICOM archive is still present, this provides an
        in-memory compatibility migration.  Every DICOM slice must map to one
        existing JPG; otherwise the method fails closed instead of attaching
        incomplete or guessed coordinates.
        """
        required = (
            "rows", "columns", "pixel_spacing", "slice_spacing",
            "image_orientation_patient", "ordered_slices",
        )
        if not all(key in manifest for key in required):
            return None
        available = {
            path.name.casefold(): path
            for path in folder.iterdir()
            if path.is_file() and path.suffix.casefold() in {".jpg", ".jpeg"}
        }
        ordered: list[dict] = []
        images: list[Path] = []
        used: set[str] = set()
        for item in manifest.get("ordered_slices") or []:
            raw_instance = item.get("instance_number")
            try:
                numeric_instance = float(raw_instance)
            except (TypeError, ValueError):
                numeric_instance = math.nan
            instance = (
                str(int(numeric_instance))
                if math.isfinite(numeric_instance) and numeric_instance.is_integer()
                else str(raw_instance or "")
            )
            if not instance:
                return None
            base = (
                f"IM_{int(instance):04d}"
                if instance.isdigit()
                else f"IM_{dcom_pipeline._safe_name(instance)}"
            )
            name = f"{base}.jpg"
            key = name.casefold()
            image = available.get(key)
            if image is None or key in used:
                return None
            used.add(key)
            images.append(image)
            ordered.append({
                "file": image.name,
                "position": item.get("position"),
                "distance": item.get("distance"),
                "sop_instance_uid": item.get("sop_instance_uid", ""),
            })
        if len(images) < 2 or used != set(available):
            return None
        geometry = {
            "frame_of_reference_uid": manifest.get("frame_of_reference_uid"),
            "frame_of_reference_synthetic": manifest.get(
                "frame_of_reference_synthetic", False,
            ),
            "rows": manifest["rows"],
            "columns": manifest["columns"],
            "slice_count": len(images),
            "pixel_spacing": manifest["pixel_spacing"],
            "slice_spacing": manifest["slice_spacing"],
            "image_orientation_patient": manifest["image_orientation_patient"],
            "ordered_slices": ordered,
        }
        return geometry, images

    def _restore_legacy_jpg_geometry(
        self,
        records: dict[str, SeriesRecord],
        root: Path,
        *,
        log: Optional[Callable[[str], None]] = None,
        should_stop: Optional[Callable[[], bool]] = None,
    ) -> int:
        missing = [
            record for record in records.values()
            if (record.manifest or {}).get("series_type") == "JPG_GENERIC"
            and not (record.manifest or {}).get("ordered_slices")
            and (record.manifest or {}).get("series_instance_uid")
        ]
        if not missing:
            return 0
        candidates = []
        for candidate in (root / "DICOM", root.parent / "DICOM"):
            try:
                resolved = candidate.resolve()
            except OSError:
                continue
            if resolved.is_dir() and resolved not in candidates:
                candidates.append(resolved)
        if not candidates:
            return 0

        target_uids = {
            str(record.manifest.get("series_instance_uid")) for record in missing
        }
        direct_by_uid: dict[str, dict] = {}
        for dicom_root in candidates:
            if should_stop and should_stop():
                break
            direct_records, _unsupported, _total = self._dicom_records(
                dicom_root,
                should_stop=should_stop,
            )
            for direct in direct_records.values():
                uid = str((direct.manifest or {}).get("series_instance_uid") or "")
                if uid in target_uids and direct.manifest:
                    direct_by_uid[uid] = direct.manifest

        restored = 0
        for record in missing:
            uid = str(record.manifest.get("series_instance_uid") or "")
            direct_manifest = direct_by_uid.get(uid)
            if not direct_manifest:
                continue
            mapped = self._jpg_geometry_from_dicom_manifest(
                record.folder,
                direct_manifest,
            )
            if not mapped:
                continue
            geometry, images = mapped
            record.manifest = {**record.manifest, **geometry}
            record.mpr_ready, record.mpr_reason = validate_mpr_manifest(
                record.folder, record.manifest,
            )
            record.images = images
            restored += 1
        if restored and log:
            log(
                f"Đã khôi phục geometry DICOM cho {restored} series JPG 2D cũ; "
                "crosslink dùng tọa độ bệnh nhân thật."
            )
        return restored

    @staticmethod
    def _dicom_records(
        root: Path,
        *,
        log: Optional[Callable[[str], None]] = None,
        should_stop: Optional[Callable[[], bool]] = None,
    ) -> tuple[dict[str, SeriesRecord], int, int]:
        paths = discover_dicom_files(root)
        if not paths:
            return {}, 0, 0

        fp = _dicom_fingerprint(paths)
        root_key = str(root.resolve()).casefold()

        # 1. In-memory session cache
        if root_key in _DICOM_MEM_CACHE:
            cached_fp, cached_recs, cached_unsupp, cached_total = _DICOM_MEM_CACHE[root_key]
            if cached_fp == fp:
                return _detached_records(cached_recs), cached_unsupp, cached_total

        # 2. On-disk metadata cache
        cache_path = _get_dicom_cache_path(root)
        if cache_path.is_file():
            try:
                data = json.loads(cache_path.read_text(encoding="utf-8"))
                if data.get("fingerprint") == fp and "records" in data:
                    records = {
                        uid: _deserialize_series_record(item, root)
                        for uid, item in data["records"].items()
                    }
                    # Validate that the cached images actually exist on disk!
                    has_valid_images = True
                    checked_count = 0
                    for rec in records.values():
                        for img in rec.images:
                            checked_count += 1
                            if not img.is_file():
                                has_valid_images = False
                                break
                            if checked_count >= 5:
                                break
                        if not has_valid_images:
                            break
                    if has_valid_images:
                        unsupported = int(data.get("unsupported", 0))
                        total = int(data.get("total", len(paths)))
                        _DICOM_MEM_CACHE[root_key] = (fp, records, unsupported, total)
                        # If cache had old non-relative paths, upgrade to portable relative format
                        try:
                            sample_raw = next(iter(data["records"].values()))["images"][0]
                            if Path(sample_raw).is_absolute():
                                cache_payload = {
                                    "fingerprint": fp,
                                    "unsupported": unsupported,
                                    "total": total,
                                    "records": {uid: _serialize_series_record(rec, root) for uid, rec in records.items()},
                                }
                                cache_path.write_text(json.dumps(cache_payload, ensure_ascii=False), encoding="utf-8")
                        except Exception:
                            pass
                        return _detached_records(records), unsupported, total
                    else:
                        # Stale cache with dead file paths! Invalidate and remove so it gets cleanly regenerated.
                        try:
                            cache_path.unlink(missing_ok=True)
                        except OSError:
                            pass
            except Exception:
                pass

        groups: dict[str, list[DicomHeader]] = {}
        unsupported = 0

        # Big studies are parsed across cores, small ones stay on this thread
        # because the pool would cost more than it saves. Either way the
        # headers arrive as a lazy stream, so the single loop below keeps
        # cancellation and progress reporting working in both cases.
        executor = None
        if len(paths) > 16:
            import concurrent.futures
            max_workers = min(8, max(2, os.cpu_count() or 4))
            executor = concurrent.futures.ThreadPoolExecutor(max_workers=max_workers)
            header_stream = executor.map(_read_dicom_header, paths)
        else:
            header_stream = (_read_dicom_header(path) for path in paths)

        try:
            for index, headers in enumerate(header_stream, start=1):
                if should_stop and should_stop():
                    return {}, unsupported, len(paths)
                if log and (index == 1 or index % 100 == 0):
                    log(f"Đang đọc metadata DICOM: {index}/{len(paths)} file…")
                # One entry per frame: a multi-frame file contributes several.
                if headers:
                    groups.setdefault(headers[0].series_uid, []).extend(headers)
                else:
                    unsupported += 1
        finally:
            if executor is not None:
                # Drop whatever is still queued instead of waiting for the
                # whole study when the scan was cancelled.
                executor.shutdown(wait=False, cancel_futures=True)

        records: dict[str, SeriesRecord] = {}
        for uid, headers in groups.items():
            # Frames of an enhanced file are already ordinary headers by now,
            # so one series is built the same way whatever the file layout is.
            headers_ordered = _ordered_dicom_headers(headers)
            manifest, ready, reason = _direct_dicom_manifest(headers_ordered)
            first = headers_ordered[0]
            multiframe = any(item.number_of_frames > 1 for item in headers_ordered)
            # Only claim "no per-frame position" when that is actually what
            # happened. Colour pixels or invalid geometry produce their own
            # reason, and overwriting it hides the real cause.
            if (
                multiframe
                and manifest is None
                and first.photometric in GRAYSCALE_PHOTOMETRICS
                and all(item.position is None for item in headers_ordered)
            ):
                reason = (
                    f"DICOM multi-frame ({first.number_of_frames} khung): xem được "
                    "từng khung nhưng thiếu vị trí 3D theo khung "
                    "(PerFrameFunctionalGroupsSequence) nên không dựng được MPR/3D."
                )
            digest = hashlib.sha256(f"dicom:{root}:{uid}".casefold().encode("utf-8")).hexdigest()[:20]
            common = Path(os.path.commonpath([str(item.path.parent) for item in headers_ordered]))
            modality = "MR" if first.modality == "MRI" else first.modality

            # A header can be missing StudyDate or StudyDescription — key images
            # and secondary captures often are. The enclosing study folder still
            # names both, so the series stays with the rest of its study.
            folder_date, folder_modality, folder_desc = _study_from_folder_path(common)
            study_date = first.study_date or folder_date
            study_desc = first.study_desc or folder_desc
            study_group = _study_group_label(
                study_date,
                modality if modality in {"CT", "MR"} else (first.modality or folder_modality),
                study_desc,
            )

            records[digest] = SeriesRecord(
                series_id=digest,
                name=f"Series {first.series_number or '?'} - {first.description}",
                folder=common,
                images=[item.path for item in headers_ordered],
                frame_indices=(
                    [item.frame_index for item in headers_ordered] if multiframe else []
                ),
                manifest=manifest,
                mpr_ready=ready,
                mpr_reason=reason,
                # Any modality DICOM actually names is kept. Collapsing CR, DX,
                # US, XA, PT, NM and MG into "UNKNOWN" lost the label on every
                # X-ray and ultrasound arriving on a disc from another hospital,
                # while the windowing rules key off "CT" alone and are unmoved
                # by a truthful label here.
                modality=modality if modality in DIAGNOSTIC_MODALITIES else "UNKNOWN",
                acquisition=first.acquisition,
                source_type="dicom",
                study_group=study_group,
                study_date=study_date,
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
                    "numberOfFrames": first.number_of_frames,
                },
            )

        if log and unsupported:
            log(
                f"Bỏ qua {unsupported} file nghi DICOM chưa hỗ trợ "
                "(ảnh màu, metadata thiếu hoặc file hỏng)."
            )

        # Cache valid results
        _DICOM_MEM_CACHE[root_key] = (fp, records, unsupported, len(paths))
        try:
            cache_payload = {
                "fingerprint": fp,
                "unsupported": unsupported,
                "total": len(paths),
                "records": {uid: _serialize_series_record(rec, root) for uid, rec in records.items()},
            }
            cache_path.write_text(json.dumps(cache_payload, ensure_ascii=False), encoding="utf-8")
        except OSError:
            pass

        return _detached_records(records), unsupported, len(paths)

    @staticmethod
    def _provenance_sources(start: Path) -> tuple[Optional[dict], Optional[dict]]:
        """The nearest patient-index.json and .direct-download.json at or above `start`.

        Both are looked up by walking upwards: the viewer is often pointed at a
        single study's JPG folder, while the manifest and the direct-download
        marker live on the patient folder several levels above it.
        """
        patient_manifest = None
        for folder in (start, *start.parents):
            found = dcom_pipeline._read_patient_manifest(folder)
            if found:
                patient_manifest = found
                break
        direct_meta = None
        for folder in (start, *start.parents):
            marker = folder / DIRECT_DOWNLOAD_META_NAME
            if marker.is_file():
                try:
                    direct_meta = json.loads(marker.read_text(encoding="utf-8"))
                    break
                except Exception:
                    pass
        return patient_manifest, direct_meta

    @staticmethod
    def _enrich_record(
        rec: SeriesRecord,
        patient_manifest: Optional[dict],
        direct_meta: Optional[dict],
    ) -> None:
        """Fill the series manifest with what only the archive on disk knows.

        The DICOM headers a PACS hands out are frequently redacted, and JPG
        folders carry no demographics at all, so the patient folder's manifest
        is the authority for name/ID and for where the study was downloaded
        from. Nothing already present in the record is overwritten.
        """
        if not isinstance(rec.manifest, dict):
            rec.manifest = {}
        manifest = rec.manifest
        if patient_manifest:
            m_name = patient_manifest.get("patientName") or ""
            m_id = patient_manifest.get("patientId") or ""
            m_dob = patient_manifest.get("patientBirthDate") or ""
            m_sex = patient_manifest.get("patientSex") or ""
            h_key = patient_manifest.get("hospitalKey") or ""
            h_name = patient_manifest.get("hospitalName") or ""
            if dcom_pipeline._is_redacted_patient_value(manifest.get("patient_name")) and not dcom_pipeline._is_redacted_patient_value(m_name):
                manifest["patient_name"] = m_name
                manifest["patientName"] = m_name
            if dcom_pipeline._is_redacted_patient_value(manifest.get("patient_id")) and not dcom_pipeline._is_redacted_patient_value(m_id):
                manifest["patient_id"] = m_id
                manifest["patientId"] = m_id
            if not manifest.get("patient_birth_date") and m_dob:
                manifest["patient_birth_date"] = m_dob
                manifest["patientBirthDate"] = m_dob
            if not manifest.get("patient_sex") and m_sex:
                manifest["patient_sex"] = m_sex
                manifest["patientSex"] = m_sex
            if h_key and not manifest.get("hospitalKey"):
                manifest["hospitalKey"] = h_key
            if h_name and not manifest.get("hospitalName"):
                manifest["hospitalName"] = h_name
            if patient_manifest.get("directUrl"):
                manifest.setdefault("downloadUrl", patient_manifest["directUrl"])
                manifest.setdefault("viewerUrl", patient_manifest["directUrl"])
            studies = patient_manifest.get("studies")
            if isinstance(studies, dict):
                study_uid = manifest.get("study_instance_uid") or manifest.get("studyUid")
                study_data = studies.get(study_uid) if study_uid else None
                # A single-study patient folder is unambiguous even when the
                # series carries no StudyInstanceUID (converted JPGs never do).
                if not study_data and len(studies) == 1:
                    study_data = next(iter(studies.values()))
                if isinstance(study_data, dict):
                    s_url = study_data.get("downloadUrl") or study_data.get("viewerUrl")
                    if s_url:
                        manifest.setdefault("downloadUrl", s_url)
                        manifest.setdefault("viewerUrl", s_url)
                    for key in ("patientCode", "accessionNumber", "hospitalName"):
                        if study_data.get(key):
                            manifest.setdefault(key, study_data[key])
        if isinstance(direct_meta, dict):
            d_url = direct_meta.get("url") or direct_meta.get("downloadUrl")
            if d_url:
                manifest.setdefault("downloadUrl", d_url)
                manifest.setdefault("viewerUrl", d_url)

    def _open_file(
        self,
        file_path: Path,
        *,
        log: Optional[Callable[[str], None]] = None,
    ) -> dict:
        parent = file_path.parent
        patient_manifest, direct_meta = self._provenance_sources(parent)

        def _enrich_single(rec: SeriesRecord) -> None:
            self._enrich_record(rec, patient_manifest, direct_meta)

        headers = _read_dicom_header(file_path)
        if headers:
            headers_ordered = _ordered_dicom_headers(headers)
            manifest, ready, reason = _direct_dicom_manifest(headers_ordered)
            first = headers_ordered[0]
            digest = hashlib.sha256(str(file_path).casefold().encode("utf-8")).hexdigest()[:20]
            record = SeriesRecord(
                series_id=digest,
                name=first.description or file_path.name,
                folder=parent,
                images=[file_path] * len(headers_ordered),
                manifest=manifest,
                mpr_ready=ready,
                mpr_reason=reason,
                modality="MR" if first.modality == "MRI" else first.modality,
                source_type="dicom",
                study_group=first.study_desc or parent.name,
                study_date=first.study_date,
                frame_indices=[h.frame_index for h in headers_ordered],
            )
            _enrich_single(record)
            with self._lock:
                self.root = parent
                self._patient = self._patient_block(patient_manifest)
                self._series = {digest: record}
            if log:
                log(f"Đã mở file DICOM: {file_path.name} ({len(headers_ordered)} frame)")
            return self.snapshot()

        if file_path.suffix.casefold() in IMG_EXTENSIONS:
            folder = file_path.parent
            manifest = None
            try:
                manifest = mpr_engine.read_manifest(folder)
            except Exception:
                pass
            digest = hashlib.sha256(str(file_path).casefold().encode("utf-8")).hexdigest()[:20]
            modality = self._modality(folder, folder, manifest)
            study_date, folder_modality, study_desc = _study_from_folder_path(folder)
            manifest_date = str((manifest or {}).get("study_date") or "").strip()
            study_date = study_date or manifest_date
            record = SeriesRecord(
                series_id=digest,
                name=file_path.name,
                folder=folder,
                images=[file_path],
                manifest=manifest or {"series_description": file_path.stem},
                mpr_ready=False,
                mpr_reason="File ảnh đơn lẻ",
                modality=modality if modality in {"CT", "MR"} else (folder_modality or "UNKNOWN"),
                source_type="image",
                study_group=study_desc or folder.name,
                study_date=study_date,
            )
            _enrich_single(record)
            with self._lock:
                self.root = folder
                self._patient = self._patient_block(patient_manifest)
                self._series = {digest: record}
            if log:
                log(f"Đã mở file ảnh: {file_path.name}")
            return self.snapshot()

        kind = media_type_for_file(file_path)
        if kind in {"video", "text", "pdf"}:
            folder = file_path.parent
            digest = hashlib.sha256(str(file_path).casefold().encode("utf-8")).hexdigest()[:20]
            study_date, folder_modality, study_desc = _study_from_folder_path(folder)
            record = SeriesRecord(
                series_id=digest,
                name=file_path.name,
                folder=folder,
                images=[file_path],
                manifest={"series_description": file_path.stem},
                mpr_ready=False,
                mpr_reason="Series video, PDF hoặc văn bản, không dựng MPR.",
                modality=folder_modality or "UNKNOWN",
                source_type=kind,
                study_group=study_desc or folder.name,
                study_date=study_date,
            )
            with self._lock:
                self.root = folder
                self._patient = self._patient_block(patient_manifest)
                self._series = {digest: record}
            if log:
                label = {"video": "video", "pdf": "PDF"}.get(kind, "văn bản")
                log(f"Đã mở file {label}: {file_path.name}")
            return self.snapshot()

        raise ValueError(
            f"Không thể đọc file {file_path.name}. Ứng dụng hỗ trợ file DICOM "
            "(.dcm, .dicom, .ima), ảnh (JPG, PNG, WEBP, BMP), video (MP4, WEBM, "
            "AVI, MOV, MKV) và văn bản (TXT, JSON)."
        )

    def open(
        self,
        value: os.PathLike[str] | str,
        *,
        log: Optional[Callable[[str], None]] = None,
        should_stop: Optional[Callable[[], bool]] = None,
    ) -> dict:
        root = Path(value).expanduser().resolve(strict=True)
        if root.is_file():
            return self._open_file(root, log=log)
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
        patient_manifest, direct_meta = self._provenance_sources(root)

        def _enrich_manifest_records(recs: dict[str, SeriesRecord]) -> None:
            for rec in recs.values():
                self._enrich_record(rec, patient_manifest, direct_meta)

        dicom_records, unsupported_dicom, dicom_candidates = self._dicom_records(
            root, log=log, should_stop=should_stop,
        )
        if dicom_records:
            # A patient folder routinely holds the scan *and* the operative
            # video and report beside it. Returning here with only the DICOM
            # series would hide them, so the media folders are merged in.
            media_records = self._media_records(root, should_stop=should_stop)
            dicom_records.update(media_records)
            _enrich_manifest_records(dicom_records)
            if log:
                log(f"Đã nhận diện {len(dicom_records) - len(media_records)} series DICOM, mở trực tiếp không chuyển JPG.")
                if media_records:
                    log(f"Kèm theo {len(media_records)} series video hoặc văn bản.")
            with self._lock:
                self.root = root
                self._patient = self._patient_block(patient_manifest)
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
                # No images here, but the folder may still hold a surgical
                # video or an operative report worth listing.
                media_record = self._media_record(folder, root)
                if media_record is not None:
                    records[media_record.series_id] = media_record
                    for extra in self._companion_media_records(
                        folder, root, skip={media_record.source_type},
                    ):
                        records[extra.series_id] = extra
                continue
            digest = hashlib.sha256(str(folder).casefold().encode("utf-8")).hexdigest()[:20]
            ready, reason = validate_mpr_manifest(folder, manifest)
            relative_name = str(folder.relative_to(root)) if folder != root else folder.name

            modality = self._modality(folder, root, manifest)
            # Converted JPGs sit in a `JPG` folder beside the `DICOM` one they
            # came from, so both read the study off the same enclosing folder
            # and end up in one group instead of two headers for one study.
            study_date, folder_modality, study_desc = _study_from_folder_path(folder)
            manifest_date = str((manifest or {}).get("study_date") or "").strip()
            study_date = study_date or manifest_date
            study_group = ""
            if study_date or study_desc:
                study_group = _study_group_label(
                    study_date,
                    modality if modality in {"CT", "MR"} else folder_modality,
                    study_desc,
                )
            elif " - " in folder.name:
                parts = folder.name.rsplit(" - ", 1)
                study_group = parts[0] if re.fullmatch(r"[a-f0-9]+", parts[1]) else folder.name
            else:
                study_group = folder.name
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
                modality=modality,
                acquisition=(manifest or {}).get("acquisition") or {},
                study_group=study_group,
                study_date=study_date,
            )
            # The pictures are listed; the operative video or the typed report
            # filed in the same folder still has to be.
            for extra in self._companion_media_records(folder, root, skip=set()):
                records[extra.series_id] = extra

        if records:
            self._restore_legacy_jpg_geometry(
                records,
                root,
                log=log,
                should_stop=should_stop,
            )
            _enrich_manifest_records(records)
            if log:
                log(f"Đã quét {scanned} thư mục, tìm thấy {len(records)} series ảnh.")
            with self._lock:
                self.root = root
                self._patient = self._patient_block(patient_manifest)
                self._series = records
            return self.snapshot()

        if not records and dicom_candidates:
            raise ValueError(
                "Folder có file DICOM nhưng chưa có series ảnh xám một khung đọc được. "
                f"Đã bỏ qua {unsupported_dicom}/{dicom_candidates} file; "
                "hãy kiểm tra DICOM multi-frame, ảnh màu, file hỏng hoặc codec nén."
            )
        with self._lock:
            self.root = root
            self._patient = self._patient_block(patient_manifest)
            self._series = records
        return self.snapshot()

    @staticmethod
    def _patient_block(manifest: Optional[dict]) -> dict:
        """Patient identity for the viewer rail, straight from the manifest.

        Every field is either recorded or blank. Age is computed only when a
        birth date is actually on file — a viewer that shows an age it derived
        from nothing is the same failure as one that invents a sex.
        """
        if not isinstance(manifest, dict):
            return {}
        birth_digits = re.sub(r"\D", "", str(manifest.get("patientBirthDate") or ""))
        stored_birth_year = re.sub(r"\D", "", str(manifest.get("birthYear") or ""))
        birth_year = (
            birth_digits[:4]
            if len(birth_digits) >= 4
            else stored_birth_year if len(stored_birth_year) == 4 else ""
        )
        age = ""
        if len(birth_digits) == 8:
            try:
                born = datetime.date(
                    int(birth_digits[0:4]), int(birth_digits[4:6]), int(birth_digits[6:8]),
                )
                today = datetime.date.today()
                years = today.year - born.year - ((today.month, today.day) < (born.month, born.day))
                if 0 <= years < 150:
                    age = str(years)
            except ValueError:
                age = ""
        sex = str(manifest.get("patientSex") or "").strip().upper()
        raw_labels = manifest.get("timelineLabels")
        timeline_labels = {
            str(key): str(value).strip()
            for key, value in (raw_labels.items() if isinstance(raw_labels, dict) else [])
            if str(key).strip() and str(value).strip()
        }
        return {
            "patientId": str(manifest.get("patientId") or "").strip(),
            "patientName": str(manifest.get("patientName") or "").strip(),
            "birthDate": birth_digits,
            "birthYear": birth_year,
            "age": age,
            "gender": {"M": "Nam", "F": "Nữ"}.get(sex, "") if sex in ("M", "F") else str(manifest.get("gender") or "").strip(),
            "hospital": str(manifest.get("hospitalName") or manifest.get("hospital") or "").strip(),
            "hospitalKey": str(manifest.get("hospitalKey") or "").strip(),
            "phone": str(manifest.get("phone") or manifest.get("phoneNumber") or "").strip(),
            "address": str(manifest.get("address") or "").strip(),
            # Not a DICOM tag and not in the manifest schema: a local archive
            # has no RIS to read a clinical diagnosis from. Present so the UI
            # has one place to read it once a source exists.
            "diagnosis": str(manifest.get("diagnosis") or "").strip(),
            # User-authored display names for study-level timeline rows. These
            # never overwrite DICOM StudyDescription or a source manifest.
            "timelineLabels": timeline_labels,
        }

    def snapshot(self) -> dict:
        with self._lock:
            return {
                "root": str(self.root) if self.root else "",
                "patient": dict(self._patient),
                "series": [record.public_dict() for record in self._series.values()],
            }

    def clone(self) -> "ArchiveCatalog":
        """Copy the current catalog so one viewer tab owns a stable patient.

        Download jobs open their result in the shared catalog. Giving that same
        object to a tab would let the next download replace every series below
        the first patient. Records are copied as well as the maps because lazy
        thumbnails and manifests are mutable runtime state.
        """
        cloned = ArchiveCatalog()
        with self._lock:
            cloned.root = self.root
            cloned._patient = copy.deepcopy(self._patient)
            cloned._series = copy.deepcopy(self._series)
        return cloned

    def get(self, series_id: str) -> SeriesRecord:
        with self._lock:
            record = self._series.get(series_id)
        if not record:
            raise KeyError("Không tìm thấy series.")
        return record


@dataclass
class ViewerSession:
    session_id: str
    catalog: ArchiveCatalog
    folder: str = ""
    created_at: float = field(default_factory=time.time)
    last_accessed: float = field(default_factory=time.time)


class ViewerSessionRegistry:
    """Manages active viewer sessions for multi-tab / multi-patient viewing."""

    def __init__(self, default_catalog: ArchiveCatalog) -> None:
        self._default_catalog = default_catalog
        self._sessions: dict[str, ViewerSession] = {}
        self._lock = threading.RLock()

    def create_session(
        self,
        path: str,
        session_id: Optional[str] = None,
        *,
        on_opened: Optional[Callable[[str], None]] = None,
    ) -> ViewerSession:
        if not session_id:
            session_id = secrets.token_hex(8)
        catalog = ArchiveCatalog()
        if path:
            catalog.open(path)
            # Opening a record through a session is still opening it, so the
            # shared history and worklist have to hear about it.
            if on_opened:
                on_opened(str(Path(path).expanduser().resolve()))
        session = ViewerSession(
            session_id=session_id,
            catalog=catalog,
            folder=path,
        )
        with self._lock:
            self._sessions[session_id] = session
        return session

    def create_session_from_catalog(
        self,
        source: ArchiveCatalog,
        session_id: Optional[str] = None,
        *,
        folder: str = "",
    ) -> ViewerSession:
        """Pin an already-scanned catalog to a tab without scanning it again."""
        sid = session_id or secrets.token_hex(8)
        catalog = source.clone()
        resolved_folder = folder or (str(catalog.root) if catalog.root else "")
        session = ViewerSession(
            session_id=sid,
            catalog=catalog,
            folder=resolved_folder,
        )
        with self._lock:
            self._sessions[sid] = session
        return session

    def get_session(self, session_id: Optional[str]) -> Optional[ViewerSession]:
        if not session_id:
            return None
        with self._lock:
            session = self._sessions.get(session_id)
            if session:
                session.last_accessed = time.time()
            return session

    def get_catalog(self, session_id: Optional[str] = None) -> ArchiveCatalog:
        session = self.get_session(session_id)
        return session.catalog if session else self._default_catalog

    def close_session(self, session_id: str) -> None:
        with self._lock:
            self._sessions.pop(session_id, None)

    def list_sessions(self) -> list[dict]:
        with self._lock:
            return [
                {
                    "sessionId": s.session_id,
                    "folder": s.folder,
                    "createdAt": s.created_at,
                    "lastAccessed": s.last_accessed,
                    "seriesCount": len(s.catalog._series),
                    "root": str(s.catalog.root) if s.catalog.root else "",
                }
                for s in self._sessions.values()
            ]


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
    log_file_path: Optional[Path] = None

    def __post_init__(self) -> None:
        if self.log_file_path is None:
            app_data = Path(os.environ.get("LOCALAPPDATA") or Path.home())
            self.log_file_path = app_data / "DCom JPG PACS" / "app.log"
        try:
            self.log_file_path.parent.mkdir(parents=True, exist_ok=True)
        except Exception:
            pass

    def snapshot(self) -> dict:
        with self.lock:
            return {
                "status": self.status,
                "kind": self.kind,
                "message": self.message,
                "logs": list(self.logs),
                "result": self.result,
                "startedAt": self.started_at,
                "finishedAt": self.finished_at,
                "logFilePath": str(self.log_file_path) if self.log_file_path else "",
            }

    def log(self, message: str) -> None:
        text = str(message)
        with self.lock:
            self.logs.append(text)
            self.message = text
        if self.log_file_path:
            try:
                now_str = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                with open(self.log_file_path, "a", encoding="utf-8") as f:
                    f.write(f"[{now_str}] {text}\n")
            except Exception:
                pass

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

        if self.log_file_path:
            try:
                now_str = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                with open(self.log_file_path, "a", encoding="utf-8") as f:
                    f.write(f"\n==================== [ {now_str} ] START JOB: {kind} ====================\n")
            except Exception:
                pass

        def run() -> None:
            try:
                result = target()
                with self.lock:
                    self.result = result
                    result_status = (
                        result.get("status", "") if isinstance(result, dict)
                        else getattr(result, "status", "")
                    )
                    result_cancelled = (
                        bool(result.get("cancelled")) if isinstance(result, dict)
                        else bool(getattr(result, "cancelled", False))
                    )

                    def result_count(name: str, default: Any = 0) -> Any:
                        if isinstance(result, dict):
                            if name in result:
                                return result.get(name, default)
                            nested = result.get("download")
                            if isinstance(nested, dict):
                                return nested.get(name, default)
                            return default
                        return getattr(result, name, default)

                    if self.stop_event.is_set() or result_cancelled or result_status in {"cancelled", "stopped"}:
                        self.status = "stopped"
                        self.message = "Đã dừng theo yêu cầu."
                    elif result_status:
                        st = result_status
                        if st == "complete":
                            self.status = "complete"
                            self.message = "Hoàn tất đủ ảnh theo manifest."
                        elif st == "partial":
                            self.status = "partial"
                            dicom_cnt = result_count("dicom", 0)
                            exp_cnt = result_count("expected", "?")
                            self.message = f"Tải một phần (thiếu ảnh: {dicom_cnt}/{exp_cnt})."
                        elif st == "partial_unknown":
                            self.status = "partial_unknown"
                            dicom_cnt = result_count("dicom", 0)
                            self.message = f"Đã tải {dicom_cnt} ảnh (viewer không khai báo tổng số)."
                        elif st == "rendered_only":
                            self.status = "rendered_only"
                            self.message = "Chỉ bắt được ảnh render màn hình (không phải DICOM gốc)."
                        elif st == "failed":
                            self.status = "failed"
                            self.message = "Không tải được ảnh nào hợp lệ."
                        else:
                            self.status = "complete"
                            self.message = "Hoàn tất."
                    else:
                        self.status = "complete"
                        self.message = "Hoàn tất."
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


_STUDY_FOLDER_RE = re.compile(r"^(\d{4}-\d{2}-\d{2})\s*-\s*([^-]+?)\s*-\s*(.+)$")
_LEADING_DATE_RE = re.compile(r"^(\d{4}-\d{2}-\d{2}|\d{8})")

# A patient code as the pipeline writes it into a folder name: one word, and at
# least one digit in it. The digit is what tells a code apart from a one-word
# Vietnamese name. Matching on length alone read `TUAN - 30T - 2606033997 -
# 2026-08-03` as a patient coded TUAN whose name was "30T".
_PATIENT_CODE_RE = re.compile(r"^(?=[^\s]*\d)[A-Za-z0-9][A-Za-z0-9._-]*$")
# `14T`, `26 T`, `45` — an age written into the folder name, never a name.
_AGE_TOKEN_RE = re.compile(r"^\d{1,3}\s*[A-Za-z]{0,2}$")
# `patient_download_folder_name` writes these when the DICOM tag is missing.
# Their underscores are separators to the splitter in `_parse_patient_meta`,
# which turned `KHONG_RO_TEN` into a patient named "KHONG". They are collapsed
# to one token before the split, then blanked out of whatever field they reach.
# `?` cannot occur in a Windows path, so this token can never collide with
# real folder text; `_safe_name` strips it out of anything the pipeline writes.
_UNKNOWN_FOLDER_FIELD = "?UNKNOWN?"
_UNKNOWN_FOLDER_FIELD_RE = re.compile(r"KHONG[_\s-]RO[_\s-](?:ID|TEN|TUOI)", re.IGNORECASE)


def _blank_if_unknown(value: str) -> str:
    """A folder field the pipeline marked unknown reads back as blank."""
    text = str(value or "").strip()
    return "" if _UNKNOWN_FOLDER_FIELD in text else text


def _identity_code(value) -> str:
    """A patient code reduced to what identifies it, for local comparison only.

    Case and the punctuation an operator types into a folder name vary; the
    code itself does not. Never use this for display.
    """
    return re.sub(r"[^a-z0-9]+", "", str(value or "").casefold())


def _folder_identity(patient_id: str, patient_name: str) -> dict:
    """A patient identity read off a folder name, with nothing else guessed.

    Sex, birth year and hospital stay empty here: a folder name that happens to
    look like it carries them is not a DICOM tag, and those are the fields a
    clinician reads to confirm they opened the right chart.
    """
    return {
        "patientId": _blank_if_unknown(patient_id),
        "patientName": _blank_if_unknown(patient_name),
        "gender": "",
        "birthYear": "",
        "hospital": "",
        "hospitalKey": "",
    }


def _is_real_date(digits: str) -> bool:
    """Whether 8 digits are an actual calendar date.

    A bare `\\d{8}` match is not enough: a patient code like `2607063527`
    begins with `26070635`, which the viewer then displayed as a study taken on
    35/06/2607. Anything that is not a date a person could have been scanned on
    is rejected so the field stays empty instead of showing nonsense.
    """
    if len(digits) != 8 or not digits.isdigit():
        return False
    try:
        parsed = datetime.date(int(digits[0:4]), int(digits[4:6]), int(digits[6:8]))
    except ValueError:
        return False
    return 1900 <= parsed.year <= datetime.date.today().year + 1


def _study_from_folder_path(start: Path) -> tuple[str, str, str]:
    """Recover (date, modality, description) from an enclosing study folder.

    A study is stored as `<date> - <modality> - <description>`, and its DICOM
    and converted JPG halves sit side by side inside it. Reading the study off
    the path is what lets both halves land in the same group: the JPG copies
    carry no StudyDate header of their own, and the archive root for them is
    the `JPG` folder itself, so the walk deliberately continues past it.
    """
    date = ""
    folder = start
    while folder != folder.parent:
        match = _STUDY_FOLDER_RE.match(folder.name)
        if match:
            return match.group(1), match.group(2).strip().upper(), match.group(3).strip()
        if not date:
            leading = _LEADING_DATE_RE.match(folder.name)
            if leading and _is_real_date(re.sub(r"\D", "", leading.group(1))):
                date = leading.group(1)
        folder = folder.parent
    return date, "", ""


def _study_group_label(date: str, modality: str, description: str) -> str:
    """The one string both halves of a study must agree on to group together."""
    parts = [part for part in (date, modality, description) if part]
    return " - ".join(parts) if parts else "Không rõ ca chụp"


def _is_within(path: Path, root: Path) -> bool:
    """True when `path` sits at or below `root`. Both must already be resolved."""
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False


def _as_index(value: Any) -> int:
    """A non-negative index from an untrusted payload, 0 when it is not one."""
    try:
        index = int(value)
    except (TypeError, ValueError):
        return 0
    return index if index >= 0 else 0


def _snake_keys(payload: Any) -> dict:
    """
    A media payload with its camelCase keys renamed to the engines' snake_case.

    The web client writes `fontSize` and `fontColor`; `photo_engine` and
    `video_engine` are dataclasses with `font_size` and `color`. Expanding one
    into the other with `**` raised TypeError, which is why both the photo text
    tool and the video stamp failed on every single use while their unit tests —
    which built the dataclasses directly — stayed green.
    """
    if not isinstance(payload, dict):
        return {}
    renamed: dict = {}
    for key, value in payload.items():
        snake = _CAMEL_RE.sub(lambda m: f"_{m.group(0).lower()}", str(key))
        renamed[_MEDIA_KEY_ALIASES.get(snake, snake)] = value
    return renamed


_CAMEL_RE = re.compile(r"(?<!^)[A-Z]")

# Keys whose client name is not merely a case variant of the engine's.
_MEDIA_KEY_ALIASES = {
    "font_color": "color",
    "start_seconds": "start_s",
    "end_seconds": "end_s",
}


def _is_writable_dir(folder: Path) -> bool:
    """Whether a new folder can be created inside `folder`.

    Local import writes converted JPGs next to the DICOM they came from, which
    cannot work on read-only media — a burned disc, a mounted image, a share
    exported read-only. os.access reports directories as writable on Windows
    regardless, so this probes with a real create and removes it again.
    """
    probe = folder / f".dcom-write-probe-{os.getpid()}"
    try:
        # Never `parents=True`: on a missing path that would create the whole
        # chain and leave it behind, since only the leaf is removed below.
        probe.mkdir(exist_ok=False)
    except OSError:
        return False
    try:
        probe.rmdir()
    except OSError:
        pass
    return True


def _redirect_plan(
    pairs: list[tuple[Path, Path]],
    base: Path,
) -> tuple[list[tuple[Path, Path]], Path]:
    """Re-aim a side-by-side plan at `base`, keeping each study's own folder."""
    redirected = [
        (source, base / (source.parent.name if source.name.casefold() == "dicom" else source.name) / "JPG")
        for source, _ in pairs
    ]
    return redirected, base


def _local_import_plan(source: Path) -> tuple[list[tuple[Path, Path]], Path]:
    """Pair every DICOM folder under `source` with the JPG folder beside it.

    Converted output lands next to its own DICOM folder rather than in the
    download root, so a study keeps both halves together and re-opening the
    patient folder finds them. Returns those (dicom, jpg) pairs plus the
    folder the viewer should open once the conversion finishes.
    """
    if source.name.casefold() == "dicom":
        destination = source.parent / "JPG"
        return [(source, destination)], destination
    if (source / "DICOM").is_dir():
        destination = source / "JPG"
        return [(source / "DICOM", destination)], destination
    nested = sorted(item for item in source.glob("**/DICOM") if item.is_dir() and item != source)
    if nested:
        # A patient folder holding several studies: each study keeps its own
        # JPG sibling, so the viewer opens the patient folder as a whole.
        return [(folder, folder.parent / "JPG") for folder in nested], source
    destination = source / "JPG"
    return [(source, destination)], destination


def _format_file_size(size_bytes: int) -> str:
    if size_bytes <= 0:
        return "0 B"
    units = ["B", "KB", "MB", "GB", "TB"]
    idx = 0
    val = float(size_bytes)
    while val >= 1024.0 and idx < len(units) - 1:
        val /= 1024.0
        idx += 1
    if idx == 0:
        return f"{int(val)} B"
    return f"{val:.1f}".replace(".", ",") + f" {units[idx]}"


class WorklistScanner:
    """Discovers patient and study hierarchy for the clinical Worklist.

    Structure:
      Patient (patientId, patientName, gender, birthYear, hospital, totalSizeFormatted, mediaSummary)
        └── Studies (studyDate, studyName, modality, seriesCount, sliceCount, folder, status, mediaCounts, primaryMediaType)
    """

    def __init__(self, controller: "WebController"):
        self.controller = controller

    def _manifest_patient_meta(self, patient_dir: Path) -> Optional[dict]:
        """Patient identity straight from `patient-index.json`, when present.

        The manifest is what the download pipeline actually recorded from the
        DICOM tags, so it outranks anything guessed from a folder name. Reading
        it is also the only way to get sex and birth date right — a folder named
        `BN-9999` carries neither.
        """
        try:
            raw = (patient_dir / "patient-index.json").read_text(encoding="utf-8")
            data = json.loads(raw)
        except Exception:
            return None
        if not isinstance(data, dict) or not data.get("patientId"):
            return None
        # DICOM DA is YYYYMMDD; the worklist column only shows the year.
        birth = re.sub(r"\D", "", str(data.get("patientBirthDate") or ""))
        stored_birth_year = re.sub(r"\D", "", str(data.get("birthYear") or ""))
        sex = str(data.get("patientSex") or "").strip().upper()
        return {
            "patientId": str(data.get("patientId") or "").strip(),
            "patientName": str(data.get("patientName") or "").strip(),
            "gender": {"M": "Nam", "F": "Nữ"}.get(sex, ""),
            "birthYear": (
                birth[:4]
                if len(birth) >= 4
                else stored_birth_year if len(stored_birth_year) == 4 else ""
            ),
            "hospital": str(data.get("hospitalName") or "").strip(),
            "hospitalKey": str(data.get("hospitalKey") or "").strip(),
        }

    def _manifest_studies_for(self, patient_dir: Path) -> dict[str, dict]:
        """Manifest study records keyed by the folder they live in.

        `patient-index.json` stores `studies` as a dict of studyUid -> record,
        and each record's `folder` is relative to the patient folder. The
        worklist walks the disk, so it needs the reverse lookup: given a study
        directory, which record describes it. Keys are casefolded absolute
        paths because that is what `_scan_study` has in hand.
        """
        try:
            raw = (patient_dir / "patient-index.json").read_text(encoding="utf-8")
            data = json.loads(raw)
        except Exception:
            return {}
        studies = data.get("studies") if isinstance(data, dict) else None
        if not isinstance(studies, dict):
            return {}
        by_folder: dict[str, dict] = {}
        for record in studies.values():
            if not isinstance(record, dict):
                continue
            relative = str(record.get("folder") or "").strip()
            if not relative:
                continue
            try:
                resolved = (patient_dir / relative).resolve()
            except OSError:
                continue
            by_folder[str(resolved).casefold()] = record
        return by_folder

    @staticmethod
    def _lookup_record(records: dict[str, dict], study_dir: Path) -> Optional[dict]:
        """The manifest record describing `study_dir`, if the manifest has one."""
        if not records:
            return None
        try:
            key = str(study_dir.resolve()).casefold()
        except OSError:
            key = str(study_dir).casefold()
        return records.get(key)

    @staticmethod
    def _sortable_study_date(raw: str) -> str:
        """The same date as YYYYMMDD, or "" — for ordering, never for display.

        Accepts either a DICOM DA or the dd/mm/yyyy the display field carries,
        so both call sites can hand it whatever they already have.
        """
        digits = re.sub(r"\D", "", str(raw or ""))
        if len(digits) != 8:
            return ""
        if _is_real_date(digits):
            return digits
        # dd/mm/yyyy stripped of separators is ddmmyyyy.
        reordered = f"{digits[4:8]}{digits[2:4]}{digits[0:2]}"
        return reordered if _is_real_date(reordered) else ""

    @staticmethod
    def _format_study_date(raw: str) -> str:
        """DICOM DA (or an ISO-ish variant) as dd/mm/yyyy; "" when unusable.

        An unparseable date returns empty rather than today's date: the study
        date is a field a clinician reads to tell two scans of the same patient
        apart, so a plausible-looking wrong one is worse than a blank.
        """
        digits = re.sub(r"\D", "", str(raw or ""))
        if _is_real_date(digits):
            return f"{digits[6:8]}/{digits[4:6]}/{digits[0:4]}"
        return ""

    def _patient_meta_for(self, patient_dir: Path) -> dict:
        """Use the manifest identity, or cautiously parse a legacy folder.

        Once patient-index.json exists it is the source of truth. A blank field
        in that file means unknown; filling it from a plausible folder name can
        fabricate demographics beside clinical images.

        The one field borrowed back from the folder is the name, and only when
        the manifest left it blank while both agree on the patient code. That
        agreement is the evidence: the folder is describing the same person the
        manifest is, so showing the name is reporting what is on disk rather
        than inventing a demographic. Sex and birth year are never borrowed.
        """
        guessed = self._parse_patient_meta(patient_dir.name)
        recorded = self._manifest_patient_meta(patient_dir)
        if not recorded:
            return guessed
        result = {
            key: str(recorded.get(key) or "").strip()
            for key in guessed
        }
        if not result.get("patientName") and guessed.get("patientName"):
            recorded_code = _identity_code(result.get("patientId"))
            folder_code = _identity_code(guessed.get("patientId"))
            if recorded_code and recorded_code == folder_code:
                result["patientName"] = guessed["patientName"]
        return result

    def _parse_patient_meta(self, folder_name: str) -> dict:
        name_clean = folder_name.replace("\\", "/").rstrip("/").split("/")[-1]
        name_clean = _UNKNOWN_FOLDER_FIELD_RE.sub(_UNKNOWN_FOLDER_FIELD, name_clean)
        primary_chunks = [c.strip() for c in re.split(r"[_|]|\s+-\s+|\s+·\s+", name_clean) if c.strip()]

        # Direct-download folders ending in date YYYY-MM-DD:
        #   <patient id> - <name> - <age> - <download date> (current format)
        #   <name> - <age> - <patient id> - <download date> (legacy format)
        # Which of the two is in front is decided by the shape of the first
        # chunk, not by its length: a code carries a digit, a name does not.
        if (
            len(primary_chunks) >= 4
            and re.fullmatch(r"\d{4}-\d{2}-\d{2}", primary_chunks[-1])
        ):
            if (
                _PATIENT_CODE_RE.match(primary_chunks[0])
                and any(c.isalpha() for c in primary_chunks[1])
                and not _AGE_TOKEN_RE.match(primary_chunks[1])
            ):
                return _folder_identity(primary_chunks[0], primary_chunks[1])
            if primary_chunks[-2]:
                return _folder_identity(
                    primary_chunks[-2], " - ".join(primary_chunks[:-3]).strip())

        # Folders typed by hand, hyphenated with no spaces around the hyphens:
        #   2606033997-NGUYỄN THỊ CẨM TÚ-14T-U thần kinh đệm...
        #   2401005051-Đào Trường Giang-30T-Phình mạch...
        # Everything after the age is the operator's own note about the case,
        # not a demographic, so it is read and discarded.
        m = re.match(
            r"^([A-Za-z0-9._-]*\d[A-Za-z0-9._-]*)-([A-Za-zÀ-ỹ][A-Za-zÀ-ỹ\s]*?)"
            r"(?:-\d{1,3}[A-Za-z]{0,2})?(?:-.*)?$",
            name_clean,
        )
        if m:
            return _folder_identity(m.group(1).strip(), m.group(2).strip())

        patient_id = primary_chunks[0] if primary_chunks else name_clean

        remaining = " ".join(primary_chunks[1:]) if len(primary_chunks) > 1 else ""
        words = [w.strip() for w in re.split(r"[\s,]+", remaining) if w.strip()]

        gender = ""
        for w in words:
            if w.casefold() in {"nam", "male", "m"}:
                gender = "Nam"
            elif w.casefold() in {"nu", "nữ", "female", "f"}:
                gender = "Nữ"

        birth_year = ""
        for w in words:
            if re.fullmatch(r"(19\d\d|20\d\d)", w):
                birth_year = w
                break

        hospital = ""
        # Which words the hospital took, so the name below does not take them
        # again: in "... - BV A" the "A" is the hospital, not the last word of
        # the patient's name.
        hospital_indices: set[int] = set()
        for i, w in enumerate(words):
            if w.upper() in {"BV", "BENHVIEN", "BỆNHVIỆN"} and i + 1 < len(words):
                hospital = f"BV {words[i+1].upper()}"
                hospital_indices = {i, i + 1}
                break
            elif re.fullmatch(r"BV\s*[A-Za-z0-9]+", w, re.IGNORECASE):
                hospital = w.upper()
                hospital_indices = {i}
                break

        name_tokens = []
        for index, w in enumerate(words):
            if index in hospital_indices:
                continue
            if w == patient_id:
                continue
            if w.casefold() in {"nam", "nu", "nữ", "male", "female", "m", "f"}:
                continue
            if w == birth_year:
                continue
            if w.upper().startswith("BV") or w.upper() in {"BENHVIEN", "BỆNHVIỆN"}:
                continue
            # A one-letter token is kept only when it is a letter: the final
            # word of "Nguyễn Văn A" is part of the name, while a stray
            # separator left over by the split is not.
            if w.isalpha() or (len(w) > 1 and not w.isdigit()):
                name_tokens.append(w)
        patient_name = " ".join(name_tokens).upper() if name_tokens else (primary_chunks[1].upper() if len(primary_chunks) > 1 else patient_id)

        # Anything not actually found stays empty. A worklist that invents a sex
        # or a birth year is worse than one that shows a blank: those two fields
        # are exactly what a clinician reads to confirm they opened the right
        # patient, so a guess here can send images to the wrong chart.
        return {
            "patientId": _blank_if_unknown(patient_id),
            "patientName": _blank_if_unknown(patient_name),
            "gender": gender,
            "birthYear": birth_year,
            "hospital": hospital,
            "hospitalKey": "",
        }

    def _scan_study(
        self,
        study_dir: Path,
        patient_meta: dict,
        manifest_study: Optional[dict] = None,
    ) -> dict:
        folder_str = str(study_dir)
        record = manifest_study if isinstance(manifest_study, dict) else {}
        exists = study_dir.is_dir()
        if not exists:
            return {
                "id": hashlib.sha256(folder_str.encode("utf-8")).hexdigest()[:16],
                # A folder that is gone has nothing left to read; the manifest
                # is the only surviving record of when the study was taken.
                "studyDate": self._format_study_date(record.get("date", "")),
                "studyDateSort": self._sortable_study_date(record.get("date", "")),
                "studyName": str(record.get("description") or "").strip() or study_dir.name,
                "modality": str(record.get("modality") or "").strip().upper(),
                "seriesCount": 0,
                "sliceCount": 0,
                "folder": folder_str,
                "status": "miss",
                "statusLabel": "Thiếu folder",
                "mediaCounts": {"dicom": 0, "photo": 0, "video": 0, "doc": 0},
                "primaryMediaType": str(record.get("mediaType") or "dicom").strip().lower(),
                "sizeBytes": 0,
                "readAt": str(record.get("readAt") or ""),
                "isRead": bool(str(record.get("readAt") or "").strip()),
            }

        # The manifest carries the StudyDate the pipeline read off the DICOM
        # tags, so it wins over anything the folder name happens to contain.
        study_date = self._format_study_date(record.get("date", ""))
        if not study_date:
            date_match = re.search(r"(\d{4})[-_](\d{2})[-_](\d{2})|(\d{8})", study_dir.name)
            if date_match:
                digits = (
                    f"{date_match.group(1)}{date_match.group(2)}{date_match.group(3)}"
                    if date_match.group(1) else date_match.group(4)
                )
                # A folder named after a patient code can start with 8 digits
                # that are not a date, so the same validation applies here.
                study_date = self._format_study_date(digits)

        study_name = str(record.get("description") or "").strip()
        if not study_name:
            clean_study_name = re.sub(r"^\d{4}[-_]\d{2}[-_]\d{2}[\s_-]*|^\d{8}[\s_-]*", "", study_dir.name).strip()
            if clean_study_name.startswith("-"):
                clean_study_name = clean_study_name.lstrip("- ").strip()
            study_name = clean_study_name or study_dir.name

        dicom_count = 0
        photo_count = 0
        video_count = 0
        doc_count = 0
        size_bytes = 0
        series_folders = set()

        try:
            for root, dirs, files in os.walk(study_dir):
                root_path = Path(root)
                rel = root_path.relative_to(study_dir)
                if len(rel.parts) == 1:
                    series_folders.add(rel.parts[0])
                for f in files:
                    fp = root_path / f
                    try:
                        sz = fp.stat().st_size
                        size_bytes += sz
                    except OSError:
                        pass
                    ext = fp.suffix.lower()
                    if ext in {".dcm", ".ima", ".dicom"} or "dicom" in str(fp).casefold():
                        dicom_count += 1
                    elif ext in {".mp4", ".avi", ".mkv", ".mov", ".webm"}:
                        video_count += 1
                    elif ext in {".pdf"}:
                        doc_count += 1
                    elif ext in {".jpg", ".png", ".jpeg", ".webp"}:
                        if _is_document_image(study_dir, root_path, f):
                            doc_count += 1
                        else:
                            photo_count += 1
        except Exception:
            pass

        # A modality recorded from the DICOM tag beats every guess below, which
        # only reads the folder name and the file extensions on disk.
        modality = str(record.get("modality") or "").strip().upper()
        lower_name = study_dir.name.casefold()
        if modality:
            pass
        elif "mr" in lower_name or "mri" in lower_name:
            modality = "MR"
        elif "ct" in lower_name:
            modality = "CT"
        elif "xray" in lower_name or "x-ray" in lower_name or "xquang" in lower_name or "x-quang" in lower_name:
            modality = "X-Quang"
        elif video_count > 0 and video_count >= dicom_count:
            modality = "Video"
        elif doc_count > 0 and doc_count >= dicom_count:
            modality = "Bệnh án"
        elif photo_count > 0 and photo_count >= dicom_count:
            modality = "Ảnh"
        elif dicom_count:
            modality = "DICOM"

        primary_media = "dicom"
        if modality == "Video" or (video_count > 0 and dicom_count == 0):
            primary_media = "video"
        elif modality == "Bệnh án" or (doc_count > 0 and dicom_count == 0 and photo_count == 0):
            primary_media = "doc"
        elif modality == "Ảnh" or (photo_count > 0 and dicom_count == 0):
            primary_media = "photo"

        series_count = max(1, len(series_folders)) if (dicom_count or photo_count) else 0
        slice_count = dicom_count if dicom_count else (photo_count + doc_count if (photo_count or doc_count) else video_count)

        # `patient-index.json` records how far the download actually got:
        # "complete" everything, "selected" only the series the doctor picked,
        # "incomplete" a run that stopped early. A folder with no manifest entry
        # says nothing about completeness, so it stays a plain "Đã tải".
        manifest_status = str(record.get("status") or "").strip().lower()
        if manifest_status == "selected":
            status, status_label = "part", "Đã tải series đã chọn"
        elif manifest_status == "incomplete":
            status, status_label = "part", "Chưa hoàn tất"
        else:
            status, status_label = "done", "Đã tải"

        job_snap = self.controller.job.snapshot()
        if job_snap.get("status") == "running" and str(study_dir).casefold() in str(job_snap.get("message", "")).casefold():
            status = "busy"
            status_label = "Đang tải"

        return {
            "id": hashlib.sha256(folder_str.encode("utf-8")).hexdigest()[:16],
            "studyDate": study_date,
            "studyDateSort": self._sortable_study_date(study_date),
            "studyName": study_name,
            "modality": modality,
            "seriesCount": series_count,
            "sliceCount": slice_count,
            "folder": folder_str,
            "status": status,
            "statusLabel": status_label,
            "mediaCounts": {
                "dicom": dicom_count,
                "photo": photo_count,
                "video": video_count,
                "doc": doc_count,
            },
            "primaryMediaType": primary_media,
            "sizeBytes": size_bytes,
            # Lets the UI offer "Tải tiếp" on a study that stopped early: the
            # retry path needs the viewer link the first run came from.
            "viewerUrl": str(record.get("viewerUrl") or record.get("downloadUrl") or ""),
            # Only the pipeline probes video length, so this stays None for a
            # folder that was merely copied in — the UI hides the stat then.
            "durationSeconds": record.get("durationSeconds"),
            # When the reader marked this study read. Empty for a study nobody
            # has marked, and for a folder no patient index describes — the
            # Worklist then shows it as unread rather than inventing a state.
            "readAt": str(record.get("readAt") or ""),
            "isRead": bool(str(record.get("readAt") or "").strip()),
        }

    def scan(self) -> list[dict]:
        roots_to_scan = []
        for r in self.controller.get_all_source_roots():
            if r.is_dir():
                try:
                    resolved = r.resolve()
                    if resolved not in roots_to_scan:
                        roots_to_scan.append(resolved)
                except OSError:
                    pass

        # History spans every folder ever opened, including temp fixtures and
        # archives that have since moved. Folding all of it into the Study List
        # made a one-patient archive report fourteen patients and twenty-five
        # items "needing attention". The Study List shows the archive that is
        # actually selected; the Activity tab is where the full history lives.
        history = self.controller.history_snapshot()
        history_folders = []
        for item in history:
            if not item.get("folder"):
                continue
            candidate = Path(item["folder"])
            try:
                resolved = candidate.expanduser().resolve()
            except OSError:
                continue
            if any(_is_within(resolved, root) for root in roots_to_scan):
                history_folders.append(candidate)

        patient_map: dict[str, dict] = {}

        def archive_key(patient_dir: Path) -> str:
            """One Worklist patient row per archive root, never per bare ID."""
            try:
                return str(patient_dir.resolve()).casefold()
            except OSError:
                return str(patient_dir).casefold()

        for root in roots_to_scan:
            try:
                children = list(root.iterdir())
            except OSError:
                continue
            for child in children:
                if not child.is_dir() or child.name.startswith("."):
                    continue
                try:
                    key = archive_key(child)
                    meta = self._patient_meta_for(child)
                    if key not in patient_map:
                        patient_map[key] = {
                            "id": f"p_{hashlib.sha256(key.encode()).hexdigest()[:12]}",
                            **meta,
                            "folder": str(child),
                            "exists": True,
                            "studies": [],
                        }
                    records = self._manifest_studies_for(child)
                    subdirs = [s for s in child.iterdir() if s.is_dir() and not s.name.startswith(".")]
                    study_subdirs = [s for s in subdirs if not s.name.upper() in {"DICOM", "JPG", "VIDEO", "PHOTO"}]
                    if study_subdirs:
                        for sdir in study_subdirs:
                            st = self._scan_study(sdir, meta, self._lookup_record(records, sdir))
                            patient_map[key]["studies"].append(st)
                    else:
                        st = self._scan_study(child, meta, self._lookup_record(records, child))
                        patient_map[key]["studies"].append(st)
                except (OSError, ValueError, TypeError):
                    # A half-copied or unreadable patient archive must not hide
                    # every later record in the same output folder.
                    continue

        for hpath in history_folders:
            # Walk up to find if hpath belongs to an existing patient archive folder
            patient_dir = hpath
            for candidate in (hpath, *hpath.parents):
                if candidate.name.casefold() in {"dicom", "jpg"}:
                    continue
                if (candidate / "patient-index.json").is_file() or archive_key(candidate) in patient_map:
                    patient_dir = candidate
                    break
            else:
                if hpath.name.casefold() in {"dicom", "jpg"}:
                    patient_dir = hpath.parent
            key = archive_key(patient_dir)
            meta = self._patient_meta_for(patient_dir)
            if key not in patient_map:
                patient_map[key] = {
                    "id": f"p_{hashlib.sha256(key.encode()).hexdigest()[:12]}",
                    **meta,
                    "folder": str(patient_dir),
                    "exists": patient_dir.is_dir(),
                    "studies": [],
                }
            existing_folders = {s["folder"].casefold() for s in patient_map[key]["studies"]}
            # Opening a patient folder puts it in history, and adding it again
            # here listed the whole archive as a fifth "study" beside its own
            # four — with every image counted twice. A patient directory only
            # stands in as a study when the scan found no study folders in it.
            already_scanned = (
                archive_key(hpath) == key and bool(patient_map[key]["studies"])
            )
            if not already_scanned and str(hpath).casefold() not in existing_folders:
                records = self._manifest_studies_for(patient_dir)
                st = self._scan_study(hpath, meta, self._lookup_record(records, hpath))
                patient_map[key]["studies"].append(st)

        patients = []
        for p in patient_map.values():
            total_size = sum(s.get("sizeBytes", 0) for s in p["studies"])
            dicom_tot = sum(s["mediaCounts"]["dicom"] for s in p["studies"])
            photo_tot = sum(s["mediaCounts"]["photo"] for s in p["studies"])
            video_tot = sum(s["mediaCounts"]["video"] for s in p["studies"])
            doc_tot = sum(s["mediaCounts"]["doc"] for s in p["studies"])

            p["totalSizeBytes"] = total_size
            p["totalSizeFormatted"] = _format_file_size(total_size)
            p["mediaSummary"] = {
                "dicom": dicom_tot,
                "photo": photo_tot,
                "video": video_tot,
                "doc": doc_tot,
            }
            # `studyDate` is already formatted dd/mm/yyyy for display, so
            # sorting it as text ordered by day and put 20/06/2026 ahead of
            # 06/08/2026. `studyDateSort` is the same date as YYYYMMDD.
            p["studies"].sort(key=lambda s: s.get("studyDateSort", ""), reverse=True)
            patients.append(p)

        return patients


class WebController:
    def __init__(self) -> None:
        self.catalog = ArchiveCatalog()
        self.sessions = ViewerSessionRegistry(self.catalog)
        # The session bootstrap pins the shared catalog to, so a reload reuses
        # it instead of cloning the whole archive again.
        self._bootstrap_session_id = ""
        self.job = JobState()
        app_data = Path(os.environ.get("LOCALAPPDATA") or Path.home())
        self.annotation_root = app_data / "DCom JPG PACS" / "viewer-annotations"
        self.settings_path = app_data / "DCom JPG PACS" / "settings.json"
        self.history = HistoryStore()
        settings = self._read_settings()
        self.language = settings.get("language", "en")
        self.output_root = Path(settings.get("outputRoot") or (Path.home() / "DCom JPG PACS"))
        raw_sources = settings.get("sourceFolders")
        if isinstance(raw_sources, list) and raw_sources:
            self.source_folders = [str(f).strip() for f in raw_sources if str(f).strip()]
        else:
            self.source_folders = [str(self.output_root)]
        if str(self.output_root) not in self.source_folders:
            self.source_folders.insert(0, str(self.output_root))
        self.window_settings = settings.get("window")

    def _read_settings(self) -> dict:
        try:
            value = json.loads(self.settings_path.read_text(encoding="utf-8"))
        except Exception:
            return {}
        if not isinstance(value, dict):
            return {}
        language = str(value.get("language") or "en")
        window_raw = value.get("window")
        window_settings = window_raw if isinstance(window_raw, dict) else None
        return {
            "language": language if language in SUPPORTED_LANGUAGES else "en",
            "outputRoot": str(value.get("outputRoot") or ""),
            "sourceFolders": value.get("sourceFolders") if isinstance(value.get("sourceFolders"), list) else None,
            "window": window_settings,
        }

    def _write_settings(self) -> None:
        # A settings write must never break the session that triggered it.
        try:
            self.settings_path.parent.mkdir(parents=True, exist_ok=True)
            temporary = self.settings_path.with_suffix(".json.tmp")
            payload = {
                "language": self.language,
                "outputRoot": str(self.output_root),
                "sourceFolders": self.source_folders,
            }
            if isinstance(self.window_settings, dict):
                payload["window"] = self.window_settings
            temporary.write_text(
                json.dumps(
                    payload,
                    ensure_ascii=False,
                    indent=1,
                ),
                encoding="utf-8",
            )
            temporary.replace(self.settings_path)
        except Exception:
            pass

    def save_window_settings(self, win_dict: dict) -> None:
        if isinstance(win_dict, dict):
            self.window_settings = win_dict
            self._write_settings()

    def set_language(self, language: str) -> dict:
        value = str(language or "").casefold()
        if value not in SUPPORTED_LANGUAGES:
            raise ValueError("Ngôn ngữ không được hỗ trợ.")
        self.language = value
        self._write_settings()
        return {"language": self.language}

    def get_all_source_roots(self) -> list[Path]:
        """All unique folder paths configured as patient sources."""
        seen = set()
        roots: list[Path] = []
        candidates = [self.output_root] + [Path(f) for f in self.source_folders]
        for c in candidates:
            try:
                p = c.expanduser()
                resolved = p.resolve()
                key = str(resolved).casefold()
                if key not in seen:
                    seen.add(key)
                    roots.append(p)
            except OSError:
                key = str(c).casefold()
                if key not in seen:
                    seen.add(key)
                    roots.append(c)
        return roots

    def get_source_folders(self) -> list[dict]:
        """Returns the list of source folders with existence and default flags."""
        results = []
        roots = self.get_all_source_roots()
        for p in roots:
            p_resolved = None
            try:
                p_resolved = p.resolve()
            except OSError:
                pass
            is_default = False
            if p_resolved and self.output_root.is_dir():
                is_default = (p_resolved == self.output_root.resolve())
            elif str(p) == str(self.output_root):
                is_default = True

            results.append({
                "folder": str(p),
                "exists": p.is_dir(),
                "isDefault": is_default,
            })
        return results

    def add_source_folder(self, path: str) -> dict:
        folder_str = str(path or "").strip()
        if not folder_str:
            raise ValueError("Đường dẫn thư mục không được để trống.")
        p = Path(folder_str).expanduser()
        p.mkdir(parents=True, exist_ok=True)
        try:
            resolved_str = str(p.resolve())
        except OSError:
            resolved_str = str(p)

        existing = []
        for f in self.source_folders:
            try:
                existing.append(str(Path(f).expanduser().resolve()))
            except OSError:
                existing.append(str(f))

        if resolved_str not in existing and folder_str not in self.source_folders:
            self.source_folders.append(resolved_str)
            self._write_settings()
        return {"sourceFolders": self.get_source_folders(), "added": resolved_str}

    def remove_source_folder(self, path: str) -> dict:
        target = str(path or "").strip()
        if not target:
            raise ValueError("Đường dẫn thư mục không được để trống.")

        target_p = None
        try:
            target_p = Path(target).expanduser().resolve()
        except OSError:
            pass

        new_sources = []
        for f in self.source_folders:
            f_p = None
            try:
                f_p = Path(f).expanduser().resolve()
            except OSError:
                pass
            if target_p and f_p and target_p == f_p:
                continue
            if f.casefold() == target.casefold():
                continue
            new_sources.append(f)

        self.source_folders = new_sources
        if not self.source_folders:
            self.source_folders = [str(self.output_root)]
        self._write_settings()
        return {"sourceFolders": self.get_source_folders(), "removed": target}

    def history_snapshot(self) -> list[dict]:
        return self.history.snapshot()

    def start_history_open(self, folder: str) -> dict:
        target = Path(str(folder or "")).expanduser()
        if not target.is_dir():
            raise ValueError(f"Thư mục không còn tồn tại:\n{target}")
        return self.start_archive_scan(str(target))

    def bootstrap(self, session_id: Optional[str] = None) -> dict:
        # One snapshot: it serialises every series, so building it twice would
        # double the work on a large archive for no gain.
        catalog = self.sessions.get_catalog(session_id)
        archive = catalog.snapshot()
        archive_session_id = str(session_id or "")
        if not archive_session_id and archive.get("root") and archive.get("series"):
            root = str(archive.get("root") or "")
            # Bootstrap runs again on every page reload. Cloning the catalog
            # each time would retain one full copy of every series per reload,
            # so the session already pinned to this root is reused and a new
            # one is minted only when the shared catalog has moved elsewhere.
            session = self.sessions.get_session(self._bootstrap_session_id)
            if session is None or str(session.catalog.root or "") != root:
                session = self.sessions.create_session_from_catalog(catalog, folder=root)
                self._bootstrap_session_id = session.session_id
            archive_session_id = session.session_id
            # The clone holds the same records, so its snapshot is the one
            # already built above; serialising all of them twice is the exact
            # cost the comment at the top of this method exists to avoid.
        return {
            "version": APP_VERSION,
            "archive": archive,
            "archiveSessionId": archive_session_id,
            "job": self.job.snapshot(),
            "outputRoot": str(self.output_root),
            "sourceFolders": self.get_source_folders(),
            "language": self.language,
            "history": self.history_snapshot(),
            # Disk scanning can walk thousands of image files. The shell paints
            # first and /api/worklist performs the scan asynchronously, with an
            # explicit loading/error state in the UI.
            "worklist": {"patients": [], "deferred": True},
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

    def get_worklist(self) -> dict:
        scanner = WorklistScanner(self)
        patients = scanner.scan()
        return {"patients": patients}

    def _reveal_roots(self) -> list[Path]:
        """Folders the UI is allowed to hand to the shell."""
        roots: list[Path] = []
        for r in self.get_all_source_roots():
            if r.is_dir():
                try:
                    roots.append(r.resolve())
                except OSError:
                    roots.append(r)
        catalog_root = getattr(self.catalog, "root", "")
        if catalog_root:
            roots.append(Path(catalog_root).resolve())
        return roots

    def reveal_folder(self, folder_str: str) -> dict:
        """Open a study folder in the OS file browser.

        `os.startfile` launches whatever the shell associates with the target,
        so handing it a *file* would run it — an .exe or .bat under the archive
        would execute. Two guards keep that shut: the path must resolve inside a
        known root, and it must be a directory, never a file.
        """
        target = Path(folder_str).expanduser().resolve()
        roots = self._reveal_roots()
        if not roots or not any(_is_within(target, root) for root in roots):
            raise PermissionError(
                f"Truy cập bị từ chối: Đường dẫn nằm ngoài phạm vi cho phép ({folder_str})"
            )
        if not target.is_dir():
            raise ValueError(f"Chỉ mở được thư mục, không mở file: {folder_str}")
        if sys.platform.startswith("win"):
            os.startfile(str(target))  # type: ignore[attr-defined]
        else:
            subprocess.Popen(["xdg-open", str(target)])
        return {"revealed": True, "folder": str(target)}

    def open_archive(self, path: str) -> dict:
        return self.catalog.open(path)

    def start_archive_scan(
        self,
        path: str,
        catalog: Optional[ArchiveCatalog] = None,
    ) -> dict:
        """Re-read a folder from disk into the catalog the caller reads from.

        "Cập nhật folder" is pressed inside a patient tab, and that tab answers
        every other request from its own session catalog. Scanning into the
        shared default instead left the tab showing a fresh snapshot while its
        catalog still held the old series list, so opening a file that had just
        appeared reported "Không tìm thấy series".
        """
        root = str(Path(path).expanduser().resolve(strict=True))
        target_catalog = catalog if catalog is not None else self.catalog

        def target() -> dict:
            archive = target_catalog.open(
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
            self.job.log(f"Đang quét folder DICOM local và chuyển sang JPG chất lượng {quality}…")

            pairs, open_path = _local_import_plan(source)
            if not _is_writable_dir(source):
                self.job.log(
                    "Folder nguồn chỉ đọc nên không ghi JPG cạnh DICOM được; "
                    f"chuyển sang thư mục lưu: {output_root}."
                )
                stamp = time.strftime("%Y%m%d_%H%M%S")
                pairs, open_path = _redirect_plan(
                    pairs, output_root / f"LOCAL_DICOM_{stamp}_{source.name}"
                )

            total_stats = dcom_pipeline.ConvertStats()
            # (patient folder, [(study folder, study group)]) for every pair that
            # carried readable DICOM identity. Written after the conversion so a
            # half-finished import never leaves a manifest promising images that
            # are not on disk yet.
            archives: list[tuple[Path, list[tuple[Path, Any]]]] = []
            for src_dicom, dst_jpg in pairs:
                if self.job.stop_event.is_set():
                    break
                groups = dcom_pipeline.index_local_dicom_studies(
                    src_dicom, log=self.job.log,
                )
                if len(groups) > 1:
                    # Patient media routinely holds several exams in one tree.
                    # Converting them into one folder would mix the studies, so
                    # each gets the same `<date> - <modality> - <mô tả>/JPG`
                    # layout a download produces.
                    patient_folder = dst_jpg.parent
                    self.job.log(
                        f"Thư mục chứa {len(groups)} ca chụp; mỗi ca được tách "
                        "sang folder riêng như khi tải phim."
                    )
                    study_dirs: list[tuple[Path, Any]] = []
                    for group in groups:
                        if self.job.stop_event.is_set():
                            break
                        study_dir = patient_folder / dcom_pipeline.study_folder_base_name(
                            group.as_study()
                        )
                        self.job.log(
                            f"Ca {group.date or '?'} - {group.modality or '?'} - "
                            f"{group.description or 'chưa có mô tả'}: {len(group.files)} ảnh."
                        )
                        stats = dcom_pipeline.convert_all(
                            src_dicom,
                            study_dir / "JPG",
                            log=self.job.log,
                            quality=quality,
                            save_png=False,
                            contrast_mode=dcom_pipeline.CLINICAL,
                            should_stop=self.job.stop_event.is_set,
                            files=group.files,
                        )
                        total_stats.converted += stats.converted
                        total_stats.failed += stats.failed
                        total_stats.skipped += stats.skipped
                        study_dirs.append((study_dir, group))
                    archives.append((patient_folder, study_dirs))
                    open_path = patient_folder
                else:
                    stats = dcom_pipeline.convert_all(
                        src_dicom,
                        dst_jpg,
                        log=self.job.log,
                        quality=quality,
                        save_png=False,
                        contrast_mode=dcom_pipeline.CLINICAL,
                        should_stop=self.job.stop_event.is_set,
                    )
                    total_stats.converted += stats.converted
                    total_stats.failed += stats.failed
                    total_stats.skipped += stats.skipped
                    if groups:
                        study_dir = dst_jpg.parent
                        # A study folder inside an archive this app already
                        # manages belongs to that archive, not to a second index
                        # nested one level down.
                        parent_managed = dcom_pipeline._read_patient_manifest(
                            study_dir.parent
                        ) is not None
                        patient_folder = study_dir.parent if parent_managed else study_dir
                        archives.append((patient_folder, [(study_dir, groups[0])]))

            if not self.job.stop_event.is_set() and total_stats.converted <= 0:
                raise ValueError(
                    "Không tìm thấy ảnh DICOM có PixelData "
                    "(.dcm, .dicom, .ima hoặc file DICOM không đuôi)."
                )

            indexed_studies = self._index_local_import(archives)

            archive = self.catalog.open(
                open_path,
                log=self.job.log,
                should_stop=self.job.stop_event.is_set,
            )
            self.history.add(open_path)
            session = self.sessions.create_session_from_catalog(
                self.catalog,
                folder=str(open_path),
            )
            return {
                "archive": archive,
                "sessionId": session.session_id,
                "source": str(source),
                "output": str(open_path),
                "converted": total_stats.converted,
                "failed": total_stats.failed,
                "indexedStudies": indexed_studies,
            }

        self.job.start("local-import", target)
        return self.job.snapshot()

    def _index_local_import(
        self,
        archives: list[tuple[Path, list[tuple[Path, Any]]]],
    ) -> int:
        """Write `patient-index.json` for folders just imported from disc.

        This is what turns a converted folder into the same managed archive a
        download produces: the Worklist finds it, the patient rail shows the
        demographics the DICOM actually carries, and the studies keep their own
        dates and accession numbers.

        Identity comes only from the files. A folder whose images name two
        patients, or name none, is converted and left unindexed rather than
        filed under a guess.
        """
        indexed = 0
        for patient_folder, study_dirs in archives:
            groups = [group for _, group in study_dirs]
            identity = dcom_pipeline.local_import_identity(groups)
            if not identity:
                self.job.log(
                    "Không xác định được một bệnh nhân duy nhất từ tag DICOM; "
                    f"đã chuyển JPG nhưng không tạo hồ sơ cho {patient_folder.name}."
                )
                continue
            try:
                dcom_pipeline.write_local_import_manifest(
                    patient_folder, identity, log=self.job.log,
                )
                for study_dir, group in study_dirs:
                    if not study_dir.is_dir():
                        continue
                    image_count = sum(
                        1 for _ in study_dir.rglob("*.jpg")
                    )
                    dcom_pipeline.record_patient_study(
                        patient_folder,
                        group.as_study(),
                        study_dir,
                        complete=True,
                        image_count=image_count,
                    )
                    indexed += 1
            except Exception as exc:
                self.job.log(f"⚠ Không ghi được hồ sơ bệnh nhân: {exc}")
        if indexed:
            self.job.log(
                f"Đã ghi patient-index.json cho {indexed} ca; "
                "hồ sơ sẽ hiện trong Danh sách bệnh nhân."
            )
        return indexed

    def start_portable_export(self, folder: str, destination: str, mode: str = "viewer") -> dict:
        """Write a patient record to a folder any browser can open.

        Runs as a queued job because it copies every JPG in the record, which
        for a few studies is gigabytes.
        """
        import portable_export

        patient_folder = Path(folder).expanduser().resolve(strict=True)
        if not patient_folder.is_dir():
            raise ValueError("Đường dẫn hồ sơ không phải thư mục.")
        target = Path(destination).expanduser().resolve()
        # Rejected here rather than inside the job, so a bad mode answers the
        # caller directly instead of queueing work that can only fail.
        portable_export._resolve_export_mode(mode)

        def run() -> dict:
            self.job.log(f"Đang xuất hồ sơ {patient_folder.name} sang {target} (chế độ: {mode})…")
            return portable_export.export_patient_record(
                patient_folder,
                target,
                mode=mode,
                log=self.job.log,
                should_stop=self.job.stop_event.is_set,
            )

        self.job.start("export", run)
        return self.job.snapshot()

    def get_export_options(self, folder: str) -> dict:
        """Detect JPG and DICOM counts in a patient folder to inform the export dialog."""
        import portable_export

        patient_folder = Path(folder).expanduser().resolve(strict=True)
        if not patient_folder.is_dir():
            raise ValueError("Đường dẫn hồ sơ không phải thư mục.")
        return portable_export.detect_patient_export_contents(patient_folder)

    def set_study_read(self, folder: str, read: bool) -> dict:
        """Mark a study read or unread, so a reader can see what is left to do.

        Persisted in the patient index beside the study, not in this process:
        the mark has to survive a restart to be worth anything.
        """
        return dcom_pipeline.set_study_read_state(Path(folder), bool(read))

    def verify_study_integrity(self, folder: str) -> dict:
        """Examine slice continuity and DICOM-to-JPG parity for a study folder."""
        study_folder = Path(folder).expanduser().resolve(strict=True)
        dicom_dir = study_folder / "DICOM" if (study_folder / "DICOM").is_dir() else study_folder
        is_continuous, continuity_rep = dcom_pipeline.verify_study_slice_continuity(dicom_dir)
        is_parity, parity_rep = dcom_pipeline.verify_study_dicom_jpg_parity(study_folder)
        return {
            "folder": str(study_folder),
            "isComplete": bool(is_continuous and is_parity),
            "continuity": continuity_rep,
            "parity": parity_rep,
        }

    def mark_study_complete(self, folder: str, complete: bool = True) -> dict:
        """Manually mark a study complete or incomplete in its patient index."""
        study_folder = Path(folder).expanduser().resolve(strict=True)
        candidates = [study_folder, *list(study_folder.parents)[:4]]
        for candidate in candidates:
            manifest = dcom_pipeline._read_patient_manifest(candidate)
            if manifest is None:
                continue
            for record in (manifest.get("studies") or {}).values():
                if not isinstance(record, dict):
                    continue
                relative = str(record.get("folder") or "").strip()
                if not relative:
                    continue
                try:
                    resolved = (candidate / relative).resolve()
                except OSError:
                    continue
                if resolved != study_folder:
                    continue
                record["status"] = "complete" if complete else "incomplete"
                manifest["updatedAt"] = dcom_pipeline._now_local()
                dcom_pipeline._write_patient_manifest(candidate, manifest)
                return {
                    "folder": str(study_folder),
                    "status": record["status"],
                    "isComplete": record["status"] == "complete",
                }
            break
        raise ValueError("Ca chụp này chưa có trong patient-index.json.")

    def set_output_root(self, path: str) -> dict:
        root = Path(path).expanduser().resolve()
        root.mkdir(parents=True, exist_ok=True)
        self.output_root = root
        resolved_str = str(root)
        if resolved_str not in self.source_folders:
            self.source_folders.insert(0, resolved_str)
        self._write_settings()
        return {"outputRoot": str(root), "sourceFolders": self.get_source_folders()}

    def save_media_edit(
        self,
        work_path: str,
        series_id: str,
        catalog: Optional[ArchiveCatalog] = None,
        media_index: int = 0,
    ) -> dict:
        """Copy an edited photo out of the scratch folder into the record.

        Edits landed in `%TEMP%\\concord_media_work` and nowhere else, so
        leaving the tab and coming back showed the untouched original — the
        work was silently gone. This writes a new file beside the source, never
        over it: the original stays the record of what the camera captured, and
        the edit is a derived file the archive can list.
        """
        target_catalog = catalog or self.catalog
        record = target_catalog.get(series_id)
        if not record.images:
            raise ValueError("Series không có file nào để lưu cạnh.")
        source = Path(str(work_path or "")).expanduser().resolve()
        if not _is_within(source, MEDIA_WORK_ROOT.resolve()):
            raise PermissionError("Chỉ lưu được file vừa chỉnh trong thư mục làm việc.")
        if not source.is_file():
            raise ValueError("Không tìm thấy file đã chỉnh để lưu.")

        # A folder of intra-op photos is one series, and the editor works on
        # whichever page is on screen. Naming every edit after the first file
        # made page 3's edit read as a derivative of page 1.
        index = media_index if 0 <= media_index < len(record.images) else 0
        origin = record.images[index]
        folder = record.folder
        stem = origin.stem
        suffix = source.suffix or origin.suffix or ".jpg"
        stamp = time.strftime("%Y%m%d-%H%M%S")
        destination = folder / f"{stem}_edit_{stamp}{suffix}"
        counter = 2
        while destination.exists():
            destination = folder / f"{stem}_edit_{stamp}_{counter}{suffix}"
            counter += 1
        shutil.copy2(source, destination)
        return {
            "savedPath": str(destination),
            "name": destination.name,
            "folder": str(folder),
        }

    def set_patient_diagnosis(
        self,
        text: str,
        *,
        archive_root: str = "",
        expected_patient_id: str = "",
        catalog: Optional[ArchiveCatalog] = None,
    ) -> dict:
        """Record the clinician's own diagnosis note on one patient folder.

        A local archive has no RIS behind it, and neither DICOM nor the manifest
        schema carries a clinical diagnosis — `StudyDescription` is the exam
        type, not a finding. So the note is typed by whoever is reading, and
        stored as an extra `diagnosis` key on `patient-index.json`. Only a new
        key is added; the manifest structure and format version are untouched.

        The caller names the archive it is looking at and the patient ID it has
        on screen, and both are checked before anything is written. Falling back
        to "whichever catalog was opened last" would let a note typed in one
        patient's tab land in another patient's record — the viewer does not yet
        carry a session per tab, so that is a live risk rather than a
        theoretical one.
        """
        target = catalog or self.catalog
        root = str(archive_root or "").strip() or (str(target.root) if target.root else "")
        if not root:
            raise ValueError("Chưa mở hồ sơ nào để ghi chẩn đoán.")
        start = Path(root).expanduser().resolve()
        allowed = self._reveal_roots()
        if allowed and not any(_is_within(start, base) for base in allowed):
            raise PermissionError(
                f"Truy cập bị từ chối: Đường dẫn nằm ngoài phạm vi cho phép ({root})"
            )
        # The patient folder is looked for at or above the archive root, but
        # never above the roots the app is allowed to touch: a stray manifest
        # further up the disk must not become the file this writes to.
        folder = next(
            (
                candidate for candidate in (start, *start.parents)
                if (not allowed or any(_is_within(candidate, base) for base in allowed))
                and (candidate / "patient-index.json").is_file()
            ),
            None,
        )
        if folder is None:
            raise ValueError(
                "Hồ sơ này chưa có patient-index.json nên chưa ghi được chẩn đoán."
            )
        manifest = dcom_pipeline._read_patient_manifest(folder)
        if manifest is None:
            raise ValueError("Không đọc được patient-index.json của hồ sơ này.")
        recorded_id = str(manifest.get("patientId") or "").strip()
        wanted_id = str(expected_patient_id or "").strip()
        if wanted_id and recorded_id and wanted_id != recorded_id:
            raise ValueError(
                f"Từ chối ghi: hồ sơ trên màn hình là {wanted_id} nhưng thư mục "
                f"{folder.name} thuộc bệnh nhân {recorded_id}."
            )
        manifest["diagnosis"] = str(text or "").strip()
        dcom_pipeline._write_patient_manifest(folder, manifest)
        patient = ArchiveCatalog._patient_block(manifest)
        with target._lock:
            # Only refresh the in-memory copy when it is the same patient; the
            # open catalog may be someone else entirely.
            if str(target._patient.get("patientId") or "") == recorded_id:
                target._patient = dict(patient)
        return {"patient": patient}

    def update_patient_info(
        self,
        info: dict,
        *,
        archive_root: str = "",
        expected_patient_id: str = "",
        catalog: Optional[ArchiveCatalog] = None,
    ) -> dict:
        """Update patient administrative details directly in patient-index.json.

        Allows editing patient name, ID, gender, birth date/year, phone, address,
        hospital, and diagnosis notes while preserving studies and technical metadata.
        """
        target = catalog or self.catalog
        root = str(archive_root or "").strip() or (str(target.root) if target.root else "")
        if not root:
            raise ValueError("Chưa mở hồ sơ nào để cập nhật thông tin bệnh nhân.")
        start = Path(root).expanduser().resolve()
        allowed = self._reveal_roots()
        if allowed and not any(_is_within(start, base) for base in allowed):
            raise PermissionError(
                f"Truy cập bị từ chối: Đường dẫn nằm ngoài phạm vi cho phép ({root})"
            )
        folder = next(
            (
                candidate for candidate in (start, *start.parents)
                if (not allowed or any(_is_within(candidate, base) for base in allowed))
                and (candidate / "patient-index.json").is_file()
            ),
            None,
        )
        if folder is None:
            raise ValueError(
                "Hồ sơ này chưa có patient-index.json nên chưa cập nhật được thông tin."
            )
        manifest = dcom_pipeline._read_patient_manifest(folder)
        if manifest is None:
            raise ValueError("Không đọc được patient-index.json của hồ sơ này.")
        recorded_id = str(manifest.get("patientId") or "").strip()
        wanted_id = str(expected_patient_id or "").strip()
        if wanted_id and recorded_id and wanted_id != recorded_id:
            raise ValueError(
                f"Từ chối ghi: hồ sơ trên màn hình là {wanted_id} nhưng thư mục "
                f"{folder.name} thuộc bệnh nhân {recorded_id}."
            )

        if not isinstance(info, dict):
            raise ValueError("Dữ liệu thông tin bệnh nhân không hợp lệ.")

        if "patientName" in info:
            manifest["patientName"] = str(info["patientName"] or "").strip()
        if "patientId" in info:
            patient_id = str(info["patientId"] or "").strip()
            if not patient_id:
                raise ValueError("Mã bệnh nhân không được để trống.")
            if len(patient_id) > 128:
                raise ValueError("Mã bệnh nhân không được dài quá 128 ký tự.")
            manifest["patientId"] = patient_id
        if "gender" in info:
            g = str(info["gender"] or "").strip()
            manifest["gender"] = g
            if g.lower() in ("nam", "m", "male"):
                manifest["patientSex"] = "M"
            elif g.lower() in ("nữ", "nu", "f", "female"):
                manifest["patientSex"] = "F"
            elif g:
                manifest["patientSex"] = "O"
            else:
                manifest["patientSex"] = ""
        if "birthDate" in info:
            bd = re.sub(r"\D", "", str(info["birthDate"] or ""))
            if not bd:
                manifest.pop("patientBirthDate", None)
                manifest.pop("birthYear", None)
            elif len(bd) != 8 or not _is_real_date(bd):
                raise ValueError("Ngày sinh phải là một ngày hợp lệ theo định dạng YYYYMMDD.")
            else:
                manifest["patientBirthDate"] = bd
                manifest.pop("birthYear", None)
        elif "birthYear" in info:
            raw_year = str(info["birthYear"] or "").strip()
            if not raw_year:
                manifest.pop("patientBirthDate", None)
                manifest.pop("birthYear", None)
            else:
                by = re.sub(r"\D", "", raw_year)
                current_year = datetime.date.today().year
                if len(by) != 4 or not 1900 <= int(by) <= current_year:
                    raise ValueError(f"Năm sinh phải nằm trong khoảng 1900–{current_year}.")
                existing_bd = re.sub(
                    r"\D", "", str(manifest.get("patientBirthDate") or "")
                )
                updated_bd = f"{by}{existing_bd[4:]}" if len(existing_bd) == 8 else ""
                if updated_bd and _is_real_date(updated_bd):
                    # Preserve a recorded month/day when the user corrects only
                    # the year. Never manufacture 01/01 when no exact date exists.
                    manifest["patientBirthDate"] = updated_bd
                    manifest.pop("birthYear", None)
                else:
                    manifest.pop("patientBirthDate", None)
                    manifest["birthYear"] = by
        if "phone" in info:
            manifest["phone"] = str(info["phone"] or "").strip()
        if "address" in info:
            manifest["address"] = str(info["address"] or "").strip()
        if "hospital" in info:
            manifest["hospitalName"] = str(info["hospital"] or "").strip()
        if "diagnosis" in info:
            manifest["diagnosis"] = str(info["diagnosis"] or "").strip()

        dcom_pipeline._write_patient_manifest(folder, manifest)
        patient = ArchiveCatalog._patient_block(manifest)
        with target._lock:
            # A caller that names a different archive must not replace the
            # identity cached by this catalog. The session route normally makes
            # these the same patient; this guard keeps the direct method safe.
            if str(target._patient.get("patientId") or "") == recorded_id:
                target._patient = dict(patient)
        return {"patient": patient}

    def set_timeline_label(
        self,
        timeline_key: str,
        text: str,
        *,
        archive_root: str = "",
        expected_patient_id: str = "",
        catalog: Optional[ArchiveCatalog] = None,
    ) -> dict:
        """Store a user-authored name for one study-level timeline row."""
        target = catalog or self.catalog
        key = str(timeline_key or "").strip()
        with target._lock:
            valid_keys = {record.timeline_key() for record in target._series.values()}
        if not key or key not in valid_keys:
            raise ValueError("Dòng timeline không thuộc hồ sơ đang mở.")

        label = str(text or "").strip()
        if len(label) > 120:
            raise ValueError("Tên timeline không được dài quá 120 ký tự.")

        root = str(archive_root or "").strip() or (str(target.root) if target.root else "")
        if not root:
            raise ValueError("Chưa mở hồ sơ nào để đổi tên timeline.")
        start = Path(root).expanduser().resolve()
        allowed = self._reveal_roots()
        if allowed and not any(_is_within(start, base) for base in allowed):
            raise PermissionError(
                f"Truy cập bị từ chối: Đường dẫn nằm ngoài phạm vi cho phép ({root})"
            )
        # The patient folder is looked for at or above the archive root, but
        # never above the roots the app is allowed to touch: a stray manifest
        # further up the disk must not become the file this writes to.
        folder = next(
            (
                candidate for candidate in (start, *start.parents)
                if (not allowed or any(_is_within(candidate, base) for base in allowed))
                and (candidate / "patient-index.json").is_file()
            ),
            None,
        )
        if folder is None:
            raise ValueError(
                "Hồ sơ này chưa có patient-index.json nên chưa đổi được tên timeline."
            )
        manifest = dcom_pipeline._read_patient_manifest(folder)
        if manifest is None:
            raise ValueError("Không đọc được patient-index.json của hồ sơ này.")
        recorded_id = str(manifest.get("patientId") or "").strip()
        wanted_id = str(expected_patient_id or "").strip()
        if wanted_id and recorded_id and wanted_id != recorded_id:
            raise ValueError(
                f"Từ chối ghi: hồ sơ trên màn hình là {wanted_id} nhưng thư mục "
                f"{folder.name} thuộc bệnh nhân {recorded_id}."
            )

        raw_labels = manifest.get("timelineLabels")
        labels = dict(raw_labels) if isinstance(raw_labels, dict) else {}
        if label:
            labels[key] = label
        else:
            labels.pop(key, None)
        if labels:
            manifest["timelineLabels"] = labels
        else:
            manifest.pop("timelineLabels", None)
        dcom_pipeline._write_patient_manifest(folder, manifest)

        patient = ArchiveCatalog._patient_block(manifest)
        with target._lock:
            if str(target._patient.get("patientId") or "") == recorded_id:
                target._patient = dict(patient)
        return {"patient": patient, "timelineKey": key, "label": label}

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
                custom_username=payload.get("customUsername") or payload.get("username"),
                custom_password=payload.get("customPassword") or payload.get("password"),
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

    def start_series_discovery(self, payload: dict) -> dict:
        studies = payload.get("studies")
        direct_url = str(payload.get("url") or "").strip()
        show_browser = bool(payload.get("showBrowser"))
        hospital = str(payload.get("hospital") or "").strip().lower()

        if not (isinstance(studies, list) and studies) and not direct_url:
            raise ValueError("Hãy chọn ca chụp hoặc nhập link viewer trước khi quét series.")
        if direct_url:
            parsed = urlparse(direct_url)
            if parsed.scheme not in {"http", "https"} or not parsed.netloc:
                raise ValueError("Link viewer không hợp lệ.")

        def target() -> dict:
            groups = []
            if isinstance(studies, list) and studies:
                for index, study in enumerate(studies, 1):
                    if self.job.stop_event.is_set():
                        break
                    study_uid = str(study.get("study_uid") or "").strip()
                    if not study_uid:
                        raise ValueError("Có ca chụp thiếu StudyInstanceUID.")
                    self.job.log(
                        f"[{index}/{len(studies)}] Đang đọc series ngày "
                        f"{study.get('date') or '?'} - {study.get('desc') or study_uid}..."
                    )
                    viewer_url = dcom_pipeline._viewer_url_for_study(
                        study, hospital or str(study.get("hospital_key") or ""),
                        self.job.log, not show_browser,
                        custom_username=payload.get("customUsername") or payload.get("username"),
                        custom_password=payload.get("customPassword") or payload.get("password"),
                    )
                    inventory = dcom_pipeline.discover_viewer_series(
                        viewer_url,
                        log=self.job.log,
                        headless=not show_browser,
                        should_stop=self.job.stop_event.is_set,
                    )
                    # The RIS identity is written last on purpose. The viewer
                    # manifest carries its own studyUid/studyDate/studyDescription
                    # and used to overwrite these: a viewer that reports no study
                    # UID left the group keyed by "", so the series it returned
                    # matched no study, the download button stayed off and the
                    # attachments were filed under an empty uid.
                    groups.append({
                        **inventory,
                        "studyUid": study_uid,
                        "studyDate": study.get("date") or inventory.get("studyDate") or "",
                        "studyDescription": (
                            study.get("desc") or inventory.get("studyDescription") or ""
                        ),
                        "viewerStudyUid": str(inventory.get("studyUid") or ""),
                    })
            else:
                inventory = dcom_pipeline.discover_viewer_series(
                    direct_url,
                    log=self.job.log,
                    headless=not show_browser,
                    should_stop=self.job.stop_event.is_set,
                )
                # A viewer link has no RIS row, so its own date and description
                # are all there is; only the key has to stay "direct", which is
                # what the UI reads the selected series back from.
                groups.append({
                    **inventory,
                    "studyUid": "direct",
                    "studyDate": inventory.get("studyDate") or "",
                    "studyDescription": inventory.get("studyDescription") or "Link viewer",
                    "viewerStudyUid": str(inventory.get("studyUid") or ""),
                })
            return {"groups": groups}

        self.job.start("series-discovery", target)
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
        download_all_files = bool(payload.get("downloadAllFiles", True))
        series_selections = payload.get("seriesSelections")
        if not download_all_files:
            if not isinstance(series_selections, dict):
                raise ValueError("Chưa quét và chọn series cần tải.")
            normalised_selections = {
                str(uid): [str(value) for value in values if str(value).strip()]
                for uid, values in series_selections.items()
                if isinstance(values, list)
            }
            # Compare on the trimmed uid but keep the keys the pipeline looks
            # each study up by. Skipping a study without a word is not an option
            # here: the doctor would believe a date had been downloaded.
            trimmed_selections = {
                key.strip(): value for key, value in normalised_selections.items()
            }
            for study in studies:
                uid = str(study.get("study_uid") or "").strip()
                if not trimmed_selections.get(uid):
                    label = " · ".join(
                        str(study.get(key)) for key in ("modality", "date") if study.get(key)
                    )
                    # The date reads like the study list the user was looking at;
                    # the uid keeps the message traceable in a log.
                    name = f"{label} ({uid})" if label and uid else (label or uid or "?")
                    raise ValueError(f"Ca {name} chưa có series nào được chọn.")
        else:
            normalised_selections = None
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
                selected_series_by_study=normalised_selections,
                custom_username=payload.get("customUsername") or payload.get("username"),
                custom_password=payload.get("customPassword") or payload.get("password"),
                download_attachments_flag=bool(payload.get("downloadAttachments", True)),
                attachments_by_study=payload.get("attachmentsByStudy"),
            )
            patient_folder, _manifest = dcom_pipeline.find_patient_archive(
                output_root, patient_id, hospital,
            )
            if patient_folder is None:
                raise ValueError("Không tìm thấy folder bệnh nhân sau khi tải.")
            archive = self.catalog.open(patient_folder)
            session = self.sessions.create_session_from_catalog(
                self.catalog,
                folder=str(patient_folder),
            )
            self.history.add(patient_folder)
            patient = dcom_pipeline.patient_archive_status(
                output_root,
                patient_id=patient_id,
                patient_name=patient_name,
                hospital_key=hospital,
                hospital_name=hospital_name,
                studies=all_studies,
            )
            requested_uids = {str(study.get("study_uid") or "") for study in studies}
            requested_rows = [
                study for study in all_studies
                if str(study.get("study_uid") or "") in requested_uids
            ]
            local_statuses = {str(study.get("local_status") or "") for study in requested_rows}
            if self.job.stop_event.is_set():
                result_status = "cancelled"
            elif requested_rows and local_statuses.issubset({"downloaded", "selected"}):
                result_status = "complete"
            elif local_statuses & {"downloaded", "selected", "incomplete"}:
                result_status = "partial"
            else:
                result_status = "failed"
            return {
                "status": result_status,
                "cancelled": result_status == "cancelled",
                "downloaded": total,
                "archive": archive,
                "sessionId": session.session_id,
                "patient": patient,
                "patientFolder": str(patient_folder),
                "studies": all_studies,
            }

        self.job.start("download", target)
        return self.job.snapshot()

    def _direct_download_root(self, output_root: Path, url: str, resume: bool) -> tuple[Path, bool]:
        """Pick the folder a direct link downloads into.

        A retry must merge into the folder the first attempt created. We find the
        previous attempt by searching the history for the same URL.
        """
        output_root = Path(output_root).expanduser()
        resolved_output_root = output_root.resolve()
        link_token = hashlib.sha256(url.encode("utf-8")).hexdigest()[:8]
        if resume:
            for entry in self.history.snapshot():
                if entry.get("url") == url:
                    folder = Path(entry["folder"]).expanduser()
                    resolved_folder = folder.resolve()
                    try:
                        resolved_folder.relative_to(resolved_output_root)
                    except ValueError:
                        continue
                    if folder.is_dir():
                        return folder, True

            marked: list[Path] = []
            try:
                children = [item for item in output_root.iterdir() if item.is_dir()]
            except OSError:
                children = []
            for item in children:
                marker = item / DIRECT_DOWNLOAD_META_NAME
                try:
                    data = json.loads(marker.read_text(encoding="utf-8"))
                except (OSError, ValueError, TypeError):
                    continue
                if data.get("linkHash") == link_token:
                    marked.append(item)
            if marked:
                marked.sort(key=lambda item: item.stat().st_mtime)
                return marked[-1], True

            # Compatibility fallback for folders created before patient naming.
            existing = sorted(
                (item for item in output_root.glob(f"LINK_*_{link_token}") if item.is_dir()),
                key=lambda item: item.name,
            )
            if existing:
                return existing[-1], True

        stamp = time.strftime("%Y%m%d_%H%M%S")
        return output_root / f"LINK_{stamp}_{link_token}", False

    def _write_direct_download_marker(self, folder: Path, url: str) -> None:
        marker = Path(folder) / DIRECT_DOWNLOAD_META_NAME
        temporary = marker.with_suffix(marker.suffix + ".tmp")
        payload = {
            "format": "dcom-direct-download-v1",
            "url": url,
            "downloadUrl": url,
            "linkHash": hashlib.sha256(url.encode("utf-8")).hexdigest()[:8],
            "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        }
        try:
            temporary.write_text(
                json.dumps(payload, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            temporary.replace(marker)
        except OSError as exc:
            self.job.log(f"Không thể ghi metadata tải tiếp: {exc}")

    def start_direct_download(self, payload: dict) -> dict:
        url = str(payload.get("url") or "").strip()
        parsed = urlparse(url)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            raise ValueError("Link viewer không hợp lệ.")
        output_root = Path(str(payload.get("outputRoot") or self.output_root)).expanduser().resolve()
        output_root.mkdir(parents=True, exist_ok=True)
        requested_resume = bool(payload.get("resume"))
        download_all_files = bool(payload.get("downloadAllFiles", True))
        selected_series_ids = payload.get("selectedSeriesIds")
        if not download_all_files:
            if not isinstance(selected_series_ids, list):
                raise ValueError("Chưa quét và chọn series cần tải.")
            selected_series_ids = [str(value) for value in selected_series_ids if str(value).strip()]
            if not selected_series_ids:
                raise ValueError("Hãy chọn ít nhất một series cần tải.")
        else:
            selected_series_ids = None

        raw_manual_info = payload.get("manualInfo")
        manual_info = None
        if isinstance(raw_manual_info, dict):
            manual_info = {
                "patientName": str(raw_manual_info.get("patientName") or "").strip(),
                "patientId": str(raw_manual_info.get("patientId") or "").strip(),
                "patientDob": str(raw_manual_info.get("patientDob") or "").strip(),
            }

        def target() -> dict:
            direct_root, resumed = self._direct_download_root(output_root, url, requested_resume)
            if requested_resume and not resumed:
                self.job.log(
                    "Không tìm thấy folder cũ của link này; sẽ tải mới vào folder riêng."
                )
            dl, _, jpg_dir = dcom_pipeline.run_pipeline(
                url=url,
                out_base=direct_root,
                log=self.job.log,
                headless=not bool(payload.get("showBrowser")),
                quality=max(70, min(int(payload.get("quality", 100)), 100)),
                save_png=bool(payload.get("savePng")),
                contrast_mode=str(payload.get("contrastMode") or dcom_pipeline.CLINICAL),
                should_stop=self.job.stop_event.is_set,
                resume=resumed,
                selected_series_ids=selected_series_ids,
                manual_info=manual_info,
                download_attachments_flag=bool(payload.get("downloadAttachments", True)),
                attachments=payload.get("attachments"),
            )
            jpg_dir = Path(jpg_dir)
            if jpg_dir.parent.is_dir():
                direct_root = jpg_dir.parent

            dl_status = getattr(dl, "status", "failed") if dl is not None else "failed"
            if dl and dl.total() <= 0 and dl_status != "cancelled":
                raise ValueError("Không tải được ảnh nào từ link viewer này. Vui lòng kiểm tra lại xem link có bị hết hạn hay không.")

            archive = None
            if dl_status not in {"rendered_only", "cancelled"}:
                archive = self.catalog.open(jpg_dir if Path(jpg_dir).exists() else direct_root)
            session_id = ""
            if archive:
                session = self.sessions.create_session_from_catalog(
                    self.catalog,
                    folder=str(direct_root),
                )
                session_id = session.session_id
            # The link is stored with the folder so a later retry from history
            # can reuse it. We use the updated direct_root.
            self._write_direct_download_marker(direct_root, url)
            self.history.add(direct_root, url)
            return {
                "status": dl_status,
                "cancelled": dl_status == "cancelled",
                "download": {
                    "dicom": getattr(dl, "dicom", 0),
                    "jpg": getattr(dl, "jpg", 0),
                    "png": getattr(dl, "png", 0),
                    "expected": getattr(dl, "expected", 0),
                    "failed": getattr(dl, "failed", 0),
                },
                "archive": archive,
                "sessionId": session_id,
                "output": str(direct_root),
                "resumed": resumed,
            }

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

    def get_annotations(self, series_id: str, catalog: Optional[ArchiveCatalog] = None) -> dict:
        target_catalog = catalog or self.catalog
        record = target_catalog.get(series_id)
        path = self._annotations_path(record)
        if not path.is_file():
            return {"version": 1, "annotations": []}
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            return {"version": 1, "annotations": []}
        return data if isinstance(data, dict) else {"version": 1, "annotations": []}

    def save_annotations(self, series_id: str, value: dict, catalog: Optional[ArchiveCatalog] = None) -> dict:
        target_catalog = catalog or self.catalog
        record = target_catalog.get(series_id)
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

    def get_text_content(
        self,
        series_id: str,
        index: int = 0,
        catalog: Optional[ArchiveCatalog] = None,
    ) -> dict:
        """Contents of one text or JSON file in a series, for the text viewer.

        JSON is returned re-indented so a minified manifest is readable, but
        only when it actually parses: a malformed file is shown byte-for-byte
        rather than swallowed, because the reason someone opens it is usually
        to find out what is wrong with it.
        """
        record = (catalog or self.catalog).get(series_id)
        files = record.images
        if not files:
            raise ValueError("Series không có file nào.")
        position = max(0, min(int(index or 0), len(files) - 1))
        path = files[position]
        if path.suffix.casefold() not in TEXT_EXTENSIONS:
            raise ValueError(f"File {path.name} không phải văn bản.")
        size = path.stat().st_size
        if size > TEXT_MAX_BYTES:
            raise ValueError(
                f"File {path.name} nặng {_format_file_size(size)}, "
                f"vượt giới hạn {_format_file_size(TEXT_MAX_BYTES)} của trình xem văn bản."
            )
        # Reports written by Vietnamese hospital systems are frequently CP1258
        # or CP1252 rather than UTF-8; a hard decode error would show nothing
        # at all, so the bytes are kept with replacement characters instead.
        raw = path.read_bytes()
        try:
            text = raw.decode("utf-8")
        except UnicodeDecodeError:
            text = raw.decode("utf-8", errors="replace")
        language = "text"
        if path.suffix.casefold() == ".json":
            try:
                text = json.dumps(json.loads(text), ensure_ascii=False, indent=2)
                language = "json"
            except ValueError:
                # Left as-is: an unparseable .json is exactly what the reader
                # needs to see verbatim.
                pass
        return {
            "name": path.name,
            "path": str(path),
            "language": language,
            "sizeBytes": size,
            "index": position,
            "count": len(files),
            "text": text,
        }

    def get_file_info(self, series_id: str, slice_index: int = 0, catalog: Optional[ArchiveCatalog] = None) -> dict:
        import pydicom
        from PIL import Image

        target_catalog = catalog or self.catalog
        record = target_catalog.get(series_id)
        images = record.images
        if not images:
            raise ValueError("Series không có file ảnh nào.")
        index = max(0, min(int(slice_index or 0), len(images) - 1))
        file_path = images[index]
        manifest = record.manifest or {}

        try:
            stat = file_path.stat()
            file_size = stat.st_size
            file_mtime = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(stat.st_mtime))
        except OSError:
            file_size = 0
            file_mtime = ""

        if file_size >= 1024 * 1024:
            size_formatted = f"{file_size / (1024 * 1024):.2f} MB"
        elif file_size >= 1024:
            size_formatted = f"{file_size / 1024:.1f} KB"
        else:
            size_formatted = f"{file_size} B"

        file_info = {
            "fileName": file_path.name,
            "filePath": str(file_path),
            "fileSize": file_size,
            "fileSizeFormatted": size_formatted,
            "modifiedAt": file_mtime,
            "sliceIndex": index,
            "sliceIndexDisplay": f"{index + 1}/{len(images)}",
            "totalSlices": len(images),
            "sourceType": record.source_type,
            "format": "DICOM" if record.source_type == "dicom" else file_path.suffix.lstrip(".").upper(),
        }

        download_url = str(
            manifest.get("downloadUrl")
            or manifest.get("download_url")
            or manifest.get("viewerUrl")
            or manifest.get("viewer_url")
            or ""
        ).strip()
        patient_code = str(manifest.get("patientCode") or manifest.get("patient_id") or manifest.get("patientId") or "").strip()
        accession_no = str(manifest.get("accessionNumber") or manifest.get("accession_number") or "").strip()
        hospital_key = str(manifest.get("hospitalKey") or manifest.get("hospital_key") or "").strip()
        hospital_name = str(manifest.get("hospitalName") or manifest.get("hospital_name") or dcom_pipeline.HOSPITALS.get(hospital_key, {}).get("name", "")).strip()

        provenance = {
            "downloadUrl": download_url,
            "viewerUrl": download_url,
            "patientCode": patient_code,
            "accessionNumber": accession_no,
            "hospitalKey": hospital_key,
            "hospitalName": hospital_name,
            "downloadType": manifest.get("downloadType", "direct" if not hospital_key else "ris"),
            "downloadedAt": manifest.get("downloadedAt", ""),
        }

        demographics = {
            "patientName": manifest.get("patient_name") or manifest.get("patientName") or "",
            "patientId": manifest.get("patient_id") or manifest.get("patientId") or "",
            "patientBirthDate": manifest.get("patient_birth_date") or manifest.get("patientBirthDate") or "",
            "patientSex": manifest.get("patient_sex") or manifest.get("patientSex") or "",
            "patientAge": manifest.get("patient_age") or manifest.get("patientAge") or "",
        }

        study = {
            "studyUid": manifest.get("study_instance_uid") or manifest.get("studyUid") or "",
            "studyDate": manifest.get("study_date") or manifest.get("studyDate") or record.study_date,
            "studyDescription": manifest.get("study_description") or manifest.get("studyDescription") or record.study_group,
            "modality": record.modality,
            "accessionNumber": accession_no,
        }

        series = {
            "seriesId": record.series_id,
            "seriesUid": manifest.get("series_instance_uid") or manifest.get("seriesUid") or record.series_id,
            "seriesNumber": manifest.get("series_number") or manifest.get("seriesNumber") or "",
            "seriesDescription": manifest.get("series_description") or manifest.get("seriesDescription") or record.name,
            "rows": manifest.get("rows"),
            "columns": manifest.get("columns"),
            "sliceCount": len(images),
            "pixelSpacing": manifest.get("pixel_spacing"),
            "sliceSpacing": manifest.get("slice_spacing"),
            "sliceThickness": manifest.get("slice_thickness") or manifest.get("sliceThickness"),
            "orientation": manifest.get("image_orientation_patient"),
            "frameOfReferenceUid": manifest.get("frame_of_reference_uid") or "",
            "photometric": manifest.get("photometric", ""),
            "windowCenter": manifest.get("window_center") or manifest.get("windowCenter"),
            "windowWidth": manifest.get("window_width") or manifest.get("windowWidth"),
        }

        dicom_tags: list[dict] = []
        if record.source_type == "dicom" or file_path.suffix.casefold() in {".dcm", ".dicom", ".ima"}:
            try:
                ds = pydicom.dcmread(str(file_path), force=True, stop_before_pixels=True)
                for elem in ds:
                    if elem.tag == 0x7FE00010:  # Skip raw PixelData
                        continue
                    tag_str = f"({elem.tag.group:04X},{elem.tag.element:04X})"
                    val_str = ""
                    try:
                        val_str = str(elem.value)
                        if len(val_str) > 300:
                            val_str = val_str[:300] + "…"
                    except Exception:
                        val_str = "<unreadable>"
                    dicom_tags.append({
                        "tag": tag_str,
                        "vr": str(elem.VR or ""),
                        "name": str(elem.name or ""),
                        "value": val_str,
                    })
            except Exception as exc:
                dicom_tags.append({
                    "tag": "(ERROR)",
                    "vr": "",
                    "name": "Lỗi đọc thẻ DICOM",
                    "value": str(exc),
                })
        else:
            try:
                with Image.open(file_path) as img:
                    dicom_tags.append({"tag": "(IMAGE,0001)", "vr": "CS", "name": "Image Format", "value": str(img.format)})
                    dicom_tags.append({"tag": "(IMAGE,0002)", "vr": "CS", "name": "Color Mode", "value": str(img.mode)})
                    dicom_tags.append({"tag": "(IMAGE,0003)", "vr": "IS", "name": "Width (Columns)", "value": str(img.width)})
                    dicom_tags.append({"tag": "(IMAGE,0004)", "vr": "IS", "name": "Height (Rows)", "value": str(img.height)})
                    if series.get("rows") is None:
                        series["rows"] = img.height
                        series["columns"] = img.width
            except Exception:
                pass

        return {
            "file": file_info,
            "provenance": provenance,
            "demographics": demographics,
            "study": study,
            "series": series,
            "dicomTags": dicom_tags,
        }


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
                    "img-src 'self' blob: data:; media-src 'self' blob:; worker-src 'self' blob:; connect-src 'self'; "
                    # Scanned records are PDFs and the reader embeds them. Only
                    # blobs this origin already fetched are allowed, so nothing
                    # external can be plugged in.
                    "object-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'",
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

            def _send_file(
                self,
                target: Path,
                content_type: str,
                extra: Optional[dict[str, str]] = None,
            ) -> None:
                """Serve a file from disk, honouring `Range`, a chunk at a time.

                Video was previously read whole into memory and handed over in
                one write, so a surgical clip had to finish downloading before
                it would play and could not be seeked at all. Answering ranges
                lets the player ask only for the part it is about to show.
                """
                size = target.stat().st_size
                start, end = 0, max(size - 1, 0)
                status = HTTPStatus.OK
                requested = self.headers.get("Range", "").strip()
                match = re.fullmatch(r"bytes=(\d*)-(\d*)", requested) if requested else None
                if match and size:
                    first, last = match.group(1), match.group(2)
                    if first:
                        start = int(first)
                        if last:
                            end = min(int(last), size - 1)
                    elif last:
                        start = max(size - int(last), 0)
                    else:
                        match = None
                    if match and (start >= size or start > end):
                        self.send_response(HTTPStatus.REQUESTED_RANGE_NOT_SATISFIABLE)
                        self._headers(content_type, 0, {"Content-Range": f"bytes */{size}"})
                        try:
                            self.end_headers()
                        except (BrokenPipeError, ConnectionAbortedError, ConnectionResetError):
                            pass
                        return
                    if match:
                        status = HTTPStatus.PARTIAL_CONTENT
                length = (end - start + 1) if size else 0
                headers = {"Accept-Ranges": "bytes", **(extra or {})}
                if status == HTTPStatus.PARTIAL_CONTENT:
                    headers["Content-Range"] = f"bytes {start}-{end}/{size}"
                self.send_response(status)
                self._headers(content_type, length, headers)
                try:
                    self.end_headers()
                    with target.open("rb") as handle:
                        handle.seek(start)
                        remaining = length
                        while remaining > 0:
                            chunk = handle.read(min(MEDIA_CHUNK_BYTES, remaining))
                            if not chunk:
                                break
                            self.wfile.write(chunk)
                            remaining -= len(chunk)
                except (BrokenPipeError, ConnectionAbortedError, ConnectionResetError):
                    # The player abandons a range the moment the viewer seeks
                    # somewhere else. There is no client left to answer.
                    return

            def _json(self, status: int, value: Any) -> None:
                self._send(status, _json_bytes(value), "application/json; charset=utf-8")

            def _authorized(self, *, allow_query_token: bool = False) -> bool:
                host = self.headers.get("Host", "")
                if host not in {f"127.0.0.1:{owner.port}", f"localhost:{owner.port}"}:
                    return False
                origin = self.headers.get("Origin")
                if origin and origin not in {
                    f"http://127.0.0.1:{owner.port}",
                    f"http://localhost:{owner.port}",
                }:
                    return False
                if _token_matches(self.headers.get("X-DCom-Token", ""), owner.token):
                    return True
                if not allow_query_token:
                    return False
                from urllib.parse import parse_qs
                supplied = parse_qs(urlparse(self.path).query).get("token", [""])[0]
                return _token_matches(supplied, owner.token)

            def _get_session_id(self) -> Optional[str]:
                parsed = urlparse(self.path)
                if parsed.query:
                    from urllib.parse import parse_qs
                    qs = parse_qs(parsed.query)
                    if "session" in qs and qs["session"]:
                        return qs["session"][0]
                return self.headers.get("X-Viewer-Session") or None

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

            def _get_allowed_roots(self, catalog) -> list[Path]:
                roots = [MEDIA_WORK_ROOT.resolve()]
                if catalog and catalog.root:
                    roots.append(Path(catalog.root).resolve())
                if owner.controller.output_root:
                    roots.append(Path(owner.controller.output_root).resolve())
                return roots

            def _resolve_media_path(self, path_str: str, catalog) -> Path:
                if not path_str:
                    raise ValueError("Đường dẫn file không được để trống.")
                path = Path(path_str).resolve()
                allowed = self._get_allowed_roots(catalog)
                if not any(self._is_relative_to(path, r) for r in allowed):
                    raise PermissionError(f"Truy cập bị từ chối: Đường dẫn nằm ngoài phạm vi cho phép ({path_str})")
                if not path.exists():
                    raise FileNotFoundError(f"Không tìm thấy file: {path_str}")
                return path

            def _is_relative_to(self, path: Path, root: Path) -> bool:
                try:
                    path.relative_to(root)
                    return True
                except ValueError:
                    return False

            def _new_media_work_path(self, suffix: str) -> Path:
                MEDIA_WORK_ROOT.mkdir(parents=True, exist_ok=True)
                return MEDIA_WORK_ROOT / f"{uuid.uuid4().hex}{suffix}"

            def _serve_work_file(self, path: str, query: str) -> bool:
                if not path.startswith("/api/media/work-file"):
                    return False
                from urllib.parse import parse_qs
                qs = parse_qs(query)
                filename = qs.get("name", [""])[0] or qs.get("path", [""])[0]
                if not filename:
                    raise ValueError("Thiếu tham số tên file work.")
                safe_name = Path(filename).name
                target = (MEDIA_WORK_ROOT / safe_name).resolve()
                if not self._is_relative_to(target, MEDIA_WORK_ROOT.resolve()) or not target.is_file():
                    raise FileNotFoundError("Không tìm thấy file kết quả.")
                ext = target.suffix.lower()
                content_type = MIME_TYPES.get(ext, "application/octet-stream")
                self._send_file(target, content_type, {"Cache-Control": "no-cache"})
                return True

            def _api_get(self, path: str, query: str = "") -> Any:
                session_id = self._get_session_id()
                catalog = owner.controller.sessions.get_catalog(session_id)
                if path == "/api/bootstrap":
                    return owner.controller.bootstrap(session_id=session_id)
                if path == "/api/archive":
                    return catalog.snapshot()
                if path == "/api/job":
                    return owner.controller.job.snapshot()
                if path == "/api/history":
                    return {"history": owner.controller.history_snapshot()}
                if path == "/api/worklist":
                    return owner.controller.get_worklist()
                if path == "/api/source-folders":
                    return {"sourceFolders": owner.controller.get_source_folders()}
                if path == "/api/sessions":
                    return {"sessions": owner.controller.sessions.list_sessions()}
                if path == "/api/media/video/status":
                    import video_engine as ve
                    return {"stats": ve.concurrency_stats()}
                if path == "/api/media/video/encoders":
                    import video_engine as ve
                    return {"encoders": ve.detect_hw_encoders()}
                match = re.fullmatch(r"/api/series/([a-f0-9]{20})/manifest", path)
                if match:
                    record = catalog.get(match.group(1))
                    if not record.manifest:
                        raise ValueError(
                            record.mpr_reason
                            or "Series không có dữ liệu geometry."
                        )
                    return record.manifest
                match = re.fullmatch(r"/api/series/([a-f0-9]{20})/annotations", path)
                if match:
                    return owner.controller.get_annotations(match.group(1), catalog=catalog)
                match = re.fullmatch(r"/api/series/([a-f0-9]{20})/file-paths", path)
                if match:
                    record = catalog.get(match.group(1))
                    return {"images": [str(p) for p in record.images]}
                match = re.fullmatch(r"/api/series/([a-f0-9]{20})/file-info", path)
                if match:
                    index = 0
                    if query:
                        from urllib.parse import parse_qs
                        qs = parse_qs(query)
                        if "index" in qs and qs["index"] and qs["index"][0].isdigit():
                            index = int(qs["index"][0])
                    return owner.controller.get_file_info(match.group(1), index, catalog=catalog)
                match = re.fullmatch(r"/api/series/([a-f0-9]{20})/text", path)
                if match:
                    index = 0
                    if query:
                        from urllib.parse import parse_qs
                        qs = parse_qs(query)
                        if "index" in qs and qs["index"] and qs["index"][0].isdigit():
                            index = int(qs["index"][0])
                    return owner.controller.get_text_content(match.group(1), index, catalog=catalog)
                raise KeyError("API không tồn tại.")

            def _api_post(self, path: str, payload: dict) -> Any:
                session_id = self._get_session_id()
                catalog = owner.controller.sessions.get_catalog(session_id)
                if path == "/api/sessions/create":
                    p = str(payload.get("path") or "")
                    sid = str(payload.get("sessionId") or "") or None
                    sess = owner.controller.sessions.create_session(
                        p, session_id=sid, on_opened=owner.controller.history.add,
                    )
                    return {"sessionId": sess.session_id, "archive": sess.catalog.snapshot()}
                if path == "/api/sessions/close":
                    sid = str(payload.get("sessionId") or "")
                    owner.controller.sessions.close_session(sid)
                    return {"closed": True, "sessionId": sid}
                if path == "/api/archive/open":
                    target_catalog = catalog if session_id else owner.controller.catalog
                    return target_catalog.open(str(payload.get("path") or ""))
                if path == "/api/archive/scan":
                    return owner.controller.start_archive_scan(
                        str(payload.get("path") or ""), catalog=catalog,
                    )
                if path == "/api/output":
                    return owner.controller.set_output_root(str(payload.get("path") or ""))
                if path == "/api/search":
                    return owner.controller.start_search(payload)
                if path == "/api/series/discover":
                    return owner.controller.start_series_discovery(payload)
                if path == "/api/download":
                    return owner.controller.start_download(payload)
                if path == "/api/download/direct":
                    return owner.controller.start_direct_download(payload)
                if path == "/api/job/stop":
                    return owner.controller.stop()
                if path == "/api/history/open":
                    return owner.controller.start_history_open(str(payload.get("folder") or ""))
                if path == "/api/media/save":
                    return owner.controller.save_media_edit(
                        str(payload.get("path") or ""),
                        str(payload.get("seriesId") or ""),
                        catalog=catalog,
                        media_index=_as_index(payload.get("mediaIndex")),
                    )
                if path == "/api/patient/diagnosis":
                    return owner.controller.set_patient_diagnosis(
                        str(payload.get("diagnosis") or ""),
                        archive_root=str(payload.get("archiveRoot") or ""),
                        expected_patient_id=str(payload.get("patientId") or ""),
                        catalog=catalog,
                    )
                if path == "/api/patient/update":
                    return owner.controller.update_patient_info(
                        payload.get("info") if isinstance(payload.get("info"), dict) else payload,
                        archive_root=str(payload.get("archiveRoot") or ""),
                        expected_patient_id=str(payload.get("patientId") or ""),
                        catalog=catalog,
                    )
                if path == "/api/patient/timeline-label":
                    return owner.controller.set_timeline_label(
                        str(payload.get("timelineKey") or ""),
                        str(payload.get("label") or ""),
                        archive_root=str(payload.get("archiveRoot") or ""),
                        expected_patient_id=str(payload.get("patientId") or ""),
                        catalog=catalog,
                    )
                if path == "/api/worklist/export-options":
                    return owner.controller.get_export_options(str(payload.get("folder") or ""))
                if path == "/api/worklist/export":
                    return owner.controller.start_portable_export(
                        str(payload.get("folder") or ""),
                        str(payload.get("destination") or ""),
                        mode=str(payload.get("mode") or "viewer"),
                    )
                if path == "/api/worklist/read":
                    return owner.controller.set_study_read(
                        str(payload.get("folder") or ""),
                        bool(payload.get("read")),
                    )
                if path == "/api/study/verify-integrity":
                    return owner.controller.verify_study_integrity(str(payload.get("folder") or ""))
                if path == "/api/study/mark-complete":
                    return owner.controller.mark_study_complete(
                        str(payload.get("folder") or ""),
                        bool(payload.get("complete", True)),
                    )
                if path == "/api/worklist/reveal-folder":
                    return owner.controller.reveal_folder(str(payload.get("folder") or ""))
                if path == "/api/source-folders/add":
                    return owner.controller.add_source_folder(str(payload.get("folder") or ""))
                if path == "/api/source-folders/remove":
                    return owner.controller.remove_source_folder(str(payload.get("folder") or ""))
                if path == "/api/settings/language":
                    return owner.controller.set_language(str(payload.get("language") or ""))
                if path == "/api/media/photo/info":
                    import photo_engine as pe
                    src = self._resolve_media_path(payload.get("path"), catalog)
                    info = pe.probe(src)
                    return {"info": {"width": info.width, "height": info.height, "format": info.format, "mode": info.mode, "sizeBytes": info.size_bytes}}
                if path == "/api/media/photo/rotate":
                    import photo_engine as pe
                    src = self._resolve_media_path(payload.get("path"), catalog)
                    out = self._new_media_work_path(src.suffix or ".jpg")
                    pe.rotate(src, out, int(payload.get("degrees", 90)))
                    return {"outputPath": str(out), "url": f"/api/media/work-file?name={out.name}"}
                if path == "/api/media/photo/crop":
                    import photo_engine as pe
                    src = self._resolve_media_path(payload.get("path"), catalog)
                    out = self._new_media_work_path(src.suffix or ".jpg")
                    r = payload.get("rect", {})
                    pe.crop(src, out, pe.Rect(x=r.get("x", 0), y=r.get("y", 0), width=r.get("width", 0), height=r.get("height", 0)))
                    return {"outputPath": str(out), "url": f"/api/media/work-file?name={out.name}"}
                if path == "/api/media/photo/redact":
                    import photo_engine as pe
                    src = self._resolve_media_path(payload.get("path"), catalog)
                    out = self._new_media_work_path(src.suffix or ".jpg")
                    regions = [pe.Rect(x=r.get("x", 0), y=r.get("y", 0), width=r.get("width", 0), height=r.get("height", 0)) for r in payload.get("regions", [])]
                    fill = tuple(payload.get("fill", (0, 0, 0)))
                    pe.redact(src, out, regions, fill=fill)
                    return {"outputPath": str(out), "url": f"/api/media/work-file?name={out.name}"}
                if path == "/api/media/photo/annotate":
                    import photo_engine as pe
                    src = self._resolve_media_path(payload.get("path"), catalog)
                    out = self._new_media_work_path(src.suffix or ".jpg")
                    # The client writes camelCase and the dataclasses are
                    # snake_case; passing the payload straight through raised
                    # TypeError on every text annotation ever attempted.
                    texts = [pe.TextAnnotation(**_snake_keys(t)) for t in payload.get("texts", [])]
                    arrows = [pe.ArrowAnnotation(**_snake_keys(a)) for a in payload.get("arrows", [])]
                    boxes = [pe.BoxAnnotation(rect=pe.Rect(**b["rect"]), color=tuple(b.get("color", (255, 70, 70))), width=b.get("width", 3)) for b in payload.get("boxes", [])]
                    pe.annotate(src, out, texts=texts, arrows=arrows, boxes=boxes)
                    return {"outputPath": str(out), "url": f"/api/media/work-file?name={out.name}"}
                if path == "/api/media/photo/shapes":
                    # The whole drawing layer in one call: the file is decoded,
                    # painted and re-encoded exactly once no matter how many
                    # arrows, notes and redactions the reader placed.
                    import photo_engine as pe
                    src = self._resolve_media_path(payload.get("path"), catalog)
                    out = self._new_media_work_path(src.suffix or ".jpg")
                    pe.draw_shapes(src, out, payload.get("shapes", []),
                                   quality=int(payload.get("quality", 92)))
                    return {"outputPath": str(out), "url": f"/api/media/work-file?name={out.name}"}
                if path == "/api/media/photo/export-pdf":
                    import photo_engine as pe
                    sources_in = payload.get("sources", [])
                    resolved_sources = []
                    for s in sources_in:
                        if re.fullmatch(r"[a-f0-9]{20}", str(s)):
                            rec = catalog.get(str(s))
                            if rec and rec.images:
                                resolved_sources.extend(rec.images)
                        else:
                            resolved_sources.append(self._resolve_media_path(s, catalog))
                    if not resolved_sources and payload.get("seriesId"):
                        rec = catalog.get(str(payload.get("seriesId")))
                        if rec and rec.images:
                            resolved_sources.extend(rec.images)
                    if not resolved_sources:
                        raise ValueError("Cần ít nhất một ảnh hợp lệ để xuất PDF.")
                    out = self._new_media_work_path(".pdf")
                    pe.export_pdf(resolved_sources, out)
                    return {"outputPath": str(out), "url": f"/api/media/work-file?name={out.name}"}
                if path == "/api/media/video/info":
                    import video_engine as ve
                    src = self._resolve_media_path(payload.get("path"), catalog)
                    info = ve.probe(src)
                    return {"info": {"durationSeconds": info.duration_s, "width": info.width, "height": info.height, "fps": info.fps, "codec": info.codec, "formatName": info.format_name, "hasAudio": info.has_audio, "sizeBytes": info.size_bytes}}
                if path == "/api/media/video/thumbnail":
                    import video_engine as ve
                    src = self._resolve_media_path(payload.get("path"), catalog)
                    out = self._new_media_work_path(".jpg")
                    ve.extract_thumbnail(src, out, float(payload.get("atSeconds", 0.0)), int(payload.get("maxWidth", 320)))
                    return {"outputPath": str(out), "url": f"/api/media/work-file?name={out.name}"}
                if path == "/api/media/video/filmstrip":
                    import video_engine as ve
                    src = self._resolve_media_path(payload.get("path"), catalog)
                    out_dir = self._new_media_work_path("")
                    frames = ve.extract_filmstrip(src, out_dir, int(payload.get("count", 12)), int(payload.get("maxWidth", 160)))
                    return {"frames": [str(f) for f in frames]}
                if path == "/api/media/video/trim":
                    import video_engine as ve
                    src = self._resolve_media_path(payload.get("path"), catalog)
                    out = self._new_media_work_path(".mp4")
                    ve.trim(src, out, float(payload.get("startSeconds", 0.0)), float(payload.get("endSeconds", 0.0)), bool(payload.get("reencode", False)))
                    return {"outputPath": str(out), "url": f"/api/media/work-file?name={out.name}"}
                if path == "/api/media/video/concat":
                    import video_engine as ve
                    sources = [self._resolve_media_path(p, catalog) for p in payload.get("sources", [])]
                    out = self._new_media_work_path(".mp4")
                    ve.concat(sources, out, int(payload.get("targetHeight", 1080)), int(payload.get("targetFps", 30)))
                    return {"outputPath": str(out), "url": f"/api/media/work-file?name={out.name}"}
                if path == "/api/media/video/burn-text":
                    import video_engine as ve
                    src = self._resolve_media_path(payload.get("path"), catalog)
                    out = self._new_media_work_path(".mp4")
                    overlays = [ve.TextOverlay(**_snake_keys(o)) for o in payload.get("overlays", [])]
                    ve.burn_text(src, out, overlays)
                    return {"outputPath": str(out), "url": f"/api/media/work-file?name={out.name}"}
                if path == "/api/media/video/burn-overlay":
                    # The drawing the reader made over the player, rendered once
                    # at the clip's own resolution and composited by ffmpeg —
                    # rather than a drawtext filter per shape, which cannot draw
                    # an arrow or a freehand stroke at all.
                    import photo_engine as pe
                    import video_engine as ve
                    src = self._resolve_media_path(payload.get("path"), catalog)
                    info = ve.probe(src)
                    drawn, destructive = pe.split_destructive(payload.get("shapes", []))
                    start_s = payload.get("startSeconds")
                    end_s = payload.get("endSeconds")
                    overlay = None
                    if drawn:
                        overlay = self._new_media_work_path(".png")
                        pe.render_overlay_png(drawn, (info.width, info.height), overlay)
                    regions = [
                        ve.BlurRegion(
                            x=shape.x, y=shape.y, width=shape.width, height=shape.height,
                            mode="solid" if shape.kind == "redact" else "blur",
                            strength=max(2, shape.stroke_width * 3),
                            start_s=start_s, end_s=end_s,
                        )
                        for shape in destructive
                    ]
                    out = self._new_media_work_path(".mp4")
                    ve.burn_overlay(src, out, overlay_png=overlay,
                                    start_s=start_s, end_s=end_s, blur_regions=regions)
                    return {"outputPath": str(out), "url": f"/api/media/work-file?name={out.name}"}
                if path == "/api/media/video/transcode":
                    import video_engine as ve
                    src = self._resolve_media_path(payload.get("path"), catalog)
                    out = self._new_media_work_path(".mp4")
                    # Both spellings are accepted: the studio has always sent
                    # use_hw, so reading only useHw silently disabled hardware
                    # encoding for every transcode the app ever ran.
                    use_hw = payload.get("useHw", payload.get("use_hw", False))
                    ve.transcode(src, out, bool(use_hw), int(payload.get("crf", 20)))
                    return {"outputPath": str(out), "url": f"/api/media/work-file?name={out.name}"}
                match = re.fullmatch(r"/api/series/([a-f0-9]{20})/annotations", path)
                if match:
                    return owner.controller.save_annotations(match.group(1), payload, catalog=catalog)
                raise KeyError("API không tồn tại.")

            def _serve_thumbnail(self, path: str) -> bool:
                match = re.fullmatch(r"/api/series/([a-f0-9]{20})/thumbnail", path)
                if not match:
                    return False
                catalog = owner.controller.sessions.get_catalog(self._get_session_id())
                record = catalog.get(match.group(1))
                if not record.images:
                    raise IndexError("Series không có ảnh.")
                if record.thumbnail_bytes is None:
                    record.thumbnail_bytes = build_series_thumbnail(record)
                self._send(
                    HTTPStatus.OK,
                    record.thumbnail_bytes,
                    "image/jpeg",
                    # Patient imagery must not land in a shared proxy cache,
                    # and the token is not part of the URL that keys it.
                    {"Cache-Control": "private, max-age=86400"},
                )
                return True

            def _serve_image(self, path: str) -> bool:
                match = re.fullmatch(r"/api/series/([a-f0-9]{20})/image/(\d+)", path)
                if not match:
                    return False
                catalog = owner.controller.sessions.get_catalog(self._get_session_id())
                record = catalog.get(match.group(1))
                index = int(match.group(2))
                if not 0 <= index < len(record.images):
                    raise IndexError("Lát ảnh ngoài phạm vi.")
                image = record.images[index]
                if record.source_type == "dicom":
                    frame = record.frame_indices[index] if record.frame_indices else 0
                    body, headers = _dicom_pixel_payload(image, frame)
                    headers["Cache-Control"] = "private, max-age=86400"
                    self._send(
                        HTTPStatus.OK,
                        body,
                        "application/vnd.dcom.pixel-data",
                        headers,
                    )
                    return True
                mime = MIME_TYPES.get(image.suffix.casefold(), "application/octet-stream")
                self._send_file(image, mime, {"Cache-Control": "private, max-age=86400"})
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
                parsed_url = urlparse(self.path)
                path = parsed_url.path
                if path.startswith("/api/"):
                    if not self._authorized(allow_query_token=_allows_query_token(path)):
                        self._json(HTTPStatus.UNAUTHORIZED, {"error": "Không được phép."})
                        return
                    try:
                        if self._serve_thumbnail(path) or self._serve_image(path) or self._serve_work_file(path, parsed_url.query):
                            return
                        self._json(HTTPStatus.OK, self._api_get(path, parsed_url.query))
                    except KeyError as exc:
                        self._json(HTTPStatus.NOT_FOUND, {"error": str(exc)})
                    except FileNotFoundError as exc:
                        self._json(HTTPStatus.NOT_FOUND, {"error": str(exc)})
                    except PermissionError as exc:
                        self._json(HTTPStatus.FORBIDDEN, {"error": str(exc)})
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
                except FileNotFoundError as exc:
                    self._json(HTTPStatus.NOT_FOUND, {"error": str(exc)})
                except PermissionError as exc:
                    self._json(HTTPStatus.FORBIDDEN, {"error": str(exc)})
                except (ValueError, RuntimeError) as exc:
                    self._json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
                except Exception as exc:
                    import photo_engine as pe
                    import video_engine as ve
                    if isinstance(exc, (pe.ServerBusyError, ve.ServerBusyError)):
                        self._json(HTTPStatus.TOO_MANY_REQUESTS, {"error": str(exc)})
                    elif isinstance(exc, (pe.PhotoEngineError, ve.VideoEngineError)):
                        self._json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
                    else:
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

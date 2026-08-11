"""
Core MPR support for the DICOM downloader.

The normal JPG conversion remains available for every series.  This module
finds eligible high-resolution 3D T1 and CT volume series, converts each with
its own series-wide intensity window, and writes the geometry required to
reconstruct orthogonal MPR views.

No patient name or patient ID is written to the MPR manifest.
"""

from __future__ import annotations

import hashlib
import json
import math
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Iterable, Optional

import numpy as np

from dicom_io import discover_dicom_files


MANIFEST_NAME = "mpr-volume.json"
MANIFEST_FORMAT = "dcom-mpr-jpg"
MANIFEST_VERSION = 1
DEFAULT_MIN_SLICES = 101


def _text(value) -> str:
    return str(value or "").strip()


def _norm(value) -> str:
    text = _text(value).upper()
    text = text.replace("_", " ").replace("-", " ")
    return re.sub(r"\s+", " ", text).strip()


def _float_list(value, expected: int) -> Optional[tuple[float, ...]]:
    try:
        result = tuple(float(v) for v in value)
    except Exception:
        return None
    return result if len(result) == expected and all(math.isfinite(v) for v in result) else None


def _safe_name(value) -> str:
    text = _text(value) or "Unknown"
    text = re.sub(r'[\\/:*?"<>|]+', "_", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text[:80] or "Unknown"


def _series_uid_text(series_uid, series_number, description) -> str:
    return _text(series_uid) or f"fallback:{series_number}:{description}"


def series_folder_base_name(
    series_number,
    description,
    kind: Optional[str] = None,
) -> str:
    """Return the readable folder name for one DICOM series, with no UID token."""
    kind_token = {
        "T1_POST_CONTRAST": "T1_POST",
        "T1_PRE_CONTRAST": "T1_PRE",
        "CT_VOLUME": "CT_VOLUME",
    }.get(_text(kind), "")
    parts = [
        f"Series_{_safe_name(series_number)}",
        _safe_name(description),
    ]
    if kind_token:
        parts.append(kind_token)
    return "_".join(parts)


def series_folder_name(
    series_number,
    description,
    series_uid: str,
    kind: Optional[str] = None,
) -> str:
    """Return the readable series folder name without exposing a UID hash."""
    return series_folder_base_name(series_number, description, kind)


def _legacy_series_folder_name(
    series_number,
    description,
    series_uid: str,
    kind: Optional[str] = None,
) -> str:
    """Name written by older builds; retained only for resume compatibility."""
    uid_text = _series_uid_text(series_uid, series_number, description)
    uid_token = hashlib.sha1(uid_text.encode("utf-8")).hexdigest()[:10]
    return f"{series_folder_base_name(series_number, description, kind)}_{uid_token}"


class SeriesFolderNamer:
    """Hand out one folder name per series inside a single JPG directory.

    Names stay readable ("Series_3_Ax T2 FLAIR FS"); the UID token is appended
    only when a second, different series would collide with a name already
    taken. A folder written by an older build — which always carried the token
    — keeps its name so a resumed download merges into it instead of writing a
    second copy next to it.
    """

    def __init__(self, root: Path) -> None:
        self.root = Path(root)
        self._by_uid: dict[str, str] = {}
        self._claimed: set[str] = set()

    def name_for(
        self,
        series_number,
        description,
        series_uid: str,
        kind: Optional[str] = None,
    ) -> str:
        uid_text = _series_uid_text(series_uid, series_number, description)
        cached = self._by_uid.get(uid_text)
        if cached is not None:
            return cached
        plain = series_folder_base_name(series_number, description, kind)
        legacy = _legacy_series_folder_name(series_number, description, uid_text, kind)
        if (self.root / legacy).is_dir():
            chosen = legacy
        else:
            chosen = plain
            counter = 2
            while chosen.casefold() in self._claimed or (self.root / chosen).is_dir():
                chosen = f"{plain} ({counter})"
                counter += 1
        self._by_uid[uid_text] = chosen
        self._claimed.add(chosen.casefold())
        return chosen

    def name_for_candidate(self, candidate: "MprCandidate") -> str:
        return self.name_for(
            candidate.series_number,
            candidate.description,
            candidate.series_uid,
            candidate.kind,
        )


@dataclass(frozen=True)
class MprSlice:
    path: Path
    position: float
    image_position: tuple[float, float, float]
    sop_instance_uid: str
    instance_number: str


@dataclass
class MprCandidate:
    series_uid: str
    series_number: str
    description: str
    protocol_name: str
    sequence_name: str
    study_uid: str
    study_date: str
    study_time: str
    patient_id: str
    patient_name: str
    patient_birth_date: str
    frame_of_reference_uid: str
    rows: int
    columns: int
    pixel_spacing: tuple[float, float]
    orientation: tuple[float, float, float, float, float, float]
    slice_spacing: float
    slices: list[MprSlice]
    kind: str
    modality: str
    score: float
    reasons: list[str] = field(default_factory=list)

    @property
    def folder_name(self) -> str:
        return series_folder_name(
            self.series_number, self.description, self.series_uid, self.kind,
        )


@dataclass
class _Header:
    path: Path
    series_uid: str
    series_number: str
    description: str
    protocol_name: str
    sequence_name: str
    study_uid: str
    study_description: str
    study_date: str
    study_time: str
    patient_id: str
    patient_name: str
    patient_birth_date: str
    body_part: str
    frame_uid: str
    modality: str
    image_type: str
    rows: int
    columns: int
    pixel_spacing: Optional[tuple[float, float]]
    orientation: Optional[tuple[float, float, float, float, float, float]]
    image_position: Optional[tuple[float, float, float]]
    sop_uid: str
    instance_number: str
    contrast_agent: str


def _dicom_files(base: Path) -> list[Path]:
    return discover_dicom_files(Path(base))


def _read_header(path: Path) -> Optional[_Header]:
    import pydicom

    try:
        ds = pydicom.dcmread(str(path), stop_before_pixels=True, force=True)
    except Exception:
        return None

    rows = int(getattr(ds, "Rows", 0) or 0)
    columns = int(getattr(ds, "Columns", 0) or 0)
    if rows <= 0 or columns <= 0:
        return None

    uid = _text(getattr(ds, "SeriesInstanceUID", ""))
    if not uid:
        uid = f"fallback:{_text(getattr(ds, 'SeriesNumber', ''))}:{_text(getattr(ds, 'SeriesDescription', ''))}"

    image_type_value = getattr(ds, "ImageType", "")
    if isinstance(image_type_value, (list, tuple)):
        image_type = "\\".join(str(v) for v in image_type_value)
    else:
        image_type = _text(image_type_value)

    return _Header(
        path=path,
        series_uid=uid,
        series_number=_text(getattr(ds, "SeriesNumber", "NoSeries")),
        description=_text(getattr(ds, "SeriesDescription", "UnknownSeries")),
        protocol_name=_text(getattr(ds, "ProtocolName", "")),
        sequence_name=_text(getattr(ds, "SequenceName", "")),
        study_uid=_text(getattr(ds, "StudyInstanceUID", "")),
        study_description=_text(getattr(ds, "StudyDescription", "")),
        study_date=_format_date(_text(getattr(ds, "StudyDate", ""))),
        study_time=_format_time(_text(getattr(ds, "StudyTime", ""))),
        patient_id=_text(getattr(ds, "PatientID", "")),
        patient_name=_text(getattr(ds, "PatientName", "")),
        patient_birth_date=_format_date(_text(getattr(ds, "PatientBirthDate", ""))),
        body_part=_text(getattr(ds, "BodyPartExamined", "")),
        frame_uid=_text(getattr(ds, "FrameOfReferenceUID", "")),
        modality=_norm(getattr(ds, "Modality", "")),
        image_type=_norm(image_type),
        rows=rows,
        columns=columns,
        pixel_spacing=_float_list(getattr(ds, "PixelSpacing", None), 2),
        orientation=_float_list(getattr(ds, "ImageOrientationPatient", None), 6),
        image_position=_float_list(getattr(ds, "ImagePositionPatient", None), 3),
        sop_uid=_text(getattr(ds, "SOPInstanceUID", "")),
        instance_number=_text(getattr(ds, "InstanceNumber", "")),
        contrast_agent=_text(getattr(ds, "ContrastBolusAgent", "")),
    )


_T1_RE = re.compile(r"(^|[^A-Z0-9])T\s*1\s*W?([^A-Z0-9]|$)")
_POST_RE = re.compile(
    r"(\+\s*C\b|\bC\s*\+\b|\bPOST\b|\bPOSTCONTRAST\b|\bPOST CONTRAST\b|"
    r"\bCE\b|\bGAD\b|\bGADO\b|\bGD\b|\bGADOVIST\b|\bDOTAREM\b|\bPROHANCE\b|"
    r"\bMULTIHANCE\b|\bCONTRAST\b|\bENHANCED?\b|\bT1C\b|\bT1GD\b|"
    r"\bSAU TI[EÊ]M\b|\bC[OÓ] TI[EÊ]M\b|\bTI[EÊ]M\b)"
)
_PRE_RE = re.compile(
    r"(\bPRE\b|\bPRECONTRAST\b|\bPRE CONTRAST\b|\bNON CONTRAST\b|\bNO CONTRAST\b|"
    r"\bNATIVE\b|\bKH[OÔ]NG TI[EÊ]M\b|\bK TI[EÊ]M\b)"
)
_THREED_RE = re.compile(r"(\b3D\b|\bBRAVO\b|\bMPRAGE\b|\bSPGR\b|\bTFE\b|\bVIBE\b)")
_BRAIN_RE = re.compile(r"(\bBRAIN\b|\bHEAD\b|\bCRAN|\bNAO\b|\bSO NAO\b)")
_REJECT_RE = re.compile(
    r"(\bLOCALI[ZS]ER\b|\bSCOUT\b|\bKEY IMAGE\b|\bKEYIMAGE\b|\bSUBTRACTION\b|"
    r"\bSUBTRACT\b|\bREFORMAT\b|\bMIP\b|\bMINIP\b|\bSWAN\b|\bSWI\b|\bPHASE\b|\bPHA\b|"
    r"\bDWI\b|\bADC\b|\bFLAIR\b|\bT2\b)"
)


def _classify_text(header: _Header) -> tuple[Optional[str], float, list[str]]:
    text = _norm(" ".join((
        header.description,
        header.protocol_name,
        header.sequence_name,
        header.study_description,
        header.body_part,
        header.contrast_agent,
    )))
    reasons: list[str] = []

    if header.modality not in ("CT", "MR", "MRI"):
        return None, 0.0, ["không phải CT/MRI"]
    if _REJECT_RE.search(text):
        return None, 0.0, ["series dẫn xuất/localizer hoặc không phù hợp dựng volume"]
    if "DERIVED" in header.image_type and "ORIGINAL" not in header.image_type:
        return None, 0.0, ["ảnh DERIVED"]

    if header.modality == "CT":
        kind = "CT_VOLUME"
        score = 700.0
        reasons.append("CT volume")
        if "ORIGINAL" in header.image_type:
            score += 20.0
            reasons.append("ORIGINAL")
        if "PRIMARY" in header.image_type:
            score += 10.0
            reasons.append("PRIMARY")
        return kind, score, reasons

    is_t1 = bool(_T1_RE.search(text) or re.search(r"\b(BRAVO|MPRAGE|SPGR|TFE)\b", text))
    is_other_3d = bool(_THREED_RE.search(text) or re.search(r"\b(TOF3D|TOF|CISS|FIESTA|FSPGR|SPACE|CUBE|VISTA|TARQ|3D)\b", text))
    
    if not is_t1 and not is_other_3d:
        return None, 0.0, ["không nhận diện được T1 hoặc chuỗi 3D"]

    post = bool(_POST_RE.search(text) or header.contrast_agent)
    pre = bool(_PRE_RE.search(text))
    if is_t1:
        if post and not pre:
            kind = "T1_POST_CONTRAST"
            score = 1000.0
            reasons.append("T1 sau tiêm")
        else:
            kind = "T1_PRE_CONTRAST"
            score = 500.0
            reasons.append("T1 không tiêm")
    else:
        kind = "MR_VOLUME"
        score = 600.0
        reasons.append("chuỗi 3D MR")

    if _THREED_RE.search(text):
        score += 120.0
        reasons.append("chuỗi 3D")
    if _BRAIN_RE.search(text):
        score += 30.0
        reasons.append("sọ não")
    if "ORIGINAL" in header.image_type:
        score += 20.0
        reasons.append("ORIGINAL")
    if "PRIMARY" in header.image_type:
        score += 10.0
        reasons.append("PRIMARY")
    return kind, score, reasons


def _candidate_from_group(headers: list[_Header], min_slices: int) -> Optional[MprCandidate]:
    if not headers:
        return None
    first = headers[0]
    kind, score, reasons = _classify_text(first)
    if kind is None:
        return None

    if any(h.rows != first.rows or h.columns != first.columns for h in headers):
        return None
    if first.pixel_spacing is None or first.orientation is None:
        return None
    if any(h.pixel_spacing is None or h.orientation is None or h.image_position is None for h in headers):
        return None

    spacing = np.asarray(first.pixel_spacing, dtype=np.float64)
    orientation = np.asarray(first.orientation, dtype=np.float64)
    row_direction = orientation[:3]
    column_direction = orientation[3:]
    normal = np.cross(row_direction, column_direction)
    norm = float(np.linalg.norm(normal))
    if norm < 0.9:
        return None
    normal /= norm

    if any(not np.allclose(np.asarray(h.pixel_spacing), spacing, rtol=0, atol=1e-4) for h in headers):
        return None
    if any(not np.allclose(np.asarray(h.orientation), orientation, rtol=0, atol=1e-4) for h in headers):
        return None

    frame_uids = {h.frame_uid for h in headers if h.frame_uid}
    if len(frame_uids) > 1:
        return None

    positioned: list[tuple[float, _Header]] = []
    for h in headers:
        ipp = np.asarray(h.image_position, dtype=np.float64)
        positioned.append((float(np.dot(ipp, normal)), h))
    positioned.sort(key=lambda item: item[0])

    # Remove exact duplicate positions, preferring the first received SOP.
    unique: list[tuple[float, _Header]] = []
    for pos, header in positioned:
        if unique and abs(pos - unique[-1][0]) < 1e-4:
            continue
        unique.append((pos, header))
    if len(unique) < min_slices:
        return None

    gaps = np.diff([p for p, _ in unique])
    if len(gaps) == 0:
        return None
    slice_spacing = float(np.median(np.abs(gaps)))
    if not math.isfinite(slice_spacing) or slice_spacing <= 0:
        return None

    # A large or irregular gap produces visibly misleading orthogonal MPR.
    gap_error = float(np.max(np.abs(np.abs(gaps) - slice_spacing)))
    if gap_error > max(0.15, slice_spacing * 0.15):
        return None
    if slice_spacing > 2.5:
        return None
    if slice_spacing / max(float(spacing[0]), float(spacing[1])) > 4.0:
        return None

    slices = [
        MprSlice(
            path=h.path,
            position=float(pos),
            image_position=tuple(float(v) for v in h.image_position),
            sop_instance_uid=h.sop_uid,
            instance_number=h.instance_number,
        )
        for pos, h in unique
    ]
    score += min(len(slices), 400)
    score -= slice_spacing * 10.0
    reasons.extend((f"{len(slices)} lát", f"bề dày {slice_spacing:.2f} mm"))

    return MprCandidate(
        series_uid=first.series_uid,
        series_number=first.series_number,
        description=first.description or "UnknownSeries",
        protocol_name=first.protocol_name,
        sequence_name=first.sequence_name,
        study_uid=first.study_uid,
        study_date=first.study_date,
        study_time=first.study_time,
        patient_id=first.patient_id,
        patient_name=first.patient_name,
        patient_birth_date=first.patient_birth_date,
        frame_of_reference_uid=first.frame_uid,
        rows=first.rows,
        columns=first.columns,
        pixel_spacing=(float(spacing[0]), float(spacing[1])),
        orientation=tuple(float(v) for v in orientation),
        slice_spacing=slice_spacing,
        slices=slices,
        kind=kind,
        modality="MR" if first.modality == "MRI" else first.modality,
        score=score,
        reasons=reasons,
    )


def discover_mpr_candidates(
    dicom_dir: Path,
    min_slices: int = DEFAULT_MIN_SLICES,
) -> list[MprCandidate]:
    """Return eligible T1 candidates sorted from best to worst."""
    groups: dict[str, list[_Header]] = {}
    for path in _dicom_files(Path(dicom_dir)):
        header = _read_header(path)
        if header is not None:
            groups.setdefault(header.series_uid, []).append(header)

    candidates = [
        candidate
        for headers in groups.values()
        if (candidate := _candidate_from_group(headers, min_slices)) is not None
    ]
    candidates.sort(
        key=lambda c: (c.score, len(c.slices), -c.slice_spacing, c.rows * c.columns),
        reverse=True,
    )
    return candidates


def select_mpr_candidates(
    dicom_dir: Path,
    min_slices: int = DEFAULT_MIN_SLICES,
) -> list[MprCandidate]:
    """Return every eligible 3D T1 and CT volume series."""
    return discover_mpr_candidates(dicom_dir, min_slices=min_slices)


def select_mpr_candidate(
    dicom_dir: Path,
    min_slices: int = DEFAULT_MIN_SLICES,
) -> Optional[MprCandidate]:
    """Backward-compatible best candidate selector."""
    candidates = select_mpr_candidates(dicom_dir, min_slices=min_slices)
    return candidates[0] if candidates else None


def _pixel_array(path: Path) -> tuple[np.ndarray, object]:
    import pydicom
    from dcom_pipeline import _is_dicom_dataset_valid_for_decode
    try:
        # pydicom 3.x moved the public pixel helpers here.
        from pydicom.pixels import apply_modality_lut
    except ImportError:  # pragma: no cover - compatibility with pydicom 2.4
        from pydicom.pixel_data_handlers.util import apply_modality_lut

    ds = pydicom.dcmread(str(path), force=True)
    valid, reason = _is_dicom_dataset_valid_for_decode(ds)
    if not valid:
        raise ValueError(f"DICOM file {path.name} có PixelData không hợp lệ: {reason}")
    arr = ds.pixel_array
    if arr.ndim != 2:
        raise ValueError("MPR-JPG hiện chỉ hỗ trợ DICOM một khung 2D")
    try:
        arr = apply_modality_lut(arr, ds)
    except Exception:
        pass
    return np.asarray(arr, dtype=np.float32), ds


def _format_date(date_str: str) -> str:
    date_str = date_str.strip()
    if date_str and len(date_str) == 8 and date_str.isdigit():
        return f"{date_str[:4]}-{date_str[4:6]}-{date_str[6:]}"
    return date_str

def _format_time(time_str: str) -> str:
    time_str = time_str.strip()
    if time_str and len(time_str) >= 6 and time_str[:6].isdigit():
        return f"{time_str[:2]}:{time_str[2:4]}:{time_str[4:6]}"
    return time_str


def _first_number(value) -> Optional[float]:
    """First element of a DICOM value that may be single- or multi-valued.

    CT headers often carry a pair such as WindowCenter=[40, 400] (soft tissue
    then bone).  The first entry is the primary window the operator chose, so
    that is the one a PACS opens the series with.
    """
    if value is None:
        return None
    if not isinstance(value, (str, bytes)) and hasattr(value, "__len__"):
        if len(value) == 0:
            return None
        value = value[0]
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if math.isfinite(result) else None


def _stored_window(path: Path) -> Optional[tuple[float, float, str]]:
    """Return (center, width, voi_function) from one slice header, if present."""
    import pydicom

    try:
        ds = pydicom.dcmread(str(path), stop_before_pixels=True, force=True)
    except Exception:
        return None
    center = _first_number(getattr(ds, "WindowCenter", None))
    width = _first_number(getattr(ds, "WindowWidth", None))
    if center is None or width is None or width <= 0:
        return None
    return center, width, _norm(getattr(ds, "VOILUTFunction", "")) or "LINEAR"


def _window_bounds(center: float, width: float, function: str) -> tuple[float, float]:
    """Convert a DICOM VOI window to display bounds per PS3.3 C.11.2.1.2."""
    if function == "LINEAR EXACT":
        return center - width / 2.0, center + width / 2.0
    # Plain LINEAR is defined off (width - 1) with a half-unit shift.
    return center - 0.5 - (width - 1) / 2.0, center - 0.5 + (width - 1) / 2.0


def _percentile_intensity_range(candidate: MprCandidate) -> tuple[float, float]:
    """Last-resort window when no slice carries a VOI setting.

    Only reached for series with no WindowCenter/WindowWidth at all.  On CT this
    spans air to cortical bone and flattens soft tissue, so it must never be the
    default — see _series_intensity_range.
    """
    samples: list[np.ndarray] = []
    for item in candidate.slices:
        arr, _ = _pixel_array(item.path)
        step = max(1, int(arr.size / 4096))
        samples.append(arr.reshape(-1)[::step])
    merged = np.concatenate(samples)
    low, high = np.percentile(merged, (0.5, 99.5))
    if not math.isfinite(float(low)) or not math.isfinite(float(high)) or high <= low:
        low, high = float(np.min(merged)), float(np.max(merged))
    if high <= low:
        high = low + 1.0
    return float(low), float(high)


def _series_intensity_range(candidate: MprCandidate) -> tuple[float, float, str]:
    """Pick the one window baked into this series' 8-bit JPGs.

    JPG keeps a single window per series, so the choice is irreversible: we use
    the VOI the modality itself recorded, which is what a PACS shows on open.
    Values are compared in modality-LUT output space (Hounsfield units on CT),
    the same space _pixel_array returns, so no rescaling is needed here.

    Per-slice windows can drift across a series, so the median keeps the volume
    from flickering as it is scrolled.
    """
    centers: list[float] = []
    widths: list[float] = []
    function = "LINEAR"
    for item in candidate.slices:
        stored = _stored_window(item.path)
        if stored is None:
            continue
        center, width, item_function = stored
        centers.append(center)
        widths.append(width)
        function = item_function

    if centers:
        center = float(np.median(centers))
        width = float(np.median(widths))
        low, high = _window_bounds(center, width, function)
        if math.isfinite(low) and math.isfinite(high) and high > low:
            coverage = f"{len(centers)}/{len(candidate.slices)}"
            return low, high, f"dicom_voi_{function.lower().replace(' ', '_')}_{coverage}"

    low, high = _percentile_intensity_range(candidate)
    return low, high, "series_percentile_0.5_99.5"


def _to_uint8(arr: np.ndarray, low: float, high: float, invert: bool) -> np.ndarray:
    out = (np.clip(arr, low, high) - low) / (high - low) * 255.0
    out = out.astype(np.uint8)
    return 255 - out if invert else out


def _affine(candidate: MprCandidate) -> list[list[float]]:
    row_dir = np.asarray(candidate.orientation[:3], dtype=np.float64)
    col_dir = np.asarray(candidate.orientation[3:], dtype=np.float64)
    normal = np.cross(row_dir, col_dir)
    normal /= np.linalg.norm(normal)
    row_spacing, col_spacing = candidate.pixel_spacing
    origin = np.asarray(candidate.slices[0].image_position, dtype=np.float64)
    matrix = np.eye(4, dtype=np.float64)
    matrix[:3, 0] = row_dir * col_spacing
    matrix[:3, 1] = col_dir * row_spacing
    matrix[:3, 2] = normal * candidate.slice_spacing
    matrix[:3, 3] = origin
    return [[float(v) for v in row] for row in matrix]


def convert_mpr_candidate(
    candidate: MprCandidate,
    jpg_dir: Path,
    quality: int = 100,
    log: Callable[[str], None] = print,
    should_stop: Optional[Callable[[], bool]] = None,
    folder_name: Optional[str] = None,
) -> tuple[int, Path]:
    """Convert the selected series and return (written_image_count, manifest_path)."""
    from PIL import Image

    series_folder = Path(jpg_dir) / (folder_name or candidate.folder_name)
    series_folder.mkdir(parents=True, exist_ok=True)
    low, high, window_method = _series_intensity_range(candidate)
    ordered_files: list[dict] = []

    source = "cửa sổ DICOM" if window_method.startswith("dicom_voi") else "percentile (file không có VOI)"
    log(
        f"MPR-JPG: {candidate.description} — {len(candidate.slices)} lát, "
        f"{candidate.kind}, {source} {low:.1f}..{high:.1f} "
        f"(W={high - low:.0f}, L={(high + low) / 2:.0f})."
    )
    written = 0
    for index, item in enumerate(candidate.slices, start=1):
        if should_stop and should_stop():
            raise InterruptedError("Đã dừng khi đang tạo MPR-JPG")
        arr, ds = _pixel_array(item.path)
        invert = _text(getattr(ds, "PhotometricInterpretation", "")) == "MONOCHROME1"
        image = Image.fromarray(_to_uint8(arr, low, high, invert), mode="L")
        filename = f"MPR_{index:04d}.jpg"
        image.save(
            series_folder / filename,
            "JPEG",
            quality=max(70, min(int(quality), 100)),
            optimize=True,
            subsampling=0,
        )
        ordered_files.append({
            "file": filename,
            "position": [float(v) for v in item.image_position],
            "distance": float(item.position),
            "sop_instance_uid": item.sop_instance_uid,
        })
        written += 1

    manifest = {
        "format": MANIFEST_FORMAT,
        "version": MANIFEST_VERSION,
        "series_type": candidate.kind,
        "series_description": candidate.description,
        "modality": candidate.modality,
        "series_number": candidate.series_number,
        "study_instance_uid": candidate.study_uid,
        "study_date": candidate.study_date,
        "study_time": candidate.study_time,
        "patient_id": candidate.patient_id,
        "patient_name": candidate.patient_name,
        "patient_birth_date": candidate.patient_birth_date,
        "series_instance_uid": candidate.series_uid,
        "frame_of_reference_uid": candidate.frame_of_reference_uid,
        "rows": candidate.rows,
        "columns": candidate.columns,
        "slice_count": written,
        "pixel_spacing": list(candidate.pixel_spacing),
        "slice_spacing": candidate.slice_spacing,
        "image_orientation_patient": list(candidate.orientation),
        "affine": _affine(candidate),
        "intensity": {
            "method": window_method,
            "low": low,
            "high": high,
            "window_width": high - low,
            "window_center": (high + low) / 2.0,
            "bits": 8,
        },
        "jpeg_quality": max(70, min(int(quality), 100)),
        "ordered_slices": ordered_files,
    }
    manifest_path = series_folder / MANIFEST_NAME
    temp_path = manifest_path.with_suffix(".json.tmp")
    temp_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    temp_path.replace(manifest_path)
    log(f"MPR-JPG hoàn tất: {written} lát — {manifest_path}")
    return written, manifest_path


def read_manifest(series_folder: Path) -> Optional[dict]:
    path = Path(series_folder) / MANIFEST_NAME
    if not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None
    if data.get("format") != MANIFEST_FORMAT or data.get("version") != MANIFEST_VERSION:
        return None
    return data


def manifest_image_files(series_folder: Path, manifest: Optional[dict] = None) -> list[Path]:
    series_folder = Path(series_folder)
    manifest = manifest or read_manifest(series_folder)
    if not manifest:
        return []
    files = [
        series_folder / item["file"]
        for item in manifest.get("ordered_slices", [])
        if isinstance(item, dict) and item.get("file")
    ]
    return [path for path in files if path.is_file()]


def load_mpr_volume(series_folder: Path) -> tuple[np.ndarray, dict]:
    """Load an MPR-JPG package as a uint8 volume shaped [z, y, x]."""
    from PIL import Image

    manifest = read_manifest(series_folder)
    if manifest is None:
        raise ValueError(f"Không tìm thấy {MANIFEST_NAME}")
    files = manifest_image_files(series_folder, manifest)
    expected = int(manifest.get("slice_count", 0) or 0)
    if not files or len(files) != expected:
        raise ValueError(f"Gói MPR thiếu ảnh: có {len(files)}/{expected}")
    images = [np.asarray(Image.open(path).convert("L"), dtype=np.uint8) for path in files]
    shape = images[0].shape
    if any(image.shape != shape for image in images):
        raise ValueError("Các ảnh trong gói MPR không cùng kích thước")
    return np.stack(images, axis=0), manifest


def _patient_axis_label(direction: np.ndarray) -> str:
    """Return the dominant DICOM LPS patient direction for a display edge."""
    direction = np.asarray(direction, dtype=np.float64)
    axis = int(np.argmax(np.abs(direction)))
    positive = float(direction[axis]) >= 0
    if axis == 0:
        return "L" if positive else "R"
    if axis == 1:
        return "P" if positive else "A"
    return "S" if positive else "I"


def _opposite_patient_label(label: str) -> str:
    return {
        "L": "R", "R": "L",
        "P": "A", "A": "P",
        "S": "I", "I": "S",
    }[label]


def plane_array(volume: np.ndarray, plane: str, index: int) -> np.ndarray:
    """Return PACS-style display pixels for each acquisition-orthogonal plane.

    Source slices are sorted along the DICOM slice normal from low to high.
    Coronal and sagittal displays therefore need a vertical reversal so the
    superior side is shown at the top rather than the inferior side.
    """
    if volume.ndim != 3:
        raise ValueError("Volume phải có dạng [z, y, x]")
    if plane == "axial":
        return volume[max(0, min(index, volume.shape[0] - 1)), :, :]
    if plane == "coronal":
        return volume[::-1, max(0, min(index, volume.shape[1] - 1)), :]
    if plane == "sagittal":
        return volume[::-1, :, max(0, min(index, volume.shape[2] - 1))]
    raise ValueError(f"Mặt phẳng không hợp lệ: {plane}")


def plane_orientation_labels(manifest: dict, plane: str) -> tuple[str, str, str, str]:
    """Return (left, right, top, bottom) patient labels for a displayed plane."""
    orientation = np.asarray(manifest["image_orientation_patient"], dtype=np.float64)
    horizontal = orientation[:3]
    vertical = orientation[3:]
    normal = np.cross(horizontal, vertical)
    norm = float(np.linalg.norm(normal))
    if norm <= 1e-9:
        raise ValueError("ImageOrientationPatient không hợp lệ")
    normal /= norm

    if plane == "axial":
        right_vector, bottom_vector = horizontal, vertical
    elif plane == "coronal":
        right_vector, bottom_vector = horizontal, -normal
    elif plane == "sagittal":
        right_vector, bottom_vector = vertical, -normal
    else:
        raise ValueError(f"Mặt phẳng không hợp lệ: {plane}")

    right = _patient_axis_label(right_vector)
    bottom = _patient_axis_label(bottom_vector)
    return _opposite_patient_label(right), right, _opposite_patient_label(bottom), bottom


def plane_spacing(manifest: dict, plane: str) -> tuple[float, float]:
    """Return (horizontal_mm_per_pixel, vertical_mm_per_pixel)."""
    row_spacing, col_spacing = (float(v) for v in manifest["pixel_spacing"])
    slice_spacing = float(manifest["slice_spacing"])
    if plane == "axial":
        return col_spacing, row_spacing
    if plane == "coronal":
        return col_spacing, slice_spacing
    if plane == "sagittal":
        return row_spacing, slice_spacing
    raise ValueError(f"Mặt phẳng không hợp lệ: {plane}")


def polygon_area_mm2(points: Iterable[tuple[float, float]], spacing: tuple[float, float]) -> float:
    pts = list(points)
    if len(pts) < 3:
        return 0.0
    sx, sy = spacing
    area = 0.0
    for i, (x1, y1) in enumerate(pts):
        x2, y2 = pts[(i + 1) % len(pts)]
        area += (x1 * sx) * (y2 * sy) - (x2 * sx) * (y1 * sy)
    return abs(area) * 0.5


def roi_volume_ml(
    axial_rois: dict[int, list[tuple[float, float]]],
    manifest: dict,
) -> float:
    spacing = plane_spacing(manifest, "axial")
    dz = float(manifest["slice_spacing"])
    volume_mm3 = sum(polygon_area_mm2(points, spacing) * dz for points in axial_rois.values())
    return volume_mm3 / 1000.0

# -*- coding: utf-8 -*-
"""Portable export: creates an offline, professional Web PACS Viewer matching Dcom to JPG 1:1.

Directly ports the Dcom to JPG clinical PACS UI, tool clusters, series filmstrip,
multi-study timeline rail, 1x1 / 1x2 / 1x3 / 2x2 multi-viewport workspace, synchronized
crosshair reference cursors, calipers, angles, ROIs, W/L presets, and cine player.
"""

from __future__ import annotations

import html
import json
from dataclasses import dataclass, field
from pathlib import Path
import re
import shutil
from typing import Callable, Optional

import dcom_pipeline

IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png"}
DOCUMENT_SUFFIXES = {".pdf", ".docx", ".doc", ".txt", ".json"}
DICOM_SUFFIXES = {".dcm", ".ima", ".dicom"}
SKIPPED_FOLDERS = {"RAW_JPG", "CACHE", "THUMB", "THUMBNAILS", "__MACOSX", "THUMBS"}
# Sidecars the pipeline writes for its own use. They share the .json suffix
# with real documents, but a patient must never receive them as one.
INTERNAL_SIDECAR_NAMES = {
    dcom_pipeline.PATIENT_MANIFEST_NAME.casefold(),
    "mpr-volume.json",
}
UNKNOWN = "—"

# What each export mode writes, as (viewer, dicom). "jpg" and "all" are older
# spellings of "viewer" and "both" kept so existing callers keep working.
# This mapping is the only place a mode name is recognised, so an unknown mode
# fails loudly here instead of silently exporting an empty folder.
EXPORT_MODES: dict[str, tuple[bool, bool]] = {
    "viewer": (True, False),
    "jpg": (True, False),
    "dicom": (False, True),
    "both": (True, True),
    "all": (True, True),
}

LogFn = Callable[[str], None]


def _resolve_export_mode(mode: str) -> tuple[bool, bool]:
    """Return (export_viewer, export_dicom) for a requested export mode."""
    try:
        return EXPORT_MODES[str(mode).strip().casefold()]
    except KeyError:
        supported = ", ".join(sorted(EXPORT_MODES))
        raise ValueError(
            f"Chế độ xuất không hợp lệ: {mode!r}. Chỉ nhận: {supported}."
        ) from None


@dataclass
class ExportSeries:
    name: str
    description: str
    modality: str
    institution: str
    images: list[Path] = field(default_factory=list)
    relative: Path = field(default_factory=Path)


@dataclass
class ExportStudy:
    folder: Path
    title: str
    date: str
    modality: str
    description: str
    series: list[ExportSeries] = field(default_factory=list)
    documents: list[Path] = field(default_factory=list)
    dicom_files: list[Path] = field(default_factory=list)

    def image_count(self) -> int:
        return sum(len(item.images) for item in self.series)

    def dicom_count(self) -> int:
        return len(self.dicom_files)


def _natural_key(value: str) -> list:
    return [int(item) if item.isdigit() else item.casefold() for item in re.split(r"(\d+)", value)]


def _read_series_manifest(folder: Path) -> dict:
    try:
        data = json.loads((folder / "mpr-volume.json").read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError):
        return {}
    return data if isinstance(data, dict) else {}


def _relative_url(*parts: str) -> str:
    return "/".join(part.replace("\\", "/") for part in parts if part and part != ".")


def _collect_series(study_folder: Path) -> list[ExportSeries]:
    found: list[ExportSeries] = []
    candidates = [study_folder, *(path for path in study_folder.rglob("*") if path.is_dir())]
    for folder in sorted(candidates, key=lambda path: _natural_key(str(path))):
        relative_parts = folder.relative_to(study_folder).parts
        if any(part.upper() in SKIPPED_FOLDERS for part in relative_parts):
            continue
        images = sorted(
            (path for path in folder.iterdir()
             if path.is_file() and path.suffix.casefold() in IMAGE_SUFFIXES),
            key=lambda path: _natural_key(path.name),
        )
        if not images:
            continue
        manifest = _read_series_manifest(folder)
        acquisition = manifest.get("acquisition") if isinstance(manifest.get("acquisition"), dict) else {}
        found.append(ExportSeries(
            name=folder.name,
            description=str(manifest.get("series_description") or "").strip() or folder.name,
            modality=str(manifest.get("modality") or "").strip().upper(),
            institution=str(acquisition.get("institutionName") or "").strip(),
            images=images,
            relative=folder.relative_to(study_folder),
        ))
    return found


def _is_in_skipped_folder(path: Path, study_folder: Path) -> bool:
    """True when a file sits inside a working folder that must not be exported."""
    return any(
        part.upper() in SKIPPED_FOLDERS
        for part in path.relative_to(study_folder).parts[:-1]
    )


def _collect_documents(study_folder: Path) -> list[Path]:
    return sorted(
        (path for path in study_folder.rglob("*")
         if path.is_file()
         and path.suffix.casefold() in DOCUMENT_SUFFIXES
         and path.name.casefold() not in INTERNAL_SIDECAR_NAMES
         and not _is_in_skipped_folder(path, study_folder)),
        key=lambda path: _natural_key(path.name),
    )


def _collect_dicom_files(study_folder: Path) -> list[Path]:
    dicom_dir = study_folder / "DICOM"
    files: list[Path] = []
    if dicom_dir.is_dir():
        files = [
            path for path in dicom_dir.rglob("*")
            if path.is_file() and not path.name.startswith(".")
        ]
    else:
        # Without a DICOM/ folder the whole study is searched, so the working
        # folders have to be excluded the same way series detection does it.
        files = [
            path for path in study_folder.rglob("*")
            if path.is_file()
            and path.suffix.casefold() in DICOM_SUFFIXES
            and not _is_in_skipped_folder(path, study_folder)
        ]
    return sorted(files, key=lambda path: _natural_key(path.name))


def _study_folders(patient_folder: Path) -> list[Path]:
    children = [
        path for path in sorted(patient_folder.iterdir(), key=lambda p: _natural_key(p.name))
        if path.is_dir() and not path.name.startswith(".")
    ]
    studies = [
        path for path in children
        if path.name.upper() not in {"DICOM", "JPG", "VIDEO", "PHOTO", "RAW_JPG", "DOCUMENTS"}
    ]
    return studies or [patient_folder]


def _study_metadata(study_folder: Path, records: dict[str, dict]) -> dict:
    try:
        key = str(study_folder.resolve()).casefold()
    except OSError:
        key = str(study_folder).casefold()
    return records.get(key, {})


def detect_patient_export_contents(patient_folder: Path) -> dict:
    """Summarise what an export would write, to drive the mode picker.

    Counted from the same pass the export itself uses, so the dialog cannot
    promise studies that the export then skips for holding nothing.
    """
    _patient, studies = collect_record(patient_folder)
    jpg_count = sum(study.image_count() for study in studies)
    dicom_count = sum(study.dicom_count() for study in studies)

    return {
        "hasJpg": jpg_count > 0,
        "hasDicom": dicom_count > 0,
        "jpgCount": jpg_count,
        "dicomCount": dicom_count,
        "documentCount": sum(len(study.documents) for study in studies),
        "studyCount": len(studies),
        "seriesCount": sum(len(study.series) for study in studies),
    }


def collect_record(patient_folder: Path) -> tuple[dict, list[ExportStudy]]:
    patient_folder = Path(patient_folder).expanduser().resolve(strict=True)
    manifest = dcom_pipeline._read_patient_manifest(patient_folder) or {}

    records: dict[str, dict] = {}
    for record in (manifest.get("studies") or {}).values():
        if not isinstance(record, dict):
            continue
        relative = str(record.get("folder") or "").strip()
        if not relative:
            continue
        try:
            records[str((patient_folder / relative).resolve()).casefold()] = record
        except OSError:
            continue

    studies: list[ExportStudy] = []
    for folder in _study_folders(patient_folder):
        series = _collect_series(folder)
        documents = _collect_documents(folder)
        dicom_files = _collect_dicom_files(folder)
        if not series and not documents and not dicom_files:
            continue
        record = _study_metadata(folder, records)
        date_raw = str(record.get("date") or "").strip()
        date = _format_date_only(date_raw)
        modality = str(record.get("modality") or "").strip().upper()
        description = str(record.get("description") or "").strip()
        if not modality:
            modality = next((item.modality for item in series if item.modality), "")
        title = " · ".join(part for part in (date, modality, description) if part)
        studies.append(ExportStudy(
            folder=folder,
            title=title or folder.name,
            date=date,
            modality=modality,
            description=description,
            series=series,
            documents=documents,
            dicom_files=dicom_files,
        ))

    hospital = str(manifest.get("hospitalName") or "").strip()
    if not hospital:
        hospital = next(
            (item.institution for study in studies for item in study.series if item.institution),
            "",
        )

    patient = {
        "patientName": str(manifest.get("patientName") or "").strip(),
        "patientId": str(manifest.get("patientId") or "").strip(),
        "patientBirthDate": _format_date_only(str(manifest.get("patientBirthDate") or "")),
        "patientSex": str(manifest.get("patientSex") or "").strip().upper(),
        "hospitalName": hospital,
        "phone": str(manifest.get("patientPhone") or "").strip(),
        "address": str(manifest.get("patientAddress") or "").strip(),
        "diagnosis": str(manifest.get("patientDiagnosis") or "").strip(),
    }
    return patient, studies


def _format_date_only(val: str | None) -> str:
    if not val:
        return ""
    val_str = str(val).strip()
    return val_str.split()[0] if " " in val_str else val_str


def _clean_patient_folder_name(patient: dict, fallback: str = "BENH_NHAN") -> str:
    name = str(patient.get("patientName") or "").strip()
    pid = str(patient.get("patientId") or "").strip()
    if name and pid:
        raw = f"{name} - {pid}"
    else:
        raw = name or pid or fallback
    # The pipeline names the archive folders with _safe_name. Sanitising
    # differently here would give the same patient two different folder names —
    # one in the archive, another in the exported copy — and would skip the
    # length cap that keeps the nested export paths inside the Windows limit.
    return dcom_pipeline._safe_name(raw) or fallback


def _escape(value: str) -> str:
    return html.escape(str(value or ""), quote=True)


def _or_dash(value: str) -> str:
    text = str(value or "").strip()
    return _escape(text) if text else UNKNOWN


def _sex_label(code: str) -> str:
    return {"M": "Nam", "F": "Nữ"}.get(str(code or "").strip().upper(), "")


def _patient_header(patient: dict) -> str:
    fields = [
        ("Họ và tên", patient.get("patientName") or UNKNOWN),
        ("Mã BN", patient.get("patientId") or UNKNOWN),
        ("Ngày sinh", patient.get("patientBirthDate") or UNKNOWN),
        ("Giới tính", _sex_label(patient.get("patientSex") or "") or UNKNOWN),
        ("Cơ sở", patient.get("hospitalName") or UNKNOWN),
    ]
    cells = "".join(
        f"<span><b>{_escape(label)}:</b> {_or_dash(value)}</span>" for label, value in fields
    )
    return (
        "<header class=\"patient-header\">"
        f'<div class="fields">{cells}</div></header>'
    )


# ─────────────────────────────────────────────────────────────────────────────
# 1:1 DCOM TO JPG PACS WORKSTATION CSS (EXACT COPY-CAT)
# ─────────────────────────────────────────────────────────────────────────────

VIEWER_CSS = """
:root {
  font-family: "Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, sans-serif;
  color-scheme: dark;
  --bg-app: #05080c;
  --bg-panel: #090e15;
  --bg-card: #0e161f;
  --bg-hover: #13202c;
  --border: #18232c;
  --border-subtle: #1e2b36;
  --text-main: #f1f5f9;
  --text-muted: #94a3b8;
  --text-dim: #64748b;
  --accent: #007fbd;
  --accent-glow: #00b0f0;
  --focus-ring: #49c7ff;
  --mono-font: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}
* { box-sizing: border-box; margin: 0; padding: 0; user-select: none; -webkit-user-select: none; }
body {
  background: var(--bg-app);
  color: var(--text-main);
  height: 100vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.mono { font-family: var(--mono-font); }

/* ── Winbar (Top Tab Strip) ──────────────────────────── */
.winbar {
  height: 34px;
  background: #090d12;
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  padding: 0 6px;
  gap: 4px;
  flex-shrink: 0;
  z-index: 30;
}
.winbar-tab {
  display: flex;
  align-items: center;
  gap: 6px;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-bottom: none;
  padding: 4px 10px;
  border-radius: 6px 6px 0 0;
  font-size: 11.5px;
  color: var(--text-muted);
  text-decoration: none;
  cursor: pointer;
  height: 28px;
  margin-top: 6px;
  transition: all 0.15s;
}
.winbar-tab:hover { background: var(--bg-hover); color: var(--text-main); }
.winbar-tab.active {
  background: #0c141d;
  color: #fff;
  border-color: #007fbd;
  border-top: 2px solid #00b0f0;
}
.tab-fmt-badge {
  font-size: 9px;
  font-weight: 700;
  padding: 1px 4px;
  border-radius: 3px;
  background: #1e3a5f;
  color: #38bdf8;
  margin-left: 4px;
}

/* ── Viewer Toolbar ──────────────────────────────────── */
.viewer-toolbar {
  height: 38px;
  background: #0b1118;
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  padding: 0 8px;
  gap: 4px;
  flex-shrink: 0;
  z-index: 25;
}
.tool-cluster {
  display: flex;
  align-items: center;
  gap: 2px;
}
.toolbar-divider {
  width: 1px;
  height: 18px;
  background: var(--border-subtle);
  margin: 0 4px;
}
.icon-button {
  background: transparent;
  color: #9eb0be;
  border: 1px solid transparent;
  width: 28px;
  height: 28px;
  border-radius: 5px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.12s;
  padding: 0;
}
.icon-button svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.icon-button:hover { background: var(--bg-hover); color: #fff; border-color: var(--border-subtle); }
.icon-button.active, .icon-button[aria-pressed="true"] {
  background: #0e2838;
  color: #38bdf8;
  border-color: #007fbd;
  box-shadow: 0 0 6px rgba(0, 176, 240, 0.3);
}

.window-select {
  background: var(--bg-card);
  color: var(--text-main);
  border: 1px solid var(--border-subtle);
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 11px;
  height: 26px;
  outline: none;
  cursor: pointer;
}
.window-select:hover { border-color: #007fbd; }

/* ── App Shell 3-Column Layout ───────────────────────── */
.app-shell {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 165px 94px minmax(0, 1fr);
  background: #000;
}

/* ── Patient Record Rail (Left Sidebar) ──────────────── */
.rec-rail {
  background: var(--bg-panel);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  padding: 6px;
  gap: 8px;
}
.rec-rail::-webkit-scrollbar { width: 3px; }
.rec-rail::-webkit-scrollbar-thumb { background: var(--border-subtle); border-radius: 2px; }

.rec-card {
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 5px;
  padding: 6px 8px;
  font-size: 9.5px;
}
.rec-card-header {
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  color: #7dd3fc;
  margin-bottom: 4px;
  display: flex;
  align-items: center;
  gap: 4px;
}
.rfacts { display: grid; gap: 3px; }
.rfact { display: flex; justify-content: space-between; font-size: 9px; }
.rfact dt { color: var(--text-dim); }
.rfact dd { color: #fff; font-weight: 500; text-align: right; }

.rec-timeline-head {
  font-size: 8.5px;
  font-weight: 700;
  text-transform: uppercase;
  color: var(--text-dim);
  padding: 0 3px;
}
.tl { display: flex; flex-direction: column; gap: 3px; }
.tl-item {
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 4px;
  padding: 4px 6px;
  cursor: pointer;
  transition: all 0.12s;
}
.tl-item:hover { background: var(--bg-hover); border-color: #2c4456; }
.tl-item.on {
  border-color: #007fbd;
  background: #0e2838;
}
.tl-item-title { font-size: 9.5px; font-weight: 600; color: #fff; line-height: 1.2; }
.tl-item-meta { font-size: 8px; color: var(--text-muted); margin-top: 1px; }

/* ── Series Strip (Middle Column - Scaled down 2/3) ─── */
.series-strip {
  background: #070b10;
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  padding: 4px 2px;
  gap: 4px;
}
.series-strip::-webkit-scrollbar { width: 3px; }
.series-strip::-webkit-scrollbar-thumb { background: var(--border-subtle); }

.series-group-badge {
  padding: 2px 4px;
  background: #0f1a26;
  border: 1px solid #1a2c3f;
  border-radius: 3px;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.badge-date { font-size: 8px; font-weight: 700; color: #38bdf8; }
.badge-study { font-size: 7.5px; font-weight: 600; color: #fef3c7; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.series-card {
  display: block;
  width: 100%;
  padding: 2px;
  color: #9eb0be;
  text-align: left;
  border: 1px solid var(--border-subtle);
  border-radius: 4px;
  background: var(--bg-card);
  cursor: grab;
  user-select: none;
  position: relative;
  transition: border-color 0.15s ease, background 0.15s ease;
}
.series-card:active { cursor: grabbing; }
.series-card.is-dragging {
  opacity: 0.45;
  outline: 2px dashed #00b0f0;
  cursor: grabbing;
}
.series-card:hover {
  border-color: #2c4456;
  background: var(--bg-hover);
  color: #d6e8f5;
}
.series-card.active {
  color: #eff9ff;
  border-color: #007fbd;
  background: #0e2838;
}
.series-thumb-box {
  position: relative;
  width: 100%;
  aspect-ratio: 1 / 1;
  background: #04070a;
  border-radius: 3px;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid #162430;
}
.series-card-thumb {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  display: block;
}
.badge-3d {
  position: absolute;
  top: 2px;
  left: 2px;
  z-index: 2;
  padding: 0.5px 3px;
  color: #38bdf8;
  border-radius: 2px;
  background: rgba(12, 40, 61, 0.9);
  border: 1px solid #0369a1;
  font-size: 7.5px;
  font-weight: 700;
}
.series-thumb-overlay {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 2;
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 2px;
  padding: 8px 3px 2px 3px;
  background: linear-gradient(transparent, rgba(4, 7, 10, 0.94) 65%);
  pointer-events: none;
}
.series-thumb-title {
  font-size: 8px;
  font-weight: 600;
  color: #e2f0fb;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  line-height: 1.1;
}
.series-thumb-count {
  font-size: 7.5px;
  font-weight: 700;
  color: #7dd3fc;
  flex-shrink: 0;
}
.series-card[data-pane]::after {
  content: attr(data-pane);
  position: absolute;
  top: 2px;
  right: 2px;
  font-size: 7.5px;
  font-weight: 700;
  min-width: 12px;
  height: 12px;
  line-height: 12px;
  text-align: center;
  color: #fff;
  background: #007fbd;
  border-radius: 6px;
  padding: 0 2px;
  z-index: 3;
}

/* ── Workspace Grid & Viewport Shells ────────────────── */
.viewer-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: #000;
}
.workspace-grid {
  flex: 1;
  min-height: 0;
  display: grid;
  gap: 2px;
  padding: 2px;
  background: #000;
}
.workspace-grid.mode-single { grid-template-columns: 1fr; grid-template-rows: 1fr; }
.workspace-grid.mode-compare { grid-template-columns: 1fr 1fr; grid-template-rows: 1fr; }
.workspace-grid.mode-compare3 { grid-template-columns: 1fr 1fr 1fr; grid-template-rows: 1fr; }
.workspace-grid.mode-montage6 { grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr; }

.viewport-shell {
  position: relative;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  border: 1px solid #18232c;
  background: #000;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: crosshair;
}
.viewport-shell:hover { border-color: #008bc8; }
.viewport-shell.is-active {
  border-color: #00b0f0;
  border-width: 2px;
  box-shadow: inset 0 0 0 1px rgba(0, 176, 240, 0.3), 0 0 12px 2px rgba(0, 176, 240, 0.2);
}
.viewport-shell.drop-target {
  border-color: #00b0f0 !important;
  box-shadow: inset 0 0 0 2px #00b0f0, 0 0 16px rgba(0, 176, 240, 0.45) !important;
}
.viewport-shell.drop-target::after {
  content: '⬇ Thả chuỗi xung vào đây';
  position: absolute;
  inset: 0;
  background: rgba(8, 28, 42, 0.85);
  backdrop-filter: blur(3px);
  color: #38bdf8;
  font-size: 12px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 40;
  pointer-events: none;
  border: 2px dashed #38bdf8;
}

.viewport-header-strip {
  position: absolute;
  top: 3px;
  left: 5px;
  z-index: 15;
  display: flex;
  align-items: center;
  gap: 3px;
}
.vp-select {
  background: rgba(12, 20, 29, 0.85);
  backdrop-filter: blur(4px);
  color: #fff;
  border: 1px solid #21455a;
  border-radius: 3px;
  font-size: 8.5px;
  height: 18px;
  padding: 0 3px;
  outline: none;
  max-width: 110px;
}
.vp-badge {
  font-size: 7.5px;
  font-weight: 700;
  color: #38bdf8;
  background: rgba(0, 127, 189, 0.3);
  border: 1px solid #007fbd;
  padding: 0.5px 3px;
  border-radius: 2px;
}

.viewport-img {
  position: absolute;
  top: 4px;
  left: 4px;
  right: 4px;
  bottom: 4px;
  width: calc(100% - 8px);
  height: calc(100% - 8px);
  object-fit: contain;
  transform-origin: center center;
  pointer-events: none;
  user-select: none;
}
.annotation-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 10;
}

/* ── HUD Overlays (Scaled down for clinical precision) ─ */
.viewport-overlay {
  position: absolute;
  font-size: 9.5px;
  line-height: 1.2;
  color: #ffbc42;
  text-shadow: 1px 1px 1px #000, 0 0 2px #000;
  pointer-events: none;
  z-index: 12;
  white-space: pre-line;
}
.overlay-tl { top: 24px; left: 5px; text-align: left; }
.overlay-tr { top: 4px; right: 5px; text-align: right; }
.overlay-bl { bottom: 28px; left: 5px; text-align: left; }
.overlay-br { bottom: 28px; right: 5px; text-align: right; }

.orientation-marker {
  position: absolute;
  font-size: 9.5px;
  color: #88c0d0;
  font-weight: bold;
  text-shadow: 1px 1px 1px #000, 0 0 2px #000;
  pointer-events: none;
  z-index: 12;
}
.orientation-t { top: 4px; left: 50%; transform: translateX(-50%); }
.orientation-b { bottom: 28px; left: 50%; transform: translateX(-50%); }
.orientation-l { left: 5px; top: 50%; transform: translateY(-50%); }
.orientation-r { right: 5px; top: 50%; transform: translateY(-50%); }

/* ── Slice Control Scrubber on Viewport ──────────────── */
.slice-control {
  position: absolute;
  right: 5px;
  bottom: 4px;
  left: 5px;
  z-index: 15;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 1px 4px;
  color: #c8e9fb;
  border: 1px solid #21455a;
  border-radius: 4px;
  background: rgba(7, 18, 27, 0.85);
  opacity: 0.7;
  transition: opacity 120ms ease;
}
.viewport-shell:hover .slice-control,
.viewport-shell.is-active .slice-control { opacity: 1; }
.slice-control input { min-width: 35px; width: 100%; accent-color: #20b7ef; height: 3px; cursor: pointer; }
.slice-control .cine-btn {
  background: none;
  border: none;
  color: #20b7ef;
  font-size: 10px;
  cursor: pointer;
  padding: 0 2px;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}
.slice-control .cine-btn:hover { color: #fff; }

/* ── Bottom Status Bar ───────────────────────────────── */
.status-bar {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  height: 24px;
  padding: 0 9px;
  color: #7890a2;
  border-top: 1px solid #192530;
  background: #0c131a;
  font-size: 10.5px;
  flex-shrink: 0;
  z-index: 25;
}
.status-dot { width: 7px; height: 7px; border-radius: 50%; background: #27bd72; flex-shrink: 0; }
.status-text { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* ── Shortcuts Modal ─────────────────────────────────── */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.75);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}
.modal-card {
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 8px;
  width: 440px;
  max-width: 90vw;
  padding: 16px 20px;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.8);
}
.modal-card h3 { font-size: 14px; margin-bottom: 12px; color: #fff; font-weight: 600; }
.shortcut-row {
  display: flex;
  justify-content: space-between;
  padding: 5px 0;
  border-bottom: 1px solid var(--border);
  font-size: 11.5px;
}
.shortcut-row kbd {
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 3px;
  padding: 1px 5px;
  font-size: 10px;
  color: #38bdf8;
  font-family: var(--mono-font);
}

@media (max-width: 1000px) {
  .app-shell { grid-template-columns: 160px 120px minmax(0, 1fr); }
}
"""

INDEX_CSS = """
/* ── Layout Wrap for Viewports vs Worklist ─────────────── */
.viewer-layout-wrap {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

/* ── Worklist View Container (Danh sách ca chụp) ──────── */
.worklist-container {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
  background: var(--bg-app);
  display: flex;
  justify-content: center;
}
.worklist-inner {
  width: 100%;
  max-width: 960px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.container { width: 100%; max-width: 960px; display: flex; flex-direction: column; gap: 16px; }
header.patient-header {
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 16px 20px;
}
header.patient-header .fields {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 24px;
  font-size: 12.5px;
  color: var(--text-muted);
}
header.patient-header .fields span b { color: #fff; font-weight: 600; }

.section-title { font-size: 13px; font-weight: 700; color: var(--text-muted); text-transform: uppercase; margin-top: 4px; letter-spacing: 0.5px; }
.studies-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 14px; }
.study-card {
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 14px;
  text-decoration: none;
  color: var(--text-main);
  display: flex;
  flex-direction: column;
  gap: 10px;
  cursor: pointer;
  transition: all 0.15s;
}
.study-card:hover { background: var(--bg-card); border-color: var(--accent); transform: translateY(-2px); box-shadow: 0 6px 16px rgba(0,0,0,0.4); }
.card-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; }
.card-title { font-size: 13.5px; font-weight: 700; color: #fff; }
.modality-badge {
  background: rgba(0, 127, 189, 0.2);
  color: #38bdf8;
  border: 1px solid #007fbd;
  font-size: 9.5px;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: 4px;
}
.card-thumb-wrap { width: 100%; height: 160px; background: #04070a; border-radius: 6px; overflow: hidden; display: flex; align-items: center; justify-content: center; border: 1px solid var(--border-subtle); }
.card-thumb { width: 100%; height: 100%; object-fit: contain; }
.card-meta { display: flex; justify-content: space-between; font-size: 11.5px; color: var(--text-muted); }
.btn-open-viewer { background: var(--accent); color: #fff; font-weight: 600; font-size: 12px; padding: 7px; border-radius: 5px; text-align: center; }
.study-card:hover .btn-open-viewer { background: #0284c7; }

.dicom-banner {
  background: rgba(16, 185, 129, 0.08);
  border: 1px solid rgba(16, 185, 129, 0.25);
  border-radius: 8px;
  padding: 12px 16px;
  display: flex;
  align-items: center;
  gap: 12px;
}
.dicom-banner-icon { font-size: 24px; }
.dicom-banner-text b { color: #10b981; font-size: 13.5px; display: block; margin-bottom: 2px; }
.dicom-banner-text span { font-size: 12px; color: var(--text-muted); }
"""


def _page(title: str, body: str, custom_css: str = "") -> str:
    return (
        "<!DOCTYPE html>\n"
        f'<html lang="vi"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width, initial-scale=1">'
        f"<title>{_escape(title)}</title>"
        f"<style>{custom_css}</style>"
        f"</head><body>{body}</body></html>"
    )


def _study_html(
    patient: dict,
    all_studies: list[ExportStudy],
    initial_study_idx: int = 0,
    has_dicom: bool = False,
) -> str:
    """Build the Interactive Web PACS Viewer HTML page matching Dcom to JPG app structure 1:1."""
    studies_payload = []
    for st_idx, st in enumerate(all_studies):
        series_data = []
        for s_idx, ser in enumerate(st.series):
            def img_src(image: Path) -> str:
                return _relative_url(
                    "images", st.folder.name, ser.relative.as_posix(), image.name,
                )

            img_urls = [img_src(img) for img in ser.images]
            series_data.append({
                "id": f"st{st_idx}_s{s_idx}",
                "name": ser.name,
                "description": ser.description,
                "modality": ser.modality,
                "institution": ser.institution,
                "images": img_urls,
                "count": len(img_urls),
                "keyIndex": len(img_urls) // 2 if img_urls else 0,
            })

        docs_data = [
            {"name": doc.name, "url": _relative_url("documents", st.folder.name, doc.name)}
            for doc in st.documents
        ]

        studies_payload.append({
            "id": f"study_{st_idx}",
            "title": st.title,
            "date": st.date,
            "modality": st.modality,
            "folderName": st.folder.name,
            "series": series_data,
            "documents": docs_data,
        })

    payload_json = json.dumps({
        "patient": patient,
        "initialStudyIdx": initial_study_idx,
        "studies": studies_payload,
        "hasDicom": has_dicom,
    }, ensure_ascii=False).replace("<", "\\u003c")

    initial_study = all_studies[initial_study_idx] if 0 <= initial_study_idx < len(all_studies) else all_studies[0]

    # Exact SVG icons from Dcom to JPG webui/src/main.js
    icons = {
        "window": "◐",
        "pan": '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 11V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v0"/><path d="M14 7.5a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v0"/><path d="M10 8a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v0"/><path d="M6 9a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v0"/><path d="M18 11v1a8 8 0 1 1-16 0v-2.5"/></svg>',
        "zoom": '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>',
        "scroll": '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg>',
        "crosshair": '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="22" x2="18" y1="12" y2="12"/><line x1="6" x2="2" y1="12" y2="12"/><line x1="12" x2="12" y1="6" y2="2"/><line x1="12" x2="12" y1="22" y2="18"/></svg>',
        "length": '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.41 2.41 0 0 1 0-3.4l2.6-2.6a2.41 2.41 0 0 1 3.4 0Z"/><path d="m14.5 12.5 2-2"/><path d="m11.5 9.5 2-2"/><path d="m8.5 6.5 2-2"/><path d="m17.5 15.5 2-2"/></svg>',
        "angle": "∠",
        "ellipse": '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/></svg>',
        "freehand": '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/></svg>',
        "text": '<svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" x2="15" y1="20" y2="20"/><line x1="12" x2="12" y1="4" y2="20"/></svg>',
        "magnify": '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10" cy="10" r="7"/><line x1="10" y1="7" x2="10" y2="13"/><line x1="7" y1="10" x2="13" y2="10"/><path d="m21 21-5.2-5.2"/></svg>',
        "rotateClockwise": '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"></path><path d="M21 3v5h-5"></path><rect x="8.5" y="8.5" width="7" height="7" rx="1" transform="rotate(45 12 12)"></rect></svg>',
        "flipHorizontal": '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 21h8a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2Z"/><path d="M12 2v20"/></svg>',
        "flipVertical": '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v3"/><path d="M21 16v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3"/><path d="M4 12h16"/></svg>',
        "invert": '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 18a6 6 0 0 0 0-12v12z"/></svg>',
        "reset": '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>',
        "clearAnnotations": '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/><path d="M22 21H7"/><path d="m5 11 9 9"/></svg>',
        "scrollSync": '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>',
        "single": '<svg viewBox="0 0 24 24" aria-hidden="true"><rect width="18" height="18" x="3" y="3" rx="2"/></svg>',
        "compare": '<svg viewBox="0 0 24 24" aria-hidden="true"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M12 3v18"/></svg>',
        "compare3": '<svg viewBox="0 0 24 24" aria-hidden="true"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/><path d="M15 3v18"/></svg>',
        "montage6": '<svg viewBox="0 0 24 24" aria-hidden="true"><rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/></svg>',
        "info": '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
    }

    js_script = r"""
<script>
const DATA = """ + payload_json + r""";

const MAX_VP = 4;
let activeVp = 0;
let layout = "1x1"; // '1x1' | '1x2' | '1x3' | '2x2'
const LAYOUT_VIEWPORTS = { "1x1": 1, "1x2": 2, "1x3": 3, "2x2": 4 };
// How many panes the current layout shows. Every caller has to agree on this,
// so a new layout is added here once rather than in each of them.
function visibleViewportCount() {
  return LAYOUT_VIEWPORTS[layout] || 1;
}
let activeTool = "window"; // 'window' | 'pan' | 'zoom' | 'scroll' | 'crosshair' | 'length' | 'angle' | 'ellipse' | 'freehand' | 'text' | 'magnify'
let syncScroll = true;
let syncCrosshair = true;
let playInterval = null;
let playFps = 20;

const viewports = [];
for (let i = 0; i < MAX_VP; i++) {
  viewports.push({
    id: i,
    studyIdx: DATA.initialStudyIdx || 0,
    seriesIdx: 0,
    slice: 0,
    zoom: 1.0,
    panX: 0,
    panY: 0,
    rotation: 0,
    flipH: false,
    flipV: false,
    invert: false,
    brightness: 100,
    contrast: 100,
    annotations: [],
    isDragging: false,
    dragStart: { x: 0, y: 0 },
    tempAnnotation: null,
  });
}

function init() {
  buildTimelineRail();
  buildSeriesStrip();
  initViewportHeaders();
  setLayout("1x1");
  setupGlobalEvents();
}

function currentStudy(vpIdx = activeVp) {
  const vp = viewports[vpIdx];
  return DATA.studies[vp.studyIdx] || DATA.studies[0];
}

function currentSeries(vpIdx = activeVp) {
  const st = currentStudy(vpIdx);
  const vp = viewports[vpIdx];
  return st?.series[vp.seriesIdx] || st?.series[0];
}

function buildTimelineRail() {
  const tl = document.getElementById('timeline-container');
  if (!tl) return;
  tl.innerHTML = DATA.studies.map((st, idx) => `
    <div class="tl-item" data-study-idx="${idx}" onclick="scrollToStudy(${idx})" title="Xem các chuỗi xung ngày ${st.date || ''}">
      <div class="tl-item-title">${st.modality || 'MR'} - ${st.date || 'Chưa rõ ngày'}</div>
      <div class="tl-item-meta">${st.folderName || st.title}</div>
    </div>
  `).join('');
}

function buildSeriesStrip() {
  const container = document.getElementById('series-strip-container');
  if (!container) return;
  
  let html = '';
  DATA.studies.forEach((st, stIdx) => {
    const dateLabel = st.date || 'Chưa rõ ngày';
    html += `
      <div class="series-group-badge" data-study-idx="${stIdx}">
        <span class="badge-date">📁 ${dateLabel}</span>
        <span class="badge-study">${st.modality || ''} · ${st.folderName || st.title}</span>
      </div>
    `;
    st.series.forEach((ser, serIdx) => {
      const thumb = ser.images[ser.keyIndex] || ser.images[0] || '';
      html += `
        <button class="series-card" draggable="true" data-study-idx="${stIdx}" data-series-idx="${serIdx}" onclick="selectSeriesFromStrip(${stIdx}, ${serIdx})" title="${ser.description || ser.name} (Kéo vào khung hình để xem)">
          <div class="series-thumb-box">
            <img class="series-card-thumb" src="${thumb}" alt="" draggable="false">
            <span class="badge-3d">${ser.modality || 'MR'}</span>
            <div class="series-thumb-overlay">
              <b class="series-thumb-title">${ser.description || ser.name}</b>
              <span class="series-thumb-count">${ser.count}</span>
            </div>
          </div>
        </button>
      `;
    });
  });
  container.innerHTML = html;

  // Setup HTML5 Drag and Drop on series cards
  container.querySelectorAll('.series-card').forEach(card => {
    card.addEventListener('dragstart', (e) => {
      const stIdx = Number(card.dataset.studyIdx);
      const serIdx = Number(card.dataset.seriesIdx);
      e.dataTransfer.setData('text/plain', JSON.stringify({ studyIdx: stIdx, seriesIdx: serIdx }));
      e.dataTransfer.effectAllowed = 'copyMove';
      card.classList.add('is-dragging');
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('is-dragging');
      document.querySelectorAll('.viewport-shell').forEach(vp => vp.classList.remove('drop-target'));
    });
  });
}

function updateCardHighlights() {
  const maxVis = visibleViewportCount();
  
  // Update timeline study items in-place
  document.querySelectorAll('.tl-item[data-study-idx]').forEach(el => {
    const stIdx = Number(el.dataset.studyIdx);
    let isVisible = false;
    for (let v = 0; v < maxVis; v++) {
      if (viewports[v].studyIdx === stIdx) { isVisible = true; break; }
    }
    el.classList.toggle('on', isVisible);
  });

  // Update series cards in-place (never touch innerHTML or scrollTop)
  document.querySelectorAll('.series-card[data-study-idx]').forEach(card => {
    const stIdx = Number(card.dataset.studyIdx);
    const serIdx = Number(card.dataset.seriesIdx);
    const visiblePanes = [];
    for (let v = 0; v < maxVis; v++) {
      if (viewports[v].studyIdx === stIdx && viewports[v].seriesIdx === serIdx) {
        visiblePanes.push(v + 1);
      }
    }
    const isVisible = visiblePanes.length > 0;
    card.classList.toggle('active', isVisible);
    if (isVisible) {
      card.dataset.pane = visiblePanes.join(',');
    } else {
      delete card.dataset.pane;
    }
  });
}

function switchView(viewName) {
  const tabWorklist = document.getElementById('tab-worklist');
  const tabViewer = document.getElementById('tab-viewer');
  const viewWorklist = document.getElementById('view-worklist');
  const viewViewer = document.getElementById('view-viewer');

  if (viewName === 'worklist') {
    if (tabWorklist) tabWorklist.classList.add('active');
    if (tabViewer) tabViewer.classList.remove('active');
    if (viewWorklist) viewWorklist.style.display = 'flex';
    if (viewViewer) viewViewer.style.display = 'none';
  } else {
    if (tabViewer) tabViewer.classList.add('active');
    if (tabWorklist) tabWorklist.classList.remove('active');
    if (viewWorklist) viewWorklist.style.display = 'none';
    if (viewViewer) viewViewer.style.display = 'flex';
    const visibleCount = visibleViewportCount();
    for (let v = 0; v < visibleCount; v++) {
      renderViewport(v);
    }
  }
}

function openStudyFromWorklist(stIdx) {
  switchView('viewer');
  if (stIdx >= 0 && stIdx < DATA.studies.length) {
    const vp = viewports[activeVp];
    vp.studyIdx = stIdx;
    vp.seriesIdx = 0;
    const ser = currentSeries(activeVp);
    vp.slice = ser?.keyIndex || 0;
    
    const studySel = document.getElementById(`vp-study-sel-${activeVp}`);
    if (studySel) studySel.value = String(stIdx);
    
    updateSeriesDropdown(activeVp);
    updateCardHighlights();
    resetViewport(activeVp);
    renderViewport(activeVp);
    scrollToStudy(stIdx);
  }
}

function scrollToStudy(stIdx) {
  // Auto scroll series-strip to the selected study group without altering current viewport image
  const targetBadge = document.querySelector(`.series-group-badge[data-study-idx="${stIdx}"]`);
  const targetCard = document.querySelector(`.series-card[data-study-idx="${stIdx}"]`);
  const target = targetBadge || targetCard;
  if (target) {
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function selectSeriesFromStrip(stIdx, serIdx) {
  const vp = viewports[activeVp];
  vp.studyIdx = stIdx;
  vp.seriesIdx = serIdx;
  const ser = currentSeries(activeVp);
  vp.slice = ser?.keyIndex || 0;
  
  updateSeriesDropdown(activeVp);
  updateCardHighlights();
  resetViewport(activeVp);
  renderViewport(activeVp);
}

function initViewportHeaders() {
  for (let i = 0; i < MAX_VP; i++) {
    const studySel = document.getElementById(`vp-study-sel-${i}`);
    if (studySel) {
      studySel.innerHTML = DATA.studies.map((st, idx) => `
        <option value="${idx}" ${idx === viewports[i].studyIdx ? 'selected' : ''}>${st.date || 'Ca ' + (idx + 1)}</option>
      `).join('');
      studySel.addEventListener('change', (e) => {
        viewports[i].studyIdx = Number(e.target.value);
        viewports[i].seriesIdx = 0;
        viewports[i].slice = 0;
        updateSeriesDropdown(i);
        updateCardHighlights();
        renderViewport(i);
      });
    }
    updateSeriesDropdown(i);
  }
}

function updateSeriesDropdown(i) {
  const seriesSel = document.getElementById(`vp-series-sel-${i}`);
  if (!seriesSel) return;
  const st = currentStudy(i);
  seriesSel.innerHTML = (st?.series || []).map((s, idx) => `
    <option value="${idx}" ${idx === viewports[i].seriesIdx ? 'selected' : ''}>${s.description || s.name}</option>
  `).join('');
  seriesSel.onchange = (e) => {
    viewports[i].seriesIdx = Number(e.target.value);
    const ser = currentSeries(i);
    viewports[i].slice = ser?.keyIndex || 0;
    updateCardHighlights();
    renderViewport(i);
  };
}

function setActiveViewport(idx) {
  if (activeVp !== idx) {
    activeVp = idx;
    document.querySelectorAll('.viewport-shell').forEach((el, i) => {
      el.classList.toggle('is-active', i === idx);
    });
    updateCardHighlights();
    updateScrubberBar();
    updateStatusBar();
  }
}

function setLayout(mode) {
  layout = mode;
  const grid = document.getElementById('grid-viewports');
  const classMap = {
    '1x1': 'mode-single',
    '1x2': 'mode-compare',
    '1x3': 'mode-compare3',
    '2x2': 'mode-montage6',
  };
  grid.className = `workspace-grid ${classMap[mode] || 'mode-single'}`;
  
  document.querySelectorAll('[data-layout]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.layout === mode);
  });

  const visibleCount = mode === '1x1' ? 1 : mode === '1x2' ? 2 : mode === '1x3' ? 3 : 4;
  for (let i = 0; i < MAX_VP; i++) {
    const p = document.getElementById(`viewport-shell-${i}`);
    if (p) p.style.display = i < visibleCount ? 'flex' : 'none';
    if (i < visibleCount) {
      if (i > 0 && viewports[i].seriesIdx === viewports[0].seriesIdx && currentStudy(i).series.length > i) {
        viewports[i].seriesIdx = i % currentStudy(i).series.length;
        updateSeriesDropdown(i);
      }
      renderViewport(i);
    }
  }
  updateCardHighlights();
  if (activeVp >= visibleCount) setActiveViewport(0);
}

function renderViewport(i) {
  const vp = viewports[i];
  const ser = currentSeries(i);
  if (!ser || !ser.images.length) return;
  
  const img = document.getElementById(`viewport-img-${i}`);
  if (!img) return;

  const src = ser.images[vp.slice] || ser.images[0];
  img.src = src;
  
  applyTransform(i);
  drawAnnotations(i);
  updateHUD(i);
  if (i === activeVp) {
    updateScrubberBar();
    updateStatusBar();
  }
}

function applyTransform(i) {
  const vp = viewports[i];
  const img = document.getElementById(`viewport-img-${i}`);
  if (!img) return;

  const scaleX = (vp.flipH ? -1 : 1) * vp.zoom;
  const scaleY = (vp.flipV ? -1 : 1) * vp.zoom;
  
  img.style.transform = `translate(${vp.panX}px, ${vp.panY}px) rotate(${vp.rotation}deg) scale(${scaleX}, ${scaleY})`;
  
  let filterStr = `brightness(${vp.brightness}%) contrast(${vp.contrast}%)`;
  if (vp.invert) filterStr += ' invert(100%)';
  img.style.filter = filterStr;
}

function updateHUD(i) {
  const vp = viewports[i];
  const ser = currentSeries(i);
  const st = currentStudy(i);
  
  const elSlice = document.getElementById(`hud-slice-${i}`);
  const elZoom = document.getElementById(`hud-zoom-${i}`);
  const elSeries = document.getElementById(`hud-series-${i}`);
  const elWl = document.getElementById(`hud-wl-${i}`);
  const elDate = document.getElementById(`hud-date-${i}`);
  
  if (elSlice) elSlice.textContent = `IM: ${vp.slice + 1}/${ser?.count || 1}`;
  if (elZoom) elZoom.textContent = `Mag: ${Math.round(vp.zoom * 100)}%`;
  if (elSeries) elSeries.textContent = ser?.description || ser?.name || '—';
  if (elWl) elWl.textContent = `W: ${vp.contrast} L: ${vp.brightness}`;
  if (elDate) elDate.textContent = st?.date || '—';
}

function updateScrubberBar() {
  const vp = viewports[activeVp];
  const ser = currentSeries(activeVp);
  const slider = document.getElementById(`slice-range-${activeVp}`);
  const tag = document.getElementById(`slice-tag-${activeVp}`);
  
  if (slider && ser) {
    slider.max = Math.max(0, ser.count - 1);
    slider.value = vp.slice;
  }
  if (tag && ser) {
    tag.textContent = `${vp.slice + 1}/${ser.count}`;
  }
}

function updateStatusBar() {
  const vp = viewports[activeVp];
  const ser = currentSeries(activeVp);
  const st = currentStudy(activeVp);
  const statusEl = document.getElementById('status-bar-text');
  if (statusEl && ser) {
    statusEl.textContent = `${DATA.patient.patientName || 'Bệnh nhân'} • ${st.date || ''} • ${ser.description || ser.name} • Lát ${vp.slice + 1}/${ser.count} • Zoom: ${Math.round(vp.zoom * 100)}% • W/L: ${vp.contrast}/${vp.brightness}`;
  }
}

function setSlice(val, vpIdx = activeVp) {
  const vp = viewports[vpIdx];
  const ser = currentSeries(vpIdx);
  if (!ser) return;
  
  vp.slice = Math.max(0, Math.min(ser.count - 1, val));
  renderViewport(vpIdx);
  
  if (syncScroll) {
    const ratio = ser.count > 1 ? vp.slice / (ser.count - 1) : 0;
    const maxVisible = visibleViewportCount();
    for (let i = 0; i < maxVisible; i++) {
      if (i !== vpIdx) {
        const otherSer = currentSeries(i);
        if (otherSer && otherSer.count > 1) {
          viewports[i].slice = Math.round(ratio * (otherSer.count - 1));
          renderViewport(i);
        }
      }
    }
  }
}

function stepSlice(delta) {
  setSlice(viewports[activeVp].slice + delta);
}

function setTool(toolName) {
  activeTool = toolName;
  document.querySelectorAll('[data-tool]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tool === toolName);
  });
}

function setWindowPreset(preset) {
  const vp = viewports[activeVp];
  switch (preset) {
    case 'brain': vp.brightness = 110; vp.contrast = 140; break;
    case 'bone': vp.brightness = 90; vp.contrast = 220; break;
    case 'soft': vp.brightness = 105; vp.contrast = 130; break;
    case 'lung': vp.brightness = 85; vp.contrast = 180; break;
    case 'stroke': vp.brightness = 115; vp.contrast = 160; break;
    default: vp.brightness = 100; vp.contrast = 100; break;
  }
  applyTransform(activeVp);
  updateHUD(activeVp);
  updateStatusBar();
}

function rotateCW() {
  const vp = viewports[activeVp];
  vp.rotation = (vp.rotation + 90) % 360;
  applyTransform(activeVp);
}

function flipHorizontal() {
  const vp = viewports[activeVp];
  vp.flipH = !vp.flipH;
  applyTransform(activeVp);
}

function flipVertical() {
  const vp = viewports[activeVp];
  vp.flipV = !vp.flipV;
  applyTransform(activeVp);
}

function toggleInvert() {
  const vp = viewports[activeVp];
  vp.invert = !vp.invert;
  applyTransform(activeVp);
}

function resetViewport(idx = activeVp) {
  const vp = viewports[idx];
  vp.zoom = 1.0;
  vp.panX = 0;
  vp.panY = 0;
  vp.rotation = 0;
  vp.flipH = false;
  vp.flipV = false;
  vp.invert = false;
  vp.brightness = 100;
  vp.contrast = 100;
  applyTransform(idx);
  updateHUD(idx);
  updateStatusBar();
}

function resetAllViewports() {
  for (let i = 0; i < MAX_VP; i++) resetViewport(i);
}

function clearAnnotations() {
  viewports[activeVp].annotations = [];
  drawAnnotations(activeVp);
}

function toggleSyncScroll() {
  syncScroll = !syncScroll;
  document.getElementById('btn-sync-scroll')?.classList.toggle('active', syncScroll);
}

function toggleSyncCrosshair() {
  syncCrosshair = !syncCrosshair;
  document.getElementById('btn-sync-crosshair')?.classList.toggle('active', syncCrosshair);
  if (!syncCrosshair) {
    for (let i = 0; i < MAX_VP; i++) drawAnnotations(i);
  }
}

function togglePlay() {
  // The running timer is what "playing" means, so the button is read back off
  // it rather than off a second flag that can fall out of step with it.
  if (playInterval !== null) {
    clearInterval(playInterval);
    playInterval = null;
  } else {
    playInterval = setInterval(() => {
      const ser = currentSeries(activeVp);
      if (!ser || ser.count <= 1) return;
      const nextSlice = (viewports[activeVp].slice + 1) % ser.count;
      setSlice(nextSlice);
    }, 1000 / playFps);
  }
  document.querySelectorAll('.cine-btn').forEach(btn => {
    btn.innerHTML = playInterval !== null ? '⏸' : '▶';
  });
}

function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => {});
  } else {
    document.exitFullscreen().catch(() => {});
  }
}

function toggleShortcuts() {
  const modal = document.getElementById('modal-shortcuts');
  if (modal) modal.style.display = modal.style.display === 'none' ? 'flex' : 'none';
}

function drawAnnotations(vpIdx) {
  const canvas = document.getElementById(`annotation-canvas-${vpIdx}`);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  
  if (canvas.width !== canvas.clientWidth || canvas.height !== canvas.clientHeight) {
    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;
  }
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  const vp = viewports[vpIdx];
  const items = [...vp.annotations];
  if (vp.tempAnnotation) items.push(vp.tempAnnotation);

  ctx.strokeStyle = '#00b0f0';
  ctx.fillStyle = '#00b0f0';
  ctx.lineWidth = 1.5;
  ctx.font = '11px ' + getComputedStyle(document.body).getPropertyValue('--mono-font');

  items.forEach(ann => {
    if (ann.type === 'length' && ann.p1 && ann.p2) {
      ctx.beginPath();
      ctx.moveTo(ann.p1.x, ann.p1.y);
      ctx.lineTo(ann.p2.x, ann.p2.y);
      ctx.stroke();
      
      const dist = Math.hypot(ann.p2.x - ann.p1.x, ann.p2.y - ann.p1.y) / vp.zoom;
      const midX = (ann.p1.x + ann.p2.x) / 2;
      const midY = (ann.p1.y + ann.p2.y) / 2;
      ctx.fillText(`${dist.toFixed(1)} px`, midX + 5, midY - 5);
    } else if (ann.type === 'angle' && ann.p1 && ann.p2) {
      ctx.beginPath();
      ctx.moveTo(ann.p1.x, ann.p1.y);
      ctx.lineTo(ann.p2.x, ann.p2.y);
      if (ann.p3) {
        ctx.lineTo(ann.p3.x, ann.p3.y);
        const a1 = Math.atan2(ann.p1.y - ann.p2.y, ann.p1.x - ann.p2.x);
        const a2 = Math.atan2(ann.p3.y - ann.p2.y, ann.p3.x - ann.p2.x);
        let deg = Math.abs((a1 - a2) * 180 / Math.PI);
        if (deg > 180) deg = 360 - deg;
        ctx.fillText(`${deg.toFixed(1)}°`, ann.p2.x + 8, ann.p2.y - 8);
      }
      ctx.stroke();
    } else if (ann.type === 'ellipse' && ann.p1 && ann.p2) {
      const cx = (ann.p1.x + ann.p2.x) / 2;
      const cy = (ann.p1.y + ann.p2.y) / 2;
      const rx = Math.abs(ann.p2.x - ann.p1.x) / 2;
      const ry = Math.abs(ann.p2.y - ann.p1.y) / 2;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.stroke();
      const area = (Math.PI * (rx / vp.zoom) * (ry / vp.zoom)).toFixed(0);
      ctx.fillText(`Area: ${area} px²`, cx + 6, cy - 6);
    }
  });

  if (syncCrosshair && vp.crosshair) {
    ctx.strokeStyle = 'rgba(0, 176, 240, 0.7)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(vp.crosshair.x, 0);
    ctx.lineTo(vp.crosshair.x, canvas.height);
    ctx.moveTo(0, vp.crosshair.y);
    ctx.lineTo(canvas.width, vp.crosshair.y);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

function setupGlobalEvents() {
  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); stepSlice(1); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); stepSlice(-1); }
    else if (e.key === ' ') { e.preventDefault(); togglePlay(); }
    else if (e.key === 'r' || e.key === 'R') { resetAllViewports(); }
    else if (e.key === 'i' || e.key === 'I') { toggleInvert(); }
    else if (e.key === 'f' || e.key === 'F') { toggleFullscreen(); }
    else if (e.key === '1') { setLayout('1x1'); }
    else if (e.key === '2') { setLayout('1x2'); }
    else if (e.key === '3') { setLayout('1x3'); }
    else if (e.key === '4') { setLayout('2x2'); }
    else if (e.key === 'w' || e.key === 'W') { setTool('window'); }
    else if (e.key === 'p' || e.key === 'P') { setTool('pan'); }
    else if (e.key === 'z' || e.key === 'Z') { setTool('zoom'); }
    else if (e.key === 's' || e.key === 'S') { setTool('scroll'); }
    else if (e.key === 'l' || e.key === 'L') { setTool('length'); }
  });

  for (let i = 0; i < MAX_VP; i++) {
    setupViewportMouseEvents(i);
  }
}

function setupViewportMouseEvents(idx) {
  const container = document.getElementById(`viewport-shell-${idx}`);
  if (!container) return;
  const vp = viewports[idx];

  // HTML5 Drag and Drop handlers for series dropping
  container.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    container.classList.add('drop-target');
  });
  container.addEventListener('dragleave', (e) => {
    if (!container.contains(e.relatedTarget)) {
      container.classList.remove('drop-target');
    }
  });
  container.addEventListener('drop', (e) => {
    e.preventDefault();
    container.classList.remove('drop-target');
    try {
      const raw = e.dataTransfer.getData('text/plain');
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data.studyIdx !== undefined && data.seriesIdx !== undefined) {
        viewports[idx].studyIdx = data.studyIdx;
        viewports[idx].seriesIdx = data.seriesIdx;
        const stSel = document.getElementById(`vp-study-sel-${idx}`);
        if (stSel) stSel.value = data.studyIdx;
        updateSeriesDropdown(idx);
        const ser = currentSeries(idx);
        viewports[idx].slice = ser?.keyIndex || 0;
        setActiveViewport(idx);
        updateCardHighlights();
        resetViewport(idx);
        renderViewport(idx);
      }
    } catch (err) {
      console.error('Drop error:', err);
    }
  });

  container.addEventListener('wheel', (e) => {
    e.preventDefault();
    setActiveViewport(idx);
    if (e.ctrlKey) {
      vp.zoom = Math.max(0.2, Math.min(10.0, vp.zoom + (e.deltaY < 0 ? 0.15 : -0.15)));
      applyTransform(idx);
      updateHUD(idx);
      updateStatusBar();
    } else {
      setSlice(vp.slice + (e.deltaY > 0 ? 1 : -1), idx);
    }
  }, { passive: false });

  container.addEventListener('mousedown', (e) => {
    if (e.target.closest('.viewport-header-strip') || e.target.closest('.slice-control')) return;
    setActiveViewport(idx);
    vp.isDragging = true;
    vp.dragStart = { x: e.clientX, y: e.clientY };
    const rect = container.getBoundingClientRect();
    const pt = { x: e.clientX - rect.left, y: e.clientY - rect.top };

    if (activeTool === 'length' && e.buttons === 1) {
      vp.tempAnnotation = { type: 'length', p1: pt, p2: pt };
    } else if (activeTool === 'angle' && e.buttons === 1) {
      if (!vp.tempAnnotation) {
        vp.tempAnnotation = { type: 'angle', p1: pt, p2: pt };
      } else if (!vp.tempAnnotation.p3) {
        vp.tempAnnotation.p3 = pt;
        vp.annotations.push(vp.tempAnnotation);
        vp.tempAnnotation = null;
        drawAnnotations(idx);
      }
    } else if (activeTool === 'ellipse' && e.buttons === 1) {
      vp.tempAnnotation = { type: 'ellipse', p1: pt, p2: pt };
    }
  });

  window.addEventListener('mousemove', (e) => {
    if (syncCrosshair) {
      const rect = container.getBoundingClientRect();
      if (e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom) {
        const normX = (e.clientX - rect.left) / rect.width;
        const normY = (e.clientY - rect.top) / rect.height;
        const maxVis = visibleViewportCount();
        for (let v = 0; v < maxVis; v++) {
          const c = document.getElementById(`viewport-shell-${v}`);
          if (c) {
            viewports[v].crosshair = { x: normX * c.clientWidth, y: normY * c.clientHeight };
            drawAnnotations(v);
          }
        }
      }
    }

    if (!vp.isDragging || activeVp !== idx) return;
    const dx = e.clientX - vp.dragStart.x;
    const dy = e.clientY - vp.dragStart.y;
    vp.dragStart = { x: e.clientX, y: e.clientY };
    const rect = container.getBoundingClientRect();
    const pt = { x: e.clientX - rect.left, y: e.clientY - rect.top };

    if (e.buttons === 2 || (activeTool === 'window' && e.buttons === 1)) {
      vp.brightness = Math.max(10, Math.min(300, vp.brightness - dy * 0.5));
      vp.contrast = Math.max(10, Math.min(300, vp.contrast + dx * 0.5));
      applyTransform(idx);
      updateHUD(idx);
      updateStatusBar();
    } else if (activeTool === 'pan' && e.buttons === 1) {
      vp.panX += dx;
      vp.panY += dy;
      applyTransform(idx);
    } else if (activeTool === 'zoom' && e.buttons === 1) {
      vp.zoom = Math.max(0.2, Math.min(10.0, vp.zoom - dy * 0.01));
      applyTransform(idx);
      updateHUD(idx);
      updateStatusBar();
    } else if (activeTool === 'scroll' && e.buttons === 1) {
      if (Math.abs(dy) > 4) {
        setSlice(vp.slice + (dy > 0 ? 1 : -1), idx);
        vp.dragStart.y = e.clientY;
      }
    } else if ((activeTool === 'length' || activeTool === 'ellipse') && vp.tempAnnotation) {
      vp.tempAnnotation.p2 = pt;
      drawAnnotations(idx);
    } else if (activeTool === 'angle' && vp.tempAnnotation) {
      if (!vp.tempAnnotation.p3) {
        vp.tempAnnotation.p2 = pt;
      } else {
        vp.tempAnnotation.p3 = pt;
      }
      drawAnnotations(idx);
    }
  });

  window.addEventListener('mouseup', () => {
    if (vp.isDragging && activeVp === idx) {
      if ((activeTool === 'length' || activeTool === 'ellipse') && vp.tempAnnotation) {
        vp.annotations.push(vp.tempAnnotation);
        vp.tempAnnotation = null;
        drawAnnotations(idx);
      }
      vp.isDragging = false;
    }
  });

  container.addEventListener('dblclick', (e) => {
    if (e.target.closest('.viewport-header-strip') || e.target.closest('.slice-control')) return;
    resetViewport(idx);
  });
  container.addEventListener('contextmenu', (e) => e.preventDefault());
}

window.addEventListener('DOMContentLoaded', init);
window.addEventListener('resize', () => {
  for (let i = 0; i < MAX_VP; i++) drawAnnotations(i);
});
</script>
"""

    viewport_shells_html = []
    for i in range(4):
        viewport_shells_html.append(f"""
      <div class="viewport-shell { 'is-active' if i == 0 else '' }" id="viewport-shell-{i}" style="{ '' if i == 0 else 'display:none;' }">
        <div class="viewport-header-strip">
          <span class="vp-badge">PANE {i+1}</span>
          <select class="vp-select" id="vp-study-sel-{i}"></select>
          <select class="vp-select" id="vp-series-sel-{i}"></select>
        </div>

        <div class="viewport-overlay overlay-tl">
          <div><b id="hud-name-{i}">{_escape(patient.get('patientName') or 'Bệnh nhân')}</b> ({_or_dash(patient.get('patientId'))})</div>
          <div>{_sex_label(patient.get('patientSex') or '')} · {_or_dash(patient.get('patientBirthDate'))}</div>
        </div>
        <div class="viewport-overlay overlay-tr">
          <div id="hud-date-{i}">{_or_dash(initial_study.date)}</div>
          <div>{_or_dash(patient.get('hospitalName'))}</div>
        </div>
        <div class="viewport-overlay overlay-bl">
          <div id="hud-series-{i}">—</div>
          <div id="hud-wl-{i}" class="mono">W: 100 L: 100</div>
        </div>
        <div class="viewport-overlay overlay-br mono">
          <div id="hud-slice-{i}">IM: 1/1</div>
          <div id="hud-zoom-{i}">Mag: 100%</div>
        </div>

        <span class="orientation-marker orientation-t">A</span>
        <span class="orientation-marker orientation-b">P</span>
        <span class="orientation-marker orientation-l">R</span>
        <span class="orientation-marker orientation-r">L</span>

        <img class="viewport-img" id="viewport-img-{i}" alt="PACS Canvas">
        <canvas class="annotation-canvas" id="annotation-canvas-{i}"></canvas>

        <div class="slice-control">
          <button class="cine-btn" onclick="togglePlay()" title="Cine loop (Phím Space)">▶</button>
          <button class="cine-btn" onclick="stepSlice(-1)" title="Lát trước (Phím ←)">‹</button>
          <input type="range" id="slice-range-{i}" min="0" max="0" value="0" oninput="setSlice(Number(this.value), {i})">
          <button class="cine-btn" onclick="stepSlice(1)" title="Lát sau (Phím →)">›</button>
          <span class="mono" id="slice-tag-{i}" style="font-size:10px;min-width:32px;text-align:right;">1/1</span>
        </div>
      </div>
        """)

    cards = []
    for st_idx, st in enumerate(all_studies):
        first_img = ""
        for s in st.series:
            if s.images:
                first_img = _relative_url("images", st.folder.name, s.relative.as_posix(), s.images[0].name)
                break

        thumb_html = (
            f'<div class="card-thumb-wrap"><img class="card-thumb" src="{_escape(first_img)}" alt=""></div>'
            if first_img else ""
        )
        cards.append(
            f'<div class="study-card" onclick="openStudyFromWorklist({st_idx})">'
            f'<div class="card-top">'
            f'<div class="card-title">{_or_dash(st.title)}</div>'
            f'<span class="modality-badge">{_or_dash(st.modality)}</span>'
            '</div>'
            f'{thumb_html}'
            f'<div class="card-meta"><span>📅 {_format_date_only(st.date)}</span><span>🎞 {len(st.series)} series · {st.image_count()} ảnh</span></div>'
            f'<div class="btn-open-viewer">Mở Web PACS Viewer ➔</div>'
            '</div>'
        )

    dicom_banner_html = (
        '<div class="dicom-banner">'
        '<div class="dicom-banner-icon">📁</div>'
        '<div class="dicom-banner-text">'
        '<b>Bao gồm dữ liệu file gốc DICOM</b>'
        '<span>Thư mục <code>DICOM/</code> chứa đầy đủ các file chụp gốc chất lượng cao dành cho các phần mềm PACS chuyên dụng.</span>'
        '</div>'
        '</div>'
        if has_dicom else ""
    )

    viewer_body = f"""
<!-- Winbar Navigation -->
<nav class="winbar">
  <div class="winbar-tab" id="tab-worklist" onclick="switchView('worklist')">
    <span>📋</span>
    <span>Danh sách ca chụp</span>
  </div>
  <div class="winbar-tab active" id="tab-viewer" onclick="switchView('viewer')">
    <span>👤</span>
    <span>{_escape(patient.get('patientName') or 'Bệnh nhân')}</span>
    <span class="tab-fmt-badge">{_escape(initial_study.modality or 'MR')} - VIEWER</span>
  </div>
</nav>

<!-- View 1: Worklist View (Danh sách ca chụp) -->
<div id="view-worklist" class="worklist-container" style="display:none;">
  <div class="worklist-inner">
    <header class="patient-header">
      <div class="fields">
        <span><b>Họ và tên:</b> {_escape(patient.get('patientName') or UNKNOWN)}</span>
        <span><b>Mã BN:</b> {_or_dash(patient.get('patientId'))}</span>
        <span><b>Ngày sinh:</b> {_or_dash(patient.get('patientBirthDate'))}</span>
        <span><b>Giới tính:</b> {_sex_label(patient.get('patientSex') or '') or UNKNOWN}</span>
        <span><b>Cơ sở:</b> {_or_dash(patient.get('hospitalName'))}</span>
      </div>
    </header>
    {dicom_banner_html}
    <div class="section-title">Danh sách ca chụp ({len(all_studies)})</div>
    <div class="studies-grid">{''.join(cards)}</div>
  </div>
</div>

<!-- View 2: Diagnostic PACS Viewer (Chế độ đọc phim) -->
<div id="view-viewer" class="viewer-layout-wrap">
  <!-- Toolbar Groups (1:1 from Dcom to JPG) -->
  <header class="viewer-toolbar">
    <!-- Nav tools -->
    <div class="tool-cluster nav-tools">
      <button class="icon-button active" data-tool="window" onclick="setTool('window')" title="Sáng / Tương phản (W/L: phím W)">{icons['window']}</button>
      <button class="icon-button" data-tool="pan" onclick="setTool('pan')" title="Di chuyển ảnh (Pan: phím P)">{icons['pan']}</button>
      <button class="icon-button" data-tool="zoom" onclick="setTool('zoom')" title="Thu / Phóng (Zoom: phím Z)">{icons['zoom']}</button>
      <button class="icon-button" data-tool="scroll" onclick="setTool('scroll')" title="Cuộn lát cắt (Scroll: phím S)">{icons['scroll']}</button>
      <button class="icon-button" data-tool="crosshair" onclick="setTool('crosshair')" title="Định vị con trỏ">{icons['crosshair']}</button>
    </div>

    <span class="toolbar-divider"></span>

    <!-- Measure tools -->
    <div class="tool-cluster measure-tools">
      <button class="icon-button" data-tool="length" onclick="setTool('length')" title="Đo chiều dài (Caliper: phím L)">{icons['length']}</button>
      <button class="icon-button" data-tool="angle" onclick="setTool('angle')" title="Đo góc (Angle)">{icons['angle']}</button>
      <button class="icon-button" data-tool="ellipse" onclick="setTool('ellipse')" title="ROI ellipse">{icons['ellipse']}</button>
      <button class="icon-button" data-tool="freehand" onclick="setTool('freehand')" title="ROI tự do">{icons['freehand']}</button>
      <button class="icon-button" data-tool="text" onclick="setTool('text')" title="Ghi chú chữ lên ảnh">{icons['text']}</button>
      <button class="icon-button" data-tool="magnify" onclick="setTool('magnify')" title="Kính lúp">{icons['magnify']}</button>
    </div>

    <span class="toolbar-divider"></span>

    <!-- Orientation tools -->
    <div class="tool-cluster orientation-tools">
      <button class="icon-button" onclick="rotateCW()" title="Xoay 90°">{icons['rotateClockwise']}</button>
      <button class="icon-button" onclick="flipHorizontal()" title="Lật ngang">{icons['flipHorizontal']}</button>
      <button class="icon-button" onclick="flipVertical()" title="Lật dọc">{icons['flipVertical']}</button>
      <button class="icon-button" onclick="toggleInvert()" title="Đảo màu (phím I)">{icons['invert']}</button>
      <button class="icon-button" onclick="resetViewport()" title="Đặt lại góc nhìn (phím R)">{icons['reset']}</button>
      <button class="icon-button" onclick="clearAnnotations()" title="Xóa đo đạc & ghi chú">{icons['clearAnnotations']}</button>
    </div>

    <span class="toolbar-divider"></span>

    <!-- Window Presets Selector -->
    <div class="tool-cluster">
      <select class="window-select" onchange="setWindowPreset(this.value)" title="Cửa sổ W/L">
        <option value="default">Cửa sổ mặc định</option>
        <option value="brain">Nhu mô não (Brain)</option>
        <option value="bone">Cửa sổ xương (Bone)</option>
        <option value="soft">Mô mềm (Soft Tissue)</option>
        <option value="lung">Cửa sổ phổi (Lung)</option>
        <option value="stroke">Đột quỵ (Stroke)</option>
      </select>
    </div>

    <span class="toolbar-divider"></span>

    <!-- Compare & Sync Tools -->
    <div class="tool-cluster compare-tools">
      <button class="icon-button active" id="btn-sync-scroll" onclick="toggleSyncScroll()" title="Khoá cuộn đồng bộ">{icons['scrollSync']}</button>
      <button class="icon-button active" id="btn-sync-crosshair" onclick="toggleSyncCrosshair()" title="Con trỏ tham chiếu">{icons['crosshair']}</button>
    </div>

    <span class="toolbar-divider"></span>

    <!-- Layout cluster -->
    <div class="tool-cluster layout-tools">
      <button class="icon-button active" data-layout="1x1" onclick="setLayout('1x1')" title="1 Khung hình (phím 1)">{icons['single']}</button>
      <button class="icon-button" data-layout="1x2" onclick="setLayout('1x2')" title="So sánh 2 khung (phím 2)">{icons['compare']}</button>
      <button class="icon-button" data-layout="1x3" onclick="setLayout('1x3')" title="So sánh 3 khung (phím 3)">{icons['compare3']}</button>
      <button class="icon-button" data-layout="2x2" onclick="setLayout('2x2')" title="Lưới 4 khung hình (phím 4)">{icons['montage6']}</button>
    </div>

    <div style="flex:1;"></div>

    <!-- Output & Info -->
    <div class="tool-cluster output-tools">
      <button class="icon-button" onclick="toggleFullscreen()" title="Toàn màn hình (phím F)">⛶</button>
      <button class="icon-button" onclick="toggleShortcuts()" title="Phím tắt">{icons['info']}</button>
    </div>
  </header>

  <!-- 3-Column Workstation App Shell -->
  <div class="app-shell">
    <!-- Col 1: Patient Record Rail -->
    <aside class="rec-rail">
      <div class="rec-card">
        <div class="rec-card-header">
          <b>👤 Thông tin bệnh nhân</b>
        </div>
        <dl class="rfacts">
          <div class="rfact"><dt>Họ tên</dt><dd><b>{_escape(patient.get('patientName') or UNKNOWN)}</b></dd></div>
          <div class="rfact"><dt>Mã BN</dt><dd>{_or_dash(patient.get('patientId'))}</dd></div>
          <div class="rfact"><dt>Giới tính</dt><dd>{_sex_label(patient.get('patientSex') or '') or UNKNOWN}</dd></div>
          <div class="rfact"><dt>Ngày sinh</dt><dd>{_or_dash(patient.get('patientBirthDate'))}</dd></div>
          <div class="rfact"><dt>Điện thoại</dt><dd>{_or_dash(patient.get('phone'))}</dd></div>
          <div class="rfact"><dt>Cơ sở</dt><dd>{_or_dash(patient.get('hospitalName'))}</dd></div>
        </dl>
      </div>

      <div class="rec-timeline-head"><b>Lịch sử khám ({len(all_studies)})</b></div>
      <div class="tl" id="timeline-container"></div>
    </aside>

    <!-- Col 2: Series Strip -->
    <aside class="series-strip" id="series-strip-container"></aside>

    <!-- Col 3: Main Diagnostic Stage -->
    <main class="viewer-main">
      <div class="workspace-grid mode-single" id="grid-viewports">
        {''.join(viewport_shells_html)}
      </div>

      <footer class="status-bar">
        <span class="status-dot"></span>
        <span class="status-text" id="status-bar-text">Sẵn sàng đọc phim.</span>
      </footer>
    </main>
  </div>
</div>

<!-- Shortcuts Modal -->
<div class="modal-overlay" id="modal-shortcuts" style="display:none;" onclick="if(event.target===this) toggleShortcuts();">
  <div class="modal-card">
    <h3>⌨ Phím tắt điều khiển DCOM Web PACS Viewer</h3>
    <div class="shortcut-row"><span>Cuộn lát cắt</span><div><kbd>←</kbd> <kbd>→</kbd> hoặc <kbd>Cuộn chuột</kbd></div></div>
    <div class="shortcut-row"><span>Phát / Dừng Cine loop</span><kbd>Space</kbd></div>
    <div class="shortcut-row"><span>Phóng to / Thu nhỏ (Zoom)</span><kbd>Ctrl + Cuộn chuột</kbd></div>
    <div class="shortcut-row"><span>Chỉnh W/L (Sáng/Tương phản)</span><kbd>Kéo chuột phải</kbd></div>
    <div class="shortcut-row"><span>Bố cục 1x1, 1x2, 1x3, 2x2</span><kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> <kbd>4</kbd></div>
    <div class="shortcut-row"><span>Công cụ: W/L, Pan, Zoom, Đo</span><kbd>W</kbd> <kbd>P</kbd> <kbd>Z</kbd> <kbd>L</kbd></div>
    <div class="shortcut-row"><span>Đảo âm bản / Dương bản</span><kbd>I</kbd></div>
    <div class="shortcut-row"><span>Đặt lại góc nhìn (Reset)</span><kbd>R</kbd> hoặc <kbd>Nhấp đúp chuột</kbd></div>
    <div class="shortcut-row"><span>Toàn màn hình</span><kbd>F</kbd></div>
    <div style="margin-top:14px;text-align:right;">
      <button class="icon-button active" style="width:auto;padding:0 12px;font-size:12px;" onclick="toggleShortcuts()">Đóng</button>
    </div>
  </div>
</div>

{js_script}
"""
    return _page(initial_study.title, viewer_body, custom_css=VIEWER_CSS + "\n" + INDEX_CSS)


def _dicom_index_html(patient: dict, studies: list[ExportStudy]) -> str:
    rows = []
    for study in studies:
        rows.append(
            f'<div class="study-card">'
            f'<div class="card-top"><div class="card-title">{_or_dash(study.title)}</div>'
            f'<span class="modality-badge">{_or_dash(study.modality)}</span></div>'
            f'<div class="card-meta"><span>📅 {_or_dash(study.date)}</span><span>📁 {study.dicom_count()} file DICOM</span></div>'
            f'<div style="font-size:12px;color:var(--text-muted);margin-top:4px;">Thư mục: <code>DICOM/{study.folder.name}/</code></div>'
            f'</div>'
        )

    body = (
        '<div class="container">'
        f'{_patient_header(patient)}'
        '<div class="dicom-banner">'
        '<div class="dicom-banner-icon">📁</div>'
        '<div class="dicom-banner-text">'
        '<b>Thư mục xuất chứa file gốc DICOM</b>'
        '<span>Dữ liệu bao gồm các file ảnh DICOM gốc tiêu chuẩn y khoa, có thể mở bằng bất kỳ phần mềm đọc ảnh PACS nào.</span>'
        '</div>'
        '</div>'
        '<div class="section-title">Danh sách ca chụp DICOM</div>'
        f'<div class="studies-grid">{"".join(rows)}</div>'
        '</div>'
    )
    return _page(
        f"Hồ sơ DICOM {patient.get('patientName') or patient.get('patientId') or ''}".strip(),
        body,
        custom_css=INDEX_CSS,
    )


def export_patient_record(
    patient_folder: Path,
    destination: Path,
    *,
    mode: str = "viewer",  # see EXPORT_MODES
    log: LogFn = lambda _message: None,
    should_stop: Optional[Callable[[], bool]] = None,
) -> dict:
    """Copy a patient's JPGs, documents and/or DICOMs into a browsable patient folder."""
    patient_folder = Path(patient_folder).expanduser().resolve(strict=True)
    destination = Path(destination).expanduser().resolve()

    patient, studies = collect_record(patient_folder)
    if not studies:
        raise ValueError("Hồ sơ này chưa có ảnh JPG, tài liệu hoặc file DICOM nào để xuất.")

    patient_folder_name = _clean_patient_folder_name(patient, fallback=patient_folder.name)

    # Put exported files inside a parent folder named [Tên BN] - [Mã BN]
    if destination.name.casefold() in (patient_folder_name.casefold(), patient_folder.name.casefold()):
        target_dir = destination
    else:
        target_dir = destination / patient_folder_name

    if (
        destination == patient_folder
        or destination in patient_folder.parents
        or patient_folder in destination.parents
        or target_dir == patient_folder
        or target_dir in patient_folder.parents
        or patient_folder in target_dir.parents
    ):
        raise ValueError(
            "Thư mục xuất không được nằm trùng, nằm trên hay nằm trong thư mục hồ sơ gốc."
        )
    target_dir.mkdir(parents=True, exist_ok=True)

    export_viewer, export_dicom = _resolve_export_mode(mode)

    has_any_jpg = any(s.image_count() > 0 for s in studies)
    has_any_dicom = any(s.dicom_count() > 0 for s in studies)
    has_any_document = any(study.documents for study in studies)

    # A record without pictures is still worth exporting: documents ride along
    # the viewer path. Only fall back to the DICOM originals, or refuse, when
    # the requested mode really has nothing to write.
    if export_viewer and not has_any_jpg and not has_any_document and not export_dicom:
        if has_any_dicom:
            export_viewer = False
            export_dicom = True
            # The caller asked for a viewer and gets DICOM originals instead,
            # so the reported mode has to say what actually happened.
            mode = "dicom"
        else:
            raise ValueError(
                "Hồ sơ này chưa có ảnh JPG, tài liệu hoặc file DICOM nào để xuất."
            )

    copied_images = 0
    copied_documents = 0
    copied_dicoms = 0
    html_filename = f"{patient_folder_name}.html"

    def _safe_log(msg: str) -> None:
        try:
            log(str(msg))
        except Exception:
            try:
                safe_msg = str(msg).encode("ascii", errors="replace").decode("ascii")
                log(safe_msg)
            except Exception:
                pass

    # ── Export Viewer (JPGs + Single Unified Multi-Study Web PACS Viewer) ─
    if export_viewer:
        for index, study in enumerate(studies, start=1):
            if should_stop and should_stop():
                break
            _safe_log(f"Đang chép ảnh ca {index}/{len(studies)}: {study.title}")
            for series in study.series:
                target = target_dir / "images" / study.folder.name / series.relative
                target.mkdir(parents=True, exist_ok=True)
                for image in series.images:
                    if should_stop and should_stop():
                        break
                    shutil.copy2(image, target / image.name)
                    copied_images += 1
            for document in study.documents:
                target = target_dir / "documents" / study.folder.name
                target.mkdir(parents=True, exist_ok=True)
                shutil.copy2(document, target / document.name)
                copied_documents += 1

        viewer_html = _study_html(
            patient,
            all_studies=studies,
            initial_study_idx=0,
            has_dicom=export_dicom and has_any_dicom,
        )
        (target_dir / html_filename).write_text(viewer_html, encoding="utf-8")

    # ── Export DICOM ───────────────────────────────────────────────
    if export_dicom:
        for index, study in enumerate(studies, start=1):
            if should_stop and should_stop():
                break
            if not study.dicom_files:
                continue
            _safe_log(f"Đang chép file DICOM ca {index}/{len(studies)}: {study.title}")
            dicom_target = target_dir / "DICOM" / study.folder.name
            dicom_target.mkdir(parents=True, exist_ok=True)
            for dcm in study.dicom_files:
                if should_stop and should_stop():
                    break
                try:
                    rel = dcm.relative_to(study.folder / "DICOM")
                    out = dicom_target / rel
                except ValueError:
                    out = dicom_target / dcm.name
                out.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(dcm, out)
                copied_dicoms += 1

        readme_text = (
            f"HỒ SƠ DICOM: {patient.get('patientName') or 'UNKNOWN'} (ID: {patient.get('patientId') or '—'})\n"
            f"Ngày xuất: {patient.get('patientBirthDate') or ''}\n\n"
            "Thư mục này chứa dữ liệu file gốc DICOM tiêu chuẩn y khoa.\n"
            "Bạn có thể mở toàn bộ thư mục DICOM này bằng các phần mềm PACS:\n"
            "- RadiAnt DICOM Viewer (Windows): https://www.radiantviewer.com\n"
            "- Weasis Medical Viewer (Windows/Mac/Linux): https://nroduit.github.io/en/\n"
            "- Horos / OsiriX (macOS): https://horosproject.org\n"
        )
        (target_dir / "HUONG_DAN_DICOM.txt").write_text(readme_text, encoding="utf-8")

        if not export_viewer:
            (target_dir / html_filename).write_text(
                _dicom_index_html(patient, studies), encoding="utf-8",
            )

    log_msg = f"Đã xuất {len(studies)} ca"
    if copied_images:
        log_msg += f", {copied_images} ảnh JPG"
    if copied_dicoms:
        log_msg += f", {copied_dicoms} file DICOM"
    if copied_documents:
        log_msg += f", {copied_documents} tài liệu"
    log_msg += f" vào {target_dir}"
    _safe_log(log_msg)

    return {
        "folder": str(target_dir),
        "htmlFile": str(target_dir / html_filename),
        "studies": len(studies),
        "images": copied_images,
        "documents": copied_documents,
        "dicoms": copied_dicoms,
        "mode": mode,
        "patientId": patient.get("patientId", ""),
        "patientName": patient.get("patientName", ""),
    }

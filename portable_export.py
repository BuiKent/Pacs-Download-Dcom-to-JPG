# -*- coding: utf-8 -*-
"""Portable export: creates an offline, professional Web PACS Viewer and DICOM package.

Designed for clinical PACS review, multi-study/multi-series comparison (1x1, 1x2, 1x3, 2x2),
synchronized scrolling, reference crosshairs/crosslink, calipers, angles, ROIs, W/L presets,
and cine playback without requiring any external internet connection or software.
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
UNKNOWN = "—"

LogFn = Callable[[str], None]


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


def _collect_documents(study_folder: Path) -> list[Path]:
    return sorted(
        (path for path in study_folder.rglob("*")
         if path.is_file()
         and path.suffix.casefold() in DOCUMENT_SUFFIXES
         and path.name != dcom_pipeline.PATIENT_MANIFEST_NAME),
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
        files = [
            path for path in study_folder.rglob("*")
            if path.is_file() and path.suffix.casefold() in DICOM_SUFFIXES
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
    patient_folder = Path(patient_folder).expanduser().resolve(strict=True)
    study_folders = _study_folders(patient_folder)
    jpg_count = 0
    dicom_count = 0
    doc_count = 0
    series_count = 0

    for study in study_folders:
        for s in _collect_series(study):
            series_count += 1
            jpg_count += len(s.images)
        doc_count += len(_collect_documents(study))
        dicom_count += len(_collect_dicom_files(study))

    return {
        "hasJpg": jpg_count > 0,
        "hasDicom": dicom_count > 0,
        "jpgCount": jpg_count,
        "dicomCount": dicom_count,
        "documentCount": doc_count,
        "studyCount": len(study_folders),
        "seriesCount": series_count,
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
        date = str(record.get("date") or "").strip()
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
        "patientBirthDate": str(manifest.get("patientBirthDate") or "").strip(),
        "patientSex": str(manifest.get("patientSex") or "").strip().upper(),
        "hospitalName": hospital,
    }
    return patient, studies


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
# UI UX PRO MAX / MEDICAL PACS DESIGN SYSTEM
# ─────────────────────────────────────────────────────────────────────────────

VIEWER_CSS = """
:root {
  --bg-app: #070b14;
  --bg-panel: #0c1421;
  --bg-toolbar: #0f172a;
  --bg-card: #162234;
  --bg-hover: #1e2f46;
  --bg-active: #1e3a5f;
  --border: #1e2e42;
  --border-light: #2c425d;
  --text-main: #f1f5f9;
  --text-muted: #94a3b8;
  --text-dim: #64748b;
  --accent: #0ea5e9;
  --accent-hover: #38bdf8;
  --accent-active: #0284c7;
  --accent-glow: rgba(14, 165, 233, 0.25);
  --success: #10b981;
  --warning: #f59e0b;
  --danger: #ef4444;
  --mono-font: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}
* { box-sizing: border-box; margin: 0; padding: 0; user-select: none; -webkit-user-select: none; }
body {
  background: var(--bg-app);
  color: var(--text-main);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  height: 100vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.mono { font-family: var(--mono-font); }

/* ── Top Bar ─────────────────────────────────────────── */
.topbar {
  background: var(--bg-toolbar);
  border-bottom: 1px solid var(--border);
  height: 44px;
  display: flex;
  align-items: center;
  padding: 0 10px;
  gap: 8px;
  flex-shrink: 0;
  z-index: 20;
}
.btn-back {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  background: var(--bg-card);
  color: var(--text-main);
  border: 1px solid var(--border);
  padding: 4px 10px;
  border-radius: 5px;
  font-size: 12px;
  text-decoration: none;
  font-weight: 500;
  transition: all 0.15s;
  flex-shrink: 0;
}
.btn-back:hover { background: var(--bg-hover); color: #fff; border-color: var(--accent); }
.top-patient-info {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12px;
  padding-right: 8px;
  border-right: 1px solid var(--border);
  flex-shrink: 0;
}
.top-patient-info b { color: #fff; font-weight: 600; }
.top-patient-info span { color: var(--text-muted); }
.top-badge {
  background: rgba(14, 165, 233, 0.15);
  color: var(--accent);
  border: 1px solid rgba(14, 165, 233, 0.3);
  font-size: 10px;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 4px;
}

.toolbar-cluster {
  display: flex;
  align-items: center;
  gap: 3px;
}
.toolbar-divider {
  width: 1px;
  height: 20px;
  background: var(--border);
  margin: 0 3px;
}
.tool-btn {
  background: transparent;
  color: var(--text-muted);
  border: 1px solid transparent;
  padding: 4px 7px;
  border-radius: 5px;
  font-size: 12px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  transition: all 0.12s;
  height: 28px;
}
.tool-btn:hover { background: var(--bg-hover); color: var(--text-main); border-color: var(--border); }
.tool-btn.active {
  background: var(--bg-active);
  color: var(--accent-hover);
  border-color: var(--accent);
  box-shadow: 0 0 8px var(--accent-glow);
}
.tool-btn svg { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 2; flex-shrink: 0; }
.tool-btn.icon-only { padding: 4px; }

.tool-select {
  background: var(--bg-card);
  color: var(--text-main);
  border: 1px solid var(--border);
  padding: 3px 6px;
  border-radius: 4px;
  font-size: 11px;
  height: 28px;
  outline: none;
  cursor: pointer;
}
.tool-select:hover { border-color: var(--accent); }

/* ── Main Layout ─────────────────────────────────────── */
.main-layout {
  flex: 1;
  min-height: 0;
  display: flex;
  background: #000;
}

/* ── Series Rail Sidebar ─────────────────────────────── */
.sidebar {
  width: 220px;
  background: var(--bg-panel);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
}
.sidebar-head {
  padding: 8px 10px;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text-dim);
  border-bottom: 1px solid var(--border);
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.series-list {
  flex: 1;
  overflow-y: auto;
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.series-list::-webkit-scrollbar { width: 4px; }
.series-list::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }

.series-item {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 6px;
  cursor: pointer;
  display: flex;
  gap: 8px;
  transition: all 0.12s;
}
.series-item:hover { background: var(--bg-hover); border-color: var(--border-light); }
.series-item.active {
  border-color: var(--accent);
  background: rgba(14, 165, 233, 0.12);
  box-shadow: 0 0 0 1px var(--accent);
}
.series-thumb {
  width: 48px;
  height: 48px;
  background: #000;
  border-radius: 4px;
  object-fit: cover;
  flex-shrink: 0;
}
.series-meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 1px;
}
.series-name {
  font-size: 12px;
  font-weight: 600;
  color: #fff;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.series-desc {
  font-size: 10px;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.series-count {
  font-size: 10px;
  color: var(--text-dim);
}

/* ── Viewport Grid Stage ─────────────────────────────── */
.viewport-stage {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: #000;
  position: relative;
  overflow: hidden;
}
.viewports-grid {
  flex: 1;
  min-height: 0;
  display: grid;
  gap: 2px;
  background: #000;
  padding: 2px;
}
.viewports-grid.layout-1x1 { grid-template-columns: 1fr; grid-template-rows: 1fr; }
.viewports-grid.layout-1x2 { grid-template-columns: 1fr 1fr; grid-template-rows: 1fr; }
.viewports-grid.layout-1x3 { grid-template-columns: 1fr 1fr 1fr; grid-template-rows: 1fr; }
.viewports-grid.layout-2x2 { grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr; }

.viewport-panel {
  position: relative;
  background: #000;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  border: 1px solid #111d2b;
}
.viewport-panel.active {
  border-color: var(--accent);
  box-shadow: inset 0 0 0 1px var(--accent);
}
.viewport-panel-header {
  height: 24px;
  background: rgba(12, 20, 33, 0.85);
  backdrop-filter: blur(4px);
  border-bottom: 1px solid rgba(30, 46, 66, 0.5);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 6px;
  z-index: 10;
  font-size: 11px;
}
.vp-selectors {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}
.vp-select {
  background: #09101a;
  color: var(--text-main);
  border: 1px solid var(--border);
  font-size: 10px;
  height: 18px;
  padding: 0 4px;
  border-radius: 3px;
  max-width: 140px;
  outline: none;
}
.vp-badge {
  font-size: 9px;
  font-weight: 700;
  color: var(--accent);
  background: rgba(14, 165, 233, 0.15);
  padding: 1px 4px;
  border-radius: 3px;
}

.img-container {
  flex: 1;
  position: relative;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: crosshair;
}
.pacs-img {
  max-width: none;
  max-height: none;
  position: absolute;
  transform-origin: center center;
  pointer-events: none;
  image-rendering: -webkit-optimize-contrast;
  image-rendering: crisp-edges;
}
.annotation-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 5;
}

/* ── HUD Overlays ────────────────────────────────────── */
.hud {
  position: absolute;
  z-index: 8;
  pointer-events: none;
  font-size: 11px;
  line-height: 1.35;
  color: rgba(255, 255, 255, 0.85);
  text-shadow: 1px 1px 2px #000, 0 0 3px #000;
}
.hud b { color: #fff; font-weight: 600; }
.hud-tl { top: 28px; left: 8px; }
.hud-tr { top: 28px; right: 8px; text-align: right; }
.hud-bl { bottom: 32px; left: 8px; }
.hud-br { bottom: 32px; right: 8px; text-align: right; }

/* ── Scrubber & Cine Controls Bar ────────────────────── */
.controls-bar {
  height: 38px;
  background: var(--bg-toolbar);
  border-top: 1px solid var(--border);
  display: flex;
  align-items: center;
  padding: 0 10px;
  gap: 8px;
  flex-shrink: 0;
  z-index: 20;
}
.scrubber-wrap {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
}
.slice-slider {
  flex: 1;
  height: 4px;
  -webkit-appearance: none;
  background: var(--border-light);
  border-radius: 2px;
  outline: none;
  cursor: pointer;
}
.slice-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--accent);
  cursor: pointer;
  box-shadow: 0 0 6px var(--accent);
  transition: transform 0.1s;
}
.slice-slider::-webkit-slider-thumb:hover { transform: scale(1.2); }
.slice-tag {
  font-size: 11px;
  color: #fff;
  min-width: 60px;
  text-align: center;
}

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
  border-radius: 10px;
  width: 440px;
  max-width: 90vw;
  padding: 16px 20px;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.8);
}
.modal-card h3 { font-size: 15px; margin-bottom: 12px; color: #fff; }
.shortcut-row {
  display: flex;
  justify-content: space-between;
  padding: 5px 0;
  border-bottom: 1px solid var(--border);
  font-size: 12px;
}
.shortcut-row kbd {
  background: var(--bg-card);
  border: 1px solid var(--border-light);
  border-radius: 3px;
  padding: 1px 5px;
  font-size: 10px;
  color: var(--accent);
  font-family: var(--mono-font);
}
"""

INDEX_CSS = """
:root {
  --bg-app: #070b14;
  --bg-panel: #0c1421;
  --bg-card: #162234;
  --bg-hover: #1e2f46;
  --border: #1e2e42;
  --text-main: #f1f5f9;
  --text-muted: #94a3b8;
  --accent: #0ea5e9;
  --success: #10b981;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  background: var(--bg-app);
  color: var(--text-main);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  min-height: 100vh;
  padding: 24px;
  display: flex;
  justify-content: center;
}
.container { width: 100%; max-width: 960px; display: flex; flex-direction: column; gap: 16px; }
header.patient-header {
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 16px 20px;
}
header.patient-header .fields {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 24px;
  font-size: 13px;
  color: var(--text-muted);
}
header.patient-header .fields span b { color: #fff; font-weight: 600; }

.section-title { font-size: 14px; font-weight: 700; color: var(--text-muted); text-transform: uppercase; margin-top: 4px; }
.studies-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 14px; }
.study-card {
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 14px;
  text-decoration: none;
  color: var(--text-main);
  display: flex;
  flex-direction: column;
  gap: 10px;
  transition: all 0.15s;
}
.study-card:hover { background: var(--bg-card); border-color: var(--accent); transform: translateY(-2px); }
.card-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; }
.card-title { font-size: 14px; font-weight: 700; color: #fff; }
.modality-badge {
  background: rgba(14, 165, 233, 0.15);
  color: var(--accent);
  border: 1px solid rgba(14, 165, 233, 0.3);
  font-size: 10px;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: 4px;
}
.card-thumb-wrap { width: 100%; height: 160px; background: #000; border-radius: 6px; overflow: hidden; display: flex; align-items: center; justify-content: center; }
.card-thumb { width: 100%; height: 100%; object-fit: cover; }
.card-meta { display: flex; justify-content: space-between; font-size: 12px; color: var(--text-muted); }
.btn-open-viewer { background: var(--accent); color: #fff; font-weight: 600; font-size: 12px; padding: 7px; border-radius: 5px; text-align: center; }

.dicom-banner {
  background: rgba(16, 185, 129, 0.1);
  border: 1px solid rgba(16, 185, 129, 0.3);
  border-radius: 10px;
  padding: 12px 16px;
  display: flex;
  align-items: center;
  gap: 12px;
}
.dicom-banner-icon { font-size: 24px; }
.dicom-banner-text b { color: #10b981; font-size: 14px; display: block; margin-bottom: 2px; }
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


def _index_html(
    patient: dict,
    studies: list[ExportStudy],
    pages: list[str],
    has_dicom_folder: bool = False,
) -> str:
    cards = []
    for study, page in zip(studies, pages):
        first_img = ""
        for s in study.series:
            if s.images:
                first_img = _relative_url("images", study.folder.name, s.relative.as_posix(), s.images[0].name)
                break

        thumb_html = (
            f'<div class="card-thumb-wrap"><img class="card-thumb" src="{_escape(first_img)}" alt=""></div>'
            if first_img else ""
        )
        cards.append(
            f'<a href="{_escape(page)}" class="study-card">'
            f'<div class="card-top">'
            f'<div class="card-title">{_or_dash(study.title)}</div>'
            f'<span class="modality-badge">{_or_dash(study.modality)}</span>'
            '</div>'
            f'{thumb_html}'
            f'<div class="card-meta"><span>📅 {_or_dash(study.date)}</span><span>🎞 {len(study.series)} series · {study.image_count()} ảnh</span></div>'
            f'<div class="btn-open-viewer">Mở Web PACS Viewer ➔</div>'
            '</a>'
        )

    dicom_banner = (
        '<div class="dicom-banner">'
        '<div class="dicom-banner-icon">📁</div>'
        '<div class="dicom-banner-text">'
        '<b>Bao gồm dữ liệu file gốc DICOM</b>'
        '<span>Thư mục <code>DICOM/</code> chứa đầy đủ các file chụp gốc chất lượng cao dành cho các phần mềm PACS chuyên dụng.</span>'
        '</div>'
        '</div>'
        if has_dicom_folder else ""
    )

    body = (
        '<div class="container">'
        f'{_patient_header(patient)}'
        f'{dicom_banner}'
        f'<div class="section-title">Danh sách ca chụp ({len(studies)})</div>'
        f'<div class="studies-grid">{"".join(cards)}</div>'
        '</div>'
    )
    return _page(
        f"Hồ sơ {patient.get('patientName') or patient.get('patientId') or ''}".strip(),
        body,
        custom_css=INDEX_CSS,
    )


def _study_html(
    patient: dict,
    all_studies: list[ExportStudy],
    initial_study_idx: int = 0,
    has_dicom: bool = False,
) -> str:
    """Build the Interactive Web PACS Viewer HTML page supporting multi-study & multi-series comparison."""
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
    }, ensure_ascii=False)

    initial_study = all_studies[initial_study_idx] if 0 <= initial_study_idx < len(all_studies) else all_studies[0]

    # SVG Icons embedded cleanly
    svg_window = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 3v18A9 9 0 0 0 12 3z" fill="currentColor"/></svg>'
    svg_pan = '<svg viewBox="0 0 24 24"><path d="M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20"/></svg>'
    svg_zoom = '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.35-4.35M11 8v6M8 11h6"/></svg>'
    svg_scroll = '<svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h16"/></svg>'
    svg_crosshair = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/></svg>'
    svg_length = '<svg viewBox="0 0 24 24"><path d="M4 19L19 4M3 16l4 4M17 2l4 4M8 12l2 2M12 8l2 2"/></svg>'
    svg_angle = '<svg viewBox="0 0 24 24"><path d="M3 20h18M3 20L15 4M8 20a5 5 0 0 1 3.5-4.8"/></svg>'
    svg_ellipse = '<svg viewBox="0 0 24 24"><ellipse cx="12" cy="12" rx="9" ry="6"/></svg>'
    svg_text = '<svg viewBox="0 0 24 24"><path d="M4 7V4h16v3M12 4v16M9 20h6"/></svg>'
    svg_magnify = '<svg viewBox="0 0 24 24"><circle cx="10" cy="10" r="7"/><path d="M21 21l-6-6"/></svg>'
    svg_rotate_cw = '<svg viewBox="0 0 24 24"><path d="M21.5 2v6h-6M21.34 15.57a9 9 0 1 1-.57-8.38l.67-.7"/></svg>'
    svg_rotate_ccw = '<svg viewBox="0 0 24 24"><path d="M2.5 2v6h6M2.66 15.57a9 9 0 1 0 .57-8.38l-.67-.7"/></svg>'
    svg_flip_h = '<svg viewBox="0 0 24 24"><path d="M12 2v20M4 12l4-4v8zM20 12l-4-4v8z"/></svg>'
    svg_flip_v = '<svg viewBox="0 0 24 24"><path d="M2 12h20M12 4l-4 4h8zM12 20l-4-4h8z"/></svg>'
    svg_invert = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 3v18"/></svg>'
    svg_reset = '<svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8M3 3v5h5"/></svg>'
    svg_sync = '<svg viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>'

    js_script = r"""
<script>
const DATA = """ + payload_json + r""";

// Viewport state objects (supports up to 4 viewports in 1x1, 1x2, 1x3, 2x2)
const MAX_VP = 4;
let activeVp = 0;
let layout = "1x1"; // '1x1' | '1x2' | '1x3' | '2x2'
let activeTool = "window"; // 'window' | 'pan' | 'zoom' | 'scroll' | 'crosshair' | 'length' | 'angle' | 'ellipse' | 'text' | 'magnify'
let syncScroll = true;
let syncCrosshair = true;
let isPlaying = false;
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
    annotations: [], // array of { type: 'length'|'angle'|'ellipse'|'text', points: [] }
    isDragging: false,
    dragStart: { x: 0, y: 0 },
    tempAnnotation: null,
  });
}

function init() {
  buildSidebar();
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

function buildSidebar() {
  const container = document.getElementById('series-list-container');
  if (!container) return;
  const st = currentStudy(activeVp);
  if (!st) return;

  const countBadge = document.getElementById('sidebar-series-count');
  if (countBadge) countBadge.textContent = String(st.series.length);

  container.innerHTML = st.series.map((s, idx) => {
    const thumb = s.images[s.keyIndex] || s.images[0] || '';
    const isActive = viewports[activeVp].seriesIdx === idx;
    return `
      <div class="series-item ${isActive ? 'active' : ''}" data-idx="${idx}" onclick="selectSeries(${idx})">
        <img class="series-thumb" src="${thumb}" alt="">
        <div class="series-meta">
          <div class="series-name">${s.description || s.name}</div>
          <div class="series-desc">${s.name} · ${s.modality || ''}</div>
          <div class="series-count">${s.count} ảnh</div>
        </div>
      </div>
    `;
  }).join('');
}

function initViewportHeaders() {
  for (let i = 0; i < MAX_VP; i++) {
    const studySel = document.getElementById(`vp-study-sel-${i}`);
    if (studySel) {
      studySel.innerHTML = DATA.studies.map((st, idx) => `
        <option value="${idx}" ${idx === viewports[i].studyIdx ? 'selected' : ''}>${st.title || 'Ca chụp ' + (idx + 1)}</option>
      `).join('');
      studySel.addEventListener('change', (e) => {
        viewports[i].studyIdx = Number(e.target.value);
        viewports[i].seriesIdx = 0;
        viewports[i].slice = 0;
        updateSeriesDropdown(i);
        if (i === activeVp) buildSidebar();
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
    if (i === activeVp) buildSidebar();
    renderViewport(i);
  };
}

function selectSeries(idx) {
  const vp = viewports[activeVp];
  vp.seriesIdx = idx;
  const s = currentSeries(activeVp);
  vp.slice = s?.keyIndex || 0;
  
  const seriesSel = document.getElementById(`vp-series-sel-${activeVp}`);
  if (seriesSel) seriesSel.value = idx;
  
  document.querySelectorAll('.series-item').forEach((el, i) => {
    el.classList.toggle('active', i === idx);
  });
  
  resetViewport(activeVp);
  renderViewport(activeVp);
}

function setActiveViewport(idx) {
  activeVp = idx;
  document.querySelectorAll('.viewport-panel').forEach((el, i) => {
    el.classList.toggle('active', i === idx);
  });
  buildSidebar();
  updateScrubberBar();
}

function setLayout(mode) {
  layout = mode;
  const grid = document.getElementById('grid-viewports');
  grid.className = `viewports-grid layout-${mode}`;
  
  document.querySelectorAll('[data-layout]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.layout === mode);
  });

  const visibleCount = mode === '1x1' ? 1 : mode === '1x2' ? 2 : mode === '1x3' ? 3 : 4;
  for (let i = 0; i < MAX_VP; i++) {
    const p = document.getElementById(`panel-${i}`);
    if (p) p.style.display = i < visibleCount ? 'flex' : 'none';
    if (i < visibleCount) {
      if (i > 0 && viewports[i].seriesIdx === viewports[0].seriesIdx && currentStudy(i).series.length > i) {
        viewports[i].seriesIdx = i % currentStudy(i).series.length;
        updateSeriesDropdown(i);
      }
      renderViewport(i);
    }
  }
  if (activeVp >= visibleCount) setActiveViewport(0);
}

function renderViewport(i) {
  const vp = viewports[i];
  const ser = currentSeries(i);
  if (!ser || !ser.images.length) return;
  
  const img = document.getElementById(`pacs-img-${i}`);
  if (!img) return;

  const src = ser.images[vp.slice] || ser.images[0];
  img.src = src;
  
  applyTransform(i);
  drawAnnotations(i);
  updateHUD(i);
  if (i === activeVp) updateScrubberBar();
}

function applyTransform(i) {
  const vp = viewports[i];
  const img = document.getElementById(`pacs-img-${i}`);
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
  const st = currentStudy(i);
  const ser = currentSeries(i);
  
  const elSlice = document.getElementById(`hud-slice-${i}`);
  const elZoom = document.getElementById(`hud-zoom-${i}`);
  const elSeries = document.getElementById(`hud-series-${i}`);
  const elWl = document.getElementById(`hud-wl-${i}`);
  
  if (elSlice) elSlice.textContent = `Lát: ${vp.slice + 1}/${ser?.count || 1}`;
  if (elZoom) elZoom.textContent = `Zoom: ${Math.round(vp.zoom * 100)}%`;
  if (elSeries) elSeries.textContent = ser?.description || ser?.name || '—';
  if (elWl) elWl.textContent = `W: ${vp.contrast} L: ${vp.brightness}`;
}

function updateScrubberBar() {
  const vp = viewports[activeVp];
  const ser = currentSeries(activeVp);
  const slider = document.getElementById('main-slice-slider');
  const tag = document.getElementById('main-slice-tag');
  
  if (slider && ser) {
    slider.max = Math.max(0, ser.count - 1);
    slider.value = vp.slice;
  }
  if (tag && ser) {
    tag.textContent = `${vp.slice + 1} / ${ser.count}`;
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
    const maxVisible = layout === '1x1' ? 1 : layout === '1x2' ? 2 : layout === '1x3' ? 3 : 4;
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
}

function rotateCW() {
  const vp = viewports[activeVp];
  vp.rotation = (vp.rotation + 90) % 360;
  applyTransform(activeVp);
}

function rotateCCW() {
  const vp = viewports[activeVp];
  vp.rotation = (vp.rotation - 90 + 360) % 360;
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
  isPlaying = !isPlaying;
  const btn = document.getElementById('btn-play');
  if (btn) {
    btn.innerHTML = isPlaying ? '⏸ Tạm dừng' : '▶ Phát';
    btn.classList.toggle('active', isPlaying);
  }
  if (isPlaying) {
    playInterval = setInterval(() => {
      const ser = currentSeries(activeVp);
      if (!ser || ser.count <= 1) return;
      const nextSlice = (viewports[activeVp].slice + 1) % ser.count;
      setSlice(nextSlice);
    }, 1000 / playFps);
  } else {
    clearInterval(playInterval);
  }
}

function setFps(fps) {
  playFps = fps;
  if (isPlaying) {
    clearInterval(playInterval);
    playInterval = setInterval(() => {
      const ser = currentSeries(activeVp);
      if (!ser || ser.count <= 1) return;
      const nextSlice = (viewports[activeVp].slice + 1) % ser.count;
      setSlice(nextSlice);
    }, 1000 / playFps);
  }
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

/* ── Canvas Annotations & Measurements ───────────────── */
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

  ctx.strokeStyle = '#0ea5e9';
  ctx.fillStyle = '#0ea5e9';
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

  // Crosshair synchronized reference
  if (syncCrosshair && vp.crosshair) {
    ctx.strokeStyle = 'rgba(14, 165, 233, 0.7)';
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
  const container = document.getElementById(`container-${idx}`);
  if (!container) return;
  const vp = viewports[idx];

  container.addEventListener('wheel', (e) => {
    e.preventDefault();
    setActiveViewport(idx);
    if (e.ctrlKey) {
      vp.zoom = Math.max(0.2, Math.min(10.0, vp.zoom + (e.deltaY < 0 ? 0.15 : -0.15)));
      applyTransform(idx);
      updateHUD(idx);
    } else {
      setSlice(vp.slice + (e.deltaY > 0 ? 1 : -1), idx);
    }
  }, { passive: false });

  container.addEventListener('mousedown', (e) => {
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
        const maxVis = layout === '1x1' ? 1 : layout === '1x2' ? 2 : layout === '1x3' ? 3 : 4;
        for (let v = 0; v < maxVis; v++) {
          const c = document.getElementById(`container-${v}`);
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
      // Window / Level
      vp.brightness = Math.max(10, Math.min(300, vp.brightness - dy * 0.5));
      vp.contrast = Math.max(10, Math.min(300, vp.contrast + dx * 0.5));
      applyTransform(idx);
      updateHUD(idx);
    } else if (activeTool === 'pan' && e.buttons === 1) {
      vp.panX += dx;
      vp.panY += dy;
      applyTransform(idx);
    } else if (activeTool === 'zoom' && e.buttons === 1) {
      vp.zoom = Math.max(0.2, Math.min(10.0, vp.zoom - dy * 0.01));
      applyTransform(idx);
      updateHUD(idx);
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

  container.addEventListener('dblclick', () => resetViewport(idx));
  container.addEventListener('contextmenu', (e) => e.preventDefault());
}

window.addEventListener('DOMContentLoaded', init);
window.addEventListener('resize', () => {
  for (let i = 0; i < MAX_VP; i++) drawAnnotations(i);
});
</script>
"""

    viewport_panels_html = []
    for i in range(4):
        viewport_panels_html.append(f"""
      <div class="viewport-panel { 'active' if i == 0 else '' }" id="panel-{i}" style="{ '' if i == 0 else 'display:none;' }">
        <div class="viewport-panel-header">
          <div class="vp-selectors">
            <span class="vp-badge">VP{i+1}</span>
            <select class="vp-select" id="vp-study-sel-{i}"></select>
            <select class="vp-select" id="vp-series-sel-{i}"></select>
          </div>
          <button class="tool-btn icon-only" onclick="resetViewport({i})" title="Reset">{svg_reset}</button>
        </div>

        <div class="hud hud-tl">
          <div><b id="hud-name-{i}">{_escape(patient.get('patientName') or 'Bệnh nhân')}</b> ({_or_dash(patient.get('patientId'))})</div>
          <div>{_sex_label(patient.get('patientSex') or '')} · {_or_dash(patient.get('patientBirthDate'))}</div>
        </div>
        <div class="hud hud-tr">
          <div>{_or_dash(initial_study.date)}</div>
          <div>{_or_dash(patient.get('hospitalName'))}</div>
        </div>
        <div class="hud hud-bl">
          <div id="hud-series-{i}">—</div>
          <div id="hud-wl-{i}" class="mono">W: 100 L: 100</div>
        </div>
        <div class="hud hud-br mono">
          <div id="hud-slice-{i}">Lát: 1/1</div>
          <div id="hud-zoom-{i}">Zoom: 100%</div>
        </div>

        <div class="img-container" id="container-{i}">
          <img class="pacs-img" id="pacs-img-{i}" alt="PACS Viewport">
          <canvas class="annotation-canvas" id="annotation-canvas-{i}"></canvas>
        </div>
      </div>
        """)

    viewer_body = f"""
<div class="topbar">
  <a href="index.html" class="btn-back">← Danh sách</a>
  <div class="top-patient-info">
    <span class="top-badge">{_escape(initial_study.modality or 'IMG')}</span>
    <b>{_escape(patient.get('patientName') or 'Bệnh nhân')}</b>
    <span>({_or_dash(patient.get('patientId'))})</span>
  </div>

  <!-- Primary Tools -->
  <div class="toolbar-cluster">
    <button class="tool-btn active" data-tool="window" onclick="setTool('window')" title="Sáng / Tương phản (W/L)">{svg_window} W/L</button>
    <button class="tool-btn" data-tool="pan" onclick="setTool('pan')" title="Di chuyển ảnh (Pan)">{svg_pan} Pan</button>
    <button class="tool-btn" data-tool="zoom" onclick="setTool('zoom')" title="Thu / Phóng (Zoom)">{svg_zoom} Zoom</button>
    <button class="tool-btn" data-tool="scroll" onclick="setTool('scroll')" title="Cuộn lát cắt (Scroll)">{svg_scroll} Scroll</button>
  </div>

  <span class="toolbar-divider"></span>

  <!-- Measurement Tools -->
  <div class="toolbar-cluster">
    <button class="tool-btn" data-tool="length" onclick="setTool('length')" title="Đo chiều dài (Caliper)">{svg_length} Đo</button>
    <button class="tool-btn" data-tool="angle" onclick="setTool('angle')" title="Đo góc (Angle)">{svg_angle} Góc</button>
    <button class="tool-btn" data-tool="ellipse" onclick="setTool('ellipse')" title="ROI Vùng chọn (Ellipse)">{svg_ellipse} ROI</button>
    <button class="tool-btn icon-only" onclick="clearAnnotations()" title="Xóa đo đạc">{svg_invert}</button>
  </div>

  <span class="toolbar-divider"></span>

  <!-- Window Presets -->
  <div class="toolbar-cluster">
    <select class="tool-select" onchange="setWindowPreset(this.value)" title="Cửa sổ W/L">
      <option value="default">Mặc định</option>
      <option value="brain">Nhu mô não (Brain)</option>
      <option value="bone">Cửa sổ xương (Bone)</option>
      <option value="soft">Mô mềm (Soft Tissue)</option>
      <option value="lung">Cửa sổ phổi (Lung)</option>
      <option value="stroke">Đột quỵ (Stroke)</option>
    </select>
  </div>

  <span class="toolbar-divider"></span>

  <!-- Orientations -->
  <div class="toolbar-cluster">
    <button class="tool-btn icon-only" onclick="rotateCW()" title="Xoay 90°">{svg_rotate_cw}</button>
    <button class="tool-btn icon-only" onclick="flipHorizontal()" title="Lật ngang">{svg_flip_h}</button>
    <button class="tool-btn icon-only" onclick="toggleInvert()" title="Âm bản">{svg_invert}</button>
    <button class="tool-btn icon-only" onclick="resetViewport()" title="Đặt lại góc nhìn (Phím R)">{svg_reset}</button>
  </div>

  <span class="toolbar-divider"></span>

  <!-- Multi-Viewport Layouts -->
  <div class="toolbar-cluster">
    <button class="tool-btn active" data-layout="1x1" onclick="setLayout('1x1')" title="1 Khung hình (1x1)">1x1</button>
    <button class="tool-btn" data-layout="1x2" onclick="setLayout('1x2')" title="So sánh 2 khung song song (1x2)">1x2</button>
    <button class="tool-btn" data-layout="1x3" onclick="setLayout('1x3')" title="So sánh 3 khung song song (1x3)">1x3</button>
    <button class="tool-btn" data-layout="2x2" onclick="setLayout('2x2')" title="Lưới 4 khung hình (2x2)">2x2</button>
  </div>

  <span class="toolbar-divider"></span>

  <!-- Sync Toggles -->
  <div class="toolbar-cluster">
    <button class="tool-btn active" id="btn-sync-scroll" onclick="toggleSyncScroll()" title="Khóa cuộn lát cắt đồng bộ">{svg_sync} Sync</button>
    <button class="tool-btn active" id="btn-sync-crosshair" onclick="toggleSyncCrosshair()" title="Con trỏ tham chiếu đồng bộ (Crosslink)">{svg_crosshair} Cross</button>
  </div>

  <div style="flex:1;"></div>

  <div class="toolbar-cluster">
    <button class="tool-btn icon-only" onclick="toggleFullscreen()" title="Toàn màn hình (F)">⛶</button>
    <button class="tool-btn icon-only" onclick="toggleShortcuts()" title="Phím tắt (⌨)">⌨</button>
  </div>
</div>

<div class="main-layout">
  <!-- Series Rail Sidebar -->
  <div class="sidebar">
    <div class="sidebar-head">
      <span>Chuỗi xung (<span id="sidebar-series-count">0</span>)</span>
    </div>
    <div class="series-list" id="series-list-container"></div>
  </div>

  <!-- Viewports Grid Stage -->
  <div class="viewport-stage">
    <div class="viewports-grid layout-1x1" id="grid-viewports">
      {''.join(viewport_panels_html)}
    </div>

    <!-- Scrubber & Cine Controls -->
    <div class="controls-bar">
      <button class="tool-btn" id="btn-play" onclick="togglePlay()">▶ Phát</button>
      <div style="display:flex;gap:2px;">
        <button class="tool-btn icon-only" onclick="stepSlice(-1)" title="Lát trước">◀</button>
        <button class="tool-btn icon-only" onclick="stepSlice(1)" title="Lát sau">▶</button>
      </div>
      <div class="scrubber-wrap">
        <input type="range" class="slice-slider" id="main-slice-slider" min="0" max="0" value="0" oninput="setSlice(Number(this.value))">
        <span class="slice-tag mono" id="main-slice-tag">0 / 0</span>
      </div>
      <div style="font-size:11px;color:var(--text-muted);display:flex;align-items:center;gap:4px;">
        <span>FPS:</span>
        <button class="tool-btn" onclick="setFps(10)">10</button>
        <button class="tool-btn" onclick="setFps(20)">20</button>
        <button class="tool-btn" onclick="setFps(30)">30</button>
      </div>
    </div>
  </div>
</div>

<!-- Shortcuts Modal -->
<div class="modal-overlay" id="modal-shortcuts" style="display:none;" onclick="if(event.target===this) toggleShortcuts();">
  <div class="modal-card">
    <h3>⌨ Phím tắt điều khiển Web PACS Viewer</h3>
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
      <button class="tool-btn active" onclick="toggleShortcuts()">Đóng</button>
    </div>
  </div>
</div>

{js_script}
"""
    return _page(initial_study.title, viewer_body, custom_css=VIEWER_CSS)


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
    mode: str = "viewer",  # "viewer" | "dicom" | "both" | "jpg"
    log: LogFn = lambda _message: None,
    should_stop: Optional[Callable[[], bool]] = None,
) -> dict:
    """Copy a patient's JPGs, documents and/or DICOMs into a browsable folder."""
    patient_folder = Path(patient_folder).expanduser().resolve(strict=True)
    destination = Path(destination).expanduser().resolve()
    if (
        destination == patient_folder
        or destination in patient_folder.parents
        or patient_folder in destination.parents
    ):
        raise ValueError(
            "Thư mục xuất không được nằm trùng, nằm trên hay nằm trong thư mục hồ sơ gốc."
        )
    destination.mkdir(parents=True, exist_ok=True)

    patient, studies = collect_record(patient_folder)
    if not studies:
        raise ValueError("Hồ sơ này chưa có ảnh JPG, tài liệu hoặc file DICOM nào để xuất.")

    export_viewer = mode in ("viewer", "both", "all", "jpg")
    export_dicom = mode in ("dicom", "both", "all")

    has_any_jpg = any(s.image_count() > 0 for s in studies)
    has_any_dicom = any(s.dicom_count() > 0 for s in studies)

    if export_viewer and not has_any_jpg and not export_dicom:
        if has_any_dicom:
            export_viewer = False
            export_dicom = True
        else:
            raise ValueError("Hồ sơ này chưa có ảnh JPG hoặc tài liệu nào để xuất.")

    copied_images = 0
    copied_documents = 0
    copied_dicoms = 0
    pages: list[str] = []

    def _safe_log(msg: str) -> None:
        try:
            log(str(msg))
        except Exception:
            try:
                safe_msg = str(msg).encode("ascii", errors="replace").decode("ascii")
                log(safe_msg)
            except Exception:
                pass

    # ── Export Viewer (JPGs + Interactive Multi-Study Web PACS Viewer) ─
    if export_viewer:
        for index, study in enumerate(studies, start=1):
            if should_stop and should_stop():
                break
            _safe_log(f"Đang chép ảnh ca {index}/{len(studies)}: {study.title}")
            for series in study.series:
                target = destination / "images" / study.folder.name / series.relative
                target.mkdir(parents=True, exist_ok=True)
                for image in series.images:
                    if should_stop and should_stop():
                        break
                    shutil.copy2(image, target / image.name)
                    copied_images += 1
            for document in study.documents:
                target = destination / "documents" / study.folder.name
                target.mkdir(parents=True, exist_ok=True)
                shutil.copy2(document, target / document.name)
                copied_documents += 1

            page = f"ca-{index:02d}.html"
            pages.append(page)
            (destination / page).write_text(
                _study_html(
                    patient,
                    all_studies=studies,
                    initial_study_idx=index - 1,
                    has_dicom=export_dicom and bool(study.dicom_files),
                ),
                encoding="utf-8",
            )

        (destination / "index.html").write_text(
            _index_html(
                patient,
                studies[:len(pages)],
                pages,
                has_dicom_folder=export_dicom and has_any_dicom,
            ),
            encoding="utf-8",
        )

    # ── Export DICOM ───────────────────────────────────────────────
    if export_dicom:
        for index, study in enumerate(studies, start=1):
            if should_stop and should_stop():
                break
            if not study.dicom_files:
                continue
            _safe_log(f"Đang chép file DICOM ca {index}/{len(studies)}: {study.title}")
            dicom_target = destination / "DICOM" / study.folder.name
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
        (destination / "HUONG_DAN_DICOM.txt").write_text(readme_text, encoding="utf-8")

        if not export_viewer:
            (destination / "index.html").write_text(
                _dicom_index_html(patient, studies), encoding="utf-8",
            )

    log_msg = f"Đã xuất {len(studies)} ca"
    if copied_images:
        log_msg += f", {copied_images} ảnh JPG"
    if copied_dicoms:
        log_msg += f", {copied_dicoms} file DICOM"
    if copied_documents:
        log_msg += f", {copied_documents} tài liệu"
    log_msg += f" vào {destination}"
    _safe_log(log_msg)

    return {
        "folder": str(destination),
        "studies": len(pages) if export_viewer else len(studies),
        "images": copied_images,
        "documents": copied_documents,
        "dicoms": copied_dicoms,
        "mode": mode,
        "patientId": patient.get("patientId", ""),
        "patientName": patient.get("patientName", ""),
    }

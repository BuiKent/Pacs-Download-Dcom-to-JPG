"""Export one patient record as a folder anyone can open in a browser.

A patient who asks for their images gets a USB stick, and whatever is on it has
to work on a machine with nothing installed. Commercial patient media solves
this with an `INDEX.HTM` beside the images; this builds an interactive, dark-mode
Web PACS Viewer out of the JPGs this app already keeps, with full support for
slice scrubbing, series switching, 2-up comparison, cine playback, zoom/pan,
and window/level adjustments.

Optionally, it can also export original DICOM folders or both side-by-side.
"""

from __future__ import annotations

import html
import json
import re
import shutil
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Optional

import dcom_pipeline

LogFn = Callable[[str], None]

IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png"}
DOCUMENT_SUFFIXES = {".pdf", ".txt", ".doc", ".docx"}
DICOM_SUFFIXES = {".dcm", ".ima", ".dicom"}
SKIPPED_FOLDERS = {"DICOM", "RAW_JPG"}
UNKNOWN = "—"


@dataclass
class ExportSeries:
    """One folder of images, as it will appear on the exported page."""

    name: str
    description: str
    modality: str
    institution: str
    images: list[Path]
    relative: Path


@dataclass
class ExportStudy:
    """One exam: its own folder on the stick, with its series inside."""

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
    """Sort "IM_2" before "IM_10". Same split the catalog uses, so both agree."""
    return [int(item) if item.isdigit() else item.casefold() for item in re.split(r"(\d+)", value)]


def _read_series_manifest(folder: Path) -> dict:
    try:
        data = json.loads((folder / "mpr-volume.json").read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError):
        return {}
    return data if isinstance(data, dict) else {}


def _relative_url(*parts: str) -> str:
    """Join URL segments, dropping the "." a same-folder relative path yields."""
    return "/".join(part for part in parts if part and part != ".")


def _collect_series(study_folder: Path) -> list[ExportSeries]:
    """Every folder of images at or below `study_folder`, its name kept as-is."""
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
    """Find all DICOM files under study_folder (either in DICOM/ subfolder or by extension)."""
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
    """Study directories inside a patient archive, or the archive itself."""
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
    """What the patient index says about this study folder, if anything."""
    try:
        key = str(study_folder.resolve()).casefold()
    except OSError:
        key = str(study_folder).casefold()
    return records.get(key, {})


def detect_patient_export_contents(patient_folder: Path) -> dict:
    """Report what media formats the patient archive holds (JPG, DICOM, documents)."""
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
    """The patient block and the studies worth exporting, read off disk."""
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
    sex = _sex_label(patient.get("patientSex", ""))
    fields = [
        ("Họ và tên", patient.get("patientName", "")),
        ("Mã bệnh nhân", patient.get("patientId", "")),
        ("Ngày sinh", patient.get("patientBirthDate", "")),
        ("Giới tính", sex),
        ("Bệnh viện", patient.get("hospitalName", "")),
    ]
    cells = "".join(
        f"<span><b>{_escape(label)}:</b> {_or_dash(value)}</span>" for label, value in fields
    )
    return (
        "<header class=\"patient-header\"><h1>Hồ sơ hình ảnh y tế</h1>"
        f'<div class="fields">{cells}</div></header>'
    )


# ─────────────────────────────────────────────────────────────────────────────
# SHARED DARK PACS THEME CSS
# ─────────────────────────────────────────────────────────────────────────────

VIEWER_CSS = """
:root {
  --bg-app: #070b14;
  --bg-panel: #0f172a;
  --bg-card: #1e293b;
  --bg-hover: #334155;
  --border: #334155;
  --border-light: #475569;
  --text-main: #f8fafc;
  --text-muted: #94a3b8;
  --text-dim: #64748b;
  --accent: #0ea5e9;
  --accent-hover: #38bdf8;
  --accent-active: #0284c7;
  --success: #10b981;
  --warning: #f59e0b;
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
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }

/* ── Top Bar ─────────────────────────────────────────── */
.topbar {
  background: var(--bg-panel);
  border-bottom: 1px solid var(--border);
  height: 48px;
  display: flex;
  align-items: center;
  padding: 0 14px;
  gap: 12px;
  flex-shrink: 0;
  z-index: 20;
}
.btn-back {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: var(--bg-card);
  color: var(--text-main);
  border: 1px solid var(--border);
  padding: 6px 12px;
  border-radius: 6px;
  font-size: 13px;
  text-decoration: none;
  font-weight: 500;
  transition: all 0.15s;
}
.btn-back:hover { background: var(--bg-hover); color: #fff; border-color: var(--accent); }
.top-info {
  display: flex;
  align-items: center;
  gap: 16px;
  flex: 1;
  min-width: 0;
  font-size: 13px;
}
.top-info b { color: #fff; font-weight: 600; }
.top-info span { color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.top-badge {
  background: rgba(14, 165, 233, 0.15);
  color: var(--accent);
  border: 1px solid rgba(14, 165, 233, 0.3);
  font-size: 11px;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 4px;
  text-transform: uppercase;
}
.top-actions { display: flex; align-items: center; gap: 6px; }
.tool-btn {
  background: var(--bg-card);
  border: 1px solid var(--border);
  color: var(--text-main);
  padding: 6px 10px;
  border-radius: 6px;
  font-size: 12px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-weight: 500;
  transition: all 0.15s;
}
.tool-btn:hover { background: var(--bg-hover); border-color: var(--border-light); }
.tool-btn.active { background: var(--accent-active); border-color: var(--accent); color: #fff; }

/* ── Main Layout ─────────────────────────────────────── */
.main-layout {
  display: flex;
  flex: 1;
  min-height: 0;
  position: relative;
}

/* ── Series Rail Sidebar ─────────────────────────────── */
.sidebar {
  width: 220px;
  background: var(--bg-panel);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  overflow: hidden;
}
.sidebar-head {
  padding: 10px 12px;
  font-size: 11px;
  font-weight: 700;
  color: var(--text-dim);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  border-bottom: 1px solid var(--border);
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.series-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.series-item {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px;
  cursor: pointer;
  display: flex;
  gap: 10px;
  transition: all 0.15s;
}
.series-item:hover { background: var(--bg-hover); border-color: var(--border-light); }
.series-item.active {
  border-color: var(--accent);
  background: rgba(14, 165, 233, 0.1);
  box-shadow: 0 0 0 1px var(--accent);
}
.series-thumb {
  width: 52px;
  height: 52px;
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
  gap: 2px;
}
.series-name {
  font-size: 13px;
  font-weight: 600;
  color: #fff;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.series-desc {
  font-size: 11px;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.series-count {
  font-size: 11px;
  color: var(--text-dim);
}

/* ── Viewport Stage ──────────────────────────────────── */
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
  grid-template-columns: 1fr;
  gap: 2px;
  background: #000;
  position: relative;
}
.viewports-grid.compare {
  grid-template-columns: 1fr 1fr;
}
.viewport-panel {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background: #020617;
  outline: 1px solid var(--border);
}
.viewport-panel.active {
  outline: 2px solid var(--accent);
  z-index: 2;
}

/* ── HUD Overlays ────────────────────────────────────── */
.hud {
  position: absolute;
  padding: 8px 12px;
  font-size: 11px;
  line-height: 1.4;
  color: rgba(255, 255, 255, 0.85);
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.9), 0 0 2px #000;
  pointer-events: none;
  z-index: 10;
}
.hud b { color: #fff; }
.hud-tl { top: 0; left: 0; }
.hud-tr { top: 0; right: 0; text-align: right; }
.hud-bl { bottom: 0; left: 0; }
.hud-br { bottom: 0; right: 0; text-align: right; }

.img-container {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: grab;
}
.img-container:active { cursor: grabbing; }
.pacs-img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  transform-origin: center center;
  transition: transform 0.05s ease-out;
  pointer-events: none;
}

/* ── Control Bar / Scrubber ──────────────────────────── */
.controls-bar {
  background: var(--bg-panel);
  border-top: 1px solid var(--border);
  padding: 8px 16px;
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
  z-index: 20;
}
.scrubber-wrap {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 10px;
}
.slice-slider {
  flex: 1;
  -webkit-appearance: none;
  height: 6px;
  border-radius: 3px;
  background: var(--bg-card);
  outline: none;
  cursor: pointer;
}
.slice-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--accent);
  cursor: pointer;
  box-shadow: 0 0 6px rgba(14, 165, 233, 0.6);
  transition: transform 0.1s;
}
.slice-slider::-webkit-slider-thumb:hover {
  transform: scale(1.2);
}
.slice-tag {
  font-size: 13px;
  font-weight: 700;
  color: #fff;
  min-width: 60px;
  text-align: center;
}

/* ── Documents List Drawer ───────────────────────────── */
.doc-section {
  padding: 10px 12px;
  border-top: 1px solid var(--border);
  background: var(--bg-panel);
}
.doc-link {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--accent);
  text-decoration: none;
  font-size: 12px;
  padding: 4px 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.doc-link:hover { text-decoration: underline; color: var(--accent-hover); }

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
  border-radius: 12px;
  width: 440px;
  max-width: 90vw;
  padding: 20px;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.6);
}
.modal-card h3 { font-size: 16px; margin-bottom: 14px; color: #fff; }
.shortcut-row {
  display: flex;
  justify-content: space-between;
  padding: 6px 0;
  border-bottom: 1px solid var(--border);
  font-size: 13px;
}
.shortcut-row kbd {
  background: var(--bg-card);
  border: 1px solid var(--border-light);
  border-radius: 4px;
  padding: 2px 6px;
  font-size: 11px;
  color: var(--accent);
  font-family: ui-monospace, monospace;
}

/* ── Print / Fallback Grid ───────────────────────────── */
@media print {
  body { overflow: visible; height: auto; background: #fff; color: #000; }
  .topbar, .sidebar, .controls-bar, .modal-overlay { display: none !important; }
  .viewport-stage { background: #fff; }
}
"""

INDEX_CSS = """
:root {
  --bg-app: #070b14;
  --bg-panel: #0f172a;
  --bg-card: #1e293b;
  --bg-hover: #334155;
  --border: #334155;
  --border-light: #475569;
  --text-main: #f8fafc;
  --text-muted: #94a3b8;
  --text-dim: #64748b;
  --accent: #0ea5e9;
  --accent-hover: #38bdf8;
  --accent-active: #0284c7;
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
.container {
  width: 100%;
  max-width: 960px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}
header.patient-header {
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 20px 24px;
}
header.patient-header h1 {
  font-size: 20px;
  font-weight: 700;
  margin-bottom: 12px;
  color: #fff;
  display: flex;
  align-items: center;
  gap: 10px;
}
header.patient-header .fields {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 24px;
  font-size: 14px;
  color: var(--text-muted);
}
header.patient-header .fields span b { color: #fff; font-weight: 600; }

.section-title {
  font-size: 16px;
  font-weight: 700;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-top: 8px;
}
.studies-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 16px;
}
.study-card {
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 16px;
  text-decoration: none;
  color: var(--text-main);
  display: flex;
  flex-direction: column;
  gap: 12px;
  transition: all 0.2s;
}
.study-card:hover {
  background: var(--bg-card);
  border-color: var(--accent);
  transform: translateY(-2px);
  box-shadow: 0 10px 20px rgba(0, 0, 0, 0.4);
}
.card-top {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 8px;
}
.card-title {
  font-size: 16px;
  font-weight: 700;
  color: #fff;
}
.modality-badge {
  background: rgba(14, 165, 233, 0.15);
  color: var(--accent);
  border: 1px solid rgba(14, 165, 233, 0.3);
  font-size: 11px;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 4px;
}
.card-thumb-wrap {
  width: 100%;
  height: 160px;
  background: #000;
  border-radius: 8px;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}
.card-thumb {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.card-meta {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
  color: var(--text-muted);
}
.btn-open-viewer {
  background: var(--accent);
  color: #fff;
  font-weight: 600;
  font-size: 13px;
  padding: 8px;
  border-radius: 6px;
  text-align: center;
  margin-top: 4px;
}

.dicom-banner {
  background: rgba(16, 185, 129, 0.1);
  border: 1px solid rgba(16, 185, 129, 0.3);
  border-radius: 12px;
  padding: 16px 20px;
  display: flex;
  align-items: center;
  gap: 16px;
}
.dicom-banner-icon { font-size: 28px; }
.dicom-banner-text b { color: #10b981; font-size: 15px; display: block; margin-bottom: 2px; }
.dicom-banner-text span { font-size: 13px; color: var(--text-muted); }

.note-box {
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 16px 20px;
  font-size: 13px;
  color: var(--text-muted);
  line-height: 1.6;
}
.note-box b { color: #fff; }
"""


def _page(title: str, body: str, custom_css: str = INDEX_CSS) -> str:
    return (
        "<!DOCTYPE html>\n"
        '<html lang="vi"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width, initial-scale=1">'
        f"<title>{_escape(title)}</title><style>{custom_css}</style></head>"
        f"<body>{body}</body></html>\n"
    )


def _index_html(
    patient: dict,
    studies: list[ExportStudy],
    pages: list[str],
    has_dicom_folder: bool = False,
) -> str:
    cards = []
    for study, page in zip(studies, pages):
        first = next((item for item in study.series if item.images), None)
        thumbnail_img = ""
        if first is not None:
            middle = first.images[len(first.images) // 2]
            source = _relative_url(
                "images", study.folder.name, first.relative.as_posix(), middle.name,
            )
            thumbnail_img = f'<img class="card-thumb" src="{_escape(source)}" alt="">'
        else:
            thumbnail_img = '<div style="color:var(--text-dim);font-size:13px;">Chưa có ảnh JPG</div>'

        cards.append(
            f'<a href="{_escape(page)}" class="study-card">'
            '<div class="card-top">'
            f'<div class="card-title">{_or_dash(study.title)}</div>'
            f'<span class="modality-badge">{_or_dash(study.modality)}</span>'
            '</div>'
            f'<div class="card-thumb-wrap">{thumbnail_img}</div>'
            '<div class="card-meta">'
            f'<span>📅 {_or_dash(study.date)}</span>'
            f'<span>🎞 {len(study.series)} series · {study.image_count()} ảnh</span>'
            '</div>'
            '<div class="btn-open-viewer">Mở Web PACS Viewer ➔</div>'
            '</a>'
        )

    dicom_html = ""
    if has_dicom_folder:
        dicom_html = (
            '<div class="dicom-banner">'
            '<div class="dicom-banner-icon">📁</div>'
            '<div class="dicom-banner-text">'
            '<b>Bao gồm dữ liệu file gốc DICOM</b>'
            '<span>Thư mục <code>DICOM/</code> chứa đầy đủ các file chụp gốc chất lượng cao '
            'dành cho các phần mềm PACS chuyên dụng (RadiAnt, Weasis, MicroDicom, Horos...).</span>'
            '</div>'
            '</div>'
        )

    note = (
        '<div class="note-box">'
        '<b>Hướng dẫn sử dụng:</b><br>'
        '• Mở tệp <b>index.html</b> bằng bất kỳ trình duyệt web nào (Chrome, Edge, Safari, Firefox) — không cần cài đặt phần mềm.<br>'
        '• Trình xem <b>Web PACS Viewer</b> tích hợp sẵn cho phép lăn chuột cuộn lát cắt, chuyển chuỗi xung (T1, T2, FLAIR...), '
        'chế độ so sánh 2 khung hình, điều chỉnh độ sáng/tương phản (W/L) và xem video loop liên tục.'
        '</div>'
    )

    studies_content = (
        f'<div class="studies-grid">{"".join(cards)}</div>'
        if cards
        else '<p style="color:var(--text-dim)">Hồ sơ này chưa có ảnh JPG nào để xem.</p>'
    )

    body = (
        '<div class="container">'
        f'{_patient_header(patient)}'
        f'{dicom_html}'
        f'<div class="section-title">Danh sách ca chụp ({len(studies)})</div>'
        f'{studies_content}'
        f'{note}'
        '</div>'
    )
    return _page(
        f"Hồ sơ {patient.get('patientName') or patient.get('patientId') or ''}".strip(),
        body,
        custom_css=INDEX_CSS,
    )


def _study_html(patient: dict, study: ExportStudy, has_dicom: bool = False) -> str:
    """Build the Interactive Web PACS Viewer HTML page for one study."""
    series_data = []
    for s_idx, series in enumerate(study.series):
        def img_src(image: Path) -> str:
            return _relative_url(
                "images", study.folder.name, series.relative.as_posix(), image.name,
            )

        img_urls = [img_src(img) for img in series.images]
        series_data.append({
            "id": f"s_{s_idx}",
            "name": series.name,
            "description": series.description,
            "modality": series.modality,
            "institution": series.institution,
            "images": img_urls,
            "count": len(img_urls),
            "keyIndex": len(img_urls) // 2 if img_urls else 0,
        })

    docs_data = []
    for doc in study.documents:
        docs_data.append({
            "name": doc.name,
            "url": _relative_url("documents", study.folder.name, doc.name),
        })

    study_json = json.dumps({
        "title": study.title,
        "date": study.date,
        "modality": study.modality,
        "patient": patient,
        "series": series_data,
        "documents": docs_data,
        "hasDicom": has_dicom,
    }, ensure_ascii=False)

    # Series items for rail
    sidebar_items = []
    for idx, s in enumerate(series_data):
        thumb_src = s["images"][s["keyIndex"]] if s["images"] else ""
        sidebar_items.append(
            f'<div class="series-item { "active" if idx == 0 else "" }" data-series-idx="{idx}" onclick="selectSeries({idx})">'
            f'<img class="series-thumb" src="{_escape(thumb_src)}" alt="">'
            '<div class="series-meta">'
            f'<div class="series-name">{_escape(s["description"])}</div>'
            f'<div class="series-desc">{_escape(s["name"])}</div>'
            f'<div class="series-count">{s["count"]} ảnh</div>'
            '</div>'
            '</div>'
        )

    # Document links
    doc_links_html = ""
    if docs_data:
        doc_links = "".join(
            f'<a class="doc-link" href="{_escape(d["url"])}" target="_blank" rel="noopener">📄 {_escape(d["name"])}</a>'
            for d in docs_data
        )
        doc_links_html = f'<div class="doc-section"><div style="font-size:11px;font-weight:700;color:var(--text-dim);margin-bottom:6px;">TÀI LIỆU KÈM THEO</div>{doc_links}</div>'

    # Fallback / SEO links
    fallback_links = []
    for series in study.series:
        def src(img: Path) -> str:
            return _escape(_relative_url("images", study.folder.name, series.relative.as_posix(), img.name))

        imgs_tag = "".join(
            f'<a href="{src(img)}" target="_blank" style="display:none;">{_escape(img.name)}</a>'
            for img in series.images
        )
        fallback_links.append(f'<div style="display:none;">{_escape(series.description)}: {imgs_tag}</div>')

    # JavaScript Engine for the Web PACS Viewer
    js_script = r"""
<script>
const DATA = """ + study_json + r""";
let currentSeriesIdx = 0;
let currentSlice = 0;
let isCompare = false;
let syncScroll = true;
let isPlaying = false;
let playInterval = null;
let playFps = 15;

// Panel 2 state
let compareSeriesIdx = DATA.series.length > 1 ? 1 : 0;
let compareSlice = 0;

// View transformations (Panel 1)
let transform = { zoom: 1.0, panX: 0, panY: 0, rotation: 0, invert: false, brightness: 100, contrast: 100 };
let transform2 = { zoom: 1.0, panX: 0, panY: 0, rotation: 0, invert: false, brightness: 100, contrast: 100 };

let isDragging = false;
let dragStart = { x: 0, y: 0 };
let activePanel = 1;

function init() {
  if (!DATA.series || !DATA.series.length) return;
  selectSeries(0);
  setupEvents();
  updateHUD();
}

function selectSeries(idx) {
  if (idx < 0 || idx >= DATA.series.length) return;
  currentSeriesIdx = idx;
  const s = DATA.series[idx];
  currentSlice = s.keyIndex || 0;
  
  document.querySelectorAll('.series-item').forEach((el, i) => {
    el.classList.toggle('active', i === idx);
  });
  
  resetView(1);
  render();
}

function render() {
  const s1 = DATA.series[currentSeriesIdx];
  if (!s1 || !s1.images.length) return;
  
  const img1 = document.getElementById('pacs-img-1');
  const slider1 = document.getElementById('slice-slider-1');
  const tag1 = document.getElementById('slice-tag-1');
  
  const src1 = s1.images[currentSlice] || s1.images[0];
  img1.src = src1;
  applyTransform(1);
  
  slider1.max = s1.images.length - 1;
  slider1.value = currentSlice;
  tag1.textContent = (currentSlice + 1) + ' / ' + s1.images.length;
  
  if (isCompare) {
    const s2 = DATA.series[compareSeriesIdx];
    if (s2 && s2.images.length) {
      const img2 = document.getElementById('pacs-img-2');
      const src2 = s2.images[compareSlice] || s2.images[0];
      img2.src = src2;
      applyTransform(2);
    }
  }
  updateHUD();
}

function applyTransform(panel) {
  const t = panel === 1 ? transform : transform2;
  const img = document.getElementById(panel === 1 ? 'pacs-img-1' : 'pacs-img-2');
  if (!img) return;
  img.style.transform = `translate(${t.panX}px, ${t.panY}px) scale(${t.zoom}) rotate(${t.rotation}deg)`;
  img.style.filter = `brightness(${t.brightness}%) contrast(${t.contrast}%) ${t.invert ? 'invert(1)' : ''}`;
}

function updateHUD() {
  const s1 = DATA.series[currentSeriesIdx];
  if (!s1) return;
  
  document.getElementById('hud-tl-name').textContent = DATA.patient.patientName || '—';
  document.getElementById('hud-tl-id').textContent = DATA.patient.patientId || '—';
  document.getElementById('hud-tr-desc').textContent = DATA.title || s1.description;
  document.getElementById('hud-bl-series').textContent = s1.description + ' (' + s1.name + ')';
  document.getElementById('hud-bl-wl').textContent = `W/L: B:${transform.brightness}% C:${transform.contrast}%`;
  document.getElementById('hud-br-slice').textContent = `Lát: ${currentSlice + 1}/${s1.images.length}`;
  document.getElementById('hud-br-zoom').textContent = `Zoom: ${Math.round(transform.zoom * 100)}%`;
  
  if (isCompare) {
    const s2 = DATA.series[compareSeriesIdx];
    if (s2) {
      document.getElementById('hud-2-bl-series').textContent = s2.description + ' (' + s2.name + ')';
      document.getElementById('hud-2-br-slice').textContent = `Lát: ${compareSlice + 1}/${s2.images.length}`;
    }
  }
}

function setSlice(n) {
  const s1 = DATA.series[currentSeriesIdx];
  if (!s1) return;
  const prev = currentSlice;
  currentSlice = Math.max(0, Math.min(n, s1.images.length - 1));
  const diff = currentSlice - prev;
  
  if (isCompare && syncScroll) {
    const s2 = DATA.series[compareSeriesIdx];
    if (s2) {
      compareSlice = Math.max(0, Math.min(compareSlice + diff, s2.images.length - 1));
    }
  }
  render();
}

function stepSlice(delta) {
  setSlice(currentSlice + delta);
}

function togglePlay() {
  isPlaying = !isPlaying;
  const btn = document.getElementById('btn-play');
  if (isPlaying) {
    btn.innerHTML = '⏸ Tạm dừng';
    btn.classList.add('active');
    playInterval = setInterval(() => {
      const s = DATA.series[currentSeriesIdx];
      let next = currentSlice + 1;
      if (next >= s.images.length) next = 0;
      setSlice(next);
    }, 1000 / playFps);
  } else {
    btn.innerHTML = '▶ Phát';
    btn.classList.remove('active');
    clearInterval(playInterval);
  }
}

function setFps(fps) {
  playFps = fps;
  if (isPlaying) {
    togglePlay();
    togglePlay();
  }
}

function zoom(delta, panel = 1) {
  const t = panel === 1 ? transform : transform2;
  t.zoom = Math.max(0.2, Math.min(8.0, t.zoom + delta));
  applyTransform(panel);
  updateHUD();
}

function rotate(panel = 1) {
  const t = panel === 1 ? transform : transform2;
  t.rotation = (t.rotation + 90) % 360;
  applyTransform(panel);
}

function toggleInvert(panel = 1) {
  const t = panel === 1 ? transform : transform2;
  t.invert = !t.invert;
  applyTransform(panel);
}

function resetView(panel = 1) {
  const t = panel === 1 ? transform : transform2;
  t.zoom = 1.0;
  t.panX = 0;
  t.panY = 0;
  t.rotation = 0;
  t.invert = false;
  t.brightness = 100;
  t.contrast = 100;
  applyTransform(panel);
  updateHUD();
}

function adjustWl(bDelta, cDelta, panel = 1) {
  const t = panel === 1 ? transform : transform2;
  t.brightness = Math.max(20, Math.min(300, t.brightness + bDelta));
  t.contrast = Math.max(20, Math.min(300, t.contrast + cDelta));
  applyTransform(panel);
  updateHUD();
}

function toggleCompare() {
  isCompare = !isCompare;
  document.getElementById('btn-compare').classList.toggle('active', isCompare);
  document.getElementById('grid-viewports').classList.toggle('compare', isCompare);
  document.getElementById('panel-2').style.display = isCompare ? 'flex' : 'none';
  if (isCompare) {
    if (DATA.series.length > 1 && compareSeriesIdx === currentSeriesIdx) {
      compareSeriesIdx = (currentSeriesIdx + 1) % DATA.series.length;
    }
    compareSlice = 0;
  }
  render();
}

function toggleSyncScroll() {
  syncScroll = !syncScroll;
  document.getElementById('btn-sync').classList.toggle('active', syncScroll);
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
  modal.style.display = modal.style.display === 'none' ? 'flex' : 'none';
}

function setupEvents() {
  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); stepSlice(1); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); stepSlice(-1); }
    else if (e.key === ' ') { e.preventDefault(); togglePlay(); }
    else if (e.key === 'r' || e.key === 'R') { resetView(1); resetView(2); }
    else if (e.key === 'i' || e.key === 'I') { toggleInvert(1); }
    else if (e.key === 'f' || e.key === 'F') { toggleFullscreen(); }
    else if (e.key === 'c' || e.key === 'C') { toggleCompare(); }
  });

  const setupWheelAndPan = (container, panelNum) => {
    container.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (e.ctrlKey) {
        zoom(e.deltaY < 0 ? 0.15 : -0.15, panelNum);
      } else {
        stepSlice(e.deltaY > 0 ? 1 : -1);
      }
    }, { passive: false });

    container.addEventListener('mousedown', (e) => {
      activePanel = panelNum;
      isDragging = true;
      dragStart = { x: e.clientX, y: e.clientY };
    });

    container.addEventListener('dblclick', () => resetView(panelNum));
  };

  setupWheelAndPan(document.getElementById('container-1'), 1);
  setupWheelAndPan(document.getElementById('container-2'), 2);

  window.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const dx = e.clientX - dragStart.x;
    const dy = e.clientY - dragStart.y;
    dragStart = { x: e.clientX, y: e.clientY };
    
    const t = activePanel === 1 ? transform : transform2;
    if (e.buttons === 1) { // Left click: Pan
      t.panX += dx;
      t.panY += dy;
      applyTransform(activePanel);
    } else if (e.buttons === 2) { // Right click: W/L
      adjustWl(dy * -1, dx, activePanel);
    }
  });

  window.addEventListener('mouseup', () => { isDragging = false; });
  window.addEventListener('contextmenu', (e) => {
    if (e.target.closest('.viewport-panel')) e.preventDefault();
  });
}

window.addEventListener('DOMContentLoaded', init);
</script>
"""

    viewer_body = f"""
<div class="topbar">
  <a href="index.html" class="btn-back">← Danh sách ca</a>
  <div class="top-info">
    <span class="top-badge">{_escape(study.modality or 'IMG')}</span>
    <span><b>{_escape(patient.get('patientName') or 'Bệnh nhân')}</b> ({_or_dash(patient.get('patientId'))})</span>
    <span>📅 {_or_dash(study.date)} · {_escape(study.title)}</span>
  </div>
  <div class="top-actions">
    <button class="tool-btn" id="btn-compare" onclick="toggleCompare()" title="So sánh 2 chuỗi xung (Phím C)">⊞ So sánh 2 xung</button>
    <button class="tool-btn active" id="btn-sync" onclick="toggleSyncScroll()" title="Đồng bộ cuộn lát cắt">🔗 Sync</button>
    <button class="tool-btn" onclick="adjustWl(0, 30)" title="Tăng tương phản (W/L)">◐ Contrast</button>
    <button class="tool-btn" onclick="toggleInvert()" title="Đảo âm bản/dương bản (Phím I)">◑ Invert</button>
    <button class="tool-btn" onclick="rotate()" title="Xoay 90°">⟳ Xoay</button>
    <button class="tool-btn" onclick="resetView(1); resetView(2);" title="Khôi phục góc nhìn ban đầu (Phím R)">↺ Reset</button>
    <button class="tool-btn" onclick="toggleFullscreen()" title="Toàn màn hình (Phím F)">⛶ Fullscreen</button>
    <button class="tool-btn" onclick="toggleShortcuts()" title="Phím tắt">⌨</button>
  </div>
</div>

<div class="main-layout">
  <!-- Series Rail Sidebar -->
  <div class="sidebar">
    <div class="sidebar-head">
      <span>Chuỗi xung ({len(study.series)})</span>
    </div>
    <div class="series-list">
      {''.join(sidebar_items)}
    </div>
    {doc_links_html}
  </div>

  <!-- Center Viewport Stage -->
  <div class="viewport-stage">
    <div class="viewports-grid" id="grid-viewports">
      <!-- Viewport 1 -->
      <div class="viewport-panel active" id="panel-1">
        <div class="hud hud-tl">
          <div><b id="hud-tl-name">—</b></div>
          <div id="hud-tl-id">—</div>
          <div>{_sex_label(patient.get('patientSex', ''))} · {_or_dash(patient.get('patientBirthDate'))}</div>
        </div>
        <div class="hud hud-tr">
          <div id="hud-tr-desc">{_escape(study.title)}</div>
          <div>{_or_dash(study.date)}</div>
          <div>{_or_dash(patient.get('hospitalName'))}</div>
        </div>
        <div class="hud hud-bl">
          <div id="hud-bl-series">—</div>
          <div id="hud-bl-wl" class="mono">W/L: Normal</div>
        </div>
        <div class="hud hud-br mono">
          <div id="hud-br-slice">Lát: 0/0</div>
          <div id="hud-br-zoom">Zoom: 100%</div>
        </div>

        <div class="img-container" id="container-1">
          <img class="pacs-img" id="pacs-img-1" alt="PACS Slice">
        </div>
      </div>

      <!-- Viewport 2 (Compare Mode) -->
      <div class="viewport-panel" id="panel-2" style="display:none;">
        <div class="hud hud-tl">
          <div><b id="hud-2-tl-name">{_escape(patient.get('patientName') or 'Bệnh nhân')}</b></div>
          <div>[Khung so sánh B]</div>
        </div>
        <div class="hud hud-bl">
          <div id="hud-2-bl-series">—</div>
        </div>
        <div class="hud hud-br mono">
          <div id="hud-2-br-slice">Lát: 0/0</div>
        </div>

        <div class="img-container" id="container-2">
          <img class="pacs-img" id="pacs-img-2" alt="PACS Compare Slice">
        </div>
      </div>
    </div>

    <!-- Scrubber & Cine Controls -->
    <div class="controls-bar">
      <button class="tool-btn" id="btn-play" onclick="togglePlay()">▶ Phát</button>
      <div style="display:flex;gap:2px;">
        <button class="tool-btn" onclick="stepSlice(-1)" title="Lát trước">◀</button>
        <button class="tool-btn" onclick="stepSlice(1)" title="Lát sau">▶</button>
      </div>
      <div class="scrubber-wrap">
        <input type="range" class="slice-slider" id="slice-slider-1" min="0" max="0" value="0" oninput="setSlice(Number(this.value))">
        <span class="slice-tag mono" id="slice-tag-1">0/0</span>
      </div>
      <div style="font-size:12px;color:var(--text-muted);display:flex;align-items:center;gap:6px;">
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
    <div class="shortcut-row"><span>Lật lát cắt (Slice)</span><div><kbd>←</kbd> <kbd>→</kbd> hoặc <kbd>Cuộn chuột</kbd></div></div>
    <div class="shortcut-row"><span>Phát / Tạm dừng Cine loop</span><kbd>Space</kbd></div>
    <div class="shortcut-row"><span>Phóng to / Thu nhỏ (Zoom)</span><kbd>Ctrl + Cuộn chuột</kbd></div>
    <div class="shortcut-row"><span>Di chuyển ảnh (Pan)</span><kbd>Kéo chuột trái</kbd></div>
    <div class="shortcut-row"><span>Chỉnh sáng / Tương phản (W/L)</span><kbd>Kéo chuột phải</kbd></div>
    <div class="shortcut-row"><span>Đảo âm bản / dương bản</span><kbd>I</kbd></div>
    <div class="shortcut-row"><span>Bật / Tắt so sánh 2 xung</span><kbd>C</kbd></div>
    <div class="shortcut-row"><span>Khôi phục góc nhìn ban đầu</span><kbd>R</kbd> hoặc <kbd>Nhấp đúp chuột</kbd></div>
    <div class="shortcut-row"><span>Toàn màn hình (Fullscreen)</span><kbd>F</kbd></div>
    <div style="margin-top:16px;text-align:right;">
      <button class="tool-btn active" onclick="toggleShortcuts()">Đã hiểu</button>
    </div>
  </div>
</div>

{''.join(fallback_links)}
{js_script}
"""
    return _page(study.title, viewer_body, custom_css=VIEWER_CSS)


def _dicom_index_html(patient: dict, studies: list[ExportStudy]) -> str:
    """Build a helper index page when exporting only DICOM files."""
    rows = []
    for s_idx, study in enumerate(studies, start=1):
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
        '<div class="note-box">'
        '<b>Phần mềm xem ảnh DICOM khuyến nghị:</b><br>'
        '• <b>RadiAnt DICOM Viewer</b> (Windows): <a href="https://www.radiantviewer.com" target="_blank" style="color:var(--accent)">radiantviewer.com</a><br>'
        '• <b>Weasis Medical Viewer</b> (Windows/Mac/Linux): <a href="https://nroduit.github.io/en/" target="_blank" style="color:var(--accent)">nroduit.github.io</a><br>'
        '• <b>Horos / OsiriX</b> (macOS): <a href="https://horosproject.org" target="_blank" style="color:var(--accent)">horosproject.org</a>'
        '</div>'
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
    """Copy a patient's JPGs, documents and/or DICOMs into a browsable folder.

    Modes:
    - 'viewer' (default): Exports JPGs with the interactive Web PACS Viewer.
    - 'dicom': Exports original DICOM files.
    - 'both': Exports both the Web PACS Viewer and original DICOM files side-by-side.
    """
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
            # Fallback to dicom export if only DICOM exists
            export_viewer = False
            export_dicom = True
        else:
            raise ValueError("Hồ sơ này chưa có ảnh JPG hoặc tài liệu nào để xuất.")

    copied_images = 0
    copied_documents = 0
    copied_dicoms = 0
    pages: list[str] = []

    # ── Export Viewer (JPGs + Interactive HTML) ─────────────────────
    if export_viewer:
        for index, study in enumerate(studies, start=1):
            if should_stop and should_stop():
                break
            log(f"Đang chép ảnh ca {index}/{len(studies)}: {study.title}")
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
                _study_html(patient, study, has_dicom=export_dicom and bool(study.dicom_files)),
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
            log(f"Đang chép file DICOM ca {index}/{len(studies)}: {study.title}")
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

        # Readme instructions
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

        # If only DICOM was exported, write an informational index.html
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
    log(log_msg)

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

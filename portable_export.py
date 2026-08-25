"""Export one patient record as a folder anyone can open in a browser.

A patient who asks for their images gets a USB stick, and whatever is on it has
to work on a machine with nothing installed. Commercial patient media solves
this with an `INDEX.HTM` beside the images; this builds the same thing out of
the JPGs this app already keeps, so no viewer, plugin or installer is needed.

Nothing here invents patient details. A field the archive never recorded is
written as an em dash, because the header of this page is exactly what somebody
uses to check the stick belongs to them.
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
DOCUMENT_SUFFIXES = {".pdf", ".txt"}
# Folder names that hold the DICOM originals or this app's own bookkeeping.
# Neither belongs on a stick handed to a patient.
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

    def image_count(self) -> int:
        return sum(len(item.images) for item in self.series)


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


def _study_folders(patient_folder: Path) -> list[Path]:
    """Study directories inside a patient archive, or the archive itself.

    Matches how the Worklist reads an archive: a folder whose only children are
    `DICOM`/`JPG` is one study, not a patient with two exams.
    """
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
        if not series and not documents:
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
        ))

    # An imported disc records the hospital named in its DICOM tags; older
    # archives may have nothing. The series manifests carry the same tag, so
    # they are the fallback before the field is left empty.
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


PAGE_STYLE = """
:root { color-scheme: light; }
* { box-sizing: border-box; }
body {
  margin: 0; padding: 24px;
  font-family: "Segoe UI", Roboto, Arial, sans-serif;
  background: #ffffff; color: #1f1f1d;
}
header { border-bottom: 1px solid #e9e9e7; padding-bottom: 16px; margin-bottom: 20px; }
h1 { font-size: 20px; margin: 0 0 10px; }
h2 { font-size: 16px; margin: 28px 0 10px; }
.fields { display: flex; flex-wrap: wrap; gap: 6px 24px; font-size: 14px; }
.fields span b { font-weight: 600; }
.muted { color: #73716c; }
a { color: #0f4c81; }
table { border-collapse: collapse; width: 100%; font-size: 14px; }
th, td { border: 1px solid #e9e9e7; padding: 8px 10px; text-align: left; vertical-align: middle; }
th { background: #fbfbfa; font-weight: 600; }
.thumb { width: 64px; height: 64px; object-fit: cover; background: #000; border-radius: 4px; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 10px; }
.grid a { display: block; }
.grid img { width: 100%; height: auto; background: #000; border-radius: 4px; }
.note { margin-top: 28px; font-size: 13px; color: #73716c; line-height: 1.6; }
"""


def _page(title: str, body: str) -> str:
    return (
        "<!DOCTYPE html>\n"
        '<html lang="vi"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width, initial-scale=1">'
        f"<title>{_escape(title)}</title><style>{PAGE_STYLE}</style></head>"
        f"<body>{body}</body></html>\n"
    )


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
        "<header><h1>Hồ sơ hình ảnh y tế</h1>"
        f'<div class="fields">{cells}</div></header>'
    )


def _index_html(patient: dict, studies: list[ExportStudy], pages: list[str]) -> str:
    rows = []
    for study, page in zip(studies, pages):
        first = next((item for item in study.series if item.images), None)
        thumbnail = ""
        if first is not None:
            middle = first.images[len(first.images) // 2]
            source = _relative_url(
                "images", study.folder.name, first.relative.as_posix(), middle.name,
            )
            thumbnail = f'<img class="thumb" src="{_escape(source)}" alt="">'
        rows.append(
            "<tr>"
            f'<td><a href="{_escape(page)}">{_or_dash(study.title)}</a></td>'
            f"<td>{_or_dash(study.date)}</td>"
            f"<td>{_or_dash(study.modality)}</td>"
            f"<td>{len(study.series)}</td>"
            f"<td>{study.image_count()}</td>"
            f"<td>{thumbnail}</td>"
            "</tr>"
        )
    table = (
        "<table><thead><tr>"
        "<th>Ca chụp</th><th>Ngày chụp</th><th>Loại</th>"
        "<th>Số series</th><th>Số ảnh</th><th>Ảnh mẫu</th>"
        "</tr></thead><tbody>" + "".join(rows) + "</tbody></table>"
    )
    if not rows:
        table = '<p class="muted">Hồ sơ này chưa có ảnh JPG nào để xuất.</p>'
    note = (
        '<p class="note">Mở tệp <b>index.html</b> bằng trình duyệt bất kỳ '
        "(Chrome, Edge, Firefox, Safari) — không cần cài phần mềm.<br>"
        "Ảnh trong hồ sơ này là ảnh JPG 8-bit dùng để xem và lưu trữ. "
        "Muốn đo đạc hoặc đổi cửa sổ xám theo chuẩn chẩn đoán thì cần file DICOM gốc.</p>"
    )
    return _page(
        f"Hồ sơ {patient.get('patientName') or patient.get('patientId') or ''}".strip(),
        _patient_header(patient) + table + note,
    )


def _study_html(patient: dict, study: ExportStudy) -> str:
    blocks = []
    for series in study.series:
        def source(image: Path) -> str:
            return _escape(_relative_url(
                "images", study.folder.name, series.relative.as_posix(), image.name,
            ))

        thumbs = "".join(
            f'<a href="{source(image)}" target="_blank" rel="noopener">'
            f'<img loading="lazy" src="{source(image)}" alt="">'
            "</a>"
            for image in series.images
        )
        blocks.append(
            f"<h2>{_escape(series.description)} "
            f'<span class="muted">({len(series.images)} ảnh)</span></h2>'
            f'<div class="grid">{thumbs}</div>'
        )
    if study.documents:
        links = "".join(
            f'<li><a href="{_escape(_relative_url("documents", study.folder.name, document.name))}" '
            f'target="_blank" rel="noopener">{_escape(document.name)}</a></li>'
            for document in study.documents
        )
        blocks.append(f"<h2>Tài liệu kèm theo</h2><ul>{links}</ul>")

    back = '<p><a href="index.html">← Về danh sách ca chụp</a></p>'
    return _page(
        study.title,
        _patient_header(patient) + back + f"<h1>{_escape(study.title)}</h1>" + "".join(blocks),
    )


def export_patient_record(
    patient_folder: Path,
    destination: Path,
    *,
    log: LogFn = lambda _message: None,
    should_stop: Optional[Callable[[], bool]] = None,
) -> dict:
    """Copy a patient's JPGs and documents into a browsable folder.

    Returns what was written. The destination is created if missing; an
    existing folder is added to rather than wiped, so a stick holding another
    patient's export is never destroyed by mistake.
    """
    patient_folder = Path(patient_folder).expanduser().resolve(strict=True)
    destination = Path(destination).expanduser().resolve()
    if (
        destination == patient_folder
        or destination in patient_folder.parents
        or patient_folder in destination.parents
    ):
        # Exporting into the record being read would copy the copies.
        raise ValueError(
            "Thư mục xuất không được nằm trùng, nằm trên hay nằm trong thư mục hồ sơ gốc."
        )
    destination.mkdir(parents=True, exist_ok=True)

    patient, studies = collect_record(patient_folder)
    if not studies:
        raise ValueError("Hồ sơ này chưa có ảnh JPG hoặc tài liệu nào để xuất.")

    copied_images = 0
    copied_documents = 0
    pages: list[str] = []
    for index, study in enumerate(studies, start=1):
        if should_stop and should_stop():
            break
        log(f"Đang chép ca {index}/{len(studies)}: {study.title}")
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
        (destination / page).write_text(_study_html(patient, study), encoding="utf-8")

    (destination / "index.html").write_text(
        _index_html(patient, studies[:len(pages)], pages), encoding="utf-8",
    )
    log(
        f"Đã xuất {len(pages)} ca, {copied_images} ảnh"
        + (f", {copied_documents} tài liệu" if copied_documents else "")
        + f" vào {destination}"
    )
    return {
        "folder": str(destination),
        "studies": len(pages),
        "images": copied_images,
        "documents": copied_documents,
        "patientId": patient.get("patientId", ""),
        "patientName": patient.get("patientName", ""),
    }

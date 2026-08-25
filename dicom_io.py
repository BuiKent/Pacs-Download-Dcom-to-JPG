"""Small, shared helpers for discovering local DICOM image files."""

from __future__ import annotations

from pathlib import Path
from typing import Optional


KNOWN_DICOM_SUFFIXES = {".dcm", ".dicom", ".ima"}
DICOMDIR_NAME = "DICOMDIR"


def find_dicomdir(base: Path) -> Optional[Path]:
    """The `DICOMDIR` index that describes `base`, when the media carries one.

    Patient media burned to CD, DVD or a memory stick keeps `DICOMDIR` at the
    root and the images one level down in `DICOM/`. Callers hand us either
    level, so both are checked before giving up.
    """
    base = Path(base)
    for candidate in (base / DICOMDIR_NAME, base.parent / DICOMDIR_NAME):
        try:
            if candidate.is_file():
                return candidate
        except OSError:
            continue
    return None


def dicomdir_referenced_files(dicomdir: Path) -> set[str]:
    """Casefolded absolute paths of every image `dicomdir` points at.

    Reading the index once costs about a second; sniffing the same media file
    by file costs twenty. The result is only used to *skip* the sniff, never to
    decide the file list, so an index that is stale or incomplete slows the
    scan back down instead of hiding images.
    """
    dicomdir = Path(dicomdir)
    root = dicomdir.parent
    try:
        import pydicom

        dataset = pydicom.dcmread(str(dicomdir))
        records = getattr(dataset, "DirectoryRecordSequence", None) or []
    except Exception:
        return set()

    found: set[str] = set()
    for record in records:
        file_id = getattr(record, "ReferencedFileID", None)
        if not file_id:
            continue
        # ReferencedFileID is VM 1-8: one component per path segment.
        parts = [str(part) for part in file_id] if not isinstance(file_id, str) else [file_id]
        parts = [part for part in parts if part]
        if not parts:
            continue
        try:
            found.add(str(root.joinpath(*parts).resolve()).casefold())
        except OSError:
            continue
    return found


def _is_extensionless_dicom(path: Path) -> bool:
    """Accept extensionless DICOM images without treating every file as DICOM."""
    if path.name.upper() == DICOMDIR_NAME:
        return False
    try:
        import pydicom

        dataset = pydicom.dcmread(
            str(path),
            stop_before_pixels=True,
            force=True,
            specific_tags=["SOPClassUID", "Rows", "Columns"],
        )
        return bool(
            getattr(dataset, "SOPClassUID", "")
            and int(getattr(dataset, "Rows", 0) or 0) > 0
            and int(getattr(dataset, "Columns", 0) or 0) > 0
        )
    except Exception:
        return False


def discover_dicom_files(base: Path) -> list[Path]:
    """Find ordinary, IMA and extensionless DICOM images below ``base``."""
    root = Path(base)
    found: list[Path] = []
    # Built on first sight of an extensionless file, so a folder of plain .dcm
    # never pays for reading the index.
    indexed: Optional[set[str]] = None
    for path in root.rglob("*"):
        if not path.is_file():
            continue
        suffix = path.suffix.lower()
        if suffix in KNOWN_DICOM_SUFFIXES:
            found.append(path)
        elif not suffix:
            if indexed is None:
                dicomdir = find_dicomdir(root)
                indexed = dicomdir_referenced_files(dicomdir) if dicomdir else set()
            try:
                key = str(path.resolve()).casefold()
            except OSError:
                key = str(path).casefold()
            if key in indexed or _is_extensionless_dicom(path):
                found.append(path)
    return sorted(found, key=lambda path: str(path).casefold())


# Technical parameters a reader checks a sequence against. Which ones matter
# depends on the modality, exactly as a PACS text-overlay map does: an MR
# sequence is confirmed by TR/TE, a CT slice by its thickness and table
# position, a radiograph by kVp/mAs.
MR_MODALITIES = {"MR", "MRI"}
XRAY_MODALITIES = {"CR", "DX", "XA", "RF", "MG", "CT"}


def _first_number(value) -> Optional[float]:
    """One float out of a DICOM value that may be a list, a string or None."""
    if value is None:
        return None
    if isinstance(value, (list, tuple)) or type(value).__name__ == "MultiValue":
        value = value[0] if len(value) else None
    if value is None:
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if number == number and abs(number) != float("inf") else None


def acquisition_parameters(dataset, modality: str) -> dict:
    """Acquisition parameters worth printing beside the image.

    A tag the file does not carry is left out entirely, so the overlay can stay
    silent about it rather than print a stand-in value.
    """
    def text(name: str) -> str:
        return str(getattr(dataset, name, "") or "").strip()

    def number(name: str) -> Optional[float]:
        return _first_number(getattr(dataset, name, None))

    code = str(modality or "").upper()
    values: dict = {
        "seriesNumber": text("SeriesNumber"),
        "protocolName": text("ProtocolName"),
        "bodyPart": text("BodyPartExamined"),
        "patientPosition": text("PatientPosition"),
        "institutionName": text("InstitutionName"),
        "accessionNumber": text("AccessionNumber"),
        "referringPhysician": text("ReferringPhysicianName"),
        "studyTime": text("StudyTime")[:6],
        # Slice thickness only: it is constant for a series. SliceLocation
        # changes with every image, and one series-level copy of it would read
        # as a position that never moves while the reader scrolls.
        "sliceThickness": number("SliceThickness"),
    }
    if code in MR_MODALITIES:
        values["repetitionTime"] = number("RepetitionTime")
        values["echoTime"] = number("EchoTime")
        values["magneticFieldStrength"] = number("MagneticFieldStrength")
    if code in XRAY_MODALITIES:
        values["kvp"] = number("KVP")
        values["exposure"] = number("Exposure")
    return {key: value for key, value in values.items() if value not in (None, "")}

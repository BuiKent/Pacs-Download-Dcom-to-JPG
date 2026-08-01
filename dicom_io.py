"""Small, shared helpers for discovering local DICOM image files."""

from __future__ import annotations

from pathlib import Path


KNOWN_DICOM_SUFFIXES = {".dcm", ".dicom", ".ima"}


def _is_extensionless_dicom(path: Path) -> bool:
    """Accept extensionless DICOM images without treating every file as DICOM."""
    if path.name.upper() == "DICOMDIR":
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
    for path in root.rglob("*"):
        if not path.is_file():
            continue
        suffix = path.suffix.lower()
        if suffix in KNOWN_DICOM_SUFFIXES:
            found.append(path)
        elif not suffix and _is_extensionless_dicom(path):
            found.append(path)
    return sorted(found, key=lambda path: str(path).casefold())

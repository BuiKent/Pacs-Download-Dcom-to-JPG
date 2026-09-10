"""One study, one folder name, whichever way it was downloaded.

Every folder either tool writes spells its date `dd-mm-yyyy`, and
`test_folder_name_parity.py` holds the app and the extension to that for patient
and study folders. The JPG folder of a direct download was the one place still
writing `yyyy-mm-dd`, so the same study fetched from the Worklist and fetched
from a pasted viewer link landed under two differently named folders.

`study_folder_base_name` is now the single place that decides this name.
"""

import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import dcom_pipeline

try:
    from pydicom.dataset import Dataset, FileMetaDataset
    from pydicom.uid import CTImageStorage, ExplicitVRLittleEndian, generate_uid
    HAS_PYDICOM = True
except Exception:  # pragma: no cover - pydicom ships with the app
    HAS_PYDICOM = False


def _write_study(root: Path, *, date="20260901", modality="CT", desc="CT Bung") -> Path:
    """A DICOM folder the way a direct download leaves it: `<root>/DICOM`."""
    dicom_dir = root / "DICOM"
    dicom_dir.mkdir(parents=True, exist_ok=True)
    ds = Dataset()
    ds.StudyDate = date
    ds.Modality = modality
    ds.StudyDescription = desc
    ds.SOPClassUID = CTImageStorage
    ds.SOPInstanceUID = generate_uid()
    ds.StudyInstanceUID = generate_uid()
    ds.SeriesInstanceUID = generate_uid()
    file_meta = FileMetaDataset()
    file_meta.MediaStorageSOPClassUID = CTImageStorage
    file_meta.MediaStorageSOPInstanceUID = ds.SOPInstanceUID
    file_meta.TransferSyntaxUID = ExplicitVRLittleEndian
    ds.file_meta = file_meta
    ds.is_little_endian = True
    ds.is_implicit_VR = False
    ds.save_as(str(dicom_dir / "IM00001.dcm"), enforce_file_format=True)
    return dicom_dir


@unittest.skipUnless(HAS_PYDICOM, "pydicom is required to write the fixture")
class JpgFolderNamingTests(unittest.TestCase):
    def test_a_direct_download_names_its_folder_like_the_archive_does(self):
        with tempfile.TemporaryDirectory() as tmp:
            dicom_dir = _write_study(Path(tmp))
            direct = dcom_pipeline._jpg_folder_name(dicom_dir)

        archive = dcom_pipeline.study_folder_base_name(
            {"date": "20260901", "modality": "CT", "desc": "CT Bung"},
        )
        self.assertEqual(direct, archive)
        self.assertEqual(direct, "01-09-2026 - CT - CT Bung")

    def test_the_date_reads_day_first(self):
        # 01-09-2026 is 1 September. A reader scanning a list of folders sorts
        # them by eye, and two orders in one archive make that unreliable.
        with tempfile.TemporaryDirectory() as tmp:
            dicom_dir = _write_study(Path(tmp), date="20260901")
            self.assertTrue(dcom_pipeline._jpg_folder_name(dicom_dir).startswith("01-09-2026"))

    def test_a_folder_written_before_the_change_is_reused(self):
        # Resuming must not open a second folder beside the first: one study's
        # images split across two folders reads as two half-empty studies.
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            dicom_dir = _write_study(root)
            legacy = root / "2026-09-01 - CT - CT Bung"
            legacy.mkdir()

            self.assertEqual(dcom_pipeline._jpg_folder_name(dicom_dir), legacy.name)

    def test_an_unrelated_legacy_folder_is_not_reused(self):
        # Only this study's own previous folder counts.
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            dicom_dir = _write_study(root)
            (root / "2026-08-01 - MR - MRI Nao").mkdir()

            self.assertEqual(
                dcom_pipeline._jpg_folder_name(dicom_dir), "01-09-2026 - CT - CT Bung",
            )

    def test_missing_tags_fall_back_the_way_the_archive_does(self):
        with tempfile.TemporaryDirectory() as tmp:
            dicom_dir = _write_study(Path(tmp), date="", modality="", desc="")
            name = dcom_pipeline._jpg_folder_name(dicom_dir)

        self.assertEqual(
            name,
            dcom_pipeline.study_folder_base_name({"date": "", "modality": "", "desc": ""}),
        )
        self.assertIn("KHONG_RO_NGAY", name)


if __name__ == "__main__":
    unittest.main()

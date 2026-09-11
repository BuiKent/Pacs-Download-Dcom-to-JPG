"""Two places the archive stated something it had not checked.

Both follow the same shape as the modality and badge problems fixed alongside
them: a value written once, or borrowed from a neighbour, and then reported to
the reader as though it had been confirmed.
"""

import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import dcom_pipeline
import web_backend
from dicom_test_utils import write_test_dicom


def _study(uid: str) -> dict:
    return {
        "study_uid": uid,
        "date": "2026-08-06",
        "modality": "CT",
        "desc": "CT so nao",
    }


class DownloadedMeansOnDiskTests(unittest.TestCase):
    """"Đã tải" decides whether a study is offered for download again.

    `download-selection.js` leaves a study unticked when its `local_status` is
    "downloaded", so this field is what sends a reader away from a record. The
    manifest is written once when a download finishes and never revisited, so a
    folder emptied afterwards to reclaim space kept reporting itself complete —
    and the study stayed unticked, leaving the reader without images the app
    had told them they had.
    """

    def _archive(self, root: Path, study: dict, *, with_images: bool) -> Path:
        folder, _manifest, _created = dcom_pipeline.ensure_patient_archive(
            root,
            patient_id="2605032022",
            patient_name="Nguyễn Văn A",
            hospital_key="vduh",
            hospital_name="Bệnh viện Hữu nghị Việt Đức",
        )
        study_folder = folder / dcom_pipeline.study_archive_folder_name(study)
        study_folder.mkdir(parents=True, exist_ok=True)
        if with_images:
            write_test_dicom(study_folder / "DICOM" / "IM_0001.dcm")
        dcom_pipeline.record_patient_study(
            folder, study, study_folder, complete=True, image_count=100,
        )
        return study_folder

    def _status(self, root: Path, studies: list[dict]) -> dict:
        return dcom_pipeline.patient_archive_status(
            root,
            patient_id="2605032022",
            patient_name="Nguyễn Văn A",
            hospital_key="vduh",
            hospital_name="Bệnh viện Hữu nghị Việt Đức",
            studies=studies,
        )

    def test_a_study_with_its_images_reports_downloaded(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            studies = [_study("1.2.3.1")]
            self._archive(root, studies[0], with_images=True)
            result = self._status(root, studies)
            self.assertEqual(studies[0]["local_status"], "downloaded")
            self.assertEqual(result["downloadedStudies"], 1)

    def test_a_folder_emptied_afterwards_no_longer_reports_downloaded(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            studies = [_study("1.2.3.1")]
            study_folder = self._archive(root, studies[0], with_images=True)
            for path in sorted(study_folder.rglob("*"), reverse=True):
                if path.is_file():
                    path.unlink()

            result = self._status(root, studies)
            self.assertEqual(
                studies[0]["local_status"],
                "incomplete",
                "a study whose images are gone must be offered for download again",
            )
            self.assertEqual(result["downloadedStudies"], 0)

    def test_a_folder_deleted_entirely_no_longer_reports_downloaded(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            studies = [_study("1.2.3.1")]
            study_folder = self._archive(root, studies[0], with_images=True)
            for path in sorted(study_folder.rglob("*"), reverse=True):
                if path.is_file():
                    path.unlink()
                else:
                    path.rmdir()
            study_folder.rmdir()
            self._status(root, studies)
            self.assertEqual(studies[0]["local_status"], "incomplete")

    def test_an_entry_naming_no_folder_is_left_alone(self):
        """A legacy index recovered from DICOM headers records no folder.

        There is nothing to check it against, and downgrading it on a guess
        would tick a multi-gigabyte study the reader already holds.
        """
        self.assertIsNone(
            dcom_pipeline._study_entry_has_files(Path("/archive"), {"status": "complete"}),
        )
        self.assertIsNone(
            dcom_pipeline._study_entry_has_files(None, {"folder": "anything"}),
        )


def _record(series_id: str, modality: str, folder: Path) -> web_backend.SeriesRecord:
    return web_backend.SeriesRecord(
        series_id=series_id,
        name=f"Series {series_id}",
        folder=folder / series_id,
        images=[folder / series_id / "IM_00001.dcm"],
        manifest={},
        mpr_ready=False,
        mpr_reason="",
        study_group="2026-08-06 - CT - CT so nao",
        study_date="2026-08-06",
        study_uid="1.2.840.1",
        source_type="dicom",
        modality=modality,
    )


class SiblingModalityTests(unittest.TestCase):
    """A study's modality is not every series' modality.

    Companion series in a study folder have their gaps filled from the study's
    dominant modality. The test for "has a modality" was membership of
    `DIAGNOSTIC_MODALITIES`, which lists the modalities that carry images — so
    every real non-image modality counted as missing, and a Dose Report ("SR"),
    a presentation state ("PR") or a key-object note ("KO") filed beside a CT
    had its own recorded modality replaced by "CT".
    """

    def _harmonized(self, records: dict) -> dict:
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            web_backend.ArchiveCatalog._harmonize_study_folder_records(records, root)
        return records

    def test_a_dose_report_keeps_its_own_modality(self):
        folder = Path("/archive/2026-08-06 - CT - CT so nao")
        records = {
            "s1": _record("s1", "CT", folder),
            "s2": _record("s2", "CT", folder),
            "sr": _record("sr", "SR", folder),
        }
        self._harmonized(records)
        self.assertEqual(records["sr"].modality, "SR")
        self.assertEqual(records["s1"].modality, "CT")

    def test_a_presentation_state_keeps_its_own_modality(self):
        folder = Path("/archive/2026-08-06 - CT - CT so nao")
        records = {
            "s1": _record("s1", "CT", folder),
            "pr": _record("pr", "PR", folder),
        }
        self._harmonized(records)
        self.assertEqual(records["pr"].modality, "PR")

    def test_a_series_with_no_modality_still_gets_the_study_s(self):
        """Filling a gap is the point of this pass and must keep working."""
        folder = Path("/archive/2026-08-06 - CT - CT so nao")
        records = {
            "s1": _record("s1", "CT", folder),
            "s2": _record("s2", "CT", folder),
            "gap": _record("gap", "", folder),
            "unknown": _record("unknown", "UNKNOWN", folder),
        }
        self._harmonized(records)
        self.assertEqual(records["gap"].modality, "CT")
        self.assertEqual(records["unknown"].modality, "CT")


if __name__ == "__main__":
    unittest.main()

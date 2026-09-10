"""What the app makes of a folder the browser extension filled.

The two tools only meet on disk. The extension writes the images and leaves
`dcom-source.json` beside them, carrying the one thing the DICOM tags cannot:
the viewer link the study came from, and how many images the download believed
it had written.

Until now that file was read on exactly one path — "Nhập từ thư mục/đĩa". A
reader who instead points the archive straight at the extension's folder got a
study with no link behind "Tải tiếp" and no sign that the download had stopped
short, both failing silently.
"""

import json
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import dcom_pipeline
import web_backend


class _StubJob:
    @staticmethod
    def snapshot() -> dict:
        return {}


class _StubController:
    job = _StubJob()


def _scan(study_dir: Path, record=None) -> dict:
    return web_backend.WorklistScanner(_StubController())._scan_study(
        study_dir, {}, record,
    )


def _build_study(root: Path, slices: int, sidecar: dict | None) -> Path:
    study = root / "01-09-2026 - CT - CT Bung"
    dicom = study / "DICOM"
    dicom.mkdir(parents=True)
    for index in range(slices):
        (dicom / f"IM{index:05d}.dcm").write_bytes(b"\x00" * 300)
    if sidecar is not None:
        (study / dcom_pipeline.EXTENSION_SIDECAR_NAME).write_text(
            json.dumps(sidecar), encoding="utf-8",
        )
    return study


def _sidecar(image_count: int, url: str = "https://pacs.example/viewer?studyUID=1.2.3") -> dict:
    return {
        "format": dcom_pipeline.EXTENSION_SIDECAR_FORMAT,
        "sourceUrl": url,
        "studyInstanceUid": "1.2.3",
        "patientId": "BN001",
        "studyDate": "20260901",
        "modality": "CT",
        "imageCount": image_count,
        "downloadedAt": "2026-09-01T10:00:00.000Z",
    }


class ViewerLinkHandoffTests(unittest.TestCase):
    def test_the_link_is_read_from_the_sidecar_when_there_is_no_manifest(self):
        # The whole point: "Tải tiếp" needs a link, and this folder has one.
        with TemporaryDirectory() as tmp:
            study = _build_study(Path(tmp), slices=5, sidecar=_sidecar(5))
            self.assertEqual(
                _scan(study)["viewerUrl"],
                "https://pacs.example/viewer?studyUID=1.2.3",
            )

    def test_the_manifest_link_wins_over_the_sidecar(self):
        # `patient-index.json` is written by the pipeline from the tags and the
        # run that produced them; the sidecar is the fallback, not the override.
        with TemporaryDirectory() as tmp:
            study = _build_study(Path(tmp), slices=5, sidecar=_sidecar(5))
            scanned = _scan(study, {"viewerUrl": "https://manifest.example/viewer"})
            self.assertEqual(scanned["viewerUrl"], "https://manifest.example/viewer")

    def test_a_study_with_no_sidecar_still_scans(self):
        with TemporaryDirectory() as tmp:
            study = _build_study(Path(tmp), slices=5, sidecar=None)
            self.assertEqual(_scan(study)["viewerUrl"], "")
            self.assertEqual(_scan(study)["status"], "done")

    def test_a_foreign_json_beside_the_study_is_ignored(self):
        # `read_extension_sidecar` checks the format marker; anything else on
        # disk with that name must not be believed.
        with TemporaryDirectory() as tmp:
            study = _build_study(Path(tmp), slices=5, sidecar={"sourceUrl": "https://evil.example"})
            self.assertEqual(_scan(study)["viewerUrl"], "")


class ShortDownloadTests(unittest.TestCase):
    def test_a_download_that_stopped_short_reads_as_incomplete(self):
        # The extension recorded 120 images; 90 are on disk. Reporting "Đã tải"
        # would tell the reader a study is complete when 30 slices are missing.
        with TemporaryDirectory() as tmp:
            study = _build_study(Path(tmp), slices=90, sidecar=_sidecar(120))
            scanned = _scan(study)

        self.assertEqual(scanned["status"], "part")
        self.assertEqual(scanned["statusLabel"], "Thiếu 30/120 ảnh")
        # "part" plus a link is what puts the "Tải tiếp" button on screen.
        self.assertTrue(scanned["viewerUrl"])

    def test_a_complete_download_reads_as_complete(self):
        with TemporaryDirectory() as tmp:
            study = _build_study(Path(tmp), slices=120, sidecar=_sidecar(120))
            self.assertEqual(_scan(study)["status"], "done")

    def test_more_images_than_recorded_is_not_a_shortfall(self):
        # A resumed download can leave more on disk than any single run wrote.
        with TemporaryDirectory() as tmp:
            study = _build_study(Path(tmp), slices=130, sidecar=_sidecar(120))
            self.assertEqual(_scan(study)["status"], "done")

    def test_the_manifest_verdict_is_not_overridden(self):
        # A doctor who deliberately picked some series is not looking at a
        # failure, and the label must keep saying so.
        with TemporaryDirectory() as tmp:
            study = _build_study(Path(tmp), slices=90, sidecar=_sidecar(120))
            scanned = _scan(study, {"status": "selected"})

        self.assertEqual(scanned["statusLabel"], "Đã tải series đã chọn")

    def test_a_study_converted_to_jpg_is_not_called_short(self):
        # Once the DICOM files are gone there is nothing to compare, and a
        # shortfall computed from zero would condemn every converted study.
        with TemporaryDirectory() as tmp:
            study = Path(tmp) / "01-09-2026 - CT - CT Bung"
            jpg = study / "JPG"
            jpg.mkdir(parents=True)
            for index in range(90):
                (jpg / f"slice_{index}.jpg").write_bytes(b"\x00" * 300)
            (study / dcom_pipeline.EXTENSION_SIDECAR_NAME).write_text(
                json.dumps(_sidecar(120)), encoding="utf-8",
            )

            self.assertEqual(_scan(study)["status"], "done")

    def test_a_corrupt_image_count_is_ignored(self):
        with TemporaryDirectory() as tmp:
            broken = _sidecar(120)
            broken["imageCount"] = "một trăm hai mươi"
            study = _build_study(Path(tmp), slices=90, sidecar=broken)
            self.assertEqual(_scan(study)["status"], "done")


class ExtensionOutputDiscoveryTests(unittest.TestCase):
    """Two patients in the extension's save folder must stay two patients.

    The extension writes images, never `patient-index.json`, so the manifest
    test that identifies a patient folder finds nothing anywhere beneath its
    save folder. The scan then filed that whole folder as a single patient, and
    every patient inside it collapsed into one worklist row — under the name
    "DCom to JPG". Merging two people into one record is the failure the
    worklist exists to prevent.
    """

    @staticmethod
    def _extension_output(root: Path) -> Path:
        save_folder = root / dcom_pipeline.EXTENSION_DEFAULT_SUBFOLDER
        for patient_id, name in (("BN001", "NGUYEN VAN AN"), ("BN002", "TRAN THI BINH")):
            dicom = (
                save_folder
                / f"{patient_id} - {name} - 45T - 10-09-2026"
                / "01-09-2026 - CT - CT Bung"
                / "DICOM"
            )
            dicom.mkdir(parents=True)
            for index in range(3):
                (dicom / f"IM{index:05d}.dcm").write_bytes(b"\x00" * 300)
        return save_folder

    def _discover(self, root: Path):
        scanner = web_backend.WorklistScanner(_StubController())
        return scanner._discover_patient_archives(root)

    def test_pointing_at_the_parent_folder_finds_each_patient(self):
        # The reader picks the folder they gave the extension, or the one above
        # it. Neither should decide whether two patients stay separate.
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            self._extension_output(root)
            found = self._discover(root)

        names = sorted(path.name for path, _category in found)
        self.assertEqual(len(found), 2, f"expected two patients, got {names}")
        self.assertTrue(names[0].startswith("BN001"))
        self.assertTrue(names[1].startswith("BN002"))
        self.assertTrue(
            all(category == dcom_pipeline.EXTENSION_DEFAULT_SUBFOLDER
                for _path, category in found),
            "the save folder groups the patients, so it is their category",
        )

    def test_pointing_at_the_save_folder_finds_each_patient(self):
        with TemporaryDirectory() as tmp:
            save_folder = self._extension_output(Path(tmp))
            found = self._discover(save_folder)

        names = sorted(path.name for path, _category in found)
        self.assertEqual(len(found), 2, f"expected two patients, got {names}")

    def test_a_patient_folder_itself_is_still_one_patient(self):
        # The guard on the fix: a folder whose NAME is a patient folder must not
        # be split open just because its studies sit below it.
        with TemporaryDirectory() as tmp:
            save_folder = self._extension_output(Path(tmp))
            patient = next(p for p in save_folder.iterdir() if p.is_dir())
            found = self._discover(patient)

        self.assertEqual(len(found), 1)
        self.assertEqual(found[0][0].name, patient.name)


if __name__ == "__main__":
    unittest.main()

"""Exporting a patient record onto something a patient can actually open.

The page is what somebody checks to confirm the stick is theirs, so the header
must show what the archive recorded and nothing else — a missing date of birth
stays an em dash rather than becoming a plausible-looking date.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

import dcom_pipeline
import portable_export


def build_archive(root: Path, *, with_manifest: bool = True, studies: int = 2) -> Path:
    """A patient archive shaped the way a download leaves it."""
    patient = root / "HOANG MINH THIEP - KHONG_RO_TUOI - R0152082B - 2026-08-25"
    patient.mkdir(parents=True)
    if with_manifest:
        dcom_pipeline.write_local_import_manifest(
            patient,
            {
                "patient_id": "R0152082B",
                "patient_name": "HOANG MINH THIEP",
                "patient_birth_date": "1975-11-30",
                "patient_sex": "M",
            },
            log=lambda _message: None,
        )
    for index in range(1, studies + 1):
        study = patient / f"2026-07-2{index} - MR - MRI Brain {index}"
        series = study / "JPG" / f"Series_{index}"
        series.mkdir(parents=True)
        for image in range(1, 4):
            (series / f"IM_{image:04d}.jpg").write_bytes(b"\xff\xd8\xff\xd9")
        (series / "mpr-volume.json").write_text(
            json.dumps({"series_description": f"Ax T2 FLAIR {index}", "modality": "MR"}),
            encoding="utf-8",
        )
        (study / "DICOM").mkdir()
        (study / "DICOM" / "IM_0001.dcm").write_bytes(b"not-really-dicom")
        if with_manifest:
            dcom_pipeline.record_patient_study(
                patient,
                {
                    "study_uid": f"1.2.{index}",
                    "date": f"2026-07-2{index}",
                    "modality": "MR",
                    "desc": f"MRI Brain {index}",
                },
                study,
                complete=True,
                image_count=3,
            )
    return patient


class ExportTests(unittest.TestCase):
    def test_the_export_is_browsable_and_carries_every_study(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            patient = build_archive(root)
            destination = root / "usb"

            result = portable_export.export_patient_record(patient, destination)

            self.assertEqual(result["studies"], 2)
            self.assertEqual(result["images"], 6)
            export_folder = Path(result["folder"])
            self.assertEqual(export_folder.name, "HOANG MINH THIEP - R0152082B")
            html_file = Path(result["htmlFile"])
            self.assertTrue(html_file.is_file())
            self.assertEqual(html_file.name, "HOANG MINH THIEP - R0152082B.html")

            content = html_file.read_text(encoding="utf-8")
            self.assertIn("HOANG MINH THIEP", content)
            self.assertIn("R0152082B", content)
            self.assertEqual(len(list((export_folder / "images").rglob("*.jpg"))), 6)
            # Verify no redundant extra html files
            self.assertEqual(len(list(export_folder.glob("*.html"))), 1)

    def test_the_dicom_originals_are_not_copied_onto_the_stick(self):
        """The export is the JPG record; shipping the DICOM would multiply its size."""
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            patient = build_archive(root)
            destination = root / "usb"

            result = portable_export.export_patient_record(patient, destination)
            export_folder = Path(result["folder"])

            self.assertEqual(list(export_folder.rglob("*.dcm")), [])

    def test_a_field_the_archive_never_recorded_is_shown_as_a_dash(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            patient = build_archive(root, with_manifest=False)
            destination = root / "usb"

            result = portable_export.export_patient_record(patient, destination)
            html_file = Path(result["htmlFile"])
            content = html_file.read_text(encoding="utf-8")
            self.assertIn("Ngày sinh</dt><dd>—", content)
            self.assertIn("Giới tính</dt><dd>—", content)

    def test_study_pages_link_every_image_of_every_series(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            patient = build_archive(root, studies=1)
            destination = root / "usb"

            result = portable_export.export_patient_record(patient, destination)
            html_file = Path(result["htmlFile"])
            content = html_file.read_text(encoding="utf-8")
            self.assertIn("Ax T2 FLAIR 1", content)
            for image in ("IM_0001.jpg", "IM_0002.jpg", "IM_0003.jpg"):
                self.assertIn(image, content)

    def test_documents_filed_with_a_study_travel_with_it(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            patient = build_archive(root, studies=1)
            study = next(path for path in patient.iterdir() if path.name.startswith("2026"))
            (study / "ket-qua.pdf").write_bytes(b"%PDF-1.4\n")
            destination = root / "usb"

            result = portable_export.export_patient_record(patient, destination)
            export_folder = Path(result["folder"])

            self.assertTrue((export_folder / "documents").exists())
            self.assertEqual(len(list((export_folder / "documents").rglob("*.pdf"))), 1)
            self.assertIn("ket-qua.pdf", Path(result["htmlFile"]).read_text(encoding="utf-8"))

    def test_exporting_into_the_record_itself_is_refused(self):
        """Copying a folder into itself would recurse until the disk filled."""
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            patient = build_archive(root, studies=1)
            for destination in (patient, patient / "usb", patient.parent):
                with self.subTest(destination=str(destination)):
                    with self.assertRaises(ValueError):
                        portable_export.export_patient_record(patient, destination)

    def test_a_record_with_no_images_reports_that_instead_of_writing_an_empty_page(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            empty = root / "empty"
            empty.mkdir()
            with self.assertRaises(ValueError):
                portable_export.export_patient_record(empty, root / "usb")

    def test_internal_sidecars_are_not_handed_over_as_patient_documents(self):
        """mpr-volume.json is pipeline bookkeeping, not something a patient gets."""
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            patient = build_archive(root, studies=1)
            destination = root / "usb"

            result = portable_export.export_patient_record(patient, destination)

            self.assertEqual(result["documents"], 0)
            export_folder = Path(result["folder"])
            self.assertEqual(list(export_folder.rglob("mpr-volume.json")), [])
            self.assertEqual(list(export_folder.rglob("patient-index.json")), [])

    def test_a_record_holding_only_documents_is_still_exported(self):
        """A report with no pictures is the whole record for some patients."""
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            patient = root / "NGUYEN THI HOA - R0900001 - 2026-08-25"
            study = patient / "2026-07-21 - XA - Ket qua"
            study.mkdir(parents=True)
            (study / "ket-qua.pdf").write_bytes(b"%PDF-1.4\n")

            result = portable_export.export_patient_record(patient, root / "usb")

            self.assertEqual(result["documents"], 1)
            self.assertEqual(result["images"], 0)
            export_folder = Path(result["folder"])
            self.assertEqual(len(list((export_folder / "documents").rglob("*.pdf"))), 1)

    def test_a_record_with_only_dicom_falls_back_and_reports_the_mode_it_used(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            patient = build_archive(root, studies=1)
            for image in (patient / "2026-07-21 - MR - MRI Brain 1").rglob("*.jpg"):
                image.unlink()

            result = portable_export.export_patient_record(
                patient, root / "usb", mode="viewer",
            )

            # Asking for a viewer and silently getting DICOM originals would
            # leave the log claiming something that never happened.
            self.assertEqual(result["mode"], "dicom")
            self.assertGreater(result["dicoms"], 0)

    def test_an_unknown_export_mode_is_refused_rather_than_writing_nothing(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            patient = build_archive(root, studies=1)

            with self.assertRaises(ValueError):
                portable_export.export_patient_record(
                    patient, root / "usb", mode="viewr",
                )

    def test_the_page_escapes_names_rather_than_letting_them_become_markup(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            patient = build_archive(root, studies=1)
            manifest = json.loads(
                (patient / "patient-index.json").read_text(encoding="utf-8"),
            )
            manifest["patientName"] = "<script>alert(1)</script>"
            (patient / "patient-index.json").write_text(
                json.dumps(manifest, ensure_ascii=False), encoding="utf-8",
            )
            destination = root / "usb"

            result = portable_export.export_patient_record(patient, destination)
            html_file = Path(result["htmlFile"])
            content = html_file.read_text(encoding="utf-8")
            self.assertNotIn("<script>alert(1)</script>", content)
            self.assertIn("&lt;script&gt;", content)

    def test_detect_patient_export_contents(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            patient = build_archive(root, studies=2)
            contents = portable_export.detect_patient_export_contents(patient)

            self.assertTrue(contents["hasJpg"])
            self.assertTrue(contents["hasDicom"])
            self.assertEqual(contents["jpgCount"], 6)
            self.assertEqual(contents["dicomCount"], 2)
            self.assertEqual(contents["studyCount"], 2)
            self.assertEqual(contents["seriesCount"], 2)

    def test_export_dicom_mode_copies_dicom_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            patient = build_archive(root, studies=1)
            destination = root / "usb_dicom"

            result = portable_export.export_patient_record(patient, destination, mode="dicom")
            export_folder = Path(result["folder"])

            self.assertEqual(result["dicoms"], 1)
            self.assertEqual(len(list((export_folder / "DICOM").rglob("*.dcm"))), 1)
            self.assertTrue((export_folder / "HUONG_DAN_DICOM.txt").is_file())
            html_file = Path(result["htmlFile"])
            content = html_file.read_text(encoding="utf-8")
            self.assertIn("HỒ SƠ DICOM", content.upper())

    def test_export_both_mode_copies_both_jpg_and_dicom(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            patient = build_archive(root, studies=1)
            destination = root / "usb_both"

            result = portable_export.export_patient_record(patient, destination, mode="both")
            export_folder = Path(result["folder"])

            self.assertEqual(result["images"], 3)
            self.assertEqual(result["dicoms"], 1)
            self.assertTrue(Path(result["htmlFile"]).is_file())
            self.assertEqual(len(list((export_folder / "images").rglob("*.jpg"))), 3)
            self.assertEqual(len(list((export_folder / "DICOM").rglob("*.dcm"))), 1)

    def test_web_pacs_viewer_contains_interactive_controls(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            patient = build_archive(root, studies=1)
            destination = root / "usb"

            result = portable_export.export_patient_record(patient, destination, mode="viewer")
            html_file = Path(result["htmlFile"])
            page = html_file.read_text(encoding="utf-8")
            # Verify 1:1 App Port Web PACS Viewer elements
            self.assertIn("app-shell", page)
            self.assertIn("rec-rail", page)
            self.assertIn("series-strip", page)
            self.assertIn("workspace-grid", page)
            self.assertIn("viewport-shell-0", page)
            self.assertIn("annotation-canvas-0", page)
            self.assertIn("btn-sync-crosshair", page)
            self.assertIn("btn-sync-scroll", page)
            self.assertIn("setLayout", page)
            self.assertIn("modal-shortcuts", page)
            self.assertIn("DATA =", page)
            self.assertIn("setTool", page)
            self.assertIn("setWindowPreset", page)
            self.assertIn("stepSlice", page)


def _node_available() -> bool:
    return shutil.which("node") is not None


class ExportedViewerScriptTests(unittest.TestCase):
    """The viewer is one generated script that nothing else parses.

    A stray edit to it produces a page that opens blank on the patient's
    machine, with no error anywhere on this side, so the script is handed to a
    real JavaScript parser here.
    """

    @unittest.skipUnless(_node_available(), "node không có trong PATH")
    def test_the_generated_viewer_script_parses(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            patient = build_archive(root, studies=2)
            result = portable_export.export_patient_record(patient, root / "usb")
            html = Path(result["htmlFile"]).read_text(encoding="utf-8")

            scripts = re.findall(r"<script[^>]*>(.*?)</script>", html, re.S)
            self.assertTrue(scripts, "Trang xuất ra không có khối script nào.")

            script_file = root / "viewer-script.js"
            script_file.write_text("\n".join(scripts), encoding="utf-8")
            check = subprocess.run(
                ["node", "--check", str(script_file)],
                capture_output=True,
                text=True,
            )
            self.assertEqual(check.returncode, 0, check.stderr)


if __name__ == "__main__":
    unittest.main()


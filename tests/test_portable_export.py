"""Exporting a patient record onto something a patient can actually open.

The page is what somebody checks to confirm the stick is theirs, so the header
must show what the archive recorded and nothing else — a missing date of birth
stays an em dash rather than becoming a plausible-looking date.
"""

from __future__ import annotations

import json
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
            index = (destination / "index.html").read_text(encoding="utf-8")
            self.assertIn("HOANG MINH THIEP", index)
            self.assertIn("R0152082B", index)
            self.assertIn("ca-01.html", index)
            self.assertIn("ca-02.html", index)
            self.assertTrue((destination / "ca-01.html").is_file())
            self.assertEqual(len(list((destination / "images").rglob("*.jpg"))), 6)

    def test_the_dicom_originals_are_not_copied_onto_the_stick(self):
        """The export is the JPG record; shipping the DICOM would multiply its size."""
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            patient = build_archive(root)
            destination = root / "usb"

            portable_export.export_patient_record(patient, destination)

            self.assertEqual(list(destination.rglob("*.dcm")), [])

    def test_a_field_the_archive_never_recorded_is_shown_as_a_dash(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            patient = build_archive(root, with_manifest=False)
            destination = root / "usb"

            portable_export.export_patient_record(patient, destination)

            index = (destination / "index.html").read_text(encoding="utf-8")
            # No manifest means no demographics. The page must say so rather
            # than fill the header from the folder name.
            self.assertIn("Ngày sinh:</b> —", index)
            self.assertIn("Giới tính:</b> —", index)
            self.assertNotIn("Nam", index.split("</header>")[0])

    def test_study_pages_link_every_image_of_every_series(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            patient = build_archive(root, studies=1)
            destination = root / "usb"

            portable_export.export_patient_record(patient, destination)

            page = (destination / "ca-01.html").read_text(encoding="utf-8")
            self.assertIn("Ax T2 FLAIR 1", page)
            for image in ("IM_0001.jpg", "IM_0002.jpg", "IM_0003.jpg"):
                self.assertIn(image, page)
            self.assertIn('href="index.html"', page)

    def test_documents_filed_with_a_study_travel_with_it(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            patient = build_archive(root, studies=1)
            study = next(path for path in patient.iterdir() if path.name.startswith("2026"))
            (study / "ket-qua.pdf").write_bytes(b"%PDF-1.4\n")
            destination = root / "usb"

            portable_export.export_patient_record(patient, destination)

            self.assertTrue((destination / "documents").exists())
            self.assertEqual(len(list((destination / "documents").rglob("*.pdf"))), 1)
            self.assertIn("ket-qua.pdf", (destination / "ca-01.html").read_text(encoding="utf-8"))

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

            portable_export.export_patient_record(patient, destination)

            index = (destination / "index.html").read_text(encoding="utf-8")
            self.assertNotIn("<script>alert(1)</script>", index)
            self.assertIn("&lt;script&gt;", index)

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

            self.assertEqual(result["dicoms"], 1)
            self.assertEqual(len(list((destination / "DICOM").rglob("*.dcm"))), 1)
            self.assertTrue((destination / "HUONG_DAN_DICOM.txt").is_file())
            index = (destination / "index.html").read_text(encoding="utf-8")
            self.assertIn("HỒ SƠ DICOM", index.upper())

    def test_export_both_mode_copies_both_jpg_and_dicom(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            patient = build_archive(root, studies=1)
            destination = root / "usb_both"

            result = portable_export.export_patient_record(patient, destination, mode="both")

            self.assertEqual(result["images"], 3)
            self.assertEqual(result["dicoms"], 1)
            self.assertTrue((destination / "ca-01.html").is_file())
            self.assertEqual(len(list((destination / "images").rglob("*.jpg"))), 3)
            self.assertEqual(len(list((destination / "DICOM").rglob("*.dcm"))), 1)

    def test_web_pacs_viewer_contains_interactive_controls(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            patient = build_archive(root, studies=1)
            destination = root / "usb"

            portable_export.export_patient_record(patient, destination, mode="viewer")

            page = (destination / "ca-01.html").read_text(encoding="utf-8")
            # Verify Web PACS Viewer elements
            self.assertIn("slice-slider", page)
            self.assertIn("btn-compare", page)
            self.assertIn("btn-play", page)
            self.assertIn("modal-shortcuts", page)
            self.assertIn("pacs-img-1", page)
            self.assertIn("DATA =", page)
            self.assertIn("toggleCompare", page)
            self.assertIn("stepSlice", page)


if __name__ == "__main__":
    unittest.main()


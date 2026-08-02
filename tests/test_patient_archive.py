from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import dcom_pipeline
import pydicom
from tests.test_web_backend import write_local_dicom
from web_backend import WebController
from web_backend import ArchiveCatalog


def study(uid: str, *, date: str = "2026-08-02", description: str = "MR BRAIN") -> dict:
    return {
        "study_uid": uid,
        "patient_id": "2605032022",
        "patient_name": "Nguyễn Văn A",
        "hospital_key": "vduh",
        "hospital_name": "Bệnh viện Hữu nghị Việt Đức",
        "date": date,
        "modality": "MR",
        "desc": description,
        "direct_url": "https://viewer.test/study",
    }


class PatientArchiveTests(unittest.TestCase):
    @staticmethod
    def wait_for_job(controller: WebController) -> dict:
        import time

        deadline = time.time() + 5
        while controller.job.snapshot()["status"] == "running" and time.time() < deadline:
            time.sleep(0.01)
        return controller.job.snapshot()

    def test_patient_folder_is_reused_and_studies_are_classified(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            studies = [study("1.2.840.113619.1"), study("1.2.840.113619.2")]

            before = dcom_pipeline.patient_archive_status(
                root,
                patient_id="2605032022",
                patient_name="Nguyễn Văn A",
                hospital_key="vduh",
                hospital_name="Bệnh viện Hữu nghị Việt Đức",
                studies=studies,
            )
            self.assertFalse(before["exists"])
            self.assertEqual(2, before["newStudies"])

            folder, _manifest, created = dcom_pipeline.ensure_patient_archive(
                root,
                patient_id="2605032022",
                patient_name="Nguyễn Văn A",
                hospital_key="vduh",
                hospital_name="Bệnh viện Hữu nghị Việt Đức",
            )
            self.assertTrue(created)
            self.assertTrue(folder.name.startswith("2605032022 - Nguyễn Văn A - Bệnh viện Hữu nghị Việt Đức - "))
            first_study_folder = folder / dcom_pipeline.study_archive_folder_name(studies[0])
            first_study_folder.mkdir()
            dcom_pipeline.record_patient_study(
                folder, studies[0], first_study_folder, complete=True, image_count=121,
            )

            same_folder, _manifest, created_again = dcom_pipeline.ensure_patient_archive(
                root,
                patient_id="2605032022",
                patient_name="NGUYEN VAN A",
                hospital_key="vduh",
                hospital_name="Bệnh viện Hữu nghị Việt Đức",
            )
            self.assertFalse(created_again)
            self.assertEqual(folder, same_folder)
            after = dcom_pipeline.patient_archive_status(
                root,
                patient_id="2605032022",
                patient_name="Nguyễn Văn A",
                hospital_key="vduh",
                hospital_name="Bệnh viện Hữu nghị Việt Đức",
                studies=studies,
            )
            self.assertEqual(1, after["downloadedStudies"])
            self.assertEqual(1, after["newStudies"])
            self.assertEqual("downloaded", studies[0]["local_status"])
            self.assertEqual("new", studies[1]["local_status"])

    def test_same_patient_id_with_different_name_is_blocked(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            dcom_pipeline.ensure_patient_archive(
                root,
                patient_id="2605032022",
                patient_name="Nguyễn Văn A",
                hospital_key="vduh",
                hospital_name="Bệnh viện Hữu nghị Việt Đức",
            )
            with self.assertRaisesRegex(ValueError, "tên không khớp"):
                dcom_pipeline.ensure_patient_archive(
                    root,
                    patient_id="2605032022",
                    patient_name="Trần Văn B",
                    hospital_key="vduh",
                    hospital_name="Bệnh viện Hữu nghị Việt Đức",
                )

    def test_study_folder_uses_full_uid_hash_not_shared_prefix(self):
        first = dcom_pipeline.study_archive_folder_name(study("1.2.840.113619.2.1.100"))
        second = dcom_pipeline.study_archive_folder_name(study("1.2.840.113619.2.1.200"))
        self.assertNotEqual(first, second)
        self.assertIn("2026-08-02 - MR - MR BRAIN - ", first)

    def test_repeat_download_reuses_patient_and_resumes_existing_study(self):
        calls = []

        def fake_run_pipeline(**kwargs):
            destination = Path(kwargs["out_base"])
            (destination / "DICOM").mkdir(parents=True, exist_ok=True)
            calls.append((destination, kwargs["resume"]))
            return (
                dcom_pipeline.DownloadStats(dicom=1),
                dcom_pipeline.ConvertStats(converted=1),
                destination / "JPG",
            )

        with tempfile.TemporaryDirectory() as tmp, patch(
            "dcom_pipeline.run_pipeline", side_effect=fake_run_pipeline,
        ):
            root = Path(tmp)
            item = study("1.2.840.113619.2.1.100")
            kwargs = dict(
                studies=[item],
                out_base=root,
                patient_id=item["patient_id"],
                patient_name=item["patient_name"],
                hospital_key=item["hospital_key"],
                hospital_name=item["hospital_name"],
                log=lambda _message: None,
            )
            dcom_pipeline.download_studies_list(**kwargs)
            dcom_pipeline.download_studies_list(**kwargs)

            self.assertFalse(calls[0][1])
            self.assertTrue(calls[1][1])
            self.assertEqual(calls[0][0], calls[1][0])
            patient_dirs = [path for path in root.iterdir() if path.is_dir()]
            self.assertEqual(1, len(patient_dirs))

    def test_legacy_classic_folder_is_indexed_and_reused(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            legacy = root / "VDUH_BN_2605032022"
            dicom = legacy / "Ca_1" / "DICOM" / "img_00001.dcm"
            dicom.parent.mkdir(parents=True)
            write_local_dicom(dicom)
            dataset = pydicom.dcmread(str(dicom))
            dataset.PatientID = "2605032022"
            dataset.PatientName = "NGUYEN VAN A"
            dataset.save_as(str(dicom), enforce_file_format=True)
            uid = str(dataset.StudyInstanceUID)
            studies = [study(uid)]

            status = dcom_pipeline.patient_archive_status(
                root,
                patient_id="2605032022",
                patient_name="Nguyễn Văn A",
                hospital_key="vduh",
                hospital_name="Bệnh viện Hữu nghị Việt Đức",
                studies=studies,
            )
            self.assertTrue(status["exists"])
            self.assertEqual(1, status["downloadedStudies"])
            self.assertEqual(1, status["legacyStudiesDetected"])

            folder, manifest, created = dcom_pipeline.ensure_patient_archive(
                root,
                patient_id="2605032022",
                patient_name="Nguyễn Văn A",
                hospital_key="vduh",
                hospital_name="Bệnh viện Hữu nghị Việt Đức",
            )
            self.assertFalse(created)
            self.assertTrue(folder.samefile(legacy))
            self.assertIn(uid, manifest["studies"])

    def test_web_search_reports_existing_patient_and_new_studies(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            items = [study("1.2.3.1"), study("1.2.3.2")]
            folder, _manifest, _created = dcom_pipeline.ensure_patient_archive(
                root,
                patient_id="2605032022",
                patient_name="Nguyễn Văn A",
                hospital_key="vduh",
                hospital_name="Bệnh viện Hữu nghị Việt Đức",
            )
            first_folder = folder / dcom_pipeline.study_archive_folder_name(items[0])
            first_folder.mkdir()
            dcom_pipeline.record_patient_study(
                folder, items[0], first_folder, complete=True, image_count=100,
            )
            controller = WebController()
            controller.output_root = root
            with patch("dcom_pipeline.search_patient_studies", return_value=items):
                controller.start_search({"hospital": "vduh", "patientId": "2605032022"})
                result = self.wait_for_job(controller)

            self.assertEqual("complete", result["status"], result["logs"])
            self.assertTrue(result["result"]["patient"]["exists"])
            self.assertEqual(1, result["result"]["patient"]["downloadedStudies"])
            self.assertEqual(1, result["result"]["patient"]["newStudies"])
            self.assertEqual("downloaded", result["result"]["studies"][0]["local_status"])

    def test_web_download_only_passes_checked_studies_and_keeps_full_status(self):
        captured = []

        def fake_download_studies_list(*, studies, out_base, patient_id, patient_name,
                                       hospital_key, hospital_name, **_kwargs):
            captured.extend(item["study_uid"] for item in studies)
            folder, _manifest, _created = dcom_pipeline.ensure_patient_archive(
                out_base,
                patient_id=patient_id,
                patient_name=patient_name,
                hospital_key=hospital_key,
                hospital_name=hospital_name,
            )
            item = studies[0]
            study_folder = folder / dcom_pipeline.study_archive_folder_name(item)
            dicom = study_folder / "DICOM" / "img_00001.dcm"
            dicom.parent.mkdir(parents=True)
            write_local_dicom(dicom)
            dcom_pipeline.record_patient_study(
                folder, item, study_folder, complete=True, image_count=1,
            )
            return 1

        with tempfile.TemporaryDirectory() as tmp, patch(
            "dcom_pipeline.download_studies_list", side_effect=fake_download_studies_list,
        ):
            root = Path(tmp)
            selected = study("1.2.3.1")
            other = study("1.2.3.2")
            controller = WebController()
            controller.output_root = root
            controller.start_download({
                "studies": [selected],
                "allStudies": [selected, other],
                "patientId": "2605032022",
                "patientName": "Nguyễn Văn A",
                "hospital": "vduh",
                "outputRoot": str(root),
            })
            result = self.wait_for_job(controller)

            self.assertEqual("complete", result["status"], result["logs"])
            self.assertEqual(["1.2.3.1"], captured)
            statuses = {
                item["study_uid"]: item["local_status"]
                for item in result["result"]["studies"]
            }
            self.assertEqual("downloaded", statuses["1.2.3.1"])
            self.assertEqual("new", statuses["1.2.3.2"])

    def test_opening_multi_patient_root_fails_closed(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for patient_id, patient_name in (("1001", "Nguyễn A"), ("1002", "Nguyễn B")):
                dcom_pipeline.ensure_patient_archive(
                    root,
                    patient_id=patient_id,
                    patient_name=patient_name,
                    hospital_key="vduh",
                    hospital_name="Bệnh viện Hữu nghị Việt Đức",
                )
            with self.assertRaisesRegex(ValueError, "nhiều bệnh nhân"):
                ArchiveCatalog().open(root)


if __name__ == "__main__":
    unittest.main()

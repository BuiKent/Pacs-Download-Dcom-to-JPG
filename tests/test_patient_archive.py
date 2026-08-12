from __future__ import annotations

import tempfile
import unittest
import json
import hashlib
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


def write_patient_dicom(
    path: Path,
    *,
    patient_id: str = "BN001",
    patient_name: str = "NGUYEN^VAN^A",
    patient_age: str = "023Y",
    birth_date: str = "20021231",
    study_date: str = "20261230",
    patient_sex: str = "M",
) -> str:
    write_local_dicom(path)
    dataset = pydicom.dcmread(str(path), force=True)
    dataset.PatientID = patient_id
    dataset.PatientName = patient_name
    if patient_age:
        dataset.PatientAge = patient_age
    dataset.PatientBirthDate = birth_date
    dataset.PatientSex = patient_sex
    dataset.StudyDate = study_date
    dataset.StudyDescription = "MR BRAIN"
    dataset.save_as(str(path), enforce_file_format=True)
    return str(dataset.StudyInstanceUID)


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
            self.assertTrue(folder.name.startswith("Nguyễn Văn A - KHONG_RO_TUOI - 2605032022 - "))
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

    def test_study_folder_contains_only_requested_metadata(self):
        first = dcom_pipeline.study_archive_folder_name(study("1.2.840.113619.2.1.100"))
        second = dcom_pipeline.study_archive_folder_name(study("1.2.840.113619.2.1.200"))
        self.assertEqual("2026-08-02 - MR - MR BRAIN", first)
        self.assertEqual(first, second)
        self.assertNotRegex(first, r"[0-9a-f]{8,10}$")

    def test_study_folder_name_stays_readable_until_two_studies_collide(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            first = study("1.2.3.100")
            second = study("1.2.3.200")

            first_name = dcom_pipeline.resolve_study_folder_name(folder, first)
            self.assertEqual("2026-08-02 - MR - MR BRAIN", first_name)

            (folder / first_name).mkdir()
            dcom_pipeline._write_patient_manifest(folder, {
                "format": dcom_pipeline.PATIENT_MANIFEST_FORMAT,
                "studies": {},
            })
            dcom_pipeline.record_patient_study(
                folder, first, folder / first_name, complete=True, image_count=3,
            )

            # Same requested metadata uses a simple numeric collision suffix;
            # UIDs remain in patient-index.json instead of leaking into names.
            second_name = dcom_pipeline.resolve_study_folder_name(folder, second)
            self.assertEqual(f"{first_name} (2)", second_name)
            # The first study keeps the folder it was already written into.
            self.assertEqual(first_name, dcom_pipeline.resolve_study_folder_name(folder, first))

    def test_study_folder_written_by_an_older_build_is_resumed_not_duplicated(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            item = study("1.2.3.100")
            legacy = f"{dcom_pipeline.study_folder_base_name(item)} - deadbeef01"
            (folder / legacy).mkdir()
            dcom_pipeline._write_patient_manifest(folder, {
                "format": dcom_pipeline.PATIENT_MANIFEST_FORMAT,
                "studies": {item["study_uid"]: {"folder": legacy}},
            })
            self.assertEqual(legacy, dcom_pipeline.resolve_study_folder_name(folder, item))

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
        ), patch(
            "dcom_pipeline.resolve_study_viewer_url", return_value="https://viewer.test/s?session=1",
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

    def test_selected_series_download_is_recorded_without_claiming_full_study(self):
        selected_ids = ["1.2.3.series.t1", "1.2.3.series.flair"]

        def fake_run_pipeline(**kwargs):
            self.assertEqual(selected_ids, kwargs["selected_series_ids"])
            destination = Path(kwargs["out_base"])
            (destination / "DICOM").mkdir(parents=True, exist_ok=True)
            return (
                dcom_pipeline.DownloadStats(
                    dicom=2, expected=2, completed_tasks=2,
                ),
                dcom_pipeline.ConvertStats(converted=2),
                destination / "JPG",
            )

        with tempfile.TemporaryDirectory() as tmp, patch(
            "dcom_pipeline.run_pipeline", side_effect=fake_run_pipeline,
        ), patch(
            "dcom_pipeline.resolve_study_viewer_url", return_value="https://viewer.test/selected",
        ):
            root = Path(tmp)
            item = study("1.2.3.selected")
            dcom_pipeline.download_studies_list(
                studies=[item],
                out_base=root,
                patient_id=item["patient_id"],
                patient_name=item["patient_name"],
                hospital_key=item["hospital_key"],
                hospital_name=item["hospital_name"],
                selected_series_by_study={item["study_uid"]: selected_ids},
                log=lambda _message: None,
            )

            _folder, manifest = dcom_pipeline.find_patient_archive(
                root, item["patient_id"], item["hospital_key"],
            )
            entry = manifest["studies"][item["study_uid"]]
            self.assertEqual("selected", entry["status"])
            self.assertEqual(sorted(selected_ids), entry["selectedSeries"])
            status = dcom_pipeline.patient_archive_status(
                root,
                patient_id=item["patient_id"],
                patient_name=item["patient_name"],
                hospital_key=item["hospital_key"],
                hospital_name=item["hospital_name"],
                studies=[item],
            )
            self.assertEqual("selected", item["local_status"])
            self.assertEqual(1, status["selectedStudies"])
            self.assertEqual(0, status["downloadedStudies"])


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

    def test_web_selective_download_passes_series_mapping_to_pipeline(self):
        captured = {}

        def fake_download_studies_list(**kwargs):
            captured.update(kwargs)
            folder, _manifest, _created = dcom_pipeline.ensure_patient_archive(
                kwargs["out_base"],
                patient_id=kwargs["patient_id"],
                patient_name=kwargs["patient_name"],
                hospital_key=kwargs["hospital_key"],
                hospital_name=kwargs["hospital_name"],
            )
            item = kwargs["studies"][0]
            study_folder = folder / dcom_pipeline.study_archive_folder_name(item)
            study_folder.mkdir(parents=True, exist_ok=True)
            dcom_pipeline.record_patient_study(
                folder, item, study_folder, complete=False, image_count=2,
                selected_series_ids=["series-t1"], selection_complete=True,
            )
            return 2

        with tempfile.TemporaryDirectory() as tmp, patch(
            "dcom_pipeline.download_studies_list", side_effect=fake_download_studies_list,
        ):
            root = Path(tmp)
            item = study("1.2.3.selective.web")
            controller = WebController()
            controller.output_root = root
            controller.start_download({
                "studies": [item],
                "allStudies": [item],
                "patientId": item["patient_id"],
                "patientName": item["patient_name"],
                "hospital": item["hospital_key"],
                "outputRoot": str(root),
                "downloadAllFiles": False,
                "seriesSelections": {item["study_uid"]: ["series-t1"]},
            })
            result = self.wait_for_job(controller)

            self.assertEqual("complete", result["status"], result["logs"])
            self.assertEqual(
                {item["study_uid"]: ["series-t1"]},
                captured["selected_series_by_study"],
            )

    def test_web_selective_download_requires_mapping_for_each_selected_date(self):
        first = study("1.2.3.multi.first", date="2026-07-01")
        second = study("1.2.3.multi.second", date="2026-08-01")
        controller = WebController()

        with self.assertRaisesRegex(ValueError, second["study_uid"]):
            controller.start_download({
                "studies": [first, second],
                "allStudies": [first, second],
                "patientId": first["patient_id"],
                "patientName": first["patient_name"],
                "hospital": first["hospital_key"],
                "downloadAllFiles": False,
                "seriesSelections": {first["study_uid"]: ["first-t1"]},
            })

    def test_web_series_discovery_returns_groups_without_downloading(self):
        controller = WebController()
        item = study("1.2.3.discovery")
        inventory = {
            "source": "dicomweb",
            "selectable": True,
            "series": [{"id": "series-t2", "description": "AX T2"}],
        }
        with patch(
            "dcom_pipeline._viewer_url_for_study", return_value="https://viewer.test/fresh",
        ), patch(
            "dcom_pipeline.discover_viewer_series", return_value=inventory,
        ) as discover:
            controller.start_series_discovery({
                "studies": [item],
                "hospital": item["hospital_key"],
            })
            result = self.wait_for_job(controller)

        self.assertEqual("complete", result["status"], result["logs"])
        self.assertEqual(item["study_uid"], result["result"]["groups"][0]["studyUid"])
        discover.assert_called_once()

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


class PatientDemographicsTests(unittest.TestCase):
    def test_redacted_link_identity_uses_explicit_unknown_fields(self):
        with tempfile.TemporaryDirectory() as tmp:
            dicom_dir = Path(tmp)
            write_patient_dicom(
                dicom_dir / "one.dcm",
                patient_id="***",
                patient_name="***",
                patient_age="055Y",
                birth_date="***",
                patient_sex="M",
                study_date="20241025",
            )

            metadata = dcom_pipeline.extract_patient_metadata(dicom_dir)
            folder = dcom_pipeline.patient_download_folder_name(metadata, "2026-08-09")

            self.assertEqual("KHONG_RO_ID", metadata["PatientID"])
            self.assertEqual("KHONG_RO_TEN", metadata["PatientName"])
            self.assertEqual("", metadata["PatientBirthDate"])
            self.assertEqual("55T", metadata["PatientAge"])
            self.assertEqual(
                "KHONG_RO_TEN - 55T - KHONG_RO_ID - 2026-08-09",
                folder,
            )

    def test_dicom_name_age_suffix_is_not_duplicated_in_patient_folder(self):
        with tempfile.TemporaryDirectory() as tmp:
            dicom_dir = Path(tmp)
            write_patient_dicom(
                dicom_dir / "one.dcm",
                patient_id="2606033997",
                patient_name="NGUYEN THI CAM TU^23T",
                patient_age="023Y",
                birth_date="20030101",
                patient_sex="F",
                study_date="20260616",
            )

            metadata = dcom_pipeline.extract_patient_metadata(dicom_dir)
            folder = dcom_pipeline.patient_download_folder_name(metadata, "2026-08-09")

            self.assertEqual("NGUYEN THI CAM TU", metadata["PatientName"])
            self.assertEqual(
                "NGUYEN THI CAM TU - 23T - 2606033997 - 2026-08-09",
                folder,
            )

            patient_root, _manifest, _created = dcom_pipeline.ensure_patient_archive(
                dicom_dir / "archive",
                patient_id="2606033997",
                patient_name="",
                hospital_key="dhy",
                hospital_name="Hospital",
            )
            dcom_pipeline.write_direct_patient_manifest(
                patient_root,
                patient_root / "JPG",
                metadata,
                image_count=1,
                complete=True,
            )
            manifest = json.loads(
                (patient_root / dcom_pipeline.PATIENT_MANIFEST_NAME).read_text(encoding="utf-8")
            )
            self.assertEqual("NGUYEN THI CAM TU", manifest["patientName"])

    def test_dicom_name_age_suffix_does_not_create_a_false_identity_conflict(self):
        metadata = {
            "PatientID": "2606033997",
            "PatientName": "NGUYEN THI CAM TU",
        }
        dcom_pipeline._assert_patient_metadata_matches(
            "2606033997",
            "NGUYEN THI CAM TU^23T",
            metadata,
        )

    def test_dicom_birth_date_discrepancy_does_not_create_false_identity_conflict(self):
        # RIS record may store estimated DOB '2003-01-01' from age 23T while DICOM has exact '2003-04-02'
        metadata = {
            "PatientID": "2606033997",
            "PatientName": "NGUYEN THI CAM TU",
            "PatientBirthDate": "20030402",
        }
        # Must not raise PatientIdentityConflictError
        dcom_pipeline._assert_patient_metadata_matches(
            "2606033997",
            "NGUYEN THI CAM TU",
            metadata,
            expected_birth_date="2003-01-01",
        )


    def test_windows_folder_rename_retries_a_temporary_access_denied(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "LINK_20260809_case"
            jpg = root / "JPG"
            jpg.mkdir(parents=True)
            metadata = {
                "PatientID": "BN001",
                "PatientName": "NGUYEN VAN A",
                "PatientAge": "23T",
            }
            real_rename = Path.rename
            attempts = 0

            def flaky_rename(path, target):
                nonlocal attempts
                attempts += 1
                if attempts < 3:
                    error = PermissionError(13, "Access is denied")
                    error.winerror = 5
                    raise error
                return real_rename(path, target)

            with patch.object(Path, "rename", new=flaky_rename), patch(
                "dcom_pipeline.time.sleep",
            ):
                renamed, remapped_jpg = dcom_pipeline.rename_patient_download_root(
                    root,
                    jpg,
                    metadata,
                    download_date="2026-08-09",
                    log=lambda _message: None,
                )

            self.assertEqual(3, attempts)
            self.assertEqual(
                "NGUYEN VAN A - 23T - BN001 - 2026-08-09",
                renamed.name,
            )
            self.assertEqual(renamed / "JPG", remapped_jpg)

    def test_dicom_metadata_preserves_birth_sex_and_exact_age_at_study(self):
        with tempfile.TemporaryDirectory() as tmp:
            dicom_dir = Path(tmp)
            write_patient_dicom(
                dicom_dir / "one.dcm",
                patient_age="099Y",
                birth_date="20001231",
                study_date="20261230",
                patient_sex="F",
            )

            metadata = dcom_pipeline.extract_patient_metadata(dicom_dir)

            self.assertEqual("BN001", metadata["PatientID"])
            self.assertEqual("NGUYEN VAN A", metadata["PatientName"])
            self.assertEqual("2000-12-31", metadata["PatientBirthDate"])
            self.assertEqual("F", metadata["PatientSex"])
            self.assertEqual("25T", metadata["PatientAge"])
            self.assertEqual(25, metadata["PatientAgeYears"])
            self.assertEqual("DICOM.PatientBirthDate+StudyDate", metadata["PatientAgeSource"])

    def test_manifest_keeps_demographics_and_age_at_each_study(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            folder, _manifest, _created = dcom_pipeline.ensure_patient_archive(
                root,
                patient_id="BN001",
                patient_name="NGUYEN VAN A",
                hospital_key="vduh",
                hospital_name="Hospital",
            )
            item = {
                **study("1.2.3.demo"),
                "patient_id": "BN001",
                "patient_name": "NGUYEN VAN A",
            }
            study_folder = folder / dcom_pipeline.study_folder_base_name(item)
            dicom_dir = study_folder / "DICOM"
            dicom_dir.mkdir(parents=True)
            write_patient_dicom(dicom_dir / "one.dcm")
            metadata = dcom_pipeline.extract_patient_metadata(dicom_dir)

            dcom_pipeline.record_patient_study(
                folder,
                item,
                study_folder,
                complete=True,
                image_count=1,
                patient_metadata=metadata,
            )

            manifest = json.loads((folder / dcom_pipeline.PATIENT_MANIFEST_NAME).read_text(encoding="utf-8"))
            entry = manifest["studies"][item["study_uid"]]
            self.assertEqual("2002-12-31", manifest["patientBirthDate"])
            self.assertEqual("M", manifest["patientSex"])
            self.assertEqual("023Y", entry["patientAgeRaw"])
            self.assertEqual("23T", entry["patientAgeAtStudy"])
            self.assertEqual(23, entry["patientAgeAtStudyYears"])
            self.assertNotIn("ageAtDiagnosisYears", manifest)
            status = dcom_pipeline.patient_archive_status(
                root,
                patient_id="BN001",
                patient_name="NGUYEN VAN A",
                hospital_key="vduh",
                hospital_name="Hospital",
                studies=[item],
            )
            self.assertEqual("2002-12-31", status["patientBirthDate"])
            self.assertEqual("M", status["patientSex"])
            self.assertIsInstance(status["currentAgeYears"], int)

    def test_run_pipeline_renames_direct_root_and_writes_patient_index(self):
        with tempfile.TemporaryDirectory() as tmp:
            original = Path(tmp) / "LINK_case"

            def fake_download(_url, dicom_dir, **_kwargs):
                sample = Path(tmp) / "sample.dcm"
                write_patient_dicom(sample)
                data = sample.read_bytes()
                sample.unlink()
                resolved_dicom_dir = Path(_kwargs["dicom_output_resolver"](data))
                resolved_dicom_dir.mkdir(parents=True)
                (resolved_dicom_dir / "one.dcm").write_bytes(data)
                return dcom_pipeline.DownloadStats(dicom=1, expected=1, completed_tasks=1)

            def fake_convert(_dicom_dir, jpg_dir, **_kwargs):
                jpg_dir.mkdir(parents=True)
                return dcom_pipeline.ConvertStats(converted=1)

            with patch("dcom_pipeline.download_all", side_effect=fake_download), patch(
                "dcom_pipeline.convert_all", side_effect=fake_convert,
            ), patch("dcom_pipeline.summarize_dicom"):
                _dl, _cv, jpg_dir = dcom_pipeline.run_pipeline(
                    "https://viewer.test/direct", original, log=lambda _message: None,
                )

            renamed = Path(jpg_dir).parent
            self.assertFalse(original.exists())
            self.assertIn("NGUYEN VAN A - 23T - BN001 - ", renamed.name)
            manifest = json.loads(
                (renamed / dcom_pipeline.PATIENT_MANIFEST_NAME).read_text(encoding="utf-8")
            )
            self.assertEqual("2002-12-31", manifest["patientBirthDate"])
            self.assertEqual("M", manifest["patientSex"])

    def test_resuming_named_direct_root_keeps_original_download_date(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "NGUYEN VAN A - 23T - BN001 - 2026-01-02"
            dicom_dir = root / "DICOM"
            dicom_dir.mkdir(parents=True)
            write_patient_dicom(dicom_dir / "one.dcm")

            def fake_convert(_dicom_dir, jpg_dir, **_kwargs):
                jpg_dir.mkdir(parents=True, exist_ok=True)
                return dcom_pipeline.ConvertStats(converted=1)

            with patch(
                "dcom_pipeline.download_all",
                return_value=dcom_pipeline.DownloadStats(
                    dicom=1, expected=1, completed_tasks=1,
                ),
            ), patch("dcom_pipeline.convert_all", side_effect=fake_convert), patch(
                "dcom_pipeline.summarize_dicom",
            ):
                _dl, _cv, jpg_dir = dcom_pipeline.run_pipeline(
                    "https://viewer.test/direct",
                    root,
                    resume=True,
                    log=lambda _message: None,
                )

            self.assertEqual(root, Path(jpg_dir).parent)
            self.assertTrue(root.exists())

    def test_ris_download_renames_patient_root_after_dicom_arrives(self):
        item = {
            "study_uid": "1.2.3.ris",
            "patient_id": "BN001",
            "patient_name": "NGUYEN VAN A",
            "hospital_key": "vduh",
            "hospital_name": "Hospital",
            "date": "2026-12-30",
            "modality": "MR",
            "desc": "MR BRAIN",
        }

        def fake_run_pipeline(**kwargs):
            self.assertEqual("JPG", kwargs["jpg_folder_name_override"])
            dicom_dir = Path(kwargs["out_base"]) / "DICOM"
            dicom_dir.mkdir(parents=True)
            write_patient_dicom(dicom_dir / "one.dcm")
            metadata = dcom_pipeline.extract_patient_metadata(dicom_dir)
            self.assertIs(kwargs["after_first_dicom"], kwargs["after_dicom_download"])
            remapped_out = kwargs["after_first_dicom"](Path(kwargs["out_base"]), metadata)
            self.assertIn("NGUYEN VAN A - 23T - BN001 - ", remapped_out.parent.name)
            jpg_dir = remapped_out / "JPG"
            jpg_dir.mkdir()
            return (
                dcom_pipeline.DownloadStats(dicom=1, expected=1, completed_tasks=1),
                dcom_pipeline.ConvertStats(converted=1),
                jpg_dir,
            )

        with tempfile.TemporaryDirectory() as tmp, patch(
            "dcom_pipeline.resolve_study_viewer_url", return_value="https://viewer.test/ris",
        ), patch("dcom_pipeline.run_pipeline", side_effect=fake_run_pipeline):
            root = Path(tmp)
            dcom_pipeline.download_studies_list(
                studies=[item],
                out_base=root,
                patient_id="BN001",
                patient_name="NGUYEN VAN A",
                hospital_key="vduh",
                hospital_name="Hospital",
                log=lambda _message: None,
            )

            patient_dirs = [path for path in root.iterdir() if path.is_dir()]
            self.assertEqual(1, len(patient_dirs))
            self.assertIn("NGUYEN VAN A - 23T - BN001 - ", patient_dirs[0].name)
            manifest = json.loads(
                (patient_dirs[0] / dcom_pipeline.PATIENT_MANIFEST_NAME).read_text(encoding="utf-8")
            )
            self.assertEqual("M", manifest["patientSex"])
            self.assertEqual("23T", manifest["studies"][item["study_uid"]]["patientAgeAtStudy"])

    def test_long_patient_name_never_truncates_id_or_download_date(self):
        name = dcom_pipeline.patient_download_folder_name(
            {
                "PatientName": "A" * 100,
                "PatientAge": "20T",
                "PatientBirthDate": "2000-12-31",
                "PatientID": "BN001",
            },
            "2026-08-09",
        )
        self.assertIn(" - 25T - ", name)
        self.assertIn("BN001", name)
        self.assertTrue(name.endswith("2026-08-09"))

    def test_patient_manifest_rejects_conflicting_birth_date(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            folder, _manifest, _created = dcom_pipeline.ensure_patient_archive(
                root,
                patient_id="BN001",
                patient_name="NGUYEN VAN A",
                hospital_key="vduh",
                hospital_name="Hospital",
                patient_birth_date="2000-12-31",
                patient_sex="F",
            )
            metadata = {
                "PatientID": "BN001",
                "PatientName": "NGUYEN VAN A",
                "PatientBirthDate": "2001-12-31",
                "PatientSex": "F",
            }

            with self.assertRaisesRegex(ValueError, "Ngày sinh DICOM"):
                dcom_pipeline.write_direct_patient_manifest(
                    folder,
                    folder / "JPG",
                    metadata,
                    image_count=1,
                    complete=True,
                )

    def test_extensionless_dicom_still_names_the_study_folder(self):
        with tempfile.TemporaryDirectory() as tmp:
            dicom_dir = Path(tmp)
            with_suffix = dicom_dir / "one.dcm"
            write_patient_dicom(with_suffix)
            extensionless = dicom_dir / "one"
            with_suffix.rename(extensionless)

            self.assertEqual(
                "2026-12-30 - MR - MR BRAIN",
                dcom_pipeline._jpg_folder_name(dicom_dir),
            )


class SeriesSelectionTests(unittest.TestCase):
    @staticmethod
    def _tag(value):
        return {"Value": [value]}

    def test_vrad_inventory_keeps_exact_uid_description_and_hint(self):
        body = json.dumps({
            "data": [{
                "SeriesList": [
                    {
                        "SeriesInsUID": "1.2.3.4",
                        "SeriesNumber": 5,
                        "SeriesDescription": "3D AX T1 BRAVO+C",
                        "Modality": "MR",
                        "ImageCount": 176,
                    },
                    {
                        "SeriesInsUID": "1.2.3.5",
                        "SeriesNumber": 6,
                        "SeriesDescription": "AX T2 FLAIR",
                        "Modality": "MR",
                        "ImageCount": 28,
                    },
                ],
            }],
        }).encode()

        choices = dcom_pipeline._vrad_series_choices(body)

        self.assertEqual(["1.2.3.4", "1.2.3.5"], [item["id"] for item in choices])
        self.assertEqual("T1 sau tiêm", choices[0]["sequenceHint"])
        self.assertEqual("T2 FLAIR", choices[1]["sequenceHint"])
        self.assertEqual(176, choices[0]["imageCount"])

    def test_dicomweb_inventory_excludes_non_image_series(self):
        tag = self._tag

        body = json.dumps([
            {
                "0020000E": tag("1.2.3.mr"),
                "00200011": tag(3),
                "0008103E": tag("AX T2"),
                "00080060": tag("MR"),
                "00201209": tag(24),
            },
            {
                "0020000E": tag("1.2.3.sr"),
                "0008103E": tag("Dose report"),
                "00080060": tag("SR"),
            },
        ]).encode()

        choices = dcom_pipeline._dicomweb_series_choices(body)

        self.assertEqual(1, len(choices))
        self.assertEqual("1.2.3.mr", choices[0]["id"])
        self.assertEqual("T2", choices[0]["sequenceHint"])

    def test_dicomweb_plan_never_hides_a_split_series_with_no_instances(self):
        tag = self._tag
        series = [
            {
                "0020000E": tag("plain"), "00200011": tag(2),
                "0008103E": tag("PLAIN"), "00080060": tag("CT"),
                "00201209": tag(115),
            },
            {
                "0020000E": tag("bone"), "00200011": tag(3),
                "0008103E": tag("BONE"), "00080060": tag("CT"),
                "00201209": tag(229),
            },
            {
                "0020000E": tag("scout"), "00200011": tag(1),
                "0008103E": tag("SCOUT"), "00080060": tag("CT"),
                "00201209": tag(1),
            },
        ]
        instances = {
            "plain": [],
            "bone": [],
            "scout": [{"00080018": tag("scout.1"), "0020000E": tag("scout")}],
        }

        tasks, count, _skipped, missing = dcom_pipeline._dicomweb_instance_plan(
            series, instances,
        )

        self.assertEqual(3, count)
        self.assertEqual(1, len(tasks))
        self.assertEqual(2, len(missing))
        self.assertTrue(any("PLAIN" in item and "0/115" in item for item in missing))
        self.assertTrue(any("BONE" in item and "0/229" in item for item in missing))

    def test_dicomweb_plan_recovers_instances_from_study_wide_listing(self):
        tag = self._tag
        series = [
            {
                "0020000E": tag("plain"), "00200011": tag(2),
                "0008103E": tag("PLAIN"), "00080060": tag("CT"),
                "00201209": tag(2),
            },
            {
                "0020000E": tag("bone"), "00200011": tag(3),
                "0008103E": tag("BONE"), "00080060": tag("CT"),
                "00201209": tag(3),
            },
        ]
        grouped = {
            "plain": [
                {"00080018": tag("plain.1")},
                {"00080018": tag("plain.2")},
            ],
            "bone": [
                {"00080018": tag("bone.1")},
                {"00080018": tag("bone.2")},
                {"00080018": tag("bone.3")},
            ],
        }

        tasks, count, _skipped, missing = dcom_pipeline._dicomweb_instance_plan(
            series, grouped,
        )

        self.assertEqual(2, count)
        self.assertEqual(5, len(tasks))
        self.assertEqual([], missing)

    def test_dicomweb_downloader_uses_study_wide_fallback_for_split_series(self):
        tag = self._tag
        series = [
            {
                "0020000E": tag("plain"), "00200011": tag(2),
                "0008103E": tag("PLAIN"), "00080060": tag("CT"),
                "00201209": tag(2),
            },
            {
                "0020000E": tag("bone"), "00200011": tag(3),
                "0008103E": tag("BONE"), "00080060": tag("CT"),
                "00201209": tag(3),
            },
            {
                "0020000E": tag("scout"), "00200011": tag(1),
                "0008103E": tag("SCOUT"), "00080060": tag("CT"),
                "00201209": tag(1),
            },
        ]
        study_instances = [
            {"0020000E": tag(series_uid), "00080018": tag(f"{series_uid}.{index}")}
            for series_uid, count in (("plain", 2), ("bone", 3), ("scout", 1))
            for index in range(1, count + 1)
        ]
        requested: list[str] = []

        class Response:
            headers = {"Content-Type": "application/dicom+json"}

            def __init__(self, payload):
                self.payload = json.dumps(payload).encode()

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def read(self):
                return self.payload

        def fake_urlopen(request, **_kwargs):
            url = request.full_url
            requested.append(url)
            if url.endswith("/studies/STUDY/series"):
                return Response(series)
            if "/series/scout/instances" in url:
                return Response([study_instances[-1]])
            if "/series/" in url:
                return Response([])
            if "/studies/STUDY/instances" in url:
                return Response(study_instances)
            return Response([])

        planned: list[tuple] = []
        captured = {
            "qido_series": "https://pacs.test/rs/studies/STUDY/series",
            "api_headers": {}, "cookies": [], "wado_tmpl": None,
        }
        with patch("urllib.request.urlopen", side_effect=fake_urlopen), patch(
            "dcom_pipeline._run_fetch_tasks",
            side_effect=lambda tasks, *_args: planned.extend(tasks),
        ), patch("dcom_pipeline._report_download_result"):
            dcom_pipeline._download_via_dicomweb(
                captured,
                lambda _body: True,
                dcom_pipeline.DownloadStats(),
                lambda _message: None,
                lambda: False,
            )

        self.assertEqual(6, len(planned))
        self.assertTrue(any("/studies/STUDY/instances" in url for url in requested))

    def test_dicomweb_downloader_fails_closed_when_split_series_stay_empty(self):
        tag = self._tag
        series = [{
            "0020000E": tag("plain"), "00200011": tag(2),
            "0008103E": tag("PLAIN"), "00080060": tag("CT"),
            "00201209": tag(115),
        }]

        class Response:
            headers = {"Content-Type": "application/dicom+json"}

            def __init__(self, payload):
                self.payload = json.dumps(payload).encode()

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def read(self):
                return self.payload

        def fake_urlopen(request, **_kwargs):
            return Response(series if request.full_url.endswith("/studies/STUDY/series") else [])

        captured = {
            "qido_series": "https://pacs.test/rs/studies/STUDY/series",
            "api_headers": {}, "cookies": [], "wado_tmpl": None,
        }
        with patch("urllib.request.urlopen", side_effect=fake_urlopen):
            with self.assertRaisesRegex(RuntimeError, "PLAIN.*0/115"):
                dcom_pipeline._download_via_dicomweb(
                    captured,
                    lambda _body: True,
                    dcom_pipeline.DownloadStats(),
                    lambda _message: None,
                    lambda: False,
                )

    def test_dicom_storage_name_is_readable_stable_and_series_scoped(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "source.dcm"
            write_local_dicom(path)
            dataset = pydicom.dcmread(str(path))
            dataset.SeriesNumber = 7
            dataset.SeriesDescription = "AX T2 FLAIR"
            dataset.InstanceNumber = 12
            dataset.save_as(str(path), enforce_file_format=True)
            data = path.read_bytes()
            digest = hashlib.sha1(data).hexdigest()

            folder, filename = dcom_pipeline._dicom_storage_info(data, digest)

            self.assertEqual("Series_7_AX T2 FLAIR", folder)
            self.assertRegex(filename, r"^IM_00012_[0-9a-f]{10}_[0-9a-f]{6}\.dcm$")
            self.assertEqual((folder, filename), dcom_pipeline._dicom_storage_info(data, digest))

    def test_vrad_downloader_fetches_only_selected_series_uid(self):
        body = json.dumps({
            "data": [{
                "SeriesList": [
                    {
                        "SeriesInsUID": "uid-t1",
                        "ImageCount": 1,
                        "ImageList": [{"WebUrl": "?imageObjKey=t1", "SOPInstanceUID": "sop-t1"}],
                    },
                    {
                        "SeriesInsUID": "uid-t2",
                        "ImageCount": 1,
                        "ImageList": [{"WebUrl": "?imageObjKey=t2", "SOPInstanceUID": "sop-t2"}],
                    },
                ],
            }],
        }).encode()
        requested = []

        class Response:
            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def read(self):
                return b"dicom"

        def fake_urlopen(url, **_kwargs):
            requested.append(url)
            return Response()

        stats = dcom_pipeline.DownloadStats()
        captured = {
            "getstudies": body,
            "template_url": "https://viewer.test/GetImage?token=x",
        }
        with patch("urllib.request.urlopen", side_effect=fake_urlopen):
            dcom_pipeline._download_via_manifest(
                captured,
                lambda _body: True,
                stats,
                lambda _message: None,
                lambda: False,
                {"uid-t2"},
            )

        self.assertEqual(1, len(requested))
        self.assertIn("seriesuid=uid-t2", requested[0])
        self.assertNotIn("uid-t1", requested[0])
        self.assertTrue(stats.is_complete())


class ViewerLinkFreshnessTests(unittest.TestCase):
    """Ba lỗi làm mất ảnh khi tải theo mã BN — mỗi lỗi một test."""

    @staticmethod
    def _kwargs(root: Path, items: list[dict], logs: list[str]) -> dict:
        first = items[0]
        return dict(
            studies=items,
            out_base=root,
            patient_id=first["patient_id"],
            patient_name=first["patient_name"],
            hospital_key=first["hospital_key"],
            hospital_name=first["hospital_name"],
            log=logs.append,
        )

    def test_search_does_not_hand_out_perishable_links(self):
        """Tìm kiếm không được cấp sẵn link viewer — link phải xin lúc tải."""
        source = Path("dcom_pipeline.py").read_text(encoding="utf-8")
        block = source.split("def search_patient_studies(")[1].split("\ndef ")[0]
        self.assertNotIn("iframes[0]", block)
        self.assertNotIn("vrViewer?studyUID=", block)

    def test_link_is_minted_per_study_at_download_time(self):
        minted = []

        def fake_resolve(hospital_key, study_uid, **_kwargs):
            minted.append(study_uid)
            return f"https://viewer.test/v?session=fresh-{len(minted)}"

        used = []

        def fake_run_pipeline(**kwargs):
            used.append(kwargs["url"])
            Path(kwargs["out_base"], "DICOM").mkdir(parents=True, exist_ok=True)
            return (
                dcom_pipeline.DownloadStats(dicom=5, expected=5),
                dcom_pipeline.ConvertStats(converted=5),
                Path(kwargs["out_base"], "JPG"),
            )

        with tempfile.TemporaryDirectory() as tmp, patch(
            "dcom_pipeline.resolve_study_viewer_url", side_effect=fake_resolve,
        ), patch("dcom_pipeline.run_pipeline", side_effect=fake_run_pipeline):
            logs: list[str] = []
            items = [study("1.2.3.10"), study("1.2.3.11")]
            dcom_pipeline.download_studies_list(**self._kwargs(Path(tmp), items, logs))

            self.assertEqual(["1.2.3.10", "1.2.3.11"], minted)
            self.assertEqual(
                ["https://viewer.test/v?session=fresh-1", "https://viewer.test/v?session=fresh-2"],
                used,
            )
            self.assertTrue(
                any("không tìm lại mã bệnh nhân" in line for line in logs), logs
            )
            self.assertFalse(
                any("Đang xin link viewer MỚI" in line for line in logs), logs
            )

    def test_study_is_skipped_when_no_viewer_link_can_be_minted(self):
        """Không xin được link thì KHÔNG được tải bằng link wrapper vô dụng."""
        with tempfile.TemporaryDirectory() as tmp, patch(
            "dcom_pipeline.resolve_study_viewer_url",
            side_effect=RuntimeError("RIS không trả về khung viewer"),
        ), patch("dcom_pipeline.run_pipeline") as run_pipeline:
            logs: list[str] = []
            root = Path(tmp)
            items = [study("1.2.3.20")]
            dcom_pipeline.download_studies_list(**self._kwargs(root, items, logs))

            run_pipeline.assert_not_called()
            folder, manifest = dcom_pipeline.find_patient_archive(root, "2605032022", "vduh")
            self.assertIsNotNone(folder)
            self.assertEqual("incomplete", manifest["studies"]["1.2.3.20"]["status"])
            self.assertTrue(any("BỎ QUA CA 1" in line for line in logs), logs)

    def test_partial_download_is_never_reported_as_complete(self):
        """Tải 4/348 ảnh phải là CHƯA ĐỦ, không phải 'đã tải xong'."""

        def fake_run_pipeline(**kwargs):
            Path(kwargs["out_base"], "DICOM").mkdir(parents=True, exist_ok=True)
            return (
                dcom_pipeline.DownloadStats(dicom=4, expected=348, failed=344),
                dcom_pipeline.ConvertStats(converted=4),
                Path(kwargs["out_base"], "JPG"),
            )

        with tempfile.TemporaryDirectory() as tmp, patch(
            "dcom_pipeline.resolve_study_viewer_url", return_value="https://viewer.test/v?session=x",
        ), patch("dcom_pipeline.run_pipeline", side_effect=fake_run_pipeline):
            logs: list[str] = []
            root = Path(tmp)
            items = [study("1.2.3.30")]
            dcom_pipeline.download_studies_list(**self._kwargs(root, items, logs))

            folder, manifest = dcom_pipeline.find_patient_archive(root, "2605032022", "vduh")
            self.assertEqual("incomplete", manifest["studies"]["1.2.3.30"]["status"])
            self.assertFalse(any("ĐÃ TẢI XONG" in line for line in logs), logs)
            self.assertTrue(any("CHƯA ĐỦ ẢNH (4/348)" in line for line in logs), logs)

    def test_wrapper_url_is_rejected_instead_of_downloaded(self):
        item = study("1.2.3.40")
        item["hospital_key"] = ""  # không đủ thông tin để xin link mới
        item["direct_url"] = "https://rad.vduh.org/ris/vrViewer?studyUID=1.2.3.40&viewType=VIEWERV2"
        with self.assertRaises(RuntimeError) as ctx:
            dcom_pipeline._viewer_url_for_study(item, "", lambda _m: None, True)
        self.assertIn("wrapper", str(ctx.exception).lower())

    def test_ris_shell_pages_are_not_mistaken_for_the_viewer(self):
        """Sau khi đăng nhập lại, page.url hay đứng ở trang RIS — không phải khung ảnh."""
        for bad in (
            "https://dhy.cdhaviet.vn/ris/account/login",
            "https://dhy.cdhaviet.vn/ris/study/reading",
            "https://dhy.cdhaviet.vn/ris/vrViewer?studyUID=1&viewType=VIEWERV2",
            "about:blank",
            "",
        ):
            self.assertFalse(dcom_pipeline._looks_like_viewer_url(bad), bad)
        for good in (
            "https://dhyv2.cdhavn.com/viewer?session=54be8d3a&mobile_support=1",
            "https://rad.vduh.org/viewer/index.html?share=abc",
        ):
            self.assertTrue(dcom_pipeline._looks_like_viewer_url(good), good)

    def test_network_outage_is_not_reported_as_a_patient_id_problem(self):
        outage = dcom_pipeline._server_unreachable_message(
            Exception("Page.goto: net::ERR_CONNECTION_TIMED_OUT at https://dhy.cdhaviet.vn/ris/account/login"),
            "BV Đại học Y Hà Nội",
            "https://dhy.cdhaviet.vn",
        )
        self.assertIsNotNone(outage)
        self.assertIn("KHÔNG KẾT NỐI ĐƯỢC", outage)
        self.assertIn("KHÔNG phải lỗi mã bệnh nhân", outage)
        # Lỗi khác thì để nguyên, không được nuốt thành "lỗi mạng".
        self.assertIsNone(
            dcom_pipeline._server_unreachable_message(
                ValueError("RIS không xác nhận đăng nhập thành công."), "X", "https://x",
            )
        )

    def test_non_image_objects_do_not_count_as_missing_images(self):
        """Dose SR không có điểm ảnh — tính nó vào tổng sẽ gắn 'thiếu ảnh' vĩnh viễn."""
        for modality in ("SR", "sr", " PR ", "KO", "SEG", "RTSTRUCT"):
            self.assertTrue(dcom_pipeline._is_non_image_modality(modality), modality)
        for modality in ("CT", "MR", "CR", "US", "XA", "NM", "PT", "", None):
            self.assertFalse(dcom_pipeline._is_non_image_modality(modality), modality)

    def test_stats_completeness_rules(self):
        self.assertFalse(dcom_pipeline.DownloadStats(dicom=4, expected=348).is_complete())
        self.assertTrue(dcom_pipeline.DownloadStats(dicom=348, expected=348).is_complete())
        # Không biết manifest thì chỉ kết luận "có ảnh".
        self.assertTrue(dcom_pipeline.DownloadStats(dicom=1).is_complete())
        self.assertFalse(dcom_pipeline.DownloadStats().is_complete())


if __name__ == "__main__":
    unittest.main()

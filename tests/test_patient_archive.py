from __future__ import annotations

import inspect
import urllib.request
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

    def test_extract_patient_metadata_allow_mixed_does_not_raise(self):
        with tempfile.TemporaryDirectory() as tmp:
            dicom_dir = Path(tmp)
            write_patient_dicom(
                dicom_dir / "one.dcm",
                patient_id="PID_001",
                patient_name="PATIENT ONE",
                patient_age="050Y",
                birth_date="19740101",
                patient_sex="M",
                study_date="20260814",
            )
            write_patient_dicom(
                dicom_dir / "two.dcm",
                patient_id="PID_002",
                patient_name="PATIENT TWO",
                patient_age="030Y",
                birth_date="19940101",
                patient_sex="F",
                study_date="20260814",
            )

            # allow_mixed=False raises PatientIdentityConflictError
            with self.assertRaises(dcom_pipeline.PatientIdentityConflictError):
                dcom_pipeline.extract_patient_metadata(dicom_dir, allow_mixed=False)

            # allow_mixed=True safely extracts available demographics without raising
            metadata = dcom_pipeline.extract_patient_metadata(dicom_dir, allow_mixed=True)
            self.assertTrue(metadata["PatientID"] in {"PID_001", "PID_002"})

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

    def test_birth_year_mismatch_is_still_an_identity_conflict(self):
        """Nới lỏng cho ngày sinh ước lượng KHÔNG được nới sang cả năm sinh."""
        metadata = {
            "PatientID": "2606033997",
            "PatientName": "NGUYEN THI CAM TU",
            "PatientBirthDate": "19850703",
        }
        with self.assertRaises(dcom_pipeline.PatientIdentityConflictError):
            dcom_pipeline._assert_patient_metadata_matches(
                "2606033997",
                "NGUYEN THI CAM TU",
                metadata,
                expected_birth_date="2003-01-01",
            )

    def test_two_exact_birth_dates_in_one_year_are_still_a_conflict(self):
        """Cùng năm nhưng cả hai đều là ngày chính xác thì vẫn là hai người."""
        metadata = {
            "PatientID": "2606033997",
            "PatientName": "NGUYEN THI CAM TU",
            "PatientBirthDate": "20031122",
        }
        with self.assertRaises(dcom_pipeline.PatientIdentityConflictError):
            dcom_pipeline._assert_patient_metadata_matches(
                "2606033997",
                "NGUYEN THI CAM TU",
                metadata,
                expected_birth_date="2003-04-02",
            )

    def test_manifest_upgrades_placeholder_birth_date_within_the_same_year(self):
        manifest = {"patientBirthDate": "2003-01-01"}
        dcom_pipeline._merge_manifest_demographics(
            manifest, {"PatientBirthDate": "2003-04-02"},
        )
        self.assertEqual(manifest["patientBirthDate"], "2003-04-02")

    def test_manifest_never_rewrites_the_birth_year(self):
        for current, incoming in (
            ("2003-01-01", "1985-07-03"),   # placeholder vs năm khác
            ("2003-01-01", "1985-01-01"),   # hai placeholder khác năm
            ("2003-04-02", "2003-11-22"),   # ngày chính xác đã có sẵn
        ):
            with self.subTest(current=current, incoming=incoming):
                manifest = {"patientBirthDate": current}
                dcom_pipeline._merge_manifest_demographics(
                    manifest, {"PatientBirthDate": incoming},
                )
                self.assertEqual(manifest["patientBirthDate"], current)

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


class FakeOpener:
    """Đứng thay opener có ghi sổ socket của pipeline.

    Pipeline không gọi thẳng `urllib.request.urlopen` nữa: nó mở qua một opener
    riêng để socket được ghi sổ ngay từ lúc kết nối, nhờ đó bấm Cancel là cắt
    được cả những worker còn đang kẹt trong `urlopen()`.
    """

    def __init__(self, handler):
        self._handler = handler

    def open(self, request, timeout=None):
        return self._handler(request)


def patch_pacs_network(handler):
    return patch.object(
        dcom_pipeline.ActiveSocketTracker, "opener",
        lambda _self, _context=None, passport=None: FakeOpener(handler))


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
        with patch_pacs_network(fake_urlopen), patch(
            "dcom_pipeline._run_fetch_tasks",
            side_effect=lambda tasks, *_args, **_kwargs: planned.extend(tasks),
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
        with patch_pacs_network(fake_urlopen):
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

        def fake_urlopen(request, **_kwargs):
            # Đường manifest giờ gửi `Request` để mang theo giấy thông hành đúng
            # origin, thay vì đưa thẳng chuỗi URL.
            requested.append(request.full_url)
            return Response()

        stats = dcom_pipeline.DownloadStats()
        captured = {
            "getstudies": body,
            "template_url": "https://viewer.test/GetImage?token=x",
        }
        with patch_pacs_network(fake_urlopen):
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
        # 1. Có manifest biết tổng (expected > 0):
        self.assertFalse(dcom_pipeline.DownloadStats(dicom=4, expected=348).is_complete())
        self.assertEqual("partial", dcom_pipeline.DownloadStats(dicom=4, expected=348).status)

        self.assertTrue(dcom_pipeline.DownloadStats(dicom=348, expected=348).is_complete())
        self.assertEqual("complete", dcom_pipeline.DownloadStats(dicom=348, expected=348).status)

        # Có lỗi (failed > 0) -> không được báo complete
        self.assertFalse(dcom_pipeline.DownloadStats(dicom=348, expected=348, failed=1).is_complete())
        self.assertEqual("partial", dcom_pipeline.DownloadStats(dicom=348, expected=348, failed=1).status)

        # Chỉ có ảnh render JPG/PNG -> không được coi là hoàn tất DICOM
        self.assertFalse(dcom_pipeline.DownloadStats(dicom=0, jpg=348, expected=348).is_complete())
        self.assertEqual("rendered_only", dcom_pipeline.DownloadStats(dicom=0, jpg=348, expected=348).status)

        # 2. Không biết manifest (expected <= 0):
        # Không bao giờ được báo complete (vì không có bằng chứng đã đủ), chỉ được báo partial_unknown
        self.assertFalse(dcom_pipeline.DownloadStats(dicom=1, expected=0).is_complete())
        self.assertEqual("partial_unknown", dcom_pipeline.DownloadStats(dicom=1, expected=0).status)

        # 3. Trạng thái hủy & rỗng:
        self.assertFalse(dcom_pipeline.DownloadStats(cancelled=True).is_complete())
        self.assertEqual("cancelled", dcom_pipeline.DownloadStats(cancelled=True).status)
        self.assertFalse(dcom_pipeline.DownloadStats().is_complete())
        self.assertEqual("unknown", dcom_pipeline.DownloadStats().status)

    def test_manifest_records_download_and_viewer_provenance(self):
        """Manifest ghi nhận đầy đủ downloadUrl, viewerUrl, patientCode, accessionNumber, hospital."""
        root = Path(tempfile.mkdtemp())
        patient_folder, manifest, _ = dcom_pipeline.ensure_patient_archive(
            root,
            patient_id="BN12345",
            patient_name="NGUYEN VAN A",
            hospital_key="dhy",
            hospital_name="BV Đại học Y Hà Nội",
        )
        study_folder = patient_folder / "2026-08-15 - CT"
        study_folder.mkdir(parents=True)
        study = {
            "study_uid": "1.2.840.113619.1.999",
            "date": "2026-08-15",
            "modality": "CT",
            "desc": "CT So Nao",
            "viewer_url": "https://pacsviet.vn/viewer/study-12345",
            "patient_id": "BN12345",
            "accession_number": "ACC-9988",
            "hospital_key": "dhy",
            "hospital_name": "BV Đại học Y Hà Nội",
        }
        dcom_pipeline.record_patient_study(
            patient_folder,
            study,
            study_folder,
            complete=True,
            image_count=50,
        )
        updated_manifest = dcom_pipeline._read_patient_manifest(patient_folder)
        self.assertIsNotNone(updated_manifest)
        study_entry = updated_manifest["studies"]["1.2.840.113619.1.999"]
        self.assertEqual(study_entry["downloadUrl"], "https://pacsviet.vn/viewer/study-12345")
        self.assertEqual(study_entry["viewerUrl"], "https://pacsviet.vn/viewer/study-12345")
        self.assertEqual(study_entry["patientCode"], "BN12345")
        self.assertEqual(study_entry["accessionNumber"], "ACC-9988")
        self.assertEqual(study_entry["hospitalKey"], "dhy")
        self.assertEqual(study_entry["hospitalName"], "BV Đại học Y Hà Nội")

        # Direct manifest
        direct_root = Path(tempfile.mkdtemp())
        dcom_pipeline.write_direct_patient_manifest(
            direct_root,
            direct_root,
            {
                "PatientID": "BN67890",
                "PatientName": "TRAN THI B",
                "viewer_url": "https://direct-viewer.org/view?id=456",
                "AccessionNumber": "ACC-7766",
                "StudyInstanceUID": "1.2.3.4.5",
            },
            image_count=10,
            complete=True,
        )
        direct_manifest = dcom_pipeline._read_patient_manifest(direct_root)
        self.assertIsNotNone(direct_manifest)
        self.assertEqual(direct_manifest["directUrl"], "https://direct-viewer.org/view?id=456")
        self.assertIn("1.2.3.4.5", direct_manifest["studies"])
        direct_study = direct_manifest["studies"]["1.2.3.4.5"]
        self.assertEqual(direct_study["downloadUrl"], "https://direct-viewer.org/view?id=456")
        self.assertEqual(direct_study["accessionNumber"], "ACC-7766")


class DicomWebReadyContractTests(unittest.TestCase):
    """`is_ready()` chỉ được hứa đúng cái `_download_via_dicomweb()` làm được.

    Trước đây adapter nhận mọi URL kết thúc "/series", còn phần tải lại đòi tách
    cho được ".../studies/<uid>/series". Dạng QIDO top-level lọt qua cửa adapter
    rồi chết ở phần tải — đốt mất một lượt thử mà không lấy được ảnh nào.
    """

    def test_hierarchical_qido_yields_study_uid(self):
        url = "https://pacs.example.org/rs/studies/1.2.840.113619.2.55/series"
        self.assertEqual(
            dcom_pipeline._dicomweb_study_from_qido(url),
            "1.2.840.113619.2.55",
        )
        self.assertTrue(
            dcom_pipeline.DicomWebAdapter().is_ready(
                dcom_pipeline.ViewerCapture(qido_series=url)
            )
        )

    def test_query_string_does_not_disturb_the_split(self):
        url = "https://pacs.example.org/rs/studies/1.2.3.4/series?includefield=all&token=secret"
        self.assertEqual(dcom_pipeline._dicomweb_study_from_qido(url), "1.2.3.4")

    def test_top_level_qido_is_not_claimed_as_ready(self):
        # Hợp chuẩn PS3.18 nhưng phần tải chưa dựng được rs_base từ dạng này.
        url = "https://pacs.example.org/rs/series?StudyInstanceUID=1.2.3.4"
        cap = dcom_pipeline.ViewerCapture(qido_series=url)
        self.assertEqual(dcom_pipeline._dicomweb_study_from_qido(url), "")
        self.assertFalse(dcom_pipeline.DicomWebAdapter().is_ready(cap))
        # Và phải nói rõ lý do thay vì im lặng.
        self.assertIn("/studies/<uid>/", dcom_pipeline.DicomWebAdapter().why_not_ready(cap))

    def test_empty_study_segment_is_rejected(self):
        self.assertEqual(
            dcom_pipeline._dicomweb_study_from_qido("https://p.example.org/rs/studies//series"),
            "",
        )
        self.assertEqual(dcom_pipeline._dicomweb_study_from_qido(None), "")


class DiscoveryFailureReportTests(unittest.TestCase):
    """Link lạ phải để lại đủ dấu vết để biết viết adapter nào tiếp theo."""

    def test_report_names_every_adapter_and_the_endpoints_seen(self):
        cap = dcom_pipeline.ViewerCapture()
        dcom_pipeline._note_seen_url(cap, "https://pacs.example.org/api/v3/GetStudyTree?token=SECRET&id=9")
        dcom_pipeline._note_seen_url(cap, "https://pacs.example.org/static/app.js")

        lines: list[str] = []
        dcom_pipeline._log_discovery_failure(cap, lines.append)
        report = "\n".join(lines)

        for adapter in dcom_pipeline.PACS_ADAPTERS:
            self.assertIn(adapter.name, report)
        # Endpoint API giữ lại, tài nguyên tĩnh của giao diện thì không.
        self.assertIn("/api/v3/GetStudyTree", report)
        self.assertNotIn("app.js", report)
        # Tên tham số giữ lại để chẩn đoán, GIÁ TRỊ token thì tuyệt đối không.
        self.assertIn("<id,token>", report)
        self.assertNotIn("SECRET", report)

    def test_report_states_what_each_adapter_is_waiting_for(self):
        lines: list[str] = []
        dcom_pipeline._log_discovery_failure(dcom_pipeline.ViewerCapture(), lines.append)
        report = "\n".join(lines)

        self.assertIn("StudyData/GetStudies", report)
        self.assertIn("get-share-patient-image", report)
        self.assertIn("GetListImageFileInfo", report)
        self.assertIn("/series", report)

    def test_seen_urls_are_deduped_and_bounded(self):
        cap = dcom_pipeline.ViewerCapture()
        for _ in range(5):
            dcom_pipeline._note_seen_url(cap, "https://p.example.org/api/x?token=a")
        self.assertEqual(len(cap.seen_urls), 1)

        for index in range(200):
            dcom_pipeline._note_seen_url(cap, f"https://p.example.org/api/{index}")
        self.assertLessEqual(len(cap.seen_urls), dcom_pipeline._SEEN_URL_LIMIT)


class DicomWebProfileTests(unittest.TestCase):
    """Search có hai dạng hợp chuẩn, Retrieve thì chỉ có một."""

    def test_hierarchical_search_urls(self):
        p = dcom_pipeline.DicomWebProfile(rs_base="https://h/rs", study_uid="1.2.3")
        self.assertEqual(p.series_search_url(), "https://h/rs/studies/1.2.3/series")
        self.assertEqual(
            p.instances_search_url("9.9"),
            "https://h/rs/studies/1.2.3/series/9.9/instances",
        )
        self.assertEqual(
            p.study_instances_search_url(limit=100000),
            "https://h/rs/studies/1.2.3/instances?limit=100000",
        )

    def test_toplevel_search_urls(self):
        p = dcom_pipeline.DicomWebProfile(
            rs_base="https://h/rs", study_uid="1.2.3", query_style="toplevel",
        )
        self.assertEqual(
            p.series_search_url(), "https://h/rs/series?StudyInstanceUID=1.2.3")
        self.assertEqual(
            p.instances_search_url("9.9"),
            "https://h/rs/instances?StudyInstanceUID=1.2.3&SeriesInstanceUID=9.9",
        )
        self.assertEqual(
            p.study_instances_search_url(limit=50),
            "https://h/rs/instances?StudyInstanceUID=1.2.3&limit=50",
        )

    def test_retrieve_stays_hierarchical_in_both_styles(self):
        # PS3.18: Retrieve Transaction chỉ có dạng phân cấp. Nếu chỗ này đi theo
        # `query_style` thì mọi PACS top-level sẽ tải hỏng.
        for style in ("hierarchical", "toplevel"):
            p = dcom_pipeline.DicomWebProfile(
                rs_base="https://h/rs", study_uid="1.2.3", query_style=style,
            )
            self.assertEqual(
                p.instance_url("9.9", "7.7"),
                "https://h/rs/studies/1.2.3/series/9.9/instances/7.7",
                style,
            )
            self.assertEqual(
                p.series_metadata_url("9.9"),
                "https://h/rs/studies/1.2.3/series/9.9/metadata",
                style,
            )

    def test_from_qido_url_round_trip(self):
        p = dcom_pipeline.DicomWebProfile.from_qido_url(
            "https://pacs.test/dicom-web/studies/1.2.840.5/series?includefield=all")
        self.assertIsNotNone(p)
        self.assertEqual(p.rs_base, "https://pacs.test/dicom-web")
        self.assertEqual(p.study_uid, "1.2.840.5")
        self.assertEqual(p.query_style, "hierarchical")
        self.assertIsNone(
            dcom_pipeline.DicomWebProfile.from_qido_url("https://pacs.test/rs/series?x=1"))


class FakeFrame:
    def __init__(self, url, config_entries=None, probe_result=None):
        self.url = url
        self._config = config_entries if config_entries is not None else []
        self._probe_result = probe_result
        self.probed = []

    def evaluate(self, js, args=None):
        if "window.config" in js:
            return self._config
        self.probed.extend(item["url"] for item in (args or [[]])[0])
        return self._probe_result


class FakePage:
    """Trang giả: chỉ cần `.frames`, `.url`, `.evaluate` như discovery dùng."""

    def __init__(self, url, frames=None, config_entries=None, probe_result=None):
        self.url = url
        self._self_frame = FakeFrame(url, config_entries, probe_result)
        self.frames = frames if frames is not None else [self._self_frame]

    def evaluate(self, js, args=None):
        return self._self_frame.evaluate(js, args)

    def on(self, *_args):
        pass

    def goto(self, *_args, **_kwargs):
        pass

    def wait_for_timeout(self, *_args):
        pass

    def wait_for_load_state(self, *_args, **_kwargs):
        pass

    @property
    def probed(self):
        return [u for frame in self.frames for u in getattr(frame, "probed", [])]


def probe_win(url, body="[]"):
    return {"winner": {"url": url, "body": body}, "diagnostics": []}


def probe_lose(diagnostics=()):
    return {"winner": None, "diagnostics": list(diagnostics)}


class DicomWebDiscoveryTests(unittest.TestCase):
    def setUp(self):
        self.store = dcom_pipeline.PacsStrategyStore(
            Path(tempfile.mkdtemp()) / "strategies.json")
        patcher = patch.object(dcom_pipeline, "pacs_strategy_store", self.store)
        patcher.start()
        self.addCleanup(patcher.stop)

    @staticmethod
    def _roots(candidates):
        return [c.root for c in candidates]

    # --- suy ra StudyInstanceUID -------------------------------------------

    def test_study_uid_read_from_query_of_the_qido_url_itself(self):
        """Link viewer mờ + QIDO top-level: chính là ca cần discovery nhất.

        Trước đây chỉ soi query của link viewer và `page.url`, còn UID thì chỉ
        moi từ path `/studies/<uid>/` — nên dạng này luôn ra rỗng và không bao
        giờ discovery được.
        """
        cap = dcom_pipeline.ViewerCapture(
            qido_series="https://pacs/rs/series?StudyInstanceUID=1.2.3")
        self.assertEqual(
            dcom_pipeline._study_uid_candidates(cap, "https://pacs/view?token=opaque"),
            ["1.2.3"],
        )

    def test_study_uid_prefers_the_hierarchical_path_evidence(self):
        cap = dcom_pipeline.ViewerCapture(
            qido_series="https://p/rs/studies/1.1.1/series")
        uids = dcom_pipeline._study_uid_candidates(
            cap, "https://p/viewer?StudyInstanceUIDs=2.2.2,3.3.3")
        self.assertEqual(uids[0], "1.1.1")
        self.assertIn("2.2.2", uids)
        self.assertIn("3.3.3", uids)

    def test_study_uid_rejects_values_that_are_not_uids(self):
        cap = dcom_pipeline.ViewerCapture()
        for bad in ("../../etc/passwd", "abc-def", "'; DROP TABLE--"):
            self.assertEqual(
                dcom_pipeline._study_uid_candidates(cap, f"https://p/v?studyUID={bad}"),
                [], bad)

    # --- xếp bậc ứng viên ---------------------------------------------------

    def test_learned_root_sits_in_the_first_tier_alone(self):
        self.store.save_recipe(
            fingerprint="FP", adapter="DICOMweb", success=True,
            dicomweb_base="https://p/learned", dicomweb_query_style="toplevel")
        cap = dcom_pipeline.ViewerCapture(strategy_fingerprint="FP")
        candidates = dcom_pipeline._dicomweb_root_candidates(
            FakePage("https://p/viewer"), cap, "https://p/viewer", lambda _m: None)
        self.assertEqual(candidates[0].root, "https://p/learned")
        self.assertEqual(candidates[0].tier, dcom_pipeline._TIER_LEARNED)
        # Style đã học phải được dùng, không phải đọc ra rồi bỏ đi.
        self.assertEqual(candidates[0].style_hint, "toplevel")
        self.assertEqual(
            [c for c in candidates if c.tier == dcom_pipeline._TIER_LEARNED],
            candidates[:1])

    def test_active_datasource_outranks_the_other_config_roots(self):
        page = FakePage("https://p/viewer", config_entries=[
            {"root": "https://p/backup-rs", "preferred": False},
            {"root": "https://p/dicom-web", "preferred": True},
        ])
        candidates = dcom_pipeline._dicomweb_root_candidates(
            page, dcom_pipeline.ViewerCapture(), "https://p/viewer", lambda _m: None)
        by_root = {c.root: c.tier for c in candidates}
        self.assertEqual(by_root["https://p/dicom-web"], dcom_pipeline._TIER_CONFIG_ACTIVE)
        self.assertEqual(by_root["https://p/backup-rs"], dcom_pipeline._TIER_CONFIG_OTHER)
        self.assertLess(
            self._roots(candidates).index("https://p/dicom-web"),
            self._roots(candidates).index("https://p/backup-rs"))

    def test_config_roots_resolve_relative_and_outrank_guesses(self):
        page = FakePage("https://p/viewer", frames=[
            FakeFrame("https://p/viewer", []),
            FakeFrame("https://p/app/index.html",
                      [{"root": "/dicom-web", "preferred": True},
                       {"root": "https://other/rs/", "preferred": False}]),
        ])
        roots = self._roots(dcom_pipeline._dicomweb_root_candidates(
            page, dcom_pipeline.ViewerCapture(), "https://p/viewer", lambda _m: None))
        self.assertIn("https://p/dicom-web", roots)   # tương đối -> tuyệt đối
        self.assertIn("https://other/rs", roots)      # bỏ "/" cuối
        self.assertLess(roots.index("https://p/dicom-web"), roots.index("https://p/rs"))

    def test_root_candidates_trim_study_path_and_dedupe(self):
        page = FakePage("https://p/v", config_entries=[
            {"root": "https://p/rs/studies/1.2.3", "preferred": True},
            {"root": "https://p/rs", "preferred": False},
        ])
        roots = self._roots(dcom_pipeline._dicomweb_root_candidates(
            page, dcom_pipeline.ViewerCapture(), "https://p/v", lambda _m: None))
        self.assertEqual(roots.count("https://p/rs"), 1)

    def test_candidate_is_probed_from_the_frame_sharing_its_origin(self):
        """Đọc root trong iframe nhưng bắn dò từ trang cha là rơi vào CORS."""
        inner = FakeFrame("https://pacs.other/app/",
                          [{"root": "https://pacs.other/dicom-web", "preferred": True}])
        page = FakePage("https://wrapper.vn/viewer",
                        frames=[FakeFrame("https://wrapper.vn/viewer", []), inner])
        candidates = dcom_pipeline._dicomweb_root_candidates(
            page, dcom_pipeline.ViewerCapture(), "https://wrapper.vn/viewer", lambda _m: None)
        picked = [c for c in candidates if c.root == "https://pacs.other/dicom-web"]
        self.assertEqual(len(picked), 1)
        self.assertIs(picked[0].frame, inner)

    # --- chạy dò theo bậc ---------------------------------------------------

    def test_tiers_run_in_order_so_a_guess_cannot_beat_the_learned_root(self):
        """Bậc trước phải xong mới sang bậc sau.

        Gộp hết vào một `Promise.any` thì root đoán mò trả lời nhanh hơn có thể
        giành mất root đã học — learning coi như không giảm được gì.
        """
        self.store.save_recipe(
            fingerprint="FP", adapter="DICOMweb", success=True,
            dicomweb_base="https://p/learned", dicomweb_query_style="hierarchical")
        page = FakePage("https://p/v?studyUID=1.2.3",
                        probe_result=probe_win("https://p/learned/studies/1.2.3/series"))
        cap = dcom_pipeline.ViewerCapture(strategy_fingerprint="FP")
        profile = dcom_pipeline.resolve_dicomweb_access(
            page, cap, "https://p/v?studyUID=1.2.3", lambda _m: None, lambda: False)
        self.assertIsNotNone(profile)
        self.assertEqual(profile.rs_base, "https://p/learned")
        # Thắng ngay bậc đầu thì không được bắn thêm ứng viên nào của bậc sau.
        self.assertEqual(page.probed, ["https://p/learned/studies/1.2.3/series"])

    def test_resolved_profile_and_verified_body_are_written_back_to_cap(self):
        body = json.dumps([{"0020000E": {"Value": ["9.9"]}}])
        page = FakePage(
            "https://p/viewer?StudyInstanceUIDs=1.2.3",
            config_entries=[{"root": "https://p/dicom-web", "preferred": True}],
            probe_result=probe_win("https://p/dicom-web/series?StudyInstanceUID=1.2.3", body))
        cap = dcom_pipeline.ViewerCapture()
        profile = dcom_pipeline.resolve_dicomweb_access(
            page, cap, "https://p/viewer?StudyInstanceUIDs=1.2.3",
            lambda _m: None, lambda: False)
        self.assertEqual(profile.query_style, "toplevel")
        self.assertEqual(profile.source, "probe")
        self.assertIs(cap.dicomweb_profile, profile)
        # Thân đã xác minh phải ghi thẳng vào cap: phần liệt kê series không được
        # phụ thuộc vào việc event `on_response` có kịp lưu hay không.
        self.assertEqual(cap.qido_series_body, body.encode("utf-8"))
        self.assertEqual(cap.qido_series, "https://p/dicom-web/series?StudyInstanceUID=1.2.3")

    def test_toplevel_candidates_demand_proof_the_server_filtered(self):
        page = FakePage("https://p/v?studyUID=1.2.3", probe_result=probe_lose())
        dcom_pipeline.resolve_dicomweb_access(
            page, dcom_pipeline.ViewerCapture(), "https://p/v?studyUID=1.2.3",
            lambda _m: None, lambda: False)
        sent = []
        for frame in page.frames:
            sent.extend(getattr(frame, "probed", []))
        self.assertTrue(any("?StudyInstanceUID=1.2.3" in u for u in sent))

    def test_discovery_gives_up_without_a_study_uid(self):
        page = FakePage("https://p/viewer", probe_result=probe_win("khong-duoc-dung"))
        self.assertIsNone(dcom_pipeline.resolve_dicomweb_access(
            page, dcom_pipeline.ViewerCapture(), "https://p/viewer",
            lambda _m: None, lambda: False))
        self.assertEqual(page.probed, [])

    def test_discovery_returns_none_when_nothing_validates(self):
        page = FakePage("https://p/v?studyUID=1.2.3", probe_result=probe_lose())
        self.assertIsNone(dcom_pipeline.resolve_dicomweb_access(
            page, dcom_pipeline.ViewerCapture(), "https://p/v?studyUID=1.2.3",
            lambda _m: None, lambda: False))

    def test_all_401_is_reported_as_missing_permission_not_missing_route(self):
        messages: list[str] = []
        dcom_pipeline._log_probe_diagnostics(
            [{"url": "https://p/rs/series", "error": "status 401"},
             {"url": "https://p/dicom-web/series", "error": "status 403"}],
            messages.append)
        self.assertTrue(any("thiếu QUYỀN" in m for m in messages), messages)

    def test_discovered_profile_makes_the_adapter_ready(self):
        cap = dcom_pipeline.ViewerCapture()
        self.assertFalse(dcom_pipeline.DicomWebAdapter().is_ready(cap))
        cap.dicomweb_profile = dcom_pipeline.DicomWebProfile(
            rs_base="https://p/rs", study_uid="1.2.3", query_style="toplevel")
        self.assertTrue(dcom_pipeline.DicomWebAdapter().is_ready(cap))

    # --- không rò token sang origin lạ --------------------------------------

    @staticmethod
    def _observe(cap, url, headers):
        class Req:
            def all_headers(self):
                return headers

        class Resp:
            request = Req()

        resp = Resp()
        resp.url = url
        resp.headers = {"content-type": "application/dicom+json"}
        dcom_pipeline.DicomWebAdapter().observe(resp, cap)

    def test_session_headers_only_go_back_to_the_origin_they_came_from(self):
        cap = dcom_pipeline.ViewerCapture(session_headers={
            "https://pacs.a.vn": {"Authorization": "Bearer SECRET", "X-Tenant": "bv-a"}})
        self.assertEqual(
            dcom_pipeline._probe_headers_for(cap, "https://pacs.a.vn/dicom-web"),
            {"Authorization": "Bearer SECRET", "X-Tenant": "bv-a"})
        # Bắn token của viện A sang origin đoán mò khác là làm lộ token.
        self.assertEqual(
            dcom_pipeline._probe_headers_for(cap, "https://pacs.b.vn/dicom-web"), {})

    def test_session_headers_are_grabbed_from_any_dicomweb_request(self):
        cap = dcom_pipeline.ViewerCapture()
        # Viewer hay xin metadata/frames trước (hoặc thay vì) gọi QIDO; chỉ soi
        # mỗi "/series" thì nhiều viện không bao giờ nhặt được token.
        self._observe(cap, "https://pacs.a.vn/dicom-web/studies/1.2/series/9/metadata",
                      {"Authorization": "Bearer T", "User-Agent": "khong-phai-giay-thong-hanh"})
        self.assertEqual(cap.session_headers,
                         {"https://pacs.a.vn": {"Authorization": "Bearer T"}})

    def test_a_header_set_without_credentials_does_not_block_a_later_bearer(self):
        """Request chỉ có `Accept` mà chiếm chỗ thì cả ca mất quyền."""
        cap = dcom_pipeline.ViewerCapture()
        self._observe(cap, "https://p.vn/rs/studies/1.2/metadata",
                      {"Accept": "application/dicom+json"})
        self.assertEqual(cap.session_headers, {})
        self._observe(cap, "https://p.vn/rs/studies/1.2/series",
                      {"Authorization": "Bearer LATE"})
        self.assertEqual(
            dcom_pipeline._session_headers_for(cap, "https://p.vn/rs/studies/1.2/series"),
            {"Authorization": "Bearer LATE"})

    def test_a_refreshed_token_replaces_the_stale_one(self):
        cap = dcom_pipeline.ViewerCapture()
        self._observe(cap, "https://p.vn/rs/studies/1.2/series", {"Authorization": "Bearer OLD"})
        self._observe(cap, "https://p.vn/rs/studies/1.2/instances", {"Authorization": "Bearer NEW"})
        self.assertEqual(cap.session_headers["https://p.vn"], {"Authorization": "Bearer NEW"})

    def test_headers_are_kept_apart_per_origin(self):
        cap = dcom_pipeline.ViewerCapture()
        self._observe(cap, "https://a.vn/rs/studies/1/series", {"Authorization": "Bearer A"})
        self._observe(cap, "https://b.vn/rs/studies/1/series", {"Authorization": "Bearer B"})
        self.assertEqual(dcom_pipeline._session_headers_for(cap, "https://a.vn/rs/x"),
                         {"Authorization": "Bearer A"})
        self.assertEqual(dcom_pipeline._session_headers_for(cap, "https://b.vn/rs/x"),
                         {"Authorization": "Bearer B"})


class SessionPassportScopingTests(unittest.TestCase):
    """Đường TẢI THẬT không được mang giấy thông hành sang origin khác.

    Probe khoá theo origin là chưa đủ: sau discovery, `rs_base` có thể ở origin
    khác hẳn nơi bắt được token, và trước đây downloader dựng một bộ header dùng
    chung ở đầu hàm nên vẫn gửi token đi.
    """

    def test_downloader_sends_the_passport_only_to_its_own_origin(self):
        requested: list[tuple[str, dict]] = []

        class Response:
            headers = {"Content-Type": "application/dicom+json"}

            def __init__(self, payload=b"[]"):
                self.payload = payload

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def read(self):
                return self.payload

        def fake_urlopen(request, **_kwargs):
            requested.append((request.full_url, dict(request.headers)))
            return Response()

        captured = {
            # Token bắt ở viện A, nhưng discovery lại chốt root ở viện B.
            "session_headers": {"https://pacs.a.vn": {"Authorization": "Bearer SECRET"}},
            "cookies": [{"name": "sid", "value": "A-SESSION",
                         "domain": "pacs.a.vn", "path": "/"}],
            "dicomweb_profile": dcom_pipeline.DicomWebProfile(
                rs_base="https://pacs.b.vn/rs", study_uid="1.2.3", source="probe"),
            "qido_series": "https://pacs.b.vn/rs/studies/1.2.3/series",
            "wado_tmpl": None,
        }
        with patch_pacs_network(fake_urlopen):
            dcom_pipeline._download_via_dicomweb(
                captured, lambda _b: True, dcom_pipeline.DownloadStats(),
                lambda _m: None, lambda: False)

        self.assertTrue(requested)
        for url, headers in requested:
            flat = json.dumps(headers)
            self.assertNotIn("SECRET", flat, url)
            self.assertNotIn("A-SESSION", flat, url)

    def test_downloader_does_send_the_passport_to_the_matching_origin(self):
        seen: list[dict] = []

        class Response:
            headers = {"Content-Type": "application/dicom+json"}

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def read(self):
                return b"[]"

        def fake_urlopen(request, **_kwargs):
            seen.append({k.lower(): v for k, v in request.headers.items()})
            return Response()

        captured = {
            "session_headers": {"https://pacs.a.vn": {"Authorization": "Bearer SECRET"}},
            "cookies": [{"name": "sid", "value": "A-SESSION",
                         "domain": "pacs.a.vn", "path": "/"}],
            "qido_series": "https://pacs.a.vn/rs/studies/1.2.3/series",
            "wado_tmpl": None,
        }
        with patch_pacs_network(fake_urlopen):
            dcom_pipeline._download_via_dicomweb(
                captured, lambda _b: True, dcom_pipeline.DownloadStats(),
                lambda _m: None, lambda: False)

        self.assertTrue(seen)
        self.assertEqual(seen[0].get("authorization"), "Bearer SECRET")
        self.assertIn("sid=A-SESSION", seen[0].get("cookie", ""))

    def test_cookies_are_matched_by_domain_path_and_secure_flag(self):
        captured = {"cookies": [
            {"name": "host", "value": "1", "domain": "pacs.a.vn", "path": "/"},
            {"name": "wild", "value": "2", "domain": ".a.vn", "path": "/"},
            {"name": "other", "value": "3", "domain": "pacs.b.vn", "path": "/"},
            {"name": "deep", "value": "4", "domain": "pacs.a.vn", "path": "/rs"},
            {"name": "tls", "value": "5", "domain": "pacs.a.vn", "path": "/", "secure": True},
        ]}
        got = dcom_pipeline._cookie_header_for(captured, "https://pacs.a.vn/rs/studies")
        self.assertIn("host=1", got)
        self.assertIn("wild=2", got)      # cookie domain khớp hậu tố
        self.assertIn("deep=4", got)      # path khớp tiền tố
        self.assertIn("tls=5", got)       # đang là https
        self.assertNotIn("other=3", got)  # domain khác hẳn

        shallow = dcom_pipeline._cookie_header_for(captured, "https://pacs.a.vn/khac")
        self.assertNotIn("deep=4", shallow)
        plain = dcom_pipeline._cookie_header_for(captured, "http://pacs.a.vn/rs")
        self.assertNotIn("tls=5", plain)   # cookie secure không đi qua http


class VendorDownloaderPassportTests(unittest.TestCase):
    """Dòng PACS độc quyền cũng phải khoá theo origin.

    Manifest của chúng được phép chứa URL TUYỆT ĐỐI — `to_url()` trả thẳng chuỗi
    khi nó bắt đầu bằng "http", còn VietMy dùng nguyên `filePath/wanFilePath` —
    nên ảnh hoàn toàn có thể nằm ở CDN khác origin.
    """

    class _Resp:
        headers = {"Content-Type": "application/dicom"}

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def read(self):
            return b"\x00" * 128 + b"DICM"

    def _run(self, fn, captured):
        sent: list[tuple[str, dict]] = []

        def fake_urlopen(request, **_kwargs):
            sent.append((request.full_url, {k.lower(): v for k, v in request.headers.items()}))
            return self._Resp()

        with patch_pacs_network(fake_urlopen):
            fn(captured, lambda _b: True, dcom_pipeline.DownloadStats(),
               lambda _m: None, lambda: False, None)
        return sent

    @staticmethod
    def _passport():
        return {
            "session_headers": {"https://pacs.a.vn": {"Authorization": "Bearer SECRET"}},
            "cookies": [{"name": "sid", "value": "COOKIESECRET",
                         "domain": "pacs.a.vn", "path": "/"}],
        }

    def test_vrpacs_absolute_cdn_url_gets_no_passport(self):
        captured = dict(self._passport())
        captured["vrpacs"] = json.dumps({"data": {"studyList": [{"seriesList": [{
            "seriesInstanceUid": "s1",
            # `to_url()` trả thẳng chuỗi này vì nó bắt đầu bằng "http".
            "imageIds": ["wadouri:https://cdn.other.vn/a.dcm",
                         "wadouri:/vrpacs-scu/study-get-public?file=b.dcm"],
        }]}]}}).encode()
        captured["host"] = "https://pacs.a.vn"

        sent = self._run(dcom_pipeline._download_via_vrpacs, captured)
        foreign = [h for u, h in sent if "cdn.other.vn" in u]
        self.assertTrue(foreign, sent)
        for headers in foreign:
            self.assertNotIn("authorization", headers)
            self.assertNotIn("cookie", headers)

    def test_vietmy_file_path_on_another_origin_gets_no_passport(self):
        captured = dict(self._passport())
        captured["vietmy"] = json.dumps({"d": json.dumps({
            "seriesList": [{
                "seriesInstanceUid": "s1", "seriesNumber": 1, "modality": "CT",
                "fileList": [{"filePath": "https://storage.other.vn/x.dcm"}],
            }],
        })}).encode()

        sent = self._run(dcom_pipeline._download_via_vietmy, captured)
        foreign = [h for u, h in sent if "storage.other.vn" in u]
        self.assertTrue(foreign, sent)
        for headers in foreign:
            self.assertNotIn("authorization", headers)
            self.assertNotIn("cookie", headers)


class MultiProfileFallbackTests(unittest.TestCase):
    def test_download_all_walks_several_dicomweb_profiles_before_giving_up(self):
        """Profile A hỏng → style còn lại → root khác, chứ không dừng sau một lượt."""
        frame = FakeFrame("https://p/v?studyUID=1.2.3", [
            {"root": "https://p/first", "preferred": True},
            {"root": "https://p/second", "preferred": False},
        ])

        def evaluate(js, args=None):
            if "window.config" in js:
                return frame._config
            return probe_win(args[0][0]["url"])

        frame.evaluate = evaluate
        page = FakePage("https://p/v?studyUID=1.2.3", frames=[frame])

        class FakeContext:
            def add_init_script(self, *_args): pass
            def new_page(self): return page
            def cookies(self): return []

        class FakeBrowser:
            def __init__(self): self.closed = False
            def new_context(self, **_kwargs): return FakeContext()
            def close(self): self.closed = True

        browser = FakeBrowser()
        class FakePlaywrightContext:
            def __enter__(self): return object()
            def __exit__(self, *_args): return False

        attempted_profiles: list[tuple[str, str]] = []

        def mock_download(_self, cap, _save_body, stats, _log, _stop, _selected):
            profile = cap.dicomweb_profile
            root = profile.rs_base if profile else ""
            style = profile.query_style if profile else ""
            attempted_profiles.append((root, style))
            if root == "https://p/first":
                stats.failed += 1
                raise RuntimeError(f"first profile failed: {style}")
            elif root == "https://p/second":
                stats.dicom = 2
                stats.expected = 2
                stats.completed_tasks = 2
                stats.failed = 0

        with tempfile.TemporaryDirectory() as tmp_dir, \
             patch("playwright.sync_api.sync_playwright", return_value=FakePlaywrightContext()), \
             patch.object(dcom_pipeline, "_launch_chromium", return_value=browser), \
             patch.object(dcom_pipeline, "_wait_for_viewer_manifest", return_value=None), \
             patch.object(dcom_pipeline.DicomWebAdapter, "download", mock_download), \
             patch.object(dcom_pipeline.pacs_strategy_store, "save_recipe"):
            stats = dcom_pipeline.download_all(
                "https://p/v?studyUID=1.2.3",
                Path(tmp_dir) / "DICOM",
                log=lambda _m: None,
            )

        self.assertEqual(
            ["https://p/first", "https://p/first", "https://p/second"],
            [r for r, _ in attempted_profiles],
        )
        self.assertTrue(stats.is_complete())
        self.assertEqual(3, len(stats.outcomes))
        self.assertTrue(browser.closed)

    def test_resolver_keeps_offering_new_profiles_until_they_run_out(self):
        frame = FakeFrame("https://p/v?studyUID=1.2.3", [
            {"root": "https://p/first", "preferred": True},
            {"root": "https://p/second", "preferred": False},
        ])

        def evaluate(js, args=None):
            if "window.config" in js:
                return frame._config
            return probe_win(args[0][0]["url"])

        frame.evaluate = evaluate
        page = FakePage("https://p/v?studyUID=1.2.3", frames=[frame])
        cap = dcom_pipeline.ViewerCapture()

        spent: set[tuple[str, str]] = set()
        seen: list[tuple[str, str]] = []
        for _ in range(dcom_pipeline._MAX_DICOMWEB_PROFILES):
            profile = dcom_pipeline.resolve_dicomweb_access(
                page, cap, "https://p/v?studyUID=1.2.3", lambda _m: None,
                lambda: False, exclude=spent)
            if profile is None:
                break
            key = (profile.rs_base, profile.query_style)
            self.assertNotIn(key, spent)   # không bao giờ trả lại cái đã hỏng
            seen.append(key)
            spent.add(key)
        self.assertGreaterEqual(len(seen), 2, seen)


class CookieMatchingTests(unittest.TestCase):
    """RFC 6265 §5.1.3 / §5.1.4 — khớp gần đúng là gửi cookie sai chỗ."""

    @staticmethod
    def _cookies():
        return {"cookies": [
            {"name": "host_only", "value": "H", "domain": "pacs.a.vn", "path": "/"},
            {"name": "domain_wide", "value": "D", "domain": ".a.vn", "path": "/"},
            {"name": "path_bound", "value": "P", "domain": "pacs.a.vn", "path": "/rs"},
        ]}

    def test_host_only_cookie_never_reaches_a_subdomain(self):
        # "pacs.a.vn" (không dấu chấm đầu) là host-only; chỉ ".a.vn" mới được
        # xuống subdomain. Gộp hai loại là đẩy cookie sang host không được phép.
        got = dcom_pipeline._cookie_header_for(self._cookies(), "https://evil.pacs.a.vn/x")
        self.assertNotIn("host_only", got)
        self.assertIn("domain_wide=D", got)

    def test_host_only_cookie_reaches_its_exact_host(self):
        got = dcom_pipeline._cookie_header_for(self._cookies(), "https://pacs.a.vn/x")
        self.assertIn("host_only=H", got)
        self.assertIn("domain_wide=D", got)

    def test_path_match_stops_at_a_slash_boundary(self):
        # "/rs" không được khớp "/rs-evil": ranh giới phải rơi đúng vào dấu "/".
        self.assertNotIn(
            "path_bound",
            dcom_pipeline._cookie_header_for(self._cookies(), "https://pacs.a.vn/rs-evil"))
        for allowed in ("https://pacs.a.vn/rs", "https://pacs.a.vn/rs/studies"):
            self.assertIn(
                "path_bound=P",
                dcom_pipeline._cookie_header_for(self._cookies(), allowed), allowed)


class RedirectPassportTests(unittest.TestCase):
    """30x không được mang giấy thông hành sang chặng khác.

    `urllib` tự đi theo redirect và bê nguyên header sang URL đích, nên lọc theo
    origin ở request ĐẦU là chưa đủ — chỉ cần một 302 là token đi theo.
    """

    def setUp(self):
        import http.server
        import threading

        self.seen: list[dict] = []
        outer = self

        class Target(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                outer.seen.append({k.lower(): v for k, v in self.headers.items()})
                self.send_response(200)
                self.send_header("Content-Type", "application/dicom+json")
                self.end_headers()
                self.wfile.write(b"[]")

            def log_message(self, *_a):
                pass

        self.target = http.server.HTTPServer(("127.0.0.1", 0), Target)
        target_port = self.target.server_port

        class Hop(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                self.send_response(302)
                self.send_header("Location", f"http://localhost:{target_port}/moved")
                self.end_headers()

            def log_message(self, *_a):
                pass

        self.hop = http.server.HTTPServer(("127.0.0.1", 0), Hop)
        for server in (self.target, self.hop):
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            # `shutdown()` mới chỉ dừng vòng phục vụ; không `server_close()` thì
            # socket còn treo và cả suite chạy kèm ResourceWarning.
            self.addCleanup(server.server_close)
            self.addCleanup(server.shutdown)

    def _fetch(self, captured):
        tracker = dcom_pipeline.ActiveSocketTracker()
        passport = dcom_pipeline._passport_builder(captured)
        opener = tracker.opener(passport=passport)
        url = f"http://127.0.0.1:{self.hop.server_port}/start"
        request = urllib.request.Request(url, headers=passport(url))
        with opener.open(request, timeout=10) as response:
            response.read()
        return self.seen[-1]

    def test_passport_is_dropped_when_the_redirect_leaves_the_origin(self):
        hop_origin = f"http://127.0.0.1:{self.hop.server_port}"
        landed = self._fetch({
            "session_headers": {hop_origin: {"Authorization": "Bearer SECRET",
                                             "X-Tenant": "bv-a"}},
            "cookies": [{"name": "sid", "value": "COOKIESECRET",
                         "domain": "127.0.0.1", "path": "/"}],
        })
        self.assertNotIn("authorization", landed)
        self.assertNotIn("x-tenant", landed)
        self.assertNotIn("cookie", landed)

    def test_passport_is_reissued_when_the_target_origin_has_its_own(self):
        hop_origin = f"http://127.0.0.1:{self.hop.server_port}"
        target_origin = f"http://localhost:{self.target.server_port}"
        landed = self._fetch({
            "session_headers": {
                hop_origin: {"Authorization": "Bearer FROM-HOP"},
                target_origin: {"Authorization": "Bearer FOR-TARGET"},
            },
            "cookies": [],
        })
        self.assertEqual(landed.get("authorization"), "Bearer FOR-TARGET")


class DiscoveryDeadlineAndRetryTests(unittest.TestCase):
    def setUp(self):
        self.store = dcom_pipeline.PacsStrategyStore(
            Path(tempfile.mkdtemp()) / "strategies.json")
        patcher = patch.object(dcom_pipeline, "pacs_strategy_store", self.store)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_total_deadline_is_absolute_across_every_tier_and_frame(self):
        """Hạn phải là của CẢ lượt, không phải mỗi bậc × mỗi frame một hạn."""
        elapsed = {"t": 0.0}
        budgets: list[int] = []

        class SlowFrame(FakeFrame):
            def evaluate(self, js, args=None):
                if "window.config" in js:
                    return self._config
                budgets.append(args[2])
                elapsed["t"] += args[2] / 1000.0   # coi như dùng hết hạn được cấp
                return probe_lose()

        frames = [SlowFrame("https://p/v", [{"root": f"https://p/r{i}", "preferred": False}])
                  for i in range(4)]
        page = FakePage("https://p/v?studyUID=1.2.3", frames=frames)
        with patch.object(dcom_pipeline.time, "monotonic", lambda: elapsed["t"]):
            dcom_pipeline.resolve_dicomweb_access(
                page, dcom_pipeline.ViewerCapture(), "https://p/v?studyUID=1.2.3",
                lambda _m: None, lambda: False, deadline_s=10.0)

        self.assertTrue(budgets)
        self.assertLessEqual(sum(budgets) / 1000.0, 10.0 + 0.001)
        # Và hạn cấp cho lượt sau phải teo dần theo thời gian đã tiêu.
        self.assertLess(budgets[-1], budgets[0])

    def test_a_wrong_learned_style_still_lets_the_other_style_run(self):
        """Recipe cũ ghi sai style thì không được loại luôn root hợp lệ."""
        self.store.save_recipe(
            fingerprint="FP", adapter="DICOMweb", success=True,
            dicomweb_base="https://p/rs", dicomweb_query_style="toplevel")

        tried: list[str] = []

        class Frame(FakeFrame):
            def evaluate(self, js, args=None):
                if "window.config" in js:
                    return self._config
                urls = [item["url"] for item in args[0]]
                tried.extend(urls)
                for url in urls:
                    if url == "https://p/rs/studies/1.2.3/series":
                        return probe_win(url)
                return probe_lose()

        frame = Frame("https://p/v?studyUID=1.2.3", [])
        page = FakePage("https://p/v?studyUID=1.2.3", frames=[frame])
        cap = dcom_pipeline.ViewerCapture(strategy_fingerprint="FP")
        profile = dcom_pipeline.resolve_dicomweb_access(
            page, cap, "https://p/v?studyUID=1.2.3", lambda _m: None, lambda: False)

        self.assertIsNotNone(profile)
        self.assertEqual(profile.query_style, "hierarchical")
        # Style đã học vẫn phải được thử TRƯỚC.
        self.assertEqual(tried[0], "https://p/rs/series?StudyInstanceUID=1.2.3")

    def test_a_failed_profile_is_excluded_so_another_root_gets_a_turn(self):
        class Frame(FakeFrame):
            def evaluate(self, js, args=None):
                if "window.config" in js:
                    return self._config
                for item in args[0]:
                    if item["url"].startswith("https://p/second"):
                        return probe_win(item["url"])
                return probe_lose()

        frame = Frame("https://p/v?studyUID=1.2.3", [
            {"root": "https://p/first", "preferred": True},
            {"root": "https://p/second", "preferred": False},
        ])
        page = FakePage("https://p/v?studyUID=1.2.3", frames=[frame])
        cap = dcom_pipeline.ViewerCapture()
        cap.dicomweb_profile = dcom_pipeline.DicomWebProfile(
            rs_base="https://p/first", study_uid="1.2.3", query_style="hierarchical")

        again = dcom_pipeline.resolve_dicomweb_access(
            page, cap, "https://p/v?studyUID=1.2.3", lambda _m: None, lambda: False,
            exclude={("https://p/first", "hierarchical")})
        self.assertIsNotNone(again)
        self.assertEqual(again.rs_base, "https://p/second")

    def test_hash_route_study_uid_is_found(self):
        cap = dcom_pipeline.ViewerCapture()
        self.assertEqual(
            dcom_pipeline._study_uid_candidates(
                cap, "https://p/#/viewer?StudyInstanceUIDs=1.2.3"),
            ["1.2.3"])

    def test_series_listing_carries_a_fingerprint_so_learning_applies(self):
        # Không có fingerprint thì `get_dicomweb_hint()` luôn tra khoá rỗng và
        # đường chọn series không hưởng được gì từ cái đã học.
        source = inspect.getsource(dcom_pipeline.discover_viewer_series)
        self.assertIn("strategy_fingerprint=compute_url_fingerprint(url)", source)


class RealBrowserDiscoveryJsTests(unittest.TestCase):
    """Chạy THẬT `_OHIF_CONFIG_JS` và `_DICOMWEB_PROBE_JS` trong Chromium.

    Các test trên đều giả lập `evaluate()`, nên chúng không hề thực thi hai đoạn
    JavaScript — mà đó lại là chỗ ở lỗi xác minh StudyUID và lỗi config dạng
    function. Lớp này bịt đúng khoảng trống đó.
    """

    @classmethod
    def setUpClass(cls):
        try:
            from playwright.sync_api import sync_playwright
        except Exception as exc:  # pragma: no cover
            raise unittest.SkipTest(f"Không có Playwright: {exc}")
        cls._pw = sync_playwright().start()
        try:
            cls._browser = cls._pw.chromium.launch(headless=True)
        except Exception as exc:  # pragma: no cover
            cls._pw.stop()
            raise unittest.SkipTest(f"Không mở được Chromium: {exc}")

    @classmethod
    def tearDownClass(cls):
        try:
            cls._browser.close()
        finally:
            cls._pw.stop()

    def _page(self, body=None, content_type="application/dicom+json", status=200):
        page = self._browser.new_page()
        self.addCleanup(page.close)
        if body is not None:
            page.route("**/*", lambda route: route.fulfill(
                status=status, content_type=content_type,
                body=body if isinstance(body, str) else json.dumps(body)))
        page.goto("https://pacs.test/viewer", wait_until="domcontentloaded")
        return page

    def _probe(self, page, url, study="1.2.3", require=True):
        return page.evaluate(dcom_pipeline._DICOMWEB_PROBE_JS, [
            [{"url": url, "studyUid": study, "requireStudyUid": require, "headers": {}}],
            3000, 5000,
        ])

    # --- xác minh StudyUID ---------------------------------------------------

    def test_toplevel_rejects_a_response_that_omits_the_study_uid(self):
        """Server phớt lờ filter và trả cả kho thì KHÔNG được nhận.

        Đây là lỗi an toàn bệnh nhân: nhận nhầm ở đây là tải ảnh của người khác.
        """
        page = self._page([{"0020000E": {"Value": ["series-cua-ca-khac"]}}])
        result = self._probe(page, "https://pacs.test/rs/series?StudyInstanceUID=1.2.3")
        self.assertIsNone(result["winner"])
        self.assertIn("0020000D", result["diagnostics"][0]["error"])

    def test_toplevel_accepts_when_every_series_proves_the_right_study(self):
        page = self._page([
            {"0020000E": {"Value": ["9.9"]}, "0020000D": {"Value": ["1.2.3"]}},
            {"0020000E": {"Value": ["8.8"]}, "0020000D": {"Value": ["1.2.3"]}},
        ])
        result = self._probe(page, "https://pacs.test/rs/series?StudyInstanceUID=1.2.3")
        self.assertIsNotNone(result["winner"])

    def test_a_single_foreign_series_rejects_the_whole_response(self):
        # Chỉ soi phần tử đầu là lọt ca lạ nằm ở cuối danh sách.
        page = self._page([
            {"0020000E": {"Value": ["9.9"]}, "0020000D": {"Value": ["1.2.3"]}},
            {"0020000E": {"Value": ["8.8"]}, "0020000D": {"Value": ["9.9.9"]}},
        ])
        result = self._probe(page, "https://pacs.test/rs/series?StudyInstanceUID=1.2.3")
        self.assertIsNone(result["winner"])
        self.assertIn("ca khác", result["diagnostics"][0]["error"])

    def test_hierarchical_may_omit_study_uid_because_the_path_pins_it(self):
        page = self._page([{"0020000E": {"Value": ["9.9"]}}])
        result = self._probe(
            page, "https://pacs.test/rs/studies/1.2.3/series", require=False)
        self.assertIsNotNone(result["winner"])

    def test_non_json_and_error_status_are_reported_not_accepted(self):
        page = self._page("<html>login</html>", content_type="text/html")
        result = self._probe(page, "https://pacs.test/rs/series?StudyInstanceUID=1.2.3")
        self.assertIsNone(result["winner"])
        self.assertIn("content-type", result["diagnostics"][0]["error"])

        page401 = self._page([], status=401)
        result401 = self._probe(page401, "https://pacs.test/rs/series?StudyInstanceUID=1.2.3")
        self.assertIsNone(result401["winner"])
        self.assertIn("401", result401["diagnostics"][0]["error"])

    def test_winner_carries_the_verified_body_back(self):
        payload = [{"0020000E": {"Value": ["9.9"]}, "0020000D": {"Value": ["1.2.3"]}}]
        page = self._page(payload)
        result = self._probe(page, "https://pacs.test/rs/series?StudyInstanceUID=1.2.3")
        self.assertEqual(json.loads(result["winner"]["body"]), payload)

    # --- đọc config OHIF -----------------------------------------------------

    def _config_roots(self, script):
        page = self._browser.new_page()
        self.addCleanup(page.close)
        page.route("**/*", lambda route: route.fulfill(
            status=200, content_type="text/html", body="<html><body></body></html>"))
        page.add_init_script(script)
        page.goto("https://pacs.test/viewer", wait_until="domcontentloaded")
        return page.evaluate(dcom_pipeline._OHIF_CONFIG_JS)

    def test_plain_object_config(self):
        roots = self._config_roots("""
            window.config = {
              defaultDataSourceName: 'dicomweb',
              dataSources: [
                { sourceName: 'other', configuration: { qidoRoot: 'https://p/other' } },
                { sourceName: 'dicomweb', configuration: {
                    qidoRoot: 'https://p/qido', wadoRoot: 'https://p/wado' } },
              ],
            };
        """)
        self.assertIn({"root": "https://p/qido", "preferred": True}, roots)
        self.assertIn({"root": "https://p/other", "preferred": False}, roots)

    def test_function_config_that_needs_services_manager(self):
        """Config dạng function của OHIF nhận `{ servicesManager }`.

        Gọi bằng `{}` thì nó ném lỗi và ta trả rỗng — đúng những triển khai
        dùng dạng này sẽ không bao giờ đọc được root.
        """
        roots = self._config_roots("""
            window.config = ({ servicesManager }) => {
              const s = servicesManager.services.UINotificationService;
              return {
                defaultDataSourceName: 'dw',
                dataSources: [{ sourceName: 'dw', configuration: {
                  qidoRoot: 'https://p/needs-services' } }],
              };
            };
        """)
        self.assertEqual(roots, [{"root": "https://p/needs-services", "preferred": True}])

    def test_config_without_default_name_treats_the_first_source_as_active(self):
        roots = self._config_roots("""
            window.config = { dataSources: [
              { sourceName: 'a', configuration: { qidoRoot: 'https://p/a' } },
              { sourceName: 'b', configuration: { qidoRoot: 'https://p/b' } },
            ] };
        """)
        self.assertEqual(roots[0], {"root": "https://p/a", "preferred": True})
        self.assertEqual(roots[1], {"root": "https://p/b", "preferred": False})

    def test_missing_or_broken_config_is_quiet(self):
        self.assertEqual(self._config_roots("window.config = undefined;"), [])
        self.assertEqual(self._config_roots("window.config = 'khong-phai-object';"), [])
        self.assertEqual(
            self._config_roots("window.config = () => { throw new Error('no'); };"), [])


class DicomWebStoreHintTests(unittest.TestCase):
    def setUp(self):
        self.path = Path(tempfile.mkdtemp()) / "strategies.json"
        self.store = dcom_pipeline.PacsStrategyStore(self.path)

    def test_resolved_base_round_trips(self):
        self.store.save_recipe(
            fingerprint="FP", adapter="DICOMweb", success=True,
            dicomweb_base="https://p/dicom-web", dicomweb_query_style="toplevel")
        self.assertEqual(
            self.store.get_dicomweb_hint("FP"), ("https://p/dicom-web", "toplevel"))

    def test_study_uid_is_never_persisted(self):
        # rs_base dùng lại được cho mọi ca cùng nơi; studyUID là dữ liệu bệnh
        # nhân và chỉ đúng một ca — không được nằm trong file nhớ chiến lược.
        self.store.save_recipe(
            fingerprint="FP", adapter="DICOMweb", success=True,
            dicomweb_base="https://p/dicom-web", dicomweb_query_style="hierarchical")
        self.assertNotIn("1.2.840.99999", self.path.read_text(encoding="utf-8"))

    def test_hint_withheld_when_failures_outweigh_successes(self):
        for _ in range(3):
            self.store.save_recipe(fingerprint="FP", adapter="DICOMweb", success=False)
        self.store.save_recipe(
            fingerprint="FP", adapter="DICOMweb", success=True,
            dicomweb_base="https://p/dicom-web")
        for _ in range(5):
            self.store.save_recipe(fingerprint="FP", adapter="DICOMweb", success=False)
        self.assertEqual(self.store.get_dicomweb_hint("FP"), ("", ""))

    def test_unknown_fingerprint_is_quiet(self):
        self.assertEqual(self.store.get_dicomweb_hint("chua-tung-thay"), ("", ""))


class TopLevelQidoDownloadTests(unittest.TestCase):
    """Bước tải phải nói đúng phương ngữ QIDO của server.

    Server chỉ hiểu truy vấn top-level mà bị hỏi theo dạng phân cấp thì trả rỗng
    — ca sẽ im lặng ra 0 ảnh chứ không báo lỗi, nên cần chốt bằng test.
    """

    @staticmethod
    def _tag(value):
        return {"Value": [value]}

    def test_search_is_toplevel_while_retrieve_stays_hierarchical(self):
        tag = self._tag
        requested: list[str] = []

        series = [{
            "0020000E": tag("9.9"), "00200011": tag(1),
            "0008103E": tag("AX"), "00080060": tag("CT"), "00201209": tag(1),
        }]
        instances = [{
            "0020000E": tag("9.9"), "00080018": tag("7.7"), "00280008": tag(1),
        }]

        class Response:
            def __init__(self, payload, content_type="application/dicom+json"):
                self.payload = payload if isinstance(payload, bytes) else json.dumps(payload).encode()
                self.headers = {"Content-Type": content_type}

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def read(self):
                return self.payload

        def fake_urlopen(request, **_kwargs):
            url = request.full_url
            requested.append(url)
            if url.startswith("https://p/rs/series?StudyInstanceUID=1.2.3"):
                return Response(series)
            if url.startswith("https://p/rs/instances?StudyInstanceUID=1.2.3"):
                return Response(instances)
            # Retrieve: trả một file DICOM tối thiểu để bước tải coi là xong.
            return Response(b"\x00" * 128 + b"DICM", "application/dicom")

        captured = {
            "qido_series": "https://p/rs/series?StudyInstanceUID=1.2.3",
            "dicomweb_profile": dcom_pipeline.DicomWebProfile(
                rs_base="https://p/rs", study_uid="1.2.3",
                query_style="toplevel", source="probe"),
            "api_headers": {}, "cookies": [], "wado_tmpl": None,
        }
        with patch_pacs_network(fake_urlopen):
            dcom_pipeline._download_via_dicomweb(
                captured, lambda _body: True, dcom_pipeline.DownloadStats(),
                lambda _message: None, lambda: False,
            )

        self.assertIn("https://p/rs/series?StudyInstanceUID=1.2.3", requested)
        self.assertTrue(any(
            u.startswith("https://p/rs/instances?StudyInstanceUID=1.2.3&SeriesInstanceUID=9.9")
            for u in requested), requested)
        # Không được hỏi theo dạng phân cấp khi server là top-level.
        self.assertFalse(any("/studies/1.2.3/series?" in u for u in requested), requested)
        self.assertFalse(any(u.endswith("/studies/1.2.3/series") for u in requested), requested)
        # Nhưng Retrieve thì vẫn phải phân cấp.
        self.assertTrue(any(
            "/studies/1.2.3/series/9.9/instances/7.7" in u for u in requested), requested)

    def test_missing_profile_and_unparseable_qido_bails_out_loudly(self):
        messages: list[str] = []
        dcom_pipeline._download_via_dicomweb(
            {"qido_series": "https://p/rs/series", "api_headers": {}, "cookies": []},
            lambda _body: True, dcom_pipeline.DownloadStats(),
            messages.append, lambda: False,
        )
        self.assertTrue(any("Không giải được đường vào DICOMweb" in m for m in messages))


if __name__ == "__main__":
    unittest.main()

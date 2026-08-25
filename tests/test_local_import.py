"""Reading a folder or a patient disc this app did not download.

A disc from another hospital arrives as extensionless files under `DICOM/`,
several exams deep, with a `DICOMDIR` index beside them. Converting that into
the archive has to keep two promises: every study stays separate, and the
patient identity written into `patient-index.json` comes from the DICOM tags
rather than from the folder name.
"""

from __future__ import annotations

import json
import tempfile
import time
import unittest
from pathlib import Path

import pydicom
from pydicom.dataset import FileDataset, FileMetaDataset
from pydicom.fileset import FileSet
from pydicom.uid import ExplicitVRLittleEndian, MRImageStorage, generate_uid

import dcom_pipeline
import dicom_io
from web_backend import WebController


def write_disc_image(
    path: Path,
    *,
    study_uid: str,
    series_uid: str,
    instance_number: int = 1,
    patient_id: str = "R0152082B",
    patient_name: str = "HOANG^MINH^THIEP",
    birth_date: str = "19751130",
    sex: str = "M",
    study_date: str = "20260727",
    study_description: str = "MRI Brain",
    accession: str = "NH6752070",
    modality: str = "MR",
    repetition_time: float | None = 2000.0,
    echo_time: float | None = 95.0,
) -> None:
    """One extensionless image, the way patient media stores them."""
    sop_uid = generate_uid()
    file_meta = FileMetaDataset()
    file_meta.MediaStorageSOPClassUID = MRImageStorage
    file_meta.MediaStorageSOPInstanceUID = sop_uid
    file_meta.TransferSyntaxUID = ExplicitVRLittleEndian
    file_meta.ImplementationClassUID = generate_uid()
    dataset = FileDataset(str(path), {}, file_meta=file_meta, preamble=b"\0" * 128)
    dataset.SOPClassUID = MRImageStorage
    dataset.SOPInstanceUID = sop_uid
    dataset.StudyInstanceUID = study_uid
    dataset.SeriesInstanceUID = series_uid
    dataset.PatientID = patient_id
    dataset.PatientName = patient_name
    dataset.PatientBirthDate = birth_date
    dataset.PatientSex = sex
    dataset.StudyDate = study_date
    # DICOMDIR study records require both, so patient media always carries them.
    dataset.StudyTime = "120000"
    dataset.StudyID = "1"
    dataset.StudyDescription = study_description
    dataset.AccessionNumber = accession
    dataset.Modality = modality
    dataset.SeriesNumber = 1
    dataset.SeriesDescription = "Ax T2 FLAIR"
    dataset.InstanceNumber = instance_number
    dataset.SliceThickness = 5.0
    if repetition_time is not None:
        dataset.RepetitionTime = repetition_time
    if echo_time is not None:
        dataset.EchoTime = echo_time
    dataset.Rows = 4
    dataset.Columns = 4
    dataset.SamplesPerPixel = 1
    dataset.PhotometricInterpretation = "MONOCHROME2"
    dataset.BitsAllocated = 16
    dataset.BitsStored = 12
    dataset.HighBit = 11
    dataset.PixelRepresentation = 0
    dataset.PixelData = (b"\x00\x08" * 16)
    path.parent.mkdir(parents=True, exist_ok=True)
    dataset.save_as(str(path), enforce_file_format=True)


def build_disc(root: Path, *, studies: int = 2, with_index: bool = True) -> list[str]:
    """Patient media: extensionless images plus, optionally, a `DICOMDIR` index.

    With an index the layout is the one `pydicom` writes for portable media;
    without one the same images sit under a plain `DICOM/` tree, which is what
    a folder copied off a disc by hand looks like.
    """
    uids = []
    staging = root / "_staging"
    for study in range(1, studies + 1):
        study_uid = generate_uid()
        series_uid = generate_uid()
        uids.append(study_uid)
        for instance in range(1, 3):
            write_disc_image(
                staging / f"{study:08d}" / f"{instance:08d}",
                study_uid=study_uid,
                series_uid=series_uid,
                instance_number=instance,
                study_date=f"2026072{study}",
                study_description=f"MRI Brain {study}",
                accession=f"NH000000{study}",
            )

    staged = sorted(path for path in staging.rglob("*") if path.is_file())
    if with_index:
        file_set = FileSet()
        for path in staged:
            file_set.add(pydicom.dcmread(str(path)))
        file_set.write(str(root))
    else:
        for index, path in enumerate(staged, start=1):
            target = root / "DICOM" / f"{index:08d}"
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(path.read_bytes())
    for path in staged:
        path.unlink()
    for folder in sorted(staging.rglob("*"), reverse=True):
        if folder.is_dir():
            folder.rmdir()
    staging.rmdir()
    return uids


class DiscoveryTests(unittest.TestCase):
    def test_extensionless_images_are_found_with_and_without_an_index(self):
        """The index only makes the scan cheaper; it never decides the file list."""
        for with_index in (True, False):
            with self.subTest(with_index=with_index), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                build_disc(root, studies=2, with_index=with_index)
                found = dicom_io.discover_dicom_files(root)
                self.assertEqual(len(found), 4)

    def test_dicomdir_itself_is_never_offered_as_an_image(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            build_disc(root, studies=1)
            found = dicom_io.discover_dicom_files(root)
            self.assertTrue(found)
            self.assertNotIn("DICOMDIR", {path.name.upper() for path in found})

    def test_an_index_listing_a_missing_file_does_not_invent_it(self):
        """A stale index must slow the scan down, never add a file that is gone."""
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            build_disc(root, studies=1)
            images = dicom_io.discover_dicom_files(root)
            self.assertEqual(len(images), 2)
            images[-1].unlink()
            self.assertEqual(len(dicom_io.discover_dicom_files(root)), 1)


class AcquisitionParameterTests(unittest.TestCase):
    def test_mr_reports_tr_te_and_slice_thickness(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "image"
            write_disc_image(path, study_uid=generate_uid(), series_uid=generate_uid())
            dataset = pydicom.dcmread(str(path))
            values = dicom_io.acquisition_parameters(dataset, "MR")
            self.assertEqual(values["repetitionTime"], 2000.0)
            self.assertEqual(values["echoTime"], 95.0)
            self.assertEqual(values["sliceThickness"], 5.0)
            self.assertEqual(values["accessionNumber"], "NH6752070")

    def test_a_parameter_the_file_lacks_is_absent_rather_than_zero(self):
        """A missing TR must read as missing. Zero is a value a reader would trust."""
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "image"
            write_disc_image(
                path,
                study_uid=generate_uid(),
                series_uid=generate_uid(),
                repetition_time=None,
                echo_time=None,
            )
            values = dicom_io.acquisition_parameters(pydicom.dcmread(str(path)), "MR")
            self.assertNotIn("repetitionTime", values)
            self.assertNotIn("echoTime", values)

    def test_kvp_and_mas_are_only_offered_for_the_modalities_that_record_them(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "image"
            write_disc_image(path, study_uid=generate_uid(), series_uid=generate_uid())
            dataset = pydicom.dcmread(str(path))
            self.assertNotIn("kvp", dicom_io.acquisition_parameters(dataset, "MR"))
            dataset.KVP = 70.0
            dataset.Exposure = 4
            self.assertEqual(dicom_io.acquisition_parameters(dataset, "DX")["kvp"], 70.0)


class StudyIndexTests(unittest.TestCase):
    def test_a_disc_of_several_exams_is_grouped_by_study_instance_uid(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            expected = build_disc(root, studies=3)
            groups = dcom_pipeline.index_local_dicom_studies(root, log=lambda _msg: None)
            self.assertEqual(len(groups), 3)
            self.assertEqual({group.study_uid for group in groups}, set(expected))
            self.assertEqual([len(group.files) for group in groups], [2, 2, 2])
            self.assertEqual(groups[0].modality, "MR")
            self.assertTrue(groups[0].accession_number)

    def test_every_study_keeps_its_own_folder_name(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            build_disc(root, studies=2)
            groups = dcom_pipeline.index_local_dicom_studies(root, log=lambda _msg: None)
            names = {dcom_pipeline.study_folder_base_name(g.as_study()) for g in groups}
            self.assertEqual(len(names), 2)
            self.assertTrue(all(name.startswith("2026-07-2") for name in names))

    def test_identity_is_read_from_the_tags(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            build_disc(root, studies=2)
            groups = dcom_pipeline.index_local_dicom_studies(root, log=lambda _msg: None)
            identity = dcom_pipeline.local_import_identity(groups)
            self.assertEqual(identity["patient_id"], "R0152082B")
            self.assertEqual(identity["patient_birth_date"], "1975-11-30")
            self.assertEqual(identity["patient_sex"], "M")

    def test_the_hospital_comes_from_the_institution_tag(self):
        """A disc has no RIS key, so InstitutionName is the only truthful source."""
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            path = root / "DICOM" / "a"
            write_disc_image(path, study_uid=generate_uid(), series_uid=generate_uid())
            dataset = pydicom.dcmread(str(path))
            dataset.InstitutionName = "National University Hospital"
            dataset.save_as(str(path), enforce_file_format=True)

            groups = dcom_pipeline.index_local_dicom_studies(root, log=lambda _msg: None)
            identity = dcom_pipeline.local_import_identity(groups)
            self.assertEqual(identity["institution"], "National University Hospital")

            patient = root / "archive"
            patient.mkdir()
            dcom_pipeline.write_local_import_manifest(
                patient, identity, log=lambda _msg: None,
            )
            manifest = json.loads((patient / "patient-index.json").read_text(encoding="utf-8"))
            self.assertEqual(manifest["hospitalName"], "National University Hospital")
            self.assertEqual(manifest["hospitalKey"], "local")

    def test_a_file_with_no_institution_leaves_the_hospital_empty(self):
        """Better an empty hospital column than a stand-in nobody recorded."""
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            write_disc_image(
                root / "DICOM" / "a",
                study_uid=generate_uid(),
                series_uid=generate_uid(),
            )
            groups = dcom_pipeline.index_local_dicom_studies(root, log=lambda _msg: None)
            self.assertEqual(dcom_pipeline.local_import_identity(groups)["institution"], "")

    def test_two_patients_in_one_folder_produce_no_identity(self):
        """Filing both under one record would merge two people's images."""
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            write_disc_image(
                root / "DICOM" / "a", study_uid=generate_uid(), series_uid=generate_uid(),
            )
            write_disc_image(
                root / "DICOM" / "b",
                study_uid=generate_uid(),
                series_uid=generate_uid(),
                patient_id="OTHER-1",
                patient_name="TRAN^THI^B",
            )
            groups = dcom_pipeline.index_local_dicom_studies(root, log=lambda _msg: None)
            self.assertIsNone(dcom_pipeline.local_import_identity(groups))

    def test_images_with_no_patient_id_produce_no_identity(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            write_disc_image(
                root / "DICOM" / "a",
                study_uid=generate_uid(),
                series_uid=generate_uid(),
                patient_id="",
            )
            groups = dcom_pipeline.index_local_dicom_studies(root, log=lambda _msg: None)
            self.assertIsNone(dcom_pipeline.local_import_identity(groups))


class LocalManifestTests(unittest.TestCase):
    IDENTITY = {
        "patient_id": "R0152082B",
        "patient_name": "HOANG MINH THIEP",
        "patient_birth_date": "1975-11-30",
        "patient_sex": "M",
    }

    def test_the_folder_gains_an_index_without_being_moved(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp) / "disc"
            folder.mkdir()
            dcom_pipeline.write_local_import_manifest(
                folder, self.IDENTITY, log=lambda _msg: None,
            )
            manifest = json.loads((folder / "patient-index.json").read_text(encoding="utf-8"))
            self.assertEqual(manifest["format"], dcom_pipeline.PATIENT_MANIFEST_FORMAT)
            self.assertEqual(manifest["patientId"], "R0152082B")
            self.assertEqual(manifest["patientSex"], "M")
            self.assertEqual(manifest["hospitalKey"], dcom_pipeline.LOCAL_IMPORT_HOSPITAL_KEY)
            self.assertEqual(manifest["studies"], {})
            self.assertTrue(folder.is_dir())

    def test_a_folder_belonging_to_another_patient_is_refused(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp) / "disc"
            folder.mkdir()
            dcom_pipeline.write_local_import_manifest(
                folder, self.IDENTITY, log=lambda _msg: None,
            )
            with self.assertRaises(dcom_pipeline.PatientIdentityConflictError):
                dcom_pipeline.write_local_import_manifest(
                    folder,
                    {**self.IDENTITY, "patient_id": "SOMEONE-ELSE"},
                    log=lambda _msg: None,
                )

    def test_a_name_that_disagrees_with_the_stored_one_is_refused(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp) / "disc"
            folder.mkdir()
            dcom_pipeline.write_local_import_manifest(
                folder, self.IDENTITY, log=lambda _msg: None,
            )
            with self.assertRaises(dcom_pipeline.PatientIdentityConflictError):
                dcom_pipeline.write_local_import_manifest(
                    folder,
                    {**self.IDENTITY, "patient_name": "TRAN THI B"},
                    log=lambda _msg: None,
                )


class ReadStateTests(unittest.TestCase):
    def _archive(self, root: Path) -> Path:
        patient = root / "patient"
        study = patient / "2026-07-27 - MR - MRI Brain"
        study.mkdir(parents=True)
        dcom_pipeline.write_local_import_manifest(
            patient,
            {
                "patient_id": "BN-1",
                "patient_name": "NGUYEN VAN A",
                "patient_birth_date": "",
                "patient_sex": "",
            },
            log=lambda _msg: None,
        )
        dcom_pipeline.record_patient_study(
            patient,
            {"study_uid": "1.2.3", "date": "2026-07-27", "modality": "MR", "desc": "MRI Brain"},
            study,
            complete=True,
            image_count=2,
        )
        return study

    def test_marking_read_and_unread_survives_in_the_patient_index(self):
        with tempfile.TemporaryDirectory() as tmp:
            study = self._archive(Path(tmp))
            marked = dcom_pipeline.set_study_read_state(study, True)
            self.assertTrue(marked["isRead"])
            manifest = json.loads(
                (study.parent / "patient-index.json").read_text(encoding="utf-8"),
            )
            self.assertTrue(manifest["studies"]["1.2.3"]["readAt"])

            cleared = dcom_pipeline.set_study_read_state(study, False)
            self.assertFalse(cleared["isRead"])
            manifest = json.loads(
                (study.parent / "patient-index.json").read_text(encoding="utf-8"),
            )
            self.assertEqual(manifest["studies"]["1.2.3"]["readAt"], "")

    def test_the_manifest_keeps_its_shape(self):
        """Only `readAt` is added; `studies` stays a dict keyed by study UID."""
        with tempfile.TemporaryDirectory() as tmp:
            study = self._archive(Path(tmp))
            dcom_pipeline.set_study_read_state(study, True)
            manifest = json.loads(
                (study.parent / "patient-index.json").read_text(encoding="utf-8"),
            )
            self.assertEqual(manifest["format"], "dcom-patient-index-v1")
            self.assertIsInstance(manifest["studies"], dict)
            self.assertIn("1.2.3", manifest["studies"])

    def test_a_folder_no_index_describes_cannot_be_marked(self):
        """The mark would have nowhere to live and would vanish on the next scan."""
        with tempfile.TemporaryDirectory() as tmp:
            orphan = Path(tmp) / "loose"
            orphan.mkdir()
            with self.assertRaises(ValueError):
                dcom_pipeline.set_study_read_state(orphan, True)


class ImportJobTests(unittest.TestCase):
    """The whole import, as the Activity queue runs it."""

    @staticmethod
    def _run(controller, source: Path) -> dict:
        controller.start_local_dicom_import(str(source), {"quality": 90})
        deadline = time.time() + 60
        while controller.job.snapshot()["status"] == "running" and time.time() < deadline:
            time.sleep(0.02)
        return controller.job.snapshot()

    def test_a_disc_of_two_exams_becomes_two_study_folders_and_one_archive(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "disc"
            source.mkdir()
            build_disc(source, studies=2)

            controller = WebController()
            controller.output_root = root / "output"
            finished = self._run(controller, source)
            self.assertEqual("complete", finished["status"], finished["logs"])

            manifest_path = source / "patient-index.json"
            self.assertTrue(manifest_path.is_file())
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            self.assertEqual(manifest["patientId"], "R0152082B")
            self.assertEqual(manifest["patientName"], "HOANG MINH THIEP")
            self.assertEqual(manifest["patientBirthDate"], "1975-11-30")
            self.assertEqual(manifest["patientSex"], "M")
            self.assertEqual(len(manifest["studies"]), 2)

            for record in manifest["studies"].values():
                self.assertEqual(record["downloadType"], "local")
                self.assertTrue(record["accessionNumber"])
                study_folder = source / record["folder"]
                self.assertTrue((study_folder / "JPG").is_dir())
                # Each study keeps its own images: mixing them would put two
                # exams behind one date on the timeline.
                self.assertTrue(any((study_folder / "JPG").glob("**/*.jpg")))

            self.assertEqual(finished["result"]["indexedStudies"], 2)

    def test_the_original_dicom_is_left_where_it_was(self):
        """The disc is the master copy; the import must not move or delete it."""
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "disc"
            source.mkdir()
            build_disc(source, studies=2)
            before = {
                str(path.relative_to(source))
                for path in dicom_io.discover_dicom_files(source)
            }

            controller = WebController()
            controller.output_root = root / "output"
            self._run(controller, source)

            after = {
                str(path.relative_to(source))
                for path in dicom_io.discover_dicom_files(source)
            }
            self.assertTrue(before.issubset(after))

    def test_a_folder_naming_two_patients_is_converted_but_not_indexed(self):
        """Converting is safe; filing both under one identity is not."""
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "mixed"
            write_disc_image(
                source / "DICOM" / "a",
                study_uid=generate_uid(),
                series_uid=generate_uid(),
            )
            write_disc_image(
                source / "DICOM" / "b",
                study_uid=generate_uid(),
                series_uid=generate_uid(),
                patient_id="OTHER-1",
                patient_name="TRAN^THI^B",
                study_date="20260801",
                study_description="CT Brain",
            )

            controller = WebController()
            controller.output_root = root / "output"
            finished = self._run(controller, source)

            self.assertEqual("complete", finished["status"], finished["logs"])
            self.assertGreater(finished["result"]["converted"], 0)
            self.assertEqual(finished["result"]["indexedStudies"], 0)
            self.assertFalse((source / "patient-index.json").exists())

    def test_a_single_study_folder_still_converts_beside_its_dicom(self):
        """The everyday shape must not change: `<study>/DICOM` -> `<study>/JPG`."""
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            study = root / "2026-07-27 - MR - MRI Brain"
            write_disc_image(
                study / "DICOM" / "000001",
                study_uid=generate_uid(),
                series_uid=generate_uid(),
            )

            controller = WebController()
            controller.output_root = root / "output"
            finished = self._run(controller, study)

            self.assertEqual("complete", finished["status"], finished["logs"])
            self.assertTrue((study / "JPG").is_dir())
            self.assertTrue(any((study / "JPG").glob("**/*.jpg")))
            # The folder the reader pointed at becomes the archive, so the
            # study record is the folder itself.
            manifest = json.loads((study / "patient-index.json").read_text(encoding="utf-8"))
            self.assertEqual(len(manifest["studies"]), 1)
            self.assertEqual(next(iter(manifest["studies"].values()))["folder"], ".")

    def test_the_converted_jpg_keeps_the_acquisition_parameters(self):
        """JPG is the long-term store here, so TR/TE must survive the conversion."""
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            study = root / "2026-07-27 - MR - MRI Brain"
            write_disc_image(
                study / "DICOM" / "000001",
                study_uid=generate_uid(),
                series_uid=generate_uid(),
            )

            controller = WebController()
            controller.output_root = root / "output"
            self._run(controller, study)

            manifests = list((study / "JPG").glob("**/mpr-volume.json"))
            self.assertTrue(manifests)
            acquisition = json.loads(manifests[0].read_text(encoding="utf-8"))["acquisition"]
            self.assertEqual(acquisition["repetitionTime"], 2000.0)
            self.assertEqual(acquisition["echoTime"], 95.0)
            self.assertEqual(acquisition["sliceThickness"], 5.0)


if __name__ == "__main__":
    unittest.main()

"""The clinical record, and the stage worked out from it.

Two things are being defended here.

The first is that the record is kept apart from `patient-index.json`. The
manifest is what the download pipeline read off the DICOM tags, and the
pipeline rewrites it; a diagnosis typed by a doctor must not be able to be
erased by a rerun of a download.

The second is that the treatment stage is never stored. "Đang xạ" typed as a
snapshot is true on the day it is written and quietly wrong for months
afterwards. Derived from an event with no end date, it stops being asserted the
moment somebody closes the event — and when a course has visibly outrun the
length it gave for itself, the record says it is out of date rather than going
on claiming a treatment that may have finished.
"""

import datetime
import json
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import clinical_record
import dcom_pipeline
import web_backend


TODAY = datetime.date(2026, 9, 15)


def _record(**parts) -> dict:
    return clinical_record.normalise(parts)


class VocabularyTests(unittest.TestCase):
    def test_the_form_lists_are_served_rather_than_duplicated(self):
        """One list, read by the web UI over the API.

        Two copies of a controlled vocabulary are two vocabularies as soon as
        one of them is edited.
        """
        lists = clinical_record.vocabulary()
        self.assertIn("Nội sọ", lists["compartments"])
        self.assertIn("Tuỷ sống", lists["compartments"])
        self.assertIn("U màng não", lists["histologies"])
        self.assertIn("Xạ", lists["eventKinds"])

    def test_brain_and_spine_do_not_share_one_location_list(self):
        """A spinal level has no business in a dropdown for a brain tumour."""
        brain = clinical_record.vocabulary()["locations"]["Nội sọ"]
        spine = clinical_record.vocabulary()["locations"]["Tuỷ sống"]
        self.assertIn("Góc cầu tiểu não", brain)
        self.assertNotIn("Góc cầu tiểu não", spine)
        self.assertIn("Nón tuỷ", spine)
        self.assertNotIn("Nón tuỷ", brain)

    def test_the_axis_asked_about_depends_on_the_compartment(self):
        axes = clinical_record.vocabulary()["axes"]
        self.assertEqual(axes["Nội sọ"], ["Trong trục", "Ngoài trục"])
        self.assertIn("Nội tuỷ", axes["Tuỷ sống"])


class NormalisationTests(unittest.TestCase):
    def test_a_typed_histology_outside_the_list_is_kept(self):
        """The list covers most of a worklist, never all of it.

        A form that refuses the real answer gets a wrong one instead.
        """
        record = _record(tumors=[{
            "compartment": "Nội sọ",
            "histology": "U tế bào hình sao toả lan kiểu hiếm gặp, chưa phân loại",
        }])
        self.assertEqual(
            record["tumors"][0]["histology"],
            "U tế bào hình sao toả lan kiểu hiếm gặp, chưa phân loại",
        )

    def test_a_half_typed_date_is_dropped_rather_than_stored(self):
        """A date that is not a date would sort an event into the wrong place
        on the timeline the stage is read off."""
        record = _record(events=[{"kind": "Mổ", "start": "2026-1", "end": "2026-07-10"}])
        self.assertEqual(record["events"][0]["start"], "")
        self.assertEqual(record["events"][0]["end"], "2026-07-10")

    def test_an_empty_tumour_row_is_not_saved(self):
        record = _record(tumors=[{"side": "P"}, {"compartment": "Nội sọ"}])
        self.assertEqual(len(record["tumors"]), 1)

    def test_an_event_with_no_recognised_kind_is_dropped(self):
        record = _record(events=[{"kind": "Ăn tối", "start": "2026-07-10"}])
        self.assertEqual(record["events"], [])

    def test_a_grade_outside_who_is_refused(self):
        """Grades run 1 to 4. Anything else is a typo, and a typo displayed as
        a grade is read as a grade."""
        self.assertEqual(_record(tumors=[{"histology": "U màng não", "grade": "7"}])["tumors"][0]["grade"], "")
        self.assertEqual(_record(tumors=[{"histology": "U màng não", "grade": "2"}])["tumors"][0]["grade"], "2")

    def test_events_come_back_newest_first(self):
        record = _record(events=[
            {"kind": "Mổ", "start": "2026-07-10"},
            {"kind": "Xạ", "start": "2026-08-20"},
        ])
        self.assertEqual([e["kind"] for e in record["events"]], ["Xạ", "Mổ"])


class DiagnosisLabelTests(unittest.TestCase):
    def test_histology_grade_and_site_read_in_the_order_a_case_is_spoken(self):
        record = _record(tumors=[{
            "compartment": "Nội sọ", "location": "Thuỳ chẩm", "side": "P",
            "histology": "U nguyên bào thần kinh đệm, IDH tự nhiên", "grade": "4",
        }])
        self.assertEqual(
            clinical_record.diagnosis_label(record),
            "U nguyên bào thần kinh đệm, IDH tự nhiên (độ 4) · Thuỳ chẩm P",
        )

    def test_what_is_unknown_simply_drops_out(self):
        record = _record(tumors=[{"compartment": "Nội sọ", "location": "Thuỳ trán"}])
        self.assertEqual(clinical_record.diagnosis_label(record), "Thuỳ trán")

    def test_two_tumours_are_both_named(self):
        record = _record(tumors=[
            {"histology": "U thần kinh đệm não thất III"},
            {"histology": "U sọ hầu"},
        ])
        self.assertEqual(
            clinical_record.diagnosis_label(record),
            "U thần kinh đệm não thất III # U sọ hầu",
        )

    def test_no_record_is_no_label(self):
        self.assertEqual(clinical_record.diagnosis_label(None), "")
        self.assertEqual(clinical_record.diagnosis_label(clinical_record.empty_record()), "")


class TreatmentStageTests(unittest.TestCase):
    def test_nothing_recorded_stays_unknown(self):
        """A patient with no events is not "chờ mổ" and not "theo dõi".

        Nobody has said, and a stage that guesses reads as a plan that exists.
        """
        stage = clinical_record.treatment_stage(clinical_record.empty_record(), TODAY)
        self.assertEqual(stage["state"], "unknown")
        self.assertEqual(stage["kinds"], [])

    def test_an_open_course_is_the_current_treatment(self):
        record = _record(events=[{
            "kind": "Xạ", "start": "2026-08-20", "where": "BV K Tân Triều",
            "fractions": 30,
        }])
        stage = clinical_record.treatment_stage(record, TODAY)
        self.assertEqual(stage["state"], "active")
        self.assertEqual(stage["kinds"], ["Xạ"])
        self.assertEqual(stage["where"], "BV K Tân Triều")

    def test_closing_the_course_ends_the_claim_that_it_is_running(self):
        record = _record(events=[{
            "kind": "Xạ", "start": "2026-08-20", "end": "2026-09-10",
            "where": "BV K Tân Triều",
        }])
        self.assertEqual(clinical_record.treatment_stage(record, TODAY)["state"], "followup")

    def test_concurrent_chemoradiotherapy_reports_both(self):
        """Two open courses at once is the Stupp protocol, not a data error."""
        record = _record(events=[
            {"kind": "Xạ", "start": "2026-08-20", "where": "BV K Tân Triều"},
            {"kind": "Hoá", "start": "2026-08-20", "regimen": "Temozolomide đồng thời"},
        ])
        self.assertEqual(clinical_record.treatment_stage(record, TODAY)["kinds"], ["Xạ", "Hoá"])

    def test_a_course_that_has_outrun_its_own_length_is_marked_out_of_date(self):
        """Thirty fractions take six weeks, not four months.

        The alternative is a row that goes on saying "đang xạ" for as long as
        nobody reopens the record.
        """
        record = _record(events=[{"kind": "Xạ", "start": "2026-08-20", "fractions": 30}])
        fresh = clinical_record.treatment_stage(record, datetime.date(2026, 9, 15))
        overdue = clinical_record.treatment_stage(record, datetime.date(2026, 12, 30))
        self.assertFalse(fresh["stale"])
        self.assertTrue(overdue["stale"])
        self.assertEqual(overdue["state"], "active")

    def test_a_chemo_course_is_never_called_out_of_date(self):
        """Cycle length varies by regimen, so an expected end would be a guess,
        and a "stale" warning built on a guess is itself wrong."""
        record = _record(events=[{"kind": "Hoá", "start": "2026-01-05", "cycles": 6}])
        self.assertFalse(clinical_record.treatment_stage(record, TODAY)["stale"])

    def test_a_course_starting_tomorrow_is_not_running_today(self):
        record = _record(events=[{"kind": "Xạ", "start": "2026-10-01"}])
        self.assertEqual(clinical_record.treatment_stage(record, TODAY)["state"], "followup")

    def test_a_recent_operation_reads_as_post_operative(self):
        record = _record(events=[{
            "kind": "Mổ", "start": "2026-09-01", "end": "2026-09-01",
            "where": "BV Việt Đức", "extent": "Lấy toàn bộ",
        }])
        stage = clinical_record.treatment_stage(record, TODAY)
        self.assertEqual(stage["state"], "post-op")
        self.assertEqual(stage["where"], "BV Việt Đức")

    def test_an_old_operation_is_follow_up_rather_than_post_operative(self):
        record = _record(events=[{"kind": "Mổ", "start": "2026-05-01", "end": "2026-05-01"}])
        self.assertEqual(clinical_record.treatment_stage(record, TODAY)["state"], "followup")

    def test_a_recorded_relapse_outranks_everything_before_it(self):
        record = _record(events=[
            {"kind": "Mổ", "start": "2026-07-10", "end": "2026-07-10"},
            {"kind": "Xạ", "start": "2026-08-01", "end": "2026-09-01"},
            {"kind": "Tái phát/Tiến triển", "start": "2026-09-12"},
        ])
        self.assertEqual(clinical_record.treatment_stage(record, TODAY)["state"], "relapse")


class StorageTests(unittest.TestCase):
    def test_a_round_trip_keeps_what_was_entered(self):
        with TemporaryDirectory() as tmp:
            folder = Path(tmp)
            clinical_record.write_record(folder, {
                "patientId": "2607009886",
                "tumors": [{
                    "compartment": "Nội sọ", "location": "Thuỳ chẩm", "side": "P",
                    "histology": "U nguyên bào thần kinh đệm, IDH tự nhiên",
                    "grade": "4", "basis": "Mô bệnh học", "confirmedAt": "2026-07-14",
                    "molecular": {"MGMT": "methyl hoá"},
                }],
                "events": [{"kind": "Xạ", "start": "2026-08-20", "fractions": 30}],
            })
            read = clinical_record.read_record(folder)
            self.assertEqual(read["patientId"], "2607009886")
            self.assertEqual(read["tumors"][0]["molecular"], {"MGMT": "methyl hoá"})
            self.assertEqual(read["events"][0]["fractions"], 30)

    def test_the_record_lives_beside_the_manifest_and_not_inside_it(self):
        """The pipeline owns patient-index.json. A rerun of a download must not
        be able to wipe what a doctor typed."""
        with TemporaryDirectory() as tmp:
            folder = Path(tmp)
            manifest = {
                "format": dcom_pipeline.PATIENT_MANIFEST_FORMAT,
                "patientId": "2607009886", "patientName": "NGUYEN VAN A",
                "studies": {},
            }
            (folder / dcom_pipeline.PATIENT_MANIFEST_NAME).write_text(
                json.dumps(manifest), encoding="utf-8")

            clinical_record.write_record(folder, {"tumors": [{"histology": "U màng não"}]})

            self.assertTrue((folder / "clinical-index.json").is_file())
            after = json.loads(
                (folder / dcom_pipeline.PATIENT_MANIFEST_NAME).read_text(encoding="utf-8"))
            self.assertEqual(after, manifest)

    def test_a_patient_with_no_record_reads_as_absent_not_as_an_error(self):
        with TemporaryDirectory() as tmp:
            self.assertIsNone(clinical_record.read_record(Path(tmp)))

    def test_a_file_of_the_wrong_format_is_refused(self):
        """A file that is not this format is left alone rather than parsed as
        best it can be: the wrong half of a clinical record is worse than none.
        """
        with TemporaryDirectory() as tmp:
            folder = Path(tmp)
            (folder / "clinical-index.json").write_text(
                json.dumps({"format": "something-else", "tumors": [{"histology": "X"}]}),
                encoding="utf-8")
            self.assertIsNone(clinical_record.read_record(folder))

    def test_unreadable_json_does_not_raise_over_a_patients_images(self):
        with TemporaryDirectory() as tmp:
            folder = Path(tmp)
            (folder / "clinical-index.json").write_text("{ not json", encoding="utf-8")
            self.assertIsNone(clinical_record.read_record(folder))


class WorklistIntegrationTests(unittest.TestCase):
    """What the scan hands to a worklist row."""

    def _archive(self, tmp: str) -> Path:
        folder = Path(tmp) / "2607009886-NGUYEN VAN A-58T-GBM cham phai"
        folder.mkdir(parents=True)
        (folder / dcom_pipeline.PATIENT_MANIFEST_NAME).write_text(json.dumps({
            "format": dcom_pipeline.PATIENT_MANIFEST_FORMAT,
            "patientId": "2607009886",
            "patientName": "NGUYEN VAN A",
            "diagnosis": "ghi chu tu do",
            "studies": {},
        }, ensure_ascii=False), encoding="utf-8")
        return folder

    def test_a_structured_record_outranks_the_note_and_the_folder_name(self):
        scanner = web_backend.WorklistScanner.__new__(web_backend.WorklistScanner)
        with TemporaryDirectory() as tmp:
            folder = self._archive(tmp)
            self.assertEqual(scanner._patient_meta_for(folder)["diagnosisSource"], "manifest")

            clinical_record.write_record(folder, {"tumors": [{
                "compartment": "Nội sọ", "location": "Thuỳ chẩm", "side": "P",
                "histology": "U nguyên bào thần kinh đệm, IDH tự nhiên", "grade": "4",
            }]})

            meta = scanner._patient_meta_for(folder)
            self.assertEqual(meta["diagnosisSource"], "clinical")
            self.assertEqual(
                meta["diagnosis"],
                "U nguyên bào thần kinh đệm, IDH tự nhiên (độ 4) · Thuỳ chẩm P",
            )

    def test_the_row_carries_a_stage_worked_out_at_scan_time(self):
        scanner = web_backend.WorklistScanner.__new__(web_backend.WorklistScanner)
        with TemporaryDirectory() as tmp:
            folder = self._archive(tmp)
            clinical_record.write_record(folder, {"events": [
                {"kind": "Xạ", "start": "2020-01-06", "where": "BV K Tân Triều"},
            ]})
            stage = scanner._patient_meta_for(folder)["treatmentStage"]
            self.assertEqual(stage["state"], "active")
            self.assertEqual(stage["where"], "BV K Tân Triều")

    def test_a_patient_with_no_record_carries_a_blank_stage(self):
        scanner = web_backend.WorklistScanner.__new__(web_backend.WorklistScanner)
        with TemporaryDirectory() as tmp:
            meta = scanner._patient_meta_for(self._archive(tmp))
            self.assertEqual(meta["treatmentStage"]["state"], "unknown")
            self.assertFalse(meta["hasClinicalRecord"])


class ReadingWithoutAManifestTests(unittest.TestCase):
    """Opening a folder that cannot hold a record is not an error.

    The browser smoke test caught this: every record opened without a
    `patient-index.json` — a folder of operative photos, a study imported
    before manifests existed — answered 400, and the console filled with
    failed requests behind the images. Reading is forgiving; only writing is
    strict.
    """

    def _opened(self, folder: Path) -> web_backend.WebController:
        """A controller with `folder` as the record on screen.

        The catalog root is one of the places a write is allowed to land, so
        setting it puts the folder in scope and leaves the missing manifest as
        the only thing standing in the way — which is what is under test.
        """
        controller = web_backend.WebController()
        controller.catalog.root = folder
        return controller

    def test_a_folder_with_no_manifest_reads_as_empty_and_not_writable(self):
        with TemporaryDirectory() as tmp:
            folder = Path(tmp) / "anh mo"
            folder.mkdir()
            result = self._opened(folder).patient_clinical(archive_root=str(folder))

            self.assertEqual(result["record"]["tumors"], [])
            self.assertEqual(result["stage"]["state"], "unknown")
            self.assertFalse(result["canWrite"])
            self.assertIn("patient-index.json", result["reason"])

    def test_a_folder_outside_the_allowed_roots_reads_as_empty_too(self):
        """Refused for a different reason, reported the same way.

        Either way the answer is an empty card, not a failed request behind a
        patient's images.
        """
        controller = web_backend.WebController()
        with TemporaryDirectory() as tmp:
            result = controller.patient_clinical(archive_root=tmp)
            self.assertFalse(result["canWrite"])
            self.assertTrue(result["reason"])

    def test_writing_to_such_a_folder_is_still_refused(self):
        with TemporaryDirectory() as tmp:
            folder = Path(tmp) / "anh mo"
            folder.mkdir()
            with self.assertRaises(ValueError):
                self._opened(folder).set_patient_clinical(
                    {"tumors": [{"histology": "U màng não"}]},
                    archive_root=str(folder),
                )
            self.assertFalse((folder / "clinical-index.json").exists())


if __name__ == "__main__":
    unittest.main()

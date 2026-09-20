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
import re
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import clinical_record
import dcom_pipeline
import neuro_oncology
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

    def test_each_entity_is_filed_under_exactly_one_family(self):
        """The flat list and the grouped one are the same list.

        `HISTOLOGIES` is derived from `HISTOLOGY_GROUPS`, so the only way they
        can disagree is an entity written into two families — which would put
        it in the dropdown twice and leave the reader choosing between two
        spellings of one diagnosis.
        """
        groups = clinical_record.HISTOLOGY_GROUPS
        flat = [name for entities in groups.values() for name in entities]
        self.assertEqual(sorted(flat), sorted(set(flat)))
        self.assertEqual(list(clinical_record.HISTOLOGIES), flat)

        index = clinical_record.vocabulary()["histologyGroups"]
        self.assertEqual(sorted(index), sorted(flat))
        self.assertEqual(index["U màng não"], "U màng não và u trung mô")
        self.assertEqual(index["U nguyên bào thần kinh đệm, IDH tự nhiên"], "U thần kinh đệm")

    def test_a_grade_is_offered_only_where_the_entity_can_carry_it(self):
        """WHO CNS5 grades the entity, not the tumour on its own.

        A glioblastoma, IDH-wildtype is grade 4 by definition and an
        oligodendroglioma is 2 or 3 and never 4, so a form offering all four
        against either of them is offering a diagnosis that does not exist.
        """
        table = clinical_record.GRADES_BY_HISTOLOGY
        self.assertEqual(table["U nguyên bào thần kinh đệm, IDH tự nhiên"], ("4",))
        self.assertEqual(table["U sao bào, IDH đột biến"], ("2", "3", "4"))
        self.assertEqual(
            table["U thần kinh đệm ít nhánh, IDH đột biến, đồng mất 1p/19q"], ("2", "3")
        )
        self.assertEqual(table["U sao bào lông"], ("1",))
        self.assertEqual(table["U màng não"], ("1", "2", "3"))

        # Nothing here may name an entity the list does not offer, or a grade
        # outside 1-4 — either would be a dropdown nobody can satisfy.
        for name, grades in table.items():
            self.assertIn(name, clinical_record.HISTOLOGIES, name)
            self.assertTrue(set(grades) <= set(clinical_record.GRADES), name)
            self.assertEqual(list(grades), sorted(grades), name)

        # And the entities WHO CNS5 does not grade stay out of it, so the form
        # keeps the full range for them rather than inventing a constraint.
        for name in ("U di căn", "U lympho thần kinh trung ương nguyên phát", "Nang keo"):
            self.assertNotIn(name, table)

        self.assertEqual(
            clinical_record.vocabulary()["gradesByHistology"]["U nguyên bào thần kinh đệm, IDH tự nhiên"],
            ["4"],
        )

    def test_the_astrocytic_entities_use_the_wording_a_report_uses(self):
        """"U sao bào" is the stem the Ministry of Health's own WHO table uses
        (Quyết định 1514/QĐ-BYT 2020, Bài 19, §2.4.1), and the wording a
        Vietnamese pathology report is written in. "U tế bào hình sao" is the
        longer alternate spelling, and it was what the list offered.
        """
        histologies = clinical_record.vocabulary()["histologies"]
        self.assertIn("U sao bào, IDH đột biến", histologies)
        self.assertIn("U sao bào lông", histologies)
        self.assertIn("U sao bào vàng đa hình", histologies)
        self.assertEqual([h for h in histologies if "tế bào hình sao" in h], [])

    def test_the_web_ui_can_read_every_term_out_in_english(self):
        """A Vietnamese term the interface has no English for is a term that
        reaches an English screen in Vietnamese.

        The vocabulary lives here and its English lives in `CLINICAL_EN` in
        `webui/src/i18n.js`, which is the app's one home for translations. Two
        files, so this test is the thing that stops them drifting: add a
        histology in Python and forget the English, and it fails here rather
        than on the screen of whoever switched the app to English.

        Terms that are already English — IMRT, PCV, Ki-67, the WHO grades —
        need no entry, so only the ones carrying Vietnamese are required.

        Two sources, because the form is no longer the only thing that puts a
        clinical term on screen. `neuro_oncology` names the protocol under each
        tumour and the treatment it is, and those are served inside the
        assessment rather than in the vocabulary payload — so collecting only
        the vocabulary would let a protocol name reach an English screen in
        Vietnamese, which is precisely what this test exists to prevent.
        """
        source = (
            Path(__file__).resolve().parents[1] / "webui" / "src" / "i18n.js"
        ).read_text(encoding="utf-8")
        start = source.index("export const CLINICAL_EN = {")
        block = source[start:source.index("\n};", start)]
        english = set(re.findall('^  "([^"]*)":', block, re.MULTILINE))
        self.assertIn("U màng não", english)

        terms = set()

        def collect(value):
            if isinstance(value, str):
                terms.add(value)
            elif isinstance(value, list):
                for item in value:
                    collect(item)
            elif isinstance(value, dict):
                for key, item in value.items():
                    terms.add(key)
                    collect(item)

        collect(clinical_record.vocabulary())
        # Everything `neuro_oncology` can say beside a record: the protocol
        # names, the rule quoted when a grade is outranked, the sentence naming
        # a contradiction. `display_terms` leaves out doses and citations,
        # which are not translated.
        terms.update(neuro_oncology.display_terms())

        self.assertEqual(
            sorted(term for term in terms if not term.isascii() and term not in english),
            [],
            "these clinical terms have no English in webui/src/i18n.js",
        )
        self.assertEqual(
            sorted(term for term in english if term not in terms),
            [],
            "these English entries no longer match a term the form offers",
        )

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


class DerivedForTheInterfaceTests(unittest.TestCase):
    """`with_derived` hands the web UI what it would otherwise recompute.

    The interface needs to know when an open course was due to finish, to say
    how long after radiotherapy a scan was taken. Working it out here keeps one
    implementation of the arithmetic instead of a second copy in JavaScript,
    and computing it on the way out rather than storing it means a corrected
    fraction count corrects the expected end with it.
    """

    def test_a_radiotherapy_course_carries_the_end_its_fractions_imply(self):
        record = _record(events=[{"kind": "Xạ", "start": "2026-08-20", "fractions": 30}])
        served = clinical_record.with_derived(record)
        self.assertEqual(served["events"][0]["expectedEnd"], "2026-10-01")

    def test_a_course_that_did_not_say_its_length_claims_no_end(self):
        record = _record(events=[
            {"kind": "Xạ", "start": "2026-08-20"},
            {"kind": "Hoá", "start": "2026-08-20", "cycles": 6},
        ])
        served = clinical_record.with_derived(record)
        self.assertEqual({e["expectedEnd"] for e in served["events"]}, {""})

    def test_nothing_is_written_back_to_disk(self):
        with TemporaryDirectory() as tmp:
            folder = Path(tmp)
            clinical_record.write_record(folder, {
                "events": [{"kind": "Xạ", "start": "2026-08-20", "fractions": 30}],
            })
            clinical_record.with_derived(clinical_record.read_record(folder))
            saved = json.loads(
                clinical_record.record_path(folder).read_text(encoding="utf-8"))
            self.assertNotIn("expectedEnd", saved["events"][0])


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


class NotADocumentTests(unittest.TestCase):
    """The record is bookkeeping, not paperwork the archive holds."""

    def _patient_folder(self, tmp: str) -> Path:
        """A patient folder holding one real report, the way a record arrives."""
        folder = Path(tmp) / "2510020628-NGUYEN XUAN QUANG"
        folder.mkdir(parents=True)
        (folder / "ho-so-benh-an.txt").write_text(
            "Tóm tắt bệnh án: theo dõi sau mổ.", encoding="utf-8")
        (folder / dcom_pipeline.PATIENT_MANIFEST_NAME).write_text(json.dumps({
            "format": dcom_pipeline.PATIENT_MANIFEST_FORMAT,
            "patientId": "2510020628",
            "patientName": "NGUYEN XUAN QUANG",
            "studies": {},
        }, ensure_ascii=False), encoding="utf-8")
        return folder

    def test_the_record_is_not_offered_as_a_text_document(self):
        # It is `.json` sitting in the patient folder, which is exactly what
        # the text scanner collects.
        self.assertEqual(
            "", web_backend.media_type_for_file(
                Path("2510020628") / clinical_record.CLINICAL_RECORD_NAME),
        )

    def test_writing_a_record_adds_no_row_to_the_exam_history(self):
        # Listed, it turned up in "Lịch sử khám" as a VĂN BẢN row, and opening
        # it showed the doctor their own notes back as though somebody had
        # written a report.
        with TemporaryDirectory() as tmp:
            folder = self._patient_folder(tmp)
            clinical_record.write_record(folder, {"tumors": [{
                "compartment": "Nội sọ",
                "histology": "U tế bào hình sao lan toả, IDH đột biến",
                "grade": "3",
            }]})

            series = web_backend.ArchiveCatalog().open(folder)["series"]
            documents = [item for item in series if item["mediaType"] == "text"]

            # The report is still there, and it is the only file in that row.
            self.assertEqual(1, len(documents))
            self.assertEqual(1, documents[0]["sliceCount"])
            self.assertNotIn(
                clinical_record.CLINICAL_RECORD_NAME,
                json.dumps(series, ensure_ascii=False),
            )


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

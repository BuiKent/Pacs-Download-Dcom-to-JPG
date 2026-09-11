"""One decision about how far a study got, in one vocabulary.

`complete` / `selected` / `incomplete` / `partial` are written into every
patient folder on disk, and they do not mean the same thing. `selected` records
that the reader deliberately took three series of eleven; `incomplete` records
a run that stopped on its own. A reader who sees the first knows what is
missing, and a reader who sees the second does not.

That decision was made in several places with different rules, and the manual
"đánh dấu hoàn tất" toggle wrote only two of the four words — so taking the
mark off a deliberately-selected study reported it as an unfinished download,
and putting the mark back claimed the whole study was on disk.
"""

import json
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import dcom_pipeline
import study_status
import web_backend


class ManifestStatusTests(unittest.TestCase):
    def test_a_finished_download_is_complete(self):
        self.assertEqual(
            study_status.manifest_status(
                complete=True, selection_complete=False, current_count=40,
            ),
            "complete",
        )

    def test_the_readers_own_selection_is_recorded_as_such(self):
        self.assertEqual(
            study_status.manifest_status(
                complete=False, selection_complete=True, current_count=12,
            ),
            "selected",
        )

    def test_a_run_that_stopped_early_is_incomplete(self):
        self.assertEqual(
            study_status.manifest_status(
                complete=False, selection_complete=False, current_count=12,
                previous={"status": "incomplete", "imageCount": 8},
            ),
            "incomplete",
        )

    def test_a_study_that_lost_images_is_partial(self):
        """Fewer images than last time is not the same as unfinished."""
        self.assertEqual(
            study_status.manifest_status(
                complete=False, selection_complete=False, current_count=8,
                previous={"status": "complete", "imageCount": 40},
            ),
            "partial",
        )

    def test_a_metadata_only_update_does_not_demote_a_complete_study(self):
        """Writing no images teaches nothing about completeness."""
        self.assertEqual(
            study_status.manifest_status(
                complete=False, selection_complete=False, current_count=0,
                previous={"status": "complete", "imageCount": 40},
            ),
            "complete",
        )
        self.assertEqual(
            study_status.manifest_status(
                complete=False, selection_complete=False, current_count=0,
                previous={"status": "selected", "imageCount": 12},
            ),
            "selected",
        )

    def test_a_study_nobody_has_seen_before_is_incomplete(self):
        self.assertEqual(
            study_status.manifest_status(
                complete=False, selection_complete=False, current_count=0,
            ),
            "incomplete",
        )

    def test_every_value_written_is_one_the_format_allows(self):
        """The manifest is on disk in every patient folder; the words are a format."""
        produced = {
            study_status.manifest_status(
                complete=c, selection_complete=s, current_count=n,
                previous={"status": "complete", "imageCount": 40},
            )
            for c in (True, False)
            for s in (True, False)
            for n in (0, 8, 40, 80)
        }
        self.assertTrue(produced.issubset(set(study_status.MANIFEST_STATUSES)))


class UnmarkingTests(unittest.TestCase):
    def test_a_selected_study_returns_to_selected(self):
        self.assertEqual(
            study_status.status_without_manual_completion(
                {"status": "complete", "selectedSeries": ["1.2.3", "1.2.4"]},
            ),
            "selected",
        )

    def test_a_plain_study_returns_to_incomplete(self):
        self.assertEqual(
            study_status.status_without_manual_completion({"status": "complete"}),
            "incomplete",
        )
        self.assertEqual(study_status.status_without_manual_completion(None), "incomplete")


class MarkStudyCompleteTests(unittest.TestCase):
    """The toggle the reader clicks must not erase their own earlier decision."""

    def _archive(self, tmp: Path, record: dict) -> Path:
        patient = tmp / "BN-0001 - NGUYEN VAN A"
        study = patient / "2026-08-06 - CT - SO NAO"
        study.mkdir(parents=True, exist_ok=True)
        manifest = {
            "format": dcom_pipeline.PATIENT_MANIFEST_FORMAT,
            "patientId": "BN-0001",
            "patientName": "NGUYEN VAN A",
            "studies": {"1.2.840.1": {"folder": study.name, **record}},
        }
        (patient / "patient-index.json").write_text(
            json.dumps(manifest, ensure_ascii=False), encoding="utf-8",
        )
        return study

    def _unmark(self, study: Path) -> str:
        controller = web_backend.WebController()
        return controller.mark_study_complete(str(study), complete=False)["status"]

    def test_unmarking_a_selected_study_keeps_it_selected(self):
        with TemporaryDirectory() as tmp:
            study = self._archive(
                Path(tmp),
                {"status": "complete", "selectedSeries": ["1.2.3"], "imageCount": 12},
            )
            self.assertEqual(
                self._unmark(study),
                "selected",
                "a deliberate series selection is not an unfinished download",
            )

    def test_unmarking_a_whole_study_reports_it_unfinished(self):
        with TemporaryDirectory() as tmp:
            study = self._archive(Path(tmp), {"status": "complete", "imageCount": 40})
            self.assertEqual(self._unmark(study), "incomplete")

    def test_the_value_written_survives_a_reread(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            study = self._archive(
                root, {"status": "complete", "selectedSeries": ["1.2.3"], "imageCount": 12},
            )
            self._unmark(study)
            manifest = dcom_pipeline._read_patient_manifest(study.parent)
            stored = list(manifest["studies"].values())[0]["status"]
            self.assertEqual(stored, "selected")
            self.assertIn(stored, study_status.MANIFEST_STATUSES)


if __name__ == "__main__":
    unittest.main()

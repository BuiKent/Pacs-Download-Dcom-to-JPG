"""One modality vocabulary, everywhere the reader can see or filter on it.

A Vietnamese RIS sends "CLVT" for a CT and "CHT" for an MR. The mapping onto
the DICOM codes was typed out by hand in six places; commit 81c28bf fixed three
and missed `WorklistScanner._scan_study` — the value the study list renders and
the value its modality filter compares against.

The result was a reader-visible split: the same study read "CLVT" in the study
list and "CT" in the viewer, the filter offered both as separate options, and
choosing "CT" silently hid every CLVT study. These pin the vocabulary to one
place so the halves cannot drift apart again.
"""

import json
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import modality
import web_backend
from dicom_test_utils import write_test_dicom


class _StubJob:
    @staticmethod
    def snapshot() -> dict:
        return {}


class _StubController:
    job = _StubJob()


def _scan(study_dir: Path, record: dict) -> dict:
    return web_backend.WorklistScanner(_StubController())._scan_study(study_dir, {}, record)


class NormalizeModalityTests(unittest.TestCase):
    def test_vietnamese_ris_codes_become_dicom_codes(self):
        self.assertEqual(modality.normalize_modality("CLVT"), "CT")
        self.assertEqual(modality.normalize_modality("clvt"), "CT")
        self.assertEqual(modality.normalize_modality(" CLVT "), "CT")
        self.assertEqual(modality.normalize_modality("CHT"), "MR")
        self.assertEqual(modality.normalize_modality("MRI"), "MR")

    def test_codes_already_canonical_are_left_alone(self):
        self.assertEqual(modality.normalize_modality("CT"), "CT")
        self.assertEqual(modality.normalize_modality("MR"), "MR")

    def test_an_unknown_code_passes_through_rather_than_being_guessed(self):
        """A modality nobody here has heard of is still a real modality.

        Dropping it would blank a field the reader uses to confirm the record,
        and mapping it to CT or MR would state an examination that never
        happened.
        """
        self.assertEqual(modality.normalize_modality("US"), "US")
        self.assertEqual(modality.normalize_modality("XA"), "XA")
        self.assertEqual(modality.normalize_modality("PT"), "PT")

    def test_nothing_recorded_stays_nothing(self):
        self.assertEqual(modality.normalize_modality(""), "")
        self.assertEqual(modality.normalize_modality(None), "")
        self.assertEqual(modality.normalize_modality("   "), "")

    def test_folder_words_are_matched_whole(self):
        """Substring matching claimed a scan where there was none.

        `_scan_study` decided a study was CT because "ct" appeared anywhere in
        the folder name, so a folder named "CTO" or "PROJECT" read as a CT.
        """
        self.assertEqual(modality.modality_from_text("2026-08-06 - CLVT - so nao"), "CT")
        self.assertEqual(modality.modality_from_text("2026-08-06 - CHT - cot song"), "MR")
        self.assertEqual(modality.modality_from_text("CT bung"), "CT")
        self.assertEqual(modality.modality_from_text("PROJECT REDACTED"), "")
        self.assertEqual(modality.modality_from_text("MRAZ NGUYEN"), "")
        self.assertEqual(modality.modality_from_text(""), "")


class WorklistModalityTests(unittest.TestCase):
    """The study list must speak the same vocabulary as the viewer."""

    def _study(self, root: Path, name: str) -> Path:
        study_dir = root / name
        write_test_dicom(study_dir / "DICOM" / "slice0.dcm")
        return study_dir

    def test_a_ris_clvt_study_is_listed_as_ct(self):
        with TemporaryDirectory() as tmp:
            study_dir = self._study(Path(tmp), "2026-08-06 - CLVT - SO NAO")
            row = _scan(study_dir, {"modality": "CLVT", "status": "complete"})
            self.assertEqual(
                row["modality"],
                "CT",
                "the study list must not show a modality the viewer spells differently",
            )

    def test_the_worklist_and_the_viewer_agree(self):
        """Both halves read the same study and must name it the same way."""
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            study_dir = self._study(root, "2026-08-06 - CLVT - SO NAO")
            manifest = {"modality": "CLVT", "status": "complete"}
            listed = _scan(study_dir, manifest)["modality"]
            viewed = web_backend.ArchiveCatalog._modality(study_dir, root, manifest)
            self.assertEqual(listed, viewed)

    def test_cht_is_listed_as_mr(self):
        with TemporaryDirectory() as tmp:
            study_dir = self._study(Path(tmp), "2026-07-02 - CHT - COT SONG")
            row = _scan(study_dir, {"modality": "CHT", "status": "complete"})
            self.assertEqual(row["modality"], "MR")

    def test_one_filter_option_covers_both_spellings(self):
        """The filter compares strings, so two spellings are two options.

        A reader picking "CT" then stops seeing the studies filed as "CLVT" —
        records that are present, downloaded, and invisible.
        """
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            rows = [
                _scan(self._study(root, "2026-08-06 - CLVT - SO NAO"), {"modality": "CLVT"}),
                _scan(self._study(root, "2026-08-07 - CT - BUNG"), {"modality": "CT"}),
            ]
            offered = {row["modality"] for row in rows}
            self.assertEqual(
                offered,
                {"CT"},
                "two spellings of one modality must not become two filter options",
            )

    def test_a_modality_nobody_recorded_is_not_invented(self):
        """An empty manifest modality must not become a plausible-looking one."""
        with TemporaryDirectory() as tmp:
            study_dir = self._study(Path(tmp), "2026-08-06 - anh chup")
            row = _scan(study_dir, {"modality": "", "status": "complete"})
            self.assertNotIn(row["modality"], ("CT", "MR"))


class RisModalityTests(unittest.TestCase):
    """What a RIS study-list entry is filed as."""

    def test_the_ris_code_is_trusted_first(self):
        self.assertEqual(modality.modality_from_ris("CLVT", "SO NAO"), "CT")
        self.assertEqual(modality.modality_from_ris("CHT", "COT SONG"), "MR")
        self.assertEqual(modality.modality_from_ris("MR", ""), "MR")

    def test_the_description_is_read_when_the_code_is_missing(self):
        """A Vietnamese RIS often sends the exam only in the description."""
        self.assertEqual(modality.modality_from_ris("", "CT so nao co tiem"), "CT")
        self.assertEqual(modality.modality_from_ris("", "CAT LOP VI TINH o bung"), "CT")
        self.assertEqual(modality.modality_from_ris("", "CONG HUONG TU cot song"), "MR")
        self.assertEqual(modality.modality_from_ris("", "CỘNG HƯỞNG TỪ sọ não"), "MR")

    def test_an_exam_nobody_named_is_not_filed_as_an_mr(self):
        """The fallback used to be "MR" for anything that was not a CT.

        A RIS that sends no modality code files radiographs and ultrasounds
        through the same list, and every one of them was recorded — and shown
        beside the patient's name — as an MR study.
        """
        self.assertEqual(modality.modality_from_ris("", "Sieu am o bung"), "")
        self.assertEqual(modality.modality_from_ris("", "X quang tim phoi"), "")
        self.assertEqual(modality.modality_from_ris("", ""), "")
        self.assertEqual(modality.modality_from_ris(None, None), "")

    def test_an_explicit_non_neuro_code_survives(self):
        self.assertEqual(modality.modality_from_ris("US", "Sieu am"), "US")
        self.assertEqual(modality.modality_from_ris("DX", "X quang"), "DX")

    def test_the_study_filter_still_recognises_both_fields(self):
        """The flags the RIS download filter matches on must not change."""
        self.assertEqual(modality.ris_modality_flags("CLVT", ""), (False, True))
        self.assertEqual(modality.ris_modality_flags("MRI", ""), (True, False))
        self.assertEqual(modality.ris_modality_flags("", "CT BUNG"), (False, True))
        self.assertEqual(modality.ris_modality_flags("", "MR SO NAO"), (True, False))
        self.assertEqual(modality.ris_modality_flags("", "Sieu am"), (False, False))


class PipelineManifestModalityTests(unittest.TestCase):
    """New downloads should file the canonical code, not the RIS's spelling."""

    def test_a_study_folder_name_reports_a_canonical_modality(self):
        date, mod, desc = web_backend._parse_study_folder_name("2026-08-06 - CLVT - SO NAO")
        self.assertEqual(mod, "CT")
        self.assertEqual(desc, "SO NAO")
        date, mod, desc = web_backend._parse_study_folder_name("2026-07-02 - CHT - COT SONG")
        self.assertEqual(mod, "MR")


if __name__ == "__main__":
    unittest.main()

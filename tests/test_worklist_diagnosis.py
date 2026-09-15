"""What the case is, shown on the worklist row.

Neither DICOM nor the patient manifest schema carries a clinical diagnosis:
`StudyDescription` is the exam that was ordered, not the finding. So the
diagnosis lives in one of two places a person wrote it — the `diagnosis` key
`set_patient_diagnosis` adds to `patient-index.json`, and the note left in the
folder name (`2607009886-NGUYEN VAN A-58T-GBM cham phai`).

Both are reports of what is on disk rather than guesses about a patient, so
both may be shown. They are not equally strong, though, and the row says which
one it is showing: a chart note was written for this patient, while a folder
name can outlive what it describes.

Sex and birth year stay out of this. A folder name that looks like it carries
them is still not a DICOM tag, and those are the two fields a clinician reads
to confirm the right chart is open.
"""

import json
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import dcom_pipeline
import web_backend


def _scanner() -> web_backend.WorklistScanner:
    """A scanner used only for its parsers, with no archive behind it."""
    return web_backend.WorklistScanner.__new__(web_backend.WorklistScanner)


class FolderNameDiagnosisTests(unittest.TestCase):
    def test_the_note_after_the_age_is_read_as_the_diagnosis(self):
        meta = _scanner()._parse_patient_meta("2607009886-NGUYEN VAN A-58T-GBM cham phai")
        self.assertEqual(meta["patientId"], "2607009886")
        self.assertEqual(meta["diagnosis"], "GBM cham phai")

    def test_a_diagnosis_keeps_its_own_punctuation(self):
        meta = _scanner()._parse_patient_meta(
            "2606033997-TRAN THI B-14T-U than kinh dem nao that III#U so hau"
        )
        self.assertEqual(meta["diagnosis"], "U than kinh dem nao that III#U so hau")

    def test_a_download_date_is_never_mistaken_for_a_diagnosis(self):
        meta = _scanner()._parse_patient_meta("2510020628 - NGUYEN VAN E - 41T - 15-09-2026")
        self.assertEqual(meta["diagnosis"], "")

    def test_a_folder_name_still_reveals_no_sex_or_birth_year(self):
        meta = _scanner()._parse_patient_meta("2605030698-LE VAN C-53t-Oligo do III")
        self.assertEqual(meta["gender"], "")
        self.assertEqual(meta["birthYear"], "")

    def test_a_name_that_does_not_parse_claims_no_diagnosis(self):
        meta = _scanner()._parse_patient_meta("kho anh cu")
        self.assertEqual(meta["diagnosis"], "")


class RecordedDiagnosisTests(unittest.TestCase):
    """`_patient_meta_for` weighs the chart note against the folder name."""

    def _archive(self, tmp: str, folder_name: str, manifest: dict | None) -> Path:
        folder = Path(tmp) / folder_name
        folder.mkdir(parents=True)
        if manifest is not None:
            (folder / dcom_pipeline.PATIENT_MANIFEST_NAME).write_text(
                json.dumps(manifest, ensure_ascii=False), encoding="utf-8"
            )
        return folder

    def test_the_chart_note_outranks_the_folder_name(self):
        with TemporaryDirectory() as tmp:
            folder = self._archive(tmp, "2607009886-NGUYEN VAN A-58T-GBM cham phai", {
                "format": dcom_pipeline.PATIENT_MANIFEST_FORMAT,
                "patientId": "2607009886",
                "patientName": "NGUYEN VAN A",
                "diagnosis": "GBM IDH-wildtype, tai phat",
                "studies": {},
            })
            meta = _scanner()._patient_meta_for(folder)
            self.assertEqual(meta["diagnosis"], "GBM IDH-wildtype, tai phat")
            self.assertEqual(meta["diagnosisSource"], "manifest")

    def test_the_folder_name_fills_in_when_the_chart_is_silent(self):
        with TemporaryDirectory() as tmp:
            folder = self._archive(tmp, "2607009886-NGUYEN VAN A-58T-GBM cham phai", {
                "format": dcom_pipeline.PATIENT_MANIFEST_FORMAT,
                "patientId": "2607009886",
                "patientName": "NGUYEN VAN A",
                "studies": {},
            })
            meta = _scanner()._patient_meta_for(folder)
            self.assertEqual(meta["diagnosis"], "GBM cham phai")
            self.assertEqual(meta["diagnosisSource"], "folder")

    def test_an_archive_with_no_manifest_still_reports_its_source(self):
        with TemporaryDirectory() as tmp:
            folder = self._archive(tmp, "2402014690-PHAM THI D-32T-Cavernoma da o", None)
            meta = _scanner()._patient_meta_for(folder)
            self.assertEqual(meta["diagnosis"], "Cavernoma da o")
            self.assertEqual(meta["diagnosisSource"], "folder")

    def test_nothing_written_anywhere_stays_blank(self):
        with TemporaryDirectory() as tmp:
            folder = self._archive(tmp, "2510020628 - NGUYEN VAN E - 41T - 15-09-2026", {
                "format": dcom_pipeline.PATIENT_MANIFEST_FORMAT,
                "patientId": "2510020628",
                "patientName": "NGUYEN VAN E",
                "studies": {},
            })
            meta = _scanner()._patient_meta_for(folder)
            self.assertEqual(meta["diagnosis"], "")
            self.assertEqual(meta["diagnosisSource"], "")


if __name__ == "__main__":
    unittest.main()

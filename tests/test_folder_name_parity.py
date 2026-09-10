"""The app and the browser extension must name folders identically.

Both tools download the same studies into the same archive. If their folder
names differ by even one character the same patient is filed twice and the
reader sees a split record, so this suite runs the real JavaScript from
`lib/pacs.js` through Node and compares it against the Python that ships in
`dcom_pipeline`.

Node is optional on a clinical workstation, so the cross-language cases skip
when it is missing; the pure-Python expectations still run.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import dcom_pipeline
import web_backend


EXTENSION_LIB = (
    Path(__file__).resolve().parents[1]
    / "Upgrade"
    / "extention download DCOM"
    / "pacs_dicom_extension_v7"
    / "lib"
    / "pacs.js"
)

# Every case a hospital actually produces: a plain adult, a DICOM `AS` age with
# no birth date, an age in weeks, names and descriptions past the field width,
# characters Windows forbids, and an infant whose age is not whole years.
CASES = [
    {
        "patientName": "NGUYEN VAN AN", "patientId": "BN001",
        "birthDate": "19740115", "studyDate": "20260901",
        "modality": "MR", "description": "MRI Nao", "downloadDate": "08-09-2026",
    },
    {
        "patientName": "TRAN^THI^BINH", "patientId": "BN002",
        "birthDate": "", "patientAge": "045Y", "studyDate": "20260901",
        "modality": "CT", "description": "CT Bung", "downloadDate": "08-09-2026",
    },
    {
        "patientName": "LE VAN CUONG", "patientId": "BN003",
        "birthDate": "", "patientAge": "010W", "studyDate": "20260901",
        "modality": "XA", "description": "X quang", "downloadDate": "08-09-2026",
    },
    {
        "patientName": "PHAM THI DUNG THI HOA THI LAN THI MAI THI NGA THI OANH",
        "patientId": "BN004", "birthDate": "19900101", "studyDate": "20260901",
        "modality": "MR",
        "description": "Chup cong huong tu so nao co tiem thuoc doi quang tu rat dai mo ta",
        "downloadDate": "08-09-2026",
    },
    {
        "patientName": "HO/VAN:EM*", "patientId": "BN<005>",
        "birthDate": "20200101", "studyDate": "20260901",
        "modality": "US", "description": "Sieu am | bung?", "downloadDate": "08-09-2026",
    },
    {
        "patientName": "DO VAN GIANG.", "patientId": "BN006",
        "birthDate": "20260801", "studyDate": "20260901",
        "modality": "CR", "description": "Chup phoi.", "downloadDate": "08-09-2026",
    },
    {
        "patientName": "", "patientId": "",
        "birthDate": "", "studyDate": "",
        "modality": "", "description": "", "downloadDate": "08-09-2026",
    },
    {
        # RIS pages routinely carry only a birth year.
        "patientName": "VU THI HANH", "patientId": "BN007",
        "birthDate": "1999", "studyDate": "20260730",
        "modality": "CT", "description": "CT Nguc", "downloadDate": "30-07-2026",
    },
    {
        # An age one of the two tools already formatted, fed back in.
        "patientName": "BUI VAN INH", "patientId": "BN008",
        "birthDate": "", "patientAge": "27T", "studyDate": "20260730",
        "modality": "MR", "description": "MRI Goi", "downloadDate": "30-07-2026",
    },
]


def app_storage_path(case: dict) -> str:
    """`<patient>/<study>/DICOM` the way a download from the app lays it out."""
    metadata = {
        "PatientName": case.get("patientName"),
        "PatientID": case.get("patientId"),
        "PatientBirthDate": case.get("birthDate") or "",
        "PatientAge": case.get("patientAge") or "",
    }
    patient = dcom_pipeline.patient_download_folder_name(
        metadata, case.get("downloadDate") or "",
    )
    study = dcom_pipeline.study_folder_base_name({
        "date": case.get("studyDate"),
        "modality": case.get("modality"),
        "desc": case.get("description"),
    })
    return f"{patient}/{study}/DICOM"


def extension_storage_paths(cases: list[dict]) -> list[str]:
    """Run the extension's own `buildStudyStoragePath` through Node."""
    script = (
        "import {buildStudyStoragePath} from %s;\n"
        "const cases = JSON.parse(process.argv[2]);\n"
        "console.log(JSON.stringify(cases.map(c => buildStudyStoragePath(c))));\n"
        % json.dumps(EXTENSION_LIB.as_uri())
    )
    with tempfile.TemporaryDirectory() as tmp:
        entry = Path(tmp) / "parity.mjs"
        entry.write_text(script, encoding="utf-8")
        result = subprocess.run(
            [shutil.which("node") or "node", str(entry), json.dumps(cases)],
            capture_output=True, text=True, encoding="utf-8", timeout=120,
        )
    if result.returncode != 0:
        raise AssertionError(f"Node failed: {result.stderr.strip()}")
    return json.loads(result.stdout.strip())


class FolderNameParityTests(unittest.TestCase):
    def test_app_ages_read_clinically(self):
        """The folder shows an age a reader can act on, never the raw DICOM tag."""
        expectations = {
            0: "52T",          # birth date and download date
            1: "45T",          # DICOM AS "045Y", not "045Y"
            2: "10 tuần",      # weeks stay weeks
            5: "1 tháng",      # an infant is not "0T"
            6: "KHONG_RO_TUOI",
        }
        for index, expected in expectations.items():
            with self.subTest(case=index):
                self.assertIn(f" - {expected} - ", app_storage_path(CASES[index]))

    def test_app_never_ends_a_segment_with_a_dot(self):
        """Windows silently drops a trailing dot, desynchronising the manifest."""
        for index, case in enumerate(CASES):
            with self.subTest(case=index):
                for segment in app_storage_path(case).split("/"):
                    self.assertEqual(segment, segment.strip(". "))
                    self.assertTrue(segment)

    def test_app_and_extension_agree_on_every_folder_name(self):
        if shutil.which("node") is None:
            self.skipTest("Node is not installed; cross-language parity not checked.")
        if not EXTENSION_LIB.is_file():
            self.skipTest(f"Extension library missing at {EXTENSION_LIB}")
        extension = extension_storage_paths(CASES)
        self.assertEqual(len(extension), len(CASES))
        for index, case in enumerate(CASES):
            with self.subTest(case=index, patient=case.get("patientId")):
                self.assertEqual(app_storage_path(case), extension[index])


class SaveFolderParityTests(unittest.TestCase):
    """The app must know the folder name the extension saves into.

    Both tools name patient and study folders identically, checked above. The
    folder those pairs live in is the third name they share, and the app needs
    it for a reason the others do not: a folder the extension filled carries no
    `patient-index.json`, so without recognising the name the worklist reported
    the extension's whole output as one patient and merged everyone inside it
    into a single row.
    """

    def test_the_app_mirrors_the_extension_default_subfolder(self):
        side_panel = EXTENSION_LIB.parent.parent / "sidepanel.js"
        if not side_panel.is_file():
            self.skipTest(f"Side panel missing at {side_panel}")
        source = side_panel.read_text(encoding="utf-8")
        match = re.search(r"DEFAULT_SUBFOLDER\s*=\s*'([^']+)'", source)
        self.assertIsNotNone(
            match, "sidepanel.js no longer declares DEFAULT_SUBFOLDER",
        )
        self.assertEqual(
            dcom_pipeline.EXTENSION_DEFAULT_SUBFOLDER,
            match.group(1),
            "dcom_pipeline.EXTENSION_DEFAULT_SUBFOLDER has drifted from the extension",
        )

    def test_a_folder_of_downloads_reads_as_a_group_not_a_patient(self):
        # Exactly what the extension writes into its save folder.
        for case in CASES:
            with self.subTest(patient=case.get("patientId")):
                patient_folder = app_storage_path(case).split("/")[0]
                self.assertTrue(
                    web_backend.looks_like_download_folder_name(patient_folder),
                    f"{patient_folder!r} must be recognised as a patient folder",
                )

    def test_a_grouping_folder_is_not_mistaken_for_a_patient(self):
        for name in (
            dcom_pipeline.EXTENSION_DEFAULT_SUBFOLDER,
            "U não",
            "U tủy/Cavernoma",
            "Downloads",
            "DICOM",
        ):
            with self.subTest(folder=name):
                self.assertFalse(web_backend.looks_like_download_folder_name(name))


if __name__ == "__main__":
    unittest.main()

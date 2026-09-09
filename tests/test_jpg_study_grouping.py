"""Tests for JPG study grouping, modality detection, and patient demographics.

Verifies:
1. Patient demographics extraction from folder names.
2. Study folder name parsing (with or without dates, hyphens, modalities).
3. Modality recognition for clinical MRI and CT sequences.
4. Routing of volumetric JPG slice stacks to diagnostic viewer ("dicom").
5. Consistent timeline key grouping within each study folder.
"""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import web_backend


class JpgStudyGroupingTests(unittest.TestCase):
    def test_parse_patient_folder_name_with_caret_and_age(self):
        meta = web_backend._parse_patient_folder_name("2604047445-PHAM THI THOM^40T")
        self.assertEqual(meta.get("patientId"), "2604047445")
        self.assertEqual(meta.get("patientName"), "PHAM THI THOM")
        self.assertEqual(meta.get("age"), "40")
        self.assertTrue(meta.get("birthYear"))

    def test_parse_patient_folder_name_with_diagnosis(self):
        meta = web_backend._parse_patient_folder_name("2401005051-Đào Trường Giang-30T-U não hố sau")
        self.assertEqual(meta.get("patientId"), "2401005051")
        self.assertEqual(meta.get("patientName"), "Đào Trường Giang")
        self.assertEqual(meta.get("age"), "30")
        self.assertEqual(meta.get("diagnosis"), "U não hố sau")

    def test_parse_patient_folder_name_with_carets_normalized(self):
        meta = web_backend._parse_patient_folder_name("2211034230-TRẦN^THỊ^THƠM-34t-Cavernoma, động kinh")
        self.assertEqual(meta.get("patientId"), "2211034230")
        self.assertEqual(meta.get("patientName"), "TRẦN THỊ THƠM")
        self.assertEqual(meta.get("age"), "34")
        self.assertEqual(meta.get("diagnosis"), "Cavernoma, động kinh")

    def test_parse_study_folder_name_standard(self):
        date, mod, desc = web_backend._parse_study_folder_name("2026-07-30 - MR - MR so nao + Gadovist")
        self.assertEqual(date, "2026-07-30")
        self.assertEqual(mod, "MR")
        self.assertEqual(desc, "MR so nao + Gadovist")

    def test_parse_study_folder_name_single_hyphen_dmy(self):
        date, mod, desc = web_backend._parse_study_folder_name("13-05-2026-sau mổ 24h")
        self.assertEqual(date, "2026-05-13")
        self.assertEqual(mod, "")
        self.assertEqual(desc, "sau mổ 24h")

    def test_parse_study_folder_name_iso_date_with_desc(self):
        date, mod, desc = web_backend._parse_study_folder_name("2026-06-16 - sau mổ 1 tháng")
        self.assertEqual(date, "2026-06-16")
        self.assertEqual(mod, "")
        self.assertEqual(desc, "sau mổ 1 tháng")

    def test_parse_study_folder_name_undated(self):
        date, mod, desc = web_backend._parse_study_folder_name("Trước mổ")
        self.assertEqual(date, "")
        self.assertEqual(mod, "")
        self.assertEqual(desc, "Trước mổ")

    def test_modality_detection_for_mri_sequences(self):
        root = Path("/archive/2604047445-PHAM THI THOM^40T")
        cases = [
            ("13-05-2026-sau mổ 24h/2-Ax T2 FLAIR FS", "MR"),
            ("13-05-2026-sau mổ 24h/4-3D Ax T1 BRAVO", "MR"),
            ("13-05-2026-sau mổ 24h/6-Ax DWI PROPELLER", "MR"),
            ("2026-06-16 - sau mổ 1 tháng/Series_3_3D Ax SWAN", "MR"),
            ("2026-06-16 - sau mổ 1 tháng/Series_550_ADC (10^-6 mm_s)", "MR"),
            ("24-04-2026- trước mổ/401-t1_gre_fsp_3d_tra_fs", "MR"),
            ("24-04-2026- trước mổ/402-t1_gre_fsp_3d_tra_fs_MPR_SAG", "MR"),
            ("CT Sọ não không tiêm/Series 2 - Bone Window", "CT"),
        ]
        for rel_path, expected in cases:
            folder = root / Path(rel_path)
            detected = web_backend.ArchiveCatalog._modality(folder, root, None)
            self.assertEqual(detected, expected, f"Failed for {rel_path}: got {detected}, expected {expected}")

    def test_resolved_media_type_routes_mri_stacks_to_dicom(self):
        record = web_backend.SeriesRecord(
            series_id="s1",
            name="Ax T2 FLAIR",
            folder=Path("/archive/study/s1"),
            images=[Path(f"/archive/study/s1/IM_{i:04d}.jpg") for i in range(1, 31)],
            manifest=None,
            mpr_ready=False,
            mpr_reason="",
            modality="MR",
            source_type="image",
        )
        self.assertEqual(record.resolved_media_type(), "dicom")

    def test_timeline_key_groups_series_under_same_study_folder(self):
        study_folder = Path("/archive/13-05-2026-sau mổ 24h")
        group_name = "2026-05-13 - MR - sau mổ 24h"
        rec1 = web_backend.SeriesRecord(
            series_id="s1",
            name="2-Ax T2 FLAIR FS",
            folder=study_folder / "2-Ax T2 FLAIR FS",
            images=[study_folder / "2-Ax T2 FLAIR FS" / "1.jpeg"],
            manifest=None,
            mpr_ready=False,
            mpr_reason="",
            modality="MR",
            study_group=group_name,
            study_date="2026-05-13",
            study_folder=study_folder,
        )
        rec2 = web_backend.SeriesRecord(
            series_id="s2",
            name="4-3D Ax T1 BRAVO",
            folder=study_folder / "4-3D Ax T1 BRAVO",
            images=[study_folder / "4-3D Ax T1 BRAVO" / "2.jpeg"],
            manifest=None,
            mpr_ready=False,
            mpr_reason="",
            modality="MR",
            study_group=group_name,
            study_date="2026-05-13",
            study_folder=study_folder,
        )
        self.assertEqual(rec1.timeline_key(), rec2.timeline_key())

    def test_undated_study_folders_still_group_consistently(self):
        study_folder = Path("/archive/Truoc mo")
        group_name = "MR - Truoc mo"
        rec1 = web_backend.SeriesRecord(
            series_id="s1",
            name="Series 1",
            folder=study_folder / "Series 1",
            images=[study_folder / "Series 1" / "1.jpg"],
            manifest=None,
            mpr_ready=False,
            mpr_reason="",
            modality="MR",
            study_group=group_name,
            study_date="",
            study_folder=study_folder,
        )
        rec2 = web_backend.SeriesRecord(
            series_id="s2",
            name="Series 2",
            folder=study_folder / "Series 2",
            images=[study_folder / "Series 2" / "2.jpg"],
            manifest=None,
            mpr_ready=False,
            mpr_reason="",
            modality="MR",
            study_group=group_name,
            study_date="",
            study_folder=study_folder,
        )
        self.assertEqual(rec1.timeline_key(), rec2.timeline_key())

    def test_source_format_detection(self):
        rec_dcm = web_backend.SeriesRecord(
            series_id="d1",
            name="MR DICOM",
            folder=Path("/archive/study/s1"),
            images=[Path("/archive/study/s1/image.dcm")],
            manifest=None,
            mpr_ready=False,
            mpr_reason="",
            source_type="dicom",
        )
        self.assertEqual(rec_dcm.source_format(), "DICOM")
        self.assertEqual(rec_dcm.public_dict()["sourceFormat"], "DICOM")

        rec_jpg = web_backend.SeriesRecord(
            series_id="j1",
            name="MR JPG",
            folder=Path("/archive/study/s2"),
            images=[Path("/archive/study/s2/IM_0001.jpg")],
            manifest=None,
            mpr_ready=False,
            mpr_reason="",
            source_type="image",
        )
        self.assertEqual(rec_jpg.source_format(), "JPG")
        self.assertEqual(rec_jpg.public_dict()["sourceFormat"], "JPG")

    def test_parse_study_folder_clvt(self):
        date, mod, desc = web_backend._parse_study_folder_name("2026-06-16 - CLVT - trước mổ")
        self.assertEqual(date, "2026-06-16")
        self.assertEqual(mod, "CT")
        self.assertEqual(desc, "trước mổ")

    def test_modality_clvt_detection(self):
        root = Path("/archive/patient")
        folder = root / "2026-06-16 - CLVT - trước mổ" / "Series_10001_Dose Info"
        mod = web_backend.ArchiveCatalog._modality(folder, root, None)
        self.assertEqual(mod, "CT")

    def test_harmonize_study_folder_records(self):
        sf = Path("/archive/2026-06-16 - CLVT - trước mổ")
        r_scout = web_backend.SeriesRecord(
            series_id="scout",
            name="Series_1_SCOUT",
            folder=sf / "Series_1_SCOUT",
            images=[sf / "Series_1_SCOUT" / "scout.jpg"],
            manifest=None,
            mpr_ready=False,
            mpr_reason="",
            modality="CT",
            study_folder=sf,
        )
        r_plain = web_backend.SeriesRecord(
            series_id="plain",
            name="Series_2_PLAIN",
            folder=sf / "Series_2_PLAIN",
            images=[sf / "Series_2_PLAIN" / f"{i}.jpg" for i in range(100)],
            manifest={"study_instance_uid": "uid.12345", "modality": "CT"},
            mpr_ready=True,
            mpr_reason="",
            modality="CT",
            study_folder=sf,
        )
        r_dose = web_backend.SeriesRecord(
            series_id="dose",
            name="Series_10001_Dose Info",
            folder=sf / "Series_10001_Dose Info",
            images=[sf / "Series_10001_Dose Info" / "dose.jpg"],
            manifest=None,
            mpr_ready=False,
            mpr_reason="",
            modality="UNKNOWN",
            study_folder=sf,
        )

        records = {"scout": r_scout, "plain": r_plain, "dose": r_dose}
        web_backend.ArchiveCatalog._harmonize_study_folder_records(records, Path("/archive"))

        self.assertEqual(r_dose.modality, "CT")
        self.assertEqual(r_scout.study_uid, "uid.12345")
        self.assertEqual(r_dose.study_uid, "uid.12345")
        self.assertEqual(r_scout.study_group, r_plain.study_group)
        self.assertEqual(r_dose.study_group, r_plain.study_group)
        self.assertEqual(r_scout.timeline_key(), r_plain.timeline_key())
        self.assertEqual(r_dose.timeline_key(), r_plain.timeline_key())

    def test_extract_folder_date_embedded(self):
        self.assertEqual(web_backend._extract_folder_date("01_Truoc_mo_1_18-05-2026"), "2026-05-18")
        self.assertEqual(web_backend._extract_folder_date("02_Truoc_mo_2_26-05-2026"), "2026-05-26")
        self.assertEqual(web_backend._extract_folder_date("03_Sau_mo_05-06-2026"), "2026-06-05")
        self.assertEqual(web_backend._extract_folder_date("06.07.2026-trước mổ"), "2026-07-06")

    def test_parse_study_folder_name_with_embedded_date(self):
        d, mod, desc = web_backend._parse_study_folder_name("01_Truoc_mo_1_18-05-2026")
        self.assertEqual(d, "2026-05-18")
        self.assertEqual(mod, "")
        self.assertEqual(desc, "01_Truoc_mo_1")


if __name__ == "__main__":
    unittest.main()


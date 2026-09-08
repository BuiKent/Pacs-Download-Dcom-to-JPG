"""One visit must occupy exactly one row in "Lịch sử khám".

A study was being listed twice on the patient rail. The archive's own
`.dicom_cache.json` had been written before `study_uid` joined the record
schema, and the cache was accepted on its file fingerprint alone. Every series
therefore loaded with an empty UID, and `timeline_key` fell back to the folder
name — except for the series that still carried an MPR manifest, which kept the
real StudyInstanceUID. The two halves of one visit hashed to different keys and
the reader saw the same date and description listed twice.
"""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import web_backend


def _record(series_id: str, study_uid: str = "", *, group: str, date: str) -> web_backend.SeriesRecord:
    return web_backend.SeriesRecord(
        series_id=series_id,
        name=f"Series {series_id}",
        folder=Path("/archive") / group / series_id,
        images=[Path("/archive") / group / series_id / "IM_00001.dcm"],
        manifest=None,
        mpr_ready=False,
        mpr_reason="",
        study_group=group,
        study_date=date,
        study_uid=study_uid,
        source_type="dicom",
    )


class StudyUidSharingTests(unittest.TestCase):
    GROUP = "2026-07-30 - MR - MR so nao + Gadovist"
    DATE = "2026-07-30"

    def test_siblings_without_the_tag_join_the_same_timeline_row(self):
        """A localizer with no StudyInstanceUID belongs to its visit, not its own row."""
        records = {
            "main": _record("main", "1.2.840.55", group=self.GROUP, date=self.DATE),
            "localizer": _record("localizer", "", group=self.GROUP, date=self.DATE),
            "keyimage": _record("keyimage", "", group=self.GROUP, date=self.DATE),
        }
        web_backend._share_study_uid_within_group(records)

        self.assertEqual(
            {record.study_uid for record in records.values()},
            {"1.2.840.55"},
        )
        self.assertEqual(
            len({record.timeline_key() for record in records.values()}),
            1,
        )

    def test_two_real_studies_under_one_heading_stay_apart(self):
        """Two genuine UIDs are two genuine visits and must never be merged."""
        records = {
            "a": _record("a", "1.2.840.55", group=self.GROUP, date=self.DATE),
            "b": _record("b", "1.2.840.66", group=self.GROUP, date=self.DATE),
            "orphan": _record("orphan", "", group=self.GROUP, date=self.DATE),
        }
        web_backend._share_study_uid_within_group(records)

        self.assertEqual(records["a"].study_uid, "1.2.840.55")
        self.assertEqual(records["b"].study_uid, "1.2.840.66")
        # The ambiguous one is left alone rather than filed under a guess.
        self.assertEqual(records["orphan"].study_uid, "")

    def test_a_group_with_no_uid_at_all_is_untouched(self):
        records = {
            "a": _record("a", "", group=self.GROUP, date=self.DATE),
            "b": _record("b", "", group=self.GROUP, date=self.DATE),
        }
        web_backend._share_study_uid_within_group(records)
        self.assertEqual({record.study_uid for record in records.values()}, {""})
        # Both still land on one row, via the folder/group fallback.
        self.assertEqual(
            len({record.timeline_key() for record in records.values()}),
            1,
        )

    def test_separate_visits_keep_separate_rows(self):
        records = {
            "jul": _record("jul", "1.2.840.55", group=self.GROUP, date=self.DATE),
            "aug": _record(
                "aug", "1.2.840.66",
                group="2026-08-01 - MR - MR so nao + Gadovist", date="2026-08-01",
            ),
        }
        web_backend._share_study_uid_within_group(records)
        self.assertEqual(
            len({record.timeline_key() for record in records.values()}),
            2,
        )


class DicomCacheSchemaTests(unittest.TestCase):
    def test_a_cache_from_an_older_schema_is_rejected(self):
        """Adding a field to the record must not silently degrade old archives.

        The cache used to be trusted on its fingerprint alone, so a cache
        written before `study_uid` existed kept being loaded with the field
        missing.
        """
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            cache = web_backend._get_dicom_cache_path(root)
            cache.write_text(
                json.dumps({"fingerprint": "abc", "records": {}}),
                encoding="utf-8",
            )
            stored = json.loads(cache.read_text(encoding="utf-8"))
            self.assertNotEqual(
                int(stored.get("schema") or 0),
                web_backend.DICOM_CACHE_SCHEMA,
                "a cache with no schema must not pass as the current one",
            )

    def test_current_schema_is_a_positive_integer(self):
        self.assertIsInstance(web_backend.DICOM_CACHE_SCHEMA, int)
        self.assertGreaterEqual(web_backend.DICOM_CACHE_SCHEMA, 2)

    def test_study_uid_survives_a_serialise_round_trip(self):
        """The field whose absence caused the split must persist through the cache."""
        record = _record("s1", "1.2.840.99", group="G", date="2026-07-30")
        payload = web_backend._serialize_series_record(record, Path("/archive"))
        self.assertEqual(payload.get("study_uid"), "1.2.840.99")
        restored = web_backend._deserialize_series_record(payload, Path("/archive"))
        self.assertEqual(restored.study_uid, "1.2.840.99")


if __name__ == "__main__":
    unittest.main()

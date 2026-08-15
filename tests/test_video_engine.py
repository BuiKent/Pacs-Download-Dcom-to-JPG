"""Unit tests for video_engine.py using standard unittest."""

import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

import video_engine as ve


class TestVideoEngineStructure(unittest.TestCase):
    def test_concurrency_gate(self):
        gate = ve._ConcurrencyGate(limit=2, wait_timeout_s=0.5, name="test_gate")
        self.assertEqual(gate.stats()["limit"], 2)
        self.assertEqual(gate.stats()["running"], 0)
        self.assertEqual(gate.stats()["waiting"], 0)

        with gate:
            self.assertEqual(gate.stats()["running"], 1)
        self.assertEqual(gate.stats()["running"], 0)

    def test_concurrency_gate_timeout(self):
        gate = ve._ConcurrencyGate(limit=1, wait_timeout_s=0.05, name="test_busy")
        with gate:
            with self.assertRaises(ve.ServerBusyError):
                with gate:
                    pass

    def test_reconfigure_concurrency(self):
        ve.configure_concurrency(heavy_limit=3, light_limit=6)
        stats = ve.concurrency_stats()
        self.assertEqual(stats["heavy"]["limit"], 3)
        self.assertEqual(stats["light"]["limit"], 6)

    def test_unsupported_format_error(self):
        with tempfile.TemporaryDirectory() as td:
            txt_file = Path(td) / "test.txt"
            txt_file.write_text("not a video")
            with self.assertRaises(ve.UnsupportedFormatError):
                ve.probe(txt_file)

    def test_missing_file_error(self):
        with self.assertRaises(ve.ProbeFailedError):
            ve.probe("non_existent_file.mp4")

    def test_trim_invalid_bounds(self):
        with tempfile.TemporaryDirectory() as td:
            video_file = Path(td) / "dummy.mp4"
            video_file.write_bytes(b"dummy")
            out_file = Path(td) / "out.mp4"
            with self.assertRaises(ve.VideoEngineError):
                ve.trim(video_file, out_file, start_s=5.0, end_s=2.0)

    def test_concat_requires_at_least_two_sources(self):
        with self.assertRaises(ve.VideoEngineError):
            ve.concat(["only_one.mp4"], "out.mp4")

    def test_burn_text_requires_overlays(self):
        with tempfile.TemporaryDirectory() as td:
            video_file = Path(td) / "dummy.mp4"
            video_file.write_bytes(b"dummy")
            out_file = Path(td) / "out.mp4"
            with self.assertRaises(ve.VideoEngineError):
                ve.burn_text(video_file, out_file, overlays=[])

    def test_drawtext_escaping(self):
        escaped = ve._escape_drawtext("Bệnh nhân: Nguyễn Văn A - 12'34\"")
        self.assertIn("\\:", escaped)
        self.assertNotIn("'", escaped)


if __name__ == "__main__":
    unittest.main()

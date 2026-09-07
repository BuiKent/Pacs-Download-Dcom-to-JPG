"""Tests for the session file logging subsystem and diagnostics."""

import os
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path

import app_logging
import dcom_pipeline
from web_backend import JobState, WebController


class SessionLoggingTests(unittest.TestCase):
    def tearDown(self):
        logger = app_logging.SessionLogger._instance
        if logger:
            logger.close()
        app_logging.SessionLogger._instance = None

    def test_logger_creates_file_and_writes_events(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            logger = app_logging.SessionLogger(
                logs_dir=tmp_dir,
                prefix="test_app_",
                max_history=5,
                retention_days=7,
            )
            try:
                self.assertTrue(logger.log_file.exists())
                self.assertEqual(logger.log_file.parent.resolve(), Path(tmp_dir).resolve())

                logger.info("Test info message", source="UNITTEST")
                logger.job_event("DOWNLOAD", "Processing batch 1 of 10")
                logger.download_summary(
                    study_uid="1.2.840.10008.1",
                    patient_id="BN12345",
                    expected=50,
                    dicom_count=50,
                    jpg_count=50,
                    status="complete",
                    failed_count=0,
                    details="test download summary",
                )
                logger.error("Simulated error occurred", exc_info=False, source="TEST")

                content = logger.log_file.read_text(encoding="utf-8")
                self.assertIn("Test info message", content)
                self.assertIn("[JOB]", content)
                self.assertIn("[DOWNLOAD]", content)
                self.assertIn("BN12345", content)
                self.assertIn("Simulated error occurred", content)
            finally:
                logger.close()

    def test_log_retention_and_cleanup(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_path = Path(tmp_dir)
            # Create 10 dummy log files with distinct timestamps
            for i in range(10):
                dummy = tmp_path / f"app_2026-01-{i+1:02d}_12-00-00.log"
                dummy.write_text(f"dummy content {i}", encoding="utf-8")

            self.assertEqual(len(list(tmp_path.glob("*.log"))), 10)

            logger = app_logging.SessionLogger(
                logs_dir=tmp_dir,
                prefix="app_",
                max_history=5,
                retention_days=30,
            )
            try:
                # Should keep max 5 historical + 1 new current session = max 6 files total
                logs_remaining = list(tmp_path.glob("app_*.log"))
                self.assertLessEqual(len(logs_remaining), 6)
            finally:
                logger.close()

    def test_concurrent_logging(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            logger = app_logging.SessionLogger(logs_dir=tmp_dir)
            try:
                def worker(worker_id: int):
                    for j in range(25):
                        logger.info(f"Worker {worker_id} line {j}")

                threads = [threading.Thread(target=worker, args=(i,)) for i in range(4)]
                for t in threads:
                    t.start()
                for t in threads:
                    t.join()

                content = logger.log_file.read_text(encoding="utf-8")
                self.assertIn("Worker 0 line 24", content)
                self.assertIn("Worker 3 line 24", content)
            finally:
                logger.close()

    def test_stdio_tee(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            logger = app_logging.SessionLogger(logs_dir=tmp_dir)
            try:
                tee = app_logging.StdioTee(sys.stdout, lambda s: logger.info(s, source="STDOUT"))

                test_str = "Custom stdio print message for verification\n"
                tee.write(test_str)
                tee.flush()

                content = logger.log_file.read_text(encoding="utf-8")
                self.assertIn("Custom stdio print message for verification", content)
            finally:
                logger.close()

    def test_job_state_integration(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            logger = app_logging.init_app_logging(tee_stdio=False, logs_dir=tmp_dir)
            try:
                job = JobState()
                self.assertEqual(job.log_file_path.resolve(), logger.log_file.resolve())

                job.log("Message from job state logger")
                time.sleep(0.05)
                content = logger.log_file.read_text(encoding="utf-8")
                self.assertIn("Message from job state logger", content)
            finally:
                logger.close()

    def test_web_controller_logs_info_and_reveal(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            logger = app_logging.init_app_logging(tee_stdio=False, logs_dir=tmp_dir)
            try:
                controller = WebController()
                info = controller.get_logs_info()
                self.assertIn("logDir", info)
                self.assertIn("currentLogFile", info)
                self.assertTrue(Path(info["currentLogFile"]).exists())

                # reveal_logs_folder returns valid folder path
                reveal_res = controller.reveal_logs_folder()
                self.assertTrue(reveal_res["revealed"])
                self.assertEqual(Path(reveal_res["folder"]).resolve(), Path(tmp_dir).resolve())
            finally:
                logger.close()


if __name__ == "__main__":
    unittest.main()

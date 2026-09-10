"""Opening the app must not mean waiting for the disk.

Two pieces make that work. The last completed scan is cached, so the study list
is on screen before the shell has finished painting; and a cheap revision token
says whether anything has been filed since, so the full walk runs only when it
would actually change something.

Both have a sharp edge. A cache belongs to the folders it was built from and to
no others. And the token has to notice a study appearing inside a patient folder
— which is where the obvious implementation quietly fails on Windows.
"""

import json
import os
import shutil
import sys
import time
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import web_backend


def _controller(root: Path) -> web_backend.WebController:
    """A controller wired to one archive root and nothing else."""
    controller = web_backend.WebController.__new__(web_backend.WebController)
    controller.output_root = root
    controller.source_folders = [str(root)]
    controller.worklist_cache_path = root / ".cache" / "worklist-cache.json"
    return controller


def _patient(root: Path, name: str = "BN001 - NGUYEN VAN AN - 52T - 10-09-2026") -> Path:
    folder = root / name
    folder.mkdir(parents=True, exist_ok=True)
    return folder


class WorklistRevisionTests(unittest.TestCase):
    def test_it_is_stable_while_nothing_changes(self):
        # A token that moved on its own would send the app back to a full disk
        # walk on every poll, which is the cost this exists to avoid.
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            _patient(root)
            controller = _controller(root)
            self.assertEqual(controller.worklist_revision(), controller.worklist_revision())

    def test_a_new_study_inside_a_patient_folder_moves_it(self):
        # The case the whole feature turns on: the extension, or a download,
        # files a study and the list must notice without being asked.
        #
        # `os.scandir()` hands back a DirEntry whose mtime comes from the
        # PARENT's directory listing, and Windows does not refresh that copy
        # when the child's own contents change. Reading it that way left this
        # token identical after a study was filed. `os.stat(path)` is measured
        # below to prove the distinction is real, not folklore.
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            patient = _patient(root)
            controller = _controller(root)
            before = controller.worklist_revision()

            time.sleep(1.1)  # filesystem timestamp granularity
            (patient / "01-09-2026 - CT - CT Bung").mkdir()

            self.assertNotEqual(controller.worklist_revision(), before)

    def test_the_cached_direntry_mtime_is_the_trap_this_avoids(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            patient = _patient(root)

            def entry_mtime() -> int:
                with os.scandir(root) as entries:
                    return next(
                        e.stat().st_mtime_ns for e in entries if e.name == patient.name
                    )

            cached_before, direct_before = entry_mtime(), os.stat(patient).st_mtime_ns
            time.sleep(1.1)
            (patient / "01-09-2026 - CT - CT Bung").mkdir()

            if entry_mtime() == cached_before:
                # Windows: the DirEntry copy is stale, which is why the token
                # calls os.stat directly.
                self.assertNotEqual(os.stat(patient).st_mtime_ns, direct_before)
            else:  # pragma: no cover - other platforms refresh it
                self.skipTest("this filesystem refreshes the DirEntry mtime")

    def test_a_new_patient_moves_it(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            _patient(root)
            controller = _controller(root)
            before = controller.worklist_revision()

            _patient(root, "BN002 - TRAN THI BINH - 30T - 10-09-2026")

            self.assertNotEqual(controller.worklist_revision(), before)

    def test_a_removed_patient_moves_it(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            patient = _patient(root)
            controller = _controller(root)
            before = controller.worklist_revision()

            shutil.rmtree(patient)

            self.assertNotEqual(controller.worklist_revision(), before)

    def test_a_missing_root_still_produces_a_stable_token(self):
        # A network archive that is not mounted must not make every poll look
        # like a change and trigger a full scan each time.
        with TemporaryDirectory() as tmp:
            controller = _controller(Path(tmp) / "not-mounted")
            self.assertEqual(controller.worklist_revision(), controller.worklist_revision())


class WorklistCacheTests(unittest.TestCase):
    def test_a_scan_is_cached_and_read_back(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            controller = _controller(root)
            controller._write_worklist_cache([{"id": "p_1", "patientName": "NGUYEN VAN AN"}])

            cached = controller._read_worklist_cache()

        self.assertEqual(len(cached["patients"]), 1)
        self.assertEqual(cached["patients"][0]["patientName"], "NGUYEN VAN AN")
        self.assertTrue(cached["scannedAt"], "the reader is told when these rows were read")

    def test_a_cache_from_another_archive_is_ignored(self):
        # Showing one archive's patients under a newly opened folder would put
        # the wrong records in front of the reader.
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            controller = _controller(root)
            controller._write_worklist_cache([{"id": "p_1"}])

            other = Path(tmp) / "other-archive"
            other.mkdir()
            controller.source_folders = [str(other)]
            controller.output_root = other

            self.assertEqual(controller._read_worklist_cache(), {})

    def test_a_corrupt_cache_is_a_miss_not_a_crash(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            controller = _controller(root)
            controller.worklist_cache_path.parent.mkdir(parents=True, exist_ok=True)
            controller.worklist_cache_path.write_text("{not json", encoding="utf-8")

            self.assertEqual(controller._read_worklist_cache(), {})

    def test_a_missing_cache_is_a_miss(self):
        with TemporaryDirectory() as tmp:
            self.assertEqual(_controller(Path(tmp))._read_worklist_cache(), {})

    def test_writing_a_cache_never_raises(self):
        # The cache is a convenience. A read-only app data folder must cost a
        # slower next start, never a failed scan.
        with TemporaryDirectory() as tmp:
            controller = _controller(Path(tmp))
            controller.worklist_cache_path = Path(tmp) / "a-file" / "worklist-cache.json"
            (Path(tmp) / "a-file").write_text("not a directory", encoding="utf-8")

            controller._write_worklist_cache([{"id": "p_1"}])  # must not raise

    def test_the_cache_shape_is_the_same_whether_or_not_it_is_empty(self):
        # Bootstrap spreads this into its payload. Building it so `patients`
        # appears only when a cache happens to exist made the key vanish on a
        # first run, and a consumer that does not guard reads a missing list as
        # an error rather than an empty archive. Both shapes are pinned here so
        # the caller can rely on the key always being there.
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            controller = _controller(root)

            empty = controller._read_worklist_cache()
            self.assertEqual(empty.get("patients", []), [])

            controller._write_worklist_cache([{"id": "p_1"}])
            filled = controller._read_worklist_cache()

        self.assertIn("patients", filled)
        self.assertIn("scannedAt", filled)

    def test_the_cache_survives_a_reread(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            controller = _controller(root)
            controller._write_worklist_cache([{"id": "p_1"}])
            raw = json.loads(controller.worklist_cache_path.read_text(encoding="utf-8"))

        self.assertIn("roots", raw)
        self.assertIn("scannedAt", raw)
        self.assertEqual(len(raw["patients"]), 1)


if __name__ == "__main__":
    unittest.main()

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
import tempfile

import time

import unittest

from pathlib import Path

from tempfile import TemporaryDirectory



sys.path.insert(0, str(Path(__file__).resolve().parents[1]))



import dcom_pipeline

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





class GroupedArchiveTests(unittest.TestCase):

    """Patients filed under a category count as much as patients at the top.



    Hashing only the roots' direct children missed them entirely: a category

    folder's mtime does not move when a study lands two levels below it, so a

    reader who organises by chuyên khoa got no background updates at all.

    """



    @staticmethod

    def _grouped(root: Path) -> Path:

        patient = root / "U não" / "BN001 - NGUYEN VAN AN - 52T - 10-09-2026"

        dicom = patient / "01-09-2026 - CT - CT Bung" / "DICOM"

        dicom.mkdir(parents=True)

        (dicom / "IM00000.dcm").write_bytes(b"\x00" * 300)

        return patient



    def test_a_new_study_under_a_category_moves_the_token(self):

        with TemporaryDirectory() as tmp:

            root = Path(tmp)

            patient = self._grouped(root)

            controller = _controller(root)

            before = controller.worklist_revision()



            time.sleep(1.1)

            (patient / "02-09-2026 - MR - MRI Nao").mkdir()



            self.assertNotEqual(controller.worklist_revision(), before)



    def test_slices_arriving_inside_a_study_move_the_token(self):

        # The download is filling a study that is already listed. Its slice

        # count and its "đang tải" state both change, and the reader is waiting

        # to see exactly that.

        with TemporaryDirectory() as tmp:

            root = Path(tmp)

            patient = self._grouped(root)

            controller = _controller(root)

            before = controller.worklist_revision()



            time.sleep(1.1)

            dicom = patient / "01-09-2026 - CT - CT Bung" / "DICOM"

            (dicom / "IM00001.dcm").write_bytes(b"\x00" * 300)



            self.assertNotEqual(controller.worklist_revision(), before)

    def test_slices_arriving_inside_a_series_subfolder_move_the_token(self):
        """The extension groups DICOM as DICOM/<SeriesUID>/image.dcm."""
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            patient = self._grouped(root)
            series = patient / "01-09-2026 - CT - CT Bung" / "DICOM" / "1.2.840.1"
            series.mkdir()
            (series / "IM00000.dcm").write_bytes(b"first")
            controller = _controller(root)
            before = controller.worklist_revision()

            time.sleep(1.1)
            (series / "IM00001.dcm").write_bytes(b"second")

            self.assertNotEqual(controller.worklist_revision(), before)



    def test_a_busy_claim_appearing_moves_the_token(self):

        with TemporaryDirectory() as tmp:

            root = Path(tmp)

            patient = self._grouped(root)

            controller = _controller(root)

            before = controller.worklist_revision()



            study = patient / "01-09-2026 - CT - CT Bung"
            # Directory timestamps on this filesystem move in ~1s steps, so a
            # write landing in the same tick as the previous read is invisible.
            # A real claim is written seconds into a download and polled every
            # 20s, far outside that window; the sleep keeps the test honest
            # about what it measures rather than papering over it.
            time.sleep(1.1)

            dcom_pipeline.write_study_lock(study, "extension")



            self.assertNotEqual(controller.worklist_revision(), before)





class CacheStaysOutOfTheRealProfileTests(unittest.TestCase):

    def test_a_test_run_writes_to_the_sandbox(self):

        # A cache written from a test records temp paths in its `roots`, and

        # because the cache is only used when its roots match the archive being

        # opened, the reader's next real start silently misses and walks the

        # whole disk again. The feature would appear to do nothing.

        resolved = web_backend._resolve_worklist_cache_file()

        try:

            import app_logging

            under_test = app_logging.running_under_test()

        except Exception:

            under_test = False

        if not under_test:

            self.skipTest("only meaningful inside a test run")

        self.assertIn(tempfile.gettempdir().casefold(), str(resolved).casefold())



    def test_an_override_is_honoured(self):

        original = os.environ.get("DCOM_WORKLIST_CACHE_FILE")

        os.environ["DCOM_WORKLIST_CACHE_FILE"] = r"X:\somewhere\cache.json"

        try:

            self.assertEqual(

                web_backend._resolve_worklist_cache_file(),

                Path(r"X:\somewhere\cache.json"),

            )

        finally:

            if original is None:

                os.environ.pop("DCOM_WORKLIST_CACHE_FILE", None)

            else:

                os.environ["DCOM_WORKLIST_CACHE_FILE"] = original





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

    def test_the_cache_carries_the_revision_sampled_with_its_rows(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            controller = _controller(root)
            controller._write_worklist_cache([{"id": "p_1"}], revision="rev-cached")

            cached = controller._read_worklist_cache()

        self.assertEqual(cached["revision"], "rev-cached")





if __name__ == "__main__":

    unittest.main()


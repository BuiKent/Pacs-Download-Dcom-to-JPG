"""Two tools, one study folder, no way to see each other's process.

The app and the browser extension can both be pointed at the same study. Neither
can see the other running, and what they share is the folder, so the claim lives
there as `.dcom-busy.json`.

Without it the app reads a study that is still arriving as one that failed
halfway — "Thiếu 40/120 ảnh" — which reads as a failure and invites a second
download over the top of the first. With it the reader sees "Extension đang
tải" and leaves it alone.

The claim expires. A browser killed mid download must not lock a study out of
the app forever, so a claim nobody renews stops counting.
"""

import contextlib
import json
import sys
import time
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import dcom_pipeline
import web_backend


class _StubJob:
    @staticmethod
    def snapshot() -> dict:
        return {}


class _StubController:
    job = _StubJob()


def _scan(study_dir: Path) -> dict:
    return web_backend.WorklistScanner(_StubController())._scan_study(study_dir, {}, None)


def _study_with_slices(root: Path, slices: int = 40) -> Path:
    study = root / "01-09-2026 - CT - CT Bung"
    dicom = study / "DICOM"
    dicom.mkdir(parents=True)
    for index in range(slices):
        (dicom / f"IM{index:05d}.dcm").write_bytes(b"\x00" * 300)
    return study


class StudyLockTests(unittest.TestCase):
    def test_an_unclaimed_study_reads_as_unclaimed(self):
        with TemporaryDirectory() as tmp:
            self.assertEqual(dcom_pipeline.read_study_lock(Path(tmp)), {})

    def test_a_claim_names_its_owner(self):
        with TemporaryDirectory() as tmp:
            folder = Path(tmp)
            dcom_pipeline.write_study_lock(folder, "extension", "Đang tải 120 ảnh")

            lock = dcom_pipeline.read_study_lock(folder)

        self.assertEqual(lock["owner"], "extension")
        self.assertEqual(lock["label"], "Đang tải 120 ảnh")

    def test_a_claim_nobody_renewed_expires(self):
        # The browser was killed mid download. The study must become available
        # again on its own rather than staying locked out forever.
        with TemporaryDirectory() as tmp:
            folder = Path(tmp)
            dcom_pipeline.write_study_lock(folder, "extension")

            later = time.time() + dcom_pipeline.STUDY_LOCK_TTL_SECONDS + 1

            self.assertEqual(dcom_pipeline.read_study_lock(folder, now=later), {})

    def test_renewing_keeps_a_long_download_claimed(self):
        with TemporaryDirectory() as tmp:
            folder = Path(tmp)
            dcom_pipeline.write_study_lock(folder, "extension")
            nearly_stale = time.time() + dcom_pipeline.STUDY_LOCK_TTL_SECONDS - 1

            dcom_pipeline.write_study_lock(folder, "extension", "Đang tải 800/2000 ảnh")

            self.assertTrue(dcom_pipeline.read_study_lock(folder, now=nearly_stale))

    def test_releasing_is_safe_when_there_is_nothing_to_release(self):
        with TemporaryDirectory() as tmp:
            dcom_pipeline.clear_study_lock(Path(tmp))  # must not raise

    def test_a_released_claim_is_gone(self):
        with TemporaryDirectory() as tmp:
            folder = Path(tmp)
            dcom_pipeline.write_study_lock(folder, "app")
            dcom_pipeline.clear_study_lock(folder)

            self.assertEqual(dcom_pipeline.read_study_lock(folder), {})

    def test_a_foreign_file_of_that_name_is_not_a_claim(self):
        with TemporaryDirectory() as tmp:
            folder = Path(tmp)
            dcom_pipeline.study_lock_path(folder).write_text(
                json.dumps({"owner": "someone"}), encoding="utf-8",
            )

            self.assertEqual(dcom_pipeline.read_study_lock(folder), {})

    def test_a_corrupt_claim_is_not_a_claim(self):
        with TemporaryDirectory() as tmp:
            folder = Path(tmp)
            dcom_pipeline.study_lock_path(folder).write_text("{not json", encoding="utf-8")

            self.assertEqual(dcom_pipeline.read_study_lock(folder), {})


class WorklistShowsTheClaimTests(unittest.TestCase):
    def test_a_study_the_extension_is_filling_reads_as_busy(self):
        with TemporaryDirectory() as tmp:
            study = _study_with_slices(Path(tmp))
            dcom_pipeline.write_study_lock(study, "extension", "Đang tải 40/120 ảnh")

            scanned = _scan(study)

        self.assertEqual(scanned["status"], "busy")
        self.assertEqual(scanned["statusLabel"], "Extension đang tải")

    def test_an_expired_claim_does_not_hold_the_study_busy(self):
        with TemporaryDirectory() as tmp:
            study = _study_with_slices(Path(tmp))
            stale = {
                "format": dcom_pipeline.STUDY_LOCK_FORMAT,
                "owner": "extension",
                "renewedAt": time.time() - dcom_pipeline.STUDY_LOCK_TTL_SECONDS - 60,
            }
            dcom_pipeline.study_lock_path(study).write_text(
                json.dumps(stale), encoding="utf-8",
            )

            self.assertEqual(_scan(study)["status"], "done")

    def test_an_unclaimed_study_keeps_its_own_verdict(self):
        with TemporaryDirectory() as tmp:
            study = _study_with_slices(Path(tmp))
            self.assertEqual(_scan(study)["status"], "done")

    def test_the_lock_file_is_not_counted_as_a_slice(self):
        # It sits beside the images, not inside DICOM, but a rule that counted
        # it would inflate the number the reader checks for completeness.
        with TemporaryDirectory() as tmp:
            study = _study_with_slices(Path(tmp), slices=40)
            dcom_pipeline.write_study_lock(study, "extension")

            self.assertEqual(_scan(study)["mediaCounts"]["dicom"], 40)


class MutualExclusionTests(unittest.TestCase):
    """A claim nobody enforces is a label. These pin the enforcement."""

    def test_a_second_owner_cannot_take_a_live_claim(self):
        with TemporaryDirectory() as tmp:
            folder = Path(tmp)
            self.assertTrue(dcom_pipeline.acquire_study_lock(folder, "extension"))
            self.assertIsNone(
                dcom_pipeline.acquire_study_lock(folder, "app"),
                "two writers in one study interleave partial files",
            )

    def test_the_same_owner_may_retake_its_own_folder(self):
        # A resumed download is the same tool coming back, not a second writer.
        with TemporaryDirectory() as tmp:
            folder = Path(tmp)
            dcom_pipeline.acquire_study_lock(folder, "app")
            self.assertTrue(dcom_pipeline.acquire_study_lock(folder, "app"))

    def test_an_expired_claim_can_be_taken_over(self):
        with TemporaryDirectory() as tmp:
            folder = Path(tmp)
            stale = {
                "format": dcom_pipeline.STUDY_LOCK_FORMAT,
                "owner": "extension",
                "claimId": "old",
                "renewedAt": time.time() - dcom_pipeline.STUDY_LOCK_TTL_SECONDS - 60,
            }
            dcom_pipeline.study_lock_path(folder).write_text(
                json.dumps(stale), encoding="utf-8",
            )
            self.assertTrue(dcom_pipeline.acquire_study_lock(folder, "app"))

    def test_one_job_cannot_release_another_job_s_claim(self):
        # Without an id, a finishing job clears whatever claim it finds — and
        # hands the folder to a third writer while two are already in it.
        with TemporaryDirectory() as tmp:
            folder = Path(tmp)
            live = dcom_pipeline.acquire_study_lock(folder, "extension")

            dcom_pipeline.clear_study_lock(folder, {"claimId": "someone-else"})

            self.assertTrue(dcom_pipeline.read_study_lock(folder))
            dcom_pipeline.clear_study_lock(folder, live)
            self.assertFalse(dcom_pipeline.read_study_lock(folder))

    def test_renewing_fails_once_the_claim_was_taken_over(self):
        with TemporaryDirectory() as tmp:
            folder = Path(tmp)
            ours = dcom_pipeline.acquire_study_lock(folder, "app")
            dcom_pipeline.write_study_lock(folder, "extension", claim_id="theirs")

            self.assertFalse(dcom_pipeline.renew_study_lock(folder, ours))

    def test_every_claim_gets_its_own_id(self):
        with TemporaryDirectory() as tmp:
            folder = Path(tmp)
            first = dcom_pipeline.acquire_study_lock(folder, "app")
            dcom_pipeline.clear_study_lock(folder, first)
            second = dcom_pipeline.acquire_study_lock(folder, "app")

        self.assertTrue(first["claimId"])
        self.assertNotEqual(first["claimId"], second["claimId"])


class PipelineHonoursTheClaimTests(unittest.TestCase):
    def test_the_app_refuses_a_folder_the_extension_is_filling(self):
        with TemporaryDirectory() as tmp:
            folder = Path(tmp) / "01-09-2026 - CT - CT Bung"
            folder.mkdir(parents=True)
            dcom_pipeline.acquire_study_lock(folder, "extension", "Đang tải 120 ảnh")

            with self.assertRaises(dcom_pipeline.StudyBusyError) as caught:
                dcom_pipeline.run_pipeline("https://pacs.example/viewer", folder)

        self.assertIn("Extension", str(caught.exception))

    def test_the_claim_never_outlives_the_job_that_took_it(self):
        # Including when the job fails: a claim left behind locks the study out
        # of both tools until it expires.
        with TemporaryDirectory() as tmp:
            folder = Path(tmp) / "01-09-2026 - CT - CT Bung"
            folder.mkdir(parents=True)

            with contextlib.suppress(Exception):
                dcom_pipeline.run_pipeline(
                    "https://khong-ton-tai.invalid/viewer", folder, log=lambda _m: None,
                )

            self.assertEqual(dcom_pipeline.read_study_lock(folder), {})


class AClaimNeverCreatesAStudyTests(unittest.TestCase):
    """Claiming a folder must not bring it into existence.

    A direct download starts against a `LINK_*` placeholder and the real
    destination is decided later, from the first DICOM's own tags. Writing the
    claim up front created the placeholder, so every direct download left an
    empty folder in the archive — which the worklist then lists as a study with
    no images in it, beside the real one.
    """

    def test_claiming_a_missing_folder_does_not_create_it(self):
        with TemporaryDirectory() as tmp:
            missing = Path(tmp) / "LINK_case"

            claim = dcom_pipeline.acquire_study_lock(missing, "app")

            self.assertFalse(missing.exists(), "no folder may appear just to hold a claim")
            self.assertTrue(claim, "the caller still gets a claim id to release with")

    def test_writing_a_claim_to_a_missing_folder_creates_nothing(self):
        with TemporaryDirectory() as tmp:
            missing = Path(tmp) / "nowhere"
            dcom_pipeline.write_study_lock(missing, "app")
            self.assertFalse(missing.exists())

    def test_a_claim_lands_once_the_folder_is_real(self):
        with TemporaryDirectory() as tmp:
            folder = Path(tmp) / "01-09-2026 - CT - CT Bung"
            claim = dcom_pipeline.acquire_study_lock(folder, "app")
            self.assertEqual(dcom_pipeline.read_study_lock(folder), {})

            folder.mkdir(parents=True)
            self.assertTrue(dcom_pipeline.renew_study_lock(folder, claim))
            self.assertEqual(dcom_pipeline.read_study_lock(folder)["owner"], "app")

    def test_a_direct_download_leaves_no_placeholder_behind(self):
        # The whole point, through the real entry point.
        with TemporaryDirectory() as tmp:
            placeholder = Path(tmp) / "LINK_case"

            with contextlib.suppress(Exception):
                dcom_pipeline.run_pipeline(
                    "https://khong-ton-tai.invalid/viewer",
                    placeholder,
                    log=lambda _m: None,
                )

            self.assertFalse(
                placeholder.exists(),
                "a download that never started must not leave a folder in the archive",
            )


if __name__ == "__main__":
    unittest.main()

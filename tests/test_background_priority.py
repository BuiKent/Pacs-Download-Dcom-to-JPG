"""Yielding CPU during a conversion must not demote the reader's own window.

Converting thousands of slices pins a core, and the machine feels stuck. The
first attempt at fixing that lowered the whole process, which shares itself
with the UI the reader is clicking — so the fix made the app it was meant to
protect slower, and never restored the priority afterwards.

Jobs run on their own short-lived thread (`JobState.start` spawns `dcom-<kind>`),
so the change belongs on the calling thread: it covers exactly the work, leaves
every other thread alone, and unwinds by itself when the job ends.
"""

import ctypes
import sys
import threading
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import dcom_pipeline

IS_WINDOWS = sys.platform == "win32"
THREAD_PRIORITY_NORMAL = 0
THREAD_PRIORITY_ABOVE_NORMAL = 1


THREAD_PRIORITY_ERROR_RETURN = 0x7FFFFFFF


def _current_thread_priority() -> int:
    kernel32 = ctypes.windll.kernel32  # type: ignore[attr-defined]
    kernel32.GetCurrentThread.restype = ctypes.c_void_p
    kernel32.GetThreadPriority.argtypes = [ctypes.c_void_p]
    kernel32.GetThreadPriority.restype = ctypes.c_int
    value = kernel32.GetThreadPriority(kernel32.GetCurrentThread())
    if value == THREAD_PRIORITY_ERROR_RETURN:
        raise OSError("GetThreadPriority failed")
    return value


class BackgroundThreadPriorityTests(unittest.TestCase):
    def test_it_is_a_no_op_that_never_raises(self):
        # Called at the top of `run_pipeline`, before anything is downloaded.
        # Raising here would take the whole job down with it.
        try:
            dcom_pipeline.set_background_thread_priority()
        finally:
            dcom_pipeline.restore_thread_priority(THREAD_PRIORITY_NORMAL)

    @unittest.skipUnless(IS_WINDOWS, "thread priorities are a Windows API")
    def test_pipeline_restores_the_callers_exact_previous_priority(self):
        observed = {}

        def worker() -> None:
            dcom_pipeline._set_thread_priority(THREAD_PRIORITY_ABOVE_NORMAL)
            try:
                with TemporaryDirectory() as tmp, patch(
                    "dcom_pipeline._run_pipeline_unlocked",
                    side_effect=lambda *_args, **_kwargs: (
                        dcom_pipeline.set_background_thread_priority(), None, Path(tmp) / "JPG"
                    ),
                ):
                    dcom_pipeline.run_pipeline(
                        "https://viewer.test/study", Path(tmp), log=lambda _m: None,
                    )
                observed["after"] = _current_thread_priority()
            finally:
                dcom_pipeline._set_thread_priority(THREAD_PRIORITY_NORMAL)

        thread = threading.Thread(target=worker, name="dcom-priority-restore")
        thread.start()
        thread.join()

        self.assertEqual(observed["after"], THREAD_PRIORITY_ABOVE_NORMAL)

    @unittest.skipUnless(IS_WINDOWS, "thread priorities are a Windows API")
    def test_it_lowers_the_calling_thread(self):
        observed = {}

        def worker() -> None:
            observed["before"] = _current_thread_priority()
            dcom_pipeline.set_background_thread_priority()
            observed["after"] = _current_thread_priority()

        thread = threading.Thread(target=worker, name="dcom-test")
        thread.start()
        thread.join()

        self.assertEqual(observed["before"], THREAD_PRIORITY_NORMAL)
        self.assertEqual(
            observed["after"], dcom_pipeline._THREAD_PRIORITY_BELOW_NORMAL,
        )

    @unittest.skipUnless(IS_WINDOWS, "thread priorities are a Windows API")
    def test_it_leaves_every_other_thread_alone(self):
        # The regression. A worker that yields CPU must not drag the thread
        # serving the reader's window down with it.
        before = _current_thread_priority()

        thread = threading.Thread(
            target=dcom_pipeline.set_background_thread_priority, name="dcom-test",
        )
        thread.start()
        thread.join()

        self.assertEqual(
            _current_thread_priority(),
            before,
            "lowering a job thread must not change the calling thread's priority",
        )

    @unittest.skipUnless(IS_WINDOWS, "thread priorities are a Windows API")
    def test_the_priority_does_not_outlive_the_job_thread(self):
        # No restore call exists, and none is needed: a fresh thread starts at
        # normal priority whatever the previous job did.
        first, second = {}, {}

        def job(record: dict) -> None:
            dcom_pipeline.set_background_thread_priority()
            record["end"] = _current_thread_priority()

        def fresh(record: dict) -> None:
            record["start"] = _current_thread_priority()

        run_first = threading.Thread(target=job, args=(first,), name="dcom-job1")
        run_first.start()
        run_first.join()
        run_second = threading.Thread(target=fresh, args=(second,), name="dcom-job2")
        run_second.start()
        run_second.join()

        self.assertEqual(first["end"], dcom_pipeline._THREAD_PRIORITY_BELOW_NORMAL)
        self.assertEqual(second["start"], THREAD_PRIORITY_NORMAL)


if __name__ == "__main__":
    unittest.main()

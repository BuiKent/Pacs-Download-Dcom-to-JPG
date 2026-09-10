"""What the worklist counts as a slice, and what it refuses to open to find out.

The count is what tells a reader whether a study came down complete, so it has
to reject anything that is not an image — and it walks every file in the
archive, so it has to reject cheaply where it can.

The size floor is the free half: `_scan_study` already stats every file to
total a study's size, and nothing shorter than a 128-byte preamble plus the
four-byte magic can be Part-10. The header read is the half that costs, and it
is the only one that catches the case that actually happens: a PACS error page
saved under a `.dcm` name.
"""

import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import dicom_io
from tests.dicom_test_utils import write_test_dicom

# What a PACS actually returns when a retrieve fails. Comfortably longer than
# the size floor, which is why the floor alone cannot be the whole test.
HTML_ERROR_PAGE = (
    b"<!DOCTYPE html><html><head><title>500 Internal Server Error</title></head>"
    b"<body><h1>500 Internal Server Error</h1><p>The server encountered an error"
    b" retrieving the requested instance.</p></body></html>"
)


class SizeFloorTests(unittest.TestCase):
    def test_an_empty_file_is_rejected_without_opening_it(self):
        with TemporaryDirectory() as tmp:
            empty = Path(tmp) / "IM00001.dcm"
            empty.write_bytes(b"")

            self.assertFalse(dicom_io.looks_like_dicom_file(empty))

    def test_a_file_shorter_than_the_preamble_is_rejected(self):
        with TemporaryDirectory() as tmp:
            stub = Path(tmp) / "IM00001.dcm"
            stub.write_bytes(b"\x00" * (dicom_io.DICOM_MIN_PART10_BYTES - 1))

            self.assertFalse(dicom_io.looks_like_dicom_file(stub))

    def test_a_caller_that_already_knows_the_size_may_pass_it(self):
        # `_scan_study` stats every file for the study total; making it stat
        # again to answer this would double the walk's syscalls.
        with TemporaryDirectory() as tmp:
            empty = Path(tmp) / "IM00001.dcm"
            empty.write_bytes(b"")

            self.assertFalse(dicom_io.looks_like_dicom_file(empty, size=0))

    def test_a_wrong_size_hint_never_promotes_a_non_image(self):
        # The hint may only reject. Anything it lets through still has to prove
        # itself by its header.
        with TemporaryDirectory() as tmp:
            junk = Path(tmp) / "IM00001.dcm"
            junk.write_bytes(HTML_ERROR_PAGE)

            self.assertFalse(dicom_io.looks_like_dicom_file(junk, size=10_000_000))

    def test_a_real_slice_still_counts(self):
        with TemporaryDirectory() as tmp:
            slice_path = Path(tmp) / "IM00001.dcm"
            write_test_dicom(slice_path)

            self.assertTrue(dicom_io.looks_like_dicom_file(slice_path))
            self.assertTrue(
                dicom_io.looks_like_dicom_file(slice_path, size=slice_path.stat().st_size)
            )


class OnlyTheHeaderCatchesAnErrorPageTests(unittest.TestCase):
    """The measurement behind keeping the header read.

    A size floor was proposed as a cheaper substitute. It is not one: an error
    page clears the floor by a wide margin, and counting it tells the reader a
    study is complete when an image is missing.
    """

    def test_an_error_page_named_dcm_clears_the_size_floor(self):
        self.assertGreater(len(HTML_ERROR_PAGE), dicom_io.DICOM_MIN_PART10_BYTES)

    def test_but_is_still_refused(self):
        with TemporaryDirectory() as tmp:
            page = Path(tmp) / "IM00001.dcm"
            page.write_bytes(HTML_ERROR_PAGE)

            self.assertFalse(dicom_io.looks_like_dicom_file(page))

    def test_a_dicomdir_index_is_not_a_slice(self):
        with TemporaryDirectory() as tmp:
            index = Path(tmp) / "DICOMDIR"
            write_test_dicom(index)

            self.assertFalse(dicom_io.looks_like_dicom_file(index))


if __name__ == "__main__":
    unittest.main()

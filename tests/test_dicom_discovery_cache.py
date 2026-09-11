"""Opening a record twice must not re-read a header per slice.

The catalog has cached its parsed metadata for a long time, but the cache was
consulted *after* `discover_dicom_files`, which opens every candidate file and
reads its header to decide whether it is really DICOM. On a 1400-slice study
that walk is the entire cost of opening a record, and it was paid again on
every open, in front of the reader — which is why a record that had already
been opened was still slow to open.

The tree signature these tests pin down is what lets the discovered list be
reused. It has to be cheap, it has to move when the images move, and it must
not move when the app writes its own bookkeeping beside them.
"""

import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import web_backend
from dicom_test_utils import write_test_dicom


class CountingDiscovery:
    """Wrap the real discovery so a test can see whether it ran."""

    def __init__(self):
        self.calls = 0
        self._real = web_backend.discover_dicom_files

    def __enter__(self):
        def counted(root):
            self.calls += 1
            return self._real(root)

        web_backend.discover_dicom_files = counted
        return self

    def __exit__(self, *exc):
        web_backend.discover_dicom_files = self._real
        return False


def _study(root: Path, slices: int = 3) -> None:
    for index in range(slices):
        write_test_dicom(root / "DICOM" / f"slice{index}.dcm")


def _records(root: Path):
    return web_backend.ArchiveCatalog._dicom_records(root)


class DiscoveryCacheTests(unittest.TestCase):
    def setUp(self):
        web_backend._DICOM_MEM_CACHE.clear()

    def tearDown(self):
        web_backend._DICOM_MEM_CACHE.clear()

    def test_reopening_a_record_does_not_walk_the_headers_again(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _study(root)
            with CountingDiscovery() as discovery:
                first, _, total = _records(root)
                self.assertEqual(discovery.calls, 1)
                self.assertTrue(first)
                second, _, second_total = _records(root)
                self.assertEqual(
                    discovery.calls,
                    1,
                    "the second open must be served from cache, not from disk",
                )
            self.assertEqual(total, second_total)
            self.assertEqual(set(first), set(second))

    def test_the_disk_cache_survives_a_restart(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _study(root)
            with CountingDiscovery() as discovery:
                _records(root)
                self.assertEqual(discovery.calls, 1)
                # A restart keeps the folder and loses the process memory.
                web_backend._DICOM_MEM_CACHE.clear()
                records, _, _ = _records(root)
                self.assertEqual(
                    discovery.calls,
                    1,
                    "the on-disk cache must spare the walk after a restart too",
                )
                self.assertTrue(records)

    def test_a_new_slice_invalidates_the_cache(self):
        """A part-downloaded study that grew must be re-read, not remembered.

        Serving a stale list here would under-count a study's slices, which is
        the one thing this cache must never do.
        """
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _study(root, slices=2)
            with CountingDiscovery() as discovery:
                _, _, before = _records(root)
                write_test_dicom(root / "DICOM" / "slice2.dcm")
                _, _, after = _records(root)
                self.assertEqual(discovery.calls, 2)
            self.assertEqual(before, 2)
            self.assertEqual(after, 3)

    def test_a_removed_slice_invalidates_the_cache(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _study(root, slices=3)
            with CountingDiscovery() as discovery:
                _, _, before = _records(root)
                (root / "DICOM" / "slice2.dcm").unlink()
                _, _, after = _records(root)
                self.assertEqual(discovery.calls, 2)
            self.assertEqual(before, 3)
            self.assertEqual(after, 2)

    def test_the_download_heartbeat_does_not_invalidate_the_cache(self):
        """`.dcom-busy.json` is rewritten every 60 seconds while a study downloads.

        Counting it would move the signature on every heartbeat, so a record
        being written to could never be opened from cache.
        """
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _study(root)
            with CountingDiscovery() as discovery:
                _records(root)
                web_backend._DICOM_MEM_CACHE.clear()
                (root / ".dcom-busy.json").write_text(
                    json.dumps({"heartbeat": 1}), encoding="utf-8"
                )
                _records(root)
                self.assertEqual(discovery.calls, 1)

    def test_writing_the_cache_does_not_invalidate_the_cache(self):
        """The cache file lives inside the folder it describes.

        Counting it would move the signature the moment it was written, and the
        cache would miss on every single open — the bug it exists to fix.
        """
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _study(root)
            _records(root)
            self.assertTrue(web_backend._get_dicom_cache_path(root).is_file())
            before = web_backend._dicom_tree_signature(root)
            web_backend._DICOM_MEM_CACHE.clear()
            _records(root)
            self.assertEqual(before, web_backend._dicom_tree_signature(root))

    def test_a_cache_from_an_older_schema_is_ignored(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _study(root)
            signature = web_backend._dicom_tree_signature(root)
            web_backend._get_dicom_cache_path(root).write_text(
                json.dumps(
                    {"schema": 1, "treeSignature": signature, "records": {}}
                ),
                encoding="utf-8",
            )
            with CountingDiscovery() as discovery:
                records, _, _ = _records(root)
                self.assertEqual(discovery.calls, 1)
            self.assertTrue(records, "an old cache must be rebuilt, not trusted")


if __name__ == "__main__":
    unittest.main()

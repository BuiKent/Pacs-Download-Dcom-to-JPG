import unittest

from tools.smoke_webview import _cross_plane_pair


def series(series_id: str, orientation: list[float], frame_uid: str = "1.2.3") -> dict:
    return {
        "id": series_id,
        "geometry": {
            "orientation": orientation,
            "frameOfReferenceUID": frame_uid,
        },
    }


class SmokeArchiveSelectionTests(unittest.TestCase):
    def test_finds_cross_plane_pair_in_same_frame_of_reference(self):
        axial = series("axial", [1, 0, 0, 0, 1, 0])
        another_axial = series("axial-2", [1, 0, 0, 0, 1, 0])
        coronal = series("coronal", [1, 0, 0, 0, 0, -1])

        self.assertEqual(
            ("axial", "coronal"),
            _cross_plane_pair([axial, another_axial, coronal]),
        )

    def test_rejects_parallel_or_different_frame_pairs(self):
        axial = series("axial", [1, 0, 0, 0, 1, 0], "for-a")
        parallel = series("parallel", [1, 0, 0, 0, 1, 0], "for-a")
        coronal_other_frame = series(
            "coronal", [1, 0, 0, 0, 0, -1], "for-b"
        )

        self.assertIsNone(
            _cross_plane_pair([axial, parallel, coronal_other_frame])
        )

    def test_ignores_missing_or_degenerate_geometry(self):
        missing = {"id": "missing"}
        degenerate = series("bad", [1, 0, 0, 2, 0, 0])
        coronal = series("coronal", [1, 0, 0, 0, 0, -1])

        self.assertIsNone(_cross_plane_pair([missing, degenerate, coronal]))


if __name__ == "__main__":
    unittest.main()

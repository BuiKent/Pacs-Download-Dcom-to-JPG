from __future__ import annotations

import unittest

from PIL import Image

import viewer_layout


class ViewerLayoutTests(unittest.TestCase):
    def test_compare_uses_equal_tiles_and_marks_active_pane(self):
        left = Image.new("RGB", (32, 24), (120, 10, 10))
        right = Image.new("RGB", (20, 40), (10, 120, 10))

        output = viewer_layout.compose_compare(
            left,
            right,
            left_label="L 1/12",
            right_label="R 2/9",
            active="right",
        )

        self.assertIsNotNone(output)
        self.assertEqual((70, 40), output.size)
        self.assertEqual(viewer_layout.EMPTY_BORDER, output.getpixel((0, 0)))
        self.assertEqual(viewer_layout.ACTIVE_BORDER, output.getpixel((38, 0)))

    def test_montage_six_and_eight_keep_fixed_grid_near_series_end(self):
        images = [Image.new("RGB", (32, 24), (index * 20, 0, 0)) for index in range(4)]

        six = viewer_layout.compose_montage(images, count=6)
        eight = viewer_layout.compose_montage(images, count=8)

        self.assertIsNotNone(six)
        self.assertIsNotNone(eight)
        self.assertEqual((108, 54), six.size)
        self.assertEqual((146, 54), eight.size)
        self.assertEqual(viewer_layout.BACKGROUND, six.getpixel((80, 40)))
        self.assertEqual(viewer_layout.BACKGROUND, eight.getpixel((120, 40)))

    def test_montage_rejects_unsupported_count(self):
        with self.assertRaises(ValueError):
            viewer_layout.compose_montage([Image.new("RGB", (1, 1))], count=4)


if __name__ == "__main__":
    unittest.main()
"""Unit tests for photo_engine.py using unittest."""

import os
import shutil
import tempfile
import unittest
from pathlib import Path

from PIL import Image, ImageDraw

import photo_engine as pe


class TestPhotoEngine(unittest.TestCase):
    def setUp(self):
        self.test_dir = tempfile.mkdtemp()
        self.sample_scan = Path(self.test_dir) / "scan.jpg"
        img = Image.new("RGB", (800, 1000), "white")
        draw = ImageDraw.Draw(img)
        draw.rectangle((50, 50, 750, 120), outline="black", width=2)
        draw.text((70, 70), "TEST PATIENT NAME 123456", fill="black")
        draw.rectangle((50, 200, 750, 900), outline="gray", width=1)
        img.save(self.sample_scan, quality=90)

    def tearDown(self):
        shutil.rmtree(self.test_dir, ignore_errors=True)

    def test_probe(self):
        info = pe.probe(self.sample_scan)
        self.assertEqual(info.width, 800)
        self.assertEqual(info.height, 1000)
        self.assertIn(info.format, ["JPEG", "JPG"])

    def test_probe_missing_file_raises(self):
        with self.assertRaises(pe.PhotoEngineError):
            pe.probe(Path(self.test_dir) / "nonexistent.jpg")

    def test_probe_unsupported_format(self):
        doc = Path(self.test_dir) / "test.txt"
        doc.write_text("hello", encoding="utf-8")
        with self.assertRaises(pe.UnsupportedFormatError):
            pe.probe(doc)

    def test_thumbnail(self):
        out = Path(self.test_dir) / "thumb.jpg"
        pe.make_thumbnail(self.sample_scan, out, max_size=200)
        with Image.open(out) as thumb:
            self.assertLessEqual(max(thumb.width, thumb.height), 200)

    def test_crop(self):
        out = Path(self.test_dir) / "cropped.jpg"
        pe.crop(self.sample_scan, out, pe.Rect(x=50, y=50, width=300, height=200))
        with Image.open(out) as cropped:
            self.assertEqual(cropped.width, 300)
            self.assertEqual(cropped.height, 200)

    def test_crop_invalid_region(self):
        out = Path(self.test_dir) / "cropped.jpg"
        with self.assertRaises(pe.InvalidRegionError):
            pe.crop(self.sample_scan, out, pe.Rect(x=700, y=900, width=500, height=500))

    def test_rotate(self):
        out = Path(self.test_dir) / "rotated.jpg"
        pe.rotate(self.sample_scan, out, 90)
        with Image.open(out) as rotated:
            self.assertEqual(rotated.width, 1000)
            self.assertEqual(rotated.height, 800)

    def test_redact(self):
        out = Path(self.test_dir) / "redacted.jpg"
        region = pe.Rect(x=70, y=70, width=400, height=40)
        pe.redact(self.sample_scan, out, [region], fill=(0, 0, 0))
        with Image.open(out) as img:
            rgb = img.convert("RGB")
            # Check center of redacted region is black
            pixel = rgb.getpixel((200, 85))
            self.assertEqual(pixel, (0, 0, 0))

    def test_annotate(self):
        out = Path(self.test_dir) / "annotated.jpg"
        pe.annotate(
            self.sample_scan,
            out,
            texts=[pe.TextAnnotation(text="Ghi chu", x=100, y=100, font_size=20)],
            arrows=[pe.ArrowAnnotation(x1=100, y1=100, x2=200, y2=200)],
            boxes=[pe.BoxAnnotation(rect=pe.Rect(x=50, y=50, width=100, height=100))],
        )
        self.assertTrue(out.exists())

    def test_export_pdf(self):
        out = Path(self.test_dir) / "output.pdf"
        pe.export_pdf([self.sample_scan], out)
        self.assertTrue(out.exists())
        self.assertGreater(out.stat().st_size, 0)

    def test_edit_session(self):
        session = pe.EditSession(self.sample_scan)
        session.push(pe.EditOp(kind="rotate", params={"degrees": 90}))
        session.push(pe.EditOp(kind="crop", params={"x": 0, "y": 0, "width": 500, "height": 400}))
        out = Path(self.test_dir) / "session_out.jpg"
        session.render(out)
        with Image.open(out) as img:
            self.assertEqual(img.width, 500)
            self.assertEqual(img.height, 400)


if __name__ == "__main__":
    unittest.main()

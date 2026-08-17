"""pytest for photo_engine.py, running real Pillow on a generated sample image."""

from pathlib import Path

import pytest
from PIL import Image, ImageDraw

import photo_engine as pe


@pytest.fixture(scope="module")
def sample_scan(tmp_path_factory):
    """A mock scanned chart carrying one line of "sensitive" text to redact."""
    out_dir = tmp_path_factory.mktemp("photo_fixtures")
    path = out_dir / "scan.jpg"
    img = Image.new("RGB", (800, 1000), "white")
    draw = ImageDraw.Draw(img)
    draw.rectangle((50, 50, 750, 120), outline="black", width=2)
    draw.text((70, 70), "TEST PATIENT NAME 123456", fill="black")
    draw.rectangle((50, 200, 750, 900), outline="gray", width=1)
    img.save(path, quality=90)
    return path


@pytest.fixture(scope="module")
def sample_no_alpha_png(tmp_path_factory):
    out_dir = tmp_path_factory.mktemp("photo_fixtures_png")
    path = out_dir / "clinical.png"
    img = Image.new("RGB", (400, 300), "gray")
    img.save(path)
    return path


class TestProbe:
    def test_reads_correct_dimensions(self, sample_scan):
        info = pe.probe(sample_scan)
        assert info.width == 800
        assert info.height == 1000

    def test_missing_file_raises(self):
        with pytest.raises(pe.PhotoEngineError):
            pe.probe("/nonexistent/scan.jpg")

    def test_unsupported_extension_rejected(self, tmp_path):
        fake = tmp_path / "doc.txt"
        fake.write_text("not an image")
        with pytest.raises(pe.UnsupportedFormatError):
            pe.probe(fake)


class TestThumbnail:
    def test_shrinks_to_max_size(self, sample_scan, tmp_path):
        out = tmp_path / "thumb.jpg"
        pe.make_thumbnail(sample_scan, out, max_size=200)
        with Image.open(out) as thumb:
            assert max(thumb.width, thumb.height) <= 200


class TestCrop:
    def test_crop_produces_correct_dimensions(self, sample_scan, tmp_path):
        out = tmp_path / "cropped.jpg"
        pe.crop(sample_scan, out, pe.Rect(x=50, y=50, width=300, height=200))
        with Image.open(out) as cropped:
            assert cropped.width == 300
            assert cropped.height == 200

    def test_region_outside_bounds_rejected(self, sample_scan, tmp_path):
        with pytest.raises(pe.InvalidRegionError):
            pe.crop(sample_scan, tmp_path / "bad.jpg", pe.Rect(x=700, y=900, width=500, height=500))

    def test_negative_size_rejected(self, sample_scan, tmp_path):
        with pytest.raises(pe.InvalidRegionError):
            pe.crop(sample_scan, tmp_path / "bad.jpg", pe.Rect(x=0, y=0, width=-10, height=10))

    def test_output_never_overwrites_source(self, sample_scan, tmp_path):
        original_bytes = sample_scan.read_bytes()
        pe.crop(sample_scan, tmp_path / "out.jpg", pe.Rect(x=0, y=0, width=100, height=100))
        assert sample_scan.read_bytes() == original_bytes


class TestRotate:
    def test_90_degrees_swaps_dimensions(self, sample_scan, tmp_path):
        out = tmp_path / "rotated.jpg"
        pe.rotate(sample_scan, out, 90)
        with Image.open(out) as rotated:
            assert rotated.width == 1000
            assert rotated.height == 800

    def test_non_multiple_of_90_rejected(self, sample_scan, tmp_path):
        with pytest.raises(pe.PhotoEngineError):
            pe.rotate(sample_scan, tmp_path / "x.jpg", 45)


class TestRedact:
    def test_pixels_are_actually_overwritten_not_overlaid(self, sample_scan, tmp_path):
        """Redaction must destroy pixels, not cover them.

        The masked region has to be solid fill with no trace of the original
        content, unlike a display overlay that the UI could simply remove.
        """
        out = tmp_path / "redacted.jpg"
        region = pe.Rect(x=70, y=70, width=400, height=40)
        pe.redact(sample_scan, out, [region], fill=(0, 0, 0))
        with Image.open(out) as redacted:
            redacted = redacted.convert("RGB")
            # Sample several points inside the mask. JPEG is lossy, so allow a
            # small tolerance around pure black instead of demanding (0,0,0).
            for dx in (10, 100, 200, 300, 390):
                for dy in (5, 15, 25, 35):
                    pixel = redacted.getpixel((region.x + dx, region.y + dy))
                    assert all(c <= 8 for c in pixel), \
                        f"pixel at ({dx},{dy}) inside the mask should be near-black, got {pixel}"

    def test_area_outside_region_untouched(self, sample_scan, tmp_path):
        out = tmp_path / "redacted2.jpg"
        pe.redact(sample_scan, out, [pe.Rect(x=70, y=70, width=100, height=20)], fill=(0, 0, 0))
        with Image.open(out) as redacted, Image.open(sample_scan) as original:
            redacted, original = redacted.convert("RGB"), original.convert("RGB")
            # A point outside the mask (lower area, white background) must survive
            assert redacted.getpixel((400, 950)) == original.getpixel((400, 950))

    def test_empty_region_list_rejected(self, sample_scan, tmp_path):
        with pytest.raises(pe.PhotoEngineError):
            pe.redact(sample_scan, tmp_path / "x.jpg", [])

    def test_custom_fill_color_applied(self, sample_scan, tmp_path):
        out = tmp_path / "redacted_red.jpg"
        region = pe.Rect(x=100, y=100, width=50, height=50)
        pe.redact(sample_scan, out, [region], fill=(255, 0, 0))
        with Image.open(out) as redacted:
            pixel = redacted.convert("RGB").getpixel((region.x + 25, region.y + 25))
            # JPEG is mildly lossy, so allow a small drift around pure red
            assert pixel[0] > 200 and pixel[1] < 60 and pixel[2] < 60


class TestAnnotate:
    def test_vietnamese_text_does_not_crash(self, sample_scan, tmp_path):
        out = tmp_path / "annotated.jpg"
        result = pe.annotate(
            sample_scan, out,
            texts=[pe.TextAnnotation(text="Tổn thương nghi ngờ ở góc phần tư trên", x=100, y=300)],
        )
        assert result.exists()

    def test_arrow_and_box_together(self, sample_scan, tmp_path):
        out = tmp_path / "annotated2.jpg"
        result = pe.annotate(
            sample_scan, out,
            arrows=[pe.ArrowAnnotation(x1=100, y1=100, x2=300, y2=300)],
            boxes=[pe.BoxAnnotation(rect=pe.Rect(x=200, y=200, width=100, height=100))],
        )
        assert result.exists()

    def test_box_outside_bounds_rejected(self, sample_scan, tmp_path):
        with pytest.raises(pe.InvalidRegionError):
            pe.annotate(
                sample_scan, tmp_path / "x.jpg",
                boxes=[pe.BoxAnnotation(rect=pe.Rect(x=700, y=900, width=500, height=500))],
            )


class TestExportPdf:
    def test_multi_page_pdf_created(self, sample_scan, sample_no_alpha_png, tmp_path):
        out = tmp_path / "export.pdf"
        result = pe.export_pdf([sample_scan, sample_no_alpha_png], out)
        assert result.exists()
        assert result.stat().st_size > 0

    def test_empty_list_rejected(self, tmp_path):
        with pytest.raises(pe.PhotoEngineError):
            pe.export_pdf([], tmp_path / "x.pdf")


class TestEditSession:
    def test_multi_step_session_renders_correctly(self, sample_scan, tmp_path):
        session = pe.EditSession(sample_scan)
        session.push(pe.EditOp(kind="rotate", params={"degrees": 90}))
        session.push(pe.EditOp(kind="redact", params={
            "regions": [{"x": 70, "y": 70, "width": 100, "height": 20}],
            "fill": [0, 0, 0],
        }))
        out = tmp_path / "session_result.jpg"
        result = session.render(out)
        with Image.open(result) as img:
            # after a 90 degree rotation the 800x1000 source swaps dimensions
            assert img.width == 1000
            assert img.height == 800

    def test_serialize_and_reload_preserves_ops(self, sample_scan, tmp_path):
        session = pe.EditSession(sample_scan)
        session.push(pe.EditOp(kind="crop", params={"x": 0, "y": 0, "width": 200, "height": 200}))
        json_str = session.to_json()

        reloaded = pe.EditSession.from_json(sample_scan, json_str)
        assert len(reloaded.ops) == 1
        assert reloaded.ops[0].kind == "crop"

        out = tmp_path / "reloaded.jpg"
        reloaded.render(out)
        with Image.open(out) as img:
            assert img.width == 200

    def test_undo_removes_last_op(self, sample_scan):
        session = pe.EditSession(sample_scan)
        session.push(pe.EditOp(kind="rotate", params={"degrees": 90}))
        session.push(pe.EditOp(kind="rotate", params={"degrees": 90}))
        undone = session.undo()
        assert undone.kind == "rotate"
        assert len(session.ops) == 1

    def test_render_does_not_leave_temp_files(self, sample_scan, tmp_path):
        session = pe.EditSession(sample_scan)
        session.push(pe.EditOp(kind="rotate", params={"degrees": 90}))
        out = tmp_path / "clean_result.jpg"
        session.render(out)
        tmp_dir = out.parent / ".tmp_session"
        leftover = list(tmp_dir.glob("step_*.png")) if tmp_dir.exists() else []
        assert not leftover, "intermediate files must be cleaned up once the render finishes"

    def test_original_file_never_modified_across_session(self, sample_scan, tmp_path):
        original_bytes = sample_scan.read_bytes()
        session = pe.EditSession(sample_scan)
        session.push(pe.EditOp(kind="rotate", params={"degrees": 90}))
        session.push(pe.EditOp(kind="redact", params={
            "regions": [{"x": 0, "y": 0, "width": 50, "height": 50}], "fill": [0, 0, 0],
        }))
        session.render(tmp_path / "out.jpg")
        assert sample_scan.read_bytes() == original_bytes

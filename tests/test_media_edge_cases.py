"""Edge-case suite: files lying about their extension, empty files, oversized
files, decompression bombs, and special or injection characters in filenames.
"""

import subprocess
import time
from pathlib import Path

import pytest
from PIL import Image

import photo_engine as pe
import video_engine as ve


# ===========================================================================
# Video: forged, empty, and truncated files
# ===========================================================================

class TestVideoMalformedInput:
    def test_text_file_renamed_to_mp4_fails_fast(self, tmp_path):
        fake = tmp_path / "fake.mp4"
        fake.write_text("not a video, just plain text")
        t0 = time.time()
        with pytest.raises(ve.ProbeFailedError):
            ve.probe(fake)
        assert time.time() - t0 < 5, "probing a forged file must fail fast, not hang"

    def test_empty_file_with_video_extension_rejected(self, tmp_path):
        empty = tmp_path / "empty.mp4"
        empty.touch()
        with pytest.raises(ve.ProbeFailedError):
            ve.probe(empty)

    def test_truncated_video_mid_file_rejected(self, tmp_path):
        valid = tmp_path / "valid.mp4"
        subprocess.run([
            ve._ffmpeg(), "-y", "-f", "lavfi", "-i", "testsrc2=size=320x240:rate=15:duration=3",
            "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", str(valid),
        ], check=True, capture_output=True)

        truncated = tmp_path / "truncated.mp4"
        original_bytes = valid.read_bytes()
        truncated.write_bytes(original_bytes[: len(original_bytes) // 3])

        t0 = time.time()
        try:
            ve.probe(truncated)
        except ve.ProbeFailedError:
            pass
        assert time.time() - t0 < 10

    def test_zero_byte_file_various_extensions(self, tmp_path):
        for ext in [".avi", ".mkv", ".mpeg", ".mov"]:
            f = tmp_path / f"empty{ext}"
            f.touch()
            with pytest.raises(ve.ProbeFailedError):
                ve.probe(f)

    def test_directory_passed_as_video_path_rejected_cleanly(self, tmp_path):
        a_directory = tmp_path / "not_a_file"
        a_directory.mkdir()
        with pytest.raises(ve.VideoEngineError):
            ve.probe(a_directory)


# ===========================================================================
# Video: hostile filenames and paths
# ===========================================================================

class TestVideoDangerousFilenames:
    @pytest.mark.parametrize("dangerous_part", [
        "evil$(whoami)",
        "test;ls",
        "pipe|cat",
        "backtick`id`",
        "amp&background",
        "quote'single",
        'quote"double',
        "space here",
        "unicode_tên_có_dấu_ệ",
        "emoji_🎬_video",
    ])
    def test_probe_succeeds_despite_shell_metacharacters_in_filename(self, tmp_path, dangerous_part):
        video_path = tmp_path / f"{dangerous_part}.mp4"
        try:
            subprocess.run([
                ve._ffmpeg(), "-y", "-f", "lavfi", "-i", "testsrc2=size=64x64:rate=5:duration=1",
                "-c:v", "libx264", "-preset", "ultrafast", str(video_path),
            ], check=True, capture_output=True)
        except (subprocess.CalledProcessError, OSError):
            pytest.skip(f"Filesystem rejects this name: {dangerous_part}")

        info = ve.probe(video_path)
        assert info.width == 64
        assert info.height == 64

    def test_burn_text_with_shell_metacharacters_in_overlay_text(self, tmp_path):
        src = tmp_path / "src.mp4"
        subprocess.run([
            ve._ffmpeg(), "-y", "-f", "lavfi", "-i", "testsrc2=size=64x64:rate=5:duration=1",
            "-c:v", "libx264", "-preset", "ultrafast", str(src),
        ], check=True, capture_output=True)

        out = tmp_path / "out.mp4"
        result = ve.burn_text(src, out, [
            ve.TextOverlay(text="$(rm -rf /) ; echo injected `whoami`"),
        ])
        assert result.exists()
        assert src.exists()


# ===========================================================================
# Photo: decompression bomb
# ===========================================================================

class TestPhotoDecompressionBomb:
    def test_highly_compressed_oversized_image_rejected_without_full_decode(self, tmp_path):
        bomb = tmp_path / "bomb.png"
        Image.new("RGB", (10000, 10000), "white").save(bomb, optimize=True)
        assert bomb.stat().st_size < 500_000

        t0 = time.time()
        with pytest.raises(pe.PhotoEngineError, match="vượt giới hạn"):
            pe.probe(bomb)
        elapsed = time.time() - t0
        assert elapsed < 0.5

    def test_oversized_image_pixels_never_fully_decoded_into_memory(self, tmp_path, monkeypatch):
        bomb = tmp_path / "bomb2.png"
        Image.new("RGB", (9000, 9000), "black").save(bomb)

        load_calls = []
        original_load = Image.Image.load

        def spy_load(self):
            load_calls.append(self.size)
            return original_load(self)

        monkeypatch.setattr(Image.Image, "load", spy_load)

        with pytest.raises(pe.PhotoEngineError):
            pe.probe(bomb)

        assert load_calls == []

    def test_image_within_limit_still_loads_normally(self, tmp_path):
        normal = tmp_path / "normal.png"
        Image.new("RGB", (2000, 2000), "white").save(normal)
        info = pe.probe(normal)
        assert info.width == 2000
        assert info.height == 2000

    def test_bomb_warning_goes_through_logger_not_raw_stderr(self, tmp_path, caplog):
        import logging
        bomb = tmp_path / "bomb3.png"
        Image.new("RGB", (10000, 10000), "white").save(bomb)

        with caplog.at_level(logging.WARNING, logger="photo_engine"):
            with pytest.raises(pe.PhotoEngineError):
                pe.probe(bomb)

        assert any("decompression bomb" in r.message.lower() or "bomb" in r.message.lower()
                   for r in caplog.records)


# ===========================================================================
# Photo: forged, empty, and corrupt files
# ===========================================================================

class TestPhotoMalformedInput:
    def test_text_file_renamed_to_jpg_rejected(self, tmp_path):
        fake = tmp_path / "fake.jpg"
        fake.write_text("not an image")
        with pytest.raises(pe.PhotoEngineError):
            pe.probe(fake)

    def test_empty_file_rejected(self, tmp_path):
        empty = tmp_path / "empty.png"
        empty.touch()
        with pytest.raises(pe.PhotoEngineError):
            pe.probe(empty)

    def test_truncated_image_rejected(self, tmp_path):
        valid = tmp_path / "valid.png"
        Image.new("RGB", (500, 500), "blue").save(valid)
        truncated = tmp_path / "truncated.png"
        original = valid.read_bytes()
        truncated.write_bytes(original[: len(original) // 2])
        with pytest.raises(pe.PhotoEngineError):
            pe.probe(truncated)

    def test_directory_passed_as_image_path_rejected_cleanly(self, tmp_path):
        a_directory = tmp_path / "not_a_file"
        a_directory.mkdir()
        with pytest.raises(pe.PhotoEngineError):
            pe.probe(a_directory)

    def test_wrong_but_supported_extension_still_processed(self, tmp_path):
        png_bytes_as_jpg = tmp_path / "actually_png.jpg"
        Image.new("RGB", (100, 100), "red").save(png_bytes_as_jpg, format="PNG")
        info = pe.probe(png_bytes_as_jpg)
        assert info.width == 100


# ===========================================================================
# Photo: hostile filenames
# ===========================================================================

class TestPhotoDangerousFilenames:
    @pytest.mark.parametrize("dangerous_part", [
        "evil$(whoami)",
        "test;rm",
        "pipe|cat",
        "space here",
        "unicode_ảnh_có_dấu",
    ])
    def test_crop_succeeds_despite_shell_metacharacters_in_filename(self, tmp_path, dangerous_part):
        img_path = tmp_path / f"{dangerous_part}.jpg"
        try:
            Image.new("RGB", (200, 200), "green").save(img_path)
        except OSError:
            pytest.skip(f"Filesystem rejects this name: {dangerous_part}")

        out = tmp_path / "cropped.jpg"
        result = pe.crop(img_path, out, pe.Rect(x=0, y=0, width=50, height=50))
        assert result.exists()


# ===========================================================================
# Photo: redaction boundary
# ===========================================================================

class TestPhotoBoundaryRegions:
    def test_region_exactly_at_image_edge_accepted(self, tmp_path):
        img_path = tmp_path / "edge.jpg"
        Image.new("RGB", (100, 100), "white").save(img_path)
        out = tmp_path / "out.jpg"
        result = pe.crop(img_path, out, pe.Rect(x=50, y=50, width=50, height=50))
        assert result.exists()

    def test_region_one_pixel_beyond_edge_rejected(self, tmp_path):
        img_path = tmp_path / "edge2.jpg"
        Image.new("RGB", (100, 100), "white").save(img_path)
        with pytest.raises(pe.InvalidRegionError):
            pe.crop(img_path, tmp_path / "out.jpg", pe.Rect(x=51, y=50, width=50, height=50))

    def test_full_image_region_accepted(self, tmp_path):
        img_path = tmp_path / "full.jpg"
        Image.new("RGB", (100, 100), "white").save(img_path)
        out = tmp_path / "out.jpg"
        result = pe.crop(img_path, out, pe.Rect(x=0, y=0, width=100, height=100))
        with Image.open(result) as im:
            assert im.size == (100, 100)

    def test_single_pixel_region_accepted(self, tmp_path):
        img_path = tmp_path / "px.jpg"
        Image.new("RGB", (100, 100), "white").save(img_path)
        out = tmp_path / "out.jpg"
        result = pe.crop(img_path, out, pe.Rect(x=50, y=50, width=1, height=1))
        with Image.open(result) as im:
            assert im.size == (1, 1)

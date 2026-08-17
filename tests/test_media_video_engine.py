"""pytest for video_engine.py, running real FFmpeg on a generated sample clip.

subprocess is deliberately not mocked: a mock cannot catch a broken filtergraph
or a wrong CLI flag, which is exactly the class of bug this suite exists for.

Run: pytest tests/test_media_video_engine.py -v
"""

import subprocess
import time
from pathlib import Path

import pytest

import video_engine as ve


@pytest.fixture(scope="module")
def sample_video(tmp_path_factory):
    """5 seconds at 640x360: small enough to stay fast, still a real file."""
    out_dir = tmp_path_factory.mktemp("video_fixtures")
    path = out_dir / "sample.mp4"
    subprocess.run([
        ve._ffmpeg(), "-y",
        "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=25:duration=5",
        "-f", "lavfi", "-i", "sine=frequency=440:duration=5",
        "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "-pix_fmt", "yuv420p",
        str(path),
    ], check=True, capture_output=True)
    return path


@pytest.fixture(scope="module")
def sample_video_no_audio(tmp_path_factory):
    out_dir = tmp_path_factory.mktemp("video_fixtures_silent")
    path = out_dir / "silent.avi"
    subprocess.run([
        ve._ffmpeg(), "-y",
        "-f", "lavfi", "-i", "testsrc2=size=480x270:rate=24:duration=3",
        "-c:v", "mpeg4",
        str(path),
    ], check=True, capture_output=True)
    return path


class TestProbe:
    def test_reads_correct_metadata(self, sample_video):
        info = ve.probe(sample_video)
        assert info.width == 640
        assert info.height == 360
        assert info.has_audio is True
        assert 4.5 < info.duration_s < 5.5

    def test_missing_file_raises_probe_error(self):
        with pytest.raises(ve.ProbeFailedError):
            ve.probe("/nonexistent/path/video.mp4")

    def test_unsupported_extension_rejected_before_ffprobe(self, tmp_path):
        fake = tmp_path / "not_a_video.txt"
        fake.write_text("hello")
        with pytest.raises(ve.UnsupportedFormatError):
            ve.probe(fake)

    def test_video_without_audio_reports_correctly(self, sample_video_no_audio):
        info = ve.probe(sample_video_no_audio)
        assert info.has_audio is False


class TestThumbnail:
    def test_creates_jpeg_at_requested_time(self, sample_video, tmp_path):
        out = tmp_path / "thumb.jpg"
        result = ve.extract_thumbnail(sample_video, out, at_seconds=2.0, max_width=160)
        assert result.exists()
        assert result.stat().st_size > 0

    def test_filmstrip_count_matches_request(self, sample_video, tmp_path):
        frames = ve.extract_filmstrip(sample_video, tmp_path / "strip", count=5)
        assert len(frames) == 5
        assert all(f.exists() for f in frames)


class TestTrim:
    def test_stream_copy_is_fast_and_correct_duration(self, sample_video, tmp_path):
        out = tmp_path / "trimmed_copy.mp4"
        t0 = time.time()
        ve.trim(sample_video, out, 1.0, 3.0, reencode=False)
        elapsed = time.time() - t0
        info = ve.probe(out)
        # Stream copy snaps to the nearest keyframe before the cut point. The
        # fixture uses the ultrafast preset, whose keyframes are sparser than a
        # normal encode (~2s apart), so the drift is larger here. That is a known
        # property of stream copy, not a bug: assert a wide range, not exactly 2s.
        assert 1.5 < info.duration_s < 3.5
        assert elapsed < 3.0, "a stream-copy trim must take seconds, not minutes"

    def test_reencode_gives_frame_accurate_duration(self, sample_video, tmp_path):
        out = tmp_path / "trimmed_reenc.mp4"
        ve.trim(sample_video, out, 1.0, 3.0, reencode=True)
        info = ve.probe(out)
        assert 1.9 < info.duration_s < 2.1  # a re-encode should land far closer to the mark

    def test_end_before_start_rejected(self, sample_video, tmp_path):
        with pytest.raises(ve.VideoEngineError):
            ve.trim(sample_video, tmp_path / "bad.mp4", 3.0, 1.0)

    def test_output_never_overwrites_source(self, sample_video, tmp_path):
        original_size = sample_video.stat().st_size
        ve.trim(sample_video, tmp_path / "out.mp4", 0, 2)
        assert sample_video.stat().st_size == original_size


class TestBurnText:
    def test_vietnamese_diacritics_do_not_crash_filtergraph(self, sample_video, tmp_path):
        out = tmp_path / "burned.mp4"
        result = ve.burn_text(sample_video, out, [
            ve.TextOverlay(text="Ghi chú: đặt trocar — 48:12"),
        ])
        assert result.exists()

    def test_colon_in_text_does_not_break_drawtext(self, sample_video, tmp_path):
        # ':' is a control character in drawtext syntax; escaped wrongly, the
        # ffmpeg call fails the filtergraph and raises EncodeFailedError.
        out = tmp_path / "burned_colon.mp4"
        result = ve.burn_text(sample_video, out, [
            ve.TextOverlay(text="Thời gian: 12:30:05"),
        ])
        assert result.exists()

    def test_empty_overlay_list_rejected(self, sample_video, tmp_path):
        with pytest.raises(ve.VideoEngineError):
            ve.burn_text(sample_video, tmp_path / "x.mp4", [])


class TestConcat:
    def test_merges_different_resolutions_and_codecs(self, sample_video, sample_video_no_audio, tmp_path):
        out = tmp_path / "merged.mp4"
        result = ve.concat([sample_video, sample_video_no_audio], out, target_height=360)
        info = ve.probe(result)
        assert info.height == 360
        # ~5s + ~3s, with a small tolerance for the fps normalisation
        assert 7.0 < info.duration_s < 9.0

    def test_single_clip_rejected(self, sample_video, tmp_path):
        with pytest.raises(ve.VideoEngineError):
            ve.concat([sample_video], tmp_path / "x.mp4")

    def test_broken_input_fails_fast_before_encoding(self, sample_video, tmp_path):
        broken = tmp_path / "broken.mp4"
        broken.write_bytes(b"not a real video file")
        with pytest.raises(ve.VideoEngineError):
            ve.concat([sample_video, broken], tmp_path / "x.mp4")


class TestHwEncoders:
    def test_returns_dict_without_crashing(self):
        result = ve.detect_hw_encoders()
        assert isinstance(result, dict)
        assert "nvenc" in result


class TestTranscode:
    def test_software_encode_produces_valid_output(self, sample_video, tmp_path):
        out = tmp_path / "exported.mp4"
        ve.transcode(sample_video, out, use_hw=False, crf=28)
        info = ve.probe(out)
        assert info.width == 640

    def test_progress_callback_reaches_completion(self, sample_video, tmp_path):
        out = tmp_path / "exported_progress.mp4"
        progress_values = []
        ve.transcode(sample_video, out, use_hw=False, crf=28,
                      progress_cb=lambda pct, elapsed: progress_values.append(pct))
        assert progress_values, "progress_cb must be called at least once"
        assert max(progress_values) > 0.9, "progress must approach 100% on completion"

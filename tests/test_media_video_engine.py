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


class TestBurnOverlay:
    """
    Compositing a drawn layer onto a clip.

    Arrows and freehand cannot be expressed as drawtext filters at all, so the
    layer is rasterised once by photo_engine and overlaid as a single still —
    and the blur regions, which must not be faked with a picture of a blur, go
    through their own crop/boxblur chain.
    """

    def test_burns_a_drawn_layer_and_keeps_the_clip_length(self, sample_video, tmp_path):
        import photo_engine as pe

        info = ve.probe(sample_video)
        overlay = pe.render_overlay_png(
            [{"kind": "arrow", "x1": 60, "y1": 300, "x2": 320, "y2": 120,
              "color": [255, 59, 48], "stroke_width": 5}],
            (info.width, info.height), tmp_path / "layer.png",
        )
        out = ve.burn_overlay(sample_video, tmp_path / "burned.mp4", overlay_png=overlay)
        assert out.exists()
        # The overlay is a single still. Looped as an endless input it would
        # keep the encode running until it was killed; the output must end with
        # the video.
        assert ve.probe(out).duration_s == pytest.approx(info.duration_s, abs=0.5)

    def test_a_time_gated_layer_only_marks_the_span_it_was_drawn_for(self, sample_video, tmp_path):
        import photo_engine as pe

        info = ve.probe(sample_video)
        overlay = pe.render_overlay_png(
            [{"kind": "rect", "x": 0, "y": 0, "width": info.width, "height": info.height,
              "color": [255, 0, 0], "filled": True, "opacity": 1.0}],
            (info.width, info.height), tmp_path / "full.png",
        )
        out = ve.burn_overlay(sample_video, tmp_path / "gated.mp4",
                              overlay_png=overlay, start_s=2.0, end_s=4.0)

        def mean_red(at: float) -> float:
            frame = tmp_path / f"f{at}.png"
            subprocess.run([ve._ffmpeg(), "-y", "-ss", str(at), "-i", str(out),
                            "-frames:v", "1", str(frame)], check=True, capture_output=True)
            from PIL import Image
            pixels = list(Image.open(frame).convert("RGB").getdata())
            return sum(p[0] for p in pixels) / len(pixels)

        # A marker pointing at the moment a duct is clipped must not sit on
        # screen for the whole operation.
        assert mean_red(3.0) > 240
        assert mean_red(0.5) < 240

    def test_a_blur_region_filters_the_frames_rather_than_covering_them(self, sample_video, tmp_path):
        out = ve.burn_overlay(
            sample_video, tmp_path / "blurred.mp4",
            blur_regions=[ve.BlurRegion(x=0, y=0, width=320, height=180, strength=20)],
        )
        frame = tmp_path / "blurred.png"
        subprocess.run([ve._ffmpeg(), "-y", "-ss", "1", "-i", str(out),
                        "-frames:v", "1", str(frame)], check=True, capture_output=True)
        from PIL import Image
        region = Image.open(frame).convert("L").crop((10, 10, 310, 170))
        row = list(region.crop((0, 80, 300, 81)).getdata())
        # Detail is gone, but the region is not painted out: a black box would
        # be a redaction, and this is a blur.
        assert max(abs(a - b) for a, b in zip(row, row[1:])) < 120
        assert sum(row) / len(row) > 10

    def test_a_solid_region_blacks_the_area_out_completely(self, sample_video, tmp_path):
        out = ve.burn_overlay(
            sample_video, tmp_path / "redacted.mp4",
            blur_regions=[ve.BlurRegion(x=0, y=0, width=200, height=100, mode="solid")],
        )
        frame = tmp_path / "redacted.png"
        subprocess.run([ve._ffmpeg(), "-y", "-ss", "1", "-i", str(out),
                        "-frames:v", "1", str(frame)], check=True, capture_output=True)
        from PIL import Image
        strip = Image.open(frame).convert("L").crop((10, 10, 190, 90))
        assert max(strip.getdata()) < 40

    def test_refuses_a_request_with_nothing_to_apply(self, sample_video, tmp_path):
        with pytest.raises(ve.VideoEngineError):
            ve.burn_overlay(sample_video, tmp_path / "nothing.mp4")

    def test_reports_a_missing_overlay_file_instead_of_failing_inside_ffmpeg(self, sample_video, tmp_path):
        with pytest.raises(ve.VideoEngineError):
            ve.burn_overlay(sample_video, tmp_path / "x.mp4",
                            overlay_png=tmp_path / "does_not_exist.png")

    def test_leaves_the_source_clip_untouched(self, sample_video, tmp_path):
        before = sample_video.read_bytes()
        ve.burn_overlay(sample_video, tmp_path / "copy.mp4",
                        blur_regions=[ve.BlurRegion(x=0, y=0, width=64, height=64)])
        assert sample_video.read_bytes() == before


class TestTimedOverlayLayers:
    """Several drawings on one clip, each on screen for its own moment."""

    def test_each_layer_appears_only_in_its_own_span(self, sample_video, tmp_path):
        import photo_engine as pe
        from PIL import Image

        info = ve.probe(sample_video)
        full = (info.width, info.height)

        def flat(colour, path):
            return pe.render_overlay_png(
                [{"kind": "rect", "x": 0, "y": 0, "width": info.width, "height": info.height,
                  "color": colour, "filled": True, "opacity": 1.0}],
                full, tmp_path / path,
            )

        out = ve.burn_overlay(sample_video, tmp_path / "timed.mp4", overlays=[
            ve.OverlayLayer(png=flat([255, 0, 0], "red.png"), start_s=0.5, end_s=1.5),
            ve.OverlayLayer(png=flat([0, 0, 255], "blue.png"), start_s=3.0, end_s=4.5),
        ])

        def mean_rgb(at):
            frame = tmp_path / f"t{at}.png"
            subprocess.run([ve._ffmpeg(), "-y", "-ss", str(at), "-i", str(out),
                            "-frames:v", "1", str(frame)], check=True, capture_output=True)
            pixels = list(Image.open(frame).convert("RGB").getdata())
            n = len(pixels)
            return tuple(sum(p[i] for p in pixels) / n for i in range(3))

        red = mean_rgb(1.0)
        blue = mean_rgb(3.7)
        assert red[0] > 240 and red[2] < 40      # first span: red only
        assert blue[2] > 240 and blue[0] < 40    # second span: blue only

    def test_an_untimed_layer_covers_the_whole_clip(self, sample_video, tmp_path):
        import photo_engine as pe
        from PIL import Image

        info = ve.probe(sample_video)
        stamp = pe.render_overlay_png(
            [{"kind": "rect", "x": 0, "y": 0, "width": info.width, "height": info.height,
              "color": [0, 255, 0], "filled": True, "opacity": 1.0}],
            (info.width, info.height), tmp_path / "green.png",
        )
        out = ve.burn_overlay(sample_video, tmp_path / "stamped.mp4",
                              overlays=[ve.OverlayLayer(png=stamp)])
        for at in (0.2, 2.5, 4.5):
            frame = tmp_path / f"s{at}.png"
            subprocess.run([ve._ffmpeg(), "-y", "-ss", str(at), "-i", str(out),
                            "-frames:v", "1", str(frame)], check=True, capture_output=True)
            pixels = list(Image.open(frame).convert("RGB").getdata())
            assert sum(p[1] for p in pixels) / len(pixels) > 240

    def test_a_region_at_the_frame_edge_does_not_kill_the_encode(self, sample_video, tmp_path):
        # ffmpeg's crop refuses a size larger than the input and takes the whole
        # encode down with it, and it silently *clamps* an out-of-range offset,
        # which is worse: the blur lands somewhere the reader did not put it.
        info = ve.probe(sample_video)
        for region in (
            ve.BlurRegion(x=0, y=0, width=info.width, height=info.height),
            ve.BlurRegion(x=0, y=0, width=info.width + 400, height=info.height + 200),
            ve.BlurRegion(x=-40, y=-40, width=200, height=200),
            ve.BlurRegion(x=info.width - 8, y=0, width=200, height=100),
            ve.BlurRegion(x=10, y=10, width=20, height=20, strength=60),
            ve.BlurRegion(x=0, y=0, width=info.width, height=3),
        ):
            assert ve.burn_overlay(sample_video, tmp_path / "edge.mp4",
                                   blur_regions=[region]).exists()

    def test_a_region_too_small_to_blur_is_painted_out_not_skipped(self, sample_video, tmp_path):
        # A redaction that silently does nothing is the one outcome that must
        # never happen, so a sliver too narrow for boxblur becomes a solid box.
        from PIL import Image

        out = ve.burn_overlay(sample_video, tmp_path / "sliver.mp4",
                              blur_regions=[ve.BlurRegion(x=20, y=20, width=4, height=40)])
        frame = tmp_path / "sliver.png"
        subprocess.run([ve._ffmpeg(), "-y", "-ss", "1", "-i", str(out),
                        "-frames:v", "1", str(frame)], check=True, capture_output=True)
        patch = Image.open(frame).convert("L").crop((21, 25, 23, 55))
        assert max(patch.getdata()) < 60

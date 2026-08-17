"""pytest for video_engine.configure_binaries(): how the ffmpeg/ffprobe paths
are discovered and configured.
"""

import shutil
import stat
from pathlib import Path

import pytest

import video_engine as ve


@pytest.fixture(autouse=True)
def restore_binary_state():
    original_ffmpeg = ve._FFMPEG_BIN
    original_ffprobe = ve._FFPROBE_BIN
    yield
    ve._FFMPEG_BIN = original_ffmpeg
    ve._FFPROBE_BIN = original_ffprobe


def _make_fake_binary(path: Path) -> Path:
    if ve._is_windows() and not path.name.lower().endswith(".exe"):
        path = path.with_name(path.name + ".exe")
    path.write_text("#!/bin/sh\necho fake")
    path.chmod(path.stat().st_mode | stat.S_IEXEC)
    return path


class TestConfigureBinariesWithBundledDir:
    def test_uses_bundled_binaries_when_both_present(self, tmp_path):
        bundle_dir = tmp_path / "bin" / "ffmpeg"
        bundle_dir.mkdir(parents=True)
        fake_ffmpeg = _make_fake_binary(bundle_dir / "ffmpeg")
        fake_ffprobe = _make_fake_binary(bundle_dir / "ffprobe")

        ve.configure_binaries(bundle_dir)

        assert ve._FFMPEG_BIN == str(fake_ffmpeg)
        assert ve._FFPROBE_BIN == str(fake_ffprobe)

    def test_falls_back_to_system_path_when_ffmpeg_missing_from_bundle(self, tmp_path):
        bundle_dir = tmp_path / "bin" / "ffmpeg"
        bundle_dir.mkdir(parents=True)
        fake_ffprobe = _make_fake_binary(bundle_dir / "ffprobe")

        system_ffmpeg = shutil.which("ffmpeg")
        if not system_ffmpeg:
            pytest.skip("No ffmpeg on PATH here, so the fallback cannot be confirmed")

        ve.configure_binaries(bundle_dir)

        assert ve._FFMPEG_BIN == system_ffmpeg
        assert ve._FFPROBE_BIN != str(fake_ffprobe), \
            "must not mix a bundled ffprobe with an ffmpeg from PATH"

    def test_falls_back_to_system_path_when_bundle_dir_empty(self, tmp_path):
        empty_dir = tmp_path / "bin" / "ffmpeg"
        empty_dir.mkdir(parents=True)

        system_ffmpeg = shutil.which("ffmpeg")
        if not system_ffmpeg:
            pytest.skip("No ffmpeg on PATH here, so the fallback cannot be confirmed")

        ve.configure_binaries(empty_dir)
        assert ve._FFMPEG_BIN == system_ffmpeg

    def test_falls_back_to_system_path_when_bundle_dir_does_not_exist(self, tmp_path):
        nonexistent = tmp_path / "does_not_exist"

        system_ffmpeg = shutil.which("ffmpeg")
        if not system_ffmpeg:
            pytest.skip("No ffmpeg on PATH here, so the fallback cannot be confirmed")

        ve.configure_binaries(nonexistent)
        assert ve._FFMPEG_BIN == system_ffmpeg


class TestConfigureBinariesWithoutBundledDir:
    def test_none_argument_finds_bundled_dir_or_system_path(self):
        ve.configure_binaries(None)
        assert ve._FFMPEG_BIN is not None
        assert Path(ve._FFMPEG_BIN).exists()

    def test_none_argument_falls_back_to_system_when_bundled_missing(self, monkeypatch, tmp_path):
        system_ffmpeg = shutil.which("ffmpeg")
        if not system_ffmpeg:
            pytest.skip("No ffmpeg on PATH on this machine")
        fake_app_root = tmp_path / "empty_app"
        fake_app_root.mkdir()
        monkeypatch.setattr(ve, "__file__", str(fake_app_root / "video_engine.py"))
        ve.configure_binaries(None)
        assert ve._FFMPEG_BIN == system_ffmpeg

    def test_raises_runtime_error_when_nothing_available(self, monkeypatch, tmp_path):
        fake_app_root = tmp_path / "empty_app"
        fake_app_root.mkdir()
        monkeypatch.setattr(ve, "__file__", str(fake_app_root / "video_engine.py"))
        monkeypatch.setattr(shutil, "which", lambda name: None)
        with pytest.raises(RuntimeError, match="Không tìm thấy ffmpeg"):
            ve.configure_binaries(None)


class TestLazyAutoConfiguration:
    def test_ffmpeg_helper_lazily_configures_if_unset(self):
        ve._FFMPEG_BIN = None
        ve._FFPROBE_BIN = None
        result = ve._ffmpeg()
        assert result is not None
        assert Path(result).exists()
        assert ve._FFMPEG_BIN is not None, "calling _ffmpeg() must set the module global as a side effect"

    def test_ffprobe_helper_lazily_configures_if_unset(self):
        ve._FFMPEG_BIN = None
        ve._FFPROBE_BIN = None
        result = ve._ffprobe()
        assert result is not None
        assert Path(result).exists()

    def test_does_not_reconfigure_if_already_set(self, tmp_path):
        bundle_dir = tmp_path / "bin"
        bundle_dir.mkdir()
        fake_ffmpeg = _make_fake_binary(bundle_dir / "ffmpeg")
        _make_fake_binary(bundle_dir / "ffprobe")
        ve.configure_binaries(bundle_dir)

        expected = str(fake_ffmpeg)
        assert ve._ffmpeg() == expected, "an explicit configuration must not be overwritten"


class TestIsWindowsHelper:
    def test_returns_bool(self):
        assert isinstance(ve._is_windows(), bool)

    def test_matches_platform_system(self):
        import platform
        assert ve._is_windows() == (platform.system() == "Windows")

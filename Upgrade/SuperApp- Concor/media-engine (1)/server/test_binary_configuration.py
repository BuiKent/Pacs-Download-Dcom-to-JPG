"""pytest cho video_engine.configure_binaries() — logic dò và cấu hình
đường dẫn ffmpeg/ffprobe. Đo coverage phát hiện phần này 0% dù là logic quan
trọng thật (README hứa hẹn cách đóng gói FFmpeg kèm app dựa trên hàm này).

Mỗi test tự khôi phục lại _FFMPEG_BIN/_FFPROBE_BIN gốc sau khi chạy, để
không làm hỏng các test khác chạy sau (chúng dựa vào FFmpeg thật trong PATH).
"""

import shutil
import stat
from pathlib import Path

import pytest

import video_engine as ve


@pytest.fixture(autouse=True)
def restore_binary_state():
    """Tự động chạy quanh MỌI test trong file này: lưu trạng thái binary
    trước, khôi phục lại sau — vì configure_binaries() sửa biến module-level
    toàn cục (_FFMPEG_BIN/_FFPROBE_BIN), ảnh hưởng mọi test khác trong suite
    nếu không dọn dẹp đúng."""
    original_ffmpeg = ve._FFMPEG_BIN
    original_ffprobe = ve._FFPROBE_BIN
    yield
    ve._FFMPEG_BIN = original_ffmpeg
    ve._FFPROBE_BIN = original_ffprobe


def _make_fake_binary(path: Path) -> None:
    """Tạo file thực thi giả (không cần chạy được, chỉ cần tồn tại và có
    quyền x, vì configure_binaries() chỉ kiểm tra .exists(), không gọi thử)."""
    path.write_text("#!/bin/sh\necho fake")
    path.chmod(path.stat().st_mode | stat.S_IEXEC)


class TestConfigureBinariesWithBundledDir:
    def test_uses_bundled_binaries_when_both_present(self, tmp_path):
        bundle_dir = tmp_path / "bin" / "ffmpeg"
        bundle_dir.mkdir(parents=True)
        _make_fake_binary(bundle_dir / "ffmpeg")
        _make_fake_binary(bundle_dir / "ffprobe")

        ve.configure_binaries(bundle_dir)

        assert ve._FFMPEG_BIN == str(bundle_dir / "ffmpeg")
        assert ve._FFPROBE_BIN == str(bundle_dir / "ffprobe")

    def test_falls_back_to_system_path_when_ffmpeg_missing_from_bundle(self, tmp_path):
        """Thư mục bundle chỉ có ffprobe, thiếu ffmpeg — phải rơi về PATH hệ
        thống cho CẢ HAI (không dùng ffprobe từ bundle + ffmpeg từ PATH lẫn
        lộn), vì code yêu cầu cả 2 cùng tồn tại trong bundle mới dùng bundle."""
        bundle_dir = tmp_path / "bin" / "ffmpeg"
        bundle_dir.mkdir(parents=True)
        _make_fake_binary(bundle_dir / "ffprobe")
        # cố tình không tạo ffmpeg

        system_ffmpeg = shutil.which("ffmpeg")
        if not system_ffmpeg:
            pytest.skip("Máy test không có ffmpeg trong PATH để xác nhận fallback")

        ve.configure_binaries(bundle_dir)

        assert ve._FFMPEG_BIN == system_ffmpeg
        assert ve._FFPROBE_BIN != str(bundle_dir / "ffprobe"), \
            "không được trộn ffprobe từ bundle với ffmpeg từ PATH"

    def test_falls_back_to_system_path_when_bundle_dir_empty(self, tmp_path):
        empty_dir = tmp_path / "bin" / "ffmpeg"
        empty_dir.mkdir(parents=True)

        system_ffmpeg = shutil.which("ffmpeg")
        if not system_ffmpeg:
            pytest.skip("Máy test không có ffmpeg trong PATH để xác nhận fallback")

        ve.configure_binaries(empty_dir)
        assert ve._FFMPEG_BIN == system_ffmpeg

    def test_falls_back_to_system_path_when_bundle_dir_does_not_exist(self, tmp_path):
        nonexistent = tmp_path / "does_not_exist"

        system_ffmpeg = shutil.which("ffmpeg")
        if not system_ffmpeg:
            pytest.skip("Máy test không có ffmpeg trong PATH để xác nhận fallback")

        ve.configure_binaries(nonexistent)
        assert ve._FFMPEG_BIN == system_ffmpeg


class TestConfigureBinariesWithoutBundledDir:
    def test_none_argument_uses_system_path(self):
        system_ffmpeg = shutil.which("ffmpeg")
        if not system_ffmpeg:
            pytest.skip("Máy test không có ffmpeg trong PATH")
        ve.configure_binaries(None)
        assert ve._FFMPEG_BIN == system_ffmpeg

    def test_raises_runtime_error_when_nothing_available(self, monkeypatch):
        """Không có bundle, và PATH hệ thống cũng không có ffmpeg — phải báo
        lỗi rõ ràng thay vì để _FFMPEG_BIN = None âm thầm rồi lỗi khó hiểu ở
        chỗ khác về sau."""
        monkeypatch.setattr(shutil, "which", lambda name: None)
        with pytest.raises(RuntimeError, match="Không tìm thấy ffmpeg"):
            ve.configure_binaries(None)


class TestLazyAutoConfiguration:
    """_ffmpeg()/_ffprobe() tự gọi configure_binaries(None) nếu chưa được
    cấu hình tường minh — xác nhận cơ chế lazy-init này hoạt động, vì đây là
    đường tắt mà mọi lệnh FFmpeg trong engine đi qua nếu app quên gọi
    configure_binaries() lúc khởi động."""

    def test_ffmpeg_helper_lazily_configures_if_unset(self):
        ve._FFMPEG_BIN = None
        ve._FFPROBE_BIN = None
        system_ffmpeg = shutil.which("ffmpeg")
        if not system_ffmpeg:
            pytest.skip("Máy test không có ffmpeg trong PATH")

        result = ve._ffmpeg()
        assert result == system_ffmpeg
        assert ve._FFMPEG_BIN is not None, "gọi _ffmpeg() phải tự set biến toàn cục sau đó"

    def test_ffprobe_helper_lazily_configures_if_unset(self):
        ve._FFMPEG_BIN = None
        ve._FFPROBE_BIN = None
        system_ffprobe = shutil.which("ffprobe")
        if not system_ffprobe:
            pytest.skip("Máy test không có ffprobe trong PATH")

        result = ve._ffprobe()
        assert result == system_ffprobe

    def test_does_not_reconfigure_if_already_set(self, tmp_path):
        """Nếu đã cấu hình rồi (vd. app gọi configure_binaries() lúc khởi
        động), gọi lại _ffmpeg() không được âm thầm ghi đè bằng giá trị
        khác — phải giữ nguyên đường dẫn đã cấu hình tường minh."""
        bundle_dir = tmp_path / "bin"
        bundle_dir.mkdir()
        _make_fake_binary(bundle_dir / "ffmpeg")
        _make_fake_binary(bundle_dir / "ffprobe")
        ve.configure_binaries(bundle_dir)

        expected = str(bundle_dir / "ffmpeg")
        assert ve._ffmpeg() == expected, "đã cấu hình tường minh thì không được bị ghi đè"


class TestIsWindowsHelper:
    def test_returns_bool(self):
        assert isinstance(ve._is_windows(), bool)

    def test_matches_platform_system(self):
        import platform
        assert ve._is_windows() == (platform.system() == "Windows")

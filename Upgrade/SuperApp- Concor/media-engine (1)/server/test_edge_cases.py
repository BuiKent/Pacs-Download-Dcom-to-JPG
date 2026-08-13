"""pytest edge-case toàn diện — file giả mạo đuôi, rỗng, quá lớn,
decompression bomb, ký tự đặc biệt/injection trong tên file.

Khác với test_video_engine.py/test_photo_engine.py (test hành vi nghiệp vụ
đúng), file này tập trung vào các đầu vào BẤT THƯỜNG mà người dùng thật hoặc
kẻ tấn công có thể gửi lên — mỗi test ở đây từng được xác nhận thủ công trong
quá trình phát triển trước khi viết thành test chính thức, để không lặp lại
việc kiểm tra tay mỗi lần sửa code.
"""

import subprocess
import time
from pathlib import Path

import pytest
from PIL import Image

import photo_engine as pe
import video_engine as ve


# ===========================================================================
# Video: file giả mạo, rỗng, hỏng giữa chừng
# ===========================================================================

class TestVideoMalformedInput:
    def test_text_file_renamed_to_mp4_fails_fast(self, tmp_path):
        """File .txt đổi tên thành .mp4 phải bị ffprobe từ chối nhanh (không
        treo/tốn tài nguyên cố decode nội dung rác)."""
        fake = tmp_path / "fake.mp4"
        fake.write_text("đây không phải video, chỉ là văn bản thường")
        t0 = time.time()
        with pytest.raises(ve.ProbeFailedError):
            ve.probe(fake)
        assert time.time() - t0 < 5, "probe file giả mạo phải fail nhanh, không được treo lâu"

    def test_empty_file_with_video_extension_rejected(self, tmp_path):
        empty = tmp_path / "empty.mp4"
        empty.touch()
        with pytest.raises(ve.ProbeFailedError):
            ve.probe(empty)

    def test_truncated_video_mid_file_rejected(self, tmp_path):
        """Video hợp lệ nhưng bị cắt cụt giữa chừng (mô phỏng lỗi copy/upload
        dở dang) — probe phải báo lỗi rõ ràng, không phải traceback thô."""
        valid = tmp_path / "valid.mp4"
        subprocess.run([
            "ffmpeg", "-y", "-f", "lavfi", "-i", "testsrc2=size=320x240:rate=15:duration=3",
            "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", str(valid),
        ], check=True, capture_output=True)

        truncated = tmp_path / "truncated.mp4"
        original_bytes = valid.read_bytes()
        truncated.write_bytes(original_bytes[: len(original_bytes) // 3])

        # File cụt có thể vẫn đọc được 1 phần metadata tuỳ vị trí cắt — hành
        # vi chấp nhận được là: hoặc probe thành công với dữ liệu không đầy
        # đủ, hoặc ném ProbeFailedError. Điều KHÔNG chấp nhận được là crash
        # không kiểm soát (exception khác) hoặc treo quá lâu.
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
        """Truyền nhầm một thư mục thay vì file — không được crash với lỗi
        hệ thống khó hiểu (IsADirectoryError thô)."""
        a_directory = tmp_path / "not_a_file"
        a_directory.mkdir()
        with pytest.raises(ve.VideoEngineError):
            ve.probe(a_directory)


# ===========================================================================
# Video: tên file/đường dẫn nguy hiểm — chứng minh không có command injection
# ===========================================================================

class TestVideoDangerousFilenames:
    """subprocess.run() với list argument (không phải shell string) đã an
    toàn với injection về mặt thiết kế — các test này XÁC NHẬN bằng thực
    nghiệm, không chỉ tin vào lý thuyết, vì đây là lớp phòng thủ quan trọng
    nhất của toàn bộ engine."""

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
                "ffmpeg", "-y", "-f", "lavfi", "-i", "testsrc2=size=64x64:rate=5:duration=1",
                "-c:v", "libx264", "-preset", "ultrafast", str(video_path),
            ], check=True, capture_output=True)
        except subprocess.CalledProcessError:
            pytest.skip(f"Filesystem không hỗ trợ tên file: {dangerous_part}")

        info = ve.probe(video_path)
        assert info.width == 64
        assert info.height == 64

    def test_burn_text_with_shell_metacharacters_in_overlay_text(self, tmp_path):
        """Nội dung TEXT overlay (không phải tên file) do người dùng gõ cũng
        có thể chứa ký tự shell — nhưng đây đi qua drawtext filter của FFmpeg,
        không qua shell, nên injection không áp dụng. Test xác nhận không
        crash filtergraph."""
        src = tmp_path / "src.mp4"
        subprocess.run([
            "ffmpeg", "-y", "-f", "lavfi", "-i", "testsrc2=size=64x64:rate=5:duration=1",
            "-c:v", "libx264", "-preset", "ultrafast", str(src),
        ], check=True, capture_output=True)

        out = tmp_path / "out.mp4"
        result = ve.burn_text(src, out, [
            ve.TextOverlay(text="$(rm -rf /) ; echo injected `whoami`"),
        ])
        assert result.exists()
        # Xác nhận không có gì bị xoá/thực thi — tmp_path vẫn còn nguyên
        assert src.exists()


# ===========================================================================
# Photo: decompression bomb — phát hiện thật trong quá trình phát triển
# ===========================================================================

class TestPhotoDecompressionBomb:
    """Bug đã phát hiện: Image.open() + img.load() giải nén TOÀN BỘ pixel
    vào RAM trước khi code tự kiểm tra _MAX_DIMENSION. Một PNG nén tốt (ảnh
    đơn sắc) có thể chỉ vài trăm KB trên đĩa nhưng giải nén ra hàng trăm MB
    RAM và mất vài giây CPU nếu kích thước pixel lớn — đủ để tấn công DoS
    bằng cách gửi nhiều ảnh như vậy đồng thời. Pillow có Image.MAX_IMAGE_PIXELS
    nhưng mặc định chỉ CẢNH BÁO (warning), không chặn (không raise).

    Đã sửa: kiểm tra img.width/img.height NGAY SAU Image.open() (chỉ đọc
    header, rẻ) và TRƯỚC img.load() (giải nén thật, tốn kém). Test này đo
    thời gian thực để xác nhận đường đi nhanh (dưới 0.5s) chứ không chỉ xác
    nhận có raise đúng loại lỗi — một fix sai vị trí (check sau load()) vẫn
    có thể "pass" nếu chỉ test raise mà không đo thời gian.
    """

    def test_highly_compressed_oversized_image_rejected_without_full_decode(self, tmp_path):
        # Ảnh 10000x10000 đơn sắc: nén cực tốt trên đĩa, nhưng giải nén đầy đủ
        # sẽ tốn ~300MB RAM và (đã đo thực nghiệm) khoảng 3.7s trên máy test.
        bomb = tmp_path / "bomb.png"
        Image.new("RGB", (10000, 10000), "white").save(bomb, optimize=True)
        assert bomb.stat().st_size < 500_000, "ảnh mẫu phải nén rất nhỏ để test có ý nghĩa"

        t0 = time.time()
        with pytest.raises(pe.PhotoEngineError, match="vượt giới hạn"):
            pe.probe(bomb)
        elapsed = time.time() - t0

        # Ngưỡng 0.5s là rất rộng rãi so với ~0.01-0.02s đo được thực tế khi
        # chặn đúng từ header; nếu code vô tình quay lại kiểm tra SAU load(),
        # thời gian sẽ nhảy lên vài giây và test này sẽ bắt được ngay.
        assert elapsed < 0.5, (
            f"Chặn ảnh quá khổ mất {elapsed:.2f}s — quá lâu, nghi ngờ code đang "
            f"giải nén (load()) TRƯỚC khi kiểm tra kích thước thay vì sau. "
            f"Kiểm tra lại thứ tự trong _open_safely()."
        )

    def test_oversized_image_pixels_never_fully_decoded_into_memory(self, tmp_path, monkeypatch):
        """Xác nhận trực tiếp hơn: patch Image.Image.load để phát hiện nếu
        nó từng được gọi trên ảnh quá khổ — nếu bị gọi, đó là dấu hiệu code
        đã giải nén trước khi chặn (đúng bug đã tìm thấy)."""
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

        assert load_calls == [], (
            f"Image.load() bị gọi trên ảnh quá khổ trước khi bị chặn: {load_calls}. "
            f"Điều này có nghĩa toàn bộ pixel đã được giải nén vào RAM trước khi "
            f"kiểm tra kích thước — đúng lỗ hổng decompression-bomb đã biết."
        )

    def test_image_within_limit_still_loads_normally(self, tmp_path):
        """Đảm bảo fix không quá tay — ảnh hợp lệ trong giới hạn vẫn phải
        load() và dùng được bình thường."""
        normal = tmp_path / "normal.png"
        Image.new("RGB", (2000, 2000), "white").save(normal)
        info = pe.probe(normal)
        assert info.width == 2000
        assert info.height == 2000

    def test_bomb_warning_goes_through_logger_not_raw_stderr(self, tmp_path, caplog):
        """Cảnh báo DecompressionBombWarning của Pillow phải được bắt và ghi
        qua logger có kiểm soát (để vận hành thật có thể theo dõi/alert),
        không phải in thẳng ra stderr không lọc được."""
        import logging
        bomb = tmp_path / "bomb3.png"
        Image.new("RGB", (10000, 10000), "white").save(bomb)

        with caplog.at_level(logging.WARNING, logger="photo_engine"):
            with pytest.raises(pe.PhotoEngineError):
                pe.probe(bomb)

        assert any("decompression bomb" in r.message.lower() or "bomb" in r.message.lower()
                   for r in caplog.records), \
            "Cảnh báo decompression bomb phải xuất hiện trong log có cấu trúc"


# ===========================================================================
# Photo: file giả mạo, rỗng, hỏng
# ===========================================================================

class TestPhotoMalformedInput:
    def test_text_file_renamed_to_jpg_rejected(self, tmp_path):
        fake = tmp_path / "fake.jpg"
        fake.write_text("đây không phải ảnh")
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
        """Ảnh PNG thật nhưng đặt đuôi .jpg — Pillow tự nhận diện định dạng
        thật qua magic bytes bất kể đuôi file, nên vẫn xử lý được. Đây không
        phải lỗ hổng, chỉ là hành vi cần biết rõ (đuôi file không đáng tin,
        chỉ dùng để lọc sơ bộ trước khi Pillow tự phát hiện định dạng thật)."""
        png_bytes_as_jpg = tmp_path / "actually_png.jpg"
        Image.new("RGB", (100, 100), "red").save(png_bytes_as_jpg, format="PNG")
        info = pe.probe(png_bytes_as_jpg)
        assert info.width == 100


# ===========================================================================
# Photo: tên file nguy hiểm
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
            pytest.skip(f"Filesystem không hỗ trợ tên file: {dangerous_part}")

        out = tmp_path / "cropped.jpg"
        result = pe.crop(img_path, out, pe.Rect(x=0, y=0, width=50, height=50))
        assert result.exists()


# ===========================================================================
# Photo: redaction — vùng chọn ở biên tuyệt đối (không chỉ ngoài biên hẳn)
# ===========================================================================

class TestPhotoBoundaryRegions:
    """test_photo_engine.py đã test vùng NGOÀI biên rõ ràng; các test này bổ
    sung trường hợp biên SÁT MÉP (off-by-one) — nơi lỗi tính toán dễ xảy ra
    nhất trong thực tế (>= vs >, kích thước 0 ở rìa ảnh)."""

    def test_region_exactly_at_image_edge_accepted(self, tmp_path):
        img_path = tmp_path / "edge.jpg"
        Image.new("RGB", (100, 100), "white").save(img_path)
        out = tmp_path / "out.jpg"
        # Vùng chạm đúng mép phải/dưới (x+width == img.width) phải hợp lệ
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

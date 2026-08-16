"""pytest cho hệ thống giới hạn đồng thời trong photo_engine.py — cùng cấu
trúc với test_concurrency.py (video), nhưng target module ảnh."""

import threading
import time

import pytest
from PIL import Image

import photo_engine as pe
from photo_engine import ServerBusyError


class TestPhotoConcurrencyGate:
    def teardown_method(self):
        pe.configure_concurrency(limit=pe._HEAVY_LIMIT_DEFAULT, wait_timeout_s=30)

    def test_default_limit_is_positive(self):
        stats = pe.concurrency_stats()
        assert stats["photo"]["limit"] >= 1

    def test_configure_concurrency_changes_limit(self):
        pe.configure_concurrency(limit=5)
        assert pe.concurrency_stats()["photo"]["limit"] == 5

    def test_third_open_waits_when_limit_is_one(self, tmp_path):
        """limit=1: mở ảnh thứ 2 phải chờ ảnh 1 xử lý xong, không chạy song
        song — chứng minh gate thật sự nằm trên đường đi _open_safely()."""
        pe.configure_concurrency(limit=1, wait_timeout_s=10)
        img_path = tmp_path / "sample.jpg"
        Image.new("RGB", (200, 200), "white").save(img_path)

        timeline = []
        lock = threading.Lock()

        def probe_with_delay(idx):
            with lock:
                timeline.append(("start", idx, time.time()))
            pe.probe(img_path)
            with lock:
                timeline.append(("end", idx, time.time()))

        n = 6
        threads = [threading.Thread(target=probe_with_delay, args=(i,)) for i in range(n)]
        start = time.time()
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=15)
        elapsed = time.time() - start

        assert len(timeline) == n * 2
        assert elapsed < 10, "6 lần probe ảnh nhỏ không nên mất quá 10s dù bị tuần tự hoá"

    def test_raises_server_busy_when_saturated_and_timeout_short(self, tmp_path):
        pe.configure_concurrency(limit=1, wait_timeout_s=0.05)
        img_path = tmp_path / "sample.jpg"
        Image.new("RGB", (4000, 4000), "white").save(img_path)

        release_event = threading.Event()
        ready_event = threading.Event()

        def hold_slot():
            with pe._heavy_gate:
                ready_event.set()
                release_event.wait(timeout=3)

        holder = threading.Thread(target=hold_slot)
        holder.start()
        ready_event.wait(timeout=2)

        with pytest.raises(ServerBusyError):
            pe.probe(img_path)

        release_event.set()
        holder.join(timeout=3)

    def test_exception_during_open_still_releases_slot(self, tmp_path):
        """File hỏng ném PhotoEngineError bên trong gate — slot vẫn phải
        được trả lại, không rò rỉ."""
        pe.configure_concurrency(limit=1, wait_timeout_s=3)
        broken = tmp_path / "broken.jpg"
        broken.write_bytes(b"not a real jpeg")

        with pytest.raises(pe.PhotoEngineError):
            pe.probe(broken)

        valid = tmp_path / "valid.jpg"
        Image.new("RGB", (100, 100), "white").save(valid)
        info = pe.probe(valid)
        assert info.width == 100


class TestPhotoAndVideoGatesAreFullyIndependent:
    """Xác nhận 2 module (video_engine, photo_engine) có gate hoàn toàn tách
    biệt — bão hoà gate ảnh không được ảnh hưởng gì tới gate video và ngược
    lại, vì đây là 2 tài nguyên khác nhau (RAM cho ảnh, CPU tiến trình con
    cho video) không nên chia sẻ hạn mức."""

    def teardown_method(self):
        pe.configure_concurrency(limit=pe._HEAVY_LIMIT_DEFAULT, wait_timeout_s=30)

    def test_saturating_photo_gate_does_not_affect_video_gate_stats(self, tmp_path):
        import video_engine as ve

        pe.configure_concurrency(limit=1, wait_timeout_s=3)
        release_event = threading.Event()
        ready_event = threading.Event()

        def hold_photo_slot():
            with pe._heavy_gate:
                ready_event.set()
                release_event.wait(timeout=3)

        holder = threading.Thread(target=hold_photo_slot)
        holder.start()
        ready_event.wait(timeout=2)

        video_stats = ve.concurrency_stats()
        assert video_stats["heavy"]["running"] == 0
        assert video_stats["light"]["running"] == 0

        release_event.set()
        holder.join(timeout=3)

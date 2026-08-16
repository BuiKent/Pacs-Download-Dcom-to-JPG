"""pytest cho hệ thống giới hạn đồng thời trong video_engine.py.

Dùng threading thật (không mock semaphore) để chứng minh hành vi thật:
- Giới hạn heavy/light có tác dụng chặn số tác vụ chạy song song
- Tác vụ vượt giới hạn phải CHỜ (không bị từ chối ngay) cho tới khi có chỗ
- Chờ quá timeout thì ném ServerBusyError đúng loại
- concurrency_stats() phản ánh đúng số đang chạy/đang chờ tại một thời điểm
"""

import threading
import time

import pytest

import video_engine as ve
from video_engine import ServerBusyError, _ConcurrencyGate


class TestConcurrencyGateUnit:
    """Test trực tiếp _ConcurrencyGate — nhanh, không cần FFmpeg, kiểm tra
    đúng cơ chế semaphore + hàng đợi + timeout ở mức đơn vị nhỏ nhất."""

    def test_allows_up_to_limit_simultaneously(self):
        gate = _ConcurrencyGate(limit=2, wait_timeout_s=5, name="test")
        entered = []
        barrier = threading.Barrier(2, timeout=3)

        def worker(idx):
            with gate:
                entered.append(idx)
                barrier.wait()
                time.sleep(0.05)

        threads = [threading.Thread(target=worker, args=(i,)) for i in range(2)]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=5)

        assert set(entered) == {0, 1}, "cả 2 tác vụ trong giới hạn phải chạy được đồng thời"

    def test_third_task_waits_until_slot_frees(self):
        """Giới hạn 1: tác vụ thứ 2 phải CHỜ tới khi tác vụ 1 xong, không bị
        từ chối ngay và không chạy chồng lên nhau."""
        gate = _ConcurrencyGate(limit=1, wait_timeout_s=5, name="test")
        timeline = []
        lock = threading.Lock()

        def worker(idx, hold_s):
            with gate:
                with lock:
                    timeline.append(("start", idx, time.time()))
                time.sleep(hold_s)
                with lock:
                    timeline.append(("end", idx, time.time()))

        t1 = threading.Thread(target=worker, args=(1, 0.15))
        t2 = threading.Thread(target=worker, args=(2, 0.05))
        t1.start()
        time.sleep(0.02)
        t2.start()
        t1.join(timeout=5)
        t2.join(timeout=5)

        starts_ends = {(kind, idx): ts for kind, idx, ts in timeline}
        assert starts_ends[("end", 1)] <= starts_ends[("start", 2)] + 0.01, \
            f"task 2 không được bắt đầu trước khi task 1 kết thúc: {timeline}"

    def test_raises_server_busy_when_wait_timeout_exceeded(self):
        """Giới hạn 1, wait_timeout rất ngắn: tác vụ thứ 2 phải nhận
        ServerBusyError thay vì treo vô hạn."""
        gate = _ConcurrencyGate(limit=1, wait_timeout_s=0.1, name="test")
        release_event = threading.Event()

        def hold_slot():
            with gate:
                release_event.wait(timeout=2)

        holder = threading.Thread(target=hold_slot)
        holder.start()
        time.sleep(0.05)

        with pytest.raises(ServerBusyError):
            with gate:
                pass

        release_event.set()
        holder.join(timeout=3)

    def test_stats_reflects_running_and_waiting_counts(self):
        gate = _ConcurrencyGate(limit=1, wait_timeout_s=3, name="test")
        release_event = threading.Event()
        ready_event = threading.Event()

        def hold_slot():
            with gate:
                ready_event.set()
                release_event.wait(timeout=3)

        holder = threading.Thread(target=hold_slot)
        holder.start()
        ready_event.wait(timeout=2)

        def waiter():
            with gate:
                pass

        w = threading.Thread(target=waiter)
        w.start()
        time.sleep(0.05)

        stats = gate.stats()
        assert stats["running"] == 1
        assert stats["waiting"] == 1

        release_event.set()
        holder.join(timeout=3)
        w.join(timeout=3)

        final_stats = gate.stats()
        assert final_stats["running"] == 0
        assert final_stats["waiting"] == 0

    def test_reconfigure_changes_limit_for_subsequent_acquisitions(self):
        gate = _ConcurrencyGate(limit=1, wait_timeout_s=3, name="test")
        gate.reconfigure(limit=3)
        entered = []
        barrier = threading.Barrier(3, timeout=3)

        def worker(idx):
            with gate:
                entered.append(idx)
                barrier.wait()

        threads = [threading.Thread(target=worker, args=(i,)) for i in range(3)]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=5)

        assert len(entered) == 3, "sau reconfigure(limit=3), cả 3 tác vụ phải vào được đồng thời"

    def test_exception_inside_with_block_still_releases_slot(self):
        gate = _ConcurrencyGate(limit=1, wait_timeout_s=2, name="test")

        with pytest.raises(ValueError):
            with gate:
                raise ValueError("lỗi giả lập bên trong tác vụ")

        with gate:
            pass


class TestModuleLevelGates:
    """Test các gate module-level thật (_heavy_gate/_light_gate) mà mọi hàm
    nghiệp vụ (trim/concat/transcode/probe...) đi qua."""

    def teardown_method(self):
        ve.configure_concurrency(
            heavy_limit=ve._HEAVY_LIMIT_DEFAULT,
            light_limit=ve._LIGHT_LIMIT_DEFAULT,
            heavy_wait_timeout_s=120,
            light_wait_timeout_s=30,
        )

    def test_default_limits_are_positive(self):
        stats = ve.concurrency_stats()
        assert stats["heavy"]["limit"] >= 1
        assert stats["light"]["limit"] >= 1

    def test_configure_concurrency_changes_heavy_limit(self):
        ve.configure_concurrency(heavy_limit=7)
        assert ve.concurrency_stats()["heavy"]["limit"] == 7

    def test_configure_concurrency_changes_light_limit_independently(self):
        ve.configure_concurrency(light_limit=9)
        stats = ve.concurrency_stats()
        assert stats["light"]["limit"] == 9

    def test_heavy_and_light_gates_are_independent(self):
        ve.configure_concurrency(heavy_limit=1, light_limit=1,
                                  heavy_wait_timeout_s=3, light_wait_timeout_s=3)
        release_event = threading.Event()
        ready_event = threading.Event()

        def hold_heavy():
            with ve._heavy_gate:
                ready_event.set()
                release_event.wait(timeout=3)

        holder = threading.Thread(target=hold_heavy)
        holder.start()
        ready_event.wait(timeout=2)

        light_stats_during = ve.concurrency_stats()["light"]
        assert light_stats_during["running"] == 0

        acquired = ve._light_gate._sem.acquire(timeout=1)
        assert acquired, "light gate phải chiếm được ngay dù heavy gate đang đầy"
        ve._light_gate._sem.release()

        release_event.set()
        holder.join(timeout=3)


class TestTranscodeUsesGateForReal:
    @pytest.fixture()
    def sample_video(self, tmp_path_factory):
        import subprocess
        out_dir = tmp_path_factory.mktemp("concurrency_video_fixtures")
        path = out_dir / "sample.mp4"
        subprocess.run([
            ve._ffmpeg(), "-y",
            "-f", "lavfi", "-i", "testsrc2=size=320x240:rate=15:duration=2",
            "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
            str(path),
        ], check=True, capture_output=True)
        return path

    def teardown_method(self):
        ve.configure_concurrency(
            heavy_limit=ve._HEAVY_LIMIT_DEFAULT,
            light_limit=ve._LIGHT_LIMIT_DEFAULT,
            heavy_wait_timeout_s=120,
            light_wait_timeout_s=30,
        )

    def test_second_transcode_waits_for_first_when_limit_is_one(self, sample_video, tmp_path):
        ve.configure_concurrency(heavy_limit=1, heavy_wait_timeout_s=30)
        timeline = []
        lock = threading.Lock()

        def run_transcode(idx, out_name):
            with lock:
                timeline.append(("queued", idx, time.time()))
            out = tmp_path / out_name
            ve.transcode(sample_video, out, use_hw=False, crf=30)
            with lock:
                timeline.append(("done", idx, time.time()))

        t1 = threading.Thread(target=run_transcode, args=(1, "out1.mp4"))
        t2 = threading.Thread(target=run_transcode, args=(2, "out2.mp4"))
        t1.start()
        time.sleep(0.03)
        t2.start()
        t1.join(timeout=60)
        t2.join(timeout=60)

        events = {(kind, idx): ts for kind, idx, ts in timeline}
        assert ("done", 1) in events and ("done", 2) in events
        assert events[("done", 1)] < events[("done", 2)], \
            f"kỳ vọng task 1 hoàn thành trước task 2 khi heavy_limit=1: {timeline}"

    def test_probe_still_works_while_heavy_gate_saturated(self, sample_video, tmp_path):
        ve.configure_concurrency(heavy_limit=1, heavy_wait_timeout_s=30)
        release_event = threading.Event()

        def hold_heavy_slot():
            with ve._heavy_gate:
                release_event.wait(timeout=5)

        holder = threading.Thread(target=hold_heavy_slot)
        holder.start()
        time.sleep(0.05)

        try:
            start = time.time()
            info = ve.probe(sample_video)
            elapsed = time.time() - start
            assert info.width == 320
            assert elapsed < 4.0, "probe (light) không được bị heavy gate chặn (chờ 5s)"
        finally:
            release_event.set()
            holder.join(timeout=5)

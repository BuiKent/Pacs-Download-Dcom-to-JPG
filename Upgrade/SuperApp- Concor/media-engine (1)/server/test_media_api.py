"""pytest cho media_api.py — dùng FastAPI TestClient (không cần server chạy
nền thật), nhưng vẫn gọi xuống video_engine/photo_engine thật (FFmpeg/Pillow
thật chạy dưới mui xe của mỗi request test).

Chú ý đặc biệt: TestPathSecurity tái hiện đúng bug path-traversal trả nhầm
500 thay vì 403/404 đã phát hiện trong quá trình phát triển — giữ test này
để không bao giờ tái diễn khi có ai sửa lại _resolve_existing()/route sau này.
"""

import subprocess
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from PIL import Image

import media_api
from fastapi import FastAPI


@pytest.fixture()
def client(tmp_path, monkeypatch):
    # Mỗi test dùng WORK_ROOT riêng biệt (tmp_path) để test không dây vào
    # nhau qua thư mục /tmp/concord_media_work dùng chung ngoài đời thật.
    monkeypatch.setattr(media_api, "WORK_ROOT", tmp_path)
    app = FastAPI()
    app.include_router(media_api.router, prefix="/api/media")
    return TestClient(app)


@pytest.fixture()
def sample_video_bytes(tmp_path_factory):
    out_dir = tmp_path_factory.mktemp("api_video_fixtures")
    path = out_dir / "sample.mp4"
    subprocess.run([
        "ffmpeg", "-y",
        "-f", "lavfi", "-i", "testsrc2=size=320x240:rate=15:duration=3",
        "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
        str(path),
    ], check=True, capture_output=True)
    return path.read_bytes()


@pytest.fixture()
def sample_photo_bytes(tmp_path_factory):
    out_dir = tmp_path_factory.mktemp("api_photo_fixtures")
    path = out_dir / "sample.jpg"
    Image.new("RGB", (400, 300), "white").save(path)
    return path.read_bytes()


def _upload(client, filename, content, content_type):
    return client.post(
        "/api/media/upload",
        files={"file": (filename, content, content_type)},
    )


class TestUpload:
    def test_video_upload_returns_work_path(self, client, sample_video_bytes):
        resp = _upload(client, "clip.mp4", sample_video_bytes, "video/mp4")
        assert resp.status_code == 200
        body = resp.json()
        assert body["kind"] == "video"
        assert Path(body["workPath"]).exists()

    def test_photo_upload_returns_work_path(self, client, sample_photo_bytes):
        resp = _upload(client, "scan.jpg", sample_photo_bytes, "image/jpeg")
        assert resp.status_code == 200
        assert resp.json()["kind"] == "photo"

    def test_unsupported_extension_rejected(self, client):
        resp = _upload(client, "notes.txt", b"hello world", "text/plain")
        assert resp.status_code == 400


class TestVideoRoutes:
    def test_probe_returns_correct_metadata(self, client, sample_video_bytes):
        work_path = _upload(client, "clip.mp4", sample_video_bytes, "video/mp4").json()["workPath"]
        resp = client.get("/api/media/video/probe", params={"path": work_path})
        assert resp.status_code == 200
        body = resp.json()
        assert body["width"] == 320
        assert body["height"] == 240

    def test_trim_returns_new_work_path(self, client, sample_video_bytes):
        work_path = _upload(client, "clip.mp4", sample_video_bytes, "video/mp4").json()["workPath"]
        resp = client.post("/api/media/video/trim", json={"path": work_path, "startS": 0, "endS": 1.5})
        assert resp.status_code == 200
        trimmed_path = resp.json()["workPath"]
        assert Path(trimmed_path).exists()
        assert trimmed_path != work_path

    def test_trim_invalid_range_returns_400_not_500(self, client, sample_video_bytes):
        work_path = _upload(client, "clip.mp4", sample_video_bytes, "video/mp4").json()["workPath"]
        resp = client.post("/api/media/video/trim", json={"path": work_path, "startS": 5, "endS": 1})
        assert resp.status_code == 400

    def test_hw_encoders_endpoint_works(self, client):
        resp = client.get("/api/media/video/hw-encoders")
        assert resp.status_code == 200
        assert "nvenc" in resp.json()


class TestPhotoRoutes:
    def test_probe_returns_dimensions(self, client, sample_photo_bytes):
        work_path = _upload(client, "scan.jpg", sample_photo_bytes, "image/jpeg").json()["workPath"]
        resp = client.get("/api/media/photo/probe", params={"path": work_path})
        assert resp.status_code == 200
        body = resp.json()
        assert body["width"] == 400
        assert body["height"] == 300

    def test_crop_returns_new_work_path(self, client, sample_photo_bytes):
        work_path = _upload(client, "scan.jpg", sample_photo_bytes, "image/jpeg").json()["workPath"]
        resp = client.post("/api/media/photo/crop", json={
            "path": work_path, "rect": {"x": 0, "y": 0, "width": 100, "height": 100},
        })
        assert resp.status_code == 200

    def test_crop_out_of_bounds_returns_400_not_500(self, client, sample_photo_bytes):
        work_path = _upload(client, "scan.jpg", sample_photo_bytes, "image/jpeg").json()["workPath"]
        resp = client.post("/api/media/photo/crop", json={
            "path": work_path, "rect": {"x": 9000, "y": 9000, "width": 100, "height": 100},
        })
        assert resp.status_code == 400

    def test_redact_returns_new_work_path(self, client, sample_photo_bytes):
        work_path = _upload(client, "scan.jpg", sample_photo_bytes, "image/jpeg").json()["workPath"]
        resp = client.post("/api/media/photo/redact", json={
            "path": work_path, "regions": [{"x": 10, "y": 10, "width": 50, "height": 50}],
        })
        assert resp.status_code == 200


class TestPathSecurity:
    """Bug đã phát hiện: _resolve_existing() ném HTTPException(403) đúng,
    nhưng route bọc nó bằng `except Exception` chung khiến FastAPI trả 500
    thay vì 403 — status code sai làm client không phân biệt được lỗi bảo
    mật (đừng thử lại) với lỗi tạm thời (có thể thử lại). Test này khoá lại
    hành vi đúng."""

    def test_absolute_path_outside_work_root_returns_403(self, client):
        resp = client.get("/api/media/video/probe", params={"path": "/etc/passwd"})
        assert resp.status_code == 403
        assert "Lỗi xử lý nội bộ" not in resp.text

    def test_traversal_sequence_returns_403(self, client):
        resp = client.get("/api/media/video/probe", params={"path": "../../../../etc/passwd"})
        assert resp.status_code == 403

    def test_photo_route_also_protected(self, client):
        resp = client.get("/api/media/photo/probe", params={"path": "/etc/shadow"})
        assert resp.status_code == 403

    def test_nonexistent_path_inside_work_root_returns_404(self, client, tmp_path):
        fake_path = str(tmp_path / "nonexistent.mp4")
        resp = client.get("/api/media/video/probe", params={"path": fake_path})
        assert resp.status_code == 404

    def test_post_routes_also_protected(self, client):
        resp = client.post("/api/media/video/trim", json={
            "path": "/etc/passwd", "startS": 0, "endS": 1,
        })
        assert resp.status_code == 403


class TestHealthEndpoint:
    def test_returns_video_and_photo_stats(self, client):
        resp = client.get("/api/media/health")
        assert resp.status_code == 200
        body = resp.json()
        assert "video" in body and "photo" in body
        assert "heavy" in body["video"] and "light" in body["video"]
        assert "photo" in body["photo"]

    def test_stats_shape_matches_engine_output(self, client):
        resp = client.get("/api/media/health")
        heavy = resp.json()["video"]["heavy"]
        assert set(heavy.keys()) == {"name", "limit", "running", "waiting"}


class TestConcurrencyReturns429ThroughHttp:
    """Xác nhận ServerBusyError ở tầng engine thật sự trở thành HTTP 429 khi
    đi qua toàn bộ đường ống HTTP (route -> _engine_error_to_http), không
    chỉ đúng ở tầng engine cô lập (đã test riêng trong test_concurrency.py)."""

    def test_video_probe_returns_429_when_gate_saturated(self, client, sample_video_bytes, monkeypatch):
        import threading
        import video_engine as ve

        work_path = _upload(client, "clip.mp4", sample_video_bytes, "video/mp4").json()["workPath"]

        # Bão hoà light gate (probe dùng light) với limit=1, timeout ngắn
        monkeypatch.setattr(ve, "_light_gate", ve._ConcurrencyGate(limit=1, wait_timeout_s=0.05, name="light"))
        release_event = threading.Event()
        ready_event = threading.Event()

        def hold_slot():
            with ve._light_gate:
                ready_event.set()
                release_event.wait(timeout=3)

        holder = threading.Thread(target=hold_slot)
        holder.start()
        ready_event.wait(timeout=2)

        resp = client.get("/api/media/video/probe", params={"path": work_path})
        assert resp.status_code == 429

        release_event.set()
        holder.join(timeout=3)

    def test_photo_crop_returns_429_when_gate_saturated(self, client, sample_photo_bytes, monkeypatch):
        import threading
        import photo_engine as pe

        work_path = _upload(client, "scan.jpg", sample_photo_bytes, "image/jpeg").json()["workPath"]

        monkeypatch.setattr(pe, "_heavy_gate", pe._ConcurrencyGate(limit=1, wait_timeout_s=0.05, name="photo"))
        release_event = threading.Event()
        ready_event = threading.Event()

        def hold_slot():
            with pe._heavy_gate:
                ready_event.set()
                release_event.wait(timeout=3)

        holder = threading.Thread(target=hold_slot)
        holder.start()
        ready_event.wait(timeout=2)

        resp = client.post("/api/media/photo/crop", json={
            "path": work_path, "rect": {"x": 0, "y": 0, "width": 10, "height": 10},
        })
        assert resp.status_code == 429

        release_event.set()
        holder.join(timeout=3)

"""pytest bổ sung cho các route của media_api.py chưa có test HTTP trước đó
(phát hiện qua đo coverage: media_api.py chỉ 72% trước khi có file này).

Dùng chung fixtures với test_media_api.py (client, sample_video_bytes,
sample_photo_bytes, _upload) bằng cách import trực tiếp — tránh định nghĩa
trùng lặp fixture giữa 2 file.
"""

import subprocess

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image

import media_api

# Tái sử dụng fixture/helper đã có, không định nghĩa lại
from test_media_api import client, sample_video_bytes, sample_photo_bytes, _upload


class TestVideoThumbnailRoute:
    def test_returns_work_path_to_jpeg(self, client, sample_video_bytes):
        work_path = _upload(client, "clip.mp4", sample_video_bytes, "video/mp4").json()["workPath"]
        resp = client.get("/api/media/video/thumbnail", params={"path": work_path, "atSeconds": 1.0})
        assert resp.status_code == 200
        thumb_path = resp.json()["workPath"]
        assert thumb_path.endswith(".jpg")

    def test_default_at_seconds_zero_works(self, client, sample_video_bytes):
        work_path = _upload(client, "clip.mp4", sample_video_bytes, "video/mp4").json()["workPath"]
        resp = client.get("/api/media/video/thumbnail", params={"path": work_path})
        assert resp.status_code == 200

    def test_nonexistent_path_returns_404(self, client, tmp_path):
        resp = client.get("/api/media/video/thumbnail", params={"path": str(tmp_path / "ghost.mp4")})
        assert resp.status_code == 404


class TestVideoFilmstripRoute:
    def test_returns_requested_frame_count(self, client, sample_video_bytes):
        work_path = _upload(client, "clip.mp4", sample_video_bytes, "video/mp4").json()["workPath"]
        resp = client.post("/api/media/video/filmstrip", json={"path": work_path, "count": 4})
        assert resp.status_code == 200
        frames = resp.json()["frames"]
        assert len(frames) == 4

    def test_default_count_is_twelve(self, client, sample_video_bytes):
        work_path = _upload(client, "clip.mp4", sample_video_bytes, "video/mp4").json()["workPath"]
        resp = client.post("/api/media/video/filmstrip", json={"path": work_path})
        assert len(resp.json()["frames"]) == 12

    def test_traversal_path_returns_403(self, client):
        resp = client.post("/api/media/video/filmstrip", json={"path": "/etc/passwd"})
        assert resp.status_code == 403


class TestVideoBurnTextRoute:
    def test_single_overlay_returns_new_work_path(self, client, sample_video_bytes):
        work_path = _upload(client, "clip.mp4", sample_video_bytes, "video/mp4").json()["workPath"]
        resp = client.post("/api/media/video/burn-text", json={
            "path": work_path,
            "overlays": [{"text": "Ghi chú: đặt trocar"}],
        })
        assert resp.status_code == 200
        assert resp.json()["workPath"] != work_path

    def test_multiple_overlays_with_timing(self, client, sample_video_bytes):
        work_path = _upload(client, "clip.mp4", sample_video_bytes, "video/mp4").json()["workPath"]
        resp = client.post("/api/media/video/burn-text", json={
            "path": work_path,
            "overlays": [
                {"text": "Camera 1", "x": "20", "y": "40"},
                {"text": "Mốc 12:30", "startS": 0.5, "endS": 1.5},
            ],
        })
        assert resp.status_code == 200

    def test_empty_overlay_list_returns_400(self, client, sample_video_bytes):
        work_path = _upload(client, "clip.mp4", sample_video_bytes, "video/mp4").json()["workPath"]
        resp = client.post("/api/media/video/burn-text", json={"path": work_path, "overlays": []})
        assert resp.status_code == 400


class TestVideoConcatRoute:
    @pytest.fixture()
    def second_video_bytes(self, tmp_path_factory):
        out_dir = tmp_path_factory.mktemp("second_clip")
        path = out_dir / "second.avi"
        subprocess.run([
            "ffmpeg", "-y", "-f", "lavfi", "-i", "testsrc2=size=240x180:rate=12:duration=1",
            "-c:v", "mpeg4", str(path),
        ], check=True, capture_output=True)
        return path.read_bytes()

    def test_merges_two_uploaded_clips(self, client, sample_video_bytes, second_video_bytes):
        p1 = _upload(client, "a.mp4", sample_video_bytes, "video/mp4").json()["workPath"]
        p2 = _upload(client, "b.avi", second_video_bytes, "video/avi").json()["workPath"]
        resp = client.post("/api/media/video/concat", json={"paths": [p1, p2], "targetHeight": 180})
        assert resp.status_code == 200
        assert resp.json()["workPath"] not in (p1, p2)

    def test_single_path_returns_400(self, client, sample_video_bytes):
        p1 = _upload(client, "a.mp4", sample_video_bytes, "video/mp4").json()["workPath"]
        resp = client.post("/api/media/video/concat", json={"paths": [p1]})
        assert resp.status_code == 400

    def test_one_valid_one_traversal_path_returns_403(self, client, sample_video_bytes):
        p1 = _upload(client, "a.mp4", sample_video_bytes, "video/mp4").json()["workPath"]
        resp = client.post("/api/media/video/concat", json={"paths": [p1, "/etc/passwd"]})
        assert resp.status_code == 403


class TestVideoExportRoute:
    def test_software_export_returns_work_path(self, client, sample_video_bytes):
        work_path = _upload(client, "clip.mp4", sample_video_bytes, "video/mp4").json()["workPath"]
        resp = client.post("/api/media/video/export", json={"path": work_path, "useHw": False, "crf": 28})
        assert resp.status_code == 200

    def test_default_params_work(self, client, sample_video_bytes):
        work_path = _upload(client, "clip.mp4", sample_video_bytes, "video/mp4").json()["workPath"]
        resp = client.post("/api/media/video/export", json={"path": work_path})
        assert resp.status_code == 200


class TestPhotoRotateRoute:
    def test_rotate_90_returns_work_path(self, client, sample_photo_bytes):
        work_path = _upload(client, "scan.jpg", sample_photo_bytes, "image/jpeg").json()["workPath"]
        resp = client.post("/api/media/photo/rotate", json={"path": work_path, "degrees": 90})
        assert resp.status_code == 200

    def test_invalid_angle_returns_400(self, client, sample_photo_bytes):
        work_path = _upload(client, "scan.jpg", sample_photo_bytes, "image/jpeg").json()["workPath"]
        resp = client.post("/api/media/photo/rotate", json={"path": work_path, "degrees": 45})
        assert resp.status_code == 400

    def test_traversal_path_returns_403(self, client):
        resp = client.post("/api/media/photo/rotate", json={"path": "/etc/passwd", "degrees": 90})
        assert resp.status_code == 403


class TestPhotoAnnotateRoute:
    def test_text_annotation_returns_work_path(self, client, sample_photo_bytes):
        work_path = _upload(client, "scan.jpg", sample_photo_bytes, "image/jpeg").json()["workPath"]
        resp = client.post("/api/media/photo/annotate", json={
            "path": work_path,
            "texts": [{"text": "Tổn thương nghi ngờ", "x": 50, "y": 50}],
        })
        assert resp.status_code == 200

    def test_arrow_and_box_annotation(self, client, sample_photo_bytes):
        work_path = _upload(client, "scan.jpg", sample_photo_bytes, "image/jpeg").json()["workPath"]
        resp = client.post("/api/media/photo/annotate", json={
            "path": work_path,
            "arrows": [{"x1": 10, "y1": 10, "x2": 100, "y2": 100}],
            "boxes": [{"x": 20, "y": 20, "width": 60, "height": 60}],
        })
        assert resp.status_code == 200

    def test_box_outside_bounds_returns_400(self, client, sample_photo_bytes):
        work_path = _upload(client, "scan.jpg", sample_photo_bytes, "image/jpeg").json()["workPath"]
        resp = client.post("/api/media/photo/annotate", json={
            "path": work_path,
            "boxes": [{"x": 9000, "y": 9000, "width": 100, "height": 100}],
        })
        assert resp.status_code == 400


class TestPhotoExportPdfRoute:
    def test_single_image_pdf(self, client, sample_photo_bytes):
        work_path = _upload(client, "scan.jpg", sample_photo_bytes, "image/jpeg").json()["workPath"]
        resp = client.post("/api/media/photo/export-pdf", json={"paths": [work_path]})
        assert resp.status_code == 200
        assert resp.json()["workPath"].endswith(".pdf")

    def test_multi_image_pdf(self, client, sample_photo_bytes):
        p1 = _upload(client, "a.jpg", sample_photo_bytes, "image/jpeg").json()["workPath"]
        p2 = _upload(client, "b.jpg", sample_photo_bytes, "image/jpeg").json()["workPath"]
        resp = client.post("/api/media/photo/export-pdf", json={"paths": [p1, p2]})
        assert resp.status_code == 200

    def test_empty_paths_returns_400(self, client):
        resp = client.post("/api/media/photo/export-pdf", json={"paths": []})
        assert resp.status_code == 400

    def test_traversal_in_list_returns_403(self, client, sample_photo_bytes):
        p1 = _upload(client, "a.jpg", sample_photo_bytes, "image/jpeg").json()["workPath"]
        resp = client.post("/api/media/photo/export-pdf", json={"paths": [p1, "/etc/passwd"]})
        assert resp.status_code == 403


class TestPhotoRedactRoute:
    """redact route đã có test cơ bản trong test_media_api.py; bổ sung
    trường hợp custom fill color chưa được phủ."""

    def test_custom_fill_color(self, client, sample_photo_bytes):
        work_path = _upload(client, "scan.jpg", sample_photo_bytes, "image/jpeg").json()["workPath"]
        resp = client.post("/api/media/photo/redact", json={
            "path": work_path,
            "regions": [{"x": 10, "y": 10, "width": 30, "height": 30}],
            "fill": [255, 0, 0],
        })
        assert resp.status_code == 200

    def test_empty_regions_returns_400(self, client, sample_photo_bytes):
        work_path = _upload(client, "scan.jpg", sample_photo_bytes, "image/jpeg").json()["workPath"]
        resp = client.post("/api/media/photo/redact", json={"path": work_path, "regions": []})
        assert resp.status_code == 400

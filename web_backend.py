"""Local-only HTTP backend for the WebView2 DICOM/JPG viewer.

The server is deliberately bound to 127.0.0.1 on a random port.  Every API
and image request requires a per-process bearer token, and image paths are
resolved through opaque series identifiers instead of accepting file paths
from the browser.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import re
import secrets
import threading
import time
from dataclasses import dataclass, field
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Callable, Optional
from urllib.parse import unquote, urlparse

import dcom_pipeline
import mpr_engine


APP_VERSION = "1.1.0"
IMG_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}
ANNOTATIONS_NAME = "viewer-annotations.json"
MIME_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
    ".svg": "image/svg+xml",
    ".wasm": "application/wasm",
}


def _natural_key(value: str) -> list[Any]:
    return [int(item) if item.isdigit() else item.casefold() for item in re.split(r"(\d+)", value)]


def _json_bytes(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def _finite_numbers(value: Any, count: int) -> Optional[list[float]]:
    if not isinstance(value, list) or len(value) != count:
        return None
    try:
        result = [float(item) for item in value]
    except (TypeError, ValueError):
        return None
    return result if all(math.isfinite(item) for item in result) else None


def validate_mpr_manifest(folder: Path, manifest: Optional[dict]) -> tuple[bool, str]:
    """Validate geometry/completeness before exposing MPR or 3D controls."""
    if not manifest:
        return False, "Series này chỉ có ảnh 2D, không có gói hình học MPR."
    if manifest.get("format") != mpr_engine.MANIFEST_FORMAT:
        return False, "Định dạng manifest MPR không được hỗ trợ."
    if int(manifest.get("version", 0) or 0) != mpr_engine.MANIFEST_VERSION:
        return False, "Phiên bản manifest MPR không tương thích."

    rows = int(manifest.get("rows", 0) or 0)
    columns = int(manifest.get("columns", 0) or 0)
    count = int(manifest.get("slice_count", 0) or 0)
    spacing = _finite_numbers(manifest.get("pixel_spacing"), 2)
    orientation = _finite_numbers(manifest.get("image_orientation_patient"), 6)
    affine = manifest.get("affine")
    ordered = manifest.get("ordered_slices")

    if rows <= 0 or columns <= 0 or count < mpr_engine.DEFAULT_MIN_SLICES:
        return False, f"Cần ít nhất {mpr_engine.DEFAULT_MIN_SLICES} lát đồng nhất để dựng MPR/3D."
    if not spacing or min(spacing) <= 0:
        return False, "PixelSpacing không hợp lệ."
    try:
        slice_spacing = float(manifest.get("slice_spacing", 0))
    except (TypeError, ValueError):
        slice_spacing = 0
    if not math.isfinite(slice_spacing) or slice_spacing <= 0:
        return False, "Khoảng cách lát cắt không hợp lệ."
    if not orientation:
        return False, "ImageOrientationPatient không hợp lệ."
    row = orientation[:3]
    column = orientation[3:]
    row_norm = math.sqrt(sum(item * item for item in row))
    column_norm = math.sqrt(sum(item * item for item in column))
    dot = sum(a * b for a, b in zip(row, column))
    if abs(row_norm - 1) > 1e-3 or abs(column_norm - 1) > 1e-3 or abs(dot) > 1e-3:
        return False, "Hai vector định hướng DICOM không trực chuẩn."
    if not (
        isinstance(affine, list)
        and len(affine) == 4
        and all(_finite_numbers(item, 4) is not None for item in affine)
    ):
        return False, "Ma trận affine DICOM không hợp lệ."
    if not isinstance(ordered, list) or len(ordered) != count:
        return False, f"Gói MPR thiếu lát: có {len(ordered or [])}/{count}."

    distances: list[float] = []
    seen_files: set[str] = set()
    for item in ordered:
        if not isinstance(item, dict):
            return False, "Danh sách lát MPR bị hỏng."
        filename = str(item.get("file") or "")
        position = _finite_numbers(item.get("position"), 3)
        try:
            distance = float(item.get("distance"))
        except (TypeError, ValueError):
            return False, "Tọa độ lát MPR không hợp lệ."
        if (
            not filename
            or filename in seen_files
            or Path(filename).name != filename
            or not position
            or not math.isfinite(distance)
            or not (folder / filename).is_file()
        ):
            return False, "Một hoặc nhiều lát MPR bị thiếu hay không an toàn."
        seen_files.add(filename)
        distances.append(distance)

    if any(b <= a for a, b in zip(distances, distances[1:])):
        return False, "Thứ tự tọa độ lát MPR không tăng đều."
    if distances:
        gaps = [b - a for a, b in zip(distances, distances[1:])]
        if gaps and max(abs(gap - slice_spacing) for gap in gaps) > max(0.05, slice_spacing * 0.05):
            return False, "Khoảng cách giữa các lát không đồng nhất."
    return True, ""


@dataclass
class SeriesRecord:
    series_id: str
    name: str
    folder: Path
    images: list[Path]
    manifest: Optional[dict]
    mpr_ready: bool
    mpr_reason: str

    def public_dict(self) -> dict:
        data = {
            "id": self.series_id,
            "name": self.name,
            "sliceCount": len(self.images),
            "mprReady": self.mpr_ready,
            "mprReason": self.mpr_reason,
            "seriesType": (self.manifest or {}).get("series_type", ""),
            "description": (self.manifest or {}).get("series_description", self.name),
        }
        if self.mpr_ready and self.manifest:
            data["geometry"] = {
                "rows": int(self.manifest["rows"]),
                "columns": int(self.manifest["columns"]),
                "pixelSpacing": self.manifest["pixel_spacing"],
                "sliceSpacing": float(self.manifest["slice_spacing"]),
                "orientation": self.manifest["image_orientation_patient"],
                "frameOfReferenceUID": self.manifest.get("frame_of_reference_uid") or self.series_id,
            }
        return data


class ArchiveCatalog:
    def __init__(self) -> None:
        self._lock = threading.RLock()
        self.root: Optional[Path] = None
        self._series: dict[str, SeriesRecord] = {}

    @staticmethod
    def _image_files(folder: Path, manifest: Optional[dict]) -> list[Path]:
        if manifest:
            files = mpr_engine.manifest_image_files(folder, manifest)
            if files:
                return files
        return sorted(
            (
                path for path in folder.iterdir()
                if path.is_file() and path.suffix.casefold() in IMG_EXTENSIONS
            ),
            key=lambda path: _natural_key(path.name),
        )

    def open(self, value: os.PathLike[str] | str) -> dict:
        root = Path(value).expanduser().resolve(strict=True)
        if not root.is_dir():
            raise ValueError("Đường dẫn không phải thư mục.")
        candidates = [root] + sorted(
            (item for item in root.rglob("*") if item.is_dir()),
            key=lambda path: _natural_key(str(path.relative_to(root))),
        )
        records: dict[str, SeriesRecord] = {}
        for folder in candidates:
            relative_parts = folder.relative_to(root).parts
            if any(part.upper() in {"DICOM", "RAW_JPG"} for part in relative_parts):
                continue
            manifest = mpr_engine.read_manifest(folder)
            images = self._image_files(folder, manifest)
            if not images:
                continue
            digest = hashlib.sha256(str(folder).casefold().encode("utf-8")).hexdigest()[:20]
            ready, reason = validate_mpr_manifest(folder, manifest)
            relative_name = str(folder.relative_to(root)) if folder != root else folder.name
            records[digest] = SeriesRecord(
                series_id=digest,
                name=relative_name,
                folder=folder,
                images=images,
                manifest=manifest,
                mpr_ready=ready,
                mpr_reason=reason,
            )
        with self._lock:
            self.root = root
            self._series = records
        return self.snapshot()

    def snapshot(self) -> dict:
        with self._lock:
            return {
                "root": str(self.root) if self.root else "",
                "series": [record.public_dict() for record in self._series.values()],
            }

    def get(self, series_id: str) -> SeriesRecord:
        with self._lock:
            record = self._series.get(series_id)
        if not record:
            raise KeyError("Không tìm thấy series.")
        return record


@dataclass
class JobState:
    lock: threading.RLock = field(default_factory=threading.RLock)
    stop_event: threading.Event = field(default_factory=threading.Event)
    status: str = "idle"
    kind: str = ""
    message: str = ""
    logs: list[str] = field(default_factory=list)
    result: Any = None
    started_at: float = 0
    finished_at: float = 0

    def snapshot(self) -> dict:
        with self.lock:
            return {
                "status": self.status,
                "kind": self.kind,
                "message": self.message,
                "logs": self.logs[-300:],
                "result": self.result,
                "startedAt": self.started_at,
                "finishedAt": self.finished_at,
            }

    def log(self, message: str) -> None:
        text = str(message)
        with self.lock:
            self.logs.append(text)
            if len(self.logs) > 1000:
                del self.logs[:500]
            self.message = text

    def start(self, kind: str, target: Callable[[], Any]) -> None:
        with self.lock:
            if self.status == "running":
                raise RuntimeError("Một tác vụ khác đang chạy.")
            self.stop_event = threading.Event()
            self.status = "running"
            self.kind = kind
            self.message = "Đang chuẩn bị..."
            self.logs = []
            self.result = None
            self.started_at = time.time()
            self.finished_at = 0

        def run() -> None:
            try:
                result = target()
                with self.lock:
                    self.result = result
                    self.status = "stopped" if self.stop_event.is_set() else "complete"
                    self.message = "Đã dừng." if self.stop_event.is_set() else "Hoàn tất."
            except Exception as exc:
                self.log(f"Lỗi: {exc}")
                with self.lock:
                    self.status = "error"
            finally:
                with self.lock:
                    self.finished_at = time.time()

        threading.Thread(target=run, name=f"dcom-{kind}", daemon=True).start()


class WebController:
    def __init__(self) -> None:
        self.catalog = ArchiveCatalog()
        self.job = JobState()
        self.output_root = Path.home() / "DCom JPG PACS"

    def bootstrap(self) -> dict:
        return {
            "version": APP_VERSION,
            "archive": self.catalog.snapshot(),
            "job": self.job.snapshot(),
            "outputRoot": str(self.output_root),
            "hospitals": [
                {"id": key, "name": value["name"]}
                for key, value in dcom_pipeline.HOSPITALS.items()
            ],
        }

    def open_archive(self, path: str) -> dict:
        return self.catalog.open(path)

    def set_output_root(self, path: str) -> dict:
        root = Path(path).expanduser().resolve()
        root.mkdir(parents=True, exist_ok=True)
        self.output_root = root
        return {"outputRoot": str(root)}

    def start_search(self, payload: dict) -> dict:
        hospital = str(payload.get("hospital") or "dhy")
        patient_id = str(payload.get("patientId") or "").strip()
        if not patient_id:
            raise ValueError("Cần nhập mã bệnh nhân.")

        def target() -> list[dict]:
            return dcom_pipeline.search_patient_studies(
                hospital_key=hospital,
                patient_id=patient_id,
                modality="MR_CT",
                log=self.job.log,
                headless=not bool(payload.get("showBrowser")),
                should_stop=self.job.stop_event.is_set,
            )

        self.job.start("search", target)
        return self.job.snapshot()

    def start_download(self, payload: dict) -> dict:
        studies = payload.get("studies")
        if not isinstance(studies, list) or not studies:
            raise ValueError("Chưa chọn ca chụp.")
        output_root = Path(str(payload.get("outputRoot") or self.output_root)).expanduser().resolve()
        output_root.mkdir(parents=True, exist_ok=True)
        quality = max(70, min(int(payload.get("quality", 100)), 100))

        def target() -> dict:
            total = dcom_pipeline.download_studies_list(
                studies=studies,
                out_base=output_root,
                log=self.job.log,
                headless=not bool(payload.get("showBrowser")),
                quality=quality,
                save_png=bool(payload.get("savePng")),
                contrast_mode=str(payload.get("contrastMode") or dcom_pipeline.CLINICAL),
                should_stop=self.job.stop_event.is_set,
            )
            archive = self.catalog.open(output_root)
            return {"downloaded": total, "archive": archive}

        self.job.start("download", target)
        return self.job.snapshot()

    def start_direct_download(self, payload: dict) -> dict:
        url = str(payload.get("url") or "").strip()
        parsed = urlparse(url)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            raise ValueError("Link viewer không hợp lệ.")
        output_root = Path(str(payload.get("outputRoot") or self.output_root)).expanduser().resolve()
        output_root.mkdir(parents=True, exist_ok=True)

        def target() -> dict:
            _, _, jpg_dir = dcom_pipeline.run_pipeline(
                url=url,
                out_base=output_root,
                log=self.job.log,
                headless=not bool(payload.get("showBrowser")),
                quality=max(70, min(int(payload.get("quality", 100)), 100)),
                save_png=bool(payload.get("savePng")),
                contrast_mode=str(payload.get("contrastMode") or dcom_pipeline.CLINICAL),
                should_stop=self.job.stop_event.is_set,
            )
            archive = self.catalog.open(jpg_dir if Path(jpg_dir).exists() else output_root)
            return {"archive": archive}

        self.job.start("direct-download", target)
        return self.job.snapshot()

    def stop(self) -> dict:
        self.job.stop_event.set()
        self.job.log("Đang yêu cầu dừng an toàn...")
        return self.job.snapshot()

    def get_annotations(self, series_id: str) -> dict:
        record = self.catalog.get(series_id)
        path = record.folder / ANNOTATIONS_NAME
        if not path.is_file():
            return {"version": 1, "annotations": []}
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            return {"version": 1, "annotations": []}
        return data if isinstance(data, dict) else {"version": 1, "annotations": []}

    def save_annotations(self, series_id: str, value: dict) -> dict:
        record = self.catalog.get(series_id)
        annotations = value.get("annotations")
        if not isinstance(annotations, list):
            raise ValueError("Dữ liệu đo/ROI không hợp lệ.")
        payload = {"version": 1, "annotations": annotations}
        path = record.folder / ANNOTATIONS_NAME
        temporary = path.with_suffix(".json.tmp")
        temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        temporary.replace(path)
        return {"saved": True, "count": len(annotations)}


class LocalApiServer:
    def __init__(self, controller: WebController, static_dir: Path):
        self.controller = controller
        self.static_dir = Path(static_dir).resolve()
        self.token = secrets.token_urlsafe(32)
        self.httpd: Optional[ThreadingHTTPServer] = None
        self.thread: Optional[threading.Thread] = None

    @property
    def port(self) -> int:
        if not self.httpd:
            raise RuntimeError("Server chưa khởi động.")
        return int(self.httpd.server_port)

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self.port}/?token={self.token}"

    def start(self) -> str:
        owner = self

        class Handler(BaseHTTPRequestHandler):
            server_version = "DComLocal/1.1"

            def log_message(self, _format: str, *_args: Any) -> None:
                return

            def _headers(self, content_type: str, length: int) -> None:
                self.send_header("Content-Type", content_type)
                self.send_header("Content-Length", str(length))
                self.send_header("Cache-Control", "no-store")
                self.send_header("X-Content-Type-Options", "nosniff")
                self.send_header("X-Frame-Options", "DENY")
                self.send_header("Referrer-Policy", "no-referrer")
                self.send_header(
                    "Content-Security-Policy",
                    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
                    "img-src 'self' blob: data:; worker-src 'self' blob:; connect-src 'self'; "
                    "object-src 'none'; frame-ancestors 'none'; base-uri 'none'",
                )

            def _send(self, status: int, body: bytes, content_type: str) -> None:
                self.send_response(status)
                self._headers(content_type, len(body))
                self.end_headers()
                self.wfile.write(body)

            def _json(self, status: int, value: Any) -> None:
                self._send(status, _json_bytes(value), "application/json; charset=utf-8")

            def _authorized(self) -> bool:
                host = self.headers.get("Host", "")
                if host not in {f"127.0.0.1:{owner.port}", f"localhost:{owner.port}"}:
                    return False
                origin = self.headers.get("Origin")
                if origin and origin not in {
                    f"http://127.0.0.1:{owner.port}",
                    f"http://localhost:{owner.port}",
                }:
                    return False
                return secrets.compare_digest(self.headers.get("X-DCom-Token", ""), owner.token)

            def _read_json(self) -> dict:
                try:
                    length = int(self.headers.get("Content-Length", "0"))
                except ValueError:
                    raise ValueError("Content-Length không hợp lệ.")
                if length < 0 or length > 2 * 1024 * 1024:
                    raise ValueError("Yêu cầu quá lớn.")
                try:
                    value = json.loads(self.rfile.read(length).decode("utf-8")) if length else {}
                except Exception as exc:
                    raise ValueError("JSON không hợp lệ.") from exc
                if not isinstance(value, dict):
                    raise ValueError("Payload phải là object.")
                return value

            def _api_get(self, path: str) -> Any:
                if path == "/api/bootstrap":
                    return owner.controller.bootstrap()
                if path == "/api/archive":
                    return owner.controller.catalog.snapshot()
                if path == "/api/job":
                    return owner.controller.job.snapshot()
                match = re.fullmatch(r"/api/series/([a-f0-9]{20})/manifest", path)
                if match:
                    record = owner.controller.catalog.get(match.group(1))
                    if not record.mpr_ready:
                        raise ValueError(record.mpr_reason)
                    return record.manifest
                match = re.fullmatch(r"/api/series/([a-f0-9]{20})/annotations", path)
                if match:
                    return owner.controller.get_annotations(match.group(1))
                raise KeyError("API không tồn tại.")

            def _api_post(self, path: str, payload: dict) -> Any:
                if path == "/api/archive/open":
                    return owner.controller.open_archive(str(payload.get("path") or ""))
                if path == "/api/output":
                    return owner.controller.set_output_root(str(payload.get("path") or ""))
                if path == "/api/search":
                    return owner.controller.start_search(payload)
                if path == "/api/download":
                    return owner.controller.start_download(payload)
                if path == "/api/download/direct":
                    return owner.controller.start_direct_download(payload)
                if path == "/api/job/stop":
                    return owner.controller.stop()
                match = re.fullmatch(r"/api/series/([a-f0-9]{20})/annotations", path)
                if match:
                    return owner.controller.save_annotations(match.group(1), payload)
                raise KeyError("API không tồn tại.")

            def _serve_image(self, path: str) -> bool:
                match = re.fullmatch(r"/api/series/([a-f0-9]{20})/image/(\d+)", path)
                if not match:
                    return False
                record = owner.controller.catalog.get(match.group(1))
                index = int(match.group(2))
                if not 0 <= index < len(record.images):
                    raise IndexError("Lát ảnh ngoài phạm vi.")
                image = record.images[index]
                body = image.read_bytes()
                mime = MIME_TYPES.get(image.suffix.casefold(), "application/octet-stream")
                self._send(HTTPStatus.OK, body, mime)
                return True

            def _static(self, path: str) -> None:
                relative = "index.html" if path in {"", "/"} else unquote(path.lstrip("/"))
                candidate = (owner.static_dir / relative).resolve()
                try:
                    candidate.relative_to(owner.static_dir)
                except ValueError:
                    self._json(HTTPStatus.NOT_FOUND, {"error": "Không tìm thấy."})
                    return
                if not candidate.is_file():
                    candidate = owner.static_dir / "index.html"
                if not candidate.is_file():
                    self._json(HTTPStatus.SERVICE_UNAVAILABLE, {"error": "Frontend chưa được build."})
                    return
                body = candidate.read_bytes()
                mime = MIME_TYPES.get(candidate.suffix.casefold(), "application/octet-stream")
                self._send(HTTPStatus.OK, body, mime)

            def do_GET(self) -> None:  # noqa: N802
                path = urlparse(self.path).path
                if path.startswith("/api/"):
                    if not self._authorized():
                        self._json(HTTPStatus.UNAUTHORIZED, {"error": "Không được phép."})
                        return
                    try:
                        if self._serve_image(path):
                            return
                        self._json(HTTPStatus.OK, self._api_get(path))
                    except KeyError as exc:
                        self._json(HTTPStatus.NOT_FOUND, {"error": str(exc)})
                    except (ValueError, IndexError) as exc:
                        self._json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
                    except Exception as exc:
                        self._json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": str(exc)})
                    return
                self._static(path)

            def do_POST(self) -> None:  # noqa: N802
                path = urlparse(self.path).path
                if not path.startswith("/api/") or not self._authorized():
                    self._json(HTTPStatus.UNAUTHORIZED, {"error": "Không được phép."})
                    return
                try:
                    self._json(HTTPStatus.OK, self._api_post(path, self._read_json()))
                except KeyError as exc:
                    self._json(HTTPStatus.NOT_FOUND, {"error": str(exc)})
                except (ValueError, RuntimeError) as exc:
                    self._json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
                except Exception as exc:
                    self._json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": str(exc)})

        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.httpd.daemon_threads = True
        self.thread = threading.Thread(target=self.httpd.serve_forever, name="dcom-local-api", daemon=True)
        self.thread.start()
        return self.url

    def stop(self) -> None:
        if self.httpd:
            self.httpd.shutdown()
            self.httpd.server_close()
        if self.thread and self.thread.is_alive():
            self.thread.join(timeout=2)

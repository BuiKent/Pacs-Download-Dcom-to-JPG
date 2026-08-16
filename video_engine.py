"""
video_engine.py — lõi xử lý video, độc lập framework web.

Thiết kế:
  - Không tự viết codec. FFmpeg (libx264/libx265/NVENC/QSV) đã là chuẩn công
    nghiệp cho decode/encode; "viết engine" ở tầng ứng dụng nghĩa là điều
    khiển FFmpeg đúng cách (probe an toàn, timeout, tiến trình, dọn file tạm),
    không phải viết lại H.264.
  - Mọi hàm ở đây là sync + subprocess, chạy trong threadpool khi gọi từ backend.
  - Không ghi đè file gốc. Ghi output ra đường dẫn mới do caller chỉ định,
    khớp yêu cầu "bản gốc bất khả xâm phạm" trong thiết kế PACS.
"""

from __future__ import annotations

import json
import logging
import os
import shutil
import subprocess
import sys
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path

logger = logging.getLogger("video_engine")

# ---------------------------------------------------------------------------
# Giới hạn đồng thời
# ---------------------------------------------------------------------------


class ServerBusyError(Exception):
    """Hàng đợi xử lý đã đầy quá lâu — client nên báo người dùng thử lại sau."""


class _ConcurrencyGate:
    """Semaphore có giới hạn thời gian chờ + đếm số tác vụ đang chạy/đang chờ."""

    def __init__(self, limit: int, wait_timeout_s: float, name: str):
        self._sem = threading.Semaphore(limit)
        self._limit = limit
        self._wait_timeout_s = wait_timeout_s
        self._name = name
        self._lock = threading.Lock()
        self._running = 0
        self._waiting = 0

    def reconfigure(self, limit: int, wait_timeout_s: float | None = None) -> None:
        with self._lock:
            self._sem = threading.Semaphore(limit)
            self._limit = limit
            if wait_timeout_s is not None:
                self._wait_timeout_s = wait_timeout_s

    def stats(self) -> dict:
        with self._lock:
            return {
                "name": self._name,
                "limit": self._limit,
                "running": self._running,
                "waiting": self._waiting,
            }

    def __enter__(self):
        with self._lock:
            self._waiting += 1
        acquired = self._sem.acquire(timeout=self._wait_timeout_s)
        with self._lock:
            self._waiting -= 1
        if not acquired:
            raise ServerBusyError(
                f"Máy chủ đang xử lý quá nhiều tác vụ video ({self._name}); "
                f"vui lòng thử lại sau ít phút."
            )
        with self._lock:
            self._running += 1
        return self

    def __exit__(self, exc_type, exc, tb):
        with self._lock:
            self._running -= 1
        self._sem.release()


_cpu_count = os.cpu_count() or 2
_HEAVY_LIMIT_DEFAULT = max(1, min(4, _cpu_count - 1)) if _cpu_count > 1 else 1
_LIGHT_LIMIT_DEFAULT = _HEAVY_LIMIT_DEFAULT * 3

_heavy_gate = _ConcurrencyGate(_HEAVY_LIMIT_DEFAULT, wait_timeout_s=120, name="heavy")
_light_gate = _ConcurrencyGate(_LIGHT_LIMIT_DEFAULT, wait_timeout_s=30, name="light")


def configure_concurrency(
    heavy_limit: int | None = None,
    light_limit: int | None = None,
    heavy_wait_timeout_s: float | None = None,
    light_wait_timeout_s: float | None = None,
) -> None:
    """Ghi đè giới hạn mặc định."""
    if heavy_limit is not None:
        _heavy_gate.reconfigure(heavy_limit, heavy_wait_timeout_s)
    elif heavy_wait_timeout_s is not None:
        _heavy_gate.reconfigure(_heavy_gate._limit, heavy_wait_timeout_s)
    if light_limit is not None:
        _light_gate.reconfigure(light_limit, light_wait_timeout_s)
    elif light_wait_timeout_s is not None:
        _light_gate.reconfigure(_light_gate._limit, light_wait_timeout_s)


def concurrency_stats() -> dict:
    """Cho endpoint health-check hoặc UI hiển thị thống kê tải."""
    return {"heavy": _heavy_gate.stats(), "light": _light_gate.stats()}


# ---------------------------------------------------------------------------
# Định vị binary FFmpeg: ưu tiên bản đóng gói kèm app trong tools/bin
# ---------------------------------------------------------------------------

_FFMPEG_BIN: str | None = None
_FFPROBE_BIN: str | None = None


def configure_binaries(ffmpeg_dir: Path | None = None) -> None:
    """Định vị ffmpeg và ffprobe."""
    global _FFMPEG_BIN, _FFPROBE_BIN
    exe_suffix = ".exe" if _is_windows() else ""

    # 1. Nếu caller chỉ định thư mục cụ thể, chỉ kiểm tra thư mục đó
    if ffmpeg_dir is not None:
        cand_dir = Path(ffmpeg_dir)
        cand_ff = cand_dir / f"ffmpeg{exe_suffix}"
        cand_probe = cand_dir / f"ffprobe{exe_suffix}"
        if cand_ff.exists() and cand_probe.exists():
            _FFMPEG_BIN = str(cand_ff)
            _FFPROBE_BIN = str(cand_probe)
            logger.info("Dùng FFmpeg từ thư mục chỉ định: %s", cand_dir)
            return
        # Nếu thư mục chỉ định thiếu binary, rơi trực tiếp về PATH hệ thống cho cả 2
        _FFMPEG_BIN = shutil.which("ffmpeg")
        _FFPROBE_BIN = shutil.which("ffprobe")
        if not _FFMPEG_BIN or not _FFPROBE_BIN:
            _FFMPEG_BIN = None
            _FFPROBE_BIN = None
            raise RuntimeError(
                "Không tìm thấy ffmpeg/ffprobe. Hãy đóng gói binary vào "
                "<app_root>/tools/bin/ hoặc cài FFmpeg vào PATH hệ thống."
            )
        logger.info("Dùng FFmpeg từ PATH hệ thống (fallback từ thư mục chỉ định): %s", _FFMPEG_BIN)
        return

    # 2. ffmpeg_dir is None: Tự động tìm trong các thư mục đóng gói mặc định
    search_dirs = []
    if getattr(sys, "frozen", False):
        if hasattr(sys, "_MEIPASS"):
            search_dirs.append(Path(sys._MEIPASS) / "tools" / "bin")
            search_dirs.append(Path(sys._MEIPASS) / "bin")
        exe_dir = Path(sys.executable).resolve().parent
        search_dirs.append(exe_dir / "tools" / "bin")
        search_dirs.append(exe_dir / "bin")
    else:
        app_root = Path(__file__).resolve().parent
        search_dirs.append(app_root / "tools" / "bin")
        search_dirs.append(app_root / "bin")

    for candidate_dir in search_dirs:
        candidate_ff = candidate_dir / f"ffmpeg{exe_suffix}"
        candidate_probe = candidate_dir / f"ffprobe{exe_suffix}"
        if candidate_ff.exists() and candidate_probe.exists():
            _FFMPEG_BIN = str(candidate_ff)
            _FFPROBE_BIN = str(candidate_probe)
            logger.info("Dùng FFmpeg đóng gói kèm app: %s", candidate_dir)
            return

    # 3. Rơi về PATH hệ thống
    _FFMPEG_BIN = shutil.which("ffmpeg")
    _FFPROBE_BIN = shutil.which("ffprobe")
    if not _FFMPEG_BIN or not _FFPROBE_BIN:
        _FFMPEG_BIN = None
        _FFPROBE_BIN = None
        raise RuntimeError(
            "Không tìm thấy ffmpeg/ffprobe. Hãy đóng gói binary vào "
            "<app_root>/tools/bin/ hoặc cài FFmpeg vào PATH hệ thống."
        )
    logger.info("Dùng FFmpeg từ PATH hệ thống: %s", _FFMPEG_BIN)


def _is_windows() -> bool:
    import platform
    return platform.system() == "Windows"


def _ffmpeg() -> str:
    if _FFMPEG_BIN is None:
        configure_binaries(None)
    return _FFMPEG_BIN  # type: ignore[return-value]


def _ffprobe() -> str:
    if _FFPROBE_BIN is None:
        configure_binaries(None)
    return _FFPROBE_BIN  # type: ignore[return-value]


# ---------------------------------------------------------------------------
# Lỗi có cấu trúc
# ---------------------------------------------------------------------------


class VideoEngineError(Exception):
    """Lỗi nghiệp vụ an toàn để hiển thị cho người dùng."""


class UnsupportedFormatError(VideoEngineError):
    pass


class ProbeFailedError(VideoEngineError):
    pass


class EncodeFailedError(VideoEngineError):
    def __init__(self, message: str, stderr_tail: str = ""):
        super().__init__(message)
        self.stderr_tail = stderr_tail


SUPPORTED_EXTENSIONS = {".mp4", ".avi", ".mkv", ".mpeg", ".mpg", ".mov", ".m4v", ".wmv", ".webm"}

_DEFAULT_TIMEOUT_S = 60 * 30  # 30 phút


def _run(
    cmd: list[str],
    timeout: int = _DEFAULT_TIMEOUT_S,
    gate: _ConcurrencyGate | None = None,
) -> subprocess.CompletedProcess:
    gate = gate or _heavy_gate
    logger.debug("exec: %s", " ".join(cmd))
    with gate:
        try:
            return subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=timeout,
                check=False,
            )
        except subprocess.TimeoutExpired as exc:
            raise EncodeFailedError(f"Quá thời gian xử lý ({timeout}s), tác vụ đã bị huỷ.") from exc
        except FileNotFoundError as exc:
            raise VideoEngineError(f"Không chạy được ffmpeg/ffprobe: {exc}") from exc


def _stderr_tail(proc: subprocess.CompletedProcess, lines: int = 12) -> str:
    return "\n".join((proc.stderr or "").strip().splitlines()[-lines:])


# ---------------------------------------------------------------------------
# Probe: đọc metadata an toàn
# ---------------------------------------------------------------------------


@dataclass
class VideoInfo:
    path: str
    duration_s: float
    width: int
    height: int
    fps: float
    codec: str
    format_name: str
    has_audio: bool
    size_bytes: int
    raw: dict = field(repr=False, default_factory=dict)


def probe(path: str | Path, timeout: int = 20) -> VideoInfo:
    path = Path(path)
    if not path.exists():
        raise ProbeFailedError(f"Không tìm thấy file: {path.name}")
    if path.suffix.lower() not in SUPPORTED_EXTENSIONS:
        raise UnsupportedFormatError(
            f"Định dạng {path.suffix} chưa được hỗ trợ. "
            f"Hỗ trợ: {', '.join(sorted(SUPPORTED_EXTENSIONS))}"
        )

    cmd = [
        _ffprobe(), "-v", "error",
        "-print_format", "json",
        "-show_format", "-show_streams",
        str(path),
    ]
    proc = _run(cmd, timeout=timeout, gate=_light_gate)
    if proc.returncode != 0:
        raise ProbeFailedError(f"File hỏng hoặc không đọc được: {_stderr_tail(proc, 5)}")

    try:
        data = json.loads(proc.stdout)
    except json.JSONDecodeError as exc:
        raise ProbeFailedError("ffprobe trả dữ liệu không hợp lệ.") from exc

    video_stream = next((s for s in data.get("streams", []) if s.get("codec_type") == "video"), None)
    audio_stream = next((s for s in data.get("streams", []) if s.get("codec_type") == "audio"), None)
    if not video_stream:
        raise UnsupportedFormatError("File không chứa track video.")

    fmt = data.get("format", {})
    num, den = (video_stream.get("r_frame_rate") or "0/1").split("/")
    fps = (float(num) / float(den)) if float(den or 1) else 0.0

    return VideoInfo(
        path=str(path),
        duration_s=float(fmt.get("duration") or video_stream.get("duration") or 0),
        width=int(video_stream.get("width") or 0),
        height=int(video_stream.get("height") or 0),
        fps=round(fps, 3),
        codec=video_stream.get("codec_name", "?"),
        format_name=fmt.get("format_name", "?"),
        has_audio=audio_stream is not None,
        size_bytes=int(fmt.get("size") or path.stat().st_size),
        raw=data,
    )


# ---------------------------------------------------------------------------
# Thumbnail / filmstrip
# ---------------------------------------------------------------------------


def extract_thumbnail(
    src: str | Path,
    out_jpg: str | Path,
    at_seconds: float = 0.0,
    max_width: int = 320,
    timeout: int = 20,
) -> Path:
    src, out_jpg = Path(src), Path(out_jpg)
    out_jpg.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        _ffmpeg(), "-y",
        "-ss", f"{max(0.0, at_seconds):.3f}",
        "-i", str(src),
        "-frames:v", "1",
        "-vf", f"scale={max_width}:-2",
        "-q:v", "3",
        str(out_jpg),
    ]
    proc = _run(cmd, timeout=timeout, gate=_light_gate)
    if proc.returncode != 0 or not out_jpg.exists():
        raise EncodeFailedError("Không tạo được thumbnail.", _stderr_tail(proc))
    return out_jpg


def extract_filmstrip(
    src: str | Path,
    out_dir: str | Path,
    count: int = 12,
    max_width: int = 160,
    timeout: int = 60,
    max_workers: int = 4,
) -> list[Path]:
    from concurrent.futures import ThreadPoolExecutor, as_completed

    info = probe(src)
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    if info.duration_s <= 0:
        raise ProbeFailedError("Không xác định được thời lượng video.")
    step = info.duration_s / max(count, 1)

    jobs = []
    for i in range(count):
        ts = min(i * step, max(info.duration_s - 0.05, 0))
        out_path = out_dir / f"frame_{i:03d}.jpg"
        jobs.append((i, ts, out_path))

    results: list[Path | None] = [None] * count
    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        futures = {
            pool.submit(extract_thumbnail, src, out_path, ts, max_width, timeout): i
            for i, ts, out_path in jobs
        }
        for future in as_completed(futures):
            i = futures[future]
            results[i] = future.result()
    return results  # type: ignore[return-value]


# ---------------------------------------------------------------------------
# Trim
# ---------------------------------------------------------------------------


def trim(
    src: str | Path,
    out_path: str | Path,
    start_s: float,
    end_s: float,
    reencode: bool = False,
    timeout: int = _DEFAULT_TIMEOUT_S,
) -> Path:
    src, out_path = Path(src), Path(out_path)
    if end_s <= start_s:
        raise VideoEngineError("Điểm kết thúc phải sau điểm bắt đầu.")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    duration = end_s - start_s

    if not reencode:
        cmd = [
            _ffmpeg(), "-y",
            "-ss", f"{start_s:.3f}", "-i", str(src),
            "-t", f"{duration:.3f}",
            "-c", "copy", "-avoid_negative_ts", "make_zero",
            str(out_path),
        ]
    else:
        cmd = [
            _ffmpeg(), "-y",
            "-i", str(src),
            "-ss", f"{start_s:.3f}", "-t", f"{duration:.3f}",
            "-c:v", "libx264", "-preset", "fast", "-crf", "20",
            "-c:a", "aac", "-b:a", "160k",
            str(out_path),
        ]
    proc = _run(cmd, timeout=timeout, gate=_light_gate if not reencode else _heavy_gate)
    if proc.returncode != 0 or not out_path.exists():
        raise EncodeFailedError("Cắt video thất bại.", _stderr_tail(proc))
    return out_path


# ---------------------------------------------------------------------------
# Burn-in text / Annotation
# ---------------------------------------------------------------------------


@dataclass
class TextOverlay:
    text: str
    x: str = "20"
    y: str = "h-40"
    font_size: int = 28
    color: str = "white"
    box: bool = True
    box_color: str = "black@0.55"
    start_s: float | None = None
    end_s: float | None = None


def _escape_drawtext(text: str) -> str:
    return (
        text.replace("\\", "\\\\")
        .replace(":", "\\:")
        .replace("'", "\u2019")
    )


def burn_text(
    src: str | Path,
    out_path: str | Path,
    overlays: list[TextOverlay],
    timeout: int = _DEFAULT_TIMEOUT_S,
) -> Path:
    src, out_path = Path(src), Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    if not overlays:
        raise VideoEngineError("Cần ít nhất một nội dung chèn chữ.")

    filters = []
    for ov in overlays:
        parts = [
            f"text='{_escape_drawtext(ov.text)}'",
            f"x={ov.x}", f"y={ov.y}",
            f"fontsize={ov.font_size}", f"fontcolor={ov.color}",
        ]
        if ov.box:
            parts += ["box=1", f"boxcolor={ov.box_color}", "boxborderw=6"]
        if ov.start_s is not None and ov.end_s is not None:
            parts.append(f"enable='between(t,{ov.start_s},{ov.end_s})'")
        filters.append("drawtext=" + ":".join(parts))

    cmd = [
        _ffmpeg(), "-y", "-i", str(src),
        "-vf", ",".join(filters),
        "-c:v", "libx264", "-preset", "fast", "-crf", "20",
        "-c:a", "copy",
        str(out_path),
    ]
    proc = _run(cmd, timeout=timeout, gate=_heavy_gate)
    if proc.returncode != 0 or not out_path.exists():
        raise EncodeFailedError("Chèn chữ vào video thất bại.", _stderr_tail(proc))
    return out_path


# ---------------------------------------------------------------------------
# Concat
# ---------------------------------------------------------------------------


def concat(
    sources: list[str | Path],
    out_path: str | Path,
    target_height: int = 1080,
    target_fps: int = 30,
    timeout: int = _DEFAULT_TIMEOUT_S,
) -> Path:
    if len(sources) < 2:
        raise VideoEngineError("Cần ít nhất 2 clip để ghép.")
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    for s in sources:
        probe(s)

    inputs: list[str] = []
    for s in sources:
        inputs += ["-i", str(s)]

    filter_parts = []
    concat_inputs = []
    for i, s in enumerate(sources):
        info = probe(s)
        vf = (
            f"[{i}:v]scale=-2:{target_height}:force_original_aspect_ratio=decrease,"
            f"pad=ceil(iw/2)*2:{target_height}:(ow-iw)/2:(oh-ih)/2,"
            f"fps={target_fps},setsar=1[v{i}]"
        )
        filter_parts.append(vf)
        if info.has_audio:
            filter_parts.append(f"[{i}:a]aresample=44100,aformat=channel_layouts=stereo[a{i}]")
        else:
            filter_parts.append(
                f"anullsrc=channel_layout=stereo:sample_rate=44100:d={info.duration_s:.3f}[a{i}]"
            )
        concat_inputs += [f"[v{i}]", f"[a{i}]"]

    filter_parts.append("".join(concat_inputs) + f"concat=n={len(sources)}:v=1:a=1[outv][outa]")
    filter_complex = ";".join(filter_parts)

    cmd = [
        _ffmpeg(), "-y", *inputs,
        "-filter_complex", filter_complex,
        "-map", "[outv]", "-map", "[outa]",
        "-c:v", "libx264", "-preset", "fast", "-crf", "20",
        "-c:a", "aac", "-b:a", "160k",
        str(out_path),
    ]
    proc = _run(cmd, timeout=timeout, gate=_heavy_gate)
    if proc.returncode != 0 or not out_path.exists():
        raise EncodeFailedError("Ghép clip thất bại.", _stderr_tail(proc))
    return out_path


# ---------------------------------------------------------------------------
# Hardware encoder detection & transcode
# ---------------------------------------------------------------------------


def detect_hw_encoders(timeout: int = 10) -> dict[str, bool]:
    try:
        proc = _run([_ffmpeg(), "-hide_banner", "-encoders"], timeout=timeout, gate=_light_gate)
        text = proc.stdout or ""
        return {
            "nvenc": "h264_nvenc" in text,
            "qsv": "h264_qsv" in text,
            "vaapi": "h264_vaapi" in text,
            "videotoolbox": "h264_videotoolbox" in text,
        }
    except Exception:
        return {"nvenc": False, "qsv": False, "vaapi": False, "videotoolbox": False}


def transcode(
    src: str | Path,
    out_path: str | Path,
    use_hw: bool = False,
    crf: int = 20,
    timeout: int = _DEFAULT_TIMEOUT_S,
    progress_cb=None,
) -> Path:
    src, out_path = Path(src), Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    encoders = detect_hw_encoders() if use_hw else {}
    video_codec = ["-c:v", "h264_nvenc", "-preset", "p4", "-cq", str(crf)] if encoders.get("nvenc") \
        else ["-c:v", "libx264", "-preset", "fast", "-crf", str(crf)]

    cmd = [
        _ffmpeg(), "-y", "-progress", "pipe:1", "-nostats",
        "-i", str(src),
        *video_codec,
        "-c:a", "aac", "-b:a", "160k",
        "-pix_fmt", "yuv420p",
        str(out_path),
    ]

    if progress_cb is None:
        proc = _run(cmd, timeout=timeout, gate=_heavy_gate)
        if proc.returncode != 0 or not out_path.exists():
            raise EncodeFailedError("Xuất video thất bại.", _stderr_tail(proc))
        return out_path

    info = probe(src)
    total_us = info.duration_s * 1_000_000
    start = time.time()
    with _heavy_gate:
        process = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
        assert process.stdout is not None
        for line in process.stdout:
            if line.startswith("out_time_us=") and total_us > 0:
                try:
                    done_us = int(line.strip().split("=")[1])
                    progress_cb(min(done_us / total_us, 1.0), time.time() - start)
                except (ValueError, IndexError):
                    pass
        try:
            process.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()
            raise EncodeFailedError(f"Quá thời gian xuất video ({timeout}s), tác vụ đã bị huỷ.")
    if process.returncode != 0 or not out_path.exists():
        stderr = process.stderr.read() if process.stderr else ""
        raise EncodeFailedError("Xuất video thất bại.", "\n".join(stderr.splitlines()[-12:]))
    return out_path

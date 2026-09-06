"""
video_engine.py — surgical video processing, framework free.

Design:
  - No codec is written here. FFmpeg (libx264/libx265/NVENC/QSV) is already the
    industry standard for decode and encode; the "engine" at this layer means
    driving FFmpeg correctly — safe probing, timeouts, progress, temp-file
    cleanup — not reimplementing H.264.
  - Every function is synchronous and subprocess-based, meant to run on a
    threadpool when called from the backend.
  - The source file is never overwritten. Output goes to a new path chosen by
    the caller, matching the "original is inviolable" rule of the PACS design.
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
# Concurrency limits
# ---------------------------------------------------------------------------


class ServerBusyError(Exception):
    """The work queue stayed full too long; the client should ask the user to retry."""


class _ConcurrencyGate:
    """A semaphore with a wait timeout that also counts running and waiting tasks."""

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
    """Override the default limits."""
    if heavy_limit is not None:
        _heavy_gate.reconfigure(heavy_limit, heavy_wait_timeout_s)
    elif heavy_wait_timeout_s is not None:
        _heavy_gate.reconfigure(_heavy_gate._limit, heavy_wait_timeout_s)
    if light_limit is not None:
        _light_gate.reconfigure(light_limit, light_wait_timeout_s)
    elif light_wait_timeout_s is not None:
        _light_gate.reconfigure(_light_gate._limit, light_wait_timeout_s)


def concurrency_stats() -> dict:
    """Feeds the health-check endpoint and the UI load indicator."""
    return {"heavy": _heavy_gate.stats(), "light": _light_gate.stats()}


# ---------------------------------------------------------------------------
# Locate the FFmpeg binaries, preferring the copy bundled in tools/bin
# ---------------------------------------------------------------------------

_FFMPEG_BIN: str | None = None
_FFPROBE_BIN: str | None = None


def configure_binaries(ffmpeg_dir: Path | None = None) -> None:
    """Locate ffmpeg and ffprobe."""
    global _FFMPEG_BIN, _FFPROBE_BIN
    exe_suffix = ".exe" if _is_windows() else ""

    # 1. An explicit directory from the caller is checked on its own
    if ffmpeg_dir is not None:
        cand_dir = Path(ffmpeg_dir)
        cand_ff = cand_dir / f"ffmpeg{exe_suffix}"
        cand_probe = cand_dir / f"ffprobe{exe_suffix}"
        if cand_ff.exists() and cand_probe.exists():
            _FFMPEG_BIN = str(cand_ff)
            _FFPROBE_BIN = str(cand_probe)
            logger.info("Dùng FFmpeg từ thư mục chỉ định: %s", cand_dir)
            return
        # An incomplete bundle falls straight through to PATH for both binaries,
        # never mixing one from the bundle with one from PATH
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

    # 2. ffmpeg_dir is None: search the default bundle locations
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

    # 3. Fall back to the system PATH
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
# Structured errors
# ---------------------------------------------------------------------------


class VideoEngineError(Exception):
    """A business-rule failure whose message is safe to show the user."""


class UnsupportedFormatError(VideoEngineError):
    pass


class ProbeFailedError(VideoEngineError):
    pass


class EncodeFailedError(VideoEngineError):
    def __init__(self, message: str, stderr_tail: str = ""):
        super().__init__(message)
        self.stderr_tail = stderr_tail


SUPPORTED_EXTENSIONS = {".mp4", ".avi", ".mkv", ".mpeg", ".mpg", ".mov", ".m4v", ".wmv", ".webm"}

_DEFAULT_TIMEOUT_S = 60 * 30  # 30 minutes


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
                encoding="utf-8",
                errors="replace",
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
# Probe: read metadata safely
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
        process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
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


# ---------------------------------------------------------------------------
# Drawn overlays
# ---------------------------------------------------------------------------
#
# Arrows, circles, freehand and notes on a surgical video are the same shapes
# the photo studio draws, so they are not re-implemented as drawtext filters
# here. `photo_engine.render_overlay_png` rasterises the layer once, at the
# clip's own resolution, and ffmpeg composites that single transparent frame —
# which is both faster than a filter per shape and pixel-identical to what the
# reader approved on screen.
#
# Blur and redaction cannot work that way. Covering a face with a picture of a
# blur leaves the face in the file underneath; these filter the frames.


@dataclass
class OverlayLayer:
    """One rasterised drawing and the span it is on screen for.

    A clip carries several: an arrow that belongs to the moment a duct is
    clipped, a label that belongs to the closing, and a stamp that belongs to
    the whole recording. Shapes sharing a span are rasterised together, so the
    number of layers is the number of distinct spans, not the number of shapes.
    """

    png: Path
    start_s: float | None = None
    end_s: float | None = None


@dataclass
class BlurRegion:
    """A rectangle whose pixels are destroyed, optionally only for a while."""

    x: int
    y: int
    width: int
    height: int
    mode: str = "blur"  # "blur" mosaics the frames, "solid" paints them out
    strength: int = 12
    start_s: float | None = None
    end_s: float | None = None


def _enable_clause(start_s: float | None, end_s: float | None) -> str:
    """The `enable=` fragment that time-gates a filter, empty when it is always on."""
    if start_s is None or end_s is None or end_s <= start_s:
        return ""
    return f":enable='between(t,{max(0.0, float(start_s)):.3f},{float(end_s):.3f})'"


def _even_down(value: float, minimum: int) -> int:
    """Round down to an even number, not below `minimum`.

    Crop and overlay want even offsets and sizes on chroma-subsampled video.
    An offset's floor is 0 and a size's is 2: clamping an offset up to 2 pushed
    a region drawn against the top-left corner two pixels inward, which on a
    redaction leaves a two-pixel sliver of the patient's name at the edge, and
    on a full-frame region makes `x + width` exceed the frame.
    """
    return max(minimum, int(value) // 2 * 2)


def _fit_region(region: BlurRegion, frame: tuple[int, int] | None) -> tuple[int, int, int, int] | None:
    """
    The region as an even-aligned box guaranteed to sit inside the frame.

    ffmpeg's `crop` refuses a width or height larger than the input and the
    whole encode dies with it, so a rectangle that arrives oversized has to be
    trimmed here rather than discovered in a filtergraph error. Its `x`/`y` are
    merely clamped by ffmpeg, which is worse than an error: the blur silently
    lands somewhere other than where the reader put it.
    """
    x = _even_down(max(0, region.x), 0)
    y = _even_down(max(0, region.y), 0)
    width = _even_down(region.width, 2)
    height = _even_down(region.height, 2)
    if frame:
        frame_w, frame_h = frame
        x = min(x, max(0, _even_down(frame_w - 2, 0)))
        y = min(y, max(0, _even_down(frame_h - 2, 0)))
        width = _even_down(min(width, frame_w - x), 2)
        height = _even_down(min(height, frame_h - y), 2)
    if width < 2 or height < 2:
        return None
    return x, y, width, height


def _blur_filters(regions: list[BlurRegion], label: str,
                  frame: tuple[int, int] | None = None) -> tuple[list[str], str]:
    """
    Build the filter chain that destroys each region, returning it and the last label.

    Each blurred region needs the frame split in two — one copy to crop and
    blur, one to paste it back onto — because a filter graph edge can only be
    consumed once.
    """
    filters: list[str] = []
    current = label
    for index, region in enumerate(regions):
        gate = _enable_clause(region.start_s, region.end_s)
        fitted = _fit_region(region, frame)
        if fitted is None:
            continue
        x, y, width, height = fitted
        if region.mode == "solid":
            nxt = f"bx{index}"
            filters.append(
                f"[{current}]drawbox=x={x}:y={y}:w={width}:h={height}"
                f":color=black@1:t=fill{gate}[{nxt}]"
            )
            current = nxt
            continue
        # boxblur refuses a radius wider than half the plane it works on, and on
        # 4:2:0 video the chroma planes are half size — so a radius that is legal
        # for luma can still kill the encode on chroma. The limit is computed
        # against the smaller plane. Below a radius of 1 a blur means nothing
        # anyway, so the sliver is painted out rather than skipped: a redaction
        # that silently does nothing is the one outcome that must never happen.
        radius = min(
            int(region.strength),
            (width - 1) // 2, (height - 1) // 2,
            (width // 2 - 1) // 2, (height // 2 - 1) // 2,
        )
        if radius < 1:
            nxt = f"bx{index}"
            filters.append(
                f"[{current}]drawbox=x={x}:y={y}:w={width}:h={height}"
                f":color=black@1:t=fill{gate}[{nxt}]"
            )
            current = nxt
            continue
        keep, work, blurred, nxt = f"bk{index}", f"bw{index}", f"bb{index}", f"bo{index}"
        strength = max(1, min(60, radius))
        filters.append(f"[{current}]split=2[{keep}][{work}]")
        filters.append(
            f"[{work}]crop={width}:{height}:{x}:{y},boxblur={strength}:2[{blurred}]"
        )
        filters.append(f"[{keep}][{blurred}]overlay={x}:{y}{gate}[{nxt}]")
        current = nxt
    return filters, current


def burn_overlay(
    src: str | Path,
    out_path: str | Path,
    overlay_png: str | Path | None = None,
    start_s: float | None = None,
    end_s: float | None = None,
    blur_regions: list[BlurRegion] = (),
    overlays: list[OverlayLayer] = (),
    crf: int = 20,
    timeout: int = _DEFAULT_TIMEOUT_S,
) -> Path:
    """
    Composite drawn layers onto a clip, and blur or black out what must go.

    Each layer carries its own span, so a marker pointing at the moment the duct
    is clipped need not sit on screen for the whole operation while an identity
    stamp does. Blur regions carry their own spans for the same reason: a face
    is usually hidden for a different stretch than an arrow is shown.

    `overlay_png` with `start_s`/`end_s` is the single-layer shorthand.
    """
    src, out_path = Path(src), Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    regions = list(blur_regions or [])
    layers = list(overlays or [])
    if overlay_png is not None:
        layers.append(OverlayLayer(png=Path(overlay_png), start_s=start_s, end_s=end_s))
    if not layers and not regions:
        raise VideoEngineError("Chưa có nét vẽ hoặc vùng che nào để áp dụng lên video.")

    # The frame size is what makes a region safe to crop against. Probing costs
    # one ffprobe call and turns a filtergraph failure — which loses the whole
    # encode — into a rectangle trimmed to the edge.
    frame = None
    if regions:
        try:
            info = probe(src)
            frame = (info.width, info.height)
        except VideoEngineError:
            frame = None
    filters, label = _blur_filters(regions, "0:v", frame)
    inputs = ["-i", str(src)]
    for index, layer in enumerate(layers):
        if not layer.png.exists():
            raise VideoEngineError(f"Không tìm thấy file lớp vẽ: {layer.png.name}")
        # A single still frame, deliberately not looped: overlay's default
        # eof_action=repeat holds the last frame for the rest of the clip.
        # Looping it instead makes an endless input, and the encode then runs
        # until it is killed rather than ending with the video.
        inputs += ["-i", str(layer.png)]
        nxt = f"ov{index}"
        filters.append(
            f"[{label}][{index + 1}:v]overlay=0:0"
            f"{_enable_clause(layer.start_s, layer.end_s)}[{nxt}]"
        )
        label = nxt
    if filters and label == "0:v":
        filters.append(f"[{label}]null[vout]")
        label = "vout"

    cmd = [
        _ffmpeg(), "-y", *inputs,
        "-filter_complex", ";".join(filters),
        "-map", f"[{label}]", "-map", "0:a?",
        "-c:v", "libx264", "-preset", "fast", "-crf", str(max(0, min(51, int(crf)))),
        "-pix_fmt", "yuv420p",
        "-c:a", "copy",
        str(out_path),
    ]
    proc = _run(cmd, timeout=timeout, gate=_heavy_gate)
    if proc.returncode != 0 or not out_path.exists():
        raise EncodeFailedError("Áp dụng nét vẽ lên video thất bại.", _stderr_tail(proc))
    return out_path

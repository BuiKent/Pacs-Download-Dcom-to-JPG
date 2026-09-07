"""Application-wide session file logging for DCom JPG PACS v1.1.

Every time the application launches (via run_app.bat, python script, or PyInstaller EXE),
a dedicated session log file is created in the `logs/` directory:
    logs/app_YYYY-MM-DD_HH-MM-SS.log

Features:
- Thread-safe formatted logging with timestamps and log levels ([INFO], [WARN], [ERROR], [DEBUG]).
- Dual-stream stdio tee: captures print statements and uncaught exceptions to disk while preserving console output.
- Structured event logging for download jobs (patient identity, series, slice counts, network status, parity, errors).
- Automatic log retention: preserves the latest 30 session log files and purges files older than 14 days.
- Desktop integration: reveals logs folder in Windows Explorer and provides log file paths for UI diagnostics.
"""

from __future__ import annotations

import datetime
import io
import os
import platform
import sys
import threading
import traceback
from pathlib import Path
from typing import Any, Callable, Optional


def get_app_root() -> Path:
    """Return the application directory whether running as script or frozen EXE."""
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent


def get_logs_dir() -> Path:
    """Return the logs directory, falling back to LOCALAPPDATA if app root is read-only."""
    candidate = get_app_root() / "logs"
    try:
        candidate.mkdir(parents=True, exist_ok=True)
        test_file = candidate / ".write_test"
        test_file.write_text("ok", encoding="utf-8")
        test_file.unlink(missing_ok=True)
        return candidate
    except (OSError, PermissionError):
        app_data = Path(os.environ.get("LOCALAPPDATA") or Path.home())
        fallback = app_data / "DCom JPG PACS" / "logs"
        fallback.mkdir(parents=True, exist_ok=True)
        return fallback


class StdioTee(io.TextIOBase):
    """Tee a text stream (stdout or stderr) to both the original stream and a log file."""

    def __init__(self, original_stream: Any, logger_write_fn: Callable[[str], None]) -> None:
        self.original_stream = original_stream
        self.logger_write_fn = logger_write_fn
        self._lock = threading.Lock()

    def write(self, s: str) -> int:
        with self._lock:
            if self.original_stream:
                try:
                    self.original_stream.write(s)
                except Exception:
                    pass
            if s and not s.isspace():
                # Avoid timestamping every tiny trailing newline; let line-buffering handle it
                for line in s.splitlines():
                    cleaned = line.strip("\r")
                    if cleaned:
                        self.logger_write_fn(cleaned)
            return len(s)

    def flush(self) -> None:
        with self._lock:
            if self.original_stream:
                try:
                    self.original_stream.flush()
                except Exception:
                    pass

    @property
    def encoding(self) -> str:
        return getattr(self.original_stream, "encoding", "utf-8")


class SessionLogger:
    """Thread-safe session logger writing to an isolated log file per app run."""

    _instance: Optional[SessionLogger] = None
    _init_lock = threading.Lock()

    def __init__(
        self,
        logs_dir: Optional[Path | str] = None,
        log_dir: Optional[Path | str] = None,
        max_retained_logs: int = 30,
        max_age_days: int = 14,
        max_history: Optional[int] = None,
        retention_days: Optional[int] = None,
        prefix: str = "app_",
    ) -> None:
        target_dir = logs_dir or log_dir
        self.logs_dir = Path(target_dir).resolve() if target_dir else get_logs_dir()
        self.max_retained_logs = max_history if max_history is not None else max_retained_logs
        self.max_age_days = retention_days if retention_days is not None else max_age_days
        self.prefix = prefix
        self._lock = threading.Lock()
        self._stdio_installed = False

        self.session_timestamp = datetime.datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
        self.log_file = self.logs_dir / f"{self.prefix}{self.session_timestamp}.log"
        self._file_handle: Optional[io.TextIOWrapper] = None

        self._init_log_file()
        self._cleanup_old_logs()

    @property
    def log_dir(self) -> Path:
        return self.logs_dir

    def init_session(self) -> None:
        """Explicit initialize session log file if not already opened."""
        with self._lock:
            if not self._file_handle or self._file_handle.closed:
                self._init_log_file()

    @classmethod
    def get_instance(cls) -> SessionLogger:
        if cls._instance is None:
            with cls._init_lock:
                if cls._instance is None:
                    cls._instance = cls()
        return cls._instance

    def _init_log_file(self) -> None:
        try:
            self.logs_dir.mkdir(parents=True, exist_ok=True)
            self._file_handle = open(self.log_file, "a", encoding="utf-8", buffering=1)
            now_iso = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            is_frozen = getattr(sys, "frozen", False)
            header = [
                "=" * 80,
                f"DCom JPG PACS v1.1 — PHIÊN KHỞI ĐỘNG: {now_iso}",
                f"OS: {platform.system()} {platform.release()} (Architecture: {platform.machine()})",
                f"Python: {platform.python_version()} | Chế độ: {'PyInstaller EXE (Frozen)' if is_frozen else 'Python Script'}",
                f"Đường dẫn app: {get_app_root()}",
                f"File log: {self.log_file}",
                "=" * 80,
                "",
            ]
            self._file_handle.write("\n".join(header) + "\n")
            self._file_handle.flush()
        except Exception as exc:
            sys.stderr.write(f"Không thể khởi tạo file log tại {self.log_file}: {exc}\n")

    def _cleanup_old_logs(self) -> None:
        """Purge logs older than max_age_days or exceeding max_retained_logs."""
        try:
            pattern = f"{self.prefix}*.log" if self.prefix else "*.log"
            log_files = sorted(
                self.logs_dir.glob(pattern),
                key=lambda p: p.stat().st_mtime,
                reverse=True,
            )
            now = datetime.datetime.now().timestamp()
            cutoff_seconds = self.max_age_days * 86400

            for idx, p in enumerate(log_files):
                if p.resolve() == self.log_file.resolve():
                    continue
                file_age = now - p.stat().st_mtime
                if idx >= self.max_retained_logs or file_age > cutoff_seconds:
                    try:
                        p.unlink(missing_ok=True)
                    except Exception:
                        pass
        except Exception:
            pass

    def log(self, level: str, message: str, source: str = "APP") -> None:
        """Write a formatted message with timestamp, level, and source tag."""
        timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]
        formatted = f"[{timestamp}] [{level.upper():<5}] [{source}] {message}"
        with self._lock:
            if self._file_handle and not self._file_handle.closed:
                try:
                    self._file_handle.write(formatted + "\n")
                    if level.upper() in ("WARN", "WARNING", "ERROR", "CRITICAL"):
                        self._file_handle.flush()
                except Exception:
                    pass

    def info(self, message: str, source: str = "APP") -> None:
        self.log("INFO", message, source)

    def warning(self, message: str, source: str = "APP") -> None:
        self.log("WARN", message, source)

    def error(
        self,
        message: str,
        exc: Optional[BaseException] = None,
        exc_info: bool = False,
        source: str = "APP",
    ) -> None:
        msg = str(message)
        if exc is not None:
            tb = "".join(traceback.format_exception(type(exc), exc, exc.__traceback__))
            msg = f"{msg}\nException: {exc}\n{tb}".strip()
        elif exc_info:
            cur_exc = sys.exc_info()
            if cur_exc[0] is not None:
                tb = "".join(traceback.format_exception(*cur_exc))
                msg = f"{msg}\n{tb}".strip()
        self.log("ERROR", msg, source)

    def debug(self, message: str, source: str = "APP") -> None:
        self.log("DEBUG", message, source)

    def job_event(self, job_kind: str, message: str, **meta: Any) -> None:
        """Log a dedicated structured download/processing job message."""
        meta_str = f" | {meta}" if meta else ""
        self.log("INFO", f"[{job_kind.upper()}] {message}{meta_str}", source="JOB")

    def download_summary(
        self,
        study_uid: str,
        patient_id: str,
        expected: int,
        dicom_count: int,
        jpg_count: int,
        status: str,
        failed_count: int = 0,
        details: str = "",
    ) -> None:
        """Record diagnostic download summary."""
        msg = (
            f"DOWNLOAD SUMMARY: PatientID={patient_id or '?'} | StudyUID={study_uid or '?'} | "
            f"Status={status} | DICOM={dicom_count}/{expected or '?'} | JPG={jpg_count} | "
            f"Failed={failed_count} | Details={details}"
        )
        level = "ERROR" if status == "failed" else ("WARN" if status in ("partial", "partial_unknown") else "INFO")
        self.log(level, msg, source="DOWNLOAD")

    def list_recent_logs(self, limit: int = 10) -> list[Path]:
        """Return list of recent log files sorted newest first."""
        try:
            pattern = f"{self.prefix}*.log" if self.prefix else "*.log"
            files = sorted(
                self.logs_dir.glob(pattern),
                key=lambda p: p.stat().st_mtime,
                reverse=True,
            )
            return files[:limit]
        except Exception:
            return []

    def install_stdio_tee(self) -> None:
        """Tee sys.stdout and sys.stderr into this session logger."""
        with self._lock:
            if self._stdio_installed:
                return
            sys.stdout = StdioTee(sys.stdout, lambda s: self.log("INFO", s.rstrip("\r\n"), source="STDOUT"))  # type: ignore
            sys.stderr = StdioTee(sys.stderr, lambda s: self.log("ERROR", s.rstrip("\r\n"), source="STDERR"))  # type: ignore
            self._stdio_installed = True

    def close(self) -> None:
        with self._lock:
            if self._file_handle and not self._file_handle.closed:
                try:
                    now_iso = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                    self._file_handle.write(f"\n[{now_iso}] [INFO ] [APP] Phiên chạy kết thúc.\n")
                    self._file_handle.flush()
                    self._file_handle.close()
                except Exception:
                    pass


def get_logger() -> SessionLogger:
    """Convenience accessor for the application session logger."""
    return SessionLogger.get_instance()


def init_app_logging(
    tee_stdio: bool = True,
    logs_dir: Optional[Path | str] = None,
    log_dir: Optional[Path | str] = None,
) -> SessionLogger:
    """Initialize session logging and optionally tee stdio."""
    target_dir = logs_dir or log_dir
    if target_dir is not None or SessionLogger._instance is None:
        with SessionLogger._init_lock:
            if target_dir is not None or SessionLogger._instance is None:
                SessionLogger._instance = SessionLogger(logs_dir=target_dir)
    logger = SessionLogger.get_instance()
    if tee_stdio:
        logger.install_stdio_tee()
    return logger

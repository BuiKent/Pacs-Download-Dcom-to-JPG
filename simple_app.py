"""
simple_app.py
=============
Entry point for the simplified DICOM Download & Viewer app.
Opens a WebView2 window pointing to the local HTTP server.
"""

from __future__ import annotations

import argparse
import ctypes
import re
import sys
import threading
import time
from ctypes import wintypes
from pathlib import Path

from simple_backend import SimpleApiServer, SimpleController


def resource_path(relative: str) -> Path:
    base = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))
    return base / relative


# ── Clipboard helper ─────────────────────────────────────────────────────────

CF_UNICODETEXT = 13
CLIPBOARD_TEXT_LIMIT = 4096


def _clipboard_text() -> str:
    if not sys.platform.startswith("win"):
        return ""
    try:
        user32 = ctypes.WinDLL("user32", use_last_error=True)
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    except (OSError, AttributeError):
        return ""
    user32.IsClipboardFormatAvailable.argtypes = [wintypes.UINT]
    user32.OpenClipboard.argtypes = [wintypes.HWND]
    user32.GetClipboardData.argtypes = [wintypes.UINT]
    user32.GetClipboardData.restype = wintypes.HANDLE
    kernel32.GlobalLock.argtypes = [wintypes.HGLOBAL]
    kernel32.GlobalLock.restype = wintypes.LPVOID
    kernel32.GlobalUnlock.argtypes = [wintypes.HGLOBAL]
    if not user32.IsClipboardFormatAvailable(CF_UNICODETEXT):
        return ""
    if not user32.OpenClipboard(None):
        return ""
    try:
        handle = user32.GetClipboardData(CF_UNICODETEXT)
        if not handle:
            return ""
        pointer = kernel32.GlobalLock(handle)
        if not pointer:
            return ""
        try:
            value = ctypes.c_wchar_p(pointer).value or ""
        finally:
            kernel32.GlobalUnlock(handle)
    except OSError:
        return ""
    finally:
        user32.CloseClipboard()
    return value.strip()[:CLIPBOARD_TEXT_LIMIT]


# ── Native API (exposed to WebView2 JS) ─────────────────────────────────────

class NativeApi:
    def __init__(self, controller: SimpleController):
        self._controller = controller
        self._window = None

    def choose_folder(self):
        import webview
        result = self._window.create_file_dialog(webview.FOLDER_DIALOG)
        if not result:
            return None
        path = result[0] if isinstance(result, (list, tuple)) else result
        return self._controller.start_viewer_open(str(path))

    def choose_output(self):
        import webview
        result = self._window.create_file_dialog(webview.FOLDER_DIALOG)
        if not result:
            return None
        path = result[0] if isinstance(result, (list, tuple)) else result
        return self._controller.set_output_root(str(path))

    def read_clipboard(self):
        text = _clipboard_text()
        return {
            "url": text if text.casefold().startswith(("http://", "https://", "www.")) else "",
        }

    def open_in_explorer(self, path: str):
        import os
        target = Path(path).expanduser().resolve(strict=True)
        if not target.is_dir():
            raise ValueError("Chỉ mở thư mục.")
        os.startfile(str(target))
        return True


# ── Launch ───────────────────────────────────────────────────────────────────

def main() -> None:
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--debug-web", action="store_true")
    args, _ = parser.parse_known_args()

    import webview

    static_dir = resource_path("simple_web")
    if not (static_dir / "index.html").is_file():
        print(f"Lỗi: Thiếu {static_dir / 'index.html'}")
        sys.exit(1)

    controller = SimpleController()
    server = SimpleApiServer(controller, static_dir)
    url = server.start()

    native_api = NativeApi(controller)
    window = webview.create_window(
        "DICOM Download & Viewer",
        url=url,
        js_api=native_api,
        width=1400,
        height=900,
        min_size=(1000, 650),
        minimized=False,
        background_color="#060a10",
    )
    native_api._window = window

    closed_event = threading.Event()
    window.events.closed += lambda: closed_event.set()

    def keep_alive():
        while not closed_event.is_set():
            time.sleep(0.25)

    try:
        webview.start(
            keep_alive,
            gui="edgechromium",
            debug=args.debug_web,
            private_mode=True,
        )
    finally:
        controller.job.stop_event.set()
        server.stop()


if __name__ == "__main__":
    main()

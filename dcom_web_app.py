"""WebView2 entry point for DCom JPG PACS v1.1.

Use ``--classic`` to launch the retained Tk viewer.  If WebView2 cannot start,
the application falls back to the classic UI automatically.
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

from web_backend import LocalApiServer, WebController


def resource_path(relative: str) -> Path:
    base = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))
    return base / relative


def launch_classic() -> None:
    import dcom_downloader_app

    dcom_downloader_app.main()


class NativeApi:
    def __init__(self, controller: WebController):
        self.controller = controller
        self.window = None

    def choose_archive(self):
        import webview

        result = self.window.create_file_dialog(webview.FOLDER_DIALOG)
        if not result:
            return None
        path = result[0] if isinstance(result, (list, tuple)) else result
        return self.controller.open_archive(str(path))

    def choose_output(self):
        import webview

        result = self.window.create_file_dialog(webview.FOLDER_DIALOG)
        if not result:
            return None
        path = result[0] if isinstance(result, (list, tuple)) else result
        return self.controller.set_output_root(str(path))

    def open_in_explorer(self, path: str):
        target = Path(path).expanduser().resolve(strict=True)
        if not target.is_dir():
            raise ValueError("Chỉ mở thư mục.")
        os.startfile(str(target))  # type: ignore[attr-defined]
        return True


def launch_web(debug: bool = False) -> None:
    import webview

    static_dir = resource_path("web_dist")
    if not (static_dir / "index.html").is_file():
        raise RuntimeError("Thiếu web_dist/index.html. Hãy build frontend trước.")

    controller = WebController()
    server = LocalApiServer(controller, static_dir)
    url = server.start()
    native_api = NativeApi(controller)
    window = webview.create_window(
        "DCom JPG PACS",
        url=url,
        js_api=native_api,
        width=1500,
        height=940,
        min_size=(1100, 700),
        background_color="#060a10",
    )
    native_api.window = window
    try:
        webview.start(gui="edgechromium", debug=debug, private_mode=True)
    finally:
        controller.job.stop_event.set()
        server.stop()


def main() -> None:
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--classic", action="store_true")
    parser.add_argument("--debug-web", action="store_true")
    args, _ = parser.parse_known_args()
    if args.classic:
        launch_classic()
        return
    try:
        launch_web(debug=args.debug_web)
    except Exception as exc:
        if args.debug_web:
            raise
        print(f"WebView2 không khởi động được, chuyển sang giao diện classic: {exc}")
        launch_classic()


if __name__ == "__main__":
    main()

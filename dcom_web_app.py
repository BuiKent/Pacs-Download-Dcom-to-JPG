"""WebView2 entry point for DCom JPG PACS v1.1.

Use ``--classic`` to launch the retained Tk viewer.  If WebView2 cannot start,
the application falls back to the classic UI automatically.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import threading
import time
from pathlib import Path

from web_backend import LocalApiServer, WebController


def resource_path(relative: str) -> Path:
    base = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))
    return base / relative


def _write_smoke_stage(path: str, result: dict, stage: str) -> None:
    if not path:
        return
    result["stage"] = stage
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")


def launch_classic() -> None:
    import dcom_downloader_app

    dcom_downloader_app.main()


class NativeApi:
    def __init__(self, controller: WebController):
        # pywebview exposes public attributes of js_api recursively. Keeping
        # the controller/window public makes it inspect the whole native
        # WinForms/Accessibility graph and can freeze startup.
        self._controller = controller
        self._window = None

    def choose_archive(self):
        import webview

        result = self._window.create_file_dialog(webview.FOLDER_DIALOG)
        if not result:
            return None
        path = result[0] if isinstance(result, (list, tuple)) else result
        return self._controller.open_archive(str(path))

    def choose_output(self):
        import webview

        result = self._window.create_file_dialog(webview.FOLDER_DIALOG)
        if not result:
            return None
        path = result[0] if isinstance(result, (list, tuple)) else result
        return self._controller.set_output_root(str(path))

    def open_in_explorer(self, path: str):
        target = Path(path).expanduser().resolve(strict=True)
        if not target.is_dir():
            raise ValueError("Chỉ mở thư mục.")
        os.startfile(str(target))  # type: ignore[attr-defined]
        return True

    def restart_classic(self):
        command = [sys.executable, "--classic"] if getattr(sys, "frozen", False) else [
            sys.executable,
            str(Path(__file__).resolve()),
            "--classic",
        ]
        subprocess.Popen(command, close_fds=True)
        self._window.destroy()
        return True


def _run_smoke(window, result: dict, result_path: str) -> None:
    try:
        _write_smoke_stage(result_path, result, "callback-started")
        # Let the local HTTP thread serve the initial HTML/assets before any
        # evaluate_js call. A blocking Event.wait here can starve that thread
        # in some Python.NET/WebView2 combinations.
        time.sleep(3)
        _write_smoke_stage(result_path, result, "page-loaded")
        # The DOM load event precedes the asynchronous /api/bootstrap request.
        # Release the GIL so the embedded server can complete that request
        # before the first evaluate_js call.
        time.sleep(15)
        deadline = time.time() + 45
        while time.time() < deadline:
            state = window.evaluate_js(
                """({
                  fatal: document.querySelector('.fatal-error')?.textContent || '',
                  series: document.querySelectorAll('.series-card').length,
                  canvases: document.querySelectorAll('#workspace canvas').length
                })"""
            )
            if state.get("fatal"):
                raise RuntimeError(state["fatal"])
            if state.get("series", 0) >= 1 and state.get("canvases", 0) >= 1:
                result["single"] = state
                break
            time.sleep(0.5)
        else:
            raise TimeoutError(f"Không dựng được stack: {state}")

        for action, expected, key in (
            ("mode-compare", 2, "compare"),
            ("mode-montage6", 6, "montage6"),
            ("mode-montage8", 8, "montage8"),
            ("mode-mpr", 3, "mpr"),
            ("mode-volume3d", 1, "volume3d"),
        ):
            window.evaluate_js(f'document.querySelector(\'[data-action="{action}"]\').click()')
            deadline = time.time() + 60
            while time.time() < deadline:
                state = window.evaluate_js(
                    """({
                      canvases: document.querySelectorAll('#workspace canvas').length,
                      labels: [...document.querySelectorAll('.viewport-label')].map(e => e.textContent),
                      error: document.querySelector('.empty-state.error')?.textContent || '',
                      errorStack: window.__lastViewerError?.stack || '',
                      readyMode: window.__viewerReadyMode || '',
                      diagnostics: window.__viewerDiagnostics || null,
                      toolLabels: [...document.querySelectorAll('.interaction-tools .icon-button small')]
                        .map(e => e.textContent)
                    })"""
                )
                if state.get("error"):
                    raise RuntimeError(state.get("errorStack") or state["error"])
                if state.get("canvases") == expected and state.get("readyMode") == action.removeprefix("mode-"):
                    result[key] = state
                    _write_smoke_stage(result_path, result, key)
                    break
                time.sleep(0.5)
            else:
                raise TimeoutError(f"Không dựng được {key}: {state}")
        if len(result["mpr"].get("toolLabels", [])) != 8:
            raise RuntimeError(f"MPR contextual toolbar is incomplete: {result['mpr']}")
        if len(result["volume3d"].get("toolLabels", [])) != 3:
            raise RuntimeError(f"3D contextual toolbar is incomplete: {result['volume3d']}")

        # Regression gate for the real-world failure where repeated MPR/3D
        # switches left only the crosshair overlay on a blank WebGL viewport.
        result["volumeTransitions"] = []
        for action, expected, key in (
            ("mode-mpr", 3, "mpr-again"),
            ("mode-volume3d", 1, "volume3d-again"),
            ("mode-mpr", 3, "mpr-third"),
        ):
            window.evaluate_js(f'document.querySelector(\'[data-action="{action}"]\').click()')
            deadline = time.time() + 60
            while time.time() < deadline:
                state = window.evaluate_js(
                    """({
                      canvases: document.querySelectorAll('#workspace canvas').length,
                      error: document.querySelector('.empty-state.error')?.textContent || '',
                      errorStack: window.__lastViewerError?.stack || '',
                      readyMode: window.__viewerReadyMode || '',
                      loading: document.querySelector('#workspace')?.classList.contains('busy') || false,
                      diagnostics: window.__viewerDiagnostics || null
                    })"""
                )
                if state.get("error"):
                    raise RuntimeError(state.get("errorStack") or state["error"])
                diagnostics = state.get("diagnostics") or {}
                actors = [item.get("actors", 0) for item in diagnostics.get("viewports", [])]
                ready = (
                    state.get("canvases") == expected
                    and state.get("readyMode") == action.removeprefix("mode-")
                    and diagnostics.get("destroyed") is False
                    and len(actors) == expected
                    and all(count >= 1 for count in actors)
                    and not state.get("loading")
                )
                if ready:
                    result["volumeTransitions"].append({"key": key, **state})
                    _write_smoke_stage(result_path, result, key)
                    break
                time.sleep(0.5)
            else:
                raise TimeoutError(f"Repeated MPR/3D transition failed at {key}: {state}")

        window.evaluate_js(
            """(() => {
              const select = document.querySelector('[data-field="mpr-primary"]');
              select.value = 'sagittal';
              select.dispatchEvent(new Event('change', { bubbles: true }));
            })()"""
        )
        time.sleep(1)
        result["mprPrimarySwitch"] = window.evaluate_js(
            """({
              primary: document.querySelector('.mode-mpr .mpr-primary')?.dataset.plane || '',
              primaryWidth: document.querySelector('.mode-mpr .mpr-primary')?.getBoundingClientRect().width || 0,
              secondaryWidth: document.querySelector('.mode-mpr .mpr-secondary-top')?.getBoundingClientRect().width || 0,
              actors: (window.__viewerDiagnostics?.viewports || []).map(item => item.actors)
            })"""
        )
        if (
            result["mprPrimarySwitch"].get("primary") != "sagittal"
            or result["mprPrimarySwitch"].get("primaryWidth", 0)
            <= result["mprPrimarySwitch"].get("secondaryWidth", 0)
            or not all(count >= 1 for count in result["mprPrimarySwitch"].get("actors", []))
        ):
            raise RuntimeError(f"MPR primary-plane switch failed: {result['mprPrimarySwitch']}")
    except Exception as exc:
        result["error"] = str(exc)
    finally:
        if result_path:
            _write_smoke_stage(result_path, result, "complete" if not result.get("error") else "error")
        window.destroy()


def launch_web(
    debug: bool = False,
    archive: str = "",
    smoke_test: bool = False,
    smoke_result: str = "",
) -> None:
    import webview

    static_dir = resource_path("web_dist")
    if not (static_dir / "index.html").is_file():
        raise RuntimeError("Thiếu web_dist/index.html. Hãy build frontend trước.")

    controller = WebController()
    result: dict = {}
    _write_smoke_stage(smoke_result, result, "launch-started")
    if archive:
        controller.open_archive(archive)
    _write_smoke_stage(smoke_result, result, "archive-opened")
    server = LocalApiServer(controller, static_dir)
    url = server.start()
    _write_smoke_stage(smoke_result, result, "server-started")
    native_api = NativeApi(controller)
    window = webview.create_window(
        "DCom JPG PACS",
        url=url,
        js_api=native_api,
        width=1500,
        height=940,
        min_size=(1100, 700),
        # WebView2 can defer navigation for a minimized top-level window on
        # some Windows builds. The smoke gate must exercise the same visible
        # window lifecycle as the real application.
        minimized=False,
        background_color="#060a10",
    )
    native_api._window = window
    _write_smoke_stage(smoke_result, result, "window-created")
    closed_event = threading.Event()
    window.events.closed += lambda: closed_event.set()

    def keep_backend_responsive() -> None:
        while not closed_event.is_set():
            time.sleep(0.25)

    try:
        webview.start(
            _run_smoke if smoke_test else keep_backend_responsive,
            (window, result, smoke_result) if smoke_test else None,
            gui="edgechromium",
            debug=debug,
            private_mode=True,
        )
    finally:
        controller.job.stop_event.set()
        server.stop()
    if result.get("error"):
        raise RuntimeError(result["error"])


def main() -> None:
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--classic", action="store_true")
    parser.add_argument("--debug-web", action="store_true")
    parser.add_argument("--archive", default="")
    parser.add_argument("--smoke-test", action="store_true")
    parser.add_argument("--smoke-result", default="")
    args, _ = parser.parse_known_args()
    if args.classic:
        launch_classic()
        return
    try:
        launch_web(
            debug=args.debug_web,
            archive=args.archive,
            smoke_test=args.smoke_test,
            smoke_result=args.smoke_result,
        )
    except Exception as exc:
        if args.debug_web or args.smoke_test:
            raise
        print(f"WebView2 không khởi động được, chuyển sang giao diện classic: {exc}")
        launch_classic()


if __name__ == "__main__":
    main()

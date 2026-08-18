"""WebView2 entry point for DCom JPG PACS v1.1.

The WebView2 UI is the only interface users can choose.  The retained Tk viewer
is kept solely as an emergency net: if WebView2 cannot start at all — a hospital
workstation missing the runtime, say — ``launch_classic()`` runs so the machine
still has a usable viewer instead of an app that refuses to open.
"""

from __future__ import annotations

import argparse
import ctypes
import json
import os
import re
import sys
import threading
import time
from ctypes import wintypes
from pathlib import Path

from web_backend import LocalApiServer, WebController


def resource_path(relative: str) -> Path:
    base = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))
    return base / relative


CF_UNICODETEXT = 13
CLIPBOARD_TEXT_LIMIT = 4096


def _clipboard_text() -> str:
    """Read the Windows clipboard as text, or "" when it holds none.

    Another process can hold the clipboard open; that is an ordinary race for a
    convenience feature, so every failure degrades to an empty string rather
    than surfacing as an error in the page.
    """
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


# A viewport can hold a live actor, report itself rendered and still show a
# black canvas when the browser refuses another WebGL context. Structural checks
# cannot see that, so every gate below also samples real pixels.
PIXEL_PROBE = """(() => {
  const canvases = [...document.querySelectorAll('#workspace canvas')];
  return canvases.map((canvas) => {
    try {
      const sample = document.createElement('canvas');
      sample.width = Math.max(1, Math.min(96, canvas.width));
      sample.height = Math.max(1, Math.min(96, canvas.height));
      const context = sample.getContext('2d');
      context.drawImage(canvas, 0, 0, sample.width, sample.height);
      const data = context.getImageData(0, 0, sample.width, sample.height).data;
      let lit = 0;
      for (let index = 0; index < data.length; index += 4) {
        if (data[index] > 12 || data[index + 1] > 12 || data[index + 2] > 12) lit += 1;
      }
      return lit;
    } catch (error) {
      return -1;
    }
  });
})()"""

# Only the 3D volume-rendered pane may legitimately be sparse at the default
# camera; an orthographic MPR pane through the middle of a head never is.
MIN_LIT_PIXELS = 40


def _assert_panes_drawn(window, label: str, expected: int) -> list[int]:
    """Fail when a viewport reports success but paints nothing."""
    lit = window.evaluate_js(PIXEL_PROBE) or []
    if len(lit) != expected:
        raise RuntimeError(f"{label}: cần {expected} khung, thấy {len(lit)} ({lit})")
    blank = [index for index, count in enumerate(lit) if count < MIN_LIT_PIXELS]
    if blank:
        raise RuntimeError(f"{label}: khung {blank} không vẽ được pixel nào (lit={lit})")
    return lit


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

    def _safe_folder_dialog(self) -> str:
        import webview

        dialog_type = getattr(webview.FileDialog, "FOLDER", getattr(webview, "FOLDER_DIALOG", 20))
        directory = str(self._controller.output_root if self._controller.output_root.is_dir() else Path.home())
        try:
            result = self._window.create_file_dialog(dialog_type, directory=directory)
            if not result:
                return ""
            path = result[0] if isinstance(result, (list, tuple)) else result
            return str(path or "")
        except Exception:
            return ""

    def _safe_file_dialog(self, file_types: tuple[str, ...] = ()) -> str:
        import webview

        dialog_type = getattr(webview.FileDialog, "OPEN", getattr(webview, "OPEN_DIALOG", 10))
        directory = str(self._controller.output_root if self._controller.output_root.is_dir() else Path.home())
        types = file_types or (
            "Medical files & Images (*.dcm;*.dicom;*.ima;*.jpg;*.jpeg;*.png;*.webp;*.bmp;*.*)",
            "DICOM Files (*.dcm;*.dicom;*.ima)",
            "Image Files (*.jpg;*.jpeg;*.png;*.webp;*.bmp)",
            "All Files (*.*)",
        )
        try:
            result = self._window.create_file_dialog(
                dialog_type,
                directory=directory,
                file_types=types,
            )
            if not result:
                return ""
            path = result[0] if isinstance(result, (list, tuple)) else result
            return str(path or "")
        except Exception:
            return ""

    def choose_file(self):
        path = self._safe_file_dialog()
        if not path:
            return None
        return self._controller.open_archive(path)

    def choose_archive(self):
        path = self._safe_folder_dialog()
        if not path:
            return None
        return self._controller.start_archive_scan(path)

    def choose_dicom_folder(self, options=None):
        path = self._safe_folder_dialog()
        if not path:
            return None
        return self._controller.start_local_dicom_import(
            path, options if isinstance(options, dict) else {},
        )

    def choose_output(self):
        path = self._safe_folder_dialog()
        if not path:
            return None
        return self._controller.set_output_root(path)

    def read_clipboard(self):
        """Report clipboard text that matches a viewer link or a patient code.

        WebView2 refuses ``navigator.clipboard.readText()`` without a user
        gesture, so the classic app's auto-paste convenience reads the Windows
        clipboard natively. Only the two recognised shapes are returned, so
        unrelated clipboard content never reaches the page.
        """
        text = _clipboard_text()
        return {
            "url": text if text.casefold().startswith(("http://", "https://", "www.")) else "",
            "patientId": text if re.fullmatch(r"[A-Za-z0-9]{1,64}", text) else "",
        }

    def open_in_explorer(self, path: str):
        target = Path(path).expanduser().resolve(strict=True)
        if not target.is_dir():
            raise ValueError("Chỉ mở thư mục.")
        os.startfile(str(target))  # type: ignore[attr-defined]
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
                  canvases: document.querySelectorAll('#workspace canvas').length,
                  locationSearch: location.search,
                  diagnostics: window.__viewerDiagnostics || null,
                  worklistTab: Boolean(document.querySelector(
                    '.winbar-tab[data-tab-id="worklist"]'
                  )),
                  activeTabId: document.querySelector('.winbar-tab.active')
                    ?.dataset.tabId || '',
                  downloadPanelVisible: Boolean(document.querySelector('.download-panel')),
                  panelToggle: Boolean(document.querySelector(
                    '.app-header [data-action="toggle-download"][aria-expanded]'
                  )),
                  timelineRows: document.querySelectorAll('.tl-item').length,
                  timelineCounts: [...document.querySelectorAll('.tl-item .ct')]
                    .map(item => item.textContent.trim()),
                  timelineEditButtons: document.querySelectorAll(
                    '.tl-item [data-action="edit-timeline-label"]'
                  ).length,
                  timelineInputs: document.querySelectorAll('.tl-item .tl-name-input').length
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
        if "token=" in result["single"].get("locationSearch", ""):
            raise RuntimeError("Token phiên vẫn còn trong URL sau khi khởi động.")
        if not result["single"].get("worklistTab"):
            raise RuntimeError("Thiếu tab Worklist trong thanh tab chính.")
        if result["single"].get("activeTabId") == "worklist":
            raise RuntimeError("Viewer không giữ tab hồ sơ làm tab đang hoạt động.")
        if result["single"].get("downloadPanelVisible") or result["single"].get("panelToggle"):
            raise RuntimeError("Khu Download vẫn xuất hiện bên trong tab Viewer.")
        timeline_rows = result["single"].get("timelineRows", 0)
        if (
            timeline_rows < 1
            or timeline_rows > result["single"].get("series", 0)
            or result["single"].get("timelineEditButtons") != timeline_rows
            or result["single"].get("timelineInputs") != timeline_rows
        ):
            raise RuntimeError(f"Study-level timeline/editor contract failed: {result['single']}")
        result["single"]["litPixels"] = _assert_panes_drawn(window, "single", 1)

        # A patient archive may start with a scout, ultrasound or radiograph.
        # Select an actual volume before exercising montage/MPR/3D rather than
        # clicking disabled controls and timing out on the previous layout.
        result["mprSeries"] = window.evaluate_js(
            """(() => {
              const card = [...document.querySelectorAll('.series-card')]
                .find(item => item.querySelector('.badge-3d'));
              if (!card) return null;
              const sliceCount = Number(card.querySelector('.series-thumb-count')?.textContent || 0);
              card.click();
              return { id: card.dataset.seriesId || '', sliceCount };
            })()"""
        )
        if not result["mprSeries"] or result["mprSeries"].get("sliceCount", 0) < 12:
            raise RuntimeError(f"Archive không có volume đủ lát cho release smoke: {result['mprSeries']}")
        deadline = time.time() + 60
        while time.time() < deadline:
            selected = window.evaluate_js(
                """({
                  id: document.querySelector('.series-card.active')?.dataset.seriesId || '',
                  readyMode: window.__viewerReadyMode || '',
                  error: document.querySelector('.empty-state.error')?.textContent || ''
                })"""
            )
            if selected.get("error"):
                raise RuntimeError(selected["error"])
            if (
                selected.get("id") == result["mprSeries"].get("id")
                and selected.get("readyMode") == "single"
            ):
                break
            time.sleep(0.5)
        else:
            raise TimeoutError(f"Không chọn được volume cho smoke: {selected}")

        for action, expected, key in (
            ("mode-compare", 2, "compare"),
            ("mode-montage6", 6, "montage6"),
            ("mode-montage8", 8, "montage8"),
            ("mode-mpr", 3, "mpr"),
            ("mode-volume3d", 4, "volume3d"),
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
                      volumeLoad: window.__volumeLoadState || null,
                      sliceControls: document.querySelectorAll('.slice-control input').length,
                      toolLabels: [...document.querySelectorAll(
                        '.toolbar .icon-button[data-action^="tool-"]'
                      )]
                        .map(e => e.getAttribute('aria-label') || '')
                    })"""
                )
                if state.get("error"):
                    raise RuntimeError(state.get("errorStack") or state["error"])
                if state.get("canvases") == expected and state.get("readyMode") == action.removeprefix("mode-"):
                    state["litPixels"] = _assert_panes_drawn(window, key, expected)
                    result[key] = state
                    _write_smoke_stage(result_path, result, key)
                    break
                time.sleep(0.5)
            else:
                raise TimeoutError(f"Không dựng được {key}: {state}")
        for key, expected_controls in (
            ("compare", 2),
            ("montage6", 6),
            ("montage8", 8),
            ("mpr", 3),
            ("volume3d", 3),
        ):
            if result[key].get("sliceControls") != expected_controls:
                raise RuntimeError(
                    f"{key} slice controls mismatch: {result[key].get('sliceControls')}"
                )
        diagnostics = result["mpr"].get("diagnostics", {})
        decode_path = diagnostics.get("decodePath", "")
        valid_decode = (
            decode_path in {"dicom-direct", "dicom-color"}
            if diagnostics.get("sourceType") == "dicom"
            else decode_path == "worker"
        )
        if not valid_decode:
            raise RuntimeError(f"Unexpected decode path: {result['mpr']}")
        # MPR: crosshair, window, pan, zoom + length, angle, ellipse, freehand, text.
        if len(result["mpr"].get("toolLabels", [])) != 9:
            raise RuntimeError(f"MPR contextual toolbar is incomplete: {result['mpr']}")
        # 3D: orbit, crosshair, pan, zoom. Measurement tools cannot act on a
        # volume render, so they are absent by design.
        if len(result["volume3d"].get("toolLabels", [])) != 4:
            raise RuntimeError(f"3D contextual toolbar is incomplete: {result['volume3d']}")
        for key, count in (("montage6", 6), ("montage8", 8)):
            indices = [
                item.get("imageIndex")
                for item in result[key].get("diagnostics", {}).get("viewports", [])
            ]
            if indices != list(range(count)):
                raise RuntimeError(f"{key} panes are not consecutive: {indices}")
        window.evaluate_js(
            "document.querySelector('[data-action=\"mode-montage6\"]')?.click()"
        )
        deadline = time.time() + 60
        while time.time() < deadline:
            montage_ready = window.evaluate_js(
                """({
                  readyMode: window.__viewerReadyMode || '',
                  slider: Boolean(document.querySelector(
                    '[data-viewport-id="stack-2"] .slice-control input'
                  ))
                })"""
            )
            if montage_ready.get("readyMode") == "montage6" and montage_ready.get("slider"):
                break
            time.sleep(0.25)
        else:
            raise TimeoutError(f"Montage controls did not become ready: {montage_ready}")
        window.evaluate_js(
            """(() => {
              const slider = document.querySelector(
                '[data-viewport-id="stack-2"] .slice-control input'
              );
              slider.value = String(Number(slider.value) + 1);
              slider.dispatchEvent(new Event('input', { bubbles: true }));
            })()"""
        )
        time.sleep(1)
        result["montageScroll"] = window.evaluate_js(
            """({
              readyMode: window.__viewerReadyMode || '',
              indices: (window.__viewerDiagnostics?.viewports || [])
                .map(item => item.imageIndex),
              sliders: [...document.querySelectorAll('.slice-control input')]
                .map(item => Number(item.value))
            })"""
        )
        # The source pane moves from index 2 to 3 through its visible slice
        # control. All six panes must advance together and remain consecutive.
        montage_sliders = result["montageScroll"].get("sliders", [])
        expected_indices = list(range(1, 7))
        # __viewerDiagnostics is a layout/action snapshot; the live controls
        # are updated by each viewport's STACK_NEW_IMAGE event.
        if montage_sliders != expected_indices:
            raise RuntimeError(f"Montage slice synchronization failed: {result['montageScroll']}")

        # Regression gate for the real-world failure where repeated MPR/3D
        # switches left only the crosshair overlay on a blank WebGL viewport.
        result["volumeTransitions"] = []
        for action, expected, key in (
            ("mode-mpr", 3, "mpr-again"),
            ("mode-volume3d", 4, "volume3d-again"),
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
                    # The regression this gate exists for: a rebuilt volume
                    # layout that keeps its actors but paints nothing.
                    state["litPixels"] = _assert_panes_drawn(window, key, expected)
                    result["volumeTransitions"].append({"key": key, **state})
                    _write_smoke_stage(result_path, result, key)
                    break
                time.sleep(0.5)
            else:
                raise TimeoutError(f"Repeated MPR/3D transition failed at {key}: {state}")

        # Every layout must reuse the one rendering engine. A new engine per
        # layout exhausts the browser's WebGL context budget and blanks MPR/3D.
        engine_ids = {
            item.get("diagnostics", {}).get("engineId")
            for item in result["volumeTransitions"]
        }
        engine_ids.add(result["mpr"].get("diagnostics", {}).get("engineId"))
        if len(engine_ids) != 1 or not all(engine_ids):
            raise RuntimeError(f"Rendering engine was rebuilt per layout: {sorted(engine_ids)}")

        # The toolbar must never highlight a tool the layout refused to activate.
        tool_state = window.evaluate_js(
            """({
              highlighted: [...document.querySelectorAll(
                '.toolbar .icon-button[data-action^="tool-"].active'
              )]
                .map(item => item.dataset.action.replace('tool-', '')),
              active: window.__viewerDiagnostics?.tool || ''
            })"""
        )
        if tool_state.get("highlighted") != [tool_state.get("active")]:
            raise RuntimeError(f"Toolbar and active tool disagree: {tool_state}")
        result["toolState"] = tool_state

        window.evaluate_js(
            """(() => {
              document.querySelector(
                '.mode-mpr [data-plane="sagittal"] .mpr-swap-button'
              )?.click();
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

        window.evaluate_js(
            """(() => {
              const slider = document.querySelector(
                '[data-viewport-id="mpr-axial"] .slice-control input'
              );
              slider.value = '10';
              slider.dispatchEvent(new Event('input', { bubbles: true }));
            })()"""
        )
        time.sleep(0.5)
        window.evaluate_js("document.querySelector('[data-action=\"reset\"]').click()")
        time.sleep(0.5)
        result["mprReset"] = window.evaluate_js(
            """({
              indices: (window.__viewerDiagnostics?.viewports || [])
                .map(item => item.imageIndex)
            })"""
        )
        initial_mpr_indices = [
            item.get("imageIndex")
            for item in result["mpr"].get("diagnostics", {}).get("viewports", [])
        ]
        if result["mprReset"].get("indices") != initial_mpr_indices:
            raise RuntimeError(f"MPR crosshair reset failed: {result['mprReset']}")

        window.evaluate_js(
            """(() => {
              const select = document.querySelector('[data-field="window-preset"]');
              select.value = 'soft';
              select.dispatchEvent(new Event('change', { bubbles: true }));
            })()"""
        )
        time.sleep(0.5)
        result["windowPreset"] = window.evaluate_js(
            """({
              selected: document.querySelector('[data-field="window-preset"]')?.value || '',
              ranges: (window.__viewerDiagnostics?.viewports || [])
                .map(item => item.voiRange)
            })"""
        )
        ranges = result["windowPreset"].get("ranges", [])
        initial_ranges = result["mpr"].get("diagnostics", {}).get("viewports", [])
        initial_range = initial_ranges[0].get("voiRange") if initial_ranges else None
        first_range = ranges[0] if ranges else None
        initial_width = (
            initial_range.get("upper", 0) - initial_range.get("lower", 0)
            if initial_range else 0
        )
        soft_width = (
            first_range.get("upper", 0) - first_range.get("lower", 0)
            if first_range else 0
        )
        if (
            result["windowPreset"].get("selected") != "soft"
            or len(ranges) != 3
            or not first_range
            or not all(value == first_range for value in ranges)
            or initial_width <= 0
            or not 1.45 <= soft_width / initial_width <= 1.55
        ):
            raise RuntimeError(f"Display preset failed: {result['windowPreset']}")

        # Download belongs to Worklist, not to each patient viewer. Verify the
        # other half of that contract only after all canvas checks are done.
        window.evaluate_js(
            "document.querySelector('.winbar-tab[data-tab-id=\"worklist\"]')?.click()"
        )
        time.sleep(0.5)
        result["worklist"] = window.evaluate_js(
            """({
              activeTabId: document.querySelector('.winbar-tab.active')
                ?.dataset.tabId || '',
              panelToggle: document.querySelector(
                '.app-header [data-action="toggle-download"]'
              )?.getAttribute('aria-expanded') || '',
              downloadPanelVisible: Boolean(document.querySelector('.download-panel'))
            })"""
        )
        if (
            result["worklist"].get("activeTabId") != "worklist"
            or result["worklist"].get("panelToggle") != "true"
            or not result["worklist"].get("downloadPanelVisible")
        ):
            raise RuntimeError(f"Worklist/Download contract failed: {result['worklist']}")
    except Exception as exc:
        result["error"] = str(exc)
    finally:
        if result_path:
            _write_smoke_stage(result_path, result, "complete" if not result.get("error") else "error")
        window.destroy()


class RECT(ctypes.Structure):
    _fields_ = [
        ("left", ctypes.c_long),
        ("top", ctypes.c_long),
        ("right", ctypes.c_long),
        ("bottom", ctypes.c_long),
    ]


class POINT(ctypes.Structure):
    _fields_ = [("x", ctypes.c_long), ("y", ctypes.c_long)]


class WINDOWPLACEMENT(ctypes.Structure):
    _fields_ = [
        ("length", ctypes.c_uint),
        ("flags", ctypes.c_uint),
        ("showCmd", ctypes.c_uint),
        ("ptMinPosition", POINT),
        ("ptMaxPosition", POINT),
        ("rcNormalPosition", RECT),
    ]


def get_window_geometry(window) -> dict | None:
    """Extract current window location, size, and maximized state."""
    try:
        user32 = ctypes.windll.user32
        native = getattr(window, "native", None)
        if native and hasattr(native, "Handle"):
            hwnd = int(native.Handle.ToInt64())
            wp = WINDOWPLACEMENT()
            wp.length = ctypes.sizeof(WINDOWPLACEMENT)
            if user32.GetWindowPlacement(hwnd, ctypes.byref(wp)):
                rect = wp.rcNormalPosition
                is_maximized = bool(user32.IsZoomed(hwnd))
                return {
                    "x": int(rect.left),
                    "y": int(rect.top),
                    "width": max(1100, int(rect.right - rect.left)),
                    "height": max(700, int(rect.bottom - rect.top)),
                    "maximized": is_maximized,
                }
    except Exception:
        pass
    try:
        return {
            "x": int(window.x),
            "y": int(window.y),
            "width": max(1100, int(window.width)),
            "height": max(700, int(window.height)),
            "maximized": False,
        }
    except Exception:
        return None


def resolve_window_parameters(win_config: dict | None) -> dict:
    """Resolve initial window kwargs from saved settings.

    First launch defaults to maximized=True so the viewer occupies full screen.
    Subsequent launches restore the saved position, dimensions, and state.
    """
    if not win_config or not isinstance(win_config, dict):
        return {
            "width": 1500,
            "height": 940,
            "maximized": True,
            "x": None,
            "y": None,
        }

    width = max(1100, int(win_config.get("width", 1500)))
    height = max(700, int(win_config.get("height", 940)))
    maximized = bool(win_config.get("maximized", True))
    x = int(win_config["x"]) if "x" in win_config and isinstance(win_config.get("x"), int) else None
    y = int(win_config["y"]) if "y" in win_config and isinstance(win_config.get("y"), int) else None

    if x is not None and y is not None:
        try:
            pt = POINT(x, y)
            if not ctypes.windll.user32.MonitorFromPoint(pt, 0):
                x, y = None, None
        except Exception:
            x, y = None, None

    kwargs: dict = {
        "width": width,
        "height": height,
        "maximized": maximized,
    }
    if x is not None:
        kwargs["x"] = x
    if y is not None:
        kwargs["y"] = y
    return kwargs


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
    win_kwargs = resolve_window_parameters(controller.window_settings)
    window = webview.create_window(
        "DICOM/JPG Downloader & Viewer",
        url=url,
        js_api=native_api,
        min_size=(1100, 700),
        # WebView2 can defer navigation for a minimized top-level window on
        # some Windows builds. The smoke gate must exercise the same visible
        # window lifecycle as the real application.
        minimized=False,
        background_color="#060a10",
        **win_kwargs,
    )
    native_api._window = window
    _write_smoke_stage(smoke_result, result, "window-created")
    closed_event = threading.Event()

    def persist_geometry() -> None:
        geom = get_window_geometry(window)
        if geom:
            controller.save_window_settings(geom)

    def on_closed() -> None:
        closed_event.set()

    window.events.closing += persist_geometry
    window.events.closed += on_closed

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
        persist_geometry()
        controller.job.stop_event.set()
        server.stop()
    if result.get("error"):
        raise RuntimeError(result["error"])


def main() -> None:
    # The fallback message below is Vietnamese; a cp1252 stdout (redirected by
    # run_app.bat or a CI pipe) would raise UnicodeEncodeError instead of
    # actually falling back to the classic UI.
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--debug-web", action="store_true")
    parser.add_argument("--archive", default="")
    parser.add_argument("--smoke-test", action="store_true")
    parser.add_argument("--smoke-result", default="")
    args, _ = parser.parse_known_args()
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

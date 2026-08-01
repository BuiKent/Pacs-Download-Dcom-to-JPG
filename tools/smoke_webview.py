"""Quick WebView2 smoke test for the production app bundle.

Uses the same Edge Chromium engine, local API, token, Cornerstone bundle and
synthetic archive as the release.  The window must be visible: WebView2 gives a
hidden window no surface to composite, so Cornerstone never attaches a canvas
and every check below would time out on a healthy build.  For the full release
gate (pixel assertions, repeated MPR/3D transitions) use
``python dcom_web_app.py --smoke-test``.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import webview

from dcom_web_app import _assert_panes_drawn
from web_backend import LocalApiServer, WebController


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--archive", required=True)
    parser.add_argument("--static", default="web_dist")
    args = parser.parse_args()

    controller = WebController()
    controller.open_archive(args.archive)
    server = LocalApiServer(controller, Path(args.static))
    url = server.start()
    window = webview.create_window(
        "DCom Smoke",
        url=url,
        width=1280,
        height=800,
        background_color="#060a10",
    )
    result: dict = {}

    def run_checks() -> None:
        try:
            if not window.events.loaded.wait(30):
                raise TimeoutError("WebView2 không phát sự kiện loaded.")
            deadline = time.time() + 45
            while time.time() < deadline:
                state = window.evaluate_js(
                    """({
                      title: document.title,
                      brand: document.querySelector('.brand b')?.textContent || '',
                      fatal: document.querySelector('.fatal-error')?.textContent || '',
                      error: document.querySelector('.empty-state.error')?.textContent || '',
                      readyMode: window.__viewerReadyMode || '',
                      series: document.querySelectorAll('.series-card').length,
                      canvases: document.querySelectorAll('#workspace canvas').length
                    })"""
                )
                if state.get("fatal"):
                    raise RuntimeError(state["fatal"])
                if state.get("error"):
                    raise RuntimeError(state["error"])
                if (
                    state.get("series") == 1
                    and state.get("canvases", 0) >= 1
                    and state.get("readyMode") == "single"
                ):
                    state["litPixels"] = _assert_panes_drawn(window, "single", 1)
                    result["single"] = state
                    break
                time.sleep(0.5)
            else:
                raise TimeoutError(f"Không dựng được stack: {state}")

            window.evaluate_js("document.querySelector('[data-action=\"mode-mpr\"]').click()")
            deadline = time.time() + 60
            while time.time() < deadline:
                mpr = window.evaluate_js(
                    """({
                      disabled: document.querySelector('[data-action="mode-mpr"]')?.disabled,
                      canvases: document.querySelectorAll('#workspace canvas').length,
                      readyMode: window.__viewerReadyMode || '',
                      diagnostics: window.__viewerDiagnostics || null,
                      labels: [...document.querySelectorAll('.viewport-label')].map(e => e.textContent),
                      error: document.querySelector('.empty-state.error')?.textContent || '',
                      controls: ['tool-angle', 'tool-ellipse', 'tool-freehand'].map(action => {
                        const button = document.querySelector(`[data-action="${action}"]`);
                        const toolbar = document.querySelector('.toolbar');
                        const rect = button?.getBoundingClientRect();
                        const bounds = toolbar?.getBoundingClientRect();
                        return {
                          action,
                          visible: Boolean(button && rect && bounds
                            && rect.left >= bounds.left && rect.right <= bounds.right
                            && rect.top >= bounds.top && rect.bottom <= bounds.bottom)
                        };
                      })
                    })"""
                )
                if mpr.get("error"):
                    raise RuntimeError(mpr["error"])
                if mpr.get("canvases", 0) >= 3 and mpr.get("readyMode") == "mpr":
                    hidden_controls = [
                        item.get("action")
                        for item in mpr.get("controls", [])
                        if not item.get("visible")
                    ]
                    if hidden_controls:
                        raise RuntimeError(f"MPR controls are clipped: {hidden_controls}")
                    mpr["litPixels"] = _assert_panes_drawn(window, "mpr", 3)
                    result["mpr"] = mpr
                    break
                time.sleep(0.5)
            else:
                raise TimeoutError(f"Không dựng được MPR: {mpr}")

            if (mpr.get("diagnostics") or {}).get("sourceType") == "dicom":
                window.evaluate_js(
                    """(() => {
                      const select = document.querySelector('[data-field="window-preset"]');
                      select.value = 'contrast';
                      select.dispatchEvent(new Event('change', { bubbles: true }));
                    })()"""
                )
                time.sleep(0.75)
                result["dicomPreset"] = window.evaluate_js(
                    """({
                      selected: document.querySelector('[data-field="window-preset"]')?.value || '',
                      ranges: (window.__viewerDiagnostics?.viewports || []).map(item => item.voiRange)
                    })"""
                )
                ranges = result["dicomPreset"].get("ranges", [])
                if (
                    result["dicomPreset"].get("selected") != "contrast"
                    or not ranges
                    or any(value in ({"lower": 62, "upper": 168}, None) for value in ranges)
                ):
                    raise RuntimeError(f"DICOM preset still uses JPG range: {result['dicomPreset']}")
                result["dicomPreset"]["litPixels"] = _assert_panes_drawn(
                    window, "dicom-preset", 3,
                )

            window.evaluate_js("document.querySelector('[data-action=\"mode-volume3d\"]').click()")
            deadline = time.time() + 45
            while time.time() < deadline:
                volume = window.evaluate_js(
                    """({
                      canvases: document.querySelectorAll('#workspace canvas').length,
                      readyMode: window.__viewerReadyMode || '',
                      labels: [...document.querySelectorAll('.viewport-label')].map(e => e.textContent),
                      error: document.querySelector('.empty-state.error')?.textContent || ''
                    })"""
                )
                if volume.get("error"):
                    raise RuntimeError(volume["error"])
                if (
                    volume.get("canvases", 0) >= 1
                    and volume.get("readyMode") == "volume3d"
                    and any("3D" in text for text in volume.get("labels", []))
                ):
                    volume["litPixels"] = _assert_panes_drawn(
                        window, "volume3d", volume.get("canvases", 0),
                    )
                    result["volume3d"] = volume
                    break
                time.sleep(0.5)
            else:
                raise TimeoutError(f"Không dựng được 3D: {volume}")
        except Exception as exc:
            result["error"] = str(exc)
        finally:
            window.destroy()

    try:
        webview.start(run_checks, gui="edgechromium", private_mode=True)
    finally:
        server.stop()
    # Vietnamese diagnostics must survive a redirected stdout (cp1252 pipe).
    _force_utf8_stdout()
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 1 if result.get("error") else 0


def _force_utf8_stdout() -> None:
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass


if __name__ == "__main__":
    raise SystemExit(main())

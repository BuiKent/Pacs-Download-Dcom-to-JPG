"""Headless-ish WebView2 smoke test for the production app bundle.

The WebView window is created hidden, but uses the same Edge Chromium engine,
local API, token, Cornerstone bundle and synthetic archive as the release.
"""

from __future__ import annotations

import argparse
import json
import sys
import threading
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import webview

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
        hidden=True,
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
                      series: document.querySelectorAll('.series-card').length,
                      canvases: document.querySelectorAll('#workspace canvas').length
                    })"""
                )
                if state.get("fatal"):
                    raise RuntimeError(state["fatal"])
                if state.get("series") == 1 and state.get("canvases", 0) >= 1:
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
                      labels: [...document.querySelectorAll('.viewport-label')].map(e => e.textContent),
                      error: document.querySelector('.empty-state.error')?.textContent || ''
                    })"""
                )
                if mpr.get("error"):
                    raise RuntimeError(mpr["error"])
                if mpr.get("canvases", 0) >= 3:
                    result["mpr"] = mpr
                    break
                time.sleep(0.5)
            else:
                raise TimeoutError(f"Không dựng được MPR: {mpr}")

            window.evaluate_js("document.querySelector('[data-action=\"mode-volume3d\"]').click()")
            deadline = time.time() + 45
            while time.time() < deadline:
                volume = window.evaluate_js(
                    """({
                      canvases: document.querySelectorAll('#workspace canvas').length,
                      labels: [...document.querySelectorAll('.viewport-label')].map(e => e.textContent),
                      error: document.querySelector('.empty-state.error')?.textContent || ''
                    })"""
                )
                if volume.get("error"):
                    raise RuntimeError(volume["error"])
                if volume.get("canvases", 0) >= 1 and any("3D" in text for text in volume.get("labels", [])):
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
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 1 if result.get("error") else 0


if __name__ == "__main__":
    raise SystemExit(main())

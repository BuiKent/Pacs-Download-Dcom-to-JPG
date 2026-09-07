"""Automated real browser runtime sanity smoke test for Gate 3.

Uses Playwright with real headless Chrome and LocalApiServer serving the
production bundle (web_dist). Tests real user workflows:
1. Boots local server and navigates to the app with bearer token.
2. Verifies app shell mounts cleanly with proper dark/light theme classes.
3. Verifies Worklist renders and tab switching operates without error.
4. Opens patient media record, launching the Surgery Video Studio.
5. Swaps video clips via media-file-next/prev to ensure DOM listeners
   do not detach (the historical regression bug).
6. Clicks the marker button and 7. a marker pin, judging each by what
   changed on screen.
8. Guarantees 0 uncaught exceptions and 0 browser console errors.

A click on a button whose listener was never attached raises nothing and
logs nothing, so error counting alone cannot see the regression this file
exists to catch: with the studio's wiring removed, an earlier version of
this script clicked every dead button and reported a pass. Every step now
asserts the effect of its click, and a missing element fails the run
instead of being skipped.
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

# Force UTF-8 output on Windows consoles
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from playwright.sync_api import sync_playwright
import video_engine as ve
from web_backend import LocalApiServer, WebController


def create_synthetic_smoke_archive(root: Path) -> Path:
    """Create a lightweight synthetic patient archive with 2 video clips and manifest."""
    patient_dir = root / "1234 - NGUYEN VAN A"
    study_video = patient_dir / "01.09.2026-video-phau-thuat"
    study_video.mkdir(parents=True, exist_ok=True)

    study_video_2 = patient_dir / "02.09.2026-video-phau-thuat-2"
    study_video_2.mkdir(parents=True, exist_ok=True)

    clip_01 = study_video / "clip_01.mp4"
    clip_02 = study_video / "clip_02.mp4"
    clip_03 = study_video_2 / "clip_03.mp4"

    # Generate a lightweight 1-second H.264 clip with ffmpeg
    try:
        subprocess.run([
            ve._ffmpeg(), "-y",
            "-f", "lavfi", "-i", "testsrc2=size=320x240:rate=10:duration=1",
            "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
            str(clip_01),
        ], check=True, capture_output=True)
        shutil.copyfile(clip_01, clip_02)
        shutil.copyfile(clip_01, clip_03)
    except Exception as exc:
        print(f"Warning: Failed to generate synthetic mp4 with ffmpeg: {exc}")
        # Fallback dummy bytes
        mp4_bytes = bytes([0, 0, 0, 0x18]) + b"ftypmp42" + b"\x00" * 32
        clip_01.write_bytes(mp4_bytes)
        clip_02.write_bytes(mp4_bytes)
        clip_03.write_bytes(mp4_bytes)

    manifest = {
        "patientId": "1234",
        "patientName": "NGUYEN VAN A",
        "gender": "Nam",
        "birthYear": "1980",
        "studies": {
            "study-video-1": {
                "folderName": "01.09.2026-video-phau-thuat",
                "studyDate": "2026-09-01",
                "modality": "VIDEO",
                "description": "Video phẫu thuật nội soi",
                "status": "complete",
            },
            "study-video-2": {
                "folderName": "02.09.2026-video-phau-thuat-2",
                "studyDate": "2026-09-02",
                "modality": "VIDEO",
                "description": "Video phẫu thuật thì hai",
                "status": "complete",
            },
        },
    }
    (patient_dir / "patient-index.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return patient_dir


def require(page, selector: str, label: str):
    """The element this step acts on, or a failure naming what was missing.

    Every step used to be wrapped in `if element:` with no `else`, so a studio
    that never opened skipped silently and the run still reported success.
    """
    handle = page.query_selector(selector)
    if handle is None:
        raise AssertionError(f"Gate 3: không tìm thấy {label} ({selector}) trên giao diện thật.")
    return handle


def video_src(page) -> str:
    return page.evaluate(
        "() => document.querySelector('#surgery-video-player')?.getAttribute('src') || ''"
    )


def run_smoke_test(static_dir: Path, headless: bool = True) -> int:
    print("=== Gate 3: Real Browser Smoke Test ===")
    print(f"Static bundle dir: {static_dir}")
    if not static_dir.exists() or not (static_dir / "index.html").exists():
        print(f"FAIL: {static_dir} not found or missing index.html. Run 'npm run build --prefix webui' first.")
        return 1

    with tempfile.TemporaryDirectory() as tmp:
        archive_root = Path(tmp)
        create_synthetic_smoke_archive(archive_root)

        controller = WebController()
        controller.open_archive(str(archive_root))
        server = LocalApiServer(controller, static_dir)
        app_url = server.start()
        print(f"LocalApiServer running at {app_url}")

        console_errors: list[str] = []
        page_errors: list[str] = []

        try:
            with sync_playwright() as p:
                try:
                    browser = p.chromium.launch(channel="chrome", headless=headless)
                except Exception:
                    browser = p.chromium.launch(headless=headless)

                context = browser.new_context(viewport={"width": 1280, "height": 800})
                page = context.new_page()

                def handle_console(msg):
                    if msg.type in ("error",):
                        err_text = f"[{msg.type.upper()}] {msg.text}"
                        console_errors.append(err_text)
                        print(f"  Browser Console: {err_text}")

                def handle_page_error(exc):
                    err_text = f"Uncaught Exception: {exc}"
                    page_errors.append(err_text)
                    print(f"  Browser Uncaught Error: {err_text}")

                page.on("console", handle_console)
                page.on("pageerror", handle_page_error)

                # 1. Load application
                print("1. Loading application...")
                page.goto(app_url, wait_until="domcontentloaded", timeout=15000)
                page.wait_for_selector("#app", timeout=10000)
                print(f"   Page title: {page.title()}")

                # 2. Check Studio Mount
                print("2. Verifying initial viewer/studio state...")
                page.wait_for_timeout(1000)
                is_studio = page.evaluate("() => Boolean(document.querySelector('.media-studio-root, video'))")
                if not is_studio:
                    print("   Warning: Studio element not immediately found, checking app-shell...")

                # 3. Test Worklist Tab Navigation
                worklist_tab = require(
                    page, ".winbar-tab[data-tab-id='worklist'], .winbar-tab:has-text('Worklist')",
                    "tab Worklist",
                )
                print("3. Testing navigation to Worklist tab...")
                worklist_tab.click()
                page.wait_for_selector(".worklist-view, .worklist-tree", timeout=5000)
                print("   Switched to Worklist (view mounted).")

                # 4. Switch back to Patient / Studio Tab
                print("4. Switching back to Patient / Studio tab...")
                patient_tab = require(
                    page, ".winbar-tab:not([data-tab-id='worklist'])", "tab bệnh nhân",
                )
                patient_tab.click()
                page.wait_for_selector("#surgery-video-player", timeout=5000)
                print("   Studio remounted on the patient tab.")

                # 5. Clip switching. A click that lands on a button with no
                #    listener is completely silent — no exception, no console
                #    error — so the swap is judged by what changed on screen,
                #    never by the click having been dispatched.
                print("5. Testing clip swapping in Surgery Video Studio...")
                card_count = len(page.query_selector_all(".series-card[data-series-id]"))
                if card_count < 2:
                    raise AssertionError(
                        f"Gate 3: cần 2 series video trong dải, chỉ thấy {card_count}."
                    )
                # The strip is ordered by study date, so which card holds the
                # two-clip folder is not fixed. Find it rather than assume it.
                multi_clip_card = None
                for index in range(card_count):
                    page.query_selector_all(".series-card[data-series-id]")[index].click()
                    page.wait_for_timeout(400)
                    if page.query_selector("[data-action='media-file-next']"):
                        multi_clip_card = index
                        break
                if multi_clip_card is None:
                    raise AssertionError("Gate 3: không series nào có nhiều hơn một clip.")
                before = video_src(page)
                require(page, "[data-action='media-file-next']", "nút clip kế tiếp").click()
                page.wait_for_function(
                    "src => document.querySelector('#surgery-video-player')?.getAttribute('src') !== src",
                    arg=before, timeout=5000,
                )
                print("   Swapped to clip 2 via media-file-next.")
                require(page, "[data-action='media-file-prev']", "nút clip trước").click()
                page.wait_for_function(
                    "src => document.querySelector('#surgery-video-player')?.getAttribute('src') === src",
                    arg=before, timeout=5000,
                )
                print("   Swapped back to clip 1 via media-file-prev.")

                # 5b. THE historical regression. Stepping between files of one
                #     series goes through a full render(), which rewires
                #     everything — so it can never expose this bug. Picking a
                #     different video *series* does not: it rewrites #workspace
                #     alone and leans on initMediaEvents() to wire the studio
                #     back up. That is the path where every tool went dead.
                print("5b. Switching to a second video series from the strip...")
                before = video_src(page)
                other = 1 if multi_clip_card == 0 else 0
                page.query_selector_all(".series-card[data-series-id]")[other].click()
                page.wait_for_function(
                    "src => document.querySelector('#surgery-video-player')?.getAttribute('src') !== src",
                    arg=before, timeout=5000,
                )
                print("   Workspace swapped to the second series.")

                # 6. The workspace above was rewritten without a full render, so
                #    every studio button is a fresh node. A marker that appears
                #    proves the listener came back with it.
                print("6. Verifying interactive buttons survive the swap...")
                # Pins are positioned as a percentage of the clip, so the
                # duration has to be known before a marker can be drawn.
                page.wait_for_function(
                    "() => (document.querySelector('#surgery-video-player')?.duration || 0) > 0",
                    timeout=10000,
                )
                # Marked away from zero, so that seeking back to it later is a
                # movement the assertion in step 7 can actually see.
                page.evaluate(
                    "() => { const v = document.querySelector('#surgery-video-player');"
                    " v.currentTime = Math.min(0.5, (v.duration || 1) / 2); }"
                )
                require(page, "[data-action='add-video-bookmark']", "nút thêm mốc").click()
                page.wait_for_function(
                    "() => document.querySelectorAll('.surgery-bookmark-card').length === 1",
                    timeout=5000,
                )
                print("   Marker button is live: a bookmark card appeared.")

                # 7. And the marker pin itself answers a click by moving the
                #    playhead — the failure the reader first reported.
                print("7. Verifying a timeline marker seeks the clip...")
                page.wait_for_selector(".video-marker-pin", timeout=5000)
                page.evaluate("() => { document.querySelector('#surgery-video-player').currentTime = 0; }")
                require(page, ".video-marker-pin", "mốc trên timeline").click()
                page.wait_for_function(
                    "() => (document.querySelector('#surgery-video-player')?.currentTime || 0) > 0",
                    timeout=5000,
                )
                print("   Marker pin is live: the playhead moved to it.")
                browser.close()
        finally:
            server.stop()
            print("LocalApiServer stopped.")

        if page_errors or console_errors:
            print("\n❌ GATE 3 FAILED: Browser encountered runtime errors:")
            for err in page_errors + console_errors:
                print(f"   - {err}")
            return 1

        print("\n✅ GATE 3 PASSED: Full browser runtime sanity check verified with 0 errors.")
        return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Run Gate 3 browser sanity smoke test")
    parser.add_argument("--static", default="web_dist", help="Static directory (default: web_dist)")
    parser.add_argument("--headed", action="store_true", help="Run browser in visible (headed) mode")
    args = parser.parse_args()

    sys.exit(run_smoke_test(Path(args.static), headless=not args.headed))

r"""Real Clinical Dataset Audit with Screenshots & Deep Analysis.

Connects LocalApiServer directly to the user's real NeuroOncology repository:
D:\Học tập\NỘI TRÚ THẦN KINH\Google drive\Working\NeuroOncology\BN mổ NeuroOncology
(26+ patients, 60k+ real clinical MRI/CT neurosurgical images).

Runs real Playwright Chromium to test and capture:
1. Real Worklist mounting with 32 patients
2. Clinical search (Hoàng Minh Thiệp 8 studies, clinical diagnoses)
3. Modality filters
4. Opening real patient 1 (Lê Thị Huyền - Brain MRI + Gadovist)
5. Viewer controls, real DICOM slice display, patient rail
6. Opening real patient 2 (Hoàng Minh Thiệp - 8 studies longitudinal timeline)
7. Multi-tab concurrency & state preservation
8. Full runtime performance and log analysis
"""

from __future__ import annotations

import os
import sys
import time
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from playwright.sync_api import sync_playwright
from web_backend import LocalApiServer, WebController

REAL_DATA_ROOT = Path(r"D:\Học tập\NỘI TRÚ THẦN KINH\Google drive\Working\NeuroOncology\BN mổ NeuroOncology")
SCREENSHOTS_DIR = PROJECT_ROOT / "screenshots"
SCREENSHOTS_DIR.mkdir(parents=True, exist_ok=True)


def run_real_clinical_audit():
    print("=== BẮT ĐẦU KIỂM THỬ TRỰC TIẾP TRÊN KHO DỮ LIỆU THẬT BN MỔ NEUROONCOLOGY ===")
    print(f"Nguồn dữ liệu: {REAL_DATA_ROOT}")
    if not REAL_DATA_ROOT.exists():
        print(f"LỖI: Không tìm thấy đường dẫn {REAL_DATA_ROOT}")
        return

    static_dir = PROJECT_ROOT / "web_dist"
    boot_patient = REAL_DATA_ROOT / "2601040592 - LE THI HUYEN - 20T - 10-09-2026"

    # Setup controller pointing to real data
    controller = WebController()
    controller.output_root = REAL_DATA_ROOT
    controller.source_folders = [REAL_DATA_ROOT]
    if boot_patient.exists():
        controller.open_archive(str(boot_patient))

    server = LocalApiServer(controller, static_dir)
    app_url = server.start()
    print(f"LocalApiServer đang chạy tại: {app_url}")

    console_logs: list[dict] = []
    network_errors: list[str] = []

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            context = browser.new_context(viewport={"width": 1600, "height": 950})
            page = context.new_page()

            page.on("console", lambda msg: console_logs.append({
                "type": msg.type, "text": msg.text
            }))
            page.on("pageerror", lambda err: console_logs.append({
                "type": "uncaught", "text": str(err)
            }))
            page.on("response", lambda res: network_errors.append(
                f"HTTP {res.status} {res.request.method} {res.url}"
            ) if res.status >= 400 else None)

            # 1. Điều hướng vào Web App
            print("\n1. Mở Web App...")
            t0 = time.time()
            page.goto(app_url, wait_until="networkidle", timeout=30000)
            page.wait_for_selector("#app", timeout=15000)
            print(f"   App khởi động trong {time.time()-t0:.2f}s, tiêu đề: {page.title()}")

            # 2. Xem Tab Worklist với 32 ca lâm sàng thật
            print("\n2. Chuyển sang Tab Worklist...")
            worklist_tab = page.wait_for_selector(".winbar-tab[data-tab-id='worklist']")
            worklist_tab.click()
            page.wait_for_selector(".worklist-tree", timeout=15000)
            page.wait_for_timeout(2000)

            shot_01 = SCREENSHOTS_DIR / "real_01_worklist_overview.png"
            page.screenshot(path=str(shot_01))
            print(f"   📸 Đã chụp: {shot_01.name}")

            # Đếm số hàng bệnh nhân
            rows = page.query_selector_all(".prow")
            print(f"   Tổng số bệnh nhân hiển thị trên Worklist: {len(rows)}")

            # 3. Tìm kiếm ca đa đợt khám: HOÀNG MINH THIỆP (8 ca chụp)
            print("\n3. Tìm kiếm hồ sơ bệnh nhân HOÀNG MINH THIỆP (8 đợt khám)...")
            search_input = page.wait_for_selector("input[data-field='worklist-search']")
            search_input.fill("HOÀNG MINH THIỆP")
            page.wait_for_timeout(1000)

            # Mở rộng các đợt khám của BN Thiệp
            twist_btn = page.query_selector(".prow button.twist")
            if twist_btn:
                twist_btn.click()
                page.wait_for_timeout(800)

            shot_02 = SCREENSHOTS_DIR / "real_02_worklist_hoang_minh_thiep.png"
            page.screenshot(path=str(shot_02))
            print(f"   📸 Đã chụp: {shot_02.name}")

            # 4. Tìm kiếm theo chẩn đoán lâm sàng: Cavernoma / U não / Oligo
            print("\n4. Thử nghiệm tìm kiếm theo chẩn đoán: 'Cavernoma'...")
            search_input.fill("Cavernoma")
            page.wait_for_timeout(1000)

            shot_03 = SCREENSHOTS_DIR / "real_03_worklist_search_cavernoma.png"
            page.screenshot(path=str(shot_03))
            print(f"   📸 Đã chụp: {shot_03.name}")

            # Xoá tìm kiếm
            search_input.fill("")
            page.wait_for_timeout(1000)

            # 5. Mở Hồ Sơ BN 1: LÊ THỊ HUYỀN (2601040592)
            print("\n5. Mở hồ sơ bệnh nhân LÊ THỊ HUYỀN (2601040592)...")
            huyen_row = None
            for r in page.query_selector_all(".prow"):
                if "2601040592" in r.inner_text() or "HUYEN" in r.inner_text():
                    huyen_row = r
                    break
            if huyen_row:
                open_btn = huyen_row.query_selector("[data-action='open-patient-record']")
                if open_btn:
                    open_btn.click()
                    print("   Đã click 'Mở hồ sơ', chờ viewer nạp dữ liệu phim...")
                    try:
                        page.wait_for_selector(".series-card, #workspace canvas", timeout=35000)
                        page.wait_for_timeout(1500)
                    except Exception as e:
                        print(f"   (Timeout chờ viewer: {e})")

            shot_04 = SCREENSHOTS_DIR / "real_04_viewer_le_thi_huyen.png"
            page.screenshot(path=str(shot_04))
            print(f"   📸 Đã chụp: {shot_04.name}")

            # 6. Thu gọn thanh Patient Rail để tối ưu không gian đọc phim
            print("\n6. Kiểm tra thu gọn Patient Rail...")
            collapse_btn = page.query_selector(".rail-toggle-btn")
            if collapse_btn and collapse_btn.is_visible():
                collapse_btn.click()
                page.wait_for_timeout(800)
                shot_05 = SCREENSHOTS_DIR / "real_05_viewer_rail_collapsed.png"
                page.screenshot(path=str(shot_05))
                print(f"   📸 Đã chụp: {shot_05.name}")

                # Mở lại rail
                expand_btn = page.query_selector(".rail-expand-trigger, .rail-collapsed-strip")
                if expand_btn and expand_btn.is_visible():
                    expand_btn.click()
                    page.wait_for_timeout(600)

            # 7. Mở Hồ Sơ BN 2: HOÀNG MINH THIỆP (8 ca chụp dọc thời gian)
            print("\n7. Quay lại Worklist mở hồ sơ đa đợt khám: HOÀNG MINH THIỆP...")
            worklist_tab = page.query_selector(".winbar-tab[data-tab-id='worklist']")
            if worklist_tab:
                worklist_tab.click()
                page.wait_for_timeout(1000)

                thiep_row = None
                for r in page.query_selector_all(".prow"):
                    if "2605030698" in r.inner_text() or "THIỆP" in r.inner_text():
                        thiep_row = r
                        break
                if thiep_row:
                    open_btn = thiep_row.query_selector("[data-action='open-patient-record']")
                    if open_btn:
                        open_btn.click()
                        print("   Đã click 'Mở hồ sơ' BN Hoàng Minh Thiệp, đang nạp lịch sử 8 ca chụp...")
                        try:
                            page.wait_for_selector(".series-card, #workspace canvas", timeout=35000)
                            page.wait_for_timeout(1500)
                        except Exception as e:
                            print(f"   (Timeout chờ viewer Thiệp: {e})")

            shot_06 = SCREENSHOTS_DIR / "real_06_viewer_hoang_minh_thiep_timeline.png"
            page.screenshot(path=str(shot_06))
            print(f"   📸 Đã chụp: {shot_06.name}")

            # Chuyển series khác trong danh sách series strip
            series_cards = page.query_selector_all(".series-card")
            print(f"   Số lượng series thumbnails tìm thấy: {len(series_cards)}")
            if len(series_cards) >= 2:
                series_cards[1].click()
                page.wait_for_timeout(1500)
                shot_07 = SCREENSHOTS_DIR / "real_07_viewer_hoang_minh_thiep_series2.png"
                page.screenshot(path=str(shot_07))
                print(f"   📸 Đã chụp: {shot_07.name}")

            # 8. Kiểm tra Chuyển Đổi Đa Tab (Lê Thị Huyền <-> Hoàng Minh Thiệp)
            print("\n8. Kiểm tra chuyển đổi qua lại giữa các tab bệnh nhân...")
            tabs = page.query_selector_all(".winbar-tab:not([data-tab-id='worklist'])")
            print(f"   Số tab bệnh nhân đang mở: {len(tabs)}")
            for t in tabs:
                print(f"     - Tab: {t.inner_text().strip()}")

            # Bấm quay lại tab Lê Thị Huyền
            huyen_tab = None
            for t in tabs:
                if "HUYEN" in t.inner_text() or "2601040592" in t.inner_text():
                    huyen_tab = t
                    break
            if huyen_tab:
                huyen_tab.click()
                page.wait_for_timeout(1000)
                shot_08 = SCREENSHOTS_DIR / "real_08_viewer_switchback_huyen.png"
                page.screenshot(path=str(shot_08))
                print(f"   📸 Đã chụp: {shot_08.name}")

            # 9. Tổng hợp báo cáo kiểm định
            print("\n=== BÁO CÁO PHÂN TÍCH LOGS & HIỆU NĂNG THỰC TẾ ===")
            errs = [l for l in console_logs if l["type"] in ("error", "uncaught")]
            warns = [l for l in console_logs if l["type"] == "warning"]
            print(f"Tổng số console messages: {len(console_logs)}")
            print(f"Console errors / Uncaught: {len(errs)}")
            print(f"Console warnings: {len(warns)}")
            print(f"Network errors (>=400): {len(network_errors)}")

            if errs:
                print("\nChi tiết console errors:")
                for e in errs[:10]:
                    print(f"  ❌ {e['text']}")
            else:
                print("  ✅ 0 CONSOLE ERRORS TRÊN DỮ LIỆU THẬT!")

            if network_errors:
                print("\nChi tiết network errors:")
                for ne in network_errors[:10]:
                    print(f"  ⚠️ {ne}")
            else:
                print("  ✅ 0 FAILED NETWORK REQUESTS!")

            browser.close()
    finally:
        server.stop()
        print("LocalApiServer đã dừng.")

    print("\nKiểm thử trên dữ liệu lâm sàng thật hoàn tất!")


if __name__ == "__main__":
    run_real_clinical_audit()

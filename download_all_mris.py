# -*- coding: utf-8 -*-
"""
download_all_mris.py
====================
Tự động đăng nhập RIS, lấy link viewer và tải toàn bộ 4 ca MRI của bệnh nhân 2605032022 (NGUYỄN THỊ HIÊN).
"""
import sys, os, time, io
from pathlib import Path

# Fix encoding cho Windows console
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

import dcom_pipeline as pipe
from playwright.sync_api import sync_playwright

BASE = "https://dhy.cdhaviet.vn"
LOGIN_URL = f"{BASE}/ris/account/login"
USERNAME = "bslsdhy"
PASSWORD = "Dhy@12345"
PATIENT_ID = "2605032022"

MRI_STUDIES = [
    {
        "name": "MRI_1_18-05-2026_MR_So_Nao_Clariscan",
        "date": "18/05/2026 21:11",
        "studyIUID": "1.2.840.113619.6.514.309260971810341949224534780946041822097",
    },
    {
        "name": "MRI_2_26-05-2026_MR_So_Nao_Clariscan",
        "date": "26/05/2026 20:15",
        "studyIUID": "123.3269512371123.1866235370775006",
    },
    {
        "name": "MRI_3_05-06-2026_MR_So_Nao",
        "date": "05/06/2026 00:00",
        "studyIUID": "123.3269512371123.1867141687162868",
    },
    {
        "name": "MRI_4_05-06-2026_MR_So_Nao_Gadovist",
        "date": "05/06/2026 21:13",
        "studyIUID": "123.3269512371123.1867147994438920",
    },
]


def fetch_all_direct_urls():
    """Lấy toàn bộ link iframe trực tiếp bằng 1 phiên Playwright riêng."""
    direct_urls = []
    print("[1] Bắt đầu lấy link viewer trực tiếp cho 4 ca MRI...")
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            viewport={"width": 1920, "height": 1080}
        )
        page = context.new_page()

        page.goto(LOGIN_URL, wait_until="networkidle", timeout=20000)
        page.fill("input[name='account']", USERNAME)
        page.fill("input[name='password']", PASSWORD)
        btn = page.query_selector("button[type='submit']")
        if btn and btn.is_visible():
            btn.click()
        else:
            for b in page.query_selector_all("button"):
                if b.is_visible():
                    b.click()
                    break
        time.sleep(2)
        print("    -> Đăng nhập RIS thành công!")

        for idx, mri in enumerate(MRI_STUDIES, 1):
            iuid = mri["studyIUID"]
            wrapper_url = f"{BASE}/ris/vrViewer?studyUID={iuid}&viewType=VIEWERV2"
            vpage = context.new_page()
            try:
                vpage.goto(wrapper_url, timeout=20000)
                time.sleep(4)
                iframes = vpage.evaluate("() => Array.from(document.querySelectorAll('iframe')).map(f => f.src)")
                direct_url = iframes[0] if iframes else wrapper_url
                print(f"    Ca [{idx}/4] {mri['date']} -> {direct_url}")
                direct_urls.append(direct_url)
            except Exception as e:
                print(f"    Ca [{idx}/4] ⚠️ Lỗi lấy link: {e}")
                direct_urls.append(wrapper_url)
            finally:
                vpage.close()

        browser.close()
    return direct_urls


def main():
    save_base_dir = Path.cwd() / f"BN_{PATIENT_ID}_MRI_Full"
    save_base_dir.mkdir(parents=True, exist_ok=True)

    print("=" * 80)
    print(f"BẮT ĐẦU TỰ ĐỘNG TẢI TOÀN BỘ 4 CA MRI BỆNH NHÂN {PATIENT_ID} (NGUYỄN THỊ HIÊN)")
    print(f"Thư mục lưu tổng: {save_base_dir}")
    print("=" * 80)

    # Bước 1: Lấy link viewer trực tiếp
    direct_urls = fetch_all_direct_urls()

    # Bước 2: Tải từng ca bằng run_pipeline độc lập (không bị lồng Playwright session)
    print("\n[2] Bắt đầu tải dữ liệu ảnh DICOM/JPG cho từng ca MRI...")
    for idx, (mri, direct_url) in enumerate(zip(MRI_STUDIES, direct_urls), 1):
        mri_out_dir = save_base_dir / f"Ca_{idx}_{mri['name']}"
        print("\n" + "-" * 70)
        print(f"[{idx}/4] ĐANG TẢI CA {idx}: {mri['date']} ({mri['name']})")
        print(f"      URL: {direct_url}")
        print(f"      Lưu tại: {mri_out_dir}")
        print("-" * 70)

        try:
            dl, cv, jpg_dir = pipe.run_pipeline(
                url=direct_url,
                out_base=mri_out_dir,
                headless=True,
                quality=100,
                save_png=False,
                contrast_mode=pipe.CLINICAL,
            )
            print(f"✓ ĐÃ TẢI XONG CA {idx}: {jpg_dir}")
        except Exception as e:
            import traceback
            print(f"❌ Lỗi khi tải ca {idx}: {e}")
            traceback.print_exc()

    print("\n" + "=" * 80)
    print("HOÀN TẤT TẢI TOÀN BỘ 4 CA MRI!")
    print(f"Thư mục chứa toàn bộ ảnh: {save_base_dir}")
    print("=" * 80)

if __name__ == "__main__":
    main()

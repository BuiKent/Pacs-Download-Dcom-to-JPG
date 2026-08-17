import sys
import time
from pathlib import Path
from web_backend import WebController
from dcom_pipeline import run_pipeline

sys.stdout.reconfigure(encoding='utf-8')

def main():
    controller = WebController()
    output_root = Path("test_real_downloads")
    output_root.mkdir(exist_ok=True)

    links = [
        "https://viewer.vnrad.vn:7198/Viewer/s#/view?id=2690b589-8a0a-4fa5-90a8-1d951980414d",
        "https://viewer.vnrad.vn:7198/Viewer/s#/view?id=186bc334-e62b-4201-89b0-c41989139361",
        "http://dhy.cdhaviet.vn/ris/vrViewer?study=MTIzLjMyNjk1MTIzNzExMjMuMTg2ODEyNDMwMzE3OTAwOQ%3D%3D",
        "https://pacs.hmuh.vn:7198/Viewer/s#/view?id=860f1c41-8112-4222-94d6-8b27d122e0dc"
    ]

    for i, url in enumerate(links, 1):
        print(f"\n{'='*80}\n[Ca {i}] Bắt đầu tải link: {url}")
        out_base, resumed = controller._direct_download_root(output_root, url, resume=False)
        out_base.mkdir(parents=True, exist_ok=True)
        
        def log_fn(msg):
            # Filter progress logs to reduce console noise
            if "Đã tải" not in str(msg) and "Convert slice" not in str(msg):
                print(f"  {msg}")
                
        try:
            dl, cv, jpg_dir = run_pipeline(
                url, 
                out_base, 
                log=log_fn, 
                resume=resumed,
                rename_patient_root=True
            )
            
            jpg_dir = Path(jpg_dir)
            direct_root = jpg_dir.parent if jpg_dir.parent.is_dir() else out_base
            controller._write_direct_download_marker(direct_root, url)
            controller.history.add(direct_root, url)
            
            print(f"[Ca {i}] HOÀN TẤT.")
            print(f"Thư mục gốc: {direct_root.resolve()}")
            print(f"Thư mục ảnh: {jpg_dir.resolve()}")
            print(f"Manifest:")
            manifest = direct_root / "patient-index.json"
            if manifest.exists():
                print(manifest.read_text(encoding="utf-8"))
            else:
                print(" Không thấy patient-index.json")
                
        except Exception as e:
            print(f"LỖI: {e}")
            import traceback
            traceback.print_exc()

if __name__ == "__main__":
    main()

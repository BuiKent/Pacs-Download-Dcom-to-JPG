import pydicom
import os
import glob
import sys
sys.stdout.reconfigure(encoding='utf-8')

for folder in glob.glob("test_real_downloads/LINK_*"):
    found = False
    for root, dirs, files in os.walk(folder):
        if "DICOM" in root:
            for file in files:
                dcm_path = os.path.join(root, file)
                try:
                    ds = pydicom.dcmread(dcm_path, stop_before_pixels=True, force=True)
                    if hasattr(ds, 'PatientID') or hasattr(ds, 'PatientName'):
                        print(f"\n--- Thư mục: {os.path.basename(folder)} ---")
                        print(f"File: {os.path.basename(dcm_path)}")
                        print(f"PatientName:      {getattr(ds, 'PatientName', '<không có tag>')}")
                        print(f"PatientID:        {getattr(ds, 'PatientID', '<không có tag>')}")
                        print(f"PatientBirthDate: {getattr(ds, 'PatientBirthDate', '<không có tag>')}")
                        print(f"PatientSex:       {getattr(ds, 'PatientSex', '<không có tag>')}")
                        print(f"PatientAge:       {getattr(ds, 'PatientAge', '<không có tag>')}")
                        found = True
                        break
                except Exception:
                    pass
            if found:
                break

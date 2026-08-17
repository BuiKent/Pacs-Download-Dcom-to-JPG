import sys
from pathlib import Path
from dcom_pipeline import search_patient_studies, download_studies_list

sys.stdout.reconfigure(encoding='utf-8')

def main():
    hospital_key = "dhy"
    patient_id = "2606033997"
    patient_name = ""
    
    print(f"--- Bắt đầu tìm kiếm bệnh nhân {patient_id} tại {hospital_key} ---")
    try:
        studies = search_patient_studies(
            patient_id=patient_id,
            modality="ALL",
            hospital_key=hospital_key,
            log=print
        )
        
        print(f"Tìm thấy {len(studies)} ca chụp.")
        if not studies:
            print("Không tìm thấy ca nào.")
            return
            
        for i, s in enumerate(studies):
            print(f"Ca {i+1}: {s}")
            
        # Test downloading study list
        out_root = Path("test_ris_downloads")
        out_root.mkdir(exist_ok=True)
        
        download_studies_list(
            studies=[studies[3]], # Download Study 4 only
            out_base=out_root,
            patient_id=patient_id,
            patient_name=patient_name,
            hospital_key=hospital_key,
            hospital_name="Đại học Y",
            log=print
        )
        print("XONG.")
    except Exception as e:
        print(f"LỖI: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    main()

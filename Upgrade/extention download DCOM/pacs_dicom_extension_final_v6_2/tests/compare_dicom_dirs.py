"""Compare extension output with Python downloader output by SOPInstanceUID."""
from pathlib import Path
import argparse, hashlib, json
import pydicom
CRITICAL=['StudyInstanceUID','SeriesInstanceUID','SOPInstanceUID','Rows','Columns','SamplesPerPixel','PhotometricInterpretation','BitsAllocated','BitsStored','HighBit','PixelRepresentation','RescaleSlope','RescaleIntercept','PixelSpacing','SliceThickness','ImagePositionPatient','ImageOrientationPatient','NumberOfFrames']
def load(root):
    out={}
    for p in Path(root).rglob('*.dcm'):
        try:
            ds=pydicom.dcmread(p,force=True)
            uid=str(getattr(ds,'SOPInstanceUID','') or '')
            if not uid: continue
            out[uid]=(p,ds,hashlib.sha256(bytes(getattr(ds,'PixelData',b''))).hexdigest())
        except Exception: pass
    return out
def val(ds,k):
    x=getattr(ds,k,None)
    return str(x) if x is not None else ''
def main():
    ap=argparse.ArgumentParser();ap.add_argument('python_dir');ap.add_argument('extension_dir');a=ap.parse_args()
    A,B=load(a.python_dir),load(a.extension_dir);shared=sorted(set(A)&set(B));issues=[]
    for uid in shared:
        pa,da,ha=A[uid];pb,db,hb=B[uid]
        if ha!=hb: issues.append({'uid':uid,'type':'pixel_hash','python':ha,'extension':hb})
        for k in CRITICAL:
            if val(da,k)!=val(db,k): issues.append({'uid':uid,'type':'tag','tag':k,'python':val(da,k),'extension':val(db,k)})
    report={'python_instances':len(A),'extension_instances':len(B),'shared':len(shared),'missing_in_extension':len(set(A)-set(B)),'extra_in_extension':len(set(B)-set(A)),'issues':issues}
    print(json.dumps(report,ensure_ascii=False,indent=2));raise SystemExit(1 if issues or set(A)-set(B) else 0)
if __name__=='__main__': main()

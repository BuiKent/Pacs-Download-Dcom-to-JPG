from pathlib import Path
import hashlib
import pydicom
root=Path(__file__).parent
raw=pydicom.dcmread(root/'writer_raw.dcm')
assert str(raw.file_meta.TransferSyntaxUID)=='1.2.840.10008.1.2.1'
assert str(raw.SpecificCharacterSet)=='ISO_IR 192'
assert str(raw.PatientName)=='ĐÀO^THỊ^LOAN'
assert str(raw.PatientID)=='BN001'
assert raw.Rows==2 and raw.Columns==2
assert bytes(raw.PixelData)[:8]==bytes([1,0,2,0,3,0,4,0])
comp=pydicom.dcmread(root/'writer_jpeg.dcm')
assert str(comp.file_meta.TransferSyntaxUID)=='1.2.840.10008.1.2.4.50'
assert str(comp.SpecificCharacterSet)=='ISO_IR 192'
print('pydicom validation OK', hashlib.sha256(raw.PixelData).hexdigest())

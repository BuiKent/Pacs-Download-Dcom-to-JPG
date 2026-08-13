from pathlib import Path
import struct

def read_explicit(path):
    b=Path(path).read_bytes(); assert b[128:132]==b'DICM'
    pos=132; tags={}; ts=None
    long_vr={b'OB',b'OD',b'OF',b'OL',b'OV',b'OW',b'SQ',b'UC',b'UR',b'UT',b'UN'}
    while pos+8<=len(b):
        g,e=struct.unpack_from('<HH',b,pos)
        vr=b[pos+4:pos+6]
        if vr in long_vr:
            ln=struct.unpack_from('<I',b,pos+8)[0]; vp=pos+12
        else:
            ln=struct.unpack_from('<H',b,pos+6)[0]; vp=pos+8
        if ln==0xffffffff:
            tags[(g,e)]=(vr,ln,vp); break
        val=b[vp:vp+ln]; tags[(g,e)]=(vr,ln,vp,val)
        if (g,e)==(0x0002,0x0010): ts=val.rstrip(b'\0 ').decode('ascii')
        if (g,e)==(0x7fe0,0x0010): break
        pos=vp+ln
    return b,tags,ts

root=Path(__file__).parent
b,t,ts=read_explicit(root/'writer_raw.dcm')
assert ts=='1.2.840.10008.1.2.1',ts
assert t[(0x0008,0x0005)][3].rstrip(b'\0 ').decode('ascii')=='ISO_IR 192'
pn=t[(0x0010,0x0010)][3].rstrip(b'\0 ').decode('utf-8')
assert pn=='ĐÀO^THỊ^LOAN',pn
assert (0x7fe0,0x0010) in t
b,t,ts=read_explicit(root/'writer_jpeg.dcm')
assert ts=='1.2.840.10008.1.2.4.50',ts
assert t[(0x0008,0x0005)][3].rstrip(b'\0 ').decode('ascii')=='ISO_IR 192'
assert t[(0x7fe0,0x0010)][1]==0xffffffff
print('Independent DICOM byte validation OK')

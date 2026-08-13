# v2.1 additional checks

- Slow token portal classifier (`TOKEN_PORTAL`)
- Adaptive wait: no immediate reload while portal is loading
- Activity/readyState diagnostics in session only
- Standard viewer reload fallback remains enabled

# Test report — 2.0.0

## Static / parser
- manifest JSON: OK
- background.js: `node --check` OK
- sidepanel.js: `node --check` OK
- offscreen.js: `node --check` OK
- lib/pacs.js: `node --check` OK
- lib/dicom.js: `node --check` OK

## DICOM writer smoke
- native Explicit VR Little Endian Part-10: DICM preamble OK
- encapsulated JPEG Part-10: DICM preamble OK
- transfer syntax mapping image/jpeg -> 1.2.840.10008.1.2.4.50 OK

## PACS parser smoke
- VRAD sample manifest: patient/series parse OK
- `/ris/vrViewer?...`: classified as RIS_VRVIEWER
- `Viewer/s#/view?id=...`: hash study hint recognized

## Environment limitation
Các host thực `dhy.cdhaviet.vn` và `viewer.vnrad.vn:7198` không resolve/retrieve được từ môi trường build, nên không thể khẳng định bằng live end-to-end test tại đây. v2 được sửa dựa trên network behavior/log thực do người dùng cung cấp và logic RIS wrapper đã có trong pipeline Python trước đó.

# 7.0.0

- Nâng trực tiếp từ codebase 6.2 → 6.3.x hiện tại; giữ storage key `pacs6_*` để migration không mất History/recipe/settings.
- Thêm `lib/generic_discovery.js`: content-based generic manifest discovery.
- Bỏ bước generic manifest bắt buộc URL chứa `dicom`, `image`, `wado`, `instance`, `.dcm`.
- Recursive JSON candidate extraction giữ metadata cha Study/Series/SOP/Patient.
- Cluster URL theo shape; probe mẫu theo bytes rồi mở rộng cả collection thắng.
- Manifest recipe schema v3: nhớ manifest shape, DICOM shape, JSON path/key và method.
- Generic capability profile: direct DICOM / manifest / HTTP method / MAIN-world JSON.
- Direct DICOM generic hỗ trợ GET, POST, PUT và body replay.
- Theo dõi `requestId` + body fingerprint để một endpoint POST lặp lại không bị co thành một ảnh.
- `fetchStreamWithTimeout()` thật sự gửi body cho non-GET/HEAD.
- `offscreen.js` thêm inspect prefix metadata và `INSPECT_DICOM_URLS`.
- Generic inventory group theo Series UID/Series metadata khi manifest hoặc prefix DICOM cung cấp được.
- Thêm `generic-hook.js`: MAIN-world observer chỉ clone JSON nhỏ; không copy DICOM/pixel binary.
- Content bridge chuyển JSON candidate về background khi tab đang tracking.
- Vendor adapters VietMy/VRAD/VRPACS/ZFP giữ nguyên làm compatibility fallback.
- DICOM implementation version đổi thành `PACSDLCM_700`.
- Thêm test generic discovery, generic adapter và POST/body network transport.

# 6.3.x nền

- GE Centricity Universal Viewer ZFP WebSocket hook và reconstructed DICOM.
- Adapter outcome learning / route preference / fallback giữa adapter cùng StudyUID.
- Request replay Content-Type fix, VietMy ASMX manifest, VRPACS synthetic share request.
- File System Access engine, DICOM validation, per-tab state/job, optional host permission, history/status UI.

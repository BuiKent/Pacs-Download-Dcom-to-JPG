# PACS DICOM Downloader 6.1 — kiểm tra build

## Đã chạy

- `node --check` toàn bộ JavaScript.
- Static architecture checks:
  - không `debugger`;
  - không required `host_permissions`;
  - `optional_host_permissions` hỗ trợ HTTP/HTTPS;
  - File System Access dùng `createWritable`;
  - Downloads fallback tồn tại nhưng chỉ nhận Blob sau `prepareTask` + `validatePart10`;
  - adapter registry tồn tại;
  - learning mode và learned manifest route tồn tại.
- Test URL:
  - ShareStudy `?stoken=<token>`;
  - ShareStudy `?=<token>`;
  - study hint không chứa token đầy đủ.
- Test DICOM writer:
  - raw/native frame;
  - Explicit VR LE reconstruction;
  - encapsulated JPEG;
  - multipart DICOM.
- Parser byte độc lập kiểm hai file test sinh ra.
- Adapter registry: VRAD, VRPACS, DICOMweb.
- Kiểm tra source không chứa tài khoản/mật khẩu/token PACS đã cung cấp trong quá trình thử.

## Regression test thực tế

`tests/compare_dicom_dirs.py` so output extension với app Python theo:

- StudyInstanceUID
- SeriesInstanceUID
- SOPInstanceUID
- PixelData SHA-256
- Rows / Columns
- SamplesPerPixel
- PhotometricInterpretation
- BitsAllocated / BitsStored / HighBit / PixelRepresentation
- RescaleSlope / RescaleIntercept
- PixelSpacing / SliceThickness
- ImagePositionPatient / ImageOrientationPatient
- NumberOfFrames

Script cần `pydicom`; môi trường build hiện chưa có thư viện này.

## GE ZFP — đã kiểm chứng trên PACS thật

Chạy móc `zfp-hook.js` (bản dùng chung với `_ZFP_HOOK` của app) trên một ca MR
thật của GE Centricity Universal Viewer:

- cấu trúc study: 5 series, 264 ảnh;
- **20 giây đầu sau khi mở viewer: hứng được 128 ảnh**, `mismatched: 0`,
  `dropped: 0` — không khung nào ghép lệch, không ảnh nào bị đẩy khỏi hàng đợi;
- 12 ảnh lấy mẫu đều dựng ra DICOM Part-10 hợp lệ, 0 hỏng, 0 ảnh ngoài danh sách;
- pixel thô đúng kích thước suy từ metadata: 131.072 B (256×256×2) và
  524.288 B (512×512×2);
- đọc lại bằng `pydicom`: `NGUYEN THI PHUONG 1961 F` / `25050532`, MR 2026-05-13,
  series `LOC 3 PLAN` instance 11, `int16` 256×256, 723 mức xám, PixelSpacing
  0.9375, WC/WW 468/936, ImagePositionPatient đầy đủ.

Nghĩa là đường lấy pixel + dựng DICOM đã chạy thật. Phần **chưa** chạy thật là
vòng `runZfpJob` bên trong Chrome (ghi file, nạp lại viewer, đếm tiến độ) — xem
mục dưới.

## Chưa thể xác nhận trong build

Không live-test được portal bệnh viện thật. Chế độ Học site cần kiểm tra trên Chrome đang có quyền truy cập portal thực tế, đặc biệt với POST manifest và signed URL ngắn hạn.

Chrome 151 chặn `--load-extension`, nên không nạp được extension vào trình duyệt
tự động hoá. Hệ quả: các phần chỉ sống trong Chrome mới chỉ được kiểm bằng test
module + static check, chưa chạy thật:

- `runZfpJob`: ghi file, nạp lại tab viewer khi hàng đợi cạn, đếm tiến độ;
- VRPACS link chia sẻ: `buildSyntheticVrpacsRequest` mới chỉ được kiểm bằng
  `tests/test_vrpacs_share.mjs` (khoá đúng byte body và Content-Type), chưa gọi
  thật vào server VRPACS.

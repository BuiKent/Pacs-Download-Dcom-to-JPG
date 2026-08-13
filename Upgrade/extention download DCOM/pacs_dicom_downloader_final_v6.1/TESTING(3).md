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

## Chưa thể xác nhận trong build

Không live-test được portal bệnh viện thật. Chế độ Học site cần kiểm tra trên Chrome đang có quyền truy cập portal thực tế, đặc biệt với POST manifest và signed URL ngắn hạn.

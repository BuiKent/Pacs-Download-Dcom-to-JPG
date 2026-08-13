# PACS DICOM Downloader 6.0 — kiểm tra build

## Đã chạy trong build này

- `node --check` toàn bộ JavaScript.
- Kiểm tra manifest và kiến trúc tĩnh:
  - không `debugger`;
  - không `chrome.downloads`;
  - không required `host_permissions`;
  - host access nằm trong `optional_host_permissions`;
  - download engine dùng `createWritable`;
  - adapter registry tồn tại;
  - deep binary probe/learned URL route tồn tại.
- Test DICOM writer:
  - raw/native frame;
  - source khai Implicit VR nhưng output reconstruction được đóng dấu Explicit VR Little Endian nhất quán;
  - encapsulated JPEG;
  - multipart DICOM.
- Parser độc lập tối thiểu kiểm:
  - preamble `DICM`;
  - File Meta / Transfer Syntax;
  - `SpecificCharacterSet = ISO_IR 192` cho file dựng lại;
  - tên bệnh nhân UTF-8;
  - PixelData.
- Test adapter registry bằng manifest giả lập cho VRAD, VRPACS và DICOMweb.
- Kiểm tra source không chứa các tài khoản/mật khẩu/token đã dùng khi thử PACS.

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

Môi trường build hiện không có `pydicom`, nên script đối chiếu thực tế chưa được chạy ở đây.

## Giới hạn kiểm thử

Không đăng nhập/live-test được các PACS bệnh viện thật từ môi trường build này. Kiểm thử cuối cần chạy trên Chrome của người dùng có quyền truy cập PACS, đặc biệt với portal/vendor proprietary và signed URL ngắn hạn.

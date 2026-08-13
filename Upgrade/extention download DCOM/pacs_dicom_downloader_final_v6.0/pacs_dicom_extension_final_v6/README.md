# PACS DICOM Downloader 6.0

Chrome Extension độc lập để nhận diện PACS theo từng tab và lưu DICOM trực tiếp vào thư mục người dùng chọn.

## Cài đặt

1. Giải nén ZIP.
2. Mở `chrome://extensions`.
3. Bật **Developer mode**.
4. Xóa bản cũ nếu đang cài.
5. Chọn **Load unpacked** và trỏ tới thư mục `pacs_dicom_extension_final_v6`.
6. Pin **DICOM Downloader**.

## Cách dùng

1. Mở portal/PACS và đăng nhập như bình thường nếu cần.
2. Extension nhận diện nhẹ từ URL/navigation. Với site mới, mở Side Panel và bấm **Cho phép** để cấp quyền đúng origin PACS hiện tại.
3. Nếu viewer dùng iframe/origin khác, Side Panel sẽ yêu cầu thêm đúng origin đó khi phát hiện.
4. Chọn thư mục lưu một lần.
5. Khi study sẵn sàng, chọn series và bấm **Tải DICOM**.
6. Có thể chuyển sang tab khác; tracking và job tải của tab PACS vẫn độc lập.

**Dừng theo dõi** chỉ dừng detector của tab hiện tại. **Dừng tải** chỉ hủy job download của tab hiện tại.

## Thư mục đầu ra

```text
<Thư mục đã chọn>/
└── PACS_DICOM/
    └── TÊN BỆNH NHÂN - PATIENT ID - YYYY-MM-DD/
        ├── 01 - <Series>/
        ├── 02 - <Series>/
        └── ...
```

Nếu manifest thiếu tên, ID hoặc ngày chụp, engine cố bổ sung từ DICOM hợp lệ đầu tiên trước khi tạo thư mục.

## Kiến trúc 6.0

- **Per-tab state:** study, tracking, inventory và download job tách theo `tabId`.
- **Adapter registry:** DICOMweb, VRAD, VRPACS và Generic dùng cùng một model/task interface.
- **Download engine:** fetch bytes bằng session hiện tại, kiểm DICOM Part-10 rồi mới ghi bằng File System Access API. Không dùng Chrome Download Manager cho từng slice.
- **Song song có giới hạn:** mặc định 6 instance worker; frame multiframe cũng tải song song có giới hạn.
- **Resume:** file DICOM đã có chỉ được bỏ qua sau khi đọc và validate lại toàn file.
- **DICOMweb fallback:** Retrieve Instance → metadata + frames → dựng DICOM Part-10 nếu PACS không trả file nguyên vẹn.
- **Generic learning:** với response `application/octet-stream` trên tab PACS, extension probe phần đầu response. Pattern nào được xác nhận có `DICM` sẽ được ghi nhớ theo origin/path, không lưu token/query value.
- **History:** study đã tải đủ được ẩn mặc định; có thể tìm lại theo tên, Patient ID hoặc ngày chụp. Tải một phần không làm cả study thành “Đã tải”.

## PACS hỗ trợ

- DICOMweb / OHIF / dcm4chee / Orthanc: QIDO-RS, WADO-RS, WADO-URI, metadata + frames.
- VradViewer: `StudyData/GetStudies`, `GetImage`.
- VRPACS/Telerad: share manifest và WADO image IDs.
- RIS/portal nhiều tầng: login → danh sách phim → popup/tab/iframe viewer → URL/hash đổi hoặc rút gọn → viewer load muộn.
- Vendor lạ có direct DICOM GET: generic binary learning + byte validation.

Viewer chỉ phát JPEG/rendered tiles mà không có DICOM hoặc metadata+frames đủ để dựng lại sẽ không được ghi nhãn thành DICOM gốc.

## Quyền và dữ liệu

- Không có `debugger` permission.
- Không có quyền host bắt buộc toàn cục; site access được xin khi người dùng cho phép trên origin cần dùng.
- Không hard-code tài khoản/mật khẩu.
- Request body của URL login/auth/password/OTP không được lưu.
- Token/query value không được lưu vào recipe học site.
- DICOM đi trực tiếp từ PACS tới máy người dùng; không có server trung gian.

## Kiểm thử đối chiếu với app Python

`tests/compare_dicom_dirs.py` dùng để so hai thư mục DICOM tải từ app Python và extension theo `SOPInstanceUID`, PixelData SHA-256 và các tag hình học/pixel quan trọng.

```bash
python tests/compare_dicom_dirs.py /path/python/DICOM /path/extension/DICOM
```

Script này cần `pydicom` trong môi trường kiểm thử.

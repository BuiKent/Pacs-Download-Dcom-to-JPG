# PACS DICOM Downloader 6.1

Chrome Extension độc lập để theo dõi PACS theo từng tab, nhận diện study/series và lưu DICOM đã kiểm tra.

## Cài đặt

1. Giải nén ZIP.
2. Mở `chrome://extensions`.
3. Bật **Developer mode**.
4. Xóa bản cũ nếu đang cài.
5. Chọn **Load unpacked** và trỏ tới thư mục extension.
6. Khi trang thiết lập mở ra, chọn một trong hai chế độ quyền:
   - **Cho phép một lần:** cấp quyền HTTP/HTTPS một lần cho mọi PACS/site.
   - **Từng site:** chỉ cấp quyền khi theo dõi một PACS mới.

Quyền site và trạng thái theo dõi là hai việc riêng. Có quyền không đồng nghĩa tab tự bị phân tích.

## Cách dùng

1. Mở portal/PACS, đăng nhập và mở phim như bình thường.
2. Mở Side Panel của extension trên đúng tab cần xử lý.
3. Bấm **Theo dõi tab**.
4. Khi study sẵn sàng, chọn series và bấm **Tải DICOM**.
5. Có thể chuyển sang tab khác; tracking và job tải vẫn gắn với tab PACS ban đầu.

Nếu site chưa nhận diện được, bật **Học site**, thao tác **Xem ảnh** trong portal, rồi đánh dấu request phù hợp:
- **DICOM:** endpoint trả trực tiếp DICOM Part-10.
- **Danh sách:** JSON chứa danh sách/URL ảnh. Extension lưu mẫu endpoint theo origin/path và thử trích các URL DICOM từ payload.

Recipe học site không lưu giá trị token/query.

## Lưu file

Đường nhanh dùng File System Access:

- Picker mở sẵn tại **Downloads**.
- Chrome nhớ vị trí bằng picker id `pacs-dicom`.
- Handle thư mục được lưu trong IndexedDB.

Nếu người dùng hủy picker, extension tự chuyển sang chế độ tương thích:

1. fetch DICOM bằng session hiện tại;
2. validate bytes;
3. chỉ sau khi hợp lệ mới đưa Blob đã kiểm tra cho `chrome.downloads` để lưu vào `Downloads/PACS_DICOM/...`.

Chế độ tương thích chậm hơn vì mỗi file đi qua Download Manager, nhưng không để Download Manager tự gọi endpoint PACS.

## Thư mục đầu ra

```text
PACS_DICOM/
└── TÊN BỆNH NHÂN - PATIENT ID - YYYY-MM-DD/
    ├── 01 - <Series>/
    ├── 02 - <Series>/
    └── ...
```

Nếu manifest thiếu tên, ID hoặc ngày chụp, engine cố bổ sung từ DICOM hợp lệ đầu tiên trước khi tạo thư mục.

## Kiến trúc

- Per-tab state/job.
- Adapter registry: DICOMweb, VRAD, VRPACS, Generic.
- File System Access là engine mặc định.
- `chrome.downloads` chỉ là fallback lưu Blob đã validate.
- 6 instance worker mặc định; frame multiframe tải song song có giới hạn.
- Retrieve Instance → metadata + frames cho DICOMweb.
- Binary probe nhẹ cho `application/octet-stream`.
- Learned site recipe theo origin/path, không lưu token value.
- Study tải đủ mới được đánh dấu **Đã tải**; tải một phần vẫn giữ để tải bù.
- History tìm theo tên, Patient ID hoặc ngày chụp.

## Nhận diện ShareStudy

`/Pages/ShareStudy.aspx` hỗ trợ cả:

```text
?stoken=<token>
?token=<token>
?=<token>
```

Token dùng cho study hint chỉ được rút gọn trong state phiên, không lưu toàn bộ vào recipe.

## PACS hỗ trợ

- DICOMweb / OHIF / dcm4chee / Orthanc.
- VradViewer.
- VRPACS/Telerad.
- RIS/portal nhiều tầng, iframe/popup/hash URL.
- Vendor lạ có direct DICOM GET hoặc manifest JSON có thể học qua **Học site**.

Viewer chỉ phát JPEG/rendered tiles mà không có DICOM hoặc metadata+frames đủ để dựng lại sẽ không được ghi nhãn thành DICOM gốc.

## Quyền và dữ liệu

- Không dùng `debugger`.
- Không hard-code tài khoản/mật khẩu.
- Request login/auth/password/OTP không được đưa vào chế độ học.
- Token/query value không lưu vào recipe học site.
- DICOM đi trực tiếp từ PACS đến máy người dùng.

## Regression test

```bash
python tests/compare_dicom_dirs.py /path/python/DICOM /path/extension/DICOM
```

So theo SOPInstanceUID, PixelData SHA-256 và các tag pixel/hình học quan trọng. Script cần `pydicom`.

# Đã hoàn thiện \*\*v6.0\*\* theo hướng kiến trúc mới, không phải vá tiếp v5.

# 

# \[\*\*Tải PACS DICOM Downloader Final v6.0\*\*](sandbox:/mnt/data/pacs\_dicom\_downloader\_final\_v6.0.zip)

# 

# \[README v6](sandbox:/mnt/data/v6\_work/pacs\_dicom\_extension\_final\_v6/README.md) · \[Test report](sandbox:/mnt/data/v6\_work/pacs\_dicom\_extension\_final\_v6/TESTING.md) · \[Changelog](sandbox:/mnt/data/v6\_work/pacs\_dicom\_extension\_final\_v6/CHANGELOG.md)

# 

# Các thay đổi quan trọng đã vào v6:

# 

# \* Bỏ `chrome.downloads` khỏi engine DICOM. PACS response được `fetch` → \*\*kiểm bytes DICOM\*\* → ghi thẳng bằng File System Access.

# \* Không còn tình trạng server trả trang login/HTML nhưng lưu thành `.dcm`.

# \* 6 instance worker mặc định; multiframe cũng tải song song có giới hạn thay vì `for await` tuần tự từng frame.

# \* Job giữ trong RAM và chỉ flush state theo nhịp, không ghi `chrome.storage` hàng nghìn lần.

# \* \*\*Bỏ `debugger` hoàn toàn\*\* khỏi manifest.

# \* Không xin quyền tất cả website khi cài. Site mới chỉ xin đúng origin khi cần.

# \* Adapter được tách thành registry:

# 

# &#x20; \* DICOMweb

# &#x20; \* VRAD

# &#x20; \* VRPACS

# &#x20; \* Generic

# \* Mỗi adapter trả cùng một loại task; adapter không tự lưu file.

# \* Mỗi tab có study/tracking/download job riêng. Chuyển tab không dừng download.

# \* Có riêng \*\*Dừng theo dõi\*\* và \*\*Dừng tải\*\*.

# \* Generic vendor lạ có cơ chế học:

# 

# &#x20; \* quan sát nhẹ trước;

# &#x20; \* gặp `application/octet-stream` đáng nghi mới probe phần đầu;

# &#x20; \* xác nhận `DICM` mới ghi nhớ URL pattern;

# &#x20; \* không cache/hash toàn bộ response như v5.

# \* Pattern học site không lưu token/query value.

# \* DICOM writer sửa các điểm đã review:

# 

# &#x20; \* không ép VR lạ thành `LO`;

# &#x20; \* Transfer Syntax và dataset encoding nhất quán;

# &#x20; \* file dựng lại dùng `ISO\_IR 192` + UTF-8;

# &#x20; \* multipart tìm boundary trên bytes, không decode toàn PixelData thành Latin-1;

# &#x20; \* raw Big Endian không chắc chắn thì từ chối thay vì sinh DICOM sai.

# \* Phân biệt \*\*DICOM gốc\*\* và \*\*DICOM dựng lại từ metadata+frames\*\* trong tiến độ.

# \* Resume chỉ skip file cũ sau khi \*\*đọc và validate toàn DICOM\*\*, không chỉ kiểm `DICM` ở offset 128.

# \* Nếu chỉ chọn một vài series thì \*\*không đánh dấu toàn study là đã tải\*\*.

# \* Generic không biết tổng số ảnh thì chỉ báo \*\*Đã lưu\*\*, không tự ẩn study.

# \* Chỉ study xác định tải đầy đủ mới thành \*\*Đã tải\*\* và được ẩn mặc định.

# \* History tìm theo tên/Patient ID/ngày; giảm nguy cơ nhầm hai study cùng bệnh nhân cùng ngày.

# \* Folder vẫn đúng:

# &#x20; `TÊN - PATIENT ID - YYYY-MM-DD`

# \* Nếu manifest thiếu tên/ID/ngày, v6 lấy lại từ DICOM đầu tiên trước khi tạo folder.

# \* UI đã đổi sang \*\*status-first\*\*, series ở dưới, download bar cố định đáy; ca đã tải không xổ lại toàn bộ series trừ khi bấm \*\*Hiện lại series\*\*.

# 

# Tôi cũng bổ sung bộ regression test `compare\_dicom\_dirs.py` để sau này lấy \*\*cùng một ca tải bằng app Python và extension\*\*, đối chiếu theo SOPInstanceUID, SHA-256 PixelData và các tag như orientation, position, spacing, bit depth, rescale... Đây là phần quan trọng để không còn tiêu chí “mở được file là coi như đúng”.

# 

# Build hiện đã qua:

# 

# ```text

# Static architecture        OK

# JavaScript syntax          OK

# Manifest/resources         OK

# UI references              OK

# VRAD adapter               OK

# VRPACS adapter             OK

# DICOMweb adapter           OK

# Raw DICOM writer           OK

# JPEG encapsulated DICOM    OK

# Multipart parser           OK

# Independent byte validator OK

# ZIP integrity              OK

# ```

# 

# SHA-256 ZIP:

# 

# ```text

# 55740b8e2edb1c7263ef36f1197eef180a7641155bc2b963efee6bcd2b693130

# ```

# 

# Cài sạch bằng cách \*\*Remove extension cũ\*\* → giải nén ZIP → `chrome://extensions` → \*\*Load unpacked\*\* → chọn `pacs\_dicom\_extension\_final\_v6`.

# 

# Điểm tôi vẫn không giả vờ bảo đảm là các portal proprietary bệnh viện chưa thể live-test từ môi trường này. Nhưng khác v5, nếu gặp vendor lạ thì v6 đã có đường \*\*binary probe → validate DICOM → học pattern\*\*, thay vì phải lập tức thêm regex/vendor adapter hoặc bật CDP nặng.



PACS DICOM Downloader 6.0
===

Chrome Extension độc lập để nhận diện PACS theo từng tab và lưu DICOM trực tiếp vào thư mục người dùng chọn.

## Cài đặt

1. Giải nén ZIP.
2. Mở `chrome://extensions`.
3. Bật **Developer mode**.
4. Xóa bản cũ nếu đang cài.
5. Chọn **Load unpacked** và trỏ tới thư mục `pacs\_dicom\_extension\_final\_v6`.
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
└── PACS\_DICOM/
    └── TÊN BỆNH NHÂN - PATIENT ID - YYYY-MM-DD/
        ├── 01 - <Series>/
        ├── 02 - <Series>/
        └── ...
```

Nếu manifest thiếu tên, ID hoặc ngày chụp, engine cố bổ sung từ DICOM hợp lệ đầu tiên trước khi tạo thư mục.

## Kiến trúc 6.0

* **Per-tab state:** study, tracking, inventory và download job tách theo `tabId`.
* **Adapter registry:** DICOMweb, VRAD, VRPACS và Generic dùng cùng một model/task interface.
* **Download engine:** fetch bytes bằng session hiện tại, kiểm DICOM Part-10 rồi mới ghi bằng File System Access API. Không dùng Chrome Download Manager cho từng slice.
* **Song song có giới hạn:** mặc định 6 instance worker; frame multiframe cũng tải song song có giới hạn.
* **Resume:** file DICOM đã có chỉ được bỏ qua sau khi đọc và validate lại toàn file.
* **DICOMweb fallback:** Retrieve Instance → metadata + frames → dựng DICOM Part-10 nếu PACS không trả file nguyên vẹn.
* **Generic learning:** với response `application/octet-stream` trên tab PACS, extension probe phần đầu response. Pattern nào được xác nhận có `DICM` sẽ được ghi nhớ theo origin/path, không lưu token/query value.
* **History:** study đã tải đủ được ẩn mặc định; có thể tìm lại theo tên, Patient ID hoặc ngày chụp. Tải một phần không làm cả study thành “Đã tải”.

## PACS hỗ trợ

* DICOMweb / OHIF / dcm4chee / Orthanc: QIDO-RS, WADO-RS, WADO-URI, metadata + frames.
* VradViewer: `StudyData/GetStudies`, `GetImage`.
* VRPACS/Telerad: share manifest và WADO image IDs.
* RIS/portal nhiều tầng: login → danh sách phim → popup/tab/iframe viewer → URL/hash đổi hoặc rút gọn → viewer load muộn.
* Vendor lạ có direct DICOM GET: generic binary learning + byte validation.

Viewer chỉ phát JPEG/rendered tiles mà không có DICOM hoặc metadata+frames đủ để dựng lại sẽ không được ghi nhãn thành DICOM gốc.

## Quyền và dữ liệu

* Không có `debugger` permission.
* Không có quyền host bắt buộc toàn cục; site access được xin khi người dùng cho phép trên origin cần dùng.
* Không hard-code tài khoản/mật khẩu.
* Request body của URL login/auth/password/OTP không được lưu.
* Token/query value không được lưu vào recipe học site.
* DICOM đi trực tiếp từ PACS tới máy người dùng; không có server trung gian.

## Kiểm thử đối chiếu với app Python

`tests/compare\_dicom\_dirs.py` dùng để so hai thư mục DICOM tải từ app Python và extension theo `SOPInstanceUID`, PixelData SHA-256 và các tag hình học/pixel quan trọng.

```bash
python tests/compare\_dicom\_dirs.py /path/python/DICOM /path/extension/DICOM
```

Script này cần `pydicom` trong môi trường kiểm thử.




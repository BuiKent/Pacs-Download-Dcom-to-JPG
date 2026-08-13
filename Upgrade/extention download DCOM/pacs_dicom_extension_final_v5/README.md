# PACS DICOM Downloader 5.0

Chrome Extension độc lập để nhận diện PACS theo từng tab và tải DICOM trực tiếp từ phiên trình duyệt hiện tại.

## Cài đặt

1. Giải nén ZIP.
2. Mở `chrome://extensions`.
3. Bật **Developer mode**.
4. Xóa bản cũ nếu đang cài.
5. Chọn **Load unpacked** và trỏ tới thư mục `pacs_dicom_extension_final_v5`.
6. Pin **DICOM Downloader**.

## Cách dùng

- Mở portal/PACS và đăng nhập như bình thường nếu cần.
- Extension tự nhận diện tab có dấu hiệu PACS và theo dõi riêng từng tab.
- Có thể chuyển tab; tab PACS vẫn tiếp tục theo dõi.
- Khi study sẵn sàng, bấm icon extension trên tab đó, chọn series và **Tải DICOM**.
- **Dừng theo dõi** chỉ dừng recorder của tab hiện tại.
- **Dừng tải** chỉ dừng download của tab hiện tại.
- Ca đã tải đủ được ẩn mặc định. Chọn **Hiện lại** nếu muốn tải lại.
- **Lịch sử tải** được thu gọn, có tìm theo tên, Patient ID hoặc ngày chụp.

## Thư mục tải

`Downloads/PACS_DICOM/Tên - Patient ID - Ngày chụp/Series/...`

Series có thêm số thứ tự để tránh đè file khi PACS có hai series trùng SeriesNumber/tên.

## Kiểu PACS hỗ trợ

- DICOMweb: QIDO-RS, WADO-RS, WADO-URI, metadata + frames.
- VradViewer: `StudyData/GetStudies`, `GetImage`.
- VRPACS/Telerad: share manifest và WADO URL.
- Portal nhiều tầng: login/portal → popup/tab/iframe viewer → hash/URL rút gọn → viewer tải chậm.
- Generic recorder: bắt DICOM Part-10 đã đi qua network của tab, kể cả response binary/WebSocket phù hợp.

Nếu DICOM đã đi qua Chrome, extension ưu tiên lưu bản đã bắt. DICOM chưa đi qua Chrome sẽ dùng endpoint/manifest khi có thể. Viewer chỉ phát JPEG/rendered image sẽ không được ghi nhãn thành DICOM gốc.

## Dữ liệu

- Không hard-code tài khoản hoặc mật khẩu.
- Không lưu request body của URL login/auth/password/OTP.
- Lịch sử chỉ lưu metadata cần để nhận biết study đã tải.
- DICOM bắt tạm được lưu trong storage cục bộ của extension và dọn theo vòng đời tab/bộ đệm.
- Không có server trung gian.

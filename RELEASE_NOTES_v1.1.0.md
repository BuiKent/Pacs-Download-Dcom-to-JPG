# DICOM/JPG Downloader & Viewer v1.1.0

Ngày phát hành: 30/07/2026

## Kiến trúc

- Backend tải RIS/DICOM tiếp tục dùng Python và Playwright đã ổn định.
- UI mặc định chuyển sang WebView2 (Edge Chromium có sẵn trên Windows), không
  đóng gói Electron và không mở dịch vụ ra mạng LAN.
- Backend chỉ bind `127.0.0.1` trên cổng ngẫu nhiên. API/ảnh yêu cầu token ngẫu
  nhiên theo mỗi lần chạy, kiểm tra Host/Origin và không nhận đường dẫn file tùy ý.
- Toàn bộ Cornerstone3D, CSS và worker nằm trong EXE; không tải CDN khi sử dụng.
- Chạy `Dicom_Downloader_App.exe --classic` để trở lại UI Tkinter cũ.

## Viewer mới

- Ảnh tự vừa khung; chuột giữa pan, chuột phải zoom, con lăn đổi lát.
- Toolbar gọn bằng icon: window/level, bàn tay, zoom, đo dài, đo góc, ROI ellipse,
  ROI tự do, reset, đảo màu, cine, chụp ảnh và lưu annotation.
- Bố cục một khung, so sánh hai series, montage 6 lát và montage 8 lát.
- MPR axial/coronal/sagittal liên kết bằng hình học DICOM.
- Volume rendering 3D toàn màn hình riêng, không ép giao diện thành bốn ô.
- Lưu/đọc lại measurement và ROI trong `viewer-annotations.json`.
- Tính thể tích ROI thủ công bằng tổng diện tích lát nhân khoảng cách lát.

## Điều kiện MPR/3D

MPR và 3D chỉ bật khi series:

- có ít nhất 101 lát;
- đủ Rows/Columns, PixelSpacing, ImagePositionPatient,
  ImageOrientationPatient và FrameOfReferenceUID;
- các vector định hướng trực chuẩn;
- đủ file theo manifest;
- tọa độ lát tăng và khoảng cách lát đồng nhất trong dung sai.

Nếu không đạt, series vẫn xem ở stack/montage nhưng MPR/3D bị khóa. Ứng dụng
không suy diễn khoảng cách từ tên file hay InstanceNumber.

## Tải và lưu phim

- Tự tìm ca MRI/CT theo mã bệnh nhân, có bước chọn study trước khi tải.
- Dùng lại phiên RIS trong RAM tối đa 30 phút; hết phiên mới đăng nhập lại.
- Tải và giữ mọi T1 3D sau tiêm và T1 3D không tiêm đủ điều kiện thành các gói
  riêng, chống ghi đè bằng SeriesInstanceUID.
- Không tự xóa DICOM. Việc xóa bản gốc thuộc quyết định của người dùng sau khi
  tự kiểm tra bản chuyển đổi.

## Kiểm thử release

- Backend/security/manifest: 7 test.
- Pipeline, MPR engine, session RIS và layout classic: toàn bộ test hồi quy.
- Frontend build Vite và test JavaScript.
- WebView2 smoke test bằng phantom không có dữ liệu bệnh nhân:
  stack 1 canvas, MPR 3 canvas, volume 3D 1 canvas.

## Giới hạn

- 3D là volume rendering từ chuỗi T1, chưa phải AI tự phát hiện u.
- Thể tích u hiện dựa trên ROI do người dùng vẽ.
- Series JPG không có geometry vẫn cho đo pixel, nhưng không được coi là mm.
- Đây chưa phải thiết bị y tế được chứng nhận thay thế workstation chẩn đoán.

# DCom JPG PACS - MPR Embedded

Ngày build: 28/07/2026

## Thay đổi chính

- MPR không còn mở cửa sổ phụ.
- Chuyển trực tiếp giữa bố cục `2D` và `MPR` trong màn hình chính.
- MPR hiển thị ba mặt phẳng axial, coronal và sagittal; 3D ROI là chế độ riêng.
- Panel tải có thể thu/hiện mà không mất nội dung đã nhập hoặc nhật ký.
- Khi vào MPR, panel tải tự thu để tăng diện tích quan sát.
- Volume của cùng series được giữ trong bộ nhớ khi chuyển qua lại 2D/MPR.
- Chuyển series trong lúc ở MPR nạp đúng volume mới; series không có gói MPR
  tự trở về 2D.
- Phím tắt được định tuyến đúng theo bố cục đang dùng.
- Kích thước cửa sổ ban đầu tự phù hợp với màn hình.

## Công cụ hiện có

- Crosshair liên kết ba mặt phẳng.
- Cuộn lát; zoom bằng `Ctrl + lăn`; pan bằng chuột phải.
- Điều chỉnh sáng và tương phản.
- Đo chiều dài theo mm.
- ROI ellipse và ROI đa giác; diện tích theo cm².
- Tính thể tích ROI axial theo mL.
- Dựng mô hình 3D nhẹ từ các ROI axial, có xoay/nghiêng.
- Tự lưu phép đo và ROI trong `mpr-roi.json`.

## Không thuộc bản này

- Tự động nhận diện/phân đoạn u.
- Volume rendering toàn bộ mô não kiểu ray casting GPU.
- MIP/MinIP, MPR xiên, brush/eraser, DICOM SEG, RTSTRUCT hoặc STL.

Khung `3D U TỪ ROI AXIAL` là mô hình từ ROI do người dùng vẽ, không phải kết
quả AI và không tự xác định bờ u.

## Nghiệm thu

- 6/6 test tự động đạt.
- Kiểm tra UI nhúng: không sinh `Toplevel`, giữ cache khi đổi bố cục và panel
  tải thu/hiện đúng.
- Kiểm tra ở kích thước 1024x640: nút điều hướng và các toolbar không tràn.
- MRI thử thật: T1 sau tiêm 180 lát, volume 180x512x512, khoảng 45 MiB RAM cho
  mảng voxel, nạp khoảng 0,36 giây trên máy build.
- EXE PyInstaller khởi động thành công sau build.

## Lưu ý sử dụng

- Chỉ series có `mpr-volume.json` mới bật nút `MPR`.
- Gói MPR được tạo cho mọi T1 3D sau tiêm và không tiêm đủ trên 100 lát hợp lệ.
- Ứng dụng không tự xóa DICOM.
- Kết quả đo phụ thuộc geometry trong manifest và đường ROI của người dùng;
  đây không phải phần mềm đã được chứng nhận thay thế workstation chẩn đoán.

## Bổ sung sau review UI/geometry

- Sửa coronal/sagittal bị lộn đầu-chân: superior ở trên, inferior ở dưới.
- Ánh xạ lại crosshair sau khi đảo trục hiển thị.
- Thêm nhãn hướng bệnh nhân `R/L/A/P/S/I` từ DICOM orientation.
- Viewport đang thao tác có viền xanh; phím mũi tên đi theo viewport đó.
- Thêm đo góc ba điểm theo độ.
- Thêm hoàn tác annotation và ẩn/hiện số đo/ROI.
- Xóa annotation chỉ tác động tới lát của mặt phẳng đang chọn.
- Panel tải chỉ tự hiện lại nếu MPR là tác nhân tự thu panel.

Test hồi quy đã kiểm tra orientation, crosshair, nhãn hướng, đo góc, undo,
xóa đúng mặt phẳng, cache volume, không mở `Toplevel` và trạng thái panel.
Ca MRI thật T1 sau tiêm 180 lát đã được mở lại để kiểm tra trực quan ba mặt
phẳng sau sửa.

## RC2 - tái sử dụng phiên RIS an toàn

- Cookie/local storage của RIS chỉ được giữ trong RAM theo từng bệnh viện, tối đa 30 phút không
  hoạt động.
- Lần tìm bệnh nhân tiếp theo dùng lại phiên; khi RIS trả `401/403` hoặc chuyển về login, ứng dụng
  tự đăng nhập lại một lần.
- Đóng ứng dụng sẽ xóa toàn bộ phiên RIS trong RAM; không tạo file cookie/token.
- Study có Patient ID tường minh không khớp mã yêu cầu bị loại.
- Bỏ fallback lấy Study UID tùy ý từ HTML trang reading vì không chứng minh được thuộc bệnh nhân.
- Đổi nhãn `TÌM & TẢI MRI / CT SỌ NÃO` thành `TÌM & TẢI MRI / CT`, đúng với bộ lọc modality
  hiện có.
- Ghi log lỗi Chrome thay vì âm thầm chuyển trình duyệt; sau một lần Chrome bị Windows từ chối,
  app dùng thẳng Edge cho các study tiếp theo trong cùng phiên.


## RC3 - viewer gọn theo ngữ cảnh

- Thanh 2D/MPR dùng icon và tooltip cho thao tác thường gặp; thao tác hiếm/khó vẫn giữ tiêu đề.
- Thêm bàn tay pan bằng chuột trái và hai chế độ hiện toàn bộ/lấp đầy viewport.
- Bỏ ô 3D trống khỏi layout MPR; ba mặt phẳng dùng ba cột bằng nhau.
- 3D chỉ bật khi có ROI axial và mở thành workspace riêng; toolbar MPR không hiển thị trong chế độ 3D.
- Test hồi quy bao phủ layout ba cột, trạng thái nút 3D, chuyển MPR/3D, pan và contain/cover.


## Giữ toàn bộ T1 3D sau tiêm và không tiêm

- Không còn chọn một candidate duy nhất; chuyển mọi series T1 3D đủ điều kiện.
- Folder có loại T1 và hash 10 ký tự của SeriesInstanceUID để chống ghi đè khi trùng tên/số series.
- Từng gói MPR chỉ chuyển một lần; series khác vẫn chuyển theo luồng thường.
- Test hồi quy xác nhận hai series cùng tên/số nhưng khác UID đều có đủ 101 lát.

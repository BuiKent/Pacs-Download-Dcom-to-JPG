# DCom JPG PACS - MPR Embedded

Ngày build: 28/07/2026

## Thay đổi chính

- MPR không còn mở cửa sổ phụ.
- Chuyển trực tiếp giữa bố cục `2D` và `MPR + ROI 3D` trong màn hình chính.
- MPR hiển thị đồng thời axial, coronal, sagittal và mô hình 3D từ ROI axial.
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

- Chỉ series có `mpr-volume.json` mới bật nút `MPR + ROI 3D`.
- Gói MPR ưu tiên T1 3D sau tiêm; fallback T1 3D không tiêm; yêu cầu trên
  100 vị trí lát hợp lệ.
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

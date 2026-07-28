# Scope và kế hoạch MPR/PACS nhẹ cho u não

## Mục tiêu

Tận dụng JPG để xem lại T1 3D theo ba mặt phẳng, đo tổn thương, đánh dấu ROI,
tính thể tích và dựng mô hình 3D vùng ROI mà không cần Orthanc hoặc server
local.

## Scope đã triển khai

- Quét header DICOM và gom theo `SeriesInstanceUID`.
- Ưu tiên T1 3D sau tiêm; fallback T1 3D không tiêm.
- Ngưỡng mặc định: ít nhất 101 vị trí lát duy nhất.
- Loại localizer, key image, subtraction, MIP, SWAN/SWI/phase, DWI/ADC,
  FLAIR và T2.
- Kiểm tra geometry: kích thước, PixelSpacing, ImageOrientationPatient,
  ImagePositionPatient, FrameOfReferenceUID và độ đều khoảng cách lát.
- Sắp lát theo tọa độ không gian, không theo tên file.
- Chuyển series được chọn bằng một cửa sổ cường độ chung, JPG quality 100.
- Ghi `mpr-volume.json` không chứa PatientName/PatientID.
- Không chuyển series T1 được chọn lần thứ hai bằng converter thường.
- Viewer ba mặt phẳng liên kết bằng crosshair.
- Zoom, pan, sáng, tương phản và cuộn lát.
- Đo chiều dài theo mm.
- ROI ellipse và ROI đa giác theo cm².
- Thể tích ROI axial theo mL.
- Mô hình 3D nhẹ từ mask ROI axial, có xoay/nghiêng.
- Tự lưu và nạp lại phép đo/ROI.
- Không tự xóa DICOM.

## Ngoài scope release này

- Tự động nhận diện hoặc tự phân đoạn khối u.
- Volume rendering toàn bộ mô não theo transfer function như workstation GPU.
- MPR xiên/curved MPR.
- DICOM SEG, RTSTRUCT, STL/OBJ.
- Đồng bộ annotation lên PACS bệnh viện.
- Chứng nhận thiết bị y tế hoặc thay thế workstation chẩn đoán.

## Tiêu chí release

- T1 sau tiêm thắng T1 không tiêm khi cả hai cùng có.
- T1 không tiêm được chọn khi không có series sau tiêm.
- Series 100 lát hoặc thiếu geometry không tạo MPR.
- Không chọn nhầm các series dẫn xuất/không phải T1.
- JPG/manifest nạp lại được khi không còn DICOM.
- Axial/coronal/sagittal đúng kích thước và tỷ lệ pixel.
- Đo chiều dài dùng spacing đúng từng mặt phẳng.
- ROI dùng diện tích vật lý; thể tích dùng diện tích axial nhân khoảng cách lát.
- Annotation được ghi atomically và lỗi annotation không chặn mở volume.
- Luồng JPG thường giữ nguyên cho các series không được chọn.

## Kết quả pilot hiện tại

- Test tổng hợp: 5/5 PASS.
- MRI thật: tự chọn đúng `3D AX T1 BRAVO+c`, 180 lát.
- Volume JPG nạp lại: `180 x 512 x 512`.
- Gói JPG quality 100: khoảng 12.1 MiB trong lần test hiện tại.
- UI MPR, ROI, tính thể tích và canvas 3D đã chạy end-to-end.

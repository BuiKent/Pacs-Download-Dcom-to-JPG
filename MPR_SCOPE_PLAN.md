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

## Kế hoạch phát triển tiếp theo: Volume Rendering và AI

### Giai đoạn VR1 — Volume rendering toàn bộ T1 3D

Đầu vào là volume uint8 đã nạp từ `MPR_*.jpg` và `mpr-volume.json`. Không cần
phân đoạn trước.

Tính năng:

- GPU ray casting; CPU/downsample fallback.
- Composite, MIP và MinIP.
- Transfer function cường độ → màu/độ trong suốt.
- Preset MRI T1.
- Điều chỉnh threshold, opacity và shading.
- Crop box sáu mặt và clipping plane.
- Xoay, zoom, pan, reset camera.
- Chụp ảnh 3D.
- Tự giảm chất lượng trong lúc xoay, trả lại chất lượng đầy đủ khi dừng.

Yêu cầu hiệu năng:

- Volume `180 x 512 x 512` uint8 chiếm khoảng 45 MiB trước các texture/gradient
  phụ trợ.
- Nạp volume một lần và cache; không đọc lại JPG khi chuyển chế độ.
- Tính transfer function trên GPU nếu có.
- Module VR là tùy chọn để ứng dụng tải/xem 2D vẫn nhẹ.

Giới hạn: volume rendering chỉ hiển thị voxel theo cường độ, không tự biết voxel
nào thuộc u.

### Giai đoạn SEG1 — Phân đoạn bán tự động

Đây là lựa chọn ưu tiên trước AI hoàn toàn.

- Người dùng chấm điểm/brush bên trong u và vùng nền.
- Region growing hoặc grow-from-seeds tạo mask gợi ý 3D.
- Brush, eraser, fill, giữ đảo và xóa đảo nhỏ.
- Nội suy ROI giữa các lát đã đánh dấu.
- Người dùng kiểm tra và sửa trên axial/coronal/sagittal.
- Tính thể tích từ mask voxel.
- Tạo mô hình surface 3D, làm mượt có kiểm soát.
- Lưu mask riêng, không sửa JPG nguồn.
- Xuất mask/mesh ở bước sau nếu cần.

### Giai đoạn AI1 — Tự động phân đoạn phần u ngấm thuốc

Chỉ chạy khi có T1 3D sau tiêm. Không dùng T1 không tiêm làm đầu vào thay thế
âm thầm.

Yêu cầu:

- Xác định nhãn mục tiêu: phần u ngấm thuốc, không phải toàn bộ u/phù.
- Giữ một volume 3D nhất quán về spacing và intensity normalization.
- Model 3D được huấn luyện/fine-tune trên dữ liệu cùng loại.
- Inference cục bộ bằng ONNX Runtime hoặc MONAI/PyTorch.
- Hiển thị kết quả như gợi ý; người dùng luôn có thể sửa.
- Ghi rõ phiên bản model, ngưỡng và trạng thái đã/chưa được người dùng xác nhận.
- Test riêng ca sau mổ, hoại tử, xuất huyết, màng cứng/mạch máu ngấm thuốc và
  ảnh có nhiễu chuyển động.

### Giai đoạn AI2 — Phân đoạn đa thành phần

Muốn nhận diện whole tumor, phù, phần không ngấm thuốc và lõi hoại tử cần ưu
tiên bốn volume đồng đăng ký:

- T1.
- T1 sau tiêm.
- T2.
- FLAIR.

Pipeline phải tự nhận diện xung, resample, registration, chuẩn hóa cường độ và
kiểm tra tương quan hình học trước inference. Nếu thiếu xung thì model phải báo
không đủ đầu vào, không suy diễn rằng T1 thường tương đương T1 sau tiêm.

### Nghiệm thu AI

- Có bộ ca đã được chuyên gia vẽ chuẩn.
- Đánh giá Dice, Hausdorff distance, sai số thể tích và tỷ lệ ca thất bại.
- Tách tập test theo máy chụp/cơ sở và không trùng dữ liệu huấn luyện.
- Kiểm tra trực quan mọi kết quả trước khi ghi là đã xác nhận.
- Không tự động dùng mask AI để quyết định lâm sàng.

## UI hợp nhất kiểu PACS

### Trạng thái triển khai

Đã triển khai trong workspace chính:

- Không còn mở `Toplevel` khi vào MPR.
- Có chuyển bố cục `2D / MPR + ROI 3D` trên thanh chung.
- MPR gồm axial, coronal, sagittal và mô hình 3D ROI trong cùng màn hình.
- Panel tải có thể thu/hiện mà không mất dữ liệu biểu mẫu.
- Khi vào MPR panel tải tự thu để tăng diện tích quan sát.
- Volume được cache khi đổi qua lại 2D/MPR của cùng series.
- Chuyển series khi đang ở MPR sẽ nạp đúng volume mới; series không có manifest
  tự trở về 2D.
- Phím tắt được định tuyến theo layout, không còn điều khiển nhầm canvas 2D đang ẩn.

Phần `3D volume rendering` toàn volume, brush/eraser, góc đo, MIP/MinIP và AI
segmentation vẫn thuộc các giai đoạn sau, không được gắn nhãn như đã có.

### Vấn đề của bản cũ

Nút `MPR & u não` mở một cửa sổ `Toplevel` riêng. Cách này hoạt động về mặt
kỹ thuật nhưng có các nhược điểm:

- Mất ngữ cảnh series đang xem.
- Toolbar 2D và toolbar MPR tách rời.
- Chuyển qua lại giữa hai cửa sổ.
- Không giữ liên tục trạng thái crosshair/window/zoom/tool.
- Khó mở rộng VR và segmentation mà không sinh thêm cửa sổ.

### Kiến trúc giao diện đích

Chỉ dùng một cửa sổ chính. Phần viewer thay đổi layout, không mở cửa sổ mới:

```text
┌───────────────────────────────────────────────────────────────┐
│ Series | 2D | MPR | 3D | Pan | W/L | Zoom | Length | ROI ... │
├────────────┬──────────────────────────────────────────────────┤
│ Series/    │                                                  │
│ thumbnails│        VÙNG VIEWER THAY ĐỔI LAYOUT               │
│            │                                                  │
│            │  2D: một viewport                                │
│            │  MPR: axial + coronal + sagittal + 3D            │
│            │  3D: viewport lớn + transfer function            │
├────────────┴──────────────────────────────────────────────────┤
│ Series · lát · spacing · kích thước đo · diện tích · thể tích │
└───────────────────────────────────────────────────────────────┘
```

Panel tải bên trái hiện tại chuyển thành panel có thể thu gọn. Khi vào MPR/3D,
viewer được dùng gần toàn bộ chiều rộng.

### Toolbar thống nhất

Nhóm điều hướng:

- Crosshair.
- Cuộn lát/cine.
- Pan.
- Zoom.
- Window/level.
- Fit/reset.

Nhóm đo:

- Length.
- Góc.
- Ellipse ROI.
- Polygon ROI.
- Brush/eraser.
- Xóa annotation được chọn.
- Hiện/ẩn annotation.

Nhóm volume:

- Layout 2D.
- Layout MPR.
- 3D volume rendering.
- 3D segmentation.
- Crop/clipping.
- MIP/MinIP/composite.

Không hiển thị công cụ ở cửa sổ khác. Những chức năng không dùng được cho
series hiện tại sẽ disabled kèm tooltip giải thích.

### Trạng thái dùng chung

Một `ViewerSession` duy nhất giữ:

- Series/volume đang mở.
- Crosshair voxel.
- Window/level.
- Zoom/pan/camera theo viewport.
- Measurements.
- ROI/mask.
- Mode 2D/MPR/3D.
- Trạng thái đã sửa/chưa lưu.

Khi đổi layout, dữ liệu và annotation không được nạp lại hoặc mất.

### Hiệu năng và độ mượt

- Load stack JPG sang NumPy ở background thread.
- Cache volume đã nạp; giới hạn cache theo dung lượng.
- Chỉ dựng lại viewport bị thay đổi.
- Debounce kéo slider/crosshair.
- Không tạo `PhotoImage` mới cho viewport không đổi.
- 3D mesh/AI chạy worker, UI chỉ nhận kết quả hoàn tất.
- Trong lúc xoay 3D dùng bản downsample; khi thả chuột render lại bản đầy đủ.

### Trình tự refactor UI

1. Tách logic viewer khỏi `App` thành `ViewerSession`.
2. Thay canvas 2D hiện tại bằng `ViewerWorkspace` nhúng trong cột phải.
3. Chuyển ba `MprPane` từ `Toplevel` vào `ViewerWorkspace`.
4. Tạo layout switcher 2D/MPR/3D.
5. Hợp nhất toolbar và annotation store.
6. Làm panel tải/series có thể thu gọn.
7. Test resize, DPI, màn hình 1366x768 và đa màn hình.
8. Sau khi UI hợp nhất ổn định mới gắn VR/segmentation/AI.

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

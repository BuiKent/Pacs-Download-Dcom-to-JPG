# Công cụ tải ảnh DICOM → JPG chất lượng cao

Tải toàn bộ ảnh (mọi series/xung, mọi lát cắt) từ trang xem DICOM (VradViewer)
rồi chuyển sang JPG chất lượng cao. **Không dùng API AI**, chạy hoàn toàn trên máy.

Giao diện gồm **2 cột**: bên trái để tải, bên phải là **trình xem ảnh tích hợp**.

## Cách dùng nhanh (có giao diện)

1. Nhấp đúp **`run_app.bat`** (hoặc chạy `python dcom_downloader_app.py`).
2. **Dán LINK viewer** còn hạn vào ô trên cùng.
   - Link dạng: `http://113.160.173.210:7198/Viewer/Index?...`
   - Lấy bằng cách mở trang xem ảnh, copy đường link trên thanh địa chỉ.
3. Chọn thư mục lưu (đã điền sẵn). **Mặc định đã để chất lượng cao nhất (JPG=100).**
4. Bấm **BẮT ĐẦU TẢI**. Xem tiến độ ở khung nhật ký.
5. Tải xong, ảnh **tự nạp sang trình xem bên phải** — chọn xung, cuộn xem, xem phim.

## Trình xem ảnh (cột phải)

- **Xung (series):** chọn từng chuỗi ảnh trong ô danh sách.
- **Cuộn lát cắt:** kéo thanh trượt, bấm ◀ ▶, hoặc **lăn chuột** trên ảnh.
- **▶ Phim:** chạy cine tự động qua các lát (bấm lại để dừng; phím Space).
- **Phóng to/thu nhỏ / Vừa khung:** hoặc **Ctrl + lăn chuột** để zoom.
- **Sửa nhanh:** Xoay 90°, Lật ngang/dọc, Đảo màu, thanh **Sáng**/**Tương phản**.
- **Lưu ảnh...:** lưu đúng ảnh đang xem (kèm chỉnh sửa) ra PNG/JPG.
- Muốn xem lại thư mục ảnh cũ: bấm **Nạp thư mục ảnh...** rồi trỏ tới thư mục
  (chọn thư mục `Tai_ve_...` hoặc thư mục `JPG` đều được).
- Phím tắt: **←/→** đổi lát, **Space** bật/tắt phim.

## MPR và đo u não

Sau khi tải xong, ứng dụng quét header DICOM và tạo gói MPR cho **tất cả**
series T1 3D sau tiêm và T1 3D không tiêm đủ điều kiện:

1. Mỗi series phải có **trên 100 vị trí lát duy nhất**.
2. Phải có đủ geometry, cùng kích thước/hướng và khoảng cách lát đủ đều.
3. T1 sau tiêm và T1 không tiêm được giữ thành các gói riêng; không còn cơ chế chọn một xung và bỏ xung còn lại.
4. Tên folder có nhãn T1_POST/T1_PRE và mã rút gọn từ SeriesInstanceUID, nên hai xung trùng tên/số series không ghi đè nhau.

Các series còn lại vẫn chuyển JPG theo luồng cũ. Series MPR được chuyển một
lần với JPG quality 100, một cửa sổ cường độ chung cho toàn volume và file
`mpr-volume.json`. Ứng dụng không tự xóa DICOM.

Khi chọn đúng series, nút **MPR** sẽ sáng. Bấm nút này để đổi ngay
vùng xem chính từ **2D** sang **MPR**; ứng dụng không mở cửa sổ phụ:

- Ba mặt phẳng **AXIAL / CORONAL / SAGITTAL** liên kết bằng crosshair.
- Coronal và sagittal hiển thị theo quy ước PACS: phía trên là **S** (superior),
  phía dưới là **I** (inferior). Các nhãn **R/L/A/P/S/I** màu vàng ở mép ảnh
  giúp kiểm tra hướng bệnh nhân, kể cả series chụp hơi xiên.
- Panel tải bên trái tự thu gọn để dành chỗ cho ảnh; bấm **Hiện tải** nếu cần
  mở lại mà không mất link, thư mục hoặc nhật ký.
- Bấm **2D** để quay về trình xem một mặt phẳng. Khi trở lại MPR của cùng
  series, volume và các ROI đang có được giữ nguyên, không phải đọc lại JPG.
- Lăn chuột để đổi lát; **Ctrl + lăn chuột** để zoom.
- Giữ **chuột phải** và kéo để pan.
- Thanh **Sáng / Tương phản** áp dụng đồng thời cho ba mặt phẳng.
- **Đo dài:** kéo từ điểm đầu đến điểm cuối; kết quả hiển thị theo mm.
- **Đo góc:** bấm ba điểm theo thứ tự cạnh thứ nhất → đỉnh → cạnh thứ hai;
  kết quả hiển thị theo độ.
- **ROI ellipse:** kéo hình ellipse bao quanh tổn thương.
- **ROI đa giác:** bấm lần lượt quanh bờ u, nhấp đúp hoặc bấm
  **Kết thúc ROI** để khép vùng.
- ROI hiển thị diện tích theo cm². ROI vẽ trên nhiều lát axial được cộng theo
  khoảng cách lát để tính thể tích mL.
- Khung **3D U TỪ ROI AXIAL** dựng mô hình vùng đã đánh dấu; dùng hai thanh
  Xoay/Nghiêng để quan sát.
- Đường đo và ROI tự lưu vào `mpr-roi.json` trong folder series và được nạp lại
  ở lần mở sau.
- Phím **←/→** đổi lát axial trong layout MPR; **Enter** khép ROI đa giác;
  **Escape** hủy đường ROI đang vẽ.

Mô hình 3D u cần ROI trên nhiều lát axial. Nút này không tự nhận diện u và
không thay thế việc kiểm tra đường viền của người dùng.

Kết quả nằm trong thư mục đã chọn:
```
Tai_ve_.../
  DICOM/     ← file DICOM gốc tải về
  RAW_JPG/   ← ảnh JPG viewer trả trực tiếp (nếu có)
  JPG/       ← ẢNH JPG CHẤT LƯỢNG CAO, chia theo từng series  ← DÙNG CÁI NÀY
```

## Cách dùng bằng dòng lệnh (không cần giao diện)

```bat
python dcom_pipeline.py "DÁN_LINK_VÀO_ĐÂY"                  :: mặc định chất lượng 100
python dcom_pipeline.py "LINK" -o "D:\Anh" --png            :: thêm PNG (không mất dữ liệu)
python dcom_pipeline.py "LINK" --contrast auto              :: ảnh gắt hơn (percentile)
python dcom_pipeline.py "LINK" --show                       :: hiện trình duyệt để xem/gỡ lỗi
```

Chỉ chuyển đổi DICOM đã có sẵn (không tải mới):
```bat
python -c "import dcom_pipeline as p, pathlib; p.convert_all(pathlib.Path('Auto_Download_DICOM'), pathlib.Path('JPG_moi'))"
```

## Đóng gói thành file .exe (chạy máy không có Python)

1. Nhấp đúp **`build_exe.bat`** (cần mạng; lần đầu tự cài PyInstaller).
2. Vài phút sau, file nằm ở **`dist\Dicom_Downloader_App.exe`**.
3. Đem `.exe` sang máy Windows khác chạy thẳng — **lần bấm "BẮT ĐẦU TẢI" đầu tiên
   sẽ tự tải Chromium (~150MB, chỉ 1 lần)**, các lần sau chạy ngay.

> File `.exe` chạy dạng cửa sổ (không hiện màn hình đen CMD). Nó **nhẹ** vì không
> nhét sẵn Chromium — Chromium được tải ngầm ở lần chạy đầu trên mỗi máy.

## Vì sao chất lượng cao hơn trước

- Bản cũ để **JPEG quality 85**; bản này mặc định **95** (và có thể lên 100), kèm
  `subsampling=0` (không nén màu) nên nét hơn rõ rệt.
- Nguồn là **DICOM gốc** tải về, nên chuyển đổi cục bộ cho ảnh tốt nhất có thể.
- Muốn tuyệt đối không mất dữ liệu: tick **PNG**.

## Hai chế độ tương phản

- **Chuẩn lâm sàng (mặc định):** dùng `apply_voi_lut` của pydicom — xử lý đúng cả
  3 kiểu cửa sổ hiển thị: tuyến tính (WindowCenter/WindowWidth), hàm SIGMOID, và
  VOI LUT Sequence (bảng tra phi tuyến của máy đời mới). Sau đó map thẳng sang
  8-bit **không cắt percentile**, nên giữ đúng độ tương phản như máy trạm PACS
  hiển thị mặc định. Không cháy sáng.
- **Auto-contrast:** kéo giãn theo percentile(1,99) từng ảnh — nhìn đậm/gắt hơn,
  làm nổi chi tiết mờ, nhưng lệch khỏi cửa sổ lâm sàng và có thể cháy ~1% điểm
  sáng nhất. Chọn khi muốn ảnh nhìn "mạnh" hơn.

> Chế độ chuẩn lâm sàng đã gộp điểm mạnh của cả hai công cụ: an toàn cho mọi loại
> máy (nhờ `apply_voi_lut`) nhưng vẫn bám đúng tương phản gốc (không auto-stretch).

## Cách tải (tự chọn 2 chế độ)

- **MẶC ĐỊNH — tải trực tiếp theo manifest/API:** nếu nhận ra viewer, app đọc bản
  kê của server để biết **chính xác số series/ảnh**, rồi **tải thẳng từng ảnh** (6
  luồng song song). Không click, không cuộn → nhanh, đủ, và **tự đối chiếu "đã đủ
  X/Y ảnh" hay cảnh báo thiếu**. Đã hỗ trợ:
  - **VradViewer** (`StudyData/GetStudies`) — vd 113.160.173.210, 192.168.50.95
  - **vrpacs / telerad** (`get-share-patient-image`) — vd bvdkphutho.telerad.vn
  - **OHIF / DICOMweb chuẩn** (QIDO-RS + WADO) — vd dcm4chee, Orthanc, TELEMED
- **FALLBACK — mô phỏng người dùng:** nếu viewer lạ không có manifest, app quay về
  cuộn/click, nhưng **chỉ xử lý các xung ĐANG HIỂN THỊ** (`:visible`) nên không còn
  cảnh "đếm khống 99 xung / lặp xung 0 ảnh", và bắt ảnh **theo nội dung** để hợp
  nhiều loại viewer hơn.
- Cả hai chế độ đều **tự loại ảnh trùng** (SHA-1) và **tải toàn bộ series** (lọc
  chọn sau trên đĩa nếu cần).

## Lưu ý quan trọng

- **Link có hạn dùng** (`expires`). Nếu nhật ký báo `urlExpired` hoặc tải được 0 ảnh,
  hãy mở lại trang xem để lấy link mới rồi chạy lại.
- **Không được sửa link** (kể cả 1 ký tự) vì link được ký (signature); sửa là hỏng.
- Nếu chạy ẩn không ra ảnh, thử tick **"Hiện trình duyệt khi tải"** để xem viewer
  có mở đúng không.
- Nếu một số series nhiều lát cắt chưa đủ, tăng thời gian chờ hoặc chạy lại lần nữa
  (ảnh trùng sẽ tự bỏ qua khi gộp).

## Cài đặt (nếu máy chưa có thư viện)

```bat
pip install -r requirements.txt
python -m playwright install chromium
```

## Cập nhật orientation và thao tác MPR

- Coronal/sagittal hiển thị superior ở trên, inferior ở dưới; nhãn vàng
  `R/L/A/P/S/I` lấy từ DICOM orientation giúp kiểm tra chiều bệnh nhân.
- Bấm vào một viewport để chọn; viền xanh cho biết axial/coronal/sagittal
  đang hoạt động. Phím `←/→` đổi lát trên chính mặt phẳng đó.
- `Đo góc` dùng ba điểm theo thứ tự cạnh thứ nhất, đỉnh, cạnh thứ hai.
- `Xóa ở lát đang chọn` chỉ xóa annotation ở viewport có viền xanh.
- `Hoàn tác` khôi phục thay đổi annotation cuối; có thể ẩn/hiện số đo và ROI
  mà không xóa dữ liệu.
- `Enter` khép ROI đa giác; `Escape` hủy ROI hoặc góc đang vẽ.

## Phiên đăng nhập RIS và trình duyệt tự động

- Lần tìm bệnh nhân đầu tiên, ứng dụng đăng nhập RIS và chỉ giữ cookie/session trong RAM.
- Những lần tìm tiếp theo tại cùng bệnh viện trong vòng 30 phút sẽ dùng lại phiên này.
- Nếu RIS trả `401/403` hoặc chuyển về trang đăng nhập, ứng dụng tự đăng nhập lại đúng một lần
  rồi chạy lại truy vấn.
- Khi đóng ứng dụng, toàn bộ session trong RAM bị xóa. Ứng dụng không ghi cookie RIS xuống đĩa.
- Session của BV Đại học Y và BV Việt Đức được tách riêng.
- Kết quả có Patient ID tường minh nhưng không khớp mã yêu cầu sẽ bị bỏ qua.
- Ứng dụng không còn lấy Study UID tùy ý từ HTML của trang reading khi API không trả kết quả.

Ứng dụng ưu tiên Chrome. Nếu Windows/Playwright không cho khởi động Chrome, ứng dụng chuyển sang
Microsoft Edge. Cả hai dùng lõi Chromium; với luồng tải trực tiếp bằng API, khác biệt tốc độ thường
không đáng kể. Sau một lần Chrome thất bại, cùng phiên ứng dụng sẽ dùng thẳng Edge cho các study
tiếp theo để tránh mất thời gian thử lại.

Nút tìm theo mã bệnh nhân hiện ghi `TÌM & TẢI MRI / CT`, đúng với hành vi thực tế: bộ lọc hiện tại
lọc theo modality MR/CT, chưa bảo đảm chỉ lấy vùng sọ não.


## UI viewer 2D, MPR và 3D

- Các thao tác thường dùng chuyển thành icon; rê chuột lên icon để xem tooltip.
- Nút bàn tay cho phép kéo ảnh bằng chuột trái sau khi zoom trong cả 2D và MPR.
- Nút ⛶ hiện toàn bộ ảnh; nút ▣ lấp đầy viewport nhưng có thể cắt mép. Dùng bàn tay để kéo vùng cần xem.
- MPR chỉ hiển thị axial, coronal và sagittal; không còn ô 3D trống chiếm chỗ.
- Nút 3D ROI chỉ bật sau khi có ROI axial. Khi mở, 3D dùng toàn bộ workspace với toolbar xoay/nghiêng/đặt lại riêng.


## Lưu cả hai nhóm T1

- Mọi T1 3D sau tiêm/không tiêm đủ geometry và trên 100 lát đều được chuyển JPG quality 100 kèm manifest MPR.
- Mỗi gói có cửa sổ cường độ và 'mpr-volume.json' riêng.
- Các series khác vẫn theo luồng JPG bình thường; không tự xóa DICOM.

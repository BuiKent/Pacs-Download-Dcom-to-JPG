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

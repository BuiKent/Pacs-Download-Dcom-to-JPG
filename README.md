EN: A comprehensive automation tool designed to recover and extract full clinical DICOM imaging assets from web-based PACS viewers. It bypasses UI download limitations via network interception and features a built-in converter to transform raw DICOM files into high-fidelity, zero-subsampling JPEG/PNG archives for offline clinical review.

VN: Công cụ tự động hóa việc trích xuất và tải toàn bộ dữ liệu ảnh y tế chuẩn DICOM từ các hệ thống PACS viewer trên nền web (bỏ qua giới hạn tải của UI). Tích hợp sẵn tính năng tự động chuyển đổi DICOM sang JPG/PNG chất lượng cao (giữ nguyên độ tương phản và không nén dải màu), phục vụ cho việc lưu trữ nội bộ và hội chẩn lâm sàng.

## Kiểm thử

Ba tầng, chạy theo thứ tự này. Hai tầng đầu chạy được ở bất cứ đâu; tầng ba
cần WebView2 và một archive thật, và là tầng duy nhất chứng minh viewer thực sự
vẽ ra thứ gì.

```sh
# 1. Backend Python (unittest, không phải pytest — cần -t tests)
python -m unittest discover -s tests -t tests

# 2. Web UI
cd webui && npm run build && npx vitest run

# 3. Smoke gate runtime — mở cửa sổ WebView2 thật
python tools/smoke_webview.py --archive "<đường dẫn folder bệnh nhân>" --require-compare
```

Về tầng 3: cửa sổ **phải hiện ra**, WebView2 không composite được cửa sổ ẩn nên
Cornerstone sẽ không gắn canvas và mọi kiểm tra sẽ timeout.

Nhánh compare chỉ chạy khi archive có **từ 2 series trở lên**. Compare mở bằng
hai series đầu danh sách, thường là cặp đồng phẳng, nên gate tự hot-swap pane B
qua từng series cho tới khi gặp cặp **khác mặt phẳng cùng Frame of Reference**
(việc này cũng phủ luôn đường hot-swap). Với `--require-compare`, không tìm được
cặp như vậy là **fail** chứ không phải pass. Sau đó gate kiểm theo đúng quan hệ
hình học của cặp (`pairModes` trong `viewerDiagnostics`):

| Quan hệ cặp | Reference Line | Cuộn pane 1 |
|---|---|---|
| `spatial` (đồng phẳng, cùng FoR) | không vẽ — hai mặt song song không có giao tuyến | pane 2 đi theo vị trí 3D |
| `reference` (khác mặt phẳng, cùng FoR) | phải vẽ và phải còn sau khi cuộn | pane 2 giữ nguyên lát |
| `blocked` (khác Frame of Reference) | không bắt buộc | pane 2 giữ nguyên lát |
| `index` (thiếu hình học, ví dụ JPG) | không bắt buộc | pane 2 đi theo số thứ tự lát |

Nhánh này cũng kiểm con trỏ tham chiếu (crosslink theo điểm): tool phải ở chế độ
`Passive` — chế độ duy nhất vừa nhận `mouseMove` vừa vẽ — `positionSync` phải
tắt. Gate đặt chuột vào trung điểm Reference Line, tức một điểm chắc chắn nằm
trên cả hai mặt phẳng, rồi tạm ẩn Reference Line để đếm riêng nét của cursor.
Mỗi pane phải có ít nhất 4 nét (tổng ít nhất 8); chỉ có 4 nét tổng cộng mới chứng
minh marker ở pane dưới chuột, chưa chứng minh được phép chiếu sang pane kia.

Bước MPR thoát compare về single trước, chọn series có nhãn `3D` làm primary và
đợi nút MPR được bật — chạy MPR trên một localiser 8 lát hoặc chỉ hot-swap pane B
đều không chứng minh được nhánh tái tạo đa mặt phẳng.

Gate phát hành đầy đủ (pixel assertion, lặp chuyển MPR/3D) là
`python dcom_web_app.py --smoke-test`.

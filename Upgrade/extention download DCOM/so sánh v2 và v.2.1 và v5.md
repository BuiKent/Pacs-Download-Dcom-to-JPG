Khác biệt chính là **v2.1 không phải bản viết lại toàn bộ v2**, mà là bản vá tập trung cho **portal tải rất chậm / bootstrap nhiều tầng**, đặc biệt kiểu HFH `pportal...?token=...`.

| Phần                                        | v2.0                      | v2.1                                              |
| ------------------------------------------- | ------------------------- | ------------------------------------------------- |
| Nhận diện PACS thường                       | Có                        | Giữ nguyên                                        |
| VRAD / DICOMweb / VRPACS                    | Có                        | Giữ nguyên                                        |
| `/ris/vrViewer` + iframe                    | Có                        | Giữ nguyên                                        |
| VRAD direct download qua `chrome.downloads` | Có                        | Giữ nguyên                                        |
| State theo tab cơ bản                       | Có                        | Giữ nguyên                                        |
| Folder `Tên - ID - Ngày`                    | Có                        | Giữ nguyên                                        |
| Portal `?token=...`                         | Gần như generic/unknown   | **Thêm nhận diện `TOKEN_PORTAL`**                 |
| Viewer load rất lâu                         | Chờ khoảng 20s            | **Có thể theo dõi tới ~180s**                     |
| Auto reload                                 | Có thể reload sau timeout | **Không reload khi portal còn bootstrap**         |
| Theo dõi network đang tiếp tục hoạt động    | Cơ bản                    | **Có kiểm tra resource/network/frame còn tăng**   |
| Vendor/API lạ                               | Báo chưa nhận diện        | **Giữ danh sách API gần nhất để chẩn đoán**       |
| UI khi portal đang load                     | Khá chung chung           | **Hiện trạng thái “portal đang khởi tạo viewer”** |

Điểm quan trọng nhất là vấn đề này:

### v2.0

Logic gần kiểu:

```text
Mở portal
   ↓
chờ manifest
   ↓
~20 giây không thấy
   ↓
reset + reload
   ↓
portal lại khởi động từ đầu
```

Với HFH tải UI rất lâu, chính extension có thể tự phá phiên bootstrap.

### v2.1

Tôi đổi thành:

```text
URL có dạng portal/token
   ↓
đánh dấu slow portal
   ↓
theo dõi iframe + network + resource
   ↓
trang vẫn hoạt động
   ↓
KHÔNG reload
   ↓
manifest/API xuất hiện muộn
   ↓
tự analyze
```

Ngoài ra v2.1 thêm **diagnostic cho vendor lạ**. Nếu viewer đã load xong nhưng extension vẫn không nhận ra DICOM, nó có thể giữ các endpoint gần nhất như:

```text
/api/study/...
/api/image/...
/series/...
/exam/...
```

để biết phải viết adapter gì tiếp theo.

Nhưng có một điểm cần lưu ý: **v2.1 vẫn chưa giải quyết kiến trúc tổng quát của các portal rất phức tạp**. Chính vì sau đó bạn đưa thêm Việt Mỹ, Thanh Nhàn, HFH login nhiều tầng nên tôi mới tiếp tục đi tới v5 với auto-detect, per-tab session, recorder sâu, cache DICOM, background tracking...

Nói ngắn gọn:

> **v2.0 = nền standalone khá đầy đủ.**
> **v2.1 = v2.0 + xử lý portal/token load chậm, tránh reload phá bootstrap, thêm chẩn đoán API lạ.**

Về khả năng download DICOM lõi thì **v2.1 không mạnh hơn v2.0 quá nhiều**; cải tiến lớn nhất nằm ở **khả năng chờ và bắt đúng thời điểm viewer xuất hiện**.


Được. Nếu so tiếp thì **v5 không còn là “v2.1 cộng thêm vài fix” nữa**, mà gần như là một lần **đổi kiến trúc**.

| Hạng mục                                    | v2.0                      | v2.1                                  | v5.0                                              |
| ------------------------------------------- | ------------------------- | ------------------------------------- | ------------------------------------------------- |
| Extension standalone, không cần app Python  | Có                        | Có                                    | Có                                                |
| VRAD / VRPACS / DICOMweb                    | Có                        | Có                                    | Có                                                |
| `/ris/vrViewer` + iframe                    | Có                        | Có                                    | Mạnh hơn                                          |
| Portal `?token=` load chậm                  | Yếu                       | Thêm xử lý                            | Tổng quát hơn                                     |
| Auto reload                                 | Có thể reload hơi sớm     | Tránh reload khi portal còn bootstrap | Không còn phụ thuộc flow chờ/reload kiểu cũ       |
| Theo dõi khi đổi sang tab khác              | Chưa thật sự tốt          | Chưa phải kiến trúc chính             | **Có, job gắn theo tabId**                        |
| Mỗi tab có state riêng                      | Cơ bản                    | Cơ bản                                | **Hoàn chỉnh**                                    |
| Side panel đổi theo tab                     | Chưa tối ưu               | Chưa tối ưu                           | **Có**                                            |
| Auto detect PACS                            | Có detector               | Tốt hơn với token portal              | **Confidence scoring + auto-arm**                 |
| Vendor lạ                                   | Chủ yếu adapter           | Thêm diagnostic API                   | **Generic recorder sâu**                          |
| Bắt DICOM đã thực sự đi qua Chrome          | Một phần                  | Một phần                              | **Có, là fallback quan trọng**                    |
| Tải lại API nếu đã bắt được DICOM           | Thường vẫn có             | Thường vẫn có                         | **Ưu tiên dùng cache DICOM đã bắt**               |
| `Failed to fetch` VRAD                      | Đã sửa phần lớn           | Giữ                                   | Giữ + đường tải robust hơn                        |
| Generic DICOM cache → Downloads             | Chưa hoàn chỉnh           | Chưa hoàn chỉnh                       | **Đã nối đầy đủ**                                 |
| Multiple PACS tabs cùng lúc                 | Không phải mục tiêu chính | Không                                 | **Có**                                            |
| Stop tracking                               | Hạn chế                   | Hạn chế                               | **Có riêng**                                      |
| Stop download                               | Có cơ bản                 | Có                                    | **Có riêng**                                      |
| History                                     | Có                        | Có                                    | **Tách riêng hoàn toàn khỏi current state**       |
| Study cũ treo khi đổi tab/study             | Có thể gặp                | Có thể gặp                            | **Đã sửa theo document/tab/study**                |
| Ẩn ca đã tải                                | Không phải logic chính    | Không                                 | **Có mặc định**                                   |
| Tìm lại theo tên / ID / ngày                | Hạn chế                   | Hạn chế                               | **Có trong History**                              |
| Folder `Tên - ID - Ngày`                    | Có                        | Có                                    | Có + bổ sung metadata từ DICOM khi manifest thiếu |
| Nhiều series trùng tên/số                   | Có nguy cơ đụng folder    | Có                                    | **Đã tránh collision**                            |
| Manifest lớn                                | Có thể nặng storage       | Có thể nặng                           | **Đưa body lớn sang IndexedDB**                   |
| Báo hoàn tất giả khi chỉ bắt được vài DICOM | Có nguy cơ                | Có nguy cơ                            | **Đã tách “đã lưu một phần” và “đã tải đủ”**      |
| Portal login nhiều tầng                     | Chưa phải trọng tâm       | Chưa đủ                               | **Theo dõi từ portal → viewer → iframe/popup**    |
| `PAGE_HINTS` từ content script              | Có thiết kế               | Có                                    | **Đã sửa routing bị đứt**                         |

### Khác biệt kiến trúc lớn nhất

v2/v2.1 vẫn mang tư duy:

```text
Mở PACS
  ↓
bấm extension
  ↓
phân tích trang hiện tại
  ↓
chờ manifest
  ↓
nhận diện vendor
  ↓
download
```

v5 chuyển sang:

```text
Mở tab
  ↓
detector nhẹ tự chạy
  ↓
nghi là PACS
  ↓
AUTO ARM tab đó
  ↓
background theo dõi liên tục
  ↓
user có thể chuyển tab khác
  ↓
viewer/iframe/API/DICOM xuất hiện lúc nào cũng bắt
  ↓
inventory sẵn sàng
  ↓
user bấm Download
```

Đây là thay đổi rất quan trọng với những portal kiểu:

```text
login
  ↓
danh sách xét nghiệm/phim
  ↓
bấm Xem ảnh
  ↓
chờ lâu
  ↓
iframe/popup
  ↓
URL dài
  ↓
replaceState → URL ngắn
  ↓
API ảnh mới xuất hiện
```

v2.1 chỉ cố **chờ lâu hơn**.

v5 thì **không cần đứng chờ trong Side Panel nữa**.

### V5 cũng thay đổi cách nghĩ về vendor

v2:

```text
Có adapter?
  → tải

Không adapter?
  → khó
```

v2.1:

```text
Không adapter?
  → ghi API gần nhất để debug
```

v5:

```text
Có adapter chuẩn?
  → dùng adapter

Không có?
  → generic network recorder
       ↓
     thấy DICOM thật
       → cache
       → tải chính file đó

     thấy WADO/DICOM endpoint
       → giữ URL/session
       → tải trực tiếp

     thấy metadata + frames
       → dựng DICOM
```

Tức là **v5 bớt phụ thuộc vào việc phải biết trước PACS thuộc hãng nào**.

### Một cải tiến tôi đánh giá quan trọng nhất

V2/v2.1 vẫn thường có tình huống:

```text
Chrome đã tải DICOM để hiển thị
       ↓
extension biết URL
       ↓
extension gọi server LẦN NỮA
       ↓
token/session hết hạn
       ↓
fail
```

V5 ưu tiên:

```text
Chrome vừa nhận DICOM
       ↓
recorder giữ file đó
       ↓
Download
```

Chỉ nếu chưa bắt được file thì mới gọi PACS lại.

Điều này đặc biệt hữu ích với PACS có:

* token ngắn;
* signed URL;
* cookie đặc biệt;
* URL chỉ dùng một lần;
* request được tạo sau nhiều tầng redirect.

### V5 còn sửa cả logic “đã tải”

Trước đây dễ có tình huống:

```text
manifest nói 500 ảnh
recorder bắt 20 ảnh
→ extension tưởng đã có study
```

V5 tách:

```text
20/500
→ ĐÃ LƯU MỘT PHẦN
→ vẫn hiện trong màn hình chính
```

chỉ khi:

```text
500/500
```

mới:

```text
ĐÃ TẢI
→ mặc định ẩn khỏi danh sách cần xử lý
→ vẫn tìm được trong History
```

Đúng với yêu cầu của bạn là không cần liên tục hiện lại phim đã tải rồi.

---

Nếu ví von theo version:

```text
v2.0  = standalone downloader đầu tiên
v2.1  = v2.0 + sửa portal load chậm

v5.0  = PACS-awares browser recorder/downloader
        chạy theo từng tab
        + history
        + cache
        + generic fallback
        + multi-tab
```

Vì vậy nếu đang dùng thực tế thì **không có lý do gì giữ v2/v2.1 ngoài mục đích rollback/debug**. V5 là nhánh nên phát triển tiếp.

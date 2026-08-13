Có. Nhìn đúng code hiện tại thì tôi sẽ **không viết lại toàn bộ downloader**, vì phần khó nhất của bạn đã có: validate DICOM, dedupe, resume, WADO-URI/WADO-RS/frames, download song song... Phần nên cải tiến trước là khối **nhận diện PACS + thu thập network**, vì hiện `download_all()` đang tự giữ một `captured` dict, tự nhận diện response rồi cuối hàm lại `if/elif` chọn Vrad / VRPACS / DICOMweb.  

Tôi sẽ refactor kiểu này.

## 1. Thêm lớp nhận diện PACS

Có thể đặt ngay trong `dcom_pipeline.py` trước `download_all()` để trước mắt **không phải tách file, không gây circular import**:

```python
from dataclasses import dataclass, field
from typing import Any, Optional


@dataclass
class ViewerCapture:
    """
    Những gì thu được từ chính phiên viewer hiện tại.

    Không tự đăng nhập, không bypass quyền.
    Chỉ dùng cookie/header mà viewer đang được phép sử dụng.
    """
    getstudies: Optional[bytes] = None
    template_url: Optional[str] = None

    vrpacs: Optional[bytes] = None

    qido_series: Optional[str] = None
    qido_series_body: Optional[bytes] = None
    wado_tmpl: Optional[str] = None

    host: Optional[str] = None
    cookies: list[dict] = field(default_factory=list)
    api_headers: dict[str, str] = field(default_factory=dict)

    session_error: Optional[str] = None

    # debug/diagnostic
    detected_by: set[str] = field(default_factory=set)

    def as_legacy_dict(self) -> dict:
        """
        Giữ tương thích với các hàm cũ:
        _download_via_manifest()
        _download_via_vrpacs()
        _download_via_dicomweb()
        """
        return {
            "getstudies": self.getstudies,
            "template_url": self.template_url,
            "vrpacs": self.vrpacs,
            "qido_series": self.qido_series,
            "qido_series_body": self.qido_series_body,
            "wado_tmpl": self.wado_tmpl,
            "host": self.host,
            "cookies": self.cookies,
            "api_headers": self.api_headers,
            "session_error": self.session_error,
        }
```

Sau đó adapter:

```python
class PacsAdapter:
    name = "generic"
    priority = 0

    def observe(self, response, cap: ViewerCapture) -> bool:
        """
        Đọc metadata/network response.

        return True nếu response thuộc loại adapter này quan tâm.
        """
        return False

    def is_ready(self, cap: ViewerCapture) -> bool:
        return False

    def download(
        self,
        cap: ViewerCapture,
        save_body,
        stats,
        log,
        stop,
        selected_series,
    ) -> None:
        raise NotImplementedError
```

### VradViewer

```python
class VradAdapter(PacsAdapter):
    name = "VradViewer"
    priority = 300

    def observe(self, response, cap: ViewerCapture) -> bool:
        url = response.url
        matched = False

        if "StudyData/GetStudies" in url and cap.getstudies is None:
            try:
                cap.getstudies = response.body()
                cap.detected_by.add(self.name)
                matched = True
            except Exception:
                pass

        if (
            "GetImage" in url
            and "Jpeg" not in url
            and cap.template_url is None
        ):
            cap.template_url = url
            cap.detected_by.add(self.name)
            matched = True

        return matched

    def is_ready(self, cap: ViewerCapture) -> bool:
        return bool(cap.getstudies and cap.template_url)

    def download(
        self,
        cap,
        save_body,
        stats,
        log,
        stop,
        selected_series,
    ):
        _download_via_manifest(
            cap.as_legacy_dict(),
            save_body,
            stats,
            log,
            stop,
            selected_series,
        )
```

### VRPACS / Telerad

```python
class VrpacsAdapter(PacsAdapter):
    name = "VRPACS"
    priority = 250

    def observe(self, response, cap: ViewerCapture) -> bool:
        url = response.url

        if (
            "get-share-patient-image" in url
            and cap.vrpacs is None
        ):
            try:
                cap.vrpacs = response.body()
                cap.detected_by.add(self.name)
                return True
            except Exception:
                pass

        return False

    def is_ready(self, cap: ViewerCapture) -> bool:
        return cap.vrpacs is not None

    def download(
        self,
        cap,
        save_body,
        stats,
        log,
        stop,
        selected_series,
    ):
        _download_via_vrpacs(
            cap.as_legacy_dict(),
            save_body,
            stats,
            log,
            stop,
            selected_series,
        )
```

### DICOMweb / OHIF / dcm4chee / Orthanc

```python
class DicomWebAdapter(PacsAdapter):
    name = "DICOMweb"
    priority = 200

    def observe(self, response, cap: ViewerCapture) -> bool:
        url = response.url
        clean_url = url.split("?")[0].rstrip("/")
        ct = (response.headers.get("content-type") or "").lower()

        matched = False

        # QIDO series:
        # .../studies/<StudyUID>/series
        if (
            cap.qido_series is None
            and clean_url.endswith("/series")
            and "/studies/" in clean_url
        ):
            cap.qido_series = url

            try:
                cap.qido_series_body = response.body()
            except Exception:
                pass

            # Chỉ giữ các header cần thiết cho cùng phiên viewer.
            try:
                headers = response.request.all_headers()
            except Exception:
                try:
                    headers = dict(response.request.headers)
                except Exception:
                    headers = {}

            cap.api_headers.update(headers or {})
            cap.detected_by.add(self.name)
            matched = True

        # Nếu viewer từng gọi WADO thực sự thì giữ URL làm template.
        if (
            cap.wado_tmpl is None
            and ct.startswith("application/dicom")
            and "json" not in ct
            and (
                "wado" in url.lower()
                or "objectuid" in url.lower()
            )
        ):
            cap.wado_tmpl = url
            cap.detected_by.add(self.name)
            matched = True

        return matched

    def is_ready(self, cap: ViewerCapture) -> bool:
        # Chỉ cần QIDO series.
        #
        # _download_via_dicomweb() hiện tại đã tự thử:
        # WADO-RS -> frames -> WADO-URI
        # nếu không có wado_tmpl.
        return bool(cap.qido_series)

    def download(
        self,
        cap,
        save_body,
        stats,
        log,
        stop,
        selected_series,
    ):
        _download_via_dicomweb(
            cap.as_legacy_dict(),
            save_body,
            stats,
            log,
            stop,
            selected_series,
        )
```

Điểm này tận dụng nguyên logic hiện tại của bạn. `_download_via_dicomweb()` đã tự thử WADO-URI, WADO-RS và metadata+frames nên **không nên viết lại phần đó**. 

Và hiện nó đã có logic thay đổi thứ tự ưu tiên sau khi tìm thấy phương thức thành công. 

---

## 2. Registry tự chọn adapter

```python
PACS_ADAPTERS: tuple[PacsAdapter, ...] = (
    VradAdapter(),
    VrpacsAdapter(),
    DicomWebAdapter(),
)


def _ready_adapter(cap: ViewerCapture) -> Optional[PacsAdapter]:
    ready = [
        adapter
        for adapter in PACS_ADAPTERS
        if adapter.is_ready(cap)
    ]

    if not ready:
        return None

    return max(ready, key=lambda a: a.priority)
```

Như vậy về sau bạn thêm:

```python
class ViettelPacsAdapter(PacsAdapter):
    ...
```

hay:

```python
class FujifilmAdapter(PacsAdapter):
    ...
```

chỉ cần đăng ký:

```python
PACS_ADAPTERS = (
    VradAdapter(),
    VrpacsAdapter(),
    DicomWebAdapter(),
    ViettelPacsAdapter(),
)
```

không phải sửa `download_all()` nữa.

---

# 3. `on_response()` sẽ gọn đi rất nhiều

Khối hiện tại của bạn đang trực tiếp kiểm tra `StudyData/GetStudies`, `get-share-patient-image`, `/series`, `GetImage`, WADO... 

Tôi đổi thành:

```python
cap = ViewerCapture()
capture_bodies = selected_series is None


def _want_passive_capture(response) -> bool:
    """
    Chỉ dùng cho fallback / viewer lạ.

    Adapter-specific detection được xử lý riêng.
    """
    url = response.url.lower()
    ct = (response.headers.get("content-type") or "").lower()

    if any(
        token in url
        for token in (
            "getimage",
            "dicomdata",
            "dicomimage",
            "/frames/",
            "/instances/",
            "/preview",
        )
    ):
        return True

    return (
        "application/dicom" in ct
        or "application/octet-stream" in ct
        or "image/jpeg" in ct
        or "image/png" in ct
    )


def _capture_session_headers(response) -> None:
    """
    Có thể lấy session headers từ response request đã được browser
    phép gửi, nhưng không tạo/bypass credential mới.
    """
    try:
        headers = response.request.all_headers()
    except Exception:
        try:
            headers = dict(response.request.headers)
        except Exception:
            return

    if not headers:
        return

    # Không cần giữ toàn bộ Chrome headers.
    allowed = {
        "authorization",
        "token",
        "session",
        "session-id",
    }

    for key, value in headers.items():
        lk = key.lower()

        if lk.startswith("x-") or lk in allowed:
            cap.api_headers[key] = value


def on_response(response) -> None:
    try:
        url = response.url

        # ------------------------------------------------------------
        # 1. Session/share lỗi
        # ------------------------------------------------------------
        if (
            cap.session_error is None
            and response.status >= 400
            and re.search(
                r"/(session|share)s?/[0-9a-fA-F\-]{8,}",
                url,
            )
        ):
            cap.session_error = str(response.status)

        # ------------------------------------------------------------
        # 2. Cho adapters quan sát response
        # ------------------------------------------------------------
        adapter_matched = False

        for adapter in PACS_ADAPTERS:
            try:
                if adapter.observe(response, cap):
                    adapter_matched = True
            except Exception:
                # Một adapter hỏng không được phép phá toàn phiên tải.
                continue

        # Nếu đây là request thuộc PACS API,
        # giữ session headers của chính viewer.
        if adapter_matched:
            _capture_session_headers(response)

        # ------------------------------------------------------------
        # 3. Passive capture
        #
        # Không phải đường tải chính.
        # Chỉ là bonus / fallback cho viewer lạ.
        # ------------------------------------------------------------
        if capture_bodies and _want_passive_capture(response):
            try:
                save_body(response.body())
            except Exception:
                pass

    except Exception:
        # Network listener tuyệt đối không được làm crash browser.
        pass
```

---

# 4. `_have_manifest()` cũng bỏ được

Hiện bạn có:

```python
def _have_manifest() -> bool:
    return bool(
        (captured["getstudies"] and captured["template_url"])
        or captured["vrpacs"]
        or captured["qido_series"]
    )
```



Thay bằng:

```python
def _have_download_strategy() -> bool:
    return _ready_adapter(cap) is not None
```

Vòng đợi:

```python
log("Đang nhận diện PACS / DICOMweb...")

for _ in range(24):
    if stop():
        break

    if _have_download_strategy():
        break

    if cap.session_error:
        break

    page.wait_for_timeout(500)
```

---

# 5. Quan trọng nhất: bỏ `if/elif PACS` khỏi `download_all()`

Hiện đoạn của bạn:

```python
if captured["getstudies"] and captured["template_url"]:
    _download_via_manifest(...)

elif captured["vrpacs"]:
    _download_via_vrpacs(...)

elif captured["qido_series"]:
    _download_via_dicomweb(...)
```



Tôi thay bằng:

```python
adapter = _ready_adapter(cap)

if adapter is not None and not stop():
    log(
        f"✓ Nhận diện: {adapter.name} "
        f"→ tải trực tiếp bằng API."
    )

    adapter.download(
        cap=cap,
        save_body=save_body,
        stats=stats,
        log=log,
        stop=stop,
        selected_series=selected_series,
    )
```

Không còn cần biết:

```text
if Vrad
elif vrpacs
elif OHIF
elif ABC
elif XYZ
...
```

trong `download_all()` nữa.

---

# 6. Tôi còn muốn sửa thêm một điểm quan trọng trong app của bạn

Hiện `save_body()` làm khá tốt: nhận diện **theo content thay vì tên endpoint**, validate DICOM trước khi lưu, SHA-1 dedupe, `.part` rồi atomic replace. 

Nhưng tôi sẽ thêm **nguồn gốc của ảnh**.

Ví dụ:

```python
@dataclass
class DownloadStats:
    dicom: int = 0
    jpg: int = 0
    png: int = 0
    duplicates: int = 0

    original_dicom: int = 0
    reconstructed_dicom: int = 0
    rendered_only: int = 0

    expected: int = 0
    completed_tasks: int = 0
```

Rồi đổi:

```python
save_body(body)
```

thành:

```python
save_body(
    body,
    source="wadors",
    fidelity="original",
)
```

hoặc:

```python
save_body(
    blob,
    source="dicomweb-frames",
    fidelity="reconstructed",
)
```

JPEG:

```python
save_body(
    body,
    source="viewer-rendered",
    fidelity="rendered",
)
```

Kết quả GUI có thể báo:

```text
Tải hoàn tất

DICOM gốc:          436
DICOM dựng từ frame: 52
Ảnh render JPG:       0

Tổng:               488
```

Cái này **rất có giá trị với app y khoa**, vì người dùng không nên thấy `.dcm` rồi mặc định cho rằng tất cả đều là original DICOM.

---

## Và đặc biệt với phần DICOMweb của bạn

Hiện đoạn frames:

```python
blob = _dicom_from_meta_frames(meta, frames, fct)

if not blob:
    return False

return save_body(blob)
```



Tôi sẽ đổi thành:

```python
blob = _dicom_from_meta_frames(
    meta,
    frames,
    fct,
)

if not blob:
    return False

return save_body(
    blob,
    source="dicomweb-frames",
    fidelity="reconstructed",
)
```

Trong khi WADO-RS:

```python
if parts:
    saved = [
        save_body(
            data,
            source="wadors",
            fidelity="original",
        )
        for _content_type, data in parts
        if _guess_ext(data) == "dcm"
    ]

    return bool(saved and all(saved))

if _guess_ext(body) == "dcm":
    return save_body(
        body,
        source="wadors",
        fidelity="original",
    )
```

---

## Thành ra kiến trúc sẽ thành

```text
Viewer URL
    │
    ▼
Playwright
    │
    ├── VradAdapter
    ├── VrpacsAdapter
    ├── DicomWebAdapter
    ├── PACS mới...
    │
    ▼
adapter.download()
    │
    ├── WADO-RS
    ├── WADO-URI
    ├── metadata + frames
    └── vendor API
    │
    ▼
save_body()
    │
    ├── validate DICOM
    ├── deduplicate
    ├── atomic save
    ├── classify fidelity
    └── statistics
```

Còn nếu **không adapter nào nhận ra**:

```text
        ▼
Generic fallback
        │
        └── click / scroll viewer
              │
              └── passive network capture
```

Tức là phần `_drive_viewer()` hiện tại vẫn giữ nguyên làm “lưới an toàn”. Code của bạn đang dùng chính cách này khi không tìm thấy manifest. 

### Tôi sẽ làm tiếp thế nào với code này

Nếu sửa thật trên source bạn vừa gửi, tôi **không chỉ thêm vài class mẫu như trên**. Tôi có thể refactor trực tiếp `dcom_pipeline.py` thành bản chạy được, giữ nguyên API mà `dcom_downloader_app.py` đang gọi, tức là GUI gần như **không phải sửa theo**. Sau đó chạy `py_compile`/kiểm tra import để bắt lỗi cú pháp trước. Đây là hướng tôi nghĩ đáng làm nhất trước, vì nó cải thiện khả năng thêm PACS mới mà ít nguy cơ phá các bệnh viện hiện đang tải được.

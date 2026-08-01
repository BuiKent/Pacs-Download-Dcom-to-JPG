"""
dcom_pipeline.py
================
Lõi xử lý cho công cụ tải ảnh DICOM từ trình xem (VradViewer / cornerstone) và
chuyển sang JPG chất lượng cao.

Quy trình 2 bước:
  1) download_all(url, dicom_dir, ...):
        - Mở link viewer bằng trình duyệt ảo (Playwright, KHÔNG sửa link).
        - Tự động bấm qua TẤT CẢ series (xung) và cuộn hết các lát cắt / phase
          để viewer tự gửi request ảnh.
        - Bắt toàn bộ response GetImage (DICOM gốc) / GetImageJpeg và lưu lại,
          tự loại trùng theo nội dung.
  2) convert_all(dicom_dir, jpg_dir, ...):
        - Đọc DICOM, dựng ảnh với cửa sổ (window/level) tốt hơn,
          xuất JPG chất lượng cao (mặc định 95) tổ chức theo từng series.

Có thể chạy trực tiếp (CLI) hoặc import bởi giao diện dcom_downloader_app.py.

Mọi thông báo được đẩy qua callback `log(msg)` để GUI hiển thị; nếu không truyền
thì in ra màn hình.
"""

from __future__ import annotations

import base64
import copy
import hashlib
import os
import re
import sys
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Optional

from dicom_io import discover_dicom_files

# --------------------------------------------------------------------------- #
#  Tiện ích chung
# --------------------------------------------------------------------------- #

LogFn = Callable[[str], None]


def _default_log(msg: str) -> None:
    try:
        print(msg, flush=True)
    except Exception:
        pass


def _guess_ext(data: bytes) -> Optional[str]:
    """Đoán loại file từ vài byte đầu."""
    if data[:3] == b"\xff\xd8\xff":
        return "jpg"
    if data[:4] == b"\x89PNG":
        return "png"
    if len(data) > 132 and data[128:132] == b"DICM":
        return "dcm"
    return None


def _maybe_base64_decode(body: bytes) -> bytes:
    """
    Một số response trả về base64 dạng text thay vì nhị phân.
    Nếu phát hiện là base64 hợp lệ và giải mã ra ảnh/DICOM thì trả bản đã giải mã.
    """
    stripped = body.strip()
    # Chỉ thử nếu trông giống base64 (không có byte điều khiển, độ dài chia hết logic)
    if not stripped or len(stripped) < 100:
        return body
    if _guess_ext(stripped) is not None:
        return body  # đã là nhị phân nhận diện được
    if re.fullmatch(rb"[A-Za-z0-9+/=\r\n]+", stripped):
        try:
            decoded = base64.b64decode(stripped + b"=" * (-len(stripped) % 4))
            if _guess_ext(decoded) is not None:
                return decoded
        except Exception:
            pass
    return body


def _multipart_parts(body: bytes, content_type: str = "") -> "list[tuple[str, bytes]]":
    """
    Tách response multipart/related (chuẩn WADO-RS) thành [(content-type phần, dữ liệu)].
    Trả [] nếu không phải multipart. Boundary lấy từ header Content-Type; nếu
    thiếu thì dò từ dòng đầu của thân ("--boundary\\r\\n").
    """
    m = re.search(r'boundary="?([^";,\s]+)"?', content_type or "", re.I)
    if m:
        boundary = m.group(1)
    else:
        if not body.startswith(b"--"):
            return []
        eol = body.find(b"\r\n")
        if eol <= 2:
            return []
        boundary = body[2:eol].decode("latin-1", "replace").strip()
        if not boundary:
            return []
    sep = b"--" + boundary.encode("latin-1", "replace")
    parts = []
    for chunk in body.split(sep)[1:]:
        if chunk[:2] == b"--":
            break  # dấu kết thúc multipart
        head, brk, payload = chunk.partition(b"\r\n\r\n")
        if not brk:
            continue
        mt = re.search(rb"(?i)content-type:\s*([^\r\n]+)", head)
        pct = mt.group(1).decode("latin-1", "replace").strip() if mt else ""
        parts.append((pct, payload.rstrip(b"\r\n")))
    return parts


# Content-type của frame WADO-RS -> Transfer Syntax UID tương ứng
_FRAME_TS_BY_MIME = {
    "image/jpeg": "1.2.840.10008.1.2.4.50",
    "image/jls": "1.2.840.10008.1.2.4.80",
    "image/x-jls": "1.2.840.10008.1.2.4.80",
    "image/jp2": "1.2.840.10008.1.2.4.90",
    "image/j2c": "1.2.840.10008.1.2.4.90",
    "image/x-j2c": "1.2.840.10008.1.2.4.90",
    "image/jphc": "1.2.840.10008.1.2.4.201",
}


def _dicom_from_meta_frames(meta: dict, frames: "list[bytes]",
                            frame_ct: str) -> Optional[bytes]:
    """
    Dựng lại file DICOM Part-10 hoàn chỉnh từ metadata (DICOM+JSON của WADO-RS
    /metadata) + dữ liệu điểm ảnh lấy từ /frames/N. Cần cho viewer chỉ phát ảnh
    theo frame (vd PACS OHIF của BV Đa khoa Hà Tĩnh) — không có endpoint nào
    trả file DICOM trọn vẹn.
    """
    try:
        import io
        import json as _json
        from pydicom import dcmwrite
        from pydicom.dataset import Dataset, FileMetaDataset
        from pydicom.encaps import encapsulate
        from pydicom.uid import (UID, ExplicitVRLittleEndian,
                                 ImplicitVRLittleEndian, generate_uid)

        ds = Dataset.from_json(_json.dumps(meta),
                               bulk_data_uri_handler=lambda *a: None)
        for k in list(ds.keys()):
            if k.group == 0x0002:
                del ds[k]

        ct = (frame_ct or "").lower()
        ts = None
        m = re.search(r'transfer-syntax="?([0-9][0-9.]+)"?', ct)
        if m:
            ts = m.group(1)
        else:
            for mime, uid in _FRAME_TS_BY_MIME.items():
                if mime in ct:
                    ts = uid
                    break

        if ts is None or ts in ("1.2.840.10008.1.2", "1.2.840.10008.1.2.1"):
            # octet-stream: điểm ảnh thô không nén — ghép các frame lại
            pix = b"".join(frames)
            if len(pix) % 2:
                pix += b"\x00"
            vr = "OB" if str(getattr(ds, "BitsAllocated", 16)) == "8" else "OW"
            ds.add_new(0x7FE00010, vr, pix)
            ts_uid = ImplicitVRLittleEndian if ts == "1.2.840.10008.1.2" else ExplicitVRLittleEndian
        else:
            # frame đã nén (JPEG/JLS/J2K/HTJ2K) -> đóng gói encapsulated
            ds.add_new(0x7FE00010, "OB", encapsulate(list(frames)))
            ds["PixelData"].is_undefined_length = True
            ts_uid = UID(ts)

        fm = FileMetaDataset()
        fm.MediaStorageSOPClassUID = (getattr(ds, "SOPClassUID", None)
                                      or UID("1.2.840.10008.5.1.4.1.1.7"))
        fm.MediaStorageSOPInstanceUID = (getattr(ds, "SOPInstanceUID", None)
                                         or generate_uid())
        fm.TransferSyntaxUID = ts_uid
        ds.file_meta = fm
        try:  # pydicom 2.x cần 2 cờ này; pydicom 3 tự suy từ file_meta
            ds.is_little_endian = ts_uid.is_little_endian
            ds.is_implicit_VR = ts_uid.is_implicit_VR
        except Exception:
            pass

        buf = io.BytesIO()
        try:
            dcmwrite(buf, ds, enforce_file_format=True)
        except TypeError:  # pydicom < 3.0
            dcmwrite(buf, ds, write_like_original=False)
        return buf.getvalue()
    except Exception:
        return None


def ensure_browser(log: LogFn = _default_log) -> None:
    """
    Tự tải nhân Chromium nếu máy chưa có (~150MB, chỉ 1 lần).
    Rất hữu ích khi đóng gói .exe và đem sang máy mới: lần bấm Tải đầu tiên sẽ tự
    tải ngầm Chromium, các lần sau chạy ngay.
    """
    import os
    try:
        from playwright.sync_api import sync_playwright
        with sync_playwright() as p:
            if os.path.exists(p.chromium.executable_path):
                return  # đã có sẵn
    except Exception:
        pass

    log("Lần đầu chạy trên máy này: đang tải nhân trình duyệt Chromium (~150MB, chỉ 1 lần)...")
    try:
        import subprocess
        from playwright._impl._driver import compute_driver_executable, get_driver_env
        drv = compute_driver_executable()
        cmd = list(drv) if isinstance(drv, (list, tuple)) else [drv]
        creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0) if os.name == "nt" else 0
        subprocess.run([*cmd, "install", "chromium"],
                       env=get_driver_env(), check=False, creationflags=creationflags)
        log("Đã tải xong Chromium.")
    except Exception as e:
        log(f"  Không tự tải được Chromium ({e}). Hãy chạy thủ công: python -m playwright install chromium")


# --dns-over-https-mode=off: buộc Chromium dùng DNS của HỆ ĐIỀU HÀNH. Nếu
# không, với DNS nội bộ/split-horizon (vd PACS bệnh viện), Chromium tự hỏi
# resolver công khai -> ra IP công khai bị chặn -> ERR_CONNECTION_TIMED_OUT
# dù trình duyệt thường vẫn vào được.
_BROWSER_ARGS = ["--dns-over-https-mode=off", "--disable-features=DnsOverHttps,AsyncDns"]
_BROWSER_STATE_LOCK = threading.Lock()
_CHROME_UNAVAILABLE = False


def _installed_chrome_paths() -> list[Path]:
    """Các vị trí Chrome có thể bị Playwright bỏ sót trên một số máy Windows."""
    roots = [
        os.environ.get("PROGRAMFILES"),
        os.environ.get("PROGRAMFILES(X86)"),
        os.environ.get("LOCALAPPDATA"),
    ]
    candidates = []
    for root in roots:
        if root:
            path = Path(root) / "Google" / "Chrome" / "Application" / "chrome.exe"
            if path.is_file() and path not in candidates:
                candidates.append(path)
    return candidates


def _short_browser_error(exc: Exception) -> str:
    text = " ".join(str(exc).split())
    return text[:180] + ("..." if len(text) > 180 else "")


def _launch_chromium(p, headless: bool, log: LogFn):
    """
    Tự động ưu tiên trình duyệt theo thứ tự:
    1. Google Chrome (nếu máy có sẵn)
    2. Safari / WebKit (nếu chạy trên macOS)
    3. Microsoft Edge (nếu máy có sẵn mặc định trên Windows)
    4. Tải ngầm Chromium của Playwright (~150MB, phương án dự phòng cuối cùng)
    """
    global _CHROME_UNAVAILABLE
    with _BROWSER_STATE_LOCK:
        skip_chrome = _CHROME_UNAVAILABLE

    # 1. Ưu tiên Google Chrome. Nếu Windows đã từ chối chạy trong lần đầu,
    # bỏ qua các lần thử tiếp theo của cùng phiên app để không làm chậm mỗi study.
    chrome_error = None
    if not skip_chrome:
        try:
            b = p.chromium.launch(headless=headless, channel="chrome", args=_BROWSER_ARGS)
            log("Dùng trình duyệt có sẵn trên máy: Google Chrome (chạy ngầm).")
            return b
        except Exception as exc:
            chrome_error = exc

        # Chrome cài theo tài khoản Windows đôi khi không được channel tìm thấy.
        for chrome_path in _installed_chrome_paths():
            try:
                b = p.chromium.launch(
                    headless=headless,
                    executable_path=str(chrome_path),
                    args=_BROWSER_ARGS,
                )
                log(f"Dùng Google Chrome tại {chrome_path} (chạy ngầm).")
                return b
            except Exception as exc:
                chrome_error = exc

        with _BROWSER_STATE_LOCK:
            _CHROME_UNAVAILABLE = True
        log(
            "Google Chrome không khởi động được; chuyển sang trình duyệt dự phòng. "
            f"Chi tiết: {_short_browser_error(chrome_error)}"
        )

    # 2. Thử Safari / WebKit (nếu chạy trên macOS)
    try:
        if sys.platform == "darwin" and hasattr(p, "webkit"):
            b = p.webkit.launch(headless=headless)
            log("Dùng trình duyệt có sẵn trên máy: Safari / WebKit (chạy ngầm).")
            return b
    except Exception:
        pass

    # 3. Thử Microsoft Edge (có sẵn mặc định trên Windows)
    try:
        b = p.chromium.launch(headless=headless, channel="msedge", args=_BROWSER_ARGS)
        log("Dùng trình duyệt có sẵn trên máy: Microsoft Edge (chạy ngầm).")
        return b
    except Exception as exc:
        log(f"Microsoft Edge không khởi động được: {_short_browser_error(exc)}")

    # 4. Phương án cuối: Tự động tải & dùng Chromium ảo của Playwright
    ensure_browser(log)
    log("Đang mở trình duyệt dự phòng (Chromium)...")
    return p.chromium.launch(headless=headless, args=_BROWSER_ARGS)


# --------------------------------------------------------------------------- #
#  BƯỚC 1: Tải ảnh từ viewer
# --------------------------------------------------------------------------- #

@dataclass
class DownloadStats:
    dicom: int = 0
    jpg: int = 0
    png: int = 0
    duplicates: int = 0
    series_seen: set = field(default_factory=set)

    def total(self) -> int:
        return self.dicom + self.jpg + self.png


def download_all(
    url: str,
    dicom_dir: Path,
    log: LogFn = _default_log,
    headless: bool = True,
    settle_ms: int = 8000,
    max_slices_per_series: int = 600,
    should_stop: Optional[Callable[[], bool]] = None,
    resume: bool = False,
) -> DownloadStats:
    """
    Tải toàn bộ ảnh của study. Hai chế độ, tự chọn:

      • MẶC ĐỊNH (nhanh, đủ, chính xác): nếu bắt được manifest của viewer
        (VradViewer: StudyData/GetStudies), tải TRỰC TIẾP theo danh sách khóa ảnh
        trong manifest — biết trước số series/ảnh, đối chiếu thiếu/đủ, không click.
      • FALLBACK (viewer lạ không có manifest): mô phỏng người dùng — cuộn/click
        qua từng thumbnail ĐANG HIỂN THỊ và bắt ảnh theo nội dung.

    Trả về DownloadStats. File DICOM lưu vào `dicom_dir`, JPG/PNG bắt trực tiếp
    lưu vào `dicom_dir/../RAW_JPG`.
    """
    import threading
    from playwright.sync_api import sync_playwright

    dicom_dir = Path(dicom_dir)
    dicom_dir.mkdir(parents=True, exist_ok=True)
    raw_jpg_dir = dicom_dir.parent / "RAW_JPG"
    raw_jpg_dir.mkdir(parents=True, exist_ok=True)

    stats = DownloadStats()
    seen_hashes: set[str] = set()
    save_lock = threading.Lock()

    # Chế độ "thử lại/gộp": nạp sẵn ảnh đã có trong folder để KHÔNG ghi đè và KHÔNG
    # tải trùng — chỉ bổ sung ảnh mới. Hữu ích khi lần trước mất mạng/dò hụt.
    if resume:
        for f in sorted(dicom_dir.glob("*.dcm")):
            try:
                seen_hashes.add(hashlib.sha1(f.read_bytes()).hexdigest())
                stats.dicom += 1
            except Exception:
                pass
        for f in sorted(raw_jpg_dir.glob("*.jpg")):
            try:
                seen_hashes.add(hashlib.sha1(f.read_bytes()).hexdigest())
                stats.jpg += 1
            except Exception:
                pass
        for f in sorted(raw_jpg_dir.glob("*.png")):
            try:
                seen_hashes.add(hashlib.sha1(f.read_bytes()).hexdigest())
                stats.png += 1
            except Exception:
                pass
        if stats.total():
            log(f"Thử lại: đã có sẵn {stats.total()} ảnh trong folder — sẽ bổ sung ảnh mới, bỏ trùng.")

    def stop() -> bool:
        return bool(should_stop and should_stop())

    def save_body(body: bytes, _depth: int = 0) -> None:
        """Lưu 1 ảnh (nhận diện theo NỘI DUNG, không phụ thuộc endpoint), tự loại
        trùng theo SHA-1. An toàn khi gọi từ nhiều luồng."""
        if not body:
            return
        data = _maybe_base64_decode(body)
        ext = _guess_ext(data)
        if ext is None:
            # WADO-RS thường gói DICOM trong multipart/related — bóc rồi thử lại
            if _depth == 0:
                for _pct, part in _multipart_parts(data):
                    save_body(part, 1)
            return
        h = hashlib.sha1(data).hexdigest()
        with save_lock:
            if h in seen_hashes:
                stats.duplicates += 1
                return
            seen_hashes.add(h)
            if ext == "dcm":
                stats.dicom += 1; idx = stats.dicom
            elif ext == "jpg":
                stats.jpg += 1; idx = stats.jpg
            else:  # png
                stats.png += 1; idx = stats.png
            n = stats.total()
        if ext == "dcm":
            (dicom_dir / f"img_{idx:05d}.dcm").write_bytes(data)
            if n % 25 == 0:
                log(f"  ...đã tải {n} ảnh (DICOM: {stats.dicom})")
        elif ext == "jpg":
            (raw_jpg_dir / f"img_{idx:05d}.jpg").write_bytes(data)
        else:
            (raw_jpg_dir / f"img_{idx:05d}.png").write_bytes(data)

    # Thu thập manifest của các dòng viewer đã biết:
    #   • VradViewer  -> StudyData/GetStudies (+ 1 URL ảnh thật làm khuôn)
    #   • vrpacs/telerad -> vrpacs-file/get-share-patient-image
    captured = {"getstudies": None, "template_url": None, "vrpacs": None,
                "qido_series": None, "wado_tmpl": None, "host": None, "cookies": None,
                "api_headers": None, "session_error": None}

    def _want_capture(resp) -> bool:
        u = resp.url
        if any(k in u for k in ("GetImage", "dicomData", "DicomImage", "wado",
                                "/frames/", "/instances/", "/preview")):
            return True
        ct = resp.headers.get("content-type", "").lower()
        return ("dicom" in ct) or ("octet-stream" in ct)

    def on_response(response) -> None:
        try:
            u = response.url
            ct = response.headers.get("content-type", "").lower()
            # Session/share bị server từ chối (vd PACS BV Hà Tĩnh trả 400 khi
            # link hết hạn: /ws/rest/v1/session/<uuid>)
            if (captured["session_error"] is None and response.status >= 400
                    and re.search(r"/(session|share)s?/[0-9a-fA-F\-]{8,}", u)):
                captured["session_error"] = str(response.status)
            if "StudyData/GetStudies" in u and captured["getstudies"] is None:
                captured["getstudies"] = response.body()
                return
            if "get-share-patient-image" in u and captured["vrpacs"] is None:
                captured["vrpacs"] = response.body()
                return
            # DICOMweb QIDO: danh sách series (…/studies/<uid>/series)
            if (captured["qido_series"] is None 
                    and u.split("?")[0].rstrip("/").endswith("/series")):
                captured["qido_series"] = u
                # giữ lại "giấy thông hành" viewer dùng (Authorization, X-...)
                # để tải trực tiếp ngoài trình duyệt bằng đúng quyền đó
                try:
                    captured["api_headers"] = response.request.all_headers()
                except Exception:
                    try:
                        captured["api_headers"] = dict(response.request.headers)
                    except Exception:
                        pass
                return
            if _want_capture(response):
                if (captured["template_url"] is None
                        and "GetImage" in u and "Jpeg" not in u):
                    captured["template_url"] = u
                if (captured["wado_tmpl"] is None and ct.startswith("application/dicom")
                        and "json" not in ct and ("wado" in u.lower() or "objectuid" in u.lower())):
                    captured["wado_tmpl"] = u
                save_body(response.body())  # bắt thụ động (bonus + an toàn cho fallback)
        except Exception:
            pass  # không để lỗi 1 response làm hỏng cả phiên

    def _have_manifest() -> bool:
        # QIDO series một mình là đủ: phần tải sẽ tự dò WADO-URI / WADO-RS /
        # dựng lại từ frames (PACS BV Hà Tĩnh không phát URL chứa chữ "wado").
        return bool((captured["getstudies"] and captured["template_url"])
                    or captured["vrpacs"]
                    or captured["qido_series"])

    used_manifest = False
    with sync_playwright() as p:
        browser = _launch_chromium(p, headless, log)
        # ignore_https_errors: chấp nhận chứng chỉ tự ký của PACS (HTTPS cổng lạ).
        context = browser.new_context(viewport={"width": 1600, "height": 1000},
                                      ignore_https_errors=True)
        page = context.new_page()
        page.on("response", on_response)

        log("Đang tải trang viewer (không chỉnh sửa link)...")
        try:
            page.goto(url, wait_until="domcontentloaded", timeout=60000)
        except Exception as e:
            log(f"  Cảnh báo khi tải trang: {e}")

        try:
            if "urlExpired" in page.url or "Message/Error" in page.url:
                log("!!! Link đã HẾT HẠN (urlExpired). Hãy lấy link mới từ trang xem rồi thử lại.")
                browser.close()
                return stats
        except Exception:
            pass

        # Chờ manifest (hoặc 1 ảnh mẫu) xuất hiện (tối đa ~12s)
        log("Đang dò manifest của viewer...")
        for _ in range(24):
            if stop() or _have_manifest() or captured["session_error"]:
                break
            page.wait_for_timeout(500)

        # Session chết (server trả 4xx cho API session, hoặc viewer hiện
        # "Cannot view images") -> báo rõ HẾT HẠN thay vì lặng lẽ ra 0 ảnh.
        if not _have_manifest():
            expired = bool(captured["session_error"])
            if not expired:
                try:
                    txt = (page.evaluate(
                        "() => document.body ? document.body.innerText : ''") or "").lower()
                    expired = ("cannot view images" in txt) or ("urlexpired" in txt)
                except Exception:
                    pass
            if expired:
                code = captured["session_error"] or "?"
                log(f"!!! Link đã HẾT HẠN / SESSION không còn hiệu lực (server trả {code}). "
                    f"Hãy lấy LINK MỚI từ trang xem rồi tải lại NGAY (loại link này sống rất ngắn).")
                browser.close()
                return stats

        if _have_manifest():
            used_manifest = True
            try:
                from urllib.parse import urlparse as _up
                pu = _up(page.url)
                captured["host"] = f"{pu.scheme}://{pu.netloc}"
                captured["cookies"] = context.cookies()
            except Exception:
                pass
            log("✓ Có manifest → tải TRỰC TIẾP theo API (không cần click/cuộn).")
            browser.close()
        else:
            log("Không thấy manifest → chế độ MÔ PHỎNG (cuộn/click), chỉ xử lý xung ĐANG HIỂN THỊ.")
            page.wait_for_timeout(1500)
            _drive_viewer(page, log, stats, max_slices_per_series, stop)
            log(f"Chờ {settle_ms/1000:.0f}s để bắt nốt ảnh còn lại...")
            try:
                page.wait_for_load_state("networkidle", timeout=settle_ms)
            except Exception:
                page.wait_for_timeout(settle_ms)
            browser.close()

    # Tải trực tiếp (ngoài trình duyệt, bằng HTTP) nếu có manifest
    if used_manifest and not stop():
        if captured["getstudies"] and captured["template_url"]:
            _download_via_manifest(captured, save_body, stats, log, stop)      # VradViewer
        elif captured["vrpacs"]:
            _download_via_vrpacs(captured, save_body, stats, log, stop)        # vrpacs/telerad
        elif captured["qido_series"]:
            _download_via_dicomweb(captured, save_body, stats, log, stop)      # OHIF/DICOMweb

    log(f"Tải xong. Tổng ảnh: {stats.total()} "
        f"(DICOM {stats.dicom}, JPG {stats.jpg}, PNG {stats.png}, trùng bỏ {stats.duplicates}).")
    return stats


def _download_via_manifest(captured, save_body, stats,
                           log: LogFn, stop: Callable[[], bool]) -> None:
    """
    Tải trực tiếp MỌI ảnh dựa trên manifest VradViewer (StudyData/GetStudies) +
    1 URL ảnh thật làm khuôn tham số. Không click/cuộn, biết trước số ảnh và đối
    chiếu đủ/thiếu. Chữ ký (signature) lấy từ chính manifest theo từng ảnh.
    """
    import json
    import ssl
    import urllib.request
    from urllib.parse import urlparse, parse_qs, urlencode
    from concurrent.futures import ThreadPoolExecutor

    sslctx = ssl.create_default_context()
    sslctx.check_hostname = False
    sslctx.verify_mode = ssl.CERT_NONE  # chấp nhận chứng chỉ tự ký (HTTPS PACS)

    try:
        j = json.loads(captured["getstudies"].decode("utf-8", "replace"))
    except Exception as e:
        log(f"  Lỗi đọc manifest ({e}) — bỏ qua, dùng ảnh bắt thụ động.")
        return

    data = j.get("data", j)
    study = data[0] if isinstance(data, list) and data else data
    series_list = study.get("SeriesList", []) if isinstance(study, dict) else []
    if not series_list:
        log("  Manifest không có SeriesList — bỏ qua.")
        return

    # Khuôn lấy từ 1 URL ảnh THẬT mà trình duyệt đã tải được:
    #   - các tham số cấp study/share (vendorCode, patId, iq, lossless...)
    #   - QUAN TRỌNG: host+path công khai. (ImageBaseUrl trong manifest hay là IP
    #     nội bộ kiểu 192.168.x — ra ngoài không tới được, gây timeout.)
    tp = urlparse(captured["template_url"])
    tmpl_base = f"{tp.scheme}://{tp.netloc}{tp.path}" if tp.netloc else None
    tmpl = {k: v[0] for k, v in parse_qs(tp.query).items()}

    def obj_key(web: str):
        if not web:
            return None
        q = web[1:] if web.startswith("?") else web
        return parse_qs(q).get("imageObjKey", [None])[0]

    tasks = []
    total_expected = 0
    for s in series_list:
        total_expected += int(s.get("ImageCount", 0) or 0)
        base = tmpl_base or s.get("ImageBaseUrl")  # ưu tiên host công khai từ URL thật
        if not base:
            continue
        for im in (s.get("ImageList", []) or []):
            io = obj_key(im.get("WebUrl") or "")
            if not io:
                continue
            params = dict(tmpl)
            params["imageObjKey"] = io
            params["signature"] = im.get("Signature", "")
            params["seriesuid"] = s.get("SeriesInsUID", params.get("seriesuid", ""))
            params["studyuid"] = s.get("StuInsUID", params.get("studyuid", ""))
            params["imageUid"] = im.get("SOPInstanceUID", "")
            params["imageid"] = str(im.get("ImageID", 0))
            exp = s.get("Expires") or im.get("Expires")
            if exp:
                params["expires"] = str(exp)
            tasks.append(base + "?" + urlencode(params))

    log(f"Manifest: {len(series_list)} series, ~{total_expected} ảnh. "
        f"Đang tải trực tiếp {len(tasks)} ảnh (6 luồng song song)...")

    def fetch_one(u):
        if stop():
            return
        try:
            with urllib.request.urlopen(u, timeout=45, context=sslctx) as r:
                save_body(r.read())
        except Exception:
            pass

    with ThreadPoolExecutor(max_workers=6) as ex:
        list(ex.map(fetch_one, tasks))

    if total_expected and stats.dicom >= total_expected:
        log(f"  ✓ Đã đủ theo manifest: {stats.dicom}/{total_expected} ảnh.")
    else:
        miss = max(0, total_expected - stats.dicom)
        log(f"  ⚠ Tải được {stats.dicom}/{total_expected} ảnh — thiếu {miss} "
            f"(có thể do mạng/timeout; chạy lại sẽ bù, ảnh trùng tự bỏ).")


def _download_via_vrpacs(captured, save_body, stats,
                         log: LogFn, stop: Callable[[], bool]) -> None:
    """
    Tải trực tiếp mọi ảnh từ manifest của viewer vrpacs/telerad
    (vrpacs-file/get-share-patient-image). Mỗi ảnh là 1 imageId dạng
    'wadouri:/vrpacs-scu/study-get-public?link=...&file=<uid>.dcm' — chỉ cần bỏ
    tiền tố 'wadouri:' và ghép host là tải được DICOM gốc.
    """
    import json
    import ssl
    import urllib.request
    from concurrent.futures import ThreadPoolExecutor

    try:
        j = json.loads(captured["vrpacs"].decode("utf-8", "replace"))
    except Exception as e:
        log(f"  Lỗi đọc manifest vrpacs ({e}) — bỏ qua.")
        return

    data = j.get("data", {}) if isinstance(j, dict) else {}
    studies = data.get("studyList", []) if isinstance(data, dict) else []
    host = (captured.get("host") or "").rstrip("/")

    def to_url(image_id: str):
        s = image_id
        for pref in ("wadouri:", "wadors:", "dicomweb:", "dicomfile:"):
            if s.startswith(pref):
                s = s[len(pref):]
                break
        if s.startswith("http"):
            return s
        return host + "/" + s.lstrip("/")

    tasks, n_series = [], 0
    for st in studies:
        for se in (st.get("seriesList", []) or []):
            n_series += 1
            for iid in (se.get("imageIds", []) or []):
                if iid:
                    tasks.append(to_url(iid))

    cj = "; ".join(f'{c.get("name")}={c.get("value")}' for c in (captured.get("cookies") or []))
    sslctx = ssl.create_default_context()
    sslctx.check_hostname = False
    sslctx.verify_mode = ssl.CERT_NONE

    log(f"Manifest (vrpacs): {n_series} series, {len(tasks)} ảnh. "
        f"Đang tải trực tiếp (6 luồng song song)...")

    def fetch_one(u):
        if stop():
            return
        try:
            req = urllib.request.Request(u, headers={"Cookie": cj} if cj else {})
            with urllib.request.urlopen(req, timeout=45, context=sslctx) as r:
                save_body(r.read())
        except Exception:
            pass

    with ThreadPoolExecutor(max_workers=6) as ex:
        list(ex.map(fetch_one, tasks))

    total = len(tasks)
    if total and stats.dicom >= total:
        log(f"  ✓ Đã đủ theo manifest: {stats.dicom}/{total} ảnh.")
    else:
        log(f"  ⚠ Tải được {stats.dicom}/{total} ảnh — thiếu {max(0,total-stats.dicom)} "
            f"(có thể do mạng/timeout; chạy lại sẽ bù, ảnh trùng tự bỏ).")


def _download_via_dicomweb(captured, save_body, stats,
                           log: LogFn, stop: Callable[[], bool]) -> None:
    """
    Tải trực tiếp mọi ảnh từ viewer chuẩn DICOMweb (OHIF / dcm4chee / Orthanc /
    static-wado như PACS BV Đa khoa Hà Tĩnh...). QIDO-RS liệt kê series +
    instances, rồi lấy DICOM theo thứ tự ưu tiên TỰ DÒ (nhớ cách thành công):
      • wadouri: WADO-URI ?requestType=WADO (khuôn bắt từ URL thật / dcm4chee)
      • wadors : GET .../instances/<uid>  (multipart, file Part-10 trọn vẹn)
      • frames : GET .../metadata + .../frames/N rồi DỰNG LẠI file DICOM —
                 cách duy nhất với viewer chỉ phát theo frame như BV Hà Tĩnh.
    """
    import json
    import ssl
    import urllib.request
    from urllib.parse import urlparse, parse_qs, urlencode
    from concurrent.futures import ThreadPoolExecutor

    qp = urlparse(captured["qido_series"])
    rs_base = f"{qp.scheme}://{qp.netloc}{qp.path.split('/studies/')[0]}"
    try:
        study = qp.path.split("/studies/")[1].split("/series")[0]
    except Exception:
        log("  Không tách được studyUID từ QIDO — bỏ qua."); return

    if captured.get("wado_tmpl"):
        wp = urlparse(captured["wado_tmpl"])
        wado_base = f"{wp.scheme}://{wp.netloc}{wp.path}"
        wtmpl = {k: v[0] for k, v in parse_qs(wp.query).items()}
        order = ["wadouri", "wadors", "frames"]
    else:  # không có khuôn WADO-URI thật -> ưu tiên WADO-RS, dcm4chee để chót
        wado_base = rs_base.rsplit("/rs", 1)[0] + "/wado"
        wtmpl = {"requestType": "WADO", "contentType": "application/dicom", "transferSyntax": "*"}
        order = ["wadors", "frames", "wadouri"]

    # Gửi lại đúng "giấy thông hành" viewer đã dùng: cookie + header phiên
    # (Authorization, X-...) bắt từ request QIDO thật.
    hdr = {}
    for k, v in (captured.get("api_headers") or {}).items():
        lk = k.lower()
        if lk.startswith("x-") or lk in ("authorization", "token", "session", "session-id"):
            hdr[k] = v
    cj = "; ".join(f'{c.get("name")}={c.get("value")}' for c in (captured.get("cookies") or []))
    if cj:
        hdr["Cookie"] = cj

    sslctx = ssl.create_default_context()
    sslctx.check_hostname = False
    sslctx.verify_mode = ssl.CERT_NONE

    def get_raw(u, accept=None):
        h = dict(hdr)
        if accept:
            h["Accept"] = accept
        req = urllib.request.Request(u, headers=h)
        with urllib.request.urlopen(req, timeout=60, context=sslctx) as r:
            return r.read(), (r.headers.get("Content-Type") or "")

    def get_json(u):
        body, _ = get_raw(u, accept="application/dicom+json, application/json")
        return json.loads(body.decode("utf-8", "replace"))

    def V(el, tag):
        v = (el.get(tag, {}) or {}).get("Value", [None])
        return v[0] if v else None

    try:
        series = get_json(f"{rs_base}/studies/{study}/series")
    except Exception as e:
        log(f"  Lỗi QIDO series ({e}) — bỏ qua."); return

    log(f"DICOMweb: {len(series)} series. Đang liệt kê ảnh...")
    tasks = []  # (seriesUID, sopInstanceUID, số frame theo QIDO)
    for s in series:
        if stop():
            break
        suid = V(s, "0020000E")
        if not suid:
            continue
        try:
            insts = get_json(f"{rs_base}/studies/{study}/series/{suid}/instances")
        except Exception:
            insts = []
        if not insts:
            try:
                insts = get_json(f"{rs_base}/studies/{study}/series/{suid}/metadata")
            except Exception:
                insts = []
        for i in insts:
            iuid = V(i, "00080018")
            if iuid:
                try:
                    nf = int(str(V(i, "00280008") or 1))
                except Exception:
                    nf = 1
                tasks.append((suid, iuid, max(1, nf), i))

    total = len(tasks)
    log(f"DICOMweb: {len(series)} series, {total} ảnh. Đang tải trực tiếp (6 luồng song song)...")

    def try_wadouri(suid, iuid, nf, meta_in):
        params = {k: v for k, v in wtmpl.items()
                  if k.lower() not in ("studyuid", "seriesuid", "objectuid")}
        params["studyUID"] = study
        params["seriesUID"] = suid
        params["objectUID"] = iuid
        params.setdefault("requestType", "WADO")
        params.setdefault("contentType", "application/dicom")
        params.setdefault("transferSyntax", "*")
        body, _ct = get_raw(wado_base + "?" + urlencode(params))
        if _guess_ext(_maybe_base64_decode(body)) is None and not _multipart_parts(body):
            return False
        save_body(body)
        return True

    def try_wadors(suid, iuid, nf, meta_in):
        u = f"{rs_base}/studies/{study}/series/{suid}/instances/{iuid}"
        body, ct = get_raw(u, accept='multipart/related; type="application/dicom", application/dicom')
        ok = False
        for _pct, d in (_multipart_parts(body, ct) or [("", body)]):
            if _guess_ext(d) == "dcm":
                save_body(d)
                ok = True
        return ok

    def try_frames(suid, iuid, nf, meta_in):
        base = f"{rs_base}/studies/{study}/series/{suid}/instances/{iuid}"
        meta = meta_in if meta_in else {}
        if isinstance(meta, list):
            meta = meta[0] if meta else {}
        try:
            nf = max(nf, int(str(V(meta, "00280008") or nf)))
        except Exception:
            pass
        frames, fct = [], ""
        for fi in range(1, nf + 1):
            body, ct = get_raw(f"{base}/frames/{fi}",
                               accept='multipart/related; type="application/octet-stream", */*')
            parts = _multipart_parts(body, ct)
            if parts:
                fct = fct or parts[0][0]
                frames.extend(d for _pct, d in parts)
            else:
                fct = fct or ct
                frames.append(body)
        if not any(frames):
            return False
        blob = _dicom_from_meta_frames(meta, frames, fct)
        if not blob:
            return False
        save_body(blob)
        return True

    fetchers = {"wadouri": try_wadouri, "wadors": try_wadors, "frames": try_frames}

    def fetch_one(task):
        if stop():
            return
        suid, iuid, nf, meta_in = task
        for name in list(order):
            try:
                if fetchers[name](suid, iuid, nf, meta_in):
                    if order[0] != name:  # nhớ cách vừa thành công cho các ảnh sau
                        order.remove(name)
                        order.insert(0, name)
                    return
            except Exception:
                continue

    with ThreadPoolExecutor(max_workers=6) as ex:
        list(ex.map(fetch_one, tasks))

    if total and stats.dicom >= total:
        log(f"  ✓ Đã đủ theo manifest: {stats.dicom}/{total} ảnh.")
    else:
        log(f"  ⚠ Tải được {stats.dicom}/{total} ảnh — thiếu {max(0,total-stats.dicom)} "
            f"(có thể do mạng/timeout; chạy lại sẽ bù, ảnh trùng tự bỏ).")


def _drive_viewer(page, log: LogFn, stats: DownloadStats,
                  max_slices: int, stop: Callable[[], bool]) -> None:
    """Bấm qua từng series và cuộn hết lát cắt để ép viewer tải ảnh."""
    # Chờ danh sách series
    try:
        page.wait_for_selector(".seriesThumb, .serieslist_panel_list, .seriesBox",
                               timeout=25000)
    except Exception:
        log("  Không thấy danh sách series (có thể giao diện khác). Vẫn thử cuộn ảnh hiện tại.")

    # Cuộn panel series để nạp hết thumbnail (nếu danh sách dài)
    try:
        panels = page.query_selector_all(".serieslist_panel_list, .verlist, .seriesThumb_container")
        for panel in panels:
            for _ in range(8):
                page.evaluate("(el) => el.scrollTop = el.scrollHeight", panel)
                page.wait_for_timeout(120)
    except Exception:
        pass

    thumbs = page.query_selector_all(".seriesThumb:visible")  # chỉ xung ĐANG HIỂN THỊ (bỏ bản ẩn trùng)
    n_series = len(thumbs)
    log(f"Phát hiện {n_series} series (xung) đang hiển thị để duyệt." if n_series
        else "Không tìm thấy thumbnail series theo class chuẩn; sẽ cuộn ảnh đang hiển thị.")

    def scroll_current_viewport(expected: int) -> None:
        """Đưa chuột vào vùng ảnh chính và cuộn qua toàn bộ lát cắt."""
        target = None
        for sel in (".viewer_imageregion", ".imageBox", ".imagebox_container",
                    ".cornerstone-canvas", ".imageviewBox"):
            el = page.query_selector(sel)
            if el:
                try:
                    box = el.bounding_box()
                    if box and box["width"] > 100 and box["height"] > 100:
                        target = box
                        break
                except Exception:
                    continue
        if not target:
            return
        cx = target["x"] + target["width"] / 2
        cy = target["y"] + target["height"] / 2
        page.mouse.move(cx, cy)
        steps = min(max(expected + 10, 60), max_slices)
        for i in range(steps):
            if stop():
                return
            try:
                page.mouse.wheel(0, 110)
            except Exception:
                break
            if i % 8 == 0:
                page.wait_for_timeout(90)
            else:
                page.wait_for_timeout(35)

    if n_series == 0:
        # Không có thumbnail -> chỉ cuộn viewport hiện tại
        scroll_current_viewport(max_slices)
        return

    for idx in range(n_series):
        if stop():
            log("Đã dừng theo yêu cầu.")
            return
        # Query lại mỗi vòng vì DOM có thể render lại
        thumbs = page.query_selector_all(".seriesThumb:visible")
        if idx >= len(thumbs):
            break
        thumb = thumbs[idx]

        # Đọc số ảnh của series (nếu có) để biết cuộn bao nhiêu
        expected = max_slices
        try:
            cnt_el = thumb.query_selector(".series_imagecount_text")
            if cnt_el:
                txt = (cnt_el.inner_text() or "").strip()
                m = re.search(r"\d+", txt)
                if m:
                    expected = int(m.group())
        except Exception:
            pass

        desc = ""
        try:
            d_el = thumb.query_selector(".series_description_text, .series_number_text")
            if d_el:
                desc = (d_el.inner_text() or "").strip()
        except Exception:
            pass

        log(f"[Series {idx+1}/{n_series}] {desc}  (~{expected} ảnh) — đang nạp...")
        before = stats.total()
        try:
            thumb.scroll_into_view_if_needed(timeout=5000)
            thumb.click(timeout=5000)
        except Exception:
            try:
                thumb.dblclick(timeout=5000)
            except Exception:
                log("   (không bấm được thumbnail này, bỏ qua)")
                continue
        page.wait_for_timeout(700)

        scroll_current_viewport(expected)

        # Thử duyệt phase (nếu series có nhiều phase)
        try:
            phase_btns = page.query_selector_all(".seriesPhaseUI button, .seriesPhaseUI .checkable_icon")
            for pb in phase_btns[:20]:
                if stop():
                    return
                try:
                    pb.click(timeout=1500)
                    page.wait_for_timeout(300)
                    scroll_current_viewport(expected)
                except Exception:
                    pass
        except Exception:
            pass

        gained = stats.total() - before
        log(f"   -> series này thêm {gained} ảnh (tổng {stats.total()}).")


# --------------------------------------------------------------------------- #
#  BƯỚC 2: DICOM -> JPG chất lượng cao
# --------------------------------------------------------------------------- #

@dataclass
class ConvertStats:
    converted: int = 0
    skipped: int = 0
    failed: int = 0
    mpr_converted: int = 0
    mpr_series: str = ""


def _safe_name(text) -> str:
    text = str(text) if text is not None else "Unknown"
    text = re.sub(r'[\\/:*?"<>|]+', "_", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text[:80] if text else "Unknown"


# Chế độ tương phản:
#   "clinical" (mặc định) — bám đúng cửa sổ hiển thị y khoa. Dùng apply_voi_lut
#       của pydicom nên xử lý đúng cả 3 kiểu: window tuyến tính (WC/WW), hàm
#       SIGMOID, và VOI LUT Sequence (bảng tra phi tuyến của máy đời mới). Sau đó
#       map min-max sang 8-bit, KHÔNG cắt percentile -> giữ nguyên độ tương phản
#       như một máy trạm PACS hiển thị mặc định.
#   "auto" — kéo giãn tương phản theo percentile(1,99) của từng ảnh. Nhìn "gắt"
#       hơn, nổi chi tiết mờ, nhưng lệch khỏi cửa sổ lâm sàng và có thể cháy 1%
#       điểm sáng nhất. Dành cho ai thích ảnh đậm.
CLINICAL = "clinical"
AUTO = "auto"


def _stretch_uint8(arr, low, high):
    import numpy as np
    if high <= low:
        return np.zeros(arr.shape, dtype=np.uint8)
    out = (np.clip(arr, low, high) - low) / (high - low) * 255.0
    return out.astype(np.uint8)


def _gray_to_uint8(arr, ds, contrast_mode: str):
    """Chuyển 1 khung ảnh xám (đã qua modality LUT) sang 8-bit theo chế độ tương phản."""
    import numpy as np

    arr = arr.astype(np.float32)

    if contrast_mode == AUTO:
        low, high = np.percentile(arr, (1, 99))
        if high <= low:
            low, high = float(arr.min()), float(arr.max())
        return _stretch_uint8(arr, low, high)

    # CLINICAL: để pydicom áp VOI đúng chuẩn (LUT sequence / sigmoid / linear)
    try:
        try:
            from pydicom.pixels import apply_voi_lut
        except ImportError:  # pragma: no cover - compatibility with pydicom 2.4
            from pydicom.pixel_data_handlers.util import apply_voi_lut
        v = apply_voi_lut(arr, ds).astype(np.float32)
        if float(v.max()) > float(v.min()):
            return _stretch_uint8(v, float(v.min()), float(v.max()))
    except Exception:
        pass

    # Không có thông tin window (WC/WW, VOI LUT...) -> kéo giãn nhẹ theo percentile
    low, high = np.percentile(arr, (0.5, 99.5))
    if high <= low:
        low, high = float(arr.min()), float(arr.max())
    return _stretch_uint8(arr, low, high)


def _rgb_to_uint8(arr):
    """Ảnh màu: giữ nguyên nếu đã 8-bit, ngược lại kéo giãn min-max."""
    import numpy as np
    if arr.dtype == np.uint8:
        return arr
    a = arr.astype(np.float32)
    return _stretch_uint8(a, float(a.min()), float(a.max()))


def _dicom_to_frames(ds, contrast_mode: str = CLINICAL):
    import numpy as np
    try:
        from pydicom.pixels import apply_modality_lut
    except ImportError:  # pragma: no cover - compatibility with pydicom 2.4
        from pydicom.pixel_data_handlers.util import apply_modality_lut

    try:
        arr = apply_modality_lut(ds.pixel_array, ds)
    except Exception:
        arr = ds.pixel_array

    photometric = getattr(ds, "PhotometricInterpretation", "")
    invert = photometric == "MONOCHROME1"

    frames = []

    def prep_gray(a):
        img = _gray_to_uint8(a, ds, contrast_mode)
        if invert:
            img = 255 - img
        return img

    if arr.ndim == 2:
        frames.append(prep_gray(arr))
    elif arr.ndim == 3 and arr.shape[-1] not in (3, 4):
        for i in range(arr.shape[0]):
            frames.append(prep_gray(arr[i]))
    elif arr.ndim == 3 and arr.shape[-1] in (3, 4):
        frames.append(_rgb_to_uint8(arr))
    elif arr.ndim == 4:
        for i in range(arr.shape[0]):
            frames.append(_rgb_to_uint8(arr[i]))

    return frames


def convert_all(
    dicom_dir: Path,
    jpg_dir: Path,
    log: LogFn = _default_log,
    quality: int = 100,
    save_png: bool = False,
    contrast_mode: str = CLINICAL,
    should_stop: Optional[Callable[[], bool]] = None,
) -> ConvertStats:
    """Chuyển toàn bộ DICOM trong `dicom_dir` sang JPG (và tùy chọn PNG) ở `jpg_dir`."""
    import pydicom
    from PIL import Image
    import mpr_engine

    dicom_dir = Path(dicom_dir)
    jpg_dir = Path(jpg_dir)
    jpg_dir.mkdir(parents=True, exist_ok=True)

    mode_txt = "auto-contrast" if contrast_mode == AUTO else "chuẩn lâm sàng (VOI LUT)"
    dcm_files = discover_dicom_files(dicom_dir)
    log(f"Chuyển đổi: tìm thấy {len(dcm_files)} file DICOM. Chất lượng JPG={quality}"
        f"{' + PNG' if save_png else ''}, tương phản={mode_txt}.")

    stats = ConvertStats()
    mpr_candidates = []
    converted_mpr_uids: set[str] = set()
    mpr_series_names: list[str] = []

    # Keep every eligible T1 3D series (post-contrast and pre-contrast).  The
    # SeriesInstanceUID-backed folder name prevents same-name series from
    # overwriting each other.
    try:
        mpr_candidates = mpr_engine.select_mpr_candidates(dicom_dir)
    except Exception as e:
        log(f"MPR-JPG: kh\u00f4ng qu\u00e9t \u0111\u01b0\u1ee3c series T1 ({e}); ti\u1ebfp t\u1ee5c lu\u1ed3ng JPG th\u01b0\u1eddng.")

    for candidate in mpr_candidates:
        label = {
            "T1_POST_CONTRAST": "T1 sau ti\u00eam",
            "T1_PRE_CONTRAST": "T1 kh\u00f4ng ti\u00eam",
            "CT_VOLUME": "CT volume",
        }.get(candidate.kind, candidate.kind)
        log(
            "MPR-JPG ch\u1ecdn: "
            f"{candidate.description} - {len(candidate.slices)} l\u00e1t - {label} - "
            f"UID {candidate.series_uid}."
        )
        try:
            count, _ = mpr_engine.convert_mpr_candidate(
                candidate,
                jpg_dir,
                quality=100,
                log=log,
                should_stop=should_stop,
            )
            stats.converted += count
            stats.mpr_converted += count
            converted_mpr_uids.add(candidate.series_uid)
            mpr_series_names.append(f"{candidate.description} ({label})")
        except InterruptedError:
            log("\u0110\u00e3 d\u1eebng khi \u0111ang t\u1ea1o MPR-JPG.")
            stats.mpr_series = " | ".join(mpr_series_names)
            return stats
        except Exception as e:
            # Keep the failed series available to the normal JPG path.
            log(f"MPR-JPG l\u1ed7i cho {candidate.description} ({e}); chuy\u1ec3n series n\u00e0y theo lu\u1ed3ng JPG th\u01b0\u1eddng.")
            try:
                folder = jpg_dir / candidate.folder_name
                for partial in folder.glob("MPR_*.jpg"):
                    partial.unlink()
                manifest = folder / mpr_engine.MANIFEST_NAME
                if manifest.exists():
                    manifest.unlink()
                if folder.exists() and not any(folder.iterdir()):
                    folder.rmdir()
            except Exception:
                pass

    stats.mpr_series = " | ".join(mpr_series_names)

    for path in dcm_files:
        if should_stop and should_stop():
            log("Đã dừng chuyển đổi theo yêu cầu.")
            break
        try:
            ds = pydicom.dcmread(str(path), force=True)
            if "PixelData" not in ds:
                stats.skipped += 1
                continue

            series_uid = str(getattr(ds, "SeriesInstanceUID", "") or "")
            if not series_uid:
                series_uid = (
                    f"fallback:{getattr(ds, 'SeriesNumber', '')}:"
                    f"{getattr(ds, 'SeriesDescription', '')}"
                )
            if series_uid in converted_mpr_uids:
                # Series already converted as a geometry-preserving MPR package.
                continue

            series_number = getattr(ds, "SeriesNumber", "NoSeries")
            series_desc = _safe_name(getattr(ds, "SeriesDescription", "UnknownSeries"))
            instance_number = getattr(ds, "InstanceNumber", stats.converted + 1)

            series_folder = jpg_dir / mpr_engine.series_folder_name(
                series_number, series_desc, series_uid,
            )
            series_folder.mkdir(exist_ok=True)

            frames = _dicom_to_frames(ds, contrast_mode)
            multi = len(frames) > 1

            for fidx, img_arr in enumerate(frames, start=1):
                img = Image.fromarray(img_arr)
                if img.mode not in ("L", "RGB"):
                    img = img.convert("L")

                inst = str(instance_number)
                base = (f"IM_{int(inst):04d}" if inst.isdigit()
                        else f"IM_{_safe_name(inst)}")
                if multi:
                    base += f"_F{fidx:03d}"

                img.save(series_folder / f"{base}.jpg", "JPEG",
                         quality=quality, optimize=True, subsampling=0)
                if save_png:
                    img.save(series_folder / f"{base}.png", "PNG", optimize=True)

                stats.converted += 1

            if stats.converted % 50 == 0:
                log(f"  ...đã chuyển {stats.converted} ảnh")
        except Exception as e:
            stats.failed += 1
            log(f"  Lỗi file {path.name}: {e}")

    log(f"Chuyển đổi xong: {stats.converted} ảnh JPG"
        f"{' (+PNG)' if save_png else ''}, bỏ qua {stats.skipped}, lỗi {stats.failed}.")
    if stats.mpr_converted:
        log(
            f"MPR-JPG s\u1eb5n s\u00e0ng: {len(converted_mpr_uids)} series - "
            f"{stats.mpr_converted} l\u00e1t - {stats.mpr_series}."
        )

    return stats


# --------------------------------------------------------------------------- #
#  Tóm tắt số series/ảnh đã tải (để kiểm tra đủ chưa)
# --------------------------------------------------------------------------- #

def summarize_dicom(dicom_dir: Path, log: LogFn = _default_log) -> None:
    import pydicom

    dicom_dir = Path(dicom_dir)
    by_series: dict[str, int] = {}
    for p in dicom_dir.rglob("*.dcm"):
        try:
            ds = pydicom.dcmread(str(p), stop_before_pixels=True, force=True)
            key = f"{getattr(ds,'SeriesNumber','?')} - {getattr(ds,'SeriesDescription','?')}"
            by_series[key] = by_series.get(key, 0) + 1
        except Exception:
            by_series["(không đọc được)"] = by_series.get("(không đọc được)", 0) + 1
    log("Tóm tắt theo series:")
    for k in sorted(by_series):
        log(f"   • {k}: {by_series[k]} ảnh")
    log(f"   Tổng: {sum(by_series.values())} ảnh, {len(by_series)} series.")


# --------------------------------------------------------------------------- #
#  CLI
# --------------------------------------------------------------------------- #

def _jpg_folder_name(dicom_dir: Path) -> str:
    """
    Tính tên thư mục JPG theo header DICOM: '<ngày chụp> - <tuổi> - <Mô tả study> _ <Modality>'.
    Các trường này còn nguyên kể cả khi hồ sơ đã ẩn danh. Trả 'JPG' nếu không đọc được gì.
    """
    try:
        import pydicom
    except Exception:
        return "JPG"

    date = age = desc = modality = ""
    for p in sorted(Path(dicom_dir).glob("*.dcm"))[:40]:
        try:
            ds = pydicom.dcmread(str(p), stop_before_pixels=True, force=True)
            date = date or str(getattr(ds, "StudyDate", "") or "")
            age = age or str(getattr(ds, "PatientAge", "") or "")
            desc = desc or str(getattr(ds, "StudyDescription", "") or "")
            modality = modality or str(getattr(ds, "Modality", "") or "")
            if date and age and desc and modality:
                break
        except Exception:
            pass

    parts = []
    if len(date) == 8 and date.isdigit():
        parts.append(f"{date[:4]}-{date[4:6]}-{date[6:8]}")   # 20260617 -> 2026-06-17
    elif date:
        parts.append(date)
    if age:
        parts.append(age.lstrip("0") or age)                 # 023Y -> 23Y
    if desc:
        parts.append(desc)

    left = _safe_name(" - ".join(parts))[:70]                 # chừa chỗ cho Modality
    name = f"{left} _ {modality}" if modality else left
    name = re.sub(r'[\\/:*?"<>|]+', "_", name).strip()
    return name or "JPG"


def run_pipeline(
    url: str,
    out_base: Path,
    log: LogFn = _default_log,
    headless: bool = True,
    quality: int = 100,
    save_png: bool = False,
    contrast_mode: str = CLINICAL,
    should_stop: Optional[Callable[[], bool]] = None,
    resume: bool = False,
):
    out_base = Path(out_base)
    dicom_dir = out_base / "DICOM"
    jpg_dir = out_base / "JPG"

    log("=" * 60)
    log("BƯỚC 1/2: Tải ảnh từ viewer" + (" (THỬ LẠI — gộp vào folder cũ)" if resume else ""))
    dl = download_all(url, dicom_dir, log=log, headless=headless,
                      should_stop=should_stop, resume=resume)
    if should_stop and should_stop():
        return dl, None, jpg_dir
    if dl.dicom == 0 and dl.jpg == 0:
        log("Không tải được ảnh nào. Kiểm tra lại link (còn hạn không) và thử tắt chế độ ẩn trình duyệt.")
        return dl, None, jpg_dir

    summarize_dicom(dicom_dir, log=log)

    # Thư mục JPG đặt tên theo hồ sơ: '<ngày> - <tuổi> - <Mô tả study> _ <Modality>'
    jpg_dir = out_base / _jpg_folder_name(dicom_dir)

    log("=" * 60)
    log("BƯỚC 2/2: Chuyển DICOM -> JPG chất lượng cao")
    cv = convert_all(dicom_dir, jpg_dir, log=log, quality=quality,
                     save_png=save_png, contrast_mode=contrast_mode,
                     should_stop=should_stop)
    log("=" * 60)
    log(f"HOÀN TẤT. Ảnh JPG nằm ở: {jpg_dir}")
    return dl, cv, jpg_dir


# --------------------------------------------------------------------------- #
#  BƯỚC 3: TỰ ĐỘNG TÌM KIẾM THEO MÃ BỆNH NHÂN TRÊN RIS (VIỆT ĐỨC & ĐẠI HỌC Y)
# --------------------------------------------------------------------------- #

def _dec_cred(s: str, key: int = 0x57) -> str:
    """Giải mã thông tin tài khoản/mật khẩu an toàn (thời gian giải mã < 0.001ms, không ảnh hưởng tốc độ)."""
    return bytes([b ^ key for b in base64.b64decode(s)]).decode("utf-8")


HOSPITALS = {
    "vduh": {
        "name": "BV Việt Đức",
        "base_url": "https://rad.vduh.org",
        "login_url": "https://rad.vduh.org/ris/account/login",
        "username_enc": "NSQ7JA==",
        "password_enc": "FSEhPjIjMyI0F2Vj",
    },
    "dhy": {
        "name": "BV Đại học Y Hà Nội",
        "base_url": "https://dhy.cdhaviet.vn",
        "login_url": "https://dhy.cdhaviet.vn/ris/account/login",
        "username_enc": "NSQ7JDM/Lg==",
        "password_enc": "Ez8uF2ZlZGNi",
    },
}


_RIS_SESSION_TTL_SECONDS = 30 * 60
_RIS_SESSION_LOCK = threading.Lock()
_RIS_SESSION_STATES: dict[str, dict] = {}


def clear_ris_session_cache(hospital_key: Optional[str] = None) -> None:
    """Xóa phiên RIS trong RAM; cookie/token không bao giờ được ghi xuống ổ đĩa."""
    with _RIS_SESSION_LOCK:
        if hospital_key is None:
            _RIS_SESSION_STATES.clear()
        else:
            _RIS_SESSION_STATES.pop(hospital_key.lower(), None)


def _get_ris_session_state(hospital_key: str) -> Optional[dict]:
    key = hospital_key.lower()
    now = time.monotonic()
    with _RIS_SESSION_LOCK:
        entry = _RIS_SESSION_STATES.get(key)
        if not entry:
            return None
        if now - float(entry["last_used"]) > _RIS_SESSION_TTL_SECONDS:
            _RIS_SESSION_STATES.pop(key, None)
            return None
        entry["last_used"] = now
        return copy.deepcopy(entry["storage_state"])


def _store_ris_session_state(hospital_key: str, storage_state: dict) -> None:
    with _RIS_SESSION_LOCK:
        _RIS_SESSION_STATES[hospital_key.lower()] = {
            "storage_state": copy.deepcopy(storage_state),
            "last_used": time.monotonic(),
        }


def _page_is_ris_login(page) -> bool:
    url = (page.url or "").lower()
    if "/account/login" in url:
        return True
    try:
        password = page.query_selector("input[type='password']")
        return bool(password and password.is_visible())
    except Exception:
        return False


def _perform_ris_login(
    page,
    login_url: str,
    reading_url: str,
    username: str,
    password: str,
) -> bool:
    page.goto(login_url, wait_until="domcontentloaded", timeout=30000)
    page.wait_for_timeout(700)
    acc_inp = (
        page.query_selector("input[name='account']")
        or page.query_selector("input[name='username']")
        or page.query_selector("input[type='text']")
    )
    pwd_inp = (
        page.query_selector("input[name='password']")
        or page.query_selector("input[type='password']")
    )
    if not acc_inp or not pwd_inp:
        return False
    acc_inp.fill(username)
    pwd_inp.fill(password)

    btn = (
        page.query_selector("button[type='submit']:not(.bv-hidden-submit)")
        or page.query_selector("button:has-text('Đăng nhập')")
    )
    if btn and btn.is_visible():
        btn.click()
    else:
        page.keyboard.press("Enter")

    page.wait_for_timeout(1200)
    try:
        page.wait_for_load_state("networkidle", timeout=10000)
    except Exception:
        pass
    page.goto(reading_url, wait_until="domcontentloaded", timeout=15000)
    page.wait_for_timeout(500)
    return not _page_is_ris_login(page)


def _query_ris_studies(page, patient_id: str) -> dict:
    """Truy vấn RIS trong page đã xác thực và phân biệt rõ lỗi hết phiên."""
    return page.evaluate(
        """
        async (patientId) => {
            const encoded = encodeURIComponent(patientId);
            const urls = [
                '/ris/rest/study?pid=' + encoded + '&dateFrom=2019-1-1&dateTo=2030-12-31&status=all&limit=200',
                '/ris/rest/study?keyword=' + encoded + '&fromDate=2019-01-01&toDate=2030-12-31&limit=200',
                '/ris/rest/study?patientId=' + encoded + '&limit=200',
            ];
            const statuses = [];
            for (const url of urls) {
                try {
                    const response = await fetch(url, {
                        method: 'GET',
                        credentials: 'same-origin',
                        cache: 'no-store',
                        redirect: 'follow',
                    });
                    statuses.push(response.status);
                    const finalUrl = (response.url || '').toLowerCase();
                    const contentType = (response.headers.get('content-type') || '').toLowerCase();
                    if (
                        response.status === 401 ||
                        response.status === 403 ||
                        finalUrl.includes('/account/login')
                    ) {
                        return {results: [], authFailed: true, statuses};
                    }
                    if (!response.ok) continue;
                    const text = await response.text();
                    if (
                        contentType.includes('text/html') &&
                        /type\\s*=\\s*["']password|account\\/login/i.test(text)
                    ) {
                        return {results: [], authFailed: true, statuses};
                    }
                    let data;
                    try {
                        data = JSON.parse(text);
                    } catch (_) {
                        continue;
                    }
                    let results = [];
                    if (Array.isArray(data)) results = data;
                    else if (Array.isArray(data?.results)) results = data.results;
                    else if (Array.isArray(data?.data?.results)) results = data.data.results;
                    else if (Array.isArray(data?.data)) results = data.data;
                    if (results.length > 0) {
                        return {results, authFailed: false, statuses};
                    }
                } catch (_) {}
            }
            return {results: [], authFailed: false, statuses};
        }
        """,
        patient_id,
    )


def _study_patient_id(study: dict) -> str:
    for key in (
        "patientId", "patientID", "PatientID", "pid",
        "patientCode", "patientNo", "patientNumber",
    ):
        value = study.get(key)
        if value is not None and str(value).strip():
            return str(value).strip()
    return ""


def _patient_id_matches(study: dict, requested_patient_id: str) -> bool:
    actual = _study_patient_id(study)
    if not actual:
        # Một số RIS bỏ PID vì endpoint đã được giới hạn theo PID truy vấn.
        return True
    normalize = lambda value: re.sub(r"\s+", "", str(value)).upper()
    return normalize(actual) == normalize(requested_patient_id)


def search_patient_studies(
    hospital_key: str,
    patient_id: str,
    modality: str = "MR_CT",
    log: LogFn = _default_log,
    headless: bool = True,
    should_stop: Optional[Callable[[], bool]] = None,
) -> list[dict]:
    """
    Đăng nhập cổng RIS bệnh viện (Việt Đức / ĐH Y), tìm kiếm theo Mã Bệnh Nhân,
    lấy danh sách các study MRI / CT và bóc tách link viewer trực tiếp.
    """
    from playwright.sync_api import sync_playwright

    info = HOSPITALS.get(hospital_key.lower())
    if not info:
        log(f"❌ Không hỗ trợ bệnh viện '{hospital_key}'. Chỉ hỗ trợ: vduh, dhy")
        return []

    base_url = info["base_url"]
    login_url = info["login_url"]
    username = _dec_cred(info["username_enc"]) if "username_enc" in info else info.get("username", "")
    password = _dec_cred(info["password_enc"]) if "password_enc" in info else info.get("password", "")

    reading_url = f"{base_url}/ris/study/reading"
    cached_state = _get_ris_session_state(hospital_key)
    if cached_state:
        log(f"Đang tái sử dụng phiên RIS {info['name']} trong bộ nhớ...")
    else:
        log(f"Đang đăng nhập hệ thống RIS {info['name']} ({base_url})...")
    studies_found = []

    with sync_playwright() as p:
        browser = _launch_chromium(p, headless, log)
        context_options = dict(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            viewport={"width": 1600, "height": 1000},
            ignore_https_errors=True
        )
        if cached_state:
            context_options["storage_state"] = cached_state
        context = browser.new_context(**context_options)
        page = context.new_page()

        try:
            # 1. Thử phiên trong RAM trước; nếu không còn hợp lệ mới đăng nhập.
            session_reused = False
            if cached_state:
                try:
                    page.goto(reading_url, wait_until="domcontentloaded", timeout=15000)
                    page.wait_for_timeout(500)
                    session_reused = not _page_is_ris_login(page)
                except Exception:
                    session_reused = False

            if not session_reused:
                clear_ris_session_cache(hospital_key)
                if not _perform_ris_login(
                    page, login_url, reading_url, username, password,
                ):
                    raise RuntimeError("RIS không xác nhận đăng nhập thành công.")

            # 2. Truy vấn theo PID và nhận biết riêng trường hợp hết phiên.
            log(f"Đang tìm kiếm bệnh nhân mã '{patient_id}' trên hệ thống...")
            api_result = _query_ris_studies(page, patient_id)
            if api_result.get("authFailed"):
                log("Phiên RIS đã hết hạn; đang tự đăng nhập lại một lần...")
                session_reused = False
                clear_ris_session_cache(hospital_key)
                if not _perform_ris_login(
                    page, login_url, reading_url, username, password,
                ):
                    raise RuntimeError("Không thể đăng nhập lại RIS sau khi phiên hết hạn.")
                api_result = _query_ris_studies(page, patient_id)
                if api_result.get("authFailed"):
                    raise RuntimeError("RIS tiếp tục từ chối phiên sau khi đăng nhập lại.")

            _store_ris_session_state(hospital_key, context.storage_state())
            if session_reused:
                log(f"✓ Đã dùng lại phiên RIS {info['name']} — không cần đăng nhập lại.")
            else:
                log(f"✓ Đăng nhập thành công vào RIS {info['name']}!")

            api_data = list(api_result.get("results") or [])

            studies_to_process = []
            if api_data:
                target_mod = (modality or "MR_CT").strip().upper()
                for s in api_data:
                    if not _patient_id_matches(s, patient_id):
                        log(
                            "  ⚠ Bỏ qua study có Patient ID không khớp: "
                            f"{_study_patient_id(s)!r}"
                        )
                        continue
                    m_dicom = str(s.get("modalityDicom") or s.get("modality") or "").strip().upper()
                    desc = str(s.get("studyDescription") or "").strip().upper()
                    
                    # Phân loại MR/MRI (Cộng hưởng từ)
                    is_mr = (m_dicom in ("MR", "MRI")) or ("MR" in m_dicom) or desc.startswith("MR") or ("CONG HUONG TU" in desc) or ("CỘNG HƯỞNG TỪ" in desc)
                    
                    # Phân loại CT/CLVT (Cắt lớp vi tính)
                    is_ct = (m_dicom in ("CT", "CLVT", "CAT")) or ("CT" in m_dicom) or desc.startswith("CT") or desc.startswith("CLVT") or ("CAT LOP" in desc) or ("CẮT LỚP" in desc)
                    
                    if target_mod in ("ALL", "*"):
                        match = True
                    elif target_mod in ("MR_CT", "NEURO", "BRAIN", "MR/CT", "CT/MR"):
                        match = is_mr or is_ct
                    elif target_mod in ("MR", "MRI"):
                        match = is_mr
                    elif target_mod in ("CT", "CLVT"):
                        match = is_ct
                    else:
                        match = (m_dicom == target_mod) or (target_mod in m_dicom) or (target_mod in desc)

                    if match:
                        uid = s.get("studyIUID")
                        if uid:
                            studies_to_process.append({
                                "uid": uid,
                                "date": s.get("date", ""),
                                "modality": m_dicom or ("CT" if is_ct else "MR"),
                                "desc": s.get("studyDescription", "") or ""
                            })

            # Không lấy Study UID tùy ý từ trang reading vì không chứng minh
            # được chúng thuộc Patient ID vừa yêu cầu.
            if not studies_to_process:
                log(
                    "  Không có study phù hợp từ API. Vì an toàn, ứng dụng không "
                    "lấy Study UID tùy ý từ danh sách/HTML của RIS."
                )

            log(f"-> Tìm thấy {len(studies_to_process)} ca chụp (MRI / CT) cho bệnh nhân {patient_id}.")

            for idx, st in enumerate(studies_to_process, 1):
                if should_stop and should_stop():
                    log(">>> Đã nhận lệnh dừng!")
                    break

                uid = st["uid"]
                wrapper_url = f"{base_url}/ris/vrViewer?studyUID={uid}&viewType=VIEWERV2"
                vpage = context.new_page()
                direct_url = wrapper_url
                try:
                    vpage.goto(wrapper_url, timeout=20000, wait_until="domcontentloaded")
                    vpage.wait_for_timeout(3000)
                    iframes = vpage.evaluate("() => Array.from(document.querySelectorAll('iframe')).map(f => f.src)")
                    if iframes and iframes[0]:
                        direct_url = iframes[0]
                except Exception as e:
                    log(f"  ⚠️ Lỗi lấy link trực tiếp cho ca {idx}: {e}")
                finally:
                    vpage.close()

                studies_found.append({
                    "study_uid": uid,
                    "name": f"Ca_{idx}_{st['date'].replace(':', '-').replace(' ', '_')}" if st['date'] else f"Study_{idx}",
                    "date": st['date'],
                    "modality": st['modality'],
                    "desc": st['desc'],
                    "direct_url": direct_url,
                })

        except Exception as e:
            log(f"❌ Lỗi trong quá trình kết nối/tìm kiếm trên RIS: {e}")
        finally:
            browser.close()

    return studies_found


def download_studies_list(
    studies: list[dict],
    out_base: Path,
    log: LogFn = _default_log,
    headless: bool = True,
    quality: int = 100,
    save_png: bool = False,
    contrast_mode: str = CLINICAL,
    should_stop: Optional[Callable[[], bool]] = None,
) -> int:
    """
    Tải trực tiếp danh sách các ca phim đã có sẵn `direct_url` (không cần đăng nhập RIS lại lần 2).
    """
    if not studies:
        log("⚠️ Danh sách ca phim rỗng.")
        return 0

    total_downloaded = 0
    for idx, st in enumerate(studies, 1):
        if should_stop and should_stop():
            log(">>> Đã nhận lệnh dừng tải hàng loạt!")
            break

        st_out_dir = out_base / f"Ca_{idx}_{st['study_uid'][:12]}"
        log("\n" + "-" * 60)
        log(f"[{idx}/{len(studies)}] BẮT ĐẦU TẢI CA {idx}: StudyUID={st['study_uid']}")
        log(f"      Link Viewer: {st['direct_url']}")
        log(f"      Lưu tại: {st_out_dir}")
        log("-" * 60)

        try:
            dl, cv, jpg_dir = run_pipeline(
                url=st["direct_url"],
                out_base=st_out_dir,
                log=log,
                headless=headless,
                quality=quality,
                save_png=save_png,
                contrast_mode=contrast_mode,
                should_stop=should_stop,
            )
            if dl:
                total_downloaded += dl.total()
            log(f"✓ ĐÃ TẢI XONG CA {idx}: {jpg_dir}")
        except Exception as e:
            log(f"❌ Lỗi khi tải ca {idx}: {e}")

    log("\n" + "=" * 70)
    log(f"HOÀN TẤT TẢI PHIM BỆNH NHÂN! Tổng số ca đã tải: {len(studies)}")
    log(f"Thư mục lưu: {out_base}")
    log("=" * 70)
    return total_downloaded


def download_patient_mri_all(
    hospital_key: str,
    patient_id: str,
    out_base: Path,
    modality: str = "MR_CT",
    selected_uids: Optional[list[str]] = None,
    log: LogFn = _default_log,
    headless: bool = True,
    quality: int = 100,
    save_png: bool = False,
    contrast_mode: str = CLINICAL,
    should_stop: Optional[Callable[[], bool]] = None,
) -> int:
    """
    Tự động đăng nhập RIS, tìm tất cả ca MRI & CT (Cắt lớp vi tính) sọ não của Mã Bệnh Nhân,
    và tải trọn bộ tất cả các ca đó vào thư mục `out_base`.
    """
    info = HOSPITALS.get(hospital_key.lower())
    hosp_name = info["name"] if info else hospital_key

    log("=" * 70)
    log(f"BẮT ĐẦU TỰ ĐỘNG TÌM & TẢI PHIM BỆNH NHÂN (MRI / CT): {patient_id} - {hosp_name}")
    log(f"Thư mục chính: {out_base}")
    log("=" * 70)

    studies = search_patient_studies(
        hospital_key=hospital_key,
        patient_id=patient_id,
        modality=modality,
        log=log,
        headless=headless,
        should_stop=should_stop,
    )

    if selected_uids is not None:
        studies = [s for s in studies if s["study_uid"] in selected_uids]

    if not studies:
        log(f"⚠️ Không tìm thấy ca phim MRI/CT nào cho mã bệnh nhân '{patient_id}' tại {hosp_name}.")
        return 0

    return download_studies_list(
        studies=studies,
        out_base=out_base,
        log=log,
        headless=headless,
        quality=quality,
        save_png=save_png,
        contrast_mode=contrast_mode,
        should_stop=should_stop,
    )


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

    import argparse

    ap = argparse.ArgumentParser(description="Tải ảnh DICOM từ viewer và chuyển sang JPG chất lượng cao.")
    ap.add_argument("url", help="Link viewer (đặt trong dấu nháy kép)")
    ap.add_argument("-o", "--out", default=None, help="Thư mục xuất (mặc định: ./Tai_ve_<time>)")
    ap.add_argument("-q", "--quality", type=int, default=100, help="Chất lượng JPG 1-100 (mặc định 100 = cao nhất)")
    ap.add_argument("--png", action="store_true", help="Xuất thêm PNG (không mất dữ liệu)")
    ap.add_argument("--show", action="store_true", help="Hiện trình duyệt (không ẩn) để debug")
    ap.add_argument("--contrast", choices=[CLINICAL, AUTO], default=CLINICAL,
                    help="clinical = bám cửa sổ y khoa (mặc định); auto = kéo giãn percentile cho gắt hơn")
    args = ap.parse_args()

    if args.out:
        out = Path(args.out)
    else:
        from datetime import datetime
        out = Path.cwd() / f"Tai_ve_{datetime.now():%Y%m%d_%H%M%S}"

    run_pipeline(
        args.url, out,
        headless=not args.show,
        quality=args.quality,
        save_png=args.png,
        contrast_mode=args.contrast,
    )

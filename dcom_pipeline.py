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
import hashlib
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Optional

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

    ensure_browser(log)

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

    def save_body(body: bytes) -> None:
        """Lưu 1 ảnh (nhận diện theo NỘI DUNG, không phụ thuộc endpoint), tự loại
        trùng theo SHA-1. An toàn khi gọi từ nhiều luồng."""
        if not body:
            return
        data = _maybe_base64_decode(body)
        ext = _guess_ext(data)
        if ext is None:
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
                "qido_series": None, "wado_tmpl": None, "host": None, "cookies": None}

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
            if "StudyData/GetStudies" in u and captured["getstudies"] is None:
                captured["getstudies"] = response.body()
                return
            if "get-share-patient-image" in u and captured["vrpacs"] is None:
                captured["vrpacs"] = response.body()
                return
            # DICOMweb QIDO: danh sách series (…/studies/<uid>/series)
            if (captured["qido_series"] is None and "dicom+json" in ct
                    and u.split("?")[0].rstrip("/").endswith("/series")):
                captured["qido_series"] = u
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
        return bool((captured["getstudies"] and captured["template_url"])
                    or captured["vrpacs"]
                    or (captured["qido_series"] and captured["wado_tmpl"]))

    used_manifest = False
    with sync_playwright() as p:
        log("Đang mở trình duyệt ảo (Chromium)...")
        # --dns-over-https-mode=off: buộc Chromium dùng DNS của HỆ ĐIỀU HÀNH. Nếu
        # không, với DNS nội bộ/split-horizon (vd PACS bệnh viện), Chromium tự hỏi
        # resolver công khai -> ra IP công khai bị chặn -> ERR_CONNECTION_TIMED_OUT
        # dù trình duyệt thường vẫn vào được.
        browser = p.chromium.launch(
            headless=headless,
            args=["--dns-over-https-mode=off", "--disable-features=DnsOverHttps,AsyncDns"],
        )
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
            if stop() or _have_manifest():
                break
            page.wait_for_timeout(500)

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
        elif captured["qido_series"] and captured["wado_tmpl"]:
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
    Tải trực tiếp mọi ảnh từ viewer chuẩn DICOMweb (OHIF / dcm4chee / Orthanc...).
    Dùng QIDO-RS để liệt kê series + instances, rồi WADO-URI để lấy DICOM gốc.
    Khuôn WADO lấy từ 1 URL ảnh thật; nếu thiếu thì suy ra theo dcm4chee.
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
    else:  # suy ra theo quy ước dcm4chee: .../aets/XXX/rs -> .../aets/XXX/wado
        wado_base = rs_base.rsplit("/rs", 1)[0] + "/wado"
        wtmpl = {"requestType": "WADO", "contentType": "application/dicom", "transferSyntax": "*"}

    cj = "; ".join(f'{c.get("name")}={c.get("value")}' for c in (captured.get("cookies") or []))
    sslctx = ssl.create_default_context()
    sslctx.check_hostname = False
    sslctx.verify_mode = ssl.CERT_NONE
    hdr = {"Cookie": cj} if cj else {}

    def get_json(u):
        req = urllib.request.Request(u, headers={"Accept": "application/dicom+json", **hdr})
        with urllib.request.urlopen(req, timeout=40, context=sslctx) as r:
            return json.loads(r.read().decode("utf-8", "replace"))

    def V(el, tag):
        v = (el.get(tag, {}) or {}).get("Value", [None])
        return v[0] if v else None

    try:
        series = get_json(f"{rs_base}/studies/{study}/series")
    except Exception as e:
        log(f"  Lỗi QIDO series ({e}) — bỏ qua."); return

    log(f"DICOMweb: {len(series)} series. Đang liệt kê ảnh...")
    tasks = []
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
        for i in insts:
            ou = V(i, "00080018")
            if not ou:
                continue
            params = {k: v for k, v in wtmpl.items()
                      if k.lower() not in ("studyuid", "seriesuid", "objectuid")}
            params["studyUID"] = study
            params["seriesUID"] = suid
            params["objectUID"] = ou
            params.setdefault("requestType", "WADO")
            params.setdefault("contentType", "application/dicom")
            params.setdefault("transferSyntax", "*")
            tasks.append(wado_base + "?" + urlencode(params))

    total = len(tasks)
    log(f"DICOMweb: {len(series)} series, {total} ảnh. Đang tải trực tiếp (6 luồng song song)...")

    def fetch_one(u):
        if stop():
            return
        try:
            req = urllib.request.Request(u, headers=hdr)
            with urllib.request.urlopen(req, timeout=60, context=sslctx) as r:
                save_body(r.read())
        except Exception:
            pass

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

    dicom_dir = Path(dicom_dir)
    jpg_dir = Path(jpg_dir)
    jpg_dir.mkdir(parents=True, exist_ok=True)

    mode_txt = "auto-contrast" if contrast_mode == AUTO else "chuẩn lâm sàng (VOI LUT)"
    dcm_files = [p for p in dicom_dir.rglob("*")
                 if p.is_file() and p.suffix.lower() in (".dcm", ".dicom")]
    log(f"Chuyển đổi: tìm thấy {len(dcm_files)} file DICOM. Chất lượng JPG={quality}"
        f"{' + PNG' if save_png else ''}, tương phản={mode_txt}.")

    stats = ConvertStats()

    for path in dcm_files:
        if should_stop and should_stop():
            log("Đã dừng chuyển đổi theo yêu cầu.")
            break
        try:
            ds = pydicom.dcmread(str(path), force=True)
            if "PixelData" not in ds:
                stats.skipped += 1
                continue

            series_number = getattr(ds, "SeriesNumber", "NoSeries")
            series_desc = _safe_name(getattr(ds, "SeriesDescription", "UnknownSeries"))
            instance_number = getattr(ds, "InstanceNumber", stats.converted + 1)

            series_folder = jpg_dir / f"Series_{_safe_name(series_number)}_{series_desc}"
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

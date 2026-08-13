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
import io
import json
import math
import os
import re
import sys
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Optional
import unicodedata

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


# Vật thể DICOM KHÔNG chứa điểm ảnh: báo cáo có cấu trúc (SR — vd "Dose SR" của
# máy CT), trạng thái hiển thị, ảnh khóa, tài liệu, vùng phân đoạn, dữ liệu xạ
# trị. Không chuyển được sang JPG, và có PACS còn trả 500 khi bị hỏi tới. Tính
# chúng vào tổng số ảnh sẽ khiến một ca đã tải đủ bị gắn "thiếu ảnh" vĩnh viễn.
_NON_IMAGE_MODALITIES = frozenset({
    "SR", "PR", "KO", "DOC", "AU", "SEG", "REG", "FID", "PLAN",
    "RTSTRUCT", "RTPLAN", "RTRECORD", "STAND",
})


def _is_non_image_modality(modality: Any) -> bool:
    return str(modality or "").strip().upper() in _NON_IMAGE_MODALITIES


def _guess_ext(data: bytes) -> Optional[str]:
    """Đoán loại file từ vài byte đầu."""
    if data[:3] == b"\xff\xd8\xff":
        return "jpg"
    if data[:4] == b"\x89PNG":
        return "png"
    if len(data) > 132 and data[128:132] == b"DICM":
        return "dcm"
    return None


def _is_dicom_dataset_valid_for_decode(ds: Any) -> tuple[bool, str]:
    """Kiểm tra dataset DICOM có đầy đủ dữ liệu pixel an toàn để giải mã C native không.

    Ngăn chặn việc đưa codestream nén bị rách (JPEG2000, JPEG-LS, JPEG, RLE) vào openjpeg / pylibjpeg
    gây STATUS_HEAP_CORRUPTION (0xC0000374).
    """
    if ds is None or "PixelData" not in ds:
        return False, "Không có trường PixelData"

    pixel_data = getattr(ds, "PixelData", b"")
    if not isinstance(pixel_data, (bytes, bytearray, memoryview)) or len(pixel_data) == 0:
        return False, "PixelData rỗng hoặc không phải dạng bytes"

    file_meta = getattr(ds, "file_meta", None)
    transfer_syntax_obj = getattr(file_meta, "TransferSyntaxUID", None)
    ts_uid = str(transfer_syntax_obj or "")
    is_encapsulated = bool(transfer_syntax_obj and getattr(transfer_syntax_obj, "is_encapsulated", False))

    if not is_encapsulated:
        rows = int(getattr(ds, "Rows", 0) or 0)
        cols = int(getattr(ds, "Columns", 0) or 0)
        samples = int(getattr(ds, "SamplesPerPixel", 1) or 1)
        bits = int(getattr(ds, "BitsAllocated", 16) or 16)
        frames = int(getattr(ds, "NumberOfFrames", 1) or 1)
        bytes_per_sample = max(1, math.ceil(bits / 8))
        expected_bytes = rows * cols * samples * bytes_per_sample * frames
        if expected_bytes > 0 and len(pixel_data) < expected_bytes:
            return False, f"PixelData raw bị thiếu: {len(pixel_data)}/{expected_bytes} bytes"
    else:
        try:
            import struct
            import pydicom.encaps as pe
            frags = list(pe.generate_fragments(pixel_data))
            if not frags:
                return False, "Encapsulated PixelData không chứa fragment nào"

            # Phân loại họ nén JPEG / JPEG-LS / JPEG 2000 (1.2.840.10008.1.2.4.50-93),
            # không áp dụng marker EOI cho các cú pháp nén video (1.2.840.10008.1.2.4.100+).
            is_jpeg_family = "1.2.840.10008.1.2.4." in ts_uid and not any(
                ts_uid.startswith(v) for v in ("1.2.840.10008.1.2.4.10", "1.2.840.10008.1.2.4.11")
            )

            last_frag = frags[-1].rstrip(b"\x00")
            if is_jpeg_family:
                if not last_frag.endswith(b"\xff\xd9"):
                    if len(frags) == 1 and not last_frag:
                        return False, "Encapsulated PixelData chỉ chứa Basic Offset Table rỗng"
                    return False, f"Encapsulated codestream bị cắt ngắn (thiếu marker kết thúc \\xff\\xd9, tail={last_frag[-6:]!r})"
            elif ts_uid == "1.2.840.10008.1.2.5":  # RLE Lossless (Heuristic header check)
                image_frags = frags[1:] if len(frags) > 1 else frags
                for frag in image_frags:
                    if len(frag) < 64:
                        return False, f"RLE fragment quá ngắn ({len(frag)} < 64 bytes header)"
                    num_segments = struct.unpack("<I", frag[:4])[0]
                    if num_segments < 1 or num_segments > 15:
                        return False, f"RLE header không hợp lệ: {num_segments} segments"
                    offsets = struct.unpack(f"<{num_segments}I", frag[4:4 + num_segments * 4])
                    if any(off > len(frag) for off in offsets):
                        return False, "RLE segment offset vượt quá độ dài fragment"
            else:
                # Fragment đầu là Basic Offset Table — chuẩn cho phép rỗng, nên
                # phải bỏ qua nó y như nhánh RLE, kẻo loại nhầm video MPEG/H.264.
                image_frags = frags[1:] if len(frags) > 1 else frags
                if any(len(frag) == 0 for frag in image_frags):
                    return False, "Encapsulated fragment ảnh rỗng"
        except Exception as exc:
            return False, f"Lỗi phân tích fragment encapsulated: {exc}"

    return True, ""


def _validate_dicom_bytes_and_dataset(data: bytes) -> tuple[bool, str, Optional[Any]]:
    """Kiểm tra tính toàn vẹn của dữ liệu nhị phân DICOM và trả về dataset nếu hợp lệ."""
    if not data or len(data) <= 132:
        return False, "Dữ liệu quá ngắn (<132 bytes)", None
    if data[128:132] != b"DICM":
        return False, "Thiếu magic header DICM tại offset 128", None

    try:
        import pydicom
    except ImportError:
        return True, "", None

    ds = None
    try:
        bio = io.BytesIO(data)
        ds = pydicom.dcmread(bio, force=False)
    except Exception:
        try:
            bio.seek(0)
            ds = pydicom.dcmread(bio, force=True)
        except Exception as exc2:
            return False, f"Không parse được cấu trúc DICOM: {exc2}", None

    if ds is None or len(ds) == 0:
        return False, "File DICOM bị cụt, dataset chính không chứa thẻ dữ liệu nào", None

    modality = str(getattr(ds, "Modality", "") or "").strip().upper()
    if _is_non_image_modality(modality):
        return True, "", ds

    file_meta = getattr(ds, "file_meta", None)
    sop_class = str(getattr(file_meta, "MediaStorageSOPClassUID", "") or getattr(ds, "SOPClassUID", "") or "")
    transfer_syntax_obj = getattr(file_meta, "TransferSyntaxUID", None)
    is_encapsulated = bool(transfer_syntax_obj and getattr(transfer_syntax_obj, "is_encapsulated", False))

    if "PixelData" not in ds:
        if is_encapsulated or "Image" in sop_class or getattr(ds, "Rows", None) or getattr(ds, "Columns", None):
            return False, "File ảnh DICOM nhưng bị mất trường PixelData do bị cắt ngắn", None
        if not _is_non_image_modality(modality):
            return False, "Thiếu trường PixelData trong file DICOM", None
        return True, "", ds

    valid, reason = _is_dicom_dataset_valid_for_decode(ds)
    return valid, reason, (ds if valid else None)


def _validate_dicom_bytes(data: bytes) -> tuple[bool, str]:
    """Kiểm tra tính toàn vẹn của dữ liệu nhị phân DICOM trước khi ghi đĩa hoặc nạp lại.

    Trả về (True, "") nếu hợp lệ, hoặc (False, lý do) nếu dữ liệu bị cụt/hỏng.
    """
    valid, reason, _ds = _validate_dicom_bytes_and_dataset(data)
    return valid, reason


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
_BROWSER_NOTICES_LOGGED: set[str] = set()


def _log_browser_notice_once(log: LogFn, browser_name: str) -> None:
    """Keep the job log useful: browser startup is not an RIS login event."""
    with _BROWSER_STATE_LOCK:
        if browser_name in _BROWSER_NOTICES_LOGGED:
            return
        _BROWSER_NOTICES_LOGGED.add(browser_name)
    log(
        f"Công cụ nền: {browser_name} "
        "(dòng này chỉ báo trình duyệt tự động, không báo đăng nhập)."
    )


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
            _log_browser_notice_once(log, "Google Chrome")
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
                _log_browser_notice_once(log, "Google Chrome")
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
            _log_browser_notice_once(log, "Safari / WebKit")
            return b
    except Exception:
        pass

    # 3. Thử Microsoft Edge (có sẵn mặc định trên Windows)
    try:
        b = p.chromium.launch(headless=headless, channel="msedge", args=_BROWSER_ARGS)
        _log_browser_notice_once(log, "Microsoft Edge")
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

def _series_value(item: dict, *keys: str) -> Any:
    for key in keys:
        value = item.get(key)
        if value not in (None, "", []):
            return value
    return ""


def _sequence_hint(description: Any) -> str:
    """Return a conservative display hint; the exact PACS description stays visible."""
    text = unicodedata.normalize("NFKD", str(description or "")).upper()
    compact = re.sub(r"[^A-Z0-9+]+", " ", text)
    if re.search(r"\b(ADC)\b", compact):
        return "ADC"
    if re.search(r"\b(DWI|DIFF|TRACEW)\b", compact) or "B1000" in compact:
        return "DWI"
    if re.search(r"\b(SWI|SWAN|T2 STAR|T2STAR)\b", compact):
        return "SWI"
    if re.search(r"\b(FLAIR)\b", compact):
        return "T2 FLAIR"
    if re.search(r"\b(T1|MPRAGE|BRAVO|SPGR)\b", compact):
        post = bool(
            re.search(r"(POST|CE|GAD|CONTRAST|C\+|\+C|ENH)", compact)
            or re.search(r"\bT1W?\s*C\b", compact)
        )
        return "T1 sau tiêm" if post else "T1"
    if re.search(r"\b(T2)\b", compact):
        return "T2"
    if re.search(r"\b(PERF|DSC|DCE|ASL)\b", compact):
        return "Tưới máu"
    if re.search(r"\b(TOF|MRA|MRV|ANGIO)\b", compact):
        return "Mạch máu"
    return "Khác"


def _normalise_series_choice(raw: dict, source: str, index: int) -> dict:
    uid = str(_series_value(
        raw, "SeriesInsUID", "SeriesInstanceUID", "seriesInstanceUID",
        "seriesUid", "seriesUID", "seriesId", "id",
    ) or "").strip()
    identifier = uid or f"{source}:{index}"
    number = str(_series_value(
        raw, "SeriesNumber", "SeriesNo", "SeriesNum", "seriesNumber", "seriesNo",
    ) or "").strip()
    description = str(_series_value(
        raw, "SeriesDescription", "SeriesDesc", "Description", "seriesDescription",
        "description", "seriesName", "name", "ProtocolName", "protocolName",
    ) or "").strip() or f"Series {number or index + 1}"
    modality = str(_series_value(raw, "Modality", "modality", "modalityDicom") or "").strip().upper()
    count = _series_value(
        raw, "ImageCount", "imageCount", "numberOfImages", "instanceCount", "NumberOfImages",
    )
    if not count and isinstance(raw.get("imageIds"), list):
        count = len(raw["imageIds"])
    try:
        image_count = max(0, int(count or 0))
    except (TypeError, ValueError):
        image_count = 0
    return {
        "id": identifier,
        "seriesUid": uid,
        "number": number,
        "description": description,
        "modality": modality,
        "imageCount": image_count,
        "sequenceHint": _sequence_hint(description),
        "source": source,
    }


def _vrad_series_choices(body: bytes) -> list[dict]:
    payload = json.loads(body.decode("utf-8", "replace"))
    data = payload.get("data", payload) if isinstance(payload, dict) else payload
    study = data[0] if isinstance(data, list) and data else data
    raw_series = study.get("SeriesList", []) if isinstance(study, dict) else []
    return [_normalise_series_choice(item, "vrad", index) for index, item in enumerate(raw_series)]


def _vrpacs_series_choices(body: bytes) -> list[dict]:
    payload = json.loads(body.decode("utf-8", "replace"))
    data = payload.get("data", {}) if isinstance(payload, dict) else {}
    studies = data.get("studyList", []) if isinstance(data, dict) else []
    raw_series = [series for study in studies for series in (study.get("seriesList", []) or [])]
    return [_normalise_series_choice(item, "vrpacs", index) for index, item in enumerate(raw_series)]


def _dicom_json_value(item: dict, tag: str) -> Any:
    values = (item.get(tag, {}) or {}).get("Value", [None])
    return values[0] if values else ""


def _dicomweb_series_choices(body: bytes) -> list[dict]:
    payload = json.loads(body.decode("utf-8", "replace"))
    if not isinstance(payload, list):
        return []
    choices = []
    for index, item in enumerate(payload):
        raw = {
            "SeriesInstanceUID": _dicom_json_value(item, "0020000E"),
            "SeriesNumber": _dicom_json_value(item, "00200011"),
            "SeriesDescription": _dicom_json_value(item, "0008103E"),
            "Modality": _dicom_json_value(item, "00080060"),
            "ImageCount": _dicom_json_value(item, "00201209"),
        }
        if raw["SeriesInstanceUID"] and not _is_non_image_modality(raw["Modality"]):
            choices.append(_normalise_series_choice(raw, "dicomweb", index))
    return choices


def _dicomweb_instance_plan(
    series: list[dict],
    instances_by_series: dict[str, list[dict]],
    selected_series: Optional[set[str]] = None,
) -> tuple[list[tuple[str, str, int, dict]], int, list[str], list[str]]:
    """Validate and flatten QIDO instance listings without hiding empty series."""
    tasks: list[tuple[str, str, int, dict]] = []
    skipped_non_image: list[str] = []
    missing: list[str] = []
    image_series_count = 0
    for item in series:
        suid = str(_dicom_json_value(item, "0020000E") or "").strip()
        if not suid:
            continue
        if selected_series is not None and suid not in selected_series:
            continue
        modality = _dicom_json_value(item, "00080060")
        label = (
            f"{_dicom_json_value(item, '00200011') or '?'} - "
            f"{_dicom_json_value(item, '0008103E') or modality or '?'}"
        )
        if _is_non_image_modality(modality):
            skipped_non_image.append(label)
            continue
        image_series_count += 1
        try:
            declared = int(str(_dicom_json_value(item, "00201209") or 0))
        except (TypeError, ValueError):
            declared = 0

        unique: dict[str, dict] = {}
        for instance in instances_by_series.get(suid, []):
            iuid = str(_dicom_json_value(instance, "00080018") or "").strip()
            if iuid:
                unique[iuid] = instance
        found = len(unique)
        if found == 0 or (declared > 0 and found < declared):
            expected_text = str(declared) if declared > 0 else "không rõ"
            missing.append(f"{label}: tìm thấy {found}/{expected_text} instance")
        for iuid, instance in unique.items():
            try:
                frames = int(str(_dicom_json_value(instance, "00280008") or 1))
            except (TypeError, ValueError):
                frames = 1
            tasks.append((suid, iuid, max(1, frames), instance))
    return tasks, image_series_count, skipped_non_image, missing


def _dicom_storage_info(data: bytes, digest: str, ds: Optional[Any] = None) -> tuple[str, str]:
    """Build stable readable series/file names without decoding pixel data."""
    try:
        if ds is None:
            import pydicom

            ds = pydicom.dcmread(
                io.BytesIO(data),
                stop_before_pixels=True,
                force=True,
                specific_tags=[
                    "StudyInstanceUID", "SeriesInstanceUID", "SeriesNumber", "SeriesDescription",
                    "InstanceNumber", "SOPInstanceUID",
                ],
            )
        number = str(getattr(ds, "SeriesNumber", "") or "").strip() or "NA"
        description = _safe_name(getattr(ds, "SeriesDescription", "") or "UnknownSeries")[:64]
        folder = f"Series_{_safe_name(number)}_{description}"
        instance = str(getattr(ds, "InstanceNumber", "") or "").strip()
        sop = str(getattr(ds, "SOPInstanceUID", "") or "").strip()
        sop_token = hashlib.sha1((sop or digest).encode("utf-8")).hexdigest()[:10]
        instance_token = f"{int(instance):05d}" if instance.lstrip("-").isdigit() else _safe_name(instance or "NA")
        return folder, f"IM_{instance_token}_{sop_token}_{digest[:6]}.dcm"
    except Exception:
        return "Series_UNKNOWN", f"IM_NA_{digest[:10]}.dcm"


@dataclass
class DownloadStats:
    dicom: int = 0
    jpg: int = 0
    png: int = 0
    duplicates: int = 0
    series_seen: set = field(default_factory=set)
    # Số ảnh MANIFEST CỦA VIEWER khai báo cho study này (0 = không biết, vd chế
    # độ mô phỏng). `failed` là số ảnh đã thử hết số lần mà vẫn không lấy được.
    expected: int = 0
    failed: int = 0
    completed_tasks: int = 0

    # Nguồn gốc của ảnh DICOM. Một file .dcm KHÔNG mặc nhiên là bản gốc của máy
    # chụp: khi PACS chỉ phát theo frame (BV Hà Tĩnh), app phải DỰNG LẠI file từ
    # metadata + frame, nên nó thiếu bớt tag so với bản gốc. Người đọc phim cần
    # biết mình đang cầm loại nào. JPG/PNG đã tự nói lên là ảnh render nên không
    # cần đếm riêng.
    #
    # Chỉ đếm ảnh TẢI TRONG PHIÊN NÀY; file có sẵn lúc `resume` không rõ nguồn
    # gốc nên không xếp vào đâu cả — vì thế tổng hai ô này có thể nhỏ hơn `dicom`.
    original_dicom: int = 0
    reconstructed_dicom: int = 0

    def total(self) -> int:
        return self.dicom + self.jpg + self.png

    def fidelity_report(self) -> str:
        """Một dòng kể rõ DICOM đến từ đâu; rỗng nếu phiên này không tải DICOM.

        Chỉ nói ra khi có ít nhất một file dựng lại — lúc tất cả đều là bản gốc
        thì thêm dòng này chỉ là nhiễu.
        """
        if not self.reconstructed_dicom:
            return ""
        return (
            f"DICOM gốc {self.original_dicom}, "
            f"DICOM app dựng lại từ frame {self.reconstructed_dicom} "
            f"(thiếu một số tag so với bản gốc của máy chụp)"
        )

    def is_complete(self) -> bool:
        """Đủ ảnh hay không — dùng để quyết định gắn nhãn 'xong' cho 1 ca.

        Không biết manifest thì chỉ dám kết luận 'có ảnh', KHÔNG kết luận 'đủ':
        đó là lý do chỗ gọi phải đọc `expected` trước khi báo hoàn tất.
        """
        if self.expected <= 0:
            return self.total() > 0
        counted = self.completed_tasks or (self.dicom if self.dicom else self.total())
        return counted >= self.expected


# ---------------------------------------------------------------------------
# Nhận diện dòng PACS
#
# Mỗi dòng viewer tự khai: nhìn response nào thì biết mình, cần gì mới đủ để
# tải, và tải bằng hàm nào. Nhờ vậy thêm một bệnh viện mới chỉ là viết thêm một
# lớp rồi đăng ký vào PACS_ADAPTERS — KHÔNG phải sửa `download_all()` lẫn
# `discover_viewer_series()` như trước (hai chỗ đó vốn chép cùng một logic nhận
# diện nên rất dễ lệch nhau).
#
# Phần TẢI vẫn nguyên vẹn: adapter chỉ gọi lại `_download_via_*()` sẵn có.
# ---------------------------------------------------------------------------


@dataclass
class ViewerCapture:
    """Những gì nhặt được từ chính phiên viewer đang mở.

    Không tự đăng nhập và không vượt quyền: chỉ dùng lại cookie/header mà viewer
    đã được server cho phép dùng.
    """

    getstudies: Optional[bytes] = None
    template_url: Optional[str] = None

    vrpacs: Optional[bytes] = None

    qido_series: Optional[str] = None
    qido_series_body: Optional[bytes] = None
    wado_tmpl: Optional[str] = None

    host: Optional[str] = None
    cookies: Optional[list] = None
    api_headers: Optional[dict] = None
    session_error: Optional[str] = None

    def as_legacy_dict(self) -> dict:
        """Đúng cái dict mà `_download_via_*()` đang nhận.

        Giữ nguyên kiểu tham số này để phần tải không phải sửa một dòng nào, và
        để các test đang dựng dict bằng tay vẫn chạy được.
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


class PacsAdapter:
    """Một dòng PACS: cách nhận ra nó, và cách tải ảnh của nó."""

    name = "generic"
    source = "generic"   # nhãn nguồn gắn vào từng series (giữ nguyên tên cũ)
    priority = 0

    def observe(self, response, cap: ViewerCapture) -> bool:
        """Đọc một response của viewer và ghi lại thứ cần thiết.

        Trả về True nếu response này CHÍNH LÀ manifest của dòng PACS này — chỗ
        gọi dựa vào đó để thôi soi tiếp response ấy.
        """
        return False

    def is_ready(self, cap: ViewerCapture) -> bool:
        """Đã đủ dữ kiện để tải trực tiếp qua API chưa."""
        return False

    def has_series_manifest(self, cap: ViewerCapture) -> bool:
        """Đã đủ để LIỆT KÊ series chưa.

        Nhẹ hơn `is_ready`: liệt kê chỉ cần thân manifest, còn tải thì có dòng
        (như VradViewer) còn cần thêm một URL ảnh thật làm khuôn.
        """
        return False

    def series_choices(self, cap: ViewerCapture) -> list[dict]:
        return []

    def download(self, cap: ViewerCapture, save_body, stats,
                 log: LogFn, stop, selected_series) -> None:
        raise NotImplementedError


class VradAdapter(PacsAdapter):
    name = "VradViewer"
    source = "vrad"
    priority = 300

    def observe(self, response, cap: ViewerCapture) -> bool:
        url = response.url
        if "StudyData/GetStudies" in url and cap.getstudies is None:
            cap.getstudies = response.body()
            return True
        # URL ảnh thật, dùng làm khuôn để dựng link cho các ảnh còn lại.
        if (cap.template_url is None
                and "GetImage" in url and "Jpeg" not in url):
            cap.template_url = url
        return False

    def is_ready(self, cap: ViewerCapture) -> bool:
        return bool(cap.getstudies and cap.template_url)

    def has_series_manifest(self, cap: ViewerCapture) -> bool:
        return cap.getstudies is not None

    def series_choices(self, cap: ViewerCapture) -> list[dict]:
        return _vrad_series_choices(cap.getstudies)

    def download(self, cap, save_body, stats, log, stop, selected_series) -> None:
        _download_via_manifest(
            cap.as_legacy_dict(), save_body, stats, log, stop, selected_series,
        )


class VrpacsAdapter(PacsAdapter):
    name = "VRPACS"
    source = "vrpacs"
    priority = 250

    def observe(self, response, cap: ViewerCapture) -> bool:
        if "get-share-patient-image" in response.url and cap.vrpacs is None:
            cap.vrpacs = response.body()
            return True
        return False

    def is_ready(self, cap: ViewerCapture) -> bool:
        return cap.vrpacs is not None

    def has_series_manifest(self, cap: ViewerCapture) -> bool:
        return cap.vrpacs is not None

    def series_choices(self, cap: ViewerCapture) -> list[dict]:
        return _vrpacs_series_choices(cap.vrpacs)

    def download(self, cap, save_body, stats, log, stop, selected_series) -> None:
        _download_via_vrpacs(
            cap.as_legacy_dict(), save_body, stats, log, stop, selected_series,
        )


class DicomWebAdapter(PacsAdapter):
    """OHIF / dcm4chee / Orthanc / static-wado (PACS BV Hà Tĩnh...)."""

    name = "DICOMweb"
    source = "dicomweb"
    priority = 200

    def observe(self, response, cap: ViewerCapture) -> bool:
        url = response.url
        if url.split("?")[0].rstrip("/").endswith("/series"):
            if cap.qido_series is None:
                cap.qido_series = url
                # Giữ lại "giấy thông hành" viewer đang dùng (Authorization,
                # X-...) để tải ngoài trình duyệt bằng đúng quyền đó. Việc LỌC
                # header để đến lúc dùng, trong `_download_via_dicomweb()` — một
                # chỗ lọc là đủ.
                try:
                    cap.api_headers = response.request.all_headers()
                except Exception:
                    try:
                        cap.api_headers = dict(response.request.headers)
                    except Exception:
                        pass
            # Đọc thân riêng: response đầu có thể đọc hỏng, và phần liệt kê
            # series sống nhờ đúng thân này nên phải cho nó cơ hội thử lại.
            if cap.qido_series_body is None:
                try:
                    cap.qido_series_body = response.body()
                except Exception:
                    pass
            return True
        ct = response.headers.get("content-type", "").lower()
        if (cap.wado_tmpl is None and ct.startswith("application/dicom")
                and "json" not in ct
                and ("wado" in url.lower() or "objectuid" in url.lower())):
            cap.wado_tmpl = url
        return False

    def is_ready(self, cap: ViewerCapture) -> bool:
        # QIDO series một mình là đủ: `_download_via_dicomweb()` tự dò WADO-URI /
        # WADO-RS / dựng lại từ frames (BV Hà Tĩnh không phát URL chứa "wado").
        return bool(cap.qido_series)

    def has_series_manifest(self, cap: ViewerCapture) -> bool:
        return cap.qido_series_body is not None

    def series_choices(self, cap: ViewerCapture) -> list[dict]:
        return _dicomweb_series_choices(cap.qido_series_body)

    def download(self, cap, save_body, stats, log, stop, selected_series) -> None:
        _download_via_dicomweb(
            cap.as_legacy_dict(), save_body, stats, log, stop, selected_series,
        )


# Không giữ trạng thái riêng — mọi thứ nhặt được nằm trong `ViewerCapture`, nên
# dùng chung một bộ instance cho mọi phiên tải là an toàn.
PACS_ADAPTERS: tuple[PacsAdapter, ...] = (
    VradAdapter(),
    VrpacsAdapter(),
    DicomWebAdapter(),
)


def _observe_response(response, cap: ViewerCapture) -> bool:
    """Cho mọi adapter soi một response. True = đây là manifest của một dòng PACS.

    Một adapter hỏng không được phép làm hỏng cả phiên tải.
    """
    for adapter in PACS_ADAPTERS:
        try:
            if adapter.observe(response, cap):
                return True
        except Exception:
            continue
    return False


def _ready_adapter(cap: ViewerCapture) -> Optional[PacsAdapter]:
    """Adapter đủ dữ kiện để TẢI, ưu tiên dòng chuyên biệt trước dòng chung."""
    ready = [a for a in PACS_ADAPTERS if a.is_ready(cap)]
    return max(ready, key=lambda a: a.priority) if ready else None


def _series_manifest_adapter(cap: ViewerCapture) -> Optional[PacsAdapter]:
    """Adapter đủ dữ kiện để LIỆT KÊ series."""
    ready = [a for a in PACS_ADAPTERS if a.has_series_manifest(cap)]
    return max(ready, key=lambda a: a.priority) if ready else None


def download_all(
    url: str,
    dicom_dir: Path,
    log: LogFn = _default_log,
    headless: bool = True,
    settle_ms: int = 8000,
    max_slices_per_series: int = 600,
    should_stop: Optional[Callable[[], bool]] = None,
    resume: bool = False,
    selected_series_ids: Optional[list[str]] = None,
    dicom_output_resolver: Optional[Callable[[bytes], Path]] = None,
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
    raw_jpg_dir = dicom_dir.parent / "RAW_JPG"
    # A fresh patient download can derive its final folder from the first DICOM
    # before anything is written. This avoids renaming a populated Windows
    # directory that Explorer/indexers may already have opened.
    output_resolved = dicom_output_resolver is None or resume
    if output_resolved:
        dicom_dir.mkdir(parents=True, exist_ok=True)
        raw_jpg_dir.mkdir(parents=True, exist_ok=True)

    stats = DownloadStats()
    selected_series = (
        {str(value) for value in selected_series_ids if str(value).strip()}
        if selected_series_ids is not None else None
    )
    if selected_series_ids is not None and not selected_series:
        raise ValueError("Chế độ tải chọn lọc cần ít nhất một series.")
    seen_hashes: set[str] = set()
    save_lock = threading.Lock()

    # Chế độ "thử lại/gộp": nạp sẵn ảnh đã có trong folder để KHÔNG ghi đè và KHÔNG
    # tải trùng — chỉ bổ sung ảnh mới. Tự động dọn dẹp file .dcm.part hoặc .dcm cụt cũ.
    if resume:
        for p in sorted(dicom_dir.rglob("*.dcm.part")):
            try:
                p.unlink()
            except Exception:
                pass
        for f in sorted(dicom_dir.rglob("*.dcm")):
            try:
                raw_bytes = f.read_bytes()
                valid, reason = _validate_dicom_bytes(raw_bytes)
                if not valid:
                    log(f"  [Dọn dẹp file hỏng cũ] {f.name}: {reason}")
                    try:
                        f.unlink()
                    except Exception:
                        pass
                    continue
                seen_hashes.add(hashlib.sha1(raw_bytes).hexdigest())
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

    def save_body(body: bytes, _depth: int = 0, fidelity: str = "original") -> bool:
        """Lưu 1 ảnh (nhận diện theo NỘI DUNG, không phụ thuộc endpoint), tự loại
        trùng theo SHA-1. An toàn khi gọi từ nhiều luồng.

        Trả về True nếu ảnh đã nằm trên đĩa (mới lưu hoặc đã có sẵn) — chỗ gọi
        dựa vào đây để biết ảnh nào cần tải lại, thay vì nuốt lỗi.

        `fidelity` cho biết ảnh này là bản gốc PACS phát ra ("original") hay do
        app dựng lại từ metadata + frame ("reconstructed"). Mặc định "original"
        để mọi chỗ gọi cũ giữ nguyên ý nghĩa; chỉ đường frames phải khai khác đi.
        """
        nonlocal dicom_dir, raw_jpg_dir, output_resolved
        if not body:
            return False
        data = _maybe_base64_decode(body)
        ext = _guess_ext(data)
        parsed_ds = None
        if ext is None:
            # WADO-RS thường gói DICOM trong multipart/related — bóc rồi thử lại
            if _depth == 0:
                parts = _multipart_parts(data)
                if not parts:
                    return False
                image_parts = [part for _pct, part in parts if _guess_ext(_maybe_base64_decode(part)) in ("dcm", "jpg", "png")]
                if not image_parts:
                    return False
                saved = [save_body(part, 1, fidelity) for part in image_parts]
                return bool(saved and all(saved))
            return False
        if ext == "dcm":
            valid, reason, parsed_ds = _validate_dicom_bytes_and_dataset(data)
            if not valid:
                # File DICOM cụt / hỏng: từ chối lưu để bộ retry tự động tải lại
                return False
        h = hashlib.sha1(data).hexdigest()
        with save_lock:
            if ext == "dcm" and not output_resolved and dicom_output_resolver is not None:
                dicom_dir = Path(dicom_output_resolver(data))
                raw_jpg_dir = dicom_dir.parent / "RAW_JPG"
                output_resolved = True
            if h in seen_hashes:
                stats.duplicates += 1
                return True
            seen_hashes.add(h)
            if ext == "dcm":
                stats.dicom += 1; idx = stats.dicom
                if fidelity == "reconstructed":
                    stats.reconstructed_dicom += 1
                else:
                    stats.original_dicom += 1
            elif ext == "jpg":
                stats.jpg += 1; idx = stats.jpg
            else:  # png
                stats.png += 1; idx = stats.png
            n = stats.total()
        if ext == "dcm":
            series_folder, filename = _dicom_storage_info(data, h, ds=parsed_ds)
            destination = dicom_dir / series_folder / filename
            destination.parent.mkdir(parents=True, exist_ok=True)
            temp_dest = destination.with_suffix(".dcm.part")
            try:
                temp_dest.write_bytes(data)
                temp_dest.replace(destination)
            except Exception:
                if temp_dest.exists():
                    try:
                        temp_dest.unlink()
                    except Exception:
                        pass
                raise
            if n % 25 == 0:
                log(f"  ...đã tải {n} ảnh (DICOM: {stats.dicom})")
        elif ext == "jpg":
            raw_jpg_dir.mkdir(parents=True, exist_ok=True)
            (raw_jpg_dir / f"img_{idx:05d}.jpg").write_bytes(data)
        else:
            raw_jpg_dir.mkdir(parents=True, exist_ok=True)
            (raw_jpg_dir / f"img_{idx:05d}.png").write_bytes(data)
        return True

    # Việc nhận diện dòng PACS nằm hết trong PACS_ADAPTERS ở trên.
    cap = ViewerCapture()
    capture_bodies = selected_series is None

    def _want_capture(resp) -> bool:
        u = resp.url
        if any(k in u for k in ("GetImage", "dicomData", "DicomImage", "wado",
                                "/frames/", "/instances/", "/preview")):
            return True
        ct = resp.headers.get("content-type", "").lower()
        return ("dicom" in ct) or ("octet-stream" in ct)

    def on_response(response) -> None:
        try:
            # Session/share bị server từ chối (vd PACS BV Hà Tĩnh trả 400 khi
            # link hết hạn: /ws/rest/v1/session/<uuid>)
            if (cap.session_error is None and response.status >= 400
                    and re.search(r"/(session|share)s?/[0-9a-fA-F\-]{8,}", response.url)):
                cap.session_error = str(response.status)
            # Manifest thì để adapter giữ, và KHÔNG đem đi lưu như ảnh.
            if _observe_response(response, cap):
                return
            if _want_capture(response) and capture_bodies:
                save_body(response.body())  # bắt thụ động (bonus + an toàn cho fallback)
        except Exception:
            pass  # không để lỗi 1 response làm hỏng cả phiên

    def _have_manifest() -> bool:
        return _ready_adapter(cap) is not None

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

        # Link wrapper của RIS đòi cookie đăng nhập mà trình tải không có. Nói
        # thẳng ra thay vì chạy tiếp rồi thu về vài ảnh của trang đăng nhập.
        try:
            if _is_ris_wrapper_url(url) and _page_is_ris_login(page):
                log("!!! Link này là TRANG WRAPPER của RIS và đang hiện màn hình ĐĂNG NHẬP. "
                    "Trình tải không có cookie phiên nên không thấy ảnh. Hãy dùng chức năng "
                    "'Tìm theo mã BN' (app tự xin link viewer), hoặc mở link trên trình duyệt "
                    "rồi copy đúng link viewer bên trong.")
                browser.close()
                return stats
        except Exception:
            pass

        # Chờ manifest (hoặc 1 ảnh mẫu) xuất hiện (tối đa ~12s)
        log("Đang dò manifest của viewer...")
        for _ in range(24):
            if stop() or _have_manifest() or cap.session_error:
                break
            page.wait_for_timeout(500)

        # Session chết (server trả 4xx cho API session, hoặc viewer hiện
        # "Cannot view images") -> báo rõ HẾT HẠN thay vì lặng lẽ ra 0 ảnh.
        if not _have_manifest():
            expired = bool(cap.session_error)
            if not expired:
                try:
                    txt = (page.evaluate(
                        "() => document.body ? document.body.innerText : ''") or "").lower()
                    expired = ("cannot view images" in txt) or ("urlexpired" in txt)
                except Exception:
                    pass
            if expired:
                code = cap.session_error or "?"
                log(f"!!! Link đã HẾT HẠN / SESSION không còn hiệu lực (server trả {code}). "
                    f"Hãy lấy LINK MỚI từ trang xem rồi tải lại NGAY (loại link này sống rất ngắn).")
                browser.close()
                return stats

        if _have_manifest():
            used_manifest = True
            try:
                from urllib.parse import urlparse as _up
                pu = _up(page.url)
                cap.host = f"{pu.scheme}://{pu.netloc}"
                cap.cookies = context.cookies()
            except Exception:
                pass
            log("✓ Có manifest → tải TRỰC TIẾP theo API (không cần click/cuộn).")
            browser.close()
        else:
            log("Không thấy manifest → chế độ MÔ PHỎNG (cuộn/click), chỉ xử lý xung ĐANG HIỂN THỊ.")
            capture_bodies = True
            page.wait_for_timeout(1500)
            _drive_viewer(
                page, log, stats, max_slices_per_series, stop,
                selected_series_ids=selected_series,
            )
            log(f"Chờ {settle_ms/1000:.0f}s để bắt nốt ảnh còn lại...")
            try:
                page.wait_for_load_state("networkidle", timeout=settle_ms)
            except Exception:
                page.wait_for_timeout(settle_ms)
            browser.close()

    # Tải trực tiếp (ngoài trình duyệt, bằng HTTP) nếu có manifest.
    #
    # `used_manifest` được chốt lúc đóng trình duyệt, KHÔNG tính lại ở đây: chế
    # độ mô phỏng có thể làm viewer phát muộn một response manifest, và nếu chỉ
    # nhìn `_ready_adapter(cap)` thì ca đó sẽ bị tải hai lượt.
    if used_manifest and not stop():
        adapter = _ready_adapter(cap)
        if adapter is not None:
            log(f"✓ Nhận diện dòng PACS: {adapter.name} → tải trực tiếp bằng API.")
            adapter.download(
                cap, save_body, stats, log, stop, selected_series,
            )

    log(f"Tải xong. Tổng ảnh: {stats.total()} "
        f"(DICOM {stats.dicom}, JPG {stats.jpg}, PNG {stats.png}, trùng bỏ {stats.duplicates}).")
    fidelity = stats.fidelity_report()
    if fidelity:
        log(f"  Nguồn gốc ảnh: {fidelity}.")
    return stats


def discover_viewer_series(
    url: str,
    log: LogFn = _default_log,
    headless: bool = True,
    should_stop: Optional[Callable[[], bool]] = None,
) -> dict:
    """Open a viewer read-only and return the selectable series inventory."""
    from playwright.sync_api import sync_playwright

    # Dùng CHUNG bộ adapter với `download_all()`. Trước đây chỗ này chép lại
    # logic nhận diện lần thứ hai, nên thêm một PACS mới là phải sửa cả hai nơi
    # và hai bản đã bắt đầu lệch nhau.
    cap = ViewerCapture()

    def stop() -> bool:
        return bool(should_stop and should_stop())

    def on_response(response) -> None:
        try:
            if (cap.session_error is None and response.status >= 400
                    and re.search(r"/(session|share)s?/[0-9a-fA-F\-]{8,}", response.url)):
                cap.session_error = str(response.status)
            _observe_response(response, cap)
        except Exception:
            pass

    browser = None
    with sync_playwright() as playwright:
        browser = _launch_chromium(playwright, headless, log)
        context = browser.new_context(
            viewport={"width": 1600, "height": 1000},
            ignore_https_errors=True,
        )
        page = context.new_page()
        page.on("response", on_response)
        log("      Bước 2/2: Đang đọc danh sách series từ viewer (chưa tải file ảnh)...")
        try:
            page.goto(url, wait_until="domcontentloaded", timeout=60000)
        except Exception as exc:
            log(f"  Cảnh báo khi mở viewer: {exc}")

        for _ in range(30):
            if stop() or _series_manifest_adapter(cap) or cap.session_error:
                break
            page.wait_for_timeout(400)

        if stop():
            browser.close()
            return {"source": "stopped", "series": [], "selectable": False}
        if cap.session_error:
            code = cap.session_error
            browser.close()
            raise ValueError(f"Link viewer hết hạn hoặc session bị từ chối (HTTP {code}).")

        source = ""
        choices: list[dict] = []
        try:
            adapter = _series_manifest_adapter(cap)
            if adapter is not None:
                source = adapter.source
                choices = adapter.series_choices(cap)
        except Exception as exc:
            log(f"Không đọc được danh sách series từ manifest: {exc}")

        if not choices:
            source = "viewer"
            try:
                page.wait_for_selector(
                    ".seriesThumb, .serieslist_panel_list, .seriesBox",
                    timeout=12000,
                )
            except Exception:
                pass
            try:
                panels = page.query_selector_all(
                    ".serieslist_panel_list, .verlist, .seriesThumb_container"
                )
                for panel in panels:
                    for _ in range(8):
                        page.evaluate("(el) => el.scrollTop = el.scrollHeight", panel)
                        page.wait_for_timeout(120)
            except Exception:
                pass
            thumbs = page.query_selector_all(".seriesThumb:visible")
            for index, thumb in enumerate(thumbs):
                description = ""
                number = ""
                count = 0
                try:
                    element = thumb.query_selector(
                        ".series_description_text, .series_number_text"
                    )
                    description = (element.inner_text() or "").strip() if element else ""
                    number_element = thumb.query_selector(".series_number_text")
                    number = (number_element.inner_text() or "").strip() if number_element else ""
                    count_element = thumb.query_selector(".series_imagecount_text")
                    count_text = (count_element.inner_text() or "") if count_element else ""
                    match = re.search(r"\d+", count_text)
                    count = int(match.group()) if match else 0
                except Exception:
                    pass
                choices.append(_normalise_series_choice({
                    "id": f"viewer:{index}",
                    "SeriesNumber": number,
                    "SeriesDescription": description or f"Series {index + 1}",
                    "ImageCount": count,
                }, "viewer", index))

        browser.close()
        if not choices:
            raise ValueError("Viewer không cung cấp manifest và không tìm thấy thumbnail series để chọn.")
        log(f"Đã quét {len(choices)} series; chưa tải file ảnh nào.")
        return {"source": source, "series": choices, "selectable": True}


def _run_fetch_tasks(tasks, fetch, stats: DownloadStats, log: LogFn,
                     stop: Callable[[], bool], passes: int = 3) -> None:
    """Tải song song và LÀM LẠI phần hỏng, rồi ghi lại số còn hỏng.

    Mạng bệnh viện chập chờn nên vài ảnh lỗi lẻ là chuyện thường; im lặng bỏ qua
    chúng chính là kiểu mất ảnh nguy hiểm nhất với dùng lâm sàng. Ở đây mỗi ảnh
    hỏng được giữ lại thử tiếp, số còn hỏng cuối cùng vào `stats.failed`.
    """
    from concurrent.futures import ThreadPoolExecutor

    def attempt(task) -> bool:
        if stop():
            return True  # dừng theo lệnh người dùng, không tính là ảnh hỏng
        try:
            return bool(fetch(task))
        except Exception:
            return False

    original_count = len(tasks)
    pending = list(tasks)
    for round_no in range(1, max(1, passes) + 1):
        if not pending or stop():
            break
        if round_no > 1:
            log(f"  ↻ Tải lại {len(pending)} ảnh bị hỏng (lượt {round_no}/{passes})...")
            time.sleep(1.5)
        with ThreadPoolExecutor(max_workers=6) as ex:
            results = list(ex.map(attempt, pending))
        pending = [task for task, ok in zip(pending, results) if not ok]

    stats.failed = 0 if stop() else len(pending)
    stats.completed_tasks = max(stats.completed_tasks, original_count - len(pending))


def _report_download_result(stats: DownloadStats, expected: int, log: LogFn,
                            stop: Callable[[], bool]) -> None:
    """Kết luận đủ/thiếu. Thiếu thì phải nói THẲNG là thiếu."""
    expected = int(expected or 0)
    stats.expected = max(stats.expected, expected)
    if stop():
        log(f"  ⏹ Đã dừng theo yêu cầu: {stats.dicom}/{expected or '?'} ảnh.")
        return
    completed = stats.completed_tasks or stats.dicom
    if expected and completed >= expected:
        log(f"  ✓ Đã đủ theo manifest: {completed}/{expected} ảnh.")
    elif expected:
        log(f"  ❌ THIẾU ẢNH: mới có {completed}/{expected} "
            f"(còn hỏng {stats.failed} sau khi đã thử lại). Ca này sẽ bị đánh dấu "
            f"CHƯA ĐỦ để tải bù, KHÔNG tính là hoàn tất.")
    else:
        log(f"  ⚠ Viewer không khai báo tổng số ảnh — đã lấy {stats.total()} ảnh, "
            f"không thể tự đối chiếu đủ/thiếu.")


def _download_via_manifest(captured, save_body, stats,
                           log: LogFn, stop: Callable[[], bool],
                           selected_series: Optional[set[str]] = None) -> None:
    """
    Tải trực tiếp MỌI ảnh dựa trên manifest VradViewer (StudyData/GetStudies) +
    1 URL ảnh thật làm khuôn tham số. Không click/cuộn, biết trước số ảnh và đối
    chiếu đủ/thiếu. Chữ ký (signature) lấy từ chính manifest theo từng ảnh.
    """
    import json
    import ssl
    import urllib.request
    from urllib.parse import urlparse, parse_qs, urlencode

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
    selected_count = 0
    for series_index, s in enumerate(series_list):
        choice = _normalise_series_choice(s, "vrad", series_index)
        if selected_series is not None and choice["id"] not in selected_series:
            continue
        selected_count += 1
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

    if selected_series is not None and selected_count == 0:
        raise ValueError("Không còn tìm thấy series đã chọn trong manifest VradViewer mới.")
    if selected_series is None:
        log(f"Manifest: {selected_count} series, ~{total_expected} ảnh. "
            f"Đang tải trực tiếp {len(tasks)} ảnh (6 luồng song song)...")
    else:
        log(f"Manifest: {selected_count} series đã chọn/{len(series_list)} series, ~{total_expected} ảnh. "
            f"Đang tải trực tiếp {len(tasks)} ảnh (6 luồng song song)...")

    def fetch_one(u) -> bool:
        with urllib.request.urlopen(u, timeout=45, context=sslctx) as r:
            return save_body(r.read())

    _run_fetch_tasks(tasks, fetch_one, stats, log, stop)
    _report_download_result(stats, total_expected or len(tasks), log, stop)


def _download_via_vrpacs(captured, save_body, stats,
                         log: LogFn, stop: Callable[[], bool],
                         selected_series: Optional[set[str]] = None) -> None:
    """
    Tải trực tiếp mọi ảnh từ manifest của viewer vrpacs/telerad
    (vrpacs-file/get-share-patient-image). Mỗi ảnh là 1 imageId dạng
    'wadouri:/vrpacs-scu/study-get-public?link=...&file=<uid>.dcm' — chỉ cần bỏ
    tiền tố 'wadouri:' và ghép host là tải được DICOM gốc.
    """
    import json
    import ssl
    import urllib.request

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

    tasks, n_series, series_index = [], 0, 0
    for st in studies:
        for se in (st.get("seriesList", []) or []):
            choice = _normalise_series_choice(se, "vrpacs", series_index)
            series_index += 1
            if selected_series is not None and choice["id"] not in selected_series:
                continue
            n_series += 1
            for iid in (se.get("imageIds", []) or []):
                if iid:
                    tasks.append(to_url(iid))

    if selected_series is not None and n_series == 0:
        raise ValueError("Không còn tìm thấy series đã chọn trong manifest vrpacs mới.")
    cj = "; ".join(f'{c.get("name")}={c.get("value")}' for c in (captured.get("cookies") or []))
    sslctx = ssl.create_default_context()
    sslctx.check_hostname = False
    sslctx.verify_mode = ssl.CERT_NONE

    log(f"Manifest (vrpacs): {n_series} series, {len(tasks)} ảnh. "
        f"Đang tải trực tiếp (6 luồng song song)...")

    def fetch_one(u) -> bool:
        req = urllib.request.Request(u, headers={"Cookie": cj} if cj else {})
        with urllib.request.urlopen(req, timeout=45, context=sslctx) as r:
            return save_body(r.read())

    _run_fetch_tasks(tasks, fetch_one, stats, log, stop)
    _report_download_result(stats, len(tasks), log, stop)


def _download_via_dicomweb(captured, save_body, stats,
                           log: LogFn, stop: Callable[[], bool],
                           selected_series: Optional[set[str]] = None) -> None:
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
        return _dicom_json_value(el, tag)

    try:
        series = get_json(f"{rs_base}/studies/{study}/series")
    except Exception as e:
        log(f"  Lỗi QIDO series ({e}) — bỏ qua."); return

    log(f"DICOMweb: {len(series)} series. Đang liệt kê ảnh...")
    instances_by_series: dict[str, list[dict]] = {}
    for s in series:
        if stop():
            break
        suid = str(V(s, "0020000E") or "").strip()
        if not suid:
            continue
        if selected_series is not None and suid not in selected_series:
            continue
        if _is_non_image_modality(V(s, "00080060")):
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
        instances_by_series[suid] = insts if isinstance(insts, list) else []

    if stop():
        return

    tasks, image_series_count, skipped_non_image, missing = _dicomweb_instance_plan(
        series, instances_by_series, selected_series,
    )

    # Some PACS expose the series but reject `/series/<uid>/instances` for large
    # diagnostic stacks. Recover from the study-wide instance/metadata endpoint
    # and regroup by SeriesInstanceUID before declaring anything complete.
    if missing and not stop():
        for endpoint in (
            f"{rs_base}/studies/{study}/instances?limit=100000",
            f"{rs_base}/studies/{study}/instances",
            f"{rs_base}/studies/{study}/metadata",
        ):
            if stop():
                return
            try:
                candidate = get_json(endpoint)
            except Exception:
                continue
            if not isinstance(candidate, list) or not candidate:
                continue
            for instance in candidate:
                suid = str(V(instance, "0020000E") or "").strip()
                if suid:
                    instances_by_series.setdefault(suid, []).append(instance)
            tasks, image_series_count, skipped_non_image, missing = _dicomweb_instance_plan(
                series, instances_by_series, selected_series,
            )
            if not missing:
                break

    if missing:
        details = "; ".join(missing)
        raise RuntimeError(
            "DICOMweb chưa liệt kê đủ instance của mọi series ảnh; "
            f"không đánh dấu ca là hoàn tất. {details}"
        )

    if skipped_non_image:
        log(f"  Bỏ qua {len(skipped_non_image)} series không phải ảnh "
            f"({', '.join(skipped_non_image)}) — không có dữ liệu điểm ảnh nên không "
            f"tính vào tổng số ảnh của ca.")

    if selected_series is not None and image_series_count == 0:
        raise ValueError("Không còn tìm thấy series đã chọn trong manifest DICOMweb mới.")
    total = len(tasks)
    selected_label = " series ảnh đã chọn" if selected_series is not None else " series ảnh"
    log(f"DICOMweb: {image_series_count}{selected_label}, {total} ảnh. "
        f"Đang tải trực tiếp (6 luồng song song)...")

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
        return save_body(body)

    def try_wadors(suid, iuid, nf, meta_in):
        u = f"{rs_base}/studies/{study}/series/{suid}/instances/{iuid}"
        body, ct = get_raw(u, accept='multipart/related; type="application/dicom", application/dicom')
        parts = _multipart_parts(body, ct)
        if parts:
            saved = [save_body(d) for _pct, d in parts if _guess_ext(d) == "dcm"]
            return bool(saved and all(saved))
        if _guess_ext(body) == "dcm":
            return save_body(body)
        return False

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
        # File này do app tự dựng từ metadata + frame, không phải Part-10 gốc
        # của PACS — phải khai đúng để báo cáo cuối nói thật.
        return save_body(blob, fidelity="reconstructed")

    fetchers = {"wadouri": try_wadouri, "wadors": try_wadors, "frames": try_frames}

    def fetch_one(task) -> bool:
        suid, iuid, nf, meta_in = task
        for name in list(order):
            try:
                if fetchers[name](suid, iuid, nf, meta_in):
                    if order[0] != name:  # nhớ cách vừa thành công cho các ảnh sau
                        order.remove(name)
                        order.insert(0, name)
                    return True
            except Exception:
                continue
        return False

    _run_fetch_tasks(tasks, fetch_one, stats, log, stop)
    _report_download_result(stats, total, log, stop)


def _drive_viewer(page, log: LogFn, stats: DownloadStats,
                  max_slices: int, stop: Callable[[], bool],
                  selected_series_ids: Optional[set[str]] = None) -> None:
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
        if selected_series_ids is not None and f"viewer:{idx}" not in selected_series_ids:
            continue

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


PATIENT_MANIFEST_NAME = "patient-index.json"
PATIENT_MANIFEST_FORMAT = "dcom-patient-index-v1"


class PatientIdentityConflictError(ValueError):
    """A folder contains DICOM identities that must not be merged."""


def _identity_token(value: Any) -> str:
    """Normalize a patient/hospital identity value for local matching only."""
    text = unicodedata.normalize("NFKD", str(value or ""))
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    return re.sub(r"[^A-Z0-9]+", "", text.upper())


def _study_patient_name(study: dict) -> str:
    for key in (
        "patientName", "patientFullName", "PatientName", "patient_name",
        "fullName", "patientFullname", "patientNameUnsign", "ptName",
        "patName", "tenBenhNhan", "hoTen", "hoten",
    ):
        value = study.get(key)
        if value is not None and str(value).strip():
            return re.sub(r"\s+", " ", str(value)).strip()
    nested = study.get("patient")
    if isinstance(nested, dict):
        return _study_patient_name(nested)
    if isinstance(nested, str) and nested.strip():
        return re.sub(r"\s+", " ", nested).strip()
    return ""


def _study_patient_value(study: dict, *keys: str) -> str:
    for key in keys:
        value = study.get(key)
        if value is not None and str(value).strip():
            return str(value).strip()
    nested = study.get("patient")
    if isinstance(nested, dict):
        return _study_patient_value(nested, *keys)
    return ""


def _patient_display_name(value: Any) -> str:
    """Turn a DICOM PN value into a readable folder component."""
    raw = str(value or "").strip()
    if _is_redacted_patient_value(raw):
        return ""
    parts = [part.strip() for part in raw.split("^") if part.strip()]
    if parts and re.fullmatch(r"\d{1,3}(?:T|TUOI|Y|YEAR|YEARS)", _identity_token(parts[-1])):
        parts.pop()
    text = " ".join(parts) if "^" in raw else raw
    text = re.sub(r"\s+\d{1,3}\s*(?:T|TUỔI|TUOI|Y|YEARS?)\s*$", "", text, flags=re.IGNORECASE)
    return re.sub(r"\s+", " ", text).strip()


def _is_redacted_patient_value(value: Any) -> bool:
    raw = str(value or "").strip()
    token = _identity_token(raw)
    if not raw or not token:
        return True
    return token in {
        "ANON", "ANONYMOUS", "ANONYMIZED", "ANONYMISED", "REDACTED",
        "MASKED", "REMOVED", "HIDDEN", "UNKNOWN", "XXX", "XXXX",
    }


def _normalise_dicom_date(value: Any) -> str:
    digits = re.sub(r"\D", "", str(value or ""))
    if len(digits) < 8:
        return ""
    try:
        parsed = datetime.strptime(digits[:8], "%Y%m%d")
    except ValueError:
        return ""
    return parsed.strftime("%Y-%m-%d")


def _normalise_manual_birth_date(dob: str) -> str:
    dob = str(dob).strip()
    if not dob:
        return ""
    if re.fullmatch(r"\d{8}", dob):
        return _normalise_dicom_date(dob)
    match = re.search(r"(\d{1,4})[/-](\d{1,2})[/-](\d{1,4})", dob)
    if match:
        p1, p2, p3 = match.groups()
        if len(p1) == 4:
            dicom_date = f"{p1}{int(p2):02d}{int(p3):02d}"
        else:
            dicom_date = f"{p3}{int(p2):02d}{int(p1):02d}"
        return _normalise_dicom_date(dicom_date)
    match = re.search(r"\b(\d{4})\b", dob)
    if match:
        return _normalise_dicom_date(f"{match.group(1)}0101")
    return ""


def _age_from_dates(birth_date: str, study_date: str) -> tuple[str, Optional[int]]:
    """Return a human label and completed years at the study date."""
    try:
        birth = datetime.strptime(birth_date, "%Y-%m-%d").date()
        study = datetime.strptime(study_date, "%Y-%m-%d").date()
    except ValueError:
        return "", None
    if study < birth:
        return "", None
    years = study.year - birth.year - ((study.month, study.day) < (birth.month, birth.day))
    if years > 0:
        return f"{years}T", years
    months = (study.year - birth.year) * 12 + study.month - birth.month
    months -= study.day < birth.day
    if months > 0:
        return f"{months} tháng", 0
    return f"{(study - birth).days} ngày", 0


def _normalise_patient_age(
    raw_age: Any,
    birth_date: str,
    study_date: str,
) -> tuple[str, Optional[int], str]:
    raw = str(raw_age or "").strip().upper()
    derived, derived_years = _age_from_dates(birth_date, study_date)
    if derived:
        return derived, derived_years, "DICOM.PatientBirthDate+StudyDate"
    match = re.fullmatch(r"(\d{3})([DWMY])", raw)
    if match:
        value = int(match.group(1))
        unit = match.group(2)
        if unit == "Y" and value > 0:
            return f"{value}T", value, "DICOM.PatientAge"
        if unit == "M" and value > 0:
            return f"{value} tháng", 0, "DICOM.PatientAge"
        if unit == "W" and value > 0:
            return f"{value} tuần", 0, "DICOM.PatientAge"
        if unit == "D" and value > 0:
            return f"{value} ngày", 0, "DICOM.PatientAge"
        labels = {"Y": "0T", "M": "0 tháng", "W": "0 tuần", "D": "0 ngày"}
        return labels[unit], 0, "DICOM.PatientAge"
    return "KHONG_RO_TUOI", None, ""


def _now_local() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def _study_date_token(value: Any) -> str:
    digits = re.sub(r"\D", "", str(value or ""))
    if len(digits) >= 8:
        return f"{digits[:4]}-{digits[4:6]}-{digits[6:8]}"
    return _safe_name(value or "KHONG_RO_NGAY")


def study_folder_base_name(study: dict) -> str:
    """Readable study folder name, without the UID collision token."""
    modality = _safe_name(study.get("modality") or "UNKNOWN")[:12]
    description = _safe_name(study.get("desc") or "KHONG_RO_MO_TA")[:40]
    return f"{_study_date_token(study.get('date'))} - {modality} - {description}"


def study_archive_folder_name(study: dict) -> str:
    """Return exactly `<date> - <modality> - <description>`."""
    return study_folder_base_name(study)


def resolve_study_folder_name(patient_folder: Path, study: dict) -> str:
    """Pick this study's folder name inside a patient archive.

    New folders never expose a UID/hash suffix. Existing manifest entries are
    still reused verbatim so an older archive can resume without duplication.
    """
    patient_folder = Path(patient_folder)
    uid = str(study.get("study_uid") or study.get("uid") or "").strip()
    known = (_read_patient_manifest(patient_folder) or {}).get("studies") or {}
    entry = known.get(uid) if uid else None
    if isinstance(entry, dict) and str(entry.get("folder") or "").strip():
        return str(entry["folder"])

    plain = study_folder_base_name(study)
    taken = {
        str(item.get("folder") or "").casefold()
        for key, item in known.items()
        if isinstance(item, dict) and key != uid
    }
    if plain.casefold() not in taken and not (patient_folder / plain).exists():
        return plain
    counter = 2
    while True:
        candidate = f"{plain} ({counter})"
        if candidate.casefold() not in taken and not (patient_folder / candidate).exists():
            return candidate
        counter += 1


def _read_patient_manifest(folder: Path) -> Optional[dict]:
    path = Path(folder) / PATIENT_MANIFEST_NAME
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError):
        return None
    if not isinstance(data, dict) or data.get("format") != PATIENT_MANIFEST_FORMAT:
        return None
    if not isinstance(data.get("studies"), dict):
        data["studies"] = {}
    return data


def _legacy_study_index(folder: Path) -> dict[str, dict]:
    """Recover StudyInstanceUIDs from a pre-registry patient folder."""
    try:
        import pydicom
    except Exception:
        return {}
    grouped: dict[str, dict] = {}
    for path in discover_dicom_files(folder):
        try:
            ds = pydicom.dcmread(
                str(path),
                stop_before_pixels=True,
                force=True,
                specific_tags=[
                    "StudyInstanceUID", "StudyDate", "Modality", "StudyDescription",
                ],
            )
        except Exception:
            continue
        uid = str(getattr(ds, "StudyInstanceUID", "") or "").strip()
        if not uid:
            continue
        entry = grouped.setdefault(uid, {
            "studyUid": uid,
            "date": str(getattr(ds, "StudyDate", "") or ""),
            "modality": str(getattr(ds, "Modality", "") or ""),
            "description": str(getattr(ds, "StudyDescription", "") or ""),
            "folder": "",
            "status": "complete",
            "imageCount": 0,
            "downloadedAt": "",
            "importedFromLegacy": True,
        })
        entry["imageCount"] += 1
        if not entry["folder"]:
            try:
                entry["folder"] = str(path.parent.relative_to(folder))
            except ValueError:
                entry["folder"] = ""
    return grouped


def _legacy_patient_identity(folder: Path) -> tuple[str, str]:
    try:
        import pydicom
    except Exception:
        return "", ""
    for path in discover_dicom_files(folder):
        try:
            ds = pydicom.dcmread(
                str(path),
                stop_before_pixels=True,
                force=True,
                specific_tags=["PatientID", "PatientName"],
            )
        except Exception:
            continue
        patient_id = str(getattr(ds, "PatientID", "") or "").strip()
        patient_name = str(getattr(ds, "PatientName", "") or "").strip()
        if patient_id or patient_name:
            return patient_id, patient_name
    return "", ""


def _write_patient_manifest(folder: Path, manifest: dict) -> None:
    folder = Path(folder)
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / PATIENT_MANIFEST_NAME
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    temporary.replace(path)


def _manifest_identity_matches(manifest: dict, patient_id: str, hospital_key: str) -> bool:
    return (
        _identity_token(manifest.get("patientId")) == _identity_token(patient_id)
        and _identity_token(manifest.get("hospitalKey")) == _identity_token(hospital_key)
    )


def _patient_name_conflicts(stored: str, current: str) -> bool:
    stored_name = _patient_display_name(stored)
    current_name = _patient_display_name(current)
    return bool(
        stored_name
        and current_name
        and _identity_token(stored_name) != _identity_token(current_name)
    )


def _legacy_patient_folder_matches(folder: Path, patient_id: str, hospital_key: str) -> bool:
    expected = _identity_token(f"{hospital_key}_BN_{patient_id}")
    return bool(expected and _identity_token(folder.name) == expected)


def find_patient_archive(
    output_root: Path,
    patient_id: str,
    hospital_key: str,
) -> tuple[Optional[Path], Optional[dict]]:
    """Find one stable patient archive without creating or modifying folders."""
    root = Path(output_root).expanduser().resolve()
    candidates = [root]
    if root.is_dir():
        try:
            children = [path for path in root.iterdir() if path.is_dir()]
            candidates.extend(children)
            # Classic commonly stored `<timestamp>/<BV>_BN_<PID>`. Inspect
            # exactly one extra level for that legacy name, not an unbounded
            # recursive scan of the whole imaging archive.
            for child in children:
                try:
                    candidates.extend(
                        path for path in child.iterdir()
                        if path.is_dir()
                        and _legacy_patient_folder_matches(path, patient_id, hospital_key)
                    )
                except OSError:
                    continue
        except OSError:
            pass

    matched: list[tuple[Path, dict]] = []
    legacy: list[Path] = []
    for folder in candidates:
        manifest = _read_patient_manifest(folder)
        if manifest and _manifest_identity_matches(manifest, patient_id, hospital_key):
            matched.append((folder, manifest))
        elif not manifest and _legacy_patient_folder_matches(folder, patient_id, hospital_key):
            legacy.append(folder)
    if len(matched) > 1:
        raise ValueError(
            f"Có nhiều folder cùng mã bệnh nhân {patient_id} tại {root}; cần hợp nhất thủ công trước."
        )
    if matched:
        return matched[0]
    if len(legacy) > 1:
        raise ValueError(
            f"Có nhiều folder cũ cùng mã bệnh nhân {patient_id} tại {root}; cần chọn đúng folder."
        )
    return (legacy[0], None) if legacy else (None, None)


def patient_archive_status(
    output_root: Path,
    *,
    patient_id: str,
    patient_name: str,
    hospital_key: str,
    hospital_name: str,
    studies: list[dict],
) -> dict:
    folder, manifest = find_patient_archive(output_root, patient_id, hospital_key)
    legacy_id, legacy_name = _legacy_patient_identity(folder) if folder and not manifest else ("", "")
    stored_name = str((manifest or {}).get("patientName") or legacy_name or "")
    conflict = (
        _patient_name_conflicts(stored_name, patient_name)
        or bool(legacy_id and _identity_token(legacy_id) != _identity_token(patient_id))
    )
    known = (manifest or {}).get("studies") or (_legacy_study_index(folder) if folder else {})
    patient_birth_date = str((manifest or {}).get("patientBirthDate") or "")
    current_age, current_age_years = _age_from_dates(
        patient_birth_date,
        datetime.now().strftime("%Y-%m-%d"),
    )
    new_count = downloaded_count = incomplete_count = selected_count = 0
    for study in studies:
        uid = str(study.get("study_uid") or "")
        entry = known.get(uid) if uid else None
        if isinstance(entry, dict) and entry.get("status") == "complete":
            study["local_status"] = "downloaded"
            downloaded_count += 1
        elif isinstance(entry, dict) and entry.get("status") == "selected":
            study["local_status"] = "selected"
            study["selected_series"] = list(entry.get("selectedSeries") or [])
            selected_count += 1
        elif isinstance(entry, dict):
            study["local_status"] = "incomplete"
            incomplete_count += 1
        else:
            study["local_status"] = "new"
            new_count += 1
    return {
        "exists": bool(folder),
        "folder": str(folder) if folder else "",
        "patientId": patient_id,
        "patientName": patient_name or stored_name,
        "patientBirthDate": patient_birth_date,
        "patientSex": str((manifest or {}).get("patientSex") or ""),
        "currentAge": current_age,
        "currentAgeYears": current_age_years,
        "hospitalKey": hospital_key,
        "hospitalName": hospital_name,
        "nameConflict": conflict,
        "storedPatientName": stored_name,
        "newStudies": new_count,
        "downloadedStudies": downloaded_count,
        "selectedStudies": selected_count,
        "incompleteStudies": incomplete_count,
        "legacyStudiesDetected": sum(
            1 for entry in known.values()
            if isinstance(entry, dict) and entry.get("importedFromLegacy")
        ),
    }


def ensure_patient_archive(
    output_root: Path,
    *,
    patient_id: str,
    patient_name: str,
    hospital_key: str,
    hospital_name: str,
    patient_birth_date: str = "",
    patient_sex: str = "",
) -> tuple[Path, dict, bool]:
    root = Path(output_root).expanduser().resolve()
    root.mkdir(parents=True, exist_ok=True)
    folder, manifest = find_patient_archive(root, patient_id, hospital_key)
    created = False
    legacy_id, legacy_name = _legacy_patient_identity(folder) if folder and not manifest else ("", "")
    if legacy_id and _identity_token(legacy_id) != _identity_token(patient_id):
        raise ValueError(
            f"Folder cũ có PatientID '{legacy_id}', không khớp mã đang tìm '{patient_id}'. Không tự động gộp."
        )
    if _patient_name_conflicts(legacy_name, patient_name):
        raise ValueError(
            "Folder cũ có cùng mã trong tên nhưng PatientName DICOM không khớp: "
            f"'{legacy_name}' so với '{patient_name}'. Không tự động gộp."
        )
    if manifest and _patient_name_conflicts(str(manifest.get("patientName") or ""), patient_name):
        raise ValueError(
            "Mã bệnh nhân đã tồn tại nhưng tên không khớp: "
            f"đã lưu '{manifest.get('patientName')}', RIS trả '{patient_name}'. Không tự động gộp."
        )
    if folder is None:
        created_date = datetime.now().strftime("%Y-%m-%d")
        display_name = patient_name or "KHONG_RO_TEN"
        pid = patient_id or "KHONG_RO_ID"
        folder_name = " - ".join((
            _safe_name(display_name),
            "KHONG_RO_TUOI",
            _safe_name(pid),
            created_date,
        ))
        folder = root / folder_name
        if folder.exists():
            counter = 2
            while (root / f"{folder_name} ({counter})").exists():
                counter += 1
            folder = root / f"{folder_name} ({counter})"
        folder.mkdir(parents=True, exist_ok=False)
        created = True

    now = _now_local()
    if manifest is None:
        manifest = {
            "format": PATIENT_MANIFEST_FORMAT,
            "patientId": patient_id,
            "patientName": patient_name or legacy_name,
            "patientBirthDate": _normalise_dicom_date(patient_birth_date),
            "patientSex": str(patient_sex or "").strip().upper(),
            "hospitalKey": hospital_key,
            "hospitalName": hospital_name,
            "createdAt": now,
            "updatedAt": now,
            "studies": _legacy_study_index(folder),
        }
    else:
        if patient_name and not manifest.get("patientName"):
            manifest["patientName"] = patient_name
        if patient_birth_date and not manifest.get("patientBirthDate"):
            manifest["patientBirthDate"] = _normalise_dicom_date(patient_birth_date)
        if patient_sex and not manifest.get("patientSex"):
            manifest["patientSex"] = str(patient_sex).strip().upper()
        manifest["hospitalName"] = hospital_name or manifest.get("hospitalName", "")
        manifest["updatedAt"] = now
    _write_patient_manifest(folder, manifest)
    return folder, manifest, created


def record_patient_study(
    patient_folder: Path,
    study: dict,
    study_folder: Path,
    *,
    complete: bool,
    image_count: int,
    selected_series_ids: Optional[list[str]] = None,
    selection_complete: bool = False,
    patient_metadata: Optional[dict] = None,
) -> None:
    manifest = _read_patient_manifest(patient_folder)
    if manifest is None:
        raise ValueError("Thiếu patient-index.json khi cập nhật study.")
    uid = str(study.get("study_uid") or "").strip()
    if not uid:
        raise ValueError("Study thiếu StudyInstanceUID.")
    previous = manifest["studies"].get(uid) or {}
    metadata = patient_metadata or {}
    if metadata:
        _assert_patient_metadata_matches(
            str(manifest.get("patientId") or ""),
            str(manifest.get("patientName") or ""),
            metadata,
            str(manifest.get("patientBirthDate") or ""),
            str(manifest.get("patientSex") or ""),
        )
        _merge_manifest_demographics(manifest, metadata)
    selected = sorted({
        *(str(value) for value in (previous.get("selectedSeries") or []) if str(value)),
        *(str(value) for value in (selected_series_ids or []) if str(value)),
    })
    if complete or previous.get("status") == "complete":
        status = "complete"
    elif selection_complete:
        status = "selected"
    else:
        status = previous.get("status", "incomplete")
    manifest["studies"][uid] = {
        "studyUid": uid,
        "date": study.get("date") or "",
        "modality": study.get("modality") or "",
        "description": study.get("desc") or "",
        "folder": str(Path(study_folder).relative_to(patient_folder)),
        "status": status,
        "imageCount": max(int(image_count or 0), int(previous.get("imageCount") or 0)),
        "downloadedAt": _now_local() if (complete or selection_complete) else previous.get("downloadedAt", ""),
        "selectedSeries": selected,
        "patientAgeRaw": metadata.get("PatientAgeRaw") or previous.get("patientAgeRaw", ""),
        "patientAgeAtStudy": metadata.get("PatientAge") or previous.get("patientAgeAtStudy", ""),
        "patientAgeAtStudyYears": (
            metadata.get("PatientAgeYears")
            if metadata.get("PatientAgeYears") is not None
            else previous.get("patientAgeAtStudyYears")
        ),
        "patientAgeSource": metadata.get("PatientAgeSource") or previous.get("patientAgeSource", ""),
        "patientBirthDate": metadata.get("PatientBirthDate") or previous.get("patientBirthDate", ""),
        "patientSex": metadata.get("PatientSex") or previous.get("patientSex", ""),
    }
    manifest["updatedAt"] = _now_local()
    _write_patient_manifest(patient_folder, manifest)


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


def _voi_output_range(ds, windowed):
    """Dải giá trị mà VOI của pydicom xuất ra, để map sang 8-bit đúng cửa sổ.

    KHÔNG được dùng min/max của ảnh đã cắt cửa sổ: nếu lát cắt không chạm cả hai
    đầu cửa sổ (lát rìa, ảnh không có khí hoặc không có xương) thì min/max hẹp
    hơn cửa sổ, và kéo giãn theo chúng sẽ đẩy tương phản lệch khỏi mức lâm sàng
    — mỗi lát một kiểu.
    """
    import numpy as np

    # VOI LUT Sequence: pydicom xuất ra chỉ số bảng tra, dải do bảng quy định.
    lut = getattr(ds, "VOILUTSequence", None)
    if lut:
        try:
            bits = int(lut[0].LUTDescriptor[2])
            return 0.0, float(2 ** bits - 1)
        except Exception:
            return float(windowed.min()), float(windowed.max())

    center = _dicom_first_number(getattr(ds, "WindowCenter", None))
    width = _dicom_first_number(getattr(ds, "WindowWidth", None))
    if center is None or width is None or width <= 0:
        return None

    # Cửa sổ tuyến tính: pydicom map vào [y_min, y_max] theo PS3.3 C.11.2.1.2.
    # Phải lặp lại đúng công thức của pydicom — với CT (signed + RescaleIntercept
    # -1024) dải này KHÔNG phải [0, 2**bits - 1].
    if "ModalityLUTSequence" in ds:
        try:
            bits = int(ds.ModalityLUTSequence[0].LUTDescriptor[2])
        except Exception:
            return float(windowed.min()), float(windowed.max())
        y_min, y_max = 0.0, float(2 ** bits - 1)
    else:
        try:
            bits = int(getattr(ds, "BitsStored", 16) or 16)
        except (TypeError, ValueError):
            bits = 16
        bits = max(1, min(bits, 32))
        if int(getattr(ds, "PixelRepresentation", 0) or 0) == 0:
            y_min, y_max = 0.0, float(2 ** bits - 1)
        else:
            y_min, y_max = float(-(2 ** (bits - 1))), float(2 ** (bits - 1) - 1)

    slope = _dicom_first_number(getattr(ds, "RescaleSlope", None))
    intercept = _dicom_first_number(getattr(ds, "RescaleIntercept", None))
    if slope is not None and intercept is not None:
        y_min = y_min * slope + intercept
        y_max = y_max * slope + intercept

    return (y_min, y_max) if y_max > y_min else (y_max, y_min)


def _dicom_first_number(value):
    if value is None:
        return None
    if not isinstance(value, (str, bytes)) and hasattr(value, "__len__"):
        if len(value) == 0:
            return None
        value = value[0]
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    import math as _math
    return result if _math.isfinite(result) else None


def _gray_to_uint8(arr, ds, contrast_mode: str):
    """Chuyển 1 khung ảnh xám (đã qua modality LUT) sang 8-bit theo chế độ tương phản."""
    import numpy as np

    if contrast_mode == AUTO:
        arr = arr.astype(np.float32)
        low, high = np.percentile(arr, (1, 99))
        if high <= low:
            low, high = float(arr.min()), float(arr.max())
        return _stretch_uint8(arr, low, high)

    # CLINICAL: để pydicom áp VOI đúng chuẩn (LUT sequence / sigmoid / linear).
    # Giữ nguyên dtype nguyên của `arr`: VOI LUT Sequence dùng giá trị pixel làm
    # chỉ số tra bảng, nên pydicom cảnh báo "may give incorrect results" khi đầu
    # vào là float — chỉ số bị cắt phần thập phân, tra nhầm ô bảng.
    try:
        try:
            from pydicom.pixels import apply_voi_lut
        except ImportError:  # pragma: no cover - compatibility with pydicom 2.4
            from pydicom.pixel_data_handlers.util import apply_voi_lut
        windowed = apply_voi_lut(arr, ds)
        bounds = _voi_output_range(ds, windowed)
        if bounds is not None and bounds[1] > bounds[0]:
            return _stretch_uint8(windowed.astype(np.float32), bounds[0], bounds[1])
    except Exception:
        pass

    # Không có thông tin window (WC/WW, VOI LUT...) -> kéo giãn nhẹ theo percentile
    arr = arr.astype(np.float32)
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
    valid, reason = _is_dicom_dataset_valid_for_decode(ds)
    if not valid:
        raise ValueError(f"DICOM dataset không hợp lệ để giải mã: {reason}")
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


def _finite_dicom_values(value: Any, count: int) -> Optional[list[float]]:
    """Return a finite DICOM numeric vector without inventing missing values."""
    try:
        values = [float(item) for item in value]
    except (TypeError, ValueError):
        return None
    if len(values) != count or not all(math.isfinite(item) for item in values):
        return None
    return values


def _generic_jpg_spatial_geometry(items: list[dict]) -> Optional[dict]:
    """Build the minimal real-DICOM geometry needed for 2D JPG crosslinking.

    This deliberately does not add an affine matrix.  A generic JPG stack may
    be perfectly adequate for PACS-style 2D point/slice linking while still
    failing the stricter MPR/3D contract.  Keeping those readiness decisions
    separate prevents a 20-slice T2 stack from losing its patient-space
    coordinates merely because it cannot form a diagnostic volume.
    """
    if len(items) < 2:
        return None
    first = items[0]
    rows = int(first.get("rows") or 0)
    columns = int(first.get("columns") or 0)
    spacing = first.get("pixel_spacing")
    orientation = first.get("orientation")
    if (
        rows <= 0
        or columns <= 0
        or not spacing
        or min(spacing) <= 0
        or not orientation
    ):
        return None

    row = orientation[:3]
    column = orientation[3:]
    row_norm = math.sqrt(sum(value * value for value in row))
    column_norm = math.sqrt(sum(value * value for value in column))
    dot = sum(a * b for a, b in zip(row, column))
    normal = [
        row[1] * column[2] - row[2] * column[1],
        row[2] * column[0] - row[0] * column[2],
        row[0] * column[1] - row[1] * column[0],
    ]
    normal_norm = math.sqrt(sum(value * value for value in normal))
    if (
        abs(row_norm - 1) > 1e-3
        or abs(column_norm - 1) > 1e-3
        or abs(dot) > 1e-3
        or normal_norm <= 1e-9
    ):
        return None
    normal = [value / normal_norm for value in normal]

    def close(left: list[float], right: list[float]) -> bool:
        return len(left) == len(right) and all(
            abs(a - b) <= 1e-4 for a, b in zip(left, right)
        )

    if any(
        int(item.get("rows") or 0) != rows
        or int(item.get("columns") or 0) != columns
        or not item.get("pixel_spacing")
        or not close(item["pixel_spacing"], spacing)
        or not item.get("orientation")
        or not close(item["orientation"], orientation)
        or not item.get("position")
        for item in items
    ):
        return None

    frame_uids = {str(item.get("frame_uid") or "") for item in items if item.get("frame_uid")}
    study_uids = {str(item.get("study_uid") or "") for item in items if item.get("study_uid")}
    if len(frame_uids) > 1 or len(study_uids) > 1:
        return None
    frame_uid = next(iter(frame_uids), "")
    study_uid = next(iter(study_uids), "")
    series_uid = str(first.get("series_uid") or "")

    positioned = sorted(
        (
            (
                sum(a * b for a, b in zip(item["position"], normal)),
                item,
            )
            for item in items
        ),
        key=lambda pair: pair[0],
    )
    distances = [float(distance) for distance, _item in positioned]
    if any(abs(b - a) < 1e-4 for a, b in zip(distances, distances[1:])):
        return None
    gaps = [abs(b - a) for a, b in zip(distances, distances[1:])]
    slice_spacing = sorted(gaps)[len(gaps) // 2] if gaps else 0.0
    if not math.isfinite(slice_spacing) or slice_spacing <= 0:
        return None

    return {
        "frame_of_reference_uid": frame_uid or study_uid or series_uid,
        "frame_of_reference_synthetic": not bool(frame_uid),
        "rows": rows,
        "columns": columns,
        "slice_count": len(positioned),
        "pixel_spacing": list(spacing),
        "slice_spacing": float(slice_spacing),
        "image_orientation_patient": list(orientation),
        "ordered_slices": [
            {
                "file": item["file"],
                "position": list(item["position"]),
                "distance": float(distance),
                "sop_instance_uid": str(item.get("sop_instance_uid") or ""),
            }
            for distance, item in positioned
        ],
    }


def convert_all(
    dicom_dir: Path,
    jpg_dir: Path,
    log: LogFn = _default_log,
    quality: int = 100,
    save_png: bool = False,
    contrast_mode: str = CLINICAL,
    should_stop: Optional[Callable[[], bool]] = None,
    metadata: Optional[dict] = None,
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
    generic_manifests: dict[Path, dict] = {}
    generic_outputs: dict[Path, list[str]] = {}
    generic_geometry: dict[Path, list[dict]] = {}
    namer = mpr_engine.SeriesFolderNamer(jpg_dir)

    # Keep every eligible T1 3D series (post-contrast and pre-contrast).  The
    # namer keeps the folder names readable and only falls back to a
    # SeriesInstanceUID token when two series would otherwise collide.
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
        candidate_folder = namer.name_for_candidate(candidate)
        try:
            count, _ = mpr_engine.convert_mpr_candidate(
                candidate,
                jpg_dir,
                quality=100,
                log=log,
                should_stop=should_stop,
                folder_name=candidate_folder,
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
                folder = jpg_dir / candidate_folder
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
            valid, reason = _is_dicom_dataset_valid_for_decode(ds)
            if not valid:
                stats.skipped += 1
                log(f"  [Bỏ qua file hỏng] {path.name}: {reason}")
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

            series_folder = jpg_dir / namer.name_for(
                series_number, series_desc, series_uid,
            )
            series_folder.mkdir(exist_ok=True)

            manifest_path = series_folder / "mpr-volume.json"
            if manifest_path not in generic_manifests:
                try:
                    from mpr_engine import _format_date, _format_time
                except ImportError:
                    def _format_date(d: str) -> str:
                        if d and len(d) == 8 and d.isdigit(): return f"{d[:4]}-{d[4:6]}-{d[6:]}"
                        return d
                    def _format_time(t: str) -> str:
                        if t and len(t) >= 6 and t[:6].isdigit(): return f"{t[:2]}:{t[2:4]}:{t[4:6]}"
                        return t

                study_date = _format_date(str(getattr(ds, "StudyDate", "") or "").strip())
                study_time = _format_time(str(getattr(ds, "StudyTime", "") or "").strip())
                patient_birth = _format_date(str(getattr(ds, "PatientBirthDate", "") or "").strip())

                p_name = str(getattr(ds, "PatientName", "") or "").strip()
                p_id = str(getattr(ds, "PatientID", "") or "").strip()
                p_birth = patient_birth
                if metadata:
                    meta_name = str(metadata.get("PatientName") or "").strip()
                    meta_id = str(metadata.get("PatientID") or "").strip()
                    meta_dob = str(metadata.get("PatientBirthDate") or "").strip()
                    if _is_redacted_patient_value(p_name) and not _is_redacted_patient_value(meta_name):
                        p_name = meta_name
                    if _is_redacted_patient_value(p_id) and not _is_redacted_patient_value(meta_id):
                        p_id = meta_id
                    if not p_birth and meta_dob:
                        p_birth = _format_date(meta_dob)

                generic_manifests[manifest_path] = {
                    "format": "dcom-mpr-jpg",
                    "version": 1,
                    "series_type": "JPG_GENERIC",
                    "series_description": str(getattr(ds, "SeriesDescription", "") or "").strip(),
                    "modality": str(getattr(ds, "Modality", "") or "").strip(),
                    "series_number": str(getattr(ds, "SeriesNumber", "") or "").strip(),
                    "study_instance_uid": str(getattr(ds, "StudyInstanceUID", "") or "").strip(),
                    "study_date": study_date,
                    "study_time": study_time,
                    "patient_id": p_id,
                    "patient_name": p_name,
                    "patient_birth_date": p_birth,
                    "patient_sex": str(getattr(ds, "PatientSex", "") or "").strip().upper(),
                    "patient_age": str(getattr(ds, "PatientAge", "") or "").strip().upper(),
                    "series_instance_uid": series_uid,
                }
                generic_outputs[manifest_path] = []
                generic_geometry[manifest_path] = []

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

                filename = f"{base}.jpg"
                img.save(series_folder / filename, "JPEG",
                         quality=quality, optimize=True, subsampling=0)
                if save_png:
                    img.save(series_folder / f"{base}.png", "PNG", optimize=True)

                stats.converted += 1
                generic_outputs[manifest_path].append(filename)
                if not multi:
                    generic_geometry[manifest_path].append({
                        "file": filename,
                        "rows": int(getattr(ds, "Rows", 0) or 0),
                        "columns": int(getattr(ds, "Columns", 0) or 0),
                        "pixel_spacing": _finite_dicom_values(
                            getattr(ds, "PixelSpacing", None), 2,
                        ),
                        "orientation": _finite_dicom_values(
                            getattr(ds, "ImageOrientationPatient", None), 6,
                        ),
                        "position": _finite_dicom_values(
                            getattr(ds, "ImagePositionPatient", None), 3,
                        ),
                        "frame_uid": str(getattr(ds, "FrameOfReferenceUID", "") or "").strip(),
                        "study_uid": str(getattr(ds, "StudyInstanceUID", "") or "").strip(),
                        "series_uid": series_uid,
                        "sop_instance_uid": str(getattr(ds, "SOPInstanceUID", "") or "").strip(),
                    })

            if stats.converted % 50 == 0:
                log(f"  ...đã chuyển {stats.converted} ảnh")
        except Exception as e:
            stats.failed += 1
            log(f"  Lỗi file {path.name}: {e}")

    for manifest_path, manifest_data in generic_manifests.items():
        outputs = generic_outputs.get(manifest_path, [])
        geometry_items = generic_geometry.get(manifest_path, [])
        if len(outputs) == len(set(outputs)) == len(geometry_items):
            spatial = _generic_jpg_spatial_geometry(geometry_items)
            if spatial:
                manifest_data.update(spatial)
        temporary = manifest_path.with_suffix(".json.tmp")
        temporary.write_text(
            json.dumps(manifest_data, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        temporary.replace(manifest_path)

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


def extract_patient_metadata_bytes(data: bytes, manual_info: Optional[dict] = None) -> dict:
    """Read naming demographics from one in-memory DICOM before writing it."""
    try:
        import pydicom
        ds = pydicom.dcmread(
            io.BytesIO(data),
            stop_before_pixels=True,
            force=True,
            specific_tags=[
                "PatientName", "PatientID", "PatientAge", "PatientBirthDate",
                "PatientSex", "StudyDate", "StudyInstanceUID", "StudyDescription",
                "Modality",
            ],
        )
    except Exception:
        return {}
    raw_name = str(getattr(ds, "PatientName", "") or "").strip()
    raw_id = str(getattr(ds, "PatientID", "") or "").strip()
    raw_birth = str(getattr(ds, "PatientBirthDate", "") or "").strip()
    raw_age = str(getattr(ds, "PatientAge", "") or "").strip()
    study_date = _normalise_dicom_date(getattr(ds, "StudyDate", ""))
    birth_date = (
        "" if _is_redacted_patient_value(raw_birth)
        else _normalise_dicom_date(raw_birth)
    )

    if manual_info:
        if _is_redacted_patient_value(raw_name):
            raw_name = str(manual_info.get("patientName") or raw_name).strip()
        if _is_redacted_patient_value(raw_id):
            raw_id = str(manual_info.get("patientId") or raw_id).strip()
        if not birth_date:
            manual_dob = str(manual_info.get("patientDob") or "").strip()
            if manual_dob:
                birth_date = _normalise_manual_birth_date(manual_dob)

    age, age_years, age_source = _normalise_patient_age(
        raw_age, birth_date, study_date,
    )
    return {
        "PatientID": "KHONG_RO_ID" if _is_redacted_patient_value(raw_id) else raw_id,
        "PatientName": _patient_display_name(raw_name) or "KHONG_RO_TEN",
        "PatientNameRaw": raw_name,
        "PatientBirthDate": birth_date,
        "PatientSex": str(getattr(ds, "PatientSex", "") or "").strip().upper(),
        "PatientAge": age,
        "PatientAgeRaw": raw_age,
        "PatientAgeYears": age_years,
        "PatientAgeSource": age_source,
        "StudyDate": study_date,
        "StudyInstanceUID": str(getattr(ds, "StudyInstanceUID", "") or "").strip(),
        "StudyDescription": str(getattr(ds, "StudyDescription", "") or "").strip(),
        "Modality": str(getattr(ds, "Modality", "") or "").strip().upper(),
    }


def extract_patient_metadata(dicom_dir: Path, manual_info: Optional[dict] = None) -> dict:
    """Read one patient's demographics and study context from local DICOM."""
    try:
        import pydicom
    except Exception:
        return {}

    values = {
        "name": "", "pid": "", "raw_age": "", "birth": "", "sex": "",
        "study_date": "", "study_uid": "", "study_desc": "", "modality": "",
    }
    seen_ids: set[str] = set()
    seen_names: set[str] = set()
    seen_birth_dates: set[str] = set()
    seen_sexes: set[str] = set()
    for p in discover_dicom_files(Path(dicom_dir))[:80]:
        try:
            ds = pydicom.dcmread(
                str(p),
                stop_before_pixels=True,
                force=True,
                specific_tags=[
                    "PatientName", "PatientID", "PatientAge", "PatientBirthDate",
                    "PatientSex", "StudyDate", "StudyInstanceUID", "StudyDescription",
                    "Modality",
                ],
            )
            raw_name = str(getattr(ds, "PatientName", "") or "").strip()
            raw_pid = str(getattr(ds, "PatientID", "") or "").strip()
            name = "" if _is_redacted_patient_value(raw_name) else raw_name
            pid = "" if _is_redacted_patient_value(raw_pid) else raw_pid
            if pid:
                seen_ids.add(_identity_token(pid))
            if name:
                seen_names.add(_identity_token(name))
            raw_birth = str(getattr(ds, "PatientBirthDate", "") or "").strip()
            if _is_redacted_patient_value(raw_birth):
                raw_birth = ""
            raw_sex = str(getattr(ds, "PatientSex", "") or "").strip().upper()
            normalised_birth = _normalise_dicom_date(raw_birth)
            if normalised_birth:
                seen_birth_dates.add(normalised_birth)
            if raw_sex:
                seen_sexes.add(raw_sex)
            # Ngày sinh lệch ngày/tháng trong cùng MỘT NĂM là chuyện thường: RIS
            # chỉ biết năm thì phát ra YYYY-01-01, còn DICOM có ngày đầy đủ. Lệch
            # NĂM sinh thì vẫn là hai người khác nhau.
            # Giới tính 'O' (Other) là giá trị "không rõ" của DICOM, không tính
            # là mâu thuẫn.
            if (
                len(seen_ids) > 1
                or len(seen_names) > 1
                or len({d[:4] for d in seen_birth_dates}) > 1
                or len(seen_sexes - {"O"}) > 1
            ):
                raise PatientIdentityConflictError(
                    "DICOM trong cùng folder chứa nhiều định danh bệnh nhân khác nhau."
                )
            candidates = {
                "name": name,
                "pid": pid,
                "raw_age": str(getattr(ds, "PatientAge", "") or "").strip(),
                "birth": raw_birth,
                "sex": raw_sex,
                "study_date": str(getattr(ds, "StudyDate", "") or "").strip(),
                "study_uid": str(getattr(ds, "StudyInstanceUID", "") or "").strip(),
                "study_desc": str(getattr(ds, "StudyDescription", "") or "").strip(),
                "modality": str(getattr(ds, "Modality", "") or "").strip().upper(),
            }
            for key, value in candidates.items():
                if value and not values[key]:
                    values[key] = value
        except PatientIdentityConflictError:
            raise
        except Exception:
            continue
    if not any(values.values()):
        return {}

    birth_date = _normalise_dicom_date(values["birth"])
    study_date = _normalise_dicom_date(values["study_date"])

    if manual_info:
        if _is_redacted_patient_value(values["name"]):
            values["name"] = str(manual_info.get("patientName") or values["name"]).strip()
        if _is_redacted_patient_value(values["pid"]):
            values["pid"] = str(manual_info.get("patientId") or values["pid"]).strip()
        if not birth_date:
            manual_dob = str(manual_info.get("patientDob") or "").strip()
            if manual_dob:
                birth_date = _normalise_manual_birth_date(manual_dob)

    age, age_years, age_source = _normalise_patient_age(
        values["raw_age"], birth_date, study_date,
    )
    raw_name = values["name"]
    return {
        "PatientID": values["pid"] or "KHONG_RO_ID",
        "PatientName": _patient_display_name(raw_name) or "KHONG_RO_TEN",
        "PatientNameRaw": raw_name,
        "PatientBirthDate": birth_date,
        "PatientSex": values["sex"],
        "PatientAge": age,
        "PatientAgeRaw": values["raw_age"],
        "PatientAgeYears": age_years,
        "PatientAgeSource": age_source,
        "StudyDate": study_date,
        "StudyInstanceUID": values["study_uid"],
        "StudyDescription": values["study_desc"],
        "Modality": values["modality"],
    }


def patient_download_folder_name(metadata: dict, download_date: str = "") -> str:
    """Build `<name> - <age> - <patient id> - <download date>` safely."""
    name = _safe_name(_patient_display_name(metadata.get("PatientName")) or "KHONG_RO_TEN")[:40]
    raw_id = metadata.get("PatientID")
    patient_id = _safe_name(
        "KHONG_RO_ID" if _is_redacted_patient_value(raw_id) else raw_id
    )
    date = _normalise_dicom_date(download_date) or datetime.now().strftime("%Y-%m-%d")
    current_age, _current_age_years = _age_from_dates(
        _normalise_dicom_date(metadata.get("PatientBirthDate")),
        date,
    )
    age = _safe_name(current_age or metadata.get("PatientAge") or "KHONG_RO_TUOI")
    return f"{name} - {age} - {patient_id} - {date}"


def _merge_manifest_demographics(manifest: dict, metadata: dict) -> None:
    mappings = {
        "patientBirthDate": "PatientBirthDate",
        "patientSex": "PatientSex",
        "dicomPatientName": "PatientNameRaw",
    }
    for target, source in mappings.items():
        incoming = metadata.get(source)
        if incoming:
            current = manifest.get(target)
            if not current:
                manifest[target] = incoming
            elif target == "patientBirthDate":
                # CHỈ nâng cấp ngày sinh ước lượng (RIS biết mỗi năm sinh nên
                # phát ra YYYY-01-01) lên ngày sinh đầy đủ của DICOM TRONG CÙNG
                # NĂM. Không bao giờ sửa NĂM sinh và không ghi đè ngày đã chính
                # xác — hai việc đó là đổi định danh bệnh nhân, không phải làm
                # rõ thêm.
                cur_norm = _normalise_dicom_date(str(current))
                inc_norm = _normalise_dicom_date(str(incoming))
                if (
                    cur_norm and inc_norm and cur_norm != inc_norm
                    and cur_norm.endswith("-01-01")
                    and not inc_norm.endswith("-01-01")
                    and cur_norm[:4] == inc_norm[:4]
                ):
                    manifest[target] = inc_norm
    canonical_name = _patient_display_name(metadata.get("PatientName"))
    if canonical_name and canonical_name != "KHONG_RO_TEN" and not manifest.get("patientName"):
        manifest["patientName"] = canonical_name


def _patient_manifest_naming_metadata(manifest: dict) -> dict:
    """Recover the best patient-folder identity already persisted in an archive."""
    if not manifest:
        return {}
    studies = [
        entry for entry in (manifest.get("studies") or {}).values()
        if isinstance(entry, dict)
    ]
    studies.sort(key=lambda entry: str(entry.get("date") or ""), reverse=True)
    age = next(
        (
            str(entry.get("patientAgeAtStudy") or "").strip()
            for entry in studies
            if str(entry.get("patientAgeAtStudy") or "").strip()
        ),
        "",
    )
    metadata = {
        "PatientID": manifest.get("patientId") or "",
        "PatientName": manifest.get("patientName") or "",
        "PatientBirthDate": manifest.get("patientBirthDate") or "",
        "PatientSex": manifest.get("patientSex") or "",
        "PatientAge": age,
    }
    if (
        _patient_display_name(metadata["PatientName"])
        and _patient_display_name(metadata["PatientName"]) != "KHONG_RO_TEN"
        and (metadata["PatientBirthDate"] or metadata["PatientAge"])
    ):
        return metadata
    return {}


def _assert_patient_metadata_matches(
    expected_id: str,
    expected_name: str,
    metadata: dict,
    expected_birth_date: str = "",
    expected_sex: str = "",
) -> None:
    actual_id = str(metadata.get("PatientID") or "")
    actual_name = str(metadata.get("PatientName") or "")
    if actual_id and actual_id != "KHONG_RO_ID" and expected_id:
        if _identity_token(actual_id) != _identity_token(expected_id):
            raise PatientIdentityConflictError(
                f"PatientID DICOM '{actual_id}' không khớp mã RIS '{expected_id}'."
            )
    if actual_name and actual_name != "KHONG_RO_TEN" and expected_name:
        if _patient_name_conflicts(actual_name, expected_name):
            raise PatientIdentityConflictError(
                f"PatientName DICOM '{actual_name}' không khớp tên RIS '{expected_name}'."
            )
    actual_birth_date = _normalise_dicom_date(metadata.get("PatientBirthDate"))
    expected_birth_date = _normalise_dicom_date(expected_birth_date)
    if actual_birth_date and expected_birth_date and actual_birth_date != expected_birth_date:
        # Hồ sơ RIS chỉ biết năm sinh thì ghi YYYY-01-01, còn DICOM có ngày đầy
        # đủ — lệch kiểu đó KHÔNG phải hai người khác nhau. Nhưng lệch NĂM sinh
        # thì vẫn phải chặn, kể cả khi một bên là 01-01: đó mới là dấu hiệu ảnh
        # của bệnh nhân khác đang rơi vào hồ sơ này.
        placeholder_gap = (
            actual_birth_date[:4] == expected_birth_date[:4]
            and (
                expected_birth_date.endswith("-01-01")
                or actual_birth_date.endswith("-01-01")
            )
        )
        if not placeholder_gap:
            raise PatientIdentityConflictError(
                f"Ngày sinh DICOM '{actual_birth_date}' không khớp hồ sơ '{expected_birth_date}'."
            )
    actual_sex = str(metadata.get("PatientSex") or "").strip().upper()
    expected_sex = str(expected_sex or "").strip().upper()
    if actual_sex and expected_sex and actual_sex != expected_sex:
        raise PatientIdentityConflictError(
            f"Giới DICOM '{actual_sex}' không khớp hồ sơ '{expected_sex}'."
        )


def rename_patient_download_root(
    download_root: Path,
    jpg_dir: Path,
    metadata: dict,
    *,
    log: LogFn = _default_log,
    download_date: str = "",
    allow_collision_suffix: bool = True,
) -> tuple[Path, Path]:
    """Rename one direct/CLI download root and remap its JPG path."""
    root = Path(download_root)
    jpg = Path(jpg_dir)
    if not root.exists() or not metadata:
        return root, jpg
    desired_name = patient_download_folder_name(metadata, download_date)
    if root.name == desired_name or root.name.startswith(f"{desired_name} ("):
        return root, jpg
    try:
        jpg_relative = jpg.relative_to(root)
    except ValueError:
        jpg_relative = Path(jpg.name)
    target = root.with_name(desired_name)
    if target.exists() and target != root and not allow_collision_suffix:
        log(f"Không thể đổi tên thư mục: đích đã tồn tại ({target.name}).")
        return root, jpg
    counter = 2
    while target.exists() and target != root:
        target = root.with_name(f"{desired_name} ({counter})")
        counter += 1
    last_error: Optional[OSError] = None
    for attempt in range(6):
        try:
            root.rename(target)
            last_error = None
            break
        except OSError as exc:
            last_error = exc
            if getattr(exc, "winerror", None) not in {5, 32} or attempt == 5:
                break
            # Windows Defender/indexing and image readers can briefly retain a
            # directory handle after conversion. Give those handles time to close.
            import gc
            gc.collect()
            time.sleep(0.15 * (attempt + 1))
    if last_error is not None:
        log(f"Không thể đổi tên thư mục: {last_error}")
        return root, jpg
    return target, target / jpg_relative


def write_direct_patient_manifest(
    download_root: Path,
    jpg_dir: Path,
    metadata: dict,
    *,
    image_count: int,
    complete: bool,
) -> None:
    """Persist demographics for direct/CLI downloads, not only RIS archives."""
    root = Path(download_root)
    now = _now_local()
    manifest = _read_patient_manifest(root)
    if manifest:
        _assert_patient_metadata_matches(
            str(manifest.get("patientId") or ""),
            str(manifest.get("patientName") or ""),
            metadata,
            str(manifest.get("patientBirthDate") or ""),
            str(manifest.get("patientSex") or ""),
        )
    else:
        manifest = {
            "format": PATIENT_MANIFEST_FORMAT,
            "patientId": metadata.get("PatientID") or "",
            "patientName": metadata.get("PatientName") or "",
            "hospitalKey": "direct",
            "hospitalName": "",
            "createdAt": now,
            "updatedAt": now,
            "studies": {},
        }
    _merge_manifest_demographics(manifest, metadata)
    uid = str(metadata.get("StudyInstanceUID") or "").strip()
    if uid:
        previous = manifest["studies"].get(uid) or {}
        try:
            relative = str(Path(jpg_dir).relative_to(root))
        except ValueError:
            relative = Path(jpg_dir).name
        manifest["studies"][uid] = {
            **previous,
            "studyUid": uid,
            "date": metadata.get("StudyDate") or "",
            "modality": metadata.get("Modality") or "",
            "description": metadata.get("StudyDescription") or "",
            "folder": relative,
            "status": (
                "complete"
                if complete or previous.get("status") == "complete"
                else "incomplete"
            ),
            "imageCount": max(int(image_count or 0), int(previous.get("imageCount") or 0)),
            "downloadedAt": now if complete else previous.get("downloadedAt", ""),
            "selectedSeries": previous.get("selectedSeries") or [],
            "patientAgeRaw": metadata.get("PatientAgeRaw") or "",
            "patientAgeAtStudy": metadata.get("PatientAge") or "",
            "patientAgeAtStudyYears": metadata.get("PatientAgeYears"),
            "patientAgeSource": metadata.get("PatientAgeSource") or "",
            "patientBirthDate": metadata.get("PatientBirthDate") or "",
            "patientSex": metadata.get("PatientSex") or "",
        }
    manifest["updatedAt"] = now
    _write_patient_manifest(root, manifest)


def _jpg_folder_name(dicom_dir: Path) -> str:
    """
    Tính tên thư mục JPG theo header DICOM: '<ngày chụp> - <Loại phim> - <Mô tả ca chụp>'.
    """
    try:
        import pydicom
    except Exception:
        return "JPG"

    date = desc = modality = ""
    for p in discover_dicom_files(Path(dicom_dir))[:40]:
        try:
            ds = pydicom.dcmread(str(p), stop_before_pixels=True, force=True)
            date = date or str(getattr(ds, "StudyDate", "") or "")
            desc = desc or str(getattr(ds, "StudyDescription", "") or "")
            modality = modality or str(getattr(ds, "Modality", "") or "")
            if date and desc and modality:
                break
        except Exception:
            pass

    parts = []
    if len(date) == 8 and date.isdigit():
        parts.append(f"{date[:4]}-{date[4:6]}-{date[6:8]}")
    elif date:
        parts.append(_safe_name(date))
    else:
        parts.append("KHONG_RO_NGAY")

    if modality:
        parts.append(_safe_name(modality))
    else:
        parts.append("UNKNOWN")

    if desc:
        parts.append(_safe_name(desc)[:40])
    else:
        parts.append("KHONG_RO_MO_TA")

    name = " - ".join(parts).strip()
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
    selected_series_ids: Optional[list[str]] = None,
    rename_patient_root: bool = True,
    jpg_folder_name_override: Optional[str] = None,
    after_dicom_download: Optional[Callable[[Path, dict], Path]] = None,
    after_first_dicom: Optional[Callable[[Path, dict], Path]] = None,
    manual_info: Optional[dict] = None,
):
    out_base = Path(out_base)
    dicom_dir = out_base / "DICOM"
    jpg_dir = out_base / "JPG"
    first_metadata: dict = {}
    original_out_base = out_base
    link_match = re.match(r"^LINK_(\d{4})(\d{2})(\d{2})_", out_base.name)
    original_date = (
        f"{link_match.group(1)}-{link_match.group(2)}-{link_match.group(3)}"
        if link_match else ""
    )

    def resolve_first_dicom(data: bytes) -> Path:
        nonlocal out_base, dicom_dir, first_metadata
        first_metadata = extract_patient_metadata_bytes(data, manual_info=manual_info)
        if after_first_dicom is not None and first_metadata:
            out_base = Path(after_first_dicom(out_base, first_metadata))
        elif rename_patient_root and first_metadata:
            desired_name = patient_download_folder_name(first_metadata, original_date)
            target = original_out_base.with_name(desired_name)
            counter = 2
            while target.exists() and target != original_out_base:
                target = original_out_base.with_name(f"{desired_name} ({counter})")
                counter += 1
            out_base = target
            if out_base != original_out_base:
                log(f"Đã xác định tên hồ sơ từ DICOM đầu tiên: {out_base.name}")
        dicom_dir = out_base / "DICOM"
        return dicom_dir

    first_dicom_resolver = (
        resolve_first_dicom
        if not resume and (rename_patient_root or after_first_dicom is not None)
        else None
    )

    log("=" * 60)
    log("BƯỚC 1/2: Tải ảnh từ viewer" + (" (THỬ LẠI — gộp vào folder cũ)" if resume else ""))
    dl = download_all(url, dicom_dir, log=log, headless=headless,
                      should_stop=should_stop, resume=resume,
                      selected_series_ids=selected_series_ids,
                      dicom_output_resolver=first_dicom_resolver)
    dicom_dir = out_base / "DICOM"
    jpg_dir = out_base / "JPG"
    if should_stop and should_stop():
        return dl, None, jpg_dir
    if dl.dicom == 0 and dl.jpg == 0:
        log("Không tải được ảnh nào. Kiểm tra lại link (còn hạn không) và thử tắt chế độ ẩn trình duyệt.")
        return dl, None, jpg_dir

    summarize_dicom(dicom_dir, log=log)

    metadata = (
        extract_patient_metadata(dicom_dir, manual_info=manual_info) or first_metadata
        if rename_patient_root or after_dicom_download is not None
        else {}
    )
    if metadata and after_dicom_download is not None:
        out_base = Path(after_dicom_download(out_base, metadata))
        dicom_dir = out_base / "DICOM"

    # Thư mục JPG: '<ngày chụp> - <loại phim> - <mô tả ca chụp>'.
    jpg_name = jpg_folder_name_override or _jpg_folder_name(dicom_dir)
    jpg_dir = out_base / jpg_name

    if metadata and rename_patient_root:
        current_link_match = re.match(r"^LINK_(\d{4})(\d{2})(\d{2})_", out_base.name)
        should_rename = not resume or bool(current_link_match)
        if should_rename:
            out_base, jpg_dir = rename_patient_download_root(
                out_base,
                jpg_dir,
                metadata,
                log=log,
                download_date=original_date,
            )
            dicom_dir = out_base / "DICOM"

    log("=" * 60)
    log("BƯỚC 2/2: Chuyển DICOM -> JPG chất lượng cao")
    cv = convert_all(dicom_dir, jpg_dir, log=log, quality=quality,
                     save_png=save_png, contrast_mode=contrast_mode,
                     should_stop=should_stop, metadata=metadata)
    if metadata and rename_patient_root:
        write_direct_patient_manifest(
            out_base,
            jpg_dir,
            metadata,
            image_count=dl.total(),
            complete=dl.is_complete(),
        )
    log("=" * 60)
    log(f"HOÀN TẤT. Ảnh JPG nằm ở: {jpg_dir}")
    return dl, cv, jpg_dir


# --------------------------------------------------------------------------- #
#  BƯỚC 3: TỰ ĐỘNG TÌM KIẾM THEO MÃ BỆNH NHÂN TRÊN RIS (VIỆT ĐỨC & ĐẠI HỌC Y)
# --------------------------------------------------------------------------- #

def _dec_cred(s: str, key: int = 0x57) -> str:
    """Giải mã thông tin tài khoản/mật khẩu an toàn (thời gian giải mã < 0.001ms, không ảnh hưởng tốc độ)."""
    return bytes([b ^ key for b in base64.b64decode(s)]).decode("utf-8")


# `base_urls` xếp theo THỨ TỰ ƯU TIÊN: đường đầu tiên còn kết nối được sẽ được
# dùng. Đặt địa chỉ LAN trong viện lên trước vì đi thẳng trong mạng nội bộ,
# nhanh hơn và không phụ thuộc đường ra Internet; ngoài viện thì địa chỉ đó
# không tới được nên tự động rơi xuống đường công cộng. Cùng một tài khoản.
# Bệnh viện đứng đầu dict là bệnh viện được chọn sẵn trên giao diện.
HOSPITALS = {
    "dhy": {
        "name": "BV Đại học Y Hà Nội",
        "base_urls": ["http://192.168.50.105", "https://dhy.cdhaviet.vn"],
        "username_enc": "NSQ1Ij4kODk=",
        "password_enc": "Ez8uF2ZlZGI=",
        "is_default": True,
    },
    "vduh": {
        "name": "BV Việt Đức",
        "base_urls": ["https://rad.vduh.org"],
        "username_enc": "NSQ7JA==",
        "password_enc": "FSEhPjIjMyI0F2Vj",
    },
}

_RIS_LOGIN_PATH = "/ris/account/login"
# Nhớ kết quả dò đường trong thời gian ngắn để không phải dò lại cho từng ca,
# nhưng vẫn đủ ngắn để vừa cắm VPN/mạng viện là nhận ra ngay.
_ENDPOINT_PROBE_TTL_SECONDS = 60
_ENDPOINT_PROBE_LOCK = threading.Lock()
_ENDPOINT_PROBE_CACHE: dict[str, tuple[float, bool]] = {}


def _hospital_base_urls(info: dict) -> list[str]:
    urls = info.get("base_urls") or ([info["base_url"]] if info.get("base_url") else [])
    return [str(u).rstrip("/") for u in urls if u]


def _ris_login_url(base_url: str) -> str:
    return f"{str(base_url).rstrip('/')}{_RIS_LOGIN_PATH}"


def _endpoint_is_reachable(base_url: str, timeout: float = 1.5) -> bool:
    """Bắt tay TCP thử với máy chủ. Nhanh và dứt khoát hơn là chờ trình duyệt."""
    import socket
    from urllib.parse import urlparse

    parsed = urlparse(base_url)
    host = parsed.hostname
    if not host:
        return False
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    now = time.monotonic()
    cache_key = f"{host}:{port}"
    with _ENDPOINT_PROBE_LOCK:
        hit = _ENDPOINT_PROBE_CACHE.get(cache_key)
        if hit and now - hit[0] <= _ENDPOINT_PROBE_TTL_SECONDS:
            return hit[1]
    try:
        socket.create_connection((host, port), timeout=timeout).close()
        ok = True
    except Exception:
        ok = False
    with _ENDPOINT_PROBE_LOCK:
        _ENDPOINT_PROBE_CACHE[cache_key] = (time.monotonic(), ok)
    return ok


def _pick_hospital_base_url(info: dict, log: LogFn = _default_log) -> str:
    """Chọn đường vào PACS theo thứ tự ưu tiên trong `base_urls`.

    Đường cuối luôn được trả về khi không đường nào tới được, để thông báo lỗi
    sau đó nói đúng địa chỉ công cộng mà người dùng có thể tự mở thử.
    """
    endpoints = _hospital_base_urls(info)
    if not endpoints:
        raise RuntimeError(f"Bệnh viện '{info.get('name')}' chưa khai báo địa chỉ PACS.")
    for index, base_url in enumerate(endpoints[:-1]):
        if _endpoint_is_reachable(base_url):
            if index or len(endpoints) > 1:
                log(f"Dùng đường mạng nội bộ của viện: {base_url}")
            return base_url
        log(
            f"Đường nội bộ {base_url} không khả dụng; "
            "tự chuyển sang cổng PACS công cộng."
        )
    return endpoints[-1]


_RIS_SESSION_TTL_SECONDS = 30 * 60
_RIS_SESSION_LOCK = threading.Lock()
_RIS_SESSION_STATES: dict[str, dict] = {}


def _ris_session_key(hospital_key: str, base_url: str = "", account: str = "") -> str:
    """Khóa phiên gắn với ĐÚNG địa chỉ và ĐÚNG tài khoản đã đăng nhập.

    Một bệnh viện có thể vào bằng địa chỉ LAN hoặc địa chỉ công cộng; cookie của
    host này không dùng được cho host kia, nên phải giữ riêng từng phiên.

    `account` là vân tay của cặp user/mật khẩu (xem `_ris_credentials`). Nhờ nó,
    đổi sang tài khoản tự nhập là tự trượt cache — không phải xóa phiên bằng
    tay, nên N ca tải liên tiếp vẫn dùng chung một lần đăng nhập.
    """
    return (
        f"{str(hospital_key or '').lower()}"
        f"|{str(base_url or '').rstrip('/').lower()}"
        f"|{account or ''}"
    )


def _ris_credentials(
    info: dict,
    custom_username: Optional[str] = None,
    custom_password: Optional[str] = None,
) -> tuple[str, str, str]:
    """Chọn tài khoản đăng nhập RIS, kèm vân tay dùng làm khóa phiên.

    Vân tay là băm của cặp user/mật khẩu — đủ để tách phiên của hai tài khoản
    khác nhau mà không giữ mật khẩu ở dạng đọc được trong khóa cache.
    """
    if custom_username and custom_password:
        username, password = custom_username, custom_password
    else:
        username = _dec_cred(info["username_enc"]) if "username_enc" in info else info.get("username", "")
        password = _dec_cred(info["password_enc"]) if "password_enc" in info else info.get("password", "")
    token = hashlib.sha1(f"{username}\x00{password}".encode("utf-8")).hexdigest()[:12]
    return username, password, token


def clear_ris_session_cache(
    hospital_key: Optional[str] = None, account: str = "",
) -> None:
    """Xóa phiên RIS trong RAM; cookie/token không bao giờ được ghi xuống ổ đĩa.

    Có `account` thì chỉ xóa phiên của đúng tài khoản đó — phiên của tài khoản
    còn lại ở cùng bệnh viện vẫn dùng được.
    """
    global _CHROME_UNAVAILABLE
    with _RIS_SESSION_LOCK:
        if hospital_key is None:
            _RIS_SESSION_STATES.clear()
            with _BROWSER_STATE_LOCK:
                _CHROME_UNAVAILABLE = False
                _BROWSER_NOTICES_LOGGED.clear()
            return
        prefix = f"{hospital_key.lower()}|"
        suffix = f"|{account}" if account else ""
        for key in [
            k for k in _RIS_SESSION_STATES
            if k.startswith(prefix) and (not suffix or k.endswith(suffix))
        ]:
            _RIS_SESSION_STATES.pop(key, None)


def _get_ris_session_state(
    hospital_key: str, base_url: str = "", account: str = "",
) -> Optional[dict]:
    key = _ris_session_key(hospital_key, base_url, account)
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


def _store_ris_session_state(
    hospital_key: str, storage_state: dict, base_url: str = "", account: str = "",
) -> None:
    with _RIS_SESSION_LOCK:
        _RIS_SESSION_STATES[_ris_session_key(hospital_key, base_url, account)] = {
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


_RIS_WRAPPER_RE = re.compile(r"/ris/vr_?viewer", re.I)
# Các trang "vỏ" của RIS (đăng nhập, danh sách đọc...). Chúng KHÔNG chứa ảnh;
# nếu đăng nhập lại giữa chừng thì page.url rất dễ đang đứng ở đây.
_RIS_SHELL_RE = re.compile(r"/ris/(account|study|home|dashboard)(/|$|\?)", re.I)


_NET_UNREACHABLE_MARKERS = (
    "ERR_CONNECTION_TIMED_OUT", "ERR_CONNECTION_REFUSED", "ERR_CONNECTION_RESET",
    "ERR_NAME_NOT_RESOLVED", "ERR_INTERNET_DISCONNECTED", "ERR_ADDRESS_UNREACHABLE",
    "ERR_NETWORK_CHANGED", "ERR_PROXY_CONNECTION_FAILED",
)


def _server_unreachable_message(exc: Exception, hospital_name: str, base_url: str) -> Optional[str]:
    """Đổi lỗi mạng thô của trình duyệt thành câu người dùng hiểu được.

    Máy chủ PACS chỉ mở trong mạng nội bộ/VPN bệnh viện, nên mất kết nối là
    chuyện thường gặp. Nếu để nguyên 'net::ERR_CONNECTION_TIMED_OUT' thì rất dễ
    bị hiểu nhầm thành 'app hỏng' hoặc 'sai mã bệnh nhân'.
    """
    text = str(exc or "")
    if not any(marker in text for marker in _NET_UNREACHABLE_MARKERS):
        return None
    return (
        f"❌ KHÔNG KẾT NỐI ĐƯỢC tới máy chủ PACS {hospital_name} ({base_url}).\n"
        f"   Đây KHÔNG phải lỗi mã bệnh nhân và cũng không phải lỗi ứng dụng.\n"
        f"   Thường do: chưa vào mạng nội bộ / VPN của bệnh viện, hoặc PACS đang "
        f"bảo trì. Kiểm tra bằng cách mở {base_url} trên trình duyệt: nếu trình "
        f"duyệt cũng không vào được thì phải xử lý mạng trước."
    )


def _is_ris_wrapper_url(url: str) -> bool:
    """Link 'vrViewer' của RIS — chỉ mở được khi trình duyệt CÒN cookie đăng nhập.

    Trình tải luôn chạy trên context trắng (không cookie), nên đưa link này cho
    nó là cầm chắc rơi vào trang login rồi ra 0–vài ảnh mà không ai biết.
    """
    return bool(_RIS_WRAPPER_RE.search(str(url or "")))


def _looks_like_viewer_url(url: str) -> bool:
    u = str(url or "").strip()
    if not u.lower().startswith(("http://", "https://")):
        return False  # loại about:blank, srcdoc, javascript:, src rỗng
    if _is_ris_wrapper_url(u) or _RIS_SHELL_RE.search(u):
        return False
    return True


def _pick_viewer_frame_url(page, timeout_ms: int = 15000) -> Optional[str]:
    """Chờ iframe viewer có src THẬT rồi chọn đúng khung ảnh.

    Bản cũ chờ cứng 3 giây rồi lấy mù `iframes[0]`: mạng chậm là hụt, mà trang
    wrapper còn chèn cả frame rỗng/ẩn nên `[0]` chưa chắc là khung ảnh.
    """
    deadline = time.monotonic() + timeout_ms / 1000.0
    while True:
        try:
            srcs = page.evaluate(
                "() => Array.from(document.querySelectorAll('iframe')).map(f => f.src || '')"
            ) or []
        except Exception:
            srcs = []
        candidates = [s for s in srcs if _looks_like_viewer_url(s)]
        if candidates:
            # Khung mang token phiên/study mới là khung ảnh thật.
            candidates.sort(
                key=lambda s: 0 if re.search(r"(session|share|token|study)=", s, re.I) else 1
            )
            return candidates[0]
        current = page.url or ""
        if _looks_like_viewer_url(current):
            return current  # RIS chuyển thẳng sang viewer, không qua iframe
        if time.monotonic() >= deadline:
            return None
        page.wait_for_timeout(400)


def resolve_study_viewer_url(
    hospital_key: str,
    study_uid: str,
    log: LogFn = _default_log,
    headless: bool = True,
    custom_username: Optional[str] = None,
    custom_password: Optional[str] = None,
) -> str:
    """Xin link viewer MỚI cho một study, ngay trước lúc tải nó.

    Link viewer RIS trả về là vé dùng-ngay (mang token phiên sống rất ngắn).
    Cấp sẵn từ lúc tìm kiếm rồi để dành tới lúc người dùng bấm tải chính là
    nguyên nhân của những ca "chỉ tải được vài ảnh" — token đã chết giữa chừng.
    Không lấy được link thì NÉM LỖI, thà báo hỏng còn hơn tải ra một ca thiếu.
    """
    from playwright.sync_api import sync_playwright

    info = HOSPITALS.get(str(hospital_key or "").lower())
    if not info:
        raise RuntimeError(f"Không hỗ trợ bệnh viện '{hospital_key}'.")
    uid = str(study_uid or "").strip()
    if not uid:
        raise RuntimeError("Study thiếu StudyInstanceUID nên không xin được link viewer.")

    base_url = _pick_hospital_base_url(info, log)
    login_url = _ris_login_url(base_url)
    wrapper_url = f"{base_url}/ris/vrViewer?studyUID={uid}&viewType=VIEWERV2"
    username, password, account = _ris_credentials(
        info, custom_username, custom_password,
    )
    reading_url = f"{base_url}/ris/study/reading"

    with sync_playwright() as p:
        browser = _launch_chromium(p, headless, log)
        options = dict(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            viewport={"width": 1600, "height": 1000},
            ignore_https_errors=True,
        )
        cached = _get_ris_session_state(hospital_key, base_url, account)
        if cached:
            options["storage_state"] = cached
        context = browser.new_context(**options)
        page = context.new_page()
        try:
            page.goto(wrapper_url, wait_until="domcontentloaded", timeout=30000)
            if _page_is_ris_login(page):
                if cached:
                    log("      Phiên RIS cũ đã hết hạn; app đang tự đăng nhập lại một lần.")
                else:
                    log("      Chưa có phiên RIS hợp lệ; app đang tự đăng nhập một lần.")
                clear_ris_session_cache(hospital_key, account)
                if not _perform_ris_login(
                    page, login_url, reading_url, username, password,
                ):
                    raise RuntimeError("Không đăng nhập được RIS để xin link viewer.")
                page.goto(wrapper_url, wait_until="domcontentloaded", timeout=30000)
            elif cached:
                log("      ✓ Đã dùng lại phiên RIS; không đăng nhập lại.")
            else:
                log("      ✓ Viewer mở trực tiếp; không cần đăng nhập RIS.")
            viewer_url = _pick_viewer_frame_url(page)
            if not viewer_url:
                raise RuntimeError(
                    "RIS không trả về khung viewer sau 15 giây (mạng chậm hoặc PACS bận)."
                )
            _store_ris_session_state(
                hospital_key, context.storage_state(), base_url, account,
            )
            return viewer_url
        except Exception as exc:
            friendly = _server_unreachable_message(exc, info["name"], base_url)
            if friendly:
                raise RuntimeError(friendly) from exc
            raise
        finally:
            browser.close()


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
    custom_username: Optional[str] = None,
    custom_password: Optional[str] = None,
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

    base_url = _pick_hospital_base_url(info, log)
    login_url = _ris_login_url(base_url)
    username, password, account = _ris_credentials(
        info, custom_username, custom_password,
    )

    reading_url = f"{base_url}/ris/study/reading"
    cached_state = _get_ris_session_state(hospital_key, base_url, account)
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
                clear_ris_session_cache(hospital_key, account)
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
                clear_ris_session_cache(hospital_key, account)
                if not _perform_ris_login(
                    page, login_url, reading_url, username, password,
                ):
                    raise RuntimeError("Không thể đăng nhập lại RIS sau khi phiên hết hạn.")
                api_result = _query_ris_studies(page, patient_id)
                if api_result.get("authFailed"):
                    raise RuntimeError("RIS tiếp tục từ chối phiên sau khi đăng nhập lại.")

            _store_ris_session_state(
                hospital_key, context.storage_state(), base_url, account,
            )
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
                                "patient_id": _study_patient_id(s) or patient_id,
                                "patient_name": _study_patient_name(s),
                                "patient_birth_date": _study_patient_value(
                                    s, "patientBirthDate", "PatientBirthDate", "birthDate", "dateOfBirth",
                                ),
                                "patient_sex": _study_patient_value(
                                    s, "patientSex", "PatientSex", "sex", "gender",
                                ),
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

            # KHÔNG xin link viewer ở đây. Link viewer mang token phiên sống rất
            # ngắn; xin sẵn lúc này rồi để người dùng xem/chọn xong mới tải thì
            # token đã chết -> ca tải ra thiếu ảnh. Link được xin lại ngay trước
            # lúc tải từng ca, trong `download_studies_list`.
            for idx, st in enumerate(studies_to_process, 1):
                if should_stop and should_stop():
                    log(">>> Đã nhận lệnh dừng!")
                    break

                uid = st["uid"]
                studies_found.append({
                    "study_uid": uid,
                    "patient_id": st.get("patient_id") or patient_id,
                    "patient_name": st.get("patient_name") or "",
                    "hospital_key": hospital_key.lower(),
                    "hospital_name": info["name"],
                    "name": f"Ca_{idx}_{st['date'].replace(':', '-').replace(' ', '_')}" if st['date'] else f"Study_{idx}",
                    "date": st['date'],
                    "modality": st['modality'],
                    "desc": st['desc'],
                    # Rỗng là CỐ Ý: link được xin mới ngay trước lúc tải ca này.
                    "direct_url": "",
                })

        except Exception as e:
            unreachable = _server_unreachable_message(e, info["name"], base_url)
            log(unreachable or f"❌ Lỗi trong quá trình kết nối/tìm kiếm trên RIS: {e}")
        finally:
            browser.close()

    names = {
        _identity_token(item.get("patient_name")): item.get("patient_name")
        for item in studies_found
        if item.get("patient_name")
    }
    if len(names) > 1:
        log("❌ RIS trả nhiều tên khác nhau cho cùng mã bệnh nhân; không tự động gộp hoặc tải.")
        return []
    resolved_name = next(iter(names.values()), "")
    if resolved_name:
        for item in studies_found:
            item["patient_name"] = resolved_name
    return studies_found


def _viewer_url_for_study(study: dict, hospital_key: str, log: LogFn, headless: bool, custom_username: Optional[str] = None, custom_password: Optional[str] = None) -> str:
    """Link tải cho MỘT ca: ưu tiên xin mới từ RIS, và chặn link không dùng được.

    Thà ném lỗi để ca đó hiện rõ là hỏng, còn hơn đưa cho trình tải một link
    wrapper/đã nguội rồi thu về vài ảnh mà vẫn báo thành công.
    """
    uid = str(study.get("study_uid") or "").strip()
    hosp = str(study.get("hospital_key") or hospital_key or "").strip().lower()
    if uid and hosp in HOSPITALS:
        log(
            "      Bước 1/2: Tạo vé viewer tạm thời cho StudyUID đã chọn "
            "(không tìm lại mã bệnh nhân)..."
        )
        return resolve_study_viewer_url(
            hosp, uid, log=log, headless=headless,
            custom_username=custom_username, custom_password=custom_password
        )

    stored = str(study.get("direct_url") or "").strip()
    if not stored:
        raise RuntimeError(
            "Ca này không có link viewer, cũng không đủ thông tin (bệnh viện + StudyUID) để xin link mới."
        )
    if _is_ris_wrapper_url(stored):
        raise RuntimeError(
            "Link đang trỏ vào trang wrapper của RIS — trang này đòi cookie đăng nhập "
            "mà trình tải không có, mở ra sẽ chỉ thấy màn hình đăng nhập."
        )
    return stored


def download_studies_list(
    studies: list[dict],
    out_base: Path,
    log: LogFn = _default_log,
    headless: bool = True,
    quality: int = 100,
    save_png: bool = False,
    contrast_mode: str = CLINICAL,
    should_stop: Optional[Callable[[], bool]] = None,
    patient_id: str = "",
    patient_name: str = "",
    hospital_key: str = "",
    hospital_name: str = "",
    selected_series_by_study: Optional[dict[str, list[str]]] = None,
    custom_username: Optional[str] = None,
    custom_password: Optional[str] = None,
) -> int:
    """
    Tải danh sách ca phim đã chọn.

    Với ca đến từ RIS (có `hospital_key` + `study_uid`), link viewer được XIN MỚI
    ngay trước khi tải từng ca, vì link RIS mang token phiên sống rất ngắn. Ca
    nào không lấy được link thì bị bỏ qua và ghi 'chưa đủ' trong hồ sơ, chứ
    không tải bằng link hỏng rồi báo là xong.
    """
    if not studies:
        log("⚠️ Danh sách ca phim rỗng.")
        return 0

    first = studies[0]
    patient_id = str(patient_id or first.get("patient_id") or "").strip()
    patient_name = str(patient_name or first.get("patient_name") or "").strip()
    patient_birth_date = _study_patient_value(
        first, "patientBirthDate", "PatientBirthDate", "patient_birth_date", "birthDate",
    )
    patient_sex = _study_patient_value(
        first, "patientSex", "PatientSex", "patient_sex", "sex", "gender",
    )
    hospital_key = str(hospital_key or first.get("hospital_key") or "").strip().lower()
    hospital_name = str(
        hospital_name
        or first.get("hospital_name")
        or HOSPITALS.get(hospital_key, {}).get("name")
        or hospital_key
    ).strip()
    patient_folder = Path(out_base)
    managed_patient = bool(patient_id and hospital_key)
    if managed_patient:
        patient_folder, manifest, created = ensure_patient_archive(
            out_base,
            patient_id=patient_id,
            patient_name=patient_name,
            hospital_key=hospital_key,
            hospital_name=hospital_name,
            patient_birth_date=patient_birth_date,
            patient_sex=patient_sex,
        )
        if created:
            log(f"Đã tạo hồ sơ bệnh nhân: {patient_folder.name}")
        else:
            log(f"Bệnh nhân đã có trong kho; phim mới sẽ được thêm vào: {patient_folder}")
            # A previous run may have learned the DICOM demographics only after
            # Windows had opened files below this directory. Rename now, before
            # this run opens any study, when no pipeline handles exist yet.
            preflight_metadata = _patient_manifest_naming_metadata(manifest)
            if preflight_metadata:
                created_date = str(manifest.get("createdAt") or "")[:10]
                patient_folder, _ = rename_patient_download_root(
                    patient_folder,
                    patient_folder,
                    preflight_metadata,
                    log=log,
                    download_date=created_date,
                    allow_collision_suffix=False,
                )

    total_downloaded = 0
    unfinished: list[str] = []
    pending_naming_metadata: dict = {}

    def rename_patient_before_conversion(study_dir: Path, metadata: dict) -> Path:
        """Rename the patient root after DICOM arrives but before image readers open it."""
        nonlocal patient_folder, pending_naming_metadata
        if not managed_patient or not metadata:
            return Path(study_dir)
        manifest = _read_patient_manifest(patient_folder) or {}
        _assert_patient_metadata_matches(
            patient_id,
            patient_name,
            metadata,
            str(manifest.get("patientBirthDate") or ""),
            str(manifest.get("patientSex") or ""),
        )
        if not (
            metadata.get("PatientBirthDate")
            or metadata.get("PatientAge") not in {None, "", "KHONG_RO_TUOI"}
        ):
            return Path(study_dir)
        pending_naming_metadata = {
            **metadata,
            "PatientID": patient_id or metadata.get("PatientID"),
            "PatientName": patient_name or metadata.get("PatientName"),
        }
        old_patient_folder = patient_folder
        study_relative = Path(study_dir).relative_to(old_patient_folder)
        created_date = str(manifest.get("createdAt") or "")[:10]
        patient_folder, remapped_study = rename_patient_download_root(
            old_patient_folder,
            Path(study_dir),
            pending_naming_metadata,
            log=log,
            download_date=created_date,
            allow_collision_suffix=False,
        )
        if patient_folder != old_patient_folder:
            log(f"Đã cập nhật tên hồ sơ bệnh nhân: {patient_folder.name}")
            return remapped_study
        return patient_folder / study_relative

    def mark(
        st: dict,
        st_out_dir: Path,
        *,
        complete: bool,
        image_count: int,
        selected_series_ids: Optional[list[str]] = None,
        selection_complete: bool = False,
        patient_metadata: Optional[dict] = None,
    ) -> None:
        if not managed_patient:
            return
        try:
            record_patient_study(
                patient_folder, st, st_out_dir,
                complete=complete, image_count=image_count,
                selected_series_ids=selected_series_ids,
                selection_complete=selection_complete,
                patient_metadata=patient_metadata,
            )
        except Exception as exc:
            log(f"      ⚠ Không ghi được trạng thái ca vào hồ sơ: {exc}")

    for idx, st in enumerate(studies, 1):
        if should_stop and should_stop():
            log(">>> Đã nhận lệnh dừng tải hàng loạt!")
            break

        st_out_dir = patient_folder / resolve_study_folder_name(patient_folder, st)
        study_uid = str(st.get("study_uid") or "")
        selected_series_ids = (
            list(selected_series_by_study.get(study_uid) or [])
            if selected_series_by_study is not None else None
        )
        if selected_series_by_study is not None and not selected_series_ids:
            raise ValueError(f"Ca {study_uid or idx} chưa có series nào được chọn.")
        selective = selected_series_ids is not None
        resume_study = st_out_dir.exists()
        label = f"Ca {idx} ({st.get('date') or '?'} - {st.get('modality') or '?'})"
        log("\n" + "-" * 60)
        log(f"[{idx}/{len(studies)}] BẮT ĐẦU TẢI CA {idx}: StudyUID={st['study_uid']}")

        try:
            viewer_url = _viewer_url_for_study(
                st, hospital_key, log, headless,
                custom_username=custom_username,
                custom_password=custom_password,
            )
        except Exception as e:
            log(f"❌ BỎ QUA CA {idx} — không lấy được link viewer: {e}")
            mark(st, st_out_dir, complete=False, image_count=0)
            unfinished.append(f"{label}: không lấy được link viewer")
            continue

        log(f"      Link Viewer: {viewer_url}")
        log(f"      Lưu tại: {st_out_dir}")
        if resume_study:
            log("      Study đã có dữ liệu cục bộ; chuyển sang chế độ tải tiếp và bỏ file trùng.")
        log("-" * 60)

        try:
            dl, cv, jpg_dir = run_pipeline(
                url=viewer_url,
                out_base=st_out_dir,
                log=log,
                headless=headless,
                quality=quality,
                save_png=save_png,
                contrast_mode=contrast_mode,
                should_stop=should_stop,
                resume=resume_study,
                selected_series_ids=selected_series_ids,
                rename_patient_root=False,
                jpg_folder_name_override="JPG",
                after_dicom_download=rename_patient_before_conversion,
                after_first_dicom=rename_patient_before_conversion,
            )
            # The pre-conversion callback may have renamed the patient root.
            st_out_dir = Path(jpg_dir).parent
            downloaded = dl.total() if dl else 0
            total_downloaded += downloaded
            stopped = bool(should_stop and should_stop())
            # "Xong" nghĩa là ĐỦ so với manifest của viewer, không phải "có tải
            # được cái gì đó". Đây chính là chỗ trước kia báo xong cho cả ca 4/348.
            complete = bool(dl and dl.is_complete() and not stopped)
            metadata = extract_patient_metadata(st_out_dir / "DICOM")
            if metadata:
                existing_manifest = _read_patient_manifest(patient_folder) or {}
                _assert_patient_metadata_matches(
                    patient_id,
                    patient_name,
                    metadata,
                    str(existing_manifest.get("patientBirthDate") or ""),
                    str(existing_manifest.get("patientSex") or ""),
                )
                if (
                    metadata.get("PatientBirthDate")
                    or metadata.get("PatientAge") not in {None, "", "KHONG_RO_TUOI"}
                ):
                    pending_naming_metadata = {
                        **metadata,
                        "PatientID": patient_id or metadata.get("PatientID"),
                        "PatientName": patient_name or metadata.get("PatientName"),
                    }

            mark(
                st,
                st_out_dir,
                complete=complete and not selective,
                image_count=downloaded,
                selected_series_ids=selected_series_ids,
                selection_complete=complete and selective,
                patient_metadata=metadata,
            )
            if complete:
                if selective:
                    log(f"✓ ĐÃ TẢI XONG {len(selected_series_ids)} SERIES ĐÃ CHỌN CỦA CA {idx}: {jpg_dir}")
                else:
                    log(f"✓ ĐÃ TẢI XONG CA {idx}: {jpg_dir}")
            elif stopped:
                log(f"⏹ CA {idx} DỪNG GIỮA CHỪNG ({downloaded} ảnh) — đánh dấu CHƯA ĐỦ.")
                unfinished.append(f"{label}: dừng giữa chừng ({downloaded} ảnh)")
            else:
                expected = getattr(dl, "expected", 0) or "?"
                log(f"⚠ CA {idx} CHƯA ĐỦ ẢNH ({downloaded}/{expected}) — đánh dấu CHƯA ĐỦ. "
                    f"Bấm tải lại ca này để bù, ảnh trùng tự bỏ.")
                unfinished.append(f"{label}: thiếu ảnh ({downloaded}/{expected})")
        except PatientIdentityConflictError as e:
            log(f"❌ CHẶN GỘP CA {idx} DO MÂU THUẪN ĐỊNH DANH: {e}")
            unfinished.append(f"{label}: mâu thuẫn định danh ({e})")
        except Exception as e:
            mark(st, st_out_dir, complete=False, image_count=0)
            log(f"❌ Lỗi khi tải ca {idx}: {e}")
            unfinished.append(f"{label}: lỗi khi tải ({e})")

    if managed_patient:
        # Do not rename a Windows directory while the DICOM/JPG pipeline is
        # actively using descendants. At this point all studies are closed and
        # the manifest has the canonical demographics learned from DICOM.
        import gc
        gc.collect()
        manifest = _read_patient_manifest(patient_folder) or {}
        naming_metadata = _patient_manifest_naming_metadata(manifest) or pending_naming_metadata
        if naming_metadata:
            created_date = str(manifest.get("createdAt") or "")[:10]
            patient_folder, _ = rename_patient_download_root(
                patient_folder,
                patient_folder,
                naming_metadata,
                log=log,
                download_date=created_date,
                allow_collision_suffix=False,
            )

    log("\n" + "=" * 70)
    done = len(studies) - len(unfinished)
    if unfinished:
        log(f"KẾT THÚC: {done}/{len(studies)} ca đủ ảnh. CÁC CA CẦN TẢI LẠI:")
        for line in unfinished:
            log(f"   • {line}")
    else:
        if selected_series_by_study is not None:
            log(f"HOÀN TẤT TẢI SERIES ĐÃ CHỌN! {len(studies)} ca đều đủ ảnh trong phạm vi đã chọn.")
        else:
            log(f"HOÀN TẤT TẢI PHIM BỆNH NHÂN! Tất cả {len(studies)} ca đều đủ ảnh.")
    log(f"Thư mục lưu: {patient_folder}")
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

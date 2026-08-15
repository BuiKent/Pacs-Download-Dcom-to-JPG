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
import http.client
import io
import json
import math
import os
import re
import urllib.request
import socket
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


# ---------------------------------------------------------------------------
# GE Centricity Universal Viewer — Zero Footprint (ZFP)
#
# Dòng này KHÔNG chuyển ảnh qua HTTP: pixel chạy trong WebSocket `image-provider`
# theo một giao thức JSON riêng của GE, nên không có response nào để quan sát như
# mọi dòng PACS khác — `observe()` vô dụng ở đây. Cách duy nhất là gắn móc vào
# WebSocket của chính trang viewer.
#
# QUAN TRỌNG — chỉ HỨNG chứ không HỎI được:
# bản trước gửi lệnh `GET_DICOM_IMAGE` y hệt viewer (đúng socket của trang, đúng
# cấu trúc payload, correlationId dạng UUID) và server im lặng 100% số lần. Đã
# loại trừ bằng thực nghiệm trên ca thật: định dạng correlationId (không phải),
# chọn nhầm socket (thử cả 4, đều câm), series chưa hiển thị (series đang mở
# cũng câm), server bỏ qua ảnh đã gửi rồi (ảnh chưa từng nạp cũng câm). Ngay
# trong lúc server bơm 600 khung của chính viewer thì không khung nào mang SOP
# mình hỏi. Server chỉ phục vụ ảnh do engine của nó quyết định.
#
# Nhưng chính viewer tự nạp gần trọn study khi mở trang — đo được 261/264 ảnh
# trong ~45 giây. Nên móc ngồi hứng: ghép mỗi khung metadata với khung nhị phân
# đi ngay sau nó trên cùng socket, xếp hàng đợi, app lấy dần ra. Hết ảnh mà còn
# thiếu thì cho trang nạp lại để viewer bơm lại từ đầu.
#
# Server trả PIXEL THÔ 16 bit kèm một khối metadata JSON đủ dựng lại DICOM
# Part-10. Vẫn là bản app dựng lại, thiếu một số tag so với file gốc của máy
# chụp — `fidelity="reconstructed"` nói thẳng điều đó.
# ---------------------------------------------------------------------------
_ZFP_HOOK = r"""
(() => {
  if (window.__zfp) return;
  // Trần bộ nhớ hàng đợi ảnh trong trang. Giữ cả một ca 264 ảnh là ~138 MB,
  // đủ để tab chết, nên lấy ra được cái nào là bỏ khỏi hàng đợi ngay.
  const MAX_QUEUE_BYTES = 96 * 1024 * 1024;
  const store = {groups: [], study: null, imageSockets: [], seen: {},
                 queue: [], queueBytes: 0, waiters: [],
                 captured: 0, dropped: 0, mismatched: 0, sopsQueued: {}};
  window.__zfp = store;

  function pack(meta, bytes) {
    let s = ''; const CH = 0x8000;
    for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    return {sop: String(meta.sopInstanceUid || ''), meta: meta, b64: btoa(s), size: bytes.length,
            captured: store.captured, dropped: store.dropped, queued: store.queue.length};
  }

  function push(meta, bytes) {
    const uid = String(meta.sopInstanceUid || '');
    if (!uid) return;
    store.captured++;
    const w = store.waiters.shift();
    if (w) { clearTimeout(w.timer); w.resolve(pack(meta, bytes)); return; }
    if (store.sopsQueued[uid]) return;
    store.sopsQueued[uid] = 1;
    store.queue.push({meta: meta, bytes: bytes});
    store.queueBytes += bytes.length;
    while (store.queueBytes > MAX_QUEUE_BYTES && store.queue.length > 1) {
      const old = store.queue.shift();
      store.queueBytes -= old.bytes.length;
      delete store.sopsQueued[String(old.meta.sopInstanceUid || '')];
      store.dropped++;
    }
  }

  function watchImages(ws) {
    // Metadata và pixel là HAI khung liền nhau trên cùng socket; ghép lệch một
    // nhịp là ghi pixel của ảnh khác vào file bệnh nhân. Số byte phải đúng
    // rows*cols*bits/8*samples mới nhận — khung nào không khớp (JPEG xem nhanh,
    // khung điều khiển) thì bỏ, thà thiếu còn hơn sai.
    let meta = null;
    ws.addEventListener('message', ev => {
      if (typeof ev.data === 'string') {
        let d = null;
        try { d = JSON.parse(ev.data); } catch (e) { d = null; }
        meta = (d && d.sopClassUid) ? d : null;
        return;
      }
      const m = meta; meta = null;
      if (!m) return;
      const dim = m.dimensions || {};
      const need = (dim.rows | 0) * (dim.columns | 0)
                 * (((m.bitsAllocated | 0) || 16) / 8)
                 * ((m.samplesPerPixel | 0) || 1);
      const b = new Uint8Array(ev.data);
      if (need && b.length !== need) { store.mismatched++; return; }
      push(m, b);
    });
  }

  const Orig = window.WebSocket;
  const Hooked = function (url, protocols) {
    const ws = protocols === undefined ? new Orig(url) : new Orig(url, protocols);
    const u = String(url);
    if (u.indexOf('data-provider') >= 0) {
      ws.addEventListener('message', ev => {
        if (typeof ev.data !== 'string') return;
        if (ev.data.indexOf('ON_DICOM_GROUP_ADDED') < 0 && ev.data.indexOf('ON_STUDY_ADDED') < 0) return;
        try {
          const msg = JSON.parse(ev.data);
          const body = JSON.parse(msg.payload);
          if (msg.eventName === 'ON_STUDY_ADDED') store.study = body;
          else if (body.groupId && !store.seen[body.groupId]) {
            store.seen[body.groupId] = 1;
            store.groups.push(body);
          }
        } catch (e) {}
      });
    } else if (u.indexOf('image-provider') >= 0) {
      try { ws.binaryType = 'arraybuffer'; } catch (e) {}
      store.imageSockets.push(ws);
      watchImages(ws);
    }
    return ws;
  };
  Hooked.prototype = Orig.prototype;
  for (const k of ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED']) Hooked[k] = Orig[k];
  window.WebSocket = Hooked;

  // Lấy ảnh kế tiếp trong hàng đợi; chưa có thì chờ tới khi viewer bơm ra.
  store.take = ms => new Promise(resolve => {
    if (store.queue.length) {
      const it = store.queue.shift();
      store.queueBytes -= it.bytes.length;
      delete store.sopsQueued[String(it.meta.sopInstanceUid || '')];
      resolve(pack(it.meta, it.bytes));
      return;
    }
    const w = {};
    w.timer = setTimeout(() => {
      const i = store.waiters.indexOf(w);
      if (i >= 0) store.waiters.splice(i, 1);
      resolve({empty: true, captured: store.captured, dropped: store.dropped});
    }, ms || 20000);
    w.resolve = resolve;
    store.waiters.push(w);
  });

  store.stats = () => ({captured: store.captured, queued: store.queue.length,
                        dropped: store.dropped, mismatched: store.mismatched,
                        sockets: store.imageSockets.filter(s => s && s.readyState === 1).length});
})();
"""


_ZFP_TAKE_MS = 20000          # chờ ảnh kế tiếp trước khi coi là hàng đợi cạn
_ZFP_MAX_RELOADS = 2          # số lần cho viewer nạp lại để bơm lại ảnh


def _zfp_reload_viewer(page, log: LogFn) -> bool:
    """Cho trang viewer nạp lại và chờ móc đọc xong cấu trúc study."""
    try:
        page.reload(wait_until="domcontentloaded", timeout=60000)
    except Exception as exc:
        log(f"  Không nạp lại được viewer: {exc}")
        return False
    for _ in range(45):
        try:
            if page.evaluate("() => (window.__zfp && window.__zfp.groups.length) || 0"):
                return True
        except Exception:
            pass
        time.sleep(1.0)
    log("  Viewer nạp lại nhưng chưa đọc được cấu trúc study.")
    return False


def _zfp_series_choices(data: Optional[dict]) -> list[dict]:
    groups = (data or {}).get("groups") or []
    choices = []
    for index, group in enumerate(groups):
        sops = group.get("dicomSops") or []
        raw = {
            # Hai series "Screen Save" trùng mô tả nhau, phải lấy SeriesInstanceUID
            # thật làm khóa thì chọn lọc series mới không bị dính chùm.
            "SeriesInstanceUID": (sops[0].get("seriesInstanceUid") if sops else "") or group.get("groupId"),
            "SeriesDescription": group.get("description"),
            "SeriesNumber": group.get("groupDisplayId"),
            "Modality": (group.get("modalities") or [""])[0],
            "ImageCount": len(sops),
        }
        choices.append(_normalise_series_choice(raw, "zfp", index))
    return choices


def _zfp_dicom_time(value: Any) -> str:
    """'17:29:45' -> '172945'. Giờ của ZFP có dấu hai chấm, VR TM thì không nhận."""
    return re.sub(r"[^0-9.]", "", str(value or ""))[:16]


def _zfp_meta_to_dicom_json(meta: dict, sop_row: dict, group: dict, study: dict) -> dict:
    """Đổi metadata của ZFP sang DICOM+JSON để dùng lại `_dicom_from_meta_frames`."""
    out: dict = {}

    def put(tag: str, vr: str, value: Any) -> None:
        if value is None or value == "" or value == []:
            return
        out[tag] = {"vr": vr, "Value": value if isinstance(value, list) else [value]}

    meta = meta or {}
    sop_row = sop_row or {}
    group = group or {}
    demo = (study or {}).get("patientDemographics") or {}
    dims = meta.get("dimensions") or {}

    name = ((demo.get("patientName") or {}).get("personNameString") or "").strip()
    put("00100010", "PN", {"Alphabetic": name} if name else None)
    put("00100020", "LO", demo.get("patientId"))
    put("00100040", "CS", demo.get("patientSex"))
    put("00100030", "DA", str(demo.get("patientBirthDate") or "").replace("-", "")[:8])
    put("00080050", "SH", demo.get("accessionNumber"))

    study_dt = str((study or {}).get("studyDateTime") or "")
    put("00080020", "DA", re.sub(r"\D", "", study_dt.split(" ")[0])[:8])
    put("00080030", "TM", _zfp_dicom_time(study_dt.split(" ")[1] if " " in study_dt else ""))
    put("00081030", "LO", ((study or {}).get("mappedStudyDescription") or {}).get(group.get("studyInstanceUid")))

    put("00080016", "UI", meta.get("sopClassUid"))
    put("00080018", "UI", meta.get("sopInstanceUid"))
    put("0020000D", "UI", group.get("studyInstanceUid"))
    put("0020000E", "UI", meta.get("seriesInstanceUid") or sop_row.get("seriesInstanceUid"))
    put("0008103E", "LO", group.get("description"))
    put("00080060", "CS", (group.get("modalities") or [""])[0])
    put("00200013", "IS", str(meta.get("instanceNumber") or sop_row.get("instanceNumber") or ""))
    put("00080021", "DA", re.sub(r"\D", "", str(meta.get("imageDate") or ""))[:8])
    put("00080031", "TM", _zfp_dicom_time(meta.get("imageTime")))
    put("00080070", "LO", meta.get("manufacturer"))
    put("00081090", "LO", meta.get("manufacturerModelName"))
    put("00080080", "LO", meta.get("institutionName"))
    put("00081010", "SH", meta.get("stationName"))
    put("00080008", "CS", meta.get("imageType"))

    put("00280010", "US", int(dims.get("rows") or 0) or None)
    put("00280011", "US", int(dims.get("columns") or 0) or None)
    put("00280100", "US", meta.get("bitsAllocated"))
    put("00280101", "US", meta.get("bitsStored") or meta.get("bitsAllocated"))
    high = meta.get("highBit")
    if high is None and meta.get("bitsStored"):
        high = int(meta["bitsStored"]) - 1
    put("00280102", "US", high)
    put("00280103", "US", meta.get("pixelRepresentation") or 0)
    put("00280002", "US", meta.get("samplesPerPixel") or 1)
    put("00280004", "CS", meta.get("photometricInterpretation") or "MONOCHROME2")
    frames = int(meta.get("numberOfFrames") or 1)
    if frames > 1:
        put("00280008", "IS", str(frames))

    window = meta.get("windowLevel") or {}
    if window.get("windowWidth"):
        put("00281050", "DS", str(window.get("windowCenter")))
        put("00281051", "DS", str(window.get("windowWidth")))
    rescale = meta.get("rescaleInfo") or {}
    if rescale:
        put("00281052", "DS", str(rescale.get("intercept", 0)))
        put("00281053", "DS", str(rescale.get("slope", 1)))

    spacing = sop_row.get("pixelSpacing") or {}
    if spacing.get("physicalDeltaY") and spacing.get("physicalDeltaX"):
        put("00280030", "DS", [str(spacing["physicalDeltaY"]), str(spacing["physicalDeltaX"])])
    if sop_row.get("imagePosition"):
        put("00200032", "DS", [x for x in str(sop_row["imagePosition"]).split("\\") if x])
    orient = sop_row.get("imageOrientation") or {}
    if orient:
        put("00200037", "DS", [str(orient.get(k, 0)) for k in
                               ("rowX", "rowY", "rowZ", "columnX", "columnY", "columnZ")])
    if sop_row.get("sliceLocation") not in (None, ""):
        put("00201041", "DS", str(sop_row["sliceLocation"]))
    return out


def _vietmy_study(body: bytes) -> dict:
    """Bóc study ra khỏi vỏ ASP.NET `{"d": ...}` của ws.asmx.

    Tuỳ endpoint mà `d` là object sẵn hay còn là chuỗi JSON lồng, nên phải thử
    cả hai — sai một nước là mất sạch manifest.
    """
    payload = json.loads(body.decode("utf-8", "replace"))
    data = payload.get("d", payload) if isinstance(payload, dict) else payload
    if isinstance(data, str):
        data = json.loads(data)
    return data if isinstance(data, dict) else {}


def _vietmy_series_choices(body: bytes) -> list[dict]:
    study = _vietmy_study(body)
    choices = []
    for index, series in enumerate(study.get("seriesList", []) or []):
        raw = dict(series)
        # Manifest đếm ảnh bằng chính `fileList`; `numberOfFrames` là số frame
        # của series nên với ảnh multi-frame hai con số này lệch nhau.
        raw["imageCount"] = len(series.get("fileList", []) or [])
        modality = series.get("modality")
        if isinstance(modality, list) and modality:
            raw["modality"] = modality[0]
        if not raw.get("modality"):
            raw["modality"] = study.get("modality") or ""
        choices.append(_normalise_series_choice(raw, "vietmy", index))
    return choices


def _dicom_json_value(item: dict, tag: str) -> Any:
    values = (item.get(tag, {}) or {}).get("Value", [None])
    return values[0] if values else ""


class _ScopedRedirectHandler(urllib.request.HTTPRedirectHandler):
    """Dựng LẠI giấy thông hành sau mỗi lần 30x.

    `urllib` tự đi theo redirect và bê nguyên header sang URL đích, nên lọc theo
    origin ở request đầu là chưa đủ: chỉ cần server trả 302 sang host khác là
    Authorization và Cookie đi theo sang đó. Mỗi chặng phải được cấp lại đúng
    giấy của chính chặng ấy.
    """

    def __init__(self, passport: Callable[[str], dict]):
        self._passport = passport

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        from urllib.parse import urlparse

        if urlparse(newurl).scheme not in ("http", "https"):
            return None
        new = super().redirect_request(req, fp, code, msg, headers, newurl)
        if new is None:
            return None
        for name in list(new.headers):
            if _is_scoped_header(name):
                del new.headers[name]
        try:
            new.headers.update(
                {k.title(): v for k, v in (self._passport(newurl) or {}).items()})
        except Exception:
            pass
        return new


_SESSION_HEADER_KEYS = ("authorization", "token", "session", "session-id")


def _is_scoped_header(name: Any) -> bool:
    """Header chỉ có giá trị với ĐÚNG một origin, nên phải cấp lại mỗi chặng."""
    lk = str(name).lower()
    return lk == "cookie" or lk.startswith("x-") or lk in _SESSION_HEADER_KEYS


def _pick_session_headers(headers: Any) -> dict:
    """Chỉ giữ "giấy thông hành" của phiên, bỏ header vận chuyển thường."""
    picked = {}
    for key, value in (headers or {}).items():
        lk = str(key).lower()
        if lk.startswith("x-") or lk in _SESSION_HEADER_KEYS:
            picked[str(key)] = value
    return picked


def _session_headers_for(captured: Any, url: str) -> dict:
    """Header phiên được phép gửi tới ĐÚNG `url` này.

    Dựng theo từng URL chứ không dựng một bộ dùng chung đầu hàm: sau khi có
    discovery, `rs_base` có thể nằm ở origin khác hẳn nơi bắt được token, và
    gửi kèm token sang đó là làm lộ nó cho bên thứ ba.
    """
    if isinstance(captured, dict):
        by_origin = captured.get("session_headers") or {}
    else:
        by_origin = getattr(captured, "session_headers", None) or {}
    return dict(by_origin.get(_url_origin(url)) or {})


def _cookie_header_for(captured: Any, url: str) -> str:
    """Cookie khớp domain/path/secure của ĐÚNG `url` này.

    `context.cookies()` trả cookie của MỌI domain trình duyệt đã ghé. Nối tất cả
    rồi gửi cho mọi host là đưa cookie phiên của nơi này sang nơi khác — cùng
    một lỗi với header, chỉ là dễ bỏ sót hơn.
    """
    from urllib.parse import urlparse

    if isinstance(captured, dict):
        cookies = captured.get("cookies") or []
    else:
        cookies = getattr(captured, "cookies", None) or []
    try:
        pu = urlparse(str(url or ""))
    except Exception:
        return ""
    host = (pu.hostname or "").casefold()
    path = pu.path or "/"
    is_https = (pu.scheme or "").casefold() == "https"
    if not host:
        return ""
    matched = []
    for cookie in cookies:
        try:
            raw_domain = str(cookie.get("domain") or "").casefold()
            if not raw_domain:
                continue
            # RFC 6265 §5.1.3. Dấu chấm đầu PHÂN BIỆT hai loại cookie, không
            # phải để trang trí: "pacs.a.vn" là host-only (chỉ đúng host đó),
            # ".a.vn" mới là domain cookie (được xuống subdomain). Gộp chúng lại
            # là đẩy cookie host-only sang mọi subdomain.
            if raw_domain.startswith("."):
                base = raw_domain[1:]
                if not base or not (host == base or host.endswith("." + base)):
                    continue
            elif host != raw_domain:
                continue
            if cookie.get("secure") and not is_https:
                continue
            # RFC 6265 §5.1.4: tiền tố chuỗi là chưa đủ — "/rs" không được khớp
            # "/rs-evil"; ranh giới phải rơi đúng vào dấu "/".
            cookie_path = str(cookie.get("path") or "/") or "/"
            if not (path == cookie_path
                    or (path.startswith(cookie_path)
                        and (cookie_path.endswith("/")
                             or path[len(cookie_path):len(cookie_path) + 1] == "/"))):
                continue
            matched.append(f'{cookie.get("name")}={cookie.get("value")}')
        except Exception:
            continue
    return "; ".join(matched)


def _passport_builder(captured: Any) -> Callable[[str], dict]:
    """Hàm cấp header phiên + cookie cho ĐÚNG một URL.

    Mọi đường tải đều dùng chung hàm này, kể cả các dòng PACS độc quyền: manifest
    của VRPACS/VietMy được phép chứa URL TUYỆT ĐỐI (xem `to_url()` trả thẳng `s`
    khi nó bắt đầu bằng "http", và `filePath/wanFilePath` của VietMy), nên ảnh
    hoàn toàn có thể nằm ở CDN/object storage khác origin. Gửi kèm cookie phiên
    sang đó vừa là rò rỉ, vừa hay khiến chính CDN từ chối request.
    """
    def _pass_for(url: str) -> dict:
        headers = _session_headers_for(captured, url)
        cookie = _cookie_header_for(captured, url)
        if cookie:
            headers["Cookie"] = cookie
        return headers

    return _pass_for


def _redact_url(url: Any) -> str:
    """URL đủ để chẩn đoán, đã bỏ GIÁ TRỊ query — token/session nằm ở đó.

    Giữ nguyên path (UID trong path là thứ cần nhìn để nhận ra dòng PACS, và
    không phải bí mật), chỉ liệt kê TÊN tham số query.
    """
    from urllib.parse import urlparse, parse_qs

    try:
        pu = urlparse(str(url or ""))
        keys = ",".join(sorted(parse_qs(pu.query).keys()))
        return f"{pu.scheme}://{pu.netloc}{pu.path}" + (f"?<{keys}>" if keys else "")
    except Exception:
        return "<url không đọc được>"


# Tài nguyên tĩnh của giao diện — ghi lại chỉ làm loãng báo cáo chẩn đoán.
_STATIC_URL_SUFFIXES = (
    ".js", ".mjs", ".css", ".map", ".ico", ".png", ".jpg", ".jpeg", ".gif",
    ".svg", ".webp", ".woff", ".woff2", ".ttf", ".eot", ".html", ".htm",
)
_SEEN_URL_LIMIT = 40


def _note_seen_url(cap: ViewerCapture, url: str) -> None:
    """Ghi lại endpoint viewer đã gọi, để báo cáo khi không adapter nào nhận ra link."""
    if len(cap.seen_urls) >= _SEEN_URL_LIMIT:
        return
    if url.split("?")[0].casefold().endswith(_STATIC_URL_SUFFIXES):
        return
    entry = _redact_url(url)
    if entry not in cap.seen_urls:
        cap.seen_urls.append(entry)


def _dicomweb_study_from_qido(qido_series_url: Any) -> str:
    """StudyInstanceUID tách được từ URL QIDO series, "" nếu không tách được.

    `DicomWebAdapter.is_ready()` và `_download_via_dicomweb()` PHẢI hỏi chung
    hàm này. Trước đây adapter chỉ cần URL kết thúc "/series" là báo sẵn sàng,
    còn phần tải lại đòi tách cho được ".../studies/<uid>/series" — dạng
    top-level "/series?StudyInstanceUID=..." (cũng hợp chuẩn PS3.18) lọt qua
    cửa adapter rồi chết ở phần tải, đốt mất một lượt thử mà không tải được gì.
    """
    from urllib.parse import urlparse

    try:
        path = urlparse(str(qido_series_url or "")).path
    except Exception:
        return ""
    if "/studies/" not in path:
        return ""
    return path.split("/studies/")[1].split("/series")[0].strip("/").strip()


@dataclass
class DicomWebProfile:
    """Đường vào DICOMweb đã giải xong cho một ca cụ thể.

    PS3.18 chuẩn hoá phần path SAU Base URI, còn Base URI là cấu hình của server
    (Orthanc đổi được `DicomWeb.Root`, dcm4chee gắn `{AET}` vào đường dẫn) — nên
    `rs_base` là thứ phải GIẢI cho từng nơi rồi nhớ lại, không phải thứ đoán được.

    `query_style` tách riêng vì Search Transaction có hai dạng đều hợp chuẩn:
      • hierarchical: /studies/<uid>/series
      • toplevel    : /series?StudyInstanceUID=<uid>
    Còn Retrieve thì LUÔN phân cấp, nên phần tải ảnh không phụ thuộc biến này.
    """

    rs_base: str
    study_uid: str
    query_style: str = "hierarchical"
    source: str = "sniff"

    @property
    def is_toplevel(self) -> bool:
        return self.query_style == "toplevel"

    def series_search_url(self) -> str:
        if self.is_toplevel:
            return f"{self.rs_base}/series?StudyInstanceUID={self.study_uid}"
        return f"{self.rs_base}/studies/{self.study_uid}/series"

    def instances_search_url(self, series_uid: str) -> str:
        if self.is_toplevel:
            return (f"{self.rs_base}/instances?StudyInstanceUID={self.study_uid}"
                    f"&SeriesInstanceUID={series_uid}")
        return f"{self.rs_base}/studies/{self.study_uid}/series/{series_uid}/instances"

    def study_instances_search_url(self, limit: int = 0) -> str:
        if self.is_toplevel:
            base = f"{self.rs_base}/instances?StudyInstanceUID={self.study_uid}"
            return f"{base}&limit={limit}" if limit else base
        base = f"{self.rs_base}/studies/{self.study_uid}/instances"
        return f"{base}?limit={limit}" if limit else base

    # Retrieve resources — luôn phân cấp, không phụ thuộc `query_style`.
    def series_metadata_url(self, series_uid: str) -> str:
        return f"{self.rs_base}/studies/{self.study_uid}/series/{series_uid}/metadata"

    def study_metadata_url(self) -> str:
        return f"{self.rs_base}/studies/{self.study_uid}/metadata"

    def instance_url(self, series_uid: str, sop_uid: str) -> str:
        return (f"{self.rs_base}/studies/{self.study_uid}"
                f"/series/{series_uid}/instances/{sop_uid}")

    @classmethod
    def from_qido_url(cls, qido_series_url: Any, source: str = "sniff") -> Optional["DicomWebProfile"]:
        """Dựng profile từ đúng URL QIDO đã bắt được, "" thì trả None."""
        from urllib.parse import urlparse

        study = _dicomweb_study_from_qido(qido_series_url)
        if not study:
            return None
        pu = urlparse(str(qido_series_url))
        rs_base = f"{pu.scheme}://{pu.netloc}{pu.path.split('/studies/')[0]}"
        return cls(rs_base=rs_base, study_uid=study, query_style="hierarchical", source=source)


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
class StrategyOutcome:
    status: str
    expected: int = 0
    completed: int = 0
    failed: int = 0
    errors: list[str] = field(default_factory=list)
    strategy: str = ""
    adapter: str = ""
    study_uid: str = ""
    elapsed_ms: float = 0.0
    retryable: bool = False


class StudyIdentityGuard:
    """Bảo vệ ranh giới study: không gộp lẫn DICOM của nhiều ca chụp khác nhau."""

    def __init__(self, locked_study_uid: str = ""):
        self.locked_study_uid = (locked_study_uid or "").strip()
        self._lock = threading.Lock()

    def accept(self, incoming_study_uid: str) -> bool:
        uid = (incoming_study_uid or "").strip()
        with self._lock:
            if not self.locked_study_uid:
                if uid:
                    self.locked_study_uid = uid
                    return True
                return True
            if not uid:
                return False
            return self.locked_study_uid == uid


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
    cancelled: bool = False
    outcomes: list[StrategyOutcome] = field(default_factory=list)
    preferred_routes: list[str] = field(default_factory=list)

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
        if self.cancelled or self.failed > 0 or self.expected <= 0:
            return False
        if self.dicom <= 0 and self.completed_tasks <= 0 and (self.jpg > 0 or self.png > 0):
            return False
        counted = self.completed_tasks or self.dicom
        if counted <= 0:
            return False
        return counted >= self.expected

    @property
    def status(self) -> str:
        """
        Trạng thái y khoa chính xác của phiên tải:
        - "complete": Đã tải đủ 100% số ảnh DICOM theo manifest đã biết (failed == 0).
        - "partial": Đã tải được một phần DICOM (có manifest nhưng thiếu/lỗi).
        - "partial_unknown": Có ảnh DICOM nhưng không có manifest để đối chiếu tổng.
        - "rendered_only": Không có DICOM, chỉ có ảnh JPG/PNG render màn hình.
        - "cancelled": Người dùng bấm dừng.
        - "failed": Không tải được ảnh nào và có lỗi.
        - "unknown": Rỗng / chưa bắt đầu.
        """
        if self.cancelled:
            return "cancelled"
        if self.dicom > 0:
            if self.expected > 0:
                counted = self.completed_tasks or self.dicom
                if counted >= self.expected and self.failed == 0:
                    return "complete"
                return "partial"
            return "partial_unknown"
        if self.jpg > 0 or self.png > 0:
            return "rendered_only"
        if self.failed > 0:
            return "failed"
        return "unknown"


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

    vietmy: Optional[bytes] = None

    # ZFP không phát manifest qua HTTP nên phải giữ luôn `page` để hỏi ảnh.
    zfp: Optional[dict] = None
    zfp_page: Any = None

    qido_series: Optional[str] = None
    qido_series_body: Optional[bytes] = None
    wado_tmpl: Optional[str] = None
    # Do `resolve_dicomweb_access()` giải ra khi sniff không đủ (đọc config viewer /
    # dò có giới hạn). Có nó thì `DicomWebAdapter` tải được kể cả khi URL QIDO
    # bắt được là dạng top-level.
    dicomweb_profile: Optional[DicomWebProfile] = None

    host: Optional[str] = None
    cookies: Optional[list] = None
    # "Giấy thông hành" viewer đã dùng, XẾP THEO ORIGIN. Bắt buộc phải theo
    # origin: gửi token của viện A sang một root đoán mò ở origin B là làm lộ
    # token cho bên thứ ba. Chỉ ghi khi thật sự lọc ra được header phiên — một
    # request chỉ có `Accept` mà cũng chiếm chỗ thì request sau mang Bearer sẽ
    # bị bỏ qua và cả ca mất quyền.
    session_headers: dict[str, dict] = field(default_factory=dict)
    session_error: Optional[str] = None
    budget: Any = None
    strategy_fingerprint: str = ""
    existing_sop_uids: set[str] = field(default_factory=set)
    socket_tracker: Optional[ActiveSocketTracker] = None
    # Endpoint viewer đã gọi, đã ẩn giá trị query. Chỉ dùng để báo cáo khi
    # KHÔNG dòng PACS nào nhận ra link — xem `_log_discovery_failure()`.
    seen_urls: list[str] = field(default_factory=list)

    def as_legacy_dict(self) -> dict:
        """Đúng cái dict mà `_download_via_*()` đang nhận.

        Giữ nguyên kiểu tham số này để phần tải không phải sửa một dòng nào, và
        để các test đang dựng dict bằng tay vẫn chạy được.
        """
        return {
            "getstudies": self.getstudies,
            "template_url": self.template_url,
            "vrpacs": self.vrpacs,
            "vietmy": self.vietmy,
            "zfp": self.zfp,
            "zfp_page": self.zfp_page,
            "qido_series": self.qido_series,
            "qido_series_body": self.qido_series_body,
            "wado_tmpl": self.wado_tmpl,
            "dicomweb_profile": self.dicomweb_profile,
            "host": self.host,
            "cookies": self.cookies,
            "session_headers": self.session_headers,
            "session_error": self.session_error,
            "budget": self.budget,
            "strategy_fingerprint": self.strategy_fingerprint,
            "existing_sop_uids": self.existing_sop_uids,
            "socket_tracker": self.socket_tracker,
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

    def why_not_ready(self, cap: ViewerCapture) -> str:
        """Còn thiếu gì để `is_ready()` thành True — chỉ dùng cho log chẩn đoán.

        Đặt cạnh `is_ready()` để hai bên không trôi khỏi nhau: sửa điều kiện sẵn
        sàng thì thấy ngay dòng giải thích nằm ngay dưới.
        """
        return "chưa thấy dấu hiệu của dòng PACS này"

    @staticmethod
    def _missing(fields: dict[str, Any]) -> str:
        """Gọi tên đúng thứ CHƯA bắt được, theo tên endpoint người dùng dò được."""
        absent = [name for name, value in fields.items() if not value]
        return ("chưa bắt được " + "; ".join(absent)) if absent else ""

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

    def why_not_ready(self, cap: ViewerCapture) -> str:
        return self._missing({
            "manifest 'StudyData/GetStudies'": cap.getstudies,
            "một URL ảnh 'GetImage' làm khuôn": cap.template_url,
        })

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

    def why_not_ready(self, cap: ViewerCapture) -> str:
        return self._missing({"manifest 'get-share-patient-image'": cap.vrpacs})

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

    # Đường dẫn của MỌI request kiểu DICOMweb, không riêng "/series". Viewer
    # thường xin metadata/frames trước khi (hoặc thay vì) gọi QIDO, và "giấy
    # thông hành" gắn trên request nào cũng như nhau — chỉ soi mỗi "/series" thì
    # nhiều viện không bao giờ nhặt được token.
    _DICOMWEB_PATH_HINTS = ("/studies", "/series", "/instances", "/metadata", "/frames")

    def _grab_session_headers(self, response, cap: ViewerCapture) -> None:
        try:
            headers = response.request.all_headers()
        except Exception:
            try:
                headers = dict(response.request.headers)
            except Exception:
                return
        picked = _pick_session_headers(headers)
        # Request đầu tiên thường chỉ có `Accept`; nếu nó cũng chiếm chỗ thì
        # request sau mang Bearer sẽ bị bỏ qua và cả ca mất quyền. Chỉ ghi khi
        # lọc ra được header phiên thật, và ghi đè bằng bộ mới nhất vì token hay
        # được làm mới giữa phiên.
        if not picked:
            return
        cap.session_headers[_url_origin(response.url)] = picked

    def observe(self, response, cap: ViewerCapture) -> bool:
        url = response.url
        path = url.split("?")[0]
        if any(hint in path for hint in self._DICOMWEB_PATH_HINTS):
            self._grab_session_headers(response, cap)
        if path.rstrip("/").endswith("/series"):
            if cap.qido_series is None:
                cap.qido_series = url
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
        # QIDO series là đủ — miễn tách được StudyInstanceUID từ chính URL đó,
        # vì đó là tất cả những gì `_download_via_dicomweb()` cần để dựng
        # rs_base: nó tự dò WADO-URI / WADO-RS / dựng lại từ frames (BV Hà Tĩnh
        # không phát URL nào chứa "wado").
        return cap.dicomweb_profile is not None or bool(
            _dicomweb_study_from_qido(cap.qido_series)
        )

    def why_not_ready(self, cap: ViewerCapture) -> str:
        if not cap.qido_series:
            return ("chưa bắt được request QIDO nào có path kết thúc '/series', "
                    "và cũng không giải được đường vào DICOMweb từ config/dò")
        return (
            f"đã thấy QIDO '{_redact_url(cap.qido_series)}' nhưng không tách được "
            "'/studies/<uid>/', và cũng không giải được StudyInstanceUID để dựng "
            "truy vấn top-level"
        )

    def has_series_manifest(self, cap: ViewerCapture) -> bool:
        return cap.qido_series_body is not None

    def series_choices(self, cap: ViewerCapture) -> list[dict]:
        return _dicomweb_series_choices(cap.qido_series_body)

    def download(self, cap, save_body, stats, log, stop, selected_series) -> None:
        _download_via_dicomweb(
            cap.as_legacy_dict(), save_body, stats, log, stop, selected_series,
        )


class ZfpAdapter(PacsAdapter):
    """GE Centricity Universal Viewer — Zero Footprint (ảnh chạy trong WebSocket).

    `observe()` luôn trả False vì dòng này không phát response ảnh nào qua HTTP;
    cấu trúc study do móc WebSocket (`_ZFP_HOOK`) nhặt về, `_inspect_zfp()` đọc
    sang. Đây là dòng PACS duy nhất phải soi trang thay vì soi mạng.
    """

    name = "GE-ZFP"
    source = "zfp"
    priority = 280

    def is_ready(self, cap: ViewerCapture) -> bool:
        return bool(cap.zfp and cap.zfp_page)

    def why_not_ready(self, cap: ViewerCapture) -> str:
        return self._missing({
            "cấu trúc study từ móc WebSocket ZFP": cap.zfp,
            "trang viewer còn mở để hỏi ảnh": cap.zfp_page,
        })

    def has_series_manifest(self, cap: ViewerCapture) -> bool:
        return bool(cap.zfp)

    def series_choices(self, cap: ViewerCapture) -> list[dict]:
        return _zfp_series_choices(cap.zfp)

    def download(self, cap, save_body, stats, log, stop, selected_series) -> None:
        _download_via_zfp(
            cap.as_legacy_dict(), save_body, stats, log, stop, selected_series,
        )


class VietmyAdapter(PacsAdapter):
    """MSC PACS (vietmy.pmr.vn — link chia sẻ ShareStudy.aspx).

    Viewer vẽ ảnh bằng WebGL nên KHÔNG có request ảnh rời để bắt; bù lại nó gọi
    `ws.asmx/GetListImageFileInfo` một lần, và chính manifest đó đã chứa link
    DICOM gốc của từng ảnh. Bám vào manifest là lấy được bản gốc, không phải
    ảnh màn hình.
    """

    name = "VietMy"
    source = "vietmy"
    priority = 270

    def observe(self, response, cap: ViewerCapture) -> bool:
        if "GetListImageFileInfo" in response.url and cap.vietmy is None:
            cap.vietmy = response.body()
            return True
        return False

    def is_ready(self, cap: ViewerCapture) -> bool:
        return cap.vietmy is not None

    def why_not_ready(self, cap: ViewerCapture) -> str:
        return self._missing({"manifest 'GetListImageFileInfo'": cap.vietmy})

    def has_series_manifest(self, cap: ViewerCapture) -> bool:
        return cap.vietmy is not None

    def series_choices(self, cap: ViewerCapture) -> list[dict]:
        return _vietmy_series_choices(cap.vietmy)

    def download(self, cap, save_body, stats, log, stop, selected_series) -> None:
        _download_via_vietmy(
            cap.as_legacy_dict(), save_body, stats, log, stop, selected_series,
        )


# Không giữ trạng thái riêng — mọi thứ nhặt được nằm trong `ViewerCapture`, nên
# dùng chung một bộ instance cho mọi phiên tải là an toàn.
PACS_ADAPTERS: tuple[PacsAdapter, ...] = (
    VradAdapter(),
    VrpacsAdapter(),
    ZfpAdapter(),
    VietmyAdapter(),
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


def compute_url_fingerprint(url: str, adapter_name: str = "") -> str:
    """
    Tính fingerprint trung lập bảo mật từ URL viewer:
    origin + normalized path family + query parameter names (KHÔNG lưu query values, token hay secret).
    """
    from urllib.parse import urlparse, parse_qs
    try:
        pu = urlparse(url)
        origin = f"{pu.scheme}://{pu.netloc}".lower() if pu.netloc else "generic"
        # Chuẩn hóa path: thay DICOM UIDs chấm, UUIDs, hex dài và số ID thành placeholder '*'
        path = re.sub(r"\b\d+(\.\d+)+\b", "*", pu.path)
        path = re.sub(r"[0-9a-fA-F\-]{8,}", "*", path)
        path = re.sub(r"/\d+(?=/|$)", "/*", path)
        query_keys = ",".join(sorted(parse_qs(pu.query).keys()))
        adapter_token = adapter_name.upper() if adapter_name else "*"
        return f"{origin}|{path}?{query_keys}|{adapter_token}"
    except Exception:
        return f"generic|*|{adapter_name.upper() if adapter_name else '*'}"


@dataclass
class DownloadBudget:
    """Quản lý hạn mức thời gian và kiểm soát stall cho phiên tải."""
    started_at: float = field(default_factory=time.monotonic)
    last_progress_at: float = field(default_factory=time.monotonic)
    hard_deadline_s: float = 45 * 60.0  # 45 phút tối đa cho một study
    stall_deadline_s: float = 3 * 60.0  # 3 phút không có tiến độ mới -> chuyển fallback
    idle_chunk_s: float = 60.0          # 60s giữa các chunk dữ liệu

    def touch(self) -> None:
        self.last_progress_at = time.monotonic()

    def is_expired(self) -> bool:
        return self.is_hard_expired() or self.is_stalled()

    def is_stalled(self) -> bool:
        return time.monotonic() - self.last_progress_at >= self.stall_deadline_s

    def is_hard_expired(self) -> bool:
        return time.monotonic() - self.started_at >= self.hard_deadline_s


class ActiveSocketTracker:
    """Theo dõi và ngắt cưỡng chế các socket đang block ở tầng OS khi huỷ hoặc timeout."""

    def __init__(self):
        self._lock = threading.Lock()
        self._active_resources: set = set()

    def track(self, resource: Any) -> None:
        if resource is None:
            return
        with self._lock:
            self._active_resources.add(resource)

    def untrack(self, resource: Any) -> None:
        if resource is None:
            return
        with self._lock:
            self._active_resources.discard(resource)

    def interrupt_all(self) -> None:
        with self._lock:
            targets = list(self._active_resources)
            self._active_resources.clear()
        for res in targets:
            self._close_resource(res)

    def opener(self, context=None, passport: Optional[Callable[[str], dict]] = None):
        """Opener ghi sổ socket NGAY lúc mở, tức là trước cả bắt tay TLS.

        Chỉ bọc ở tầng đọc body là quá muộn: lúc worker còn kẹt trong `urlopen()`
        (bắt tay TLS, chờ header đầu tiên) thì chưa có gì để ngắt, nên bấm Cancel
        vẫn phải chờ hết `timeout` — đúng kiểu treo mà người dùng thấy.
        """
        import urllib.request

        tracker = self

        def _create_connection(address, timeout=socket._GLOBAL_DEFAULT_TIMEOUT,
                               source_address=None):
            sock = socket.create_connection(address, timeout, source_address)
            tracker.track(sock)
            return sock

        class _TrackedConnection(http.client.HTTPConnection):
            def __init__(self, *args, **kwargs):
                super().__init__(*args, **kwargs)
                self._create_connection = _create_connection

        class _TrackedSecureConnection(http.client.HTTPSConnection):
            def __init__(self, *args, **kwargs):
                super().__init__(*args, **kwargs)
                self._create_connection = _create_connection

        class _TrackedHandler(urllib.request.HTTPHandler):
            def http_open(self, req):
                return self.do_open(_TrackedConnection, req)

        class _TrackedSecureHandler(urllib.request.HTTPSHandler):
            def https_open(self, req):
                return self.do_open(_TrackedSecureConnection, req, context=self._context)

        handlers = [_TrackedHandler, _TrackedSecureHandler(context=context)]
        if passport is not None:
            handlers.append(_ScopedRedirectHandler(passport))
        return urllib.request.build_opener(*handlers)

    def release(self, res: Any) -> None:
        """Bỏ ghi sổ một response *và* socket nằm dưới nó khi đã đọc xong.

        Socket được ghi sổ từ lúc mở kết nối, nên nếu không bỏ ra thì một study
        vài nghìn ảnh sẽ giữ lại từng đó socket đã đóng trong bộ nhớ.
        """
        self.untrack(res)
        self.untrack(self._socket_of(res))

    @staticmethod
    def _socket_of(res: Any) -> Any:
        if isinstance(res, socket.socket):
            return res
        sock = getattr(res, "_sock", None)
        if sock is None:
            fp = getattr(res, "fp", None)
            if fp is not None:
                raw = getattr(fp, "raw", None)
                if raw is not None:
                    sock = getattr(raw, "_sock", None)
                if sock is None:
                    sock = getattr(fp, "_sock", None)
        return sock

    @classmethod
    def _close_resource(cls, res: Any) -> None:
        try:
            sock = cls._socket_of(res)
            if sock is not None:
                try:
                    sock.shutdown(socket.SHUT_RDWR)
                except Exception:
                    pass
                try:
                    sock.close()
                except Exception:
                    pass
                # Trên Windows, `shutdown()` không huỷ được lệnh `recv` đang chờ,
                # còn `close()` chỉ giảm số tham chiếu — response nào đang mở
                # `makefile()` thì socket vẫn sống và worker vẫn treo. `_real_close()`
                # mới thực sự đóng handle, khiến `recv` bật ra ngay (WSAENOTSOCK).
                real_close = getattr(sock, "_real_close", None)
                if callable(real_close):
                    try:
                        real_close()
                    except Exception:
                        pass
            if hasattr(res, "close"):
                res.close()
        except Exception:
            pass


class PacsStrategyStore:
    """Lưu trữ và tối ưu hóa các chiến lược tải đã thành công (Không lưu bí mật, token hay PII)."""

    TTL_SECONDS: float = 90 * 86400.0  # 90 ngày

    def __init__(self, path: Optional[Path] = None):
        if path is None:
            app_data = Path(os.environ.get("LOCALAPPDATA") or Path.home())
            self.path = app_data / "DCom JPG PACS" / "pacs-strategies-v1.json"
        else:
            self.path = Path(path)
        self._lock = threading.Lock()

    def load(self) -> dict[str, dict]:
        with self._lock:
            if not self.path.is_file():
                return {}
            try:
                data = json.loads(self.path.read_text(encoding="utf-8"))
                if isinstance(data, dict) and data.get("schemaVersion") == 1:
                    recipes = data.get("recipes", {})
                    now_ts = time.time()
                    valid = {}
                    for k, v in recipes.items():
                        last_act = v.get("lastSuccessAt") or v.get("updatedAt") or 0
                        if now_ts - last_act < self.TTL_SECONDS:
                            valid[k] = v
                    return valid
            except Exception:
                pass
            return {}

    def save_recipe(self, fingerprint: str, adapter: str, preferred_routes: Optional[list[str]] = None,
                    success: bool = True, partial: bool = False, failure_class: str = "",
                    latency_ms: float = 0.0,
                    dicomweb_base: str = "", dicomweb_query_style: str = "") -> None:
        with self._lock:
            try:
                recipes = {}
                if self.path.is_file():
                    try:
                        data = json.loads(self.path.read_text(encoding="utf-8"))
                        if isinstance(data, dict) and data.get("schemaVersion") == 1:
                            recipes = data.get("recipes", {})
                    except Exception:
                        recipes = {}

                now_ts = time.time()
                recipes = {
                    k: v for k, v in recipes.items()
                    if now_ts - (v.get("lastSuccessAt") or v.get("updatedAt") or 0) < self.TTL_SECONDS
                }

                r = recipes.get(fingerprint, {
                    "schemaVersion": 1,
                    "fingerprint": fingerprint,
                    "adapter": adapter,
                    "preferredRoutes": preferred_routes or [],
                    "success": 0,
                    "partial": 0,
                    "failure": 0,
                    "latencyEwmaMs": latency_ms,
                    "lastSuccessAt": 0,
                    "lastFailureClass": "",
                })

                if success:
                    r["adapter"] = adapter
                    r["success"] = r.get("success", 0) + 1
                    r["lastSuccessAt"] = now_ts
                    if preferred_routes:
                        r["preferredRoutes"] = preferred_routes
                    # Đây mới là thứ tiết kiệm được công dò lần sau: Base URI
                    # DICOMweb là cấu hình của server nên dùng lại được cho MỌI
                    # ca ở cùng nơi. KHÔNG lưu studyUID — đó là dữ liệu bệnh nhân
                    # và cũng chỉ đúng cho đúng một ca.
                    if dicomweb_base:
                        r["dicomwebBase"] = dicomweb_base
                    if dicomweb_query_style:
                        r["dicomwebQueryStyle"] = dicomweb_query_style
                    if latency_ms > 0:
                        old_ewma = r.get("latencyEwmaMs", latency_ms)
                        r["latencyEwmaMs"] = round(0.7 * old_ewma + 0.3 * latency_ms, 2)
                elif partial:
                    r["partial"] = r.get("partial", 0) + 1
                else:
                    r["failure"] = r.get("failure", 0) + 1
                    if failure_class:
                        r["lastFailureClass"] = failure_class

                r["updatedAt"] = now_ts
                recipes[fingerprint] = r
                if len(recipes) > 200:
                    sorted_items = sorted(
                        recipes.items(),
                        key=lambda item: item[1].get("lastSuccessAt", 0),
                        reverse=True,
                    )
                    recipes = dict(sorted_items[:200])

                self.path.parent.mkdir(parents=True, exist_ok=True)
                payload = {
                    "schemaVersion": 1,
                    "updatedAt": now_ts,
                    "recipes": recipes,
                }
                temp_file = self.path.with_suffix(".tmp")
                temp_file.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
                temp_file.replace(self.path)
            except Exception:
                pass

    def get_preferred_adapter(self, fingerprint: str) -> Optional[str]:
        recipes = self.load()
        r = recipes.get(fingerprint)
        if r and r.get("success", 0) > r.get("failure", 0):
            return r.get("adapter")
        return None

    def get_preferred_routes(self, fingerprint: str) -> list[str]:
        recipes = self.load()
        r = recipes.get(fingerprint)
        if r and isinstance(r.get("preferredRoutes"), list):
            return r["preferredRoutes"]
        return []

    def get_dicomweb_hint(self, fingerprint: str) -> tuple[str, str]:
        """(rs_base, query_style) đã giải được lần trước cho dạng link này."""
        r = self.load().get(str(fingerprint or ""))
        if not r or r.get("success", 0) <= r.get("failure", 0):
            return "", ""
        return str(r.get("dicomwebBase") or ""), str(r.get("dicomwebQueryStyle") or "")


pacs_strategy_store = PacsStrategyStore()


def _ready_adapters(cap: ViewerCapture, url: str = "") -> list[PacsAdapter]:
    """Danh sách mọi adapter đủ dữ kiện để TẢI, ưu tiên theo Strategy Store đã học rồi đến priority tĩnh."""
    ready = [a for a in PACS_ADAPTERS if a.is_ready(cap)]
    if not ready:
        return []
    sorted_adapters = sorted(ready, key=lambda a: a.priority, reverse=True)
    if url:
        try:
            fp = compute_url_fingerprint(url)
            pref = pacs_strategy_store.get_preferred_adapter(fp)
            if pref:
                for idx, a in enumerate(sorted_adapters):
                    if a.name.lower() == pref.lower():
                        preferred_adapter = sorted_adapters.pop(idx)
                        sorted_adapters.insert(0, preferred_adapter)
                        break
        except Exception:
            pass
    return sorted_adapters


def _ready_adapter(cap: ViewerCapture, url: str = "") -> Optional[PacsAdapter]:
    """Adapter đủ dữ kiện để TẢI, ưu tiên dòng chuyên biệt trước dòng chung."""
    adapters = _ready_adapters(cap, url=url)
    return adapters[0] if adapters else None


def _log_discovery_failure(cap: ViewerCapture, log: LogFn) -> None:
    """Vì sao không dòng PACS nào nhận ra link này.

    Không có báo cáo này, một link lạ chỉ để lại đúng câu "chưa đủ ảnh": không
    biết viewer đã gọi những gì, cũng không biết dòng nào suýt nhận ra — nên mỗi
    link mới lại phải mở log thô ra dò. Đây cũng chính là dữ liệu để quyết định
    có đáng viết adapter mới hay không.
    """
    log("!!! Chưa dòng PACS nào nhận ra link này — báo cáo để đối chiếu:")
    for adapter in sorted(PACS_ADAPTERS, key=lambda a: a.priority, reverse=True):
        try:
            reason = adapter.why_not_ready(cap)
        except Exception as exc:
            reason = f"lỗi khi kiểm tra ({exc})"
        log(f"      • {adapter.name}: {reason or 'không rõ'}")
    if cap.seen_urls:
        log(f"      Viewer đã gọi {len(cap.seen_urls)} endpoint (đã ẩn giá trị query):")
        for entry in cap.seen_urls:
            log(f"        - {entry}")
    else:
        log("      Không bắt được endpoint nào — nhiều khả năng trang chưa tải được.")
    log("      → Chuyển sang mô phỏng thao tác trên giao diện để ép viewer tự tải ảnh.")

# ---------------------------------------------------------------------------
# Giải đường vào DICOMweb khi sniff bị động không đủ.
#
# Nguyên tắc: sniff vẫn là đường CHÍNH (observer gắn từ trước `page.goto()` nên
# gần như miễn phí và có đúng phiên). Phần dưới đây chỉ là lưới sau, chạy theo
# BẰNG CHỨNG giảm dần và luôn phải XÁC MINH mới được dùng.
# ---------------------------------------------------------------------------

# OHIF công bố `window.config.dataSources[].configuration.{qidoRoot,wadoRoot,
# wadoUriRoot}`. Nguồn tin cậy cao nhưng KHÔNG tuyệt đối: config có thể là
# function nhận `{ servicesManager, extensionManager, ... }`, có nhiều
# dataSource, root có thể tương đối qua reverse proxy, và bản fork thì đổi cấu
# trúc. Vì vậy kết quả chỉ là ỨNG VIÊN.
_OHIF_CONFIG_JS = """
() => {
  const stub = new Proxy(function () {}, {
    get: () => stub,
    apply: () => stub,
    construct: () => stub,
  });
  const unwrap = (cfg) => {
    if (typeof cfg !== 'function') return cfg;
    // Config dạng function thường cần servicesManager; thử vài hình dạng đối số
    // thay vì chỉ `{}` rồi bỏ cuộc khi nó ném lỗi.
    const shapes = [
      () => cfg({ servicesManager: stub, extensionManager: stub, commandsManager: stub, hotkeysManager: stub }),
      () => cfg(stub),
      () => cfg({}),
      () => cfg(),
    ];
    for (const attempt of shapes) {
      try {
        const out = attempt();
        if (out && typeof out === 'object') return out;
      } catch (e) { /* thử hình dạng kế tiếp */ }
    }
    return null;
  };
  try {
    const cfg = unwrap(window.config);
    if (!cfg || typeof cfg !== 'object') return [];
    const sources = Array.isArray(cfg.dataSources) ? cfg.dataSources : [];
    const preferredName = cfg.defaultDataSourceName;
    const out = [];
    for (const ds of sources) {
      const c = (ds && ds.configuration) || {};
      const preferred = !!(ds && preferredName && ds.sourceName === preferredName);
      for (const key of ['qidoRoot', 'wadoRoot', 'wadoUriRoot']) {
        const v = c[key];
        if (typeof v === 'string' && v) out.push({ root: v, preferred: preferred });
      }
    }
    // Không có defaultDataSourceName thì coi dataSource đầu là đang dùng.
    if (!preferredName && out.length) out[0].preferred = true;
    return out;
  } catch (e) { return []; }
}
"""

# Dò NGAY TRONG FRAME cùng origin với ứng viên: thừa hưởng cookie, tránh CORS.
# Mỗi ứng viên có timeout riêng, cả lượt có deadline chung, thắng đầu tiên thì
# huỷ phần còn lại. Trả về cả THÂN đã xác minh (để phần liệt kê series không
# phải trông chờ event `on_response` kịp lưu) và CHẨN ĐOÁN từng URL.
_DICOMWEB_PROBE_JS = """
async ([items, perMs, totalMs]) => {
  const all = new AbortController();
  const deadline = setTimeout(() => all.abort(), totalMs);
  const diagnostics = [];

  const verify = (text, studyUid, requireStudyUid) => {
    let data;
    try { data = JSON.parse(text); } catch (e) { return 'không phải JSON'; }
    if (!Array.isArray(data)) return 'JSON không phải mảng';
    if (data.length === 0) return 'danh sách rỗng';
    for (const el of data) {
      if (!el || typeof el !== 'object') return 'phần tử không phải object';
      if (!el['0020000E']) return 'thiếu SeriesInstanceUID (0020000E)';
      const st = el['0020000D'];
      const got = st && st.Value && st.Value[0];
      if (got) {
        if (String(got) !== String(studyUid)) return 'trả về series của ca khác: ' + got;
      } else if (requireStudyUid) {
        // Truy vấn top-level lọc bằng query: server nào phớt lờ tham số sẽ trả
        // NGUYÊN kho. Không có 0020000D để đối chiếu thì không có gì chứng minh
        // nó đã lọc đúng ca — từ chối, vì đoán sai ở đây là tải nhầm bệnh nhân.
        return 'thiếu StudyInstanceUID (0020000D) nên không chứng minh được server đã lọc đúng ca';
      }
    }
    return '';
  };

  const attempt = async (item) => {
    const one = new AbortController();
    const timer = setTimeout(() => one.abort(), perMs);
    const relay = () => one.abort();
    all.signal.addEventListener('abort', relay);
    const fail = (reason) => {
      if (!diagnostics.some((d) => d.url === item.url)) {
        diagnostics.push({ url: item.url, error: reason });
      }
      return new Error(reason);
    };
    try {
      const headers = Object.assign(
        { Accept: 'application/dicom+json, application/json' }, item.headers || {});
      const r = await fetch(item.url, {
        credentials: 'include', headers: headers, signal: one.signal });
      if (!r.ok) throw fail('status ' + r.status);
      const ct = (r.headers.get('content-type') || '').toLowerCase();
      if (ct.indexOf('json') < 0) throw fail('content-type ' + (ct || 'rỗng'));
      const text = await r.text();
      const bad = verify(text, item.studyUid, item.requireStudyUid);
      if (bad) throw fail(bad);
      return { url: item.url, studyUid: item.studyUid,
               body: text.length > 4000000 ? '' : text };
    } catch (e) {
      if (e && e.name === 'AbortError') throw fail('quá hạn');
      if (e && e.name === 'TypeError') throw fail('không gọi được (CORS hoặc mạng)');
      throw (diagnostics.some((d) => d.url === item.url) ? e : fail(String((e && e.message) || e)));
    } finally {
      clearTimeout(timer);
      all.signal.removeEventListener('abort', relay);
    }
  };

  let winner = null;
  try {
    winner = await Promise.any(items.map(attempt));
  } catch (e) {
    winner = null;
  } finally {
    clearTimeout(deadline);
    all.abort();
  }
  return { winner: winner, diagnostics: diagnostics };
}
"""

# ĐOÁN theo thói quen triển khai, KHÔNG phải chuẩn: PS3.18 chuẩn hoá path SAU
# Base URI, còn Base URI thì mỗi nơi cấu hình một kiểu (Orthanc đổi được
# `DicomWeb.Root`, dcm4chee gắn `{AET}` vào path). Vì vậy đây là bậc chót.
_DICOMWEB_ROOT_GUESSES = (
    "/dicom-web", "/rs", "/dicomweb", "/wado-rs", "/api/dicomweb", "/ws/rest/v1",
)
_STUDY_UID_QUERY_KEYS = (
    "studyinstanceuids", "studyinstanceuid", "studyuid", "study", "studyid",
)
_PROBE_CANDIDATE_LIMIT = 24
_PROBE_PER_REQUEST_MS = 6000
_PROBE_TIER_S = 8.0
# Hạn TUYỆT ĐỐI cho cả lượt giải đường. Không có nó thì mỗi bậc × mỗi frame lại
# được một hạn riêng, và tổng thời gian nhân lên theo số bậc × số frame.
_PROBE_TOTAL_S = 12.0
# Số đường DICOMweb khác nhau được phép thử khi đường trước tải hỏng.
_MAX_DICOMWEB_PROFILES = 3

# Bậc bằng chứng: nhỏ hơn = chắc chắn hơn, và được thử TRƯỚC (xong bậc này mới
# sang bậc sau). Nhờ vậy root đã học không bị một root đoán mò trả lời nhanh hơn
# giành mất, và thường thì không bao giờ phải bắn tới bậc đoán.
_TIER_LEARNED, _TIER_SNIFFED, _TIER_CONFIG_ACTIVE, _TIER_CONFIG_OTHER, _TIER_GUESS = range(5)
_TIER_NAMES = {
    _TIER_LEARNED: "đã học",
    _TIER_SNIFFED: "URL QIDO đã thấy",
    _TIER_CONFIG_ACTIVE: "config viewer (datasource đang dùng)",
    _TIER_CONFIG_OTHER: "config viewer (datasource khác)",
    _TIER_GUESS: "đoán theo thói quen triển khai",
}


@dataclass
class _RootCandidate:
    root: str
    tier: int
    frame: Any = None
    style_hint: str = ""


def _url_origin(url: Any) -> str:
    from urllib.parse import urlparse

    try:
        pu = urlparse(str(url or ""))
        return f"{pu.scheme}://{pu.netloc}".casefold() if pu.netloc else ""
    except Exception:
        return ""


def _study_uid_candidates(cap: ViewerCapture, *urls: str) -> list[str]:
    """StudyInstanceUID có thể suy ra được, bằng chứng chắc nhất trước.

    Phải soi CẢ query của URL QIDO đã bắt được: link viewer thường chỉ là một
    token mờ (`/view?token=...`), còn ca nằm ở `/series?StudyInstanceUID=...`.
    Bỏ sót chỗ này thì đúng dạng top-level — dạng cần discovery nhất — lại là
    dạng không bao giờ discovery được.
    """
    from urllib.parse import urlparse, parse_qs

    found: list[str] = []

    def add(value: Any) -> None:
        text = str(value or "").strip()
        # UID DICOM chỉ gồm chữ số và dấu chấm; lọc sớm để không đi dò bằng rác
        # (và để một query độc hại không lái được đường dò đi nơi khác).
        if text and re.fullmatch(r"[0-9.]{5,64}", text) and text not in found:
            found.append(text)

    add(_dicomweb_study_from_qido(cap.qido_series))
    for url in (cap.qido_series, *urls):
        try:
            parsed = urlparse(str(url or ""))
        except Exception:
            continue
        # Viewer dùng hash router đặt tham số SAU dấu "#", nên `parsed.query`
        # rỗng và ca nằm trong fragment: https://p/#/viewer?StudyInstanceUIDs=…
        queries = [parsed.query]
        if parsed.fragment and "?" in parsed.fragment:
            queries.append(parsed.fragment.split("?", 1)[1])
        for raw_query in queries:
            try:
                query = parse_qs(raw_query)
            except Exception:
                continue
            for key, values in query.items():
                if key.casefold() in _STUDY_UID_QUERY_KEYS:
                    for value in values:
                        # OHIF cho phép nhiều study ngăn bởi dấu phẩy.
                        for piece in str(value).split(","):
                            add(piece)
    return found


def _frames_of(page) -> list:
    try:
        return list(page.frames) or [page]
    except Exception:
        return [page]


def _frame_for_origin(page, origin: str, fallback=None):
    """Frame cùng origin với ứng viên — để `fetch` không vướng CORS.

    Wrapper và OHIF hay khác origin: đọc được root trong iframe nhưng lại bắn dò
    từ trang cha thì rơi thẳng vào CORS.
    """
    if origin:
        for frame in _frames_of(page):
            try:
                if _url_origin(frame.url) == origin:
                    return frame
            except Exception:
                continue
    return fallback if fallback is not None else page


def _dicomweb_root_candidates(page, cap: ViewerCapture, viewer_url: str,
                              log: LogFn) -> list[_RootCandidate]:
    """Các rs_base đáng thử, kèm bậc bằng chứng và frame nên dò từ đó."""
    from urllib.parse import urlparse, urljoin

    out: list[_RootCandidate] = []
    seen: set[str] = set()

    def add(value: Any, tier: int, origin_url: str = "", frame=None, style_hint: str = "") -> None:
        text = str(value or "").strip()
        if not text:
            return
        if not text.startswith(("http://", "https://")):
            if not origin_url:
                return
            text = urljoin(origin_url, text)
        text = text.rstrip("/")
        # Root trỏ thẳng vào một ca thì cắt về gốc dùng chung được.
        if "/studies/" in text:
            text = text.split("/studies/")[0].rstrip("/")
        if not text or text in seen:
            return
        seen.add(text)
        out.append(_RootCandidate(
            root=text, tier=tier,
            frame=_frame_for_origin(page, _url_origin(text), frame),
            style_hint=style_hint,
        ))

    # Bậc 0 — đã học được cho chính dạng link này.
    learned_root, learned_style = pacs_strategy_store.get_dicomweb_hint(cap.strategy_fingerprint)
    add(learned_root, _TIER_LEARNED, style_hint=learned_style)

    # Bậc 1 — chính URL QIDO đã bắt được, kể cả khi không tách nổi studyUID.
    if cap.qido_series:
        try:
            pu = urlparse(cap.qido_series)
            path = pu.path.split("/studies/")[0]
            for suffix in ("/series", "/instances"):
                if path.endswith(suffix):
                    path = path[: -len(suffix)]
            add(f"{pu.scheme}://{pu.netloc}{path}", _TIER_SNIFFED)
        except Exception:
            pass

    # Bậc 2/3 — config viewer, đọc ở MỌI frame (viewer hay nằm trong iframe).
    for frame in _frames_of(page):
        try:
            entries = frame.evaluate(_OHIF_CONFIG_JS)
        except Exception:
            continue
        if not entries:
            continue
        frame_url = ""
        try:
            frame_url = frame.url
        except Exception:
            pass
        log(f"      Đọc được {len(entries)} root từ config viewer (OHIF).")
        for entry in entries:
            if isinstance(entry, dict):
                root, preferred = entry.get("root"), bool(entry.get("preferred"))
            else:
                root, preferred = entry, False
            add(root, _TIER_CONFIG_ACTIVE if preferred else _TIER_CONFIG_OTHER,
                origin_url=frame_url or viewer_url, frame=frame)

    # Bậc 4 — lưới cuối, đoán trên origin của trang.
    origin = ""
    try:
        origin = _url_origin(page.url or viewer_url)
    except Exception:
        pass
    if origin:
        add(origin, _TIER_GUESS)
        for guess in _DICOMWEB_ROOT_GUESSES:
            add(origin + guess, _TIER_GUESS)
    out.sort(key=lambda c: c.tier)
    return out


def _probe_headers_for(cap: ViewerCapture, root: str) -> dict:
    """Header phiên đã quan sát, CHỈ gửi lại cho đúng origin đã bắt được nó.

    Bắn `Authorization` của viện A sang một root đoán mò ở origin khác là làm lộ
    token cho bên thứ ba, nên chỗ này khoá theo origin chứ không gửi bừa.
    """
    return _session_headers_for(cap, root)


def _probe_passes(candidate: _RootCandidate) -> tuple[tuple[str, ...], ...]:
    """Các lượt dò cho một root, theo thứ tự đáng thử.

    Có `style_hint` đã học thì thử đúng nó TRƯỚC — nhưng vẫn phải còn lượt cho
    style kia: recipe cũ ghi `toplevel` mà server nay chỉ đáp ứng `hierarchical`
    thì loại thẳng một root hoàn toàn hợp lệ, và vì root bị khử trùng lặp toàn
    cục nên nó không xuất hiện lại ở bậc sau nữa.
    """
    both = ("hierarchical", "toplevel")
    if candidate.style_hint in both:
        other = tuple(s for s in both if s != candidate.style_hint)
        return ((candidate.style_hint,), other)
    return (both,)


def resolve_dicomweb_access(page, cap: ViewerCapture, viewer_url: str,
                            log: LogFn, stop: Callable[[], bool],
                            exclude: Optional[set[tuple[str, str]]] = None,
                            deadline_s: float = _PROBE_TOTAL_S) -> Optional[DicomWebProfile]:
    """Giải đường vào DICOMweb rồi ghi thẳng kết quả ĐÃ XÁC MINH vào `cap`.

    Dùng chung cho cả `download_all()` và `discover_viewer_series()`: cả hai đều
    cần đúng một thứ, và cả hai đều không được phụ thuộc vào việc event
    `on_response` có kịp lưu thân manifest hay không — nên thân đã xác minh được
    lấy thẳng từ kết quả dò.

    `exclude` là các cặp (rs_base, query_style) đã thử mà tải hỏng — để lượt sau
    đi tìm đường KHÁC thay vì trả lại đúng cái vừa thất bại.

    `deadline_s` là hạn TUYỆT ĐỐI cho cả lượt giải. Không có nó thì mỗi bậc ×
    mỗi frame lại được một deadline riêng và tổng thời gian nhân lên nhiều lần.
    """
    excluded = set(exclude or ())
    if stop():
        return None
    if cap.dicomweb_profile is not None:
        if (cap.dicomweb_profile.rs_base, cap.dicomweb_profile.query_style) not in excluded:
            return cap.dicomweb_profile
        cap.dicomweb_profile = None
    study_uids = _study_uid_candidates(cap, viewer_url, getattr(page, "url", "") or "")
    if not study_uids:
        log("      Không suy ra được StudyInstanceUID → không dò DICOMweb.")
        return None

    candidates = _dicomweb_root_candidates(page, cap, viewer_url, log)
    if not candidates:
        return None

    started = time.monotonic()
    budget = getattr(cap, "budget", None)

    def _time_left() -> float:
        left = deadline_s - (time.monotonic() - started)
        if budget is not None:
            try:
                if budget.is_expired():
                    return 0.0
            except Exception:
                pass
        return left

    budget_left = _PROBE_CANDIDATE_LIMIT
    all_diagnostics: list[dict] = []
    # (bậc, lượt style) — bậc trước xong mới sang bậc sau, và trong một bậc thì
    # lượt style đã học chạy trước lượt style còn lại.
    plan: list[tuple[int, int]] = sorted({
        (c.tier, index)
        for c in candidates
        for index in range(len(_probe_passes(c)))
    })
    for tier, pass_index in plan:
        if stop() or budget_left <= 0 or _time_left() <= 0:
            break
        by_frame: dict[int, tuple[Any, list[dict]]] = {}
        for candidate in (c for c in candidates if c.tier == tier):
            passes = _probe_passes(candidate)
            if pass_index >= len(passes):
                continue
            headers = _probe_headers_for(cap, candidate.root)
            for study in study_uids:
                for style in passes[pass_index]:
                    if budget_left <= 0:
                        break
                    if (candidate.root, style) in excluded:
                        continue
                    profile = DicomWebProfile(candidate.root, study, style)
                    frame = candidate.frame if candidate.frame is not None else page
                    bucket = by_frame.setdefault(id(frame), (frame, []))[1]
                    bucket.append({
                        "url": profile.series_search_url(),
                        "studyUid": study,
                        # Dạng phân cấp đã bị chính path khoá vào đúng ca; dạng
                        # top-level lọc bằng query nên PHẢI có 0020000D để chứng
                        # minh server thật sự đã lọc.
                        "requireStudyUid": style == "toplevel",
                        "headers": headers,
                        "_root": candidate.root,
                        "_style": style,
                        "_study": study,
                    })
                    budget_left -= 1

        for frame, items in by_frame.values():
            left = _time_left()
            if stop() or not items or left <= 0:
                continue
            # Mỗi frame chỉ được phần thời gian CÒN LẠI của cả lượt.
            frame_ms = int(max(0.0, min(left, _PROBE_TIER_S)) * 1000)
            per_ms = min(_PROBE_PER_REQUEST_MS, frame_ms)
            if frame_ms <= 0:
                continue
            log(f"      Dò {len(items)} đường ở bậc «{_TIER_NAMES.get(tier, tier)}» "
                f"({frame_ms / 1000:.0f}s)…")
            payload = [[{k: v for k, v in item.items() if not k.startswith("_")}
                        for item in items], per_ms, frame_ms]
            try:
                result = frame.evaluate(_DICOMWEB_PROBE_JS, payload)
            except Exception as exc:
                log(f"      Dò lỗi ở bậc này ({exc}).")
                continue
            result = result or {}
            all_diagnostics.extend(result.get("diagnostics") or [])
            winner = result.get("winner")
            if not winner:
                continue
            for item in items:
                if item["url"] != winner.get("url"):
                    continue
                profile = DicomWebProfile(
                    rs_base=item["_root"], study_uid=item["_study"],
                    query_style=item["_style"], source="probe",
                )
                cap.dicomweb_profile = profile
                # Ghi thẳng vào cap để phần liệt kê series dùng được ngay.
                cap.qido_series = winner.get("url") or cap.qido_series
                body = winner.get("body") or ""
                if body:
                    cap.qido_series_body = body.encode("utf-8")
                log(f"      ✓ Giải được: {_redact_url(profile.rs_base)} "
                    f"(truy vấn {profile.query_style}, bậc «{_TIER_NAMES.get(tier, tier)}»).")
                return profile

    _log_probe_diagnostics(all_diagnostics, log)
    return None


def _log_probe_diagnostics(diagnostics: list[dict], log: LogFn) -> None:
    """Nói rõ vì sao dò trượt — nhất là khi lý do là 'phải đăng nhập'.

    Chỉ gặp 401/403 mà lặng lẽ rơi xuống DOM sẽ tạo cảm giác app đang cố tải,
    trong khi thứ còn thiếu là quyền chứ không phải đường đi.
    """
    if not diagnostics:
        log("      Không đường nào trả về danh sách series hợp lệ.")
        return
    codes = [str(d.get("error") or "") for d in diagnostics]
    if codes and all(("status 401" in c) or ("status 403" in c) for c in codes):
        log("      !!! Mọi đường DICOMweb đều bị từ chối (401/403): thiếu QUYỀN, "
            "không phải thiếu đường. Viewer nhiều khả năng gắn token bằng mã "
            "riêng mà phần dò không đọc được.")
        return
    log(f"      Không đường nào hợp lệ. {len(diagnostics)} lý do gần nhất:")
    for entry in diagnostics[:8]:
        log(f"        - {_redact_url(entry.get('url'))} → {entry.get('error')}")


def _series_manifest_adapter(cap: ViewerCapture) -> Optional[PacsAdapter]:
    """Adapter đủ dữ kiện để LIỆT KÊ series."""
    ready = [a for a in PACS_ADAPTERS if a.has_series_manifest(cap)]
    return max(ready, key=lambda a: a.priority) if ready else None


# Chờ manifest theo NHỊP CỦA TRANG, không theo đồng hồ cứng: MSC PACS mất ~15s
# mới gọi API manifest, nên hạn cứng 12s cũ khiến app bỏ cuộc ngay trước vạch rồi
# rơi xuống chế độ mô phỏng (chỉ bắt được ảnh màn hình). Ngược lại, trang hỏng
# hoặc không có manifest thì im lặng rất sớm — bám vào lúc mạng lặng đi để thôi
# chờ, nhanh như cũ với trang chết mà vẫn kịp với viewer chậm.
_MANIFEST_WAIT_MIN_S = 8.0
_MANIFEST_WAIT_MAX_S = 30.0
_MANIFEST_IDLE_S = 4.0


def _inspect_zfp(page, cap: ViewerCapture) -> None:
    """Đọc cấu trúc study mà móc WebSocket nhặt được trên trang.

    Chỉ dòng GE ZFP mới cần soi trang: nó không phát manifest nào qua HTTP nên
    `_observe_response()` không bao giờ thấy gì.
    """
    if cap.zfp is not None:
        return
    try:
        data = page.evaluate(
            "() => (window.__zfp && window.__zfp.groups.length)"
            " ? {groups: window.__zfp.groups, study: window.__zfp.study} : null"
        )
    except Exception:
        return
    if data and data.get("groups"):
        cap.zfp = data
        cap.zfp_page = page


def _wait_for_viewer_manifest(page, found: Callable[[], bool],
                              stop: Callable[[], bool], poll_ms: int = 400) -> None:
    last_activity = time.monotonic()

    def _touch(*_args) -> None:
        nonlocal last_activity
        last_activity = time.monotonic()

    page.on("request", _touch)
    page.on("response", _touch)
    started = time.monotonic()
    try:
        while not (stop() or found()):
            now = time.monotonic()
            elapsed = now - started
            if elapsed >= _MANIFEST_WAIT_MAX_S:
                return
            if elapsed >= _MANIFEST_WAIT_MIN_S and now - last_activity >= _MANIFEST_IDLE_S:
                return
            page.wait_for_timeout(poll_ms)
    finally:
        for event in ("request", "response"):
            try:
                page.remove_listener(event, _touch)
            except Exception:
                pass


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
    budget = DownloadBudget()
    identity_guard = StudyIdentityGuard()
    tracker = ActiveSocketTracker()
    selected_series = (
        {str(value) for value in selected_series_ids if str(value).strip()}
        if selected_series_ids is not None else None
    )
    if selected_series_ids is not None and not selected_series:
        raise ValueError("Chế độ tải chọn lọc cần ít nhất một series.")
    seen_hashes: set[str] = set()
    seen_sop_uids: set[str] = set()
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
                valid, reason, existing_ds = _validate_dicom_bytes_and_dataset(raw_bytes)
                if not valid:
                    log(f"  [Dọn dẹp file hỏng cũ] {f.name}: {reason}")
                    try:
                        f.unlink()
                    except Exception:
                        pass
                    continue
                existing_study_uid = getattr(existing_ds, "StudyInstanceUID", "") if existing_ds is not None else ""
                if not identity_guard.accept(existing_study_uid):
                    raise ValueError(
                        "Folder DICOM đang chứa nhiều StudyInstanceUID; dừng để tránh gộp nhầm ca."
                    )
                existing_sop_uid = str(getattr(existing_ds, "SOPInstanceUID", "") or "").strip() if existing_ds is not None else ""
                if existing_sop_uid:
                    seen_sop_uids.add(existing_sop_uid)
                seen_hashes.add(hashlib.sha1(raw_bytes).hexdigest())
                stats.dicom += 1
            except ValueError:
                raise
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
        if bool(should_stop and should_stop()):
            tracker.interrupt_all()
            return True
        return False

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
            incoming_study_uid = getattr(parsed_ds, "StudyInstanceUID", "") if parsed_ds is not None else ""
            if not identity_guard.accept(incoming_study_uid):
                log(
                    "  [Từ chối DICOM khác study] StudyInstanceUID không khớp với file đầu tiên của phiên tải."
                )
                return False
        incoming_sop_uid = str(getattr(parsed_ds, "SOPInstanceUID", "") or "").strip() if parsed_ds is not None else ""
        h = hashlib.sha1(data).hexdigest()
        with save_lock:
            if ext == "dcm" and not output_resolved and dicom_output_resolver is not None:
                dicom_dir = Path(dicom_output_resolver(data))
                raw_jpg_dir = dicom_dir.parent / "RAW_JPG"
                output_resolved = True
            if h in seen_hashes or (incoming_sop_uid and incoming_sop_uid in seen_sop_uids):
                stats.duplicates += 1
                budget.touch()
                return True
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
                stats.dicom += 1
                if fidelity == "reconstructed":
                    stats.reconstructed_dicom += 1
                else:
                    stats.original_dicom += 1
            elif ext == "jpg":
                idx = stats.jpg + 1
                raw_jpg_dir.mkdir(parents=True, exist_ok=True)
                (raw_jpg_dir / f"img_{idx:05d}.jpg").write_bytes(data)
                stats.jpg = idx
            else:
                idx = stats.png + 1
                raw_jpg_dir.mkdir(parents=True, exist_ok=True)
                (raw_jpg_dir / f"img_{idx:05d}.png").write_bytes(data)
                stats.png = idx
            seen_hashes.add(h)
            if incoming_sop_uid:
                seen_sop_uids.add(incoming_sop_uid)
            n = stats.total()
            budget.touch()
        if ext == "dcm" and n % 25 == 0:
            log(f"  ...đã tải {n} ảnh (DICOM: {stats.dicom})")
        return True

    # Việc nhận diện dòng PACS nằm hết trong PACS_ADAPTERS ở trên.
    cap = ViewerCapture(
        budget=budget,
        strategy_fingerprint=compute_url_fingerprint(url),
        existing_sop_uids=seen_sop_uids,
        socket_tracker=tracker,
    )
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
            _note_seen_url(cap, response.url)
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
        try:
            # ignore_https_errors: chấp nhận chứng chỉ tự ký của PACS (HTTPS cổng lạ).
            context = browser.new_context(viewport={"width": 1600, "height": 1000},
                                          ignore_https_errors=True)
            context.add_init_script(_ZFP_HOOK)
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
                    return stats
            except Exception:
                pass

            try:
                if _is_ris_wrapper_url(url) and _page_is_ris_login(page):
                    log("!!! Link này là TRANG WRAPPER của RIS và đang hiện màn hình ĐĂNG NHẬP. "
                        "Trình tải không có cookie phiên nên không thấy ảnh. Hãy dùng chức năng "
                        "'Tìm theo mã BN' (app tự xin link viewer), hoặc mở link trên trình duyệt "
                        "rồi copy đúng link viewer bên trong.")
                    return stats
            except Exception:
                pass

            log("Đang dò manifest của viewer...")
            def _seen_manifest() -> bool:
                _inspect_zfp(page, cap)
                return _have_manifest() or bool(cap.session_error)

            _wait_for_viewer_manifest(page, _seen_manifest, stop)

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
                    return stats

            try:
                from urllib.parse import urlparse as _up
                pu = _up(page.url)
                cap.host = f"{pu.scheme}://{pu.netloc}"
                cap.cookies = context.cookies()
            except Exception:
                pass

            # Các đường DICOMweb đã thử mà không xong — để lượt sau đi tìm đường
            # KHÁC (root từ config / root đã học) chứ không trả lại đúng cái vừa
            # hỏng. Theo dõi mỗi tên adapter là quá thô cho việc này.
            spent_dicomweb: set[tuple[str, str]] = set()

            def _try_resolve_dicomweb(reason: str) -> list[PacsAdapter]:
                """Giải đường DICOMweb rồi tính lại danh sách adapter sẵn sàng."""
                log(reason)
                try:
                    resolved = resolve_dicomweb_access(
                        page, cap, url, log, stop, exclude=spent_dicomweb)
                except Exception as exc:
                    log(f"      Bỏ qua bước giải DICOMweb ({exc}).")
                    return []
                if resolved is None:
                    return []
                return _ready_adapters(cap, url=url)

            ready_list = _ready_adapters(cap, url=url)
            if not ready_list:
                ready_list = _try_resolve_dicomweb(
                    "Chưa adapter nào sẵn sàng → thử giải đường vào DICOMweb.")
            if not ready_list:
                _log_discovery_failure(cap, log)
            tried_adapters: set[str] = set()

            def _run_adapters(adapters: list[PacsAdapter]) -> None:
                nonlocal used_manifest
                used_manifest = True
                log(f"✓ Có {len(adapters)} adapter sẵn sàng → thử lần lượt trong cùng phiên viewer.")
                for adapter in adapters:
                    if stop() or budget.is_hard_expired():
                        break
                    budget.touch()
                    tried_adapters.add(adapter.name.lower())
                    if adapter.name.lower() == "dicomweb":
                        spent = cap.dicomweb_profile or DicomWebProfile.from_qido_url(
                            cap.qido_series)
                        if spent is not None:
                            spent_dicomweb.add((spent.rs_base, spent.query_style))
                    log(f"✓ Khởi chạy adapter: {adapter.name} → tải trực tiếp bằng API/WebSocket.")
                    t0 = time.monotonic()
                    try:
                        adapter.download(cap, save_body, stats, log, stop, selected_series)
                        latency_ms = (time.monotonic() - t0) * 1000.0
                        stats.outcomes.append(StrategyOutcome(
                            status=stats.status,
                            expected=stats.expected,
                            completed=stats.completed_tasks or stats.dicom,
                            failed=stats.failed,
                            strategy=adapter.name,
                            adapter=adapter.name,
                            study_uid=identity_guard.locked_study_uid,
                            elapsed_ms=latency_ms,
                            retryable=not stats.is_complete() and not budget.is_hard_expired(),
                        ))
                        is_dicomweb = adapter.name.lower() == "dicomweb"
                        # Cả khi sniff tự lo được: rs_base đó vẫn đáng nhớ để
                        # ca sau ở cùng nơi khỏi phải dò lại từ đầu.
                        resolved = (
                            cap.dicomweb_profile
                            or DicomWebProfile.from_qido_url(cap.qido_series)
                        ) if is_dicomweb else None
                        pacs_strategy_store.save_recipe(
                            fingerprint=cap.strategy_fingerprint,
                            adapter=adapter.name,
                            preferred_routes=(stats.preferred_routes if is_dicomweb else None),
                            success=stats.is_complete(),
                            partial=stats.status in {"partial", "partial_unknown"},
                            failure_class=("timeout" if budget.is_expired() else "error") if stats.status == "failed" else "",
                            latency_ms=latency_ms,
                            dicomweb_base=(resolved.rs_base if resolved else ""),
                            dicomweb_query_style=(resolved.query_style if resolved else ""),
                        )
                        if stats.is_complete():
                            break
                    except Exception as e:
                        latency_ms = (time.monotonic() - t0) * 1000.0
                        stats.outcomes.append(StrategyOutcome(
                            status="failed", expected=stats.expected,
                            completed=stats.completed_tasks or stats.dicom,
                            failed=stats.failed, errors=[str(e)], strategy=adapter.name,
                            adapter=adapter.name, study_uid=identity_guard.locked_study_uid,
                            elapsed_ms=latency_ms, retryable=not budget.is_hard_expired(),
                        ))
                        log(f"  Lỗi adapter {adapter.name}: {e}")
                        pacs_strategy_store.save_recipe(
                            fingerprint=cap.strategy_fingerprint, adapter=adapter.name,
                            success=False, failure_class=type(e).__name__, latency_ms=latency_ms,
                        )

            if ready_list:
                _run_adapters(ready_list)

            # Adapter hãng nhận ra link nhưng tải hỏng/thiếu thì DICOMweb vẫn có
            # thể là đường đi được — trước đây rơi thẳng xuống DOM heuristic nên
            # discovery mới chỉ vá được lúc KHÔNG nhận ra adapter nào, chứ chưa
            # phải lưới đỡ khi adapter đã nhận ra mà tải không xong.
            # Đường DICOMweb hỏng không có nghĩa là mọi đường DICOMweb đều hỏng:
            # style còn lại trên cùng root, rồi root khác từ config, đều đáng thử.
            # `spent_dicomweb` bảo đảm mỗi profile chỉ đi một lần nên không lặp
            # vô hạn; trần cứng ở đây để một PACS lạ không ngốn hết budget.
            for _ in range(_MAX_DICOMWEB_PROFILES):
                if stats.is_complete() or stop() or budget.is_hard_expired():
                    break
                before = len(spent_dicomweb)
                retry_list = [
                    adapter for adapter in _try_resolve_dicomweb(
                        "Chưa đủ ảnh → thử giải thêm một đường DICOMweb khác.")
                    if adapter.name.lower() == "dicomweb"
                    or adapter.name.lower() not in tried_adapters
                ]
                if not retry_list:
                    break
                _run_adapters(retry_list)
                # Không tiêu thêm profile nào nghĩa là đã hết đường để thử.
                if len(spent_dicomweb) == before:
                    break

            if not stats.is_complete() and not stop() and not budget.is_hard_expired():
                if used_manifest and selected_series is not None:
                    log("Chưa đủ ảnh nhưng đang tải series chọn lọc; không mô phỏng mù để tránh lấy nhầm series ngoài phạm vi.")
                else:
                    log("Chưa đủ ảnh → mô phỏng viewer để kích hoạt thêm request DICOM còn ẩn.")
                    budget.touch()
                    capture_bodies = True
                    page.wait_for_timeout(1500)
                    _drive_viewer_dom_heuristic(
                        page, log, stats, max_slices_per_series, stop,
                        selected_series_ids=selected_series,
                    )
                    log(f"Chờ {settle_ms/1000:.0f}s để bắt nốt ảnh còn lại...")
                    try:
                        page.wait_for_load_state("networkidle", timeout=settle_ms)
                    except Exception:
                        page.wait_for_timeout(settle_ms)
        finally:
            try:
                tracker.interrupt_all()
            except Exception:
                pass
            try:
                browser.close()
            except Exception:
                pass

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
    # Fingerprint phải có ngay từ đây, nếu không `get_dicomweb_hint()` luôn tra
    # khoá rỗng và đường chọn series không hưởng được gì từ cái đã học.
    cap = ViewerCapture(strategy_fingerprint=compute_url_fingerprint(url))

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
        context.add_init_script(_ZFP_HOOK)
        page = context.new_page()
        page.on("response", on_response)
        log("      Bước 2/2: Đang đọc danh sách series từ viewer (chưa tải file ảnh)...")
        try:
            page.goto(url, wait_until="domcontentloaded", timeout=60000)
        except Exception as exc:
            log(f"  Cảnh báo khi mở viewer: {exc}")

        def _seen_series() -> bool:
            _inspect_zfp(page, cap)
            return bool(_series_manifest_adapter(cap) or cap.session_error)

        _wait_for_viewer_manifest(page, _seen_series, stop)

        if stop():
            browser.close()
            return {"source": "stopped", "series": [], "selectable": False}
        if cap.session_error:
            code = cap.session_error
            browser.close()
            raise ValueError(f"Link viewer hết hạn hoặc session bị từ chối (HTTP {code}).")

        # Cùng một lưới đỡ như `download_all()`: nếu chỉ sniff thì "tải tất cả"
        # chạy được nhưng bảng chọn series lại trống — cùng một link, hai kết quả
        # khác nhau. `resolve_dicomweb_access()` ghi thẳng thân đã xác minh vào
        # `cap` nên phần liệt kê không phải trông chờ event `on_response`.
        if _series_manifest_adapter(cap) is None:
            try:
                resolve_dicomweb_access(page, cap, url, log, stop)
            except Exception as exc:
                log(f"      Bỏ qua bước giải DICOMweb ({exc}).")

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


def _shutdown_executor(ex, wait: bool) -> None:
    """Đóng pool; khi huỷ thì trả về ngay, bỏ luôn các task chưa kịp chạy."""
    if wait:
        ex.shutdown(wait=True)
        return
    try:
        ex.shutdown(wait=False, cancel_futures=True)
    except TypeError:  # Python < 3.9 chưa có cancel_futures
        ex.shutdown(wait=False)


def _run_fetch_tasks(tasks, fetch, stats: DownloadStats, log: LogFn,
                     stop: Callable[[], bool], budget: Optional[DownloadBudget] = None,
                     tracker: Optional[ActiveSocketTracker] = None,
                     passes: int = 3) -> None:
    """Tải song song và LÀM LẠI phần hỏng, rồi ghi lại số còn hỏng.

    Mạng bệnh viện chập chờn nên vài ảnh lỗi lẻ là chuyện thường; im lặng bỏ qua
    chúng chính là kiểu mất ảnh nguy hiểm nhất với dùng lâm sàng. Ở đây mỗi ảnh
    hỏng được giữ lại thử tiếp, số còn hỏng cuối cùng vào `stats.failed`.
    """
    from concurrent.futures import ThreadPoolExecutor, wait, FIRST_COMPLETED

    def attempt(task) -> bool:
        if stop():
            if tracker is not None:
                tracker.interrupt_all()
            return True  # dừng theo lệnh người dùng, không tính là ảnh hỏng
        if budget is not None and budget.is_expired():
            if tracker is not None:
                tracker.interrupt_all()
            return False
        try:
            ok = bool(fetch(task))
            if ok and budget is not None:
                budget.touch()
            return ok
        except (InterruptedError, ConnectionResetError, OSError):
            if stop() and tracker is not None:
                tracker.interrupt_all()
            return False
        except Exception:
            return False

    original_count = len(tasks)
    pending = list(tasks)
    for round_no in range(1, max(1, passes) + 1):
        if not pending or stop() or (budget is not None and budget.is_expired()):
            if (stop() or (budget is not None and budget.is_expired())) and tracker is not None:
                tracker.interrupt_all()
            break
        if round_no > 1:
            log(f"  ↻ Tải lại {len(pending)} ảnh bị hỏng (lượt {round_no}/{passes})...")
            for _ in range(15):
                if stop() or (budget is not None and budget.is_expired()):
                    if tracker is not None:
                        tracker.interrupt_all()
                    break
                time.sleep(0.1)
            if stop() or (budget is not None and budget.is_expired()):
                break

        # Không dùng `with ThreadPoolExecutor(...)`: lúc thoát khối `with`, Python
        # gọi `shutdown(wait=True)` và chặn cho tới khi worker cuối cùng xong. Khi
        # đó watchdog phát hiện huỷ trong 50ms cũng vô nghĩa — hàm vẫn không trả về
        # được, và người dùng vẫn thấy treo đúng bằng `timeout` của socket.
        ex = ThreadPoolExecutor(max_workers=6)
        aborted = False
        try:
            future_to_task = {ex.submit(attempt, task): task for task in pending}
            uncompleted = set(future_to_task.keys())
            completed_success = set()
            while uncompleted:
                if stop() or (budget is not None and budget.is_expired()):
                    if tracker is not None:
                        tracker.interrupt_all()
                    aborted = True
                    break
                done, uncompleted = wait(uncompleted, timeout=0.05, return_when=FIRST_COMPLETED)
                for f in done:
                    try:
                        if f.result():
                            completed_success.add(f)
                    except Exception:
                        pass

            if not aborted and (stop() or (budget is not None and budget.is_expired())):
                if tracker is not None:
                    tracker.interrupt_all()
                aborted = True
            pending = [task for f, task in future_to_task.items() if f not in completed_success]
        finally:
            _shutdown_executor(ex, wait=not aborted)
        if aborted:
            break

    if stop():
        if tracker is not None:
            tracker.interrupt_all()
        stats.cancelled = True
    stats.failed = 0 if stop() else len(pending)
    stats.completed_tasks = max(stats.completed_tasks, original_count - len(pending))


def _read_response_chunks(response, budget: Optional[DownloadBudget] = None,
                          stop: Optional[Callable[[], bool]] = None,
                          tracker: Optional[ActiveSocketTracker] = None,
                          chunk_size: int = 1024 * 1024) -> bytes:
    """Read a bounded socket response while observing cancel/deadline between chunks.

    The socket timeout on ``urlopen`` remains the upper bound while one ``read``
    is blocked; this helper prevents a large response from hiding progress or
    ignoring cancel for the entire body.
    """
    if tracker is not None and response is not None:
        tracker.track(response)
    chunks: list[bytes] = []
    try:
        while True:
            if stop is not None and stop():
                if tracker is not None:
                    tracker.interrupt_all()
                raise InterruptedError("Download cancelled")
            if budget is not None and budget.is_expired():
                if tracker is not None:
                    tracker.interrupt_all()
                raise TimeoutError("Download budget expired")
            try:
                chunk = response.read(chunk_size)
            except (OSError, ConnectionResetError, http.client.RemoteDisconnected):
                if stop is not None and stop():
                    raise InterruptedError("Download cancelled")
                raise
            except TypeError:
                # Small deterministic test doubles and a few file-like wrappers
                # expose only ``read()``; real HTTPResponse supports sized reads.
                chunk = response.read()
                if chunk:
                    chunks.append(chunk)
                    if budget is not None:
                        budget.touch()
                break
            if not chunk:
                break
            chunks.append(chunk)
            if budget is not None:
                budget.touch()
        return b"".join(chunks)
    finally:
        if tracker is not None and response is not None:
            tracker.release(response)


def _report_download_result(stats: DownloadStats, expected: int, log: LogFn,
                            stop: Callable[[], bool]) -> None:
    """Kết luận đủ/thiếu. Thiếu thì phải nói THẲNG là thiếu."""
    expected = int(expected or 0)
    stats.expected = max(stats.expected, expected)
    if stop():
        stats.cancelled = True
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

    tracker = captured.get("socket_tracker") or ActiveSocketTracker()
    _pass_for = _passport_builder(captured)
    opener = tracker.opener(sslctx, passport=_pass_for)

    def fetch_one(u) -> bool:
        if stop():
            return True
        with opener.open(urllib.request.Request(u, headers=_pass_for(u)), timeout=45) as r:
            return save_body(_read_response_chunks(r, captured.get("budget"), stop, tracker=tracker))

    _run_fetch_tasks(tasks, fetch_one, stats, log, stop, captured.get("budget"), tracker=tracker)
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
    _pass_for = _passport_builder(captured)
    sslctx = ssl.create_default_context()
    sslctx.check_hostname = False
    sslctx.verify_mode = ssl.CERT_NONE

    log(f"Manifest (vrpacs): {n_series} series, {len(tasks)} ảnh. "
        f"Đang tải trực tiếp (6 luồng song song)...")

    tracker = captured.get("socket_tracker") or ActiveSocketTracker()
    opener = tracker.opener(sslctx, passport=_pass_for)

    def fetch_one(u) -> bool:
        if stop():
            return True
        req = urllib.request.Request(u, headers=_pass_for(u))
        with opener.open(req, timeout=45) as r:
            return save_body(_read_response_chunks(r, captured.get("budget"), stop, tracker=tracker))

    _run_fetch_tasks(tasks, fetch_one, stats, log, stop, captured.get("budget"), tracker=tracker)
    _report_download_result(stats, len(tasks), log, stop)


def _download_via_zfp(captured, save_body, stats,
                      log: LogFn, stop: Callable[[], bool],
                      selected_series: Optional[set[str]] = None) -> None:
    """
    Hứng ảnh do chính viewer GE ZFP nạp rồi dựng lại DICOM Part-10.

    KHÔNG hỏi ảnh — server từ chối mọi lệnh gửi từ ngoài (xem ghi chú ở phần
    `_ZFP_HOOK`). Thứ duy nhất làm nó phát pixel là chính viewer nạp study, và
    lúc đó nó nạp gần trọn ca. Nên ở đây ta ngồi hứng theo thứ tự VIEWER bơm ra,
    không phải thứ tự mình muốn; hết ảnh mà còn thiếu thì cho trang nạp lại.

    Chạy TUẦN TỰ: mọi thứ đi qua đúng một trang Playwright, mà `page` thì không
    dùng được từ nhiều luồng.
    """
    import base64

    page = captured.get("zfp_page")
    data = captured.get("zfp") or {}
    groups = data.get("groups") or []
    if page is None or not groups:
        log("  Chưa gắn được móc vào viewer GE ZFP — bỏ qua.")
        return

    choices = _zfp_series_choices(data)
    plan, n_series = [], 0
    for index, group in enumerate(groups):
        if selected_series is not None and choices[index]["id"] not in selected_series:
            continue
        n_series += 1
        for sop in (group.get("dicomSops") or []):
            if sop.get("sopInstanceUid"):
                plan.append((group, sop))

    if selected_series is not None and n_series == 0:
        raise ValueError("Không còn tìm thấy series đã chọn trong cấu trúc ZFP mới.")

    study = data.get("study") or {}
    wanted = {sop["sopInstanceUid"]: (group, sop) for group, sop in plan}
    total = len(plan)
    log(f"Manifest (GE ZFP): {n_series} series, {total} ảnh. "
        f"Đang hứng ảnh do viewer bơm qua WebSocket...")

    frame_ct = "application/octet-stream; transfer-syntax=1.2.840.10008.1.2.1"
    saved, done, reloads, dry = 0, set(), 0, 0
    budget = captured.get("budget")
    while (not stop() and len(done) < total
           and not (budget is not None and budget.is_expired())):
        try:
            got = page.evaluate("(ms) => window.__zfp.take(ms)", _ZFP_TAKE_MS)
        except Exception as exc:
            log(f"  Mất kết nối với viewer: {exc}")
            break

        if got and got.get("b64"):
            dry = 0
            uid = got.get("sop") or ""
            if uid not in wanted or uid in done:
                continue                    # ảnh của series không chọn
            done.add(uid)
            group, sop = wanted[uid]
            meta_json = _zfp_meta_to_dicom_json(got.get("meta") or {}, sop, group, study)
            dicom = _dicom_from_meta_frames(meta_json, [base64.b64decode(got["b64"])], frame_ct)
            if dicom and save_body(dicom, fidelity="reconstructed"):
                saved += 1
                stats.completed_tasks = max(stats.completed_tasks, len(done))
                if budget is not None:
                    budget.touch()
                if saved % 25 == 0:
                    log(f"  ...đã lưu {saved}/{total} ảnh")
            else:
                stats.failed += 1
            continue

        # Hàng đợi cạn. Viewer chỉ bơm ảnh lúc nạp study, nên muốn lấy nốt phần
        # đã chảy qua trước khi mình kịp hứng thì phải cho nó nạp lại.
        dry += 1
        if dry == 1 and reloads < _ZFP_MAX_RELOADS:
            reloads += 1
            log(f"  Hết ảnh trong hàng đợi, còn thiếu {total - len(done)} — "
                f"nạp lại viewer để bơm lại (lần {reloads}/{_ZFP_MAX_RELOADS})...")
            if not _zfp_reload_viewer(page, log):
                break
            dry = 0
            continue
        if dry >= 3:
            break
        time.sleep(1.5)

    missing = total - len(done)
    if missing > 0 and not stop():
        stats.failed += missing
        log(f"  {missing} ảnh viewer không tự nạp — mở đúng series đó trong viewer rồi chạy lại.")
    _report_download_result(stats, total, log, stop)


def _download_via_vietmy(captured, save_body, stats,
                         log: LogFn, stop: Callable[[], bool],
                         selected_series: Optional[set[str]] = None) -> None:
    """
    Tải DICOM gốc của MSC PACS (vietmy.pmr.vn) theo manifest
    `ws.asmx/GetListImageFileInfo`.

    Mỗi ảnh trong manifest có sẵn `filePath` — link `ws/getfile.ashx` đã kèm
    `stoken` của chính link chia sẻ, trả về file .dcm nguyên bản của máy chụp.
    KHÔNG dùng `imagePath`: đó là JPEG viewer đã dựng sẵn, mất dải xám 12 bit.
    """
    import ssl
    import urllib.request

    try:
        study = _vietmy_study(captured["vietmy"])
    except Exception as e:
        log(f"  Lỗi đọc manifest VietMy ({e}) — bỏ qua.")
        return

    series_list = study.get("seriesList", []) or []
    choices = _vietmy_series_choices(captured["vietmy"])
    tasks, n_series = [], 0
    for index, series in enumerate(series_list):
        choice = choices[index]
        if selected_series is not None and choice["id"] not in selected_series:
            continue
        n_series += 1
        for item in (series.get("fileList", []) or []):
            url = item.get("filePath") or item.get("wanFilePath")
            if url:
                tasks.append(url)

    if selected_series is not None and n_series == 0:
        raise ValueError("Không còn tìm thấy series đã chọn trong manifest VietMy mới.")

    _pass_for = _passport_builder(captured)
    sslctx = ssl.create_default_context()
    sslctx.check_hostname = False
    sslctx.verify_mode = ssl.CERT_NONE

    log(f"Manifest (VietMy): {n_series} series, {len(tasks)} ảnh. "
        f"Đang tải DICOM gốc trực tiếp (6 luồng song song)...")

    tracker = captured.get("socket_tracker") or ActiveSocketTracker()
    opener = tracker.opener(sslctx, passport=_pass_for)

    def fetch_one(u) -> bool:
        if stop():
            return True
        req = urllib.request.Request(u, headers=_pass_for(u))
        with opener.open(req, timeout=45) as r:
            return save_body(_read_response_chunks(r, captured.get("budget"), stop, tracker=tracker))

    _run_fetch_tasks(tasks, fetch_one, stats, log, stop, captured.get("budget"), tracker=tracker)
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

    profile = captured.get("dicomweb_profile") or DicomWebProfile.from_qido_url(
        captured.get("qido_series")
    )
    if profile is None:
        log("  Không giải được đường vào DICOMweb (rs_base + studyUID) — bỏ qua."); return
    rs_base, study = profile.rs_base, profile.study_uid
    if profile.source != "sniff" or profile.is_toplevel:
        log(f"  Đường vào DICOMweb: {_redact_url(rs_base)} "
            f"(truy vấn {profile.query_style}, nguồn: {profile.source}).")

    if captured.get("wado_tmpl"):
        wp = urlparse(captured["wado_tmpl"])
        wado_base = f"{wp.scheme}://{wp.netloc}{wp.path}"
        wtmpl = {k: v[0] for k, v in parse_qs(wp.query).items()}
        order = ["wadouri", "wadors", "frames"]
    else:  # không có khuôn WADO-URI thật -> ưu tiên WADO-RS, dcm4chee để chót
        wado_base = rs_base.rsplit("/rs", 1)[0] + "/wado"
        wtmpl = {"requestType": "WADO", "contentType": "application/dicom", "transferSyntax": "*"}
        order = ["wadors", "frames", "wadouri"]

    learned_routes = pacs_strategy_store.get_preferred_routes(
        str(captured.get("strategy_fingerprint") or "")
    )
    learned_routes = [name for name in learned_routes if name in order]
    if learned_routes:
        order = learned_routes + [name for name in order if name not in learned_routes]
    route_lock = threading.Lock()
    budget = captured.get("budget")

    # "Giấy thông hành" dựng THEO TỪNG URL, không dựng một bộ dùng chung: sau
    # discovery thì `rs_base` có thể ở origin khác hẳn nơi bắt được token, và
    # `context.cookies()` thì chứa cookie của mọi domain đã ghé qua.
    _pass_for = _passport_builder(captured)

    sslctx = ssl.create_default_context()
    sslctx.check_hostname = False
    sslctx.verify_mode = ssl.CERT_NONE

    tracker = captured.get("socket_tracker") or ActiveSocketTracker()
    opener = tracker.opener(sslctx, passport=_pass_for)

    def get_raw(u, accept=None):
        if budget is not None and budget.is_expired():
            tracker.interrupt_all()
            raise TimeoutError("Download budget expired")
        if stop():
            tracker.interrupt_all()
            raise InterruptedError("Download cancelled")
        h = _pass_for(u)
        if accept:
            h["Accept"] = accept
        req = urllib.request.Request(u, headers=h)
        with opener.open(req, timeout=60) as r:
            data = _read_response_chunks(r, budget, stop, tracker=tracker)
            return data, (r.headers.get("Content-Type") or "")

    def get_json(u):
        body, _ = get_raw(u, accept="application/dicom+json, application/json")
        return json.loads(body.decode("utf-8", "replace"))

    def V(el, tag):
        return _dicom_json_value(el, tag)

    try:
        series = get_json(profile.series_search_url())
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
            insts = get_json(profile.instances_search_url(suid))
        except Exception:
            insts = []
        if not insts:
            try:
                insts = get_json(profile.series_metadata_url(suid))
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
            profile.study_instances_search_url(limit=100000),
            profile.study_instances_search_url(),
            profile.study_metadata_url(),
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

    inventory_total = len(tasks)
    skipped_count = 0
    existing_sops = captured.get("existing_sop_uids") or set()
    if existing_sops:
        pending_tasks = [t for t in tasks if str(t[1]).strip() not in existing_sops]
        skipped_count = len(tasks) - len(pending_tasks)
        if skipped_count > 0:
            log(f"  Thử lại: bỏ qua {skipped_count} ảnh đã có sẵn trong folder theo SOPInstanceUID.")
        tasks = pending_tasks

    pending_total = len(tasks)
    selected_label = " series ảnh đã chọn" if selected_series is not None else " series ảnh"
    log(f"DICOMweb: {image_series_count}{selected_label}, {inventory_total} ảnh "
        f"({pending_total} cần tải). Đang tải trực tiếp (6 luồng song song)...")

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
        u = profile.instance_url(suid, iuid)
        body, ct = get_raw(u, accept='multipart/related; type="application/dicom", application/dicom')
        parts = _multipart_parts(body, ct)
        if parts:
            saved = [save_body(d) for _pct, d in parts if _guess_ext(d) == "dcm"]
            return bool(saved and all(saved))
        if _guess_ext(body) == "dcm":
            return save_body(body)
        return False

    def try_frames(suid, iuid, nf, meta_in):
        base = profile.instance_url(suid, iuid)
        meta = meta_in if meta_in else {}
        if isinstance(meta, list):
            meta = meta[0] if meta else {}
        try:
            nf = max(nf, int(str(V(meta, "00280008") or nf)))
        except Exception:
            pass
        frames, fct = [], ""
        for fi in range(1, nf + 1):
            if budget is not None and budget.is_expired():
                return False
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
        with route_lock:
            route_candidates = list(order)
        for name in route_candidates:
            try:
                if fetchers[name](suid, iuid, nf, meta_in):
                    with route_lock:
                        if order[0] != name:  # nhớ cách vừa thành công cho các ảnh sau
                            order.remove(name)
                            order.insert(0, name)
                    return True
            except Exception:
                continue
        return False

    _run_fetch_tasks(tasks, fetch_one, stats, log, stop, captured.get("budget"), tracker=tracker)
    completed_pending = max(0, pending_total - stats.failed)
    stats.completed_tasks = max(stats.completed_tasks, skipped_count + completed_pending)
    stats.preferred_routes = list(order)
    _report_download_result(stats, inventory_total, log, stop)


def _drive_viewer_dom_heuristic(page, log: LogFn, stats: DownloadStats,
                                max_slices: int, stop: Callable[[], bool],
                                selected_series_ids: Optional[set[str]] = None) -> None:
    """Bấm qua từng series và cuộn hết lát cắt để ép viewer tải ảnh.

    Đây là HEURISTIC theo DOM, không phải đường tải chung: nó nhận ra danh sách
    series qua đúng mấy tên class dưới đây (`.seriesThumb`, `.serieslist_panel_list`,
    `.verlist`). Viewer nào không dùng bộ class đó thì chỉ cuộn được khung ảnh
    ĐANG hiển thị — vẫn vớt được một series nhờ `.cornerstone-canvas`, nhưng
    KHÔNG duyệt hết được các series còn lại. Vì vậy đây là lưới cuối cùng, và
    một ca chỉ đi tới đây thì đừng coi số ảnh thu được là đủ.
    """
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
    viewer_url = str(
        study.get("viewer_url")
        or study.get("viewerUrl")
        or study.get("url")
        or study.get("direct_url")
        or study.get("download_url")
        or study.get("downloadUrl")
        or previous.get("viewerUrl")
        or previous.get("downloadUrl")
        or ""
    ).strip()
    patient_code = str(
        study.get("patient_id")
        or study.get("patientId")
        or manifest.get("patientId")
        or previous.get("patientCode")
        or ""
    ).strip()
    accession_no = str(
        study.get("accession_number")
        or study.get("accessionNumber")
        or study.get("accession_no")
        or metadata.get("AccessionNumber")
        or previous.get("accessionNumber")
        or ""
    ).strip()
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
        "downloadUrl": viewer_url,
        "viewerUrl": viewer_url,
        "patientCode": patient_code,
        "accessionNumber": accession_no,
        "downloadType": "ris" if (manifest.get("hospitalKey") and manifest.get("hospitalKey") != "direct") else "direct",
        "hospitalKey": str(study.get("hospital_key") or manifest.get("hospitalKey") or ""),
        "hospitalName": str(study.get("hospital_name") or manifest.get("hospitalName") or ""),
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


def extract_patient_metadata(
    dicom_dir: Path,
    manual_info: Optional[dict] = None,
    allow_mixed: bool = False,
) -> dict:
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
            if not allow_mixed and (
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
    source_url: str = "",
) -> None:
    """Persist demographics for direct/CLI downloads, not only RIS archives.

    `source_url` is the link the study was fetched from; it is recorded so the
    viewer can show where a folder came from long after the download.
    """
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
    direct_url = str(
        source_url
        or metadata.get("viewer_url")
        or metadata.get("viewerUrl")
        or metadata.get("url")
        or metadata.get("direct_url")
        or metadata.get("download_url")
        or metadata.get("downloadUrl")
        or manifest.get("directUrl")
        or manifest.get("downloadUrl")
        or ""
    ).strip()
    if direct_url and not manifest.get("directUrl"):
        manifest["directUrl"] = direct_url
    uid = str(metadata.get("StudyInstanceUID") or "").strip()
    if uid:
        previous = manifest["studies"].get(uid) or {}
        try:
            relative = str(Path(jpg_dir).relative_to(root))
        except ValueError:
            relative = Path(jpg_dir).name
        study_url = direct_url or previous.get("downloadUrl") or previous.get("viewerUrl") or ""
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
            "downloadUrl": study_url,
            "viewerUrl": study_url,
            "patientCode": str(manifest.get("patientId") or metadata.get("PatientID") or ""),
            "accessionNumber": str(metadata.get("AccessionNumber") or previous.get("accessionNumber", "")),
            "downloadType": "direct",
            "hospitalKey": str(manifest.get("hospitalKey") or "direct"),
            "hospitalName": str(manifest.get("hospitalName") or ""),
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

    try:
        metadata = (
            extract_patient_metadata(dicom_dir, manual_info=manual_info, allow_mixed=True) or first_metadata
            if rename_patient_root or after_dicom_download is not None
            else {}
        )
    except PatientIdentityConflictError as e:
        log(f"⚠ Phát hiện nhiều định danh bệnh nhân trong folder DICOM ({e}); "
            f"sử dụng thông tin DICOM đầu tiên để tạo tên thư mục và tiếp tục chuyển đổi JPG.")
        metadata = first_metadata or {}
    except Exception as e:
        log(f"⚠ Lỗi trích xuất metadata ({e}); sử dụng thông tin DICOM đầu tiên.")
        metadata = first_metadata or {}
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
        try:
            write_direct_patient_manifest(
                out_base,
                jpg_dir,
                metadata,
                image_count=dl.total(),
                complete=dl.is_complete(),
                source_url=url,
            )
        except Exception as e:
            log(f"  (Ghi manifest hồ sơ bỏ qua: {e})")
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
            st["viewer_url"] = viewer_url
            st["download_url"] = viewer_url
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

"""
simple_downloader.py
====================
Simplified DICOM downloader — extracts only the download engine from
dcom_pipeline.py.  Downloads ALL series from a viewer link (no selection),
stores raw .dcm files organised by series folder.

No JPG conversion, no patient archive management, no RIS login.
"""

from __future__ import annotations

import base64
import hashlib
import io
import json
import os
import re
import sys
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Optional

LogFn = Callable[[str], None]


def _default_log(msg: str) -> None:
    try:
        print(msg, flush=True)
    except Exception:
        pass


# ── Utility helpers ──────────────────────────────────────────────────────────

def _guess_ext(data: bytes) -> Optional[str]:
    if data[:3] == b"\xff\xd8\xff":
        return "jpg"
    if data[:4] == b"\x89PNG":
        return "png"
    if len(data) > 132 and data[128:132] == b"DICM":
        return "dcm"
    return None


def _maybe_base64_decode(body: bytes) -> bytes:
    stripped = body.strip()
    if not stripped or len(stripped) < 100:
        return body
    if _guess_ext(stripped) is not None:
        return body
    if re.fullmatch(rb"[A-Za-z0-9+/=\r\n]+", stripped):
        try:
            decoded = base64.b64decode(stripped + b"=" * (-len(stripped) % 4))
            if _guess_ext(decoded) is not None:
                return decoded
        except Exception:
            pass
    return body


def _multipart_parts(body: bytes, content_type: str = "") -> "list[tuple[str, bytes]]":
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
            break
        head, brk, payload = chunk.partition(b"\r\n\r\n")
        if not brk:
            continue
        mt = re.search(rb"(?i)content-type:\s*([^\r\n]+)", head)
        pct = mt.group(1).decode("latin-1", "replace").strip() if mt else ""
        parts.append((pct, payload.rstrip(b"\r\n")))
    return parts


def _safe_name(text) -> str:
    text = str(text) if text is not None else "Unknown"
    text = re.sub(r'[\\/:*?"<>|]+', "_", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text[:80] if text else "Unknown"


# ── DICOM reconstruction from frames ────────────────────────────────────────

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
    try:
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
            pix = b"".join(frames)
            if len(pix) % 2:
                pix += b"\x00"
            vr = "OB" if str(getattr(ds, "BitsAllocated", 16)) == "8" else "OW"
            ds.add_new(0x7FE00010, vr, pix)
            ts_uid = ImplicitVRLittleEndian if ts == "1.2.840.10008.1.2" else ExplicitVRLittleEndian
        else:
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
        try:
            ds.is_little_endian = ts_uid.is_little_endian
            ds.is_implicit_VR = ts_uid.is_implicit_VR
        except Exception:
            pass

        buf = io.BytesIO()
        try:
            dcmwrite(buf, ds, enforce_file_format=True)
        except TypeError:
            dcmwrite(buf, ds, write_like_original=False)
        return buf.getvalue()
    except Exception:
        return None


# ── Browser launch ───────────────────────────────────────────────────────────

_BROWSER_ARGS = ["--dns-over-https-mode=off", "--disable-features=DnsOverHttps,AsyncDns"]
_BROWSER_STATE_LOCK = threading.Lock()
_CHROME_UNAVAILABLE = False
_BROWSER_NOTICES_LOGGED: set[str] = set()


def _log_browser_notice_once(log: LogFn, browser_name: str) -> None:
    with _BROWSER_STATE_LOCK:
        if browser_name in _BROWSER_NOTICES_LOGGED:
            return
        _BROWSER_NOTICES_LOGGED.add(browser_name)
    log(f"Công cụ nền: {browser_name}")


def ensure_browser(log: LogFn = _default_log) -> None:
    try:
        from playwright.sync_api import sync_playwright
        with sync_playwright() as p:
            if os.path.exists(p.chromium.executable_path):
                return
    except Exception:
        pass
    log("Lần đầu chạy: đang tải Chromium (~150MB, chỉ 1 lần)...")
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
        log(f"  Không tải được Chromium ({e}). Chạy: python -m playwright install chromium")


def _installed_chrome_paths() -> list[Path]:
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
    global _CHROME_UNAVAILABLE
    with _BROWSER_STATE_LOCK:
        skip_chrome = _CHROME_UNAVAILABLE

    chrome_error = None
    if not skip_chrome:
        try:
            b = p.chromium.launch(headless=headless, channel="chrome", args=_BROWSER_ARGS)
            _log_browser_notice_once(log, "Google Chrome")
            return b
        except Exception as exc:
            chrome_error = exc
        for chrome_path in _installed_chrome_paths():
            try:
                b = p.chromium.launch(
                    headless=headless, executable_path=str(chrome_path), args=_BROWSER_ARGS,
                )
                _log_browser_notice_once(log, "Google Chrome")
                return b
            except Exception as exc:
                chrome_error = exc
        with _BROWSER_STATE_LOCK:
            _CHROME_UNAVAILABLE = True
        log(f"Chrome không khởi động được; dùng trình duyệt dự phòng. ({_short_browser_error(chrome_error)})")

    try:
        if sys.platform == "darwin" and hasattr(p, "webkit"):
            b = p.webkit.launch(headless=headless)
            _log_browser_notice_once(log, "Safari / WebKit")
            return b
    except Exception:
        pass

    try:
        b = p.chromium.launch(headless=headless, channel="msedge", args=_BROWSER_ARGS)
        _log_browser_notice_once(log, "Microsoft Edge")
        return b
    except Exception as exc:
        log(f"Edge không khởi động được: {_short_browser_error(exc)}")

    ensure_browser(log)
    log("Đang mở Chromium dự phòng...")
    return p.chromium.launch(headless=headless, args=_BROWSER_ARGS)


# ── Series parsing from manifests ────────────────────────────────────────────

_NON_IMAGE_MODALITIES = frozenset({
    "SR", "PR", "KO", "DOC", "AU", "SEG", "REG", "FID", "PLAN",
    "RTSTRUCT", "RTPLAN", "RTRECORD", "STAND",
})


def _is_non_image_modality(modality: Any) -> bool:
    return str(modality or "").strip().upper() in _NON_IMAGE_MODALITIES


def _dicom_json_value(item: dict, tag: str) -> Any:
    values = (item.get(tag, {}) or {}).get("Value", [None])
    return values[0] if values else ""


def _dicom_storage_info(data: bytes, digest: str) -> tuple[str, str]:
    """Build stable readable series/file names from DICOM header."""
    try:
        import pydicom
        ds = pydicom.dcmread(
            io.BytesIO(data), stop_before_pixels=True, force=True,
            specific_tags=[
                "StudyInstanceUID", "SeriesInstanceUID", "SeriesNumber",
                "SeriesDescription", "InstanceNumber", "SOPInstanceUID",
            ],
        )
        uid = str(getattr(ds, "SeriesInstanceUID", "") or "").strip()
        number = str(getattr(ds, "SeriesNumber", "") or "").strip() or "NA"
        description = _safe_name(getattr(ds, "SeriesDescription", "") or "UnknownSeries")[:64]
        study_uid = str(getattr(ds, "StudyInstanceUID", "") or "").strip()
        series_key = uid or f"{study_uid}:{number}:{description}"
        uid_token = hashlib.sha1((series_key or digest).encode("utf-8")).hexdigest()[:8]
        folder = f"Series_{_safe_name(number)}_{description}_{uid_token}"
        instance = str(getattr(ds, "InstanceNumber", "") or "").strip()
        sop = str(getattr(ds, "SOPInstanceUID", "") or "").strip()
        sop_token = hashlib.sha1((sop or digest).encode("utf-8")).hexdigest()[:10]
        instance_token = f"{int(instance):05d}" if instance.lstrip("-").isdigit() else _safe_name(instance or "NA")
        return folder, f"IM_{instance_token}_{sop_token}_{digest[:6]}.dcm"
    except Exception:
        return f"Series_UNKNOWN_{digest[:8]}", f"IM_NA_{digest[:10]}.dcm"


# ── Download stats ───────────────────────────────────────────────────────────

@dataclass
class DownloadStats:
    dicom: int = 0
    jpg: int = 0
    png: int = 0
    duplicates: int = 0
    expected: int = 0
    failed: int = 0
    completed_tasks: int = 0

    def total(self) -> int:
        return self.dicom + self.jpg + self.png


# ── Parallel fetch with retry ────────────────────────────────────────────────

def _run_fetch_tasks(tasks, fetch, stats: DownloadStats, log: LogFn,
                     stop: Callable[[], bool], passes: int = 3) -> None:
    from concurrent.futures import ThreadPoolExecutor

    def attempt(task) -> bool:
        if stop():
            return True
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
            log(f"  ↻ Tải lại {len(pending)} ảnh hỏng (lượt {round_no}/{passes})...")
            time.sleep(1.5)
        with ThreadPoolExecutor(max_workers=6) as ex:
            results = list(ex.map(attempt, pending))
        pending = [task for task, ok in zip(pending, results) if not ok]

    stats.failed = 0 if stop() else len(pending)
    stats.completed_tasks = max(stats.completed_tasks, original_count - len(pending))


def _report_download_result(stats: DownloadStats, expected: int, log: LogFn,
                            stop: Callable[[], bool]) -> None:
    expected = int(expected or 0)
    stats.expected = max(stats.expected, expected)
    if stop():
        log(f"  ⏹ Đã dừng: {stats.dicom}/{expected or '?'} ảnh.")
        return
    completed = stats.completed_tasks or stats.dicom
    if expected and completed >= expected:
        log(f"  ✓ Đủ: {completed}/{expected} ảnh.")
    elif expected:
        log(f"  ❌ THIẾU: {completed}/{expected} (hỏng {stats.failed}).")
    else:
        log(f"  ⚠ Không rõ tổng số — đã lấy {stats.total()} ảnh.")


# ── Manifest-based downloaders ───────────────────────────────────────────────

def _download_via_manifest(captured, save_body, stats, log, stop) -> None:
    import ssl
    import urllib.request
    from urllib.parse import urlparse, parse_qs, urlencode

    sslctx = ssl.create_default_context()
    sslctx.check_hostname = False
    sslctx.verify_mode = ssl.CERT_NONE

    try:
        j = json.loads(captured["getstudies"].decode("utf-8", "replace"))
    except Exception as e:
        log(f"  Lỗi manifest ({e})."); return

    data = j.get("data", j)
    study = data[0] if isinstance(data, list) and data else data
    series_list = study.get("SeriesList", []) if isinstance(study, dict) else []
    if not series_list:
        log("  Manifest trống."); return

    tp = urlparse(captured["template_url"])
    tmpl_base = f"{tp.scheme}://{tp.netloc}{tp.path}" if tp.netloc else None
    tmpl = {k: v[0] for k, v in parse_qs(tp.query).items()}

    def obj_key(web):
        if not web: return None
        q = web[1:] if web.startswith("?") else web
        return parse_qs(q).get("imageObjKey", [None])[0]

    tasks, total_expected = [], 0
    for s in series_list:
        total_expected += int(s.get("ImageCount", 0) or 0)
        base = tmpl_base or s.get("ImageBaseUrl")
        if not base: continue
        for im in (s.get("ImageList", []) or []):
            io_key = obj_key(im.get("WebUrl") or "")
            if not io_key: continue
            params = dict(tmpl)
            params["imageObjKey"] = io_key
            params["signature"] = im.get("Signature", "")
            params["seriesuid"] = s.get("SeriesInsUID", params.get("seriesuid", ""))
            params["studyuid"] = s.get("StuInsUID", params.get("studyuid", ""))
            params["imageUid"] = im.get("SOPInstanceUID", "")
            params["imageid"] = str(im.get("ImageID", 0))
            exp = s.get("Expires") or im.get("Expires")
            if exp:
                params["expires"] = str(exp)
            tasks.append(base + "?" + urlencode(params))

    log(f"Manifest: {len(series_list)} series, ~{total_expected} ảnh, tải {len(tasks)} ảnh...")

    def fetch_one(u):
        with urllib.request.urlopen(u, timeout=45, context=sslctx) as r:
            return save_body(r.read())

    _run_fetch_tasks(tasks, fetch_one, stats, log, stop)
    _report_download_result(stats, total_expected or len(tasks), log, stop)


def _download_via_vrpacs(captured, save_body, stats, log, stop) -> None:
    import ssl
    import urllib.request

    try:
        j = json.loads(captured["vrpacs"].decode("utf-8", "replace"))
    except Exception as e:
        log(f"  Lỗi manifest vrpacs ({e})."); return

    data = j.get("data", {}) if isinstance(j, dict) else {}
    studies = data.get("studyList", []) if isinstance(data, dict) else []
    host = (captured.get("host") or "").rstrip("/")

    def to_url(image_id):
        s = image_id
        for pref in ("wadouri:", "wadors:", "dicomweb:", "dicomfile:"):
            if s.startswith(pref): s = s[len(pref):]; break
        return s if s.startswith("http") else host + "/" + s.lstrip("/")

    tasks = []
    for st in studies:
        for se in (st.get("seriesList", []) or []):
            for iid in (se.get("imageIds", []) or []):
                if iid: tasks.append(to_url(iid))

    cj = "; ".join(f'{c.get("name")}={c.get("value")}' for c in (captured.get("cookies") or []))
    sslctx = ssl.create_default_context()
    sslctx.check_hostname = False
    sslctx.verify_mode = ssl.CERT_NONE
    log(f"Manifest vrpacs: {len(tasks)} ảnh...")

    def fetch_one(u):
        req = urllib.request.Request(u, headers={"Cookie": cj} if cj else {})
        with urllib.request.urlopen(req, timeout=45, context=sslctx) as r:
            return save_body(r.read())

    _run_fetch_tasks(tasks, fetch_one, stats, log, stop)
    _report_download_result(stats, len(tasks), log, stop)


def _download_via_dicomweb(captured, save_body, stats, log, stop) -> None:
    import ssl
    import urllib.request
    from urllib.parse import urlparse, parse_qs, urlencode

    qp = urlparse(captured["qido_series"])
    rs_base = f"{qp.scheme}://{qp.netloc}{qp.path.split('/studies/')[0]}"
    try:
        study = qp.path.split("/studies/")[1].split("/series")[0]
    except Exception:
        log("  Không tách được studyUID."); return

    if captured.get("wado_tmpl"):
        wp = urlparse(captured["wado_tmpl"])
        wado_base = f"{wp.scheme}://{wp.netloc}{wp.path}"
        wtmpl = {k: v[0] for k, v in parse_qs(wp.query).items()}
        order = ["wadouri", "wadors", "frames"]
    else:
        wado_base = rs_base.rsplit("/rs", 1)[0] + "/wado"
        wtmpl = {"requestType": "WADO", "contentType": "application/dicom", "transferSyntax": "*"}
        order = ["wadors", "frames", "wadouri"]

    hdr = {}
    for k, v in (captured.get("api_headers") or {}).items():
        lk = k.lower()
        if lk.startswith("x-") or lk in ("authorization", "token", "session", "session-id"):
            hdr[k] = v
    cj = "; ".join(f'{c.get("name")}={c.get("value")}' for c in (captured.get("cookies") or []))
    if cj: hdr["Cookie"] = cj

    sslctx = ssl.create_default_context()
    sslctx.check_hostname = False
    sslctx.verify_mode = ssl.CERT_NONE

    def get_raw(u, accept=None):
        h = dict(hdr)
        if accept: h["Accept"] = accept
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
        log(f"  Lỗi QIDO ({e})."); return

    log(f"DICOMweb: {len(series)} series...")
    tasks = []
    for s in series:
        if stop(): break
        suid = V(s, "0020000E")
        if not suid: continue
        if _is_non_image_modality(V(s, "00080060")): continue
        try:
            insts = get_json(f"{rs_base}/studies/{study}/series/{suid}/instances")
        except Exception:
            insts = []
        if not insts:
            try: insts = get_json(f"{rs_base}/studies/{study}/series/{suid}/metadata")
            except Exception: insts = []
        for i in insts:
            iuid = V(i, "00080018")
            if iuid:
                try: nf = int(str(V(i, "00280008") or 1))
                except Exception: nf = 1
                tasks.append((suid, iuid, max(1, nf), i))

    log(f"DICOMweb: {len(tasks)} ảnh, đang tải...")

    def try_wadouri(suid, iuid, nf, meta_in):
        params = {k: v for k, v in wtmpl.items() if k.lower() not in ("studyuid", "seriesuid", "objectuid")}
        params.update({"studyUID": study, "seriesUID": suid, "objectUID": iuid})
        params.setdefault("requestType", "WADO")
        params.setdefault("contentType", "application/dicom")
        params.setdefault("transferSyntax", "*")
        body, _ = get_raw(wado_base + "?" + urlencode(params))
        if _guess_ext(_maybe_base64_decode(body)) is None and not _multipart_parts(body):
            return False
        save_body(body); return True

    def try_wadors(suid, iuid, nf, meta_in):
        u = f"{rs_base}/studies/{study}/series/{suid}/instances/{iuid}"
        body, ct = get_raw(u, accept='multipart/related; type="application/dicom", application/dicom')
        ok = False
        for _pct, d in (_multipart_parts(body, ct) or [("", body)]):
            if _guess_ext(d) == "dcm": save_body(d); ok = True
        return ok

    def try_frames(suid, iuid, nf, meta_in):
        base_url = f"{rs_base}/studies/{study}/series/{suid}/instances/{iuid}"
        meta = meta_in if meta_in else {}
        if isinstance(meta, list): meta = meta[0] if meta else {}
        try: nf = max(nf, int(str(V(meta, "00280008") or nf)))
        except Exception: pass
        frames, fct = [], ""
        for fi in range(1, nf + 1):
            body, ct = get_raw(f"{base_url}/frames/{fi}",
                               accept='multipart/related; type="application/octet-stream", */*')
            parts = _multipart_parts(body, ct)
            if parts:
                fct = fct or parts[0][0]
                frames.extend(d for _pct, d in parts)
            else:
                fct = fct or ct; frames.append(body)
        if not any(frames): return False
        blob = _dicom_from_meta_frames(meta, frames, fct)
        if not blob: return False
        save_body(blob); return True

    fetchers = {"wadouri": try_wadouri, "wadors": try_wadors, "frames": try_frames}

    def fetch_one(task):
        suid, iuid, nf, meta_in = task
        for name in list(order):
            try:
                if fetchers[name](suid, iuid, nf, meta_in):
                    if order[0] != name: order.remove(name); order.insert(0, name)
                    return True
            except Exception: continue
        return False

    _run_fetch_tasks(tasks, fetch_one, stats, log, stop)
    _report_download_result(stats, len(tasks), log, stop)


# ── Fallback: scroll-based viewer download ───────────────────────────────────

def _drive_viewer(page, log, stats, max_slices, stop) -> None:
    try:
        page.wait_for_selector(".seriesThumb, .serieslist_panel_list, .seriesBox", timeout=25000)
    except Exception:
        log("  Không thấy danh sách series.")

    try:
        panels = page.query_selector_all(".serieslist_panel_list, .verlist, .seriesThumb_container")
        for panel in panels:
            for _ in range(8):
                page.evaluate("(el) => el.scrollTop = el.scrollHeight", panel)
                page.wait_for_timeout(120)
    except Exception:
        pass

    thumbs = page.query_selector_all(".seriesThumb:visible")
    n_series = len(thumbs)
    log(f"Phát hiện {n_series} series." if n_series else "Không tìm thấy thumbnail, cuộn ảnh hiện tại.")

    def scroll_viewport(expected):
        target = None
        for sel in (".viewer_imageregion", ".imageBox", ".imagebox_container",
                    ".cornerstone-canvas", ".imageviewBox"):
            el = page.query_selector(sel)
            if el:
                try:
                    box = el.bounding_box()
                    if box and box["width"] > 100 and box["height"] > 100:
                        target = box; break
                except Exception: continue
        if not target: return
        cx = target["x"] + target["width"] / 2
        cy = target["y"] + target["height"] / 2
        page.mouse.move(cx, cy)
        steps = min(max(expected + 10, 60), max_slices)
        for i in range(steps):
            if stop(): return
            try: page.mouse.wheel(0, 110)
            except Exception: break
            page.wait_for_timeout(90 if i % 8 == 0 else 35)

    if n_series == 0:
        scroll_viewport(max_slices); return

    for idx in range(n_series):
        if stop(): return
        thumbs = page.query_selector_all(".seriesThumb:visible")
        if idx >= len(thumbs): break
        thumb = thumbs[idx]

        expected = max_slices
        try:
            cnt_el = thumb.query_selector(".series_imagecount_text")
            if cnt_el:
                m = re.search(r"\d+", (cnt_el.inner_text() or "").strip())
                if m: expected = int(m.group())
        except Exception: pass

        desc = ""
        try:
            d_el = thumb.query_selector(".series_description_text, .series_number_text")
            if d_el: desc = (d_el.inner_text() or "").strip()
        except Exception: pass

        log(f"[Series {idx+1}/{n_series}] {desc}  (~{expected} ảnh)")
        try:
            thumb.scroll_into_view_if_needed(timeout=5000)
            thumb.click(timeout=5000)
        except Exception:
            try: thumb.dblclick(timeout=5000)
            except Exception: log("   (bỏ qua)"); continue
        page.wait_for_timeout(700)
        scroll_viewport(expected)

        try:
            phase_btns = page.query_selector_all(".seriesPhaseUI button, .seriesPhaseUI .checkable_icon")
            for pb in phase_btns[:20]:
                if stop(): return
                try:
                    pb.click(timeout=1500); page.wait_for_timeout(300)
                    scroll_viewport(expected)
                except Exception: pass
        except Exception: pass


# ── RIS wrapper detection (simple) ───────────────────────────────────────────

_RIS_WRAPPER_RE = re.compile(r"/ris/vr_?viewer", re.I)


def _is_ris_wrapper_url(url: str) -> bool:
    return bool(_RIS_WRAPPER_RE.search(str(url or "")))


def _page_is_ris_login(page) -> bool:
    url = (page.url or "").lower()
    if "/account/login" in url:
        return True
    try:
        password = page.query_selector("input[type='password']")
        return bool(password and password.is_visible())
    except Exception:
        return False


# ── Main download function ───────────────────────────────────────────────────

def download_all(
    url: str,
    output_dir: Path,
    log: LogFn = _default_log,
    headless: bool = True,
    settle_ms: int = 8000,
    max_slices_per_series: int = 600,
    should_stop: Optional[Callable[[], bool]] = None,
    resume: bool = False,
) -> DownloadStats:
    """Download all DICOM files from a viewer link into output_dir."""
    from playwright.sync_api import sync_playwright

    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    stats = DownloadStats()
    seen_hashes: set[str] = set()
    save_lock = threading.Lock()

    if resume:
        for f in sorted(output_dir.rglob("*.dcm")):
            try:
                seen_hashes.add(hashlib.sha1(f.read_bytes()).hexdigest())
                stats.dicom += 1
            except Exception: pass
        if stats.total():
            log(f"Thử lại: đã có {stats.total()} ảnh, bổ sung mới.")

    def stop():
        return bool(should_stop and should_stop())

    def save_body(body: bytes, _depth: int = 0) -> bool:
        if not body: return False
        data = _maybe_base64_decode(body)
        ext = _guess_ext(data)
        if ext is None:
            if _depth == 0:
                saved = [save_body(part, 1) for _pct, part in _multipart_parts(data)]
                return any(saved)
            return False
        h = hashlib.sha1(data).hexdigest()
        with save_lock:
            if h in seen_hashes:
                stats.duplicates += 1; return True
            seen_hashes.add(h)
            if ext == "dcm":
                stats.dicom += 1
            elif ext == "jpg":
                stats.jpg += 1
            else:
                stats.png += 1
            n = stats.total()
        if ext == "dcm":
            series_folder, filename = _dicom_storage_info(data, h)
            dest = output_dir / series_folder / filename
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(data)
            if n % 25 == 0:
                log(f"  ...đã tải {n} ảnh (DICOM: {stats.dicom})")
        # Discard JPG/PNG — this app only keeps DICOM
        return True

    captured = {
        "getstudies": None, "template_url": None, "vrpacs": None,
        "qido_series": None, "qido_series_body": None,
        "wado_tmpl": None, "host": None, "cookies": None,
        "api_headers": None, "session_error": None,
    }
    capture_bodies = True  # Always capture passively

    def _want_capture(resp):
        u = resp.url
        if any(k in u for k in ("GetImage", "dicomData", "DicomImage", "wado",
                                "/frames/", "/instances/", "/preview")):
            return True
        ct = resp.headers.get("content-type", "").lower()
        return ("dicom" in ct) or ("octet-stream" in ct)

    def on_response(response):
        try:
            u = response.url
            ct = response.headers.get("content-type", "").lower()
            if (captured["session_error"] is None and response.status >= 400
                    and re.search(r"/(session|share)s?/[0-9a-fA-F\-]{8,}", u)):
                captured["session_error"] = str(response.status)
            if "StudyData/GetStudies" in u and captured["getstudies"] is None:
                captured["getstudies"] = response.body(); return
            if "get-share-patient-image" in u and captured["vrpacs"] is None:
                captured["vrpacs"] = response.body(); return
            if (captured["qido_series"] is None
                    and u.split("?")[0].rstrip("/").endswith("/series")):
                captured["qido_series"] = u
                try: captured["qido_series_body"] = response.body()
                except Exception: pass
                try: captured["api_headers"] = response.request.all_headers()
                except Exception:
                    try: captured["api_headers"] = dict(response.request.headers)
                    except Exception: pass
                return
            if _want_capture(response):
                if captured["template_url"] is None and "GetImage" in u and "Jpeg" not in u:
                    captured["template_url"] = u
                if (captured["wado_tmpl"] is None and ct.startswith("application/dicom")
                        and "json" not in ct and ("wado" in u.lower() or "objectuid" in u.lower())):
                    captured["wado_tmpl"] = u
                if capture_bodies:
                    save_body(response.body())
        except Exception:
            pass

    def _have_manifest():
        return bool((captured["getstudies"] and captured["template_url"])
                    or captured["vrpacs"]
                    or captured["qido_series"])

    used_manifest = False
    with sync_playwright() as p:
        browser = _launch_chromium(p, headless, log)
        context = browser.new_context(viewport={"width": 1600, "height": 1000},
                                      ignore_https_errors=True)
        page = context.new_page()
        page.on("response", on_response)

        log("Đang tải trang viewer...")
        try:
            page.goto(url, wait_until="domcontentloaded", timeout=60000)
        except Exception as e:
            log(f"  Cảnh báo: {e}")

        try:
            if "urlExpired" in page.url or "Message/Error" in page.url:
                log("!!! Link đã HẾT HẠN.")
                browser.close(); return stats
        except Exception: pass

        try:
            if _is_ris_wrapper_url(url) and _page_is_ris_login(page):
                log("!!! Link RIS cần đăng nhập. Hãy dùng link viewer trực tiếp.")
                browser.close(); return stats
        except Exception: pass

        log("Đang dò manifest...")
        for _ in range(24):
            if stop() or _have_manifest() or captured["session_error"]:
                break
            page.wait_for_timeout(500)

        if not _have_manifest():
            expired = bool(captured["session_error"])
            if not expired:
                try:
                    txt = (page.evaluate("() => document.body ? document.body.innerText : ''") or "").lower()
                    expired = ("cannot view images" in txt) or ("urlexpired" in txt)
                except Exception: pass
            if expired:
                log(f"!!! Link HẾT HẠN (server trả {captured['session_error'] or '?'}).")
                browser.close(); return stats

        if _have_manifest():
            used_manifest = True
            try:
                from urllib.parse import urlparse as _up
                pu = _up(page.url)
                captured["host"] = f"{pu.scheme}://{pu.netloc}"
                captured["cookies"] = context.cookies()
            except Exception: pass
            log("✓ Có manifest → tải trực tiếp.")
            browser.close()
        else:
            log("Không thấy manifest → chế độ cuộn/click.")
            page.wait_for_timeout(1500)
            _drive_viewer(page, log, stats, max_slices_per_series, stop)
            log(f"Chờ {settle_ms/1000:.0f}s...")
            try: page.wait_for_load_state("networkidle", timeout=settle_ms)
            except Exception: page.wait_for_timeout(settle_ms)
            browser.close()

    if used_manifest and not stop():
        if captured["getstudies"] and captured["template_url"]:
            _download_via_manifest(captured, save_body, stats, log, stop)
        elif captured["vrpacs"]:
            _download_via_vrpacs(captured, save_body, stats, log, stop)
        elif captured["qido_series"]:
            _download_via_dicomweb(captured, save_body, stats, log, stop)

    log(f"Tải xong. DICOM: {stats.dicom}, trùng bỏ: {stats.duplicates}.")
    return stats

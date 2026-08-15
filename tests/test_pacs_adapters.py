"""Nhận diện dòng PACS.

Trước đây logic này bị chép ở hai nơi (`download_all` và `discover_viewer_series`)
nên rất dễ lệch. Các test dưới đây khóa hành vi nhận diện lại một chỗ.
"""

import json
import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import dcom_pipeline


def _vietmy_file(file_id: int) -> dict:
    """Một ảnh trong manifest MSC PACS: có cả link gốc lẫn link JPEG dựng sẵn."""
    return {
        "fileId": file_id,
        "instanceNo": str(file_id),
        "imagePath": f"https://vietmy.pmr.vn/ws/getimagefile.ashx?fileId={file_id}&stoken=abc",
        "filePath": f"https://vietmy.pmr.vn/ws/getfile.ashx?studyId=1&fileId={file_id}&zstd=true&stoken=abc",
        "wanFilePath": f"https://vietmy.pmr.vn/ws/getfile.ashx?studyId=1&fileId={file_id}&zstd=true&stoken=abc",
    }


# ws.asmx bọc kết quả trong {"d": ...}; giữ nguyên hình dạng thật của server.
VIETMY_MANIFEST = json.dumps({"d": {
    "studyUID": "1.2.392.200036.9123.1.1",
    "patientName": "NGUYEN THI VAN",
    "modality": "MR",
    "seriesList": [
        {
            "seriesId": 364804,
            "seriesUID": "1.2.392.200036.9123.1.7",
            "seriesDescription": "T2 SAG",
            "seriesNumber": "7",
            "numberOfFrames": 10,
            "modality": ["MR"],
            "fileList": [_vietmy_file(1), _vietmy_file(2)],
        },
        {
            "seriesId": 364803,
            "seriesUID": "1.2.392.200036.9123.1.8",
            "seriesDescription": "T1 SAG",
            "seriesNumber": "8",
            "numberOfFrames": 10,
            "modality": ["MR"],
            "fileList": [_vietmy_file(3)],
        },
    ],
}}).encode("utf-8")


class FakeRequest:
    def __init__(self, headers=None, explode=False):
        self._headers = headers or {}
        self._explode = explode

    def all_headers(self):
        if self._explode:
            raise RuntimeError("playwright từ chối trả header")
        return dict(self._headers)

    @property
    def headers(self):
        return dict(self._headers)


class FakeResponse:
    """Đủ giống response của Playwright cho phần nhận diện."""

    def __init__(self, url, body=b"", status=200, content_type="",
                 request_headers=None, body_raises=False):
        self.url = url
        self.status = status
        self.headers = {"content-type": content_type}
        self.request = FakeRequest(request_headers)
        self._body = body
        self._body_raises = body_raises

    def body(self):
        if self._body_raises:
            raise RuntimeError("response đã bị hủy")
        return self._body


class AdapterDetectionTests(unittest.TestCase):
    def test_vrad_needs_both_manifest_and_a_real_image_url(self):
        cap = dcom_pipeline.ViewerCapture()
        dcom_pipeline._observe_response(
            FakeResponse("https://pacs.test/StudyData/GetStudies", b"{}"), cap,
        )
        # Có manifest là đủ để LIỆT KÊ series...
        self.assertIsNotNone(dcom_pipeline._series_manifest_adapter(cap))
        # ...nhưng chưa đủ để TẢI: còn thiếu khuôn URL ảnh.
        self.assertIsNone(dcom_pipeline._ready_adapter(cap))

        dcom_pipeline._observe_response(
            FakeResponse("https://pacs.test/GetImage?id=1"), cap,
        )
        adapter = dcom_pipeline._ready_adapter(cap)
        self.assertIsNotNone(adapter)
        self.assertEqual("VradViewer", adapter.name)
        self.assertEqual("vrad", adapter.source)

    def test_a_jpeg_url_is_not_taken_as_the_vrad_template(self):
        cap = dcom_pipeline.ViewerCapture()
        dcom_pipeline._observe_response(
            FakeResponse("https://pacs.test/GetImageJpeg?id=1"), cap,
        )
        self.assertIsNone(cap.template_url)

    def test_vrpacs_is_detected_from_its_share_endpoint(self):
        cap = dcom_pipeline.ViewerCapture()
        matched = dcom_pipeline._observe_response(
            FakeResponse("https://vrpacs.test/api/get-share-patient-image", b"{}"), cap,
        )
        self.assertTrue(matched)
        adapter = dcom_pipeline._ready_adapter(cap)
        self.assertEqual("VRPACS", adapter.name)

    def test_vietmy_is_ready_from_getlistimagefileinfo_alone(self):
        """MSC PACS vẽ ảnh bằng WebGL — chỉ manifest này mới lần ra DICOM gốc."""
        cap = dcom_pipeline.ViewerCapture()
        # Mở trang chia sẻ thôi thì chưa nhận ra gì cả: chưa có manifest.
        dcom_pipeline._observe_response(
            FakeResponse("https://vietmy.pmr.vn/Pages/ShareStudy.aspx?stoken=abc12345", b""), cap,
        )
        self.assertIsNone(dcom_pipeline._ready_adapter(cap))

        matched = dcom_pipeline._observe_response(
            FakeResponse("https://vietmy.pmr.vn/WS/ws.asmx/GetListImageFileInfo",
                         VIETMY_MANIFEST), cap,
        )
        self.assertTrue(matched)
        adapter = dcom_pipeline._ready_adapter(cap)
        self.assertEqual("VietMy", adapter.name)
        self.assertEqual("vietmy", adapter.source)

        choices = adapter.series_choices(cap)
        self.assertEqual(2, len(choices))
        self.assertEqual("T2 SAG", choices[0]["description"])
        # Đếm theo `fileList`, không tin `numberOfFrames` (lệch khi multi-frame).
        self.assertEqual(2, choices[0]["imageCount"])
        self.assertEqual("MR", choices[0]["modality"])
        # id phải là SeriesInstanceUID thật để chọn lọc series khớp giữa 2 lần mở.
        self.assertEqual("1.2.392.200036.9123.1.7", choices[0]["id"])

    def test_vietmy_download_uses_original_dicom_not_rendered_jpeg(self):
        captured = {"vietmy": VIETMY_MANIFEST, "cookies": []}
        stats = dcom_pipeline.DownloadStats()
        fetched = []

        def fake_run(tasks, fetch, *args, **kwargs):
            fetched.extend(tasks)

        with mock.patch.object(dcom_pipeline, "_run_fetch_tasks", fake_run), \
             mock.patch.object(dcom_pipeline, "_report_download_result", lambda *a, **k: None):
            dcom_pipeline._download_via_vietmy(
                captured, lambda b: True, stats, lambda *a: None, lambda: False, None,
            )

        self.assertEqual(3, len(fetched))
        self.assertTrue(all("getfile.ashx" in u for u in fetched),
                        f"phải tải DICOM gốc qua getfile.ashx, đang lấy: {fetched}")
        self.assertFalse(any("getimagefile.ashx" in u for u in fetched),
                         "getimagefile.ashx là JPEG viewer dựng sẵn, không phải bản gốc")

    def test_vietmy_download_honours_series_selection(self):
        captured = {"vietmy": VIETMY_MANIFEST, "cookies": []}
        stats = dcom_pipeline.DownloadStats()
        fetched = []

        with mock.patch.object(dcom_pipeline, "_run_fetch_tasks",
                               lambda tasks, *a, **k: fetched.extend(tasks)), \
             mock.patch.object(dcom_pipeline, "_report_download_result", lambda *a, **k: None):
            dcom_pipeline._download_via_vietmy(
                captured, lambda b: True, stats, lambda *a: None, lambda: False,
                {"1.2.392.200036.9123.1.8"},
            )

        self.assertEqual(1, len(fetched))
        self.assertIn("fileId=3", fetched[0])

    def test_dicomweb_is_ready_from_qido_series_alone(self):
        """BV Hà Tĩnh không phát URL nào chứa chữ 'wado' — QIDO phải là đủ."""
        cap = dcom_pipeline.ViewerCapture()
        dcom_pipeline._observe_response(
            FakeResponse(
                "https://viewer.test/ws/rest/v1/studies/1.2.3/series?limit=100",
                b"[]",
                request_headers={"Authorization": "Bearer abc", "X-Session": "s1"},
            ),
            cap,
        )
        adapter = dcom_pipeline._ready_adapter(cap)
        self.assertEqual("DICOMweb", adapter.name)
        self.assertEqual("Bearer abc", cap.api_headers["Authorization"])

    def test_qido_body_is_retried_when_the_first_read_fails(self):
        cap = dcom_pipeline.ViewerCapture()
        url = "https://viewer.test/rs/studies/1.2.3/series"
        dcom_pipeline._observe_response(FakeResponse(url, body_raises=True), cap)
        self.assertIsNone(cap.qido_series_body)
        # Liệt kê series sống nhờ đúng thân này, nên phải còn cơ hội thử lại.
        dcom_pipeline._observe_response(FakeResponse(url, b"[]"), cap)
        self.assertEqual(b"[]", cap.qido_series_body)

    def test_a_specific_pacs_outranks_the_generic_dicomweb_one(self):
        """Giữ đúng thứ tự ưu tiên của chuỗi if/elif cũ."""
        cap = dcom_pipeline.ViewerCapture()
        for response in (
            FakeResponse("https://pacs.test/StudyData/GetStudies", b"{}"),
            FakeResponse("https://pacs.test/GetImage?id=1"),
            FakeResponse("https://pacs.test/rs/studies/1.2.3/series", b"[]"),
        ):
            dcom_pipeline._observe_response(response, cap)
        self.assertEqual("VradViewer", dcom_pipeline._ready_adapter(cap).name)

    def test_a_manifest_response_is_never_saved_as_an_image(self):
        """observe() trả True để chỗ gọi thôi đem response đó đi lưu."""
        cap = dcom_pipeline.ViewerCapture()
        for url in (
            "https://pacs.test/StudyData/GetStudies",
            "https://vrpacs.test/api/get-share-patient-image",
            "https://viewer.test/rs/studies/1.2.3/series",
        ):
            with self.subTest(url=url):
                fresh = dcom_pipeline.ViewerCapture()
                self.assertTrue(
                    dcom_pipeline._observe_response(FakeResponse(url, b"{}"), fresh)
                )
        self.assertFalse(
            dcom_pipeline._observe_response(
                FakeResponse("https://pacs.test/GetImage?id=1"), cap,
            )
        )

    def test_a_broken_adapter_cannot_kill_the_whole_session(self):
        class Exploding(dcom_pipeline.PacsAdapter):
            name = "no"
            priority = 999

            def observe(self, response, cap):
                raise RuntimeError("adapter hỏng")

        original = dcom_pipeline.PACS_ADAPTERS
        dcom_pipeline.PACS_ADAPTERS = (Exploding(),) + original
        try:
            cap = dcom_pipeline.ViewerCapture()
            dcom_pipeline._observe_response(
                FakeResponse("https://vrpacs.test/api/get-share-patient-image", b"{}"),
                cap,
            )
            self.assertEqual(b"{}", cap.vrpacs)
        finally:
            dcom_pipeline.PACS_ADAPTERS = original

    def test_nothing_is_ready_on_an_unknown_viewer(self):
        cap = dcom_pipeline.ViewerCapture()
        dcom_pipeline._observe_response(
            FakeResponse("https://unknown.test/app.js", b"x"), cap,
        )
        self.assertIsNone(dcom_pipeline._ready_adapter(cap))
        self.assertIsNone(dcom_pipeline._series_manifest_adapter(cap))


class ZfpHookTests(unittest.TestCase):
    """
    Móc WebSocket của GE ZFP.

    Server ZFP từ chối 100% lệnh xin ảnh gửi từ ngoài (đã đo trên ca thật: đúng
    socket của trang, đúng payload, correlationId UUID — vẫn câm, kể cả lúc nó
    đang bơm 600 khung của chính viewer). Nên móc phải HỨNG ảnh viewer tự nạp.
    Test này khóa lại điều đó, và chạy luôn bộ test JS dùng chung với extension
    để hai bản không lệch nhau.
    """

    def test_hook_never_asks_the_server_for_an_image(self):
        code = "\n".join(
            line for line in dcom_pipeline._ZFP_HOOK.splitlines()
            if not line.lstrip().startswith("//")
        )
        self.assertNotIn("GET_DICOM_IMAGE", code)
        self.assertIn("watchImages", code)
        self.assertIn("store.take", code)

    def test_hook_behaves_the_same_as_the_extension_copy(self):
        import shutil
        import subprocess
        import tempfile

        node = shutil.which("node")
        suite = os.path.join(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
            "Upgrade", "extention download DCOM",
            "pacs_dicom_extension_final_v6_2", "tests", "test_zfp_hook.mjs",
        )
        if not node or not os.path.exists(suite):
            self.skipTest("cần node và bộ test của extension")
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "zfp-hook.js")
            with open(path, "w", encoding="utf-8") as fh:
                fh.write(dcom_pipeline._ZFP_HOOK)
            proc = subprocess.run([node, suite, path], capture_output=True, text=True)
        self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)


def _zfp_capture():
    """Cấu trúc study GE ZFP: 2 series, mỗi series 2 ảnh."""
    def group(gid, desc, sops):
        return {"studyInstanceUid": "st.1", "groupId": gid, "description": desc,
                "modalities": ["MR"],
                "dicomSops": [{"sopInstanceUid": s, "instanceNumber": i + 1,
                               "seriesInstanceUid": f"se.{gid}"} for i, s in enumerate(sops)]}
    return {"groups": [group("g1", "Ax T2", ["a1", "a2"]),
                       group("g2", "Screen Save", ["b1", "b2"])],
            "study": {"patientDemographics": {"patientId": "1", "patientName": {"personNameString": "X"}},
                      "studyDateTime": "2026-05-13 17:26:52"}}


class FakeZfpPage:
    """Trang viewer giả: bơm ảnh theo từng đợt, mỗi lần nạp lại là một đợt mới."""

    def __init__(self, batches):
        self.batches = [list(b) for b in batches]
        self.queue = list(self.batches.pop(0)) if self.batches else []
        self.reloads = 0

    def evaluate(self, script, arg=None):
        if "groups.length" in script:
            return 1
        if self.queue:
            sop = self.queue.pop(0)
            return {"sop": sop, "size": 8,
                    "meta": {"sopInstanceUid": sop, "dimensions": {"rows": 2, "columns": 2},
                             "bitsAllocated": 16, "samplesPerPixel": 1},
                    "b64": "AAAAAAAAAAA="}
        return {"empty": True}

    def reload(self, **kwargs):
        self.reloads += 1
        self.queue = list(self.batches.pop(0)) if self.batches else []


class ZfpDownloadTests(unittest.TestCase):
    """
    Vòng tải ZFP là DUY NHẤT trong app chạy kiểu hứng: thứ tự ảnh do viewer
    quyết, không phải mình. Ba thứ dễ vỡ nhất được khóa ở đây.
    """

    def _run(self, page, selected=None):
        captured = {"zfp_page": page, "zfp": _zfp_capture()}
        stats = dcom_pipeline.DownloadStats()
        saved, logs = [], []
        with mock.patch.object(dcom_pipeline, "_report_download_result", lambda *a, **k: None), \
             mock.patch.object(dcom_pipeline, "_zfp_meta_to_dicom_json", lambda *a: {}), \
             mock.patch.object(dcom_pipeline, "_dicom_from_meta_frames", lambda *a: b"DICM"), \
             mock.patch.object(dcom_pipeline.time, "sleep", lambda *_: None):
            dcom_pipeline._download_via_zfp(
                captured, lambda body, **kw: saved.append(kw.get("fidelity")) or True,
                stats, logs.append, lambda: False, selected,
            )
        return stats, saved, logs

    def test_images_are_matched_by_sop_not_by_order(self):
        # Viewer bơm ngược thứ tự và xen ảnh của series khác — vẫn phải đủ 4.
        page = FakeZfpPage([["b2", "a2", "b1", "a1"]])
        stats, saved, _ = self._run(page)
        self.assertEqual(4, len(saved))
        self.assertEqual(["reconstructed"] * 4, saved)
        self.assertEqual(0, stats.failed)
        self.assertEqual(0, page.reloads)

    def test_images_of_unselected_series_are_dropped_not_saved(self):
        page = FakeZfpPage([["b1", "a1", "b2", "a2"]])
        choices = dcom_pipeline._zfp_series_choices(_zfp_capture())
        stats, saved, _ = self._run(page, {choices[0]["id"]})
        self.assertEqual(2, len(saved))
        self.assertEqual(0, stats.failed)

    def test_viewer_is_reloaded_to_replay_images_that_already_streamed(self):
        # Đợt đầu chỉ còn nửa cuối; nửa đầu đã chảy qua trước khi bấm Tải.
        page = FakeZfpPage([["a2", "b2"], ["a1", "b1"]])
        stats, saved, _ = self._run(page)
        self.assertEqual(1, page.reloads)
        self.assertEqual(4, len(saved))
        self.assertEqual(0, stats.failed)

    def test_images_the_viewer_never_streams_are_reported_missing(self):
        page = FakeZfpPage([["a1", "b1"]])
        stats, saved, logs = self._run(page)
        self.assertEqual(2, len(saved))
        self.assertEqual(2, stats.failed)          # a2, b2 không bao giờ tới
        self.assertTrue(any("không tự nạp" in line for line in logs))
        self.assertEqual(dcom_pipeline._ZFP_MAX_RELOADS, page.reloads)


class FallbackStateMachineTests(unittest.TestCase):
    """Kiểm tra máy trạng thái fallback và thứ tự ưu tiên của các adapter."""

    def test_ready_adapters_sorts_by_priority_descending(self):
        cap = dcom_pipeline.ViewerCapture()
        # Gán dữ kiện cho cả VietMy (priority 270) và DICOMweb (priority 200)
        cap.vietmy = b'{"d": {}}'
        cap.qido_series = "https://pacs.test/studies/1/series"
        cap.qido_series_body = b"[]"

        ready = dcom_pipeline._ready_adapters(cap)
        self.assertEqual(2, len(ready))
        self.assertEqual("VietMy", ready[0].name)
        self.assertEqual("DICOMweb", ready[1].name)
        self.assertEqual("VietMy", dcom_pipeline._ready_adapter(cap).name)

    def test_fallback_sequence_runs_secondary_when_primary_fails(self):
        cap = dcom_pipeline.ViewerCapture()
        cap.vietmy = b'{"d": {}}'
        cap.qido_series = "https://pacs.test/studies/1/series"

        calls = []

        class FailingVietmy(dcom_pipeline.VietmyAdapter):
            def download(self, *args, **kwargs):
                calls.append("vietmy")
                raise RuntimeError("VietMy network timeout")

        class SucceedingDicomweb(dcom_pipeline.DicomWebAdapter):
            def download(self, cap, save_body, stats, log, stop, selected_series):
                calls.append("dicomweb")
                stats.dicom = 10
                stats.expected = 10
                stats.failed = 0

        adapters = [FailingVietmy(), SucceedingDicomweb()]
        stats = dcom_pipeline.DownloadStats()

        # Mô phỏng fallback runner
        for adapter in sorted(adapters, key=lambda a: a.priority, reverse=True):
            try:
                adapter.download(cap, lambda _: True, stats, lambda _: None, lambda: False, None)
                if stats.is_complete():
                    break
            except Exception:
                continue

        self.assertEqual(["vietmy", "dicomweb"], calls)
        self.assertTrue(stats.is_complete())
        self.assertEqual("complete", stats.status)

    def test_download_all_keeps_browser_alive_for_secondary_adapter_and_closes_in_finally(self):
        import tempfile
        from pathlib import Path

        calls = []

        class FakePage:
            url = "https://pacs.test/viewer"
            def on(self, *_args): pass
            def goto(self, *_args, **_kwargs): pass

        class FakeContext:
            def __init__(self): self.page = FakePage()
            def add_init_script(self, *_args): pass
            def new_page(self): return self.page
            def cookies(self): return []

        class FakeBrowser:
            def __init__(self): self.closed = False
            def new_context(self, **_kwargs): return FakeContext()
            def close(self): self.closed = True

        class FakePlaywrightContext:
            def __enter__(self): return object()
            def __exit__(self, *_args): return False

        browser = FakeBrowser()

        class Primary:
            name = "Primary"
            def download(self, *_args):
                calls.append(("primary", browser.closed))
                raise RuntimeError("primary failed")

        class Secondary:
            name = "Secondary"
            def download(self, _cap, _save, stats, _log, _stop, _selected):
                calls.append(("secondary", browser.closed))
                stats.dicom = 2
                stats.expected = 2
                stats.completed_tasks = 2
                stats.failed = 0

        with tempfile.TemporaryDirectory() as tmp_dir, \
             mock.patch("playwright.sync_api.sync_playwright", return_value=FakePlaywrightContext()), \
             mock.patch.object(dcom_pipeline, "_launch_chromium", return_value=browser), \
             mock.patch.object(dcom_pipeline, "_wait_for_viewer_manifest", return_value=None), \
             mock.patch.object(dcom_pipeline, "_ready_adapter", return_value=Primary()), \
             mock.patch.object(dcom_pipeline, "_ready_adapters", return_value=[Primary(), Secondary()]), \
             mock.patch.object(dcom_pipeline.pacs_strategy_store, "save_recipe"):
            stats = dcom_pipeline.download_all(
                "https://pacs.test/viewer",
                Path(tmp_dir) / "DICOM",
                log=lambda _message: None,
            )

        self.assertEqual([("primary", False), ("secondary", False)], calls)
        self.assertTrue(stats.is_complete())
        self.assertEqual(2, len(stats.outcomes))
        self.assertTrue(browser.closed)


class StrategyStoreTests(unittest.TestCase):
    """Kiểm tra tính an toàn (không rò rỉ token/PII) và khả năng ghi nhớ của PacsStrategyStore."""

    def test_compute_url_fingerprint_redacts_tokens_and_uids(self):
        url = "https://pacs.bv-test.vn/viewer/study/1.2.840.113619.2.348?token=secret123&patientId=BN001&series=2"
        fp = dcom_pipeline.compute_url_fingerprint(url, "DICOMweb")

        # Khóa fingerprint CHỈ chứa origin, normalized path và tên query param keys
        self.assertIn("https://pacs.bv-test.vn", fp)
        self.assertIn("patientId,series,token", fp)
        self.assertIn("DICOMWEB", fp)

        # Tuyệt đối KHÔNG chứa token giá trị thật hay UID/mã bệnh nhân thật
        self.assertNotIn("secret123", fp)
        self.assertNotIn("BN001", fp)
        self.assertNotIn("1.2.840.113619.2.348", fp)

    def test_strategy_store_saves_and_promotes_successful_recipe(self):
        import tempfile
        from pathlib import Path
        with tempfile.TemporaryDirectory() as tmp_dir:
            store_path = Path(tmp_dir) / "pacs-strategies-v1.json"
            store = dcom_pipeline.PacsStrategyStore(store_path)

            fp = "https://pacs.test|/viewer/*?token|DICOMWEB"
            # Lưu 3 lượt thành công cho DICOMweb
            store.save_recipe(fp, "DICOMweb", preferred_routes=["wadors", "wadouri"], success=True, latency_ms=120.0)
            store.save_recipe(fp, "DICOMweb", preferred_routes=["wadors", "wadouri"], success=True, latency_ms=100.0)

            pref_adapter = store.get_preferred_adapter(fp)
            self.assertEqual("DICOMweb", pref_adapter)
            self.assertEqual(["wadors", "wadouri"], store.get_preferred_routes(fp))

            # Kiểm tra file json đã tạo có schemaVersion=1
            self.assertTrue(store_path.is_file())
            content = json.loads(store_path.read_text(encoding="utf-8"))
            self.assertEqual(1, content["schemaVersion"])
    def test_strategy_store_updates_adapter_on_subsequent_success(self):
        import tempfile
        from pathlib import Path
        with tempfile.TemporaryDirectory() as tmp_dir:
            store_path = Path(tmp_dir) / "pacs-strategies-v1.json"
            store = dcom_pipeline.PacsStrategyStore(store_path)

            fp = "https://pacs.bv-test.vn|/viewer/*?token|*"
            # Lượt 1: VietMy partial
            store.save_recipe(fp, "VietMy", success=False, partial=True, failure_class="partial")
            r1 = store.load().get(fp)
            self.assertEqual("VietMy", r1["adapter"])
            self.assertEqual(1, r1["partial"])
            self.assertEqual(0, r1["success"])

            # Lượt 2: DICOMweb fallback success -> adapter phải đổi sang DICOMweb
            store.save_recipe(fp, "DICOMweb", preferred_routes=["wadors", "wadouri"], success=True, latency_ms=80.0)
            r2 = store.load().get(fp)
            self.assertEqual("DICOMweb", r2["adapter"])
            self.assertEqual(1, r2["success"])
            self.assertEqual("DICOMweb", store.get_preferred_adapter(fp))
            self.assertEqual(["wadors", "wadouri"], store.get_preferred_routes(fp))

    def test_strategy_store_purges_expired_ttl_recipes(self):
        import json
        import tempfile
        import time
        from pathlib import Path
        with tempfile.TemporaryDirectory() as tmp_dir:
            store_path = Path(tmp_dir) / "pacs-strategies-v1.json"
            store = dcom_pipeline.PacsStrategyStore(store_path)

            # Ghi trực tiếp recipe đã hết hạn 95 ngày trước
            old_time = time.time() - (95 * 86400)
            payload = {
                "schemaVersion": 1,
                "updatedAt": old_time,
                "recipes": {
                    "fp_expired": {
                        "schemaVersion": 1,
                        "fingerprint": "fp_expired",
                        "adapter": "VietMy",
                        "success": 5,
                        "lastSuccessAt": old_time,
                        "updatedAt": old_time
                    },
                    "fp_fresh": {
                        "schemaVersion": 1,
                        "fingerprint": "fp_fresh",
                        "adapter": "DICOMweb",
                        "success": 2,
                        "lastSuccessAt": time.time(),
                        "updatedAt": time.time()
                    }
                }
            }
            store_path.write_text(json.dumps(payload), encoding="utf-8")

            recipes = store.load()
            self.assertNotIn("fp_expired", recipes)
            self.assertIn("fp_fresh", recipes)

    def test_download_budget_expiration(self):
        import time
        with unittest.mock.patch("time.monotonic", return_value=100.0):
            budget = dcom_pipeline.DownloadBudget(
                started_at=100.0,
                last_progress_at=100.0,
                hard_deadline_s=600.0,
                stall_deadline_s=60.0
            )
            self.assertFalse(budget.is_expired())

        # Giả lập stall quá 60s
        with unittest.mock.patch("time.monotonic", return_value=170.0):
            self.assertTrue(budget.is_expired())

        # Touch khi có tiến độ mới
        with unittest.mock.patch("time.monotonic", return_value=170.0):
            budget.touch()
            self.assertFalse(budget.is_expired())

    def test_fetch_runner_uses_budget_and_touches_real_progress_path(self):
        class FakeBudget:
            def __init__(self):
                self.expired = False
                self.touches = 0

            def is_expired(self):
                return self.expired

            def touch(self):
                self.touches += 1

        budget = FakeBudget()
        stats = dcom_pipeline.DownloadStats()
        fetched = []
        dcom_pipeline._run_fetch_tasks(
            ["a", "b"],
            lambda item: fetched.append(item) or True,
            stats,
            lambda _message: None,
            lambda: False,
            budget=budget,
        )
        self.assertEqual(["a", "b"], fetched)
        self.assertEqual(2, budget.touches)
        self.assertEqual(2, stats.completed_tasks)

        budget.expired = True
        fetched.clear()
        expired_stats = dcom_pipeline.DownloadStats()
        dcom_pipeline._run_fetch_tasks(
            ["c"],
            lambda item: fetched.append(item) or True,
            expired_stats,
            lambda _message: None,
            lambda: False,
            budget=budget,
        )
        self.assertEqual([], fetched)
        self.assertEqual(1, expired_stats.failed)

    def test_study_identity_guard_rejects_cross_study_and_missing_uid_after_lock(self):
        guard = dcom_pipeline.StudyIdentityGuard()
        self.assertTrue(guard.accept("1.2.3"))
        self.assertTrue(guard.accept("1.2.3"))
        self.assertFalse(guard.accept("9.9.9"))
        self.assertFalse(guard.accept(""))

    def test_chunk_reader_touches_budget_and_observes_cancel_between_reads(self):
        class Response:
            def __init__(self): self.parts = [b"abc", b"def", b""]
            def read(self, _size): return self.parts.pop(0)

        class Budget:
            def __init__(self): self.touches = 0
            def is_expired(self): return False
            def touch(self): self.touches += 1

        budget = Budget()
        self.assertEqual(b"abcdef", dcom_pipeline._read_response_chunks(Response(), budget, lambda: False))
        self.assertEqual(2, budget.touches)

        reads = 0
        response = Response()
        original_read = response.read
        def counted_read(size):
            nonlocal reads
            reads += 1
            return original_read(size)
        response.read = counted_read
        with self.assertRaises(InterruptedError):
            dcom_pipeline._read_response_chunks(response, Budget(), lambda: reads >= 1)
        self.assertEqual(1, reads)


if __name__ == "__main__":
    unittest.main()

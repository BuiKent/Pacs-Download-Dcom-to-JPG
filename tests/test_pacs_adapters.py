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


class LegacyDictTests(unittest.TestCase):
    """`_download_via_*()` vẫn nhận đúng dict cũ nên phần tải không phải sửa."""

    def test_every_key_the_downloaders_read_is_present(self):
        keys = set(dcom_pipeline.ViewerCapture().as_legacy_dict())
        for needed in (
            "getstudies", "template_url", "vrpacs", "vietmy", "qido_series",
            "qido_series_body", "wado_tmpl", "host", "cookies",
            "api_headers", "session_error",
        ):
            self.assertIn(needed, keys)


if __name__ == "__main__":
    unittest.main()

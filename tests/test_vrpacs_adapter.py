import base64
import json
import unittest
from unittest.mock import MagicMock, patch
from dcom_pipeline import (
    ViewerCapture,
    VrpacsAdapter,
    DownloadStats,
    _probe_vrpacs_manifest_from_url,
    _vrpacs_share_payload,
    _vrpacs_series_choices,
    _download_via_vrpacs,
)


class TestVrpacsAdapter(unittest.TestCase):
    def setUp(self):
        self.share_data = {
            "link": "test_link_12345",
            "pName": "TRAN VAN TEST",
            "pCode": "BN10001",
        }
        self.params_b64 = base64.b64encode(json.dumps(self.share_data).encode("utf-8")).decode("utf-8")
        self.manifest_data = {
            "status": 200,
            "data": {
                "pName": "TRAN VAN TEST",
                "pCode": "BN10001",
                "studyList": [
                    {
                        "studyUID": "1.2.840.113619.2.1.2025.1001",
                        "studyDate": "2025-08-11",
                        "studyDescription": "MRI Cot Song That Lung",
                        "seriesList": [
                            {
                                "seriesNumber": "1",
                                "seriesDescription": "AASpine_Scout",
                                "modality": "MR",
                                "imageIds": [
                                    "wadouri:/vrpacs-scu/study-get-public?link=img_scout_1",
                                    "wadouri:/vrpacs-scu/study-get-public?link=img_scout_2",
                                ],
                            },
                            {
                                "seriesNumber": "2",
                                "seriesDescription": "t2_tse_sag_384",
                                "modality": "MR",
                                "imageIds": [
                                    "wadouri:/vrpacs-scu/study-get-public?link=img_t2_1",
                                    "wadouri:/vrpacs-scu/study-get-public?link=img_t2_2",
                                ],
                            },
                            {
                                "seriesNumber": "3",
                                "seriesDescription": "t1_tse_ax",
                                "modality": "MR",
                                "imageIds": [
                                    "wadouri:/vrpacs-file/study-get-image?link=img_t1_1",
                                ],
                            },
                        ],
                    }
                ],
            },
        }
        self.manifest_bytes = json.dumps(self.manifest_data).encode("utf-8")

    def test_vrpacs_series_choices(self):
        choices = _vrpacs_series_choices(self.manifest_bytes)
        self.assertEqual(len(choices), 3)
        self.assertEqual(choices[0]["description"], "AASpine_Scout")
        self.assertEqual(choices[0]["imageCount"], 2)
        self.assertEqual(choices[1]["description"], "t2_tse_sag_384")
        self.assertEqual(choices[1]["imageCount"], 2)
        self.assertEqual(choices[2]["description"], "t1_tse_ax")

    def test_vrpacs_adapter_observe_and_probe(self):
        adapter = VrpacsAdapter()
        cap = ViewerCapture()

        # Mock direct get-share-patient-image response
        mock_resp = MagicMock()
        mock_resp.url = "http://113.160.182.21:740/vrpacs-file/get-share-patient-image"
        mock_resp.body.return_value = self.manifest_bytes
        self.assertTrue(adapter.observe(mock_resp, cap))
        self.assertIsNotNone(cap.vrpacs)
        self.assertTrue(adapter.is_ready(cap))
        # The responding origin is the file service. cap.host must stay whatever the
        # caller recorded for the page, since /vrpacs-scu/ images come from there.
        self.assertEqual(cap.vrpacs_host, "http://113.160.182.21:740")
        self.assertIsNone(cap.host)

    def test_a_manifest_body_is_kept_even_when_it_carries_no_data(self):
        """observe() returning False lets the caller try to save the manifest as an image."""
        adapter = VrpacsAdapter()
        cap = ViewerCapture()
        mock_resp = MagicMock()
        mock_resp.url = "https://vrpacs.test/api/get-share-patient-image"
        mock_resp.body.return_value = b"{}"
        self.assertTrue(adapter.observe(mock_resp, cap))
        self.assertEqual(cap.vrpacs, b"{}")

    def test_multi_port_probing_mock(self):
        cap = ViewerCapture()
        viewer_url = f"http://113.160.182.21:82/viewershare/?params={self.params_b64}"

        # Mock urllib.request.urlopen to fail on port 82 (HTTP 405) but succeed on port 740
        def mock_urlopen(req, *args, **kwargs):
            url = req.full_url if hasattr(req, "full_url") else str(req)
            if ":82/" in url:
                import urllib.error
                raise urllib.error.HTTPError(url, 405, "Method Not Allowed", {}, None)
            if ":740/" in url:
                m = MagicMock()
                m.status = 200
                m.read.return_value = self.manifest_bytes
                m.__enter__.return_value = m
                m.__exit__.return_value = False
                return m
            import urllib.error
            raise urllib.error.HTTPError(url, 404, "Not Found", {}, None)

        with patch("urllib.request.urlopen", side_effect=mock_urlopen):
            success = _probe_vrpacs_manifest_from_url(viewer_url, cap)
            self.assertTrue(success)
            self.assertIsNotNone(cap.vrpacs)
            self.assertEqual(cap.vrpacs_host, "http://113.160.182.21:740")
            self.assertEqual(cap.vrpacs_scu_host, "http://113.160.182.21:82")

    def test_a_url_is_probed_once_per_session(self):
        """The probe runs inside a polling predicate; a retry per tick would eat the
        manifest wait budget and re-POST the share payload to every port again."""
        cap = ViewerCapture()
        viewer_url = f"http://113.160.182.21:82/viewershare/?params={self.params_b64}"
        attempts = []

        def mock_urlopen(req, *args, **kwargs):
            import urllib.error
            attempts.append(req.full_url)
            raise urllib.error.HTTPError(req.full_url, 404, "Not Found", {}, None)

        with patch("urllib.request.urlopen", side_effect=mock_urlopen):
            self.assertFalse(_probe_vrpacs_manifest_from_url(viewer_url, cap))
            first_round = len(attempts)
            self.assertFalse(_probe_vrpacs_manifest_from_url(viewer_url, cap))
        self.assertEqual(len(attempts), first_round)
        self.assertIn(viewer_url, cap.vrpacs_probed)

    def test_a_live_but_empty_service_does_not_win_the_port(self):
        cap = ViewerCapture()
        viewer_url = f"http://113.160.182.21:82/viewershare/?params={self.params_b64}"

        def mock_urlopen(req, *args, **kwargs):
            response = MagicMock()
            response.status = 200
            response.read.return_value = b'{"status": 200, "data": null}'
            response.__enter__.return_value = response
            response.__exit__.return_value = False
            return response

        with patch("urllib.request.urlopen", side_effect=mock_urlopen):
            self.assertFalse(_probe_vrpacs_manifest_from_url(viewer_url, cap))
        self.assertIsNone(cap.vrpacs)

    def test_share_payload_only_reads_a_vrpacs_link(self):
        self.assertEqual(
            _vrpacs_share_payload(f"http://host:82/viewershare/?params={self.params_b64}"),
            json.dumps(self.share_data).encode("utf-8"))
        self.assertIsNone(_vrpacs_share_payload("https://viewer.example.com/study/1.2.3"))
        urlsafe = base64.urlsafe_b64encode(
            json.dumps(self.share_data).encode("utf-8")).decode("utf-8")
        self.assertEqual(_vrpacs_share_payload(f"http://host:82/viewer?params={urlsafe}"),
                         json.dumps(self.share_data).encode("utf-8"))
        self.assertIsNone(_vrpacs_share_payload("http://host:82/viewer?params=bm90LWpzb24="))

    def test_download_via_vrpacs_routing(self):
        cap = ViewerCapture(
            vrpacs=self.manifest_bytes,
            vrpacs_host="http://113.160.182.21:740",
            vrpacs_scu_host="http://113.160.182.21:82",
            host="http://113.160.182.21:82",
        )
        saved = []
        def mock_save_body(body, *args, **kwargs):
            saved.append(body)
            return True

        stats = DownloadStats()
        log = MagicMock()
        stop = lambda: False

        import io
        fetched_urls = []
        def mock_urlopen(req, *args, **kwargs):
            url = req.full_url if hasattr(req, "full_url") else str(req)
            fetched_urls.append(url)
            stream = io.BytesIO(b"\x00" * 128 + b"DICM" + b"\x00" * 200)
            m = MagicMock()
            m.read.side_effect = stream.read
            m.__enter__.return_value = m
            m.__exit__.return_value = False
            return m

        with patch("urllib.request.OpenerDirector.open", side_effect=mock_urlopen):
            _download_via_vrpacs(cap.as_legacy_dict(), mock_save_body, stats, log, stop)
        self.assertEqual(len(fetched_urls), 5)
        # The viewer serves vrpacs-scu images itself; everything else comes from the
        # file service, which the probe may have found on another port.
        scu_urls = [u for u in fetched_urls if "vrpacs-scu" in u]
        file_urls = [u for u in fetched_urls if "vrpacs-scu" not in u]
        self.assertEqual(len(scu_urls), 4)
        for url in scu_urls:
            self.assertTrue(url.startswith("http://113.160.182.21:82/vrpacs-scu/study-get-public"))
        self.assertEqual(
            file_urls, ["http://113.160.182.21:740/vrpacs-file/study-get-image?link=img_t1_1"])


if __name__ == "__main__":
    unittest.main()

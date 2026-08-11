import unittest
from unittest import mock

import dcom_web_app
from dcom_web_app import NativeApi
from web_backend import WebController


class NativeApiSurfaceTests(unittest.TestCase):
    def test_native_objects_are_not_exposed_as_public_bridge_data(self):
        bridge = NativeApi(WebController())
        public_data = [
            name
            for name, value in vars(bridge).items()
            if not name.startswith("_") and not callable(value)
        ]
        self.assertEqual([], public_data)


class ClipboardAutoPasteTests(unittest.TestCase):
    """Only the two shapes worth pasting may cross the bridge into the page."""

    def read(self, text):
        with mock.patch.object(dcom_web_app, "_clipboard_text", return_value=text):
            return NativeApi(WebController()).read_clipboard()

    def test_a_viewer_link_is_offered_as_a_url(self):
        link = "https://viewer.example/study?token=abc"
        self.assertEqual({"url": link, "patientId": ""}, self.read(link))

    def test_a_bare_www_link_is_still_recognised(self):
        self.assertEqual("www.example.com/viewer", self.read("www.example.com/viewer")["url"])

    def test_a_patient_code_is_offered_as_a_patient_id(self):
        self.assertEqual({"url": "", "patientId": "BN2026001"}, self.read("BN2026001"))

    def test_unrelated_clipboard_text_is_not_exposed(self):
        self.assertEqual({"url": "", "patientId": ""}, self.read("ghi chu co dau cach"))

    def test_a_file_path_is_not_mistaken_for_a_patient_code(self):
        self.assertEqual({"url": "", "patientId": ""}, self.read(r"D:\Tai_ve\BN123"))

    def test_an_overlong_run_of_characters_is_rejected(self):
        self.assertEqual("", self.read("A" * 65)["patientId"])

    def test_an_empty_clipboard_offers_nothing(self):
        self.assertEqual({"url": "", "patientId": ""}, self.read(""))


class WindowGeometryResolutionTests(unittest.TestCase):
    def test_first_launch_defaults_to_maximized(self):
        params = dcom_web_app.resolve_window_parameters(None)
        self.assertEqual({"width": 1500, "height": 940, "maximized": True, "x": None, "y": None}, params)

    def test_saved_window_parameters_are_restored(self):
        saved = {"width": 1300, "height": 850, "x": 100, "y": 100, "maximized": False}
        params = dcom_web_app.resolve_window_parameters(saved)
        self.assertEqual({"width": 1300, "height": 850, "maximized": False, "x": 100, "y": 100}, params)


if __name__ == "__main__":
    unittest.main()

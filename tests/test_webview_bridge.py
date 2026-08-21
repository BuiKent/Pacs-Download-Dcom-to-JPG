import ctypes
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


class FakeUser32:
    """Records the Win32 calls the window chrome makes, and answers them.

    The real calls need a live HWND, so the behaviour worth protecting - which
    monitor fullscreen picks, whether the z-order is put back on the way out -
    is checked against this stand-in instead.
    """

    MONITOR_RECT = (0, 0, 2560, 1440)
    WORK_RECT = (0, 0, 2560, 1400)

    def __init__(
        self,
        style=0x00040000,
        zoomed=False,
        button_down=True,
        placement_ok=True,
    ):
        self.style = style
        self.zoomed = zoomed
        self.button_down = button_down
        self.placement_ok = placement_ok
        self.set_window_pos_calls = []
        self.messages = []
        self.monitor_from_window_flags = []
        self.shown = []
        self.placement_restored = False

    # ── Styles ──────────────────────────────────────────────────────────────
    def GetWindowLongW(self, hwnd, index):
        return self.style

    def SetWindowLongW(self, hwnd, index, value):
        previous, self.style = self.style, value
        return previous

    def SetWindowPos(self, hwnd, insert_after, x, y, cx, cy, flags):
        self.set_window_pos_calls.append(
            {
                "insert_after": getattr(insert_after, "value", insert_after),
                "rect": (x, y, cx, cy),
                "flags": flags,
            }
        )
        return True

    # ── State ───────────────────────────────────────────────────────────────
    def IsZoomed(self, hwnd):
        return self.zoomed

    def ShowWindow(self, hwnd, command):
        self.shown.append(command)
        if command == dcom_web_app.SW_MAXIMIZE:
            self.zoomed = True
        elif command == dcom_web_app.SW_RESTORE:
            self.zoomed = False
        return True

    def GetWindowPlacement(self, hwnd, placement_ref):
        if not self.placement_ok:
            return False
        placement_ref._obj.showCmd = 1
        placement_ref._obj.rcNormalPosition.left = 120
        placement_ref._obj.rcNormalPosition.top = 80
        placement_ref._obj.rcNormalPosition.right = 1420
        placement_ref._obj.rcNormalPosition.bottom = 900
        return True

    def SetWindowPlacement(self, hwnd, placement_ref):
        self.placement_restored = True
        return True

    # ── Monitors ────────────────────────────────────────────────────────────
    def MonitorFromWindow(self, hwnd, flags):
        self.monitor_from_window_flags.append(flags)
        return 4242

    def GetMonitorInfoW(self, monitor, info_ref):
        info = info_ref._obj
        for field, rect in (("rcMonitor", self.MONITOR_RECT), ("rcWork", self.WORK_RECT)):
            target = getattr(info, field)
            target.left, target.top, target.right, target.bottom = rect
        return True

    # ── Pointer ─────────────────────────────────────────────────────────────
    def GetCursorPos(self, point_ref):
        point_ref._obj.x, point_ref._obj.y = 300, 12
        return True

    def GetSystemMetrics(self, index):
        return 0

    def GetAsyncKeyState(self, key):
        return -32768 if self.button_down else 0

    def ReleaseCapture(self):
        return True

    def SendMessageW(self, hwnd, message, wparam, lparam):
        self.messages.append((message, wparam, lparam))
        return 0


class WindowChromeTests(unittest.TestCase):
    """The frameless window borrows the shell's own gestures; these are the
    places where it used to forget to hand them back."""

    def bridge(self, **kwargs):
        api = NativeApi(WebController())
        api._window = mock.Mock()
        api._window.native.Handle.ToInt64.return_value = 0x00010A2C
        fake = FakeUser32(**kwargs)
        patcher = mock.patch.object(dcom_web_app, "_USER32", fake)
        patcher.start()
        self.addCleanup(patcher.stop)
        return api, fake

    def test_fullscreen_covers_the_nearest_monitor_not_the_primary_one(self):
        # The flag was MONITOR_DEFAULTTOPRIMARY, so pressing F11 on the second
        # screen threw the window back onto the first one.
        api, fake = self.bridge()
        self.assertTrue(api.window_toggle_fullscreen())
        self.assertEqual(
            [dcom_web_app.MONITOR_DEFAULTTONEAREST], fake.monitor_from_window_flags
        )
        self.assertEqual((0, 0, 2560, 1440), fake.set_window_pos_calls[-1]["rect"])

    def test_leaving_fullscreen_puts_the_window_back_in_the_z_order(self):
        # Entering set HWND_TOPMOST and leaving passed SWP_NOZORDER, so the
        # window floated above every other application for the rest of the day.
        api, fake = self.bridge()
        api.window_toggle_fullscreen()
        api.window_toggle_fullscreen()
        exit_call = fake.set_window_pos_calls[-1]
        self.assertEqual(
            ctypes.c_void_p(dcom_web_app.HWND_NOTOPMOST).value, exit_call["insert_after"]
        )
        self.assertFalse(exit_call["flags"] & dcom_web_app.SWP_NOZORDER)
        self.assertTrue(fake.placement_restored)

    def test_fullscreen_never_pins_the_window_above_other_applications(self):
        api, fake = self.bridge()
        api.window_toggle_fullscreen()
        enter_call = fake.set_window_pos_calls[-1]
        self.assertEqual(
            ctypes.c_void_p(dcom_web_app.HWND_TOP).value, enter_call["insert_after"]
        )

    def test_fullscreen_state_is_reported_to_the_page(self):
        api, _ = self.bridge()
        self.assertFalse(api.window_state()["fullscreen"])
        api.window_toggle_fullscreen()
        self.assertTrue(api.window_state()["fullscreen"])
        api.window_toggle_fullscreen()
        self.assertFalse(api.window_state()["fullscreen"])

    def test_fullscreen_is_not_entered_without_a_restorable_placement(self):
        api, fake = self.bridge(placement_ok=False)
        self.assertFalse(api.window_toggle_fullscreen())
        self.assertIsNone(api._fullscreen_state)
        self.assertEqual([], fake.set_window_pos_calls)

    def test_the_maximised_state_is_read_from_the_window_itself(self):
        # Aero Snap and Win+Up never touch our buttons, so the page has to be
        # able to ask rather than remember.
        api, fake = self.bridge(zoomed=True)
        self.assertTrue(api.window_state()["maximized"])
        self.assertFalse(api.window_toggle_maximize())
        self.assertFalse(api.window_state()["maximized"])

    def test_a_title_bar_drag_is_handed_to_the_shell(self):
        api, fake = self.bridge()
        self.assertTrue(api.window_begin_drag())
        self.assertEqual(
            [(dcom_web_app.WM_NCLBUTTONDOWN, dcom_web_app.HTCAPTION, (12 << 16) | 300)],
            fake.messages,
        )

    def test_a_drag_is_refused_once_the_button_is_already_up(self):
        # The shell's move loop only ends on the button coming up: one started
        # after the release leaves the window stuck to the cursor.
        api, fake = self.bridge(button_down=False)
        self.assertFalse(api.window_begin_drag())
        self.assertEqual([], fake.messages)

    def test_the_frameless_window_keeps_its_resize_border_but_no_caption(self):
        # WS_CAPTION drew a second title bar above the HTML one; without
        # WS_THICKFRAME there is no resize edge and no Aero Snap target.
        api, fake = self.bridge(style=0)
        self.assertTrue(api._prepare_window_chrome())
        self.assertTrue(fake.style & dcom_web_app.WS_THICKFRAME)
        self.assertTrue(fake.style & dcom_web_app.WS_MAXIMIZEBOX)
        self.assertTrue(fake.style & dcom_web_app.WS_MINIMIZEBOX)
        self.assertFalse(fake.style & dcom_web_app.WS_CAPTION)

    def test_window_geometry_uses_the_typed_user32_bridge(self):
        api, _ = self.bridge(zoomed=True)
        self.assertEqual(
            {
                "x": 120,
                "y": 80,
                "width": 1300,
                "height": 820,
                "maximized": True,
            },
            dcom_web_app.get_window_geometry(api._window),
        )


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

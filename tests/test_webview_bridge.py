import unittest

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


if __name__ == "__main__":
    unittest.main()

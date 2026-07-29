from __future__ import annotations

import copy
import unittest
from unittest.mock import patch

import dcom_pipeline


class _FakePage:
    def __init__(self):
        self.url = "https://example.test/ris/study/reading"

    def goto(self, url, **_kwargs):
        self.url = url

    def wait_for_timeout(self, _milliseconds):
        pass

    def evaluate(self, _script, *_args):
        return []

    def close(self):
        pass


class _FakeContext:
    def __init__(self, options):
        self.options = options

    def new_page(self):
        return _FakePage()

    def storage_state(self):
        return {"cookies": [{"name": "sid", "value": "SESSION"}], "origins": []}


class _FakeBrowser:
    def __init__(self, context_options):
        self.context_options = context_options

    def new_context(self, **options):
        self.context_options.append(copy.deepcopy(options))
        return _FakeContext(options)

    def close(self):
        pass


class _FakePlaywrightContext:
    def __enter__(self):
        return object()

    def __exit__(self, *_args):
        return False


class RisSessionTests(unittest.TestCase):
    def tearDown(self):
        dcom_pipeline.clear_ris_session_cache()
        dcom_pipeline._CHROME_UNAVAILABLE = False

    def test_session_cache_is_memory_only_copied_and_expires(self):
        state = {"cookies": [{"name": "sid", "value": "A"}], "origins": []}
        with patch("dcom_pipeline.time.monotonic", return_value=100.0):
            dcom_pipeline._store_ris_session_state("DHY", state)

        state["cookies"][0]["value"] = "CHANGED_OUTSIDE"
        with patch("dcom_pipeline.time.monotonic", return_value=101.0):
            cached = dcom_pipeline._get_ris_session_state("dhy")
        self.assertEqual("A", cached["cookies"][0]["value"])

        cached["cookies"][0]["value"] = "CHANGED_COPY"
        with patch("dcom_pipeline.time.monotonic", return_value=102.0):
            cached_again = dcom_pipeline._get_ris_session_state("dhy")
        self.assertEqual("A", cached_again["cookies"][0]["value"])

        expired_at = 102.0 + dcom_pipeline._RIS_SESSION_TTL_SECONDS + 1
        with patch("dcom_pipeline.time.monotonic", return_value=expired_at):
            self.assertIsNone(dcom_pipeline._get_ris_session_state("dhy"))

    def test_patient_id_validation_is_fail_closed_on_explicit_mismatch(self):
        self.assertTrue(
            dcom_pipeline._patient_id_matches(
                {"patientId": " 2606001174 "},
                "2606001174",
            )
        )
        self.assertFalse(
            dcom_pipeline._patient_id_matches(
                {"PatientID": "OTHER"},
                "2606001174",
            )
        )
        self.assertTrue(
            dcom_pipeline._patient_id_matches(
                {"studyIUID": "1.2.3"},
                "2606001174",
            )
        )

    def test_second_search_reuses_storage_state_without_second_login(self):
        context_options = []
        api_result = {
            "results": [{
                "studyIUID": "1.2.3",
                "patientId": "2606001174",
                "modalityDicom": "MR",
                "studyDescription": "MR BRAIN",
                "date": "2026-07-28",
            }],
            "authFailed": False,
            "statuses": [200],
        }

        with (
            patch(
                "playwright.sync_api.sync_playwright",
                return_value=_FakePlaywrightContext(),
            ),
            patch(
                "dcom_pipeline._launch_chromium",
                side_effect=lambda _p, _headless, _log: _FakeBrowser(context_options),
            ),
            patch("dcom_pipeline._perform_ris_login", return_value=True) as login,
            patch("dcom_pipeline._page_is_ris_login", return_value=False),
            patch("dcom_pipeline._query_ris_studies", return_value=api_result),
        ):
            first = dcom_pipeline.search_patient_studies(
                "dhy", "2606001174", log=lambda _message: None,
            )
            second = dcom_pipeline.search_patient_studies(
                "dhy", "2606001174", log=lambda _message: None,
            )

        self.assertEqual(1, login.call_count)
        self.assertEqual("1.2.3", first[0]["study_uid"])
        self.assertEqual("1.2.3", second[0]["study_uid"])
        self.assertNotIn("storage_state", context_options[0])
        self.assertEqual(
            "SESSION",
            context_options[1]["storage_state"]["cookies"][0]["value"],
        )

    def test_chrome_failure_is_not_retried_for_every_study(self):
        calls = []

        class Chromium:
            def launch(self, **kwargs):
                calls.append(kwargs.get("channel") or "bundled")
                if kwargs.get("channel") == "chrome":
                    raise RuntimeError("EACCES")
                return object()

        class Playwright:
            chromium = Chromium()

        logs = []
        with patch("dcom_pipeline._installed_chrome_paths", return_value=[]):
            dcom_pipeline._launch_chromium(Playwright(), True, logs.append)
            dcom_pipeline._launch_chromium(Playwright(), True, logs.append)

        self.assertEqual(["chrome", "msedge", "msedge"], calls)
        self.assertTrue(
            any("Chrome không khởi động được" in message for message in logs)
        )


if __name__ == "__main__":
    unittest.main()

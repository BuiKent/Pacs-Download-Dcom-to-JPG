"""History, settings and direct-link resume for the web backend.

These cover the classic-app conveniences ported to the WebView2 UI: a download
history shared with the classic app, a persisted language/output choice, and a
retry that merges into the folder the first attempt created.
"""

import json
import tempfile
import unittest
from pathlib import Path

from web_backend import HistoryStore, WebController


class HistoryStoreTests(unittest.TestCase):
    def setUp(self):
        self._temp = tempfile.TemporaryDirectory()
        self.root = Path(self._temp.name)
        self.path = self.root / "history.json"
        self.addCleanup(self._temp.cleanup)

    def test_reads_the_layout_written_by_the_classic_app(self):
        self.path.write_text(
            json.dumps(
                [
                    {"folder": str(self.root), "url": "https://viewer/a", "time": "01/02 03:04"},
                    {"no_folder": True},
                ]
            ),
            encoding="utf-8",
        )
        store = HistoryStore(self.path)
        entries = store.snapshot()
        self.assertEqual(1, len(entries), "entries without a folder must be dropped")
        self.assertEqual(str(self.root), entries[0]["folder"])
        self.assertEqual("https://viewer/a", entries[0]["url"])
        self.assertTrue(entries[0]["exists"])

    def test_re_adding_a_folder_moves_it_to_the_front_without_duplicating(self):
        store = HistoryStore(self.path)
        store.add(self.root / "one")
        store.add(self.root / "two")
        entries = store.add(self.root / "one")
        self.assertEqual(2, len(entries))
        self.assertEqual(str(self.root / "one"), entries[0]["folder"])

    def test_reopening_a_folder_keeps_the_link_that_filled_it(self):
        store = HistoryStore(self.path)
        store.add(self.root / "study", "https://viewer/token")
        store.add(self.root / "study")
        self.assertEqual("https://viewer/token", store.url_for(self.root / "study"))

    def test_a_new_link_for_the_same_folder_replaces_the_old_one(self):
        store = HistoryStore(self.path)
        store.add(self.root / "study", "https://viewer/old")
        store.add(self.root / "study", "https://viewer/new")
        self.assertEqual("https://viewer/new", store.url_for(self.root / "study"))

    def test_history_is_capped_and_persisted_to_disk(self):
        store = HistoryStore(self.path, limit=3)
        for index in range(5):
            store.add(self.root / f"folder{index}")
        self.assertEqual(3, len(store.snapshot()))
        reloaded = HistoryStore(self.path, limit=3).snapshot()
        self.assertEqual(
            [str(self.root / "folder4"), str(self.root / "folder3"), str(self.root / "folder2")],
            [item["folder"] for item in reloaded],
        )

    def test_a_deleted_folder_is_reported_as_missing_instead_of_being_dropped(self):
        store = HistoryStore(self.path)
        store.add(self.root / "gone")
        self.assertFalse(store.snapshot()[0]["exists"])

    def test_an_unwritable_history_file_does_not_raise(self):
        # Writing history must never be able to fail a download that succeeded.
        store = HistoryStore(self.root / "missing-dir" / "sub" / "history.json")
        store.path = Path("\x00invalid")
        self.assertEqual(1, len(store.add(self.root)))


class DirectDownloadResumeTests(unittest.TestCase):
    def setUp(self):
        self._temp = tempfile.TemporaryDirectory()
        self.root = Path(self._temp.name)
        self.addCleanup(self._temp.cleanup)
        self.url = "https://viewer.example/study?token=abc"
        self.controller = WebController()
        self.controller.history.path = self.root / "history.json"
        self.controller.history.reload()

    def test_a_fresh_download_creates_its_own_folder(self):
        folder, resumed = self.controller._direct_download_root(self.root, self.url, False)
        self.assertFalse(resumed)
        self.assertTrue(folder.name.startswith("LINK_"))

    def test_a_retry_merges_into_the_folder_the_first_attempt_created(self):
        first, _ = self.controller._direct_download_root(self.root, self.url, False)
        first.mkdir(parents=True)
        self.controller.history.add(first, self.url)
        folder, resumed = self.controller._direct_download_root(self.root, self.url, True)
        self.assertTrue(resumed)
        self.assertEqual(first, folder)

    def test_a_retry_picks_the_newest_attempt_when_several_exist(self):
        token = self.controller._direct_download_root(self.root, self.url, False)[0].name.split("_")[-1]
        older = self.root / f"LINK_20260101_000000_{token}"
        newer = self.root / f"LINK_20260105_000000_{token}"
        older.mkdir(parents=True)
        newer.mkdir(parents=True)
        self.controller.history.add(older, self.url)
        self.controller.history.add(newer, self.url)
        folder, resumed = self.controller._direct_download_root(self.root, self.url, True)
        self.assertTrue(resumed)
        self.assertEqual(newer, folder)

    def test_a_retry_without_a_previous_folder_falls_back_to_a_new_download(self):
        folder, resumed = self.controller._direct_download_root(self.root, self.url, True)
        self.assertFalse(resumed, "resume must not be reported when nothing was reused")
        self.assertFalse(folder.exists())

    def test_a_different_link_never_merges_into_another_link_folder(self):
        first, _ = self.controller._direct_download_root(self.root, self.url, False)
        first.mkdir(parents=True)
        self.controller.history.add(first, self.url)
        other, resumed = self.controller._direct_download_root(
            self.root, "https://viewer.example/other", True,
        )
        self.assertFalse(resumed)
        self.assertNotEqual(first, other)

    def test_history_outside_current_output_root_is_not_reused(self):
        other_root = self.root / "old-output"
        current_root = self.root / "current-output"
        previous = other_root / "PATIENT - 23T - BN001 - 2026-08-09"
        previous.mkdir(parents=True)
        current_root.mkdir()
        self.controller.history.add(previous, self.url)

        folder, resumed = self.controller._direct_download_root(current_root, self.url, True)

        self.assertFalse(resumed)
        self.assertEqual(current_root, folder.parent)

    def test_renamed_folder_is_resumed_from_marker_without_history(self):
        renamed = self.root / "PATIENT - 23T - BN001 - 2026-08-09"
        renamed.mkdir()
        self.controller._write_direct_download_marker(renamed, self.url)
        self.controller.history.reload()

        folder, resumed = self.controller._direct_download_root(self.root, self.url, True)

        self.assertTrue(resumed)
        self.assertEqual(renamed, folder)

    def test_legacy_link_folder_is_still_resumed_without_history(self):
        legacy, _resumed = self.controller._direct_download_root(self.root, self.url, False)
        legacy.mkdir()

        folder, resumed = self.controller._direct_download_root(self.root, self.url, True)

        self.assertTrue(resumed)
        self.assertEqual(legacy, folder)


class ControllerSettingsTests(unittest.TestCase):
    def setUp(self):
        self._temp = tempfile.TemporaryDirectory()
        self.root = Path(self._temp.name)
        self.addCleanup(self._temp.cleanup)
        self.controller = WebController()
        self.controller.settings_path = self.root / "settings.json"
        self.controller.history = HistoryStore(self.root / "history.json")

    def test_language_choice_survives_a_restart(self):
        self.controller.set_language("en")
        restarted = WebController()
        restarted.settings_path = self.controller.settings_path
        self.assertEqual("en", restarted._read_settings()["language"])

    def test_an_unsupported_language_is_rejected(self):
        with self.assertRaises(ValueError):
            self.controller.set_language("fr")

    def test_bootstrap_exposes_language_and_history_to_the_page(self):
        self.controller.set_language("en")
        self.controller.history.add(self.root, "https://viewer/x")
        payload = self.controller.bootstrap()
        self.assertEqual("en", payload["language"])
        self.assertEqual(str(self.root), payload["history"][0]["folder"])

    def test_changing_the_output_root_is_remembered(self):
        target = self.root / "kho"
        self.controller.set_output_root(str(target))
        self.assertEqual(str(target.resolve()), self.controller._read_settings()["outputRoot"])

    def test_opening_a_missing_history_folder_reports_a_clear_error(self):
        with self.assertRaises(ValueError):
            self.controller.start_history_open(str(self.root / "khong-ton-tai"))


if __name__ == "__main__":
    unittest.main()

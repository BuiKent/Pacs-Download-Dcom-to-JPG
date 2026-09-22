"""Load the unpacked extension in an isolated Chromium profile; no live PACS.

Unlike smoke_sidepanel.py, this exercises the real MV3 service worker and
chrome.* APIs. All study/job metadata below is synthetic, and no download runs.
"""

from pathlib import Path
from tempfile import TemporaryDirectory
from time import monotonic

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]


def run():
    with TemporaryDirectory(prefix="pacs-extension-smoke-") as profile, sync_playwright() as pw:
        context = pw.chromium.launch_persistent_context(
            profile,
            channel="chromium",
            headless=True,
            timeout=30000,
            args=[f"--disable-extensions-except={ROOT}", f"--load-extension={ROOT}", "--no-first-run"],
        )
        try:
            context.set_default_timeout(15000)
            worker = context.service_workers[0] if context.service_workers else context.wait_for_event("serviceworker")
            print("Loaded extension worker", flush=True)
            extension_id = worker.url.split("/")[2]
            viewer = context.new_page()
            await_url = "data:text/html,<title>Lifecycle fixture</title><p>Synthetic viewer</p>"
            viewer.goto(await_url)
            print("Opened synthetic viewer", flush=True)
            tab_id = worker.evaluate("async () => (await chrome.tabs.query({})).find(t => t.title === 'Lifecycle fixture').id")
            worker.evaluate("""async tabId => {
                await chrome.storage.session.set({
                    ['pacs6_tab_' + tabId]: {tabId, tracking: 'watching', currentUrl: 'https://pacs.invalid/viewer'},
                    ['pacs6_job_' + tabId]: {
                        id: 'fixture-job', attemptId: 'fixture-attempt', tabId, status: 'downloading',
                        studyUid: '1.2.826.0.1', selectedSeries: ['fixture-series'],
                        completed: 197, total: 576, failed: 0, updatedAt: 1
                    }
                });
                globalThis.fixtureScriptCalls = 0;
                const original = chrome.scripting.executeScript.bind(chrome.scripting);
                chrome.scripting.executeScript = (...args) => {
                    globalThis.fixtureScriptCalls++;
                    return original(...args);
                };
            }""", tab_id)
            print("Seeded active job", flush=True)
            panel = context.new_page()
            errors = []
            panel.on("pageerror", lambda error: errors.append(str(error)))
            panel.goto(f"chrome-extension://{extension_id}/sidepanel.html?tabId={tab_id}", wait_until="domcontentloaded")
            print("Opened panel", flush=True)
            panel.wait_for_function("document.getElementById('statusTitle').textContent === 'Downloading'")
            assert panel.inner_text("#progressText") == "197 / 576"
            assert panel.inner_text("#scoreText") == "34%"
            assert panel.locator("#scanBtn").is_disabled()
            result = panel.evaluate("tabId => chrome.runtime.sendMessage({type: 'GET_OVERVIEW', tabId})", tab_id)
            assert result["ok"] and result["inventory"] is None
            assert result["summary"]["currentUrl"] == "https://pacs.invalid/viewer"
            assert worker.evaluate("globalThis.fixtureScriptCalls") == 0, "An active overview scanned the viewer"
            print("Verified active overview", flush=True)

            # An offscreen document alone does not imply this tab is running.
            # The real engine's PING_ENGINE reply must determine that instead.
            worker.evaluate("""async () => {
                await chrome.offscreen.createDocument({
                    url: 'offscreen.html', reasons: ['BLOBS'], justification: 'Isolated lifecycle regression test'
                });
            }""")
            print("Created isolated offscreen document", flush=True)
            blocked = panel.evaluate("""tabId => chrome.runtime.sendMessage({
                type: 'START_DOWNLOAD', tabId, selectedSeries: ['fixture-series'], options: {}
            })""", tab_id)
            assert not blocked["ok"] and "Study not yet recognized" in blocked["error"]

            # Stop the real MV3 worker, not the browser or extension. A normal
            # runtime event must load recipes even though onStartup never runs.
            panel.evaluate("""async () => {
                await chrome.storage.local.set({pacs6_site_recipes: {
                    'https://pacs-a.invalid': {dicom: ['https://pacs-a.invalid/image?'], updatedAt: Date.now()},
                    'https://pacs-b.invalid': {dicom: ['https://pacs-b.invalid/image?'], updatedAt: Date.now()}
                }});
            }""")
            cdp = context.new_cdp_session(panel)
            versions = []
            cdp.on("ServiceWorker.workerVersionUpdated", lambda event: versions.extend(event.get("versions", [])))
            cdp.send("ServiceWorker.enable")
            cdp.send("ServiceWorker.stopAllWorkers")
            deadline = monotonic() + 10
            while not any(v.get("runningStatus") == "stopped" and v.get("scriptURL") == worker.url for v in versions):
                assert monotonic() < deadline, "MV3 worker did not stop"
                panel.wait_for_timeout(50)
            # Chromium can reuse the DevTools target ID after a worker stop;
            # Playwright's serviceworker event is not a lifecycle-restart event.
            panel.evaluate("""() => chrome.runtime.sendMessage({
                type: 'ENGINE_LEARNED_URL', url: 'https://pacs-c.invalid/image.dcm'
            }).catch(() => {})""")
            panel.wait_for_function("""async () => {
                const data = await chrome.storage.local.get('pacs6_site_recipes');
                return Boolean(data.pacs6_site_recipes?.['https://pacs-c.invalid']);
            }""")
            origins = panel.evaluate("""async () => Object.keys(
                (await chrome.storage.local.get('pacs6_site_recipes')).pacs6_site_recipes
            ).sort()""")
            assert origins == ['https://pacs-a.invalid', 'https://pacs-b.invalid', 'https://pacs-c.invalid'], origins
            print("Verified actual worker stop/revival preserves learned sites A+B when learning C", flush=True)
            assert not errors, errors
            print("Real extension lifecycle smoke OK: active overview 0 script injections; idle engine verified; no page errors")
        finally:
            context.close()


if __name__ == "__main__":
    run()

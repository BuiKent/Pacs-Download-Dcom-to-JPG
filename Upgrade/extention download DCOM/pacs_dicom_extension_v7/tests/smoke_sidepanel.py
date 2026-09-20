"""Real-browser smoke test for the side panel download state machine (Gate 3).

The node test suite drives sidepanel.js inside a vm with a hand written DOM, so
it can prove the handlers decide correctly but never that the shipped page wires
them up. This file loads the real sidepanel.html, sidepanel.css and ES modules in
headless Chromium behind a local HTTP server, stubs only the extension APIs a
panel cannot have outside Chrome, and then drives the page the way the service
worker does: by pushing runtime messages and activating tabs.

What it locks down, all of it observed in the browser:

1. While a job is downloading the header says Downloading, not Ready/Tracking,
   and the discovery + series controls stay collapsed.
2. An inventory update arriving mid-download does not move the progress card,
   which is the jump that pushed the Download button off screen.
3. The tail of a job (engine finished, sidecar not yet written) reads Finishing
   and an adapter fallback attempt can follow without the editor flashing back.
4. Resume after a partial result works from a real click and repeats the series
   the job was started with, although no checkbox was ever rendered.
5. Binding another tab drops the previous study, so one patient's identity can
   never sit above another patient's download.
6. No uncaught exception and no console error in the whole run.

    python tests/smoke_sidepanel.py [--headed]
"""

from __future__ import annotations

import argparse
import functools
import http.server
import sys
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]

# Only the surface sidepanel.js actually calls. Everything else - the DOM, the
# CSS, the module graph, IndexedDB - is the real browser.
STUB = """
(() => {
  const listeners = {message: [], activated: [], updated: []};
  const state = {
    overview: {ok: true, summary: {}, state: {}, inventory: null, job: null},
    overviewDelayMs: 0,
    tabs: {1: {id: 1, url: 'https://pacs.test/viewer'}},
    activeTabId: 1,
    sent: [],
    store: {},
  };
  window.__smoke = {
    setOverview(next) { state.overview = next; },
    setOverviewDelay(ms) { state.overviewDelayMs = ms; },
    setTab(tab) { state.tabs[tab.id] = tab; },
    sent(type) { return state.sent.filter(m => !type || m.type === type); },
    // Chrome does not wait for the panel to finish rebinding, and neither may
    // this: awaiting the listener would swallow the whole in-flight window the
    // tab switch is being judged on.
    activate(tabId) {
      state.activeTabId = tabId;
      for (const fn of listeners.activated) fn({tabId});
    },
    async push(message) {
      for (const fn of listeners.message) await fn(message);
    },
  };
  // The panel persists the chosen handle in IndexedDB, which structured-clones
  // it, so a stub carrying methods would throw DataCloneError and look exactly
  // like a refused folder. A handle without queryPermission counts as granted.
  window.showDirectoryPicker = async () => ({name: 'Smoke downloads'});
  const pick = keys => {
    const wanted = Array.isArray(keys) ? keys : keys == null ? Object.keys(state.store) : [keys];
    const out = {};
    for (const key of wanted) if (key in state.store) out[key] = state.store[key];
    return out;
  };
  window.chrome = {
    runtime: {
      getManifest: () => ({version: '7.2.7'}),
      getURL: path => path,
      onMessage: {addListener: fn => listeners.message.push(fn)},
      async sendMessage(message) {
        state.sent.push(message);
        if (message.type === 'GET_OVERVIEW') {
          if (state.overviewDelayMs) {
            await new Promise(done => setTimeout(done, state.overviewDelayMs));
          }
          return Object.assign({}, state.overview);
        }
        if (message.type === 'GET_HISTORY') return {ok: true, history: []};
        if (message.type === 'START_DOWNLOAD') return {ok: true, job: state.overview.job};
        return {ok: true};
      },
    },
    tabs: {
      query: async () => [state.tabs[state.activeTabId]],
      get: async id => state.tabs[id],
      create: async () => ({}),
      sendMessage: async () => ({}),
      onActivated: {addListener: fn => listeners.activated.push(fn)},
      onUpdated: {addListener: fn => listeners.updated.push(fn)},
    },
    storage: {
      local: {
        get: async keys => pick(keys),
        set: async obj => { Object.assign(state.store, obj); },
        remove: async keys => {
          for (const key of (Array.isArray(keys) ? keys : [keys])) delete state.store[key];
        },
      },
    },
    permissions: {request: async () => true},
  };
})();
"""


def inventory(patient_name, patient_id, previous=None):
    inv = {
        "adapter": "VRAD",
        "studyUid": "1.2.826.smoke." + patient_id,
        "patient": {"name": patient_name, "id": patient_id, "studyDate": "20260210"},
        "series": [
            {"id": "series-1", "number": 1, "description": "Localizer", "imageCount": 20},
            {"id": "series-2", "number": 2, "description": "Axial", "imageCount": 556},
        ],
    }
    if previous:
        inv["previousDownload"] = previous
    return inv


def job(**overrides):
    base = {
        "id": "smoke-job",
        "tabId": 1,
        "studyUid": "1.2.826.smoke.PID-1",
        "adapter": "VRAD",
        "status": "downloading",
        "completed": 197,
        "failed": 0,
        "total": 576,
        "selectedSeries": ["series-2"],
        "allSeriesSelected": False,
        "updatedAt": 1,
    }
    base.update(overrides)
    return base


def overview(current_job, inv):
    return {
        "ok": True,
        "summary": {"confidence": 100, "currentUrl": "https://pacs.test/viewer", "missingOrigins": []},
        "state": {"tracking": "watching", "confidence": 100},
        "job": current_job,
        "inventory": inv,
    }


class Panel:
    """The page under test plus the assertions this file needs."""

    def __init__(self, page):
        self.page = page
        self.failures = []

    def check(self, label, actual, expected):
        if actual != expected:
            # The panel speaks Vietnamese in places and a Windows console is
            # cp1252, so a report must never die on the text it is reporting.
            detail = f"{label}: got {actual!r}, expected {expected!r}"
            detail = detail.encode("ascii", "backslashreplace").decode("ascii")
            self.failures.append(detail)
            print("   FAIL " + detail)
        else:
            print(f"   ok   {label}")

    def text(self, element_id):
        return self.page.inner_text("#" + element_id).strip()

    def hidden(self, element_id):
        return self.page.evaluate(
            "id => document.getElementById(id).classList.contains('hidden')", element_id
        )

    def disabled(self, element_id):
        return self.page.evaluate("id => document.getElementById(id).disabled", element_id)

    def box(self, element_id):
        return self.page.evaluate(
            "id => { const r = document.getElementById(id).getBoundingClientRect();"
            " return {top: Math.round(r.top), height: Math.round(r.height)}; }",
            element_id,
        )

    def checkbox_ids(self):
        return self.page.evaluate(
            "() => [...document.querySelectorAll('#seriesList input[type=checkbox]')]"
            ".map(x => x.dataset.id)"
        )

    def set_overview(self, value):
        self.page.evaluate("value => window.__smoke.setOverview(value)", value)

    def push(self, message):
        self.page.evaluate("message => window.__smoke.push(message)", message)
        self.page.wait_for_timeout(120)

    def activate(self, tab_id, url, settle=200):
        self.page.evaluate(
            "tab => window.__smoke.setTab(tab)", {"id": tab_id, "url": url}
        )
        self.page.evaluate("id => window.__smoke.activate(id)", tab_id)
        self.page.wait_for_timeout(settle)

    def delay_overview(self, ms):
        self.page.evaluate("ms => window.__smoke.setOverviewDelay(ms)", ms)

    def shows(self, needle):
        return needle in self.page.inner_text("body")

    def sent(self, message_type):
        return self.page.evaluate("type => window.__smoke.sent(type)", message_type)


def serve(directory):
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(directory))
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, f"http://127.0.0.1:{httpd.server_address[1]}"


def run(headed):
    httpd, base_url = serve(ROOT)
    console_errors = []
    page_errors = []
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=not headed)
            page = browser.new_page(viewport={"width": 400, "height": 720})
            page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
            page.on("pageerror", lambda e: page_errors.append(str(e)))
            page.add_init_script(STUB)
            page.goto(f"{base_url}/sidepanel.html", wait_until="load")
            page.wait_for_timeout(200)

            panel = Panel(page)
            study = inventory("SMOKE^PATIENT^ONE", "PID-1")

            print("1. An active download owns the status header")
            panel.set_overview(overview(job(), study))
            panel.activate(1, "https://pacs.test/viewer")
            panel.check("statusTitle", panel.text("statusTitle"), "Downloading")
            panel.check("scoreText", panel.text("scoreText"), "34%")
            panel.check("trackBtn disabled", panel.disabled("trackBtn"), True)
            panel.check("scanBtn disabled", panel.disabled("scanBtn"), True)
            for element_id in ("learnCard", "studyCard", "seriesCard", "stickyBar"):
                panel.check(f"{element_id} hidden", panel.hidden(element_id), True)

            print("2. A late inventory update does not move the progress card")
            before = panel.box("progressCard")
            panel.push({"type": "INVENTORY_UPDATED", "tabId": 1, "inventory": study})
            panel.push({"type": "JOB_UPDATED", "tabId": 1, "job": job(completed=281, updatedAt=2)})
            panel.check("progressCard position", panel.box("progressCard"), before)
            panel.check("progressText", panel.text("progressText"), "281 / 576")
            panel.check("seriesCard still hidden", panel.hidden("seriesCard"), True)

            print("3. The tail of the job reads Finishing, then survives a fallback attempt")
            panel.push({"type": "JOB_UPDATED", "tabId": 1,
                        "job": job(status="finishing", completed=576, updatedAt=3)})
            panel.check("statusTitle", panel.text("statusTitle"), "Finishing")
            panel.check("cancelBtn hidden", panel.hidden("cancelBtn"), True)
            panel.check("resumeBtn hidden", panel.hidden("resumeBtn"), True)
            panel.push({"type": "JOB_UPDATED", "tabId": 1,
                        "job": job(completed=576, total=700, updatedAt=4)})
            panel.check("statusTitle after fallback", panel.text("statusTitle"), "Downloading")
            panel.check("seriesCard still hidden", panel.hidden("seriesCard"), True)

            print("4. Resume after a partial result repeats the job's own selection")
            partial = {"status": "partial", "lastDownloadAt": 5, "completed": 576, "total": 700}
            done_study = inventory("SMOKE^PATIENT^ONE", "PID-1", previous=partial)
            finished = job(status="partial", completed=576, total=700, updatedAt=5)
            panel.set_overview(overview(finished, done_study))
            panel.push({"type": "JOB_UPDATED", "tabId": 1, "job": finished})
            panel.push({"type": "INVENTORY_UPDATED", "tabId": 1, "inventory": done_study})
            page.wait_for_timeout(600)
            panel.check("resumeBtn visible", panel.hidden("resumeBtn"), False)
            panel.check("resumeBtn enabled", panel.disabled("resumeBtn"), False)
            panel.check("no rendered checkbox to read", panel.checkbox_ids(), [])
            settled_requests = len(panel.sent("GET_OVERVIEW"))
            panel.push({"type": "JOB_UPDATED", "tabId": 1,
                        "job": dict(finished, updatedAt=6)})
            page.wait_for_timeout(1800)
            panel.check("no recurring terminal refresh", len(panel.sent("GET_OVERVIEW")), settled_requests)
            page.click("#resumeBtn", timeout=5000)
            page.wait_for_timeout(400)
            started = panel.sent("START_DOWNLOAD")
            panel.check("START_DOWNLOAD sent", len(started), 1)
            if started:
                panel.check("resumed series", started[0].get("selectedSeries"), ["series-2"])

            print("5. Binding another tab blanks the previous patient before the new one loads")
            # The name is rendered with the DICOM carets stripped, so the screen
            # is searched for what a reader would actually see.
            shown_name = "SMOKE PATIENT ONE"
            panel.check("patient on screen before the switch", panel.shows(shown_name), True)
            # The new tab's overview is a round trip away. Nothing of the old
            # patient may survive into that gap.
            panel.delay_overview(500)
            panel.set_overview(overview(job(id="other-job", tabId=2), None))
            panel.activate(2, "https://other-pacs.test/viewer", settle=80)
            panel.check("previous patient cleared at once", panel.shows(shown_name), False)
            panel.check("studyCard hidden at once", panel.hidden("studyCard"), True)
            panel.check("previous viewer link cleared", panel.text("viewerUrl"), "https://other-pacs.test/viewer")
            panel.push({"type": "JOB_UPDATED", "tabId": 2,
                        "job": job(id="other-job", tabId=2, completed=337, updatedAt=7)})
            page.wait_for_timeout(900)
            panel.delay_overview(0)
            panel.check("previous patient still gone", panel.shows(shown_name), False)
            panel.check("no inherited checkbox", panel.checkbox_ids(), [])
            panel.check("statusTitle", panel.text("statusTitle"), "Downloading")
            panel.check("late overview did not rewind progress", panel.text("progressText"), "337 / 576")

            print("6. Console is clean")
            panel.check("console errors", console_errors, [])
            panel.check("uncaught exceptions", page_errors, [])

            browser.close()
    finally:
        httpd.shutdown()

    if panel.failures:
        print("\nSMOKE FAILED")
        for failure in panel.failures:
            print(" - " + failure)
        return 1
    print("\nSide panel browser smoke OK")
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--headed", action="store_true", help="watch the run in a real window")
    sys.exit(run(parser.parse_args().headed))

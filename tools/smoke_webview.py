"""Quick WebView2 smoke test for the production app bundle.

Uses the same Edge Chromium engine, local API, token, Cornerstone bundle and
synthetic archive as the release.  The window must be visible: WebView2 gives a
hidden window no surface to composite, so Cornerstone never attaches a canvas
and every check below would time out on a healthy build.  For the full release
gate (pixel assertions, repeated MPR/3D transitions) use
``python dcom_web_app.py --smoke-test``.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
import time
import traceback
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import webview

from dcom_web_app import _assert_panes_drawn
from web_backend import LocalApiServer, WebController


def _cross_plane_pair(series_list: list[dict]) -> tuple[str, str] | None:
    """Return two geometry-bearing series on different planes in one FoR."""
    candidates: list[tuple[str, str, list[float]]] = []
    for series in series_list:
        geometry = series.get("geometry") or {}
        orientation = geometry.get("orientation")
        if not isinstance(orientation, list) or len(orientation) != 6:
            continue
        row = orientation[:3]
        column = orientation[3:]
        normal = [
            row[1] * column[2] - row[2] * column[1],
            row[2] * column[0] - row[0] * column[2],
            row[0] * column[1] - row[1] * column[0],
        ]
        length = math.sqrt(sum(value * value for value in normal))
        if length <= 1e-6:
            continue
        series_id = str(series.get("id") or "")
        frame_uid = str(geometry.get("frameOfReferenceUID") or "")
        if series_id:
            candidates.append((series_id, frame_uid, [value / length for value in normal]))

    for index, (source_id, source_for, source_normal) in enumerate(candidates):
        for target_id, target_for, target_normal in candidates[index + 1:]:
            if source_for and target_for and source_for != target_for:
                continue
            dot = abs(sum(a * b for a, b in zip(source_normal, target_normal)))
            if dot < 0.9:
                return source_id, target_id
    return None


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--archive", required=True)
    parser.add_argument("--static", default="web_dist")
    parser.add_argument(
        "--require-compare",
        action="store_true",
        help=(
            "Fail instead of skipping when the archive has fewer than two "
            "series. Use this when the run is meant to gate the compare / "
            "Reference Lines path, otherwise a one-series archive reports a "
            "pass that proved nothing about it."
        ),
    )
    args = parser.parse_args()

    controller = WebController()
    archive = controller.open_archive(args.archive)
    cross_plane_pair = _cross_plane_pair(archive.get("series") or [])
    server = LocalApiServer(controller, Path(args.static))
    url = server.start()
    window = webview.create_window(
        "DCom Smoke",
        url=url,
        width=1280,
        height=800,
        background_color="#060a10",
    )
    result: dict = {}

    def run_checks() -> None:
        try:
            if not window.events.loaded.wait(30):
                raise TimeoutError("WebView2 không phát sự kiện loaded.")
            deadline = time.time() + 45
            while time.time() < deadline:
                state = window.evaluate_js(
                    """({
                      title: document.title,
                      brand: document.querySelector('.brand b')?.textContent || '',
                      fatal: document.querySelector('.fatal-error')?.textContent || '',
                      error: document.querySelector('.empty-state.error')?.textContent || '',
                      readyMode: window.__viewerReadyMode || '',
                      series: document.querySelectorAll('.series-card').length,
                      canvases: document.querySelectorAll('#workspace canvas').length
                    })"""
                )
                if state.get("fatal"):
                    raise RuntimeError(state["fatal"])
                if state.get("error"):
                    raise RuntimeError(state["error"])
                if (
                    state.get("series", 0) >= 1
                    and state.get("canvases", 0) >= 1
                    and state.get("readyMode") == "single"
                ):
                    state["litPixels"] = _assert_panes_drawn(window, "single", 1)
                    result["single"] = state
                    break
                time.sleep(0.5)
            else:
                raise TimeoutError(f"Không dựng được stack: {state}")

            # A two-series synthetic archive can additionally prove the real
            # compare/ReferenceLines call path. Cross-plane stacks must keep
            # their slice sliders independent while an SVG reference line is
            # rendered from shared patient-space geometry.
            if state.get("series", 0) < 2:
                # Record the skip explicitly: a silent pass here used to read
                # as "Reference Lines verified" when nothing had been checked.
                skipped = (
                    f"skipped: cần >= 2 series để kiểm compare/Reference Lines "
                    f"(archive có {state.get('series', 0)})"
                )
                if args.require_compare:
                    raise RuntimeError(skipped)
                result["compareReferenceLines"] = skipped
            else:
                window.evaluate_js(
                    """(() => {
                      window.__smokeErrors = [];
                      window.addEventListener('error', event => window.__smokeErrors.push(
                        event.error?.stack || event.message || String(event.error)
                      ));
                      const oldError = console.error;
                      console.error = (...args) => {
                        window.__smokeErrors.push(args.map(String).join(' '));
                        oldError(...args);
                      };
                      document.querySelector('[data-action="mode-compare"]').click();
                    })()"""
                )
                deadline = time.time() + 45
                while time.time() < deadline:
                    compare = window.evaluate_js(
                        """({
                          readyMode: window.__viewerReadyMode || '',
                          canvases: document.querySelectorAll('#workspace canvas').length,
                          sliders: [...document.querySelectorAll('#workspace .slice-control input')]
                            .map(input => Number(input.value)),
                          referenceLines: document.querySelectorAll(
                            '#workspace svg line[data-id], #workspace svg line[data-uid]'
                          ).length,
                          referenceButton: {
                            pressed: document.querySelector(
                              '[data-action="reference-lines"]'
                            )?.getAttribute('aria-pressed') || '',
                            visible: Boolean(document.querySelector(
                              '[data-action="reference-lines"]'
                            ))
                          },
                          diagnostics: window.__viewerDiagnostics || null,
                          jsErrors: window.__smokeErrors || [],
                          error: document.querySelector('.empty-state.error')?.textContent || ''
                        })"""
                    )
                    if compare.get("error"):
                        raise RuntimeError(compare["error"])
                    if (
                        compare.get("readyMode") == "compare"
                        and compare.get("canvases", 0) >= 2
                        and len(compare.get("sliders", [])) == 2
                        and (compare.get("diagnostics") or {})
                        .get("referenceLines", {})
                        .get("pairModes")
                    ):
                        break
                    time.sleep(0.5)
                else:
                    raise TimeoutError(f"Không dựng được compare: {compare}")

                # Compare opens on whatever two series come first, which on a
                # real archive is usually a co-planar pair. Hot-swap pane B
                # through the catalog until a cross-plane partner turns up, so
                # the Reference Lines path is actually exercised — and so the
                # swap path itself is covered, since a swap used to leave the
                # reference line behind.
                def read_swap_state(viewport_id: str) -> dict:
                    selector = f'[data-viewport-id="{viewport_id}"]'
                    return window.evaluate_js(
                        """({
                          readyMode: window.__viewerReadyMode || '',
                          paneSeriesId: document.querySelector(%s)
                            ?.dataset.seriesId || '',
                          activeViewportId: document.querySelector(
                            '.viewport-shell.is-active'
                          )?.dataset.viewportId || '',
                          pairModes: window.__viewerDiagnostics
                            ?.referenceLines?.pairModes || [],
                          error: document.querySelector(
                            '.empty-state.error'
                          )?.textContent || '',
                          jsErrors: window.__smokeErrors || []
                        })""" % json.dumps(selector)
                    ) or {}

                def pair_mode_from(state: dict) -> str:
                    modes = state.get("pairModes") or ["index"]
                    return modes[0]

                def hot_swap(viewport_id: str, series_id: str) -> dict:
                    window.evaluate_js(
                        """document.getElementById(%s)?.dispatchEvent(
                             new Event('pointerdown', { bubbles: true })
                           )""" % json.dumps(viewport_id)
                    )
                    deadline = time.time() + 5
                    while time.time() < deadline:
                        if read_swap_state(viewport_id).get("activeViewportId") == viewport_id:
                            break
                        time.sleep(0.1)
                    window.evaluate_js(
                        "document.querySelector('[data-series-id=%s]')?.click()"
                        % json.dumps(series_id)
                    )
                    # Card clicks start async stack/decode work. Wait until the
                    # selected pane and diagnostics both belong to this swap.
                    deadline = time.time() + 30
                    swap_state = {}
                    while time.time() < deadline:
                        swap_state = read_swap_state(viewport_id)
                        if swap_state.get("error"):
                            raise RuntimeError(swap_state["error"])
                        if (
                            swap_state.get("readyMode") == "compare"
                            and swap_state.get("paneSeriesId") == series_id
                            and swap_state.get("pairModes")
                        ):
                            return swap_state
                        time.sleep(0.25)
                    raise TimeoutError(
                        f"Hot-swap {viewport_id} sang {series_id} chưa hoàn tất: {swap_state}"
                    )

                pair_mode = pair_mode_from(read_swap_state("stack-b"))
                if cross_plane_pair:
                    source_id, target_id = cross_plane_pair
                    hot_swap("stack-a", source_id)
                    swap_state = hot_swap("stack-b", target_id)
                    pair_mode = pair_mode_from(swap_state)
                    compare["crossPlaneSeriesIds"] = [source_id, target_id]
                compare["pairMode"] = pair_mode
                if pair_mode != "reference" and args.require_compare:
                    raise RuntimeError(
                        "Không tìm được cặp series khác mặt phẳng cùng Frame of Reference, "
                        "nên nhánh Reference Lines chưa được kiểm. Archive này không đủ "
                        f"để dùng làm gate (pairMode={pair_mode})."
                    )

                # Re-read after the swap, waiting for its SVG render too.
                if pair_mode == "reference":
                    deadline = time.time() + 15
                    while time.time() < deadline:
                        if window.evaluate_js(
                            "document.querySelectorAll("
                            "'#workspace svg line[data-id], #workspace svg line[data-uid]'"
                            ").length"
                        ) >= 1:
                            break
                        time.sleep(0.25)
                compare.update(window.evaluate_js(
                    """({
                      sliders: [...document.querySelectorAll('#workspace .slice-control input')]
                        .map(input => Number(input.value)),
                      referenceLines: document.querySelectorAll(
                        '#workspace svg line[data-id], #workspace svg line[data-uid]'
                      ).length,
                      diagnostics: window.__viewerDiagnostics || null,
                      jsErrors: window.__smokeErrors || []
                    })"""
                ))

                # Point crosslink: the tool has to be Passive, because that is
                # the only mode that both receives mouseMove and renders. It
                # must not sync position either — cross-plane panes keep their
                # own slice on purpose.
                cursor = compare["diagnostics"].get("referenceCursor") or {}
                compare["referenceCursor"] = cursor
                if cursor.get("requested"):
                    if cursor.get("toolMode") != "Passive":
                        raise RuntimeError(
                            f"Con trỏ tham chiếu không ở chế độ Passive nên sẽ không "
                            f"nhận mouseMove: {cursor}"
                        )
                    if cursor.get("positionSync") is not False:
                        raise RuntimeError(
                            f"Con trỏ tham chiếu đang bật positionSync, sẽ kéo pane kia "
                            f"chạy theo chuột: {cursor}"
                        )

                    if pair_mode == "reference":
                        # The Reference Line is the exact set of points shared
                        # by both planes. Move to its midpoint and require one
                        # four-stroke cursor in each pane. A broad sweep plus a
                        # >=4 total check only proved the source-pane marker.
                        target = window.evaluate_js(
                            """(() => {
                              const line = document.querySelector(
                                '#workspace svg line[data-id], #workspace svg line[data-uid]'
                              );
                              if (!line) return { error: 'no reference line' };
                              const rect = line.getBoundingClientRect();
                              return {
                                viewportId: line.closest('.viewport')?.id || '',
                                x: (rect.left + rect.right) / 2,
                                y: (rect.top + rect.bottom) / 2
                              };
                            })()"""
                        ) or {}
                        if target.get("error") or not target.get("viewportId"):
                            raise RuntimeError(
                                f"Không định vị được giao tuyến cho con trỏ: {target}"
                            )

                        # Hide Reference Lines so its identified SVG stroke
                        # cannot be mistaken for a ReferenceCursors stroke.
                        window.evaluate_js(
                            "document.querySelector('[data-action=\"reference-lines\"]')?.click()"
                        )
                        deadline = time.time() + 5
                        while time.time() < deadline:
                            identified = window.evaluate_js(
                                "document.querySelectorAll("
                                "'#workspace svg line[data-id], #workspace svg line[data-uid]'"
                                ").length"
                            )
                            if identified == 0:
                                break
                            time.sleep(0.1)

                        window.evaluate_js(
                            """(() => {
                              const target = %s;
                              const element = document.getElementById(target.viewportId);
                              if (!element) return false;
                              element.dispatchEvent(new Event('pointerenter', { bubbles: true }));
                              element.dispatchEvent(new MouseEvent('mousemove', {
                                bubbles: true,
                                view: window,
                                clientX: target.x,
                                clientY: target.y,
                                buttons: 0
                              }));
                              return true;
                            })()""" % json.dumps(target)
                        )
                        deadline = time.time() + 10
                        pane_strokes = []
                        while time.time() < deadline:
                            pane_strokes = window.evaluate_js(
                                """[...document.querySelectorAll(
                                  '#workspace .viewport-shell'
                                )].map(shell => ({
                                  viewportId: shell.dataset.viewportId || '',
                                  strokes: shell.querySelectorAll(
                                    'svg line:not([data-id]):not([data-uid])'
                                  ).length
                                }))"""
                            ) or []
                            if len(pane_strokes) == 2 and all(
                                item.get("strokes", 0) >= 4 for item in pane_strokes
                            ):
                                break
                            time.sleep(0.2)

                        compare["cursorProjection"] = pane_strokes
                        if len(pane_strokes) != 2 or any(
                            item.get("strokes", 0) < 4 for item in pane_strokes
                        ):
                            raise RuntimeError(
                                "Con trỏ tham chiếu không vẽ đủ 4 nét trên mỗi pane: "
                                f"{pane_strokes}"
                            )
                        compare["cursorStrokes"] = sum(
                            item["strokes"] for item in pane_strokes
                        )

                        # Restore the line for the scroll-survival assertion.
                        window.evaluate_js(
                            "document.querySelector('[data-action=\"reference-lines\"]')?.click()"
                        )
                        deadline = time.time() + 10
                        while time.time() < deadline:
                            if window.evaluate_js(
                                "document.querySelectorAll("
                                "'#workspace svg line[data-id], #workspace svg line[data-uid]'"
                                ").length"
                            ) >= 1:
                                break
                            time.sleep(0.2)
                    else:
                        compare["cursorProjection"] = (
                            "skipped: cần cặp cross-plane để chứng minh marker ở cả hai pane"
                        )
                if pair_mode == "reference" and compare.get("referenceLines", 0) < 1:
                    raise RuntimeError(f"Cross-plane pair vẽ thiếu Reference Line: {compare}")
                if pair_mode == "spatial" and compare.get("referenceLines", 0) > 0:
                    raise RuntimeError(
                        f"Co-planar pair không được có Reference Line (hai mặt song song "
                        f"không có giao tuyến): {compare}"
                    )

                before = compare["sliders"]
                result["compareReferenceLines"] = compare
                window.evaluate_js(
                    """(() => {
                      const sliders = [...document.querySelectorAll(
                        '#workspace .slice-control input'
                      )];
                      sliders[0].value = String(Math.min(
                        Number(sliders[0].max), Number(sliders[0].value) + 1
                      ));
                      sliders[0].dispatchEvent(new Event('input', { bubbles: true }));
                      return true;
                    })()"""
                )
                time.sleep(0.5)
                after_values = window.evaluate_js(
                    """[...document.querySelectorAll(
                      '#workspace .slice-control input'
                    )].map(input => Number(input.value))"""
                )
                if after_values[0] == before[0]:
                    raise RuntimeError(
                        f"Pane nguồn không cuộn được: {before} -> {after_values}"
                    )
                followed = after_values[1] != before[1]
                # spatial/index pairs must follow; reference/blocked pairs must
                # stay put and rely on the reference line instead.
                should_follow = pair_mode in ("spatial", "index")
                if followed != should_follow:
                    raise RuntimeError(
                        f"Cặp '{pair_mode}' đồng bộ sai: {before} -> {after_values} "
                        f"(mong đợi pane 2 {'đi theo' if should_follow else 'giữ nguyên'})"
                    )
                compare["slidersAfter"] = after_values
                compare["referenceLinesAfter"] = window.evaluate_js(
                    "document.querySelectorAll('#workspace svg line[data-id]').length"
                )
                # A cross-plane line must survive the scroll; the other modes
                # only have to stay free of runtime errors.
                if pair_mode == "reference" and compare["referenceLinesAfter"] < 1:
                    raise RuntimeError(f"Reference Line biến mất sau khi cuộn: {compare}")
                if compare.get("jsErrors"):
                    raise RuntimeError(f"Reference Lines runtime error: {compare}")
                compare["litPixels"] = _assert_panes_drawn(window, "compare", 2)
                result["compareReferenceLines"] = compare

            # Card clicks in compare hot-swap the focused pane; they do not
            # change the primary series that MPR uses. Leave compare first,
            # then select an MPR-ready card and wait until it is the single
            # viewport's series before pressing MPR.
            window.evaluate_js(
                "document.querySelector('[data-action=\"mode-single\"]')?.click()"
            )
            deadline = time.time() + 45
            while time.time() < deadline:
                if window.evaluate_js("window.__viewerReadyMode || ''") == "single":
                    break
                time.sleep(0.25)
            else:
                raise TimeoutError(
                    "Không thể thoát compare về single trước khi dựng MPR."
                )

            mpr_series = window.evaluate_js(
                """(() => {
                  const card = [...document.querySelectorAll('.series-card')].find(
                    item => item.querySelector('span')?.textContent?.trim() === '3D'
                  );
                  if (!card) return '';
                  card.click();
                  return card.dataset.seriesId || '';
                })()"""
            )
            result["mprSeriesId"] = mpr_series or "none"
            if not mpr_series:
                raise RuntimeError(
                    "Archive không có series nào MPR-ready, không thể kiểm nhánh MPR."
                )
            deadline = time.time() + 45
            mpr_selection = {}
            while time.time() < deadline:
                mpr_selection = window.evaluate_js(
                    """({
                      readyMode: window.__viewerReadyMode || '',
                      seriesId: document.querySelector(
                        '#workspace .viewport-shell'
                      )?.dataset.seriesId || '',
                      disabled: document.querySelector(
                        '[data-action="mode-mpr"]'
                      )?.disabled ?? true,
                      error: document.querySelector(
                        '.empty-state.error'
                      )?.textContent || ''
                    })"""
                ) or {}
                if mpr_selection.get("error"):
                    raise RuntimeError(mpr_selection["error"])
                if (
                    mpr_selection.get("readyMode") == "single"
                    and mpr_selection.get("seriesId") == mpr_series
                    and mpr_selection.get("disabled") is False
                ):
                    break
                time.sleep(0.25)
            else:
                raise TimeoutError(
                    f"Series 3D chưa trở thành primary MPR: {mpr_selection}"
                )
            window.evaluate_js("document.querySelector('[data-action=\"mode-mpr\"]').click()")
            deadline = time.time() + 60
            while time.time() < deadline:
                mpr = window.evaluate_js(
                    """({
                      disabled: document.querySelector('[data-action="mode-mpr"]')?.disabled,
                      canvases: document.querySelectorAll('#workspace canvas').length,
                      readyMode: window.__viewerReadyMode || '',
                      diagnostics: window.__viewerDiagnostics || null,
                      labels: [...document.querySelectorAll('.viewport-label')].map(e => e.textContent),
                      error: document.querySelector('.empty-state.error')?.textContent || '',
                      controls: ['tool-angle', 'tool-ellipse', 'tool-freehand'].map(action => {
                        const button = document.querySelector(`[data-action="${action}"]`);
                        const toolbar = document.querySelector('.toolbar');
                        const rect = button?.getBoundingClientRect();
                        const bounds = toolbar?.getBoundingClientRect();
                        return {
                          action,
                          visible: Boolean(button && rect && bounds
                            && rect.left >= bounds.left && rect.right <= bounds.right
                            && rect.top >= bounds.top && rect.bottom <= bounds.bottom)
                        };
                      })
                    })"""
                )
                if mpr.get("error"):
                    raise RuntimeError(mpr["error"])
                if mpr.get("canvases", 0) >= 3 and mpr.get("readyMode") == "mpr":
                    hidden_controls = [
                        item.get("action")
                        for item in mpr.get("controls", [])
                        if not item.get("visible")
                    ]
                    if hidden_controls:
                        raise RuntimeError(f"MPR controls are clipped: {hidden_controls}")
                    mpr["litPixels"] = _assert_panes_drawn(window, "mpr", 3)
                    result["mpr"] = mpr
                    break
                time.sleep(0.5)
            else:
                raise TimeoutError(f"Không dựng được MPR: {mpr}")

            if (mpr.get("diagnostics") or {}).get("sourceType") == "dicom":
                window.evaluate_js(
                    """(() => {
                      const select = document.querySelector('[data-field="window-preset"]');
                      select.value = 'contrast';
                      select.dispatchEvent(new Event('change', { bubbles: true }));
                    })()"""
                )
                time.sleep(0.75)
                result["dicomPreset"] = window.evaluate_js(
                    """({
                      selected: document.querySelector('[data-field="window-preset"]')?.value || '',
                      ranges: (window.__viewerDiagnostics?.viewports || []).map(item => item.voiRange)
                    })"""
                )
                ranges = result["dicomPreset"].get("ranges", [])
                if (
                    result["dicomPreset"].get("selected") != "contrast"
                    or not ranges
                    or any(value in ({"lower": 62, "upper": 168}, None) for value in ranges)
                ):
                    raise RuntimeError(f"DICOM preset still uses JPG range: {result['dicomPreset']}")
                result["dicomPreset"]["litPixels"] = _assert_panes_drawn(
                    window, "dicom-preset", 3,
                )

            window.evaluate_js("document.querySelector('[data-action=\"mode-volume3d\"]').click()")
            deadline = time.time() + 45
            while time.time() < deadline:
                volume = window.evaluate_js(
                    """({
                      canvases: document.querySelectorAll('#workspace canvas').length,
                      readyMode: window.__viewerReadyMode || '',
                      labels: [...document.querySelectorAll('.viewport-label')].map(e => e.textContent),
                      error: document.querySelector('.empty-state.error')?.textContent || ''
                    })"""
                )
                if volume.get("error"):
                    raise RuntimeError(volume["error"])
                if (
                    volume.get("canvases", 0) >= 1
                    and volume.get("readyMode") == "volume3d"
                    and any("3D" in text for text in volume.get("labels", []))
                ):
                    volume["litPixels"] = _assert_panes_drawn(
                        window, "volume3d", volume.get("canvases", 0),
                    )
                    result["volume3d"] = volume
                    break
                time.sleep(0.5)
            else:
                raise TimeoutError(f"Không dựng được 3D: {volume}")
        except Exception as exc:
            result["error"] = str(exc)
            result["traceback"] = traceback.format_exc()
        finally:
            window.destroy()

    try:
        webview.start(run_checks, gui="edgechromium", private_mode=True)
    finally:
        server.stop()
    # Vietnamese diagnostics must survive a redirected stdout (cp1252 pipe).
    _force_utf8_stdout()
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 1 if result.get("error") else 0


def _force_utf8_stdout() -> None:
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass


if __name__ == "__main__":
    raise SystemExit(main())

// @vitest-environment jsdom

import { describe, expect, it, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { state, applyWindowState, renderWindowControls } from "./main.js";

/**
 * The window is frameless, so the header strip is the title bar and the shell
 * is the only thing that knows what really happened to the window. These are
 * the seams where the two drifted apart before: a glyph that lied about the
 * window state, a title bar shorter than the row holding it, and a panel that
 * slid while the layout underneath it snapped.
 */
const cssSource = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

/** The body of the rule whose selector list starts a line — not one that only
    ends with the same words, such as `.app-shell.zen-mode .winbar`. */
function rule(selector) {
  const start = cssSource.indexOf(`\n${selector} {`);
  expect(start, `${selector} is not declared on a line of its own in styles.css`).toBeGreaterThan(-1);
  return cssSource.slice(start, cssSource.indexOf("}", start));
}

describe("title bar window buttons", () => {
  beforeEach(() => {
    document.body.innerHTML = `<div id="app"><div class="app-shell"></div></div>`;
    state.windowMaximized = false;
    state.zenMode = false;
  });

  it("ships both maximise glyphs so a state change never rewrites the button", () => {
    // The button used to be re-inner-HTML'd on every toggle, which meant the
    // glyph only ever matched the window when our own button had been the one
    // clicked — Aero Snap and Win+Up left it showing the wrong shape.
    const markup = renderWindowControls();
    expect(markup).toContain("glyph-maximize");
    expect(markup).toContain("glyph-restore");
    expect(rule(".app-shell.window-maximized .win-btn .glyph-restore")).toContain("display: block");
    expect(rule(".app-shell.window-maximized .win-btn .glyph-maximize")).toContain("display: none");
  });

  it("names every window button for a screen reader", () => {
    const markup = renderWindowControls();
    expect(markup.match(/aria-label="/g)).toHaveLength(3);
  });

  it("mirrors the window state onto the shell", () => {
    state.windowMaximized = true;
    state.zenMode = true;
    applyWindowState();
    const shell = document.querySelector(".app-shell");
    expect(shell.classList.contains("window-maximized")).toBe(true);
    expect(shell.classList.contains("zen-mode")).toBe(true);

    state.windowMaximized = false;
    state.zenMode = false;
    applyWindowState();
    expect(shell.classList.contains("window-maximized")).toBe(false);
    expect(shell.classList.contains("zen-mode")).toBe(false);
  });
});

describe("shell chrome layout", () => {
  it("gives the title bar row and the title bar the same height", () => {
    // A 54px grid row holding a 40px header left a 14px band of bare shell
    // background between the title bar and the tab strip.
    expect(rule(".app-shell")).toContain("var(--titlebar-h) var(--winbar-h) 1fr");
    expect(rule(".app-header")).toContain("height: var(--titlebar-h)");
    expect(rule(".winbar")).toContain("height: var(--winbar-h)");
  });

  it("moves the layout and the sliding panel on one clock", () => {
    // Only the panel animated before, so the grid column snapped to zero while
    // the panel was still travelling and the slide tore down the middle.
    expect(rule(".app-shell")).toContain("grid-template-columns var(--motion-base)");
    expect(rule(".download-panel")).toContain("transform var(--motion-base)");
  });

  it("does not lean on Electron's drag regions, which WebView2 ignores", () => {
    // The property reads like the drag is taken care of; nothing in WebView2
    // implements it. The drag is asked of the shell from installTitlebarChrome().
    expect(cssSource).not.toMatch(/-webkit-app-region\s*:/);
  });
});

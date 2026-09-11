import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Guards the light chrome palette against text that vanishes into its own
 * background.
 *
 * The app once shipped white field text on a white card, a white label on the
 * pale accent chip and a 2.5:1 status badge, all of which look like a broken
 * control rather than a colour mistake. jsdom does not paint, so the check runs
 * on the declared tokens instead: every pair below names a foreground and the
 * surface it is really drawn on in styles.css.
 */
const cssSource = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

/** Token values declared on bare `:root` — the light chrome palette. */
function rootTokens(css) {
  const block = css.slice(css.indexOf(":root {"));
  const body = block.slice(0, block.indexOf("\n}"));
  const tokens = {};
  for (const [, name, value] of body.matchAll(/(--[\w-]+):\s*([^;]+);/g)) {
    tokens[name] = value.trim();
  }
  return tokens;
}

function relativeLuminance(hex) {
  const value = hex.replace("#", "");
  const channels = [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(foreground, background) {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  const [light, dark] = a > b ? [a, b] : [b, a];
  return (light + 0.05) / (dark + 0.05);
}

const TOKENS = rootTokens(cssSource);

// Foreground token, background token, and where the pair is painted.
const PAIRS = [
  ["--field-fg", "--field-bg", "text typed into a boxed field"],
  ["--control-fg", "--control-bg", "download panel buttons"],
  ["--body-fg", "--shell-bg", "body copy"],
  ["--label-fg", "--panel-bg", "field labels"],
  ["--label-muted", "--shell-bg", "secondary lines under a patient name"],
  ["--accent-fg", "--accent-bg", "primary button label"],
  ["--done-fg", "--done-bg", "Đã tải badge"],
  ["--ok-fg", "--ok-bg", "Chưa tải badge"],
  ["--warn-fg", "--warn-bg", "Tải chưa hoàn tất badge"],
  ["--bad-fg", "--bad-bg", "Thiếu folder badge"],
  ["--category-fg", "--category-bg", "the grouping folder badge on a patient row"],
  ["--pill-new-fg", "--pill-new-bg", "new study pill"],
  ["--pill-downloaded-fg", "--pill-downloaded-bg", "downloaded study pill"],
  ["--pill-incomplete-fg", "--pill-incomplete-bg", "incomplete study pill"],
  ["--danger-fg", "--danger-bg", "Dừng button"],
  ["--alert-danger-fg", "--alert-danger-bg", "patient alert"],
  ["--log-fg", "--log-bg", "job log"],
  ["--titlebar-btn-fg", "--header-bg", "minimise/maximise/close glyphs"],
  ["--titlebar-btn-hover-fg", "--titlebar-btn-hover-bg", "title bar button under the pointer"],
  ["--brand-mark-fg", "--brand-mark-bg", "the letter inside the brand mark"],
  ["--sort-active-fg", "--list-bg", "the column the worklist is sorted by"],
];

describe("light chrome palette contrast", () => {
  it.each(PAIRS)("%s on %s stays legible (%s)", (fgName, bgName) => {
    const foreground = TOKENS[fgName];
    const background = TOKENS[bgName];
    expect(foreground, `${fgName} is not declared on :root`).toMatch(/^#[0-9a-f]{6}$/i);
    expect(background, `${bgName} is not declared on :root`).toMatch(/^#[0-9a-f]{6}$/i);
    expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("controls the browser paints for us", () => {
  it("keeps the colour scheme aligned with the surface underneath", () => {
    // Without these the UA picks system colours for input text, the caret and
    // checkboxes, which is how a white value ended up on a white card.
    expect(cssSource).toMatch(/:root \{[\s\S]*?color-scheme: light;/);
    expect(cssSource).toMatch(/\.app-shell\.viewer-active \{\s*\n\s*color-scheme: dark;/);
  });

  it("gives the transparent boxed-field input a colour of its own", () => {
    const rule = cssSource.slice(cssSource.indexOf(".boxed-field input {"));
    const body = rule.slice(0, rule.indexOf("}"));
    expect(body).toContain("color: var(--field-fg)");
    expect(body).toContain("caret-color: var(--field-fg)");
  });

  it("never paints a button label white on the pale accent chip", () => {
    const rule = cssSource.slice(cssSource.indexOf("button.primary {"));
    const body = rule.slice(0, rule.indexOf("}"));
    expect(body).not.toMatch(/color:\s*(#fff|#ffffff|white)\b/);
    expect(body).toContain("var(--accent-fg");
  });

  it("gives the focus ring a colour for each shell", () => {
    // One fixed ring cannot serve both: the cyan tuned for the image canvas is
    // 1.9:1 on the white Worklist, so keyboard users had no focus indicator
    // there at all.
    expect(cssSource).toContain("--focus-ring: #2383e2");
    expect(cssSource).toMatch(/\.app-shell\.viewer-active \{[\s\S]*?--focus-ring:/);
    expect(cssSource).toContain("outline: 2px solid var(--focus-ring");
  });

  it("lets the panel's primary and danger buttons keep their own colours", () => {
    // The shared download-panel rule outranks button.primary/button.danger, so
    // it must not set colour at all: the main action and the Stop button both
    // arrived as plain white buttons when it did.
    const rule = cssSource.slice(cssSource.indexOf(".download-panel button:not(.icon-button)"));
    const body = rule.slice(0, rule.indexOf("}"));
    expect(body).not.toContain("color:");
    expect(body).not.toContain("background:");
    expect(cssSource).toContain(":not(.primary):not(.danger)");
  });

  it("keeps the workspace empty state from covering the whole Worklist", () => {
    // `.empty-state` is absolute + inset: 0 for the reading canvas; unscoped it
    // painted the entire window black behind the patient list.
    const rule = cssSource.slice(cssSource.indexOf(".worklist-tree .empty-state {"));
    const body = rule.slice(0, rule.indexOf("}"));
    expect(body).toContain("position: static");
    expect(body).toContain("background: var(--panel-bg)");
  });
});

describe("Worklist grey and white inversion", () => {
  function ruleBody(selector, from = 0) {
    const start = cssSource.indexOf(selector, from);
    expect(start, `${selector} is declared`).toBeGreaterThanOrEqual(0);
    const rule = cssSource.slice(start);
    return rule.slice(0, rule.indexOf("}"));
  }

  const worklistRulesStart = cssSource.indexOf("/* ================= Multi-level Study List tree");

  it("uses a neutral grey canvas without changing the black job log", () => {
    expect(TOKENS["--shell-bg"]).toBe("#f1f1ef");
    expect(TOKENS["--chrome-border"]).toBe("#d8d8d5");
    expect(TOKENS["--log-bg"]).toBe("#101820");
  });

  it("puts patient rows on grey and study rows on white", () => {
    expect(ruleBody(".prow {", worklistRulesStart)).toContain("background: var(--shell-bg, #f1f1ef)");
    expect(ruleBody(".studies {", worklistRulesStart)).toContain("background: #ffffff");
    expect(ruleBody("\n.srow {", worklistRulesStart)).toContain("background: #ffffff");
  });

  it("keeps row hover feedback neutral instead of tinting the table blue", () => {
    const patientHover = ruleBody(".prow:hover {", worklistRulesStart);
    const studyHover = ruleBody(".srow:hover {", worklistRulesStart);
    expect(patientHover).toContain("background: #e9e9e7");
    expect(studyHover).toContain("background: #f7f7f5");
    expect(`${patientHover}\n${studyHover}`).not.toMatch(/#f0f7ff|#e2e8f0/i);
  });
});

/**
 * Format badges are written as literal hex in their own rules, not as tokens,
 * so the token sweep above never saw them.
 *
 * They sit in the app shell, which is white while the Worklist is open and
 * dark inside a record, and their colours were only ever chosen for the dark
 * one: the DICOM pill measured 1.63:1 and the JPG pill 1.39:1 on the white
 * winbar. This is the badge a reader checks to know whether they are looking
 * at original slices or at pictures converted from them, which decides whether
 * the grey values in front of them mean anything.
 */
function ruleDeclarations(css, selector) {
  const start = css.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`no rule for ${selector}`);
  const body = css.slice(start, css.indexOf("\n}", start));
  const colour = /color:\s*(#[0-9a-fA-F]{6})/.exec(body);
  const background = /background(?:-color)?:\s*rgba\(([^)]+)\)/.exec(body);
  return {
    colour: colour && colour[1],
    background: background && background[1].split(",").map((part) => Number(part.trim())),
  };
}

/** The colour an rgba tint actually resolves to over an opaque surface. */
function flatten([r, g, b, alpha], surface) {
  const base = surface.replace("#", "");
  const channels = [0, 2, 4].map((offset) => parseInt(base.slice(offset, offset + 2), 16));
  const mixed = [r, g, b].map((value, index) => Math.round(value * alpha + channels[index] * (1 - alpha)));
  return `#${mixed.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

const LIGHT_SHELL = TOKENS["--panel-bg"];

describe("format badges stay readable in the theme they are painted in", () => {
  for (const [selector, where] of [
    [".tab-fmt-badge.dicom", "DICOM tab badge on the white winbar"],
    [".tab-fmt-badge.jpg", "JPG tab badge on the white winbar"],
    [".fmt-badge.dicom", "DICOM badge on a Worklist row"],
    [".fmt-badge.jpg, .fmt-badge.photo", "JPG badge on a Worklist row"],
    [".fmt-badge.video", "video badge on a Worklist row"],
    [".fmt-badge.doc", "document badge on a Worklist row"],
    [".fmt-badge.unknown", "badge for a study whose format was never recorded"],
  ]) {
    it(`${where} reaches 4.5:1`, () => {
      const { colour, background } = ruleDeclarations(cssSource, selector);
      expect(colour, `${selector} declares no colour`).toBeTruthy();
      expect(background, `${selector} declares no rgba background`).toBeTruthy();
      const ratio = contrastRatio(colour, flatten(background, LIGHT_SHELL));
      expect(ratio, `${where} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
    });
  }

  it("the dark shell keeps its own, brighter tab badges", () => {
    const darkBlock = cssSource.slice(cssSource.indexOf(".app-shell.viewer-active .tab-fmt-badge.dicom"));
    expect(darkBlock).toContain("#38bdf8");
    expect(cssSource).toContain(".app-shell.viewer-active .tab-fmt-badge.jpg");
  });
});

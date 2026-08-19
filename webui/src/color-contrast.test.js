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
  ["--pill-new-fg", "--pill-new-bg", "new study pill"],
  ["--pill-downloaded-fg", "--pill-downloaded-bg", "downloaded study pill"],
  ["--pill-incomplete-fg", "--pill-incomplete-bg", "incomplete study pill"],
  ["--danger-fg", "--danger-bg", "Dừng button"],
  ["--alert-danger-fg", "--alert-danger-bg", "patient alert"],
  ["--log-fg", "--log-bg", "job log"],
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

  it("keeps the workspace empty state from covering the whole Worklist", () => {
    // `.empty-state` is absolute + inset: 0 for the reading canvas; unscoped it
    // painted the entire window black behind the patient list.
    const rule = cssSource.slice(cssSource.indexOf(".worklist-tree .empty-state {"));
    const body = rule.slice(0, rule.indexOf("}"));
    expect(body).toContain("position: static");
    expect(body).toContain("background: var(--panel-bg)");
  });
});

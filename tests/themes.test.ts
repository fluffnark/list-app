import { expect, it } from "vitest";
import { contrast, themeTokens, themes } from "../src/themes";
it("bundled palettes have stable unique IDs and readable light/dark UI tokens", () => {
  expect(new Set(themes.map((t) => t.id)).size).toBe(themes.length);
  expect(themes.length).toBeGreaterThan(150);
  expect(themes.map((t) => t.name)).toEqual(
    expect.arrayContaining(["Catppuccin Mocha", "Dracula", "Tycho"]),
  );
  for (const theme of themes) {
    expect(["light", "dark"]).toContain(theme.mode);
    for (const color of Object.values(theme.colors))
      expect(color).toMatch(/^#[0-9a-f]{6}$/);
    const tokens = themeTokens(theme);
    for (const text of [
      tokens.fg,
      tokens.muted,
      tokens.subtle,
      tokens["accent-text"],
      tokens.danger,
      tokens.success,
      tokens.warning,
    ])
      for (const background of [
        tokens.bg,
        tokens.surface,
        tokens["surface-hover"],
      ])
        expect(
          contrast(text, background),
          `${theme.name}: ${text} on ${background}`,
        ).toBeGreaterThanOrEqual(4.5);
    expect(contrast(tokens["on-accent"], tokens.accent)).toBeGreaterThanOrEqual(
      4.5,
    );
  }
});
